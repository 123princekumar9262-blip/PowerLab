import { exactPwl } from '../pwl.ts'
import {
  lamOf,
  magCurrentOf,
  oscStart,
  regionOfMode,
  shootPeriodic,
  XfAccumulator,
  xfBreakpoints,
  xfDerived,
  xfMode,
  xfRegionOf,
  xfReversal,
  xfSatTime,
  xfScales,
  xfSteadyGuess,
  xfSystem,
  type ResolvedXf,
  type XfPeriodStats,
} from './transformer.ts'

/**
 * TRANSFORMER THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT: the same piecewise-linear T-equivalent circuit solved analytically region by region (matrix
 *    exponential, converters/pwl.ts exactPwl), every entry into saturation and every reversal of the secondary
 *    current found on the exact flow; the periodic steady state as the fixed point of the exact one-period map;
 *    period means and RMS values by 5-point Gauss–Legendre quadrature of the exact solution on every smooth
 *    piece (between the drive's edges and the core's region changes).
 * 2. TEXTBOOK:
 *      ideal transformer  V2 = V1·N2/N1,  N1·i1 = N2·i2 + N1·im  (i1 = i2·N2/N1 + im)
 *      square drive ±V    ΔB = V·(T/2)/(N1·Ae),  îm = V·T/(4·Lm)  (the R·i and leakage drops neglected)
 *      sine drive         B̂ = V̂/(ω·N1·Ae),  Îm = V̂m/(ω·Lm), and the full linear phasor solution
 *      DC offset          I1dc = Voff/R1 (exact in steady state: no winding can hold a mean voltage),
 *                         Bdc = Lm·I1dc/(N1·Ae)
 *      leakage (square)   the referred load current reverses through Ll1 + Ll2' (+ LL') with
 *                         τ = (Ll1 + Ls)/(R1 + Rs): t_rev = τ·ln(1 + tanh(T/(4τ))) ≈ τ·ln 2, and the RMS
 *                         load current drops (Lm neglected)
 *      energy             P1 = P2 + R1·I1² + R2·I2²  (no core loss modelled)
 */
const GL_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664]
const GL_W = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891]

export interface XfExact extends XfPeriodStats {
  ratio: number
  regulation: number
  eff: number
  balance: number
  pf: number
  iPeakRun: number
  bPeakRun: number
  tSat: number | null
  /** The exact periodic state at the start of a period (steady view). */
  x0: number[]
}

/** Exact statistics of the period [t0, t0 + T] starting from state x0. */
export function periodExact(p: ResolvedXf, x0: number[], t0: number): XfPeriodStats {
  const T = p.period
  const t1 = t0 + T
  const bps = xfBreakpoints(p, t0, t1)
  const sys = xfSystem(p, bps)
  const mode0 = xfMode(p, x0, '')
  // 1. the exact solution on the simulation's sample grid: extremes, region changes, the current reversal
  const grid = Array.from({ length: p.stepsPerPeriod }, (_, k) => t0 + ((k + 1) * T) / p.stepsPerPeriod)
  const ex = exactPwl(sys, x0, t0, grid, mode0)
  const acc = new XfAccumulator(p)
  acc.point(x0)
  for (const y of ex.x) acc.point(y)
  // 2. Gauss–Legendre on every smooth piece: split at the edges and at the core's region changes
  const cuts = [t0, ...bps, ...ex.events.filter((e) => regionOfMode(e.from) !== regionOfMode(e.to)).map((e) => e.t), t1].sort((a, b) => a - b)
  const nodes: Array<{ t: number; w: number }> = []
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = cuts[c]
    const b = cuts[c + 1]
    if (!(b - a > 1e-12 * T)) continue
    // panels no wider than T/64 nor than the leakage time constant (the fastest transient of the circuit), but
    // at least T/1000 (a transient shorter than that is far below what the time step resolves anyway)
    const K = Math.max(1, Math.ceil((b - a) / Math.min(T / 64, Math.max(p.tauLk, T / 1000))))
    const h = (b - a) / K
    for (let q = 0; q < K; q++) for (let g = 0; g < 5; g++) nodes.push({ t: a + q * h + 0.5 * h * (1 + GL_X[g]), w: 0.5 * h * GL_W[g] })
  }
  nodes.sort((a, b) => a.t - b.t)
  const gx = exactPwl(sys, x0, t0, nodes.map((n) => n.t), mode0)
  nodes.forEach((n, i) => acc.weight(gx.x[i], n.w, n.t, xfRegionOf(p, lamOf(p, gx.x[i]))))
  return acc.stats(T, xfSatTime(ex.events, mode0, t0, t1) / T, xfReversal(p, ex.events, t0))
}

