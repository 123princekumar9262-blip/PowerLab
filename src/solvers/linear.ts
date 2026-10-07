/**
 * Dense linear solve A·x = b by Gaussian elimination with partial pivoting.
 * The circuit matrices here are tiny (≤ ~14 unknowns), so dense is the right tool.
 *
 * Returns null when the matrix is singular. In circuit terms that means the
 * assumed diode combination is physically impossible — e.g. two ideal voltage
 * sources forced in parallel with different values (a bridge with all four
 * ideal diodes ON while vin ≠ 0). The diode solver treats that as "inconsistent".
 */
export function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  // Scale for the singularity test: largest coefficient magnitude.
  let scale = 0
  for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.abs(A[i]))
  if (scale === 0) return null
  const tiny = scale * 1e-14

  for (let col = 0; col < n; col++) {
    let piv = col
    let best = Math.abs(A[col * n + col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col])
      if (v > best) {
        best = v
        piv = r
      }
    }
    if (best < tiny) return null
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = A[col * n + c]
        A[col * n + c] = A[piv * n + c]
        A[piv * n + c] = t
      }
      const t = b[col]
      b[col] = b[piv]
      b[piv] = t
    }
    const d = A[col * n + col]
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c]
      b[r] -= f * b[col]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c]
    x[r] = s / A[r * n + r]
    if (!Number.isFinite(x[r])) return null
  }
  return x
}
