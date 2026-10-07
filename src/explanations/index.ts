import type { CircuitEvent, CircuitId, SimulationResult } from '../types/simulation.ts'
import { explainEvent, explainState, type EventExplanation, type StateExplanation } from './rectifier.ts'
import { explainEventThreePhase, explainThreePhase } from './threePhase.ts'
import { explainFreewheelEvent, explainFreewheelState } from './freewheel.ts'

export type { CausalStage, CausalStep, EventExplanation, StateExplanation, ThreePhaseInsight } from './rectifier.ts'
export type { FreewheelInsight, FreewheelInterval } from './freewheel.ts'
export { eventTitle } from './rectifier.ts'

interface Explainer {
  state(result: SimulationResult, index: number): StateExplanation
  event(result: SimulationResult, e: CircuitEvent): EventExplanation
}

/** Single-phase explainer: reads the topology, load and freewheeling diode from the result. */
const RECTIFIER_EXPLAINER: Explainer = {
  state: (r, i) => (r.params.control.freewheel ? explainFreewheelState(r, i) : explainState(r, i)),
  event: (r, e) => (r.params.control.freewheel ? explainFreewheelEvent(r, e) : explainEvent(r, e)),
}
/** Three-phase explainer: phase voltages → highest/lowest → device decision → path → output. */
const THREE_PHASE_EXPLAINER: Explainer = { state: explainThreePhase, event: explainEventThreePhase }

export function getExplainer(id: CircuitId): Explainer {
  return id.startsWith('3ph') ? THREE_PHASE_EXPLAINER : RECTIFIER_EXPLAINER
}
