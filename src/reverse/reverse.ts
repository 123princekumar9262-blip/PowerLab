import { DEVICE_MAP } from '../explanations/threePhase.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import type { LabParams, LoadType, RectifierTopology, SimulationResult } from '../types/simulation.ts'
import { indexAtTime } from '../simulation/engine.ts'
import { resolveTarget } from '../learning/target.ts'
import type { Section } from '../state/labState.ts'

/** Reverse engineering: the student sees only the source and output waveforms. */
export interface ReverseTask {
  section: Section
  topology: RectifierTopology
  load: LoadType
  params: LabParams
  /** Angle (in the last cycle) at which the student must name the conducting devices. */
  probeDeg: number
}

export const RECTIFIER_OPTIONS: Record<Section, Array<{ id: RectifierTopology; label: string }>> = {
  single: [
    { id: 'half-wave', label: 'Single-phase half-wave' },
    { id: 'center-tap', label: 'Single-phase center-tap' },
    { id: 'bridge', label: 'Single-phase bridge' },
  ],
  three: [
    { id: '3ph-half-wave', label: 'Three-phase half-wave (3-pulse)' },
    { id: '3ph-bridge', label: 'Three-phase bridge (6-pulse)' },
    { id: '3ph-half-controlled', label: 'Three-phase half-controlled bridge' },
  ],
}
export const LOAD_OPTIONS: LoadType[] = ['R', 'RL', 'RC']

export function randomReverseTask(section: Section, rand: () => number = Math.random): ReverseTask {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const topology = pick(RECTIFIER_OPTIONS[section]).id
  const load = pick(section === 'three' ? (['R', 'RL'] as const) : LOAD_OPTIONS)
  const base = section === 'three' ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS
  const params: LabParams = {
    ...base,
    source: { ...base.source, vrms: pick([9, 12, 15]) },
    load: { resistance: pick([10, 22]), inductance: section === 'three' ? pick([0.01, 0.03]) : 0.05, capacitance: pick([470e-6, 1000e-6]) },
    control: base.control ? { ...base.control, device: 'diode', alphaDeg: pick([30, 45, 60]) } : undefined,
    sim: { ...base.sim, cycles: 8 },
  }
  return { section, topology, load, params, probeDeg: pick([15, 45, 75, 105, 135, 165, 200, 250, 290, 330]) }
}

/** Pulses per cycle and the conducting devices at the probe angle — read from the simulation. */
export function reverseAnswers(task: ReverseTask, result: SimulationResult, rippleFrequency: number | null) {
  const pulses = rippleFrequency === null ? null : Math.round(rippleFrequency / result.params.frequency)
  const i = indexAtTime(result, resolveTarget(result, { angleDeg: task.probeDeg }))
  const on = result.trace.diodes.filter((d) => d.on[i] === 1).map((d) => d.id)
  return { pulses, conducting: on.sort().join(' + ') || 'none' }
}

/** Candidate answers for the "which devices conduct?" question. */
export function conductingOptions(topology: RectifierTopology): string[] {
  if (topology === 'half-wave') return ['D1', 'none']
  if (topology === 'center-tap') return ['D1', 'D2', 'none']
  if (topology === 'bridge') return ['D1 + D4', 'D2 + D3', 'none']
  if (topology === '3ph-half-wave') return ['Da', 'Db', 'Dc']
  // Six-pulse pairs (upper, lower) in conduction order.
  const ups = Object.entries(DEVICE_MAP).filter(([k, v]) => /^D\d$/.test(k) && v.upper)
  const los = Object.entries(DEVICE_MAP).filter(([k, v]) => /^D\d$/.test(k) && !v.upper)
  const out: string[] = []
  for (const [u, uv] of ups) for (const [l, lv] of los) if (uv.phase !== lv.phase) out.push([u, l].sort().join(' + '))
  return out.sort()
}
