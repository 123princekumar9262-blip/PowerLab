import { abs, add, arg, C, conj, deg, div, mul, ONE, polarDeg, rad, scale, sub, sum, ZERO, type Complex } from '../../engine/complex.ts'

/*
 * Module 2 — the calculations behind every number on the page (no React, so the tests can call them directly).
 *
 * Conventions: phasors are RMS values; the instantaneous value is v(t) = √2·|V|·sin(ωt + θ) — the vertical
 * projection of the rotating phasor. Phase sequence a-b-c (R-Y-B): V_b lags V_a by 120°, V_c lags by 240°.
 * Line quantities are three-phase: P in MW, V line-to-line in kV, per-phase V = V_LL/√3; currents in kA.
 */

export const SQRT3 = Math.sqrt(3)

// ── complex functions the shared engine does not have ────────────────────────────────────────────────────────

/** Principal square root (Re ≥ 0). */
export function csqrt(z: Complex): Complex {
  const r = abs(z)
  const re = Math.sqrt(Math.max(0, (r + z.re) / 2))
  const im = Math.sqrt(Math.max(0, (r - z.re) / 2))
  return C(re, z.im < 0 ? -im : im)
}
export const ccosh = (z: Complex): Complex => C(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im))
export const csinh = (z: Complex): Complex => C(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im))
export const angDeg = (z: Complex): number => deg(arg(z))
/** Wrap an angle to (−180°, 180°]. */
export const wrapDeg = (a: number): number => {
  let x = ((a + 180) % 360) - 180
  if (x <= -180) x += 360
  return x
}

// ── 1 · a three-phase set ─────────────────────────────────────────────────────────────────────────────────────

export interface PhaseSet {
  a: Complex
  b: Complex
  c: Complex
}

/** A balanced a-b-c set of RMS magnitude `v`, phase a at `thetaDeg`. */
export function balancedSet(v: number, thetaDeg = 0): PhaseSet {
  return { a: polarDeg(v, thetaDeg), b: polarDeg(v, thetaDeg - 120), c: polarDeg(v, thetaDeg + 120) }
}

/** A set with phase b disturbed: its magnitude scaled by `bScale` and its angle shifted by `bShiftDeg`. */
export function disturbedSet(v: number, bScale: number, bShiftDeg: number): PhaseSet {
  return { a: polarDeg(v, 0), b: polarDeg(v * bScale, -120 + bShiftDeg), c: polarDeg(v, 120) }
}

export const setSum = (s: PhaseSet): Complex => sum([s.a, s.b, s.c])

/** The instantaneous value of an RMS phasor at angle ωt [rad]: √2·|X|·sin(ωt + θ). */
export const inst = (x: Complex, wt: number): number => Math.SQRT2 * abs(x) * Math.sin(wt + arg(x))

/** Samples of one cycle, ωt from 0 to 2π (n + 1 points). */
export function cycle(n = 180): number[] {
  return Array.from({ length: n + 1 }, (_, k) => (2 * Math.PI * k) / n)
}

// ── 2 · star and delta ────────────────────────────────────────────────────────────────────────────────────────

export type Conn = 'star' | 'delta'

/** A balanced load of `zOhm`∠`phiDeg` per phase, `conn`-connected, on a supply of line-to-line `vLine` (RMS). */
export interface LoadSolution {
  conn: Conn
  /** Phase voltages to neutral of the supply (a balanced a-b-c set, V_a at 0°). */
  vPh: PhaseSet
  /** Line-to-line voltages V_ab, V_bc, V_ca. */
  vLine: PhaseSet
  /** The voltage across each load impedance (star: phase-to-neutral; delta: line-to-line). */
  vZ: PhaseSet
  /** Current in each load impedance (star: I_a, I_b, I_c; delta: I_ab, I_bc, I_ca). */
  iZ: PhaseSet
  /** Line currents I_a, I_b, I_c. */
  iLine: PhaseSet
  /** Complex power per impedance and total (VA, W, var). */
  sPhase: Complex
  sTotal: Complex
  phiDeg: number
}

export function solveLoad(vLine: number, zOhm: number, phiDeg: number, conn: Conn): LoadSolution {
  const vPh = balancedSet(vLine / SQRT3, 0)
  const vL: PhaseSet = { a: sub(vPh.a, vPh.b), b: sub(vPh.b, vPh.c), c: sub(vPh.c, vPh.a) }
  const z = polarDeg(zOhm, phiDeg)
  const vZ = conn === 'star' ? vPh : vL
  const iZ: PhaseSet = { a: div(vZ.a, z), b: div(vZ.b, z), c: div(vZ.c, z) }
  // delta: KCL at each line terminal — I_a = I_ab − I_ca
  const iLine = conn === 'star' ? iZ : { a: sub(iZ.a, iZ.c), b: sub(iZ.b, iZ.a), c: sub(iZ.c, iZ.b) }
  const sPhase = mul(vZ.a, conj(iZ.a))
  const sTotal = sum([mul(vZ.a, conj(iZ.a)), mul(vZ.b, conj(iZ.b)), mul(vZ.c, conj(iZ.c))])
  return { conn, vPh, vLine: vL, vZ, iZ, iLine, sPhase, sTotal, phiDeg }
}

