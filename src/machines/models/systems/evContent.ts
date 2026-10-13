import { evDrive } from '../../calculations/systems.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * EV traction drivetrain (rear half of a car, rear-wheel drive): battery pack under the floor, inverter, motor with
 * its axis across the car, two-stage reduction gearbox with differential, half-shafts and the driven wheels.
 * x = forward, y = up, z = across (axle). The car moves towards +x: the wheels turn negatively about +z.
 */

export const EV_PARTS: MachinePart[] = [
  { id: 'chassis', label: 'Chassis rails', what: 'Two longitudinal rails and a cross member (the rest of the car is not drawn).', function: 'Carry the battery and the drive unit, and take the reaction of the drive torque.', explode: [0, -0.55, 0], stage: 2, anchor: [1.3, -0.1, 0.8], related: ['battery-pack'] },
  { id: 'battery-pack', label: 'Battery pack (under the floor)', what: 'Many cell modules in a flat, sealed pack between the axles.', function: 'Stores the energy and supplies DC to the inverter (and takes it back when braking). Low and central for a low centre of mass.', explode: [0, -0.5, 0], stage: 1, anchor: [0.6, -0.2, 0.55], related: ['hv-cables'] },
  { id: 'hv-cables', label: 'High-voltage cables', what: 'Orange high-voltage cables: DC from the pack to the inverter, three AC phases from the inverter to the motor.', function: 'Carry the traction power. Orange is the standard warning colour for high voltage in vehicles.', explode: [0, 0.35, 0], stage: 1, anchor: [-0.55, 0.32, 0.25], related: ['battery-pack', 'inverter'] },
  { id: 'inverter', label: 'Inverter', what: 'The traction inverter mounted on the drive unit.', function: 'Turns the battery DC into the motor\'s three-phase AC of controlled frequency and current — and the reverse when braking.', explode: [0, 0.65, 0], stage: 1, anchor: [-1.0, 0.85, -0.3], related: ['motor', 'hv-cables'] },
  { id: 'motor', label: 'Traction motor', what: 'A permanent-magnet synchronous motor, its axis parallel to the axle.', function: 'Produces the torque Tm at speed ωm; it can run to well over 10 000 rpm, which is why a reduction gearbox follows.', explode: [0.55, 0, -0.4], stage: 2, anchor: [-0.75, -0.25, -0.62], related: ['gears', 'inverter'] },
  { id: 'gearbox', label: 'Gearbox housing', what: 'The aluminium housing of the reduction gears and the differential.', function: 'Holds the gears in line, contains the oil, and carries the reaction torque.', outer: true, explode: [0.9, 0.5, 0], stage: 1, anchor: [-1.75, 0.55, 0.2], related: ['gears'] },
  { id: 'gears', label: 'Reduction gears + differential', what: 'Two gear stages (drawn 3 : 1 each, so G = 9) and the differential on the axle.', function: 'Reduce the speed and multiply the torque: ω_wheel = ω_motor / G, T_wheel = G·η·T_motor. The differential splits the torque between the two wheels and lets them turn at different speeds in a corner.', explode: [0, 0, 0], stage: 2, anchor: [-1.3, -0.25, 0.32], related: ['motor', 'half-shafts'] },
  { id: 'half-shafts', label: 'Half-shafts (with CV joints)', what: 'Two shafts from the differential to the wheel hubs, with constant-velocity joints.', function: 'Carry the wheel torque to each wheel while the suspension moves.', explode: [-0.4, 0, 0], stage: 2, anchor: [-1.45, 0.12, -0.75], related: ['gears', 'wheels'] },
  { id: 'wheels', label: 'Driven wheels', what: 'The two rear wheels (tyre + rim).', function: 'Turn the wheel torque into a push on the road: F = T_wheel / r. The car speed is v = ω_wheel·r.', explode: [-0.75, 0, 0], stage: 2, anchor: [-1.45, 0.45, 1.05], related: ['half-shafts'] },
]

export const EV_LAYERS: LayerInfo[] = [
  { id: 'energy', label: 'Energy flow', legend: 'Orange: battery DC power → inverter → motor shaft power T·ω → gears → wheels → push on the road; thin branches are the losses of each stage (heat). Values from the calculation with the assumed efficiencies.', conceptual: true },
  { id: 'current', label: 'Currents', legend: 'Green: DC current out of the pack along the HV cables; in the three phase leads, AC currents reversing in sequence (illustrated, not measured).', conceptual: true },
  { id: 'torque', label: 'Torque and force', legend: 'Amber: the motor torque Tm, the larger wheel torque G·η·Tm, and the forward push of the tyres on the road F = T_wheel / r.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White: the motor turns G times faster than the wheels; the car moves forwards (towards the battery side).', conceptual: false },
]

