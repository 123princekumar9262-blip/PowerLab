import { describe, expect, it } from 'vitest'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { DEVICE_MAP } from '../src/explanations/threePhase.ts'
import type { CircuitId, LabParams, SimulationResult } from '../src/types/simulation.ts'

type Over = { source?: Partial<LabParams['source']>; diode?: Partial<LabParams['diode']>; load?: Partial<LabParams['load']>; threePhase?: Partial<NonNullable<LabParams['threePhase']>>; cycles?: number }
const P = (o: Over = {}): LabParams => ({
  ...THREE_PHASE_DEFAULTS,
  source: { ...THREE_PHASE_DEFAULTS.source, ...o.source },
  diode: { ...THREE_PHASE_DEFAULTS.diode, ...o.diode },
  load: { ...THREE_PHASE_DEFAULTS.load, ...o.load },
  threePhase: { ...THREE_PHASE_DEFAULTS.threePhase!, ...o.threePhase },
  sim: { ...THREE_PHASE_DEFAULTS.sim, cycles: o.cycles ?? 6 },
})
const ideal = (o: Over = {}) => P({ ...o, diode: { model: 'ideal', ...o.diode } })
const phasesAt = (r: SimulationResult, i: number) => {
  const s = r.trace.signals
  return { a: s.vin![i], b: s.vb![i], c: s.vc![i] }
}
/** Skip samples within this fraction of Vm of a phase crossing (the hand-over instant itself). */
const nearCrossing = (r: SimulationResult, i: number) => {
  const v = phasesAt(r, i)
  const xs = [v.a, v.b, v.c].sort((m, n) => n - m)
  return xs[0] - xs[1] < 1e-3 * r.params.vm || xs[1] - xs[2] < 1e-3 * r.params.vm
}

describe('Phase A — balanced three-phase source', () => {
  const r = runSimulation(ideal(), '3ph-bridge:R')
  it('1. phases are displaced by 120° (b lags a, c lags b)', () => {
    const T = r.params.period
    const peaks = (id: 'vin' | 'vb' | 'vc') => {
      const x = r.trace.signals[id]!
      for (let i = 1; i < x.length - 1; i++) if (x[i] >= x[i - 1] && x[i] > x[i + 1] && x[i] > 0) return r.trace.time[i]
      return NaN
    }
    const ta = peaks('vin')
    const tb = peaks('vb')
    const tc = peaks('vc')
    const lag = (x: number, y: number) => ((((y - x) / T) % 1) + 1) % 1 * 360
    expect(lag(ta, tb)).toBeCloseTo(120, 0)
    expect(lag(tb, tc)).toBeCloseTo(120, 0)
  })
  it('2. balanced: va + vb + vc = 0 at every instant, equal RMS, VLL = √3·Vph', () => {
    const s = r.trace.signals
    for (let i = 0; i < r.trace.length; i += 3) expect(s.vin![i] + s.vb![i] + s.vc![i]).toBeCloseTo(0, 9)
    const m = measure(r)
    expect(m.vphRms!).toBeCloseTo(12, 3)
    expect(m.vllRms! / m.vphRms!).toBeCloseTo(Math.sqrt(3), 3)
  })
  it('acb sequence: c lags a by 120° instead', () => {
    const q = runSimulation(ideal({ threePhase: { sequence: 'acb' } }), '3ph-bridge:R')
    const k = Math.round(q.params.period / 4 / q.params.dt) // θ = 90°
    expect(q.trace.signals.vc![k]).toBeCloseTo(q.params.vm * Math.sin(Math.PI / 2 - (2 * Math.PI) / 3), 6)
  })
})

