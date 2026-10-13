import type { Mat } from '../expm.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * BLDC DRIVE — a three-phase inverter and a permanent-magnet machine with TRAPEZOIDAL back-EMF, commutated in
 * six steps by three Hall sensors.
 *
 *   Vdc ─┬─ S1 S3 S5 ─┐ legs a, b, c (switch + antiparallel diode per position)
 *        └─ S4 S6 S2 ─┘ phase x: L·dix/dt = vx − vn − R·ix − ex,   ex = ke·ω·f(θe − 120°·k)
 *   star connection: ia + ib + ic = 0, vn = the floating neutral
 *   shaft: J·dω/dt = Te − B·ω − TL,  Te = ke·Σ f(θx)·ix,  dθe/dt = p·ω
 *
 * f is a trapezoid of amplitude 1 with 120° (electrical) flat tops and 60° linear ramps, ke the phase back-EMF
 * constant [V·s/rad] (the flat-top phase EMF is ke·ω, the line-to-line EMF of two conducting phases 2·ke·ω).
 *
 * Six-step commutation: the Hall sector (60° wide, edges at 30° + k·60°) selects ONE upper and ONE lower switch,
 * so two phases conduct for 120° each, inside their flat tops. Speed control: the upper switch is chopped by PWM
 * at duty d (H_PWM–L_ON), so the conducting pair sees d·Vdc on average. 'none' = six-step at the full Vdc.
 *
 * A leg with both switches off is decided by its diodes: positive current (into the motor) flows through the
 * lower diode (vx = 0), negative through the upper one (vx = Vdc), zero current leaves it open (vx = vn + ex)
 * until that voltage leaves [0, Vdc]. That is what makes the commutation take time: the outgoing phase's current
 * decays through a diode while the incoming one builds up — the commutation torque ripple.
 *
 * SIMULATION: classical Runge–Kutta (RK4) with a fixed step much smaller than L/R and the PWM period; every PWM
 * edge and load step is a step boundary, every Hall edge, diode turn-off (current zero) and diode turn-on is
 * located by bisection on the RK4 flow and the step restarted there. Energies and means are integrated as extra
 * states, so window means are exact up to the integrator.
 */
export type BldcChop = 'pwm' | 'none'
export type BldcEvent = 'none' | 'load' | 'duty'

export interface BldcParams {
  vdc: number
  chop: BldcChop
  /** PWM duty of the upper switch (chop = 'pwm'). */
  duty: number
  fs: number
  /** Phase resistance [Ω]. */
  r: number
  /** Phase inductance [H] (self minus mutual, as seen by the star-connected phase). */
  l: number
  /** Phase back-EMF constant [V·s/rad]: flat-top phase EMF = ke·ω; torque of a conducting pair = 2·ke·I. */
  ke: number
  /** Pole pairs. */
  pp: number
  j: number
  b: number
  tl: number
  event: BldcEvent
  tl2: number
  d2: number
  /** Rotor angle at rest [electrical degrees]. */
  theta0: number
  /** Samples per PWM period (0 = automatic). */
  stepsPerPeriod: number
  /** Simulated PWM periods (0 = automatic: settled). */
  periods: number
}

export interface ResolvedBldc extends BldcParams, RunParams {
  tauE: number
  tauM: number
  sigma: number
  tstep: number | null
  /** Duty of every PWM period (1 for six-step). */
  duties: number[]
  /** RK4 sub-steps per sample. */
  sub: number
}

export const BLDC_DEFAULTS: BldcParams = {
  vdc: 24,
  chop: 'pwm',
  duty: 0.8,
  fs: 20e3,
  r: 0.5,
  l: 0.5e-3,
  ke: 0.03,
  pp: 4,
  j: 2e-5,
  b: 1e-5,
  tl: 0.1,
  event: 'none',
  tl2: 0.2,
  d2: 0.5,
  theta0: 60,
  stepsPerPeriod: 0,
  periods: 0,
}

export const BLDC_LIMITS = {
  vdc: { min: 5, max: 600 },
  duty: { min: 0.05, max: 1 },
  fs: { min: 2e3, max: 50e3 },
  r: { min: 0.01, max: 20 },
  l: { min: 20e-6, max: 50e-3 },
  ke: { min: 0.002, max: 2 },
  pp: { min: 1, max: 12 },
  j: { min: 1e-7, max: 0.05 },
  b: { min: 0, max: 0.05 },
  tl: { min: 0, max: 20 },
  tl2: { min: 0, max: 20 },
  d2: { min: 0.05, max: 1 },
  theta0: { min: 0, max: 359 },
}

const MAX_PERIODS = 6000
const SAMPLE_BUDGET = 40000

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
const DEG = Math.PI / 180

/** Trapezoid of amplitude 1, 120° flat tops: +1 on [30°, 150°], −1 on [210°, 330°], linear ramps between. */
export function trap(th: number): number {
  let u = (th / DEG) % 360
  if (u < 0) u += 360
  if (u < 30) return u / 30
  if (u <= 150) return 1
  if (u < 210) return (180 - u) / 30
  if (u <= 330) return -1
  return (u - 360) / 30
}
/** Slope df/dθ [1/rad] of the trapezoid (right derivative). */
export function trapSlope(th: number): number {
  let u = (th / DEG) % 360
  if (u < 0) u += 360
  if (u < 30 || u >= 330) return 1 / (30 * DEG)
  if (u >= 150 && u < 210) return -1 / (30 * DEG)
  return 0
}
/** Phase shifts: phase b lags a by 120°, c by 240°. */
export const SHIFT = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
export const PHASES = ['a', 'b', 'c'] as const

