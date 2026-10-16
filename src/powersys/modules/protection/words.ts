import { abs, arg, type Complex } from '../../engine/complex.ts'
import { fx } from '../../ui/format.ts'
import type { Zone } from './distance.ts'

/*
 * Words computed from numbers: every size, direction or comparison word on screen comes from here, with the number
 * beside it.
 */

/** "1.62 times", "about the same (within 1 %)", "0.41 times" — for a ratio a/b. */
export function timesWords(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'not comparable'
  if (Math.abs(ratio - 1) < 0.01) return `about the same (within 1 %)`
  return `${fx(ratio, ratio >= 10 ? 0 : 2)} times`
}

/** "+12.3 %", "−4.0 %", "no change". */
export function pctChange(after: number, before: number, d = 1): string {
  if (!Number.isFinite(after) || !Number.isFinite(before) || before === 0) return '—'
  const p = ((after - before) / Math.abs(before)) * 100
  if (Math.abs(p) < 0.5 * 10 ** -d) return 'no change'
  return `${p > 0 ? '+' : '−'}${fx(Math.abs(p), d)} %`
}

/** "larger" / "smaller" / "the same" from two magnitudes (1e-9 relative counts as the same). */
export function compareWord(a: number, b: number, more = 'larger', less = 'smaller'): string {
  if (Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))) return 'the same'
  return a > b ? more : less
}

export const zoneName = (z: Zone) => (z === 0 ? 'outside every zone' : `zone ${z}`)
export const zoneShort = (z: Zone) => (z === 0 ? '—' : `Z${z}`)

/** An impedance as "34.83 Ω ∠81.7°". */
export const zPolar = (z: Complex, d = 2) => `${fx(abs(z), d)} Ω ∠${fx((arg(z) * 180) / Math.PI, 1)}°`
/** An impedance as "5.04 + j34.44 Ω". */
export const zRect = (z: Complex, d = 2) => `${fx(z.re, d)} ${z.im < 0 ? '−' : '+'} j${fx(Math.abs(z.im), d)} Ω`

/** Reach words from the zone with and without a disturbance: the relay sees the fault further away (under-reach) or nearer (over-reach). */
export function reachEffect(zoneBolted: Zone, zoneNow: Zone): 'under' | 'over' | 'none' {
  const rank = (z: Zone) => (z === 0 ? 4 : z)
  if (rank(zoneNow) > rank(zoneBolted)) return 'under'
  if (rank(zoneNow) < rank(zoneBolted)) return 'over'
  return 'none'
}

/** "kA" for big currents, "A" for small ones. */
export function amps(a: number): string {
  if (!Number.isFinite(a)) return '—'
  if (Math.abs(a) >= 1000) return `${fx(a / 1000, 2)} kA`
  if (Math.abs(a) >= 10) return `${fx(a, 0)} A`
  if (Math.abs(a) >= 0.01) return `${fx(a, 2)} A`
  return `${a === 0 ? '0' : '< 0.01'} A`
}

/** "after 0.30 s" or "with no intentional delay" for a relay time. */
export const afterS = (t: number) => (t === 0 ? 'with no intentional delay' : `after ${t.toFixed(2)} s`)
