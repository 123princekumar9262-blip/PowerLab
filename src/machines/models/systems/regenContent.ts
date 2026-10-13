import { regen } from '../../calculations/systems.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Regenerative braking: battery ⇄ inverter ⇄ motor ⇄ gearbox ⇄ wheel, laid out along +x. The drive axis is x;
 * the wheel turns positively about +x (the vehicle moves towards +z) in both driving and braking — what reverses
 * when braking is the torque and the direction of the energy flow, not the rotation.
 */

export const RG_PARTS: MachinePart[] = [
  { id: 'battery', label: 'Battery', what: 'The traction battery (DC).', function: 'Supplies power when driving; takes power back (charges) during regenerative braking — if it is not full and not too cold.', explode: [-0.4, 0, 0], stage: 1, anchor: [-3.0, 0.2, 0], related: ['dc-cables', 'inverter'] },
  { id: 'dc-cables', label: 'DC cables', what: 'The + and − cables between the battery and the inverter.', function: 'Carry the battery current — out of the battery when driving, into it when regenerating.', explode: [0, 0, 0], stage: 1, anchor: [-2.0, -0.45, 0.35], related: ['battery'] },
  { id: 'inverter', label: 'Inverter (bidirectional)', what: 'The three-phase inverter with its heat sink, drawn as one block.', function: 'Driving: DC → AC for the motor. Braking: the same switches let AC from the motor flow back as DC into the battery. Its controller decides the sign of the torque.', explode: [0, 0.6, 0], stage: 1, anchor: [-1.15, 0.5, 0.35], related: ['motor', 'dc-cables'] },
  { id: 'ac-cables', label: 'AC cables', what: 'Three phase cables between the inverter and the motor.', function: 'Carry the phase currents in either direction of power flow.', explode: [0, 0, 0], stage: 1, anchor: [-0.35, 0.45, 0.3], related: ['inverter', 'motor'] },
  { id: 'motor', label: 'Motor / generator', what: 'A permanent-magnet AC machine drawn as a block.', function: 'Driving it is a motor; when the wheels drive it and the inverter asks for negative torque, it works as a generator: its EMF pushes current back to the inverter.', explode: [0, 0, 0], stage: 2, anchor: [0.45, -0.6, 0.45], related: ['gearbox', 'ac-cables'] },
  { id: 'gearbox', label: 'Reduction gearbox', what: 'A fixed-ratio gearbox (drawn ratio 9 : 1).', function: 'Trades speed for torque: the motor turns G times faster than the wheel; torque passes in either direction.', explode: [0, 0.55, 0], stage: 2, anchor: [1.4, 0.6, 0], related: ['motor', 'drive-shaft'] },
  { id: 'drive-shaft', label: 'Drive shaft', what: 'The shaft from the gearbox to the wheel hub.', function: 'Carries the wheel torque — driving or braking.', explode: [0.3, 0, 0], stage: 2, anchor: [1.95, 0.15, 0.1], related: ['gearbox', 'wheel'] },
  { id: 'brake', label: 'Friction brake (disc + caliper)', what: 'A brake disc on the hub and a hydraulic caliper.', function: 'Turns kinetic energy into heat. Needed when regeneration is not enough or not allowed (hard stops, low speed, full battery) — the controller blends the two.', explode: [0.45, 0.35, 0], stage: 1, anchor: [2.15, 0.55, 0.25], related: ['wheel'] },
  { id: 'wheel', label: 'Wheel', what: 'A road wheel (tyre and rim).', function: 'Where the vehicle\'s kinetic energy enters the drivetrain during braking: the road turns the wheel and the wheel turns the motor.', explode: [0.75, 0, 0], stage: 2, anchor: [2.45, -0.6, 0.35], related: ['drive-shaft', 'brake'] },
]

