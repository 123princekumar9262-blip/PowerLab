import { describe, expect, it } from 'vitest'
import { eventSample } from '../src/converters/cursor.ts'
import { driveEventWhy } from '../src/converters/drives/content.ts'
import { simulateDrive } from '../src/converters/drives/motor.ts'
import { simulateThermal } from '../src/converters/engineering/thermal.ts'
import { simulateEv } from '../src/converters/ev/vehicle.ts'
import { invWhy, invStateAt } from '../src/converters/inverter/content.ts'
import { coreEventWhy } from '../src/converters/magnetics/content.ts'
import { simulateCore } from '../src/converters/magnetics/core.ts'
import { measure } from '../src/measurements/measurements.ts'
import { conductingOptions, reverseAnswers, type ReverseTask } from '../src/reverse/reverse.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { TOPICS as INV } from '../src/workspaces/inverters.tsx'
import { nextConsequenceOf } from '../src/workspace/useTopicWorkspace.ts'
import { TOPICS as MAG } from '../src/workspaces/magnetics.tsx'

/*
 * WHY and the events it quotes stay true to the simulation away from the default settings — the cases the
 * Phase 6 audit found wrong: each check reads the run itself.
 */
describe('events and WHY follow the simulated run', () => {
  it('EV: the cursor for "peak battery power" lands on the sample with that peak', () => {
    const r = simulateEv({})
    const e = r.events.find((x) => x.device === 'peak-power')!
    const k = eventSample(r, e)
    let max = -Infinity
    for (let i = 0; i < r.length; i++) max = Math.max(max, r.signals.pbatt[i])
    expect(r.signals.pbatt[k]).toBe(max)
  })

  it('magnetics start-up: every entry into and exit from saturation is an event, and WHY quotes the next one', () => {
    const r = simulateCore({ view: 'startup' })
    const sat = r.pwlEvents.filter((x) => x.from !== x.to)
    expect(sat.length).toBeGreaterThan(2)
    expect(r.events.filter((x) => x.kind === 'mode').length).toBe(sat.length)
    // in saturation right after the first entry: the next consequence is leaving saturation, not a later entry
    const first = r.events.find((x) => x.kind === 'mode')!
    const k = eventSample(r, first) + 2
    expect(r.modes[k]).not.toBe('lin')
    const n = nextConsequenceOf(MAG.inductor, r as never, k)!
    expect(n.text).toMatch(/^The core leaves saturation/)
  })

  it('magnetics: a bridge edge is explained as the voltage reversal, with the voltage applied from that instant', () => {
    const r = simulateCore({})
    const e = r.events.find((x) => x.kind === 'gate-off')!
    expect(e.values.v).toBeLessThan(0)
    expect(coreEventWhy(e)).toMatch(/reverses the winding voltage/)
    expect(coreEventWhy(e)).not.toMatch(/B–H curve changes slope/)
  })

  it('DC motor: the duty-step and load-step texts follow the simulated direction', () => {
    const up = simulateDrive({ view: 'startup', event: 'duty', d2: 0.9 })
    const eUp = up.events.find((x) => x.device === 'duty-step')!
    expect(driveEventWhy(eUp)).toMatch(/duty rises/)
    expect(driveEventWhy(eUp)).toMatch(/speed rises/)
    const down = simulateDrive({ view: 'startup', event: 'duty', d2: 0.3 })
    expect(driveEventWhy(down.events.find((x) => x.device === 'duty-step')!)).toMatch(/duty falls/)
    const lighter = simulateDrive({ view: 'startup', event: 'load', tl2: 0.02 })
    const eL = lighter.events.find((x) => x.device === 'load-step')!
    expect(driveEventWhy(eL)).toMatch(/Less load torque/)
    expect(driveEventWhy(eL)).toMatch(/speed rises/)
  })

  it('thermal: a constant load has no "hottest instant" event (no pulse to end)', () => {
    expect(simulateThermal({ load: 'constant' }).events.some((x) => x.device === 'tj-max')).toBe(false)
    expect(simulateThermal({ load: 'constant', view: 'startup' }).events.some((x) => x.device === 'tj-max')).toBe(false)
    expect(simulateThermal({}).events.some((x) => x.device === 'tj-max')).toBe(true)
  })

  it('inverter dead time: a conducting diode with both gates OFF is explained as dead time, not as a gated rail', () => {
    const t = INV['1ph']
    const r = t.simulate({ ...(t.defaults as object), td: 50e-6, modulation: 'square' } as never)
    const m = t.measure(r)
    let found = 0
    for (let k = 0; k < r.length && found < 3; k++) {
      const st = invStateAt(r as never, k)
      const dl = st.legs.find((l) => l.kind === 'diode')
      if (!dl || dl.gUp || dl.gLo) continue
      found++
      const card = invWhy(r as never, st, m as never).find((c) => c.id === 'diode')!
      expect(card.what).toMatch(/Both gates of leg .* are OFF \(dead time\)/)
      expect(card.what).not.toMatch(/is gated to/)
    }
    expect(found).toBeGreaterThan(0)
  })

  it('rectifier Reverse: a three-phase circuit with every device off can be answered ("none" is offered)', () => {
    const task: ReverseTask = { section: 'three', topology: '3ph-half-controlled', load: 'R', params: { ...THREE_PHASE_DEFAULTS, control: { ...THREE_PHASE_DEFAULTS.control!, device: 'scr', alphaDeg: 60 } }, probeDeg: 330 }
    const r = runSimulation(task.params, `${task.topology}:${task.load}`)
    const a = reverseAnswers(task, r, measure(r).rippleFrequency)
    expect(conductingOptions(task.topology)).toContain(a.conducting)
  })
})
