import { spOperating, spPeak, spPoint, SPIM_EXAMPLE, syncRad, syncRpm } from '../../../calculations/induction.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Single-phase (capacitor-start) induction motor — content and calculations. The running machine (main winding
 * only, after the centrifugal switch has opened) is calculated with the double-revolving-field equivalent circuit.
 */

export const SP_PARTS: MachinePart[] = [
  { id: 'frame', label: 'Frame', what: 'The steel frame with cooling fins and feet.', function: 'Holds the stator core and the end shields; carries the heat away.', outer: true, explode: [-2.7, 0, 0], stage: 3, anchor: [0.9, 1.0, 0.6], related: ['stator-core'] },
  { id: 'capacitor', label: 'Start capacitor', what: 'An electrolytic (AC) capacitor in a can on the frame, in series with the auxiliary winding.', function: 'Makes the auxiliary-winding current lead the main-winding current by roughly 90°, so that the two windings make a rotating field and a strong starting torque.', outer: true, explode: [-2.7, 0.75, 0], stage: 3, anchor: [0.2, 1.62, 0.1], related: ['aux-winding', 'centrifugal-switch'] },
  { id: 'end-shield-front', label: 'Drive-end shield', what: 'The end cover at the shaft end with the bearing housing.', function: 'Holds the bearing and keeps the rotor centred.', outer: true, explode: [-1.0, -1.15, 1.0], stage: 1, anchor: [-0.75, 0.7, 1.05], related: ['bearings'] },
  { id: 'end-shield-rear', label: 'Rear end shield', what: 'The end cover at the switch end.', function: 'Holds the second bearing and carries the stationary contacts of the centrifugal switch.', outer: true, explode: [1.5, -1.5, -0.45], stage: 2, anchor: [-0.75, -0.75, -1.3], related: ['centrifugal-switch', 'bearings'] },
  { id: 'stator-core', label: 'Stator core (laminated)', what: 'Laminated core with 24 slots.', function: 'Carries the flux, which alternates at the supply frequency; laminated against eddy currents.', explode: [-2.7, 0, 0], stage: 3, anchor: [-0.7, 0.75, 0.7], related: ['main-winding', 'aux-winding'] },
  { id: 'main-winding', label: 'Main (running) winding', what: 'The distributed winding in two-thirds of the slots (end turns red).', function: 'Connected to the supply all the time. Alone it makes a PULSATING field along a fixed axis — which cannot start the rotor, but keeps it running once it turns.', explode: [-2.7, 0, 0], stage: 3, anchor: [0.62, -0.62, 0.9], related: ['aux-winding', 'stator-core'] },
  { id: 'aux-winding', label: 'Auxiliary (starting) winding', what: 'A smaller winding in the remaining slots, its axis 90° (electrical) from the main winding (end turns blue).', function: 'With the capacitor in series its current leads the main current; together the two windings make a rotating field for starting. The centrifugal switch disconnects it near running speed.', explode: [-2.7, 0, 0], stage: 3, anchor: [-0.62, 0.62, 0.95], related: ['capacitor', 'main-winding'] },
  { id: 'rotor-core', label: 'Rotor core (laminated)', what: 'Laminated rotor core with skewed slots.', function: 'Carries the flux and holds the cage.', explode: [0, 0, 0], stage: 3, anchor: [0.15, 0.56, -0.4], related: ['rotor-cage'] },
  { id: 'rotor-cage', label: 'Squirrel-cage (bars + end rings)', what: 'Skewed aluminium bars joined by end rings — the same kind of rotor as a three-phase cage motor.', function: 'Currents are induced in it by both rotating components of the field; the net torque comes from the difference.', explode: [0, 0, 0], stage: 3, anchor: [0.5, -0.15, 0.3], related: ['rotor-core'] },
  { id: 'centrifugal-switch', label: 'Centrifugal switch', what: 'Flyweights on the shaft that move a sliding collar, and a stationary contact on the rear shield.', function: 'Near 70–80 % of synchronous speed the weights fly out, the collar moves and the contact opens: the auxiliary winding and capacitor are disconnected.', explode: [0, 0, -0.4], stage: 3, anchor: [-0.35, -0.5, -1.15], related: ['aux-winding', 'capacitor'] },
  { id: 'shaft', label: 'Shaft', what: 'The steel shaft with a key at the drive end.', function: 'Carries the torque to the load.', explode: [0, 0, 0], stage: 3, anchor: [0, 0.2, 1.75], related: ['bearings'] },
  { id: 'bearings', label: 'Bearings', what: 'Two ball bearings in the end shields.', function: 'Keep the rotor centred and let it turn freely.', explode: [0, 0, 0], stage: 1, anchor: [0.3, -0.3, 1.0], related: ['shaft'] },
]

