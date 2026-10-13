import type { CompareRow, TextbookValue } from '../../lab/types.ts'
import type { BidiMeasurements, BidiRun, CoupledMeasurements, CoupledRun } from './measure.ts'
import { bidiExact, bidiTextbook, coupledExact, coupledTextbook, type BidiExact, type CoupledExact } from './theory.ts'

/**
 * SIMULATION vs THEORY, row by row (the same two theories as the basic converters, never mixed up):
 *  - EXACT: the analytic solution of the same circuit equations (matrix exponential). The simulation must
 *    agree with it within a numerical tolerance — this validates the solver.
 *  - TEXTBOOK: the ideal closed-form relations, with their assumptions. A deviation from it is physics
 *    (finite ripple, losses), not an error.
 *
 * Tolerances (the same as the basic converters, same integrator and the same 200 steps per period):
 * averages 0.2 % (the trapezoidal rule conserves charge and volt-seconds per step; measured < 0.05 %),
 * ripples 3 % and peaks 1 % of the current scale (extremes carry the O(Δt²) waveform error; measured
 * < 0.05 %), efficiency 0.2 % and timing 0.5 % of Ts absolute (a transition is located inside a step).
 */
export const TOL = { average: 0.002, ripple: 0.03, peak: 0.01, efficiency: 0.002, timing: 0.005 }

function rowAdder(rows: CompareRow[], tb: Record<string, TextbookValue>) {
  return (key: string, label: string, unit: string, sim: number, exact: number, tol: number, opts: { scale?: number; absolute?: boolean; expected?: string } = {}) => {
    const scale = opts.absolute ? 1 : (opts.scale ?? Math.max(Math.abs(exact), 1e-12))
    const error = Math.abs(sim - exact) / scale
    const t = tb[key] ?? null
    const tbErr = t && t.value !== null && !t.notApplicable ? (Math.abs(t.value) > 1e-12 ? (sim - t.value) / Math.abs(t.value) : sim - t.value) : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, absolute: opts.absolute, textbook: t, textbookError: tbErr, expected: opts.expected })
  }
}

export interface CoupledComparison {
  rows: CompareRow[]
  exact: CoupledExact
  modeAgrees: boolean
  /** Outside the validated range: Q1 turns off while carrying reverse current (no comparison is meaningful). */
  outside: boolean
  allPass: boolean
}

export const REVERSE_TURN_OFF =
  'Not compared: Q1 still carries reverse current when it turns off. This ideal circuit has no path for that current (a real MOSFET would pass it through its body diode), so the inductor currents are forced to jump — outside the validated range. Use a larger L2 or C1, or a heavier load.'

export function compareCoupled(r: CoupledRun, m: CoupledMeasurements, ex: CoupledExact = coupledExact(r.params)): CoupledComparison {
  const p = r.params
  const e = ex.metrics
  const tb = coupledTextbook(p)
  const rows: CompareRow[] = []
  const add = rowAdder(rows, tb)
  const iScale = Math.max(Math.abs(e.il1Avg), Math.abs(e.il2Avg), (e.il1Max - e.il1Min) / 2, (e.il2Max - e.il2Min) / 2, 1e-9)
  add('voutAvg', 'Vout (average)', 'V', m.voutAvg, e.voutAvg, TOL.average)
  add('voutPP', 'ΔVout (peak-to-peak)', 'V', m.voutPP, e.voutMax - e.voutMin, TOL.ripple)
  add('vc1Avg', 'VC1 (average)', 'V', m.vc1Avg, e.vc1Avg, TOL.average)
  add('vc1PP', 'ΔVC1 (peak-to-peak)', 'V', m.vc1PP, e.vc1Max - e.vc1Min, TOL.ripple)
  add('il1Avg', 'IL1 (average)', 'A', m.il1Avg, e.il1Avg, TOL.average, { scale: iScale })
  add('il1PP', 'ΔiL1 (peak-to-peak)', 'A', m.il1PP, e.il1Max - e.il1Min, TOL.ripple)
  add('il1Max', 'iL1,max', 'A', m.il1Max, e.il1Max, TOL.peak, { scale: iScale })
  add('il1Min', 'iL1,min', 'A', m.il1Min, e.il1Min, TOL.peak, { scale: iScale })
  add('il2Avg', 'IL2 (average)', 'A', m.il2Avg, e.il2Avg, TOL.average, { scale: iScale })
  add('il2PP', 'ΔiL2 (peak-to-peak)', 'A', m.il2PP, e.il2Max - e.il2Min, TOL.ripple)
  add('il2Max', 'iL2,max', 'A', m.il2Max, e.il2Max, TOL.peak, { scale: iScale })
  add('il2Min', 'iL2,min', 'A', m.il2Min, e.il2Min, TOL.peak, { scale: iScale })
  add('ioAvg', 'Iout (average)', 'A', m.ioAvg, e.ioAvg, TOL.average)
  add('pinAvg', 'Pin (average)', 'W', m.pinAvg, e.pinAvg, TOL.average * 2)
  add('poutAvg', 'Pout (average)', 'W', m.poutAvg, e.poutAvg, TOL.average * 2)
  add('efficiency', 'Efficiency η', '%', m.efficiency, e.efficiency, TOL.efficiency, { absolute: true })
  add('vqMax', 'Switch blocking voltage', 'V', m.vqMax, e.vqMax, TOL.peak)
  add('d2', 'Diode conduction D2', '%', m.d2, e.d2, TOL.timing, { absolute: true })
  if (ex.mode === 'DCM' || m.mode === 'DCM') add('d3', 'Idle fraction D3', '%', m.d3, e.d3, TOL.timing, { absolute: true })
  const outside = ex.reverseTurnOff || m.reverseTurnOff
  if (outside) for (const row of rows) row.expected = REVERSE_TURN_OFF
  const modeAgrees = ex.mode === m.mode
  return { rows, exact: ex, modeAgrees, outside, allPass: !outside && modeAgrees && rows.every((x) => x.pass) }
}

