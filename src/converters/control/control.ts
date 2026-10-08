import type { Element, NetlistSolution } from '../../circuits/netlist.ts'
import { simulateCircuit, type CircuitModel } from '../engine.ts'
import { dcdcModel } from '../dcdc/model.ts'
import { periodicSchedule, type Schedule } from '../schedule.ts'
import type { RunParams } from '../types.ts'

/**
 * CONTROL — closed-loop voltage-mode control of a buck or boost converter. A digital PI controller
 * samples the output voltage at the start of every switching period and sets that period's duty
 * ratio. The converter itself is the same switching netlist as the DC-DC module; the controller is the
 * only thing that decides the gate. Test signals: a reference step and a load step (a second load
 * resistor switched in by an ideal switch).
 */
export type PlantKind = 'buck' | 'boost'

export interface ControlParams {
  kind: PlantKind
  vin: number
  /** Output voltage reference before the step [V]. */
  vref: number
  l: number
  /** Inductor winding resistance (DCR) [Ω] — the loss an open loop cannot correct. */
  rl: number
  c: number
  /** Load before the load step [Ω]. */
  r: number
  fs: number
  loop: 'closed' | 'open'
  /**
   * 'auto': PID gains from a target crossover fc and a compensator quality factor Qc (pole-zero
   * cancellation of the LC resonance); 'manual': Kp, Ki, Kd as entered.
   */
  tuning: 'auto' | 'manual'
  fcTarget: number
  qc: number
  /** PID gains: duty per volt, duty per volt-second, duty·second per volt. */
  kp: number
  ki: number
  kd: number
  dmax: number
  refStep: 'on' | 'off'
  /** Reference step size [V] and time [s]. */
  dvref: number
  tref: number
  loadStep: 'on' | 'off'
  /** Load resistance after the load step [Ω], and when [s]. */
  r2: number
  tload: number
  /** Line (input-voltage) step: size [V] and time [s]. */
  lineStep: 'on' | 'off'
  dvin: number
  tline: number
  /** Start at the operating point, or from a discharged circuit (soft start through the loop). */
  start: 'operating' | 'zero'
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedControl extends ControlParams, RunParams {
  ts: number
  dmin: number
  /** The ideal duty that gives Vref (feed-forward / initial integrator value). */
  d0: number
}

export const CONTROL_DEFAULTS: Record<PlantKind, ControlParams> = {
  buck: {
    kind: 'buck',
    vin: 24,
    vref: 12,
    l: 100e-6,
    rl: 0.05,
    c: 100e-6,
    r: 6,
    fs: 20e3,
    loop: 'closed',
    tuning: 'auto',
    fcTarget: 1000,
    qc: 1,
    kp: 0.02,
    ki: 250,
    kd: 2.5e-6,
    dmax: 0.9,
    refStep: 'on',
    dvref: 3,
    tref: 1e-3,
    loadStep: 'on',
    r2: 3,
    tload: 3.5e-3,
    lineStep: 'off',
    dvin: -4,
    tline: 4.5e-3,
    start: 'operating',
    view: 'startup',
    periods: 120,
    stepsPerPeriod: 100,
  },
  boost: {
    kind: 'boost',
    vin: 12,
    vref: 24,
    l: 100e-6,
    rl: 0.05,
    c: 100e-6,
    r: 24,
    fs: 20e3,
    loop: 'closed',
    tuning: 'auto',
    fcTarget: 100,
    qc: 1,
    kp: 0.0012,
    ki: 13,
    kd: 5e-7,
    dmax: 0.85,
    refStep: 'on',
    dvref: 4,
    tref: 2e-3,
    loadStep: 'on',
    r2: 12,
    tload: 11e-3,
    lineStep: 'off',
    dvin: -2,
    tline: 16e-3,
    start: 'operating',
    view: 'startup',
    periods: 420,
    stepsPerPeriod: 50,
  },
}

export const CONTROL_LIMITS = {
  vin: { min: 1, max: 400 },
  vref: { min: 0.5, max: 600 },
  l: { min: 5e-6, max: 5e-3 },
  rl: { min: 0, max: 2 },
  dvin: { min: -200, max: 200 },
  tline: { min: 0, max: 0.1 },
  c: { min: 5e-6, max: 5e-3 },
  r: { min: 0.5, max: 1000 },
  fs: { min: 2e3, max: 200e3 },
  kp: { min: 0, max: 1 },
  ki: { min: 0, max: 5000 },
  kd: { min: 0, max: 1e-3 },
  fcTarget: { min: 10, max: 20e3 },
  qc: { min: 0.2, max: 5 },
  dmax: { min: 0.5, max: 0.95 },
  dvref: { min: -100, max: 100 },
  tref: { min: 0, max: 0.1 },
  r2: { min: 0.5, max: 1000 },
  tload: { min: 0, max: 0.1 },
  periods: { min: 20, max: 1500 },
  stepsPerPeriod: { min: 40, max: 400 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

/** The ideal (lossless, CCM) duty for an output voltage. */
export function idealDuty(kind: PlantKind, vin: number, vout: number): number {
  return kind === 'buck' ? vout / vin : 1 - vin / vout
}

export function resolveControl(input: Partial<ControlParams>, defaults: ControlParams): { params: ResolvedControl; issues: string[] } {
  const p = { ...defaults, ...input }
  const issues: string[] = []
  const L = CONTROL_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, defaults[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const fs = c('fs')
  const ts = 1 / fs
  const periods = Math.round(c('periods'))
  const stepsPerPeriod = Math.round(c('stepsPerPeriod'))
  const vin = c('vin')
  let vref = c('vref')
  if (p.kind === 'boost' && vref <= vin * 1.05) {
    vref = vin * 1.05
    issues.push('a boost output must exceed its input — Vref raised')
  }
  if (p.kind === 'buck' && vref >= vin * 0.95) {
    vref = vin * 0.9
    issues.push('a buck output must stay below its input — Vref lowered')
  }
  const dmax = c('dmax')
  // Auto tuning (pole-zero cancellation): Gc(s) = Ki·(s²/ω0² + s/(Q·ω0) + 1)/s, the compensator zeros
  // placed exactly on the plant's LC poles (ω0, Q at the nominal load); the loop is then ≈ Ki·G0/s,
  // crossing over at fc = Ki·G0/(2π) with ~90° phase margin minus the sampling delay.
  //   buck: ω0 = 1/√(LC), G0 = Vin, Q = R·√(C/L);   boost: ω0 = D'/√(LC), G0 = Vo/D', Q = R·D'·√(C/L)
  let kp = c('kp')
  let ki = c('ki')
  let kd = c('kd')
  const fcT = c('fcTarget')
  const qc = c('qc')
  if (p.tuning === 'auto') {
    const g = autoGains(p.kind, vin, vref, c('l'), c('c'), c('r'), fcT)
    kp = g.kp
    ki = g.ki
    kd = g.kd
  }
  const params: ResolvedControl = {
    ...p,
    vin,
    vref,
    l: c('l'),
    rl: c('rl'),
    c: c('c'),
    r: c('r'),
    dvin: c('dvin'),
    tline: c('tline'),
    fs,
    kp,
    ki,
    kd,
    fcTarget: fcT,
    qc,
    dmax,
    dvref: c('dvref'),
    tref: c('tref'),
    r2: c('r2'),
    tload: c('tload'),
    periods,
    stepsPerPeriod,
    ts,
    dmin: 0.02,
    d0: Math.min(dmax, Math.max(0.02, idealDuty(p.kind, vin, vref))),
    // A transient run: the engine's start-up path with the model's initial state.
    view: 'startup',
    period: ts,
    dt: ts / stepsPerPeriod,
    duration: periods * ts,
  }
  return { params, issues }
}

/** Reference and load at time t. */
export const vrefAt = (p: ResolvedControl, t: number) => p.vref + (p.refStep === 'on' && t >= p.tref ? p.dvref : 0)
export const rAt = (p: ResolvedControl, t: number) => (p.loadStep === 'on' && t >= p.tload ? p.r2 : p.r)
/** Input voltage at time t (strictly after the line step: the step at tline uses the old value). */
export const vinAt = (p: ResolvedControl, t: number) => p.vin + (p.lineStep === 'on' && t > p.tline ? p.dvin : 0)

/** Auto-tuned PID gains (see resolveControl). */
export function autoGains(kind: PlantKind, vin: number, vo: number, l: number, c: number, r: number, fc: number) {
  const dp = kind === 'buck' ? 1 : vin / vo
  const w0 = dp / Math.sqrt(l * c)
  const g0 = kind === 'buck' ? vin : vo / dp
  // The plant's own quality factor at the nominal load: buck R·√(C/L), boost R·D'·√(C/L).
  const q = r * dp * Math.sqrt(c / l)
  const ki = (2 * Math.PI * fc) / g0
  return { ki, kp: ki / (q * w0), kd: ki / (w0 * w0), w0, g0, q }
}

export interface PiState {
  integ: number
  /** Previous error sample (derivative term). */
  prev: number | null
}
export interface PiOut {
  d: number
  e: number
  pTerm: number
  iTerm: number
  dTerm: number
  saturated: 'high' | 'low' | null
}

/**
 * The digital PID controller — ONE definition, used by the switching simulation and by the averaged-
 * model theory alike (it is the control law, not the physics):
 *   e[k] = Vref − vout[k];  u = Kp·e + I + Kd·(e[k] − e[k−1])/Ts;  d = clamp(u, Dmin, Dmax)
 *   I ← I + Ki·Ts·e   — except while saturated in the direction of e (anti-windup by clamping).
 * The derivative acts on the error, so the reference sees the full compensator (its zeros cancel the
 * LC poles for the reference path too); a reference step gives a one-period duty "kick", clamped.
 * Open loop: d = the ideal duty for the present reference (feed-forward only).
 */
export function piStep(p: ResolvedControl, s: PiState, vout: number, t: number): PiOut {
  const vr = vrefAt(p, t)
  const e = vr - vout
  if (p.loop === 'open') {
    const d = Math.min(p.dmax, Math.max(p.dmin, idealDuty(p.kind, p.vin, vr)))
    s.prev = e
    return { d, e, pTerm: 0, iTerm: d, dTerm: 0, saturated: null }
  }
  const pTerm = p.kp * e
  const dTerm = s.prev === null ? 0 : (p.kd * (e - s.prev)) / p.ts
  s.prev = e
  const u = pTerm + s.integ + dTerm
  const d = Math.min(p.dmax, Math.max(p.dmin, u))
  const saturated = u > p.dmax ? 'high' : u < p.dmin ? 'low' : null
  const iTerm = s.integ
  if (!((saturated === 'high' && e > 0) || (saturated === 'low' && e < 0))) s.integ += p.ki * p.ts * e
  return { d, e, pTerm, iTerm, dTerm, saturated }
}

/** Initial integrator: the duty that holds the starting reference. */
export const initialPi = (p: ResolvedControl): PiState => ({ integ: p.start === 'operating' ? p.d0 : p.dmin, prev: null })

/** Averaged equilibrium [iL, vC] at the starting duty d0 (including the DCR), or rest. */
export function operatingState(p: ResolvedControl): number[] {
  if (p.start === 'zero') return [0, 0]
  const d = p.d0
  if (p.kind === 'buck') {
    const v = (d * p.vin * p.r) / (p.r + p.rl)
    return [v / p.r, v]
  }
  const dp = 1 - d
  const v = p.vin / (dp + p.rl / (p.r * dp))
  return [v / (p.r * dp), v]
}

/**
 * Initial state of the SWITCHING run: the converter's own periodic steady state at the starting duty
 * (shooting method of the DC-DC model), so the run starts without an artificial LC transient.
 */
export function switchingOperatingState(p: ResolvedControl): number[] {
  if (p.start === 'zero') return [0, 0]
  const r = simulateCircuit(dcdcModel(p.kind), { vin: p.vin, duty: p.d0, l: p.l, c: p.c, r: p.r, fs: p.fs, devices: 'ideal', rl: p.rl, esr: 0, periods: 1, stepsPerPeriod: p.stepsPerPeriod, view: 'steady' })
  return [r.signals.il[0], r.signals.vc[0]]
}

/** A duty-per-period gate: rising at every period start, falling after d[m]·Ts. */
function dutySchedule(ts: number, duty: number[], total: number): Schedule {
  return {
    id: 'Q1',
    period: total,
    edges: [],
    at(t) {
      const m = Math.floor(t / ts + 1e-12)
      const d = duty[m] ?? duty[duty.length - 1] ?? 0
      return t - m * ts < d * ts
    },
    edgesIn(a, b) {
      const out: Array<{ t: number; rising: boolean }> = []
      const m0 = Math.max(0, Math.floor(a / ts) - 1)
      const m1 = Math.ceil(b / ts) + 1
      for (let m = m0; m <= m1; m++) {
        const tr = m * ts
        if (tr > a && tr <= b && m > 0) out.push({ t: tr, rising: true })
        const d = duty[m]
        if (d === undefined) continue
        const tf = tr + d * ts
        if (tf > a && tf <= b) out.push({ t: tf, rising: false })
      }
      return out.sort((x, y) => x.t - y.t)
    },
  }
}

export interface ControlTrace {
  d: number[]
  e: number[]
  pTerm: number[]
  iTerm: number[]
  dTerm: number[]
  sampled: number[]
  sat: Array<'high' | 'low' | null>
}

/** The closed-loop converter: the DC-DC netlist with the controller deciding Q1, and a switched second load. */
export function controlModel(defaults: ControlParams, trace: { current: ControlTrace | null }): CircuitModel<ControlParams, ResolvedControl> {
  return {
    kind: `control-${defaults.kind}`,
    resolve: (input) => resolveControl(input, defaults),
    startupPeriods: (p) => p.periods,
    initialState: switchingOperatingState,
    build(p) {
      const duty: number[] = []
      const tr: ControlTrace = { d: duty, e: [], pTerm: [], iTerm: [], dTerm: [], sampled: [], sat: [] }
      trace.current = tr
      const pi = initialPi(p)
      const q1 = dutySchedule(p.ts, duty, p.duration + p.ts)
      // Load step at tload: a load DROP (r2 < r) switches a resistor in parallel (R ∥ R2' = r2); a load
      // RISE (r2 > r) opens a switch in series with a parallel resistor (R ∥ Rx = r before, R = r2 after).
      const stepOn = p.loadStep === 'on' && p.r2 !== p.r
      const T = p.duration + p.ts
      const loadSched = stepOn
        ? periodicSchedule('SL', T, p.r2 < p.r ? [{ t: 0, rising: false }, { t: p.tload, rising: true }] : [{ t: 0, rising: true }, { t: p.tload, rising: false }])
        : null
      let n = 0
      const nIn = ++n
      const nSw = ++n
      const nOut = ++n
      const els: Element[] = [{ kind: 'V', id: 'Vin', a: nIn, b: 0, value: (t) => vinAt(p, t) }]
      // Inductor with its DCR in series (la → internal node → lb).
      const inductor = (la: number, lb: number) => {
        if (p.rl > 0) {
          const nx = ++n
          els.push({ kind: 'L', id: 'L', a: la, b: nx, l: p.l }, { kind: 'R', id: 'RL', a: nx, b: lb, r: p.rl })
        } else els.push({ kind: 'L', id: 'L', a: la, b: lb, l: p.l })
      }
      if (p.kind === 'buck') {
        els.push({ kind: 'S', id: 'Q1', a: nIn, b: nSw, ron: 1e-3, gate: q1.at }, { kind: 'D', id: 'D1', a: 0, b: nSw, vf: 0 })
        inductor(nSw, nOut)
      } else {
        inductor(nIn, nSw)
        els.push({ kind: 'S', id: 'Q1', a: nSw, b: 0, ron: 1e-3, gate: q1.at }, { kind: 'D', id: 'D1', a: nSw, b: nOut, vf: 0 })
      }
      // The line step is a breakpoint too (a schedule edge), so no step straddles it.
      const lineSched = p.lineStep === 'on' && p.dvin !== 0 ? periodicSchedule('LINE', p.duration + p.ts, [{ t: 0, rising: false }, { t: p.tline, rising: true }]) : null
      els.push({ kind: 'C', id: 'C', a: nOut, b: 0, c: p.c })
      if (stepOn && p.r2 > p.r) {
        const nx = ++n
        els.push({ kind: 'R', id: 'R', a: nOut, b: 0, r: p.r2 }, { kind: 'R', id: 'Rx', a: nOut, b: nx, r: (p.r * p.r2) / (p.r2 - p.r) }, { kind: 'S', id: 'SL', a: nx, b: 0, ron: 1e-6, gate: loadSched!.at })
      } else {
        els.push({ kind: 'R', id: 'R', a: nOut, b: 0, r: p.r })
        if (stepOn) {
          const nx = ++n
          els.push({ kind: 'R', id: 'R2', a: nOut, b: nx, r: (p.r * p.r2) / (p.r - p.r2) }, { kind: 'S', id: 'SL', a: nx, b: 0, ron: 1e-6, gate: loadSched!.at })
        }
      }
      const iL = els.findIndex((e) => e.id === 'L')
      const iC = els.findIndex((e) => e.id === 'C')
      const iV = els.findIndex((e) => e.id === 'Vin')
      const op = operatingState({ ...p, start: 'operating' })
      const scale = [Math.max(op[0], 1e-3), Math.max(p.vref, 1e-3)]
      const periodOf = (t: number) => Math.max(0, Math.floor((t - 1e-9 * p.dt) / p.ts))
      return {
        net: { nodes: n, elements: els },
        diode: { kind: 'real', vf: 0, ron: 1e-3 },
        schedules: [q1, ...(loadSched ? [loadSched] : []), ...(lineSched ? [lineSched] : [])],
        devices: ['Q1', 'D1'],
        dcmDiode: 'D1',
        scale,
        periodic: {
          period: p.ts,
          update(m, sol, t) {
            const vout = sol.v[nOut]
            const o = piStep(p, pi, vout, t)
            duty[m] = o.d
            tr.e[m] = o.e
            tr.pTerm[m] = o.pTerm
            tr.iTerm[m] = o.iTerm
            tr.dTerm[m] = o.dTerm
            tr.sampled[m] = vout
            tr.sat[m] = o.saturated
          },
        },
        read(sol: NetlistSolution, t: number) {
          const m = periodOf(t)
          const vout = sol.v[nOut]
          const il = sol.i[iL]
          return {
            gate: sol.switches[0].on ? 1 : 0,
            vsw: sol.v[nSw],
            il,
            vout,
            ic: sol.i[iC],
            io: vout / rAt(p, t),
            iin: -sol.i[iV],
            vin: vinAt(p, t),
            vref: vrefAt(p, t),
            duty: duty[m] ?? p.d0,
            err: tr.e[m] ?? 0,
            rload: rAt(p, t),
          }
        },
      }
    },
  }
}
