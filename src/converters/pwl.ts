import { affineFlow, type Mat } from './expm.ts'
import { solveDense } from '../solvers/linear.ts'

/**
 * Piecewise-linear (PWL) hybrid systems: dx/dt = A_m·x + b_m(t) in each MODE m, the mode decided by
 * the state (a diode conducting, a channel in saturation, a core saturated…), the inputs piecewise
 * constant between known breakpoints. Two independent solvers:
 *
 *  SIMULATION  simulatePwl  — the trapezoidal rule with a fixed step (backward Euler on the step after a
 *              jump where the mode is stiff), every mode change located by bisection on the step: what a circuit
 *              simulator does.
 *  THEORY      exactPwl     — the exact solution: x(t) = e^(A·t)·x0 + ∫e^(A·τ)dτ·b per mode (matrix
 *              exponential), every mode change found by bisection on the EXACT flow.
 *
 * Both use the same equations and the same mode rules (the physics); they differ in how they solve
 * them, so their agreement validates the simulation.
 */
export interface PwlSystem {
  n: number
  /** The mode consistent with state x at time t, given the previous mode (hysteresis, e.g. a latch). */
  mode(x: number[], t: number, prev: string): string
  /** The linear dynamics in a mode at time t (inputs held constant until the next breakpoint). */
  sys(mode: string, t: number): { A: Mat; b: number[] }
  /** Times where inputs jump (steps never straddle them). */
  breakpoints: number[]
}

export interface PwlEvent {
  t: number
  from: string
  to: string
}

export interface PwlResult {
  t: Float64Array
  x: Float64Array[]
  modes: string[]
  events: PwlEvent[]
  /** The state at every input breakpoint and mode change inside a step (between the stored samples). */
  knots: Array<{ t: number; x: number[]; mode: string }>
}

function trStep(A: Mat, b: number[], x: number[], h: number, be: boolean): number[] {
  // TR: (I − h/2·A)·x1 = (I + h/2·A)·x0 + h·b;  BE: (I − h·A)·x1 = x0 + h·b
  const n = x.length
  const M = new Float64Array(n * n)
  const rhs = new Float64Array(n)
  const k = be ? h : h / 2
  for (let i = 0; i < n; i++) {
    let r = x[i] + h * b[i]
    for (let j = 0; j < n; j++) {
      M[i * n + j] = (i === j ? 1 : 0) - k * A[i][j]
      if (!be) r += k * A[i][j] * x[j]
    }
    rhs[i] = r
  }
  const y = solveDense(M, rhs, n)
  if (!y) throw new Error('pwl: singular step')
  return Array.from(y)
}

function normInf(A: Mat): number {
  let m = 0
  for (const row of A) {
    let r = 0
    for (const v of row) r += Math.abs(v)
    m = Math.max(m, r)
  }
  return m
}

/** SIMULATION: fixed-step trapezoidal integration with exact mode-change location. */
export function simulatePwl(s: PwlSystem, x0: number[], t0: number, t1: number, steps: number, mode0?: string): PwlResult {
  const dt = (t1 - t0) / steps
  const t = new Float64Array(steps + 1)
  const x = Array.from({ length: s.n }, () => new Float64Array(steps + 1))
  const modes: string[] = []
  const events: PwlEvent[] = []
  const knots: PwlResult['knots'] = []
  let cur = [...x0]
  let mode = mode0 ?? s.mode(cur, t0, '')
  let be = true
  const store = (k: number, tk: number) => {
    t[k] = tk
    for (let i = 0; i < s.n; i++) x[i][k] = cur[i]
    modes[k] = mode
  }
  store(0, t0)
  const bps = [...s.breakpoints].sort((a, b) => a - b)
  let jb = 0
  for (let k = 1; k <= steps; k++) {
    const ta = t0 + (k - 1) * dt
    const tb = t0 + k * dt
    // cut the step at input breakpoints (a pointer into the sorted list: O(1) per step)
    while (jb < bps.length && bps[jb] <= ta + dt * 1e-9) jb++
    const cuts = [ta]
    for (let q = jb; q < bps.length && bps[q] < tb - dt * 1e-9; q++) cuts.push(bps[q])
    cuts.push(tb)
    for (let c = 0; c + 1 < cuts.length; c++) {
      let t = cuts[c]
      const tEnd = cuts[c + 1]
      if (c > 0) be = true // an input jump
      // Inputs are constant on the cut: every mode test uses the cut's inputs (its midpoint). An input jump
      // can change the mode by itself — test it at the start of the cut.
      const tIn = 0.5 * (t + tEnd)
      const m0 = s.mode(cur, tIn, mode)
      if (m0 !== mode) {
        events.push({ t, from: mode, to: m0 })
        knots.push({ t, x: [...cur], mode: m0 })
        mode = m0
        be = true
      }
      for (let guard = 0; guard < 16 && t < tEnd - dt * 1e-12; guard++) {
        const h = tEnd - t
        const sy = s.sys(mode, tIn)
        const { A, b } = sy
        // Backward Euler after a jump only where the mode is stiff for this step (|λ|·h ≳ 2, bounded by the
        // row-sum norm): there the trapezoidal rule would ring; elsewhere it stays second-order accurate.
        const stiff = be && normInf(A) * h > 2
        const y = trStep(A, b, cur, h, stiff)
        const m2 = s.mode(y, tIn, mode)
        if (m2 === mode) {
          cur = y
          t = tEnd
          be = false
          if (c + 2 < cuts.length) knots.push({ t, x: y, mode })
          break
        }
        // bisect for the first instant the mode is no longer valid
        let lo = 0
        let hi = h
        for (let it = 0; it < 60; it++) {
          const mid = (lo + hi) / 2
          const ym = trStep(A, b, cur, mid, be && normInf(A) * mid > 2)
          if (s.mode(ym, tIn, mode) === mode) lo = mid
          else hi = mid
        }
        const yS = hi > 0 ? trStep(A, b, cur, hi, be && normInf(A) * hi > 2) : cur
        const next = s.mode(yS, tIn, mode)
        events.push({ t: t + hi, from: mode, to: next })
        knots.push({ t: t + hi, x: yS, mode: next })
        cur = yS
        t += hi
        mode = next
        be = true
      }
    }
    store(k, tb)
  }
  return { t, x, modes, events, knots }
}

