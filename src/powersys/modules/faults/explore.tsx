import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { abs, arg, deg, polarDeg, type Complex } from '../../engine/complex.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx, sg } from '../../ui/format.ts'
import { Callout, Eq, Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import { Phasors, type Phasor } from '../../ui/Phasors.tsx'
import { FaultDiagram, Interconnect, LogPlot, phText, SeqNetworks, zText, type LogMark } from './diagrams.tsx'
import { CURVES, curvePoints, grade, GRADING_MARGIN, tripTime, type CurveId, type Relay } from './relays.ts'
import { FAULT_LABEL, FAULT_PHASES, FAULT_SHORT, FAULT_TYPES, sequenceSets, toSeq, type FaultType, type Trio } from './sequence.ts'
import {
  allTypes,
  BREAKERS,
  breakerDuty,
  BUS_SHORT,
  ET_X0_OHM,
  faultModel,
  faultNetwork,
  PROT_LOCATIONS,
  referRatio,
  relayCurrents,
  sameSetup,
  tagsFor,
  tmsToGrade,
  type GenEarth,
  type ProtLocation,
  type Setup,
} from './study.ts'
import { faultStudy, zfPu, type SeqModel } from './zbus.ts'

const MODULE = 'faults'

export interface FaultState {
  setup: Setup
  bus: string
  type: FaultType
  rfOhm: number
}
export interface ProtState {
  down: Relay
  up: Relay
  loc: ProtLocation
  type: FaultType
}
export type ExploreTab = 'study' | 'components' | 'protection'

export function Explore({
  st,
  setSt,
  st0,
  prot,
  setProt,
  prot0,
  tab,
  setTab,
}: {
  st: FaultState
  setSt(s: FaultState): void
  st0: FaultState
  prot: ProtState
  setProt(p: ProtState): void
  prot0: ProtState
  tab: ExploreTab
  setTab(t: ExploreTab): void
}) {
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="Explore"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'study', label: 'Fault study' },
            { id: 'components', label: 'Symmetrical components' },
            { id: 'protection', label: 'Protection' },
          ]}
        />
      </div>
      {tab === 'study' && <FaultStudy st={st} setSt={setSt} st0={st0} />}
      {tab === 'components' && <Components />}
      {tab === 'protection' && <Protection prot={prot} setProt={setProt} prot0={prot0} />}
    </div>
  )
}

// ── Fault study ───────────────────────────────────────────────────────────────────────────────────────────────

const BUS_ORDER = ['gen', 'hvA', 'hvB', 'mvA', 'mvB', 'lv']
type Panel = 'networks' | 'connection' | 'table'