export const RG_LAYERS: LayerInfo[] = [
  { id: 'energy', label: 'Energy flow', legend: 'Orange dashes: the direction of the power flow — battery → wheel when driving, wheel → battery during regenerative braking. The arrow-head label says which; values come from the calculation with the assumed efficiencies.', conceptual: true },
  { id: 'current', label: 'Battery current', legend: 'Green: the DC current — out of the + terminal when driving (discharging), into it when regenerating (charging).', conceptual: true },
  { id: 'torque', label: 'Torque', legend: 'Amber: the torque on the drivetrain — in the direction of rotation when driving, against it when braking (the motor then resists the wheel, as a generator does).', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White: the wheel and the motor keep turning the same way in both cases (the car still moves forwards); the motor turns G times faster than the wheel.', conceptual: false },
]

export const RG_STEPS: MachineStep[] = [
  {
    id: 'chain',
    title: '1 · One chain, two directions',
    text: 'Battery, inverter, motor, gearbox and wheel are connected in a chain that can carry power both ways. A friction brake on the wheel hub is still there, for when the electric braking is not enough.',
    focus: ['battery', 'inverter', 'motor', 'gearbox', 'wheel', 'brake'],
    layers: [],
  },
  {
    id: 'drive',
    title: '2 · Driving: battery → wheel',
    text: 'When driving, the battery supplies DC, the inverter makes AC, the motor makes torque in the direction of rotation and the gearbox multiplies it at the wheel. Every stage loses a little, so the battery must deliver more than the wheel receives: P_batt = P_wheel / η_chain.',
    focus: ['battery', 'inverter', 'motor', 'wheel'],
    layers: ['energy', 'torque', 'rotation'],
    rotate: true,
    equation: 'P_batt = P_wheel / (η_gear · η_motor · η_inv)',
  },
  {
    id: 'regen',
    title: '3 · Braking: the motor becomes a generator',
    text: 'The driver brakes. The car\'s momentum keeps the wheel — and through the gearbox the motor — turning in the same direction. The controller now commands a negative torque: the motor resists the rotation, like a loaded generator. Its EMF drives current back through the inverter, whose switches now pass power from the AC side to the DC side.',
    focus: ['motor', 'inverter', 'wheel', 'gearbox'],
    layers: ['energy', 'torque', 'rotation'],
    rotate: true,
    equation: 'F = m · a  (a < 0) ;  P_wheel = F · v  < 0',
    detail: 'Same rotation, reversed torque: the machine moves from the motoring to the generating quadrant (quadrant II of the torque–speed plane).',
  },
  {
    id: 'charging',
    title: '4 · The battery current reverses',
    text: 'The battery voltage stays the same polarity, but its current now flows into the + terminal: the battery is charging. The power that reaches it is the braking power at the wheel times the efficiencies of the chain — the losses are taken out on the way back too.',
    focus: ['battery', 'dc-cables', 'inverter'],
    layers: ['current', 'energy'],
    rotate: true,
    equation: 'P_batt = η_chain · P_wheel ;  I_batt = P_batt / V_batt  (< 0: charging)',
  },
  {
    id: 'limits',
    title: '5 · When regeneration is not enough',
    text: 'Regeneration fades at low speed (P = T·ω → 0 as ω → 0, and the EMF is small); the battery limits how fast it can charge (a full or a cold battery accepts little); the motor and inverter current limit the braking torque. Then the friction brakes take over or blend in — and in an emergency stop they do most of the work.',
    focus: ['brake', 'battery', 'motor'],
    layers: ['torque'],
    detail: 'Blended braking: the controller asks the motor for as much negative torque as the battery and machine allow and fills the rest with hydraulic braking, transparently for the driver.',
  },
  {
    id: 'energy',
    title: '6 · How much comes back',
    text: 'At speed v the car stores kinetic energy ½·m·v². If the motor alone braked it to a stop on a level road, at most η_chain of it would reach the battery; road drag and friction brakes reduce that. Spending it again on driving costs the chain efficiency once more, so the round trip returns roughly η_chain² — still much better than turning it all into brake heat.',
    focus: ['wheel', 'battery'],
    layers: ['energy'],
    equation: 'E_k = ½ · m · v² ;  E_back ≤ η_chain · E_k',
  },
]

export const RG_PARAMS: MachineParam[] = [
  { id: 'a', label: 'Acceleration a (negative = braking)', unit: 'm/s²', min: -4, max: 3, step: 0.1, value: -2 },
  { id: 'v', label: 'Speed v', unit: 'km/h', min: 0, max: 130, step: 1, value: 60 },
  { id: 'mass', label: 'Vehicle mass m', unit: 'kg', min: 800, max: 2500, step: 10, value: 1600 },
  { id: 'etaGear', label: 'Gearbox efficiency (assumed)', unit: '', min: 0.9, max: 0.99, step: 0.01, value: 0.97, level: 'standard' },
  { id: 'etaMotor', label: 'Motor/generator efficiency (assumed)', unit: '', min: 0.85, max: 0.97, step: 0.01, value: 0.92, level: 'standard' },
  { id: 'etaInv', label: 'Inverter efficiency (assumed)', unit: '', min: 0.9, max: 0.99, step: 0.01, value: 0.97, level: 'standard' },
  { id: 'vbatt', label: 'Battery voltage', unit: 'V', min: 200, max: 800, step: 10, value: 400, level: 'standard' },
]

export function rgCalc(p: Record<string, number>): CalcResult[] {
  const r = regen({ mass: p.mass, v: p.v, a: p.a, etaGear: p.etaGear, etaMotor: p.etaMotor, etaInv: p.etaInv, vbatt: p.vbatt })
  if (!r) return []
  const mode = r.braking ? 'Braking: power flows wheel → battery.' : r.pWheel > 0 ? 'Driving: power flows battery → wheel.' : 'No power flow.'
  return [
    { id: 'f', label: 'Force at the wheels F', value: r.f, unit: 'N', formula: 'F = m · a  (road drag neglected)', note: mode },
    { id: 'pwheel', label: 'Power at the wheels', value: r.pWheel / 1000, unit: 'kW', formula: 'P_wheel = F · v', note: r.braking ? 'Negative: the wheels deliver power to the drivetrain.' : undefined },
    { id: 'pbatt', label: 'Battery power', value: r.pBatt / 1000, unit: 'kW', formula: r.braking ? 'P_batt = η_chain · P_wheel  (braking)' : 'P_batt = P_wheel / η_chain  (driving)', note: r.braking ? 'Negative: the battery is charging.' : undefined },
    { id: 'ibatt', label: 'Battery current', value: r.ibatt, unit: 'A', formula: 'I = P_batt / V_batt', note: r.ibatt < 0 ? 'Negative: current flows into the battery.' : undefined },
    { id: 'loss', label: 'Losses in the chain', value: r.loss / 1000, unit: 'kW', formula: '|P_wheel − P_batt|' },
    { id: 'eta', label: 'Chain efficiency (one way)', value: r.eta, unit: '%', formula: 'η_chain = η_gear · η_motor · η_inv', note: 'Assumed example efficiencies.' },
    { id: 'ke', label: 'Kinetic energy at this speed', value: r.ke / 1000, unit: 'kJ', formula: 'E_k = ½ · m · v²' },
    { id: 'keBack', label: 'At most back to the battery', value: r.keRecoverable / 1000, unit: 'kJ', formula: 'E_back ≤ η_chain · E_k', note: 'Braking to standstill by the motor alone, no drag: an upper bound.' },
  ]
}

export const RG_CONTENT: MachineContent = {
  overview: 'Regenerative braking uses the traction motor as a generator: instead of turning the car\'s kinetic energy into brake heat, the drivetrain carries it back to the battery. Nothing in the chain changes direction of rotation — the torque and the energy flow reverse.',
  construction: 'The normal electric drivetrain (battery, bidirectional inverter, PM motor, reduction gearbox, wheel) plus the ordinary friction brakes, which the controller blends with the electric braking.',
  principle: 'With the wheels driving the motor, the controller commands negative torque. The machine\'s EMF now drives current back through the inverter into the DC link; the battery current reverses and the battery charges. Power at the battery = η_chain × braking power at the wheels.',
  equations: [
    { expr: 'F = m · a,   P_wheel = F · v', meaning: 'Braking force and power at the wheels (a < 0: negative power, flowing into the drivetrain).' },
    { expr: 'P_batt = η_chain · P_wheel', meaning: 'Power reaching the battery when braking.' },
    { expr: 'P_batt = P_wheel / η_chain', meaning: 'Power the battery must supply when driving.' },
    { expr: 'η_chain = η_gear · η_motor · η_inv', meaning: 'Efficiencies of stages in series multiply (assumed example values).' },
    { expr: 'E_k = ½ · m · v²', meaning: 'Kinetic energy available for recovery.' },
  ],
  assumptions: ['Level road; aerodynamic drag and rolling resistance neglected (so the recovered power is an upper bound).', 'All the braking done by the motor (no friction braking).', 'Constant efficiencies, the same in both directions (assumptions).', 'The battery can accept the charging power.'],
  characteristics: ['Regenerative power ∝ braking force × speed: it fades as the car slows.', 'Battery current reverses; voltage polarity does not.', 'Limited by battery charge acceptance and the motor/inverter current rating.'],
  losses: ['Gearbox friction.', 'Motor copper and iron losses (as a generator).', 'Inverter conduction and switching losses.', 'Battery internal resistance (charging heat).'],
  advantages: ['Recovers a useful part of the braking energy (more range, especially in town).', 'Less brake wear.', 'Smooth, controllable braking torque.'],
  limitations: ['Little effect at low speed and in emergency stops.', 'Restricted when the battery is full or cold.', 'Needs blending with friction brakes for consistent pedal feel.'],
  applications: ['Electric and hybrid cars', 'Trains, trams and metros (often back into the supply line)', 'Lifts and cranes (lowering loads)', 'E-bikes and forklifts'],
  misconceptions: [
    'The motor does not spin backwards to regenerate: it keeps turning the same way; the torque reverses.',
    'Not all the braking energy comes back: the chain losses apply on the way back, and drag and friction brakes take their share.',
    'The battery voltage does not reverse: the current does.',
  ],
  sources: ['Standard vehicle dynamics and drive relations (e.g. Ehsani et al., Modern Electric, Hybrid Electric and Fuel Cell Vehicles).'],
}

export const RG_QUIZ: QuizItem[] = [
  { id: 'id-brake', kind: 'identify', prompt: 'What is the highlighted part?', part: 'brake', options: ['Friction brake (disc + caliper)', 'Gearbox', 'Coupling', 'Wheel bearing'], answer: 0, explain: 'The friction brake turns kinetic energy into heat; it takes over when regeneration is not enough.' },
  { id: 'predict-rotation', kind: 'predict', prompt: 'During regenerative braking the motor…', options: ['keeps turning the same way; its torque reverses', 'turns backwards', 'stops immediately', 'is disconnected'], answer: 0, explain: 'The car still moves forwards, so the motor turns the same way. The controller reverses the torque, so the machine generates.', misconceptions: { 1: 'Reversing rotation would mean reversing the car: what reverses is the torque and the power flow.' } },
  { id: 'predict-current', kind: 'predict', prompt: 'During regenerative braking the battery current…', options: ['flows into the battery (charging)', 'flows out as when driving', 'is zero'], answer: 0, explain: 'Power flows to the DC side, so the current enters the + terminal: the battery charges.' },
  { id: 'predict-speed', kind: 'predict', prompt: 'Same braking force, but at half the speed. The regenerated power…', options: ['halves', 'stays the same', 'doubles'], answer: 0, explain: 'P = F·v: half the speed at the same force gives half the power. At very low speed there is little to recover.' },
  { id: 'order', kind: 'order', prompt: 'Order the energy path during regenerative braking.', options: ['Kinetic energy of the car', 'Wheel and gearbox turn the motor', 'Motor generates; inverter passes AC → DC', 'Battery charges'], answer: 0, explain: 'The reverse of driving: wheel → gearbox → generator → inverter → battery.' },
  { id: 'match-eta', kind: 'match', prompt: 'Gearbox 97 %, motor 92 %, inverter 97 % (assumed). Of 50 kW of braking power at the wheels, the battery gets about…', options: ['43 kW', '50 kW', '58 kW', '35 kW'], answer: 0, explain: '50 × 0.97 × 0.92 × 0.97 ≈ 50 × 0.866 ≈ 43 kW.', misconceptions: { 2: '58 kW would be dividing by the efficiency — that is the driving direction.' } },
]
