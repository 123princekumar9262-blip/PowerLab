import type { ResolvedParams } from '../types/simulation.ts'

/** A time-domain voltage source that can be evaluated at any instant (not only at samples). */
export interface VoltageSource {
  /** Instantaneous source voltage [V] at time t [s]. */
  v(t: number): number
  /** Electrical angle θ = ωt + φ at time t, wrapped to [0°, 360°). */
  angleDeg(t: number): number
}

/**
 * Sinusoidal AC source: vin(t) = Vm·sin(ωt + φ).
 * Vm is the peak voltage, ω = 2πf the angular frequency, φ the phase offset.
 */
export function sineSource(p: Pick<ResolvedParams, 'vm' | 'omega' | 'phase'>): VoltageSource {
  const { vm, omega, phase } = p
  return {
    v: (t) => vm * Math.sin(omega * t + phase),
    angleDeg: (t) => {
      const deg = ((omega * t + phase) * 180) / Math.PI
      return ((deg % 360) + 360) % 360
    },
  }
}

export type Phase = 'a' | 'b' | 'c'

/** Balanced three-phase source (before faults): phase-to-neutral voltages. */
export interface ThreePhaseSource extends VoltageSource {
  /** Phase-to-neutral voltage of phase x at time t [V]. */
  phase(x: Phase, t: number): number
  /** Electrical angle of phase x itself at time t (its own sin argument), in [0°, 360°). */
  phaseAngleDeg(x: Phase, t: number): number
}

/**
 * Three-phase sinusoidal source, phase-to-neutral:
 *   VaN = Vm·sin(ωt + φ)
 *   VbN = Vm·sin(ωt + φ − 2π/3)   (abc sequence; +2π/3 for acb)
 *   VcN = Vm·sin(ωt + φ + 2π/3)   (abc sequence; −2π/3 for acb)
 * Vm = √2·Vrms (phase RMS). Line-to-line voltages are √3 larger and lead by 30°.
 * An `imbalance` fault scales one phase's amplitude.
 */
export function threePhaseSource(
  p: Pick<ResolvedParams, 'vm' | 'omega' | 'phase' | 'threePhase' | 'faults'>,
): ThreePhaseSource {
  const { vm, omega, phase } = p
  const shift = (2 * Math.PI) / 3
  const sign = p.threePhase.sequence === 'acb' ? -1 : 1
  const offset: Record<Phase, number> = { a: 0, b: -sign * shift, c: sign * shift }
  const scale: Record<Phase, number> = { a: 1, b: 1, c: 1 }
  if (p.faults.imbalance) scale[p.faults.imbalance.phase] = p.faults.imbalance.scale
  const arg = (x: Phase, t: number) => omega * t + phase + offset[x]
  const wrap = (rad: number) => ((((rad * 180) / Math.PI) % 360) + 360) % 360
  return {
    v: (t) => scale.a * vm * Math.sin(arg('a', t)),
    angleDeg: (t) => wrap(arg('a', t)),
    phase: (x, t) => scale[x] * vm * Math.sin(arg(x, t)),
    phaseAngleDeg: (x, t) => wrap(arg(x, t)),
  }
}
