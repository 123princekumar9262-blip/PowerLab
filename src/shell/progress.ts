import { useSyncExternalStore } from 'react'
import { labsByPath, type Lab, type ModeId } from '../catalogue/catalogue.ts'
import { loadJSON, saveJSON } from '../utils/storage.ts'

/**
 * Where the student has been — the simplest persistence that works: localStorage on this device, no
 * account. Drives "Continue learning", "Recent" and the recommended learning path. Guarded: with
 * storage blocked the app simply forgets.
 */
export interface Activity {
  lab: string
  topic: string
  mode: ModeId
  /** Starting-point query of the workspace (e.g. the rectifier load). */
  query?: Record<string, string>
  title: string
  labTitle: string
  lesson?: { id: string; title: string; step: number; of: number }
  at: number
}

interface ProgressData {
  last: Activity | null
  recent: Activity[]
  /** Lessons finished in the labs other than Rectifiers ("lab/topic/lesson"). */
  lessonsDone: string[]
  /** Labs opened at least once. */
  visited: string[]
}

const KEY = 'pel.progress'
/** The rectifier lab records its finished lessons itself. */
export const RECTIFIER_LESSONS_KEY = 'rectifier-lab.lessons'

const EMPTY: ProgressData = { last: null, recent: [], lessonsDone: [], visited: [] }
let current: ProgressData = loadJSON<ProgressData>(KEY, EMPTY)
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const sameWorkspace = (a: Activity, b: Activity) => a.lab === b.lab && a.topic === b.topic

/** Record what the student is doing now (called by the workspace as it changes). */
export function recordActivity(a: Omit<Activity, 'at'>): void {
  const act: Activity = { ...a, at: Date.now() }
  const prev = current.last
  if (prev && sameWorkspace(prev, act) && prev.mode === act.mode && JSON.stringify(prev.lesson) === JSON.stringify(act.lesson) && JSON.stringify(prev.query ?? {}) === JSON.stringify(act.query ?? {})) return
  let lessonsDone = current.lessonsDone
  if (act.lab !== 'rectifiers' && act.lesson && act.lesson.step >= act.lesson.of - 1) {
    const id = `${act.lab}/${act.topic}/${act.lesson.id}`
    if (!lessonsDone.includes(id)) lessonsDone = [...lessonsDone, id]
  }
  current = {
    last: act,
    recent: [act, ...current.recent.filter((r) => !sameWorkspace(r, act))].slice(0, 6),
    lessonsDone,
    visited: current.visited.includes(act.lab) ? current.visited : [...current.visited, act.lab],
  }
  saveJSON(KEY, current)
  emit()
}

export function clearProgress(): void {
  current = EMPTY
  saveJSON(KEY, current)
  saveJSON(RECTIFIER_LESSONS_KEY, { done: [] })
  emit()
}

export function useProgress(): ProgressData {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/** Finished lessons in a lab. */
export function lessonsDoneIn(lab: Lab, data: ProgressData = current): number {
  if (lab.id === 'rectifiers') return new Set(loadJSON<{ done: string[] }>(RECTIFIER_LESSONS_KEY, { done: [] }).done).size
  return data.lessonsDone.filter((id) => id.startsWith(`${lab.id}/`)).length
}

export type PathState = 'done' | 'recommended' | 'started' | 'open'

/**
 * The recommended learning path — a suggestion, never a gate: every ready lab can be opened at any
 * time. A lab is done when all its lessons are finished; the recommendation is the first ready lab on
 * the path that is not done.
 */
export function learningPath(data: ProgressData = current): Array<{ lab: Lab; state: PathState; done: number }> {
  const labs = labsByPath()
  const rows = labs.map((lab) => {
    const done = lessonsDoneIn(lab, data)
    return { lab, done, finished: lab.lessons > 0 && done >= lab.lessons }
  })
  const next = rows.find((r) => !r.finished && r.lab.status === 'ready')
  return rows.map((r) => ({
    lab: r.lab,
    done: r.done,
    state: r.finished ? 'done' : r === next ? 'recommended' : data.visited.includes(r.lab.id) ? 'started' : 'open',
  }))
}

/** For tests: re-read storage. */
export function reloadProgress(): void {
  current = loadJSON<ProgressData>(KEY, EMPTY)
  emit()
}
