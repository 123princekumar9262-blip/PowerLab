/*
 * Weighted-least-squares state estimation on a small teaching network — what a control centre's EMS does with the
 * measurements SCADA brings in.
 *
 * Model (stated on screen): three buses joined by three lossless lines, DC approximation (flat voltage magnitudes of
 * 1 pu, small angle differences, resistance neglected): the flow i→j is P_ij = (θ_i − θ_j)/x_ij. Bus 1 is the angle
 * reference (θ₁ = 0), so the state is x = [θ₂, θ₃]. Measurements: the three line flows, the three bus injections and,
 * optionally, a PMU measuring θ₃ (relative to a PMU at bus 1, both GPS-time-stamped). The model is linear, z = Hx + e,
 * so the WLS estimate is x̂ = (HᵀWH)⁻¹HᵀWz with W = R⁻¹ = diag(1/σ²).
 *
 * Bad data: the residuals r = z − Hx̂ have covariance Ω = R − H G⁻¹ Hᵀ. The normalised residual r_N,i = |r_i|/√Ω_ii;
 * the largest-normalised-residual test flags the measurement with the largest r_N if it exceeds a threshold (3 here,
 * a common textbook choice). The chi-square test compares J(x̂) = Σ r_i²/σ_i² with the χ² value for m − n degrees of
 * freedom at 99 % confidence. A measurement with Ω_ii = 0 is critical (its error never shows in any residual); two
 * whose Ω columns are parallel form a critical pair (an error in either looks the same).
 */

export const BASE_MVA = 100
/** Line reactances [pu on 100 MVA] — illustrative values. */
export const NET = { x12: 0.1, x13: 0.25, x23: 0.2 }
/** True net injections [pu] at buses 2 and 3 (loads, negative); bus 1 (generation) supplies the rest. */
export const TRUE_P = { p2: -0.9, p3: -0.6 }

export type MeasId = 'P12' | 'P13' | 'P23' | 'P1' | 'P2' | 'P3' | 'TH3'
export const MEAS_IDS: MeasId[] = ['P12', 'P13', 'P23', 'P1', 'P2', 'P3', 'TH3']
export interface MeasDef {
  id: MeasId
  name: string
  kind: 'flow' | 'injection' | 'angle'
  /** Where it is drawn: a line (from, to) or a bus. */
  at: { line?: [1 | 2 | 3, 1 | 2 | 3]; bus?: 1 | 2 | 3 }
  /** Its row of H for the state [θ₂, θ₃] (radians → pu power, or radians). */
  row: [number, number]
}
export function measDefs(net = NET): Record<MeasId, MeasDef> {
  const b12 = 1 / net.x12
  const b13 = 1 / net.x13
  const b23 = 1 / net.x23
  return {
    P12: { id: 'P12', name: 'Flow 1→2', kind: 'flow', at: { line: [1, 2] }, row: [-b12, 0] },
    P13: { id: 'P13', name: 'Flow 1→3', kind: 'flow', at: { line: [1, 3] }, row: [0, -b13] },
    P23: { id: 'P23', name: 'Flow 2→3', kind: 'flow', at: { line: [2, 3] }, row: [b23, -b23] },
    P1: { id: 'P1', name: 'Injection at bus 1', kind: 'injection', at: { bus: 1 }, row: [-b12, -b13] },
    P2: { id: 'P2', name: 'Injection at bus 2', kind: 'injection', at: { bus: 2 }, row: [b12 + b23, -b23] },
    P3: { id: 'P3', name: 'Injection at bus 3', kind: 'injection', at: { bus: 3 }, row: [-b23, b13 + b23] },
    TH3: { id: 'TH3', name: 'Angle θ₃ (PMU)', kind: 'angle', at: { bus: 3 }, row: [0, 1] },
  }
}

/** The true state: a DC load flow, B′θ = P for buses 2 and 3. */
export function trueState(net = NET, p = TRUE_P): [number, number] {
  const b12 = 1 / net.x12
  const b13 = 1 / net.x13
  const b23 = 1 / net.x23
  const a = b12 + b23
  const b = -b23
  const d = b13 + b23
  const det = a * d - b * b
  return [(d * p.p2 - b * p.p3) / det, (a * p.p3 - b * p.p2) / det]
}

// ── small linear algebra (2 × 2 normal matrix) ────────────────────────────────────────────────────────────────

