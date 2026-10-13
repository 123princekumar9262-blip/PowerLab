import { affineFlow, type Mat } from '../expm.ts'
import { exactPwl, type PwlSystem } from '../pwl.ts'
import { solveDense } from '../../solvers/linear.ts'
import type { CoupledKind, ResolvedBidi, ResolvedCoupled } from './params.ts'
import { IDEAL_RON } from '../params.ts'

/**
 * THEORY of the advanced converters — independent of the simulator (no netlist, no time stepping).
 *
 * 1. EXACT: the circuit equations written by hand for every conduction mode (below), solved with the
 *    matrix exponential (exactPwl: every mode change by bisection on the exact flow). The periodic steady
 *    state is the fixed point of the exact period map, found by Newton's method. Same physics as the
 *    netlist (Ron, Vf + Ron of the diode, DCR of each inductor, ESR of the output capacitor), different
 *    solution method — their agreement validates the simulation.
 * 2. TEXTBOOK: the ideal closed-form relations with their assumptions.
 *
 * COUPLED converters, state x = [iL1, iL2, vC1, vC] (directions as in model.ts: both inductor currents
 * positive in normal operation, diode current iD = iL1 + iL2). The output node is fed by i_f:
 * vout = k·(vC + ESR·i_f), k = R/(R + ESR);  C·dvC/dt = (R·i_f − vC)/(R + ESR).
 *
 *  ĆUK    ON   vA = Ron·(iL1 + iL2), vB = vA − vC1
 *              L1·diL1/dt = Vin − DCR·iL1 − vA      L2·diL2/dt = vout − vB − DCR·iL2
 *              C1·dvC1/dt = −iL2                     i_f = −iL2
 *         OFF  vB = Vf + RonD·(iL1 + iL2), vA = vB + vC1        C1·dvC1/dt = iL1   (same L rows, i_f = −iL2)
 *  SEPIC  ON   vA = Ron·(iL1 + iL2), vB = vA − vC1
 *              L1·diL1/dt = Vin − DCR·iL1 − vA      L2·diL2/dt = −vB − DCR·iL2
 *              C1·dvC1/dt = −iL2                     i_f = 0
 *         OFF  vB = vout + Vf + RonD·(iL1 + iL2), vA = vB + vC1  C1·dvC1/dt = iL1    i_f = iL1 + iL2
 *  ZETA   ON   vA = Vin − Ron·(iL1 + iL2), vB = vA + vC1
 *              L1·diL1/dt = vA − DCR·iL1            L2·diL2/dt = vB − vout − DCR·iL2
 *              C1·dvC1/dt = −iL2                     i_f = iL2
 *         OFF  vB = −Vf − RonD·(iL1 + iL2), vA = vB − vC1         C1·dvC1/dt = iL1    i_f = iL2
 *  IDLE (DCM: Q1 and D1 OFF): iL2 = −iL1 = −i — the two inductors form ONE series loop through C1, and
 *       (L1 + L2)·di/dt = Vin − vC1 − 2·DCR·i (SEPIC),  Vin − vC1 − vout − 2·DCR·i (Ćuk),  vout − vC1 − 2·DCR·i (Zeta).
 *       In steady state that loop voltage averages to zero: the inductor currents do NOT fall to zero in
 *       DCM, only their sum (the diode current) does — they circulate at ±i.
 *
 * BIDIRECTIONAL, state x = [iL, vC]: the switch-node voltage follows from KCL with the conducting
 * devices (Q1/Q2: Ron both ways; D1/D2: Vf + RonD, forward only), L·diL/dt = vsw − vLV − DCR·iL, the LV
 * node from C (ESR) ‖ battery (Eb, Rb).
 */

/** on: Q1 ON, D1 OFF · ond: Q1 and D1 both ON (a heavily rippling C1 forward-biases D1) · off: D1 ON · idle: both OFF. */
export type CoupledMode = 'on' | 'ond' | 'off' | 'idle'

export interface CoupledOut {
  vout: number
  vA: number
  vB: number
  iin: number
  iq: number
  vq: number
  id: number
  vd: number
  ic: number
  io: number
  /** Current fed into the output node by the converter. */
  feed: number
}

