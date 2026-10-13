import { abs, add, C, div, inv, mul, neg, ONE, polarDeg, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'
import { invertComplex, solveComplex } from '../../engine/linalg.ts'
import { branchPu, iBaseKa, zBaseOhm, zFromMagXr } from '../../network/perunit.ts'
import { solveNetwork } from '../../network/solve.ts'
import { inService } from '../../network/topology.ts'
import { isBranch, type Network, type Winding } from '../../network/types.ts'
import { buildYbus } from '../../network/ybus.ts'
import { faultAtPoint, shiftSeq, toPhase, type FaultType, type PointFault, type Trio } from './sequence.ts'

/**
 * Short-circuit analysis of a network with the bus-impedance matrix, in each sequence.
 *
 * The classical fault-study model (stated on screen wherever its results appear):
 *  - pre-fault: no load current and every bus at V_f = 1.0 pu (loads and line charging neglected, transformer
 *    ratios taken as nominal — off-nominal taps ignored);
 *  - sources: a generator is an emf behind its subtransient reactance x″d (positive), x₂ (negative) and
 *    x₀ + 3·X_n (zero, only if its star point is earthed); a grid infeed is its short-circuit impedance from S_sc
 *    and X/R, taken equal in all three sequences;
 *  - lines: positive = negative sequence impedance from R, X per km; zero sequence from R₀, X₀ per km (3× the
 *    positive-sequence values if not given);
 *  - transformers: the leakage impedance in every sequence; in the zero sequence it connects the two buses only
 *    for YN–yn, is a path to earth from the YN side for YN–d / D–yn, and is open otherwise (Y ungrounded, D–D).
 * Z_bus = Y_bus⁻¹ per sequence. A part of a sequence network with no path to the reference (e.g. the zero sequence
 * of a delta-fed, unearthed system) has an infinite Thevenin impedance: no current of that sequence can flow there.
 */

export type ZeroConn = 'series' | 'earth-from' | 'earth-to' | 'open'

export interface SeqBranch {
  id: string
  name: string
  kind: 'line' | 'transformer'
  from: number
  to: number
  z1: Complex
  z2: Complex
  z0: Complex
  zero: ZeroConn
  /** A Y–d transformer: positive- and negative-sequence quantities are shifted by ±30° across it. */
  shift: boolean
  conn?: [Winding, Winding]
}

export interface SeqSource {
  id: string
  name: string
  /** An earthing transformer is a path to earth in the zero sequence only. */
  kind: 'generator' | 'grid' | 'earthing'
  bus: number
  /** null = not part of that sequence network. */
  z1: Complex | null
  z2: Complex | null
  /** null = star point not earthed (no zero-sequence path). */
  z0: Complex | null
}

/** One sequence network's matrices. Z entries between a bus with no path to the reference and anything are zero; check `earthed`. */
export interface SeqNet {
  Y: Complex[][]
  Z: Complex[][]
  /** The bus has a path to the reference in this sequence (its Thevenin impedance is finite). */
  earthed: boolean[]
  /** Connected part of this sequence network each bus belongs to. */
  part: number[]
}

export interface SeqModel {
  net: Network
  busIds: string[]
  kv: number[]
  branches: SeqBranch[]
  sources: SeqSource[]
  /** Index 0, 1, 2 = zero, positive, negative sequence. */
  seq: [SeqNet, SeqNet, SeqNet]
}

const conn = (w: Winding | undefined): Winding => w ?? 'YN'

/** How a transformer's leakage impedance appears in the zero-sequence network. */
export function zeroConnection(a: Winding | undefined, b: Winding | undefined): ZeroConn {
  const x = conn(a)
  const y = conn(b)
  if (x === 'YN' && y === 'YN') return 'series'
  if (x === 'YN' && y === 'D') return 'earth-from'
  if (x === 'D' && y === 'YN') return 'earth-to'
  return 'open'
}

/** A zero-sequence earth path added at a bus (an earthing transformer with its neutral impedance) [pu]. */
export interface EarthingUnit {
  id: string
  name: string
  bus: string
  z0: Complex
}

/** The three sequence networks of a network (classical fault-study model, see above). */
export function sequenceModel(net: Network, earthing: EarthingUnit[] = []): SeqModel {
  const busIds = net.buses.map((b) => b.id)
  const at = new Map(busIds.map((id, i) => [id, i]))
  const kv = net.buses.map((b) => b.kv)
  const branches: SeqBranch[] = []
  const sources: SeqSource[] = []
  for (const c of net.components) {
    if (isBranch(c)) {
      if (!inService(net, c)) continue
      const i = at.get(c.from)
      const k = at.get(c.to)
      if (i === undefined || k === undefined) continue
      // transformers at their nominal ratio (taps ignored, as stated): the nameplate impedance on the network base
      const z = c.kind === 'transformer' ? scale(zFromMagXr(c.zPct / 100, c.xr), net.baseMva / c.ratedMva) : branchPu(net, c).z
      if (c.kind === 'line') {
        const zb = zBaseOhm(kv[k], net.baseMva)
        const r0 = c.r0OhmPerKm ?? 3 * c.rOhmPerKm
        const x0 = c.x0OhmPerKm ?? 3 * c.xOhmPerKm
        branches.push({ id: c.id, name: c.name, kind: 'line', from: i, to: k, z1: z, z2: z, z0: scale(C(r0 * c.lengthKm, x0 * c.lengthKm), 1 / zb), zero: 'series', shift: false })
      } else {
        const a = conn(c.connFrom)
        const b = conn(c.connTo)
        branches.push({
          id: c.id,
          name: c.name,
          kind: 'transformer',
          from: i,
          to: k,
          z1: z,
          z2: z,
          z0: z,
          zero: zeroConnection(a, b),
          shift: (a === 'D') !== (b === 'D'),
          conn: [a, b],
        })
      }
    } else if (c.kind === 'generator') {
      const i = at.get(c.bus)
      if (i === undefined) continue
      const k = net.baseMva / c.ratedMva
      const x1 = c.x1Pu ?? 0.2
      const x2 = c.x2Pu ?? x1
      const x0 = c.x0Pu ?? 0.05
      sources.push({
        id: c.id,
        name: c.name,
        kind: 'generator',
        bus: i,
        z1: C(0, x1 * k),
        z2: C(0, x2 * k),
        z0: c.grounded ? C(0, (x0 + 3 * (c.xnPu ?? 0)) * k) : null,
      })
    } else if (c.kind === 'grid') {
      const i = at.get(c.bus)
      if (i === undefined) continue
      const z = zFromMagXr(net.baseMva / (c.scMva ?? 10000), c.xr ?? 10)
      sources.push({ id: c.id, name: c.name, kind: 'grid', bus: i, z1: z, z2: z, z0: z })
    }
  }
  for (const e of earthing) {
    const i = at.get(e.bus)
    if (i !== undefined) sources.push({ id: e.id, name: e.name, kind: 'earthing', bus: i, z1: null, z2: null, z0: e.z0 })
  }
  const n = busIds.length
  const build = (s: 0 | 1 | 2): SeqNet => {
    const Y: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO))
    const shunt = new Array<boolean>(n).fill(false)
    const parent = busIds.map((_, i) => i)
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
    const addShunt = (i: number, z: Complex) => {
      Y[i][i] = add(Y[i][i], inv(z))
      shunt[i] = true
    }
    for (const b of branches) {
      const z = s === 0 ? b.z0 : s === 1 ? b.z1 : b.z2
      if (s === 0 && b.zero !== 'series') {
        if (b.zero === 'earth-from') addShunt(b.from, z)
        if (b.zero === 'earth-to') addShunt(b.to, z)
        continue
      }
      const y = inv(z)
      Y[b.from][b.from] = add(Y[b.from][b.from], y)
      Y[b.to][b.to] = add(Y[b.to][b.to], y)
      Y[b.from][b.to] = sub(Y[b.from][b.to], y)
      Y[b.to][b.from] = sub(Y[b.to][b.from], y)
      parent[find(b.from)] = find(b.to)
    }
    for (const g of sources) {
      const z = s === 0 ? g.z0 : s === 1 ? g.z1 : g.z2
      if (z) addShunt(g.bus, z)
    }
    const part = busIds.map((_, i) => find(i))
    const earthedPart = new Set(part.filter((p, i) => shunt[i] && p >= 0))
    const earthed = part.map((p) => earthedPart.has(p))
    // invert the earthed part (block-diagonal across separate parts, so one inversion of the earthed buses suffices)
    const idx = busIds.map((_, i) => i).filter((i) => earthed[i])
    const Z: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO))
    if (idx.length) {
      const sub = invertComplex(idx.map((i) => idx.map((k) => Y[i][k])))
      if (sub) idx.forEach((i, a) => idx.forEach((k, b) => (Z[i][k] = part[i] === part[k] ? sub[a][b] : ZERO)))
    }
    return { Y, Z, earthed, part }
  }
  return { net, busIds, kv, branches, sources, seq: [build(0), build(1), build(2)] }
}