export type Vec2 = [number, number]
export type Mat2 = [[number, number], [number, number]]
export const hx = (row: Vec2, x: Vec2) => row[0] * x[0] + row[1] * x[1]
export function inv2(m: Mat2): Mat2 | null {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
  const scale = Math.abs(m[0][0] * m[1][1]) + Math.abs(m[0][1] * m[1][0])
  if (!(Math.abs(det) > 1e-10 * scale) || !Number.isFinite(det)) return null
  return [
    [m[1][1] / det, -m[0][1] / det],
    [-m[1][0] / det, m[0][0] / det],
  ]
}

// ── noise ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A seeded uniform generator (mulberry32) in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Standard normal samples (Box–Muller) from a seeded generator. */
export function normals(seed: number, n: number): number[] {
  const u = rng(seed)
  const out: number[] = []
  while (out.length < n) {
    const u1 = Math.max(u(), 1e-12)
    const u2 = u()
    const r = Math.sqrt(-2 * Math.log(u1))
    out.push(r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2))
  }
  return out.slice(0, n)
}

// ── chi-square quantile ────────────────────────────────────────────────────────────────────────────────────

function lnGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9), accurate to ~1e-15 for x > 0
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  x -= 1
  let a = c[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i++) a += c[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}
/** Regularised lower incomplete gamma P(a, x) (series below a + 1, continued fraction above). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a))
  }
  // Lentz continued fraction for Q(a, x)
  let b = x + 1 - a
  let c = 1 / 1e-300
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h
}
/** χ² cumulative distribution with k degrees of freedom. */
export const chi2Cdf = (x: number, k: number) => gammaP(k / 2, x / 2)
/** The χ² value exceeded with probability 1 − p (k degrees of freedom), by bisection on the CDF. */
export function chi2Quantile(p: number, k: number): number {
  let lo = 0
  let hi = Math.max(10, k * 10)
  while (chi2Cdf(hi, k) < p) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (chi2Cdf(mid, k) < p) lo = mid
    else hi = mid
    if (hi - lo < 1e-12 * hi) break
  }
  return (lo + hi) / 2
}

// ── the estimator ───────────────────────────────────────────────────────────────────────────────────────────

/** The confidence level of the chi-square test and the normalised-residual threshold. */
export const CHI2_CONF = 0.99
export const LNR_THRESHOLD = 3

export interface MeasIn {
  id: MeasId
  /** Measured value: pu power (flows, injections) or radians (angle). */
  z: number
  /** Standard deviation, in the same unit. */
  sigma: number
}
export interface MeasOut extends MeasIn {
  /** h(x̂): the value the estimate implies. */
  est: number
  r: number
  /** Ω_ii: variance of the residual (0 for a critical measurement). */
  omega: number
  /** Normalised residual |r|/√Ω_ii, or null if critical. */
  rN: number | null
  critical: boolean
}
export type SeOutcome =
  | {
      ok: true
      x: Vec2
      /** Covariance of the estimate, G⁻¹ (rad²). */
      cov: Mat2
      meas: MeasOut[]
      J: number
      dof: number
      chi2: number
      /** J above the χ² value: bad data is suspected. */
      detected: boolean
      /** The measurement with the largest normalised residual, and that value. */
      largest: { id: MeasId; rN: number } | null
      /** The largest normalised residual is above the threshold. */
      flagged: MeasId | null
      /** Pairs of measurements whose residual sensitivities are parallel (an error in either looks the same). */
      pairs: Array<[MeasId, MeasId]>
      /** Measurements whose normalised residual equals the largest one (cannot be told apart). */
      ties: MeasId[]
    }
  | { ok: false; reason: 'unobservable' | 'invalid'; message: string }