/** The hand-written circuit equations: derivative and outputs in one conduction mode (affine in x). */
export function coupledEval(p: ResolvedCoupled, mode: CoupledMode, x: number[]): { dx: number[]; out: CoupledOut } {
  const [i1, i2, v1, v2] = x
  const { vin, l1, l2, c1, c, r, esr, rl } = p
  const ron = p.q.ron
  const vf = p.d.vf
  const rd = p.d.ron
  const k = r / (r + esr)
  const kind = p.kind
  let f = 0
  let vA = 0
  let vB = 0
  let di1 = 0
  let di2 = 0
  let dv1 = 0
  let iin = 0
  let iq = 0
  let id = 0
  let vq = 0
  let vd = 0
  let vout = 0
  if (mode === 'idle') {
    const i = (i1 - i2) / 2
    let didt: number
    if (kind === 'sepic') {
      f = 0
      vout = k * v2
      didt = (vin - v1 - 2 * rl * i) / (l1 + l2)
      vA = vin - rl * i - l1 * didt
      vB = vA - v1
      iin = i
      vq = vA
      vd = vB - vout
    } else if (kind === 'cuk') {
      f = i
      vout = k * (v2 + esr * f)
      didt = (vin - v1 - vout - 2 * rl * i) / (l1 + l2)
      vA = vin - rl * i - l1 * didt
      vB = vA - v1
      iin = i
      vq = vA
      vd = vB
    } else {
      f = -i
      vout = k * (v2 + esr * f)
      didt = (vout - v1 - 2 * rl * i) / (l1 + l2)
      vA = l1 * didt + rl * i
      vB = vA + v1
      iin = 0
      vq = vin - vA
      vd = -vB
    }
    di1 = didt
    di2 = -didt
    dv1 = i / c1
  } else if (kind === 'sepic') {
    if (mode === 'on') {
      iq = i1 + i2
      vA = ron * iq
      vB = vA - v1
      f = 0
      vout = k * v2
      dv1 = -i2 / c1
    } else if (mode === 'ond') {
      // both conduct: iC1 from vA − vB = vC1 with vA = Ron·iQ, vB = vout + Vf + RonD·iD
      const xc = (ron * i1 - k * v2 - (k * esr + rd) * i2 - vf - v1) / (ron + k * esr + rd)
      iq = i1 - xc
      id = xc + i2
      f = id
      vout = k * (v2 + esr * f)
      vA = ron * iq
      vB = vout + vf + rd * id
      dv1 = xc / c1
    } else {
      id = i1 + i2
      f = id
      vout = k * (v2 + esr * f)
      vB = vout + vf + rd * id
      vA = vB + v1
      dv1 = i1 / c1
    }
    di1 = (vin - rl * i1 - vA) / l1
    di2 = (-vB - rl * i2) / l2
    iin = i1
    vq = vA
    vd = vB - vout
  } else if (kind === 'cuk') {
    f = -i2
    vout = k * (v2 + esr * f)
    if (mode === 'on') {
      iq = i1 + i2
      vA = ron * iq
      vB = vA - v1
      dv1 = -i2 / c1
    } else if (mode === 'ond') {
      const xc = (ron * i1 - vf - rd * i2 - v1) / (ron + rd)
      iq = i1 - xc
      id = xc + i2
      vA = ron * iq
      vB = vf + rd * id
      dv1 = xc / c1
    } else {
      id = i1 + i2
      vB = vf + rd * id
      vA = vB + v1
      dv1 = i1 / c1
    }
    di1 = (vin - rl * i1 - vA) / l1
    di2 = (vout - vB - rl * i2) / l2
    iin = i1
    vq = vA
    vd = vB
  } else {
    f = i2
    vout = k * (v2 + esr * f)
    if (mode === 'on') {
      iq = i1 + i2
      vA = vin - ron * iq
      vB = vA + v1
      dv1 = -i2 / c1
      iin = iq
    } else if (mode === 'ond') {
      const xc = (ron * i1 - vf - rd * i2 - vin - v1) / (ron + rd)
      iq = i1 - xc
      id = xc + i2
      vA = vin - ron * iq
      vB = -vf - rd * id
      dv1 = xc / c1
      iin = iq
    } else {
      id = i1 + i2
      vB = -vf - rd * id
      vA = vB - v1
      dv1 = i1 / c1
      iin = 0
    }
    di1 = (vA - rl * i1) / l1
    di2 = (vB - vout - rl * i2) / l2
    vq = vin - vA
    vd = -vB
  }
  const dv2 = (r * f - v2) / (c * (r + esr))
  return { dx: [di1, di2, dv1, dv2], out: { vout, vA, vB, iin, iq, vq, id, vd, ic: c * dv2, io: vout / r, feed: f } }
}

/** A and b of an affine vector field, read off by evaluating it at 0 and at the unit vectors (exact for affine maps). */
function linearize(n: number, f: (x: number[]) => number[]): { A: Mat; b: number[] } {
  const b = f(new Array<number>(n).fill(0))
  const A: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0)
    e[j] = 1
    const fj = f(e)
    for (let i = 0; i < n; i++) A[i][j] = fj[i] - b[i]
  }
  return { A, b }
}

export function coupledPwl(p: ResolvedCoupled): PwlSystem & { lin: Record<CoupledMode, { A: Mat; b: number[] }> } {
  const Ts = p.ts
  const tOn = p.duty * Ts
  const lin = {
    on: linearize(4, (x) => coupledEval(p, 'on', x).dx),
    ond: linearize(4, (x) => coupledEval(p, 'ond', x).dx),
    off: linearize(4, (x) => coupledEval(p, 'off', x).dx),
    idle: linearize(4, (x) => coupledEval(p, 'idle', x).dx),
  }
  const gateOn = (t: number) => t - Ts * Math.floor(t / Ts) < tOn
  const epsV = 1e-9 * p.vin
  return {
    n: 4,
    lin,
    breakpoints: [tOn, Ts],
    sys: (mode) => lin[mode as CoupledMode],
    // Complementarity with hysteresis: the diode leaves a state only when the OTHER state is consistent
    // (ON → OFF needs iD < 0 AND a blocking voltage vD ≤ Vf in the OFF circuit; OFF → ON needs vD > Vf). At a
    // grazing contact, where neither test is clear-cut, it keeps its state instead of chattering.
    mode(x, t, prev) {
      const vdIdle = () => coupledEval(p, 'idle', x).out.vd
      if (gateOn(t)) {
        const vdOn = coupledEval(p, 'on', x).out.vd
        if (prev === 'ond') return coupledEval(p, 'ond', x).out.id < 0 && vdOn <= p.d.vf ? 'on' : 'ond'
        return vdOn > p.d.vf + epsV ? 'ond' : 'on'
      }
      const iD = x[0] + x[1]
      if (prev === 'off') return iD < 0 && vdIdle() <= p.d.vf ? 'idle' : 'off'
      if (prev === 'idle') return vdIdle() > p.d.vf + epsV ? 'off' : 'idle'
      if (iD > 0) return 'off'
      return vdIdle() > p.d.vf + epsV ? 'off' : 'idle'
    },
  }
}