/** The exact periodic steady state at t = 0 (Newton on the exact one-period map). */
export function exactSteadyStart(p: ResolvedXf): number[] {
  const osc = p.source === 'sine' ? oscStart(p.phase) : []
  const sys1 = xfSystem(p, xfBreakpoints(p, 0, p.period))
  const map = (x: number[]) => {
    const x0 = [...x, ...osc]
    return exactPwl(sys1, x0, 0, [p.period], xfMode(p, x0, '')).x[0].slice(0, 2)
  }
  return [...shootPeriodic(map, xfSteadyGuess(p), xfScales(p)).x, ...osc]
}

export function exactXf(p: ResolvedXf): XfExact {
  if (p.view === 'steady') {
    const x0 = exactSteadyStart(p)
    const st = periodExact(p, x0, 0)
    return { ...st, ...xfDerived(p, st), iPeakRun: st.i1Max, bPeakRun: st.bpk, tSat: null, x0 }
  }
  // start-up: from rest, sampled at the simulation's instants (the peaks are compared at the same instants)
  const x0 = p.source === 'sine' ? [0, 0, ...oscStart(p.phase)] : [0, 0]
  const sys = xfSystem(p)
  const n = p.periods * p.stepsPerPeriod
  const times = Array.from({ length: n }, (_, k) => ((k + 1) * p.duration) / n)
  const ex = exactPwl(sys, x0, 0, times, xfMode(p, x0, ''))
  let iPeakRun = 0
  let bPeakRun = 0
  for (const y of ex.x) {
    iPeakRun = Math.max(iPeakRun, Math.abs(magCurrentOf(p, lamOf(p, y)) + y[1]))
    bPeakRun = Math.max(bPeakRun, Math.abs(y[0]))
  }
  const kLast = (p.periods - 1) * p.stepsPerPeriod - 1
  const xLast = kLast >= 0 ? ex.x[kLast] : x0
  const st = periodExact(p, xLast, (p.periods - 1) * p.period)
  const firstSat = ex.events.find((e) => regionOfMode(e.to) !== 'lin' && regionOfMode(e.from) === 'lin')
  return { ...st, ...xfDerived(p, st), iPeakRun, bPeakRun, tSat: firstSat ? firstSat.t : null, x0 }
}

// ── Textbook ───────────────────────────────────────────────────────────────

interface C {
  re: number
  im: number
}
const cx = (re: number, im = 0): C => ({ re, im })
const add = (a: C, b: C): C => cx(a.re + b.re, a.im + b.im)
const mul = (a: C, b: C): C => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
const abs = (a: C) => Math.hypot(a.re, a.im)

export interface XfTextbook {
  /** Ideal transformer: V2 = V1·N2/N1 (RMS of the AC part). */
  v2Ideal: number
  v1rms: number
  v2rms: number | null
  i2rms: number
  i1rms: number
  imPk: number
  dB: number
  bdc: number
  bpk: number
  i1dc: number
  p2: number
  p1: number
  eff: number
  regulation: number | null
  /** Square drive: reversal time of the load current (Lm neglected). */
  tRev: number | null
  /** Bpk > Bsat by the linear formulas. */
  saturates: boolean
  /** From rest: the first half-period's flux (doubling) and when it reaches Bsat (drops neglected). */
  bFirst: number
  tSat: number | null
}

