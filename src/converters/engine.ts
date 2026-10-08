import { solveNetlist, type Netlist, type NetlistSolution, type StorageState } from '../circuits/netlist.ts'
import { bisectTransition } from '../solvers/rootFinding.ts'
import { solveDense } from '../solvers/linear.ts'
import type { DiodeModel } from '../types/simulation.ts'
import type { Schedule } from './schedule.ts'
import type { ConverterSignal, DeviceTrace, Run, RunEvent, RunEventKind, RunParams } from './types.ts'

/**
 * Generic engine for switched circuits driven by gate schedules (DC-DC converters, inverters).
 *
 * The model supplies a netlist whose controlled devices read their gate from schedules, plus a
 * reader that turns a solved network into named signals. The engine owns time:
 *  - every gate edge is a breakpoint (a step never straddles one);
 *  - every diode transition is located by bisection on the self-consistency of the old state;
 *  - a transition forced at an edge (an inductor current that must change path NOW) is switched at
 *    that instant without advancing the storage through the impossible circuit;
 *  - the displayed run is the periodic steady state (shooting method) or a start-up from rest.
 *
 * Integration: the trapezoidal rule (second order, no numerical dissipation), except for the first
 * step after every switching instant or gate edge, which uses backward Euler — a jump in vL or iC
 * would otherwise make the trapezoidal rule ring. (Pure backward Euler dissipates ½·L·Δi² per step,
 * which in a boost shifts the inductor current's DC level by ~0.75 % at 200 steps per period.)
 */
export interface CircuitModel<P, R extends RunParams> {
  kind: string
  resolve(input: Partial<P>): { params: R; issues: string[] }
  build(p: R): BuiltCircuit
  /** Periods a start-up run lasts (default 20). */
  startupPeriods?(p: R): number
}
/** Back-compatible name used by the DC-DC models. */
export type ConverterModel<P, R extends RunParams> = CircuitModel<P, R>

export interface BuiltCircuit {
  net: Netlist
  diode: DiodeModel
  schedules: Schedule[]
  /** Signals from a solved network at time t. */
  read(sol: NetlistSolution, t: number): Record<string, number>
  /** Scale of each storage value, packed [iL…, vC…], for convergence tests. */
  scale: number[]
  /** Element ids (S and D) to trace, in display order. */
  devices: string[]
  /** Starting guess for the steady-state search, packed [iL…, vC…]. */
  initialGuess?: number[]
  /** A diode whose turn-off while every switch is off means DCM (emits 'il-zero'). */
  dcmDiode?: string
}

const MAX_SWITCHES_PER_STEP = 12
/** A gate edge closer than this fraction of Δt to a sample is taken as on the sample. */
const EDGE_EPS = 1e-6
const STEADY_TOL = 1e-9

interface SimState {
  storage: StorageState
  combo: number
  /** Use backward Euler for the next step (right after a switching instant). */
  be: boolean
}

/** Diode combinations near `c`: c itself, then 1, 2 and 3 flips, then every other combination. */
function* nearCombos(c: number, nd: number): Generator<number> {
  yield c
  for (let i = 0; i < nd; i++) yield c ^ (1 << i)
  for (let i = 0; i < nd; i++) for (let j = i + 1; j < nd; j++) yield c ^ (1 << i) ^ (1 << j)
  for (let i = 0; i < nd; i++) for (let j = i + 1; j < nd; j++) for (let k = j + 1; k < nd; k++) yield c ^ (1 << i) ^ (1 << j) ^ (1 << k)
  if (nd <= 14) for (let x = 0; x < 1 << nd; x++) if (popcount(x ^ c) > 3) yield x
}
function popcount(x: number) {
  let n = 0
  while (x) {
    n += x & 1
    x >>>= 1
  }
  return n
}

/** Solver counters (diagnostics and performance tests). */
export const SOLVER_STATS = { solves: 0, enumerations: 0 }

