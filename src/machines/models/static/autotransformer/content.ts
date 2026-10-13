import { autotransformer } from '../../../calculations/static.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Step-down autotransformer on a SHELL-TYPE (E-I) core — content and explicit calculations (geometry in
 * Model.tsx). One winding on the centre limb: the common section (N2 turns, between the common terminal N at the
 * bottom and the tap X1) and the series section (N1 − N2 turns, between the tap and the input terminal H1 at the
 * top). The tap height in the model follows N2/N1.
 */
export const AT_PARTS: MachinePart[] = [
  { id: 'frame', label: 'Clamping brackets', what: 'Steel angle brackets clamping the E and I laminations, with feet.', function: 'Hold the core stack tight (less hum) and fix the unit to its base.', outer: true, explode: [0, 0, -2.0], stage: 1, anchor: [1.55, -1.3, 0.5], related: ['core-e', 'core-i'] },
  { id: 'core-e', label: 'E laminations', what: 'E-shaped silicon-steel sheets: a centre limb and two outer limbs.', function: 'Shell-type core: the winding sits on the centre limb; its flux returns, split in two halves, through the outer limbs — so they are half as wide.', explode: [0, -1.75, 0], stage: 3, anchor: [-1.3, -1.3, 0.42], related: ['core-i', 'winding-series', 'winding-common'] },
  { id: 'core-i', label: 'I laminations', what: 'The straight bar that closes the E.', function: 'Closes the magnetic circuit at the top. E and I sheets are stacked alternately reversed in real cores so the joints overlap.', explode: [0, 1.1, 0], stage: 2, anchor: [-1.25, 1.52, 0], related: ['core-e'] },
  { id: 'bobbin', label: 'Bobbin (coil former)', what: 'An insulating former with flanges around the centre limb.', function: 'Carries the winding and insulates it from the core.', explode: [0, 0, 0], stage: 3, anchor: [0.75, -1.07, 0.75], related: ['winding-series', 'winding-common'] },
  { id: 'winding-common', label: 'Common section (N2 turns)', what: 'The lower part of the single winding, from the common terminal N up to the tap.', function: 'Shared by input and output: it carries only the difference of the two currents, I2 − I1 — so it can be thinner than a separate secondary.', explode: [0, 0, 0], stage: 3, anchor: [0.72, -0.4, 1.0], related: ['winding-series', 'tap'] },
  { id: 'winding-series', label: 'Series section (N1 − N2 turns)', what: 'The upper part of the winding, from the tap up to the input terminal H1.', function: 'Carries the input current I1. Only the power that passes through this section and the common section is actually transformed.', explode: [0, 0.45, 0], stage: 3, anchor: [0.72, 0.82, 1.0], related: ['winding-common', 'terminals'] },
  { id: 'tap', label: 'Tap and output terminal X1', what: 'A lead brought out from a turn part-way along the winding.', function: 'Takes the output voltage V2 = V1·N2/N1 from the tap to the common terminal. In a variac the tap is a carbon brush sliding on bare turns.', explode: [0, 0.8, 0.9], stage: 1, anchor: [0.3, 1.02, 1.06], related: ['winding-common', 'winding-series'] },
  { id: 'terminals', label: 'Terminals H1 and N', what: 'The winding ends brought out to studs on an insulating board.', function: 'H1 and N connect the supply across the whole winding; N is shared by the input and the output — there is no isolation.', explode: [0, 0.8, 0.5], stage: 1, anchor: [-0.7, 1.46, 0.85], related: ['tap'] },
]

export const AT_LAYERS: LayerInfo[] = [
  { id: 'flux', label: 'Core flux', legend: 'Blue: the alternating flux, up the centre limb and back down the two outer limbs (half in each); it reverses every half-cycle. The same flux links every turn, so each turn has the same volts.', conceptual: true },
  { id: 'current', label: 'Currents', legend: 'Green: conventional current. I1 from the supply into H1 and through the series section; I2 out of the tap to the load; the common section carries the difference I2 − I1, circulating the other way (arrows on the front of the coil, length ∝ current).', conceptual: true },
  { id: 'energy', label: 'Power split', legend: 'Orange: the two ways power reaches the load — conducted straight through the copper from H1 to the tap, and transformed through the core flux. Line widths in proportion to S·V2/V1 and S·(1 − V2/V1).', conceptual: true },
]

