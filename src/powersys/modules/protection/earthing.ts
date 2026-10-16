import { abs, add, C, div, inv, mul, ONE, scale, type Complex } from '../../engine/complex.ts'
import { iBaseKa, zBaseOhm } from '../../network/perunit.ts'
import type { Generator } from '../../network/types.ts'
import { faultAtPoint, type PointFault } from '../faults/sequence.ts'
import { faultModel, faultNetwork, SETUP0 } from '../faults/study.ts'
import { theveninAt } from '../faults/zbus.ts'

/*
 * Neutral earthing of Module 4's 13.8 kV generator system (G1 with the delta winding of T1: the generator's star point
 * is the only possible earth connection). The positive- and negative-sequence impedances and the generator's own
 * zero-sequence reactance come from Module 4's model; the earth-fault equations are Module 4's (faultAtPoint). What
 * this file adds is the zero-sequence path for each earthing method — the neutral impedance Z_n (as 3Z_n) in series
 * with the generator's Z₀, in parallel with the system's capacitance to earth C₀ (per phase), which Module 4 neglects:
 *   Z₀ = [ (Z₀g + 3Z_n)⁻¹ + jωC₀ ]⁻¹ .
 * With C₀ left out, solid, reactance and unearthed reproduce Module 4's own earth-fault results (tested).
 */

export const GEN_KV = 13.8
const NET = faultNetwork(SETUP0)
export const G1 = NET.components.find((c) => c.id === 'G1') as Generator
export const BASE_MVA = NET.baseMva
export const W = 2 * Math.PI * NET.fHz
/** 13.8 kV bases [Ω, A] on the network base (100 MVA). */
export const ZB_GEN = zBaseOhm(GEN_KV, BASE_MVA)
export const IB_GEN_A = iBaseKa(GEN_KV, BASE_MVA) * 1000
/** Phase-to-earth voltage [V]. */
export const VPH_GEN = (GEN_KV * 1000) / Math.sqrt(3)

/** Module 4's sequence impedances at the generator terminals [pu], the generator solidly earthed. */
export function genSequence(): { z1: Complex; z2: Complex; z0g: Complex } {
  const m = faultModel({ ...SETUP0, genEarth: 'solid' })
  const th = theveninAt(m, m.busIds.indexOf('gen'))
  return { z1: th.z1!, z2: th.z2!, z0g: th.z0! }
}
const SEQ = genSequence()
/** The generator's own zero-sequence reactance [Ω] at 13.8 kV. */
export const X0G_OHM = SEQ.z0g.im * ZB_GEN

export type Method = 'solid' | 'resistance' | 'reactance' | 'unearthed' | 'resonant'
export const METHODS: Array<{ id: Method; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'resistance', label: 'Resistance' },
  { id: 'reactance', label: 'Reactance' },
  { id: 'unearthed', label: 'Unearthed' },
  { id: 'resonant', label: 'Resonant (Petersen)' },
]

export interface EarthParams {
  method: Method
  /** Neutral resistor [Ω]. */
  rnOhm: number
  /** Neutral reactor [Ω]. */
  xnOhm: number
  /** Petersen coil set this far from exact resonance [%] (+ = more reactance: under-compensated). */
  detunePct: number
  /** Capacitance of each phase to earth [µF] (generator winding, bus ducts, T1's LV winding, surge capacitors). */
  c0uF: number
  /** Include C₀ (off = Module 4's model, which neglects it). */
  withC: boolean
}
/** Illustrative values (not from a specific installation). */
export const EARTH0: EarthParams = { method: 'solid', rnOhm: 50, xnOhm: 2, detunePct: 0, c0uF: 0.5, withC: true }

/** Petersen coil reactance by the classical formula X = 1/(3ωC₀) [Ω] (generator's own Z₀ neglected). */
export const petersenClassic = (c0uF: number) => 1 / (3 * W * c0uF * 1e-6)
/** Exact tuning including the generator's own zero-sequence reactance: X₀g + 3X = 1/(ωC₀) [Ω]. */
export const petersenExact = (c0uF: number) => (1 / (W * c0uF * 1e-6) - X0G_OHM) / 3

