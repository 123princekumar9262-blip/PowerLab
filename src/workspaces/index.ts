import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { WorkspaceProps } from './types.ts'

/**
 * One lazily loaded workspace per lab, every one in the universal workspace shell: Home and the landing
 * pages load no simulation engine; a lab's engine arrives when its workspace is opened.
 */
export const LOADERS: Record<string, () => Promise<{ default: ComponentType<WorkspaceProps> }>> = {
  rectifiers: () => import('./rectifiers.tsx'),
  'dc-dc': () => import('./dcdc.tsx'),
  pwm: () => import('./pwm.tsx'),
  inverters: () => import('./inverters.tsx'),
  devices: () => import('./devices.tsx'),
  magnetics: () => import('./magnetics.tsx'),
  control: () => import('./control.tsx'),
  drives: () => import('./drives.tsx'),
  thermal: () => import('./thermal.tsx'),
  ev: () => import('./ev.tsx'),
}

const cache = new Map<string, LazyExoticComponent<ComponentType<WorkspaceProps>>>()
export function workspaceFor(lab: string): LazyExoticComponent<ComponentType<WorkspaceProps>> | null {
  const load = LOADERS[lab]
  if (!load) return null
  let c = cache.get(lab)
  if (!c) {
    c = lazy(load)
    cache.set(lab, c)
  }
  return c
}
