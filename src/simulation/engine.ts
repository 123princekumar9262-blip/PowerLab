import type { CircuitModel, ModelState } from '../circuits/circuitModel.ts'
import { getModel } from '../circuits/registry.ts'
import { bisectTransition, goldenSectionMax } from '../solvers/rootFinding.ts'
import {
  DIODE_BIAS_CODES,
  type CircuitEvent,
  type CircuitId,
  type CircuitSolution,
  type DiodeTrace,
  type EventKind,
  type LabParams,
  type ResolvedParams,
  type SignalId,
  type SignalValues,
  type SimulationResult,
  type SimulationSample,
  type SimulationTrace,
} from '../types/simulation.ts'
import { sanitizeParams } from './params.ts'
import { sineSource } from './source.ts'

/** Safety limit on switching events handled inside one timestep. */
const MAX_SWITCHES_PER_STEP = 8

/**
 * Run a time-domain simulation.
 *
 *   for each timestep [t₀, t₁]:
 *     solve the circuit at t₁ from the state at t₀ (model.step picks the consistent diode combination)
 *     if the diode combination changed:
 *       bisect for the instant tₛ where the OLD combination stops being self-consistent,
 *       advance the OLD circuit exactly to tₛ (storage states stay continuous),
 *       record the switching events at tₛ, and continue from tₛ to t₁ with the NEW circuit.
 *
 * Stepping exactly to each switching instant is what makes, e.g., an inductor current
 * reach zero precisely when its diode turns off. The UI never computes physics —
 * it only reads what this returns.
 */
export function runSimulation(input: LabParams, circuitId: CircuitId = 'half-wave:R'): SimulationResult {
  const started = performance.now()
  const { params, issues } = sanitizeParams(input, circuitId)
  const model = getModel(circuitId)
  const { trace, events, fallbacks } = integrate(model, params)

  return {
    circuitId,
    params,
    signalIds: model.signals,
    diodeIds: model.diodeIds,
    trace,
    events,
    diagnostics: {
      computeMs: performance.now() - started,
      samplesPerCycle: params.period / params.dt,
      issues,
      solverFallbacks: fallbacks,
    },
  }
}