/** Ideal CCM operating point (lossless, small ripple) — the TEXTBOOK values and the steady-state search's start. */
export function coupledIdeal(p: Pick<ResolvedCoupled, 'kind' | 'vin' | 'duty' | 'r'>) {
  const D = p.duty
  const M = (p.kind === 'cuk' ? -D : D) / (1 - D)
  const vout = M * p.vin
  const iout = Math.abs(vout) / p.r
  const iin = (M * M * p.vin) / p.r
  const v1 = p.kind === 'cuk' ? p.vin + Math.abs(vout) : p.kind === 'sepic' ? p.vin : Math.abs(vout)
  return { M, vout, iout, iin, i1: iin, i2: iout, v1 }
}

/** CCM/DCM boundary: the diode current iL1 + iL2 behaves like the buck-boost's iL with Le = L1·L2/(L1 + L2). */
export function coupledBoundary(p: Pick<ResolvedCoupled, 'l1' | 'l2' | 'r' | 'fs' | 'duty'>) {
  const le = (p.l1 * p.l2) / (p.l1 + p.l2)
  const K = (2 * le * p.fs) / p.r
  const Kcrit = (1 - p.duty) ** 2
  return { le, K, Kcrit, leCrit: (Kcrit * p.r) / (2 * p.fs), rCrit: (2 * le * p.fs) / Kcrit, ccm: K > Kcrit }
}

export interface CoupledMetrics {
  voutAvg: number
  voutMax: number
  voutMin: number
  il1Avg: number
  il1Max: number
  il1Min: number
  il2Avg: number
  il2Max: number
  il2Min: number
  vc1Avg: number
  vc1Max: number
  vc1Min: number
  ioAvg: number
  iinAvg: number
  idAvg: number
  idMax: number
  pinAvg: number
  poutAvg: number
  efficiency: number
  losses: { q: number; d: number; dcr: number; esr: number; total: number }
  iqRms: number
  idRms: number
  icRms: number
  vqMax: number
  vdReverseMax: number
  d2: number
  d3: number
}

export interface CoupledExact {
  mode: 'CCM' | 'DCM'
  x0: number[]
  /** Segment boundaries of one period with their conduction mode. */
  segments: Array<{ t0: number; t1: number; mode: CoupledMode }>
  newtonIterations: number
  residual: number
  metrics: CoupledMetrics
  /** iL1 + iL2 < 0 when Q1 turns off: the ideal circuit has no path for it (see CoupledMeasurements.reverseTurnOff). */
  reverseTurnOff: boolean
}

/**
 * Periodic steady state of an exact piecewise-linear system: Newton on Φ(x) − x with a finite-difference
 * Jacobian of the EXACT period map (Φ is affine in CCM: one step; piecewise smooth in DCM: a few).
 */
function periodicFixedPoint(sys: PwlSystem, Ts: number, guess: number[], scale: number[], mode0: (x: number[]) => string) {
  const n = guess.length
  // the conduction mode at t = 0⁺ follows from the state itself (never carried over from another state)
  const phi = (x: number[]) => exactPwl(sys, x, 0, [Ts], mode0(x)).x[0]
  const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]) / scale[i]))
  let x = [...guess]
  let it = 0
  let res = Infinity
  for (; it < 40; it++) {
    const fx = phi(x)
    res = dist(fx, x)
    if (res < 1e-12) break
    const F = fx.map((v, i) => v - x[i])
    const J = new Float64Array(n * n)
    for (let j = 0; j < n; j++) {
      const dx = 1e-7 * scale[j]
      const xp = [...x]
      xp[j] += dx
      const fp = phi(xp)
      for (let i = 0; i < n; i++) J[i * n + j] = (fp[i] - xp[i] - F[i]) / dx
    }
    const step = solveDense(J, Float64Array.from(F.map((v) => -v)), n)
    if (!step) break
    let lam = 1
    let next = x.map((v, i) => v + step[i])
    for (let tries = 0; tries < 8; tries++) {
      const r2 = dist(phi(next), next)
      if (r2 < res) break
      lam /= 2
      next = x.map((v, i) => v + lam * step[i])
    }
    x = next
  }
  if (!(res < 1e-9)) {
    // fallback: plain period-by-period iteration of the exact map
    for (let k = 0; k < 20000 && !(res < 1e-11); k++) {
      const fx = phi(x)
      res = dist(fx, x)
      x = fx
    }
  }
  return { x, iterations: it, residual: res }
}

/** Segments of one period (from the exact solution's own mode changes). */
function periodSegments(sys: PwlSystem, x0: number[], Ts: number, mode0: string) {
  const r = exactPwl(sys, x0, 0, [Ts], mode0)
  const segs: Array<{ t0: number; t1: number; mode: string }> = []
  let t = 0
  let mode = mode0
  for (const e of r.events) {
    if (e.t > t) segs.push({ t0: t, t1: e.t, mode })
    t = Math.max(t, e.t)
    mode = e.to
  }
  if (Ts > t) segs.push({ t0: t, t1: Ts, mode })
  // merge neighbours in the same mode (an event can be reported at a breakpoint without a change)
  const out: typeof segs = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.mode === s.mode && Math.abs(last.t1 - s.t0) < 1e-15 * Ts) last.t1 = s.t1
    else out.push({ ...s })
  }
  return out
}

/**
 * Integrate output functions over one period along the exact solution: composite Simpson on every
 * segment (N sub-steps of one exact exponential each), extremes on the same points.
 */
