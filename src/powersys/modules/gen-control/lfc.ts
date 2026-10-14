/*
 * Two-area load-frequency control, linearised, per unit on ONE common base S_base for both areas (so the tie-line
 * power leaving area 1 is exactly the power entering area 2: a₁₂ = −1). Inside the model Δf is in pu of f₀; it is
 * converted to Hz for display. Per area i (j = the other area):
 *
 *   inertia + load        2H_i · dΔf_i/dt = ΔP_mi − ΔP_Li − D_i·Δf_i − ΔP_tie,i        (ΔP_tie,1 = ΔP_tie12, ΔP_tie,2 = −ΔP_tie12)
 *   governor (droop R_i)  T_g · dΔP_vi/dt = ΔP_ref,i − Δf_i/R_i − ΔP_vi
 *   non-reheat turbine    T_t · dΔP_mi/dt = ΔP_vi − ΔP_mi
 *   AGC (integral)        dΔP_ref,i/dt   = −K_I · ACE_i,   ACE_i = ΔP_tie,i + B_i·Δf_i,   B_i = k_B·β_i,  β_i = D_i + 1/R_i
 *   tie line              dΔP_tie12/dt   = 2π·T₁₂·(Δf₁ − Δf₂)   with Δf in Hz (= 2π·T₁₂·f₀·(Δf₁ − Δf₂) with Δf in pu)
 *
 * Units: H [s] on the common base, D [pu power / pu frequency], R [pu frequency / pu power], T_g, T_t [s], K_I [1/s],
 * T₁₂ [pu power per electrical radian] (the synchronising coefficient of the tie line: ∂P_tie/∂(δ₁ − δ₂)),
 * ΔP_L [pu, a step at t = 0], f₀ [Hz]. Sign convention: ΔP_tie12 > 0 means power flows from area 1 to area 2.
 *
 * Assumes: small deviations about an operating point (linear), each area's machines swing together (one equivalent
 * machine per area), a lossless tie line, non-reheat turbines as one first-order lag, no governor dead band or rate
 * limits, no load shedding. Integrated with RK4 at a fixed step (10 ms by default).
 */

export interface AreaParams {
  /** inertia constant [s] on the common base */
  H: number
  /** load damping [pu/pu] */
  D: number
  /** droop [pu/pu] */
  R: number
  /** governor time constant [s] */
  Tg: number
  /** turbine time constant [s] */
  Tt: number
}

export interface LfcParams {
  f0: number
  /** the common base [MW] (for display in MW only) */
  sBase: number
  a1: AreaParams
  a2: AreaParams
  /** tie-line synchronising coefficient [pu/rad]; 0 = no tie line (two islands) */
  T12: number
  /** load steps at t = 0 [pu] */
  dPL1: number
  dPL2: number
  agc1: boolean
  agc2: boolean
  /** AGC integral gain [1/s] */
  Ki: number
  /** frequency bias B_i = kB · β_i (kB = 1: the "natural" bias) */
  kB: number
}

export const AREA0: AreaParams = { H: 5, D: 1, R: 0.05, Tg: 0.2, Tt: 0.5 }
export const LFC0: LfcParams = { f0: 50, sBase: 1000, a1: AREA0, a2: AREA0, T12: 0.03, dPL1: 0.1, dPL2: 0, agc1: false, agc2: false, Ki: 0.1, kB: 1 }

/** β = D + 1/R, the area frequency response characteristic [pu/pu]. */
export const beta = (a: AreaParams) => a.D + 1 / a.R
export const bias1 = (p: LfcParams) => p.kB * beta(p.a1)
export const bias2 = (p: LfcParams) => p.kB * beta(p.a2)

/** Initial rate of change of frequency of area i [Hz/s] — before governors or the tie line have acted. */
export const rocof0 = (dPL: number, H: number, f0: number) => (-dPL * f0) / (2 * H)

/** The state: Δf₁ [pu], ΔP_m1, ΔP_v1, ΔP_ref1, Δf₂ [pu], ΔP_m2, ΔP_v2, ΔP_ref2, ΔP_tie12 (all powers in pu). */
export type LfcState = [number, number, number, number, number, number, number, number, number]
export const N_STATE = 9

