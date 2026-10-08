import type { Mat } from '../expm.ts'
import { exactPwl, type PwlSystem } from '../pwl.ts'
import { loadOn, periodicTheta, thermalBreakpoints, thermalMatrices, thermalSystem, type ResolvedThermal } from './thermal.ts'

/**
 * THERMAL THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT: the linear thermal network with temperature-dependent losses solved by the matrix exponential
 *    (exactPwl), the periodic steady state as the fixed point of the exact one-cycle map, and period means
 *    from integrals carried as extra states (∫Σθ dt, and ∫Σθ dt while loaded for the mean loss).
 *    Constant load: Tj = (Ta + Rth·(a − 25·b))/(1 − b·Rth) — runaway when b·Rth ≥ 1.
 * 2. TEXTBOOK: Tj = Ta + P·Rth with the loss taken at 25 °C (no feedback), and for a pulse train the
 *    datasheet estimate Tj,max ≈ Ta + δ·P·Rth + (1 − δ)·P·Zth(ton).
 */
export interface ThermalExact {
  tjMax: number
  tjMin: number
  tjMean: number
  dTj: number
  pMean: number
  thsMean: number
  tjPeakRun: number
  t90: number | null
  /** Spectral radius of the one-cycle map (≥ 1: no stable periodic state). */
  rho: number
}

/** The network augmented with ∫Σθ dt and ∫(load on)·Σθ dt. */
function augmented(p: ResolvedThermal, bps: number[]): PwlSystem {
  const n = p.stages.length
  return {
    n: n + 2,
    breakpoints: bps,
    mode: () => 'th',
    sys(_m, t) {
      const on = loadOn(p, t)
      const { A, b } = thermalMatrices(p, on)
      const M: Mat = Array.from({ length: n + 2 }, (_, i) => Array.from({ length: n + 2 }, (_, j) => (i < n && j < n ? A[i][j] : 0)))
      for (let j = 0; j < n; j++) {
        M[n][j] = 1
        M[n + 1][j] = on ? 1 : 0
      }
      return { A: M, b: [...b, 0, 0] }
    },
  }
}

/** Exact statistics of the cycle that starts at θ (cycle index m). */
function cycleStats(p: ResolvedThermal, theta: number[], m: number) {
  const n = p.stages.length
  const t0 = m * p.period
  const t1 = t0 + p.period
  const bps = thermalBreakpoints(p, t0, t1)
  const sys = augmented(p, bps)
  const M = 200
  const times = [...new Set([...Array.from({ length: M }, (_, i) => t0 + ((i + 1) * p.period) / M), ...bps])].sort((a, b) => a - b)
  const ex = exactPwl(sys, [...theta, 0, 0], t0, times, 'th')
  const tjOf = (x: number[]) => p.ta + x.slice(0, n).reduce((a, b) => a + b, 0)
  let tjMax = tjOf(theta)
  let tjMin = tjMax
  for (const x of ex.x) {
    tjMax = Math.max(tjMax, tjOf(x))
    tjMin = Math.min(tjMin, tjOf(x))
  }
  const end = ex.x[ex.x.length - 1]
  const tOn = p.load === 'constant' ? p.period : p.ton
  // mean loss: a·t_on + b·∫_on (Tj − 25) dt
  const pMean = (p.a * tOn + p.b * ((p.ta - 25) * tOn + end[n + 1])) / p.period
  // the heatsink stage's mean (last Foster stage) from a dense trapezoid on the exact samples
  let ths = 0
  let prevT = t0
  let prev = theta[n - 1]
  times.forEach((t, i) => {
    ths += 0.5 * (prev + ex.x[i][n - 1]) * (t - prevT)
    prevT = t
    prev = ex.x[i][n - 1]
  })
  return { tjMax, tjMin, tjMean: p.ta + end[n] / p.period, pMean, thsMean: p.ta + ths / p.period }
}

/** Spectral radius of the one-cycle map (power iteration on the exact map's linear part). */
function cycleRadius(p: ResolvedThermal): number {
  const n = p.stages.length
  const sys = thermalSystem(p, thermalBreakpoints(p, 0, p.period))
  const zero = exactPwl(sys, new Array(n).fill(0), 0, [p.period], 'th').x[0]
  const lin = (x: number[]) => exactPwl(sys, x, 0, [p.period], 'th').x[0].map((v, i) => v - zero[i])
  let x = new Array(n).fill(1)
  let rho = 0
  for (let it = 0; it < 60; it++) {
    const y = lin(x)
    const norm = Math.hypot(...y)
    rho = norm / Math.hypot(...x)
    x = y.map((v) => v / norm)
  }
  return rho
}

