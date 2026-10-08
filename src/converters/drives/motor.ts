import type { Mat } from '../expm.ts'
import { simulatePwl, type PwlEvent, type PwlResult, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * DRIVES — a separately excited (or permanent-magnet) DC motor fed by a PWM chopper.
 *
 *   Vdc ── Q (PWM, duty d) ──┬── Ra ── La ── E = k·ω ──┐        shaft: J·dω/dt = k·ia − B·ω − TL
 *                           D (freewheel, 1-quadrant)   │
 *   0 V ────────────────────┴───────────────────────────┘
 *
 * One-quadrant chopper (1Q): Q plus a freewheeling diode. The armature current can only be positive: when
 * it reaches zero with Q off, the diode blocks and the current stays zero (DISCONTINUOUS conduction) — the
 * terminal voltage is then the back-EMF.
 * Two-quadrant chopper (2Q): a half bridge switched complementarily. The current can reverse: the machine
 * brakes and returns energy to the source (regeneration).
 *
 * State x = [ia, ω]. In each conduction mode the equations are linear:
 *   La·dia/dt = va − Ra·ia − k·ω,  J·dω/dt = k·ia − B·ω − TL;   va = Vdc (gate on) or 0 (gate off)
 *   zero-current mode (1Q only): dia/dt = 0, ia = 0
 * — a piecewise-linear hybrid system (converters/pwl.ts), simulated and solved exactly by the same toolkit
 * the device lab uses.
 */
export type Bridge = '1q' | '2q'
export type DriveEvent = 'none' | 'load' | 'duty'

export interface DriveParams {
  bridge: Bridge
  vdc: number
  /** Duty ratio of the chopper (mean armature voltage d·Vdc in continuous conduction). */
  duty: number
  fs: number
  ra: number
  la: number
  /** Motor constant k: back-EMF k·ω [V·s/rad] = torque per ampere [N·m/A]. */
  ke: number
  j: number
  /** Viscous friction [N·m·s/rad]. */
  b: number
  /** Load torque [N·m] (constant, like a hoist). */
  tl: number
  event: DriveEvent
  /** Load torque after a load step / duty after a duty step. */
  tl2: number
  d2: number
  /** Soft start: the duty ramps from 0 over this time (0 = applied at once). */
  tramp: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedDrive extends DriveParams, RunParams {
  tauE: number
  tauM: number
  /** Slowest decay rate of the averaged electromechanical system [1/s]. */
  sigma: number
  /** Time of the load or duty step (a period start), or null. */
  tstep: number | null
  /** Duty of every period (sampled at the period start, like a digital modulator). */
  duties: number[]
}

export const DRIVE_DEFAULTS: DriveParams = {
  bridge: '1q',
  vdc: 48,
  duty: 0.6,
  fs: 10e3,
  ra: 1,
  la: 2e-3,
  ke: 0.1,
  j: 1e-4,
  b: 1e-5,
  tl: 0.1,
  event: 'none',
  tl2: 0.3,
  d2: 0.3,
  tramp: 0,
  view: 'startup',
  periods: 0,
  stepsPerPeriod: 0,
}

export const DRIVE_LIMITS = {
  vdc: { min: 5, max: 600 },
  duty: { min: 0, max: 1 },
  fs: { min: 500, max: 50e3 },
  ra: { min: 0.01, max: 50 },
  la: { min: 1e-5, max: 0.5 },
  ke: { min: 0.005, max: 5 },
  j: { min: 1e-6, max: 1 },
  b: { min: 0, max: 0.1 },
  tl: { min: 0, max: 50 },
  tl2: { min: 0, max: 50 },
  d2: { min: 0, max: 1 },
  tramp: { min: 0, max: 2 },
}

/** Most simulated periods in a start-up run, and the sample budget. */
const MAX_PERIODS = 4000
const SAMPLE_BUDGET = 48000

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

/** The averaged (state-space) matrix of the motor: x = [ia, ω]. */
export function motorMatrix(p: Pick<DriveParams, 'ra' | 'la' | 'ke' | 'j' | 'b'>): Mat {
  return [
    [-p.ra / p.la, -p.ke / p.la],
    [p.ke / p.j, -p.b / p.j],
  ]
}

/** Slowest decay rate of the averaged motor (the eigenvalue closest to zero). */
export function slowestRate(p: Pick<DriveParams, 'ra' | 'la' | 'ke' | 'j' | 'b'>): number {
  const A = motorMatrix(p)
  const tr = A[0][0] + A[1][1]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
  const disc = (tr * tr) / 4 - det
  return disc >= 0 ? -(tr / 2 + Math.sqrt(disc)) : -tr / 2
}

export function resolveDrive(input: Partial<DriveParams>): { params: ResolvedDrive; issues: string[] } {
  const p = { ...DRIVE_DEFAULTS, ...input }
  const issues: string[] = []
  const L = DRIVE_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, DRIVE_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    vdc: c('vdc'),
    duty: c('duty'),
    fs: c('fs'),
    ra: c('ra'),
    la: c('la'),
    ke: c('ke'),
    j: c('j'),
    b: c('b'),
    tl: c('tl'),
    tl2: c('tl2'),
    d2: c('d2'),
    tramp: c('tramp'),
  }
  const bridge: Bridge = p.bridge === '2q' ? '2q' : '1q'
  const event: DriveEvent = p.event === 'load' || p.event === 'duty' ? p.event : 'none'
  const view = p.view === 'steady' ? 'steady' : 'startup'
  const ts = 1 / q.fs
  const sigma = slowestRate(q)
  const settle = 8 / sigma
  let periods: number
  let spp: number
  let tstep: number | null = null
  if (view === 'steady') {
    periods = 3
    spp = 200
  } else {
    let t1 = Math.ceil((settle + q.tramp) / ts) * ts
    if (event !== 'none') {
      tstep = t1
      t1 = tstep + Math.ceil(settle / ts) * ts
    }
    periods = Math.round(t1 / ts)
    // an explicit window (e.g. a longer run when the drive has not settled)
    if (p.periods > 0) {
      periods = Math.round(p.periods)
      if (tstep !== null) tstep = Math.round(periods / 2) * ts
    }
    if (periods > MAX_PERIODS) {
      issues.push(`the drive settles slowly compared with the PWM period: the window is limited to ${MAX_PERIODS} periods`)
      periods = MAX_PERIODS
      if (tstep !== null) tstep = Math.round(periods / 2) * ts
    }
    spp = Math.max(16, Math.min(200, 2 * Math.round(SAMPLE_BUDGET / periods / 2)))
  }
  const duties: number[] = []
  for (let m = 0; m < periods; m++) {
    const t = m * ts
    let d = q.duty
    if (view === 'startup') {
      if (q.tramp > 0 && t < q.tramp) d *= t / q.tramp
      if (event === 'duty' && tstep !== null && t >= tstep - 1e-9 * ts) d = q.d2
    }
    duties.push(d)
  }
  const params: ResolvedDrive = {
    ...p,
    ...q,
    bridge,
    event,
    view,
    periods,
    stepsPerPeriod: spp,
    period: ts,
    dt: ts / spp,
    duration: periods * ts,
    tauE: q.la / q.ra,
    tauM: (q.j * q.ra) / (q.ke * q.ke),
    sigma,
    tstep,
    duties,
  }
  return { params, issues }
}

/** Period index containing t (an instant exactly on a period start belongs to the new period). */
export const periodOf = (p: ResolvedDrive, t: number) => Math.min(p.periods - 1, Math.max(0, Math.floor(t / p.period + 1e-9)))

/** PWM gate at time t (an instant exactly on an edge takes the new value). */
export function gateAt(p: ResolvedDrive, t: number): boolean {
  const m = periodOf(p, t)
  return t - m * p.period < p.duties[m] * p.period - 1e-9 * p.period
}

export const loadAt = (p: ResolvedDrive, t: number) => (p.event === 'load' && p.tstep !== null && t >= p.tstep - 1e-9 * p.period ? p.tl2 : p.tl)

/** Gate edges and input steps: the breakpoints of the hybrid system. */
export function driveBreakpoints(p: ResolvedDrive, t0 = 0, t1 = p.duration): number[] {
  const out: number[] = []
  for (let m = 0; m < p.periods; m++) {
    const ts = m * p.period
    const d = p.duties[m]
    if (ts > t0 && ts < t1) out.push(ts)
    const tf = ts + d * p.period
    if (d > 0 && d < 1 && tf > t0 && tf < t1) out.push(tf)
  }
  return out
}

/**
 * The drive as a PWL hybrid system. Modes: 'c' (armature current flowing) and, for the one-quadrant chopper,
 * 'z' (zero current: the diode blocks). With `integrals` the state is augmented with ∫ia dt and ∫ω dt, so
 * the exact solution also gives exact period means.
 */
export function driveSystem(p: ResolvedDrive, integrals = false, breakpoints = driveBreakpoints(p)): PwlSystem {
  const n = integrals ? 4 : 2
  const pad = (rows: number[][]): Mat => rows.map((r) => [...r, ...Array(n - r.length).fill(0)])
  return {
    n,
    breakpoints,
    mode(x, t, prev) {
      if (p.bridge === '2q') return 'c'
      if (prev === 'c') return x[0] >= 0 ? 'c' : 'z'
      // zero current: conduction restarts when the applied voltage exceeds the back-EMF
      const drive = gateAt(p, t) ? p.vdc : 0
      return drive - p.ke * x[1] > 0 ? 'c' : 'z'
    },
    sys(mode, t) {
      const tl = loadAt(p, t)
      const va = gateAt(p, t) ? p.vdc : 0
      const A = mode === 'z' ? [[0, 0], [0, -p.b / p.j]] : motorMatrix(p)
      const b = mode === 'z' ? [0, -tl / p.j] : [va / p.la, -tl / p.j]
      if (!integrals) return { A, b }
      return {
        A: pad([...A, [1, 0], [0, 1]]),
        b: [...b, 0, 0],
      }
    },
  }
}

/** Mode at rest (or at any state) before the first step. */
export const initialMode = (p: ResolvedDrive, x: number[]) => (p.bridge === '2q' ? 'c' : x[0] > 0 ? 'c' : driveSystem(p).mode(x, 0, 'z'))

export type DriveRun = Run<ResolvedDrive> & { modes: string[]; pwlEvents: PwlEvent[]; knots: PwlResult['knots'] }

/** Newton shooting for the periodic steady state of a one-period map. */
export function periodicState(p: ResolvedDrive, map: (x: number[]) => number[], guess: number[]): { x: number[]; iterations: number; residual: number } {
  const iS = Math.max(Math.abs(guess[0]), (0.01 * p.vdc) / p.ra, 1e-3)
  const wS = Math.max(Math.abs(guess[1]), 1)
  let x = [...guess]
  let residual = Infinity
  let it = 0
  for (; it < 14; it++) {
    const fx = map(x)
    const r = [fx[0] - x[0], fx[1] - x[1]]
    residual = Math.max(Math.abs(r[0]) / iS, Math.abs(r[1]) / wS)
    if (residual < 1e-11) break
    const h = [1e-6 * iS, 1e-6 * wS]
    const J: number[][] = [
      [0, 0],
      [0, 0],
    ]
    for (let j = 0; j < 2; j++) {
      const xp = [...x]
      xp[j] += h[j]
      const fp = map(xp)
      for (let i = 0; i < 2; i++) J[i][j] = (fp[i] - xp[i] - r[i]) / h[j]
    }
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0]
    if (!(Math.abs(det) > 0)) break
    const dx = [(-r[0] * J[1][1] + r[1] * J[0][1]) / det, (-J[0][0] * r[1] + J[1][0] * r[0]) / det]
    x = [x[0] + dx[0], x[1] + dx[1]]
    if (p.bridge === '1q' && x[0] < 0) x[0] = 0
  }
  return { x, iterations: it, residual }
}