function integrate<S extends ModelState>(model: CircuitModel<S>, p: ResolvedParams) {
  const n = p.steps + 1
  const time = new Float64Array(n)
  const signals: Partial<Record<SignalId, Float64Array>> = {}
  for (const s of model.signals) signals[s] = new Float64Array(n)
  const diodes: DiodeTrace[] = model.diodeIds.map((id) => ({
    id,
    on: new Uint8Array(n),
    bias: new Uint8Array(n),
    current: new Float64Array(n),
    voltage: new Float64Array(n),
  }))
  const events: CircuitEvent[] = []
  let seq = 0
  let fallbacks = 0
  const pushEvent = (kind: EventKind, t: number, values: SignalValues, device?: CircuitEvent['device']) => {
    events.push({ id: `e${seq++}`, kind, time: t, device, values })
  }

  const store = (k: number, t: number, sol: CircuitSolution) => {
    time[k] = t
    for (const s of model.signals) signals[s]![k] = sol.signals[s] ?? 0
    sol.diodes.forEach((d, j) => {
      const tr = diodes[j]
      tr.on[k] = d.on ? 1 : 0
      tr.bias[k] = DIODE_BIAS_CODES.indexOf(d.bias)
      tr.current[k] = d.current
      tr.voltage[k] = d.voltage
    })
  }

  // Sample 0: the circuit at t = 0 from the initial (discharged) state. A vanishing step
  // (10⁻⁹·Δt) rather than exactly 0: at h = 0 an inductor's voltage is undetermined
  // (L·di/dt with no di), which would make every diode combination singular.
  const first = model.step(p, model.initialState(p), 0, p.dt * 1e-9)
  if (first.fallback) fallbacks++
  store(0, 0, first.solution)
  let state = first.state

  for (let k = 1; k < n; k++) {
    const t1 = k === n - 1 ? p.duration : k * p.dt
    let t = (k - 1) * p.dt
    let s = state
    let res = model.step(p, s, t, t1 - t)
    for (let guard = 0; res.state.combo !== s.combo && guard < MAX_SWITCHES_PER_STEP; guard++) {
      const h = t1 - t
      const held = s.combo
      const from = s
      const t0 = t
      // First instant at which the held combination is no longer self-consistent. The search
      // floor 10⁻⁹·Δt keeps the inductor's h/L term well-conditioned (as h → 0 an inductor
      // becomes a pure current source and its voltage is numerically undetermined).
      const hMin = Math.min(h, p.dt * 1e-9)
      const breaks = (hh: number) => !(model.solveWith(p, from, t0, hh, held)?.consistent ?? false)
      const hS = breaks(hMin) ? hMin : bisectTransition(hMin, h, breaks)
      const at = model.solveWith(p, from, t0, hS, held)
      if (!at || h - hS <= hMin) {
        // The switch lands on the sample (within the 10⁻⁹·Δt floor — e.g. an ideal diode
        // turning on at a zero crossing that coincides with t₁): accept res, record the event there.
        recordSwitch(model, held, res.state.combo, t1, res.solution.signals, pushEvent)
        break
      }
      const tS = t0 + hS
      // Which combination takes over right after tₛ? Probe a tiny step past the instant,
      // so a second switch later in the same timestep is still detected separately.
      const probe = model.step(p, { ...at.state, combo: held }, tS, Math.min(h - hS, p.dt * 1e-6))
      const after = probe.state.combo
      recordSwitch(model, held, after, tS, at.solution.signals, pushEvent)
      s = { ...at.state, combo: after }
      t = tS
      res = model.step(p, s, t, t1 - t)
    }
    if (res.fallback) fallbacks++
    store(k, t1, res.solution)
    state = res.state
  }

  detectSourceEvents(p, time, signals, pushEvent)
  if (p.load !== 'R') detectOutputExtrema(time, signals.vout!, pushEvent)

  events.sort((x, y) => x.time - y.time)
  const trace: SimulationTrace = { length: n, time, signals, diodes }
  return { trace, events, fallbacks }
}

function recordSwitch<S extends ModelState>(
  model: CircuitModel<S>,
  before: number,
  after: number,
  t: number,
  values: SignalValues,
  push: (k: EventKind, t: number, v: SignalValues, d?: CircuitEvent['device']) => void,
) {
  model.diodeIds.forEach((id, j) => {
    const was = (before >> j) & 1
    const now = (after >> j) & 1
    if (was !== now) push(now ? 'diode-on' : 'diode-off', t, values, id)
  })
  // The rectifier delivers current exactly when at least one diode conducts.
  if (before === 0 && after !== 0) push('current-start', t, values)
  if (before !== 0 && after === 0) push('current-stop', t, values)
}

/** Zero crossings and peaks of vin, refined on the analytic source function. */
function detectSourceEvents(
  p: ResolvedParams,
  time: Float64Array,
  signals: Partial<Record<SignalId, Float64Array>>,
  push: (k: EventKind, t: number, v: SignalValues) => void,
) {
  const source = sineSource(p)
  const vin = signals.vin!
  const n = vin.length
  // Values at a source event: vin exact; other signals linearly interpolated between samples.
  const valuesAt = (t: number, k: number): SignalValues => {
    const k0 = Math.max(0, Math.min(n - 2, k))
    const f = (t - time[k0]) / (time[k0 + 1] - time[k0])
    const out: SignalValues = {}
    for (const [id, arr] of Object.entries(signals) as Array<[SignalId, Float64Array]>) out[id] = arr[k0] + (arr[k0 + 1] - arr[k0]) * f
    out.vin = source.v(t)
    return out
  }
  for (let k = 1; k < n; k++) {
    const a = vin[k - 1]
    const b = vin[k]
    if (a <= 0 && b > 0) {
      const t = bisectTransition(time[k - 1], time[k], (x) => source.v(x) > 0)
      push('vin-zero-rising', t, valuesAt(t, k - 1))
    } else if (a >= 0 && b < 0) {
      const t = bisectTransition(time[k - 1], time[k], (x) => source.v(x) < 0)
      push('vin-zero-falling', t, valuesAt(t, k - 1))
    }
    if (k < n - 1) {
      const c = vin[k + 1]
      if (b >= a && b > c && b > 0) {
        const t = goldenSectionMax(time[k - 1], time[k + 1], source.v)
        push('vin-positive-peak', t, valuesAt(t, t < time[k] ? k - 1 : k))
      } else if (b <= a && b < c && b < 0) {
        const t = goldenSectionMax(time[k - 1], time[k + 1], (x) => -source.v(x))
        push('vin-negative-peak', t, valuesAt(t, t < time[k] ? k - 1 : k))
      }
    }
  }
}

