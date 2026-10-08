import type { CompareResult, CompareRow, TextbookValue } from '../../lab/types.ts'
import { besselJ, fourier, rmsOf, thdFrom, type Harmonic, type Segment } from '../fourier.ts'
import { gateFromEdges, levelOf, type PwmRun, type ResolvedPwm } from './modulator.ts'

/**
 * PWM measurements (SIMULATION): from the simulated pulse train — its exact edges — by exact
 * Fourier integrals of the piecewise-constant waveform. And the THEORY it is compared with, derived
 * independently: the Fourier series of a pulse train (DC reference) and the Bessel double-Fourier
 * series of sine-triangle PWM (natural and symmetric regular sampling, Holmes & Lipo).
 */
export interface PwmMeasurements {
  avg: number
  rms: number
  /** Fundamental (of the steady-state period) peak amplitude. */
  v1: number
  thd: number
  harmonics: Harmonic[]
  /** Pulses (ON intervals) per steady-state period, and the narrowest one [s]. */
  pulses: number
  minPulse: number
  /** DC reference: measured duty of one carrier period. */
  dutyMeasured: number
  /** Sine reference: carrier periods without any switching (overmodulation pulse dropping). */
  dropped: number
  /** Amplitude at selected harmonic orders, for tables and experiments. */
  at: Record<number, number>
  /** Lowest harmonic order (≥ 2) with amplitude above 1 % of the fundamental. */
  firstSignificant: number
  /** 3rd and 5th harmonic amplitudes (baseband distortion). */
  h3: number
  h5: number
}

export function segmentsOf(r: PwmRun): Segment[] {
  const p = r.params
  const P = p.period
  const segs: Segment[] = []
  let t = 0
  let v = levelOf(p, gateFromEdges(r.edges, P, 0))
  for (const e of r.edges) {
    if (e.t > t) segs.push({ ta: t, tb: e.t, va: v, vb: v })
    t = e.t
    v = levelOf(p, e.rising)
  }
  if (P > t) segs.push({ ta: t, tb: P, va: v, vb: v })
  return segs
}

export function hMaxOf(p: ResolvedPwm): number {
  return p.reference === 'sine' ? 4 * p.mf + 8 : 15
}

export function measurePwm(r: PwmRun): PwmMeasurements {
  const p = r.params
  const segs = segmentsOf(r)
  const harmonics = fourier(segs, p.period, hMaxOf(p))
  const avg = harmonics[0].amp
  const rms = rmsOf(segs, p.period)
  const v1 = harmonics[1].amp
  const ons = segs.filter((s) => s.va === levelOf(p, true) && s.tb > s.ta)
  // Merge an ON segment wrapping around the period end.
  let pulses = ons.length
  if (ons.length > 1 && ons[0].ta === 0 && ons[ons.length - 1].tb === p.period) pulses--
  const minPulse = ons.length ? Math.min(...ons.map((s) => s.tb - s.ta)) : 0
  const nC = Math.round(p.period / p.tc)
  let dropped = 0
  for (let k = 0; k < nC; k++) if (!r.edges.some((e) => e.t >= k * p.tc - 1e-15 && e.t < (k + 1) * p.tc - 1e-15)) dropped++
  const onTime = ons.reduce((s, x) => s + x.tb - x.ta, 0)
  const at: Record<number, number> = {}
  for (const h of harmonics) at[h.h] = h.amp
  let firstSignificant = 0
  for (const h of harmonics) if (h.h >= 2 && h.amp > 0.01 * Math.max(v1, 1e-12)) {
    firstSignificant = h.h
    break
  }
  return {
    avg,
    rms,
    v1,
    thd: thdFrom(rms, avg, v1),
    harmonics,
    pulses,
    minPulse,
    dutyMeasured: onTime / p.period,
    dropped: p.reference === 'sine' ? dropped : 0,
    at,
    firstSignificant,
    h3: at[3] ?? 0,
    h5: at[5] ?? 0,
  }
}

/** Effective (quantised) duty of a DC reference. */
export function dutyEffective(p: ResolvedPwm): number {
  if (!p.bits || p.sampling === 'natural') return p.duty
  const n = 2 ** p.bits
  return Math.round(p.duty * n) / n
}

