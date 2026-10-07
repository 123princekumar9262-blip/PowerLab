import { describe, expect, it } from 'vitest'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { DEVICE_MAP } from '../src/explanations/threePhase.ts'
import type { CircuitId, FaultSpec, LabParams } from '../src/types/simulation.ts'

type Over = {
  diode?: Partial<LabParams['diode']>
  load?: Partial<LabParams['load']>
  threePhase?: Partial<NonNullable<LabParams['threePhase']>>
  control?: Partial<NonNullable<LabParams['control']>>
  faults?: FaultSpec
  cycles?: number
}
const P = (o: Over = {}): LabParams => ({
  ...THREE_PHASE_DEFAULTS,
  diode: { ...THREE_PHASE_DEFAULTS.diode, model: 'ideal', ...o.diode },
  load: { ...THREE_PHASE_DEFAULTS.load, ...o.load },
  threePhase: { ...THREE_PHASE_DEFAULTS.threePhase!, ...o.threePhase },
  control: { ...THREE_PHASE_DEFAULTS.control!, ...o.control },
  faults: o.faults ?? {},
  sim: { ...THREE_PHASE_DEFAULTS.sim, cycles: o.cycles ?? 10 },
})
const V0 = (3 * Math.sqrt(3) * Math.SQRT2 * 12) / Math.PI // 1.35·VLL for 12 V phase
const exactRowsAgree = (id: CircuitId, o: Over) => {
  const r = runSimulation(P(o), id)
  const c = compareWithTheory(r)
  expect(r.diagnostics.solverFallbacks).toBeLessThan(5)
  for (const row of c.rows) expect(row.withinTolerance, `${row.key}: ${row.simulated} vs ${row.theory}`).toBe(true)
  return c
}

describe('Phase I — SCR controlled rectifiers', () => {
  for (const a of [0, 30, 60]) {
    it(`fully controlled bridge, highly inductive load: Vdc = 1.35·VLL·cos α at α = ${a}°`, () => {
      const c = exactRowsAgree('3ph-bridge:RL', { control: { device: 'scr', alphaDeg: a }, load: { inductance: 0.1 } })
      expect(c.measurements.voutAvg / (V0 * Math.cos((a * Math.PI) / 180))).toBeCloseTo(1, 2)
      expect(c.measurements.rippleFrequency!).toBeCloseTo(300, 6)
    })
  }
  for (const a of [30, 90, 120]) {
    it(`fully controlled bridge, R load at α = ${a}° (discontinuous above 60°): matches theory`, () => {
      exactRowsAgree('3ph-bridge:R', { control: { device: 'scr', alphaDeg: a } })
    })
  }
  it('3-pulse controlled and half-controlled bridge match theory (R load)', () => {
    for (const a of [15, 45, 90]) exactRowsAgree('3ph-half-wave:R', { control: { device: 'scr', alphaDeg: a } })
    for (const a of [30, 90, 150]) exactRowsAgree('3ph-half-controlled:R', { control: { alphaDeg: a } })
  })
  it('an SCR only turns on while its gate pulse is applied, at α after its natural point', () => {
    const r = runSimulation(P({ control: { device: 'scr', alphaDeg: 40 } }), '3ph-bridge:R')
    const ons = r.events.filter((e) => e.kind === 'diode-on' && e.device === 'D1' && e.time > r.params.period)
    for (const e of ons) {
      const θ = (((r.params.omega * e.time * 180) / Math.PI) % 360 + 360) % 360
      expect(θ).toBeCloseTo(30 + 40, 1)
    }
    const g = r.trace.diodes[0].gate!
    for (let i = 1; i < r.trace.length; i++) if (r.trace.diodes[0].on[i] && !r.trace.diodes[0].on[i - 1]) expect(g[i]).toBe(1)
  })
  it('α = 90° with a large L: average output ≈ 0 (rectifier on the edge of inversion)', () => {
    const r = runSimulation(P({ control: { device: 'scr', alphaDeg: 90 }, load: { inductance: 0.5 }, cycles: 16 }), '3ph-bridge:RL')
    expect(Math.abs(measure(r).voutAvg)).toBeLessThan(0.05 * V0)
  })
  it('freewheeling diode clamps Vo at −Vf and raises Vdc (α = 90°, RL)', () => {
    const without = measure(runSimulation(P({ control: { device: 'scr', alphaDeg: 90 }, load: { inductance: 0.1 } }), '3ph-bridge:RL'))
    const c = exactRowsAgree('3ph-bridge:RL', { control: { device: 'scr', alphaDeg: 90, freewheel: true }, load: { inductance: 0.1 } })
    expect(c.measurements.voutMin).toBeGreaterThanOrEqual(-1e-9)
    expect(c.measurements.voutAvg).toBeGreaterThan(without.voutAvg + 1)
  })
})