/** Averaged steady state (continuous conduction): the starting guess and the textbook operating point. */
export function averagedSteady(p: Pick<DriveParams, 'ra' | 'ke' | 'b' | 'vdc'>, d: number, tl: number): { w: number; i: number } {
  const w = (d * p.vdc - (p.ra * tl) / p.ke) / (p.ke + (p.ra * p.b) / p.ke)
  return { w, i: (tl + p.b * w) / p.ke }
}

/**
 * SIMULATION: the chopper drive integrated by the PWL simulator (start-up from rest, or the periodic steady
 * state). A start-up that has not settled in the automatic window (discontinuous conduction slows it) is run
 * again over a longer window, twice as long.
 */
export function simulateDrive(input: Partial<DriveParams>): DriveRun {
  const started = performance.now()
  let r = simulateOnce(input)
  for (let tries = 0; tries < 1 && r.params.view === 'startup' && r.params.event === 'none' && !r.diagnostics.steady.converged && r.params.periods * 2 <= MAX_PERIODS && !(input.periods! > 0); tries++)
    r = simulateOnce({ ...input, periods: r.params.periods * 2 })
  r.diagnostics.computeMs = performance.now() - started
  return r
}

function simulateOnce(input: Partial<DriveParams>): DriveRun {
  const started = performance.now()
  const { params: p, issues } = resolveDrive(input)
  let x0 = [0, 0]
  let steady: DriveRun['diagnostics']['steady'] = { method: 'startup', iterations: 0, residual: NaN, converged: false }
  if (p.view === 'steady') {
    const sys1 = driveSystem(p, false, driveBreakpoints(p, 0, p.period))
    const map = (x: number[]) => {
      const r = simulatePwl(sys1, x, 0, p.period, p.stepsPerPeriod, initialMode(p, x))
      return [r.x[0][p.stepsPerPeriod], r.x[1][p.stepsPerPeriod]]
    }
    const av = averagedSteady(p, p.duty, p.tl)
    const ripple = (p.vdc * p.duty * (1 - p.duty)) / (p.la * p.fs)
    const guess = [p.bridge === '1q' ? Math.max(0, av.i - ripple / 2) : av.i - ripple / 2, av.w]
    const sh = periodicState(p, map, guess)
    x0 = sh.x
    steady = { method: 'shooting', iterations: sh.iterations, residual: sh.residual, converged: sh.residual < 1e-7 }
  }
  const sys = driveSystem(p)
  const steps = p.periods * p.stepsPerPeriod
  const res = simulatePwl(sys, x0, 0, p.duration, steps, initialMode(p, x0))
  const n = steps + 1
  const names = ['ia', 'w', 'n', 'e', 'va', 'te', 'tl', 'gate', 'duty', 'iin', 'pin']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  for (let k = 0; k < n; k++) {
    const t = res.t[k]
    const tEnd = k > 0 ? t - p.dt * 1e-6 : 0 // the interval ending at this sample
    const ia = res.x[0][k]
    const w = res.x[1][k]
    const g = gateAt(p, tEnd)
    const z = res.modes[k] === 'z'
    s.ia[k] = ia
    s.w[k] = w
    s.n[k] = (w * 60) / (2 * Math.PI)
    s.e[k] = p.ke * w
    s.va[k] = z ? p.ke * w : g ? p.vdc : 0
    s.te[k] = p.ke * ia
    s.tl[k] = loadAt(p, tEnd)
    s.gate[k] = g ? 1 : 0
    s.duty[k] = p.duties[periodOf(p, tEnd)]
    s.iin[k] = g && !z ? ia : 0
    s.pin[k] = p.vdc * s.iin[k]
  }
  if (p.view === 'startup') {
    // settled when the speed in the last period differs from ten periods earlier by < 0.2 %
    const spp = p.stepsPerPeriod
    const mean = (m: number) => {
      let a = 0
      for (let k = m * spp; k < (m + 1) * spp; k++) a += 0.5 * (s.w[k] + s.w[k + 1])
      return a / spp
    }
    const last = mean(p.periods - 1)
    const back = Math.min(10, p.periods - 1)
    const before = mean(p.periods - 1 - back)
    // remaining distance to the final speed, extrapolated from the slowest decay over the last periods
    const residual = Math.abs(last - before) / Math.max(1e-12, -Math.expm1(-p.sigma * back * p.period)) / Math.max(Math.abs(last), 1)
    steady = { method: 'startup', iterations: 0, residual, converged: residual < 2e-3 }
  }
  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
    events.push({ id: `d${seq++}`, kind, time: t, device, values: { ia: s.ia[k], n: s.n[k], va: s.va[k] } })
  }
  if (p.view === 'steady') {
    for (let m = 0; m < p.periods; m++) {
      if (m > 0 || p.duties[m] > 0) ev('gate-on', m * p.period, 'Q')
      if (p.duties[m] > 0 && p.duties[m] < 1) ev('gate-off', (m + p.duties[m]) * p.period, 'Q')
    }
    for (const x of res.events) ev(x.to === 'z' ? 'il-zero' : 'mode', x.t, `${x.from}→${x.to}`)
  } else {
    let kPk = 0
    for (let k = 1; k < n; k++) if (s.ia[k] > s.ia[kPk]) kPk = k
    if (kPk > 0) ev('mode', res.t[kPk], 'peak')
    const firstZ = res.events.find((x) => x.to === 'z')
    if (firstZ) ev('il-zero', firstZ.t, 'c→z')
    if (p.tstep !== null) ev('mode', p.tstep, p.event === 'load' ? 'load-step' : 'duty-step')
    if (p.tramp > 0 && p.tramp < p.duration) ev('mode', p.tramp, 'ramp-end')
  }
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'drive',
    params: p,
    length: n,
    time: res.t,
    signals: s,
    devices: [],
    events,
    steadyFrom: p.view === 'steady' ? 0 : (p.periods - 1) * p.stepsPerPeriod,
    modes: res.modes,
    pwlEvents: res.events,
    knots: res.knots,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady, issues },
  }
}

