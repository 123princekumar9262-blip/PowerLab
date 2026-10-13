import type { MachineDef } from '../../../types.ts'
import { WR_CONTENT, WR_LAYERS, WR_PARAMS, WR_PARTS, WR_QUIZ, WR_STEPS, wrCalc, wrMotion } from './content.ts'
import { WoundRotorModel } from './Model.tsx'

const def: MachineDef = {
  id: 'wound-rotor',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: the cage model’s 36-slot stator; a 24-slot rotor with a single-layer three-phase winding re-laid for 2 or 4 poles, leads through the hollow shaft to three slip rings, three brushes and a star resistor bank with a moving shorting bar. Proportions are illustrative; the slip-ring cover and brush-lifting gear are not drawn.',
    camera: { position: [5.1, 3.2, 6.6], target: [-0.3, 0.05, -0.2] },
    radius: 3.3,
    views: { front: [0, 0.3, 7.8], side: [8.2, 0.6, -0.2], top: [0, 8.2, 0.3], iso: [5.1, 3.2, 6.6] },
    limitations: [
      'Field, current and force markers are conceptual illustrations of directions — not a field simulation.',
      'Field and rotor turn at the calculated speeds, slowed down ×50; in the starting steps the rotor is held at rest (s = 1).',
      'Calculations: steady-state per-phase equivalent circuit of one example machine, with the external resistance referred to the stator; brush drop, core and friction losses neglected.',
      'Real rotor windings are usually double-layer wave or lap windings; here a single-layer concentric winding is drawn.',
    ],
  },
  parts: WR_PARTS,
  layers: WR_LAYERS,
  steps: WR_STEPS,
  params: WR_PARAMS,
  calc: wrCalc,
  motion: wrMotion,
  content: WR_CONTENT,
  quiz: WR_QUIZ,
  Model: WoundRotorModel,
}
export default def