export function derivative(p: LfcParams, x: LfcState): LfcState {
  const [f1, m1, v1, r1, f2, m2, v2, r2, tie] = x
  const { a1, a2 } = p
  const ace1 = tie + bias1(p) * f1
  const ace2 = -tie + bias2(p) * f2
  return [
    (m1 - p.dPL1 - a1.D * f1 - tie) / (2 * a1.H),
    (v1 - m1) / a1.Tt,
    (r1 - f1 / a1.R - v1) / a1.Tg,
    p.agc1 ? -p.Ki * ace1 : 0,
    (m2 - p.dPL2 - a2.D * f2 + tie) / (2 * a2.H),
    (v2 - m2) / a2.Tt,
    (r2 - f2 / a2.R - v2) / a2.Tg,
    p.agc2 ? -p.Ki * ace2 : 0,
    2 * Math.PI * p.T12 * p.f0 * (f1 - f2),
  ]
}

function rk4(p: LfcParams, x: LfcState, h: number): LfcState {
  const k1 = derivative(p, x)
  const y = x.slice() as LfcState
  for (let j = 0; j < N_STATE; j++) y[j] = x[j] + (h / 2) * k1[j]
  const k2 = derivative(p, y)
  for (let j = 0; j < N_STATE; j++) y[j] = x[j] + (h / 2) * k2[j]
  const k3 = derivative(p, y)
  for (let j = 0; j < N_STATE; j++) y[j] = x[j] + h * k3[j]
  const k4 = derivative(p, y)
  const out = x.slice() as LfcState
  for (let j = 0; j < N_STATE; j++) out[j] = x[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])
  return out
}

export interface LfcRun {
  t: number[]
  /** Δf [Hz] */
  df1: number[]
  df2: number[]
  /** ΔP_tie12 [pu], + = area 1 → area 2 */
  tie: number[]
  /** ACE [pu] */
  ace1: number[]
  ace2: number[]
  /** extra mechanical power [pu] */
  pm1: number[]
  pm2: number[]
  /** AGC set-point changes [pu] */
  pref1: number[]
  pref2: number[]
  /** simulated initial RoCoF (first step) [Hz/s] */
  rocof1: number
  rocof2: number
  /** lowest Δf [Hz] (over every step) and when */
  nadir1: number
  tNadir1: number
  nadir2: number
  tNadir2: number
  /** the largest |ΔP_tie12| reached [pu] (signed) and when */
  tiePeak: number
  tTiePeak: number
  /** the final state */
  end: { df1: number; df2: number; tie: number; pm1: number; pm2: number; ace1: number; ace2: number; pref1: number; pref2: number }
  /** false if the run grew without bound (it is stopped and marked) */
  bounded: boolean
  /** did every output stop changing over the last 15 % of the run (to within 1 % of its range)? */
  settled: boolean
  /**
   * From the simulation alone: does the deviation from the closed-form steady state shrink or grow? (largest
   * deviation in the last 30 % of the run against the 30 % before it). 'growing' = an unstable oscillation.
   */
  trend: 'decaying' | 'growing'
  envRatio: number
  h: number
  tEnd: number
}

