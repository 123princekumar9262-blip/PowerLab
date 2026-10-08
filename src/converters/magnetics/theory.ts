import { exactPwl } from '../pwl.ts'
import { coreBreakpoints, coreSystem, currentOf, MU0, periodicFlux, regionOf, satTime, steadyGuess, type ResolvedCore } from './core.ts'

/**
 * MAGNETICS THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT: the same piecewise-linear winding equation solved analytically region by region (matrix
 *    exponential), every entry into saturation found on the exact flow; period means from ∫i and ∫λ carried
 *    as extra states; the periodic steady state as the fixed point of the exact one-period map.
 * 2. TEXTBOOK (linear inductor, volt-second balance):
 *      L = N²·μ0·Ae/(lg + le/μr),  ΔB = V·d·T/(N·Ae),  Idc = (2d − 1)·V/R,  Bpk = L·|Idc|/(N·Ae) + ΔB/2
 *    valid while the core stays below Bsat; from rest, the first +V interval swings the flux by the full
 *    ΔB from zero ("flux doubling"), saturating after t = N·Ae·Bsat/V.
 */
export interface CoreExact {
  iMax: number
  iMin: number
  ipk: number
  idc: number
  bpk: number
  dB: number
  bdc: number
  satFrac: number
  iPeakRun: number
  tSat: number | null
}

function periodExact(p: ResolvedCore, lam0: number, m: number) {
  const t0 = m * p.period
  const t1 = t0 + p.period
  const bps = coreBreakpoints(p, t0, t1)
  const sys = coreSystem(p, true, bps)
  const M = 64
  const times = [...new Set([...Array.from({ length: M }, (_, i) => t0 + ((i + 1) * p.period) / M), ...bps])].sort((a, b) => a - b)
  const mode0 = regionOf(p, lam0)
  const ex = exactPwl(sys, [lam0, 0, 0], t0, times, mode0)
  let lMax = lam0
  let lMin = lam0
  for (const y of ex.x) {
    lMax = Math.max(lMax, y[0])
    lMin = Math.min(lMin, y[0])
  }
  const end = ex.x[ex.x.length - 1]
  const na = p.n * p.ae
  const iMax = currentOf(p, lMax)
  const iMin = currentOf(p, lMin)
  return {
    iMax,
    iMin,
    ipk: Math.max(Math.abs(iMax), Math.abs(iMin)),
    idc: end[1] / p.period,
    bdc: end[2] / p.period / na,
    bpk: Math.max(Math.abs(lMax), Math.abs(lMin)) / na,
    dB: (lMax - lMin) / na,
    satFrac: satTime(ex.events, mode0, t0, t1) / p.period,
  }
}

export function exactCore(p: ResolvedCore): CoreExact {
  if (p.view === 'steady') {
    const sys1 = coreSystem(p, false, coreBreakpoints(p, 0, p.period))
    const map = (x: number) => exactPwl(sys1, [x], 0, [p.period], regionOf(p, x)).x[0][0]
    const sh = periodicFlux(map, steadyGuess(p), Math.max(p.lamS, p.vdc * p.period))
    const st = periodExact(p, sh.lam, 0)
    return { ...st, iPeakRun: st.ipk, tSat: null }
  }
  const sys = coreSystem(p)
  const starts = Array.from({ length: p.periods }, (_, m) => (m + 1) * p.period)
  const times = [...new Set([...starts, ...sys.breakpoints])].sort((a, b) => a - b)
  const ex = exactPwl(sys, [0], 0, times, 'lin')
  let iPeakRun = 0
  let lamLast = 0
  times.forEach((t, k) => {
    iPeakRun = Math.max(iPeakRun, Math.abs(currentOf(p, ex.x[k][0])))
    if (Math.abs(t - (p.periods - 1) * p.period) < 1e-9 * p.period) lamLast = ex.x[k][0]
  })
  const firstSat = ex.events.find((e) => e.to !== 'lin')
  return { ...periodExact(p, lamLast, p.periods - 1), iPeakRun, tSat: firstSat ? firstSat.t : null }
}

export interface CoreTextbook {
  l1: number
  l2: number
  dB: number
  idc: number
  bdc: number
  bpk: number
  dI: number
  ipk: number
  /** The linear formulas predict saturation (Bpk > Bsat). */
  saturates: boolean
  /** From rest: flux after the first +V interval, and when it reaches Bsat (R neglected). */
  bFirst: number
  tSat: number | null
  /** Share of the stored energy that sits in the air gap (unsaturated). */
  gapShare: number
}

export function textbookCore(p: ResolvedCore): CoreTextbook {
  const na = p.n * p.ae
  const T = p.period
  const dB = (p.vdc * p.duty * T) / na
  const idc = ((2 * p.duty - 1) * p.vdc) / p.r
  const bdc = (p.l1 * idc) / na
  const bpk = Math.abs(bdc) + dB / 2
  const dI = (p.vdc * p.duty * T) / p.l1
  const bFirst = dB
  return {
    l1: p.l1,
    l2: p.l2,
    dB,
    idc,
    bdc,
    bpk,
    dI,
    ipk: Math.abs(idc) + dI / 2,
    saturates: bpk > p.bsat,
    bFirst,
    tSat: bFirst > p.bsat ? (na * p.bsat) / p.vdc : null,
    gapShare: p.lg / (p.lg + p.le / p.mur),
  }
}

export { MU0 }
