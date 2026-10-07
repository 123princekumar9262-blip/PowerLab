import type { SimulationResult } from '../types/simulation.ts'
import { integrateWindow, lowerIndex } from './integrate.ts'

/** Quantities measured from the simulated waveforms (not from formulas). */
export interface Measurements {
  /** Measurement window: the last full source cycle (steady state). */
  window: { t0: number; t1: number }
  vinPeak: number
  vinRms: number
  voutPeak: number
  /** DC (average) output voltage Vdc = (1/T)∫vout dt. */
  voutAvg: number
  voutRms: number
  ioAvg: number
  ioRms: number
  ioPeak: number
  /** Peak inverse voltage seen by the diode = max(−vD) [V]. */
  piv: number
  /** Average power delivered to the load P = (1/T)∫vout·io dt [W]. */
  loadPower: number
  /** Conduction angle per cycle [degrees], from the refined diode ON/OFF event times. */
  conductionAngleDeg: number
  /** Fundamental frequency of the output pulses [Hz], from spacing between current pulses; null if fewer than two pulses. */
  rippleFrequency: number | null
}

export function measure(result: SimulationResult): Measurements {
  const { trace, params, events } = result
  const { time } = trace
  const { vin, vout, vd, io } = trace.signals
  const T = params.period
  const t1 = params.duration
  const t0 = Math.max(0, t1 - T)
  const span = t1 - t0

  // Averages and RMS over one full period: X_avg = (1/T)∫x dt,  X_rms = √((1/T)∫x² dt).
  const avg = (x: Float64Array) => integrateWindow(time, (i) => x[i], t0, t1) / span
  const rms = (x: Float64Array) => Math.sqrt(Math.max(0, integrateWindow(time, (i) => x[i] * x[i], t0, t1) / span))

  // Extremes over the samples inside the window.
  const i0 = lowerIndex(time, t0)
  const i1 = trace.length - 1
  let vinPeak = -Infinity
  let voutPeak = -Infinity
  let ioPeak = -Infinity
  let piv = 0
  for (let i = i0; i <= i1; i++) {
    if (vin[i] > vinPeak) vinPeak = vin[i]
    if (vout[i] > voutPeak) voutPeak = vout[i]
    if (io[i] > ioPeak) ioPeak = io[i]
    if (-vd[i] > piv) piv = -vd[i]
  }

  // Conduction time: walk the window, toggling at each refined diode event.
  const d1 = trace.diodes[0]
  let on = d1.on[lowerIndex(time, t0)] === 1
  let cursor = t0
  let conducting = 0
  for (const e of events) {
    if (e.device !== 'D1' || e.time <= t0 || e.time > t1) continue
    if (e.kind === 'diode-on' && !on) {
      on = true
      cursor = e.time
    } else if (e.kind === 'diode-off' && on) {
      conducting += e.time - cursor
      on = false
    }
  }
  if (on) conducting += t1 - cursor
  const conductionAngleDeg = (conducting / T) * 360

  // Ripple frequency: the output repeats once per current pulse. Use the mean
  // spacing of current-start events over the whole run.
  const starts = events.filter((e) => e.kind === 'current-start').map((e) => e.time)
  const rippleFrequency = starts.length >= 2 ? (starts.length - 1) / (starts[starts.length - 1] - starts[0]) : null

  return {
    window: { t0, t1 },
    vinPeak,
    vinRms: rms(vin),
    voutPeak,
    voutAvg: avg(vout),
    voutRms: rms(vout),
    ioAvg: avg(io),
    ioRms: rms(io),
    ioPeak,
    piv,
    loadPower: integrateWindow(time, (i) => vout[i] * io[i], t0, t1) / span,
    conductionAngleDeg,
    rippleFrequency,
  }
}