/** The Thevenin impedances at a bus (null = no path in that sequence). */
export function theveninAt(m: SeqModel, k: number): { z1: Complex | null; z2: Complex | null; z0: Complex | null } {
  const g = (s: 0 | 1 | 2) => (m.seq[s].earthed[k] ? m.seq[s].Z[k][k] : null)
  return { z1: g(1), z2: g(2), z0: g(0) }
}

export interface BusDuringFault {
  id: string
  /** Sequence voltages in the fault bus's frame (no transformer phase shift applied) [pu]. */
  v012: Trio
  /** Phase voltages at this bus [pu], with the ±30° shift of every Y–d transformer between it and the fault. */
  vabc: Trio
  /** Number of Y–d transformers between the fault and this bus (each shifts sequence quantities by ±30°). */
  shifts: number
}

export interface BranchDuringFault {
  id: string
  /** Sequence currents from → to in the fault bus's frame [pu]. */
  i012From: Trio
  i012To: Trio
  /** Phase currents at each end [pu of that end's base], with the Y–d shifts applied. */
  iabcFrom: Trio
  iabcTo: Trio
  /** Largest phase current at each end [kA]. */
  kaFrom: number
  kaTo: number
}

export interface SourceDuringFault {
  id: string
  /** Sequence currents delivered into the bus [pu]. */
  i012: Trio
  iabc: Trio
  ka: number
}

