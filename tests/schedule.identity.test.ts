import { describe, expect, it } from 'vitest'
import { complementaryPair, periodicSchedule } from '../src/converters/schedule.ts'

/** The original edgesIn: every edge of every candidate period, tested one by one. */
function reference(edges: ReadonlyArray<{ t: number; rising: boolean }>, period: number, a: number, b: number) {
  const out: Array<{ t: number; rising: boolean }> = []
  if (!edges.length) return out
  const m0 = Math.floor(a / period) - 1
  const m1 = Math.ceil(b / period) + 1
  for (let m = m0; m <= m1; m++)
    for (const e of edges) {
      const t = m * period + e.t
      if (t > a && t <= b) out.push({ t, rising: e.rising })
    }
  return out
}

// deterministic pseudo-random numbers (the test must not depend on the run)
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

describe('gate schedule edgesIn (binary search) is identical to testing every edge', () => {
  it('random schedules and windows, including windows on and around edges', () => {
    const r = rng(7)
    for (let n = 0; n < 60; n++) {
      const period = [1 / 50, 1 / 2000, 1e-5, 0.37][n % 4]
      const count = 1 + Math.floor(r() * 40)
      const raw = Array.from({ length: count }, (_, i) => ({ t: r() * period * 1.5 - period * 0.2, rising: i % 2 === 0 }))
      const s = periodicSchedule('g', period, raw)
      for (let w = 0; w < 200; w++) {
        const a = (r() * 6 - 1) * period
        const len = [r() * period * 0.01, r() * period, r() * period * 3, 0][w % 4]
        let b = a + len
        let aa = a
        // windows that start or end exactly on an edge, and the engine's ±ε windows
        if (w % 7 === 0 && s.edges.length) aa = Math.floor(r() * 4) * period + s.edges[Math.floor(r() * s.edges.length)].t
        if (w % 11 === 0 && s.edges.length) b = aa + period * 1e-9
        expect(s.edgesIn(aa, b)).toEqual(reference(s.edges, period, aa, b))
      }
    }
  })
  it('complementary pairs with dead time (the inverter legs)', () => {
    const period = 1 / 50
    const cmd = Array.from({ length: 30 }, (_, i) => ({ t: (i * period) / 30 + 1e-7 * (i % 3), rising: i % 2 === 0 }))
    for (const s of complementaryPair('u', 'l', period, cmd, 2e-6))
      for (let k = 0; k < 3000; k++) {
        const a = (k * period) / 1000 - period * 0.5
        expect(s.edgesIn(a, a + period / 1000)).toEqual(reference(s.edges, period, a, a + period / 1000))
      }
  })
})
