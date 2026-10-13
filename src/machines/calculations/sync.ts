/**
 * Synchronous machines — explicit steady-state relations used by the 3D Machines Lab (alternator and synchronous
 * motor). Textbook per-phase models of a round-rotor (cylindrical) machine, star connected, balanced three-phase:
 * no saturation, no saliency, no iron, friction, windage or excitation losses. A result the inputs cannot support is
 * null (e.g. a motor loaded beyond its pull-out torque has no steady state). Tested in tests/machines-sync.test.ts.
 */

const SQRT3 = Math.sqrt(3)
/** The EMF factor 2π/√2 = √2·π ≈ 4.44 of E = 4.44·kw·N·f·Φ. */
export const EMF_FACTOR = Math.SQRT2 * Math.PI

/** Electrical frequency of a synchronous machine: f = P·n / 120 (P = total number of poles, n in rpm). */
export const syncFrequency = (poles: number, n: number) => (poles * n) / 120
/** Synchronous speed: Ns = 120·f / P [rpm]. */
export const syncSpeedRpm = (f: number, poles: number) => (120 * f) / poles
/** RMS EMF per phase of a distributed winding: E = √2·π·kw·N·f·Φ (≈ 4.44·kw·N·f·Φ). */
export const phaseEmf = (kw: number, turns: number, f: number, flux: number) => EMF_FACTOR * kw * turns * f * flux

// ── Alternator feeding a balanced resistive load (star, per phase) ───────────────────────────────────────
export interface AlternatorIn {
  /** Total number of poles. */
  poles: number
  /** Shaft speed set by the prime mover [rpm]. */
  n: number
  /** Field (excitation) current [A]. */
  ifield: number
  /** Flux per pole per field ampere [Wb/A] — linear magnetic circuit (no saturation). */
  kf: number
  /** Series turns per phase. */
  turns: number
  /** Winding factor (distribution × pitch). */
  kw: number
  /** Synchronous reactance per phase [Ω]. */
  xs: number
  /** Armature resistance per phase [Ω]. */
  ra: number
  /** Load resistance per phase (star) [Ω]. */
  rl: number
}

/**
 * E = V + I·(Ra + jXs), with a resistive load I is in phase with V:
 *   I = E / |(Ra + RL) + jXs|,  V = I·RL,  δ = atan(I·Xs / (V + I·Ra)) (angle by which E leads V),
 *   Pout = 3·V·I,  Pcu = 3·I²·Ra,  Pmech = Pout + Pcu (other losses neglected),  T = Pmech / ω.
 */
export function alternator(p: AlternatorIn) {
  if (!(p.poles > 0 && p.n > 0 && p.turns > 0 && p.kw > 0 && p.rl > 0 && p.xs >= 0 && p.ra >= 0 && p.ifield >= 0 && p.kf >= 0)) return null
  const f = syncFrequency(p.poles, p.n)
  const w = (2 * Math.PI * p.n) / 60
  const flux = p.kf * p.ifield
  const e = phaseEmf(p.kw, p.turns, f, flux)
  const z = Math.hypot(p.ra + p.rl, p.xs)
  const i = e / z
  const v = i * p.rl
  const delta = e > 0 ? Math.atan2(i * p.xs, v + i * p.ra) : 0
  const pout = 3 * v * i
  const pcu = 3 * i * i * p.ra
  const pmech = pout + pcu
  return { f, w, flux, e, eLine: SQRT3 * e, i, v, vLine: SQRT3 * v, delta, pout, pcu, pmech, torque: pmech / w, eff: pmech > 0 ? pout / pmech : null }
}

// ── Synchronous motor on an infinite bus (round rotor, Ra neglected) ───────────────────────────────────
export interface SyncMotorIn {
  /** Line-to-line supply voltage [V] (star: Vph = VL/√3). */
  vline: number
  f: number
  poles: number
  /** Excitation EMF per phase [V], set by the field current. */
  e: number
  xs: number
  /** Load torque on the shaft [N·m]. */
  tl: number
}

/**
 * Motor convention V = E + jXs·I, E lagging V by the load angle δ:
 *   P = 3·V·E·sin δ / Xs = T·ωs,  Pmax = 3·V·E / Xs (δ = 90°),
 *   I = (E·sin δ)/Xs − j (V − E·cos δ)/Xs,   Q = 3·V·(V − E·cos δ)/Xs (> 0 absorbed: lagging, under-excited).
 * Above the pull-out torque there is no steady state: the result says so and the operating values are null.
 */
export function syncMotor(p: SyncMotorIn) {
  if (!(p.vline > 0 && p.f > 0 && p.poles > 0 && p.e > 0 && p.xs > 0 && p.tl >= 0)) return null
  const v = p.vline / SQRT3
  const ns = syncSpeedRpm(p.f, p.poles)
  const ws = (2 * Math.PI * ns) / 60
  const pmax = (3 * v * p.e) / p.xs
  const tmax = pmax / ws
  const pout = p.tl * ws
  const s = pout / pmax
  if (s > 1) return { pullOut: true as const, v, ns, ws, pmax, tmax, pout: null, delta: null, i: null, q: null, pf: null, leading: null }
  const delta = Math.asin(s)
  const ire = (p.e * Math.sin(delta)) / p.xs
  const iim = -(v - p.e * Math.cos(delta)) / p.xs
  const i = Math.hypot(ire, iim)
  const q = (3 * v * (v - p.e * Math.cos(delta))) / p.xs
  const sMag = 3 * v * i
  const pf = sMag > 1e-12 ? pout / sMag : null
  return { pullOut: false as const, v, ns, ws, pmax, tmax, pout, delta, i, q, pf, leading: q < 0 }
}
