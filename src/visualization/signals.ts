import type { SignalId } from '../types/simulation.ts'

export interface SignalMeta {
  id: SignalId
  /** Short label used on the scope and in readouts. */
  label: string
  /** What the signal physically is. */
  name: string
  unit: 'V' | 'A'
  /** CSS custom property holding the trace color (validated palette, see styles). */
  cssVar: string
  /** Drawn dashed so it stays visible when it overlaps another trace (Id lies exactly on Io). */
  dashed?: boolean
}

export const SIGNAL_META: Record<SignalId, SignalMeta> = {
  vin: { id: 'vin', label: 'Vin', name: 'Source voltage', unit: 'V', cssVar: '--sig-vin' },
  vout: { id: 'vout', label: 'Vout', name: 'Load (output) voltage', unit: 'V', cssVar: '--sig-vout' },
  vd: { id: 'vd', label: 'Vd', name: 'Diode voltage, anode − cathode', unit: 'V', cssVar: '--sig-vd' },
  io: { id: 'io', label: 'Io', name: 'Load current', unit: 'A', cssVar: '--sig-io' },
  id: { id: 'id', label: 'Id', name: 'Diode current', unit: 'A', cssVar: '--sig-id', dashed: true },
}

/** Scope lanes: each lane has one unit and one y-axis (never two scales on one plot). */
export interface LaneSpec {
  id: string
  title: string
  unit: 'V' | 'A'
  signals: SignalId[]
}

export const LANES: readonly LaneSpec[] = [
  { id: 'voltage', title: 'Source & output', unit: 'V', signals: ['vin', 'vout'] },
  { id: 'diode', title: 'Diode voltage', unit: 'V', signals: ['vd'] },
  { id: 'current', title: 'Currents', unit: 'A', signals: ['io', 'id'] },
]
