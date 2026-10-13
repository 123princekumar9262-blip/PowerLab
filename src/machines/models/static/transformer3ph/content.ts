import { threePhaseTransformer, type Conn } from '../../../calculations/static.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Three-phase three-limb CORE-TYPE transformer — content and explicit calculations (geometry in Model.tsx).
 * Limbs A, B, C at x = −1.6, 0, +1.6 (front +z, y up). Each limb carries an LV winding (inside) and an HV winding
 * (outside). HV connections are drawn at the top, LV connections at the bottom front; they follow the
 * connection parameters (0 = star, 1 = delta).
 */
export const conn = (x: number | undefined): Conn => (x === 0 ? 'Y' : 'D')
export const connName = (c: Conn) => (c === 'Y' ? 'star (Y)' : 'delta (Δ)')

export const T3_PARTS: MachinePart[] = [
  { id: 'frame', label: 'Clamping frame', what: 'Steel clamps on the top and bottom yokes, and feet.', function: 'Holds the laminations tight and the coils in place against short-circuit forces; in service the active part sits in an oil tank with radiators.', outer: true, explode: [0, 0, -2.0], stage: 1, anchor: [1.95, -1.22, 0.45], related: ['core'] },
  { id: 'core', label: 'Three-limb laminated core', what: 'Silicon-steel laminations: three vertical limbs joined by the bottom yoke.', function: 'Each limb carries the flux of one phase. Because the three fluxes add up to zero at every instant, the yokes close their paths and no separate return limb is needed.', explode: [0, 0, 0], stage: 1, anchor: [-0.8, -1.22, 0.36], related: ['top-yoke'] },
  { id: 'top-yoke', label: 'Top yoke', what: 'The upper bar of laminations.', function: 'Joins the tops of the three limbs; stacked after the coils are placed.', explode: [0, 1.0, 0], stage: 2, anchor: [0.8, 1.45, -0.3], related: ['core'] },
  { id: 'insulation', label: 'Insulation (tubes and HV–LV barrier)', what: 'Pressboard tubes on the limbs and a barrier cylinder between the LV and HV windings.', function: 'Insulate the LV winding from the earthed core and the HV winding from the LV winding; the gap also forms a cooling duct for the oil.', explode: [0, 0, 0], stage: 3, anchor: [-1.33, 0.97, 0.38], related: ['lv-windings', 'hv-windings'] },
  { id: 'lv-windings', label: 'LV windings (a, b, c)', what: 'Three low-voltage windings of heavy copper, one on each limb, next to the core.', function: 'Deliver the output. They are placed inside because they need the least insulation to the earthed core.', explode: [0, 0, 0], stage: 3, anchor: [-1.6, -0.75, 0.56], related: ['hv-windings', 'lv-connections'] },
  { id: 'hv-windings', label: 'HV windings (A, B, C)', what: 'Three high-voltage windings of many turns, outside the LV windings.', function: 'Take the supply. Concentric with the LV winding on the same limb: they share almost all of their flux (low leakage).', explode: [0, 1.1, 1.7], stage: 3, anchor: [1.6, 0.55, 0.83], related: ['lv-windings', 'hv-connections'] },
  { id: 'hv-connections', label: 'HV connections and bushings', what: 'The leads joining the HV windings in delta or star, and three bushings (A, B, C).', function: 'Make the three windings into one three-phase circuit. In delta each winding sits between two lines; in star each sits between a line and the neutral point.', explode: [0, 1.0, -0.1], stage: 1, anchor: [-1.95, 1.75, 0.72], related: ['hv-windings'] },
  { id: 'lv-connections', label: 'LV connections and terminals', what: 'The LV leads joined in star (with the neutral n brought out) or delta, and the terminal studs a, b, c (n).', function: 'A star LV with a neutral gives a four-wire supply: phase-to-neutral voltage for single-phase loads, line voltage for three-phase loads.', explode: [0, -0.5, 0.5], stage: 1, anchor: [2.05, -1.32, 1.05], related: ['lv-windings'] },
]

export const T3_LAYERS: LayerInfo[] = [
  { id: 'flux', label: 'Limb fluxes Φa, Φb, Φc', legend: 'Blue arrows drawn through the windings: the flux in each limb and in the yokes. The three limb fluxes are 120° apart — while one is largest, the other two are smaller and opposite, so their sum is zero at every instant.', conceptual: true },
  { id: 'current', label: 'Line and winding currents', legend: 'Green: conventional current in the line leads (dashes) and in each winding (arrows on the front of each HV coil, and drawn through it for the LV coil: on one limb the LV current circulates the opposite way — ampere-turn balance), 120° apart from limb to limb. In a delta the winding current is the line current ÷ √3 and shifted 30°; in a star they are the same.', conceptual: true },
  { id: 'energy', label: 'Energy flow', legend: 'Orange arrows: power enters at the HV bushings, crosses to the LV windings magnetically on each limb, and leaves at the LV terminals: S = √3·VL·IL on both sides (ideal).', conceptual: true },
]

