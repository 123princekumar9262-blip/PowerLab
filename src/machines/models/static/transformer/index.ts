import type { MachineDef } from '../../../types.ts'
import { TX_ASSEMBLIES, TX_CONTENT, TX_DISASSEMBLY, TX_LAYERS, TX_PARAMS, TX_PARTS, TX_QUIZ, TX_STEPS, txCalc } from './content.ts'
import { TransformerModel } from './Model.tsx'

const def: MachineDef = {
  id: 'transformer',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model of a single-phase CORE-TYPE transformer: a two-limb laminated core, the primary on one limb and the secondary on the other (real core-type units split both windings over both limbs, LV inside HV, to reduce leakage). Laminations drawn as 14 thick plates; turns drawn as rings, not to count. Butt-jointed yoke, no step-lap or mitred joints; no tank, oil or cooling.',
    camera: { position: [4.4, 2.9, 8.2], target: [0, 0.35, 0] },
    radius: 3,
    views: { front: [0, 0.35, 9.2], side: [9.2, 0.6, 0.2], top: [0, 9.2, 0.6], iso: [4.4, 2.9, 8.2] },
    limitations: [
      'Flux, current, EMF, leakage and energy visuals are conceptual illustrations of directions and phases, not a field simulation.',
      'The animation runs at the supply frequency slowed down (see the note); the phase relations shown are those of the ideal transformer with a resistive load.',
      'Calculations are the ideal transformer (no resistance, leakage, magnetising current or core loss) plus the sinusoidal EMF equation.',
      'Turn counts drawn are illustrative; the calculation uses the turns you set.',
      'The clamping frame is one part (its front and back clamps come off together); bolts, lead clamps and the lamination joints are not modelled.',
    ],
  },
  parts: TX_PARTS,
  assemblies: TX_ASSEMBLIES,
  disassembly: TX_DISASSEMBLY,
  disassemblyGrouping: 'attached',
  layers: TX_LAYERS,
  steps: TX_STEPS,
  params: TX_PARAMS,
  calc: txCalc,
  motion: (_calc, p) => {
    const f = p.f ?? 50
    const w = (2 * Math.PI * f) / 100
    const cap = 2 * Math.PI * 1.2
    return { omega: Math.min(w, cap), note: w <= cap ? `The flux and currents alternate at the supply frequency (${f} Hz), slowed down ×100.` : `The flux and currents alternate at ${f} Hz, shown slowed down to 1.2 cycles per second.` }
  },
  content: TX_CONTENT,
  quiz: TX_QUIZ,
  Model: TransformerModel,
}
export default def