export const AT_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'A shell-type core of E and I laminations carries ONE winding on its centre limb. A tap part-way along the winding is brought out. The lower part, between the common terminal N and the tap, is the common section (N2 turns); the upper part, from the tap to the input terminal H1, is the series section. Input and output share the common terminal: there is no separate secondary.',
    focus: ['core-e', 'core-i', 'winding-series', 'winding-common', 'tap'],
    layers: [],
    detail: 'The two sections are shaded differently only to show them; physically it is one continuous winding. In a variac the core is a toroid and the tap is a brush sliding over the bared turns.',
  },
  {
    id: 'ratio',
    title: '2 · A voltage divider made of turns',
    text: 'The supply across the whole winding (N1 turns) sets an alternating flux in the core. The same flux links every turn, so every turn has the same voltage. The tap takes the voltage of the N2 turns between N and the tap: V2 = V1·N2/N1. Unlike a resistive divider, it does this without wasting power, and the output can supply a large current.',
    focus: ['winding-common', 'winding-series', 'core-e'],
    layers: ['flux'],
    rotate: true,
    equation: 'V2 / V1 = N2 / N1 = k    (ideal, k ≤ 1 for step-down)',
  },
  {
    id: 'currents',
    title: '3 · Currents: the common section carries the difference',
    text: 'The supply current I1 flows in at H1 through the series section to the tap. There it meets the load current I2 leaving to the load. By Kirchhoff’s current law the common section carries the difference I2 − I1 — and it flows the other way round the core. The ampere-turns balance: (N1 − N2)·I1 = N2·(I2 − I1). With V2 close to V1 this difference is small, so the common section can be thin.',
    focus: ['winding-common', 'winding-series', 'tap', 'terminals'],
    layers: ['current'],
    rotate: true,
    equation: 'I1 = k · I2    Ic = I2 − I1 = (1 − k)·I2',
  },
  {
    id: 'power',
    title: '4 · Part of the power conducted, part transformed',
    text: 'The output power S = V2·I2 arrives by two routes. The current I1 flows straight through the copper from the input to the tap: that part, S·V2/V1, is conducted. Only the rest, S·(1 − V2/V1), passes magnetically from the series section through the core into the common section — the transformed power. The core and windings need to be sized only for the transformed part.',
    focus: ['winding-series', 'winding-common', 'core-e'],
    layers: ['energy'],
    rotate: true,
    equation: 'S_transformed = S · (1 − V2/V1)    S_conducted = S · V2/V1',
    detail: 'Check: (V1 − V2)·I1 = V2·(I2 − I1) = S·(1 − k). A 230 V → 200 V autotransformer transforms only 13 % of its throughput.',
  },
  {
    id: 'saving',
    title: '5 · Why use one: less copper, less iron, higher efficiency',
    text: 'For the same throughput an autotransformer needs less copper — about (1 − V2/V1) of a two-winding transformer — and a smaller core, so it is lighter, cheaper and has lower losses. The saving is large when V1 and V2 are close (e.g. 400 kV / 220 kV grid interconnection, or 230 V ± 10 % correction) and vanishes as the ratio grows.',
    focus: ['winding-series', 'winding-common'],
    layers: ['current'],
    rotate: true,
    equation: 'copper(auto) / copper(two-winding) ≈ 1 − V2/V1',
  },
  {
    id: 'limits',
    title: '6 · Limits: no isolation',
    text: 'Input and output are electrically connected through the common section. If the common section opens, or the neutral is lost, the full input voltage can appear at the output; a fault on the high side reaches the low side directly. The low series impedance also means higher fault currents. So an autotransformer is not used where isolation is required, nor for large ratios (e.g. 230 V to 12 V).',
    focus: ['terminals', 'tap', 'winding-common'],
    layers: [],
    detail: 'Large grid autotransformers often carry a delta tertiary winding to provide a path for third-harmonic and zero-sequence currents.',
  },
]