export const SP_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Winding currents', legend: 'Cones at the slot mouths: current in each slot (main red, auxiliary blue); out of the drive end = ⊙, into it = ⊗; length ∝ current. The card shows i_main and i_aux: the auxiliary current leads by about 90° while the capacitor branch is connected, and is zero after the switch opens.', conceptual: true },
  { id: 'rotatingField', label: 'Air-gap field', legend: 'Blue: the air-gap field (into the rotor at a stator N pole, out at an S pole). Main winding alone: it pulsates along a fixed axis (arrows grow, shrink and reverse); the faint violet and teal arrows are its two half-size components turning forwards and backwards at Ns. With the auxiliary winding in: one field turning forwards.', conceptual: true },
  { id: 'torque', label: 'Forward and backward torque', legend: 'Amber, counter-clockwise: the torque of the forward field (Tf). Grey-violet, clockwise: the torque of the backward field (Tb). The net torque is Tf − Tb. Values from the calculation.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White: the rotor turns (Nr); blue outer arrow: the forward field component (Ns).', conceptual: false },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: input power → forward air-gap power → mechanical power; losses in the stator, and in the rotor from both the forward (s·PagF) and the backward field ((2 − s)·PagB). Values from the calculation.', conceptual: true },
]

export const SP_PARAMS: MachineParam[] = [
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 5, step: 0.05, value: 2 },
  { id: 'poles', label: 'Number of poles P', unit: '', min: 2, max: 4, step: 2, value: 4, options: [2, 4] },
  { id: 'f', label: 'Supply frequency f', unit: 'Hz', min: 25, max: 60, step: 1, value: 50, level: 'standard' },
]

/** Running point (main winding only) of the illustrative motor; the voltage follows V/f (230 V at 50 Hz). */
export function spCalc(p: Record<string, number>): CalcResult[] {
  const m = SPIM_EXAMPLE
  const ns = syncRpm(p.f, p.poles)
  const op = spOperating(m, p.f, p.poles, p.tl)
  const pk = spPeak(m, p.f, p.poles)
  const st = spPoint(m, p.f, p.poles, 1)
  const stall = op ? undefined : 'The load is above the peak torque of the main winding alone: no running point.'
  return [
    { id: 'ns', label: 'Synchronous speed Ns', value: ns, unit: 'rpm', formula: 'Ns = 120·f / P' },
    { id: 's', label: 'Slip s (to the forward field)', value: op ? op.s : null, unit: '%', formula: 's = (Ns − Nr)/Ns, from Tf − Tb = TL', note: stall },
    { id: 'nr', label: 'Rotor speed Nr', value: op ? op.nr : null, unit: 'rpm', formula: 'Nr = (1 − s)·Ns' },
    { id: 'f2f', label: 'Rotor frequency, forward field', value: op ? op.f2f : null, unit: 'Hz', formula: 'f2F = s·f' },
    { id: 'f2b', label: 'Rotor frequency, backward field', value: op ? op.f2b : null, unit: 'Hz', formula: 'f2B = (2 − s)·f', note: 'Nearly twice the supply frequency.' },
    { id: 'tf', label: 'Forward torque Tf', value: op ? op.tf : null, unit: 'N·m', formula: 'Tf = PagF / ωs,  PagF = I1²·Re ZF' },
    { id: 'tb', label: 'Backward torque Tb', value: op ? op.tb : null, unit: 'N·m', formula: 'Tb = PagB / ωs,  PagB = I1²·Re ZB' },
    { id: 'i1', label: 'Main-winding current', value: op ? op.i1 : null, unit: 'A', formula: 'I1 = V / (R1 + jX1 + ZF + ZB),  V = 230·f/50' },
    { id: 'pf', label: 'Power factor', value: op ? op.pf : null, unit: '', formula: 'cos φ = Pin / (V·I1)' },
    { id: 'pin', label: 'Electrical input', value: op ? op.pin : null, unit: 'W', formula: 'Pin = V·I1·cos φ' },
    { id: 'pcu1', label: 'Stator copper loss', value: op ? op.pcu1 : null, unit: 'W', formula: 'Pcu1 = I1²·R1' },
    { id: 'pcu2', label: 'Rotor copper loss', value: op ? op.pcu2 : null, unit: 'W', formula: 'Pcu2 = s·PagF + (2 − s)·PagB' },
    { id: 'pmech', label: 'Mechanical power', value: op ? op.pmech : null, unit: 'W', formula: 'Pmech = (1 − s)·(PagF − PagB)' },
    { id: 'eff', label: 'Efficiency (this model)', value: op && op.pin > 0 ? op.pmech / op.pin : null, unit: '%', formula: 'η = Pmech / Pin', note: 'Core, friction and windage losses not included.' },
    { id: 'tmax', label: 'Peak torque (main winding alone)', value: pk.tMax, unit: 'N·m', formula: 'max over s of (PagF − PagB)/ωs' },
    { id: 'tst', label: 'Starting torque, main winding alone', value: st.te, unit: 'N·m', formula: 'Tf − Tb at s = 1 (ZF = ZB)', note: 'Exactly zero: the two field components pull equally in opposite directions — hence the starting winding.' },
    { id: 'nsw', label: 'Switch opening speed (typical)', value: 0.75 * ns, unit: 'rpm', formula: '≈ 0.75·Ns (typically 70–80 % of Ns)', note: 'A typical design value, not calculated from the circuit.' },
    { id: 'fp', label: 'Torque pulsation frequency', value: 2 * p.f, unit: 'Hz', formula: 'fp = 2·f', note: 'Single-phase motors hum and vibrate at 2f.' },
  ]
}

