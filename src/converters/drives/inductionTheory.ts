import { supplyVoltage, syncRpm, vfVoltage, type ResolvedInduction } from './induction.ts'

/**
 * THEORY of the induction motor: the per-phase STEADY-STATE EQUIVALENT CIRCUIT (independent of the simulation).
 *
 *   V ── Rs ── jXls ──┬── jXlr ── Rr/s ──┐      X = 2π·f·L (all at the supply frequency f)
 *                    jXm                 │      s = (ns − n)/ns,  ns = 120·f/P
 *   ─────────────────┴───────────────────┘
 *
 * Phasors are RMS per phase; the rotor branch is written as the admittance s/(Rr + j·s·Xlr), valid at every slip
 * (s = 0 included, s < 0 when generating). T = 3·p/ωs·I2²·Rr/s. For a balanced sinusoidal supply at constant
 * frequency the dynamic model's steady state IS this circuit — the settled operating points of the simulation
 * must agree with it closely (limited only by how well the run has settled and by the integration error).
 */
interface Cx {
  re: number
  im: number
}
const cx = (re: number, im = 0): Cx => ({ re, im })
const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im)
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
const abs2 = (a: Cx) => a.re * a.re + a.im * a.im

type Machine = Pick<ResolvedInduction, 'rs' | 'rr' | 'lls' | 'llr' | 'lm' | 'pp' | 'b'>

/** One steady operating point of the equivalent circuit. */
export interface EqPoint {
  s: number
  f: number
  /** Phase voltage RMS [V]. */
  v: number
  /** Mechanical speed [rad/s] and [rpm]; synchronous speed [rpm]. */
  wm: number
  n: number
  nsync: number
  /** Stator, rotor (referred) and magnetising current, RMS [A]. */
  i1: number
  i2: number
  im: number
  te: number
  pin: number
  pf: number
  pcuS: number
  pcuR: number
  pag: number
  pmech: number
  pfr: number
  /** Air-gap EMF (RMS) [V]. */
  e: number
}

export function eqCircuit(m: Machine, f: number, v: number, s: number): EqPoint {
  const w = 2 * Math.PI * f
  const y2 = div(cx(s), cx(m.rr, s * w * m.llr))
  const ym = cx(0, -1 / (w * m.lm))
  const zp = div(cx(1), add(y2, ym))
  const z = add(cx(m.rs, w * m.lls), zp)
  const i1 = div(cx(v), z)
  const e = mul(i1, zp)
  const i2 = mul(e, y2)
  const im = mul(e, ym)
  const e2 = abs2(e)
  // T = 3·p/ω·I2²·Rr/s, written without dividing by s: I2²·Rr/s = E²·s·Rr/(Rr² + s²·Xlr²)
  const xr = w * m.llr
  const te = ((3 * m.pp) / w) * ((e2 * s * m.rr) / (m.rr * m.rr + s * s * xr * xr))
  const wm = ((1 - s) * w) / m.pp
  const pin = 3 * v * i1.re
  const I1 = Math.sqrt(abs2(i1))
  return {
    s,
    f,
    v,
    wm,
    n: (wm * 60) / (2 * Math.PI),
    nsync: syncRpm(f, m.pp),
    i1: I1,
    i2: Math.sqrt(abs2(i2)),
    im: Math.sqrt(abs2(im)),
    te,
    pin,
    pf: pin / (3 * v * I1),
    pcuS: 3 * I1 * I1 * m.rs,
    pcuR: 3 * abs2(i2) * m.rr,
    pag: (te * w) / m.pp,
    pmech: te * wm,
    pfr: m.b * wm * wm,
    e: Math.sqrt(e2),
  }
}

/** Torque at slip s (the same circuit). */
export const torqueAt = (m: Machine, f: number, v: number, s: number) => eqCircuit(m, f, v, s).te

/** Thevenin equivalent of the supply and stator seen by the rotor branch. */
export function thevenin(m: Machine, f: number, v: number): { vth: number; rth: number; xth: number } {
  const w = 2 * Math.PI * f
  const zs = cx(m.rs, w * m.lls)
  const zm = cx(0, w * m.lm)
  const den = add(zs, zm)
  const vth = div(mul(cx(v), zm), den)
  const zth = div(mul(zs, zm), den)
  return { vth: Math.sqrt(abs2(vth)), rth: zth.re, xth: zth.im }
}

/**
 * Breakdown (pull-out) torque and slip, exact for the circuit (maximum power transfer to Rr/s):
 *   s_max = Rr/√(Rth² + (Xth + Xlr)²),   T_max = 3·p/ωs · Vth²/(2·(Rth + √(Rth² + (Xth + Xlr)²)))
 */
