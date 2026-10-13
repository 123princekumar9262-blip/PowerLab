import { inverterMotor } from '../../calculations/systems.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Battery → DC cables → inverter (DC link, six switches, controller) → three AC cables → motor → shaft.
 * Energy flows along +x. Shaft = x axis of the motor; positive rotation = counter-clockwise seen from the shaft end.
 */

export const IM_PARTS: MachinePart[] = [
  { id: 'battery', label: 'Battery pack', what: 'A DC battery: modules of cells in a case, with + (red) and − (black) terminals.', function: 'The energy source: it delivers a DC voltage Vdc and a current Idc = P/Vdc to the inverter (and takes current back when braking).', explode: [-0.35, 0, 0], stage: 1, anchor: [-2.6, 0.2, 0], related: ['dc-cables'] },
  { id: 'dc-cables', label: 'DC cables (+ / −)', what: 'Two heavy cables from the battery to the inverter\'s DC input.', function: 'Carry the DC current. Their resistance and inductance matter at high current — which is why the inverter has its own DC-link capacitor close to the switches.', explode: [0, 0, 0], stage: 1, anchor: [-1.5, -0.42, 0.35], related: ['battery', 'dc-link'] },
  { id: 'inverter-housing', label: 'Inverter housing + heat sink', what: 'The enclosure with cooling fins on top.', function: 'Protects the electronics and carries the switching and conduction losses of the switches away as heat.', outer: true, explode: [0, 0.95, 0], stage: 1, anchor: [-0.45, 0.55, 0.35], related: ['power-switches'] },
  { id: 'dc-link', label: 'DC-link capacitors', what: 'Film or electrolytic capacitors across the DC input, right next to the switches.', function: 'Hold the DC voltage steady and supply the fast pulsed current the switches draw, so the battery cables carry a smooth current.', explode: [0, 0, 0.7], stage: 2, anchor: [-0.75, 0.12, 0.28], related: ['power-switches', 'dc-cables'] },
  { id: 'power-switches', label: 'Power switches (3 legs × 2)', what: 'Six power transistors (IGBTs or MOSFETs) in three half-bridge legs, one leg per phase.', function: 'Each leg connects its phase output alternately to + and − many thousands of times a second (PWM). Averaged, each phase voltage follows a sine wave; the three legs are 120° apart, giving three-phase AC.', explode: [0, 0, -0.7], stage: 2, anchor: [-0.2, -0.3, -0.35], related: ['dc-link', 'controller'] },
  { id: 'controller', label: 'Controller + gate drivers', what: 'The control board: microcontroller, current and position sensing, gate drivers.', function: 'Decides when each switch turns on and off — the modulation index m (voltage) and the frequency f — to give the torque and speed asked for.', explode: [0, 0.45, 0], stage: 2, anchor: [-0.45, 0.22, -0.32], related: ['power-switches'] },
  { id: 'ac-cables', label: 'Three-phase AC cables', what: 'Three cables from the inverter\'s outputs to the motor terminals.', function: 'Carry the three phase currents, each alternating, 120° apart in time.', explode: [0, 0, 0], stage: 1, anchor: [0.75, 0.55, 0.3], related: ['motor', 'power-switches'] },
  { id: 'motor', label: 'AC motor', what: 'A three-phase motor (permanent-magnet synchronous or induction) drawn as a block.', function: 'Its stator currents make a rotating field; the rotor follows it and produces torque. It turns electrical power into shaft power T·ω.', explode: [0.45, 0, 0], stage: 1, anchor: [1.55, -0.62, 0.45], related: ['ac-cables', 'shaft'] },
  { id: 'shaft', label: 'Output shaft + load hub', what: 'The motor shaft and a hub to couple the load.', function: 'Delivers the mechanical power T·ω to the load.', explode: [0.75, 0, 0], stage: 2, anchor: [2.6, 0.38, 0], related: ['motor'] },
]

