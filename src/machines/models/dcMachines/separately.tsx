import { separatelyExcitedMotor } from '../../calculations/dcMachines.ts'
import type { CalcResult, MachineContent, MachineDef, MachineParam, MachineStep, ModelState, QuizItem } from '../../types.ts'
import { WoundFieldModel } from './Model.tsx'
import { dcLayers, dcManifest, dcParts, LINEAR_ASSUMPTIONS, motionFromRpm, row } from './shared.ts'

/* Separately excited DC machine — field and armature on separate supplies; motoring, or generating when driven. */

const STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'A wound-field machine: the yoke carries two laminated main poles with pole shoes, each with a field coil of many fine turns. Inside turns the armature with its commutator; two brushes press on it. The terminal box has four studs — A1–A2 for the armature and F1–F2 for the field — and no links between them.',
    focus: ['pole-n', 'pole-s', 'field-coils', 'armature-winding', 'commutator', 'brushes', 'terminal-box'],
    layers: [],
  },
  {
    id: 'two-circuits',
    title: '2 · Two independent circuits',
    text: 'F1–F2 go to a field supply Vf, A1–A2 to an armature supply Va. Nothing connects the two circuits inside the machine except the magnetic field: the field current If and the armature current Ia are set independently. That independence is what makes this connection the reference for speed control.',
    focus: ['terminal-box', 'field-coils', 'brushes'],
    layers: ['current'],
    equation: 'If = Vf / Rf',
  },
  {
    id: 'field',
    title: '3 · The field current sets the flux',
    text: 'If circulates round the two pole coils so that the right pole is N and the left S (right-hand grip rule). The flux crosses the armature from N to S and returns through the yoke. With linear magnetics the flux — and so kΦ — is proportional to If.',
    focus: ['field-coils', 'pole-n', 'pole-s', 'yoke'],
    layers: ['field', 'current'],
    equation: 'kΦ = kf · If',
    detail: 'In reality the flux saturates: above the knee of the magnetisation curve, more If gives little more flux.',
  },
  {
    id: 'torque',
    title: '4 · Torque from the armature current',
    text: 'The armature supply drives Ia in at A1 and the + brush, through the coils and out at A2. Conductors under N carry it out of the screen (⊙), under S into the screen (⊗): each feels F = B·I·L, and both sets turn the armature clockwise. The commutator keeps this pattern fixed relative to the poles.',
    focus: ['armature-winding', 'commutator', 'brushes'],
    layers: ['field', 'current', 'torque'],
    equation: 'T = kΦ · Ia',
  },
  {
    id: 'speed',
    title: '5 · Back EMF and the two speed controls',
    text: 'Turning, the conductors generate a back EMF E = kΦ·ω that opposes Va. In steady state Va = E + Ia·Ra, so the speed is ω = (Va − Ia·Ra)/kΦ. Two independent knobs: the armature voltage Va moves the speed up to base speed with full flux, and lowering If (field weakening) raises the speed above it — at the cost of more current for the same torque.',
    focus: ['armature-winding', 'field-coils'],
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'ω = (Va − Ia·Ra) / (kf · If)',
    detail: 'Never open the field circuit of a running motor: the flux collapses to its residual value, the back EMF vanishes, the armature current surges and the speed can race. Field-loss relays trip the drive.',
  },
  {
    id: 'generating',
    title: '6 · Driven from the shaft, it generates',
    text: 'If the load drives the shaft (a negative load torque in the Calculate tab, e.g. a hoist lowering or a vehicle braking), the speed rises above no-load speed, E becomes larger than Va, and the armature current reverses: ⊗ under N. The force on the conductors now opposes the rotation and power flows back into the armature supply. Nothing in the machine changes — the same machine is a generator.',
    focus: ['armature-winding', 'brushes'],
    layers: ['current', 'emf', 'rotation'],
    rotate: true,
    equation: 'Ia = (Va − E) / Ra < 0  when  E > Va',
  },
  {
    id: 'energy',
    title: '7 · Energy conversion',
    text: 'Motoring: the armature takes Va·Ia, converts E·Ia = T·ω to shaft power and loses Ia²·Ra as heat; the field supply adds Vf·If = If²·Rf, all heat. Generating, the armature flow reverses: shaft power in, electrical power back to the supply.',
    focus: ['shaft', 'armature-winding', 'field-coils'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'Va·Ia = E·Ia + Ia²·Ra    Pf = If²·Rf',
  },
]

