import type { DiodeBias, DiodeModel } from '../types/simulation.ts'

/** Result of solving one diode against the rest of the circuit. */
export interface DiodeSolution {
  on: boolean
  bias: DiodeBias
  /** Diode (anode → cathode) current [A]. */
  current: number
  /** Diode voltage vAK = vAnode − vCathode [V]. */
  voltage: number
}

/**
 * Solve a diode connected to a linear resistive network, represented by its
 * Thévenin equivalent as seen from the diode terminals:
 *
 *        Rth         A    K
 *   ┌───/\/\/───────┤>|────┐
 *  (vth)                   │
 *   └──────────────────────┘
 *
 * The diode uses the piecewise-linear (constant-voltage-drop + on-resistance) model:
 *   ON:  vAK = Vf + Ron·i, with i ≥ 0
 *   OFF: i = 0,            with vAK ≤ Vf
 * The ideal diode is the special case Vf = 0, Ron = 0.
 *
 * The state is found with the ASSUMED-STATE method used in circuit analysis:
 *   1. Assume ON  → KVL gives i = (vth − Vf) / (Rth + Ron). Consistent only if i > 0.
 *   2. Assume OFF → i = 0, so no drop across Rth and vAK = vth. Consistent only if vAK ≤ Vf.
 * Exactly one hypothesis is self-consistent (both coincide at the boundary vth = Vf,
 * where the current is zero either way; we report OFF there).
 *
 * The state therefore comes from the circuit conditions — not from the sign of the source.
 */
export function solveDiodeThevenin(vth: number, rth: number, d: DiodeModel): DiodeSolution {
  const bias = classifyBias(vth, d.vf)

  // Hypothesis 1: diode ON. Series loop: vth = i·Rth + (Vf + Ron·i).
  const rLoop = rth + d.ron
  const iOn = (vth - d.vf) / rLoop
  const onConsistent = iOn > 0

  // Hypothesis 2: diode OFF. No current, so no drop across Rth: the diode sees vth.
  const vOff = vth
  const offConsistent = vOff <= d.vf

  if (onConsistent && !offConsistent) {
    return { on: true, bias, current: iOn, voltage: d.vf + d.ron * iOn }
  }
  // OFF is consistent (or we are exactly on the boundary, where i = 0 regardless).
  return { on: false, bias, current: 0, voltage: vOff }
}

/** Classify the voltage made available to the diode by the rest of the circuit. */
export function classifyBias(vAvailable: number, vf: number): DiodeBias {
  if (vAvailable > vf) return 'forward-conducting'
  if (vAvailable > 0) return 'forward-below-threshold'
  if (vAvailable < 0) return 'reverse'
  return 'zero'
}
