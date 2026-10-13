import type { MachineDef } from '../../types.ts'
import { DC_ASSEMBLIES, DC_CONTENT, DC_DISASSEMBLY, DC_LAYERS, DC_PARAMS, DC_PARTS, DC_QUIZ, DC_STEPS, dcCalc } from './content.ts'
import { DcMotorModel } from './Model.tsx'

const def: MachineDef = {
  id: 'dc-motor',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified educational model: two-pole permanent-magnet motor, 8-slot armature with full-pitch coils, 8-segment commutator, two brushes. 15 separately selectable parts in 4 assemblies. Proportions are illustrative, not a specific product.',
    camera: { position: [5.0, 3.1, 6.2], target: [0, 0.2, 0.2] },
    radius: 3,
    views: { front: [0, 0, 6.8], side: [7.4, 0.5, 0.2], top: [0, 7.4, 0.4], iso: [5.0, 3.1, 6.2] },
    limitations: [
      'Field lines, current markers and force arrows are conceptual illustrations of directions, not a field simulation.',
      'The rotation speed of the animation is slowed down; it follows the calculated speed only in proportion.',
      'Real motors use more slots and segments, interpoles or skew; brush springs, the brush-holder mounting, wiring and fasteners are not modelled.',
      'The rotor (shaft, core, winding, commutator) is shown as separate parts to select, but it does not come apart: it is not dismantled in normal service.',
      'Calculations are the ideal steady-state model (no brush drop, friction or iron loss).',
    ],
  },
  parts: DC_PARTS,
  assemblies: DC_ASSEMBLIES,
  disassembly: DC_DISASSEMBLY,
  disassemblyGrouping: 'attached',
  layers: DC_LAYERS,
  steps: DC_STEPS,
  params: DC_PARAMS,
  calc: dcCalc,
  motion: (calc) => {
    const n = calc.n ?? 0
    // clockwise seen from the front (negative about +z); one turn per second at 3000 rpm (slowed ×50)
    return { omega: -((n / 60) * 2 * Math.PI) / 50, note: n > 0 ? 'The armature turns at the calculated speed, slowed down ×50.' : 'Stalled: the calculated speed is zero.' }
  },
  content: DC_CONTENT,
  quiz: DC_QUIZ,
  Model: DcMotorModel,
}
export default def
