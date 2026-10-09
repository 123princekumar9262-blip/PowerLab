import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import { simulateCircuit } from '../engine.ts'
import type { Run, RunEvent } from '../types.ts'
import { CONTROL_DEFAULTS, controlModel, idealDuty, rAt, vrefAt, type ControlParams, type ControlTrace, type PlantKind, type ResolvedControl } from './control.ts'
import { averagedAt, averagedRun, loopGain, spectralRadius, stepMetrics, type AveragedRun, type LoopGain, type StepMetrics } from './theory.ts'

export type ControlRun = Run<ResolvedControl> & { trace: ControlTrace; model: AveragedRun; loop: LoopGain; rho: number }

/** Simulate the closed loop, then attach the controller trace and the THEORY (averaged model, loop gain). */
export function simulateControl(kind: PlantKind, input: Partial<ControlParams>): ControlRun {
  const tr: { current: ControlTrace | null } = { current: null }
  const r = simulateCircuit(controlModel(CONTROL_DEFAULTS[kind], tr), input)
  const p = r.params
  const model = averagedRun(p)
  // THEORY overlay on the scope: the averaged model's output (labelled as such in the channel list).
  const vm = new Float64Array(r.length)
  for (let k = 0; k < r.length; k++) vm[k] = averagedAt(model, p.ts, r.time[k])
  r.signals.vmodel = vm
  return Object.assign(r, { trace: tr.current!, model, loop: loopGain(p), rho: spectralRadius(p) })
}

export interface ControlMeasurements extends StepMetrics {
  /** Per-period averages of vout and their times (SIMULATION). */
  t: number[]
  avg: number[]
  /** Fraction of periods with the duty clamped. */
  satFraction: number
  /** Discontinuous conduction occurred (the averaged model assumes CCM). */
  dcm: boolean
  ilMax: number
  /** Largest per-period change of the output after the load step (for the WHY). */
  stable: boolean
}

export function measureControl(r: ControlRun): ControlMeasurements {
  const p = r.params
  const N = p.stepsPerPeriod
  const avg: number[] = []
  const t: number[] = []
  for (let m = 0; m < p.periods; m++) {
    let s = 0
    for (let k = m * N + 1; k <= (m + 1) * N && k < r.length; k++) s += 0.5 * (r.signals.vout[k - 1] + r.signals.vout[k])
    avg.push(s / N)
    t.push(m * p.ts)
  }
  const sm = stepMetrics(p, t, avg, r.trace.sampled, r.trace.d)
  let ilMax = 0
  for (const x of r.signals.il) ilMax = Math.max(ilMax, x)
  const sat = r.trace.sat.filter((x) => x !== null).length / Math.max(1, r.trace.sat.length)
  const tail = avg.slice(-Math.max(5, Math.floor(avg.length * 0.1)))
  const spread = Math.max(...tail) - Math.min(...tail)
  return { ...sm, t, avg, satFraction: sat, dcm: r.events.some((e) => e.kind === 'il-zero'), ilMax, stable: spread < 0.02 * vrefAt(p, p.duration) && sat < 0.5 }
}