export function spMotion(calc: Record<string, number | null>, params: Record<string, number>) {
  const w = syncRad(params.f, params.poles) / 50
  const s = calc.s
  return {
    omega: w,
    note:
      s === null
        ? 'The field components turn at the calculated synchronous speed (slowed ×50); with this load the motor cannot run.'
        : `The forward field turns at Ns = ${Math.round(calc.ns ?? 0)} rpm and the rotor at Nr = ${Math.round(calc.nr ?? 0)} rpm, both slowed down ×50. In the starting steps the rotor is shown at rest.`,
  }
}

const DEF = Object.fromEntries(SP_PARAMS.map((x) => [x.id, x.value]))
const op = spOperating(SPIM_EXAMPLE, DEF.f, DEF.poles, DEF.tl)!
const pct = (x: number) => `${(x * 100).toFixed(1)} %`

export const SP_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The rotor is an ordinary squirrel cage. The stator has two windings: the main (running) winding in about two-thirds of the slots, and an auxiliary (starting) winding whose axis is 90° electrical away. The auxiliary winding is in series with the start capacitor (on the frame) and with the contact of the centrifugal switch (on the shaft at the rear).',
    focus: ['main-winding', 'aux-winding', 'capacitor', 'centrifugal-switch', 'rotor-cage'],
    layers: [],
  },
  {
    id: 'pulsating',
    title: '2 · One winding: a pulsating field',
    text: 'With only the main winding connected, the single-phase current makes a field that stays on one axis: it grows, shrinks to zero and reverses, at the supply frequency — it pulsates, it does not rotate. A rotor at rest feels no turning force: nothing tells it which way to go. A single-phase induction motor is not self-starting on its main winding.',
    focus: ['main-winding'],
    layers: ['current', 'rotatingField'],
    rotate: true,
    equation: 'B(θ, t) = B̂·cos ωt · cos θ   (fixed axis)',
    detail: 'The rotor shown at rest; the auxiliary branch is assumed disconnected to show the main winding alone.',
  },
  {
    id: 'double-field',
    title: '3 · Two half fields turning opposite ways',
    text: 'A pulsating field is exactly the sum of two fields of half the size, turning in opposite directions at the synchronous speed (double-revolving-field theory). At standstill the rotor has the same slip (s = 1) to both, so they produce equal and opposite torques: the net starting torque is zero. Push the rotor either way and the field turning that way wins — the motor then runs in that direction.',
    focus: ['main-winding', 'rotor-cage'],
    layers: ['rotatingField', 'torque'],
    rotate: true,
    equation: 'cos ωt · cos θ = ½ cos(θ − ωt) + ½ cos(θ + ωt)',
    detail: 'Forward slip s, backward slip 2 − s. At s = 1 both are 1: ZF = ZB and Tf = Tb exactly.',
  },
  {
    id: 'start',
    title: '4 · Starting: auxiliary winding and capacitor',
    text: 'The auxiliary winding is placed 90° (electrical) from the main one, and the capacitor makes its current lead the main current by about 90°. Two windings in space quadrature with currents in time quadrature make a rotating field — like a two-phase machine. The field turns from the auxiliary winding’s axis towards the main winding’s, and the rotor starts in that direction with a strong torque.',
    focus: ['aux-winding', 'capacitor', 'main-winding'],
    layers: ['current', 'rotatingField'],
    rotate: true,
    equation: 'i_main = Î·cos ωt  |  i_aux ≈ Î·cos(ωt + 90°)',
    detail: 'A real capacitor gives a phase shift that is near 90° only at one speed; the starting field is then elliptical rather than circular. Reversing the auxiliary winding’s connections reverses the motor.',
  },
  {
    id: 'switch',
    title: '5 · The centrifugal switch opens',
    text: 'As the motor speeds up, the flyweights of the centrifugal switch move outwards. At roughly 70–80 % of synchronous speed they slide the collar and open the contact: the auxiliary winding and the capacitor are disconnected (a start capacitor is rated only for short use). From now on the motor runs on its main winding alone.',
    focus: ['centrifugal-switch', 'capacitor', 'aux-winding'],
    layers: ['rotation'],
    rotate: true,
    equation: 'switch opens at ≈ 0.75·Ns',
  },
  {
    id: 'running',
    title: '6 · Running on the main winding',
    text: `Once turning forwards, the rotor’s slip to the forward field is small (s) but to the backward field it is nearly 2. The backward field’s rotor currents, at (2 − s)·f, are limited by the rotor reactance and mostly cancel its flux, so the forward torque wins. With the default ${DEF.tl} N·m: Nr = ${Math.round(op.nr)} rpm, s = ${pct(op.s)}, Tf = ${op.tf.toFixed(2)} N·m, Tb = ${op.tb.toFixed(2)} N·m, net ${(op.tf - op.tb).toFixed(2)} N·m.`,
    focus: ['rotor-cage', 'main-winding', 'shaft'],
    layers: ['rotatingField', 'torque', 'rotation'],
    rotate: true,
    equation: 'T = Tf − Tb = (PagF − PagB) / ωs',
    detail: 'The interaction of the forward and backward fields gives a torque pulsating at 2f: single-phase motors hum and need resilient mounts.',
  },
  {
    id: 'losses',
    title: '7 · Losses and model limits',
    text: 'The backward field costs: it induces rotor currents at almost twice the supply frequency (loss (2 − s)·PagB) and takes torque away. So single-phase motors are less efficient, have a lower power factor and a pulsating torque compared with three-phase motors of the same size. This model: steady state, main winding only (switch open), double-revolving-field circuit of an illustrative 230 V motor, no core or friction loss.',
    focus: ['main-winding', 'rotor-cage'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'Pcu2 = s·PagF + (2 − s)·PagB',
    detail: 'Variants: capacitor-run (PSC) keeps a smaller capacitor in circuit; capacitor-start capacitor-run uses both; split-phase uses a resistive auxiliary winding without a capacitor; shaded-pole motors use a shorted ring on part of each pole.',
  },
]

