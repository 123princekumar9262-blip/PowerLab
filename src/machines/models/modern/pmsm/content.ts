import { pmsmSteady } from '../../../calculations/modern.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Interior-magnet PMSM (IPM), 4 poles, 24 slots, distributed single-layer full-pitch winding (q = 2 slots per pole
 * per phase). Phase belts counter-clockwise: A, −C, B, −A, C, −B (30° mechanical = 60° electrical each), repeated.
 * Rotor N poles (d axis) at 0° and 180° mechanical at rotor angle 0. Rotation counter-clockwise from the front.
 * Currents: id = 0, so the stator current vector is on the q axis, 90° electrical ahead of the d axis.
 */

export const PMSM_PARTS: MachinePart[] = [
  { id: 'housing', label: 'Finned housing', what: 'The aluminium frame with cooling fins.', function: 'Holds the stator core and carries the stator losses (copper and iron) out to the air through the fins.', outer: true, explode: [0, -1.35, 0], stage: 2, anchor: [0, -1.33, 0.2], related: ['stator-core', 'terminal-box'] },
  { id: 'terminal-box', label: 'Terminal box', what: 'The box on the housing with the three phase terminals U, V, W.', function: 'Connects the three stator phases to the inverter cable.', outer: true, explode: [0, 0.3, 1.5], stage: 1, anchor: [0, 1.52, 0.2], related: ['stator-winding'] },
  { id: 'end-cap-front', label: 'Front end shield', what: 'The cover at the drive end.', function: 'Closes the motor and holds the front bearing.', outer: true, explode: [0, 0, 1.3], stage: 1, anchor: [0.8, 0.8, 0.98], related: ['bearing-front'] },
  { id: 'end-cap-rear', label: 'Rear end shield', what: 'The cover at the non-drive end.', function: 'Closes the motor, holds the rear bearing and the resolver stator.', outer: true, explode: [0, 0, -1.3], stage: 1, anchor: [-0.8, -0.8, -0.98], related: ['bearing-rear', 'resolver'] },
  { id: 'stator-core', label: 'Stator core (24 slots)', what: 'A stack of thin insulated steel laminations with 24 slots.', function: 'Carries the rotating flux with little reluctance and holds the winding. Laminated because its flux alternates at the electrical frequency.', explode: [0, 1.35, 0], stage: 4, anchor: [1.0, 0.45, 0.62], related: ['stator-winding', 'housing'] },
  { id: 'stator-winding', label: 'Distributed three-phase winding', what: 'Copper coils spread over many slots: each phase occupies 2 adjacent slots per pole (phase belts A, −C, B, −A, C, −B).', function: 'Spreading each phase over several slots makes its magnetic field around the air gap close to a sine wave. Fed with three sinusoidal currents 120° apart, the three phases make a smoothly rotating field.', explode: [0, 0, 1.1], stage: 3, anchor: [-0.75, 0.62, 0.86], related: ['stator-core', 'terminal-box'] },
  { id: 'rotor-core', label: 'Rotor core (laminated)', what: 'A laminated rotor with four pockets just under its surface.', function: 'Holds the magnets inside the iron (interior magnets) and guides their flux. The iron between magnet and air gap also gives a reluctance torque when id ≠ 0.', explode: [0, 0, 0], stage: 4, anchor: [-0.38, -0.5, 0.62], related: ['magnets', 'shaft'] },
  { id: 'magnets', label: 'Interior magnets (4 poles)', what: 'Four flat magnet bars buried in the rotor pockets, alternately N and S outwards.', function: 'Make the rotor field (flux linkage ψ). Buried magnets are held mechanically by the iron (good at high speed) and are better protected against demagnetisation.', explode: [0, 0, 0], stage: 4, anchor: [0.5, 0, 0.66], related: ['rotor-core'] },
  { id: 'shaft', label: 'Shaft', what: 'The steel shaft through the rotor.', function: 'Carries the torque to the load.', explode: [0, 0, 0], stage: 4, anchor: [0, 0.16, 1.62], related: ['bearing-front', 'resolver'] },
  { id: 'resolver', label: 'Resolver (position sensor)', what: 'A small rotary transformer at the rear: a shaped iron rotor on the shaft inside a wound stator.', function: 'Measures the rotor angle continuously (sine and cosine signals). Field-oriented control needs this angle to place the current on the q axis at every instant.', explode: [0, 0, -0.75], stage: 2, anchor: [0.35, -0.35, -0.95], related: ['shaft', 'magnets'] },
  { id: 'bearing-front', label: 'Front bearing', what: 'A ball bearing in the front end shield.', function: 'Holds the shaft centred and lets it turn with little friction.', explode: [0, 0, 1.0], stage: 1, anchor: [0.24, -0.24, 0.9], related: ['shaft'] },
  { id: 'bearing-rear', label: 'Rear bearing', what: 'A ball bearing in the rear end shield.', function: 'Supports the rear end of the shaft.', explode: [0, 0, -1.15], stage: 1, anchor: [-0.24, 0.24, -1.2], related: ['shaft'] },
]