describe('Phase I — source inductance and filters', () => {
  it('commutation overlap: three devices conduct briefly; Vdc ≈ Vdc0/(1 + 3ωLs/(πR))', () => {
    const r = runSimulation(P({ threePhase: { ls: 0.001 }, load: { inductance: 0.05 } }), '3ph-bridge:RL')
    let overlap = 0
    for (let i = 0; i < r.trace.length; i++) if (r.trace.diodes.filter((d) => d.on[i]).length === 3) overlap++
    expect(overlap).toBeGreaterThan(0)
    const c = compareWithTheory(r)
    const approx = c.theory.approximations.find((a) => a.label.includes('source impedance'))!
    expect(c.measurements.voutAvg / approx.value).toBeCloseTo(1, 2)
  })
  it('RC and RLC filters: no solver fallbacks, energy conserved, ripple at 6f', () => {
    for (const id of ['3ph-bridge:RC', '3ph-bridge:RLC', '3ph-half-wave:RC'] as CircuitId[]) {
      const r = runSimulation(P({ cycles: 14 }), id)
      expect(r.diagnostics.solverFallbacks).toBeLessThan(5)
      const m = measure(r)
      const bal = m.sourcePower - m.loadPower - m.diodeLoss - m.storedEnergyChange / r.params.period
      expect(Math.abs(bal) / m.sourcePower).toBeLessThan(5e-3)
      expect(m.rippleFrequency!).toBeCloseTo(id.startsWith('3ph-half') ? 150 : 300, 6)
    }
  })
})

describe('Phase H — faults change the waveform in the physically expected way', () => {
  const healthy = measure(runSimulation(P(), '3ph-bridge:R'))
  it('one diode open: that device never conducts, two of the six pulses are lost (output repeats once per cycle)', () => {
    const r = runSimulation(P({ faults: { diode: { id: 'D1', kind: 'open' } } }), '3ph-bridge:R')
    expect(Array.from(r.trace.diodes[0].on).every((x) => x === 0)).toBe(true)
    const m = measure(r)
    expect(m.voutAvg).toBeLessThan(healthy.voutAvg)
    expect(m.rippleFrequency!).toBeCloseTo(50, 6)
  })
  it('one diode shorted (with Rs): phase-to-phase fault current through it in both directions', () => {
    const r = runSimulation(P({ faults: { diode: { id: 'D1', kind: 'short' } }, threePhase: { rs: 0.5 } }), '3ph-bridge:R')
    const i = Array.from(r.trace.diodes[0].current)
    expect(Math.min(...i)).toBeLessThan(-1) // reverse current: impossible for a healthy diode
    expect(Math.max(...i.map(Math.abs))).toBeGreaterThan(healthy.ioPeak * 2)
  })
  it('missing phase: the bridge degenerates to a single-phase bridge (2 pulses per cycle)', () => {
    const r = runSimulation(P({ faults: { missingPhase: 'c' } }), '3ph-bridge:R')
    const m = measure(r)
    expect(m.rippleFrequency!).toBeCloseTo(100, 6)
    for (const id of ['D5', 'D2']) expect(Array.from(r.trace.diodes[r.diodeIds.indexOf(id as never)].on).every((x) => x === 0)).toBe(true)
  })
  it('imbalance: the lower-amplitude phase loses part of its conduction; Vdc falls', () => {
    const r = runSimulation(P({ faults: { imbalance: { phase: 'b', scale: 0.8 } } }), '3ph-bridge:R')
    const m = measure(r)
    expect(m.voutAvg).toBeLessThan(healthy.voutAvg)
    const onB = Array.from(r.trace.diodes[r.diodeIds.indexOf('D3' as never)].on).reduce((a, b) => a + b, 0)
    const onA = Array.from(r.trace.diodes[0].on).reduce((a, b) => a + b, 0)
    expect(onB).toBeLessThan(onA)
  })
  it('unequal Vf: the high-Vf diode drops more voltage while it conducts', () => {
    const r = runSimulation(P({ diode: { model: 'real' }, faults: { vfOverride: { id: 'D3', vf: 1.5 } } }), '3ph-bridge:R')
    const k = r.diodeIds.indexOf('D3' as never)
    for (let i = 0; i < r.trace.length; i += 17) if (r.trace.diodes[k].on[i]) expect(r.trace.diodes[k].voltage[i]).toBeCloseTo(1.5, 9)
  })
  it('acb sequence: output unchanged, conduction order reversed', () => {
    const r = runSimulation(P({ threePhase: { sequence: 'acb' } }), '3ph-bridge:R')
    expect(measure(r).voutAvg).toBeCloseTo(healthy.voutAvg, 6)
    const ons = r.events.filter((e) => e.kind === 'diode-on' && e.time > r.params.period).map((e) => e.device)
    const prev: Record<string, string> = { D1: 'D6', D2: 'D1', D3: 'D2', D4: 'D3', D5: 'D4', D6: 'D5' }
    for (let k = 1; k < ons.length; k++) expect(ons[k]).toBe(prev[ons[k - 1]!])
  })
  it('every fault still obeys KCL at the rails (Σ upper = Σ lower = io)', () => {
    for (const faults of [{ diode: { id: 'D1' as const, kind: 'open' as const } }, { missingPhase: 'b' as const }, { imbalance: { phase: 'a' as const, scale: 1.3 } }]) {
      const r = runSimulation(P({ faults }), '3ph-bridge:R')
      for (let i = 0; i < r.trace.length; i += 9) {
        let up = 0
        let lo = 0
        sampleAt(r, i).diodes.forEach((d) => (DEVICE_MAP[d.id].upper ? (up += d.current) : (lo += d.current)))
        expect(up).toBeCloseTo(r.trace.signals.io![i], 6)
        expect(lo).toBeCloseTo(r.trace.signals.io![i], 6)
      }
    }
  })
})
