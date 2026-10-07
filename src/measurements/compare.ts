import type { SimulationResult } from '../types/simulation.ts'
import { measure, type Measurements } from './measurements.ts'
import { theoryFor, type MeasureKey, type Theory } from './theory/index.ts'

/**
 * Agreement expected between simulation and EXACT closed-form theory. With the auto
 * timestep the observed errors are ≲ 0.1 % (backward-Euler storage elements) or ~10⁻⁶
 * (R load), so 1 % only trips when something is genuinely wrong — e.g. a coarse timestep.
 */
export const RELATIVE_TOLERANCE = 0.01

export type RowGroup = 'Source' | 'Output' | 'Load current' | 'Diodes' | 'Timing' | 'Power'

export interface ComparisonRow {
  key: MeasureKey
  label: string
  symbol: string
  unit: string
  group: RowGroup
  simulated: number | null
  theory: number | null
  formula: string | null
  kind: 'exact' | 'approx' | 'none'
  /** Relative error (sim − theory)/|theory|; absolute when theory is 0. null if not comparable. */
  error: number | null
  errorIsAbsolute: boolean
  withinTolerance: boolean
  /** Why the row is not compared (e.g. not in steady state, discontinuous mode). */
  skipped?: string
}

const ROWS: ReadonlyArray<{ key: MeasureKey; label: string; symbol: string; unit: string; group: RowGroup }> = [
  { key: 'vinPeak', label: 'Peak input', symbol: 'Vin,pk', unit: 'V', group: 'Source' },
  { key: 'vinRms', label: 'RMS input', symbol: 'Vin,rms', unit: 'V', group: 'Source' },
  { key: 'voutAvg', label: 'Average output', symbol: 'Vdc', unit: 'V', group: 'Output' },
  { key: 'voutRms', label: 'RMS output', symbol: 'Vo,rms', unit: 'V', group: 'Output' },
  { key: 'voutPeak', label: 'Peak output', symbol: 'Vo,pk', unit: 'V', group: 'Output' },
  { key: 'voutMin', label: 'Minimum output', symbol: 'Vo,min', unit: 'V', group: 'Output' },
  { key: 'ripplePP', label: 'Ripple (peak-to-peak)', symbol: 'ΔVo', unit: 'V', group: 'Output' },
  { key: 'rippleFactor', label: 'Ripple factor', symbol: 'RF', unit: '', group: 'Output' },
  { key: 'rippleFrequency', label: 'Ripple frequency', symbol: 'f_r', unit: 'Hz', group: 'Output' },
  { key: 'ioAvg', label: 'Average current', symbol: 'Idc', unit: 'A', group: 'Load current' },
  { key: 'ioRms', label: 'RMS current', symbol: 'Io,rms', unit: 'A', group: 'Load current' },
  { key: 'ioPeak', label: 'Peak current', symbol: 'Io,pk', unit: 'A', group: 'Load current' },
  { key: 'idPeak', label: 'D1 peak current', symbol: 'ID,pk', unit: 'A', group: 'Diodes' },
  { key: 'idAvg', label: 'D1 average current', symbol: 'ID,avg', unit: 'A', group: 'Diodes' },
  { key: 'piv', label: 'Peak inverse voltage', symbol: 'PIV', unit: 'V', group: 'Diodes' },
  { key: 'conductionAngleDeg', label: 'D1 conduction angle', symbol: 'γ', unit: '°', group: 'Timing' },
  { key: 'turnOnAngleDeg', label: 'D1 turn-on angle', symbol: 'θon', unit: '°', group: 'Timing' },
  { key: 'turnOffAngleDeg', label: 'D1 turn-off / extinction', symbol: 'β', unit: '°', group: 'Timing' },
  { key: 'efficiency', label: 'Rectification efficiency', symbol: 'η', unit: '', group: 'Power' },
]

export interface Comparison {
  measurements: Measurements
  theory: Theory
  rows: ComparisonRow[]
  /** True if every compared exact row is within tolerance. */
  allWithinTolerance: boolean
}

/** Read a measurement, putting angles on the same branch as the theory (θ ≈ 360° ≡ 0°). */
function simulatedValue(m: Measurements, key: MeasureKey, theory: number | null): number | null {
  const v = m[key] as number | null
  if (v === null || v === undefined) return null
  if ((key === 'turnOnAngleDeg' || key === 'turnOffAngleDeg') && theory !== null) {
    return v - 360 * Math.round((v - theory) / 360)
  }
  return v
}

export function compareWithTheory(result: SimulationResult): Comparison {
  const measurements = measure(result)
  const theory = theoryFor(result.params)
  const p = result.params
  const continuous = measurements.rectCurrentMin === null ? null : measurements.rectCurrentMin > 0
  // Scale for absolute comparisons when the theoretical value is exactly zero.
  const zeroScale: Record<string, number> = { V: p.vm, A: p.vm / p.resistance, '°': 360, Hz: p.frequency, '': 1 }

  const rows = ROWS.map((def): ComparisonRow => {
    const t = theory.values[def.key]
    const th = t?.value ?? null
    const sim = simulatedValue(measurements, def.key, th)
    const base = { ...def, simulated: sim, theory: th, formula: t?.formula ?? null, kind: t?.kind ?? ('none' as const) }
    const noCompare = (skipped?: string): ComparisonRow => ({ ...base, error: null, errorIsAbsolute: false, withinTolerance: true, skipped })
    if (th === null || sim === null) return noCompare()
    // Steady-state formulas are only comparable once the transient has died out.
    if (!measurements.steady.reached && def.group !== 'Source' && def.key !== 'rippleFrequency') return noCompare('not in steady state')
    if (t?.requiresContinuous && continuous === false) return noCompare('discontinuous — formula assumes continuous iL')
    const errorIsAbsolute = th === 0
    const error = errorIsAbsolute ? sim - th : (sim - th) / Math.abs(th)
    const tol = errorIsAbsolute ? 1e-6 * (zeroScale[def.unit] ?? 1) : RELATIVE_TOLERANCE
    return { ...base, error, errorIsAbsolute, withinTolerance: Math.abs(error) <= tol }
  })

  return { measurements, theory, rows, allWithinTolerance: rows.every((r) => r.withinTolerance) }
}
