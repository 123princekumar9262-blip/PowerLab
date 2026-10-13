import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * DRIVES — a three-phase squirrel-cage INDUCTION MOTOR fed by a sinusoidal three-phase voltage source:
 * the mains (direct-on-line start) or a V/f drive (constant volts per hertz with a low-speed boost, ramped).
 *
 *   va, vb, vc ── stator (Rs, Lls) ── air gap (Lm) ── rotor cage (Rr, Llr, short-circuited) ── shaft J, B ── load TL
 *
 * DYNAMIC MODEL (the simulation): the standard two-axis model in the STATIONARY (αβ) frame, amplitude-invariant
 * Clarke transform, rotor quantities referred to the stator. State x = [ψsα, ψsβ, ψrα, ψrβ, ωm, θm] (+ the energy
 * integrals). With Ls = Lls + Lm, Lr = Llr + Lm and D = Ls·Lr − Lm²:
 *   is = (Lr·ψs − Lm·ψr)/D,   ir = (Ls·ψr − Lm·ψs)/D
 *   dψs/dt = vs − Rs·is
 *   dψr/dt = −Rr·ir + ωr·J·ψr          (J·ψ = (−ψβ, ψα): the rotating cage, ωr = p·ωm)
 *   Te = (3/2)·p·(ψsα·isβ − ψsβ·isα)
 *   J·dωm/dt = Te − B·ωm − TL·sign(ωm)  (a PASSIVE load: it opposes the motion and holds a rotor at rest)
 * The supply is an ideal sinusoidal voltage source: inverter switching is NOT modelled (a V/f drive is
 * represented by its fundamental). Iron loss, saturation, skin effect in the bars and the slot harmonics are
 * not modelled. Integrator: classical 4th-order Runge–Kutta with a fixed step much smaller than every
 * electrical time constant.
 */
export type ImSupply = 'dol' | 'vf'
export type ImEvent = 'none' | 'load' | 'freq'

export interface InductionParams {
  /** 'dol': the mains at rated voltage and frequency from t = 0. 'vf': a V/f drive ramping the frequency. */
  supply: ImSupply
  /** V/f set frequency [Hz]. */
  f: number
  /** Load torque [N·m] (constant, passive). */
  tl: number
  event: ImEvent
  /** Load torque after a load step [N·m] / set frequency after a frequency step [Hz]. */
  tl2: number
  f2: number
  /** Rated line-to-line voltage, RMS [V], and rated frequency [Hz]. */
  vll: number
  fr: number
  /** Low-speed boost: the voltage at 0 Hz as a fraction of the rated phase voltage. */
  boost: number
  /** Acceleration ramp of the V/f drive: the time from 0 Hz to the rated frequency [s]. */
  tramp: number
  rs: number
  rr: number
  lls: number
  llr: number
  lm: number
  /** Pole pairs p (poles P = 2p). */
  pp: number
  j: number
  /** Viscous friction [N·m·s/rad]. */
  b: number
  /** RK4 steps per period of the highest supply frequency (0 = automatic, 200). */
  stepsPerPeriod: number
}

export interface ResolvedInduction extends InductionParams, RunParams {
  /** Rated phase voltage (RMS) Vr = VLL/√3 and the boost voltage [V]. */
  vr: number
  vb: number
  ls: number
  lr: number
  /** D = Ls·Lr − Lm². */
  dd: number
  /** Integration step [s] and stored samples per integration step. */
  h: number
  decim: number
  /** Highest supply frequency of the run [Hz]. */
  fmax: number
  /** Frequency ramp rate of the V/f drive [Hz/s]. */
  rate: number
}

export const INDUCTION_DEFAULTS: InductionParams = {
  supply: 'dol',
  f: 50,
  tl: 15,
  event: 'none',
  tl2: 30,
  f2: 25,
  vll: 400,
  fr: 50,
  boost: 0.03,
  tramp: 1,
  // a 4 kW, 400 V, 50 Hz, 4-pole machine (≈ 1430 rpm, rated torque ≈ 27 N·m)
  rs: 1.405,
  rr: 1.395,
  lls: 5.839e-3,
  llr: 5.839e-3,
  lm: 0.1722,
  pp: 2,
  j: 0.05,
  b: 0.002,
  stepsPerPeriod: 0,
}

