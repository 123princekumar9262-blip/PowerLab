import { genset } from '../../calculations/systems.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Genset: diesel engine (prime mover) → flywheel → coupling → alternator → control panel → cables → load bank.
 * The shaft is the x axis (engine at −x, alternator at +x); it turns counter-clockwise seen from the alternator end.
 */

export const GS_PARTS: MachinePart[] = [
  { id: 'base-frame', label: 'Base frame (skid)', what: 'Two steel rails with cross members under the engine and the alternator.', function: 'Holds the engine and the alternator in line on one rigid base, so the shafts stay aligned; anti-vibration mounts sit between them and the base.', explode: [0, 0, 0], stage: 2, anchor: [0.9, -0.85, 0.5], related: ['fuel-tank'] },
  { id: 'fuel-tank', label: 'Fuel tank', what: 'The diesel tank built into the base frame.', function: 'Stores the chemical energy the engine converts. The fuel flow is what the governor adjusts.', explode: [0, -0.45, 0], stage: 1, anchor: [-1.4, -1.15, 0.5], related: ['engine'] },
  { id: 'radiator', label: 'Radiator', what: 'The cooling radiator at the free end of the engine.', function: 'Rejects the engine heat carried by the coolant — a large part of the fuel energy ends up here as heat.', explode: [-0.85, 0, 0], stage: 1, anchor: [-2.85, 0.75, 0], related: ['engine'] },
  { id: 'engine', label: 'Diesel engine (prime mover)', what: 'A four-cylinder diesel engine: crankcase, cylinder block and head, exhaust.', function: 'The prime mover: it burns fuel and delivers mechanical power T·ω on its crankshaft. Only part of the fuel energy becomes shaft power; the rest leaves as exhaust and coolant heat.', explode: [-0.55, 0, 0], stage: 2, anchor: [-1.75, 0.95, -0.35], related: ['governor', 'flywheel'] },
  { id: 'governor', label: 'Speed governor', what: 'The speed controller and its fuel-rack actuator on the engine.', function: 'Holds the speed — and so the frequency — constant: when the load rises and the speed starts to fall, it injects more fuel.', explode: [0, 0, 0.55], stage: 1, anchor: [-1.4, 0.25, 0.62], related: ['engine'] },
  { id: 'flywheel', label: 'Flywheel', what: 'A heavy steel disc on the crankshaft.', function: 'Smooths the pulsating torque of the cylinders and stores kinetic energy that limits the speed dip when a load is switched on.', explode: [-0.25, 0, 0], stage: 2, anchor: [-0.75, 0.72, 0.2], related: ['engine', 'coupling'] },
  { id: 'coupling', label: 'Flexible coupling', what: 'A disc coupling with a rubber element between the flywheel and the alternator rotor.', function: 'Transmits the torque from the engine to the alternator while absorbing small misalignment and torque pulsations.', explode: [0, 0, 0], stage: 2, anchor: [-0.47, -0.45, 0.3], related: ['flywheel', 'alternator'] },
  { id: 'alternator', label: 'Alternator', what: 'A brushless synchronous generator (see the alternator model for its inside).', function: 'Turns the shaft power into three-phase AC. Its frequency is set by the speed: f = P·n/120.', explode: [0.55, 0, 0], stage: 2, anchor: [0.45, -0.7, 0.62], related: ['avr', 'coupling'] },
  { id: 'avr', label: 'Voltage regulator (AVR) + exciter box', what: 'The automatic voltage regulator and excitation control on top of the alternator.', function: 'Adjusts the alternator field current to hold the output voltage as the load changes.', explode: [0, 0.55, 0], stage: 1, anchor: [0.6, 1.05, 0], related: ['alternator'] },
  { id: 'control-panel', label: 'Control panel + breaker', what: 'Meters (voltage, frequency, current), controls and the output circuit breaker.', function: 'Monitors the output and connects or disconnects the load; it protects the alternator against overload and short circuit.', explode: [0.9, 0.2, 0], stage: 2, anchor: [1.75, 0.85, 0], related: ['cables', 'alternator'] },
  { id: 'cables', label: 'Three-phase output cables', what: 'Three phase conductors from the breaker to the load.', function: 'Carry the electrical power to the load. Each carries an AC current; the three are 120° apart in time.', explode: [0, 0, 0], stage: 2, anchor: [2.55, -0.25, 0.32], related: ['control-panel', 'load'] },
  { id: 'load', label: 'Electrical load (load bank)', what: 'A resistive/inductive load bank — standing in for the consumers.', function: 'Takes the electrical power. Its demand sets the current, the counter-torque on the alternator and so the fuel the engine needs.', explode: [0.25, 0, -0.55], stage: 1, anchor: [3.4, 0.0, 0], related: ['cables'] },
]

