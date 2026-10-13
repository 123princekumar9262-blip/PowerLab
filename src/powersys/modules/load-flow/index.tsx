import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { abs, add, C, conj, mul, polarDeg, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'
import { ybusFromImpedances } from '../../network/ybus.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { cx, fx, sg } from '../../ui/format.ts'
import { Calc, Callout, Eq, Predict, Quiz, Readouts, Seg, Slider, Stepper, Toggle, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { lineFlow, solveCase, type CaseSolution } from './analysis.ts'
import { EXPERIMENTS, runExperiment, startFrom, type LfExperiment } from './experiments.ts'
import { gaussSeidel } from './gaussSeidel.ts'
import { LfDiagram } from './LfDiagram.tsx'
import { injectionsPolar, jacobian, newtonRaphson } from './stepwise.ts'
import { CASES, editCase, lfBuses, SAADAT_PUBLISHED, unreachable, type CaseEdits, type LfCase } from './systems.ts'
import { GsCompare, log10m, NrStepper, Results, sci, TYPE_NAME, YbusBuilder, YMatrix } from './views.tsx'
import { ybusSteps } from './ybusSteps.ts'
import './load-flow.css'

/*
 * Module 5 — Load Flow & Bus Analysis. Two cases (systems.ts): Saadat's 3-bus Example 6.10 and an illustrative 5-bus
 * meshed 230 kV network. Y_bus is built element by element (ybusSteps.ts); final results come from the shared
 * Newton–Raphson solver (network/loadflow.ts); the iteration view uses an instrumented Newton–Raphson (stepwise.ts)
 * that reaches the same solution; Gauss–Seidel (gaussSeidel.ts) is run on the same data for comparison.
 * Every number on the page is computed.
 */

const MODULE = 'load-flow'
type SysId = LfCase['id']
type View = 'ybus' | 'nr' | 'gs' | 'results'

interface Ops {
  loadScale: number
  outages: string[]
  capMvar: number
  qLimits: boolean
}
const OPS0: Ops = { loadScale: 1, outages: [], capMvar: 0, qLimits: true }
const toEdits = (o: Ops, c: LfCase): CaseEdits => ({ loadScale: o.loadScale, outages: o.outages, shunt: o.capMvar ? { bus: c.weakBus, mvar: o.capMvar } : undefined, qLimits: o.qLimits })

export default function LoadFlowModule({ mode, setMode }: ModuleProps) {
  const [sys, setSys] = useState<SysId>('saadat')
  const [ops, setOps] = useState<Record<SysId, Ops>>({ saadat: OPS0, five: OPS0 })
  const [view, setView] = useState<View>('ybus')
  return (
    <div className="ps-lf">
      {mode === 'learn' && (
        <Learn
          onExplore={(v) => {
            setSys('saadat')
            setView(v)
            setMode('explore')
          }}
        />
      )}
      {mode === 'explore' && <Explore sys={sys} setSys={setSys} ops={ops[sys]} setOps={(o) => setOps((all) => ({ ...all, [sys]: o }))} view={view} setView={setView} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── Learn ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Learn({ onExplore }: { onExplore(v: View): void }) {
  const [step, setStep] = useState(0)
  const c = useMemo(() => CASES.saadat(), [])
  const sol = useMemo(() => solveCase(c), [c])
  const { Y } = useMemo(() => ybusSteps(c), [c])
  const run = useMemo(() => newtonRaphson(Y, lfBuses(c)), [Y, c])
  const r0 = run.records[0]
  const types = c.buses.map((b) => b.type)
  const nPq = types.filter((t) => t === 'pq').length
  const nPv = types.filter((t) => t === 'pv').length
  // only angle differences matter: rotate every voltage by 30° and recompute a line flow
  const rotated = sol.V.map((v) => mul(v, polarDeg(1, 30)))
  const f12 = sol.lines[0]
  const f12r = lineFlow(c, c.lines[0], rotated)
  const s1 = sol.bus[0]
  const given = (t: string) => (t === 'slack' ? '|V|, θ = 0' : t === 'pv' ? 'P, |V|' : 'P, Q')
  const unknown = (t: string) => (t === 'slack' ? 'P, Q' : t === 'pv' ? 'Q, θ' : '|V|, θ')
  const steps: Array<{ title: string; focus: number[]; values?: boolean; body: ReactNode }> = [
    {
      title: 'The question a load flow answers',
      focus: [0, 1, 2],
      body: (
        <>
          <p>
            An operator knows what every load takes and what every generator has been told to do. A <b>load flow</b> (power flow) finds what follows: the voltage magnitude and angle at every bus — and
            from those, every line flow, every loss and what each generator actually supplies.
          </p>
          <p>
            The example is Saadat’s three-bus system (Example 6.10, 100 MVA base): bus 2 takes {fx(c.buses[1].pLoadMw, 0)} MW + j{fx(c.buses[1].qLoadMvar, 0)} Mvar; the generator at bus 3 is told to
            produce {fx(c.buses[2].pGenMw, 0)} MW and hold {fx(c.buses[2].vSet, 2)} pu; bus 1 holds {fx(c.buses[0].vSet, 2)} pu.
          </p>
          <table className="ps-table ps-lf-given">
            <thead>
              <tr>
                <th scope="col">Bus</th>
                <th scope="col">Type</th>
                <th scope="col">Given</th>
                <th scope="col">To find</th>
              </tr>
            </thead>
            <tbody>
              {c.buses.map((b, i) => (
                <tr key={i}>
                  <td>{b.tag}</td>
                  <td>{TYPE_NAME[b.type]}</td>
                  <td>{given(b.type)}</td>
                  <td>{unknown(b.type)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
    {
      title: 'Three kinds of bus',
      focus: [0, 1, 2],
      body: (
        <>
          <p>Each bus has four quantities — P, Q, |V| and θ. Two are specified, two are found; which two depends on what is connected:</p>
          <ul className="ps-lf-list">
            <li>
              <b>PQ bus</b> (load bus): P and Q are known — the demand. |V| and θ are unknown. Most buses are PQ buses.
            </li>
            <li>
              <b>PV bus</b> (generator bus): the generator’s P is scheduled and its voltage regulator holds |V|. The Q it must produce to do that, and θ, are unknown.
            </li>
            <li>
              <b>Slack bus</b> (one only): |V| and θ = 0 are fixed; its P and Q are whatever is still needed.
            </li>
          </ul>
          <p>
            The unknowns are θ at every bus except the slack and |V| at every PQ bus: 2 × {nPq} PQ + {nPv} PV = <b>{2 * nPq + nPv}</b> here (θ₂, |V₂|, θ₃), with as many equations — ΔP at buses 2 and
            3, ΔQ at bus 2.
          </p>
        </>
      ),
    },
    {
      title: 'Why one slack bus?',
      focus: [0],
      values: true,
      body: (
        <>
          <p>
            <b>Losses are not known in advance.</b> They depend on the currents, which depend on the voltages being solved for — so no one can schedule every generator’s output beforehand. One
            generator takes up the difference. Here the losses turn out to be <b>{fx(sol.totals.pLoss, 2)} MW</b>, so the slack generator supplies {fx(c.buses[1].pLoadMw, 0)} −{' '}
            {fx(c.buses[2].pGenMw, 0)} + {fx(sol.totals.pLoss, 2)} = <b>{fx(s1.pGenMw, 2)} MW</b>.
          </p>
          <p>
            <b>Only angle differences matter.</b> Turn every bus voltage by the same 30°: the flow on line 1–2 is {fx(f12.pFromMw, 2)} MW before and {fx(f12r.pFromMw, 2)} MW after. The equations
            cannot fix the angles on their own, so one bus is chosen as the reference, θ = 0.
          </p>
        </>
      ),
    },
    {
      title: 'The load-flow equations',
      focus: [0, 1, 2],
      body: (
        <>
          <p>Kirchhoff’s current law at every bus, written with the bus admittance matrix I = Y_bus·V, and S = V·I* give the power injected at bus i:</p>
          <Eq
            expr="P_i = Σ_k |V_i||V_k|(G_ik cos θ_ik + B_ik sin θ_ik)     Q_i = Σ_k |V_i||V_k|(G_ik sin θ_ik − B_ik cos θ_ik)"
            where={[
              ['G_ik + jB_ik', 'entry i,k of Y_bus', 'pu'],
              ['θ_ik', 'θ_i − θ_k', 'rad'],
              ['P_i, Q_i', 'net injection: generation − load', 'pu'],
            ]}
            assume="balanced three-phase, steady state, per unit on 100 MVA"
          />
          <YMatrix Y={Y} label="Y_bus of the Saadat 3-bus system" d={2} />
          <p>Products of unknown voltages, sines and cosines: the equations are nonlinear, so they are solved by iteration.</p>
          <button type="button" className="text-btn" onClick={() => onExplore('ybus')}>
            Build this Y_bus yourself, one line at a time →
          </button>
        </>
      ),
    },
    {
      title: 'Newton–Raphson: guess, measure, correct',
      focus: [1, 2],
      body: (
        <>
          <p>
            Start flat (|V| = 1, θ = 0 at the unknown buses). Compute P and Q from the guess and compare with what was specified: at the flat start ΔP₂ = {fx(r0.dP[0], 4)}, ΔP₃ = {fx(r0.dP[1], 4)},
            ΔQ₂ = {fx(r0.dQ[0], 4)} pu. Then linearise — the Jacobian J says how each injection responds to each unknown — and solve J·Δx = Δ for the correction.
          </p>
          <div className="ps-lf-mini">
            <table className="ps-table">
              <thead>
                <tr>
                  <th scope="col">Iteration</th>
                  <th scope="col">Largest mismatch, pu</th>
                </tr>
              </thead>
              <tbody>
                {run.history.map((m, k) => (
                  <tr key={k}>
                    <td>{k === 0 ? 'flat start' : k}</td>
                    <td>{sci(m, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {run.iterations} iterations reach 10⁻⁸ pu. Near the solution the error is roughly squared each time — the exponent doubles. That is <b>quadratic convergence</b>.
            </p>
          </div>
          <button type="button" className="text-btn" onClick={() => onExplore('nr')}>
            Step through the iterations, with the Jacobian →
          </button>
        </>
      ),
    },
    {
      title: 'The answer',
      focus: [0, 1, 2],
      values: true,
      body: (
        <>
          <Readouts
            items={[
              { label: '|V₂|', value: fx(sol.bus[1].vm, 6), unit: 'pu' },
              { label: 'θ₂', value: fx(sol.bus[1].thDeg, 3), unit: '°' },
              { label: 'θ₃', value: fx(sol.bus[2].thDeg, 4), unit: '°', note: `|V₃| held at ${fx(sol.bus[2].vm, 2)} pu` },
              { label: 'Slack P₁', value: fx(s1.pGenMw, 3), unit: 'MW' },
              { label: 'Slack Q₁', value: fx(s1.qGenMvar, 3), unit: 'Mvar' },
              { label: 'Bus 3 Q₃', value: fx(sol.bus[2].qGenMvar, 3), unit: 'Mvar' },
            ]}
          />
          <p>
            Saadat publishes |V₂| = {SAADAT_PUBLISHED.v2}, θ₂ = {SAADAT_PUBLISHED.th2Deg}°, θ₃ = {SAADAT_PUBLISHED.th3Deg}°, S₁ = {SAADAT_PUBLISHED.p1Mw} + j{SAADAT_PUBLISHED.q1Mvar} and Q₃ ={' '}
            {SAADAT_PUBLISHED.q3Mvar} Mvar — the same. Generation {fx(sol.totals.pGen, 3)} MW = load {fx(sol.totals.pLoad, 0)} MW + losses {fx(sol.totals.pLoss, 3)} MW.
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => onExplore('results')}>
            Explore both networks yourself →
          </button>
        </>
      ),
    },
  ]
  const cur = steps[step]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  useTutorContext(
    () =>
      `Learn mode — load-flow tour, step ${step + 1} of ${steps.length}: ${cur.title}. Case: Saadat Example 6.10 3-bus (slack 1.05 pu; bus 2 PQ load 400+j250; bus 3 PV 200 MW at 1.04 pu). Solved: V2 = ${fx(sol.bus[1].vm, 4)}∠${fx(sol.bus[1].thDeg, 3)}°, θ3 = ${fx(sol.bus[2].thDeg, 4)}°, slack ${fx(s1.pGenMw, 2)} MW + j${fx(s1.qGenMvar, 2)} Mvar, losses ${fx(sol.totals.pLoss, 3)} MW; NR mismatch history ${run.history.map((m) => m.toExponential(1)).join(', ')}.`,
  )
  return (
    <div className="ps-stack">
      <div className="ps-diagram ps-lf-diagram ps-lf-diagram--learn">
        <LfDiagram c={c} label="Saadat 3-bus system" highlightBuses={cur.focus} dimOthers busV={cur.values ? sol.bus : null} flows={cur.values ? sol.lines : null} />
      </div>
      <div className="ps-card ps-lf-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

// ── Explore ────────────────────────────────────────────────────────────────────────────────────────────────────

function Explore({ sys, setSys, ops, setOps, view, setView }: { sys: SysId; setSys(s: SysId): void; ops: Ops; setOps(o: Ops): void; view: View; setView(v: View): void }) {
  const base = useMemo(() => CASES[sys](), [sys])
  const edits = useMemo(() => toEdits(ops, base), [ops, base])
  const c = useMemo(() => editCase(base, edits), [base, edits])
  const { steps, Y } = useMemo(() => ybusSteps(c), [c])
  const lb = useMemo(() => lfBuses(c), [c])
  const cut = useMemo(() => unreachable(c), [c])
  const run = useMemo(() => newtonRaphson(Y, lb), [Y, lb])
  const sol = useMemo(() => solveCase(base, edits), [base, edits])
  const free = useMemo(
    () => (!sol.converged && ops.qLimits && base.buses.some((b) => b.qMaxMvar !== undefined) ? solveCase(base, { ...edits, qLimits: false }) : null),
    [sol, ops.qLimits, base, edits],
  )
  const [count, setCount] = useState(0)
  const [idx, setIdx] = useState(0)
  const [alpha, setAlpha] = useState(1)
  useEffect(() => setCount(0), [sys])
  useEffect(() => setIdx(0), [run])
  useEffect(() => {
    if (count === steps.length && steps.length > 0) completeActivity(MODULE, 'ybus')
  }, [count, steps.length])
  useEffect(() => {
    if (run.converged && idx === run.records.length - 1) completeActivity(MODULE, 'iterate')
  }, [idx, run])
  const cnt = Math.min(count, steps.length)
  const toggleLine = (id: string) => setOps({ ...ops, outages: ops.outages.includes(id) ? ops.outages.filter((x) => x !== id) : [...ops.outages, id] })
  const rec = run.records[Math.min(idx, run.records.length - 1)]
  const edited = ops.loadScale !== 1 || ops.outages.length > 0 || ops.capMvar > 0 || !ops.qLimits
  const lowest = sol.converged ? sol.bus.reduce((m, b, i) => (b.vm < sol.bus[m].vm ? i : m), 0) : -1
  const over = sol.converged ? sol.lines.filter((l) => (l.loadingPct ?? 0) > 100) : []
  const pvBus = base.buses.findIndex((b) => b.type === 'pv')
  useTutorContext(() => {
    const where = {
      ybus: `Y_bus builder, ${cnt} of ${steps.length} elements added`,
      nr: `Newton–Raphson iteration view at state ${idx} (mismatch ${sg(rec.mismatch, 3)} pu)`,
      gs: `Gauss–Seidel comparison with α = ${alpha}`,
      results: 'results tables',
    }[view]
    return `Explore mode — ${c.name}. Settings: load × ${ops.loadScale}, lines out: ${ops.outages.join(', ') || 'none'}${sys === 'five' ? `, capacitor at ${base.buses[base.weakBus].name} ${ops.capMvar} Mvar, Q limits ${ops.qLimits ? 'on' : 'off'}` : ''}. Showing: ${where}. ${sol.converged ? `Solved in ${sol.iterations} NR iterations: ${sol.bus.map((b, i) => `bus ${i + 1} ${fx(b.vm, 4)}∠${fx(b.thDeg, 2)}°`).join(', ')}; losses ${fx(sol.totals.pLoss, 3)} MW.` : `No solution: ${sol.error}`}`
  })
  const busV = view === 'nr' ? rec.Vm.map((vm, i) => ({ vm, thDeg: (rec.th[i] * 180) / Math.PI })) : view === 'ybus' ? null : sol.converged ? sol.bus : null
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg
            label="System"
            value={sys}
            onChange={setSys}
            options={[
              { id: 'saadat', label: 'Saadat 3-bus' },
              { id: 'five', label: '5-bus meshed (illustrative)' },
            ]}
          />
          <Seg
            label="View"
            value={view}
            onChange={setView}
            options={[
              { id: 'ybus', label: 'Build Y_bus' },
              { id: 'nr', label: 'Newton–Raphson' },
              { id: 'gs', label: 'Gauss–Seidel' },
              { id: 'results', label: 'Results' },
            ]}
          />
        </div>
        <span className="small muted">Click a line on the diagram to switch it out.</span>
      </div>
      <div className="ps-split ps-lf-top">
        <div className={`ps-diagram ps-lf-diagram ps-lf-diagram--${sys}`}>
          <LfDiagram
            c={c}
            label={`${c.name}: single-line diagram`}
            busV={busV}
            types={view === 'nr' ? rec.types : sol.converged ? sol.bus.map((b) => b.type) : undefined}
            limited={view === 'nr' ? [] : sol.converged ? sol.bus.flatMap((b, i) => (b.atQLimit ? [i] : [])) : []}
            flows={view === 'results' || view === 'gs' ? (sol.converged ? sol.lines : null) : null}
            built={
              view === 'ybus'
                ? steps
                    .slice(0, cnt)
                    .filter((s) => s.kind === 'line')
                    .map((s) => s.label)
                : undefined
            }
            current={view === 'ybus' && cnt > 0 ? steps[cnt - 1].label : null}
            onLine={toggleLine}
          />
        </div>
        <aside className="ps-card ps-lf-side" aria-label="Operating point">
          <h3>Operating point</h3>
          <Slider
            label="All loads ×"
            value={ops.loadScale}
            min={0.5}
            max={sys === 'five' ? 2.2 : 4}
            step={0.01}
            decimals={2}
            onChange={(v) => setOps({ ...ops, loadScale: v })}
            hint="P and Q scaled together; generation set-points unchanged"
          />
          {sys === 'five' && (
            <>
              <Slider
                label={`Capacitor at ${base.buses[base.weakBus].name}`}
                value={ops.capMvar}
                min={0}
                max={100}
                step={5}
                unit="Mvar"
                decimals={0}
                onChange={(v) => setOps({ ...ops, capMvar: v })}
              />
              <Toggle
                label={`Enforce East plant’s Q limits (${base.buses[pvBus].qMinMvar} to +${base.buses[pvBus].qMaxMvar} Mvar)`}
                checked={ops.qLimits}
                onChange={(v) => setOps({ ...ops, qLimits: v })}
              />
            </>
          )}
          <div className="ps-lf-linebtns" role="group" aria-label="Lines in service">
            {base.lines.map((l) => {
              const out = ops.outages.includes(l.id)
              return (
                <button key={l.id} type="button" className={`text-btn ps-lf-linebtn ${out ? 'is-out' : ''}`} aria-pressed={out} onClick={() => toggleLine(l.id)}>
                  {l.id} {out ? 'out' : 'in'}
                </button>
              )
            })}
            <button type="button" className="text-btn" onClick={() => setOps(OPS0)} disabled={!edited}>
              Reset
            </button>
          </div>
          {sol.converged ? (
            <Readouts
              items={[
                { label: 'Newton–Raphson', value: String(sol.iterations), unit: 'iterations', note: 'converged' },
                { label: 'Total load', value: fx(sol.totals.pLoad, 0), unit: 'MW' },
                { label: 'Lowest |V|', value: fx(sol.bus[lowest].vm, 3), unit: 'pu', note: base.buses[lowest].name, tone: sol.bus[lowest].vm < 0.95 ? 'warn' : undefined },
                { label: 'Losses', value: fx(sol.totals.pLoss, 2), unit: 'MW' },
              ]}
            />
          ) : (
            <Callout tone="bad" title="No operating point">
              <p>{sol.error}</p>
              {free?.converged && pvBus >= 0 && (
                <p>
                  Without its reactive limit, {base.buses[pvBus].name} would have to produce {fx(free.bus[pvBus].qGenMvar, 0)} Mvar — it can give only {base.buses[pvBus].qMaxMvar} Mvar.
                </p>
              )}
            </Callout>
          )}
          {over.length > 0 && <p className="small ps-lf-warn">Overloaded: {over.map((l) => `line ${l.id} ${fx(l.loadingPct!, 0)} %`).join(', ')}.</p>}
          <details className="ps-more">
            <summary>Case data</summary>
            <CaseData c={c} />
          </details>
        </aside>
      </div>
      {cut.length > 0 && view !== 'ybus' ? (
        <Callout tone="bad" title="The network is split">
          <p>{sol.error} Return a line to service.</p>
        </Callout>
      ) : (
        <>
          {view === 'ybus' && <YbusBuilder c={c} steps={steps} count={cnt} setCount={setCount} Yfinal={Y} />}
          {view === 'nr' && <NrStepper c={c} run={run} idx={Math.min(idx, run.records.length - 1)} setIdx={setIdx} lb={lb} />}
          {view === 'gs' && <GsCompare c={c} Y={Y} lb={lb} nr={run} alpha={alpha} setAlpha={setAlpha} />}
          {view === 'results' &&
            (sol.converged ? (
              <Results sol={sol} />
            ) : (
              <Callout tone="bad" title="No results">
                <p>The load flow has no solution for these settings — see the Newton–Raphson view to watch it fail.</p>
              </Callout>
            ))}
        </>
      )}
    </div>
  )
}

function CaseData({ c }: { c: LfCase }) {
  return (
    <div className="ps-lf-casedata">
      <table className="ps-table">
        <thead>
          <tr>
            <th scope="col">Bus</th>
            <th scope="col">Type</th>
            <th scope="col">|V| set</th>
            <th scope="col">P_G</th>
            <th scope="col">Load</th>
          </tr>
        </thead>
        <tbody>
          {c.buses.map((b, i) => (
            <tr key={i}>
              <td>
                {b.tag} {c.id === 'five' ? b.name : ''}
              </td>
              <td>{TYPE_NAME[b.type]}</td>
              <td>{b.type === 'pq' ? '—' : fx(b.vSet, 2)}</td>
              <td>{b.type === 'pv' ? fx(b.pGenMw, 0) : b.type === 'slack' ? 'solved' : '—'}</td>
              <td>{b.pLoadMw ? `${fx(b.pLoadMw, 0)} + j${fx(b.qLoadMvar, 0)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.id === 'five' && <p className="small muted">Lines: 230 kV, 0.05 + j0.48 Ω/km, 3.4 µS/km; lengths {c.lines.map((l) => `${l.id} ${l.km} km`).join(', ')}.</p>}
      <p className="small muted">{c.source}</p>
    </div>
  )
}

// ── Experiment ─────────────────────────────────────────────────────────────────────────────────────────────────

function Experiments() {
  const [current, setCurrent] = useState(EXPERIMENTS[0].id)
  const progress = usePsProgress()
  const e = EXPERIMENTS.find((x) => x.id === current)!
  const onAnswered = (id: string) => {
    completeActivity(MODULE, `exp-${id}`)
    const done = new Set([...EXPERIMENTS.filter((x) => isDone(progress, MODULE, `exp-${x.id}`)).map((x) => x.id), id])
    if (done.size >= 3) completeActivity(MODULE, 'experiments')
  }
  return (
    <div className="ps-stack">
      <nav className="ps-lf-explist" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the load flow says. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-lf-expitem ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-lf-expn" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <ExperimentRun key={e.id} e={e} onAnswered={() => onAnswered(e.id)} />
    </div>
  )
}

function ExperimentRun({ e, onAnswered }: { e: LfExperiment; onAnswered(): void }) {
  const r = useMemo(() => runExperiment(e), [e])
  const [answered, setAnswered] = useState(false)
  const [show, setShow] = useState<'before' | 'after'>('before')
  const answer = e.answer(r)
  useTutorContext(
    () => `Experiment mode — "${e.title}" on the ${r.base.name}. ${e.change} Question: ${e.question} ${answered ? `Result: ${e.explain(r).join(' ')}` : 'The student has not predicted yet.'}`,
  )
  const shown = show === 'after' ? r.after : r.before
  const shownCase = show === 'after' ? r.after.case : r.before.case
  return (
    <>
      <div className="ps-lf-exprun ps-stack">
        <div className="ps-card">
          <p className="eyebrow">Experiment · {r.base.short}</p>
          <h3>{e.title}</h3>
          <p>{e.change}</p>
        </div>
        <Predict
          question={e.question}
          options={e.options}
          answer={answer}
          onAnswered={() => {
            setAnswered(true)
            setShow('after')
            onAnswered()
          }}
          why={
            <>
              {e.explain(r).map((p, k) => (
                <p key={k}>{p}</p>
              ))}
            </>
          }
        />
      </div>
      {answered && (
        <>
          {e.id === 'nose' && r.nose && <NosePlot r={r} />}
          {e.id === 'start' && <StartLab r={r} />}
          {e.id !== 'start' && (
            <>
              <div className="ps-toolbar">
                <Seg
                  label="Network shown"
                  value={show}
                  onChange={(v) => setShow(v as 'before' | 'after')}
                  options={[
                    { id: 'before', label: 'Before' },
                    { id: 'after', label: e.id === 'nose' ? 'At the maximum load' : 'After' },
                  ]}
                />
              </div>
              <div className={`ps-diagram ps-lf-diagram ps-lf-diagram--${r.base.id}`}>
                <LfDiagram
                  c={shownCase}
                  label={`${r.base.name}, ${show}`}
                  busV={shown.converged ? shown.bus : null}
                  flows={shown.converged ? shown.lines : null}
                  types={shown.converged ? shown.bus.map((b) => b.type) : undefined}
                  limited={shown.converged ? shown.bus.flatMap((b, i) => (b.atQLimit ? [i] : [])) : []}
                  highlightBuses={e.focus}
                />
              </div>
            </>
          )}
          <CompareTable e={e} before={r.before} after={r.after} afterLabel={e.id === 'nose' ? 'At max. load' : e.id === 'start' ? 'Poor start' : 'After'} />
        </>
      )}
    </>
  )
}

function CompareTable({ e, before, after, afterLabel }: { e: LfExperiment; before: CaseSolution; after: CaseSolution; afterLabel: string }) {
  return (
    <div className="ps-card table-wrap ps-lf-compare">
      <table className="ps-table">
        <caption className="sr-only">Before and after: {e.title}</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">Before</th>
            <th scope="col">{afterLabel}</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {e.rows.map((row) => {
            const b = row.get(before)
            const a = row.get(after)
            const d = a !== null && b !== null ? a - b : null
            return (
              <tr key={row.label} className={d !== null && Math.abs(d) > 10 ** -row.decimals ? 'is-changed' : ''}>
                <td>{row.label}</td>
                <td>{b === null ? '—' : `${fx(b, row.decimals)} ${row.unit}`}</td>
                <td>{a === null ? 'no solution' : `${fx(a, row.decimals)} ${row.unit}`}</td>
                <td className={d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d === null ? '—' : `${d > 0 ? '+' : ''}${fx(d, row.decimals)}`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const BUS_COLORS = ['var(--accent)', 'var(--warning)', 'var(--ps-lv)']

function NosePlot({ r }: { r: ReturnType<typeof runExperiment> }) {
  const n = r.nose!
  const lim = n.points.find((p) => p.qLimited.length > 0)
  const buses = [2, 3, 4]
  return (
    <div className="ps-lf-noserow">
      <Plot
        label="P–V curve: bus voltages against total load"
        series={buses.map((b, k) => ({ id: `b${b}`, label: r.base.buses[b].name, color: BUS_COLORS[k], points: n.points.map((p) => [p.loadMw, p.vm[b]] as [number, number]) }))}
        xLabel="Total load [MW]"
        yLabel="|V| [pu]"
        yDomain={[0.5, 1.05]}
        vlines={[...(lim ? [{ x: lim.loadMw, label: 'East plant at Q limit' }] : []), { x: n.maxLoadMw, label: `max ${fx(n.maxLoadMw, 0)} MW` }]}
        hlines={[{ y: 0.95, label: '0.95 pu' }]}
        height={260}
      />
      <div className="ps-card">
        <h3>How it was traced</h3>
        <p>
          {n.points.length} load flows, each started from the previous solution. A solution exists at {fx(n.lo, 3)} × the base load and none was found at {fx(n.hi, 3)} ×: the maximum loadability lies
          between ({fx(n.maxLoadMw, 1)} and {fx((n.maxLoadMw * n.hi) / n.lo, 1)} MW).
        </p>
        <p className="small muted">
          Only the upper half of the nose is traced: the lower half (same load, lower voltage) needs a continuation method, which this module does not use. The steps get smaller near the tip because
          Newton–Raphson needs a closer start there.
        </p>
      </div>
    </div>
  )
}

function StartLab({ r }: { r: ReturnType<typeof runExperiment> }) {
  const [v0, setV0] = useState(r.poorV ?? 0.2)
  const run = useMemo(() => startFrom(r.base, v0), [r.base, v0])
  const flat = r.flat!
  const outcome = !run.converged
    ? `no convergence — ${run.error}`
    : Math.abs(run.Vm[1] - flat.Vm[1]) < 1e-6
      ? `the normal solution (|V₂| = ${fx(run.Vm[1], 4)} pu) in ${run.iterations} iterations`
      : `a DIFFERENT solution: |V₂| = ${fx(run.Vm[1], 4)} pu, in ${run.iterations} iterations`
  return (
    <div className="ps-lf-noserow">
      <Plot
        label="Convergence from the flat start and from a poor start"
        series={[
          { id: 'flat', label: 'Flat', color: 'var(--accent)', points: flat.history.map((m, k) => [k, log10m(m)]) },
          { id: 'poor', label: `From ${fx(v0, 2)}`, color: 'var(--warning)', points: run.history.map((m, k) => [k, log10m(m)]) },
        ]}
        xLabel="Iteration"
        yLabel="log₁₀ largest mismatch [pu]"
        xDomain={[0, Math.max(6, run.history.length - 1, flat.history.length - 1)]}
        yDomain={[-16, 2]}
        hlines={[{ y: -8, label: 'tolerance' }]}
        height={240}
      />
      <div className="ps-card">
        <h3>Try other starting voltages</h3>
        <Slider label="Starting |V₂|" value={v0} min={0.05} max={1.5} step={0.05} unit="pu" decimals={2} onChange={setV0} hint="θ₂ = θ₃ = 0 at the start" />
        <p aria-live="polite">
          From |V₂| = {fx(v0, 2)} pu, Newton–Raphson reaches <b>{outcome}</b>.
        </p>
      </div>
    </div>
  )
}

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Verify() {
  const progress = usePsProgress()
  const c = useMemo(() => CASES.saadat(), [])
  const sol = useMemo(() => solveCase(c), [c])
  const { Y } = useMemo(() => ybusSteps(c), [c])
  const lb = useMemo(() => lfBuses(c), [c])
  const run = useMemo(() => newtonRaphson(Y, lb), [Y, lb])
  useTutorContext(
    () =>
      `Verify mode: hand checks on the Saadat 3-bus load flow — Y_bus entries, the flat-start mismatch, a Jacobian entry by finite difference, the bus-2 injection from the solved voltages, a line flow and its loss, the power balance.`,
  )
  const inv = (z: Complex) => {
    const d = z.re * z.re + z.im * z.im
    return C(z.re / d, -z.im / d)
  }
  const [L12, L13, L23] = c.lines
  const y12 = inv(C(L12.r, L12.x))
  const y23 = inv(C(L23.r, L23.x))
  const y13 = inv(C(L13.r, L13.x))
  const Y22 = add(y12, y23)
  const Ysh = ybusFromImpedances(
    3,
    c.lines.map((l) => ({ i: l.from, k: l.to, z: C(l.r, l.x) })),
  )
  const ok = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
  // flat start, bus 2
  const V0 = [c.buses[0].vSet, 1, c.buses[2].vSet]
  const P2flat = V0[1] * (Y[1][0].re * V0[0] + Y[1][1].re * V0[1] + Y[1][2].re * V0[2])
  const Q2flat = -V0[1] * (Y[1][0].im * V0[0] + Y[1][1].im * V0[1] + Y[1][2].im * V0[2])
  const r0 = run.records[0]
  // Jacobian entry ∂P2/∂θ2 by central difference
  const h = 1e-6
  const th0 = [0, 0, 0]
  const Pplus = injectionsPolar(Y, V0, [0, h, 0]).P[1]
  const Pminus = injectionsPolar(Y, V0, [0, -h, 0]).P[1]
  const fd = (Pplus - Pminus) / (2 * h)
  const Jan = jacobian(Y, V0, th0, r0.angIdx, r0.magIdx)[0][0]
  // injection at bus 2 from the solved voltages
  const V = sol.V
  const I2 = Y[1].reduce((s, y, k) => add(s, mul(y, V[k])), ZERO)
  const S2 = mul(V[1], conj(I2))
  // line 1–2
  const I12 = mul(y12, sub(V[0], V[1]))
  const S12 = scale(mul(V[0], conj(I12)), 100)
  const S21 = scale(mul(V[1], conj(scale(I12, -1))), 100)
  const loss12 = add(S12, S21)
  const i2r = abs(I12) ** 2 * L12.r * 100
  const f12 = sol.lines[0]
  const t = sol.totals
  const quiz: QuizItem[] = [
    {
      id: 'b33',
      kind: 'number',
      q: `From the line data, what is the imaginary part B₃₃ of Y₃₃ (in pu)? Line 1–3 is ${cx(L13.r, L13.x, 4)} pu and line 2–3 is ${cx(L23.r, L23.x, 4)} pu.`,
      answer: Y[2][2].im,
      unit: 'pu',
      tol: 0.05,
      why: `Y₃₃ = y₁₃ + y₂₃ = (${cx(y13.re, y13.im, 2)}) + (${cx(y23.re, y23.im, 2)}) = ${cx(Y[2][2].re, Y[2][2].im, 2)} pu, so B₃₃ = ${fx(Y[2][2].im, 2)}.`,
    },
    {
      id: 'loss23',
      kind: 'number',
      q: `Line 2–3 carries S₂₃ = ${cx(sol.lines[2].pFromMw, sol.lines[2].qFromMvar, 2)} MW/Mvar into its bus-2 end and S₃₂ = ${cx(sol.lines[2].pToMw, sol.lines[2].qToMvar, 2)} into its bus-3 end. What is its active power loss?`,
      answer: sol.lines[2].lossMw,
      unit: 'MW',
      tol: 0.02,
      why: `Loss = P₂₃ + P₃₂ = ${fx(sol.lines[2].pFromMw, 2)} + ${fx(sol.lines[2].pToMw, 2)} = ${fx(sol.lines[2].lossMw, 3)} MW.`,
    },
  ]
  return (
    <div className="ps-stack">
      <Callout title="Check the load flow by hand">
        <p>
          The numbers in this module come from the Newton–Raphson solver. Here each one is recomputed from first principles on Saadat’s 3-bus system, independently of the solver.{' '}
          {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · Y_bus entries from the line data"
        steps={[
          { label: 'y₁₂ = 1 / z₁₂', expr: `1 / (${cx(L12.r, L12.x, 4)})`, result: `${cx(y12.re, y12.im, 3)} pu` },
          { label: 'y₂₃ = 1 / z₂₃', expr: `1 / (${cx(L23.r, L23.x, 4)})`, result: `${cx(y23.re, y23.im, 3)} pu` },
          { label: 'Y₂₂ = y₁₂ + y₂₃', expr: `(${cx(y12.re, y12.im, 2)}) + (${cx(y23.re, y23.im, 2)})`, result: `${cx(Y22.re, Y22.im, 3)} pu` },
          { label: 'Y₂₃ = −y₂₃', expr: `−(${cx(y23.re, y23.im, 2)})`, result: `${cx(-y23.re, -y23.im, 3)} pu` },
        ]}
        check={{
          ok: abs(sub(Y22, Y[1][1])) < 1e-12 && abs(sub(Y22, Ysh[1][1])) < 1e-12 && abs(sub(C(-y23.re, -y23.im), Ysh[1][2])) < 1e-12,
          text: `The module’s step-by-step Y_bus and the shared builder both give Y₂₂ = ${cx(Y[1][1].re, Y[1][1].im, 3)} and Y₂₃ = ${cx(Y[1][2].re, Y[1][2].im, 3)}.`,
        }}
      />
      <Calc
        title="2 · The flat-start mismatch at bus 2"
        steps={[
          { label: 'P₂ at θ = 0', expr: `|V₂|·Σ|V_k|·G₂k = 1 × (${fx(Y[1][0].re, 0)}×${fx(V0[0], 2)} + ${fx(Y[1][1].re, 0)}×1 + ${fx(Y[1][2].re, 0)}×${fx(V0[2], 2)})`, result: `${fx(P2flat, 4)} pu` },
          { label: 'Q₂ at θ = 0', expr: `−|V₂|·Σ|V_k|·B₂k = −(${fx(Y[1][0].im, 0)}×${fx(V0[0], 2)} + ${fx(Y[1][1].im, 0)}×1 + ${fx(Y[1][2].im, 0)}×${fx(V0[2], 2)})`, result: `${fx(Q2flat, 4)} pu` },
          { label: 'ΔP₂ = P₂,spec − P₂', expr: `${fx(lb[1].p, 2)} − (${fx(P2flat, 4)})`, result: `${fx(lb[1].p - P2flat, 4)} pu` },
          { label: 'ΔQ₂ = Q₂,spec − Q₂', expr: `${fx(lb[1].q, 2)} − (${fx(Q2flat, 4)})`, result: `${fx(lb[1].q - Q2flat, 4)} pu` },
        ]}
        check={{
          ok: ok(lb[1].p - P2flat, r0.dP[0], 1e-12) && ok(lb[1].q - Q2flat, r0.dQ[0], 1e-12),
          text: `The iteration view’s first mismatch vector has ΔP₂ = ${fx(r0.dP[0], 4)} and ΔQ₂ = ${fx(r0.dQ[0], 4)} — the same. (With θ = 0, cos = 1 and sin = 0, so only G enters P and only B enters Q.)`,
        }}
      />
      <Calc
        title="3 · A Jacobian entry, by finite differences"
        steps={[
          { label: 'Formula ∂P₂/∂θ₂', expr: `−Q₂ − B₂₂|V₂|² = −(${fx(Q2flat, 4)}) − (${fx(Y[1][1].im, 2)})`, result: fx(-Q2flat - Y[1][1].im, 4) },
          { label: 'Nudge θ₂ by ±10⁻⁶ rad', expr: `(P₂(+h) − P₂(−h)) / 2h = (${fx(Pplus, 6)} − ${fx(Pminus, 6)}) / 2×10⁻⁶`, result: fx(fd, 4) },
          { label: 'Solver’s J at the flat start', expr: 'J1, row P₂, column θ₂', result: fx(Jan, 4) },
        ]}
        check={{ ok: Math.abs(fd - Jan) / Math.abs(Jan) < 1e-6, text: `The analytic derivative and the numerical one agree to ${sci(Math.abs(fd - Jan) / Math.abs(Jan))} (relative difference).` }}
      />
      <Calc
        title="4 · The solved voltages really satisfy bus 2"
        steps={[
          { label: 'Solved voltages (pu)', expr: `V₁ = ${cx(V[0].re, V[0].im, 4)}, V₂ = ${cx(V[1].re, V[1].im, 5)}, V₃ = ${cx(V[2].re, V[2].im, 5)}`, result: `|V₂| = ${fx(abs(V[1]), 5)}` },
          { label: 'I₂ = Σ Y₂k·V_k', expr: 'complex sum over the three buses', result: `${cx(I2.re, I2.im, 4)} pu` },
          { label: 'S₂ = V₂·I₂*', expr: `(${cx(V[1].re, V[1].im, 4)})·(${cx(I2.re, -I2.im, 4)})`, result: `${cx(S2.re, S2.im, 6)} pu` },
        ]}
        check={{ ok: abs(sub(S2, C(lb[1].p, lb[1].q))) < 1e-8, text: `Specified: −4 − j2.5 pu (the 400 MW + j250 Mvar load). The residual is ${sci(abs(sub(S2, C(lb[1].p, lb[1].q))))} pu.` }}
      />
      <Calc
        title="5 · Line 1–2: the flow at each end and its loss"
        steps={[
          { label: 'I₁₂ = y₁₂·(V₁ − V₂)', expr: `(${cx(y12.re, y12.im, 0)})·(${cx(V[0].re - V[1].re, V[0].im - V[1].im, 5)})`, result: `${cx(I12.re, I12.im, 4)} pu` },
          { label: 'S₁₂ = V₁·I₁₂* × 100', expr: 'MW, Mvar into the line at bus 1', result: cx(S12.re, S12.im, 3) },
          { label: 'S₂₁ = V₂·(−I₁₂)* × 100', expr: 'into the line at bus 2', result: cx(S21.re, S21.im, 3) },
          { label: 'Loss = S₁₂ + S₂₁', expr: `${cx(S12.re, S12.im, 3)} + (${cx(S21.re, S21.im, 3)})`, result: `${cx(loss12.re, loss12.im, 3)}` },
          { label: '|I₁₂|²·r₁₂ × 100', expr: `${fx(abs(I12), 5)}² × ${L12.r} × 100`, result: `${fx(i2r, 3)} MW` },
        ]}
        check={{ ok: ok(loss12.re, i2r, 1e-9) && ok(S12.re, f12.pFromMw, 1e-9), text: `S₁₂ + S₂₁ and |I|²r agree; the Results table shows the same ${fx(f12.lossMw, 3)} MW for line 1–2.` }}
      />
      <Calc
        title="6 · Energy is conserved"
        steps={[
          { label: 'Generation', expr: `slack ${fx(sol.bus[0].pGenMw, 3)} + bus 3 ${fx(sol.bus[2].pGenMw, 3)}`, result: `${fx(t.pGen, 3)} MW` },
          { label: 'Load + losses', expr: `${fx(t.pLoad, 0)} + (${sol.lines.map((l) => fx(l.lossMw, 3)).join(' + ')})`, result: `${fx(t.pLoad + t.pLoss, 3)} MW` },
          { label: 'Difference', expr: `${fx(t.pGen, 3)} − ${fx(t.pLoad + t.pLoss, 3)}`, result: `${sci(t.pGen - t.pLoad - t.pLoss)} MW` },
        ]}
        check={{ ok: ok(t.pGen, t.pLoad + t.pLoss, 1e-6), text: 'ΣP_gen = ΣP_load + losses, to within 10⁻⁶ MW.' }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

// ── Practise ───────────────────────────────────────────────────────────────────────────────────────────────────

function Practise() {
  const sa = useMemo(() => solveCase(CASES.saadat()), [])
  const five = useMemo(() => CASES.five(), [])
  const fiveSol = useMemo(() => solveCase(five), [five])
  const { Y } = useMemo(() => ybusSteps(CASES.saadat()), [])
  const fiveY = useMemo(() => ybusSteps(five).Y, [five])
  const fiveLb = useMemo(() => lfBuses(five), [five])
  const gs = useMemo(() => {
    const exp = EXPERIMENTS.find((e) => e.id === 'qlimit')!
    return runExperiment(exp)
  }, [])
  const nrFive = useMemo(() => newtonRaphson(fiveY, fiveLb), [fiveY, fiveLb])
  const gsFive = useMemo(() => gaussSeidel(fiveY, fiveLb), [fiveY, fiveLb])
  const nEq = 2 * five.buses.filter((b) => b.type === 'pq').length + five.buses.filter((b) => b.type === 'pv').length
  const items: QuizItem[] = [
    {
      id: 'pv',
      kind: 'choice',
      q: 'At a PV (generator) bus, which two quantities does the load flow have to find?',
      options: [
        { id: 'pq', label: 'P and Q' },
        { id: 'qth', label: 'Q and the voltage angle θ' },
        { id: 'vth', label: '|V| and θ' },
      ],
      answer: 'qth',
      why: 'P is scheduled and the voltage regulator holds |V|; the reactive power needed to hold that voltage, and the angle, follow from the network.',
    },
    {
      id: 'neq',
      kind: 'number',
      q: `The illustrative 5-bus network has ${five.buses.filter((b) => b.type === 'slack').length} slack, ${five.buses.filter((b) => b.type === 'pv').length} PV and ${five.buses.filter((b) => b.type === 'pq').length} PQ buses. How many equations does Newton–Raphson solve (the Jacobian’s size)?`,
      answer: nEq,
      unit: 'equations',
      tol: 0,
      why: `One ΔP for every non-slack bus and one ΔQ for every PQ bus: 2 × ${five.buses.filter((b) => b.type === 'pq').length} + ${five.buses.filter((b) => b.type === 'pv').length} = ${nEq} — the iteration view shows a ${nrFive.records[0].J?.length ?? nEq} × ${nrFive.records[0].J?.length ?? nEq} Jacobian.`,
    },
    {
      id: 'y12',
      kind: 'number',
      q: 'Saadat’s line 1–2 is 0.02 + j0.04 pu. What is the imaginary part of the off-diagonal entry Y₁₂ (pu)?',
      answer: Y[0][1].im,
      unit: 'pu',
      tol: 0.05,
      why: `y₁₂ = 1/(0.02 + j0.04) = ${cx(-Y[0][1].re, -Y[0][1].im, 1)}, and Y₁₂ = −y₁₂ = ${cx(Y[0][1].re, Y[0][1].im, 1)}: the imaginary part is +${fx(Y[0][1].im, 1)}.`,
    },
    {
      id: 'slack',
      kind: 'number',
      q: `In Saadat’s system the load is ${fx(sa.totals.pLoad, 0)} MW, bus 3 generates ${fx(sa.bus[2].pGenMw, 0)} MW and the lines lose ${fx(sa.totals.pLoss, 2)} MW. What does the slack generator supply?`,
      answer: sa.bus[0].pGenMw,
      unit: 'MW',
      tol: 0.05,
      why: `P_slack = load + losses − other generation = ${fx(sa.totals.pLoad, 0)} + ${fx(sa.totals.pLoss, 2)} − ${fx(sa.bus[2].pGenMw, 0)} = ${fx(sa.bus[0].pGenMw, 2)} MW.`,
    },
    {
      id: 'quad',
      kind: 'choice',
      q: 'Close to the solution, a Newton–Raphson iteration leaves a largest mismatch of 10⁻³ pu. What should the next one be, roughly?',
      options: [
        { id: 'a', label: 'About 10⁻⁴ pu' },
        { id: 'b', label: 'About 10⁻⁶ pu' },
        { id: 'c', label: 'About 0.5 × 10⁻³ pu' },
      ],
      answer: 'b',
      why: `Quadratic convergence: the error is roughly squared, so the exponent doubles. Saadat’s history: ${sa.history.map((m) => sci(m, 1)).join(' → ')} pu.`,
    },
    {
      id: 'gs',
      kind: 'choice',
      q: 'On the 5-bus network, how do plain Gauss–Seidel (α = 1) and Newton–Raphson compare in iterations to reach 10⁻⁸ pu?',
      options: [
        { id: 'same', label: 'About the same' },
        { id: 'gs', label: 'Gauss–Seidel needs many times more' },
        { id: 'nr', label: 'Newton–Raphson needs more — each of its iterations does more work' },
      ],
      answer: gsFive.converged && gsFive.iterations > 3 * nrFive.iterations ? 'gs' : gsFive.iterations < nrFive.iterations ? 'nr' : 'same',
      why: `Gauss–Seidel: ${gsFive.iterations} iterations; Newton–Raphson: ${nrFive.iterations}. Each NR iteration costs more (a Jacobian to build and solve), but its quadratic convergence wins.`,
    },
    {
      id: 'qlim',
      kind: 'choice',
      q: 'A PV generator would need more reactive power than its limit to hold its voltage. In the load flow it…',
      options: [
        { id: 'keep', label: 'stays a PV bus; the slack bus makes up the difference' },
        { id: 'pq', label: 'is held at its Q limit and becomes a PQ bus — its voltage is no longer held' },
        { id: 'trip', label: 'is disconnected' },
      ],
      answer: 'pq',
      why: `With a 100 Mvar limit, Saadat’s bus 3 is held at ${fx(gs.after.bus[2].qGenMvar, 0)} Mvar and its voltage falls from ${fx(gs.before.bus[2].vm, 4)} to ${fx(gs.after.bus[2].vm, 4)} pu.`,
    },
    {
      id: 'loss-sign',
      kind: 'choice',
      q: `The 5-bus network’s lines lose ${fx(fiveSol.totals.pLoss, 2)} MW but have a total reactive “loss” of ${fx(fiveSol.totals.qLoss, 1)} Mvar. Why is the Mvar figure negative?`,
      options: [
        { id: 'charging', label: 'The lines’ capacitance (charging) produces more Mvar than their reactance absorbs' },
        { id: 'error', label: 'A sign error — losses cannot be negative' },
        { id: 'loads', label: 'The loads return reactive power to the lines' },
      ],
      answer: 'charging',
      why: `At these loadings the lines’ charging produces ${fx(fiveSol.totals.qCharging, 1)} Mvar, more than the I²X they absorb.`,
    },
    {
      id: 'nose',
      kind: 'choice',
      q: 'Near the maximum loadability (the tip of the P–V nose), why does Newton–Raphson stop converging?',
      options: [
        { id: 'slack', label: 'The slack generator runs out of active power' },
        { id: 'jac', label: 'The Jacobian becomes singular — beyond the tip no solution exists' },
        { id: 'iter', label: 'It needs more than 30 iterations because the network is large' },
      ],
      answer: 'jac',
      why: 'At the tip, a small extra load needs an infinite change of voltage: the Jacobian’s determinant passes through zero. The slack bus is an ideal source in the model — it never runs out.',
    },
  ]
  useTutorContext(
    () =>
      `Practise mode: questions on load flow (bus types, Y_bus, Jacobian size, slack generation, convergence, Q limits, line charging, maximum loadability) using the Saadat 3-bus and the illustrative 5-bus networks.`,
  )
  return (
    <div className="ps-card ps-lf-practise">
      <h3>Practice questions</h3>
      <p className="small muted">Every number comes from this module’s load flows. Answer all of them correctly to complete the activity.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