export const T3_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'A three-limb core-type transformer: one laminated core with three limbs, one per phase. On each limb the LV winding sits next to the core and the HV winding surrounds it, separated by an insulating barrier. Each limb is in effect a single-phase transformer; the yokes join the three magnetic circuits.',
    focus: ['core', 'top-yoke', 'lv-windings', 'hv-windings', 'insulation'],
    layers: [],
    detail: 'Alternatives: three separate single-phase transformers (a bank — spare units are cheaper), or a five-limb core (lower height, a path for zero-sequence flux).',
  },
  {
    id: 'flux',
    title: '2 · Three fluxes that add up to zero',
    text: 'Balanced three-phase voltages make three fluxes of equal size, 120° apart in time. Watch the arrows: while the flux in one limb is at its largest, the other two are half as large and in the opposite direction. The flux leaving the top of one limb returns down the other two — the three sum to zero, so the yokes close every path and no fourth limb is needed.',
    focus: ['core', 'top-yoke'],
    layers: ['flux'],
    rotate: true,
    equation: 'Φa + Φb + Φc = 0    Φk = Φm · sin(ωt − k·120°)',
    detail: 'The middle limb’s magnetic path is shorter, so its magnetising current is a little smaller: the no-load currents of a three-limb transformer are slightly unbalanced.',
  },
  {
    id: 'connections',
    title: '3 · Star and delta connections',
    text: 'The three windings on each side are joined in star (Y: one end of each to a common neutral point) or delta (Δ: in a ring, each winding between two lines). The model shows the connections set in the Calculate tab — by default HV in delta, LV in star with the neutral n brought out (Dyn). Star: each winding sees the phase voltage VL/√3 and carries the line current. Delta: each winding sees the full line voltage and carries IL/√3.',
    focus: ['hv-connections', 'lv-connections'],
    layers: ['current'],
    rotate: true,
    equation: 'Star: VL = √3·Vph, IL = Iph    Delta: VL = Vph, IL = √3·Iph',
  },
  {
    id: 'ratio',
    title: '4 · Voltage ratio of the three-phase transformer',
    text: 'On each limb the winding voltages follow the turns ratio: Vph2 = Vph1·N2/N1. The line voltages then depend on the connections. For a delta–star (Dy) transformer the LV line voltage is √3 times its winding voltage, so the line-voltage ratio is N1 / (√3·N2). Example: 11 kV delta, 2200 : 50 turns → 250 V per LV winding → 433 V between LV lines.',
    focus: ['hv-windings', 'lv-windings'],
    layers: ['flux', 'current'],
    rotate: true,
    equation: 'Vph2 = Vph1 · N2/N1    VL1/VL2 = (Vph1/Vph2) · (√3 factors of the connections)',
    detail: 'Power per phase is one third of the total: S = 3·Vph·Iph = √3·VL·IL on each side.',
  },
  {
    id: 'phase-shift',
    title: '5 · Phase shift between the sides',
    text: 'In star–star or delta–delta the LV line voltages are in phase with the HV ones. In star–delta or delta–star they are shifted by 30°, because a delta line voltage is one winding voltage while a star line voltage is the difference of two. The shift and its sign are part of the vector group (e.g. Dyn11: LV leads by 30°). Transformers can work in parallel only with the same vector group.',
    focus: ['hv-connections', 'lv-connections'],
    layers: ['current'],
    rotate: true,
    equation: 'Yy, Dd: 0°    Yd, Dy: ±30°',
  },
  {
    id: 'practice',
    title: '6 · Why Dyn for distribution — losses and limits',
    text: 'A distribution transformer is usually delta on HV, star with neutral on LV: the neutral gives 230 V phase-to-neutral and 400 V line-to-line for consumers, and the delta lets the triplen (3rd-harmonic) magnetising currents circulate inside the transformer and handles unbalanced LV loads well. Losses are as in a single-phase transformer: copper loss in six windings, hysteresis and eddy loss in the core. Limits: winding temperature (current), insulation (voltage), V/f (saturation).',
    focus: ['hv-connections', 'lv-connections', 'core'],
    layers: ['energy'],
    detail: 'A star–star three-limb transformer without a delta winding has a poor zero-sequence path: unbalanced phase-to-neutral loads shift the neutral voltage.',
  },
]

