import { imBreakdown, imOperating, imPoint, IM_EXAMPLE, syncRad, vPhaseVf } from '../../../calculations/induction.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'
import { imCalc } from '../content.ts'

/*
 * Wound-rotor (slip-ring) induction motor — content and calculations. Same stator and the same per-phase circuit
 * as the cage model; the rotor carries a three-phase star winding brought out through three slip rings, so an
 * external resistance can be added per phase (referred to the stator in the calculation).
 */

export const WR_PARTS: MachinePart[] = [
  { id: 'frame', label: 'Frame with cooling fins', what: 'The cast outer frame with fins and feet.', function: 'Holds the stator core and the end shields and carries the heat away.', outer: true, explode: [-2.7, 0, 0], stage: 3, anchor: [0.9, 1.0, 0.6], related: ['stator-core'] },
  { id: 'terminal-box', label: 'Stator terminal box', what: 'The box with the stator winding ends (U V W).', function: 'Where the three-phase supply is connected to the stator.', outer: true, explode: [-2.7, 0.75, 0], stage: 3, anchor: [0, 1.62, 0.15], related: ['stator-winding'] },
  { id: 'end-shield-front', label: 'Drive-end shield', what: 'The end cover at the shaft end.', function: 'Holds the drive-end bearing and keeps the rotor centred.', outer: true, explode: [-1.0, -1.15, 1.0], stage: 1, anchor: [-0.75, 0.7, 1.05], related: ['bearings'] },
  { id: 'end-shield-rear', label: 'Slip-ring-end shield', what: 'The end cover at the slip-ring end.', function: 'Holds the second bearing; the slip rings sit just outside it (normally under a cover).', outer: true, explode: [-2.7, 0, -0.25], stage: 3, anchor: [-0.75, -0.75, -1.05], related: ['bearings', 'slip-rings'] },
  { id: 'stator-core', label: 'Stator core (laminated)', what: 'Laminated electrical-steel core with 36 slots.', function: 'Carries the rotating flux; laminated against eddy currents. Identical to a cage motor’s stator.', explode: [-2.7, 0, 0], stage: 3, anchor: [-0.7, 0.75, 0.7], related: ['stator-winding'] },
  { id: 'stator-winding', label: 'Three-phase stator winding', what: 'Distributed three-phase winding (end turns red, yellow, blue).', function: 'Fed from the supply, it makes the field rotating at Ns = 120·f/P.', explode: [-2.7, 0, 0], stage: 3, anchor: [0.62, -0.62, 0.9], related: ['stator-core', 'terminal-box'] },
  { id: 'rotor-core', label: 'Rotor core (laminated)', what: 'Laminated rotor core with 24 slots for the rotor winding.', function: 'Carries the flux and holds the rotor winding.', explode: [0, 0, 0], stage: 3, anchor: [0.15, 0.56, -0.4], related: ['rotor-winding'] },
  { id: 'rotor-winding', label: 'Three-phase rotor winding', what: 'Insulated copper coils in the rotor slots, a three-phase star winding with the same number of poles as the stator (end turns in light phase colours).', function: 'The rotating field induces three-phase EMFs in it at the slip frequency f2 = s·f. Its three ends go to the slip rings, so the rotor circuit can be reached from outside.', explode: [0, 0, 0], stage: 3, anchor: [0.35, -0.42, 0.95], related: ['slip-rings', 'rotor-core'] },
  { id: 'slip-rings', label: 'Slip rings', what: 'Three insulated bronze rings on the shaft, one per rotor phase.', function: 'Turn with the rotor and give a sliding contact to each rotor phase. (Unlike a commutator, they do not switch anything.)', explode: [0, 0, -0.4], stage: 2, anchor: [0.3, -0.38, -1.5], related: ['brushes', 'rotor-winding'] },
  { id: 'brushes', label: 'Brushes', what: 'Three carbon brushes in holders, pressed on the slip rings.', function: 'Connect the turning rings to the stationary external circuit. They wear and need maintenance.', explode: [0, 0.8, 0], stage: 1, anchor: [0, 0.72, -1.5], related: ['slip-rings', 'resistors'] },
  { id: 'resistors', label: 'External rotor resistors', what: 'A star-connected bank of three resistors with a moving shorting bar (the rotor starter).', function: 'Add resistance to each rotor phase: more starting torque with less starting current, or a lower speed at a given load. The bar position follows Rext in the Calculate tab; at Rext = 0 the rings are short-circuited.', explode: [0, 0, 0], stage: 1, anchor: [2.25, 0.55, -1.7], related: ['brushes'] },
  { id: 'shaft', label: 'Shaft', what: 'The steel shaft, key at the drive end.', function: 'Carries the torque to the load and the slip rings at the other end.', explode: [0, 0, 0], stage: 3, anchor: [0, 0.2, 1.75], related: ['bearings'] },
  { id: 'bearings', label: 'Bearings', what: 'Two ball bearings in the end shields.', function: 'Keep the rotor centred in the bore.', explode: [0, 0, 0], stage: 1, anchor: [0.3, -0.3, 1.0], related: ['shaft'] },
]