export const SP_CONTENT: MachineContent = {
  overview: 'A single-phase induction motor runs from an ordinary household supply. Its main winding alone makes a pulsating field that cannot start the rotor; an auxiliary winding 90° away, fed through a capacitor, makes a rotating field for starting, and a centrifugal switch disconnects it near running speed.',
  construction: 'Stator: laminated core (24 slots here) with a main winding in about two-thirds of the slots and an auxiliary winding in the rest, its axis 90° electrical from the main one. Rotor: an ordinary skewed squirrel cage. A start capacitor in a can on the frame and a centrifugal switch on the shaft are in series with the auxiliary winding.',
  principle: 'A pulsating field equals two half-size fields turning in opposite directions. At standstill they give equal and opposite torques, so the motor needs a starting method: the auxiliary winding with a leading (capacitor) current turns the field into a rotating one. Once running, the slip to the forward field is small and to the backward field nearly 2, so the forward torque wins and the motor keeps running on the main winding alone.',
  equations: [
    { expr: 'Ns = 120·f / P,  s = (Ns − Nr)/Ns', meaning: 'Synchronous speed of each field component; slip to the forward component.' },
    { expr: 'cos ωt·cos θ = ½cos(θ − ωt) + ½cos(θ + ωt)', meaning: 'A pulsating field = forward + backward rotating fields of half amplitude.' },
    { expr: 'ZF = ½[jXm ∥ (R2/s + jX2)],  ZB = ½[jXm ∥ (R2/(2 − s) + jX2)]', meaning: 'The double-revolving-field equivalent circuit: the rotor seen by each component.' },
    { expr: 'T = (PagF − PagB)/ωs,  PagF,B = I1²·Re ZF,B', meaning: 'Net torque: forward minus backward.' },
    { expr: 'f2F = s·f,  f2B = (2 − s)·f', meaning: 'Rotor current frequencies induced by the two components.' },
  ],
  assumptions: [
    'Steady state, sinusoidal 230 V / 50 Hz supply (V/f when f is changed).',
    'Running on the main winding only (centrifugal switch open).',
    'Illustrative circuit values (R1 = 6 Ω, X1 = 8 Ω, R2′ = 12 Ω, X2′ = 6 Ω, Xm = 180 Ω at 50 Hz) — not a specific product.',
    'Core, friction and windage losses neglected; linear iron.',
    'Switch opening speed is a typical design value (≈ 75 % of Ns), not calculated.',
  ],
  characteristics: ['Not self-starting on the main winding alone (zero starting torque).', 'Runs in either direction once started.', 'Torque pulsates at twice the supply frequency (hum).', 'Speed slightly below Ns, falling a little with load, like a three-phase motor.'],
  losses: ['Stator copper loss in the main winding.', 'Rotor copper loss from the forward field s·PagF and the backward field (2 − s)·PagB.', 'Core loss, friction, windage.', 'Capacitor and auxiliary-winding losses during starting.'],
  advantages: ['Runs from a single-phase supply (homes, small workshops).', 'Simple, robust cage rotor; low cost.', 'Capacitor start gives a good starting torque.'],
  limitations: ['Lower efficiency and power factor than a three-phase motor.', 'Pulsating torque, vibration and noise.', 'Needs a starting device; the centrifugal switch and start capacitor can fail.', 'Usually limited to a few kW.'],
  applications: ['Compressors of refrigerators and air conditioners', 'Pumps, fans, washing machines', 'Small workshop tools', 'Domestic appliances'],
  misconceptions: [
    'The capacitor does not store energy to "kick" the rotor: it shifts the phase of the auxiliary current so the field rotates.',
    'A single-phase motor is not "half" a three-phase motor: its main field pulsates, and the backward component always costs torque and loss.',
    'Once running, the motor does not need the auxiliary winding to keep turning.',
  ],
  sources: ['Double-revolving-field theory as in standard textbooks (e.g. Chapman, Electric Machinery Fundamentals, single-phase motors; Sen, Principles of Electric Machines).'],
}

