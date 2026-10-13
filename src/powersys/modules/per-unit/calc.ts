import { C, type Complex } from '../../engine/complex.ts'
import { isBranch, type Branch, type Bus, type Generator, type Line, type Load, type Network, type Transformer } from '../../network/types.ts'

/**
 * Module 3 — the per-unit system, computed. Plain TypeScript (no React) so every number on the page can be tested.
 *
 * A per-unit system is fixed by two choices:
 *  - ONE three-phase base power S_base [MVA] for the whole system, and
 *  - ONE line-to-line base voltage V_base [kV] in one voltage zone (the "reference").
 * Every other zone's V_base follows from the transformers between the zones. Then, in each zone,
 *   Z_base = V_base² / S_base [Ω]        I_base = S_base / (√3 · V_base) [kA]
 *
 * How V_base crosses a transformer — two rules are supported:
 *  - 'nominal' (default, the shared engine's convention): in the ratio of the nominal system voltages the transformer
 *    connects (13.8/220, 220/33, 33/11 kV). A transformer whose rated winding voltages differ from that ratio (a tap)
 *    then keeps an off-nominal ratio t : 1 (an ideal transformer at its `from` end, as in network/perunit.ts).
 *  - 'rated': in the ratio of the transformer's own rated winding voltages. Then every t = 1 — the taps are absorbed
 *    into the bases — but nominal system voltages are no longer exactly 1 pu.
 *
 * These functions are deliberately written from first principles (not by calling network/perunit.ts) so that the
 * tests can check them against the shared engine's `branchPu` independently.
 */

export interface BaseChoice {
  /** Three-phase base power for the whole system [MVA]. */
  sMva: number
  /** The bus whose zone sets the base voltage. */
  refBus: string
  /** The base voltage chosen in that zone [kV, line-to-line]. */
  vRefKv: number
  /** How the base voltage crosses a transformer. */
  follow: 'nominal' | 'rated'
}

const SQRT3 = Math.sqrt(3)

/** Z_base = V_base² / S_base [Ω] (V in kV line-to-line, S in MVA three-phase). */
export const zBase = (vKv: number, sMva: number): number => (vKv * vKv) / sMva
/** I_base = S_base / (√3 · V_base) [kA]. */
export const iBase = (vKv: number, sMva: number): number => sMva / (SQRT3 * vKv)
/** Change of base for an impedance in per unit: Z_new = Z_old · (S_new / S_old) · (V_old / V_new)². */
export const changeBase = (zOld: number, sOld: number, vOld: number, sNew: number, vNew: number): number => zOld * (sNew / sOld) * (vOld / vNew) ** 2

export const busOf = (net: Network, id: string): Bus => {
  const b = net.buses.find((x) => x.id === id)
  if (!b) throw new Error(`no bus ${id}`)
  return b
}
export const compOf = <K extends Network['components'][number]['kind']>(net: Network, id: string, kind: K) => {
  const c = net.components.find((x) => x.id === id && x.kind === kind)
  if (!c) throw new Error(`no ${kind} ${id}`)
  return c as Extract<Network['components'][number], { kind: K }>
}

/** The network's own per-unit system: its S_base, and its highest-voltage bus at its nominal kV. */
export function networkBase(net: Network): BaseChoice {
  const ref = net.buses.reduce((a, b) => (b.kv > a.kv ? b : a))
  return { sMva: net.baseMva, refBus: ref.id, vRefKv: ref.kv, follow: 'nominal' }
}

/** The base voltage of every bus [kV]: start in the reference zone, cross lines unchanged and transformers by ratio. */
export function baseVoltages(net: Network, choice: BaseChoice): Record<string, number> {
  const vb: Record<string, number> = { [choice.refBus]: choice.vRefKv }
  busOf(net, choice.refBus)
  const queue = [choice.refBus]
  while (queue.length) {
    const here = queue.shift()!
    for (const c of net.components) {
      if (!isBranch(c)) continue
      const there = c.from === here ? c.to : c.to === here ? c.from : null
      if (!there) continue
      let v = vb[here]
      if (c.kind === 'transformer') {
        const fwd = c.from === here
        const [kvHere, kvThere] = choice.follow === 'rated' ? (fwd ? [c.kvFrom, c.kvTo] : [c.kvTo, c.kvFrom]) : [busOf(net, here).kv, busOf(net, there).kv]
        v = (vb[here] * kvThere) / kvHere
      }
      if (vb[there] === undefined) {
        vb[there] = v
        queue.push(there)
      } else if (Math.abs(vb[there] - v) > 1e-9 * v) throw new Error(`inconsistent base voltages at ${there}: a loop of transformers whose ratios disagree`)
    }
  }
  return vb
}