function integrate<O extends Record<string, number>>(
  segs: Array<{ t0: number; t1: number; mode: string }>,
  x0: number[],
  lin: Record<string, { A: Mat; b: number[] }>,
  outputs: (mode: string, x: number[]) => O,
  N = 240,
) {
  const sums: Record<string, number> = {}
  const max: Record<string, number> = {}
  const min: Record<string, number> = {}
  let x = x0
  let T = 0
  for (const s of segs) {
    const h = (s.t1 - s.t0) / N
    if (!(h > 0)) continue
    const { A, b } = lin[s.mode]
    const flow = affineFlow(A, b, h)
    let xj = x
    for (let j = 0; j <= N; j++) {
      const o = outputs(s.mode, xj)
      const w = (j === 0 || j === N ? 1 : j % 2 ? 4 : 2) * (h / 3)
      for (const key in o) {
        const v = o[key]
        sums[key] = (sums[key] ?? 0) + w * v
        max[key] = Math.max(max[key] ?? -Infinity, v)
        min[key] = Math.min(min[key] ?? Infinity, v)
      }
      if (j < N) xj = flow(xj)
    }
    x = xj
    T += s.t1 - s.t0
  }
  const avg: Record<string, number> = {}
  for (const k in sums) avg[k] = sums[k] / T
  return { avg: avg as Record<keyof O, number>, max: max as Record<keyof O, number>, min: min as Record<keyof O, number>, end: x }
}

/** Exact periodic steady state of a coupled converter. */
export function coupledExact(p: ResolvedCoupled): CoupledExact {
  const sys = coupledPwl(p)
  const g = coupledIdeal(p)
  const iS = Math.max(Math.abs(g.i1), Math.abs(g.i2), p.vin / p.r, 1e-3)
  const vS = Math.max(Math.abs(g.vout), p.vin, 1e-3)
  const scale = [iS, iS, Math.max(g.v1, vS), vS]
  const fp = periodicFixedPoint(sys, p.ts, [g.i1, g.i2, g.v1, g.vout], scale, () => 'on')
  const x0 = fp.x
  const segs = periodSegments(sys, x0, p.ts, 'on') as Array<{ t0: number; t1: number; mode: CoupledMode }>
  const outputs = (mode: string, x: number[]) => {
    const { out } = coupledEval(p, mode as CoupledMode, x)
    return {
      vout: out.vout,
      i1: mode === 'idle' ? (x[0] - x[1]) / 2 : x[0],
      i2: mode === 'idle' ? -(x[0] - x[1]) / 2 : x[1],
      v1: x[2],
      io: out.io,
      iin: out.iin,
      id: out.id,
      pin: p.vin * out.iin,
      pout: out.vout * out.io,
      pq: out.vq * out.iq,
      pd: out.vd * out.id,
      pdcr: p.rl * (x[0] * x[0] + x[1] * x[1]),
      pesr: p.esr * out.ic * out.ic,
      iq2: out.iq * out.iq,
      id2: out.id * out.id,
      ic2: out.ic * out.ic,
      vq: out.vq,
      vd: out.vd,
    }
  }
  const { avg, max, min } = integrate(segs, x0, sys.lin, outputs)
  const dur = (m: CoupledMode) => segs.filter((s) => s.mode === m).reduce((a, s) => a + s.t1 - s.t0, 0) / p.ts
  const d3 = dur('idle')
  const xOff = exactPwl(sys, x0, 0, [p.duty * p.ts], 'on').x[0]
  const reverseTurnOff = xOff[0] + xOff[1] < -1e-3 * scale[0]
  const losses = { q: avg.pq, d: avg.pd, dcr: avg.pdcr, esr: avg.pesr, total: 0 }
  losses.total = losses.q + losses.d + losses.dcr + losses.esr
  return {
    mode: d3 > 0 ? 'DCM' : 'CCM',
    x0,
    segments: segs,
    newtonIterations: fp.iterations,
    residual: fp.residual,
    reverseTurnOff,
    metrics: {
      voutAvg: avg.vout,
      voutMax: max.vout,
      voutMin: min.vout,
      il1Avg: avg.i1,
      il1Max: max.i1,
      il1Min: min.i1,
      il2Avg: avg.i2,
      il2Max: max.i2,
      il2Min: min.i2,
      vc1Avg: avg.v1,
      vc1Max: max.v1,
      vc1Min: min.v1,
      ioAvg: avg.io,
      iinAvg: avg.iin,
      idAvg: avg.id,
      idMax: max.id,
      pinAvg: avg.pin,
      poutAvg: avg.pout,
      efficiency: avg.pout / avg.pin,
      losses,
      iqRms: Math.sqrt(avg.iq2),
      idRms: Math.sqrt(avg.id2),
      icRms: Math.sqrt(avg.ic2),
      vqMax: max.vq,
      vdReverseMax: -min.vd,
      d2: dur('off') + dur('ond'),
      d3,
    },
  }
}

export interface TextbookValue {
  key: string
  value: number | null
  formula: string
  assumptions: string[]
  notApplicable?: string
}

const LAW: Record<CoupledKind, string> = { cuk: 'Vout = −D·Vin/(1 − D)', sepic: 'Vout = D·Vin/(1 − D)', zeta: 'Vout = D·Vin/(1 − D)' }
const VC1_LAW: Record<CoupledKind, string> = { cuk: 'VC1 = Vin + |Vout| = Vin/(1 − D)', sepic: 'VC1 = Vin', zeta: 'VC1 = Vout' }
export const coupledLaw = (kind: CoupledKind) => LAW[kind]
export const coupledVc1Law = (kind: CoupledKind) => VC1_LAW[kind]

