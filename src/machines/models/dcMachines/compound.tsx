import { compoundMotor } from '../../calculations/dcMachines.ts'
import type { CalcResult, MachineContent, MachineDef, MachineParam, MachineStep, ModelState, QuizItem } from '../../types.ts'
import { WoundFieldModel } from './Model.tsx'
import { dcLayers, dcManifest, dcParts, LINEAR_ASSUMPTIONS, motionFromRpm, row } from './shared.ts'

/* Compound DC machine (motor, long shunt) — a shunt field and a series field on the same poles. */

const STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'Each main pole carries two coils: a shunt coil of many fine turns (E1–E2, outer) and, next to the pole shoe, a series coil of a few turns of thick strip (D1–D2). Inside turns the armature with commutator and brushes. The terminal box has six studs: E1–E2, A1–A2 and D1–D2.',
    focus: ['field-coils', 'series-coils', 'pole-n', 'pole-s', 'armature-winding', 'commutator', 'terminal-box'],
    layers: [],
  },
  {
    id: 'connection',
    title: '2 · The long-shunt connection',
    text: 'Links E1–A1, A2–D1 and D2–E2: the shunt field sits across the whole supply, and the series field is in series with the armature. The line current splits at the terminals into the shunt-field current If and the armature current Ia, which also flows through the series coils. (In the short-shunt variant the shunt field is across the armature only; the difference is small.)',
    focus: ['terminal-box', 'field-coils', 'series-coils'],
    layers: ['current'],
    equation: 'If = V / Rf    IL = Ia + If',
  },
  {
    id: 'fluxes',
    title: '3 · Two fields: adding or opposing',
    text: 'The shunt coils give a constant flux Φsh ∝ If; the series coils add a flux Φse ∝ Ia that follows the load. In a cumulative compound the series current circulates the same way round the poles as the shunt current, and the fluxes add. In a differential compound it circulates the other way (set "−1" in the Calculate tab and watch the dashes on the thick coil reverse) and subtracts.',
    focus: ['field-coils', 'series-coils', 'pole-n', 'pole-s'],
    layers: ['field', 'current'],
    equation: 'Φ = Φsh ± Φse    kΦ = kf·If ± ks·Ia',
  },
  {
    id: 'torque',
    title: '4 · Torque',
    text: 'The torque is flux times armature current. With the cumulative series field the flux grows with the load, so the torque per ampere is higher than in a shunt motor — a stronger start and better handling of load peaks. In a differential compound the flux shrinks with load, and the torque has a maximum beyond which the machine cannot carry the load.',
    focus: ['armature-winding', 'series-coils'],
    layers: ['field', 'current', 'torque'],
    equation: 'T = (kf·If ± ks·Ia) · Ia',
  },
  {
    id: 'speed',
    title: '5 · Speed between shunt and series',
    text: 'The back EMF E = kΦ·ω nearly balances the supply. Cumulative: as the load rises the flux rises too, so the speed falls more than in a shunt motor — but at no load the shunt flux remains, so there is a safe, definite no-load speed (unlike a series motor). Differential: the flux falls with load, so the speed stays nearly constant or even rises — which can become unstable.',
    focus: ['armature-winding', 'field-coils', 'series-coils'],
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'ω = (V − Ia·(Ra + Rse)) / (kf·If ± ks·Ia)',
    detail: 'Differential compounding is rarely used: at start the large current can make the series flux exceed the shunt flux and reverse the starting torque. As generators, cumulative compounds are made flat- or over-compounded so the terminal voltage stays up under load.',
  },
  {
    id: 'energy',
    title: '6 · Energy conversion',
    text: 'The supply delivers V·IL. The shunt field takes V·If, all heat; the armature circuit loses Ia²·(Ra + Rse) in the armature and series coils; E·Ia becomes shaft power T·ω.',
    focus: ['shaft', 'armature-winding', 'field-coils', 'series-coils'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'V·IL = T·ω + Ia²·(Ra + Rse) + V·If',
  },
]

const PARAMS: MachineParam[] = [
  { id: 'v', label: 'Supply voltage V', unit: 'V', min: 50, max: 250, step: 5, value: 220 },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 40, step: 0.5, value: 10 },
  { id: 'sense', label: 'Series field: +1 cumulative, −1 differential', unit: '', min: -1, max: 1, step: 2, value: 1, options: [1, -1] },
  { id: 'ks', label: 'Series field constant ks (kΦ per ampere of Ia)', unit: 'V·s/rad/A', min: 0, max: 0.1, step: 0.005, value: 0.03, level: 'standard' },
  { id: 'rf', label: 'Shunt field resistance Rf', unit: 'Ω', min: 100, max: 500, step: 5, value: 220, level: 'standard' },
  { id: 'kf', label: 'Shunt field constant kf (kΦ per ampere of If)', unit: 'V·s/rad/A', min: 0.5, max: 2, step: 0.05, value: 1.3, level: 'standard' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.1, max: 2, step: 0.05, value: 0.5, level: 'standard' },
  { id: 'rse', label: 'Series field resistance Rse', unit: 'Ω', min: 0.02, max: 0.5, step: 0.02, value: 0.1, level: 'standard' },
]

