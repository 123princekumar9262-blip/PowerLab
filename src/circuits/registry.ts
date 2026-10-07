import type { CircuitId, LoadType, RectifierTopology } from '../types/simulation.ts'
import type { CircuitModel } from './circuitModel.ts'
import { rectifierModel } from './rectifier.ts'

export const TOPOLOGIES: ReadonlyArray<{ id: RectifierTopology; label: string; short: string; phase: number }> = [
  { id: 'half-wave', label: 'Half-wave', short: 'Half-wave', phase: 1 },
  { id: 'center-tap', label: 'Full-wave · center-tap', short: 'Center-tap', phase: 2 },
  { id: 'bridge', label: 'Full-wave · bridge', short: 'Bridge', phase: 2 },
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
