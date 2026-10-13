import { seriesMotor } from '../../calculations/dcMachines.ts'
import type { CalcResult, MachineContent, MachineDef, MachineParam, MachineStep, ModelState, QuizItem } from '../../types.ts'
import { WoundFieldModel } from './Model.tsx'
import { dcLayers, dcManifest, dcParts, LINEAR_ASSUMPTIONS, motionFromRpm, row } from './shared.ts'

/* Series DC motor — field in series with the armature: one current makes both the flux and the torque. */

const STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The yoke carries two laminated main poles with pole shoes. Their coils are series field coils: only a few turns of thick copper strip, because they carry the whole armature current. Inside turns the armature with its commutator and brushes. The terminal box has A1–A2 (armature) and D1–D2 (series field).',
    focus: ['pole-n', 'pole-s', 'series-coils', 'armature-winding', 'commutator', 'brushes', 'terminal-box'],
    layers: [],
  },
  {
    id: 'connection',
    title: '2 · The series connection',
    text: 'One link joins A2 to D1. The supply current enters at A1, flows through the brushes and the armature, out at A2, across the link into D1, round both series coils and out at D2 back to the supply. There is only one current: the armature current is the field current and the line current.',
    focus: ['terminal-box', 'series-coils', 'brushes'],
    layers: ['current'],
    equation: 'Ia = If = IL',
  },
  {
    id: 'field',
    title: '3 · The field follows the load',
    text: 'The flux is made by the armature current itself, circulating round the series coils so that the right pole is N. At light load the current — and the flux — are small; at heavy load both are large. With linear magnetics the flux is proportional to Ia.',
    focus: ['series-coils', 'pole-n', 'pole-s'],
    layers: ['field', 'current'],
    equation: 'kΦ = ks · Ia',
    detail: 'Saturation limits this: at high current the flux levels off, and the torque tends towards T ∝ Ia.',
  },
  {
    id: 'torque',
    title: '4 · Torque grows with current squared',
    text: 'The torque is flux times current, and here the flux is itself proportional to the current: T = ks·Ia². Doubling the current gives four times the torque (unsaturated). This gives the series motor its very high starting torque per ampere — the reason it was chosen for traction, cranes and engine starters.',
    focus: ['armature-winding', 'series-coils'],
    layers: ['field', 'current', 'torque'],
    equation: 'T = kΦ · Ia = ks · Ia²',
  },
  {
    id: 'speed',
    title: '5 · Speed falls steeply with load',
    text: 'The back EMF E = ks·Ia·ω must nearly balance the supply: V = E + Ia·(Ra + Rse). When the load falls, Ia falls, the flux falls with it, and the armature must turn much faster to generate nearly the same EMF. Speed is roughly inversely proportional to the square root of the load torque: a quarter of the load, about twice the speed.',
    focus: ['armature-winding', 'series-coils'],
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'ω = (V − Ia·(Ra + Rse)) / (ks · Ia)',
  },
  {
    id: 'runaway',
    title: '6 · Never unloaded: runaway',
    text: 'With no load, Ia and the flux fall towards zero and the speed needed to balance the supply rises without limit: in this model there is no finite no-load speed, and a real machine accelerates until friction and windage stop it — often beyond what the armature and commutator survive. A series motor is always coupled or geared to its load, never belt-driven.',
    focus: ['shaft', 'armature-winding', 'commutator'],
    layers: ['rotation'],
    rotate: true,
    equation: 'TL → 0  ⇒  Ia → 0  ⇒  ω → ∞',
  },
  {
    id: 'energy',
    title: '7 · Energy conversion',
    text: 'The supply delivers V·Ia. The copper loss is Ia²·(Ra + Rse): the same current heats both windings. The rest, E·Ia, becomes shaft power T·ω.',
    focus: ['shaft', 'armature-winding', 'series-coils'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'V·Ia = T·ω + Ia²·(Ra + Rse)',
  },
]

const PARAMS: MachineParam[] = [
  { id: 'v', label: 'Supply voltage V', unit: 'V', min: 50, max: 250, step: 5, value: 220 },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 40, step: 0.5, value: 10 },
  { id: 'ks', label: 'Series field constant ks (kΦ per ampere)', unit: 'V·s/rad/A', min: 0.02, max: 0.3, step: 0.01, value: 0.1, level: 'standard' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.1, max: 2, step: 0.05, value: 0.5, level: 'standard' },
  { id: 'rse', label: 'Series field resistance Rse', unit: 'Ω', min: 0.05, max: 1, step: 0.05, value: 0.2, level: 'standard' },
]

