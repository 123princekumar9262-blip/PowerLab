/**
 * Induction machines — explicit steady-state relations used by the 3D Machines Lab (three-phase squirrel-cage,
 * wound-rotor and single-phase models). Each relation is a standard textbook one, unit-tested in
 * tests/machines-induction.test.ts. These are calculations, not a simulation: the Drives lab simulates the
 * three-phase machine (its validated dynamic model settles onto exactly this equivalent circuit).
 *
 * A result the inputs cannot support (a load above the pull-out torque, a slip outside the range) is null —
 * never an invented number.
 */

// ── The basic relations ─────────────────────────────────────────────────────────────────────────────
/** Synchronous speed Ns = 120·f / P [rpm] (P = number of poles). */
export const syncRpm = (f: number, poles: number) => (120 * f) / poles
/** Slip s = (Ns − Nr) / Ns. */
export const slipOf = (ns: number, nr: number) => (ns - nr) / ns
/** Rotor speed Nr = (1 − s)·Ns. */
export const rotorRpm = (ns: number, s: number) => (1 - s) * ns
/** Frequency of the rotor currents f2 = s·f (the rate at which the field slips past the rotor, in electrical Hz). */
export const rotorFreq = (s: number, f: number) => s * f
/** Mechanical synchronous speed ωs = 2π·Ns/60 = 4π·f/P [rad/s]. */
export const syncRad = (f: number, poles: number) => (4 * Math.PI * f) / poles

// ── Complex arithmetic (tiny, local) ─────────────────────────────────────────────────────────────────
interface Cx {
  re: number
  im: number
}
const cx = (re: number, im = 0): Cx => ({ re, im })
const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im)
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const inv = (a: Cx): Cx => {
  const d = a.re * a.re + a.im * a.im
  return cx(a.re / d, -a.im / d)
}
const abs = (a: Cx) => Math.hypot(a.re, a.im)

// ── Three-phase machine: the per-phase equivalent circuit ────────────────────────────────────────────
/**
 * Per-phase parameters (star connection, values referred to the stator). Inductances, so that the reactances
 * follow the supply frequency: X = 2π·f·L.
 */
export interface ImCircuit {
  r1: number
  r2: number
  l1: number
  l2: number
  lm: number
}

/**
 * Default machine: the same 4 kW, 400 V, 50 Hz, 4-pole example as the Drives lab simulation
 * (Rs = 1.405 Ω, Rr' = 1.395 Ω, Lls = Llr' = 5.839 mH, Lm = 172.2 mH; at 50 Hz X1 = X2' ≈ 1.83 Ω, Xm ≈ 54.1 Ω).
 */
export const IM_EXAMPLE: ImCircuit = { r1: 1.405, r2: 1.395, l1: 5.839e-3, l2: 5.839e-3, lm: 0.1722 }
/** Rated line voltage and frequency of the example; the supply keeps V/f constant (V = 400·f/50, no boost). */
export const IM_RATED = { vll: 400, f: 50 }
export const vPhaseVf = (f: number) => (IM_RATED.vll / Math.sqrt(3)) * (f / IM_RATED.f)

export interface ImPoint {
  s: number
  /** Synchronous and rotor speed [rpm]. */
  ns: number
  nr: number
  /** Stator (line = phase, star) and referred rotor current, RMS [A]. */
  i1: number
  i2: number
  pf: number
  /** Electromagnetic torque [N·m]. */
  te: number
  /** Powers [W]: input, stator copper, air gap, rotor copper (incl. any external rotor resistance), mechanical. */
  pin: number
  pcu1: number
  pag: number
  pcu2: number
  pmech: number
  /** Rotor power-factor angle φ2 = atan(s·X2/R2) [rad]: how far the rotor current lags its EMF. */
  phi2: number
}

/**
 *   V ── R1 ── jX1 ──┬── jX2 ── R2/s ──┐
 *                   jXm                │      T = 3·I2²·(R2/s) / ωs   (= Pag/ωs)
 *   ─────────────────┴─────────────────┘
 * The rotor branch is written as the admittance s/(R2 + j·s·X2) so that s = 0 is allowed. `rext` is an extra
 * rotor resistance per phase, referred to the stator (wound rotor; 0 for a cage).
 */
