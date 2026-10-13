import { fourier, type Segment } from '../fourier.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'
import { comparatorEdges, gateFromEdges } from './modulator.ts'

/**
 * PWM LAB — UNIFORM MULTIPLE-PULSE MODULATION (UPWM), simulated. A square-wave reference of amplitude M
 * (±M, one polarity per half cycle) is compared with a triangular carrier that runs at fc = 2p·f1, so each
 * half cycle holds exactly p carrier periods. The carrier rises from 0 to 1 and back (1 at the start of each
 * carrier period, 0 in its middle) and is drawn mirrored in the negative half; the comparator output is
 *
 *   g = (|r| > |c|) = (M > c(t))
 *
 * and a steering stage sends g to the full-bridge leg of the present half cycle:
 *
 *   positive half:  leg A = g (S1 ON while g, else S2),  leg B on the lower rail (S4)   → vAB = +Vdc or 0
 *   negative half:  leg B = g (S3 ON while g, else S4),  leg A on the lower rail (S2)   → vAB = −Vdc or 0
 *
 * Every comparator edge is the exact instant where M = c(t), located by bisection on each monotonic half of
 * the carrier (the PWM lab's comparator); nothing is drawn from a pulse-width formula. The output is a train
 * of ±Vdc pulses; its spectrum is computed by exact Fourier integrals of the simulated pulses.
 */
export interface MultiPulseParams {
  /** Pulses per half cycle p (carrier periods per half cycle). */
  p: number
  /** Modulation index M = Ar/Ac (reference amplitude over carrier peak). */
  m: number
  vdc: number
  /** Output (fundamental) frequency [Hz]. */
  f1: number
  view: 'steady' | 'startup'
  /** Fundamental cycles shown. */
  periods: number
  /** Display samples per CARRIER period (edges are exact at any resolution). */
  stepsPerPeriod: number
}

export interface ResolvedMultiPulse extends MultiPulseParams, RunParams {
  /** Carrier period Tc = T/(2p) [s] and frequency fc = 2p·f1. */
  tc: number
  fc: number
  /** Display samples per carrier period (the user's setting; `stepsPerPeriod` is per fundamental cycle). */
  sppCarrier: number
}

export const MULTI_DEFAULTS: MultiPulseParams = { p: 5, m: 0.5, vdc: 100, f1: 50, view: 'steady', periods: 1, stepsPerPeriod: 120 }

