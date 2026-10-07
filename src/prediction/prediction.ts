import type { Comparison } from '../measurements/compare.ts'
import type { Measurements } from '../measurements/measurements.ts'
import { DEFAULT_PARAMS } from '../simulation/params.ts'
import { indexAtTime } from '../simulation/engine.ts'
import type { LabParams, LoadType, RectifierTopology, SimulationResult } from '../types/simulation.ts'

/** Points across one source cycle used for sketching and scoring (2° resolution). */
export const SKETCH_POINTS = 180

export interface NumericQuestion {
  key: 'vdc' | 'gamma' | 'beta' | 'ripple'
  label: string
  unit: string
  /** The measured answer. */
  answer(m: Measurements): number | null
  /** Relative tolerance for full marks. */
  tol: number
}

export interface PredictionTask {
  topology: RectifierTopology
  load: LoadType
  params: LabParams
  questions: NumericQuestion[]
}

const Q: Record<NumericQuestion['key'], NumericQuestion> = {
  vdc: { key: 'vdc', label: 'Average output Vdc', unit: 'V', answer: (m) => m.voutAvg, tol: 0.1 },
  gamma: { key: 'gamma', label: 'D1 conduction angle γ', unit: '°', answer: (m) => m.conductionAngleDeg, tol: 0.1 },
  beta: { key: 'beta', label: 'Extinction angle β', unit: '°', answer: (m) => m.turnOffAngleDeg, tol: 0.05 },
  ripple: { key: 'ripple', label: 'Ripple, peak-to-peak', unit: 'V', answer: (m) => m.ripplePP, tol: 0.25 },
}

const QUESTIONS: Record<LoadType, NumericQuestion[]> = {
  R: [Q.vdc, Q.gamma],
  RL: [Q.vdc, Q.beta],
  RC: [Q.vdc, Q.ripple],
  RLC: [Q.vdc, Q.ripple],
}

/** A random but sensible prediction task (low-voltage, steady-state durations). */
export function randomTask(rand: () => number = Math.random, fixed?: { topology: RectifierTopology; load: LoadType }): PredictionTask {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const topology = fixed?.topology ?? pick(['half-wave', 'center-tap', 'bridge'] as const)
  const load = fixed?.load ?? pick(['R', 'RL', 'RC', 'RLC'] as const)
  const params: LabParams = {
    source: { ...DEFAULT_PARAMS.source, vrms: pick([6, 9, 12, 15]) },
    diode: { ...DEFAULT_PARAMS.diode, model: pick(['ideal', 'real'] as const) },
    load: { resistance: pick([10, 22, 47]), inductance: pick([0.02, 0.05, 0.1]), capacitance: pick([470e-6, 1000e-6, 2200e-6]) },
    sim: { ...DEFAULT_PARAMS.sim, cycles: load === 'RLC' ? 14 : 8 },
  }
  return { topology, load, params, questions: QUESTIONS[load] }
}

/** vin and vout over the last cycle, sampled at source angles 0°, 2°, … 358°. */
export function lastCycle(result: SimulationResult): { vin: number[]; vout: number[] } {
  const { period: T, duration, phase } = result.params
  const phiDeg = (phase * 180) / Math.PI
  const vin: number[] = []
  const vout: number[] = []
  for (let k = 0; k < SKETCH_POINTS; k++) {
    const theta = (k * 360) / SKETCH_POINTS
    const frac = ((((theta - phiDeg) / 360) % 1) + 1) % 1
    const i = indexAtTime(result, duration - T + frac * T)
    vin.push(result.trace.signals.vin![i])
    vout.push(result.trace.signals.vout![i])
  }
  return { vin, vout }
}

export interface SketchScore {
  /** 0–100: 100 = exact. Based on the RMS difference relative to Vm, over the drawn points. */
  match: number
  coverage: number
}

/** Score a sketch (null = not drawn at that angle) against the simulated output. */
export function scoreSketch(sketch: Array<number | null>, actual: number[], vm: number): SketchScore {
  let n = 0
  let se = 0
  for (let k = 0; k < actual.length; k++) {
    const y = sketch[k]
    if (y === null || y === undefined) continue
    n++
    se += (y - actual[k]) ** 2
  }
  const coverage = n / actual.length
  if (n === 0) return { match: 0, coverage: 0 }
  const rms = Math.sqrt(se / n)
  // An error of Vm/2 RMS (a badly wrong shape) scores 0; a perfect trace scores 100.
  const match = Math.max(0, 1 - rms / (0.5 * vm)) * 100
  return { match: match * Math.min(1, coverage / 0.8), coverage }
}

export function scoreNumber(guess: number | null, answer: number | null, tol: number): number | null {
  if (guess === null || answer === null || !Number.isFinite(guess)) return null
  const err = Math.abs(guess - answer) / Math.max(Math.abs(answer), 1e-9)
  return Math.max(0, 1 - err / (3 * tol)) * 100 * (err <= tol ? 1 : 0.8)
}

export function questionAnswers(task: PredictionTask, comparison: Comparison) {
  return task.questions.map((q) => ({ q, answer: q.answer(comparison.measurements) }))
}
