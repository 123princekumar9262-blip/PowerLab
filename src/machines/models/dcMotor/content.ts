import { dcMotor } from '../../calculations/formulas.ts'
import type { Assembly, CalcResult, DisassemblyStage, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../types.ts'

/*
 * Brushed permanent-magnet DC motor — the educational content and the explicit calculations. Geometry lives in
 * Model.tsx; nothing here depends on the 3D code.
 *
 * Coordinates: the shaft is the z axis (front = +z, where the commutator is). The N magnet is on +x, the S magnet
 * on −x, so the field crosses the armature from +x to −x.
 */

type PartDraft = Omit<MachinePart, 'related'>
/** `related` (used by the generic checks and lists) is the ids of `relations`. */
const withRelated = (parts: PartDraft[]): MachinePart[] => parts.map((p) => ({ ...p, related: p.relations?.map((r) => r.id) }))

/*
 * Disassembly, six stages (front to back, outside to inside):
 *   1 front end cap + terminals → 2 brushes out of their holders → 3 brush holders → 4 rear end cap →
 *   5 bearings off the shaft → 6 stator (housing and magnets) away from the rotor.
 * The rotor (shaft, core, winding, commutator) stays in the centre: it is not taken apart in normal service.
 */
export const DC_PARTS: MachinePart[] = withRelated([
  {
    id: 'housing',
    label: 'Housing (yoke)',
    what: 'The steel outer frame — a tube around the magnets.',
    function: 'Holds everything in place and carries the magnetic flux from one magnet to the other around the outside (the return path).',
    location: 'The outer shell, between the two end caps, with the magnets fixed to its inside.',
    material: 'Mild steel (it must be magnetic: it is part of the flux path).',
    ifFaulty: 'Without a steel yoke the flux would have to return through air: the field at the armature, and with it kΦ, would be much weaker — less torque per ampere and a higher no-load speed.',
    outer: true,
    explode: [0, 2.4, 0],
    stage: 6,
    anchor: [0, 1.3, 0],
    relations: [
      { id: 'magnet-n', how: 'holds the N magnet and carries its flux round to the S magnet' },
      { id: 'magnet-s', how: 'holds the S magnet; the flux returns to the N magnet through the yoke' },
      { id: 'end-cap-front', how: 'closed at the front by the front end cap' },
      { id: 'end-cap-rear', how: 'closed at the back by the rear end cap' },
    ],
  },
  {
    id: 'end-cap-front',
    label: 'Front end cap',
    what: 'The cover at the commutator end.',
    function: 'Closes the motor at the front, keeps dirt off the commutator and carries the supply terminals.',
    location: 'The front of the motor (commutator end), around the brush gear.',
    material: 'Pressed steel or die-cast aluminium; often plastic in small motors.',
    ifFaulty: 'A cracked or loose cap lets the shaft run out of line: the rotor can rub on the magnets and the brushes wear unevenly.',
    outer: true,
    explode: [0, 0, 2.5],
    stage: 1,
    anchor: [0.9, 0.9, 1.62],
    relations: [
      { id: 'terminals', how: 'the supply terminals are mounted on it' },
      { id: 'housing', how: 'closes the front of the housing' },
      { id: 'bearing-front', how: 'locates the front bearing, which centres the shaft' },
    ],
  },
  {
    id: 'terminals',
    label: 'Supply terminals',
    what: 'Two brass terminals on the front end cap: + (top) and − (bottom).',
    function: 'Where the DC supply is connected. Each terminal is wired to one brush.',
    location: 'On the outside of the front end cap.',
    material: 'Brass (a good conductor that does not corrode easily).',
    ifFaulty: 'A loose terminal makes the current — and so the torque — intermittent. Swapping the two supply leads reverses the armature current, so a permanent-magnet motor turns the other way.',
    explode: [0, 0, 2.5],
    stage: 1,
    attachedTo: 'end-cap-front',
    inspectNote: 'The terminals are mounted on the front end cap and come off with it; shown on their own here.',
    anchor: [0.95, 0.55, 1.85],
    relations: [
      { id: 'brush-pos', how: 'the + terminal feeds the + brush' },
      { id: 'brush-neg', how: 'the − brush returns the current to the − terminal' },
      { id: 'end-cap-front', how: 'mounted on the front end cap' },
    ],
  },
  {
    id: 'brush-pos',
    label: 'Brush (+)',
    what: 'A carbon (graphite) block at the top of the commutator, connected to the + terminal.',
    function: 'Brings the supply current into the rotating commutator: current enters the armature here.',
    location: 'In the upper brush holder, pressed down onto the commutator.',
    material: 'Carbon / graphite (soft, slides with little friction, conducts); sometimes with copper added.',
    ifFaulty: 'A worn-out brush loses contact: sparking, then the motor stops when the contact breaks. Brushes are the part of this motor that wears out and is replaced.',
    explode: [0, 0.8, 0],
    stage: 2,
    anchor: [0.1, 0.42, 1.3],
    relations: [
      { id: 'commutator', how: 'slides on the commutator segments as they turn under it' },
      { id: 'brush-holders', how: 'guided by its holder and pressed on by a spring' },
      { id: 'terminals', how: 'wired to the + terminal' },
    ],
  },
  {
    id: 'brush-neg',
    label: 'Brush (−)',
    what: 'The second carbon block, opposite the first, connected to the − terminal.',
    function: 'Takes the armature current back out to the supply: current leaves the armature here.',
    location: 'In the lower brush holder, pressed up onto the commutator.',
    material: 'Carbon / graphite, like the + brush.',
    ifFaulty: 'As for the + brush: with poor contact the circuit opens and no armature current — no torque — flows.',
    explode: [0, -0.8, 0],
    stage: 2,
    anchor: [0.1, -0.42, 1.3],
    relations: [
      { id: 'commutator', how: 'slides on the segments opposite the + brush' },
      { id: 'brush-holders', how: 'guided by its holder and pressed on by a spring' },
      { id: 'terminals', how: 'wired to the − terminal' },
    ],
  },
  {
    id: 'brush-holders',
    label: 'Brush holders',
    what: 'Two brass boxes, top and bottom, that the brushes slide in.',
    function: 'Keep each brush in its place on the commutator and let a spring press it on as it wears down. (The springs and the holders’ mounting are not modelled.)',
    location: 'Fixed around the commutator at the front, one above it and one below.',
    material: 'Brass, with steel springs.',
    ifFaulty: 'A weak spring or a sticking brush gives poor contact: sparking, a hot commutator and erratic speed.',
    explode: [0, 0, 1.25],
    stage: 3,
    anchor: [0.16, 0.72, 1.18],
    relations: [
      { id: 'brush-pos', how: 'guides the + brush' },
      { id: 'brush-neg', how: 'guides the − brush' },
      { id: 'commutator', how: 'sets where the brushes touch the commutator — and so when each coil is commutated' },
    ],
  },
  {
    id: 'end-cap-rear',
    label: 'Rear end cap',
    what: 'The cover at the back.',
    function: 'Closes the motor at the back and supports the rear bearing.',
    location: 'The back of the motor, opposite the commutator end.',
    material: 'Pressed steel or die-cast aluminium.',
    ifFaulty: 'If it is loose the rear bearing is not held in line: vibration, noise and possible rubbing of the rotor.',
    outer: true,
    explode: [0, 0, -1.9],
    stage: 4,
    anchor: [-0.9, -0.9, -1.1],
    relations: [
      { id: 'bearing-rear', how: 'locates the rear bearing' },
      { id: 'housing', how: 'closes the back of the housing' },
    ],
  },
  {
    id: 'bearing-front',
    label: 'Front bearing',
    what: 'A ball bearing on the shaft at the commutator end.',
    function: 'Holds the shaft centred and lets it turn with little friction.',
    location: 'On the shaft just inside the front end cap.',
    material: 'Hardened steel rings and balls (small motors often use sintered-bronze sleeve bearings instead).',
    ifFaulty: 'A worn bearing lets the rotor move off centre: noise, vibration, and in the end the armature rubs on the magnets.',
    explode: [0, 0, 0.95],
    stage: 5,
    anchor: [0.24, -0.24, 1.6],
    relations: [
      { id: 'shaft', how: 'supports the front end of the shaft' },
      { id: 'end-cap-front', how: 'located by the front end cap' },
    ],
  },
  {
    id: 'bearing-rear',
    label: 'Rear bearing',
    what: 'A ball bearing on the shaft at the back.',
    function: 'Supports the other end of the shaft, so the rotor stays centred in the stator.',
    location: 'On the shaft inside the rear end cap.',
    material: 'Hardened steel rings and balls.',
    ifFaulty: 'As for the front bearing: friction, noise and a rotor that is no longer centred.',
    explode: [0, 0, -1.1],
    stage: 5,
    anchor: [-0.24, 0.24, -1.15],
    relations: [
      { id: 'shaft', how: 'supports the back end of the shaft' },
      { id: 'end-cap-rear', how: 'located by the rear end cap' },
    ],
  },
  {
    id: 'magnet-n',
    label: 'Permanent magnet (N pole)',
    what: 'A curved magnet facing the armature with its north pole.',
    function: 'Makes the stationary magnetic field the armature conductors work in. (In a wound-field motor a field winding on an iron pole does this.)',
    location: 'Glued inside the housing on one side (+x), with a narrow air gap to the armature.',
    material: 'Ferrite (ceramic) in low-cost motors; neodymium-iron-boron for more flux in a smaller size.',
    ifFaulty: 'A magnet weakened by overheating or by a very high armature current gives less flux: the motor runs faster at no load but needs more current for the same torque.',
    explode: [1.8, 0, 0],
    stage: 6,
    inspectNote: 'The magnets are glued to the housing; they are removed only for repair.',
    anchor: [1.0, 0.55, 0.4],
    relations: [
      { id: 'magnet-s', how: 'flux leaves this N pole, crosses the armature and enters the S pole' },
      { id: 'housing', how: 'fixed to the housing, which carries the flux back' },
      { id: 'armature-winding', how: 'the conductors passing under it carry current one way (⊙) and feel the force' },
    ],
  },
  {
    id: 'magnet-s',
    label: 'Permanent magnet (S pole)',
    what: 'The opposite magnet, south pole facing the armature.',
    function: 'Completes the field: flux leaves the N magnet, crosses the air gap and the armature, and enters the S magnet.',
    location: 'Glued inside the housing on the other side (−x), facing the N magnet.',
    material: 'The same magnet material as the N pole.',
    ifFaulty: 'As for the N magnet: less flux, so a higher speed and less torque per ampere.',
    explode: [-1.8, 0, 0],
    stage: 6,
    inspectNote: 'The magnets are glued to the housing; they are removed only for repair.',
    anchor: [-1.0, -0.55, 0.4],
    relations: [
      { id: 'magnet-n', how: 'receives the flux from the N pole' },
      { id: 'housing', how: 'fixed to the housing, the return path' },
      { id: 'armature-winding', how: 'the conductors under it carry the opposite current (⊗), so their force turns the rotor the same way' },
    ],
  },
  {
    id: 'shaft',
    label: 'Shaft',
    what: 'The steel shaft through the rotor.',
    function: 'Carries the torque out of the motor to the load, and holds the armature core and the commutator.',
    location: 'Along the axis, through the whole motor, turning in the two bearings.',
    material: 'Steel.',
    ifFaulty: 'A bent shaft makes the rotor wobble: vibration, uneven air gap and rubbing.',
    explode: [0, 0, 0],
    stage: 6,
    inspect: [0, 0, -3.4],
    inspectNote: 'The armature core and the commutator are fixed on the shaft — in a real motor the shaft never comes out on its own.',
    anchor: [0, 0.16, -1.75],
    relations: [
      { id: 'bearing-front', how: 'turns in the front bearing' },
      { id: 'bearing-rear', how: 'turns in the rear bearing' },
      { id: 'armature-core', how: 'the core is fixed on it' },
      { id: 'commutator', how: 'the commutator is pressed on it' },
    ],
  },
  {
    id: 'armature-core',
    label: 'Armature core',
    what: 'A stack of thin, insulated steel laminations with slots.',
    function: 'Guides the flux across the rotor with little reluctance and holds the windings in its slots. Laminations reduce eddy-current loss because the flux in the rotor iron alternates as it turns.',
    location: 'On the shaft, in the middle of the motor, inside the magnets.',
    material: 'Silicon-steel laminations, each insulated from the next.',
    ifFaulty: 'A solid (unlaminated) core would carry large eddy currents and heat up. Without iron the flux would cross a long air path and the field at the conductors would be very weak.',
    explode: [0, 0, 0],
    stage: 6,
    inspect: [0, -2.6, 0],
    inspectNote: 'The core is pressed onto the shaft and carries the winding in its slots; it is shown apart only so you can see it.',
    anchor: [0, 0.72, -0.5],
    relations: [
      { id: 'armature-winding', how: 'holds the conductors in its slots, in the field' },
      { id: 'shaft', how: 'fixed on the shaft' },
      { id: 'magnet-n', how: 'separated from the magnets only by the narrow air gap' },
    ],
  },
  {
    id: 'armature-winding',
    label: 'Armature winding',
    what: 'Insulated copper coils laid in the core slots.',
    function: 'Carries the armature current. Each conductor in the magnetic field feels a force (F = B·I·L); together they make the torque.',
    location: 'In the slots of the armature core; the end turns show at both ends of the core.',
    material: 'Enamelled copper wire.',
    ifFaulty: 'An open coil gives a torque dip once per turn and heavy sparking at its commutator segments; a shorted turn overheats.',
    explode: [0, 0, 0],
    stage: 6,
    inspect: [0, 2.6, 0],
    inspectNote: 'The coils are wound into the core slots and soldered to the commutator: they cannot be lifted out in one piece. Shown apart so you can see the coil sides and end turns.',
    anchor: [0.45, -0.62, 0.9],
    relations: [
      { id: 'commutator', how: 'each coil’s two ends are joined to commutator segments' },
      { id: 'armature-core', how: 'laid in the core’s slots' },
      { id: 'magnet-n', how: 'its conductors under the poles feel the force that makes the torque' },
    ],
  },
  {
    id: 'commutator',
    label: 'Commutator',
    what: 'Copper segments, insulated from each other, on the shaft; each coil end is joined to a segment.',
    function: 'Together with the brushes it reverses the current in each coil as the coil passes between the poles, so the torque keeps the same direction.',
    location: 'On the shaft at the front, under the brushes.',
    material: 'Hard-drawn copper segments separated by mica insulation.',
    ifFaulty: 'A worn, dirty or out-of-round commutator gives poor brush contact: sparking and erratic speed. Without a commutator each coil’s current would keep its direction, its torque would reverse every half turn, and the rotor would only rock to a standstill.',
    explode: [0, 0, 0],
    stage: 6,
    inspect: [0, 0, 2.4],
    inspectNote: 'The commutator is pressed onto the shaft and soldered to the coil ends; it is not removed in normal service.',
    anchor: [0.36, 0.36, 1.18],
    relations: [
      { id: 'brush-pos', how: 'the + brush slides on it' },
      { id: 'brush-neg', how: 'the − brush slides on it' },
      { id: 'armature-winding', how: 'its segments are joined to the coil ends' },
    ],
  },
])

export const DC_ASSEMBLIES: Assembly[] = [
  { id: 'stator', label: 'Stator (field assembly)', what: 'The stationary part that makes the magnetic field: the steel housing (yoke) with the two permanent-magnet poles. This motor has no field winding — the magnets give a fixed flux.', children: ['housing', 'magnet-n', 'magnet-s'], inspect: [0, 2.8, 0] },
  { id: 'rotor', label: 'Rotor (armature assembly)', what: 'The part that turns: the shaft with the laminated armature core, the armature winding and the commutator, fixed together.', children: ['shaft', 'armature-core', 'armature-winding', 'commutator'], inspect: [0, 0, -3.8] },
  { id: 'brush-gear', label: 'Brush gear and terminals', what: 'The stationary electrical path into the rotor: supply terminals → brushes (in their holders) → commutator.', children: ['terminals', 'brush-holders', 'brush-pos', 'brush-neg'], inspect: [0, 0, 2.6] },
  { id: 'frame', label: 'End caps and bearings', what: 'Close the motor and keep the shaft centred, with a bearing at each end.', children: ['end-cap-front', 'bearing-front', 'end-cap-rear', 'bearing-rear'] },
]

export const DC_DISASSEMBLY: DisassemblyStage[] = [
  { title: 'Take off the front end cap', text: 'Start at the commutator end. The front end cap comes off forward, with the supply terminals mounted on it. That uncovers the brush gear and the commutator. (In many small motors the brushes are held in the end cap and come off with it; here the holders stay in place so you can see how they meet the commutator.)' },
  { title: 'Withdraw the brushes', text: 'Each carbon brush slides out of its holder, away from the commutator — the + brush upwards, the − brush downwards. Taking the brushes off first protects them, and the commutator surface, when the rest is moved.' },
  { title: 'Remove the brush holders', text: 'The holders that guide the brushes and keep them pressed on come off forward. The commutator is now fully visible: copper segments, insulated from one another, on the shaft.' },
  { title: 'Take off the rear end cap', text: 'At the other end the rear end cap comes off backwards. It closes the motor and normally locates the rear bearing.' },
  { title: 'Pull the bearings off the shaft', text: 'Both bearings come off the shaft ends. They are what keeps the rotor centred, so that the narrow air gap between the armature and the magnets is the same all round.' },
  { title: 'Separate the stator from the rotor', text: 'The housing and the two magnets come away from the armature. (In a workshop the rotor is slid out of the housing instead; the result is the same.) Left in the centre is the rotor assembly — shaft, laminated core, winding and commutator — which is fixed together and not taken apart in normal service.' },
]

export const DC_LAYERS: LayerInfo[] = [
  { id: 'field', label: 'Magnetic field', legend: 'Blue dashed lines: the direction of the magnetic flux, from the N magnet across the armature to the S magnet, returning through the housing.', conceptual: true },
  { id: 'current', label: 'Armature current', legend: 'Green: conventional current. ⊙ = out of the screen (towards you), ⊗ = into the screen. The commutator keeps this pattern fixed relative to the poles.', conceptual: true },
  { id: 'torque', label: 'Force and torque', legend: 'Amber arrows: the force on the conductors (F = B·I·L) and the resulting torque.', conceptual: true },
  { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the direction the armature turns.', conceptual: false },
  { id: 'commutation', label: 'Commutation', legend: 'Green ⇄: the neutral zone between the poles, where the coil sides passing through have their current reversed. The commutator segments touching a brush (+ at the top, − at the bottom) glow green.', conceptual: true },
  { id: 'emf', label: 'Back EMF', legend: 'Magenta markers: the EMF induced in the moving conductors, opposing the current the supply drives.', conceptual: true },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: electrical power in at the terminals → mechanical power out at the shaft; some becomes heat (losses).', conceptual: true },
]

export const DC_STEPS: MachineStep[] = [
  {
    id: 'construction',
    view: 'iso',
    title: '1 · Identify the construction',
    text: 'Outside: the housing with two permanent magnets — the stationary field (the stator). Inside: the armature, a laminated core with copper coils, fixed on the shaft — the part that turns (the rotor). At the front, the commutator turns with the shaft, and two stationary brushes press on it to feed in the current from the terminals.',
    focus: ['magnet-n', 'magnet-s', 'armature-core', 'armature-winding', 'commutator', 'brush-pos', 'brush-neg', 'shaft'],
    layers: [],
  },
  {
    id: 'field',
    view: 'front',
    title: '2 · Establish the magnetic field',
    text: 'The magnets set up a magnetic field across the armature: flux leaves the N magnet, crosses the air gap and the armature core, enters the S magnet and returns through the steel housing. In a wound-field motor a field winding on the poles makes this field instead, and its current sets the flux Φ.',
    focus: ['magnet-n', 'magnet-s', 'housing'],
    roles: {
      'magnet-n': "Its north face sends the flux across the air gap into the armature.",
      'magnet-s': "Receives the flux after it has crossed the armature.",
      'housing': "Carries the flux back from the S magnet to the N magnet, closing the magnetic circuit.",
    },
    layers: ['field'],
    detail: 'The flux per pole Φ is fixed in a permanent-magnet motor (ignoring armature reaction); kΦ is then one constant of the motor.',
  },
  {
    id: 'current',
    view: 'front',
    title: '3 · Apply armature current',
    text: 'The supply drives current in at the + terminal and the + brush, through the commutator segment it touches, around the armature coils, and out through the − brush. Conductors under the N pole carry current one way (⊙, out of the screen); conductors under the S pole carry it the other way (⊗). The current direction is fixed relative to the poles — not relative to a particular coil.',
    focus: ['terminals', 'brush-pos', 'brush-neg', 'commutator', 'armature-winding'],
    roles: {
      'terminals': "The supply is connected here: current enters at + and leaves at −.",
      'brush-pos': "Current enters the turning armature through this brush.",
      'brush-neg': "Current leaves the armature through this brush and returns to the supply.",
      'commutator': "Connects the brushes to the coils that are under the poles at this moment.",
      'armature-winding': "Carries the armature current: out of the screen (⊙) under the N pole, into it (⊗) under the S pole.",
    },
    layers: ['field', 'current'],
  },
  {
    id: 'torque',
    view: 'front',
    title: '4 · Electromagnetic torque',
    text: 'A conductor carrying current across a magnetic field feels a force F = B·I·L, perpendicular to both. Under the N pole the force pushes the conductors one way; under the S pole the current is reversed and so is the force — both forces turn the armature the same way. Their sum around the shaft is the torque.',
    focus: ['armature-winding'],
    roles: {
      'armature-winding': "Each conductor under a pole feels F = B·I·L. Under N and under S both the current and the field are reversed, so every force turns the rotor the same way.",
    },
    layers: ['field', 'current', 'torque'],
    equation: 'T = kΦ · Ia',
    detail: 'k collects the number of conductors, poles and parallel paths: T = (P·Z / 2π·A)·Φ·Ia.',
  },
  {
    id: 'rotation',
    view: 'iso',
    title: '5 · The rotor turns',
    text: 'The torque turns the armature, and the shaft with it — clockwise seen from the commutator end in this model. The shaft turns in its two bearings and carries the torque out to the load. The speed rises until the motor’s torque is balanced by the load.',
    focus: ['armature-core', 'armature-winding', 'shaft', 'bearing-front', 'bearing-rear'],
    roles: {
      'armature-core': "Turns together with the conductors it holds in its slots.",
      'armature-winding': "The forces on its conductors make the torque that turns the rotor.",
      'shaft': "Turns with the armature and carries the torque out to the load.",
      'bearing-front': "Lets the shaft turn freely while keeping it centred.",
      'bearing-rear': "Supports the back of the turning shaft.",
    },
    layers: ['torque', 'rotation'],
    rotate: true,
    equation: 'steady state:  kΦ · Ia = TL',
    detail: 'Friction is neglected in this model, so in steady state the electromagnetic torque equals the load torque exactly.',
  },
  {
    id: 'commutation',
    view: 'front',
    title: '6 · Commutation',
    text: 'The brushes stay still while the commutator turns under them. Each coil is joined to two segments. As a coil’s sides pass the neutral zone midway between the poles (⇄), its segments pass under the brushes and the coil is switched over: its current reverses. So a conductor that moves from under the N pole to under the S pole always carries the current that pole needs for torque in the same direction. The glowing segments are the ones touching a brush.',
    focus: ['commutator', 'brush-pos', 'brush-neg', 'armature-winding'],
    roles: {
      'commutator': "Its segments slide under the brushes; as a coil passes the neutral zone its segments change brush and its current reverses.",
      'brush-pos': "Stays still while the segments pass under it — it touches the glowing segment at the top.",
      'brush-neg': "Stays still and touches the glowing segment at the bottom.",
      'armature-winding': "The coil passing the neutral zone (⇄) is the one whose current is being reversed.",
    },
    layers: ['current', 'commutation', 'rotation'],
    rotate: true,
    detail: 'While its segments bridge a brush the coil is briefly short-circuited and its current must reverse in that short time. The coil’s inductance resists the change — one cause of sparking at the brushes; larger machines add interpoles to help.',
  },
  {
    id: 'back-emf',
    view: 'front',
    title: '7 · Back EMF',
    text: 'The turning conductors cut the magnetic field, so an EMF is induced in them — the motor is also a generator. This back EMF E opposes the applied voltage. As speed rises, E rises, the current falls, and the motor settles where the torque from the remaining current balances the load.',
    focus: ['armature-winding'],
    roles: {
      'armature-winding': "Its moving conductors cut the field, so an EMF E = kΦ·ω is induced in them — it opposes the supply and limits the current.",
    },
    layers: ['field', 'emf', 'rotation'],
    rotate: true,
    equation: 'E = kΦ · ω    V = E + Ia · Ra',
    detail: 'Steady state, neglecting brush drop and armature reaction: Ia = TL / kΦ and ω = (V − Ia·Ra) / kΦ.',
  },
  {
    id: 'energy',
    view: 'iso',
    title: '8 · Energy conversion',
    text: 'Electrical power V·Ia enters at the terminals. The part E·Ia is converted into mechanical power T·ω at the shaft; Ia²·Ra is lost as heat in the winding. Real motors also lose power in the brush contact, friction, windage and the iron — so the real efficiency is lower than this ideal model says.',
    focus: ['terminals', 'shaft', 'armature-winding'],
    roles: {
      'terminals': "Electrical power V·Ia enters here.",
      'shaft': "Mechanical power T·ω leaves here, to the load.",
      'armature-winding': "Converts E·Ia into mechanical power; Ia²·Ra is lost in it as heat.",
    },
    layers: ['energy', 'rotation'],
    rotate: true,
    equation: 'V·Ia = E·Ia + Ia²·Ra    E·Ia = T·ω',
  },
]

export const DC_PARAMS: MachineParam[] = [
  { id: 'va', label: 'Armature voltage V', unit: 'V', min: 1, max: 48, step: 1, value: 24 },
  { id: 'tl', label: 'Load torque TL', unit: 'N·m', min: 0, max: 1.5, step: 0.01, value: 0.1 },
  { id: 'kphi', label: 'Motor constant kΦ', unit: 'V·s/rad', min: 0.01, max: 0.2, step: 0.005, value: 0.05, level: 'standard' },
  { id: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: 0.1, max: 5, step: 0.05, value: 1, level: 'standard' },
]

const fmt = (x: number | null) => x
export function dcCalc(p: Record<string, number>): CalcResult[] {
  const r = dcMotor({ va: p.va, kphi: p.kphi, ra: p.ra, tl: p.tl })
  if (!r) return []
  const stalled = r.stalled
  return [
    { id: 'ia', label: 'Armature current Ia', value: r.ia, unit: 'A', formula: stalled ? 'Ia = V / Ra (stalled: E = 0)' : 'Ia = TL / kΦ' },
    { id: 'e', label: 'Back EMF E', value: stalled ? 0 : r.e, unit: 'V', formula: 'E = V − Ia·Ra' },
    { id: 'n', label: 'Speed n', value: stalled ? 0 : r.n, unit: 'rpm', formula: 'ω = E / kΦ,  n = 60·ω / 2π', note: stalled ? 'The load torque is above the stall torque: the motor cannot turn.' : undefined },
    { id: 'n0', label: 'No-load speed', value: (r.noLoad * 60) / (2 * Math.PI), unit: 'rpm', formula: 'ω0 = V / kΦ (TL = 0)' },
    { id: 'ts', label: 'Stall torque', value: r.stallTorque, unit: 'N·m', formula: 'Ts = kΦ · V / Ra' },
    { id: 'pin', label: 'Electrical input', value: r.pin, unit: 'W', formula: 'Pin = V · Ia' },
    { id: 'pout', label: 'Mechanical output', value: r.pout, unit: 'W', formula: 'Pout = TL · ω = E · Ia' },
    { id: 'pcu', label: 'Copper loss', value: r.pcu, unit: 'W', formula: 'Pcu = Ia² · Ra' },
    { id: 'eff', label: 'Efficiency (this ideal model)', value: fmt(r.eff), unit: '%', formula: 'η = Pout / Pin', note: 'Brush, friction and iron losses are not in this model: a real motor is less efficient.' },
  ]
}

export const DC_CONTENT: MachineContent = {
  overview: 'A brushed DC motor turns DC electrical power into rotation. A stationary magnetic field (here from permanent magnets) acts on current-carrying armature conductors; the commutator and brushes switch the current in each coil so the torque always has the same direction.',
  construction: 'Stator: steel housing (yoke) with two permanent-magnet poles. Rotor (armature): laminated, slotted steel core with copper coils, on a shaft carried by two bearings. Commutator: insulated copper segments on the shaft at the front, each joined to coil ends. Brushes: two carbon blocks in holders on the front end cap, pressed onto the commutator.',
  principle: 'Current in a conductor in a magnetic field feels a force (F = B·I·L). The commutator keeps the current under each pole in a fixed direction, so all the forces produce torque in one direction. The turning conductors also generate a back EMF that limits the current and sets the speed.',
  equations: [
    { expr: 'T = kΦ · Ia', meaning: 'Torque is proportional to flux and armature current.' },
    { expr: 'E = kΦ · ω', meaning: 'Back EMF is proportional to flux and speed.' },
    { expr: 'V = E + Ia · Ra', meaning: 'The armature circuit: applied voltage = back EMF + resistive drop (brush drop neglected).' },
    { expr: 'ω = (V − Ia·Ra) / kΦ', meaning: 'Speed in steady state; it falls a little as load (Ia) rises.' },
    { expr: 'Pin = Pout + Pcu,   Pout = E·Ia = T·ω', meaning: 'Power balance of the ideal model.' },
  ],
  assumptions: ['Steady state (constant speed).', 'Constant flux kΦ (permanent magnets; armature reaction neglected).', 'No brush contact drop, no friction, windage or iron loss.', 'The load torque is the only mechanical torque.'],
  characteristics: ['Speed falls slightly and linearly with load torque.', 'Torque is proportional to current — high starting (stall) torque.', 'Speed is proportional to applied voltage at a given load.'],
  losses: ['Copper loss Ia²·Ra in the armature winding.', 'Brush contact drop and brush friction.', 'Iron (hysteresis and eddy) loss in the rotating armature core.', 'Bearing friction and windage.'],
  advantages: ['Simple speed control by voltage.', 'High starting torque.', 'Needs no inverter.'],
  limitations: ['Brushes and commutator wear and spark.', 'Speed limited by commutation.', 'Heat is produced in the rotor, which is harder to cool.'],
  applications: ['Toys and small tools', 'Automotive auxiliaries (wipers, windows, seats)', 'Small pumps and fans', 'Older traction and industrial drives'],
  misconceptions: [
    'The commutator does not change the supply into AC for the whole motor; it reverses the current only in the coils that pass between the poles.',
    'A bigger load does not slow a DC motor because the voltage drops: the current rises to give more torque, and the larger Ia·Ra drop leaves a smaller back EMF — so a lower speed.',
    'Back EMF is not a loss: E·Ia is exactly the power converted to mechanical power.',
  ],
  sources: ['Standard textbook relations for a separately excited / permanent-magnet DC machine (e.g. Chapman, Electric Machinery Fundamentals; Fitzgerald & Kingsley).'],
}

export const DC_QUIZ: QuizItem[] = [
  { id: 'id-commutator', kind: 'identify', prompt: 'What is the highlighted part?', part: 'commutator', options: ['Commutator', 'Bearing', 'Brush', 'Armature core'], answer: 0, explain: 'The commutator: insulated copper segments on the shaft, each joined to coil ends. It turns with the armature.', misconceptions: { 2: 'The brushes are the stationary carbon blocks that press on the commutator.' } },
  { id: 'id-brushes', kind: 'identify', prompt: 'What is the highlighted part?', part: 'brush-pos', options: ['Magnet', 'Brush', 'Commutator', 'End cap'], answer: 1, explain: 'A brush (the + brush): a stationary carbon block that slides on the commutator and brings the supply current into the rotating armature. The − brush sits opposite it.' },
  { id: 'predict-load', kind: 'predict', prompt: 'The load torque on the shaft doubles (same voltage). What happens to the armature current?', options: ['It doubles', 'It halves', 'It stays the same'], answer: 0, explain: 'In steady state T = kΦ·Ia must equal the load: double the torque needs double the current. The larger Ia·Ra drop lowers the back EMF, so the speed falls a little.', misconceptions: { 2: 'Speed changes only a little, but the current must change: it is the current that makes the torque.' } },
  { id: 'predict-voltage', kind: 'predict', prompt: 'You raise the armature voltage at the same load. What happens to the speed?', options: ['It rises', 'It falls', 'It stays the same'], answer: 0, explain: 'The current is set by the load (Ia = TL/kΦ); the back EMF E = V − Ia·Ra rises with V, and ω = E/kΦ rises with it.' },
  { id: 'order', kind: 'order', prompt: 'Put the working sequence in order.', options: ['The magnets set up the field', 'Current flows through the brushes, commutator and coils', 'The conductors feel a force: torque', 'The armature turns; the commutator reverses each coil’s current', 'The back EMF limits the current and sets the speed'], answer: 0, explain: 'Field first, then current, force and torque, rotation with commutation, and finally the back EMF that sets the operating speed.' },
  { id: 'match-emf', kind: 'match', prompt: 'Which relation gives the back EMF?', options: ['E = kΦ · ω', 'T = kΦ · Ia', 'P = V · Ia'], answer: 0, explain: 'The EMF induced in the turning armature is proportional to flux and speed.' },
]