describe('Phases B/C — device decision follows the instantaneous phase voltages', () => {
  for (const id of ['3ph-half-wave:R', '3ph-bridge:R', '3ph-bridge:RL', '3ph-half-wave:RL'] as CircuitId[]) {
    it(`3. ${id}: upper = highest phase, lower = lowest phase, at every sample`, () => {
      const r = runSimulation(ideal(), id)
      for (let i = 1; i < r.trace.length; i++) {
        if (nearCrossing(r, i)) continue
        const v = phasesAt(r, i)
        const hi = (['a', 'b', 'c'] as const).reduce((m, x) => (v[x] > v[m] ? x : m), 'a')
        const lo = (['a', 'b', 'c'] as const).reduce((m, x) => (v[x] < v[m] ? x : m), 'a')
        const on = sampleAt(r, i).diodes.filter((d) => d.on).map((d) => DEVICE_MAP[d.id])
        const half = id.startsWith('3ph-half-wave')
        expect(on.length).toBe(half ? 1 : 2)
        expect(on.find((d) => d.upper)!.phase).toBe(hi)
        if (!half) expect(on.find((d) => !d.upper)!.phase).toBe(lo)
      }
    })
  }

  it('4. bridge conduction sequence D1D2 → D2D3 → D3D4 → D4D5 → D5D6 → D6D1 (each diode turns on 60° after the previous)', () => {
    const r = runSimulation(ideal(), '3ph-bridge:R')
    const ons = r.events.filter((e) => e.kind === 'diode-on' && e.time > r.params.period).map((e) => e.device)
    const next: Record<string, string> = { D1: 'D2', D2: 'D3', D3: 'D4', D4: 'D5', D5: 'D6', D6: 'D1' }
    for (let k = 1; k < ons.length; k++) expect(ons[k]).toBe(next[ons[k - 1]!])
    const t = r.events.filter((e) => e.kind === 'diode-on' && e.time > r.params.period).map((e) => e.time)
    for (let k = 1; k < t.length; k++) expect(((t[k] - t[k - 1]) / r.params.period) * 360).toBeCloseTo(60, 3)
  })

  it('5. Vo = Vmax − Vmin − 2Vf (bridge) and Vmax − Vf (half-wave) — from the circuit state', () => {
    for (const id of ['3ph-bridge:R', '3ph-half-wave:R'] as CircuitId[]) {
      const r = runSimulation(P(), id)
      for (let i = 0; i < r.trace.length; i += 7) {
        const v = phasesAt(r, i)
        const mx = Math.max(v.a, v.b, v.c)
        const mn = Math.min(v.a, v.b, v.c)
        expect(r.trace.signals.vout![i]).toBeCloseTo(id === '3ph-bridge:R' ? mx - mn - 1.4 : mx - 0.7, 9)
      }
    }
  })

  it('6/7. six-pulse output: 6 crests per cycle; ripple frequency = 6f for several f', () => {
    for (const f of [50, 60, 400]) {
      const r = runSimulation(ideal({ source: { frequency: f } }), '3ph-bridge:R')
      expect(measure(r).rippleFrequency!).toBeCloseTo(6 * f, 6)
      const h = runSimulation(ideal({ source: { frequency: f } }), '3ph-half-wave:R')
      expect(measure(h).rippleFrequency!).toBeCloseTo(3 * f, 6)
    }
  })

  it('8. Vdc = 1.35·VLL (bridge) and 1.17·Vph (half-wave) for an ideal diode', () => {
    const b = measure(runSimulation(ideal(), '3ph-bridge:R'))
    expect(b.voutAvg / ((3 * Math.sqrt(3) * Math.SQRT2 * 12) / Math.PI)).toBeCloseTo(1, 4)
    expect(b.voutAvg / (Math.sqrt(3) * 12)).toBeCloseTo(1.3505, 3)
    const h = measure(runSimulation(ideal(), '3ph-half-wave:R'))
    expect(h.voutAvg / 12).toBeCloseTo(1.1695, 3)
  })

  it('9. diode current conservation: Σ upper = Σ lower = io (bridge), Σ diodes = io (half-wave)', () => {
    for (const id of ['3ph-bridge:RL', '3ph-half-wave:RL'] as CircuitId[]) {
      const r = runSimulation(P(), id)
      const io = id.includes('RL') ? (r.trace.signals.io as Float64Array) : r.trace.signals.io!
      for (let i = 0; i < r.trace.length; i += 5) {
        let up = 0
        let lo = 0
        r.trace.diodes.forEach((d) => (DEVICE_MAP[d.id].upper ? (up += d.current[i]) : (lo += d.current[i])))
        expect(up).toBeCloseTo(io[i], 9)
        if (id.startsWith('3ph-bridge')) expect(lo).toBeCloseTo(io[i], 9)
      }
    }
  })

  it('10. R load: io = Vo/R at every sample', () => {
    const r = runSimulation(P(), '3ph-bridge:R')
    for (let i = 0; i < r.trace.length; i += 5) expect(r.trace.signals.io![i]).toBeCloseTo(r.trace.signals.vout![i] / 10, 12)
  })
})

