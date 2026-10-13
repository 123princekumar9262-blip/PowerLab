import { bldcSixStep, electricalFrequency } from '../../../calculations/modern.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Inner-rotor brushless DC motor: 6 stator teeth with concentrated coils (phases A, B, C, A, B, C counter-clockwise),
 * 4 surface magnets on the rotor (N at 0° and 180°, S at 90° and 270° mechanical), three Hall sensors on a ring PCB
 * at the rear, in the slot openings at 30°, 90°, 150° mechanical (60°, 180°, 300° electrical).
 * Electrical angle θe = 2·θm (4 poles). Shaft = z axis, front (+z) = output end, rotation counter-clockwise seen
 * from the front. The commutation logic is src/machines/calculations/modern.ts (unit-tested).
 */

export const POLES = 4

export const BLDC_PARTS: MachinePart[] = [
  { id: 'housing', label: 'Housing', what: 'The aluminium outer shell.', function: 'Holds the stator core, carries the heat of the stator windings out to the air, and locates the end caps.', outer: true, explode: [0, -1.35, 0], stage: 2, anchor: [0, -1.2, 0.3], related: ['stator-core'] },
  { id: 'end-cap-front', label: 'Front end cap', what: 'The cover at the output (drive) end.', function: 'Closes the motor and holds the front bearing.', outer: true, explode: [0, 0, 1.45], stage: 1, anchor: [0.75, 0.75, 0.98], related: ['bearing-front'] },
  { id: 'end-cap-rear', label: 'Rear end cap', what: 'The cover at the rear, with the cable exit.', function: 'Closes the motor, holds the rear bearing and protects the Hall board.', outer: true, explode: [0, 0, -1.2], stage: 1, anchor: [-0.75, -0.75, -0.98], related: ['bearing-rear', 'hall-board'] },
  { id: 'stator-core', label: 'Stator core (6 teeth)', what: 'A stack of thin insulated steel laminations with 6 teeth pointing inwards.', function: 'Carries the magnetic flux of the coils and the magnets with little reluctance; each tooth becomes an electromagnet pole when its coil carries current. Laminated because its flux changes direction many times per revolution (eddy-current loss).', explode: [0, 1.35, 0], stage: 4, anchor: [0.95, 0.55, 0.62], related: ['phase-a', 'phase-b', 'phase-c', 'housing'] },
  { id: 'phase-a', label: 'Phase A coils', what: 'Two concentrated coils on opposite teeth (0° and 180°), in series.', function: 'Phase A of the three-phase winding. When the controller switches current into A, its two teeth become N poles; out of A, S poles.', explode: [0, 0, 1.3], stage: 3, anchor: [0.8, 0.0, 0.75], related: ['phase-b', 'phase-c', 'stator-core'] },
  { id: 'phase-b', label: 'Phase B coils', what: 'Two concentrated coils on the teeth at 60° and 240°.', function: 'Phase B: 120° electrical after phase A around the stator (60° mechanical with 4 poles).', explode: [0, 0, 1.3], stage: 3, anchor: [0.4, 0.69, 0.75], related: ['phase-a', 'phase-c'] },
  { id: 'phase-c', label: 'Phase C coils', what: 'Two concentrated coils on the teeth at 120° and 300°.', function: 'Phase C: 240° electrical after phase A.', explode: [0, 0, 1.3], stage: 3, anchor: [-0.4, 0.69, 0.75], related: ['phase-a', 'phase-b'] },
  { id: 'magnets', label: 'Rotor magnets (4 poles)', what: 'Four curved permanent magnets glued on the rotor surface, alternately N and S outwards.', function: 'Make the rotor field. Nothing is connected to the rotor: no brushes, no rotor winding. They also pass over the Hall sensors, which read the rotor position from them.', explode: [0, 0, 0], stage: 4, anchor: [0.35, -0.36, 0.7], related: ['rotor-core', 'hall-board'] },
  { id: 'rotor-core', label: 'Rotor back iron', what: 'A steel hub under the magnets.', function: 'Closes the magnet flux path inside the rotor from one magnet to the next, and fixes the magnets to the shaft.', explode: [0, 0, 0], stage: 4, anchor: [-0.2, -0.2, 0.62], related: ['magnets', 'shaft'] },
  { id: 'shaft', label: 'Shaft', what: 'The steel shaft through the rotor.', function: 'Carries the torque out of the motor to the load.', explode: [0, 0, 0], stage: 4, anchor: [0, 0.16, 1.62], related: ['bearing-front', 'bearing-rear'] },
  { id: 'hall-board', label: 'Hall sensor board', what: 'A small ring-shaped PCB at the rear with three Hall sensors (Ha, Hb, Hc) and the leads.', function: 'Each Hall sensor switches 1 when a rotor N pole is over it and 0 for an S pole. The three bits tell the controller which 60° sector the rotor is in, so it knows which two phases to switch on next. It replaces the commutator and brushes.', explode: [0, 0, -0.6], stage: 2, anchor: [-0.55, 0.6, -0.8], related: ['magnets'] },
  { id: 'bearing-front', label: 'Front bearing', what: 'A ball bearing in the front end cap.', function: 'Holds the shaft centred and lets it turn with little friction.', explode: [0, 0, 1.0], stage: 1, anchor: [0.22, -0.22, 0.92], related: ['shaft'] },
  { id: 'bearing-rear', label: 'Rear bearing', what: 'A ball bearing in the rear end cap.', function: 'Supports the rear end of the shaft.', explode: [0, 0, -0.95], stage: 1, anchor: [-0.22, 0.22, -0.92], related: ['shaft'] },
]

