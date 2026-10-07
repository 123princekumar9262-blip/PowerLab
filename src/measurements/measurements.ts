import type { SignalId, SimulationResult } from '../types/simulation.ts'
import { integrateWindow, lowerIndex } from './integrate.ts'

/** Relative cycle-to-cycle change of Vdc below which the run counts as steady state. */
export const STEADY_STATE_TOLERANCE = 1e-3

/** Quantities measured from the simulated waveforms (not from formulas). */
export interface Measurements {
  /** Measurement window: the last full source cycle. */
  window: { t0: number; t1: number }
  /** Steady state: Vdc of the last cycle vs the cycle before. */
  steady: { reached: boolean; change: number | null }
  vinPeak: number
  vinRms: number
  /** Three-phase: measured phase RMS (phase a) and line-to-line RMS (a−b); null for single-phase. */
  vphRms: number | null
  vllRms: number | null
  voutPeak: number
  voutMin: number
  /** DC (average) output voltage Vdc = (1/T)∫vout dt. */
  voutAvg: number
  voutRms: number
  /** Peak-to-peak output ripple, max(vout) − min(vout). */
  ripplePP: number
  /** Ripple factor = Vac,rms / Vdc, with Vac,rms = √(Vrms² − Vdc²). */
  rippleFactor: number | null
  formFactor: number | null
  ioAvg: number
  ioRms: number
  ioPeak: number
  /** D1 current statistics. */
  idPeak: number
  idAvg: number
  idRms: number
  /** Peak inverse voltage over all diodes = max(−vD) [V]. */
  piv: number
  /** Average powers over the window [W]. */
  sourcePower: number
  loadPower: number
  diodeLoss: number
  /** Change of stored energy (L + C) over the window [J] — zero in steady state. */
  storedEnergyChange: number
  /** η = P_load / P_source. */
  efficiency: number | null
  /** D1 conduction per cycle [degrees], from the refined ON/OFF event times. */
  conductionAngleDeg: number
  /** Source angle at which D1 starts conducting (last full pulse) [degrees, 0–360). */
  turnOnAngleDeg: number | null
  /** Source angle at which that pulse ends — the extinction angle β [degrees, measured from the same cycle's 0°]. */
  turnOffAngleDeg: number | null
  /** Minimum rectifier output current over the window (L loads): > 0 means continuous conduction. */
  rectCurrentMin: number | null
  /** Fundamental frequency of the output ripple [Hz]; null if vout has no ripple crests. */
  rippleFrequency: number | null
}

const deg = (rad: number) => (rad * 180) / Math.PI

