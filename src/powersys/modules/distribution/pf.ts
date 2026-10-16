/*
 * Power-factor correction of a balanced three-phase load with a shunt capacitor bank. Every number computed:
 *  · Q_c = P (tan φ₁ − tan φ₂); the line current, kVA and the capacitance per phase for a star or a delta bank;
 *  · the most economical final power factor when the tariff charges x per kVA of maximum demand per year and the
 *    capacitors cost y per kVAr per year: sin φ₂ = y/x (closed form) — checked by numerical minimisation;
 *  · a simple feeder model (a source of fixed voltage behind R + jX per phase) solved exactly, to show the loss
 *    reduction and the voltage rise that correction brings.
 * Power factors are lagging unless `lead` says otherwise; a leading final power factor is over-correction.
 */

export type Connection = 'star' | 'delta'

export interface PfInput {
  /** Real power of the load [kW]. */
  P: number
  /** Initial power factor (lagging). */
  pf1: number
  /** Target power factor and whether it is leading (over-corrected). */
  pf2: number
  lead2: boolean
  /** Line-to-line voltage at the load [V]. */
  VLL: number
  /** Supply frequency [Hz]. */
  f: number
}

export interface PfOk {
  ok: true
  /** Angles [rad]; φ₂ is negative when the final power factor is leading. */
  phi1: number
  phi2: number
  /** Reactive powers [kVAr] (Q₂ negative when leading) and the bank's rating Q_c. */
  Q1: number
  Q2: number
  Qc: number
  /** Apparent powers [kVA]. */
  S1: number
  S2: number
  /** Line currents at the rated voltage [A]. */
  I1: number
  I2: number
  /** Fractional change of the line current (negative = it falls). */
  dI: number
  /** Capacitance per phase [µF] and the voltage across each phase's capacitor [V]. */
  Cstar: number
  Cdelta: number
  VcapStar: number
  VcapDelta: number
  /** Current in each capacitor [A]: star (= line current of the bank) and delta (phase current). */
  IcapStar: number
  IcapDelta: number
  /** Line current drawn by the bank [A]. */
  IbankLine: number
}
export interface PfErr {
  ok: false
  message: string
  field: 'P' | 'pf1' | 'pf2' | 'V' | 'f'
}
export type PfResult = PfOk | PfErr

export const omega = (f: number) => 2 * Math.PI * f

export function validatePf(p: PfInput): PfErr | null {
  if (!(p.P > 0)) return { ok: false, field: 'P', message: 'The load’s real power must be positive.' }
  if (!(p.pf1 > 0 && p.pf1 <= 1)) return { ok: false, field: 'pf1', message: 'The initial power factor must lie between 0 and 1.' }
  if (!(p.pf2 > 0 && p.pf2 <= 1)) return { ok: false, field: 'pf2', message: 'The target power factor must lie between 0 and 1.' }
  if (!p.lead2 && p.pf2 < p.pf1 - 1e-12)
    return {
      ok: false,
      field: 'pf2',
      message: `A capacitor bank can only raise a lagging power factor: the target ${p.pf2} lagging is below the load’s own ${p.pf1}. Lowering it would need a reactor, not a capacitor.`,
    }
  if (!(p.VLL > 0)) return { ok: false, field: 'V', message: 'The line voltage must be positive.' }
  if (!(p.f > 0)) return { ok: false, field: 'f', message: 'The frequency must be positive.' }
  return null
}

