import type { ComponentType } from 'react'

/**
 * The Power Systems subject: seven connected modules. Each module lives in its own folder
 * (src/powersys/modules/<id>/) with a `meta.ts` (what it is, its modes and activities, whether it is built) and an
 * `index.tsx` (its page content). The catalogue (catalog.ts) and the subject registry read only the metas.
 */
export type ModuleId =
  | 'grid'
  | 'three-phase'
  | 'per-unit'
  | 'faults'
  | 'load-flow'
  | 'stability'
  | 'challenge'
  | 'line-params'
  | 'mechanical'
  | 'cables'
  | 'economic'
  | 'gen-control'
  | 'protection'
  | 'hvdc-facts'
  | 'transients'
  | 'distribution'
  | 'generation'

/** How a module is used. Learn: guided explanation · Explore: free interaction · Experiment: change one thing,
 * predict, compare · Verify: the calculation behind a result, checked independently · Practise: questions. */
export type PsMode = 'learn' | 'explore' | 'experiment' | 'verify' | 'practise'

export const PS_MODE_LABEL: Record<PsMode, string> = {
  learn: 'Learn',
  explore: 'Explore',
  experiment: 'Experiment',
  verify: 'Verify',
  practise: 'Practise',
}
export const PS_MODE_ORDER: PsMode[] = ['learn', 'explore', 'experiment', 'verify', 'practise']

/** Something a student can complete in a module (stored as progress when completed). */
export interface PsActivity {
  id: string
  title: string
  mode: PsMode
}

export interface PsModuleMeta {
  id: ModuleId
  /** Module number (1–7) in the recommended order. */
  n: number
  title: string
  /** A short name for navigation (the sidebar, topic lists). */
  short: string
  /** One line: what the module is about. */
  line: string
  /** Group heading on the subject page. */
  group: string
  /** 'ready' only when its page, calculations and tests are built; 'planned' modules say so and open nothing. */
  status: 'ready' | 'planned'
  /** What a student learns, in a few plain phrases. */
  learn: string[]
  modes: PsMode[]
  activities: PsActivity[]
  /** Search words. */
  keywords: string[]
}

/** What a module's page component receives. */
export interface ModuleProps {
  mode: PsMode
  /** Switch to another mode of the same module (e.g. "Try it" → Experiment). */
  setMode(m: PsMode): void
}
export type ModuleComponent = ComponentType<ModuleProps>
