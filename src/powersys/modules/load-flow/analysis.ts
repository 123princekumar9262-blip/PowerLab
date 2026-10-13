import { abs, add, C, conj, deg, mul, scale, sub, type Complex } from '../../engine/complex.ts'
import { solveLoadFlow, type BusType } from '../../network/loadflow.ts'
import { newtonRaphson, type NrRun } from './stepwise.ts'
import { activeLines, editCase, lfBuses, unreachable, type CaseEdits, type LfCase } from './systems.ts'
import { ybusSteps } from './ybusSteps.ts'

/**
 * The load-flow results of a case in engineering units: bus voltages, each generator's output, every line's flow at
 * both ends and its losses, and the power balance. The voltages come from the shared Newton–Raphson solver
 * (network/loadflow.ts); everything else is computed here from them.
 */

export interface LineFlow {
  id: string
  from: number
  to: number
  inService: boolean
  /** Power entering the line at each end [MW, Mvar] (negative = leaving it). */
  pFromMw: number
  qFromMvar: number
  pToMw: number
  qToMvar: number
  lossMw: number
  /** Net reactive "loss" = I²X absorbed − charging produced [Mvar]. */
  lossMvar: number
  /** Series current [pu] and loading against the rating [%]. */
  iSeriesPu: number
  loadingPct?: number
}

export interface BusResult {
  vm: number
  thDeg: number
  type: BusType
  pGenMw: number
  qGenMvar: number
  pLoadMw: number
  qLoadMvar: number
  /** Reactive power delivered by a shunt capacitor at this bus [Mvar] = B·|V|². */
  qShuntMvar: number
  atQLimit: boolean
}

export interface CaseSolution {
  case: LfCase
  converged: boolean
  error?: string
  iterations: number
  history: number[]
  Y: Complex[][]
  V: Complex[]
  bus: BusResult[]
  lines: LineFlow[]
  totals: { pGen: number; qGen: number; pLoad: number; qLoad: number; pLoss: number; qLoss: number; qShunt: number; qCharging: number }
}

/** Flow on line i→k from the end voltages: I_ik = y·(V_i − V_k) + j(b/2)·V_i, S_ik = V_i·I_ik*. */
export function lineFlow(c: LfCase, l: LfCase['lines'][number], V: Complex[]): LineFlow {
  const d = l.r * l.r + l.x * l.x
  const y = C(l.r / d, -l.x / d)
  const h = C(0, l.b / 2)
  const Vi = V[l.from]
  const Vk = V[l.to]
  const Is = mul(y, sub(Vi, Vk))
  const Iik = add(Is, mul(h, Vi))
  const Iki = add(scale(Is, -1), mul(h, Vk))
  const S = c.baseMva
  const Sik = scale(mul(Vi, conj(Iik)), S)
  const Ski = scale(mul(Vk, conj(Iki)), S)
  return {
    id: l.id,
    from: l.from,
    to: l.to,
    inService: true,
    pFromMw: Sik.re,
    qFromMvar: Sik.im,
    pToMw: Ski.re,
    qToMvar: Ski.im,
    lossMw: Sik.re + Ski.re,
    lossMvar: Sik.im + Ski.im,
    iSeriesPu: abs(Is),
    loadingPct: l.ratingMva ? (Math.max(abs(Sik), abs(Ski)) / l.ratingMva) * 100 : undefined,
  }
}

/** Solve a case (with optional operating changes) with the shared Newton–Raphson load flow. */
export function solveCase(base: LfCase, edits: CaseEdits = {}): CaseSolution {
  const c = editCase(base, edits)
  const { Y } = ybusSteps(c)
  const lb = lfBuses(c)
  const empty = (error: string): CaseSolution => ({
    case: c,
    converged: false,
    error,
    iterations: 0,
    history: [],
    Y,
    V: c.buses.map(() => C(0)),
    bus: c.buses.map((b) => ({ vm: 0, thDeg: 0, type: b.type, pGenMw: 0, qGenMvar: 0, pLoadMw: b.pLoadMw, qLoadMvar: b.qLoadMvar, qShuntMvar: 0, atQLimit: false })),
    lines: [],
    totals: { pGen: 0, qGen: 0, pLoad: 0, qLoad: 0, pLoss: 0, qLoss: 0, qShunt: 0, qCharging: 0 },
  })
  const cut = unreachable(c)
  if (cut.length)
    return empty(`${cut.map((i) => c.buses[i].name).join(' and ')} ${cut.length > 1 ? 'are' : 'is'} cut off from the rest of the network — no load flow can supply ${cut.length > 1 ? 'them' : 'it'}.`)
  const r = solveLoadFlow(Y, lb)
  if (!r.converged) return { ...empty(r.error ?? 'No convergence.'), iterations: r.iterations, history: r.history }
  return assemble(c, Y, r.V, r.S, r.qLimited, { converged: true, iterations: r.iterations, history: r.history })
}

