import { abs, C, scale, ZERO } from '../../engine/complex.ts'
import { iBaseKa } from '../../network/perunit.ts'
import type { Transformer } from '../../network/types.ts'
import { shiftSeq, toPhase, toSeq, type FaultType, type Trio } from '../faults/sequence.ts'
import { faultModel, faultNetwork, SETUP0, type Setup } from '../faults/study.ts'
import { faultStudy } from '../faults/zbus.ts'

/*
 * Transformer differential protection of Module 4's grid transformer T2 (220/33 kV, 60 MVA, YN–d), with the
 * through-fault and internal-fault currents taken from Module 4's fault study (faults/zbus.ts). Module 4's sequence
 * networks carry no phase shift (it only rotates phase values for display), so this file applies an explicit vector
 * group: with clock number h, the LV positive-sequence quantities lag the HV ones by h·30° (negative sequence the
 * other way), and the delta blocks zero sequence.
 *
 * Definitions used here (stated on screen):
 *  - currents are taken positive INTO the protected zone on both sides, referred to per unit of the transformer's
 *    rated current on each side (the relay's amplitude matching from the CT ratios);
 *  - the star (HV) side is compensated: zero sequence removed (if the filter is on) and rotated by −h_set·30°
 *    (h_set = the relay's vector-group setting) — the digital equivalent of delta-connected CTs;
 *  - per phase: I_op = |I_HV,comp + I_LV|, I_res = (|I_HV,comp| + |I_LV|)/2;
 *  - dual-slope bias: operate if I_op > max(I_s1, k₁·I_res) up to I_res = I_s2, and above it
 *    I_op > max(I_s1, k₁·I_s2 + k₂·(I_res − I_s2)).
 */

/** Module 4's study setup with its earthing transformer on the 33 kV bus switched on, so earth faults on the 33 kV side draw current. */
export const DIFF_SETUP: Setup = { ...SETUP0, et33: true }
export const T2 = faultNetwork(SETUP0).components.find((c) => c.id === 'T2') as Transformer
export const T2_MVA = T2.ratedMva
export const HV_KV = 220
export const LV_KV = 33
/** Rated currents [A] at the buses' nominal voltages. */
export const I_RATED_HV = (T2_MVA * 1e3) / (Math.sqrt(3) * HV_KV)
export const I_RATED_LV = (T2_MVA * 1e3) / (Math.sqrt(3) * LV_KV)
/** CT ratios (x/1 A, typical standard ratios above the rated currents). */
export const CT_HV = 200
export const CT_LV = 1200

export type Clock = 1 | 11
export type DiffLocation = 'ext-lv' | 'int-lv' | 'ext-hv'
export const DIFF_LOCATIONS: Array<{ id: DiffLocation; label: string; text: string; internal: boolean }> = [
  { id: 'ext-lv', label: 'External: 33 kV bus', text: 'on the 33 kV busbar, beyond the LV current transformers — a through fault', internal: false },
  { id: 'int-lv', label: 'Internal: LV terminals', text: 'at the transformer’s 33 kV terminals, between the winding and the LV current transformers — inside the zone', internal: true },
  { id: 'ext-hv', label: 'External: 220 kV bus', text: 'on the 220 kV busbar, outside the HV current transformers', internal: false },
]

export interface BiasSettings {
  /** Minimum operating current [pu of rating]. */
  is1: number
  /** First slope. */
  k1: number
  /** Restraint current where the second slope starts [pu]. */
  is2: number
  /** Second slope. */
  k2: number
}
/** Typical settings (not from a specific standard). */
export const BIAS0: BiasSettings = { is1: 0.2, k1: 0.3, is2: 2, k2: 0.8 }

export interface DiffSettings {
  /** The transformer's vector group: YNd1 or YNd11. */
  clock: Clock
  /** The vector group the relay compensates for. */
  relayClock: Clock
  /** Remove zero sequence from the star-side currents. */
  zsFilter: boolean
  /** On-load tap position away from the ratio the relay is matched to [%] (+ = more HV turns). */
  tapPct: number
  /** Ratio error of the LV current transformers [%]. */
  ctErrPct: number
  bias: BiasSettings
}
export const DIFF0: DiffSettings = { clock: 11, relayClock: 11, zsFilter: true, tapPct: 0, ctErrPct: 0, bias: BIAS0 }

/** The bias threshold: the operating current needed to trip at a given restraint current [pu]. */
export function biasThreshold(ires: number, b: BiasSettings): number {
  const sloped = ires <= b.is2 ? b.k1 * ires : b.k1 * b.is2 + b.k2 * (ires - b.is2)
  return Math.max(b.is1, sloped)
}

export function biasIssues(b: BiasSettings): string[] {
  const out: string[] = []
  if (!(b.is1 > 0)) out.push('The minimum operating current must be above zero.')
  if (!(b.k1 > 0 && b.k1 < 1)) out.push('The first slope must be between 0 and 100 %.')
  if (!(b.k2 >= b.k1 && b.k2 <= 1.5)) out.push('The second slope must be at least the first (and at most 150 %).')
  if (!(b.is2 > 0)) out.push('The knee of the characteristic must be above zero.')
  return out
}

