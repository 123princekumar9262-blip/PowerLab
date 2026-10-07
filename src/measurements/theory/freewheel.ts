import type { ResolvedParams } from '../../types/simulation.ts'
import { extremes, firstRoot } from './numeric.ts'
import { deg, finish, fromWaveform, integrate, none, pathDrops, pivAt, TWO_PI, type Theory, type Waveform } from './waveform.ts'

/** The honest answer when no closed form covers the circuit. */
export const NOT_APPLICABLE = 'Closed-form equation not applicable under the current operating condition. Use numerical simulation.'

/**
 * Closed-form steady state of a single-phase rectifier with an RL load whose current can be
 * CLAMPED (freewheel) when the source path stops supplying it. Independent of the simulator.
 *
 * Covers: half-wave / center-tap / bridge + freewheeling diode Dfw (diodes or SCRs), and the
 * semi-controlled bridge (its own leg T1 + D3 or T2 + D4 freewheels the current; with Dfw fitted,
 * Dfw takes over because one drop is lower than two).
 *
 * Per pulse period P = 2π/n (θ = ωt + φ, vin = Vm·sinθ):
 *   source interval  [θs, θe]:  L·di/dt + (R + Ront)·i = Vm·sinθ − Vft         (Vft: path drops)
 *   clamp interval   [θe, θs+P]: L·di/dt + (R + Roc)·i = −Vcl                  (Vcl: Vf of Dfw, or 2Vf of the semi leg)
 * The source path keeps the current while vin − Vft > −Vcl, i.e. until θe = 180° − θx with
 * θx = asin((Vft − Vcl)/Vm); an SCR starts it at θs = max(α, θx) (continuous) or max(α, θ₁) after a
 * current zero (θ₁ = asin(Vft/Vm)). Continuous current is the linear fixed point i(θs) = i(θs + P).
 */