/** TEXTBOOK relations (ideal devices, lossless L and C, small ripple), with their assumptions. */
export function coupledTextbook(p: ResolvedCoupled): Record<string, TextbookValue> {
  const kind = p.kind
  const D = p.duty
  const b = coupledBoundary(p)
  const ideal = p.devices === 'ideal' && p.rl === 0
  const base = ['ideal switch and diode (no drops)', 'lossless inductors and capacitors', 'periodic steady state']
  const nonIdeal = ideal ? undefined : 'Non-ideal devices or DCR: the ideal relation is only an approximation here (see the exact theory).'
  const out: Record<string, TextbookValue> = {}
  const sgn = kind === 'cuk' ? -1 : 1
  const di1 = (p.vin * D) / (p.l1 * p.fs)
  const di2 = (p.vin * D) / (p.l2 * p.fs)
  if (b.ccm) {
    const g = coupledIdeal(p)
    const smallC1 = ['constant vC1 over a period (C1 ripple small)']
    out.voutAvg = { key: 'voutAvg', value: g.vout, formula: LAW[kind], assumptions: [...base, 'CCM (the diode current iL1 + iL2 stays above zero)'], notApplicable: nonIdeal }
    out.vc1Avg = { key: 'vc1Avg', value: g.v1, formula: VC1_LAW[kind], assumptions: [...base, 'CCM', 'average vL1 = average vL2 = 0'], notApplicable: nonIdeal }
    out.il1Avg = { key: 'il1Avg', value: g.iin, formula: 'IL1 = Iin = Pout/Vin', assumptions: [...base, 'CCM', 'power balance (lossless)'], notApplicable: nonIdeal }
    out.il2Avg = { key: 'il2Avg', value: g.iout, formula: 'IL2 = |Iout| = |Vout|/R', assumptions: [...base, 'CCM', 'charge balance on C1 (and on C)'], notApplicable: nonIdeal }
    const ripple = (key: string, val: number, formula: string, extra: string[]) => ({ key, value: val, formula, assumptions: [...base, 'CCM', ...extra], notApplicable: nonIdeal })
    out.il1PP = ripple('il1PP', di1, 'ΔiL1 = Vin·D/(L1·fs)', ['vL1 = Vin while Q1 is ON', ...smallC1])
    out.il2PP = ripple('il2PP', di2, 'ΔiL2 = Vin·D/(L2·fs)', [`vL2 = ${kind === 'sepic' ? 'vC1 = Vin' : 'Vin'} while Q1 is ON`, ...smallC1, 'constant Vout'])
    out.il1Max = ripple('il1Max', g.iin + di1 / 2, 'IL1,max = IL1 + ΔiL1/2', [])
    out.il1Min = ripple('il1Min', g.iin - di1 / 2, 'IL1,min = IL1 − ΔiL1/2', [])
    out.il2Max = ripple('il2Max', g.iout + di2 / 2, 'IL2,max = IL2 + ΔiL2/2', [])
    out.il2Min = ripple('il2Min', g.iout - di2 / 2, 'IL2,min = IL2 − ΔiL2/2', [])
    out.vc1PP = { key: 'vc1PP', value: (g.iout * D) / (p.c1 * p.fs), formula: 'ΔVC1 = |Iout|·D/(C1·fs) (C1 carries iL2 while Q1 is ON)', assumptions: [...base, 'CCM', 'iL2 ≈ IL2 (small ripple)'], notApplicable: nonIdeal }
    if (kind === 'sepic') {
      const idMin = g.iin + g.iout - (di1 + di2) / 2
      out.voutPP = {
        key: 'voutPP',
        value: (g.iout * D) / (p.c * p.fs),
        formula: 'ΔVout = Iout·D/(C·fs) (C alone feeds the load while Q1 is ON)',
        assumptions: [...base, 'CCM', 'load current constant', 'iD ≥ Iout throughout OFF', 'no capacitor ESR'],
        notApplicable: p.esr > 0 ? 'ESR > 0 adds a step of iD·ESR when the diode turns on; the capacitive-only formula does not apply.' : idMin < g.iout ? 'The diode current falls below the load current during OFF, so C also discharges then: the formula underestimates the ripple.' : nonIdeal,
      }
    } else {
      out.voutPP = {
        key: 'voutPP',
        value: di2 / (8 * p.c * p.fs),
        formula: 'ΔVout = ΔiL2/(8·C·fs) (L2 feeds the output continuously, like a buck)',
        assumptions: [...base, 'CCM', 'all of the L2 ripple flows into C', 'no capacitor ESR'],
        notApplicable: p.esr > 0 ? 'ESR > 0 adds ΔiL2·ESR to the ripple; the capacitive-only formula does not apply.' : nonIdeal,
      }
    }
    out.d2 = { key: 'd2', value: 1 - D, formula: 'D2 = 1 − D (the diode conducts whenever Q1 is OFF)', assumptions: ['CCM'] }
  } else {
    const M = (sgn * D) / Math.sqrt(b.K)
    const vout = M * p.vin
    const vForm = `Vout/Vin = ${kind === 'cuk' ? '−' : ''}D/√Ke,  Ke = 2·Le/(R·Ts), Le = L1·L2/(L1 + L2)`
    out.voutAvg = { key: 'voutAvg', value: vout, formula: vForm, assumptions: [...base, 'discontinuous conduction (DCM)', 'small ripple on C1 and C'], notApplicable: nonIdeal }
    out.d2 = { key: 'd2', value: Math.sqrt(b.K), formula: 'D2 = D·Vin/|Vout| = √Ke (volt-second balance on Le)', assumptions: [...base, 'DCM'], notApplicable: nonIdeal }
    out.d3 = { key: 'd3', value: 1 - D - Math.sqrt(b.K), formula: 'D3 = 1 − D − D2', assumptions: [...base, 'DCM'], notApplicable: nonIdeal }
    const vc1 = kind === 'cuk' ? p.vin + Math.abs(vout) : kind === 'sepic' ? p.vin : Math.abs(vout)
    out.vc1Avg = { key: 'vc1Avg', value: vc1, formula: VC1_LAW[kind], assumptions: [...base, 'DCM: the circulating loop current is constant during the idle interval'], notApplicable: nonIdeal }
    out.il2Avg = { key: 'il2Avg', value: Math.abs(vout) / p.r, formula: 'IL2 = |Iout| (charge balance on C1 and C)', assumptions: [...base], notApplicable: nonIdeal }
    out.il1Avg = { key: 'il1Avg', value: (vout * vout) / p.r / p.vin, formula: 'IL1 = Iin = Pout/Vin', assumptions: [...base, 'power balance (lossless)'], notApplicable: nonIdeal }
    out.il1PP = { key: 'il1PP', value: di1, formula: 'ΔiL1 = Vin·D/(L1·fs) (rises only while Q1 is ON)', assumptions: [...base, 'DCM', 'constant vC1'], notApplicable: nonIdeal }
    out.il2PP = { key: 'il2PP', value: di2, formula: 'ΔiL2 = Vin·D/(L2·fs)', assumptions: [...base, 'DCM', 'constant vC1 and Vout'], notApplicable: nonIdeal }
    out.voutPP = { key: 'voutPP', value: null, formula: '—', assumptions: [], notApplicable: 'No simple closed form for the ripple in DCM: compare with the exact solution.' }
  }
  const v = out.voutAvg.value ?? 0
  const vNA = out.voutAvg.notApplicable
  out.ioAvg = { key: 'ioAvg', value: v / p.r, formula: 'Iout = Vout/R', assumptions: out.voutAvg.assumptions, notApplicable: vNA }
  out.poutAvg = { key: 'poutAvg', value: (v * v) / p.r, formula: 'Pout = Vout²/R (ripple neglected)', assumptions: [...out.voutAvg.assumptions, 'small output ripple'], notApplicable: vNA }
  out.pinAvg = { key: 'pinAvg', value: (v * v) / p.r, formula: 'Pin = Pout (lossless)', assumptions: [...out.voutAvg.assumptions], notApplicable: vNA }
  out.efficiency = { key: 'efficiency', value: 1, formula: 'η = 100 %', assumptions: ['ideal (lossless) components'], notApplicable: ideal ? undefined : 'Non-ideal devices dissipate power.' }
  out.vqMax = { key: 'vqMax', value: p.vin + Math.abs(v), formula: 'VQ,max = Vin + |Vout| (Q1 blocks vC1 + … while OFF)', assumptions: [...base, 'small ripple'], notApplicable: vNA }
  return out
}