/** The digital compensation of the star side, in phase quantities: the "delta-CT" matrices (each removes zero sequence). */
export const COMP_MATRIX: Record<Clock, number[][]> = {
  // Yd11: LV leads HV by 30°, so the HV currents are advanced 30°: I_a' = (I_a − I_b)/√3
  11: [
    [1, -1, 0],
    [0, 1, -1],
    [-1, 0, 1],
  ].map((r) => r.map((x) => x / Math.sqrt(3))),
  // Yd1: LV lags HV by 30°: I_a' = (I_a − I_c)/√3
  1: [
    [1, 0, -1],
    [-1, 1, 0],
    [0, -1, 1],
  ].map((r) => r.map((x) => x / Math.sqrt(3))),
}

/** Star-side compensation in sequence terms: [0 (or I₀), I₁·e^(−jh·30°), I₂·e^(+jh·30°)] → phases. */
export function compensate(iabc: Trio, clock: Clock, zsFilter: boolean): Trio {
  const s = toSeq(iabc)
  return toPhase(shiftSeq([zsFilter ? ZERO : s[0], s[1], s[2]], -clock * 30))
}

export interface DiffResult {
  location: DiffLocation
  type: FaultType
  /** Primary currents into the zone [A]: HV side, LV side, per phase. */
  hvA: Trio
  lvA: Trio
  /** CT secondary currents [A]. */
  hvSec: Trio
  lvSec: Trio
  /** In per unit of rated current, after matching (LV) and compensation (HV). */
  hvPu: Trio
  lvPu: Trio
  iop: [number, number, number]
  ires: [number, number, number]
  thr: [number, number, number]
  tripPhases: boolean[]
  trip: boolean
  /** Largest fault current at the fault point [kA] (Module 4). */
  faultKa: number
  /** The largest phase current through the transformer [pu of rating]. */
  throughPu: number
}

const sc = (t: Trio, k: number): Trio => [scale(t[0], k), scale(t[1], k), scale(t[2], k)]

export function differential(loc: DiffLocation, type: FaultType, s: DiffSettings): DiffResult {
  const model = faultModel(DIFF_SETUP)
  const r = faultStudy(model, loc === 'ext-hv' ? 'hvB' : 'mvA', type)
  const t2 = r.branches.find((b) => b.id === 'T2')!
  const hvSide = loc === 'ext-hv'
  // Module 4's common frame is the fault side's frame; the other side is reached through the vector group
  const toHv = (x: Trio): Trio => (hvSide ? x : shiftSeq(x, s.clock * 30))
  const toLv = (x: Trio): Trio => (hvSide ? shiftSeq(x, -s.clock * 30) : x)
  const hvIn012 = toHv(t2.i012From)
  let lvIn012: Trio = toLv(t2.i012To.map((x) => scale(x, -1)) as Trio)
  if (loc === 'int-lv') {
    // inside the LV CTs: the LV CTs carry what the 33 kV system sends into the fault (everything but T2's share)
    const f = r.point.i012
    lvIn012 = toLv([C(f[0].re - t2.i012To[0].re, f[0].im - t2.i012To[0].im), C(f[1].re - t2.i012To[1].re, f[1].im - t2.i012To[1].im), C(f[2].re - t2.i012To[2].re, f[2].im - t2.i012To[2].im)])
  }
  // the tap changes the HV/LV current ratio (positive and negative sequence); the fault level change is neglected, as in Module 4
  const tap = 1 / (1 + s.tapPct / 100)
  const hv012: Trio = [hvIn012[0], scale(hvIn012[1], tap), scale(hvIn012[2], tap)]
  const ibHv = iBaseKa(HV_KV, model.net.baseMva) * 1000
  const ibLv = iBaseKa(LV_KV, model.net.baseMva) * 1000
  const hvA = sc(toPhase(hv012), ibHv)
  const lvA = sc(toPhase(lvIn012), ibLv)
  const hvSec = sc(hvA, 1 / CT_HV)
  const lvSec = sc(lvA, (1 + s.ctErrPct / 100) / CT_LV)
  // matching: secondary × nominal CT ratio ÷ rated current
  const hvMatched = sc(hvSec, CT_HV / I_RATED_HV)
  const lvPu = sc(lvSec, CT_LV / I_RATED_LV)
  const hvPu = compensate(hvMatched, s.relayClock, s.zsFilter)
  const iop = [0, 1, 2].map((p) => abs(C(hvPu[p].re + lvPu[p].re, hvPu[p].im + lvPu[p].im))) as [number, number, number]
  const ires = [0, 1, 2].map((p) => (abs(hvPu[p]) + abs(lvPu[p])) / 2) as [number, number, number]
  const thr = ires.map((x) => biasThreshold(x, s.bias)) as [number, number, number]
  const tripPhases = iop.map((x, p) => x > thr[p])
  const throughPu = Math.max(...hvA.map((x) => abs(x) / I_RATED_HV), ...lvA.map((x) => abs(x) / I_RATED_LV))
  return { location: loc, type, hvA, lvA, hvSec, lvSec, hvPu, lvPu, iop, ires, thr, tripPhases, trip: tripPhases.some(Boolean), faultKa: r.faultKa, throughPu }
}

/** The phase with the largest operating current relative to its threshold (the one that decides). */
export function worstPhase(d: DiffResult): 0 | 1 | 2 {
  let k: 0 | 1 | 2 = 0
  for (const p of [1, 2] as const) if (d.iop[p] - d.thr[p] > d.iop[k] - d.thr[k]) k = p
  return k
}

/** Spill current of a through fault with real (in-phase) ratio errors: I_op = I_t·|ε + t/(1+t)|. */
export const spillClosedForm = (throughPu: number, tapPct: number, ctErrPct: number) => throughPu * Math.abs(ctErrPct / 100 + tapPct / 100 / (1 + tapPct / 100))