export const WR_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Stator three-phase currents', legend: 'Cones at the stator slot mouths: the current in each slot, coloured by phase (a red, b yellow, c blue); out of the drive end = ⊙, into it = ⊗; length ∝ current. The card shows ia, ib, ic.', conceptual: true },
  { id: 'rotatingField', label: 'Rotating magnetic field', legend: 'Blue: the air-gap field (into the rotor at a stator N pole, out at an S pole) and flux paths, turning at Ns, a → b → c.', conceptual: true },
  { id: 'emf', label: 'Rotor EMF and current', legend: 'Magenta cones: induced current in the rotor conductors (⊗ under N, ⊙ under S), at the slip frequency. Magenta dashes: the rotor current leaving through the slip rings and brushes to the external resistors.', conceptual: true },
  { id: 'torque', label: 'Force and torque', legend: 'Amber: tangential force on the rotor conductors under each pole (in the field’s direction) and the torque on the rotor.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White: the rotor turns (Nr); blue outer arrow: the field (Ns), faster by the slip.', conceptual: false },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: input → air-gap power Pag → rotor circuit s·Pag (of which part is heat in the external resistors) → mechanical power (1 − s)·Pag at the shaft. Values from the Calculate tab.', conceptual: true },
]

export const WR_RMAX = 10
export const WR_PARAMS: MachineParam[] = [
  { id: 'rext', label: 'External rotor resistance Rext′ (per phase, referred)', unit: 'Ω', min: 0, max: WR_RMAX, step: 0.1, value: 0 },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 80, step: 1, value: 25 },
  { id: 'poles', label: 'Number of poles P', unit: '', min: 2, max: 4, step: 2, value: 4, options: [2, 4] },
  { id: 'f', label: 'Supply frequency f', unit: 'Hz', min: 10, max: 60, step: 1, value: 50, level: 'standard' },
]

export function wrCalc(p: Record<string, number>): CalcResult[] {
  const rext = p.rext
  const base = imCalc(p, { rext })
  const v = vPhaseVf(p.f)
  const op = imOperating(IM_EXAMPLE, p.f, v, p.poles, p.tl, rext)
  const bd = imBreakdown(IM_EXAMPLE, p.f, v, p.poles, rext)
  const r2 = IM_EXAMPLE.r2
  const extra: CalcResult[] = [
    { id: 'smax', label: 'Slip at pull-out torque s_max', value: bd.sMax, unit: '%', formula: 's_max = (R2′ + Rext′) / √(Rth² + (Xth + X2)²)', note: bd.sMax >= 1 ? 'Above 100 %: the maximum lies beyond standstill.' : undefined },
    { id: 'pext', label: 'Heat in the external resistors', value: op ? (op.pcu2 * rext) / (r2 + rext) : null, unit: 'W', formula: 'Pext = s·Pag · Rext′/(R2′ + Rext′)' },
  ]
  // insert after the rotor copper loss
  const k = base.findIndex((c) => c.id === 'pcu2')
  return [...base.slice(0, k + 1), ...extra, ...base.slice(k + 1)]
}

