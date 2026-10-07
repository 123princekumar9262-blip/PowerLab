import { describe, expect, it } from 'vitest'
import { getExplainer } from '../src/explanations/index.ts'
import { indexAtTime, runSimulation } from '../src/simulation/engine.ts'
import { ideal, real } from './helpers.ts'

describe('WHY engine reflects the simulated state', () => {
  const r = runSimulation(real())
  const ex = getExplainer(r.circuitId)
  const T = r.params.period
  const at = (fraction: number) => ex.state(r, indexAtTime(r, fraction * T))

  it('conducting instant: ON, current path present, numbers match the sample', () => {
    const e = at(0.15)
    expect(e.diode.on).toBe(true)
    expect(e.path).toEqual(['Source (+)', 'D1', 'R', 'Source (−)'])
    expect(e.source.polarity).toBe('positive')
    expect(e.source.trend).toBe('rising')
    expect(e.current.trend).toBe('increasing')
    expect(e.headline).toMatch(/ON/)
    expect(e.chain.map((c) => c.stage)).toEqual(['source', 'condition', 'diode', 'path', 'energy', 'output', 'waveform'])
  })

  it('at the positive peak the current is reported at its peak', () => {
    expect(at(0.25).current.trend).toBe('at peak')
    expect(at(0.25).source.trend).toBe('peak')
  })

  it('after the peak the current is decreasing', () => {
    expect(at(0.4).current.trend).toBe('decreasing')
  })

  it('negative half-cycle: OFF, reverse biased, no path', () => {
    const e = at(0.7)
    expect(e.diode.on).toBe(false)
    expect(e.diode.bias).toBe('reverse')
    expect(e.path).toBeNull()
    expect(e.current.trend).toBe('zero')
    expect(e.summary).toMatch(/reverse biased/)
  })

  it('dead zone of the real diode is explained as below Vf', () => {
    // θ = 1° → Vin = 16.97·sin(1°) ≈ 0.30 V < 0.7 V
    const e = at(1 / 360)
    expect(e.diode.bias).toBe('forward-below-threshold')
    expect(e.headline).toMatch(/below Vf/)
  })

  it('explanation numbers come from the sample', () => {
    const e = at(0.15)
    expect(e.summary).toContain(e.sample.vout.toFixed(2).slice(0, 4))
  })

  it('event explanations exist for every detected event', () => {
    const ri = runSimulation(ideal())
    const exi = getExplainer(ri.circuitId)
    for (const ev of ri.events) {
      const x = exi.event(ri, ev)
      expect(x.what.length).toBeGreaterThan(10)
      expect(x.why.length).toBeGreaterThan(10)
    }
  })
})
