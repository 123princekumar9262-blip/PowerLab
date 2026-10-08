import { affineFlow } from '../expm.ts'
import { exactPwl } from '../pwl.ts'
import { averagedSteady, driveBreakpoints, driveSystem, initialMode, loadAt, motorMatrix, periodicState, type ResolvedDrive } from './motor.ts'

/**
 * DRIVE THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT: the same piecewise-linear equations solved analytically, mode by mode (matrix exponential),
 *    with every current-zero instant found on the exact flow (converters/pwl.ts → exactPwl). Period means
 *    come from the state augmented with ∫ia dt and ∫ω dt, so they are exact too. The periodic steady state is
 *    the fixed point of the exact one-period map (Newton).
 * 2. TEXTBOOK (averaged model): the switch replaced by its mean voltage d·Vdc,
 *      La·dī/dt = d·Vdc − Ra·ī − k·ω̄,   J·dω̄/dt = k·ī − B·ω̄ − TL
 *    steady state ω̄ = (d·Vdc − Ra·TL/k)/(k + Ra·B/k), ī = (TL + B·ω̄)/k; ripple ΔI ≈ Vdc·d·(1 − d)/(La·fs).
 *    It ignores the ripple and cannot represent discontinuous conduction.
 */
export interface DriveExact {
  wEnd: number
  iEnd: number
  ripple: number
  iMin: number
  iMax: number
  iPeak: number
  iNeg: number
  t90: number | null
  wPre: number | null
  dcm: boolean
  /** Periodic steady state (steady view): shooting iterations. */
  iterations: number
}

interface PeriodStats {
  wMean: number
  iMean: number
  iMin: number
  iMax: number
  dcm: boolean
}

/** Exact statistics of one period starting at state x (period index m). */
function periodStats(p: ResolvedDrive, x: number[], mode: string, m: number): PeriodStats {
  const t0 = m * p.period
  const t1 = t0 + p.period
  const bps = driveBreakpoints(p, t0, t1)
  const sys = driveSystem(p, true, bps)
  const M = 64
  const times = [...new Set([...Array.from({ length: M }, (_, i) => t0 + ((i + 1) * p.period) / M), ...bps])].sort((a, b) => a - b)
  const ex = exactPwl(sys, [x[0], x[1], 0, 0], t0, times, mode)
  let iMin = x[0]
  let iMax = x[0]
  for (const y of ex.x) {
    iMin = Math.min(iMin, y[0])
    iMax = Math.max(iMax, y[0])
  }
  const dcm = ex.events.some((e) => e.to === 'z') || mode === 'z'
  if (dcm) iMin = Math.min(iMin, 0)
  const end = ex.x[ex.x.length - 1]
  return { wMean: end[3] / p.period, iMean: end[2] / p.period, iMin, iMax, dcm }
}

