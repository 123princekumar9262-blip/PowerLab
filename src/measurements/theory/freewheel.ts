import type { ResolvedParams } from '../../types/simulation.ts'
import { extremes } from './numeric.ts'
import { firstRoot } from './numeric.ts'
import { deg, finish, fromWaveform, integrate, none, TWO_PI, type Theory, type Waveform } from './waveform.ts'

/**
 * Closed-form steady state of the half-wave rectifier + RL load + freewheeling diode
 * (independent of the simulator). θ = ωt + φ; vin = Vm·sinθ.
 *
 * Two linear circuits, each an RL loop with a constant or sinusoidal drive:
 *   D1 ON  (source supplies):   L·di/dt + Reff·i = Vm·sinθ − Vf
 *        i(θ) = (Vm/Z)·sin(θ − φ) − Vf/Reff + [i_s − (Vm/Z)·sin(θ_s − φ) + Vf/Reff]·e^(−(θ−θ_s)/ωτ)
 *   Dfw ON (freewheeling):      L·di/dt + Reff·i = −Vf
 *        i(θ) = (i_s + Vf/Reff)·e^(−(θ−θ_s)/ωτ) − Vf/Reff
 * with Reff = R + Ron, Z = √(Reff² + (ωL)²), φ = atan(ωL/Reff), ωτ = ωL/Reff, and i_s the
 * current at the start θ_s of the interval (the inductor current is continuous).
 *
 * The hand-over happens where vin crosses zero: with D1 conducting, Dfw sees −(vin − Vf) and
 * starts conducting when that exceeds Vf, i.e. at vin = 0; with Dfw conducting (vo = −Vf), D1
 * sees vin + Vf and starts conducting at vin = 0. (Exact for Ron = 0; with Ron > 0 both
 * conduct for a moment around the crossing, so the rows become approximations.)
 *
 * Continuous mode: i(0) = i(2π) is a linear fixed point, solved directly. If that current would
 * go negative the current is discontinuous: D1 starts from zero where vin = Vf, the freewheel
 * interval ends when the current reaches zero.
 */