export const SP_QUIZ: QuizItem[] = [
  { id: 'id-switch', kind: 'identify', prompt: 'What is the highlighted part?', part: 'centrifugal-switch', options: ['Cooling fan', 'Centrifugal switch', 'Slip ring', 'Bearing'], answer: 1, explain: 'The centrifugal switch: flyweights on the shaft that open a contact near running speed and disconnect the auxiliary winding.' },
  { id: 'id-cap', kind: 'identify', prompt: 'What is the highlighted part?', part: 'capacitor', options: ['Terminal box', 'Start capacitor', 'Thermal protector', 'Fan cover'], answer: 1, explain: 'The start capacitor, in series with the auxiliary winding: it makes the auxiliary current lead.' },
  { id: 'predict-start', kind: 'predict', prompt: 'The auxiliary winding is open (broken switch). The motor is switched on at rest. What happens?', options: ['It starts normally', 'It hums but does not start', 'It starts backwards'], answer: 1, explain: 'The main winding alone gives a pulsating field: equal forward and backward torques at standstill, so no net torque. It draws a high current and hums. Spun by hand it would run in that direction.' },
  { id: 'predict-run', kind: 'predict', prompt: 'A running motor’s centrifugal switch opens. What happens?', options: ['It stops', 'It keeps running on the main winding', 'It reverses'], answer: 1, explain: 'Once turning, the forward field dominates (slip s to it, 2 − s to the backward one): the main winding alone keeps it running.' },
  { id: 'order', kind: 'order', prompt: 'Put the starting sequence in order.', options: ['Supply on: main and auxiliary windings energised', 'The capacitor makes the auxiliary current lead: a rotating field', 'The rotor accelerates', 'The centrifugal switch opens near 75 % of Ns', 'The motor runs on the main winding alone'], answer: 0, explain: 'Rotating field from the two windings, acceleration, switch opens, running on the main winding.' },
  { id: 'match-decomp', kind: 'match', prompt: 'Which statement describes the main winding’s field?', options: ['Two half-size fields turning in opposite directions', 'One field turning at Ns', 'A constant field'], answer: 0, explain: 'A pulsating field is the sum of a forward and a backward rotating field of half amplitude (double-revolving-field theory).' },
]
