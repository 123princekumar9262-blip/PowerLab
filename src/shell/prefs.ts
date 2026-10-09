import { useSyncExternalStore } from 'react'
import { loadJSON, saveJSON } from '../utils/storage.ts'

/**
 * Preferences that apply across the whole platform. Stored in localStorage (guarded: the app works
 * without storage). The information level replaces the two separate density settings the rectifier
 * lab and the other labs used to keep; the rectifier lab's saved value is migrated once.
 */
export type Level = 'beginner' | 'standard' | 'engineer'
export const LEVELS: Array<{ id: Level; label: string; detail: string }> = [
  { id: 'beginner', label: 'Beginner', detail: 'The circuit, the essential waveforms, the current state, WHY and the current path.' },
  { id: 'standard', label: 'Standard', detail: 'Adds values on the circuit, device states, energy, more channels and measurements.' },
  { id: 'engineer', label: 'Engineer', detail: 'Adds every quantity, advanced parameters, device stress, theory and numerical details.' },
]

const KEY = 'pel.prefs'
/** The rectifier lab's own key (still read by it; kept in step with the global level). */
export const RECTIFIER_DENSITY_KEY = 'rectifier-lab.density'

interface Prefs {
  level: Level
}

const isLevel = (x: unknown): x is Level => x === 'beginner' || x === 'standard' || x === 'engineer'

function read(): Prefs {
  const stored = loadJSON<Partial<Prefs>>(KEY, {})
  if (isLevel(stored.level)) return { level: stored.level }
  // migration: the rectifier lab's saved density wins on first use
  const old = loadJSON<{ d?: unknown }>(RECTIFIER_DENSITY_KEY, {}).d
  return { level: isLevel(old) ? old : 'beginner' }
}

let current: Prefs = read()
const listeners = new Set<() => void>()

export function getLevel(): Level {
  return current.level
}

export function setLevel(level: Level): void {
  if (level === current.level) return
  current = { ...current, level }
  saveJSON(KEY, current)
  saveJSON(RECTIFIER_DENSITY_KEY, { d: level })
  listeners.forEach((l) => l())
}

export function useLevel(): Level {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current.level,
  )
}

/** For tests: re-read storage. */
export function reloadPrefs(): void {
  current = read()
  listeners.forEach((l) => l())
}
