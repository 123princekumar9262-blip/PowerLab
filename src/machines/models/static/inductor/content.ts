import { gappedInductor } from '../../../calculations/static.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * Gapped power inductor on an EE ferrite core — content and explicit calculations (geometry in Model.tsx).
 * Coordinates: core in the xy plane, front +z; the air gap is in the centre leg at y = 0 (outer legs touch).
 * Positive current enters at the left pin and circulates +x on the front of the winding: flux UP the centre leg.
 */
export const IND_PARTS: MachinePart[] = [
  { id: 'clip', label: 'Spring clip', what: 'A steel strap around the two core halves.', function: 'Holds the two E halves pressed together so the outer legs touch and the gap stays exactly as ground.', outer: true, explode: [0, 0, -2.0], stage: 1, anchor: [1.27, 0.9, 0.12], related: ['core-top', 'core-bottom'] },
  { id: 'tape', label: 'Insulating tape', what: 'Polyester tape wrapped round the finished winding.', function: 'Protects the winding and insulates it from the core and clip.', outer: true, explode: [-1.95, 0, 0], stage: 3, anchor: [-0.62, 0.5, 0.86], related: ['winding'] },
  { id: 'core-top', label: 'Upper E core (ferrite)', what: 'One half of an EE core of ferrite — a ceramic magnetic material with a high permeability and a high resistivity.', function: 'Carries the flux. Ferrite’s high resistivity keeps eddy currents small at switching frequencies, so it needs no laminations.', explode: [0, 1.2, 0], stage: 2, anchor: [-0.7, 1.05, 0.5], related: ['core-bottom', 'air-gap'] },
  { id: 'core-bottom', label: 'Lower E core (ferrite)', what: 'The other half of the EE core.', function: 'Its outer legs touch the upper half; its centre leg is ground slightly shorter, leaving the air gap.', explode: [0, -1.2, 0], stage: 2, anchor: [-0.7, -1.05, 0.5], related: ['core-top', 'air-gap'] },
  { id: 'air-gap', label: 'Air gap (centre leg)', what: 'A thin gap between the two centre legs (drawn much wider than real: real gaps are fractions of a millimetre).', function: 'Dominates the reluctance of the magnetic path: it sets the inductance precisely, lets the inductor carry more current before saturation, and stores most of the energy.', explode: [0, 0, 0], stage: 2, anchor: [0.25, 0.02, 0.5], related: ['core-top', 'core-bottom'] },
  { id: 'bobbin', label: 'Bobbin', what: 'A plastic coil former with flanges, around the centre leg.', function: 'Carries the winding and insulates it from the core; its pins solder into the circuit board.', explode: [0, 0, 0], stage: 3, anchor: [0.8, -0.86, 1.1], related: ['winding', 'leads'] },
  { id: 'winding', label: 'Winding (N turns)', what: 'Enamelled copper wire wound in two layers around the bobbin (drawn turns are illustrative).', function: 'Its current i makes the magnetomotive force N·i that drives the flux; the flux linkage N·Φ = L·i.', explode: [1.95, 0, 0], stage: 3, anchor: [0.52, 0.55, 0.86], related: ['bobbin', 'leads'] },
  { id: 'leads', label: 'Leads and pins', what: 'The two wire ends, soldered to pins in the bobbin.', function: 'Connect the winding to the circuit.', explode: [1.95, 0, 0], stage: 3, anchor: [-0.55, -1.42, 1.1], related: ['winding', 'bobbin'] },
]

export const IND_LAYERS: LayerInfo[] = [
  { id: 'flux', label: 'Magnetic flux', legend: 'Blue: the flux path — up the centre leg, across the gap, back down the outer legs (half in each), drawn as seen through the winding. Short arcs at the gap: fringing flux bulging out of the gap. It follows the current and reverses with it.', conceptual: true },
  { id: 'current', label: 'Winding current', legend: 'Green: conventional current, in at one pin and round the centre leg (arrow on the front of the winding); it reverses with the conceptual AC current.', conceptual: true },
  { id: 'energy', label: 'Stored energy', legend: 'Orange glow: where the magnetic energy is stored. Brightness ∝ i² — the energy W = ½·L·i² rises and falls twice per cycle; most of it sits in the air gap, very little in the ferrite.', conceptual: true },
]