export interface FaultResult {
  busId: string
  bus: number
  type: FaultType
  zf: Complex
  vf: Complex
  z1: Complex | null
  z2: Complex | null
  z0: Complex | null
  /** No source can feed this bus (it is isolated from every source). */
  dead: boolean
  point: PointFault
  /** Base current at the fault bus [kA]. */
  iBaseKa: number
  /** Phase current magnitudes at the fault [kA]. */
  iabcKa: [number, number, number]
  /** Largest phase current at the fault [kA]. */
  faultKa: number
  /** Three-phase fault level at this bus, √3·V·I₃φ (bolted) [MVA] — the usual "fault level", whatever the fault type shown. */
  levelMva: number
  buses: BusDuringFault[]
  branches: BranchDuringFault[]
  sources: SourceDuringFault[]
}

const maxAbs = (t: Trio) => Math.max(abs(t[0]), abs(t[1]), abs(t[2]))

/** Number of Y–d transformers between `k` and every bus (breadth-first through in-service branches). */
export function shiftCounts(m: SeqModel, k: number): number[] {
  const n = m.busIds.length
  const out = new Array<number>(n).fill(0)
  const seen = new Array<boolean>(n).fill(false)
  seen[k] = true
  const q = [k]
  while (q.length) {
    const i = q.shift()!
    for (const b of m.branches) {
      const j = b.from === i ? b.to : b.to === i ? b.from : -1
      if (j < 0 || seen[j]) continue
      seen[j] = true
      out[j] = out[i] + (b.shift ? 1 : 0)
      q.push(j)
    }
  }
  return out
}

/**
 * A fault of a given type at a bus: the currents and voltages at the fault, at every bus and in every branch.
 * Bus voltages V_i = V_f − Z_ik·I (positive), −Z_ik·I (negative and zero); branch currents (V_i − V_k)/z per sequence.
 * Phase values away from the fault apply +30° per Y–d transformer crossed (the convention for the vector group is
 * not specified by the network; the magnitudes of the three phase values do not depend on it, only which phase
 * carries which).
 */