/**
 * THEORY: amplitude of harmonic h (of the steady-state period).
 *  DC reference (pulse train, peak-to-peak Vdc):  |c_h| = (2·Vdc/(h·π))·|sin(h·π·D)|
 *  Sine reference M·cos(ω0·t + θ0) (here θ0 = −π/2), triangle carrier with its valley at t = 0, two-level
 *  output (Holmes & Lipo double Fourier series, x = ωc·t, y = ω0·t + θ0, Σ over m ≥ 0 and all n):
 *    natural:             (Vdc/2)·M·cos y + (2Vdc/π)·Σm≥1 (1/m)·J_n(m·π·M/2)·sin((m+n)·π/2)·cos(m·x + n·y)
 *    regular symmetric:   (2Vdc/π)·(1/q)·J_n(q·π·M/2)·sin((q+n)·π/2)·cos(m·x + n·(y − ω0·Tc/2))
 *    regular asymmetric:  (2Vdc/π)·(1/q)·J_n(q·π·M/2)·sin((m+n)·π/2)·cos(m·x + n·(y − ω0·Tc/4))
 *    with q = m + n/mf (and for m = 0 only n ≥ 1: the baseband harmonics regular sampling creates).
 *  Every (m, n) term at the same frequency |m·mf + n| is added as a phasor. Returns null where no
 *  closed form is provided (sawtooth carrier with a sine, digital resolution, overmodulation M > 1).
 */
export function pwmTheoryAmp(p: ResolvedPwm, h: number): number | null {
  if (p.reference === 'dc') {
    const D = dutyEffective(p)
    if (h === 0) return p.output === 'bipolar' ? ((2 * D - 1) * p.vdc) / 2 : D * p.vdc
    return ((2 * p.vdc) / (h * Math.PI)) * Math.abs(Math.sin(h * Math.PI * D))
  }
  if (p.carrier !== 'triangle' || p.bits || p.m > 1) return null
  if (h === 0) return p.output === 'unipolar' ? p.vdc / 2 : 0
  const ph = pwmTheoryPhasor(p, h)
  return Math.hypot(ph[0], ph[1])
}

export function pwmTheoryPhasor(p: Pick<ResolvedPwm, 'm' | 'mf' | 'sampling' | 'vdc'>, h: number, th0 = -Math.PI / 2): [number, number] {
  const M = p.m
  const mf = p.mf
  const regular = p.sampling !== 'natural'
  const sym = p.sampling === 'regular-sym'
  const k = (2 * p.vdc) / Math.PI
  let re = 0
  let im = 0
  const add = (amp: number, phase: number, freq: number) => {
    const s = freq < 0 ? -1 : 1
    re += amp * Math.cos(s * phase)
    im += amp * Math.sin(s * phase)
  }
  if (!regular && h === 1) add((p.vdc / 2) * M, th0, 1)
  const mMax = Math.ceil(h / mf) + 4
  for (let m = 0; m <= mMax; m++) {
    for (const target of [h, -h]) {
      const n = target - m * mf
      if (Math.abs(n) > 60) continue
      if (m === 0 && (!regular || n < 1)) continue
      const q = regular ? m + n / mf : m
      const s = sym ? Math.sin(((q + n) * Math.PI) / 2) : Math.sin(((m + n) * Math.PI) / 2)
      const amp = k * (1 / q) * besselJ(n, (q * Math.PI * M) / 2) * s
      // The sample is taken before the pulse centre: Tc/2 (symmetric) or effectively Tc/4 (asymmetric) —
      // a phase of −n·ω0·delay in y.
      const delay = sym ? (-n * Math.PI) / mf : regular ? (-n * Math.PI) / (2 * mf) : 0
      add(amp, n * th0 + delay, target)
    }
  }
  return [re, im]
}

/** Textbook relations for the PWM lab (ideal, with assumptions). */
export function pwmTextbook(p: ResolvedPwm): Record<string, TextbookValue> {
  const out: Record<string, TextbookValue> = {}
  if (p.reference === 'dc') {
    const D = dutyEffective(p)
    out.avg = { key: 'avg', value: p.output === 'bipolar' ? ((2 * D - 1) * p.vdc) / 2 : D * p.vdc, formula: p.output === 'bipolar' ? 'Vavg = (2D − 1)·Vdc/2' : 'Vavg = D·Vdc', assumptions: ['ideal comparator and output stage'] }
    out.rms = { key: 'rms', value: p.output === 'bipolar' ? p.vdc / 2 : p.vdc * Math.sqrt(D), formula: p.output === 'bipolar' ? 'Vrms = Vdc/2' : 'Vrms = Vdc·√D', assumptions: ['ideal output stage'] }
    out.v1 = { key: 'v1', value: ((2 * p.vdc) / Math.PI) * Math.abs(Math.sin(Math.PI * D)), formula: 'V1 = (2·Vdc/π)·|sin(π·D)|  (at fc)', assumptions: ['pulse train of period Tc'] }
    out.duty = { key: 'duty', value: D, formula: p.bits && p.sampling !== 'natural' ? `D quantised to 1/2^${p.bits}` : 'D = (r + 1)/2', assumptions: ['carrier from −1 to +1'] }
    return out
  }
  const lin = p.m <= 1
  out.v1 = {
    key: 'v1',
    value: (p.m * p.vdc) / 2,
    formula: 'V1 = M·Vdc/2 (two-level leg)',
    assumptions: ['linear modulation (M ≤ 1)', 'natural sampling (regular sampling: approximately)'],
    notApplicable: lin ? undefined : 'Overmodulation (M > 1): pulses drop and the fundamental grows less than in proportion.',
  }
  out.rms = { key: 'rms', value: p.output === 'bipolar' ? p.vdc / 2 : p.vdc / Math.SQRT2, formula: p.output === 'bipolar' ? 'Vrms = Vdc/2' : 'Vrms = Vdc/√2 (mean duty ½)', assumptions: ['ideal output stage', ...(p.output === 'unipolar' ? ['symmetric reference'] : [])] }
  out.low = {
    key: 'low',
    value: 0,
    formula: 'no harmonics below the first carrier group',
    assumptions: ['natural sampling', 'mf ≫ 1'],
    notApplicable: p.sampling !== 'natural' ? 'Regular sampling adds small baseband harmonics (see the exact solution).' : lin ? undefined : 'Overmodulation adds low-order harmonics.',
  }
  return out
}

