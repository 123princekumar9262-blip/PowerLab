import { srmPhaseFrequency, srmStroke, srmTorque } from '../../../calculations/modern.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * 6/4 switched reluctance motor: 6 salient stator poles (phases A, B, C at 0°/180°, 60°/240°, 120°/300°), 4 salient
 * rotor poles of plain laminated iron. The rotor turns clockwise seen from the front while the excitation steps
 * A → B → C counter-clockwise round the stator (the 6/4 rotor turns against the excitation sequence).
 */

export const SRM_PARTS: MachinePart[] = [
  { id: 'housing', label: 'Housing', what: 'The steel outer frame.', function: 'Holds the stator stack and carries its heat away.', outer: true, explode: [0, -1.2, 0], stage: 2, anchor: [0, -1.2, 0.3], related: ['stator-core'] },
  { id: 'end-cap-front', label: 'Front end cap', what: 'The cover at the drive end.', function: 'Closes the motor and holds the front bearing.', outer: true, explode: [0, 0, 1.4], stage: 1, anchor: [0.78, 0.78, 0.92], related: ['bearing-front'] },
  { id: 'end-cap-rear', label: 'Rear end cap', what: 'The cover at the rear.', function: 'Closes the motor, holds the rear bearing and covers the position sensor.', outer: true, explode: [0, 0, -1.3], stage: 1, anchor: [-0.78, -0.78, -0.92], related: ['bearing-rear', 'position-sensor'] },
  { id: 'stator-core', label: 'Stator core (6 salient poles)', what: 'A laminated steel stack with 6 projecting poles.', function: 'Each pole pair becomes an electromagnet when its phase is energised; the laminations carry the switched flux with little eddy-current loss.', explode: [0, 1.2, 0], stage: 4, anchor: [0.95, 0.55, 0.56], related: ['phase-a', 'phase-b', 'phase-c'] },
  { id: 'phase-a', label: 'Phase A coils', what: 'Two coils on the opposite poles at 0° and 180°, in series.', function: 'When phase A is switched on, its two poles become N and S and pull the nearest rotor poles into line with them.', explode: [0, 0, 1.25], stage: 3, anchor: [0.78, -0.12, 0.7], related: ['phase-b', 'phase-c', 'stator-core'] },
  { id: 'phase-b', label: 'Phase B coils', what: 'Two coils on the poles at 60° and 240°.', function: 'Phase B pulls the rotor when the rotor poles approach the 60° / 240° poles.', explode: [0, 0, 1.25], stage: 3, anchor: [0.42, 0.66, 0.7], related: ['phase-a', 'phase-c'] },
  { id: 'phase-c', label: 'Phase C coils', what: 'Two coils on the poles at 120° and 300°.', function: 'Phase C pulls the rotor when the rotor poles approach the 120° / 300° poles.', explode: [0, 0, 1.25], stage: 3, anchor: [-0.42, 0.66, 0.7], related: ['phase-a', 'phase-b'] },
  { id: 'rotor', label: 'Rotor (4 salient poles, plain iron)', what: 'A laminated steel rotor with 4 projecting poles — no magnets, no winding, no bars.', function: 'Its poles are pulled into line with the energised stator poles, the position of least reluctance. Simple, robust and cheap; it tolerates high speed and temperature.', explode: [0, 0, 0], stage: 4, anchor: [-0.28, -0.32, 0.6], related: ['shaft', 'stator-core'] },
  { id: 'shaft', label: 'Shaft', what: 'The steel shaft through the rotor.', function: 'Carries the torque to the load.', explode: [0, 0, 0], stage: 4, anchor: [0, 0.15, 1.62], related: ['bearing-front', 'position-sensor'] },
  { id: 'position-sensor', label: 'Rotor position sensor', what: 'A slotted vane disc on the shaft and three optical interrupters on a bracket.', function: 'Tells the converter where the rotor poles are, so each phase is switched on while its inductance is rising and off before the poles align.', explode: [0, 0, -0.6], stage: 2, anchor: [0.5, -0.5, -0.82], related: ['shaft', 'rotor'] },
  { id: 'bearing-front', label: 'Front bearing', what: 'A ball bearing in the front end cap.', function: 'Holds the shaft centred and lets it turn with little friction.', explode: [0, 0, 1.0], stage: 1, anchor: [0.22, -0.22, 0.86], related: ['shaft'] },
  { id: 'bearing-rear', label: 'Rear bearing', what: 'A ball bearing in the rear end cap.', function: 'Supports the rear end of the shaft.', explode: [0, 0, -1.05], stage: 1, anchor: [-0.22, 0.22, -0.86], related: ['shaft'] },
]