export const INDUCTION_LIMITS = {
  f: { min: 2, max: 100 },
  tl: { min: 0, max: 150 },
  tl2: { min: 0, max: 150 },
  f2: { min: 2, max: 100 },
  vll: { min: 100, max: 690 },
  fr: { min: 25, max: 100 },
  boost: { min: 0, max: 0.2 },
  tramp: { min: 0.1, max: 5 },
  rs: { min: 0.02, max: 10 },
  rr: { min: 0.02, max: 10 },
  lls: { min: 1e-3, max: 0.05 },
  llr: { min: 1e-3, max: 0.05 },
  lm: { min: 0.02, max: 2 },
  pp: { min: 1, max: 4 },
  j: { min: 0.002, max: 2 },
  b: { min: 0, max: 0.05 },
  stepsPerPeriod: { min: 0, max: 4000 },
}

const SQ2 = Math.SQRT2
const SQ3_2 = Math.sqrt(3) / 2
/** Stored samples per period of the highest supply frequency. */
const SAMPLES_PER_PERIOD = 50
/** The settling check compares means over windows of this length [s]. */
const WINDOW = 0.02
/** Consecutive windows that must agree before a plateau counts as settled. */
const SETTLE_WINDOWS = 3
/** Longest settling time allowed per phase of the run [s], and the integration step budget. */
const MAX_SETTLE = 8
const MAX_STEPS = 600_000

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

/** The V/f law: the phase voltage (RMS) the drive applies at frequency f — boost at 0 Hz, rated voltage at the rated frequency, constant above. */
export function vfVoltage(p: Pick<ResolvedInduction, 'vr' | 'vb' | 'fr'>, f: number): number {
  return Math.min(p.vr, p.vb + ((p.vr - p.vb) * Math.max(0, f)) / p.fr)
}

/** Supply phase voltage (RMS) at frequency f for this run's supply: the mains is always at rated voltage. */
export const supplyVoltage = (p: ResolvedInduction, f: number) => (p.supply === 'dol' ? p.vr : vfVoltage(p, f))

export const rpm = (w: number) => (w * 60) / (2 * Math.PI)
/** Synchronous speed [rpm] = 120·f/P = 60·f/p. */
export const syncRpm = (f: number, pp: number) => (60 * f) / pp

export function resolveInduction(input: Partial<InductionParams>): { params: ResolvedInduction; issues: string[] } {
  const p = { ...INDUCTION_DEFAULTS, ...input }
  const issues: string[] = []
  const L = INDUCTION_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, INDUCTION_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    f: c('f'),
    tl: c('tl'),
    tl2: c('tl2'),
    f2: c('f2'),
    vll: c('vll'),
    fr: c('fr'),
    boost: c('boost'),
    tramp: c('tramp'),
    rs: c('rs'),
    rr: c('rr'),
    lls: c('lls'),
    llr: c('llr'),
    lm: c('lm'),
    pp: Math.round(c('pp')),
    j: c('j'),
    b: c('b'),
    stepsPerPeriod: Math.round(c('stepsPerPeriod')),
  }
  const supply: ImSupply = p.supply === 'vf' ? 'vf' : 'dol'
  // a frequency step needs a drive: on the mains it is a load step or nothing
  const event: ImEvent = p.event === 'load' ? 'load' : p.event === 'freq' && supply === 'vf' ? 'freq' : 'none'
  const ls = q.lls + q.lm
  const lr = q.llr + q.lm
  const dd = ls * lr - q.lm * q.lm
  const vr = q.vll / Math.sqrt(3)
  const fmax = supply === 'dol' ? q.fr : Math.max(q.f, event === 'freq' ? q.f2 : 0)
  const period = 1 / fmax
  // step: the requested steps per period, and never more than 1/(fastest electrical rate + fastest rotation)
  const spp = q.stepsPerPeriod > 0 ? q.stepsPerPeriod : 200
  const stiff = (q.rs * lr + q.rr * ls) / dd + 2 * Math.PI * 1.2 * fmax
  const h0 = Math.min(period / spp, 1 / stiff)
  // stored samples: SAMPLES_PER_PERIOD per period, a whole number of steps apart (the step shrinks to fit)
  const decim = Math.max(1, Math.ceil(period / SAMPLES_PER_PERIOD / h0 - 1e-9))
  const dt = period / SAMPLES_PER_PERIOD
  const h = dt / decim
  const params: ResolvedInduction = {
    ...p,
    ...q,
    supply,
    event,
    vr,
    vb: q.boost * vr,
    ls,
    lr,
    dd,
    h,
    decim,
    fmax,
    rate: q.fr / q.tramp,
    period,
    dt,
    stepsPerPeriod: Math.round(period / h),
    periods: 0,
    duration: 0,
    view: 'startup',
  }
  return { params, issues }
}

