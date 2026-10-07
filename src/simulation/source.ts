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
