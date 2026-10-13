import { A_OP, add, C, mul, neg, scale, ZERO, type Complex } from '../../engine/complex.ts'
import { solveComplex } from '../../engine/linalg.ts'
import { A2, type FaultType, type Trio } from './sequence.ts'

/**
 * An independent check of the sequence method: the same fault solved directly in phase quantities, with no
 * symmetrical components in the solution itself. A source with sequence impedances Z₀, Z₁, Z₂ is, phase by phase,
 * a balanced emf E_abc = V_f·(1, a², a) behind the 3×3 impedance matrix Z_abc = A·diag(Z₀, Z₁, Z₂)·A⁻¹. At its
 * terminals V_abc = E_abc − Z_abc·I_abc, and the fault adds three conditions on V_abc and I_abc. Six linear
 * equations in six unknowns, solved by Gaussian elimination.
 */

const A_MAT: Complex[][] = [
  [C(1), C(1), C(1)],
  [C(1), A2, A_OP],
  [C(1), A_OP, A2],
]
const A_INV: Complex[][] = [
  [C(1 / 3), C(1 / 3), C(1 / 3)],
  [C(1 / 3), scale(A_OP, 1 / 3), scale(A2, 1 / 3)],
  [C(1 / 3), scale(A2, 1 / 3), scale(A_OP, 1 / 3)],
]

const matMul = (P: Complex[][], Q: Complex[][]) => P.map((row) => Q[0].map((_, j) => row.reduce((s, p, k) => add(s, mul(p, Q[k][j])), ZERO)))

/** The phase impedance matrix of a balanced element with sequence impedances Z₀, Z₁, Z₂. */
export function phaseImpedance(z0: Complex, z1: Complex, z2: Complex): Complex[][] {
  const D = [
    [z0, ZERO, ZERO],
    [ZERO, z1, ZERO],
    [ZERO, ZERO, z2],
  ]
  return matMul(matMul(A_MAT, D), A_INV)
}

/** Solve a fault at the terminals of a source in phase quantities. Null if there is no earth path (Z₀ = ∞) or the system is singular. */
export function phaseDomainFault(type: FaultType, vf: Complex, z1: Complex, z2: Complex, z0: Complex | null, zf: Complex = ZERO): { iabc: Trio; vabc: Trio } | null {
  if (!z0) return null
  const Z = phaseImpedance(z0, z1, z2)
  const E = [vf, mul(A2, vf), mul(A_OP, vf)]
  const O = ZERO
  const I1 = C(1)
  const nzf = neg(zf)
  // unknowns: Va Vb Vc Ia Ib Ic
  const rows: Complex[][] = [0, 1, 2].map((p) => [p === 0 ? I1 : O, p === 1 ? I1 : O, p === 2 ? I1 : O, Z[p][0], Z[p][1], Z[p][2]])
  const rhs: Complex[] = [...E]
  const con: Complex[][] =
    type === '3ph'
      ? [
          [I1, O, O, nzf, O, O],
          [O, I1, O, O, nzf, O],
          [O, O, I1, O, O, nzf],
        ]
      : type === 'slg'
        ? [
            [I1, O, O, nzf, O, O],
            [O, O, O, O, I1, O],
            [O, O, O, O, O, I1],
          ]
        : type === 'll'
          ? [
              [O, O, O, I1, O, O],
              [O, O, O, O, I1, I1],
              [O, I1, neg(I1), O, nzf, O],
            ]
          : [
              [O, O, O, I1, O, O],
              [O, I1, neg(I1), O, O, O],
              [O, I1, O, O, nzf, nzf],
            ]
  const x = solveComplex([...rows, ...con], [...rhs, O, O, O])
  if (!x) return null
  return { vabc: [x[0], x[1], x[2]], iabc: [x[3], x[4], x[5]] }
}
