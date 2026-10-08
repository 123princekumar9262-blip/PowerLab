import type { ConverterResult } from '../types.ts'
import type { DcdcMeasurements } from './measure.ts'
import { dcdcExact, dcdcTextbook, dcdcVoutEstimate, type DcdcExact, type TextbookValue } from './theory.ts'

/**
 * SIMULATION vs THEORY, row by row. Two theories, never mixed up:
 *  - EXACT: the analytic solution of the same circuit equations (matrix exponential). The
 *    simulation must agree with it within a numerical tolerance — this validates the solver.
 *  - TEXTBOOK: the ideal closed-form relations, shown with their assumptions. Deviations from it
 *    are physics (non-idealities, finite ripple), not errors — unless its assumptions hold.
 */
export interface CompareRow {
  key: string
  label: string
  unit: string
  sim: number
  exact: number
  /** |sim − exact| relative to `scale` (or absolute when `absolute`). */
  error: number
  tolerance: number
  pass: boolean
  absolute?: boolean
  textbook: TextbookValue | null
  /** sim vs textbook, relative (null when the textbook relation does not apply). */
  textbookError: number | null
}

export interface DcdcComparison {
  rows: CompareRow[]
  exact: DcdcExact
  /** First-order ESTIMATE of Vout with device drops (CCM), labelled ESTIMATED. */
  voutEstimate: number | null
  modeAgrees: boolean
  allPass: boolean
}

/**
 * Tolerances (simulation vs exact theory). Backward Euler is first order: averages are exact to
 * rounding (volt-second balance holds per step), waveform extremes carry an O(Δt) error. The
 * defaults (200 steps per period) give < 0.05 % on averages and < 0.7 % on ripples; the
 * tolerances leave margin and the tests check that the error halves when Δt halves.
 */
export const TOL = {
  average: 0.002,
  ripple: 0.03,
  peak: 0.01,
  efficiency: 0.002, // absolute
  timing: 0.005, // absolute, fraction of Ts
}

export function compareDcdc(r: ConverterResult, m: DcdcMeasurements): DcdcComparison {
  const p = r.params
  const ex = dcdcExact(p)
  const tb = dcdcTextbook(p)
  const e = ex.metrics
  const iScale = Math.max(Math.abs(e.ilAvg), (e.ilMax - e.ilMin) / 2, 1e-9)
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number, exact: number, tol: number, opts: { scale?: number; absolute?: boolean } = {}) => {
    const scale = opts.absolute ? 1 : (opts.scale ?? Math.max(Math.abs(exact), 1e-12))
    const error = Math.abs(sim - exact) / scale
    const t = tb[key] ?? null
    const tbErr = t && t.value !== null && !t.notApplicable ? (Math.abs(t.value) > 1e-12 ? (sim - t.value) / Math.abs(t.value) : sim - t.value) : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, absolute: opts.absolute, textbook: t, textbookError: tbErr })
  }
  add('voutAvg', 'Vout (average)', 'V', m.voutAvg, e.voutAvg, TOL.average)
  add('voutPP', 'ΔVout (peak-to-peak)', 'V', m.voutPP, e.voutMax - e.voutMin, TOL.ripple)
  add('ilAvg', 'IL (average)', 'A', m.ilAvg, e.ilAvg, TOL.average)
  add('ilPP', 'ΔiL (peak-to-peak)', 'A', m.ilPP, e.ilMax - e.ilMin, TOL.ripple)
  add('ilMax', 'iL,max', 'A', m.ilMax, e.ilMax, TOL.peak, { scale: iScale })
  add('ilMin', 'iL,min', 'A', m.ilMin, e.ilMin, TOL.peak, { scale: iScale })
  add('ioAvg', 'Iout (average)', 'A', m.ioAvg, e.ioAvg, TOL.average)
  add('pinAvg', 'Pin (average)', 'W', m.pinAvg, e.pinAvg, TOL.average * 2)
  add('poutAvg', 'Pout (average)', 'W', m.poutAvg, e.poutAvg, TOL.average * 2)
  add('efficiency', 'Efficiency η', '%', m.efficiency, e.efficiency, TOL.efficiency, { absolute: true })
  add('d2', 'Diode conduction D2', '%', m.d2, e.d2, TOL.timing, { absolute: true })
  if (ex.mode === 'DCM' || m.mode === 'DCM') add('d3', 'Idle fraction D3', '%', m.d3, e.d3 ?? 0, TOL.timing, { absolute: true })
  const modeAgrees = ex.mode === m.mode
  return {
    rows,
    exact: ex,
    voutEstimate: ex.mode === 'CCM' && p.devices === 'real' ? dcdcVoutEstimate(p) : null,
    modeAgrees,
    allPass: modeAgrees && rows.every((x) => x.pass),
  }
}

export type BuckComparison = DcdcComparison
export const compareBuck = compareDcdc