export const GS_LAYERS: LayerInfo[] = [
  { id: 'energy', label: 'Energy flow', legend: 'Orange: fuel (chemical) power → shaft power T·ω → electrical power → load. Thin branches: the losses leaving as heat (exhaust and radiator for the engine; the alternator\'s own losses). Values from the Calculate tab, with the assumed efficiencies.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the shaft (flywheel, coupling, alternator rotor) turns counter-clockwise seen from the alternator end.', conceptual: false },
  { id: 'torque', label: 'Torques', legend: 'Amber: the engine torque drives the shaft; the alternator\'s electromagnetic counter-torque opposes it. Equal in steady state; the governor keeps them equal as the load changes.', conceptual: true },
  { id: 'current', label: 'Three-phase current', legend: 'Green dashes in the three output cables: AC currents that reverse every half-cycle, one after the other (a → b → c). The direction and pace are illustrations, not measurements.', conceptual: true },
]

export const GS_STEPS: MachineStep[] = [
  {
    id: 'blocks',
    title: '1 · The blocks of a genset',
    text: 'A diesel engine (the prime mover) and an alternator sit in line on one base frame, joined by a flywheel and a flexible coupling. A governor on the engine controls its speed; an automatic voltage regulator on the alternator controls its voltage. The output goes through the control panel and breaker to the load. The fuel tank is built into the base; the radiator cools the engine.',
    focus: ['engine', 'flywheel', 'coupling', 'alternator', 'governor', 'avr', 'control-panel', 'load'],
    layers: [],
  },
  {
    id: 'fuel',
    title: '2 · Fuel power becomes shaft power',
    text: 'The engine burns fuel and delivers a torque T at a speed ω on its crankshaft: the shaft power is P = T·ω. Only a fraction of the fuel power becomes shaft power — the rest leaves as heat in the exhaust and the radiator. The efficiency used here is an assumption you can change (a typical diesel is in the region of 35–40 % at full load, much less at light load).',
    focus: ['fuel-tank', 'engine', 'radiator', 'flywheel'],
    layers: ['energy'],
    equation: 'P_shaft = T · ω ;  P_fuel = P_shaft / η_engine (assumed)',
  },
  {
    id: 'frequency',
    title: '3 · Speed sets the frequency',
    text: 'The alternator\'s output frequency depends only on its speed and its number of poles: f = P·n/120. A 4-pole alternator must turn at exactly 1500 rpm for 50 Hz (1800 rpm for 60 Hz). That is why the governor holds the speed constant whatever the load.',
    focus: ['governor', 'flywheel', 'alternator'],
    layers: ['rotation'],
    rotate: true,
    equation: 'f = P · n / 120',
  },
  {
    id: 'voltage',
    title: '4 · Excitation sets the voltage',
    text: 'The voltage regulator measures the output voltage and adjusts the alternator\'s field current. More field current → more flux → more EMF. It keeps the voltage at its set value (e.g. 400 V line-to-line) as the load changes; it does not change the frequency.',
    focus: ['avr', 'alternator', 'control-panel'],
    layers: ['current'],
    rotate: true,
  },
  {
    id: 'load',
    title: '5 · A load means a counter-torque',
    text: 'Switch on the load: currents flow in the cables and the alternator winding, and the alternator produces a counter-torque on the shaft. The engine must now deliver that torque. For a moment the shaft slows (the flywheel gives up some of its energy), the governor sees the speed fall and opens the fuel rack until the engine torque again balances the counter-torque.',
    focus: ['load', 'alternator', 'engine', 'governor'],
    layers: ['torque', 'current', 'rotation'],
    rotate: true,
    equation: 'T_engine = T_counter  (steady state) ;  P_elec = √3·VL·IL·cos φ',
  },
  {
    id: 'chain',
    title: '6 · The efficiency chain',
    text: 'Each conversion loses something. Stages in series multiply: η_total = η_engine × η_alternator. With the example values (assumptions, not data for a real unit) of 38 % and 93 %, only about 35 % of the fuel power reaches the load; the rest is heat. Change them in the Calculate tab to see each stage\'s loss.',
    focus: ['engine', 'alternator', 'radiator'],
    layers: ['energy'],
    equation: 'η_total = Π η_i = η_engine · η_alt',
  },
  {
    id: 'transient',
    title: '7 · Load steps and limits',
    text: 'A sudden large load makes the speed — and the frequency — dip before the governor catches up; the flywheel\'s inertia limits the dip. The engine\'s maximum torque limits the active power (kW); the alternator\'s current and heating limit the apparent power (kVA), so a poor power factor uses up the alternator\'s rating without delivering more kW.',
    focus: ['flywheel', 'governor', 'alternator', 'control-panel'],
    layers: ['torque', 'rotation'],
    rotate: true,
    equation: 'S = P / cos φ ;  IL = P / (√3 · VL · cos φ)',
  },
]

