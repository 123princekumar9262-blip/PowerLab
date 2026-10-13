import type { Mat } from '../expm.ts'
import { exactPwl, simulatePwl, type PwlEvent, type PwlResult, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * DEVICES — THYRISTOR (SCR): gate triggering, latching vs holding, and turn-off time tq under FORCED
 * (capacitor) commutation.
 *
 *   V ──┬── A │ SCR │ K ──┬── R ── L ──┐          gate driver: a current pulse iG (width tw)
 *       │                 │            │          Dfw: freewheeling diode across the load
 *       └─ TA ── C ───────┘   Dfw ─────┘── 0 V    TA + C: the commutation branch (C pre-charged to −V)
 *
 * SCR — a charge-control model with thresholds (two-transistor picture):
 *   q   charge stored in the SCR's base layers, lifetime τ:  dq/dt = iA + (IH/IGT)·iG − q/τ
 *   Qc  critical charge for regeneration (α1 + α2 = 1), Qc = τ·IH.
 *   OFF → ON     forward biased (vAK ≥ VT0 + rT·i) and q ≥ Qc with the gate on: the gate charge reaches Qc
 *                after td = τ·ln(IG/(IG − IGT)); a gate current below IGT never fires it.
 *   ON (gate-held) → LATCHED   once iA ≥ IL (the conducting area has spread); if the gate ends before
 *                that, the SCR turns off (latching failed) and the load current freewheels through Dfw.
 *   LATCHED      conducts without gate (vAK = VT0 + rT·iA) while q ≥ Qc; in steady state q = τ·iA, so it
 *                holds while iA > IH = Qc/τ (HOLDING), and drops out below.
 *   Reverse biased (current forced to zero): q decays as q0·e^(−t/τ). If forward voltage returns while
 *                q ≥ Qc the SCR fires again without a gate — failure to commutate. tq = τ·ln(q0/Qc).
 * Tests: 'latch' (gate pulse into an RL load), 'hold' (after latching the load resistance steps to R2 at
 * t2), 'commutate' (TA fires at tcom: C reverse-biases the SCR for tc ≈ C·V/IT, then forward voltage returns).
 *
 * State x = [iL, vC, q]; vC = the capacitor voltage seen as vAK while TA conducts. Each combination of SCR
 * state and commutation-branch state is linear: a PWL hybrid system, simulated (trapezoidal) and solved
 * exactly (matrix exponential) by converters/pwl.ts. Neglected: SCR reverse recovery, dv/dt and di/dt
 * limits, the gate–cathode voltage, leakage, temperature; Dfw and TA are ideal.
 */
export type ScrTest = 'latch' | 'hold' | 'commutate'

export interface ScrParams {
  test: ScrTest
  vs: number
  r: number
  l: number
  /** Gate current pulse amplitude [A] and width [s]. */
  ig: number
  tw: number
  igt: number
  il: number
  ih: number
  tau: number
  vt0: number
  rt: number
  /** Commutation capacitor [F] (pre-charged to −V) and firing instant of TA [s]. */
  c: number
  tcom: number
  /** Hold test: the load resistance steps to R2 at t2. */
  r2: number
  t2: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedScr extends ScrParams, RunParams {
  qc: number
  kg: number
  vc0: number
  tg0: number
  tend: number
  steps: number
}

export const SCR_DEFAULTS: ScrParams = {
  test: 'commutate',
  vs: 100,
  r: 10,
  l: 2e-3,
  ig: 0.1,
  tw: 20e-6,
  igt: 0.03,
  il: 0.3,
  ih: 0.05,
  tau: 10e-6,
  vt0: 1,
  rt: 0.02,
  c: 6e-6,
  tcom: 300e-6,
  r2: 2500,
  t2: 600e-6,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 8000,
}

export const SCR_LIMITS = {
  vs: { min: 10, max: 1000 },
  r: { min: 1, max: 1000 },
  l: { min: 10e-6, max: 0.5 },
  ig: { min: 1e-3, max: 2 },
  tw: { min: 1e-6, max: 1e-3 },
  igt: { min: 1e-3, max: 0.5 },
  il: { min: 5e-3, max: 2 },
  ih: { min: 1e-3, max: 1 },
  tau: { min: 1e-6, max: 100e-6 },
  vt0: { min: 0.5, max: 2 },
  rt: { min: 1e-3, max: 0.5 },
  c: { min: 0.1e-6, max: 100e-6 },
  tcom: { min: 20e-6, max: 5e-3 },
  r2: { min: 1, max: 1e5 },
  t2: { min: 20e-6, max: 5e-3 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

/** Turn-on delay of the model: the gate charge q = k·IG·τ·(1 − e^(−t/τ)) reaches Qc (from q = 0). */
export const gateDelay = (p: { ig: number; igt: number; tau: number }) => (p.ig > p.igt ? p.tau * Math.log(p.ig / (p.ig - p.igt)) : Infinity)

/** Time for an RL current from zero to reach I: i(t) = (V − VT0)/R'·(1 − e^(−t·R'/L)), R' = R + rT. */
export function rlTimeTo(p: { vs: number; vt0: number; r: number; rt: number; l: number }, i: number): number {
  const rr = p.r + p.rt
  const iMax = (p.vs - p.vt0) / rr
  return i < iMax ? -(p.l / rr) * Math.log(1 - i / iMax) : Infinity
}
export const rlCurrent = (p: { vs: number; vt0: number; r: number; rt: number; l: number }, t: number) => ((p.vs - p.vt0) / (p.r + p.rt)) * -Math.expm1((-t * (p.r + p.rt)) / p.l)

export function resolveScr(input: Partial<ScrParams>): { params: ResolvedScr; issues: string[] } {
  const p = { ...SCR_DEFAULTS, ...input }
  const issues: string[] = []
  const L = SCR_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, SCR_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    vs: c('vs'),
    r: c('r'),
    l: c('l'),
    ig: c('ig'),
    tw: c('tw'),
    igt: c('igt'),
    il: c('il'),
    ih: c('ih'),
    tau: c('tau'),
    vt0: c('vt0'),
    rt: c('rt'),
    c: c('c'),
    tcom: c('tcom'),
    r2: c('r2'),
    t2: c('t2'),
  }
  const test: ScrTest = p.test === 'latch' || p.test === 'hold' ? p.test : 'commutate'
  if (q.il < q.ih) issues.push('IL below IH: a real SCR always needs more current to latch than to hold')
  if (q.ig <= q.igt) issues.push('the gate current is below IGT: the SCR never fires')
  const tg0 = 0.5 * q.tau
  const td = gateDelay(q)
  const tdEst = Number.isFinite(td) ? td : 3 * q.tau
  let tend: number
  let tcom = q.tcom
  let t2 = q.t2
  if (test === 'latch') tend = tg0 + 3 * q.tw + 2 * tdEst
  else if (test === 'hold') {
    t2 = Math.max(t2, tg0 + q.tw + tdEst)
    tend = t2 + 12 * q.tau
  } else {
    tcom = Math.max(tcom, tg0 + tdEst + 2e-6)
    // window: the capacitor swings from −V to +V (≈ 2·C·V/IT), and the stored charge decays (≈ τ·ln(τ·IT/Qc))
    const iT = Math.max(rlCurrent(q, tcom - tg0 - tdEst), 1e-3)
    const tc = (q.c * q.vs) / iT
    const tq = q.tau * Math.log(Math.max(2, iT / q.ih))
    tend = tcom + Math.max(2.6 * tc, 1.6 * tq, 10e-6)
  }
  // the time steps of the window (Analyze → convergence varies them)
  const steps = Math.round(clamp(p.stepsPerPeriod, 500, 64000, 8000))
  const params: ResolvedScr = {
    ...p,
    ...q,
    test,
    tcom,
    t2,
    qc: q.tau * q.ih,
    kg: q.ih / q.igt,
    vc0: q.vs,
    tg0,
    tend,
    steps,
    view: 'steady',
    periods: 1,
    stepsPerPeriod: steps,
    period: tend,
    dt: tend / steps,
    duration: tend,
  }
  return { params, issues }
}

export const igAt = (p: ResolvedScr, t: number) => (t >= p.tg0 && t < p.tg0 + p.tw ? p.ig : 0)
export const rAt = (p: ResolvedScr, t: number) => (p.test === 'hold' && t >= p.t2 ? p.r2 : p.r)
const auxAt = (p: ResolvedScr, t: number) => p.test === 'commutate' && t >= p.tcom

/** SCR state: off (blocking), on (conducting, held by the gate), lat (latched), rec (reverse biased with charge left). */
export type ScrState = 'off' | 'on' | 'lat' | 'rec'
/** Commutation branch: 0 not fired, r (C reverse-biases the SCR), f (C forward-biases it), x done. */
export type AuxState = '0' | 'r' | 'f' | 'x'

export function scrSystem(p: ResolvedScr): PwlSystem {
  const bps = [p.tg0, p.tg0 + p.tw]
  if (p.test === 'hold') bps.push(p.t2)
  if (p.test === 'commutate') bps.push(p.tcom)
  return {
    n: 3,
    breakpoints: bps,
    mode(x, t, prev) {
      const [iL, vC, q] = x
      let [s, a] = (prev ? prev.split('|') : ['off', '0']) as [ScrState, AuxState]
      const gate = igAt(p, t) > 0
      const von = p.vt0 + p.rt * Math.max(iL, 0)
      // the commutation branch: fired at tcom; conducts until the load voltage reaches zero (Dfw takes over)
      if (a === '0' && auxAt(p, t)) a = vC < 0 ? 'r' : 'f'
      if (a === 'r' || a === 'f') a = vC >= p.vs ? 'x' : vC < 0 ? 'r' : 'f'
      const capOn = a === 'r' || a === 'f'
      if (s === 'on' || s === 'lat') {
        // the forward voltage the circuit can give the SCR is below its on-state voltage: the current leaves it
        const bypass = capOn ? vC < von : p.vs < von
        if (bypass) s = q >= p.qc ? 'rec' : 'off'
        else if (s === 'on') s = iL >= p.il ? 'lat' : gate ? 'on' : 'off'
        else if (!gate && q < p.qc) s = 'off'
      }
      if (s === 'rec' && q < p.qc) s = 'off'
      if (s === 'off' || s === 'rec') {
        const fwd = (capOn ? vC : p.vs) >= von
        if (fwd && q >= p.qc && (s === 'rec' || gate)) {
          s = s === 'rec' || iL >= p.il ? 'lat' : 'on'
          // the SCR takes the load current back from the capacitor: TA's current falls to zero
          if (capOn) a = 'x'
        }
      }
      return `${s}|${a}`
    },
    sys(mode, t) {
      const [s, a] = mode.split('|') as [ScrState, AuxState]
      const R = rAt(p, t)
      const ig = igAt(p, t)
      const cond = s === 'on' || s === 'lat'
      const capOn = a === 'r' || a === 'f'
      const qRow = [cond ? 1 : 0, 0, -1 / p.tau]
      const qb = p.kg * ig
      let A: Mat
      let b: number[]
      if (cond) {
        A = [[-(R + p.rt) / p.l, 0, 0], [0, 0, 0], qRow]
        b = [(p.vs - p.vt0) / p.l, 0, qb]
      } else if (capOn) {
        A = [[-R / p.l, -1 / p.l, 0], [1 / p.c, 0, 0], qRow]
        b = [p.vs / p.l, 0, qb]
      } else {
        A = [[-R / p.l, 0, 0], [0, 0, 0], qRow]
        b = [0, 0, qb]
      }
      return { A, b }
    },
  }
}

export const scrX0 = (p: ResolvedScr) => [0, -p.vc0, 0]

/** Terminal quantities at a state in a mode. */
export function scrDerived(p: ResolvedScr, x: number[], mode: string, t: number) {
  const [iL, vC, q] = x
  const [s, a] = mode.split('|') as [ScrState, AuxState]
  const cond = s === 'on' || s === 'lat'
  const capOn = a === 'r' || a === 'f'
  const ia = cond ? iL : 0
  const vak = cond ? p.vt0 + p.rt * iL : capOn ? vC : p.vs
  const ic = capOn ? iL : 0
  const ifw = !cond && !capOn ? iL : 0
  const vk = p.vs - vak
  return { s, a, cond, capOn, ia, vak, ic, ifw, vk, ig: igAt(p, t), qn: q / p.qc, pscr: vak * ia, iL, vC }
}

export type ScrRun = Run<ResolvedScr> & { pwlEvents: PwlEvent[]; modes: string[]; knots: PwlResult['knots'] }

/** SIMULATION: the test integrated by the PWL simulator. */
export function simulateScr(input: Partial<ScrParams>): ScrRun {
  const started = performance.now()
  const { params: p, issues } = resolveScr(input)
  const res = simulatePwl(scrSystem(p), scrX0(p), 0, p.tend, p.steps, 'off|0')
  const n = p.steps + 1
  const names = ['ig', 'ia', 'il', 'ifw', 'ic', 'vak', 'vk', 'vc', 'q', 'vs']
  const signals: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  for (let k = 0; k < n; k++) {
    // a sample holds the interval ending at it: the inputs are those just before t (an edge on a sample shows from the next)
    const d = scrDerived(p, [res.x[0][k], res.x[1][k], res.x[2][k]], res.modes[k], res.t[k] - 1e-9 * p.dt)
    signals.ig[k] = d.ig
    signals.ia[k] = d.ia
    signals.il[k] = d.iL
    signals.ifw[k] = d.ifw
    signals.ic[k] = d.ic
    signals.vak[k] = d.vak
    signals.vk[k] = d.vk
    signals.vc[k] = d.vC
    signals.q[k] = d.qn
    signals.vs[k] = p.vs
  }
  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.ceil(t / p.dt - 1e-9))
    events.push({ id: `s${seq++}`, kind, time: t, device, values: { ia: signals.ia[k], vak: signals.vak[k], il: signals.il[k], q: signals.q[k] } })
  }
  ev('gate-on', p.tg0, 'gate')
  ev('gate-off', p.tg0 + p.tw, 'gate')
  for (const x of res.events) ev('mode', x.t, `${x.from}→${x.to}`)
  if (p.test === 'hold') ev('mode', p.t2, 'r-step')
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'scr',
    params: p,
    length: n,
    time: res.t,
    signals,
    devices: [],
    events,
    steadyFrom: 0,
    pwlEvents: res.events,
    modes: res.modes,
    knots: res.knots,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

/** Event-based figures (the same definitions for SIMULATION and THEORY). */
export interface ScrTimes {
  /** Turn-on delay: gate start → the SCR conducts. */
  td: number | null
  /** Gate start → the anode current reaches IL (latched). */
  tLatch: number | null
  latched: boolean
  /** The gate ended before latching: the SCR turned off. */
  failedLatch: boolean
  /** tcom → forward voltage back (circuit turn-off time), tcom → the stored charge below Qc (device tq). */
  tc: number | null
  tqRun: number | null
  refired: boolean
  /** Hold test: t2 → drop-out. */
  tDrop: number | null
  dropped: boolean
}

const after = (evs: PwlEvent[], t: number, test: (from: string[], to: string[]) => boolean) => evs.find((e) => e.t >= t && test(e.from.split('|'), e.to.split('|')))?.t ?? null

export function scrTimes(p: ResolvedScr, evs: PwlEvent[]): ScrTimes {
  const isCond = (s: string) => s === 'on' || s === 'lat'
  const tOn = after(evs, p.tg0, (f, t) => !isCond(f[0]) && isCond(t[0]))
  const tL = after(evs, p.tg0, (f, t) => f[0] !== 'lat' && t[0] === 'lat')
  const failT = after(evs, p.tg0, (f, t) => f[0] === 'on' && t[0] === 'off')
  const com = p.test === 'commutate'
  const tFwd = com ? after(evs, p.tcom, (f, t) => f[1] === 'r' && t[1] !== 'r') : null
  const tRecov = com ? after(evs, p.tcom, (f, t) => f[0] === 'rec' && t[0] === 'off') : null
  const tRefire = com ? after(evs, p.tcom, (f, t) => f[0] === 'rec' && t[0] === 'lat') : null
  const tDrop = p.test === 'hold' ? after(evs, p.t2, (f, t) => f[0] === 'lat' && t[0] === 'off') : null
  return {
    td: tOn !== null ? tOn - p.tg0 : null,
    tLatch: tL !== null ? tL - p.tg0 : null,
    latched: tL !== null,
    failedLatch: failT !== null,
    tc: tFwd !== null ? tFwd - p.tcom : null,
    tqRun: tRecov !== null ? tRecov - p.tcom : null,
    refired: tRefire !== null,
    tDrop: tDrop !== null ? tDrop - p.t2 : null,
    dropped: tDrop !== null,
  }
}

export interface ScrMeasurements extends ScrTimes {
  /** Anode current when the gate pulse ends. */
  iaGateEnd: number
  /** On-state current and voltage just before commutation, and the stored charge then (q0 and q0/Qc). */
  iT: number
  vT: number
  q0: number
  /** tq from the simulated q0: the charge decays as q0·e^(−t/τ) while blocked, so tq = τ·ln(q0/Qc). */
  tq: number | null
  /** tc − tq: positive = the SCR recovers in time. */
  margin: number | null
  commutated: boolean
  /** Peak load voltage (V + vC during commutation) and peak anode current. */
  vkPeak: number
  iaPeak: number
  /** Hold test: the current the load settles towards after the step, and the current at the drop-out. */
  i2: number
  iDrop: number | null
  /** Current at the end of the run. */
  iEnd: number
  /** q0/Qc, and yes/no results as 1/0 (for the tables). */
  q0n: number
  latchFlag: number
  /** Only in the test where they apply (null elsewhere). */
  refireFlag: number | null
  dropFlag: number | null
}

/**
 * The state AT an input breakpoint, before the input changes there: the simulator's knot (the first one at
 * that time holds the old mode), or the sample when the breakpoint falls exactly on one.
 */
function stateAtBreak(r: ScrRun, t: number): { x: number[]; mode: string } {
  const kn = r.knots.find((k) => Math.abs(k.t - t) <= 1e-9 * r.params.dt)
  if (kn) return kn
  const k = Math.min(r.length - 1, Math.max(0, Math.round(t / r.params.dt)))
  return { x: [r.signals.il[k], r.signals.vc[k], r.signals.q[k] * r.params.qc], mode: r.modes[k] }
}
const conducting = (mode: string) => mode.startsWith('on') || mode.startsWith('lat')

export function measureScr(r: ScrRun): ScrMeasurements {
  const p = r.params
  const s = r.signals
  const st = scrTimes(p, r.pwlEvents)
  const ge = stateAtBreak(r, p.tg0 + p.tw)
  const iaGateEnd = conducting(ge.mode) ? ge.x[0] : 0
  // the state AT tcom, before TA fires
  const kc = stateAtBreak(r, p.test === 'commutate' ? p.tcom : p.tend)
  const wasOn = p.test === 'commutate' && conducting(kc.mode)
  const iT = wasOn ? kc.x[0] : 0
  const q0 = kc.x[2]
  const tq = wasOn && q0 > p.qc ? p.tau * Math.log(q0 / p.qc) : null
  let vkPeak = 0
  let iaPeak = 0
  for (let k = 0; k < r.length; k++) {
    vkPeak = Math.max(vkPeak, s.vk[k])
    iaPeak = Math.max(iaPeak, s.ia[k])
  }
  const tDropAbs = st.tDrop !== null ? p.t2 + st.tDrop : null
  const kd = tDropAbs !== null ? (r.knots.find((k) => k.t === tDropAbs) ?? null) : null
  return {
    ...st,
    iaGateEnd,
    iT,
    vT: p.vt0 + p.rt * iT,
    q0,
    tq,
    margin: st.tc !== null && tq !== null ? st.tc - tq : null,
    commutated: p.test === 'commutate' && !st.refired && st.tc !== null,
    vkPeak,
    iaPeak,
    i2: (p.vs - p.vt0) / (p.r2 + p.rt),
    iDrop: kd ? kd.x[0] : null,
    iEnd: s.il[r.length - 1],
    q0n: q0 / p.qc,
    latchFlag: st.latched ? 1 : 0,
    refireFlag: p.test === 'commutate' ? (st.refired ? 1 : 0) : null,
    dropFlag: p.test === 'hold' ? (st.dropped ? 1 : 0) : null,
  }
}

/** THEORY 1: the exact PWL solution (matrix exponential): the same event definitions on the exact flow. */
export function exactScr(p: ResolvedScr): ScrTimes & { q0: number | null; iT: number | null; tq: number | null; iaGateEnd: number | null; iDrop: number | null } {
  const sys = scrSystem(p)
  const x0 = scrX0(p)
  const ex = exactPwl(sys, x0, 0, [p.tend], 'off|0')
  const times = scrTimes(p, ex.events)
  // the state just before an input breakpoint (the input there has not changed yet)
  const before = (t: number) => {
    const s = exactPwl(sys, x0, 0, [t * (1 - 1e-13)], 'off|0')
    return { x: s.x[0], mode: s.modes[0] }
  }
  const cond = (mode: string) => mode.startsWith('on') || mode.startsWith('lat')
  const ge = before(p.tg0 + p.tw)
  let q0: number | null = null
  let iT: number | null = null
  let tq: number | null = null
  if (p.test === 'commutate') {
    const c = before(p.tcom)
    q0 = c.x[2]
    if (cond(c.mode)) {
      iT = c.x[0]
      tq = q0 > p.qc ? p.tau * Math.log(q0 / p.qc) : null
    }
  }
  let iDrop: number | null = null
  if (times.tDrop !== null) iDrop = exactPwl(sys, x0, 0, [p.t2 + times.tDrop], 'off|0').x[0][0]
  return { ...times, q0, iT, tq, iaGateEnd: cond(ge.mode) ? ge.x[0] : null, iDrop }
}

/** THEORY 2: textbook relations (closed forms with their simplifications). */
export function textbookScr(p: ResolvedScr, iT?: number) {
  const td = gateDelay(p)
  const tRise = rlTimeTo(p, p.il)
  const it = iT ?? rlCurrent(p, p.tcom - p.tg0 - td)
  return {
    td,
    /** Latching: the RL current from the turn-on instant reaches IL. */
    tLatch: td + tRise,
    /** The shortest gate pulse that still latches. */
    twMin: td + tRise,
    /** iA at the end of the gate pulse (RL current from the turn-on instant). */
    iaGateEnd: p.tw > td ? rlCurrent(p, p.tw - td) : 0,
    /** Circuit turn-off time with the load current constant during commutation. */
    tc: (p.c * p.vc0) / it,
    /** tq with a settled charge q0 = τ·IT. */
    tq: p.tau * Math.log(it / p.ih),
    i2: (p.vs - p.vt0) / (p.r2 + p.rt),
    /**
     * Hold test: the current falls from I1 to I2 at once (L/R2 ≪ τ) and the charge, settled at τ·I1, decays
     * towards τ·I2; it reaches Qc = τ·IH after τ·ln((I1 − I2)/(IH − I2)) (only if I2 < IH).
     */
    tDrop: (() => {
      const i1 = rlCurrent(p, p.t2 - p.tg0 - td)
      const i2 = (p.vs - p.vt0) / (p.r2 + p.rt)
      return i2 < p.ih && i1 > p.ih ? p.tau * Math.log((i1 - i2) / (p.ih - i2)) : null
    })(),
  }
}