export const BLDC_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Commutation (switched phases)', legend: 'Green outline: the two phases switched on now; "+A" = current into phase A, "−B" = current out of phase B; the third phase carries no current. The chip shows the Hall bits Ha Hb Hc and the pair the controller looks up from them — worked out from the drawn rotor angle.', conceptual: true },
  { id: 'field', label: 'Poles (stator and rotor)', legend: 'N / S on the stator teeth: the poles the switched coils make now (N in red, S in blue). N / S on the rotor: its magnets, turning with it. The stator S teeth stay ahead of the rotor N poles, pulling them forward.', conceptual: true },
  { id: 'torque', label: 'Torque', legend: 'Amber curved arrow: the electromagnetic torque on the rotor, counter-clockwise seen from the front (T = kt·I).', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the rotor turns counter-clockwise seen from the front (output end).', conceptual: false },
  { id: 'emf', label: 'Back EMF (trapezoidal)', legend: 'Chart: the ideal trapezoidal back-EMF shapes of phases A, B, C over one electrical cycle; the white cursor is where the drawn rotor is now. Ideal shapes for illustration, not a measurement.', conceptual: true },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: DC power in through the leads and the inverter → magnetic forces in the air gap → mechanical power out at the shaft; part becomes heat in the stator coils.', conceptual: true },
]

