/** Large money and energy figures with digit grouping (Indian style: 25,57,800), a true minus sign, '—' if not finite. */
export function grp(x: number, decimals = 0): string {
  if (!Number.isFinite(x)) return '—'
  const v = Math.abs(x) < 0.5 * 10 ** -decimals ? 0 : x
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace('-', '−')
}