/** Star ↔ delta for a balanced load: Z_Y = Z_Δ / 3. */
export const deltaToStar = (zDelta: Complex): Complex => scale(zDelta, 1 / 3)
export const starToDelta = (zStar: Complex): Complex => scale(zStar, 3)

// ── 3 · power ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PowerSummary {
  vL: number
  iL: number
  vPh: number
  iPh: number
  /** Per-phase P, Q, S. */
  p1: number
  q1: number
  s1: number
  p: number
  q: number
  s: number
  pf: number
  /** √3·V_L·I_L·cos φ computed from line quantities (should equal p). */
  pFromLine: number
}

export function powerSummary(l: LoadSolution): PowerSummary {
  const vL = abs(l.vLine.a)
  const iL = abs(l.iLine.a)
  const vPh = abs(l.vZ.a)
  const iPh = abs(l.iZ.a)
  const cosPhi = Math.cos(rad(l.phiDeg))
  return {
    vL,
    iL,
    vPh,
    iPh,
    p1: l.sPhase.re,
    q1: l.sPhase.im,
    s1: abs(l.sPhase),
    p: l.sTotal.re,
    q: l.sTotal.im,
    s: abs(l.sTotal),
    pf: l.sTotal.re / abs(l.sTotal),
    pFromLine: SQRT3 * vL * iL * cosPhi,
  }
}

/** Instantaneous power in each impedance and their sum, over one cycle. */
export function instantaneousPower(l: LoadSolution, n = 180) {
  return cycle(n).map((wt) => {
    const pa = inst(l.vZ.a, wt) * inst(l.iZ.a, wt)
    const pb = inst(l.vZ.b, wt) * inst(l.iZ.b, wt)
    const pc = inst(l.vZ.c, wt) * inst(l.iZ.c, wt)
    return { wt, pa, pb, pc, total: pa + pb + pc }
  })
}

/** Single-phase instantaneous power v·i for an RMS V and I with I lagging by φ: V·I·cos φ − V·I·cos(2ωt − φ) (sine convention). */
export function singlePhasePower(v: number, i: number, phiDeg: number, n = 180) {
  const phi = rad(phiDeg)
  return cycle(n).map((wt) => ({ wt, p: Math.SQRT2 * v * Math.sin(wt) * Math.SQRT2 * i * Math.sin(wt - phi) }))
}

// ── 4 · transmission lines ────────────────────────────────────────────────────────────────────────────────────

export type LineModel = 'short' | 'medium' | 'long'
export const MODEL_LABEL: Record<LineModel, string> = {
  short: 'Short (series Z)',
  medium: 'Medium (nominal π)',
  long: 'Long (exact)',
}

/** Per-km constants of one phase of an overhead line (shunt conductance neglected). */
export interface LineConstants {
  rOhmPerKm: number
  xOhmPerKm: number
  /** Shunt susceptance [µS/km]. */
  bUsPerKm: number
}

export interface LinePreset extends LineConstants {
  id: string
  kv: number
  label: string
}

/** Typical 50 Hz overhead-line constants (assumed, illustrative — real lines vary with conductor and tower). */
export const LINE_PRESETS: LinePreset[] = [
  { id: '132', kv: 132, label: '132 kV', rOhmPerKm: 0.16, xOhmPerKm: 0.4, bUsPerKm: 2.85 },
  { id: '220', kv: 220, label: '220 kV', rOhmPerKm: 0.075, xOhmPerKm: 0.4, bUsPerKm: 2.85 },
  { id: '400', kv: 400, label: '400 kV', rOhmPerKm: 0.03, xOhmPerKm: 0.33, bUsPerKm: 3.5 },
]

export interface Abcd {
  A: Complex
  B: Complex
  C: Complex
  D: Complex
}

export interface LineParams {
  z: Complex
  y: Complex
  /** Propagation constant γ = α + jβ per km. */
  gamma: Complex
  /** Characteristic impedance √(z/y) [Ω]. */
  zc: Complex
  /** Surge impedance of the same line without losses √(x/b) [Ω]. */
  zcLossless: number
  /** Total series impedance and shunt admittance. */
  Z: Complex
  Y: Complex
}

