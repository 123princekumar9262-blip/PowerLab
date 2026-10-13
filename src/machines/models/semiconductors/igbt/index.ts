import type { MachineDef } from '../../../types.ts'
import { SEMI_CAMERA, SEMI_LIMITATIONS } from '../view.ts'
import { IGBT_CONTENT, IGBT_LAYERS, IGBT_PARAMS, IGBT_PARTS, IGBT_QUIZ, IGBT_STEPS, igbtCalc } from './content.ts'
import { IgbtModel } from './Model.tsx'

const def: MachineDef = {
  id: 'igbt',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: one planar-gate, field-stop (punch-through type) IGBT cell, extruded into a slab, beside a TO-247-style package. Layer thicknesses are illustrative; trench gates, carrier-storage layers and the co-packed diode are not drawn.',
    ...SEMI_CAMERA,
    limitations: [...SEMI_LIMITATIONS, 'The tail current and latch-up are described in words; their dynamics are not modelled here.'],
  },
  parts: IGBT_PARTS,
  layers: IGBT_LAYERS,
  steps: IGBT_STEPS,
  params: IGBT_PARAMS,
  calc: igbtCalc,
  content: IGBT_CONTENT,
  quiz: IGBT_QUIZ,
  Model: IgbtModel,
}
export default def