export function freewheelTheory(p: ResolvedParams): Theory {
  const { vm, omega } = p
  const vf = p.diode.vf
  const ron = p.diode.ron
  const R = p.resistance
  const Reff = R + ron
  const X = omega * p.inductance
  const Z = Math.hypot(Reff, X)
  const φ = Math.atan2(X, Reff)
  const wt = X / Reff
  if (!(vm > vf)) return none(p, ['The source peak never exceeds the diode drop: no conduction.'])

  const iSrc = (θ: number, θs: number, is: number) => (vm / Z) * Math.sin(θ - φ) - vf / Reff + (is - (vm / Z) * Math.sin(θs - φ) + vf / Reff) * Math.exp(-(θ - θs) / wt)
  const iFw = (θ: number, θs: number, is: number) => (is + vf / Reff) * Math.exp(-(θ - θs) / wt) - vf / Reff

  // Continuous candidate: i(2π) = a·i0 + b with a = e^(−2π/ωτ); fixed point i0 = b/(1 − a).
  const b = iFw(TWO_PI, Math.PI, iSrc(Math.PI, 0, 0))
  const a = Math.exp(-TWO_PI / wt)
  const i0 = b / (1 - a)
  const iPi = iSrc(Math.PI, 0, i0)
  const minSrc = extremes((θ) => iSrc(θ, 0, i0), 0, Math.PI).min
  const continuous = i0 > 0 && minSrc > 0 && iPi > 0

  let w: Waveform
  let ifw: (θ: number) => number
  let fwOn: number | null
  let fwOff: number | null
  const notes: string[] = [`Reff = R + Ron = ${Reff.toFixed(3)} Ω, ωτ = ωL/Reff = ${wt.toFixed(3)} rad (L/R = ${((p.inductance / Reff) * 1e3).toFixed(2)} ms).`]
  const vin = (θ: number) => vm * Math.sin(θ)
  if (continuous) {
    const i = (θ: number) => (θ < Math.PI ? iSrc(θ, 0, i0) : iFw(θ, Math.PI, iPi))
    const vo = (θ: number) => (θ < Math.PI ? vin(θ) - vf - ron * i(θ) : -vf - ron * i(θ))
    ifw = (θ: number) => (θ < Math.PI ? 0 : i(θ))
    fwOn = Math.PI
    fwOff = TWO_PI
    w = { a: 0, breaks: [Math.PI], vout: vo, io: i, iD1: (θ) => (θ < Math.PI ? i(θ) : 0), irect: i, piv: (θ) => Math.max(vo(θ) - vin(θ), vo(θ)), turnOn: 0, turnOff: Math.PI }
    notes.push(`Continuous current: D1 conducts 0°–180°, Dfw 180°–360°; the current never reaches zero (minimum ${(Math.min(i0, minSrc) * 1e3).toFixed(1)} mA).`)
  } else {
    // Discontinuous: D1 from θ₁ = asin(Vf/Vm) with i = 0.
    const θ1 = Math.asin(vf / vm)
    const βSrc = firstRoot((θ) => iSrc(θ, θ1, 0), θ1 + 1e-5, Math.PI)
    if (βSrc !== null) {
      // The current dies before vin reverses: the freewheeling diode never conducts.
      const i = (θ: number) => (θ > θ1 && θ < βSrc ? Math.max(0, iSrc(θ, θ1, 0)) : 0)
      const vo = (θ: number) => (i(θ) > 0 ? vin(θ) - vf - ron * i(θ) : 0)
      ifw = () => 0
      fwOn = fwOff = null
      w = { a: 0, breaks: [θ1, βSrc], vout: vo, io: i, iD1: i, irect: i, piv: (θ) => Math.max(vo(θ) - vin(θ), vo(θ)), turnOn: θ1, turnOff: βSrc }
      notes.push('The current dies out before vin reverses, so the freewheeling diode never gets a chance to conduct (L is too small to matter).')
    } else {
      const iπ = iSrc(Math.PI, θ1, 0)
      // Freewheel current reaches zero at θz: (iπ + Vf/Reff)·e^(−(θz−π)/ωτ) = Vf/Reff.
      const θz = Math.PI + wt * Math.log((iπ + vf / Reff) / (vf / Reff))
      const i = (θ: number) => (θ > θ1 && θ < Math.PI ? iSrc(θ, θ1, 0) : θ >= Math.PI && θ < θz ? Math.max(0, iFw(θ, Math.PI, iπ)) : 0)
      const vo = (θ: number) => (θ > θ1 && θ < Math.PI ? vin(θ) - vf - ron * i(θ) : θ >= Math.PI && θ < θz ? -vf - ron * i(θ) : 0)
      ifw = (θ: number) => (θ >= Math.PI && θ < θz ? i(θ) : 0)
      fwOn = Math.PI
      fwOff = θz
      w = { a: 0, breaks: [θ1, Math.PI, θz], vout: vo, io: i, iD1: (θ) => (θ < Math.PI ? i(θ) : 0), irect: i, piv: (θ) => Math.max(vo(θ) - vin(θ), vo(θ)), turnOn: θ1, turnOff: Math.PI }
      notes.push(`Discontinuous current: the freewheel current reaches zero at θ = ${deg(θz).toFixed(1)}° — before D1 can conduct again at θ₁ = ${deg(θ1).toFixed(1)}°.`)
    }
  }

  const values = fromWaveform(p, w, {
    voutAvg: continuous ? (ron > 0 ? 'Vdc = Vm/π − Vf − Ron·Idc' : vf > 0 ? 'Vdc = Vm/π − Vf' : 'Vdc = Vm/π') : 'Vdc = (1/2π)∫vo dθ',
    voutMin: continuous ? 'Vo,min = −Vf (Dfw conducting)' : 'min vo(θ)',
    ioAvg: 'Idc = Vdc/R',
    turnOnAngleDeg: continuous ? 'θon = 0° (vin crosses zero)' : 'θ₁ = asin(Vf/Vm)',
    turnOffAngleDeg: continuous ? 'θoff = 180° (current moves to Dfw)' : 'θoff = 180°',
    conductionAngleDeg: 'γ(D1) = θoff − θon',
    piv: 'PIV = max(−vD1, −vDfw) ≈ Vm − Vf',
  })
  const avg = (f: (θ: number) => number) => integrate(w, f) / TWO_PI
  const exact = ron === 0 ? ('exact' as const) : ('approx' as const)
  const ix = extremes(w.io, 0, TWO_PI)
  const ifwX = extremes(ifw, 0, TWO_PI)
  const io2 = avg((θ) => w.io(θ) ** 2)
  const idc = avg(w.io)
  Object.assign(values, {
    ifwAvg: { value: avg(ifw), formula: 'IDfw,avg = (1/2π)∫ i_fw dθ', kind: exact },
    ifwPeak: { value: ifwX.max, formula: 'IDfw,pk = i(180°) (the current it inherits from D1)', kind: exact },
    ...(fwOn !== null && fwOff !== null ? { fwConductionDeg: { value: deg(fwOff - fwOn), formula: continuous ? 'γ(Dfw) = 360° − 180° = 180°' : 'γ(Dfw) = θz − 180°, θz: i(θz) = 0', kind: exact } } : {}),
    ioMin: { value: ix.min, formula: continuous ? 'Io,min = i(0) = b/(1 − e^(−2π/ωτ))' : 'Io,min = 0 (discontinuous)', kind: exact },
    ioRipplePP: { value: ix.max - ix.min, formula: 'ΔIo = Io,pk − Io,min', kind: exact },
    ioRippleFactor: { value: Math.sqrt(Math.max(0, io2 - idc * idc)) / idc, formula: 'RFi = √(Io,rms² − Idc²)/Idc', kind: exact },
    wlMax: { value: 0.5 * p.inductance * ix.max ** 2, formula: 'E_L,max = ½·L·Io,pk²', kind: exact },
    wlMin: { value: 0.5 * p.inductance * ix.min ** 2, formula: 'E_L,min = ½·L·Io,min²', kind: exact },
  })
  if (exact === 'approx') {
    for (const v of Object.values(values)) if (v) v.kind = 'approx'
    notes.push(`With Ron = ${ron} Ω, D1 and Dfw share the current for a moment around each zero crossing (vin within ±Ron·i of zero). The formulas ignore that overlap, so the rows are approximations.`)
  }
  notes.push('Freewheeling diode provides a path for the inductive current when the main source path is unavailable: the load voltage is clamped at −Vf instead of following vin below zero, so Vdc rises and the current no longer has to die out every cycle.')
  return finish(p, values, [], notes, continuous ? 'continuous' : 'discontinuous')
}