export function estimate(ms: MeasIn[], net = NET): SeOutcome {
  if (!ms.every((m) => Number.isFinite(m.z) && Number.isFinite(m.sigma) && m.sigma > 0))
    return { ok: false, reason: 'invalid', message: 'Every measurement needs a finite value and a positive standard deviation.' }
  const defs = measDefs(net)
  const H = ms.map((m) => defs[m.id].row)
  const w = ms.map((m) => 1 / (m.sigma * m.sigma))
  const Gm: Mat2 = [
    [0, 0],
    [0, 0],
  ]
  const t: Vec2 = [0, 0]
  ms.forEach((m, i) => {
    const h = H[i]
    for (let a = 0; a < 2; a++) {
      t[a] += h[a] * w[i] * m.z
      for (let b = 0; b < 2; b++) Gm[a][b] += h[a] * w[i] * h[b]
    }
  })
  const Gi = inv2(Gm)
  if (!Gi)
    return {
      ok: false,
      reason: 'unobservable',
      message:
        ms.length < 2
          ? `Only ${ms.length} measurement${ms.length === 1 ? '' : 's'} for two unknown angles: the state cannot be found (unobservable).`
          : 'These measurements do not pin down both bus angles (the gain matrix HᵀWH is singular): the network is unobservable. Add a measurement that involves the missing angle.',
    }
  const x: Vec2 = [Gi[0][0] * t[0] + Gi[0][1] * t[1], Gi[1][0] * t[0] + Gi[1][1] * t[1]]
  const meas: MeasOut[] = ms.map((m, i) => {
    const h = H[i]
    const est = hx(h, x)
    const hGh = h[0] * (Gi[0][0] * h[0] + Gi[0][1] * h[1]) + h[1] * (Gi[1][0] * h[0] + Gi[1][1] * h[1])
    const s2 = m.sigma * m.sigma
    const omega = Math.max(0, s2 - hGh)
    const critical = omega < 1e-9 * s2
    const r = m.z - est
    return { ...m, est, r, omega, rN: critical ? null : Math.abs(r) / Math.sqrt(omega), critical }
  })
  const J = meas.reduce((s, m) => s + (m.r * m.r) / (m.sigma * m.sigma), 0)
  const dof = ms.length - 2
  const chi2 = dof > 0 ? chi2Quantile(CHI2_CONF, dof) : NaN
  // Ω_ij = R_ij − h_i G⁻¹ h_jᵀ; parallel columns ⇔ |ρ_ij| = 1
  const omegaIJ = (i: number, j: number) => {
    const a = H[i]
    const b = H[j]
    const v = a[0] * (Gi[0][0] * b[0] + Gi[0][1] * b[1]) + a[1] * (Gi[1][0] * b[0] + Gi[1][1] * b[1])
    return (i === j ? ms[i].sigma ** 2 : 0) - v
  }
  const pairs: Array<[MeasId, MeasId]> = []
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++) {
      if (meas[i].critical || meas[j].critical) continue
      const rho = omegaIJ(i, j) / Math.sqrt(meas[i].omega * meas[j].omega)
      if (Math.abs(rho) > 1 - 1e-7) pairs.push([ms[i].id, ms[j].id])
    }
  const nonCrit = meas.filter((m) => m.rN !== null)
  const top = nonCrit.reduce<MeasOut | null>((b, m) => (b === null || (m.rN as number) > (b.rN as number) ? m : b), null)
  const largest = top ? { id: top.id, rN: top.rN as number } : null
  const ties = largest ? nonCrit.filter((m) => Math.abs((m.rN as number) - largest.rN) <= 1e-6 * Math.max(1, largest.rN)).map((m) => m.id) : []
  return {
    ok: true,
    x,
    cov: Gi,
    meas,
    J,
    dof,
    chi2,
    detected: dof > 0 && J > chi2,
    largest,
    flagged: largest && largest.rN > LNR_THRESHOLD ? largest.id : null,
    pairs,
    ties,
  }
}

/** J(x) = Σ (z_i − h_i x)²/σ_i² for any state x. */
export function objective(ms: MeasIn[], x: Vec2, net = NET): number {
  const defs = measDefs(net)
  return ms.reduce((s, m) => {
    const r = m.z - hx(defs[m.id].row, x)
    return s + (r * r) / (m.sigma * m.sigma)
  }, 0)
}

/**
 * A second, independent method: minimise J(x) directly, using only evaluations of J — no normal equations are formed.
 * Newton steps whose gradient and Hessian come from central differences of J (exact for a quadratic, up to rounding),
 * then coordinate sweeps where each line step fits a parabola through three values of J.
 */
