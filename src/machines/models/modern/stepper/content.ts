import { stepperMove, stepperRestoringTorque } from '../../../calculations/modern.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Two-phase hybrid stepper (the common 1.8° type): 8 stator poles at k·45° with 5 small teeth each (pitch 7.2°),
 * phase A on poles 0, 2, 4, 6 and B on 1, 3, 5, 7. Rotor: two cups of 50 teeth with an axially magnetised ring
 * magnet between them — front cup N, rear cup S — offset by half a tooth pitch. Full step k (A+, B+, A−, B−) holds
 * at θ = k·1.8°, counter-clockwise seen from the front (tested in tests/machines-modern.test.ts).
 */

export const STEPPER_PARTS: MachinePart[] = [
  { id: 'front-flange', label: 'Front flange', what: 'The square aluminium mounting flange at the shaft end, with the pilot boss and four mounting holes.', function: 'Mounts the motor (a standard square frame size) and holds the front bearing. The scale on it shows the 200 full-step positions.', outer: true, explode: [0, 0, 1.5], stage: 1, anchor: [0.75, 0.75, 0.7], related: ['bearing-front'] },
  { id: 'rear-cap', label: 'Rear end cap', what: 'The square cover at the rear.', function: 'Closes the motor and holds the rear bearing.', outer: true, explode: [0, 0, -1.1], stage: 1, anchor: [-0.75, -0.75, -0.72], related: ['bearing-rear', 'leads'] },
  { id: 'leads', label: 'Phase leads (4 wires)', what: 'Four wires: A+, A−, B+, B−.', function: 'Connect the two phase windings to the stepper driver, which reverses the current in each phase in the step sequence (bipolar drive).', explode: [0, 0, -1.1], stage: 1, anchor: [-0.95, 0.35, -0.75], related: ['phase-a', 'phase-b'] },
  { id: 'stator-core', label: 'Stator core (8 toothed poles)', what: 'A square laminated stack with 8 poles; each pole face has 5 small teeth.', function: 'The pole-face teeth have the same pitch (7.2°) as the rotor teeth. Successive poles are shifted by a quarter tooth pitch relative to the rotor teeth, which is what makes each step 1.8°.', explode: [0, 1.05, 0], stage: 2, anchor: [0.9, 0.55, 0.52], related: ['phase-a', 'phase-b'] },
  { id: 'phase-a', label: 'Phase A coils', what: 'Coils on the 4 poles at 0°, 90°, 180° and 270°, connected in series.', function: 'With A+ current the poles at 0° and 180° become S and those at 90° and 270° N; A− reverses them.', explode: [0, 1.05, 0], stage: 2, anchor: [0.7, -0.1, 0.62], related: ['phase-b', 'stator-core'] },
  { id: 'phase-b', label: 'Phase B coils', what: 'Coils on the 4 poles at 45°, 135°, 225° and 315°.', function: 'The second phase: energised alternately with A, it moves the attracting poles round by 45°, which advances the rotor by a quarter tooth pitch.', explode: [0, 1.05, 0], stage: 2, anchor: [0.5, 0.52, 0.62], related: ['phase-a', 'stator-core'] },
  { id: 'cup-front', label: 'Rotor cup N (50 teeth)', what: 'The front toothed rotor lamination stack, magnetised N by the ring magnet.', function: 'Its teeth are attracted to the S stator poles of the energised phase and line up with their teeth.', explode: [0, 0, 0.65], stage: 3, anchor: [0.3, -0.42, 0.52], related: ['cup-rear', 'magnet'] },
  { id: 'cup-rear', label: 'Rotor cup S (50 teeth)', what: 'The rear toothed stack, magnetised S, its teeth offset by half a tooth pitch (3.6°) from the front cup.', function: 'Its teeth line up with the N stator poles of the energised phase. The half-pitch offset lets both cups pull in the same direction.', explode: [0, 0, -0.65], stage: 3, anchor: [-0.3, 0.42, -0.5], related: ['cup-front', 'magnet'] },
  { id: 'magnet', label: 'Axial ring magnet', what: 'A permanent-magnet ring between the two cups, magnetised along the shaft.', function: 'Makes one cup N and the other S. It is why the motor is a "hybrid" (permanent magnet + variable reluctance teeth), and why it has a small detent torque even with no current.', explode: [0, 0, 0], stage: 3, anchor: [0.3, 0.3, 0.05], related: ['cup-front', 'cup-rear'] },
  { id: 'shaft', label: 'Shaft (with step pointer)', what: 'The steel shaft; a pointer on it reads the step scale on the flange.', function: 'Carries the torque to the load; the pointer shows each 1.8° step.', explode: [0, 0, 0], stage: 3, anchor: [0, 0.15, 1.45], related: ['bearing-front', 'bearing-rear'] },
  { id: 'bearing-front', label: 'Front bearing', what: 'A ball bearing in the front flange.', function: 'Holds the shaft centred: the air gap is only a few hundredths of a millimetre.', explode: [0, 0, 1.15], stage: 1, anchor: [0.22, -0.22, 0.62], related: ['shaft'] },
  { id: 'bearing-rear', label: 'Rear bearing', what: 'A ball bearing in the rear end cap.', function: 'Supports the rear end of the shaft.', explode: [0, 0, -0.85], stage: 1, anchor: [-0.22, 0.22, -0.62], related: ['shaft'] },
]

