import { imBreakdown, imOperating, imPoint, IM_EXAMPLE, syncRad, syncRpm, vPhaseVf, type ImCircuit } from '../../calculations/induction.ts'
import type { Assembly, CalcResult, DisassemblyStage, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Three-phase squirrel-cage induction motor — content and calculations (no 3D code here).
 * Coordinates: shaft = z, drive end (+z) at the front, fan at the back. The field and the rotor turn
 * counter-clockwise seen from the drive end (phase sequence a → b → c).
 */

type PartDraft = Omit<MachinePart, 'related'>
/** `related` (used by the generic checks and lists) is the ids of `relations`. */
const withRelated = (parts: PartDraft[]): MachinePart[] => parts.map((p) => ({ ...p, related: p.relations?.map((r) => r.id) }))

/*
 * Disassembly, five stages (a workshop teardown from the fan end):
 *   1 fan cover → 2 fan → 3 both end shields → 4 rotor out of the stator (drawn as the stator moving away) →
 *   5 bearings off the shaft. The rotor core, bars and end rings are cast together and stay whole.
 */
export const IM_PARTS: MachinePart[] = withRelated([
  {
    id: 'frame',
    label: 'Frame with cooling fins',
    what: 'The cast outer frame (housing) with longitudinal fins and mounting feet.',
    function: 'Holds the stator core, carries the end shields and the feet, and gets rid of the heat: the fan blows air along the fins.',
    location: 'The outside of the motor, around the stator core, standing on its feet.',
    material: 'Cast iron, or die-cast aluminium in small motors.',
    ifFaulty: 'Fins clogged with dirt cannot shed the heat: the winding runs hotter and its insulation ages faster — one of the commonest causes of winding failure.',
    outer: true,
    explode: [-2.7, 0, 0],
    stage: 4,
    anchor: [0.9, 1.0, 0.6],
    relations: [
      { id: 'stator-core', how: 'holds the stator core pressed into its bore' },
      { id: 'end-shield-front', how: 'the end shields are bolted to it and centre the rotor in its bore' },
      { id: 'fan-cover', how: 'the cover guides the fan’s air along its fins' },
      { id: 'terminal-box', how: 'carries the terminal box' },
    ],
  },
  {
    id: 'terminal-box',
    label: 'Terminal box',
    what: 'The box on top with the six winding ends (U1 V1 W1, U2 V2 W2).',
    function: 'Where the three supply lines are connected; links in the box connect the winding in star or delta.',
    location: 'On top of the frame.',
    material: 'A cast or pressed metal box; a terminal board of insulating material with brass studs.',
    ifFaulty: 'A loose stud overheats. With one supply line open the motor gets a single-phase supply: it will not start from rest, and if it was running it keeps going but draws more current in the other lines and overheats.',
    outer: true,
    explode: [-2.7, 0.75, 0],
    stage: 4,
    attachedTo: 'frame',
    anchor: [0, 1.62, 0.15],
    relations: [
      { id: 'stator-winding', how: 'the six winding ends U1 … W2 come to its studs' },
      { id: 'frame', how: 'mounted on top of the frame' },
    ],
  },
  {
    id: 'stator-core',
    label: 'Stator core (laminated)',
    what: 'A stack of thin insulated electrical-steel laminations with 36 slots around the bore.',
    function: 'Carries the rotating flux with little magnetising current. Its flux alternates at the supply frequency, so it is laminated to keep eddy-current loss small.',
    location: 'Pressed into the frame; its slotted bore surrounds the rotor.',
    material: 'Electrical (silicon) steel sheets about 0.5 mm thick, each insulated from the next.',
    ifFaulty: 'If the insulation between sheets is damaged (often after a winding burn-out) eddy currents flow from sheet to sheet: hot spots and a higher core loss.',
    explode: [-2.7, 0, 0],
    stage: 4,
    attachedTo: 'frame',
    inspect: [0, -2.8, 0],
    inspectNote: 'The stator core is pressed into the frame and carries the winding; it is shown on its own only for inspection.',
    anchor: [-0.7, 0.75, 0.7],
    relations: [
      { id: 'stator-winding', how: 'holds the winding in its 36 slots' },
      { id: 'frame', how: 'held in the frame' },
      { id: 'air-gap', how: 'its bore faces the rotor across the air gap' },
    ],
  },
  {
    id: 'stator-winding',
    label: 'Three-phase stator winding',
    what: 'Copper coils in the slots, distributed in three phases a, b, c (end turns red, yellow, blue).',
    function: 'Fed with three-phase currents, the three phases — 120° apart in space and in time — make a magnetic field that turns at the synchronous speed.',
    location: 'In the stator slots; the coloured end turns stick out at both ends of the core.',
    material: 'Enamelled copper wire, with slot insulation and impregnating varnish.',
    ifFaulty: 'Overheating breaks down the insulation, then a turn-to-turn or phase-to-earth short burns the winding. With one phase open there is no rotating field at standstill: the motor cannot start.',
    explode: [-2.7, 0, 0],
    stage: 4,
    attachedTo: 'frame',
    inspect: [2.9, 0, 0],
    inspectNote: 'The coils are laid in the core slots and varnished in place — they cannot be lifted out in one piece. Shown apart so you can see the three phases and their end turns.',
    anchor: [0.62, -0.62, 0.9],
    relations: [
      { id: 'terminal-box', how: 'its six ends are brought out to the terminal box' },
      { id: 'stator-core', how: 'laid in the core’s slots' },
      { id: 'rotor-bars', how: 'its rotating field induces the currents in the cage bars' },
    ],
  },
  {
    id: 'air-gap',
    label: 'Air gap',
    what: 'The thin gap between the stator bore and the rotor (drawn about 10× too wide here; really well under 1 mm). It is a space, not a part.',
    function: 'The field crosses it twice. It must be small: the wider the gap, the larger the magnetising current and the lower the power factor.',
    location: 'Between the stator bore and the rotor surface, all the way round.',
    material: 'Air — it is the space between two parts.',
    ifFaulty: 'If the gap is uneven (worn bearings, a bent shaft) the magnetic pull on the rotor is unbalanced: noise, vibration, and in the worst case the rotor rubs on the stator.',
    explode: [-2.7, 0, 0],
    stage: 4,
    attachedTo: 'frame',
    inspect: [0, 0, 0],
    anchor: [0.4, 0.42, 0.72],
    relations: [
      { id: 'stator-core', how: 'bounded on the outside by the stator bore' },
      { id: 'rotor-core', how: 'bounded on the inside by the rotor surface' },
    ],
  },
  {
    id: 'shaft',
    label: 'Shaft',
    what: 'The steel shaft, with a key at the drive end.',
    function: 'Carries the torque to the load.',
    location: 'Along the axis, from the key at the drive end to the fan at the back.',
    material: 'Steel.',
    ifFaulty: 'A bent shaft makes the air gap uneven: vibration, unbalanced magnetic pull and rubbing.',
    explode: [0, 0, 0],
    stage: 4,
    inspect: [0, 0, -3.6],
    inspectNote: 'The rotor core is shrunk onto the shaft — in a real motor the shaft comes out only with the rotor.',
    anchor: [0, 0.2, 1.75],
    relations: [
      { id: 'bearing-de', how: 'turns in the drive-end bearing' },
      { id: 'bearing-nde', how: 'turns in the non-drive-end bearing' },
      { id: 'rotor-core', how: 'the rotor core is fixed on it' },
      { id: 'fan', how: 'the fan is fixed on its back end' },
    ],
  },
  {
    id: 'rotor-core',
    label: 'Rotor core (laminated)',
    what: 'A stack of laminations on the shaft, each turned slightly further: the slots are skewed.',
    function: 'Carries the flux across the rotor and holds the cage bars. The rotor iron sees only the slip frequency, so its iron loss is small at normal speed.',
    location: 'On the shaft, inside the stator bore.',
    material: 'Electrical steel laminations (commonly punched from the centre of the stator sheets).',
    ifFaulty: 'If it comes loose on the shaft it cannot pass the torque on; if it rubs the stator, the sheet edges smear together and the core loss rises.',
    explode: [0, 0, 0],
    stage: 4,
    inspect: [0, 0, 3.4],
    inspectNote: 'The rotor core is fixed on the shaft and the cage is cast into it; shown apart only for inspection.',
    anchor: [0.15, 0.56, -0.5],
    relations: [
      { id: 'rotor-bars', how: 'holds the cage bars in its slots' },
      { id: 'shaft', how: 'fixed on the shaft' },
      { id: 'air-gap', how: 'separated from the stator only by the air gap' },
    ],
  },
  {
    id: 'rotor-bars',
    label: 'Cage bars (skewed)',
    what: 'Aluminium bars cast into the rotor slots, skewed by about one stator slot pitch.',
    function: 'The rotating field induces EMFs and currents in them; current × field gives the torque. The skew smooths the torque and reduces noise and slot harmonics.',
    location: 'In the rotor slots, running from one end ring to the other.',
    material: 'Die-cast aluminium (copper in some high-efficiency motors).',
    ifFaulty: 'A cracked or broken bar carries no current: the torque falls and pulsates at twice the slip frequency — a classic fault, found by analysing the stator current.',
    explode: [0, 0, 0],
    stage: 4,
    inspect: [0, 2.8, 0],
    inspectNote: 'The bars are die-cast into the rotor slots together with the end rings: the cage cannot be taken out. Pull out the end rings too to see the whole cage.',
    anchor: [0.5, -0.15, 0.3],
    relations: [
      { id: 'end-rings', how: 'short-circuited at both ends by the end rings' },
      { id: 'rotor-core', how: 'cast into the rotor core’s slots' },
      { id: 'stator-winding', how: 'carry the currents the stator’s rotating field induces' },
    ],
  },
  {
    id: 'end-rings',
    label: 'End rings',
    what: 'Aluminium rings cast together with the bars at both ends of the rotor.',
    function: 'Short-circuit all the bars, so the induced currents can flow: bars + rings form the "squirrel cage". No electrical connection to the rotor is needed.',
    location: 'Against both ends of the rotor core, joining all the bars.',
    material: 'Aluminium, cast in one piece with the bars.',
    ifFaulty: 'A cracked end ring interrupts the current path of the bars next to the crack — the same effect as broken bars.',
    explode: [0, 0, 0],
    stage: 4,
    inspect: [0, 2.8, 0],
    inspectNote: 'Cast in one piece with the bars. Pull out the cage bars too to see the whole squirrel cage.',
    anchor: [-0.35, -0.38, 0.78],
    relations: [
      { id: 'rotor-bars', how: 'joins every bar to every other' },
      { id: 'rotor-core', how: 'cast against the ends of the rotor core' },
    ],
  },
  {
    id: 'end-shield-front',
    label: 'Drive-end shield',
    what: 'The end cover at the shaft end, with the bearing housing.',
    function: 'Closes the motor and holds the drive-end bearing, keeping the rotor centred in the stator bore — the air gap is very small.',
    location: 'At the shaft (drive) end, bolted to the frame.',
    material: 'Cast iron or aluminium.',
    ifFaulty: 'A worn bearing seat or loose bolts let the rotor move off centre; with an air gap well under 1 mm the rotor can then rub on the stator.',
    outer: true,
    explode: [-1.0, -1.15, 1.0],
    stage: 3,
    anchor: [-0.75, 0.7, 1.05],
    relations: [
      { id: 'bearing-de', how: 'holds the drive-end bearing' },
      { id: 'frame', how: 'bolted to the frame, centring the rotor in the bore' },
    ],
  },
  {
    id: 'end-shield-rear',
    label: 'Non-drive-end shield',
    what: 'The end cover at the fan end, with the second bearing housing.',
    function: 'Closes the motor at the back and holds the non-drive-end bearing.',
    location: 'At the fan end, between the frame and the fan.',
    material: 'Cast iron or aluminium.',
    ifFaulty: 'As for the drive-end shield: a worn seat lets the rotor run off centre.',
    outer: true,
    explode: [1.5, -1.5, -0.45],
    stage: 3,
    anchor: [-0.75, -0.75, -1.05],
    relations: [
      { id: 'bearing-nde', how: 'holds the non-drive-end bearing' },
      { id: 'frame', how: 'bolted to the back of the frame' },
      { id: 'fan', how: 'the fan turns just outside it' },
    ],
  },
  {
    id: 'bearing-de',
    label: 'Drive-end bearing',
    what: 'A ball bearing on the shaft, in the drive-end shield.',
    function: 'Carries the rotor at the load end and keeps it centred, so the air gap is the same all round; lets it turn with little friction.',
    location: 'On the shaft, inside the drive-end shield.',
    material: 'Hardened steel rings and balls, packed with grease.',
    ifFaulty: 'Bearing wear is the most common mechanical failure of induction motors: noise and heat first, then a rotor that is no longer centred. (On inverter drives, currents through the bearing can also pit its races.)',
    explode: [0, 0, 1.15],
    stage: 5,
    anchor: [0.3, -0.3, 1.0],
    relations: [
      { id: 'shaft', how: 'supports the drive end of the shaft' },
      { id: 'end-shield-front', how: 'held in the drive-end shield' },
    ],
  },
  {
    id: 'bearing-nde',
    label: 'Non-drive-end bearing',
    what: 'The second ball bearing, in the shield at the fan end.',
    function: 'Carries the other end of the rotor, so that it stays centred in the bore.',
    location: 'On the shaft, inside the non-drive-end shield.',
    material: 'Hardened steel rings and balls, packed with grease.',
    ifFaulty: 'As for the drive-end bearing: noise, heat and in the end a rotor that is off centre.',
    explode: [0, 0, -0.65],
    stage: 5,
    anchor: [-0.3, 0.3, -1.1],
    relations: [
      { id: 'shaft', how: 'supports the fan end of the shaft' },
      { id: 'end-shield-rear', how: 'held in the non-drive-end shield' },
    ],
  },
  {
    id: 'fan',
    label: 'Cooling fan',
    what: 'A plastic fan on the shaft, outside the non-drive-end shield.',
    function: 'Turns with the rotor and blows air over the frame: the motor cools itself (less well at low speed).',
    location: 'On the back end of the shaft, outside the rear shield, under the fan cover.',
    material: 'Plastic or aluminium.',
    ifFaulty: 'A broken fan stops the cooling and the motor overheats even at normal load. At low speed (on an inverter) it cools less, so slow-running motors may need a separately driven fan.',
    explode: [0, 0, -0.75],
    stage: 2,
    anchor: [0.55, 0.45, -1.32],
    relations: [
      { id: 'shaft', how: 'fixed on the shaft and turns with it' },
      { id: 'fan-cover', how: 'its air is guided by the cover' },
    ],
  },
  {
    id: 'fan-cover',
    label: 'Fan cover',
    what: 'A sheet-steel cowl with an air-inlet grille.',
    function: 'Guards the fan and directs its air along the fins of the frame.',
    location: 'Over the fan at the back of the motor.',
    material: 'Pressed sheet steel.',
    ifFaulty: 'A dented cover can touch the fan; a blocked grille starves it of air: noise, or a hotter motor.',
    outer: true,
    explode: [0, 0, -1.1],
    stage: 1,
    anchor: [0.7, -0.6, -1.7],
    relations: [
      { id: 'fan', how: 'guards the fan' },
      { id: 'frame', how: 'directs the air along the frame’s fins' },
    ],
  },
])

export const IM_ASSEMBLIES: Assembly[] = [
  { id: 'stator', label: 'Stator', what: 'The stationary part: the finned frame with the laminated stator core, the three-phase winding and the terminal box where the supply is connected. Its currents make the rotating field.', children: ['frame', 'terminal-box', 'stator-core', 'stator-winding'], inspect: [-2.9, 0, 0] },
  { id: 'rotor', label: 'Rotor (squirrel cage)', what: 'The part that turns: the laminated rotor core on the shaft, with the cage of skewed bars and two end rings. It has no electrical connection — its currents are induced.', children: ['shaft', 'rotor-core', 'rotor-bars', 'end-rings'], inspect: [0, 0, 3.8] },
  { id: 'ends', label: 'End shields and bearings', what: 'Close the motor at both ends and keep the rotor centred in the stator bore, with a bearing in each shield.', children: ['end-shield-front', 'bearing-de', 'end-shield-rear', 'bearing-nde'] },
  { id: 'cooling', label: 'Cooling', what: 'The fan on the shaft and its cover: the motor cools itself by blowing air along the fins of the frame.', children: ['fan', 'fan-cover'], inspect: [0, 0, -1.6] },
]

export const IM_DISASSEMBLY: DisassemblyStage[] = [
  { title: 'Remove the fan cover', text: 'Start at the back (non-drive end): the fan cover is unbolted and pulled off, uncovering the cooling fan.' },
  { title: 'Pull off the cooling fan', text: 'The fan is pulled off the end of the shaft. It turns with the rotor and blows air along the fins of the frame — the motor cools itself.' },
  { title: 'Take off the end shields', text: 'Both end shields are unbolted from the frame. They hold the bearings that keep the rotor centred in the bore; once they are off, the rotor has to be supported so that it does not drop onto the stator.' },
  { title: 'Separate the rotor from the stator', text: 'The rotor is drawn out of the stator bore (here the stator moves away instead; the result is the same). Now you can see the laminated stator core with its three-phase winding, and the rotor’s skewed cage. There is nothing to disconnect: the rotor has no electrical connection at all.' },
  { title: 'Pull the bearings off the shaft', text: 'Last, the two bearings are pulled off the shaft ends. Left on the shaft is the rotor core with its cage — bars and end rings cast in one piece, never taken apart.' },
]

export const IM_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Three-phase currents', legend: 'Cones at the slot mouths: the current in each slot, coloured by phase (a red, b yellow, c blue). Pointing out of the drive end = ⊙, into it = ⊗; length ∝ the instantaneous current. The card shows ia, ib, ic over one period with the present instant.', conceptual: true },
  { id: 'rotatingField', label: 'Rotating magnetic field', legend: 'Blue: the air-gap field, drawn on the front. Arrows cross the air gap into the rotor at a stator N pole and out at an S pole; dashed lines are flux paths. The pattern turns at the synchronous speed (scaled), a → b → c.', conceptual: true },
  { id: 'emf', label: 'Induced rotor currents', legend: 'Magenta cones on the bars: the induced EMF and current in each bar (⊗ under an N pole, ⊙ under an S pole), length ∝ current. They sweep through the bars at the slip frequency f2 = s·f.', conceptual: true },
  { id: 'torque', label: 'Force and torque', legend: 'Amber: the force on the bars under each pole (F = B·I·L), tangential and in the direction of the field; the curved arrow is the torque on the rotor.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the rotor turns (Nr); blue outer arrow: the field turns (Ns), a little faster. The key on the shaft shows the rotor angle.', conceptual: false },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: electrical power in at the terminals → stator copper loss → air-gap power Pag → rotor copper loss s·Pag → mechanical power (1 − s)·Pag at the shaft. Values from the Calculate tab.', conceptual: true },
]

