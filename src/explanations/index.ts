import type { CircuitEvent, CircuitId, SimulationResult } from '../types/simulation.ts'
import { explainEvent, explainState, type EventExplanation, type StateExplanation } from './rectifier.ts'
import { explainEventThreePhase, explainThreePhase } from './threePhase.ts'

export type { CausalStage, CausalStep, EventExplanation, StateExplanation, ThreePhaseInsight } from './rectifier.ts'
export { eventTitle } from './rectifier.ts'

interface Explainer {
  state(result: SimulationResult, index: number): StateExplanation
  event(result: SimulationResult, e: CircuitEvent): EventExplanation
}

/** Single-phase explainer: reads the topology and load from the result. */
const RECTIFIER_EXPLAINER: Explainer = { state: explainState, event: explainEvent }
/** Three-phase explainer: phase voltages → highest/lowest → device decision → path → output. */
const THREE_PHASE_EXPLAINER: Explainer = { state: explainThreePhase, event: explainEventThreePhase }

export function getExplainer(id: CircuitId): Explainer {
  return id.startsWith('3ph') ? THREE_PHASE_EXPLAINER : RECTIFIER_EXPLAINER
}