export function minimiseJ(ms: MeasIn[], net = NET, x0: Vec2 = [0, 0]): { x: Vec2; sweeps: number } {
  const J = (a: number, b: number) => objective(ms, [a, b], net)
  let x: Vec2 = [x0[0], x0[1]]
  const h = 0.05
  for (let it = 0; it < 6; it++) {
    const [a, b] = x
    const f0 = J(a, b)
    const fa = [J(a + h, b), J(a - h, b)]
    const fb = [J(a, b + h), J(a, b - h)]
    const g: Vec2 = [(fa[0] - fa[1]) / (2 * h), (fb[0] - fb[1]) / (2 * h)]
    const haa = (fa[0] - 2 * f0 + fa[1]) / (h * h)
    const hbb = (fb[0] - 2 * f0 + fb[1]) / (h * h)
    const hab = (J(a + h, b + h) - J(a + h, b - h) - J(a - h, b + h) + J(a - h, b - h)) / (4 * h * h)
    const Hi = inv2([
      [haa, hab],
      [hab, hbb],
    ])
    if (!Hi) break
    const step: Vec2 = [Hi[0][0] * g[0] + Hi[0][1] * g[1], Hi[1][0] * g[0] + Hi[1][1] * g[1]]
    x = [a - step[0], b - step[1]]
    if (Math.max(Math.abs(step[0]), Math.abs(step[1])) < 1e-15) break
  }
  let sweeps = 0
  for (; sweeps < 200; sweeps++) {
    let moved = 0
    for (let k = 0; k < 2; k++) {
      const at = (v: number) => (k === 0 ? J(v, x[1]) : J(x[0], v))
      const f0 = at(x[k])
      const fp = at(x[k] + h)
      const fm = at(x[k] - h)
      const curv = fp - 2 * f0 + fm
      if (!(curv > 0)) continue
      const step = (-h * (fp - fm)) / (2 * curv)
      x[k] += step
      moved = Math.max(moved, Math.abs(step))
    }
    if (moved < 1e-15) break
  }
  return { x, sweeps }
}

// ── the lab's measurement set ─────────────────────────────────────────────────────────────────────────────────

/** Illustrative meter accuracies: σ in MW for power meters, in degrees for the PMU angle. */
export const SIGMA0 = { flowMw: 1, injMw: 2, angleDeg: 0.05 }
export interface LabState {
  enabled: Record<MeasId, boolean>
  sigma: { flowMw: number; injMw: number; angleDeg: number }
  noise: boolean
  seed: number
  /** A gross error added to one measurement (MW, or degrees for the angle). */
  bad: { id: MeasId; size: number } | null
}
export const LAB0: LabState = {
  enabled: { P12: true, P13: true, P23: true, P1: true, P2: true, P3: true, TH3: false },
  sigma: SIGMA0,
  noise: true,
  seed: 7,
  bad: null,
}
export const DEG = Math.PI / 180
/** σ of a measurement in model units (pu or rad). */
export function sigmaOf(id: MeasId, s: LabState['sigma'], net = NET): number {
  const k = measDefs(net)[id].kind
  return k === 'flow' ? s.flowMw / BASE_MVA : k === 'injection' ? s.injMw / BASE_MVA : s.angleDeg * DEG
}
/** True value of every measurement (pu or rad). */
export function trueValues(net = NET): Record<MeasId, number> {
  const x = trueState(net)
  const defs = measDefs(net)
  return Object.fromEntries(MEAS_IDS.map((id) => [id, hx(defs[id].row, x)])) as Record<MeasId, number>
}
/** The measurements the lab feeds the estimator: true value + seeded noise (σ) + the injected gross error. */
export function labMeasurements(s: LabState, net = NET): MeasIn[] {
  const tv = trueValues(net)
  const e = normals(s.seed, MEAS_IDS.length)
  return MEAS_IDS.filter((id) => s.enabled[id]).map((id) => {
    const sigma = sigmaOf(id, s.sigma, net)
    const k = measDefs(net)[id].kind
    const gross = s.bad && s.bad.id === id ? (k === 'angle' ? s.bad.size * DEG : s.bad.size / BASE_MVA) : 0
    return { id, sigma, z: tv[id] + (s.noise ? sigma * e[MEAS_IDS.indexOf(id)] : 0) + gross }
  })
}
/** Display a model value in its screen unit (MW or degrees). */
export function toScreen(id: MeasId, v: number, net = NET): number {
  return measDefs(net)[id].kind === 'angle' ? v / DEG : v * BASE_MVA
}
export const unitOf = (id: MeasId) => (id === 'TH3' ? '°' : 'MW')
