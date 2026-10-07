import type { SignalId } from '../types/simulation.ts'

export type Unit = 'V' | 'A' | 'J' | 'W'

export interface SignalMeta {
  id: SignalId
  /** Short label used on the scope and in readouts. */
  label: string
  /** What the signal physically is. */
  name: string
  unit: Unit
  /** CSS custom property holding the trace color. Color follows the ENTITY (source, D1, L, C…). */
  cssVar: string
  /** Drawn dashed (secondary encoding, e.g. Id lies exactly on Io for an R load). */
  dashed?: boolean
  /** Custom dash pattern [px], overrides the default dash. */
  dash?: number[]
  /** Hidden until the student asks for it (energy & power). */
  advanced?: boolean
}

export const SIGNAL_META: Record<SignalId, SignalMeta> = {
  vin: { id: 'vin', label: 'Vin', name: 'Source voltage', unit: 'V', cssVar: '--sig-vin' },
  vrect: { id: 'vrect', label: 'Vrect', name: 'Rectifier output voltage (before the filter)', unit: 'V', cssVar: '--sig-vrect' },
  vout: { id: 'vout', label: 'Vout', name: 'Load (output) voltage', unit: 'V', cssVar: '--sig-vout' },
  vd: { id: 'vd', label: 'Vd1', name: 'Diode D1 voltage, anode − cathode', unit: 'V', cssVar: '--sig-vd' },
  vd2: { id: 'vd2', label: 'Vd2', name: 'Diode D2 voltage, anode − cathode', unit: 'V', cssVar: '--sig-d2' },
  vl: { id: 'vl', label: 'VL', name: 'Inductor voltage L·di/dt', unit: 'V', cssVar: '--sig-l' },
  io: { id: 'io', label: 'Io', name: 'Load-resistor current', unit: 'A', cssVar: '--sig-io' },
  id: { id: 'id', label: 'Id1', name: 'Diode D1 current', unit: 'A', cssVar: '--sig-id', dashed: true },
  id2: { id: 'id2', label: 'Id2', name: 'Diode D2 current', unit: 'A', cssVar: '--sig-d2', dashed: true },
  il: { id: 'il', label: 'IL', name: 'Inductor current', unit: 'A', cssVar: '--sig-l', dashed: true, dash: [12, 4] },
  ic: { id: 'ic', label: 'IC', name: 'Capacitor current (+ = charging)', unit: 'A', cssVar: '--sig-c' },
  wl: { id: 'wl', label: 'WL', name: 'Energy stored in L, ½·L·i²', unit: 'J', cssVar: '--sig-l', advanced: true },
  wc: { id: 'wc', label: 'WC', name: 'Energy stored in C, ½·C·v²', unit: 'J', cssVar: '--sig-c', advanced: true },
  ps: { id: 'ps', label: 'Ps', name: 'Power delivered by the source', unit: 'W', cssVar: '--sig-vin', advanced: true },
  pload: { id: 'pload', label: 'PR', name: 'Power dissipated in R', unit: 'W', cssVar: '--sig-io', advanced: true },
  pd: { id: 'pd', label: 'PD', name: 'Power lost in the diodes', unit: 'W', cssVar: '--sig-id', dashed: true, advanced: true },
}

/** How the scope arranges traces. */
export type ScopeLayoutMode = 'overlay' | 'grouped' | 'separate'

/** A lane: one plot area. Grouped/separate lanes have one unit; the overlay lane may mix units. */
export interface LaneSpec {
  id: string
  title: string
  signals: SignalId[]
}

const GROUPS: ReadonlyArray<{ id: string; title: string; signals: SignalId[] }> = [
  { id: 'voltage', title: 'Source & output', signals: ['vin', 'vrect', 'vout'] },
  { id: 'inductor', title: 'Inductor voltage', signals: ['vl'] },
  { id: 'diode', title: 'Diode voltages', signals: ['vd', 'vd2'] },
  { id: 'current', title: 'Currents', signals: ['io', 'il', 'ic', 'id', 'id2'] },
  { id: 'energy', title: 'Stored energy', signals: ['wl', 'wc'] },
  { id: 'power', title: 'Power', signals: ['ps', 'pload', 'pd'] },
]

/** Lanes for a set of visible signals in the chosen layout. Empty lanes are dropped. */
export function lanesFor(visible: SignalId[], mode: ScopeLayoutMode): LaneSpec[] {
  if (mode === 'overlay') return visible.length ? [{ id: 'overlay', title: 'All channels', signals: visible }] : []
  if (mode === 'separate') return visible.map((s) => ({ id: s, title: SIGNAL_META[s].name, signals: [s] }))
  return GROUPS.map((g) => ({ ...g, signals: g.signals.filter((s) => visible.includes(s)) })).filter((g) => g.signals.length > 0)
}
