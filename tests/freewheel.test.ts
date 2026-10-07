import { describe, expect, it } from 'vitest'
import { getModel } from '../src/circuits/registry.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { sanitizeParams } from '../src/simulation/params.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { fwParams } from './helpers.ts'

const run = (fw: boolean, over: Parameters<typeof fwParams>[1] = {}) => runSimulation(fwParams(fw, over), 'half-wave:RL')
const lastCycle = (r: ReturnType<typeof run>) => {
  const n = r.trace.length
  return { from: Math.max(0, n - 1 - Math.round(r.params.period / r.params.dt)), to: n - 1 }
}

describe('Phase 1 — freewheeling diode topology', () => {
  it('is offered only where supported; the toggle adds Dfw and its channels', () => {
    expect(sanitizeParams(fwParams(true), 'half-wave:RL').params.control.freewheel).toBe(true)
    // Center-tap and bridge accept it too; a capacitor-input (RC) filter does not.
    expect(sanitizeParams(fwParams(true), 'bridge:RL').params.control.freewheel).toBe(true)
    expect(sanitizeParams(fwParams(true), 'center-tap:RLC').params.control.freewheel).toBe(true)
    expect(sanitizeParams(fwParams(true), 'bridge:RC').params.control.freewheel).toBe(false)
    const off = run(false)
    const on = run(true)
    expect(off.diodeIds).toEqual(['D1'])
    expect(on.diodeIds).toEqual(['D1', 'Dfw'])
    expect(off.signalIds).not.toContain('ifw')
    expect(on.signalIds).toEqual(expect.arrayContaining(['ifw', 'vfw', 'wl', 'vl', 'io', 'id']))
    // Without the diode the circuit is exactly the original half-wave RL rectifier.
    expect(off.signalIds).toEqual(getModel('half-wave:RL').signals)
  })

  it('polarity: anode on the − output, cathode on the + output (vfw = −vout at every sample)', () => {
    const r = run(true)
    const { vout, vfw } = r.trace.signals
    for (let k = 0; k < r.trace.length; k += 7) expect(vfw![k]).toBeCloseTo(-vout![k], 9)
  })
})

describe('Phase 2 — diode switching', () => {
  it('every sample is self-consistent: ON ⇒ i > 0; OFF ⇒ vD ≤ Vf; no solver fallbacks', () => {
    for (const over of [{}, { model: 'ideal' as const }, { ron: 0.2 }, { L: 0.005 }, { L: 0.5 }, { R: 100 }]) {
      const r = run(true, over)
      expect(r.diagnostics.solverFallbacks).toBe(0)
      const vf = r.params.diode.vf
      for (const d of r.trace.diodes)
        for (let k = 1; k < r.trace.length; k += 3) {
          if (d.on[k]) expect(d.current[k]).toBeGreaterThan(0)
          else expect(d.voltage[k]).toBeLessThanOrEqual(vf + 1e-9)
        }
    }
  })

  it('Dfw conducts exactly when the source path cannot: Vout = −Vf while it is ON', () => {
    const r = run(true)
    const fw = r.trace.diodes[1]
    const { vout, vin } = r.trace.signals
    let seen = 0
    for (let k = 0; k < r.trace.length; k++) {
      if (!fw.on[k]) continue
      seen++
      expect(vout![k]).toBeCloseTo(-0.7, 9)
      expect(vin![k]).toBeLessThanOrEqual(1e-9) // only while the source is reversed
    }
    expect(seen).toBeGreaterThan(1000)
  })

  it('events: D1 → Dfw at vin = 0 falling and back at vin = 0 rising, each a current transfer', () => {
    const r = run(true)
    const T = r.params.period
    const angle = (t: number) => ((((t / T) * 360) % 360) + 360) % 360
    const last = r.events.filter((e) => e.time > r.params.duration - T + 1e-9)
    const fwOn = last.find((e) => e.kind === 'diode-on' && e.device === 'Dfw')!
    const d1Off = last.find((e) => e.kind === 'diode-off' && e.device === 'D1')!
    expect(angle(fwOn.time)).toBeCloseTo(180, 3)
    expect(angle(d1Off.time)).toBeCloseTo(180, 3)
    expect(last.some((e) => e.kind === 'current-transfer' && e.device === 'Dfw')).toBe(true)
    expect(last.some((e) => e.kind === 'current-transfer' && e.device === 'D1')).toBe(true)
    // The inductor energy minimum comes just after D1 takes over (the current still falls
    // while vin < Vf + R·i).
    const emin = last.find((e) => e.kind === 'energy-min')!
    expect(angle(emin.time)).toBeGreaterThan(0)
    expect(angle(emin.time)).toBeLessThan(30)
  })

  it('discontinuous case (small L, real diodes): Dfw turns OFF when the current reaches zero', () => {
    const r = run(true, { L: 0.005 })
    const last = r.events.filter((e) => e.time > r.params.duration - r.params.period)
    const off = last.find((e) => e.kind === 'diode-off' && e.device === 'Dfw')!
    expect(off).toBeTruthy()
    expect(Math.abs(off.values.io ?? 1)).toBeLessThan(1e-6)
    expect(last.some((e) => e.kind === 'current-stop')).toBe(true)
  })
})