export const BLDC_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The stator is a laminated core with 6 teeth; each tooth carries its own coil (a concentrated winding). Opposite coils are in series and form one phase: A, B, C, A, B, C around the bore. The rotor is a steel hub with 4 surface magnets, N and S alternately. At the rear, a small PCB holds three Hall sensors. There are no brushes and no commutator.',
    focus: ['stator-core', 'phase-a', 'phase-b', 'phase-c', 'magnets', 'rotor-core', 'hall-board'],
    layers: [],
  },
  {
    id: 'hall',
    title: '2 · Hall sensors read the rotor position',
    text: 'The magnets pass the three Hall sensors as the rotor turns. Each sensor outputs 1 over a N pole and 0 over a S pole. Mounted 120° electrical apart (60° mechanical here), they give six different codes per electrical cycle — 100, 110, 010, 011, 001, 101 — each one meaning "the rotor is in this 60° sector". 000 and 111 never occur.',
    focus: ['hall-board', 'magnets'],
    layers: ['field', 'current'],
    rotate: true,
    equation: '6 Hall codes per electrical cycle;  θe = (P/2)·θm = 2·θm',
    detail: 'With 4 poles one electrical cycle is half a mechanical turn, so each code lasts 30° mechanical. Sensorless drives estimate the same sector from the back EMF of the unswitched phase instead.',
  },
  {
    id: 'commutation',
    title: '3 · Six-step electronic commutation',
    text: 'For each Hall code the controller switches on two phases through the inverter: current into one, out of another; the third is off. The sequence is A+B− → A+C− → B+C− → B+A− → C+A− → C+B−, one step every 60° electrical. Each phase conducts for 120° in each direction. Watch the green outlines move round as the rotor turns: they change exactly when the Hall code changes.',
    focus: ['hall-board', 'magnets'],
    layers: ['current'],
    rotate: true,
    equation: 'AB → AC → BC → BA → CA → CB   (60° electrical each)',
    detail: 'This is 120° (block) conduction. The phase currents are ideally rectangular blocks; the winding inductance makes each switching take time, which causes the commutation torque dip.',
  },
  {
    id: 'torque',
    title: '4 · Torque: the stator poles stay ahead of the rotor',
    text: 'The switched coils make their teeth N (current in) and S (current out). Each rotor N magnet is pulled towards the S teeth ahead of it and pushed by the N teeth behind it. Because the switching follows the rotor, the stator poles always stay 60–120° electrical ahead: the torque keeps one direction. In a motor with ideal flat-topped back EMF the torque is proportional to the current.',
    focus: ['magnets'],
    layers: ['field', 'current', 'torque'],
    rotate: true,
    equation: 'T = kt · I    (kt = ke in SI units)',
    detail: 'The stator field jumps 60° electrical at each step instead of turning smoothly, so the angle between the fields swings between 60° and 120°: this, and the commutation intervals, cause torque ripple.',
  },
  {
    id: 'back-emf',
    title: '5 · Back EMF (trapezoidal)',
    text: 'The turning magnets induce a voltage in each phase. With magnets spanning nearly a full pole and concentrated coils, its shape is close to a trapezoid with a flat top 120° wide. The controller switches each phase on exactly while its back EMF is on the flat top, so the two switched phases see a nearly constant line-to-line EMF E = ke·ω.',
    focus: ['magnets'],
    layers: ['emf', 'current'],
    rotate: true,
    equation: 'E = ke · ω    (line-to-line, two phases in series)',
    detail: 'The trapezoid is an idealisation; real back EMF has rounded corners. A motor designed for sinusoidal back EMF (a PMSM) is better driven with sinusoidal currents.',
  },
  {
    id: 'speed',
    title: '6 · Speed control by voltage',
    text: 'Seen from the DC supply, the motor behaves like a brushed DC motor: V = E + I·2Rph. The controller sets the average voltage by PWM (duty d of the DC supply). The load sets the current, the voltage sets the speed: with no load the motor runs up until E = V, so the no-load speed is V/ke.',
    focus: ['shaft', 'magnets'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'V = d·Vdc = ke·ω + 2Rph·I    ω0 = V / ke',
    detail: 'Neglects the inductive voltage and the commutation intervals; at high speed these reduce the current the inverter can push in each 60° step.',
  },
  {
    id: 'compare',
    title: '7 · Compare with the brushed DC motor',
    text: 'The BLDC is a brushed DC motor turned inside out. The magnets now turn and the windings stay still, so the current needs no sliding contact. The commutator and brushes are replaced by the Hall sensors (position) and the inverter (switches). The DC-motor equations still hold, but the BLDC needs electronics to run at all — connected straight to a battery it would not turn.',
    focus: ['hall-board', 'magnets', 'stator-core'],
    layers: ['rotation'],
    rotate: true,
    equation: 'brushed: commutator + brushes   ⇄   BLDC: Hall sensors + inverter',
    detail: 'Heat is produced in the stator, which touches the housing — easy to cool. No brush wear or sparking, so higher speeds and longer life; the price is the inverter and the position sensing.',
  },
]

export const BLDC_PARAMS: MachineParam[] = [
  { id: 'vdc', label: 'DC supply Vdc', unit: 'V', min: 6, max: 48, step: 1, value: 24 },
  { id: 'duty', label: 'PWM duty d', unit: '', min: 0, max: 1, step: 0.05, value: 0.8 },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 1, step: 0.01, value: 0.15 },
  { id: 'ke', label: 'Back-EMF constant ke (line-to-line)', unit: 'V·s/rad', min: 0.01, max: 0.1, step: 0.005, value: 0.03, level: 'standard' },
  { id: 'rph', label: 'Phase resistance Rph', unit: 'Ω', min: 0.05, max: 2, step: 0.05, value: 0.25, level: 'standard' },
]