/**
 * The six Hall sectors (edges at 30° + k·60°): the phase whose UPPER switch conducts and the phase whose LOWER
 * switch conducts. Sector 0 = [30°, 90°).
 */
export const SECTORS: Array<{ hi: number; lo: number; off: number; hall: [number, number, number] }> = [
  { hi: 0, lo: 1, off: 2, hall: [1, 0, 1] },
  { hi: 0, lo: 2, off: 1, hall: [1, 0, 0] },
  { hi: 1, lo: 2, off: 0, hall: [1, 1, 0] },
  { hi: 1, lo: 0, off: 2, hall: [0, 1, 0] },
  { hi: 2, lo: 0, off: 1, hall: [0, 1, 1] },
  { hi: 2, lo: 1, off: 0, hall: [0, 0, 1] },
]
/** Unwrapped sector index of an electrical angle (sector k spans [30° + k·60°, 90° + k·60°)). */
export const sectorIndex = (th: number) => Math.floor((th - 30 * DEG) / (60 * DEG) + 1e-12)
export const sectorOf = (idx: number) => ((idx % 6) + 6) % 6
/** Entering sectors 0, 2, 4 changes the UPPER switch (upper commutation); 1, 3, 5 the lower one. */
export const isUpperCommutation = (sector: number) => sector % 2 === 0

/** Averaged (two conducting phases, flat back-EMF) model as a DC machine: x = [I, ω]. */
export function averagedMatrix(p: Pick<BldcParams, 'r' | 'l' | 'ke' | 'j' | 'b'>): Mat {
  return [
    [-p.r / p.l, -p.ke / p.l],
    [(2 * p.ke) / p.j, -p.b / p.j],
  ]
}
export function slowestRate(p: Pick<BldcParams, 'r' | 'l' | 'ke' | 'j' | 'b'>): number {
  const A = averagedMatrix(p)
  const tr = A[0][0] + A[1][1]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
  const disc = (tr * tr) / 4 - det
  return disc >= 0 ? -(tr / 2 + Math.sqrt(disc)) : -tr / 2
}

/**
 * TEXTBOOK steady state: two phases in series carry I, the line-to-line back-EMF is 2·ke·ω, the pair sees d·Vdc:
 *   d·Vdc = 2·ke·ω + 2·R·I,   2·ke·I = TL + B·ω   ⇒   ω = (d·Vdc − R·TL/ke)/(2·ke + R·B/ke)
 * (commutation intervals ignored).
 */
export function averagedSteady(p: Pick<BldcParams, 'r' | 'ke' | 'b' | 'vdc'>, d: number, tl: number): { w: number; i: number } {
  const w = (d * p.vdc - (p.r * tl) / p.ke) / (2 * p.ke + (p.r * p.b) / p.ke)
  return { w, i: (tl + p.b * w) / (2 * p.ke) }
}

export function resolveBldc(input: Partial<BldcParams>): { params: ResolvedBldc; issues: string[] } {
  const p = { ...BLDC_DEFAULTS, ...input }
  const issues: string[] = []
  const L = BLDC_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, BLDC_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    vdc: c('vdc'),
    duty: c('duty'),
    fs: c('fs'),
    r: c('r'),
    l: c('l'),
    ke: c('ke'),
    pp: Math.round(c('pp')),
    j: c('j'),
    b: c('b'),
    tl: c('tl'),
    tl2: c('tl2'),
    d2: c('d2'),
    theta0: c('theta0'),
  }
  const chop: BldcChop = p.chop === 'none' ? 'none' : 'pwm'
  const event: BldcEvent = p.event === 'load' || (p.event === 'duty' && chop === 'pwm') ? p.event : 'none'
  const ts = 1 / q.fs
  const sigma = slowestRate(q)
  const settle = 12 / sigma
  const dEnd = chop === 'none' ? 1 : event === 'duty' ? q.d2 : q.duty
  const tlEnd = event === 'load' ? q.tl2 : q.tl
  const wEnd = averagedSteady(q, dEnd, tlEnd).w
  const wStart = averagedSteady(q, chop === 'none' ? 1 : q.duty, q.tl).w
  // whole electrical cycles to measure at the end (and before the step)
  const cycle = (w: number) => (w > 0 ? (2 * Math.PI) / (q.pp * w) : 0)
  let t1 = settle + 3 * cycle(wStart)
  let tstep: number | null = null
  if (event !== 'none') {
    tstep = Math.ceil(t1 / ts) * ts
    t1 = tstep + settle + 3 * cycle(wEnd)
  }
  let periods = Math.ceil(t1 / ts)
  if (p.periods > 0) {
    periods = Math.round(p.periods)
    if (tstep !== null) tstep = Math.round(periods / 2) * ts
  }
  if (periods > MAX_PERIODS) {
    issues.push(`the drive settles slowly compared with the PWM period: the window is limited to ${MAX_PERIODS} periods`)
    periods = MAX_PERIODS
    if (tstep !== null) tstep = Math.round(periods / 2) * ts
  }
  const spp = p.stepsPerPeriod > 0 ? Math.max(4, Math.round(p.stepsPerPeriod)) : Math.max(10, Math.min(64, Math.round(SAMPLE_BUDGET / periods)))
  const dt = ts / spp
  // RK4 step: small against L/R and the electrical sector at the highest averaged speed
  const wMax = Math.max(averagedSteady(q, chop === 'none' ? 1 : Math.max(q.duty, event === 'duty' ? q.d2 : 0), 0).w, 1)
  const hMax = Math.min(q.l / q.r / 30, (Math.PI / 3 / (q.pp * wMax)) / 60)
  const sub = Math.max(1, Math.ceil(dt / hMax))
  const duties: number[] = []
  for (let m = 0; m < periods; m++) duties.push(chop === 'none' ? 1 : event === 'duty' && tstep !== null && m * ts >= tstep - 1e-9 * ts ? q.d2 : q.duty)
  const params: ResolvedBldc = {
    ...p,
    ...q,
    chop,
    event,
    periods,
    stepsPerPeriod: spp,
    period: ts,
    dt,
    duration: periods * ts,
    view: 'startup',
    tauE: q.l / q.r,
    tauM: (q.j * q.r) / (2 * q.ke * q.ke),
    sigma,
    tstep,
    duties,
    sub,
  }
  return { params, issues }
}

