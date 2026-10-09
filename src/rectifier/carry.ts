import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import { alwaysControlled, isThreePhase, type LabParams, type LoadType, type RectifierTopology } from '../types/simulation.ts'
import { formatSI } from '../utils/format.ts'
import type { CarryReport } from '../workspace/carry.ts'

/**
 * The Rectifier Lab's rule for "Change circuit": the previous circuit's values are kept wherever the new
 * circuit uses them (source, load, devices, simulation settings; α if it has SCRs; Ls, Rs and the sequence if
 * it is three-phase). Values it does not use stay remembered and are reported, never silently dropped.
 * The circuit's own device type comes from the destination; the route's explicit values (α, Ls, Dfw — the
 * entry points) are applied afterwards by the lab and win.
 */
export function carryRectifier(prev: LabParams, topology: RectifierTopology, device: 'diode' | 'scr', load: LoadType): { params: LabParams; report: CarryReport } {
  const three = isThreePhase(topology)
  const base = three ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS
  const scr = alwaysControlled(topology) || device === 'scr'
  const prevCtl = prev.control ?? { device: 'diode' as const, alphaDeg: 30, freewheel: false }
  const params: LabParams = {
    ...base,
    source: { ...prev.source },
    diode: { ...prev.diode },
    load: { ...prev.load },
    sim: { ...prev.sim },
    control: { device, alphaDeg: prevCtl.alphaDeg, freewheel: false },
    threePhase: prev.threePhase ? { ...prev.threePhase } : base.threePhase,
  }
  const kept: string[] = []
  const notUsed: string[] = []
  const differs = (a: number, b: number) => Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b))
  if (differs(prev.source.vrms, base.source.vrms)) kept.push(`${three ? 'phase voltage' : 'Vrms'} = ${formatSI(prev.source.vrms, 'V')}`)
  if (differs(prev.source.frequency, base.source.frequency)) kept.push(`f = ${formatSI(prev.source.frequency, 'Hz')}`)
  if (differs(prev.load.resistance, base.load.resistance)) kept.push(`R = ${formatSI(prev.load.resistance, 'Ω')}`)
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  if (hasL && differs(prev.load.inductance, base.load.inductance)) kept.push(`L = ${formatSI(prev.load.inductance, 'H')}`)
  if (hasC && differs(prev.load.capacitance, base.load.capacitance)) kept.push(`C = ${formatSI(prev.load.capacitance, 'F')}`)
  if (prev.diode.model !== base.diode.model || differs(prev.diode.vf, base.diode.vf) || differs(prev.diode.ron, base.diode.ron)) kept.push(`device model (${prev.diode.model === 'ideal' ? 'ideal' : `Vf = ${formatSI(prev.diode.vf, 'V')}`})`)
  const alphaDefault = base.control?.alphaDeg ?? 30
  if (differs(prevCtl.alphaDeg, alphaDefault)) (scr ? kept : notUsed).push(scr ? `α = ${prevCtl.alphaDeg}°` : `α = ${prevCtl.alphaDeg}° (no SCRs in this circuit)`)
  const tp = prev.threePhase
  if (tp && (tp.ls > 0 || tp.rs > 0)) (three ? kept : notUsed).push(three ? `source Ls = ${formatSI(tp.ls, 'H')}, Rs = ${formatSI(tp.rs, 'Ω')}` : 'source Ls / Rs (three-phase only)')
  if (prev.faults && Object.keys(prev.faults).length) notUsed.push('the injected fault (an experiment of the previous circuit)')
  return { params, report: { kept, notUsed } }
}