export function wrMotion(calc: Record<string, number | null>, params: Record<string, number>) {
  const w = syncRad(params.f, params.poles) / 50
  const s = calc.s
  return {
    omega: w,
    note:
      s === null
        ? 'The field turns at the calculated synchronous speed (slowed ×50); with this load the rotor would stall.'
        : `Field at Ns = ${Math.round(calc.ns ?? 0)} rpm, rotor at Nr = ${Math.round(calc.nr ?? 0)} rpm (s = ${((s ?? 0) * 100).toFixed(1)} %), both slowed down ×50. In the starting steps the rotor is shown at rest.`,
  }
}

// numbers quoted in the steps — computed from the same model
const DEF = Object.fromEntries(WR_PARAMS.map((x) => [x.id, x.value]))
const V = vPhaseVf(DEF.f)
const R_DEMO = 3
const st0 = imPoint(IM_EXAMPLE, DEF.f, V, DEF.poles, 1, 0)
const stR = imPoint(IM_EXAMPLE, DEF.f, V, DEF.poles, 1, R_DEMO)
const bd0 = imBreakdown(IM_EXAMPLE, DEF.f, V, DEF.poles, 0)
// the resistance that puts the pull-out torque at standstill (s_max = 1)
const rBest = bd0.sMax > 0 ? IM_EXAMPLE.r2 / bd0.sMax - IM_EXAMPLE.r2 : 0
const op0 = imOperating(IM_EXAMPLE, DEF.f, V, DEF.poles, DEF.tl, 0)!
const opR = imOperating(IM_EXAMPLE, DEF.f, V, DEF.poles, DEF.tl, R_DEMO)!
const pct = (x: number) => `${(x * 100).toFixed(1)} %`

export const WR_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'The stator is the same as a cage motor’s: laminated core, distributed three-phase winding, supplied at the terminal box. The rotor is different: instead of bars and end rings it carries a three-phase winding, star-connected, with its three ends brought to three slip rings on the shaft. Carbon brushes on the rings lead to a bank of external resistors.',
    focus: ['rotor-winding', 'slip-rings', 'brushes', 'resistors', 'stator-winding'],
    layers: [],
  },
  {
    id: 'induced',
    title: '2 · The rotating field induces rotor EMFs',
    text: 'Three-phase stator currents make a field rotating at Ns = 120·f/P. It cuts the rotor conductors and induces a three-phase EMF in the rotor winding — the rotor works like the secondary of a transformer whose frequency changes with speed: f2 = s·f. At standstill (shown here) s = 1 and f2 = f; the rotor EMF is largest.',
    focus: ['stator-winding', 'rotor-winding'],
    layers: ['current', 'rotatingField', 'emf'],
    rotate: true,
    equation: 'Ns = 120·f / P  |  f2 = s·f  |  E2s = s·E2',
    detail: 'The rotor winding must have the same number of poles as the stator — a cage adapts to any pole number by itself, a wound rotor does not.',
  },
  {
    id: 'rings',
    title: '3 · Slip rings and brushes reach the rotor circuit',
    text: 'The rotor currents flow out through the slip rings, through the stationary brushes and through the external resistors, which close the star. Each ring is one rotor phase. The rings only provide a sliding contact — they do not switch or rectify anything, unlike a commutator.',
    focus: ['slip-rings', 'brushes', 'resistors'],
    layers: ['emf'],
    rotate: true,
    detail: 'With the brushes lifted and the rings short-circuited (Rext = 0) the machine behaves like a cage motor with a low-resistance rotor.',
  },
  {
    id: 'starting',
    title: '4 · Starting with added rotor resistance',
    text: `Rotor resistance moves the pull-out torque to a higher slip (s_max ∝ R2 + Rext) without changing its size. At start (s = 1) this raises the torque and lowers the current. For the example machine (4 poles, 50 Hz): with the rings shorted the start gives ${st0.te.toFixed(0)} N·m at ${st0.i1.toFixed(0)} A; with Rext′ = ${R_DEMO} Ω, ${stR.te.toFixed(0)} N·m at only ${stR.i1.toFixed(0)} A. Rext′ ≈ ${rBest.toFixed(1)} Ω puts the full pull-out torque (${bd0.tMax.toFixed(0)} N·m) at standstill.`,
    focus: ['resistors', 'rotor-winding'],
    layers: ['rotatingField', 'emf', 'torque'],
    rotate: true,
    equation: 's_max = (R2′ + Rext′) / √(Rth² + (Xth + X2)²)  |  Tmax independent of R2',
    detail: 'The resistance is cut out in steps as the motor speeds up (the moving bar of the starter), keeping the torque high during the whole run-up.',
  },
  {
    id: 'speed',
    title: '5 · Rotor resistance lowers the speed at a given load',
    text: `At the same load torque, more rotor resistance needs more slip to induce the same rotor current. With ${DEF.tl} N·m: rings shorted → s = ${pct(op0.s)}, Nr = ${Math.round(op0.nr)} rpm; Rext′ = ${R_DEMO} Ω → s = ${pct(opR.s)}, Nr = ${Math.round(opR.nr)} rpm. Move the Rext slider in Calculate and watch the shorting bar and the rotor speed follow.`,
    focus: ['resistors', 'shaft'],
    layers: ['rotatingField', 'rotation'],
    rotate: true,
    equation: 's = (Ns − Nr)/Ns  |  T ≈ k·s / (R2′ + Rext′) near Ns',
  },
  {
    id: 'energy',
    title: '6 · Where the slip power goes',
    text: 'Of the air-gap power, the fraction s is converted to heat in the rotor circuit — in the winding and, mostly, in the external resistors. Speed control by rotor resistance is therefore wasteful: at 30 % slip, 30 % of the air-gap power becomes heat in the rotor circuit, most of it in the resistors. Modern slip-ring drives feed this slip power back to the supply with converters (slip-energy recovery, doubly-fed machines in wind turbines).',
    focus: ['resistors', 'rotor-winding', 'shaft'],
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'Pcu2 = s·Pag  |  Pmech = (1 − s)·Pag',
    detail: 'Model: steady state, per-phase circuit of the 4 kW example machine, Rext referred to the stator (Rext′ = a²·Rext), no core or friction loss, linear iron.',
  },
]

