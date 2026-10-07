import type { SimulationResult } from '../types/simulation.ts'
import { measure, type Measurements } from './measurements.ts'
import { halfWaveRTheory, type HalfWaveRTheory } from './theory/halfWaveR.ts'

/**
 * Agreement expected between simulation and closed-form theory. With the auto
 * timestep (2000 samples/cycle) the trapezoid error is ~10⁻⁶, so 1 % only trips
 * when something is genuinely wrong — e.g. a very coarse manual timestep.
 */
export const RELATIVE_TOLERANCE = 0.01

export type ComparisonKey = keyof Omit<HalfWaveRTheory, 'theta1' | 'theta2' | 'conducts'>

export interface ComparisonRow {
  key: ComparisonKey
  label: string
  symbol: string
  unit: string
  simulated: number | null
  theory: number
  formula: string
  /** Relative error (sim − theory)/|theory|; absolute error when theory is 0. null if not measurable. */
  error: number | null
  errorIsAbsolute: boolean
  withinTolerance: boolean
}

const ROWS: ReadonlyArray<{ key: ComparisonKey; label: string; symbol: string; unit: string }> = [
  { key: 'vinPeak', label: 'Peak input', symbol: 'Vin,pk', unit: 'V' },
  { key: 'vinRms', label: 'RMS input', symbol: 'Vin,rms', unit: 'V' },
  { key: 'voutPeak', label: 'Peak output', symbol: 'Vo,pk', unit: 'V' },
  { key: 'voutAvg', label: 'Average output', symbol: 'Vdc', unit: 'V' },
  { key: 'voutRms', label: 'RMS output', symbol: 'Vo,rms', unit: 'V' },
  { key: 'ioPeak', label: 'Peak current', symbol: 'Io,pk', unit: 'A' },
  { key: 'ioAvg', label: 'Average current', symbol: 'Idc', unit: 'A' },
  { key: 'ioRms', label: 'RMS current', symbol: 'Io,rms', unit: 'A' },
  { key: 'piv', label: 'Peak inverse voltage', symbol: 'PIV', unit: 'V' },
  { key: 'conductionAngleDeg', label: 'Conduction angle', symbol: 'γ', unit: '°' },
  { key: 'rippleFrequency', label: 'Ripple frequency', symbol: 'f_r', unit: 'Hz' },
]

/** Absolute tolerance used when the theoretical value is exactly zero (no conduction). */
const ABSOLUTE_ZERO_TOLERANCE = 1e-9

export interface Comparison {
  measurements: Measurements
  theory: HalfWaveRTheory
  rows: ComparisonRow[]
  allWithinTolerance: boolean
}

export function compareWithTheory(result: SimulationResult): Comparison {
  const measurements = measure(result)
  const theory = halfWaveRTheory(result.params)

  const rows = ROWS.map(({ key, label, symbol, unit }): ComparisonRow => {
    const simulated = key === 'rippleFrequency' ? measurements.rippleFrequency : measurements[key]
    const { value: th, formula } = theory[key]
    // With no conduction there are no pulses: "no ripple" agrees with a theoretical 0 Hz.
    const sim = simulated === null && key === 'rippleFrequency' && th === 0 ? 0 : simulated
    if (sim === null) {
      return { key, label, symbol, unit, simulated: null, theory: th, formula, error: null, errorIsAbsolute: false, withinTolerance: true }
    }
    const errorIsAbsolute = th === 0
    const error = errorIsAbsolute ? sim - th : (sim - th) / Math.abs(th)
    const withinTolerance = errorIsAbsolute ? Math.abs(error) <= ABSOLUTE_ZERO_TOLERANCE : Math.abs(error) <= RELATIVE_TOLERANCE
    return { key, label, symbol, unit, simulated: sim, theory: th, formula, error, errorIsAbsolute, withinTolerance }
  })

  return { measurements, theory, rows, allWithinTolerance: rows.every((r) => r.withinTolerance) }
}
