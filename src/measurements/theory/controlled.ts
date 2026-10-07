import type { ResolvedParams } from '../../types/simulation.ts'
import { extremes, firstRoot } from './numeric.ts'
import { periodicRL } from './threePhase.ts'
import { deg, finish, fromWaveform, none, pathDrops, pivAt, TWO_PI, type Theory, type Waveform } from './waveform.ts'
import { approxIfRon } from './index.ts'

/**
 * Single-phase controlled rectifiers (SCRs, firing angle α) with an RL load and no freewheel
 * path: half-wave controlled, center-tap and fully controlled bridge. Independent of the
 * simulator: the steady-state current is written analytically and checked for continuity.
 *
 *   conduction from θs:  L·di/dt + (R + Ront)·i = Vm·sinθ − Vft,  i(θs) = i0
 *   i(θ) = (Vm/Z)·sin(θ − φ) − Vft/Reff + [i0 − (Vm/Z)·sin(θs − φ) + Vft/Reff]·e^(−(θ−θs)/ωτ)
 *
 * Half-wave: from θs = max(α, θ₁) with i = 0 until the extinction angle β (i(β) = 0) — the
 * current always dies, so there is one pulse per cycle.
 * Full-wave: each pair is fired at α (and α + 180°). If the current never reaches zero the
 * outgoing pair is turned off by the incoming one (continuous): the periodic solution over
 * [α, α + 180°], Vdc = (2Vm/π)·cos α − drops — negative for α > 90° (inversion). Otherwise each
 * pulse starts from zero at θs and dies at β < θs + 180° (discontinuous).
 */
