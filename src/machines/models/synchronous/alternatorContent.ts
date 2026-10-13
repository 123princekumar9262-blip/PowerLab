import { alternator } from '../../calculations/sync.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Synchronous generator (alternator) — content and explicit calculations. Geometry: geometry.tsx / SyncModel.tsx.
 * Shaft = z axis, front (+z) = slip-ring end, rear (−z) = coupling and prime mover. The rotor turns counter-clockwise
 * seen from the front; the winding layout makes the induced EMFs follow the sequence a → b → c.
 */

export const ALT_PARTS: MachinePart[] = [
  { id: 'frame', label: 'Stator frame', what: 'The fabricated steel housing with cooling ribs and feet.', function: 'Holds the stator core rigidly, carries the end shields and bearings, and fixes the machine to its foundation. It takes the reaction of the torque on the stator.', outer: true, explode: [0, 0, 0], stage: 3, anchor: [-1.25, 1.2, 0.55], related: ['stator-core', 'end-shield-front', 'end-shield-rear'] },
  { id: 'terminal-box', label: 'Terminal box (U, V, W)', what: 'The box on top of the frame with the three phase terminals.', function: 'Brings the three stator phase ends out to the load or the grid. The three-phase output voltage appears here.', outer: true, explode: [0, 0.3, 0], stage: 1, anchor: [0, 2.2, 0.25], related: ['stator-winding'] },
  { id: 'end-shield-front', label: 'Front end shield + bearing', what: 'The cover at the slip-ring end, with a ball bearing in its boss.', function: 'Closes the machine and carries one end of the shaft in its bearing.', outer: true, explode: [0, 0, 0.95], stage: 1, anchor: [0.95, -0.95, 1.12], related: ['shaft'] },
  { id: 'end-shield-rear', label: 'Rear end shield + bearing', what: 'The cover at the drive end, with the second bearing.', function: 'Closes the machine and carries the drive end of the shaft, close to the coupling that takes the prime-mover torque.', outer: true, explode: [0, 0, -0.4], stage: 2, anchor: [-1.0, 1.0, -1.12], related: ['shaft', 'coupling'] },
  { id: 'stator-core', label: 'Stator core (laminated)', what: 'A stack of thin insulated steel laminations with 24 slots on the inside.', function: 'Carries the rotating flux of the rotor poles with little magnetic reluctance and holds the armature winding. The flux in it alternates, so it is laminated to limit eddy currents.', explode: [0, 0, 0], stage: 3, anchor: [1.08, 1.08, 0.4], related: ['stator-winding', 'frame'] },
  { id: 'stator-winding', label: 'Three-phase stator winding', what: 'Copper coils in the slots, in three phases a, b, c (red, yellow, blue) displaced by 120 electrical degrees.', function: 'The armature: the rotating rotor field induces the three phase EMFs in these conductors, and the load current flows in them. The end turns join the conductors of each coil outside the core.', explode: [0, 0, 0], stage: 3, anchor: [0, -1.2, 1.0], related: ['stator-core', 'terminal-box'] },
  { id: 'rotor', label: 'Salient-pole rotor', what: 'A laminated rotor with four projecting poles (pole bodies and pole shoes) on the shaft.', function: 'Carries the field winding. Its pole shoes shape the air-gap flux under each pole; the field rotates with it.', explode: [2.8, -0.95, 0], stage: 3, anchor: [0.5, -0.05, 0.75], related: ['field-winding', 'shaft'] },
  { id: 'field-winding', label: 'Field winding (DC)', what: 'A copper coil around each pole body, connected in series so the poles alternate N, S, N, S.', function: 'Carries the DC excitation current If. It magnetises the poles: the field current sets the flux per pole Φ, and therefore the generated voltage.', explode: [2.8, -0.95, 0], stage: 3, anchor: [0, 0.58, 0.82], related: ['slip-rings', 'rotor'] },
  { id: 'shaft', label: 'Shaft', what: 'The steel shaft through the rotor, the slip rings and the coupling.', function: 'Takes the torque of the prime mover to the rotor.', explode: [2.8, -0.95, 0], stage: 3, anchor: [0, 0.16, 1.66], related: ['coupling', 'rotor'] },
  { id: 'slip-rings', label: 'Slip rings', what: 'Two continuous copper rings, insulated from the shaft, each joined to one end of the field winding.', function: 'Let the stationary brushes feed DC into the rotating field winding. They are plain rings (no segments): unlike a commutator, they do not switch anything.', explode: [2.8, -0.95, 0.3], stage: 3, anchor: [0.3, -0.22, 1.36], related: ['brushes', 'field-winding'] },
  { id: 'brushes', label: 'Brushes (field supply)', what: 'Two carbon brushes in holders, pressed on the slip rings.', function: 'Bring the DC field current from the exciter or a DC supply onto the slip rings. They carry only the small field current, not the output power.', explode: [0, 0.75, 0], stage: 1, anchor: [0, 0.72, 1.36], related: ['slip-rings'] },
  { id: 'coupling', label: 'Shaft coupling', what: 'Two bolted flanges joining the generator shaft to the prime-mover shaft.', function: 'Transmits the driving torque from the prime mover into the generator shaft.', explode: [0, 0, -0.6], stage: 1, anchor: [0.4, 0.4, -1.39], related: ['prime-mover', 'shaft'] },
  { id: 'prime-mover', label: 'Prime mover (shown cut short)', what: 'The turbine or engine that drives the generator (drawn as a short stub).', function: 'Supplies the mechanical power. Its speed governor holds the speed — and so the frequency — and it must supply more torque when the electrical load rises.', explode: [0, 0, -1.1], stage: 1, anchor: [0.6, 0.9, -2.1], related: ['coupling'] },
]

