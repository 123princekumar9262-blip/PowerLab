/*
 * The data of the practice questions, kept in one place so the tests can check it is physical: every line has
 * LC ≥ μ₀ε₀ (no wave faster than light) and every velocity is at most c.
 */
export const PRACTICE = {
  /** A lossless overhead line: L in mH/km, C in nF/km (v = 1/√(LC) ≈ 296 m/µs, below c). */
  line: { lMhKm: 1.2, cNfKm: 9.5 },
  /** The separation-distance question: v in m/µs (below c), d in m, S in kV/µs, V_res in kV. */
  sep: { zc: 400, v: 280, dM: 14, s: 1000, ekv: 5000, vres: 650 },
} as const
