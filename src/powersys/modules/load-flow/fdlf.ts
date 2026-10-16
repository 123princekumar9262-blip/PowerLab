import { polar, type Complex } from '../../engine/complex.ts'
import type { BusType, LfBus } from '../../network/loadflow.ts'
import { injectionsPolar, jacobian } from './stepwise.ts'
import { activeLines, type LfCase } from './systems.ts'

/**
 * Fast decoupled load flow — the XB scheme, i.e. the original Stott–Alsaç (1974) form.
 *
 * For transmission networks (x ≫ r, small angle differences) active power depends mainly on the angles and reactive
 * power mainly on the voltage magnitudes, so the coupling blocks J2 = |V|·∂P/∂|V| and J3 = ∂Q/∂θ of the Newton
 * Jacobian are dropped, and the two remaining blocks are replaced by CONSTANT matrices:
 *
 *   ΔP/|V| = B′·Δθ        B′: built from −1/x of every branch (r ignored, no line charging, no shunts, no taps,
 *                           no phase shift), rows/columns of every non-slack bus
 *   ΔQ/|V| = B″·Δ|V|      B″ = −Im(Y_bus), rows/columns of the PQ buses (r, charging and shunts included)
 *
 * Both matrices are factorised ONCE (LU, below) and reused every iteration (B″ again only if a PV bus switches to PQ
 * at a reactive limit). One iteration = a P–θ half-iteration (θ updated) followed by a Q–V half-iteration with the
 * new angles. The mismatch is the exact AC one (the full Y_bus), so the converged answer is the Newton–Raphson
 * answer — only the path to it differs. Convergence: largest |ΔP|, |ΔQ| below `tol`, the same test as NR.
 */

// ── a small dense LU factorisation (partial pivoting), factorise once / solve many ────────────────────────────────

export interface Lu {
  n: number
  LU: number[][]
  piv: number[]
}

export function luFactor(A: number[][], tol = 1e-12): Lu | null {
  const n = A.length
  const LU = A.map((r) => [...r])
  const piv = [...Array(n).keys()]
  const big = Math.max(1e-300, ...A.flat().map(Math.abs))
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (Math.abs(LU[i][k]) > Math.abs(LU[p][k])) p = i
    if (Math.abs(LU[p][k]) <= tol * big) return null
    if (p !== k) {
      ;[LU[p], LU[k]] = [LU[k], LU[p]]
      ;[piv[p], piv[k]] = [piv[k], piv[p]]
    }
    for (let i = k + 1; i < n; i++) {
      LU[i][k] /= LU[k][k]
      const f = LU[i][k]
      if (f === 0) continue
      for (let j = k + 1; j < n; j++) LU[i][j] -= f * LU[k][j]
    }
  }
  return { n, LU, piv }
}

export function luSolve(f: Lu, b: number[]): number[] {
  const { n, LU, piv } = f
  const y = piv.map((p) => b[p])
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) y[i] -= LU[i][j] * y[j]
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) y[i] -= LU[i][j] * y[j]
    y[i] /= LU[i][i]
  }
  return y
}

// ── the constant matrices ─────────────────────────────────────────────────────────────────────────────────────

/** The full n×n B′ of a case: from −1/x of every in-service branch only (r, charging, shunts, taps, shifts ignored). */
export function bPrimeFull(c: LfCase): number[][] {
  const n = c.buses.length
  const B = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const l of activeLines(c)) {
    const s = 1 / l.x
    B[l.from][l.from] += s
    B[l.to][l.to] += s
    B[l.from][l.to] -= s
    B[l.to][l.from] -= s
  }
  return B
}

/** The full n×n B″ = −Im(Y_bus). */
export const bDoublePrimeFull = (Y: Complex[][]): number[][] => Y.map((r) => r.map((y) => -y.im))

export const sub2 = (M: number[][], idx: number[]): number[][] => idx.map((i) => idx.map((k) => M[i][k]))

// ── the iteration ─────────────────────────────────────────────────────────────────────────────────────────────

export interface FdRecord {
  /** Iterations done before this state (0 = flat start). */
  k: number
  Vm: number[]
  th: number[]
  /** Largest |ΔP| and |ΔQ| at this state [pu], and the larger of the two. */
  dPmax: number
  dQmax: number
  mismatch: number
  event?: string
}