/** Integrate the two-area model from rest for a load step at t = 0. Samples are kept every `keepEvery` steps. */
export function simulateLfc(p: LfcParams, opt: { tEnd?: number; h?: number; keepEvery?: number } = {}): LfcRun {
  const tEnd = opt.tEnd ?? 60
  const h = opt.h ?? 0.01
  const keep = Math.max(1, opt.keepEvery ?? 1)
  const n = Math.round(tEnd / h)
  const out: LfcRun = {
    t: [],
    df1: [],
    df2: [],
    tie: [],
    ace1: [],
    ace2: [],
    pm1: [],
    pm2: [],
    pref1: [],
    pref2: [],
    rocof1: NaN,
    rocof2: NaN,
    nadir1: 0,
    tNadir1: 0,
    nadir2: 0,
    tNadir2: 0,
    tiePeak: 0,
    tTiePeak: 0,
    end: { df1: 0, df2: 0, tie: 0, pm1: 0, pm2: 0, ace1: 0, ace2: 0, pref1: 0, pref2: 0 },
    bounded: true,
    settled: false,
    trend: 'decaying',
    envRatio: 0,
    h,
    tEnd,
  }
  const B1 = bias1(p)
  const B2 = bias2(p)
  const push = (t: number, x: LfcState) => {
    out.t.push(t)
    out.df1.push(x[0] * p.f0)
    out.df2.push(x[4] * p.f0)
    out.tie.push(x[8])
    out.ace1.push(x[8] + B1 * x[0])
    out.ace2.push(-x[8] + B2 * x[4])
    out.pm1.push(x[1])
    out.pm2.push(x[5])
    out.pref1.push(x[3])
    out.pref2.push(x[7])
  }
  let x: LfcState = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  push(0, x)
  // anything beyond this is not a small deviation any more: the run has diverged
  const limit = 50 * Math.max(Math.abs(p.dPL1) + Math.abs(p.dPL2), 1e-3)
  let last = x
  let tLast = 0
  for (let i = 1; i <= n; i++) {
    x = rk4(p, x, h)
    const t = i * h
    if (i === 1) {
      out.rocof1 = (x[0] * p.f0) / h
      out.rocof2 = (x[4] * p.f0) / h
    }
    const f1 = x[0] * p.f0
    const f2 = x[4] * p.f0
    if (f1 < out.nadir1) {
      out.nadir1 = f1
      out.tNadir1 = t
    }
    if (f2 < out.nadir2) {
      out.nadir2 = f2
      out.tNadir2 = t
    }
    if (Math.abs(x[8]) > Math.abs(out.tiePeak)) {
      out.tiePeak = x[8]
      out.tTiePeak = t
    }
    last = x
    tLast = t
    if (!x.every((v) => Number.isFinite(v) && Math.abs(v) < limit)) {
      out.bounded = false
      break
    }
    if (i % keep === 0 || i === n) push(t, x)
  }
  if (out.t[out.t.length - 1] !== tLast && out.bounded) push(tLast, last)
  const k = out.t.length - 1
  out.end = { df1: out.df1[k], df2: out.df2[k], tie: out.tie[k], pm1: out.pm1[k], pm2: out.pm2[k], ace1: out.ace1[k], ace2: out.ace2[k], pref1: out.pref1[k], pref2: out.pref2[k] }
  if (out.bounded) {
    const from = out.t.findIndex((t) => t >= 0.85 * tEnd)
    const still = (s: number[], scale: number) => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = from; i < s.length; i++) {
        lo = Math.min(lo, s[i])
        hi = Math.max(hi, s[i])
      }
      return hi - lo <= 0.01 * scale + 1e-9
    }
    const fScale = Math.max(Math.abs(out.nadir1), Math.abs(out.nadir2), 1e-6)
    const pScale = Math.max(Math.abs(p.dPL1), Math.abs(p.dPL2), 1e-6)
    out.settled = from >= 0 && still(out.df1, fScale) && still(out.df2, fScale) && still(out.tie, pScale) && still(out.pm1, pScale) && still(out.pm2, pScale)
  }
  // growth: deviation from the closed-form steady state, Δf₁ (per unit of the dip) and the tie (per unit of the step)
  const ss = steadyState(p)
  const fS = Math.max(Math.abs(out.nadir1), Math.abs(out.nadir2), 1e-9)
  const pS = Math.max(Math.abs(p.dPL1), Math.abs(p.dPL2), 1e-9)
  const tLast2 = out.t[out.t.length - 1]
  const env = (a: number, b: number) => {
    let m = 0
    for (let i = 0; i < out.t.length; i++) {
      if (out.t[i] <= a || out.t[i] > b) continue
      m = Math.max(m, Math.abs(out.df1[i] - ss.df1 * p.f0) / fS, Math.abs(out.df2[i] - ss.df2 * p.f0) / fS, Math.abs(out.tie[i] - ss.tie) / pS)
    }
    return m
  }
  const e1 = env(0.4 * tLast2, 0.7 * tLast2)
  const e2 = env(0.7 * tLast2, tLast2)
  out.envRatio = e1 > 0 ? e2 / e1 : 0
  out.trend = !out.bounded || (e2 > 1e-4 && out.envRatio > 1.05) ? 'growing' : 'decaying'
  return out
}

/** The index of the last sample at or before time x. */
export function indexAt(t: number[], x: number): number {
  let lo = 0
  let hi = t.length - 1
  if (hi < 0) return 0
  if (x >= t[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= x) lo = mid
    else hi = mid
  }
  return lo
}