export const PMSM_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Phase currents', legend: 'Green ⊙ = current out of the screen, ⊗ = into the screen, in each phase belt at this instant (a belt with nearly zero current is left blank). Chart: the three sinusoidal phase currents ia, ib, ic; the cursor is the drawn rotor angle.', conceptual: true },
  { id: 'field', label: 'Rotor poles and d axis', legend: 'Red N / blue S: the rotor magnet poles, turning with the rotor. Blue arrow "d": the direct axis, along a magnet N pole.', conceptual: true },
  { id: 'rotatingField', label: 'Stator field and q axis', legend: 'Light-blue N / S at the bore: the poles of the stator field made by the three currents; they turn with the rotor (synchronous). Amber arrow "q": the quadrature axis, 90° electrical ahead of d — with id = 0 the stator current vector lies on it.', conceptual: true },
  { id: 'torque', label: 'Torque', legend: 'Amber curved arrow: the electromagnetic torque, counter-clockwise seen from the front (T = 1.5·p·ψ·iq).', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the rotor turns counter-clockwise seen from the front, at synchronous speed.', conceptual: false },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: AC power in at the terminals → air-gap power → mechanical power at the shaft; stator copper and iron losses become heat in the housing.', conceptual: true },
]

export const PMSM_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The stator looks like an induction motor stator: a laminated core with 24 slots and a distributed three-phase winding — each phase spread over 2 slots per pole. The rotor is laminated steel with four flat magnets buried just under its surface: an interior-magnet (IPM) rotor, 4 poles. A resolver at the rear measures the rotor angle.',
    focus: ['stator-core', 'stator-winding', 'rotor-core', 'magnets', 'resolver'],
    layers: [],
  },
  {
    id: 'currents',
    title: '2 · Sinusoidal phase currents',
    text: 'The inverter feeds the three phases with sinusoidal currents of equal amplitude, 120° electrical apart. At every instant they add up to zero. The pattern of current out (⊙) and in (⊗) around the stator is itself close to a sine wave in space, and it moves round as the currents change.',
    focus: ['stator-winding'],
    layers: ['current'],
    rotate: true,
    equation: 'ia = I·cos(θ),  ib = I·cos(θ − 120°),  ic = I·cos(θ + 120°)',
    detail: 'The distributed winding (several slots per pole per phase) is what makes the stator field nearly sinusoidal around the air gap; the matching sinusoidal back EMF makes the torque smooth with sinusoidal currents.',
  },
  {
    id: 'sync',
    title: '3 · A field that rotates with the rotor',
    text: 'The three sinusoidal currents make a stator field that rotates at the synchronous speed. The rotor magnets lock to it: the rotor turns at exactly the same speed — no slip, unlike an induction motor. The stator field poles and the rotor poles turn together.',
    focus: ['stator-winding', 'magnets'],
    layers: ['field', 'rotatingField', 'rotation'],
    rotate: true,
    equation: 'Ns = 120 · f / P',
    detail: 'With 4 poles the field makes one turn every 2 electrical cycles: 100 Hz gives 3000 rpm. The rotor follows exactly; only the angle between the fields changes with load.',
  },
  {
    id: 'dq',
    title: '4 · The d–q idea',
    text: 'Look from the rotor: the d (direct) axis points along a magnet N pole, the q (quadrature) axis is 90° electrical ahead. Seen from the rotor, the three AC currents become two steady values: id along d (it acts on the flux) and iq along q (it makes torque). The controller keeps id = 0 here, so all the current is torque-producing.',
    focus: ['magnets', 'rotor-core'],
    layers: ['field', 'rotatingField'],
    rotate: true,
    equation: 'id = 0,   iq = I   (rotor reference frame)',
    detail: 'Park transform: [id, iq] from [ia, ib, ic] and the rotor angle θe. Negative id (field weakening) reduces the voltage at high speed; with an IPM rotor (Ld < Lq) it also adds reluctance torque 1.5·p·(Ld − Lq)·id·iq.',
  },
  {
    id: 'torque',
    title: '5 · Torque from iq',
    text: 'The stator S pole sits 90° electrical ahead of each rotor N pole and pulls it forward; the stator N pole behind pushes it. With the current on the q axis this angle stays at 90°, the best angle for magnet torque, and the torque is smooth and proportional to iq.',
    focus: ['magnets', 'stator-winding'],
    layers: ['field', 'rotatingField', 'torque'],
    rotate: true,
    equation: 'T = 1.5 · p · ψ · iq    (id = 0, p = P/2 pole pairs)',
    detail: 'ψ is the peak magnet flux linkage per phase; the 1.5 comes from the amplitude-invariant d–q transform (three phases, peak values).',
  },
  {
    id: 'foc',
    title: '6 · Field-oriented control needs the rotor position',
    text: 'To keep the current on the q axis, the controller must know the rotor angle at every instant — here from the resolver (an encoder is also common). It measures two phase currents, transforms them to id and iq with that angle, regulates both with PI controllers and transforms the result back into three-phase voltages. Sensorless schemes estimate the angle instead.',
    focus: ['resolver', 'shaft'],
    layers: ['rotatingField', 'rotation'],
    rotate: true,
    equation: 'θe = p · θm  →  Park: (ia, ib, ic) → (id, iq)',
    detail: 'BLDC versus PMSM is not decided by the name alone: a "BLDC" motor can be run with FOC, and a PMSM with six-step; what differs is the back-EMF shape the design aims for and the drive used.',
  },
  {
    id: 'energy',
    title: '7 · Energy conversion',
    text: 'The inverter delivers three-phase power to the stator. With id = 0 the power converted is the q-axis back EMF times iq; part of the input is lost in the stator copper (and iron). The rotor has no winding and no induced currents in steady state, so it stays cool — one reason PMSMs are so efficient.',
    focus: ['stator-winding', 'shaft'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'Pin = 1.5·vq·iq = 1.5·Rs·iq² + T·ωm',
  },
]

