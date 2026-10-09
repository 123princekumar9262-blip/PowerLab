import { simulatePwl, type PwlEvent, type PwlResult, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * MAGNETICS — a gapped-core winding driven by a square-wave voltage (an H-bridge: +V for d·T, −V for the rest).
 *
 *   v(t) ── R (winding) ── N turns on a core: magnetic path le, area Ae, air gap lg
 *
 * Faraday: dλ/dt = v − R·i, λ = N·B·Ae (flux linkage).
 * Ampère:  N·i = Hcore·le + (B/μ0)·lg, with a piecewise-linear B–H curve for the core material:
 *   |B| ≤ Bsat:  B = μ0·μr·H          (unsaturated: L1 = N²·μ0·Ae/(lg + le/μr))
 *   |B| > Bsat:  slope μ0·μsat         (saturated:   L2 = N²·μ0·Ae/(lg + le/μsat))
 * so i is a continuous piecewise-linear function of λ, and in each region the circuit is linear in λ —
 * a PWL hybrid system with modes 'lin', 'sat+', 'sat−' (converters/pwl.ts). Hysteresis and eddy-current
 * (core) losses are NOT modelled: the only loss is the winding resistance.
 */
export interface CoreParams {
  vdc: number
  f: number
  duty: number
  n: number
  /** Core cross-section [m²], magnetic path length [m], air gap [m]. */
  ae: number
  le: number
  lg: number
  mur: number
  bsat: number
  /** Relative incremental permeability once saturated (1 = like air). */
  musat: number
  r: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedCore extends CoreParams, RunParams {
  /** Unsaturated and saturated inductances [H]; saturation flux linkage [Wb-turns]. */
  l1: number
  l2: number
  lamS: number
  tau1: number
}

export const MU0 = 4e-7 * Math.PI

export const CORE_DEFAULTS: CoreParams = {
  vdc: 24,
  f: 20e3,
  duty: 0.5,
  n: 20,
  ae: 50e-6,
  le: 50e-3,
  lg: 0.5e-3,
  mur: 2000,
  bsat: 0.35,
  musat: 1,
  r: 0.1,
  view: 'steady',
  periods: 0,
  stepsPerPeriod: 0,
}

export const CORE_LIMITS = {
  vdc: { min: 1, max: 400 },
  f: { min: 1e3, max: 500e3 },
  duty: { min: 0.3, max: 0.7 },
  n: { min: 1, max: 200 },
  ae: { min: 5e-6, max: 1e-3 },
  le: { min: 10e-3, max: 300e-3 },
  lg: { min: 0, max: 5e-3 },
  mur: { min: 100, max: 20000 },
  bsat: { min: 0.2, max: 1.5 },
  musat: { min: 1, max: 100 },
  r: { min: 0.005, max: 10 },
}

const MAX_PERIODS = 1500
const SAMPLE_BUDGET = 60000

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function inductances(p: Pick<CoreParams, 'n' | 'ae' | 'le' | 'lg' | 'mur' | 'musat'>): { l1: number; l2: number } {
  const k = p.n * p.n * MU0 * p.ae
  return { l1: k / (p.lg + p.le / p.mur), l2: k / (p.lg + p.le / p.musat) }
}

export function resolveCore(input: Partial<CoreParams>): { params: ResolvedCore; issues: string[] } {
  const p = { ...CORE_DEFAULTS, ...input }
  const issues: string[] = []
  const L = CORE_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, CORE_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = { vdc: c('vdc'), f: c('f'), duty: c('duty'), n: Math.round(c('n')), ae: c('ae'), le: c('le'), lg: c('lg'), mur: c('mur'), bsat: c('bsat'), musat: c('musat'), r: c('r') }
  if (q.musat > q.mur) q.musat = q.mur
  const { l1, l2 } = inductances(q)
  const view = p.view === 'startup' ? 'startup' : 'steady'
  const T = 1 / q.f
  const tau1 = l1 / q.r
  let periods: number
  let spp: number
  if (view === 'steady') {
    periods = 2
    spp = 400
  } else {
    periods = p.periods > 0 ? Math.round(p.periods) : Math.max(4, Math.ceil((8 * tau1) / T))
    if (periods > MAX_PERIODS) {
      issues.push(`the winding time constant L/R is long compared with the period: the window is limited to ${MAX_PERIODS} periods`)
      periods = MAX_PERIODS
    }
    spp = Math.max(40, Math.min(400, 2 * Math.round(SAMPLE_BUDGET / periods / 2)))
  }
  const params: ResolvedCore = {
    ...p,
    ...q,
    view,
    periods,
    stepsPerPeriod: spp,
    period: T,
    dt: T / spp,
    duration: periods * T,
    l1,
    l2,
    lamS: q.n * q.bsat * q.ae,
    tau1,
  }
  return { params, issues }
}

/** Applied voltage at t (an instant on an edge takes the new value). */
export function voltageAt(p: ResolvedCore, t: number): number {
  const m = Math.floor(t / p.period + 1e-9)
  return t - m * p.period < p.duty * p.period - 1e-9 * p.period ? p.vdc : -p.vdc
}

export function coreBreakpoints(p: ResolvedCore, t0 = 0, t1 = p.duration): number[] {
  const out: number[] = []
  for (let m = 0; m < p.periods; m++) {
    const a = m * p.period
    const b = a + p.duty * p.period
    if (a > t0 && a < t1) out.push(a)
    if (b > t0 && b < t1) out.push(b)
  }
  return out
}

/** Region of the B–H curve for a flux linkage. */
export const regionOf = (p: ResolvedCore, lam: number) => (lam > p.lamS ? 'sat+' : lam < -p.lamS ? 'sat−' : 'lin')

/** Winding current i(λ) = a·λ + c in a region (continuous at ±λs). */
export function currentCoeffs(p: ResolvedCore, mode: string): { a: number; c: number } {
  if (mode === 'lin') return { a: 1 / p.l1, c: 0 }
  const c = p.lamS * (1 / p.l1 - 1 / p.l2)
  return { a: 1 / p.l2, c: mode === 'sat+' ? c : -c }
}
export const currentOf = (p: ResolvedCore, lam: number) => {
  const k = currentCoeffs(p, regionOf(p, lam))
  return k.a * lam + k.c
}

/** Core field strength H [A/m] from B. */
export function hCoreOf(p: ResolvedCore, b: number): number {
  const hs = p.bsat / (MU0 * p.mur)
  if (Math.abs(b) <= p.bsat) return b / (MU0 * p.mur)
  return Math.sign(b) * (hs + (Math.abs(b) - p.bsat) / (MU0 * p.musat))
}

/** The winding as a PWL system. With `integrals` the state carries ∫i dt and ∫λ dt (exact means). */
export function coreSystem(p: ResolvedCore, integrals = false, breakpoints = coreBreakpoints(p)): PwlSystem {
  return {
    n: integrals ? 3 : 1,
    breakpoints,
    mode: (x) => regionOf(p, x[0]),
    sys(mode, t) {
      const { a, c } = currentCoeffs(p, mode)
      const v = voltageAt(p, t)
      if (!integrals) return { A: [[-p.r * a]], b: [v - p.r * c] }
      return {
        A: [
          [-p.r * a, 0, 0],
          [a, 0, 0],
          [1, 0, 0],
        ],
        b: [v - p.r * c, c, 0],
      }
    },
  }
}

export type CoreRun = Run<ResolvedCore> & { modes: string[]; pwlEvents: PwlEvent[]; knots: PwlResult['knots'] }

/** Newton shooting on a scalar one-period map. */
export function periodicFlux(map: (lam: number) => number, guess: number, scale: number): { lam: number; iterations: number; residual: number } {
  let x = guess
  let residual = Infinity
  let it = 0
  for (; it < 40; it++) {
    const fx = map(x) - x
    residual = Math.abs(fx) / scale
    if (residual < 1e-12) break
    const h = 1e-7 * scale
    const d = (map(x + h) - (x + h) - fx) / h
    if (!(Math.abs(d) > 0)) break
    let step = -fx / d
    // a saturated core makes the map very flat: limit each step to the unsaturated scale
    if (Math.abs(step) > 4 * scale) step = Math.sign(step) * 4 * scale
    x += step
  }
  return { lam: x, iterations: it, residual }
}

/** Periodic steady state of the flux: the mean current is (2d − 1)·V/R, the flux follows from the volt-seconds. */
export function steadyGuess(p: ResolvedCore): number {
  const idc = ((2 * p.duty - 1) * p.vdc) / p.r
  // start of the period = the most negative flux of the cycle (just before the +V interval)
  const lamDc = Math.abs(idc) * p.l1 <= p.lamS ? idc * p.l1 : Math.sign(idc) * (p.lamS + (Math.abs(idc) - p.lamS / p.l1) * p.l2)
  return lamDc - 0.5 * p.vdc * p.duty * p.period
}

export function simulateCore(input: Partial<CoreParams>): CoreRun {
  const started = performance.now()
  const { params: p, issues } = resolveCore(input)
  let lam0 = 0
  let steady: CoreRun['diagnostics']['steady'] = { method: 'startup', iterations: 0, residual: NaN, converged: false }
  if (p.view === 'steady') {
    const sys1 = coreSystem(p, false, coreBreakpoints(p, 0, p.period))
    const map = (x: number) => simulatePwl(sys1, [x], 0, p.period, p.stepsPerPeriod, regionOf(p, x)).x[0][p.stepsPerPeriod]
    const sh = periodicFlux(map, steadyGuess(p), Math.max(p.lamS, p.vdc * p.period))
    lam0 = sh.lam
    steady = { method: 'shooting', iterations: sh.iterations, residual: sh.residual, converged: sh.residual < 1e-9 }
  }
  const sys = coreSystem(p)
  const steps = p.periods * p.stepsPerPeriod
  const res = simulatePwl(sys, [lam0], 0, p.duration, steps, regionOf(p, lam0))
  const n = steps + 1
  const names = ['v', 'i', 'lam', 'b', 'h', 'vl', 'linc']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  for (let k = 0; k < n; k++) {
    const lam = res.x[0][k]
    const t = res.t[k]
    const vt = voltageAt(p, k > 0 ? t - p.dt * 1e-6 : 0)
    const i = currentOf(p, lam)
    const b = lam / (p.n * p.ae)
    s.v[k] = vt
    s.i[k] = i
    s.lam[k] = lam
    s.b[k] = b
    s.h[k] = hCoreOf(p, b)
    s.vl[k] = vt - p.r * i
    s.linc[k] = res.modes[k] === 'lin' ? p.l1 : p.l2
  }
  if (p.view === 'startup') {
    // settled when the last two periods start at the same flux (relative to the flux swing)
    const spp = p.stepsPerPeriod
    const a = s.lam[(p.periods - 1) * spp]
    const b = s.lam[(p.periods - 2) * spp]
    const residual = Math.abs(a - b) / Math.max(p.vdc * p.duty * p.period, 1e-12)
    steady = { method: 'startup', iterations: 0, residual, converged: residual < 2e-3 }
  }
  const events: RunEvent[] = []
  let seq = 0
  // an event's values are the state AT its instant: the simulator's exact state there (a knot) when it has one,
  // else the nearest sample's flux; the bridge voltage is the one applied from that instant on
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const kn = res.knots.find((x) => Math.abs(x.t - t) <= 1e-9 * p.dt)
    const lam = kn ? kn.x[0] : s.lam[Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))]
    const b = lam / (p.n * p.ae)
    events.push({ id: `c${seq++}`, kind, time: t, device, values: { i: currentOf(p, lam), b, v: voltageAt(p, t + p.dt * 1e-6) } })
  }
  const satEvents = res.events.filter((e) => e.from !== e.to)
  if (p.view === 'steady')
    for (let m = 0; m < p.periods; m++) {
      if (m > 0) ev('gate-on', m * p.period, '+V')
      ev('gate-off', (m + p.duty) * p.period, '−V')
    }
  // every entry into and exit from saturation (a start-up's inrush saturates and recovers several times)
  for (const x of satEvents) ev('mode', x.t, `${x.from}→${x.to}`)
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'core',
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

