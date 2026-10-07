import type { ResolvedParams } from '../../types/simulation.ts'

/** One closed-form result, with the formula shown to the student. */
export interface TheoryValue {
  value: number
  formula: string
}

export interface HalfWaveRTheory {
  /** Turn-on angle θ1 [rad]: where vin first exceeds Vf. */
  theta1: number
  /** Turn-off angle θ2 = π − θ1 [rad]. */
  theta2: number
  conducts: boolean
  vinPeak: TheoryValue
  vinRms: TheoryValue
  voutPeak: TheoryValue
  voutAvg: TheoryValue
  voutRms: TheoryValue
  ioAvg: TheoryValue
  ioRms: TheoryValue
  ioPeak: TheoryValue
  piv: TheoryValue
  conductionAngleDeg: TheoryValue
  rippleFrequency: TheoryValue
}

/**
 * Closed-form analysis of the half-wave rectifier with R load, for a diode
 * modelled as Vf + Ron (ideal: Vf = 0, Ron = 0). θ = ωt + φ is the source angle.
 *
 * The diode conducts while Vm·sinθ > Vf, i.e. for θ1 < θ < θ2 with
 *   θ1 = asin(Vf/Vm),  θ2 = π − θ1.
 * During conduction the loop current is  io = (Vm·sinθ − Vf)/(R + Ron), so
 *   vout = R·io = k·(Vm·sinθ − Vf),   k = R/(R + Ron)  (resistive divider with Ron).
 *
 * Averaging over one period (2π):
 *   Vdc   = (k/2π)·∫θ1..θ2 (Vm·sinθ − Vf) dθ = (k/2π)·[2Vm·cosθ1 − Vf·(π − 2θ1)]
 *   Vrms² = (k²/2π)·∫θ1..θ2 (Vm·sinθ − Vf)² dθ
 *         = (k²/2π)·[Vm²·((π − 2θ1)/2 + sin2θ1/2) − 4·Vm·Vf·cosθ1 + Vf²·(π − 2θ1)]
 * Ideal diode (θ1 = 0, k = 1):  Vdc = Vm/π,  Vrms = Vm/2.
 */
export function halfWaveRTheory(p: ResolvedParams): HalfWaveRTheory {
  const { vm, resistance: R } = p
  const { vf, ron } = p.diode
  const ideal = p.diode.kind === 'ideal'
  const conducts = vm > vf
  const k = R / (R + ron)

  const theta1 = conducts ? Math.asin(vf / vm) : Math.PI / 2
  const theta2 = Math.PI - theta1
  const width = conducts ? theta2 - theta1 : 0 // = π − 2θ1

  const vdc = conducts ? (k / (2 * Math.PI)) * (2 * vm * Math.cos(theta1) - vf * width) : 0
  const vrmsSq = conducts
    ? ((k * k) / (2 * Math.PI)) *
      (vm * vm * (width / 2 + Math.sin(2 * theta1) / 2) - 4 * vm * vf * Math.cos(theta1) + vf * vf * width)
    : 0
  const vrms = Math.sqrt(Math.max(0, vrmsSq))
  const voutPeak = conducts ? k * (vm - vf) : 0

  return {
    theta1,
    theta2,
    conducts,
    vinPeak: { value: vm, formula: 'Vm = √2·Vrms' },
    vinRms: { value: p.vrms, formula: 'Vrms = Vm/√2' },
    voutPeak: {
      value: voutPeak,
      formula: ideal ? 'Vo,pk = Vm' : ron > 0 ? 'Vo,pk = (Vm − Vf)·R/(R+Ron)' : 'Vo,pk = Vm − Vf',
    },
    voutAvg: {
      value: vdc,
      formula: ideal ? 'Vdc = Vm/π' : 'Vdc = k/2π·[2Vm·cosθ₁ − Vf(π − 2θ₁)]',
    },
    voutRms: { value: vrms, formula: ideal ? 'Vo,rms = Vm/2' : 'Vo,rms = √(1/2π ∫θ₁..θ₂ vo² dθ)' },
    ioAvg: { value: vdc / R, formula: 'Idc = Vdc/R' },
    ioRms: { value: vrms / R, formula: 'Io,rms = Vo,rms/R' },
    ioPeak: { value: voutPeak / R, formula: ideal ? 'Io,pk = Vm/R' : 'Io,pk = (Vm − Vf)/(R + Ron)' },
    piv: { value: vm, formula: 'PIV = Vm' },
    conductionAngleDeg: {
      value: (width * 180) / Math.PI,
      formula: ideal ? 'γ = 180°' : 'γ = 180° − 2·asin(Vf/Vm)',
    },
    rippleFrequency: { value: conducts ? p.frequency : 0, formula: 'f_ripple = f' },
  }
}