/** Size the capacitor bank and compare before and after. */
export function pfCorrection(p: PfInput): PfResult {
  const bad = validatePf(p)
  if (bad) return bad
  const phi1 = Math.acos(p.pf1)
  const phi2 = (p.lead2 ? -1 : 1) * Math.acos(p.pf2)
  const Q1 = p.P * Math.tan(phi1)
  const Q2 = p.P * Math.tan(phi2)
  const Qc = Q1 - Q2
  const S1 = p.P / p.pf1
  const S2 = p.P / p.pf2
  const I1 = (S1 * 1000) / (Math.sqrt(3) * p.VLL)
  const I2 = (S2 * 1000) / (Math.sqrt(3) * p.VLL)
  const w = omega(p.f)
  const Vph = p.VLL / Math.sqrt(3)
  // Q_c = 3·V²·ωC with V the voltage across each capacitor (V_ph in star, V_LL in delta)
  const Cstar = ((Qc * 1000) / (3 * w * Vph * Vph)) * 1e6
  const Cdelta = ((Qc * 1000) / (3 * w * p.VLL * p.VLL)) * 1e6
  const IbankLine = (Qc * 1000) / (Math.sqrt(3) * p.VLL)
  return {
    ok: true,
    phi1,
    phi2,
    Q1,
    Q2,
    Qc,
    S1,
    S2,
    I1,
    I2,
    dI: I2 / I1 - 1,
    Cstar,
    Cdelta,
    VcapStar: Vph,
    VcapDelta: p.VLL,
    IcapStar: Vph * w * Cstar * 1e-6,
    IcapDelta: p.VLL * w * Cdelta * 1e-6,
    IbankLine,
  }
}

/** Capacitance per phase [µF] for a bank of Q_c kVAr. */
export const capPerPhase = (QcKvar: number, VLL: number, f: number, conn: Connection) => {
  const Vc = conn === 'star' ? VLL / Math.sqrt(3) : VLL
  return ((QcKvar * 1000) / (3 * omega(f) * Vc * Vc)) * 1e6
}
/** The reactive power [kVAr] that a bank of C µF per phase gives at a line voltage V_LL. */
export const kvarOf = (CuF: number, VLL: number, f: number, conn: Connection) => {
  const Vc = conn === 'star' ? VLL / Math.sqrt(3) : VLL
  return (3 * Vc * Vc * omega(f) * CuF * 1e-6) / 1000
}

// ── the most economical power factor ───────────────────────────────────────────────────────────────────────────

export interface Tariff {
  /** Maximum-demand charge [₹ per kVA per year]. */
  x: number
  /** Annual cost of the capacitors (interest, depreciation, upkeep) [₹ per kVAr per year]. */
  y: number
}

/** Annual cost [₹/yr] of the kVA charge plus the capacitors, if the power factor is corrected from φ₁ to φ₂ (lagging). */
export function annualCost(P: number, pf1: number, pf2: number, t: Tariff): { kva: number; cap: number; total: number } {
  const phi1 = Math.acos(pf1)
  const phi2 = Math.acos(pf2)
  const kva = (t.x * P) / pf2
  const cap = t.y * P * (Math.tan(phi1) - Math.tan(phi2))
  return { kva, cap, total: kva + cap }
}

export interface EconomicPf {
  /** The cheapest final power factor (lagging). */
  pf: number
  /** Why: 'interior' — sin φ₂ = y/x; 'none' — correction never pays (y/x ≥ sin φ₁); 'unity' — capacitors free (y = 0). */
  kind: 'interior' | 'none' | 'unity'
  /** sin φ₂ = y/x (may exceed 1 when y > x). */
  ratio: number
}

/** The closed form: minimise x·P/cos φ₂ + y·P·(tan φ₁ − tan φ₂) → sin φ₂ = y/x, if that is below sin φ₁. */
export function economicPf(pf1: number, t: Tariff): EconomicPf {
  const ratio = t.x > 0 ? t.y / t.x : Infinity
  if (t.y <= 0) return { pf: 1, kind: 'unity', ratio: 0 }
  const sin1 = Math.sqrt(1 - pf1 * pf1)
  if (ratio >= sin1) return { pf: pf1, kind: 'none', ratio }
  return { pf: Math.sqrt(1 - ratio * ratio), kind: 'interior', ratio }
}

/** The second method: golden-section search for the cheapest φ₂ in [0, φ₁] (the annual cost is convex in φ₂). */
export function economicPfNumeric(P: number, pf1: number, t: Tariff, tol = 1e-12): { pf: number; cost: number; iterations: number } {
  const f = (phi: number) => annualCost(P, pf1, Math.cos(phi), t).total
  let a = 0
  let b = Math.acos(pf1)
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  let fc = f(c)
  let fd = f(d)
  let it = 0
  while (b - a > tol && it < 400) {
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - g * (b - a)
      fc = f(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + g * (b - a)
      fd = f(d)
    }
    it++
  }
  // the ends are candidates too (the minimum may sit at a boundary)
  const cands = [0, (a + b) / 2, Math.acos(pf1)]
  const best = cands.reduce((p, q) => (f(q) < f(p) ? q : p))
  return { pf: Math.cos(best), cost: f(best), iterations: it }
}

