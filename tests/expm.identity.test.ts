import { describe, expect, it } from 'vitest'
import { expm } from '../src/converters/expm.ts'

/*
 * expm (shared by every exact piecewise-linear solution: pwl.ts, DC-DC, control, devices, drives,
 * thermal) was rewritten without per-step allocations for speed (Phase 4). The rewrite performs the SAME
 * floating-point operations in the SAME order, so its results must be bit-identical to the original
 * implementation, frozen below as the reference.
 */
type Mat = number[][]
function refMatMul(a: Mat, b: Mat): Mat {
  const n = a.length
  const m = b[0].length
  const k = b.length
  const out: Mat = Array.from({ length: n }, () => new Array<number>(m).fill(0))
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let q = 0; q < k; q++) out[i][j] += a[i][q] * b[q][j]
  return out
}
const refIdentity = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
function refExpm(a: Mat): Mat {
  const n = a.length
  let norm = 0
  for (const row of a) norm = Math.max(norm, row.reduce((s, v) => s + Math.abs(v), 0))
  const s = Math.max(0, Math.ceil(Math.log2(norm / 0.25)))
  const scale = 2 ** -s
  const as = a.map((row) => row.map((v) => v * scale))
  let term = refIdentity(n)
  let sum = refIdentity(n)
  for (let k = 1; k <= 18; k++) {
    term = refMatMul(term, as).map((row) => row.map((v) => v / k))
    sum = sum.map((row, i) => row.map((v, j) => v + term[i][j]))
  }
  for (let k = 0; k < s; k++) sum = refMatMul(sum, sum)
  return sum
}

describe('expm is bit-identical to the original implementation', () => {
  let seed = 20261009
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  for (const n of [2, 3, 4, 5]) {
    it(`${n}×${n}: 1250 random matrices, norms 1e-4 … 1e5, zero rows, exact zeros`, () => {
      let compared = 0
      for (let c = 0; c < 1250; c++) {
        const sc = 10 ** (rnd() * 4.5 + 0.5)
        const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, () => (i === n - 1 && c % 2 === 0 ? 0 : c % 7 === 0 && rnd() > 0.5 ? 0 : rnd() * sc)))
        const a = refExpm(m)
        const b = expm(m)
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            if (!Object.is(a[i][j], b[i][j])) throw new Error(`differs at case ${c} [${i}][${j}]: ${a[i][j]} vs ${b[i][j]}`)
            compared++
          }
      }
      expect(compared).toBe(1250 * n * n)
    })
  }
  it('the zero matrix and tiny norms (no scaling) are identical too', () => {
    for (const m of [
      [
        [0, 0],
        [0, 0],
      ],
      [
        [1e-9, -2e-9, 0],
        [3e-9, 0, 1e-9],
        [0, 0, 0],
      ],
    ])
      expect(expm(m)).toStrictEqual(refExpm(m))
  })
})
