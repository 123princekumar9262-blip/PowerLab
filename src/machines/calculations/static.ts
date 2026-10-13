/**
 * Static devices of the 3D Machines Lab (transformers, autotransformer, gapped inductor) — explicit, standard
 * steady-state relations, each unit-tested in tests/machines-static.test.ts. These are calculations, not a
 * simulation (the Magnetics lab simulates the transformer and the gapped inductor). A value the inputs cannot
 * support is null, never invented.
 */
import { idealTransformer } from './formulas.ts'

export const MU0 = 4e-7 * Math.PI
/** The EMF-equation constant 2π/√2 ≈ 4.44 (sinusoidal flux). */
export const K_EMF = (2 * Math.PI) / Math.SQRT2
export const SQRT3 = Math.sqrt(3)

const pos = (...xs: number[]) => xs.every((x) => Number.isFinite(x) && x > 0)

// ── Single-phase transformer ─────────────────────────────────────────────────────────────────────────
/**
 * Ideal transformer (no magnetising current, no losses, no leakage) with a resistive load, plus the EMF equation
 * for the peak core flux: V1 = 4.44·f·N1·Φm (sinusoidal voltage, the winding resistance drop neglected).
 *   v1 [V rms], f [Hz], n1, n2 [turns], rl [Ω], ae [m²] (net iron cross-section).
 */
export function singlePhaseTransformer(p: { v1: number; f: number; n1: number; n2: number; rl: number; ae: number }) {
  if (!pos(p.v1, p.f, p.n1, p.n2, p.rl, p.ae)) return null
  const t = idealTransformer({ v1: p.v1, n1: p.n1, n2: p.n2, rl: p.rl })
  const phiM = p.v1 / (K_EMF * p.f * p.n1) // peak flux [Wb]
  return {
    a: t.a,
    v2: t.v2,
    i2: t.i2,
    i1: t.i1,
    s: t.p, // = V1·I1 = V2·I2 (ideal)
    rSeen: t.rSeen,
    phiM,
    bm: phiM / p.ae, // peak flux density [T]
    voltsPerTurn: p.v1 / p.n1,
    mmf1: p.n1 * t.i1, // load ampere-turns of the primary (= N2·I2)
    mmf2: p.n2 * t.i2,
  }
}

// ── Three-phase transformer ──────────────────────────────────────────────────────────────────────────
export type Conn = 'Y' | 'D'
/** Phase (winding) voltage from the line voltage: star Vph = VL/√3, delta Vph = VL. */
export const phaseVoltage = (vl: number, c: Conn) => (c === 'Y' ? vl / SQRT3 : vl)
/** Line voltage from the phase voltage: star VL = √3·Vph, delta VL = Vph. */
export const lineVoltage = (vph: number, c: Conn) => (c === 'Y' ? SQRT3 * vph : vph)
/** Phase (winding) current from the line current: star Iph = IL, delta Iph = IL/√3. */
export const phaseCurrent = (il: number, c: Conn) => (c === 'Y' ? il : il / SQRT3)
/**
 * Ideal three-phase transformer, balanced load at unity power factor of apparent power S [VA]:
 * each limb is a single-phase transformer with Vph2 = Vph1·N2/N1; S = √3·VL·IL = 3·Vph·Iph on both sides.
 * The phase displacement between primary and secondary line voltages is 0° for Yy/Dd and 30° for Yd/Dy
 * (its sign — lead or lag — depends on how the windings are joined: e.g. Dyn11 vs Dyn1).
 */