/** A voltage zone: buses joined by lines (no transformer between them) share one base voltage. */
export interface Zone {
  id: string
  buses: string[]
  nominalKv: number
  vBaseKv: number
  zBaseOhm: number
  iBaseKa: number
}

export function zones(net: Network, choice: BaseChoice): Zone[] {
  const vb = baseVoltages(net, choice)
  const parent = new Map(net.buses.map((b) => [b.id, b.id]))
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!))
  for (const c of net.components) if (c.kind === 'line') parent.set(find(c.to), find(c.from))
  const groups = new Map<string, string[]>()
  for (const b of net.buses) groups.set(find(b.id), [...(groups.get(find(b.id)) ?? []), b.id])
  return [...groups.values()].map((buses) => {
    const v = vb[buses[0]]
    return { id: buses[0], buses, nominalKv: busOf(net, buses[0]).kv, vBaseKv: v, zBaseOhm: zBase(v, choice.sMva), iBaseKa: iBase(v, choice.sMva) }
  })
}

// ── equipment on the system base ─────────────────────────────────────────────────────────────────────────────────

/** R and X [pu on the transformer's own rating] from |z| and X/R: R = |z| / √(1 + (X/R)²), X = R · X/R. */
export function ownRx(zMag: number, xr: number): Complex {
  if (!Number.isFinite(xr) || xr <= 0) return C(0, zMag)
  const r = zMag / Math.sqrt(1 + xr * xr)
  return C(r, r * xr)
}

export interface TransformerPu {
  /** On its own rating [pu]. */
  own: Complex
  /** The factors of the change of base, referred to the `to` winding. */
  kS: number
  kV: number
  /** On the system base, in the `to` zone [pu]. */
  z: Complex
  /** Off-nominal ratio t (ideal t : 1 at the `from` end); 1 when the bases follow its rated ratio. */
  tap: number
}

export function transformerPu(t: Transformer, sMva: number, vb: Record<string, number>): TransformerPu {
  const own = ownRx(t.zPct / 100, t.xr)
  const kS = sMva / t.ratedMva
  const kV = (t.kvTo / vb[t.to]) ** 2
  return { own, kS, kV, z: C(own.re * kS * kV, own.im * kS * kV), tap: t.kvFrom / vb[t.from] / (t.kvTo / vb[t.to]) }
}

export interface LinePu {
  zOhm: Complex
  zBaseOhm: number
  z: Complex
  /** Total shunt susceptance [S] and half of it in per unit (at each end of the π). */
  bS: number
  bHalfPu: number
}

export function linePu(l: Line, sMva: number, vb: Record<string, number>): LinePu {
  const zOhm = C(l.rOhmPerKm * l.lengthKm, l.xOhmPerKm * l.lengthKm)
  const zb = zBase(vb[l.to], sMva)
  const bS = l.bUsPerKm * 1e-6 * l.lengthKm
  return { zOhm, zBaseOhm: zb, z: C(zOhm.re / zb, zOhm.im / zb), bS, bHalfPu: (bS * zb) / 2 }
}

/** A generator's rated voltage: the model stores none, so it is taken as its bus's nominal voltage. */
export const genRatedKv = (net: Network, g: Generator): number => busOf(net, g.bus).kv

export interface GeneratorPu {
  /** Subtransient reactance on its own rating [pu]. */
  xOwn: number
  kS: number
  kV: number
  x: number
  /** Ohms at its terminals. */
  xOhm: number
}

export function generatorPu(net: Network, g: Generator, sMva: number, vb: Record<string, number>): GeneratorPu {
  const xOwn = g.x1Pu ?? 0
  const kvR = genRatedKv(net, g)
  const kS = sMva / g.ratedMva
  const kV = (kvR / vb[g.bus]) ** 2
  return { xOwn, kS, kV, x: xOwn * kS * kV, xOhm: (xOwn * kvR * kvR) / g.ratedMva }
}

export const loadPu = (l: Load, sMva: number): Complex => C(l.pMw / sMva, l.qMvar / sMva)

