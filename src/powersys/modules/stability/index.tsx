import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Plot, type PlotSeries } from '../../ui/Plot.tsx'
import { Calc, Callout, Eq, Predict, Quiz, Readouts, Seg, Slider, Stepper, Toggle, useReducedMotion, useTutorContext, type QuizItem, type ReadoutItem } from '../../ui/kit.tsx'
import { EXPERIMENTS, type Experiment, type FreqCase, type SwingCase } from './experiments.ts'
import { FREQ0, rocof0, shareWithoutAgc, simulateFrequency, steadyStateHz, type FreqParams, type FreqRun } from './frequency.ts'
import { PowerAngleChart, type PdMarker } from './PowerAngleChart.tsx'
import { SmibDiagram, type NetState } from './SmibDiagram.tsx'
import {
  angleDuringBusFault,
  areaAcc,
  areaDec,
  criticalAngle,
  criticalTimeBusFault,
  deg,
  delta0,
  deltaMax,
  measuredFrequency,
  naturalFreq,
  powerLimits,
  SMIB0,
  simulateSwing,
  summarise,
  syncPower,
  ws,
  type SmibParams,
  type SmibSummary,
  type SwingRun,
} from './swing.ts'
import './stability.css'

/*
 * Module 6 — Stability & Frequency Control. Two linked models, every number computed:
 *  · rotor-angle stability of one machine on an infinite bus (classical model, swing equation by RK4, equal areas,
 *    critical clearing time by closed form and by bisection on the simulation) — swing.ts;
 *  · frequency control of one area (inertia, load damping, droop, governor and turbine lags, AGC) — frequency.ts.
 * Learn: a guided tour. Explore: run faults and load steps. Experiment: predict, then compare two runs.
 * Verify: hand calculations checked against the simulations. Practise: questions with numbers from the models.
 */

const MODULE = 'stability'
const T_SWING = 3
const T_FREQ = 40
const SPEED = 0.5
type Topic = 'angle' | 'frequency'

const C_A = 'var(--ps-c)'
const C_B = 'var(--ps-a)'
const C_C = 'var(--ps-mv)'
const C_D = 'var(--ps-b)'

// ── shared helpers ─────────────────────────────────────────────────────────────────────────────────────────────

const ms = (s: number) => `${fx(s * 1000, 0)} ms`
const dg = (r: number, d = 1) => `${fx(deg(r), d)}°`

/** The index of the last sample at or before t. */
function indexAt(t: number[], x: number): number {
  let lo = 0
  let hi = t.length - 1
  if (x >= t[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= x) lo = mid
    else hi = mid
  }
  return lo
}

/** Samples of a swing run for plotting — an unstable run is cut shortly after it has gone (δ > 200°). */
function swingSeries(r: SwingRun, upTo = Infinity) {
  const d: Array<[number, number]> = []
  const w: Array<[number, number]> = []
  for (let i = 0; i < r.t.length && r.t[i] <= upTo + 1e-9; i++) {
    if (!r.stable && deg(r.d[i]) > 200) break
    d.push([r.t[i], deg(r.d[i])])
    w.push([r.t[i], r.w[i]])
  }
  return { d, w }
}

function freqSeries(r: FreqRun, upTo: number) {
  const f: Array<[number, number]> = []
  const pm: Array<[number, number]> = []
  for (let i = 0; i < r.t.length && r.t[i] <= upTo + 1e-9; i++) {
    f.push([r.t[i], r.df[i]])
    pm.push([r.t[i], r.dPm[i]])
  }
  return { f, pm }
}

/** The equal-area numbers of a fault run: A1 from δ0 to δc, A2 available from δc to δmax. */
function areasOf(s: SmibSummary, Pm: number, r: SwingRun) {
  const A1 = Number.isFinite(r.dc) ? areaAcc(Pm, s.lim.P2, s.d0, r.dc) : NaN
  const A2max = Number.isFinite(s.dMax) && Number.isFinite(r.dc) && r.dc < s.dMax ? areaDec(Pm, s.lim.P3, r.dc, s.dMax) : 0
  return { A1, A2max }
}

/** Playback of a simulated run: the time shown, play/pause at half speed (none under reduced motion). */
function usePlayback(tEnd: number, key: unknown) {
  const reduced = useReducedMotion()
  const [t, setTState] = useState(tEnd)
  const [playing, setPlaying] = useState(false)
  const tRef = useRef(tEnd)
  const set = useCallback((v: number) => {
    tRef.current = v
    setTState(v)
  }, [])
  useEffect(() => {
    setPlaying(false)
    set(tEnd)
  }, [key, tEnd, set])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const n = Math.min(tEnd, tRef.current + dt * SPEED)
      set(n)
      if (n >= tEnd) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, tEnd, set])
  return {
    t,
    playing,
    reduced,
    scrub: (v: number) => {
      setPlaying(false)
      set(v)
    },
    play: () => {
      if (tRef.current >= tEnd - 1e-6) set(0)
      setPlaying(true)
    },
    pause: () => setPlaying(false),
  }
}

// ── the module ─────────────────────────────────────────────────────────────────────────────────────────────────