export const STEPPER_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Energised phase', legend: 'Green outline: the phase switched on for this step (one phase on: wave drive). The chip gives the step number, the state (A+, B+, A−, B−) and the holding angle k·1.8°.', conceptual: true },
  { id: 'field', label: 'Pole polarity', legend: 'N / S on the stator: the polarity of the energised poles now. "N cup" / "S cup": the rotor halves magnetised by the axial magnet. N-cup teeth line up under S poles, S-cup teeth under N poles.', conceptual: true },
  { id: 'torque', label: 'Holding torque', legend: 'Amber arrows: if the load pushes the energised rotor away from its step position, the teeth pull it back (restoring torque, up to the holding torque).', conceptual: true },
  { id: 'rotation', label: 'Step direction', legend: 'White curved arrow: the sequence A+, B+, A−, B− steps the rotor counter-clockwise seen from the front; reversing the sequence reverses it.', conceptual: false },
]

export const STEPPER_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction (hybrid stepper)',
    text: 'This is a two-phase hybrid stepper, the common 1.8° type. The square stator has 8 poles with 5 small teeth on each face; the coils form phases A and B. The rotor is two toothed cups of 50 teeth with an axially magnetised ring magnet between them: one cup is N, the other S, and their teeth are offset by half a tooth.',
    focus: ['stator-core', 'phase-a', 'phase-b', 'cup-front', 'cup-rear', 'magnet'],
    layers: [],
  },
  {
    id: 'teeth',
    title: '2 · Why the teeth make small steps',
    text: 'The stator teeth and rotor teeth have the same pitch, 7.2°. Going round from one pole to the next (45° = 6¼ tooth pitches), the rotor teeth are shifted by a quarter pitch relative to the pole teeth. So when phase A pulls its teeth into line, the teeth under the B poles are a quarter pitch off — and switching to B moves the rotor by exactly that quarter pitch: 1.8°.',
    focus: ['cup-front', 'cup-rear'],
    layers: ['field', 'current'],
    equation: 'step = tooth pitch / 4 = 7.2° / 4 = 1.8°',
    detail: 'In general a two-phase hybrid makes 4·Nr full steps per revolution: 4 × 50 = 200.',
  },
  {
    id: 'sequence',
    title: '3 · Full-step sequence',
    text: 'The driver energises the phases in the order A+, B+, A−, B−, then repeats; each change is one step. The polarity pattern on the stator moves round by 45° each time and the rotor follows by 1.8°. Reversing the order reverses the motor. Energising both phases together (A+B+, A−B+ …) is also a full-step mode, with about 40 % more torque.',
    focus: ['shaft', 'cup-front', 'cup-rear'],
    layers: ['current', 'field', 'rotation'],
    rotate: true,
    equation: 'A+ → B+ → A− → B− → A+ …   (one step each)',
    detail: 'Bipolar drive: each phase current is reversed by an H-bridge. Half-stepping alternates one- and two-phase states (0.9° steps); microstepping sets sine/cosine currents.',
  },
  {
    id: 'angle',
    title: '4 · Step angle and steps to angle',
    text: 'The motor moves a fixed angle per pulse, so position is set by counting pulses — no sensor needed in normal use. 50 steps of 1.8° give 90°; a target that is not a whole number of steps is reached only to the nearest step. Speed is set by the pulse rate.',
    focus: ['shaft', 'front-flange'],
    layers: ['current', 'rotation'],
    rotate: true,
    equation: 'step angle = 360° / steps per rev;   θ = N · step angle',
  },
  {
    id: 'holding',
    title: '5 · Holding torque',
    text: 'With a phase energised and no pulses, the rotor holds its position. Pushed away, the teeth pull it back with a torque that grows with the displacement up to the holding torque at a quarter tooth pitch (1.8°). Pushed beyond half a pitch, it jumps to another stable position — a lost step. With no current only the small detent torque of the magnet remains.',
    focus: ['cup-front', 'cup-rear'],
    layers: ['torque', 'field'],
    equation: 'T ≈ −T_H · sin(Nr · Δθ)',
    detail: 'T_H (holding torque) is a datasheet value; the sine is the first-harmonic approximation of the static torque curve.',
  },
  {
    id: 'open-loop',
    title: '6 · Open loop — and its limits',
    text: 'Counting steps works only if the motor never loses one. At high pulse rates the winding current cannot rise in time and the torque falls; a heavy or sudden load can then make the rotor slip. Microstepping gives finer resolution and smoother motion, but not more accuracy under load. When missed steps are not acceptable, an encoder closes the loop — or a servo is used.',
    focus: ['leads', 'shaft'],
    layers: ['current', 'rotation'],
    rotate: true,
    equation: 'resolution = step angle / microsteps;   n = 60 · f_step · step / 360°',
  },
]

