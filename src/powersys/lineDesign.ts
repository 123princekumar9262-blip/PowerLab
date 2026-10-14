import { useSyncExternalStore } from 'react'
import type { LineConstants } from './modules/three-phase/calc.ts'

/**
 * The hand-off from Module 8 (line parameters) to Module 2 (line performance): the line constants Module 8 has
 * calculated from conductor geometry, which Module 2 may use INSTEAD of its preset when the student opts in.
 * Module 2's preset stays its default; nothing here changes it. Kept in this browser (key `pel.powersys.line`) as a
 * design the student made, not progress, so Reset progress leaves it.
 */
export interface DesignedLine extends LineConstants {
  /** Nominal line-to-line voltage of the design [kV]. */
  kv: number
  /** Frequency the reactance and susceptance were computed at [Hz]. */
  fHz: number
  /** A short description of the geometry ("horizontal, 7.5 m spacing, twin bundle 0.4 m"). */
  summary: string
  /** When it was sent [ms since epoch]. */
  at: number
}

export const LINE_KEY = 'pel.powersys.line'

const valid = (d: unknown): d is DesignedLine => {
  const x = d as DesignedLine
  return (
    !!x &&
    [x.rOhmPerKm, x.xOhmPerKm, x.bUsPerKm, x.kv, x.fHz, x.at].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    x.rOhmPerKm >= 0 &&
    x.xOhmPerKm > 0 &&
    x.bUsPerKm > 0 &&
    x.kv > 0 &&
    typeof x.summary === 'string'
  )
}
function read(): DesignedLine | null {
  try {
    const raw = localStorage.getItem(LINE_KEY)
    const d = raw ? JSON.parse(raw) : null
    return valid(d) ? d : null
  } catch {
    return null
  }
}
let current: DesignedLine | null = typeof localStorage === 'undefined' ? null : read()
const listeners = new Set<() => void>()

/** Module 8: offer these constants to Module 2 (null withdraws them). Invalid constants are refused. */
export function setDesignedLine(d: DesignedLine | null): boolean {
  if (d && !valid(d)) return false
  current = d
  try {
    if (d) localStorage.setItem(LINE_KEY, JSON.stringify(d))
    else localStorage.removeItem(LINE_KEY)
  } catch {
    /* storage blocked: kept for this visit */
  }
  listeners.forEach((l) => l())
  return true
}
export const getDesignedLine = (): DesignedLine | null => current
export function useDesignedLine(): DesignedLine | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current,
  )
}
