import { diodeRecovery, linearOnState } from '../../../calculations/semiconductors.ts'
import type { CalcResult, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'
import { blockingParams, blockingRows, packageParts, SEMI_LAYERS, TRANSIENT_NOTE } from '../common.ts'
import type { Mode } from '../shared.tsx'

/*
 * Power p-i-n diode — content and explicit relations. Geometry in Model.tsx: anode metal on top, p+ anode, thick
 * n− drift, n+ cathode substrate, cathode metal underneath; at the right-hand edge of the cut the anode ends with a
 * rounded junction, a floating p guard ring and a passivation layer (edge termination).
 */

export const DIODE_PARTS: MachinePart[] = [
  { id: 'anode-metal', label: 'Anode metal', what: 'The aluminium layer on the top of the die.', function: 'The anode terminal: an ohmic contact to the p+ anode layer.', explode: [0, 0.7, 0], stage: 1, anchor: [-1.1, 0.86, 0.8], related: ['p-anode'] },
  { id: 'p-anode', label: 'p+ anode', what: 'A heavily doped p-type layer under the anode metal.', function: 'Forms the main p-n junction with the n− drift. Forward-biased, it injects holes into the drift region; reverse-biased, its junction blocks.', explode: [0, 0.35, 0.45], stage: 2, anchor: [-0.3, 0.48, 0.8], related: ['n-drift', 'anode-metal'] },
  { id: 'n-drift', label: 'n− drift region', what: 'A thick, lightly doped n-type layer (the "i" of p-i-n).', function: 'Holds the reverse voltage: being lightly doped, it can deplete over a long distance so the field stays below breakdown. In conduction it is flooded with carriers, so it does not add much resistance.', explode: [0, 0, 0], stage: 3, anchor: [0.4, -0.45, 0.8], related: ['p-anode', 'n-cathode'] },
  { id: 'n-cathode', label: 'n+ cathode (substrate)', what: 'The heavily doped wafer underneath.', function: 'Injects electrons into the drift region when the diode conducts, stops the field of a punch-through design, and makes a low-resistance contact to the cathode metal.', explode: [0, -0.35, 0], stage: 2, anchor: [-0.9, -1.28, 0.8], related: ['n-drift', 'cathode-metal'] },
  { id: 'cathode-metal', label: 'Cathode metal', what: 'The metal on the back of the die.', function: 'The cathode terminal, soldered to the package tab: current and heat leave here.', explode: [0, -0.62, 0], stage: 1, anchor: [0.9, -1.66, 0.8], related: ['n-cathode', 'leadframe'] },
  { id: 'guard-ring', label: 'Guard ring (edge termination)', what: 'A floating p ring around the anode, at the die edge.', function: 'At the edge the anode junction is curved, and the field would crowd there and break down early. The ring spreads the depletion region sideways so the edge holds (nearly) the same voltage as the flat junction.', explode: [0, 0.3, 0.75], stage: 3, anchor: [1.6, 0.4, 0.8], related: ['passivation', 'p-anode'] },
  { id: 'passivation', label: 'Passivation', what: 'An insulating layer (oxide / nitride, polyimide) over the die edge.', function: 'Protects the surface where the depletion region reaches it: keeps moisture and charges away, which would otherwise lower the breakdown voltage.', explode: [0, 0.55, 0.3], stage: 2, anchor: [1.62, 0.9, 0.8], related: ['guard-ring'] },
  ...packageParts({ back: 'cathode', top: 'anode', device: 'diode' }),
]

export const DIODE_LAYERS = SEMI_LAYERS({ bipolar: true })

export const DIODE_STEP_MODE: Record<string, Mode> = { structure: 'idle', blocking: 'block', edge: 'block', forward: 'turnon', conduction: 'on', recovery: 'turnoff' }
export const DIODE_STATES: Mode[] = ['block', 'turnon', 'on', 'turnoff']

export const DIODE_STEPS: MachineStep[] = [
  {
    id: 'structure',
    title: '1 · p+ / n− / n+: a p-i-n diode',
    text: 'Top to bottom: anode metal, a heavily doped p+ anode, a thick lightly doped n− drift region, the heavily doped n+ cathode substrate and the cathode metal. A signal diode is just p-n; a power diode puts the thick, lightly doped n− layer between them so that it can block hundreds or thousands of volts.',
    focus: ['anode-metal', 'p-anode', 'n-drift', 'n-cathode', 'cathode-metal'],
    layers: [],
    detail: 'Vertical structure: the current flows through the whole thickness of the die, over its whole area — that is how a die of a few mm² carries tens of amperes.',
  },
  {
    id: 'blocking',
    title: '2 · Reverse blocking: the depletion region widens',
    text: 'With the cathode positive, the p+ / n− junction is reverse-biased. Free carriers are pulled away from it and a depletion region forms, almost entirely in the lightly doped drift. The higher the voltage, the wider it gets (W ∝ √V); fixed donor ions (+) remain, and the field E points from them towards the p+ side. Only a tiny leakage current flows.',
    focus: ['p-anode', 'n-drift'],
    layers: ['field'],
    rotate: true,
    equation: 'W = √(2·εSi·VR / (q·ND))    Emax = 2·VR / W',
    detail: 'Avalanche breakdown when Emax reaches ≈ 200–300 kV/cm. A punch-through design lets the field reach the n+ layer (trapezoidal field) and blocks the same voltage with a thinner drift — less stored charge, lower vF.',
  },
  {
    id: 'edge',
    title: '3 · Edge termination',
    text: 'Where the anode ends, its junction is curved and the field crowds at the curve; without help the edge would break down long before the flat part. A floating p guard ring (here one; real dice use several, or field plates) takes part of the voltage and spreads the depletion region sideways, and the passivation protects the surface where it reaches.',
    focus: ['guard-ring', 'passivation', 'p-anode'],
    layers: ['field'],
    detail: 'Edge termination takes die area that does not conduct: the higher the voltage rating, the wider the termination.',
  },
  {
    id: 'forward',
    title: '4 · Forward bias: injection',
    text: 'With the anode positive, the junction barrier falls. Holes are injected from the p+ anode into the drift region and electrons from the n+ cathode. At power-diode currents the injected densities exceed the drift doping (high-level injection): the drift region is flooded and its resistance collapses — conductivity modulation. Until it fills, the voltage briefly overshoots (forward recovery).',
    focus: ['p-anode', 'n-drift', 'n-cathode'],
    layers: ['carriers', 'field'],
    rotate: true,
    equation: 'injected n ≈ p ≫ ND',
  },
  {
    id: 'conduction',
    title: '5 · Conduction',
    text: 'Holes flow down from the anode, electrons up from the cathode, and conventional current flows from anode to cathode through the whole area of the die. The voltage drop is a junction knee plus a small resistive part, so the loss has a part proportional to the current and a part proportional to its square.',
    focus: ['n-drift', 'p-anode', 'n-cathode'],
    layers: ['carriers', 'current', 'energy'],
    rotate: true,
    equation: 'vF ≈ VF0 + rd · iF    P = VF0·iF + rd·iF²',
    detail: 'VF0 ≈ 0.7–1 V for silicon p-i-n diodes; vF falls slightly with temperature at low current (negative temperature coefficient) — careful when paralleling.',
  },
  {
    id: 'recovery',
    title: '6 · Turning off: reverse recovery',
    text: 'When the circuit forces the current down and then reverses the voltage, the drift region is still full of stored charge. The diode keeps conducting backwards until that charge is removed: holes go back to the anode, electrons back to the cathode — the reverse-recovery current. Then the junction recovers, the depletion region forms and the diode blocks.',
    focus: ['n-drift', 'p-anode'],
    layers: ['carriers', 'current', 'field'],
    rotate: true,
    equation: 'Irr = √(2·Qrr·di/dt)    trr = √(2·Qrr / (di/dt))',
    detail: 'Triangular, abrupt-recovery idealisation (Mohan). The recovery current adds to the turn-on current of the opposite switch: a main switching loss in a bridge. Fast-recovery and SiC Schottky diodes reduce Qrr. The Switching Devices lab simulates it.',
  },
]

export const DIODE_PARAMS: MachineParam[] = [
  { id: 'state', label: 'State (0 reverse blocking · 1 turning on · 2 forward conduction · 3 reverse recovery)', unit: '', min: 0, max: 3, step: 1, value: 2, options: [0, 1, 2, 3] },
  { id: 'if', label: 'Forward current iF', unit: 'A', min: 0, max: 100, step: 1, value: 30 },
  { id: 'vf0', label: 'Knee voltage VF0 (example)', unit: 'V', min: 0.6, max: 1.5, step: 0.05, value: 0.9, level: 'standard' },
  { id: 'rd', label: 'Slope resistance rd (example)', unit: 'mΩ', min: 1, max: 50, step: 1, value: 12, level: 'standard' },
  ...blockingParams({ label: 'Reverse voltage VR', v: 600, vmax: 1700, nd: 0.8, wd: 120, wdMin: 50, wdMax: 250 }),
  { id: 'qrr', label: 'Stored charge Qrr (example)', unit: 'µC', min: 0.1, max: 20, step: 0.1, value: 1, level: 'engineer' },
  { id: 'didt', label: 'Current fall rate di/dt', unit: 'A/µs', min: 10, max: 2000, step: 10, value: 200, level: 'engineer' },
]

export function diodeCalc(p: Record<string, number>): CalcResult[] {
  const on = linearOnState({ v0: p.vf0, r: p.rd / 1000, i: p.if })
  const rr = diodeRecovery({ qrr: p.qrr * 1e-6, didt: p.didt * 1e6 })
  const state = Math.round(p.state)
  const vop = state === 0 ? -p.vb : state === 2 ? (on ? on.v : null) : null
  const pop = state === 0 ? 0 : state === 2 ? (on ? on.p : null) : null
  return [
    { id: 'vf', label: 'Forward voltage vF', value: on ? on.v : null, unit: 'V', formula: 'vF ≈ VF0 + rd · iF', note: 'Piecewise-linear model with example values, fixed temperature.' },
    { id: 'pcond', label: 'Conduction loss', value: on ? on.p : null, unit: 'W', formula: 'P = VF0·iF + rd·iF²', note: 'Steady DC forward current; recovery loss not included.' },
    { id: 'vop', label: 'Diode voltage vAK in the selected state', value: vop, unit: 'V', formula: state === 0 ? 'vAK = −VR' : state === 2 ? 'vAK = vF' : 'transient: no steady relation', note: state === 1 || state === 3 ? TRANSIENT_NOTE : undefined },
    { id: 'pop', label: 'Loss in the selected state', value: pop, unit: 'W', formula: state === 0 ? 'P ≈ 0 (leakage neglected)' : state === 2 ? 'P = vF · iF' : 'transient: no steady relation', note: state === 1 || state === 3 ? TRANSIENT_NOTE : undefined },
    { id: 'irr', label: 'Peak reverse-recovery current Irr', value: rr ? rr.irr : null, unit: 'A', formula: 'Irr = √(2·Qrr·di/dt)', note: 'Triangular recovery, abrupt idealisation (the current returns to zero quickly after its peak); Qrr is an example value — it grows with iF and temperature.' },
    { id: 'trr', label: 'Reverse-recovery time trr', value: rr ? rr.trr * 1e9 : null, unit: 'ns', formula: 'trr = √(2·Qrr / (di/dt))', note: 'Same idealisation: Qrr = ½·Irr·trr.' },
    ...blockingRows(p, 'p+ / n− junction'),
  ]
}

export const DIODE_CONTENT: MachineContent = {
  overview: 'A power diode is a p-i-n junction: a thick, lightly doped n− region between a p+ anode and an n+ cathode. It conducts when the anode is positive (with a knee voltage of about a volt) and blocks large reverse voltages; when switched off it must first get rid of its stored charge (reverse recovery).',
  construction: 'Vertical die: anode metal, p+ anode, thick n− drift, n+ cathode substrate, cathode metal soldered to the package tab. At the die edge: a rounded junction end, guard ring(s) and passivation (edge termination). Package: here a TO-247-style two-lead package, cathode on the tab.',
  principle: 'Forward bias lowers the junction barrier: holes and electrons are injected into the drift region from both ends and flood it (conductivity modulation), so a large current flows with a small drop. Reverse bias widens the depletion region into the drift region, which holds the voltage. Turn-off requires removing the stored carriers, which flow backwards briefly.',
  equations: [
    { expr: 'vF ≈ VF0 + rd · iF', meaning: 'On-state voltage: knee plus slope resistance.' },
    { expr: 'P = VF0·iF + rd·iF²', meaning: 'Conduction loss.' },
    { expr: 'W = √(2·εSi·VR / (q·ND)),  Emax = 2·VR / W', meaning: 'Reverse blocking: depletion width and peak field (one-sided abrupt junction).' },
    { expr: 'Irr = √(2·Qrr·di/dt),  trr = √(2·Qrr/(di/dt))', meaning: 'Reverse recovery, triangular abrupt idealisation.' },
  ],
  assumptions: ['VF0, rd and Qrr are EXAMPLE values, not a specific product.', 'Steady forward current at a fixed temperature.', 'Blocking: one-sided abrupt junction, uniform drift doping, built-in potential and leakage neglected.', 'Recovery: constant di/dt, triangular current, abrupt recovery (tb ≪ ta).'],
  characteristics: ['Uncontrolled: it turns on and off by the circuit, not by a gate.', 'Knee voltage ≈ 0.7–1 V (silicon p-i-n), then nearly linear.', 'Reverse recovery current and time grow with the stored charge (current, temperature, di/dt).'],
  losses: ['Conduction loss VF0·iF + rd·iF².', 'Reverse-recovery loss in the diode and, larger, in the switch that turns on against it.', 'Leakage loss when blocking (small, grows with temperature).'],
  advantages: ['Simple, robust, cheap.', 'High voltage and current ratings.', 'No drive circuit.'],
  limitations: ['Not controllable.', 'Reverse recovery limits fast switching (fast-recovery and SiC Schottky diodes help).', 'Knee voltage makes it lossy at low output voltages (synchronous rectifiers replace it there).'],
  applications: ['Rectifiers (line-frequency bridges)', 'Freewheeling / anti-parallel diodes in inverters and choppers', 'Boost diodes in PFC stages', 'Snubbers and clamps'],
  misconceptions: [
    'A diode does not stop conducting the instant its current reaches zero: the stored charge makes it conduct backwards for a short time.',
    'The depletion region does not spread equally into both sides: it goes mostly into the lightly doped drift region.',
    'The thick n− drift region is not a big resistance when conducting: it is flooded with carriers.',
  ],
  sources: ['B. J. Baliga, Fundamentals of Power Semiconductor Devices.', 'Mohan, Undeland & Robbins, Power Electronics (reverse recovery).'],
}

export const DIODE_QUIZ: QuizItem[] = [
  { id: 'id-drift', kind: 'identify', prompt: 'What is the highlighted part?', part: 'n-drift', options: ['n+ cathode', 'n− drift region', 'p+ anode', 'Passivation'], answer: 1, explain: 'The thick, lightly doped n− drift region: it holds the reverse voltage.', misconceptions: { 0: 'The n+ cathode is the thinner, heavily doped layer underneath.' } },
  { id: 'id-guard', kind: 'identify', prompt: 'What is the highlighted part?', part: 'guard-ring', options: ['Guard ring (edge termination)', 'p+ anode', 'Bond wire', 'n+ cathode'], answer: 0, explain: 'A floating p guard ring at the die edge: it spreads the depletion region so the curved edge of the junction does not break down early.' },
  { id: 'predict-w', kind: 'predict', prompt: 'The reverse voltage is quadrupled (no punch-through). The depletion width…', options: ['doubles', 'quadruples', 'stays the same'], answer: 0, explain: 'W = √(2·ε·V/(q·ND)): four times the voltage, twice the width.', misconceptions: { 1: 'W grows with the square root of V, not in proportion.' } },
  { id: 'predict-rr', kind: 'predict', prompt: 'A conducting diode is suddenly reverse-biased. What happens first?', options: ['A reverse current flows briefly while the stored charge is removed', 'The current stops instantly and the voltage reverses', 'The diode breaks down'], answer: 0, explain: 'The flooded drift region must be emptied: holes return to the anode and electrons to the cathode — the reverse-recovery current.' },
  { id: 'order', kind: 'order', prompt: 'Put the turn-off of a conducting diode in order.', options: ['The circuit forces the forward current down', 'The current reverses: stored carriers are pulled out (reverse recovery)', 'The junction recovers and a depletion region forms', 'The diode blocks the reverse voltage'], answer: 0, explain: 'Current falls, stored charge is extracted by a reverse current, then the junction depletes and blocks.' },
  { id: 'match-vf', kind: 'match', prompt: 'Which relation gives the diode’s forward voltage in this model?', options: ['vF ≈ VF0 + rd · iF', 'vF = iF · RDS(on)', 'vF = 0.7 V exactly'], answer: 0, explain: 'A knee voltage plus a slope resistance: the piecewise-linear model.', misconceptions: { 2: 'The knee is not exact and the drop rises with current.' } },
]