export const T3_PARAMS: MachineParam[] = [
  { id: 'vl1', label: 'HV line voltage VL1', unit: 'V', min: 400, max: 33000, step: 100, value: 11000 },
  { id: 'c1', label: 'HV connection (0 = star Y, 1 = delta Δ)', unit: '', min: 0, max: 1, step: 1, value: 1, options: [0, 1] },
  { id: 'c2', label: 'LV connection (0 = star Y, 1 = delta Δ)', unit: '', min: 0, max: 1, step: 1, value: 0, options: [0, 1] },
  { id: 's', label: 'Load (balanced, unity power factor) S', unit: 'kVA', min: 0, max: 2500, step: 10, value: 250 },
  { id: 'n1', label: 'HV turns per phase N1', unit: '', min: 100, max: 5000, step: 10, value: 2200, level: 'standard' },
  { id: 'n2', label: 'LV turns per phase N2', unit: '', min: 10, max: 500, step: 1, value: 50, level: 'standard' },
]

export function t3Calc(p: Record<string, number>): CalcResult[] {
  const c1 = conn(p.c1)
  const c2 = conn(p.c2)
  const r = threePhaseTransformer({ vl1: p.vl1, n1: p.n1, n2: p.n2, c1, c2, s: p.s * 1e3 })
  if (!r) return []
  const group = `${c1 === 'Y' ? 'Y' : 'D'}${c2 === 'Y' ? 'y' : 'd'}`
  return [
    { id: 'vph1', label: 'HV winding (phase) voltage', value: r.vph1, unit: 'V', formula: c1 === 'Y' ? 'Vph1 = VL1 / √3 (star)' : 'Vph1 = VL1 (delta)' },
    { id: 'vph2', label: 'LV winding (phase) voltage', value: r.vph2, unit: 'V', formula: 'Vph2 = Vph1 · N2 / N1 (same limb)' },
    { id: 'vl2', label: 'LV line voltage VL2', value: r.vl2, unit: 'V', formula: c2 === 'Y' ? 'VL2 = √3 · Vph2 (star)' : 'VL2 = Vph2 (delta)' },
    { id: 'ratio', label: 'Line-voltage ratio VL1/VL2', value: r.lineRatio, unit: '', formula: 'VL1 / VL2', note: `Turns ratio per limb N1/N2 = ${r.turnsRatio.toFixed(2)}; the connections change the line ratio${c1 === c2 ? ' (here: not at all).' : ' by √3.'}` },
    { id: 'il1', label: 'HV line current IL1', value: r.il1, unit: 'A', formula: 'IL1 = S / (√3 · VL1)' },
    { id: 'iph1', label: 'HV winding current', value: r.iph1, unit: 'A', formula: c1 === 'Y' ? 'Iph1 = IL1 (star)' : 'Iph1 = IL1 / √3 (delta)' },
    { id: 'il2', label: 'LV line current IL2', value: r.il2, unit: 'A', formula: 'IL2 = S / (√3 · VL2)' },
    { id: 'iph2', label: 'LV winding current', value: r.iph2, unit: 'A', formula: c2 === 'Y' ? 'Iph2 = IL2 (star)' : 'Iph2 = IL2 / √3 (delta)' },
    { id: 'shift', label: 'Phase displacement HV → LV', value: r.shiftDeg, unit: '°', formula: c1 === c2 ? `${group}: same connection on both sides → 0°` : `${group}: star on one side, delta on the other → 30°`, note: c1 === c2 ? undefined : 'Lead or lag depends on how the windings are joined (e.g. Dyn11: LV leads by 30°; Dyn1: lags).' },
    { id: 'sph', label: 'Power per limb', value: r.sPerPhase / 1e3, unit: 'kVA', formula: 'S / 3 = Vph · Iph' },
  ]
}

