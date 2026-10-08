import { comparatorEdges } from '../pwm/modulator.ts'
import type { RunParams } from '../types.ts'

/**
 * INVERTERS — parameters and modulators. A modulator turns the user's wish (an AC voltage of amplitude
 * and frequency) into one ON/OFF COMMAND per leg (true = upper switch ON). Commands are exact edge
 * lists over one fundamental period. What the devices then do — IGBT or diode conducting, the output
 * voltage, the current — is decided by the circuit simulation.
 */
export type InverterTopology = 'half' | 'full' | 'three'
export type Modulation = 'square' | 'quasi' | 'six-step' | 'spwm-bipolar' | 'spwm-unipolar' | 'spwm' | 'svpwm'

export interface InverterParams {
  topology: InverterTopology
  modulation: Modulation
  vdc: number
  /** Fundamental (output) frequency [Hz]. */
  f1: number
  load: 'R' | 'RL'
  r: number
  l: number
  /** Quasi-square: half-width α of each zero interval [deg] (full bridge). */
  alphaDeg: number
  /** PWM: amplitude modulation index (SPWM: peak of the per-unit reference; SVPWM: |Vref|/(Vdc/2)). */
  m: number
  /** PWM: frequency ratio mf = fc/f1 (an integer: the pattern repeats every cycle). */
  mf: number
  sampling: 'natural' | 'regular-sym'
  devices: 'ideal' | 'real'
  /** Real devices: IGBT on-state voltage, diode forward voltage, common on-resistance. */
  vce: number
  vfD: number
  ron: number
  /** Dead time between the two gates of a leg [s]. */
  td: number
  view: 'steady' | 'startup'
  periods: number
  /** Time steps per fundamental cycle. */
  stepsPerPeriod: number
}

export interface ResolvedInverter extends InverterParams, RunParams {
  omega: number
  /** Device values actually simulated. */
  dev: { vce: number; vfD: number; ron: number }
  /** PWM carrier period [s] (0 for square-wave schemes). */
  tc: number
}

export const INVERTER_LIMITS = {
  vdc: { min: 1, max: 1000 },
  f1: { min: 1, max: 400 },
  r: { min: 0.5, max: 500 },
  l: { min: 0.1e-3, max: 500e-3 },
  alphaDeg: { min: 0, max: 85 },
  m: { min: 0, max: 1.5 },
  mf: { min: 3, max: 99 },
  vce: { min: 0, max: 3 },
  vfD: { min: 0, max: 3 },
  ron: { min: 1e-3, max: 1 },
  td: { min: 0, max: 100e-6 },
  periods: { min: 1, max: 6 },
  stepsPerPeriod: { min: 100, max: 20000 },
}