export const ALT_LAYERS: LayerInfo[] = [
  { id: 'field', label: 'Rotor field', legend: 'Blue dashed paths: the flux of the rotor poles — out of each N pole, across the air gap, round the stator core and back into the neighbouring S poles. The pattern turns with the rotor.', conceptual: true },
  { id: 'current', label: 'Field current (DC)', legend: 'Green: the DC field current If, in at the + brush and out at the − brush. ⊙/⊗ on the pole coils show its direction (⊙ towards you at the front); the circulation makes the poles alternate N, S.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the rotor turns counter-clockwise seen from the slip-ring end.', conceptual: false },
  { id: 'emf', label: 'Phase EMFs', legend: 'Magenta ⊙/⊗: the direction of the EMF induced in the stator conductors under each pole (it travels with the poles). The bars ea, eb, ec show the three phase EMFs at the rotor angle shown: they peak in the order a → b → c.', conceptual: true },
  { id: 'torque', label: 'Torques', legend: 'Amber: the prime-mover torque drives the shaft forwards; the load current in the stator produces an electromagnetic counter-torque in the opposite direction. In steady state they balance.', conceptual: true },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: mechanical power in at the coupling → electrical power out at the terminals; the rest becomes heat (copper, iron, friction losses).', conceptual: true },
]