export const periodOf = (p: ResolvedBldc, t: number) => Math.min(p.periods - 1, Math.max(0, Math.floor(t / p.period + 1e-9)))
/** PWM gate of the upper switch over the interval starting at t (an edge exactly at t takes the new value). */
export function gateAt(p: ResolvedBldc, t: number): boolean {
  const m = periodOf(p, t)
  const d = p.duties[m]
  if (d >= 1) return true
  return t - m * p.period < d * p.period - 1e-9 * p.period
}
export const loadAt = (p: ResolvedBldc, t: number) => (p.event === 'load' && p.tstep !== null && t >= p.tstep - 1e-9 * p.period ? p.tl2 : p.tl)

/** Electromagnetic torque of a state: Te = ke·Σ f(θx)·ix. */
export function torqueOf(p: Pick<BldcParams, 'ke'>, y: ArrayLike<number>): number {
  const th = y[4]
  return p.ke * (trap(th) * y[0] + trap(th - SHIFT[1]) * y[1] + trap(th - SHIFT[2]) * y[2])
}

/** Leg states: 'H' upper switch gated, 'L' lower switch gated, 'O' both off (diodes decide). */
export type Leg = 'H' | 'L' | 'O'
/** Diode conduction of an 'O' leg: +1 lower diode (i > 0, v = 0), −1 upper diode (i < 0, v = Vdc), 0 open. */
export type Cond = -1 | 0 | 1

/** State vector layout. */
export const IA = 0
export const IB = 1
export const IC = 2
export const W = 3
export const TH = 4
/** Integrals: DC energy, copper loss, ∫ω, ∫Te, friction loss, load energy, ∫|ia|, ∫ia². */
export const QE = 5
export const QCU = 6
export const QW = 7
export const QT = 8
export const QFR = 9
export const QLD = 10
export const QABS = 11
export const QSQ = 12
const NY = 13

export interface Topo {
  sIdx: number
  gate: boolean
  legs: [Leg, Leg, Leg]
  cond: [Cond, Cond, Cond]
}

export function legsOf(sector: number, gate: boolean): [Leg, Leg, Leg] {
  const s = SECTORS[sector]
  const legs: [Leg, Leg, Leg] = ['O', 'O', 'O']
  legs[s.hi] = gate ? 'H' : 'O'
  legs[s.lo] = 'L'
  return legs
}

// scratch of the hot path (no allocation per derivative evaluation)
const sF = new Float64Array(3)
const sE = new Float64Array(3)
const sV = new Float64Array(3)
const sC = new Uint8Array(3)
let sVn = 0

/** Fills the scratch: back-EMF shapes, EMFs, terminal voltages, conducting flags; returns the conducting count. */
function elec(p: ResolvedBldc, y: ArrayLike<number>, topo: Topo): number {
  const w = y[W]
  const th = y[TH]
  let nConn = 0
  for (let x = 0; x < 3; x++) {
    const f = trap(th - SHIFT[x])
    sF[x] = f
    sE[x] = p.ke * w * f
    const leg = topo.legs[x]
    sV[x] = leg === 'H' ? p.vdc : leg === 'L' ? 0 : topo.cond[x] === -1 ? p.vdc : 0
    const c = leg !== 'O' || topo.cond[x] !== 0
    sC[x] = c ? 1 : 0
    if (c) nConn++
  }
  let vn: number
  if (nConn === 3) vn = (sV[0] + sV[1] + sV[2] - sE[0] - sE[1] - sE[2]) / 3
  else if (nConn === 2) {
    let sv = 0
    let se = 0
    for (let x = 0; x < 3; x++)
      if (sC[x]) {
        sv += sV[x]
        se += sE[x]
      }
    vn = (sv - se) / 2
  } else if (nConn === 1) {
    vn = 0
    for (let x = 0; x < 3; x++) if (sC[x]) vn = sV[x] - sE[x]
  } else vn = (p.vdc - sE[0] - sE[1] - sE[2]) / 3
  // an open phase floats at vn + e
  for (let x = 0; x < 3; x++) if (!sC[x]) sV[x] = vn + sE[x]
  sVn = vn
  return nConn
}

/** Terminal voltages (to DC−), neutral voltage and back-EMFs for a state and a topology. */
export function electrical(p: ResolvedBldc, y: ArrayLike<number>, topo: Topo) {
  const nConn = elec(p, y, topo)
  return { f: Array.from(sF), e: Array.from(sE), v: Array.from(sV), vn: sVn, conn: Array.from(sC, (c) => c === 1), nConn }
}