describe('Phase 3 — RL numerical simulation', () => {
  it('KCL: io = iD1 + iDfw at every sample (the load current is the sum of the two paths)', () => {
    const r = run(true)
    const { io, id, ifw } = r.trace.signals
    for (let k = 0; k < r.trace.length; k++) expect(io![k]).toBeCloseTo(id![k] + ifw![k], 9)
  })

  it('RL equation: vout = R·i + L·di/dt (backward-Euler residual) and vL = L·di/dt', () => {
    const r = run(true)
    const { io, vout, vl } = r.trace.signals
    const { time } = r.trace
    const R = r.params.resistance
    const L = r.params.inductance
    for (let k = 1; k < r.trace.length; k += 5) {
      const didt = (io![k] - io![k - 1]) / (time[k] - time[k - 1])
      expect(vout![k]).toBeCloseTo(R * io![k] + vl![k], 9)
      // A switching instant inside the step splits it; elsewhere the discrete derivative is exact.
      if (Math.abs(vl![k] - L * didt) > 1e-6 * Math.abs(r.params.vm)) {
        const sw = r.events.some((e) => e.time > time[k - 1] && e.time < time[k] && (e.kind === 'diode-on' || e.kind === 'diode-off'))
        expect(sw).toBe(true)
      }
    }
  })

  it('inductor current is continuous — no jumps, even at switching instants', () => {
    const r = run(true)
    const io = r.trace.signals.io!
    let maxJump = 0
    for (let k = 1; k < io.length; k++) maxJump = Math.max(maxJump, Math.abs(io[k] - io[k - 1]))
    // Largest possible change in one step: |v|max/L · Δt.
    expect(maxJump).toBeLessThanOrEqual(((r.params.vm + 1) / r.params.inductance) * r.params.dt)
  })

  it('energy: E_L = ½·L·i² at every sample; energy is conserved (Σp = 0)', () => {
    const r = run(true)
    const { io, wl, ps, pload, pd, vl } = r.trace.signals
    const L = r.params.inductance
    for (let k = 0; k < r.trace.length; k += 3) {
      expect(wl![k]).toBeCloseTo(0.5 * L * io![k] ** 2, 12)
      // Tellegen: source power = R + diodes (both) + inductor
      expect(ps![k]).toBeCloseTo(pload![k] + pd![k] + vl![k] * io![k], 6)
    }
  })

  it('analytic check: during freewheeling i(t) = (i₀ + Vf/R)·e^(−t/τ) − Vf/R', () => {
    const r = run(true)
    const { from, to } = lastCycle(r)
    const fw = r.trace.diodes[1]
    const io = r.trace.signals.io!
    const t = r.trace.time
    const k0 = Array.from({ length: to - from }, (_, j) => from + j).find((k) => fw.on[k] && fw.on[k + 1] && fw.on[k + 2])!
    const tau = r.params.inductance / r.params.resistance
    const a = 0.7 / r.params.resistance
    for (let k = k0 + 50; k < to && fw.on[k]; k += 50) {
      const exact = (io[k0] + a) * Math.exp(-(t[k] - t[k0]) / tau) - a
      // Backward Euler at Δt = T/2000: first-order error ≲ 0.3 %.
      expect(Math.abs(io[k] - exact)).toBeLessThan(3e-3 * io[k0])
    }
  })

  it('theory vs simulation: every exact row within 1 % (ideal, real, small/large L, other R and f)', () => {
    for (const over of [{}, { model: 'ideal' as const }, { L: 0.005 }, { L: 0.5 }, { R: 47 }, { f: 60 }, { vf: 1.2 }]) {
      const c = compareWithTheory(run(true, { cycles: 20, ...over }))
      expect(c.measurements.steady.reached, JSON.stringify(over)).toBe(true)
      const bad = c.rows.filter((row) => !row.withinTolerance).map((row) => `${row.key}: sim ${row.simulated} th ${row.theory}`)
      expect(bad, JSON.stringify(over)).toEqual([])
      expect(c.rows.filter((row) => row.kind === 'exact' && row.error !== null).length).toBeGreaterThan(20)
    }
  })

  it('without the freewheeling diode the new ripple/energy rows also agree with theory', () => {
    const c = compareWithTheory(run(false, { cycles: 10 }))
    expect(c.rows.filter((row) => !row.withinTolerance)).toEqual([])
    expect(c.rows.find((row) => row.key === 'wlMax')!.error).not.toBeNull()
  })
})

describe('with vs without the freewheeling diode', () => {
  const off = measure(run(false))
  const on = measure(run(true))
  it('Vdc rises from R·Idc (with the negative area) to Vm/π − Vf, independent of L', () => {
    expect(on.voutAvg).toBeGreaterThan(off.voutAvg)
    expect(on.voutAvg).toBeCloseTo((Math.SQRT2 * 12) / Math.PI - 0.7, 2)
    expect(measure(run(true, { L: 0.3 })).voutAvg).toBeCloseTo(on.voutAvg, 2)
  })
  it('the output no longer swings negative: Vo,min −14.9 V → −Vf', () => {
    expect(off.voutMin).toBeLessThan(-10)
    expect(on.voutMin).toBeCloseTo(-0.7, 6)
  })
  it('D1 conduction: extinction β > 180° without, exactly 180° with (Dfw takes the rest)', () => {
    expect(off.turnOffAngleDeg!).toBeGreaterThan(200)
    expect(on.conductionAngleDeg).toBeCloseTo(180, 1)
    expect(on.fwConductionDeg!).toBeCloseTo(180, 1)
  })
  it('load current: discontinuous → continuous, and smoother (lower ripple factor)', () => {
    expect(off.ioMin).toBe(0)
    expect(on.ioMin).toBeGreaterThan(0)
    expect(on.ioRippleFactor!).toBeLessThan(off.ioRippleFactor!)
    expect(on.ioAvg).toBeGreaterThan(off.ioAvg)
  })
  it('the inductor never empties with the diode (E_L,min > 0); without it E_L,min = 0', () => {
    expect(off.wlMin).toBe(0)
    expect(on.wlMin!).toBeGreaterThan(0)
  })
})
