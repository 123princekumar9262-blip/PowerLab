import { isThreePhase, supportsFreewheel, type CircuitId, type FaultSpec, type LabParams, type LoadType, type ParamIssue, type RectifierTopology, type ResolvedParams } from '../types/simulation.ts'

/**
 * Educational defaults. 12 V RMS is a typical step-down transformer secondary —
 * deliberately NOT mains voltage. With R = 10 Ω and a 0.7 V diode the peak load
 * current is (16.97 − 0.7)/10 ≈ 1.6 A, a comfortable bench-scale value.
 */
export const DEFAULT_PARAMS: LabParams = {
  source: { vrms: 12, frequency: 50, phaseDeg: 0 },
  diode: { model: 'real', vf: 0.7, ron: 0 },
  // L = 50 mH with R = 10 Ω gives ωL/R ≈ 1.6 — a strongly inductive load (clear extinction angle).
  // C = 1000 µF with R = 10 Ω gives ωRC ≈ 3.1 — visible but clearly reduced ripple.
  load: { resistance: 10, inductance: 0.05, capacitance: 1000e-6 },
  sim: { cycles: 4, timestepMode: 'auto', timestepUs: 10 },
}

/**
 * Three-phase educational defaults: 12 V RMS per phase, 50 Hz, R = 10 Ω, L = 10 mH
 * (simulation values only — never a recommendation for real mains work).
 */
export const THREE_PHASE_DEFAULTS: LabParams = {
  ...DEFAULT_PARAMS,
  load: { resistance: 10, inductance: 0.01, capacitance: 1000e-6 },
  threePhase: { sequence: 'abc', rs: 0, ls: 0 },
  control: { device: 'diode', alphaDeg: 30, freewheel: false },
  faults: {},
  sim: { ...DEFAULT_PARAMS.sim, cycles: 4 },
}

/** Allowed ranges. Values outside are clamped and reported as an issue. */
export const LIMITS = {
  vrms: { min: 0.1, max: 400, unit: 'V' },
  frequency: { min: 1, max: 1000, unit: 'Hz' },
  phaseDeg: { min: -360, max: 360, unit: '°' },
  vf: { min: 0, max: 5, unit: 'V' },
  ron: { min: 0, max: 1000, unit: 'Ω' },
  resistance: { min: 1e-3, max: 1e7, unit: 'Ω' },
  inductance: { min: 1e-6, max: 10, unit: 'H' },
  capacitance: { min: 1e-9, max: 0.1, unit: 'F' },
  cycles: { min: 1, max: 20, unit: 'cycles' },
  rs: { min: 0, max: 100, unit: 'Ω' },
  ls: { min: 0, max: 0.1, unit: 'H' },
  alphaDeg: { min: 0, max: 180, unit: '°' },
  timestepUs: { min: 0.01, max: 1e5, unit: 'µs' },
} as const

/** Auto timestep resolves one source cycle into this many steps (Δt = 10 µs at 50 Hz). */
export const AUTO_SAMPLES_PER_CYCLE = 2000

/**
 * Below this many samples per cycle a sinusoid is too coarsely resolved for
 * meaningful peak/RMS values (the peak can be missed by > 7 %), so the timestep is tightened.
 */
export const MIN_SAMPLES_PER_CYCLE = 16

/** Hard cap on trace length so a fine timestep can't freeze a normal laptop. */
export const MAX_SAMPLES = 400_000

/** Above this a student-facing warning is shown — the lab is for low-voltage study. */
const HIGH_VOLTAGE_WARNING_VRMS = 50

const DEG = Math.PI / 180

/**
 * Validate user parameters and convert them to SI, producing a parameter set the
 * engine can trust (finite, in range). Every correction is reported as an issue.
 */
