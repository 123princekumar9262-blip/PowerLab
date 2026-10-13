import { syncMotor } from '../../calculations/sync.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'
import { ALT_PARTS } from './alternatorContent.ts'

/*
 * Synchronous motor — the same family of construction as the alternator (shared geometry), with damper bars in the
 * pole faces and a driven load instead of the prime mover. Shaft = z axis, front (+z) = slip-ring end. The stator
 * field turns counter-clockwise seen from the front (sequence a → b → c); the rotor follows it at exactly the same
 * speed, lagging by the load angle δ.
 */

const base = (id: string) => ALT_PARTS.find((p) => p.id === id)!

export const SM_PARTS: MachinePart[] = [
  { ...base('frame') },
  { ...base('terminal-box'), function: 'Brings the three-phase supply to the stator winding. The current drawn here depends on the load and on the excitation.' },
  { ...base('end-shield-front') },
  { ...base('end-shield-rear'), function: 'Closes the machine and carries the drive end of the shaft, next to the coupling to the load.', related: ['shaft', 'coupling'] },
  { ...base('stator-core') },
  { ...base('stator-winding'), function: 'Fed with three-phase currents 120° apart, the three phases together make a magnetic field of constant strength that rotates at the synchronous speed Ns = 120·f/P.' },
  { ...base('rotor'), function: 'Carries the field winding and the damper bars. Its poles lock onto the poles of the rotating stator field.' },
  { ...base('field-winding'), function: 'Carries the DC excitation current: it makes the rotor poles that lock to the stator field. The excitation also sets how much reactive power the motor draws or delivers (its power factor).' },
  {
    id: 'damper-winding',
    label: 'Damper (amortisseur) bars',
    what: 'Copper bars in the pole faces, short-circuited at each end — a partial squirrel cage.',
    function: 'At start-up the rotating field induces currents in them and the motor starts like an induction motor. At synchronous speed they carry no current, except when the speed swings (hunting), which they damp.',
    explode: [2.8, -0.95, 0],
    stage: 3,
    anchor: [-0.88, 0.05, 0.8],
    related: ['rotor'],
  },
  { ...base('shaft'), function: 'Takes the torque from the rotor to the load.' },
  { ...base('slip-rings') },
  { ...base('brushes') },
  { ...base('coupling'), what: 'Two bolted flanges joining the motor shaft to the load shaft.', function: 'Transmits the motor torque to the driven machine.', related: ['load', 'shaft'] },
  { id: 'load', label: 'Driven load (shown cut short)', what: 'The driven machine — e.g. a compressor, pump or mill — drawn as a short stub.', function: 'Takes the mechanical power. Its torque sets the load angle; a torque above the pull-out torque would pull the rotor out of step.', explode: [0, 0, -1.1], stage: 1, anchor: [0.6, 1.0, -2.1], related: ['coupling'] },
]

export const SM_LAYERS: LayerInfo[] = [
  { id: 'rotatingField', label: 'Stator rotating field', legend: 'Violet arrows Bs: the axis of the field made by the three stator currents. It turns counter-clockwise at the synchronous speed Ns = 120·f/P (sequence a → b → c).', conceptual: true },
  { id: 'field', label: 'Rotor field', legend: 'Red arrows Br and N/S: the rotor poles made by the DC field current. The angle δ between Br and Bs is the load angle: the rotor lags the stator field by δ when it drives a load.', conceptual: true },
  { id: 'current', label: 'Field current (DC)', legend: 'Green: the DC field current, in at the + brush and out at the − brush; ⊙/⊗ on the pole coils show its direction (⊙ towards you). During starting, green markers on the damper bars show the induced currents.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the rotor turns counter-clockwise seen from the slip-ring end — the same direction as the stator field, at the same speed.', conceptual: false },
  { id: 'torque', label: 'Torques', legend: 'Amber: the electromagnetic torque on the rotor (in the direction of rotation) and the load torque at the coupling (against it). In steady state they balance.', conceptual: true },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: three-phase electrical power in at the terminals → mechanical power out at the coupling; the losses become heat.', conceptual: true },
]