export const STEPPER_PARAMS: MachineParam[] = [
  { id: 'spr', label: 'Full steps per revolution', unit: '', min: 48, max: 400, step: 1, value: 200, options: [48, 200, 400] },
  { id: 'steps', label: 'Steps commanded N', unit: '', min: 0, max: 2000, step: 1, value: 50 },
  { id: 'target', label: 'Target angle', unit: '°', min: 0, max: 360, step: 1, value: 100 },
  { id: 'rate', label: 'Step rate', unit: 'steps/s', min: 0, max: 5000, step: 50, value: 400 },
  { id: 'micro', label: 'Microsteps per full step', unit: '', min: 1, max: 16, step: 1, value: 1, options: [1, 2, 4, 8, 16], level: 'standard' },
  { id: 'th', label: 'Holding torque T_H (datasheet)', unit: 'N·m', min: 0.05, max: 2, step: 0.05, value: 0.4, level: 'engineer' },
  { id: 'disp', label: 'Displacement from the step position Δθ', unit: '°', min: 0, max: 3.6, step: 0.1, value: 0.9, level: 'engineer' },
]

export function stepperCalc(p: Record<string, number>): CalcResult[] {
  const r = stepperMove({ stepsPerRev: p.spr, micro: p.micro, steps: p.steps, target: p.target, rate: p.rate })
  if (!r) return []
  const nr = p.spr / 4 // two-phase hybrid: 4·Nr full steps per revolution
  return [
    { id: 'step', label: 'Full step angle', value: r.full, unit: '°', formula: 'step = 360° / steps per rev', note: p.spr === 200 ? 'The drawn motor: 200 steps (50 rotor teeth).' : undefined },
    { id: 'res', label: 'Resolution (with microstepping)', value: r.res, unit: '°', formula: 'step / microsteps' },
    { id: 'angle', label: 'Angle moved by N steps', value: r.angle, unit: '°', formula: 'θ = N · resolution', note: `${r.revs.toFixed(3)} revolutions.` },
    { id: 'need', label: 'Steps for the target angle', value: r.need, unit: '', formula: 'N = round(θ_target / resolution)' },
    { id: 'err', label: 'Positioning error (rounding)', value: r.error, unit: '°', formula: 'θ_target − N · resolution', note: 'Open loop: assumes no step is lost.' },
    { id: 'speed', label: 'Speed at the step rate', value: r.speedRpm, unit: 'rpm', formula: 'n = 60 · f_step · resolution / 360°' },
    { id: 'tr', label: 'Restoring torque at Δθ', value: Math.abs(stepperRestoringTorque(p.th, nr, p.disp)), unit: 'N·m', formula: '|T| = T_H · |sin(Nr · Δθ)|,  Nr = steps/4', note: 'Two-phase hybrid, first-harmonic approximation; it pulls back towards the step position.' },
  ]
}