export const IM_PARAMS: MachineParam[] = [
  { id: 'f', label: 'Supply frequency f', unit: 'Hz', min: 10, max: 60, step: 1, value: 50 },
  { id: 'poles', label: 'Number of poles P', unit: '', min: 2, max: 6, step: 2, value: 4, options: [2, 4, 6] },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 80, step: 1, value: 25 },
]

export interface ImCalcOpts {
  circuit?: ImCircuit
  rext?: number
}

/** Calculated values of the three-phase machine (V/f supply, 400 V at 50 Hz, star). */
export function imCalc(p: Record<string, number>, o: ImCalcOpts = {}): CalcResult[] {
  const m = o.circuit ?? IM_EXAMPLE
  const rext = o.rext ?? 0
  const f = p.f
  const P = p.poles
  const v = vPhaseVf(f)
  const ns = syncRpm(f, P)
  const op = imOperating(m, f, v, P, p.tl, rext)
  const bd = imBreakdown(m, f, v, P, rext)
  const st = imPoint(m, f, v, P, 1, rext)
  const stall = 'The load torque is above what the motor can give (pull-out torque on the stable branch): it would stall — no operating point.'
  const n = op ? undefined : stall
  return [
    { id: 'ns', label: 'Synchronous speed Ns', value: ns, unit: 'rpm', formula: 'Ns = 120·f / P' },
    { id: 's', label: 'Slip s', value: op ? op.s : null, unit: '%', formula: 's = (Ns − Nr)/Ns, from Te(s) = TL', note: n ?? 'Found on the per-phase equivalent circuit (stable branch).' },
    { id: 'nr', label: 'Rotor speed Nr', value: op ? op.nr : null, unit: 'rpm', formula: 'Nr = (1 − s)·Ns' },
    { id: 'f2', label: 'Rotor current frequency f2', value: op ? op.s * f : null, unit: 'Hz', formula: 'f2 = s·f' },
    { id: 'i1', label: 'Stator (line) current', value: op ? op.i1 : null, unit: 'A', formula: 'I1 = Vph / Z(s),  Vph = 400/√3 · f/50' },
    { id: 'pf', label: 'Power factor', value: op ? op.pf : null, unit: '', formula: 'cos φ = Pin / (3·Vph·I1)' },
    { id: 'pin', label: 'Electrical input Pin', value: op ? op.pin : null, unit: 'W', formula: 'Pin = 3·Vph·I1·cos φ' },
    { id: 'pcu1', label: 'Stator copper loss', value: op ? op.pcu1 : null, unit: 'W', formula: 'Pcu1 = 3·I1²·R1', note: 'Here Pin − Pag exactly (no core loss in this model).' },
    { id: 'pag', label: 'Air-gap power Pag', value: op ? op.pag : null, unit: 'W', formula: 'Pag = 3·I2²·R2/s = Te·ωs' },
    { id: 'pcu2', label: rext > 0 ? 'Rotor circuit copper loss (incl. external R)' : 'Rotor copper loss', value: op ? op.pcu2 : null, unit: 'W', formula: 'Pcu2 = s·Pag' },
    { id: 'pmech', label: 'Mechanical power', value: op ? op.pmech : null, unit: 'W', formula: 'Pmech = (1 − s)·Pag = TL·ωr' },
    { id: 'eff', label: 'Efficiency (this model)', value: op && op.pin > 0 ? op.pmech / op.pin : null, unit: '%', formula: 'η = Pmech / Pin', note: 'No core, friction or stray loss here: a real motor is less efficient.' },
    { id: 'tmax', label: 'Pull-out (breakdown) torque', value: bd.tMax, unit: 'N·m', formula: 'Tmax = 3·Vth² / (2·ωs·(Rth + √(Rth² + (Xth + X2)²)))', note: `At s_max = ${(bd.sMax * 100).toFixed(1)} %.` },
    { id: 'tst', label: 'Starting torque', value: st.te, unit: 'N·m', formula: 'Te at s = 1 (rotor at rest)' },
    { id: 'ist', label: 'Starting current', value: st.i1, unit: 'A', formula: 'I1 at s = 1' },
    { id: 'phi2', label: 'Rotor power-factor angle φ2', value: op ? (op.phi2 * 180) / Math.PI : null, unit: '°', formula: 'φ2 = atan(s·X2 / R2)', note: 'How far the rotor current lags its EMF (small at small slip).' },
  ]
}