export const ALT_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'Outside: the laminated stator core with a three-phase winding in its slots (phases a, b, c in red, yellow and blue). Inside: a salient-pole rotor with four poles; each pole carries a field coil. Two slip rings and brushes at the front feed the field coils with DC. At the back, a coupling joins the shaft to the prime mover (a turbine or an engine).',
    focus: ['stator-core', 'stator-winding', 'rotor', 'field-winding', 'slip-rings', 'brushes', 'shaft', 'prime-mover'],
    layers: [],
    detail: 'Large machines put the armature on the stator: it carries the large output current and high voltage, which are easier to insulate and connect when stationary. Only the small DC field power passes the sliding contacts.',
  },
  {
    id: 'excitation',
    title: '2 · DC excitation makes the rotor poles',
    text: 'A DC current If enters at one brush, flows through its slip ring into the field coils and returns through the other ring and brush. The coils are connected so that the current circulates in opposite senses on neighbouring poles: the poles become N, S, N, S. Flux leaves each N pole, crosses the air gap into the stator core and returns into the neighbouring S poles.',
    focus: ['field-winding', 'slip-rings', 'brushes', 'rotor'],
    layers: ['current', 'field'],
    equation: 'Φ ≈ kf · If   (linear, unsaturated)',
    detail: 'In practice the iron saturates: Φ rises more slowly than If at high excitation (the open-circuit characteristic bends over). Many machines use a brushless exciter with rotating diodes instead of slip rings.',
  },
  {
    id: 'drive',
    title: '3 · The prime mover turns the rotor',
    text: 'The prime mover drives the shaft through the coupling at a speed n held constant by its speed governor. The rotor poles — and the flux pattern they carry — turn with the shaft. Seen from the stator, the field is now a rotating magnetic field made mechanically, by turning a DC magnet.',
    focus: ['prime-mover', 'coupling', 'shaft', 'rotor'],
    layers: ['rotation', 'field'],
    rotate: true,
  },
  {
    id: 'emf',
    title: '4 · The rotating field induces three phase EMFs',
    text: 'As each pole sweeps past a stator conductor, the flux linking the coils of a phase rises and falls, and an EMF is induced (e = −dλ/dt). The conductors under an N pole have their EMF one way (⊙), those under an S pole the other way (⊗). The three phase windings are placed 120 electrical degrees apart, so their EMFs ea, eb, ec are three equal sine waves that peak one after the other: a, then b, then c. Watch the bars while the rotor turns.',
    focus: ['stator-winding', 'stator-core'],
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'E = 4.44 · kw · N · f · Φ   (rms, per phase)',
    detail: 'With a sinusoidal flux distribution, λ = kw·N·Φ·cos θe and the rms EMF is √2·π·kw·N·f·Φ. Turning the rotor the other way reverses the phase sequence (a → c → b).',
  },
  {
    id: 'frequency',
    title: '5 · Frequency is set by speed and poles',
    text: 'One pair of poles passing a conductor makes one full cycle of its EMF. A rotor with P poles makes P/2 cycles per revolution, and n/60 revolutions per second: f = P·n/120. The drawn 4-pole rotor must turn at 1500 rpm for 50 Hz (a 2-pole turbo-generator at 3000 rpm). The EMF also rises with speed, because the flux is cut faster.',
    focus: ['rotor', 'stator-winding'],
    layers: ['emf', 'rotation'],
    rotate: true,
    equation: 'f = P · n / 120',
    detail: 'Slow hydro turbines therefore need many poles (e.g. 40 poles at 150 rpm for 50 Hz) — the reason for large-diameter salient-pole rotors; fast steam turbines use 2- or 4-pole round rotors.',
  },
  {
    id: 'load',
    title: '6 · Loading the generator: counter-torque',
    text: 'Connect a load and currents flow in the stator phases. These currents, in the field of the rotor, produce an electromagnetic torque that opposes the rotation — a counter-torque. The prime mover must deliver a matching torque to keep the speed (and the frequency): electrical power out comes from mechanical power in. With no load there is no current and almost no torque is needed.',
    focus: ['stator-winding', 'terminal-box', 'coupling', 'prime-mover'],
    layers: ['torque', 'energy', 'rotation'],
    rotate: true,
    equation: 'Pmech = T · ω = Pout + losses',
    detail: 'The governor senses the speed dip when the load rises and opens the throttle (fuel, steam or water). The angle δ between the EMF E and the terminal voltage V grows with the load.',
  },
  {
    id: 'voltage',
    title: '7 · Excitation sets the voltage',
    text: 'At a given speed the EMF is proportional to the flux, which the field current sets. Raising If raises E and the terminal voltage; the frequency does not change, because it depends only on the speed. Under load, the terminal voltage is lower than E because of the drop across the synchronous reactance Xs (and the resistance Ra). An automatic voltage regulator (AVR) adjusts If to hold the terminal voltage.',
    focus: ['field-winding', 'brushes', 'terminal-box'],
    layers: ['current', 'emf'],
    equation: 'E = V + I · (Ra + j·Xs)',
    detail: 'Connected to a large grid (an infinite bus), the voltage is fixed by the grid: the excitation then sets the reactive power instead, and the prime-mover torque sets the active power.',
  },
  {
    id: 'limits',
    title: '8 · Limits',
    text: 'Stator current heats the armature winding (rated current, so a rated kVA). Field current heats the field winding (a limit on over-excitation). Too little excitation on a grid risks losing synchronism (the load angle δ must stay well below 90°). The speed is limited by the mechanical strength of the rotor and the frequency is fixed by the grid. The iron saturates, so the voltage cannot be raised indefinitely by the field current.',
    focus: ['stator-winding', 'field-winding', 'rotor', 'frame'],
    layers: [],
    detail: 'These limits form the generator capability chart (P–Q diagram): stator-current circle, field-current limit, prime-mover power limit and stability limit.',
  },
]

