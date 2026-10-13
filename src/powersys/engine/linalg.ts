import { abs, C, div, mul, sub, ZERO, type Complex } from './complex.ts'

/**
 * Dense linear solvers for the small educational networks (a few buses): Gaussian elimination with partial
 * pivoting. A (near-)singular system returns null — callers report it; nothing is guessed.
 */

/** Solve A·x = b for real A (n×n). Returns null when A is singular (pivot below `tol` × the largest entry). */
export function solveReal(A: number[][], b: number[], tol = 1e-12): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  const big = Math.max(1e-300, ...A.flat().map(Math.abs))
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i
    if (Math.abs(M[p][k]) <= tol * big) return null
    if (p !== k) [M[p], M[k]] = [M[k], M[p]]
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k]
      if (f === 0) continue
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]
    x[i] = s / M[i][i]
  }
  return x
}

/** Solve A·x = b for complex A (n×n). Returns null when A is singular. */
export function solveComplex(A: Complex[][], b: Complex[], tol = 1e-12): Complex[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  const big = Math.max(1e-300, ...A.flat().map(abs))
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (abs(M[i][k]) > abs(M[p][k])) p = i
    if (abs(M[p][k]) <= tol * big) return null
    if (p !== k) [M[p], M[k]] = [M[k], M[p]]
    for (let i = k + 1; i < n; i++) {
      const f = div(M[i][k], M[k][k])
      if (f.re === 0 && f.im === 0) continue
      for (let j = k; j <= n; j++) M[i][j] = sub(M[i][j], mul(f, M[k][j]))
    }
  }
  const x: Complex[] = new Array(n).fill(ZERO)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]
    for (let j = i + 1; j < n; j++) s = sub(s, mul(M[i][j], x[j]))
    x[i] = div(s, M[i][i])
  }
  return x
}

/** The inverse of a complex matrix (used for a bus-impedance matrix), or null when singular. */
export function invertComplex(A: Complex[][]): Complex[][] | null {
  const n = A.length
  const cols: Complex[][] = []
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? C(1) : ZERO))
    const x = solveComplex(A, e)
    if (!x) return null
    cols.push(x)
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]))
}