/** The rotor turns at Nr, the field at Ns — both from the calculation, slowed down ×50. */
export function imMotion(calc: Record<string, number | null>, params: Record<string, number>) {
  const w = syncRad(params.f, params.poles) / 50
  const s = calc.s
  return {
    omega: w,
    note:
      s === null
        ? 'The field turns at the calculated synchronous speed (slowed ×50); the rotor is stalled — the load is above the pull-out torque.'
        : `The field turns at Ns = ${Math.round(calc.ns ?? 0)} rpm and the rotor at Nr = ${Math.round(calc.nr ?? 0)} rpm, both slowed down ×50: the rotor falls behind the field by the slip (${((s ?? 0) * 100).toFixed(1)} %). In the starting steps the rotor is shown at rest (s = 1).`,
  }
}

// numbers quoted by the guided steps — computed here from the same model, not typed in
const DEF = Object.fromEntries(IM_PARAMS.map((x) => [x.id, x.value]))
const at = (tl: number) => imOperating(IM_EXAMPLE, DEF.f, vPhaseVf(DEF.f), DEF.poles, tl)
const op1 = at(DEF.tl)!
const op2 = at(2 * DEF.tl)!
const pct = (x: number) => `${(x * 100).toFixed(1)} %`
const rpm = (x: number) => `${Math.round(x)} rpm`

