import { describe, expect, it } from 'vitest'
import { getExplainer } from '../src/explanations/index.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import type { LabParams } from '../src/types/simulation.ts'
import { ALL_CIRCUITS, real } from './helpers.ts'

const EXTREMES: Array<[string, LabParams]> = [
  ['L = 1 µH (τ ≪ Δt)', real({ load: { inductance: 1e-6 } })],
  ['L = 10 H', real({ load: { inductance: 10 } })],
  ['C = 1 nF', real({ load: { capacitance: 1e-9 } })],
  ['C = 0.1 F', real({ load: { capacitance: 0.1 } })],
  ['R = 1 mΩ', real({ load: { resistance: 1e-3 } })],
  ['R = 10 MΩ', real({ load: { resistance: 1e7 } })],
  ['Vf ≥ Vm', real({ source: { vrms: 0.4 } })],
  ['1 kHz, φ = 90° (inrush at t = 0)', real({ source: { frequency: 1000, phaseDeg: 90 } })],
  ['NaN L and C', real({ load: { inductance: NaN, capacitance: NaN } })],
]

describe('limiting cases on every circuit: finite, explainable, never crashing', () => {
  for (const id of ALL_CIRCUITS) {
    for (const [name, p] of EXTREMES) {
      it(`${id} · ${name}`, () => {
        const r = runSimulation(p, id)
        for (const [sid, arr] of Object.entries(r.trace.signals)) {
          for (let i = 0; i < arr!.length; i++) if (!Number.isFinite(arr![i])) throw new Error(`${sid}[${i}] = ${arr![i]}`)
        }
        for (const d of r.trace.diodes) for (let i = 0; i < r.trace.length; i += 11) expect(Number.isFinite(d.voltage[i]) && Number.isFinite(d.current[i])).toBe(true)
        const c = compareWithTheory(r)
        for (const row of c.rows) {
          if (row.theory !== null) expect(Number.isFinite(row.theory), row.key).toBe(true)
          if (row.simulated !== null) expect(Number.isFinite(row.simulated), row.key).toBe(true)
        }
        const ex = getExplainer(r.circuitId)
        for (let i = 0; i < r.trace.length; i += Math.floor(r.trace.length / 25)) {
          expect(JSON.stringify(ex.state(r, i))).not.toMatch(/NaN|Infinity|undefined/)
        }
        for (const e of r.events.slice(0, 30)) expect(JSON.stringify(ex.event(r, e))).not.toMatch(/NaN|Infinity|undefined/)
        // Solver fallbacks must stay a rare boundary effect, not a mode of operation.
        expect(r.diagnostics.solverFallbacks).toBeLessThan(5)
      })
    }
  }
})
