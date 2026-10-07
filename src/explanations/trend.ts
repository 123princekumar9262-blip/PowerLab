/**
 * Direction of change of a sampled signal around sample i, from a central difference.
 * `maxSlope` is the largest slope the signal can have (e.g. ω·Vm for a sinusoid);
 * below EXTREMUM_FRACTION of it the signal is treated as being at a peak/trough.
 */
export type Trend = 'rising' | 'falling' | 'peak' | 'trough' | 'flat'

/** 3 % of the maximum slope ⇔ within asin(0.03) ≈ 1.7° of a sinusoid's extremum. */
const EXTREMUM_FRACTION = 0.03

export function trendAt(time: Float64Array, x: Float64Array, i: number, maxSlope: number): Trend {
  const n = x.length
  if (n < 2 || !(maxSlope > 0)) return 'flat'
  const a = Math.max(0, i - 1)
  const b = Math.min(n - 1, i + 1)
  const slope = (x[b] - x[a]) / (time[b] - time[a])
  if (Math.abs(slope) >= EXTREMUM_FRACTION * maxSlope) return slope > 0 ? 'rising' : 'falling'
  if (a === i || b === i) return 'flat'
  const curvature = x[b] + x[a] - 2 * x[i]
  if (curvature < 0) return 'peak'
  if (curvature > 0) return 'trough'
  return 'flat'
}