export interface FdRun {
  converged: boolean
  iterations: number
  history: number[]
  records: FdRecord[]
  V: Complex[]
  Vm: number[]
  th: number[]
  qLimited: number[]
  types: BusType[]
  /** How many times each constant matrix was factorised (B″ again after a PV→PQ switch). */
  factorisations: { bp: number; bpp: number }
  /** The reduced matrices used (rows/columns: angIdx for B′, magIdx for B″ of the final bus types). */
  Bp: number[][]
  Bpp: number[][]
  angIdx: number[]
  magIdx: number[]
  error?: string
  /** Why it stopped, when it did not converge. At the cap: still converging (the mismatch fell by more than half over the
   * last 10 iterations) or stalled. */
  stop?: FdStop
}

/** Default iteration cap of the fast decoupled method. */
export const FD_MAX_ITER = 300

/** Why a run stopped without converging. */
export type FdStop = 'cap-converging' | 'cap-stalled' | 'diverged' | 'singular' | 'collapse' | 'setup'

export interface FdOptions {
  tol?: number
  maxIter?: number
}

/**
 * @param Y the full Y_bus (used for the exact mismatch; may include a phase shifter)
 * @param BpFull the full n×n B′ (bPrimeFull)
 * @param BppFull the full n×n B″ (bDoublePrimeFull of the Y_bus WITHOUT phase-shift angles)
 */
export function fastDecoupled(Y: Complex[][], buses: LfBus[], BpFull: number[][], BppFull: number[][], opts: FdOptions = {}): FdRun {
  const tol = opts.tol ?? 1e-8
  const maxIter = opts.maxIter ?? FD_MAX_ITER
  const n = buses.length
  const types = buses.map((b) => b.type)
  const qSpec = buses.map((b) => b.q)
  const Vm = buses.map((b) => (b.type === 'pq' ? 1 : b.v))
  const th = new Array<number>(n).fill(0)
  const records: FdRecord[] = []
  const history: number[] = []
  const qLimited: number[] = []
  const fact = { bp: 0, bpp: 0 }
  let it = 0
  const angIdx = types.map((_, i) => i).filter((i) => types[i] !== 'slack')
  let magIdx = types.map((_, i) => i).filter((i) => types[i] === 'pq')
  const result = (converged: boolean, error?: string, stop?: FdStop): FdRun => ({
    converged,
    iterations: it,
    history,
    records,
    V: Vm.map((v, i) => polar(v, th[i])),
    Vm: [...Vm],
    th: [...th],
    qLimited,
    types: [...types],
    factorisations: { ...fact },
    Bp: sub2(BpFull, angIdx),
    Bpp: sub2(BppFull, magIdx),
    angIdx,
    magIdx,
    error,
    stop,
  })
  if (types.filter((t) => t === 'slack').length !== 1) return result(false, 'A load flow needs exactly one slack (reference) bus.', 'setup')
  const fBp = luFactor(sub2(BpFull, angIdx))
  fact.bp++
  if (!fBp) return result(false, 'B′ is singular — part of the network is not connected to the slack bus.', 'singular')
  const mism = () => {
    const { P, Q } = injectionsPolar(Y, Vm, th)
    const dP = angIdx.map((i) => buses[i].p - P[i])
    const dQ = magIdx.map((i) => qSpec[i] - Q[i])
    return { dP, dQ, P, Q }
  }
  for (let pass = 0; pass < 4; pass++) {
    const fBpp = magIdx.length ? luFactor(sub2(BppFull, magIdx)) : null
    if (magIdx.length) {
      fact.bpp++
      if (!fBpp) return result(false, 'B″ is singular.', 'singular')
    }
    for (;;) {
      const { dP, dQ } = mism()
      const dPmax = Math.max(0, ...dP.map(Math.abs))
      const dQmax = Math.max(0, ...dQ.map(Math.abs))
      const mis = Math.max(dPmax, dQmax)
      records.push({ k: it, Vm: [...Vm], th: [...th], dPmax, dQmax, mismatch: mis })
      history.push(mis)
      if (!Number.isFinite(mis) || mis > 1e6) return result(false, 'The iteration diverged.', 'diverged')
      if (mis < tol) break
      if (it >= maxIter) {
        const back = history.length > 10 ? history[history.length - 11] : history[0]
        const falling = mis < 0.5 * back
        return result(
          false,
          falling
            ? `Stopped at the cap of ${maxIter} iterations while still converging slowly (largest mismatch ${mis.toExponential(2)} pu, down from ${back.toExponential(2)} pu ten iterations earlier).`
            : `No convergence in ${maxIter} iterations: the mismatch has stalled or is growing (${mis.toExponential(2)} pu, against ${back.toExponential(2)} pu ten iterations earlier).`,
          falling ? 'cap-converging' : 'cap-stalled',
        )
      }
      // P–θ half-iteration: ΔP/|V| = B′·Δθ
      const dth = luSolve(
        fBp,
        dP.map((d, j) => d / Vm[angIdx[j]]),
      )
      angIdx.forEach((i, j) => (th[i] += dth[j]))
      // Q–V half-iteration with the new angles: ΔQ/|V| = B″·Δ|V|
      if (fBpp) {
        const { dQ: dQ2 } = mism()
        const dv = luSolve(
          fBpp,
          dQ2.map((d, j) => d / Vm[magIdx[j]]),
        )
        magIdx.forEach((i, j) => (Vm[i] += dv[j]))
        if (Vm.some((v) => v <= 0)) return result(false, 'A bus voltage collapsed to zero or below.', 'collapse')
      }
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
      notes.push(`bus ${i + 1} reaches its reactive limit and becomes a PQ bus (B″ grows by one row and is factorised again)`)
      types[i] = 'pq'
      qSpec[i] = lim
      qLimited.push(i)
    }
    if (!notes.length) break
    records[records.length - 1].event = notes.join('; ')
    magIdx = types.map((_, i) => i).filter((i) => types[i] === 'pq')
  }
  return result(true)
}

