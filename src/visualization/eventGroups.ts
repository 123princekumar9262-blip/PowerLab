import { indexAtOrAfter, indexAtTime } from '../simulation/engine.ts'
import type { CircuitEvent, SimulationResult } from '../types/simulation.ts'

/**
 * Events that happen at the same instant, shown as one marker. For an R load,
 * "D1 turns ON" and "Current starts" coincide (and with an ideal diode, so does
 * the zero crossing) — that coincidence is itself something to notice.
 */
export interface EventGroup {
  id: string
  time: number
  events: CircuitEvent[]
  /** 'diode' if any event is a diode/current event; 'output' for ripple crests/valleys. */
  category: 'diode' | 'source' | 'output'
}

const DIODE_KINDS = new Set<CircuitEvent['kind']>(['diode-on', 'diode-off', 'current-start', 'current-stop', 'current-transfer'])

/** Display priority within a group: the switching event first. */
const ORDER: Record<CircuitEvent['kind'], number> = {
  'diode-on': 0,
  'diode-off': 0,
  'current-start': 1,
  'current-stop': 1,
  'vin-zero-rising': 2,
  'vin-zero-falling': 2,
  'vin-positive-peak': 3,
  'vin-negative-peak': 3,
  'vout-max': 4,
  'vout-min': 4,
  'phase-crossing': 5,
  'current-transfer': 1,
  'energy-min': 4,
}

const categoryOf = (k: CircuitEvent['kind']): EventGroup['category'] => (DIODE_KINDS.has(k) ? 'diode' : k === 'vout-max' || k === 'vout-min' || k === 'energy-min' ? 'output' : 'source')
const RANK = { diode: 2, source: 1, output: 0 } as const

export function groupEvents(result: SimulationResult): EventGroup[] {
  // Events closer than this are the same instant (refined times agree to ~1e-15 s).
  const tol = result.params.period * 1e-6
  const groups: EventGroup[] = []
  for (const e of result.events) {
    const last = groups[groups.length - 1]
    if (last && e.time - last.time <= tol) {
      last.events.push(e)
      const c = categoryOf(e.kind)
      if (RANK[c] > RANK[last.category]) last.category = c
    } else {
      groups.push({ id: `g${groups.length}`, time: e.time, events: [e], category: categoryOf(e.kind) })
    }
  }
  for (const g of groups) g.events.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  return groups
}

/**
 * The sample to show for an event group.
 * - Switching events (diode / current): the first sample at or after the event, so the
 *   circuit is displayed in its NEW state ("D1 turns ON" shows D1 ON).
 * - Source events (peaks, zero crossings): the nearest sample. A peak located at
 *   5.0000000001 ms belongs on the 5.000 ms sample, not the next one.
 */
export function groupIndex(result: SimulationResult, g: EventGroup): number {
  if (g.category !== 'diode') return indexAtTime(result, g.time)
  // (Switching events land on the first sample showing the new state.)
  let i = indexAtOrAfter(result, g.time)
  // An event can sit a few ulps after a sample (e.g. ideal diode turn-off at t = T/2, where
  // floating-point sin(π) is still +1e-16). Confirm against the trace that the landing sample
  // really shows the post-event state.
  const sw = g.events.find((e) => e.kind === 'diode-on' || e.kind === 'diode-off')
  if (sw) {
    const want = sw.kind === 'diode-on' ? 1 : 0
    const on = result.trace.diodes.find((d) => d.id === sw.device)?.on ?? result.trace.diodes[0].on
    for (let guard = 0; guard < 3 && i < result.trace.length - 1 && on[i] !== want; guard++) i++
  }
  return i
}