function deriv(p: ResolvedBldc, y: Float64Array, topo: Topo, tl: number, out: Float64Array) {
  const nConn = elec(p, y, topo)
  const ia = y[IA]
  const ib = y[IB]
  const ic = y[IC]
  let d0 = 0
  let d1 = 0
  let d2 = 0
  if (nConn >= 2) {
    const k = 1 / p.l
    if (sC[0]) d0 = (sV[0] - sVn - p.r * ia - sE[0]) * k
    if (sC[1]) d1 = (sV[1] - sVn - p.r * ib - sE[1]) * k
    if (sC[2]) d2 = (sV[2] - sVn - p.r * ic - sE[2]) * k
    if (nConn === 2) {
      // keep the pair exactly opposite: Σi = 0
      if (!sC[0]) {
        const m = 0.5 * (d1 - d2)
        d1 = m
        d2 = -m
      } else if (!sC[1]) {
        const m = 0.5 * (d0 - d2)
        d0 = m
        d2 = -m
      } else {
        const m = 0.5 * (d0 - d1)
        d0 = m
        d1 = -m
      }
    }
  }
  const w = y[W]
  const te = p.ke * (sF[0] * ia + sF[1] * ib + sF[2] * ic)
  out[IA] = d0
  out[IB] = d1
  out[IC] = d2
  out[W] = (te - p.b * w - tl) / p.j
  out[TH] = p.pp * w
  out[QE] = sV[0] * ia + sV[1] * ib + sV[2] * ic
  out[QCU] = p.r * (ia * ia + ib * ib + ic * ic)
  out[QW] = w
  out[QT] = te
  out[QFR] = p.b * w * w
  out[QLD] = tl * w
  out[QABS] = Math.abs(ia)
  out[QSQ] = ia * ia
}

/** One classical RK4 step of length h (topology and load fixed). */
function rk4(p: ResolvedBldc, y: Float64Array, topo: Topo, tl: number, h: number, ws: Float64Array[], out: Float64Array): Float64Array {
  const [k1, k2, k3, k4, tmp] = ws
  deriv(p, y, topo, tl, k1)
  for (let i = 0; i < NY; i++) tmp[i] = y[i] + 0.5 * h * k1[i]
  deriv(p, tmp, topo, tl, k2)
  for (let i = 0; i < NY; i++) tmp[i] = y[i] + 0.5 * h * k2[i]
  deriv(p, tmp, topo, tl, k3)
  for (let i = 0; i < NY; i++) tmp[i] = y[i] + h * k3[i]
  deriv(p, tmp, topo, tl, k4)
  for (let i = 0; i < NY; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  return out
}

/** Event functions (an event fires when g ≥ 0). */
interface EvFn {
  kind: 'hall+' | 'hall-' | 'doff' | 'don+' | 'don-'
  x: number
  g: (y: Float64Array) => number
}
function eventFns(p: ResolvedBldc, topo: Topo): EvFn[] {
  const out: EvFn[] = []
  const lo = 30 * DEG + topo.sIdx * 60 * DEG
  const hi = lo + 60 * DEG
  out.push({ kind: 'hall+', x: -1, g: (y) => y[TH] - hi })
  out.push({ kind: 'hall-', x: -1, g: (y) => lo - y[TH] - 1e-12 })
  for (let x = 0; x < 3; x++) {
    if (topo.legs[x] !== 'O') continue
    const c = topo.cond[x]
    if (c !== 0) out.push({ kind: 'doff', x, g: (y) => -c * y[IA + x] })
    else {
      out.push({ kind: 'don-', x, g: (y) => (elec(p, y, topo), sV[x] - p.vdc) })
      out.push({ kind: 'don+', x, g: (y) => (elec(p, y, topo), -sV[x]) })
    }
  }
  return out
}

/** Make the diode states consistent with the currents and voltages (after any topology change). */
function settleTopo(p: ResolvedBldc, y: Float64Array, topo: Topo) {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (let x = 0; x < 3; x++) {
      if (topo.legs[x] !== 'O') continue
      const i = y[IA + x]
      // a conducting diode whose current has reversed blocks (a current exactly zero has just started)
      if (topo.cond[x] !== 0 && i * topo.cond[x] < 0) {
        topo.cond[x] = 0
        y[IA + x] = 0
        changed = true
      } else if (topo.cond[x] === 0 && i !== 0) {
        topo.cond[x] = i > 0 ? 1 : -1
        changed = true
      }
    }
    // Σi = 0 among the conducting phases
    fixSum(y, topo)
    for (let x = 0; x < 3; x++) {
      if (topo.legs[x] !== 'O' || topo.cond[x] !== 0) continue
      elec(p, y, topo)
      const v = sV[x]
      if (v > p.vdc * (1 + 1e-12)) {
        topo.cond[x] = -1
        changed = true
        break
      }
      if (v < -p.vdc * 1e-12) {
        topo.cond[x] = 1
        changed = true
        break
      }
    }
    if (!changed) break
  }
}
function fixSum(y: Float64Array, topo: Topo) {
  const conn: number[] = []
  for (let x = 0; x < 3; x++) if (topo.legs[x] !== 'O' || topo.cond[x] !== 0) conn.push(x)
  for (let x = 0; x < 3; x++) if (!conn.includes(x)) y[IA + x] = 0
  if (conn.length === 3) {
    const s = (y[IA] + y[IB] + y[IC]) / 3
    y[IA] -= s
    y[IB] -= s
    y[IC] -= s
  } else if (conn.length === 2) {
    const m = 0.5 * (y[IA + conn[0]] - y[IA + conn[1]])
    y[IA + conn[0]] = m
    y[IA + conn[1]] = -m
  } else for (const x of conn) y[IA + x] = 0
}

export interface BldcKnot {
  t: number
  x: number[]
  /** what happened: 'pwm', 'hall', 'doff', 'don', 'step' */
  what: string
}
export interface HallSnap {
  t: number
  y: number[]
  /** sector entered */
  sector: number
  /** +1 forward, −1 backward */
  dir: number
}
/** A commutation: Hall edge → the outgoing phase's current reaches zero (located). */
export interface Commutation {
  tHall: number
  tEnd: number | null
  sector: number
  upper: boolean
  /** outgoing phase index */
  out: number
  /** its current at the Hall edge */
  i0: number
  /** Torque at the Hall edge and when the outgoing current reaches zero (the commutation's torque step). */
  te0: number
  te1: number | null
}

