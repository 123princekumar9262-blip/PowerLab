import { separatelyExcitedGenerator } from '../../calculations/dcMachines.ts'
import type { CalcResult, MachineContent, MachineDef, MachineParam, MachineStep, ModelState, QuizItem } from '../../types.ts'
import { WoundFieldModel } from './Model.tsx'
import { dcLayers, dcManifest, dcParts, LINEAR_ASSUMPTIONS, motionFromRpm, row } from './shared.ts'

/* DC generator (separately excited) — driven by a prime mover, feeding a resistive load. */

const STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The frame (yoke) carries two laminated main poles with pole shoes; a field coil is wound on each. Inside turns the armature: a slotted, laminated core with copper coils joined to the commutator, and two carbon brushes on the commutator. At the back a flange coupling joins the shaft to the prime mover — the engine, turbine or motor that drives the generator.',
    focus: ['pole-n', 'pole-s', 'field-coils', 'armature-winding', 'commutator', 'brushes', 'prime-mover'],
    layers: [],
  },
  {
    id: 'excitation',
    title: '2 · Excite the field',
    text: 'A separate DC supply Vf, connected to F1–F2 in the terminal box, drives the field current If = Vf/Rf through the two pole coils. The current circulates so that the right pole becomes N and the left S. The flux leaves the N shoe, crosses the air gap and the armature, enters the S pole and returns through the yoke. With linear magnetics the flux is proportional to If.',
    focus: ['field-coils', 'pole-n', 'pole-s', 'terminal-box'],
    layers: ['field', 'current'],
    equation: 'If = Vf / Rf    kΦ = kf · If',
    detail: 'Many generators are self-excited (shunt): the residual flux of the poles induces a small EMF that drives a field current, which strengthens the flux, and so on. Build-up needs residual flux, the right field polarity and a field resistance below the critical value; the final voltage is set by saturation. A linear model cannot predict it, so this model is separately excited.',
  },
  {
    id: 'induction',
    title: '3 · Drive the armature: EMF is induced',
    text: 'The prime mover turns the armature at speed n. Each conductor moves through the flux and an EMF e = B·l·v is induced in it (v × B): under the N pole it points into the screen (⊗), under the S pole out of the screen (⊙). Added up over the conductors in series between the brushes, the EMF is proportional to the flux and the speed.',
    focus: ['armature-winding', 'prime-mover', 'shaft'],
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'E = kΦ · ω    (ω = 2π·n / 60)',
    detail: 'k = P·Z / (2π·A) for P poles, Z conductors and A parallel paths. Double the speed or double the field current (unsaturated) and E doubles.',
  },
  {
    id: 'commutation',
    title: '4 · The commutator makes it unidirectional',
    text: 'In a single coil the EMF alternates: each side passes under N, then under S, once every turn. The commutator reverses the coil’s connection to the brushes just as the coil passes the neutral zone between the poles, where its EMF is zero. So the brush A1 is always connected to whichever side is under the N pole: the voltage at the brushes keeps one direction. With many coils in series, staggered round the armature, it is nearly steady DC with a small ripple.',
    focus: ['commutator', 'brushes', 'armature-winding'],
    layers: ['emf', 'rotation'],
    rotate: true,
    detail: 'The brushes sit on the magnetic neutral axis so that commutation happens when the coil EMF is near zero; under load, armature reaction shifts that axis, which interpoles correct. The inset is a sketch of one coil, not a measured waveform.',
  },
  {
    id: 'load',
    title: '5 · Connect a load',
    text: 'A load RL on A1–A2 lets the EMF drive a current. Inside the armature it flows in the direction of the EMF (⊗ under N); it leaves at the + brush A1, flows through the load and returns at A2: IL = Ia. The armature resistance drops part of the EMF, so the terminal voltage is a little lower than E and falls as the load current rises.',
    focus: ['brushes', 'terminal-box', 'armature-winding'],
    layers: ['current', 'emf'],
    equation: 'Ia = E / (Ra + RL)    V = E − Ia·Ra = IL·RL',
  },
  {
    id: 'counter-torque',
    title: '6 · Load current means counter-torque',
    text: 'The load current flows in conductors that lie in the flux, so they feel a force F = B·I·L — and it points against the motion (Lenz’s law). The forces add up to a counter-torque T = kΦ·Ia opposing the prime mover. Switching on more load draws more current, which needs more torque from the prime mover: if it cannot supply it, the set slows down and E falls.',
    focus: ['armature-winding', 'prime-mover', 'shaft'],
    layers: ['field', 'current', 'torque', 'rotation'],
    rotate: true,
    equation: 'T = kΦ · Ia',
    detail: 'This is why a generator set needs a speed governor on its prime mover: the electrical load appears at the shaft as torque.',
  },
  {
    id: 'energy',
    title: '7 · Energy conversion',
    text: 'Mechanical power T·ω enters at the coupling. It equals E·Ia, the electrical power generated in the armature. The load receives V·IL; the difference Ia²·Ra heats the armature winding. The field supply adds If²·Rf, also lost as heat. Real machines also lose power in the brushes, bearings, windage and the iron.',
    focus: ['prime-mover', 'shaft', 'armature-winding', 'terminal-box'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'T·ω = E·Ia = V·IL + Ia²·Ra',
  },
]

