/** Display-only formatting. Never used inside the simulation. */

const PREFIXES: ReadonlyArray<[number, string]> = [
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
]

/**
 * Magnitudes below this are displayed as exactly zero. Nothing in this lab is meaningful
 * below 1 nV / 1 nA (the smallest real current is ~µA at 10 MΩ); smaller values are
 * numerical dust, e.g. vin 10⁻⁹·Δt after a zero crossing.
 */
const DISPLAY_ZERO = 1e-9

/**
 * Engineering format with SI prefix: 0.7 → "0.700 V", 0.0505 → "50.50 mA", 16.97 → "16.97 V".
 * Mantissa shows 4 significant figures (3 decimals below 1, 2 below 100, 1 above).
 */
export function formatSI(value: number, unit: string, opts: { signed?: boolean; digits?: number } = {}): string {
  if (!Number.isFinite(value)) return `— ${unit}`
  const signed = opts.signed ?? false
  // Dust suppression applies to electrical quantities only: picofarads, nanoseconds and microjoules are real.
  const dust = unit === 'V' || unit === 'A' || unit === 'W' ? DISPLAY_ZERO : 1e-24
  if (Math.abs(value) < dust) return `${(0).toFixed(opts.digits ?? 3)} ${unit}`
  const abs = Math.abs(value)
  // Values ≥ 0.1 stay in base units so "0.700 V" reads naturally; smaller ones get a prefix.
  let scale = 1
  let prefix = ''
  if (abs >= 1e3 || abs < 0.1) {
    ;[scale, prefix] = PREFIXES.find(([s]) => abs >= s) ?? PREFIXES[PREFIXES.length - 1]
  }
  const m = abs / scale
  const digits = opts.digits ?? (m >= 100 ? 1 : m >= 10 ? 2 : 3)
  const sign = value < 0 ? '−' : signed ? '+' : ''
  return `${sign}${m.toFixed(digits)} ${prefix}${unit}`
}

export const formatV = (v: number, signed = true) => formatSI(v, 'V', { signed })
export const formatA = (a: number, signed = false) => formatSI(a, 'A', { signed })
export const formatW = (w: number) => formatSI(w, 'W')
export const formatTime = (t: number) => formatSI(t, 's')

export function formatDeg(deg: number, digits = 1): string {
  return `${deg.toFixed(digits)}°`
}

export function formatOhm(r: number): string {
  return formatSI(r, 'Ω', { digits: r >= 1e3 ? 2 : undefined }).replace(/\.0+ /, ' ')
}

export function formatPercent(x: number, digits = 3): string {
  const v = x * 100
  if (Math.abs(v) < 1e-6) return '0 %'
  if (Math.abs(v) < 10 ** -digits) return `${v.toExponential(1)} %`
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)} %`
}

/** Capacitance in µF (how students and datasheets quote filter capacitors): 0.0022 → "2200 µF". */
export function formatCapacitance(c: number): string {
  const uF = c * 1e6
  if (uF < 0.1) return formatSI(c, 'F')
  return `${Number(uF.toPrecision(4))} µF`
}
