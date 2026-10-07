import type { SimulationResult } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatV } from '../utils/format.ts'
import type { StateExplanation } from './rectifier.ts'

/** One stage of the Physics Lens: what happened, why, and the governing equation. */
export interface LensStage {
  key: string
  title: string
  what: string
  why: string
  equation: string
  /** Which part of the schematic to emphasise (matches the diagram's lens CSS). */
  highlight: 'source' | 'condition' | 'diode' | 'path' | 'output' | 'waveform'
}

/**
 * The guided walk SOURCE → INSTANTANEOUS VOLTAGES → DIODE DECISION → CURRENT PATH →
 * OUTPUT VOLTAGE → LOAD RESPONSE, built from the explanation of the current instant
 * (which is itself built only from the simulation state).
 */
export function lensStages(result: SimulationResult, ex: StateExplanation): LensStage[] {
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