class Stepper {
  readonly nd: number
  readonly diodeEls: Array<{ id: string; gated: boolean }>
  readonly vf: Array<number | undefined>
  fallbacks = 0
  constructor(
    readonly b: BuiltCircuit,
    readonly p: RunParams,
  ) {
    this.diodeEls = []
    this.vf = []
    for (const e of b.net.elements)
      if (e.kind === 'D') {
        this.diodeEls.push({ id: e.id, gated: !!e.gate })
        this.vf.push(e.vf)
      }
    this.nd = this.diodeEls.length
  }
  solve(s: SimState, t: number, h: number, combo: number) {
    SOLVER_STATS.solves++
    return solveNetlist(this.b.net, this.b.diode, s.storage, t, h, combo, s.combo, s.be ? 'be' : 'tr')
  }
  /** Advance by h choosing the self-consistent diode combination (the present one first). */
  step(s: SimState, t: number, h: number): { sol: NetlistSolution; combo: number; fallback: boolean } {
    let best: { sol: NetlistSolution; combo: number } | null = null
    const tried = new Set<number>()
    // 1. Assumed-state repair: flip exactly the devices whose assumption the solution violates (ON with
    //    reverse current or without its gate → OFF; OFF with forward voltage above Vf and allowed to conduct
    //    → ON). This finds
    //    the new state in one or two solves even when several legs switch at once.
    let c = s.combo
    for (let iter = 0; iter < 12; iter++) {
      tried.add(c)
      const sol = this.solve(s, t, h, c)
      if (!sol) break
      if (sol.consistent) return { sol, combo: c, fallback: false }
      if (!best || sol.violation < best.sol.violation) best = { sol, combo: c }
      let next = c
      sol.diodes.forEach((d, j) => {
        const vf = this.vf[j] ?? this.b.diode.vf
        if (d.on && (!(d.current > 0) || d.gate === false)) next &= ~(1 << j)
        else if (!d.on && d.voltage > vf && d.gate !== false) next |= 1 << j
      })
      if (next === c || tried.has(next)) break
      c = next
    }
    // 2. Fallback: every combination, nearest first.
    SOLVER_STATS.enumerations++
    for (const c of nearCombos(s.combo, this.nd)) {
      if (tried.has(c)) continue
      const sol = this.solve(s, t, h, c)
      if (!sol) continue
      if (sol.consistent) return { sol, combo: c, fallback: false }
      if (!best || sol.violation < best.sol.violation) best = { sol, combo: c }
    }
    if (!best) throw new Error('circuit: no solvable diode combination')
    this.fallbacks++
    return { ...best, fallback: true }
  }
}

type Push = (kind: RunEventKind, t: number, sol: NetlistSolution, device?: string) => void

function recordSwitch(st: Stepper, before: number, after: number, t: number, sol: NetlistSolution, push: Push) {
  st.diodeEls.forEach((d, j) => {
    const was = (before >> j) & 1
    const now = (after >> j) & 1
    if (was === now) return
    push(d.gated ? (now ? 'igbt-on' : 'igbt-off') : now ? 'diode-on' : 'diode-off', t, sol, d.id)
    // A DC-DC diode turning off while every switch is off: the inductor current reached zero.
    if (!now && d.id === st.b.dcmDiode && sol.switches.every((x) => !x.on)) push('il-zero', t, sol)
  })
}

