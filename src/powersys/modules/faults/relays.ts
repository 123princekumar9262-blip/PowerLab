/**
 * Inverse-time overcurrent relays (IEC 60255-151 / IEC 60255-3 curves) and their grading.
 *
 *   t = TMS · k / ((I / I_s)^α − 1)
 *
 *   standard inverse   k = 0.14   α = 0.02
 *   very inverse       k = 13.5   α = 1
 *   extremely inverse  k = 80     α = 2
 *
 * I_s is the pick-up (setting) current and TMS the time-multiplier setting. The relay does not operate at or below
 * its pick-up (the formula has no finite value there); the curves are defined in the standard from about 1.1·I_s up
 * to about 20·I_s — above that the time is taken as constant (it stays at its 20·I_s value).
 */

export type CurveId = 'SI' | 'VI' | 'EI'

export const CURVES: Record<CurveId, { k: number; alpha: number; name: string }> = {
  SI: { k: 0.14, alpha: 0.02, name: 'Standard inverse' },
  VI: { k: 13.5, alpha: 1, name: 'Very inverse' },
  EI: { k: 80, alpha: 2, name: 'Extremely inverse' },
}

/** The multiple of the setting above which the operating time is held constant. */
export const MAX_MULTIPLE = 20

/** Operating time [s] for a current I [A] at a setting I_s [A]; Infinity when I ≤ I_s (the relay does not operate). */
export function tripTime(curve: CurveId, tms: number, isA: number, iA: number): number {
  const m = Math.min(iA / isA, MAX_MULTIPLE)
  if (!(m > 1)) return Infinity
  const { k, alpha } = CURVES[curve]
  return (tms * k) / (m ** alpha - 1)
}

/** The smallest TMS that makes a relay operate in time t [s] at current I [A] (setting I_s). */
export function tmsFor(curve: CurveId, isA: number, iA: number, t: number): number {
  const at1 = tripTime(curve, 1, isA, iA)
  return Number.isFinite(at1) ? t / at1 : Infinity
}

/** A relay protecting one breaker, its settings in primary amperes at its own voltage. */
export interface Relay {
  id: string
  /** The breaker it trips. */
  breaker: string
  /** The voltage of the circuit it measures [kV]. */
  kv: number
  curve: CurveId
  /** Pick-up current [A, primary]. */
  isA: number
  tms: number
}

/** The recommended grading margin between a downstream relay and the one upstream of it [s]. */
export const GRADING_MARGIN = 0.3

export interface Grading {
  /** Operating times at the given currents [s] (Infinity = does not operate). */
  tDown: number
  tUp: number
  /** t_up − t_down [s]. */
  margin: number
  ok: boolean
}

/** Grade a downstream relay against the one upstream of it at the currents each sees for the same fault. */
export function grade(down: Relay, up: Relay, iDownA: number, iUpA: number, margin = GRADING_MARGIN): Grading {
  const tDown = tripTime(down.curve, down.tms, down.isA, iDownA)
  const tUp = tripTime(up.curve, up.tms, up.isA, iUpA)
  const m = tUp - tDown
  return { tDown, tUp, margin: m, ok: Number.isFinite(tDown) && m >= margin - 1e-9 }
}

/** Points of a relay's curve for plotting: current [A] against time [s], from just above pick-up to 20·I_s. */
export function curvePoints(r: Relay, scaleA = 1, n = 80): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const lo = Math.log(1.05)
  const hi = Math.log(MAX_MULTIPLE)
  for (let j = 0; j <= n; j++) {
    const m = Math.exp(lo + ((hi - lo) * j) / n)
    out.push([m * r.isA * scaleA, tripTime(r.curve, r.tms, r.isA, m * r.isA)])
  }
  return out
}
