import type { MachineDef } from '../../../types.ts'
import { SERVO_CONTENT, SERVO_LAYERS, SERVO_PARAMS, SERVO_PARTS, SERVO_QUIZ, SERVO_STEPS, servoCalc } from './content.ts'
import { ServoModel } from './Model.tsx'

const def: MachineDef = {
  id: 'servo',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified educational model: a PM synchronous servo motor (12-slot stator, 8-pole surface-magnet rotor) with an incremental optical encoder, a load arm, and a servo drive with its controller board and power stage, joined by a power and a feedback cable. Bearings, brake and many details are left out.',
    camera: { position: [4.6, 3.3, 6.4], target: [0.5, 0.15, 0] },
    radius: 3.2,
    views: { front: [0.5, 0.1, 8.0], side: [8.6, 0.4, 0], top: [0.5, 8.6, 0.4], iso: [4.6, 3.3, 6.4] },
    limitations: [
      'The arm motion is an illustration of a proportional position loop (exponential approach to each new command), not a simulation of a tuned servo drive.',
      'The signal and power paths are conceptual; the command, encoder and error values shown are those of the drawn arm.',
      'Real servo axes add speed and acceleration limits, feed-forward and filters; the motor would also have bearings and often a holding brake.',
      'Calculations assume an ideal inner speed loop (first-order position response).',
    ],
  },
  parts: SERVO_PARTS,
  layers: SERVO_LAYERS,
  steps: SERVO_STEPS,
  params: SERVO_PARAMS,
  calc: servoCalc,
  motion: (calc) => ({
    omega: 1,
    note: `The arm moves to a new commanded angle every 3.5 s with a 0.35 s time constant (an illustration, slowed down; with the gain set here the time constant would be ${((calc.tau ?? 0) * 1000).toFixed(0)} ms).`,
  }),
  content: SERVO_CONTENT,
  quiz: SERVO_QUIZ,
  Model: ServoModel,
}
export default def
