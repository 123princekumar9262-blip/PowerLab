/**
 * Core types shared by the simulation engine, measurements, explanations and UI.
 *
 * Data flow (each stage only depends on the stages above it):
 *
 *   LabParams ─► sanitizeParams ─► ResolvedParams
 *        ─► CircuitModel.step (per timestep) ─► SimulationTrace + CircuitEvent[]
 *        ─► measurements / explanations ─► UI
 */

/** Rectifier topology. Only 'half-wave' is implemented in Phase 1. */
export type RectifierTopology = 'half-wave' | 'full-wave'

/** Load type. Only 'R' is implemented in Phase 1. */
export type LoadType = 'R' | 'RL' | 'RC' | 'RLC'

export type CircuitId = `${RectifierTopology}:${LoadType}`

export type DiodeModelKind = 'ideal' | 'real'

export type TimestepMode = 'auto' | 'manual'

/** User-facing parameters, exactly as entered (may be invalid — see sanitizeParams). */
export interface LabParams {
  source: {
    /** RMS value of the sinusoidal source [V]. */
    vrms: number
    /** Source frequency [Hz]. */
    frequency: number
    /** Source phase φ in vin(t) = Vm·sin(ωt + φ) [degrees]. */
    phaseDeg: number
  }
  diode: {
    model: DiodeModelKind
    /** Forward (knee) voltage of the real diode [V]. Ignored for the ideal model. */
    vf: number
    /** On-state (bulk) resistance of the real diode [Ω]. Ignored for the ideal model. */
    ron: number
  }
  load: {
    /** Load resistance [Ω]. */
    resistance: number
  }
  sim: {
    /** Simulated duration, in source cycles. */
    cycles: number
    /** 'auto' picks Δt = T / AUTO_SAMPLES_PER_CYCLE; 'manual' uses timestepUs. */
    timestepMode: TimestepMode
    /** Manual simulation timestep [µs]. */
    timestepUs: number
  }
}

/** Diode model after resolution: the ideal diode is simply Vf = 0, Ron = 0. */
export interface DiodeModel {
  kind: DiodeModelKind
  vf: number
  ron: number
}

/** Parameters after validation/clamping, in SI units, guaranteed finite. */
export interface ResolvedParams {
  vrms: number
  /** Peak source voltage Vm = √2·Vrms [V]. */
  vm: number
  frequency: number
  /** Angular frequency ω = 2πf [rad/s]. */
  omega: number
  /** Source period T = 1/f [s]. */
  period: number
  /** Source phase φ [rad]. */
  phase: number
  diode: DiodeModel
  resistance: number
  cycles: number
  /** Total simulated time [s]. */
  duration: number
  /** Effective timestep Δt [s] (duration / steps, so the last sample lands exactly on `duration`). */
  dt: number
  /** Number of timesteps; the trace has steps + 1 samples. */
  steps: number
  /** Timestep the user asked for [s] (before fitting to the duration / sample cap). */
  requestedDt: number
}

export type IssueSeverity = 'info' | 'warning' | 'error'

/** A problem found while resolving parameters. Shown to the user — never silently swallowed. */
export interface ParamIssue {
  field: string
  severity: IssueSeverity
  message: string
}

/**
 * Bias condition of a diode, derived from the circuit (not from the sign of the source).
 * - forward-conducting:       voltage available to the diode exceeds Vf → ON
 * - forward-below-threshold:  0 < available voltage ≤ Vf → OFF (the real-diode "dead zone")
 * - reverse:                  available voltage < 0 → OFF, blocking
 * - zero:                     exactly zero available voltage → OFF
 */
export type DiodeBias = 'forward-conducting' | 'forward-below-threshold' | 'reverse' | 'zero'

export const DIODE_BIAS_CODES: readonly DiodeBias[] = [
  'forward-conducting',
  'forward-below-threshold',
  'reverse',
  'zero',
]

/** Signals a circuit can produce. Later phases add e.g. 'vl', 'vc', 'ic'. */
export type SignalId = 'vin' | 'vout' | 'vd' | 'io' | 'id'

export type DiodeId = 'D1'

/** The electrical solution of the circuit at one instant. */
export interface CircuitSolution {
  signals: Record<SignalId, number>
  diodes: Array<{ id: DiodeId; on: boolean; bias: DiodeBias }>
}

/** One instant of the simulation, in convenient object form (see sampleAt). */
export interface SimulationSample {
  index: number
  time: number
  vin: number
  vout: number
  vd: number
  io: number
  id: number
  diodeState: 'ON' | 'OFF'
  bias: DiodeBias
}

export interface DiodeTrace {
  id: DiodeId
  /** 1 = conducting, 0 = blocking, per sample. */
  on: Uint8Array
  /** Index into DIODE_BIAS_CODES, per sample. */
  bias: Uint8Array
}

/**
 * Time-series output, stored column-wise in typed arrays.
 * A 20-cycle run at a fine timestep is hundreds of thousands of samples; typed
 * columns keep that cheap to compute, measure and render.
 */
export interface SimulationTrace {
  length: number
  time: Float64Array
  signals: Record<SignalId, Float64Array>
  diodes: DiodeTrace[]
}

export type EventKind =
  | 'vin-positive-peak'
  | 'vin-negative-peak'
  | 'vin-zero-rising'
  | 'vin-zero-falling'
  | 'diode-on'
  | 'diode-off'
  | 'current-start'
  | 'current-stop'

/** An automatically detected event, located to sub-timestep precision. */
export interface CircuitEvent {
  id: string
  kind: EventKind
  /** Event time [s], refined between samples (bisection / golden-section search). */
  time: number
  /** Device involved, if any. */
  device?: DiodeId
  /** Exact circuit solution at the event time. */
  values: Record<SignalId, number>
}

export interface SimulationDiagnostics {
  /** Wall-clock time spent solving [ms]. */
  computeMs: number
  samplesPerCycle: number
  issues: ParamIssue[]
}

export interface SimulationResult {
  circuitId: CircuitId
  params: ResolvedParams
  trace: SimulationTrace
  events: CircuitEvent[]
  diagnostics: SimulationDiagnostics
}