export const PMSM_PARAMS: MachineParam[] = [
  { id: 'f', label: 'Supply frequency f', unit: 'Hz', min: 0, max: 400, step: 5, value: 100 },
  { id: 'iq', label: 'q-axis current iq (peak)', unit: 'A', min: 0, max: 60, step: 1, value: 20 },
  { id: 'poles', label: 'Number of poles P', unit: '', min: 2, max: 8, step: 2, value: 4, options: [2, 4, 6, 8], level: 'standard' },
  { id: 'psi', label: 'Magnet flux linkage ψ (peak)', unit: 'Wb', min: 0.01, max: 0.2, step: 0.005, value: 0.05, level: 'standard' },
  { id: 'rs', label: 'Stator resistance Rs', unit: 'Ω', min: 0.01, max: 1, step: 0.01, value: 0.1, level: 'engineer' },
  { id: 'lq', label: 'q-axis inductance Lq', unit: 'H', min: 0.0001, max: 0.005, step: 0.0001, value: 0.0005, level: 'engineer' },
]

export function pmsmCalc(p: Record<string, number>): CalcResult[] {
  const r = pmsmSteady({ f: p.f, poles: p.poles, psi: p.psi, iq: p.iq, rs: p.rs, lq: p.lq })
  if (!r) return []
  return [
    { id: 'ns', label: 'Synchronous speed Ns', value: r.ns, unit: 'rpm', formula: 'Ns = 120 · f / P', note: p.poles !== 4 ? 'The model is drawn with 4 poles.' : undefined },
    { id: 'torque', label: 'Torque T', value: r.torque, unit: 'N·m', formula: 'T = 1.5 · p · ψ · iq,  p = P/2,  id = 0' },
    { id: 'pmech', label: 'Mechanical power', value: r.pmech, unit: 'W', formula: 'Pmech = T · ωm,  ωm = 2π·Ns/60' },
    { id: 'emf', label: 'Back EMF per phase (peak)', value: r.emfPeak, unit: 'V', formula: 'E = ωe · ψ,  ωe = 2π·f', note: `RMS ${r.emfRms.toFixed(1)} V` },
    { id: 'vq', label: 'q-axis voltage vq', value: r.vq, unit: 'V', formula: 'vq = Rs·iq + ωe·ψ' },
    { id: 'vd', label: 'd-axis voltage vd', value: r.vd, unit: 'V', formula: 'vd = −ωe·Lq·iq  (id = 0)' },
    { id: 'vmag', label: 'Phase voltage needed (peak)', value: r.vmag, unit: 'V', formula: '|v| = √(vd² + vq²)', note: 'The inverter can give at most about Vdc/√3 (peak phase) in its linear range.' },
    { id: 'pcu', label: 'Stator copper loss', value: r.pcu, unit: 'W', formula: 'Pcu = 1.5 · Rs · iq²' },
    { id: 'pin', label: 'Electrical input', value: r.pin, unit: 'W', formula: 'Pin = 1.5 · (vd·id + vq·iq) = Pcu + Pmech' },
    { id: 'eff', label: 'Efficiency (this ideal model)', value: r.eff, unit: '%', formula: 'η = Pmech / Pin', note: 'Iron, inverter and friction losses are not in this model.' },
  ]
}