export const IM_STEPS: MachineStep[] = [
  {
    id: 'construction',
    view: 'iso',
    title: '1 · Identify the construction',
    text: 'Stator (stationary): the finned frame holds a laminated, slotted core with a distributed three-phase winding — the coloured end turns are phases a, b and c. Rotor (turning): a laminated core on the shaft with skewed aluminium bars, short-circuited by an end ring at each end — the squirrel cage. Between them, a very small air gap. Bearings in the end shields hold the rotor; the fan on the shaft cools the frame. There are no brushes and no connection to the rotor.',
    focus: ['stator-core', 'stator-winding', 'rotor-core', 'rotor-bars', 'end-rings', 'air-gap', 'shaft'],
    layers: [],
  },
  {
    id: 'currents',
    view: 'front',
    title: '2 · Three-phase currents in sequence',
    text: 'The supply drives three sinusoidal currents ia, ib, ic, equal in size and 120° apart in time: a reaches its peak first, then b, then c. The three windings are also 120° (electrical) apart around the stator. The cones show the current in each slot at this instant: watch the pattern of large currents move round the bore as a, b and c take turns.',
    focus: ['stator-winding', 'terminal-box'],
    roles: {
      'stator-winding': "Carries the three phase currents ia, ib, ic, 120° apart in time; its three phases are 120° apart around the bore.",
      'terminal-box': "The three supply lines are connected here.",
    },
    layers: ['current'],
    rotate: true,
    equation: 'ia = Î·cos ωt  |  ib = Î·cos(ωt − 120°)  |  ic = Î·cos(ωt − 240°)',
    detail: 'The rotor is shown at rest here (the instant of switching on). The current pattern is a sinusoidally distributed current sheet K ∝ cos(p·θ − ωt): a travelling wave around the gap.',
  },
  {
    id: 'field',
    view: 'front',
    title: '3 · A rotating magnetic field',
    text: 'Together the three currents make one magnetic field of constant strength whose poles turn round the air gap — without anything moving. It turns from phase a towards b and then c: swap two supply lines and it turns the other way. One electrical period moves the field by one pair of poles, so its speed is the synchronous speed Ns = 120·f/P (1500 rpm for 50 Hz and 4 poles).',
    focus: ['stator-winding', 'stator-core', 'air-gap'],
    roles: {
      'stator-winding': "Its three phase currents together make one field of constant strength that turns at the synchronous speed Ns.",
      'stator-core': "Carries the rotating flux round the stator with little magnetising current.",
      'air-gap': "The field crosses it twice; it is kept very small so the magnetising current stays small.",
    },
    layers: ['current', 'rotatingField'],
    rotate: true,
    equation: 'Ns = 120·f / P',
    detail: 'Each phase alone gives a pulsating field; the sum of three pulsating fields displaced 120° in space and time is a field of constant amplitude 3/2 × one phase’s peak, turning at ω/p (p = P/2 pole pairs).',
  },
  {
    id: 'induced',
    view: 'front',
    title: '4 · Induced EMF and bar currents',
    text: 'At standstill the field sweeps past the rotor bars at full synchronous speed. Each bar cuts the flux, so an EMF is induced in it (e = B·L·v, v = speed of the field relative to the bar). The end rings short-circuit the bars, so currents flow: into the page (⊗) under a stator N pole, out (⊙) under an S pole. At standstill the rotor currents have the supply frequency: f2 = s·f with s = 1.',
    focus: ['rotor-bars', 'end-rings'],
    roles: {
      'rotor-bars': "The field sweeps past them, inducing an EMF — and, because they are short-circuited, a current.",
      'end-rings': "Close the circuit of every bar, so the induced currents can flow.",
    },
    layers: ['rotatingField', 'emf'],
    rotate: true,
    equation: 'e = B·L·v_rel  |  f2 = s·f',
    detail: 'The rotor current lags its EMF by φ2 = atan(s·X2/R2) — large at standstill, which is why a cage motor draws a high current but gives a moderate torque when starting.',
  },
  {
    id: 'torque',
    view: 'front',
    title: '5 · Torque: the rotor follows the field',
    text: 'Each current-carrying bar lies in the field, so it feels a force F = B·I·L. Under the N poles and under the S poles both the current and the field are reversed, so every force points the same way — in the direction the field turns. Their sum is the torque: the rotor accelerates and follows the field (Lenz: the currents act to reduce the relative motion that causes them).',
    focus: ['rotor-bars', 'rotor-core', 'shaft'],
    roles: {
      'rotor-bars': "A current-carrying bar in the field feels F = B·I·L, in the direction the field turns.",
      'rotor-core': "Holds the bars and carries the flux through the rotor; the forces on the bars turn it.",
      'shaft': "Passes the torque on to the load.",
    },
    layers: ['rotatingField', 'emf', 'torque'],
    rotate: true,
    equation: 'Te = Pag / ωs = 3·I2²·(R2/s) / ωs',
  },
  {
    id: 'slip',
    view: 'front',
    title: '6 · Slip: always a little slower than the field',
    text: `If the rotor caught up with the field, the bars would no longer cut any flux: no EMF, no current, no torque. So a motor always runs a little below synchronous speed. The difference is the slip s. With the default values (50 Hz, 4 poles, ${DEF.tl} N·m) the calculation gives Ns = 1500 rpm, Nr = ${rpm(op1.nr)}, s = ${pct(op1.s)}: the field overtakes the rotor slowly, and the rotor currents have the low frequency f2 = s·f = ${(op1.s * DEF.f).toFixed(2)} Hz. Watch the field arrows gain on the shaft key.`,
    focus: ['rotor-bars', 'shaft'],
    roles: {
      'rotor-bars': "They carry current only while the field moves relative to them, so the rotor always runs a little below Ns — the slip.",
      'shaft': "Turns at Nr = (1 − s)·Ns.",
    },
    layers: ['rotatingField', 'emf', 'rotation'],
    rotate: true,
    equation: 's = (Ns − Nr) / Ns  |  Nr = (1 − s)·Ns  |  f2 = s·f',
    detail: 'Near synchronous speed s·X2 ≪ R2, so I2 ≈ s·E2/R2 and Te ≈ (3·E2²/(ωs·R2))·s: torque is nearly proportional to slip — the almost straight, steep part of the torque–speed curve.',
  },
  {
    id: 'load',
    view: 'front',
    title: '7 · More load → more slip',
    text: `When the load torque rises, the rotor slows a little: the slip grows, the field cuts the bars faster, the induced EMF and currents grow and the torque rises until it equals the new load. Doubling the load from ${DEF.tl} to ${2 * DEF.tl} N·m raises the slip from ${pct(op1.s)} to ${pct(op2.s)} (Nr ${rpm(op1.nr)} → ${rpm(op2.nr)}). The animation shows the doubled load: the rotor falls behind faster. Above the pull-out torque there is no operating point and the motor stalls.`,
    focus: ['rotor-bars', 'shaft', 'stator-winding'],
    roles: {
      'rotor-bars': "More load → more slip → larger induced currents → more torque, until the torque equals the load.",
      'shaft': "Slows down slightly as the load torque rises.",
      'stator-winding': "Draws more current to supply the extra ampere-turns of the rotor.",
    },
    layers: ['rotatingField', 'rotation', 'torque'],
    rotate: true,
    equation: 'Te(s) = TL   (stable while s < s_max)',
    detail: 'The stator current rises with load too: the stator must supply the rotor’s MMF on top of the magnetising current — the same power balance as a transformer with a variable load R2·(1 − s)/s.',
  },
  {
    id: 'losses',
    view: 'iso',
    title: '8 · Power flow, losses and model limits',
    text: 'Electrical power enters the stator. After the stator copper loss (and core loss), the air-gap power Pag crosses to the rotor. A fraction s of it is lost as heat in the rotor bars; the rest, (1 − s)·Pag, becomes mechanical power — so high slip always means low efficiency. Friction, windage and the fan take a little more. This model: steady state, sinusoidal supply, linear iron (no saturation), no core or friction loss, a 4 kW example machine.',
    focus: ['stator-winding', 'rotor-bars', 'shaft', 'fan'],
    roles: {
      'stator-winding': "The stator copper loss 3·I1²·R1 is lost in it.",
      'rotor-bars': "The rotor copper loss s·Pag is lost in the bars.",
      'shaft': "The mechanical power (1 − s)·Pag leaves here.",
      'fan': "Takes a little of the power to cool the motor (part of friction and windage).",
    },
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'Pag : Pcu2 : Pmech = 1 : s : (1 − s)',
    detail: 'The rotation in the animation is slowed ×50 and the arrows are conceptual. For starting transients, V/f drives and the full torque–speed curve, use the validated simulation in the Drives lab.',
  },
]