export interface DriveMeasurements {
  /** Last period: mean speed [rad/s] and [rpm], mean / rms / ripple of the armature current. */
  wEnd: number
  nEnd: number
  iEnd: number
  irms: number
  ripple: number
  iMin: number
  iMax: number
  vaEnd: number
  /** Whole run: largest and most negative armature current. */
  iPeak: number
  iNeg: number
  /** Time to reach 90 % of the speed before the step (or the final speed). */
  t90: number | null
  /** Mean speed over the last period before the step. */
  wPre: number | null
  /** Zero-current interval in the last period (1Q). */
  dcm: boolean
  settled: boolean
  /** Last-period powers [W]. */
  pin: number
  pcu: number
  pfr: number
  pshaft: number
  eff: number | null
  /** Energies over the whole run [J]. */
  ein: number
  ecu: number
  efr: number
  eload: number
  ekin: number
  emag: number
  eregen: number
  /** Energy balance residual relative to the input energy. */
  balance: number
}

/** Fraction of [ta, tb] (inside one period) during which the gate is on. */
export function onFraction(p: ResolvedDrive, ta: number, tb: number): number {
  const m = periodOf(p, 0.5 * (ta + tb))
  const on0 = m * p.period
  const on1 = on0 + p.duties[m] * p.period
  return Math.max(0, Math.min(tb, on1) - Math.max(ta, on0)) / (tb - ta)
}