const PARAMS: MachineParam[] = [
  { id: 'n', label: 'Prime mover speed n', unit: 'rpm', min: 0, max: 3000, step: 10, value: 1500 },
  { id: 'rl', label: 'Load resistance RL', unit: 'Ω', min: 2, max: 200, step: 1, value: 20 },
  { id: 'vf', label: 'Field supply Vf', unit: 'V', min: 0, max: 220, step: 5, value: 220 },
  { id: 'rf', label: 'Field resistance Rf', unit: 'Ω', min: 100, max: 400, step: 5, value: 220, level: 'standard' },
  { id: 'kf', label: 'Field constant kf (kΦ per ampere of If)', unit: 'V·s/rad/A', min: 0.5, max: 2, step: 0.05, value: 1.3, level: 'standard' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.1, max: 2, step: 0.05, value: 0.5, level: 'standard' },
]

function calc(p: Record<string, number>): CalcResult[] {
  const g = separatelyExcitedGenerator({ n: p.n, vf: p.vf, rf: p.rf, kf: p.kf, ra: p.ra, rl: p.rl })
  if (!g) return []
  const noEmf = g.e === 0 ? (g.iField === 0 ? 'No field current: in this linear model there is no flux and no EMF (a real machine keeps a small residual voltage).' : 'Not turning: no EMF.') : undefined
  return [
    row('if', 'Field current If', g.iField, 'A', 'If = Vf / Rf'),
    row('kphi', 'Flux constant kΦ', g.kphi, 'V·s/rad', 'kΦ = kf · If (linear magnetics)'),
    row('e', 'Generated EMF E (= open-circuit voltage)', g.e, 'V', 'E = kΦ · ω,  ω = 2π·n/60', noEmf),
    row('ia', 'Armature current Ia', g.ia, 'A', 'Ia = E / (Ra + RL)'),
    row('il', 'Load current IL', g.iLoad, 'A', 'IL = Ia (separately excited)'),
    row('v', 'Terminal voltage V', g.v, 'V', 'V = E − Ia·Ra = IL·RL'),
    row('reg', 'Voltage regulation', g.regulation, '%', '(E − V) / V', 'How much the voltage rises from this load to no load at the same speed and field.'),
    row('t', 'Counter-torque on the prime mover', g.torque, 'N·m', 'T = kΦ · Ia'),
    row('pmech', 'Mechanical input', g.pmech, 'W', 'Pmech = T·ω = E·Ia'),
    row('pout', 'Electrical output', g.pout, 'W', 'Pout = V · IL'),
    row('pcu', 'Armature copper loss', g.pcuA, 'W', 'Pcu = Ia² · Ra'),
    row('pf', 'Field loss (separate supply)', g.pField, 'W', 'Pf = Vf · If = If² · Rf'),
    row('eff', 'Efficiency (this ideal model)', g.eff, '%', 'η = Pout / (Pmech + Pf)', 'Brush, friction, windage and iron losses are not in this model: a real generator is less efficient.'),
  ]
}

