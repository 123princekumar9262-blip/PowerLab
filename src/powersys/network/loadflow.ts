import { C, polar, type Complex } from '../engine/complex.ts'
import { solveReal } from '../engine/linalg.ts'

/**
 * Newton–Raphson load flow in polar form, for small networks.
 *
 * Bus types: slack — |V| and θ specified (the reference, θ = 0), P and Q solved;
 *            PV    — P and |V| specified, Q and θ solved (within optional Q limits);
 *            PQ    — P and Q specified, |V| and θ solved.
 * Specified powers are NET injections in per unit (generation − load). Power injected at bus i:
 *   P_i = Σ_k |V_i||V_k| (G_ik cos θ_ik + B_ik sin θ_ik)      Q_i = Σ_k |V_i||V_k| (G_ik sin θ_ik − B_ik cos θ_ik)
 * The mismatches ΔP, ΔQ are driven to zero with the Jacobian J·[Δθ; Δ|V|/|V|] = [ΔP; ΔQ] (flat start).
 * Converged when the largest mismatch is below `tol` (pu); a non-converged result is reported as such.
 */
export type BusType = 'slack' | 'pv' | 'pq'
export interface LfBus {
  type: BusType
  /** Net injection set-points [pu]: P for PV/PQ, Q for PQ. */
  p: number
  q: number
  /** Voltage magnitude set-point [pu] for slack/PV. */
  v: number
  /** Reactive limits of a PV bus's NET injection [pu]; violated → the bus is held at the limit (PQ). */
  qMin?: number
  qMax?: number
}

export interface LfResult {
  converged: boolean
  iterations: number
  /** Largest |ΔP|, |ΔQ| [pu] at the end. */
  mismatch: number
  /** Largest mismatch after each iteration (iteration 0 = flat start). */
  history: number[]
  /** Final bus voltages (phasors, pu). */
  V: Complex[]
  /** Net complex power injected at each bus [pu], from the solved voltages. */
  S: Complex[]
  /** PV buses held at a Q limit (indices). */
  qLimited: number[]
  error?: string
}