export const WR_CONTENT: MachineContent = {
  overview: 'A wound-rotor (slip-ring) induction motor has the same stator as a cage motor, but its rotor carries a three-phase winding connected to three slip rings. Through brushes, resistance can be added to the rotor circuit: high starting torque with a low starting current, and a crude speed control.',
  construction: 'Stator: laminated core with a distributed three-phase winding. Rotor: laminated core with a three-phase star winding of the same pole number; its three ends go to insulated slip rings on the shaft. Carbon brushes on the rings connect to an external star-connected resistor bank (the rotor starter) whose shorting bar sets the added resistance.',
  principle: 'As in every induction motor, the rotating stator field induces EMFs at the slip frequency in the rotor winding, and the rotor currents in the field make torque. The slip rings let the rotor circuit resistance be changed: s_max ∝ R2 + Rext while the pull-out torque stays the same, so the whole torque–speed curve stretches towards lower speeds.',
  equations: [
    { expr: 'Ns = 120·f/P,  s = (Ns − Nr)/Ns,  f2 = s·f', meaning: 'The same speed and frequency relations as the cage motor.' },
    { expr: 's_max = (R2′ + Rext′) / √(Rth² + (Xth + X2)²)', meaning: 'The slip at pull-out torque grows in proportion to the rotor circuit resistance.' },
    { expr: 'Tmax = 3·Vth² / (2·ωs·(Rth + √(Rth² + (Xth + X2)²)))', meaning: 'The pull-out torque does not depend on the rotor resistance.' },
    { expr: 'Pcu2 = s·Pag (winding + external resistors)', meaning: 'The slip power is heat in the rotor circuit.' },
    { expr: 'Pext = s·Pag · Rext′/(R2′ + Rext′)', meaning: 'The part dissipated outside the machine, in the resistor bank.' },
  ],
  assumptions: [
    'Steady state, balanced sinusoidal supply (V/f: 400 V at 50 Hz), star connection.',
    'Same per-phase circuit as the cage model (4 kW, 4-pole example: R1 = 1.405 Ω, R2′ = 1.395 Ω, L1 = L2′ = 5.84 mH, Lm = 172 mH).',
    'Rext′ is the external resistance per phase referred to the stator (a² × the actual value, a = stator/rotor turns ratio).',
    'Brush contact drop, core, friction and windage losses neglected; linear iron.',
  ],
  characteristics: ['With the rings shorted: like a cage motor (low slip, good efficiency).', 'Added rotor resistance: higher starting torque, lower starting current, softer speed–torque curve.', 'Speed falls with load more steeply when Rext is in circuit.'],
  losses: ['Stator copper loss.', 'Rotor copper loss s·Pag — partly in the external resistors.', 'Brush contact and friction loss at the slip rings.', 'Core, friction and windage losses.'],
  advantages: ['High starting torque with low starting current — for heavy loads (cranes, crushers, mills).', 'Smooth acceleration of high-inertia loads.', 'Rotor heat during starting is dissipated outside the machine.', 'Access to the rotor circuit (slip-power recovery, doubly-fed operation).'],
  limitations: ['More expensive and larger than a cage motor.', 'Brushes and slip rings need maintenance.', 'Speed control by resistance wastes the slip power as heat.', 'Rotor winding pole number is fixed.'],
  applications: ['Cranes and hoists', 'Crushers, ball mills, large conveyors', 'Doubly-fed induction generators in wind turbines', 'Older large drives with resistance starters'],
  misconceptions: [
    'Slip rings are not a commutator: they do not reverse current; the rotor current is AC at the slip frequency.',
    'Adding rotor resistance does not raise the maximum torque — it only moves it to a higher slip.',
    'More rotor resistance does not always give more starting torque: beyond the value that makes s_max = 1, the starting torque falls again.',
  ],
  sources: ['Standard textbook relations (e.g. Chapman, Electric Machinery Fundamentals; Sen, Principles of Electric Machines; Fitzgerald & Kingsley).'],
}

