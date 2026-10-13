import { LABS } from '../catalogue/catalogue.ts'
import { loadJSON } from '../utils/storage.ts'
import { lessonsDoneIn, type useProgress } from './progress.ts'

/** Rectifier Challenge tasks (tests/shell.test.ts checks this against the real list). */
export const CHALLENGE_COUNT = 9

export interface Stat {
  done: number
  total: number
}
export interface LearningStats {
  lessons: Stat
  labs: Stat
  challenges: Stat
  /** Best score of the Rectifier sketch prediction (0–100), null before the first one. */
  sketch: number | null
}

/**
 * The summary numbers of Home and Progress — every one read from what this browser has stored; nothing
 * estimated (no time spent, no averages the app does not record).
 */
export function learningStats(progress: ReturnType<typeof useProgress>): LearningStats {
  const lessons = LABS.reduce((s, l) => ({ done: s.done + Math.min(lessonsDoneIn(l, progress), l.lessons), total: s.total + l.lessons }), { done: 0, total: 0 })
  const stars = loadJSON<Record<string, number>>('rectifier-lab.challenges', {})
  const sketch = loadJSON<{ best: number | null }>('rectifier-lab.predict', { best: null }).best
  return {
    lessons,
    labs: { done: LABS.filter((l) => progress.visited.includes(l.id)).length, total: LABS.length },
    challenges: { done: Math.min(Object.values(stars).filter((v) => v > 0).length, CHALLENGE_COUNT), total: CHALLENGE_COUNT },
    sketch: typeof sketch === 'number' ? Math.round(sketch) : null,
  }
}

/**
 * A practice activity's result from storage: Challenge from the rectifier stars, the activities with their
 * own page from `pel.practice.<id>` ({ solved: ids, total }). Null when the activity records none.
 */
export function practiceStat(id: string): Stat | null {
  if (id === 'challenge') {
    const stars = loadJSON<Record<string, number>>('rectifier-lab.challenges', {})
    return { done: Math.min(Object.values(stars).filter((v) => v > 0).length, CHALLENGE_COUNT), total: CHALLENGE_COUNT }
  }
  const s = loadJSON<{ solved?: unknown; total?: unknown }>(`pel.practice.${id}`, {})
  if (!Array.isArray(s.solved) || typeof s.total !== 'number' || s.total <= 0) return null
  return { done: Math.min(new Set(s.solved).size, s.total), total: s.total }
}