function FaultStudy({ st, setSt, st0 }: { st: FaultState; setSt(s: FaultState): void; st0: FaultState }) {
  const m = useMemo(() => faultModel(st.setup), [st.setup])
  const net = useMemo(() => faultNetwork(st.setup), [st.setup])
  const zf = useMemo(() => zfPu(m, st.bus, st.rfOhm), [m, st.bus, st.rfOhm])
  const r = useMemo(() => faultStudy(m, st.bus, st.type, zf), [m, st.bus, st.type, zf])
  const all = useMemo(() => allTypes(m, st.bus, zf), [m, st.bus, zf])
  const [panel, setPanel] = useState<Panel>('networks')
  const [tried, setTried] = useState<Record<string, FaultType[]>>({})
  const progress = usePsProgress()
  useEffect(() => {
    setTried((t) => ((t[st.bus] ?? []).includes(st.type) ? t : { ...t, [st.bus]: [...(t[st.bus] ?? []), st.type] }))
  }, [st.bus, st.type])
  useEffect(() => {
    if (Object.values(tried).some((l) => l.length === FAULT_TYPES.length)) completeActivity(MODULE, 'faults')
  }, [tried])
  const triedHere = tried[st.bus]?.length ?? 0
  const worst = FAULT_TYPES.reduce((a, t) => (all[t].faultKa > all[a].faultKa ? t : a), '3ph' as FaultType)
  const set = (p: Partial<FaultState>) => setSt({ ...st, ...p })
  const setSetup = (p: Partial<Setup>) => setSt({ ...st, setup: { ...st.setup, ...p } })
  const kv = m.kv[r.bus]
  const v = r.point.vabc
  const i = r.point.iabc
  const tutor = () =>
    `Explore — fault study. ${FAULT_LABEL[st.type]} fault (${FAULT_PHASES[st.type]}) at ${BUS_SHORT[st.bus]}, R_f = ${st.rfOhm} Ω. Earthing: generator ${st.setup.genEarth}${st.setup.genEarth === 'reactor' ? ` X_n ${st.setup.xnPu} pu` : ''}, T1 HV ${st.setup.t1Hv}, T3 LV ${st.setup.t3Lv}, 33 kV earthing transformer ${st.setup.et33 ? `yes, R_n ${st.setup.rnOhm} Ω` : 'no'}. Z1 ${zText(r.z1)}, Z2 ${zText(r.z2)}, Z0 ${zText(r.z0)} pu. Phase currents ${r.iabcKa.map((x) => fx(x, 3)).join(', ')} kA; phase voltages at the fault ${v.map((x) => fx(abs(x), 3)).join(', ')} pu. All four types here: ${FAULT_TYPES.map((t) => `${t} ${fx(all[t].faultKa, 3)} kA`).join(', ')}.`
  useTutorContext(tutor)
  const phaseColors = ['var(--ps-a)', 'var(--ps-b)', 'var(--ps-c)']
  const iPh: Phasor[] = i.map((x, k) => ({ id: `i${k}`, label: `I${'abc'[k]}`, re: x.re, im: x.im, color: phaseColors[k] })).filter((p) => Math.hypot(p.re, p.im) > 1e-6)
  const vPh: Phasor[] = v.map((x, k) => ({ id: `v${k}`, label: `V${'abc'[k]}`, re: x.re, im: x.im, color: phaseColors[k] })).filter((p) => Math.hypot(p.re, p.im) > 1e-6)
  const zeroI = 'abc'.split('').filter((_, k) => abs(i[k]) <= 1e-6)
  const zeroV = 'abc'.split('').filter((_, k) => abs(v[k]) <= 1e-6)
  const items: ReadoutItem[] = r.dead
    ? [{ label: 'Fault current', value: '0', unit: 'kA', note: 'no source can feed this bus', tone: 'warn' }]
    : [
        { label: 'Fault current', value: fx(r.faultKa, 3), unit: 'kA', note: `largest phase · ${fx(r.faultKa / r.iBaseKa, 3)} pu` },
        ...(['a', 'b', 'c'] as const).map((p, k) => ({ label: `I${p}`, value: fx(r.iabcKa[k], 3), unit: 'kA', note: abs(i[k]) > 1e-9 ? `∠ ${fx(deg(arg(i[k])), 1)}°` : 'no current' })),
        { label: 'Fault level here', value: fx(r.levelMva, 0), unit: 'MVA', note: 'three-phase, bolted' },
      ]
  const changedSetup = !sameSetup(st.setup, st0.setup)
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <span className="small muted" id="ps-ft-where">
            Fault at
          </span>
          <Seg label="Fault location" value={st.bus} onChange={(b) => set({ bus: b })} options={BUS_ORDER.map((id) => ({ id, label: BUS_SHORT[id] }))} />
        </div>
      </div>
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg label="Fault type" value={st.type} onChange={(t) => set({ type: t })} options={FAULT_TYPES.map((t) => ({ id: t, label: FAULT_LABEL[t] }))} />
          <span className="small muted">{FAULT_PHASES[st.type]}</span>
        </div>
        <span className="small muted">Click a bus to move the fault · 1.0 pu pre-fault, loads neglected</span>
      </div>
      <FaultDiagram net={net} result={r} tags={tagsFor(st.setup)} onPick={(b) => set({ bus: b })} label={`Network during a ${FAULT_LABEL[st.type].toLowerCase()} fault at ${BUS_SHORT[st.bus]}`} />
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <Readouts label="At the fault" items={items} />
          {!r.dead && r.faultKa < 1e-6 && (
            <Callout tone="warn" title="No earth-fault current">
              <p>
                There is no zero-sequence path at this bus (Z₀ = ∞): no star point in this part of the network is earthed, so current cannot return through earth. The healthy phases rise to{' '}
                {fx(Math.max(...v.map(abs)), 3)} pu. Add the 33 kV earthing transformer, or earth a star point, in “Earthing and windings”.
              </p>
            </Callout>
          )}
          <section className="ps-card" aria-label="Phasors at the fault">
            <div className="ps-toolbar">
              <h3>At the fault point</h3>
              <span className="small muted">
                Z₁ {zText(r.z1)} · Z₂ {zText(r.z2)} · Z₀ {zText(r.z0)} pu · I_base {fx(r.iBaseKa, 3)} kA at {kv} kV
              </span>
            </div>
            <div className="ps-cols-2">
              <Phasors label="Fault currents" phasors={iPh} size={230} unit="pu" />
              <Phasors label="Voltages at the fault" phasors={vPh} size={230} unit="pu" scale={Math.max(1, ...v.map(abs))} />
            </div>
            <p className="small muted">
              Currents flow from the network into the fault.{zeroI.length > 0 && zeroI.length < 3 && ` No current in phase ${zeroI.join(' and ')}.`}
              {zeroV.length > 0 && ` Phase ${zeroV.join(' and ')} at earth potential (0 V).`} Sequence currents I₀, I₁, I₂: {r.point.i012.map((x) => phText(x)).join(' · ')} pu.
            </p>
          </section>
        </div>
        <aside className="ps-stack">
          <section className="ps-card" aria-labelledby="ps-ft-compare">
            <h3 id="ps-ft-compare">Fault types at {BUS_SHORT[st.bus]}</h3>
            <table className="ps-table ps-ft-table">
              <caption className="sr-only">Fault current for each fault type at this bus</caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">kA</th>
                  <th scope="col">vs LLL</th>
                </tr>
              </thead>
              <tbody>
                {FAULT_TYPES.map((t) => (
                  <tr key={t} className={t === st.type ? 'is-changed' : ''}>
                    <td>
                      <button type="button" className="ps-link" onClick={() => set({ type: t })} aria-pressed={t === st.type}>
                        {FAULT_LABEL[t]}
                      </button>
                      {t === worst && all[t].faultKa > 0 && <span className="ps-ft-badge">largest</span>}
                    </td>
                    <td>{fx(all[t].faultKa, 3)}</td>
                    <td>{all['3ph'].faultKa > 0 ? `${fx((all[t].faultKa / all['3ph'].faultKa) * 100, 0)} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              {isDone(progress, MODULE, 'faults') ? '✓ You have compared all four fault types at a bus.' : `${triedHere} of 4 fault types tried at this bus — try all four to complete the activity.`}
            </p>
          </section>
          <section className="ps-card" aria-labelledby="ps-ft-imp">
            <h3 id="ps-ft-imp">Fault impedance</h3>
            <Slider
              label="Fault resistance R_f"
              value={st.rfOhm}
              min={0}
              max={10}
              step={0.1}
              unit="Ω"
              decimals={1}
              onChange={(x) => set({ rfOhm: x })}
              hint={`= ${fx(zf.re, 4)} pu at ${kv} kV (Z_base ${fx((kv * kv) / 100, 2)} Ω). 0 = bolted.`}
            />
          </section>
          <section className="ps-card" aria-labelledby="ps-ft-earth">
            <details className="ps-ft-details" open={changedSetup}>
              <summary id="ps-ft-earth">Earthing and windings{changedSetup ? ' · changed' : ''}</summary>
              <div className="ps-stack ps-ft-earth">
                <div>
                  <p className="small muted">Generator star point</p>
                  <Seg
                    label="Generator earthing"
                    value={st.setup.genEarth}
                    onChange={(g: GenEarth) => setSetup({ genEarth: g })}
                    options={[
                      { id: 'solid', label: 'Solid' },
                      { id: 'reactor', label: 'Reactor' },
                      { id: 'unearthed', label: 'Unearthed' },
                    ]}
                  />
                </div>
                {st.setup.genEarth === 'reactor' && (
                  <Slider
                    label="Neutral reactor X_n"
                    value={st.setup.xnPu}
                    min={0.02}
                    max={0.5}
                    step={0.01}
                    unit="pu"
                    decimals={2}
                    onChange={(x) => setSetup({ xnPu: x })}
                    hint="on the generator’s 120 MVA rating; adds 3·X_n to the zero sequence"
                  />
                )}
                <div className="ps-cols-2">
                  <div>
                    <p className="small muted">T1, 220 kV winding</p>
                    <Seg
                      label="T1 220 kV winding"
                      value={st.setup.t1Hv}
                      onChange={(w) => setSetup({ t1Hv: w })}
                      options={[
                        { id: 'YN', label: 'YN' },
                        { id: 'Y', label: 'Y' },
                      ]}
                    />
                  </div>
                  <div>
                    <p className="small muted">T3, 11 kV winding</p>
                    <Seg
                      label="T3 11 kV winding"
                      value={st.setup.t3Lv}
                      onChange={(w) => setSetup({ t3Lv: w })}
                      options={[
                        { id: 'YN', label: 'yn' },
                        { id: 'Y', label: 'y' },
                      ]}
                    />
                  </div>
                </div>
                <Toggle label="Earthing transformer on the 33 kV grid-substation bus" checked={st.setup.et33} onChange={(x) => setSetup({ et33: x })} />
                {st.setup.et33 && (
                  <Slider
                    label="Its neutral resistor R_n"
                    value={st.setup.rnOhm}
                    min={0}
                    max={40}
                    step={1}
                    unit="Ω"
                    decimals={0}
                    onChange={(x) => setSetup({ rnOhm: x })}
                    hint={`Z₀ = j${ET_X0_OHM} Ω + 3·R_n (zig-zag winding, typical data)`}
                  />
                )}
                <button type="button" className="text-btn" onClick={() => setSt({ ...st, setup: st0.setup })} disabled={!changedSetup}>
                  Reset earthing
                </button>
              </div>
            </details>
          </section>
          <Callout title="Assumptions">
            <p>
              Pre-fault 1.0 pu, no load current; transformer taps at nominal ratio; line charging neglected. Phase values away from the fault include ±30° per Y–d transformer — the vector group’s
              clock number only changes which phase carries which value, not the magnitudes.
            </p>
          </Callout>
        </aside>
      </div>
      <section className="ps-card" aria-label="Sequence networks">
        <div className="ps-toolbar">
          <Seg
            label="Show"
            value={panel}
            onChange={(v) => setPanel(v as Panel)}
            options={[
              { id: 'networks', label: 'Sequence networks' },
              { id: 'connection', label: 'Connection at the fault' },
              { id: 'table', label: 'Every bus and branch' },
            ]}
          />
        </div>
        {panel === 'networks' && (
          <>
            <div className="ps-diagram">
              <SeqNetworks m={m} result={r} short={BUS_SHORT} />
            </div>
            <p className="small muted">Impedances in pu on 100 MVA; the values beside them are this fault’s sequence currents (bright: carrying current). A gap is an open circuit in that sequence.</p>
          </>
        )}
        {panel === 'connection' && (
          <div className="ps-diagram ps-ft-icwrap">
            <Interconnect result={r} />
          </div>
        )}
        {panel === 'table' && <DuringTable m={m} st={st} />}
      </section>
    </div>
  )
}

function DuringTable({ m, st }: { m: SeqModel; st: FaultState }) {
  const r = faultStudy(m, st.bus, st.type, zfPu(m, st.bus, st.rfOhm))
  return (
    <div className="ps-cols-2 ps-ft-tables">
      <div className="table-wrap">
        <table className="ps-table ps-ft-table">
          <caption className="ps-ft-cap">Bus voltages during the fault [pu]</caption>
          <thead>
            <tr>
              <th scope="col">Bus</th>
              <th scope="col">|Va|</th>
              <th scope="col">|Vb|</th>
              <th scope="col">|Vc|</th>
              <th scope="col">|V₁|</th>
            </tr>
          </thead>
          <tbody>
            {r.buses.map((b) => (
              <tr key={b.id}>
                <td>{BUS_SHORT[b.id]}</td>
                {b.vabc.map((x, k) => (
                  <td key={k}>{fx(abs(x), 3)}</td>
                ))}
                <td>{fx(abs(b.v012[1]), 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="ps-table ps-ft-table">
          <caption className="ps-ft-cap">Branch currents, largest phase [kA]</caption>
          <thead>
            <tr>
              <th scope="col">Branch</th>
              <th scope="col">From end</th>
              <th scope="col">To end</th>
              <th scope="col">|I₀| from [pu]</th>
            </tr>
          </thead>
          <tbody>
            {r.branches.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td>{fx(b.kaFrom, 3)}</td>
                <td>{fx(b.kaTo, 3)}</td>
                <td>{fx(abs(b.i012From[0]), 3)}</td>
              </tr>
            ))}
            {r.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td colSpan={2}>{fx(s.ka, 3)}</td>
                <td>{fx(abs(s.i012[0]), 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Symmetrical components ────────────────────────────────────────────────────────────────────────────────────

interface Abc {
  ma: number
  aa: number
  mb: number
  ab: number
  mc: number
  ac: number
}
const fromTrio = (t: Trio): Abc => ({ ma: abs(t[0]), aa: deg(arg(t[0])), mb: abs(t[1]), ab: deg(arg(t[1])), mc: abs(t[2]), ac: deg(arg(t[2])) })
const r1 = (x: number) => Math.round(x * 100) / 100
const rd = (x: number) => Math.round(((x + 540) % 360) - 180)

function presets(): Array<{ id: string; label: string; abc: Abc; note: string }> {
  const m = faultModel()
  const lg = faultStudy(m, 'lv', 'slg').point.vabc
  const ll = faultStudy(m, 'lv', 'll').point.iabc
  const tidy = (a: Abc): Abc => ({ ma: r1(a.ma), aa: rd(a.aa), mb: r1(a.mb), ab: rd(a.ab), mc: r1(a.mc), ac: rd(a.ac) })
  return [
    { id: 'balanced', label: 'Balanced', abc: { ma: 1, aa: 0, mb: 1, ab: -120, mc: 1, ac: 120 }, note: 'A balanced a-b-c set: only a positive sequence.' },
    { id: 'reversed', label: 'Reversed order', abc: { ma: 1, aa: 0, mb: 1, ab: 120, mc: 1, ac: -120 }, note: 'Two phases swapped (a-c-b): only a negative sequence.' },
    { id: 'single', label: 'One phase only', abc: { ma: 1, aa: 0, mb: 0, ab: 0, mc: 0, ac: 0 }, note: 'One phase alone: three equal sequences of one third each.' },
    { id: 'lg', label: 'LG fault voltages', abc: tidy(fromTrio(lg)), note: 'The town’s voltages during a line-to-ground fault on phase a (rounded): V₁ + V₂ + V₀ = V_a = 0.' },
    { id: 'll', label: 'LL fault currents', abc: tidy(fromTrio(ll)), note: 'The fault currents of a line-to-line fault at the town (pu, rounded): I_b = −I_c, no zero sequence.' },
  ]
}

function Components() {
  const PRESETS = useMemo(presets, [])
  const [abc, setAbc] = useState<Abc>(PRESETS[3].abc)
  const [preset, setPreset] = useState<string>('lg')
  const [seen, setSeen] = useState<string[]>(['lg'])
  const progress = usePsProgress()
  const note = PRESETS.find((p) => p.id === preset)?.note
  const choose = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (p) setAbc(p.abc)
    setPreset(id)
    mark(id)
  }
  const mark = (id: string) => setSeen((s) => (s.includes(id) ? s : [...s, id]))
  useEffect(() => {
    if (seen.length >= 3) completeActivity(MODULE, 'components')
  }, [seen])
  const edit = (p: Partial<Abc>) => {
    setAbc({ ...abc, ...p })
    setPreset('custom')
    mark('custom')
  }
  const x: Trio = [polarDeg(abc.ma, abc.aa), polarDeg(abc.mb, abc.ab), polarDeg(abc.mc, abc.ac)]
  const s = toSeq(x)
  const sets = sequenceSets(s)
  const colors = ['var(--ps-a)', 'var(--ps-b)', 'var(--ps-c)']
  const scale = Math.max(1e-6, ...x.map(abs), ...s.map(abs))
  const arrow = (id: string, label: string, z: Complex, color: string, from?: Complex, extra: Partial<Phasor> = {}): Phasor => ({ id, label, re: z.re, im: z.im, color, from, ...extra })
  const recon: Phasor[] = []
  ;(['a', 'b', 'c'] as const).forEach((p, k) => {
    const z0 = sets.zero[k]
    const z1 = sets.pos[k]
    const z2 = sets.neg[k]
    recon.push(arrow(`r0${p}`, '', z0, 'var(--text-3)', undefined, { thin: true }))
    recon.push(arrow(`r1${p}`, '', z1, 'var(--text-2)', z0, { thin: true }))
    recon.push(arrow(`r2${p}`, '', z2, 'var(--text-3)', { re: z0.re + z1.re, im: z0.im + z1.im }, { thin: true, dashed: true }))
    if (abs(x[k]) > 1e-6) recon.push(arrow(`rx${p}`, p, x[k], colors[k]))
  })
  useTutorContext(
    () =>
      `Explore — symmetrical components. Phase set: a ${fx(abc.ma, 2)}∠${fx(abc.aa, 0)}°, b ${fx(abc.mb, 2)}∠${fx(abc.ab, 0)}°, c ${fx(abc.mc, 2)}∠${fx(abc.ac, 0)}°. Components: zero ${phText(s[0])}, positive ${phText(s[1])}, negative ${phText(s[2])}.`,
  )
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="Start from"
          value={preset}
          onChange={choose}
          options={[...PRESETS.map((p) => ({ id: p.id, label: p.label })), ...(preset === 'custom' ? [{ id: 'custom', label: 'Your set' }] : [])]}
        />
        <span className="small muted">{isDone(progress, MODULE, 'components') ? '✓ Activity complete' : `${Math.min(seen.length, 3)} of 3 sets decomposed`}</span>
      </div>
      {note && preset !== 'custom' && <p className="small muted ps-ft-note">{note}</p>}
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <div className="ps-ft-phgrid">
            <PhasorCard title="Your three phasors" note="x_a, x_b, x_c">
              <Phasors label="Phase set" phasors={x.map((z, k) => arrow(`x${k}`, `${'abc'[k]}`, z, colors[k])).filter((q) => Math.hypot(q.re, q.im) > 1e-6)} size={230} scale={scale} />
            </PhasorCard>
            <PhasorCard title="Positive sequence" note={`x₁ = ${phText(s[1])}`}>
              <Phasors
                label="Positive-sequence set"
                phasors={sets.pos.map((z, k) => arrow(`p${k}`, `${'abc'[k]}₁`, z, colors[k])).filter((q) => Math.hypot(q.re, q.im) > 1e-6)}
                size={230}
                scale={scale}
              />
            </PhasorCard>
            <PhasorCard title="Negative sequence" note={`x₂ = ${phText(s[2])}`}>
              <Phasors
                label="Negative-sequence set"
                phasors={sets.neg.map((z, k) => arrow(`n${k}`, `${'abc'[k]}₂`, z, colors[k])).filter((q) => Math.hypot(q.re, q.im) > 1e-6)}
                size={230}
                scale={scale}
              />
            </PhasorCard>
            <PhasorCard title="Zero sequence" note={`x₀ = ${phText(s[0])}, the same in a, b and c`}>
              <Phasors label="Zero-sequence set" phasors={abs(s[0]) > 1e-6 ? [arrow('z', 'x₀', s[0], 'var(--text-1)')] : []} size={230} scale={scale} />
            </PhasorCard>
          </div>
          <section className="ps-card">
            <h3>Put them back together, tip to tail</h3>
            <div className="ps-ft-recon">
              <Phasors label="Each phase rebuilt as x₀ + x₁ + x₂, tip to tail" phasors={recon} size={300} scale={scale} />
              <div>
                <Eq
                  expr={'x_a = x₀ + x₁ + x₂\nx_b = x₀ + a²·x₁ + a·x₂\nx_c = x₀ + a·x₁ + a²·x₂'}
                  where={[
                    ['a', '1∠120°: rotates a phasor by 120°'],
                    ['x₀', '(x_a + x_b + x_c) / 3'],
                    ['x₁', '(x_a + a·x_b + a²·x_c) / 3'],
                    ['x₂', '(x_a + a²·x_b + a·x_c) / 3'],
                  ]}
                />
                <p className="small muted">Thin grey arrows: x₀ then x₁ (solid) then x₂ (dashed), drawn from the end of the previous one. They end exactly at the tip of each coloured phasor.</p>
              </div>
            </div>
          </section>
        </div>
        <aside className="ps-card ps-stack" aria-label="The three phasors">
          <h3>Set the three phasors</h3>
          {(['a', 'b', 'c'] as const).map((p) => (
            <div key={p} className="ps-ft-phasorctl">
              <p className={`ps-ft-phname ps-ft-ph--${p}`}>Phase {p}</p>
              <Slider label="Magnitude" value={abc[`m${p}`]} min={0} max={2} step={0.01} decimals={2} onChange={(v) => edit({ [`m${p}`]: v } as Partial<Abc>)} />
              <Slider label="Angle" value={abc[`a${p}`]} min={-180} max={180} step={1} unit="°" decimals={0} onChange={(v) => edit({ [`a${p}`]: v } as Partial<Abc>)} />
            </div>
          ))}
          <Readouts
            items={[
              { label: 'Zero |x₀|', value: fx(abs(s[0]), 3) },
              { label: 'Positive |x₁|', value: fx(abs(s[1]), 3) },
              { label: 'Negative |x₂|', value: fx(abs(s[2]), 3) },
              { label: 'Unbalance |x₂|/|x₁|', value: abs(s[1]) > 1e-9 ? fx((abs(s[2]) / abs(s[1])) * 100, 1) : '—', unit: '%' },
            ]}
          />
        </aside>
      </div>
    </div>
  )
}

function PhasorCard({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="ps-ft-phcard" aria-label={title}>
      <p className="ps-ft-phtitle">{title}</p>
      {children}
      <p className="small muted ps-ft-phnote">{note}</p>
    </section>
  )
}

// ── Protection ────────────────────────────────────────────────────────────────────────────────────────────────

const RELAY_COLORS = { down: 'var(--ps-c)', up: 'var(--ps-b)' }

/** The two relays' curves (R2 referred to 11 kV), the operating points of the chosen fault. */
export function ProtectionPlot({ m, prot }: { m: SeqModel; prot: ProtState }) {
  const k = referRatio(m)
  const c = relayCurrents(m, prot.loc, prot.type)
  const tD = tripTime(prot.down.curve, prot.down.tms, prot.down.isA, c.downA)
  const tU = tripTime(prot.up.curve, prot.up.tms, prot.up.isA, c.upA)
  const marks: LogMark[] = []
  if (Number.isFinite(tD)) marks.push({ x: c.downA, y: tD, label: `R1 ${fx(tD, 2)} s`, color: RELAY_COLORS.down, below: true, left: true })
  if (Number.isFinite(tU)) marks.push({ x: c.upA * k, y: tU, label: `R2 ${fx(tU, 2)} s`, color: RELAY_COLORS.up, left: true })
  return (
    <LogPlot
      label={`Time–current curves: R1 (town feeder, 11 kV) and R2 (33 kV line, referred to 11 kV), with the operating points of a ${FAULT_LABEL[prot.type].toLowerCase()} fault`}
      series={[
        { id: 'R1', label: `R1 · CB4 · ${CURVES[prot.down.curve].name} · I_s ${prot.down.isA} A · TMS ${fx(prot.down.tms, 2)}`, color: RELAY_COLORS.down, points: curvePoints(prot.down) },
        { id: 'R2', label: `R2 · CB2 · ${CURVES[prot.up.curve].name} · I_s ${prot.up.isA} A (33 kV) · TMS ${fx(prot.up.tms, 2)}`, color: RELAY_COLORS.up, points: curvePoints(prot.up, k) },
      ]}
      marks={marks}
      vlines={c.downA > 0 ? [{ x: c.downA, label: `fault: ${sg(c.downA / 1000, 3)} kA` }] : c.upA > 0 ? [{ x: c.upA * k, label: `fault: ${sg(c.upA, 3)} A at 33 kV` }] : []}
      xDomain={[300, 30000]}
      yDomain={[0.01, 100]}
      xLabel="Current referred to 11 kV [A]  (33 kV currents × 33/11)"
      yLabel="Operating time [s]"
      xUnit="A"
    />
  )
}

function Protection({ prot, setProt, prot0 }: { prot: ProtState; setProt(p: ProtState): void; prot0: ProtState }) {
  const m = useMemo(() => faultModel(), [])
  const k = referRatio(m)
  const progress = usePsProgress()
  const c = relayCurrents(m, prot.loc, prot.type)
  const g = grade(prot.down, prot.up, c.downA, c.upA)
  const byType = FAULT_TYPES.map((t) => {
    const cc = relayCurrents(m, 'feeder', t)
    return { t, ...cc, g: grade(prot.down, prot.up, cc.downA, cc.upA) }
  })
  const allOk = byType.every((x) => x.g.ok)
  const need = tmsToGrade(m, prot.down, prot.up)
  useEffect(() => {
    if (allOk) completeActivity(MODULE, 'protection')
  }, [allOk])
  const loc = PROT_LOCATIONS.find((x) => x.id === prot.loc)!
  const first = !Number.isFinite(g.tDown) && !Number.isFinite(g.tUp) ? null : g.tDown <= g.tUp ? prot.down : prot.up
  const setRelay = (which: 'down' | 'up', p: Partial<Relay>) => setProt({ ...prot, [which]: { ...prot[which], ...p } })
  const duties = BREAKERS.map((b) => ({ ...b, ...breakerDuty(m, b.at) }))
  useTutorContext(
    () =>
      `Explore — protection. R1 (CB4, 11 kV): ${prot.down.curve}, I_s ${prot.down.isA} A, TMS ${prot.down.tms}. R2 (CB2, 33 kV): ${prot.up.curve}, I_s ${prot.up.isA} A, TMS ${prot.up.tms}. Fault: ${FAULT_LABEL[prot.type]} ${loc.text}. R1 sees ${fx(c.downA, 0)} A → ${Number.isFinite(g.tDown) ? fx(g.tDown, 3) + ' s' : 'no trip'}; R2 sees ${fx(c.upA, 0)} A (33 kV) → ${Number.isFinite(g.tUp) ? fx(g.tUp, 3) + ' s' : 'no trip'}. Grading on the feeder for every fault type: ${byType.map((x) => `${x.t} margin ${fx(x.g.margin, 3)} s`).join(', ')}. TMS of R2 needed for ${GRADING_MARGIN} s: ${need}.`,
  )
  const relayCard = (which: 'down' | 'up') => {
    const r = prot[which]
    return (
      <section className="ps-card" aria-label={`Relay ${r.id}`}>
        <h3>
          <span className="ps-ft-dot" style={{ background: RELAY_COLORS[which] }} aria-hidden="true" />
          {r.id} on {r.breaker} · {which === 'down' ? 'town feeder, 11 kV' : '33 kV line L2'}
        </h3>
        <Seg
          label={`${r.id} curve`}
          value={r.curve}
          onChange={(cv: CurveId) => setRelay(which, { curve: cv })}
          options={(Object.keys(CURVES) as CurveId[]).map((id) => ({ id, label: CURVES[id].name }))}
        />
        <Slider
          label="Pick-up current I_s"
          value={r.isA}
          min={which === 'down' ? 600 : 200}
          max={which === 'down' ? 2000 : 800}
          step={which === 'down' ? 50 : 20}
          unit="A"
          decimals={0}
          onChange={(v) => setRelay(which, { isA: v })}
          hint={which === 'down' ? 'above the town’s load current' : `= ${fx(r.isA * k, 0)} A referred to 11 kV`}
        />
        <Slider label="Time multiplier TMS" value={r.tms} min={0.05} max={1} step={0.01} decimals={2} onChange={(v) => setRelay(which, { tms: v })} />
      </section>
    )
  }
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <span className="small muted">Fault</span>
          <Seg label="Fault location" value={prot.loc} onChange={(l: ProtLocation) => setProt({ ...prot, loc: l })} options={PROT_LOCATIONS.map((x) => ({ id: x.id, label: x.label }))} />
          <Seg label="Fault type" value={prot.type} onChange={(t: FaultType) => setProt({ ...prot, type: t })} options={FAULT_TYPES.map((t) => ({ id: t, label: FAULT_LABEL[t] }))} />
        </div>
      </div>
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <ProtectionPlot m={m} prot={prot} />
          <Readouts
            label="Relay response"
            items={[
              {
                label: 'R1 sees (11 kV)',
                value: fx(c.downA, 0),
                unit: 'A',
                note: Number.isFinite(g.tDown) ? `trips CB4 in ${fx(g.tDown, 3)} s` : c.downA > 0 ? 'below pick-up: no trip' : 'outside its zone',
              },
              { label: 'R2 sees (33 kV)', value: fx(c.upA, 0), unit: 'A', note: Number.isFinite(g.tUp) ? `trips CB2 in ${fx(g.tUp, 3)} s` : c.upA > 0 ? 'below pick-up: no trip' : 'no current' },
              first
                ? {
                    label: 'Trips first',
                    value: first.breaker,
                    note: first === prot.down ? 'the nearest breaker — only the feeder is lost' : 'CB2 — the whole town is disconnected',
                    tone: prot.loc === 'feeder' && first !== prot.down ? 'bad' : 'good',
                  }
                : { label: 'Trips first', value: 'none', note: 'no relay operates', tone: 'warn' },
              Number.isFinite(g.tDown) && Number.isFinite(g.tUp)
                ? { label: 'Grading margin', value: fx(g.margin, 3), unit: 's', note: g.ok ? `≥ ${GRADING_MARGIN} s` : `less than ${GRADING_MARGIN} s`, tone: g.ok ? 'good' : 'bad' }
                : { label: 'Grading margin', value: '—', note: 'only one relay operates' },
            ]}
          />
          {c.result.faultKa < 1e-6 && (
            <Callout tone="warn" title="Nothing to detect">
              <p>
                An earth fault on the unearthed 33 kV system draws no current: overcurrent relays cannot see it. It is detected by the neutral-voltage displacement it causes, or after earthing the
                system.
              </p>
            </Callout>
          )}
          <section className="ps-card" aria-labelledby="ps-ft-grade">
            <h3 id="ps-ft-grade">Grading check: every fault type on the town feeder</h3>
            <table className="ps-table ps-ft-table">
              <caption className="sr-only">Operating times and grading margin for each fault type on the feeder</caption>
              <thead>
                <tr>
                  <th scope="col">Fault</th>
                  <th scope="col">R1 current</th>
                  <th scope="col">R1 time</th>
                  <th scope="col">R2 current (33 kV)</th>
                  <th scope="col">R2 time</th>
                  <th scope="col">Margin</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((x) => (
                  <tr key={x.t}>
                    <td>{FAULT_LABEL[x.t]}</td>
                    <td>{fx(x.downA, 0)} A</td>
                    <td>{Number.isFinite(x.g.tDown) ? `${fx(x.g.tDown, 3)} s` : 'no trip'}</td>
                    <td>{fx(x.upA, 0)} A</td>
                    <td>{Number.isFinite(x.g.tUp) ? `${fx(x.g.tUp, 3)} s` : 'no trip'}</td>
                    <td className={x.g.ok ? 'ps-ft-ok' : 'ps-ft-bad'}>
                      {Number.isFinite(x.g.margin) ? `${fx(x.g.margin, 3)} s` : '—'} {x.g.ok ? '✓' : '✗'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              {isDone(progress, MODULE, 'protection') || allOk
                ? `✓ R2 grades with R1 for every fault type (margin ≥ ${GRADING_MARGIN} s).`
                : `Task: set R2 so it waits at least ${GRADING_MARGIN} s longer than R1 for every fault type on the feeder — a margin for the breaker’s opening time, relay overshoot and errors.`}
            </p>
            <details className="ps-more">
              <summary>Show the TMS that grades</summary>
              <p>
                With R1 as set, R2 ({CURVES[prot.up.curve].name}, I_s {prot.up.isA} A) needs TMS ≥ <b>{fx(need, 2)}</b> — set by the{' '}
                {FAULT_LABEL[byType.reduce((a, b) => (b.g.margin < a.g.margin ? b : a)).t].toLowerCase()} fault, which leaves the smallest margin. A line-to-line fault behind the Dyn transformer puts
                2/√3 of the referred current in one 33 kV phase, so R2 runs relatively faster for it.
              </p>
            </details>
          </section>
        </div>
        <aside className="ps-stack">
          {relayCard('down')}
          {relayCard('up')}
          <button type="button" className="text-btn" onClick={() => setProt({ ...prot0, loc: prot.loc, type: prot.type })}>
            Reset relay settings
          </button>
          <section className="ps-card" aria-labelledby="ps-ft-duty">
            <h3 id="ps-ft-duty">Breaker duty</h3>
            <table className="ps-table ps-ft-table">
              <caption className="sr-only">Worst fault current against each breaker’s rating</caption>
              <thead>
                <tr>
                  <th scope="col">Breaker</th>
                  <th scope="col">Worst fault</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Duty</th>
                </tr>
              </thead>
              <tbody>
                {duties.map((d) => (
                  <tr key={d.id}>
                    <td title={d.what}>
                      {d.id} <span className="muted small">{d.kv} kV</span>
                    </td>
                    <td>
                      {fx(d.ka, 2)} kA <span className="muted small">{FAULT_SHORT[d.type]}</span>
                    </td>
                    <td>{d.ratingKa} kA</td>
                    <td className={d.ka > d.ratingKa ? 'ps-ft-bad' : ''}>{fx((d.ka / d.ratingKa) * 100, 0)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">A fault just beyond a breaker sends the whole fault current at its bus through it. Ratings are typical IEC values (equipment data).</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
