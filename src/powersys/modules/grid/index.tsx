import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { solveNetwork, type Solution } from '../../network/solve.ts'
import { inService } from '../../network/topology.ts'
import type { Network } from '../../network/types.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, LevelLegend, Predict, Quiz, Readouts, Seg, Slider, Stepper, Toggle, useReducedMotion, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { SingleLine } from '../../ui/SingleLine.tsx'
import { PARTS, TAGS } from './content.ts'
import { EXPERIMENTS, runExperiment, type Experiment } from './experiments.ts'
import { gridNetwork } from './network.ts'
import { PhysicalView } from './PhysicalView.tsx'
import './grid.css'

/*
 * Module 1 — Power Grid Explorer. One network (network.ts), solved by the shared Newton–Raphson load flow; every
 * number on this page is read from that solution. Learn: follow the electricity from the generator to the town.
 * Explore: operate the grid and inspect any part. Experiment: predict, change one thing, compare. Verify: check the
 * solver's numbers by hand. Practise: questions on this network.
 */

const MODULE = 'grid'
type View = 'physical' | 'sld'

/** The operating settings a student can change in Explore. */
interface Ops {
  townMw: number
  factoryMw: number
  genV: number
  /** T2's 33 kV winding tap [%]. */
  t2Tap: number
  open: string[]
}
const OPS0: Ops = { townMw: 16, factoryMw: 12, genV: 1.02, t2Tap: 5, open: [] }
const TOWN_TAN = 5.26 / 16
const FACTORY_TAN = 7.44 / 12

function buildNetwork(o: Ops): Network {
  const n = gridNetwork()
  for (const c of n.components) {
    if (c.kind === 'load' && c.id === 'town') Object.assign(c, { pMw: o.townMw, qMvar: o.townMw * TOWN_TAN })
    if (c.kind === 'load' && c.id === 'factory') Object.assign(c, { pMw: o.factoryMw, qMvar: o.factoryMw * FACTORY_TAN })
    if (c.kind === 'generator') c.vPu = o.genV
    if (c.kind === 'transformer' && c.id === 'T2') c.kvTo = 33 * (1 + o.t2Tap / 100)
    if (c.kind === 'breaker') c.closed = !o.open.includes(c.id)
  }
  return n
}

const SLD_PLACE = {
  G1: { side: 'left' as const },
  factory: { side: 'below' as const },
  town: { side: 'right' as const },
}

function GridDiagram({
  view,
  net,
  sol,
  selected,
  onSelect,
  highlight,
  showValues,
}: {
  view: View
  net: Network
  sol: Solution | null
  selected?: string | null
  onSelect?(id: string): void
  highlight?: string[]
  showValues: boolean
}) {
  const reduced = useReducedMotion()
  return (
    <div className="ps-diagram">
      {view === 'physical' ? (
        <PhysicalView net={net} sol={sol} selected={selected} onSelect={onSelect} highlight={highlight} animate={!reduced} showValues={showValues} />
      ) : (
        <SingleLine
          net={net}
          sol={sol}
          label="Single-line diagram: power station to town"
          selected={selected}
          onSelect={onSelect}
          highlight={highlight}
          showValues={showValues}
          animate={!reduced}
          place={SLD_PLACE}
          tags={TAGS}
          viewBox="-70 46 1170 270"
        />
      )}
    </div>
  )
}

function ViewSwitch({ view, setView }: { view: View; setView(v: View): void }) {
  return (
    <Seg
      label="View"
      value={view}
      onChange={setView}
      options={[
        { id: 'physical', label: 'Physical' },
        { id: 'sld', label: 'Single-line diagram' },
      ]}
    />
  )
}

export default function GridModule({ mode, setMode }: ModuleProps) {
  const [view, setView] = useState<View>('physical')
  const [ops, setOps] = useState<Ops>(OPS0)
  const net = useMemo(() => buildNetwork(ops), [ops])
  const sol = useMemo(() => solveNetwork(net), [net])
  const base = useMemo(() => solveNetwork(gridNetwork()), [])
  const common = { view, setView }
  return (
    <div className="ps-grid">
      {mode === 'learn' && <Learn {...common} base={base} onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore {...common} ops={ops} setOps={setOps} net={net} sol={sol} />}
      {mode === 'experiment' && <Experiments {...common} />}
      {mode === 'verify' && <Verify net={net} sol={sol} edited={ops !== OPS0} />}
      {mode === 'practise' && <Practise base={base} />}
    </div>
  )
}

// ── Learn: follow the electricity ──────────────────────────────────────────────────────────────────────────────

