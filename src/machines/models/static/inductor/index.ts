import type { MachineDef } from '../../../types.ts'
import { IND_CONTENT, IND_LAYERS, IND_PARAMS, IND_PARTS, IND_QUIZ, IND_STEPS, indCalc } from './content.ts'
import { InductorModel } from './Model.tsx'

const def: MachineDef = {
  id: 'inductor',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model of a gapped power inductor on an EE ferrite core: the centre-leg air gap is drawn many times wider than real, the winding is two helical layers whose turn count is illustrative (the calculation uses the N you set), no corner radii or pin details of a real bobbin.',
    camera: { position: [4.4, 2.5, 7.9], target: [0.2, -0.05, 0.3] },
    radius: 3.2,
    views: { front: [0, 0, 9.0], side: [9.0, 0.5, 0.3], top: [0, 9.0, 0.6], iso: [4.4, 2.5, 7.9] },
    limitations: [
      'Flux, fringing, current and stored-energy visuals are conceptual illustrations, not a field simulation; the animation uses a conceptual AC current (no frequency is calculated).',
      'Calculations are the linear magnetic-circuit model (same area in core and gap, no fringing, constant μr below saturation); above Isat no energy is given.',
      'The Magnetics lab simulates this inductor in a circuit, with saturation.',
    ],
  },
  parts: IND_PARTS,
  layers: IND_LAYERS,
  steps: IND_STEPS,
  params: IND_PARAMS,
  calc: indCalc,
  motion: () => ({ omega: Math.PI, note: 'Conceptual AC current at 0.5 cycles per second: the flux follows the current; the stored energy rises and falls twice per cycle.' }),
  content: IND_CONTENT,
  quiz: IND_QUIZ,
  Model: InductorModel,
}
export default def