/** SIMULATION (switching circuit) vs THEORY (averaged model + the same controller). */
export function compareControl(r: ControlRun, m: ControlMeasurements): CompareResult {
  const p = r.params
  const th = stepMetrics(p, r.model.t, r.model.vavg, r.model.v, r.model.d)
  const unstable = !(r.rho < 1) && p.loop === 'closed'
  const fast = p.loop === 'closed' && (r.loop.fc ?? 0) > p.fs / 20
  const expected = unstable
    ? `loop unstable (|λ|max = ${r.rho.toFixed(3)} ≥ 1): saturation and DCM make the circuit and the averaged model diverge differently`
    : m.dcm
      ? 'the circuit entered DCM; the averaged model assumes CCM'
      : fast
        ? `fc > fs/20: the averaged model ignores the ripple the sampler sees — a known limit of averaging`
        : undefined
  const rows: CompareRow[] = []
  const lg = r.loop
  const zeta = lg.pm !== null ? Math.min(0.99, Math.max(0.01, lg.pm / 100)) : null
  const add = (key: string, label: string, unit: string, sim: number | null, ex: number | null, err: (a: number, b: number) => number, tol: number, textbook: TextbookValue | null = null, absolute = false) => {
    if (sim === null || ex === null) return
    const error = err(sim, ex)
    const tbErr = textbook && textbook.value !== null && !textbook.notApplicable ? (Math.abs(textbook.value) > 1e-12 ? (sim - textbook.value) / Math.abs(textbook.value) : sim - textbook.value) : null
    rows.push({ key, label, unit, sim, exact: ex, error, tolerance: tol, pass: error <= tol || !!expected, absolute, textbook, textbookError: tbErr, expected })
  }
  const timeErr = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 6 * p.ts)
  add('overshoot', 'Overshoot after the reference step', '%', m.overshoot, th.overshoot, (a, b) => Math.abs(a - b), 0.03, zeta && p.loop === 'closed' ? { key: 'os', value: Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), formula: 'Mp ≈ e^(−πζ/√(1−ζ²)), ζ ≈ PM/100', assumptions: ['second-order-like closed loop', 'PM < 70°'], notApplicable: lg.pm !== null && lg.pm > 70 ? 'PM > 70°: the loop behaves like a first-order system (no overshoot expected)' : undefined } : null, true)
  add('rise', 'Rise time 10–90 %', 's', m.rise, th.rise, timeErr, 0.3, lg.fc && p.loop === 'closed' ? { key: 'rise', value: 2.2 / (2 * Math.PI * lg.fc), formula: 'tr ≈ 2.2/(2π·fc)  (first-order loop)', assumptions: ['PM ≳ 70°'] } : null)
  add('settling', 'Settling time (2 %)', 's', m.settling, th.settling, timeErr, 0.3, lg.fc && p.loop === 'closed' ? { key: 'ts', value: 4 / (2 * Math.PI * lg.fc), formula: 'ts ≈ 4/(2π·fc)  (first-order loop)', assumptions: ['PM ≳ 70°'] } : null)
  add('loadDev', 'Output deviation at the load step', 'V', m.loadDev, th.loadDev, (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 0.01 * p.vref), 0.15)
  add('recovery', 'Recovery time (within 1 %)', 's', m.recovery, th.recovery, timeErr, 0.3)
  add('ssError', 'Steady-state error (controller samples)', 'V', m.ssError, th.ssError, (a, b) => Math.abs(a - b) / Math.max(vrefAt(p, p.duration), 1e-9), 0.005, p.ki > 0 && p.loop === 'closed' ? { key: 'ss', value: 0, formula: 'e∞ = 0 with integral action', assumptions: ['stable loop', 'no saturation at the end'] } : null)
  add('dFinal', 'Final duty ratio', '%', m.dFinal, th.dFinal, (a, b) => Math.abs(a - b), 0.01, { key: 'd', value: idealDuty(p.kind, p.vin, vrefAt(p, p.duration)), formula: p.kind === 'buck' ? 'D = Vo/Vin (ideal)' : 'D = 1 − Vin/Vo (ideal)', assumptions: ['lossless converter', 'CCM'] }, true)
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: the switching converter with the digital controller. THEORY: the averaged converter model advanced exactly over each period with the same controller (and, under Textbook, classical loop relations). Loop gain: crossover ${lg.fc ? formatSI(lg.fc, 'Hz') : '—'}, phase margin ${lg.pm !== null ? `${lg.pm.toFixed(1)}°` : '—'}, sampled-loop |λ|max = ${Number.isFinite(r.rho) ? r.rho.toFixed(4) : '—'}.`,
    note: m.dcm ? 'The circuit entered discontinuous conduction during the run; the averaged model (CCM) does not describe that part.' : undefined,
  }
}

export interface ControlState {
  k: number
  t: number
  m: number
  vout: number
  vref: number
  sampled: number
  e: number
  d: number
  pTerm: number
  iTerm: number
  dTerm: number
  sat: 'high' | 'low' | null
  il: number
  io: number
  rload: number
  gate: boolean
  vmodel: number
}

export function controlStateAt(r: ControlRun, k: number): ControlState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const t = r.time[i]
  const m = Math.min(p.periods - 1, Math.max(0, Math.floor((t - 1e-9 * p.dt) / p.ts)))
  const tr = r.trace
  return {
    k: i,
    t,
    m,
    vout: r.signals.vout[i],
    vref: vrefAt(p, t),
    sampled: tr.sampled[m] ?? r.signals.vout[i],
    e: tr.e[m] ?? 0,
    d: tr.d[m] ?? p.d0,
    pTerm: tr.pTerm[m] ?? 0,
    iTerm: tr.iTerm[m] ?? p.d0,
    dTerm: tr.dTerm[m] ?? 0,
    sat: tr.sat[m] ?? null,
    il: r.signals.il[i],
    io: r.signals.io[i],
    rload: rAt(p, t),
    gate: r.signals.gate[i] > 0.5,
    vmodel: r.signals.vmodel[i],
  }
}

export function controlView(st: ControlState, r: ControlRun): StateView {
  const p = r.params
  const loopTxt = p.loop === 'open' ? 'Open loop (duty = feed-forward)' : st.sat ? `Duty saturated (${st.sat === 'high' ? 'Dmax' : 'Dmin'})` : 'Closed loop regulating'
  return {
    badge: { text: loopTxt, tone: st.sat ? 'idle' : p.loop === 'open' ? 'off' : 'on' },
    rows: [
      { k: 't', v: `${formatTime(st.t)} · period ${st.m + 1}`, full: true },
      { k: 'Vref', v: formatV(st.vref, false) },
      { k: 'Vout', v: formatV(st.vout) },
      { k: 'sampled Vout', v: formatV(st.sampled), min: 'standard' },
      { k: 'error e', v: formatV(st.e) },
      { k: 'duty d', v: `${(st.d * 100).toFixed(2)} %`, full: true },
      { k: 'P term', v: `${(st.pTerm * 100).toFixed(2)} %`, min: 'standard' },
      { k: 'I term', v: `${(st.iTerm * 100).toFixed(2)} %`, min: 'standard' },
      { k: 'D term', v: `${(st.dTerm * 100).toFixed(2)} %`, min: 'standard' },
      { k: 'iL', v: formatA(st.il) },
      { k: 'load', v: `${formatSI(st.rload, 'Ω')} · ${formatA(st.io)}` },
      { k: 'averaged model', v: formatV(st.vmodel), min: 'engineer' },
    ],
    path: `Vref − Vout → PID → duty ${(st.d * 100).toFixed(1)} % → PWM → ${p.kind} → Vout (measured once per period)`,
  }
}

export function controlWhy(r: ControlRun, st: ControlState, m: ControlMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const lg = r.loop
  cards.push({
    id: 'duty',
    question: `Why is the duty ${(st.d * 100).toFixed(1)} % in this period?`,
    what: `At the start of this period the controller measured Vout = ${formatV(st.sampled)} against Vref = ${formatV(st.vref, false)}: error e = ${formatV(st.e)}.`,
    why:
      p.loop === 'open'
        ? `Open loop: the duty is the ideal value for the reference, ${p.kind === 'buck' ? 'D = Vref/Vin' : 'D = 1 − Vin/Vref'}, whatever the output does.`
        : `The PID adds three contributions: P = Kp·e = ${(st.pTerm * 100).toFixed(2)} %, I (accumulated past errors) = ${(st.iTerm * 100).toFixed(2)} %, D = Kd·Δe/Ts = ${(st.dTerm * 100).toFixed(2)} %.${st.sat ? ` The sum is outside the allowed range, so the duty is clamped at ${st.sat === 'high' ? 'Dmax' : 'Dmin'}.` : ''}`,
    equation: p.loop === 'open' ? `d = ${(st.d * 100).toFixed(2)} %` : `d = Kp·e + I + Kd·(e[k] − e[k−1])/Ts = ${(st.d * 100).toFixed(2)} %`,
    physics: 'The controller cannot see inside the period: it samples once, decides one duty, and the converter executes it. Everything faster than the switching period is invisible to it.',
    whatIf: `With a larger Ki the integral term would build up faster: faster correction, but less phase margin (now ${lg.pm !== null ? `${lg.pm.toFixed(0)}°` : '—'}).`,
  })
  if (p.loadStep === 'on' && st.t >= p.tload && st.t < p.tload + Math.max(5 * p.ts, (m.recovery ?? 0) + 2 * p.ts)) {
    const di = vrefAt(p, st.t) / p.r2 - vrefAt(p, st.t) / p.r
    cards.push({
      id: 'dip',
      question: `Why did Vout ${di > 0 ? 'dip' : 'jump'} at the load step?`,
      what: `At t = ${formatTime(p.tload)} the load changed from ${formatSI(p.r, 'Ω')} to ${formatSI(p.r2, 'Ω')}: the load current changed by ${formatA(di, true)}. SIMULATION: largest deviation ${m.loadDev !== null ? formatV(m.loadDev) : '—'}.`,
      why: `The inductor current cannot change instantly. Until the loop raises iL, the capacitor supplies the difference, so its voltage ${di > 0 ? 'falls' : 'rises'}: dv/dt ≈ −Δi/C = ${formatSI(-di / p.c / 1000, 'V/ms')}.`,
      equation: 'C·dv/dt = iL − iload',
      physics: `The loop notices the change at the next sample and raises the duty; how fast it recovers depends on the crossover frequency (${lg.fc ? formatSI(lg.fc, 'Hz') : '—'}). Recovery (SIMULATION): ${m.recovery !== null ? formatTime(m.recovery) : 'not within the run'}.`,
      whatIf: 'A larger output capacitor makes the dip smaller (more stored charge); a faster loop makes it shorter.',
    })
  }
  cards.push(
    p.ki > 0 && p.loop === 'closed'
      ? {
          id: 'integral',
          question: 'Why is there no steady-state error?',
          what: `At the end of the run the sampled output is ${formatV(vrefAt(p, p.duration) - m.ssError, false)} for Vref ${formatV(vrefAt(p, p.duration), false)}: error ${formatV(m.ssError)}.${m.avg.length ? ` The average over the last period is ${formatV(m.avg[m.avg.length - 1], false)}.` : ''}`,
          why: 'The integral term keeps changing as long as any error remains. It only stops when e = 0 — and then it holds exactly the duty the converter needs, including its losses. The controller sees the output only once per period, at the start: it is that sample that equals Vref; the period average differs by part of the ripple.',
          equation: 'I[k+1] = I[k] + Ki·Ts·e[k]  ⇒  steady state only if e = 0',
          physics: `The final duty (SIMULATION ${(m.dFinal * 100).toFixed(2)} %) differs slightly from the ideal ${(idealDuty(p.kind, p.vin, vrefAt(p, p.duration)) * 100).toFixed(2)} %: the integrator found it by itself.`,
          whatIf: 'With Ki = 0 (P-only) an error must remain to keep the duty away from its starting value.',
        }
      : {
          id: 'integral',
          question: 'Why does an error remain?',
          what: `Final error ${formatV(m.ssError)} (SIMULATION).`,
          why: p.loop === 'open' ? 'Open loop: nothing measures the output. Any load change or loss shifts Vout and nothing corrects it.' : 'Proportional action needs an error to produce a duty change: the larger the correction needed, the larger the remaining error.',
          equation: p.loop === 'open' ? 'd = feed-forward' : 'u = Kp·e + I (I fixed when Ki = 0)',
          physics: 'Integral action is what removes the steady-state error.',
          whatIf: 'Switch to closed loop with Ki > 0: the error goes to zero.',
        },
  )
  if (p.loop === 'closed')
    cards.push({
      id: 'margin',
      question: (m.overshoot ?? 0) > 0.05 ? 'Why does Vout overshoot and ring?' : 'Why does Vout settle without ringing?',
      what: `Loop gain crossover ${lg.fc ? formatSI(lg.fc, 'Hz') : '—'}, phase margin ${lg.pm !== null ? `${lg.pm.toFixed(1)}°` : '—'}; overshoot (SIMULATION) ${m.overshoot !== null ? `${(m.overshoot * 100).toFixed(1)} %` : '—'}.`,
      why: 'Around the crossover frequency the correction arrives with a phase lag. With a large phase margin it arrives in time and the output settles smoothly; with a small one it arrives late and the output overshoots and rings.',
      equation: 'T(jωc) = 1;  PM = 180° + ∠T(jωc);  ζ ≈ PM/100',
      physics: `The output filter has a resonance at ${formatSI(lg.f0, 'Hz')}. The auto-tuned PID places its two zeros on it to cancel it${p.kind === 'boost' && lg.fRhp ? `; the boost also has a right-half-plane zero at ${formatSI(lg.fRhp, 'Hz')} that limits how fast the loop can be` : ''}.`,
      whatIf: `The exact stability measure of this sampled loop is |λ|max = ${Number.isFinite(r.rho) ? r.rho.toFixed(4) : '—'}: below 1 the loop is stable; pushing fc up raises it towards 1.`,
    })
  if (p.kind === 'boost')
    cards.push({
      id: 'rhp',
      question: 'Why can\'t the boost loop be made fast?',
      what: `Right-half-plane zero at ${lg.fRhp ? formatSI(lg.fRhp, 'Hz') : '—'}; the crossover here is ${lg.fc ? formatSI(lg.fc, 'Hz') : '—'}.`,
      why: 'Raising the duty keeps Q1 ON longer: the inductor charges more, but for that period the output is cut off for longer, so Vout first DROPS before it rises. A fast controller would react to that dip by raising the duty even more.',
      equation: 'ωz = R·(1 − D)²/L',
      physics: 'This "wrong-way" initial response is a non-minimum-phase zero; the crossover must stay well below it (and practical designs use current-mode control).',
      whatIf: 'Try a much higher target crossover: the sampled loop becomes unstable (|λ|max > 1).',
    })
  return cards
}

export function controlEventLabel(e: RunEvent): string {
  if (e.device === 'LINE') return 'Input-voltage step'
  if (e.device === 'SL') return e.kind === 'gate-on' ? 'Load step: extra load switched in' : 'Load step: load switched out'
  switch (e.kind) {
    case 'gate-on':
      return 'Q1 ON (period start)'
    case 'gate-off':
      return 'Q1 OFF (duty reached)'
    case 'diode-on':
      return 'D1 ON'
    case 'diode-off':
      return 'D1 OFF'
    case 'il-zero':
      return 'iL reaches zero (DCM)'
    default:
      return e.kind
  }
}
export function controlEventWhy(e: RunEvent): string {
  if (e.device === 'LINE') return 'The input voltage changes in one step. In open loop the output follows it; the closed loop measures the change and corrects the duty.'
  if (e.device === 'SL') return 'The load changes in one step: the inductor current cannot follow at once, so the capacitor takes the difference.'
  if (e.kind === 'gate-on') return 'A new switching period: the controller has just sampled Vout and set this period\'s duty.'
  if (e.kind === 'gate-off') return 'The duty set by the controller has elapsed.'
  return ''
}

const sampleWindow = (p: ResolvedControl, a: number, b: number) => [a * p.duration, b * p.duration] as [number, number]

export function controlLessons(kind: PlantKind): Array<Lesson<ControlParams, ControlRun, ControlMeasurements, ControlState>> {
  const ls: Array<Lesson<ControlParams, ControlRun, ControlMeasurements, ControlState>> = [
    {
      id: 'why-loop',
      title: 'Why a converter needs a feedback loop',
      summary: 'Open loop vs closed loop under a load step; what each PID term does.',
      check: {
        question: 'Why does the closed loop end with zero error after the load step, when a P-only loop would not?',
        options: ['the integral term keeps changing until the error is zero', 'the duty is fixed', 'the capacitor removes the error'],
        answer: 0,
        explain: 'The integral term accumulates the error, so it only stops changing when e = 0, and it then holds the new duty. A P-only loop needs a permanent error to produce that duty change.',
      },
      base: {},
      steps: [
        {
          title: 'Open loop: the output drifts with the load',
          params: { loop: 'open', refStep: 'off' },
          at: (r) => r.params.tload + 10 * r.params.ts,
          window: (r) => sampleWindow(r.params, 0, 1),
          channels: ['vout', 'vref', 'duty', 'io'],
          look: 'At the load step Vout rings and settles at a different value.',
          body: (_st, m, r) => `The duty is fixed at the ideal value. When the load changes at ${formatTime(r.params.tload)}, the output filter rings and Vout settles ${m.ssError > 0 ? 'below' : 'above'} the reference (final error ${formatV(m.ssError)}): every loss, every load change shows up at the output.`,
        },
        {
          title: 'Closed loop: the controller pulls it back',
          params: { loop: 'closed', refStep: 'off' },
          at: (r) => r.params.tload + 10 * r.params.ts,
          window: (r) => sampleWindow(r.params, 0, 1),
          channels: ['vout', 'vref', 'duty', 'io'],
          look: 'The duty changes after the load step and Vout returns to Vref.',
          body: (_st, m) => `The controller samples Vout every period, sees the error, and changes the duty. The output dips by ${m.loadDev !== null ? formatV(m.loadDev) : '—'} and recovers in ${m.recovery !== null ? formatTime(m.recovery) : '—'}; the final error is ${formatV(m.ssError)}.`,
        },
        {
          title: 'The integral term removes the last error',
          params: { loop: 'closed', refStep: 'off' },
          at: (r) => r.params.duration * 0.95,
          window: (r) => sampleWindow(r.params, 0, 1),
          channels: ['vout', 'vref', 'duty', 'err'],
          look: 'The error trace ends at zero.',
          body: (st) => `At the end the error is ${formatV(st.e)} and the I term holds the duty at ${(st.iTerm * 100).toFixed(2)} %. A P-only loop would need a permanent error to keep the duty there.`,
        },
      ],
    },
    {
      id: 'step',
      title: 'Reference step and the phase margin',
      summary: 'How fast and how smooth the output follows a new reference.',
      check: {
        question: 'Pushing the loop’s crossover frequency too high mainly…',
        options: ['reduces the phase margin: overshoot and ringing', 'removes every overshoot', 'changes the final output voltage'],
        answer: 0,
        explain: 'At higher frequency the sampling delay (and, in the boost, the right-half-plane zero) takes more phase, so the margin shrinks and the step response rings. The final value is still set by the integrator.',
      },
      base: { loadStep: 'off' },
      steps: [
        {
          title: 'A well-damped step response',
          at: (r) => r.params.tref + 3 * r.params.ts,
          window: (r) => [Math.max(0, r.params.tref - 0.3e-3), r.params.duration],
          channels: ['vout', 'vref', 'vmodel', 'duty'],
          look: 'Vout follows the new reference without ringing; the dashed THEORY curve is the averaged model.',
          body: (_st, m, r) => `Crossover ${r.loop.fc ? formatSI(r.loop.fc, 'Hz') : '—'}, phase margin ${r.loop.pm?.toFixed(0) ?? '—'}°. SIMULATION: rise ${m.rise !== null ? formatTime(m.rise) : '—'}, overshoot ${m.overshoot !== null ? `${(m.overshoot * 100).toFixed(1)} %` : '—'}, settling ${m.settling !== null ? formatTime(m.settling) : '—'}. The averaged model (THEORY) predicts the same.`,
        },
        {
          title: 'Too much gain: overshoot and ringing',
          params: { tuning: 'auto', fcTarget: kind === 'buck' ? 4000 : 400 },
          at: (r) => r.params.tref + 3 * r.params.ts,
          window: (r) => [Math.max(0, r.params.tref - 0.3e-3), r.params.duration],
          channels: ['vout', 'vref', 'vmodel', 'duty'],
          look: 'A faster loop — less phase margin — overshoots.',
          body: (_st, m, r) => `Now fc = ${r.loop.fc ? formatSI(r.loop.fc, 'Hz') : '—'}, phase margin ${r.loop.pm?.toFixed(0) ?? '—'}°, |λ|max = ${r.rho.toFixed(3)}. Overshoot ${m.overshoot !== null ? `${(m.overshoot * 100).toFixed(1)} %` : '—'}: a faster loop has less phase to spare — the sampling delay${kind === 'boost' ? ' and the right-half-plane zero eat' : ' eats'} phase at high frequency. The Bode margins are linearised at the starting point; after the reference step the operating point moves, so the exact test is |λ|max (< 1: stable).`,
        },
      ],
    },
  ]
  return ls
}

export function controlExperiments(kind: PlantKind): Array<Experiment<ControlParams, ControlMeasurements>> {
  return [
    {
      id: 'open',
      title: 'Open the loop',
      change: () => ({ loop: 'open' }),
      question: () => 'The controller is replaced by a fixed (ideal) duty. What happens after the load step?',
      choices: ['Vout stays off target', 'Vout returns to Vref as before', 'Vout becomes unstable'],
      judge: (b, a) => (Math.abs(a.ssError) > 3 * Math.abs(b.ssError) + 0.01 ? 0 : 1),
      rows: ['ssError', 'loadDev', 'recovery'],
      why: (b, a) => `Final error ${formatV(b.ssError)} → ${formatV(a.ssError)}. Without feedback nothing corrects the losses and the load change; the output only rings at the filter resonance and settles wherever the circuit takes it.`,
    },
    {
      id: 'ponly',
      title: 'Remove integral action (P only)',
      change: () => ({ tuning: 'manual', ki: 0 }),
      question: () => 'Ki = 0. What happens to the steady-state error after the steps?',
      choices: ['An error remains', 'The error still goes to zero', 'The loop oscillates'],
      judge: (_b, a) => (Math.abs(a.ssError) > 0.01 ? 0 : 1),
      rows: ['ssError', 'dFinal', 'overshoot'],
      why: (_b, a) => `Final error ${formatV(a.ssError)}. A P controller produces a duty change only from an error: to hold a new duty it needs a permanent error. The integral term is what removes it.`,
    },
    {
      id: 'faster',
      title: 'Double the target crossover',
      change: (p) => ({ tuning: 'auto', fcTarget: p.fcTarget * 2 }),
      question: (p) => `Target crossover ${formatSI(p.fcTarget, 'Hz')} → ${formatSI(p.fcTarget * 2, 'Hz')}. What happens to the load-step dip?`,
      choices: ['Smaller and shorter', 'Larger', 'Unchanged'],
      judge: (b, a) => {
        const smaller = a.loadDev !== null && b.loadDev !== null && Math.abs(a.loadDev) < Math.abs(b.loadDev) * 0.97
        const larger = a.loadDev !== null && b.loadDev !== null && Math.abs(a.loadDev) > Math.abs(b.loadDev) * 1.03
        return smaller ? 0 : larger ? 1 : 2
      },
      rows: ['loadDev', 'recovery', 'settling', 'overshoot'],
      why: (b, a) =>
        kind === 'buck' || Math.abs(a.loadDev ?? 0) < Math.abs(b.loadDev ?? 0)
          ? `Dip ${b.loadDev !== null ? formatV(b.loadDev) : '—'} → ${a.loadDev !== null ? formatV(a.loadDev) : '—'}, recovery ${b.recovery !== null ? formatTime(b.recovery) : '—'} → ${a.recovery !== null ? formatTime(a.recovery) : '—'}. A faster loop restores the inductor current sooner, so the capacitor has to supply the difference for less time. The limit is the phase margin${kind === 'boost' ? ' and the right-half-plane zero: push further and the boost loop loses stability' : ''}.`
          : `Dip ${b.loadDev !== null ? formatV(b.loadDev) : '—'} → ${a.loadDev !== null ? formatV(a.loadDev) : '—'}. To deliver more current the boost must raise its duty — which first keeps the output cut off for LONGER each period. A faster loop raises the duty harder and sooner, deepening the initial dip: the right-half-plane zero at work. This is why boost voltage loops are kept slow (or current-mode control is used).`,
    },
    {
      id: 'unstable',
      title: kind === 'buck' ? 'Push the crossover to fs/3' : 'Push the crossover towards the RHP zero',
      change: (p) => ({ tuning: 'auto', fcTarget: kind === 'buck' ? p.fs / 3 : 2500 }),
      question: () => 'Make the loop very fast. Does it stay stable?',
      choices: ['No — it oscillates or saturates', 'Yes, and it settles faster'],
      judge: (_b, a) => (!a.stable ? 0 : 1),
      rows: ['overshoot', 'settling', 'satFraction'],
      why: (_b, a) => `Duty saturated ${(a.satFraction * 100).toFixed(0)} % of the periods. The sampling and PWM delay add phase lag that grows with frequency (${kind === 'boost' ? 'and the RHP zero adds more' : 'half a period ≈ ωTs/2'}): near fs the correction arrives after the error has already reversed, and the loop amplifies instead of damping.`,
    },
  ]
}

export function controlPredictions(kind: PlantKind, seed: number): Array<PredictTask<ControlParams, ControlMeasurements>> {
  const vin = kind === 'buck' ? [12, 24, 48][seed % 3] : [6, 12, 24][seed % 3]
  const vo = kind === 'buck' ? Math.round(vin * [0.3, 0.5, 0.7][(seed + 1) % 3]) : Math.round(vin * [1.5, 2, 2.5][(seed + 1) % 3])
  return [
    {
      id: 'duty',
      prompt: `${kind}, Vin = ${vin} V, Vref = ${vo} V (no steps). Predict the duty the closed loop settles at.`,
      params: { vin, vref: vo, refStep: 'off', loadStep: 'off' },
      kind: 'number',
      unit: '',
      answer: (m) => m.dFinal,
      tolerance: 0.03,
      hint: 'Volt-second balance on the inductor; enter it as a fraction (0.5 = 50 %).',
      theory: (p) => `${kind === 'buck' ? 'D = Vref/Vin' : 'D = 1 − Vin/Vref'} = ${idealDuty(kind, p.vin, p.vref).toFixed(3)} (ideal; the loop also covers the small losses)`,
    },
    {
      id: 'ponly',
      prompt: 'P-only control (Ki = 0) with the default steps: will the output reach Vref exactly?',
      params: { tuning: 'manual', ki: 0 },
      kind: 'choice',
      choices: ['Yes', 'No — an error remains'],
      answer: (m) => (Math.abs(m.ssError) > 0.01 ? 1 : 0),
      hint: 'What produces the duty change when e = 0?',
      theory: () => 'Steady-state error of a type-0 loop: e∞ = Δ/(1 + Kp·G0) ≠ 0',
    },
  ]
}

export { CONTROL_DEFAULTS }