export const IM_CONTENT: MachineContent = {
  overview: 'The three-phase squirrel-cage induction motor is the workhorse of industry. Three-phase currents in a distributed stator winding make a magnetic field that turns at the synchronous speed; it induces currents in a short-circuited cage rotor, and the force on those currents drags the rotor round — always a little slower than the field.',
  construction: 'Stator: a cast, finned frame holding a laminated slotted core with a distributed three-phase winding (here 36 slots, single-layer, concentric coils); the winding ends go to the terminal box. Rotor: a laminated core on the shaft with skewed aluminium bars cast into its slots and joined by an end ring at each end. A small air gap separates them. Two bearings in the end shields carry the rotor; a fan on the shaft under a cowl blows air along the fins.',
  principle: 'Three windings 120° apart in space, fed by currents 120° apart in time, give a field of constant strength rotating at Ns = 120·f/P. The field cuts the rotor bars, induces EMFs and currents in them (the cage is short-circuited), and current × field gives a torque in the direction of the field. The rotor cannot reach Ns, because then nothing would be induced: it runs at a slip s that makes the torque equal the load.',
  equations: [
    { expr: 'Ns = 120·f / P', meaning: 'Synchronous speed [rpm] of the field (P = number of poles).' },
    { expr: 's = (Ns − Nr) / Ns', meaning: 'Slip: how much slower the rotor turns than the field (a few % at full load).' },
    { expr: 'f2 = s·f', meaning: 'Frequency of the rotor currents: low in normal running.' },
    { expr: 'Pag = Te·ωs,  Pcu2 = s·Pag,  Pmech = (1 − s)·Pag', meaning: 'Power flow across the air gap: rotor copper loss and mechanical power split in the ratio s : (1 − s).' },
    { expr: 'Te = 3·I2²·(R2/s) / ωs', meaning: 'Torque from the per-phase equivalent circuit (R1, X1, Xm, X2, R2/s).' },
    { expr: 'Tmax ∝ Vth² / (Rth + √(Rth² + (Xth + X2)²)),  s_max = R2 / √(Rth² + (Xth + X2)²)', meaning: 'Pull-out torque: independent of R2; the slip where it occurs is proportional to R2.' },
  ],
  assumptions: [
    'Steady state, balanced sinusoidal three-phase supply, star-connected.',
    'Supply voltage follows V/f: 400 V line at 50 Hz, proportional to f (no low-speed boost).',
    'Per-phase equivalent circuit of a 4 kW, 4-pole example machine (the Drives lab defaults: R1 = 1.405 Ω, R2′ = 1.395 Ω, L1 = L2′ = 5.84 mH, Lm = 172 mH); kept the same when P is changed — an illustration, not a design.',
    'Linear magnetic circuit (no saturation); core, friction, windage and stray losses neglected.',
    'Constant load torque; the operating point is on the stable branch (s below s_max).',
  ],
  characteristics: [
    'Nearly constant speed: speed falls only a few percent from no load to full load.',
    'Torque ≈ proportional to slip near synchronous speed; maximum (pull-out) torque at s_max, then it falls.',
    'High starting current (several times rated) with a moderate starting torque on direct-on-line start.',
    'Lagging power factor, poor at light load (the magnetising current stays).',
  ],
  losses: ['Stator copper loss 3·I1²·R1.', 'Rotor copper (aluminium) loss = s·Pag.', 'Core loss in the stator (hysteresis and eddy currents; laminations keep it small).', 'Friction, windage and the cooling fan.', 'Stray load losses (harmonic fields, skew).'],
  advantages: ['Simple, rugged, cheap; no brushes or slip rings.', 'Very low maintenance (bearings only).', 'Runs directly from the three-phase mains; speed control with a variable-frequency inverter.', 'Self-starting.'],
  limitations: ['Speed tied to the supply frequency: speed control needs an inverter.', 'High starting current on direct-on-line start.', 'Lagging power factor, especially at light load.', 'Rotor losses (s·Pag) heat the rotor, which is harder to cool.'],
  applications: ['Pumps, fans and compressors', 'Conveyors and machine tools', 'Lifts and cranes (with drives)', 'Many EV and rail traction drives'],
  misconceptions: [
    'The rotor is not magnetised by contact or brushes: its currents are induced, like the secondary of a transformer.',
    'An induction motor cannot run at synchronous speed on its own: at s = 0 there is no induced current and no torque.',
    'The field does not rotate because something moves: three stationary windings with phase-shifted currents make it rotate.',
    'More load does not slow the motor much — a few percent of slip is enough to give full torque.',
  ],
  sources: ['Standard textbook relations (e.g. Chapman, Electric Machinery Fundamentals; Fitzgerald & Kingsley; Sen, Principles of Electric Machines and Power Electronics).'],
}

