import type { FaultType } from '../faults/sequence.ts'
import { C0_NF } from './breaker.ts'
import { DIFF0, type DiffLocation, type DiffSettings } from './differential.ts'
import { FAULT0, L1_KM, RCA0, ROUTE0, ZONES0, type FaultSpec, type RouteOpts, type ZoneSettings } from './distance.ts'
import { EARTH0, STATOR0, type EarthParams, type StatorParams } from './earthing.ts'

/** Everything the student sets in Explore (kept while switching modes, so Verify checks the same case). */
export interface DistState {
  spec: FaultSpec
  opts: RouteOpts
  zones: ZoneSettings
}
export const DIST0: DistState = { spec: FAULT0, opts: ROUTE0, zones: ZONES0 }

export interface DirState {
  km: number
  type: FaultType
  rcaDeg: number
  sscMva: number
}
export const DIR0: DirState = { km: 0.5 * L1_KM, type: '3ph', rcaDeg: RCA0, sscMva: 2000 }

export interface DiffState {
  loc: DiffLocation
  type: FaultType
  s: DiffSettings
}
export const DIFFSTATE0: DiffState = { loc: 'ext-lv', type: '3ph', s: DIFF0 }

export interface StatorState {
  p: StatorParams
  /** Fault position from the neutral [% of the winding]. */
  xPct: number
}
export const STATORSTATE0: StatorState = { p: STATOR0, xPct: 30 }

export interface TrvState {
  cb: string
  cNf: number
  rOn: boolean
  rOhm: number
}
export const TRV0: TrvState = { cb: 'CB1', cNf: C0_NF, rOn: false, rOhm: 2000 }

export type Section = 'distance' | 'directional' | 'differential' | 'earthing' | 'generator' | 'breaker'
export const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'distance', label: 'Distance' },
  { id: 'directional', label: 'Directional' },
  { id: 'differential', label: 'Differential' },
  { id: 'earthing', label: 'Neutral earthing' },
  { id: 'generator', label: 'Generator' },
  { id: 'breaker', label: 'Breaker TRV' },
]

export interface ModState {
  dist: DistState
  dir: DirState
  diff: DiffState
  earth: EarthParams
  stator: StatorState
  trv: TrvState
}
export const STATE0: ModState = { dist: DIST0, dir: DIR0, diff: DIFFSTATE0, earth: EARTH0, stator: STATORSTATE0, trv: TRV0 }
