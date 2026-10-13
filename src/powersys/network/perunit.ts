import { C, div, ONE, scale, type Complex } from '../engine/complex.ts'
import type { Branch, Network } from './types.ts'

/**
 * The per-unit system of a network: one three-phase base power S_base [MVA] for the whole network, and a base
 * voltage per bus equal to its nominal line-to-line voltage [kV]. Then
 *   Z_base = V_base² / S_base   [Ω]          I_base = S_base / (√3 · V_base)   [kA]
 * (three-phase base with line-to-line voltage).
 */
export const zBaseOhm = (kv: number, mva: number): number => (kv * kv) / mva
export const iBaseKa = (kv: number, mva: number): number => mva / (Math.sqrt(3) * kv)

/** R and X from an impedance magnitude and an X/R ratio. */
export function zFromMagXr(z: number, xr: number): Complex {
  if (!Number.isFinite(xr) || xr <= 0) return C(0, z) // purely reactive
  const x = (z * xr) / Math.sqrt(1 + xr * xr)
  return C(x / xr, x)
}

/** A branch in per unit on the network base: series impedance, half of its shunt admittance at each end, and the
 * off-nominal tap ratio t (an ideal t:1 transformer at the `from` end; 1 for a line or a transformer whose ratio
 * matches the buses' nominal voltages). */
export interface BranchPu {
  z: Complex
  yHalf: Complex
  tap: number
}

export function branchPu(net: Network, b: Branch): BranchPu {
  const fromBus = net.buses.find((x) => x.id === b.from)!
  const toBus = net.buses.find((x) => x.id === b.to)!
  if (b.kind === 'line') {
    const zb = zBaseOhm(toBus.kv, net.baseMva)
    const zOhm = C(b.rOhmPerKm * b.lengthKm, b.xOhmPerKm * b.lengthKm)
    const bS = b.bUsPerKm * 1e-6 * b.lengthKm // total shunt susceptance [S]
    return { z: scale(zOhm, 1 / zb), yHalf: C(0, (bS * zb) / 2), tap: 1 }
  }
  // transformer: z% on its own rating and its own rated voltage → network base, referred to the `to` side
  const zOwn = zFromMagXr(b.zPct / 100, b.xr)
  const z = scale(zOwn, (net.baseMva / b.ratedMva) * (b.kvTo / toBus.kv) ** 2)
  const tap = b.kvFrom / fromBus.kv / (b.kvTo / toBus.kv)
  return { z, yHalf: C(0, 0), tap }
}

/** The series admittance y = 1/z of a branch in per unit. */
export const seriesY = (p: BranchPu): Complex => div(ONE, p.z)