export const AT_PARAMS: MachineParam[] = [
  { id: 'v1', label: 'Input voltage V1 (rms)', unit: 'V', min: 12, max: 400, step: 1, value: 230 },
  { id: 'n2', label: 'Tap position N2 (turns from N)', unit: '', min: 10, max: 2000, step: 5, value: 300 },
  { id: 'rl', label: 'Load resistance RL', unit: 'Ω', min: 0.5, max: 200, step: 0.1, value: 10 },
  { id: 'n1', label: 'Total turns N1', unit: '', min: 50, max: 2000, step: 10, value: 400, level: 'standard' },
]

/** Tap fraction k for the model (clamped to the winding). */
export const tapFraction = (p: Record<string, number>) => Math.max(0.05, Math.min(1, (p.n2 ?? 300) / (p.n1 ?? 400)))

export function atCalc(p: Record<string, number>): CalcResult[] {
  const r = autotransformer({ v1: p.v1, n1: p.n1, n2: p.n2, rl: p.rl })
  const off = 'The tap must be on the winding: N2 ≤ N1.'
  return [
    { id: 'k', label: 'Ratio k = V2/V1', value: r?.k ?? null, unit: '', formula: 'k = N2 / N1', note: r ? undefined : off },
    { id: 'v2', label: 'Output voltage V2', value: r?.v2 ?? null, unit: 'V', formula: 'V2 = V1 · N2 / N1' },
    { id: 'i2', label: 'Load current I2', value: r?.i2 ?? null, unit: 'A', formula: 'I2 = V2 / RL' },
    { id: 'i1', label: 'Input current I1 (series section)', value: r?.i1 ?? null, unit: 'A', formula: 'I1 = k · I2' },
    { id: 'ic', label: 'Common-section current', value: r?.ic ?? null, unit: 'A', formula: 'Ic = I2 − I1', note: 'Flows the opposite way round the core to I1.' },
    { id: 's', label: 'Throughput S', value: r?.s ?? null, unit: 'VA', formula: 'S = V2 · I2 = V1 · I1' },
    { id: 'st', label: 'Transformed power', value: r?.sTransformed ?? null, unit: 'VA', formula: 'S_t = S · (1 − V2/V1)' },
    { id: 'sc', label: 'Conducted power', value: r?.sConducted ?? null, unit: 'VA', formula: 'S_c = S · V2/V1' },
    { id: 'share', label: 'Share transformed', value: r ? 1 - r.k : null, unit: '%', formula: '1 − V2/V1' },
    { id: 'cu', label: 'Copper vs a two-winding transformer', value: r?.copperRatio ?? null, unit: '%', formula: '≈ 1 − V2/V1', note: 'Same current density and mean turn length assumed.' },
  ]
}

