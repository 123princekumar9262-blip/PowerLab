import type { SimulationResult } from '../types/simulation.ts'
import type { CursorTarget } from './lessons.ts'

/**
 * Resolve a lesson/challenge cursor target to a time, using the simulation itself.
 * Targets refer to the LAST cycle, which is in steady state for every lesson's settings.
 */
export function resolveTarget(result: SimulationResult, target: CursorTarget): number {
  const { period: T, duration, phase } = result.params
  if ('angleDeg' in target) {
    const phiDeg = (phase * 180) / Math.PI
    const frac = ((((target.angleDeg - phiDeg) / 360) % 1) + 1) % 1
    return Math.min(duration, duration - T + frac * T)
  }
  const matches = result.events.filter((e) => e.kind === target.event && (!target.device || e.device === target.device))
  const inLast = matches.find((e) => e.time >= duration - T - 1e-12)
  return (inLast ?? matches[matches.length - 1])?.time ?? 0
}