export function earthIssues(p: EarthParams): string[] {
  const out: string[] = []
  if (p.method === 'resistance' && !(p.rnOhm > 0)) out.push('A resistance-earthed neutral needs a resistance above zero (zero is solid earthing).')
  if (p.method === 'reactance' && !(p.xnOhm > 0)) out.push('A reactance-earthed neutral needs a reactance above zero (zero is solid earthing).')
  if (p.method === 'resonant' && !(p.withC && p.c0uF > 0)) out.push('A Petersen coil is tuned against the capacitance to earth: switch C₀ on and give it a value.')
  if (p.withC && !(p.c0uF >= 0)) out.push('The capacitance to earth cannot be negative.')
  return out
}

/** The neutral impedance [Ω]; null = no connection (unearthed). */
export function neutralOhm(p: EarthParams): Complex | null {
  switch (p.method) {
    case 'solid':
      return C(0)
    case 'resistance':
      return C(p.rnOhm)
    case 'reactance':
      return C(0, p.xnOhm)
    case 'resonant':
      return C(0, petersenExact(p.c0uF) * (1 + p.detunePct / 100))
    default:
      return null
  }
}

/** Zero-sequence impedance at the generator terminals [pu]; null = no zero-sequence path (no earth-fault current). */
export function z0Of(p: EarthParams): Complex | null {
  const zn = neutralOhm(p)
  const path = zn ? add(SEQ.z0g, scale(zn, 3 / ZB_GEN)) : null
  const yc = p.withC && p.c0uF > 0 ? C(0, W * p.c0uF * 1e-6 * ZB_GEN) : C(0)
  const y = add(path ? inv(path) : C(0), yc)
  if (abs(y) === 0) return null
  // an exactly tuned coil makes the path admittances cancel: no zero-sequence path in the ideal lossless model
  if (path && abs(y) < 1e-12 * abs(yc)) return null
  return inv(y)
}

export interface EarthFault {
  params: EarthParams
  point: PointFault
  /** Earth-fault current 3I₀ [A]. */
  iFaultA: number
  /** Phase-to-earth voltages during the fault [pu of the phase voltage], a (faulted), b, c. */
  vPu: [number, number, number]
  /** The higher healthy-phase voltage [pu of phase voltage] = earth-fault factor. */
  vHealthyPu: number
  vHealthyKv: number
  /** Current through the neutral connection and through the capacitances [A]. */
  iNeutralA: number
  iCapA: number
  z0: Complex | null
}

/**
 * A bolted line-to-ground fault on phase a at the generator terminals (Module 4's equations). The capacitances to
 * earth are balanced shunts, so they also sit across the positive- and negative-sequence networks: Z₁ and Z₂ become
 * Z ‖ 1/(jωC₀) and the pre-fault terminal voltage E/(1 + jωC₀Z₁) (the machine's emf E = 1 pu). With C₀ off this is
 * exactly Module 4's model.
 */
export function earthFault(p: EarthParams): EarthFault {
  const z0 = z0Of(p)
  const ycs = p.withC && p.c0uF > 0 ? C(0, W * p.c0uF * 1e-6 * ZB_GEN) : C(0)
  const par = (z: Complex) => div(z, add(ONE, mul(z, ycs)))
  const vf = inv(add(ONE, mul(SEQ.z1, ycs)))
  const point = faultAtPoint('slg', vf, par(SEQ.z1), par(SEQ.z2), z0)
  const v0 = point.v012[0]
  const zn = neutralOhm(p)
  const path = zn ? add(SEQ.z0g, scale(zn, 3 / ZB_GEN)) : null
  const yc = p.withC && p.c0uF > 0 ? C(0, W * p.c0uF * 1e-6 * ZB_GEN) : C(0)
  const vPu = point.vabc.map(abs) as [number, number, number]
  const vh = Math.max(vPu[1], vPu[2])
  return {
    params: p,
    point,
    iFaultA: abs(scale(point.i012[0], 3)) * IB_GEN_A,
    vPu,
    vHealthyPu: vh,
    vHealthyKv: (vh * GEN_KV) / Math.sqrt(3),
    iNeutralA: path ? abs(scale(div(v0, path), 3)) * IB_GEN_A : 0,
    iCapA: abs(scale(mul(v0, yc), 3)) * IB_GEN_A,
    z0,
  }
}

