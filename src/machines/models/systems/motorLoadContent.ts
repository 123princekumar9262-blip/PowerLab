import { motorLoad } from '../../calculations/systems.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Motor coupled to a mechanical load: motor → jaw coupling → line shaft on two bearings with a flywheel → fan.
 * Shaft = x axis (motor at −x); positive rotation = counter-clockwise seen from the fan end (+x).
 */

export const ML_PARTS: MachinePart[] = [
  { id: 'baseplate', label: 'Baseplate', what: 'A common steel bed for the motor, the bearings and the load.', function: 'Keeps the motor and the driven shaft aligned and takes the reaction torque of the motor frame.', explode: [0, -0.4, 0], stage: 2, anchor: [1.2, -0.8, 0.62], related: ['motor', 'bearings'] },
  { id: 'motor', label: 'Electric motor', what: 'A totally enclosed motor drawn as a block (finned frame, feet, terminal box).', function: 'Converts electrical power into torque on its shaft. Its torque falls as its speed rises (its torque–speed characteristic).', explode: [-0.6, 0, 0], stage: 1, anchor: [-1.7, 0.85, 0], related: ['coupling'] },
  { id: 'coupling-guard', label: 'Coupling guard', what: 'A sheet-metal cover over the coupling.', function: 'Safety: keeps hands and clothing away from the rotating coupling.', outer: true, explode: [0, 0.75, 0], stage: 1, anchor: [-0.75, 0.42, 0.2], related: ['coupling'] },
  { id: 'coupling', label: 'Flexible (jaw) coupling', what: 'Two jawed hubs with an elastomer spider between them.', function: 'Transmits the motor torque to the load shaft. In steady state the same torque passes through it; the spider absorbs small misalignment and shocks.', explode: [-0.25, 0, 0], stage: 1, anchor: [-0.75, -0.3, 0.25], related: ['motor', 'shaft'] },
  { id: 'shaft', label: 'Line shaft', what: 'The steel shaft from the coupling through the bearings to the fan.', function: 'Carries the torque to the flywheel and the load. Every rotating part on it turns at the same speed ω.', explode: [0, 0, 0], stage: 2, anchor: [1.25, 0.12, 0.1], related: ['bearings', 'flywheel', 'load'] },
  { id: 'bearings', label: 'Pillow-block bearings', what: 'Two bearing housings on pedestals carrying the shaft.', function: 'Support the shaft and its weights radially; their friction is a small part of the load torque.', explode: [0, -0.35, 0.6], stage: 2, anchor: [-0.35, -0.45, 0.32], related: ['shaft'] },
  { id: 'flywheel', label: 'Flywheel (inertia)', what: 'A heavy steel disc on the shaft.', function: 'Adds moment of inertia J: it stores kinetic energy ½·J·ω², slows the start-up and smooths speed changes when the torque or the load changes.', explode: [0, 0.6, 0.5], stage: 2, anchor: [0.2, 0.82, 0], related: ['shaft'] },
  { id: 'fan-housing', label: 'Fan housing', what: 'The cylindrical casing around the fan impeller.', function: 'Guides the air through the fan (and guards the blades).', outer: true, explode: [0.55, 0, 0], stage: 1, anchor: [1.65, 0.75, 0], related: ['load'] },
  { id: 'load', label: 'Load: fan impeller', what: 'A six-blade axial fan on the shaft end.', function: 'The mechanical load. A fan needs a torque that rises with the square of speed (TL ∝ ω²), plus a little constant friction torque.', explode: [0.35, 0, 0], stage: 2, anchor: [1.65, -0.62, 0.3], related: ['shaft', 'fan-housing'] },
]

export const ML_LAYERS: LayerInfo[] = [
  { id: 'torque', label: 'Torques', legend: 'Amber: the motor torque Tm drives the shaft at the coupling; the load torque TL (fan + friction) acts against the rotation at the fan. Their difference accelerates the inertia: J·dω/dt = Tm − TL.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the shaft turns counter-clockwise seen from the fan end; every part on it turns at the same speed.', conceptual: false },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: electrical power into the motor → shaft power T·ω through the coupling → the fan → the air. The flywheel only stores energy (½·J·ω²) while the speed changes.', conceptual: true },
]