export const AT_CONTENT: MachineContent = {
  overview: 'An autotransformer has a single winding with a tap: input and output share part of the winding. Part of the power goes straight through the copper; only the rest is transformed through the core — so for ratios near 1 it is smaller, cheaper and more efficient than a two-winding transformer, but it gives no isolation.',
  construction: 'Shell-type core (this model): E and I silicon-steel laminations; one winding on a bobbin on the centre limb, the flux returning through both outer limbs. The winding is brought out at three points: the input end H1, the tap X1 and the common end N. A variable autotransformer (variac) uses a toroidal core and a carbon brush that slides on bared turns as the tap.',
  principle: 'The input voltage across all N1 turns sets the core flux; each turn has the same EMF, so the N2 turns between the common terminal and the tap give V2 = V1·N2/N1. The load current leaves at the tap; the input current flows in the series section; the common section carries their difference. Ampere-turns balance: (N1 − N2)·I1 = N2·(I2 − I1).',
  equations: [
    { expr: 'V2 / V1 = N2 / N1 = k', meaning: 'Voltage ratio from the tap position (ideal).' },
    { expr: 'I1 = k · I2,   Ic = I2 − I1', meaning: 'Input current and the current in the common section (KCL at the tap).' },
    { expr: '(N1 − N2) · I1 = N2 · Ic', meaning: 'Ampere-turn balance of the two sections.' },
    { expr: 'S_t = S · (1 − V2/V1)', meaning: 'Power transformed through the core.' },
    { expr: 'S_c = S · V2/V1', meaning: 'Power conducted directly through the copper.' },
    { expr: 'Cu(auto) / Cu(2-winding) ≈ 1 − k', meaning: 'Copper saving for the same throughput.' },
  ],
  assumptions: ['Ideal: no resistance, leakage, magnetising current or core loss.', 'Step-down connection (input across the whole winding, output from the tap), k = N2/N1 ≤ 1.', 'Sinusoidal supply; resistive load.', 'The copper comparison assumes the same current density and mean turn length.'],
  characteristics: ['Output voltage proportional to the tap position.', 'The common section carries a small current when k is close to 1.', 'Lower leakage impedance than an equivalent two-winding transformer: better regulation, higher fault current.'],
  losses: ['Copper loss in the series section (I1²·Rs) and the common section (Ic²·Rc).', 'Core loss (hysteresis + eddy), sized for the transformed power only.'],
  advantages: ['Less copper and iron for the same throughput, especially for ratios near 1.', 'Higher efficiency and better voltage regulation.', 'Continuously variable output possible (variac).'],
  limitations: ['No galvanic isolation between input and output.', 'An open common section puts the full input voltage on the output.', 'Higher short-circuit current (low impedance).', 'The saving disappears for large ratios.'],
  applications: ['Grid interconnection (e.g. 400/220 kV)', 'Reduced-voltage starting of induction motors', 'Variacs for lab supplies', 'Voltage boosters and stabilisers', 'Railway (2×25 kV) feeding'],
  misconceptions: [
    'An autotransformer is not a resistive voltage divider: it wastes almost no power and can deliver a large output current.',
    'Not all of the power passes through the core: only the fraction (1 − V2/V1).',
    'The common section does not carry the full load current — only I2 − I1.',
  ],
  sources: ['Standard textbook relations (e.g. Chapman, Electric Machinery Fundamentals; Theraja, Electrical Technology).'],
}

export const AT_QUIZ: QuizItem[] = [
  { id: 'id-tap', kind: 'identify', prompt: 'What is the highlighted part?', part: 'tap', options: ['Tap lead and output terminal', 'Input terminal', 'Bobbin', 'I laminations'], answer: 0, explain: 'The tap: a lead taken from a turn part-way along the winding; the output voltage is between it and the common terminal.' },
  { id: 'id-common', kind: 'identify', prompt: 'What is the highlighted part?', part: 'winding-common', options: ['Series section', 'Common section', 'A separate secondary winding', 'Outer limb'], answer: 1, explain: 'The common section, between the common terminal and the tap: shared by input and output, it carries I2 − I1.', misconceptions: { 2: 'An autotransformer has no separate secondary: input and output share this section.' } },
  { id: 'predict-split', kind: 'predict', prompt: 'You move the tap so that V2 = 0.9·V1 (same load power). What fraction of the power is transformed through the core?', options: ['10 %', '90 %', '100 %'], answer: 0, explain: 'S_t = S·(1 − V2/V1) = 0.1·S. The other 90 % is conducted directly.', misconceptions: { 2: 'That would be a two-winding transformer: there all power is transformed.' } },
  { id: 'predict-common', kind: 'predict', prompt: 'With k = 0.75 and I2 = 20 A, what current flows in the common section?', options: ['5 A', '15 A', '20 A'], answer: 0, explain: 'I1 = k·I2 = 15 A; the common section carries I2 − I1 = 5 A.', misconceptions: { 1: '15 A is the input current I1 in the series section.' } },
  { id: 'order', kind: 'order', prompt: 'Follow the input current to the load (step-down).', options: ['Into terminal H1', 'Through the series section', 'To the tap X1, joined by the common-section current', 'Out to the load', 'Back to the common terminal N'], answer: 0, explain: 'H1 → series section → tap (where the common-section current I2 − I1 joins) → load → common terminal.' },
  { id: 'match-iso', kind: 'match', prompt: 'Which statement is true of an autotransformer?', options: ['Input and output are not isolated', 'It must be used for large ratios like 230 V → 12 V', 'All of the power passes through the core'], answer: 0, explain: 'One winding is shared: there is no galvanic isolation. It pays off for ratios near 1, where most power is conducted.' },
]