describe('Phase D — RL load', () => {
  it('11. inductor current is continuous (no jumps) and never zero in steady state; smoother than Vo', () => {
    const r = runSimulation(P(), '3ph-bridge:RL')
    const io = r.trace.signals.io!
    const maxStep = ((Math.sqrt(3) * r.params.vm) / r.params.inductance) * r.params.dt * 1.01
    for (let i = 1; i < io.length; i++) expect(Math.abs(io[i] - io[i - 1])).toBeLessThanOrEqual(maxStep)
    const m = measure(r)
    expect(m.rectCurrentMin!).toBeGreaterThan(0)
    const vRipple = m.ripplePP / m.voutAvg
    const iMax = Math.max(...Array.from(io.subarray(io.length - 2000)))
    const iMin = Math.min(...Array.from(io.subarray(io.length - 2000)))
    // The dominant ripple is the 6th harmonic (6f). The RL load attenuates the current ripple
    // relative to the voltage ripple by R/|Z(6ω)| = R/√(R² + (6ωL)²) ≈ 0.47 for 10 Ω, 10 mH.
    const w6 = 6 * r.params.omega
    const attenuation = r.params.resistance / Math.hypot(r.params.resistance, w6 * r.params.inductance)
    expect((iMax - iMin) / m.ioAvg).toBeLessThan(vRipple * attenuation)
  })
  it('larger L → smaller current ripple; Vdc unchanged (bridge output does not depend on the load)', () => {
    const a = runSimulation(P({ load: { inductance: 0.005 } }), '3ph-bridge:RL')
    const b = runSimulation(P({ load: { inductance: 0.05 } }), '3ph-bridge:RL')
    const ripple = (r: SimulationResult) => {
      const io = r.trace.signals.io!.subarray(r.trace.length - 2000)
      return Math.max(...Array.from(io)) - Math.min(...Array.from(io))
    }
    expect(ripple(b)).toBeLessThan(ripple(a) / 5)
    expect(measure(b).voutAvg).toBeCloseTo(measure(a).voutAvg, 3)
  })
})

describe('12. theory vs simulation, energy conservation, no solver fallbacks', () => {
  for (const id of ['3ph-half-wave:R', '3ph-half-wave:RL', '3ph-bridge:R', '3ph-bridge:RL'] as CircuitId[]) {
    for (const model of ['ideal', 'real'] as const) {
      it(`${id} (${model})`, () => {
        const r = runSimulation(P({ diode: { model } }), id)
        expect(r.diagnostics.solverFallbacks).toBe(0)
        const c = compareWithTheory(r)
        expect(c.measurements.steady.reached).toBe(true)
        for (const row of c.rows) expect(row.withinTolerance, `${row.key}: ${row.simulated} vs ${row.theory}`).toBe(true)
        expect(c.rows.filter((x) => x.error !== null).length).toBeGreaterThan(15)
        const m = c.measurements
        const bal = m.sourcePower - m.loadPower - m.diodeLoss - m.storedEnergyChange / r.params.period
        expect(Math.abs(bal) / m.sourcePower).toBeLessThan(5e-3)
      })
    }
  }
})
