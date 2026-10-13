import { loadJSON, saveJSON } from '../utils/storage.ts'

/**
 * Shared helpers of the Practice activities: a seedable random generator (every random case set can be
 * replayed from its number) and the progress record each activity keeps in localStorage.
 */

/** mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Same seed → same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const pick = <T,>(xs: readonly T[], rand: () => number): T => xs[Math.floor(rand() * xs.length) % xs.length]

/** A fresh, human-sized set number (1000 … 9999). */
export const newSeed = () => 1000 + Math.floor(Math.random() * 9000)

/**
 * Progress of one Practice activity, stored under `pel.practice.<id>`. Contract (read by the Practice overview
 * and the Progress page): `solved` = ids of the distinct cases / specs / questions answered right at least once,
 * `total` = how many exist. Other fields are the activity's own.
 */
export interface PracticeProgress {
  solved: string[]
  total: number
  /** Best round score (activities with rounds). */
  best?: { score: number; of: number }
  /** Rounds / attempts completed. */
  rounds?: number
  /** Per item: the best verdict reached (design: pass / warning / fail). */
  verdicts?: Record<string, string>
}

export const progressKey = (id: string) => `pel.practice.${id}`

export function loadProgress(id: string, total: number): PracticeProgress {
  const p = loadJSON<PracticeProgress>(progressKey(id), { solved: [], total })
  return { ...p, solved: Array.isArray(p.solved) ? p.solved.filter((x) => typeof x === 'string') : [], total }
}

/** Update the stored progress (always rewrites `total`, keeps `solved` distinct). */
export function updateProgress(id: string, total: number, f: (p: PracticeProgress) => PracticeProgress): PracticeProgress {
  const next = f(loadProgress(id, total))
  const out = { ...next, solved: [...new Set(next.solved)], total }
  saveJSON(progressKey(id), out)
  return out
}

export const markSolved = (id: string, total: number, item: string) => updateProgress(id, total, (p) => ({ ...p, solved: [...p.solved, item] }))
