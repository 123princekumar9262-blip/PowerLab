import { fx } from '../../ui/format.ts'

/*
 * Size words computed from numbers: every "small", "large", "falls", "rises" on screen comes from here, with the number
 * beside it.
 */

/** A percentage of something (a voltage drop of V, a change) in words, with the number. */
export function pctWords(fraction: number): string {
  const p = Math.abs(fraction) * 100
  const n = p < 10 ? fx(p, 1) : fx(p, 0)
  if (p < 0.05) return 'no measurable'
  if (p < 1) return `a very small (${n} %)`
  if (p < 3) return `a small (${n} %)`
  if (p < 10) return `a noticeable (${n} %)`
  return `a large (${n} %)`
}

/** A signed change as "rises by 12.0 %" / "falls by 26.3 %" / "does not change". */
export function changeWords(before: number, after: number, decimals = 1): string {
  if (before === 0) return after === 0 ? 'does not change' : 'appears'
  const r = after / before - 1
  if (Math.abs(r) < 0.5 * 10 ** -(decimals + 2)) return 'does not change'
  return `${r > 0 ? 'rises' : 'falls'} by ${fx(Math.abs(r) * 100, decimals)} %`
}

/** A ratio as a simple fraction when it is one (½, ⅓, 3×), otherwise the number. */
export function ratioWords(r: number): string {
  const known: Array<[number, string]> = [
    [1 / 4, 'one quarter'],
    [1 / 3, 'one third'],
    [1 / 2, 'one half'],
    [1, 'the same'],
    [2, 'twice'],
    [3, 'three times'],
  ]
  for (const [v, w] of known) if (Math.abs(r - v) < 1e-6 * v) return `${w} (${fx(r, 4)})`
  return `${fx(r, 4)} ×`
}

/** Where along the distributor: "at load L2 (200 m)", "between loads, at 213.4 m", "at end A". */
export function placeWords(kind: 'A' | 'load' | 'between' | 'end', x: number, ids: string[], L: number): string {
  if (kind === 'A') return `at the feed point A (0 m)`
  if (kind === 'load') return `at load ${ids.join(' + ')} (${fx(x, 0)} m from A)`
  if (kind === 'end') return ids.length ? `at the far end B — load ${ids.join(' + ')} (${fx(L, 0)} m)` : `at the far end B (${fx(L, 0)} m)`
  return `between loads, ${fx(x, 1)} m from A`
}
