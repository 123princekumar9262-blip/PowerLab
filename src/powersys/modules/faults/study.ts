import { C, scale } from '../../engine/complex.ts'
import { zBaseOhm } from '../../network/perunit.ts'
import type { Network } from '../../network/types.ts'
import { gridNetwork } from '../grid/network.ts'
import { GRADING_MARGIN, tmsFor, tripTime, type Relay } from './relays.ts'
import { FAULT_TYPES, type FaultType } from './sequence.ts'
import { faultStudy, sequenceModel, type EarthingUnit, type FaultResult, type SeqModel } from './zbus.ts'

/**
 * Module 4's study system: the Grid Explorer network (generator → 220 kV → 33 kV → 11 kV town), with the earthing
 * and winding choices a student can change, the breakers' interrupting ratings and two overcurrent relays.
 * Ratings and relay settings are this module's equipment data (typical values, stated on screen), not results.
 */

export type GenEarth = 'solid' | 'reactor' | 'unearthed'

export interface Setup {
  genEarth: GenEarth
  /** Neutral reactor [pu on the generator's rating] when genEarth = 'reactor'. */
  xnPu: number
  /** T1's 220 kV winding: earthed star or unearthed star. */
  t1Hv: 'YN' | 'Y'
  /** T3's 11 kV winding. */
  t3Lv: 'YN' | 'Y'
  /** An earthing transformer on the 33 kV bus of the grid substation, with a neutral resistor [Ω]. */
  et33: boolean
  rnOhm: number
}

export const SETUP0: Setup = { genEarth: 'solid', xnPu: 0.1, t1Hv: 'YN', t3Lv: 'YN', et33: false, rnOhm: 10 }

/** The earthing transformer's own zero-sequence reactance [Ω per phase] (zig-zag winding; equipment data). */
export const ET_X0_OHM = 6

export const sameSetup = (a: Setup, b: Setup) => (Object.keys(a) as Array<keyof Setup>).every((k) => a[k] === b[k])

export function faultNetwork(s: Setup): Network {
  const n = gridNetwork()
  for (const c of n.components) {
    if (c.kind === 'generator') {
      c.grounded = s.genEarth !== 'unearthed'
      c.xnPu = s.genEarth === 'reactor' ? s.xnPu : 0
    }
    if (c.kind === 'transformer' && c.id === 'T1') c.connFrom = s.t1Hv
    if (c.kind === 'transformer' && c.id === 'T3') c.connTo = s.t3Lv
  }
  return n
}

/** The earthing transformer as a zero-sequence path: Z₀ = jX₀ + 3·R_n, in per unit at 33 kV. */
export function earthingUnits(s: Setup, net: Network): EarthingUnit[] {
  if (!s.et33) return []
  const zb = zBaseOhm(net.buses.find((b) => b.id === 'mvA')!.kv, net.baseMva)
  return [{ id: 'ET', name: 'Earthing transformer (33 kV)', bus: 'mvA', z0: scale(C(3 * s.rnOhm, ET_X0_OHM), 1 / zb) }]
}

export function faultModel(s: Setup = SETUP0): SeqModel {
  const net = faultNetwork(s)
  return sequenceModel(net, earthingUnits(s, net))
}

/** Every fault type at a bus. */
export function allTypes(m: SeqModel, busId: string, zf = C(0)): Record<FaultType, FaultResult> {
  return Object.fromEntries(FAULT_TYPES.map((t) => [t, faultStudy(m, busId, t, zf)])) as Record<FaultType, FaultResult>
}

/** Short names for the buses, in order along the network. */
export const BUS_SHORT: Record<string, string> = {
  gen: 'Generator 13.8 kV',
  hvA: 'Switchyard 220 kV',
  hvB: 'Grid s/s 220 kV',
  mvA: 'Grid s/s 33 kV',
  mvB: 'Distribution s/s 33 kV',
  lv: 'Town 11 kV',
}

export const TAGS: Record<string, string> = {
  G1: 'G1',
  T1: 'T1  YNd',
  L1: 'L1  220 kV · 120 km',
  T2: 'T2  YNd',
  L2: 'L2  33 kV · 10 km',
  T3: 'T3  Dyn',
  factory: 'Factory',
  town: 'Town',
  gen: 'Generator',
  hvA: 'Switchyard',
  hvB: 'Grid substation',
  mvA: 'Grid substation',
  mvB: 'Distribution s/s',
  lv: 'Town feeders',
}