const PARAMS: MachineParam[] = [
  { id: 'va', label: 'Armature voltage Va', unit: 'V', min: 20, max: 250, step: 5, value: 220 },
  { id: 'tl', label: 'Load torque TL (negative = shaft driven)', unit: 'N·m', min: -20, max: 40, step: 0.5, value: 10 },
  { id: 'vf', label: 'Field voltage Vf', unit: 'V', min: 0, max: 220, step: 5, value: 220 },
  { id: 'rf', label: 'Field resistance Rf', unit: 'Ω', min: 100, max: 400, step: 5, value: 220, level: 'standard' },
  { id: 'kf', label: 'Field constant kf (kΦ per ampere of If)', unit: 'V·s/rad/A', min: 0.5, max: 2, step: 0.05, value: 1.3, level: 'standard' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.1, max: 2, step: 0.05, value: 0.5, level: 'standard' },
]

function calc(p: Record<string, number>): CalcResult[] {
  const r = separatelyExcitedMotor({ va: p.va, vf: p.vf, rf: p.rf, kf: p.kf, ra: p.ra, tl: p.tl })
  if (!r) return []
  const pa = r.ia === null ? null : p.va * r.ia
  return [
    row('if', 'Field current If', r.iField, 'A', 'If = Vf / Rf'),
    row('kphi', 'Flux constant kΦ', r.kphi, 'V·s/rad', 'kΦ = kf · If (linear magnetics)'),
    row('ia', 'Armature current Ia', r.ia, 'A', r.mode === 'stalled' ? 'Ia = Va / Ra (stalled: E = 0)' : 'Ia = TL / kΦ', r.mode === 'generating' ? 'Negative: the current flows back into the armature supply.' : undefined),
    row('il', 'Armature supply current', r.iLine, 'A', 'I = Ia (the field has its own supply)'),
    row('e', 'Back EMF E', r.e, 'V', 'E = Va − Ia·Ra'),
    row('n', 'Speed n', r.n, 'rpm', 'ω = E / kΦ,  n = 60·ω / 2π', r.warning),
    row('n0', 'No-load speed', r.n0, 'rpm', 'ω0 = Va / kΦ'),
    row('ts', 'Stall torque', r.stallTorque, 'N·m', 'Ts = kΦ · Va / Ra'),
    row('pa', 'Armature input', pa, 'W', 'Pa = Va · Ia (negative: returned to the supply)'),
    row('pf', 'Field input (loss)', r.pField, 'W', 'Pf = Vf · If = If² · Rf'),
    row('pout', 'Shaft power', r.pout, 'W', 'P = TL · ω = E · Ia'),
    row('pcu', 'Armature copper loss', r.pcuA, 'W', 'Pcu = Ia² · Ra'),
    row('eff', 'Efficiency (this ideal model)', r.eff, '%', r.mode === 'generating' ? 'η = |Va·Ia| / (|TL·ω| + Pf)' : 'η = TL·ω / (Va·Ia + Vf·If)', 'Brush, friction and iron losses are not in this model.'),
  ]
}

const CONTENT: MachineContent = {
  overview: 'A separately excited DC machine has its field winding fed from its own supply, independent of the armature. Field current (flux) and armature current (torque) can be set separately — the classic controlled DC drive. The same machine motors or generates depending on whether the shaft is driven by it or drives it.',
  construction: 'Yoke with two laminated main poles and pole shoes; a field coil of many fine turns on each, the two in series, brought out to F1–F2. Laminated slotted armature with copper coils and a commutator; carbon brushes on the neutral axis to A1–A2. Four studs in the terminal box, no links.',
  principle: 'The field current magnetises the poles. Armature current in the flux gives torque (F = B·I·L); rotation induces a back EMF that balances the applied voltage. Speed follows Va / kΦ, so it rises with armature voltage and with field weakening. If the shaft is driven above no-load speed, E exceeds Va and the machine generates.',
  equations: [
    { expr: 'If = Vf / Rf,  kΦ = kf · If', meaning: 'The separate field supply sets the flux (unsaturated).' },
    { expr: 'T = kΦ · Ia', meaning: 'Torque from flux and armature current.' },
    { expr: 'E = kΦ · ω', meaning: 'Back EMF from flux and speed.' },
    { expr: 'Va = E + Ia · Ra', meaning: 'Armature circuit (motor convention: Ia < 0 means generating).' },
    { expr: 'ω = (Va − Ia·Ra) / kΦ', meaning: 'Steady-state speed.' },
    { expr: 'Va·Ia + Vf·If = T·ω + Ia²·Ra + If²·Rf', meaning: 'Power balance (all supplies).' },
  ],
  assumptions: [...LINEAR_ASSUMPTIONS, 'The load torque is the only mechanical torque; a negative value means the load drives the shaft.'],
  characteristics: [
    'With constant If: speed falls slightly and linearly with torque, like a PM motor.',
    'Speed proportional to Va at a given load (armature-voltage control, constant-torque region).',
    'Lowering If raises the speed (field weakening, constant-power region) but needs more Ia for the same torque.',
    'Driven above no-load speed it regenerates: Ia reverses, power returns to the supply.',
  ],
  losses: ['Armature copper loss Ia²·Ra.', 'Field loss If²·Rf (in the field supply).', 'Brush drop and friction.', 'Iron loss, bearing friction and windage.'],
  advantages: ['Independent, precise control of torque and speed.', 'Wide speed range: armature voltage below base speed, field weakening above.', 'Regenerative braking with a suitable converter.'],
  limitations: ['Needs two supplies (or a two-channel converter).', 'Field loss is dangerous and must be protected.', 'Commutator and brush maintenance.'],
  applications: ['Ward–Leonard and thyristor/chopper DC drives', 'Rolling mills, paper machines, hoists', 'Test benches (dynamometers)', 'Laboratory machine sets'],
  misconceptions: [
    'Weakening the field does not slow the motor — it speeds it up: less flux needs more speed to produce the same back EMF.',
    'A motor and a generator are not different machines: the sign of the armature current decides which it is.',
    'Field current is small compared to armature current, but it is not optional: without it there is no torque.',
  ],
  sources: ['Standard textbook relations for DC machines (Chapman; Fitzgerald & Kingsley; Sen, Principles of Electric Machines and Power Electronics). Terminal markings per IEC 60034-8.'],
}

