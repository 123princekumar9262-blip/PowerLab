import { isThreePhase, type RectifierTopology, type SignalId } from '../types/simulation.ts'
import { SIGNAL_META } from './signals.ts'

/**
 * Channel presets: which waveforms the scope shows. A preset is a recipe applied to whatever
 * signals the current circuit produces, so it survives changing the circuit. 'custom' means
 * the student picked channels by hand.
 */
export type ChannelPreset = 'basic' | 'diode' | 'load' | 'power' | 'everything' | 'custom'

export const PRESETS: Array<{ id: Exclude<ChannelPreset, 'custom'>; label: string; title: string }> = [
  { id: 'basic', label: 'Basic', title: 'Source, output voltage and load current' },
  { id: 'diode', label: 'Diode analysis', title: 'Output voltage and every device current' },
  { id: 'load', label: 'Load analysis', title: 'Output voltage, load current, inductor and capacitor' },
  { id: 'power', label: 'Power electronics', title: 'Output, load current, device currents and voltages' },
  { id: 'everything', label: 'Everything', title: 'Every channel the circuit produces' },
]

const DEVICE_CURRENTS: SignalId[] = ['id', 'id2', 'id3', 'id4', 'id5', 'id6', 'ifw']
const DEVICE_VOLTAGES: SignalId[] = ['vd', 'vd2', 'vfw']
const ENERGY: SignalId[] = ['wl', 'wc', 'ps', 'pload', 'pd']

/** The channels a preset shows for a circuit producing `signals`. */
export function presetChannels(preset: Exclude<ChannelPreset, 'custom'>, signals: readonly SignalId[], topology: RectifierTopology): SignalId[] {
  const has = (s: SignalId) => signals.includes(s)
  const pick = (list: SignalId[]) => list.filter(has)
  const three = isThreePhase(topology)
  switch (preset) {
    case 'basic':
      // The phases (three-phase) or vin, the output, the load current — and the freewheel
      // current when a freewheeling diode is fitted (it is the point of that circuit).
      return pick(three ? ['vin', 'vb', 'vc', 'vout', 'io'] : ['vin', 'vout', 'io', 'ifw'])
    case 'diode':
      return pick(['vout', ...DEVICE_CURRENTS, ...(three ? [] : DEVICE_VOLTAGES)])
    case 'load':
      return pick(['vout', 'vrect', 'io', 'vl', 'il', 'ic'])
    case 'power':
      return pick(['vout', 'io', ...DEVICE_CURRENTS, ...DEVICE_VOLTAGES])
    case 'everything':
      return [...signals]
  }
}

/** Visibility map for a preset (energy channels added when the energy view is on). */
export function presetVisible(preset: Exclude<ChannelPreset, 'custom'>, signals: readonly SignalId[], topology: RectifierTopology, energy: boolean): Record<SignalId, boolean> {
  const on = new Set(presetChannels(preset, signals, topology))
  if (energy) for (const s of ENERGY) if (signals.includes(s)) on.add(s)
  return Object.fromEntries((Object.keys(SIGNAL_META) as SignalId[]).map((s) => [s, on.has(s)])) as Record<SignalId, boolean>
}

/** Groups for the "+ Add channel" picker. */
export const CHANNEL_GROUPS: Array<{ title: string; signals: SignalId[] }> = [
  { title: 'Source', signals: ['vin', 'vb', 'vc', 'vab', 'vbc', 'vca'] },
  { title: 'Output & load', signals: ['vrect', 'vout', 'io', 'vl', 'il', 'ic'] },
  { title: 'Device currents', signals: DEVICE_CURRENTS },
  { title: 'Device voltages', signals: DEVICE_VOLTAGES },
  { title: 'Energy & power', signals: ENERGY },
]