/** A piece of the supply-frequency schedule: f(t) = f0 + rate·(t − t0) until f reaches fEnd, then fEnd. */
interface FreqSegment {
  t0: number
  f0: number
  fEnd: number
  rate: number
  /** Supply angle at t0 [rad]. */
  th0: number
}

/** Frequency [Hz] and supply angle θ = 2π·∫f dt at time t ≥ seg.t0 (exact for a linear ramp). */
function segmentAt(s: FreqSegment, t: number): { f: number; th: number } {
  const tau = t - s.t0
  if (s.rate === 0) return { f: s.f0, th: s.th0 + 2 * Math.PI * s.f0 * tau }
  const tr = (s.fEnd - s.f0) / s.rate
  if (tau <= tr) return { f: s.f0 + s.rate * tau, th: s.th0 + 2 * Math.PI * (s.f0 * tau + 0.5 * s.rate * tau * tau) }
  return { f: s.fEnd, th: s.th0 + 2 * Math.PI * (s.f0 * tr + 0.5 * s.rate * tr * tr + s.fEnd * (tau - tr)) }
}

/** Steady values over one window or cycle of the run. */
export interface ImPlateau {
  /** Window [s]. */
  t0: number
  t1: number
  f: number
  /** Phase voltage (RMS) [V]. */
  v: number
  wm: number
  n: number
  nsync: number
  /** Slip s = 1 − p·ωm/ωs. */
  slip: number
  te: number
  /** Stator and rotor (referred) phase current, RMS [A]. */
  is: number
  ir: number
  pin: number
  pf: number
  pcuS: number
  pcuR: number
  pfr: number
  pout: number
  /** Air-gap power Te·ωs/p [W]. */
  pag: number
  eff: number | null
  /** Stator flux linkage amplitude |ψs| [Wb]. */
  psi: number
  stuck: boolean
}

export interface ImEnergies {
  ein: number
  ecuS: number
  ecuR: number
  efr: number
  eload: number
  ekin: number
  emag: number
}

export type InductionRun = Run<ResolvedInduction> & {
  /** Time of the load or frequency step (null without a step). */
  tstep: number | null
  /** Sample index where the step happens (the first sample after it), or null. */
  kStep: number | null
  /** When each phase was found settled (null: it never settled). */
  tSettledA: number | null
  tSettled: number | null
  /** Settled plateaus: before the step (null without a step) and at the end of the run. */
  pre: ImPlateau | null
  end: ImPlateau
  /** Start-up (phase before any step): peak phase current, torque extremes (from every integration step). */
  start: { iPeak: number; tPeak: number; teMax: number; teMin: number; tStart: number | null; e: ImEnergies; ekinAt: number }
  /** Whole run: energies and the conservation residual (relative). */
  energy: ImEnergies & { balance: number }
  /** Peak phase current over the whole run. */
  iPeakRun: number
  /** Did the rotor stay at rest at the very start / end the run at rest after having turned? */
  neverStarted: boolean
  stalled: boolean
  steps: number
}

