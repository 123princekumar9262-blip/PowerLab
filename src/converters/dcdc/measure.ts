import type { ConverterResult } from '../types.ts'

/**
 * Measurements of a DC-DC simulation (buck, boost, buck-boost) — every value is computed from the simulated trace and its
 * events (label: SIMULATION). Nothing here uses a formula for the converter.
 *
 * Window: the whole steady-state run (an integer number of periods), or the last period of a
 * start-up run.
 *
 * Quadrature. Sample k is the backward-Euler solution at the END of interval (t[k−1], t[k]],
 * solved with the switch/diode state of that interval. Continuous quantities (iL, vC, vout) vary
 * almost linearly inside an interval, so averages use the trapezoid rule; a device current is iL
 * while that device conducts, so its average is the trapezoid of iL over the intervals where the
 * device is ON (the state stored at the interval's end sample).
 */
export interface DcdcMeasurements {
  /** Window [s] and periods. */
  t0: number
  t1: number
  periods: number
  steady: boolean
  voutAvg: number
  voutMax: number
  voutMin: number
  voutPP: number
  ilAvg: number
  ilMax: number
  ilMin: number
  ilPP: number
  ioAvg: number
  icRms: number
  iqAvg: number
  iqRms: number
  iqPeak: number
  idAvg: number
  idRms: number
  /** Largest voltage the switch blocks, and the diode's largest reverse voltage (positive number). */
  vqMax: number
  vdReverseMax: number
  pinAvg: number
  poutAvg: number
  /** Measured dissipation in the switch, diode, DCR and ESR. */
  losses: { q: number; d: number; dcr: number; esr: number; total: number }
  /** η = Pout / (Pout + measured losses). See docs: excludes the integrator's own numerical dissipation. */
  efficiency: number
  /** Timing from the switching events: D = ton/Ts, fs, D2 = diode conduction / Ts, D3 = idle / Ts. */
  dutyMeasured: number
  fsMeasured: number
  d2: number
  d3: number
  mode: 'CCM' | 'DCM'
  elMax: number
  elMin: number
  ecAvg: number
  /** Energy taken from the source in one period [J] = Pin·Ts. */
  energyPerPeriod: number
}

export function measureDcdc(r: ConverterResult): DcdcMeasurements {
  const p = r.params
  const from = r.steadyFrom
  const to = r.length - 1
  const { il, vout, ic, vq, vd, el, ec } = r.signals
  const qOn = r.devices[0].on
  const dOn = r.devices[1].on
  const dt = p.dt
  const T = r.time[to] - r.time[from]
  // Trapezoid of f(k) over intervals (k−1, k], optionally only where mask[k] = 1.
  const trap = (f: (k: number) => number, mask?: Uint8Array) => {
    let s = 0
    for (let k = from + 1; k <= to; k++) if (!mask || mask[k]) s += 0.5 * (f(k - 1) + f(k)) * dt
    return s / T
  }
  const ext = (a: Float64Array) => {
    let lo = Infinity
    let hi = -Infinity
    for (let k = from; k <= to; k++) {
      lo = Math.min(lo, a[k])
      hi = Math.max(hi, a[k])
    }
    return [lo, hi]
  }
  const [voutMin, voutMax] = ext(vout)
  const [ilMin, ilMax] = ext(il)
  const [, vqMax] = ext(vq)
  const [vdMin] = ext(vd)
  const [elMin, elMax] = ext(el)
  const voutAvg = trap((k) => vout[k])
  const ilAvg = trap((k) => il[k])
  const iqAvg = trap((k) => il[k], qOn)
  const iq2 = trap((k) => il[k] * il[k], qOn)
  const idAvg = trap((k) => il[k], dOn)
  const id2 = trap((k) => il[k] * il[k], dOn)
  const ic2 = trap((k) => ic[k] * ic[k])
  const poutAvg = trap((k) => (vout[k] * vout[k]) / p.r)
  // Source current: iQ for the buck and the buck-boost; iL itself for the boost (L sits in series with Vin).
  const pinAvg = p.vin * (p.kind === 'boost' ? ilAvg : iqAvg)
  const losses = {
    q: p.q.ron * iq2,
    d: p.d.vf * idAvg + p.d.ron * id2,
    dcr: p.rl * trap((k) => il[k] * il[k]),
    esr: p.esr * ic2,
    total: 0,
  }
  losses.total = losses.q + losses.d + losses.dcr + losses.esr

  // Timing from events inside the window.
  const t0 = r.time[from]
  const t1 = r.time[to]
  const ev = r.events.filter((e) => e.time >= t0 - dt * 1e-6 && e.time <= t1 + dt * 1e-6)
  const ons = ev.filter((e) => e.kind === 'gate-on').map((e) => e.time)
  const offs = ev.filter((e) => e.kind === 'gate-off').map((e) => e.time)
  let tonSum = 0
  let nTon = 0
  for (const a of ons) {
    const b = offs.find((x) => x > a)
    if (b !== undefined && b <= t1 + dt * 1e-6) {
      tonSum += b - a
      nTon++
    }
  }
  const periodsFromEvents = ons.length >= 2 ? (ons[ons.length - 1] - ons[0]) / (ons.length - 1) : p.ts
  // Diode conduction: from each diode-on to the next diode-off.
  const dOnT = ev.filter((e) => e.kind === 'diode-on').map((e) => e.time)
  const dOffT = ev.filter((e) => e.kind === 'diode-off').map((e) => e.time)
  let dSum = 0
  for (const a of dOnT) {
    const b = dOffT.find((x) => x > a) ?? t1
    dSum += Math.min(b, t1) - a
  }
  const periods = Math.round(T / p.ts)
  const dutyMeasured = nTon ? tonSum / nTon / periodsFromEvents : NaN
  const d2 = dSum / T
  const dcm = ev.some((e) => e.kind === 'il-zero')
  return {
    t0,
    t1,
    periods,
    steady: r.diagnostics.steady.converged,
    voutAvg,
    voutMax,
    voutMin,
    voutPP: voutMax - voutMin,
    ilAvg,
    ilMax,
    ilMin: dcm ? Math.max(0, ilMin) : ilMin,
    ilPP: ilMax - ilMin,
    ioAvg: voutAvg / p.r,
    icRms: Math.sqrt(ic2),
    iqAvg,
    iqRms: Math.sqrt(iq2),
    iqPeak: ilMax,
    idAvg,
    idRms: Math.sqrt(id2),
    vqMax,
    vdReverseMax: -vdMin,
    pinAvg,
    poutAvg,
    losses,
    efficiency: poutAvg / (poutAvg + losses.total),
    dutyMeasured,
    fsMeasured: 1 / periodsFromEvents,
    d2,
    d3: dcm ? Math.max(0, 1 - dutyMeasured - d2) : 0,
    mode: dcm ? 'DCM' : 'CCM',
    elMax,
    elMin,
    ecAvg: trap((k) => ec[k]),
    energyPerPeriod: pinAvg * p.ts,
  }
}

/** Average of a column over the measurement window (trapezoid). */
export function windowAverage(r: ConverterResult, a: Float64Array): number {
  let s = 0
  for (let k = r.steadyFrom + 1; k < r.length; k++) s += 0.5 * (a[k - 1] + a[k])
  return s / (r.length - 1 - r.steadyFrom)
}

export type BuckMeasurements = DcdcMeasurements
export const measureBuck = measureDcdc
