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

export function expm(a: Mat): Mat {
  // Flat Float64Arrays and no per-step allocation (≈ 8× faster), with the SAME floating-point operations
  // in the SAME order as the original array-of-arrays version: results are bit-identical
  // (tests/expm.identity.test.ts keeps the original as the reference).
  const n = a.length
  let norm = 0
  for (const row of a) {
    let r = 0
    for (let j = 0; j < n; j++) r = r + Math.abs(row[j])
    norm = Math.max(norm, r)
  }
  const s = Math.max(0, Math.ceil(Math.log2(norm / 0.25)))
  const scale = 2 ** -s
  const nn = n * n
  const as = new Float64Array(nn)
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) as[i * n + j] = a[i][j] * scale
  // Taylor series of e^{as}; ‖as‖ ≤ 0.25, so 18 terms reach far below double precision.
  let term = new Float64Array(nn)
  let sum = new Float64Array(nn)
  let tmp = new Float64Array(nn)
  for (let i = 0; i < n; i++) term[i * n + i] = sum[i * n + i] = 1
  for (let k = 1; k <= 18; k++) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let acc = 0
        for (let q = 0; q < n; q++) acc += term[i * n + q] * as[q * n + j]
        tmp[i * n + j] = acc / k
      }
    const t = term
    term = tmp
    tmp = t
    for (let x = 0; x < nn; x++) sum[x] = sum[x] + term[x]
  }
  for (let k = 0; k < s; k++) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let acc = 0
        for (let q = 0; q < n; q++) acc += sum[i * n + q] * sum[q * n + j]
        tmp[i * n + j] = acc
      }
    const t = sum
    sum = tmp
    tmp = t
  }
  return Array.from({ length: n }, (_, i) => Array.from(sum.subarray(i * n, i * n + n)))
}

/** Affine flow of x' = A·x + b over time t: returns x(t) for a given x(0). */
export function affineFlow(A: Mat, b: number[], t: number): (x: number[]) => number[] {
  const n = A.length
  const M: Mat = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i < n ? (j < n ? A[i][j] * t : b[i] * t) : 0)))
  const E = expm(M)
  return (x) => Array.from({ length: n }, (_, i) => E[i].slice(0, n).reduce((s, v, j) => s + v * x[j], 0) + E[i][n])
}
