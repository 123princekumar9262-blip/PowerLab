import { meta as challenge } from './modules/challenge/meta.ts'
import { meta as faults } from './modules/faults/meta.ts'
import { meta as grid } from './modules/grid/meta.ts'
import { meta as loadFlow } from './modules/load-flow/meta.ts'
import { meta as perUnit } from './modules/per-unit/meta.ts'
import { meta as stability } from './modules/stability/meta.ts'
import { meta as threePhase } from './modules/three-phase/meta.ts'
import type { ModuleId, PsModuleMeta } from './types.ts'

/** The Power Systems modules in their recommended order (each module's own meta.ts is the source). */
export const PS_MODULES: PsModuleMeta[] = [grid, threePhase, perUnit, faults, loadFlow, stability, challenge]

export const psModule = (id: string): PsModuleMeta | undefined => PS_MODULES.find((m) => m.id === id)
export const PS_GROUPS = [...new Set(PS_MODULES.map((m) => m.group))]
export const isModuleId = (id: string): id is ModuleId => PS_MODULES.some((m) => m.id === id)
