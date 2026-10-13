import { abs, add, C, conj, deg, mul, scale, sub, ZERO, type Complex } from '../engine/complex.ts'
import { solveLoadFlow, type LfBus, type LfResult } from './loadflow.ts'
import { branchPu, iBaseKa, seriesY } from './perunit.ts'
import { inService, islands, validate, type Issue } from './topology.ts'
import { buildYbus } from './ybus.ts'
import { isBranch, type Branch, type Generator, type Grid, type Network } from './types.ts'

/**
 * Solve a network's steady state: validate it, find the islands, run a Newton–Raphson load flow in every island
 * that has a reference source (a grid, or a generator in slack mode), and express the results in engineering
 * units. An island with no reference source is de-energised (its loads are not served) — a simplification:
 * a PV generator alone cannot set the island's voltage angle and frequency in this steady-state model.
 * Within an island the reference is the grid if there is one, otherwise the first slack generator; any further
 * slack-mode generator in the same island is treated as a PV generator at its P set-point (0 MW if none).
 */

export interface BusResult {
  id: string
  energized: boolean
  vPu: number
  angDeg: number
  /** Actual line-to-line voltage [kV]. */
  kv: number
  /** Bus type used in the load flow. */
  type?: 'slack' | 'pv' | 'pq'
}

export interface BranchResult {
  id: string
  inService: boolean
  energized: boolean
  /** Power entering the branch at each end [MW, Mvar] (negative = leaving the branch into the bus). */
  pFromMw: number
  qFromMvar: number
  pToMw: number
  qToMvar: number
  /** Losses inside the branch [MW, Mvar] = sum of the two end flows (Mvar can be negative: line charging). */
  lossMw: number
  lossMvar: number
  /** Line current magnitudes at each end [kA]. */
  iFromKa: number
  iToKa: number
  /** Loading against the rating [%] (largest end), when a rating is known. */
  loadingPct?: number
}

export interface SourceResult {
  id: string
  energized: boolean
  pMw: number
  qMvar: number
  /** Held at a reactive limit. */
  atQLimit: boolean
}

export interface LoadResult {
  id: string
  served: boolean
  pMw: number
  qMvar: number
}

export interface IslandResult {
  buses: string[]
  reference?: string
  lf?: Pick<LfResult, 'converged' | 'iterations' | 'mismatch' | 'history' | 'error'>
}

export interface Solution {
  /** Valid, and every energised island's load flow converged. */
  ok: boolean
  issues: Issue[]
  islands: IslandResult[]
  bus: Record<string, BusResult>
  branch: Record<string, BranchResult>
  source: Record<string, SourceResult>
  load: Record<string, LoadResult>
  totals: {
    genMw: number
    genMvar: number
    loadMw: number
    loadMvar: number
    lossMw: number
    lossMvar: number
    unservedMw: number
  }
}

const isRef = (c: Generator | Grid) => c.kind === 'grid' || c.mode === 'slack'