export const ALT_PARAMS: MachineParam[] = [
  { id: 'n', label: 'Speed n (set by the prime mover)', unit: 'rpm', min: 300, max: 3600, step: 10, value: 1500 },
  { id: 'poles', label: 'Number of poles P (the model shows 4)', unit: '', min: 2, max: 8, step: 2, value: 4, options: [2, 4, 6, 8] },
  { id: 'ifield', label: 'Field current If', unit: 'A', min: 0, max: 10, step: 0.1, value: 4.5 },
  { id: 'rl', label: 'Load resistance per phase RL (star)', unit: 'Ω', min: 2, max: 200, step: 1, value: 10 },
  { id: 'xs', label: 'Synchronous reactance Xs', unit: 'Ω', min: 0.2, max: 10, step: 0.1, value: 2, level: 'standard' },
  { id: 'kf', label: 'Flux per field ampere kf', unit: 'Wb/A', min: 0.001, max: 0.008, step: 0.0005, value: 0.004, level: 'engineer' },
  { id: 'turns', label: 'Series turns per phase N', unit: '', min: 20, max: 200, step: 2, value: 60, level: 'engineer' },
  { id: 'kw', label: 'Winding factor kw', unit: '', min: 0.8, max: 1, step: 0.01, value: 0.95, level: 'engineer' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.01, max: 1, step: 0.01, value: 0.1, level: 'engineer' },
]

const DEG = 180 / Math.PI
export function altCalc(p: Record<string, number>): CalcResult[] {
  const r = alternator({ poles: p.poles, n: p.n, ifield: p.ifield, kf: p.kf, turns: p.turns, kw: p.kw, xs: p.xs, ra: p.ra, rl: p.rl })
  if (!r) return []
  return [
    { id: 'f', label: 'Frequency f', value: r.f, unit: 'Hz', formula: 'f = P · n / 120' },
    { id: 'flux', label: 'Flux per pole Φ', value: r.flux * 1000, unit: 'mWb', formula: 'Φ = kf · If  (no saturation)' },
    { id: 'e', label: 'EMF per phase E', value: r.e, unit: 'V', formula: 'E = 4.44 · kw · N · f · Φ' },
    { id: 'eLine', label: 'Open-circuit line voltage', value: r.eLine, unit: 'V', formula: 'VLL = √3 · E  (star)' },
    { id: 'i', label: 'Phase current I', value: r.i, unit: 'A', formula: 'I = E / |(Ra + RL) + j·Xs|' },
    { id: 'v', label: 'Terminal voltage per phase V', value: r.v, unit: 'V', formula: 'V = I · RL', note: 'Lower than E: the drop across Xs and Ra under load.' },
    { id: 'vLine', label: 'Terminal line voltage', value: r.vLine, unit: 'V', formula: 'VLL = √3 · V' },
    { id: 'delta', label: 'Angle δ between E and V', value: r.delta * DEG, unit: '°', formula: 'δ = atan( I·Xs / (V + I·Ra) )' },
    { id: 'pout', label: 'Electrical output', value: r.pout / 1000, unit: 'kW', formula: 'Pout = 3 · V · I' },
    { id: 'pcu', label: 'Stator copper loss', value: r.pcu / 1000, unit: 'kW', formula: 'Pcu = 3 · I² · Ra' },
    { id: 'pmech', label: 'Mechanical input', value: r.pmech / 1000, unit: 'kW', formula: 'Pmech = Pout + Pcu  (other losses neglected)' },
    { id: 'torque', label: 'Prime-mover torque T', value: r.torque, unit: 'N·m', formula: 'T = Pmech / ω,  ω = 2π·n / 60', note: 'Equal and opposite to the electromagnetic counter-torque in steady state.' },
    { id: 'eff', label: 'Efficiency (this model)', value: r.eff, unit: '%', formula: 'η = Pout / Pmech', note: 'Iron, friction, windage and excitation losses are not in this model.' },
  ]
}