export const IND_STEPS: MachineStep[] = [
  {
    id: 'construction',
    title: '1 · Identify the construction',
    text: 'Two E-shaped ferrite halves face each other. The winding, on a bobbin, sits on the centre leg. The outer legs touch, but the centre legs leave a small air gap. A clip holds the halves together; tape protects the winding. Everything is there to make a controlled inductance that can carry a large current without saturating.',
    focus: ['core-top', 'core-bottom', 'air-gap', 'winding', 'bobbin'],
    layers: [],
    detail: 'Real gaps are typically 0.1–2 mm; here it is drawn much wider so you can see it. Powder cores (iron powder, MPP) spread the gap through the whole material instead.',
  },
  {
    id: 'mmf',
    title: '2 · Current makes flux: L = N²/ℛ',
    text: 'The current i in N turns makes a magnetomotive force N·i. It drives a flux Φ round the magnetic path — up the centre leg, across the gap, back down the outer legs. Like Ohm’s law for magnetism: Φ = N·i / ℛ, where ℛ is the reluctance of the path. The flux linkage N·Φ per ampere is the inductance: L = N²/ℛ. When the current reverses, so does the flux.',
    focus: ['winding', 'core-top', 'core-bottom'],
    layers: ['current', 'flux'],
    rotate: true,
    equation: 'Φ = N·i / ℛ    L = N·Φ / i = N² / ℛ',
  },
  {
    id: 'gap',
    title: '3 · The air gap sets the reluctance',
    text: 'Ferrite conducts flux μr (≈ 2000) times better than air. So 60 mm of ferrite path has the reluctance of only 0.03 mm of air — and a 0.5 mm gap has about 17 times more. The gap dominates: the inductance is set by its length, almost independently of the ferrite’s μr, which varies with temperature and from part to part.',
    focus: ['air-gap'],
    layers: ['flux'],
    equation: 'ℛ = (lg + le/μr) / (μ0·Ae)    L = N²·μ0·Ae / (lg + le/μr)',
    detail: 'Assumes the gap has the same area as the leg; in reality the fringing flux makes the effective gap area larger, so L is a little higher than this formula.',
  },
  {
    id: 'energy',
    title: '4 · Energy is stored mostly in the gap',
    text: 'The energy density of a magnetic field is B²/2μ. The flux density B is the same in the ferrite and in the gap (same area), but μ in the gap is μr times smaller — so each cubic millimetre of gap stores μr times more energy. Of the total W = ½·L·i², the fraction in the gap is lg / (lg + le/μr): over 90 % here. The glow rises and falls twice per cycle — energy flows in and back out.',
    focus: ['air-gap', 'winding'],
    layers: ['energy', 'flux'],
    rotate: true,
    equation: 'W = ½ · L · i²    w = B² / 2μ    W_gap / W = lg / (lg + le/μr)',
  },
  {
    id: 'saturation',
    title: '5 · Saturation',
    text: 'The ferrite can carry flux only up to its saturation flux density (≈ 0.3–0.4 T for power ferrite). Above it, μr collapses towards 1: the inductance falls and the current shoots up. B = μ0·N·i / (lg + le/μr) — so the current at which the core saturates is Isat = Bsat·(lg + le/μr)/(μ0·N). A larger gap lowers L but raises Isat: the designer trades inductance for current capability.',
    focus: ['core-top', 'core-bottom', 'air-gap'],
    layers: ['flux'],
    equation: 'B = μ0·N·i / (lg + le/μr) ≤ Bsat    Isat = Bsat·(lg + le/μr) / (μ0·N)',
    detail: 'Set the current above Isat in the Calculate tab: the energy is then not given (the linear model no longer holds) and the model marks the core as saturating.',
  },
  {
    id: 'circuit',
    title: '6 · In a circuit: v = L·di/dt',
    text: 'In a converter the inductor sees a voltage that switches: the current ramps up when the voltage is positive and down when it is negative, at a rate v/L. The volt-seconds applied set the change of flux, so they must balance over a period, or the flux walks up into saturation. Fringing flux near the gap induces eddy currents in nearby turns — designers keep the winding away from the gap. The Magnetics lab simulates this inductor, saturation included.',
    focus: ['winding', 'air-gap', 'leads'],
    layers: ['current', 'flux'],
    rotate: true,
    equation: 'v = L · di/dt    ΔΦ = (1/N)·∫v dt',
  },
]