/** Advance from t0 to t1 (no gate edge strictly inside), locating diode transitions exactly. */
function advance(st: Stepper, s0: SimState, t0: number, t1: number, push: Push | null): { s: SimState; sol: NetlistSolution } {
  const dt = st.p.dt
  let s = s0
  let t = t0
  let res = st.step(s, t, t1 - t)
  for (let guard = 0; res.combo !== s.combo && guard < MAX_SWITCHES_PER_STEP; guard++) {
    const h = t1 - t
    const held = s.combo
    const from = s
    const ts0 = t
    const hMin = Math.min(h, dt * 1e-9)
    const breaks = (hh: number) => !(st.solve(from, ts0, hh, held)?.consistent ?? false)
    if (breaks(hMin)) {
      // The held combination is impossible from the very start of the interval: a commutation
      // forced by a gate edge (e.g. Q1 opens while the inductor carries current — a diode must take
      // it NOW). Switch at t without advancing the storage through the impossible circuit.
      const now = st.step(from, ts0, Math.min(h, dt * 1e-6))
      if (now.combo === held) break
      if (push) recordSwitch(st, held, now.combo, ts0, now.sol, push)
      s = { storage: from.storage, combo: now.combo, be: true }
      res = st.step(s, t, t1 - t)
      continue
    }
    const hS = bisectTransition(hMin, h, breaks)
    const at = st.solve(from, ts0, hS, held)
    if (!at || h - hS <= hMin) {
      if (push) recordSwitch(st, held, res.combo, t1, res.sol, push)
      break
    }
    const tS = ts0 + hS
    const probe = st.step({ storage: at.storage, combo: held, be: true }, tS, Math.min(h - hS, dt * 1e-6))
    if (push) recordSwitch(st, held, probe.combo, tS, probe.sol, push)
    s = { storage: at.storage, combo: probe.combo, be: true }
    t = tS
    res = st.step(s, t, t1 - t)
  }
  return { s: { storage: res.sol.storage, combo: res.combo, be: false }, sol: res.sol }
}

function edgesIn(b: BuiltCircuit, a: number, c: number): Array<{ t: number; rising: boolean; id: string }> {
  const out: Array<{ t: number; rising: boolean; id: string }> = []
  for (const s of b.schedules) for (const e of s.edgesIn(a, c)) out.push({ ...e, id: s.id })
  return out.sort((x, y) => x.t - y.t)
}

/** Integrate [tStart, tStart + steps·Δt], splitting steps at gate edges. */
function integrateRun(
  st: Stepper,
  s0: SimState,
  tStart: number,
  steps: number,
  onSample: ((k: number, t: number, sol: NetlistSolution) => void) | null,
  push: Push | null,
): SimState {
  const { dt } = st.p
  const first = st.step(s0, tStart, dt * 1e-9)
  onSample?.(0, tStart, first.sol)
  let s: SimState = { storage: s0.storage, combo: first.combo, be: true }
  if (push) for (const e of edgesIn(st.b, tStart - dt * EDGE_EPS, tStart + dt * EDGE_EPS)) push(e.rising ? 'gate-on' : 'gate-off', tStart, first.sol, e.id)
  for (let k = 1; k <= steps; k++) {
    const ta = tStart + (k - 1) * dt
    const tb = tStart + k * dt
    let t = ta
    let sol: NetlistSolution | null = null
    for (const e of edgesIn(st.b, ta + EDGE_EPS * dt, tb + EDGE_EPS * dt)) {
      // An edge within EDGE_EPS·Δt of the sample is taken as on the sample.
      const te = e.t >= tb - EDGE_EPS * dt ? tb : e.t
      // Edges closer than 10⁻⁹·Δt (e.g. two SVPWM legs switching "together") are simultaneous: a step
      // that short would make the network matrix numerically singular.
      if (te > t + 1e-9 * dt) {
        const r = advance(st, s, t, te, push)
        s = r.s
        sol = r.sol
        t = te
      }
      // A gate edge: derivatives jump, so the next step is backward Euler.
      s = { ...s, be: true }
      if (push) {
        // Values just after the edge: a tiny probe step with the new gate state.
        const probe = st.step(s, te, dt * 1e-6)
        push(e.rising ? 'gate-on' : 'gate-off', te, probe.sol, e.id)
      }
    }
    if (tb > t) {
      const r = advance(st, s, t, tb, push)
      s = r.s
      sol = r.sol
    }
    onSample?.(k, tb, sol!)
  }
  return s
}