function calc(p: Record<string, number>): CalcResult[] {
  const args = { v: p.v, ks: p.ks, ra: p.ra, rse: p.rse }
  const r = seriesMotor({ ...args, tl: p.tl })
  if (!r) return []
  const half = p.tl > 0 ? seriesMotor({ ...args, tl: p.tl / 2 }) : null
  const dbl = p.tl > 0 ? seriesMotor({ ...args, tl: p.tl * 2 }) : null
  return [
    row('ia', 'Current Ia = If = IL', r.ia, 'A', r.mode === 'stalled' ? 'Ia = V / (Ra + Rse) (stalled)' : 'Ia = √(TL / ks)'),
    row('if', 'Field current If', r.iField, 'A', 'If = Ia (series)'),
    row('il', 'Line current IL', r.iLine, 'A', 'IL = Ia (series)'),
    row('kphi', 'Flux constant kΦ', r.kphi, 'V·s/rad', 'kΦ = ks · Ia (linear magnetics)'),
    row('e', 'Back EMF E', r.e, 'V', 'E = V − Ia·(Ra + Rse)'),
    row('n', 'Speed n', r.n, 'rpm', 'ω = E / (ks·Ia),  n = 60·ω / 2π', r.warning ?? 'Never run a series motor without load: as TL → 0 the speed rises without limit.'),
    row('nhalf', 'Speed at half this load', half?.n ?? null, 'rpm', 'same relations at TL/2', 'Compare: the speed rises steeply as the load falls.'),
    row('ndouble', 'Speed at double this load', dbl?.n ?? null, 'rpm', 'same relations at 2·TL'),
    row('ts', 'Stall torque (no starter)', r.stallTorque, 'N·m', 'Ts = ks · (V / (Ra + Rse))²'),
    row('pin', 'Electrical input', r.pin, 'W', 'Pin = V · Ia'),
    row('pout', 'Mechanical output', r.pout, 'W', 'Pout = TL · ω = E · Ia'),
    row('pcu', 'Copper loss (armature + series field)', r.pcuA, 'W', 'Pcu = Ia² · (Ra + Rse)'),
    row('eff', 'Efficiency (this ideal model)', r.eff, '%', 'η = Pout / Pin', 'Brush, friction and iron losses are not in this model.'),
  ]
}

const CONTENT: MachineContent = {
  overview: 'A series DC motor has its field winding in series with the armature, so one current makes both the flux and the torque. Torque grows with the square of the current (unsaturated), giving a very high starting torque; the speed falls steeply as the load rises and rises without limit as the load disappears.',
  construction: 'Yoke with two laminated main poles and pole shoes; series field coils of a few turns of heavy copper strip (terminals D1–D2). Laminated slotted armature with a commutator; brushes to A1–A2. One link A2–D1 in the terminal box; the supply goes to A1 and D2.',
  principle: 'The armature current magnetises the poles, so Φ ∝ Ia and T = ks·Ia². The back EMF E = ks·Ia·ω must nearly balance the supply; at light load the small current gives a weak field, so the speed must be high.',
  equations: [
    { expr: 'Ia = If = IL', meaning: 'One current through armature and field.' },
    { expr: 'kΦ = ks · Ia', meaning: 'Flux proportional to current (unsaturated).' },
    { expr: 'T = ks · Ia²', meaning: 'Torque proportional to current squared.' },
    { expr: 'V = E + Ia·(Ra + Rse),  E = ks·Ia·ω', meaning: 'Armature circuit including the series field.' },
    { expr: 'ω = (V − Ia·(Ra + Rse)) / (ks·Ia)', meaning: 'Speed: roughly ∝ 1/√TL; unbounded as TL → 0.' },
    { expr: 'V·Ia = T·ω + Ia²·(Ra + Rse)', meaning: 'Power balance.' },
  ],
  assumptions: [...LINEAR_ASSUMPTIONS, 'Constant supply voltage. Without saturation and friction the model has no no-load speed — it reports a runaway instead of a number.'],
  characteristics: ['Torque ∝ Ia² at low current, tending to ∝ Ia when saturated.', 'Speed falls steeply with load (a "series" or traction characteristic).', 'Dangerous overspeed at light load.', 'Roughly constant power over a wide speed range — useful for traction.'],
  losses: ['Copper loss Ia²·(Ra + Rse) — both windings carry the full current.', 'Brush drop and friction.', 'Iron loss, bearing friction and windage (these limit the real no-load speed).'],
  advantages: ['Very high starting torque per ampere.', 'Speed adapts to load automatically (slows on hills, speeds up on the flat).', 'Simple, robust field winding of few turns.'],
  limitations: ['Must never run without load (runaway).', 'Poor speed regulation.', 'Commutator and brush maintenance.'],
  applications: ['Traction (trams, older locomotives, mine vehicles)', 'Cranes and hoists', 'Automotive engine starter motors', 'Universal motors (the AC version) in drills and vacuum cleaners'],
  misconceptions: [
    'A series motor does not have a no-load speed like a shunt motor: unloaded, it keeps accelerating.',
    'Its high starting torque does not come from a higher current alone: the field also grows with the current, so torque rises with current squared.',
    'The series field is not "weaker" because it has few turns: it carries the full armature current, so its ampere-turns are comparable.',
  ],
  sources: ['Standard textbook relations for DC machines (Chapman; Fitzgerald & Kingsley; Theraja). Terminal markings per IEC 60034-8.'],
}

