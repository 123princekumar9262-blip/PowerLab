import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import type { TourStep } from '../../three/Scene3D.tsx'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, Predict, Quiz, Readouts, Seg, Slider, Stepper, Toggle, useReducedMotion, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { AVR0, errSteady, loopGain, routh, simulateAvr, vtSteady, type AvrParams, type AvrRun, type Routh } from './avr.ts'
import { AvrDiagram, TwoAreaDiagram } from './diagrams.tsx'
import { EXPERIMENTS, runExperiment, type Case, type Experiment } from './experiments.ts'
import { AREA0, beta, bias1, bias2, indexAt, LFC0, rocof0, simulateLfc, snapAt, steadyState, tieDynamics, type AreaParams, type LfcParams, type LfcRun, type LfcSteady } from './lfc.ts'
import { LfcScene } from './Scene.tsx'
import './gen-control.css'

/*
 * Module 12 — Generator & Frequency Control. Two computed models:
 *  · two-area load-frequency control (inertia, load damping, droop governors, non-reheat turbines, tie line, AGC on
 *    the area control error), linearised, RK4 — lfc.ts; its steady states in closed form and by a linear solve;
 *  · the AVR (excitation) loop: amplifier, exciter, field, sensor; steady-state error and the Routh gain limit — avr.ts.
 * Learn: a guided story. Explore: a 3D two-area system driven by the simulation, the time plots, and the AVR loop.
 * Experiment: predict, then compare two runs. Verify: hand calculations against the simulations. Practise: questions.
 */

const MODULE = 'gen-control'
const T_LFC = 60
const KEEP = 5
const T_AVR = 15
const SPEED = 2
type Topic = 'lfc' | 'avr'

const C1 = 'var(--gc-a1)'
const C2 = 'var(--gc-a2)'
const CT = 'var(--gc-tie)'
const CG = 'var(--gc-agc)'
const CL = 'var(--gc-load)'

const sub = (k: 1 | 2) => (k === 1 ? '₁' : '₂')
const MW = (pu: number, p: LfcParams, d = 0) => `${fx(pu * p.sBase, d)} MW`

// ── shared helpers ─────────────────────────────────────────────────────────────────────────────────────────────

function lfcSeries(r: LfcRun, upTo: number) {
  const s = {
    df1: [] as Array<[number, number]>,
    df2: [] as Array<[number, number]>,
    tie: [] as Array<[number, number]>,
    ace1: [] as Array<[number, number]>,
    ace2: [] as Array<[number, number]>,
    pm1: [] as Array<[number, number]>,
    pm2: [] as Array<[number, number]>,
  }
  for (let i = 0; i < r.t.length && r.t[i] <= upTo + 1e-9; i++) {
    const t = r.t[i]
    s.df1.push([t, r.df1[i]])
    s.df2.push([t, r.df2[i]])
    s.tie.push([t, r.tie[i]])
    s.ace1.push([t, r.ace1[i]])
    s.ace2.push([t, r.ace2[i]])
    s.pm1.push([t, r.pm1[i]])
    s.pm2.push([t, r.pm2[i]])
  }
  return s
}

/** With AGC: the time after which |Δf₁| stays within 5 % of its dip (NaN if not within the run). */
function recoverTime(r: LfcRun): number {
  const thr = 0.05 * Math.max(Math.abs(r.nadir1), Math.abs(r.nadir2))
  for (let i = r.t.length - 1; i >= 0; i--) if (Math.abs(r.df1[i]) > thr || Math.abs(r.df2[i]) > thr) return i < r.t.length - 1 ? r.t[i + 1] : NaN
  return 0
}

