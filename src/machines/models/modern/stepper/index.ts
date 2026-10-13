import type { MachineDef } from '../../../types.ts'
import { STEPPER_CONTENT, STEPPER_LAYERS, STEPPER_PARAMS, STEPPER_PARTS, STEPPER_QUIZ, STEPPER_STEPS, stepperCalc } from './content.ts'
import { StepperModel } from './Model.tsx'

const SHOWN_RATE = 1.25 // full steps per second on screen
const def: MachineDef = {
  id: 'stepper',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified educational model: two-phase hybrid stepper, 1.8° (8 stator poles with 5 teeth each, two 50-tooth rotor cups offset by half a tooth, axial ring magnet), square frame. Lamination lines, windings and the flange scale are simplified.',
    camera: { position: [4.5, 3.1, 5.4], target: [0, 0.25, 0.2] },
    radius: 2.6,
    views: { front: [0, 0, 6.9], side: [7.3, 0.4, 0.2], top: [0, 7.3, 0.4], iso: [4.5, 3.1, 5.4] },
    limitations: [
      'The pole polarities and the energised phase are conceptual; they follow the tested full-step table, not a field simulation.',
      `The animation steps at ${SHOWN_RATE} full steps per second whatever step rate is set in Calculate, so that each 1.8° step can be seen (zoom in on the pointer and the scale).`,
      'Each step is drawn as a quick move and a hold; real steps overshoot and ring a little.',
      'Calculations assume no lost steps; the holding torque is a datasheet input.',
    ],
  },
  parts: STEPPER_PARTS,
  layers: STEPPER_LAYERS,
  steps: STEPPER_STEPS,
  params: STEPPER_PARAMS,
  calc: stepperCalc,
  motion: (calc) => {
    const n = calc.speed ?? 0
    return { omega: SHOWN_RATE * ((1.8 * Math.PI) / 180), note: `The model steps ${SHOWN_RATE} full steps per second (slowed down, to see each step). At the step rate set, the motor would turn at ${n.toFixed(0)} rpm.` }
  },
  content: STEPPER_CONTENT,
  quiz: STEPPER_QUIZ,
  Model: StepperModel,
}
export default def