const CONTENT: MachineContent = {
  overview: 'A DC generator turns mechanical power from a prime mover into DC electrical power. Its armature conductors are driven through a stationary magnetic field, so an EMF is induced in them; the commutator and brushes turn each coil’s alternating EMF into a voltage of one polarity at the terminals. When a load draws current, that current produces a counter-torque the prime mover must overcome.',
  construction: 'Stator: steel yoke with two laminated main poles and pole shoes; a field coil on each pole (here separately excited, terminals F1–F2). Rotor: laminated slotted armature core with copper coils, joined to an insulated copper commutator; carbon brushes on the neutral axis lead the current out to A1–A2. The shaft is coupled to a prime mover at the drive end; two bearings in the end shields carry it.',
  principle: 'Faraday’s law: a conductor moving through a magnetic field has an EMF e = B·l·v induced along it. In one armature coil this EMF alternates as the coil sides pass under N and S poles; the commutator reverses the coil’s connection at the neutral zone, so the brushes deliver it in one direction. A load current flowing in the conductors meets the field and produces a force against the motion — the electrical power out is paid for by mechanical torque in.',
  equations: [
    { expr: 'E = kΦ · ω', meaning: 'Generated EMF: proportional to flux and speed (k = P·Z / 2π·A).' },
    { expr: 'kΦ = kf · If,  If = Vf / Rf', meaning: 'Separately excited, unsaturated: the flux follows the field current.' },
    { expr: 'V = E − Ia · Ra', meaning: 'Terminal voltage: EMF minus the armature drop (brush drop neglected).' },
    { expr: 'Ia = IL = E / (Ra + RL)', meaning: 'Load current with a resistive load.' },
    { expr: 'T = kΦ · Ia', meaning: 'Counter-torque the prime mover must supply.' },
    { expr: 'T·ω = E·Ia = V·IL + Ia²·Ra', meaning: 'Power balance of the armature.' },
  ],
  assumptions: [...LINEAR_ASSUMPTIONS, 'Separately excited field with a constant supply; resistive load; the prime mover holds the speed constant whatever the torque.'],
  characteristics: [
    'Open-circuit characteristic: E rises in proportion to If (linear here; in reality it bends over by saturation and starts from a small residual voltage).',
    'External characteristic: V falls slightly and linearly as the load current rises (Ia·Ra drop); a self-excited shunt generator falls faster because its field also weakens.',
    'E is proportional to speed: a tachogenerator uses this to measure speed.',
  ],
  losses: ['Armature copper loss Ia²·Ra.', 'Field loss If²·Rf (from the field supply).', 'Brush contact drop and brush friction.', 'Iron loss in the rotating armature core, bearing friction and windage.'],
  advantages: ['Output voltage easily set by the field current.', 'Gives DC directly, without a rectifier.', 'Linear EMF–speed relation (tachogenerators).'],
  limitations: ['Commutator and brushes wear and spark; maintenance needed.', 'Commutation limits the voltage and speed.', 'Largely replaced by alternators with rectifiers.'],
  applications: ['Historic power supplies and battery charging', 'Tachogenerators for speed feedback', 'Exciters for large synchronous machines (older plants)', 'Teaching laboratories (Ward–Leonard sets)'],
  misconceptions: [
    'The armature of a DC generator does NOT generate DC: each coil’s EMF alternates; the commutator rectifies it mechanically.',
    'A generator does not "make" energy from its magnets: every watt delivered comes from the prime mover, through the counter-torque.',
    'With no load the generator still has an EMF, but no current and almost no counter-torque: it is the load current that loads the prime mover.',
  ],
  sources: ['Standard textbook relations for DC machines (e.g. Chapman, Electric Machinery Fundamentals; Fitzgerald & Kingsley, Electric Machinery). Terminal markings per IEC 60034-8.'],
}