export const WR_QUIZ: QuizItem[] = [
  { id: 'id-rings', kind: 'identify', prompt: 'What is the highlighted part?', part: 'slip-rings', options: ['Commutator', 'Slip rings', 'Bearings', 'End rings'], answer: 1, explain: 'Three insulated slip rings, one per rotor phase: a sliding contact to the rotor winding.', misconceptions: { 0: 'A commutator has many segments and reverses coil currents; slip rings are continuous rings and switch nothing.' } },
  { id: 'id-res', kind: 'identify', prompt: 'What is the highlighted part?', part: 'resistors', options: ['Starting capacitor', 'External rotor resistors', 'Terminal box', 'Brush holder'], answer: 1, explain: 'The external resistor bank (rotor starter), connected to the rotor through the brushes and slip rings.' },
  { id: 'predict-tmax', kind: 'predict', prompt: 'You add external rotor resistance. What happens to the pull-out (maximum) torque?', options: ['It increases', 'It stays the same, at a higher slip', 'It decreases'], answer: 1, explain: 'Tmax does not depend on R2; s_max is proportional to R2 + Rext. The curve stretches towards standstill.', misconceptions: { 0: 'The starting torque can rise (up to Tmax), but the maximum itself does not.' } },
  { id: 'predict-speed', kind: 'predict', prompt: 'Same load torque, more rotor resistance. The speed…', options: ['rises', 'falls', 'stays the same'], answer: 1, explain: 'The rotor needs more slip to induce the current that gives the same torque through a larger resistance: the speed falls, and s·Pag is wasted as heat.' },
  { id: 'order-start', kind: 'order', prompt: 'Put a resistance start in order.', options: ['Close the stator supply with full resistance in the rotor', 'High torque, low current at standstill', 'The motor accelerates; resistance is cut out in steps', 'Rings short-circuited: normal running at low slip'], answer: 0, explain: 'Start with all the resistance, cut it out as the speed rises, finish with the rings shorted.' },
  { id: 'match-pext', kind: 'match', prompt: 'Where does the slip power s·Pag go?', options: ['Heat in the rotor circuit (winding + external resistors)', 'Mechanical power at the shaft', 'Back to the supply, always'], answer: 0, explain: 'With plain resistors it is all heat. Only with a converter (slip-energy recovery) can it be returned.' },
]
