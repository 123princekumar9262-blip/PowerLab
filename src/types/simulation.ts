/**
 * Core types shared by the simulation engine, measurements, explanations and UI.
 *
 * Data flow (each stage only depends on the stages above it):
 *
 *   LabParams ─► sanitizeParams ─► ResolvedParams
 *        ─► CircuitModel.step (per timestep, event-located) ─► SimulationTrace + CircuitEvent[]
 *        ─► measurements / theory / explanations ─► UI
 */

/**
 * Rectifier topology.
 * Single-phase: half-wave, and full-wave in its two classic forms.
 * Three-phase: 3-pulse midpoint (half-wave), 6-pulse bridge, and the half-controlled
 * bridge (upper SCRs, lower diodes). Diode or SCR devices are chosen by `control.device`.
 */
export type RectifierTopology = 'half-wave' | 'center-tap' | 'bridge' | '3ph-half-wave' | '3ph-bridge' | '3ph-half-controlled'

export const THREE_PHASE_TOPOLOGIES: readonly RectifierTopology[] = ['3ph-half-wave', '3ph-bridge', '3ph-half-controlled']
export const isThreePhase = (t: RectifierTopology) => t.startsWith('3ph')

/**
 * Circuits that accept a freewheeling diode across the load (anode on the − output,
 * cathode on the + output). Every three-phase rectifier, and the single-phase half-wave
 * rectifier with an RL load. Extending the feature to another circuit only needs this rule:
 * the netlist, solver, events, measurements and explanations are already generic.
 */
export const supportsFreewheel = (t: RectifierTopology, load: LoadType) => isThreePhase(t) || (t === 'half-wave' && load === 'RL')

/** Fault injection for the three-phase experiments. */
export interface FaultSpec {
  /** A diode that is open-circuit (never conducts) or short-circuit (conducts both ways). */
  diode?: { id: DiodeId; kind: 'open' | 'short' }
  /** Per-diode forward-voltage override, e.g. one aged diode with a higher Vf. */
  vfOverride?: { id: DiodeId; vf: number }
  /** A phase conductor that is disconnected (blown fuse). */
  missingPhase?: 'a' | 'b' | 'c'
  /** Amplitude of one phase, as a fraction of nominal (voltage imbalance). */
  imbalance?: { phase: 'a' | 'b' | 'c'; scale: number }
}

export type SwitchDevice = 'diode' | 'scr'

/**
 * Load type (all loads are driven between the rectifier's + and − output):
 *   R   — resistor
 *   RL  — resistor in series with an inductor
 *   RC  — resistor with a smoothing capacitor in parallel (capacitor-input filter)
 *   RLC — series inductor, then capacitor ∥ resistor (choke-input / LC filter)
 */
export type LoadType = 'R' | 'RL' | 'RC' | 'RLC'

export type CircuitId = `${RectifierTopology}:${LoadType}`

export type DiodeModelKind = 'ideal' | 'real'

export type TimestepMode = 'auto' | 'manual'

