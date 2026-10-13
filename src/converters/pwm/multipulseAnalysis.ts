import type { CompareResult, CompareRow, TextbookValue } from '../../lab/types.ts'
import { fourier, rmsOf, thdFrom, type Harmonic } from '../fourier.ts'
import type { MultiPulseRun, ResolvedMultiPulse } from './multipulse.ts'

/**
 * UNIFORM MULTIPLE-PULSE PWM — measurements and theory.
 *  SIMULATION: from the simulated pulse train (its exact comparator edges), by exact Fourier integrals of the
 *  piecewise-constant waveform (the PWM lab's `fourier`), and the pulses read off the simulated segments.
 *  THEORY, independent of the comparator: the carrier is a 0…1 triangle, so it stays below M for a fraction M
 *  of every carrier period — p equal pulses of width δ = M·π/p per half cycle, centred on
 *  θk = (2k − 1)·π/(2p). Half-wave symmetry leaves only odd harmonics, with the textbook sum
 *    Bn = Σk (4·Vdc/(n·π))·sin(n·δ/2)·sin(n·θk)            (n odd; the sine series of vAB)
 *       = (4·Vdc/(n·π))·sin(n·δ/2)/sin(n·π/(2p))           (the sum in closed form)
 *  and Vrms = Vdc·√(p·δ/π).
 */
export interface MultiMeasurements {
  avg: number
  rms: number
  /** Fundamental (peak). */
  v1: number
  thd: number
  /** Distortion factor (Rashid): √(Σ_{n≥2} (Vn/n²)²)/V1, summed up to hMax — the harmonics left after a second-order filter. */
  df: number
  harmonics: Harmonic[]
  at: Record<number, number>
  /** Positive pulses in the first half cycle, and their measured width [deg] (mean, narrowest, widest). */
  pulses: number
  deltaDeg: number
  deltaMinDeg: number
  deltaMaxDeg: number
  /** Order and amplitude of the largest harmonic above the fundamental. */
  dominant: number
  dominantAmp: number
  /** Selected amplitudes (peak) and ratios to V1. */
  h3: number
  h5: number
  h3Ratio: number
  /** Largest of the two harmonics at 2p ± 1 (relative to V1). */
  hBandRatio: number
  /** Comparator switchings per cycle (gate edges). */
  switchings: number
}

export function hMaxMulti(p: Pick<ResolvedMultiPulse, 'p'>): number {
  return Math.max(41, 6 * p.p + 13)
}

export function measureMulti(r: MultiPulseRun): MultiMeasurements {
  const p = r.params
  const T = p.period
  const segs = r.segs
  const harmonics = fourier(segs, T, hMaxMulti(p))
  const rms = rmsOf(segs, T)
  const avg = harmonics[0].amp
  const v1 = harmonics[1].amp
  const at: Record<number, number> = {}
  for (const h of harmonics) at[h.h] = h.amp
  // pulses of +Vdc inside the first half cycle (the simulated segments)
  const pos = segs.filter((s) => s.va > 0 && s.ta < T / 2)
  const w = pos.map((s) => ((s.tb - s.ta) / T) * 360)
  let dominant = 0
  let dominantAmp = 0
  for (const h of harmonics) if (h.h >= 2 && h.amp > dominantAmp * (1 + 1e-9)) {
    dominant = h.h
    dominantAmp = h.amp
  }
  let s2 = 0
  for (const h of harmonics) if (h.h >= 2) s2 += (h.amp / (h.h * h.h)) ** 2
  const band = Math.max(at[2 * p.p - 1] ?? 0, at[2 * p.p + 1] ?? 0)
  return {
    avg,
    rms,
    v1,
    thd: thdFrom(rms, avg, v1),
    df: Math.sqrt(s2) / v1,
    harmonics,
    at,
    pulses: pos.length,
    deltaDeg: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0,
    deltaMinDeg: w.length ? Math.min(...w) : 0,
    deltaMaxDeg: w.length ? Math.max(...w) : 0,
    dominant,
    dominantAmp,
    h3: at[3] ?? 0,
    h5: at[5] ?? 0,
    h3Ratio: (at[3] ?? 0) / v1,
    hBandRatio: band / v1,
    switchings: r.edges.length,
  }
}

/** THEORY: pulse width δ [rad] from the comparator geometry. */
export const deltaTheory = (p: Pick<ResolvedMultiPulse, 'm' | 'p'>) => (p.m * Math.PI) / p.p

/** THEORY: the textbook sum Bn = Σk (4Vdc/(nπ))·sin(nδ/2)·sin(nθk), θk = (2k − 1)π/(2p) — the sine coefficient. */
export function bnSum(p: Pick<ResolvedMultiPulse, 'm' | 'p' | 'vdc'>, n: number): number {
  if (n <= 0 || n % 2 === 0) return 0
  const d = deltaTheory(p)
  let s = 0
  for (let k = 1; k <= p.p; k++) s += Math.sin((n * (2 * k - 1) * Math.PI) / (2 * p.p))
  return ((4 * p.vdc) / (n * Math.PI)) * Math.sin((n * d) / 2) * s
}

