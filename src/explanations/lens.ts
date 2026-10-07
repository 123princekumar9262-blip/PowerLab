import { sineSource } from '../simulation/source.ts'
import type { SimulationResult } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import type { StateExplanation } from './rectifier.ts'

/** One stage of the Physics Lens: what happened, why, and the governing equation. */
export interface LensStage {
  key: string
  title: string
  what: string
  why: string
  equation: string
  /** Which part of the schematic to emphasise (matches the diagram's lens CSS). */
  highlight: 'source' | 'condition' | 'diode' | 'path' | 'output' | 'waveform' | `fw-${string}`
}

/**
 * The guided walk SOURCE → INSTANTANEOUS VOLTAGES → DIODE DECISION → CURRENT PATH →
 * OUTPUT VOLTAGE → LOAD RESPONSE, built from the explanation of the current instant
 * (which is itself built only from the simulation state).
 */
export function lensStages(result: SimulationResult, ex: StateExplanation): LensStage[] {
  if (ex.freewheel) return freewheelLens(result, ex)
  const p = result.params
  const s = ex.sample
  const c = (stage: string) => ex.chain.find((x) => x.stage === stage)
  const tp = ex.threePhase
  const three = !!tp
  const loadEq = p.load === 'R' ? 'Io = Vo / R' : p.load === 'RL' ? 'Vo = R·i + L·di/dt   (E_L = ½·L·i²)' : p.load === 'RC' ? 'i = C·dVc/dt + Vc/R' : 'Vo = R·i + L·di/dt + Vc,  i = C·dVc/dt'
  return [
    {
      key: 'source',
      title: 'Source',
      highlight: 'source',
      what: three
        ? `A balanced three-phase source: ${formatSI(p.vrms, 'V')} RMS per phase (Vm = ${formatV(p.vm, false)}), ${p.frequency} Hz, sequence ${p.threePhase.sequence}. VLL = √3·Vph = ${formatSI(Math.sqrt(3) * p.vrms, 'V')}.`
        : `A sinusoidal source: ${formatSI(p.vrms, 'V')} RMS (Vm = ${formatV(p.vm, false)}), ${p.frequency} Hz.`,
      why: three ? 'The three phases are displaced by 120°, so at every instant their values are different — one is highest, one lowest.' : 'The source alternates: half the time it pushes forward through the diodes, half the time backward.',
      equation: three ? 'VaN = Vm·sin θ,  VbN = Vm·sin(θ − 120°),  VcN = Vm·sin(θ + 120°)' : 'vin = Vm·sin(ωt + φ)',
    },
    {
      key: 'voltages',
      title: 'Instantaneous voltages',
      highlight: 'source',
      what: three
        ? `At θ = ${formatDeg(ex.angleDeg)}: VaN = ${formatV(tp.phases.a)}, VbN = ${formatV(tp.phases.b)}, VcN = ${formatV(tp.phases.c)}. Order: ${tp.order.map((q) => q.toUpperCase()).join(' > ')}.`
        : `At θ = ${formatDeg(ex.angleDeg)}: vin = ${formatV(s.vin)}.`,
      why: three ? `Phase ${tp.order[0].toUpperCase()} is the most positive and phase ${tp.order[2].toUpperCase()} the most negative right now.` : c('source')?.text ?? '',
      equation: three ? 'highest = max(VaN, VbN, VcN),  lowest = min(VaN, VbN, VcN)' : `vin(θ) = ${formatV(p.vm, false)}·sin θ`,
    },
    {
      key: 'decision',
      title: 'Diode decision',
      highlight: 'condition',
      what: `ON: ${ex.diodes.filter((d) => d.on).map((d) => d.id).join(', ') || 'none'}.  OFF: ${ex.diodes.filter((d) => !d.on).map((d) => d.id).join(', ') || 'none'}.`,
      why: c('condition')?.text ?? '',
      equation: c('condition')?.equation ?? 'ON: iD > 0     OFF: vD ≤ Vf',
    },
    {
      key: 'path',
      title: 'Current path',
      highlight: 'path',
      what: ex.path ? ex.path.join(' → ') : 'No closed path.',
      why: three ? 'A single series loop through the source, the conducting devices and the load: the same current flows in every element of the loop (KCL).' : c('path')?.text ?? '',
      equation: three ? (p.topology === '3ph-half-wave' ? 'io = iD(conducting)' : 'io = i(upper) = i(lower)') : 'io = iD',
    },
    {
      key: 'output',
      title: 'Output voltage',
      highlight: 'output',
      what: `Vo = ${formatV(s.vout)}.`,
      why: c('output')?.text ?? '',
      equation: tp?.outputRelation ?? (p.topology === 'bridge' ? 'Vo = |vin| − 2·Vf' : 'Vo = vin − Vf'),
    },
    {
      key: 'load',
      title: 'Load response',
      highlight: 'waveform',
      what: `Io = ${formatA(s.io)}${p.load !== 'R' ? `, ${ex.current.trend}` : ''}.`,
      why: c('waveform')?.text ?? '',
      equation: loadEq,
    },
  ]
}

