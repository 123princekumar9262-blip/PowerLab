import { measure, type Measurements } from '../measurements/measurements.ts'
import { runSimulation } from '../simulation/engine.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import type { CircuitId, LabParams } from '../types/simulation.ts'
import type { Section } from '../state/labState.ts'

export type Outcome = 'increases' | 'decreases' | 'unchanged'

/**
 * A "what if?" question. The correct answer is NOT stored: it is determined by running
 * the simulation before and after the change and comparing the measured quantity.
 * `why` explains the physics; the test suite checks it agrees with the simulation.
 */
export interface WhatIf {
  id: string
  section: Section
  question: string
  circuit: CircuitId
  base: LabParams
  /** The change, applied to `base`. */
  after: { circuit?: CircuitId; params: LabParams }
  quantity: keyof Measurements
  quantityLabel: string
  unit: string
  why: string
  /** For the record — what the physics says; tests check the simulation agrees. */
  expected: Outcome
}

type Patch = { source?: Partial<LabParams['source']>; diode?: Partial<LabParams['diode']>; load?: Partial<LabParams['load']>; threePhase?: Partial<NonNullable<LabParams['threePhase']>>; control?: Partial<NonNullable<LabParams['control']>>; faults?: LabParams['faults']; cycles?: number }
const with3 = (o: Patch = {}): LabParams => ({
  ...THREE_PHASE_DEFAULTS,
  source: { ...THREE_PHASE_DEFAULTS.source, ...o.source },
  diode: { ...THREE_PHASE_DEFAULTS.diode, ...o.diode },
  load: { ...THREE_PHASE_DEFAULTS.load, ...o.load },
  threePhase: { ...THREE_PHASE_DEFAULTS.threePhase!, ...o.threePhase },
  control: { ...THREE_PHASE_DEFAULTS.control!, ...o.control },
  faults: o.faults ?? {},
  sim: { ...THREE_PHASE_DEFAULTS.sim, cycles: o.cycles ?? 8 },
})
const with1 = (o: Patch = {}): LabParams => ({
  ...DEFAULT_PARAMS,
  source: { ...DEFAULT_PARAMS.source, ...o.source },
  diode: { ...DEFAULT_PARAMS.diode, ...o.diode },
  load: { ...DEFAULT_PARAMS.load, ...o.load },
  sim: { ...DEFAULT_PARAMS.sim, cycles: o.cycles ?? 8 },
})