/**
 * Local maxima/minima of the output voltage (ripple crests and valleys), for loads with
 * energy storage. Located on the samples and refined by a parabola through three samples.
 */
function detectOutputExtrema(time: Float64Array, vout: Float64Array, push: (k: EventKind, t: number, v: SignalValues) => void) {
  const n = vout.length
  let span = 0
  for (let i = 0; i < n; i++) span = Math.max(span, Math.abs(vout[i]))
  const eps = span * 1e-9 // ignore flat-zero stretches and float dust
  for (let k = 1; k < n - 1; k++) {
    const a = vout[k - 1]
    const b = vout[k]
    // Plateau-aware: skip samples equal to b (a crest can span two equal samples).
    let j = k + 1
    while (j < n - 1 && Math.abs(vout[j] - b) <= eps) j++
    const c = vout[j]
    const isMax = b > a + eps && b > c + eps
    const isMin = b < a - eps && b < c - eps
    if (!isMax && !isMin) continue
    // Parabolic refinement: vertex of the parabola through the three samples.
    const denom = a - 2 * b + c
    const off = denom !== 0 ? (0.5 * (a - c)) / denom : 0
    const dt = time[k + 1] - time[k]
    const t = time[k] + Math.max(-0.5, Math.min(0.5, off)) * dt
    const v = b - 0.25 * (a - c) * Math.max(-0.5, Math.min(0.5, off))
    push(isMax ? 'vout-max' : 'vout-min', t, { vout: v })
    k = j - 1
  }
}

/** Index of the sample nearest to time t. */
export function indexAtTime(result: SimulationResult, t: number): number {
  const { dt } = result.params
  return Math.min(result.trace.length - 1, Math.max(0, Math.round(t / dt)))
}

/** First sample index at or after time t (the circuit state just after an event). */
export function indexAtOrAfter(result: SimulationResult, t: number): number {
  const { dt } = result.params
  // Tiny tolerance so an event that lands exactly on a sample maps to that sample.
  return Math.min(result.trace.length - 1, Math.max(0, Math.ceil(t / dt - 1e-9)))
}

/** A signal column, or undefined if this circuit does not produce it. */
export function sig(result: SimulationResult, id: SignalId): Float64Array | undefined {
  return result.trace.signals[id]
}

/** Read one sample of the trace as a plain object. */
export function sampleAt(result: SimulationResult, index: number): SimulationSample {
  const { trace } = result
  const i = Math.min(trace.length - 1, Math.max(0, index))
  const values: SignalValues = {}
  for (const [id, arr] of Object.entries(trace.signals) as Array<[SignalId, Float64Array]>) values[id] = arr[i]
  const diodes = trace.diodes.map((d) => ({
    id: d.id,
    on: d.on[i] === 1,
    bias: DIODE_BIAS_CODES[d.bias[i]],
    current: d.current[i],
    voltage: d.voltage[i],
  }))
  return {
    index: i,
    time: trace.time[i],
    values,
    diodes,
    vin: values.vin ?? 0,
    vout: values.vout ?? 0,
    vd: values.vd ?? 0,
    io: values.io ?? 0,
    id: values.id ?? 0,
    diodeState: diodes[0].on ? 'ON' : 'OFF',
    bias: diodes[0].bias,
  }
}