export const ALT_CONTENT: MachineContent = {
  overview: 'A synchronous generator (alternator) turns mechanical power into three-phase AC. A DC-excited rotor, turned by a prime mover, carries its magnetic field round inside a three-phase stator winding and induces three EMFs 120° apart, at a frequency fixed by the speed: f = P·n/120.',
  construction: 'Stator: a laminated, slotted core in a steel frame, with a distributed three-phase winding whose ends go to the terminal box. Rotor: here a salient-pole rotor (four laminated poles with pole shoes) carrying series-connected DC field coils; high-speed turbo-generators use a cylindrical (round) rotor instead. Field supply: two slip rings and brushes (or a brushless exciter). Shaft in two bearings in the end shields, coupled to a turbine or engine.',
  principle: 'The field current magnetises the rotor poles. As the prime mover turns the rotor, the flux linking each stator phase changes sinusoidally, inducing an EMF E = 4.44·kw·N·f·Φ per phase. The phases are 120 electrical degrees apart, so the EMFs form a balanced three-phase set in the sequence of the rotation. Load currents produce a counter-torque the prime mover must overcome.',
  equations: [
    { expr: 'f = P · n / 120', meaning: 'Electrical frequency from the number of poles P and the speed n in rpm.' },
    { expr: 'E = 4.44 · kw · N · f · Φ', meaning: 'RMS EMF per phase: winding factor, series turns per phase, frequency, flux per pole.' },
    { expr: 'Φ ≈ kf · If', meaning: 'The flux follows the field current while the iron is not saturated.' },
    { expr: 'E = V + I · (Ra + j·Xs)', meaning: 'Per-phase equivalent circuit of a round-rotor machine: EMF behind the synchronous reactance.' },
    { expr: 'Pmech = T · ω = 3·V·I·cos φ + losses', meaning: 'Power balance: the shaft supplies the electrical output and the losses.' },
  ],
  assumptions: ['Balanced three-phase, star connected, steady state.', 'Round-rotor equivalent circuit (saliency neglected): one synchronous reactance Xs.', 'No saturation: Φ = kf·If.', 'Resistive load per phase; iron, friction, windage and excitation losses neglected.', 'The drawn rotor has 4 poles; the calculation uses the pole number you choose.'],
  characteristics: ['Frequency depends only on speed (and poles), not on load or excitation.', 'At no load the terminal voltage equals E; with a lagging or resistive load it falls as current rises (the regulation).', 'The open-circuit voltage rises with field current and bends over as the iron saturates.', 'The prime-mover torque rises with the electrical power delivered.'],
  losses: ['Stator copper loss 3·I²·Ra.', 'Iron loss (hysteresis and eddy currents) in the stator core.', 'Field (excitation) copper loss If²·Rf.', 'Friction, windage and brush losses.'],
  advantages: ['Frequency precisely set by speed: the standard source of grid power.', 'Voltage and reactive power controllable through the excitation.', 'Stationary armature: high voltage and current are easy to insulate and connect.', 'Very high efficiency in large units.'],
  limitations: ['Must turn at exactly synchronous speed to give the grid frequency.', 'Needs a DC excitation system (slip rings and brushes, or a brushless exciter).', 'Can lose synchronism on a grid if over-loaded or under-excited.', 'Large, heavy and needs cooling at high ratings.'],
  applications: ['Power stations (steam, gas, hydro turbines)', 'Diesel and gas gensets', 'Wind turbines (some designs)', 'Car alternators (claw-pole, with a rectifier)'],
  misconceptions: [
    'The field current does not set the frequency: frequency comes from speed and poles; the field current sets the voltage (or, on a grid, the reactive power).',
    'Slip rings are not a commutator: they do not rectify anything — they only pass DC into the rotating field winding.',
    'A generator does not deliver power "for free" when loaded: the load current creates a counter-torque and the prime mover must supply the extra mechanical power.',
  ],
  sources: ['Standard synchronous-machine relations (e.g. Chapman, Electric Machinery Fundamentals; Fitzgerald & Kingsley, Electric Machinery; Say, Alternating Current Machines).'],
}

