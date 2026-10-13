import type { MachineDef } from '../../types.ts'
import { ALT_CONTENT, ALT_LAYERS, ALT_PARAMS, ALT_PARTS, ALT_QUIZ, ALT_STEPS, altCalc } from './alternatorContent.ts'
import { AlternatorModel } from './SyncModel.tsx'

const SLOW = 100

const def: MachineDef = {
  id: 'alternator',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: 4-pole salient-pole rotor with series field coils, 24-slot stator with a single-layer full-pitch three-phase winding (2 slots per pole per phase), two slip rings, a bolted coupling and a prime mover drawn as a short stub. Proportions are illustrative, not a specific product.',
    camera: { position: [8.25, 3.17, 4.96], target: [0, -0.35, -0.65] },
    radius: 3.4,
    views: { front: [0, 0, 9.4], side: [10, 0.2, -0.65], top: [0, 10, -0.6], iso: [8.25, 3.17, 4.96] },
    limitations: [
      'Field paths, current and EMF markers and the EMF bars are conceptual illustrations of directions and sequence, not a field simulation or a measurement.',
      'The rotor turns at the set speed slowed down ×100; the drawn rotor always has 4 poles whatever pole number the calculation uses.',
      'Real machines use double-layer, short-pitched windings with many more slots, damper bars and often a brushless exciter; cooling and the exciter are omitted.',
      'Calculations use the round-rotor equivalent circuit with a resistive load: no saturation, saliency, iron, friction or excitation losses.',
    ],
  },
  parts: ALT_PARTS,
  layers: ALT_LAYERS,
  steps: ALT_STEPS,
  params: ALT_PARAMS,
  calc: altCalc,
  motion: (_calc, p) => {
    const n = p.n ?? 0
    return { omega: ((n / 60) * 2 * Math.PI) / SLOW, note: `The rotor turns at the set speed n = ${n} rpm, slowed down ×${SLOW} (counter-clockwise seen from the slip-ring end).` }
  },
  content: ALT_CONTENT,
  quiz: ALT_QUIZ,
  Model: AlternatorModel,
}
export default def