export function faultStudy(m: SeqModel, busId: string, type: FaultType, zf: Complex = ZERO, vf: Complex = ONE): FaultResult {
  const k = m.busIds.indexOf(busId)
  if (k < 0) throw new RangeError(`no bus ${busId}`)
  const th = theveninAt(m, k)
  const dead = th.z1 === null || th.z2 === null
  const point = dead
    ? { i012: [ZERO, ZERO, ZERO] as Trio, v012: [ZERO, ZERO, ZERO] as Trio, iabc: [ZERO, ZERO, ZERO] as Trio, vabc: [ZERO, ZERO, ZERO] as Trio }
    : faultAtPoint(type, vf, th.z1!, th.z2!, th.z0, zf)
  const [i0, i1, i2] = point.i012
  const ib = iBaseKa(m.kv[k], m.net.baseMva)
  const shifts = shiftCounts(m, k)
  const n = m.busIds.length
  // sequence voltages at every bus (fault bus frame)
  const v: Trio[] = []
  for (let i = 0; i < n; i++) {
    const s1 = m.seq[1]
    const s2 = m.seq[2]
    const s0 = m.seq[0]
    const pre = dead || !s1.earthed[i] ? ZERO : vf
    const v1 = s1.earthed[i] && s1.earthed[k] ? sub(pre, mul(s1.Z[i][k], i1)) : pre
    const v2 = s2.earthed[i] && s2.earthed[k] ? neg(mul(s2.Z[i][k], i2)) : ZERO
    let v0 = ZERO
    if (s0.earthed[k] && s0.earthed[i]) v0 = neg(mul(s0.Z[i][k], i0))
    else if (!s0.earthed[k] && s0.part[i] === s0.part[k]) v0 = point.v012[0] // an unearthed part shifts as a whole
    v.push([v0, v1, v2])
  }
  const buses: BusDuringFault[] = m.busIds.map((id, i) => ({ id, v012: v[i], vabc: toPhase(shiftSeq(v[i], 30 * shifts[i])), shifts: shifts[i] }))
  const branches: BranchDuringFault[] = m.branches.map((b) => {
    const s1 = div(sub(v[b.from][1], v[b.to][1]), b.z1)
    const s2 = div(sub(v[b.from][2], v[b.to][2]), b.z2)
    let f0 = ZERO
    let t0 = ZERO
    if (b.zero === 'series') f0 = t0 = div(sub(v[b.from][0], v[b.to][0]), b.z0)
    else if (b.zero === 'earth-from') f0 = div(v[b.from][0], b.z0)
    else if (b.zero === 'earth-to') t0 = neg(div(v[b.to][0], b.z0))
    const i012From: Trio = [f0, s1, s2]
    const i012To: Trio = [t0, s1, s2]
    const iabcFrom = toPhase(shiftSeq(i012From, 30 * shifts[b.from]))
    const iabcTo = toPhase(shiftSeq(i012To, 30 * shifts[b.to]))
    return {
      id: b.id,
      i012From,
      i012To,
      iabcFrom,
      iabcTo,
      kaFrom: maxAbs(iabcFrom) * iBaseKa(m.kv[b.from], m.net.baseMva),
      kaTo: maxAbs(iabcTo) * iBaseKa(m.kv[b.to], m.net.baseMva),
    }
  })
  const sources: SourceDuringFault[] = m.sources.map((g) => {
    const e = m.seq[1].earthed[g.bus] && !dead ? vf : ZERO
    const vb = v[g.bus]
    const i012: Trio = [g.z0 ? neg(div(vb[0], g.z0)) : ZERO, g.z1 ? div(sub(e, vb[1]), g.z1) : ZERO, g.z2 ? neg(div(vb[2], g.z2)) : ZERO]
    const iabc = toPhase(shiftSeq(i012, 30 * shifts[g.bus]))
    return { id: g.id, i012, iabc, ka: maxAbs(iabc) * iBaseKa(m.kv[g.bus], m.net.baseMva) }
  })
  const iabcKa = point.iabc.map((x) => abs(x) * ib) as [number, number, number]
  return {
    busId,
    bus: k,
    type,
    zf,
    vf,
    ...th,
    dead,
    point,
    iBaseKa: ib,
    iabcKa,
    faultKa: Math.max(...iabcKa),
    levelMva: th.z1 ? (abs(vf) / abs(th.z1)) * m.net.baseMva : 0,
    buses,
    branches,
    sources,
  }
}