/**
 * ∫ f(ia, ω) dt over periods [m0, m1): the trapezoidal rule through the samples AND the simulator's states
 * at the gate edges and current zeros between them (the waveform has corners there).
 */
function integrate(r: DriveRun, f: (ia: number, w: number) => number, m0: number, m1: number): number {
  const p = r.params
  const spp = p.stepsPerPeriod
  const kn = r.knots
  const tA = m0 * p.period
  let lo = 0
  let hi = kn.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (kn[mid].t <= tA) lo = mid + 1
    else hi = mid
  }
  let j = lo
  let acc = 0
  for (let k = m0 * spp; k < m1 * spp; k++) {
    let tPrev = r.time[k]
    let vPrev = f(r.signals.ia[k], r.signals.w[k])
    const tNext = r.time[k + 1]
    for (; j < kn.length && kn[j].t < tNext; j++) {
      if (kn[j].t <= tPrev) continue
      const v = f(kn[j].x[0], kn[j].x[1])
      acc += 0.5 * (vPrev + v) * (kn[j].t - tPrev)
      tPrev = kn[j].t
      vPrev = v
    }
    acc += 0.5 * (vPrev + f(r.signals.ia[k + 1], r.signals.w[k + 1])) * (tNext - tPrev)
  }
  return acc
}