export function imPoint(m: ImCircuit, f: number, v: number, poles: number, s: number, rext = 0): ImPoint {
  const w = 2 * Math.PI * f
  const r2 = m.r2 + rext
  const x2 = w * m.l2
  const y2 = mul(cx(s), inv(cx(r2, s * x2)))
  const ym = cx(0, -1 / (w * m.lm))
  const zp = inv(add(y2, ym))
  const z = add(cx(m.r1, w * m.l1), zp)
  const i1 = mul(cx(v), inv(z))
  const e = mul(i1, zp)
  const i2 = mul(e, y2)
  const I1 = abs(i1)
  const I2 = abs(i2)
  const E = abs(e)
  // I2²·R2/s written without dividing by s: E²·s·R2 / (R2² + s²·X2²)
  const pag = (3 * E * E * s * r2) / (r2 * r2 + s * s * x2 * x2)
  const ws = syncRad(f, poles)
  const ns = syncRpm(f, poles)
  const pin = 3 * v * i1.re
  return {
    s,
    ns,
    nr: rotorRpm(ns, s),
    i1: I1,
    i2: I2,
    pf: I1 > 0 ? pin / (3 * v * I1) : 0,
    te: pag / ws,
    pin,
    pcu1: 3 * I1 * I1 * m.r1,
    pag,
    pcu2: 3 * I2 * I2 * r2,
    pmech: (1 - s) * pag,
    phi2: Math.atan2(s * x2, r2),
  }
}

/**
 * Pull-out (breakdown) torque, exact for this circuit via the Thevenin equivalent seen by the rotor branch:
 *   s_max = R2/√(Rth² + (Xth + X2)²),   T_max = 3·Vth² / (2·ωs·(Rth + √(Rth² + (Xth + X2)²)))
 * T_max does not depend on R2; s_max is proportional to it.
 */
export function imBreakdown(m: ImCircuit, f: number, v: number, poles: number, rext = 0) {
  const w = 2 * Math.PI * f
  const zs = cx(m.r1, w * m.l1)
  const zm = cx(0, w * m.lm)
  const k = mul(zm, inv(add(zs, zm)))
  const vth = abs(k) * v
  const zth = mul(zs, k)
  const x = zth.im + w * m.l2
  const root = Math.hypot(zth.re, x)
  const sMax = (m.r2 + rext) / root
  const tMax = (3 * vth * vth) / (2 * syncRad(f, poles) * (zth.re + root))
  return { sMax, tMax, vth, rth: zth.re, xth: zth.im }
}

/**
 * The stable operating point for a constant load torque TL: on 0 ≤ s ≤ min(s_max, 1) the torque rises
 * monotonically with s, so Te(s) = TL has one root there (bisection). Null when TL exceeds what the motor can
 * give on that branch (it would stall). Friction, windage and core loss are neglected.
 */
export function imOperating(m: ImCircuit, f: number, v: number, poles: number, tl: number, rext = 0): ImPoint | null {
  if (!(f > 0 && v > 0 && poles > 0 && tl >= 0)) return null
  const { sMax } = imBreakdown(m, f, v, poles, rext)
  const sHi = Math.min(sMax, 1)
  if (imPoint(m, f, v, poles, sHi, rext).te < tl) return null
  let lo = 0
  let hi = sHi
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi)
    if (imPoint(m, f, v, poles, mid, rext).te < tl) lo = mid
    else hi = mid
  }
  return imPoint(m, f, v, poles, 0.5 * (lo + hi), rext)
}

// ── Single-phase machine: the double-revolving-field equivalent circuit ─────────────────────────────
/**
 * Illustrative small 230 V, 50 Hz capacitor-start motor (about 0.3 kW at 4 poles; main winding only, values at
 * 50 Hz, referred to the main winding): R1 = 6 Ω, X1 = 8 Ω, R2' = 12 Ω, X2' = 6 Ω, Xm = 180 Ω. Not a specific product.
 */
export const SPIM_EXAMPLE = { r1: 6, x1: 8, r2: 12, x2: 6, xm: 180, v: 230, f: 50 }
export type SpCircuit = typeof SPIM_EXAMPLE

