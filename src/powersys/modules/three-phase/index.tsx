import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { abs, arg, C, deg, div, mul, polarDeg, sub, type Complex } from '../../engine/complex.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { cx, fx, ph, sg } from '../../ui/format.ts'
import { Calc, Callout, Eq, Predict, Quiz, Readouts, Seg, Slider, Stepper, Toggle, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { Phasors, type Phasor } from '../../ui/Phasors.tsx'
import { Plot, type PlotSeries } from '../../ui/Plot.tsx'
import {
  abcdSections,
  angDeg,
  balancedSet,
  betaL,
  chargingMvar,
  disturbedSet,
  instantaneousPower,
  LINE_PRESETS,
  lineAbcd,
  lineParams,
  linePerformance,
  lossless,
  maxReceivingPower,
  MODEL_LABEL,
  powerAngle,
  powerSummary,
  receivingPowerCircle,
  setSum,
  sil,
  singlePhasePower,
  solveLoad,
  SQRT3,
  voltageProfile,
  wrapDeg,
  type Conn,
  type LineConstants,
  type LineModel,
  type LinePerformance,
  type LoadSolution,
  type PhaseSet,
} from './calc.ts'
import { EXPERIMENTS, runExperiment, type Experiment } from './experiments.ts'
import { ClockControls, ConnectionSketch, LineSketch, PHASE, PowerTriangle, RotatingView, SUM_COLOR, useClock } from './views.tsx'
import './three-phase.css'

/*
 * Module 2 — Three-Phase Power, Phasors & Lines. Every number on the page is computed in calc.ts: the phasor sets,
 * star and delta loads, three-phase power, and the short / nominal-π / exact long-line models with the voltage along
 * the line. Learn: a guided tour. Explore: four labs. Experiment: predict, then compare. Verify: the same numbers by
 * hand. Practise: questions whose answers come from the model.
 */

const MODULE = 'three-phase'
/** Low-voltage supply for the load labs: 400 V between lines (230.9 V to neutral), 50 Hz. */
const V_LINE = 400
const F = 50

type Lab = 'phasors' | 'star-delta' | 'power' | 'line'
interface LoadState {
  conn: Conn
  zOhm: number
  phiDeg: number
}
const LOAD0: LoadState = { conn: 'star', zOhm: 20, phiDeg: deg(Math.acos(0.8)) }
interface PhState {
  bScale: number
  bShift: number
  showSum: boolean
}
const PH0: PhState = { bScale: 1, bShift: 0, showSum: true }
interface LineState {
  preset: string
  k: LineConstants
  lengthKm: number
  pMw: number
  pf: number
  lagging: boolean
  model: LineModel
}
const presetOf = (id: string) => LINE_PRESETS.find((p) => p.id === id) ?? LINE_PRESETS[2]
const constantsOf = (id: string): LineConstants => {
  const p = presetOf(id)
  return { rOhmPerKm: p.rOhmPerKm, xOhmPerKm: p.xOhmPerKm, bUsPerKm: p.bUsPerKm }
}
const LINE0: LineState = { preset: '400', k: constantsOf('400'), lengthKm: 300, pMw: 400, pf: 0.95, lagging: true, model: 'long' }

const pfText = (phiDeg: number) => (Math.abs(phiDeg) < 0.05 ? `pf 1.00` : `pf ${fx(Math.cos((phiDeg * Math.PI) / 180), 2)} ${phiDeg > 0 ? 'lagging' : 'leading'}`)
const r2d = (r: number) => (r * 180) / Math.PI

// ── line calculations for the current settings ────────────────────────────────────────────────────────────────

function lineCalc(s: LineState) {
  const kv = presetOf(s.preset).kv
  const p = lineParams(s.k, s.lengthKm)
  const load = { pMw: s.pMw, pf: s.pf, lagging: s.lagging }
  const perf = {
    short: linePerformance(lineAbcd(s.k, s.lengthKm, 'short'), kv, load),
    medium: linePerformance(lineAbcd(s.k, s.lengthKm, 'medium'), kv, load),
    long: linePerformance(lineAbcd(s.k, s.lengthKm, 'long'), kv, load),
  } satisfies Record<LineModel, LinePerformance>
  const silMw = sil(kv, p.zcLossless)
  const bl = betaL(s.k, s.lengthKm)
  /** Exact profile for a load with the receiving end at rated voltage. */
  const profile = (pMw: number, pf = 1, lagging = true) => {
    const pr = linePerformance(perf.long.abcd, kv, { pMw, pf, lagging })
    return voltageProfile(p, s.lengthKm, pr.vr, pr.ir, 100)
  }
  return { kv, p, perf, sel: perf[s.model], silMw, bl, profile }
}
type LineCalc = ReturnType<typeof lineCalc>

export default function ThreePhaseModule({ mode, setMode }: ModuleProps) {
  const [lab, setLab] = useState<Lab>('phasors')
  const [load, setLoad] = useState<LoadState>(LOAD0)
  const [phs, setPhs] = useState<PhState>(PH0)
  const [line, setLine] = useState<LineState>(LINE0)
  const [seenConn, setSeenConn] = useState<Conn[]>([])
  const [seenLine, setSeenLine] = useState<string[]>([])
  return (
    <div className="ps-3p">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && (
        <Explore
          lab={lab}
          setLab={setLab}
          load={load}
          setLoad={setLoad}
          phs={phs}
          setPhs={setPhs}
          line={line}
          setLine={setLine}
          seenConn={seenConn}
          setSeenConn={setSeenConn}
          seenLine={seenLine}
          setSeenLine={setSeenLine}
        />
      )}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify load={load} line={line} edited={load !== LOAD0 || line !== LINE0} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── shared pieces ─────────────────────────────────────────────────────────────────────────────────────────────

/** The construction V_ab = V_a − V_b on a star supply (and optionally the other two line voltages). */
function starPhasors(l: LoadSolution, all: boolean): Phasor[] {
  const out: Phasor[] = [
    { id: 'va', label: 'V_a', ...l.vPh.a, color: PHASE[0].color },
    { id: 'vb', label: 'V_b', ...l.vPh.b, color: PHASE[1].color },
    { id: 'vc', label: 'V_c', ...l.vPh.c, color: PHASE[2].color },
    { id: 'nvb', label: '', re: -l.vPh.b.re, im: -l.vPh.b.im, from: l.vPh.a, color: PHASE[1].color, dashed: true, thin: true },
    { id: 'vab', label: 'V_ab', ...l.vLine.a, color: SUM_COLOR },
  ]
  if (all) out.push({ id: 'vbc', label: 'V_bc', ...l.vLine.b, color: SUM_COLOR, thin: true }, { id: 'vca', label: 'V_ca', ...l.vLine.c, color: SUM_COLOR, thin: true })
  return out
}

/** The construction I_a = I_ab − I_ca in a delta load. */
function deltaPhasors(l: LoadSolution, all: boolean): Phasor[] {
  const out: Phasor[] = [
    { id: 'iab', label: 'I_ab', ...l.iZ.a, color: PHASE[0].color },
    { id: 'ibc', label: 'I_bc', ...l.iZ.b, color: PHASE[1].color },
    { id: 'ica', label: 'I_ca', ...l.iZ.c, color: PHASE[2].color },
    { id: 'nica', label: '', re: -l.iZ.c.re, im: -l.iZ.c.im, from: l.iZ.a, color: PHASE[2].color, dashed: true, thin: true },
    { id: 'ia', label: 'I_a', ...l.iLine.a, color: SUM_COLOR },
  ]
  if (all) out.push({ id: 'ib', label: 'I_b', ...l.iLine.b, color: SUM_COLOR, thin: true }, { id: 'ic', label: 'I_c', ...l.iLine.c, color: SUM_COLOR, thin: true })
  return out
}

function powerSeries(l: LoadSolution, kind: 'phases' | 'compare'): PlotSeries[] {
  const pts = instantaneousPower(l, 180)
  const total: PlotSeries = { id: 'tot', label: 'p_a + p_b + p_c', color: SUM_COLOR, points: pts.map((p) => [r2d(p.wt), p.total / 1000]) }
  if (kind === 'phases')
    return [
      { id: 'pa', label: 'p_a', color: PHASE[0].color, points: pts.map((p) => [r2d(p.wt), p.pa / 1000]) },
      { id: 'pb', label: 'p_b', color: PHASE[1].color, points: pts.map((p) => [r2d(p.wt), p.pb / 1000]) },
      { id: 'pc', label: 'p_c', color: PHASE[2].color, points: pts.map((p) => [r2d(p.wt), p.pc / 1000]) },
      total,
    ]
  const s = powerSummary(l)
  const one = singlePhasePower(s.vPh, 3 * s.iPh, l.phiDeg, 180)
  return [total, { id: 'one', label: 'single-phase', color: 'var(--ps-ehv)', points: one.map((p) => [r2d(p.wt), p.p / 1000]), dashed: true }]
}

function LoadControls({ load, setLoad, showConn = true }: { load: LoadState; setLoad(l: LoadState): void; showConn?: boolean }) {
  return (
    <>
      {showConn && (
        <Seg
          label="Connection"
          full
          value={load.conn}
          onChange={(conn) => setLoad({ ...load, conn })}
          options={[
            { id: 'star', label: 'Star (Y)' },
            { id: 'delta', label: 'Delta (Δ)' },
          ]}
        />
      )}
      <Slider label="Impedance per phase |Z|" value={load.zOhm} min={5} max={50} step={0.5} unit="Ω" decimals={1} onChange={(zOhm) => setLoad({ ...load, zOhm })} />
      <Slider
        label="Impedance angle φ"
        value={load.phiDeg}
        min={-60}
        max={60}
        step={1}
        unit="°"
        decimals={1}
        onChange={(phiDeg) => setLoad({ ...load, phiDeg })}
        hint={`${pfText(load.phiDeg)} — ${load.phiDeg > 0 ? 'inductive: current lags voltage' : load.phiDeg < 0 ? 'capacitive: current leads voltage' : 'resistive'}`}
      />
    </>
  )
}

// ── Learn ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Learn({ onExplore }: { onExplore(): void }) {
  const [step, setStep] = useState(0)
  const clock = useClock(3)
  const bal = balancedSet(V_LINE / SQRT3)
  const sumBal = setSum(bal)
  const star = solveLoad(V_LINE, LOAD0.zOhm, LOAD0.phiDeg, 'star')
  const delta = solveLoad(V_LINE, LOAD0.zOhm, LOAD0.phiDeg, 'delta')
  const ps = powerSummary(star)
  const lc = useMemo(() => lineCalc(LINE0), [])
  const L = LINE0.lengthKm
  const nl = lc.perf.long
  const nlRise = 1 / abs(nl.abcd.A)
  const lossless400 = lossless(LINE0.k)
  const pmax = maxReceivingPower(nl.abcd, lc.kv, lc.kv)
  const xSeries = LINE0.k.xOhmPerKm * L
  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode }> = [
    {
      title: 'Three windings, 120° apart',
      visual: (
        <>
          <RotatingView set={bal} wt={clock.wt} showSum={false} label="Three rotating phasors and their waveforms" />
          <ClockControls clock={clock} freq={F} />
        </>
      ),
      body: (
        <>
          <p>
            A generator has three identical windings spaced 120° around its stator. As the rotor turns, each produces the same sine wave, one third of a turn after the other. That is a{' '}
            <b>phase sequence a-b-c</b> (R-Y-B in Indian practice): v_b lags v_a by 120°, v_c lags by 240°.
          </p>
          <p>
            A phasor is the wave frozen into one arrow: its length is the RMS value ({fx(abs(bal.a), 1)} V here), its angle the wave’s phase. Let it rotate at ω = 2π·{F} rad/s and its <b>height</b> is
            the instantaneous value.
          </p>
          <Eq
            expr="v = √2·V·sin(ωt − k·120°)"
            where={[
              ['k', '0 for phase a, 1 for b, 2 for c'],
              ['V', 'RMS phase voltage', 'V'],
              ['ω', `2π·f, f = ${F} Hz`, 'rad/s'],
            ]}
          />
        </>
      ),
    },
    {
      title: 'A balanced set adds up to zero',
      visual: (
        <Phasors
          label="Tip to tail: V_a, then V_b, then V_c close the triangle"
          phasors={[
            { id: 'a', label: 'V_a', ...bal.a, color: PHASE[0].color },
            { id: 'b', label: 'V_b', ...bal.b, from: bal.a, color: PHASE[1].color },
            { id: 'c', label: 'V_c', ...bal.c, from: { re: bal.a.re + bal.b.re, im: bal.a.im + bal.b.im }, color: PHASE[2].color },
          ]}
          size={300}
          showCircle={false}
          unit="V"
        />
      ),
      body: (
        <>
          <p>
            Place the three phasors tip to tail and they close a triangle: V_a + V_b + V_c = <b>{fx(abs(sumBal), 3)} V</b>. At every instant the three voltages add to zero — when one is at its peak,
            the other two are each at minus half of it.
          </p>
          <p>
            So three equal loads connected to a common point (a star point) return no current at all: the three currents also add to zero. Three wires can do the work of six. In Explore you can
            unbalance one phase and watch the sum appear.
          </p>
        </>
      ),
    },
    {
      title: 'Star: the line voltage is √3 times the phase voltage',
      visual: <Phasors label="Star supply: V_ab = V_a − V_b" phasors={starPhasors(star, false)} size={300} unit="V" />,
      body: (
        <>
          <p>
            In a star (Y) connection each winding sits between a line and the neutral: that is the <b>phase voltage</b>, {fx(abs(star.vPh.a), 1)} V. Between two lines you see the difference of two
            phase voltages: V_ab = V_a − V_b.
          </p>
          <p>
            Two phasors 120° apart subtract to one √3 times longer, turned 30° forward: |V_ab| = √3 × {fx(abs(star.vPh.a), 2)} = <b>{fx(abs(star.vLine.a), 1)} V</b> at {fx(angDeg(star.vLine.a), 1)}°.
            That is why a 230 V supply is a 400 V three-phase supply. The line current is the phase current: they are the same wire.
          </p>
          <Eq expr="V_L = √3 · V_ph ∠ +30°     I_L = I_ph" assume="balanced, sequence a-b-c" />
        </>
      ),
    },
    {
      title: 'Delta: the line current is √3 times the phase current',
      visual: <Phasors label="Delta load: I_a = I_ab − I_ca" phasors={deltaPhasors(delta, false)} size={300} unit="A" />,
      body: (
        <>
          <p>In a delta (Δ) each impedance sits between two lines, so it sees the full line voltage. Each line feeds two impedances, and by Kirchhoff’s current law I_a = I_ab − I_ca.</p>
          <p>
            With {LOAD0.zOhm} Ω per branch ({pfText(LOAD0.phiDeg)}) each branch carries {fx(abs(delta.iZ.a), 2)} A, and each line <b>{fx(abs(delta.iLine.a), 2)} A</b> — √3 times more, lagging its
            branch current by {fx(-wrapDeg(angDeg(delta.iLine.a) - angDeg(delta.iZ.a)), 1)}°.
          </p>
          <Eq expr="V_L = V_ph     I_L = √3 · I_ph ∠ −30°" assume="balanced, sequence a-b-c" />
        </>
      ),
    },
    {
      title: 'Three-phase power is steady',
      visual: <Plot series={powerSeries(star, 'phases')} xLabel="ωt [°]" yLabel="p [kW]" label="Instantaneous power of each phase and their sum" xDomain={[0, 360]} height={250} />,
      body: (
        <>
          <p>
            Each phase’s power v·i pulsates at twice the supply frequency, between {fx((ps.p1 - ps.s1) / 1000, 2)} and {fx((ps.p1 + ps.s1) / 1000, 2)} kW. But the three pulsations are 120° apart and
            cancel: the total is a constant <b>{fx(ps.p / 1000, 2)} kW</b> — a generator feels a steady torque, a motor delivers a smooth one.
          </p>
          <Eq
            expr="P = 3·V_ph·I_ph·cos φ = √3·V_L·I_L·cos φ"
            where={[
              ['P', `here √3 × ${fx(ps.vL, 0)} V × ${fx(ps.iL, 2)} A × ${fx(ps.pf, 2)} = ${fx(ps.pFromLine / 1000, 2)} kW`, 'W'],
              ['Q', `3·V_ph·I_ph·sin φ = ${fx(ps.q / 1000, 2)} kvar`, 'var'],
              ['S', `√(P² + Q²) = ${fx(ps.s / 1000, 2)} kVA`, 'VA'],
            ]}
            assume="balanced; φ is the angle of the load impedance (the angle by which phase current lags phase voltage)"
          />
        </>
      ),
    },
    {
      title: 'A transmission line: R and L along it, C across it',
      visual: (
        <LineSketch
          model="long"
          Z={lc.p.Z}
          Y={lc.p.Y}
          lengthKm={L}
          gamma={lc.p.gamma}
          zc={lc.p.zc}
          vs={`${fx(nl.vsLL, 1)} kV ∠ ${fx(nl.deltaDeg, 1)}°`}
          vr={`${fx(lc.kv, 0)} kV, ${fx(LINE0.pMw, 0)} MW`}
        />
      ),
      body: (
        <>
          <p>
            Each conductor has resistance and inductance along its length and capacitance to the others. For a {L} km, {lc.kv} kV line: Z = {cx(lc.p.Z.re, lc.p.Z.im, 1)} Ω in series, Y = j
            {fx(lc.p.Y.im * 1e6, 0)} µS across.
          </p>
          <p>
            A short line (under about 80 km) needs only Z; a medium one lumps the capacitance at its ends (the nominal π); a long one must treat both as spread out — the exact solution. All three
            reduce to the same two-port: V_s = A·V_r + B·I_r, I_s = C·V_r + D·I_r.
          </p>
          <Eq
            expr="A = D = cosh γl    B = Z_c·sinh γl    C = sinh γl / Z_c"
            where={[
              ['γ', `√(z·y) = ${cx(lc.p.gamma.re * 1000, lc.p.gamma.im * 1000, 4)} per 1000 km`],
              ['Z_c', `√(z/y) = ${cx(lc.p.zc.re, lc.p.zc.im, 1)} Ω`, 'Ω'],
            ]}
            assume="a uniform line, balanced, steady state; shunt conductance neglected; per phase to neutral"
          />
        </>
      ),
    },
    {
      title: 'Light load: the far end rises — the Ferranti effect',
      visual: <ProfilePlot lc={lc} lengthKm={L} you={null} />,
      body: (
        <>
          <p>
            Unloaded, the line still draws charging current through its capacitance. That current flows through the series inductance and <b>raises</b> the voltage towards the open end. With the far
            end at {lc.kv} kV, the sending end needs only {fx(lc.kv * abs(nl.abcd.A), 1)} kV: the receiving end is {fx((nlRise - 1) * 100, 2)} % higher.
          </p>
          <p>
            For a lossless line V_r/V_s = 1/cos βl. Here βl = {fx(r2d(betaL(lossless400, L)), 2)}°, so 1/cos βl = {fx(1 / Math.cos(betaL(lossless400, L)), 4)} (with resistance: {fx(nlRise, 4)}). It
            grows rapidly with length.
          </p>
          <p>
            Load the line to <b>{fx(lc.silMw, 0)} MW</b> — its surge impedance loading, V²/Z_c — and the reactive power its capacitance makes equals what its inductance absorbs: the profile is flat.
            Above SIL it sags.
          </p>
        </>
      ),
    },
    {
      title: 'How much power can a line carry?',
      visual: <PowerAnglePlot lc={lc} lengthKm={L} k={LINE0.k} youMw={null} />,
      body: (
        <>
          <p>
            With both ends held at {lc.kv} kV, power flows because the sending voltage leads the receiving one by the load angle δ. Neglecting resistance and capacitance, P = V_s·V_r·sin δ / X, with X
            = {fx(xSeries, 1)} Ω: at most {fx((lc.kv * lc.kv) / xSeries, 0)} MW at δ = 90°.
          </p>
          <p>
            The exact line (its ABCD constants) gives <b>{fx(pmax.pMw, 0)} MW</b> at δ = {fx(pmax.deltaDeg, 1)}°. Real lines run at a fraction of this, far from the peak, to stay stable — and long
            lines are usually limited by stability and voltage, short ones by heating.
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore the labs yourself →
          </button>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — tour step ${step + 1} of ${steps.length}: ${cur.title}. Values: 400 V / 230.9 V supply at 50 Hz; load ${LOAD0.zOhm} Ω per phase at pf 0.8 lagging: star P = ${fx(ps.p / 1000, 2)} kW, delta line current ${fx(abs(delta.iLine.a), 2)} A. Line: ${lc.kv} kV, ${L} km, r = ${LINE0.k.rOhmPerKm}, x = ${LINE0.k.xOhmPerKm} Ω/km, b = ${LINE0.k.bUsPerKm} µS/km; Zc = ${fx(abs(lc.p.zc), 1)} Ω, SIL = ${fx(lc.silMw, 0)} MW, no-load rise ${fx((nlRise - 1) * 100, 2)} %, Pmax ${fx(pmax.pMw, 0)} MW.`,
  )
  return (
    <div className="ps-split ps-split--wide-side ps-3p-learn">
      <div className="ps-3p-visual">{cur.visual}</div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

// ── line plots ────────────────────────────────────────────────────────────────────────────────────────────────

function ProfilePlot({ lc, lengthKm, you }: { lc: LineCalc; lengthKm: number; you: { pMw: number; pf: number; lagging: boolean } | null }) {
  const toPts = (pr: Array<{ dKm: number; vLL: number }>) => pr.map((x) => [x.dKm, x.vLL] as [number, number])
  const series: PlotSeries[] = [
    { id: 'nl', label: 'No load', color: 'var(--ps-c)', points: toPts(lc.profile(0)) },
    { id: 'sil', label: 'SIL', color: 'var(--ps-mv)', points: toPts(lc.profile(lc.silMw)) },
    { id: 'hv', label: '1.5 × SIL', color: 'var(--ps-a)', points: toPts(lc.profile(1.5 * lc.silMw)) },
  ]
  if (you) series.push({ id: 'you', label: 'Your load', color: SUM_COLOR, points: toPts(lc.profile(you.pMw, you.pf, you.lagging)), dashed: true })
  else series.splice(1, 0, { id: 'half', label: '0.5 × SIL', color: 'var(--ps-hv)', points: toPts(lc.profile(0.5 * lc.silMw)) })
  series.push({
    id: 'rated',
    label: `${lc.kv} kV`,
    color: 'var(--text-3)',
    points: [
      [0, lc.kv],
      [lengthKm, lc.kv],
    ],
    dashed: true,
  })
  return (
    <Plot
      series={series}
      xLabel="Distance from sending end [km]"
      yLabel="Line voltage |V| [kV]"
      xDomain={[0, lengthKm]}
      height={250}
      label={`Voltage along the ${lengthKm} km line, receiving end held at ${lc.kv} kV: no load, at SIL ${fx(lc.silMw, 0)} MW, at 1.5 × SIL${you ? ', and your load' : ''}`}
    />
  )
}

function PowerAnglePlot({ lc, lengthKm, k, youMw }: { lc: LineCalc; lengthKm: number; k: LineConstants; youMw: number | null }) {
  const m = lc.perf.long.abcd
  const X = k.xOhmPerKm * lengthKm
  const ds = Array.from({ length: 91 }, (_, i) => i * 2)
  const max = maxReceivingPower(m, lc.kv, lc.kv)
  const hl = [{ y: lc.silMw, label: `SIL ${fx(lc.silMw, 0)} MW` }]
  if (youMw !== null) hl.push({ y: youMw, label: `your load ${fx(youMw, 0)} MW` })
  return (
    <Plot
      series={[
        { id: 'ex', label: 'Exact line', color: 'var(--ps-a)', points: ds.map((d) => [d, receivingPowerCircle(m, lc.kv, lc.kv, d)]) },
        { id: 'sx', label: 'V²·sin δ / X', color: 'var(--ps-c)', points: ds.map((d) => [d, powerAngle(lc.kv, lc.kv, X, d)]), dashed: true },
      ]}
      xLabel="Load angle δ [°]"
      yLabel="Receiving-end power [MW]"
      xDomain={[0, 180]}
      vlines={[{ x: max.deltaDeg, label: `max ${fx(max.pMw, 0)} MW at ${fx(max.deltaDeg, 1)}°` }]}
      hlines={hl}
      height={250}
      label={`Power–angle curve with both ends at ${lc.kv} kV: exact maximum ${fx(max.pMw, 0)} MW at ${fx(max.deltaDeg, 1)} degrees; simple formula maximum ${fx((lc.kv * lc.kv) / X, 0)} MW at 90 degrees`}
    />
  )
}

// ── Explore ───────────────────────────────────────────────────────────────────────────────────────────────────

interface ExploreProps {
  lab: Lab
  setLab(l: Lab): void
  load: LoadState
  setLoad(l: LoadState): void
  phs: PhState
  setPhs(p: PhState): void
  line: LineState
  setLine(l: LineState): void
  seenConn: Conn[]
  setSeenConn(c: Conn[]): void
  seenLine: string[]
  setSeenLine(s: string[]): void
}

const LABS: Array<{ id: Lab; label: string }> = [
  { id: 'phasors', label: 'Phasors' },
  { id: 'star-delta', label: 'Star & delta' },
  { id: 'power', label: 'Power' },
  { id: 'line', label: 'Transmission line' },
]

function Explore(props: ExploreProps) {
  const { lab, setLab } = props
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg label="Lab" value={lab} onChange={setLab} options={LABS} />
        <span className="small muted">
          {lab === 'line' ? `Overhead line, ${F} Hz, balanced, per phase to neutral` : `Supply: ${V_LINE} V line-to-line (${fx(V_LINE / SQRT3, 1)} V to neutral), ${F} Hz, balanced`}
        </span>
      </div>
      {lab === 'phasors' && <PhasorLab phs={props.phs} setPhs={props.setPhs} />}
      {lab === 'star-delta' && <StarDeltaLab load={props.load} setLoad={props.setLoad} seen={props.seenConn} setSeen={props.setSeenConn} />}
      {lab === 'power' && <PowerLab load={props.load} setLoad={props.setLoad} />}
      {lab === 'line' && <LineLab line={props.line} setLine={props.setLine} seen={props.seenLine} setSeen={props.setSeenLine} />}
    </div>
  )
}

function PhasorLab({ phs, setPhs }: { phs: PhState; setPhs(p: PhState): void }) {
  const clock = useClock(3)
  const vph = V_LINE / SQRT3
  const set: PhaseSet = disturbedSet(vph, phs.bScale, phs.bShift)
  const s = setSum(set)
  const balanced = phs.bScale === 1 && phs.bShift === 0
  useTutorContext(
    () =>
      `Explore — Phasors lab. Phase voltages: V_a ${ph(abs(set.a), angDeg(set.a), 1, 1)} V, V_b ${ph(abs(set.b), angDeg(set.b), 1, 1)} V, V_c ${ph(abs(set.c), angDeg(set.c), 1, 1)} V. Sum ${ph(abs(s), angDeg(s), 2, 1)} V. Instant ωt = ${fx(r2d(clock.wt), 0)}°.`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <div className="ps-card ps-3p-flush">
          <RotatingView set={set} wt={clock.wt} showSum={phs.showSum} label="Rotating phasors of phases a, b, c and their waveforms" />
          <ClockControls clock={clock} freq={F} />
        </div>
        <Eq
          title="What you are looking at"
          expr="v(t) = √2·|V|·sin(ωt + θ) — the height of a phasor of length √2·|V| turning at ω"
          assume={`RMS phasors; one ${1000 / F} ms cycle shown in 3 s; Σ is the phasor V_a + V_b + V_c and its waveform`}
        />
      </div>
      <div className="ps-stack">
        <Readouts
          items={[
            {
              label: 'Sum of the three',
              value: fx(abs(s), 2),
              unit: 'V',
              tone: balanced ? 'good' : 'warn',
              note: balanced ? '|V_a + V_b + V_c| = 0: balanced' : `|V_a + V_b + V_c|, ${fx((abs(s) / vph) * 100, 1)} % of V_ph`,
            },
            { label: 'Angle of the sum', value: abs(s) < 1e-6 ? '—' : fx(angDeg(s), 1), unit: abs(s) < 1e-6 ? undefined : '°', note: abs(s) < 1e-6 ? 'no sum, no angle' : undefined },
            { label: 'Phase b voltage', value: fx(abs(set.b), 1), unit: 'V', note: `V_b at ${fx(angDeg(set.b), 1)}°` },
            { label: 'Phase b behind a', value: fx(wrapDeg(angDeg(set.a) - angDeg(set.b)), 1), unit: '°' },
          ]}
        />
        <section className="ps-card" aria-labelledby="ps-3p-unb">
          <h3 id="ps-3p-unb">Unbalance phase b</h3>
          <Slider label="Magnitude of V_b" value={phs.bScale * 100} min={50} max={150} step={1} unit="%" decimals={0} onChange={(v) => setPhs({ ...phs, bScale: v / 100 })} />
          <Slider
            label="Angle error of V_b"
            value={phs.bShift}
            min={-60}
            max={60}
            step={1}
            unit="°"
            decimals={0}
            onChange={(v) => setPhs({ ...phs, bShift: v })}
            hint="0° keeps it exactly 120° behind V_a"
          />
          <div className="ps-toolbar-group ps-3p-row">
            <Toggle label="Show the sum Σ" checked={phs.showSum} onChange={(showSum) => setPhs({ ...phs, showSum })} />
            <button type="button" className="text-btn" onClick={() => setPhs({ ...PH0, showSum: phs.showSum })} disabled={balanced}>
              Balance again
            </button>
          </div>
          <p className="small muted">
            {balanced
              ? 'Balanced: equal magnitudes, exactly 120° apart. The Σ waveform is a flat line.'
              : 'Unbalanced: the sum is no longer zero. In a four-wire supply this drives current in the neutral.'}
          </p>
        </section>
      </div>
    </div>
  )
}

function StarDeltaLab({ load, setLoad, seen, setSeen }: { load: LoadState; setLoad(l: LoadState): void; seen: Conn[]; setSeen(c: Conn[]): void }) {
  const [qty, setQty] = useState<'v' | 'i'>(load.conn === 'star' ? 'v' : 'i')
  const [all, setAll] = useState(false)
  const progress = usePsProgress()
  const l = solveLoad(V_LINE, load.zOhm, load.phiDeg, load.conn)
  const s = powerSummary(l)
  useEffect(() => {
    if (!seen.includes(load.conn)) {
      const next = [...seen, load.conn]
      setSeen(next)
      if (next.length >= 2) completeActivity(MODULE, 'star-delta')
    }
  }, [load.conn, seen, setSeen])
  const setConn = (conn: Conn) => {
    setLoad({ ...load, conn })
    setQty(conn === 'star' ? 'v' : 'i')
  }
  const vAngle = wrapDeg(angDeg(l.vLine.a) - angDeg(l.vPh.a))
  const iAngle = wrapDeg(angDeg(l.iLine.a) - angDeg(l.iZ.a))
  let phasors: Phasor[]
  let title: string
  if (qty === 'v') {
    // delta: the branch voltages are the line voltages; the supply's phase voltages are shown thin for reference
    phasors =
      load.conn === 'star'
        ? starPhasors(l, all)
        : starPhasors(l, true)
            .filter((p) => p.id !== 'nvb')
            .map((p) => (['vab', 'vbc', 'vca'].includes(p.id) ? { ...p, thin: false } : { ...p, thin: true, dashed: true }))
    title = load.conn === 'star' ? 'Voltages: V_ab = V_a − V_b' : 'Voltages: each branch sees a line voltage (supply neutral dashed)'
  } else {
    phasors =
      load.conn === 'delta'
        ? deltaPhasors(l, all)
        : [
            { id: 'ia', label: 'I_a', ...l.iLine.a, color: PHASE[0].color },
            { id: 'ib', label: 'I_b', ...l.iLine.b, color: PHASE[1].color },
            { id: 'ic', label: 'I_c', ...l.iLine.c, color: PHASE[2].color },
          ]
    title = load.conn === 'delta' ? 'Currents: I_a = I_ab − I_ca' : 'Currents: line current = phase current'
  }
  useTutorContext(
    () =>
      `Explore — Star & delta lab. ${load.conn} load, |Z| = ${fx(load.zOhm, 1)} Ω at ${fx(load.phiDeg, 1)}° (${pfText(load.phiDeg)}), ${V_LINE} V supply. V_ph across each impedance ${fx(s.vPh, 2)} V, V_L ${fx(s.vL, 2)} V, I_ph ${fx(s.iPh, 3)} A, I_L ${fx(s.iL, 3)} A, P ${fx(s.p, 1)} W. Showing ${qty === 'v' ? 'voltage' : 'current'} phasors.`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <div className="ps-3p-sdgrid">
          <div className="ps-card ps-3p-flush">
            <p className="eyebrow">{load.conn === 'star' ? 'Star (Y) connection' : 'Delta (Δ) connection'}</p>
            <ConnectionSketch conn={load.conn} />
            <p className="ps-3p-sketch-text">
              {load.conn === 'star'
                ? `V_ab is measured from line a to line b — across two impedances in series, Z(a) and Z(b). Each impedance carries its line’s current: ${fx(s.iL, 2)} A.`
                : `Each impedance is connected straight across two lines, so it has the full ${fx(s.vL, 0)} V. Each line current splits between the two branches it feeds.`}
            </p>
          </div>
          <div className="ps-card ps-3p-flush">
            <p className="ps-3p-cap">{title}</p>
            {((qty === 'v' && load.conn === 'star') || (qty === 'i' && load.conn === 'delta')) && (
              <p className="small muted">{qty === 'v' ? 'Dashed: −V_b drawn from the tip of V_a; their sum is V_ab.' : 'Dashed: −I_ca drawn from the tip of I_ab; their sum is I_a.'}</p>
            )}
            <Phasors label={title} phasors={phasors} size={300} unit={qty === 'v' ? 'V' : 'A'} />
            <div className="ps-toolbar-group ps-3p-row">
              <Seg
                label="Phasors shown"
                value={qty}
                onChange={(v) => setQty(v)}
                options={[
                  { id: 'v', label: 'Voltages' },
                  { id: 'i', label: 'Currents' },
                ]}
              />
              {((qty === 'v' && load.conn === 'star') || (qty === 'i' && load.conn === 'delta')) && <Toggle label="All three" checked={all} onChange={setAll} />}
            </div>
          </div>
        </div>
        {load.conn === 'star' ? (
          <Eq
            expr="V_ab = V_a − V_b = √3·V_a ∠ +30°     I_L = I_ph"
            where={[
              ['V_ph', `${fx(s.vPh, 2)} V (line to neutral)`, 'V'],
              ['V_L', `√3 × ${fx(s.vPh, 2)} = ${fx(s.vL, 2)} V, leading V_a by ${fx(vAngle, 1)}°`, 'V'],
              ['I_L', `= I_ph = ${fx(s.vPh, 2)} / ${fx(load.zOhm, 1)} = ${fx(s.iL, 3)} A`, 'A'],
            ]}
            assume="balanced supply and load, sequence a-b-c"
          />
        ) : (
          <Eq
            expr="I_a = I_ab − I_ca = √3·I_ab ∠ −30°     V_ph = V_L"
            where={[
              ['I_ph', `${fx(s.vL, 1)} / ${fx(load.zOhm, 1)} = ${fx(s.iPh, 3)} A in each branch`, 'A'],
              ['I_L', `√3 × ${fx(s.iPh, 3)} = ${fx(s.iL, 3)} A, ${fx(Math.abs(iAngle), 1)}° behind I_ab`, 'A'],
            ]}
            assume="balanced supply and load, sequence a-b-c"
          />
        )}
      </div>
      <div className="ps-stack">
        <Readouts
          items={[
            { label: 'Phase voltage', value: fx(s.vPh, 1), unit: 'V', note: 'V_ph, across each Z' },
            { label: 'Line voltage', value: fx(s.vL, 1), unit: 'V', note: `V_L / V_ph = ${fx(s.vL / s.vPh, 3)}` },
            { label: 'Phase current', value: fx(s.iPh, 2), unit: 'A', note: 'I_ph, in each Z' },
            { label: 'Line current', value: fx(s.iL, 2), unit: 'A', note: `I_L / I_ph = ${fx(s.iL / s.iPh, 3)}` },
            { label: 'Total power', value: fx(s.p / 1000, 2), unit: 'kW', note: pfText(load.phiDeg) },
            load.conn === 'star'
              ? { label: 'Line V ahead of phase V', value: fx(vAngle, 1), unit: '°', note: 'V_ab vs V_a' }
              : { label: 'Line I behind phase I', value: fx(-iAngle, 1), unit: '°', note: 'I_a vs I_ab' },
          ]}
        />
        <section className="ps-card" aria-labelledby="ps-3p-load">
          <h3 id="ps-3p-load">The load</h3>
          <Seg
            label="Connection"
            full
            value={load.conn}
            onChange={setConn}
            options={[
              { id: 'star', label: 'Star (Y)' },
              { id: 'delta', label: 'Delta (Δ)' },
            ]}
          />
          <LoadControls load={load} setLoad={setLoad} showConn={false} />
          <p className="small muted">
            {isDone(progress, MODULE, 'star-delta') ? '✓ You have built both connections.' : `Try both connections (${seen.length} of 2).`} The same three impedances in delta take{' '}
            {fx(powerSummary(solveLoad(V_LINE, load.zOhm, load.phiDeg, 'delta')).p / powerSummary(solveLoad(V_LINE, load.zOhm, load.phiDeg, 'star')).p, 2)} × the power they take in star.
          </p>
        </section>
      </div>
    </div>
  )
}

function PowerLab({ load, setLoad }: { load: LoadState; setLoad(l: LoadState): void }) {
  const [view, setView] = useState<'phases' | 'compare'>('phases')
  const l = solveLoad(V_LINE, load.zOhm, load.phiDeg, load.conn)
  const s = powerSummary(l)
  const pts = instantaneousPower(l, 360).map((p) => p.total)
  const ripple = Math.max(...pts) - Math.min(...pts)
  useTutorContext(
    () =>
      `Explore — Power lab. ${load.conn} load, ${fx(load.zOhm, 1)} Ω at ${fx(load.phiDeg, 1)}°. Per phase: P ${fx(s.p1, 1)} W, Q ${fx(s.q1, 1)} var, S ${fx(s.s1, 1)} VA. Total: P ${fx(s.p, 1)} W, Q ${fx(s.q, 1)} var, S ${fx(s.s, 1)} VA, pf ${fx(s.pf, 3)}. √3·V_L·I_L·cos φ = ${fx(s.pFromLine, 1)} W. Total instantaneous power ripple ${sg(ripple, 3)} W.`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <div className="ps-toolbar">
          <Seg
            label="Plot"
            value={view}
            onChange={(v) => setView(v)}
            options={[
              { id: 'phases', label: 'Each phase and the total' },
              { id: 'compare', label: 'Three-phase vs single-phase' },
            ]}
          />
        </div>
        <Plot series={powerSeries(l, view)} xLabel="ωt [°]" yLabel="p [kW]" label="Instantaneous power over one cycle" xDomain={[0, 360]} yDomain={powerDomain(s, view)} height={260} />
        <p className="small muted">
          {view === 'phases'
            ? `Each phase pulsates at ${2 * F} Hz between ${fx((s.p1 - s.s1) / 1000, 2)} and ${fx((s.p1 + s.s1) / 1000, 2)} kW; their sum varies by ${ripple < 1e-6 ? 'less than 10⁻⁶ W' : `${sg(ripple, 2)} W`} over the cycle — a constant ${fx(s.p / 1000, 3)} kW.`
            : `A single-phase circuit at the same voltage delivering the same average power swings between ${fx((s.p - s.s) / 1000, 2)} and ${fx((s.p + s.s) / 1000, 2)} kW, ${2 * F} times a second.${s.q > 0 || s.q < 0 ? ' Below zero, energy flows back to the source.' : ''}`}
        </p>
        <Eq
          expr="P = √3·V_L·I_L·cos φ    Q = √3·V_L·I_L·sin φ    S = √3·V_L·I_L"
          where={[
            ['Line', `√3·V_L·I_L·cos φ = √3 × ${fx(s.vL, 1)} × ${fx(s.iL, 3)} × ${fx(Math.cos((load.phiDeg * Math.PI) / 180), 3)} = ${fx(s.pFromLine, 1)} W`],
            ['Phase', `3·V_ph·I_ph·cos φ = 3 × ${fx(s.vPh, 1)} × ${fx(s.iPh, 3)} × ${fx(Math.cos((load.phiDeg * Math.PI) / 180), 3)} = ${fx(3 * s.p1, 1)} W`],
          ]}
          assume="balanced; V_L, I_L line quantities; φ the load-impedance angle (same in star or delta)"
        />
      </div>
      <div className="ps-stack">
        <div className="ps-card ps-3p-flush">
          <p className="eyebrow">Power triangle — whole load</p>
          <PowerTriangle p={s.p / 1000} q={s.q / 1000} unit="kVA" />
        </div>
        <Readouts
          items={[
            { label: 'P per phase', value: fx(s.p1 / 1000, 3), unit: 'kW' },
            { label: 'P total', value: fx(s.p / 1000, 3), unit: 'kW' },
            { label: 'Q total', value: fx(s.q / 1000, 3), unit: 'kvar' },
            { label: 'S total', value: fx(s.s / 1000, 3), unit: 'kVA' },
            { label: 'Power factor', value: fx(s.pf, 3), note: Math.abs(load.phiDeg) < 0.05 ? 'unity' : load.phiDeg > 0 ? 'lagging' : 'leading' },
            { label: 'Line current', value: fx(s.iL, 2), unit: 'A' },
          ]}
        />
        <section className="ps-card" aria-labelledby="ps-3p-pload">
          <h3 id="ps-3p-pload">The load</h3>
          <LoadControls load={load} setLoad={setLoad} />
        </section>
      </div>
    </div>
  )
}

/** A y-range that shows the whole swing with the total clear of the top edge. */
function powerDomain(s: ReturnType<typeof powerSummary>, view: 'phases' | 'compare'): [number, number] {
  const lo = Math.min(0, view === 'phases' ? (s.p1 - s.s1) / 1000 : (s.p - s.s) / 1000)
  const hi = Math.max(s.p / 1000, view === 'phases' ? (s.p1 + s.s1) / 1000 : (s.p + s.s) / 1000)
  const pad = (hi - lo) * 0.2 || 1
  return [lo - pad, hi + pad]
}

const niceStep = (x: number) => {
  const m = 10 ** Math.floor(Math.log10(x))
  return [1, 2, 5, 10].map((k) => k * m).find((s) => s >= x) ?? 10 * m
}

function LineLab({ line, setLine, seen, setSeen }: { line: LineState; setLine(l: LineState): void; seen: string[]; setSeen(s: string[]): void }) {
  const [plot, setPlot] = useState<'profile' | 'angle'>('profile')
  const progress = usePsProgress()
  const lc = useMemo(() => lineCalc(line), [line])
  const r = lc.sel
  const pStep = niceStep(lc.silMw / 60)
  const pMax = Math.ceil((2 * lc.silMw) / pStep) * pStep
  const stage = line.pMw <= 0.05 * lc.silMw ? 'nl' : Math.abs(line.pMw / lc.silMw - 1) <= 0.05 && line.pf >= 0.99 ? 'sil' : line.pMw >= 1.4 * lc.silMw ? 'heavy' : null
  useEffect(() => {
    if (stage && !seen.includes(stage)) {
      const next = [...seen, stage]
      setSeen(next)
      if (next.length >= 3) completeActivity(MODULE, 'line')
    }
  }, [stage, seen, setSeen])
  const setPreset = (id: string) => {
    const p = presetOf(id)
    const k = constantsOf(id)
    const s = sil(p.kv, Math.sqrt(k.xOhmPerKm / (k.bUsPerKm * 1e-6)))
    setLine({ ...line, preset: id, k, pMw: Math.round((0.8 * s) / niceStep(s / 60)) * niceStep(s / 60) })
  }
  const quick = (pMw: number, pf = 1) => setLine({ ...line, pMw, pf, lagging: true })
  const rise = 1 / abs(lc.perf.long.abcd.A)
  const exact = lc.perf.long
  const vsText = `V_s ${fx(r.vsLL, 1)} kV ∠ ${fx(r.deltaDeg, 1)}°`
  const vrText = `V_r ${fx(lc.kv, 0)} kV · ${fx(line.pMw, 0)} MW`
  useTutorContext(
    () =>
      `Explore — Transmission line lab. ${lc.kv} kV line, ${line.lengthKm} km, r = ${line.k.rOhmPerKm}, x = ${line.k.xOhmPerKm} Ω/km, b = ${line.k.bUsPerKm} µS/km; model ${MODEL_LABEL[line.model]}. Load ${fx(line.pMw, 1)} MW at pf ${fx(line.pf, 2)} ${line.lagging ? 'lagging' : 'leading'}, receiving end ${lc.kv} kV. Results: V_s ${fx(r.vsLL, 2)} kV at ${fx(r.deltaDeg, 2)}°, I_s ${fx(abs(r.is) * 1000, 1)} A, P_s ${fx(r.ps, 2)} MW, Q_s ${fx(r.qs, 2)} Mvar, regulation ${fx(r.regulationPct, 2)} %, efficiency ${fx(r.efficiencyPct, 2)} %. Zc ${fx(abs(lc.p.zc), 1)} Ω, SIL ${fx(lc.silMw, 1)} MW, βl ${fx(r2d(lc.bl), 2)}°, no-load rise ${fx((rise - 1) * 100, 2)} %.`,
  )
  const loadTone = line.pMw > lc.silMw * 1.02 ? 'above SIL' : line.pMw < lc.silMw * 0.98 ? 'below SIL' : 'at SIL'
  return (
    <div className="ps-stack">
      <div className="ps-card ps-3p-flush">
        <LineSketch model={line.model} Z={lc.p.Z} Y={lc.p.Y} lengthKm={line.lengthKm} gamma={lc.p.gamma} zc={lc.p.zc} vs={vsText} vr={vrText} />
      </div>
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <div className="ps-3p-five">
            <Readouts
              label={`Results, ${MODEL_LABEL[line.model]} model`}
              items={[
                { label: 'Sending voltage', value: fx(r.vsLL, 1), unit: 'kV', note: `δ = ${fx(r.deltaDeg, 2)}° ahead of V_r` },
                { label: 'Sending current', value: fx(abs(r.is) * 1000, 0), unit: 'A', note: `receiving ${fx(abs(r.ir) * 1000, 0)} A` },
                { label: 'Sending power', value: fx(r.ps, 1), unit: 'MW', note: `${fx(r.qs, 1)} Mvar` },
                {
                  label: 'Regulation',
                  value: fx(r.regulationPct, 2),
                  unit: '%',
                  note: `no-load V_r ${fx(r.vrNoLoadLL, 1)} kV`,
                  tone: Math.abs(r.regulationPct) > 10 ? 'warn' : undefined,
                },
                { label: 'Efficiency', value: line.pMw > 0 ? fx(r.efficiencyPct, 2) : '—', unit: line.pMw > 0 ? '%' : undefined, note: `losses ${fx(r.lossMw, 2)} MW` },
              ]}
            />
          </div>
          <div className="ps-toolbar">
            <Seg
              label="Plot"
              value={plot}
              onChange={(v) => setPlot(v)}
              options={[
                { id: 'profile', label: 'Voltage along the line' },
                { id: 'angle', label: 'Power–angle curve' },
              ]}
            />
            <span className="small muted">
              {plot === 'profile'
                ? `Exact distributed solution; receiving end held at ${lc.kv} kV; reference loads at unity pf`
                : `Both ends held at ${lc.kv} kV; X = x·l = ${fx(line.k.xOhmPerKm * line.lengthKm, 1)} Ω`}
            </span>
          </div>
          {plot === 'profile' ? <ProfilePlot lc={lc} lengthKm={line.lengthKm} you={line} /> : <PowerAnglePlot lc={lc} lengthKm={line.lengthKm} k={line.k} youMw={line.pMw} />}
          <div className="ps-3p-five">
            <Readouts
              label="Line characteristics"
              items={[
                { label: 'Surge impedance', value: fx(lc.p.zcLossless, 1), unit: 'Ω', note: `Z_c = √(x/b); with r ${ph(abs(lc.p.zc), angDeg(lc.p.zc), 1, 1)}` },
                { label: 'Surge impedance loading', value: fx(lc.silMw, 1), unit: 'MW', note: `V²/Z_c · your load is ${loadTone}` },
                { label: 'Electrical length', value: fx(r2d(lc.bl), 2), unit: '°', note: `β·l; wavelength ${fx((2 * Math.PI) / (lc.bl / line.lengthKm), 0)} km` },
                { label: 'No-load rise', value: fx(rise, 4), note: `V_r/V_s; lossless 1/cos βl = ${fx(1 / Math.cos(lc.bl), 4)}` },
                { label: 'Charging', value: fx(chargingMvar(lc.kv, line.k, line.lengthKm), 1), unit: 'Mvar', note: `V²·B at ${lc.kv} kV` },
              ]}
            />
          </div>
          <details className="ps-more ps-card">
            <summary>Compare the three models for this line</summary>
            <ModelTable lc={lc} />
          </details>
        </div>
        <div className="ps-stack">
          <section className="ps-card" aria-labelledby="ps-3p-line">
            <h3 id="ps-3p-line">The line</h3>
            <Seg label="Voltage level" full value={line.preset} onChange={setPreset} options={LINE_PRESETS.map((p) => ({ id: p.id, label: p.label }))} />
            <Slider label="Length" value={line.lengthKm} min={10} max={800} step={10} unit="km" decimals={0} onChange={(lengthKm) => setLine({ ...line, lengthKm })} />
            <Seg
              label="Model"
              full
              value={line.model}
              onChange={(model) => setLine({ ...line, model })}
              options={(['short', 'medium', 'long'] as const).map((m) => ({ id: m, label: m === 'short' ? 'Short' : m === 'medium' ? 'Nominal π' : 'Long (exact)' }))}
            />
            <p className="ps-hint">
              {line.model === 'short'
                ? 'Series impedance only — fine below about 80 km.'
                : line.model === 'medium'
                  ? 'Capacitance lumped half at each end — up to about 250 km.'
                  : 'Distributed R, L and C — exact at any length.'}
            </p>
            <details className="ps-more">
              <summary>Line constants per km (typical values, editable)</summary>
              <Slider label="Resistance r" value={line.k.rOhmPerKm} min={0} max={0.3} step={0.005} unit="Ω/km" decimals={3} onChange={(v) => setLine({ ...line, k: { ...line.k, rOhmPerKm: v } })} />
              <Slider label="Reactance x" value={line.k.xOhmPerKm} min={0.2} max={0.5} step={0.005} unit="Ω/km" decimals={3} onChange={(v) => setLine({ ...line, k: { ...line.k, xOhmPerKm: v } })} />
              <Slider label="Susceptance b" value={line.k.bUsPerKm} min={2} max={5} step={0.05} unit="µS/km" decimals={2} onChange={(v) => setLine({ ...line, k: { ...line.k, bUsPerKm: v } })} />
            </details>
          </section>
          <section className="ps-card" aria-labelledby="ps-3p-rload">
            <h3 id="ps-3p-rload">The load at the receiving end</h3>
            <Slider
              label="Power P_r"
              value={line.pMw}
              min={0}
              max={pMax}
              step={pStep}
              unit="MW"
              decimals={pStep < 1 ? 1 : 0}
              onChange={(pMw) => setLine({ ...line, pMw })}
              hint={`${fx(line.pMw / lc.silMw, 2)} × SIL`}
            />
            <Slider label="Power factor" value={line.pf} min={0.7} max={1} step={0.01} decimals={2} onChange={(pf) => setLine({ ...line, pf })} />
            <Seg
              label="Lagging or leading"
              full
              value={line.lagging ? 'lag' : 'lead'}
              onChange={(v) => setLine({ ...line, lagging: v === 'lag' })}
              options={[
                { id: 'lag', label: 'Lagging (inductive)' },
                { id: 'lead', label: 'Leading (capacitive)' },
              ]}
            />
            <div className="ps-3p-quick" role="group" aria-label="Set the load">
              <span className="small muted">Set:</span>
              <button type="button" className="text-btn" onClick={() => quick(0)}>
                No load
              </button>
              <button type="button" className="text-btn" onClick={() => quick(lc.silMw)}>
                SIL
              </button>
              <button type="button" className="text-btn" onClick={() => quick(Math.min(pMax, Math.round((1.5 * lc.silMw) / pStep) * pStep))}>
                1.5 × SIL
              </button>
            </div>
            <ul className="ps-3p-checks" aria-label="Activity: load the line">
              {[
                ['nl', 'No load — see the Ferranti rise'],
                ['sil', 'At SIL, unity pf — a flat profile'],
                ['heavy', 'Heavy, ≥ 1.4 × SIL — the profile sags'],
              ].map(([id, text]) => (
                <li key={id} className={seen.includes(id) ? 'is-done' : ''}>
                  <span aria-hidden="true">{seen.includes(id) ? '✓' : '○'}</span> {text}
                </li>
              ))}
            </ul>
            {isDone(progress, MODULE, 'line') && <p className="small muted">✓ Activity complete.</p>}
          </section>
          <Callout title="How much the model matters here">
            <p>
              Sending voltage needed — exact: <b>{fx(exact.vsLL, 2)} kV</b>; nominal π: {fx(lc.perf.medium.vsLL, 2)} kV ({fx(((lc.perf.medium.vsLL - exact.vsLL) / exact.vsLL) * 100, 2)} %); short:{' '}
              {fx(lc.perf.short.vsLL, 2)} kV ({fx(((lc.perf.short.vsLL - exact.vsLL) / exact.vsLL) * 100, 2)} %).
            </p>
          </Callout>
        </div>
      </div>
    </div>
  )
}

function ModelTable({ lc }: { lc: LineCalc }) {
  const rows: Array<{ label: string; unit: string; d: number; get(p: LinePerformance): number }> = [
    { label: 'Sending voltage', unit: 'kV', d: 2, get: (p) => p.vsLL },
    { label: 'Load angle δ', unit: '°', d: 2, get: (p) => p.deltaDeg },
    { label: 'Sending current', unit: 'A', d: 1, get: (p) => abs(p.is) * 1000 },
    { label: 'Sending reactive power', unit: 'Mvar', d: 1, get: (p) => p.qs },
    { label: 'Losses', unit: 'MW', d: 2, get: (p) => p.lossMw },
    { label: 'Regulation', unit: '%', d: 2, get: (p) => p.regulationPct },
  ]
  return (
    <div className="table-wrap">
      <table className="ps-table">
        <caption className="sr-only">The same line and load in the three models</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">Short</th>
            <th scope="col">Nominal π</th>
            <th scope="col">Exact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {(['short', 'medium', 'long'] as const).map((m) => (
                <td key={m}>
                  {fx(r.get(lc.perf[m]), r.d)} {r.unit}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">The short model ignores the charging current entirely, so it misses the Ferranti rise and understates the sending current at light load (where the charging current dominates).</p>
    </div>
  )
}

// ── Experiment ────────────────────────────────────────────────────────────────────────────────────────────────

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
      <nav className="ps-3p-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the calculation says. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-3p-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-3p-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
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
  const r = runExperiment(e)
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <>
      <div className="ps-stack ps-3p-exp">
        <div className="ps-card">
          <p className="eyebrow">Experiment</p>
          <h3>{e.title}</h3>
          <p>{e.change}</p>
        </div>
        <Predict
          question={e.question}
          options={e.options}
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
        <div className="ps-split ps-split--wide-side">
          <Plot
            series={r.chart.series}
            xLabel={r.chart.xLabel}
            yLabel={r.chart.yLabel}
            hlines={r.chart.hlines}
            vlines={r.chart.vlines}
            yDomain={r.chart.yDomain}
            height={250}
            label={`${e.title}: ${r.chart.series.map((x) => x.label).join(', ')}`}
          />
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Before and after: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.label} className={Math.abs(row.after - row.before) > 10 ** -row.decimals ? 'is-changed' : ''}>
                    <td>{row.label}</td>
                    <td>
                      {fx(row.before, row.decimals)} {row.unit}
                    </td>
                    <td>
                      {fx(row.after, row.decimals)} {row.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Verify ────────────────────────────────────────────────────────────────────────────────────────────────────

const c3 = (z: Complex, d = 2) => cx(z.re, z.im, d)
const p3 = (z: Complex, d = 2) => ph(abs(z), angDeg(z), d, 2)

function Verify({ load, line, edited }: { load: LoadState; line: LineState; edited: boolean }) {
  const progress = usePsProgress()
  const star = solveLoad(V_LINE, load.zOhm, load.phiDeg, 'star')
  const delta = solveLoad(V_LINE, load.zOhm, load.phiDeg, 'delta')
  const cur = load.conn === 'star' ? star : delta
  const s = powerSummary(cur)
  // 1 · star line voltage by components
  const va = star.vPh.a
  const vb = star.vPh.b
  const vab = sub(va, vb)
  // 2 · delta line current by components
  const z = polarDeg(load.zOhm, load.phiDeg)
  const iab = div(delta.vLine.a, z)
  const ica = div(delta.vLine.c, z)
  const ia = sub(iab, ica)
  // 3 · power three ways
  const pts = instantaneousPower(cur, 360)
  const pAvg = pts.slice(0, 360).reduce((n, p) => n + p.total, 0) / 360
  // 4–6 · the line
  const lc = lineCalc(line)
  const { p } = lc
  const L = line.lengthKm
  const gl = { re: p.gamma.re * L, im: p.gamma.im * L }
  const m = lc.perf.long.abcd
  const detV = sub(mul(m.A, m.D), mul(m.B, m.C))
  const perf = lc.perf.long
  const vr = perf.vr
  const ir = perf.ir
  const vs = perf.vs
  const sec = linePerformance(abcdSections(line.k, L, 50), lc.kv, { pMw: line.pMw, pf: line.pf, lagging: line.lagging })
  const kl = lossless(line.k)
  const al = lineAbcd(kl, L, 'long').A
  const bl = betaL(kl, L)
  const ok = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
  const quiz: QuizItem[] = [
    {
      id: 'il',
      kind: 'number',
      q: `Your turn: a balanced ${load.conn} load takes ${fx(s.p / 1000, 3)} kW at ${pfText(load.phiDeg)} from a ${V_LINE} V supply. What is the line current?`,
      answer: s.iL,
      unit: 'A',
      tol: Math.max(0.05, s.iL * 0.01),
      why: `I_L = P / (√3·V_L·cos φ) = ${fx(s.p, 1)} / (√3 × ${V_LINE} × ${fx(s.pf, 3)}) = ${fx(s.iL, 3)} A.`,
    },
    {
      id: 'sil',
      kind: 'number',
      q: `And for the line: x = ${line.k.xOhmPerKm} Ω/km, b = ${line.k.bUsPerKm} µS/km, ${lc.kv} kV. What is its surge impedance loading?`,
      answer: lc.silMw,
      unit: 'MW',
      tol: Math.max(0.5, lc.silMw * 0.01),
      why: `Z_c = √(x/b) = √(${line.k.xOhmPerKm} / ${line.k.bUsPerKm}×10⁻⁶) = ${fx(p.zcLossless, 1)} Ω; SIL = V²/Z_c = ${lc.kv}² / ${fx(p.zcLossless, 1)} = ${fx(lc.silMw, 1)} MW.`,
    },
  ]
  useTutorContext(
    () =>
      `Verify mode: hand checks — V_ab = V_a − V_b by components; I_a = I_ab − I_ca; P three ways; the exact line's γ, Z_c and ABCD with AD − BC = 1; sending-end voltage from A·V_r + B·I_r checked against 50 cascaded π sections; Ferranti 1/cos βl and SIL. Load: ${load.conn}, ${fx(load.zOhm, 1)} Ω at ${fx(load.phiDeg, 1)}°. Line: ${lc.kv} kV, ${L} km, ${fx(line.pMw, 1)} MW at pf ${fx(line.pf, 2)}.`,
  )
  return (
    <div className="ps-stack ps-3p-verify">
      <Callout title="Every number in this module comes from complex arithmetic in calc.ts">
        <p>
          Here you redo the key steps by hand and check them against independent results{edited ? ' — for the load and line as you set them in Explore' : ''}.{' '}
          {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <div className="ps-stack">
        <Calc
          title="1 · Star: V_ab = V_a − V_b, by components"
          steps={[
            { label: 'V_a', expr: `${fx(abs(va), 2)} ∠ 0°`, result: `${c3(va)} V` },
            { label: 'V_b', expr: `${fx(abs(vb), 2)} ∠ −120°`, result: `${c3(vb)} V` },
            { label: 'V_ab', expr: `(${fx(va.re, 2)} − ${fx(vb.re, 2)}) + j(${fx(va.im, 2)} − ${fx(vb.im, 2)})`, result: `${c3(vab)} V` },
            { label: 'Polar form', expr: `√(${fx(vab.re, 2)}² + ${fx(vab.im, 2)}²), atan(${fx(vab.im, 2)} / ${fx(vab.re, 2)})`, result: `${p3(vab)} V` },
          ]}
          check={{ ok: ok(abs(vab) / abs(va), SQRT3, 1e-9) && ok(angDeg(vab), 30, 1e-9), text: `|V_ab| / |V_a| = ${fx(abs(vab) / abs(va), 4)} = √3, and V_ab leads V_a by ${fx(angDeg(vab), 2)}°.` }}
        />
        <Calc
          title="2 · Delta: I_a = I_ab − I_ca"
          steps={[
            { label: 'I_ab = V_ab / Z', expr: `${p3(delta.vLine.a, 1)} / ${ph(load.zOhm, load.phiDeg, 1, 2)}`, result: `${p3(iab, 3)} A` },
            { label: 'I_ca = V_ca / Z', expr: `${p3(delta.vLine.c, 1)} / ${ph(load.zOhm, load.phiDeg, 1, 2)}`, result: `${p3(ica, 3)} A` },
            { label: 'I_a', expr: `(${c3(iab, 3)}) − (${c3(ica, 3)})`, result: `${c3(ia, 3)} A` },
            { label: 'Polar form', expr: '|I_a| ∠ θ', result: `${p3(ia, 3)} A` },
          ]}
          check={{
            ok: ok(abs(ia) / abs(iab), SQRT3, 1e-9) && ok(wrapDeg(angDeg(ia) - angDeg(iab)), -30, 1e-9),
            text: `|I_a| / |I_ab| = ${fx(abs(ia) / abs(iab), 4)} = √3, lagging I_ab by ${fx(-wrapDeg(angDeg(ia) - angDeg(iab)), 2)}°.`,
          }}
        />
      </div>
      <Calc
        title={`3 · Power of the ${load.conn} load, three independent ways`}
        steps={[
          { label: 'Per phase × 3', expr: `3 × ${fx(s.vPh, 3)} V × ${fx(s.iPh, 4)} A × cos ${fx(load.phiDeg, 2)}°`, result: `${fx(3 * s.vPh * s.iPh * Math.cos((load.phiDeg * Math.PI) / 180), 3)} W` },
          { label: 'Line quantities', expr: `√3 × ${fx(s.vL, 3)} V × ${fx(s.iL, 4)} A × ${fx(Math.cos((load.phiDeg * Math.PI) / 180), 4)}`, result: `${fx(s.pFromLine, 3)} W` },
          { label: 'Average of p_a + p_b + p_c', expr: 'mean of v·i summed over phases, 360 samples of a cycle', result: `${fx(pAvg, 3)} W` },
        ]}
        check={{
          ok: ok(s.pFromLine, pAvg, 1e-6 * Math.max(1, s.p)) && ok(3 * s.vPh * s.iPh * Math.cos((load.phiDeg * Math.PI) / 180), pAvg, 1e-6 * Math.max(1, s.p)),
          text: `All three agree; the sum of the three instantaneous powers is constant to within ${(() => {
            const r = Math.max(...pts.map((x) => x.total)) - Math.min(...pts.map((x) => x.total))
            return r < 1e-6 ? '10⁻⁶' : sg(r, 2)
          })()} W.`,
        }}
      />
      <div className="ps-stack">
        <Calc
          title={`4 · The exact ${L} km line: γ, Z_c and ABCD`}
          steps={[
            { label: 'z, y per km', expr: `${line.k.rOhmPerKm} + j${line.k.xOhmPerKm} Ω, j${line.k.bUsPerKm} µS`, result: `zy = ${cx(mul(p.z, p.y).re * 1e6, mul(p.z, p.y).im * 1e6, 4)} ×10⁻⁶` },
            { label: 'γ = √(zy)', expr: 'α + jβ per km', result: `${cx(p.gamma.re * 1000, p.gamma.im * 1000, 5)} ×10⁻³` },
            { label: 'Z_c = √(z/y)', expr: '', result: `${p3(p.zc, 2)} Ω` },
            { label: 'A = cosh γl', expr: `cosh(${cx(gl.re, gl.im, 4)})`, result: c3(m.A, 5) },
            { label: 'B = Z_c sinh γl', expr: '', result: `${c3(m.B, 3)} Ω` },
            { label: 'C = sinh γl / Z_c', expr: '', result: `${cx(m.C.re * 1e6, m.C.im * 1e6, 3)} µS` },
            { label: 'AD − BC', expr: 'A² − BC (A = D)', result: c3(detV, 9) },
          ]}
          check={{ ok: ok(detV.re, 1, 1e-9) && ok(detV.im, 0, 1e-9), text: 'AD − BC = 1: the line is a passive, reciprocal two-port.' }}
        />
        <Calc
          title="5 · Sending end from the receiving end"
          steps={[
            { label: 'V_r (per phase)', expr: `${lc.kv} / √3`, result: `${p3(vr, 3)} kV` },
            { label: 'I_r', expr: `conj(S_r/3 / V_r), S_r = ${fx(line.pMw, 1)} MW at pf ${fx(line.pf, 2)}`, result: `${p3(mul(ir, C(1000, 0)), 1)} A` },
            { label: 'V_s = A·V_r + B·I_r', expr: `(${c3(m.A, 4)})·${fx(abs(vr), 2)} + (${c3(m.B, 1)})·(${c3(ir, 4)})`, result: `${p3(vs, 3)} kV` },
            { label: '|V_s| line-to-line', expr: `√3 × ${fx(abs(vs), 3)}`, result: `${fx(perf.vsLL, 3)} kV` },
            { label: 'Regulation', expr: `(${fx(perf.vsLL, 2)} / ${fx(abs(m.A), 4)} − ${lc.kv}) / ${lc.kv}`, result: `${fx(perf.regulationPct, 3)} %` },
            { label: 'Efficiency', expr: `P_r / P_s = ${fx(perf.pr, 2)} / ${fx(perf.ps, 2)}`, result: line.pMw > 0 ? `${fx(perf.efficiencyPct, 3)} %` : '— (no load)' },
          ]}
          check={{
            ok: ok(sec.vsLL, perf.vsLL, perf.vsLL * 1e-4),
            text: `Independently, 50 nominal-π sections in cascade give ${fx(sec.vsLL, 3)} kV — within ${sg(Math.abs(sec.vsLL - perf.vsLL), 2)} kV of the exact solution.`,
          }}
        />
      </div>
      <Calc
        title="6 · Ferranti rise and SIL, on the same line without resistance"
        steps={[
          { label: 'β·l = √(x·b)·l', expr: `√(${line.k.xOhmPerKm} × ${line.k.bUsPerKm}×10⁻⁶) × ${L}`, result: `${fx(bl, 5)} rad = ${fx(r2d(bl), 3)}°` },
          { label: 'V_r / V_s at no load', expr: `1 / cos ${fx(r2d(bl), 3)}°`, result: fx(1 / Math.cos(bl), 5) },
          { label: 'From the ABCD constants', expr: '1 / |A| with r = 0', result: fx(1 / abs(al), 5) },
          { label: 'SIL', expr: `${lc.kv}² / √(${line.k.xOhmPerKm} / ${line.k.bUsPerKm}×10⁻⁶)`, result: `${fx(lc.silMw, 2)} MW` },
        ]}
        check={{
          ok: ok(1 / Math.cos(bl), 1 / abs(al), 1e-9) && Math.abs(arg(al)) < 1e-12,
          text: `A of the lossless line is real and equals cos βl. With r = ${line.k.rOhmPerKm} Ω/km the rise is ${fx(1 / abs(m.A), 5)} instead.`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

// ── Practise ──────────────────────────────────────────────────────────────────────────────────────────────────

function Practise() {
  const phi08 = deg(Math.acos(0.8))
  const dl = powerSummary(solveLoad(V_LINE, 20, phi08, 'delta'))
  const k = LINE_PRESETS.find((x) => x.id === '400')!
  const zc = lineParams(k, 1).zcLossless
  const silMw = sil(400, zc)
  const blRad = betaL(lossless(k), 300)
  const vrNl = 400 / Math.cos(blRad)
  // above SIL (lossless): does the line absorb or generate reactive power?
  const heavy = linePerformance(lineAbcd(lossless(k), 300, 'long'), 400, { pMw: 1.5 * silMw, pf: 1, lagging: true })
  const qLine = heavy.qs - heavy.qr
  const items: QuizItem[] = [
    {
      id: 'vl',
      kind: 'number',
      q: 'A star-connected supply has 230 V between each line and neutral. What is the voltage between two lines?',
      answer: 230 * SQRT3,
      unit: 'V',
      tol: 1,
      why: `V_L = √3 × 230 = ${fx(230 * SQRT3, 1)} V — the familiar “400 V” three-phase supply.`,
    },
    {
      id: 'lead30',
      kind: 'choice',
      q: 'In a star connection with sequence a-b-c, how is the line voltage V_ab placed relative to the phase voltage V_a?',
      options: [
        { id: 'lead', label: 'It leads V_a by 30°' },
        { id: 'lag', label: 'It lags V_a by 30°' },
        { id: 'same', label: 'It is in phase with V_a' },
      ],
      answer: wrapDeg(angDeg(solveLoad(400, 10, 0, 'star').vLine.a)) > 0 ? 'lead' : 'lag',
      why: 'V_ab = V_a − V_b = √3·V_a∠+30°: subtracting a phasor 120° behind turns the result 30° forward.',
    },
    {
      id: 'il-delta',
      kind: 'number',
      q: 'Each branch of a balanced delta load carries 10 A. What current flows in each line?',
      answer: 10 * SQRT3,
      unit: 'A',
      tol: 0.1,
      why: `I_L = √3 × I_ph = ${fx(10 * SQRT3, 2)} A (I_a = I_ab − I_ca, two branch currents 120° apart).`,
    },
    {
      id: 'p',
      kind: 'number',
      q: `A balanced load takes ${fx(dl.iL, 2)} A per line from a 400 V supply at power factor 0.8 lagging. How much active power does it take?`,
      answer: dl.p / 1000,
      unit: 'kW',
      tol: 0.1,
      why: `P = √3·V_L·I_L·cos φ = √3 × 400 × ${fx(dl.iL, 2)} × 0.8 = ${fx(dl.p / 1000, 2)} kW (whatever the connection).`,
    },
    {
      id: 'const',
      kind: 'choice',
      q: 'What does the total instantaneous power of a balanced three-phase load do over a cycle?',
      options: [
        { id: 'const', label: 'It stays constant, equal to P' },
        { id: '2f', label: 'It pulsates at twice the supply frequency, like single-phase power' },
        { id: 'f', label: 'It pulsates at the supply frequency' },
      ],
      answer: (() => {
        const t = instantaneousPower(solveLoad(400, 20, phi08, 'star'), 360).map((x) => x.total)
        return Math.max(...t) - Math.min(...t) < 1e-6 ? 'const' : '2f'
      })(),
      why: 'Each phase’s power pulsates at 2f, but the three pulsations are 120° apart (240° at 2f) and cancel exactly.',
    },
    {
      id: 'sil',
      kind: 'number',
      q: `A 400 kV line has x = ${k.xOhmPerKm} Ω/km and b = ${k.bUsPerKm} µS/km. What is its surge impedance loading?`,
      answer: silMw,
      unit: 'MW',
      tol: 3,
      why: `Z_c = √(x/b) = ${fx(zc, 1)} Ω; SIL = 400² / ${fx(zc, 1)} = ${fx(silMw, 0)} MW.`,
    },
    {
      id: 'ferranti',
      kind: 'number',
      q: `The same line, 300 km long and lossless, is energised at 400 kV with its far end open (β·l = ${fx(r2d(blRad), 2)}°). What voltage appears at the far end?`,
      answer: vrNl,
      unit: 'kV',
      tol: 0.5,
      why: `V_r = V_s / cos βl = 400 / cos ${fx(r2d(blRad), 2)}° = ${fx(vrNl, 1)} kV — the Ferranti effect.`,
    },
    {
      id: 'above',
      kind: 'choice',
      q: 'A line carries 1.5 times its surge impedance loading. As a whole, what does it do with reactive power?',
      options: [
        { id: 'abs', label: 'It absorbs reactive power — its inductance needs more than its capacitance makes' },
        { id: 'gen', label: 'It generates reactive power' },
        { id: 'none', label: 'Neither — reactive power balances at any load' },
      ],
      answer: qLine > 1 ? 'abs' : qLine < -1 ? 'gen' : 'none',
      why: `I²X grows with the square of the load while V²B stays fixed. At 1.5 × SIL this 300 km line absorbs ${fx(qLine, 0)} Mvar (Q_s − Q_r), which the sending end has to supply.`,
    },
  ]
  useTutorContext(() => 'Practise mode: questions on star/delta line and phase quantities, three-phase power, SIL and the Ferranti effect. Numbers come from the module’s calculations.')
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">Every answer is computed by the module’s own calculations. Answer all of them correctly to complete the activity.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
