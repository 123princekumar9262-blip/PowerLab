import { DEFAULT_PARAMS } from '../src/simulation/params.ts'
import type { CircuitId, LabParams } from '../src/types/simulation.ts'

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> }

/** Default parameters with selected fields overridden. */
export function params(over: DeepPartial<LabParams> = {}): LabParams {
  return {
    source: { ...DEFAULT_PARAMS.source, ...over.source },
    diode: { ...DEFAULT_PARAMS.diode, ...over.diode },
    load: { ...DEFAULT_PARAMS.load, ...over.load },
    sim: { ...DEFAULT_PARAMS.sim, ...over.sim },
  }
}

export const ideal = (over: DeepPartial<LabParams> = {}) => params({ ...over, diode: { ...over.diode, model: 'ideal' } })
export const real = (over: DeepPartial<LabParams> = {}) => params({ ...over, diode: { model: 'real', vf: 0.7, ron: 0, ...over.diode } })

export const ALL_CIRCUITS: CircuitId[] = [
  'half-wave:R', 'half-wave:RL', 'half-wave:RC', 'half-wave:RLC',
  'center-tap:R', 'center-tap:RL', 'center-tap:RC', 'center-tap:RLC',
  'bridge:R', 'bridge:RL', 'bridge:RC', 'bridge:RLC',
]

/** Half-wave + RL with or without the freewheeling diode (educational defaults). */
export const fwParams = (freewheel: boolean, over: { vf?: number; ron?: number; model?: 'ideal' | 'real'; L?: number; R?: number; f?: number; cycles?: number } = {}): LabParams => ({
  ...DEFAULT_PARAMS,
  source: { ...DEFAULT_PARAMS.source, frequency: over.f ?? 50 },
  diode: { model: over.model ?? 'real', vf: over.vf ?? 0.7, ron: over.ron ?? 0 },
  load: { ...DEFAULT_PARAMS.load, resistance: over.R ?? 10, inductance: over.L ?? 0.05 },
  control: { device: 'diode', alphaDeg: 0, freewheel },
  sim: { ...DEFAULT_PARAMS.sim, cycles: over.cycles ?? 10 },
})

/**
 * A clock of the CPU time this test process has used [ms]. Speed tests ask whether a simulation is fast
 * enough for interactive use: the cost of the code. Wall-clock time also counts every other test file the
 * runner executes in parallel (each file is its own process), which made those tests fail only on a busy machine.
 */
export function cpuNow(): number {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}
