import { cost, ic, itlOf, lossOf, type Unit } from './dispatch.ts'

/**
 * An independent second method for the dispatch with losses: Newton's method on the whole Lagrangian
 *   ℒ = Σ C_i(P_i) − λ (Σ P_i − P_D − P_L(P)),
 * solving the n + 1 equations  b_i + 2c_i P_i − λ(1 − 2Σ_j B_ij P_j) = 0  and  Σ P_i − P_D − PᵀBP = 0  together,
 * with an active set for the limits (a unit that would break a limit is fixed there; it is released again if its
 * multiplier has the wrong sign). It shares no code path with the λ-iteration in dispatch.ts.
 */
export function newtonLagrangian(units: Unit[], demand: number, B: number[][] | null, opts: { maxIter?: number } = {}) {
  const idx = units.map((u, i) => (u.on ? i : -1)).filter((i) => i >= 0)
  const Bm = B ?? units.map(() => units.map(() => 0))
  const P = units.map((u) => (u.on ? Math.min(u.pMax, Math.max(u.pMin, demand / idx.length)) : 0))
  const fixed = new Map<number, number>() // unit → its limit
  let lambda = idx.reduce((s, i) => s + ic(units[i], P[i]), 0) / idx.length
  let iters = 0
  for (let outer = 0; outer < 20; outer++) {
    const free = idx.filter((i) => !fixed.has(i))
    for (const [i, v] of fixed) P[i] = v
    for (let it = 0; it < (opts.maxIter ?? 100); it++) {
      iters++
      const m = free.length
      // unknowns: P_free (m) and λ
      const F: number[] = []
      const J: number[][] = []
      const BP = (i: number) => Bm[i].reduce((s, bij, j) => s + bij * P[j], 0)
      free.forEach((i) => {
        const u = units[i]
        F.push(u.b + 2 * u.c * P[i] - lambda * (1 - 2 * BP(i)))
        const row = free.map((j) => (i === j ? 2 * u.c : 0) + 2 * lambda * Bm[i][j])
        row.push(-(1 - 2 * BP(i)))
        J.push(row)
      })
      const sumP = idx.reduce((s, i) => s + P[i], 0)
      F.push(sumP - demand - lossOf(P, Bm))
      const last = free.map((j) => 1 - 2 * BP(j))
      last.push(0)
      J.push(last)
      const dx = solve(
        J,
        F.map((x) => -x),
      )
      if (!dx) return null
      free.forEach((i, k) => (P[i] += dx[k]))
      lambda += dx[m]
      if (Math.max(...dx.map(Math.abs)) < 1e-12 && Math.max(...F.map(Math.abs)) < 1e-10) break
    }
    // active-set update, one unit at a time: fix the worst limit violation; otherwise release the fixed unit whose
    // multiplier has the wrong sign (at P_max it must be no dearer than λ, at P_min no cheaper)
    let changed = false
    let worst = -1
    let by = 1e-9
    for (const i of free) {
      const u = units[i]
      const v = Math.max(P[i] - u.pMax, u.pMin - P[i])
      if (v > by) {
        by = v
        worst = i
      }
    }
    if (worst >= 0) {
      const u = units[worst]
      fixed.set(worst, P[worst] > u.pMax ? u.pMax : u.pMin)
      changed = true
    } else {
      const itl = itlOf(P, Bm)
      for (const [i, v] of fixed) {
        const u = units[i]
        const eff = ic(u, v) / (1 - itl[i])
        if ((v === u.pMax && eff > lambda + 1e-9) || (v === u.pMin && eff < lambda - 1e-9)) {
          fixed.delete(i)
          changed = true
          break
        }
      }
    }
    if (fixed.size === idx.length) return null
    if (!changed) break
  }
  const total = idx.reduce((s, i) => s + cost(units[i], P[i]), 0)
  return { P, lambda, loss: lossOf(P, Bm), total, iters }
}

/** Gaussian elimination with partial pivoting (small dense systems). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-300) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}
