/**
 * Power semiconductor devices (3D Machines Lab) — explicit textbook relations, each with its assumptions stated in
 * the caller's text, unit-tested in tests/machines-semi.test.ts. These are NOT a device simulation: the Switching
 * Devices lab simulates the switching transients. A value the inputs cannot support is null, never invented.
 *
 * Units: SI unless a name says otherwise (doping in cm⁻³, lengths of the drift region in µm, fields in V/cm, as
 * device textbooks quote them).
 */

/** Elementary charge [C]. */
export const Q_E = 1.602176634e-19
/** Permittivity of silicon εSi = 11.7·ε0 [F/cm]. */
export const EPS_SI = 11.7 * 8.8541878128e-14

/**
 * Depletion of a lightly doped n− drift region next to a heavily doped p+ (or p) layer: one-sided abrupt junction,
 * full depletion approximation, built-in potential neglected against the applied blocking voltage.
 *   Non-punch-through (depletion ends inside the drift):  W = √(2·ε·V / (q·ND)),  Emax = q·ND·W/ε = 2·V/W.
 *   Punch-through (W would exceed the drift thickness Wd): the depletion fills the drift, the field is a trapezoid:
 *     Emax = V/Wd + q·ND·Wd/(2ε),  Emin = Emax − q·ND·Wd/ε  (the n+ layer behind stops it).
 * @param v blocking voltage [V] (≥ 0)   @param nd drift doping [cm⁻³]   @param wdUm drift thickness [µm]
 */
export function driftDepletion(p: { v: number; nd: number; wdUm: number }) {
  const { v, nd, wdUm } = p
  if (!(v >= 0) || !(nd > 0) || !(wdUm > 0)) return null
  const wd = wdUm * 1e-4 // cm
  const wFree = Math.sqrt((2 * EPS_SI * v) / (Q_E * nd)) // cm, if the drift were infinitely thick
  if (wFree <= wd) {
    const emax = wFree > 0 ? (2 * v) / wFree : 0
    return { punchThrough: false, wUm: wFree * 1e4, emax, emin: 0, fraction: wFree / wd }
  }
  const slope = (Q_E * nd) / EPS_SI // V/cm per cm
  const emax = v / wd + (slope * wd) / 2
  return { punchThrough: true, wUm: wdUm, emax, emin: emax - slope * wd, fraction: 1 }
}

/**
 * Piecewise-linear on-state model of a conducting device: v = V0 + r·i (V0 = threshold / knee voltage, r = slope
 * resistance). Conduction loss P = v·i = V0·i + r·i². Steady DC current, fixed junction temperature.
 */
export function linearOnState(p: { v0: number; r: number; i: number }) {
  const { v0, r, i } = p
  if (!(i >= 0) || !(r >= 0) || !(v0 >= 0)) return null
  const v = v0 + r * i
  return { v, p: v * i, pKnee: v0 * i, pRes: r * i * i }
}

/**
 * Power MOSFET in the ohmic (fully on) region: a channel exists only when VGS > Vth; then vDS = iD·RDS(on) and
 * P = iD²·RDS(on). Returns null when there is no channel (the device is off).
 */
export function mosfetOn(p: { id: number; rdson: number; vgs: number; vth: number }) {
  const { id, rdson, vgs, vth } = p
  if (!(vgs > vth) || !(rdson > 0) || !(id >= 0)) return null
  return { vds: id * rdson, p: id * id * rdson, overdrive: vgs - vth }
}

/**
 * Diode reverse recovery, triangular reverse current, abrupt ("snappy") recovery idealisation (the current returns
 * to zero quickly after its peak, tb ≪ ta) and constant di/dt (Mohan, Undeland & Robbins):
 *   Qrr = ½·Irr·trr,  Irr = di/dt·trr  ⇒  Irr = √(2·Qrr·di/dt),  trr = √(2·Qrr / (di/dt)).
 * @param qrr stored (recovered) charge [C]   @param didt rate of fall of the forward current [A/s]
 */
export function diodeRecovery(p: { qrr: number; didt: number }) {
  const { qrr, didt } = p
  if (!(qrr > 0) || !(didt > 0)) return null
  return { irr: Math.sqrt(2 * qrr * didt), trr: Math.sqrt((2 * qrr) / didt) }
}

/**
 * Thyristor two-transistor analogy (pnp Q1: p1-n1-p2, npn Q2: n2-p2-n1), common-base gains α1, α2 taken constant:
 *   IA = (α2·IG + ICBO1 + ICBO2) / (1 − (α1 + α2)).
 * While α1 + α2 < 1 the anode current is finite (forward blocking, the gate only adds a small current). As α1 + α2
 * reaches 1 the denominator vanishes: the loop is regenerative and the device latches — the current is then set by
 * the external circuit, so the formula no longer gives it (ia = null).
 */
export function scrTwoTransistor(p: { a1: number; a2: number; ig: number; ico: number }) {
  const { a1, a2, ig, ico } = p
  if (!(a1 >= 0 && a1 < 1) || !(a2 >= 0 && a2 < 1) || !(ig >= 0) || !(ico >= 0)) return null
  const loop = a1 + a2
  if (loop >= 1) return { loop, latched: true, ia: null }
  return { loop, latched: false, ia: (a2 * ig + ico) / (1 - loop) }
}

/** A latched thyristor stays on while its anode current is at least the holding current IH. */
export const scrStaysOn = (ia: number, ih: number) => ia >= ih
