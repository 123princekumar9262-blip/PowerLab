import { add, C, scale, sub, ZERO, type Complex } from '../engine/complex.ts'
import { branchPu, seriesY } from './perunit.ts'
import { inService } from './topology.ts'
import { isBranch, type Network } from './types.ts'

/**
 * The bus-admittance matrix Y_bus (per unit) of the given buses, from the in-service branches between them.
 * Branch model (π with an off-nominal tap t:1 at the `from` end, series admittance y, shunt b/2 at each end):
 *   I_from =  (y/t² + jb/2)·V_from − (y/t)·V_to
 *   I_to   = −(y/t)·V_from + (y + jb/2)·V_to
 */
export function buildYbus(net: Network, busIds: string[]): Complex[][] {
  const n = busIds.length
  const at = new Map(busIds.map((id, i) => [id, i]))
  const Y: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO))
  for (const c of net.components) {
    if (!isBranch(c) || !inService(net, c)) continue
    const i = at.get(c.from)
    const k = at.get(c.to)
    if (i === undefined || k === undefined) continue
    const p = branchPu(net, c)
    const y = seriesY(p)
    const t = p.tap
    Y[i][i] = add(Y[i][i], add(scale(y, 1 / (t * t)), p.yHalf))
    Y[k][k] = add(Y[k][k], add(y, p.yHalf))
    Y[i][k] = sub(Y[i][k], scale(y, 1 / t))
    Y[k][i] = sub(Y[k][i], scale(y, 1 / t))
  }
  return Y
}

/** A Y_bus written directly from per-unit series impedances (for teaching and independent checks). */
export function ybusFromImpedances(n: number, lines: Array<{ i: number; k: number; z: Complex; yHalf?: Complex }>): Complex[][] {
  const Y: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO))
  for (const l of lines) {
    const d = l.z.re * l.z.re + l.z.im * l.z.im
    const y = C(l.z.re / d, -l.z.im / d)
    const h = l.yHalf ?? ZERO
    Y[l.i][l.i] = add(Y[l.i][l.i], add(y, h))
    Y[l.k][l.k] = add(Y[l.k][l.k], add(y, h))
    Y[l.i][l.k] = sub(Y[l.i][l.k], y)
    Y[l.k][l.i] = sub(Y[l.k][l.i], y)
  }
  return Y
}
