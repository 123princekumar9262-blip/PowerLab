import type { MachineDef } from '../../../types.ts'
import { SEMI_CAMERA, SEMI_LIMITATIONS } from '../view.ts'
import { SCR_CONTENT, SCR_LAYERS, SCR_PARAMS, SCR_PARTS, SCR_QUIZ, SCR_STEPS, scrCalc } from './content.ts'
import { ScrModel } from './Model.tsx'

const def: MachineDef = {
  id: 'scr',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: a slice of a thyristor die (p-n-p-n, gate on the p base beside the cathode), extruded into a slab, beside a TO-247-style package. Layer thicknesses are illustrative; cathode shorts, amplifying gates and edge bevels are not drawn.',
    ...SEMI_CAMERA,
    limitations: [...SEMI_LIMITATIONS, 'The two-transistor model uses constant gains; latching (IL), turn-off time tq and dv/dt, di/dt limits are described, not modelled here.'],
  },
  parts: SCR_PARTS,
  layers: SCR_LAYERS,
  steps: SCR_STEPS,
  params: SCR_PARAMS,
  calc: scrCalc,
  content: SCR_CONTENT,
  quiz: SCR_QUIZ,
  Model: ScrModel,
}
export default def
