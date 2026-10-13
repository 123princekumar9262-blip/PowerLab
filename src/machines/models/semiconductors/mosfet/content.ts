import { linearOnState, mosfetOn } from '../../../calculations/semiconductors.ts'
import type { CalcResult, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'
import { blockingParams, blockingRows, packageParts, SEMI_LAYERS, TRANSIENT_NOTE } from '../common.ts'
import type { Mode } from '../shared.tsx'

/*
 * Vertical (planar, double-diffused) n-channel power MOSFET — content and explicit relations. Geometry in Model.tsx.
 * One cell: source metal on top, two p-body wells with n+ sources, the polysilicon gate on its thin gate oxide over
 * the channel regions and the drift "neck" between the wells, the thick n− drift, the n+ substrate and the drain
 * metal underneath. Conduction is vertical: source (top) → drain (bottom) for electrons.
 */

export const MOSFET_PARTS: MachinePart[] = [
  { id: 'source-metal', label: 'Source metal', what: 'The aluminium layer covering the top of the cell.', function: 'The source terminal. It contacts the n+ source AND the p body: shorting them keeps the parasitic npn transistor (n+ source / p body / n− drift) off, and makes the p body / n− drift junction the body diode.', explode: [0, 0.85, 0], stage: 1, anchor: [1.6, 1.24, 0.8], related: ['n-source', 'p-body'] },
  { id: 'gate', label: 'Polysilicon gate', what: 'A conducting layer of doped polysilicon, insulated on all sides.', function: 'The gate electrode. A positive gate–source voltage on it pulls electrons to the p-body surface underneath and forms the channel. It draws no steady current — only the charge of its capacitance.', explode: [0, 0.62, 0.5], stage: 2, anchor: [0.55, 0.9, 0.8], related: ['gate-oxide', 'channel'] },
  { id: 'gate-oxide', label: 'Gate oxide and insulation', what: 'Silicon dioxide: a very thin film under the gate, a thicker layer over it.', function: 'Insulates the gate from the silicon (the thin part, tens of nm, lets the gate field reach the surface) and from the source metal above. Too high a VGS (typically beyond ±20 V) punctures it.', explode: [0, 0.34, 0.25], stage: 2, anchor: [-1.18, 1.07, 0.8], related: ['gate', 'channel'] },
  { id: 'n-source', label: 'n+ source', what: 'Heavily doped n-type regions at the surface, inside the p body.', function: 'Supply the electrons that flow through the channel. Heavily doped so the source contact has very little resistance.', explode: [0, 0, 1.0], stage: 3, anchor: [-1.2, 0.55, 0.8], related: ['p-body', 'source-metal'] },
  { id: 'p-body', label: 'p body', what: 'p-type wells diffused into the drift region under the source.', function: 'Holds the channel at its surface under the gate. With no gate voltage, its junction with the n− drift blocks the drain voltage; that same p-n junction is the body diode.', explode: [0, 0, 0.6], stage: 3, anchor: [1.75, 0.22, 0.8], related: ['channel', 'n-drift'] },
  { id: 'channel', label: 'Inversion channel', what: 'A very thin n-type layer at the p-body surface under the gate — present only while VGS > Vth (faint here when off).', function: 'Connects the n+ source to the n− drift: the only path for electrons from source to drain. Its resistance falls as VGS rises above the threshold.', explode: [0, 0, 1.35], stage: 3, anchor: [0.82, 0.6, 0.8], related: ['gate', 'p-body', 'n-source'] },
  { id: 'n-drift', label: 'n− drift region', what: 'A thick, lightly doped n-type layer.', function: 'Blocks the off-state voltage: it can deplete over a long distance, so the field stays below breakdown. It is also the largest part of RDS(on) in a high-voltage MOSFET — the price of the blocking voltage.', explode: [0, 0, 0], stage: 3, anchor: [0.9, -0.5, 0.8], related: ['p-body', 'n-substrate'] },
  { id: 'n-substrate', label: 'n+ substrate', what: 'The heavily doped wafer the device is built on.', function: 'Carries the current to the drain metal with little resistance, and gives the device mechanical strength.', explode: [0, -0.3, 0], stage: 3, anchor: [-0.9, -1.28, 0.8], related: ['n-drift', 'drain-metal'] },
  { id: 'drain-metal', label: 'Drain metal', what: 'The metal on the back of the die.', function: 'The drain terminal, soldered to the package tab: it carries the current and the heat out of the die.', explode: [0, -0.5, 0], stage: 1, anchor: [0.9, -1.66, 0.8], related: ['n-substrate', 'leadframe'] },
  ...packageParts({ back: 'drain', top: 'source', gate: 'gate', device: 'MOSFET' }),
]

export const MOSFET_LAYERS = SEMI_LAYERS({ bipolar: false })

/** What the cell shows in each guided step, and for each value of the state selector. */
export const MOSFET_STEP_MODE: Record<string, Mode> = { structure: 'idle', blocking: 'block', 'turn-on': 'turnon', conduction: 'on', 'body-diode': 'reverse', 'turn-off': 'turnoff' }
export const MOSFET_STATES: Mode[] = ['block', 'turnon', 'on', 'turnoff', 'reverse']

export const MOSFET_STEPS: MachineStep[] = [
  {
    id: 'structure',
    title: '1 · The layer stack of one cell',
    text: 'Top to bottom: source metal; the polysilicon gate wrapped in oxide; n+ source regions inside p-body wells; the thick, lightly doped n− drift region; the n+ substrate; the drain metal on the back. The device is vertical: current flows from the drain at the bottom to the source at the top. A real die repeats this cell thousands of times in parallel.',
    focus: ['source-metal', 'gate', 'gate-oxide', 'n-source', 'p-body', 'n-drift', 'n-substrate', 'drain-metal'],
    layers: [],
    detail: 'This is a planar double-diffused (DMOS) cell: the p body and n+ source are diffused through the same gate-edge window, so the channel length is set by the difference of two diffusions. Modern low-voltage parts use trench gates; superjunction parts add p pillars in the drift region.',
  },
  {
    id: 'blocking',
    title: '2 · Off: blocking the drain voltage',
    text: 'With VGS below the threshold there is no channel. A positive drain voltage reverse-biases the junction between the p body and the n− drift. Its depletion region grows mainly into the lightly doped drift (W ∝ √V): the voltage is held across that region, where only ionised donors (+) remain and the field points up towards the p body. Only a tiny leakage current flows.',
    focus: ['p-body', 'n-drift'],
    layers: ['field'],
    rotate: true,
    equation: 'W = √(2·εSi·vDS / (q·ND))    Emax = 2·vDS / W',
    detail: 'Breakdown starts when Emax reaches the critical field (≈ 200–300 kV/cm in Si). Higher rating ⇒ lower ND and thicker drift ⇒ higher RDS(on): roughly RDS(on)·A ∝ V_BR^2.5 for silicon (the "silicon limit").',
  },
  {
    id: 'turn-on',
    title: '3 · Turning on: the gate forms a channel',
    text: 'A positive gate–source voltage charges the gate like a capacitor plate. Its field through the thin oxide pushes the holes of the p body away from the surface and pulls electrons there. Above the threshold voltage Vth the surface inverts: a thin n-type channel joins the n+ source to the n− drift. No steady gate current flows — the gate is insulated.',
    focus: ['gate', 'gate-oxide', 'channel', 'p-body'],
    layers: ['carriers', 'field'],
    rotate: true,
    equation: 'channel exists when VGS > Vth',
    detail: 'During switching the gate driver must supply the gate charge QG; the Miller plateau is where the gate–drain capacitance is being recharged as vDS falls.',
  },
  {
    id: 'conduction',
    title: '4 · Conducting: electrons only',
    text: 'Electrons leave the n+ source, pass through the channel, turn down through the drift region and the substrate and reach the drain; conventional current flows the other way, drain to source. Only electrons carry the current (unipolar): the drift region is not flooded with extra carriers, so the device behaves as a resistance RDS(on), and its loss grows with the square of the current.',
    focus: ['channel', 'n-drift', 'n-substrate', 'n-source'],
    layers: ['carriers', 'current', 'energy'],
    rotate: true,
    equation: 'vDS = iD · RDS(on)    P = iD² · RDS(on)',
    detail: 'RDS(on) = Rsource + Rchannel + Raccumulation + RJFET + Rdrift + Rsubstrate; at high voltage Rdrift dominates. RDS(on) rises with temperature (about ×1.5–2 from 25 to 125 °C), which helps parallel devices share current.',
  },
  {
    id: 'body-diode',
    title: '5 · The inherent body diode',
    text: 'The p body is tied to the source by the metal, and the n− drift sits on the n+ drain: together they are a p-i-n diode from source to drain, built into every power MOSFET. When the current is forced backwards (source to drain, e.g. freewheeling in a bridge), this diode conducts: holes are injected from the p body and electrons from the substrate.',
    focus: ['p-body', 'n-drift', 'n-substrate', 'source-metal'],
    layers: ['carriers', 'current'],
    rotate: true,
    equation: 'vSD ≈ VF0 + rd · iS',
    detail: 'The body diode is bipolar: it stores charge and has a reverse recovery, often slow. Turning the gate on during reverse conduction (synchronous rectification) lets the channel carry the reverse current with a smaller drop.',
  },
  {
    id: 'turn-off',
    title: '6 · Turning off',
    text: 'The gate is discharged below Vth: the channel disappears and the electron path is cut. Because there is no stored minority charge, the current stops as fast as the gate and the device capacitances can be discharged; the drain voltage rises and the depletion region of the blocking junction builds up again.',
    focus: ['gate', 'channel', 'n-drift'],
    layers: ['carriers', 'field'],
    rotate: true,
    equation: 'VGS < Vth ⇒ no channel ⇒ iD → 0',
    detail: 'Switching speed is set by the gate drive and the capacitances (Ciss, Crss): tens of ns. Fast di/dt with the loop inductance gives voltage overshoot. See the simulated waveforms in the Switching Devices lab.',
  },
]

export const MOSFET_PARAMS: MachineParam[] = [
  { id: 'state', label: 'State (0 off · 1 turning on · 2 on · 3 turning off · 4 body diode)', unit: '', min: 0, max: 4, step: 1, value: 2, options: [0, 1, 2, 3, 4] },
  { id: 'id', label: 'Drain current iD', unit: 'A', min: 0, max: 60, step: 1, value: 20 },
  { id: 'vgs', label: 'Gate–source voltage VGS', unit: 'V', min: 0, max: 20, step: 0.5, value: 12 },
  { id: 'vth', label: 'Threshold voltage Vth (example device)', unit: 'V', min: 2, max: 6, step: 0.1, value: 4, level: 'standard' },
  { id: 'rds', label: 'RDS(on) (example device)', unit: 'mΩ', min: 10, max: 500, step: 5, value: 80, level: 'standard' },
  ...blockingParams({ label: 'Off-state voltage vDS', v: 400, vmax: 1000, nd: 2, wd: 60, wdMin: 20, wdMax: 150 }),
  { id: 'vf0', label: 'Body diode knee VF0 (example)', unit: 'V', min: 0.5, max: 1.2, step: 0.05, value: 0.8, level: 'engineer' },
  { id: 'rdb', label: 'Body diode slope rd (example)', unit: 'mΩ', min: 2, max: 50, step: 1, value: 15, level: 'engineer' },
]

export function mosfetCalc(p: Record<string, number>): CalcResult[] {
  const on = mosfetOn({ id: p.id, rdson: p.rds / 1000, vgs: p.vgs, vth: p.vth })
  const bd = linearOnState({ v0: p.vf0, r: p.rdb / 1000, i: p.id })
  const state = Math.round(p.state)
  const noCh = 'VGS ≤ Vth: no channel — the MOSFET is off, so this relation does not apply.'
  let vop: number | null = null
  let pop: number | null = null
  let opNote: string | undefined
  if (state === 0) {
    vop = p.vb
    pop = 0
    opNote = 'Off: the drift region holds the voltage; the leakage current (µA) and its loss are neglected.'
  } else if (state === 2) {
    vop = on ? on.vds : null
    pop = on ? on.p : null
    opNote = on ? undefined : noCh
  } else if (state === 4) {
    vop = bd ? -bd.v : null
    pop = bd ? bd.p : null
    opNote = 'Reverse current through the body diode (gate off): vDS = −vSD.'
  } else opNote = TRANSIENT_NOTE
  return [
    { id: 'ov', label: 'Gate overdrive VGS − Vth', value: p.vgs - p.vth, unit: 'V', formula: 'VGS − Vth  (> 0: an inversion channel forms)', note: p.vgs > p.vth ? undefined : 'Not above the threshold: no channel.' },
    { id: 'vds', label: 'On-state voltage vDS', value: on ? on.vds : null, unit: 'V', formula: 'vDS = iD · RDS(on)', note: on ? 'Fully on (ohmic region), fixed temperature; RDS(on) is an example datasheet-style value.' : noCh },
    { id: 'pcond', label: 'Conduction loss', value: on ? on.p : null, unit: 'W', formula: 'P = iD² · RDS(on)', note: on ? 'Steady DC current; switching losses are not included.' : noCh },
    { id: 'vsd', label: 'Body diode drop vSD (reverse current)', value: bd ? bd.v : null, unit: 'V', formula: 'vSD ≈ VF0 + rd · iS', note: 'Piecewise-linear diode model, example values; channel off.' },
    { id: 'vop', label: 'Device voltage in the selected state', value: vop, unit: 'V', formula: state === 0 ? 'vDS = applied off-state voltage' : state === 2 ? 'vDS = iD · RDS(on)' : state === 4 ? 'vDS = −(VF0 + rd·iS)' : 'transient: no steady relation', note: opNote },
    { id: 'pop', label: 'Loss in the selected state', value: pop, unit: 'W', formula: state === 0 ? 'P ≈ 0 (leakage neglected)' : state === 2 ? 'P = iD² · RDS(on)' : state === 4 ? 'P = vSD · iS' : 'transient: no steady relation', note: state === 1 || state === 3 ? TRANSIENT_NOTE : undefined },
    ...blockingRows(p, 'p body / n− drift junction'),
  ]
}

export const MOSFET_CONTENT: MachineContent = {
  overview: 'A power MOSFET is a voltage-controlled switch: a gate voltage above the threshold forms a thin electron channel that connects the source to the drain. It conducts with electrons only, so it switches fast and behaves as a resistance RDS(on) when on.',
  construction: 'Vertical n-channel DMOS cell: source metal on top contacting the n+ source and the p body; a polysilicon gate on a thin gate oxide over the p-body surface (the channel region) and over the drift "neck" between two p wells; a thick, lightly doped n− drift region; an n+ substrate; drain metal on the back, soldered to the package tab. Thousands of cells are connected in parallel on one die.',
  principle: 'With VGS < Vth the p-body / n− drift junction is reverse-biased by the drain voltage and blocks it across the depletion region in the drift. With VGS > Vth the gate field inverts the p-body surface: electrons flow from the n+ source through the channel, down through the drift and the substrate to the drain. Removing the gate voltage removes the channel; with no stored minority charge, the current stops quickly.',
  equations: [
    { expr: 'VGS > Vth', meaning: 'Condition for an inversion channel (the device can conduct).' },
    { expr: 'vDS = iD · RDS(on)', meaning: 'On-state voltage, fully on (ohmic region).' },
    { expr: 'P = iD² · RDS(on)', meaning: 'Conduction loss: grows with the square of the current.' },
    { expr: 'W = √(2·εSi·V / (q·ND)),  Emax = 2·V / W', meaning: 'Off state: depletion width and peak field in the n− drift (one-sided abrupt junction).' },
    { expr: 'vSD ≈ VF0 + rd · iS', meaning: 'Body diode in reverse conduction (gate off), piecewise-linear model.' },
  ],
  assumptions: ['Steady on-state in the ohmic region; RDS(on), Vth, VF0 and rd are EXAMPLE values, not a specific product.', 'Fixed junction temperature (RDS(on) rises with temperature in reality).', 'Blocking: one-sided abrupt p-body / n− drift junction, uniform drift doping, built-in potential and leakage neglected.', 'Switching transients are not calculated here — the Switching Devices lab simulates them.'],
  characteristics: ['Voltage-driven gate: no steady gate current, only gate charge at each switching.', 'Unipolar conduction: no tail current, fast switching (tens of ns).', 'Resistive on-state: vDS ∝ iD; RDS(on) has a positive temperature coefficient.', 'A body diode is always present from source to drain.'],
  losses: ['Conduction loss iD²·RDS(on).', 'Switching loss in each transition (overlap of voltage and current), and the output-capacitance energy at turn-on.', 'Gate-drive loss QG·VGS·f.', 'Body-diode conduction and reverse-recovery loss in bridge legs.'],
  advantages: ['Simple, low-power gate drive.', 'Fastest silicon switch at low and medium voltage.', 'Easy to parallel (positive temperature coefficient).'],
  limitations: ['RDS(on) grows steeply with the voltage rating: silicon MOSFETs are rarely used above ~900 V (superjunction, SiC extend that).', 'The body diode can be slow and lossy.', 'The gate oxide is fragile (overvoltage, ESD).'],
  applications: ['Switch-mode power supplies and DC-DC converters', 'Synchronous rectifiers', 'Low-voltage motor drives and battery systems', 'Class-D audio and wireless power'],
  misconceptions: [
    'The gate does not pass current into the device: it is insulated; it only needs charge to change its voltage.',
    'The channel is not a doped layer built into the device: it exists only while VGS > Vth.',
    'A MOSFET cannot block reverse voltage: its body diode conducts as soon as the source is more positive than the drain.',
    'Higher voltage rating is not free: the thicker, lighter drift region raises RDS(on).',
  ],
  sources: ['B. J. Baliga, Fundamentals of Power Semiconductor Devices.', 'Mohan, Undeland & Robbins, Power Electronics: Converters, Applications and Design.'],
}

export const MOSFET_QUIZ: QuizItem[] = [
  { id: 'id-channel', kind: 'identify', prompt: 'What is the highlighted part?', part: 'channel', options: ['The inversion channel', 'The gate oxide', 'The n+ source', 'The p body'], answer: 0, explain: 'The inversion channel: a thin n-type layer at the p-body surface under the gate, present only while VGS > Vth.', misconceptions: { 3: 'The p body is the whole p well; the channel is only its thin surface layer under the gate, inverted by the gate field.' } },
  { id: 'id-oxide', kind: 'identify', prompt: 'What is the highlighted part?', part: 'gate-oxide', options: ['Polysilicon gate', 'Gate oxide and insulation', 'Source metal', 'n− drift region'], answer: 1, explain: 'The silicon dioxide that insulates the gate: very thin under the gate, thicker between the gate and the source metal.' },
  { id: 'predict-vgs', kind: 'predict', prompt: 'VGS is raised from 2 V to 12 V on a device with Vth = 4 V and a drain voltage applied through a load. What happens?', options: ['An n-type channel forms under the gate and drain current flows', 'Holes gather at the surface and the device blocks harder', 'Current flows from the gate into the drain'], answer: 0, explain: 'Above Vth the gate field inverts the p-body surface: electrons form a channel from the n+ source to the n− drift.', misconceptions: { 2: 'The gate is insulated by the oxide: no steady gate current flows, only the charge for the gate capacitance.' } },
  { id: 'predict-loss', kind: 'predict', prompt: 'The drain current doubles (fully on, same RDS(on)). The conduction loss…', options: ['becomes four times larger', 'doubles', 'stays the same'], answer: 0, explain: 'P = iD²·RDS(on): twice the current, four times the loss.', misconceptions: { 1: 'That would be true for a fixed voltage drop; the MOSFET is resistive, so its voltage doubles too.' } },
  { id: 'order', kind: 'order', prompt: 'Put the turn-on and conduction sequence in order.', options: ['VGS rises above Vth', 'Holes are pushed away and electrons gather at the p-body surface: a channel', 'Electrons flow from the n+ source through the channel into the drift region', 'They cross the drift region and the substrate to the drain'], answer: 0, explain: 'Gate voltage first, then inversion (the channel), then the electron flow source → channel → drift → substrate → drain.' },
  { id: 'match-body', kind: 'match', prompt: 'Which layers form the MOSFET’s inherent body diode?', options: ['The p body and the n− drift (on the n+ substrate)', 'The gate oxide and the polysilicon gate', 'The n+ source and the source metal'], answer: 0, explain: 'The p body is tied to the source; with the n− drift and the n+ drain it forms a p-i-n diode from source to drain.' },
  { id: 'predict-fast', kind: 'predict', prompt: 'Why does a power MOSFET turn off faster than an IGBT?', options: ['It conducts with electrons only: no stored minority charge has to be removed', 'Its gate current is larger', 'Its drift region is thicker'], answer: 0, explain: 'Unipolar conduction: when the channel goes, the current stops as soon as the capacitances are charged — no tail.', misconceptions: { 1: 'The gate draws no steady current; speed depends on how fast the gate charge is delivered, the same idea in both devices.' } },
]
