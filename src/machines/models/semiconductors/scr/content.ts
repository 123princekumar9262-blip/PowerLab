import { linearOnState, scrStaysOn, scrTwoTransistor } from '../../../calculations/semiconductors.ts'
import type { CalcResult, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'
import { blockingParams, blockingRows, packageParts, SEMI_LAYERS, TRANSIENT_NOTE } from '../common.ts'
import type { Mode } from '../shared.tsx'

/*
 * Thyristor (SCR) — content and explicit relations. Geometry in Model.tsx: four layers p-n-p-n. Bottom to top:
 * anode metal, p+ anode (p1), thick n− base (n1), p base (p2, with the gate contact), n+ cathode (n2), cathode metal.
 * Junctions: J1 = p1/n1, J2 = n1/p2, J3 = p2/n2.
 */

export const SCR_PARTS: MachinePart[] = [
  { id: 'cathode-metal', label: 'Cathode metal', what: 'The metal contact on the n+ cathode layer.', function: 'The cathode terminal K: the current leaves the device here.', explode: [0, 0.7, 0], stage: 1, anchor: [1.2, 0.86, 0.8], related: ['n-cathode'] },
  { id: 'gate-contact', label: 'Gate contact', what: 'A small metal contact on the p base, beside the cathode.', function: 'The gate G: a current pulse into it (gate → cathode) injects charge into the p base and triggers the device. It can turn the SCR on, not off.', explode: [-0.2, 0.7, 0.3], stage: 1, anchor: [-1.5, 0.84, 0.8], related: ['p-base'] },
  { id: 'n-cathode', label: 'n+ cathode (n2)', what: 'A heavily doped n-type layer at the top, under the cathode metal.', function: 'Emitter of the internal npn transistor: it injects electrons into the p base. Its junction with the p base is J3.', explode: [0, 0.3, 0.8], stage: 3, anchor: [0.8, 0.52, 0.8], related: ['p-base', 'cathode-metal'] },
  { id: 'p-base', label: 'p base (p2)', what: 'A p-type layer between the cathode and the n− base, reaching the surface at the gate.', function: 'Base of the npn transistor and collector of the pnp. The gate current flows into it. Its junction with the n− base, J2, blocks the forward voltage.', explode: [0, 0.15, 0.45], stage: 3, anchor: [-1.0, 0.35, 0.8], related: ['gate-contact', 'n-base', 'n-cathode'] },
  { id: 'n-base', label: 'n− base (n1)', what: 'A thick, lightly doped n-type layer — the widest region.', function: 'Holds the voltage in both directions (forward: across J2, reverse: across J1). Base of the pnp transistor; flooded with carriers when the device conducts.', explode: [0, 0, 0], stage: 3, anchor: [0.4, -0.5, 0.8], related: ['p-base', 'p-anode'] },
  { id: 'p-anode', label: 'p+ anode (p1)', what: 'A heavily doped p-type layer at the bottom.', function: 'Emitter of the pnp transistor: injects holes into the n− base. Its junction with the n− base is J1, which blocks reverse voltage.', explode: [0, -0.35, 0], stage: 2, anchor: [-0.9, -1.28, 0.8], related: ['n-base', 'anode-metal'] },
  { id: 'anode-metal', label: 'Anode metal', what: 'The metal on the back of the die.', function: 'The anode terminal A, soldered to the package tab: current enters here; heat leaves here.', explode: [0, -0.62, 0], stage: 1, anchor: [0.9, -1.66, 0.8], related: ['p-anode', 'leadframe'] },
  ...packageParts({ back: 'anode', top: 'cathode', gate: 'gate', device: 'thyristor' }),
]

export const SCR_LAYERS = SEMI_LAYERS({ bipolar: true })

export const SCR_STEP_MODE: Record<string, Mode> = { structure: 'idle', reverse: 'rblock', forward: 'block', trigger: 'turnon', latched: 'on', 'turn-off': 'turnoff' }
export const SCR_STATES: Mode[] = ['block', 'turnon', 'on', 'turnoff', 'rblock']

export const SCR_STEPS: MachineStep[] = [
  {
    id: 'structure',
    title: '1 · Four layers, three junctions',
    text: 'From the anode (bottom) to the cathode (top): p+ anode p1, thick n− base n1, p base p2, n+ cathode n2 — p-n-p-n. Between them are three junctions: J1 (p1/n1), J2 (n1/p2) and J3 (p2/n2). The gate contacts the p base next to the cathode.',
    focus: ['p-anode', 'n-base', 'p-base', 'n-cathode', 'gate-contact'],
    layers: [],
    detail: 'Real SCRs have cathode "shorts" (the cathode metal touches the p base through holes in n2) and interdigitated gate–cathode patterns; large ones are whole-wafer press-pack discs.',
  },
  {
    id: 'reverse',
    title: '2 · Reverse blocking (anode negative)',
    text: 'With the anode negative, J1 and J3 are reverse-biased and J2 forward-biased. J3 sits between two fairly heavily doped layers and breaks down at a low voltage (typically 10–20 V), so J1 takes the voltage: its depletion region spreads up into the lightly doped n− base. The SCR blocks in both directions — unlike a MOSFET or an IGBT.',
    focus: ['p-anode', 'n-base'],
    layers: ['field'],
    rotate: true,
    equation: 'W = √(2·εSi·VR / (q·ND))  at J1',
  },
  {
    id: 'forward',
    title: '3 · Forward blocking (no gate signal)',
    text: 'With the anode positive and no gate current, J1 and J3 are forward-biased but J2 is reverse-biased: its depletion region spreads down into the n− base and holds the voltage. Only a small leakage current flows; the device is off although it is forward-biased.',
    focus: ['p-base', 'n-base'],
    layers: ['field'],
    rotate: true,
    equation: 'W = √(2·εSi·VAK / (q·ND))  at J2',
    detail: 'If the forward voltage exceeds the break-over voltage, or rises too fast (dv/dt charging the J2 capacitance), the leakage alone can trigger it — an unwanted turn-on.',
  },
  {
    id: 'trigger',
    title: '4 · Gate trigger: regeneration',
    text: 'A gate current flows into the p base and out through the cathode. It makes n2 inject electrons, which cross the p base and J2 into the n− base. There they act as the base current of the pnp (p1-n1-p2): p1 injects holes, which cross the n− base and J2 into the p base — more base current for the npn (n2-p2-n1). Each transistor feeds the other: once the loop gain reaches one, the current grows on its own.',
    focus: ['gate-contact', 'p-base', 'n-cathode', 'n-base', 'p-anode'],
    layers: ['carriers', 'current', 'field'],
    rotate: true,
    equation: 'IA = (α2·IG + ICBO) / (1 − (α1 + α2))  →  latches as α1 + α2 → 1',
    detail: 'Two-transistor analogy: Q1 = pnp (p1-n1-p2) with gain α1, Q2 = npn (n2-p2-n1) with gain α2. The gains rise with current, so a gate pulse drives α1 + α2 up to 1. The anode current must reach the latching current IL before the gate pulse ends.',
  },
  {
    id: 'latched',
    title: '5 · Latched conduction',
    text: 'Now all three junctions are forward-biased and the n− and p bases are flooded with holes and electrons. Holes flow from the anode up, electrons from the cathode down, and the current is set by the external circuit, not by the gate: the gate can be removed and the SCR stays on. The voltage drop is about one to two volts.',
    focus: ['n-base', 'p-base', 'p-anode', 'n-cathode'],
    layers: ['carriers', 'current', 'energy'],
    rotate: true,
    equation: 'vT ≈ VT0 + rT · iT    stays on while iA ≥ IH',
  },
  {
    id: 'turn-off',
    title: '6 · Turning off',
    text: 'The gate cannot turn it off. The anode current must fall below the holding current IH — naturally, when the AC line or a resonant circuit reverses it, or by forced commutation — so the regenerative loop stops. The stored charge recombines, J2 recovers and builds its depletion region again; a reverse voltage must be held for at least the turn-off time tq before forward voltage may return.',
    focus: ['n-base', 'p-base'],
    layers: ['carriers', 'field'],
    rotate: true,
    equation: 'iA < IH  (and reverse bias for t > tq)  ⇒  off',
    detail: 'A GTO or IGCT is a thyristor designed to be turned off by a large negative gate current. The Switching Devices lab simulates latching, holding and forced commutation.',
  },
]

export const SCR_PARAMS: MachineParam[] = [
  { id: 'state', label: 'State (0 forward blocking · 1 triggering · 2 latched · 3 turning off · 4 reverse blocking)', unit: '', min: 0, max: 4, step: 1, value: 2, options: [0, 1, 2, 3, 4] },
  { id: 'it', label: 'Anode current iT', unit: 'A', min: 0, max: 100, step: 1, value: 30 },
  { id: 'vt0', label: 'Knee voltage VT0 (example)', unit: 'V', min: 0.7, max: 1.5, step: 0.05, value: 1.0, level: 'standard' },
  { id: 'rt', label: 'Slope resistance rT (example)', unit: 'mΩ', min: 1, max: 30, step: 1, value: 8, level: 'standard' },
  { id: 'ih', label: 'Holding current IH (example)', unit: 'mA', min: 5, max: 200, step: 5, value: 50, level: 'standard' },
  ...blockingParams({ label: 'Blocking voltage (forward or reverse)', v: 800, vmax: 2000, nd: 0.5, wd: 250, wdMin: 100, wdMax: 400 }),
  { id: 'a1', label: 'pnp gain α1 (p1-n1-p2)', unit: '', min: 0, max: 0.95, step: 0.01, value: 0.4, level: 'engineer' },
  { id: 'a2', label: 'npn gain α2 (n2-p2-n1)', unit: '', min: 0, max: 0.95, step: 0.01, value: 0.45, level: 'engineer' },
  { id: 'ig', label: 'Gate current IG', unit: 'mA', min: 0, max: 100, step: 1, value: 20, level: 'engineer' },
  { id: 'ico', label: 'Junction leakage ICBO1 + ICBO2', unit: 'µA', min: 0.1, max: 100, step: 0.1, value: 10, level: 'engineer' },
]

export function scrCalc(p: Record<string, number>): CalcResult[] {
  const on = linearOnState({ v0: p.vt0, r: p.rt / 1000, i: p.it })
  const tt = scrTwoTransistor({ a1: p.a1, a2: p.a2, ig: p.ig / 1000, ico: p.ico * 1e-6 })
  const state = Math.round(p.state)
  const holds = scrStaysOn(p.it, p.ih / 1000)
  const below = 'iT < IH: the regenerative loop cannot be sustained — the SCR turns off.'
  let vop: number | null = null
  let pop: number | null = null
  let note: string | undefined
  if (state === 0 || state === 4) {
    vop = state === 0 ? p.vb : -p.vb
    pop = 0
    note = state === 0 ? 'Forward blocking: J2 holds the voltage; leakage neglected.' : 'Reverse blocking: J1 holds the voltage; leakage neglected.'
  } else if (state === 2) {
    vop = holds && on ? on.v : null
    pop = holds && on ? on.p : null
    note = holds ? undefined : below
  } else note = TRANSIENT_NOTE
  const junction = state === 4 ? 'J1, reverse blocking' : 'J2, forward blocking'
  return [
    { id: 'vt', label: 'On-state voltage vT', value: on ? on.v : null, unit: 'V', formula: 'vT ≈ VT0 + rT · iT', note: 'Latched, piecewise-linear model with example values, fixed temperature.' },
    { id: 'pcond', label: 'Conduction loss', value: on ? on.p : null, unit: 'W', formula: 'P = VT0·iT + rT·iT²', note: 'Steady DC current while latched.' },
    { id: 'margin', label: 'Holding margin iT − IH', value: p.it - p.ih / 1000, unit: 'A', formula: 'iT − IH  (≥ 0: stays latched)', note: holds ? 'Above the holding current: once latched it stays on without gate current.' : below },
    { id: 'loop', label: 'Loop gain α1 + α2', value: tt ? tt.loop : null, unit: '', formula: 'α1 + α2  (two-transistor model)', note: tt?.latched ? '≥ 1: regenerative — the device latches.' : 'Below 1: the loop is not regenerative at these gains.' },
    { id: 'ia', label: 'Anode current, two-transistor model', value: tt && tt.ia !== null ? tt.ia * 1000 : null, unit: 'mA', formula: 'IA = (α2·IG + ICBO) / (1 − (α1 + α2))', note: tt?.latched ? 'α1 + α2 ≥ 1: the formula has no finite value — the device has latched and the external circuit sets the current.' : 'Gains taken constant (they really rise with current, which is what makes a gate pulse trigger it).' },
    { id: 'vop', label: 'Device voltage vAK in the selected state', value: vop, unit: 'V', formula: state === 0 ? 'vAK = forward blocking voltage' : state === 4 ? 'vAK = −reverse voltage' : state === 2 ? 'vAK = vT' : 'transient: no steady relation', note },
    { id: 'pop', label: 'Loss in the selected state', value: pop, unit: 'W', formula: state === 0 || state === 4 ? 'P ≈ 0 (leakage neglected)' : state === 2 ? 'P = vT · iT' : 'transient: no steady relation', note: state === 1 || state === 3 ? TRANSIENT_NOTE : undefined },
    ...blockingRows(p, junction),
  ]
}

export const SCR_CONTENT: MachineContent = {
  overview: 'A thyristor (silicon-controlled rectifier, SCR) is a four-layer p-n-p-n switch. It blocks in both directions; a short gate current pulse turns it on, and it then stays on by itself (latches) until its current falls below the holding current.',
  construction: 'Vertical four-layer die: anode metal, p+ anode (p1), thick n− base (n1), p base (p2), n+ cathode (n2), cathode metal; the gate contact sits on the p base next to the cathode. Junctions J1 (p1/n1), J2 (n1/p2), J3 (p2/n2). Small SCRs come in TO-220/TO-247 packages (anode on the tab); large ones as press-pack discs.',
  principle: 'Two-transistor analogy: the p1-n1-p2 pnp and the n2-p2-n1 npn are connected so that each one’s collector current is the other’s base current. A gate current starts the loop; when α1 + α2 reaches 1 the current regenerates and the device latches with all junctions forward-biased. Turn-off needs the anode current below IH (and reverse bias for longer than tq).',
  equations: [
    { expr: 'IA = (α2·IG + ICBO1 + ICBO2) / (1 − (α1 + α2))', meaning: 'Two-transistor model: finite while α1 + α2 < 1; latches as α1 + α2 → 1.' },
    { expr: 'vT ≈ VT0 + rT · iT', meaning: 'On-state voltage while latched.' },
    { expr: 'P = VT0·iT + rT·iT²', meaning: 'Conduction loss.' },
    { expr: 'iA ≥ IL (at the end of the gate pulse),  iA ≥ IH (to stay on)', meaning: 'Latching and holding conditions.' },
    { expr: 'W = √(2·εSi·V / (q·ND))', meaning: 'Depletion width of the blocking junction in the n− base (J2 forward, J1 reverse).' },
  ],
  assumptions: ['VT0, rT, IH, α1, α2 are EXAMPLE values, not a specific product.', 'Two-transistor model with constant gains (in reality they rise with current).', 'Blocking: one-sided abrupt junction into a uniformly doped n− base, leakage neglected.', 'Turn-on and turn-off dynamics are described, not calculated — the Switching Devices lab simulates them.'],
  characteristics: ['Latching: on with a gate pulse, off only when the current falls below IH.', 'Blocks forward and reverse voltage.', 'Very high voltage and current ratings, low on-state voltage (fully flooded).', 'Slow: turn-off time tq of tens to hundreds of µs.'],
  losses: ['Conduction loss VT0·iT + rT·iT².', 'Turn-on loss (current spreading from the gate edge, di/dt limit).', 'Reverse-recovery loss at turn-off.', 'Gate loss (small).'],
  advantages: ['Highest voltage and current ratings of all semiconductor switches (several kV, kA).', 'Low conduction loss.', 'Only a short gate pulse is needed.'],
  limitations: ['Cannot be turned off from the gate (needs line or forced commutation).', 'Low switching frequency.', 'dv/dt and di/dt limits: snubbers and gate design needed.'],
  applications: ['Controlled rectifiers and AC voltage controllers (phase control)', 'HVDC converters and static VAR compensators', 'Soft starters, heaters, lamp dimmers (TRIAC)', 'Crowbar protection'],
  misconceptions: [
    'The gate does not have to stay on: after latching, the SCR stays on with no gate current.',
    'Removing the gate signal does not turn it off: the anode current must fall below IH.',
    'In forward blocking it is not "an open circuit everywhere": J1 and J3 are forward-biased; only J2 blocks.',
  ],
  sources: ['Mohan, Undeland & Robbins, Power Electronics (thyristors).', 'B. J. Baliga, Fundamentals of Power Semiconductor Devices.'],
}

export const SCR_QUIZ: QuizItem[] = [
  { id: 'id-pbase', kind: 'identify', prompt: 'What is the highlighted part?', part: 'p-base', options: ['p+ anode (p1)', 'p base (p2)', 'n− base (n1)', 'n+ cathode (n2)'], answer: 1, explain: 'The p base p2: the gate contact is on it; its junction with the n− base (J2) blocks the forward voltage.', misconceptions: { 0: 'The p+ anode is the bottom layer on the anode side.' } },
  { id: 'id-nbase', kind: 'identify', prompt: 'What is the highlighted part?', part: 'n-base', options: ['n− base (n1)', 'Gate contact', 'p base (p2)', 'Anode metal'], answer: 0, explain: 'The thick, lightly doped n− base: it holds the voltage in both directions.' },
  { id: 'predict-gate', kind: 'predict', prompt: 'The SCR has latched with iT = 30 A (IH = 50 mA). The gate current is removed. What happens?', options: ['It stays on', 'It turns off at once', 'The current falls to IH'], answer: 0, explain: 'Once latched, the two internal transistors keep each other on; the gate is no longer needed.', misconceptions: { 1: 'That is what a MOSFET or IGBT would do; an SCR latches.' } },
  { id: 'predict-off', kind: 'predict', prompt: 'How do you turn a conducting SCR off?', options: ['Make the anode current fall below IH (and hold reverse voltage for tq)', 'Apply a negative gate current', 'Remove the gate current'], answer: 0, explain: 'Only the main circuit can turn it off: line or forced commutation brings the current below IH.', misconceptions: { 1: 'That is a GTO / IGCT: an ordinary SCR cannot be turned off from the gate.' } },
  { id: 'order', kind: 'order', prompt: 'Put the triggering sequence in order.', options: ['Gate current flows into the p base', 'n2 injects electrons that cross J2 into the n− base', 'p1 injects holes that cross into the p base', 'The loop gain α1 + α2 reaches 1: the SCR latches'], answer: 0, explain: 'Gate → npn action → pnp action → each feeds the other until it regenerates.' },
  { id: 'match-j', kind: 'match', prompt: 'In forward blocking (anode positive, no gate signal), which junction holds the voltage?', options: ['J2 (n1/p2)', 'J1 (p1/n1)', 'J3 (p2/n2)'], answer: 0, explain: 'J1 and J3 are forward-biased; J2 is reverse-biased and its depletion region in the n− base holds the voltage.', misconceptions: { 1: 'J1 blocks in reverse (anode negative).' } },
]