export const GS_PARAMS: MachineParam[] = [
  { id: 'torque', label: 'Engine torque T', unit: 'N·m', min: 0, max: 1200, step: 10, value: 600 },
  { id: 'n', label: 'Shaft speed n', unit: 'rpm', min: 600, max: 3600, step: 10, value: 1500 },
  { id: 'poles', label: 'Alternator poles P', unit: '', min: 2, max: 8, step: 2, value: 4, options: [2, 4, 6, 8] },
  { id: 'etaEngine', label: 'Engine efficiency η_engine (assumed)', unit: '', min: 0.25, max: 0.45, step: 0.01, value: 0.38 },
  { id: 'etaAlt', label: 'Alternator efficiency η_alt (assumed)', unit: '', min: 0.85, max: 0.97, step: 0.01, value: 0.93 },
  { id: 'vline', label: 'Output line voltage VL', unit: 'V', min: 200, max: 690, step: 5, value: 400, level: 'standard' },
  { id: 'pf', label: 'Load power factor cos φ', unit: '', min: 0.5, max: 1, step: 0.01, value: 0.8, level: 'standard' },
]

export function gsCalc(p: Record<string, number>): CalcResult[] {
  const r = genset({ torque: p.torque, n: p.n, poles: p.poles, etaEngine: p.etaEngine, etaAlt: p.etaAlt, vline: p.vline, pf: p.pf })
  if (!r) return []
  return [
    { id: 'f', label: 'Output frequency f', value: r.f, unit: 'Hz', formula: 'f = P · n / 120', note: Math.abs(r.f - 50) > 0.05 ? `For 50 Hz this alternator must turn at ${r.nFor50.toFixed(0)} rpm.` : undefined },
    { id: 'pshaft', label: 'Shaft power', value: r.pShaft / 1000, unit: 'kW', formula: 'P = T · ω,  ω = 2π·n / 60' },
    { id: 'pfuel', label: 'Fuel power in', value: r.pFuel / 1000, unit: 'kW', formula: 'P_fuel = P_shaft / η_engine' },
    { id: 'pelec', label: 'Electrical power out', value: r.pElec / 1000, unit: 'kW', formula: 'P_elec = η_alt · P_shaft' },
    { id: 'lossEngine', label: 'Engine heat (exhaust, coolant)', value: r.lossEngine / 1000, unit: 'kW', formula: 'P_fuel − P_shaft' },
    { id: 'lossAlt', label: 'Alternator losses', value: r.lossAlt / 1000, unit: 'kW', formula: 'P_shaft − P_elec' },
    { id: 'eta', label: 'Overall efficiency', value: r.etaTotal, unit: '%', formula: 'η_total = η_engine · η_alt', note: 'Both efficiencies are assumed example values, not data for a real unit.' },
    { id: 'i', label: 'Line current', value: r.iLine, unit: 'A', formula: 'IL = P_elec / (√3 · VL · cos φ)' },
    { id: 's', label: 'Apparent power', value: r.sApparent / 1000, unit: 'kVA', formula: 'S = P_elec / cos φ' },
  ]
}

