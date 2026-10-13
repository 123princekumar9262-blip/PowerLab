import { singlePhaseTransformer } from '../../../calculations/static.ts'
import type { Assembly, CalcResult, DisassemblyStage, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Single-phase CORE-TYPE transformer — content and explicit calculations (geometry in Model.tsx).
 * Coordinates: the core lies in the xy plane, front face towards +z, y up. Primary (HV, many turns) on the left
 * limb (x < 0), secondary (LV, few heavy turns) on the right limb. Positive mutual flux Φ circulates clockwise
 * seen from the front: up the primary limb, right along the top yoke, down the secondary limb.
 */

type PartDraft = Omit<MachinePart, 'related'>
/** `related` (used by the generic checks and lists) is the ids of `relations`. */
const withRelated = (parts: PartDraft[]): MachinePart[] => parts.map((p) => ({ ...p, related: p.relations?.map((r) => r.id) }))

/*
 * Disassembly, five stages, the reverse of how a core-type transformer is built:
 *   1 leads and terminals → 2 clamping frame → 3 top yoke (up and back, out of the way) →
 *   4 windings lifted UP off the limbs → 5 insulating tubes off the limbs. Left standing: the U-shaped core.
 */
export const TX_PARTS: MachinePart[] = withRelated([
  {
    id: 'frame',
    label: 'Clamping frame',
    what: 'Steel channel clamps on the yokes, tie rods and feet.',
    function: 'Presses the laminations tightly together (less hum and vibration) and holds the coils against the large forces of a short-circuit current. In an oil-filled transformer the whole active part would sit in a tank.',
    location: 'Across the top and bottom yokes, front and back, with the feet underneath.',
    material: 'Structural steel channels and steel tie rods.',
    ifFaulty: 'Loose clamping lets the laminations vibrate — a louder hum — and in a short circuit the electromagnetic forces could push the windings out of place.',
    outer: true,
    explode: [0, 0, -2.0],
    stage: 2,
    anchor: [1.55, -1.25, 0.5],
    relations: [
      { id: 'core', how: 'clamps the laminations of the limbs and bottom yoke together' },
      { id: 'top-yoke', how: 'presses the top yoke down onto the limbs' },
      { id: 'primary', how: 'braces the windings against short-circuit forces' },
    ],
  },
  {
    id: 'core',
    label: 'Laminated core (limbs + bottom yoke)',
    what: 'A stack of thin silicon-steel sheets, each coated with insulation: two vertical limbs joined by the bottom yoke.',
    function: 'Gives the alternating flux a low-reluctance closed path, so that nearly all of the flux made by the primary also passes through the secondary. Thin insulated sheets keep the eddy currents small.',
    location: 'The centre of the transformer: two vertical limbs inside the windings, joined at the bottom by the bottom yoke.',
    material: 'Grain-oriented silicon steel, sheets about 0.27–0.35 mm thick, each with an insulating coating.',
    ifFaulty: 'Without iron the flux would spread out in the air: the primary would need a huge magnetising current and most of the flux would miss the secondary. A solid (unlaminated) core would carry large eddy currents and overheat; damaged insulation between sheets causes hot spots.',
    explode: [0, 0, 0],
    stage: 5,
    inspect: [0, -2.8, 0],
    inspectNote: 'The windings sit on the limbs: in reality the core is freed only after the top yoke and the coils are off (see Disassemble).',
    anchor: [0, -1.25, 0.42],
    relations: [
      { id: 'top-yoke', how: 'closed at the top by the top yoke' },
      { id: 'primary', how: 'the flux the primary makes runs up its left limb' },
      { id: 'secondary', how: 'the same flux runs down the right limb, through the secondary' },
    ],
  },
  {
    id: 'top-yoke',
    label: 'Top yoke',
    what: 'The upper bar of laminations that closes the magnetic circuit.',
    function: 'Joins the two limbs at the top. It is stacked last, after the coils have been slid onto the limbs — that is why the core is built from separate pieces.',
    location: 'Across the tops of the two limbs, above the windings.',
    material: 'The same insulated silicon-steel sheets as the rest of the core.',
    ifFaulty: 'A poor joint — an air gap between the yoke and the limbs — raises the reluctance: more magnetising current and more hum.',
    explode: [0, 1.4, -1.4],
    stage: 3,
    anchor: [0.15, 1.5, -0.3],
    relations: [
      { id: 'core', how: 'butted onto the tops of the limbs to close the flux path' },
      { id: 'frame', how: 'clamped down by the frame' },
    ],
  },
  {
    id: 'insulation',
    label: 'Insulating tubes',
    what: 'Pressboard cylinders between each limb and its winding.',
    function: 'Insulate the windings from the earthed core and hold them in shape. Insulation also separates the turns (enamel) and the layers (paper); it sets the voltage the transformer can withstand.',
    location: 'Around each limb, between the iron and the winding, along its full height.',
    material: 'Pressboard (compressed cellulose), oil-impregnated in oil-filled units.',
    ifFaulty: 'Insulation aged by heat or moisture breaks down: a winding-to-core fault. The life of the insulation, not of the copper or the iron, usually sets the life of a transformer.',
    explode: [0, 1.25, 0],
    stage: 5,
    inspectNote: 'The tubes come off only after the coils (see Disassemble).',
    anchor: [0.96, -0.95, 0.3],
    relations: [
      { id: 'primary', how: 'carries and insulates the primary winding' },
      { id: 'secondary', how: 'carries and insulates the secondary winding' },
      { id: 'core', how: 'separates the windings from the earthed core' },
    ],
  },
  {
    id: 'primary',
    label: 'Primary winding (HV)',
    what: 'Many turns N1 of thin enamelled copper on the left limb, its two ends led up to the HV bushings.',
    function: 'Connected to the AC supply. Its current magnetises the core; with a load it also carries the "reflected" load current that balances the secondary’s ampere-turns.',
    location: 'On the left limb, on its insulating tube.',
    material: 'Enamelled copper wire (aluminium in some designs).',
    ifFaulty: 'A shorted turn acts like an extra, short-circuited secondary: a large current circulates in it, it overheats locally and the winding soon fails.',
    explode: [0, 3.2, 0],
    stage: 4,
    inspectNote: 'Physically a coil slides off its limb only after the top yoke has been removed (see Disassemble).',
    anchor: [-1.25, 0.6, 0.74],
    relations: [
      { id: 'hv-terminals', how: 'its two ends come out to the HV bushings' },
      { id: 'core', how: 'its current magnetises the core' },
      { id: 'secondary', how: 'linked to it only through the core flux — no electrical connection' },
    ],
  },
  {
    id: 'secondary',
    label: 'Secondary winding (LV)',
    what: 'Few turns N2 of heavy copper on the right limb, its two thick leads going up to the LV terminals.',
    function: 'The same flux passes through it, so an EMF of N2 times the volts per turn is induced in it. It delivers the load current — fewer turns, larger current, hence the thicker conductor.',
    location: 'On the right limb, on its insulating tube.',
    material: 'Heavy copper strip or thick enamelled wire.',
    ifFaulty: 'A short circuit on the load side drives a very large current in both windings, limited only by their resistance and leakage reactance — the protection must clear it quickly.',
    explode: [0, 3.2, 0],
    stage: 4,
    inspectNote: 'Physically a coil slides off its limb only after the top yoke has been removed (see Disassemble).',
    anchor: [1.25, 0.6, 0.74],
    relations: [
      { id: 'lv-terminals', how: 'its ends come out to the LV terminals' },
      { id: 'core', how: 'the core’s flux passes through it' },
      { id: 'primary', how: 'its ampere-turns are balanced by the primary’s: N1·I1 = N2·I2' },
    ],
  },
  {
    id: 'hv-terminals',
    label: 'Primary bushings (1U, 1V)',
    what: 'Two porcelain bushings on a terminal board, where the primary’s two leads end.',
    function: 'Connect the supply to the primary while keeping the high voltage insulated from the frame. The sheds lengthen the surface path for leakage current.',
    location: 'On top, above the primary winding.',
    material: 'Porcelain bushings on a board of insulating material.',
    ifFaulty: 'A cracked or dirty bushing can track or flash over to the earthed frame.',
    explode: [-0.2, 0.7, 0.5],
    stage: 1,
    anchor: [-1.6, 1.62, 0.7],
    relations: [
      { id: 'primary', how: 'connects the supply to the primary’s two ends' },
      { id: 'lv-terminals', how: 'no electrical path to the LV terminals — the two sides are isolated' },
    ],
  },
  {
    id: 'lv-terminals',
    label: 'Secondary terminals (2U, 2V)',
    what: 'Two short bushings with brass studs, where the secondary’s heavy leads end.',
    function: 'Connect the load. Lower voltage needs less insulation; higher current needs thicker leads and studs.',
    location: 'On top, above the secondary winding.',
    material: 'Short bushings with brass studs.',
    ifFaulty: 'A loose stud at high current overheats and can burn the terminal.',
    explode: [0.2, 0.7, 0.5],
    stage: 1,
    anchor: [1.62, 1.45, 0.7],
    relations: [
      { id: 'secondary', how: 'connects the load to the secondary’s two ends' },
      { id: 'hv-terminals', how: 'isolated from the HV side: energy crosses only through the core' },
    ],
  },
])

export const TX_ASSEMBLIES: Assembly[] = [
  { id: 'primary-circuit', label: 'Primary circuit (input)', what: 'The input side: the primary winding with its leads and HV bushings, connected to the AC supply.', children: ['primary', 'hv-terminals'], inspect: [-0.4, 3.4, 0] },
  { id: 'magnetic-circuit', label: 'Magnetic circuit (core)', what: 'The closed iron path that carries the mutual flux: the U-shaped stack (two limbs and the bottom yoke) closed by the top yoke. It is the only link between the two circuits.', children: ['core', 'top-yoke'], inspect: [0, -3, 0] },
  { id: 'secondary-circuit', label: 'Secondary circuit (output)', what: 'The output side: the secondary winding with its leads and LV terminals, connected to the load. It has no electrical connection to the primary.', children: ['secondary', 'lv-terminals'], inspect: [0.4, 3.4, 0] },
  { id: 'structure', label: 'Insulation and structure', what: 'What keeps it all apart and together: the insulating tubes between the windings and the core, and the clamping frame.', children: ['insulation', 'frame'] },
]

export const TX_DISASSEMBLY: DisassemblyStage[] = [
  { title: 'Disconnect the leads and terminals', text: 'First the supply and the load are disconnected, the winding leads are undone from the bushings, and the terminal boards with their bushings are lifted off. The leads stay with their windings. Note that the HV (primary) and LV (secondary) terminals are separate: there is no electrical path between the two sides.' },
  { title: 'Remove the clamping frame', text: 'The clamps and tie rods that press the laminations together come off. They also brace the windings against the forces of a short circuit.' },
  { title: 'Unstack the top yoke', text: 'The top yoke is taken off (in a real transformer sheet by sheet). On assembly it goes on last, after the coils are on the limbs — that is why the core is built from separate pieces and not as one closed ring.' },
  { title: 'Lift the windings off the limbs', text: 'With the top yoke gone, each winding slides up and off its limb: the primary, many turns of thin wire, and the secondary, few turns of heavy copper.' },
  { title: 'Slide off the insulating tubes', text: 'Last, the pressboard tubes come off the limbs. Left standing is the U-shaped laminated core: the two limbs and the bottom yoke.' },
]

export const TX_LAYERS: LayerInfo[] = [
  { id: 'flux', label: 'Mutual flux Φ', legend: 'Blue dashes and arrows: the mutual flux in the core, drawn as seen through the coils. It goes round the core one way, shrinks to zero and reverses every half-cycle of the supply; it links both windings.', conceptual: true },
  { id: 'current', label: 'Currents', legend: 'Green: conventional current — in the supply and load leads, and an arrow on the front of each coil showing which way it circulates. Thicker/brighter = larger; it reverses each half-cycle.', conceptual: true },
  { id: 'emf', label: 'Induced EMF', legend: 'Magenta: the EMF induced by the changing flux — the arrow on the secondary shows the way it drives current; + / − mark the terminal polarity at this instant (1U and 2U are the "dotted", same-polarity terminals).', conceptual: true },
  { id: 'field', label: 'Leakage flux', legend: 'Light blue loops in the window: leakage flux — flux made by one winding’s current that closes through the air without linking the other winding. It acts like a small series inductance.', conceptual: true },
  { id: 'energy', label: 'Energy flow', legend: 'Orange: power flows from the supply into the primary, crosses to the secondary through the alternating magnetic field (no electrical connection) and on to the load; a small part becomes heat in the copper and the core.', conceptual: true },
]

export const TX_STEPS: MachineStep[] = [
  {
    id: 'construction',
    view: 'iso',
    title: '1 · Identify the construction',
    text: 'A core-type transformer: a closed rectangular core of thin, insulated silicon-steel laminations with two limbs. The primary winding (many turns of thin wire) sits on the left limb, the secondary (few turns of heavy copper) on the right limb, each on an insulating tube. Nothing moves, and there is no electrical connection between the two windings — only the core links them.',
    focus: ['core', 'top-yoke', 'primary', 'secondary', 'insulation'],
    layers: [],
    detail: 'Real core-type transformers split both windings over both limbs, the LV winding inside and the HV winding outside, to reduce leakage. A shell-type transformer puts both windings on the centre limb of a three-limb (E-I) core, the flux returning through both outer limbs.',
  },
  {
    id: 'magnetising',
    view: 'front',
    title: '2 · No load: a small magnetising current',
    text: 'Connect the primary to an AC voltage with the secondary open. The primary behaves as a large inductance: only a small magnetising current flows (a few percent of the rated current). It is just enough to drive the flux around the low-reluctance core, and it lags the voltage by almost 90°. The animation runs at no load: the green arrow is this small current, in step with the flux.',
    focus: ['primary', 'core', 'hv-terminals'],
    roles: {
      'primary': "Connected to the AC supply; with the secondary open, only a small magnetising current flows in it.",
      'core': "Carries the flux that the magnetising current drives round it.",
      'hv-terminals': "The supply is connected here.",
    },
    layers: ['current', 'flux'],
    rotate: true,
    equation: 'v1 ≈ e1 = N1 · dΦ/dt',
    detail: 'The magnetising current is not sinusoidal in a real core (the B-H curve is non-linear: third harmonic); a small in-phase component supplies the core loss.',
  },
  {
    id: 'flux',
    view: 'front',
    title: '3 · Alternating mutual flux',
    text: 'The flux in the core alternates with the supply: it grows, reverses and grows the other way, fifty times a second at 50 Hz. Its size is set by the applied voltage, not by the load: the induced EMF must balance the supply, so Φm = V1 / (4.44·f·N1). Almost all of it stays in the iron and therefore passes through the secondary too — this is the mutual flux.',
    focus: ['core', 'top-yoke'],
    roles: {
      'core': "Carries the alternating mutual flux; its peak Φm = V1 / (4.44·f·N1) is set by the supply, not by the load.",
      'top-yoke': "Closes the flux path across the top.",
    },
    layers: ['flux'],
    rotate: true,
    equation: 'V1 = 4.44 · f · N1 · Φm    (sinusoidal flux, winding drop neglected)',
    detail: 'Peak flux density Bm = Φm / Ae. Designers keep Bm below the saturation of the steel (silicon steel: roughly 1.5–1.7 T in normal designs).',
  },
  {
    id: 'emf',
    view: 'front',
    title: '4 · Induced secondary EMF and the turns ratio',
    text: 'Every turn on the core sees the same changing flux, so the same EMF is induced per turn ("volts per turn"). The secondary has N2 turns, so its EMF is N2 times the volts per turn; the primary’s self-induced EMF balances the supply with N1 turns. Hence the voltage ratio equals the turns ratio. The + and − marks swap every half-cycle: the output is AC at the same frequency.',
    focus: ['secondary', 'primary', 'lv-terminals'],
    roles: {
      'secondary': "The same changing flux passes through it, so e2 = N2·dΦ/dt is induced — N2 times the volts per turn.",
      'primary': "Its own induced EMF balances the supply voltage.",
      'lv-terminals': "The secondary voltage appears here.",
    },
    layers: ['flux', 'emf'],
    rotate: true,
    equation: 'e2 = N2 · dΦ/dt    V1 / V2 = N1 / N2',
    detail: 'Ideal transformer: no winding resistance, no leakage, infinite core permeability. A real transformer’s secondary voltage falls a little with load (regulation).',
  },
  {
    id: 'load',
    view: 'front',
    title: '5 · Load current and the reflected primary current',
    text: 'Connect a load: the secondary EMF drives a current I2. Its ampere-turns N2·I2 would oppose and cut the flux — but the flux is held by the supply voltage, so the primary immediately draws an extra current whose ampere-turns cancel them: N1·I1 = N2·I2. Note on the coils: both currents circulate the same way on the front faces — so they magnetise their limbs in opposite senses around the core. More load → more secondary current → more primary current, with the flux unchanged.',
    focus: ['primary', 'secondary', 'hv-terminals', 'lv-terminals'],
    roles: {
      'primary': "Draws the reflected current that keeps N1·I1 = N2·I2.",
      'secondary': "Delivers the load current I2.",
      'hv-terminals': "The primary current flows in here.",
      'lv-terminals': "The load is connected here.",
    },
    layers: ['current', 'flux'],
    rotate: true,
    equation: 'N1 · I1 = N2 · I2    I1 / I2 = N2 / N1    R seen = (N1/N2)² · RL',
    detail: 'The total primary current is the reflected load current plus the small magnetising current. Power in = power out in the ideal transformer: V1·I1 = V2·I2.',
  },
  {
    id: 'losses',
    view: 'front',
    title: '6 · Leakage and losses — why laminations',
    text: 'Some flux of each winding closes through the air without linking the other (leakage): it behaves as a small series inductance and makes the output voltage sag under load. Losses: copper loss I²R in both windings; core loss from hysteresis (the steel is magnetised back and forth every cycle) and from eddy currents (the changing flux induces circulating currents in the iron itself). Thin sheets insulated from each other break up the eddy-current paths: eddy loss falls with the square of the sheet thickness.',
    focus: ['core', 'primary', 'secondary'],
    roles: {
      'core': "Hysteresis and eddy-current losses happen here; thin insulated laminations keep the eddy loss small.",
      'primary': "Copper loss I1²·R1, and some of its flux leaks through the air (leakage).",
      'secondary': "Copper loss I2²·R2, and its own leakage flux.",
    },
    layers: ['field', 'energy'],
    rotate: true,
    equation: 'Pcu = I1²·R1 + I2²·R2    Ph ∝ f·Bmⁿ    Pe ∝ f²·Bm²·t²',
    detail: 'n ≈ 1.6–2 (Steinmetz). Core loss is almost independent of the load (it depends on V and f); copper loss grows with the load squared. Maximum efficiency where they are equal.',
  },
  {
    id: 'limits',
    view: 'front',
    title: '7 · Limits',
    text: 'A transformer works only with a changing flux: on DC there is no induced EMF, and the current is limited only by the winding resistance — it burns. The volts-per-hertz is limited: a higher voltage or a lower frequency raises Bm and the core saturates, the magnetising current then rises steeply. The current is limited by heating of the windings, and the voltage by the insulation. Switching on can cause a large inrush current if the flux starts with an offset.',
    focus: ['core', 'insulation', 'primary'],
    roles: {
      'core': "Saturates if V/f is too high: the magnetising current then rises steeply.",
      'insulation': "Sets the highest voltage the transformer can withstand.",
      'primary': "Its heating limits the current; on DC only its resistance would limit it.",
    },
    layers: ['flux'],
    equation: 'Bm = V1 / (4.44 · f · N1 · Ae) — keep below saturation',
    detail: 'The Magnetics lab simulates the transformer with its magnetising inductance and leakage, including DC offset and inrush.',
  },
]

export const TX_PARAMS: MachineParam[] = [
  { id: 'v1', label: 'Primary voltage V1 (rms)', unit: 'V', min: 12, max: 400, step: 1, value: 230 },
  { id: 'n1', label: 'Primary turns N1', unit: '', min: 50, max: 2000, step: 10, value: 920 },
  { id: 'n2', label: 'Secondary turns N2', unit: '', min: 10, max: 2000, step: 2, value: 96 },
  { id: 'rl', label: 'Load resistance RL', unit: 'Ω', min: 0.5, max: 200, step: 0.1, value: 4.8 },
  { id: 'f', label: 'Frequency f', unit: 'Hz', min: 10, max: 400, step: 1, value: 50, level: 'standard' },
  { id: 'ae', label: 'Core cross-section Ae', unit: 'cm²', min: 1, max: 50, step: 0.5, value: 10, level: 'standard' },
]

export function txCalc(p: Record<string, number>): CalcResult[] {
  const r = singlePhaseTransformer({ v1: p.v1, f: p.f, n1: p.n1, n2: p.n2, rl: p.rl, ae: p.ae * 1e-4 })
  if (!r) return []
  const sat = r.bm > 1.7
  return [
    { id: 'a', label: 'Turns ratio a', value: r.a, unit: '', formula: 'a = N1 / N2' },
    { id: 'v2', label: 'Secondary voltage V2', value: r.v2, unit: 'V', formula: 'V2 = V1 · N2 / N1' },
    { id: 'i2', label: 'Secondary (load) current I2', value: r.i2, unit: 'A', formula: 'I2 = V2 / RL' },
    { id: 'i1', label: 'Primary current I1 (reflected)', value: r.i1, unit: 'A', formula: 'I1 = I2 · N2 / N1', note: 'Ideal: the small magnetising current is not included.' },
    { id: 's', label: 'Apparent power S', value: r.s, unit: 'VA', formula: 'S = V1·I1 = V2·I2' },
    { id: 'rseen', label: 'Load seen from the primary', value: r.rSeen, unit: 'Ω', formula: "R' = a² · RL" },
    { id: 'vpt', label: 'Volts per turn', value: r.voltsPerTurn, unit: 'V', formula: 'V1 / N1 = V2 / N2' },
    { id: 'phim', label: 'Peak core flux Φm', value: r.phiM * 1e3, unit: 'mWb', formula: 'Φm = V1 / (4.44 · f · N1)', note: 'Independent of the load.' },
    { id: 'bm', label: 'Peak flux density Bm', value: r.bm, unit: 'T', formula: 'Bm = Φm / Ae', note: sat ? 'Above about 1.7 T: silicon steel saturates — the magnetising current would rise steeply. Raise N1, Ae or f, or lower V1.' : 'Normal designs keep Bm below about 1.5–1.7 T in silicon steel.' },
  ]
}

export const TX_CONTENT: MachineContent = {
  overview: 'A transformer changes an AC voltage to a higher or lower one with almost no loss. Two windings sit on one laminated iron core; the alternating flux made by the primary passes through the secondary and induces a voltage in it. There is no moving part and no electrical connection between the windings.',
  construction: 'Core-type construction (this model): a rectangular core of insulated silicon-steel laminations with two limbs and two yokes; the primary (HV, many turns of thin wire) on one limb and the secondary (LV, few turns of heavy conductor) on the other, each on an insulating tube. The leads come out to bushings / terminals. A clamping frame holds the core and the coils; larger units sit in an oil-filled tank with cooling fins. (Shell-type: both windings on the centre limb of an E-I core.)',
  principle: 'Faraday’s law: a changing flux through a coil induces an EMF of N·dΦ/dt. The primary voltage sets the flux (its induced EMF must balance the supply); the same flux passes through the secondary, so each winding gets the same volts per turn. A load current in the secondary is balanced by an extra primary current with equal ampere-turns, so power passes from primary to secondary through the magnetic field.',
  equations: [
    { expr: 'V1 / V2 = N1 / N2 = a', meaning: 'Voltage ratio = turns ratio (ideal transformer).' },
    { expr: 'I1 / I2 = N2 / N1', meaning: 'Ampere-turn balance N1·I1 = N2·I2 (magnetising current neglected).' },
    { expr: 'V1 = 4.44 · f · N1 · Φm', meaning: 'EMF equation: the applied voltage sets the peak flux (sinusoidal).' },
    { expr: 'Bm = Φm / Ae', meaning: 'Peak flux density in the core of net area Ae — must stay below saturation.' },
    { expr: "R' = a² · RL", meaning: 'A load RL on the secondary looks like a²·RL from the primary (impedance transformation).' },
    { expr: 'S = V1·I1 = V2·I2', meaning: 'Power in = power out (ideal).' },
  ],
  assumptions: ['Ideal transformer: no winding resistance, no leakage flux, no core loss.', 'Infinite core permeability: no magnetising current (the steps describe it qualitatively).', 'Sinusoidal supply; resistive load.', 'The core flux density value assumes the sinusoidal EMF equation and the net iron area Ae.'],
  characteristics: ['Output voltage almost constant from no load to full load (regulation of a few percent from resistance and leakage).', 'Primary current follows the load current in the ratio N2/N1.', 'Core flux is set by V/f and is almost independent of load.', 'Efficiency is highest where copper loss equals core loss.'],
  losses: ['Copper loss I²R in both windings (grows with the load squared).', 'Hysteresis loss: energy to magnetise the steel back and forth each cycle (∝ f).', 'Eddy-current loss: currents induced in the iron itself (∝ f²·t² — hence thin laminations).', 'Stray loss from leakage flux in the frame and tank; dielectric loss in the insulation.'],
  advantages: ['No moving parts: very reliable, very efficient.', 'Galvanic isolation between primary and secondary.', 'Any voltage ratio by the turns ratio; also matches impedances.'],
  limitations: ['Works only on AC (changing flux).', 'Heavy and large at 50/60 Hz — size falls with frequency (hence high-frequency transformers in converters).', 'Saturation if V/f is too high; inrush current at switch-on.', 'Leakage inductance causes a voltage drop under load.'],
  applications: ['Transmission and distribution (step-up at the power station, step-down to consumers)', 'Power supplies and adapters', 'Isolation transformers', 'Instrument transformers (CT, VT)', 'High-frequency transformers in SMPS'],
  misconceptions: [
    'The flux does not grow with the load: it is set by the supply voltage. The load currents’ ampere-turns cancel each other.',
    'A transformer does not create power: a voltage step-up means a current step-down.',
    'Laminations are not there to make the core lighter: they cut the eddy-current loss.',
    'A transformer on DC does not give a DC output: with no change of flux there is no induced EMF, and the primary current is limited only by its resistance.',
  ],
  sources: ['Standard textbook relations (e.g. Chapman, Electric Machinery Fundamentals; Hughes, Electrical and Electronic Technology).'],
}

export const TX_QUIZ: QuizItem[] = [
  { id: 'id-core', kind: 'identify', prompt: 'What is the highlighted part?', part: 'core', options: ['Laminated core', 'Clamping frame', 'Secondary winding', 'Insulating tube'], answer: 0, explain: 'The laminated core: thin, insulated silicon-steel sheets that carry the mutual flux between the windings.', misconceptions: { 1: 'The frame is the steel clamping outside the core; it carries no useful flux.' } },
  { id: 'id-secondary', kind: 'identify', prompt: 'What is the highlighted part?', part: 'secondary', options: ['Primary winding', 'Secondary winding', 'Top yoke', 'Bushing'], answer: 1, explain: 'The secondary (LV) winding: few turns of heavy copper — it carries the larger load current at the lower voltage.', misconceptions: { 0: 'The primary has many turns of thinner wire (higher voltage, smaller current).' } },
  { id: 'predict-n2', kind: 'predict', prompt: 'You double the secondary turns N2 (same primary). What happens to the secondary voltage?', options: ['It doubles', 'It halves', 'It stays the same'], answer: 0, explain: 'The volts per turn are set by the primary (V1/N1); twice the turns give twice the voltage: V2 = V1·N2/N1.' },
  { id: 'predict-load', kind: 'predict', prompt: 'The load current doubles. What happens to the primary current and to the core flux?', options: ['Primary current doubles, flux about the same', 'Both double', 'Primary current the same, flux doubles'], answer: 0, explain: 'Ampere-turn balance: N1·I1 = N2·I2, so I1 doubles. The flux is set by V1/(4.44·f·N1) and stays almost the same.', misconceptions: { 1: 'The extra primary ampere-turns cancel the secondary’s: the net magnetising MMF — and the flux — do not change.' } },
  { id: 'predict-dc', kind: 'predict', prompt: 'The primary is connected to a DC voltage of the same value. What happens?', options: ['A large current, limited only by the winding resistance; no secondary voltage', 'The secondary gives the same voltage as DC', 'Nothing: no current flows'], answer: 0, explain: 'No change of flux → no induced EMF to oppose the supply and nothing induced in the secondary. The core saturates and the current is V/R1 — usually enough to burn the winding.' },
  { id: 'order', kind: 'order', prompt: 'Put the chain of events in order (loaded transformer).', options: ['AC voltage applied to the primary', 'Magnetising current drives an alternating flux', 'The flux induces an EMF in the secondary', 'The secondary drives a load current', 'The primary draws a balancing (reflected) current'], answer: 0, explain: 'Supply → magnetising current → alternating mutual flux → induced secondary EMF → load current → reflected primary current that keeps the ampere-turns balanced.' },
  { id: 'match-lam', kind: 'match', prompt: 'Why is the core made of thin insulated laminations?', options: ['To reduce eddy-current loss', 'To reduce copper loss', 'To increase the turns ratio'], answer: 0, explain: 'The changing flux induces currents in the iron itself; insulated thin sheets break their paths. Eddy loss ∝ thickness².', misconceptions: { 1: 'Copper loss is in the windings (I²R); the core construction does not change it.' } },
]
