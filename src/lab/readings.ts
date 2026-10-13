import type { Density, Reading } from './types.ts'

/**
 * A reading from a formatted measurement: "5.40 V" → value "5.40", unit "V" (the strip prints the unit
 * smaller). A text with no unit (a mode, a ratio) keeps it whole.
 */
export function reading(id: string, label: string, formatted: string, note?: string, min?: Density): Reading {
  const k = formatted.lastIndexOf(' ')
  const value = k > 0 ? formatted.slice(0, k) : formatted
  const unit = k > 0 ? formatted.slice(k + 1) : ''
  return { id, label, value, unit, note, min }
}