const IDEAL_RON = 1e-3
const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveInverter(input: Partial<InverterParams>, defaults: InverterParams): { params: ResolvedInverter; issues: string[] } {
  const p = { ...defaults, ...input }
  const issues: string[] = []
  const L = INVERTER_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, defaults[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  // A modulation must suit the topology.
  let modulation = p.modulation
  const ok: Record<InverterTopology, Modulation[]> = {
    half: ['square', 'spwm-bipolar'],
    full: ['square', 'quasi', 'spwm-bipolar', 'spwm-unipolar'],
    three: ['six-step', 'spwm', 'svpwm'],
  }
  if (!ok[p.topology].includes(modulation)) {
    modulation = ok[p.topology][0]
    issues.push(`${p.modulation} is not available for this inverter — using ${modulation}`)
  }
  const f1 = c('f1')
  const period = 1 / f1
  const mf = Math.max(3, Math.round(c('mf')))
  const pwm = modulation.startsWith('spwm') || modulation === 'svpwm'
  const stepsPerPeriod = Math.round(c('stepsPerPeriod'))
  const periods = Math.round(c('periods'))
  const ideal = p.devices === 'ideal'
  const params: ResolvedInverter = {
    ...p,
    modulation,
    vdc: c('vdc'),
    f1,
    r: c('r'),
    l: c('l'),
    alphaDeg: c('alphaDeg'),
    m: c('m'),
    mf,
    vce: c('vce'),
    vfD: c('vfD'),
    ron: c('ron'),
    td: Math.min(c('td'), pwm ? 1 / (f1 * mf) / 10 : period / 20),
    periods,
    stepsPerPeriod,
    period,
    dt: period / stepsPerPeriod,
    duration: periods * period,
    omega: 2 * Math.PI * f1,
    dev: ideal ? { vce: 0, vfD: 0, ron: IDEAL_RON } : { vce: c('vce'), vfD: c('vfD'), ron: c('ron') },
    tc: pwm ? 1 / (f1 * mf) : 0,
  }
  return { params, issues }
}

export type Edges = Array<{ t: number; rising: boolean }>

/** Per-unit references (−1 … 1) of each leg, for display and for the SPWM comparators. */
export function legReference(p: ResolvedInverter, leg: number, t: number): number {
  const th = p.omega * t
  switch (p.modulation) {
    case 'spwm-bipolar':
      return p.m * Math.sin(th) // leg B (full bridge) is the complement of leg A
    case 'spwm-unipolar':
      return leg === 0 ? p.m * Math.sin(th) : -p.m * Math.sin(th)
    case 'spwm':
      return p.m * Math.sin(th - (leg * 2 * Math.PI) / 3)
    case 'svpwm':
      return 2 * svDuty(p, leg, sampleTime(p, t)) - 1
    default:
      return 0
  }
}

/** The triangle carrier of the SPWM schemes (−1 at the start of every carrier period, +1 at its middle). */
export function invCarrier(p: ResolvedInverter, t: number): number {
  if (!p.tc) return 0
  const u = t / p.tc - Math.floor(t / p.tc)
  return u < 0.5 ? -1 + 4 * u : 3 - 4 * u
}

/** SVPWM samples the reference vector once per switching period, at the start of the period. */
export function sampleTime(p: ResolvedInverter, t: number): number {
  return Math.floor(t / p.tc + 1e-12) * p.tc
}

/**
 * Space-vector PWM. The reference vector of length |Vref| = m·Vdc/2 at angle θ lies in sector
 * k = ⌊θ/60°⌋. It is synthesised over one switching period Ts by the two adjacent active vectors and
 * the zero vectors (volt-second balance):
 *   T1 = √3·Ts·|Vref|/Vdc·sin(60° − θk),  T2 = √3·Ts·|Vref|/Vdc·sin(θk),  T0 = Ts − T1 − T2
 * with θk the angle inside the sector. Seven-segment symmetric sequence (0-1-2-7-2-1-0): each leg is ON
 * for T1·b1 + T2·b2 + T0/2, centred in the period. Overmodulation (T1 + T2 > Ts) scales T1, T2 to fill Ts.
 */
export function svDwell(p: ResolvedInverter, ts: number): { sector: number; t1: number; t2: number; t0: number; thetaK: number } {
  const Ts = p.tc
  const th = ((p.omega * ts) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  const sector = Math.min(5, Math.floor(th / (Math.PI / 3)))
  const thetaK = th - (sector * Math.PI) / 3
  const vref = (p.m * p.vdc) / 2
  let t1 = ((Math.sqrt(3) * Ts * vref) / p.vdc) * Math.sin(Math.PI / 3 - thetaK)
  let t2 = ((Math.sqrt(3) * Ts * vref) / p.vdc) * Math.sin(thetaK)
  if (t1 + t2 > Ts) {
    const k = Ts / (t1 + t2)
    t1 *= k
    t2 *= k
  }
  return { sector, t1, t2, t0: Ts - t1 - t2, thetaK }
}

/** Switching states (a, b, c) of the six active vectors V1…V6 (sector k lies between V(k+1) and V(k+2)). */
export const SV_STATES: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 1, 1],
  [0, 0, 1],
  [1, 0, 1],
]

/** SVPWM duty of a leg in the switching period that starts at ts. */
export function svDuty(p: ResolvedInverter, leg: number, ts: number): number {
  const d = svDwell(p, ts)
  const a = SV_STATES[d.sector][leg]
  const b = SV_STATES[(d.sector + 1) % 6][leg]
  return (d.t1 * a + d.t2 * b + d.t0 / 2) / p.tc
}

