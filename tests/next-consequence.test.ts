import { describe, expect, it } from 'vitest'
import type { AnyTopic } from '../src/lab/types.ts'
import { formatTime } from '../src/utils/format.ts'
import { nextConsequenceOf, nextEvent, repeatsEveryPeriod } from '../src/workspace/useTopicWorkspace.ts'
import { TOPICS as DRIVES } from '../src/workspaces/drives.tsx'
import { TOPICS as EV } from '../src/workspaces/ev.tsx'
import { TOPICS as INV } from '../src/workspaces/inverters.tsx'
import { TOPICS as PWM } from '../src/workspaces/pwm.tsx'
import { TOPICS as DEV } from '../src/workspaces/devices.tsx'
import { TOPICS as MAG } from '../src/workspaces/magnetics.tsx'
import { TOPICS as THERMAL } from '../src/workspaces/thermal.tsx'

/*
 * WHY → "What happens next?" for the labs without their own rule. It is the run's next event; past the last
 * one, the next cycle's event (a run that repeats) or how the main waveforms move until the run ends (a run
 * that settles) — read from the simulation, never empty while the cursor is inside the run.
 */
const sim = (t: AnyTopic, patch: Record<string, unknown> = {}) => t.simulate({ ...(t.defaults as object), ...patch } as never)

describe('what happens next — never empty, always from the run', () => {
  const cases: Array<[string, AnyTopic, Record<string, unknown>]> = [
    ['DC motor start-up', DRIVES['dc-motor'], {}],
    ['DC motor steady state', DRIVES['dc-motor'], { view: 'steady' }],
    ['EV drive cycle', EV.drivetrain, {}],
    ['EV 0–100', EV.drivetrain, { cycle: 'accel' }],
    ['SVPWM inverter', INV.svpwm, {}],
    ['PWM lab', PWM.lab, {}],
    ['MOSFET double pulse', DEV.mosfet, {}],
    ['inductor start-up', MAG.inductor, { view: 'startup' }],
    ['thermal steady state', THERMAL.switch, {}],
  ]
  it.each(cases)('%s: an answer at every sampled cursor position', (_, t, patch) => {
    const r = sim(t, patch)
    for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 60))) {
      const n = nextConsequenceOf(t, r, k)
      expect(n, `k=${k}`).not.toBeNull()
      expect(n!.text).not.toMatch(/NaN|undefined|Infinity/)
      if (n!.time !== null) expect(n!.time).toBeGreaterThan(r.time[k])
    }
  })
})

describe('past the last event', () => {
  it('a start-up that settles (DC motor): the main waveforms from here to the end, from the samples', () => {
    const t = DRIVES['dc-motor']
    const r = sim(t)
    expect(repeatsEveryPeriod(t, r)).toBe(false)
    const lastEvent = r.events[r.events.length - 1]
    const k = Math.floor(r.length * 0.5)
    expect(r.time[k]).toBeGreaterThan(lastEvent.time)
    expect(nextEvent(t, r, k)).toBeNull()
    const n = nextConsequenceOf(t, r, k)!
    expect(n.text).toMatch(/^No further event in this run\. From here to its end at t = /)
    expect(n.text).toContain(formatTime(r.time[r.length - 1]))
    expect(n.time).toBe(r.time[r.length - 1])
    // the speed quoted at the end is the simulated speed averaged over the last switching period
    const spp = Math.round(r.params.period / r.params.dt)
    const a = r.signals.n
    let s = 0
    for (let i = r.length - spp; i < r.length; i++) s += a[i]
    expect(n.text).toContain(`→ ${(s / spp).toFixed(0)} rpm`)
  })

  it('0–100: after 100 km/h the run keeps accelerating — the vehicle speed rises to its value at the end', () => {
    const t = EV.drivetrain
    const r = sim(t, { cycle: 'accel' })
    const e100 = r.events.find((e: { device?: string }) => e.device === '100kmh')!
    const k = r.time.findIndex((x: number) => x > e100.time + 0.5)
    expect(nextEvent(t, r, k)).toBeNull()
    const n = nextConsequenceOf(t, r, k)!
    expect(n.text).toMatch(/Vehicle speed 1\d\d km\/h → \d+ km\/h/)
  })

  it('a periodic steady state (SVPWM): the next cycle repeats the run’s first event, one period on', () => {
    const t = INV.svpwm
    const r = sim(t)
    expect(repeatsEveryPeriod(t, r)).toBe(true)
    const k = r.length - 1
    expect(nextEvent(t, r, k)).toBeNull()
    const n = nextConsequenceOf(t, r, k)!
    const first = r.events[0]
    expect(n.text).toContain(`${t.eventLabel(first)} at t = ${formatTime(first.time + r.params.period)}, in the next cycle`)
    expect(n.time).toBeNull()
  })

  it('the very last sample of a run that settles: says it is the end, offers nothing beyond it', () => {
    const t = DRIVES['dc-motor']
    const r = sim(t)
    const n = nextConsequenceOf(t, r, r.length - 1)!
    expect(n.text).toMatch(/^This is the end of the simulated run/)
    expect(n.time).toBeNull()
  })

  it('a single test that does not repeat (MOSFET double pulse) is not treated as periodic', () => {
    const t = DEV.mosfet
    expect(repeatsEveryPeriod(t, sim(t))).toBe(false)
  })
})
