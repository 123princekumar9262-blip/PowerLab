import { DEFAULT_PARAMS } from '../src/simulation/params.ts'
import type { LabParams } from '../src/types/simulation.ts'

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