/** Leg ON/OFF commands over one fundamental period, per leg. */
export function legCommands(p: ResolvedInverter): Edges[] {
  const T = p.period
  const deg = (d: number) => (d / 360) * T
  switch (p.modulation) {
    case 'square':
      return p.topology === 'half'
        ? [[{ t: 0, rising: true }, { t: T / 2, rising: false }]]
        : [
            [{ t: 0, rising: true }, { t: T / 2, rising: false }],
            [{ t: 0, rising: false }, { t: T / 2, rising: true }],
          ]
    case 'quasi': {
      const a = p.alphaDeg
      // vAB = +Vdc on (α, 180° − α), 0, −Vdc on (180° + α, 360° − α), 0.
      return [
        [{ t: deg(a), rising: true }, { t: deg(180 + a), rising: false }],
        [{ t: deg(180 - a), rising: true }, { t: deg(360 - a), rising: false }],
      ]
    }
    case 'six-step':
      // 180° conduction: leg x ON for half a cycle starting at x·120°.
      return [0, 1, 2].map((x) =>
        [
          { t: deg(x * 120), rising: true },
          { t: deg((x * 120 + 180) % 360), rising: false },
        ].sort((a, b) => a.t - b.t),
      )
    case 'svpwm':
      return [0, 1, 2].map((leg) => {
        const out: Edges = []
        const n = Math.round(T / p.tc)
        for (let k = 0; k < n; k++) {
          const ts = k * p.tc
          const d = svDuty(p, leg, ts)
          if (d <= 1e-12) continue
          if (d >= 1 - 1e-12) {
            out.push({ t: ts, rising: true }, { t: ts + p.tc, rising: false })
            continue
          }
          out.push({ t: ts + (p.tc * (1 - d)) / 2, rising: true }, { t: ts + (p.tc * (1 + d)) / 2, rising: false })
        }
        return mergeEdges(out, T)
      })
    default: {
      // Sine-triangle PWM, one comparator per leg.
      const legs = p.topology === 'three' ? 3 : p.topology === 'full' && p.modulation === 'spwm-unipolar' ? 2 : 1
      const compared = (leg: number) => (t: number) => {
        if (p.sampling === 'natural') return legReference(p, leg, t)
        const k = Math.floor(t / p.tc - 0.5 + 1e-12)
        return legReference(p, leg, (k + 0.5) * p.tc)
      }
      const out: Edges[] = []
      for (let leg = 0; leg < legs; leg++) out.push(comparatorEdges(T, p.tc, true, (t) => invCarrier(p, t), compared(leg)))
      // Bipolar full bridge: leg B is the complement of leg A.
      if (p.topology === 'full' && p.modulation === 'spwm-bipolar') out.push(out[0].map((e) => ({ t: e.t, rising: !e.rising })))
      return out
    }
  }
}

/** Remove zero-width pulses and duplicate edges (consecutive equal states), keep it periodic. */
function mergeEdges(edges: Edges, T: number): Edges {
  const s = edges.map((e) => ({ t: ((e.t % T) + T) % T, rising: e.rising })).sort((a, b) => a.t - b.t)
  const out: Edges = []
  for (const e of s) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.t - e.t) < T * 1e-12 && last.rising !== e.rising) out.pop()
    else if (last && last.rising === e.rising) continue
    else out.push(e)
  }
  // the first and last edge must alternate across the period boundary
  if (out.length > 1 && out[0].rising === out[out.length - 1].rising) out.pop()
  return out
}

/** Command state of a leg at time t (edges in any order). */
export function commandAt(edges: Edges, T: number, t: number): boolean {
  if (!edges.length) return false
  const u = t - T * Math.floor(t / T)
  // the last edge at or before u; if none, the last edge of the previous period
  let best: { t: number; rising: boolean } | null = null
  let latest: { t: number; rising: boolean } = edges[0]
  for (const e of edges) {
    if (e.t <= u && (!best || e.t >= best.t)) best = e
    if (e.t >= latest.t) latest = e
  }
  return (best ?? latest).rising
}