export const EV_STEPS: MachineStep[] = [
  {
    id: 'layout',
    title: '1 · The drivetrain at a glance',
    text: 'A flat battery pack under the floor; at the rear axle, a compact drive unit: the inverter on top, the motor with its axis across the car, a two-stage reduction gearbox with the differential, and two half-shafts to the driven wheels. (Front wheels and body are not drawn.)',
    focus: ['battery-pack', 'inverter', 'motor', 'gears', 'half-shafts', 'wheels'],
    layers: [],
  },
  {
    id: 'electric',
    title: '2 · Battery and inverter',
    text: 'The pack supplies DC (a few hundred volts) through orange high-voltage cables. The inverter turns it into three-phase AC whose frequency sets the motor speed and whose current sets the torque. The battery current follows from the power: I = P_batt / V_batt.',
    focus: ['battery-pack', 'hv-cables', 'inverter'],
    layers: ['current', 'energy'],
    rotate: true,
    equation: 'P_batt = P_shaft / (η_motor · η_inv)',
  },
  {
    id: 'motor',
    title: '3 · Motor torque and speed',
    text: 'The motor delivers a torque Tm at an angular speed ωm: its shaft power is P = Tm·ωm. EV motors are small and fast — at motorway speed they turn at many thousand rpm — and give their full torque from standstill.',
    focus: ['motor'],
    layers: ['torque', 'rotation'],
    rotate: true,
    equation: 'P_shaft = Tm · ωm',
  },
  {
    id: 'gearbox',
    title: '4 · The gearbox trades speed for torque',
    text: 'The two gear stages reduce the speed by G (here 3 × 3 = 9) and multiply the torque by the same factor, minus the gear losses. Watch the wheels: they turn nine times slower than the motor pinion. The differential divides the torque between the two wheels.',
    focus: ['gears', 'half-shafts'],
    layers: ['rotation', 'torque'],
    rotate: true,
    equation: 'ω_wheel = ω_motor / G ;  T_wheel = G · η_gear · Tm',
    detail: 'Power is conserved through the gears apart from the loss: T_wheel·ω_wheel = η_gear·Tm·ωm.',
  },
  {
    id: 'force',
    title: '5 · From wheel torque to motion',
    text: 'The tyre pushes on the road with a force F = T_wheel / r, and the road pushes the car forwards. Rolling resistance and air drag oppose it; what is left accelerates the car. At a steady speed the force just balances the road load.',
    focus: ['wheels'],
    layers: ['torque', 'rotation'],
    rotate: true,
    equation: 'F = T_wheel / r ;  F_road = m·g·Crr + ½·ρ·CdA·v² ;  a = (F − F_road) / m',
  },
  {
    id: 'efficiency',
    title: '6 · The efficiency chain',
    text: 'Every stage loses a little: inverter, motor and gears each pass on only a fraction of their input. In series the efficiencies multiply: η_total = η_inv · η_motor · η_gear. The values used are example assumptions you can change in the Calculate tab — real efficiencies depend on torque and speed.',
    focus: ['inverter', 'motor', 'gears'],
    layers: ['energy'],
    equation: 'η_total = Π η_i = η_inv · η_motor · η_gear',
  },
  {
    id: 'regen',
    title: '7 · And backwards: regeneration',
    text: 'When the car brakes, the same chain runs in reverse: the wheels drive the motor, the motor generates, the inverter passes the power back to the battery. The rotation does not reverse — the torque does (see the Regenerative braking model, and the EV lab, which simulates a whole drive cycle).',
    focus: ['wheels', 'motor', 'inverter', 'battery-pack'],
    layers: ['energy'],
  },
]

