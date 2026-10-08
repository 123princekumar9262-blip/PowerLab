import { bisectTransition } from '../../solvers/rootFinding.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * PWM LAB — the modulator, simulated. A carrier c(t) ∈ [−1, 1] is compared with a reference
 * r(t) ∈ [−1, 1]; the comparator output g = (r > c) is the gate command, and the output stage turns
 * it into a pulse train (unipolar 0…Vdc or bipolar ±Vdc/2). Every edge is the exact instant where the
 * comparator changes state, located by root finding — nothing is drawn from a formula.
 *
 *   triangle carrier: −1 at the start of each carrier period, +1 at its middle (symmetric)
 *   sawtooth carrier: rises from −1 to +1 over the period, then resets (trailing-edge modulation)
 *   natural sampling:          the reference is compared as it is
 *   regular, symmetric:        the reference is sampled once per carrier period (at the valley) and held
 *   regular, asymmetric:       sampled twice per period (valley and peak) — triangle carrier only
 *   counter resolution N bits: a sampled reference is quantised to 2^N levels (digital PWM)
 */
export interface PwmParams {
  carrier: 'triangle' | 'sawtooth'
  reference: 'dc' | 'sine'
  /** DC reference: duty ratio D (0…1), r = 2D − 1. */
  duty: number
  /** Sine reference: modulation index M (peak of r), fundamental f1 and frequency ratio mf = fc/f1. */
  m: number
  f1: number
  mf: number
  /** DC reference: carrier frequency fc [Hz]. */
  fc: number
  sampling: 'natural' | 'regular-sym' | 'regular-asym'
  /** Counter resolution [bits]; 0 = analog comparator. Applies to a sampled reference. */
  bits: number
  output: 'unipolar' | 'bipolar'
  vdc: number
  /** Dead time between the complementary gates GH and GL [s]. */
  td: number
  view: 'steady' | 'startup'
  periods: number
  /** Samples per CARRIER period (display resolution only — edges are exact). */
  stepsPerPeriod: number
}

export interface ResolvedPwm extends PwmParams, RunParams {
  /** Carrier period Tc [s] and frequency. */
  tc: number
  fcEff: number
}

export const PWM_DEFAULTS: PwmParams = {
  carrier: 'triangle',
  reference: 'sine',
  duty: 0.5,
  m: 0.8,
  f1: 50,
  mf: 15,
  fc: 1000,
  sampling: 'natural',
  bits: 0,
  output: 'bipolar',
  vdc: 100,
  td: 0,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 120,
}

