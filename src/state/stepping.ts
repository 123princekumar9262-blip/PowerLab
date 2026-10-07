import { indexAtTime } from '../simulation/engine.ts'
import type { SimulationResult } from '../types/simulation.ts'
import { groupIndex, type EventGroup } from '../visualization/eventGroups.ts'

export type StepMode = 'event' | 'angle' | 'sample'

/** Angle increment for 'angle' stepping [degrees]. */
export const ANGLE_STEP_DEG = 15

/**
 * Where STEP FORWARD / BACKWARD lands, as a sample index.
 *  - event:  the next/previous detected event (see groupIndex for which sample it lands on)
 *  - angle:  the next/previous multiple of 15° of the source angle θ = ωt + φ
 *  - sample: one simulation timestep
 */
export function stepTarget(result: SimulationResult, groups: EventGroup[], index: number, dir: 1 | -1, mode: StepMode): number {
  const last = result.trace.length - 1
  const clamp = (i: number) => Math.min(last, Math.max(0, i))

  if (mode === 'sample') return clamp(index + dir)

  if (mode === 'angle') {
    const { omega, phase } = result.params
    const t = result.trace.time[index]
    const thetaDeg = ((omega * t + phase) * 180) / Math.PI // unwrapped
    const k = thetaDeg / ANGLE_STEP_DEG
    // The cursor sits on samples, so "on a grid angle" means within one sample of it
    // (one sample = ω·Δt of angle). Without this, landing just below 60° would target 60° again.
    const tolK = (omega * result.params.dt * 180) / Math.PI / ANGLE_STEP_DEG
    const nextK = dir > 0 ? Math.floor(k + tolK) + 1 : Math.ceil(k - tolK) - 1
    const tTarget = ((nextK * ANGLE_STEP_DEG * Math.PI) / 180 - phase) / omega
    const target = clamp(indexAtTime(result, tTarget))
    return target === index ? clamp(index + dir) : target
  }

  const targets = groups.map((g) => groupIndex(result, g))
  if (dir > 0) {
    const next = targets.find((i) => i > index)
    return next ?? index
  }
  for (let k = targets.length - 1; k >= 0; k--) if (targets[k] < index) return targets[k]
  return index
}