// ── closed-form steady states ──────────────────────────────────────────────────────────────────────────────────

export interface LfcSteady {
  /** common (or per-area, if islanded) frequency deviation [pu] */
  df1: number
  df2: number
  /** [pu], + = area 1 → area 2 */
  tie: number
  pm1: number
  pm2: number
  /** which formula applies, in words */
  case: 'islanded' | 'primary' | 'agc-both' | 'agc-1' | 'agc-2'
}

/**
 * The steady state the model settles to (if it is stable), in closed form.
 *  · no tie line: each area alone, Δf_i = −ΔP_Li/β_i (or 0 with AGC)
 *  · primary control only: Δf = −(ΔP_L1 + ΔP_L2)/(β₁ + β₂),  ΔP_tie12 = (β₁·ΔP_L2 − β₂·ΔP_L1)/(β₁ + β₂)
 *  · AGC in both areas: Δf = 0, ΔP_tie12 = 0, ΔP_mi = ΔP_Li
 *  · AGC in area 1 only: ACE₁ = 0 ⇒ Δf = −ΔP_L2/(β₂ + B₁), ΔP_tie12 = ΔP_L2 + β₂·Δf (and the mirror for area 2 only)
 */
export function steadyState(p: LfcParams): LfcSteady {
  const b1 = beta(p.a1)
  const b2 = beta(p.a2)
  const B1 = bias1(p)
  const B2 = bias2(p)
  if (p.T12 <= 0) {
    const df1 = p.agc1 ? 0 : -p.dPL1 / b1
    const df2 = p.agc2 ? 0 : -p.dPL2 / b2
    return { df1, df2, tie: 0, pm1: p.dPL1 + p.a1.D * df1, pm2: p.dPL2 + p.a2.D * df2, case: 'islanded' }
  }
  let df: number
  let tie: number
  let c: LfcSteady['case']
  if (p.agc1 && p.agc2) {
    df = 0
    tie = 0
    c = 'agc-both'
  } else if (p.agc1) {
    df = -p.dPL2 / (b2 + B1)
    tie = p.dPL2 + b2 * df
    c = 'agc-1'
  } else if (p.agc2) {
    df = -p.dPL1 / (b1 + B2)
    tie = -p.dPL1 - b1 * df
    c = 'agc-2'
  } else {
    df = -(p.dPL1 + p.dPL2) / (b1 + b2)
    tie = (b1 * p.dPL2 - b2 * p.dPL1) / (b1 + b2)
    c = 'primary'
  }
  // each area's power balance: ΔP_mi = ΔP_Li + D_i·Δf ± ΔP_tie
  return { df1: df, df2: df, tie, pm1: p.dPL1 + p.a1.D * df + tie, pm2: p.dPL2 + p.a2.D * df - tie, case: c }
}

/**
 * The same steady state by a second, independent method: set every derivative of the state equations to zero and
 * solve the 9 × 9 linear system by Gaussian elimination (partial pivoting). Rows whose derivative is identically
 * zero (AGC off: ΔP_ref = 0; no tie line: ΔP_tie = 0) are replaced by that fixed value.
 */
export function steadyStateSolve(p: LfcParams): LfcSteady | null {
  const n = N_STATE
  const A: number[][] = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  const B1 = bias1(p)
  const B2 = bias2(p)
  // row 0: ΔP_m1 − D₁Δf₁ − ΔP_tie = ΔP_L1
  A[0][1] = 1
  A[0][0] = -p.a1.D
  A[0][8] = -1
  A[0][n] = p.dPL1
  // row 1: ΔP_v1 − ΔP_m1 = 0
  A[1][2] = 1
  A[1][1] = -1
  // row 2: ΔP_ref1 − Δf₁/R₁ − ΔP_v1 = 0
  A[2][3] = 1
  A[2][0] = -1 / p.a1.R
  A[2][2] = -1
  // row 3: ACE₁ = 0, or ΔP_ref1 = 0
  if (p.agc1) {
    A[3][8] = 1
    A[3][0] = B1
  } else A[3][3] = 1
  A[4][5] = 1
  A[4][4] = -p.a2.D
  A[4][8] = 1
  A[4][n] = p.dPL2
  A[5][6] = 1
  A[5][5] = -1
  A[6][7] = 1
  A[6][4] = -1 / p.a2.R
  A[6][6] = -1
  if (p.agc2) {
    A[7][8] = -1
    A[7][4] = B2
  } else A[7][7] = 1
  // row 8: Δf₁ = Δf₂ (tie line present), or ΔP_tie = 0
  if (p.T12 > 0) {
    A[8][0] = 1
    A[8][4] = -1
  } else A[8][8] = 1
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-14) return null
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      if (f !== 0) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]
    }
  }
  const x = A.map((row, i) => row[n] / row[i])
  return { df1: x[0], df2: x[4], tie: x[8], pm1: x[1], pm2: x[5], case: p.T12 <= 0 ? 'islanded' : p.agc1 && p.agc2 ? 'agc-both' : p.agc1 ? 'agc-1' : p.agc2 ? 'agc-2' : 'primary' }
}

