/** Number formatting for power-system quantities: fixed significant digits, a real minus sign, thin-space units. */

/** A value to a number of decimals, with a true minus sign; −0 shows as 0. */
export function fx(x: number, decimals = 2): string {
  if (!Number.isFinite(x)) return '—'
  const s = (Math.abs(x) < 0.5 * 10 ** -decimals ? 0 : x).toFixed(decimals)
  return s.replace('-', '−')
}

/** A value to about `sig` significant digits (at least 0 decimals), e.g. 0.0742 → "0.0742", 28.6 → "28.6". */
export function sg(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const d = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(x))))
  return fx(x, Math.min(d, 6))
}

/** With a unit. */
export const u = (x: number, unit: string, decimals = 2) => `${fx(x, decimals)} ${unit}`

/** A complex number a ± jb. */
export function cx(re: number, im: number, decimals = 3): string {
  const sign = im < 0 ? '−' : '+'
  return `${fx(re, decimals)} ${sign} j${fx(Math.abs(im), decimals)}`
}

/** A phasor |x|∠θ°. */
export const ph = (mag: number, angDeg: number, decimals = 3, angDecimals = 2) => `${fx(mag, decimals)} ∠ ${fx(angDeg, angDecimals)}°`