export const IND_PARAMS: MachineParam[] = [
  { id: 'n', label: 'Turns N', unit: '', min: 1, max: 100, step: 1, value: 20 },
  { id: 'i', label: 'Current I (peak)', unit: 'A', min: 0, max: 20, step: 0.1, value: 5 },
  { id: 'lg', label: 'Air gap lg', unit: 'mm', min: 0, max: 3, step: 0.05, value: 0.5 },
  { id: 'ae', label: 'Core cross-section Ae', unit: 'mm²', min: 10, max: 500, step: 5, value: 100, level: 'standard' },
  { id: 'le', label: 'Magnetic path length le', unit: 'mm', min: 10, max: 200, step: 1, value: 60, level: 'standard' },
  { id: 'mur', label: 'Ferrite relative permeability μr', unit: '', min: 100, max: 10000, step: 50, value: 2000, level: 'engineer' },
  { id: 'bsat', label: 'Saturation flux density Bsat', unit: 'T', min: 0.2, max: 2, step: 0.01, value: 0.35, level: 'engineer' },
]

export function indCalc(p: Record<string, number>): CalcResult[] {
  const r = gappedInductor({ n: p.n, ae: p.ae * 1e-6, le: p.le * 1e-3, lg: p.lg * 1e-3, mur: p.mur, i: p.i, bsat: p.bsat })
  if (!r) return []
  return [
    { id: 'l', label: 'Inductance L', value: r.l * 1e6, unit: 'µH', formula: 'L = N²·μ0·Ae / (lg + le/μr) = N²/ℛ' },
    { id: 'rel', label: 'Reluctance ℛ', value: r.rel / 1e6, unit: 'MA/Wb', formula: 'ℛ = (lg + le/μr) / (μ0·Ae)' },
    { id: 'b', label: 'Peak flux density B at I', value: r.b, unit: 'T', formula: 'B = μ0·N·I / (lg + le/μr)', note: r.saturated ? 'Above Bsat: the core saturates — μr and L collapse, this linear value is not reached.' : undefined },
    { id: 'isat', label: 'Saturation current Isat', value: r.isat, unit: 'A', formula: 'Isat = Bsat·(lg + le/μr) / (μ0·N)' },
    { id: 'w', label: 'Stored energy at I', value: r.w === null ? null : r.w * 1e3, unit: 'mJ', formula: 'W = ½·L·I²', note: r.w === null ? 'Not given above Isat: the linear model no longer holds.' : undefined },
    { id: 'gap', label: 'Share of the energy in the gap', value: r.gapShare, unit: '%', formula: 'lg / (lg + le/μr)' },
    { id: 'l0', label: 'Inductance without a gap', value: r.lNoGap * 1e6, unit: 'µH', formula: 'L0 = N²·μ0·μr·Ae / le', note: 'Higher L, but it saturates at a much lower current — and depends on μr.' },
  ]
}