export function textbookXf(p: ResolvedXf): XfTextbook {
  const na = p.n1 * p.ae
  const T = p.period
  const i1dc = p.voff / p.r1
  const bdc = (p.lm * i1dc) / na
  const rtot = p.r1 + p.rs
  const ltot = p.ll1 + p.ls
  const resistive = p.lload === 0
  let v2rms: number | null
  let i2r2: number // mean square of the referred secondary current
  let imPk: number
  let dB: number
  let tRev: number | null = null
  let imRms2: number
  let p1ac: number | null = null
  let i1ac2: number | null = null // mean square of the AC primary current (sine: exact phasor)
  let bFirst: number
  let tSat: number | null
  if (p.source === 'square') {
    const tau = ltot / rtot
    const H = T / 2
    const k = Math.tanh(T / (4 * tau))
    const iInf = p.v / rtot
    // mean of i² for i(t) = I∞·(1 − (1 + k)·e^(−t/τ)) over a half-period
    i2r2 = iInf * iInf * (1 - 2 * (1 + k) * (tau / H) * (1 - Math.exp(-H / tau)) + (1 + k) ** 2 * (tau / (2 * H)) * (1 - Math.exp(-2 * H / tau)))
    tRev = tau * Math.log(1 + k)
    imPk = (p.v * T) / (4 * p.lm)
    imRms2 = (imPk * imPk) / 3
    dB = (p.v * H) / na
    v2rms = resistive ? (p.rlr * Math.sqrt(i2r2)) / p.a : null
    bFirst = dB
    tSat = dB > p.bsat ? (na * p.bsat) / p.v : null
  } else {
    const w = p.omega
    const z1 = cx(p.r1, w * p.ll1)
    const zm = cx(0, w * p.lm)
    const z2 = cx(p.rs, w * p.ls)
    const zp = div(mul(zm, z2), add(zm, z2))
    const v1 = cx(p.v)
    const i1 = div(v1, add(z1, zp))
    const vm = mul(i1, zp)
    const i2 = div(vm, z2)
    const im = div(vm, zm)
    const v2 = div(mul(i2, cx(p.rlr, w * p.llr)), cx(p.a))
    i2r2 = (abs(i2) * abs(i2)) / 2
    imPk = abs(im)
    imRms2 = (imPk * imPk) / 2
    dB = (2 * abs(vm)) / (w * na)
    tRev = null
    v2rms = abs(v2) / Math.SQRT2
    p1ac = 0.5 * (v1.re * i1.re + v1.im * i1.im)
    i1ac2 = (abs(i1) * abs(i1)) / 2
    // from rest at a voltage zero: λ = (V̂/ω)·(1 − cos ωt) peaks at 2·V̂/ω (flux doubling)
    bFirst = (2 * p.v) / (w * na)
    const ph = (p.phase * Math.PI) / 180
    // λ(t) = (V̂/ω)·(cos φ − cos(ωt + φ)) reaches λs first at …
    const target = Math.cos(ph) - (p.lamS * w) / p.v
    tSat = target >= -1 && (p.v / w) * (Math.cos(ph) + 1) > p.lamS ? (Math.acos(Math.max(-1, Math.min(1, target))) - ph) / w : null
    if (tSat !== null && !(tSat > 0)) tSat = null
  }
  const i2rms = Math.sqrt(i2r2) * p.a
  // square: load and magnetising currents are orthogonal over the period (square × triangle); sine: the phasor
  const i1rms = Math.sqrt((i1ac2 ?? i2r2 + imRms2) + i1dc * i1dc)
  const p2 = p.rlr * i2r2
  const pcu = p.r1 * i1rms * i1rms + p.r2r * i2r2
  const p1 = p1ac !== null ? p1ac + p.voff * i1dc : p2 + pcu
  const v1rms = Math.sqrt((p.source === 'square' ? p.v * p.v : (p.v * p.v) / 2) + p.voff * p.voff)
  const v2Ideal = (v1rms * p.n2) / p.n1
  const bpk = Math.abs(bdc) + dB / 2
  return {
    v2Ideal,
    v1rms,
    v2rms,
    i2rms,
    i1rms,
    imPk,
    dB,
    bdc,
    bpk,
    i1dc,
    p2,
    p1,
    eff: p2 / p1,
    regulation: v2rms !== null ? 1 - v2rms / v2Ideal : null,
    tRev,
    saturates: bpk > p.bsat,
    bFirst,
    tSat,
  }
}