function calc(p: Record<string, number>): CalcResult[] {
  const args = { v: p.v, rf: p.rf, kf: p.kf, ks: p.ks, ra: p.ra, rse: p.rse, tl: p.tl, sense: p.sense }
  const r = compoundMotor(args)
  if (!r) return []
  const shuntOnly = compoundMotor({ ...args, ks: 0 })
  const kSh = p.kf * r.iField
  const kSe = r.ia === null ? null : p.ks * r.ia
  return [
    row('if', 'Shunt field current If', r.iField, 'A', 'If = V / Rf'),
    row('ia', 'Armature (and series field) current Ia', r.ia, 'A', r.mode === 'stalled' ? 'Ia = V / (Ra + Rse) (stalled)' : '±ks·Ia² + kf·If·Ia = TL', r.mode === 'no-operating-point' ? r.warning : undefined),
    row('il', 'Line current IL', r.iLine, 'A', 'IL = Ia + If'),
    row('ksh', 'Shunt part of kΦ', kSh, 'V·s/rad', 'kf · If'),
    row('kse', 'Series part of kΦ', kSe === null ? null : (p.sense < 0 ? -1 : 1) * kSe, 'V·s/rad', '± ks · Ia'),
    row('kphi', 'Total flux constant kΦ', r.kphi, 'V·s/rad', 'kΦ = kf·If ± ks·Ia (linear magnetics)'),
    row('e', 'Back EMF E', r.e, 'V', 'E = V − Ia·(Ra + Rse)'),
    row('n', 'Speed n', r.n, 'rpm', 'ω = E / kΦ,  n = 60·ω / 2π', r.mode === 'stalled' ? r.warning : undefined),
    row('nsh', 'Speed as a plain shunt motor (series field bypassed)', shuntOnly?.n ?? null, 'rpm', 'same with ks = 0', 'Compare with n: cumulative lower, differential higher.'),
    row('n0', 'No-load speed', r.n0, 'rpm', 'ω0 = V / (kf·If)  (Ia = 0: shunt flux only)'),
    row('ts', 'Stall torque (no starter)', r.stallTorque, 'N·m', 'Ts = (kf·If ± ks·Ist)·Ist,  Ist = V / (Ra + Rse)', r.stallTorque !== null && r.stallTorque < 0 ? 'Negative: a differential compound would start backwards on full voltage.' : undefined),
    row('pin', 'Electrical input', r.pin, 'W', 'Pin = V · IL'),
    row('pout', 'Mechanical output', r.pout, 'W', 'Pout = TL · ω = E · Ia'),
    row('pcu', 'Copper loss, armature + series field', r.pcuA, 'W', 'Pcu = Ia² · (Ra + Rse)'),
    row('pf', 'Shunt field loss', r.pField, 'W', 'Pf = V · If'),
    row('eff', 'Efficiency (this ideal model)', r.eff, '%', 'η = Pout / Pin', 'Brush, friction and iron losses are not in this model.'),
  ]
}

