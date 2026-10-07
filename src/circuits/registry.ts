import type { CircuitId, LoadType, RectifierTopology } from '../types/simulation.ts'
import type { CircuitModel } from './circuitModel.ts'
import { rectifierModel } from './rectifier.ts'

export const TOPOLOGIES: ReadonlyArray<{ id: RectifierTopology; label: string; short: string; phase: number; phases: 1 | 3 }> = [
  { id: 'half-wave', label: 'Half-wave', short: 'Half-wave', phase: 1, phases: 1 },
  { id: 'center-tap', label: 'Full-wave · center-tap', short: 'Center-tap', phase: 2, phases: 1 },
  { id: 'bridge', label: 'Full-wave · bridge', short: 'Bridge', phase: 2, phases: 1 },
  { id: '3ph-half-wave', label: 'Three-phase half-wave (3-pulse, midpoint)', short: '3-pulse', phase: 1, phases: 3 },
  { id: '3ph-bridge', label: 'Three-phase bridge (6-pulse)', short: '6-pulse bridge', phase: 1, phases: 3 },
  { id: '3ph-half-controlled', label: 'Three-phase half-controlled bridge (3 SCRs + 3 diodes)', short: 'Half-controlled', phase: 1, phases: 3 },
]

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
