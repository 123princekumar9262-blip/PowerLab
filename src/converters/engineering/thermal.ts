import type { Mat } from '../expm.ts'
import { simulatePwl, type PwlResult, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * ENGINEERING — losses and temperature of a power switch.
 *
 * Losses (hard-switched converter leg, current I, duty D, frequency fs):
 *   conduction  Pc = D·I²·Ron(Tj),          Ron(Tj) = Ron25·(1 + α·(Tj − 25 °C))
 *   switching   Ps = fs·½·Vdc·I·tsw·(1 + κ·(Tj − 25 °C))
 * Both rise with the junction temperature: P = a + b·(Tj − 25 °C) — an affine function of Tj.
 *
 * Thermal path: the datasheet's junction-to-case impedance as a FOSTER network (three R‖C stages,
 * Zth(t) = Σ Ri·(1 − e^(−t/τi))) in series with a heatsink stage (Rha, τha):
 *   Tj = Ta + Σ θi,   Ci·dθi/dt = P − θi/Ri
 * The Foster stages are a curve fit, not physical layers: only Tj (and roughly the heatsink, θ4) is
 * meaningful. Because P is affine in Tj the whole system is LINEAR (piecewise in time when the load is
 * pulsed) — solved by the PWL toolkit: time-stepping (SIMULATION) and matrix exponential (THEORY).
 * If b·Rth ≥ 1 the feedback wins: THERMAL RUNAWAY.
 */
export type LoadProfile = 'constant' | 'pulsed'

