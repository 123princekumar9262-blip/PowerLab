import { describe, expect, it } from 'vitest'
import type { AnyTopic } from '../src/lab/types.ts'
import { TOPICS as CONTROL } from '../src/workspaces/control.tsx'
import { TOPICS as DCDC } from '../src/workspaces/dcdc.tsx'
import { TOPICS as DEVICES } from '../src/workspaces/devices.tsx'
import { TOPICS as DRIVES } from '../src/workspaces/drives.tsx'
import { TOPICS as EV } from '../src/workspaces/ev.tsx'
import { TOPICS as INV } from '../src/workspaces/inverters.tsx'
import { TOPICS as MAG } from '../src/workspaces/magnetics.tsx'
import { TOPICS as PWM } from '../src/workspaces/pwm.tsx'
import { TOPICS as THERMAL } from '../src/workspaces/thermal.tsx'

/*
 * Every lesson outside the Rectifier Lab ends with a check question (the Rectifier Lab's lessons have their
 * own quizzes). The checks that state a result are confirmed by the simulation at the lesson's own settings.
 */
const LABS: Record<string, Record<string, AnyTopic>> = { DCDC, PWM, INV, DEVICES, MAG, CONTROL, DRIVES, THERMAL, EV }
const lessons: Array<[string, AnyTopic, number]> = []
for (const [lab, topics] of Object.entries(LABS)) for (const [id, t] of Object.entries(topics)) t.lessons.forEach((l, i) => lessons.push([`${lab}/${id}: ${l.title}`, t, i]))

/** The lesson's last step, simulated (the settings the check is asked at). */
function lastStep(t: AnyTopic, id: string, patch: Record<string, unknown> = {}) {
  const l = t.lessons.find((x) => x.id === id)!
  const s = l.steps[l.steps.length - 1]
  const p = { ...(t.defaults as object), ...(l.base as object), ...(s.params as object), ...patch }
  const r = t.simulate(p as never)
  return { r, m: t.measure(r) as Record<string, number>, p: r.params as Record<string, number> }
}

describe('every topic-lab lesson ends with a check question', () => {
  it('there are lessons to check', () => expect(lessons.length).toBeGreaterThanOrEqual(25))
  it.each(lessons)('%s', (_n, t, i) => {
    const c = t.lessons[i].check
    expect(c, 'missing check').toBeDefined()
    expect(c!.question.length).toBeGreaterThan(10)
    expect(c!.options).toHaveLength(3)
    expect(new Set(c!.options).size).toBe(3)
    expect(Number.isInteger(c!.answer) && c!.answer >= 0 && c!.answer < 3).toBe(true)
    expect(c!.explain.length).toBeGreaterThan(20)
  })
})

describe('the checks that state a result agree with the simulation', () => {
  it('buck DCM: Vout rises above D·Vin', () => {
    const { m, p } = lastStep(DCDC.buck, 'dcm')
    expect(m.voutAvg).toBeGreaterThan(p.duty * p.vin * 1.02)
  })
  it('boost DCM: Vout climbs above Vin/(1 − D)', () => {
    const { m, p } = lastStep(DCDC.boost, 'dcm')
    expect(m.voutAvg).toBeGreaterThan((p.vin / (1 - p.duty)) * 1.02)
  })
  it('buck-boost: the output is negative', () => {
    const { m } = lastStep(DCDC['buck-boost'], 'how')
    expect(m.voutAvg).toBeLessThan(0)
  })
  it('magnetics: doubling the air gap keeps ΔB and raises the current', () => {
    // (the lesson's last step closes the gap: compare an open gap with twice that gap, at the lesson's settings)
    const a = lastStep(MAG.inductor, 'voltsec', { lg: 0.5e-3 })
    const b = lastStep(MAG.inductor, 'voltsec', { lg: 1e-3 })
    expect(Math.abs(b.m.dB / a.m.dB - 1)).toBeLessThan(0.02)
    expect(b.m.ipk).toBeGreaterThan(1.5 * a.m.ipk)
  })
  it('PWM: halving M halves the fundamental (linear range)', () => {
    const a = lastStep(PWM.lab, 'spwm')
    const b = lastStep(PWM.lab, 'spwm', { m: a.p.m / 2 })
    expect(b.m.v1 / a.m.v1).toBeCloseTo(0.5, 2)
  })
  it('thermal: shorter pulses at the same duty shrink the junction swing', () => {
    const a = lastStep(THERMAL.switch, 'cycling', { ton: 2, toff: 2 })
    const b = lastStep(THERMAL.switch, 'cycling', { ton: 0.2, toff: 0.2 })
    expect(b.m.dTj).toBeLessThan(a.m.dTj)
  })
})
