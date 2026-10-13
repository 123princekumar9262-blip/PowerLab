import type { MachineDef } from '../../../types.ts'
import { AT_CONTENT, AT_LAYERS, AT_PARAMS, AT_PARTS, AT_QUIZ, AT_STEPS, atCalc } from './content.ts'
import { AutotransformerModel } from './Model.tsx'

const def: MachineDef = {
  id: 'autotransformer',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model of a single-phase step-down autotransformer on a SHELL-TYPE (E-I) core: one winding on the centre limb, drawn as 20 rings, with a tap whose height follows N2/N1 from the Calculate tab. The two sections are shaded differently only to tell them apart. E and I stacks drawn as plates (no interleaving); a variac would use a toroidal core and a sliding brush.',
    camera: { position: [4.6, 2.5, 9.0], target: [0, -0.1, 0.3] },
    radius: 3.2,
    views: { front: [0, -0.1, 9.6], side: [9.6, 0.4, 0.3], top: [0, 9.6, 0.6], iso: [4.6, 2.5, 9.0] },
    limitations: [
      'Flux, currents and power-split visuals are conceptual illustrations (resistive load, ideal autotransformer), not a field simulation.',
      'Calculations are the ideal step-down autotransformer: no resistance, leakage, magnetising current or core loss.',
      'The tap position drawn is rounded to the nearest of the 20 rings drawn.',
    ],
  },
  parts: AT_PARTS,
  layers: AT_LAYERS,
  steps: AT_STEPS,
  params: AT_PARAMS,
  calc: atCalc,
  motion: () => ({ omega: (2 * Math.PI * 50) / 100, note: 'Flux and currents alternate at 50 Hz, slowed down ×100.' }),
  content: AT_CONTENT,
  quiz: AT_QUIZ,
  Model: AutotransformerModel,
}
export default def
