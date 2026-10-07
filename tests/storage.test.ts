import { describe, expect, it } from 'vitest'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { theoryFor } from '../src/measurements/theory/index.ts'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import type { SimulationResult } from '../src/types/simulation.ts'
import { ALL_CIRCUITS, ideal, real } from './helpers.ts'

const deg = (r: SimulationResult, t: number) => ((((r.params.omega * t + r.params.phase) * 180) / Math.PI) % 360 + 360) % 360

describe('Phase 3 — RL load', () => {
  const r = runSimulation(real({ sim: { cycles: 6 } }), 'half-wave:RL')

  it('the inductor keeps D1 conducting after vin goes negative (vout < 0)', () => {
    let negativeConduction = 0
    for (let i = 0; i < r.trace.length; i++) {
      const s = sampleAt(r, i)
      if (s.diodeState === 'ON' && s.vin < 0) {
        negativeConduction++
        expect(s.io).toBeGreaterThan(0)
        expect(s.vout).toBeLessThan(0)
      }
    }
    expect(negativeConduction).toBeGreaterThan(100)
  })

  it('the current never jumps and never goes negative', () => {
    const io = r.trace.signals.io!
    const maxStep = (r.params.vm / r.params.inductance) * r.params.dt * 1.01 // |di| ≤ (Vm/L)·Δt
    for (let i = 1; i < io.length; i++) {
      expect(io[i]).toBeGreaterThanOrEqual(0)
      expect(Math.abs(io[i] - io[i - 1])).toBeLessThanOrEqual(maxStep)
    }
  })

  it('extinction angle β matches the closed-form root of i(β) = 0 to 0.1 %', () => {
    const m = measure(r)
    const th = theoryFor(r.params).values.turnOffAngleDeg!.value
    expect(m.turnOffAngleDeg! / th - 1).toBeLessThan(1e-3)
    expect(th).toBeGreaterThan(180) // conduction extends past the zero crossing
  })

  it('larger L → later extinction and lower Vdc (more negative area)', () => {
    const a = measure(runSimulation(real({ load: { inductance: 0.01 }, sim: { cycles: 6 } }), 'half-wave:RL'))
    const b = measure(runSimulation(real({ load: { inductance: 0.2 }, sim: { cycles: 6 } }), 'half-wave:RL'))
    expect(b.turnOffAngleDeg!).toBeGreaterThan(a.turnOffAngleDeg!)
    expect(b.voutAvg).toBeLessThan(a.voutAvg)
  })

  it('full-wave RL: inductor current is continuous; diodes commutate at the zero crossing', () => {
    const f = runSimulation(ideal({ sim: { cycles: 10 } }), 'bridge:RL')
    const m = measure(f)
    expect(m.rectCurrentMin!).toBeGreaterThan(0)
    expect(m.voutAvg).toBeCloseTo((2 * f.params.vm) / Math.PI, 2)
    const offs = f.events.filter((e) => e.kind === 'diode-off' && e.device === 'D1').slice(-3)
    for (const e of offs) expect(Math.abs(deg(f, e.time) - 180)).toBeLessThan(1e-6)
  })
})