export interface ThermalParams {
  load: LoadProfile
  i: number
  vdc: number
  duty: number
  fs: number
  /** On-resistance at 25 °C [Ω] and its temperature coefficient [1/K]. */
  ron: number
  alpha: number
  /** Switching time ½·(tr + tf) sum [s] and the switching-loss temperature coefficient [1/K]. */
  tsw: number
  kappa: number
  /** Heatsink (case-to-ambient) thermal resistance [K/W] and time constant [s]. */
  rha: number
  tauha: number
  ta: number
  /** Pulsed load: on and off times [s]. */
  ton: number
  toff: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

/** Datasheet-style junction-to-case Foster network (R [K/W], τ [s]). */
export const FOSTER_JC: Array<[number, number]> = [
  [0.05, 0.002],
  [0.15, 0.03],
  [0.1, 0.3],
]

export interface ResolvedThermal extends ThermalParams, RunParams {
  /** All four stages: R [K/W], C [J/K]. */
  stages: Array<{ r: number; c: number; tau: number }>
  rth: number
  rjc: number
  /** Loss model at 25 °C and its slope [W], [W/K]. */
  a: number
  b: number
  pc25: number
  ps25: number
}

export const THERMAL_DEFAULTS: ThermalParams = {
  load: 'pulsed',
  i: 80,
  vdc: 600,
  duty: 0.5,
  fs: 10e3,
  ron: 0.01,
  alpha: 0.006,
  tsw: 133e-9,
  kappa: 0.003,
  rha: 0.5,
  tauha: 60,
  ta: 40,
  ton: 2,
  toff: 2,
  view: 'steady',
  periods: 0,
  stepsPerPeriod: 0,
}

export const THERMAL_LIMITS = {
  i: { min: 1, max: 400 },
  vdc: { min: 10, max: 1500 },
  duty: { min: 0.05, max: 1 },
  fs: { min: 100, max: 200e3 },
  ron: { min: 0.001, max: 0.5 },
  alpha: { min: 0, max: 0.012 },
  tsw: { min: 5e-9, max: 2e-6 },
  kappa: { min: 0, max: 0.01 },
  rha: { min: 0.05, max: 5 },
  tauha: { min: 1, max: 600 },
  ta: { min: -20, max: 80 },
  ton: { min: 0.01, max: 60 },
  toff: { min: 0.01, max: 60 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveThermal(input: Partial<ThermalParams>): { params: ResolvedThermal; issues: string[] } {
  const p = { ...THERMAL_DEFAULTS, ...input }
  const issues: string[] = []
  const L = THERMAL_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, THERMAL_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = { i: c('i'), vdc: c('vdc'), duty: c('duty'), fs: c('fs'), ron: c('ron'), alpha: c('alpha'), tsw: c('tsw'), kappa: c('kappa'), rha: c('rha'), tauha: c('tauha'), ta: c('ta'), ton: c('ton'), toff: c('toff') }
  const load: LoadProfile = p.load === 'constant' ? 'constant' : 'pulsed'
  const view = p.view === 'startup' ? 'startup' : 'steady'
  const stages = [...FOSTER_JC, [q.rha, q.tauha] as [number, number]].map(([r, tau]) => ({ r, c: tau / r, tau }))
  const rth = stages.reduce((s, x) => s + x.r, 0)
  const pc25 = q.duty * q.i * q.i * q.ron
  const ps25 = q.fs * 0.5 * q.vdc * q.i * q.tsw
  const a = pc25 + ps25
  const b = pc25 * q.alpha + ps25 * q.kappa
  // the display period: one load cycle (pulsed) or a nominal second (constant)
  const T = load === 'pulsed' ? q.ton + q.toff : 1
  let periods: number
  let spp: number
  if (view === 'steady') {
    periods = 2
    spp = load === 'pulsed' ? 2000 : 200
  } else {
    const horizon = 6 * q.tauha
    periods = p.periods > 0 ? Math.round(p.periods) : Math.max(2, Math.ceil(horizon / T))
    if (periods > 3000) {
      issues.push('the heatsink time constant is long compared with the load cycle: the window is limited to 3000 cycles')
      periods = 3000
    }
    // resolve the fastest stage where possible within a sample budget
    spp = Math.max(40, Math.min(2000, 2 * Math.round(60000 / periods / 2)))
  }
  if (b * rth >= 1) issues.push('thermal runaway: the losses grow faster with temperature than the heatsink can remove them (b·Rth ≥ 1)')
  const params: ResolvedThermal = {
    ...p,
    ...q,
    load,
    view,
    periods,
    stepsPerPeriod: spp,
    period: T,
    dt: T / spp,
    duration: periods * T,
    stages,
    rth,
    rjc: FOSTER_JC.reduce((s, x) => s + x[0], 0),
    a,
    b,
    pc25,
    ps25,
  }
  return { params, issues }
}

/** Load on at t (an instant on an edge takes the new value). */
export function loadOn(p: ResolvedThermal, t: number): boolean {
  if (p.load === 'constant') return true
  const T = p.period
  const m = Math.floor(t / T + 1e-9)
  return t - m * T < p.ton - 1e-9 * T
}

export function thermalBreakpoints(p: ResolvedThermal, t0 = 0, t1 = p.duration): number[] {
  if (p.load === 'constant') return []
  const out: number[] = []
  for (let m = 0; m < p.periods; m++) {
    for (const t of [m * p.period, m * p.period + p.ton]) if (t > t0 && t < t1) out.push(t)
  }
  return out
}

/** Loss at a junction temperature (load on). */
export function lossAt(p: ResolvedThermal, tj: number): { pc: number; ps: number } {
  return { pc: p.pc25 * (1 + p.alpha * (tj - 25)), ps: p.ps25 * (1 + p.kappa * (tj - 25)) }
}

/** dθ/dt = A·θ + b with the load on or off. */
export function thermalMatrices(p: ResolvedThermal, on: boolean): { A: Mat; b: number[] } {
  const n = p.stages.length
  const A: Mat = p.stages.map((s, i) => Array.from({ length: n }, (_, j) => (on ? p.b / s.c : 0) - (i === j ? 1 / (s.r * s.c) : 0)))
  const b = p.stages.map((s) => (on ? (p.a + p.b * (p.ta - 25)) / s.c : 0))
  return { A, b }
}

export function thermalSystem(p: ResolvedThermal, breakpoints = thermalBreakpoints(p)): PwlSystem {
  return {
    n: p.stages.length,
    breakpoints,
    mode: () => 'th',
    sys: (_m, t) => thermalMatrices(p, loadOn(p, t)),
  }
}

export type ThermalRun = Run<ResolvedThermal> & { knots: PwlResult['knots'] }

/** Linear one-period map θ(T) = Φ·θ(0) + c — the fixed point by one Newton step (the map is affine). */
export function periodicTheta(map: (x: number[]) => number[], n: number): { x: number[]; residual: number } {
  const x0 = new Array(n).fill(0)
  const c = map(x0)
  const J: number[][] = []
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0)
    e[j] = 1
    const fj = map(e)
    J.push(fj.map((v, i) => v - c[i]))
  }
  // solve (I − Φ)·x = c, Φ[i][j] = J[j][i]
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - J[j][i]))
  const rhs = [...c]
  for (let k = 0; k < n; k++) {
    let piv = k
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[piv][k])) piv = i
    ;[M[k], M[piv]] = [M[piv], M[k]]
    ;[rhs[k], rhs[piv]] = [rhs[piv], rhs[k]]
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k]
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j]
      rhs[i] -= f * rhs[k]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i]
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]
    x[i] = s / M[i][i]
  }
  const y = map(x)
  return { x, residual: Math.max(...y.map((v, i) => Math.abs(v - x[i]))) }
}

