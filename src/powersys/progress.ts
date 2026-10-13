import { useSyncExternalStore } from 'react'
import { loadJSON, saveJSON } from '../utils/storage.ts'
import { PS_MODULES } from './catalog.ts'
import type { PsMode } from './types.ts'

/**
 * Power Systems progress — kept in this browser only (key `pel.powersys`, cleared by "Reset progress" with the rest).
 * Records the modules opened, the last place visited and the activities completed ("module/activity").
 */
export interface PsProgress {
  visited: string[]
  done: string[]
  last: { module: string; mode: PsMode; at: number } | null
}

export const PS_PROGRESS_KEY = 'pel.powersys'
const EMPTY: PsProgress = { visited: [], done: [], last: null }

let current: PsProgress = read()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function read(): PsProgress {
  const p = loadJSON<PsProgress>(PS_PROGRESS_KEY, EMPTY)
  return {
    visited: Array.isArray(p.visited) ? p.visited : [],
    done: Array.isArray(p.done) ? p.done : [],
    last: p.last ?? null,
  }
}
function write(next: PsProgress) {
  current = next
  saveJSON(PS_PROGRESS_KEY, current)
  emit()
}

/** The student opened a module in a mode. */
export function visitModule(module: string, mode: PsMode): void {
  const visited = current.visited.includes(module) ? current.visited : [...current.visited, module]
  if (current.last?.module === module && current.last.mode === mode && visited === current.visited) return
  write({ ...current, visited, last: { module, mode, at: Date.now() } })
}

/** An activity was completed (idempotent). */
export function completeActivity(module: string, activity: string): void {
  const id = `${module}/${activity}`
  if (current.done.includes(id)) return
  write({ ...current, done: [...current.done, id] })
}

export const isDone = (p: PsProgress, module: string, activity: string) => p.done.includes(`${module}/${activity}`)

/** Activities completed in a module, of its activities. */
export function moduleProgress(p: PsProgress, module: string): { done: number; total: number } {
  const m = PS_MODULES.find((x) => x.id === module)
  const total = m?.activities.length ?? 0
  return {
    done: m ? m.activities.filter((a) => isDone(p, module, a.id)).length : 0,
    total,
  }
}

/** Forget everything (called by the platform's Reset progress). */
export function clearPsProgress(): void {
  write(EMPTY)
}

/** Re-read storage (tests, other tabs). */
export function reloadPsProgress(): void {
  current = read()
  emit()
}

export function usePsProgress(): PsProgress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current,
  )
}