/** A transformer's impedance in ohms, referred to either winding, and in per unit on that side's base. */
export interface Side {
  bus: string
  ratedKv: number
  ohm: Complex
  vBaseKv: number
  zBaseOhm: number
  pu: Complex
}
export function transformerSides(t: Transformer, sMva: number, vb: Record<string, number>): { from: Side; to: Side; tap: number } {
  const own = ownRx(t.zPct / 100, t.xr)
  const side = (bus: string, kv: number): Side => {
    const zr = (kv * kv) / t.ratedMva
    const ohm = C(own.re * zr, own.im * zr)
    const zb = zBase(vb[bus], sMva)
    return { bus, ratedKv: kv, ohm, vBaseKv: vb[bus], zBaseOhm: zb, pu: C(ohm.re / zb, ohm.im / zb) }
  }
  return { from: side(t.from, t.kvFrom), to: side(t.to, t.kvTo), tap: t.kvFrom / vb[t.from] / (t.kvTo / vb[t.to]) }
}

/** Every series element on the system base, plus the loads (for the impedance diagram). */
export interface Model {
  choice: BaseChoice
  vb: Record<string, number>
  zones: Zone[]
  gen: Record<string, GeneratorPu>
  tx: Record<string, TransformerPu>
  line: Record<string, LinePu>
  load: Record<string, Complex>
}

export function buildModel(net: Network, choice: BaseChoice): Model {
  const vb = baseVoltages(net, choice)
  const m: Model = { choice, vb, zones: zones(net, choice), gen: {}, tx: {}, line: {}, load: {} }
  for (const c of net.components) {
    if (c.kind === 'generator') m.gen[c.id] = generatorPu(net, c, choice.sMva, vb)
    else if (c.kind === 'transformer') m.tx[c.id] = transformerPu(c, choice.sMva, vb)
    else if (c.kind === 'line') m.line[c.id] = linePu(c, choice.sMva, vb)
    else if (c.kind === 'load') m.load[c.id] = loadPu(c, choice.sMva)
  }
  return m
}

/**
 * The same network with the chosen bases written into it the way the shared engine reads them (S_base = baseMva,
 * each bus's base = its kv) — so `branchPu` from network/perunit.ts can check this module's conversions for any
 * base choice. Only for that cross-check: the bus kv values here are bases, not nominal voltages.
 */
export function rebased(net: Network, choice: BaseChoice): Network {
  const vb = baseVoltages(net, choice)
  return { ...net, baseMva: choice.sMva, buses: net.buses.map((b) => ({ ...b, kv: vb[b.id] })) }
}

// ── a three-phase bolted fault, in ohms and in per unit ──────────────────────────────────────────────────────────

/** One branch crossed on the way from the source to the fault, and the direction it is crossed in. */
export interface Hop {
  branch: Branch
  /** Crossed from its `from` bus to its `to` bus. */
  forward: boolean
}

export function pathBetween(net: Network, a: string, b: string): Hop[] {
  const prev = new Map<string, { bus: string; hop: Hop }>()
  const seen = new Set([a])
  const queue = [a]
  while (queue.length) {
    const x = queue.shift()!
    for (const c of net.components) {
      if (!isBranch(c)) continue
      const fwd = c.from === x
      const other = fwd ? c.to : c.to === x ? c.from : null
      if (!other || seen.has(other)) continue
      seen.add(other)
      prev.set(other, { bus: x, hop: { branch: c, forward: fwd } })
      queue.push(other)
    }
  }
  if (!seen.has(b)) throw new Error(`no path from ${a} to ${b}`)
  const hops: Hop[] = []
  for (let cur = b; cur !== a; cur = prev.get(cur)!.bus) hops.unshift(prev.get(cur)!.hop)
  return hops
}

export interface FaultTerm {
  id: string
  /** The reactance where it sits (Ω at its own voltage, or pu on its own zone's base). */
  own: number
  /** Referred to the faulted bus. */
  referred: number
}

export interface FaultResult {
  bus: string
  /** Pre-fault (no-load) voltage at the faulted bus: kV line-to-line (ohms) or pu (per unit). */
  e: number
  /** Total series reactance seen from the faulted bus: Ω or pu. */
  x: number
  /** Fault current: kA (ohms) or pu (per unit). */
  i: number
  terms: FaultTerm[]
  /** The ratios crossed, in order: turns ratio n = V_far / V_near (ohms) or off-nominal ratio t (per unit). */
  ratios: Array<{ id: string; ratio: number; forward: boolean }>
}

