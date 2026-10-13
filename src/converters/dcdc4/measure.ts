import { segmentAverage } from '../engine.ts'
import type { Run } from '../types.ts'
import type { ResolvedBidi, ResolvedCoupled } from './params.ts'

/**
 * Measurements of the advanced converters — every value from the simulated trace and its events
 * (SIMULATION). Window: the whole steady-state run, or the last period of a start-up run.
 *
 * Averages use the engine's own event-aware quadrature (segmentAverage: trapezoid between samples, an
 * interval with a switching instant split there), so a switched quantity (device current, dissipation)
 * is averaged exactly as the integrator advanced it. Extremes include the values recorded at events
 * (a peak at a gate edge inside a step is not missed).
 */
export type CoupledRun = Run<ResolvedCoupled>
export type BidiRun = Run<ResolvedBidi>

function extremes(r: Run, sid: string): [number, number] {
  const a = r.signals[sid]
  let lo = Infinity
  let hi = -Infinity
  for (let k = r.steadyFrom; k < r.length; k++) {
    lo = Math.min(lo, a[k])
    hi = Math.max(hi, a[k])
  }
  const t0 = r.time[r.steadyFrom] - r.params.dt * 1e-9
  for (const e of r.events) {
    if (e.time < t0) continue
    const v = e.values[sid]
    if (v === undefined) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

const avg = (r: Run, sid: string) => segmentAverage(r, sid)
const rmsOf = (r: Run, sid: string, f: (x: number) => number) => {
  // RMS through a squared copy of the signal, with the same quadrature (event values squared too)
  const sq = r.signals[sid].map(f)
  const tmp = { ...r, signals: { ...r.signals, __sq: sq }, events: r.events.map((e) => ({ ...e, values: { ...e.values, __sq: f(e.values[sid] ?? 0) } })) }
  return Math.sqrt(Math.max(0, segmentAverage(tmp, '__sq')))
}

export interface CoupledMeasurements {
  t0: number
  t1: number
  periods: number
  steady: boolean
  voutAvg: number
  voutMax: number
  voutMin: number
  voutPP: number
  il1Avg: number
  il1Max: number
  il1Min: number
  il1PP: number
  il2Avg: number
  il2Max: number
  il2Min: number
  il2PP: number
  vc1Avg: number
  vc1Max: number
  vc1Min: number
  vc1PP: number
  ioAvg: number
  iinAvg: number
  /** Ripple (peak-to-peak) of the current drawn from the source. */
  iinPP: number
  iinMin: number
  iqAvg: number
  iqRms: number
  iqPeak: number
  idAvg: number
  idRms: number
  idPeak: number
  icRms: number
  vqMax: number
  vdReverseMax: number
  pinAvg: number
  poutAvg: number
  losses: { q: number; d: number; dcr: number; esr: number; total: number }
  efficiency: number
  /** Diode conduction fraction D2 and idle fraction D3 (from the device states). */
  d2: number
  d3: number
  dutyMeasured: number
  mode: 'CCM' | 'DCM'
  elMax: number
  ecAvg: number
  /** Average of the loop current ½·(iL1 − iL2) during the idle interval (DCM), 0 in CCM. */
  idleCurrent: number
  /**
   * Q1 still carries REVERSE current when its gate falls: nothing in this circuit (no body diode) can take
   * that current, so the ideal circuit forces the inductor currents to jump — outside the model's validity.
   */
  reverseTurnOff: boolean
}

export function measureCoupled(r: CoupledRun): CoupledMeasurements {
  const p = r.params
  const from = r.steadyFrom
  const t0 = r.time[from]
  const t1 = r.time[r.length - 1]
  const [voutMin, voutMax] = extremes(r, 'vout')
  const [il1Min, il1Max] = extremes(r, 'il1')
  const [il2Min, il2Max] = extremes(r, 'il2')
  const [vc1Min, vc1Max] = extremes(r, 'vc1')
  const [iinMin, iinMax] = extremes(r, 'iin')
  const [, iqPeak] = extremes(r, 'iq')
  const [, idPeak] = extremes(r, 'id')
  const [, vqMax] = extremes(r, 'vq')
  const [vdMin] = extremes(r, 'vd')
  const [, elMax] = extremes(r, 'el')
  const losses = { q: avg(r, 'pq'), d: avg(r, 'pd'), dcr: avg(r, 'pdcr'), esr: avg(r, 'pesr'), total: 0 }
  losses.total = losses.q + losses.d + losses.dcr + losses.esr
  const pinAvg = avg(r, 'pin')
  const poutAvg = avg(r, 'pout')
  const d2 = avg(r, 'don')
  const duty = avg(r, 'gate')
  const dcm = r.events.some((e) => e.kind === 'il-zero' && e.time >= t0 - p.dt * 1e-6)
  // the idle loop current: average of ½(iL1 − iL2) over the samples where neither device conducts
  let si = 0
  let ni = 0
  for (let k = from + 1; k < r.length; k++)
    if (!r.devices[0].on[k] && !r.devices[1].on[k]) {
      si += 0.5 * (r.signals.il1[k] - r.signals.il2[k])
      ni++
    }
  const iScale = Math.max(Math.abs(avg(r, 'il1')), Math.abs(avg(r, 'il2')), 1e-3)
  let reverseTurnOff = false
  for (const e of r.events) {
    if (e.kind !== 'gate-off' || e.time < t0 - p.dt * 1e-6) continue
    // the last sample at or before the edge: Q1 still ON there
    const k = Math.min(r.length - 1, Math.max(0, Math.floor(e.time / p.dt + 1e-6)))
    if (r.signals.il1[k] + r.signals.il2[k] < -1e-3 * iScale) reverseTurnOff = true
  }
  return {
    t0,
    t1,
    periods: Math.round((t1 - t0) / p.ts),
    steady: r.diagnostics.steady.converged,
    voutAvg: avg(r, 'vout'),
    voutMax,
    voutMin,
    voutPP: voutMax - voutMin,
    il1Avg: avg(r, 'il1'),
    il1Max,
    il1Min,
    il1PP: il1Max - il1Min,
    il2Avg: avg(r, 'il2'),
    il2Max,
    il2Min,
    il2PP: il2Max - il2Min,
    vc1Avg: avg(r, 'vc1'),
    vc1Max,
    vc1Min,
    vc1PP: vc1Max - vc1Min,
    ioAvg: avg(r, 'io'),
    iinAvg: avg(r, 'iin'),
    iinPP: iinMax - iinMin,
    iinMin,
    iqAvg: avg(r, 'iq'),
    iqRms: rmsOf(r, 'iq', (x) => x * x),
    iqPeak,
    idAvg: avg(r, 'id'),
    idRms: rmsOf(r, 'id', (x) => x * x),
    idPeak,
    icRms: rmsOf(r, 'ic', (x) => x * x),
    vqMax,
    vdReverseMax: -vdMin,
    pinAvg,
    poutAvg,
    losses,
    efficiency: poutAvg / (poutAvg + losses.total),
    d2,
    d3: dcm ? avg(r, 'idle') : 0,
    dutyMeasured: duty,
    mode: dcm ? 'DCM' : 'CCM',
    elMax,
    ecAvg: avg(r, 'ec'),
    idleCurrent: ni ? si / ni : 0,
    reverseTurnOff,
  }
}

export interface BidiMeasurements {
  t0: number
  t1: number
  periods: number
  steady: boolean
  vlvAvg: number
  vlvMax: number
  vlvMin: number
  vlvPP: number
  ilAvg: number
  ilMax: number
  ilMin: number
  ilPP: number
  ibAvg: number
  ihvAvg: number
  /** Average power out of the bus (+ bus → converter, − converter → bus). */
  phvAvg: number
  /** Average power into the battery terminals (+ charging). */
  plvAvg: number
  /** Power into the battery EMF (stored chemically) and lost in its resistance. */
  pbatAvg: number
  prbAvg: number
  losses: { sw: number; dio: number; dcr: number; esr: number; total: number }
  efficiency: number
  /** The direction power actually flows (from the sign of the bus power). */
  direction: 'buck' | 'boost'
  /** iL changes sign inside the period. */
  reverses: boolean
  /** Fraction of the period an antiparallel diode conducts. */
  diodeFraction: number
  /** Duty of Q1 measured from its gate (command), and the error of the battery current against the reference. */
  dutyMeasured: number
  irefError: number
  elMax: number
  iq1Rms: number
  iq2Rms: number
  vswAvg: number
}

export function measureBidi(r: BidiRun): BidiMeasurements {
  const p = r.params
  const from = r.steadyFrom
  const t0 = r.time[from]
  const t1 = r.time[r.length - 1]
  const [vlvMin, vlvMax] = extremes(r, 'vlv')
  const [ilMin, ilMax] = extremes(r, 'il')
  const [, elMax] = extremes(r, 'el')
  const losses = { sw: avg(r, 'psw'), dio: avg(r, 'pdio'), dcr: avg(r, 'pdcr'), esr: avg(r, 'pesr'), total: 0 }
  losses.total = losses.sw + losses.dio + losses.dcr + losses.esr
  const phvAvg = avg(r, 'phv')
  const plvAvg = avg(r, 'plv')
  const buck = phvAvg >= 0
  const pOut = buck ? plvAvg : -phvAvg
  const ibAvg = avg(r, 'ib')
  return {
    t0,
    t1,
    periods: Math.round((t1 - t0) / p.ts),
    steady: r.diagnostics.steady.converged,
    vlvAvg: avg(r, 'vlv'),
    vlvMax,
    vlvMin,
    vlvPP: vlvMax - vlvMin,
    ilAvg: avg(r, 'il'),
    ilMax,
    ilMin,
    ilPP: ilMax - ilMin,
    ibAvg,
    ihvAvg: avg(r, 'ihv'),
    phvAvg,
    plvAvg,
    pbatAvg: avg(r, 'pbat'),
    prbAvg: avg(r, 'prb'),
    losses,
    efficiency: pOut / (pOut + losses.total),
    direction: buck ? 'buck' : 'boost',
    reverses: ilMin < 0 && ilMax > 0,
    diodeFraction: avg(r, 'dio'),
    dutyMeasured: avg(r, 'gate1'),
    irefError: ibAvg - p.irefSigned,
    elMax,
    iq1Rms: rmsOf(r, 'iq1', (x) => x * x),
    iq2Rms: rmsOf(r, 'iq2', (x) => x * x),
    vswAvg: avg(r, 'vsw'),
  }
}
