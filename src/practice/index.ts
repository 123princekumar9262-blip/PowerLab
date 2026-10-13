import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * Practice activities with their own page (route #/engineering/:area): Fault diagnosis, Design, Interview.
 * Each is loaded lazily, so the Practice overview loads no simulation engine. An area listed here must be
 * `ready` in the catalogue; one that is not listed opens a workspace (`opens`) or is coming soon.
 */
export const PRACTICE_LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
  fault: () => import('./FaultDiagnosis.tsx'),
  design: () => import('./Design.tsx'),
  interview: () => import('./Interview.tsx'),
}

const cache = new Map<string, LazyExoticComponent<ComponentType>>()
export function practicePage(area: string): LazyExoticComponent<ComponentType> | null {
  const load = PRACTICE_LOADERS[area]
  if (!load) return null
  let c = cache.get(area)
  if (!c) {
    c = lazy(load)
    cache.set(area, c)
  }
  return c
}