export const ALT_QUIZ: QuizItem[] = [
  { id: 'id-slip', kind: 'identify', prompt: 'What is the highlighted part?', part: 'slip-rings', options: ['Commutator', 'Slip rings', 'Bearings', 'Coupling'], answer: 1, explain: 'Slip rings: two continuous rings that let the brushes feed DC into the rotating field winding.', misconceptions: { 0: 'A commutator has many insulated segments and reverses coil currents; slip rings are plain continuous rings and switch nothing.' } },
  { id: 'id-field', kind: 'identify', prompt: 'What is the highlighted part?', part: 'field-winding', options: ['Field winding (DC)', 'Three-phase stator winding', 'Damper bars', 'Slip rings'], answer: 0, explain: 'The field coils on the rotor poles carry the DC excitation current that makes the N and S poles.' },
  { id: 'predict-speed', kind: 'predict', prompt: 'The prime mover runs the alternator twice as fast (same field current). What happens?', options: ['Frequency and EMF both double', 'Only the frequency doubles', 'Only the EMF doubles', 'Nothing changes'], answer: 0, explain: 'f = P·n/120 doubles, and E = 4.44·kw·N·f·Φ doubles with f at the same flux.', misconceptions: { 1: 'The EMF depends on how fast the flux is cut: it is proportional to f as well as Φ.' } },
  { id: 'predict-field', kind: 'predict', prompt: 'At constant speed you raise the field current. What happens?', options: ['The voltage rises, the frequency stays the same', 'The frequency rises', 'Both voltage and frequency rise', 'The voltage falls'], answer: 0, explain: 'More field current → more flux → more EMF. The frequency depends only on the speed and the poles.', misconceptions: { 1: 'Frequency is set by speed: f = P·n/120. Excitation does not change it.' } },
  { id: 'predict-load', kind: 'predict', prompt: 'The electrical load on the generator increases. What must the prime mover do to keep the frequency?', options: ['Supply more torque', 'Nothing: the torque is unchanged', 'Turn faster', 'Supply less torque'], answer: 0, explain: 'The larger stator currents make a larger counter-torque; the governor must open the throttle so the shaft torque matches it, keeping the speed and the frequency.' },
  { id: 'order', kind: 'order', prompt: 'Put the working sequence in order.', options: ['DC field current magnetises the rotor poles', 'The prime mover turns the rotor', 'The rotor field sweeps past the stator conductors', 'Three phase EMFs are induced, a → b → c', 'A load current flows and creates a counter-torque'], answer: 0, explain: 'Excite the field, turn it, the moving field induces the EMFs in sequence, and the load current that flows produces the counter-torque the prime mover supplies.' },
  { id: 'match-f', kind: 'match', prompt: 'A 4-pole alternator must give 50 Hz. Which speed?', options: ['1500 rpm', '3000 rpm', '750 rpm', '50 rpm'], answer: 0, explain: 'n = 120·f/P = 120·50/4 = 1500 rpm.' },
]
