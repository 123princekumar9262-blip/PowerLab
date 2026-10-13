import type { MachineDef } from '../../../types.ts'
import { SP_CONTENT, SP_LAYERS, SP_PARAMS, SP_PARTS, SP_QUIZ, SP_STEPS, spCalc, spMotion } from './content.ts'
import { SinglePhaseModel } from './Model.tsx'

const def: MachineDef = {
  id: 'single-phase-induction',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model of a capacitor-start motor: 24-slot stator with a main winding in two-thirds of the slots and an auxiliary winding 90° electrical away (re-laid for 2 or 4 poles), 18-bar skewed cage, start capacitor on the frame, centrifugal switch (flyweights, collar, stationary contact) at the rear. Wiring between capacitor, switch and auxiliary winding is not drawn; proportions are illustrative.',
    camera: { position: [4.9, 3.1, 6.5], target: [-0.6, 0.1, 0.0] },
    radius: 3.2,
    views: { front: [0, 0.3, 7.6], side: [8.0, 0.6, 0.0], top: [0, 8.0, 0.4], iso: [4.9, 3.1, 6.5] },
    limitations: [
      'Field arrows, current cones and torque arrows are conceptual illustrations — not a field simulation.',
      'The starting field is drawn as an ideal rotating field (auxiliary current exactly 90° ahead); a real capacitor gives an elliptical field.',
      'Calculations: double-revolving-field circuit of an illustrative motor, running on the main winding only; no core or friction loss.',
      'Field and rotor turn at the calculated speeds, slowed down ×50; in the starting steps the rotor is held at rest.',
    ],
  },
  parts: SP_PARTS,
  layers: SP_LAYERS,
  steps: SP_STEPS,
  params: SP_PARAMS,
  calc: spCalc,
  motion: spMotion,
  content: SP_CONTENT,
  quiz: SP_QUIZ,
  Model: SinglePhaseModel,
}
export default def