export const PWM_LIMITS = {
  duty: { min: 0, max: 1 },
  m: { min: 0, max: 1.5 },
  f1: { min: 1, max: 400 },
  mf: { min: 3, max: 99 },
  fc: { min: 100, max: 100e3 },
  bits: { min: 0, max: 12 },
  vdc: { min: 1, max: 1000 },
  td: { min: 0, max: 50e-6 },
  periods: { min: 1, max: 8 },
  stepsPerPeriod: { min: 40, max: 1000 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolvePwm(input: Partial<PwmParams>): { params: ResolvedPwm; issues: string[] } {
  const p = { ...PWM_DEFAULTS, ...input }
  const issues: string[] = []
  const c = (k: keyof typeof PWM_LIMITS) => {
    const raw = p[k] as number
    const v = clamp(raw, PWM_LIMITS[k].min, PWM_LIMITS[k].max, PWM_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const sine = p.reference === 'sine'
  const mf = Math.round(c('mf'))
  const f1 = c('f1')
  const fc = sine ? mf * f1 : c('fc')
  const tc = 1 / fc
  const periods = Math.round(c('periods'))
  const spp = Math.round(c('stepsPerPeriod'))
  // The steady-state period: the fundamental for a sine reference (mf is an integer, so the pattern
  // repeats every 1/f1), the carrier period for a DC reference.
  const period = sine ? 1 / f1 : tc
  const stepsPerPeriod = sine ? spp * mf : spp
  const sampling = p.carrier === 'sawtooth' && p.sampling === 'regular-asym' ? 'regular-sym' : p.sampling
  if (sampling !== p.sampling) issues.push('asymmetric sampling needs a triangle carrier — using symmetric')
  const params: ResolvedPwm = {
    ...p,
    sampling,
    duty: c('duty'),
    m: c('m'),
    f1,
    mf,
    fc,
    bits: Math.round(c('bits')),
    vdc: c('vdc'),
    td: Math.min(c('td'), tc / 4),
    tc,
    fcEff: fc,
    period,
    stepsPerPeriod,
    periods: sine ? periods : Math.max(periods, 3),
    dt: period / stepsPerPeriod,
    duration: (sine ? periods : Math.max(periods, 3)) * period,
    view: 'steady',
  }
  return { params, issues }
}

/** The carrier at time t. */
export function carrierAt(p: ResolvedPwm, t: number): number {
  const u = t / p.tc - Math.floor(t / p.tc)
  if (p.carrier === 'sawtooth') return -1 + 2 * u
  return u < 0.5 ? -1 + 4 * u : 3 - 4 * u
}

/** The continuous reference at time t. */
export function referenceAt(p: ResolvedPwm, t: number): number {
  return p.reference === 'dc' ? 2 * p.duty - 1 : p.m * Math.sin(2 * Math.PI * p.f1 * t)
}

/** The value the comparator actually uses at time t (sampled, held and quantised for regular sampling). */
export function comparedAt(p: ResolvedPwm, t: number): number {
  if (p.sampling === 'natural') return referenceAt(p, t)
  if (p.sampling === 'regular-asym') {
    // Sampled at every carrier peak and valley; each edge uses the sample taken just before it.
    const k = Math.floor((2 * t) / p.tc + 1e-12)
    return quantise(p, referenceAt(p, (k * p.tc) / 2))
  }
  if (p.carrier === 'sawtooth') {
    const k = Math.floor(t / p.tc + 1e-12)
    return quantise(p, referenceAt(p, k * p.tc))
  }
  // Symmetric: sampled once per carrier period, at the carrier PEAK, and held peak to peak — so both
  // edges of the pulse centred on the next valley use the same sample.
  const k = Math.floor(t / p.tc - 0.5 + 1e-12)
  return quantise(p, referenceAt(p, (k + 0.5) * p.tc))
}

function quantise(p: ResolvedPwm, r: number): number {
  if (!p.bits) return r
  const n = 2 ** p.bits
  const d = Math.round(((r + 1) / 2) * n) / n
  return 2 * d - 1
}

/** Exact comparator edges inside one steady-state period [0, P): rising = gate turns ON. */
export function pwmEdges(p: ResolvedPwm): Array<{ t: number; rising: boolean }> {
  return comparatorEdges(p.period, p.tc, p.carrier === 'triangle', (t) => carrierAt(p, t), (t) => comparedAt(p, t))
}

/**
 * Edges of g = (compared(t) > carrier(t)) over one period [0, P) made of whole carrier periods Tc.
 * The carrier is monotonic on each half (triangle) or on the whole period (sawtooth), so each piece
 * holds at most one crossing when the reference changes slower than the carrier; it is located by
 * bisection to machine precision. State changes AT a carrier-period boundary (a sawtooth reset, a new
 * sample) are edges too.
 */
export function comparatorEdges(P: number, tc: number, triangle: boolean, carrier: (t: number) => number, compared: (t: number) => number): Array<{ t: number; rising: boolean }> {
  const edges: Array<{ t: number; rising: boolean }> = []
  const nC = Math.round(P / tc)
  const g = (t: number) => compared(t) > carrier(t)
  const eps = tc * 1e-12
  for (let k = 0; k < nC; k++) {
    const t0 = k * tc
    const pieces: Array<[number, number]> = triangle ? [[t0, t0 + tc / 2], [t0 + tc / 2, t0 + tc]] : [[t0, t0 + tc]]
    const startState = g(t0 + eps)
    const prevEnd = g(t0 - eps + (k === 0 ? P : 0))
    if (startState !== prevEnd) edges.push({ t: t0, rising: startState })
    for (const [a, b] of pieces) {
      // A sample change at the half period (asymmetric regular sampling) is a boundary too.
      if (b !== t0 + tc) {
        const before = g(b - eps)
        const after = g(b + eps)
        if (before !== after) edges.push({ t: b, rising: after })
      }
      const ga = g(a + eps)
      const gb = g(b - eps)
      if (ga !== gb) {
        const t = bisectTransition(a + eps, b - eps, (x) => g(x) === gb)
        edges.push({ t, rising: gb })
      }
    }
  }
  return edges.sort((x, y) => x.t - y.t)
}

/** Gate state at t from a sorted periodic edge list. */
export function gateFromEdges(edges: Array<{ t: number; rising: boolean }>, period: number, t: number): boolean {
  if (!edges.length) return false
  const u = t - period * Math.floor(t / period)
  let lo = 0
  let hi = edges.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (edges[mid].t <= u) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found >= 0 ? edges[found].rising : edges[edges.length - 1].rising
}

/** Output voltage for a gate state. */
export const levelOf = (p: ResolvedPwm, on: boolean) => (p.output === 'bipolar' ? (on ? p.vdc / 2 : -p.vdc / 2) : on ? p.vdc : 0)

export type PwmRun = Run<ResolvedPwm> & { edges: Array<{ t: number; rising: boolean }> }

/**
 * Simulate the modulator over the shown periods. Samples are for display; the edges (events) are
 * exact. vavg is the moving average of vout over the last carrier period — the "slow" content a load
 * with a long time constant responds to — computed exactly from the edges.
 */
export function simulatePwm(input: Partial<PwmParams>): PwmRun {
  const started = performance.now()
  const { params: p, issues } = resolvePwm(input)
  const edges = pwmEdges(p)
  const n = p.periods * p.stepsPerPeriod + 1
  const time = new Float64Array(n)
  const names = ['carrier', 'ref', 'cmp', 'gate', 'gh', 'gl', 'vout', 'vavg']
  const signals: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  // Cumulative integral of vout over one period at each edge (for the exact moving average).
  const P = p.period
  const lvl0 = levelOf(p, gateFromEdges(edges, P, 0))
  const cum: Array<{ t: number; I: number; v: number }> = []
  {
    let I = 0
    let t = 0
    let v = lvl0
    for (const e of edges) {
      I += v * (e.t - t)
      t = e.t
      v = levelOf(p, e.rising)
      cum.push({ t, I, v })
    }
  }
  const total = (cum.length ? cum[cum.length - 1].I + cum[cum.length - 1].v * (P - cum[cum.length - 1].t) : lvl0 * P)
  // ∫₀ᵗ vout dt for any t (periodic extension).
  const integral = (t: number) => {
    const k = Math.floor(t / P)
    const u = t - k * P
    let lo = 0
    let hi = cum.length - 1
    let f = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid].t <= u) {
        f = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    const part = f < 0 ? lvl0 * u : cum[f].I + cum[f].v * (u - cum[f].t)
    return k * total + part
  }
  // Complementary gates with dead time: a gate turns ON td after the command enables it, OFF at once.
  const dead = (t: number, upper: boolean) => {
    const g = gateFromEdges(edges, P, t)
    if (upper !== g) return false
    return p.td === 0 || lastEdgeBefore(edges, P, t) <= t - p.td
  }
  for (let k = 0; k < n; k++) {
    const t = k * p.dt
    time[k] = t
    const tm = k === 0 ? 1e-15 : t - p.dt / 2 // the interval this sample represents
    signals.carrier[k] = carrierAt(p, t)
    signals.ref[k] = referenceAt(p, t)
    signals.cmp[k] = comparedAt(p, t)
    const g = gateFromEdges(edges, P, tm)
    signals.gate[k] = g ? 1 : 0
    signals.gh[k] = dead(tm, true) ? 1 : 0
    signals.gl[k] = dead(tm, false) ? 1 : 0
    signals.vout[k] = levelOf(p, g)
    signals.vavg[k] = (integral(t + P) - integral(t + P - p.tc)) / p.tc
  }
  const events: RunEvent[] = []
  let seq = 0
  for (let m = 0; m < p.periods; m++)
    for (const e of edges) {
      const t = m * P + e.t
      events.push({ id: `p${seq++}`, kind: e.rising ? 'gate-on' : 'gate-off', time: t, device: 'G', values: { gate: e.rising ? 1 : 0, vout: levelOf(p, e.rising), carrier: carrierAt(p, t), ref: referenceAt(p, t), cmp: comparedAt(p, t) } })
    }
  return {
    kind: 'pwm',
    params: p,
    length: n,
    time,
    signals,
    devices: [],
    events,
    edges,
    steadyFrom: 0,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

/** Time of the last edge at or before t (periodic). */
function lastEdgeBefore(edges: Array<{ t: number; rising: boolean }>, P: number, t: number): number {
  if (!edges.length) return -Infinity
  const k = Math.floor(t / P)
  const u = t - k * P
  let best = -Infinity
  for (const e of edges) if (e.t <= u) best = k * P + e.t
  if (best === -Infinity) best = (k - 1) * P + edges[edges.length - 1].t
  return best
}