export function exactThermal(p: ResolvedThermal): ThermalExact {
  const n = p.stages.length
  const rho = cycleRadius(p)
  if (p.view === 'steady') {
    const sys1 = thermalSystem(p, thermalBreakpoints(p, 0, p.period))
    const map = (x: number[]) => exactPwl(sys1, x, 0, [p.period], 'th').x[0]
    const sh = periodicTheta(map, n)
    const st = cycleStats(p, sh.x, 0)
    return { ...st, dTj: st.tjMax - st.tjMin, tjPeakRun: st.tjMax, t90: null, rho }
  }
  const sys = thermalSystem(p)
  const starts = Array.from({ length: p.periods }, (_, m) => (m + 1) * p.period)
  const times = [...new Set([...starts, ...sys.breakpoints])].sort((a, b) => a - b)
  const x0 = new Array(n).fill(0)
  const ex = exactPwl(sys, x0, 0, times, 'th')
  const at = new Map<number, number[]>([[0, x0]])
  let tjPeakRun = p.ta
  times.forEach((t, i) => {
    tjPeakRun = Math.max(tjPeakRun, p.ta + ex.x[i].reduce((a, b) => a + b, 0))
    const m = Math.round(t / p.period)
    if (Math.abs(t - m * p.period) < 1e-9 * p.period) at.set(m, ex.x[i])
  })
  const last = cycleStats(p, at.get(p.periods - 1)!, p.periods - 1)
  // t90: the first instant Tj reaches 90 % of its final mean rise — bracketed by the exact states at every
  // load edge and cycle start, refined by bisection on the exact flow inside that segment
  let t90: number | null = null
  const target = p.ta + 0.9 * (last.tjMean - p.ta)
  const tjAt = (x: number[]) => p.ta + x.reduce((a, b) => a + b, 0)
  const idx = times.findIndex((_, i) => tjAt(ex.x[i]) >= target)
  if (idx >= 0) {
    const tA = idx === 0 ? 0 : times[idx - 1]
    const xA = idx === 0 ? x0 : ex.x[idx - 1]
    const sysP = thermalSystem(p, [])
    const f = (t: number) => tjAt(exactPwl(sysP, xA, tA, [t], 'th').x[0])
    let lo = tA
    let hi = times[idx]
    // inside the segment the load is constant; Tj rises monotonically while heating
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi)
      if (f(mid) >= target) hi = mid
      else lo = mid
    }
    t90 = hi
  }
  return { ...last, dTj: last.tjMax - last.tjMin, tjPeakRun, t90, rho }
}

/** Foster impedance Zth(t) = Σ Ri·(1 − e^(−t/τi)) over all stages. */
export const zth = (p: ResolvedThermal, t: number) => p.stages.reduce((s, x) => s + x.r * (1 - Math.exp(-t / x.tau)), 0)

export interface ThermalTextbook {
  /** Loss at 25 °C while loaded [W]. */
  p25: number
  /** Tj = Ta + P25·δ·Rth (mean), no temperature feedback. */
  tjMeanNoFeedback: number
  /** Self-consistent constant-load temperature (exact for a constant load), or null on runaway. */
  tjSelfConsistent: number | null
  /** Datasheet pulse-train peak estimate. */
  tjMaxPulse: number | null
}

export function textbookThermal(p: ResolvedThermal): ThermalTextbook {
  const delta = p.load === 'constant' ? 1 : p.ton / p.period
  const p25 = p.a
  const denom = 1 - p.b * p.rth
  const tjSelf = denom > 0 ? (p.ta + p.rth * (p.a - 25 * p.b) * delta) / (1 - p.b * p.rth * delta) : null
  return {
    p25,
    tjMeanNoFeedback: p.ta + p25 * delta * p.rth,
    tjSelfConsistent: p.load === 'constant' ? tjSelf : null,
    tjMaxPulse: p.load === 'pulsed' ? p.ta + delta * p25 * p.rth + (1 - delta) * p25 * zth(p, p.ton) : null,
  }
}