export function threePhaseTransformer(p: { vl1: number; n1: number; n2: number; c1: Conn; c2: Conn; s: number }) {
  if (!pos(p.vl1, p.n1, p.n2) || !(p.s >= 0)) return null
  const vph1 = phaseVoltage(p.vl1, p.c1)
  const vph2 = (vph1 * p.n2) / p.n1
  const vl2 = lineVoltage(vph2, p.c2)
  const il1 = p.s / (SQRT3 * p.vl1)
  const il2 = p.s / (SQRT3 * vl2)
  return {
    vph1,
    vph2,
    vl2,
    lineRatio: p.vl1 / vl2,
    turnsRatio: p.n1 / p.n2,
    il1,
    iph1: phaseCurrent(il1, p.c1),
    il2,
    iph2: phaseCurrent(il2, p.c2),
    shiftDeg: p.c1 === p.c2 ? 0 : 30,
    sPerPhase: p.s / 3,
  }
}

// ── Autotransformer (step-down) ──────────────────────────────────────────────────────────────────────
/**
 * Ideal step-down autotransformer: N1 turns from the input terminal to the common terminal, a tap N2 turns from
 * the common terminal (N2 ≤ N1), a resistive load RL on the tap.
 *   V2 = V1·N2/N1 = k·V1, I2 = V2/RL, I1 = k·I2, common-section current Ic = I2 − I1,
 *   S = V2·I2, transformed S_t = S·(1 − k), conducted S_c = S·k,
 *   copper (same current density and mean turn) relative to a two-winding transformer of the same rating = 1 − k.
 * Null when the tap is outside the winding (N2 > N1) or an input is not positive.
 */
export function autotransformer(p: { v1: number; n1: number; n2: number; rl: number }) {
  if (!pos(p.v1, p.n1, p.n2, p.rl) || p.n2 > p.n1) return null
  const k = p.n2 / p.n1
  const v2 = p.v1 * k
  const i2 = v2 / p.rl
  const i1 = k * i2
  const ic = i2 - i1
  const s = v2 * i2
  return {
    k,
    v2,
    i2,
    i1,
    ic,
    s,
    sTransformed: s * (1 - k),
    sConducted: s * k,
    /** Series-section ampere-turns N_s·I1 equal common-section ampere-turns N2·Ic (ideal). */
    mmfSeries: (p.n1 - p.n2) * i1,
    mmfCommon: p.n2 * ic,
    copperRatio: 1 - k,
  }
}

// ── Gapped inductor ──────────────────────────────────────────────────────────────────────────────────
/**
 * A winding of N turns on a core of effective length le, relative permeability μr and cross-section Ae, with an
 * air gap lg in the magnetic path (same area in core and gap: fringing neglected; linear core below saturation).
 *   ℛ = (lg + le/μr) / (μ0·Ae),  L = N²/ℛ = N²·μ0·Ae / (lg + le/μr),  W = ½·L·I²,
 *   B = μ0·N·I / (lg + le/μr),  Isat = Bsat·(lg + le/μr) / (μ0·N),
 *   fraction of the energy stored in the gap = lg / (lg + le/μr).
 * Units: ae [m²], le, lg [m], i [A], bsat [T]. lg may be 0 (ungapped core). Null when the inputs cannot support it.
 */
export function gappedInductor(p: { n: number; ae: number; le: number; lg: number; mur: number; i: number; bsat: number }) {
  if (!pos(p.n, p.ae, p.le, p.mur, p.bsat) || !(p.lg >= 0) || !(p.i >= 0)) return null
  const lEff = p.lg + p.le / p.mur // magnetic length referred to air [m]
  const rel = lEff / (MU0 * p.ae) // reluctance [A/Wb]
  const l = (p.n * p.n) / rel // [H]
  const b = (MU0 * p.n * p.i) / lEff // [T]
  const isat = (p.bsat * lEff) / (MU0 * p.n)
  const saturated = p.i > isat
  return {
    rel,
    l,
    b,
    isat,
    saturated,
    /** Energy ½·L·I² — valid only below saturation (null above: the linear model no longer holds). */
    w: saturated ? null : 0.5 * l * p.i * p.i,
    gapShare: p.lg / lEff,
    lNoGap: (p.n * p.n * MU0 * p.ae * p.mur) / p.le,
  }
}