export interface BidiComparison {
  rows: CompareRow[]
  exact: BidiExact
  directionAgrees: boolean
  allPass: boolean
}

export function compareBidi(r: BidiRun, m: BidiMeasurements, ex: BidiExact = bidiExact(r.params)): BidiComparison {
  const p = r.params
  const e = ex.metrics
  const tb = bidiTextbook(p)
  const rows: CompareRow[] = []
  const add = rowAdder(rows, tb)
  const iScale = Math.max(Math.abs(e.ilAvg), (e.ilMax - e.ilMin) / 2, 1e-9)
  const pScale = Math.max(Math.abs(e.phvAvg), Math.abs(e.plvAvg), p.vhv * iScale * 0.01, 1e-9)
  add('vlvAvg', 'VLV (average)', 'V', m.vlvAvg, e.vlvAvg, TOL.average)
  add('vlvPP', 'ΔVLV (peak-to-peak)', 'V', m.vlvPP, e.vlvMax - e.vlvMin, TOL.ripple)
  // signed currents and powers can pass through zero: their error is relative to the current (power) scale
  add('ilAvg', 'IL (average, + toward the battery)', 'A', m.ilAvg, e.ilAvg, TOL.average, { scale: iScale })
  add('ilPP', 'ΔiL (peak-to-peak)', 'A', m.ilPP, e.ilMax - e.ilMin, TOL.ripple)
  add('ilMax', 'iL,max', 'A', m.ilMax, e.ilMax, TOL.peak, { scale: iScale })
  add('ilMin', 'iL,min', 'A', m.ilMin, e.ilMin, TOL.peak, { scale: iScale })
  add('ibAvg', 'Battery current (average)', 'A', m.ibAvg, e.ibAvg, TOL.average, { scale: iScale })
  add('ihvAvg', 'Bus current IHV (average)', 'A', m.ihvAvg, e.ihvAvg, TOL.average * 2, { scale: Math.max(Math.abs(e.ihvAvg), (iScale * p.d) / 2, 1e-9) })
  add('phvAvg', 'Bus power PHV (+ out of the bus)', 'W', m.phvAvg, e.phvAvg, TOL.average * 2, { scale: pScale })
  add('plvAvg', 'Battery-side power PLV (+ into the battery)', 'W', m.plvAvg, e.plvAvg, TOL.average * 2, { scale: pScale })
  add('efficiency', 'Efficiency η', '%', m.efficiency, e.efficiency, TOL.efficiency, { absolute: true })
  // a diode conduction shorter than one time step can be absorbed by that step (once per dead time)
  add('diodeFraction', 'Antiparallel-diode conduction', '%', m.diodeFraction, e.diodeFraction, Math.max(TOL.timing, 2 / p.stepsPerPeriod), { absolute: true })
  const directionAgrees = (m.phvAvg >= 0) === (e.phvAvg >= 0) || Math.abs(e.phvAvg) < 1e-6 * pScale
  return { rows, exact: ex, directionAgrees, allPass: directionAgrees && rows.every((x) => x.pass) }
}