/** Periods for the start-up view (see settle). */
export function coupledSettlePeriods(p: ResolvedCoupled): number {
  const sys = coupledPwl(p)
  const D = p.duty
  const A = sys.lin.on.A.map((row, i) => row.map((v, j) => D * v + (1 - D) * sys.lin.off.A[i][j]))
  const b = sys.lin.on.b.map((v, i) => D * v + (1 - D) * sys.lin.off.b[i])
  const g = coupledIdeal(p)
  const scale = [Math.max(g.i1, g.i2, 1e-3), Math.max(g.i1, g.i2, 1e-3), Math.max(g.v1, 1e-3), Math.max(Math.abs(g.vout), 1e-3)]
  return settle(A, b, [0, 0, 0, 0], p.ts, scale)
}

/**
 * Start-up length: until the averaged model settles (three periods within 1 %), × 1.3, between 20 and
 * START_MAX periods. The cap keeps a start-up run interactive (≤ 150 periods × 200 steps); a lightly damped
 * L–C1 resonance (no DCR) can take longer — the start-up view then ends before the periodic steady state,
 * which the steady-state view finds directly (shooting).
 */
export const START_MAX = 150
function settle(A: Mat, b: number[], x0: number[], Ts: number, scale: number[], cap = START_MAX): number {
  const n = x0.length
  const neg = b.map((v) => -v)
  const xs = solveDense(Float64Array.from(A.flat()), Float64Array.from(neg), n)
  if (!xs) return 200
  const flow = affineFlow(A, b, Ts)
  let x = x0
  // "settled": three consecutive periods within 1 % of the final state (an oscillation can pass through it)
  let calm = 0
  for (let k = 1; k <= cap; k++) {
    x = flow(x)
    const err = Math.max(...x.map((v, i) => Math.abs(v - xs[i]) / scale[i]))
    calm = err < 0.01 ? calm + 1 : 0
    if (calm >= 3) return Math.max(20, Math.min(cap, Math.ceil(1.3 * k)))
  }
  return cap
}

// ── Bidirectional ─────────────────────────────────────────────────────────────────────────────────

export interface BidiOut {
  vsw: number
  vlv: number
  ib: number
  ic: number
  ihv: number
  iq1: number
  iq2: number
  id1: number
  id2: number
}

/** Mode key: 'g1 g2 d1 d2' as 0/1 digits (gates of Q1, Q2; conduction of D1, D2), or 'float' (nothing conducts, iL = 0). */
export function bidiEval(p: ResolvedBidi, mode: string, x: number[]): { dx: number[]; out: BidiOut } {
  const [iRaw, v] = x
  const { vhv, rb, esr, eb, rl, l, c } = p
  const ron = p.q.ron
  const vf = p.dio.vf
  const rd = p.dio.ron
  const fl = mode === 'float'
  const i = fl ? 0 : iRaw
  const vlv = (rb * v + esr * rb * i + esr * eb) / (rb + esr)
  const ib = (vlv - eb) / rb
  const ic = i - ib
  if (fl) return { dx: [0, ic / c], out: { vsw: vlv, vlv, ib, ic, ihv: 0, iq1: 0, iq2: 0, id1: 0, id2: 0 } }
  const g1 = mode[0] === '1' ? 1 : 0
  const g2 = mode[1] === '1' ? 1 : 0
  const d1 = mode[2] === '1' ? 1 : 0
  const d2 = mode[3] === '1' ? 1 : 0
  const G = (g1 + g2) / ron + (d1 + d2) / rd
  // KCL at the switch node: the legs deliver iL
  const vsw = ((g1 * vhv) / ron + (d1 * (vhv + vf)) / rd - (d2 * vf) / rd - i) / G
  const iq1 = (g1 * (vhv - vsw)) / ron
  const id1 = (d1 * (vsw - vhv - vf)) / rd
  const iq2 = (g2 * vsw) / ron
  const id2 = (d2 * (-vsw - vf)) / rd
  return { dx: [(vsw - vlv - rl * i) / l, ic / c], out: { vsw, vlv, ib, ic, ihv: iq1 - id1, iq1, iq2, id1, id2 } }
}