export default function StabilityModule({ mode, setMode }: ModuleProps) {
  const [sp, setSp] = useState<SmibParams>(SMIB0)
  const [fp, setFp] = useState<FreqParams>(FREQ0)
  const [topic, setTopic] = useState<Topic>('angle')
  return (
    <div className="ps-st">
      {mode === 'learn' && (
        <Learn
          onExplore={(t) => {
            setTopic(t)
            setMode('explore')
          }}
        />
      )}
      {mode === 'explore' && <Explore topic={topic} setTopic={setTopic} sp={sp} setSp={setSp} fp={fp} setFp={setFp} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify sp={sp} fp={fp} edited={sp !== SMIB0 || fp !== FREQ0} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── Learn ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Learn({ onExplore }: { onExplore(t: Topic): void }) {
  const [step, setStep] = useState(0)
  const p = SMIB0
  const s = useMemo(() => summarise(p), [p])
  const run = useMemo(() => simulateSwing(p, { kind: 'fault' }, { tEnd: T_SWING, keepEvery: 2 }), [p])
  const late = useMemo(() => simulateSwing({ ...p, tc: 0.25 }, { kind: 'fault' }, { tEnd: T_SWING, keepEvery: 2 }), [p])
  const dP = 0.05
  const kick = useMemo(() => simulateSwing(p, { kind: 'step', dPm: dP }, { tEnd: T_SWING, keepEvery: 1 }), [p])
  const d1 = delta0(p.Pm + dP, s.lim.P1)
  const fKick = measuredFrequency(kick.t, kick.d, d1)
  const fn1 = naturalFreq(p.f0, p.H, syncPower(s.lim.P1, d1)) / (2 * Math.PI)
  const { A1, A2max } = areasOf(s, p.Pm, run)
  const f = FREQ0
  const prim = useMemo(() => simulateFrequency(f, { tEnd: T_FREQ, keepEvery: 2 }), [f])
  const agc = useMemo(() => simulateFrequency({ ...f, agc: true }, { tEnd: T_FREQ, keepEvery: 2 }), [f])
  const share = shareWithoutAgc(f)
  const W = ws(p.f0)

  const pdFull = (withAreas: boolean, r: SwingRun) => (
    <PowerAngleChart
      lim={s.lim}
      Pm={p.Pm}
      areas={withAreas ? { d0: s.d0, dc: r.dc, d2: r.stable ? r.dPeak : s.dMax, dMax: s.dMax, lost: !r.stable } : null}
      markers={[{ d: s.d0, label: 'δ₀' }, { d: r.dc, label: 'δ_c' }, ...(withAreas ? [{ d: s.dcr, label: 'δ_cr', strong: true }] : []), { d: s.dMax, label: 'δ_max' }]}
      path={{ d: r.d, pe: r.pe }}
      point={{ d: r.d[r.d.length - 1], pe: r.pe[r.pe.length - 1] }}
      label={`Power–angle curves before, during and after a fault at the HV bus, with the path of the operating point${withAreas ? ' and the equal areas' : ''}`}
    />
  )
  const freqPlot = (runs: Array<{ r: FreqRun; label: string; color: string }>, upTo: number, tangent: boolean, hl: boolean) => {
    const series: PlotSeries[] = runs.map((x) => ({ id: x.label, label: x.label, color: x.color, points: freqSeries(x.r, upTo).f }))
    if (tangent) {
      const r0 = rocof0(f)
      const t1 = Math.min(upTo, (Math.abs(prim.nadir) / Math.abs(r0)) * 1.1)
      series.push({
        id: 'tan',
        label: 'initial slope',
        color: 'var(--text-3)',
        points: [
          [0, 0],
          [t1, r0 * t1],
        ],
        dashed: true,
      })
    }
    return (
      <Plot
        series={series}
        xLabel="Time [s]"
        yLabel="Δf [Hz]"
        xDomain={[0, upTo]}
        hlines={hl ? [{ y: steadyStateHz(f), label: `Δf_ss = ${fx(steadyStateHz(f), 3)} Hz` }] : []}
        vlines={[{ x: runs[0].r.tNadir, label: `nadir ${fx(runs[0].r.nadir, 3)} Hz` }]}
        label="Frequency deviation after a load step"
        height={260}
      />
    )
  }

  const steps: Array<{ title: string; figure: ReactNode; body: ReactNode }> = [
    {
      title: 'One generator, one strong grid',
      figure: (
        <div className="ps-stack">
          <SmibDiagram Xg={p.Xg} Xl={p.Xl} E={p.E} V={p.V} fault={p.fault} state="pre" showFault={false} />
          <PowerAngleChart
            lim={s.lim}
            Pm={p.Pm}
            curves={{ pre: true }}
            markers={[{ d: s.d0, label: `δ₀ ${dg(s.d0)}` }]}
            point={{ d: s.d0, pe: p.Pm }}
            label={`Power–angle curve P_e = ${fx(s.lim.P1, 3)} sin δ with the operating point at ${dg(s.d0)}`}
          />
        </div>
      ),
      body: (
        <>
          <p>
            A generator feeds a large grid — so large that its voltage and frequency do not move: an <b>infinite bus</b>. The power it sends depends on the angle δ by which its internal EMF E′ leads
            the grid voltage:
          </p>
          <Eq
            expr="P_e = (E′ · V / X) · sin δ"
            where={[
              ['E′', `internal EMF behind transient reactance, ${p.E} pu`, 'pu'],
              ['V', `infinite-bus voltage, ${p.V} pu`, 'pu'],
              ['X', `X′d + X_T + two lines in parallel = ${p.Xg} + ${p.Xl}/2 = ${fx(s.X.X1, 2)} pu`, 'pu'],
            ]}
            assume="classical model: constant E′, lossless network, f₀ = 50 Hz, H = 5 s on the system base (machine base = system base)"
          />
          <p>
            The turbine drives it with P_m = <b>{p.Pm} pu</b>. It settles where P_e = P_m: sin δ₀ = {p.Pm} / {fx(s.lim.P1, 3)}, so <b>δ₀ = {dg(s.d0, 2)}</b>.
          </p>
        </>
      ),
    },
    {
      title: 'Synchronising power and the 90° limit',
      figure: (
        <Plot
          series={[{ id: 'd', label: 'δ', color: C_A, points: swingSeries(kick).d }]}
          xLabel="Time [s]"
          yLabel="Rotor angle δ [°]"
          xDomain={[0, T_SWING]}
          hlines={[
            { y: deg(s.d0), label: `δ₀ = ${dg(s.d0)}` },
            { y: deg(d1), label: `new equilibrium ${dg(d1)}` },
          ]}
          label={`Rotor angle after a ${dP} pu step in mechanical power`}
          height={260}
        />
      ),
      body: (
        <>
          <p>
            Nudge the rotor ahead and P_e rises above P_m, pulling it back; let it fall behind and P_e drops, letting it catch up. The restoring force per radian is the <b>synchronising power</b> P_s
            = P_max·cos δ₀ = {fx(s.lim.P1, 3)} × cos {dg(s.d0)} = <b>{fx(s.Ps, 3)} pu/rad</b>. Past 90° the slope turns negative: P_max = {fx(s.lim.P1, 3)} pu is the steady-state limit.
          </p>
          <p>
            Inertia plus a restoring force make an oscillator: ω_n = √(ω_s·P_s / 2H) = <b>{fx(s.wn, 2)} rad/s</b>, f_n = <b>{fx(s.fn, 3)} Hz</b>. The chart is the simulated rotor after P_m steps up by{' '}
            {dP} pu: it swings about the new equilibrium at {fx(fKick, 3)} Hz (zero crossings), against {fx(fn1, 3)} Hz from the formula at that angle.
          </p>
          <p className="small muted">No damping in this model (D = 0), so the swing never dies away. Real machines have damper windings and power-system stabilisers.</p>
        </>
      ),
    },
    {
      title: 'A fault: the rotor accelerates',
      figure: pdFull(false, run),
      body: (
        <>
          <p>
            A three-phase fault on line 2 at the HV bus short-circuits the generator’s output: P_e = 0 while it lasts. The turbine keeps pushing, and the swing equation says the rotor accelerates:
          </p>
          <Eq
            expr="(2H / ω_s) · d²δ/dt² = P_m − P_e"
            where={[
              ['H', `inertia constant, ${p.H} s`, 's'],
              ['ω_s', `2π·${p.f0} = ${fx(W, 1)} rad/s`, 'rad/s'],
              ['δ', 'rotor angle', 'rad'],
            ]}
            assume="P_m constant during the first swing (the governor is too slow), no damping"
          />
          <p>
            With P_e = 0 the acceleration is constant: δ = δ₀ + ω_s·P_m·t² / (4H). The breakers open line 2 at t_c = <b>{ms(p.tc)}</b>, when δ_c = <b>{dg(run.dc)}</b>. The operating point (yellow)
            jumps down to the during-fault curve, runs along it, then jumps up to the post-fault curve — one line less, so P₃ = {fx(s.lim.P3, 3)} pu.
          </p>
        </>
      ),
    },
    {
      title: 'Equal areas',
      figure: pdFull(true, run),
      body: (
        <>
          <p>
            Multiply the swing equation by dδ/dt and integrate: the kinetic energy gained from δ₀ to δ_c is the <b>accelerating area A₁</b> = {fx(A1, 4)} pu·rad. After clearing P_e &gt; P_m, so the
            rotor gives that energy back over the <b>decelerating area A₂</b>.
          </p>
          <p>
            The rotor stops where A₂ = A₁ — at {dg(run.dPeak)} — and swings back. Up to δ_max = {dg(s.dMax)} (where the post-fault curve falls below P_m again) up to {fx(A2max, 4)} pu·rad are
            available: more than A₁, so the system is <b>stable</b>.
          </p>
        </>
      ),
    },
    {
      title: 'The critical clearing time',
      figure: (
        <Plot
          series={[
            { id: 'ok', label: `cleared at ${ms(p.tc)}`, color: C_C, points: swingSeries(run).d },
            { id: 'late', label: 'cleared at 250 ms', color: C_B, points: swingSeries(late).d },
          ]}
          xLabel="Time [s]"
          yLabel="Rotor angle δ [°]"
          xDomain={[0, T_SWING]}
          yDomain={[0, 180]}
          hlines={[{ y: deg(s.dMax), label: `δ_max = ${dg(s.dMax)}` }]}
          label="Rotor angle for two clearing times"
          height={260}
        />
      ),
      body: (
        <>
          <p>Clearing later makes A₁ bigger and leaves less of A₂. They are exactly equal when the fault is cleared at the critical angle:</p>
          <Eq
            expr="cos δ_cr = [P_m(δ_max − δ₀) + P₃ cos δ_max − P₂ cos δ₀] / (P₃ − P₂)"
            where={[
              ['δ_max', 'π − asin(P_m / P₃)', 'rad'],
              ['P₂, P₃', 'P_max during and after the fault', 'pu'],
            ]}
          />
          <p>
            Here δ_cr = <b>{dg(s.dcr, 2)}</b>; with P₂ = 0 the time to reach it is t_cr = √(4H(δ_cr − δ₀) / (ω_s·P_m)) = <b>{ms(s.tcrClosed)}</b>. The simulation’s own bisection finds{' '}
            {fx(s.tcrSim * 1000, 1)} ms. Cleared at 250 ms the rotor reaches δ_max still faster than synchronous speed, is accelerated again beyond it, and <b>loses synchronism</b>
            {Number.isFinite(late.tLost) ? ` (at t = ${fx(late.tLost, 2)} s)` : ''}.
          </p>
        </>
      ),
    },
    {
      title: 'Frequency: the whole grid as one machine',
      figure: freqPlot([{ r: prim, label: 'Δf', color: C_A }], 10, true, false),
      body: (
        <>
          <p>
            Now the whole interconnected system: all generators turn together, and a load that switches on ({f.dPL} pu of the system base) is first supplied from their kinetic energy, so they slow
            down:
          </p>
          <Eq
            expr="2H · dΔf/dt = ΔP_m − ΔP_L − D·Δf"
            where={[
              ['H', `system inertia, ${f.H} s on the system base`, 's'],
              ['Δf', 'frequency deviation', 'pu of f₀'],
              ['D', `load damping, ${f.D} pu/pu (motors slow down and draw less)`, 'pu'],
            ]}
            assume="one area, linearised, a non-reheat steam turbine"
          />
          <p>
            At t = 0 nothing else has changed, so RoCoF(0) = −ΔP_L·f₀ / (2H) = −{f.dPL} × {f.f0} / {2 * f.H} = <b>{fx(rocof0(f), 3)} Hz/s</b> — the dashed tangent. Less inertia, steeper fall.
          </p>
        </>
      ),
    },
    {
      title: 'Primary control: governor droop',
      figure: (
        <div className="ps-stack">
          {freqPlot([{ r: prim, label: 'Δf', color: C_A }], 20, false, true)}
          <Plot
            series={[{ id: 'pm', label: 'ΔP_m', color: C_C, points: freqSeries(prim, 20).pm }]}
            hlines={[{ y: f.dPL, label: `load step ΔP_L = ${f.dPL} pu` }]}
            xLabel="Time [s]"
            yLabel="Power [pu]"
            xDomain={[0, 20]}
            label="Generator output and load step"
            height={170}
          />
        </div>
      ),
      body: (
        <>
          <p>
            Each governor opens its valve in proportion to the frequency error: ΔP_m = −Δf / R with droop R = {f.R * 100} % (T_g = {f.Tg} s, T_t = {f.Tt} s). The fall is caught at the{' '}
            <b>nadir, {fx(prim.nadir, 3)} Hz</b> after {fx(prim.tNadir, 2)} s.
          </p>
          <Eq expr="Δf_ss = −ΔP_L / (D + 1/R)" where={[['R', 'droop', 'pu']]} />
          <p>
            = −{f.dPL} / ({f.D} + {fx(1 / f.R, 0)}) = {fx(steadyStateHz(f) / f.f0, 5)} pu = <b>{fx(steadyStateHz(f), 3)} Hz</b>. The generators pick up {fx(share.gen, 4)} pu and the load’s relief
            covers {fx(share.load, 4)} pu. Droop alone cannot return to 50 Hz: it needs the error to keep the valves open.
          </p>
        </>
      ),
    },
    {
      title: 'Secondary control brings back 50 Hz',
      figure: freqPlot(
        [
          { r: agc, label: 'with AGC', color: C_C },
          { r: prim, label: 'primary only', color: C_A },
        ],
        T_FREQ,
        false,
        false,
      ),
      body: (
        <>
          <p>
            Automatic generation control integrates the error and moves the generators’ set-points until it is zero: dΔP_ref/dt = −K_I·β·Δf with β = D + 1/R. Here K_I = {f.Ki} s⁻¹; Δf is back within 5
            % of the dip after <b>{fx(agc.tRecover, 1)} s</b> and ends at {fx(agc.end, 4)} Hz.
          </p>
          <p className="small muted">Real AGC acts over minutes; it is sped up here so the whole response fits on one chart.</p>
          <div className="ps-toolbar-group">
            <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => onExplore('angle')}>
              Run your own fault →
            </button>
            <button type="button" className="btn ps-btn-sm" onClick={() => onExplore('frequency')}>
              Run a load step →
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
      `Learn mode — step ${step + 1} of ${steps.length}: ${cur.title}. Rotor-angle case: SMIB, E′ = ${p.E} pu, V = ${p.V} pu, X′d+X_T = ${p.Xg} pu, two lines of ${p.Xl} pu, P_m = ${p.Pm} pu, H = ${p.H} s, f = ${p.f0} Hz; P_max pre/during/post = ${fx(s.lim.P1, 3)}/${fx(s.lim.P2, 3)}/${fx(s.lim.P3, 3)} pu, δ0 = ${dg(s.d0, 2)}, δ_cr = ${dg(s.dcr, 2)}, t_cr = ${ms(s.tcrClosed)} (fault at the HV bus), fault cleared at ${ms(p.tc)} reaches δ_c = ${dg(run.dc)}, f_n = ${fx(s.fn, 3)} Hz. Frequency case: ΔP_L = ${f.dPL} pu, H = ${f.H} s, D = ${f.D}, R = ${f.R}, Tg = ${f.Tg} s, Tt = ${f.Tt} s: RoCoF ${fx(rocof0(f), 3)} Hz/s, nadir ${fx(prim.nadir, 3)} Hz at ${fx(prim.tNadir, 2)} s, Δf_ss ${fx(steadyStateHz(f), 3)} Hz; with AGC (K_I = ${f.Ki}) back within 5 % after ${fx(agc.tRecover, 1)} s.`,
  )
  return (
    <div className="ps-split ps-split--wide-side ps-st-learn">
      <div className="ps-st-figure" aria-live="polite">
        {cur.figure}
      </div>
      <div className="ps-card ps-st-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

// ── Explore ────────────────────────────────────────────────────────────────────────────────────────────────────

function Explore({ topic, setTopic, sp, setSp, fp, setFp }: { topic: Topic; setTopic(t: Topic): void; sp: SmibParams; setSp(p: SmibParams): void; fp: FreqParams; setFp(p: FreqParams): void }) {
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="Study"
          value={topic}
          onChange={setTopic}
          options={[
            { id: 'angle', label: 'Rotor angle after a disturbance' },
            { id: 'frequency', label: 'Frequency after a load step' },
          ]}
        />
      </div>
      {topic === 'angle' ? <ExploreAngle p={sp} setP={setSp} /> : <ExploreFrequency p={fp} setP={setFp} />}
    </div>
  )
}

type Kind = 'fault' | 'step'

function ExploreAngle({ p, setP }: { p: SmibParams; setP(p: SmibParams): void }) {
  const [kind, setKind] = useState<Kind>('fault')
  const [dPm, setDPm] = useState(0.05)
  const [seen, setSeen] = useState<{ stable: boolean; lost: boolean }>({ stable: false, lost: false })
  const s = useMemo(() => summarise(p), [p])
  const run = useMemo(() => simulateSwing(p, kind === 'fault' ? { kind: 'fault' } : { kind: 'step', dPm }, { tEnd: T_SWING, keepEvery: 2 }), [p, kind, dPm])
  const pb = usePlayback(T_SWING, run)
  const set = (patch: Partial<SmibParams>) => setP({ ...p, ...patch })
  const noPre = !Number.isFinite(s.d0)
  const noPost = !Number.isFinite(s.dMax)
  const lost = !run.stable

  useEffect(() => {
    if (kind !== 'fault' || noPre) return
    setSeen((x) => {
      const n = { stable: x.stable || run.stable, lost: x.lost || !run.stable }
      return n.stable === x.stable && n.lost === x.lost ? x : n
    })
  }, [run, kind, noPre])
  useEffect(() => {
    if (seen.stable && seen.lost) completeActivity(MODULE, 'swing')
  }, [seen])

  const i = indexAt(run.t, pb.t)
  const tNow = run.t[i] ?? 0
  const phNow = run.phase[i] ?? 0
  const netState: NetState = kind === 'step' ? 'pre' : phNow === 1 ? 'fault' : phNow === 2 ? 'post' : 'pre'
  const showCursor = pb.t < T_SWING - 1e-6
  const ser = useMemo(() => swingSeries(run), [run])
  const { A1, A2max } = areasOf(s, p.Pm, run)
  const d1 = kind === 'step' ? delta0(p.Pm + dPm, s.lim.P1) : NaN
  const fMeas = kind === 'step' ? measuredFrequency(run.t, run.d, d1) : NaN
  const fn1 = kind === 'step' && Number.isFinite(d1) ? naturalFreq(p.f0, p.H, syncPower(s.lim.P1, d1)) / (2 * Math.PI) : NaN
  const tcr = s.tcrSim
  const margin = tcr - p.tc
  const tcrText = Number.isFinite(tcr) ? ms(tcr) : tcr === Infinity ? '> 1.5 s' : '—'

  const markers: PdMarker[] =
    kind === 'fault'
      ? [
          { d: s.d0, label: 'δ₀' },
          { d: run.dc, label: 'δ_c' },
          { d: s.dcr, label: 'δ_cr', strong: true },
          { d: s.dMax, label: 'δ_max' },
        ]
      : [
          { d: s.d0, label: 'δ₀' },
          { d: d1, label: 'δ₁', strong: true },
        ]
  const pathUpTo = { d: run.d.slice(0, i + 1), pe: run.pe.slice(0, i + 1) }

  const readouts: ReadoutItem[] =
    kind === 'fault'
      ? [
          {
            label: 'Outcome',
            value: noPre ? 'No operating point' : lost ? 'Unstable' : 'Stable',
            tone: lost ? 'bad' : 'good',
            note: lost ? `loses synchronism${Number.isFinite(run.tLost) ? ` · passes δ_max at t = ${fx(run.tLost, 2)} s` : ''}` : `first swing peaks at ${dg(run.dPeak)}`,
          },
          { label: 'Clearing angle', value: fx(deg(run.dc), 1), unit: '°', note: `δ_c · critical δ_cr = ${Number.isFinite(s.dcr) ? dg(s.dcr) : '—'} (equal areas)` },
          {
            label: 'Critical clearing time',
            value: Number.isFinite(tcr) ? fx(tcr * 1000, 1) : tcrText,
            unit: Number.isFinite(tcr) ? 'ms' : undefined,
            note: `${Number.isFinite(margin) ? `margin ${margin > 0 ? '+' : ''}${fx(margin * 1000, 1)} ms · ` : ''}${Number.isFinite(s.tcrClosed) ? `closed form ${fx(s.tcrClosed * 1000, 1)} ms` : 'by bisection on the simulation'}`,
            tone: Number.isFinite(margin) ? (margin > 0.02 ? 'good' : margin > 0 ? 'warn' : 'bad') : undefined,
          },
          {
            label: 'Areas A₁ / A₂ available',
            value: `${fx(A1, 3)} / ${fx(A2max, 3)}`,
            unit: 'pu·rad',
            note: A2max > A1 ? 'A₂ can absorb A₁' : 'A₂ is too small',
            tone: A2max > A1 ? undefined : 'bad',
          },
        ]
      : [
          { label: 'New equilibrium', value: fx(deg(d1), 2), unit: '°', note: `δ₁ = asin(${fx(p.Pm + dPm, 2)} / ${fx(s.lim.P1, 3)})` },
          { label: 'Synchronising power', value: fx(syncPower(s.lim.P1, d1), 3), unit: 'pu/rad', note: 'P_s = P_max·cos δ₁' },
          { label: 'Natural frequency (formula)', value: fx(fn1, 3), unit: 'Hz', note: 'f_n = √(ω_s·P_s / 2H) / 2π' },
          {
            label: 'Measured in the simulation',
            value: fx(fMeas, 3),
            unit: 'Hz',
            note: Number.isFinite(fMeas) ? `${fx(((fMeas - fn1) / fn1) * 100, 2)} % from the formula` : 'too few swings',
          },
        ]

  useTutorContext(
    () =>
      `Explore mode — rotor angle. Disturbance: ${kind === 'fault' ? `three-phase fault on line 2 ${p.fault === 'bus' ? 'at the HV bus (P_e = 0 during the fault)' : 'at its midpoint'}, cleared at ${ms(p.tc)} by opening line 2` : `step of +${dPm} pu in P_m`}. Settings: P_m = ${p.Pm} pu, X′d+X_T = ${p.Xg}, each line X_L = ${p.Xl} pu, E′ = ${p.E}, V = ${p.V}, H = ${p.H} s, D = ${p.D}, f = ${p.f0} Hz. Results: P_max pre/during/post ${fx(s.lim.P1, 3)}/${fx(s.lim.P2, 3)}/${fx(s.lim.P3, 3)} pu, δ0 ${dg(s.d0, 2)}, δ_max ${dg(s.dMax, 2)}, δ_cr ${dg(s.dcr, 2)}, t_cr ${tcrText}, ${kind === 'fault' ? `δ_c ${dg(run.dc, 2)}, A1 ${fx(A1, 4)}, A2 available ${fx(A2max, 4)}, outcome ${lost ? 'loses synchronism' : `stable, peak ${dg(run.dPeak)}`}` : `f_n formula ${fx(fn1, 3)} Hz, measured ${fx(fMeas, 3)} Hz`}.`,
  )

  return (
    <div className="ps-stack">
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <PowerAngleChart
            lim={s.lim}
            Pm={kind === 'step' ? p.Pm + dPm : p.Pm}
            curves={kind === 'fault' ? { pre: true, during: true, post: true } : { pre: true }}
            areas={kind === 'fault' && !noPre ? { d0: s.d0, dc: run.dc, d2: run.stable ? run.dPeak : s.dMax, dMax: s.dMax, lost } : null}
            markers={markers}
            path={pathUpTo}
            point={{ d: run.d[i], pe: run.pe[i] }}
            label={
              kind === 'fault'
                ? `Power–angle curves: pre-fault P_max ${fx(s.lim.P1, 2)}, during ${fx(s.lim.P2, 2)}, post-fault ${fx(s.lim.P3, 2)} pu; P_m ${p.Pm} pu. ${lost ? 'Loses synchronism.' : `Stable, peak ${dg(run.dPeak)}.`}`
                : `Power–angle curve with the operating point oscillating about ${dg(d1)}`
            }
          />
          <div className="ps-st-transport">
            {!pb.reduced && (
              <button type="button" className="btn ps-btn-sm" onClick={pb.playing ? pb.pause : pb.play} aria-label={pb.playing ? 'Pause' : 'Play the swing'}>
                {pb.playing ? 'Pause' : pb.t >= T_SWING - 1e-6 ? 'Play ▸' : 'Resume ▸'}
              </button>
            )}
            <label className="ps-st-scrub">
              <span className="sr-only">Time</span>
              <input type="range" min={0} max={T_SWING} step={0.005} value={pb.t} onChange={(e) => pb.scrub(Number(e.target.value))} aria-label="Time shown" />
            </label>
            <span className="ps-st-now" aria-live="off">
              t = {fx(tNow, 3)} s · δ = {fx(deg(run.d[i]), 1)}° · P_e = {fx(run.pe[i], 3)} pu · Δω = {fx(run.w[i], 2)} rad/s
              {kind === 'fault' ? ` · ${phNow === 1 ? 'fault on' : phNow === 2 ? 'line 2 open' : 'before the fault'}` : ''}
              {lost && i === run.t.length - 1 ? ' · a pole has slipped (δ = 360°): the run stops here' : ''}
            </span>
          </div>
          <p className="small muted">{pb.reduced ? 'Drag the time slider to move the operating point.' : `Play replays the swing at ${SPEED}× real time; or drag the time slider.`}</p>
          <div className="ps-st-results">
            <Readouts label="Results" items={readouts} />
          </div>
        </div>
        <aside className="ps-card ps-st-controls" aria-label="Settings">
          <SmibDiagram Xg={p.Xg} Xl={p.Xl} E={p.E} V={p.V} fault={p.fault} state={netState} showFault={kind === 'fault'} />
          <Seg
            label="Disturbance"
            value={kind}
            onChange={(v) => setKind(v)}
            full
            options={[
              { id: 'fault', label: 'Three-phase fault' },
              { id: 'step', label: 'Small step in P_m' },
            ]}
          />
          {kind === 'fault' ? (
            <>
              <div className="ps-st-field">
                <span className="ps-st-field-label">Fault on line 2</span>
                <Seg
                  label="Fault location"
                  value={p.fault}
                  onChange={(v) => set({ fault: v })}
                  full
                  options={[
                    { id: 'bus', label: 'At the HV bus' },
                    { id: 'mid', label: 'Mid-line' },
                  ]}
                />
              </div>
              <Slider
                label="Clearing time t_c"
                value={p.tc}
                min={0.02}
                max={0.7}
                step={0.005}
                unit="s"
                decimals={3}
                onChange={(v) => set({ tc: v })}
                hint={Number.isFinite(tcr) ? `critical: ${fx(tcr, 3)} s` : tcr === Infinity ? 'this fault alone does not cause loss of synchronism within 1.5 s' : 'no clearing time keeps it stable'}
              />
            </>
          ) : (
            <Slider label="Step in P_m" value={dPm} min={0.01} max={0.2} step={0.01} unit="pu" onChange={setDPm} hint="the network stays intact" />
          )}
          <Slider label="Mechanical power P_m" value={p.Pm} min={0.3} max={1.2} step={0.01} unit="pu" onChange={(v) => set({ Pm: v })} />
          <Slider
            label="Line reactance X_L (each)"
            value={p.Xl}
            min={0.3}
            max={1.0}
            step={0.05}
            unit="pu"
            onChange={(v) => set({ Xl: v })}
            hint={`X′d + X_T = ${p.Xg} pu · E′ = ${p.E} pu · V = ${p.V} pu`}
          />
          <Slider label="Inertia H" value={p.H} min={2} max={10} step={0.5} unit="s" decimals={1} onChange={(v) => set({ H: v })} />
          <Slider label="Damping D" value={p.D} min={0} max={20} step={1} unit="pu" decimals={0} onChange={(v) => set({ D: v })} hint="0 = the classical model (no damping)" />
          <button type="button" className="text-btn" onClick={() => setP(SMIB0)} disabled={p === SMIB0}>
            Reset to the default case
          </button>
        </aside>
      </div>
      {noPre ? (
        <Callout tone="bad" title="No operating point">
          P_m = {p.Pm} pu exceeds the pre-fault P_max = {fx(s.lim.P1, 3)} pu: the generator cannot run synchronously at all.
        </Callout>
      ) : kind === 'fault' && noPost ? (
        <Callout tone="bad" title="The post-fault network cannot carry P_m">
          With line 2 open, P_max = {fx(s.lim.P3, 3)} pu is below P_m = {p.Pm} pu: there is no post-fault equilibrium, so the generator loses synchronism for any clearing time.
        </Callout>
      ) : null}
      <div className="ps-cols-2">
        <Plot
          series={[{ id: 'd', label: 'δ', color: C_A, points: ser.d }]}
          xLabel="Time [s]"
          yLabel="Rotor angle δ [°]"
          xDomain={[0, T_SWING]}
          yDomain={kind === 'fault' ? [0, 200] : undefined}
          vlines={[...(kind === 'fault' ? [{ x: Math.min(p.tc, T_SWING), label: 't_c' }] : []), ...(showCursor ? [{ x: tNow, label: 'now' }] : [])]}
          hlines={kind === 'fault' && Number.isFinite(s.dMax) ? [{ y: deg(s.dMax), label: 'δ_max' }] : kind === 'step' ? [{ y: deg(d1), label: 'δ₁' }] : []}
          label="Rotor angle against time"
          height={220}
        />
        <Plot
          series={[{ id: 'w', label: 'Δω', color: C_D, points: ser.w }]}
          xLabel="Time [s]"
          yLabel="Speed deviation Δω [rad/s]"
          xDomain={[0, T_SWING]}
          vlines={[...(kind === 'fault' ? [{ x: Math.min(p.tc, T_SWING), label: 't_c' }] : []), ...(showCursor ? [{ x: tNow, label: 'now' }] : [])]}
          label="Rotor speed deviation against time"
          height={220}
        />
      </div>
      <details className="ps-card ps-st-more">
        <summary>The model behind these charts</summary>
        <div className="ps-cols-2">
          <Eq
            title="Swing equation"
            expr="(2H/ω_s)·d²δ/dt² = P_m − P_max·sin δ − D·Δω/ω_s"
            where={[
              ['H', 'inertia constant (machine base = system base)', 's'],
              ['ω_s', `2π f₀ = ${fx(ws(p.f0), 1)}`, 'rad/s'],
              ['Δω', 'dδ/dt, speed deviation (electrical)', 'rad/s'],
              ['D', 'damping', 'pu power / pu speed'],
            ]}
            assume="classical model — constant E′ (no AVR, no flux decay), constant P_m, no PSS; RK4 with a 1 ms step, the step adjusted to land on t_c"
          />
          <Eq
            title="Network"
            expr={`X₁ = X′d+X_T + X_L/2 = ${fx(s.X.X1, 3)} · X₃ = X′d+X_T + X_L = ${fx(s.X.X3, 3)}${p.fault === 'mid' ? ` · X₂ = 3(X′d+X_T) + X_L = ${fx(s.X.X2, 3)}` : ' · X₂ = ∞'} pu`}
            where={[
              ['X₁', 'before the fault: both lines', 'pu'],
              ['X₂', p.fault === 'mid' ? 'during a mid-line fault (star–delta: the fault shunts the HV bus to earth through X_L/2)' : 'during a fault at the HV bus: no power reaches the grid', 'pu'],
              ['X₃', 'after clearing: line 2 open', 'pu'],
            ]}
            assume="lossless lines; a solid (zero-impedance) three-phase fault"
          />
        </div>
      </details>
    </div>
  )
}

function ExploreFrequency({ p, setP }: { p: FreqParams; setP(p: FreqParams): void }) {
  const [win, setWin] = useState<'10' | '40'>(p.agc ? '40' : '10')
  const run = useMemo(() => simulateFrequency(p, { tEnd: T_FREQ, keepEvery: 2 }), [p])
  const set = (patch: Partial<FreqParams>) => setP({ ...p, ...patch })
  const upTo = Number(win)
  const ser = useMemo(() => freqSeries(run, upTo), [run, upTo])
  const ss = steadyStateHz({ ...p, agc: false })
  const r0 = rocof0(p)
  useEffect(() => {
    if (p.agc) completeActivity(MODULE, 'frequency')
  }, [p.agc])
  useTutorContext(
    () =>
      `Explore mode — frequency control, one area, linearised, per unit on the system base. Settings: load step ΔP_L = ${p.dPL} pu, H = ${p.H} s, D = ${p.D} pu/pu, droop R = ${fx(p.R * 100, 1)} %, T_g = ${p.Tg} s, T_t = ${p.Tt} s, AGC ${p.agc ? `on (K_I = ${p.Ki} 1/s)` : 'off'}, f₀ = ${p.f0} Hz. Results: RoCoF(0) ${fx(r0, 3)} Hz/s (simulated ${fx(run.rocofSim, 3)}), nadir ${fx(run.nadir, 3)} Hz at ${fx(run.tNadir, 2)} s, Δf_ss without AGC ${fx(ss, 3)} Hz, Δf after ${T_FREQ} s ${fx(run.end, 4)} Hz${p.agc && Number.isFinite(run.tRecover) ? `, back within 5 % after ${fx(run.tRecover, 1)} s` : ''}.`,
  )
  const vl = [{ x: run.tNadir, label: `nadir ${fx(run.nadir, 3)} Hz` }, ...(p.agc && Number.isFinite(run.tRecover) && run.tRecover <= upTo ? [{ x: run.tRecover, label: 'within 5 %' }] : [])]
  return (
    <div className="ps-stack">
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <div className="ps-toolbar">
            <span className="small muted">Load step of {p.dPL} pu at t = 0</span>
            <Seg
              label="Time window"
              value={win}
              onChange={(v) => setWin(v)}
              options={[
                { id: '10', label: 'First 10 s' },
                { id: '40', label: '40 s' },
              ]}
            />
          </div>
          <Plot
            series={[{ id: 'f', label: 'Δf', color: C_A, points: ser.f }]}
            xLabel="Time [s]"
            yLabel="Frequency deviation Δf [Hz]"
            xDomain={[0, upTo]}
            hlines={p.agc ? [] : [{ y: ss, label: `Δf_ss = ${fx(ss, 3)} Hz` }]}
            vlines={vl}
            label={`Frequency deviation after a ${p.dPL} pu load step: nadir ${fx(run.nadir, 3)} Hz`}
            height={280}
          />
          <Plot
            series={[{ id: 'pm', label: 'ΔP_m', color: C_C, points: ser.pm }]}
            xLabel="Time [s]"
            yLabel="Power [pu]"
            xDomain={[0, upTo]}
            yDomain={[0, Math.max(...ser.pm.map((q) => q[1]), p.dPL) * 1.15]}
            hlines={[{ y: p.dPL, label: `load step ΔP_L = ${p.dPL} pu` }]}
            label="Extra generator output ΔP_m against the load step"
            height={190}
          />
        </div>
        <aside className="ps-card ps-st-controls" aria-label="Settings">
          <Slider label="Load step ΔP_L" value={p.dPL} min={0.02} max={0.3} step={0.01} unit="pu" onChange={(v) => set({ dPL: v })} hint="pu of the system base" />
          <Slider label="System inertia H" value={p.H} min={2} max={10} step={0.5} unit="s" decimals={1} onChange={(v) => set({ H: v })} hint="lower with more inverter-based generation" />
          <Slider label="Governor droop R" value={p.R * 100} min={3} max={10} step={0.5} unit="%" decimals={1} onChange={(v) => set({ R: v / 100 })} />
          <Slider label="Load damping D" value={p.D} min={0} max={2} step={0.1} unit="pu/pu" decimals={1} onChange={(v) => set({ D: v })} />
          <Toggle
            label="Secondary control (AGC)"
            checked={p.agc}
            onChange={(v) => {
              set({ agc: v })
              if (v) setWin('40')
            }}
          />
          {p.agc && <Slider label="AGC integral gain K_I" value={p.Ki} min={0.02} max={0.3} step={0.01} unit="1/s" onChange={(v) => set({ Ki: v })} hint="ΔP_ref′ = −K_I·(D + 1/R)·Δf" />}
          <details className="ps-st-more-inline">
            <summary>Turbine and governor</summary>
            <Slider label="Governor time constant T_g" value={p.Tg} min={0.1} max={0.5} step={0.05} unit="s" onChange={(v) => set({ Tg: v })} />
            <Slider label="Turbine time constant T_t" value={p.Tt} min={0.2} max={2} step={0.1} unit="s" decimals={1} onChange={(v) => set({ Tt: v })} />
          </details>
          <button type="button" className="text-btn" onClick={() => setP(FREQ0)} disabled={p === FREQ0}>
            Reset to the default case
          </button>
        </aside>
      </div>
      <Readouts
        label="Results"
        items={[
          { label: 'Initial RoCoF', value: fx(r0, 3), unit: 'Hz/s', note: `−ΔP_L·f₀/2H · simulated ${fx(run.rocofSim, 3)}` },
          {
            label: 'Nadir',
            value: fx(run.nadir, 3),
            unit: 'Hz',
            note: `${fx(p.f0 + run.nadir, 3)} Hz at t = ${fx(run.tNadir, 2)} s`,
            tone: p.f0 + run.nadir < 49.2 ? 'bad' : p.f0 + run.nadir < 49.5 ? 'warn' : undefined,
          },
          { label: 'Primary control settles at', value: fx(ss, 3), unit: 'Hz', note: `−ΔP_L/(D + 1/R) = ${fx(ss / p.f0, 5)} pu` },
          {
            label: p.agc ? 'With AGC, after 40 s' : 'Simulated, after 40 s',
            value: fx(run.end, 4),
            unit: 'Hz',
            note: p.agc ? (Number.isFinite(run.tRecover) ? `within 5 % of the dip after ${fx(run.tRecover, 1)} s` : 'not yet recovered') : 'droop leaves an offset',
            tone: p.agc && Math.abs(run.end) < 0.01 ? 'good' : undefined,
          },
        ]}
      />
      {p.f0 + run.nadir < 49.2 && (
        <Callout tone="warn" title="A deep dip">
          <p>
            The frequency falls to {fx(p.f0 + run.nadir, 2)} Hz. Real grids begin under-frequency load shedding around 48.8–49.0 Hz; this linear model has no such protection and is only a guide for
            large deviations.
          </p>
        </Callout>
      )}
      <details className="ps-card ps-st-more">
        <summary>The model behind these charts</summary>
        <div className="ps-cols-2">
          <Eq
            title="Inertia and load"
            expr="2H·dΔf/dt = ΔP_m − ΔP_L − D·Δf"
            where={[
              ['H', 'system inertia constant on the system base', 's'],
              ['Δf', 'frequency deviation (× f₀ for Hz)', 'pu'],
              ['D', 'load damping', 'pu/pu'],
            ]}
            assume="one area (no tie lines), small deviations, all machines swing together"
          />
          <Eq
            title="Governor, turbine, AGC"
            expr="T_g·ΔP_v′ = ΔP_ref − Δf/R − ΔP_v · T_t·ΔP_m′ = ΔP_v − ΔP_m · ΔP_ref′ = −K_I·β·Δf"
            where={[
              ['R', 'droop', 'pu'],
              ['T_g, T_t', 'governor and non-reheat turbine time constants', 's'],
              ['β', 'D + 1/R, frequency bias of the area control error', 'pu/pu'],
            ]}
            assume="no dead band, no valve rate limits, no reheat; RK4 with a 10 ms step"
          />
        </div>
      </details>
    </div>
  )
}

// ── Experiment ─────────────────────────────────────────────────────────────────────────────────────────────────

function Experiments() {
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
      <nav className="ps-st-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the simulation does. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-st-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-st-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                <span>
                  {x.title}
                  <span className="ps-st-exp-kind">{x.kind === 'swing' ? 'Rotor angle' : 'Frequency'}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ps-stack" key={e.id}>
        <ExperimentRun e={e} answered={!!answered[e.id]} onAnswered={() => onAnswered(e.id)} />
      </div>
    </div>
  )
}

function ExperimentRun({ e, answered, onAnswered }: { e: Experiment; answered: boolean; onAnswered(): void }) {
  const res = useMemo(() => (e.kind === 'swing' ? { kind: 'swing' as const, b: e.before(), a: e.after() } : { kind: 'freq' as const, b: e.before(), a: e.after() }), [e])
  const answer = res.kind === 'swing' && e.kind === 'swing' ? e.answer(res.b, res.a) : res.kind === 'freq' && e.kind === 'freq' ? e.answer(res.b, res.a) : ''
  const explain = res.kind === 'swing' && e.kind === 'swing' ? e.explain(res.b, res.a) : res.kind === 'freq' && e.kind === 'freq' ? e.explain(res.b, res.a) : []
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <>
      <div className="ps-st-exp-run ps-stack">
        <div className="ps-card">
          <p className="eyebrow">Experiment · {e.kind === 'swing' ? 'rotor angle' : 'frequency'}</p>
          <h3>{e.title}</h3>
          <p>{e.change}</p>
        </div>
        <Predict
          question={e.question}
          options={e.options}
          answer={answer}
          onAnswered={onAnswered}
          why={
            <>
              {explain.map((p, k) => (
                <p key={k}>{p}</p>
              ))}
            </>
          }
        />
      </div>
      {answered && res.kind === 'swing' && e.kind === 'swing' && <SwingCompare e={e} b={res.b} a={res.a} />}
      {answered && res.kind === 'freq' && e.kind === 'freq' && <FreqCompare e={e} b={res.b} a={res.a} />}
    </>
  )
}

function SwingCompare({ e, b, a }: { e: Experiment & { kind: 'swing' }; b: SwingCase; a: SwingCase }) {
  const [show, setShow] = useState<'b' | 'a'>('a')
  const c = show === 'a' ? a : b
  const sb = swingSeries(b.run)
  const sa = swingSeries(a.run)
  return (
    <>
      <div className="ps-cols-2 ps-st-compare">
        <Plot
          series={[
            { id: 'b', label: e.names[0], color: C_A, points: sb.d },
            { id: 'a', label: e.names[1], color: C_B, points: sa.d },
          ]}
          xLabel="Time [s]"
          yLabel="Rotor angle δ [°]"
          xDomain={[0, 2.5]}
          yDomain={[0, 180]}
          label={`Rotor angle: ${e.names[0]} and ${e.names[1]}`}
          height={260}
        />
        <div className="ps-stack">
          <Seg
            label="Power–angle chart shown"
            value={show}
            onChange={(v) => setShow(v)}
            options={[
              { id: 'b', label: e.names[0] },
              { id: 'a', label: e.names[1] },
            ]}
          />
          <PowerAngleChart
            lim={c.s.lim}
            Pm={c.p.Pm}
            areas={{ d0: c.s.d0, dc: c.run.dc, d2: c.run.stable ? c.run.dPeak : c.s.dMax, dMax: c.s.dMax, lost: !c.run.stable }}
            markers={[
              { d: c.s.d0, label: 'δ₀' },
              { d: c.run.dc, label: 'δ_c' },
              { d: c.s.dcr, label: 'δ_cr', strong: true },
              { d: c.s.dMax, label: 'δ_max' },
            ]}
            path={{ d: c.run.d, pe: c.run.pe }}
            height={240}
            yMax={Math.max(a.s.lim.P1, b.s.lim.P1) * 1.3}
            label={`Power–angle chart for ${show === 'a' ? e.names[1] : e.names[0]}`}
          />
        </div>
      </div>
      <CompareTable title={e.title} names={e.names} rows={e.rows.map((r) => ({ label: r.label, unit: r.unit, decimals: r.decimals, b: r.get(b), a: r.get(a) }))} />
    </>
  )
}

function FreqCompare({ e, b, a }: { e: Experiment & { kind: 'freq' }; b: FreqCase; a: FreqCase }) {
  return (
    <>
      <Plot
        series={[
          { id: 'b', label: e.names[0], color: C_A, points: freqSeries(b.run, e.tEnd).f },
          { id: 'a', label: e.names[1], color: C_B, points: freqSeries(a.run, e.tEnd).f },
        ]}
        xLabel="Time [s]"
        yLabel="Frequency deviation Δf [Hz]"
        xDomain={[0, e.tEnd]}
        label={`Frequency deviation: ${e.names[0]} and ${e.names[1]}`}
        height={260}
      />
      <CompareTable title={e.title} names={e.names} rows={e.rows.map((r) => ({ label: r.label, unit: r.unit, decimals: r.decimals, b: r.get(b), a: r.get(a) }))} />
    </>
  )
}

function CompareTable({ title, names, rows }: { title: string; names: [string, string]; rows: Array<{ label: string; unit: string; decimals: number; b: number; a: number }> }) {
  return (
    <div className="ps-card table-wrap">
      <table className="ps-table">
        <caption className="sr-only">Before and after: {title}</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">{names[0]}</th>
            <th scope="col">{names[1]}</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const okB = Number.isFinite(r.b)
            const okA = Number.isFinite(r.a)
            const d = okA && okB ? r.a - r.b : null
            return (
              <tr key={r.label} className={d !== null && Math.abs(d) > 10 ** -r.decimals ? 'is-changed' : ''}>
                <td>{r.label}</td>
                <td>{okB ? `${fx(r.b, r.decimals)} ${r.unit}` : 'lost synchronism'}</td>
                <td>{okA ? `${fx(r.a, r.decimals)} ${r.unit}` : 'lost synchronism'}</td>
                <td className={d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>
                  {d === null ? '—' : `${d > 0 ? '+' : ''}${fx(d, r.decimals)}${r.b ? ` (${d > 0 ? '+' : ''}${fx((d / Math.abs(r.b)) * 100, 1)} %)` : ''}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Verify({ sp, fp, edited }: { sp: SmibParams; fp: FreqParams; edited: boolean }) {
  const progress = usePsProgress()
  const v = useMemo(() => verifyNumbers(sp, fp), [sp, fp])
  useTutorContext(
    () =>
      `Verify mode: hand calculations checked against the simulations, for P_m = ${sp.Pm} pu, X_L = ${sp.Xl} pu, H = ${sp.H} s, D = ${sp.D}${edited ? ' (as set in Explore)' : ''}. Equilibrium δ0 ${dg(v.d0, 3)}; bus fault: δ_cr ${dg(v.bus.dcr, 3)}, t_cr closed ${fx(v.bus.tcrClosed * 1000, 2)} ms vs bisection ${fx(v.bus.tcrSim * 1000, 2)} ms; mid-line: δ_cr ${dg(v.mid.dcr, 3)} vs angle at simulated t_cr ${dg(v.midAngle, 3)}; f_n ${fx(v.fn, 4)} Hz vs measured ${fx(v.fMeas, 4)} Hz; frequency: RoCoF ${fx(v.rocof, 4)} vs ${fx(v.rocofSim, 4)} Hz/s, Δf_ss ${fx(v.ssHz, 4)} vs ${fx(v.ssSim, 4)} Hz.`,
  )
  if (!Number.isFinite(v.d0) || !Number.isFinite(v.bus.dMax))
    return (
      <Callout tone="bad" title="Nothing to verify for this case">
        The case set up in Explore has no {Number.isFinite(v.d0) ? 'post-fault' : 'pre-fault'} operating point. Reset it there first.
      </Callout>
    )
  const W = ws(sp.f0)
  const ok = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
  const quiz: QuizItem[] = [
    {
      id: 'v-d0',
      kind: 'number',
      q: `Your turn: with P_m = ${fx(sp.Pm + 0.1, 2)} pu on the same pre-fault network (P_max = ${fx(v.lim.P1, 3)} pu), what is the operating angle δ₀?`,
      answer: deg(delta0(sp.Pm + 0.1, v.lim.P1)),
      unit: '°',
      tol: 0.2,
      why: `δ₀ = asin(${fx(sp.Pm + 0.1, 2)} / ${fx(v.lim.P1, 3)}) = ${dg(delta0(sp.Pm + 0.1, v.lim.P1), 2)}.`,
    },
    {
      id: 'v-tcr',
      kind: 'number',
      q: `And for a fault at the HV bus: δ₀ = ${dg(v.d0, 2)}, δ_cr = ${dg(v.bus.dcr, 2)}, H = ${sp.H} s, f₀ = ${sp.f0} Hz, P_m = ${sp.Pm} pu. What is the critical clearing time?`,
      answer: v.bus.tcrClosed * 1000,
      unit: 'ms',
      tol: 3,
      why: `t_cr = √(4 × ${sp.H} × (${fx(v.bus.dcr, 4)} − ${fx(v.d0, 4)}) / (${fx(W, 2)} × ${sp.Pm})) = ${fx(v.bus.tcrClosed * 1000, 1)} ms (angles in radians).`,
    },
  ]
  return (
    <div className="ps-stack ps-st-verify">
      <Callout title="The numbers on this page come from RK4 simulations">
        <p>
          Here you check them with closed-form results, independently of the integrator{edited ? ' — for the case you set up in Explore' : ' — for the default case'}.{' '}
          {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · The operating point is an equilibrium"
        steps={[
          { label: 'Pre-fault P_max', expr: `E′V / (X′d+X_T + X_L/2) = ${sp.E} × ${sp.V} / (${sp.Xg} + ${sp.Xl}/2)`, result: `${fx(v.lim.P1, 4)} pu` },
          { label: 'Operating angle', expr: `asin(P_m / P_max) = asin(${sp.Pm} / ${fx(v.lim.P1, 4)})`, result: dg(v.d0, 3) },
          { label: 'Simulated 3 s, no disturbance', expr: 'largest |δ − δ₀|', result: v.drift < 1e-9 ? '< 10⁻⁹ °' : `${v.drift.toExponential(1)}°` },
        ]}
        check={{ ok: v.drift < 1e-6, text: 'Started at δ₀ with Δω = 0, the simulated rotor does not move: P_m = P_e there.' }}
      />
      <Calc
        title="2 · Angle at clearing, fault at the HV bus (P₂ = 0)"
        steps={[
          { label: 'Constant acceleration', expr: `d²δ/dt² = ω_s·P_m / 2H = ${fx(W, 2)} × ${sp.Pm} / ${2 * sp.H}`, result: `${fx((W * sp.Pm) / (2 * sp.H), 3)} rad/s²` },
          { label: 'δ_c = δ₀ + ω_s·P_m·t_c² / 4H', expr: `${fx(v.d0, 4)} + ${fx((W * sp.Pm) / (4 * sp.H), 3)} × ${fx(sp.tc, 3)}²`, result: `${fx(v.dcHand, 4)} rad = ${dg(v.dcHand, 3)}` },
          { label: 'Simulation at t_c', expr: 'RK4, 1 ms', result: dg(v.dcSim, 3) },
        ]}
        check={{
          ok: ok(v.dcHand, v.dcSim, 1e-6),
          text: `The integrator agrees to ${Math.abs(deg(v.dcHand - v.dcSim)) < 1e-9 ? 'better than 10⁻⁹' : Math.abs(deg(v.dcHand - v.dcSim)).toExponential(1)}°: with P_e = 0 the acceleration is constant, which RK4 integrates exactly.`,
        }}
      />
      <Calc
        title="3 · Critical clearing, fault at the HV bus"
        steps={[
          { label: 'Post-fault P_max', expr: `${sp.E} × ${sp.V} / (${sp.Xg} + ${sp.Xl})`, result: `${fx(v.lim.P3, 4)} pu` },
          { label: 'δ_max = π − asin(P_m / P₃)', expr: `π − asin(${sp.Pm} / ${fx(v.lim.P3, 4)})`, result: `${fx(v.bus.dMax, 4)} rad = ${dg(v.bus.dMax, 2)}` },
          {
            label: 'cos δ_cr (P₂ = 0)',
            expr: `[${sp.Pm} × (${fx(v.bus.dMax, 4)} − ${fx(v.d0, 4)}) + ${fx(v.lim.P3, 4)} × cos ${dg(v.bus.dMax, 2)}] / ${fx(v.lim.P3, 4)}`,
            result: fx(Math.cos(v.bus.dcr), 5),
          },
          { label: 'δ_cr', expr: 'acos(…)', result: `${fx(v.bus.dcr, 4)} rad = ${dg(v.bus.dcr, 2)}` },
          { label: 't_cr = √(4H(δ_cr − δ₀) / (ω_s·P_m))', expr: `√(4 × ${sp.H} × ${fx(v.bus.dcr - v.d0, 4)} / (${fx(W, 2)} × ${sp.Pm}))`, result: `${fx(v.bus.tcrClosed * 1000, 2)} ms` },
          { label: 'Simulation: bisection on t_c', expr: 'smallest t_c that loses synchronism', result: `${fx(v.bus.tcrSim * 1000, 2)} ms` },
        ]}
        check={{
          ok: Number.isFinite(v.bus.tcrSim) && Math.abs(v.bus.tcrSim - v.bus.tcrClosed) / v.bus.tcrClosed < 0.002,
          text: `Equal areas and the simulation agree within ${fx((Math.abs(v.bus.tcrSim - v.bus.tcrClosed) / v.bus.tcrClosed) * 100, 3)} %.`,
        }}
      />
      {v.mid.ok && Number.isFinite(v.midTcr) ? (
        <Calc
          title="4 · Critical clearing angle, mid-line fault (P₂ > 0)"
          steps={[
            {
              label: 'During-fault X₂ (star–delta)',
              expr: `(X_g·X_L + X_L·c + c·X_g)/c with c = X_L/2: X₂ = ${fx(v.X2mid, 4)} pu, P₂ = ${sp.E} × ${sp.V} / ${fx(v.X2mid, 4)}`,
              result: `${fx(v.P2mid, 4)} pu`,
            },
            {
              label: 'cos δ_cr',
              expr: `[${sp.Pm}·(${fx(v.bus.dMax, 4)} − ${fx(v.d0, 4)}) + ${fx(v.lim.P3, 3)}·cos δ_max − ${fx(v.P2mid, 3)}·cos δ₀] / (${fx(v.lim.P3, 3)} − ${fx(v.P2mid, 3)})`,
              result: fx(Math.cos(v.mid.dcr), 5),
            },
            { label: 'δ_cr (equal areas)', expr: 'acos(…)', result: dg(v.mid.dcr, 3) },
            { label: 'Simulation', expr: `t_cr by bisection = ${fx(v.midTcr * 1000, 1)} ms; δ at that instant`, result: dg(v.midAngle, 3) },
          ]}
          check={{
            ok: Math.abs(deg(v.midAngle - v.mid.dcr)) < 0.1,
            text: `There is no closed form for t_cr here, but the angle the simulation has reached at its t_cr matches δ_cr within ${fx(Math.abs(deg(v.midAngle - v.mid.dcr)), 3)}°.`,
          }}
        />
      ) : (
        <Callout title="4 · Mid-line fault">
          <p>
            For this case a mid-line fault {v.midTcr === Infinity ? 'does not cause loss of synchronism within 1.5 s (P₂ is large enough to hold the rotor)' : 'has no stable clearing time'}, so there
            is no critical angle to check.
          </p>
        </Callout>
      )}
      <Calc
        title="5 · Small-signal oscillation frequency"
        steps={[
          { label: 'P_s = P_max·cos δ₀', expr: `${fx(v.lim.P1, 4)} × cos ${dg(v.d0, 2)}`, result: `${fx(v.Ps, 4)} pu/rad` },
          { label: 'ω_n = √(ω_s·P_s / 2H)', expr: `√(${fx(W, 2)} × ${fx(v.Ps, 4)} / ${2 * sp.H})`, result: `${fx(v.wn, 4)} rad/s` },
          { label: 'f_n = ω_n / 2π', expr: `${fx(v.wn, 4)} / 2π`, result: `${fx(v.fn, 4)} Hz` },
          { label: 'Simulation: P_m + 0.002 pu', expr: 'zero crossings of δ − δ₁, D = 0', result: `${fx(v.fMeas, 4)} Hz` },
        ]}
        check={{ ok: Math.abs(v.fMeas - v.fn) / v.fn < 0.01, text: `Within ${fx((Math.abs(v.fMeas - v.fn) / v.fn) * 100, 2)} % — linearisation holds for a small disturbance.` }}
      />
      <Calc
        title="6 · Frequency: initial slope and settling value"
        steps={[
          { label: 'RoCoF(0) = −ΔP_L·f₀ / 2H', expr: `−${fp.dPL} × ${fp.f0} / ${2 * fp.H}`, result: `${fx(v.rocof, 4)} Hz/s` },
          { label: 'Simulation, first 1 ms step', expr: 'Δf(1 ms) / 1 ms', result: `${fx(v.rocofSim, 4)} Hz/s` },
          { label: 'Δf_ss = −ΔP_L / (D + 1/R)', expr: `−${fp.dPL} / (${fp.D} + ${fx(1 / fp.R, 2)}) × ${fp.f0}`, result: `${fx(v.ssHz, 5)} Hz` },
          { label: 'Simulation after 60 s, no AGC', expr: 'RK4, 10 ms', result: `${fx(v.ssSim, 5)} Hz` },
        ]}
        check={{
          ok: Math.abs(v.rocofSim - v.rocof) / Math.abs(v.rocof) < 0.002 && Math.abs(v.ssSim - v.ssHz) < 1e-4,
          text: `The slope agrees within ${fx((Math.abs(v.rocofSim - v.rocof) / Math.abs(v.rocof)) * 100, 3)} % (load damping starts acting within the first step), the settling value within ${Math.abs(v.ssSim - v.ssHz) < 1e-6 ? '1 µHz' : `${fx(Math.abs(v.ssSim - v.ssHz) * 1000, 3)} mHz`}.`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

function verifyNumbers(sp: SmibParams, fp: FreqParams) {
  const bus = { ...sp, fault: 'bus' as const }
  const mid = { ...sp, fault: 'mid' as const }
  const lim = powerLimits(bus)
  const limMid = powerLimits(mid)
  const d0 = delta0(sp.Pm, lim.P1)
  const quiet = simulateSwing(sp, { kind: 'none' }, { tEnd: 3 })
  const drift = Math.max(...quiet.d.map((d) => Math.abs(deg(d - d0))))
  const dcHand = angleDuringBusFault(sp.f0, sp.H, sp.Pm, d0, sp.tc)
  const runBus = simulateSwing({ ...bus, D: 0 }, { kind: 'fault' }, { tEnd: sp.tc })
  const dcSim = runBus.d[runBus.d.length - 1]
  const sBus = summarise({ ...bus, D: 0 })
  const cBus = criticalAngle(sp.Pm, lim.P1, lim.P2, lim.P3)
  const tcrClosed = Number.isFinite(cBus.dcr) ? criticalTimeBusFault(sp.f0, sp.H, sp.Pm, d0, cBus.dcr) : NaN
  const cMid = criticalAngle(sp.Pm, limMid.P1, limMid.P2, limMid.P3)
  const sMid = summarise({ ...mid, D: 0 })
  const midTcr = sMid.tcrSim
  let midAngle = NaN
  if (Number.isFinite(midTcr)) {
    const r = simulateSwing({ ...mid, D: 0, tc: midTcr }, { kind: 'fault' }, { tEnd: midTcr })
    midAngle = r.d[r.d.length - 1]
  }
  const dP = 0.002
  const d1 = delta0(sp.Pm + dP, lim.P1)
  const kick = simulateSwing({ ...sp, D: 0 }, { kind: 'step', dPm: dP }, { tEnd: 5 })
  const fMeas = measuredFrequency(kick.t, kick.d, d1)
  const Ps = syncPower(lim.P1, d0)
  const wn = naturalFreq(sp.f0, sp.H, Ps)
  const f0 = { ...fp, agc: false }
  const fr = simulateFrequency(f0, { tEnd: 60, h: 0.01 })
  const fr1 = simulateFrequency(f0, { tEnd: 0.01, h: 0.001 })
  return {
    lim,
    d0,
    drift,
    dcHand,
    dcSim,
    bus: { dMax: deltaMax(sp.Pm, lim.P3), dcr: cBus.dcr, tcrClosed, tcrSim: sBus.tcrSim },
    mid: cMid,
    X2mid: (sp.Xg * sp.Xl + sp.Xl * (sp.Xl / 2) + (sp.Xl / 2) * sp.Xg) / (sp.Xl / 2),
    P2mid: limMid.P2,
    midTcr,
    midAngle,
    Ps,
    wn,
    fn: wn / (2 * Math.PI),
    fMeas,
    rocof: rocof0(fp),
    rocofSim: fr1.rocofSim,
    ssHz: steadyStateHz(f0),
    ssSim: fr.end,
  }
}

// ── Practise ───────────────────────────────────────────────────────────────────────────────────────────────────

function Practise() {
  const items = useMemo<QuizItem[]>(() => {
    // a fresh small case for hand calculation (numbers from the model functions)
    const E = 1.2
    const V = 1.0
    const X = 0.8
    const Pmax = (E * V) / X
    const Pm = 0.75
    const d0 = delta0(Pm, Pmax)
    const Ps = syncPower(Pmax, d0)
    const H = 4
    const fn = naturalFreq(50, H, Ps) / (2 * Math.PI)
    const s = summarise(SMIB0)
    const fq = { ...FREQ0, dPL: 0.05, R: 0.04 }
    const ssHz = steadyStateHz(fq)
    const fr = { ...FREQ0, dPL: 0.08, H: 4 }
    return [
      {
        id: 'pmax',
        kind: 'number',
        q: `A generator with E′ = ${E} pu is connected to an infinite bus at V = ${V} pu through a total reactance of ${X} pu. What is the most power it can transfer?`,
        answer: Pmax,
        unit: 'pu',
        tol: 0.01,
        why: `P_max = E′·V / X = ${E} × ${V} / ${X} = ${fx(Pmax, 3)} pu, at δ = 90°.`,
      },
      {
        id: 'd0',
        kind: 'number',
        q: `It delivers P_m = ${Pm} pu. At what rotor angle does it run?`,
        answer: deg(d0),
        unit: '°',
        tol: 0.3,
        why: `sin δ₀ = ${Pm} / ${fx(Pmax, 2)} = ${fx(Pm / Pmax, 3)} → δ₀ = ${dg(d0, 2)}.`,
      },
      {
        id: 'fn',
        kind: 'number',
        q: `With H = ${H} s at 50 Hz, what is its natural frequency of small oscillations about that point?`,
        answer: fn,
        unit: 'Hz',
        tol: 0.02,
        why: `P_s = ${fx(Pmax, 2)} × cos ${dg(d0)} = ${fx(Ps, 3)} pu/rad; ω_n = √(${fx(ws(50), 1)} × ${fx(Ps, 3)} / ${2 * H}) = ${fx(fn * 2 * Math.PI, 3)} rad/s → f_n = ${fx(fn, 3)} Hz.`,
      },
      {
        id: 'tcr',
        kind: 'number',
        q: `For a fault at the HV bus (P_e = 0 during it): δ₀ = ${dg(s.d0, 2)}, δ_cr = ${dg(s.dcr, 2)}, H = ${SMIB0.H} s, f₀ = 50 Hz, P_m = ${SMIB0.Pm} pu. What is the critical clearing time?`,
        answer: s.tcrClosed * 1000,
        unit: 'ms',
        tol: 3,
        why: `t_cr = √(4H(δ_cr − δ₀) / (ω_s·P_m)) = √(4 × ${SMIB0.H} × ${fx(s.dcr - s.d0, 4)} / (${fx(ws(50), 2)} × ${SMIB0.Pm})) = ${fx(s.tcrClosed * 1000, 1)} ms.`,
      },
      {
        id: 'late',
        kind: 'choice',
        q: 'The protection clears that fault 20 ms after t_cr. What happens?',
        options: [
          { id: 'ok', label: 'A larger swing, but it stays in step' },
          { id: 'lost', label: 'The decelerating area cannot absorb the accelerating area: the generator loses synchronism' },
          { id: 'freq', label: 'The grid frequency falls until the governors respond' },
        ],
        answer: simulateSwing({ ...SMIB0, tc: s.tcrSim + 0.02 }, { kind: 'fault' }, { tEnd: 3, firstSwingOnly: true }).stable ? 'ok' : 'lost',
        why: 'Past δ_cr, A₂ (up to δ_max) is smaller than A₁: the rotor is still faster than synchronous speed when it reaches δ_max, where P_e falls below P_m again, and it slips a pole.',
      },
      {
        id: 'rocof',
        kind: 'number',
        q: `A ${fr.dPL} pu load switches on in a system with H = ${fr.H} s (system base) at 50 Hz. What is the initial rate of change of frequency?`,
        answer: rocof0(fr),
        unit: 'Hz/s',
        tol: 0.01,
        why: `RoCoF(0) = −ΔP_L·f₀ / 2H = −${fr.dPL} × 50 / ${2 * fr.H} = ${fx(rocof0(fr), 3)} Hz/s.`,
      },
      {
        id: 'ss',
        kind: 'number',
        q: `A ${fq.dPL} pu load step, droop R = ${fq.R * 100} %, load damping D = ${fq.D}, no AGC. Where does the frequency settle (deviation in Hz, from 50 Hz)?`,
        answer: ssHz,
        unit: 'Hz',
        tol: 0.003,
        why: `Δf_ss = −ΔP_L / (D + 1/R) = −${fq.dPL} / (${fq.D} + ${fx(1 / fq.R, 0)}) = ${fx(ssHz / 50, 5)} pu = ${fx(ssHz, 4)} Hz.`,
      },
      {
        id: 'inertia',
        kind: 'choice',
        q: 'Inverter-based wind and solar replace synchronous generators, lowering the system inertia. What changes after the loss of a large generator?',
        options: [
          { id: 'a', label: 'A faster initial fall and a deeper nadir' },
          { id: 'b', label: 'A lower final frequency, but the same initial fall' },
          { id: 'c', label: 'Nothing — droop sets everything' },
        ],
        answer: 'a',
        why: 'RoCoF(0) = −ΔP·f₀/(2H): less H, a steeper fall, and the governors catch it later and lower. The steady-state deviation −ΔP/(D + 1/R) does not contain H.',
      },
      {
        id: 'agc',
        kind: 'choice',
        q: 'Which control returns the frequency to exactly 50 Hz after a load change?',
        options: [
          { id: 'inertia', label: 'The rotating inertia' },
          { id: 'droop', label: 'Governor droop (primary control)' },
          { id: 'agc', label: 'Secondary control — AGC, with an integral term' },
        ],
        answer: 'agc',
        why: 'Droop needs a frequency error to hold its extra output; only an integral controller can drive the error to zero (Δf_ss = 0).',
      },
    ]
  }, [])
  useTutorContext(() => `Practise mode: questions on rotor-angle stability (P–δ curve, δ0, natural frequency, equal areas, critical clearing time) and on frequency control (RoCoF, droop, AGC).`)
  return (
    <div className="ps-card ps-st-practise">
      <h3>Practice questions</h3>
      <p className="small muted">Every number comes from the same models as the rest of this module. Answer all of them correctly to complete the activity.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