export const SM_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · The same family of construction',
    text: 'A synchronous motor is built like the alternator: a laminated stator with a three-phase winding, and a salient-pole rotor whose field coils are fed with DC through slip rings and brushes. Two differences here: copper damper bars in the pole faces, and a driven load (a compressor, pump or mill) on the shaft instead of a prime mover.',
    focus: ['stator-winding', 'rotor', 'field-winding', 'damper-winding', 'slip-rings', 'brushes', 'load'],
    layers: [],
    detail: 'The same machine can generate or motor: the direction of power flow depends only on whether the rotor field leads (generator) or lags (motor) the stator field.',
  },
  {
    id: 'stator-field',
    title: '2 · The stator makes a rotating field',
    text: 'Three currents 120° apart in time flow in three windings 120° apart in space. Their fields add up to one field of constant strength whose axis turns counter-clockwise (a → b → c) at the synchronous speed. Here the rotor is still at rest and not yet excited: only the field turns.',
    focus: ['stator-winding', 'stator-core', 'terminal-box'],
    layers: ['rotatingField'],
    rotate: true,
    equation: 'Ns = 120 · f / P',
    detail: 'With 50 Hz and 4 poles the field turns at 1500 rpm. Swapping two supply lines reverses the sequence and so the direction.',
  },
  {
    id: 'starting',
    title: '3 · Why it cannot start on its own',
    text: 'If the rotor poles were excited at standstill, a stator N pole would sweep past them 25 times a second (50 Hz, 4 poles): the torque on the heavy rotor would push forwards, then backwards, every half-cycle, and average zero — it only vibrates. So it is started another way: the damper bars act as a squirrel cage, induced currents in them give induction-motor torque and run it up close to synchronous speed (or a variable-frequency drive ramps the frequency up from zero, or a small pony motor spins it).',
    focus: ['damper-winding', 'rotor'],
    layers: ['rotatingField', 'current'],
    rotate: true,
    detail: 'During an induction start the field winding is usually short-circuited through a resistor, because the rotating field would induce a high voltage in its many turns.',
  },
  {
    id: 'lock',
    title: '4 · Excite it: the rotor locks to the field',
    text: 'Near synchronous speed, DC is applied to the field winding. The rotor N poles are pulled towards the stator field and the rotor "pulls into step": from now on it turns at exactly the synchronous speed, locked to the rotating field like two magnets. The damper bars now see no change of flux and carry no current.',
    focus: ['field-winding', 'rotor', 'stator-winding'],
    layers: ['rotatingField', 'field', 'rotation'],
    rotate: true,
    equation: 'n = Ns = 120 · f / P   (at any load below pull-out)',
  },
  {
    id: 'load-angle',
    title: '5 · Load: the rotor falls behind by δ',
    text: 'With a load on the shaft, the rotor drops back slightly behind the stator field — by the load angle δ — but keeps the same speed. The magnetic pull across the gap then has a tangential part: the torque. More load → larger δ → more torque, at exactly the same speed. (The angle is drawn as a concept; the calculation gives its value.)',
    focus: ['rotor', 'coupling', 'load'],
    layers: ['rotatingField', 'field', 'torque', 'rotation'],
    rotate: true,
    equation: 'P = 3 · V · E · sin δ / Xs = T · ωs',
    detail: 'Round-rotor model with Ra neglected. A salient-pole rotor also produces a small reluctance torque proportional to sin 2δ.',
  },
  {
    id: 'pull-out',
    title: '6 · Pull-out torque',
    text: 'The torque is largest at δ = 90° (electrical): Tmax = 3·V·E/(Xs·ωs). A load torque above that cannot be held: the rotor slips a pole, loses synchronism and the motor must be tripped. A stronger excitation (larger E) raises the pull-out torque.',
    focus: ['rotor', 'field-winding', 'load'],
    layers: ['rotatingField', 'field'],
    rotate: true,
    equation: 'Tmax = 3 · V · E / (Xs · ωs)',
  },
  {
    id: 'excitation',
    title: '7 · Excitation sets the power factor',
    text: 'At a given load, the field current changes the stator current and its phase, not the speed. Under-excited (E·cos δ < V), the motor draws lagging reactive power like an induction motor; at the right excitation it runs at unity power factor; over-excited (E·cos δ > V) it delivers reactive power to the supply — leading power factor. That is why synchronous motors (and unloaded "synchronous condensers") are used to correct the power factor of a plant.',
    focus: ['field-winding', 'brushes', 'terminal-box'],
    layers: ['current', 'energy'],
    equation: 'Q = 3 · V · (V − E · cos δ) / Xs',
    detail: 'Plotting stator current against field current at constant load gives the V-curves; their minimum is unity power factor.',
  },
]

