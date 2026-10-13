import { linearOnState } from '../../../calculations/semiconductors.ts'
import type { CalcResult, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'
import { blockingParams, blockingRows, packageParts, SEMI_LAYERS, TRANSIENT_NOTE } from '../common.ts'
import type { Mode } from '../shared.tsx'

/*
 * IGBT (field-stop, planar gate) — content and explicit relations. Geometry in Model.tsx. Top = the MOSFET cell
 * (emitter metal, gate, oxide, n+ emitter, p body, channel); underneath the n− drift: an n field-stop (buffer) layer
 * and the p+ collector that injects holes; collector metal on the back.
 */

export const IGBT_PARTS: MachinePart[] = [
  { id: 'emitter-metal', label: 'Emitter metal', what: 'The aluminium layer on top of the cell.', function: 'The emitter terminal. It contacts the n+ emitter (electron source of the channel) and the p body (where the holes leave the device).', explode: [0, 0.85, 0], stage: 1, anchor: [1.6, 1.24, 0.8], related: ['n-emitter', 'p-body'] },
  { id: 'gate', label: 'Polysilicon gate', what: 'A conducting polysilicon electrode, insulated on all sides.', function: 'The gate: a voltage above the threshold forms the MOS channel, exactly as in a MOSFET. It draws no steady current.', explode: [0, 0.62, 0.5], stage: 2, anchor: [0.55, 0.9, 0.8], related: ['gate-oxide', 'channel'] },
  { id: 'gate-oxide', label: 'Gate oxide and insulation', what: 'Silicon dioxide: very thin under the gate, thicker over it.', function: 'Insulates the gate from the silicon and from the emitter metal, while letting the gate field reach the p-body surface.', explode: [0, 0.34, 0.25], stage: 2, anchor: [-1.18, 1.07, 0.8], related: ['gate', 'channel'] },
  { id: 'n-emitter', label: 'n+ emitter', what: 'Heavily doped n-type regions at the surface, inside the p body.', function: 'Supply the electrons that flow through the channel into the drift region (the "MOSFET part" of the IGBT).', explode: [0, 0, 1.0], stage: 3, anchor: [-1.2, 0.55, 0.8], related: ['p-body', 'emitter-metal'] },
  { id: 'p-body', label: 'p body', what: 'p-type wells under the emitter.', function: 'Holds the channel at its surface. Its junction with the n− drift blocks the forward voltage; in conduction it collects the holes that cross the drift region and passes them to the emitter metal.', explode: [0, 0, 0.6], stage: 3, anchor: [1.75, 0.22, 0.8], related: ['channel', 'n-drift'] },
  { id: 'channel', label: 'Inversion channel', what: 'A thin n-type layer at the p-body surface under the gate — only while VGE > Vth (faint here when off).', function: 'Lets electrons pass from the n+ emitter into the drift region. These electrons are the base current that turns on the bipolar (pnp) part of the IGBT.', explode: [0, 0, 1.35], stage: 3, anchor: [0.82, 0.6, 0.8], related: ['gate', 'p-body'] },
  { id: 'n-drift', label: 'n− drift region', what: 'A thick, lightly doped n-type layer — the base of the internal pnp transistor.', function: 'Blocks the off-state voltage. In conduction it is flooded with holes and electrons (conductivity modulation), so even though it is lightly doped its resistance becomes small.', explode: [0, 0, 0], stage: 3, anchor: [0.9, -0.45, 0.8], related: ['p-collector', 'p-body'] },
  { id: 'field-stop', label: 'n field stop (buffer)', what: 'A thin, more heavily doped n layer between the drift and the collector.', function: 'Stops the electric field before it reaches the p+ collector, so the drift region can be thinner for the same voltage (lower on-state voltage, less stored charge). It also limits how strongly the collector injects.', explode: [0, -0.22, 0.35], stage: 3, anchor: [-1.2, -1.07, 0.8], related: ['n-drift', 'p-collector'] },
  { id: 'p-collector', label: 'p+ collector', what: 'A heavily doped p-type layer on the back — what makes an IGBT different from a MOSFET.', function: 'When the electrons from the channel arrive, the p+ collector / n junction becomes forward-biased and injects holes into the drift region: the device conducts with both carriers.', explode: [0, -0.4, 0], stage: 2, anchor: [0.9, -1.38, 0.8], related: ['field-stop', 'collector-metal'] },
  { id: 'collector-metal', label: 'Collector metal', what: 'The metal on the back of the die.', function: 'The collector terminal, soldered to the package tab: current and heat leave the die here.', explode: [0, -0.62, 0], stage: 1, anchor: [-0.9, -1.66, 0.8], related: ['p-collector', 'leadframe'] },
  ...packageParts({ back: 'collector', top: 'emitter', gate: 'gate', device: 'IGBT' }),
]

export const IGBT_LAYERS = SEMI_LAYERS({ bipolar: true })

export const IGBT_STEP_MODE: Record<string, Mode> = { structure: 'idle', blocking: 'block', 'turn-on': 'turnon', modulation: 'on', 'on-state': 'on', 'turn-off': 'turnoff' }
export const IGBT_STATES: Mode[] = ['block', 'turnon', 'on', 'turnoff']

export const IGBT_STEPS: MachineStep[] = [
  {
    id: 'structure',
    title: '1 · A MOSFET on top of a p+ collector',
    text: 'The top of the cell is the same as a power MOSFET: emitter metal, insulated polysilicon gate, n+ emitter regions in p-body wells, thick n− drift. The difference is underneath: an n field-stop layer and a p+ collector on the back. Reading downwards from the p body there is a p-n-p transistor (p body, n− drift, p+ collector) whose base current is supplied by the MOS channel.',
    focus: ['p-collector', 'field-stop', 'n-drift', 'gate', 'n-emitter', 'p-body'],
    layers: [],
    detail: 'There is also a parasitic n-p-n-p thyristor (n+ emitter, p body, n− drift, p+ collector). The p body is shorted to the emitter metal and heavily doped under the emitter so that it never latches (latch-up).',
  },
  {
    id: 'blocking',
    title: '2 · Forward blocking',
    text: 'With the gate below the threshold and the collector positive, the p-body / n− drift junction is reverse-biased. Its depletion region spreads down into the lightly doped drift (W ∝ √V) and holds the voltage. In a field-stop IGBT the n buffer stops the field before it reaches the p+ collector, so the drift can be thinner for the same rating.',
    focus: ['p-body', 'n-drift', 'field-stop'],
    layers: ['field'],
    rotate: true,
    equation: 'W = √(2·εSi·vCE / (q·ND))  (until the field reaches the field stop)',
    detail: 'A field-stop IGBT blocks almost no reverse voltage (the collector junction is backed by the heavily doped buffer), so in inverters it is paired with an anti-parallel diode, often in the same package.',
  },
  {
    id: 'turn-on',
    title: '3 · Turning on: channel, then hole injection',
    text: 'VGE above the threshold forms the inversion channel, as in a MOSFET. Electrons flow from the n+ emitter through the channel into the n− drift and down to the collector side. Arriving there, they forward-bias the p+ collector junction, which starts injecting holes up into the drift region: the bipolar part switches on.',
    focus: ['channel', 'gate', 'p-collector', 'n-drift'],
    layers: ['carriers', 'field'],
    rotate: true,
    equation: 'VGE > Vth  ⇒  electron current = base current of the pnp',
  },
  {
    id: 'modulation',
    title: '4 · Conductivity modulation',
    text: 'The injected holes cross the drift region towards the p body; to stay neutral, the drift fills with an equal extra density of electrons. This electron-hole "plasma" is far denser than the original doping, so the resistance of the thick, lightly doped drift collapses. That is why an IGBT carries a large current with a small voltage drop at high voltage ratings, where a MOSFET would need a huge die.',
    focus: ['n-drift', 'p-collector', 'p-body'],
    layers: ['carriers'],
    rotate: true,
    equation: 'n ≈ p ≫ ND  ⇒  drift resistance ≪ its unmodulated value',
  },
  {
    id: 'on-state',
    title: '5 · On-state voltage and current path',
    text: 'Conventional current enters at the collector and leaves at the emitter along two paths: the electron path through the channel to the n+ emitter, and the hole path through the p body to the emitter metal. The on-state voltage is a junction knee (the forward-biased collector junction) plus a small resistive part — not a pure resistance as in a MOSFET.',
    focus: ['p-collector', 'n-drift', 'channel', 'p-body', 'emitter-metal'],
    layers: ['current', 'energy'],
    rotate: true,
    equation: 'vCE ≈ VCE0 + r · iC    P = VCE0·iC + r·iC²',
    detail: 'VCE0 is roughly 0.7–1 V; a typical vCE(sat) is 1.5–2.5 V at rated current. Too much hole current under the n+ emitter could forward-bias it and latch the parasitic thyristor — the reason for a maximum current rating.',
  },
  {
    id: 'turn-off',
    title: '6 · Turning off: the tail current',
    text: 'Pulling the gate below the threshold removes the channel at once: the electron current stops. But the drift region is still full of stored holes and electrons. As the voltage rises, the depletion region grows from the p body and the remaining holes are swept out or recombine slowly — the current falls quickly to a "tail" that decays over µs. The tail while the voltage is already high is the IGBT’s main turn-off loss.',
    focus: ['gate', 'channel', 'n-drift'],
    layers: ['carriers', 'field'],
    rotate: true,
    equation: 'tail ∝ stored charge; it decays with the carrier lifetime',
    detail: 'A trade-off: more injection (lower vCE) means more stored charge and a longer tail (higher Eoff). Field-stop designs and lifetime control tune it. The Switching Devices lab simulates the tail.',
  },
]

export const IGBT_PARAMS: MachineParam[] = [
  { id: 'state', label: 'State (0 off · 1 turning on · 2 on · 3 turning off)', unit: '', min: 0, max: 3, step: 1, value: 2, options: [0, 1, 2, 3] },
  { id: 'ic', label: 'Collector current iC', unit: 'A', min: 0, max: 100, step: 1, value: 40 },
  { id: 'vge', label: 'Gate–emitter voltage VGE', unit: 'V', min: 0, max: 20, step: 0.5, value: 15 },
  { id: 'vth', label: 'Threshold voltage Vth (example)', unit: 'V', min: 3, max: 7, step: 0.1, value: 5.5, level: 'standard' },
  { id: 'vce0', label: 'Knee voltage VCE0 (example)', unit: 'V', min: 0.5, max: 1.5, step: 0.05, value: 0.9, level: 'standard' },
  { id: 'r', label: 'Slope resistance r (example)', unit: 'mΩ', min: 5, max: 50, step: 1, value: 20, level: 'standard' },
  ...blockingParams({ label: 'Off-state voltage vCE', v: 600, vmax: 1700, nd: 0.8, wd: 120, wdMin: 50, wdMax: 250 }),
]

export function igbtCalc(p: Record<string, number>): CalcResult[] {
  const channel = p.vge > p.vth
  const on = channel ? linearOnState({ v0: p.vce0, r: p.r / 1000, i: p.ic }) : null
  const state = Math.round(p.state)
  const noCh = 'VGE ≤ Vth: no channel — the IGBT is off, so this relation does not apply.'
  const vop = state === 0 ? p.vb : state === 2 ? (on ? on.v : null) : null
  const pop = state === 0 ? 0 : state === 2 ? (on ? on.p : null) : null
  return [
    { id: 'ov', label: 'Gate overdrive VGE − Vth', value: p.vge - p.vth, unit: 'V', formula: 'VGE − Vth  (> 0: the channel forms)', note: channel ? undefined : 'Not above the threshold: no channel.' },
    { id: 'vce', label: 'On-state voltage vCE', value: on ? on.v : null, unit: 'V', formula: 'vCE ≈ VCE0 + r · iC', note: on ? 'Piecewise-linear on-state model with example values, fixed temperature.' : noCh },
    { id: 'pcond', label: 'Conduction loss', value: on ? on.p : null, unit: 'W', formula: 'P = VCE0·iC + r·iC²', note: on ? 'Steady DC current; switching (turn-on, tail) losses are not included.' : noCh },
    { id: 'pknee', label: 'Part due to the knee VCE0', value: on ? on.pKnee : null, unit: 'W', formula: 'VCE0 · iC', note: on ? 'Grows linearly with current — the bipolar (junction) part of the drop.' : noCh },
    { id: 'vop', label: 'Device voltage in the selected state', value: vop, unit: 'V', formula: state === 0 ? 'vCE = applied off-state voltage' : state === 2 ? 'vCE ≈ VCE0 + r·iC' : 'transient: no steady relation', note: state === 1 || state === 3 ? TRANSIENT_NOTE : state === 2 && !on ? noCh : undefined },
    { id: 'pop', label: 'Loss in the selected state', value: pop, unit: 'W', formula: state === 0 ? 'P ≈ 0 (leakage neglected)' : state === 2 ? 'P = vCE · iC' : 'transient: no steady relation', note: state === 1 || state === 3 ? TRANSIENT_NOTE : undefined },
    ...blockingRows(p, 'p body / n− drift junction'),
  ]
}

export const IGBT_CONTENT: MachineContent = {
  overview: 'An IGBT (insulated-gate bipolar transistor) combines a MOSFET’s insulated gate with a bipolar output: the MOS channel supplies electrons, a p+ collector injects holes, and the flooded drift region conducts with a small voltage drop even at high voltage ratings.',
  construction: 'Top: emitter metal, polysilicon gate on gate oxide, n+ emitter regions in p-body wells (like a vertical MOSFET). Middle: a thick, lightly doped n− drift region. Bottom: an n field-stop (buffer) layer, a p+ collector and the collector metal, soldered to the package tab.',
  principle: 'Gate above threshold → channel → electrons into the drift → the p+ collector junction is forward-biased and injects holes → conductivity modulation of the drift → low on-state voltage. Gate removed → electron current stops, the stored charge decays as a tail current.',
  equations: [
    { expr: 'VGE > Vth', meaning: 'Condition for the MOS channel (the device can turn on).' },
    { expr: 'vCE ≈ VCE0 + r · iC', meaning: 'On-state voltage: a junction knee plus a small slope resistance.' },
    { expr: 'P = VCE0·iC + r·iC²', meaning: 'Conduction loss of the piecewise-linear model.' },
    { expr: 'W = √(2·εSi·V / (q·ND)),  Emax = 2·V / W', meaning: 'Forward blocking: depletion width and peak field in the drift (until it reaches the field stop).' },
  ],
  assumptions: ['VCE0, r and Vth are EXAMPLE values, not a specific product.', 'Steady on-state, fixed junction temperature.', 'Blocking: one-sided abrupt junction with uniform drift doping; trapezoidal field once it reaches the field stop; leakage neglected.', 'Switching transients (tail current) are described, not calculated — the Switching Devices lab simulates them.'],
  characteristics: ['Voltage-driven gate, like a MOSFET.', 'On-state voltage has a knee (≈ 0.7–1 V) — better than a MOSFET at high voltage and current, worse at light load.', 'Turn-off tail current: slower than a MOSFET, switching frequencies typically a few kHz to tens of kHz.', 'Usually no reverse blocking: used with an anti-parallel diode.'],
  losses: ['Conduction loss VCE0·iC + r·iC².', 'Turn-on loss (and the reverse recovery of the opposite diode).', 'Turn-off loss, dominated by the tail current at high voltage.', 'Gate-drive loss (small).'],
  advantages: ['Low on-state voltage at high voltage ratings (600 V – 6.5 kV).', 'Simple voltage-driven gate.', 'Rugged; good short-circuit capability in many designs.'],
  limitations: ['Tail current limits the switching frequency.', 'Knee voltage makes it lossy at light load.', 'Latch-up of the parasitic thyristor above the rated current.'],
  applications: ['Motor-drive inverters (industrial, traction, EV)', 'Solar and wind inverters', 'UPS and welding', 'Induction heating, HVDC and FACTS (press-pack modules)'],
  misconceptions: [
    'An IGBT is not "a MOSFET with lower resistance": its on-state voltage has a junction knee and it does not behave as a resistance.',
    'The p+ collector does not just carry the current: it injects holes, which is what lowers the drift resistance.',
    'The gate cannot remove the stored charge: the tail is set by the device, not by the gate driver.',
  ],
  sources: ['B. J. Baliga, Fundamentals of Power Semiconductor Devices.', 'Mohan, Undeland & Robbins, Power Electronics.'],
}

export const IGBT_QUIZ: QuizItem[] = [
  { id: 'id-collector', kind: 'identify', prompt: 'What is the highlighted part?', part: 'p-collector', options: ['n+ substrate', 'p+ collector', 'n field stop', 'Collector metal'], answer: 1, explain: 'The p+ collector on the back: it injects holes into the drift region — the layer a MOSFET does not have.', misconceptions: { 0: 'A MOSFET has an n+ substrate there; the IGBT’s back layer is p+, and that is the whole difference.' } },
  { id: 'id-fieldstop', kind: 'identify', prompt: 'What is the highlighted part?', part: 'field-stop', options: ['n field stop (buffer)', 'p body', 'Gate oxide', 'n− drift'], answer: 0, explain: 'The n field stop: a more heavily doped n layer that stops the electric field before the p+ collector.' },
  { id: 'predict-mod', kind: 'predict', prompt: 'Why does the thick, lightly doped drift region of an IGBT have a low resistance when the device conducts?', options: ['It is flooded with injected holes and electrons (conductivity modulation)', 'The gate voltage dopes it more heavily', 'The current flows only through the channel'], answer: 0, explain: 'Holes from the p+ collector and an equal number of extra electrons fill the drift; their density far exceeds the doping.', misconceptions: { 1: 'The gate only forms the channel at the surface; it does not change the drift doping.' } },
  { id: 'predict-tail', kind: 'predict', prompt: 'The gate voltage is removed. What does the collector current do?', options: ['Falls quickly, then a small tail current decays over microseconds', 'Stops instantly, exactly like a MOSFET', 'Keeps flowing until the current is reversed, like a thyristor'], answer: 0, explain: 'The electron current stops with the channel, but the stored holes in the drift take time to be swept out or recombine: the tail.', misconceptions: { 2: 'An IGBT does not latch (in normal operation): it turns off from the gate; only latch-up would make it behave like a thyristor.' } },
  { id: 'order', kind: 'order', prompt: 'Put the turn-on sequence in order.', options: ['VGE rises above Vth: the channel forms', 'Electrons flow through the channel into the drift region', 'The p+ collector junction is forward-biased and injects holes', 'The drift region is flooded: conductivity modulation, low vCE'], answer: 0, explain: 'MOS action first, then the bipolar action it triggers.' },
  { id: 'match-von', kind: 'match', prompt: 'Which on-state relation fits an IGBT?', options: ['vCE ≈ VCE0 + r · iC', 'vDS = iD · RDS(on)', 'vCE = 0'], answer: 0, explain: 'A knee voltage (the forward-biased collector junction) plus a small slope resistance.', misconceptions: { 1: 'That is the MOSFET: unipolar, a pure resistance.' } },
]