/** Results from a set of solved voltages and net injections (shared by the shared-solver and step-wise paths). */
export function assemble(
  c: LfCase,
  Y: Complex[][],
  V: Complex[],
  Snet: Complex[],
  qLimited: number[],
  meta: { converged: boolean; iterations: number; history: number[]; error?: string },
): CaseSolution {
  const S = c.baseMva
  const bus: BusResult[] = c.buses.map((b, i) => {
    const vm = abs(V[i])
    const isGen = b.type !== 'pq' || qLimited.includes(i)
    return {
      vm,
      thDeg: deg(Math.atan2(V[i].im, V[i].re)),
      type: qLimited.includes(i) ? 'pq' : b.type,
      pGenMw: b.type === 'slack' ? Snet[i].re * S + b.pLoadMw : b.pGenMw,
      qGenMvar: isGen ? Snet[i].im * S + b.qLoadMvar : 0,
      pLoadMw: b.pLoadMw,
      qLoadMvar: b.qLoadMvar,
      qShuntMvar: (b.shuntMvar ?? 0) * vm * vm,
      atQLimit: qLimited.includes(i),
    }
  })
  const lines = c.lines.map((l) =>
    l.inService === false ? { id: l.id, from: l.from, to: l.to, inService: false, pFromMw: 0, qFromMvar: 0, pToMw: 0, qToMvar: 0, lossMw: 0, lossMvar: 0, iSeriesPu: 0 } : lineFlow(c, l, V),
  )
  const sum = (f: (x: BusResult) => number) => bus.reduce((a, b) => a + f(b), 0)
  const qCharging = activeLines(c).reduce((a, l) => a + (l.b / 2) * (abs(V[l.from]) ** 2 + abs(V[l.to]) ** 2) * S, 0)
  return {
    case: c,
    ...meta,
    Y,
    V,
    bus,
    lines,
    totals: {
      pGen: sum((b) => b.pGenMw),
      qGen: sum((b) => b.qGenMvar),
      pLoad: sum((b) => b.pLoadMw),
      qLoad: sum((b) => b.qLoadMvar),
      pLoss: lines.reduce((a, l) => a + l.lossMw, 0),
      qLoss: lines.reduce((a, l) => a + l.lossMvar, 0),
      qShunt: sum((b) => b.qShuntMvar),
      qCharging,
    },
  }
}

/** The step-wise Newton–Raphson run of a case (for the iteration view and experiments with a chosen start). */
export function iterateCase(base: LfCase, edits: CaseEdits = {}, start?: { Vm: number[]; th: number[] }): { c: LfCase; Y: Complex[][]; run: NrRun } {
  const c = editCase(base, edits)
  const { Y } = ybusSteps(c)
  return { c, Y, run: newtonRaphson(Y, lfBuses(c), { start }) }
}

// ── the P–V (nose) curve ────────────────────────────────────────────────────────────────────────────────────────

export interface NosePoint {
  scale: number
  loadMw: number
  vm: number[]
  qLimited: number[]
}

export interface NoseCurve {
  points: NosePoint[]
  /** The largest load multiplier with a solution, and the smallest tried without one (the maximum lies between). */
  lo: number
  hi: number
  /** Total load at `lo` [MW]. */
  maxLoadMw: number
  baseLoadMw: number
  /** Why the last attempt failed. */
  reason?: string
}

/**
 * Trace the upper (normal-operation) branch of the P–V curve: scale every load (constant power factor; generation
 * set-points unchanged, the slack supplies the rest) in steps, solving each point with Newton–Raphson started from
 * the previous solution; when a step fails, halve it until the bracket [lo, hi] is narrower than `resolution`.
 * Only the upper branch is traced — the lower half of the nose needs a continuation method.
 */
export function noseCurve(base: LfCase, edits: CaseEdits = {}, opts: { step?: number; resolution?: number; maxScale?: number } = {}): NoseCurve {
  const step0 = opts.step ?? 0.05
  const res = opts.resolution ?? 1e-3
  const maxScale = opts.maxScale ?? 20
  const at = (k: number, start?: { Vm: number[]; th: number[] }) => iterateCase(base, { ...edits, loadScale: k }, start)
  const loadOf = (k: number) => editCase(base, { ...edits, loadScale: k }).buses.reduce((a, b) => a + b.pLoadMw, 0)
  const points: NosePoint[] = []
  let k = 1
  const first = at(k)
  if (!first.run.converged) return { points, lo: 0, hi: 1, maxLoadMw: 0, baseLoadMw: loadOf(1), reason: first.run.error }
  const push = (s: number, r: NrRun) => points.push({ scale: s, loadMw: loadOf(s), vm: r.Vm, qLimited: r.qLimited })
  push(k, first.run)
  let prev = first.run
  let step = step0
  let hi = Infinity
  let reason: string | undefined
  while (k + step <= maxScale) {
    const next = at(k + step, { Vm: prev.Vm, th: prev.th })
    if (next.run.converged) {
      k += step
      prev = next.run
      push(k, prev)
    } else {
      hi = k + step
      reason = next.run.error
    }
    if (hi < Infinity) {
      if (hi - k <= res) break
      step = (hi - k) / 2
    }
  }
  return { points, lo: k, hi, maxLoadMw: loadOf(k), baseLoadMw: loadOf(1), reason }
}