export const SRM_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Energised phase', legend: 'Green outline: the one phase switched on now (unipolar current — its direction does not matter for the torque). The chip names it, worked out from the drawn rotor angle with the ideal switching rule.', conceptual: true },
  { id: 'flux', label: 'Flux path', legend: 'Blue dashed lines: the flux of the energised phase — out of one stator pole, across the air gap into the nearest rotor pole, through the rotor, out of the opposite rotor pole, into the opposite stator pole, and back round the stator yoke. N / S: the poles the phase makes.', conceptual: true },
  { id: 'torque', label: 'Reluctance torque', legend: 'Amber arrows: the pull on the approaching rotor pole towards alignment with the energised stator pole (clockwise here) and the resulting torque.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the rotor turns clockwise seen from the front — against the A → B → C excitation sequence, which steps counter-clockwise.', conceptual: false },
]

export const SRM_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'Both parts are salient (they have projecting poles). The stator has 6 poles, each with a coil; opposite coils form one phase, so there are 3 phases A, B, C. The rotor has 4 poles and is only laminated iron: no magnets, no winding, no cage. That is a "6/4" switched reluctance motor.',
    focus: ['stator-core', 'phase-a', 'phase-b', 'phase-c', 'rotor'],
    layers: [],
  },
  {
    id: 'pull',
    title: '2 · An energised phase pulls the nearest rotor pole into line',
    text: 'Switch on one phase — A in the picture: its two poles become N and S, and flux tries to cross the air gap. The path is easiest (least reluctance) when a rotor pole is exactly lined up with each stator pole, so the iron rotor is pulled towards that position — like a nail drawn to a magnet. Once aligned, the force is purely radial: no more torque.',
    focus: ['rotor'],
    layers: ['current', 'flux', 'torque'],
    equation: 'T = ½ · i² · dL/dθ',
    detail: 'Linear magnetics: the phase inductance L rises from Lu (unaligned) to La (aligned) as the poles overlap; torque exists only while L changes, and its sign depends on dL/dθ, not on the current direction.',
  },
  {
    id: 'sequence',
    title: '3 · Switch the phases in sequence',
    text: 'Before the rotor poles reach alignment with A, A is switched off and the next phase is switched on — the one whose poles the rotor is now approaching. Repeating this A → B → C keeps the rotor turning. In this 6/4 motor the rotor turns clockwise while the excitation steps counter-clockwise around the stator: the rotor moves 30° for each 60° step of the excitation, the other way.',
    focus: ['rotor'],
    layers: ['current', 'flux', 'rotation'],
    rotate: true,
    equation: 'ε = 360° / (Nph · Nr) = 360° / (3 · 4) = 30°',
    detail: 'Each phase is energised once per rotor pole pitch (90°), so it switches at n·Nr/60 times per second; there are Nph·Nr = 12 strokes per revolution.',
  },
  {
    id: 'torque',
    title: '4 · Torque and torque ripple',
    text: 'Torque comes only from the change of inductance with angle, so it does not depend on the current direction: the converter needs only unipolar current. As each phase hands over to the next, the torque dips: SRMs have more torque ripple and acoustic noise than PM motors unless the currents are carefully shaped.',
    focus: ['rotor'],
    layers: ['torque', 'current', 'rotation'],
    rotate: true,
    equation: 'T = ½ · i² · (La − Lu) / β   (linear rise over β)',
    detail: 'With saturation (the normal operating case) the torque is the rate of change of co-energy with angle; the linear formula gives only the idea.',
  },
  {
    id: 'position',
    title: '5 · The converter needs the rotor position',
    text: 'To switch each phase on while its inductance rises — and off before alignment, so the current has decayed — the controller must know where the rotor poles are. Here a slotted vane disc and optical sensors give it; sensorless schemes estimate it from the phase inductance.',
    focus: ['position-sensor', 'shaft'],
    layers: ['current', 'rotation'],
    rotate: true,
    equation: 'f_phase = n · Nr / 60',
    detail: 'Each phase is driven by an asymmetric half-bridge (two switches, two diodes): the diodes return the stored magnetic energy to the DC link when the phase is switched off.',
  },
  {
    id: 'compare',
    title: '6 · Why choose an SRM?',
    text: 'The rotor is just iron: it is cheap, very robust, tolerant of heat and high speed, and has no magnets that could be demagnetised or that make a back EMF when it spins freely. The price is torque ripple, noise, a special converter and the need for position information.',
    focus: ['rotor', 'stator-core'],
    layers: ['rotation'],
    rotate: true,
    equation: 'no magnets · no rotor winding · unipolar phase currents',
  },
]

