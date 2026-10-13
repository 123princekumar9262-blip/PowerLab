import { C, polar, type Complex } from '../../engine/complex.ts'
import { solveReal } from '../../engine/linalg.ts'
import type { BusType, LfBus } from '../../network/loadflow.ts'

/**
 * Newton–Raphson load flow (polar form) that RECORDS every iteration — the state it started from, the calculated
 * injections, the mismatch vector ΔP, ΔQ, the Jacobian and the corrections — so the module can show it step by
 * step. It follows the same algorithm as the shared solver (network/loadflow.ts): flat start unless a start is
 * given, unknowns [θ of every non-slack bus; |V| of every PQ bus], J·[Δθ; Δ|V|/|V|] = [ΔP; ΔQ], converged when the
 * largest mismatch is below `tol`, then PV reactive limits checked (a violated bus is held at its limit as a PQ bus
 * and the iteration continues). Tests check it reaches the shared solver's solution.
 */

export interface NrRecord {
  /** Updates applied before this state (0 = the starting point). */
  k: number
  types: BusType[]
  Vm: number[]
  th: number[]
  /** Calculated injections at this state [pu]. */
  P: number[]
  Q: number[]
  /** Unknowns: angles of these buses, magnitudes of those. */
  angIdx: number[]
  magIdx: number[]
  dP: number[]
  dQ: number[]
  /** Largest |ΔP|, |ΔQ| [pu]. */
  mismatch: number
  /** The Jacobian at this state and the correction it gave (absent at a converged or failed state). */
  J?: number[][]
  dx?: number[]
  /** Something that happened after this state (a PV bus reaching a reactive limit). */
  event?: string
}

export interface NrRun {
  converged: boolean
  /** Number of Newton updates. */
  iterations: number
  history: number[]
  records: NrRecord[]
  V: Complex[]
  Vm: number[]
  th: number[]
  /** Net injections at the final state [pu]. */
  S: Complex[]
  qLimited: number[]
  types: BusType[]
  error?: string
}

/** Injections P_i, Q_i [pu] from |V|, θ and Y_bus = G + jB:
 *   P_i = Σ_k |V_i||V_k|(G_ik cos θ_ik + B_ik sin θ_ik),  Q_i = Σ_k |V_i||V_k|(G_ik sin θ_ik − B_ik cos θ_ik). */
export function injectionsPolar(Y: Complex[][], Vm: number[], th: number[]): { P: number[]; Q: number[] } {
  const n = Vm.length
  const P = new Array<number>(n).fill(0)
  const Q = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const t = th[i] - th[k]
      const g = Y[i][k].re
      const b = Y[i][k].im
      P[i] += Vm[i] * Vm[k] * (g * Math.cos(t) + b * Math.sin(t))
      Q[i] += Vm[i] * Vm[k] * (g * Math.sin(t) - b * Math.cos(t))
    }
  return { P, Q }
}

/** The Jacobian for unknowns [θ_angIdx; |V|_magIdx], with the |V| columns scaled by |V| (so it multiplies Δ|V|/|V|).
 * Rows: [P_angIdx; Q_magIdx]. Blocks J1 = ∂P/∂θ, J2 = |V|·∂P/∂|V|, J3 = ∂Q/∂θ, J4 = |V|·∂Q/∂|V|. */
export function jacobian(Y: Complex[][], Vm: number[], th: number[], angIdx: number[], magIdx: number[]): number[][] {
  const { P, Q } = injectionsPolar(Y, Vm, th)
  const G = (i: number, k: number) => Y[i][k].re
  const B = (i: number, k: number) => Y[i][k].im
  const rows = [...angIdx.map((i) => ({ i, q: false })), ...magIdx.map((i) => ({ i, q: true }))]
  const cols = [...angIdx.map((k) => ({ k, v: false })), ...magIdx.map((k) => ({ k, v: true }))]
  return rows.map(({ i, q }) =>
    cols.map(({ k, v }) => {
      if (i === k) {
        const vv = Vm[i] * Vm[i]
        if (!q && !v) return -Q[i] - B(i, i) * vv // ∂P_i/∂θ_i
        if (!q && v) return P[i] + G(i, i) * vv // |V_i| ∂P_i/∂|V_i|
        if (q && !v) return P[i] - G(i, i) * vv // ∂Q_i/∂θ_i
        return Q[i] - B(i, i) * vv // |V_i| ∂Q_i/∂|V_i|
      }
      const t = th[i] - th[k]
      const vv = Vm[i] * Vm[k]
      const a = G(i, k) * Math.cos(t) + B(i, k) * Math.sin(t)
      const s = G(i, k) * Math.sin(t) - B(i, k) * Math.cos(t)
      if (!q && !v) return vv * s
      if (!q && v) return vv * a
      if (q && !v) return -vv * a
      return vv * s
    }),
  )
}