/**
 * An independent check of a three-phase fault: solve the faulted positive-sequence network directly. The sources
 * are current injections E/z₁ (Norton), the fault an admittance 1/Z_f at bus k — or, for a bolted fault, V_k = 0 —
 * and Y_bus·V = I is solved for the bus voltages. Returns the bus voltages and the fault current.
 */
export function directThreePhase(m: SeqModel, busId: string, zf: Complex = ZERO, vf: Complex = ONE): { v: Complex[]; iF: Complex } | null {
  const k = m.busIds.indexOf(busId)
  const n = m.busIds.length
  const Y = m.seq[1].Y.map((r) => [...r])
  const inj: Complex[] = new Array(n).fill(ZERO)
  for (const g of m.sources) if (g.z1) inj[g.bus] = add(inj[g.bus], div(vf, g.z1))
  // only the energised part takes part (another part has no source and stays at zero)
  const live = m.busIds.map((_, i) => m.seq[1].earthed[i] && m.seq[1].part[i] === m.seq[1].part[k])
  if (!live[k]) return null
  const bolted = abs(zf) === 0
  if (!bolted) Y[k][k] = add(Y[k][k], inv(zf))
  const idx = m.busIds.map((_, i) => i).filter((i) => live[i] && !(bolted && i === k))
  const x = solveComplex(
    idx.map((i) => idx.map((j) => Y[i][j])),
    idx.map((i) => inj[i]),
  )
  if (!x) return null
  const v: Complex[] = new Array(n).fill(ZERO)
  idx.forEach((i, a) => (v[i] = x[a]))
  // KCL at the fault bus: what the network does not absorb there flows into the fault
  const yk = m.seq[1].Y[k]
  const iF = bolted
    ? sub(
        inj[k],
        yk.reduce((s, y, j) => add(s, mul(y, v[j])), ZERO),
      )
    : div(v[k], zf)
  return { v, iF }
}

/**
 * A three-phase fault with the pre-fault state from the load flow (for comparison with the 1.0 pu model): the
 * positive-sequence Y_bus of the load flow (series and shunt branch admittances, off-nominal taps), every load as a
 * constant admittance at its pre-fault voltage, every source as x″d to the reference. By superposition
 * I_f = V_k⁰ / (Z_kk + Z_f) and V_i = V_i⁰ − Z_ik·I_f. Null if the load flow fails.
 */
export function threePhaseWithLoadFlow(net: Network, busId: string, zf: Complex = ZERO): { iF: Complex; ka: number; vPre: Complex[]; vDuring: Complex[]; zkk: Complex } | null {
  const sol = solveNetwork(net)
  if (!sol.ok) return null
  const busIds = net.buses.map((b) => b.id)
  const k = busIds.indexOf(busId)
  const Y = buildYbus(net, busIds).map((r) => [...r])
  const vPre = busIds.map((id) => polarDeg(sol.bus[id].vPu, sol.bus[id].angDeg))
  for (const c of net.components) {
    if (c.kind === 'load' && sol.load[c.id]?.served) {
      const i = busIds.indexOf(c.bus)
      const vm = sol.bus[c.bus].vPu
      Y[i][i] = add(Y[i][i], scale(C(c.pMw, -c.qMvar), 1 / (net.baseMva * vm * vm)))
    }
  }
  const m = sequenceModel(net)
  for (const g of m.sources) if (g.z1) Y[g.bus][g.bus] = add(Y[g.bus][g.bus], inv(g.z1))
  const Z = invertComplex(Y)
  if (!Z) return null
  const iF = div(vPre[k], add(Z[k][k], zf))
  const vDuring = vPre.map((v0, i) => sub(v0, mul(Z[i][k], iF)))
  return { iF, ka: abs(iF) * iBaseKa(net.buses[k].kv, net.baseMva), vPre, vDuring, zkk: Z[k][k] }
}

/** Fault impedance in per unit at a bus from ohms. */
export const zfPu = (m: SeqModel, busId: string, rOhm: number, xOhm = 0): Complex => scale(C(rOhm, xOhm), 1 / zBaseOhm(m.kv[m.busIds.indexOf(busId)], m.net.baseMva))