export interface CoreMeasurements {
  /** Last period. */
  iMax: number
  iMin: number
  ipk: number
  idc: number
  irms: number
  bMax: number
  bMin: number
  bpk: number
  dB: number
  bdc: number
  /** Fraction of the period spent saturated. */
  satFrac: number
  /** Measured inductance Δλ/Δi over the last period (= L1 when the core never saturates). */
  lMeas: number
  pcu: number
  /** Whole run (start-up). */
  iPeakRun: number
  tSat: number | null
  settled: boolean
  saturated: boolean
}

/** Time spent saturated in [t0, t1] from the mode at t0 and the mode changes (the same rule for the theory). */
export function satTime(events: PwlEvent[], mode0: string, t0: number, t1: number): number {
  let mode = mode0
  let t = t0
  let acc = 0
  for (const e of events) {
    if (e.t <= t0 || e.t > t1) continue
    if (mode !== 'lin') acc += e.t - t
    t = e.t
    mode = e.to
  }
  if (mode !== 'lin') acc += t1 - t
  return acc
}

export function measureCore(r: CoreRun): CoreMeasurements {
  const p = r.params
  const s = r.signals
  const spp = p.stepsPerPeriod
  const k0 = (p.periods - 1) * spp
  const k1 = p.periods * spp
  const tA = r.time[k0]
  const tB = r.time[k1]
  // samples plus the simulator's states at the edges and region changes between them
  const pts: Array<{ t: number; lam: number }> = []
  let j = 0
  for (let k = k0; k <= k1; k++) {
    pts.push({ t: r.time[k], lam: s.lam[k] })
    if (k === k1) break
    while (j < r.knots.length && r.knots[j].t <= r.time[k]) j++
    for (; j < r.knots.length && r.knots[j].t < r.time[k + 1]; j++) pts.push({ t: r.knots[j].t, lam: r.knots[j].x[0] })
  }
  let iInt = 0
  let i2 = 0
  let lamInt = 0
  let iMax = -Infinity
  let iMin = Infinity
  let lMax = -Infinity
  let lMin = Infinity
  for (let q = 0; q < pts.length; q++) {
    const i = currentOf(p, pts[q].lam)
    iMax = Math.max(iMax, i)
    iMin = Math.min(iMin, i)
    lMax = Math.max(lMax, pts[q].lam)
    lMin = Math.min(lMin, pts[q].lam)
    if (q > 0) {
      const h = pts[q].t - pts[q - 1].t
      const i0 = currentOf(p, pts[q - 1].lam)
      iInt += 0.5 * (i0 + i) * h
      i2 += 0.5 * (i0 * i0 + i * i) * h
      lamInt += 0.5 * (pts[q - 1].lam + pts[q].lam) * h
    }
  }
  const T = tB - tA
  const na = p.n * p.ae
  const irms = Math.sqrt(i2 / T)
  let iPeakRun = 0
  for (let k = 0; k < r.length; k++) iPeakRun = Math.max(iPeakRun, Math.abs(s.i[k]))
  for (const kn of r.knots) iPeakRun = Math.max(iPeakRun, Math.abs(currentOf(p, kn.x[0])))
  const firstSat = r.pwlEvents.find((e) => e.to !== 'lin')
  const mode0 = r.modes[k0]
  const sat = satTime(r.pwlEvents, mode0, tA, tB) / T
  return {
    iMax,
    iMin,
    ipk: Math.max(Math.abs(iMax), Math.abs(iMin)),
    idc: iInt / T,
    irms,
    bMax: lMax / na,
    bMin: lMin / na,
    bpk: Math.max(Math.abs(lMax), Math.abs(lMin)) / na,
    dB: (lMax - lMin) / na,
    bdc: lamInt / T / na,
    satFrac: sat,
    lMeas: (lMax - lMin) / Math.max(iMax - iMin, 1e-30),
    pcu: p.r * irms * irms,
    iPeakRun,
    tSat: firstSat ? firstSat.t : null,
    settled: r.diagnostics.steady.converged,
    saturated: sat > 0 || r.pwlEvents.some((e) => e.to !== 'lin' && e.t > tA),
  }
}
