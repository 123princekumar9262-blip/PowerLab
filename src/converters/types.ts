/**
 * DC-DC converter types. Kept separate from the rectifier types: a converter is driven by a
 * PWM gate instead of an AC source, and its signals, events and parameters differ. Both share
 * the same netlist solver (circuits/netlist.ts) and root finder.
 */

/** Converters of the DC-DC module. */
export type ConverterKind = 'buck' | 'boost' | 'buck-boost'

/** Converter parameters as entered (SI units). Every value is a SIMULATION VALUE. */
export interface ConverterParams {
  /** Input DC voltage [V]. */
  vin: number
  /** Switching frequency [Hz]. */
  fs: number
  /** Duty ratio D = ton / Ts (0.10 … 0.90). */
  duty: number
  /** Inductance [H]. */
  l: number
  /** Output capacitance [F]. */
  c: number
  /** Load resistance [Ω]. */
  r: number
  /** Non-idealities (Advanced). 'ideal' uses Ron = 1 mΩ, Vf = 0 for both devices. */
  devices: 'ideal' | 'real'
  /** Switch on-resistance [Ω] (devices = 'real'). */
  ronQ: number
  /** Diode forward voltage [V] and on-resistance [Ω] (devices = 'real'). */
  vfD: number
  ronD: number
  /** Inductor winding resistance (DCR) [Ω]. */
  rl: number
  /** Capacitor equivalent series resistance (ESR) [Ω]. */
  esr: number
  /** 'steady' shows the periodic steady state; 'startup' starts from a discharged circuit. */
  view: 'steady' | 'startup'
  /** Switching periods shown (steady state). */
  periods: number
  /** Time steps per switching period. */
  stepsPerPeriod: number
}

/** Time base every simulated run shares (the engine's contract with a model). */
export interface RunParams {
  /** Steady-state period [s]: the switching period of a DC-DC converter, the fundamental of an inverter. */
  period: number
  /** Time step [s]. */
  dt: number
  stepsPerPeriod: number
  /** Periods simulated in the displayed run. */
  periods: number
  /** Simulated duration [s] of the displayed run. */
  duration: number
  view: 'steady' | 'startup'
}

/** Parameters after clamping, with derived values. */
export interface ResolvedConverter extends ConverterParams, RunParams {
  kind: ConverterKind
  /** Switching period Ts = 1/fs [s]. */
  ts: number
  /** Effective device values actually simulated. */
  q: { ron: number }
  d: { vf: number; ron: number }
}

export type ConverterSignal =
  | 'gate' // PWM gate (1 = switch commanded ON)
  | 'vsw' // switch-node voltage (diode cathode to ground)
  | 'il' // inductor current
  | 'vl' // inductor voltage L·diL/dt
  | 'vout' // output (load) voltage
  | 'vc' // capacitor voltage (≠ vout only with ESR)
  | 'ic' // capacitor current (+ = charging)
  | 'io' // load current
  | 'iq' // switch current
  | 'vq' // switch voltage (drain − source)
  | 'id' // diode current
  | 'vd' // diode voltage (anode − cathode)
  | 'iin' // input current (from the source)
  | 'el' // energy in L, ½·L·iL²
  | 'ec' // energy in C, ½·C·vC²
  | 'pin' // instantaneous input power
  | 'pout' // instantaneous load power

export type RunEventKind =
  | 'gate-on' // gate command rises (a controlled switch is commanded ON)
  | 'gate-off' // gate command falls
  | 'diode-on'
  | 'diode-off'
  | 'igbt-on' // a gated (non-latching) device starts conducting
  | 'igbt-off'
  | 'il-zero' // DC-DC: inductor current reaches zero (DCM begins)
export type ConverterEventKind = RunEventKind

export interface RunEvent {
  id: string
  kind: RunEventKind
  time: number
  device?: string
  /** Signal values just after the event (the circuit state the event leads into). */
  values: Record<string, number>
}
export type ConverterEvent = RunEvent

/** One device's trace: conduction state, current and voltage per sample. */
export interface DeviceTrace {
  id: string
  kind: 'switch' | 'diode' | 'igbt'
  on: Uint8Array
  current: Float64Array
  voltage: Float64Array
  /** Gate command per sample (switches and IGBTs). */
  gate?: Uint8Array
}
export type ConverterDeviceTrace = DeviceTrace

export interface Run<R extends RunParams = RunParams> {
  kind: string
  params: R
  length: number
  time: Float64Array
  signals: Record<string, Float64Array>
  devices: DeviceTrace[]
  events: RunEvent[]
  /** First sample index of the steady-state window used for measurements. */
  steadyFrom: number
  diagnostics: {
    computeMs: number
    /** Steps where no diode state was exactly self-consistent. */
    fallbacks: number
    /** Steady state: how it was found and how periodic the shown waveform is. */
    steady: {
      method: 'shooting' | 'integration' | 'startup' | 'direct'
      iterations: number
      /** max |x(t+T) − x(t)| over the state, relative to its scale (0 = exactly periodic). */
      residual: number
      converged: boolean
    }
    issues: string[]
  }
}
export type ConverterResult = Run<ResolvedConverter>

/** Conduction interval of a buck converter at an instant. */
export type BuckInterval = 'on' | 'off' | 'idle'