export function lineParams(k: LineConstants, lengthKm: number): LineParams {
  const z = C(k.rOhmPerKm, k.xOhmPerKm)
  const y = C(0, k.bUsPerKm * 1e-6)
  return {
    z,
    y,
    gamma: csqrt(mul(z, y)),
    zc: csqrt(div(z, y)),
    zcLossless: Math.sqrt(k.xOhmPerKm / (k.bUsPerKm * 1e-6)),
    Z: scale(z, lengthKm),
    Y: scale(y, lengthKm),
  }
}

export function abcdShort(Z: Complex): Abcd {
  return { A: ONE, B: Z, C: ZERO, D: ONE }
}

/** Nominal π: half the shunt admittance at each end of the series impedance. */
export function abcdNominalPi(Z: Complex, Y: Complex): Abcd {
  const half = scale(mul(Z, Y), 0.5)
  const A = add(ONE, half)
  return { A, B: Z, C: mul(Y, add(ONE, scale(mul(Z, Y), 0.25))), D: A }
}

/** The exact distributed-parameter solution of a uniform line of length l. */
export function abcdLong(gamma: Complex, zc: Complex, lengthKm: number): Abcd {
  const gl = scale(gamma, lengthKm)
  const ch = ccosh(gl)
  const sh = csinh(gl)
  return { A: ch, B: mul(zc, sh), C: div(sh, zc), D: ch }
}

export function lineAbcd(k: LineConstants, lengthKm: number, model: LineModel): Abcd {
  const p = lineParams(k, lengthKm)
  if (model === 'short') return abcdShort(p.Z)
  if (model === 'medium') return abcdNominalPi(p.Z, p.Y)
  return abcdLong(p.gamma, p.zc, lengthKm)
}

/** Two two-ports in cascade (first then second). */
export function cascade(m: Abcd, n: Abcd): Abcd {
  return {
    A: add(mul(m.A, n.A), mul(m.B, n.C)),
    B: add(mul(m.A, n.B), mul(m.B, n.D)),
    C: add(mul(m.C, n.A), mul(m.D, n.C)),
    D: add(mul(m.C, n.B), mul(m.D, n.D)),
  }
}

/** AD − BC (= 1 for any passive reciprocal two-port). */
export const det = (m: Abcd): Complex => sub(mul(m.A, m.D), mul(m.B, m.C))

/** A line built from N equal nominal-π sections in cascade. */
export function abcdSections(k: LineConstants, lengthKm: number, n: number): Abcd {
  const p = lineParams(k, lengthKm / n)
  const one = abcdNominalPi(p.Z, p.Y)
  let m = one
  for (let i = 1; i < n; i++) m = cascade(m, one)
  return m
}

/** What the load at the receiving end draws: three-phase MW, power factor, lagging (inductive) or leading. */
export interface LineLoad {
  pMw: number
  pf: number
  lagging: boolean
}

export interface LinePerformance {
  abcd: Abcd
  /** Per-phase receiving and sending voltages [kV] and currents [kA]. */
  vr: Complex
  ir: Complex
  vs: Complex
  is: Complex
  /** Line-to-line magnitudes [kV]. */
  vrLL: number
  vsLL: number
  /** Load angle: V_s leads V_r by δ [°]. */
  deltaDeg: number
  /** Three-phase powers [MW, Mvar]. */
  pr: number
  qr: number
  ps: number
  qs: number
  lossMw: number
  efficiencyPct: number
  /** Receiving-end voltage at no load with the same V_s: |V_s| / |A| [kV line-to-line]. */
  vrNoLoadLL: number
  regulationPct: number
}

/** Sending-end quantities from the receiving-end voltage (line-to-line kV) and load. */
export function linePerformance(m: Abcd, vrKvLL: number, load: LineLoad): LinePerformance {
  const vr = C(vrKvLL / SQRT3, 0)
  const qMvar = load.pf >= 1 ? 0 : load.pMw * Math.tan(Math.acos(load.pf)) * (load.lagging ? 1 : -1)
  const sPhase = C(load.pMw / 3, qMvar / 3)
  const ir = conj(div(sPhase, vr))
  const vs = add(mul(m.A, vr), mul(m.B, ir))
  const is = add(mul(m.C, vr), mul(m.D, ir))
  const ss = scale(mul(vs, conj(is)), 3)
  const sr = scale(mul(vr, conj(ir)), 3)
  const vsLL = abs(vs) * SQRT3
  const vrNoLoadLL = vsLL / abs(m.A)
  return {
    abcd: m,
    vr,
    ir,
    vs,
    is,
    vrLL: vrKvLL,
    vsLL,
    deltaDeg: angDeg(vs) - angDeg(vr),
    pr: sr.re,
    qr: sr.im,
    ps: ss.re,
    qs: ss.im,
    lossMw: ss.re - sr.re,
    efficiencyPct: ss.re > 0 ? (sr.re / ss.re) * 100 : NaN,
    vrNoLoadLL,
    regulationPct: ((vrNoLoadLL - vrKvLL) / vrKvLL) * 100,
  }
}