const QUIZ: QuizItem[] = [
  { id: 'id-pm', kind: 'identify', prompt: 'What is the highlighted part?', part: 'prime-mover', options: ['Prime mover and coupling', 'Rear bearing', 'Load resistor', 'Field supply'], answer: 0, explain: 'The prime mover (engine, turbine or motor) drives the generator through the flange coupling: it supplies all the mechanical power.' },
  { id: 'id-comm', kind: 'identify', prompt: 'Which part turns the alternating coil EMF into a unidirectional terminal voltage?', part: 'commutator', options: ['Brushes', 'Commutator', 'Field coils', 'Pole shoe'], answer: 1, explain: 'The commutator: its segments reverse each coil’s connection to the brushes at the neutral zone, a mechanical rectifier.', misconceptions: { 0: 'The brushes only make the sliding contact; the reversal comes from the segments moving under them.' } },
  { id: 'predict-load', kind: 'predict', prompt: 'At constant speed and field, you lower the load resistance RL (more load). What does the prime mover feel?', options: ['A larger counter-torque', 'No change: the torque depends only on speed', 'A smaller counter-torque'], answer: 0, explain: 'More load → more current Ia → more force on the conductors against the motion: T = kΦ·Ia rises. The prime mover must deliver more power.', misconceptions: { 1: 'The EMF depends on speed; the torque depends on the current the load draws.' } },
  { id: 'predict-speed', kind: 'predict', prompt: 'On open circuit, the speed is halved (same field current). The EMF…', options: ['halves', 'stays the same', 'doubles'], answer: 0, explain: 'E = kΦ·ω: with the flux unchanged, E is proportional to the speed.' },
  { id: 'predict-v', kind: 'predict', prompt: 'Under load, is the terminal voltage V higher or lower than the generated EMF E?', options: ['Lower, by Ia·Ra', 'Higher, by Ia·Ra', 'Equal'], answer: 0, explain: 'The armature current flows through Ra inside the machine: V = E − Ia·Ra. (In a motor it is the other way round: V = E + Ia·Ra.)' },
  { id: 'order-gen', kind: 'order', prompt: 'Put the generator’s working sequence in order.', options: ['The field current magnetises the poles', 'The prime mover turns the armature', 'An alternating EMF is induced in each coil', 'The commutator delivers it in one direction to the brushes', 'The load current produces a counter-torque on the prime mover'], answer: 0, explain: 'Field, then motion, induced EMF, mechanical rectification, and finally the load current and its counter-torque.' },
  { id: 'match-t', kind: 'match', prompt: 'Which relation gives the torque the prime mover must supply?', options: ['T = kΦ · Ia', 'E = kΦ · ω', 'V = E − Ia·Ra'], answer: 0, explain: 'The counter-torque is set by the flux and the armature (load) current.' },
]

const def: MachineDef = {
  id: 'dc-generator',
  manifest: dcManifest('generator', 'Simplified educational model: two-pole wound-field DC generator, separately excited, 8-slot armature with full-pitch coils, 8-segment commutator, a generic prime mover. Proportions are illustrative, not a specific product.'),
  parts: dcParts('generator'),
  layers: dcLayers('generator'),
  steps: STEPS,
  params: PARAMS,
  calc,
  motion: (_c, p) => motionFromRpm(p.n, 'The prime mover is stopped: no rotation, no EMF.'),
  content: CONTENT,
  quiz: QUIZ,
  Model: ({ state }: { state: ModelState }) => <WoundFieldModel state={state} kind="generator" />,
}
export default def
