import { shuntMotor } from '../../calculations/dcMachines.ts'
import type { CalcResult, MachineContent, MachineDef, MachineParam, MachineStep, ModelState, QuizItem } from '../../types.ts'
import { WoundFieldModel } from './Model.tsx'
import { dcLayers, dcManifest, dcParts, LINEAR_ASSUMPTIONS, motionFromRpm, row } from './shared.ts'

/* Shunt DC motor — field in parallel with the armature on one supply. */

const STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The yoke carries two laminated main poles with pole shoes; on each a shunt field coil of many turns of fine wire (high resistance, small current). Inside turns the armature with its commutator and two brushes. The terminal box has four studs: E1–E2 for the shunt field and A1–A2 for the armature.',
    focus: ['pole-n', 'pole-s', 'field-coils', 'armature-winding', 'commutator', 'brushes', 'terminal-box'],
    layers: [],
  },
  {
    id: 'connection',
    title: '2 · The shunt connection',
    text: 'Two links in the terminal box join E1 to A1 and A2 to E2: the field winding is in parallel (in "shunt") with the armature, and both sit across the one supply V. The line current divides at the terminals: a small field current If through the coils and the armature current Ia through the brushes.',
    focus: ['terminal-box', 'field-coils', 'brushes'],
    layers: ['current'],
    equation: 'If = V / Rf    IL = Ia + If',
  },
  {
    id: 'field',
    title: '3 · A constant field',
    text: 'The field coils see the full supply voltage whatever the load, so If and the flux stay constant while V is constant. The current circulates round the coils so that the right pole is N; the flux crosses the armature and returns through the yoke. A field rheostat in series with the coils lowers If to weaken the field.',
    focus: ['field-coils', 'pole-n', 'pole-s'],
    layers: ['field', 'current'],
    equation: 'kΦ = kf · V / Rf',
  },
  {
    id: 'torque',
    title: '4 · Torque proportional to armature current',
    text: 'Armature current under the N pole flows out of the screen (⊙), under the S pole into it (⊗); each conductor feels F = B·I·L and the armature turns clockwise. With constant flux, the torque is simply proportional to Ia — the load decides the current.',
    focus: ['armature-winding', 'commutator'],
    layers: ['field', 'current', 'torque'],
    equation: 'T = kΦ · Ia',
  },
  {
    id: 'speed',
    title: '5 · Nearly constant speed',
    text: 'The turning armature generates a back EMF E = kΦ·ω against V. As the load rises, Ia rises, the drop Ia·Ra grows a little, E falls a little, and so does the speed — typically only a few per cent from no load to full load. That is why the shunt motor is called a constant-speed motor.',
    focus: ['armature-winding'],
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'ω = (V − Ia·Ra) / kΦ',
    detail: 'Speed regulation (n0 − n)/n ≈ Ia·Ra/E. Armature reaction weakens the flux slightly under load, which in practice partly cancels the Ia·Ra drop.',
  },
  {
    id: 'starting',
    title: '6 · Starting, and why the field must never open',
    text: 'At standstill there is no back EMF: Ia = V/Ra would be many times the rated current. A starter puts resistance in the armature circuit until the speed — and E — builds up, while keeping full voltage on the field so the flux is there from the start. If the field circuit opens while running, the flux drops to its residual value and the motor can race.',
    focus: ['field-coils', 'brushes', 'terminal-box'],
    layers: ['current'],
    equation: 'Ia(start) = V / (Ra + Rstart)',
  },
  {
    id: 'energy',
    title: '7 · Energy conversion',
    text: 'The supply delivers V·IL = V·Ia + V·If. The field part V·If = If²·Rf is all heat. Of the armature part, E·Ia becomes shaft power T·ω and Ia²·Ra heats the winding.',
    focus: ['shaft', 'armature-winding', 'field-coils'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'V·IL = T·ω + Ia²·Ra + V·If',
  },
]