/** Mean of a signal over periods [m0, m1) by the trapezoidal rule. */
function meanOver(r: DriveRun, x: Float64Array, m0: number, m1: number): number {
  const spp = r.params.stepsPerPeriod
  let a = 0
  for (let k = m0 * spp; k < m1 * spp; k++) a += 0.5 * (x[k] + x[k + 1])
  return a / ((m1 - m0) * spp)
}

export function measureDrive(r: DriveRun): DriveMeasurements {
  const p = r.params
  const s = r.signals
  const spp = p.stepsPerPeriod
  const mL = p.periods - 1
  const k0 = mL * spp
  const k1 = p.periods * spp
  let iMin = Infinity
  let iMax = -Infinity
  let dcm = false
  for (let k = k0; k <= k1; k++) {
    iMin = Math.min(iMin, s.ia[k])
    iMax = Math.max(iMax, s.ia[k])
    if (r.modes[k] === 'z') dcm = true
  }
  // the extremes fall on gate edges, between samples: include the simulator's states at the edges
  const tA = mL * p.period
  for (const kn of r.knots)
    if (kn.t > tA) {
      iMin = Math.min(iMin, kn.x[0])
      iMax = Math.max(iMax, kn.x[0])
    }
  const wEnd = integrate(r, (_i, w) => w, mL, p.periods) / p.period
  const iEnd = integrate(r, (i) => i, mL, p.periods) / p.period
  const irms = Math.sqrt(integrate(r, (i) => i * i, mL, p.periods) / p.period)
  // mean terminal voltage from the armature equation averaged over the period (exact for the state)
  const vaEnd = p.ra * iEnd + p.ke * wEnd + (p.la * (s.ia[k1] - s.ia[k0])) / p.period
  let iPeak = -Infinity
  let iNeg = Infinity
  for (let k = 0; k < r.length; k++) {
    iPeak = Math.max(iPeak, s.ia[k])
    iNeg = Math.min(iNeg, s.ia[k])
  }
  for (const kn of r.knots) {
    iPeak = Math.max(iPeak, kn.x[0])
    iNeg = Math.min(iNeg, kn.x[0])
  }
  const mPre = p.tstep !== null ? Math.round(p.tstep / p.period) - 1 : null
  const wPre = mPre !== null && mPre >= 0 ? integrate(r, (_i, w) => w, mPre, mPre + 1) / p.period : null
  let t90: number | null = null
  if (p.view === 'startup') {
    const target = 0.9 * (wPre ?? wEnd)
    if (target > 0)
      for (let k = 1; k < r.length; k++)
        if (s.w[k] >= target) {
          const f = (target - s.w[k - 1]) / (s.w[k] - s.w[k - 1])
          t90 = r.time[k - 1] + f * p.dt
          break
        }
  }
  // Source current: the switch conducts for the gated fraction of each step (edges fall inside steps).
  const srcEnergy = (k: number) => (r.modes[k + 1] === 'z' && r.modes[k] === 'z' ? 0 : p.vdc * onFraction(p, r.time[k], r.time[k + 1]) * 0.5 * (s.ia[k] + s.ia[k + 1]) * p.dt)
  let ein1 = 0
  for (let k = k0; k < k1; k++) ein1 += srcEnergy(k)
  const pin = ein1 / p.period
  const pcu = p.ra * irms * irms
  const pfr = (p.b * integrate(r, (_i, w) => w * w, mL, p.periods)) / p.period
  const pshaft = meanOver(r, Float64Array.from(s.w, (w, k) => w * s.tl[k]), mL, p.periods)
  // energies over the run (trapezoidal), and the balance Ein = Ecu + Efr + Eload + ΔEkin + ΔEmag
  let ein = 0
  let ecu = 0
  let efr = 0
  let eload = 0
  let eregen = 0
  for (let k = 0; k + 1 < r.length; k++) {
    const h = p.dt
    const pi = srcEnergy(k)
    ein += pi
    if (pi < 0) eregen -= pi
    ecu += 0.5 * p.ra * (s.ia[k] ** 2 + s.ia[k + 1] ** 2) * h
    efr += 0.5 * p.b * (s.w[k] ** 2 + s.w[k + 1] ** 2) * h
    eload += 0.5 * (s.tl[k + 1] * s.w[k] + s.tl[k + 1] * s.w[k + 1]) * h
  }
  const last = r.length - 1
  const ekin = 0.5 * p.j * (s.w[last] ** 2 - s.w[0] ** 2)
  const emag = 0.5 * p.la * (s.ia[last] ** 2 - s.ia[0] ** 2)
  const balance = (ein - ecu - efr - eload - ekin - emag) / Math.max(Math.abs(ein), Math.abs(ecu), 1e-12)
  return {
    wEnd,
    nEnd: (wEnd * 60) / (2 * Math.PI),
    iEnd,
    irms,
    ripple: iMax - iMin,
    iMin,
    iMax,
    vaEnd,
    iPeak,
    iNeg,
    t90,
    wPre,
    dcm,
    settled: r.diagnostics.steady.converged,
    pin,
    pcu,
    pfr,
    pshaft,
    eff: r.diagnostics.steady.converged && pin > 1e-9 && pshaft > 0 ? pshaft / pin : null,
    ein,
    ecu,
    efr,
    eload,
    ekin,
    emag,
    eregen,
    balance,
  }
}

export const rpm = (w: number) => (w * 60) / (2 * Math.PI)
