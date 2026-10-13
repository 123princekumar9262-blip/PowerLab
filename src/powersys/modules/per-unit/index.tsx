import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { branchPu, iBaseKa, zBaseOhm } from '../../network/perunit.ts'
import { solveNetwork } from '../../network/solve.ts'
import type { Network, Transformer } from '../../network/types.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { cx, fx, sg } from '../../ui/format.ts'
import { Calc, Callout, Eq, LevelLegend, Predict, Quiz, Readouts, Seg, Slider, Stepper, Toggle, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { gridNetwork } from '../grid/network.ts'
import {
  buildModel,
  busOf,
  compOf,
  faultOhms,
  faultPerUnit,
  genRatedKv,
  networkBase,
  rebased,
  relDiff,
  transformerSides,
  zBase,
  type BaseChoice,
  type FaultPuResult,
  type FaultResult,
  type Model,
} from './calc.ts'
import { EXPERIMENTS, runExperiment, type Experiment } from './experiments.ts'
import { PuDiagram, zoneKey, type DiagramValues } from './PuDiagram.tsx'
import { baseSteps, conversion, ELEMENT_ORDER, LOAD_IDS, nameplate, num } from './steps.ts'
import './per-unit.css'

/*
 * Module 3 — Per-Unit System. The Grid Explorer network (four voltage levels) expressed on one base. Every number on
 * this page is computed by calc.ts; the impedance diagram is checked element by element against the shared engine's
 * branchPu. Learn: why per unit, bases, zones, base change, transformers, taps. Explore: choose the bases; build the
 * impedance diagram step by step. Experiment: predict, change one base, compare. Verify: per unit against ohms,
 * by hand. Practise: questions.
 */

const MODULE = 'per-unit'
type ExploreView = 'bases' | 'diagram'
const FAULT_BUSES = [
  { id: 'hvB', label: '220 kV, end of L1' },
  { id: 'mvA', label: '33 kV, grid s/s' },
  { id: 'mvB', label: '33 kV, distribution s/s' },
  { id: 'lv', label: '11 kV, town' },
] as const
type FaultBus = (typeof FAULT_BUSES)[number]['id']
const BASE_B: BaseChoice = { sMva: 250, refBus: 'hvA', vRefKv: 230, follow: 'nominal' }
const ASSUME_FAULT =
  'balanced bolted three-phase fault; reactances only (resistances neglected); no-load before the fault (loads and line charging neglected); generator EMF 1.0 × its rated 13.8 kV behind x″d'

const mag = (z: { re: number; im: number }) => Math.hypot(z.re, z.im)
const transformers = (net: Network) => net.components.filter((c): c is Transformer => c.kind === 'transformer')
const baseLabel = (net: Network, c: BaseChoice) =>
  `${num(c.sMva)} MVA, ${num(c.vRefKv)} kV in the ${num(busOf(net, c.refBus).kv)} kV zone${c.follow === 'rated' ? ' (bases follow the rated ratios)' : ''}`
const elementName = (net: Network, id: string) => net.components.find((c) => c.id === id)?.name ?? id

export default function PerUnitModule({ mode, setMode }: ModuleProps) {
  const net = useMemo(() => gridNetwork(), [])
  const base0 = useMemo(() => networkBase(net), [net])
  const [choice, setChoice] = useState<BaseChoice>(base0)
  const [view, setView] = useState<ExploreView>('bases')
  return (
    <div className="ps-pu">
      {mode === 'learn' && (
        <Learn
          net={net}
          onBuild={() => {
            setView('diagram')
            setMode('explore')
          }}
        />
      )}
      {mode === 'explore' && <Explore net={net} base0={base0} choice={choice} setChoice={setChoice} view={view} setView={setView} />}
      {mode === 'experiment' && <Experiments net={net} />}
      {mode === 'verify' && <Verify net={net} />}
      {mode === 'practise' && <Practise net={net} />}
    </div>
  )
}

// ── shared pieces ──────────────────────────────────────────────────────────────────────────────────────────────

function ZoneTable({ net, model, caption }: { net: Network; model: Model; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="ps-table ps-pu-zones">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Zone</th>
            <th scope="col">V_base</th>
            <th scope="col">Z_base = V²/S</th>
            <th scope="col">I_base = S/(√3·V)</th>
            <th scope="col">Nominal voltage</th>
          </tr>
        </thead>
        <tbody>
          {model.zones.map((z) => (
            <tr key={z.id} className={z.buses.includes(model.choice.refBus) ? 'is-changed' : ''}>
              <td>
                <span className={`ps-swatch ps-pu-sw ps-lv--${levelKey(z.nominalKv)}`} aria-hidden="true" /> {num(z.nominalKv)} kV{' '}
                <span className="muted small">
                  · {z.buses.map((b) => busOf(net, b).name).join(', ')}
                  {z.buses.includes(model.choice.refBus) ? ' · reference' : ''}
                </span>
              </td>
              <td>{num(z.vBaseKv)} kV</td>
              <td>{fx(z.zBaseOhm, z.zBaseOhm < 10 ? 4 : 2)} Ω</td>
              <td>{fx(z.iBaseKa, 4)} kA</td>
              <td>{fx(z.nominalKv / z.vBaseKv, 4)} pu</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const levelKey = (kv: number) => (kv >= 100 ? 'ehv' : kv >= 20 ? 'hv' : kv >= 1 ? 'mv' : 'lv')

function Figure({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <figure className="ps-diagram ps-pu-figure">
      {children}
      {note && <figcaption className="ps-pu-figcap">{note}</figcaption>}
    </figure>
  )
}

// ── Learn ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Learn({ net, onBuild }: { net: Network; onBuild(): void }) {
  const [step, setStep] = useState(0)
  const A = useMemo(() => networkBase(net), [net])
  const m = useMemo(() => buildModel(net, A), [net, A])
  const sol = useMemo(() => solveNetwork(net), [net])
  const T1 = compOf(net, 'T1', 'transformer')
  const T2 = compOf(net, 'T2', 'transformer')
  const T3 = compOf(net, 'T3', 'transformer')
  const G1 = compOf(net, 'G1', 'generator')
  const s1 = transformerSides(T1, A.sMva, m.vb)
  const n1sq = (T1.kvFrom / T1.kvTo) ** 2
  const fault = faultPerUnit(net, 'lv', A)
  const hvOhms = transformers(net).map((t) => ({ t, ohm: mag(transformerSides(t, A.sMva, m.vb).from.ohm) }))
  const zHv = m.zones.find((z) => z.buses.includes('hvA'))!
  const steps: Array<{ title: string; values: DiagramValues; focus: string[]; body: ReactNode }> = [
    {
      title: 'Four voltage levels, four kinds of ohms',
      values: 'ohm',
      focus: ['G1', 'T1', 'L1'],
      body: (
        <>
          <p>
            This is the Grid Explorer network drawn as a chain: a 13.8 kV generator, a 220 kV line, then 33 kV and 11 kV. In ohms every value depends on the voltage it is referred to — T1’s reactance
            is <b>{sg(s1.to.ohm.im, 3)} Ω</b> seen from its 13.8 kV winding and <b>{sg(s1.from.ohm.im, 3)} Ω</b> from its 220 kV winding. Same transformer.
          </p>
          <p>
            To add the generator’s {sg(m.gen.G1.xOhm, 3)} Ω to the line’s {sg(m.line.L1.zOhm.im, 3)} Ω you must first refer one of them through T1’s turns ratio squared, (220/13.8)² = {fx(n1sq, 1)}:{' '}
            {sg(m.gen.G1.xOhm, 3)} Ω becomes {sg(m.gen.G1.xOhm * n1sq, 3)} Ω at 220 kV. With four voltage levels that bookkeeping is where the mistakes happen.
          </p>
        </>
      ),
    },
    {
      title: 'Per unit: a fraction of a chosen base',
      values: 'ohm',
      focus: ['T1', 'T2', 'T3'],
      body: (
        <>
          <Eq expr="value in per unit = actual value / base value" where={[['base value', 'a chosen reference in the same unit (kV, kA, Ω, MVA)']]} />
          <p>
            The load flow puts the town’s bus at <b>{fx(sol.bus.lv.kv, 2)} kV</b>. On an 11 kV base that is {fx(sol.bus.lv.vPu, 3)} pu — {fx((sol.bus.lv.vPu - 1) * 100, 1)} % high, readable at a
            glance without remembering what the nominal was.
          </p>
          <p>
            Equipment becomes comparable too. On their own ratings the three transformers are{' '}
            {hvOhms.map(({ t }, k) => (
              <span key={t.id}>
                {k > 0 && (k === hvOhms.length - 1 ? ' and ' : ', ')}
                {t.id} <b>{num(t.zPct)} %</b> ({num(t.ratedMva)} MVA)
              </span>
            ))}
            . In ohms from their high-voltage windings they are {hvOhms.map(({ t, ohm }) => `${t.id} ${sg(ohm, 3)} Ω`).join(', ')} — numbers that say nothing about how stiff each one is. A 10 %
            transformer is 10 % whatever its rating.
          </p>
        </>
      ),
    },
    {
      title: 'Choose two bases; the rest follow',
      values: 'pu',
      focus: [zoneKey('hvA')],
      body: (
        <>
          <p>
            Choose <b>S_base</b> once, for the whole system — {num(A.sMva)} MVA here — and <b>V_base</b> in one zone: {num(A.vRefKv)} kV in the transmission zone. The base current and base impedance
            follow:
          </p>
          <Eq
            expr={`Z_base = V_base² / S_base = ${num(zHv.vBaseKv)}² / ${num(A.sMva)} = ${fx(zHv.zBaseOhm, 1)} Ω\nI_base = S_base / (√3 · V_base) = ${num(A.sMva)} / (√3 × ${num(zHv.vBaseKv)}) = ${fx(zHv.iBaseKa, 4)} kA`}
            where={[
              ['S_base', 'three-phase base power, the same everywhere', 'MVA'],
              ['V_base', 'line-to-line base voltage of the zone', 'kV'],
            ]}
            assume="balanced three-phase; per-phase impedances; S three-phase and V line-to-line, so S = √3·V·I"
          />
        </>
      ),
    },
    {
      title: 'Across a transformer, the base voltage follows its ratio',
      values: 'pu',
      focus: m.zones.map((z) => zoneKey(z.buses[0])),
      body: (
        <>
          <p>
            Lines keep the voltage, so buses joined by lines share a zone and a base. Across a transformer V_base changes in the transformer’s ratio — 220/13.8, 220/33, 33/11 kV — so with 220 kV
            chosen, every zone’s base is fixed:
          </p>
          <ZoneTable net={net} model={m} caption="Base quantities of every zone" />
          <p className="small muted">
            S_base is the same in every zone, so a power in per unit means the same everywhere; voltage, current and impedance bases differ from zone to zone. Here each zone’s base is its nominal
            voltage, so nominal voltages read exactly 1 pu.
          </p>
        </>
      ),
    },
    {
      title: 'In per unit, the transformer’s ratio disappears',
      values: 'pu',
      focus: ['T1'],
      body: (
        <>
          <Calc
            title="T1’s reactance from either side, each on its own side’s base"
            steps={[
              { label: `${num(T1.kvFrom)} kV side`, expr: `${fx(s1.from.ohm.im, 3)} Ω / ${fx(s1.from.zBaseOhm, 1)} Ω`, result: `${fx(s1.from.pu.im, 4)} pu` },
              { label: `${num(T1.kvTo)} kV side`, expr: `${fx(s1.to.ohm.im, 5)} Ω / ${fx(s1.to.zBaseOhm, 4)} Ω`, result: `${fx(s1.to.pu.im, 4)} pu` },
            ]}
            check={{ ok: relDiff(s1.from.pu.im, s1.to.pu.im) < 1e-9, text: 'The same per-unit value from both sides.' }}
          />
          <p>
            Referring through a transformer multiplies ohms by the ratio squared ({fx(n1sq, 1)}) — and the base impedances differ by the same factor, because the base voltages are in the same ratio.
            It cancels: in per unit T1 is just a series impedance, j{fx(m.tx.T1.z.im, 4)} pu, with no ideal transformer in the diagram.
          </p>
        </>
      ),
    },
    {
      title: 'Nameplates: change of base',
      values: 'pu',
      focus: ['G1', 'T3'],
      body: (
        <>
          <Eq
            expr="Z_new = Z_old · (S_new / S_old) · (V_old / V_new)²"
            where={[
              ['Z_old', 'per-unit value on the equipment’s own rating (nameplate)', 'pu'],
              ['S_old, V_old', 'its rated power and the rated voltage of the winding it is referred to', 'MVA, kV'],
              ['S_new, V_new', 'the system base and that zone’s V_base', 'MVA, kV'],
            ]}
            assume="the same physical ohms, expressed on another base"
          />
          <p>
            T3: {num(T3.zPct)} % on {num(T3.ratedMva)} MVA → {fx(T3.zPct / 100, 2)} × ({num(A.sMva)}/{num(T3.ratedMva)}) × ({num(T3.kvTo)}/{num(m.vb[T3.to])})² = <b>{fx(mag(m.tx.T3.z), 4)} pu</b>. G1:{' '}
            {fx(G1.x1Pu ?? 0, 2)} on {num(G1.ratedMva)} MVA → {fx(G1.x1Pu ?? 0, 2)} × ({num(A.sMva)}/{num(G1.ratedMva)}) = <b>{fx(m.gen.G1.x, 4)} pu</b>.
          </p>
          <p>
            T2 is rated {num(T2.kvFrom)}/{num(T2.kvTo)} kV but sits in the 33 kV zone, so its voltage factor is not 1: {fx(T2.zPct / 100, 2)} × ({num(A.sMva)}/{num(T2.ratedMva)}) × ({num(T2.kvTo)}/
            {num(m.vb[T2.to])})² = <b>{fx(mag(m.tx.T2.z), 4)} pu</b>.
          </p>
        </>
      ),
    },
    {
      title: 'Taps: the ratio that is left over',
      values: 'pu',
      focus: ['T2', 'T3'],
      body: (
        <>
          <p>
            T2’s windings are {num(T2.kvFrom)}/{num(T2.kvTo)} kV but the bases on its two sides are {num(m.vb[T2.from])}/{num(m.vb[T2.to])} kV. The part of its ratio the bases do not absorb is an
            off-nominal ratio t = ({num(T2.kvFrom)}/{num(m.vb[T2.from])}) / ({num(T2.kvTo)}/{num(m.vb[T2.to])}) = <b>{fx(m.tx.T2.tap, 4)}</b>, drawn as a small ideal transformer t : 1. T3 has t ={' '}
            <b>{fx(m.tx.T3.tap, 4)}</b>.
          </p>
          <p className="small muted">
            Keeping V_base at the nominal voltage and carrying taps as t is how network studies (and this course’s load-flow engine) do it. Letting the bases follow the rated ratios would absorb the
            taps instead — the Experiment mode tries it.
          </p>
        </>
      ),
    },
    {
      title: 'One base, one diagram',
      values: 'pu',
      focus: [],
      body: (
        <>
          <p>
            Every element is now a per-unit impedance on the same {num(A.sMva)} MVA base, and the chain can be combined directly. For a bolted fault at the town’s 11 kV bus, the reactances add up
            (taking the two taps into account) to <b>{fx(fault.x, 4)} pu</b> behind a no-load voltage of {fx(fault.e, 4)} pu:
          </p>
          <Readouts
            items={[
              { label: 'Fault current', value: fx(fault.i, 4), unit: 'pu', note: `= ${fx(fault.e, 4)} / ${fx(fault.x, 4)}` },
              { label: 'I_base at 11 kV', value: fx(fault.iBaseKa, 4), unit: 'kA' },
              { label: 'In kiloamperes', value: fx(fault.iKa, 3), unit: 'kA', note: 'per unit × I_base' },
            ]}
          />
          <p className="small muted">Assumes: {ASSUME_FAULT}. Verify mode works the same fault in ohms and gets the same kiloamperes.</p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onBuild}>
            Build the impedance diagram yourself →
          </button>
        </>
      ),
    },
  ]
  const cur = steps[step]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  useTutorContext(
    () =>
      `Learn mode — "Why per unit", step ${step + 1} of ${steps.length}: ${cur.title}. Network: Grid Explorer (13.8 kV generator 120 MVA x″d 0.2; T1 13.8/220 kV 120 MVA 12 %; L1 220 kV 120 km; T2 220/34.65 kV 60 MVA 10 %; L2 33 kV 10 km; T3 31.35/11 kV 20 MVA 8 %). Base: 100 MVA, 220 kV in the transmission zone; zone bases 13.8/220/33/11 kV. Per unit on 100 MVA: G1 j${fx(m.gen.G1.x, 4)}, T1 j${fx(m.tx.T1.z.im, 4)}, L1 ${cx(m.line.L1.z.re, m.line.L1.z.im, 4)}, T2 j${fx(m.tx.T2.z.im, 4)} with t ${fx(m.tx.T2.tap, 4)}, L2 ${cx(m.line.L2.z.re, m.line.L2.z.im, 4)}, T3 j${fx(m.tx.T3.z.im, 4)} with t ${fx(m.tx.T3.tap, 4)}.`,
  )
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <p className="small muted ps-pu-figtitle">{cur.values === 'ohm' ? 'Values in ohms — each referred to the voltage where it sits' : `Values in per unit on ${num(A.sMva)} MVA`}</p>
        <LevelLegend only={['ehv', 'hv', 'mv']} />
      </div>
      <Figure>
        <PuDiagram net={net} model={m} values={cur.values} highlight={cur.focus} label={`The Grid Explorer network in four voltage zones, values in ${cur.values === 'ohm' ? 'ohms' : 'per unit'}`} />
      </Figure>
      <div className="ps-card ps-pu-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

// ── Explore ────────────────────────────────────────────────────────────────────────────────────────────────────

function Explore({
  net,
  base0,
  choice,
  setChoice,
  view,
  setView,
}: {
  net: Network
  base0: BaseChoice
  choice: BaseChoice
  setChoice(c: BaseChoice): void
  view: ExploreView
  setView(v: ExploreView): void
}) {
  const model = useMemo(() => buildModel(net, choice), [net, choice])
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="Tool"
          value={view}
          onChange={setView}
          options={[
            { id: 'bases', label: 'Bases and zones' },
            { id: 'diagram', label: 'Build the impedance diagram' },
          ]}
        />
        <LevelLegend only={['ehv', 'hv', 'mv']} />
      </div>
      {view === 'bases' ? (
        <Bases net={net} base0={base0} choice={choice} setChoice={setChoice} model={model} />
      ) : (
        <DiagramBuild net={net} choice={choice} model={model} onBases={() => setView('bases')} />
      )}
    </div>
  )
}

function Bases({ net, base0, choice, setChoice, model }: { net: Network; base0: BaseChoice; choice: BaseChoice; setChoice(c: BaseChoice): void; model: Model }) {
  const [values, setValues] = useState<DiagramValues>('pu')
  const [tried, setTried] = useState<string[]>([])
  const progress = usePsProgress()
  const mark = (k: string) => {
    if (tried.includes(k)) return
    const next = [...tried, k]
    setTried(next)
    if (next.length >= 3) completeActivity(MODULE, 'bases')
  }
  const refKv = busOf(net, choice.refBus).kv
  const vMin = refKv >= 100 ? Math.round(refKv * 0.8) : Math.round(refKv * 8) / 10
  const vMax = refKv >= 100 ? Math.round(refKv * 1.25) : Math.round(refKv * 12.5) / 10
  const fault = faultPerUnit(net, 'lv', choice)
  const faultO = useMemo(() => faultOhms(net, 'lv'), [net])
  const T1 = compOf(net, 'T1', 'transformer')
  const s1 = transformerSides(T1, choice.sMva, model.vb)
  const zoneOptions = model.zones.map((z) => ({ id: z.buses[0], label: `${num(z.nominalKv)} kV` }))
  const edited = choice !== base0
  const checklist = [
    { id: 's', label: 'Change S_base' },
    { id: 'v', label: 'Change V_base' },
    { id: 'zone', label: 'Move the reference to another zone' },
  ]
  useTutorContext(
    () =>
      `Explore mode — Bases and zones. Chosen base: S_base ${num(choice.sMva)} MVA, V_base ${num(choice.vRefKv)} kV in the ${num(refKv)} kV zone, bases cross transformers by their ${choice.follow} ratios. Zone bases: ${model.zones.map((z) => `${num(z.nominalKv)} kV zone V_base ${num(z.vBaseKv)} kV, Z_base ${fx(z.zBaseOhm, 3)} Ω, I_base ${fx(z.iBaseKa, 4)} kA`).join('; ')}. T1 X ${fx(s1.to.pu.im, 4)} pu (${fx(s1.from.ohm.im, 2)} Ω at 220 kV). Fault at the 11 kV town bus: ${fx(fault.i, 4)} pu × ${fx(fault.iBaseKa, 4)} kA = ${fx(fault.iKa, 4)} kA (ohmic: ${fx(faultO.i, 4)} kA).`,
  )
  return (
    <>
      <div className="ps-toolbar">
        <Seg
          label="Values on the diagram"
          value={values}
          onChange={(v) => setValues(v as DiagramValues)}
          options={[
            { id: 'pu', label: 'Per unit' },
            { id: 'ohm', label: 'Ohms' },
          ]}
        />
        <p className="small muted ps-pu-figtitle">Base: {baseLabel(net, choice)}</p>
      </div>
      <Figure>
        <PuDiagram net={net} model={model} values={values} label={`The network’s voltage zones and their bases: ${baseLabel(net, choice)}`} />
      </Figure>
      <div className="ps-split ps-split--wide-side ps-pu-bases">
        <section className="ps-card" aria-labelledby="ps-pu-choose">
          <h3 id="ps-pu-choose">Choose the bases</h3>
          <div className="ps-cols-2">
            <div>
              <Slider
                label="S_base (whole system)"
                value={choice.sMva}
                min={10}
                max={500}
                step={10}
                unit="MVA"
                onChange={(v) => {
                  setChoice({ ...choice, sMva: v })
                  mark('s')
                }}
                hint="one three-phase base power for every zone"
              />
              <div className="ps-pu-field">
                <span className="ps-slider-label">Reference zone</span>
                <Seg
                  label="Reference zone"
                  value={choice.refBus}
                  onChange={(id) => {
                    if (id === choice.refBus) return
                    // move the reference without changing any base: start from that zone's present base voltage
                    setChoice({ ...choice, refBus: id, vRefKv: model.vb[id] })
                    mark('zone')
                  }}
                  options={zoneOptions}
                />
              </div>
            </div>
            <div>
              <Slider
                label={`V_base in the ${num(refKv)} kV zone`}
                value={choice.vRefKv}
                min={vMin}
                max={vMax}
                step={refKv >= 100 ? 1 : 0.1}
                decimals={refKv >= 100 ? 1 : 2}
                unit="kV"
                onChange={(v) => {
                  setChoice({ ...choice, vRefKv: v })
                  mark('v')
                }}
                hint="the other zones follow through the transformer ratios"
              />
              <div className="ps-pu-field">
                <Toggle
                  label="Let the bases follow the rated ratios (absorbs the taps)"
                  checked={choice.follow === 'rated'}
                  onChange={(on) => setChoice({ ...choice, follow: on ? 'rated' : 'nominal' })}
                />
              </div>
            </div>
          </div>
          <div className="ps-pu-foot">
            <p className="small muted ps-pu-try">
              <span>Try:</span>
              {checklist.map((c) => (
                <span key={c.id} className={tried.includes(c.id) ? 'is-done' : ''}>
                  <span aria-hidden="true">{tried.includes(c.id) ? '✓' : '○'}</span> {c.label}
                  <span className="sr-only">{tried.includes(c.id) ? ' (done)' : ' (not yet)'}</span>
                </span>
              ))}
              {isDone(progress, MODULE, 'bases') && <span className="is-done">· activity complete</span>}
            </p>
            <button type="button" className="text-btn" onClick={() => setChoice(base0)} disabled={!edited}>
              Reset to {num(base0.sMva)} MVA, {num(base0.vRefKv)} kV
            </button>
          </div>
        </section>
        <section className="ps-card" aria-labelledby="ps-pu-changes">
          <h3 id="ps-pu-changes">What changes — and what does not</h3>
          <Readouts
            items={[
              { label: 'T1 reactance', value: fx(s1.to.pu.im, 4), unit: 'pu', note: 'changes with the base' },
              { label: 'T1 in ohms', value: fx(s1.from.ohm.im, 2), unit: 'Ω', note: 'at 220 kV — physical' },
              { label: 'Town fault current', value: fx(fault.i, 4), unit: 'pu', note: 'changes with the base' },
              { label: 'Town fault in kA', value: fx(fault.iKa, 4), unit: 'kA', note: 'never moves', tone: 'good' },
            ]}
          />
          <p className="ps-pu-eqline">
            I_f = E / X = {fx(fault.e, 4)} / {fx(fault.x, 4)} = {fx(fault.i, 4)} pu
            <br />
            I_f · I_base = {fx(fault.i, 4)} × {fx(fault.iBaseKa, 4)} kA = <b>{fx(fault.iKa, 4)} kA</b>
          </p>
          <p className={`ps-check ${relDiff(fault.iKa, faultO.i) < 1e-9 ? 'ps-check--ok' : 'ps-check--bad'}`}>
            {relDiff(fault.iKa, faultO.i) < 1e-9 ? '✓' : '✗'} Worked in ohms through the turns ratios: {fx(faultO.i, 4)} kA.
          </p>
          <details className="ps-pu-assume-d">
            <summary className="small muted">Bolted three-phase fault at the town’s 11 kV bus — assumptions</summary>
            <p className="small muted">{ASSUME_FAULT}.</p>
          </details>
        </section>
      </div>
      <section className="ps-card" aria-labelledby="ps-pu-zones-h">
        <h3 id="ps-pu-zones-h">Every zone on this base</h3>
        <ZoneTable net={net} model={model} caption="Base quantities of every zone on the chosen base" />
      </section>
      <details className="ps-pu-more">
        <summary>Nameplates on this base — the change-of-base formula for each machine</summary>
        <NameplateTable net={net} model={model} />
      </details>
    </>
  )
}

function NameplateTable({ net, model }: { net: Network; model: Model }) {
  const S = model.choice.sMva
  const g = compOf(net, 'G1', 'generator')
  const kvG = genRatedKv(net, g)
  const rows = [
    {
      id: g.id,
      plate: `x″d ${fx(g.x1Pu ?? 0, 2)} pu on ${num(g.ratedMva)} MVA, ${num(kvG)} kV`,
      kS: model.gen[g.id].kS,
      kV: model.gen[g.id].kV,
      vExpr: `(${num(kvG)}/${num(model.vb[g.bus])})²`,
      own: g.x1Pu ?? 0,
      res: model.gen[g.id].x,
    },
    ...transformers(net).map((t) => ({
      id: t.id,
      plate: `${num(t.zPct)} % on ${num(t.ratedMva)} MVA, ${num(t.kvFrom)}/${num(t.kvTo)} kV`,
      kS: model.tx[t.id].kS,
      kV: model.tx[t.id].kV,
      vExpr: `(${num(t.kvTo)}/${num(model.vb[t.to])})²`,
      own: t.zPct / 100,
      res: mag(model.tx[t.id].z),
    })),
  ]
  return (
    <div className="table-wrap">
      <Eq
        expr="Z_new = Z_old · (S_new / S_old) · (V_old / V_new)²"
        assume="transformers referred to their lower-voltage winding; the generator’s rated voltage is taken as its bus’s nominal 13.8 kV"
      />
      <table className="ps-table">
        <caption className="sr-only">Nameplate impedances converted to the chosen base</caption>
        <thead>
          <tr>
            <th scope="col">Element</th>
            <th scope="col">Nameplate</th>
            <th scope="col">× S_new/S_old</th>
            <th scope="col">× (V_old/V_new)²</th>
            <th scope="col">|Z| on this base</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{elementName(net, r.id)}</td>
              <td>{r.plate}</td>
              <td>
                {num(S)}/{num(r.id === 'G1' ? g.ratedMva : compOf(net, r.id, 'transformer').ratedMva)} = {fx(r.kS, 3)}
              </td>
              <td>
                {r.vExpr} = {fx(r.kV, 4)}
              </td>
              <td>{fx(r.res, 4)} pu</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Explore: build the impedance diagram ───────────────────────────────────────────────────────────────────────

function DiagramBuild({ net, choice, model, onBases }: { net: Network; choice: BaseChoice; model: Model; onBases(): void }) {
  const [step, setStep] = useState(0)
  const [detail, setDetail] = useState<'x' | 'z'>('x')
  const progress = usePsProgress()
  const engineNet = useMemo(() => rebased(net, choice), [net, choice])
  const checks = ELEMENT_ORDER.filter((id) => id !== 'G1').map((id) => {
    const cv = conversion(net, choice, id)
    const b = engineNet.components.find((c) => c.id === id)!
    const e = b.kind === 'line' || b.kind === 'transformer' ? branchPu(engineNet, b) : null
    const ok = !!e && relDiff(cv.z!.re, e.z.re) < 1e-12 && relDiff(cv.z!.im, e.z.im) < 1e-12 && relDiff(cv.tap ?? 1, e.tap) < 1e-12 && relDiff(cv.bHalf ?? 0, e.yHalf.im) < 1e-12
    return { id, cv, e, ok }
  })
  const allOk = checks.every((c) => c.ok)
  type BuildStep = { title: string; shown: string[] | null; focus: string[]; body: ReactNode }
  const steps: BuildStep[] = [
    {
      title: 'Start from the bases',
      shown: [],
      focus: model.zones.map((z) => zoneKey(z.buses[0])),
      body: (
        <>
          <p>One S_base for all zones, and one V_base per zone. Every impedance below is divided by the Z_base of the zone it sits in; every power by S_base.</p>
          <Calc title={`Base quantities on ${num(choice.sMva)} MVA`} steps={baseSteps(net, choice)} />
        </>
      ),
    },
    ...ELEMENT_ORDER.map((id, k): BuildStep => {
      const cv = conversion(net, choice, id)
      return {
        title: cv.title,
        shown: ELEMENT_ORDER.slice(0, k + 1) as unknown as string[],
        focus: [id],
        body: (
          <>
            <p>{cv.what}</p>
            <Calc title={`${id} on the system base`} steps={cv.steps} />
          </>
        ),
      }
    }),
    {
      title: 'The loads',
      shown: [...ELEMENT_ORDER, ...LOAD_IDS],
      focus: [...LOAD_IDS],
      body: (
        <>
          <p>Powers in per unit are simply divided by S_base — there is only one, so a load means the same thing in every zone.</p>
          <Calc title="Loads in per unit" steps={LOAD_IDS.flatMap((id) => conversion(net, choice, id).steps.map((s) => ({ ...s, label: elementName(net, id) })))} />
          <p className="small muted">In a fault calculation loads are usually neglected; in a load flow they stay as powers.</p>
        </>
      ),
    },
    {
      title: 'The complete diagram — checked against the engine',
      shown: null,
      focus: [],
      body: (
        <>
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Each conversion compared with the shared engine</caption>
              <thead>
                <tr>
                  <th scope="col">Element</th>
                  <th scope="col">This conversion</th>
                  <th scope="col">Engine branchPu</th>
                  <th scope="col">t</th>
                  <th scope="col">Agree</th>
                </tr>
              </thead>
              <tbody>
                {checks.map(({ id, cv, e, ok }) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{cx(cv.z!.re, cv.z!.im, 5)}</td>
                    <td>{e ? cx(e.z.re, e.z.im, 5) : '—'}</td>
                    <td>{e ? fx(e.tap, 4) : '—'}</td>
                    <td>{ok ? '✓ yes' : '✗ no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`ps-check ${allOk ? 'ps-check--ok' : 'ps-check--bad'}`}>
            {allOk
              ? '✓ Every branch agrees with the shared load-flow engine (network/perunit.ts) to 12 significant digits — including the line charging and the off-nominal ratios.'
              : '✗ A conversion differs from the engine.'}
          </p>
          <p className="small muted">G1’s x″d is not a branch of the load flow; its conversion is checked in Verify. {isDone(progress, MODULE, 'diagram') && '✓ Activity complete.'}</p>
        </>
      ),
    },
  ]
  const cur = steps[step]
  const onFinish = useCallback(() => completeActivity(MODULE, 'diagram'), [])
  useTutorContext(
    () =>
      `Explore mode — Build the impedance diagram, step ${step + 1} of ${steps.length}: ${cur.title}. Base: ${baseLabel(net, choice)}. Per unit: G1 j${fx(model.gen.G1.x, 4)}, ${checks.map((c) => `${c.id} ${cx(c.cv.z!.re, c.cv.z!.im, 4)}${c.cv.tap !== undefined ? ` t ${fx(c.cv.tap, 4)}` : ''}`).join(', ')}. Engine agreement: ${allOk ? 'all branches agree' : 'mismatch'}.`,
  )
  return (
    <>
      <div className="ps-toolbar">
        <Seg
          label="Diagram detail"
          value={detail}
          onChange={(v) => setDetail(v as 'x' | 'z')}
          options={[
            { id: 'x', label: 'Reactance diagram (X)' },
            { id: 'z', label: 'Impedance diagram (R + jX)' },
          ]}
        />
        <p className="small muted ps-pu-figtitle">
          Base: {baseLabel(net, choice)} ·{' '}
          <button type="button" className="ps-link ps-pu-inline" onClick={onBases}>
            change it
          </button>
        </p>
      </div>
      <Figure
        note={
          detail === 'x'
            ? 'Reactance diagram: resistances and line charging are left out (they are small here); values are X in pu.'
            : 'Impedance diagram: R + jX in pu; each line’s charging susceptance is split half to each end (π model), jB/2 per end.'
        }
      >
        <PuDiagram net={net} model={model} values="pu" detail={detail} shown={cur.shown} highlight={cur.focus} label={`Impedance diagram on ${baseLabel(net, choice)}`} />
      </Figure>
      <div className="ps-card ps-pu-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </>
  )
}

// ── Experiment ─────────────────────────────────────────────────────────────────────────────────────────────────

function Experiments({ net }: { net: Network }) {
  const [current, setCurrent] = useState(EXPERIMENTS[0].id)
  const [answered, setAnswered] = useState<Record<string, boolean>>({})
  const progress = usePsProgress()
  const e = EXPERIMENTS.find((x) => x.id === current)!
  const onAnswered = (id: string) => {
    completeActivity(MODULE, `exp-${id}`)
    const done = new Set([...EXPERIMENTS.filter((x) => isDone(progress, MODULE, `exp-${x.id}`)).map((x) => x.id), id])
    if (done.size >= 3) completeActivity(MODULE, 'experiments')
    setAnswered((a) => ({ ...a, [id]: true }))
  }
  return (
    <div className="ps-stack">
      <nav className="ps-pu-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see the computed numbers. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-pu-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-pu-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ps-stack" key={e.id}>
        <ExperimentRun net={net} e={e} answered={!!answered[e.id]} onAnswered={() => onAnswered(e.id)} />
      </div>
    </div>
  )
}

function ExperimentRun({ net, e, answered, onAnswered }: { net: Network; e: Experiment; answered: boolean; onAnswered(): void }) {
  const r = useMemo(() => runExperiment(e, net), [e, net])
  const A = useMemo(() => networkBase(net), [net])
  const m = useMemo(() => buildModel(net, A), [net, A])
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change(net)} Question: ${e.question(net)} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <>
      <div className="ps-pu-exp-run ps-stack">
        <div className="ps-card">
          <p className="eyebrow">Experiment</p>
          <h3>{e.title}</h3>
          <p>{e.change(net)}</p>
        </div>
        <Figure note={`On the network’s own base, ${baseLabel(net, A)}.`}>
          <PuDiagram net={net} model={m} values="pu" highlight={e.focus} label={`Impedance diagram on ${baseLabel(net, A)}, with ${e.focus.join(', ')} highlighted`} />
        </Figure>
        <Predict
          question={e.question(net)}
          options={e.options(net)}
          answer={r.answer}
          onAnswered={onAnswered}
          why={
            <>
              {r.explain.map((p, k) => (
                <p key={k}>{p}</p>
              ))}
            </>
          }
        />
      </div>
      {answered && (
        <div className="ps-card table-wrap">
          <table className="ps-table">
            <caption className="sr-only">Computed comparison: {e.title}</caption>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">{r.columns[0]}</th>
                <th scope="col">{r.columns[1]}</th>
                <th scope="col">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, k) => {
                const [a, b] = row.values
                const changed = relDiff(a, b) > 1e-9
                return (
                  <tr key={k} className={changed ? 'is-changed' : ''}>
                    <td>{row.label}</td>
                    <td>
                      {fx(a, row.decimals)} {row.unit}
                    </td>
                    <td>
                      {fx(b, row.decimals)} {row.unit}
                    </td>
                    <td className={changed ? 'ps-pu-changed' : 'ps-pu-same'}>{changed ? `× ${fx(b / a, 4)}` : 'unchanged'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Verify({ net }: { net: Network }) {
  const [bus, setBus] = useState<FaultBus>('lv')
  const progress = usePsProgress()
  const A = useMemo(() => networkBase(net), [net])
  const B = BASE_B
  const m = useMemo(() => buildModel(net, A), [net, A])
  const T1 = compOf(net, 'T1', 'transformer')
  const T2 = compOf(net, 'T2', 'transformer')
  const L1 = compOf(net, 'L1', 'line')
  const s1 = transformerSides(T1, A.sMva, m.vb)
  const eT1 = branchPu(net, T1)
  const eT2 = branchPu(net, T2)
  const eL1 = branchPu(net, L1)
  const zb = zBase(220, 100)
  const ib = 100 / (Math.sqrt(3) * 220)
  const t2Own = T2.zPct / 100
  const t2New = t2Own * (A.sMva / T2.ratedMva) * (T2.kvTo / m.vb[T2.to]) ** 2
  const t2Tap = T2.kvFrom / m.vb[T2.from] / (T2.kvTo / m.vb[T2.to])
  const l1Ohm = { re: L1.rOhmPerKm * L1.lengthKm, im: L1.xOhmPerKm * L1.lengthKm }
  const fo = faultOhms(net, bus)
  const fa = faultPerUnit(net, bus, A)
  const fb = faultPerUnit(net, bus, B)
  const ok = (a: number, b: number) => relDiff(a, b) < 1e-9
  const quiz: QuizItem[] = [
    {
      id: 'l2',
      kind: 'number',
      q: `Your turn: line L2 is ${num(compOf(net, 'L2', 'line').xOhmPerKm)} Ω/km × ${num(compOf(net, 'L2', 'line').lengthKm)} km of reactance in the ${num(m.vb.mvA)} kV zone. What is its reactance in per unit on ${num(A.sMva)} MVA?`,
      answer: m.line.L2.z.im,
      unit: 'pu',
      tol: 0.002,
      why: `X = ${fx(m.line.L2.zOhm.im, 2)} Ω / (${num(m.vb.mvA)}² / ${num(A.sMva)} = ${fx(m.line.L2.zBaseOhm, 2)} Ω) = ${fx(m.line.L2.z.im, 4)} pu — the engine gives ${fx(branchPu(net, compOf(net, 'L2', 'line')).z.im, 4)} pu.`,
    },
  ]
  useTutorContext(
    () =>
      `Verify mode: hand checks of the per-unit conversions against the shared engine (Z_base 484 Ω, I_base 0.2624 kA at 220 kV/100 MVA; T1 from both sides ${fx(s1.from.pu.im, 4)} pu; T2 base change ${fx(t2New, 5)} pu, t ${fx(t2Tap, 4)}; L1 ${cx(m.line.L1.z.re, m.line.L1.z.im, 4)} pu). Fault at ${bus}: ohms ${fx(fo.i, 4)} kA; per unit on base A ${fx(fa.i, 4)} pu = ${fx(fa.iKa, 4)} kA; on base B (250 MVA, 230 kV) ${fx(fb.i, 4)} pu = ${fx(fb.iKa, 4)} kA.`,
  )
  return (
    <div className="ps-stack ps-pu-verify">
      <Callout title="The numbers on this page come from calc.ts and the shared engine">
        <p>Here you check them independently: by hand from the definitions, and by working the same problem in ohms and in per unit. {isDone(progress, MODULE, 'verify') && '✓ Done.'}</p>
      </Callout>
      <Calc
        title="1 · Base quantities at 220 kV and 100 MVA"
        steps={[
          { label: 'Base impedance', expr: 'Z_base = 220² / 100', result: `${fx(zb, 4)} Ω` },
          { label: 'Base current', expr: 'I_base = 100 / (√3 × 220)', result: `${fx(ib, 6)} kA` },
          { label: 'Back to S_base', expr: `√3 × 220 × ${fx(ib, 6)}`, result: `${fx(Math.sqrt(3) * 220 * ib, 4)} MVA` },
        ]}
        check={{
          ok: ok(zb, zBaseOhm(220, 100)) && ok(ib, iBaseKa(220, 100)),
          text: `The shared engine gives ${fx(zBaseOhm(220, 100), 4)} Ω and ${fx(iBaseKa(220, 100), 6)} kA — the same.`,
        }}
      />
      <Calc
        title="2 · T1 seen from both sides gives one per-unit value"
        steps={[
          { label: 'Reactance on own rating', expr: `X = ${fx(T1.zPct / 100, 2)} × ${num(T1.xr)} / √(1 + ${num(T1.xr)}²)`, result: `${fx(m.tx.T1.own.im, 6)} pu` },
          { label: `Ohms, ${num(T1.kvFrom)} kV side`, expr: `${fx(m.tx.T1.own.im, 6)} × ${num(T1.kvFrom)}² / ${num(T1.ratedMva)}`, result: `${fx(s1.from.ohm.im, 4)} Ω` },
          { label: `Per unit, ${num(T1.kvFrom)} kV base`, expr: `${fx(s1.from.ohm.im, 4)} / (${num(m.vb[T1.from])}² / ${num(A.sMva)})`, result: `${fx(s1.from.pu.im, 6)} pu` },
          { label: `Ohms, ${num(T1.kvTo)} kV side`, expr: `${fx(m.tx.T1.own.im, 6)} × ${num(T1.kvTo)}² / ${num(T1.ratedMva)}`, result: `${fx(s1.to.ohm.im, 6)} Ω` },
          { label: `Per unit, ${num(T1.kvTo)} kV base`, expr: `${fx(s1.to.ohm.im, 6)} / (${num(m.vb[T1.to])}² / ${num(A.sMva)})`, result: `${fx(s1.to.pu.im, 6)} pu` },
        ]}
        check={{
          ok: ok(s1.from.pu.im, s1.to.pu.im) && ok(s1.to.pu.im, eT1.z.im),
          text: `Both sides give ${fx(s1.to.pu.im, 6)} pu, and the engine’s branchPu gives X = ${fx(eT1.z.im, 6)} pu with t = ${fx(eT1.tap, 4)}.`,
        }}
      />
      <Calc
        title="3 · T2’s nameplate on the system base, and its off-nominal ratio"
        steps={[
          { label: 'Nameplate', expr: nameplate(net, 'T2'), result: `|z| = ${fx(t2Own, 3)} pu` },
          { label: 'Change of base', expr: `${fx(t2Own, 3)} × (${num(A.sMva)}/${num(T2.ratedMva)}) × (${num(T2.kvTo)}/${num(m.vb[T2.to])})²`, result: `${fx(t2New, 6)} pu` },
          { label: 'Off-nominal ratio', expr: `(${num(T2.kvFrom)}/${num(m.vb[T2.from])}) / (${num(T2.kvTo)}/${num(m.vb[T2.to])})`, result: fx(t2Tap, 6) },
        ]}
        check={{
          ok: ok(t2New, mag(eT2.z)) && ok(t2Tap, eT2.tap),
          text: `The engine: |z| = ${fx(mag(eT2.z), 6)} pu, t = ${fx(eT2.tap, 6)} — the same.`,
        }}
      />
      <Calc
        title="4 · Line L1 from ohms per kilometre"
        steps={[
          { label: 'Series impedance', expr: `(${num(L1.rOhmPerKm)} + j${num(L1.xOhmPerKm)}) × ${num(L1.lengthKm)}`, result: `${cx(l1Ohm.re, l1Ohm.im, 2)} Ω` },
          { label: 'Per unit', expr: `(${cx(l1Ohm.re, l1Ohm.im, 2)}) / ${fx(zb, 1)}`, result: `${cx(l1Ohm.re / zb, l1Ohm.im / zb, 6)} pu` },
          { label: 'Half the charging', expr: `${num(L1.bUsPerKm)} µS/km × ${num(L1.lengthKm)} km × ${fx(zb, 1)} Ω / 2`, result: `${fx((L1.bUsPerKm * 1e-6 * L1.lengthKm * zb) / 2, 6)} pu` },
        ]}
        check={{
          ok: ok(l1Ohm.re / zb, eL1.z.re) && ok(l1Ohm.im / zb, eL1.z.im) && ok((L1.bUsPerKm * 1e-6 * L1.lengthKm * zb) / 2, eL1.yHalf.im),
          text: `The engine: ${cx(eL1.z.re, eL1.z.im, 6)} pu, B/2 = ${fx(eL1.yHalf.im, 6)} pu — the same.`,
        }}
      />
      <section className="ps-calc" aria-label="A fault three ways">
        <div className="ps-toolbar">
          <h3 className="ps-calc-title">5 · One fault, three ways: in ohms, and in per unit on two bases</h3>
          <Seg label="Fault location" value={bus} onChange={(v) => setBus(v as FaultBus)} options={FAULT_BUSES.map((b) => ({ id: b.id, label: b.label }))} />
        </div>
        <FaultTable net={net} fo={fo} fa={fa} fb={fb} A={A} B={B} />
        <p className={`ps-check ${ok(fo.i, fa.iKa) && ok(fo.i, fb.iKa) ? 'ps-check--ok' : 'ps-check--bad'}`}>
          {ok(fo.i, fa.iKa) && ok(fo.i, fb.iKa) ? '✓ ' : '✗ '}
          In ohms {fx(fo.i, 4)} kA; in per unit {fx(fa.i, 4)} pu × {fx(fa.iBaseKa, 4)} kA = {fx(fa.iKa, 4)} kA on base A and {fx(fb.i, 4)} pu × {fx(fb.iBaseKa, 4)} kA = {fx(fb.iKa, 4)} kA on base B —
          the same current (to better than 1 part in 10⁹), though every per-unit number differs.
        </p>
        <p className="small muted ps-pu-assume">Assumes: {ASSUME_FAULT}.</p>
      </section>
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

function FaultTable({ net, fo, fa, fb, A, B }: { net: Network; fo: FaultResult; fa: FaultPuResult; fb: FaultPuResult; A: BaseChoice; B: BaseChoice }) {
  const kvF = busOf(net, fo.bus).kv
  return (
    <>
      <p className="small muted ps-pu-ratios">
        Base A: {baseLabel(net, A)}. Base B: {baseLabel(net, B)}. Ratios crossed on the way to the fault:{' '}
        {fo.ratios.length === 0
          ? 'none'
          : fo.ratios.map((r, k) => (
              <span key={r.id}>
                {k > 0 && ', '}
                {r.id} n = {fx(r.ratio, 4)} (t = {fx(fa.ratios[k].ratio, 4)})
              </span>
            ))}
        . Each value is referred to the faulted bus: ohms × n², per unit × 1/t² for every off-nominal ratio between.
      </p>
      <div className="table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Reactances referred to the faulted bus, in ohms and in per unit on two bases</caption>
          <thead>
            <tr>
              <th scope="col">Element</th>
              <th scope="col">X where it sits</th>
              <th scope="col">X at {num(kvF)} kV [Ω]</th>
              <th scope="col">Base A [pu]</th>
              <th scope="col">Base B [pu]</th>
            </tr>
          </thead>
          <tbody>
            {fo.terms.map((t, k) => (
              <tr key={t.id}>
                <td>{elementName(net, t.id)}</td>
                <td>{sg(t.own, 4)} Ω</td>
                <td>{fx(t.referred, 4)}</td>
                <td>{fx(fa.terms[k].referred, 5)}</td>
                <td>{fx(fb.terms[k].referred, 5)}</td>
              </tr>
            ))}
            <tr className="is-changed">
              <td>X_total</td>
              <td />
              <td>{fx(fo.x, 4)} Ω</td>
              <td>{fx(fa.x, 5)} pu</td>
              <td>{fx(fb.x, 5)} pu</td>
            </tr>
            <tr>
              <td>Pre-fault voltage E</td>
              <td>13.8 kV at G1</td>
              <td>{fx(fo.e, 4)} kV</td>
              <td>{fx(fa.e, 5)} pu</td>
              <td>{fx(fb.e, 5)} pu</td>
            </tr>
            <tr>
              <td>I_f</td>
              <td />
              <td>E / (√3·X)</td>
              <td>{fx(fa.i, 5)} pu</td>
              <td>{fx(fb.i, 5)} pu</td>
            </tr>
            <tr>
              <td>I_base at {num(kvF)} kV</td>
              <td />
              <td>—</td>
              <td>{fx(fa.iBaseKa, 5)} kA</td>
              <td>{fx(fb.iBaseKa, 5)} kA</td>
            </tr>
            <tr className="is-changed">
              <td>I_f in kA</td>
              <td />
              <td>{fx(fo.i, 5)} kA</td>
              <td>{fx(fa.iKa, 5)} kA</td>
              <td>{fx(fb.iKa, 5)} kA</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Practise ───────────────────────────────────────────────────────────────────────────────────────────────────

function Practise({ net }: { net: Network }) {
  const A = useMemo(() => networkBase(net), [net])
  const m = useMemo(() => buildModel(net, A), [net, A])
  const T3 = compOf(net, 'T3', 'transformer')
  const zMv = m.zones.find((z) => z.buses.includes('mvA'))!
  const zLv = m.zones.find((z) => z.buses.includes('lv'))!
  const vb230 = buildModel(net, { ...A, vRefKv: 230 }).vb
  const fault = faultPerUnit(net, 'lv', A)
  const items: QuizItem[] = [
    {
      id: 'zb33',
      kind: 'number',
      q: `What is the base impedance of the ${num(zMv.vBaseKv)} kV zone on ${num(A.sMva)} MVA?`,
      answer: zMv.zBaseOhm,
      unit: 'Ω',
      tol: 0.05,
      why: `Z_base = V_base² / S_base = ${num(zMv.vBaseKv)}² / ${num(A.sMva)} = ${fx(zMv.zBaseOhm, 2)} Ω.`,
    },
    {
      id: 'ib11',
      kind: 'number',
      q: `What is the base current of the ${num(zLv.vBaseKv)} kV zone on ${num(A.sMva)} MVA?`,
      answer: zLv.iBaseKa,
      unit: 'kA',
      tol: 0.01,
      why: `I_base = S_base / (√3 · V_base) = ${num(A.sMva)} / (√3 × ${num(zLv.vBaseKv)}) = ${fx(zLv.iBaseKa, 4)} kA.`,
    },
    {
      id: 'same',
      kind: 'choice',
      q: 'Which base quantity is the same in every zone of the network?',
      options: [
        { id: 's', label: 'S_base' },
        { id: 'v', label: 'V_base' },
        { id: 'z', label: 'Z_base' },
        { id: 'i', label: 'I_base' },
      ],
      answer: 's',
      why: 'S_base is chosen once for the whole system; V_base changes across transformers, and Z_base and I_base follow from both.',
    },
    {
      id: 't3',
      kind: 'number',
      q: `${T3.name} is ${num(T3.zPct)} % on its own ${num(T3.ratedMva)} MVA, rated ${num(T3.kvTo)} kV on the side whose base is ${num(m.vb[T3.to])} kV. What is |z| on ${num(A.sMva)} MVA?`,
      answer: mag(m.tx.T3.z),
      unit: 'pu',
      tol: 0.005,
      why: `${fx(T3.zPct / 100, 2)} × (${num(A.sMva)}/${num(T3.ratedMva)}) × (${num(T3.kvTo)}/${num(m.vb[T3.to])})² = ${fx(mag(m.tx.T3.z), 4)} pu.`,
    },
    {
      id: 'vgen',
      kind: 'number',
      q: 'If V_base in the transmission zone is chosen as 230 kV instead of 220 kV, what is V_base in the generator’s zone (T1 is 13.8/220 kV)?',
      answer: vb230.gen,
      unit: 'kV',
      tol: 0.02,
      why: `It follows T1’s ratio: 230 × 13.8 / 220 = ${fx(vb230.gen, 3)} kV.`,
    },
    {
      id: 'l1',
      kind: 'number',
      q: `L1 has ${num(compOf(net, 'L1', 'line').xOhmPerKm)} Ω/km of reactance over ${num(compOf(net, 'L1', 'line').lengthKm)} km at 220 kV. What is its reactance in per unit on ${num(A.sMva)} MVA?`,
      answer: m.line.L1.z.im,
      unit: 'pu',
      tol: 0.001,
      why: `${fx(m.line.L1.zOhm.im, 1)} Ω / ${fx(m.line.L1.zBaseOhm, 0)} Ω = ${fx(m.line.L1.z.im, 4)} pu.`,
    },
    {
      id: 'sides',
      kind: 'choice',
      q: 'Why does a transformer have the same per-unit impedance seen from either side?',
      options: [
        { id: 'a', label: 'Because its winding resistances are equal' },
        { id: 'b', label: 'Because ohms refer through the ratio squared, and the base impedances are in the same ratio squared' },
        { id: 'c', label: 'Because per-unit values ignore transformers altogether' },
      ],
      answer: 'b',
      why: 'Z_ohm ∝ V_rated² and Z_base ∝ V_base²; with the bases in the turns ratio the two factors cancel.',
    },
    {
      id: 'ika',
      kind: 'number',
      q: `A fault at the 11 kV bus works out at ${fx(fault.i, 4)} pu on ${num(A.sMva)} MVA (V_base ${num(fault.vBaseKv)} kV). What is it in kA?`,
      answer: fault.iKa,
      unit: 'kA',
      tol: 0.02,
      why: `I = ${fx(fault.i, 4)} × ${num(A.sMva)} / (√3 × ${num(fault.vBaseKv)}) = ${fx(fault.i, 4)} × ${fx(fault.iBaseKa, 4)} = ${fx(fault.iKa, 3)} kA.`,
    },
    {
      id: 'double',
      kind: 'choice',
      q: 'S_base is doubled and every V_base kept. A per-unit impedance…',
      options: [
        { id: 'half', label: 'halves' },
        { id: 'same', label: 'is unchanged' },
        { id: 'double', label: 'doubles' },
      ],
      answer: 'double',
      why: 'Z_base = V²/S halves, so the same ohms are twice the fraction of it.',
    },
  ]
  useTutorContext(() => `Practise mode: per-unit questions on the Grid Explorer network (100 MVA; zone bases 13.8/220/33/11 kV).`)
  return (
    <div className="ps-card ps-pu-practise">
      <h3>Practice questions</h3>
      <p className="small muted">Every number comes from this network on its {num(A.sMva)} MVA base. Answer all of them correctly to complete the activity.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