/** Every method with the same C₀ (for the comparison table). */
export function compareMethods(p: EarthParams): Array<{ method: Method; f: EarthFault }> {
  return METHODS.map((m) => ({ method: m.id, f: earthFault({ ...p, method: m.id }) }))
}

/** The pure capacitive earth-fault current of an unearthed system, I_C = 3ωC₀·V_ph [A] (Z₁, Z₂ ≪ 1/ωC₀). */
export const capacitiveCurrent = (c0uF: number) => 3 * W * c0uF * 1e-6 * VPH_GEN

// ── generator stator earth fault (high-resistance earthing) ──────────────────────────────────────────────────────

export interface StatorParams {
  /** Neutral resistor referred to the 13.8 kV side [Ω] (in practice a distribution transformer with a small secondary resistor). */
  rnOhm: number
  /** Capacitance to earth per phase [µF]. */
  c0uF: number
  /** Fault resistance [Ω]. */
  rfOhm: number
  /** Neutral overvoltage relay setting [% of the phase voltage]. */
  kPct: number
}
/** Illustrative values: R_n ≈ 1/(3ωC₀), the usual rule for high-resistance earthing; a 5 % relay setting. */
export const STATOR0: StatorParams = { rnOhm: 2000, c0uF: 0.5, rfOhm: 0, kPct: 5 }

export function statorIssues(p: StatorParams): string[] {
  const out: string[] = []
  if (!(p.rnOhm > 0)) out.push('The neutral resistor must be above zero for this scheme (a solid neutral gives no neutral voltage).')
  if (!(p.kPct > 0 && p.kPct < 100)) out.push('The relay setting must be between 0 and 100 % of the phase voltage.')
  if (!(p.rfOhm >= 0)) out.push('The fault resistance cannot be negative.')
  if (!(p.c0uF >= 0)) out.push('The capacitance cannot be negative.')
  return out
}

/** The neutral's impedance to earth seen by the fault: R_n in parallel with the three phases' capacitance 3C₀ [Ω]. */
export function neutralZ(p: StatorParams): Complex {
  const y = add(C(1 / p.rnOhm), C(0, 3 * W * p.c0uF * 1e-6))
  return inv(y)
}

/**
 * A fault at fraction x of the winding from the neutral (x = 1: the terminal). The emf between the neutral and the
 * faulted point is x·E (emf spread evenly along the winding); the fault's current is a few amperes, so the winding's
 * own impedance drop is neglected. The faulted point is R_f above earth: V_N = −x·E·Z_N/(Z_N + R_f), I_F = x·E/(Z_N + R_f).
 */
export function statorFault(x: number, p: StatorParams): { vnV: number; vnPct: number; iFaultA: number } {
  const zn = neutralZ(p)
  const d = add(zn, C(p.rfOhm))
  const vn = (x * VPH_GEN * abs(zn)) / abs(d)
  return { vnV: vn, vnPct: (vn / VPH_GEN) * 100, iFaultA: (x * VPH_GEN) / abs(d) }
}

/** The fraction from the neutral below which the relay cannot see a fault, and the share of the winding protected. */
export function statorCoverage(p: StatorParams): { xMin: number; protectedPct: number } {
  const zn = neutralZ(p)
  const xMin = ((p.kPct / 100) * abs(add(zn, C(p.rfOhm)))) / abs(zn)
  return { xMin, protectedPct: Math.max(0, 1 - xMin) * 100 }
}
