import { describe, expect, it } from 'vitest'
import { compareWithTheory, RELATIVE_TOLERANCE } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { ideal, real } from './helpers.ts'

describe('8. simulation agrees with closed-form theory', () => {
  it('ideal diode: Vdc = Vm/π, Vrms = Vm/2, γ = 180°', () => {
    const r = runSimulation(ideal())
    const m = measure(r)
    const vm = r.params.vm
    expect(m.voutAvg / (vm / Math.PI) - 1).toBeLessThan(1e-4)
    expect(Math.abs(m.voutRms / (vm / 2) - 1)).toBeLessThan(1e-4)
    expect(m.conductionAngleDeg).toBeCloseTo(180, 6)
    expect(m.rippleFrequency).toBeCloseTo(50, 6)
    expect(m.piv).toBeCloseTo(vm, 6)
  })

  for (const [name, p] of [
    ['ideal', ideal()],
    ['real Vf = 0.7', real()],
    ['real Vf = 0.7, Ron = 0.5 Ω', real({ diode: { ron: 0.5 } })],
    ['real, 3 V RMS (Vf is a large fraction of Vm)', real({ source: { vrms: 3 } })],
    ['ideal, 400 Hz, phase −120°', ideal({ source: { frequency: 400, phaseDeg: -120 } })],
  ] as const) {
    it(`${name}: every row within ${RELATIVE_TOLERANCE * 100}%`, () => {
      const c = compareWithTheory(runSimulation(p))
      for (const row of c.rows) {
        expect(row.simulated, row.key).not.toBeNull()
        expect(row.withinTolerance, `${row.key}: sim ${row.simulated} vs theory ${row.theory}`).toBe(true)
        // Default timestep is far better than the tolerance.
        expect(Math.abs(row.error!), row.key).toBeLessThan(1e-4)
      }
      expect(c.allWithinTolerance).toBe(true)
    })
  }

  it('flags disagreement when the timestep is too coarse', () => {
    // 16 samples/cycle — the coarsest allowed. With a half-sample phase offset (360°/32 = 11.25°)
    // no sample lands on the crest, so the sampled peak is low by 1 − cos(11.25°) ≈ 1.9 %.
    // (With φ = 0 a sample hits the crest exactly and the periodic trapezoid integrals are
    // still accurate, so the coarse run would legitimately agree with theory.)
    const r = runSimulation(real({ source: { phaseDeg: 11.25 }, sim: { timestepMode: 'manual', timestepUs: 1250 } }))
    const c = compareWithTheory(r)
    expect(c.allWithinTolerance).toBe(false)
    const peak = c.rows.find((row) => row.key === 'vinPeak')!
    expect(peak.withinTolerance).toBe(false)
    expect(peak.error!).toBeCloseTo(Math.cos((11.25 * Math.PI) / 180) - 1, 6)
  })
})

describe('changing R changes current, not the conduction pattern', () => {
  const values = [1, 10, 100, 4700]
  const runs = values.map((R) => runSimulation(real({ load: { resistance: R } })))

  it('Io scales as 1/R while Vout and conduction angle are unchanged', () => {
    const base = measure(runs[0])
    runs.forEach((r, k) => {
      const m = measure(r)
      expect(m.ioPeak * values[k]).toBeCloseTo(base.ioPeak * values[0], 9)
      expect(m.voutAvg).toBeCloseTo(base.voutAvg, 9)
      expect(m.conductionAngleDeg).toBeCloseTo(base.conductionAngleDeg, 9)
    })
  })

  it('the diode ON/OFF sequence is identical for every R', () => {
    const ref = runs[0].trace.diodes[0].on
    for (const r of runs) expect(Array.from(r.trace.diodes[0].on)).toEqual(Array.from(ref))
  })
})

describe('frequency and amplitude', () => {
  it('changing frequency changes the period of the output', () => {
    for (const f of [10, 50, 60, 1000]) {
      const r = runSimulation(ideal({ source: { frequency: f } }))
      const starts = r.events.filter((e) => e.kind === 'current-start').map((e) => e.time)
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(1 / f, 9)
      expect(measure(r).rippleFrequency).toBeCloseTo(f, 6)
    }
  })

  it('doubling Vrms doubles the ideal output exactly', () => {
    const a = measure(runSimulation(ideal({ source: { vrms: 6 } })))
    const b = measure(runSimulation(ideal({ source: { vrms: 12 } })))
    expect(b.voutAvg / a.voutAvg).toBeCloseTo(2, 9)
    expect(b.ioRms / a.ioRms).toBeCloseTo(2, 9)
  })
})