export const EV_PARAMS: MachineParam[] = [
  { id: 'v', label: 'Vehicle speed v', unit: 'km/h', min: 0, max: 160, step: 1, value: 60 },
  { id: 'tm', label: 'Motor torque Tm', unit: 'N·m', min: 0, max: 350, step: 5, value: 100 },
  { id: 'gear', label: 'Gear ratio G (drawn: 9)', unit: '', min: 5, max: 12, step: 0.1, value: 9 },
  { id: 'mass', label: 'Vehicle mass m', unit: 'kg', min: 1000, max: 2600, step: 10, value: 1800 },
  { id: 'rw', label: 'Wheel radius r', unit: 'm', min: 0.28, max: 0.38, step: 0.005, value: 0.33, level: 'standard' },
  { id: 'etaInv', label: 'Inverter efficiency (assumed)', unit: '', min: 0.9, max: 0.99, step: 0.01, value: 0.97, level: 'standard' },
  { id: 'etaMotor', label: 'Motor efficiency (assumed)', unit: '', min: 0.85, max: 0.97, step: 0.01, value: 0.93, level: 'standard' },
  { id: 'etaGear', label: 'Gearbox efficiency (assumed)', unit: '', min: 0.9, max: 0.99, step: 0.01, value: 0.97, level: 'standard' },
  { id: 'vbatt', label: 'Battery voltage', unit: 'V', min: 300, max: 800, step: 10, value: 400, level: 'standard' },
  { id: 'crr', label: 'Rolling resistance coefficient Crr', unit: '', min: 0.005, max: 0.02, step: 0.001, value: 0.01, level: 'engineer' },
  { id: 'cda', label: 'Drag area Cd·A', unit: 'm²', min: 0.4, max: 1.0, step: 0.01, value: 0.6, level: 'engineer' },
]

export function evCalc(p: Record<string, number>): CalcResult[] {
  const r = evDrive({ mass: p.mass, v: p.v, gear: p.gear, rw: p.rw, tm: p.tm, etaGear: p.etaGear, etaMotor: p.etaMotor, etaInv: p.etaInv, crr: p.crr, cda: p.cda, vbatt: p.vbatt })
  if (!r) return []
  return [
    { id: 'nMotor', label: 'Motor speed', value: r.nMotor, unit: 'rpm', formula: 'ωm = G · ω_wheel,  ω_wheel = v / r' },
    { id: 'nWheel', label: 'Wheel speed', value: r.nWheel, unit: 'rpm', formula: 'ω_wheel = ωm / G = v / r' },
    { id: 'tw', label: 'Torque at the wheels (total)', value: r.tw, unit: 'N·m', formula: 'T_wheel = G · η_gear · Tm' },
    { id: 'f', label: 'Tractive force F', value: r.f, unit: 'N', formula: 'F = T_wheel / r' },
    { id: 'fRoad', label: 'Road load (level road)', value: r.fRoad, unit: 'N', formula: 'F_road = m·g·Crr + ½·ρ·CdA·v²  (ρ = 1.2 kg/m³)' },
    { id: 'a', label: 'Acceleration', value: r.a, unit: 'm/s²', formula: 'a = (F − F_road) / m', note: r.a < 0 ? 'Negative: this torque is not enough to hold the speed.' : undefined },
    { id: 'pshaft', label: 'Motor shaft power', value: r.pShaft / 1000, unit: 'kW', formula: 'P = Tm · ωm' },
    { id: 'pwheel', label: 'Power at the wheels', value: r.pWheel / 1000, unit: 'kW', formula: 'P_wheel = F · v = η_gear · P_shaft' },
    { id: 'pbatt', label: 'Battery power', value: r.pBatt / 1000, unit: 'kW', formula: 'P_batt = P_shaft / (η_motor · η_inv)' },
    { id: 'ibatt', label: 'Battery current', value: r.ibatt, unit: 'A', formula: 'I = P_batt / V_batt' },
    { id: 'eta', label: 'Battery-to-wheel efficiency', value: r.etaTotal, unit: '%', formula: 'η_total = η_inv · η_motor · η_gear', note: 'Assumed example efficiencies, not data for a real car.' },
  ]
}

