/**
 * Trapezoidal integral of g(t) over [t0, t1], where g is known at the sample
 * times `time` (ascending, uniform or not). The window edges need not fall on
 * samples: g is linearly interpolated there, so any window length is exact up
 * to the O(Δt²) trapezoid error.
 */
export function integrateWindow(time: Float64Array, g: (i: number) => number, t0: number, t1: number): number {
  const n = time.length
  if (n < 2 || !(t1 > t0)) return 0
  const interp = (t: number): number => {
    const k = clampIndex(lowerIndex(time, t), n - 2)
    const span = time[k + 1] - time[k]
    const f = span > 0 ? (t - time[k]) / span : 0
    return g(k) + (g(k + 1) - g(k)) * f
  }

  let total = 0
  let tPrev = t0
  let gPrev = interp(t0)
  for (let i = lowerIndex(time, t0) + 1; i < n && time[i] < t1; i++) {
    if (time[i] <= t0) continue
    const gi = g(i)
    total += 0.5 * (gPrev + gi) * (time[i] - tPrev)
    tPrev = time[i]
    gPrev = gi
  }
  total += 0.5 * (gPrev + interp(t1)) * (t1 - tPrev)
  return total
}

/** Largest index k with time[k] ≤ t (0 if t is before the first sample). */
export function lowerIndex(time: Float64Array, t: number): number {
  let lo = 0
  let hi = time.length - 1
  if (t <= time[0]) return 0
  if (t >= time[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (time[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
}

function clampIndex(k: number, max: number): number {
  return Math.min(max, Math.max(0, k))
}