export const IM_LAYERS: LayerInfo[] = [
  { id: 'energy', label: 'Energy flow', legend: 'Orange: DC power from the battery → AC power from the inverter → shaft power from the motor. Thin branches rising: the inverter\'s and the motor\'s losses leaving as heat. Values from the calculation with the assumed efficiencies.', conceptual: true },
  { id: 'current', label: 'Currents', legend: 'Green: a steady DC current out of the + terminal and back into the − terminal; in the three AC cables, currents that reverse every half-cycle in the sequence a → b → c (illustrated, not measured).', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the motor shaft turns counter-clockwise seen from the shaft end.', conceptual: false },
]

export const IM_STEPS: MachineStep[] = [
  {
    id: 'blocks',
    title: '1 · From a battery to a turning shaft',
    text: 'Four blocks in a row: a battery gives DC; an inverter turns the DC into three-phase AC of adjustable voltage and frequency; three cables take it to an AC motor; the motor turns its shaft. A controller inside the inverter decides how the switches operate.',
    focus: ['battery', 'power-switches', 'ac-cables', 'motor'],
    layers: [],
  },
  {
    id: 'dc',
    title: '2 · The DC side',
    text: 'The battery holds a nearly constant voltage Vdc. The power the motor needs sets the current: Idc = P_dc / Vdc. The DC-link capacitors next to the switches deliver the fast current pulses of the switching, so the battery cables carry an almost smooth current.',
    focus: ['battery', 'dc-cables', 'dc-link'],
    layers: ['current', 'energy'],
    equation: 'P_dc = Vdc · Idc',
  },
  {
    id: 'switching',
    title: '3 · Six switches make three-phase AC',
    text: 'Each of the three legs connects its output to + or − of the DC link, switching thousands of times a second. By varying the time spent at + (pulse-width modulation), the average voltage of each output follows a sine wave; the three legs are shifted by 120°. The controller sets the amplitude (modulation index m) and the frequency f.',
    focus: ['power-switches', 'controller', 'ac-cables'],
    layers: ['current'],
    rotate: true,
    equation: 'V_LL,rms ≈ 0.612 · m · Vdc   (sine PWM, m ≤ 1)',
    detail: '0.612 = √3/(2√2). Third-harmonic injection or space-vector PWM raise the usable voltage by about 15 % (to Vdc/√2 line-to-line rms).',
  },
  {
    id: 'motor',
    title: '4 · The motor turns AC into torque',
    text: 'The three currents make a field that rotates at the inverter\'s frequency. A synchronous (PM) motor turns exactly with it: n = 120·f/P. Its torque is set by the current; the shaft power is P = T·ω. Changing the inverter frequency changes the speed — that is how the inverter controls the motor.',
    focus: ['motor', 'shaft', 'ac-cables'],
    layers: ['rotation', 'current'],
    rotate: true,
    equation: 'P_shaft = T · ω ;  f = P · n / 120',
  },
  {
    id: 'chain',
    title: '5 · Losses along the chain',
    text: 'Each block loses some power as heat: the switches (conduction and switching losses) and the motor (copper, iron, friction). Stages in series multiply: P_shaft = η_motor · η_inverter · P_dc. The efficiencies used here are example values you set (assumptions, not data for a product).',
    focus: ['inverter-housing', 'motor'],
    layers: ['energy'],
    equation: 'η_total = η_inv · η_motor ;  P_dc = P_shaft / η_total',
  },
  {
    id: 'control',
    title: '6 · The controller closes the loop',
    text: 'The driver asks for torque (or speed). The controller measures the phase currents and the rotor position, compares them with the demand and adjusts the switching every PWM period — field-oriented control for a PM motor. The battery current follows automatically from the power drawn.',
    focus: ['controller', 'power-switches', 'motor'],
    layers: ['current'],
    detail: 'The Drives & Motors lab simulates exactly this loop (PMSM with field-oriented control) with a validated circuit model.',
  },
]

export const IM_PARAMS: MachineParam[] = [
  { id: 'torque', label: 'Shaft torque T', unit: 'N·m', min: 0, max: 300, step: 1, value: 120 },
  { id: 'n', label: 'Motor speed n', unit: 'rpm', min: 0, max: 8000, step: 50, value: 3000 },
  { id: 'vdc', label: 'Battery voltage Vdc', unit: 'V', min: 48, max: 800, step: 4, value: 400 },
  { id: 'm', label: 'Modulation index m', unit: '', min: 0, max: 1, step: 0.01, value: 0.9, level: 'standard' },
  { id: 'poles', label: 'Motor poles P', unit: '', min: 2, max: 8, step: 2, value: 8, options: [2, 4, 6, 8], level: 'standard' },
  { id: 'etaInv', label: 'Inverter efficiency η_inv (assumed)', unit: '', min: 0.9, max: 0.995, step: 0.005, value: 0.97 },
  { id: 'etaMotor', label: 'Motor efficiency η_motor (assumed)', unit: '', min: 0.8, max: 0.97, step: 0.01, value: 0.93 },
]

export function imCalc(p: Record<string, number>): CalcResult[] {
  const r = inverterMotor({ vdc: p.vdc, torque: p.torque, n: p.n, m: p.m, poles: p.poles, etaInv: p.etaInv, etaMotor: p.etaMotor })
  if (!r) return []
  return [
    { id: 'pshaft', label: 'Shaft power', value: r.pShaft / 1000, unit: 'kW', formula: 'P_shaft = T · ω,  ω = 2π·n / 60' },
    { id: 'pac', label: 'AC power into the motor', value: r.pAc / 1000, unit: 'kW', formula: 'P_ac = P_shaft / η_motor' },
    { id: 'pdc', label: 'DC power from the battery', value: r.pDc / 1000, unit: 'kW', formula: 'P_dc = P_ac / η_inv' },
    { id: 'idc', label: 'Battery current Idc', value: r.idc, unit: 'A', formula: 'Idc = P_dc / Vdc' },
    { id: 'lossInv', label: 'Inverter losses', value: r.lossInv / 1000, unit: 'kW', formula: 'P_dc − P_ac' },
    { id: 'lossMotor', label: 'Motor losses', value: r.lossMotor / 1000, unit: 'kW', formula: 'P_ac − P_shaft' },
    { id: 'eta', label: 'Battery-to-shaft efficiency', value: r.etaTotal, unit: '%', formula: 'η_total = η_inv · η_motor', note: 'Both efficiencies are assumed example values.' },
    { id: 'vll', label: 'Fundamental line voltage', value: r.vll, unit: 'V', formula: 'V_LL,rms = (√3 / 2√2) · m · Vdc ≈ 0.612·m·Vdc', note: 'Sine PWM in its linear range. Whether it is enough at this speed depends on the motor\'s EMF (not modelled here).' },
    { id: 'f', label: 'Inverter frequency (synchronous motor)', value: r.f, unit: 'Hz', formula: 'f = P · n / 120' },
    { id: 'iac', label: 'Phase current (at cos φ = 1)', value: r.iac, unit: 'A', formula: 'I = P_ac / (√3 · V_LL)', note: 'A lower bound: a real motor has cos φ < 1 and draws more current.' },
  ]
}

export const IM_CONTENT: MachineContent = {
  overview: 'An inverter is what lets a battery drive an AC motor: six electronic switches chop the DC into three-phase AC whose voltage and frequency the controller sets. The motor turns that AC into torque; every block on the way loses a little power as heat.',
  construction: 'Battery pack with + and − terminals; DC cables; inverter: DC-link capacitors, three half-bridge legs of power switches (IGBTs or MOSFETs) on a heat sink, a control board with gate drivers and sensors; three AC cables; a three-phase motor; the output shaft.',
  principle: 'Pulse-width modulation makes the average voltage of each inverter output a sine wave; three legs 120° apart give a three-phase set. The motor\'s rotating field follows the inverter frequency, and its torque follows the current. Power balance: P_dc = P_shaft / (η_inv·η_motor).',
  equations: [
    { expr: 'P_dc = Vdc · Idc', meaning: 'DC power drawn from the battery.' },
    { expr: 'V_LL,rms = 0.612 · m · Vdc', meaning: 'Fundamental line voltage of sine-triangle PWM (linear range, m ≤ 1).' },
    { expr: 'f = P · n / 120', meaning: 'Frequency a synchronous motor needs at speed n.' },
    { expr: 'P_shaft = T · ω', meaning: 'Mechanical output power.' },
    { expr: 'η_total = η_inv · η_motor', meaning: 'Efficiencies of stages in series multiply.' },
  ],
  assumptions: ['Steady state: constant torque and speed.', 'Efficiencies are constant example values (assumptions).', 'Sine-triangle PWM in its linear range (m ≤ 1).', 'The motor is a block: whether its EMF and the available voltage allow the chosen speed is not checked here.'],
  characteristics: ['Battery current rises with shaft power and falls with battery voltage.', 'Motor speed follows the inverter frequency.', 'Inverter output voltage scales with m and Vdc.'],
  losses: ['Inverter: conduction and switching losses in the switches, capacitor and busbar losses.', 'Motor: stator copper loss, iron loss, friction and windage (and rotor loss in an induction motor).', 'Cable resistance losses.'],
  advantages: ['Full control of speed and torque from a fixed DC source.', 'Allows regenerative braking (power can flow back).', 'No brushes: AC motors are robust and efficient.'],
  limitations: ['Switching produces voltage steps (dv/dt), electromagnetic noise and losses.', 'Needs cooling of the switches.', 'Maximum voltage limited by the DC link (field weakening above base speed).'],
  applications: ['Electric vehicles', 'Industrial variable-speed drives', 'Solar and battery storage systems (as grid inverters)', 'Drones, e-bikes, appliances'],
  misconceptions: [
    'The inverter does not "create" power: P_dc ≥ P_ac ≥ P_shaft; it only converts the form.',
    'The battery current is not the motor phase current: power is conserved (minus losses), not current.',
    'PWM output is not a smooth sine voltage: it is a fast train of pulses whose average follows a sine; the motor\'s inductance smooths the current.',
  ],
  sources: ['Standard power-electronics relations (e.g. Mohan, Undeland & Robbins, Power Electronics; Holmes & Lipo, Pulse Width Modulation for Power Converters).'],
}

export const IM_QUIZ: QuizItem[] = [
  { id: 'id-switches', kind: 'identify', prompt: 'What is the highlighted part?', part: 'power-switches', options: ['Power switches (three legs)', 'DC-link capacitors', 'Battery modules', 'Controller'], answer: 0, explain: 'Six transistors in three half-bridge legs: they chop the DC into three-phase AC.' },
  { id: 'id-dclink', kind: 'identify', prompt: 'What is the highlighted part?', part: 'dc-link', options: ['DC-link capacitors', 'Motor windings', 'Fuses', 'Power switches'], answer: 0, explain: 'The DC-link capacitors hold the DC voltage and supply the switching current pulses.' },
  { id: 'predict-idc', kind: 'predict', prompt: 'Same shaft power, but the battery voltage is doubled. The battery current…', options: ['halves', 'doubles', 'stays the same'], answer: 0, explain: 'Idc = P_dc / Vdc: for the same power, twice the voltage needs half the current (and the cables lose a quarter of the I²R heat).' },
  { id: 'predict-speed', kind: 'predict', prompt: 'The controller doubles the inverter frequency (PM synchronous motor). The motor speed…', options: ['doubles', 'stays the same', 'halves'], answer: 0, explain: 'A synchronous motor turns with its rotating field: n = 120·f/P.' },
  { id: 'order', kind: 'order', prompt: 'Order the power conversions.', options: ['Battery: DC power Vdc·Idc', 'Inverter: three-phase AC (PWM)', 'Motor: rotating field and torque', 'Shaft: mechanical power T·ω'], answer: 0, explain: 'DC → AC in the inverter → torque in the motor → shaft power.' },
  { id: 'match-eta', kind: 'match', prompt: 'Inverter 97 %, motor 93 % (assumed). For 30 kW at the shaft the battery delivers about…', options: ['33.3 kW', '30 kW', '27.1 kW', '57 kW'], answer: 0, explain: 'P_dc = 30 / (0.97 × 0.93) = 30 / 0.902 ≈ 33.3 kW.', misconceptions: { 2: '27.1 kW = 30 × 0.902: that would be the shaft power from 30 kW of battery power — the chain divides going backwards.' } },
]
