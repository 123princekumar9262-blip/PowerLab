import type { Complex } from '../../engine/complex.ts'
import type { Network } from '../../network/types.ts'
import { cx, fx } from '../../ui/format.ts'
import { buildModel, compOf, genRatedKv, zBase, type BaseChoice } from './calc.ts'

/**
 * The conversion of each element of the Grid Explorer network to per unit on a chosen base, written out step by
 * step with the numbers substituted — what the impedance-diagram build and the Verify mode show. Every number is
 * read from calc.ts; the tests check the final value of each conversion against the shared engine's branchPu.
 */

/** The series elements, in order from the generator to the town. */
export const ELEMENT_ORDER = ['G1', 'T1', 'L1', 'T2', 'L2', 'T3'] as const
export type ElementId = (typeof ELEMENT_ORDER)[number]
export const LOAD_IDS = ['factory', 'town'] as const

export interface CalcStep {
  label: string
  expr: string
  result: string
}

export interface Conversion {
  id: string
  title: string
  /** One sentence: what is being converted and how. */
  what: string
  steps: CalcStep[]
  /** Series impedance on the system base [pu] (generator: its subtransient reactance only). */
  z?: Complex
  /** Off-nominal ratio (transformers). */
  tap?: number
  /** Half the line charging susceptance [pu]. */
  bHalf?: number
  /** Load power [pu]. */
  s?: Complex
}

/** A voltage or power without trailing zeros: 220 → "220", 13.8 → "13.8", 14.4273 → "14.427". */
export const num = (v: number, maxDec = 3): string => {
  const s = Number(v.toFixed(maxDec)).toString()
  return s.replace('-', '−')
}
export const kvs = (v: number) => `${num(v)} kV`
export const pu = (z: Complex, d = 4) => `${cx(z.re, z.im, d)} pu`