const countKind = (b: BuiltCircuit, k: 'L' | 'C') => b.net.elements.filter((e) => e.kind === k).length
const zeroState = (b: BuiltCircuit): SimState => ({ storage: { iL: new Float64Array(countKind(b, 'L')), vC: new Float64Array(countKind(b, 'C')) }, combo: 0, be: true })
const pack = (s: StorageState) => [...s.iL, ...s.vC]
const unpack = (b: BuiltCircuit, x: number[]): SimState => {
  const z = zeroState(b)
  z.storage.iL.set(x.slice(0, z.storage.iL.length))
  z.storage.vC.set(x.slice(z.storage.iL.length))
  return z
}
function stateDistance(b: BuiltCircuit, x: number[], y: number[]): number {
  let d = 0
  x.forEach((v, k) => (d = Math.max(d, Math.abs(v - y[k]) / Math.max(b.scale[k] ?? 1, 1e-12))))
  return d
}

/**
 * Periodic steady state by the SHOOTING method: x₀ with Φ(x₀) = x₀, Φ = one period integrated with
 * exactly the displayed discretisation. Newton with a finite-difference Jacobian (one iteration when
 * the period map is affine, a few in DCM); falls back to period-by-period integration.
 */
export function findSteadyState(b: BuiltCircuit, p: RunParams) {
  const st = new Stepper(b, p)
  const phi = (x: number[]) => pack(integrateRun(st, unpack(b, x), 0, p.stepsPerPeriod, null, null).storage)
  const n = pack(zeroState(b).storage).length
  let x = b.initialGuess && b.initialGuess.length === n ? [...b.initialGuess] : new Array<number>(n).fill(0)
  let iterations = 0
  for (; iterations < 12; iterations++) {
    const fx = phi(x)
    const F = fx.map((v, k) => v - x[k])
    const res = stateDistance(b, fx, x)
    if (res < STEADY_TOL) return { x, iterations, residual: res, method: 'shooting' as const, converged: true }
    const J = new Float64Array(n * n)
    for (let j = 0; j < n; j++) {
      const dx = 1e-6 * Math.max(b.scale[j] ?? 1, 1e-12)
      const xp = [...x]
      xp[j] += dx
      const fp = phi(xp)
      for (let i = 0; i < n; i++) J[i * n + j] = (fp[i] - xp[i] - F[i]) / dx
    }
    const step = solveDense(J, Float64Array.from(F.map((v) => -v)), n)
    if (!step) break
    // Damped update: never accept a step that increases the residual a lot.
    let lam = 1
    let next = x.map((v, k) => v + step[k])
    for (let tries = 0; tries < 6; tries++) {
      const r2 = stateDistance(b, phi(next), next)
      if (r2 < res || r2 < STEADY_TOL) break
      lam /= 2
      next = x.map((v, k) => v + lam * step[k])
    }
    x = next
  }
  // Fallback: integrate period after period until the state repeats.
  let s = unpack(b, x)
  let res = Infinity
  let k = 0
  for (; k < 5000 && res > STEADY_TOL; k++) {
    const before = pack(s.storage)
    s = integrateRun(st, s, 0, p.stepsPerPeriod, null, null)
    res = stateDistance(b, pack(s.storage), before)
  }
  return { x: pack(s.storage), iterations: iterations + k, residual: res, method: 'integration' as const, converged: res <= 1e-6 }
}