export function solveLoadFlow(Y: Complex[][], buses: LfBus[], opts: { tol?: number; maxIter?: number } = {}): LfResult {
  const tol = opts.tol ?? 1e-8
  const maxIter = opts.maxIter ?? 30
  const n = buses.length
  const type = buses.map((b) => b.type)
  if (type.filter((t) => t === 'slack').length !== 1) return fail(n, 'A load flow needs exactly one slack (reference) bus in the connected network.')
  const G = Y.map((r) => r.map((y) => y.re))
  const B = Y.map((r) => r.map((y) => y.im))
  const Vm = buses.map((b) => (b.type === 'pq' ? 1 : b.v))
  const th = new Array<number>(n).fill(0)
  const qSpec = buses.map((b) => b.q)
  const qLimited: number[] = []
  const history: number[] = []

  const injections = () => {
    const P = new Array<number>(n).fill(0)
    const Q = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        const t = th[i] - th[k]
        const c = Math.cos(t)
        const s = Math.sin(t)
        P[i] += Vm[i] * Vm[k] * (G[i][k] * c + B[i][k] * s)
        Q[i] += Vm[i] * Vm[k] * (G[i][k] * s - B[i][k] * c)
      }
    return { P, Q }
  }

  let it = 0
  let mis = Infinity
  let P: number[] = []
  let Q: number[] = []
  for (let pass = 0; pass < 4; pass++) {
    const angIdx = [...Array(n).keys()].filter((i) => type[i] !== 'slack')
    const magIdx = [...Array(n).keys()].filter((i) => type[i] === 'pq')
    for (;;) {
      ;({ P, Q } = injections())
      const dP = angIdx.map((i) => buses[i].p - P[i])
      const dQ = magIdx.map((i) => qSpec[i] - Q[i])
      mis = Math.max(0, ...dP.map(Math.abs), ...dQ.map(Math.abs))
      history.push(mis)
      if (!Number.isFinite(mis)) return fail(n, 'The iteration diverged (the voltages became undefined).', it, history)
      if (mis < tol) break
      if (it >= maxIter)
        return {
          ...done(),
          converged: false,
          error: `No convergence in ${maxIter} iterations (largest mismatch ${mis.toExponential(2)} pu). The operating point may not exist — e.g. the load is beyond what the network can carry.`,
        }
      // Jacobian (dP/dθ, dP/d|V|·|V|; dQ/dθ, dQ/d|V|·|V|)
      const m = angIdx.length + magIdx.length
      const J = Array.from({ length: m }, () => new Array<number>(m).fill(0))
      const row = (i: number, isQ: boolean) => (isQ ? angIdx.length + magIdx.indexOf(i) : angIdx.indexOf(i))
      for (const i of [...angIdx, ...magIdx.map((x) => -1 - x)]) {
        const isQ = i < 0
        const ii = isQ ? -1 - i : i
        const r = row(ii, isQ)
        for (const k of angIdx) {
          const c = angIdx.indexOf(k)
          J[r][c] = dTheta(ii, k, isQ)
        }
        for (const k of magIdx) {
          const c = angIdx.length + magIdx.indexOf(k)
          J[r][c] = dV(ii, k, isQ)
        }
      }
      const dx = solveReal(J, [...dP, ...dQ])
      if (!dx) return fail(n, 'The Jacobian is singular — the network or its specifications do not define a unique operating point.', it, history)
      angIdx.forEach((i, j) => (th[i] += dx[j]))
      magIdx.forEach((i, j) => (Vm[i] *= 1 + dx[angIdx.length + j]))
      if (Vm.some((v) => v <= 0)) return fail(n, 'A bus voltage collapsed to zero or below — no valid operating point.', it, history)
      it++
    }
    // PV reactive limits: a violated bus is held at the limit as a PQ bus, and the solution is repeated
    ;({ P, Q } = injections())
    let changed = false
    for (let i = 0; i < n; i++) {
      if (type[i] !== 'pv') continue
      const lo = buses[i].qMin
      const hi = buses[i].qMax
      if (hi !== undefined && Q[i] > hi + 1e-9) {
        type[i] = 'pq'
        qSpec[i] = hi
        qLimited.push(i)
        changed = true
      } else if (lo !== undefined && Q[i] < lo - 1e-9) {
        type[i] = 'pq'
        qSpec[i] = lo
        qLimited.push(i)
        changed = true
      }
    }
    if (!changed) break
  }
  return { ...done(), converged: true }

  function done() {
    const V = Vm.map((v, i) => polar(v, th[i]))
    const { P, Q } = injections()
    return {
      iterations: it,
      mismatch: mis,
      history,
      V,
      S: P.map((p, i) => C(p, Q[i])),
      qLimited,
    }
  }
  // ∂P_i/∂θ_k and ∂Q_i/∂θ_k
  function dTheta(i: number, k: number, isQ: boolean): number {
    if (i !== k) {
      const t = th[i] - th[k]
      const vv = Vm[i] * Vm[k]
      return isQ ? -vv * (G[i][k] * Math.cos(t) + B[i][k] * Math.sin(t)) : vv * (G[i][k] * Math.sin(t) - B[i][k] * Math.cos(t))
    }
    return isQ ? P[i] - G[i][i] * Vm[i] * Vm[i] : -Q[i] - B[i][i] * Vm[i] * Vm[i]
  }
  // |V_k|·∂P_i/∂|V_k| and |V_k|·∂Q_i/∂|V_k|
  function dV(i: number, k: number, isQ: boolean): number {
    if (i !== k) {
      const t = th[i] - th[k]
      const vv = Vm[i] * Vm[k]
      return isQ ? vv * (G[i][k] * Math.sin(t) - B[i][k] * Math.cos(t)) : vv * (G[i][k] * Math.cos(t) + B[i][k] * Math.sin(t))
    }
    return isQ ? Q[i] - B[i][i] * Vm[i] * Vm[i] : P[i] + G[i][i] * Vm[i] * Vm[i]
  }
}

function fail(n: number, error: string, iterations = 0, history: number[] = []): LfResult {
  return {
    converged: false,
    iterations,
    mismatch: Infinity,
    history,
    V: new Array(n).fill(C(0)),
    S: new Array(n).fill(C(0)),
    qLimited: [],
    error,
  }
}