export function measure(result: SimulationResult): Measurements {
  const { trace, params: p, events } = result
  const { time } = trace
  const S = trace.signals
  const zeros = new Float64Array(trace.length)
  const sig = (id: SignalId) => S[id] ?? zeros
  const vin = sig('vin')
  const vout = sig('vout')
  const io = sig('io')
  const T = p.period
  const t1 = p.duration
  const t0 = Math.max(0, t1 - T)
  const span = t1 - t0

  // Averages and RMS over one full period: X_avg = (1/T)∫x dt,  X_rms = √((1/T)∫x² dt).
  const avgOver = (x: Float64Array, a: number, b: number) => integrateWindow(time, (i) => x[i], a, b) / (b - a)
  const avg = (x: Float64Array) => avgOver(x, t0, t1)
  const rms = (x: Float64Array) => Math.sqrt(Math.max(0, integrateWindow(time, (i) => x[i] * x[i], t0, t1) / span))

  const i0 = lowerIndex(time, t0)
  const i1 = trace.length - 1
  const maxOf = (x: Float64Array) => {
    let m = -Infinity
    for (let i = i0; i <= i1; i++) if (x[i] > m) m = x[i]
    return m
  }
  const minOf = (x: Float64Array) => {
    let m = Infinity
    for (let i = i0; i <= i1; i++) if (x[i] < m) m = x[i]
    return m
  }

  let piv = 0
  for (const d of trace.diodes) for (let i = i0; i <= i1; i++) if (-d.voltage[i] > piv) piv = -d.voltage[i]

  const voutAvg = avg(vout)
  const voutRms = rms(vout)
  const vac = Math.sqrt(Math.max(0, voutRms * voutRms - voutAvg * voutAvg))
  const meaningful = Math.abs(voutAvg) > p.vm * 1e-9

  // Steady state: compare Vdc of the last cycle with the one before.
  let steady: Measurements['steady'] = { reached: false, change: null }
  if (t0 - T >= -1e-12) {
    const prev = avgOver(vout, Math.max(0, t0 - T), t0)
    const change = Math.abs(voutAvg - prev) / Math.max(Math.abs(voutAvg), p.vm * 1e-6)
    steady = { reached: change < STEADY_STATE_TOLERANCE, change }
  }

  // D1 conduction within the window: walk the window toggling at refined events.
  // Events within 10⁻⁹·T of the window start are the same instant as the start (an ideal
  // diode switches exactly at a zero crossing, which can land a few ulps either side of t₀),
  // so the state at t₀ is taken from the last D1 event up to t₀ + ε, not from a sample.
  const d1 = trace.diodes[0]
  // The reference diode: D1, or Da for the three-phase half-wave rectifier.
  const d1Id = d1.id
  const eps = T * 1e-9
  const d1All = events.filter((e) => e.device === d1Id && (e.kind === 'diode-on' || e.kind === 'diode-off'))
  const before = d1All.filter((e) => e.time <= t0 + eps).pop()
  let on = before ? before.kind === 'diode-on' : d1.on[i0] === 1
  let cursor = t0
  let conducting = 0
  for (const e of d1All) {
    if (e.time <= t0 + eps || e.time > t1) continue
    if (e.kind === 'diode-on' && !on) {
      on = true
      cursor = e.time
    } else if (e.kind === 'diode-off' && on) {
      conducting += e.time - cursor
      on = false
    }
  }
  if (on) conducting += t1 - cursor

  // Last complete D1 pulse (turn-on followed by turn-off) → turn-on angle and extinction angle β.
  let turnOnAngleDeg: number | null = null
  let turnOffAngleDeg: number | null = null
  const d1Events = events.filter((e) => e.device === d1Id)
  for (let k = d1Events.length - 1; k > 0; k--) {
    const off = d1Events[k]
    const onE = d1Events[k - 1]
    if (off.kind === 'diode-off' && onE.kind === 'diode-on' && onE.time > 0) {
      const thetaOn = (((deg(p.omega * onE.time + p.phase) % 360) + 360) % 360)
      turnOnAngleDeg = thetaOn
      turnOffAngleDeg = thetaOn + deg(p.omega * (off.time - onE.time))
      break
    }
  }

  // Rectifier output current (into the load from the diodes) for loads with an inductor.
  let rectCurrentMin: number | null = null
  if (S.il) rectCurrentMin = minOf(S.il)
  else if (p.load === 'RL') rectCurrentMin = minOf(io)

  // Ripple frequency: number of output crests per source cycle × f.
  let crests = 0
  const vspan = Math.max(...[maxOf(vout), -minOf(vout), 1e-12])
  const crestEps = vspan * 1e-9
  // Plateau-aware: a crest can span equal samples (e.g. a peak exactly midway between two).
  for (let i = Math.max(1, i0); i < i1; i++) {
    if (!(vout[i] > vout[i - 1] + crestEps)) continue
    let j = i + 1
    while (j < i1 && Math.abs(vout[j] - vout[i]) <= crestEps) j++
    if (vout[j] < vout[i] - crestEps) crests++
    i = j - 1
  }
  // A crest exactly at a window edge may be missed or doubled; snap to an integer count per cycle.
  const rippleFrequency = crests > 0 ? crests / T : null

  const wl = S.wl
  const wc = S.wc
  const storedAt = (i: number) => (wl ? wl[i] : 0) + (wc ? wc[i] : 0)
  const sourcePower = avg(sig('ps'))
  const loadPower = avg(sig('pload'))

  return {
    window: { t0, t1 },
    steady,
    vinPeak: maxOf(vin),
    vinRms: rms(vin),
    vphRms: S.vab ? rms(vin) : null,
    vllRms: S.vab ? rms(S.vab) : null,
    voutPeak: maxOf(vout),
    voutMin: minOf(vout),
    voutAvg,
    voutRms,
    ripplePP: maxOf(vout) - minOf(vout),
    rippleFactor: meaningful ? vac / Math.abs(voutAvg) : null,
    formFactor: meaningful ? voutRms / Math.abs(voutAvg) : null,
    ioAvg: avg(io),
    ioRms: rms(io),
    ioPeak: maxOf(io),
    idPeak: maxOf(d1.current),
    idAvg: avg(d1.current),
    idRms: rms(d1.current),
    piv,
    sourcePower,
    loadPower,
    diodeLoss: avg(sig('pd')),
    storedEnergyChange: storedAt(i1) - storedAt(i0),
    efficiency: sourcePower > 1e-15 ? loadPower / sourcePower : null,
    conductionAngleDeg: (conducting / T) * 360,
    turnOnAngleDeg,
    turnOffAngleDeg,
    rectCurrentMin,
    rippleFrequency,
  }
}