export type BldcRun = Run<ResolvedBldc> & {
  knots: BldcKnot[]
  halls: HallSnap[]
  comms: Commutation[]
  /** sector, conducting-phase count, leg states per sample (for the state at the cursor). */
  sector: Uint8Array
  nconn: Uint8Array
  legs: string[]
  /** Cumulative integrals at every sample (index QE…QSQ). */
  q: Float64Array[]
}

/** SIMULATION — one start-up run from rest, re-run over a longer window if it has not settled. */
export function simulateBldc(input: Partial<BldcParams>): BldcRun {
  const started = performance.now()
  let r = simulateOnce(input)
  if (!r.diagnostics.steady.converged && r.params.periods * 2 <= MAX_PERIODS && !(input.periods! > 0)) r = simulateOnce({ ...input, periods: r.params.periods * 2 })
  r.diagnostics.computeMs = performance.now() - started
  return r
}

function simulateOnce(input: Partial<BldcParams>): BldcRun {
  const started = performance.now()
  const { params: p, issues } = resolveBldc(input)
  const n = p.periods * p.stepsPerPeriod + 1
  const names = ['ia', 'ib', 'ic', 'ea', 'eb', 'ec', 'va', 'vb', 'vc', 'vn', 'vab', 'te', 'tav', 'tl', 'w', 'n', 'theta', 'ha', 'hb', 'hc', 'gate', 'idc', 'pin', 'duty']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  const q = Array.from({ length: NY }, () => new Float64Array(n))
  const sectorArr = new Uint8Array(n)
  const nconnArr = new Uint8Array(n)
  const legsArr: string[] = new Array(n)
  const time = new Float64Array(n)
  const knots: BldcKnot[] = []
  const halls: HallSnap[] = []
  const comms: Commutation[] = []
  const events: RunEvent[] = []
  const ws = Array.from({ length: 5 }, () => new Float64Array(NY))

  let y = new Float64Array(NY)
  y[TH] = p.theta0 * DEG
  const topo: Topo = { sIdx: sectorIndex(y[TH]), gate: gateAt(p, 0), legs: ['O', 'O', 'O'], cond: [0, 0, 0] }
  topo.legs = legsOf(sectorOf(topo.sIdx), topo.gate)
  settleTopo(p, y, topo)
  let pendingComm: Commutation | null = null

  const store = (k: number, t: number) => {
    time[k] = t
    const nConn = elec(p, y, topo)
    const el = { e: sE, v: sV, vn: sVn, f: sF, nConn }
    s.ia[k] = y[IA]
    s.ib[k] = y[IB]
    s.ic[k] = y[IC]
    s.ea[k] = el.e[0]
    s.eb[k] = el.e[1]
    s.ec[k] = el.e[2]
    s.va[k] = el.v[0]
    s.vb[k] = el.v[1]
    s.vc[k] = el.v[2]
    s.vn[k] = el.vn
    s.vab[k] = el.v[0] - el.v[1]
    s.te[k] = p.ke * (el.f[0] * y[IA] + el.f[1] * y[IB] + el.f[2] * y[IC])
    s.w[k] = y[W]
    s.n[k] = (y[W] * 60) / (2 * Math.PI)
    let th = (y[TH] / DEG) % 360
    if (th < 0) th += 360
    s.theta[k] = th
    const sec = sectorOf(topo.sIdx)
    const hall = SECTORS[sec].hall
    s.ha[k] = hall[0]
    s.hb[k] = hall[1]
    s.hc[k] = hall[2]
    s.gate[k] = topo.gate ? 1 : 0
    let idc = 0
    for (let x = 0; x < 3; x++) if (sC[x] && el.v[x] === p.vdc) idc += y[IA + x]
    s.idc[k] = idc
    s.pin[k] = p.vdc * idc
    s.duty[k] = p.duties[periodOf(p, k > 0 ? t - 1e-6 * p.dt : 0)]
    for (let i = 0; i < NY; i++) q[i][k] = y[i]
    sectorArr[k] = sec
    nconnArr[k] = el.nConn
    legsArr[k] = topo.legs.map((l, x) => (l === 'O' ? (topo.cond[x] === 1 ? 'd' : topo.cond[x] === -1 ? 'u' : 'o') : l)).join('')
  }
  store(0, 0)

  // breakpoints: PWM edges and the step
  const bps: number[] = []
  for (let m = 0; m < p.periods; m++) {
    const d = p.duties[m]
    if (m > 0 && d < 1) bps.push(m * p.period)
    if (d < 1) bps.push((m + d) * p.period)
  }
  if (p.tstep !== null) bps.push(p.tstep)
  bps.sort((a, b) => a - b)
  let jb = 0

  const applyEvent = (ev: EvFn, t: number) => {
    if (ev.kind === 'hall+' || ev.kind === 'hall-') {
      const prevLegs = [...topo.legs]
      topo.sIdx += ev.kind === 'hall+' ? 1 : -1
      const sec = sectorOf(topo.sIdx)
      topo.legs = legsOf(sec, topo.gate)
      // a leg that loses its gate keeps its current through a diode
      for (let x = 0; x < 3; x++) if (prevLegs[x] !== 'O' && topo.legs[x] === 'O') topo.cond[x] = y[IA + x] > 0 ? 1 : y[IA + x] < 0 ? -1 : 0
      settleTopo(p, y, topo)
      const outPhase = SECTORS[sec].off
      halls.push({ t, y: Array.from(y), sector: sec, dir: ev.kind === 'hall+' ? 1 : -1 })
      const te = torqueOf(p, y)
      pendingComm = { tHall: t, tEnd: topo.cond[outPhase] === 0 ? t : null, sector: sec, upper: isUpperCommutation(sec), out: outPhase, i0: y[IA + outPhase], te0: te, te1: topo.cond[outPhase] === 0 ? te : null }
      comms.push(pendingComm)
      knots.push({ t, x: Array.from(y), what: 'hall' })
      events.push({ id: `h${events.length}`, kind: 'mode', time: t, device: `hall:${sec}`, values: { sector: sec, n: (y[W] * 60) / (2 * Math.PI), ia: y[IA], ib: y[IB], ic: y[IC], out: outPhase, upper: isUpperCommutation(sec) ? 1 : 0 } })
      return
    }
    const x = ev.x
    if (ev.kind === 'doff') {
      topo.cond[x] = 0
      y[IA + x] = 0
      settleTopo(p, y, topo)
      knots.push({ t, x: Array.from(y), what: 'doff' })
      if (pendingComm && pendingComm.tEnd === null && pendingComm.out === x) {
        pendingComm.tEnd = t
        pendingComm.te1 = torqueOf(p, y)
        events.push({ id: `c${events.length}`, kind: 'diode-off', time: t, device: `${PHASES[x]}:${pendingComm.upper ? 'D-low' : 'D-up'}`, values: { phase: x, tc: t - pendingComm.tHall, upper: pendingComm.upper ? 1 : 0, n: (y[W] * 60) / (2 * Math.PI) } })
      }
      return
    }
    topo.cond[x] = ev.kind === 'don-' ? -1 : 1
    settleTopo(p, y, topo)
    knots.push({ t, x: Array.from(y), what: 'don' })
  }

  /** Integrate over [t0, t1] with the topology changing only at located events. */
  let ver = 0
  let evVer = -1
  let evs: EvFn[] = []
  const g0 = new Float64Array(16)
  let yNext = new Float64Array(NY)
  let yMid = new Float64Array(NY)
  let yHiBuf = new Float64Array(NY)
  const fires = (yy: Float64Array) => {
    for (let i = 0; i < evs.length; i++) {
      const g = evs[i].g(yy)
      // an event fires when its function becomes positive, or reaches zero from below
      if (g > 0 || (g >= 0 && g0[i] < 0)) return true
    }
    return false
  }
  const advance = (t0: number, t1: number, tl: number) => {
    let t = t0
    const h0 = (t1 - t0) / Math.max(1, Math.ceil((t1 - t0) / (p.dt / p.sub) - 1e-9))
    for (let guard = 0; guard < 10000 && t < t1 - 1e-15 * t1; guard++) {
      const h = Math.min(h0, t1 - t)
      if (evVer !== ver) {
        evs = eventFns(p, topo)
        evVer = ver
      }
      for (let i = 0; i < evs.length; i++) g0[i] = evs[i].g(y)
      rk4(p, y, topo, tl, h, ws, yNext)
      if (!fires(yNext)) {
        const tmp = y
        y = yNext
        yNext = tmp
        t += h
        continue
      }
      // bisection for the first instant an event function reaches zero
      let lo = 0
      let hi = h
      yHiBuf.set(yNext)
      for (let it = 0; it < 48; it++) {
        const mid = 0.5 * (lo + hi)
        rk4(p, y, topo, tl, mid, ws, yMid)
        if (fires(yMid)) {
          hi = mid
          const tmp = yHiBuf
          yHiBuf = yMid
          yMid = tmp
        } else lo = mid
      }
      const yOld = y
      y = yHiBuf
      yHiBuf = yOld
      t += hi
      // the event that fired (the largest g when several fire at once; the others are re-checked next step)
      let best: EvFn | null = null
      let bestG = -Infinity
      for (let i = 0; i < evs.length; i++) {
        const g = evs[i].g(y)
        if ((g > 0 || (g >= 0 && g0[i] < 0)) && g > bestG) {
          best = evs[i]
          bestG = g
        }
      }
      if (best) {
        applyEvent(best, t)
        ver++
      }
    }
    return t
  }

  for (let k = 1; k < n; k++) {
    const ta = (k - 1) * p.dt
    const tb = k * p.dt
    while (jb < bps.length && bps[jb] <= ta + p.dt * 1e-9) jb++
    const cuts = [ta]
    for (let qq = jb; qq < bps.length && bps[qq] < tb - p.dt * 1e-9; qq++) cuts.push(bps[qq])
    cuts.push(tb)
    for (let ci = 0; ci + 1 < cuts.length; ci++) {
      const c0 = cuts[ci]
      const c1 = cuts[ci + 1]
      const mid = 0.5 * (c0 + c1)
      const g = gateAt(p, mid)
      if (g !== topo.gate) {
        topo.gate = g
        const legs = legsOf(sectorOf(topo.sIdx), g)
        for (let x = 0; x < 3; x++) if (topo.legs[x] !== 'O' && legs[x] === 'O') topo.cond[x] = y[IA + x] > 0 ? 1 : y[IA + x] < 0 ? -1 : 0
        topo.legs = legs
        settleTopo(p, y, topo)
        ver++
        knots.push({ t: c0, x: Array.from(y), what: 'pwm' })
      } else if (ci > 0) knots.push({ t: c0, x: Array.from(y), what: 'step' })
      advance(c0, c1, loadAt(p, mid))
    }
    store(k, tb)
  }

  // torque averaged over the last PWM period (removes the switching ripple)
  const spp = p.stepsPerPeriod
  for (let k = 0; k < n; k++) s.tav[k] = k >= spp ? (q[QT][k] - q[QT][k - spp]) / p.period : k > 0 ? q[QT][k] / time[k] : s.te[0]
  for (let k = 0; k < n; k++) s.tl[k] = loadAt(p, k > 0 ? time[k] - 1e-6 * p.dt : 0)

  // settled: mean speed of the last electrical cycle vs the one before (extrapolated by the slowest decay)
  const fw = halls.filter((h) => h.dir > 0)
  let steady: BldcRun['diagnostics']['steady'] = { method: 'startup', iterations: 0, residual: NaN, converged: false }
  if (fw.length >= 13) {
    const a = fw[fw.length - 13]
    const b = fw[fw.length - 7]
    const c = fw[fw.length - 1]
    const m1 = (b.y[QW] - a.y[QW]) / (b.t - a.t)
    const m2 = (c.y[QW] - b.y[QW]) / (c.t - b.t)
    const back = c.t - b.t
    const residual = Math.abs(m2 - m1) / Math.max(1e-12, -Math.expm1(-p.sigma * back)) / Math.max(Math.abs(m2), 1)
    steady = { method: 'startup', iterations: 0, residual, converged: residual < 5e-4 }
  }
  // start-up current peak, the step and the end of the run
  let kPk = 0
  for (let k = 1; k < n; k++) if (Math.abs(s.ia[k]) + Math.abs(s.ib[k]) + Math.abs(s.ic[k]) > Math.abs(s.ia[kPk]) + Math.abs(s.ib[kPk]) + Math.abs(s.ic[kPk])) kPk = k
  events.push({ id: 'peak', kind: 'mode', time: time[kPk], device: 'peak', values: { n: s.n[kPk], i: Math.max(Math.abs(s.ia[kPk]), Math.abs(s.ib[kPk]), Math.abs(s.ic[kPk])) } })
  if (p.tstep !== null) {
    const kS = Math.max(0, Math.round(p.tstep / p.dt) - 1)
    events.push({ id: 'step', kind: 'mode', time: p.tstep, device: p.event === 'load' ? 'load-step' : 'duty-step', values: { from: p.event === 'load' ? p.tl : p.duty, to: p.event === 'load' ? p.tl2 : p.d2, nBefore: s.n[kS], nEnd: s.n[n - 1] } })
  }
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'bldc',
    params: p,
    length: n,
    time,
    signals: s,
    devices: [],
    events,
    steadyFrom: (p.periods - 1) * p.stepsPerPeriod,
    knots,
    halls,
    comms,
    sector: sectorArr,
    nconn: nconnArr,
    legs: legsArr,
    q,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady, issues },
  }
}