/**
 * How far a diode assumption is violated [A]: an ON diode with reverse current, an OFF diode with a forward
 * voltage above Vf (converted to amps through RonD). 0 = consistent.
 */
function bidiViolation(p: ResolvedBidi, mode: string, x: number[]): number {
  const d1 = mode[2] === '1'
  const d2 = mode[3] === '1'
  const { out } = bidiEval(p, mode, x)
  const vf = p.dio.vf
  const rd = p.dio.ron
  const v1 = d1 ? Math.max(0, -out.id1) : Math.max(0, (out.vsw - p.vhv - vf) / rd)
  const v2 = d2 ? Math.max(0, -out.id2) : Math.max(0, (-out.vsw - vf) / rd)
  return Math.max(v1, v2)
}

export function bidiGates(p: ResolvedBidi) {
  const Ts = p.ts
  const td = p.deadTime
  const ph = (t: number) => t - Ts * Math.floor(t / Ts)
  return {
    g1: (t: number) => ph(t) >= td && ph(t) < p.d * Ts,
    g2: (t: number) => ph(t) >= p.d * Ts + td,
    breakpoints: [...(td > 0 ? [td] : []), p.d * Ts, ...(td > 0 ? [p.d * Ts + td] : []), Ts],
  }
}

export function bidiPwl(p: ResolvedBidi): PwlSystem & { lin: Record<string, { A: Mat; b: number[] }> } {
  const lin: Record<string, { A: Mat; b: number[] }> = {}
  const sysOf = (mode: string) => (lin[mode] ??= linearize(2, (x) => bidiEval(p, mode, x).dx))
  const gates = bidiGates(p)
  return {
    n: 2,
    lin,
    breakpoints: gates.breakpoints,
    sys: (mode) => sysOf(mode),
    mode(x, t, prev) {
      const g = `${gates.g1(t) ? 1 : 0}${gates.g2(t) ? 1 : 0}`
      if (g === '00') {
        // nothing gated: a diode carries iL until iL reaches zero; then nothing conducts until the next gate
        if (prev === 'float') return 'float'
        if (prev === '0001' && !(x[0] > 0)) return 'float'
        if (prev === '0010' && !(x[0] < 0)) return 'float'
      }
      // the diode states consistent with x (the present ones first); rounding at a boundary can leave every
      // combination violated by ~1e-12 A — then the least violated one (a gated switch always gives iL a path)
      const prevD = prev && prev !== 'float' ? prev.slice(2) : '00'
      const order = [prevD, '00', '10', '01', '11'].filter((d, k, a) => a.indexOf(d) === k && !(g === '00' && d === '00'))
      let best = ''
      let bestV = Infinity
      for (const d of order) {
        const v = bidiViolation(p, g + d, x)
        if (v === 0) {
          best = g + d
          bestV = 0
          break
        }
        if (v < bestV) {
          bestV = v
          best = g + d
        }
      }
      if (g === '00' && bestV > 1e-9 * Math.max(1, Math.abs(p.irefSigned))) return 'float'
      sysOf(best)
      return best
    },
  }
}

/** Average-model (CCM, no dead time) operating point — textbook values. */
export function bidiIdeal(p: ResolvedBidi) {
  const vlv = p.d * p.vhv
  const il = (vlv - p.eb) / p.rb
  return { vlv, il, ihv: p.d * il }
}

export interface BidiMetrics {
  vlvAvg: number
  vlvMax: number
  vlvMin: number
  ilAvg: number
  ilMax: number
  ilMin: number
  ibAvg: number
  ihvAvg: number
  phvAvg: number
  plvAvg: number
  pbatAvg: number
  prbAvg: number
  losses: { sw: number; dio: number; dcr: number; esr: number; total: number }
  efficiency: number
  /** Fraction of the period an antiparallel diode conducts. */
  diodeFraction: number
}

export interface BidiExact {
  x0: number[]
  segments: Array<{ t0: number; t1: number; mode: string }>
  newtonIterations: number
  residual: number
  metrics: BidiMetrics
}

export function bidiExact(p: ResolvedBidi): BidiExact {
  const sys = bidiPwl(p)
  const g = bidiIdeal(p)
  const scale = [Math.max(Math.abs(g.il), (p.vhv * 0.25) / (p.l * p.fs), 1e-3), Math.max(p.eb, g.vlv, 1e-3)]
  const fp = periodicFixedPoint(sys, p.ts, [g.il, g.vlv], scale, (x) => sys.mode(x, p.ts * 1e-9, ''))
  const x0 = fp.x
  const m0 = sys.mode(x0, p.ts * 1e-9, '')
  const segs = periodSegments(sys, x0, p.ts, m0)
  for (const s of segs) sys.sys(s.mode, 0)
  const outputs = (mode: string, x: number[]) => {
    const { out } = bidiEval(p, mode, x)
    const i = mode === 'float' ? 0 : x[0]
    return {
      il: i,
      vlv: out.vlv,
      ib: out.ib,
      ihv: out.ihv,
      phv: p.vhv * out.ihv,
      plv: out.vlv * out.ib,
      pbat: p.eb * out.ib,
      prb: p.rb * out.ib * out.ib,
      psw: (p.vhv - out.vsw) * out.iq1 + out.vsw * out.iq2,
      pdio: (out.vsw - p.vhv) * out.id1 + -out.vsw * out.id2,
      pdcr: p.rl * i * i,
      pesr: p.esr * out.ic * out.ic,
      dio: (mode !== 'float' && (mode[2] === '1' || mode[3] === '1') ? 1 : 0),
    }
  }
  const { avg, max, min } = integrate(segs, x0, sys.lin, outputs)
  const losses = { sw: avg.psw, dio: avg.pdio, dcr: avg.pdcr, esr: avg.pesr, total: 0 }
  losses.total = losses.sw + losses.dio + losses.dcr + losses.esr
  const buck = avg.phv >= 0
  const pOut = buck ? avg.plv : -avg.phv
  const dioT = segs.filter((s) => s.mode !== 'float' && (s.mode[2] === '1' || s.mode[3] === '1')).reduce((a, s) => a + s.t1 - s.t0, 0)
  return {
    x0,
    segments: segs,
    newtonIterations: fp.iterations,
    residual: fp.residual,
    metrics: {
      vlvAvg: avg.vlv,
      vlvMax: max.vlv,
      vlvMin: min.vlv,
      ilAvg: avg.il,
      ilMax: max.il,
      ilMin: min.il,
      ibAvg: avg.ib,
      ihvAvg: avg.ihv,
      phvAvg: avg.phv,
      plvAvg: avg.plv,
      pbatAvg: avg.pbat,
      prbAvg: avg.prb,
      losses,
      efficiency: pOut / (pOut + losses.total),
      diodeFraction: dioT / p.ts,
    },
  }
}

