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
  'line-params': () => import('./line-params/index.tsx'),
  mechanical: () => import('./mechanical/index.tsx'),
  cables: () => import('./cables/index.tsx'),
  economic: () => import('./economic/index.tsx'),
  'gen-control': () => import('./gen-control/index.tsx'),
  protection: () => import('./protection/index.tsx'),
  'hvdc-facts': () => import('./hvdc-facts/index.tsx'),
  transients: () => import('./transients/index.tsx'),
  distribution: () => import('./distribution/index.tsx'),
  generation: () => import('./generation/index.tsx'),
}
