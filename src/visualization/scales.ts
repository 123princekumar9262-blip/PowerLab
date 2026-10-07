/** "Nice" tick values (1, 2, 5 × 10ⁿ steps) covering [min, max]. */
export function niceTicks(min: number, max: number, target: number): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [min]
  const raw = (max - min) / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const first = Math.ceil(min / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return ticks
}

/** SI prefix suited to values up to |maxAbs|, so an axis can show plain numbers ("mA", "µs"). */
export function axisPrefix(maxAbs: number): { scale: number; prefix: string } {
  if (maxAbs >= 1e3) return { scale: 1e3, prefix: 'k' }
  if (maxAbs >= 1) return { scale: 1, prefix: '' }
  if (maxAbs >= 1e-3) return { scale: 1e-3, prefix: 'm' }
  if (maxAbs >= 1e-6) return { scale: 1e-6, prefix: 'µ' }
  return { scale: 1e-9, prefix: 'n' }
}

/** Format a tick value (already divided by its axis scale) with as many decimals as the tick step needs. */
export function tickLabel(v: number, step: number): string {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)))
  const text = (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(decimals)
  return text.replace('-', '−')
}
