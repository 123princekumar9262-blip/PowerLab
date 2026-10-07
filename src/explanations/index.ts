import type { CircuitEvent, CircuitId, SimulationResult } from '../types/simulation.ts'
import {
  explainEventHalfWaveR,
  explainHalfWaveR,
  type EventExplanation,
  type StateExplanation,
} from './halfWaveR.ts'

export type { CausalStep, CausalStage, EventExplanation, StateExplanation } from './halfWaveR.ts'
export { eventTitle } from './halfWaveR.ts'

interface Explainer {
  state(result: SimulationResult, index: number): StateExplanation
  event(result: SimulationResult, e: CircuitEvent): EventExplanation
}

/** One explainer per circuit; later phases register their own here. */
const EXPLAINERS: Partial<Record<CircuitId, Explainer>> = {
  'half-wave:R': { state: explainHalfWaveR, event: explainEventHalfWaveR },
}

export function getExplainer(id: CircuitId): Explainer {
  const e = EXPLAINERS[id]
  if (!e) throw new Error(`No explainer for ${id}`)
  return e
}