export const T3_CONTENT: MachineContent = {
  overview: 'A three-phase transformer changes the voltage of a three-phase system with one core: three limbs, each carrying the windings of one phase. The windings of each side are joined in star or delta, which sets the line-voltage ratio and the phase shift between the sides.',
  construction: 'Three-limb core-type (this model): a laminated silicon-steel core with three limbs and two yokes. On each limb, the LV winding is placed next to the core and the HV winding concentrically outside it, separated by an insulating barrier (also a cooling duct). The HV and LV leads are joined in star or delta and brought out to bushings / terminals. Large units sit in an oil tank with radiators and a conservator.',
  principle: 'Each limb works as a single-phase transformer: its winding voltages follow the turns ratio. Balanced three-phase voltages make three fluxes 120° apart whose sum is zero, so the limbs return each other’s flux through the yokes. Star or delta connections then set line voltages, line currents and the phase displacement.',
  equations: [
    { expr: 'Vph2 / Vph1 = N2 / N1', meaning: 'On each limb, the winding voltages follow the turns ratio.' },
    { expr: 'Star: VL = √3·Vph, IL = Iph', meaning: 'Each winding between a line and the neutral.' },
    { expr: 'Delta: VL = Vph, IL = √3·Iph', meaning: 'Each winding between two lines.' },
    { expr: 'S = √3·VL·IL = 3·Vph·Iph', meaning: 'Apparent power (balanced), the same on both sides in the ideal transformer.' },
    { expr: 'Φa + Φb + Φc = 0', meaning: 'Balanced fluxes: no return limb needed in a three-limb core.' },
    { expr: 'Yd / Dy: 30° shift; Yy / Dd: 0°', meaning: 'Phase displacement between HV and LV line voltages.' },
  ],
  assumptions: ['Ideal transformer on each limb (no resistance, leakage, magnetising current or core loss).', 'Balanced, sinusoidal supply and a balanced load at unity power factor.', 'Positive phase sequence A-B-C.', 'The 30° shift is given as a magnitude; its sign depends on the winding connection (clock number).'],
  characteristics: ['The line-voltage ratio equals the turns ratio for Yy and Dd, and differs by √3 for Yd and Dy.', 'Star windings carry the line current at phase voltage; delta windings carry line current ÷ √3 at line voltage.', 'A three-limb core is cheaper and lighter than three single-phase units of the same rating.'],
  losses: ['Copper loss in the six windings (∝ load²).', 'Core loss (hysteresis + eddy) in limbs and yokes, set by V and f.', 'Stray losses from leakage flux in the tank and clamps.'],
  advantages: ['One core and tank: less steel, less space and lower cost than a bank of three single-phase transformers.', 'Star/delta choice gives a neutral where needed and a path for triplen harmonics.', 'Higher efficiency than three separate units.'],
  limitations: ['A fault in one phase takes the whole unit out (a bank of three can keep a spare).', 'Three-limb cores have a poor zero-sequence (unbalanced) flux path.', 'Parallel operation needs the same vector group, ratio and similar impedance.'],
  applications: ['Distribution transformers (11 kV Δ / 400 V Yn)', 'Generator step-up and transmission transformers', 'Industrial supplies and converter (rectifier) transformers'],
  misconceptions: [
    'The line-voltage ratio is not always the turns ratio: with star on one side and delta on the other it differs by √3.',
    'The middle limb does not carry the sum of the other two: the three fluxes sum to zero, and each limb carries only its own phase flux.',
    'Star–delta does not change the power: the √3 in voltage is matched by a √3 in current.',
  ],
  sources: ['Standard textbook relations (e.g. Chapman, Electric Machinery Fundamentals; IEC 60076-1 vector-group notation).'],
}

export const T3_QUIZ: QuizItem[] = [
  { id: 'id-hv', kind: 'identify', prompt: 'What is the highlighted part?', part: 'hv-windings', options: ['HV windings', 'LV windings', 'Top yoke', 'Insulating barrier'], answer: 0, explain: 'The HV windings: outside, concentric with the LV winding on each limb.', misconceptions: { 1: 'The LV windings are inside, next to the core — they need the least insulation to it.' } },
  { id: 'id-core', kind: 'identify', prompt: 'What is the highlighted part?', part: 'core', options: ['Clamping frame', 'Three-limb laminated core', 'LV connections', 'HV windings'], answer: 1, explain: 'The three-limb laminated core: one limb per phase, joined by the yokes.' },
  { id: 'predict-sum', kind: 'predict', prompt: 'At an instant when the flux in limb A is at its positive peak, what are the fluxes in limbs B and C?', options: ['Each −½ of the peak', 'Both zero', 'Both +½ of the peak'], answer: 0, explain: 'sin(90° − 120°) = sin(90° − 240°) = −½: the other two carry half each in the opposite direction, so the sum is zero.' },
  { id: 'predict-dy', kind: 'predict', prompt: 'HV is changed from delta to star (same HV line voltage, same turns). What happens to the LV voltages?', options: ['They fall by √3', 'They rise by √3', 'They stay the same'], answer: 0, explain: 'In star each HV winding sees VL/√3 instead of VL, so every LV winding voltage — and the LV line voltage — falls by √3.' },
  { id: 'order', kind: 'order', prompt: 'Order the calculation of a delta–star LV line voltage.', options: ['HV line voltage', 'HV winding voltage (delta: equal to line)', 'LV winding voltage = × N2/N1', 'LV line voltage = √3 × winding voltage (star)'], answer: 0, explain: 'Line → winding (by the HV connection) → turns ratio on the limb → winding → line (by the LV connection).' },
  { id: 'match-shift', kind: 'match', prompt: 'Which connection gives a 30° phase shift between HV and LV line voltages?', options: ['Delta–star (Dy)', 'Star–star (Yy)', 'Delta–delta (Dd)'], answer: 0, explain: 'Mixing star and delta shifts the line voltages by 30°; the same connection on both sides gives 0°.' },
]
