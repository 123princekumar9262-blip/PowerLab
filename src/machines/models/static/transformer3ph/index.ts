import type { MachineDef } from '../../../types.ts'
import { T3_CONTENT, T3_LAYERS, T3_PARAMS, T3_PARTS, T3_QUIZ, T3_STEPS, t3Calc } from './content.ts'
import { Transformer3phModel } from './Model.tsx'

const def: MachineDef = {
  id: 'transformer-3ph',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model of a three-phase, three-limb CORE-TYPE transformer: LV winding inside, HV winding outside on each limb, star/delta connections drawn as bare leads that follow the Calculate settings. Laminations as 12 plates, turns as rings (not to count); no tank, oil, radiators, tap changer or cooling ducts.',
    camera: { position: [4.8, 3.0, 9.2], target: [0.1, 0.15, 0.3] },
    radius: 3.4,
    views: { front: [0, 0.15, 10.2], side: [10.2, 0.6, 0.3], top: [0, 10.2, 0.8], iso: [4.8, 3.0, 9.2] },
    limitations: [
      'Fluxes, currents and energy arrows are conceptual illustrations of directions and phases (balanced, positive sequence, unity power factor), not a field simulation.',
      'Calculations are the ideal transformer on each limb with the standard star/delta relations; no losses, leakage or magnetising current.',
      'The 30° phase displacement is shown as a magnitude; the clock number (sign) depends on the winding connection details.',
    ],
  },
  parts: T3_PARTS,
  layers: T3_LAYERS,
  steps: T3_STEPS,
  params: T3_PARAMS,
  calc: t3Calc,
  motion: () => ({ omega: (2 * Math.PI * 50) / 100, note: 'The three fluxes and currents alternate at 50 Hz, slowed down ×100 (positive sequence A → B → C).' }),
  content: T3_CONTENT,
  quiz: T3_QUIZ,
  Model: Transformer3phModel,
}
export default def