export const EV_CONTENT: MachineContent = {
  overview: 'An EV drivetrain turns battery energy into a push on the road through four conversions: DC → AC in the inverter, AC → torque in the motor, high speed/low torque → low speed/high torque in the gearbox, and wheel torque → force at the tyre. Each stage obeys a simple relation and loses a little energy.',
  construction: 'Flat battery pack under the floor; a rear drive unit with the inverter, a permanent-magnet motor parallel to the axle, a two-stage reduction gearbox with a differential; half-shafts with CV joints; the driven wheels. Orange HV cables connect the pack and the drive unit.',
  principle: 'P = T·ω at every shaft; the gearbox divides ω and multiplies T by G (minus its loss); the wheel turns torque into force F = T/r; the road load (rolling + drag) opposes it and the difference accelerates the car. Power from the battery is the shaft power divided by the electrical efficiencies.',
  equations: [
    { expr: 'ω_wheel = ω_motor / G', meaning: 'The gear ratio reduces the speed.' },
    { expr: 'T_wheel = G · η_gear · Tm', meaning: 'and multiplies the torque (minus the gear loss).' },
    { expr: 'F = T_wheel / r,   v = ω_wheel · r', meaning: 'Wheel torque to road force; wheel speed to vehicle speed.' },
    { expr: 'F_road = m·g·Crr + ½·ρ·CdA·v²', meaning: 'Rolling resistance plus aerodynamic drag on a level road.' },
    { expr: 'η_total = η_inv · η_motor · η_gear', meaning: 'Efficiency chain from battery to wheel (assumed example values).' },
  ],
  assumptions: ['Level road, no wind; ρ = 1.2 kg/m³, g = 9.81 m/s².', 'No wheel slip: v = ω_wheel·r.', 'Constant efficiencies (assumptions); auxiliary loads (heating, electronics) not included.', 'The torque is split equally between the two driven wheels (straight driving).'],
  characteristics: ['Full motor torque from standstill: strong acceleration at low speed.', 'At high speed the power limit and the rising drag (∝ v²) dominate.', 'Motor speed is proportional to vehicle speed (fixed gear).'],
  losses: ['Inverter switching and conduction losses.', 'Motor copper, iron and friction losses.', 'Gear mesh and bearing losses.', 'Tyre rolling resistance and air drag (road load).', 'Battery internal resistance.'],
  advantages: ['High efficiency compared with a combustion drivetrain.', 'Regenerative braking recovers energy.', 'Simple single-speed transmission; few moving parts.'],
  limitations: ['Battery energy and mass limit the range.', 'Charging time.', 'Efficiency falls at very low torque and very high speed.'],
  applications: ['Battery electric cars, buses and trucks', 'Hybrid vehicles (with an engine)', 'Electric scooters and motorbikes'],
  misconceptions: [
    'A higher gear ratio does not give more power: it gives more wheel torque at a lower top speed for the same motor.',
    'The battery current is not the motor phase current: power, not current, is passed along the chain.',
    'Efficiencies do not add up: they multiply, so the chain is less efficient than its weakest stage.',
  ],
  sources: ['Standard vehicle dynamics and drive relations (e.g. Ehsani et al., Modern Electric, Hybrid Electric and Fuel Cell Vehicles; Larminie & Lowry, Electric Vehicle Technology Explained).'],
}

export const EV_QUIZ: QuizItem[] = [
  { id: 'id-gears', kind: 'identify', prompt: 'What is the highlighted part?', part: 'gears', options: ['Reduction gears + differential', 'Motor rotor', 'Brake disc', 'Battery module'], answer: 0, explain: 'The two gear stages and the differential: they reduce the speed by G and multiply the torque.' },
  { id: 'id-inverter', kind: 'identify', prompt: 'What is the highlighted part?', part: 'inverter', options: ['Inverter', 'On-board charger', 'Gearbox', 'Battery'], answer: 0, explain: 'The traction inverter turns the battery DC into the motor\'s three-phase AC.' },
  { id: 'predict-gear', kind: 'predict', prompt: 'G is 9 and the motor turns at 9000 rpm. The wheels turn at…', options: ['1000 rpm', '9000 rpm', '81 000 rpm', '900 rpm'], answer: 0, explain: 'ω_wheel = ω_motor / G = 9000 / 9 = 1000 rpm.' },
  { id: 'predict-torque', kind: 'predict', prompt: 'With a higher gear ratio (same motor torque), the force at the tyres…', options: ['rises, but the top speed falls', 'falls', 'stays the same'], answer: 0, explain: 'T_wheel = G·η·Tm rises with G, so F = T_wheel/r rises; but the motor reaches its maximum speed at a lower vehicle speed.' },
  { id: 'order-chain', kind: 'order', prompt: 'Order the conversions from battery to road.', options: ['Battery: DC power', 'Inverter: three-phase AC', 'Motor: torque at high speed', 'Gearbox: more torque, less speed', 'Wheel: force on the road'], answer: 0, explain: 'DC → AC → torque → reduced speed / multiplied torque → force F = T/r.' },
  { id: 'match-eta', kind: 'match', prompt: 'Inverter 97 %, motor 93 %, gears 97 % (assumed). Battery-to-wheel efficiency ≈', options: ['87.5 %', '97 %', '93 %', '287 %'], answer: 0, explain: '0.97 × 0.93 × 0.97 ≈ 0.875.', misconceptions: { 3: 'Efficiencies multiply; adding them is meaningless.' } },
]
