import { add, C, div, ONE, sub, ZERO, type Complex } from '../../engine/complex.ts'
import { activeLines, type LfCase } from './systems.ts'

/**
 * Y_bus built one element at a time, as it is taught: start from an all-zero n×n matrix; each branch i–k with series
 * admittance y = 1/z and half its charging j·b/2 at each end adds
 *     Y_ii += y + j·b/2     Y_kk += y + j·b/2     Y_ik = Y_ki −= y
 * and a shunt capacitor at bus i adds its susceptance j·B to Y_ii. Every intermediate matrix is recorded so the
 * student can watch which entries change.
 */

export interface YStep {
  kind: 'line' | 'shunt'
  /** Line id, or the bus of a shunt. */
  label: string
  i: number
  k: number
  /** Series admittance (0 for a shunt) and the shunt part added at each end [pu]. */
  y: Complex
  yHalf: Complex
  /** The entries this step changed. */
  cells: Array<[number, number]>
  /** Y_bus after this step. */
  Y: Complex[][]
}

const copy = (Y: Complex[][]) => Y.map((r) => [...r])

export function ybusSteps(c: LfCase): { steps: YStep[]; Y: Complex[][] } {
  const n = c.buses.length
  let Y: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO))
  const steps: YStep[] = []
  for (const l of activeLines(c)) {
    const y = div(ONE, C(l.r, l.x))
    const yHalf = C(0, l.b / 2)
    Y = copy(Y)
    const { from: i, to: k } = l
    Y[i][i] = add(Y[i][i], add(y, yHalf))
    Y[k][k] = add(Y[k][k], add(y, yHalf))
    Y[i][k] = sub(Y[i][k], y)
    Y[k][i] = sub(Y[k][i], y)
    steps.push({
      kind: 'line',
      label: l.id,
      i,
      k,
      y,
      yHalf,
      cells: [
        [i, i],
        [k, k],
        [i, k],
        [k, i],
      ],
      Y,
    })
  }
  c.buses.forEach((b, i) => {
    if (!b.shuntMvar) return
    const yb = C(0, b.shuntMvar / c.baseMva)
    Y = copy(Y)
    Y[i][i] = add(Y[i][i], yb)
    steps.push({ kind: 'shunt', label: b.name, i, k: i, y: ZERO, yHalf: yb, cells: [[i, i]], Y })
  })
  return { steps, Y }
}

/** Non-zero entries of a matrix (|y| above a tiny threshold). */
export const nonZeros = (Y: Complex[][]) => Y.flat().filter((y) => Math.hypot(y.re, y.im) > 1e-12).length