export const SRM_PARAMS: MachineParam[] = [
  { id: 'nph', label: 'Number of phases Nph', unit: '', min: 3, max: 5, step: 1, value: 3, options: [3, 4, 5] },
  { id: 'nr', label: 'Rotor poles Nr', unit: '', min: 4, max: 10, step: 2, value: 4, options: [4, 6, 8, 10] },
  { id: 'n', label: 'Speed n', unit: 'rpm', min: 0, max: 6000, step: 100, value: 1500 },
  { id: 'i', label: 'Phase current i', unit: 'A', min: 0, max: 30, step: 1, value: 10, level: 'standard' },
  { id: 'la', label: 'Aligned inductance La', unit: 'mH', min: 2, max: 50, step: 1, value: 12, level: 'engineer' },
  { id: 'lu', label: 'Unaligned inductance Lu', unit: 'mH', min: 0.5, max: 10, step: 0.5, value: 2, level: 'engineer' },
  { id: 'beta', label: 'Angle of the inductance rise β', unit: '°', min: 5, max: 45, step: 1, value: 30, level: 'engineer' },
]

export function srmCalc(p: Record<string, number>): CalcResult[] {
  const st = srmStroke(p.nph, p.nr)
  const bad = 'Nr is a multiple of Nph: all phases would align at once — not a working SRM.'
  const fph = st ? srmPhaseFrequency(p.n, p.nr) : null
  const t = srmTorque(p.i, p.la / 1000, p.lu / 1000, p.beta)
  return [
    { id: 'stroke', label: 'Stroke (step) angle ε', value: st?.stroke ?? null, unit: '°', formula: 'ε = 360° / (Nph · Nr)', note: st ? (p.nph === 3 && p.nr === 4 ? 'The drawn 6/4 motor: 30°.' : 'The model is drawn as a 6/4 (3-phase, 4 rotor poles) motor.') : bad },
    { id: 'strokes', label: 'Strokes per revolution', value: st?.strokesPerRev ?? null, unit: '', formula: 'Nph · Nr' },
    { id: 'pitch', label: 'Rotor pole pitch', value: st?.rotorPitch ?? null, unit: '°', formula: '360° / Nr' },
    { id: 'fph', label: 'Switching frequency of each phase', value: fph, unit: 'Hz', formula: 'f_ph = n · Nr / 60', note: 'Each phase is switched on once per rotor pole passing.' },
    { id: 'fstroke', label: 'Stroke rate', value: fph !== null && st ? fph * p.nph : null, unit: '1/s', formula: 'Nph · f_ph' },
    { id: 'dl', label: 'Inductance slope dL/dθ', value: t?.dLdTheta ?? null, unit: 'H/rad', formula: 'dL/dθ = (La − Lu) / β', note: t ? undefined : 'Needs La ≥ Lu.' },
    { id: 'torque', label: 'Torque of one phase (linear, unsaturated)', value: t?.torque ?? null, unit: 'N·m', formula: 'T = ½ · i² · dL/dθ', note: 'Only while the inductance rises; saturation lowers it in practice.' },
  ]
}