export interface FaultPuResult extends FaultResult {
  vBaseKv: number
  iBaseKa: number
  /** The fault current in kA: I_pu · I_base. */
  iKa: number
  /** The pre-fault voltage in kV: E_pu · V_base. */
  eKv: number
}

/** The network's single generator (the source of the fault calculations). */
export function sourceOf(net: Network): Generator {
  const g = net.components.find((c): c is Generator => c.kind === 'generator')
  if (!g) throw new Error('no generator')
  return g
}

/**
 * Bolted three-phase fault at a bus, in OHMS: walk from the generator to the bus, referring every reactance through
 * each transformer's actual turns ratio (rated kV) — X × n², E × n. Reactances only (resistances, loads and line
 * charging neglected); the generator's EMF behind x″d is `ePu` times its rated voltage (no-load pre-fault).
 * I_f = E / (√3 · X) [kA, with E in kV line-to-line and X in Ω per phase].
 */
export function faultOhms(net: Network, bus: string, ePu = 1): FaultResult {
  const g = sourceOf(net)
  const terms: FaultTerm[] = []
  const ratios: FaultResult['ratios'] = []
  const gx = (g.x1Pu ?? 0) * (genRatedKv(net, g) ** 2 / g.ratedMva)
  terms.push({ id: g.id, own: gx, referred: gx })
  let e = ePu * genRatedKv(net, g)
  const refer = (k: number) => terms.forEach((t) => (t.referred *= k))
  for (const { branch: c, forward } of pathBetween(net, g.bus, bus)) {
    if (c.kind === 'line') {
      const x = c.xOhmPerKm * c.lengthKm
      terms.push({ id: c.id, own: x, referred: x })
      continue
    }
    const xTo = ownRx(c.zPct / 100, c.xr).im * (c.kvTo ** 2 / c.ratedMva) // on its `to` winding
    if (forward) {
      const n = c.kvTo / c.kvFrom
      refer(n * n)
      e *= n
      terms.push({ id: c.id, own: xTo, referred: xTo })
      ratios.push({ id: c.id, ratio: n, forward })
    } else {
      const n = c.kvFrom / c.kvTo
      terms.push({ id: c.id, own: xTo, referred: xTo })
      refer(n * n)
      e *= n
      ratios.push({ id: c.id, ratio: n, forward })
    }
  }
  const x = terms.reduce((s, t) => s + t.referred, 0)
  return { bus, e, x, i: e / (SQRT3 * x), terms, ratios }
}

/**
 * The same fault in PER UNIT on a chosen base: per-unit reactances add directly, except across an off-nominal ratio
 * t (an ideal t : 1): crossing it from its `from` side divides what is behind by t² and E by t. I_f = E / X [pu],
 * then I_f [kA] = I_f [pu] · I_base of the faulted bus's zone.
 */
export function faultPerUnit(net: Network, bus: string, choice: BaseChoice, ePu = 1): FaultPuResult {
  const m = buildModel(net, choice)
  const g = sourceOf(net)
  const terms: FaultTerm[] = []
  const ratios: FaultResult['ratios'] = []
  const gx = m.gen[g.id].x
  terms.push({ id: g.id, own: gx, referred: gx })
  let e = (ePu * genRatedKv(net, g)) / m.vb[g.bus]
  const refer = (k: number) => terms.forEach((t) => (t.referred *= k))
  for (const { branch: c, forward } of pathBetween(net, g.bus, bus)) {
    if (c.kind === 'line') {
      const x = m.line[c.id].z.im
      terms.push({ id: c.id, own: x, referred: x })
      continue
    }
    const { z, tap } = m.tx[c.id]
    if (forward) {
      refer(1 / (tap * tap))
      e /= tap
      terms.push({ id: c.id, own: z.im, referred: z.im })
    } else {
      terms.push({ id: c.id, own: z.im, referred: z.im })
      refer(tap * tap)
      e *= tap
    }
    ratios.push({ id: c.id, ratio: tap, forward })
  }
  const x = terms.reduce((s, t) => s + t.referred, 0)
  const i = e / x
  const vB = m.vb[bus]
  const iB = iBase(vB, choice.sMva)
  return { bus, e, x, i, terms, ratios, vBaseKv: vB, iBaseKa: iB, iKa: i * iB, eKv: e * vB }
}

/** Relative difference |a − b| / max(|a|, |b|). */
export const relDiff = (a: number, b: number): number => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)))
