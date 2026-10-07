import type { CircuitId, LoadType, RectifierTopology } from '../types/simulation.ts'
import type { CircuitModel } from './circuitModel.ts'
import { rectifierModel } from './rectifier.ts'

export const TOPOLOGIES: ReadonlyArray<{ id: RectifierTopology; label: string; short: string; phase: number; phases: 1 | 3 }> = [
  { id: 'half-wave', label: 'Half-wave', short: 'Half-wave', phase: 1, phases: 1 },
  { id: 'center-tap', label: 'Full-wave · center-tap', short: 'Center-tap', phase: 2, phases: 1 },
  { id: 'bridge', label: 'Full-wave · bridge', short: 'Bridge', phase: 2, phases: 1 },
  { id: 'semi-bridge', label: 'Single-phase semi-controlled bridge (2 SCRs + 2 diodes)', short: 'Semi-controlled', phase: 1, phases: 1 },
  { id: '3ph-half-wave', label: 'Three-phase half-wave (3-pulse, midpoint)', short: '3-pulse', phase: 1, phases: 3 },
  { id: '3ph-bridge', label: 'Three-phase bridge (6-pulse)', short: '6-pulse bridge', phase: 1, phases: 3 },
  { id: '3ph-half-controlled', label: 'Three-phase half-controlled bridge (3 SCRs + 3 diodes)', short: 'Half-controlled', phase: 1, phases: 3 },
]

/**
 * The rectifiers a student can pick: a topology plus its switching devices. "Controlled"
 * versions of the half-wave, bridge and 6-pulse rectifiers are the same netlists with SCRs.
 * This catalog drives the circuit picker and Compare mode — only implemented circuits appear.
 */
export interface RectifierChoice {
  key: string
  label: string
  short: string
  topology: RectifierTopology
  device: 'diode' | 'scr'
  phases: 1 | 3
  group: 'Uncontrolled' | 'Controlled'
}
export const RECTIFIERS: ReadonlyArray<RectifierChoice> = [
  { key: 'hw', label: 'Single-phase half-wave', short: 'Half-wave', topology: 'half-wave', device: 'diode', phases: 1, group: 'Uncontrolled' },
  { key: 'ct', label: 'Single-phase full-wave center-tapped', short: 'Center-tap', topology: 'center-tap', device: 'diode', phases: 1, group: 'Uncontrolled' },
  { key: 'br', label: 'Single-phase full-wave bridge', short: 'Bridge', topology: 'bridge', device: 'diode', phases: 1, group: 'Uncontrolled' },
  { key: 'hw-scr', label: 'Single-phase half-wave controlled', short: 'Half-wave controlled', topology: 'half-wave', device: 'scr', phases: 1, group: 'Controlled' },
  { key: 'semi', label: 'Single-phase semi-controlled bridge', short: 'Semi-controlled', topology: 'semi-bridge', device: 'scr', phases: 1, group: 'Controlled' },
  { key: 'br-scr', label: 'Single-phase fully controlled bridge', short: 'Fully controlled', topology: 'bridge', device: 'scr', phases: 1, group: 'Controlled' },
  { key: '3p', label: 'Three-phase 3-pulse (half-wave)', short: '3-pulse', topology: '3ph-half-wave', device: 'diode', phases: 3, group: 'Uncontrolled' },
  { key: '6p', label: 'Three-phase 6-pulse diode bridge', short: '6-pulse bridge', topology: '3ph-bridge', device: 'diode', phases: 3, group: 'Uncontrolled' },
  { key: '3p-scr', label: 'Three-phase 3-pulse controlled', short: '3-pulse controlled', topology: '3ph-half-wave', device: 'scr', phases: 3, group: 'Controlled' },
  { key: 'hc', label: 'Three-phase half-controlled bridge', short: 'Half-controlled', topology: '3ph-half-controlled', device: 'scr', phases: 3, group: 'Controlled' },
  { key: '6p-scr', label: 'Three-phase fully controlled bridge', short: 'Fully controlled bridge', topology: '3ph-bridge', device: 'scr', phases: 3, group: 'Controlled' },
]

/** The catalog entry for a topology + device combination. */
export function rectifierChoice(topology: RectifierTopology, device: 'diode' | 'scr'): RectifierChoice | undefined {
  return RECTIFIERS.find((r) => r.topology === topology && (r.device === device || topology === 'semi-bridge' || topology === '3ph-half-controlled'))
}

export const LOADS: ReadonlyArray<{ id: LoadType; label: string; name: string; phase: number }> = [
  { id: 'R', label: 'R', name: 'Resistive', phase: 1 },
  { id: 'RL', label: 'RL', name: 'Resistive-inductive', phase: 3 },
  { id: 'RC', label: 'RC', name: 'Capacitor filter', phase: 4 },
  { id: 'RLC', label: 'RLC', name: 'LC (choke-input) filter', phase: 5 },
]

/** Every topology × load combination is built from the same netlist engine. */
export function isAvailable(_topology: RectifierTopology, _load: LoadType): boolean {
  return true
}

const cache = new Map<CircuitId, CircuitModel<any>>()

export function getModel(id: CircuitId): CircuitModel<any> {
  let m = cache.get(id)
  if (!m) {
    const [topology, load] = id.split(':') as [RectifierTopology, LoadType]
    if (!TOPOLOGIES.some((t) => t.id === topology) || !LOADS.some((l) => l.id === load)) throw new Error(`Unknown circuit ${id}`)
    m = rectifierModel(topology, load)
    cache.set(id, m)
  }
  return m
}
