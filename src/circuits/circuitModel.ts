import type { VoltageSource } from '../simulation/source.ts'
import type {
  CircuitId,
  CircuitSolution,
  LoadType,
  RectifierTopology,
  ResolvedParams,
  SignalId,
} from '../types/simulation.ts'

/**
 * A circuit the engine can simulate.
 *
 * `S` is the circuit's energy-storage state — the quantities that cannot change
 * instantly and must be integrated over time:
 *   R load   → none ({}): the circuit is memoryless, every instant is solved algebraically.
 *   RL load  → { iL }  (Phase 3: di/dt = (vin − R·i − vD)/L)
 *   RC load  → { vC }  (Phase 4: dvC/dt = iC/C)
 *   RLC load → { iL, vC }
 *
 * The engine owns time; the model owns the physics of a single step.
 */
export interface CircuitModel<S = unknown> {
  id: CircuitId
  name: string
  topology: RectifierTopology
  load: LoadType
  /** Signals this circuit produces, in display order. */
  signals: readonly SignalId[]

  /** Energy-storage state at t = 0. */
  initialState(p: ResolvedParams): S

  /**
   * Advance from `state` at time t by h ≥ 0 and solve the circuit at t + h.
   * h = 0 evaluates the circuit at t itself. The engine also calls this with
   * fractional h to locate events between samples, so it must be pure.
   */
  step(p: ResolvedParams, state: S, t: number, h: number, source: VoltageSource): { solution: CircuitSolution; state: S }
}