const PARAMS: MachineParam[] = [
  { id: 'v', label: 'Supply voltage V', unit: 'V', min: 50, max: 250, step: 5, value: 220 },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 40, step: 0.5, value: 10 },
  { id: 'rf', label: 'Field circuit resistance Rf (with rheostat)', unit: 'Ω', min: 100, max: 500, step: 5, value: 220 },
  { id: 'kf', label: 'Field constant kf (kΦ per ampere of If)', unit: 'V·s/rad/A', min: 0.5, max: 2, step: 0.05, value: 1.3, level: 'standard' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.1, max: 2, step: 0.05, value: 0.5, level: 'standard' },
]

function calc(p: Record<string, number>): CalcResult[] {
  const r = shuntMotor({ v: p.v, rf: p.rf, kf: p.kf, ra: p.ra, tl: p.tl })
  if (!r) return []
  const reg = r.n !== null && r.n > 0 && r.n0 !== null ? (r.n0 - r.n) / r.n : null
  return [
    row('if', 'Field current If', r.iField, 'A', 'If = V / Rf'),
    row('kphi', 'Flux constant kΦ', r.kphi, 'V·s/rad', 'kΦ = kf · If (linear magnetics)'),
    row('ia', 'Armature current Ia', r.ia, 'A', r.mode === 'stalled' ? 'Ia = V / Ra (stalled: E = 0)' : 'Ia = TL / kΦ'),
    row('il', 'Line current IL', r.iLine, 'A', 'IL = Ia + If'),
    row('e', 'Back EMF E', r.e, 'V', 'E = V − Ia·Ra'),
    row('n', 'Speed n', r.n, 'rpm', 'ω = E / kΦ,  n = 60·ω / 2π', r.warning),
    row('n0', 'No-load speed', r.n0, 'rpm', 'ω0 = V / kΦ = Rf / kf'),
    row('reg', 'Speed regulation', reg, '%', '(n0 − n) / n'),
    row('ts', 'Stall torque (no starter)', r.stallTorque, 'N·m', 'Ts = kΦ · V / Ra'),
    row('pin', 'Electrical input', r.pin, 'W', 'Pin = V · IL'),
    row('pout', 'Mechanical output', r.pout, 'W', 'Pout = TL · ω = E · Ia'),
    row('pcu', 'Armature copper loss', r.pcuA, 'W', 'Pcu = Ia² · Ra'),
    row('pf', 'Field loss', r.pField, 'W', 'Pf = V · If = If² · Rf'),
    row('eff', 'Efficiency (this ideal model)', r.eff, '%', 'η = Pout / Pin', 'Brush, friction and iron losses are not in this model.'),
  ]
}

const CONTENT: MachineContent = {
  overview: 'A shunt DC motor has its field winding connected in parallel with the armature across one supply. The flux is therefore constant at constant voltage, and the motor runs at a nearly constant speed from no load to full load, with torque proportional to armature current.',
  construction: 'Yoke with two laminated main poles and pole shoes; shunt field coils of many fine turns (terminals E1–E2). Laminated slotted armature with a commutator; brushes to A1–A2. Terminal-box links E1–A1 and A2–E2 make the parallel connection; a field rheostat is often added in the field circuit.',
  principle: 'The field across the supply sets a constant flux. The armature current in the flux gives torque; rotation induces a back EMF that nearly balances the supply, so the speed changes only by the small Ia·Ra drop as the load varies.',
  equations: [
    { expr: 'If = V / Rf,  IL = Ia + If', meaning: 'The line current splits into field and armature currents.' },
    { expr: 'kΦ = kf · If', meaning: 'Constant flux at constant V (unsaturated).' },
    { expr: 'T = kΦ · Ia', meaning: 'Torque proportional to armature current.' },
    { expr: 'V = E + Ia · Ra,  E = kΦ · ω', meaning: 'Armature circuit and back EMF.' },
    { expr: 'ω = (V − Ia·Ra) / kΦ', meaning: 'Speed: falls only slightly with load.' },
    { expr: 'V·IL = T·ω + Ia²·Ra + If²·Rf', meaning: 'Power balance.' },
  ],
  assumptions: [...LINEAR_ASSUMPTIONS, 'Constant supply voltage; no starter resistance in the running condition.'],
  characteristics: ['Speed nearly constant: a few per cent drop from no load to full load.', 'Torque proportional to armature current (straight line through the origin).', 'Speed raised by weakening the field (field rheostat), lowered by armature resistance or voltage.', 'A definite no-load speed: safe to run unloaded.'],
  losses: ['Armature copper loss Ia²·Ra.', 'Shunt field loss V·If (constant).', 'Brush drop and friction.', 'Iron loss, bearing friction and windage (nearly constant at constant speed).'],
  advantages: ['Good speed regulation without feedback.', 'Simple speed adjustment above base speed by a field rheostat.', 'Safe at no load.'],
  limitations: ['Modest starting torque per ampere compared to a series motor.', 'Needs a starter (current limit) on a fixed-voltage supply.', 'Dangerous if the field circuit opens while running.', 'Commutator and brush maintenance.'],
  applications: ['Lathes and machine tools', 'Fans, blowers and centrifugal pumps', 'Conveyors', 'Line shafts and drives needing nearly constant speed'],
  misconceptions: [
    '"Constant speed" does not mean the speed is regulated: it still drops a little with load; only a closed loop holds it exactly.',
    'Adding resistance in the FIELD circuit raises the speed; adding it in the ARMATURE circuit lowers it.',
    'The field current does not change with load in a shunt motor (at constant V) — only the armature current does.',
  ],
  sources: ['Standard textbook relations for DC machines (Chapman; Fitzgerald & Kingsley; B. L. Theraja, Electrical Technology Vol. II). Terminal markings per IEC 60034-8.'],
}