/** Simulate a circuit model: periodic steady state (default) or the start-up from rest. */
export function simulateCircuit<P, R extends RunParams>(model: CircuitModel<P, R>, input: Partial<P>): Run<R> {
  const started = performance.now()
  const { params: p0, issues } = model.resolve(input)
  let p = p0
  let s0: SimState
  let steady: Run['diagnostics']['steady']
  if (p.view === 'startup') {
    const periods = model.startupPeriods?.(p) ?? 20
    const spp = Math.max(50, Math.min(p.stepsPerPeriod, Math.floor(120_000 / periods)))
    p = { ...p, periods, stepsPerPeriod: spp, dt: p.period / spp, duration: periods * p.period }
    s0 = zeroState(model.build(p))
    steady = { method: 'startup', iterations: 0, residual: NaN, converged: false }
  } else {
    const b0 = model.build(p)
    const ss = findSteadyState(b0, p)
    s0 = unpack(b0, ss.x)
    steady = { method: ss.method, iterations: ss.iterations, residual: ss.residual, converged: ss.converged }
  }
  const b = model.build(p)
  const st = new Stepper(b, p)
  const steps = p.periods * p.stepsPerPeriod
  const n = steps + 1
  const time = new Float64Array(n)
  const signals: Record<string, Float64Array> = {}
  const els = b.net.elements
  const devIdx = b.devices.map((id) => els.find((e) => e.id === id)!)
  const devices: DeviceTrace[] = devIdx.map((el) => {
    const kind = el.kind === 'S' ? 'switch' : el.kind === 'D' && el.gate ? 'igbt' : 'diode'
    return { id: el.id, kind, on: new Uint8Array(n), current: new Float64Array(n), voltage: new Float64Array(n), ...(kind !== 'diode' ? { gate: new Uint8Array(n) } : {}) }
  })
  const gateFns = devIdx.map((el) => (el.kind === 'S' ? el.gate : el.kind === 'D' && el.gate ? el.gate : null))
  const events: RunEvent[] = []
  let seq = 0
  const push: Push = (kind, t, sol, device) => events.push({ id: `c${seq++}`, kind, time: t, device, values: b.read(sol, t) })
  let prevPeriodState: number[] | null = null
  const onSample = (k: number, t: number, sol: NetlistSolution) => {
    time[k] = t
    const v = b.read(sol, t)
    for (const key in v) (signals[key] ??= new Float64Array(n))[k] = v[key]
    // The gate state that produced this sample: the one at the END of the interval (t[k−1], t[k]] (the
    // stored solution is the last sub-step, after any gate edge inside the interval).
    const tMid = k === 0 ? t + p.dt * 1e-9 : t - p.dt * 1e-9
    devices.forEach((d, j) => {
      const r = sol.switches.find((x) => x.id === d.id) ?? sol.diodes.find((x) => x.id === d.id)!
      d.on[k] = r.on ? 1 : 0
      d.current[k] = r.current
      d.voltage[k] = r.voltage
      const g = gateFns[j]
      if (d.gate && g) d.gate[k] = g(tMid) ? 1 : 0
    })
    if (k === steps - p.stepsPerPeriod) prevPeriodState = pack(sol.storage)
  }
  const end = integrateRun(st, s0, 0, steps, onSample, push)
  if (p.view === 'startup') {
    // How periodic is the end of the start-up run? Compare the last two period-end states.
    steady.residual = prevPeriodState ? stateDistance(b, pack(end.storage), prevPeriodState) : NaN
    steady.converged = steady.residual < 1e-3
  } else {
    steady.residual = Math.max(steady.residual, stateDistance(b, pack(end.storage), pack(s0.storage)))
  }
  events.sort((x, y) => x.time - y.time || order(x.kind) - order(y.kind))
  return {
    kind: model.kind,
    params: p,
    length: n,
    time,
    signals,
    devices,
    events,
    steadyFrom: p.view === 'startup' ? n - 1 - p.stepsPerPeriod : 0,
    diagnostics: { computeMs: performance.now() - started, fallbacks: st.fallbacks, steady, issues },
  }
}

/** Back-compatible name. */
export const simulateConverter = simulateCircuit

/** At equal times: gate edges first, then the conduction changes they cause. */
const order = (k: RunEventKind) => ['gate-on', 'gate-off', 'igbt-off', 'diode-off', 'igbt-on', 'diode-on', 'il-zero'].indexOf(k)

/** Sample index nearest to time t. */
export function converterIndexAt(r: Run, t: number): number {
  return Math.min(r.length - 1, Math.max(0, Math.round(t / r.params.dt)))
}

/** One sample as plain values (+ the first two devices' states, used by the DC-DC converters). */
export function converterSample(r: Run, k: number): Record<ConverterSignal, number> & { t: number; qOn: boolean; dOn: boolean; k: number } {
  const i = Math.min(r.length - 1, Math.max(0, k))
  const out: Record<string, number> = {}
  for (const key in r.signals) out[key] = r.signals[key][i]
  return { ...(out as Record<ConverterSignal, number>), t: r.time[i], qOn: r.devices[0]?.on[i] === 1, dOn: r.devices[1]?.on[i] === 1, k: i }
}