/** Transformer tag with its winding connections as set. */
export function tagsFor(s: Setup): Record<string, string> {
  const t1 = `T1  ${s.t1Hv}d`
  const t3 = `T3  D${s.t3Lv === 'YN' ? 'yn' : 'y'}`
  return { ...TAGS, T1: t1, T3: t3 }
}

/** Circuit breakers: where each one sits, and its rated short-circuit breaking current (typical IEC values). */
export const BREAKERS: Array<{ id: string; at: string; kv: number; ratingKa: number; what: string }> = [
  { id: 'CB1', at: 'hvA', kv: 220, ratingKa: 31.5, what: '220 kV line L1' },
  { id: 'CB2', at: 'mvA', kv: 33, ratingKa: 25, what: '33 kV line L2' },
  { id: 'CB3', at: 'mvA', kv: 33, ratingKa: 25, what: 'factory feeder' },
  { id: 'CB4', at: 'lv', kv: 11, ratingKa: 20, what: 'town feeder' },
]

/**
 * The worst fault current a breaker must interrupt: a fault just beyond it is fed through it with the whole
 * current of a fault at its bus (radial network, loads neglected). The largest of the four fault types.
 */
export function breakerDuty(m: SeqModel, at: string): { ka: number; type: FaultType } {
  const all = allTypes(m, at)
  let best: FaultType = '3ph'
  for (const t of FAULT_TYPES) if (all[t].faultKa > all[best].faultKa) best = t
  return { ka: all[best].faultKa, type: best }
}

// ── protection ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Two inverse-time overcurrent relays in series: R1 on the town feeder (CB4, 11 kV), R2 on the 33 kV line (CB2). */
export const RELAYS0: { down: Relay; up: Relay } = {
  down: { id: 'R1', breaker: 'CB4', kv: 11, curve: 'SI', isA: 1000, tms: 0.1 },
  up: { id: 'R2', breaker: 'CB2', kv: 33, curve: 'SI', isA: 400, tms: 0.1 },
}

/** Where a fault is placed for the protection study. */
export type ProtLocation = 'feeder' | 'lvbus' | 'mvB'
export const PROT_LOCATIONS: Array<{ id: ProtLocation; label: string; bus: string; seenByDown: boolean; text: string }> = [
  { id: 'feeder', label: 'Town feeder, beyond CB4', bus: 'lv', seenByDown: true, text: 'on the town feeder just beyond CB4 — R1’s own zone' },
  { id: 'lvbus', label: '11 kV busbar', bus: 'lv', seenByDown: false, text: 'on the 11 kV busbar, before CB4 — R1 does not see it' },
  { id: 'mvB', label: '33 kV, end of L2', bus: 'mvB', seenByDown: false, text: 'at the far end of the 33 kV line L2' },
]

/** The currents [A, primary at each relay's voltage] the two relays see for a fault. Loads are neglected (radial, single source). */
export function relayCurrents(m: SeqModel, loc: ProtLocation, type: FaultType): { downA: number; upA: number; result: FaultResult } {
  const L = PROT_LOCATIONS.find((x) => x.id === loc)!
  const r = faultStudy(m, L.bus, type)
  const t3 = r.branches.find((b) => b.id === 'T3')
  const l2 = r.branches.find((b) => b.id === 'L2')
  return { downA: L.seenByDown && t3 ? t3.kaTo * 1000 : 0, upA: l2 ? l2.kaFrom * 1000 : 0, result: r }
}

/** The ratio used to refer 33 kV currents to 11 kV: the buses' nominal voltages (taps ignored, as in the fault model). */
export function referRatio(m: SeqModel): number {
  return m.kv[m.busIds.indexOf('mvA')] / m.kv[m.busIds.indexOf('lv')]
}

/** The upstream relay's TMS (rounded up to 0.01) that grades with the downstream one for every fault type on the feeder. */
export function tmsToGrade(m: SeqModel, down: Relay, up: Relay, margin = GRADING_MARGIN): number {
  let need = 0
  for (const t of FAULT_TYPES) {
    const c = relayCurrents(m, 'feeder', t)
    const td = tripTime(down.curve, down.tms, down.isA, c.downA)
    if (!Number.isFinite(td)) continue
    need = Math.max(need, tmsFor(up.curve, up.isA, c.upA, td + margin))
  }
  return Math.ceil(need * 100 - 1e-9) / 100
}
