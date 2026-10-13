import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { abs } from '../../engine/complex.ts'
import { solveNetwork } from '../../network/solve.ts'
import { completeActivity } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { fx, sg } from '../../ui/format.ts'
import { Eq, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { Phasors } from '../../ui/Phasors.tsx'
import { gridNetwork } from '../grid/network.ts'
import { FaultDiagram, Interconnect, SeqNetworks, zText } from './diagrams.tsx'
import { Explore, ProtectionPlot, type ExploreTab, type FaultState, type ProtState } from './explore.tsx'
import { Experiments } from './experiment.tsx'
import { Practise } from './practise.tsx'
import { tripTime } from './relays.ts'
import { referRatio, RELAYS0, BREAKERS, BUS_SHORT, allTypes, breakerDuty, faultModel, faultNetwork, SETUP0, TAGS, tmsToGrade } from './study.ts'
import { FAULT_LABEL, FAULT_TYPES, sequenceSets, toSeq } from './sequence.ts'
import { Verify } from './verify.tsx'
import { faultStudy } from './zbus.ts'
import './faults.css'

/*
 * Module 4 — Faults & Protection. The Grid Explorer network short-circuited anywhere: Z_bus per sequence
 * (zbus.ts), the fault equations (sequence.ts), checked by an independent phase-domain solution (phase.ts), and the
 * relays that clear the fault (relays.ts). Every number on this page is computed from those modules.
 */

export const MODULE = 'faults'

const STATE0: FaultState = { setup: SETUP0, bus: 'lv', type: '3ph', rfOhm: 0 }
const PROT0: ProtState = { down: RELAYS0.down, up: RELAYS0.up, loc: 'feeder', type: '3ph' }

export default function FaultsModule({ mode, setMode }: ModuleProps) {
  const [st, setSt] = useState<FaultState>(STATE0)
  const [prot, setProt] = useState<ProtState>(PROT0)
  const [tab, setTab] = useState<ExploreTab>('study')
  return (
    <div className="ps-ft">
      {mode === 'learn' && (
        <Learn
          onExplore={(t) => {
            setTab(t)
            setMode('explore')
          }}
        />
      )}
      {mode === 'explore' && <Explore st={st} setSt={setSt} st0={STATE0} prot={prot} setProt={setProt} prot0={PROT0} tab={tab} setTab={setTab} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify st={st} prot={prot} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── Learn: what a fault does, and how it is calculated and cleared ────────────────────────────────────────────

function Learn({ onExplore }: { onExplore(tab: ExploreTab): void }) {
  const [step, setStep] = useState(0)
  const net = useMemo(() => faultNetwork(SETUP0), [])
  const m = useMemo(() => faultModel(SETUP0), [])
  const lf = useMemo(() => solveNetwork(gridNetwork()), [])
  const town = useMemo(() => allTypes(m, 'lv'), [m])
  const atGen = useMemo(() => faultStudy(m, 'gen', '3ph'), [m])
  const atHvB = useMemo(() => faultStudy(m, 'hvB', '3ph'), [m])
  const levels = useMemo(() => m.busIds.map((id) => faultStudy(m, id, '3ph')), [m])
  const iTownNormal = lf.branch.T3.iToKa
  const iGenNormal = lf.branch.T1.iToKa
  const graded = useMemo(() => ({ ...RELAYS0, up: { ...RELAYS0.up, tms: tmsToGrade(m, RELAYS0.down, RELAYS0.up) } }), [m])
  const slg = town.slg
  const vSet = slg.point.vabc
  const seqSets = sequenceSets(toSeq(vSet))
  const ph = (id: string, label: string, x: { re: number; im: number }, color: string, from?: { re: number; im: number }, dashed?: boolean) => ({ id, label, re: x.re, im: x.im, color, from, dashed })
  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode }> = [
    {
      title: 'A short circuit',
      visual: <FaultDiagram net={net} result={town['3ph']} tags={TAGS} label="A three-phase fault at the town’s 11 kV bus" />,
      body: (
        <>
          <p>
            In normal operation the town draws <b>{fx(iTownNormal * 1000, 0)} A</b> per phase at 11 kV (from the load flow). Now let the three phases touch at the town’s bus — a fallen conductor,
            failed insulation, an animal across the bushings. The current is no longer limited by the load, only by the impedances between the generator and the fault:{' '}
            <b>{fx(town['3ph'].faultKa, 2)} kA</b>, {fx(town['3ph'].faultKa / iTownNormal, 1)} times normal. At the generator terminals it would be {fx(atGen.faultKa, 1)} kA —{' '}
            {fx(atGen.faultKa / iGenNormal, 0)} times the {fx(iGenNormal * 1000, 0)} A the machine normally delivers.
          </p>
          <p>
            Heating grows with I²·t and the forces between conductors with I², so a fault must be cleared within a fraction of a second. Every voltage near the fault collapses too (the values under
            each bus): equipment far away is affected.
          </p>
          <p className="small muted">
            Fault model on this page: pre-fault voltage 1.0 pu everywhere, no load current (loads and line charging neglected), transformer ratios nominal — the classical short-circuit study.
          </p>
        </>
      ),
    },
    {
      title: 'The fault level',
      visual: <FaultDiagram net={net} result={atGen} tags={TAGS} label="A three-phase fault at the generator terminals" />,
      body: (
        <>
          <Eq
            expr="S_sc = √3 · V_n · I_f = S_base / |Z_th|      (V_f = 1 pu)"
            where={[
              ['S_sc', 'three-phase fault level', 'MVA'],
              ['V_n', 'nominal line-to-line voltage', 'kV'],
              ['I_f', 'three-phase fault current', 'kA'],
              ['Z_th', 'Thevenin impedance of the network seen from the fault', 'pu'],
            ]}
            assume="a bolted three-phase fault and 1.0 pu pre-fault voltage"
          />
          <div className="table-wrap">
            <table className="ps-table ps-ft-table">
              <caption className="sr-only">Three-phase fault level at every bus</caption>
              <thead>
                <tr>
                  <th scope="col">Bus</th>
                  <th scope="col">|Z_th| [pu]</th>
                  <th scope="col">I_f [kA]</th>
                  <th scope="col">Fault level [MVA]</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((r) => (
                  <tr key={r.busId}>
                    <td>{BUS_SHORT[r.busId]}</td>
                    <td>{fx(abs(r.z1!), 4)}</td>
                    <td>{fx(r.faultKa, 2)}</td>
                    <td>{fx(r.levelMva, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The fault level falls the further the fault is from the generator: every impedance in between limits it. Each breaker must be able to interrupt the largest fault current that can flow
            through it — CB4 on the town feeder is rated {BREAKERS[3].ratingKa} kA against a worst case of {fx(breakerDuty(m, 'lv').ka, 2)} kA ({FAULT_LABEL[breakerDuty(m, 'lv').type].toLowerCase()}).
          </p>
        </>
      ),
    },
    {
      title: 'One matrix for every fault: Z_bus',
      visual: <FaultDiagram net={net} result={atHvB} tags={TAGS} label="A three-phase fault at the 220 kV grid substation" />,
      body: (
        <>
          <p>
            Write the network’s bus-admittance matrix Y_bus (sources included as their reactances to the reference) and invert it: Z_bus = Y_bus⁻¹. Its diagonal element Z_kk is the Thevenin impedance
            at bus k, and its column k tells how a current drawn at k pulls down every other bus.
          </p>
          <Eq
            expr={'I_f = V_f / (Z_kk + Z_f)\nV_i = V_f − Z_ik · I_f'}
            where={[
              ['Z_kk', 'Thevenin impedance at the faulted bus k (diagonal of Z_bus)', 'pu'],
              ['Z_ik', 'transfer impedance between bus i and bus k', 'pu'],
              ['Z_f', 'fault impedance (0 for a bolted fault)', 'pu'],
            ]}
            assume="superposition: the pre-fault state plus the network’s response to the fault current alone"
          />
          <p>
            A fault at the 220 kV grid substation (Z_kk = {zText(atHvB.z1)} pu) draws {fx(abs(atHvB.point.i012[1]), 3)} pu = {fx(atHvB.faultKa, 3)} kA. The generator terminals stay at{' '}
            {fx(abs(atHvB.buses[0].vabc[0]), 3)} pu: one matrix gives every bus voltage during the fault.
          </p>
          <details className="ps-more">
            <summary>Show |Z_bus| (positive sequence)</summary>
            <ZbusTable m={m} />
          </details>
        </>
      ),
    },
    {
      title: 'Most faults are unbalanced: symmetrical components',
      visual: (
        <div className="ps-ft-phrow">
          <Phasors
            label="Phase voltages at the town during a line-to-ground fault"
            size={220}
            phasors={[ph('a', 'Va', vSet[0], 'var(--ps-a)'), ph('b', 'Vb', vSet[1], 'var(--ps-b)'), ph('c', 'Vc', vSet[2], 'var(--ps-c)')].filter((p) => Math.hypot(p.re, p.im) > 1e-6)}
          />
          <Phasors
            label="Positive-sequence set"
            size={220}
            phasors={[ph('a1', 'a₁', seqSets.pos[0], 'var(--ps-a)'), ph('b1', 'b₁', seqSets.pos[1], 'var(--ps-b)'), ph('c1', 'c₁', seqSets.pos[2], 'var(--ps-c)')]}
          />
          <Phasors
            label="Negative-sequence set"
            size={220}
            phasors={[ph('a2', 'a₂', seqSets.neg[0], 'var(--ps-a)'), ph('b2', 'b₂', seqSets.neg[1], 'var(--ps-b)'), ph('c2', 'c₂', seqSets.neg[2], 'var(--ps-c)')]}
          />
          <Phasors label="Zero-sequence set" size={220} phasors={[ph('a0', 'V₀', seqSets.zero[0], 'var(--text-1)')]} />
        </div>
      ),
      body: (
        <>
          <p>
            Most faults on overhead lines involve a single phase and earth: lightning flashes over an insulator, a tree touches one conductor. The three phases are then no longer a balanced set —
            above, the town’s voltages during a line-to-ground fault on phase a: V_a = 0, while V_b and V_c are {fx(abs(vSet[1]), 3)} and {fx(abs(vSet[2]), 3)} pu.
          </p>
          <Eq
            expr={'V_a = V₀ + V₁ + V₂\nV_b = V₀ + a²V₁ + aV₂\nV_c = V₀ + aV₁ + a²V₂        a = 1∠120°'}
            where={[
              ['V₁', 'positive sequence: a balanced a-b-c set (as a generator produces)', 'pu'],
              ['V₂', 'negative sequence: a balanced set in the order a-c-b', 'pu'],
              ['V₀', 'zero sequence: three equal phasors', 'pu'],
            ]}
            assume="linear, balanced network impedances: each sequence then flows only in its own network"
          />
          <p>Fortescue’s theorem: any three phasors are the sum of these three balanced sets — and in a balanced network each set can be solved on its own, with one per-phase circuit.</p>
        </>
      ),
    },
    {
      title: 'Three sequence networks',
      visual: (
        <div className="ps-diagram">
          <SeqNetworks m={m} result={slg} short={BUS_SHORT} />
        </div>
      ),
      body: (
        <>
          <p>
            <b>Positive:</b> the normal per-phase network with the generator’s emf behind x″d. <b>Negative:</b> the same impedances (the generator’s x₂), no sources. <b>Zero:</b> currents that are
            equal in all three phases must return through earth, so the zero-sequence network depends on how star points are earthed and how windings are connected.
          </p>
          <p>
            Here T1 and T2 are YNd: their earthed 220 kV stars are paths to the reference, while the deltas block zero-sequence current from passing. T3 (Dyn) earths the 11 kV side. The 33 kV system
            between two deltas has no earth path at all. The values drawn are the sequence currents of a line-to-ground fault at the town.
          </p>
        </>
      ),
    },
    {
      title: 'Connecting them at the fault',
      visual: (
        <div className="ps-diagram ps-ft-icwrap">
          <Interconnect result={slg} />
        </div>
      ),
      body: (
        <>
          <p>Each fault type is a different way of connecting the three networks at the fault point — the fault conditions on phase quantities, rewritten in sequence quantities:</p>
          <Eq
            expr={
              'Three-phase           I₁ = V_f / (Z₁ + Z_f)\nLine-to-ground        I₀ = I₁ = I₂ = V_f / (Z₁ + Z₂ + Z₀ + 3Z_f),   I_a = 3I₀\nLine-to-line          I₁ = −I₂ = V_f / (Z₁ + Z₂ + Z_f),   I₀ = 0\nDouble line-to-ground I₁ = V_f / (Z₁ + Z₂‖(Z₀ + 3Z_f))'
            }
            assume="phase a is the faulted phase (LG), b and c the faulted pair (LL, LLG)"
          />
          <div className="table-wrap">
            <table className="ps-table ps-ft-table">
              <caption className="sr-only">The four fault types at the town’s 11 kV bus</caption>
              <thead>
                <tr>
                  <th scope="col">At the town (11 kV)</th>
                  <th scope="col">|I₁| [pu]</th>
                  <th scope="col">|I₂| [pu]</th>
                  <th scope="col">|I₀| [pu]</th>
                  <th scope="col">Fault current [kA]</th>
                </tr>
              </thead>
              <tbody>
                {FAULT_TYPES.map((t) => (
                  <tr key={t}>
                    <td>{FAULT_LABEL[t]}</td>
                    {town[t].point.i012
                      .slice(1)
                      .concat(town[t].point.i012[0])
                      .map((x, i) => (
                        <td key={i}>{fx(abs(x), 3)}</td>
                      ))}
                    <td>{fx(town[t].faultKa, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ),
    },
    {
      title: 'Clearing the fault: protection',
      visual: <ProtectionPlot m={m} prot={{ ...graded, loc: 'feeder', type: '3ph' }} />,
      body: (
        <>
          <p>
            Relays measure current through current transformers and trip breakers. An inverse-time overcurrent relay operates faster the larger the current: t = TMS · k / ((I/I_s)^α − 1). R1 on the
            town feeder (CB4) must clear a feeder fault first; R2 on the 33 kV line (CB2) sees the same fault and waits a grading margin longer, as backup in case CB4 fails.
          </p>
          <p>
            For a three-phase fault on the feeder ({fx(town['3ph'].faultKa, 2)} kA) R1 operates in {fx(tripTime(graded.down.curve, graded.down.tms, graded.down.isA, town['3ph'].faultKa * 1000), 2)} s
            and R2 — set to TMS {fx(graded.up.tms, 2)} — in {fx(tripTime(graded.up.curve, graded.up.tms, graded.up.isA, (town['3ph'].faultKa * 1000) / referRatio(m)), 2)} s.
          </p>
          <div className="ps-toolbar-group">
            <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => onExplore('study')}>
              Fault any bus yourself →
            </button>
            <button type="button" className="btn ps-btn-sm" onClick={() => onExplore('protection')}>
              Grade the relays →
            </button>
          </div>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — "What a fault does", step ${step + 1} of ${steps.length}: ${cur.title}. Network: 13.8 kV generator (x″d 0.2 pu on 120 MVA, x0 0.06, solidly earthed), T1 YNd 13.8/220 kV, 120 km 220 kV line, T2 YNd 220/33 kV, 10 km 33 kV line, T3 Dyn 33/11 kV, town at 11 kV. Classical fault model: 1.0 pu pre-fault, loads neglected. Three-phase fault levels (MVA): ${levels.map((r) => `${r.busId} ${fx(r.levelMva, 0)}`).join(', ')}. At the town: ${FAULT_TYPES.map((t) => `${t} ${fx(town[t].faultKa, 2)} kA`).join(', ')}.`,
  )
  return (
    <div className="ps-stack">
      {cur.visual}
      <div className="ps-card ps-ft-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

function ZbusTable({ m }: { m: ReturnType<typeof faultModel> }) {
  const Z = m.seq[1].Z
  return (
    <div className="table-wrap">
      <table className="ps-table ps-ft-table ps-ft-zbus">
        <caption className="sr-only">Magnitudes of the positive-sequence bus impedance matrix</caption>
        <thead>
          <tr>
            <th scope="col">|Z_ik| [pu]</th>
            {m.busIds.map((id) => (
              <th key={id} scope="col">
                {id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.busIds.map((id, i) => (
            <tr key={id}>
              <td>{BUS_SHORT[id]}</td>
              {Z[i].map((z, k) => (
                <td key={k} className={i === k ? 'ps-ft-diag' : ''}>
                  {sg(abs(z), 3)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Diagonal (highlighted): the Thevenin impedance at each bus. A radial network from one source: Z_ik = Z_kk of whichever bus is nearer the generator.</p>
    </div>
  )
}