/** Playback of a simulated run: the time shown, play/pause (none under reduced motion: scrub only). */
function usePlayback(tEnd: number, key: unknown, start = tEnd) {
  const reduced = useReducedMotion()
  const [t, setTState] = useState(start)
  const [playing, setPlaying] = useState(false)
  const tRef = useRef(start)
  const set = useCallback((v: number) => {
    tRef.current = v
    setTState(v)
  }, [])
  useEffect(() => {
    setPlaying(false)
    set(start)
  }, [key, start, set])
  useEffect(() => {
    if (!playing || reduced) return
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
  }, [playing, tEnd, set, reduced])
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

function SyllabusLine({ ids }: { ids: string[] }) {
  const topics = TOPICS.filter((t) => ids.includes(t.id))
  return (
    <p className="ps-gc-syllabus">
      {topics.map((t, k) => {
        const g = statusFor(t, 'gate-ee')
        const v = statusFor(t, 'vit-eee')
        return (
          <span key={t.id}>
            {k > 0 && ' · '}
            {t.title}: GATE EE Section {g.ref.where} ({g.status}
            {g.ref.quote ? `, “${g.ref.quote}”` : ''}); VIT {v.ref.where}
            {v.ref.unit ? ` Module ${v.ref.unit}` : ''} ({v.status}
            {v.elective ? ` — ${v.elective}` : ''})
          </span>
        )
      })}
    </p>
  )
}

// ── the module ─────────────────────────────────────────────────────────────────────────────────────────────────

export default function GenControlModule({ mode, setMode }: ModuleProps) {
  const [lp, setLp] = useState<LfcParams>(LFC0)
  const [ap, setAp] = useState<AvrParams>(AVR0)
  const [topic, setTopic] = useState<Topic>('lfc')
  return (
    <div className="ps-gc">
      {mode === 'learn' && (
        <Learn
          onExplore={(t) => {
            setTopic(t)
            setMode('explore')
          }}
        />
      )}
      {mode === 'explore' && <Explore topic={topic} setTopic={setTopic} lp={lp} setLp={setLp} ap={ap} setAp={setAp} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify lp={lp} ap={ap} edited={lp !== LFC0 || ap !== AVR0} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── Learn ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Learn({ onExplore }: { onExplore(t: Topic): void }) {
  const [step, setStep] = useState(0)
  const p = LFC0
  const run = useMemo(() => simulateLfc(p, { tEnd: T_LFC, keepEvery: KEEP }), [p])
  const pAgc = useMemo(() => ({ ...LFC0, agc1: true, agc2: true }), [])
  const runAgc = useMemo(() => simulateLfc(pAgc, { tEnd: T_LFC, keepEvery: KEEP }), [pAgc])
  const ss = steadyState(p)
  const b1 = beta(p.a1)
  const b2 = beta(p.a2)
  const r0 = rocof0(p.dPL1, p.a1.H, p.f0)
  const tRec = recoverTime(runAgc)
  const avr = AVR0
  const avrRun = useMemo(() => simulateAvr(avr, { tEnd: T_AVR, keepEvery: 5 }), [avr])
  const rt = useMemo(() => routh(avr), [avr])
  const below = useMemo(() => simulateAvr({ ...avr, KA: 0.95 * rt.kaMax }, { tEnd: T_AVR, keepEvery: 5 }), [avr, rt])
  const above = useMemo(() => simulateAvr({ ...avr, KA: 1.05 * rt.kaMax }, { tEnd: T_AVR, keepEvery: 5 }), [avr, rt])
  const at1 = snapAt(run, indexAt(run.t, 1.0))
  const K = loopGain(avr)

  type LearnStep = { title: string; body: ReactNode; visual: 'scene' | 'avr' | 'routh'; t?: number; agc?: boolean; focus?: string | null; hl?: string[] }
  const steps: LearnStep[] = [
    {
      title: 'One region’s demand jumps',
      visual: 'scene',
      t: 0,
      focus: 'load1',
      hl: [],
      body: (
        <>
          <p>
            <b>When the demand in one region suddenly rises, why does the frequency fall everywhere — and how do two connected regions share the work of bringing it back?</b>
          </p>
          <p>
            The picture shows two <i>control areas</i> — two regions, each with its own power stations and consumers — joined by a <b>tie line</b>. Each area’s turbine-generator stands for all of its
            generating units; its <b>governor</b> opens the steam valve when the speed falls. The frequency dial of each area reads how far its frequency is from {p.f0} Hz.
          </p>
          <p>
            At t = 0 the load in area 1 rises by <b>{fx(p.dPL1, 2)} pu</b> ({MW(p.dPL1, p)} on the common {p.sBase} MW base) — the red bar. Nothing has moved yet: the next steps follow what happens,
            second by second, from the simulation.
          </p>
          <SyllabusLine ids={['lfc-two-area', 'avr-excitation']} />
        </>
      ),
    },
    {
      title: 'The first instant: the rotors give up kinetic energy',
      visual: 'scene',
      t: 0.3,
      focus: 'gauge1',
      hl: ['mass1'],
      body: (
        <>
          <p>
            The extra load is supplied <i>at once</i> — electrically, nothing can wait. But the turbines still deliver the old mechanical power. The difference comes out of the kinetic energy stored
            in the spinning rotors, so they slow down — and the frequency is the rotors’ speed. Area 1 falls first; area 2 has not felt anything yet.
          </p>
          <Eq
            title="How fast it falls at first"
            expr="RoCoF(0) = dΔf/dt |t=0 = −ΔP_L · f₀ / (2H)"
            where={[
              ['ΔP_L', 'the load step', 'pu of the base'],
              ['f₀', 'nominal frequency', 'Hz'],
              ['H', 'inertia constant: stored kinetic energy ÷ base power', 's'],
            ]}
            assume="the first instant: governors and the tie line have not acted yet"
          />
          <Calc
            title="Area 1"
            steps={[
              { label: 'Known', expr: `ΔP_L1 = ${p.dPL1} pu, f₀ = ${p.f0} Hz, H₁ = ${p.a1.H} s`, result: 'unknown: RoCoF' },
              { label: 'RoCoF₁(0)', expr: `−${p.dPL1} × ${p.f0} / (2 × ${p.a1.H})`, result: `${fx(r0, 3)} Hz/s` },
            ]}
            check={{ ok: Math.abs(run.rocof1 - r0) < 0.01 * Math.abs(r0), text: `The simulation’s first 10 ms step gives ${fx(run.rocof1, 3)} Hz/s; area 2’s is ${fx(run.rocof2, 4)} Hz/s.` }}
          />
        </>
      ),
    },
    {
      title: 'The tie line pulls area 2 in',
      visual: 'scene',
      t: 1.0,
      focus: 'tie',
      hl: ['tie'],
      body: (
        <>
          <p>
            As area 1’s rotors slow, they fall behind area 2’s in angle. A line carries power from the leading end to the lagging end, so the tie line now carries power <b>from area 2 into area 1</b>.
            Area 2’s rotors give up kinetic energy too, and its frequency starts to fall: one area’s problem becomes everybody’s.
          </p>
          <Eq
            title="Tie-line power"
            expr="ΔP_tie12 = T₁₂·(Δδ₁ − Δδ₂),   dΔδ/dt = 2π·Δf   ⇒   dΔP_tie12/dt = 2π·T₁₂·(Δf₁ − Δf₂)"
            where={[
              ['ΔP_tie12', 'change of the power from area 1 to area 2 (positive = 1 → 2)', 'pu'],
              ['T₁₂', 'synchronising coefficient of the tie: ∂P_tie/∂(δ₁ − δ₂)', 'pu/rad'],
              ['Δf₁, Δf₂', 'the two frequency deviations', 'Hz'],
            ]}
            assume="a lossless tie line; both areas on one common base, so area 2 receives exactly what area 1 sends"
          />
          <p className="small">
            At t = 1.0 s: Δf₁ = {fx(at1.df1, 3)} Hz, Δf₂ = {fx(at1.df2, 3)} Hz, and ΔP_tie12 = <b>{fx(at1.tie, 4)} pu</b> ({MW(at1.tie, p, 1)}) — negative: area 2 is sending.
          </p>
        </>
      ),
    },
    {
      title: 'The governors open the valves (droop)',
      visual: 'scene',
      t: 2.5,
      focus: 'gen1',
      hl: ['gov1', 'turb1', 'droop1', 'gov2', 'turb2', 'droop2'],
      body: (
        <>
          <p>
            Each governor senses its area’s speed and opens the turbine valve in proportion to the fall: the <b>droop</b> characteristic. The turbine follows with a lag of a fraction of a second. Once
            the extra mechanical power catches up with the extra load, the fall stops — the lowest point is the <b>nadir</b>.
          </p>
          <Eq
            title="Droop (primary control)"
            expr="ΔP_m = −Δf / R   (in the steady state)"
            where={[
              ['R', `droop: the frequency change, in pu, that moves the output by 1 pu (here ${fx(p.a1.R * 100, 0)} %)`, 'pu/pu'],
              ['ΔP_m', 'change of mechanical power', 'pu'],
            ]}
            assume="a governor without dead band or rate limit; a non-reheat turbine (one lag T_t)"
          />
          <Readouts
            items={[
              { label: 'Area 1 nadir', value: fx(run.nadir1, 3), unit: 'Hz', note: `at t = ${fx(run.tNadir1, 2)} s` },
              { label: 'Area 2 nadir', value: fx(run.nadir2, 3), unit: 'Hz', note: `at t = ${fx(run.tNadir2, 2)} s` },
            ]}
          />
        </>
      ),
    },
    {
      title: 'Primary control settles — with an offset',
      visual: 'scene',
      t: 30,
      focus: 'gen2',
      hl: [],
      body: (
        <>
          <p>
            In the steady state the frequency is the same in both areas (otherwise the angle between them would keep growing). Droop needs a frequency error to hold the extra output, so the frequency
            does <b>not</b> return to {p.f0} Hz. Each area responds with its <b>β = D + 1/R</b> (the load relief D·Δf plus the governor response).
          </p>
          <Eq
            title="Steady state with governors only"
            expr="Δf = −ΔP_L1 / (β₁ + β₂)        ΔP_tie12 = −β₂·ΔP_L1 / (β₁ + β₂)"
            where={[
              ['β', 'area frequency response characteristic D + 1/R', 'pu/pu'],
              ['Δf', 'common frequency deviation (× f₀ for Hz)', 'pu'],
            ]}
            assume="AGC off; the sign of ΔP_tie12 is + from area 1 to area 2"
          />
          <Calc
            title="Two equal areas"
            steps={[
              { label: 'β₁ = β₂', expr: `${p.a1.D} + 1/${p.a1.R}`, result: `${fx(b1, 1)} pu/pu` },
              { label: 'Δf', expr: `−${p.dPL1} / (${fx(b1, 0)} + ${fx(b2, 0)}) × ${p.f0} Hz`, result: `${fx(ss.df1 * p.f0, 4)} Hz` },
              { label: 'ΔP_tie12', expr: `−${fx(b2, 0)} × ${p.dPL1} / ${fx(b1 + b2, 0)}`, result: `${fx(ss.tie, 4)} pu (${MW(ss.tie, p)})` },
              { label: 'Each governor', expr: `−Δf/R = ${fx(-ss.df1, 6)} / ${p.a1.R}`, result: `${fx(ss.pm1, 4)} pu` },
              { label: 'Each load relief', expr: `D·|Δf| = ${p.a1.D} × ${fx(-ss.df1, 6)}`, result: `${fx(-p.a1.D * ss.df1, 5)} pu` },
            ]}
            check={{
              ok: run.settled && Math.abs(run.end.df1 - ss.df1 * p.f0) < 1e-4 && Math.abs(run.end.tie - ss.tie) < 1e-4,
              text: `The simulation settles at Δf = ${fx(run.end.df1, 4)} Hz and ΔP_tie12 = ${fx(run.end.tie, 4)} pu. Area 2 supplies half of area 1’s extra load (${MW(-ss.tie, p)} through the tie).`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Area control error: whose load was it?',
      visual: 'scene',
      t: 30,
      focus: 'gen1',
      hl: ['agc1', 'agc2'],
      body: (
        <>
          <p>
            Area 2 is helping — but the rule of an interconnection is that each area eventually covers its own load changes. Each area measures its <b>area control error</b>: the tie-line deviation
            plus a frequency bias.
          </p>
          <Eq
            title="Area control error"
            expr="ACE₁ = ΔP_tie12 + B₁·Δf        ACE₂ = −ΔP_tie12 + B₂·Δf"
            where={[
              ['B', 'frequency bias, here B = β (the area’s own response)', 'pu/pu'],
              ['ACE', 'how much the area’s generation is short (negative) or long', 'pu'],
            ]}
          />
          <Calc
            title="At the primary-control steady state"
            steps={[
              { label: 'ACE₁', expr: `${fx(ss.tie, 4)} + ${fx(b1, 0)} × (${fx(ss.df1, 6)})`, result: `${fx(ss.tie + bias1(p) * ss.df1, 4)} pu` },
              { label: 'ACE₂', expr: `${fx(-ss.tie, 4)} + ${fx(b2, 0)} × (${fx(ss.df2, 6)})`, result: `${fx(-ss.tie + bias2(p) * ss.df2, 4)} pu` },
            ]}
            check={{
              ok: Math.abs(run.end.ace2) < 1e-4,
              text: `ACE₁ = −ΔP_L1 exactly; ACE₂ = 0 (simulated ${fx(run.end.ace2, 6)} pu). With B = β, only the area where the load changed sees an error.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Secondary control (AGC) brings both back',
      visual: 'scene',
      t: 60,
      agc: true,
      focus: 'gen1',
      hl: ['agc1', 'agc2'],
      body: (
        <>
          <p>
            Automatic generation control integrates each area’s ACE and moves the governor set points: dΔP_ref/dt = −K_I·ACE. It stops only when ACE = 0 in both areas — which forces Δf = 0 and ΔP_tie
            = 0. Area 1’s own generation then covers the whole load step.
          </p>
          <Readouts
            items={[
              { label: 'Δf after 60 s', value: fx(runAgc.end.df1, 4), unit: 'Hz', tone: 'good' },
              { label: 'ΔP_tie12 after 60 s', value: fx(runAgc.end.tie, 4), unit: 'pu' },
              { label: 'ΔP_m1 / ΔP_m2', value: `${fx(runAgc.end.pm1, 3)} / ${fx(runAgc.end.pm2, 3)}`, unit: 'pu' },
              { label: 'Within 5 % of the dip', value: Number.isFinite(tRec) ? fx(tRec, 1) : '—', unit: 's', note: `K_I = ${pAgc.Ki} 1/s` },
            ]}
          />
          <p className="small muted">Primary control (seconds) stops the fall; secondary control (tens of seconds) restores the frequency and the scheduled tie-line flows.</p>
        </>
      ),
    },
    {
      title: 'The other loop: holding the voltage (AVR)',
      visual: 'avr',
      body: (
        <>
          <p>
            Frequency is about real power and the turbine. <b>Voltage</b> is about the generator’s field: the automatic voltage regulator compares the measured terminal voltage with its reference,
            amplifies the error and drives the exciter, which sets the field current and so the internal EMF. The two loops are nearly independent (P–f and Q–V are weakly coupled), so they are studied
            separately.
          </p>
          <Eq
            title="Steady-state error (final value theorem, step ΔV_ref)"
            expr="e_ss = lim s→0  s · ΔV_ref/s · 1/(1 + G(s)H(s)) = ΔV_ref / (1 + K_A·K_E·K_G·K_R)"
            where={[
              ['K_A, K_E, K_G', 'gains of amplifier, exciter, generator field', 'pu/pu'],
              ['K_R', 'sensor gain (here 1: unity feedback)', 'pu/pu'],
            ]}
            assume="the standard linear AVR model: each element one gain and one time constant; no saturation or limits"
          />
          <Calc
            title={`K_A = ${avr.KA}`}
            steps={[
              { label: 'Loop gain K', expr: `${avr.KA} × ${avr.KE} × ${avr.KG} × ${avr.KR}`, result: `${fx(K, 1)}` },
              { label: 'e_ss', expr: `1 / (1 + ${fx(K, 1)})`, result: `${fx(errSteady(avr), 4)} pu` },
              { label: 'ΔV_t,ss', expr: `1 − e_ss`, result: `${fx(vtSteady(avr), 4)} pu` },
            ]}
            check={{
              ok: avrRun.trend === 'decaying',
              text: `The simulated response oscillates (overshoot ${fx(avrRun.overshootPct, 0)} %) towards ${fx(vtSteady(avr), 4)} pu — a 9 % error with heavy ringing.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'How much gain? Routh’s limit',
      visual: 'routh',
      body: (
        <>
          <p>
            More gain means less error — but each lag adds phase delay, and with enough gain the loop oscillates and then runs away. The characteristic equation (1 + sT_A)(1 + sT_E)(1 + sT_G)(1 +
            sT_R) + K = 0 is a quartic; Routh’s array tells when a root crosses into the right half plane.
          </p>
          <RouthTable r={rt} />
          <Calc
            title="The limit"
            steps={[
              { label: 's² row', expr: `b₁ = (a₃a₂ − a₄a₁)/a₃`, result: fx(rt.rows[2].v[0], 4) },
              { label: 's¹ row > 0', expr: `b₁·a₁ − a₃·(1 + K) > 0  ⇒  K < b₁a₁/a₃ − 1`, result: `K < ${fx(rt.kMax, 2)}` },
              { label: 'Oscillation at the limit', expr: `ω = √(a₁/a₃)`, result: `${fx(rt.wOsc, 2)} rad/s` },
            ]}
            check={{
              ok: below.trend === 'decaying' && above.trend === 'growing',
              text: `Simulated: K_A = ${fx(0.95 * rt.kaMax, 2)} decays; K_A = ${fx(1.05 * rt.kaMax, 2)} grows. So this loop cannot reach e_ss below 1/(1 + ${fx(rt.kMax, 2)}) = ${fx(1 / (1 + rt.kMax), 3)} by gain alone.`,
            }}
          />
          <div className="ps-toolbar-group">
            <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => onExplore('lfc')}>
              Explore the two areas →
            </button>
            <button type="button" className="btn ps-btn-sm" onClick={() => onExplore('avr')}>
              Explore the AVR →
            </button>
          </div>
        </>
      ),
    },
  ]
  const cur = steps[step]
  const [sel, setSel] = useState<string | null>(cur.focus ?? null)
  useEffect(() => setSel(steps[step].focus ?? null), [step]) // eslint-disable-line react-hooks/exhaustive-deps
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const r = cur.agc ? runAgc : run
  const at = snapAt(r, indexAt(r.t, cur.t ?? 0))
  useTutorContext(
    () =>
      `Learn mode — step ${step + 1} of ${steps.length}: ${cur.title}. Two equal areas (H = 5 s, D = 1, R = 5 %, T_g = 0.2 s, T_t = 0.5 s, T₁₂ = ${p.T12} pu/rad), load step 0.1 pu in area 1. Simulated: RoCoF₁(0) ${fx(run.rocof1, 3)} Hz/s, nadirs ${fx(run.nadir1, 3)} / ${fx(run.nadir2, 3)} Hz, Δf after 60 s ${fx(run.end.df1, 4)} Hz (closed form ${fx(ss.df1 * p.f0, 4)}), ΔP_tie12 ${fx(run.end.tie, 4)} pu; with AGC Δf → ${fx(runAgc.end.df1, 4)} Hz. AVR: K_A = 10, e_ss ${fx(errSteady(avr), 4)} pu, Routh limit K_A ${fx(rt.kaMax, 2)}.`,
  )
  return (
    <div className="ps-stack">
      <div className="ps-gc-learn-visual">
        {cur.visual === 'scene' ? (
          <LfcScene p={cur.agc ? pAgc : p} run={r} at={at} selected={sel} onSelect={setSel} height={330} highlight={cur.hl} />
        ) : cur.visual === 'avr' ? (
          <div className="ps-gc-avr-learn">
            <div className="ps-gc-diagram-card">
              <AvrDiagram p={avr} />
            </div>
            <AvrPlot p={avr} run={avrRun} height={180} />
          </div>
        ) : (
          <div className="ps-gc-avr-learn">
            <div className="ps-gc-diagram-card">
              <AvrDiagram p={avr} highlight={['amp']} />
            </div>
            <Plot
              series={[
                { id: 'b', label: `K_A ${fx(0.95 * rt.kaMax, 2)}`, color: C1, points: below.t.map((t, i) => [t, below.vt[i]]) },
                { id: 'a', label: `K_A ${fx(1.05 * rt.kaMax, 2)}`, color: CL, points: above.t.map((t, i) => [t, above.vt[i]]) },
              ]}
              xLabel="Time [s]"
              yLabel="ΔV_t [pu]"
              xDomain={[0, T_AVR]}
              yDomain={[-1.2, 3.2]}
              label="Terminal voltage just below and just above the Routh limit"
              height={180}
            />
          </div>
        )}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

function RouthTable({ r }: { r: Routh }) {
  const lab = ['s⁴', 's³', 's²', 's¹', 's⁰']
  return (
    <table className="ps-gc-routh" aria-label="Routh array">
      <tbody>
        {r.rows.map((row, k) => (
          <tr key={row.power}>
            <th scope="row">{lab[k]}</th>
            {row.v.map((v, j) => (
              <td key={j} className={j === 0 && v <= 0 ? 'is-neg' : ''}>
                {k >= 3 && j === 1 ? '' : fx(v, 4)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AvrPlot({ p, run, height = 240 }: { p: AvrParams; run: AvrRun; height?: number }) {
  const vss = vtSteady(p)
  const grow = run.trend === 'growing'
  const span = 3.1 * Math.abs(p.dVref)
  return (
    <Plot
      series={[{ id: 'vt', label: 'ΔV_t', color: grow ? CL : C1, points: run.t.map((t, i) => [t, run.vt[i]]) }]}
      xLabel="Time [s]"
      yLabel="ΔV_t [pu]"
      xDomain={[0, run.tEnd]}
      yDomain={grow ? [vss - span, vss + span] : undefined}
      hlines={
        grow
          ? [{ y: p.dVref, label: `ΔV_ref = ${fx(p.dVref, 2)} pu` }]
          : [
              { y: p.dVref, label: '' },
              { y: vss, label: `ΔV_t,ss ${fx(vss, 4)} pu (upper: ΔV_ref ${fx(p.dVref, 2)} pu)` },
            ]
      }
      vlines={run.stopped ? [{ x: run.t[run.t.length - 1], label: 'growing: stopped here' }] : []}
      label={`AVR step response, K_A = ${fx(p.KA, 1)}: ${grow ? 'growing oscillation — unstable' : `settles towards ${fx(vss, 4)} pu`}`}
      height={height}
    />
  )
}

// ── Explore ────────────────────────────────────────────────────────────────────────────────────────────────────

function Explore({ topic, setTopic, lp, setLp, ap, setAp }: { topic: Topic; setTopic(t: Topic): void; lp: LfcParams; setLp(p: LfcParams): void; ap: AvrParams; setAp(p: AvrParams): void }) {
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="Control loop"
          value={topic}
          onChange={setTopic}
          options={[
            { id: 'lfc', label: 'Frequency: two areas' },
            { id: 'avr', label: 'Voltage: the AVR loop' },
          ]}
        />
      </div>
      {topic === 'lfc' ? <ExploreLfc p={lp} setP={setLp} /> : <ExploreAvr p={ap} setP={setAp} />}
    </div>
  )
}

function exploreTour(p: LfcParams, run: LfcRun, ss: LfcSteady): TourStep[] {
  const k: 1 | 2 = p.dPL1 === 0 && p.dPL2 !== 0 ? 2 : 1
  const dPL = k === 1 ? p.dPL1 : p.dPL2
  return [
    {
      title: 'The disturbance',
      text: `Area ${k}’s load changes by ${fx(dPL, 2)} pu (${MW(dPL, p)}) at t = 0 — the red bar. Drag the time slider below the picture to follow what happens.`,
      focus: [`load${k}`],
      camera: k === 1 ? [-6.5, 5, 9] : [6.5, 5, 9],
    },
    {
      title: `Area ${k} slows first`,
      text: `Its rotors give up kinetic energy: RoCoF(0) = −ΔP·f₀/(2H) = ${fx(rocof0(dPL, (k === 1 ? p.a1 : p.a2).H, p.f0), 3)} Hz/s. The needle swings left as the frequency falls; its lowest point in this run is ${fx(k === 1 ? run.nadir1 : run.nadir2, 3)} Hz.`,
      focus: [`gauge${k}`],
      camera: k === 1 ? [-7, 4.2, 7.5] : [7, 4.2, 7.5],
    },
    {
      title: 'The tie line',
      text:
        p.T12 > 0
          ? `As the angle between the areas opens, the tie carries power towards the area that slowed. The arrows point the way the change flows and grow with |ΔP_tie12|; this run ends at ${fx(run.end.tie, 4)} pu.`
          : 'There is no tie line (T₁₂ = 0): each area is on its own.',
      focus: ['tie'],
      camera: [0, 5, 8.5],
    },
    {
      title: 'The other area helps',
      text: `Its frequency falls too, so its governor raises its output: ΔP_m = −Δf/R. Without AGC the areas share the step in proportion to β = D + 1/R (closed form: ΔP_tie12 = ${fx(ss.tie, 4)} pu).`,
      focus: [k === 1 ? 'gen2' : 'gen1'],
      camera: k === 1 ? [6.5, 5, 9] : [-6.5, 5, 9],
    },
    {
      title: 'Who pays in the end?',
      text:
        p.agc1 || p.agc2
          ? `With AGC each area drives its ACE to zero: the frequency returns to ${p.f0} Hz and area ${k} covers its own load.`
          : 'Switch AGC on (above the picture) and replay: each area drives its area control error to zero, and the area where the load changed takes it all.',
      focus: [`gen${k}`],
      camera: [0, 5.4, 10.2],
    },
  ]
}

function ExploreLfc({ p, setP }: { p: LfcParams; setP(p: LfcParams): void }) {
  const level = useLevel()
  const run = useMemo(() => simulateLfc(p, { tEnd: T_LFC, keepEvery: KEEP }), [p])
  const ss = useMemo(() => steadyState(p), [p])
  const pb = usePlayback(T_LFC, run)
  const [sel, setSel] = useState<string | null>(null)
  const anyAgc = p.agc1 || p.agc2
  const [win, setWin] = useState<'15' | '60'>(anyAgc ? '60' : '15')
  const upTo = Number(win)
  const ser = useMemo(() => lfcSeries(run, upTo), [run, upTo])
  const i = indexAt(run.t, pb.t)
  const at = snapAt(run, i)
  const k: 1 | 2 = p.dPL1 === 0 && p.dPL2 !== 0 ? 2 : 1
  const dPL = k === 1 ? p.dPL1 : p.dPL2
  const set = (patch: Partial<LfcParams>) => setP({ ...p, ...patch })
  const setArea = (a: 1 | 2, patch: Partial<AreaParams>) => setP(a === 1 ? { ...p, a1: { ...p.a1, ...patch } } : { ...p, a2: { ...p.a2, ...patch } })
  const setBoth = (patch: Partial<AreaParams>) => setP({ ...p, a1: { ...p.a1, ...patch }, a2: { ...p.a2, ...patch } })
  const unstable = run.trend === 'growing'
  const none = Math.abs(p.dPL1) < 1e-12 && Math.abs(p.dPL2) < 1e-12
  const tour = useMemo(() => exploreTour(p, run, ss), [p, run, ss])
  const td = useMemo(() => tieDynamics(run, ss.tie), [run, ss])
  useEffect(() => {
    if (anyAgc) completeActivity(MODULE, 'explore-lfc')
  }, [anyAgc])
  const r0 = rocof0(dPL, (k === 1 ? p.a1 : p.a2).H, p.f0)
  const sim0 = k === 1 ? run.rocof1 : run.rocof2
  const ace1ss = ss.tie + bias1(p) * ss.df1
  const ace2ss = -ss.tie + bias2(p) * ss.df2
  const formula =
    ss.case === 'primary'
      ? 'Δf = −(ΔP_L1 + ΔP_L2)/(β₁ + β₂),  ΔP_tie12 = (β₁ΔP_L2 − β₂ΔP_L1)/(β₁ + β₂)'
      : ss.case === 'agc-both'
        ? 'AGC in both areas: Δf = 0, ΔP_tie12 = 0, ΔP_mi = ΔP_Li'
        : ss.case === 'agc-1'
          ? 'AGC in area 1 only: ACE₁ = 0 ⇒ Δf = −ΔP_L2/(β₂ + B₁)'
          : ss.case === 'agc-2'
            ? 'AGC in area 2 only: ACE₂ = 0 ⇒ Δf = −ΔP_L1/(β₁ + B₂)'
            : 'No tie line: each area alone, Δf_i = −ΔP_Li/β_i (0 with AGC)'
  const simOk = !unstable
  const simNote = unstable ? 'growing' : run.settled ? `at ${T_LFC} s` : `still moving at ${T_LFC} s`
  const cmp: Array<{ label: string; closed: number; sim: number; unit: string; d: number }> = [
    { label: `Initial RoCoF, area ${k}`, closed: r0, sim: sim0, unit: 'Hz/s', d: 3 },
    { label: 'Δf₁', closed: ss.df1 * p.f0, sim: run.end.df1, unit: 'Hz', d: 4 },
    ...(ss.case === 'islanded' ? [{ label: 'Δf₂', closed: ss.df2 * p.f0, sim: run.end.df2, unit: 'Hz', d: 4 }] : []),
    { label: 'ΔP_tie12', closed: ss.tie, sim: run.end.tie, unit: 'pu', d: 4 },
    { label: 'ΔP_m1', closed: ss.pm1, sim: run.end.pm1, unit: 'pu', d: 4 },
    { label: 'ΔP_m2', closed: ss.pm2, sim: run.end.pm2, unit: 'pu', d: 4 },
    { label: 'ACE₁', closed: ace1ss, sim: run.end.ace1, unit: 'pu', d: 4 },
    { label: 'ACE₂', closed: ace2ss, sim: run.end.ace2, unit: 'pu', d: 4 },
  ]
  useTutorContext(
    () =>
      `Explore mode — two-area load-frequency control, linearised, pu on a common ${p.sBase} MW base, f₀ = ${p.f0} Hz. Settings: ΔP_L1 ${p.dPL1} pu, ΔP_L2 ${p.dPL2} pu; area 1 H ${p.a1.H} s, D ${p.a1.D}, R ${p.a1.R}; area 2 H ${p.a2.H} s, D ${p.a2.D}, R ${p.a2.R}; T_g ${p.a1.Tg} s, T_t ${p.a1.Tt} s; T₁₂ ${p.T12} pu/rad; AGC ${p.agc1 ? 'area 1 ' : ''}${p.agc2 ? 'area 2' : ''}${anyAgc ? '' : 'off'} (K_I ${p.Ki}, B = ${p.kB}·β). Time shown ${fx(at.t, 2)} s: Δf₁ ${fx(at.df1, 4)} Hz, Δf₂ ${fx(at.df2, 4)} Hz, ΔP_tie12 ${fx(at.tie, 4)} pu. Run: nadirs ${fx(run.nadir1, 3)}/${fx(run.nadir2, 3)} Hz; end Δf ${fx(run.end.df1, 4)} Hz, tie ${fx(run.end.tie, 4)} pu; ${unstable ? 'UNSTABLE (growing oscillation)' : run.settled ? 'settled' : 'not settled'}. Closed form: ${formula} → Δf ${fx(ss.df1 * p.f0, 4)} Hz, tie ${fx(ss.tie, 4)} pu.${sel ? ` Selected: ${sel}.` : ''}`,
  )
  return (
    <div className="ps-stack">
      <section className="ps-card ps-gc-primary" aria-label="Disturbance and control">
        <div className="ps-gc-primary-group">
          <span>Load step in</span>
          <Seg
            label="Load step in"
            value={String(k) as '1' | '2'}
            onChange={(v) => (v === '1' ? set({ dPL1: dPL, dPL2: 0 }) : set({ dPL1: 0, dPL2: dPL }))}
            options={[
              { id: '1', label: 'Area 1' },
              { id: '2', label: 'Area 2' },
            ]}
          />
        </div>
        <Slider
          label={`Load step ΔP_L${sub(k)}`}
          value={dPL}
          min={-0.2}
          max={0.3}
          step={0.01}
          unit="pu"
          onChange={(v) => (k === 1 ? set({ dPL1: v }) : set({ dPL2: v }))}
          hint={`${MW(dPL, p)} on the common ${p.sBase} MW base; negative = load lost`}
        />
        <div className="ps-gc-primary-group">
          <span>Secondary control</span>
          <Toggle
            label="AGC (both areas)"
            checked={p.agc1 && p.agc2}
            onChange={(v) => {
              set({ agc1: v, agc2: v })
              setWin(v ? '60' : '15')
            }}
          />
        </div>
        <button type="button" className="text-btn" onClick={() => setP(LFC0)} disabled={p === LFC0}>
          Reset
        </button>
      </section>
      {none && (
        <Callout tone="info" title="No disturbance">
          <p>With no load step nothing moves: every deviation stays at zero. Choose a load step to start the simulation.</p>
        </Callout>
      )}
      {unstable && (
        <Callout tone="bad" title="Unstable: the oscillation grows">
          <p>
            The simulated deviations grow (envelope ×{fx(run.envRatio, 2)} over the last 30 % of the run{run.bounded ? '' : '; the run was stopped when it left the small-signal range'}). The
            closed-form steady state below is never reached.{' '}
            {p.T12 > 0.12
              ? `A stiff tie line (T₁₂ = ${fx(p.T12, 3)} pu/rad) with these governor and turbine lags gives negative damping to the inter-area swing — lower T₁₂, or reduce the lags.`
              : 'Reduce the AGC gain K_I or the lags.'}
          </p>
        </Callout>
      )}
      <LfcScene p={p} run={run} at={at} selected={sel} onSelect={setSel} tour={tour} height={360} />
      <div className="ps-gc-transport">
        {!pb.reduced && (
          <button type="button" className="btn ps-btn-sm" onClick={pb.playing ? pb.pause : pb.play} aria-label={pb.playing ? 'Pause' : 'Play the response'}>
            {pb.playing ? 'Pause' : pb.t >= T_LFC - 1e-6 ? 'Play ▸' : 'Resume ▸'}
          </button>
        )}
        <label className="ps-gc-scrub">
          <span className="sr-only">Time</span>
          <input type="range" min={0} max={T_LFC} step={0.05} value={pb.t} onChange={(e) => pb.scrub(Number(e.target.value))} aria-label="Time shown" />
        </label>
        <span className="ps-gc-now" aria-live="off">
          t = {fx(at.t, 2)} s · Δf₁ = {fx(at.df1, 4)} Hz · Δf₂ = {fx(at.df2, 4)} Hz · ΔP_tie12 = {fx(at.tie, 4)} pu · ΔP_m1 = {fx(at.pm1, 4)} · ΔP_m2 = {fx(at.pm2, 4)} pu
        </span>
      </div>
      <p className="small muted">
        {pb.reduced ? 'Drag the time slider to move through the response (reduced motion: no playback).' : `Play replays the response at ${SPEED}× real time; or drag the time slider.`}
      </p>
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <div className="ps-toolbar">
            <span className="small muted">Simulated with RK4, 10 ms step · sign: ΔP_tie12 &gt; 0 = area 1 → area 2</span>
            <Seg
              label="Time window"
              value={win}
              onChange={setWin}
              options={[
                { id: '15', label: 'First 15 s' },
                { id: '60', label: '60 s' },
              ]}
            />
          </div>
          <Plot
            series={[
              { id: 'f1', label: 'Δf₁', color: C1, points: ser.df1 },
              { id: 'f2', label: 'Δf₂', color: C2, points: ser.df2, dashed: true },
            ]}
            xLabel="Time [s]"
            yLabel="Frequency deviation [Hz]"
            xDomain={[0, upTo]}
            hlines={simOk && !none ? [{ y: ss.df1 * p.f0, label: `closed form ${fx(ss.df1 * p.f0, 4)} Hz` }] : []}
            vlines={[...(run.nadir1 < 0 && run.tNadir1 <= upTo ? [{ x: run.tNadir1, label: `nadir₁ ${fx(run.nadir1, 3)} Hz` }] : []), ...(at.t <= upTo ? [{ x: at.t, label: 'shown' }] : [])]}
            label={`Frequency deviations of the two areas: nadir ${fx(run.nadir1, 3)} Hz`}
            height={250}
          />
          <Plot
            series={[{ id: 'tie', label: 'ΔP_tie12', color: CT, points: ser.tie }]}
            xLabel="Time [s]"
            yLabel="ΔP_tie12 [pu]"
            xDomain={[0, upTo]}
            hlines={simOk && !none ? [{ y: ss.tie, label: `closed form ${fx(ss.tie, 4)} pu` }] : []}
            vlines={at.t <= upTo ? [{ x: at.t, label: 'shown' }] : []}
            label={`Tie-line power change: ends at ${fx(run.end.tie, 4)} pu`}
            height={200}
          />
          <details className="ps-card ps-more" open={level !== 'beginner'} key={`more-${level}`}>
            <summary>Generator outputs and area control errors</summary>
            <Plot
              series={[
                { id: 'm1', label: 'ΔP_m1', color: C1, points: ser.pm1 },
                { id: 'm2', label: 'ΔP_m2', color: C2, points: ser.pm2, dashed: true },
              ]}
              xLabel="Time [s]"
              yLabel="Extra mechanical power [pu]"
              xDomain={[0, upTo]}
              hlines={!none ? [{ y: dPL, label: `ΔP_L${sub(k)} = ${fx(dPL, 2)} pu` }] : []}
              label="Extra mechanical power of the two areas"
              height={200}
            />
            <Plot
              series={[
                { id: 'a1', label: 'ACE₁', color: C1, points: ser.ace1 },
                { id: 'a2', label: 'ACE₂', color: C2, points: ser.ace2, dashed: true },
              ]}
              xLabel="Time [s]"
              yLabel="Area control error [pu]"
              xDomain={[0, upTo]}
              label="Area control errors ACE = ±ΔP_tie + B·Δf"
              height={200}
            />
          </details>
        </div>
        <aside className="ps-gc-side" aria-label="Results and settings">
          <section className="ps-card" aria-labelledby="gc-cmp">
            <h3 id="gc-cmp">Closed form beside the simulation</h3>
            <dl className="ps-gc-compare">
              <dt className="ps-gc-h">Quantity</dt>
              <dd className="ps-gc-h">Closed form</dd>
              <dd className="ps-gc-h">Simulated</dd>
              {cmp.map((c) => (
                <div key={c.label} style={{ display: 'contents' }}>
                  <dt>{c.label}</dt>
                  <dd>
                    {fx(c.closed, c.d)} {c.unit}
                  </dd>
                  <dd>{c.label.startsWith('Initial') || (simOk && run.settled) ? `${fx(c.sim, c.d)} ${c.unit}` : simOk ? '— (still moving)' : '— (growing)'}</dd>
                </div>
              ))}
            </dl>
            <p className="small muted">
              Simulated: {simNote}. {formula}. The closed forms are the steady state; RoCoF is the first instant.
            </p>
          </section>
          <Readouts
            label="From the simulation"
            items={[
              { label: 'Nadir, area 1', value: fx(run.nadir1, 3), unit: 'Hz', note: `t = ${fx(run.tNadir1, 2)} s` },
              { label: 'Nadir, area 2', value: fx(run.nadir2, 3), unit: 'Hz', note: `t = ${fx(run.tNadir2, 2)} s` },
              unstable || none
                ? { label: 'First tie-flow peak', value: '—' }
                : td.firstPeak
                  ? {
                      label: 'First tie-flow peak',
                      value: fx(td.firstPeak.v, 4),
                      unit: 'pu',
                      note: `at ${fx(td.firstPeak.t, 2)} s · overshoot ${fx(td.overshootPct, 1)} %${Number.isFinite(td.period) ? ` · period ${fx(td.period, 2)} s` : ''}`,
                    }
                  : { label: 'First tie-flow peak', value: 'none', note: 'rises monotonically: no overshoot' },
              ...(anyAgc ? [{ label: 'Back within 5 %', value: Number.isFinite(recoverTime(run)) && !unstable ? fx(recoverTime(run), 1) : '—', unit: 's', note: 'of the dip, both areas' }] : []),
            ]}
          />
          <details className="ps-card ps-more" open={level !== 'beginner'} key={`set-${level}`}>
            <summary>Area settings</summary>
            <div className="ps-cols-2">
              <Slider label="Droop R₁" value={p.a1.R * 100} min={3} max={10} step={0.5} unit="%" decimals={1} onChange={(v) => setArea(1, { R: v / 100 })} />
              <Slider label="Droop R₂" value={p.a2.R * 100} min={3} max={10} step={0.5} unit="%" decimals={1} onChange={(v) => setArea(2, { R: v / 100 })} />
              <Slider label="Inertia H₁" value={p.a1.H} min={2} max={12} step={0.5} unit="s" decimals={1} onChange={(v) => setArea(1, { H: v })} />
              <Slider label="Inertia H₂" value={p.a2.H} min={2} max={12} step={0.5} unit="s" decimals={1} onChange={(v) => setArea(2, { H: v })} />
            </div>
            <Slider label="Load damping D (both areas)" value={p.a1.D} min={0} max={2} step={0.1} unit="pu/pu" decimals={1} onChange={(v) => setBoth({ D: v })} />
            <Slider label="Tie-line coefficient T₁₂" value={p.T12} min={0} max={0.2} step={0.005} unit="pu/rad" decimals={3} onChange={(v) => set({ T12: v })} hint="0 = no tie line (two islands)" />
            <Slider
              label="AGC integral gain K_I"
              value={p.Ki}
              min={0.02}
              max={0.5}
              step={0.01}
              unit="1/s"
              onChange={(v) => set({ Ki: v })}
              hint={anyAgc ? 'dΔP_ref/dt = −K_I · ACE' : 'used when AGC is on'}
            />
            <p className="small muted">
              β₁ = {fx(beta(p.a1), 1)}, β₂ = {fx(beta(p.a2), 1)} pu/pu
            </p>
          </details>
          {level === 'engineer' && (
            <section className="ps-card" aria-labelledby="gc-eng">
              <h3 id="gc-eng">Engineer settings</h3>
              <Slider label="Governor T_g (both)" value={p.a1.Tg} min={0.05} max={0.5} step={0.05} unit="s" onChange={(v) => setBoth({ Tg: v })} />
              <Slider label="Turbine T_t (both)" value={p.a1.Tt} min={0.2} max={2} step={0.1} unit="s" decimals={1} onChange={(v) => setBoth({ Tt: v })} />
              <Slider label="Bias B = k·β" value={p.kB} min={0.5} max={2} step={0.1} unit="× β" decimals={1} onChange={(v) => set({ kB: v })} hint="k = 1: B = β, the natural bias" />
              <Seg
                label="AGC in"
                value={p.agc1 && p.agc2 ? 'both' : p.agc1 ? 'a1' : p.agc2 ? 'a2' : 'none'}
                onChange={(v) => set({ agc1: v === 'both' || v === 'a1', agc2: v === 'both' || v === 'a2' })}
                options={[
                  { id: 'none', label: 'Off' },
                  { id: 'both', label: 'Both' },
                  { id: 'a1', label: 'Area 1' },
                  { id: 'a2', label: 'Area 2' },
                ]}
              />
              <p className="small muted">
                Integration: RK4, h = {fx(run.h * 1000, 0)} ms, {fx(T_LFC / run.h, 0)} steps; steady state also checked by a 9 × 9 linear solve (Verify).
              </p>
            </section>
          )}
        </aside>
      </div>
      <details className="ps-card ps-more">
        <summary>The model behind these numbers</summary>
        <div className="ps-gc-diagram-card">
          <TwoAreaDiagram p={p} at={at} />
        </div>
        <div className="ps-cols-2">
          <Eq
            title="Each area i"
            expr="2H_i·dΔf_i/dt = ΔP_mi − ΔP_Li − D_i·Δf_i − ΔP_tie,i  ·  T_g·ΔP_vi′ = ΔP_ref,i − Δf_i/R_i − ΔP_vi  ·  T_t·ΔP_mi′ = ΔP_vi − ΔP_mi"
            where={[
              ['Δf_i', 'frequency deviation (pu of f₀ inside the model; shown in Hz)', 'pu'],
              ['ΔP_tie,1 = ΔP_tie12, ΔP_tie,2 = −ΔP_tie12', 'power leaving the area through the tie', 'pu'],
              ['H, D, R', 'inertia [s], load damping [pu/pu], droop [pu/pu]', ''],
            ]}
            assume={`small deviations (linear); one equivalent machine per area; non-reheat turbines; no dead band, rate limits or load shedding; both areas on one ${p.sBase} MW base`}
          />
          <Eq
            title="Tie line and AGC"
            expr="dΔP_tie12/dt = 2π·T₁₂·(Δf₁ − Δf₂)  ·  dΔP_ref,i/dt = −K_I·ACE_i,  ACE_i = ΔP_tie,i + B_i·Δf_i"
            where={[
              ['T₁₂', 'synchronising coefficient', 'pu/rad'],
              ['Δf₁ − Δf₂', 'in Hz (2π × Hz = rad/s of angle change)', 'Hz'],
              ['B_i', 'frequency bias, default β_i = D_i + 1/R_i', 'pu/pu'],
              ['K_I', 'integral gain', '1/s'],
            ]}
            assume="a lossless tie line"
          />
        </div>
      </details>
    </div>
  )
}

function ExploreAvr({ p, setP }: { p: AvrParams; setP(p: AvrParams): void }) {
  const level = useLevel()
  const run = useMemo(() => simulateAvr(p, { tEnd: T_AVR, keepEvery: 5 }), [p])
  const r = useMemo(() => routh(p), [p])
  const set = (patch: Partial<AvrParams>) => setP({ ...p, ...patch })
  const ess = errSteady(p)
  const simErr = p.dVref - p.KR * run.end
  const stableSim = run.trend === 'decaying'
  useEffect(() => {
    if (run.trend === 'growing') completeActivity(MODULE, 'explore-avr')
  }, [run.trend])
  useTutorContext(
    () =>
      `Explore mode — AVR loop (amplifier K_A/(1+sT_A), exciter K_E/(1+sT_E), field K_G/(1+sT_G), sensor K_R/(1+sT_R)). K_A ${p.KA}, T_A ${p.TA} s, K_E ${p.KE}, T_E ${p.TE} s, K_G ${p.KG}, T_G ${p.TG} s, K_R ${p.KR}, T_R ${p.TR} s; step ΔV_ref ${p.dVref} pu. Closed form e_ss = 1/(1+K) = ${fx(ess, 4)} pu. Routh: K_A,max ${fx(r.kaMax, 3)}, ${r.stable ? 'stable' : `unstable (${r.rhp} roots in the RHP)`}. Simulation: ${run.trend}, overshoot ${fx(run.overshootPct, 1)} %.`,
  )
  const tone = r.stable && stableSim ? 'good' : !r.stable && run.trend === 'growing' ? 'bad' : 'warn'
  return (
    <div className="ps-stack">
      <div className="ps-gc-diagram-card">
        <AvrDiagram p={p} stable={r.stable} />
      </div>
      {!r.stable && (
        <Callout tone="bad" title="Unstable: the voltage oscillation grows">
          <p>
            K_A = {fx(p.KA, 1)} is above the Routh limit {fx(r.kaMax, 2)}: {r.rhp} roots of the characteristic equation are in the right half plane. The simulated response grows
            {run.stopped ? ` and is stopped at t = ${fx(run.t[run.t.length - 1], 2)} s, when it leaves the ±3 pu display band` : ''} — the steady-state formula no longer applies.
          </p>
        </Callout>
      )}
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <AvrPlot p={p} run={run} height={280} />
          <Readouts
            label="Step response"
            items={[
              r.stable
                ? { label: 'Steady-state error (closed form)', value: fx(ess, 4), unit: 'pu', note: `1/(1 + ${fx(loopGain(p), 2)})` }
                : { label: 'Steady-state error (closed form)', value: '—', note: 'no steady state: the loop is unstable' },
              {
                label: `Simulated error at ${T_AVR} s`,
                value: stableSim ? fx(simErr, 4) : '—',
                unit: stableSim ? 'pu' : undefined,
                note: stableSim ? (Number.isFinite(run.tSettle) ? 'settled' : 'still ringing') : run.trend === 'growing' ? 'growing' : 'sustained oscillation',
              },
              { label: 'Overshoot', value: stableSim ? fx(run.overshootPct, 1) : '—', unit: stableSim ? '%' : undefined },
              {
                label: '2 % settling',
                value: stableSim && Number.isFinite(run.tSettle) ? fx(run.tSettle, 2) : '—',
                unit: stableSim && Number.isFinite(run.tSettle) ? 's' : undefined,
                note: stableSim && !Number.isFinite(run.tSettle) ? `not within ${T_AVR} s` : undefined,
              },
            ]}
          />
        </div>
        <aside className="ps-gc-side" aria-label="AVR settings">
          <section className="ps-card">
            <Slider label="Amplifier gain K_A" value={p.KA} min={1} max={25} step={0.5} unit="" decimals={1} onChange={(v) => set({ KA: v })} hint="the main control: more gain, less error" />
            <div className="ps-gc-stability" role="status">
              <span className={`ps-gc-dot ps-gc-dot--${tone}`} aria-hidden="true" />
              {r.stable ? 'Stable' : 'Unstable'} by Routh · simulation: {run.trend === 'decaying' ? 'decays' : run.trend === 'growing' ? 'grows' : 'sustained'}
            </div>
            <Readouts
              items={[
                { label: 'Routh limit K_A,max', value: fx(r.kaMax, 2), note: `oscillation at ${fx(r.wOsc, 2)} rad/s` },
                { label: 'Margin', value: fx(r.kaMax - p.KA, 2), tone: r.kaMax - p.KA < 0 ? 'bad' : r.kaMax - p.KA < 1 ? 'warn' : undefined },
                { label: 'Envelope ratio (sim)', value: fx(run.envRatio, 3), note: 'last 30 % ÷ the 30 % before; < 1 decays' },
              ]}
            />
            <button type="button" className="text-btn" onClick={() => setP(AVR0)} disabled={p === AVR0}>
              Reset
            </button>
          </section>
          <details className="ps-card ps-more" open={level === 'engineer'} key={`routh-${level}`}>
            <summary>Routh array</summary>
            <p className="small">
              (1 + {fx(p.TA, 2)}s)(1 + {fx(p.TE, 2)}s)(1 + {fx(p.TG, 2)}s)(1 + {fx(p.TR, 2)}s) + {fx(loopGain(p), 2)} = 0
            </p>
            <p className="small mono">
              a₄…a₀ ={' '}
              {r.a
                .slice()
                .reverse()
                .map((v) => fx(v, 4))
                .join(', ')}
            </p>
            <RouthTable r={r} />
            <p className="small muted">Stable while every first-column entry is positive. Only a₀ = 1 + K depends on the gain, so the s¹ row gives the limit K &lt; b₁a₁/a₃ − 1.</p>
          </details>
          <details className="ps-card ps-more" open={level === 'engineer'} key={`tc-${level}`}>
            <summary>Time constants and other gains</summary>
            <Slider label="Amplifier T_A" value={p.TA} min={0.02} max={0.2} step={0.01} unit="s" onChange={(v) => set({ TA: v })} />
            <Slider label="Exciter T_E" value={p.TE} min={0.1} max={1} step={0.05} unit="s" onChange={(v) => set({ TE: v })} />
            <Slider label="Generator field T_G" value={p.TG} min={0.5} max={2} step={0.1} unit="s" decimals={1} onChange={(v) => set({ TG: v })} />
            <Slider label="Sensor T_R" value={p.TR} min={0.01} max={0.1} step={0.01} unit="s" onChange={(v) => set({ TR: v })} />
            <Slider label="Exciter gain K_E" value={p.KE} min={0.5} max={1.5} step={0.1} unit="" decimals={1} onChange={(v) => set({ KE: v })} />
            <Slider label="Generator gain K_G" value={p.KG} min={0.5} max={1.5} step={0.1} unit="" decimals={1} onChange={(v) => set({ KG: v })} />
            <p className="small muted">
              Sensor gain K_R = 1 (unity feedback). Step ΔV_ref = {p.dVref} pu; RK4, h = {fx(run.h * 1000, 0)} ms.
            </p>
          </details>
        </aside>
      </div>
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
      <nav className="ps-gc-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the simulation does. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-gc-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-gc-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
                <span className="ps-gc-exp-kind">{x.kind === 'lfc' ? 'Frequency' : 'Voltage'}</span>
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
  const res = useMemo(() => runExperiment(e), [e])
  const answer = e.answer(res)
  const explain = e.explain(res)
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <>
      <div className="ps-stack">
        <div className="ps-card">
          <p className="eyebrow">Experiment · {e.kind === 'lfc' ? 'two-area frequency control' : 'AVR loop'}</p>
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
              {explain.map((x, k) => (
                <p key={k}>{x}</p>
              ))}
            </>
          }
        />
      </div>
      {answered && <Compare e={e} b={res.b} a={res.a} />}
    </>
  )
}

function Compare({ e, b, a }: { e: Experiment; b: Case; a: Case }) {
  let plots: ReactNode = null
  if (b.kind === 'lfc' && a.kind === 'lfc') {
    const sb = lfcSeries(b.run, e.plotEnd)
    const sa = lfcSeries(a.run, e.plotEnd)
    plots = (
      <div className="ps-cols-2">
        <Plot
          series={[
            { id: 'b', label: `Δf₁ ${e.names[0]}`, color: C1, points: sb.df1 },
            { id: 'a', label: `Δf₁ ${e.names[1]}`, color: CL, points: sa.df1 },
          ]}
          xLabel="Time [s]"
          yLabel="Area 1 Δf [Hz]"
          xDomain={[0, e.plotEnd]}
          label={`Area 1 frequency: ${e.names[0]} and ${e.names[1]}`}
          height={240}
        />
        <Plot
          series={[
            { id: 'b', label: `${e.names[0]}`, color: CT, points: sb.tie },
            { id: 'a', label: `${e.names[1]}`, color: CG, points: sa.tie },
          ]}
          xLabel="Time [s]"
          yLabel="ΔP_tie12 [pu]"
          xDomain={[0, e.plotEnd]}
          hlines={
            Math.abs(a.ss.tie - b.ss.tie) < 1e-9
              ? [{ y: a.ss.tie, label: `final, both (closed form) ${fx(a.ss.tie, 4)} pu` }]
              : [
                  { y: b.ss.tie, label: `final, ${e.names[0]} ${fx(b.ss.tie, 4)} pu` },
                  { y: a.ss.tie, label: `final, ${e.names[1]} ${fx(a.ss.tie, 4)} pu` },
                ]
          }
          label={`Tie-line power: ${e.names[0]} and ${e.names[1]}, first ${e.plotEnd} s of a ${e.tEnd} s run`}
          height={240}
        />
      </div>
    )
  } else if (b.kind === 'avr' && a.kind === 'avr') {
    plots = (
      <Plot
        series={[
          { id: 'b', label: e.names[0], color: C1, points: b.run.t.map((t, i) => [t, b.run.vt[i]]) },
          { id: 'a', label: e.names[1], color: CL, points: a.run.t.map((t, i) => [t, a.run.vt[i]]) },
        ]}
        xLabel="Time [s]"
        yLabel="ΔV_t [pu]"
        xDomain={[0, e.plotEnd]}
        hlines={[{ y: 1, label: 'ΔV_ref' }]}
        label={`AVR step response: ${e.names[0]} and ${e.names[1]}`}
        height={260}
      />
    )
  }
  return (
    <>
      <p className="small muted">
        The plots show the first {e.plotEnd} s of each {e.tEnd} s run. Final values are the closed forms; a simulated end value is shown only when the run has settled.
      </p>
      {plots}
      <div className="ps-card table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Comparison: {e.title}</caption>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col">{e.names[0]}</th>
              <th scope="col">{e.names[1]}</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {e.rows.map((r) => {
              const vb = r.get(b)
              const va = r.get(a)
              const okB = Number.isFinite(vb)
              const okA = Number.isFinite(va)
              const d0 = okA && okB ? va - vb : null
              const d = d0 !== null && Math.abs(d0) < 0.5 * 10 ** -r.decimals ? 0 : d0
              const show = (v: number, ok: boolean) => (ok ? `${fx(v, r.decimals)}${r.unit ? ` ${r.unit}` : ''}` : (r.none ?? 'not within the run'))
              return (
                <tr key={r.label} className={d !== null && Math.abs(d) > 10 ** -r.decimals ? 'is-changed' : ''}>
                  <td>{r.label}</td>
                  <td>{show(vb, okB)}</td>
                  <td>{show(va, okA)}</td>
                  <td className={d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d === null ? '—' : `${d > 0 ? '+' : ''}${fx(d, r.decimals)}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Verify({ lp, ap, edited }: { lp: LfcParams; ap: AvrParams; edited: boolean }) {
  const progress = usePsProgress()
  // the checks use the Explore settings, with AGC off for the primary-control check and on for the AGC check
  const pPri = useMemo(() => ({ ...lp, agc1: false, agc2: false }), [lp])
  const pAgc = useMemo(() => ({ ...lp, agc1: true, agc2: true }), [lp])
  const runPri = useMemo(() => simulateLfc(pPri, { tEnd: 120, keepEvery: 20 }), [pPri])
  const runAgc = useMemo(() => simulateLfc(pAgc, { tEnd: 150, keepEvery: 20 }), [pAgc])
  const ssPri = steadyState(pPri)
  const b1 = beta(lp.a1)
  const b2 = beta(lp.a2)
  const k: 1 | 2 = lp.dPL1 === 0 && lp.dPL2 !== 0 ? 2 : 1
  const dPL = k === 1 ? lp.dPL1 : lp.dPL2
  const H = (k === 1 ? lp.a1 : lp.a2).H
  const r0 = rocof0(dPL, H, lp.f0)
  const runFine = useMemo(() => simulateLfc(lp, { tEnd: 1e-3, h: 1e-5 }), [lp])
  const rt = routh(ap)
  const avrRun = useMemo(() => simulateAvr(ap, { tEnd: 60 }), [ap])
  const avrB = useMemo(() => simulateAvr({ ...ap, KA: 0.95 * rt.kaMax }, { tEnd: 60, bound: 1e6 }), [ap, rt.kaMax])
  const avrA = useMemo(() => simulateAvr({ ...ap, KA: 1.05 * rt.kaMax }, { tEnd: 60, bound: 1e6 }), [ap, rt.kaMax])
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)
  const priOk = runPri.trend === 'decaying'
  const agcOk = runAgc.trend === 'decaying'
  const quiz: QuizItem[] = [
    {
      id: 'tie-mw',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: two areas with β₁ = ${fx(b1, 2)} and β₂ = ${fx(b2, 2)} pu/pu are joined by a tie line; area 1’s load rises by ${fx(Math.abs(lp.dPL1) > 0 ? lp.dPL1 : 0.1, 2)} pu on a ${lp.sBase} MW base. With governors only, how many MW flow from area 2 into area 1 in the steady state?`,
      answer: ((b2 * (Math.abs(lp.dPL1) > 0 ? lp.dPL1 : 0.1)) / (b1 + b2)) * lp.sBase,
      unit: 'MW',
      tol: 0.5,
      why: `−ΔP_tie12 = β₂·ΔP_L1/(β₁ + β₂) = ${fx(b2, 2)} × ${fx(Math.abs(lp.dPL1) > 0 ? lp.dPL1 : 0.1, 2)} / ${fx(b1 + b2, 2)} pu × ${lp.sBase} MW = ${fx(((b2 * (Math.abs(lp.dPL1) > 0 ? lp.dPL1 : 0.1)) / (b1 + b2)) * lp.sBase, 1)} MW.`,
      mistake: 'Using β₁ in the numerator gives the share of the area where the load changed; the power the OTHER area sends is β₂/(β₁ + β₂) of the step.',
    },
  ]
  useTutorContext(
    () => `Verify mode: hand checks of the two-area steady state (closed form vs simulation), ACE, initial RoCoF, AGC, the AVR steady-state error and the Routh limit (K_A,max ${fx(rt.kaMax, 3)}).`,
  )
  return (
    <div className="ps-stack">
      <Callout title="Every number here is computed twice">
        <p>
          Each check works a closed form by hand and compares it with the RK4 simulation{edited ? ' — for the settings you chose in Explore' : ''}. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      {Math.abs(lp.dPL1) < 1e-12 && Math.abs(lp.dPL2) < 1e-12 ? (
        <Callout tone="info" title="No load step in Explore">
          <p>Set a load step in Explore to check the frequency results.</p>
        </Callout>
      ) : (
        <>
          {priOk ? (
            <Calc
              title="1 · Primary control: the steady state (AGC off)"
              steps={[
                { label: 'β₁, β₂', expr: `D + 1/R = ${fx(lp.a1.D, 2)} + 1/${fx(lp.a1.R, 3)},  ${fx(lp.a2.D, 2)} + 1/${fx(lp.a2.R, 3)}`, result: `${fx(b1, 3)}, ${fx(b2, 3)} pu/pu` },
                ...(lp.T12 > 0
                  ? [
                      { label: 'Δf', expr: `−(${fx(lp.dPL1, 3)} + ${fx(lp.dPL2, 3)}) / (${fx(b1, 3)} + ${fx(b2, 3)}) × ${lp.f0}`, result: `${fx(ssPri.df1 * lp.f0, 5)} Hz` },
                      { label: 'ΔP_tie12', expr: `(${fx(b1, 3)} × ${fx(lp.dPL2, 3)} − ${fx(b2, 3)} × ${fx(lp.dPL1, 3)}) / ${fx(b1 + b2, 3)}`, result: `${fx(ssPri.tie, 5)} pu` },
                    ]
                  : [
                      { label: 'Δf₁ (alone)', expr: `−${fx(lp.dPL1, 3)} / ${fx(b1, 3)} × ${lp.f0}`, result: `${fx(ssPri.df1 * lp.f0, 5)} Hz` },
                      { label: 'Δf₂ (alone)', expr: `−${fx(lp.dPL2, 3)} / ${fx(b2, 3)} × ${lp.f0}`, result: `${fx(ssPri.df2 * lp.f0, 5)} Hz` },
                    ]),
                { label: 'Simulated after 120 s', expr: 'RK4, 10 ms', result: `Δf₁ ${fx(runPri.end.df1, 5)} Hz, ΔP_tie ${fx(runPri.end.tie, 5)} pu` },
              ]}
              check={{
                ok:
                  Math.abs(runPri.end.df1 - ssPri.df1 * lp.f0) <= 1e-3 * Math.max(Math.abs(ssPri.df1 * lp.f0), 1e-6) + 1e-7 &&
                  Math.abs(runPri.end.tie - ssPri.tie) <= 1e-3 * Math.max(Math.abs(ssPri.tie), 1e-6) + 1e-7,
                text: `Closed form and simulation agree (relative difference ${fx(rel(runPri.end.df1, ssPri.df1 * lp.f0) * 100, 4)} % in Δf).`,
              }}
            />
          ) : (
            <Callout tone="warn" title="1 · Primary control: no steady state to check">
              <p>With these settings the governors-only response oscillates without settling (it grows). Lower T₁₂ or reset Explore.</p>
            </Callout>
          )}
          {lp.T12 > 0 && priOk && (
            <Calc
              title="2 · Area control errors at that steady state (B = k·β)"
              steps={[
                { label: 'ACE₁ = ΔP_tie12 + B₁Δf', expr: `${fx(ssPri.tie, 5)} + ${fx(bias1(lp), 3)} × ${fx(ssPri.df1, 6)}`, result: `${fx(ssPri.tie + bias1(lp) * ssPri.df1, 5)} pu` },
                { label: 'ACE₂ = −ΔP_tie12 + B₂Δf', expr: `${fx(-ssPri.tie, 5)} + ${fx(bias2(lp), 3)} × ${fx(ssPri.df2, 6)}`, result: `${fx(-ssPri.tie + bias2(lp) * ssPri.df2, 5)} pu` },
              ]}
              check={{
                ok: Math.abs(runPri.end.ace1 - (ssPri.tie + bias1(lp) * ssPri.df1)) < 1e-4 && Math.abs(runPri.end.ace2 - (-ssPri.tie + bias2(lp) * ssPri.df2)) < 1e-4,
                text: `Simulated: ACE₁ ${fx(runPri.end.ace1, 5)}, ACE₂ ${fx(runPri.end.ace2, 5)} pu.${lp.kB === 1 ? ' With B = β each ACE equals minus that area’s own load step.' : ''}`,
              }}
            />
          )}
          <Calc
            title={`3 · Initial RoCoF, area ${k}`}
            steps={[
              { label: 'RoCoF(0)', expr: `−ΔP_L·f₀/(2H) = −${fx(dPL, 3)} × ${lp.f0} / (2 × ${fx(H, 1)})`, result: `${fx(r0, 4)} Hz/s` },
              { label: 'Simulated (first 10 μs step)', expr: 'Δf(h)/h', result: `${fx(k === 1 ? runFine.rocof1 : runFine.rocof2, 4)} Hz/s` },
            ]}
            check={{
              ok: rel(k === 1 ? runFine.rocof1 : runFine.rocof2, r0) < 1e-3,
              text: `Agree within 0.1 %. The other area starts at ${fx(k === 1 ? runFine.rocof2 : runFine.rocof1, 6)} Hz/s: the tie line has not acted yet.`,
            }}
          />
          {agcOk ? (
            <Calc
              title="4 · With AGC in both areas"
              steps={[
                { label: 'ACE₁ = ACE₂ = 0 and Δf₁ = Δf₂', expr: '⇒ Δf = 0, ΔP_tie12 = 0', result: 'ΔP_mi = ΔP_Li' },
                { label: 'Simulated after 150 s', expr: `K_I = ${lp.Ki} 1/s`, result: `Δf ${fx(runAgc.end.df1, 5)} Hz, ΔP_tie ${fx(runAgc.end.tie, 5)} pu, ΔP_m1 ${fx(runAgc.end.pm1, 4)} pu` },
              ]}
              check={{
                ok: Math.abs(runAgc.end.df1) < 1e-3 && Math.abs(runAgc.end.tie) < 1e-3 && Math.abs(runAgc.end.pm1 - lp.dPL1) < 1e-3,
                text: `Each area ends up covering its own step: ΔP_m1 = ${fx(runAgc.end.pm1, 4)} (ΔP_L1 = ${fx(lp.dPL1, 3)}), ΔP_m2 = ${fx(runAgc.end.pm2, 4)} (ΔP_L2 = ${fx(lp.dPL2, 3)}) pu.`,
              }}
            />
          ) : (
            <Callout tone="warn" title="4 · AGC: the closed loop is unstable with these settings">
              <p>The AGC run grows instead of settling; lower K_I or T₁₂ in Explore.</p>
            </Callout>
          )}
        </>
      )}
      {rt.stable && avrRun.trend === 'decaying' ? (
        <Calc
          title={`5 · AVR steady-state error, K_A = ${fx(ap.KA, 1)}`}
          steps={[
            { label: 'Loop gain K', expr: `${fx(ap.KA, 2)} × ${fx(ap.KE, 2)} × ${fx(ap.KG, 2)} × ${fx(ap.KR, 2)}`, result: fx(loopGain(ap), 3) },
            { label: 'e_ss = ΔV_ref/(1 + K)', expr: `${ap.dVref} / (1 + ${fx(loopGain(ap), 3)})`, result: `${fx(errSteady(ap), 5)} pu` },
            { label: 'Simulated after 60 s', expr: 'ΔV_ref − K_R·ΔV_t', result: `${fx(ap.dVref - ap.KR * avrRun.end, 5)} pu` },
          ]}
          check={{ ok: rel(ap.dVref - ap.KR * avrRun.end, errSteady(ap)) < 1e-3, text: 'The final value theorem and the simulation agree.' }}
        />
      ) : (
        <Callout tone="warn" title="5 · AVR: no steady state">
          <p>K_A in Explore is at or above the Routh limit, so the response does not settle; the error formula does not apply.</p>
        </Callout>
      )}
      <section className="ps-card" aria-label="Routh limit">
        <h3>6 · The Routh limit on K_A: the array</h3>
        <RouthTable r={rt} />
      </section>
      <Calc
        title="6 · From the array to the limit"
        steps={[
          { label: 'K_max = b₁a₁/a₃ − 1', expr: `${fx(rt.rows[2].v[0], 5)} × ${fx(rt.a[1], 4)} / ${fx(rt.a[3], 5)} − 1`, result: fx(rt.kMax, 3) },
          { label: 'K_A,max = K_max/(K_E K_G K_R)', expr: `${fx(rt.kMax, 3)} / ${fx(ap.KE * ap.KG * ap.KR, 3)}`, result: fx(rt.kaMax, 3) },
          { label: 'Simulated at 0.95 · K_A,max', expr: `K_A = ${fx(0.95 * rt.kaMax, 3)}`, result: `${avrB.trend} (envelope ×${fx(avrB.envRatio, 3)})` },
          { label: 'Simulated at 1.05 · K_A,max', expr: `K_A = ${fx(1.05 * rt.kaMax, 3)}`, result: `${avrA.trend} (envelope ×${fx(avrA.envRatio, 3)})` },
        ]}
        check={{ ok: avrB.trend === 'decaying' && avrA.trend === 'growing', text: 'Routh’s criterion and the simulation agree: decays just below the limit, grows just above.' }}
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
  const items = useMemo<QuizItem[]>(() => {
    // every number below comes from the models
    const pA: LfcParams = { ...LFC0, a1: { ...AREA0, R: 0.04 }, a2: { ...AREA0, R: 0.04 }, dPL1: 0.06 }
    const sA = steadyState(pA)
    const pB: LfcParams = { ...LFC0, a2: { ...AREA0, H: 10, D: 2, R: 0.025 } }
    const sB = steadyState(pB)
    const rc = rocof0(0.05, 4, 50)
    const avrQ: AvrParams = { ...AVR0, TA: 0.05, TE: 0.5, TG: 1, TR: 0.05 }
    const rq = routh(avrQ)
    const r0 = routh(AVR0)
    const kNeed = 1 / 0.02 - 1
    return [
      {
        id: 'why-all',
        kind: 'choice',
        level: 'concept',
        q: 'A large load is switched on in one region of an interconnected grid. Why does the frequency fall in the other regions too?',
        options: [
          { id: 'a', label: 'The tie lines carry the voltage drop to every region' },
          { id: 'b', label: 'All synchronous machines are locked together; the other regions send power through the ties and their rotors slow as well' },
          { id: 'c', label: 'The governors in every region lower their output' },
        ],
        answer: 'b',
        why: 'As the disturbed area’s rotors fall behind in angle, the tie lines carry power to it; that power comes from the kinetic energy of the other areas’ rotors, so they slow too.',
      },
      {
        id: 'sign',
        kind: 'choice',
        level: 'concept',
        q: 'With the convention “ΔP_tie12 > 0 means power from area 1 to area 2”, area 1’s load rises. What is the sign of ΔP_tie12 in the steady state (governors only)?',
        options: [
          { id: 'neg', label: 'Negative' },
          { id: 'pos', label: 'Positive' },
          { id: 'zero', label: 'Zero' },
        ],
        answer: steadyState(LFC0).tie < 0 ? 'neg' : steadyState(LFC0).tie > 0 ? 'pos' : 'zero',
        why: `ΔP_tie12 = −β₂ΔP_L1/(β₁ + β₂) = ${fx(steadyState(LFC0).tie, 3)} pu: area 2 sends power to area 1.`,
        mistake: 'Area 1 does not export its problem: it IMPORTS help, so the flow out of area 1 decreases.',
      },
      {
        id: 'rocof',
        kind: 'number',
        level: 'numerical',
        q: 'An area with H = 4 s (on the system base) loses 0.05 pu of generation balance (load rises by 0.05 pu). f₀ = 50 Hz. What is the initial rate of change of frequency?',
        answer: rc,
        unit: 'Hz/s',
        tol: 0.005,
        why: `RoCoF = −ΔP·f₀/(2H) = −0.05 × 50 / 8 = ${fx(rc, 4)} Hz/s.`,
        mistake: 'Forgetting the factor 2 in 2H doubles the answer.',
      },
      {
        id: 'df-two',
        kind: 'number',
        level: 'numerical',
        q: 'Two identical areas: D = 1 pu/pu and R = 4 % each. Area 1’s load rises by 0.06 pu. f₀ = 50 Hz, governors only. What is the steady-state frequency deviation?',
        answer: sA.df1 * 50,
        unit: 'Hz',
        tol: 0.0005,
        why: `β = 1 + 1/0.04 = 26 each; Δf = −0.06/(26 + 26) × 50 = ${fx(sA.df1 * 50, 4)} Hz.`,
        mistake: 'Using one area’s β alone gives twice the deviation — the connected neighbour shares the load.',
      },
      {
        id: 'tie-unequal',
        kind: 'number',
        level: 'university',
        q: `Area 1: β₁ = ${fx(beta(pB.a1), 0)} pu/pu; area 2: β₂ = ${fx(beta(pB.a2), 0)} pu/pu, both on a 1000 MW base. Area 1’s load rises by 100 MW. With governors only, how much power (MW) does area 2 send to area 1 in the steady state?`,
        answer: -sB.tie * 1000,
        unit: 'MW',
        tol: 0.5,
        why: `−ΔP_tie12 = β₂ΔP_L1/(β₁ + β₂) = 42 × 0.1/63 = ${fx(-sB.tie, 4)} pu = ${fx(-sB.tie * 1000, 1)} MW.`,
      },
      {
        id: 'ace2',
        kind: 'choice',
        level: 'university',
        q: 'With tie-line bias control (B = β in each area) and governors only, area 1’s load rises. At the primary steady state, what is area 2’s ACE?',
        options: [
          { id: 'zero', label: 'Zero — area 2 will not change its set point' },
          { id: 'neg', label: 'Negative — area 2 will raise its generation' },
          { id: 'pos', label: 'Positive — area 2 will lower its generation' },
        ],
        answer: Math.abs(-steadyState(LFC0).tie + beta(LFC0.a2) * steadyState(LFC0).df2) < 1e-9 ? 'zero' : -steadyState(LFC0).tie + beta(LFC0.a2) * steadyState(LFC0).df2 < 0 ? 'neg' : 'pos',
        why: 'ACE₂ = −ΔP_tie12 + β₂Δf = β₂ΔP_L1/(β₁+β₂) − β₂ΔP_L1/(β₁+β₂) = 0. The tie-line export exactly cancels the frequency term.',
      },
      {
        id: 'avr-gain',
        kind: 'choice',
        level: 'gate',
        q: `An AVR loop has T_A = 0.1 s, T_E = 0.4 s, T_G = 1 s, T_R = 0.05 s, K_E = K_G = K_R = 1. Can a steady-state error of at most 2 % be reached by raising K_A alone?`,
        options: [
          { id: 'yes', label: `Yes — K_A = ${fx(kNeed, 0)} gives 1/(1 + K_A) = 2 %` },
          { id: 'no', label: `No — that needs K_A ≥ ${fx(kNeed, 0)}, but the loop is unstable above K_A ≈ ${fx(r0.kaMax, 1)}` },
        ],
        answer: kNeed < r0.kaMax ? 'yes' : 'no',
        why: `1/(1 + K) ≤ 0.02 needs K ≥ ${fx(kNeed, 0)}; Routh gives K_A,max = ${fx(r0.kaMax, 2)}. A stabilising feedback or compensator (or integral action) is needed.`,
        mistake: 'Checking only the steady-state error and forgetting stability.',
      },
      {
        id: 'routh',
        kind: 'number',
        level: 'gate',
        q: 'An AVR loop: amplifier 1/(1 + 0.05s)·K_A, exciter 1/(1 + 0.5s), generator 1/(1 + s), sensor 1/(1 + 0.05s) (all other gains 1). Using Routh’s criterion, find the largest K_A for stability.',
        answer: rq.kaMax,
        unit: 'pu/pu',
        tol: 0.05,
        why: `(1 + 0.05s)(1 + 0.5s)(1 + s)(1 + 0.05s) + K: a₄…a₀ = ${rq.a
          .slice()
          .reverse()
          .map((v) => fx(v, 5))
          .join(', ')}; K_max = b₁a₁/a₃ − 1 = ${fx(rq.kaMax, 3)}.`,
        mistake: 'The limit comes from the s¹ row: b₁a₁ − a₃(1 + K) > 0, with b₁ = (a₃a₂ − a₄a₁)/a₃.',
      },
    ]
  }, [])
  useTutorContext(() => 'Practise mode: questions on two-area load-frequency control (RoCoF, steady-state sharing, tie-line sign, ACE) and the AVR loop (steady-state error, Routh limit).')
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">
        From concept to GATE-style; every number is computed by this module’s models. Written for this app — not past examination papers. Answer all correctly to complete the activity.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