function Learn({ view, setView, base, onExplore }: { view: View; setView(v: View): void; base: Solution; onExplore(): void }) {
  const [step, setStep] = useState(0)
  const net = useMemo(() => gridNetwork(), [])
  const s = base
  const sGen = Math.hypot(s.source.G1.pMw, s.source.G1.qMvar)
  const iGen = s.branch.T1.iToKa * 1000
  const iL1 = s.branch.L1.iFromKa * 1000
  const L1 = net.components.find((c) => c.id === 'L1')
  const T3 = net.components.find((c) => c.id === 'T3')
  const L2 = net.components.find((c) => c.id === 'L2')
  const rL1 = L1?.kind === 'line' ? L1.rOhmPerKm * L1.lengthKm : 0
  // the same power sent at 13.8 kV through the same line (an estimate: I²R with the 13.8 kV current, voltage drop ignored)
  const lossIf = 3 * (iGen / 1000) ** 2 * rL1 // MW: kA² × Ω = MW
  const steps: Array<{ title: string; focus: string[]; body: ReactNode }> = [
    {
      title: 'It starts in the power station',
      focus: ['G1', 'gen'],
      body: (
        <>
          <p>
            A turbine spins generator G1, which produces <b>{fx(s.source.G1.pMw, 1)} MW</b> at <b>{fx(s.bus.gen.kv, 2)} kV</b> — the voltage of its own windings. That power is exactly what the town
            and the factory use, plus everything lost on the way.
          </p>
          <p>
            At 13.8 kV this power is a large current: I = S / (√3 · V) = {fx(sGen, 1)} MVA / (√3 × {fx(s.bus.gen.kv, 2)} kV) ≈ <b>{fx(iGen, 0)} A</b> per phase.
          </p>
        </>
      ),
    },
    {
      title: 'Step up the voltage, step down the current',
      focus: ['T1', 'hvA'],
      body: (
        <>
          <p>
            The step-up transformer T1 raises the voltage from 13.8 kV to 220 kV — 16 times higher. The power passes through almost unchanged ({fx(s.branch.T1.lossMw * 1000, 0)} kW is lost in T1), so
            the current falls 16 times: from {fx(iGen, 0)} A to <b>{fx(iL1, 0)} A</b>.
          </p>
          <Eq
            expr="S = √3 · V · I   ⇒   same S, 16 × V  →  I / 16"
            where={[
              ['S', 'three-phase apparent power', 'MVA'],
              ['V', 'line-to-line voltage', 'kV'],
              ['I', 'line current', 'kA'],
            ]}
            assume="balanced three-phase"
          />
        </>
      ),
    },
    {
      title: 'Across the country at 220 kV',
      focus: ['L1', 'CB1'],
      body: (
        <>
          <p>
            Line L1 carries the power 120 km. Its conductors have resistance ({fx(rL1, 1)} Ω per phase), so it loses P = 3·I²·R: only <b>{fx(s.branch.L1.lossMw, 3)} MW</b> (
            {fx((s.branch.L1.lossMw / s.branch.L1.pFromMw) * 100, 2)} % of what it carries).
          </p>
          <p>
            Sent at 13.8 kV through the same line, the current would be {fx(iGen, 0)} A and the loss would be about 3 × ({fx(iGen / 1000, 3)} kA)² × {fx(rL1, 1)} Ω ≈ <b>{fx(lossIf, 0)} MW</b> — more
            than the power itself. That is why we transmit at high voltage.
          </p>
          <p className="small muted">
            The line also behaves like a long capacitor: its charging produces {fx(-s.branch.L1.lossMvar, 1)} Mvar — which is why the generator supplies only {fx(s.source.G1.qMvar, 1)} Mvar while the
            loads draw {fx(s.totals.loadMvar, 1)} Mvar.
          </p>
        </>
      ),
    },
    {
      title: 'The grid substation steps down to 33 kV',
      focus: ['hvB', 'T2', 'mvA', 'factory'],
      body: (
        <>
          <p>
            At the receiving end the voltage is {fx(s.bus.hvB.kv, 1)} kV and its angle lags {fx(-s.bus.hvB.angDeg, 1)}° behind the generator — power flows from a leading angle to a lagging one.
            Transformer T2 steps down to 33 kV; its tap is set +5 % to make up for drops further on (the 33 kV bus sits at {fx(s.bus.mvA.vPu, 3)} pu).
          </p>
          <p>
            A factory takes <b>{fx(s.load.factory.pMw, 0)} MW</b> directly at 33 kV: large consumers are supplied at a higher voltage to keep their currents down.
          </p>
        </>
      ),
    },
    {
      title: 'Sub-transmission: 10 km at 33 kV',
      focus: ['L2', 'CB2', 'mvB'],
      body: (
        <>
          <p>
            Line L2 is {L1?.kind === 'line' && L2?.kind === 'line' ? fx(L1.lengthKm / L2.lengthKm, 0) : ''} times shorter than L1, but carries its {fx(s.branch.L2.pFromMw, 1)} MW at 33 kV — so the current is {fx(s.branch.L2.iFromKa * 1000, 0)} A. Its losses are{' '}
            <b>{fx(s.branch.L2.lossMw, 3)} MW</b>: {fx((s.branch.L2.lossMw / s.branch.L2.pFromMw) * 100, 1)} % of what it carries, more than the 120 km transmission line.
          </p>
          <p>
            The voltage falls along it from {fx(s.bus.mvA.vPu, 3)} to <b>{fx(s.bus.mvB.vPu, 3)} pu</b>: the current through the line’s resistance and reactance drops voltage, mostly through the
            reactive power it carries.
          </p>
        </>
      ),
    },
    {
      title: 'The distribution substation: 33 kV to 11 kV',
      focus: ['T3', 'lv'],
      body: (
        <p>
          T3 steps down to 11 kV for the town’s feeders. Its 33 kV winding is on the −5 % tap, which raises the 11 kV side back to <b>{fx(s.bus.lv.kv, 2)} kV</b> ({fx(s.bus.lv.vPu, 3)} pu). It is
          loaded to {fx(s.branch.T3.loadingPct ?? 0, 0)} % of its {T3?.kind === 'transformer' ? T3.ratedMva : ''} MVA rating — the most heavily loaded part of this network.
        </p>
      ),
    },
    {
      title: 'The town',
      focus: ['town', 'CB4'],
      body: (
        <>
          <p>
            The town draws <b>{fx(s.load.town.pMw, 0)} MW</b> and {fx(s.load.town.qMvar, 2)} Mvar at 11 kV. Along each street, pole-mounted transformers (not modelled here) step 11 kV down to 400 V
            between phases — 230 V for each home.
          </p>
        </>
      ),
    },
    {
      title: 'The whole journey',
      focus: [],
      body: (
        <>
          <Readouts
            items={[
              { label: 'Generated', value: fx(s.totals.genMw, 2), unit: 'MW' },
              { label: 'Delivered', value: fx(s.totals.loadMw, 2), unit: 'MW' },
              {
                label: 'Lost on the way',
                value: fx(s.totals.lossMw, 2),
                unit: 'MW',
                note: `${fx((s.totals.lossMw / s.totals.genMw) * 100, 1)} % of generation`,
              },
              { label: 'Town voltage', value: fx(s.bus.lv.vPu, 3), unit: 'pu' },
            ]}
          />
          <p>Four voltage levels, each chosen for its job: high enough to keep currents and losses down over its distance, low enough to be safe and affordable where it is used.</p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Operate the grid yourself →
          </button>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — "Follow the electricity", step ${step + 1} of ${steps.length}: ${cur.title}. Network: 13.8 kV generator, 13.8/220 kV step-up, 120 km 220 kV line, 220/33 kV grid transformer (+5 % tap), factory 12 MW at 33 kV, 10 km 33 kV line, 33/11 kV transformer, town 16 MW at 11 kV. Solved: generation ${fx(s.totals.genMw, 2)} MW, losses ${fx(s.totals.lossMw, 3)} MW, town ${fx(s.bus.lv.vPu, 3)} pu.`,
  )
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <ViewSwitch view={view} setView={setView} />
        <LevelLegend only={['ehv', 'hv', 'mv']} />
      </div>
      <GridDiagram view={view} net={net} sol={s} highlight={cur.focus} showValues />
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

// ── Explore: operate the grid, inspect any part ───────────────────────────────────────────────────────────────

function Explore({ view, setView, ops, setOps, net, sol }: { view: View; setView(v: View): void; ops: Ops; setOps(o: Ops): void; net: Network; sol: Solution }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [showValues, setShowValues] = useState(true)
  const [seen, setSeen] = useState<string[]>([])
  const select = (id: string) => {
    setSelected((s) => (s === id ? null : id))
    if (!seen.includes(id)) {
      const next = [...seen, id]
      setSeen(next)
      if (next.length >= 5) completeActivity(MODULE, 'inspect')
    }
  }
  const toggleBreaker = (id: string) =>
    setOps({
      ...ops,
      open: ops.open.includes(id) ? ops.open.filter((x) => x !== id) : [...ops.open, id],
    })
  const t = sol.totals
  const energized = Object.values(sol.bus).filter((b) => b.energized)
  const lowest = energized.reduce<(typeof energized)[number] | null>((a, b) => (!a || b.vPu < a.vPu ? b : a), null)
  const highest = energized.reduce<(typeof energized)[number] | null>((a, b) => (!a || b.vPu > a.vPu ? b : a), null)
  const loaded = Object.values(sol.branch).filter((b) => b.energized && b.loadingPct !== undefined)
  const most = loaded.reduce<(typeof loaded)[number] | null>((a, b) => (!a || b.loadingPct! > a.loadingPct! ? b : a), null)
  const failed = sol.islands.find((i) => i.lf && !i.lf.converged)
  const busName = (id: string) => net.buses.find((b) => b.id === id)?.name ?? id
  useTutorContext(() => {
    const sel = selected ? `Selected: ${PARTS[selected]?.title ?? selected}.` : 'Nothing selected.'
    return `Explore mode. Settings: town ${ops.townMw} MW, factory ${ops.factoryMw} MW, generator voltage ${ops.genV} pu, T2 tap +${ops.t2Tap} %, open breakers: ${ops.open.join(', ') || 'none'}. ${failed ? `Load flow did not converge: ${failed.lf?.error}` : `Generation ${fx(t.genMw, 2)} MW, losses ${fx(t.lossMw, 3)} MW, unserved ${fx(t.unservedMw, 1)} MW. Bus voltages (pu): ${energized.map((b) => `${b.id} ${fx(b.vPu, 3)}`).join(', ')}.`} ${sel}`
  })
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <ViewSwitch view={view} setView={setView} />
          <Toggle label="Show values" checked={showValues} onChange={setShowValues} />
        </div>
        <LevelLegend only={['ehv', 'hv', 'mv']} />
      </div>
      <GridDiagram view={view} net={net} sol={failed ? null : sol} selected={selected} onSelect={select} showValues={showValues} />
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          {failed ? (
            <Callout tone="bad" title="No operating point">
              <p>{failed.lf?.error}</p>
              <p>Reduce the load or raise the voltage to bring the network back to a state it can supply.</p>
            </Callout>
          ) : (
            <Readouts
              label="Network summary"
              items={[
                { label: 'Generated', value: fx(t.genMw, 2), unit: 'MW' },
                {
                  label: 'Supplied to loads',
                  value: fx(t.loadMw, 2),
                  unit: 'MW',
                  note: t.unservedMw > 0 ? `${fx(t.unservedMw, 1)} MW without supply` : undefined,
                  tone: t.unservedMw > 0 ? 'bad' : undefined,
                },
                {
                  label: 'Losses',
                  value: fx(t.lossMw, 3),
                  unit: 'MW',
                  note: t.genMw > 0 ? `${fx((t.lossMw / t.genMw) * 100, 2)} % of generation` : undefined,
                },
                {
                  label: 'Lowest voltage',
                  value: lowest ? fx(lowest.vPu, 3) : '—',
                  unit: 'pu',
                  note: lowest ? busName(lowest.id) : undefined,
                  tone: lowest && lowest.vPu < 0.94 ? 'warn' : undefined,
                },
                {
                  label: 'Highest loading',
                  value: most ? fx(most.loadingPct!, 0) : '—',
                  unit: '%',
                  note: most ? (PARTS[most.id]?.title ?? most.id) : undefined,
                  tone: most && most.loadingPct! > 100 ? 'bad' : most && most.loadingPct! > 90 ? 'warn' : undefined,
                },
              ]}
            />
          )}
          {!failed && (lowest && lowest.vPu < 0.94 ? true : highest && highest.vPu > 1.06) && (
            <Callout tone="warn" title="Voltage outside the normal band">
              <p>
                {lowest && lowest.vPu < 0.94 && `${busName(lowest.id)} is at ${fx(lowest.vPu, 3)} pu. `}
                {highest && highest.vPu > 1.06 && `${busName(highest.id)} is at ${fx(highest.vPu, 3)} pu. `}
                Utilities keep supply voltages within about ±6 % of nominal; adjust a tap or the generator voltage.
              </p>
            </Callout>
          )}
          {!failed && most && most.loadingPct! > 100 && (
            <Callout tone="bad" title="Overload">
              <p>
                {PARTS[most.id]?.title ?? most.id} is carrying {fx(most.loadingPct!, 0)} % of its rating. Its protection would trip it after a short time.
              </p>
            </Callout>
          )}
          <section className="ps-card" aria-labelledby="ps-operate">
            <h3 id="ps-operate">Operate the grid</h3>
            <div className="ps-cols-2">
              <div>
                <Slider
                  label="Town demand"
                  value={ops.townMw}
                  min={0}
                  max={30}
                  step={0.5}
                  unit="MW"
                  onChange={(v) => setOps({ ...ops, townMw: v })}
                  hint="at 0.95 power factor (lagging)"
                  decimals={1}
                />
                <Slider
                  label="Factory demand"
                  value={ops.factoryMw}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="MW"
                  onChange={(v) => setOps({ ...ops, factoryMw: v })}
                  hint="at 0.85 power factor (lagging)"
                  decimals={1}
                />
              </div>
              <div>
                <Slider label="Generator voltage set-point" value={ops.genV} min={0.95} max={1.05} step={0.005} unit="pu" onChange={(v) => setOps({ ...ops, genV: v })} decimals={3} />
                <Slider label="T2 tap (33 kV winding)" value={ops.t2Tap} min={-5} max={10} step={1.25} unit="%" onChange={(v) => setOps({ ...ops, t2Tap: v })} decimals={2} />
              </div>
            </div>
            <div className="ps-toolbar-group ps-breakers">
              <span className="small muted">Breakers:</span>
              {net.components
                .filter((c) => c.kind === 'breaker')
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`text-btn ps-cb ${c.kind === 'breaker' && c.closed ? '' : 'is-open'}`}
                    aria-pressed={c.kind === 'breaker' && !c.closed}
                    onClick={() => toggleBreaker(c.id)}
                  >
                    {c.id} {c.kind === 'breaker' && c.closed ? 'closed' : 'open'}
                  </button>
                ))}
              <button type="button" className="text-btn" onClick={() => setOps(OPS0)} disabled={ops === OPS0}>
                Reset
              </button>
            </div>
          </section>
        </div>
        <Inspector id={selected} net={net} sol={failed ? null : sol} onToggle={toggleBreaker} onSelect={select} seen={seen.length} />
      </div>
    </div>
  )
}

function Inspector({ id, net, sol, onToggle, onSelect, seen }: { id: string | null; net: Network; sol: Solution | null; onToggle(id: string): void; onSelect(id: string): void; seen: number }) {
  const progress = usePsProgress()
  if (!id)
    return (
      <aside className="ps-card ps-inspector" aria-label="Inspector">
        <h3>Inspect the grid</h3>
        <p>Select any part — in the picture or on the single-line diagram — to see what it is, what it does and its live values.</p>
        <p className="small muted">{isDone(progress, MODULE, 'inspect') ? '✓ You have inspected five parts.' : `${seen} of 5 parts inspected`}</p>
      </aside>
    )
  const info = PARTS[id]
  const c = net.components.find((x) => x.id === id)
  const bus = net.buses.find((b) => b.id === id)
  const rows: Array<{
    label: string
    value: string
    unit?: string
    tone?: 'warn' | 'bad'
    note?: string
  }> = []
  let eq: ReactNode = null
  if (bus && sol) {
    const r = sol.bus[id]
    if (r.energized)
      rows.push(
        {
          label: 'Voltage',
          value: fx(r.kv, 2),
          unit: 'kV',
          note: `${fx(r.vPu, 3)} pu of ${bus.kv} kV`,
        },
        {
          label: 'Angle',
          value: fx(r.angDeg, 2),
          unit: '°',
          note: 'relative to the generator',
        },
      )
    else
      rows.push({
        label: 'Voltage',
        value: '0',
        unit: 'kV',
        note: 'no supply',
        tone: 'bad',
      })
  }
  if (c && sol) {
    if (c.kind === 'line' || c.kind === 'transformer') {
      const r = sol.branch[id]
      if (r.energized) {
        rows.push(
          {
            label: 'Power in',
            value: fx(Math.abs(r.pFromMw >= 0 ? r.pFromMw : r.pToMw), 2),
            unit: 'MW',
          },
          {
            label: 'Reactive',
            value: fx(r.pFromMw >= 0 ? r.qFromMvar : r.qToMvar, 2),
            unit: 'Mvar',
          },
          {
            label: 'Current',
            value: fx(r.iFromKa * 1000, 0),
            unit: 'A',
            note: c.kind === 'transformer' ? `${fx(r.iToKa * 1000, 0)} A on the other side` : `${fx(r.iToKa * 1000, 0)} A at the far end`,
          },
          {
            label: 'Losses',
            value: fx(r.lossMw * 1000, 0),
            unit: 'kW',
            note: `${fx(r.lossMvar, 2)} Mvar`,
          },
        )
        if (r.loadingPct !== undefined)
          rows.push({
            label: 'Loading',
            value: fx(r.loadingPct, 0),
            unit: '%',
            tone: r.loadingPct > 100 ? 'bad' : r.loadingPct > 90 ? 'warn' : undefined,
          })
      } else rows.push({ label: 'State', value: 'out of service', tone: 'bad' })
      eq =
        c.kind === 'line' ? (
          <Eq
            expr="P_loss = 3 · I² · R"
            where={[
              ['I', 'line current', 'A'],
              ['R', `resistance per phase: ${fx(c.rOhmPerKm, 3)} Ω/km × ${c.lengthKm} km = ${fx(c.rOhmPerKm * c.lengthKm, 2)} Ω`, 'Ω'],
            ]}
            assume="the current is the same along the line (its charging current makes the two ends differ slightly)"
          />
        ) : (
          <Eq
            expr={`V₁ / V₂ ≈ N₁ / N₂ ≈ I₂ / I₁`}
            where={[
              ['N₁/N₂', `rated ratio ${c.kvFrom}/${c.kvTo} kV`],
              ['Z', `${c.zPct} % on ${c.ratedMva} MVA, X/R = ${c.xr}`],
            ]}
            assume="an ideal transformer plus its series impedance (magnetising current neglected)"
          />
        )
    }
    if (c.kind === 'generator') {
      const r = sol.source[id]
      const i = sol.branch.T1?.iToKa
      rows.push(
        { label: 'Active power', value: fx(r.pMw, 2), unit: 'MW' },
        { label: 'Reactive', value: fx(r.qMvar, 2), unit: 'Mvar' },
        {
          label: 'Power factor',
          value: fx(r.pMw / Math.hypot(r.pMw, r.qMvar), 3),
        },
        { label: 'Current', value: fx((i ?? 0) * 1000, 0), unit: 'A' },
      )
      eq = (
        <Eq
          expr="S = √3 · V · I     P = S · cos φ"
          where={[
            ['S', 'apparent power', 'MVA'],
            ['V', 'line-to-line voltage', 'kV'],
            ['I', 'line current', 'kA'],
          ]}
        />
      )
    }
    if (c.kind === 'load') {
      const r = sol.load[id]
      const v = sol.bus[c.bus]
      rows.push(
        {
          label: 'Demand',
          value: fx(c.pMw, 1),
          unit: 'MW',
          note: `${fx(c.qMvar, 2)} Mvar · pf ${fx(c.pMw / Math.hypot(c.pMw, c.qMvar) || 0, 2)}`,
        },
        r.served
          ? {
              label: 'Supply voltage',
              value: fx(v.kv, 2),
              unit: 'kV',
              note: `${fx(v.vPu, 3)} pu`,
              tone: v.vPu < 0.94 || v.vPu > 1.06 ? 'warn' : undefined,
            }
          : {
              label: 'Supply',
              value: 'none',
              tone: 'bad',
              note: 'disconnected',
            },
      )
    }
  }
  const breaker = c?.kind === 'breaker' ? c : null
  const switches = c ? net.components.filter((x) => x.kind === 'breaker' && x.target === id) : []
  const target = breaker ? net.components.find((x) => x.id === breaker.target) : null
  return (
    <aside className="ps-card ps-inspector" aria-label="Inspector" aria-live="polite">
      <p className="eyebrow">
        {bus
          ? `Bus · ${bus.kv} kV`
          : c
            ? (
                {
                  generator: 'Generator',
                  grid: 'Grid',
                  transformer: 'Transformer',
                  line: 'Line',
                  breaker: 'Breaker',
                  load: 'Load',
                } as const
              )[c.kind]
            : ''}
      </p>
      <h3>{info?.title ?? c?.name ?? bus?.name}</h3>
      {info && <p className="ps-what">{info.what}</p>}
      {rows.length > 0 && <Readouts items={rows} />}
      {breaker && (
        <div className="ps-cb-state">
          <p>
            <b>{breaker.closed ? 'Closed' : 'Open'}</b> — {target ? (inService(net, target) ? `${target.name} is in service.` : `${target.name} is out of service.`) : ''}
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => onToggle(breaker.id)}>
            {breaker.closed ? 'Open the breaker' : 'Close the breaker'}
          </button>
        </div>
      )}
      {info && (
        <>
          <p>{info.does}</p>
          <details className="ps-more">
            <summary>What it looks like</summary>
            <p>{info.looks}</p>
          </details>
        </>
      )}
      {eq}
      {switches.length > 0 && (
        <p className="small">
          Switched by{' '}
          {switches.map((b, k) => (
            <span key={b.id}>
              {k > 0 && ', '}
              <button type="button" className="ps-link" onClick={() => onSelect(b.id)}>
                {b.id}
              </button>
            </span>
          ))}
        </p>
      )}
    </aside>
  )
}

// ── Experiment: predict, change one thing, compare ─────────────────────────────────────────────────────────────

function Experiments({ view, setView }: { view: View; setView(v: View): void }) {
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
      <nav className="ps-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the network does. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ps-stack" key={e.id}>
        <ExperimentRun e={e} view={view} setView={setView} answered={!!answered[e.id]} onAnswered={() => onAnswered(e.id)} />
      </div>
    </div>
  )
}

function ExperimentRun({ e, view, setView, answered, onAnswered }: { e: Experiment; view: View; setView(v: View): void; answered: boolean; onAnswered(): void }) {
  const { before, after, net } = runExperiment(e)
  const [show, setShow] = useState<'before' | 'after'>('before')
  const base = useMemo(() => gridNetwork(), [])
  const answer = e.answer(before, after)
  const shownAfter = answered && show === 'after'
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${e.explain(before, after, net).join(' ')}` : 'The student has not predicted yet.'}`)
  const diagramNet = shownAfter ? (e.id === 'lowv' ? base : net) : base
  const diagramSol = shownAfter ? (after.ok ? after : null) : before
  return (
    <>
      <div className="ps-exp-run ps-stack">
        <div className="ps-card">
          <p className="eyebrow">Experiment</p>
          <h3>{e.title}</h3>
          <p>{e.change}</p>
        </div>
        <Predict
          question={e.question}
          options={e.options}
          answer={answer}
          onAnswered={() => {
            onAnswered()
            setShow('after')
          }}
          why={
            <>
              {e.explain(before, after, net).map((p, k) => (
                <p key={k}>{p}</p>
              ))}
            </>
          }
        />
      </div>
      {answered && (
        <>
          <div className="ps-toolbar">
            <div className="ps-toolbar-group">
              <Seg
                label="Network shown"
                value={show}
                onChange={(v) => setShow(v as 'before' | 'after')}
                options={[
                  { id: 'before', label: 'Before' },
                  { id: 'after', label: 'After' },
                ]}
              />
              {e.id !== 'lowv' && <ViewSwitch view={view} setView={setView} />}
            </div>
          </div>
          {e.id === 'lowv' && shownAfter ? (
            <Callout tone="bad" title="No operating point at 33 kV">
              <p>{after.ok ? 'The network solves.' : after.islands[0]?.lf?.error}</p>
            </Callout>
          ) : (
            <GridDiagram view={view} net={diagramNet} sol={diagramSol} highlight={e.focus} showValues />
          )}
          <CompareTable e={e} before={before} after={after} net={net} />
        </>
      )}
    </>
  )
}

function CompareTable({ e, before, after, net }: { e: Experiment; before: Solution; after: Solution; net: Network }) {
  const base = useMemo(() => gridNetwork(), [])
  return (
    <div className="ps-card table-wrap">
      <table className="ps-table">
        <caption className="sr-only">Before and after: {e.title}</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {e.rows.map((r) => {
            const b = r.get(before, base)
            const a = after.ok ? r.get(after, net) : null
            const d = a !== null && b !== null ? a - b : null
            return (
              <tr key={r.label} className={d !== null && Math.abs(d) > 10 ** -r.decimals ? 'is-changed' : ''}>
                <td>{r.label}</td>
                <td>
                  {b === null ? '—' : fx(b, r.decimals)} {r.unit}
                </td>
                <td>{a === null ? 'no solution' : `${fx(a, r.decimals)} ${r.unit}`}</td>
                <td className={d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>
                  {d === null ? '—' : `${d > 0 ? '+' : ''}${fx(d, r.decimals)}${b ? ` (${d > 0 ? '+' : ''}${fx((d / Math.abs(b)) * 100, 1)} %)` : ''}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Verify: check the solver's numbers yourself ────────────────────────────────────────────────────────────────

function Verify({ net, sol, edited }: { net: Network; sol: Solution; edited: boolean }) {
  const [branch, setBranch] = useState<'L1' | 'L2' | 'T3'>('L1')
  const failed = sol.islands.find((i) => i.lf && !i.lf.converged)
  const progress = usePsProgress()
  useTutorContext(() => `Verify mode: hand checks of the load-flow results (power balance, I = S/(√3V), transformer loss = 3I²R, voltage-drop approximation).`)
  if (failed)
    return (
      <Callout tone="bad" title="Nothing to verify">
        The network you set up in Explore has no operating point. Reset it there first.
      </Callout>
    )
  const t = sol.totals
  const lossSum = Object.values(sol.branch).reduce((n, b) => n + b.lossMw, 0)
  const br = sol.branch[branch]
  const fromBus = net.components.find((c) => c.id === branch)
  const fb = fromBus && (fromBus.kind === 'line' || fromBus.kind === 'transformer') ? sol.bus[fromBus.from] : null
  const sFrom = Math.hypot(br.pFromMw, br.qFromMvar)
  const iHand = fb ? sFrom / (Math.sqrt(3) * fb.kv) : 0
  // T3 loss = 3 I² R with R referred to its 11 kV winding (the series impedance sits on the 11 kV side of the model)
  const T3 = net.components.find((c) => c.id === 'T3')
  const r3 = T3?.kind === 'transformer' ? (T3.zPct / 100 / Math.sqrt(1 + T3.xr * T3.xr)) * ((T3.kvTo * T3.kvTo) / T3.ratedMva) : 0
  const x3 = r3 * (T3?.kind === 'transformer' ? T3.xr : 0)
  const i3 = sol.branch.T3.iToKa
  const loss3 = 3 * i3 * i3 * r3
  // the voltage-drop approximation along L2: ΔV ≈ (R·P + X·Q) / V
  const L2 = net.components.find((c) => c.id === 'L2')
  const R2 = L2?.kind === 'line' ? L2.rOhmPerKm * L2.lengthKm : 0
  const X2 = L2?.kind === 'line' ? L2.xOhmPerKm * L2.lengthKm : 0
  const vA = sol.bus.mvA.kv
  const dvApprox = (R2 * sol.branch.L2.pFromMw + X2 * sol.branch.L2.qFromMvar) / vA
  const dvTrue = sol.bus.mvA.kv - sol.bus.mvB.kv
  const ok = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
  const quiz: QuizItem[] = [
    {
      id: 'i-l1',
      kind: 'number',
      q: `Your turn: line L1 sends ${fx(sol.branch.L1.pFromMw, 2)} MW and ${fx(sol.branch.L1.qFromMvar, 2)} Mvar from a bus at ${fx(sol.bus.hvA.kv, 2)} kV. What current does it carry at that end?`,
      answer: sol.branch.L1.iFromKa * 1000,
      unit: 'A',
      tol: Math.max(1, sol.branch.L1.iFromKa * 1000 * 0.02),
      why: `I = √(P² + Q²) / (√3 · V) = ${fx(Math.hypot(sol.branch.L1.pFromMw, sol.branch.L1.qFromMvar), 3)} MVA / (√3 × ${fx(sol.bus.hvA.kv, 2)} kV) = ${fx(sol.branch.L1.iFromKa * 1000, 1)} A.`,
    },
  ]
  return (
    <div className="ps-stack">
      <Callout title="The numbers on this page come from a Newton–Raphson load flow">
        <p>
          Here you check them with the basic laws, independently of the solver
          {edited ? ' — for the network as you set it up in Explore' : ''}. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · Energy is conserved"
        steps={[
          { label: 'Generated', expr: 'P_G1', result: `${fx(t.genMw, 4)} MW` },
          {
            label: 'Consumed by loads',
            expr:
              Object.entries(sol.load)
                .filter(([, l]) => l.served)
                .map(([id, l]) => `${id} ${fx(l.pMw, 2)}`)
                .join(' + ') || '0',
            result: `${fx(t.loadMw, 4)} MW`,
          },
          {
            label: 'Lost in branches',
            expr: Object.values(sol.branch)
              .filter((b) => b.energized)
              .map((b) => `${b.id} ${fx(b.lossMw, 4)}`)
              .join(' + '),
            result: `${fx(lossSum, 4)} MW`,
          },
          {
            label: 'Generated − consumed − lost',
            expr: `${fx(t.genMw, 4)} − ${fx(t.loadMw, 4)} − ${fx(lossSum, 4)}`,
            result: `${fx(t.genMw - t.loadMw - lossSum, 6)} MW`,
          },
        ]}
        check={{
          ok: ok(t.genMw - t.loadMw - lossSum, 0, 1e-6),
          text: 'Generation equals load plus losses (to within 10⁻⁶ MW).',
        }}
      />
      <section className="ps-calc" aria-label="Current from power">
        <div className="ps-toolbar">
          <h3 className="ps-calc-title">2 · Current from power: I = S / (√3 · V)</h3>
          <Seg
            label="Branch"
            value={branch}
            onChange={(v) => setBranch(v as 'L1' | 'L2' | 'T3')}
            options={[
              { id: 'L1', label: 'L1' },
              { id: 'L2', label: 'L2' },
              { id: 'T3', label: 'T3' },
            ]}
          />
        </div>
        {br.energized && fb ? (
          <Calc
            title={`${PARTS[branch].title}, sending end`}
            steps={[
              {
                label: 'Apparent power',
                expr: `√(${fx(br.pFromMw, 3)}² + ${fx(br.qFromMvar, 3)}²)`,
                result: `${fx(sFrom, 4)} MVA`,
              },
              {
                label: 'Voltage at that end',
                expr: 'from the load flow',
                result: `${fx(fb.kv, 3)} kV`,
              },
              {
                label: 'Current',
                expr: `${fx(sFrom, 4)} / (√3 × ${fx(fb.kv, 3)})`,
                result: `${fx(iHand * 1000, 2)} A`,
              },
            ]}
            check={{
              ok: ok(iHand, br.iFromKa, 1e-6),
              text: `The solver’s current is ${fx(br.iFromKa * 1000, 2)} A — the same.`,
            }}
          />
        ) : (
          <p className="muted">This branch is out of service.</p>
        )}
      </section>
      {sol.branch.T3.energized && (
        <Calc
          title="3 · Losses in transformer T3: P = 3 · I² · R"
          steps={[
            {
              label: 'Resistance (11 kV side)',
              expr: `${T3?.kind === 'transformer' ? `${T3.zPct} % · 1/√(1 + ${T3.xr}²) × ${T3.kvTo}² / ${T3.ratedMva}` : ''}`,
              result: `${fx(r3, 5)} Ω`,
            },
            {
              label: '11 kV current',
              expr: 'from the load flow',
              result: `${fx(i3 * 1000, 2)} A`,
            },
            {
              label: 'Copper loss',
              expr: `3 × ${fx(i3, 5)}² × ${fx(r3, 5)}`,
              result: `${fx(loss3 * 1000, 2)} kW`,
            },
          ]}
          check={{
            ok: ok(loss3, sol.branch.T3.lossMw, 1e-6),
            text: `The solver’s T3 loss is ${fx(sol.branch.T3.lossMw * 1000, 2)} kW — the same. (Its reactance X = ${fx(x3, 4)} Ω absorbs ${fx(sol.branch.T3.lossMvar, 3)} Mvar.)`,
          }}
        />
      )}
      {sol.branch.L2.energized && (
        <Calc
          title="4 · Voltage drop along L2: ΔV ≈ (R·P + X·Q) / V"
          steps={[
            {
              label: 'Line R and X',
              expr: `${L2?.kind === 'line' ? `${L2.rOhmPerKm} & ${L2.xOhmPerKm} Ω/km × ${L2.lengthKm} km` : ''}`,
              result: `${fx(R2, 2)} Ω, ${fx(X2, 2)} Ω`,
            },
            {
              label: 'Approximate drop',
              expr: `(${fx(R2, 2)} × ${fx(sol.branch.L2.pFromMw, 2)} + ${fx(X2, 2)} × ${fx(sol.branch.L2.qFromMvar, 2)}) / ${fx(vA, 2)}`,
              result: `${fx(dvApprox, 3)} kV`,
            },
            {
              label: 'Exact (load flow)',
              expr: `${fx(sol.bus.mvA.kv, 3)} − ${fx(sol.bus.mvB.kv, 3)}`,
              result: `${fx(dvTrue, 3)} kV`,
            },
          ]}
          check={{
            ok: Math.abs(dvApprox - dvTrue) / Math.max(dvTrue, 1e-9) < 0.15,
            text: `The approximation is within ${fx((Math.abs(dvApprox - dvTrue) / dvTrue) * 100, 1)} % of the exact value. It neglects the angle across the line and the line’s charging current — good for quick estimates on short lines.`,
          }}
        />
      )}
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

// ── Practise ───────────────────────────────────────────────────────────────────────────────────────────────────

function Practise({ base }: { base: Solution }) {
  const s = base
  const branches = Object.values(s.branch).filter((b) => b.loadingPct !== undefined)
  const most = branches.reduce((a, b) => (b.loadingPct! > a.loadingPct! ? b : a))
  const items: QuizItem[] = [
    {
      id: 'why-hv',
      kind: 'choice',
      q: 'Why is bulk power transmitted at 220 kV rather than at the generator’s 13.8 kV?',
      options: [
        {
          id: 'a',
          label: 'Higher voltage makes the electricity travel faster',
        },
        {
          id: 'b',
          label: 'For the same power the current is lower, and losses grow with current squared',
        },
        { id: 'c', label: 'Generators cannot connect to a 13.8 kV line' },
      ],
      answer: 'b',
      why: 'P_loss = 3·I²·R, and I = S/(√3·V): 16 × the voltage means 1/16 of the current and 1/256 of the loss in the same conductor.',
    },
    {
      id: 'gen-mw',
      kind: 'number',
      q: `The loads take ${fx(s.totals.loadMw, 0)} MW and the losses are ${fx(s.totals.lossMw, 3)} MW. How much must the generator produce?`,
      answer: s.totals.genMw,
      unit: 'MW',
      tol: 0.01,
      why: `Generation = load + losses = ${fx(s.totals.loadMw, 0)} + ${fx(s.totals.lossMw, 3)} = ${fx(s.totals.genMw, 3)} MW.`,
    },
    {
      id: 'i-t3',
      kind: 'number',
      q: `The town draws ${fx(s.load.town.pMw, 0)} MW and ${fx(s.load.town.qMvar, 2)} Mvar at ${fx(s.bus.lv.kv, 2)} kV. What current flows in each phase of its 11 kV supply?`,
      answer: s.branch.T3.iToKa * 1000,
      unit: 'A',
      tol: 5,
      why: `I = √(16² + ${fx(s.load.town.qMvar, 2)}²) MVA / (√3 × ${fx(s.bus.lv.kv, 2)} kV) = ${fx(s.branch.T3.iToKa * 1000, 0)} A.`,
    },
    {
      id: 'most',
      kind: 'choice',
      q: 'Which element of this network is the most heavily loaded against its rating?',
      options: ['T1', 'L1', 'T2', 'L2', 'T3'].map((id) => ({
        id,
        label: PARTS[id].title,
      })),
      answer: most.id,
      why: `${PARTS[most.id].title} carries ${fx(most.loadingPct!, 0)} % of its rating.`,
    },
    {
      id: 'double-v',
      kind: 'choice',
      q: 'If the same power were sent through the same line at twice the voltage, the line losses would be…',
      options: [
        { id: 'half', label: 'halved' },
        { id: 'quarter', label: 'a quarter' },
        { id: 'same', label: 'unchanged' },
      ],
      answer: 'quarter',
      why: 'Twice the voltage, half the current; losses ∝ I², so (½)² = ¼.',
    },
    {
      id: 'cb2',
      kind: 'choice',
      q: 'Breaker CB2 on the 33 kV line opens. Who keeps their supply?',
      options: [
        { id: 'factory', label: 'The factory' },
        { id: 'town', label: 'The town' },
        { id: 'nobody', label: 'Nobody' },
      ],
      answer: 'factory',
      why: 'The factory is fed from the 33 kV bus before CB2; the town is beyond it — in a radial network there is no other path.',
    },
    {
      id: 'charging',
      kind: 'choice',
      q: `The loads draw ${fx(s.totals.loadMvar, 1)} Mvar, yet the generator supplies only ${fx(s.source.G1.qMvar, 1)} Mvar. Where does the rest come from?`,
      options: [
        { id: 'tx', label: 'The transformers produce it' },
        { id: 'line', label: 'The 220 kV line’s capacitance (line charging)' },
        { id: 'loads', label: 'The loads produce it themselves' },
      ],
      answer: 'line',
      why: `A long high-voltage line has capacitance between its conductors and earth. Here L1 produces ${fx(-s.branch.L1.lossMvar, 1)} Mvar more than its own reactance absorbs.`,
    },
  ]
  useTutorContext(() => `Practise mode: questions on the Grid Explorer network (generation ${fx(s.totals.genMw, 2)} MW, losses ${fx(s.totals.lossMw, 3)} MW).`)
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">Every number comes from this network’s load flow. Answer all of them correctly to complete the activity.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
