import type { MachineDef } from '../../../types.ts'
import { BLDC_CONTENT, BLDC_LAYERS, BLDC_PARAMS, BLDC_PARTS, BLDC_QUIZ, BLDC_STEPS, bldcCalc } from './content.ts'
import { BldcModel } from './Model.tsx'

const SLOW = 600
const def: MachineDef = {
  id: 'bldc',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified educational model: inner-rotor BLDC with 6 stator teeth (concentrated coils, phases A B C A B C), 4 surface magnets, three Hall sensors on a rear PCB. The inverter and controller are not drawn. Proportions are illustrative, not a specific product.',
    camera: { position: [4.9, 3.0, 6.0], target: [0, 0, 0.2] },
    radius: 2.9,
    views: { front: [0, 0, 7.6], side: [8.2, 0.4, 0.2], top: [0, 8.2, 0.4], iso: [4.9, 3.0, 6.0] },
    limitations: [
      'Poles, markers and arrows are conceptual illustrations of directions and of the switching sequence, not a field simulation.',
      'The switched pair shown is computed from the drawn rotor angle with the ideal six-step table; real controllers add commutation delays and PWM.',
      'The rotation of the animation is slowed down a great deal so that each of the 12 commutation steps per turn can be followed.',
      'Calculations are the ideal steady-state six-step model (no inductance, switch drops, iron loss or friction).',
    ],
  },
  parts: BLDC_PARTS,
  layers: BLDC_LAYERS,
  steps: BLDC_STEPS,
  params: BLDC_PARAMS,
  calc: bldcCalc,
  motion: (calc) => {
    const n = calc.n ?? 0
    // counter-clockwise seen from the front (positive about +z); slowed so a commutation step lasts ~0.5 s at the default speed
    return { omega: (n / 60) * 2 * Math.PI / SLOW, note: n > 0 ? `The rotor turns at the calculated speed slowed down ×${SLOW} (${(n / SLOW).toFixed(1)} rpm on screen), so each 30° mechanical commutation step can be followed.` : 'Stalled: the calculated speed is zero.' }
  },
  content: BLDC_CONTENT,
  quiz: BLDC_QUIZ,
  Model: BldcModel,
}
export default def
