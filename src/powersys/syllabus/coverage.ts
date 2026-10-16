import { useSyncExternalStore } from 'react'
import { PS_MODULES } from '../catalog.ts'
import { VIT_COURSE_TITLES, VIT_STUDENT_COURSES } from './sources.ts'
import { TOPICS } from './topics.ts'
import type { Coverage, PlannedIn, Ref, SyllabusId, SyllabusTopic } from './types.ts'

/** A topic's status for this student: a VIT topic named only in an elective they do not take is supplementary. */
export function statusFor(t: SyllabusTopic, s: SyllabusId): { status: Coverage; ref: Ref; elective?: string } {
  if (s === 'gate-ee') return { status: t.gate.status, ref: t.gate }
  const r = t.vit
  if ((r.status === 'verified' || r.status === 'partial') && r.where && !VIT_STUDENT_COURSES.includes(r.where))
    return { status: 'supplementary', ref: r, elective: VIT_COURSE_TITLES[r.where] ?? r.where }
  return { status: r.status, ref: r }
}

/** Is the topic part of the syllabus (verified or partial) for this path? Combined = either. */
export function inPath(t: SyllabusTopic, path: LearningPath): boolean {
  const named = (s: SyllabusId) => ['verified', 'partial'].includes(statusFor(t, s).status)
  return path === 'combined' ? named('gate-ee') || named('vit-eee') : named(path)
}

/** Is the topic taught by a module that is built? */
export const isTaught = (t: SyllabusTopic): boolean => !!t.module && PS_MODULES.find((m) => m.id === t.module)?.status === 'ready' && !t.plannedIn

/** The topics of a path in learning order (module order, then as listed). */
export function pathTopics(path: LearningPath): SyllabusTopic[] {
  const order = new Map(PS_MODULES.map((m, i) => [m.id, i]))
  return TOPICS.filter((t) => inPath(t, path)).sort((a, b) => (a.module ? (order.get(a.module) ?? 99) : 100) - (b.module ? (order.get(b.module) ?? 99) : 100))
}

/** Counts for a path: topics named, taught now, and planned. */
export function pathSummary(path: LearningPath) {
  const ts = pathTopics(path)
  return { named: ts.length, taught: ts.filter(isTaught).length, planned: ts.filter((t) => !isTaught(t)).length }
}

/** The phase each not-yet-built module belongs to (the agreed expansion plan). */
export const MODULE_PHASE: Partial<Record<string, PlannedIn>> = {
  'line-params': 'phase-a',
  economic: 'phase-a',
  'gen-control': 'phase-a',
  mechanical: 'phase-b',
  protection: 'phase-b',
  cables: 'phase-c',
  transients: 'phase-c',
  'hvdc-facts': 'phase-d',
  distribution: 'phase-b',
  generation: 'follow-up',
}
/** When a topic not taught yet is planned: its own plan, else its module's phase. */
export const plannedPhase = (t: SyllabusTopic): PlannedIn | undefined => t.plannedIn ?? (t.module ? MODULE_PHASE[t.module] : undefined)

/** Prerequisite topics that are not taught by a built module (gaps on the way to a topic). */
export const prerequisiteGaps = (t: SyllabusTopic): SyllabusTopic[] => t.prerequisites.map((id) => TOPICS.find((x) => x.id === id)!).filter((p) => p && !isTaught(p))

// ── the student's chosen learning path (a preference, not progress: kept when progress is reset) ────────────────
export type LearningPath = SyllabusId | 'combined'
export const PATH_KEY = 'pel.powersys.path'
const PATHS: LearningPath[] = ['gate-ee', 'vit-eee', 'combined']
const read = (): LearningPath => {
  try {
    const v = localStorage.getItem(PATH_KEY)
    return v && (PATHS as string[]).includes(v) ? (v as LearningPath) : 'combined'
  } catch {
    return 'combined'
  }
}
let current: LearningPath = typeof localStorage === 'undefined' ? 'combined' : read()
const listeners = new Set<() => void>()
export function setLearningPath(p: LearningPath): void {
  current = p
  try {
    localStorage.setItem(PATH_KEY, p)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  listeners.forEach((l) => l())
}
export function useLearningPath(): LearningPath {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current,
  )
}
export const PATH_LABEL: Record<LearningPath, string> = { 'gate-ee': 'GATE EE', 'vit-eee': 'VIT Vellore', combined: 'Combined' }