export const STEPPER_CONTENT: MachineContent = {
  overview: 'A stepper motor turns by a fixed angle for every pulse the driver gives it, so position can be controlled by counting pulses, without a sensor. This model is a two-phase hybrid stepper (1.8°, 200 steps per revolution), the type in 3D printers and CNC machines.',
  construction: 'Square laminated stator with 8 poles, 5 small teeth on each pole face, coils forming phases A (poles 0°, 90°, 180°, 270°) and B (45°, 135°, 225°, 315°). Rotor: two laminated cups of 50 teeth, an axially magnetised ring magnet between them (front cup N, rear cup S), the cups offset by half a tooth. Square front flange and rear cap with bearings; four leads.',
  principle: 'An energised phase makes its poles N and S; the N-cup teeth line up under the S poles and the S-cup teeth under the N poles. Because successive poles are offset by a quarter tooth pitch from the rotor teeth, changing the energised phase in the sequence A+, B+, A−, B− moves the rotor by a quarter tooth pitch each time: 1.8°.',
  equations: [
    { expr: 'step angle = 360° / steps per revolution', meaning: '1.8° for 200 steps/rev.' },
    { expr: 'steps per rev = 4 · Nr', meaning: 'Two-phase hybrid with Nr rotor teeth (full steps).' },
    { expr: 'θ = N · step angle', meaning: 'Open-loop position after N steps (no lost steps).' },
    { expr: 'n = 60 · f_step · step angle / 360°', meaning: 'Speed from the step rate.' },
    { expr: 'T ≈ −T_H · sin(Nr · Δθ)', meaning: 'Static restoring torque around a step position; T_H = holding torque.' },
  ],
  assumptions: ['Ideal steps: the rotor reaches each step position (no lost steps, no overshoot).', 'One phase on at a time (wave drive) in the animation.', 'First-harmonic static torque curve.', 'The holding torque is a datasheet value, not calculated.'],
  characteristics: ['Position set by pulse count, speed by pulse rate.', 'Highest torque at standstill (holding torque); torque falls as the step rate rises.', 'Resonance and vibration at some step rates, reduced by microstepping.'],
  losses: ['Copper loss — present even at standstill, because the holding current flows.', 'Iron loss in the toothed laminations, rising with step rate.', 'Driver losses.'],
  advantages: ['Simple open-loop positioning, no sensor.', 'High holding torque at standstill.', 'Robust, cheap, brushless.'],
  limitations: ['Steps can be lost under overload — and the controller will not know without a sensor.', 'Low efficiency; heats up even when holding.', 'Torque falls quickly with speed; vibration and noise.'],
  applications: ['3D printers and CNC axes', 'Printers and scanners', 'Camera lens and valve positioning', 'Laboratory automation'],
  misconceptions: [
    'Microstepping improves resolution and smoothness, not the accuracy under load: the rotor still lags its commanded position when loaded.',
    'A stepper is not always open loop: "closed-loop steppers" add an encoder, much like a servo.',
    'The holding torque is not the torque available while moving fast — it falls with step rate.',
  ],
  sources: ['Standard stepper motor theory (e.g. Acarnley, Stepping Motors: a Guide to Theory and Practice; Kenjo & Sugawara).'],
}

export const STEPPER_QUIZ: QuizItem[] = [
  { id: 'id-magnet', kind: 'identify', prompt: 'What is the highlighted part?', part: 'magnet', options: ['Axial ring magnet', 'Bearing', 'Rotor cup', 'Encoder'], answer: 0, explain: 'The axially magnetised ring magnet makes one rotor cup N and the other S — the "hybrid" in hybrid stepper.' },
  { id: 'id-cup', kind: 'identify', prompt: 'What is the highlighted part?', part: 'cup-rear', options: ['A rotor cup (toothed, 50 teeth)', 'A stator pole', 'The commutator', 'A gear'], answer: 0, explain: 'One of the two toothed rotor cups; its teeth are offset by half a pitch from the other cup.', misconceptions: { 3: 'The teeth are magnetic, not mechanical: they never mesh with anything.' } },
  { id: 'predict-angle', kind: 'predict', prompt: 'A 200-step motor receives 150 full-step pulses. How far does it turn?', options: ['270°', '150°', '300°', '27°'], answer: 0, explain: '150 × 1.8° = 270° (assuming no lost steps).' },
  { id: 'predict-next', kind: 'predict', prompt: 'The driver has phase B+ energised. What is the next full step in the forward sequence?', options: ['A−', 'A+', 'B−'], answer: 0, explain: 'The sequence is A+, B+, A−, B−: after B+ comes A−.', misconceptions: { 1: 'A+ comes before B+ — that would step backwards.' } },
  { id: 'order-sequence', kind: 'order', prompt: 'Put one electrical cycle of full steps in order, starting from A+.', options: ['A+', 'B+', 'A−', 'B−'], answer: 0, explain: 'Each phase is reversed every other step; four steps make one electrical cycle and move the rotor one tooth pitch (7.2°).' },
  { id: 'match-step', kind: 'match', prompt: 'Which relation gives the step angle?', options: ['360° / steps per revolution', '120 · f / P', '360° / (Nph · Nr) for a 6/4 SRM only'], answer: 0, explain: 'The step angle is one revolution divided by the number of full steps per revolution.' },
]
