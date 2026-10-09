import { converterIndexAt } from './engine.ts'
import type { Run, RunEvent } from './types.ts'

/**
 * The sample an event lands on (the workspace's event → cursor rule, shared with the rectifier).
 *  - A switching event (…-on / …-off): the first sample after the event's refined time, moved forward (at
 *    most 3 samples) until the simulated trace shows the new state — a device ON/OFF event lands where that
 *    device is ON/OFF, a gate edge where the gate is.
 *  - A marker (a peak, a maximum, 100 km/h reached): the sample at its time, or the first one after it — the
 *    instant it names, not one step past it.
 */
export function eventSample(r: Run, e: RunEvent): number {
  const on = switchesTo(e)
  const dt = r.params.dt
  if (on === null) return Math.min(r.length - 1, converterIndexAt(r, Math.min(r.params.duration, Math.ceil(e.time / dt - 1e-6) * dt)))
  let k = Math.min(r.length - 1, converterIndexAt(r, Math.min(r.params.duration, (Math.floor(e.time / dt + 1e-6) + 1) * dt)))
  const state = stateOf(r, e)
  for (let g = 0; g < 3 && k < r.length - 1 && state(k) !== on; g++) k++
  return k
}

/** 1 / 0 for an event that switches something ON / OFF; null for a marker (a peak, a maximum). */
const switchesTo = (e: RunEvent): 1 | 0 | null => (/-on$/.test(e.kind) ? 1 : /-off$/.test(e.kind) ? 0 : null)
/** The traced state the event switches (its gate, or its device), at sample i. */
function stateOf(r: Run, e: RunEvent): (i: number) => 1 | 0 | null {
  const gate = e.kind.startsWith('gate') ? r.signals.gate : undefined
  const dev = e.device ? r.devices.find((d) => d.id === e.device) : undefined
  return (i) => (gate ? (gate[i] > 0.5 ? 1 : 0) : dev ? (dev.on[i] ? 1 : 0) : null)
}

/**
 * Is the event still ahead of the cursor at sample k? A later event is. An event exactly on the cursor's
 * sample is ahead only while the trace there does not show its new state yet (the sample holds the interval
 * ending at its time); a marker on the sample — a peak — is the cursor's own instant, not a later one.
 */
export function eventAhead(r: Run, e: RunEvent, k: number): boolean {
  const eps = 1e-9 * r.params.dt
  if (e.time > r.time[k] + eps) return true
  if (e.time < r.time[k] - eps) return false
  const on = switchesTo(e)
  // (an edge at the run's last sample has no later sample to show its new state: nothing to go to)
  if (on === null || k >= r.length - 1) return false
  const s = stateOf(r, e)(k)
  return s !== null && s !== on
}

/** The run's next event after the cursor at sample k (optionally only of the given kinds). */
export function nextRunEvent(r: Run, k: number, kinds?: string[]): RunEvent | null {
  let best: RunEvent | null = null
  for (const e of r.events) if ((!kinds || kinds.includes(e.kind)) && (!best || e.time < best.time) && eventAhead(r, e, k)) best = e
  return best
}
