import { meta as cables } from './modules/cables/meta.ts'
import { meta as challenge } from './modules/challenge/meta.ts'
import { meta as distribution } from './modules/distribution/meta.ts'
import { meta as economic } from './modules/economic/meta.ts'
import { meta as faults } from './modules/faults/meta.ts'
import { meta as genControl } from './modules/gen-control/meta.ts'
import { meta as generation } from './modules/generation/meta.ts'
import { meta as grid } from './modules/grid/meta.ts'
import { meta as hvdcFacts } from './modules/hvdc-facts/meta.ts'
import { meta as lineParams } from './modules/line-params/meta.ts'
import { meta as loadFlow } from './modules/load-flow/meta.ts'
import { meta as mechanical } from './modules/mechanical/meta.ts'
import { meta as perUnit } from './modules/per-unit/meta.ts'
import { meta as protection } from './modules/protection/meta.ts'
import { meta as stability } from './modules/stability/meta.ts'
import { meta as threePhase } from './modules/three-phase/meta.ts'
import { meta as transients } from './modules/transients/meta.ts'
import type { ModuleId, PsModuleMeta } from './types.ts'

/**
 * The Power Systems modules in the order they are offered (each module's own meta.ts is the source). Modules keep
 * their numbers; the Engineer's Challenge (Module 7) is listed last because it draws on all the others.
 */
export const PS_MODULES: PsModuleMeta[] = [
  grid,
  threePhase,
  perUnit,
  faults,
  loadFlow,
  stability,
  lineParams,
  mechanical,
  cables,
  economic,
  genControl,
  protection,
  hvdcFacts,
  transients,
  distribution,
  generation,
  challenge,
]

export const psModule = (id: string): PsModuleMeta | undefined => PS_MODULES.find((m) => m.id === id)
export const PS_GROUPS = [...new Set(PS_MODULES.map((m) => m.group))]
export const isModuleId = (id: string): id is ModuleId => PS_MODULES.some((m) => m.id === id)
