import { driftDepletion } from '../../calculations/semiconductors.ts'
import type { CalcResult, LayerInfo, MachineParam, MachinePart } from '../../types.ts'

/*
 * Content shared by the four power-semiconductor models (no 3D code): the package parts, the conceptual layers
 * and the drift-depletion calculation rows.
 */

/** The four package parts (TO-247 style). `back` names the terminal on the die's back side (= the tab). */
export function packageParts(p: { back: string; top: string; gate?: string; device: string }): MachinePart[] {
  return [
    {
      id: 'package',
      label: 'Moulded package',
      what: 'The black epoxy body of a TO-247-style package (drawn see-through here).',
      function: `Protects the ${p.device} die from moisture and mechanical damage and holds the leads in place. The hole takes the screw that clamps the tab to a heat sink.`,
      outer: true,
      explode: [-0.3, 0, 1.1],
      stage: 1,
      anchor: [-0.5, 0.95, 0.25],
      related: ['leadframe', 'die'],
    },
    {
      id: 'leadframe',
      label: 'Lead frame and tab',
      what: 'The copper tab the die is soldered on, and the leads.',
      function: `The tab is the ${p.back} terminal (the die's back contact) and the path for the heat to the heat sink; the leads connect the ${p.top}${p.gate ? ` and the ${p.gate}` : ''} to the circuit board.`,
      outer: true,
      explode: [0, 0, 0],
      stage: 1,
      anchor: [0.5, -1.75, -0.1],
      related: ['die', 'bond-wires'],
    },
    {
      id: 'die',
      label: 'Silicon die',
      what: `The ${p.device} chip itself: thousands of identical cells side by side (the slab on the right is one of them, magnified).`,
      function: `Does the switching. Its top metal is the ${p.top}${p.gate ? `; a small separate pad is the ${p.gate}` : ''}; its back is soldered to the tab (${p.back}).`,
      outer: true,
      explode: [0, 0, 0.3],
      stage: 2,
      anchor: [0.35, 0.4, 0.05],
      related: ['bond-wires', 'leadframe'],
    },
    {
      id: 'bond-wires',
      label: 'Bond wires',
      what: 'Thin aluminium wires welded to the die pads and the lead posts.',
      function: `Carry the current from the ${p.top} on the top of the die to its lead${p.gate ? ' (one thin wire for the gate)' : ''}. Several wires in parallel share a large current.`,
      outer: true,
      explode: [0, 0.4, 0.75],
      stage: 2,
      anchor: [-0.4, -0.55, 0.2],
      related: ['die', 'leadframe'],
    },
  ]
}

export const SEMI_LAYERS = (o: { bipolar: boolean }): LayerInfo[] => [
  {
    id: 'field',
    label: 'Depletion region and field',
    legend:
      'Pale overlay: the depletion region of the blocking junction (no free carriers; + = fixed ionised donors, − = fixed acceptors left behind). Orange arrows: the electric field E, from the + charge to the − charge. Its depth is drawn in proportion to the calculated W / drift thickness; while playing it widens as the voltage ramps up (W ∝ √V).',
    conceptual: true,
  },
  {
    id: 'carriers',
    label: 'Electrons and holes',
    legend: o.bipolar
      ? 'Yellow solid dots: electrons (move towards the + terminal). White rings: holes (move the other way; drawn slower — their mobility is lower). Both kinds flood the drift region when conducting.'
      : 'Yellow solid dots: electrons (move towards the + terminal). White rings: holes. In the on-state the MOSFET conducts with electrons only — unipolar.',
    conceptual: true,
  },
  { id: 'current', label: 'Conventional current', legend: 'Green moving dashes: conventional current (+ to −), opposite to the electron motion.', conceptual: true },
  { id: 'energy', label: 'Conduction loss (heat)', legend: 'Orange flow: the on-state loss becomes heat in the die and flows down through the back contact and the tab to the heat sink. The value is the calculated loss.', conceptual: true },
]

/** Blocking-state parameters shared by all four (drift doping and thickness are engineer-level). */
export function blockingParams(o: { label: string; v: number; vmax: number; nd: number; wd: number; wdMin: number; wdMax: number }): MachineParam[] {
  return [
    { id: 'vb', label: o.label, unit: 'V', min: 0, max: o.vmax, step: 10, value: o.v },
    { id: 'nd', label: 'Drift doping ND (×10¹⁴ cm⁻³)', unit: '×10¹⁴ cm⁻³', min: 0.2, max: 5, step: 0.1, value: o.nd, level: 'engineer' },
    { id: 'wd', label: 'Drift thickness Wd', unit: 'µm', min: o.wdMin, max: o.wdMax, step: 5, value: o.wd, level: 'engineer' },
  ]
}

/** Depletion width and peak field rows (one-sided abrupt junction into the n− drift). */
export function blockingRows(p: Record<string, number>, junction: string): CalcResult[] {
  const d = driftDepletion({ v: p.vb, nd: p.nd * 1e14, wdUm: p.wd })
  const pt = d?.punchThrough
  return [
    {
      id: 'w',
      label: `Depletion width W (${junction})`,
      value: d ? d.wUm : null,
      unit: 'µm',
      formula: pt ? 'W = Wd (punch-through: the field reaches the n+ layer)' : 'W = √(2·εSi·V / (q·ND))',
      note: pt ? 'The depletion region fills the whole drift region; the n+ layer behind it stops the field (trapezoidal field).' : 'Full-depletion approximation, built-in potential neglected; εSi = 11.7·ε0.',
    },
    {
      id: 'emax',
      label: 'Peak electric field Emax',
      value: d ? d.emax / 1000 : null,
      unit: 'kV/cm',
      formula: pt ? 'Emax = V/Wd + q·ND·Wd / (2·εSi)' : 'Emax = 2·V / W',
      note: 'Avalanche breakdown starts when Emax reaches the critical field of silicon, roughly 200–300 kV/cm (it depends on the doping).',
    },
  ]
}

/** The depletion depth as a fraction of the drift thickness (for the drawing). */
export function depletionFraction(p: Record<string, number>): number {
  const d = driftDepletion({ v: p.vb ?? 0, nd: (p.nd ?? 1) * 1e14, wdUm: p.wd ?? 100 })
  return d ? Math.max(0.12, Math.min(1, d.fraction)) : 0.5
}

/** The operating-point rows for a state that is a switching transient (no steady relation applies). */
export const TRANSIENT_NOTE = 'A switching transient: the device is moving between states, so no steady on/off relation applies. The Switching Devices lab simulates it.'
