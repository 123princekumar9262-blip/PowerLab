import type {
  CircuitId,
  CircuitSolution,
  DiodeId,
  LoadType,
  RectifierTopology,
  ResolvedParams,
  SignalId,
} from '../types/simulation.ts'

/** Every model's state carries the diode combination it is in (bit k = diode k ON). */
export interface ModelState {
  combo: number
}

export interface StepResult<S> {
  solution: CircuitSolution
  state: S
}

/**
 * A circuit the engine can simulate.
 *
 * `S` holds the energy-storage state — the quantities that cannot change instantly
 * (inductor currents, capacitor voltages) — plus the present diode combination.
 * The engine owns time; the model owns the physics of a single step.
 */
export interface CircuitModel<S extends ModelState = ModelState> {
  id: CircuitId
  name: string
  topology: RectifierTopology
  load: LoadType
  /** Signals this circuit produces, in display order. */
  signals: readonly SignalId[]
  diodeIds: readonly DiodeId[]
  /** Signals for a specific parameter set, when they depend on it (e.g. a freewheeling diode). */
  signalsFor?(p: ResolvedParams): readonly SignalId[]
  /** Diode ids for a specific parameter set, when they depend on it (e.g. a freewheeling diode). */
  diodeIdsFor?(p: ResolvedParams): readonly DiodeId[]

  /** State at t = 0 (storage elements discharged, all diodes assumed OFF). */
  initialState(p: ResolvedParams): S

  /**
   * Advance from `state` at time t by h ≥ 0 with the diode combination held fixed.
   * Returns null if that combination is physically impossible (singular network).
   * Pure: the engine calls it with fractional h to locate switching instants.
   */
  solveWith(p: ResolvedParams, state: S, t: number, h: number, combo: number): (StepResult<S> & { consistent: boolean; violation: number }) | null

  /**
   * Advance from `state` at t by h, choosing the self-consistent diode combination
   * (preferring the present one). `fallback` is true if none was exactly consistent.
   */
  step(p: ResolvedParams, state: S, t: number, h: number): StepResult<S> & { fallback: boolean }
}
