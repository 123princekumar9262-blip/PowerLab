import type { CircuitEvent, CircuitId, SimulationResult } from '../types/simulation.ts'
import { explainEvent, explainState, type EventExplanation, type StateExplanation } from './rectifier.ts'

export type { CausalStage, CausalStep, EventExplanation, StateExplanation } from './rectifier.ts'
export { eventTitle } from './rectifier.ts'

interface Explainer {
  state(result: SimulationResult, index: number): StateExplanation
  event(result: SimulationResult, e: CircuitEvent): EventExplanation
}

/** One explainer covers every rectifier × load: it reads the topology and load from the result. */
const RECTIFIER_EXPLAINER: Explainer = { state: explainState, event: explainEvent }

export function getExplainer(_id: CircuitId): Explainer {
  return RECTIFIER_EXPLAINER
}
