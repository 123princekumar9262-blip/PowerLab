import type { ModuleComponent, ModuleId } from '../types.ts'

/** Each module's page loads only when it is opened. */
export const MODULE_LOADERS: Record<ModuleId, () => Promise<{ default: ModuleComponent }>> = {
  grid: () => import('./grid/index.tsx'),
  'three-phase': () => import('./three-phase/index.tsx'),
  'per-unit': () => import('./per-unit/index.tsx'),
  faults: () => import('./faults/index.tsx'),
  'load-flow': () => import('./load-flow/index.tsx'),
  stability: () => import('./stability/index.tsx'),
  challenge: () => import('./challenge/index.tsx'),
}
