/*
 * The module's design state (what the controls hold) and its conversion into the calculation inputs. One design is
 * shared by every mode: the span (conductor, tension, loads, supports), the insulator string and the corona inputs.
 * The line voltage and the conductor are each ONE value: the string, the corona check and the span all use them.
 */

import { computeCorona, computeSpan, computeString, CONDUCTORS, type Conductor, type ConductorId, type CoronaInput, type Grading, type SpanInput, type StringInput, type TensionMode } from './calc.ts'

export interface SpanState {
  /** Span [m]. */
  L: number
  mode: TensionMode
  /** Tension at the lowest point [kN] (mode 'T0'). */
  T0kN: number
  /** Factor of safety (mode 'fos'). */
  fos: number
  conductor: ConductorId
  /** The custom conductor (used when conductor = 'custom'): weight [N/m], diameter [mm], breaking strength [kN]. */
  w: number
  dMm: number
  utsKN: number
  ice: boolean
  iceMm: number
  wind: boolean
  windPa: number
  /** Supports at different levels (Engineer level). */
  unequal: boolean
  /** Height of support B above support A [m]. */
  h: number
  /** Height of support A's conductor attachment above the ground [m]. */
  hA: number
  minClear: number
}

export interface StringState {
  n: number
  m: number
  /** Line-to-line voltage [kV] — also the corona check's operating voltage. */
  kv: number
  grading: Grading
}

export interface CoronaState {
  /** Spacing between the phase conductors [m]. */
  Dm: number
  /** Air pressure [cm Hg] and temperature [°C]. */
  b: number
  t: number
  m0: number
  mv: number
}

export interface Design {
  span: SpanState
  string: StringState
  corona: CoronaState
}

export const SPAN0: SpanState = {
  L: 300,
  mode: 'T0',
  T0kN: 25,
  fos: 2.5,
  conductor: 'medium',
  w: CONDUCTORS.medium.w,
  dMm: CONDUCTORS.medium.d * 1000,
  utsKN: CONDUCTORS.medium.uts / 1000,
  ice: false,
  iceMm: 10,
  wind: false,
  windPa: 400,
  unequal: false,
  h: 20,
  hA: 15,
  minClear: 7,
}
export const STRING0: StringState = { n: 5, m: 0.1, kv: 66, grading: 'none' }
export const CORONA0: CoronaState = { Dm: 2, b: 76, t: 25, m0: 0.85, mv: 0.82 }
export const DESIGN0: Design = { span: SPAN0, string: STRING0, corona: CORONA0 }

/** The conductor in use (a preset or the custom one). */
export function conductorOf(s: SpanState): Conductor {
  if (s.conductor !== 'custom') return CONDUCTORS[s.conductor]
  return { id: 'custom', name: 'Custom', d: s.dMm / 1000, w: s.w, uts: s.utsKN * 1000 }
}

export function toSpanInput(s: SpanState): SpanInput {
  const c = conductorOf(s)
  return {
    L: s.L,
    h: s.unequal ? s.h : 0,
    hA: s.hA,
    w: c.w,
    d: c.d,
    uts: c.uts,
    mode: s.mode,
    T0: s.T0kN * 1000,
    fos: s.fos,
    iceT: s.ice ? s.iceMm / 1000 : 0,
    windP: s.wind ? s.windPa : 0,
    minClear: s.minClear,
  }
}
export const toStringInput = (s: StringState): StringInput => ({ ...s })
export function toCoronaInput(d: Design): CoronaInput {
  const c = conductorOf(d.span)
  return { rCm: (c.d / 2) * 100, DCm: d.corona.Dm * 100, m0: d.corona.m0, mv: d.corona.mv, b: d.corona.b, t: d.corona.t, kv: d.string.kv }
}

export const spanOf = (d: Design) => computeSpan(toSpanInput(d.span))
export const stringOf = (d: Design) => computeString(toStringInput(d.string))
export const coronaOf = (d: Design) => computeCorona(toCoronaInput(d))