/**
 * The voltage along the line from the exact distributed solution: at distance x from the receiving end,
 * V(x) = cosh(γx)·V_r + Z_c·sinh(γx)·I_r. Returned against the distance from the sending end [km], line-to-line kV.
 */
export function voltageProfile(p: LineParams, lengthKm: number, vr: Complex, ir: Complex, n = 120): Array<{ dKm: number; vLL: number }> {
  return Array.from({ length: n + 1 }, (_, k) => {
    const x = (lengthKm * (n - k)) / n
    const gx = scale(p.gamma, x)
    const v = add(mul(ccosh(gx), vr), mul(mul(p.zc, csinh(gx)), ir))
    return { dKm: lengthKm - x, vLL: abs(v) * SQRT3 }
  })
}

/** Surge impedance loading: V_LL² / Z_c (lossless surge impedance) [MW for kV and Ω]. */
export const sil = (kvLL: number, zcOhm: number): number => (kvLL * kvLL) / zcOhm

/** β·l [rad] of the line without losses: ω√(LC)·l = √(x·b)·l. */
export const betaL = (k: LineConstants, lengthKm: number): number => Math.sqrt(k.xOhmPerKm * k.bUsPerKm * 1e-6) * lengthKm

/** Receiving-end voltage rise at no load on a lossless line: V_r / V_s = 1 / cos βl. */
export const ferrantiLossless = (bl: number): number => 1 / Math.cos(bl)

/**
 * Receiving-end three-phase power for sending and receiving voltages (line-to-line kV) and load angle δ, from the
 * ABCD constants (the receiving-end power circle): S_r = 3·V_r·conj((V_s − A·V_r)/B).
 */
export function receivingPower(m: Abcd, vsLL: number, vrLL: number, deltaDeg: number): Complex {
  const vr = C(vrLL / SQRT3, 0)
  const vs = polarDeg(vsLL / SQRT3, deltaDeg)
  const ir = div(sub(vs, mul(m.A, vr)), m.B)
  return scale(mul(vr, conj(ir)), 3)
}

/** The same by the circle formula: P_r = |Vs||Vr|/|B|·cos(β_B − δ) − |A||Vr|²/|B|·cos(β_B − α_A) (line-to-line kV → MW). */
export function receivingPowerCircle(m: Abcd, vsLL: number, vrLL: number, deltaDeg: number): number {
  const bb = arg(m.B)
  const aa = arg(m.A)
  const B = abs(m.B)
  return ((vsLL * vrLL) / B) * Math.cos(bb - rad(deltaDeg)) - ((abs(m.A) * vrLL * vrLL) / B) * Math.cos(bb - aa)
}

/** The largest receiving-end power (at δ = β_B). */
export function maxReceivingPower(m: Abcd, vsLL: number, vrLL: number): { pMw: number; deltaDeg: number } {
  const bb = arg(m.B)
  return { pMw: receivingPowerCircle(m, vsLL, vrLL, deg(bb)), deltaDeg: deg(bb) }
}

/** The simple power–angle law P = V_s·V_r·sin δ / X (resistance and capacitance neglected). */
export const powerAngle = (vsLL: number, vrLL: number, xOhm: number, deltaDeg: number): number => ((vsLL * vrLL) / xOhm) * Math.sin(rad(deltaDeg))

/** Charging reactive power of the line at rated voltage with the shunt capacitance alone: V_LL² · B_total [Mvar]. */
export const chargingMvar = (kvLL: number, k: LineConstants, lengthKm: number): number => kvLL * kvLL * k.bUsPerKm * 1e-6 * lengthKm

/** For a lossless line (r = 0) of the same x and b. */
export const lossless = (k: LineConstants): LineConstants => ({ ...k, rOhmPerKm: 0 })

/** The largest relative difference between two ABCD sets (|ΔX| / max(|X|, tiny)). */
export function abcdDiff(m: Abcd, n: Abcd): number {
  return Math.max(...(['A', 'B', 'C', 'D'] as const).map((k) => abs(sub(m[k], n[k])) / Math.max(abs(n[k]), 1e-12)))
}

/** Percentage change from b to a. */
export const pctOf = (a: number, b: number) => ((a - b) / b) * 100
