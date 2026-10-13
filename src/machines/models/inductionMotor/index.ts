import type { MachineDef } from '../../types.ts'
import { imCalc, imMotion, IM_ASSEMBLIES, IM_CONTENT, IM_DISASSEMBLY, IM_LAYERS, IM_PARAMS, IM_PARTS, IM_QUIZ, IM_STEPS } from './content.ts'
import { InductionMotorModel } from './Model.tsx'

const def: MachineDef = {
  id: 'induction-motor',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified:
      'Simplified educational model: 36-slot stator with a single-layer concentric three-phase winding re-laid for 2, 4 or 6 poles, 28 skewed aluminium cage bars, cast finned frame, fan and cowl. The air gap is drawn about 10× too wide; slot shapes, end-winding shape and proportions are illustrative, not a specific product.',
    camera: { position: [4.9, 3.1, 6.5], target: [-0.6, 0.1, 0.1] },
    radius: 3.2,
    views: { front: [0, 0.3, 7.6], side: [8.0, 0.6, 0.1], top: [0, 8.0, 0.5], iso: [4.9, 3.1, 6.5] },
    limitations: [
      'Field arrows, flux lines, current cones and force arrows are conceptual illustrations of directions and sequence — not a field simulation.',
      'Field and rotor turn at the calculated synchronous and rotor speeds, slowed down ×50; in the starting steps the rotor is held at rest (s = 1).',
      'Calculations use the steady-state per-phase equivalent circuit of one example machine (linear iron, no core or friction loss).',
      'Real windings are usually double-layer with short-pitched coils; slot insulation, wedges and the cast rotor’s fan blades are not drawn.',
      'Bolts, the bearing caps, grease seals and the winding leads inside the frame are not modelled; the rotor core, bars and end rings are selectable separately but are cast together and do not come apart.',
    ],
  },
  parts: IM_PARTS,
  assemblies: IM_ASSEMBLIES,
  disassembly: IM_DISASSEMBLY,
  disassemblyGrouping: 'attached',
  layers: IM_LAYERS,
  steps: IM_STEPS,
  params: IM_PARAMS,
  calc: (p) => imCalc(p),
  motion: imMotion,
  content: IM_CONTENT,
  quiz: IM_QUIZ,
  Model: InductionMotorModel,
}
export default def
