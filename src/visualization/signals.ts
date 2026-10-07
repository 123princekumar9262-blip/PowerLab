import { isThreePhase, type RectifierTopology, type SignalId } from '../types/simulation.ts'

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
  /** Offered in the legend but off by default (e.g. individual diode currents). */
  optional?: boolean
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
  vb: { id: 'vb', label: 'VbN', name: 'Phase b voltage (to neutral)', unit: 'V', cssVar: '--sig-pb' },
  vc: { id: 'vc', label: 'VcN', name: 'Phase c voltage (to neutral)', unit: 'V', cssVar: '--sig-pc' },
  vab: { id: 'vab', label: 'Vab', name: 'Line voltage a−b', unit: 'V', cssVar: '--sig-pa', dash: [2, 4], optional: true },
  vbc: { id: 'vbc', label: 'Vbc', name: 'Line voltage b−c', unit: 'V', cssVar: '--sig-pb', dash: [2, 4], optional: true },
  vca: { id: 'vca', label: 'Vca', name: 'Line voltage c−a', unit: 'V', cssVar: '--sig-pc', dash: [2, 4], optional: true },
  id3: { id: 'id3', label: 'Id3', name: 'Diode 3 current', unit: 'A', cssVar: '--sig-pb', dashed: true, optional: true },
  id4: { id: 'id4', label: 'Id4', name: 'Diode 4 current', unit: 'A', cssVar: '--sig-pa', dash: [2, 3], optional: true },
  id5: { id: 'id5', label: 'Id5', name: 'Diode 5 current', unit: 'A', cssVar: '--sig-pc', dashed: true, optional: true },
  id6: { id: 'id6', label: 'Id6', name: 'Diode 6 current', unit: 'A', cssVar: '--sig-pb', dash: [2, 3], optional: true },
  // Freewheeling diode: its own colour (validated against Io/Id1 in the current lane and Vd1 in
  // the diode-voltage lane). Vfw = −Vout exactly, so it is offered but off by default.
  ifw: { id: 'ifw', label: 'Ifw', name: 'Freewheeling diode Dfw current', unit: 'A', cssVar: '--sig-fw' },
  vfw: { id: 'vfw', label: 'Vfw', name: 'Freewheeling diode voltage, anode − cathode (= −Vout)', unit: 'V', cssVar: '--sig-fw', optional: true },
}

/**
 * Three-phase overrides. Phase colours follow the R-Y-B convention as closely as the
 * validated palette allows: phase a magenta, b amber, c blue (all-pairs validated, dark
 * surface). Vo is bright neutral so it never competes with a phase. Each diode current takes
 * its PHASE colour — upper diodes dashed, lower diodes dotted (secondary encoding).
 */
const THREE_PHASE_META: Partial<Record<SignalId, Partial<SignalMeta>>> = {
  vin: { label: 'VaN', name: 'Phase a voltage (to neutral)', cssVar: '--sig-pa' },
  vout: { label: 'Vo', name: 'DC output voltage', cssVar: '--sig-vout3' },
  vd: { label: 'Vd1', name: 'Diode D1 voltage', cssVar: '--sig-pa', optional: true },
  id: { label: 'Id1', name: 'D1 current (upper, phase a)', cssVar: '--sig-pa', dashed: true, dash: undefined, optional: true },
  id2: { label: 'Id2', name: 'D2 current (lower, phase c)', cssVar: '--sig-pc', dashed: false, dash: [2, 3], optional: true },
  id3: { name: 'D3 current (upper, phase b)' },
  id4: { name: 'D4 current (lower, phase a)' },
  id5: { name: 'D5 current (upper, phase c)' },
  id6: { name: 'D6 current (lower, phase b)' },
  // Three-phase capacitor loads also use violet (IC): Ifw is dashed there and off by default.
  ifw: { dashed: true, optional: true },
}
const HALF_WAVE_3PH_META: Partial<Record<SignalId, Partial<SignalMeta>>> = {
  vd: { label: 'VDa', name: 'Diode Da voltage' },
  id: { label: 'IDa', name: 'Da current (phase a)', dash: undefined },
  id2: { label: 'IDb', name: 'Db current (phase b)', cssVar: '--sig-pb', dashed: true, dash: undefined },
  id3: { label: 'IDc', name: 'Dc current (phase c)', cssVar: '--sig-pc', dashed: true, dash: undefined },
}

/** Signal metadata for a given topology (three-phase relabels and recolours some signals). */
export function metaFor(sid: SignalId, topology: RectifierTopology): SignalMeta {
  const base = SIGNAL_META[sid]
  if (!isThreePhase(topology)) return base
  const over = { ...THREE_PHASE_META[sid], ...(topology === '3ph-half-wave' ? HALF_WAVE_3PH_META[sid] : {}) }
  return { ...base, ...over }
}

/** Every CSS variable any signal may use (the renderer resolves them once). */
export const SIGNAL_CSS_VARS = ['--sig-vin', '--sig-vrect', '--sig-vout', '--sig-vout3', '--sig-vd', '--sig-d2', '--sig-l', '--sig-io', '--sig-id', '--sig-c', '--sig-pa', '--sig-pb', '--sig-pc', '--sig-fw']

/** How the scope arranges traces. */
export type ScopeLayoutMode = 'overlay' | 'grouped' | 'separate'

/** A lane: one plot area. Grouped/separate lanes have one unit; the overlay lane may mix units. */
export interface LaneSpec {
  id: string
  title: string
  signals: SignalId[]
}

const GROUPS: ReadonlyArray<{ id: string; title: string; signals: SignalId[] }> = [
  { id: 'voltage', title: 'Source & output', signals: ['vin', 'vb', 'vc', 'vab', 'vbc', 'vca', 'vrect', 'vout'] },
  { id: 'inductor', title: 'Inductor voltage', signals: ['vl'] },
  { id: 'diode', title: 'Diode voltages', signals: ['vd', 'vd2', 'vfw'] },
  { id: 'current', title: 'Currents', signals: ['io', 'il', 'ic', 'id', 'id2', 'id3', 'id4', 'id5', 'id6', 'ifw'] },
  { id: 'energy', title: 'Stored energy', signals: ['wl', 'wc'] },
  { id: 'power', title: 'Power', signals: ['ps', 'pload', 'pd'] },
]

/** Lanes for a set of visible signals in the chosen layout. Empty lanes are dropped. */
export function lanesFor(visible: SignalId[], mode: ScopeLayoutMode, topology: RectifierTopology = 'half-wave'): LaneSpec[] {
  if (mode === 'overlay') return visible.length ? [{ id: 'overlay', title: 'All channels', signals: visible }] : []
  if (mode === 'separate') return visible.map((s) => ({ id: s, title: metaFor(s, topology).name, signals: [s] }))
  return GROUPS.map((g) => ({ ...g, signals: g.signals.filter((s) => visible.includes(s)) })).filter((g) => g.signals.length > 0)
}