// ── Measurements ─────────────────────────────────────────────────────────────

export interface BldcMeasurements {
  /** Last whole electrical cycle (Hall edge to the same Hall edge): means. */
  wEnd: number
  nEnd: number
  teMean: number
  idcMean: number
  /** Pair current I = ī_dc/d (the current of the two conducting phases, averaged). */
  iPair: number
  irms: number
  iPeakCycle: number
  /** Torque extremes in the last cycle (instantaneous, and averaged over each PWM period). */
  teMin: number
  teMax: number
  tavMin: number
  tavMax: number
  /** Torque ripple (max − min)/mean: the commutation ripple (PWM-period average when chopping). */
  ripple: number
  /** Mean commutation time of the upper and of the lower commutations in the last cycle. */
  tcUp: number | null
  tcLow: number | null
  /** Torque step over a commutation, (T(end) − T(Hall edge))/T(Hall edge), mean of the last cycle's upper / lower ones. */
  dipUp: number | null
  dipLow: number | null
  /** The chopped phase's current stops during PWM off-times in the last cycle (discontinuous conduction). */
  dcm: boolean
  /** Electrical frequency [Hz] and cycle length [s] of the measured cycle. */
  fe: number
  cycleT: number
  /** Window of the measured cycle. */
  tA: number
  tB: number
  /** Powers over the last cycle [W] and efficiency. */
  pin: number
  pcu: number
  pmech: number
  pshaft: number
  pfr: number
  eff: number | null
  /** Start-up: peak phase current, time to 90 % of the final speed (or of the speed before the step). */
  iPeak: number
  t90: number | null
  wPre: number | null
  /** Energies over the run and the balance residual. */
  ein: number
  ecu: number
  efr: number
  eload: number
  ekin: number
  emag: number
  balance: number
  settled: boolean
  /** Whole electrical cycles in the run (forward Hall edges / 6). */
  cycles: number
}