export function breakdown(m: Machine, f: number, v: number): { sMax: number; tMax: number; nMax: number } {
  const w = 2 * Math.PI * f
  const { vth, rth, xth } = thevenin(m, f, v)
  const x = xth + w * m.llr
  const root = Math.sqrt(rth * rth + x * x)
  const sMax = m.rr / root
  const tMax = ((3 * m.pp) / w) * ((vth * vth) / (2 * (rth + root)))
  return { sMax, tMax, nMax: (1 - sMax) * syncRpm(f, m.pp) }
}

/** Net accelerating torque at slip s: motor torque − load − friction (motoring, passive load). */
const net = (m: Machine, f: number, v: number, tl: number, s: number) => torqueAt(m, f, v, s) - tl - (m.b * (1 - s) * 2 * Math.PI * f) / m.pp

/**
 * The STABLE steady operating point on the motoring branch: Te(s) = TL + B·ωm with 0 ≤ s below the breakdown
 * slip (bisection), or null when the load exceeds what the motor can deliver at any speed.
 */
export function stablePoint(m: Machine, f: number, v: number, tl: number): EqPoint | null {
  // the peak of the net torque (golden-section search on 0 … 1; with friction it lies just beyond s_max)
  let a = 0
  let b = 1
  const g = 0.5 * (Math.sqrt(5) - 1)
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  for (let i = 0; i < 120; i++) {
    if (net(m, f, v, tl, c) > net(m, f, v, tl, d)) b = d
    else a = c
    c = b - g * (b - a)
    d = a + g * (b - a)
  }
  const sPk = 0.5 * (a + b)
  if (net(m, f, v, tl, sPk) < 0) return null
  let lo = 0
  let hi = sPk
  if (net(m, f, v, tl, 0) >= 0) return eqCircuit(m, f, v, 0)
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (net(m, f, v, tl, mid) < 0) lo = mid
    else hi = mid
  }
  return eqCircuit(m, f, v, 0.5 * (lo + hi))
}

/** From rest at a fixed frequency (the mains): the rotor starts only if Te > TL at standstill, and it reaches the stable point only if the torque stays above the load all the way. */
export function startsFromRest(m: Machine, f: number, v: number, tl: number, op: EqPoint | null): boolean {
  if (!op) return false
  for (let q = 0; q <= 2000; q++) {
    const s = op.s + ((1 - op.s) * (q + 0.5)) / 2001
    if (net(m, f, v, tl, s) <= 0) return false
  }
  return torqueAt(m, f, v, 1) > tl
}

/** A V/f ramp from 0 Hz: the rotor breaks away at the first frequency whose standstill torque exceeds the load (it is assumed to follow the field from there). */
export function startsOnRamp(p: ResolvedInduction, fSet: number, tl: number): boolean {
  for (let q = 1; q <= 400; q++) {
    const f = (fSet * q) / 400
    if (torqueAt(p, f, vfVoltage(p, f), 1) > tl) return true
  }
  return false
}

export interface ImTheoryState {
  f: number
  v: number
  tl: number
  /** The predicted steady state: the stable point, or the locked rotor (s = 1) when the motor cannot turn the load. */
  point: EqPoint
  locked: boolean
  bd: { sMax: number; tMax: number; nMax: number }
}

function state(p: ResolvedInduction, f: number, tl: number, running: boolean, ramp: boolean): ImTheoryState {
  const v = supplyVoltage(p, f)
  const op = stablePoint(p, f, v, tl)
  const ok = running ? op !== null : ramp ? op !== null && startsOnRamp(p, f, tl) : startsFromRest(p, f, v, tl, op)
  return { f, v, tl, point: ok ? op! : eqCircuit(p, f, v, 1), locked: !ok, bd: breakdown(p, f, v) }
}

/** THEORY for a run: the steady state reached by the start, and after the step (if any). */
export function inductionTheory(p: ResolvedInduction): { start: ImTheoryState; end: ImTheoryState; lockedRotor: EqPoint } {
  const f1 = p.supply === 'dol' ? p.fr : p.f
  const start = state(p, f1, p.tl, false, p.supply === 'vf')
  let end = start
  if (p.event === 'load') end = state(p, f1, p.tl2, !start.locked, false)
  if (p.event === 'freq') end = state(p, p.f2, p.tl, !start.locked, true)
  return { start, end, lockedRotor: eqCircuit(p, f1, supplyVoltage(p, f1), 1) }
}

/** The steady torque–speed curve at one supply frequency (n from n0 to n1 rpm). */
export function torqueSpeedCurve(m: Machine, f: number, v: number, n0: number, n1: number, points = 161): Array<{ n: number; te: number }> {
  const ns = syncRpm(f, m.pp)
  return Array.from({ length: points }, (_, q) => {
    const n = n0 + ((n1 - n0) * q) / (points - 1)
    return { n, te: torqueAt(m, f, v, 1 - n / ns) }
  })
}
