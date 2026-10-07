import type { CircuitId, LoadType, RectifierTopology } from '../types/simulation.ts'
import type { CircuitModel } from './circuitModel.ts'
import { halfWaveR } from './halfWaveR.ts'

/**
 * Every circuit the lab knows about. Unimplemented ones are listed (so the UI
 * can show them honestly as "coming soon") but have no model.
 */
export interface CircuitEntry {
  id: CircuitId
  topology: RectifierTopology
  load: LoadType
  model: CircuitModel<any> | null
  /** Roadmap phase in which this circuit is planned. */
  phase: number
}

export const CIRCUITS: readonly CircuitEntry[] = [
  { id: 'half-wave:R', topology: 'half-wave', load: 'R', model: halfWaveR, phase: 1 },
  { id: 'full-wave:R', topology: 'full-wave', load: 'R', model: null, phase: 2 },
  { id: 'half-wave:RL', topology: 'half-wave', load: 'RL', model: null, phase: 3 },
  { id: 'half-wave:RC', topology: 'half-wave', load: 'RC', model: null, phase: 4 },
  { id: 'half-wave:RLC', topology: 'half-wave', load: 'RLC', model: null, phase: 5 },
]

export const TOPOLOGIES: ReadonlyArray<{ id: RectifierTopology; label: string; phase: number }> = [
  { id: 'half-wave', label: 'Half-wave', phase: 1 },
  { id: 'full-wave', label: 'Full-wave', phase: 2 },
]

export const LOADS: ReadonlyArray<{ id: LoadType; label: string; phase: number }> = [
  { id: 'R', label: 'R', phase: 1 },
  { id: 'RL', label: 'RL', phase: 3 },
  { id: 'RC', label: 'RC', phase: 4 },
  { id: 'RLC', label: 'RLC', phase: 5 },
]

export function isAvailable(topology: RectifierTopology, load: LoadType): boolean {
  return CIRCUITS.some((c) => c.topology === topology && c.load === load && c.model !== null)
}

export function getModel(id: CircuitId): CircuitModel<any> {
  const entry = CIRCUITS.find((c) => c.id === id)
  if (!entry?.model) throw new Error(`Circuit ${id} is not implemented yet.`)
  return entry.model
}