export const PMSM_CONTENT: MachineContent = {
  overview: 'A permanent-magnet synchronous motor (PMSM) has a three-phase distributed stator winding, like an induction motor, and a rotor with permanent magnets. Fed with sinusoidal currents, usually by field-oriented control (FOC), it turns at exactly synchronous speed with smooth torque and very high efficiency. This model has interior (buried) magnets.',
  construction: 'Stator: laminated core with 24 slots and a distributed three-phase winding, 2 slots per pole per phase, star-connected to the terminal box. Rotor: laminated core with four flat magnet bars buried in pockets near the surface (interior permanent magnet, IPM), 4 poles. Resolver at the rear for the rotor angle. Finned aluminium housing, end shields and bearings.',
  principle: 'Three sinusoidal stator currents make a field that rotates at Ns = 120f/P. The magnet rotor locks to it and turns synchronously. The controller places the stator current 90° electrical ahead of the magnet axis (on the q axis, id = 0), where every ampere gives the most magnet torque. To do so it needs the rotor angle continuously.',
  equations: [
    { expr: 'Ns = 120 · f / P', meaning: 'The rotor turns exactly at synchronous speed.' },
    { expr: 'T = 1.5 · p · ψ · iq', meaning: 'Magnet torque with id = 0 (p pole pairs, ψ peak flux linkage, iq peak current).' },
    { expr: 'T = 1.5 · p · [ψ·iq + (Ld − Lq)·id·iq]', meaning: 'General form: the second term is the reluctance torque of an interior-magnet rotor (zero when id = 0).' },
    { expr: 'vd = Rs·id − ωe·Lq·iq,   vq = Rs·iq + ωe·(Ld·id + ψ)', meaning: 'Steady-state d–q voltage equations.' },
    { expr: 'Pin = 1.5·(vd·id + vq·iq)', meaning: 'Electrical input power in d–q quantities (amplitude-invariant transform).' },
  ],
  assumptions: ['Steady state, sinusoidal currents and back EMF, no saturation.', 'id = 0 control: all current on the q axis.', 'Amplitude-invariant d–q transform (peak phase values).', 'Iron loss, inverter loss and friction neglected.'],
  characteristics: ['Speed fixed by frequency (synchronous), independent of load up to the current limit.', 'Torque proportional to iq; smooth (no commutation steps).', 'Above base speed the voltage limit is reached: negative id (field weakening) extends the speed range.'],
  losses: ['Stator copper loss 1.5·Rs·(id² + iq²).', 'Stator iron loss, rising with frequency.', 'Small eddy losses in the magnets from slot and PWM harmonics.', 'Bearings and windage; inverter switching losses.'],
  advantages: ['Very high efficiency and power density.', 'Rotor stays cool (no rotor copper loss).', 'Smooth torque and precise control with FOC.', 'Interior magnets: robust at high speed, extra reluctance torque, wide field-weakening range.'],
  limitations: ['Needs an inverter and the rotor position (sensor or estimator).', 'Magnet cost and supply; risk of demagnetisation at high temperature.', 'Back EMF is present whenever it turns: a fault at high speed can drive large currents.'],
  applications: ['EV and hybrid traction motors', 'Industrial servo drives and robots', 'Compressors and pumps (high efficiency)', 'Washing machines and appliances'],
  misconceptions: [
    'PMSM and BLDC are not two completely different machines: both have stator windings and rotor magnets. The usual distinction is sinusoidal versus trapezoidal back EMF and FOC versus six-step drive — and manufacturers use the names loosely.',
    'id and iq are not two separate wires: they are two components of the same three phase currents, seen from the rotor.',
    'A PMSM does not slip: if the load exceeds the torque the current can give, it loses synchronism and stalls rather than slowing down a little.',
  ],
  sources: ['Standard d–q relations for PM synchronous machines (e.g. Krishnan, Permanent Magnet Synchronous and Brushless DC Motor Drives; Holmes & Lipo; Mohan, Advanced Electric Drives).'],
}