/** User-facing parameters, exactly as entered (may be invalid — see sanitizeParams). */
export interface LabParams {
  source: {
    /** RMS value of the sinusoidal source [V] (for the center-tap: of EACH half winding). */
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
    /** Load / filter inductance [H] (RL, RLC). */
    inductance: number
    /** Filter capacitance [F] (RC, RLC). */
    capacitance: number
  }
  /** Three-phase source details (ignored by single-phase circuits). */
  threePhase?: {
    /** Phase sequence: abc (positive) or acb (negative). */
    sequence: 'abc' | 'acb'
    /** Source resistance per phase [Ω]. */
    rs: number
    /** Source inductance per phase [H] — causes commutation overlap. */
    ls: number
  }
  /** Controlled rectifiers: device type and firing angle. */
  control?: {
    device: SwitchDevice
    /** Firing angle α measured from each device's natural commutation instant [degrees]. */
    alphaDeg: number
    /** Freewheeling diode across the load. */
    freewheel: boolean
  }
  faults?: FaultSpec
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
  topology: RectifierTopology
  load: LoadType
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
  inductance: number
  capacitance: number
  /** Three-phase source: sequence and per-phase source impedance (defaults: abc, 0, 0). */
  threePhase: { sequence: 'abc' | 'acb'; rs: number; ls: number }
  /** Switching devices and firing angle α [rad] (diodes: α is ignored). */
  control: { device: SwitchDevice; alpha: number; freewheel: boolean }
  faults: FaultSpec
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
 * - forward-conducting:       the diode conducts (ON)
 * - forward-below-threshold:  0 < vAK ≤ Vf while OFF (the real-diode "dead zone")
 * - reverse:                  vAK < 0 → OFF, blocking
 * - zero:                     vAK = 0 → OFF
 */
export type DiodeBias = 'forward-conducting' | 'forward-below-threshold' | 'reverse' | 'zero'

export const DIODE_BIAS_CODES: readonly DiodeBias[] = [
  'forward-conducting',
  'forward-below-threshold',
  'reverse',
  'zero',
]

/**
 * Signals a circuit can produce. Each circuit declares the subset it produces.
 *   vin   source voltage (center-tap: upper half winding)
 *   vrect rectifier output voltage (shown separately only when it differs from vout: RLC)
 *   vout  load voltage (R, RL: across the whole load; RC, RLC: across R ∥ C)
 *   vd/id   diode D1 voltage (anode − cathode) / current;  vd2/id2: diode D2
 *   vl/il   inductor voltage / current;  ic: capacitor current
 *   io    current in the load resistor R
 *   wl/wc energy stored in L / C;  ps / pload / pd: source, load-resistor and total diode power
 */
export type SignalId =
  | 'vin'
  | 'vrect'
  | 'vout'
  | 'vd'
  | 'vd2'
  | 'vl'
  | 'io'
  | 'id'
  | 'id2'
  | 'il'
  | 'ic'
  | 'wl'
  | 'wc'
  | 'ps'
  | 'pload'
  | 'pd'
  // Three-phase: phase voltages b and c (vin is phase a), line-to-line voltages, and the
  // currents of diodes 3–6 (id, id2 are diodes 1–2).
  | 'vb'
  | 'vc'
  | 'vab'
  | 'vbc'
  | 'vca'
  | 'id3'
  | 'id4'
  | 'id5'
  | 'id6'
  // Freewheeling diode Dfw: current (anode → cathode) and voltage (anode − cathode = −Vout).
  | 'ifw'
  | 'vfw'

export type DiodeId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'Da' | 'Db' | 'Dc' | 'Dfw'

export type SignalValues = Partial<Record<SignalId, number>>

export interface DiodeSolution {
  id: DiodeId
  on: boolean
  bias: DiodeBias
  /** Anode → cathode current [A]. */
  current: number
  /** Anode − cathode voltage [V]. */
  voltage: number
  /** SCRs only: is the gate pulse applied at this instant? */
  gate?: boolean
}

/** The electrical solution of the circuit at one instant. */
export interface CircuitSolution {
  signals: SignalValues
  diodes: DiodeSolution[]
}

/** One instant of the simulation, in convenient object form (see sampleAt). */
export interface SimulationSample {
  index: number
  time: number
  values: SignalValues
  diodes: DiodeSolution[]
  // Shorthands (D1 and the main signals), present for every circuit:
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
  current: Float64Array
  voltage: Float64Array
  /** SCRs only: 1 while the gate pulse is applied, per sample. */
  gate?: Uint8Array
}

/**
 * Time-series output, stored column-wise in typed arrays.
 * A 20-cycle run at a fine timestep is hundreds of thousands of samples; typed
 * columns keep that cheap to compute, measure and render.
 */
export interface SimulationTrace {
  length: number
  time: Float64Array
  /** Only the signals the circuit produces are present. */
  signals: Partial<Record<SignalId, Float64Array>>
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
  | 'vout-max'
  | 'vout-min'
  | 'phase-crossing'
  /** The load current passes from one path to another without interruption (e.g. D1 → Dfw). */
  | 'current-transfer'
  /** Local minimum of the energy stored in the inductor. */
  | 'energy-min'

/** An automatically detected event, located to sub-timestep precision. */
export interface CircuitEvent {
  id: string
  kind: EventKind
  /** Event time [s], refined between samples. */
  time: number
  /** Device involved, if any. */
  device?: DiodeId
  /** Circuit solution at the event time. */
  values: SignalValues
}

export interface SimulationDiagnostics {
  /** Wall-clock time spent solving [ms]. */
  computeMs: number
  samplesPerCycle: number
  issues: ParamIssue[]
  /** Steps where no diode combination was exactly self-consistent (should be ~0). */
  solverFallbacks: number
}

export interface SimulationResult {
  circuitId: CircuitId
  params: ResolvedParams
  /** Signals this circuit produces, in display order. */
  signalIds: readonly SignalId[]
  diodeIds: readonly DiodeId[]
  trace: SimulationTrace
  events: CircuitEvent[]
  diagnostics: SimulationDiagnostics
}