export interface NrOptions {
  tol?: number
  maxIter?: number
  /** A starting point instead of the flat start (|V| of PQ buses and all angles; slack/PV magnitudes stay at their set-points). */
  start?: { Vm: number[]; th: number[] }
}

export function newtonRaphson(Y: Complex[][], buses: LfBus[], opts: NrOptions = {}): NrRun {
  const tol = opts.tol ?? 1e-8
  const maxIter = opts.maxIter ?? 30
  const n = buses.length
  const types = buses.map((b) => b.type)
  const qSpec = buses.map((b) => b.q)
  const Vm = buses.map((b, i) => (b.type === 'pq' ? (opts.start?.Vm[i] ?? 1) : b.v))
  const th = buses.map((b, i) => (b.type === 'slack' ? 0 : (opts.start?.th[i] ?? 0)))
  const records: NrRecord[] = []
  const history: number[] = []
  const qLimited: number[] = []
  let it = 0
  const result = (converged: boolean, error?: string): NrRun => {
    const { P, Q } = injectionsPolar(Y, Vm, th)
    return {
      converged,
      iterations: it,
      history,
      records,
      V: Vm.map((v, i) => polar(v, th[i])),
      Vm: [...Vm],
      th: [...th],
      S: P.map((p, i) => C(p, Q[i])),
      qLimited,
      types: [...types],
      error,
    }
  }
  if (types.filter((t) => t === 'slack').length !== 1) return result(false, 'A load flow needs exactly one slack (reference) bus.')

  for (let pass = 0; pass < 4; pass++) {
    const angIdx = types.map((_, i) => i).filter((i) => types[i] !== 'slack')
    const magIdx = types.map((_, i) => i).filter((i) => types[i] === 'pq')
    for (;;) {
      const { P, Q } = injectionsPolar(Y, Vm, th)
      const dP = angIdx.map((i) => buses[i].p - P[i])
      const dQ = magIdx.map((i) => qSpec[i] - Q[i])
      const mis = Math.max(0, ...dP.map(Math.abs), ...dQ.map(Math.abs))
      const rec: NrRecord = { k: it, types: [...types], Vm: [...Vm], th: [...th], P, Q, angIdx, magIdx, dP, dQ, mismatch: mis }
      records.push(rec)
      history.push(mis)
      if (!Number.isFinite(mis)) return result(false, 'The iteration diverged (the voltages became undefined).')
      if (mis < tol) break
      if (it >= maxIter) return result(false, `No convergence in ${maxIter} iterations (largest mismatch ${mis.toExponential(2)} pu). The operating point may not exist.`)
      const J = jacobian(Y, Vm, th, angIdx, magIdx)
      rec.J = J
      const dx = solveReal(J, [...dP, ...dQ])
      if (!dx) return result(false, 'The Jacobian is singular — no unique operating point from here.')
      rec.dx = dx
      angIdx.forEach((i, j) => (th[i] += dx[j]))
      magIdx.forEach((i, j) => (Vm[i] *= 1 + dx[angIdx.length + j]))
      if (Vm.some((v) => v <= 0)) return result(false, 'A bus voltage collapsed to zero or below — no valid operating point.')
      it++
    }
    const { Q } = injectionsPolar(Y, Vm, th)
    const notes: string[] = []
    for (let i = 0; i < n; i++) {
      if (types[i] !== 'pv') continue
      const lo = buses[i].qMin
      const hi = buses[i].qMax
      const lim = hi !== undefined && Q[i] > hi + 1e-9 ? hi : lo !== undefined && Q[i] < lo - 1e-9 ? lo : undefined
      if (lim === undefined) continue
      notes.push(`bus ${i + 1} needs Q = ${Q[i].toFixed(4)} pu, beyond its limit ${lim.toFixed(4)} pu — it is held at the limit and becomes a PQ bus`)
      types[i] = 'pq'
      qSpec[i] = lim
      qLimited.push(i)
    }
    if (!notes.length) break
    records[records.length - 1].event = notes.join('; ')
  }
  return result(true)
}