export const IND_CONTENT: MachineContent = {
  overview: 'An inductor stores energy in a magnetic field. A winding on a magnetic core makes a flux proportional to its current; a small air gap in the core sets the inductance precisely, stores most of the energy and lets the inductor carry a large current before the core saturates.',
  construction: 'EE ferrite core (this model): two E halves, outer legs touching, the centre legs ground to leave an air gap. The winding of N turns of enamelled copper is on a bobbin on the centre leg, wrapped in tape; the two ends are soldered to pins. A spring clip holds the halves together. (Other forms: gapped toroids, iron-powder and MPP cores with a distributed gap, planar cores.)',
  principle: 'The current i in N turns gives a magnetomotive force N·i; the flux is Φ = N·i/ℛ, where the reluctance ℛ of the path is dominated by the air gap. The inductance is L = N²/ℛ, the voltage v = L·di/dt, and the stored energy W = ½·L·i² — mostly in the gap, where the energy density B²/2μ0 is μr times larger than in the ferrite. The flux density must stay below the saturation of the core.',
  equations: [
    { expr: 'ℛ = (lg + le/μr) / (μ0·Ae)', meaning: 'Reluctance of the gap and the core in series (same area, fringing neglected).' },
    { expr: 'L = N² / ℛ = N²·μ0·Ae / (lg + le/μr)', meaning: 'Inductance; with lg ≫ le/μr it is set by the gap.' },
    { expr: 'W = ½ · L · I²', meaning: 'Energy stored in the magnetic field.' },
    { expr: 'B = μ0·N·I / (lg + le/μr)', meaning: 'Flux density in the core and the gap.' },
    { expr: 'Isat = Bsat·(lg + le/μr) / (μ0·N)', meaning: 'Current at which the core reaches saturation.' },
    { expr: 'v = L · di/dt', meaning: 'Voltage across the inductor (winding resistance neglected).' },
  ],
  assumptions: ['Linear core below saturation (constant μr).', 'Same cross-section Ae in the core and the gap: fringing neglected.', 'No leakage flux, winding resistance or core loss.', 'The current value is a peak (or DC) current for the flux-density and energy figures.'],
  characteristics: ['L ∝ N²: doubling the turns gives four times the inductance.', 'A larger gap lowers L and raises the saturation current.', 'Constant L up to Isat; above it L collapses and the current rises steeply.'],
  losses: ['Copper loss I²R in the winding — plus skin and proximity effects at high frequency.', 'Core loss (hysteresis + eddy) from the AC flux ripple.', 'Fringing-flux eddy loss in turns near the gap.'],
  advantages: ['Stores energy for switching converters (buck, boost, flyback).', 'A gapped core gives a stable, precise inductance.', 'Filters current ripple and limits di/dt.'],
  limitations: ['Saturation limits the current.', 'Fringing flux heats nearby conductors and radiates.', 'Size grows with the stored energy ½LI².'],
  applications: ['Buck and boost converter inductors', 'Output and EMI filter chokes', 'Flyback "transformers" (coupled inductors with a gap)', 'Power-factor-correction chokes'],
  misconceptions: [
    'The gap does not waste the core: it is where most of the energy is stored, and it makes L stable.',
    'A gap does not increase the inductance: it lowers L — but raises the current the core can carry.',
    'Saturation does not mean the current stops: it means the inductance collapses, so the current rises much faster.',
  ],
  sources: ['Standard magnetic-circuit relations (e.g. Erickson & Maksimović, Fundamentals of Power Electronics, ch. 13–14; McLyman, Transformer and Inductor Design Handbook).'],
}

export const IND_QUIZ: QuizItem[] = [
  { id: 'id-gap', kind: 'identify', prompt: 'What is the highlighted part?', part: 'air-gap', options: ['Air gap', 'Bobbin flange', 'Insulating tape', 'Clip'], answer: 0, explain: 'The air gap in the centre leg: it dominates the reluctance and stores most of the energy.' },
  { id: 'id-winding', kind: 'identify', prompt: 'What is the highlighted part?', part: 'winding', options: ['Core', 'Winding', 'Leads', 'Clip'], answer: 1, explain: 'The winding: N turns of enamelled copper on the bobbin, round the centre leg.' },
  { id: 'predict-n', kind: 'predict', prompt: 'You double the number of turns (same core and gap). What happens to the inductance?', options: ['It becomes 4 times larger', 'It doubles', 'It stays the same'], answer: 0, explain: 'L = N²/ℛ: twice the turns give four times the inductance (and the saturation current halves).', misconceptions: { 1: 'N appears twice: once in the MMF N·i that makes the flux, once in the linkage N·Φ.' } },
  { id: 'predict-gap', kind: 'predict', prompt: 'You make the air gap larger. What happens?', options: ['L falls, the saturation current rises', 'L rises, the saturation current rises', 'L falls, the saturation current falls'], answer: 0, explain: 'More gap → more reluctance → lower L = N²/ℛ, but a lower B for a given current → higher Isat.' },
  { id: 'predict-energy', kind: 'predict', prompt: 'Where is most of the magnetic energy stored in a gapped ferrite inductor?', options: ['In the air gap', 'In the ferrite', 'In the copper winding'], answer: 0, explain: 'The energy density B²/2μ is μr times higher in the gap (same B, μ0 instead of μ0·μr).', misconceptions: { 1: 'The ferrite has most of the path length but a μr-times lower energy density.' } },
  { id: 'order', kind: 'order', prompt: 'Order the chain from current to stored energy.', options: ['Current i in N turns', 'Magnetomotive force N·i', 'Flux Φ = N·i / ℛ (set mostly by the gap)', 'Flux density B = Φ / Ae', 'Energy B²/2μ, mostly in the gap'], answer: 0, explain: 'Current → MMF → flux through the reluctance → flux density → stored energy density.' },
  { id: 'match-sat', kind: 'match', prompt: 'What happens when the core saturates?', options: ['μr and L collapse; the current rises steeply', 'The flux falls to zero', 'The air gap closes'], answer: 0, explain: 'Above Bsat the core behaves almost like air: L drops sharply and di/dt = v/L becomes large.' },
]
