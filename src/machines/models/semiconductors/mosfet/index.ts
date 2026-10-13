import type { MachineDef } from '../../../types.ts'
import { MOSFET_CONTENT, MOSFET_LAYERS, MOSFET_PARAMS, MOSFET_PARTS, MOSFET_QUIZ, MOSFET_STEPS, mosfetCalc } from './content.ts'
import { MosfetModel } from './Model.tsx'
import { SEMI_CAMERA, SEMI_LIMITATIONS } from '../view.ts'

const def: MachineDef = {
  id: 'mosfet',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: one planar double-diffused (DMOS) n-channel cell, extruded into a slab, beside a TO-247-style package. Layer thicknesses are illustrative (in a real device the drift region is tens of µm and the gate oxide tens of nm); trench and superjunction variants are not drawn.',
    ...SEMI_CAMERA,
    limitations: [...SEMI_LIMITATIONS, 'The body diode’s reverse recovery and the device capacitances are described, not drawn.'],
  },
  parts: MOSFET_PARTS,
  layers: MOSFET_LAYERS,
  steps: MOSFET_STEPS,
  params: MOSFET_PARAMS,
  calc: mosfetCalc,
  content: MOSFET_CONTENT,
  quiz: MOSFET_QUIZ,
  Model: MosfetModel,
}
export default def