export const WHAT_IFS: WhatIf[] = [
  {
    id: 'r-up-current',
    section: 'three',
    question: 'In a 6-pulse bridge with an R load, the resistance is doubled (10 Ω → 20 Ω). What happens to the average load current?',
    circuit: '3ph-bridge:R',
    base: with3(),
    after: { params: with3({ load: { resistance: 20 } }) },
    quantity: 'ioAvg',
    quantityLabel: 'Average load current Idc',
    unit: 'A',
    why: 'The bridge output voltage is fixed by the source (the load is always connected between the highest and lowest phase), so Vdc stays the same and Idc = Vdc/R halves.',
    expected: 'decreases',
  },
  {
    id: 'f-up-ripple',
    section: 'three',
    question: 'The supply frequency rises from 50 Hz to 60 Hz. What happens to the ripple frequency of a 6-pulse bridge?',
    circuit: '3ph-bridge:R',
    base: with3(),
    after: { params: with3({ source: { frequency: 60 } }) },
    quantity: 'rippleFrequency',
    quantityLabel: 'Ripple frequency',
    unit: 'Hz',
    why: 'There are always six output pulses per supply cycle, so the ripple frequency is 6f: 300 Hz → 360 Hz.',
    expected: 'increases',
  },
  {
    id: 'l-up-current-ripple',
    section: 'three',
    question: 'With an RL load on a 6-pulse bridge, the inductance is increased from 10 mH to 50 mH. What happens to the load-current ripple?',
    circuit: '3ph-bridge:RL',
    base: with3(),
    after: { params: with3({ load: { inductance: 0.05 } }) },
    quantity: 'ioRipplePP',
    quantityLabel: 'Current ripple (p-p)',
    unit: 'A',
    why: 'The inductor opposes changes in current (v = L·di/dt). Its reactance at the ripple frequency (6ωL) grows with L, so the same voltage ripple produces much less current ripple.',
    expected: 'decreases',
  },
  {
    id: 'sequence',
    section: 'three',
    question: 'The phase sequence is reversed (abc → acb). What happens to the average output voltage of the bridge?',
    circuit: '3ph-bridge:R',
    base: with3(),
    after: { params: with3({ threePhase: { sequence: 'acb' } }) },
    quantity: 'voutAvg',
    quantityLabel: 'Average output Vdc',
    unit: 'V',
    why: 'The bridge always connects the load between the highest and lowest phase, whichever order they peak in. The diodes simply conduct in the reverse order (D1D2 → D6D1 → D5D6 …) — the output is identical.',
    expected: 'unchanged',
  },
  {
    id: 'diode-open',
    section: 'three',
    question: 'Diode D1 fails open-circuit. What happens to the ripple frequency of the output?',
    circuit: '3ph-bridge:R',
    base: with3(),
    after: { params: with3({ faults: { diode: { id: 'D1', kind: 'open' } } }) },
    quantity: 'rippleFrequency',
    quantityLabel: 'Ripple frequency',
    unit: 'Hz',
    why: 'Without D1, phase A can never drive the + rail: the two pulses that would use it come from lower line voltages instead. The six pulses are no longer equal, so the output only repeats once per cycle — 300 Hz → 50 Hz. A lower ripple frequency with a lower Vdc is a classic sign of a failed device.',
    expected: 'decreases',
  },
  {
    id: 'alpha-up',
    section: 'three',
    question: 'In a fully controlled bridge (SCRs, RL load), the firing angle is increased from 0° to 60°. What happens to Vdc?',
    circuit: '3ph-bridge:RL',
    base: with3({ control: { device: 'scr', alphaDeg: 0 }, load: { inductance: 0.1 } }),
    after: { params: with3({ control: { device: 'scr', alphaDeg: 60 }, load: { inductance: 0.1 } }) },
    quantity: 'voutAvg',
    quantityLabel: 'Average output Vdc',
    unit: 'V',
    why: 'Each SCR is fired 60° after the point where it could conduct, so the output follows a later, lower part of each line voltage: Vdc = 1.35·VLL·cos α — halved at α = 60°.',
    expected: 'decreases',
  },
  {
    id: 'ls-overlap',
    section: 'three',
    question: 'Source inductance Ls = 2 mH is added to each phase (RL load). What happens to Vdc?',
    circuit: '3ph-bridge:RL',
    base: with3({ load: { inductance: 0.05 } }),
    after: { params: with3({ load: { inductance: 0.05 }, threePhase: { ls: 0.002 } }) },
    quantity: 'voutAvg',
    quantityLabel: 'Average output Vdc',
    unit: 'V',
    why: 'Ls stops the current from jumping between phases: during each commutation two phases are briefly shorted through the devices (overlap angle μ) and the output follows their average. Those notches lower Vdc by about (3ωLs/π)·Idc.',
    expected: 'decreases',
  },
  {
    id: 'missing-phase',
    section: 'three',
    question: 'Phase C is disconnected (blown fuse). What happens to the ripple frequency of the bridge output?',
    circuit: '3ph-bridge:R',
    base: with3(),
    after: { params: with3({ faults: { missingPhase: 'c' } }) },
    quantity: 'rippleFrequency',
    quantityLabel: 'Ripple frequency',
    unit: 'Hz',
    why: 'With only phases A and B connected, the bridge sees a single line voltage Vab: it becomes a single-phase bridge with 2 pulses per cycle — 300 Hz → 100 Hz, and a much larger ripple.',
    expected: 'decreases',
  },
  {
    id: 'pulses',
    section: 'three',
    question: 'The 3-pulse (half-wave) rectifier is replaced by a 6-pulse bridge. What happens to the output ripple (p-p)?',
    circuit: '3ph-half-wave:R',
    base: with3(),
    after: { circuit: '3ph-bridge:R', params: with3() },
    quantity: 'ripplePP',
    quantityLabel: 'Output ripple (p-p)',
    unit: 'V',
    why: 'Doubling the pulses means the output switches to the next (higher) voltage twice as often: the dips between pulses are much shallower — relative ripple drops from 50 % of the peak to about 13 %.',
    expected: 'decreases',
  },
  {
    id: 'c-up',
    section: 'single',
    question: 'In a half-wave capacitor filter, C is doubled (1000 µF → 2000 µF). What happens to the output ripple?',
    circuit: 'half-wave:RC',
    base: with1(),
    after: { params: with1({ load: { capacitance: 2000e-6 } }) },
    quantity: 'ripplePP',
    quantityLabel: 'Output ripple (p-p)',
    unit: 'V',
    why: 'The capacitor discharges through R with time constant RC; doubling C halves the droop between charging pulses (ΔV ≈ Vpk/(f·R·C)).',
    expected: 'decreases',
  },
  {
    id: 'rl-beta',
    section: 'single',
    question: 'In a half-wave RL rectifier, L is increased (50 mH → 150 mH). What happens to the extinction angle β?',
    circuit: 'half-wave:RL',
    base: with1(),
    after: { params: with1({ load: { inductance: 0.15 } }) },
    quantity: 'turnOffAngleDeg',
    quantityLabel: 'Extinction angle β',
    unit: '°',
    why: 'More inductance stores more energy and slows the decay of current, so the diode is held on longer after vin goes negative: β moves later.',
    expected: 'increases',
  },
]

export interface WhatIfResult {
  before: number | null
  after: number | null
  actual: Outcome
}

/** Run both simulations and classify the measured change (±0.5 % counts as unchanged). */
export function evaluateWhatIf(q: WhatIf): WhatIfResult {
  const a = measure(runSimulation(q.base, q.circuit))[q.quantity] as number | null
  const b = measure(runSimulation(q.after.params, q.after.circuit ?? q.circuit))[q.quantity] as number | null
  let actual: Outcome = 'unchanged'
  if (a !== null && b !== null) {
    const rel = (b - a) / Math.max(Math.abs(a), 1e-12)
    actual = Math.abs(rel) < 0.005 ? 'unchanged' : rel > 0 ? 'increases' : 'decreases'
  }
  return { before: a, after: b, actual }
}