export function conversion(net: Network, choice: BaseChoice, id: string): Conversion {
  const m = buildModel(net, choice)
  const S = choice.sMva
  const c = net.components.find((x) => x.id === id)
  if (!c) throw new Error(`no element ${id}`)
  if (c.kind === 'generator') {
    const g = m.gen[id]
    const kvR = genRatedKv(net, c)
    const e = kvR / m.vb[c.bus]
    return {
      id,
      title: `${c.name}: x″d on its own rating`,
      what: `A generator’s nameplate gives its reactance in per unit of its own rating (${num(c.ratedMva)} MVA, ${kvs(kvR)}). Change it to the system base.`,
      z: { re: 0, im: g.x },
      steps: [
        { label: 'Nameplate', expr: `x″d on ${num(c.ratedMva)} MVA, ${kvs(kvR)}`, result: `${fx(g.xOwn, 3)} pu` },
        { label: 'Change of base', expr: `${fx(g.xOwn, 3)} × (${num(S)} / ${num(c.ratedMva)}) × (${num(kvR)} / ${num(m.vb[c.bus])})²`, result: `j${fx(g.x, 4)} pu` },
        { label: 'EMF behind x″d', expr: `1.0 × ${kvs(kvR)} / ${kvs(m.vb[c.bus])}`, result: `${fx(e, 4)} pu` },
      ],
    }
  }
  if (c.kind === 'transformer') {
    const t = m.tx[id]
    const vbTo = m.vb[c.to]
    const vbFrom = m.vb[c.from]
    const offNominal = Math.abs(t.tap - 1) > 1e-9
    return {
      id,
      title: `${c.name}: nameplate to system base`,
      what: `${num(c.zPct)} % on its own ${num(c.ratedMva)} MVA at its rated ${num(c.kvFrom)}/${num(c.kvTo)} kV. Referred to its ${kvs(c.kvTo)} winding, the base changes from (${num(c.ratedMva)} MVA, ${kvs(c.kvTo)}) to (${num(S)} MVA, ${kvs(vbTo)}).`,
      z: t.z,
      tap: t.tap,
      steps: [
        { label: 'Nameplate', expr: `${num(c.zPct)} % on ${num(c.ratedMva)} MVA, X/R = ${num(c.xr)}`, result: `|z| = ${fx(c.zPct / 100, 3)} pu` },
        { label: 'R and X (own rating)', expr: `R = ${fx(c.zPct / 100, 3)} / √(1 + ${num(c.xr)}²),  X = ${num(c.xr)} · R`, result: pu(t.own) },
        {
          label: `Change of base (${kvs(c.kvTo)} side)`,
          expr: `× (${num(S)} / ${num(c.ratedMva)}) × (${num(c.kvTo)} / ${num(vbTo)})² = × ${fx(t.kS * t.kV, 4)}`,
          result: pu(t.z),
        },
        {
          label: 'Off-nominal ratio',
          expr: `t = (${num(c.kvFrom)} / ${num(vbFrom)}) / (${num(c.kvTo)} / ${num(vbTo)})`,
          result: offNominal ? `${fx(t.tap, 4)} : 1` : '1 — none',
        },
      ],
    }
  }
  if (c.kind === 'line') {
    const l = m.line[id]
    return {
      id,
      title: `${c.name}: ohms to per unit`,
      what: `A line is given in ohms per kilometre. Its whole series impedance in ohms, divided by the base impedance of its zone, is its per-unit value.`,
      z: l.z,
      bHalf: l.bHalfPu,
      steps: [
        { label: 'Series impedance', expr: `(${num(c.rOhmPerKm)} + j${num(c.xOhmPerKm)}) Ω/km × ${num(c.lengthKm)} km`, result: `${cx(l.zOhm.re, l.zOhm.im, 2)} Ω` },
        { label: `Z_base (${kvs(m.vb[c.to])})`, expr: `${num(m.vb[c.to])}² / ${num(S)}`, result: `${fx(l.zBaseOhm, l.zBaseOhm < 10 ? 4 : 2)} Ω` },
        { label: 'Per unit', expr: `(${cx(l.zOhm.re, l.zOhm.im, 2)}) / ${fx(l.zBaseOhm, l.zBaseOhm < 10 ? 4 : 2)}`, result: pu(l.z) },
        {
          label: 'Line charging',
          expr: `B = ${num(c.bUsPerKm)} µS/km × ${num(c.lengthKm)} km = ${num(l.bS * 1e6, 1)} µS;  B · Z_base / 2`,
          result: `j${fx(l.bHalfPu, 4)} pu each end`,
        },
      ],
    }
  }
  if (c.kind === 'load') {
    const s = m.load[id]
    return {
      id,
      title: `${c.name}: power to per unit`,
      what: 'Powers are divided by S_base — the same in every zone.',
      s,
      steps: [{ label: 'Load', expr: `(${num(c.pMw, 2)} + j${num(c.qMvar, 2)}) MVA / ${num(S)} MVA`, result: pu(s, 4) }],
    }
  }
  throw new Error(`${id} is not converted`)
}

/** The base quantities of every zone as calculation steps (the first step of the diagram build). */
export function baseSteps(net: Network, choice: BaseChoice): CalcStep[] {
  const m = buildModel(net, choice)
  return m.zones.map((z) => ({
    label: `${num(z.nominalKv)} kV zone`,
    expr: `Z_base = ${num(z.vBaseKv)}² / ${num(choice.sMva)},  I_base = ${num(choice.sMva)} / (√3 × ${num(z.vBaseKv)})`,
    result: `${fx(zBase(z.vBaseKv, choice.sMva), z.zBaseOhm < 10 ? 4 : 2)} Ω,  ${fx(z.iBaseKa, 4)} kA`,
  }))
}

/** A transformer's nameplate in words. */
export function nameplate(net: Network, id: string): string {
  const t = compOf(net, id, 'transformer')
  return `${num(t.zPct)} % on ${num(t.ratedMva)} MVA, ${num(t.kvFrom)}/${num(t.kvTo)} kV, X/R ${num(t.xr)}`
}