export const SM_PARAMS: MachineParam[] = [
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 300, step: 1, value: 80 },
  { id: 'e', label: 'Excitation EMF E per phase (set by If)', unit: 'V', min: 100, max: 400, step: 5, value: 260 },
  { id: 'f', label: 'Supply frequency f', unit: 'Hz', min: 10, max: 60, step: 1, value: 50 },
  { id: 'poles', label: 'Number of poles P (the model shows 4)', unit: '', min: 2, max: 8, step: 2, value: 4, options: [2, 4, 6, 8] },
  { id: 'vline', label: 'Supply line voltage VLL', unit: 'V', min: 200, max: 690, step: 5, value: 400, level: 'standard' },
  { id: 'xs', label: 'Synchronous reactance Xs', unit: 'Ω', min: 1, max: 20, step: 0.5, value: 6, level: 'standard' },
]

const DEG = 180 / Math.PI
export function smCalc(p: Record<string, number>): CalcResult[] {
  const r = syncMotor({ vline: p.vline, f: p.f, poles: p.poles, e: p.e, xs: p.xs, tl: p.tl })
  if (!r) return []
  const out = r.pullOut ? 'Beyond pull-out: no steady state — the rotor loses synchronism.' : undefined
  return [
    { id: 'n', label: 'Speed n', value: r.pullOut ? null : r.ns, unit: 'rpm', formula: 'n = Ns = 120 · f / P', note: out ?? 'Exactly synchronous at any load below pull-out.' },
    { id: 'delta', label: 'Load angle δ (electrical)', value: r.delta === null ? null : r.delta * DEG, unit: '°', formula: 'sin δ = T·ωs·Xs / (3·V·E)', note: out },
    { id: 'pout', label: 'Mechanical output', value: r.pout === null ? null : r.pout / 1000, unit: 'kW', formula: 'P = TL · ωs  (= input: losses neglected)' },
    { id: 'tmax', label: 'Pull-out torque', value: r.tmax, unit: 'N·m', formula: 'Tmax = 3·V·E / (Xs·ωs)' },
    { id: 'i', label: 'Stator current I', value: r.i, unit: 'A', formula: 'I = |V − E∠−δ| / Xs' },
    { id: 'q', label: 'Reactive power drawn Q', value: r.q === null ? null : r.q / 1000, unit: 'kvar', formula: 'Q = 3·V·(V − E·cos δ) / Xs', note: r.q === null ? undefined : r.q < 0 ? 'Negative: over-excited — the motor delivers reactive power (leading).' : 'Positive: under-excited — the motor absorbs reactive power (lagging).' },
    { id: 'pf', label: 'Power factor', value: r.pf, unit: '', formula: 'cos φ = P / (3·V·I)', note: r.pf === null ? undefined : r.leading ? 'leading (over-excited)' : 'lagging (under-excited)' },
    { id: 'vph', label: 'Phase voltage V', value: r.v, unit: 'V', formula: 'V = VLL / √3  (star)' },
  ]
}

export const SM_CONTENT: MachineContent = {
  overview: 'A synchronous motor runs at exactly the synchronous speed Ns = 120·f/P whatever its load: its DC-excited rotor poles lock onto the rotating field of the three-phase stator. The load only changes the load angle δ by which the rotor lags the field — until the pull-out torque is reached.',
  construction: 'As the alternator: laminated stator with a distributed three-phase winding; salient-pole (or round) rotor with DC field coils fed through slip rings and brushes (or a brushless exciter). Damper bars in the pole faces form a partial cage for starting and for damping oscillations. Permanent-magnet synchronous motors (PMSM) replace the field winding with magnets.',
  principle: 'The stator currents make a field rotating at Ns. The rotor poles, excited with DC, are attracted to the opposite poles of that field and turn with it. With load, the rotor falls back by δ and the attraction gets a tangential component — the torque P = 3·V·E·sin δ/Xs. Above δ = 90° the torque falls again: the motor pulls out of step.',
  equations: [
    { expr: 'Ns = 120 · f / P', meaning: 'Synchronous speed: the motor runs exactly at it.' },
    { expr: 'P = 3 · V · E · sin δ / Xs', meaning: 'Power (and torque × ωs) of a round-rotor machine, Ra neglected, as a function of the load angle.' },
    { expr: 'Tmax = 3 · V · E / (Xs · ωs)', meaning: 'Pull-out torque, at δ = 90° electrical.' },
    { expr: 'V = E + j·Xs·I', meaning: 'Per-phase equivalent circuit (motor convention, Ra neglected).' },
    { expr: 'Q = 3 · V · (V − E · cos δ) / Xs', meaning: 'Reactive power drawn: positive (lagging) when under-excited, negative (leading) when over-excited.' },
  ],
  assumptions: ['Balanced three-phase supply of fixed voltage and frequency (an infinite bus), star connected.', 'Round-rotor model: saliency (reluctance torque) neglected; Ra neglected.', 'Losses neglected: mechanical output = electrical input.', 'Steady state: the load angle is constant (no hunting).', 'The drawn rotor has 4 poles; the calculation uses the pole number you choose.'],
  characteristics: ['Speed independent of load (a horizontal speed–torque line) up to pull-out.', 'The load angle δ grows with load torque (sin δ ∝ T).', 'Power factor adjustable by the field current: lagging, unity or leading (V-curves).', 'Not self-starting from a fixed-frequency supply.'],
  losses: ['Stator copper loss 3·I²·Ra (neglected in this model).', 'Iron loss in the stator core.', 'Field winding loss If²·Rf.', 'Friction and windage.'],
  advantages: ['Constant speed, exactly locked to the supply frequency.', 'Can run at unity or leading power factor and correct a plant\'s power factor.', 'High efficiency, especially in large ratings (no rotor slip loss).'],
  limitations: ['Needs a starting method (damper cage, a variable-frequency drive or a pony motor).', 'Needs a DC excitation system.', 'Loses synchronism if overloaded beyond pull-out or on a deep voltage dip.', 'Can hunt (oscillate about δ) after load changes; damper bars reduce this.'],
  applications: ['Large compressors, pumps, mills and fans running at constant speed', 'Synchronous condensers for reactive-power support', 'With an inverter: ship propulsion, rolling mills; PMSMs in EVs and servo drives'],
  misconceptions: [
    'A synchronous motor does not slow down under load: its speed stays exactly synchronous; only the load angle grows.',
    'The field current does not control the speed: it changes the power factor and the pull-out torque. The speed is set by the supply frequency.',
    'It cannot start by itself just because it is excited: on a fixed 50 Hz supply the average torque at standstill is zero.',
  ],
  sources: ['Standard synchronous-machine relations (e.g. Chapman, Electric Machinery Fundamentals; Fitzgerald & Kingsley, Electric Machinery).'],
}