export const GS_CONTENT: MachineContent = {
  overview: 'A generating set (genset) is a prime mover — here a diesel engine — driving an alternator on a common base. The governor holds the speed so the frequency stays at 50 (or 60) Hz; the voltage regulator holds the voltage. Every kilowatt delivered to the load must come from the fuel, through a chain of conversions that each lose some energy.',
  construction: 'Engine with radiator, governor and flywheel; a flexible coupling; a (usually brushless, single-bearing) alternator with an AVR; a control panel with meters and the output breaker; base frame with built-in fuel tank. The alternator is drawn here as a block — open the alternator model to see inside it.',
  principle: 'Fuel → shaft power (P = T·ω) in the engine → electrical power (f = P·n/120) in the alternator. The load current makes a counter-torque; the governor adjusts the fuel so the engine torque matches it at constant speed. The AVR adjusts the field current to keep the voltage.',
  equations: [
    { expr: 'P_shaft = T · ω', meaning: 'Mechanical power on a shaft: torque × angular speed (ω = 2π·n/60).' },
    { expr: 'f = P · n / 120', meaning: 'The alternator frequency from its poles and the shaft speed.' },
    { expr: 'η_total = η_engine · η_alt', meaning: 'Efficiencies of stages in series multiply.' },
    { expr: 'P_elec = √3 · VL · IL · cos φ', meaning: 'Three-phase active power delivered.' },
    { expr: 'S = P / cos φ', meaning: 'Apparent power (kVA) that loads the alternator\'s current rating.' },
  ],
  assumptions: ['Steady state at constant speed.', 'Efficiencies are constant example values (assumptions): real efficiencies vary with load and speed.', 'Balanced three-phase load.', 'No auxiliary loads (fans, pumps, battery charger) included.'],
  characteristics: ['Frequency fixed by speed: the governor is the frequency controller.', 'Voltage held by the AVR through the field current.', 'Fuel consumption rises with the electrical load.', 'A load step causes a temporary speed (frequency) dip.'],
  losses: ['Engine: exhaust heat, coolant heat (radiator), friction — most of the fuel energy.', 'Alternator: copper, iron, excitation, windage and friction losses.', 'Coupling and bearing friction (small).'],
  advantages: ['Independent power where there is no grid, or as standby.', 'Starts and takes load within seconds.', 'Frequency and voltage controlled locally.'],
  limitations: ['Low overall efficiency; fuel cost and emissions.', 'Poor efficiency at light load.', 'Large load steps cause frequency and voltage dips.', 'Noise, maintenance and fuel logistics.'],
  applications: ['Standby power for hospitals, data centres, telecom', 'Remote sites, construction, mining', 'Ships (diesel-electric)', 'Islanded micro-grids'],
  misconceptions: [
    'The alternator does not "make" energy: every kilowatt out needs more than a kilowatt of fuel power in.',
    'The governor, not the AVR, holds the frequency: frequency follows speed.',
    'Raising the field current at constant speed raises the voltage, not the frequency.',
  ],
  sources: ['Standard relations P = T·ω, f = P·n/120, three-phase power; typical diesel efficiency ranges from engineering handbooks (used here only as adjustable assumptions).'],
}

export const GS_QUIZ: QuizItem[] = [
  { id: 'id-governor', kind: 'identify', prompt: 'What is the highlighted part?', part: 'governor', options: ['Speed governor', 'Voltage regulator', 'Fuel tank', 'Coupling'], answer: 0, explain: 'The governor controls the fuel to hold the speed — and so the frequency.', misconceptions: { 1: 'The voltage regulator sits on the alternator and controls its field current.' } },
  { id: 'id-flywheel', kind: 'identify', prompt: 'What is the highlighted part?', part: 'flywheel', options: ['Flywheel', 'Radiator fan', 'Alternator rotor', 'Brake disc'], answer: 0, explain: 'The flywheel stores kinetic energy, smoothing the engine torque and limiting speed dips at load steps.' },
  { id: 'predict-freq', kind: 'predict', prompt: 'A 4-pole genset slows from 1500 to 1470 rpm under a sudden load. The frequency…', options: ['falls to 49 Hz', 'stays at 50 Hz', 'rises', 'falls to 25 Hz'], answer: 0, explain: 'f = P·n/120 = 4·1470/120 = 49 Hz — until the governor restores the speed.' },
  { id: 'predict-fuel', kind: 'predict', prompt: 'The electrical load doubles (same speed and voltage). The fuel flow…', options: ['roughly doubles', 'stays the same', 'halves'], answer: 0, explain: 'The counter-torque doubles, so the engine must deliver twice the torque and burn about twice the fuel (efficiency roughly constant near rated load).' },
  { id: 'order-chain', kind: 'order', prompt: 'Order the energy conversions.', options: ['Chemical energy in the fuel', 'Shaft power in the engine (T·ω)', 'Electrical power in the alternator', 'Power taken by the load'], answer: 0, explain: 'Fuel → mechanical → electrical → load; each stage loses some energy as heat.' },
  { id: 'match-eta', kind: 'match', prompt: 'Engine 40 % and alternator 90 % (assumed). The overall efficiency is…', options: ['36 %', '130 %', '50 %', '90 %'], answer: 0, explain: 'Efficiencies in series multiply: 0.40 × 0.90 = 0.36.', misconceptions: { 1: 'Efficiencies are never added; and no chain can exceed 100 %.' } },
]