describe('Phase 4 — RC load (capacitor filter)', () => {
  const r = runSimulation(real({ sim: { cycles: 6 } }), 'half-wave:RC')

  it('the diode conducts only when the source can overcome the capacitor voltage', () => {
    for (let i = 1; i < r.trace.length; i++) {
      const s = sampleAt(r, i)
      if (s.diodeState === 'ON') expect(s.vin - 0.7).toBeGreaterThanOrEqual(s.vout - 1e-9)
      else expect(s.vin - s.vout).toBeLessThanOrEqual(0.7 + 1e-9)
    }
  })

  it('KCL at the output: diode current = iC + iR at every sample', () => {
    for (let i = 0; i < r.trace.length; i += 3) {
      const s = sampleAt(r, i)
      expect(s.id).toBeCloseTo((s.values.ic ?? 0) + s.io, 9)
    }
  })

  it('bigger C → smaller ripple, higher Vdc, shorter & taller current pulses', () => {
    const cs = [220e-6, 1000e-6, 4700e-6]
    const ms = cs.map((c) => measure(runSimulation(real({ load: { capacitance: c }, sim: { cycles: 8 } }), 'half-wave:RC')))
    for (let k = 1; k < ms.length; k++) {
      expect(ms[k].ripplePP).toBeLessThan(ms[k - 1].ripplePP)
      expect(ms[k].voutAvg).toBeGreaterThan(ms[k - 1].voutAvg)
      expect(ms[k].conductionAngleDeg).toBeLessThan(ms[k - 1].conductionAngleDeg)
      expect(ms[k].idPeak).toBeGreaterThan(ms[k - 1].idPeak)
    }
  })

  it('half-wave capacitor filter: PIV approaches 2Vm', () => {
    const m = measure(runSimulation(ideal({ load: { capacitance: 4700e-6 }, sim: { cycles: 6 } }), 'half-wave:RC'))
    expect(m.piv / (Math.SQRT2 * 12)).toBeGreaterThan(1.8)
  })

  it('textbook ripple ΔV ≈ Vpk/(fRC) is close (within 15 %) when ωRC is large', () => {
    const rr = runSimulation(real({ load: { capacitance: 4700e-6, resistance: 47 }, sim: { cycles: 8 } }), 'bridge:RC')
    const c = compareWithTheory(rr)
    const approx = c.theory.approximations.find((a) => a.key === 'ripplePP')!
    expect(Math.abs(c.measurements.ripplePP / approx.value - 1)).toBeLessThan(0.15)
  })
})

describe('Phase 5 — RLC load (choke-input filter)', () => {
  it('L > Lc: continuous inductor current and Vdc = 2Vm/π − Vft', () => {
    const r = runSimulation(real({ sim: { cycles: 14 } }), 'bridge:RLC')
    const m = measure(r)
    expect(m.rectCurrentMin!).toBeGreaterThan(0)
    expect(m.voutAvg / ((2 * r.params.vm) / Math.PI - 1.4) - 1).toBeLessThan(5e-3)
  })

  it('L ≪ Lc: the inductor current falls to zero (discontinuous)', () => {
    const r = runSimulation(real({ load: { inductance: 1e-3 }, sim: { cycles: 14 } }), 'bridge:RLC')
    expect(measure(r).rectCurrentMin!).toBeLessThanOrEqual(1e-12)
  })

  it('the LC filter output ripple is far smaller than the RC filter with the same C', () => {
    const lc = measure(runSimulation(real({ sim: { cycles: 14 } }), 'center-tap:RLC'))
    const rc = measure(runSimulation(real({ sim: { cycles: 14 } }), 'center-tap:RC'))
    expect(lc.ripplePP).toBeLessThan(rc.ripplePP / 3)
  })
})

describe('every circuit × diode model', () => {
  for (const id of ALL_CIRCUITS) {
    for (const make of [ideal, real]) {
      const r = runSimulation(make({ sim: { cycles: 14 } }), id)
      const label = `${id} (${r.params.diode.kind})`

      it(`${label}: no solver fallbacks, reaches steady state, all exact theory rows within 1 %`, () => {
        expect(r.diagnostics.solverFallbacks).toBe(0)
        const c = compareWithTheory(r)
        expect(c.measurements.steady.reached).toBe(true)
        for (const row of c.rows) expect(row.withinTolerance, `${row.key}: sim ${row.simulated} vs ${row.theory}`).toBe(true)
      })

      it(`${label}: energy is conserved — source = load + diodes + Δstored`, () => {
        const m = measure(r)
        const T = r.params.period
        const balance = m.sourcePower - m.loadPower - m.diodeLoss - m.storedEnergyChange / T
        expect(Math.abs(balance) / Math.max(m.sourcePower, 1e-9)).toBeLessThan(5e-3)
      })

      it(`${label}: diodes never conduct backwards; KVL of the source loop holds`, () => {
        for (const d of r.trace.diodes) for (let i = 0; i < r.trace.length; i++) expect(d.current[i]).toBeGreaterThanOrEqual(0)
        if (r.params.topology === 'half-wave') {
          const { vin, vd, vrect, vout } = r.trace.signals
          const vr = vrect ?? vout!
          for (let i = 0; i < r.trace.length; i += 5) expect(vin![i]).toBeCloseTo(vd![i] + vr[i], 9)
        }
      })
    }
  }
})
