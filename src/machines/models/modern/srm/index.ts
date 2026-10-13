import type { MachineDef } from '../../../types.ts'
import { SRM_CONTENT, SRM_LAYERS, SRM_PARAMS, SRM_PARTS, SRM_QUIZ, SRM_STEPS, srmCalc } from './content.ts'
import { SrmModel } from './Model.tsx'

const SLOW = 300
const def: MachineDef = {
  id: 'srm',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified educational model: 6/4 three-phase switched reluctance motor (salient stator and rotor poles, coils on the stator only), with a slotted-vane optical position sensor. The converter is not drawn. Proportions are illustrative.',
    camera: { position: [4.7, 2.9, 5.7], target: [0, 0, 0.2] },
    radius: 2.8,
    views: { front: [0, 0, 7.4], side: [7.9, 0.4, 0.2], top: [0, 7.9, 0.4], iso: [4.7, 2.9, 5.7] },
    limitations: [
      'The energised phase, flux path and pull arrows are conceptual: they follow the drawn rotor angle with an ideal rule (each phase on for one 30° stroke while its inductance rises), not a magnetic-field simulation.',
      'Real controllers advance the switch-on angle and switch off before alignment, with current overlap between phases; this is not shown.',
      'The rotation of the animation is slowed down; it follows the speed set in Calculate only in proportion.',
      'The torque formula assumes linear magnetics; real SRMs work deep in saturation.',
    ],
  },
  parts: SRM_PARTS,
  layers: SRM_LAYERS,
  steps: SRM_STEPS,
  params: SRM_PARAMS,
  calc: srmCalc,
  motion: (_calc, p) => {
    const n = p.n ?? 0
    // clockwise seen from the front (negative about +z)
    return { omega: -((n / 60) * 2 * Math.PI) / SLOW, note: n > 0 ? `The rotor turns clockwise at the speed set, slowed down ×${SLOW} (${(n / SLOW).toFixed(1)} rpm on screen: about one 30° stroke every ${((60 / (n / SLOW)) / 12).toFixed(1)} s).` : 'Speed zero: the rotor stands still.' }
  },
  content: SRM_CONTENT,
  quiz: SRM_QUIZ,
  Model: SrmModel,
}
export default def
