/**
 * Small dense matrices (row-major number[][]) and the matrix exponential, for the exact
 * solution of piecewise-linear converter equations  x' = A·x + b.
 *
 * Over an interval of length t with A, b constant:  x(t) = e^{At}·x(0) + ∫₀ᵗ e^{Aτ}dτ·b.
 * Both come from ONE exponential of the augmented matrix  M = [[A, b], [0, 0]]·t:
 *   e^M = [[e^{At}, Γ(t)·b], [0, 1]].
 * Computed by scaling and squaring with a Taylor series — accurate to ~1e-15 for these 3×3 cases.
 */
export type Mat = number[][]

export function matMul(a: Mat, b: Mat): Mat {
  const n = a.length
  const m = b[0].length
  const k = b.length
  const out: Mat = Array.from({ length: n }, () => new Array<number>(m).fill(0))
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let q = 0; q < k; q++) out[i][j] += a[i][q] * b[q][j]
  return out
}

const identity = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))

export function expm(a: Mat): Mat {
  const n = a.length
  let norm = 0
  for (const row of a) norm = Math.max(norm, row.reduce((s, v) => s + Math.abs(v), 0))
  const s = Math.max(0, Math.ceil(Math.log2(norm / 0.25)))
  const scale = 2 ** -s
  const as = a.map((row) => row.map((v) => v * scale))
  // Taylor series of e^{as}; ‖as‖ ≤ 0.25, so 18 terms reach far below double precision.
  let term = identity(n)
  let sum = identity(n)
  for (let k = 1; k <= 18; k++) {
    term = matMul(term, as).map((row) => row.map((v) => v / k))
    sum = sum.map((row, i) => row.map((v, j) => v + term[i][j]))
  }
  for (let k = 0; k < s; k++) sum = matMul(sum, sum)
  return sum
}

/** Affine flow of x' = A·x + b over time t: returns x(t) for a given x(0). */
export function affineFlow(A: Mat, b: number[], t: number): (x: number[]) => number[] {
  const n = A.length
  const M: Mat = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i < n ? (j < n ? A[i][j] * t : b[i] * t) : 0)))
  const E = expm(M)
  return (x) => Array.from({ length: n }, (_, i) => E[i].slice(0, n).reduce((s, v, j) => s + v * x[j], 0) + E[i][n])
}