/** Mean of a stored signal over samples [k0, k1] (trapezoidal). */
function meanOf(a: ArrayLike<number>, k0: number, k1: number): number {
  if (k1 <= k0) return a[k1]
  let s = 0
  for (let k = k0; k < k1; k++) s += 0.5 * (a[k] + a[k + 1])
  return s / (k1 - k0)
}

const cache = new Map<string, InductionRun>()

/**
 * SIMULATION (memoised: lesson texts and the analysis reuse the same runs). Every call returns a new run object
 * (sharing the read-only arrays): the workspace treats a new object as a new run and re-places its cursor.
 */
export function simulateInduction(input: Partial<InductionParams>): InductionRun {
  const key = JSON.stringify({ ...INDUCTION_DEFAULTS, ...input, view: undefined, periods: undefined })
  let r = cache.get(key)
  if (!r) {
    r = simulateOnce(input)
    cache.set(key, r)
    if (cache.size > 24) cache.delete(cache.keys().next().value!)
  }
  return { ...r }
}

function simulateOnce(input: Partial<InductionParams>): InductionRun {
  const started = performance.now()
  const { params: p, issues } = resolveInduction(input)
  const { rs, rr, lm, ls, lr, dd, pp, j: J, b: B, h, decim, dt } = p
  const kSS = lr / dd
  const kSR = lm / dd
  const kRR = ls / dd

  // ── supply schedule ──
  const segs: FreqSegment[] = [p.supply === 'dol' ? { t0: 0, f0: p.fr, fEnd: p.fr, rate: 0, th0: 0 } : { t0: 0, f0: 0, fEnd: p.f, rate: p.rate, th0: 0 }]
  let seg = segs[0]
  const volt = (f: number) => supplyVoltage(p, f)
  let tlNow = p.tl

  // ── state ──
  // 0 ψsα 1 ψsβ 2 ψrα 3 ψrβ 4 ωm 5 θm 6 Ein 7 Ecu,s 8 Ecu,r 9 Efr 10 Eload
  const N = 11
  const x = new Float64Array(N)
  const k1 = new Float64Array(N)
  const k2 = new Float64Array(N)
  const k3 = new Float64Array(N)
  const k4 = new Float64Array(N)
  const xt = new Float64Array(N)
  // passive load: the rotor is held at rest while |Te| ≤ TL; `dir` is the direction of motion (load sign)
  let stuck = true
  let dir = 1

  function deriv(t: number, y: Float64Array, out: Float64Array) {
    const s = segmentAt(seg, t)
    const vm = SQ2 * volt(s.f)
    const va = vm * Math.cos(s.th)
    const vb = vm * Math.sin(s.th)
    const isa = kSS * y[0] - kSR * y[2]
    const isb = kSS * y[1] - kSR * y[3]
    const ira = kRR * y[2] - kSR * y[0]
    const irb = kRR * y[3] - kSR * y[1]
    const wm = stuck ? 0 : y[4]
    const wr = pp * wm
    out[0] = va - rs * isa
    out[1] = vb - rs * isb
    out[2] = -rr * ira - wr * y[3]
    out[3] = -rr * irb + wr * y[2]
    const te = 1.5 * pp * (y[0] * isb - y[1] * isa)
    out[4] = stuck ? 0 : (te - B * wm - tlNow * dir) / J
    out[5] = wm
    out[6] = 1.5 * (va * isa + vb * isb)
    out[7] = 1.5 * rs * (isa * isa + isb * isb)
    out[8] = 1.5 * rr * (ira * ira + irb * irb)
    out[9] = B * wm * wm
    out[10] = stuck ? 0 : tlNow * dir * wm
  }
  const torque = (y: Float64Array) => 1.5 * pp * (y[0] * (kSS * y[1] - kSR * y[3]) - y[1] * (kSS * y[0] - kSR * y[2]))

  // ── stored samples ──
  const names = ['ia', 'ib', 'ic', 'irms', 'irr', 'va', 'vrms', 'f', 'n', 'nsync', 'slip', 'te', 'tl', 'psi', 'pin', 'w', 'thf', 'thr', 'stuck'] as const
  const S: Record<(typeof names)[number], number[]> = Object.fromEntries(names.map((k) => [k, [] as number[]])) as never
  function record(t: number) {
    const s = segmentAt(seg, t)
    const v = volt(s.f)
    const vm = SQ2 * v
    const isa = kSS * x[0] - kSR * x[2]
    const isb = kSS * x[1] - kSR * x[3]
    const ira = kRR * x[2] - kSR * x[0]
    const irb = kRR * x[3] - kSR * x[1]
    const va = vm * Math.cos(s.th)
    const vb = vm * Math.sin(s.th)
    const wm = stuck ? 0 : x[4]
    const ns = syncRpm(s.f, pp)
    S.ia.push(isa)
    S.ib.push(-0.5 * isa + SQ3_2 * isb)
    S.ic.push(-0.5 * isa - SQ3_2 * isb)
    S.irms.push(Math.sqrt(isa * isa + isb * isb) / SQ2)
    S.irr.push(Math.sqrt(ira * ira + irb * irb) / SQ2)
    S.va.push(va)
    S.vrms.push(v)
    S.f.push(s.f)
    S.n.push(rpm(wm))
    S.nsync.push(ns)
    S.slip.push(s.f > 1e-9 ? 1 - (pp * wm) / (2 * Math.PI * s.f) : 1)
    S.te.push(1.5 * pp * (x[0] * isb - x[1] * isa))
    S.tl.push(tlNow)
    S.psi.push(Math.hypot(x[0], x[1]))
    S.pin.push(1.5 * (va * isa + vb * isb))
    S.w.push(wm)
    S.thf.push(Math.atan2(x[1], x[0]))
    S.thr.push(x[5])
    S.stuck.push(stuck ? 1 : 0)
  }

  // ── the run: phase A (start), [hold, step, phase B], tail ──
  const events: RunEvent[] = []
  let seq = 0
  const nWin = Math.max(2, Math.round(WINDOW / dt))
  let t = 0
  let step = 0
  record(0)
  let phase: 'A' | 'holdA' | 'B' | 'tail' = 'A'
  let tMin = p.supply === 'dol' ? 3 / p.fr : p.f / p.rate
  let tLimit = tMin + MAX_SETTLE
  let tHoldEnd = 0
  let okWindows = 0
  let prevWin: { w: number; te: number; is: number } | null = null
  let tSettledA: number | null = null
  let tSettled: number | null = null
  let tstep: number | null = null
  let kStep: number | null = null
  let lastResidual = NaN
  const start = { iPeak: 0, tPeak: 0, teMax: -Infinity, teMin: Infinity }
  let iPeakRun = 0
  let eStart: ImEnergies | null = null
  let ekinAt = 0
  let movedOnce = false
  let tBreak: number | null = null
  let tRampEnd: number | null = p.supply === 'vf' ? p.f / p.rate : null
  let regen = false
  let budgetHit = false

  const energies = (): ImEnergies => {
    const isa = kSS * x[0] - kSR * x[2]
    const isb = kSS * x[1] - kSR * x[3]
    const ira = kRR * x[2] - kSR * x[0]
    const irb = kRR * x[3] - kSR * x[1]
    const w = stuck ? 0 : x[4]
    return {
      ein: x[6],
      ecuS: x[7],
      ecuR: x[8],
      efr: x[9],
      eload: x[10],
      ekin: 0.5 * J * w * w,
      // ½ Σ ψ·i over the six windings = (3/4)(ψs·is + ψr·ir)
      emag: 0.75 * (x[0] * isa + x[1] * isb + x[2] * ira + x[3] * irb),
    }
  }
  const ev = (time: number, device: string, extra: Record<string, number> = {}) => {
    const k = S.n.length - 1
    events.push({ id: `im${seq++}`, kind: 'mode', time, device, values: { i: S.irms[k], n: S.n[k], te: S.te[k], f: S.f[k], slip: S.slip[k], ...extra } })
  }

  for (;;) {
    // ── one RK4 step ──
    deriv(t, x, k1)
    for (let i = 0; i < N; i++) xt[i] = x[i] + 0.5 * h * k1[i]
    deriv(t + 0.5 * h, xt, k2)
    for (let i = 0; i < N; i++) xt[i] = x[i] + 0.5 * h * k2[i]
    deriv(t + 0.5 * h, xt, k3)
    for (let i = 0; i < N; i++) xt[i] = x[i] + h * k3[i]
    deriv(t + h, xt, k4)
    for (let i = 0; i < N; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
    step++
    t = step * h
    // ── the passive load: stick at zero speed, break away when the motor torque exceeds the load ──
    const te = torque(x)
    if (stuck) {
      x[4] = 0
      if (Math.abs(te) > tlNow) {
        stuck = false
        dir = te >= 0 ? 1 : -1
      }
    } else if (x[4] * dir < 0 || (x[4] === 0 && Math.abs(te) <= tlNow)) {
      x[4] = 0
      if (Math.abs(te) > tlNow) dir = te >= 0 ? 1 : -1
      else stuck = true
    }
    if (!stuck && !movedOnce && Math.abs(x[4]) > 0) {
      movedOnce = true
      tBreak = t
    }
    // peaks from every step (the sampled waveform could miss a peak between samples)
    {
      const isa = kSS * x[0] - kSR * x[2]
      const isb = kSS * x[1] - kSR * x[3]
      const ib = -0.5 * isa + SQ3_2 * isb
      const ic = -0.5 * isa - SQ3_2 * isb
      const ipk = Math.max(Math.abs(isa), Math.abs(ib), Math.abs(ic))
      if (ipk > iPeakRun) iPeakRun = ipk
      if (phase === 'A') {
        if (ipk > start.iPeak) {
          start.iPeak = ipk
          start.tPeak = t
        }
        if (te > start.teMax) start.teMax = te
        if (te < start.teMin) start.teMin = te
      }
    }
    if (step % decim !== 0) continue
    if (step > MAX_STEPS) budgetHit = true
    // ── a stored sample ──
    record(t)
    const k = S.n.length - 1
    if (tRampEnd !== null && t >= tRampEnd - 0.5 * dt && t < tRampEnd + 0.5 * dt) ev(tRampEnd, 'ramp-end')
    if (tBreak !== null && phase === 'A' && t >= tBreak && t - dt < tBreak && tBreak > WINDOW) ev(tBreak, 'breakaway')
    // generating: the rotor faster than the field (after a frequency step down)
    const gen = S.slip[k] < -1e-4 && !stuck
    if (gen !== regen && phase !== 'A') {
      ev(t, gen ? 'regen-start' : 'regen-end')
      regen = gen
    }
    if (budgetHit) {
      issues.push(`the run is limited to ${MAX_STEPS} integration steps: it has not settled`)
      break
    }
    // ── settling check, once per window ──
    if (k % nWin === 0 && k >= nWin) {
      const win = { w: meanOf(S.w, k - nWin, k), te: meanOf(S.te, k - nWin, k), is: meanOf(S.irms, k - nWin, k) }
      if (prevWin && (phase === 'A' || phase === 'B')) {
        const wsm = (2 * Math.PI * S.f[k]) / pp
        let tePk = 0
        for (let q = k - nWin; q <= k; q++) tePk = Math.max(tePk, Math.abs(S.te[q]))
        const dw = Math.abs(win.w - prevWin.w) / Math.max(wsm, 1e-9)
        const dte = Math.abs(win.te - prevWin.te) / Math.max(Math.abs(win.te), 0.01 * tePk, 1e-9)
        const dis = Math.abs(win.is - prevWin.is) / Math.max(win.is, 1e-9)
        lastResidual = Math.max(dw / 2e-6, dte / 2e-5, dis / 2e-5) * 1e-5
        okWindows = t >= tMin && dw < 2e-6 && dte < 2e-5 && dis < 2e-5 ? okWindows + 1 : 0
        const done = okWindows >= SETTLE_WINDOWS
        if (done || t >= tLimit) {
          if (phase === 'A') {
            tSettledA = done ? t : null
            if (done) ev(t, 'settled')
            eStart = energies()
            ekinAt = t
            phase = p.event === 'none' ? 'tail' : 'holdA'
            tHoldEnd = t + Math.max(0.1, 0.25 * t)
          } else {
            tSettled = done ? t : null
            if (done) ev(t, 'settled')
            phase = 'tail'
            tHoldEnd = t + Math.max(0.1, 0.25 * (t - (tstep ?? 0)))
          }
          if (!done) issues.push(`no steady operating point within ${MAX_SETTLE} s of the ${tstep === null ? 'start' : 'step'}`)
          okWindows = 0
        }
      }
      prevWin = win
    }
    if ((phase === 'holdA' || phase === 'tail') && t >= tHoldEnd - 1e-12) {
      if (phase === 'tail') break
      // ── the step, on this sample ──
      tstep = t
      kStep = k + 1
      if (p.event === 'load') tlNow = p.tl2
      else {
        const s0 = segmentAt(seg, t)
        seg = { t0: t, f0: s0.f, fEnd: p.f2, rate: p.f2 >= s0.f ? p.rate : -p.rate, th0: s0.th }
        segs.push(seg)
        tRampEnd = t + Math.abs(p.f2 - s0.f) / p.rate
      }
      ev(t, p.event === 'load' ? 'load-step' : 'freq-step', { from: p.event === 'load' ? p.tl : p.f, to: p.event === 'load' ? p.tl2 : p.f2 })
      phase = 'B'
      tMin = p.event === 'freq' ? tRampEnd! : t + 3 / S.f[k]
      tLimit = tMin + MAX_SETTLE
      okWindows = 0
      prevWin = null
    }
  }
  if (tSettled === null && p.event === 'none') tSettled = tSettledA

  // ── arrays ──
  const n = S.n.length
  const signals: Record<string, Float64Array> = {}
  for (const k of names) signals[k] = Float64Array.from(S[k])
  const time = new Float64Array(n)
  for (let k = 0; k < n; k++) time[k] = k * dt
  const duration = (n - 1) * dt
  p.duration = duration
  p.periods = Math.max(1, Math.round(duration / p.period))

  // ── plateaus: the last supply cycle before the step and at the end ──
  const plateau = (kEnd: number): ImPlateau => {
    const f = signals.f[kEnd]
    const kc = Math.max(1, Math.min(kEnd, Math.round(1 / Math.max(f, 1e-9) / dt)))
    const k0 = kEnd - kc
    const v = signals.vrms[kEnd]
    const wm = meanOf(signals.w, k0, kEnd)
    const te = meanOf(signals.te, k0, kEnd)
    const is2 = meanOf(Float64Array.from({ length: kc + 1 }, (_, q) => signals.irms[k0 + q] ** 2), 0, kc)
    const ir2 = meanOf(Float64Array.from({ length: kc + 1 }, (_, q) => signals.irr[k0 + q] ** 2), 0, kc)
    const w2 = meanOf(Float64Array.from({ length: kc + 1 }, (_, q) => signals.w[k0 + q] ** 2), 0, kc)
    const pin = meanOf(signals.pin, k0, kEnd)
    const tl = signals.tl[kEnd]
    const stuckEnd = signals.stuck[kEnd] > 0.5
    const is = Math.sqrt(is2)
    const pout = stuckEnd ? 0 : tl * Math.abs(wm)
    const ws = 2 * Math.PI * f
    return {
      t0: time[k0],
      t1: time[kEnd],
      f,
      v,
      wm,
      n: rpm(wm),
      nsync: syncRpm(f, pp),
      slip: 1 - (pp * wm) / ws,
      te,
      is,
      ir: Math.sqrt(ir2),
      pin,
      pf: pin / (3 * v * is),
      pcuS: 3 * rs * is2,
      pcuR: 3 * rr * ir2,
      pfr: B * w2,
      pout,
      pag: (te * ws) / pp,
      eff: pin > 1e-9 && pout > 0 ? pout / pin : null,
      psi: meanOf(signals.psi, k0, kEnd),
      stuck: stuckEnd,
    }
  }
  const end = plateau(n - 1)
  const pre = kStep !== null ? plateau(kStep - 1) : null
  const e = energies()
  const balance = (e.ein - e.ecuS - e.ecuR - e.efr - e.eload - e.ekin - e.emag) / Math.max(Math.abs(e.ein), e.ecuS + e.ecuR, 1e-12)

  // start: time to reach 95 % of the start plateau's speed
  const kA = kStep !== null ? kStep - 1 : n - 1
  const nA = signals.n[kA]
  let tStart: number | null = null
  let kStart = -1
  if (Math.abs(nA) > 1)
    for (let k = 1; k <= kA; k++)
      if (Math.abs(signals.n[k]) >= 0.95 * Math.abs(nA)) {
        tStart = time[k]
        kStart = k
        break
      }
  // the largest torque on the way up (rotor above half its plateau speed): the pull-out region of the curve
  let kAcc = -1
  for (let k = 0; k <= kStart; k++) if (signals.n[k] > 0.5 * nA && (kAcc < 0 || signals.te[k] > signals.te[kAcc])) kAcc = k
  if (kAcc > 0) {
    events.push({ id: `im${seq++}`, kind: 'mode', time: time[kAcc], device: 'accel-peak', values: { i: signals.irms[kAcc], n: signals.n[kAcc], te: signals.te[kAcc], f: signals.f[kAcc], slip: signals.slip[kAcc] } })
  }
  // the peak starting current
  {
    const k = Math.min(n - 1, Math.round(start.tPeak / dt))
    events.push({ id: `im${seq++}`, kind: 'mode', time: start.tPeak, device: 'peak', values: { i: start.iPeak, n: signals.n[k], te: signals.te[k], f: signals.f[k], slip: signals.slip[k] } })
  }
  const stalled = end.stuck && movedOnce
  if (stalled) {
    let kS = n - 1
    while (kS > 0 && signals.stuck[kS - 1] > 0.5) kS--
    events.push({ id: `im${seq++}`, kind: 'mode', time: time[kS], device: 'stall', values: { i: signals.irms[kS], n: 0, te: signals.te[kS], f: signals.f[kS], slip: 1 } })
  }
  // what a step leads to: recorded for its explanation
  const stepEv = events.find((x) => x.device === 'load-step' || x.device === 'freq-step')
  if (stepEv && pre) Object.assign(stepEv.values, { nBefore: pre.n, nEnd: end.n, sBefore: pre.slip, sEnd: end.slip, iBefore: pre.is, iEnd: end.is, stalled: stalled ? 1 : 0 })
  events.sort((a, b) => a.time - b.time)

  return {
    kind: 'induction',
    params: p,
    length: n,
    time,
    signals,
    devices: [],
    events,
    steadyFrom: Math.max(0, n - 1 - Math.round(1 / Math.max(end.f, 1e-9) / dt)),
    tstep,
    kStep,
    tSettledA,
    tSettled,
    pre,
    end,
    start: { ...start, tStart, e: eStart ?? e, ekinAt },
    energy: { ...e, balance },
    iPeakRun,
    neverStarted: !movedOnce,
    stalled,
    steps: step,
    diagnostics: {
      computeMs: performance.now() - started,
      fallbacks: 0,
      steady: { method: 'startup', iterations: 0, residual: lastResidual, converged: tSettled !== null },
      issues,
    },
  }
}