/** Natural frequency of the tie-line (inter-area) swing with governors ignored: ω² = 2πT₁₂f₀·(1/2H₁ + 1/2H₂) [rad/s]. */
export const interAreaOmega = (p: LfcParams) => Math.sqrt(2 * Math.PI * p.T12 * p.f0 * (1 / (2 * p.a1.H) + 1 / (2 * p.a2.H)))

/** Every output of a run at one kept sample. */
export interface LfcSnap {
  t: number
  /** [Hz] */
  df1: number
  df2: number
  /** [pu] */
  tie: number
  pm1: number
  pm2: number
  ace1: number
  ace2: number
}
export const snapAt = (r: LfcRun, i: number): LfcSnap => {
  const k = Math.max(0, Math.min(r.t.length - 1, i))
  return { t: r.t[k], df1: r.df1[k], df2: r.df2[k], tie: r.tie[k], pm1: r.pm1[k], pm2: r.pm2[k], ace1: r.ace1[k], ace2: r.ace2[k] }
}

/**
 * How the tie-line flow approaches its closed-form final value — measures that do not depend on how long the run
 * is (as long as it reaches them):
 *  · firstPeak: the FIRST local extremum of ΔP_tie12 (null when it rises monotonically: no overshoot);
 *  · overshootPct: how far that first peak goes past the final value [% of |final|];
 *  · period: the damped period from successive extrema [s] (NaN with fewer than two extrema);
 *  · t90: the first time |ΔP_tie12| reaches 90 % of |final| [s];
 *  · tSettle: the time after which ΔP_tie12 stays within 2 % of the final value [s] (NaN if not within the run).
 * Extrema closer to the final value than 0.2 % of it are ignored (the numerical tail of a monotonic approach).
 */
export interface TieDynamics {
  final: number
  firstPeak: { t: number; v: number } | null
  overshootPct: number
  period: number
  t90: number
  tSettle: number
}

export function tieDynamics(r: LfcRun, final: number): TieDynamics {
  const x = r.tie
  const t = r.t
  const F = Math.abs(final)
  const ext: Array<{ t: number; v: number }> = []
  let dir = 0
  for (let i = 1; i < x.length; i++) {
    const d = x[i] - x[i - 1]
    if (Math.abs(d) < 1e-13) continue
    const s = Math.sign(d)
    if (dir !== 0 && s !== dir && Math.abs(x[i - 1] - final) > 0.002 * F + 1e-12) ext.push({ t: t[i - 1], v: x[i - 1] })
    dir = s
  }
  const firstPeak = ext[0] ?? null
  const overshootPct = firstPeak && Math.sign(firstPeak.v) === Math.sign(final) && Math.abs(firstPeak.v) > F ? ((Math.abs(firstPeak.v) - F) / F) * 100 : 0
  const period = ext.length >= 3 ? ext[2].t - ext[0].t : ext.length === 2 ? 2 * (ext[1].t - ext[0].t) : NaN
  let t90 = NaN
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]) >= 0.9 * F && F > 0) {
      t90 = t[i]
      break
    }
  let last = -1
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - final) > 0.02 * F) last = i
  const tSettle = last < 0 ? 0 : last < x.length - 1 ? t[last + 1] : NaN
  return { final, firstPeak, overshootPct, period, t90, tSettle }
}
