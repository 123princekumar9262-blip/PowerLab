import type { MachineDef } from '../../../types.ts'
import { PMSM_CONTENT, PMSM_LAYERS, PMSM_PARAMS, PMSM_PARTS, PMSM_QUIZ, PMSM_STEPS, pmsmCalc } from './content.ts'
import { PmsmModel } from './Model.tsx'

const SLOW = 500
const def: MachineDef = {
  id: 'pmsm',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified educational model: 4-pole interior-magnet (IPM) rotor with one flat magnet bar per pole, 24-slot stator with a single-layer full-pitch distributed winding (end windings coloured by phase), resolver at the rear. Real IPM machines often use V-shaped or multi-layer magnets, double-layer short-pitched windings and skew. The inverter and controller are not drawn.',
    camera: { position: [4.9, 3.1, 6.0], target: [0, 0.1, 0.2] },
    radius: 2.9,
    views: { front: [0, 0, 7.8], side: [8.3, 0.4, 0.2], top: [0, 8.3, 0.4], iso: [4.9, 3.1, 6.0] },
    limitations: [
      'Current markers, field poles and the d/q arrows are conceptual illustrations computed from the drawn rotor angle with id = 0; they are not a field simulation.',
      'The rotation of the animation is slowed down a great deal; the stator field and the rotor turn together (synchronous) in it, as in the machine.',
      'Calculations are the ideal steady-state d–q model with id = 0 (no saturation, iron loss or inverter limits).',
      'The Drives lab simulates a PMSM with field-oriented control (validated circuit model).',
    ],
  },
  parts: PMSM_PARTS,
  layers: PMSM_LAYERS,
  steps: PMSM_STEPS,
  params: PMSM_PARAMS,
  calc: pmsmCalc,
  motion: (calc) => {
    const n = calc.ns ?? 0
    return { omega: ((n / 60) * 2 * Math.PI) / SLOW, note: n > 0 ? `The rotor turns at the calculated synchronous speed slowed down ×${SLOW} (${(n / SLOW).toFixed(1)} rpm on screen).` : 'At f = 0 the field does not turn: the rotor stands still.' }
  },
  content: PMSM_CONTENT,
  quiz: PMSM_QUIZ,
  Model: PmsmModel,
}
export default def