export function simulateThermal(input: Partial<ThermalParams>): ThermalRun {
  const started = performance.now()
  const { params: p, issues } = resolveThermal(input)
  if (p.view === 'steady' && p.b * p.rth >= 1) {
    // no stable periodic state exists (the fixed point is unstable): show the heating from ambient instead
    const r = simulateThermal({ ...input, view: 'startup' })
    r.diagnostics.issues.push('no stable steady state exists (thermal runaway): showing the heating from ambient instead')
    return r
  }
  const n4 = p.stages.length
  let x0 = new Array(n4).fill(0)
  let steady: ThermalRun['diagnostics']['steady'] = { method: 'startup', iterations: 0, residual: NaN, converged: false }
  if (p.view === 'steady') {
    const sys1 = thermalSystem(p, thermalBreakpoints(p, 0, p.period))
    const map = (x: number[]) => {
      const r = simulatePwl(sys1, x, 0, p.period, p.stepsPerPeriod, 'th')
      return r.x.map((a) => a[p.stepsPerPeriod])
    }
    const sh = periodicTheta(map, n4)
    x0 = sh.x
    steady = { method: 'shooting', iterations: 1, residual: sh.residual / Math.max(1, p.a * p.rth), converged: p.b * p.rth < 1 && sh.residual / Math.max(1, p.a * p.rth) < 1e-8 }
  }
  const sys = thermalSystem(p)
  const steps = p.periods * p.stepsPerPeriod
  const res = simulatePwl(sys, x0, 0, p.duration, steps, 'th')
  const n = steps + 1
  const names = ['tj', 'ths', 'p', 'pc', 'ps', 'load', 'ta']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  for (let k = 0; k < n; k++) {
    const t = res.t[k]
    let sum = 0
    for (let j = 0; j < n4; j++) sum += res.x[j][k]
    const tj = p.ta + sum
    const on = loadOn(p, k > 0 ? t - p.dt * 1e-6 : 0)
    const l = lossAt(p, tj)
    s.tj[k] = tj
    s.ths[k] = p.ta + res.x[n4 - 1][k]
    s.pc[k] = on ? l.pc : 0
    s.ps[k] = on ? l.ps : 0
    s.p[k] = s.pc[k] + s.ps[k]
    s.load[k] = on ? 1 : 0
    s.ta[k] = p.ta
  }
  if (p.view === 'startup') {
    const spp = p.stepsPerPeriod
    const a = s.tj[p.periods * spp]
    const b = s.tj[(p.periods - 1) * spp]
    steady = { method: 'startup', iterations: 0, residual: Math.abs(a - b) / Math.max(1, Math.abs(a - p.ta)), converged: p.b * p.rth < 1 && Math.abs(a - b) / Math.max(1, Math.abs(a - p.ta)) < 2e-3 }
  }
  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
    events.push({ id: `t${seq++}`, kind, time: t, device, values: { tj: s.tj[k], p: s.p[k] } })
  }
  if (p.load === 'pulsed' && p.view === 'steady')
    for (let m = 0; m < p.periods; m++) {
      if (m > 0) ev('gate-on', m * p.period, 'load-on')
      ev('gate-off', m * p.period + p.ton, 'load-off')
    }
  let kMax = 0
  for (let k = 0; k < n; k++) if (s.tj[k] > s.tj[kMax]) kMax = k
  ev('mode', res.t[kMax], 'tj-max')
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'thermal',
    params: p,
    length: n,
    time: res.t,
    signals: { ...s, ...Object.fromEntries(res.x.map((x, j) => [`th${j}`, x])) },
    devices: [],
    events,
    steadyFrom: p.view === 'steady' ? 0 : (p.periods - 1) * p.stepsPerPeriod,
    knots: res.knots,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady, issues },
  }
}