export const SRM_CONTENT: MachineContent = {
  overview: 'A switched reluctance motor (SRM) has salient poles on both the stator and the rotor, coils only on the stator, and a rotor of plain laminated iron. Switching the stator phases on in sequence pulls the nearest rotor poles into alignment, one stroke after another. It needs a converter and the rotor position.',
  construction: 'Stator: laminated core with 6 salient poles; a concentrated coil on each, opposite coils in series → 3 phases. Rotor: laminated core with 4 salient poles, nothing else. Position sensor (slotted disc + optical interrupters) at the rear; housing, end caps, bearings. Converter: an asymmetric half-bridge per phase (not drawn).',
  principle: 'An energised phase magnetises its pole pair; the magnetic circuit tends to the position of minimum reluctance (maximum inductance), so the nearest rotor poles are pulled into line. Switching the next phase on before alignment keeps the rotor moving. Torque T = ½·i²·dL/dθ depends on the change of inductance with angle, not on the current direction.',
  equations: [
    { expr: 'ε = 360° / (Nph · Nr)', meaning: 'Stroke angle: how far the rotor turns per phase switching (30° for 6/4).' },
    { expr: 'T = ½ · i² · dL/dθ', meaning: 'Reluctance torque of one phase, linear magnetics (no saturation).' },
    { expr: 'f_ph = n · Nr / 60', meaning: 'Switching frequency of each phase (once per rotor pole passing).' },
    { expr: 'strokes/rev = Nph · Nr', meaning: '12 for the 6/4 motor.' },
  ],
  assumptions: ['Ideal switching: one phase on at a time, flat current while on.', 'Linear magnetics for the torque formula (no saturation, no fringing).', 'Inductance rises linearly from Lu to La over the angle β.', 'Mutual coupling between phases neglected.'],
  characteristics: ['Speed set by the switching rate (synchronised with the rotor through the position sensor).', 'High torque at low speed; constant-power range at high speed.', 'Torque ripple and acoustic noise at the phase hand-overs.'],
  losses: ['Copper loss in the stator coils.', 'Iron loss — high, because the flux is switched in pulses.', 'Converter losses; windage at high speed.'],
  advantages: ['No magnets and no rotor winding: cheap, robust, high temperature and high speed.', 'Fault tolerant: phases are independent; no back EMF when unexcited.', 'Unipolar converter, no shoot-through risk in the phase leg.'],
  limitations: ['Torque ripple and acoustic noise.', 'Needs rotor position and a special converter.', 'Very small air gap needed for good torque; lower power factor of the converter VA.'],
  applications: ['Vacuum cleaners and fans (high speed)', 'Industrial drives, pumps, mining', 'Some traction and aerospace starter-generators'],
  misconceptions: [
    'An SRM is not an induction motor with salient poles: there are no rotor currents at all — the torque is purely reluctance torque.',
    'The current direction does not matter for the torque (i² in the formula): a reversed current pulls the same way.',
    'The rotor does not always turn the same way as the excitation sequence: in a 6/4 motor it turns the opposite way.',
  ],
  sources: ['Standard SRM theory (e.g. Miller, Switched Reluctance Motors and their Control; Krishnan, Switched Reluctance Motor Drives).'],
}

export const SRM_QUIZ: QuizItem[] = [
  { id: 'id-rotor', kind: 'identify', prompt: 'What is the highlighted part?', part: 'rotor', options: ['A permanent-magnet rotor', 'A salient iron rotor', 'A squirrel-cage rotor', 'A wound rotor'], answer: 1, explain: 'The SRM rotor is plain laminated iron with salient poles — no magnets, no winding, no bars.', misconceptions: { 2: 'A cage has bars and end rings carrying induced currents; the SRM rotor carries no current at all.' } },
  { id: 'id-sensor', kind: 'identify', prompt: 'What is the highlighted part?', part: 'position-sensor', options: ['Rotor position sensor', 'Commutator', 'Cooling fan', 'Slip rings'], answer: 0, explain: 'A slotted vane disc with optical interrupters: it tells the converter where the rotor poles are, so each phase is switched at the right angle.' },
  { id: 'predict-stroke', kind: 'predict', prompt: 'An 8/6 SRM has 4 phases and 6 rotor poles. What is its stroke angle?', options: ['15°', '30°', '60°', '7.5°'], answer: 0, explain: 'ε = 360° / (Nph·Nr) = 360° / (4·6) = 15°: 24 strokes per revolution.', misconceptions: { 1: '30° is the 6/4 motor (3 · 4 = 12 strokes).' } },
  { id: 'predict-reverse', kind: 'predict', prompt: 'The phase current in an SRM is reversed (same switching angles). What happens to the torque?', options: ['It stays the same', 'It reverses', 'It becomes zero'], answer: 0, explain: 'T = ½·i²·dL/dθ: the current is squared, so its direction does not matter. To reverse the motor, change the switching sequence instead.', misconceptions: { 1: 'That is true for a DC or PM motor, where torque is proportional to the current itself.' } },
  { id: 'order-cycle', kind: 'order', prompt: 'Put one stroke of a phase in order.', options: ['A rotor pole approaches the phase poles', 'The phase is switched on (inductance rising)', 'The pull turns the rotor towards alignment', 'The phase is switched off before alignment', 'The next phase takes over'], answer: 0, explain: 'Each phase works only while the inductance rises; it is switched off before alignment so its current has gone before the inductance falls (which would brake).' },
  { id: 'match-torque', kind: 'match', prompt: 'Which relation gives the SRM torque (linear magnetics)?', options: ['T = ½ · i² · dL/dθ', 'T = 1.5 · p · ψ · iq', 'T = kt · I'], answer: 0, explain: 'Reluctance torque: it comes from the change of inductance with rotor angle. The others are the PMSM and BLDC magnet-torque relations.' },
]