export interface SpPoint {
  s: number
  ns: number
  nr: number
  i1: number
  pf: number
  /** Forward and backward air-gap powers [W], their torques and the net torque [N·m]. */
  pagF: number
  pagB: number
  tf: number
  tb: number
  te: number
  pin: number
  pcu1: number
  /** Rotor copper loss: s·PagF + (2 − s)·PagB [W]. */
  pcu2: number
  pmech: number
  /** Rotor frequencies of the forward and backward fields [Hz]. */
  f2f: number
  f2b: number
}

/**
 * Main winding alone. The pulsating field = two half-amplitude fields turning in opposite directions; the rotor
 * has slip s to the forward one and (2 − s) to the backward one:
 *   ZF = ½·[jXm ∥ (R2/s + jX2)],  ZB = ½·[jXm ∥ (R2/(2−s) + jX2)],  I1 = V / (R1 + jX1 + ZF + ZB)
 *   PagF = I1²·Re ZF,  PagB = I1²·Re ZB,  T = (PagF − PagB)/ωs,  Pmech = (1 − s)·(PagF − PagB)
 * The frequency scales the reactances; the voltage follows V/f (230 V at 50 Hz).
 */
export function spPoint(m: SpCircuit, f: number, poles: number, s: number): SpPoint {
  const k = f / m.f
  const v = m.v * k
  const x1 = m.x1 * k
  const x2 = m.x2 * k
  const xm = m.xm * k
  const half = (sx: number): Cx => {
    // ½·[jXm ∥ (R2/sx + jX2)] written as ½ / (1/(jXm) + sx/(R2 + j·sx·X2))  (sx = 0 allowed)
    const y = add(cx(0, -1 / xm), mul(cx(sx), inv(cx(m.r2, sx * x2))))
    return mul(cx(0.5), inv(y))
  }
  const zf = half(s)
  const zb = half(2 - s)
  const z = add(add(cx(m.r1, x1), zf), zb)
  const i = mul(cx(v), inv(z))
  const I = abs(i)
  const pagF = I * I * zf.re
  const pagB = I * I * zb.re
  const ws = syncRad(f, poles)
  const ns = syncRpm(f, poles)
  const pin = v * i.re
  return {
    s,
    ns,
    nr: rotorRpm(ns, s),
    i1: I,
    pf: I > 0 ? pin / (v * I) : 0,
    pagF,
    pagB,
    tf: pagF / ws,
    tb: pagB / ws,
    te: (pagF - pagB) / ws,
    pin,
    pcu1: I * I * m.r1,
    pcu2: s * pagF + (2 - s) * pagB,
    pmech: (1 - s) * (pagF - pagB),
    f2f: s * f,
    f2b: (2 - s) * f,
  }
}

/** The slip of peak net torque on 0 < s < 1 (golden-section search). */
export function spPeak(m: SpCircuit, f: number, poles: number) {
  let a = 1e-4
  let b = 1
  const g = 0.5 * (Math.sqrt(5) - 1)
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  for (let i = 0; i < 100; i++) {
    if (spPoint(m, f, poles, c).te > spPoint(m, f, poles, d).te) b = d
    else a = c
    c = b - g * (b - a)
    d = a + g * (b - a)
  }
  const s = 0.5 * (a + b)
  return { sMax: s, tMax: spPoint(m, f, poles, s).te }
}

/**
 * Running operating point (main winding only, after the centrifugal switch has opened): Te(s) = TL on the
 * stable branch between the no-load slip (Te = 0, s slightly above 0) and the peak. Null if TL exceeds the peak.
 */
export function spOperating(m: SpCircuit, f: number, poles: number, tl: number): SpPoint | null {
  if (!(f > 0 && poles > 0 && tl >= 0)) return null
  const { sMax, tMax } = spPeak(m, f, poles)
  if (tl > tMax) return null
  let lo = 0
  let hi = sMax
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi)
    if (spPoint(m, f, poles, mid).te < tl) lo = mid
    else hi = mid
  }
  return spPoint(m, f, poles, 0.5 * (lo + hi))
}