/** The same sum in closed form: Σk sin((2k − 1)x) = sin²(p·x)/sin x with x = nπ/(2p) (= 1/sin x for odd n). */
export function bnClosed(p: Pick<ResolvedMultiPulse, 'm' | 'p' | 'vdc'>, n: number): number {
  if (n <= 0 || n % 2 === 0) return 0
  return (((4 * p.vdc) / (n * Math.PI)) * Math.sin((n * deltaTheory(p)) / 2)) / Math.sin((n * Math.PI) / (2 * p.p))
}

export const vrmsTheory = (p: Pick<ResolvedMultiPulse, 'm' | 'p' | 'vdc'>) => p.vdc * Math.sqrt((p.p * deltaTheory(p)) / Math.PI)

/** Amplitude of harmonic h (THEORY), for the spectrum markers. */
export const multiTheoryAmp = (p: ResolvedMultiPulse, h: number): number | null => (h === 0 ? 0 : Math.abs(bnSum(p, h)))

export function multiTheoryThd(p: ResolvedMultiPulse): number {
  return thdFrom(vrmsTheory(p), 0, Math.abs(bnSum(p, 1)))
}

export function multiTheoryDf(p: ResolvedMultiPulse): number {
  let s2 = 0
  for (let n = 3; n <= hMaxMulti(p); n += 2) s2 += (bnSum(p, n) / (n * n)) ** 2
  return Math.sqrt(s2) / Math.abs(bnSum(p, 1))
}

export function multiTextbook(p: ResolvedMultiPulse): Record<string, TextbookValue> {
  const a = ['ideal switches', 'triangle carrier 0…1 at fc = 2p·f1', 'square-wave reference of amplitude M']
  const d = deltaTheory(p)
  return {
    delta: { key: 'delta', value: (d * 180) / Math.PI, formula: 'δ = M·π/p  (= M·180°/p)', assumptions: a },
    rms: { key: 'rms', value: vrmsTheory(p), formula: 'Vrms = Vdc·√(p·δ/π)  (= Vdc·√M)', assumptions: a },
    v1: { key: 'v1', value: Math.abs(bnSum(p, 1)), formula: 'B1 = Σk (4Vdc/π)·sin(δ/2)·sin θk', assumptions: [...a, 'θk = (2k − 1)·π/(2p)'] },
    band: { key: 'band', value: null, formula: 'largest harmonics at n = 2p ± 1 (where sin(nπ/2p) is small)', assumptions: ['p ≥ 2, moderate M'] },
  }
}

function row(key: string, label: string, unit: string, sim: number, exact: number, tol: number, scale: number, tb: TextbookValue | null = null, absolute = false): CompareRow {
  const error = absolute ? Math.abs(sim - exact) : Math.abs(sim - exact) / Math.max(scale, 1e-12)
  const tbErr = tb && tb.value !== null ? (Math.abs(tb.value) > 1e-12 ? (sim - tb.value) / Math.abs(tb.value) : sim - tb.value) : null
  return { key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol, absolute, textbook: tb, textbookError: tbErr }
}

/** The edges are exact to the bisection's precision: agreement is ~10⁻¹², so 10⁻⁶ of Vdc is a strict bound. */
const TOL = 1e-6

export function compareMulti(r: MultiPulseRun, m: MultiMeasurements): CompareResult {
  const p = r.params
  const tb = multiTextbook(p)
  const V = p.vdc
  const rows: CompareRow[] = []
  // At M = 1 the pulses touch and merge into one block per half cycle (a square wave).
  rows.push(row('pulses', 'Pulses per half cycle', '', m.pulses, p.m >= 1 ? 1 : p.p, 0, 1, null, true))
  rows.push(row('deltaDeg', p.m >= 1 ? 'Pulse width (merged: p·δ = 180°)' : 'Pulse width δ', '°', m.deltaDeg, p.m >= 1 ? 180 : (deltaTheory(p) * 180) / Math.PI, 1e-6, 1, tb.delta, true))
  rows.push(row('rms', 'RMS voltage', 'V', m.rms, vrmsTheory(p), TOL, V, tb.rms))
  rows.push(row('v1', 'Fundamental B1 (peak)', 'V', m.v1, Math.abs(bnSum(p, 1)), TOL, V, tb.v1))
  const hs = [3, 5, ...(p.p >= 2 ? [2 * p.p - 1, 2 * p.p + 1] : []), 7, 9].filter((h, i, a) => a.indexOf(h) === i).slice(0, 4)
  for (const h of hs) rows.push(row(`h${h}`, `Harmonic B${h}${p.p >= 2 && Math.abs(h - 2 * p.p) === 1 ? ' (2p ± 1)' : ''}`, 'V', m.at[h] ?? 0, Math.abs(bnSum(p, h)), TOL, V))
  rows.push(row('thd', 'THD', '%', m.thd, multiTheoryThd(p), 1e-6, 1, null, true))
  rows.push(row('df', `Distortion factor (n ≤ ${hMaxMulti(p)})`, '%', m.df, multiTheoryDf(p), 1e-6, 1, null, true))
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `One cycle (f1 = ${p.f1} Hz), p = ${p.p} pulses per half cycle, M = ${p.m}. SIMULATION = exact Fourier integrals of the simulated pulses; THEORY = the textbook Bn sum with δ = M·π/p.`,
  }
}