export const ML_STEPS: MachineStep[] = [
  {
    id: 'blocks',
    title: '1 · Motor, coupling, shaft, load',
    text: 'An electric motor drives a line shaft through a flexible jaw coupling. The shaft runs in two pillow-block bearings, carries a flywheel and ends in a fan — the mechanical load. All rotating parts turn at the same speed ω, and the whole train is mounted on one baseplate so the shafts stay aligned.',
    focus: ['motor', 'coupling', 'shaft', 'bearings', 'flywheel', 'load'],
    layers: [],
  },
  {
    id: 'motor-curve',
    title: '2 · The motor\'s torque–speed line',
    text: 'The motor gives its largest torque Ts at standstill and none at its no-load speed ω0; in between (for a DC motor at fixed voltage, or an induction motor in its normal low-slip region) the torque falls almost linearly with speed. That line is the motor\'s characteristic.',
    focus: ['motor'],
    layers: ['torque'],
    equation: 'Tm(ω) = Ts · (1 − ω / ω0)',
    detail: 'An induction motor\'s full curve is not a straight line (it has a breakdown torque), but near its rated speed the straight line is a good model.',
  },
  {
    id: 'load-curve',
    title: '3 · The load\'s torque–speed curve',
    text: 'The fan needs a torque that grows with the square of speed (TL = k·ω²: twice the speed, four times the torque), plus a small constant friction torque Tc in the bearings and seals. Other loads behave differently: a hoist or a conveyor needs about constant torque at any speed.',
    focus: ['load', 'bearings'],
    layers: ['torque'],
    equation: 'TL(ω) = Tc + k · ω²',
  },
  {
    id: 'operating-point',
    title: '4 · The operating point',
    text: 'The shaft settles at the speed where the motor torque equals the load torque: Tm(ω) = TL(ω). Above that speed the load needs more torque than the motor gives and the shaft slows; below it the motor gives more and the shaft speeds up — so the point is stable. The power transmitted is P = T·ω.',
    focus: ['motor', 'coupling', 'load'],
    layers: ['torque', 'rotation'],
    rotate: true,
    equation: 'Ts·(1 − ω/ω0) = Tc + k·ω² ;  P = T · ω',
  },
  {
    id: 'inertia',
    title: '5 · Inertia: starting and speed changes',
    text: 'While the torques are unequal, their difference accelerates (or decelerates) the total inertia J of everything on the shaft: J·dω/dt = Tm − TL. At start the acceleration is (Ts − Tc)/J. A heavy flywheel makes the start slower and makes speed dips smaller when the load changes, because it stores kinetic energy ½·J·ω². It does not change the final operating point.',
    focus: ['flywheel', 'shaft'],
    layers: ['torque', 'rotation'],
    rotate: true,
    equation: 'J · dω/dt = Tm − TL ;  E = ½ · J · ω²',
    detail: 'Linearised about the operating point the speed settles with the time constant τ = J / (Ts/ω0 + 2k·ω*) — exact for a constant load (k = 0).',
  },
  {
    id: 'power',
    title: '6 · Power through the coupling',
    text: 'In steady state the same torque passes the coupling, the shaft and the fan, at the same speed: the shaft power T·ω flows from the motor to the fan, which gives it to the air (and a little to friction heat in the bearings). The motor draws more electrical power than T·ω because of its own losses.',
    focus: ['coupling', 'shaft', 'load', 'motor'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'P_shaft = T · ω   (ω = 2π·n / 60)',
  },
]

export const ML_PARAMS: MachineParam[] = [
  { id: 'ts', label: 'Motor stall torque Ts', unit: 'N·m', min: 5, max: 100, step: 1, value: 40 },
  { id: 'n0', label: 'Motor no-load speed n0', unit: 'rpm', min: 300, max: 3000, step: 10, value: 1500 },
  { id: 'kf', label: 'Fan coefficient k (TL = k·ω²)', unit: 'N·m·s²', min: 0, max: 0.001, step: 0.00005, value: 0.0004 },
  { id: 'tc', label: 'Constant friction torque Tc', unit: 'N·m', min: 0, max: 40, step: 0.5, value: 5 },
  { id: 'j', label: 'Total inertia J', unit: 'kg·m²', min: 0.02, max: 2, step: 0.01, value: 0.3, level: 'standard' },
]

export function mlCalc(p: Record<string, number>): CalcResult[] {
  const r = motorLoad({ ts: p.ts, n0: p.n0, tc: p.tc, kf: p.kf, j: p.j })
  if (!r) return []
  const no = r.starts ? undefined : 'The constant load torque is at or above the stall torque: the motor cannot start.'
  return [
    { id: 'n', label: 'Operating speed n*', value: r.starts ? r.n : null, unit: 'rpm', formula: 'k·ω² + (Ts/ω0)·ω + (Tc − Ts) = 0  →  ω*', note: no },
    { id: 't', label: 'Shaft torque T*', value: r.t, unit: 'N·m', formula: 'T* = Ts·(1 − ω*/ω0) = Tc + k·ω*²' },
    { id: 'p', label: 'Shaft power', value: r.starts ? r.p / 1000 : null, unit: 'kW', formula: 'P = T* · ω*' },
    { id: 'alpha0', label: 'Acceleration at start', value: r.starts ? r.alpha0 : null, unit: 'rad/s²', formula: 'α0 = (Ts − Tc) / J' },
    { id: 'tau', label: 'Speed time constant τ', value: r.tau, unit: 's', formula: 'τ = J / (Ts/ω0 + 2k·ω*)  (linearised)' },
    { id: 'ke', label: 'Stored kinetic energy', value: r.starts ? r.ke / 1000 : null, unit: 'kJ', formula: 'E = ½ · J · ω*²' },
  ]
}

export const ML_CONTENT: MachineContent = {
  overview: 'A drive is always a motor and a load together: the speed it runs at is not set by the motor alone but by where the motor\'s torque–speed line meets the load\'s torque–speed curve. Between them, the inertia decides how fast the speed can change.',
  construction: 'Motor on a baseplate; flexible jaw coupling (under a guard); line shaft in two pillow-block bearings; a flywheel; an axial fan as the load inside its housing.',
  principle: 'Torque balance on the shaft: J·dω/dt = Tm(ω) − TL(ω). In steady state Tm = TL and the shaft power is P = T·ω. The operating point is stable when the load torque rises faster with speed than the motor torque does.',
  equations: [
    { expr: 'J · dω/dt = Tm − TL', meaning: 'Newton\'s law for rotation: the torque difference accelerates the inertia.' },
    { expr: 'Tm = Ts · (1 − ω/ω0)', meaning: 'Linear motor characteristic (stall torque Ts, no-load speed ω0).' },
    { expr: 'TL = Tc + k · ω²', meaning: 'Constant friction plus a fan (square-law) load.' },
    { expr: 'P = T · ω', meaning: 'Shaft power, with ω = 2π·n/60.' },
    { expr: 'E = ½ · J · ω²', meaning: 'Kinetic energy stored in the rotating parts.' },
  ],
  assumptions: ['Rigid shaft and coupling (no torsional oscillation).', 'Linear motor characteristic (fixed supply voltage/frequency).', 'Load = constant friction + ideal fan law.', 'J is the total inertia referred to the shaft (motor rotor + coupling + flywheel + fan).'],
  characteristics: ['Higher load torque → lower operating speed (along the motor line).', 'More inertia → slower start and smaller dips, same final speed.', 'A fan load needs much more power at higher speed (P ∝ ω³).'],
  losses: ['Motor losses (not in the shaft balance).', 'Bearing and seal friction (part of Tc).', 'Coupling losses (small).'],
  advantages: ['A flywheel smooths pulsating loads and limits speed dips.', 'A flexible coupling tolerates small misalignment and shocks.'],
  limitations: ['A large inertia lengthens the start and heats the motor during it.', 'Misalignment wears bearings and couplings.', 'Above the stall torque (constant part) the motor cannot start the load.'],
  applications: ['Fans, pumps, compressors', 'Conveyors and hoists (constant-torque loads)', 'Machine tools and presses (with flywheels)'],
  misconceptions: [
    'The motor does not "run at its rated speed" whatever happens: the load decides where on its characteristic it operates.',
    'A flywheel does not add energy: it stores and returns it while the speed changes.',
    'The same torque passes through a coupling in steady state — it does not amplify torque (a gearbox does, by trading speed).',
  ],
  sources: ['Standard drive mechanics (e.g. Dubey, Fundamentals of Electrical Drives; Mohan, Electric Drives).'],
}

export const ML_QUIZ: QuizItem[] = [
  { id: 'id-coupling', kind: 'identify', prompt: 'What is the highlighted part?', part: 'coupling', options: ['Flexible (jaw) coupling', 'Bearing', 'Flywheel', 'Brake'], answer: 0, explain: 'The jaw coupling joins the motor shaft to the load shaft and transmits the torque.' },
  { id: 'id-flywheel', kind: 'identify', prompt: 'What is the highlighted part?', part: 'flywheel', options: ['Flywheel', 'Fan', 'Pulley', 'Coupling'], answer: 0, explain: 'The flywheel adds inertia J and stores kinetic energy ½·J·ω².' },
  { id: 'predict-j', kind: 'predict', prompt: 'You fit a flywheel with twice the inertia. What happens to the final operating speed?', options: ['It stays the same; the start takes longer', 'It doubles', 'It halves', 'The motor cannot start'], answer: 0, explain: 'The operating point depends only on the torque curves (Tm = TL). Inertia only changes how fast the speed changes (α0 = (Ts − Tc)/J halves).', misconceptions: { 1: 'Inertia stores energy; it does not move the torque balance.' } },
  { id: 'predict-load', kind: 'predict', prompt: 'The fan coefficient k increases (a bigger fan). The operating speed…', options: ['falls; the torque rises', 'rises', 'stays the same'], answer: 0, explain: 'The load curve moves up: it meets the falling motor line at a lower speed and a higher torque.' },
  { id: 'order', kind: 'order', prompt: 'Order what happens after switching the motor on.', options: ['Tm > TL: the shaft accelerates (J·dω/dt > 0)', 'TL rises with speed, Tm falls', 'Tm = TL: the speed settles', 'Steady power P = T·ω flows to the load'], answer: 0, explain: 'The torque surplus accelerates the inertia until the curves meet; then the speed is constant and power flows at P = T·ω.' },
  { id: 'match-p', kind: 'match', prompt: 'A shaft carries 20 N·m at 1500 rpm. Its power is about…', options: ['3.1 kW', '30 kW', '0.31 kW', '1.5 kW'], answer: 0, explain: 'P = T·ω = 20 × 2π·1500/60 = 20 × 157 = 3142 W.' },
]