export function freewheelTheory(p: ResolvedParams): Theory {
  const { n, vft, ront } = pathDrops(p)
  const { vm, omega } = p
  const vf = p.diode.vf
  const ron = p.diode.ron
  const dfw = p.control.freewheel
  const semi = p.topology === 'semi-bridge'
  const vcl = dfw ? vf : 2 * vf
  const roc = dfw ? ron : 2 * ron
  const α = p.control.device === 'scr' ? p.control.alpha : 0
  const P = TWO_PI / n
  const R = p.resistance
  const X = omega * p.inductance
  const rl = (Re: number) => ({ Re, Z: Math.hypot(Re, X), φ: Math.atan2(X, Re), wt: X / Re })
  const S = rl(R + ront)
  const C = rl(R + roc)
  if (!(vm > vft)) return none(p, ['The source peak never exceeds the device drops: no conduction.'])

  const iSrc = (θ: number, θs: number, is: number) => (vm / S.Z) * Math.sin(θ - S.φ) - vft / S.Re + (is - (vm / S.Z) * Math.sin(θs - S.φ) + vft / S.Re) * Math.exp(-(θ - θs) / S.wt)
  const iCl = (θ: number, θs: number, is: number) => (is + vcl / C.Re) * Math.exp(-(θ - θs) / C.wt) - vcl / C.Re

  const θx = Math.asin(Math.min(1, Math.max(0, (vft - vcl) / vm)))
  const θ1 = Math.asin(Math.min(1, vft / vm))
  const θe = Math.PI - θx
  const notes: string[] = []

  // ── Continuous candidate ────────────────────────────────────────────────────────
  let θs = Math.max(α, θx)
  let mode: 'continuous' | 'discontinuous' = 'continuous'
  let i0 = 0
  let ie = 0
  let βs: number | null = null
  let θz = Infinity
  if (θs < θe) {
    const a = Math.exp(-(θe - θs) / S.wt) * Math.exp(-(θs + P - θe) / C.wt)
    const b = iCl(θs + P, θe, iSrc(θe, θs, 0))
    i0 = b / (1 - a)
    ie = iSrc(θe, θs, i0)
    const minSrc = extremes((θ) => iSrc(θ, θs, i0), θs, θe, 4000).min
    if (!(i0 > 0 && minSrc > 0 && ie > 0)) mode = 'discontinuous'
  } else mode = 'discontinuous'

  if (mode === 'discontinuous') {
    θs = Math.max(α, θ1)
    if (θs >= Math.PI - θ1) return none(p, [`The SCRs are fired at α = ${deg(α).toFixed(1)}°, after the source can still forward bias them: no conduction.`])
    i0 = 0
    βs = firstRoot((θ) => iSrc(θ, θs, 0), θs + 1e-5, θe)
    if (βs === null) {
      ie = iSrc(θe, θs, 0)
      θz = vcl > 0 ? θe + C.wt * Math.log((ie + vcl / C.Re) / (vcl / C.Re)) : Infinity
      if (!(θz < θs + P)) return none(p, [NOT_APPLICABLE, 'The current is at the boundary between continuous and discontinuous conduction.'])
    }
  }

  // ── The waveform over one cycle [θs, θs + 2π] ───────────────────────────────────
  const frame = (θ: number) => {
    const x = (((θ - θs) % TWO_PI) + TWO_PI) % TWO_PI
    return { h: θs + (x % P), k: Math.floor(x / P) }
  }
  const srcEnd = βs ?? θe
  const parts = (θ: number) => {
    const { h, k } = frame(θ)
    if (h <= srcEnd) return { h, k, src: Math.max(0, iSrc(h, θs, i0)), cl: 0 }
    if (βs !== null) return { h, k, src: 0, cl: 0 }
    if (h >= θz) return { h, k, src: 0, cl: 0 }
    return { h, k, src: 0, cl: Math.max(0, iCl(h, θe, ie)) }
  }
  const io = (θ: number) => {
    const q = parts(θ)
    return q.src + q.cl
  }
  const vo = (θ: number) => {
    const q = parts(θ)
    if (q.src > 0 || (q.h <= srcEnd && mode === 'continuous')) return vm * Math.sin(q.h) - vft - ront * q.src
    if (q.cl > 0 || (mode === 'continuous' && q.h > θe)) return -vcl - roc * q.cl
    return 0
  }
  const vin = (θ: number) => vm * Math.sin(θ)
  const iFw = (θ: number) => (dfw ? parts(θ).cl : 0)
  // Reference device (D1 / T1): its own half-cycle's source current; in the semi-controlled
  // bridge without Dfw, T1 also carries the freewheel current that follows (T1 + D3 loop).
  const iD1 = (θ: number) => {
    const q = parts(θ)
    return q.k === 0 ? q.src + (semi && !dfw ? q.cl : 0) : 0
  }
  const piv = (θ: number) => {
    const q = parts(θ)
    const v = vo(θ)
    // Semi-controlled leg freewheeling (T1 + D3): the blocking diode of the other leg sees |vin| − Vf.
    const main = n === 1 ? v - vin(θ) : semi && !dfw && q.cl > 0 ? Math.abs(vin(θ)) - vf : pivAt(p, θ, v, q.src)
    return Math.max(main, dfw ? v : -Infinity)
  }
  const ends = [srcEnd, ...(Number.isFinite(θz) ? [θz] : [])]
  const breaks = n === 1 ? ends : [...ends, θs + Math.PI, ...ends.map((x) => x + Math.PI)]
  const d1Off = semi && !dfw ? (mode === 'continuous' ? θs + P : Number.isFinite(θz) ? θz : srcEnd) : srcEnd
  const w: Waveform = { a: θs, breaks, vout: vo, io, iD1, irect: io, piv, turnOn: θs, turnOff: d1Off }

  const ideal = vft === 0 && vcl === 0
  const vdcFormula =
    mode === 'continuous' && ideal
      ? n === 1
        ? 'Vdc = (Vm/2π)·(1 + cos α)'
        : 'Vdc = (Vm/π)·(1 + cos α)'
      : mode === 'continuous'
        ? `Vdc = (1/${n === 1 ? '2π' : 'π'})·[∫source (Vm·sinθ − Vft) dθ − ∫clamp Vcl dθ]`
        : 'Vdc = R·Idc (avg vL = 0)'
  const values = fromWaveform(p, w, {
    voutAvg: vdcFormula,
    voutMin: mode === 'continuous' ? (dfw ? 'Vo,min = −Vf (Dfw conducting)' : 'Vo,min = −2Vf (T1 + D3 freewheeling)') : 'min vo(θ)',
    ioAvg: 'Idc = Vdc/R',
    turnOnAngleDeg: p.control.device === 'scr' ? (mode === 'continuous' ? 'θon = α (gate pulse)' : 'θon = max(α, asin(Vft/Vm))') : mode === 'continuous' ? 'θon = asin((Vft − Vcl)/Vm)' : 'θ₁ = asin(Vft/Vm)',
    turnOffAngleDeg: semi && !dfw ? 'θoff = θon + 180° (the other SCR fires)' : 'θoff: the source path hands the current to the clamp',
    conductionAngleDeg: 'γ(D1/T1) = θoff − θon',
    piv: 'PIV = max reverse voltage over the cycle',
  })

  // Device losses differ between the source path (Vft) and the clamp path (Vcl).
  const avg = (f: (θ: number) => number) => integrate(w, f) / TWO_PI
  const pLoad = avg((θ) => R * io(θ) ** 2)
  const pDev = avg((θ) => {
    const q = parts(θ)
    return vft * q.src + ront * q.src ** 2 + vcl * q.cl + roc * q.cl ** 2
  })
  values.efficiency = { value: pLoad / (pLoad + pDev || 1), formula: 'η = P_R / (P_R + P_source path + P_clamp path)', kind: 'exact' }

  if (dfw) {
    const fwX = extremes(iFw, θs, θs + TWO_PI)
    const fwOn = Number.isFinite(θz) ? θz - θe : θs + P - θe
    Object.assign(values, {
      ifwAvg: { value: avg(iFw), formula: 'IDfw,avg = (1/2π)∫ i_fw dθ', kind: 'exact' },
      ifwPeak: { value: fwX.max, formula: 'IDfw,pk = i(θe) (the current it inherits)', kind: 'exact' },
      ...(βs === null ? { fwConductionDeg: { value: deg(n * fwOn), formula: mode === 'continuous' ? `γ(Dfw) = ${n}·(θs + ${n === 1 ? '360°' : '180°'} − θe)` : `γ(Dfw) = ${n}·(θz − θe)`, kind: 'exact' } } : {}),
    })
  }
  if (semi && dfw) {
    // While Dfw freewheels, the whole bridge is off and floats: how its blocking voltage divides
    // between the (un-gated) SCRs and the diodes is set by leakage, not by this model.
    delete values.piv
    if (vf === 0 && ron === 0) {
      // Ideal devices: Dfw and the bridge's own leg both offer a 0 V path — the split of the
      // freewheel current between them is undetermined.
      for (const k of ['ifwAvg', 'ifwPeak', 'fwConductionDeg', 'idAvg', 'idPeak', 'conductionAngleDeg', 'turnOffAngleDeg', 'turnOnAngleDeg'] as const) delete values[k]
      notes.push('With ideal devices the freewheeling diode and the bridge’s own leg (T1 + D3) both offer a 0 V path, so how the freewheel current splits between them is undetermined (the simulation keeps it in the leg). Use Vf > 0 to see Dfw take over.')
    }
  }
  if (ron > 0) {
    for (const v of Object.values(values)) if (v) v.kind = 'approx'
    notes.push(`With Ron = ${ron} Ω the source path and the clamp share the current for a moment at each hand-over; the formulas ignore that overlap, so every row is an approximation.`)
  }

  notes.unshift(
    `Assumptions: RL load; ${mode} current; ideal sinusoidal source with no source inductance; devices modelled as constant drops (Vf = ${vf} V${ron > 0 ? `, Ron = ${ron} Ω` : ''})${p.control.device === 'scr' ? `; firing angle α = ${deg(α).toFixed(1)}°` : ''}.`,
    dfw
      ? 'The freewheeling diode provides a path for the inductive current when the main source path is unavailable: the load voltage is clamped at −Vf instead of following vin below zero.'
      : 'The semi-controlled bridge freewheels through its own leg (T1 + D3 or T2 + D4) when vin reverses, so the output is clamped at −2Vf — it can never go negative (no inversion).',
  )
  return finish(p, values, [], notes, mode)
}