export const IM_QUIZ: QuizItem[] = [
  { id: 'id-bars', kind: 'identify', prompt: 'What is the highlighted part?', part: 'rotor-bars', options: ['Stator winding', 'Cage bars', 'Cooling fins', 'Slip rings'], answer: 1, explain: 'The skewed aluminium bars of the squirrel cage, cast into the rotor slots and joined by the end rings.', misconceptions: { 3: 'A squirrel-cage rotor has no slip rings: its bars are short-circuited by the end rings.' } },
  { id: 'id-winding', kind: 'identify', prompt: 'What is the highlighted part?', part: 'stator-winding', options: ['Three-phase stator winding', 'End ring', 'Rotor core', 'Terminal box'], answer: 0, explain: 'The distributed three-phase winding in the stator slots; its end turns are coloured by phase.' },
  { id: 'predict-ns', kind: 'predict', prompt: 'A 6-pole motor runs from a 50 Hz supply. What is the synchronous speed?', options: ['3000 rpm', '1500 rpm', '1000 rpm', '960 rpm'], answer: 2, explain: 'Ns = 120·f/P = 120·50/6 = 1000 rpm. The rotor itself runs a little slower (e.g. 960 rpm).', misconceptions: { 3: '960 rpm is a typical rotor speed; the field turns at exactly 1000 rpm.' } },
  { id: 'predict-load', kind: 'predict', prompt: 'The load torque on the shaft increases (it stays below the pull-out torque). What happens to the slip?', options: ['It increases', 'It decreases', 'It stays the same'], answer: 0, explain: 'The rotor slows a little; the larger slip makes the field cut the bars faster, which raises the rotor currents and the torque until it matches the load.' },
  { id: 'predict-sync', kind: 'predict', prompt: 'Could the rotor of an induction motor be driven by its own torque up to exactly synchronous speed?', options: ['Yes, with no load', 'No: at Ns no EMF is induced, so there is no torque', 'Yes, if the supply voltage is high enough'], answer: 1, explain: 'At s = 0 the bars do not cut the field: no EMF, no current, no torque. Even friction alone keeps the rotor slightly below Ns.' },
  { id: 'order', kind: 'order', prompt: 'Put the working sequence in order.', options: ['Three-phase currents flow in the stator winding', 'They make a field rotating at Ns', 'The field induces EMFs and currents in the cage bars', 'Current × field gives a torque in the field’s direction', 'The rotor settles at the slip where torque = load'], answer: 0, explain: 'Currents → rotating field → induced rotor currents → torque → a steady speed with slip.' },
  { id: 'match-loss', kind: 'match', prompt: 'Which expression gives the rotor copper loss?', options: ['s · Pag', '(1 − s) · Pag', 'Pag / s'], answer: 0, explain: 'Of the air-gap power, the fraction s is lost in the rotor resistance; (1 − s)·Pag is converted to mechanical power.', misconceptions: { 1: '(1 − s)·Pag is the mechanical power.' } },
]