const CONTENT: MachineContent = {
  overview: 'A compound DC machine has both a shunt field and a series field on its poles. As a motor, a cumulative compound combines a good starting torque with a definite, safe no-load speed — between the shunt and the series motor. As a generator, the series field compensates the voltage drop under load.',
  construction: 'Yoke with two laminated main poles; on each, a shunt coil of many fine turns (E1–E2) and a series coil of a few turns of heavy strip (D1–D2). Laminated slotted armature with a commutator; brushes to A1–A2. Long-shunt links: E1–A1, A2–D1, D2–E2.',
  principle: 'The shunt field gives a constant base flux; the series field adds (cumulative) or subtracts (differential) a flux proportional to the armature current. Torque and back EMF follow the total flux: T = kΦ·Ia, E = kΦ·ω.',
  equations: [
    { expr: 'If = V / Rf,  IL = Ia + If', meaning: 'Long shunt: the shunt field across the supply.' },
    { expr: 'kΦ = kf·If ± ks·Ia', meaning: 'Total flux: shunt part plus or minus series part (unsaturated).' },
    { expr: 'T = kΦ · Ia', meaning: 'Torque.' },
    { expr: 'V = E + Ia·(Ra + Rse),  E = kΦ·ω', meaning: 'Armature circuit including the series field.' },
    { expr: 'Tmax(differential) = (kf·If)² / (4·ks)', meaning: 'A differential compound cannot carry more torque than this.' },
    { expr: 'V·IL = T·ω + Ia²·(Ra + Rse) + V·If', meaning: 'Power balance.' },
  ],
  assumptions: [...LINEAR_ASSUMPTIONS, 'Long-shunt connection; the two fields add linearly (no saturation); constant supply voltage.'],
  characteristics: ['Cumulative: speed falls more with load than a shunt motor, much less than a series motor; definite no-load speed.', 'Cumulative: higher torque per ampere than a shunt motor.', 'Differential: nearly constant or rising speed with load; unstable at heavy load; reversed starting torque possible.', 'Generators: under-, flat- or over-compounded depending on the series ampere-turns.'],
  losses: ['Armature and series-field copper loss Ia²·(Ra + Rse).', 'Shunt field loss V·If.', 'Brush drop and friction.', 'Iron loss, friction and windage.'],
  advantages: ['Good starting torque without the series motor’s runaway.', 'Handles load peaks (presses, shears) well, especially with a flywheel.', 'The characteristic can be shaped by the series turns.'],
  limitations: ['Two field windings: more copper, more terminals.', 'Differential connection is unstable and rarely used.', 'Commutator and brush maintenance.'],
  applications: ['Presses, shears and punches (with flywheels)', 'Elevators and hoists', 'Rolling mills and crushers', 'Compound generators for DC distribution (flat-compounded)'],
  misconceptions: [
    '"Compound" does not mean two machines: it is one machine with two field windings on the same poles.',
    'A cumulative compound is not a series motor: its shunt flux remains at no load, so it does not run away.',
    'Long and short shunt differ only in whether the shunt field sees the series-field drop; the behaviour is almost the same.',
  ],
  sources: ['Standard textbook relations for DC machines (Chapman; Fitzgerald & Kingsley; Theraja). Terminal markings per IEC 60034-8.'],
}

const QUIZ: QuizItem[] = [
  { id: 'id-series', kind: 'identify', prompt: 'What is the highlighted part?', part: 'series-coils', options: ['Series field coils', 'Shunt field coils', 'Armature winding', 'Brush holders'], answer: 0, explain: 'The series coils: a few thick turns next to the pole shoe, carrying the armature current.' },
  { id: 'id-shunt', kind: 'identify', prompt: 'What is the highlighted part?', part: 'field-coils', options: ['Shunt field coils', 'Series field coils', 'Pole cores', 'Yoke'], answer: 0, explain: 'The shunt coils: many fine turns across the supply, giving the constant part of the flux.' },
  { id: 'predict-noload', kind: 'predict', prompt: 'A cumulative compound motor loses its load. Its speed…', options: ['rises to a definite no-load speed', 'runs away like a series motor', 'falls'], answer: 0, explain: 'At no load Ia ≈ 0, the series flux vanishes, but the shunt flux remains: ω0 = V/(kf·If).', misconceptions: { 1: 'Runaway needs the whole flux to vanish with the load; here the shunt flux stays.' } },
  { id: 'predict-diff', kind: 'predict', prompt: 'Compared with a plain shunt motor at the same load, a differential compound runs…', options: ['faster', 'slower', 'at exactly the same speed'], answer: 0, explain: 'Its series field subtracts flux, so the armature must turn faster for the same back EMF.' },
  { id: 'order-sort', kind: 'order', prompt: 'Order these motors from the steepest speed drop with load to the flattest.', options: ['Series motor', 'Cumulative compound motor', 'Shunt motor', 'Differential compound motor'], answer: 0, explain: 'The more the flux grows with load, the more the speed must fall: series (all of it), cumulative (part), shunt (none), differential (it shrinks).' },
  { id: 'match-flux', kind: 'match', prompt: 'Which relation describes the flux of a compound machine?', options: ['kΦ = kf·If ± ks·Ia', 'kΦ = ks·Ia', 'kΦ = kf·If'], answer: 0, explain: 'Shunt part plus (cumulative) or minus (differential) series part.' },
]

const def: MachineDef = {
  id: 'dc-compound',
  manifest: dcManifest('compound', 'Simplified educational model: two-pole compound DC motor (long shunt), each pole with a shunt coil and a two-turn series coil, 8-slot armature, 8-segment commutator, terminal box with links E1–A1, A2–D1, D2–E2. Proportions are illustrative.'),
  parts: dcParts('compound'),
  layers: dcLayers('compound'),
  steps: STEPS,
  params: PARAMS,
  calc,
  motion: (c, p) => {
    const r = compoundMotor({ v: p.v, rf: p.rf, kf: p.kf, ks: p.ks, ra: p.ra, rse: p.rse, tl: p.tl, sense: p.sense })
    return motionFromRpm(c.n ?? null, r?.mode === 'no-operating-point' ? 'No operating point (differential compound overloaded): the rotor is shown still.' : 'Stalled: the calculated speed is zero.')
  },
  content: CONTENT,
  quiz: QUIZ,
  Model: ({ state }: { state: ModelState }) => <WoundFieldModel state={state} kind="compound" />,
}
export default def