export function bldcCalc(p: Record<string, number>): CalcResult[] {
  const r = bldcSixStep({ vdc: p.vdc, duty: p.duty, ke: p.ke, rph: p.rph, tl: p.tl })
  if (!r) return []
  const st = r.stalled
  const fe = electricalFrequency(POLES, r.n)
  return [
    { id: 'v', label: 'Average applied voltage V', value: r.v, unit: 'V', formula: 'V = d · Vdc' },
    { id: 'i', label: 'Current in the two switched phases I', value: r.i, unit: 'A', formula: st ? 'I = V / (2·Rph) (stalled: E = 0)' : 'I = TL / kt,  kt = ke' },
    { id: 'e', label: 'Back EMF E (line-to-line)', value: r.e, unit: 'V', formula: 'E = V − 2·Rph·I = ke · ω' },
    { id: 'n', label: 'Speed n', value: r.n, unit: 'rpm', formula: 'ω = E / ke,  n = 60·ω / 2π', note: st ? 'The load torque is above the stall torque: the motor cannot turn.' : undefined },
    { id: 'n0', label: 'No-load speed', value: r.n0, unit: 'rpm', formula: 'ω0 = V / ke  (TL = 0)' },
    { id: 'ts', label: 'Stall torque', value: r.stallTorque, unit: 'N·m', formula: 'Ts = kt · V / (2·Rph)' },
    { id: 'fe', label: 'Electrical frequency (4 poles, as drawn)', value: fe, unit: 'Hz', formula: 'fe = P · n / 120,  P = 4', note: 'The controller makes 6 commutation steps per electrical cycle: 6·fe steps per second.' },
    { id: 'pin', label: 'Electrical input', value: r.pin, unit: 'W', formula: 'Pin = V · I' },
    { id: 'pout', label: 'Mechanical output', value: r.pout, unit: 'W', formula: 'Pout = TL · ω = E · I' },
    { id: 'pcu', label: 'Copper loss', value: r.pcu, unit: 'W', formula: 'Pcu = I² · 2·Rph' },
    { id: 'eff', label: 'Efficiency (this ideal model)', value: r.eff, unit: '%', formula: 'η = Pout / Pin', note: 'Switch, iron and friction losses are not in this model.' },
  ]
}

export const BLDC_CONTENT: MachineContent = {
  overview: 'A brushless DC (BLDC) motor has its permanent magnets on the rotor and its windings on the stator. Hall sensors tell a controller where the rotor is, and an inverter switches the phase currents in six steps per electrical cycle — electronic commutation instead of brushes. From the DC supply it behaves much like a brushed DC motor.',
  construction: 'Stator: laminated core with 6 teeth, each with a concentrated coil; opposite coils in series make phases A, B, C (star-connected). Rotor: steel hub with 4 surface-mounted arc magnets, alternately N and S. Three Hall sensors on a ring PCB at the rear sense the magnets. Housing, two end caps with ball bearings. An external (or built-in) three-phase inverter and controller are needed to run it.',
  principle: 'The Hall code gives the rotor sector; the controller switches current into one phase and out of another so the stator poles they make lead the rotor magnets by 60–120° electrical. The magnets are pulled forward; when the rotor has turned 60° electrical, the Hall code changes and the next pair is switched. The turning magnets induce a trapezoidal back EMF that, as in a DC motor, limits the current and sets the speed.',
  equations: [
    { expr: 'E = ke · ω', meaning: 'Line-to-line back EMF of the two conducting phases, proportional to speed.' },
    { expr: 'T = kt · I', meaning: 'Torque proportional to the current in the two conducting phases (kt = ke in SI units, ideal trapezoidal EMF).' },
    { expr: 'V = E + 2·Rph · I', meaning: 'Two phases in series between the DC rails (inductance and switch drops neglected).' },
    { expr: 'ω0 = V / ke', meaning: 'No-load speed: the motor speeds up until the back EMF equals the applied voltage.' },
    { expr: 'V = d · Vdc', meaning: 'The controller sets the average voltage by PWM duty d.' },
    { expr: 'fe = P · n / 120', meaning: 'Electrical frequency; 6 commutation steps per electrical cycle.' },
  ],
  assumptions: ['Steady state, ideal 120° block currents (commutation intervals neglected).', 'Ideal trapezoidal back EMF with a 120° flat top; kt = ke (SI units).', 'Ideal switches; inductance, iron loss and friction neglected.', 'The PWM duty sets the average voltage V = d·Vdc.'],
  characteristics: ['Speed proportional to applied voltage at a given load; falls a little with load (the I·2Rph drop).', 'Torque proportional to current; high starting torque, limited by the inverter current.', 'Torque ripple at each commutation step (every 60° electrical).'],
  losses: ['Copper loss I²·2Rph in the stator windings (easy to cool).', 'Iron loss in the stator teeth and yoke, growing with frequency.', 'Inverter switching and conduction losses.', 'Bearing friction and windage; no brush loss.'],
  advantages: ['No brushes: no wear, no sparking, long life, higher speed.', 'Heat produced in the stator — easy to remove.', 'High efficiency and power density.', 'Simple six-step control with three cheap Hall sensors.'],
  limitations: ['Needs an inverter and a controller; it will not run from DC directly.', 'Torque ripple and acoustic noise from six-step commutation.', 'Magnets can be demagnetised by heat or very high current; magnet cost.'],
  applications: ['Drones and RC models', 'Computer and HVAC fans, pumps', 'E-bikes and scooters (hub motors)', 'Power tools, appliances, disk drives'],
  misconceptions: [
    '"Brushless DC" does not mean the windings carry DC: each phase carries alternating blocks of current; only the supply is DC.',
    'The Hall sensors do not supply power — they only tell the controller the rotor sector.',
    'BLDC versus PMSM is about back-EMF shape and drive method, not a hard rule: many "BLDC" motors are driven with sinusoidal field-oriented control, and the names are used loosely by manufacturers.',
  ],
  sources: ['Standard relations for trapezoidal PM brushless motors (e.g. Hendershot & Miller, Design of Brushless Permanent-Magnet Machines; Krishnan, Permanent Magnet Synchronous and Brushless DC Motor Drives).'],
}