const QUIZ: QuizItem[] = [
  { id: 'id-tb', kind: 'identify', prompt: 'Where is it decided that this machine is separately excited?', part: 'terminal-box', options: ['Terminal box', 'Commutator', 'Yoke', 'Pole shoe'], answer: 0, explain: 'In the terminal box: F1–F2 go to their own supply and A1–A2 to another, with no links between them.' },
  { id: 'id-coils', kind: 'identify', prompt: 'What is the highlighted part?', part: 'field-coils', options: ['Field coils', 'Armature winding', 'Series field', 'Brushes'], answer: 0, explain: 'The field coils, many turns of fine wire round each pole core, fed through F1–F2.' },
  { id: 'predict-fw', kind: 'predict', prompt: 'At the same load torque you reduce the field current. The speed…', options: ['rises', 'falls', 'stays the same'], answer: 0, explain: 'Less flux → the armature must turn faster to generate nearly the same back EMF (ω ≈ Va/kΦ). The current also rises, since Ia = T/kΦ.', misconceptions: { 1: 'Intuition says "weaker field, weaker motor, slower" — but the speed is set by the back-EMF balance, not by the field strength directly.' } },
  { id: 'predict-regen', kind: 'predict', prompt: 'A hoist lowers its load and drives the shaft faster than the no-load speed. The armature current…', options: ['reverses: the machine returns power', 'rises in the motoring direction', 'becomes zero'], answer: 0, explain: 'Above no-load speed E > Va, so Ia = (Va − E)/Ra < 0: the machine generates — regenerative braking.' },
  { id: 'order-ctrl', kind: 'order', prompt: 'To bring the motor from standstill to above base speed, in order:', options: ['Apply full field current', 'Raise the armature voltage from zero', 'Reach base speed at full armature voltage', 'Reduce the field current to go faster'], answer: 0, explain: 'Field first (flux for torque), then armature voltage up to base speed, then field weakening above it.' },
  { id: 'match-speed', kind: 'match', prompt: 'Which relation gives the steady-state speed?', options: ['ω = (Va − Ia·Ra) / kΦ', 'ω = Va / (Ia·Ra)', 'ω = T / kΦ'], answer: 0, explain: 'From Va = E + Ia·Ra and E = kΦ·ω.' },
]

const def: MachineDef = {
  id: 'dc-separately',
  manifest: dcManifest('separate', 'Simplified educational model: two-pole wound-field DC machine with a separately excited field, 8-slot armature with full-pitch coils, 8-segment commutator, terminal box with A1–A2 and F1–F2. Proportions are illustrative.'),
  parts: dcParts('separate'),
  layers: dcLayers('separate'),
  steps: STEPS,
  params: PARAMS,
  calc,
  motion: (_c, p) => {
    const r = separatelyExcitedMotor({ va: p.va, vf: p.vf, rf: p.rf, kf: p.kf, ra: p.ra, tl: p.tl })
    return motionFromRpm(r?.n ?? null, r?.mode === 'no-field' ? 'No field: this model gives no speed (see the warning in the results).' : 'Stalled: the calculated speed is zero.')
  },
  content: CONTENT,
  quiz: QUIZ,
  Model: ({ state }: { state: ModelState }) => <WoundFieldModel state={state} kind="separate" />,
}
export default def