export const MULTI_LIMITS = {
  p: { min: 1, max: 15 },
  m: { min: 0.05, max: 1 },
  vdc: { min: 1, max: 1000 },
  f1: { min: 1, max: 400 },
  periods: { min: 1, max: 4 },
  stepsPerPeriod: { min: 40, max: 600 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveMultiPulse(input: Partial<MultiPulseParams>): { params: ResolvedMultiPulse; issues: string[] } {
  const q = { ...MULTI_DEFAULTS, ...input }
  const issues: string[] = []
  const c = (k: keyof typeof MULTI_LIMITS) => {
    const raw = q[k] as number
    const v = clamp(raw, MULTI_LIMITS[k].min, MULTI_LIMITS[k].max, MULTI_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const p = Math.round(c('p'))
  const f1 = c('f1')
  const period = 1 / f1
  const tc = period / (2 * p)
  const spp = Math.round(c('stepsPerPeriod'))
  const periods = Math.round(c('periods'))
  const stepsPerPeriod = spp * 2 * p
  return {
    params: {
      ...q,
      p,
      m: c('m'),
      vdc: c('vdc'),
      f1,
      tc,
      fc: 1 / tc,
      sppCarrier: spp,
      period,
      periods,
      stepsPerPeriod,
      dt: period / stepsPerPeriod,
      duration: periods * period,
      view: 'steady',
    },
    issues,
  }
}

/** The carrier magnitude at t: 1 at the start of each carrier period, 0 in its middle (a 0…1 triangle). */
export function carrierMag(p: ResolvedMultiPulse, t: number): number {
  const u = t / p.tc - Math.floor(t / p.tc)
  return Math.abs(1 - 2 * u)
}

/** Polarity of the half cycle containing t: +1 (first half), −1 (second half). */
export function halfSign(p: ResolvedMultiPulse, t: number): 1 | -1 {
  const u = t / p.period - Math.floor(t / p.period)
  return u < 0.5 ? 1 : -1
}

/** The comparator's exact edges over one fundamental period [0, T): rising = g turns HIGH (M rises above c). */
export function multiPulseEdges(p: ResolvedMultiPulse): Array<{ t: number; rising: boolean }> {
  // M = 1: the carrier (≤ 1) never rises above |r| except at isolated instants (its peaks) — no edges; the
  // comparator stays HIGH and the pulses merge into one block per half cycle.
  if (p.m >= 1) return []
  return comparatorEdges(p.period, p.tc, true, (t) => carrierMag(p, t), () => p.m)
}

/**
 * The bridge output over one period as piecewise-constant segments: the comparator edges and the half-cycle
 * boundaries are the breakpoints; the level of each interval is the steered comparator state there.
 */
export function outputSegments(p: ResolvedMultiPulse, edges: Array<{ t: number; rising: boolean }>): Segment[] {
  const T = p.period
  const pts = [0, T / 2, T, ...edges.map((e) => e.t)].sort((a, b) => a - b)
  const uniq: number[] = []
  for (const t of pts) if (!uniq.length || t - uniq[uniq.length - 1] > T * 1e-14) uniq.push(t)
  const segs: Segment[] = []
  for (let i = 0; i + 1 < uniq.length; i++) {
    const ta = uniq[i]
    const tb = uniq[i + 1]
    const tm = (ta + tb) / 2
    const g = edges.length ? gateFromEdges(edges, T, tm) : p.m >= 1 || p.m > carrierMag(p, tm)
    const v = g ? halfSign(p, tm) * p.vdc : 0
    const last = segs[segs.length - 1]
    if (last && last.va === v) last.tb = tb
    else segs.push({ ta, tb, va: v, vb: v })
  }
  return segs
}

export type MultiPulseRun = Run<ResolvedMultiPulse> & {
  /** Comparator edges over one period. */
  edges: Array<{ t: number; rising: boolean }>
  /** The simulated output vAB over one period (exact pulses). */
  segs: Segment[]
}

/** Comparator state at t (also when it never switches: M = 1 keeps it HIGH). */
function gAt(p: ResolvedMultiPulse, edges: Array<{ t: number; rising: boolean }>, t: number): boolean {
  return edges.length ? gateFromEdges(edges, p.period, t) : p.m >= 1 || p.m > carrierMag(p, t)
}

export function simulateMultiPulse(input: Partial<MultiPulseParams>): MultiPulseRun {
  const started = performance.now()
  const { params: p, issues } = resolveMultiPulse(input)
  const edges = multiPulseEdges(p)
  const segs = outputSegments(p, edges)
  const T = p.period
  // The fundamental of the simulated pulse train (exact Fourier integral) — shown beside the pulses.
  const h1 = fourier(segs, T, 1)[1]
  // ∫₀ᵗ vAB for the exact moving average over one carrier period.
  const cum: number[] = [0]
  for (const s of segs) cum.push(cum[cum.length - 1] + s.va * (s.tb - s.ta))
  const total = cum[cum.length - 1]
  const integral = (t: number) => {
    const k = Math.floor(t / T)
    const u = t - k * T
    let lo = 0
    let hi = segs.length - 1
    let f = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segs[mid].ta <= u) {
        f = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return k * total + cum[f] + segs[f].va * (u - segs[f].ta)
  }
  const n = p.periods * p.stepsPerPeriod + 1
  const time = new Float64Array(n)
  const names = ['carrier', 'ref', 'gate', 'gA', 'gB', 'vout', 'v1', 'vavg']
  const signals: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  const w = 2 * Math.PI * p.f1
  for (let k = 0; k < n; k++) {
    const t = k * p.dt
    time[k] = t
    const tm = k === 0 ? 1e-15 * T : t - p.dt / 2 // the interval this sample represents
    const s = halfSign(p, tm)
    const g = gAt(p, edges, tm)
    signals.carrier[k] = s * carrierMag(p, t)
    signals.ref[k] = s * p.m
    signals.gate[k] = g ? 1 : 0
    signals.gA[k] = g && s > 0 ? 1 : 0
    signals.gB[k] = g && s < 0 ? 1 : 0
    signals.vout[k] = g ? s * p.vdc : 0
    signals.v1[k] = h1.amp * Math.cos(w * t + h1.phase)
    signals.vavg[k] = (integral(t + T) - integral(t + T - p.tc)) / p.tc
  }
  const events: RunEvent[] = []
  let seq = 0
  for (let c = 0; c < p.periods; c++) {
    for (const half of [0, 0.5]) {
      const t = c * T + half * T
      const s = half === 0 ? 1 : -1
      events.push({ id: `m${seq++}`, kind: 'mode', time: t, device: 'polarity', values: { sign: s, vout: gAt(p, edges, t + 1e-12 * T) ? s * p.vdc : 0, ref: s * p.m } })
    }
    for (const e of edges) {
      const t = c * T + e.t
      const s = halfSign(p, t + 1e-12 * T)
      events.push({ id: `m${seq++}`, kind: e.rising ? 'gate-on' : 'gate-off', time: t, device: s > 0 ? 'A' : 'B', values: { gate: e.rising ? 1 : 0, vout: e.rising ? s * p.vdc : 0, carrier: carrierMag(p, t), ref: p.m, sign: s } })
    }
  }
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'pwm-multi',
    params: p,
    length: n,
    time,
    signals,
    devices: [],
    events,
    edges,
    segs,
    steadyFrom: 0,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}
