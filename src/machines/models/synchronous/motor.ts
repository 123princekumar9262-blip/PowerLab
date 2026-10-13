import type { MachineDef } from '../../types.ts'
import { SM_CONTENT, SM_LAYERS, SM_PARAMS, SM_PARTS, SM_QUIZ, SM_STEPS, smCalc } from './motorContent.ts'
import { SyncMotorModel } from './SyncModel.tsx'

const SLOW = 100

const def: MachineDef = {
  id: 'synchronous-motor',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: the alternator construction (4-pole salient-pole rotor, 24-slot three-phase stator, slip rings) with five damper bars per pole and a driven load drawn as a short stub. Proportions are illustrative, not a specific product.',
    camera: { position: [8.25, 3.17, 4.96], target: [0, -0.35, -0.65] },
    radius: 3.4,
    views: { front: [0, 0, 9.4], side: [10, 0.2, -0.65], top: [0, 10, -0.6], iso: [8.25, 3.17, 4.96] },
    limitations: [
      'The stator-field and rotor-field arrows and the load angle are conceptual illustrations; the angle drawn follows the calculated δ (converted for the drawn 4 poles), it is not a simulation.',
      'The rotation is slowed down ×100. Beyond pull-out the rotor is drawn slipping behind the field only as an illustration: the real motion is an oscillating, pulsating torque.',
      'Starting (damper-cage induction torque, pull-in) is explained in words; its dynamics are not calculated here.',
      'Calculations use the round-rotor model on an infinite bus with Ra and all losses neglected.',
    ],
  },
  parts: SM_PARTS,
  layers: SM_LAYERS,
  steps: SM_STEPS,
  params: SM_PARAMS,
  calc: smCalc,
  motion: (calc, p) => {
    const ns = (120 * (p.f ?? 50)) / (p.poles ?? 4)
    const out = calc.n === null
    return {
      omega: ((ns / 60) * 2 * Math.PI) / SLOW,
      note: out
        ? `The stator field turns at Ns = ${ns.toFixed(0)} rpm (slowed ×${SLOW}); beyond pull-out the rotor cannot follow it.`
        : `The rotor turns at exactly Ns = 120·f/P = ${ns.toFixed(0)} rpm, slowed down ×${SLOW}, locked to the stator field.`,
    }
  },
  content: SM_CONTENT,
  quiz: SM_QUIZ,
  Model: SyncMotorModel,
}
export default def