// ── a simple feeder: fixed source voltage behind R + jX per phase ──────────────────────────────────────────────

export interface Feeder {
  /** Source (sending-end) line voltage, held fixed [V]. */
  VsLL: number
  /** Per-phase series resistance and reactance of the feeder [Ω]. */
  R: number
  X: number
  /** Voltage at which the capacitor bank's kVAr is rated [V] (its kVAr scales with (V/V_rated)²). */
  VratedLL: number
}

export interface FeederOk {
  ok: true
  /** Receiving-end line voltage [V]. */
  VrLL: number
  /** Line current [A], copper loss in the feeder (three phases) [kW]. */
  I: number
  loss: number
  /** Net reactive power drawn at the receiving end (load − bank) [kVAr]; the bank's actual output [kVAr]. */
  Qnet: number
  Qbank: number
  iterations: number
  /** Sending-end voltage recomputed from V_r and I (complex KVL) [V line] — the check. */
  VsCheck: number
}
export interface FeederErr {
  ok: false
  message: string
}

/**
 * Receiving-end voltage of a feeder carrying P + jQ to the load (with a bank of Q_bank rated kVAr): with V_r as the
 * reference, |V_s|² V_r² = (V_r² + RP + XQ)² + (XP − RQ)², a quadratic in V_r² (take the larger, normal root). The
 * bank's output depends on V_r², so this is repeated until V_r settles.
 */
export function solveFeeder(fd: Feeder, Pkw: number, Qload: number, QbankRated: number): FeederOk | FeederErr {
  if (!(fd.VsLL > 0) || !(fd.R >= 0) || !(fd.X >= 0) || !(fd.VratedLL > 0)) return { ok: false, message: 'Feeder data must be positive.' }
  const Vs = fd.VsLL / Math.sqrt(3)
  const P = (Pkw * 1000) / 3
  let Vr = Vs
  let Qbank = QbankRated
  let it = 0
  for (; it < 200; it++) {
    Qbank = QbankRated * ((Vr * Math.sqrt(3)) / fd.VratedLL) ** 2
    const Q = ((Qload - Qbank) * 1000) / 3
    const bq = Vs * Vs - 2 * (P * fd.R + Q * fd.X)
    const disc = bq * bq - 4 * (P * P + Q * Q) * (fd.R * fd.R + fd.X * fd.X)
    if (disc < 0) return { ok: false, message: 'The feeder cannot deliver this load: there is no steady-state voltage (the load is beyond the feeder’s maximum power transfer).' }
    const next = Math.sqrt((bq + Math.sqrt(disc)) / 2)
    if (Math.abs(next - Vr) < 1e-12 * Vs) {
      Vr = next
      break
    }
    Vr = next
  }
  Qbank = QbankRated * ((Vr * Math.sqrt(3)) / fd.VratedLL) ** 2
  const Q = ((Qload - Qbank) * 1000) / 3
  const I = Math.hypot(P, Q) / Vr
  // complex KVL check: V_s = V_r + (R + jX)(P − jQ)/V_r
  const re = Vr + (fd.R * P + fd.X * Q) / Vr
  const im = (fd.X * P - fd.R * Q) / Vr
  return { ok: true, VrLL: Vr * Math.sqrt(3), I, loss: (3 * I * I * fd.R) / 1000, Qnet: Qload - Qbank, Qbank, iterations: it + 1, VsCheck: Math.hypot(re, im) * Math.sqrt(3) }
}

/** Illustrative defaults: a 200 kW factory at 0.7 lagging on 400 V, 50 Hz; tariff and feeder values are illustrative. */
export const DEFAULT_PF: PfInput = { P: 200, pf1: 0.7, pf2: 0.95, lead2: false, VLL: 400, f: 50 }
export const DEFAULT_TARIFF: Tariff = { x: 2400, y: 480 }
export const DEFAULT_FEEDER: Feeder = { VsLL: 415, R: 0.02, X: 0.015, VratedLL: 400 }