export interface ThermalMeasurements {
  /** Last load cycle. */
  tjMax: number
  tjMin: number
  tjMean: number
  dTj: number
  thsMean: number
  /** Mean losses over the last cycle [W]. */
  pMean: number
  pcMean: number
  psMean: number
  /** Whole run. */
  tjPeakRun: number
  /** Start-up: time for Tj to rise 90 % of the way to its final mean. */
  t90: number | null
  runaway: boolean
  settled: boolean
}

export function measureThermal(r: ThermalRun): ThermalMeasurements {
  const p = r.params
  const s = r.signals
  const spp = p.stepsPerPeriod
  const k0 = (p.periods - 1) * spp
  const k1 = p.periods * spp
  let tjMax = -Infinity
  let tjMin = Infinity
  let tjInt = 0
  let thsInt = 0
  let pInt = 0
  let pcInt = 0
  let psInt = 0
  for (let k = k0; k <= k1; k++) {
    tjMax = Math.max(tjMax, s.tj[k])
    tjMin = Math.min(tjMin, s.tj[k])
  }
  // the extremes fall on load edges, which may lie between samples: include the simulator's edge states
  const tA = r.time[k0]
  for (const kn of r.knots)
    if (kn.t > tA) {
      const tj = p.ta + kn.x.reduce((x, y) => x + y, 0)
      tjMax = Math.max(tjMax, tj)
      tjMin = Math.min(tjMin, tj)
    }
  // losses: trapezoid in Tj through the samples and the edge states, with the load state of each piece
  {
    const n4 = p.stages.length
    let j = 0
    while (j < r.knots.length && r.knots[j].t <= tA) j++
    for (let k = k0; k < k1; k++) {
      let ta = r.time[k]
      let tjA = s.tj[k]
      let thA = s.ths[k]
      const piece = (tb: number, tjB: number, thB: number) => {
        const w = (tb - ta) / p.dt
        tjInt += 0.5 * (tjA + tjB) * w
        thsInt += 0.5 * (thA + thB) * w
        thA = thB
        if (loadOn(p, 0.5 * (ta + tb))) {
          const l0 = lossAt(p, tjA)
          const l1 = lossAt(p, tjB)
          pcInt += 0.5 * (l0.pc + l1.pc) * ((tb - ta) / p.dt)
          psInt += 0.5 * (l0.ps + l1.ps) * ((tb - ta) / p.dt)
        }
        ta = tb
        tjA = tjB
      }
      for (; j < r.knots.length && r.knots[j].t < r.time[k + 1]; j++)
        if (r.knots[j].t > ta) piece(r.knots[j].t, p.ta + r.knots[j].x.slice(0, n4).reduce((x, y) => x + y, 0), p.ta + r.knots[j].x[n4 - 1])
      piece(r.time[k + 1], s.tj[k + 1], s.ths[k + 1])
    }
  }
  pInt = pcInt + psInt
  let tjPeakRun = -Infinity
  for (let k = 0; k < r.length; k++) tjPeakRun = Math.max(tjPeakRun, s.tj[k])
  for (const kn of r.knots) tjPeakRun = Math.max(tjPeakRun, p.ta + kn.x.reduce((x, y) => x + y, 0))
  const tjMean = tjInt / spp
  let t90: number | null = null
  if (p.view === 'startup') {
    const target = p.ta + 0.9 * (tjMean - p.ta)
    for (let k = 1; k < r.length; k++)
      if (s.tj[k] >= target) {
        t90 = r.time[k - 1] + ((target - s.tj[k - 1]) / (s.tj[k] - s.tj[k - 1])) * p.dt
        break
      }
  }
  return {
    tjMax,
    tjMin,
    tjMean,
    dTj: tjMax - tjMin,
    thsMean: thsInt / spp,
    pMean: pInt / spp,
    pcMean: pcInt / spp,
    psMean: psInt / spp,
    tjPeakRun,
    t90,
    runaway: p.b * p.rth >= 1,
    settled: r.diagnostics.steady.converged,
  }
}
