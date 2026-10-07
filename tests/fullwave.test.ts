import { describe, expect, it } from 'vitest'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { ideal, real } from './helpers.ts'

describe('Phase 2 — full-wave rectifiers, R load', () => {
  for (const topo of ['center-tap', 'bridge'] as const) {
    describe(topo, () => {
      const r = runSimulation(real(), `${topo}:R`)
      const vf = 0.7
      const drops = topo === 'bridge' ? 2 * vf : vf

      it('conducts on BOTH half-cycles: D1 for vin > 0, D2 for vin < 0', () => {
        let pos = 0
        let neg = 0
        for (let i = 0; i < r.trace.length; i++) {
          const s = sampleAt(r, i)
          const [d1, d2] = s.diodes
          if (s.vin > drops) {
            pos++
            expect(d1.on).toBe(true)
            expect(d2.on).toBe(false)
          }
          if (-s.vin > drops) {
            neg++
            expect(d2.on).toBe(true)
            expect(d1.on).toBe(false)
          }
        }
        expect(pos).toBeGreaterThan(1000)
        expect(neg).toBeGreaterThan(1000)
      })

      it('output is the rectified source minus the path drop: vout = |vin| − Vft when conducting', () => {
        for (let i = 0; i < r.trace.length; i += 7) {
          const s = sampleAt(r, i)
          if (Math.abs(s.vin) > drops) expect(s.vout).toBeCloseTo(Math.abs(s.vin) - drops, 9)
          else expect(s.vout).toBeCloseTo(0, 12)
          expect(s.vout).toBeGreaterThanOrEqual(-1e-12)
        }
      })

      it('ripple frequency is 2f and Vdc is twice the half-wave value', () => {
        const m = measure(r)
        expect(m.rippleFrequency).toBeCloseTo(100, 6)
        const hw = measure(runSimulation(real({ diode: { vf: drops } }), 'half-wave:R'))
        expect(m.voutAvg / hw.voutAvg).toBeCloseTo(2, 4)
      })

      it(`PIV: ${topo === 'center-tap' ? '≈ 2Vm (center-tap)' : '≈ Vm (bridge)'}`, () => {
        const ri = runSimulation(ideal(), `${topo}:R`)
        const m = measure(ri)
        expect(m.piv / ri.params.vm).toBeCloseTo(topo === 'center-tap' ? 2 : 1, 4)
      })

      it('every exact theory row agrees within 1e-4', () => {
        const c = compareWithTheory(r)
        for (const row of c.rows) if (row.error !== null) expect(Math.abs(row.error), row.key).toBeLessThan(1e-4)
      })
    })
  }

  it('bridge: D1 & D4 conduct together, D2 & D3 together — never a whole leg in an R load', () => {
    const r = runSimulation(real(), 'bridge:R')
    const [d1, d2, d3, d4] = r.trace.diodes
    for (let i = 0; i < r.trace.length; i++) {
      expect(d1.on[i]).toBe(d4.on[i])
      expect(d2.on[i]).toBe(d3.on[i])
      expect(d1.on[i] && d2.on[i]).toBeFalsy()
      if (d1.on[i]) expect(d1.current[i]).toBeCloseTo(d4.current[i], 9)
    }
  })

  it('bridge: blocking diodes share the voltage when all are OFF (symmetric reference)', () => {
    const r = runSimulation(real(), 'bridge:R')
    for (let i = 0; i < r.trace.length; i++) {
      if (r.trace.diodes.every((d) => d.on[i] === 0)) {
        const [d1, , d3] = r.trace.diodes
        // vD1 = (vin − vout)/2 and vD3 = −(vin + vout)/2 with vout = 0
        expect(d1.voltage[i]).toBeCloseTo(r.trace.signals.vin![i] / 2, 9)
        expect(d3.voltage[i]).toBeCloseTo(-r.trace.signals.vin![i] / 2, 9)
      }
    }
  })
})