export const BLDC_QUIZ: QuizItem[] = [
  { id: 'id-hall', kind: 'identify', prompt: 'What is the highlighted part?', part: 'hall-board', options: ['Hall sensor board', 'Commutator', 'Encoder disc', 'Bearing'], answer: 0, explain: 'The Hall sensor board: three Hall sensors that read the rotor magnets and give the controller the rotor sector.', misconceptions: { 1: 'A BLDC has no commutator: the Hall sensors plus the inverter do its job electronically.' } },
  { id: 'id-magnets', kind: 'identify', prompt: 'What is the highlighted part?', part: 'magnets', options: ['Stator teeth', 'Rotor magnets', 'Phase coils', 'Back iron'], answer: 1, explain: 'The rotor magnets: four surface magnets, alternately N and S. In a BLDC the magnets turn and the windings stay still.' },
  { id: 'predict-next', kind: 'predict', prompt: 'The controller has A+ B− switched on. The rotor turns another 60° electrical and the Hall code changes. Which pair comes next?', options: ['A+ C−', 'B+ C−', 'A− B+', 'All three phases'], answer: 0, explain: 'The sequence is AB → AC → BC → BA → CA → CB: one phase changes at each step. After A+B− the current leaves through C instead of B.', misconceptions: { 2: 'Reversing both phases at once would turn the stator poles by 180° and brake the rotor.', 3: 'In six-step drive only two phases conduct at any time.' } },
  { id: 'predict-duty', kind: 'predict', prompt: 'At the same load, the PWM duty is raised from 0.5 to 0.8. What happens?', options: ['The speed rises; the current stays about the same', 'The current rises; the speed stays the same', 'Both stay the same'], answer: 0, explain: 'The load sets the current (I = TL/kt); the higher average voltage d·Vdc raises the back EMF the motor can reach, and the speed ω = (V − 2Rph·I)/ke rises.' },
  { id: 'order-commutation', kind: 'order', prompt: 'Put the commutation loop in order.', options: ['The rotor magnets pass the Hall sensors', 'The Hall code tells the rotor sector', 'The controller looks up the pair to switch', 'The inverter switches current into two phases', 'The stator poles pull the magnets forward'], answer: 0, explain: 'Position → sector → lookup → switching → torque; then the rotor moves on and the loop repeats every 60° electrical.' },
  { id: 'match-compare', kind: 'match', prompt: 'Which brushed-motor part does the Hall sensor + inverter pair replace?', options: ['The commutator and brushes', 'The permanent magnets', 'The bearings'], answer: 0, explain: 'The commutator and brushes switch the coil currents mechanically from the rotor position; the Hall sensors and the inverter do the same electronically.' },
  { id: 'match-noload', kind: 'match', prompt: 'Which relation gives the no-load speed?', options: ['ω0 = V / ke', 'T = kt · I', 'Ns = 120 f / P'], answer: 0, explain: 'With no load the current is (ideally) zero and the back EMF equals the applied voltage: ke·ω0 = V.' },
]