/** All signal values at one sample. */
export function sampleValues(r: Run, k: number): Record<string, number> {
  const i = Math.min(r.length - 1, Math.max(0, k))
  const out: Record<string, number> = {}
  for (const key in r.signals) out[key] = r.signals[key][i]
  return out
}

/**
 * Average of a (possibly discontinuous) signal over the window from sample `from`, with the same
 * quadrature the integrator uses: the trapezoid rule on intervals without a switching instant, and
 * — where an event falls at the start of or inside an interval — the interval split there, each part
 * taking the value the circuit had in it (an event records the values just after it; the step after
 * an event is backward Euler, whose value is its end value).
 */
export function segmentAverage(r: Run, sid: string, from = r.steadyFrom): number {
  const a = r.signals[sid]
  const { dt } = r.params
  const ev = r.events
  let j = 0
  let sum = 0
  for (let k = from + 1; k < r.length; k++) {
    const t0 = r.time[k - 1]
    const t1 = r.time[k]
    while (j < ev.length && ev[j].time < t0 - dt * 1e-9) j++
    let jj = j
    let atStart = false
    let v = a[k - 1]
    while (jj < ev.length && Math.abs(ev[jj].time - t0) <= dt * 1e-9) {
      v = ev[jj++].values[sid] ?? v
      atStart = true
    }
    const inside: number[] = []
    for (let q = jj; q < ev.length && ev[q].time < t1 - dt * 1e-9; q++) inside.push(q)
    if (!atStart && !inside.length) {
      sum += 0.5 * (a[k - 1] + a[k]) * (t1 - t0)
      continue
    }
    let t = t0
    for (const q of inside) {
      sum += v * (ev[q].time - t)
      t = ev[q].time
      v = ev[q].values[sid] ?? v
    }
    sum += a[k] * (t1 - t)
  }
  return sum / (r.time[r.length - 1] - r.time[from])
}

/**
 * A simulated signal over samples [kFrom, kTo] as piecewise-linear segments for exact Fourier integrals,
 * with the same quadrature the integrator uses (trapezoid between samples; an interval with a switching
 * event at its start or inside it split there, each part at the value the circuit had in it). Times are
 * shifted so the window starts at 0.
 */
export function runSegments(r: Run, sid: string, kFrom: number, kTo: number): Array<{ ta: number; tb: number; va: number; vb: number }> {
  const a = r.signals[sid]
  const { dt } = r.params
  const ev = r.events
  const t00 = r.time[kFrom]
  const segs: Array<{ ta: number; tb: number; va: number; vb: number }> = []
  let j = 0
  for (let k = kFrom + 1; k <= kTo; k++) {
    const t0 = r.time[k - 1]
    const t1 = r.time[k]
    while (j < ev.length && ev[j].time < t0 - dt * 1e-9) j++
    let jj = j
    let atStart = false
    let v = a[k - 1]
    while (jj < ev.length && Math.abs(ev[jj].time - t0) <= dt * 1e-9) {
      v = ev[jj++].values[sid] ?? v
      atStart = true
    }
    const inside: number[] = []
    for (let q = jj; q < ev.length && ev[q].time < t1 - dt * 1e-9; q++) inside.push(q)
    if (!atStart && !inside.length) {
      segs.push({ ta: t0 - t00, tb: t1 - t00, va: a[k - 1], vb: a[k] })
      continue
    }
    let t = t0
    for (const q of inside) {
      segs.push({ ta: t - t00, tb: ev[q].time - t00, va: v, vb: v })
      t = ev[q].time
      v = ev[q].values[sid] ?? v
    }
    segs.push({ ta: t - t00, tb: t1 - t00, va: a[k], vb: a[k] })
  }
  return segs
}
