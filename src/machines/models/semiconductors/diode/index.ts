import type { MachineDef } from '../../../types.ts'
import { SEMI_CAMERA, SEMI_LIMITATIONS } from '../view.ts'
import { DIODE_CONTENT, DIODE_LAYERS, DIODE_PARAMS, DIODE_PARTS, DIODE_QUIZ, DIODE_STEPS, diodeCalc } from './content.ts'
import { DiodeModel } from './Model.tsx'

const def: MachineDef = {
  id: 'power-diode',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: a slice of a p-i-n power diode die (with one guard ring at the edge), extruded into a slab, beside a TO-247-style two-lead package. Layer thicknesses are illustrative; real dice use several rings or field plates.',
    ...SEMI_CAMERA,
    limitations: [...SEMI_LIMITATIONS, 'Forward and reverse recovery are described and illustrated, not simulated here.'],
  },
  parts: DIODE_PARTS,
  layers: DIODE_LAYERS,
  steps: DIODE_STEPS,
  params: DIODE_PARAMS,
  calc: diodeCalc,
  content: DIODE_CONTENT,
  quiz: DIODE_QUIZ,
  Model: DiodeModel,
}
export default def