const QUIZ: QuizItem[] = [
  { id: 'id-series', kind: 'identify', prompt: 'What is the highlighted part?', part: 'series-coils', options: ['Series field coils', 'Shunt field coils', 'Pole shoes', 'Commutator'], answer: 0, explain: 'The series field coils: a few turns of thick copper strip that carry the whole armature current.', misconceptions: { 1: 'Shunt coils have many turns of fine wire: they carry a small current at full voltage.' } },
  { id: 'predict-unload', kind: 'predict', prompt: 'The belt to the load slips off. What happens to a series motor?', options: ['It accelerates dangerously (runaway)', 'It settles at a slightly higher speed', 'It stops'], answer: 0, explain: 'With no load, Ia and the flux fall towards zero, and the speed needed to balance the supply rises without limit. That is why series motors are never belt-driven.', misconceptions: { 1: 'That is the shunt motor’s behaviour: its flux does not depend on the load.' } },
  { id: 'predict-torque', kind: 'predict', prompt: 'The current doubles (unsaturated). The torque becomes…', options: ['four times as large', 'twice as large', 'the same'], answer: 0, explain: 'T = ks·Ia²: the flux doubles with the current, so the torque quadruples.' },
  { id: 'predict-speed', kind: 'predict', prompt: 'The load torque is reduced to a quarter. Roughly, the speed…', options: ['doubles', 'rises by a few per cent', 'quadruples'], answer: 0, explain: 'Ia = √(TL/ks) halves, so the flux halves, and ω ≈ V/(ks·Ia) about doubles.' },
  { id: 'order-path', kind: 'order', prompt: 'Follow the current through a series motor.', options: ['Supply + to A1', 'Through the brushes and the armature winding', 'Out at A2, across the link to D1', 'Round the series coils to D2 and back to the supply −'], answer: 0, explain: 'One path, one current: armature and series field in series.' },
  { id: 'match-t', kind: 'match', prompt: 'Which torque relation belongs to the (unsaturated) series motor?', options: ['T = ks · Ia²', 'T = kΦ · Ia with constant Φ', 'T = V · Ia'], answer: 0, explain: 'Because Φ ∝ Ia, T = kΦ·Ia becomes ks·Ia².' },
]

const def: MachineDef = {
  id: 'dc-series',
  manifest: dcManifest('series', 'Simplified educational model: two-pole series DC motor, series field coils of four thick strip turns per pole, 8-slot armature, 8-segment commutator, terminal box with the link A2–D1. Proportions are illustrative.'),
  parts: dcParts('series'),
  layers: dcLayers('series'),
  steps: STEPS,
  params: PARAMS,
  calc,
  motion: (c, p) => {
    if (c.n === null && (p.tl ?? 0) <= 0) return { omega: -3, note: 'Runaway: this model has no finite no-load speed. The fast turning only signals the danger — it is not a calculated speed.' }
    return motionFromRpm(c.n ?? null, 'Stalled: the calculated speed is zero.')
  },
  content: CONTENT,
  quiz: QUIZ,
  Model: ({ state }: { state: ModelState }) => <WoundFieldModel state={state} kind="series" />,
}
export default def
