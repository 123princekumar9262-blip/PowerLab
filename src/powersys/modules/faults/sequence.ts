import { A_OP, add, C, div, mul, neg, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'

/**
 * Symmetrical components and the fault equations at a single point.
 *
 * Any three phasors (x_a, x_b, x_c) are the sum of three balanced sets: a zero-sequence set (three equal phasors),
 * a positive-sequence set (a-b-c, 120° apart) and a negative-sequence set (a-c-b). With the operator a = 1∠120°:
 *   x_a = x₀ + x₁ + x₂      x_b = x₀ + a²·x₁ + a·x₂      x_c = x₀ + a·x₁ + a²·x₂
 *   x₀ = (x_a + x_b + x_c)/3   x₁ = (x_a + a·x_b + a²·x_c)/3   x₂ = (x_a + a²·x_b + a·x_c)/3
 * Phase a is the reference phase: a line-to-ground fault is on phase a; line-to-line and double line-to-ground
 * faults are between phases b and c (the usual textbook choice, which keeps the equations symmetric in a).
 */

/** Three complex numbers: sequence order [0, 1, 2] or phase order [a, b, c] (the name says which). */
export type Trio = [Complex, Complex, Complex]

export const A2: Complex = mul(A_OP, A_OP)

/** Phase quantities → sequence components [x₀, x₁, x₂]. */
export function toSeq([xa, xb, xc]: Trio): Trio {
  return [scale(add(add(xa, xb), xc), 1 / 3), scale(add(add(xa, mul(A_OP, xb)), mul(A2, xc)), 1 / 3), scale(add(add(xa, mul(A2, xb)), mul(A_OP, xc)), 1 / 3)]
}

/** Sequence components [x₀, x₁, x₂] → phase quantities [x_a, x_b, x_c]. */
export function toPhase([x0, x1, x2]: Trio): Trio {
  return [add(add(x0, x1), x2), add(add(x0, mul(A2, x1)), mul(A_OP, x2)), add(add(x0, mul(A_OP, x1)), mul(A2, x2))]
}

/** The three balanced sets of a sequence decomposition, each as phase a, b, c phasors. */
export function sequenceSets([x0, x1, x2]: Trio): { zero: Trio; pos: Trio; neg: Trio } {
  return {
    zero: [x0, x0, x0],
    pos: [x1, mul(A2, x1), mul(A_OP, x1)],
    neg: [x2, mul(A_OP, x2), mul(A2, x2)],
  }
}

export type FaultType = '3ph' | 'slg' | 'll' | 'dlg'
export const FAULT_TYPES: FaultType[] = ['3ph', 'slg', 'll', 'dlg']
export const FAULT_LABEL: Record<FaultType, string> = {
  '3ph': 'Three-phase',
  slg: 'Line-to-ground',
  ll: 'Line-to-line',
  dlg: 'Double line-to-ground',
}
export const FAULT_SHORT: Record<FaultType, string> = { '3ph': 'LLL', slg: 'LG', ll: 'LL', dlg: 'LLG' }
/** Which phases a fault involves (phase a is the reference). */
export const FAULT_PHASES: Record<FaultType, string> = { '3ph': 'a, b, c', slg: 'a to earth', ll: 'b to c', dlg: 'b and c to earth' }

/** The currents and voltages at a fault: sequence and phase, in per unit. Currents flow out of the network into the fault. */
export interface PointFault {
  i012: Trio
  v012: Trio
  iabc: Trio
  vabc: Trio
}

/**
 * A fault at one point of a network, from the Thevenin impedances seen there in each sequence (Z₁, Z₂, Z₀) and the
 * pre-fault voltage V_f. `z0 = null` means there is no zero-sequence path at that point (an unearthed system):
 * no earth-fault current can flow. Fault impedance Z_f:
 *   three-phase: each phase to a common point through Z_f      I₁ = V_f / (Z₁ + Z_f)
 *   line-to-ground (a): a to earth through Z_f                 I₀ = I₁ = I₂ = V_f / (Z₁ + Z₂ + Z₀ + 3Z_f)
 *   line-to-line (b–c): b to c through Z_f                     I₁ = −I₂ = V_f / (Z₁ + Z₂ + Z_f),  I₀ = 0
 *   double line-to-ground (b, c): b and c joined, to earth through Z_f
 *       I₁ = V_f / (Z₁ + Z₂‖(Z₀ + 3Z_f)),  I₂ = −I₁·(Z₀ + 3Z_f)/(Z₂ + Z₀ + 3Z_f),  I₀ = −I₁·Z₂/(Z₂ + Z₀ + 3Z_f)
 * and the sequence voltages at the fault are V₁ = V_f − Z₁I₁, V₂ = −Z₂I₂, V₀ = −Z₀I₀.
 */
export function faultAtPoint(type: FaultType, vf: Complex, z1: Complex, z2: Complex, z0: Complex | null, zf: Complex = ZERO): PointFault {
  let i0 = ZERO
  let i1 = ZERO
  let i2 = ZERO
  let v0: Complex | null = null
  if (type === '3ph') {
    i1 = div(vf, add(z1, zf))
  } else if (type === 'slg') {
    if (z0) {
      i1 = div(vf, add(add(add(z1, z2), z0), scale(zf, 3)))
      i0 = i1
      i2 = i1
    } else {
      // no earth return: no current; phase a is pulled to earth potential, so the neutral shifts by −V_f
      v0 = neg(vf)
    }
  } else if (type === 'll') {
    i1 = div(vf, add(add(z1, z2), zf))
    i2 = neg(i1)
  } else {
    if (z0) {
      const zz = add(z0, scale(zf, 3))
      const par = div(mul(z2, zz), add(z2, zz))
      i1 = div(vf, add(z1, par))
      i2 = neg(div(mul(i1, zz), add(z2, zz)))
      i0 = neg(div(mul(i1, z2), add(z2, zz)))
    } else {
      // no earth return: a bolted b–c fault; b and c are pulled to earth potential (V₀ = V₁)
      i1 = div(vf, add(z1, z2))
      i2 = neg(i1)
    }
  }
  const v1 = sub(vf, mul(z1, i1))
  const v2 = neg(mul(z2, i2))
  if (v0 === null) v0 = z0 ? neg(mul(z0, i0)) : type === 'dlg' ? v1 : ZERO
  const i012: Trio = [i0, i1, i2]
  const v012: Trio = [v0, v1, v2]
  return { i012, v012, iabc: toPhase(i012), vabc: toPhase(v012) }
}

/** Rotate the positive- and negative-sequence parts by ±φ (degrees): the phase shift of a Y–d transformer. */
export function shiftSeq([x0, x1, x2]: Trio, deg: number): Trio {
  if (deg === 0) return [x0, x1, x2]
  const r = (deg * Math.PI) / 180
  const e = C(Math.cos(r), Math.sin(r))
  const ec = C(Math.cos(r), -Math.sin(r))
  return [x0, mul(x1, e), mul(x2, ec)]
}