// ── why decoupling is allowed: the size of the Jacobian blocks ────────────────────────────────────────────────

export interface Decoupling {
  /** Largest absolute entry of each block J1 = ∂P/∂θ, J2 = |V|∂P/∂|V|, J3 = ∂Q/∂θ, J4 = |V|∂Q/∂|V|. */
  j1: number
  j2: number
  j3: number
  j4: number
  /** max(J2, J3) / min(J1, J4). */
  ratio: number
  /** Largest r/x of the in-service lines. */
  rxMax: number
  rxMin: number
}

/** Jacobian block sizes at a solved state (polar NR Jacobian of stepwise.ts) and the network's r/x range. */
export function decoupling(c: LfCase, Y: Complex[][], Vm: number[], th: number[], types: BusType[]): Decoupling {
  const angIdx = types.map((_, i) => i).filter((i) => types[i] !== 'slack')
  const magIdx = types.map((_, i) => i).filter((i) => types[i] === 'pq')
  const J = jacobian(Y, Vm, th, angIdx, magIdx)
  const na = angIdx.length
  const blk = (r0: number, r1: number, c0: number, c1: number) => {
    let m = 0
    for (let i = r0; i < r1; i++) for (let k = c0; k < c1; k++) m = Math.max(m, Math.abs(J[i][k]))
    return m
  }
  const m = J.length
  const j1 = blk(0, na, 0, na)
  const j2 = blk(0, na, na, m)
  const j3 = blk(na, m, 0, na)
  const j4 = blk(na, m, na, m)
  const rx = activeLines(c).map((l) => l.r / l.x)
  return { j1, j2, j3, j4, ratio: Math.max(j2, j3) / Math.min(j1, j4), rxMax: Math.max(...rx), rxMin: Math.min(...rx) }
}

/**
 * A first-order bound on how far apart two solutions that both stopped at a mismatch below their tolerances can be:
 * |Δx| ≲ ‖J⁻¹‖∞ · (m₁ + m₂), in [Δθ rad; Δ|V|/|V|]. J is the NR Jacobian at the solution.
 */
export function agreementBound(Y: Complex[][], Vm: number[], th: number[], types: BusType[], m1: number, m2: number): number {
  const angIdx = types.map((_, i) => i).filter((i) => types[i] !== 'slack')
  const magIdx = types.map((_, i) => i).filter((i) => types[i] === 'pq')
  const J = jacobian(Y, Vm, th, angIdx, magIdx)
  const f = luFactor(J)
  if (!f) return Infinity
  const m = J.length
  // ‖J⁻¹‖∞ = largest row sum of |J⁻¹|; build J⁻¹ column by column
  const cols = [...Array(m).keys()].map((j) =>
    luSolve(
      f,
      [...Array(m).keys()].map((i) => (i === j ? 1 : 0)),
    ),
  )
  let norm = 0
  for (let i = 0; i < m; i++)
    norm = Math.max(
      norm,
      cols.reduce((s, col) => s + Math.abs(col[i]), 0),
    )
  return norm * (m1 + m2)
}