function row(key: string, label: string, unit: string, sim: number, exact: number | null, tol: number, tb: TextbookValue | null, scale: number, absolute = false): CompareRow | null {
  if (exact === null) return null
  const error = absolute ? Math.abs(sim - exact) : Math.abs(sim - exact) / Math.max(scale, 1e-12)
  const tbErr = tb && tb.value !== null && !tb.notApplicable ? (Math.abs(tb.value) > 1e-12 ? (sim - tb.value) / Math.abs(tb.value) : sim - tb.value) : null
  return { key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, absolute, textbook: tb, textbookError: tbErr }
}

/** Tolerance: the simulation's edges are exact to the root finder's precision, so agreement is ~10⁻⁹. */
const TOL = 1e-6

export function comparePwm(r: PwmRun, m: PwmMeasurements): CompareResult {
  const p = r.params
  const tb = pwmTextbook(p)
  const scale = p.vdc
  const rows: Array<CompareRow | null> = []
  if (p.reference === 'dc') {
    const D = dutyEffective(p)
    rows.push(row('duty', 'Duty D', '%', m.dutyMeasured, D, TOL, tb.duty, 1, true))
    rows.push(row('avg', 'Average voltage', 'V', m.avg, pwmTheoryAmp(p, 0), TOL, tb.avg, scale))
    rows.push(row('rms', 'RMS voltage', 'V', m.rms, p.output === 'bipolar' ? p.vdc / 2 : p.vdc * Math.sqrt(D), TOL, tb.rms, scale))
    for (const h of [1, 2, 3]) rows.push(row(`h${h}`, `Harmonic ${h}·fc`, 'V', m.at[h] ?? 0, pwmTheoryAmp(p, h), TOL, h === 1 ? tb.v1 : null, scale))
  } else {
    const mf = p.mf
    rows.push(row('v1', 'Fundamental V1 (peak)', 'V', m.v1, pwmTheoryAmp(p, 1), TOL, tb.v1, scale))
    rows.push(row('rms', 'RMS voltage', 'V', m.rms, tb.rms.value, TOL, tb.rms, scale))
    for (const h of [3, 5]) rows.push(row(`h${h}`, `Harmonic ${h} (baseband)`, 'V', m.at[h] ?? 0, pwmTheoryAmp(p, h), TOL, h === 3 ? tb.low : null, scale))
    for (const h of [mf - 2, mf, mf + 2, 2 * mf - 1, 2 * mf + 1]) rows.push(row(`h${h}`, `Harmonic ${h}${h === mf ? ' (= mf)' : ''}`, 'V', m.at[h] ?? 0, pwmTheoryAmp(p, h), TOL, null, scale))
  }
  const list = rows.filter((x): x is CompareRow => x !== null)
  const header =
    p.reference === 'dc'
      ? `Pulse train of one carrier period (fc = ${p.fc} Hz). Harmonics are multiples of fc. SIMULATION = exact Fourier integrals of the simulated pulses.`
      : `One fundamental cycle (f1 = ${p.f1} Hz, mf = ${p.mf}, M = ${p.m}). SIMULATION = exact Fourier integrals of the simulated pulses.`
  const note =
    list.length < (p.reference === 'dc' ? 6 : 9)
      ? 'Rows without a closed form here (asymmetric sampling, sawtooth carrier with a sine reference, digital resolution, overmodulation) show the simulation only — see Spectrum.'
      : undefined
  return { rows: list, allPass: list.every((x) => x.pass), header, note }
}
