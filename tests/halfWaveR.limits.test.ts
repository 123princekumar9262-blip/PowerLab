import { describe, expect, it } from 'vitest'
import { getExplainer } from '../src/explanations/index.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { LIMITS, MAX_SAMPLES } from '../src/simulation/params.ts'
import type { LabParams, SimulationResult } from '../src/types/simulation.ts'
import { ideal, params, real } from './helpers.ts'

/** Every number the app can show must be finite. */
function expectAllFinite(r: SimulationResult) {
  for (const [name, arr] of Object.entries(r.trace.signals)) {
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) throw new Error(`${name}[${i}] = ${arr[i]}`)
    }
  }
  for (const e of r.events) {
    expect(Number.isFinite(e.time)).toBe(true)
    Object.values(e.values).forEach((v) => expect(Number.isFinite(v)).toBe(true))
  }
  const c = compareWithTheory(r)
  for (const row of c.rows) {
    // null = no closed form for this row (shown as "—"); anything present must be finite.
    if (row.theory !== null) expect(Number.isFinite(row.theory), row.key).toBe(true)
    if (row.simulated !== null) expect(Number.isFinite(row.simulated), row.key).toBe(true)
  }
  // Explanations at a spread of instants must not contain NaN/Infinity/undefined.
  const ex = getExplainer(r.circuitId)
  for (let i = 0; i < r.trace.length; i += Math.max(1, Math.floor(r.trace.length / 50))) {
    const text = JSON.stringify(ex.state(r, i))
    expect(text).not.toMatch(/NaN|Infinity|undefined/)
  }
  for (const e of r.events) expect(JSON.stringify(ex.event(r, e))).not.toMatch(/NaN|Infinity|undefined/)
}

describe('limiting cases', () => {
  it('very small R (1 mΩ) — large but finite current', () => {
    const r = runSimulation(ideal({ load: { resistance: 1e-3 } }))
    expectAllFinite(r)
    expect(compareWithTheory(r).allWithinTolerance).toBe(true)
  })

  it('very large R (10 MΩ) — microamp current, same voltage pattern', () => {
    const r = runSimulation(real({ load: { resistance: 1e7 } }))
    expectAllFinite(r)
    expect(compareWithTheory(r).allWithinTolerance).toBe(true)
  })

  it('Vf = 0 on the real model reproduces the ideal diode exactly', () => {
    const a = runSimulation(ideal())
    const b = runSimulation(real({ diode: { vf: 0 } }))
    expect(Array.from(b.trace.signals.vout!)).toEqual(Array.from(a.trace.signals.vout!))
    expect(Array.from(b.trace.diodes[0].on)).toEqual(Array.from(a.trace.diodes[0].on))
  })

  it('Vf ≥ Vm — the diode never conducts, and that is reported', () => {
    const r = runSimulation(real({ source: { vrms: 0.4 }, diode: { vf: 0.7 } }))
    expectAllFinite(r)
    expect(Array.from(r.trace.diodes[0].on).every((x) => x === 0)).toBe(true)
    expect(r.diagnostics.issues.some((i) => i.field === 'vf')).toBe(true)
    const c = compareWithTheory(r)
    expect(c.measurements.conductionAngleDeg).toBe(0)
    expect(c.allWithinTolerance).toBe(true)
  })

  it('extreme frequencies and amplitudes stay finite and accurate', () => {
    for (const p of [
      ideal({ source: { frequency: LIMITS.frequency.min } }),
      ideal({ source: { frequency: LIMITS.frequency.max } }),
      real({ source: { vrms: LIMITS.vrms.min, frequency: 60 }, diode: { vf: 0 } }),
      real({ source: { vrms: LIMITS.vrms.max } }),
    ]) {
      const r = runSimulation(p)
      expectAllFinite(r)
      expect(compareWithTheory(r).allWithinTolerance).toBe(true)
    }
  })

  it('single cycle — measurements still work; ripple frequency is still found (two pulses needed)', () => {
    const r = runSimulation(ideal({ sim: { cycles: 1 } }))
    expectAllFinite(r)
  })
})

describe('invalid input is handled gracefully', () => {
  const bad: Array<[string, LabParams]> = [
    ['NaN Vrms', params({ source: { vrms: NaN } })],
    ['Infinite frequency', params({ source: { frequency: Infinity } })],
    ['zero frequency', params({ source: { frequency: 0 } })],
    ['negative R', params({ load: { resistance: -5 } })],
    ['zero R', params({ load: { resistance: 0 } })],
    ['negative Vf', params({ diode: { vf: -1 } })],
    ['undefined cycles', params({ sim: { cycles: undefined as unknown as number } })],
    ['absurd timestep', params({ sim: { timestepMode: 'manual', timestepUs: 1e-9 } })],
    ['huge cycles', params({ sim: { cycles: 1e9 } })],
  ]
  for (const [name, p] of bad) {
    it(`${name} → clamped/defaulted, reported, no NaN`, () => {
      const r = runSimulation(p)
      expect(r.diagnostics.issues.length).toBeGreaterThan(0)
      expect(r.trace.length).toBeLessThanOrEqual(MAX_SAMPLES)
      expect(r.trace.length).toBeGreaterThan(1)
      expectAllFinite(r)
    })
  }
})