/**
 * Physics Lens for the freewheeling diode: SOURCE → RECTIFIER → INDUCTOR → STORED ENERGY →
 * MAIN PATH TURNS OFF → CURRENT MUST CONTINUE → FREEWHEEL PATH AVAILABLE → Dfw TURNS ON →
 * ENERGY DISSIPATED → CURRENT DECAYS. Stages 1–4 describe the cursor instant; stages 5–10 the
 * freewheel interval the cursor is in (or the last one before it), all from the simulation.
 */
function freewheelLens(result: SimulationResult, ex: StateExplanation): LensStage[] {
  const p = result.params
  const s = ex.sample
  const fi = ex.freewheel!
  const src = sineSource(p)
  const θ = (t: number) => formatDeg(src.angleDeg(t))
  const iv = fi.interval
  const tau = p.inductance / p.resistance
  const vf = p.diode.vf
  const vin = s.vin
  const c = (stage: string) => ex.chain.find((x) => x.stage === stage)?.text ?? ''
  const now = fi.mode === 'freewheel' ? 'current' : iv ? (iv.tOn > s.time ? 'next' : 'last') : ''
  const offEvent = iv ? result.events.find((e) => e.device === 'D1' && e.kind === 'diode-off' && Math.abs(e.time - iv.tOn) < p.period * 1e-6) : undefined
  const at = iv ? `at θ = ${θ(iv.tOn)} (t = ${formatTime(iv.tOn)})` : ''
  const lost = iv ? iv.wlStart - iv.wlEnd : 0
  return [
    {
      key: 'source',
      title: '1 · Source',
      highlight: 'fw-source',
      what: `vin = ${formatV(vin)} at θ = ${formatDeg(ex.angleDeg)} — ${vin > 0 ? 'the positive half-cycle' : vin < 0 ? 'the negative half-cycle' : 'a zero crossing'}.`,
      why: 'The source alternates. It can only push current forward through D1; for half of every cycle it pushes the wrong way.',
      equation: `vin = ${formatV(p.vm, false)}·sin(ωt)`,
    },
    {
      key: 'rectifier',
      title: '2 · Rectifier',
      highlight: 'fw-rectifier',
      what: `D1 ${fi.d1.on ? 'ON' : 'OFF'}: vD1 = ${formatV(fi.d1.voltage)}, iD1 = ${formatA(fi.d1.current)}.`,
      why: c('diode'),
      equation: 'ON: iD1 > 0     OFF: vD1 = vin − Vout ≤ Vf',
    },
    {
      key: 'inductor',
      title: '3 · Inductor',
      highlight: 'fw-inductor',
      what: `iL = ${formatA(fi.il)}, vL = ${formatV(fi.vl)}.`,
      why: 'The current through an ideal inductor cannot change instantaneously: any change needs a voltage vL = L·di/dt, and a sudden change would need an infinite one. ' + c('inductor'),
      equation: 'vL = L·di/dt   ⇔   di/dt = (Vout − R·i)/L',
    },
    {
      key: 'energy',
      title: '4 · Stored energy',
      highlight: 'fw-energy',
      what: `E_L = ½·L·i² = ${formatSI(fi.wl, 'J')} — ${fi.energyTrend === 'storing' ? `storing ${formatW(fi.pL)}` : fi.energyTrend === 'releasing' ? `releasing ${formatW(-fi.pL)}` : 'empty'}.`,
      why: fi.energyText,
      equation: 'E_L = ½·L·i²,   dE_L/dt = vL·i',
    },
    {
      key: 'mainoff',
      title: '5 · Main path turns off',
      highlight: 'fw-mainoff',
      what: iv && offEvent
        ? `D1 turned off ${at} (${now} freewheel interval), still carrying io = ${formatA(offEvent.values.io ?? 0)}.`
        : iv
          ? `D1 stopped supplying the load ${at}.`
          : 'In this run D1 never hands the current over (no freewheel interval).',
      why: `When vin goes below zero, D1 would have to hold Vout = vin − Vf < −Vf. Dfw does not let the output fall below −Vf${vf > 0 ? ` (= −${formatSI(vf, 'V')})` : ''}, so the current leaves D1 and D1 turns off — right at the zero crossing, not at an extinction angle β.`,
      equation: 'D1 OFF when vin < 0  (vD1 = vin + Vf < Vf)',
    },
    {
      key: 'continue',
      title: '6 · Inductor current must continue',
      highlight: 'fw-continue',
      what: iv ? `At that instant iL = ${formatA(iv.iStart)} and E_L = ${formatSI(iv.wlStart, 'J')}.` : `iL = ${formatA(fi.il)}.`,
      why: 'Opening the source loop does not stop the current: the inductor reverses its voltage to keep it flowing. Without a freewheeling diode it would keep D1 on and drive the output negative; with Dfw it finds an easier path.',
      equation: 'i(t⁻) = i(t⁺)   (inductor current is continuous)',
    },
    {
      key: 'path',
      title: '7 · Freewheeling path becomes available',
      highlight: 'fw-path',
      what: 'The only other closed loop for the current is L → R → Dfw → back to L, which does not include the source.',
      why: 'Dfw sits across the load with its anode on the − output. While the source supplies the load, Vout > 0 reverse biases it. As soon as the inductor drives Vout below −Vf, it is forward biased.',
      equation: 'vDfw = −Vout   ⇒   Dfw ON when Vout < −Vf',
    },
    {
      key: 'on',
      title: '8 · Freewheeling diode turns on',
      highlight: 'fw-on',
      what: iv
        ? `Dfw turned on ${at}; at the cursor it is ${fi.fw.on ? `ON, carrying ${formatA(fi.fw.current)} with vDfw = ${formatV(fi.fw.voltage)}` : `OFF (vDfw = ${formatV(fi.fw.voltage)})`}.`
        : `Dfw is ${fi.fw.on ? 'ON' : 'OFF'}.`,
      why: 'The current transfers from D1 to Dfw without changing value — only its path changes. The output is clamped at −Vf instead of following vin negative.',
      equation: 'io = iD1 + iDfw = continuous;   Vout = −Vf',
    },
    {
      key: 'dissipate',
      title: '9 · Energy is dissipated',
      highlight: 'fw-dissipate',
      what: iv
        ? `Over the ${now} freewheel interval E_L fell from ${formatSI(iv.wlStart, 'J')} to ${formatSI(iv.wlEnd, 'J')} (${formatSI(lost, 'J')} released): ${formatSI(iv.eR, 'J')} became heat in R and ${formatSI(iv.eDfw, 'J')} was lost in Dfw.`
        : 'No freewheel interval in this run.',
      why: iv ? `With the source cut off, the inductor is the only supplier: released energy = heat in R + loss in Dfw (${formatSI(iv.eR + iv.eDfw, 'J')} vs ${formatSI(lost, 'J')} — energy is conserved).` : '',
      equation: 'ΔE_L = ∫R·i² dt + ∫vDfw·iDfw dt',
    },
    {
      key: 'decay',
      title: '10 · Current decays',
      highlight: 'fw-decay',
      what: iv
        ? `io fell from ${formatA(iv.iStart)} to ${formatA(iv.iEnd)} — ${iv.endedBy === 'zero' ? 'it reached zero before vin returned (discontinuous)' : iv.endedBy === 'D1' ? 'D1 took the current back when vin turned positive (continuous conduction)' : 'still freewheeling at the end of the run'}.`
        : '',
      why: `In the freewheel loop L·di/dt = −R·i − Vf, so the current decays exponentially with τ = L/R = ${formatTime(tau)}. A larger L (or smaller R) keeps more current until the next half-cycle — the load current gets smoother.`,
      equation: 'i(t) = (i₀ + Vf/R)·e^(−t/τ) − Vf/R,   τ = L/R',
    },
  ]
}
