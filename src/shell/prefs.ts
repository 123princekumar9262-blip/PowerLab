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

// ── First visit of a lab: the essentials ────────────────────────────────────
/**
 * A lab opened for the first time shows its essentials only (two readings, the main waveforms); everything
 * else is one click away ("Show everything"). The setting lives in Help & settings; the labs already seen
 * are remembered in this browser.
 */
const ESSENTIALS_KEY = 'pel.essentials'
const SEEN_KEY = 'pel.labs-seen'
/** A stored value as it is (loadJSON merges objects into its fallback: not for a string or a list). */
function readRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}
const seenLabs = (): string[] => {
  const v = readRaw(SEEN_KEY)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function essentialsEnabled(): boolean {
  return readRaw(ESSENTIALS_KEY) !== 'off'
}
export function setEssentialsEnabled(on: boolean): void {
  saveJSON(ESSENTIALS_KEY, on ? 'on' : 'off')
}
/** Is this the first visit of the lab, and are essentials wanted? (read only: render-safe) */
export function isFirstVisit(lab: string): boolean {
  return essentialsEnabled() && !seenLabs().includes(lab)
}
/** Remember the lab as seen (its next visit shows the full workspace). */
export function markSeen(lab: string): void {
  const list = seenLabs()
  if (!list.includes(lab)) saveJSON(SEEN_KEY, [...list, lab])
}