export function exactDrive(p: ResolvedDrive): DriveExact {
  if (p.view === 'steady') {
    const sys1 = driveSystem(p, false, driveBreakpoints(p, 0, p.period))
    const map = (x: number[]) => exactPwl(sys1, x, 0, [p.period], initialMode(p, x)).x[0]
    const av = averagedSteady(p, p.duty, p.tl)
    const ripple = (p.vdc * p.duty * (1 - p.duty)) / (p.la * p.fs)
    const sh = periodicState(p, map, [p.bridge === '1q' ? Math.max(0, av.i - ripple / 2) : av.i - ripple / 2, av.w])
    const st = periodStats(p, sh.x, initialMode(p, sh.x), 0)
    return { wEnd: st.wMean, iEnd: st.iMean, ripple: st.iMax - st.iMin, iMin: st.iMin, iMax: st.iMax, iPeak: st.iMax, iNeg: st.iMin, t90: null, wPre: null, dcm: st.dcm, iterations: sh.iterations }
  }
  // Start-up: exact states at every gate edge and period start.
  const sys = driveSystem(p)
  const starts = Array.from({ length: p.periods }, (_, m) => (m + 1) * p.period)
  const times = [...new Set([...starts, ...sys.breakpoints])].sort((a, b) => a - b)
  const x0 = [0, 0]
  const mode0 = initialMode(p, x0)
  const ex = exactPwl(sys, x0, 0, times, mode0)
  let iPeak = 0
  let iNeg = 0
  const at = new Map<number, { x: number[]; mode: string }>()
  at.set(0, { x: x0, mode: mode0 })
  times.forEach((t, i) => {
    iPeak = Math.max(iPeak, ex.x[i][0])
    iNeg = Math.min(iNeg, ex.x[i][0])
    const m = Math.round(t / p.period)
    if (Math.abs(t - m * p.period) < 1e-9 * p.period) at.set(m, { x: ex.x[i], mode: ex.modes[i] })
  })
  const stat = (m: number) => {
    const s = at.get(m)!
    return periodStats(p, s.x, s.mode, m)
  }
  const last = stat(p.periods - 1)
  const mPre = p.tstep !== null ? Math.round(p.tstep / p.period) - 1 : null
  const wPre = mPre !== null && mPre >= 0 ? stat(mPre).wMean : null
  // t90: the first crossing, bracketed by period starts and refined on the exact flow
  let t90: number | null = null
  const target = 0.9 * (wPre ?? last.wMean)
  if (target > 0) {
    // the first period whose end is above the target holds the crossing (ω barely ripples)
    let m = 0
    while (m < p.periods && at.get(m + 1)!.x[1] < target) m++
    if (m < p.periods) {
      const s = at.get(m)!
      const tA = m * p.period
      const sysP = driveSystem(p, false, driveBreakpoints(p, tA, tA + p.period))
      const wAt = (t: number) => exactPwl(sysP, s.x, tA, [t], s.mode).x[0][1]
      const N = 16
      let i = 1
      while (i < N && wAt(tA + (i * p.period) / N) < target) i++
      let lo = tA + ((i - 1) * p.period) / N
      let hi = tA + (i * p.period) / N
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi)
        if (wAt(mid) >= target) hi = mid
        else lo = mid
      }
      t90 = hi
    }
  }
  return { wEnd: last.wMean, iEnd: last.iMean, ripple: last.iMax - last.iMin, iMin: last.iMin, iMax: last.iMax, iPeak, iNeg, t90, wPre, dcm: last.dcm, iterations: 0 }
}

export interface DriveAveraged {
  /** Steady state of the averaged model at the final duty and load. */
  wSteady: number
  iSteady: number
  /** Small-ripple estimate of the current ripple (continuous conduction). */
  ripple: number
  /** Averaged start-up: peak current, t90, final speed (state at period starts). */
  iPeak: number
  iNeg: number
  t90: number | null
  wEnd: number
  wPre: number | null
  /** Ripple ≥ twice the mean current: the averaged model assumes conduction it cannot have (1Q). */
  dcmPredicted: boolean
}

/** THEORY 2 (textbook): the averaged model, advanced exactly period by period with the per-period duty. */
export function averagedDrive(p: ResolvedDrive): DriveAveraged {
  const dEnd = p.duties[p.periods - 1]
  const tlEnd = loadAt(p, p.duration - 0.5 * p.period)
  const ss = averagedSteady(p, dEnd, tlEnd)
  const ripple = (p.vdc * dEnd * (1 - dEnd)) / (p.la * p.fs)
  const A = motorMatrix(p)
  const cache = new Map<string, (x: number[]) => number[]>()
  let x = [0, 0]
  const w: number[] = [0]
  let iPeak = 0
  let iNeg = 0
  if (p.view === 'startup')
    for (let m = 0; m < p.periods; m++) {
      const d = p.duties[m]
      const tl = loadAt(p, (m + 0.5) * p.period)
      const key = `${d}|${tl}`
      let f = cache.get(key)
      if (!f) {
        f = affineFlow(A, [(d * p.vdc) / p.la, -tl / p.j], p.period)
        cache.set(key, f)
      }
      x = f(x)
      w.push(x[1])
      iPeak = Math.max(iPeak, x[0])
      iNeg = Math.min(iNeg, x[0])
    }
  const mPre = p.tstep !== null ? Math.round(p.tstep / p.period) : null
  const wPre = mPre !== null ? w[mPre] : null
  const wEnd = p.view === 'startup' ? w[w.length - 1] : ss.w
  let t90: number | null = null
  const target = 0.9 * (wPre ?? wEnd)
  if (p.view === 'startup' && target > 0)
    for (let m = 1; m < w.length; m++)
      if (w[m] >= target) {
        t90 = (m - 1 + (target - w[m - 1]) / (w[m] - w[m - 1])) * p.period
        break
      }
  return { wSteady: ss.w, iSteady: ss.i, ripple, iPeak, iNeg, t90, wEnd, wPre, dcmPredicted: p.bridge === '1q' && ripple / 2 > ss.i }
}