export function sanitizeParams(input: LabParams, circuitId: CircuitId = 'half-wave:R'): { params: ResolvedParams; issues: ParamIssue[] } {
  const [topology, load] = circuitId.split(':') as [RectifierTopology, LoadType]
  const issues: ParamIssue[] = []

  const num = (field: keyof typeof LIMITS, label: string, value: number, fallback: number): number => {
    const { min, max, unit } = LIMITS[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field, severity: 'error', message: `${label} is not a valid number — using ${fallback} ${unit}.` })
      return fallback
    }
    if (value < min) {
      issues.push({ field, severity: 'warning', message: `${label} below ${min} ${unit} — clamped to ${min} ${unit}.` })
      return min
    }
    if (value > max) {
      issues.push({ field, severity: 'warning', message: `${label} above ${max} ${unit} — clamped to ${max} ${unit}.` })
      return max
    }
    return value
  }

  const d = DEFAULT_PARAMS
  const vrms = num('vrms', 'Vrms', input.source.vrms, d.source.vrms)
  const frequency = num('frequency', 'Frequency', input.source.frequency, d.source.frequency)
  const phaseDeg = num('phaseDeg', 'Phase', input.source.phaseDeg, d.source.phaseDeg)
  const resistance = num('resistance', 'Resistance', input.load.resistance, d.load.resistance)
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  // Only validate the elements this load actually has (an unused field must not raise warnings).
  const inductance = hasL ? num('inductance', 'Inductance', input.load.inductance, d.load.inductance) : d.load.inductance
  const capacitance = hasC ? num('capacitance', 'Capacitance', input.load.capacitance, d.load.capacitance) : d.load.capacitance
  const cycles = Math.round(num('cycles', 'Duration', input.sim.cycles, d.sim.cycles))
  const kind = input.diode.model === 'ideal' ? 'ideal' : 'real'
  // An ideal diode is the limiting case Vf → 0, Ron → 0 of the real model.
  const vf = kind === 'ideal' ? 0 : num('vf', 'Vf', input.diode.vf, d.diode.vf)
  const ron = kind === 'ideal' ? 0 : num('ron', 'Ron', input.diode.ron, d.diode.ron)

  if (vrms > HIGH_VOLTAGE_WARNING_VRMS) {
    issues.push({
      field: 'vrms',
      severity: 'info',
      message: `${vrms} V RMS is above safe extra-low-voltage levels. Fine in simulation — never on a real bench without supervision.`,
    })
  }

  // Source: vin(t) = Vm·sin(ωt + φ), with Vm = √2·Vrms (sinusoid peak-to-RMS ratio) and ω = 2πf.
  const vm = Math.SQRT2 * vrms
  const omega = 2 * Math.PI * frequency
  const period = 1 / frequency
  const duration = cycles * period

  // A bridge puts two diode drops in the path.
  const vfPath = topology === 'bridge' || topology === '3ph-bridge' || topology === '3ph-half-controlled' ? 2 * vf : vf
  if (kind === 'real' && vfPath >= vm) {
    issues.push({
      field: 'vf',
      severity: 'warning',
      message: `${topology === 'bridge' ? '2·Vf' : 'Vf'} (${vfPath} V) ≥ peak source voltage Vm (${vm.toFixed(2)} V): the diodes can never be forward biased enough to conduct.`,
    })
  }

  // Timestep. The effective Δt is fitted so an integer number of steps spans the duration exactly.
  let requestedDt: number
  if (input.sim.timestepMode === 'manual') {
    requestedDt = num('timestepUs', 'Timestep', input.sim.timestepUs, d.sim.timestepUs) * 1e-6
  } else {
    requestedDt = period / AUTO_SAMPLES_PER_CYCLE
  }
  let dt = requestedDt
  if (period / dt < MIN_SAMPLES_PER_CYCLE) {
    dt = period / MIN_SAMPLES_PER_CYCLE
    issues.push({
      field: 'timestepUs',
      severity: 'warning',
      message: `Timestep too coarse to resolve the waveform — tightened to ${(dt * 1e6).toPrecision(3)} µs (${MIN_SAMPLES_PER_CYCLE} samples/cycle).`,
    })
  }
  let steps = Math.max(1, Math.round(duration / dt))
  if (steps + 1 > MAX_SAMPLES) {
    steps = MAX_SAMPLES - 1
    issues.push({
      field: 'timestepUs',
      severity: 'warning',
      message: `Timestep would need more than ${MAX_SAMPLES.toLocaleString()} samples — enlarged to ${((duration / steps) * 1e6).toPrecision(3)} µs.`,
    })
  }
  dt = duration / steps

  // Energy-storage time constants far below Δt cannot be resolved (the solver stays stable —
  // backward Euler — but the fast transient is smeared). Tell the student instead of hiding it.
  const tauL = inductance / resistance
  const tauC = resistance * capacitance
  if (hasL && tauL < 5 * dt) {
    issues.push({ field: 'inductance', severity: 'info', message: `L/R = ${(tauL * 1e6).toPrecision(3)} µs is shorter than 5·Δt — the inductor's fast transient is not resolved. Reduce the timestep for detail.` })
  }
  if (hasC && tauC < 5 * dt) {
    issues.push({ field: 'capacitance', severity: 'info', message: `R·C = ${(tauC * 1e6).toPrecision(3)} µs is shorter than 5·Δt — the capacitor's fast transient is not resolved. Reduce the timestep for detail.` })
  }

  // ── Three-phase source, controlled devices and faults ───────────────────────────
  const tp = input.threePhase
  const threePhase = {
    sequence: tp?.sequence === 'acb' ? ('acb' as const) : ('abc' as const),
    rs: isThreePhase(topology) && tp ? num('rs', 'Source resistance', tp.rs, 0) : 0,
    ls: isThreePhase(topology) && tp ? num('ls', 'Source inductance', tp.ls, 0) : 0,
  }
  const ctl = input.control
  // The half-controlled bridge always has SCRs (upper) — that is what defines it.
  const device = topology === '3ph-half-controlled' ? ('scr' as const) : isThreePhase(topology) && ctl?.device === 'scr' ? ('scr' as const) : ('diode' as const)
  const alphaDeg = device === 'scr' && ctl ? num('alphaDeg', 'Firing angle α', ctl.alphaDeg, 30) : 0
  const control = { device, alpha: alphaDeg * DEG, freewheel: supportsFreewheel(topology, load) && !!ctl?.freewheel }
  const faults: FaultSpec = isThreePhase(topology) ? { ...(input.faults ?? {}) } : {}
  if (faults.vfOverride) {
    const v = faults.vfOverride.vf
    faults.vfOverride = { ...faults.vfOverride, vf: Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : vf }
  }
  if (faults.imbalance) {
    const k = faults.imbalance.scale
    faults.imbalance = { ...faults.imbalance, scale: Number.isFinite(k) ? Math.min(2, Math.max(0, k)) : 1 }
  }
  if (faults.diode?.kind === 'short' && threePhase.rs < 0.05) {
    issues.push({
      field: 'faults',
      severity: 'warning',
      message: 'A shorted diode connects two phases directly. With source resistance Rs ≈ 0 only the 1 mΩ fault path limits the current, so expect kiloamps. Add Rs (Advanced) to see a realistic fault current.',
    })
  }

  return {
    params: {
      topology,
      load,
      vrms,
      vm,
      frequency,
      omega,
      period,
      phase: phaseDeg * DEG,
      diode: { kind, vf, ron },
      resistance,
      inductance,
      capacitance,
      threePhase,
      control,
      faults,
      cycles,
      duration,
      dt,
      steps,
      requestedDt,
    },
    issues,
  }
}