export function controlledRL(p: ResolvedParams): Theory {
  const { n, vft, ront } = pathDrops(p)
  const { vm, omega } = p
  const R = p.resistance
  const Reff = R + ront
  const X = omega * p.inductance
  const Z = Math.hypot(Reff, X)
  const φ = Math.atan2(X, Reff)
  const wt = X / Reff
  const α = p.control.alpha
  const θ1 = Math.asin(Math.min(1, vft / vm))
  if (!(vm > vft)) return none(p, ['The source peak never exceeds the device drops: no conduction.'])
  const pulse = (θs: number, i0: number) => (θ: number) => (vm / Z) * Math.sin(θ - φ) - vft / Reff + (i0 - (vm / Z) * Math.sin(θs - φ) + vft / Reff) * Math.exp(-(θ - θs) / wt)
  const notes: string[] = []
  const assume = (mode: string) =>
    `Assumptions: RL load; ${mode} current; ideal sinusoidal source with no source inductance; SCRs as constant drops (Vf = ${p.diode.vf} V${p.diode.ron > 0 ? `, Ron = ${p.diode.ron} Ω` : ''}); firing angle α = ${deg(α).toFixed(1)}°.`

  if (n === 1) {
    const θs = Math.max(α, θ1)
    if (θs >= Math.PI - θ1) return none(p, [`The SCR is fired at α = ${deg(α).toFixed(1)}°, when the source can no longer forward bias it: no conduction.`])
    const i = pulse(θs, 0)
    const β = firstRoot(i, θs + 1e-5, θs + TWO_PI) ?? θs + TWO_PI
    const io = (θ: number) => (θ > θs && θ < β ? Math.max(0, i(θ)) : 0)
    const vo = (θ: number) => (io(θ) > 0 ? vm * Math.sin(θ) - vft - ront * io(θ) : 0)
    const w: Waveform = { a: θs, breaks: [β], vout: vo, io, iD1: io, irect: io, piv: (θ) => pivAt(p, θ, vo(θ), io(θ)), turnOn: θs, turnOff: β }
    notes.push(assume('discontinuous'), `The SCR fires at θ = ${deg(θs).toFixed(1)}° and the inductor keeps it on until the current reaches zero at the extinction angle β = ${deg(β).toFixed(2)}° (solved from i(β) = 0, not assumed).`)
    return finish(
      p,
      fromWaveform(p, w, {
        voutAvg: 'Vdc = R·Idc  (avg vL = 0)',
        ioAvg: 'Idc = (1/2π)∫α..β i(θ) dθ',
        turnOnAngleDeg: 'θon = max(α, asin(Vf/Vm))',
        turnOffAngleDeg: 'β: i(β) = 0',
        conductionAngleDeg: 'γ = β − θon',
      }),
      [],
      notes,
      'discontinuous',
    )
  }

  // ── Full-wave: continuous candidate (periodic over [α, α + π]) ─────────────────
  const ic = periodicRL((θ) => vm * Math.sin(θ) - vft, Math.PI, Reff, X, α)
  const continuous = extremes(ic, α, α + Math.PI, 4000).min > 0
  let w: Waveform
  let mode: 'continuous' | 'discontinuous'
  const frame = (θ: number, a: number) => {
    const x = (((θ - a) % TWO_PI) + TWO_PI) % TWO_PI
    return { h: a + (x % Math.PI), k: Math.floor(x / Math.PI) }
  }
  if (continuous) {
    mode = 'continuous'
    const io = (θ: number) => ic(frame(θ, α).h)
    const vo = (θ: number) => vm * Math.sin(frame(θ, α).h) - vft - ront * io(θ)
    w = { a: α, breaks: [α + Math.PI], vout: vo, io, iD1: (θ) => (frame(θ, α).k === 0 ? io(θ) : 0), irect: io, piv: (θ) => pivAt(p, θ, vo(θ), io(θ)), turnOn: α, turnOff: α + Math.PI }
    notes.push(assume('continuous'), `Continuous conduction: each SCR pair conducts from its firing at α until the other pair is fired 180° later${α > Math.PI / 2 ? '; with α > 90° the average output is negative (inversion — energy flows back from the inductor to the source)' : ''}.`)
  } else {
    mode = 'discontinuous'
    const θs = Math.max(α, θ1)
    if (θs >= Math.PI - θ1) return none(p, [`The SCRs are fired at α = ${deg(α).toFixed(1)}°, when the source can no longer forward bias them: no conduction.`])
    const i = pulse(θs, 0)
    const β = firstRoot(i, θs + 1e-5, θs + Math.PI) ?? θs + Math.PI
    const io = (θ: number) => {
      const { h } = frame(θ, θs)
      return h < β ? Math.max(0, i(h)) : 0
    }
    const vo = (θ: number) => (io(θ) > 0 ? vm * Math.sin(frame(θ, θs).h) - vft - ront * io(θ) : 0)
    w = {
      a: θs,
      breaks: [β, θs + Math.PI, β + Math.PI],
      vout: vo,
      io,
      iD1: (θ) => (frame(θ, θs).k === 0 ? io(θ) : 0),
      irect: io,
      piv: (θ) => pivAt(p, θ, vo(θ), io(θ)),
      turnOn: θs,
      turnOff: β,
    }
    notes.push(assume('discontinuous'), `Discontinuous: each pulse dies at β = ${deg(β).toFixed(2)}° before the other pair is fired.`)
  }
  const ideal = vft === 0 && ront === 0
  const vals = fromWaveform(p, w, {
      voutAvg: mode === 'continuous' ? (ideal ? 'Vdc = (2Vm/π)·cos α' : 'Vdc = (2Vm/π)·cos α − Vft − Ront·Idc') : 'Vdc = R·Idc  (avg vL = 0)',
      ioAvg: 'Idc = Vdc/R',
      turnOnAngleDeg: mode === 'continuous' ? 'θon = α (gate pulse)' : 'θon = max(α, asin(Vft/Vm))',
      turnOffAngleDeg: mode === 'continuous' ? 'θoff = α + 180° (the other pair is fired)' : 'β: i(β) = 0',
      conductionAngleDeg: mode === 'continuous' ? 'γ = 180° (continuous)' : 'γ = β − θon',
  })
  if (mode === 'continuous') approxIfRon(p, vals, notes)
  return finish(p, vals, [], notes, mode)
}