/** The last whole forward electrical cycle ending at or before tMax: [start, end] Hall snapshots. */
export function lastCycle(r: BldcRun, tMax = Infinity): [HallSnap, HallSnap] | null {
  const fw = r.halls.filter((h) => h.dir > 0 && h.t <= tMax)
  if (fw.length < 7) return null
  return [fw[fw.length - 7], fw[fw.length - 1]]
}

export function measureBldc(r: BldcRun): BldcMeasurements {
  const p = r.params
  const s = r.signals
  const n = r.length
  const cyc = lastCycle(r)
  // fallback window: the last 20 % of the run (the drive turns too slowly for a whole cycle)
  let tA: number
  let tB: number
  let yA: number[]
  let yB: number[]
  if (cyc) {
    tA = cyc[0].t
    tB = cyc[1].t
    yA = cyc[0].y
    yB = cyc[1].y
  } else {
    const kA = Math.floor(0.8 * (n - 1))
    tA = r.time[kA]
    tB = r.time[n - 1]
    yA = r.q.map((a) => a[kA])
    yB = r.q.map((a) => a[n - 1])
  }
  const T = tB - tA
  const mean = (i: number) => (yB[i] - yA[i]) / T
  const wEnd = mean(QW)
  const teMean = mean(QT)
  const pin = mean(QE)
  const pcu = mean(QCU)
  const pfr = mean(QFR)
  const pshaft = mean(QLD)
  const idcMean = pin / p.vdc
  const dEnd = p.duties[p.periods - 1]
  let teMin = Infinity
  let teMax = -Infinity
  let tavMin = Infinity
  let tavMax = -Infinity
  let iPeakCycle = 0
  const kA = Math.ceil(tA / p.dt - 1e-9)
  const kB = Math.floor(tB / p.dt + 1e-9)
  for (let k = kA; k <= kB; k++) {
    teMin = Math.min(teMin, s.te[k])
    teMax = Math.max(teMax, s.te[k])
    iPeakCycle = Math.max(iPeakCycle, Math.abs(s.ia[k]), Math.abs(s.ib[k]), Math.abs(s.ic[k]))
    // the PWM-period average needs a whole period inside the run
    if (k >= p.stepsPerPeriod) {
      tavMin = Math.min(tavMin, s.tav[k])
      tavMax = Math.max(tavMax, s.tav[k])
    }
  }
  // instantaneous extremes also fall on the located events between samples
  for (const kn of r.knots)
    if (kn.t >= tA && kn.t <= tB) {
      const te = p.ke * (trap(kn.x[TH]) * kn.x[IA] + trap(kn.x[TH] - SHIFT[1]) * kn.x[IB] + trap(kn.x[TH] - SHIFT[2]) * kn.x[IC])
      teMin = Math.min(teMin, te)
      teMax = Math.max(teMax, te)
      iPeakCycle = Math.max(iPeakCycle, Math.abs(kn.x[IA]), Math.abs(kn.x[IB]), Math.abs(kn.x[IC]))
    }
  const pwm = p.chop === 'pwm' && dEnd < 1
  const ripple = pwm ? (tavMax - tavMin) / Math.max(Math.abs(teMean), 1e-12) : (teMax - teMin) / Math.max(Math.abs(teMean), 1e-12)
  const tcs = (upper: boolean) => {
    const xs = r.comms.filter((c) => c.tHall >= tA - 1e-12 && c.tHall < tB - 1e-12 && c.upper === upper && c.tEnd !== null).map((c) => c.tEnd! - c.tHall)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }
  const dips = (upper: boolean) => {
    const xs = r.comms.filter((c) => c.tHall >= tA - 1e-12 && c.tHall < tB - 1e-12 && c.upper === upper && c.te1 !== null).map((c) => (c.te1! - c.te0) / c.te0)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }
  let dcm = false
  for (let k = kA; k <= kB; k++) if (r.nconn[k] < 2) dcm = true
  const irms = Math.sqrt(mean(QSQ))
  // start-up
  let iPeak = 0
  for (let k = 0; k < n; k++) iPeak = Math.max(iPeak, Math.abs(s.ia[k]), Math.abs(s.ib[k]), Math.abs(s.ic[k]))
  for (const kn of r.knots) iPeak = Math.max(iPeak, Math.abs(kn.x[IA]), Math.abs(kn.x[IB]), Math.abs(kn.x[IC]))
  let wPre: number | null = null
  if (p.tstep !== null) {
    const pre = lastCycle(r, p.tstep)
    if (pre) wPre = (pre[1].y[QW] - pre[0].y[QW]) / (pre[1].t - pre[0].t)
  }
  let t90: number | null = null
  const target = 0.9 * (wPre ?? wEnd)
  if (target > 0)
    for (let k = 1; k < n; k++)
      if (s.w[k] >= target) {
        const f = (target - s.w[k - 1]) / (s.w[k] - s.w[k - 1])
        t90 = r.time[k - 1] + f * p.dt
        break
      }
  const last = n - 1
  const ein = r.q[QE][last]
  const ecu = r.q[QCU][last]
  const efr = r.q[QFR][last]
  const eload = r.q[QLD][last]
  const ekin = 0.5 * p.j * s.w[last] ** 2
  const emag = 0.5 * p.l * (s.ia[last] ** 2 + s.ib[last] ** 2 + s.ic[last] ** 2)
  const balance = (ein - ecu - efr - eload - ekin - emag) / Math.max(Math.abs(ein), 1e-12)
  const fwd = r.halls.filter((h) => h.dir > 0).length
  return {
    wEnd,
    nEnd: (wEnd * 60) / (2 * Math.PI),
    teMean,
    idcMean,
    iPair: idcMean / dEnd,
    irms,
    iPeakCycle,
    teMin,
    teMax,
    tavMin,
    tavMax,
    ripple,
    tcUp: tcs(true),
    tcLow: tcs(false),
    dipUp: dips(true),
    dipLow: dips(false),
    dcm,
    fe: cyc ? 1 / T : (p.pp * wEnd) / (2 * Math.PI),
    cycleT: T,
    tA,
    tB,
    pin,
    pcu,
    pmech: teMean * wEnd,
    pshaft,
    pfr,
    eff: r.diagnostics.steady.converged && pin > 1e-9 && pshaft > 0 ? pshaft / pin : null,
    iPeak,
    t90,
    wPre,
    ein,
    ecu,
    efr,
    eload,
    ekin,
    emag,
    balance,
    settled: r.diagnostics.steady.converged,
    cycles: Math.floor(fwd / 6),
  }
}

export const rpm = (w: number) => (w * 60) / (2 * Math.PI)