const QUIZ: QuizItem[] = [
  { id: 'id-shunt', kind: 'identify', prompt: 'What is the highlighted part?', part: 'field-coils', options: ['Shunt field coils', 'Series field coils', 'Armature winding', 'Interpoles'], answer: 0, explain: 'The shunt field coils: many turns of fine wire, connected across the supply in parallel with the armature.', misconceptions: { 1: 'Series coils are a few turns of thick strip carrying the full armature current.' } },
  { id: 'id-tb', kind: 'identify', prompt: 'Where are the links that make this a shunt motor?', part: 'terminal-box', options: ['In the terminal box', 'On the commutator', 'In the brush holders', 'In the yoke'], answer: 0, explain: 'Links E1–A1 and A2–E2 in the terminal box put the field in parallel with the armature.' },
  { id: 'predict-load', kind: 'predict', prompt: 'The load torque doubles. What happens to the speed of a shunt motor?', options: ['It falls slightly', 'It halves', 'It stays exactly the same'], answer: 0, explain: 'Ia doubles, the Ia·Ra drop doubles, E and the speed fall slightly — a few per cent.', misconceptions: { 2: 'Nearly constant, not exactly constant: the speed must fall a little so that more current can flow.' } },
  { id: 'predict-rheo', kind: 'predict', prompt: 'You increase the field rheostat resistance (smaller If). The speed…', options: ['rises', 'falls', 'stays the same'], answer: 0, explain: 'Less field current → less flux → higher speed for the same back EMF (field weakening).' },
  { id: 'predict-if', kind: 'predict', prompt: 'The load increases at constant supply voltage. The field current…', options: ['stays the same', 'rises with the load', 'falls with the load'], answer: 0, explain: 'If = V/Rf depends only on the supply voltage and the field resistance, not on the load.' },
  { id: 'order-flow', kind: 'order', prompt: 'Follow the line current through a shunt motor.', options: ['Supply + to the terminal box', 'Splits at A1/E1 into Ia and If', 'Ia through the brushes and armature; If through the field coils', 'Both rejoin at A2/E2 and return to the supply −'], answer: 0, explain: 'The line current divides at the linked terminals: IL = Ia + If.' },
]

const def: MachineDef = {
  id: 'dc-shunt',
  manifest: dcManifest('shunt', 'Simplified educational model: two-pole shunt DC motor, 8-slot armature with full-pitch coils, 8-segment commutator, terminal box with links E1–A1 and A2–E2. Proportions are illustrative.'),
  parts: dcParts('shunt'),
  layers: dcLayers('shunt'),
  steps: STEPS,
  params: PARAMS,
  calc,
  motion: (c) => motionFromRpm(c.n ?? null, 'Stalled: the calculated speed is zero.'),
  content: CONTENT,
  quiz: QUIZ,
  Model: ({ state }: { state: ModelState }) => <WoundFieldModel state={state} kind="shunt" />,
}
export default def
