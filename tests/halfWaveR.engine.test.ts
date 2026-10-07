import { describe, expect, it } from 'vitest'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import type { SimulationResult } from '../src/types/simulation.ts'
import { ideal, real } from './helpers.ts'

/** Visit every sample of a result. */
function forEachSample(r: SimulationResult, fn: (s: ReturnType<typeof sampleAt>) => void) {
  for (let i = 0; i < r.trace.length; i++) fn(sampleAt(r, i))
}

describe('half-wave R — ideal diode', () => {
  const r = runSimulation(ideal())

  it('1. conducts throughout the positive half-cycle', () => {
    let positive = 0
    forEachSample(r, (s) => {
      if (s.vin > 0) {
        positive++
        expect(s.diodeState).toBe('ON')
        expect(s.io).toBeGreaterThan(0)
      }
    })
    expect(positive).toBeGreaterThan(r.trace.length * 0.45)
  })

  it('2. blocks throughout the negative half-cycle', () => {
    forEachSample(r, (s) => {
      if (s.vin < 0) {
        expect(s.diodeState).toBe('OFF')
        expect(s.bias).toBe('reverse')
      }
    })
  })

  it('3/4. Vout = 0 and Io = Id = 0 whenever the diode is OFF', () => {
    forEachSample(r, (s) => {
      if (s.diodeState === 'OFF') {
        expect(s.vout).toBe(0)
        expect(s.io).toBe(0)
        expect(s.id).toBe(0)
        // The blocking diode takes the whole source voltage.
        expect(s.vd).toBeCloseTo(s.vin, 12)
      }
    })
  })

  it('5. Vout follows Vin exactly while conducting, and Io = Vout/R', () => {
    const R = r.params.resistance
    forEachSample(r, (s) => {
      if (s.diodeState === 'ON') {
        expect(s.vout).toBeCloseTo(s.vin, 12)
        expect(s.vd).toBeCloseTo(0, 12)
        expect(s.io).toBeCloseTo(s.vout / R, 12)
      }
    })
  })
})

describe('half-wave R — real diode (Vf = 0.7 V)', () => {
  const vf = 0.7
  const r = runSimulation(real({ diode: { vf } }))

  it('6. holds vD = Vf while conducting, and Vout = Vin − Vf', () => {
    let on = 0
    forEachSample(r, (s) => {
      if (s.diodeState === 'ON') {
        on++
        expect(s.vd).toBeCloseTo(vf, 12)
        expect(s.vout).toBeCloseTo(s.vin - vf, 12)
        expect(s.vin).toBeGreaterThan(vf)
      }
    })
    expect(on).toBeGreaterThan(0)
  })

  it('6b. stays OFF in the dead zone 0 < Vin ≤ Vf', () => {
    let deadZone = 0
    forEachSample(r, (s) => {
      if (s.vin > 0 && s.vin <= vf) {
        deadZone++
        expect(s.diodeState).toBe('OFF')
        expect(s.bias).toBe('forward-below-threshold')
        expect(s.io).toBe(0)
      }
    })
    expect(deadZone).toBeGreaterThan(0)
  })

  it('6c. turns on at θ1 = asin(Vf/Vm) and off at θ2 = π − θ1', () => {
    const { vm, omega } = r.params
    const theta1 = Math.asin(vf / vm)
    const firstOn = r.events.find((e) => e.kind === 'diode-on')!
    const firstOff = r.events.find((e) => e.kind === 'diode-off')!
    expect(firstOn.time * omega).toBeCloseTo(theta1, 9)
    expect(firstOff.time * omega).toBeCloseTo(Math.PI - theta1, 9)
    expect(firstOn.values.vin).toBeCloseTo(vf, 9)
  })

  it('6d. on-resistance adds an Ron·i drop and divides the output', () => {
    const ron = 2
    const rr = runSimulation(real({ diode: { vf, ron } }))
    const R = rr.params.resistance
    forEachSample(rr, (s) => {
      if (s.diodeState === 'ON') {
        expect(s.io).toBeCloseTo((s.vin - vf) / (R + ron), 12)
        expect(s.vd).toBeCloseTo(vf + ron * s.io, 12)
      }
    })
  })
})

describe('7. full-period waveform consistency', () => {
  for (const [name, r] of [
    ['ideal', runSimulation(ideal())],
    ['real', runSimulation(real())],
    ['real + Ron, phase 37°', runSimulation(real({ diode: { ron: 1.5 }, source: { phaseDeg: 37 } }))],
  ] as const) {
    it(`${name}: KVL, KCL, Ohm's law and periodicity hold at every sample`, () => {
      const R = r.params.resistance
      forEachSample(r, (s) => {
        expect(s.vin).toBeCloseTo(s.vd + s.vout, 10) // KVL around the loop
        expect(s.id).toBeCloseTo(s.io, 12) // KCL: one series loop
        expect(s.vout).toBeCloseTo(s.io * R, 10) // Ohm's law
        expect(s.io).toBeGreaterThanOrEqual(0) // a diode never conducts backwards
      })
      // Periodicity: the sample one period later is identical (memoryless circuit).
      const perPeriod = Math.round(r.params.period / r.params.dt)
      for (let i = 0; i + perPeriod < r.trace.length; i += 37) {
        const a = sampleAt(r, i)
        const b = sampleAt(r, i + perPeriod)
        expect(b.vout).toBeCloseTo(a.vout, 9)
        // Exactly at a zero crossing (|vin| ~ 1e-15 V, zero current) an ideal diode's state is
        // genuinely ambiguous — floating-point sin(2πk) lands on either side. Skip that boundary.
        if (Math.abs(a.vin) > 1e-9 * r.params.vm) expect(b.diodeState).toBe(a.diodeState)
      }
    })
  }
})

describe('diode state comes from the circuit, not from a sign test', () => {
  it('with phase shifted 90°, conduction still tracks Vin, not t', () => {
    const r = runSimulation(ideal({ source: { phaseDeg: 90 } }))
    // At t = 0 the source is at its positive peak, so the diode is ON from the start.
    expect(sampleAt(r, 0).diodeState).toBe('ON')
    expect(sampleAt(r, 0).vin).toBeCloseTo(r.params.vm, 9)
  })
})

describe('events', () => {
  const r = runSimulation(ideal())
  const T = r.params.period
  const kinds = (k: string) => r.events.filter((e) => e.kind === k)

  it('detects one of each event per cycle at the right instants', () => {
    const cycles = r.params.cycles
    expect(kinds('vin-positive-peak')).toHaveLength(cycles)
    expect(kinds('vin-negative-peak')).toHaveLength(cycles)
    kinds('vin-positive-peak').forEach((e, c) => expect(e.time).toBeCloseTo(T / 4 + c * T, 9))
    kinds('vin-negative-peak').forEach((e, c) => expect(e.time).toBeCloseTo((3 * T) / 4 + c * T, 9))
    kinds('diode-off').forEach((e, c) => expect(e.time).toBeCloseTo(T / 2 + c * T, 9))
  })

  it('diode ON/OFF and current start/stop coincide for an R load', () => {
    const on = kinds('diode-on')
    const start = kinds('current-start')
    expect(start).toHaveLength(on.length)
    start.forEach((e, i) => expect(e.time).toBeCloseTo(on[i].time, 9))
    const off = kinds('diode-off')
    const stop = kinds('current-stop')
    expect(stop).toHaveLength(off.length)
    stop.forEach((e, i) => expect(e.time).toBeCloseTo(off[i].time, 9))
  })

  it('events are sorted in time', () => {
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].time).toBeGreaterThanOrEqual(r.events[i - 1].time)
  })
})