// Exponentials reused across equally spaced targets (same mode, inputs and step).
const flowCache = new Map<string, (x: number[]) => number[]>()
function cachedFlow(key: string, A: Mat, b: number[], h: number) {
  // 12 digits: step lengths that differ only by rounding (period starts minus edges) share an exponential;
  // the time error (< 1e-12 of a step) is far below anything compared against
  const k = key + h.toPrecision(12)
  let f = flowCache.get(k)
  if (!f) {
    if (flowCache.size > 5000) flowCache.clear()
    f = affineFlow(A, b, h)
    flowCache.set(k, f)
  }
  return f
}

/** First element of a sorted list greater than t (binary search). */
function nextAfter(sorted: number[], t: number): number | undefined {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] > t + Math.abs(t) * 1e-15 + 1e-300) hi = mid
    else lo = mid + 1
  }
  return sorted[lo]
}

/** THEORY: the exact solution, mode by mode, at the given sample times. */
export function exactPwl(s: PwlSystem, x0: number[], t0: number, times: number[], mode0?: string): { x: number[][]; modes: string[]; events: PwlEvent[] } {
  const out: number[][] = []
  const modes: string[] = []
  const events: PwlEvent[] = []
  let cur = [...x0]
  let t = t0
  let mode = mode0 ?? s.mode(cur, t0, '')
  const bps = [...s.breakpoints].sort((a, b) => a - b)
  for (const target of times) {
    for (let guard = 0; guard < 10000 && t < target - 1e-18; guard++) {
      const nextBp = nextAfter(bps, t)
      const tEnd = Math.min(target, nextBp ?? Infinity)
      // the segment's inputs (constant on it) decide every mode test, as in the simulation
      const tIn = (t + tEnd) / 2
      const m0 = s.mode(cur, tIn, mode)
      if (m0 !== mode) {
        events.push({ t, from: mode, to: m0 })
        mode = m0
      }
      const { A, b } = s.sys(mode, tIn)
      // the key holds the full dynamics (A and b): different systems never share an exponential
      const key = `${A.map((r) => r.join(',')).join(';')}|${b.join(',')}|`
      const step = (h: number, x: number[]) => cachedFlow(key, A, b, h)(x)
      const h = tEnd - t
      // Scan for the first mode change on the exact flow, then bisect. Both reuse one exponential per
      // step length (the scan composes h/N, the bisection halves it), so periodic inputs hit the cache.
      const N = 8
      let found = -1
      let yPrev = cur
      let y = cur
      for (let j = 1; j <= N; j++) {
        y = j === N ? step(h, cur) : step(h / N, yPrev)
        if (s.mode(y, tIn, mode) !== mode) {
          found = j
          break
        }
        yPrev = y
      }
      if (found < 0) {
        cur = y
        t = tEnd
        continue
      }
      let lo = (h * (found - 1)) / N
      let yLo = yPrev
      let w = h / N
      let yHi = y
      for (let it = 0; it < 60; it++) {
        w /= 2
        const yMid = step(w, yLo)
        if (s.mode(yMid, tIn, mode) === mode) {
          lo += w
          yLo = yMid
        } else yHi = yMid
      }
      // invariant: hi = lo + w and yHi = x(hi) — the first instant in the new mode (within 2^-60 of the step)
      cur = yHi
      t += lo + w
      const next = s.mode(cur, tIn, mode)
      events.push({ t, from: mode, to: next })
      mode = next
    }
    out.push([...cur])
    modes.push(mode)
  }
  return { x: out, modes, events }
}