export const SM_QUIZ: QuizItem[] = [
  { id: 'id-damper', kind: 'identify', prompt: 'What is the highlighted part?', part: 'damper-winding', options: ['Damper (amortisseur) bars', 'Field winding', 'Stator winding', 'Slip rings'], answer: 0, explain: 'Damper bars: copper bars in the pole faces, shorted at the ends. They let the motor start as an induction motor and damp hunting.' },
  { id: 'predict-load', kind: 'predict', prompt: 'The load torque doubles (still below pull-out). What happens to the speed?', options: ['It stays exactly the same', 'It falls a little (slip)', 'It halves', 'It rises'], answer: 0, explain: 'The rotor stays locked to the rotating field: n = 120·f/P. Only the load angle δ grows (sin δ doubles).', misconceptions: { 1: 'Slip belongs to the induction motor. A synchronous motor has no slip in steady state.' } },
  { id: 'predict-pullout', kind: 'predict', prompt: 'The load torque is raised above the pull-out torque. What happens?', options: ['The rotor loses synchronism (pulls out of step)', 'It runs on with a little slip', 'The speed rises', 'The power factor becomes leading'], answer: 0, explain: 'Beyond δ = 90° the torque falls as δ grows: the rotor slips poles, the torque pulsates and the protection must trip the motor.' },
  { id: 'predict-excitation', kind: 'predict', prompt: 'At the same load you increase the field current well above normal. What happens?', options: ['The motor draws a leading current (delivers reactive power)', 'The speed rises', 'The load angle grows', 'Nothing changes'], answer: 0, explain: 'Over-excited, E·cos δ > V: Q becomes negative — the motor supplies reactive power, a leading power factor. The speed is unchanged and δ actually becomes smaller.', misconceptions: { 1: 'The speed is set only by the supply frequency and the poles.' } },
  { id: 'order-start', kind: 'order', prompt: 'Put the starting sequence in order.', options: ['Connect the stator: the field rotates, the rotor is at rest', 'Induced currents in the damper bars run the rotor up', 'Near synchronous speed, apply DC to the field winding', 'The rotor pulls into step and runs at Ns'], answer: 0, explain: 'Induction start on the damper cage, then excitation pulls the rotor into synchronism.' },
  { id: 'match-ns', kind: 'match', prompt: 'A 6-pole synchronous motor on a 50 Hz supply runs at…', options: ['1000 rpm', '1500 rpm', '960 rpm', '3000 rpm'], answer: 0, explain: 'Ns = 120·50/6 = 1000 rpm — exactly, at any load below pull-out.', misconceptions: { 2: '960 rpm would be a 6-pole induction motor with 4 % slip.' } },
]