export function bidiTextbook(p: ResolvedBidi): Record<string, TextbookValue> {
  const D = p.d
  const ideal = p.devices === 'ideal' && p.rl === 0 && p.deadTime === 0
  const base = ['ideal switches (no drop), conducting in both directions', 'complementary gating without dead time', 'periodic steady state']
  const nonIdeal = ideal ? undefined : p.deadTime > 0 ? 'Dead time: a diode sets the switch-node voltage for part of the period, so the effective duty differs from D (see the exact theory).' : 'Non-ideal devices or DCR: only an approximation here (see the exact theory).'
  const rSeries = p.rb + p.rl + p.q.ron
  const vlv = D * p.vhv
  const il = (vlv - p.eb) / rSeries
  const di = (p.vhv * D * (1 - D)) / (p.l * p.fs)
  const out: Record<string, TextbookValue> = {}
  out.vlvAvg = { key: 'vlvAvg', value: D * p.vhv - (p.rl + p.q.ron) * il, formula: 'VLV = D·VHV − (Ron + DCR)·IL ≈ D·VHV', assumptions: [...base, 'volt-second balance on L'], notApplicable: p.deadTime > 0 ? nonIdeal : undefined }
  out.ilAvg = { key: 'ilAvg', value: il, formula: 'IL = (D·VHV − Eb)/(Rb + DCR + Ron)  (+ charging, − discharging)', assumptions: [...base, 'average model: the switch node averages to D·VHV'], notApplicable: p.deadTime > 0 ? nonIdeal : undefined }
  out.ibAvg = { ...out.ilAvg, key: 'ibAvg', formula: 'Ib = IL (C carries no average current)' }
  out.ihvAvg = { key: 'ihvAvg', value: D * il, formula: 'IHV = VLV·IL/VHV = D·IL (power balance, lossless)', assumptions: [...base, 'lossless converter'], notApplicable: nonIdeal }
  out.phvAvg = { key: 'phvAvg', value: vlv * il, formula: 'PHV = VHV·IHV = VLV·IL (+ bus → battery, − battery → bus)', assumptions: [...base, 'lossless converter'], notApplicable: nonIdeal }
  out.ilPP = { key: 'ilPP', value: di, formula: 'ΔiL = (VHV − VLV)·D/(L·fs) = VHV·D·(1 − D)/(L·fs)', assumptions: [...base, 'constant VLV over a period'], notApplicable: nonIdeal }
  out.ilMax = { key: 'ilMax', value: il + di / 2, formula: 'IL,max = IL + ΔiL/2', assumptions: base, notApplicable: nonIdeal }
  out.ilMin = { key: 'ilMin', value: il - di / 2, formula: 'IL,min = IL − ΔiL/2 (may be negative: the current reverses inside the period, no DCM)', assumptions: base, notApplicable: nonIdeal }
  const xc = 1 / (2 * Math.PI * p.fs * p.c)
  out.vlvPP = {
    key: 'vlvPP',
    value: di / (8 * p.c * p.fs),
    formula: 'ΔVLV = ΔiL/(8·C·fs)',
    assumptions: ['all of the ripple current flows into C (1/(2π·fs·C) ≪ Rb)', 'no ESR'],
    notApplicable: p.esr > 0 ? 'ESR > 0 adds ΔiL·ESR.' : xc > 0.2 * p.rb ? `1/(2π·fs·C) = ${(xc * 1e3).toFixed(1)} mΩ is not small against Rb: part of the ripple flows into the battery.` : undefined,
  }
  out.efficiency = { key: 'efficiency', value: 1, formula: 'η = 100 %', assumptions: ['ideal (lossless) components'], notApplicable: 'Ron, DCR, ESR and the diodes dissipate power.' }
  return out
}

export function bidiSettlePeriods(p: ResolvedBidi): number {
  const on = linearize(2, (x) => bidiEval(p, '1000', x).dx)
  const off = linearize(2, (x) => bidiEval(p, '0100', x).dx)
  const D = p.d
  const A = on.A.map((row, i) => row.map((v, j) => D * v + (1 - D) * off.A[i][j]))
  const b = on.b.map((v, i) => D * v + (1 - D) * off.b[i])
  const g = bidiIdeal(p)
  // two states and a cheaper step: a longer start-up stays interactive
  return settle(A, b, [0, p.eb], p.ts, [Math.max(Math.abs(g.il), p.iref, 0.5), Math.max(p.eb, 1e-3)], 2 * START_MAX)
}

export { IDEAL_RON }
