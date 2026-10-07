import type { CircuitModel } from '../circuits/circuitModel.ts'
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
  type SimulationResult,
  type SimulationSample,
  type SimulationTrace,
} from '../types/simulation.ts'
import { sanitizeParams } from './params.ts'
import { sineSource, type VoltageSource } from './source.ts'

/**
 * Below this magnitude a current is treated as zero when detecting
 * "current starts / stops". 1 fA is far below any current this lab can produce
 * with its parameter limits, so it only filters floating-point dust.
 */
export const CURRENT_ZERO_A = 1e-15

const SIGNALS: readonly SignalId[] = ['vin', 'vout', 'vd', 'io', 'id']

/**
 * Run a time-domain simulation.
 *
 *   for each timestep k:   state, solution ← model.step(state, t[k−1], Δt)
 *   whenever a diode changes state (or current starts/stops) between two samples,
 *   the exact instant is located by bisection on the model itself.
 *
 * The UI never computes physics — it only reads what this returns.
 */
export function runSimulation(input: LabParams, circuitId: CircuitId = 'half-wave:R'): SimulationResult {
  const started = performance.now()
  const { params, issues } = sanitizeParams(input)
  const model = getModel(circuitId)
  const source = sineSource(params)
  const { trace, events } = integrate(model, params, source)

  return {
    circuitId,
    params,
    trace,
    events,
    diagnostics: {
      computeMs: performance.now() - started,
      samplesPerCycle: params.period / params.dt,
      issues,
    },
  }
}

function integrate<S>(model: CircuitModel<S>, p: ResolvedParams, source: VoltageSource) {
  const n = p.steps + 1
  const time = new Float64Array(n)
  const signals = Object.fromEntries(SIGNALS.map((s) => [s, new Float64Array(n)])) as Record<SignalId, Float64Array>
  let diodes: DiodeTrace[] = []
  // Energy-storage state at every sample (all the same empty object for the R load).
  const states: S[] = new Array(n)
  const events: CircuitEvent[] = []
  let eventSeq = 0
  const pushEvent = (kind: EventKind, t: number, values: Record<SignalId, number>, device?: CircuitEvent['device']) => {
    events.push({ id: `e${eventSeq++}`, kind, time: t, device, values })
  }

  const store = (k: number, t: number, sol: CircuitSolution) => {
    time[k] = t
    for (const s of SIGNALS) signals[s][k] = sol.signals[s]
    sol.diodes.forEach((d, j) => {
      diodes[j].on[k] = d.on ? 1 : 0
      diodes[j].bias[k] = DIODE_BIAS_CODES.indexOf(d.bias)
    })
  }

  // Sample 0: evaluate the circuit at t = 0 from the initial state.
  let state = model.initialState(p)
  let prev = model.step(p, state, 0, 0, source)
  diodes = prev.solution.diodes.map((d) => ({ id: d.id, on: new Uint8Array(n), bias: new Uint8Array(n) }))
  store(0, 0, prev.solution)
  state = prev.state
  states[0] = state

  for (let k = 1; k < n; k++) {
    const t0 = (k - 1) * p.dt
    const t1 = k === n - 1 ? p.duration : k * p.dt
    const h = t1 - t0
    const prevState = state
    const next = model.step(p, prevState, t0, h, source)

    // --- Event detection inside (t0, t1] -------------------------------------------
    // Re-solve the circuit at fractional steps from the same starting state, so the
    // event instant comes from the circuit itself, not from interpolating samples.
    const solveAt = (hh: number) => model.step(p, prevState, t0, hh, source).solution

    next.solution.diodes.forEach((d, j) => {
      const wasOn = prev.solution.diodes[j].on
      if (d.on === wasOn) return
      const hEvt = bisectTransition(0, h, (hh) => solveAt(hh).diodes[j].on === d.on)
      pushEvent(d.on ? 'diode-on' : 'diode-off', t0 + hEvt, solveAt(hEvt).signals, d.id)
    })

    const wasFlowing = Math.abs(prev.solution.signals.io) > CURRENT_ZERO_A
    const isFlowing = Math.abs(next.solution.signals.io) > CURRENT_ZERO_A
    if (wasFlowing !== isFlowing) {
      const hEvt = bisectTransition(0, h, (hh) => Math.abs(solveAt(hh).signals.io) > CURRENT_ZERO_A === isFlowing)
      pushEvent(isFlowing ? 'current-start' : 'current-stop', t0 + hEvt, solveAt(hEvt).signals)
    }

    store(k, t1, next.solution)
    state = next.state
    states[k] = state
    prev = next
  }

  // --- Source events: zero crossings and peaks of vin --------------------------------
  // vin is the known source function, so crossings/peaks are refined on it directly.
  const vin = signals.vin
  const solveExact = (t: number) => {
    // Solve from the stored state of the sample just before t.
    const k = Math.min(n - 1, Math.max(0, Math.floor(t / p.dt)))
    return model.step(p, states[k], time[k], t - time[k], source).solution.signals
  }
  for (let k = 1; k < n; k++) {
    const a = vin[k - 1]
    const b = vin[k]
    if (a <= 0 && b > 0) {
      const t = bisectTransition(time[k - 1], time[k], (x) => source.v(x) > 0)
      pushEvent('vin-zero-rising', t, solveExact(t))
    } else if (a >= 0 && b < 0) {
      const t = bisectTransition(time[k - 1], time[k], (x) => source.v(x) < 0)
      pushEvent('vin-zero-falling', t, solveExact(t))
    }
    if (k < n - 1) {
      const c = vin[k + 1]
      if (b >= a && b > c && b > 0) {
        const t = goldenSectionMax(time[k - 1], time[k + 1], source.v)
        pushEvent('vin-positive-peak', t, solveExact(t))
      } else if (b <= a && b < c && b < 0) {
        const t = goldenSectionMax(time[k - 1], time[k + 1], (x) => -source.v(x))
        pushEvent('vin-negative-peak', t, solveExact(t))
      }
    }
  }

  events.sort((x, y) => x.time - y.time)
  const trace: SimulationTrace = { length: n, time, signals, diodes }
  return { trace, events }
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

/** Read one sample of the trace as a plain object. */
export function sampleAt(result: SimulationResult, index: number): SimulationSample {
  const { trace } = result
  const i = Math.min(trace.length - 1, Math.max(0, index))
  const s = trace.signals
  const d1 = trace.diodes[0]
  return {
    index: i,
    time: trace.time[i],
    vin: s.vin[i],
    vout: s.vout[i],
    vd: s.vd[i],
    io: s.io[i],
    id: s.id[i],
    diodeState: d1.on[i] ? 'ON' : 'OFF',
    bias: DIODE_BIAS_CODES[d1.bias[i]],
  }
}