export function solveNetwork(net: Network): Solution {
  const issues = validate(net)
  const sol: Solution = {
    ok: false,
    issues,
    islands: [],
    bus: {},
    branch: {},
    source: {},
    load: {},
    totals: {
      genMw: 0,
      genMvar: 0,
      loadMw: 0,
      loadMvar: 0,
      lossMw: 0,
      lossMvar: 0,
      unservedMw: 0,
    },
  }
  for (const b of net.buses) sol.bus[b.id] = { id: b.id, energized: false, vPu: 0, angDeg: 0, kv: 0 }
  for (const c of net.components) {
    if (isBranch(c))
      sol.branch[c.id] = {
        id: c.id,
        inService: inService(net, c),
        energized: false,
        pFromMw: 0,
        qFromMvar: 0,
        pToMw: 0,
        qToMvar: 0,
        lossMw: 0,
        lossMvar: 0,
        iFromKa: 0,
        iToKa: 0,
      }
    else if (c.kind === 'generator' || c.kind === 'grid')
      sol.source[c.id] = {
        id: c.id,
        energized: false,
        pMw: 0,
        qMvar: 0,
        atQLimit: false,
      }
    else if (c.kind === 'load') sol.load[c.id] = { id: c.id, served: false, pMw: 0, qMvar: 0 }
  }
  if (issues.some((i) => i.level === 'error')) return sol

  const S = net.baseMva
  const sources = net.components.filter((c): c is Generator | Grid => (c.kind === 'generator' || c.kind === 'grid') && inService(net, c))
  const loads = net.components.filter((c) => c.kind === 'load' && inService(net, c)) as Extract<Network['components'][number], { kind: 'load' }>[]
  let allConverged = true

  for (const group of islands(net)) {
    const inIsland = new Set(group)
    const here = sources.filter((s) => inIsland.has(s.bus))
    const ref = here.find((s) => s.kind === 'grid') ?? here.find(isRef)
    const island: IslandResult = { buses: group, reference: ref?.id }
    sol.islands.push(island)
    if (!ref) continue

    // bus data for the load flow (net injections in pu)
    const idx = new Map(group.map((id, i) => [id, i]))
    const lf: LfBus[] = group.map(() => ({ type: 'pq', p: 0, q: 0, v: 1 }))
    const pvGens = here.filter((s): s is Generator => s !== ref && s.kind === 'generator')
    for (const l of loads)
      if (inIsland.has(l.bus)) {
        const b = lf[idx.get(l.bus)!]
        b.p -= l.pMw / S
        b.q -= l.qMvar / S
      }
    for (const g of pvGens) {
      const b = lf[idx.get(g.bus)!]
      b.p += (g.pMw ?? 0) / S
      if (b.type === 'pq') {
        b.type = 'pv'
        b.v = g.vPu
      }
    }
    // PV reactive limits apply to the bus's net injection: generator limits minus the local load's Q
    for (const id of group) {
      const b = lf[idx.get(id)!]
      if (b.type !== 'pv') continue
      const gs = pvGens.filter((g) => g.bus === id)
      if (gs.every((g) => g.qMinMvar !== undefined)) b.qMin = b.q + gs.reduce((a, g) => a + g.qMinMvar!, 0) / S
      if (gs.every((g) => g.qMaxMvar !== undefined)) b.qMax = b.q + gs.reduce((a, g) => a + g.qMaxMvar!, 0) / S
    }
    const r = lf[idx.get(ref.bus)!]
    r.type = 'slack'
    r.v = ref.vPu

    const Y = buildYbus(net, group)
    const res = solveLoadFlow(Y, lf)
    island.lf = {
      converged: res.converged,
      iterations: res.iterations,
      mismatch: res.mismatch,
      history: res.history,
      error: res.error,
    }
    if (!res.converged) {
      allConverged = false
      continue
    }

    // buses
    for (const id of group) {
      const i = idx.get(id)!
      const kvNom = net.buses.find((b) => b.id === id)!.kv
      const v = abs(res.V[i])
      sol.bus[id] = {
        id,
        energized: true,
        vPu: v,
        angDeg: deg(Math.atan2(res.V[i].im, res.V[i].re)),
        kv: v * kvNom,
        type: lf[i].type,
      }
    }
    // branches
    for (const c of net.components) {
      if (!isBranch(c) || !inService(net, c) || !inIsland.has(c.from)) continue
      sol.branch[c.id] = branchFlow(net, c, res.V[idx.get(c.from)!], res.V[idx.get(c.to)!])
    }
    // sources: the reference supplies the slack bus's net injection plus its local load, less any PV generation there
    const loadAt = (bus: string) => loads.filter((l) => l.bus === bus).reduce((a, l) => add(a, C(l.pMw, l.qMvar)), ZERO)
    const Sref = add(scale(res.S[idx.get(ref.bus)!], S), loadAt(ref.bus))
    const pvAtRef = pvGens.filter((g) => g.bus === ref.bus).reduce((a, g) => a + (g.pMw ?? 0), 0)
    sol.source[ref.id] = {
      id: ref.id,
      energized: true,
      pMw: Sref.re - pvAtRef,
      qMvar: Sref.im,
      atQLimit: false,
    }
    for (const id of new Set(pvGens.map((g) => g.bus))) {
      const gs = pvGens.filter((g) => g.bus === id)
      const i = idx.get(id)!
      const qTotal = res.S[i].im * S + loadAt(id).im - (id === ref.bus ? Sref.im : 0)
      for (const g of gs)
        sol.source[g.id] = {
          id: g.id,
          energized: true,
          pMw: g.pMw ?? 0,
          qMvar: qTotal / gs.length,
          atQLimit: res.qLimited.includes(i),
        }
    }
    for (const l of loads) if (inIsland.has(l.bus)) sol.load[l.id] = { id: l.id, served: true, pMw: l.pMw, qMvar: l.qMvar }
  }

  const t = sol.totals
  for (const s of Object.values(sol.source)) {
    t.genMw += s.pMw
    t.genMvar += s.qMvar
  }
  for (const l of net.components)
    if (l.kind === 'load') {
      if (sol.load[l.id].served) {
        t.loadMw += l.pMw
        t.loadMvar += l.qMvar
      } else t.unservedMw += l.pMw
    }
  for (const b of Object.values(sol.branch)) {
    t.lossMw += b.lossMw
    t.lossMvar += b.lossMvar
  }
  sol.ok = allConverged
  return sol
}

/** Flows at both ends of a branch from the solved end voltages (pu phasors). */
export function branchFlow(net: Network, c: Branch, Vf: Complex, Vt: Complex): BranchResult {
  const p = branchPu(net, c)
  const y = seriesY(p)
  const t = p.tap
  const If = sub(mul(add(scale(y, 1 / (t * t)), p.yHalf), Vf), mul(scale(y, 1 / t), Vt))
  const It = add(mul(scale(y, -1 / t), Vf), mul(add(y, p.yHalf), Vt))
  const S = net.baseMva
  const Sf = scale(mul(Vf, conj(If)), S)
  const St = scale(mul(Vt, conj(It)), S)
  const kvF = net.buses.find((b) => b.id === c.from)!.kv
  const kvT = net.buses.find((b) => b.id === c.to)!.kv
  const rating = c.kind === 'transformer' ? c.ratedMva : c.ratingMva
  return {
    id: c.id,
    inService: true,
    energized: true,
    pFromMw: Sf.re,
    qFromMvar: Sf.im,
    pToMw: St.re,
    qToMvar: St.im,
    lossMw: Sf.re + St.re,
    lossMvar: Sf.im + St.im,
    iFromKa: abs(If) * iBaseKa(kvF, S),
    iToKa: abs(It) * iBaseKa(kvT, S),
    loadingPct: rating ? (Math.max(abs(Sf), abs(St)) / rating) * 100 : undefined,
  }
}