export const PMSM_QUIZ: QuizItem[] = [
  { id: 'id-resolver', kind: 'identify', prompt: 'What is the highlighted part?', part: 'resolver', options: ['Resolver (position sensor)', 'Hall sensor board', 'Commutator', 'Cooling fan'], answer: 0, explain: 'The resolver measures the rotor angle continuously; field-oriented control needs it to place the current on the q axis.', misconceptions: { 1: 'Hall sensors give only six sectors per cycle — enough for six-step, too coarse for FOC.' } },
  { id: 'id-winding', kind: 'identify', prompt: 'What is the highlighted part?', part: 'stator-winding', options: ['Concentrated tooth coils', 'Distributed three-phase winding', 'Squirrel cage', 'Field winding'], answer: 1, explain: 'A distributed winding: each phase is spread over several slots per pole, which makes its air-gap field nearly sinusoidal.' },
  { id: 'predict-freq', kind: 'predict', prompt: 'A 4-pole PMSM is fed at 100 Hz. The load torque rises (still within the current limit). What is the speed?', options: ['Exactly 3000 rpm', 'A little below 3000 rpm', 'It depends on the load'], answer: 0, explain: 'Ns = 120·100/4 = 3000 rpm, and the rotor turns exactly synchronously. A larger load needs more iq, not a lower speed.', misconceptions: { 1: 'That is the induction motor (slip). The PMSM rotor is locked to the field.' } },
  { id: 'predict-iq', kind: 'predict', prompt: 'With id = 0, iq is doubled. What happens to the torque?', options: ['It doubles', 'It quadruples', 'It stays the same'], answer: 0, explain: 'T = 1.5·p·ψ·iq: linear in iq (the copper loss, 1.5·Rs·iq², quadruples).' },
  { id: 'order-foc', kind: 'order', prompt: 'Put the field-oriented control loop in order.', options: ['Measure the rotor angle (resolver)', 'Measure the phase currents', 'Transform them to id and iq', 'PI controllers set vd and vq', 'Transform back and let the inverter apply the three phase voltages'], answer: 0, explain: 'Angle and currents are measured, transformed into the rotor frame, regulated there as DC quantities, and turned back into three-phase voltages.' },
  { id: 'match-torque', kind: 'match', prompt: 'Which relation gives the PMSM torque with id = 0?', options: ['T = 1.5 · p · ψ · iq', 'T = kΦ · Ia', 'T = ½ · i² · dL/dθ'], answer: 0, explain: 'Magnet flux linkage times q-axis current, times 1.5·p for three phases and p pole pairs. The others are the DC motor and the switched reluctance motor.' },
]
