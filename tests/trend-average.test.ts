import { describe, expect, it } from 'vitest'
import { measureDrive, simulateDrive } from '../src/converters/drives/motor.ts'
import { nextConsequenceOf, periodWindow } from '../src/workspace/useTopicWorkspace.ts'
import { TOPICS as DRIVES } from '../src/workspaces/drives.tsx'
import { TOPICS as INV } from '../src/workspaces/inverters.tsx'

/*
 * The "until the end of the run" trend averages each quantity over one switching period. A chopped voltage jumps
 * between samples; counting each jump to a whole sample was off by a few percent (13.71 V for an exact 14.4 V).
 * The average now places the jump at the simulator's own edge time. Reference: the motor model's exact mean
 * terminal voltage over the last period, va = Ra·ī + k·ω̄ + La·Δi/T.
 */
const rectangle = (a: Float64Array, end: number, spp: number) => {
  let s = 0
  for (let i = end - spp + 1; i <= end; i++) s += a[i]
  return s / spp
}

describe('the period average of a chopped voltage', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['2Q duty step to 30 %', { view: 'startup', bridge: '2q', event: 'duty', d2: 0.3 }],
    ['1Q start-up at 60 %', { view: 'startup' }],
    ['1Q duty step to 90 %', { view: 'startup', event: 'duty', d2: 0.9 }],
  ]
  it.each(cases)('%s: the mean terminal voltage of the last period matches the exact one', (_n, o) => {
    const r = simulateDrive(o)
    const m = measureDrive(r)
    const last = r.length - 1
    const spp = Math.round(r.params.period / r.params.dt)
    const w = periodWindow(r as never, r.signals.va, last)
    expect(Math.abs(w.mean - m.vaEnd) / Math.abs(m.vaEnd)).toBeLessThan(0.002)
    // (the whole-sample count it replaces is visibly worse wherever the edges fall between samples)
    const old = Math.abs(rectangle(r.signals.va, last, spp) - m.vaEnd) / Math.abs(m.vaEnd)
    expect(Math.abs(w.mean - m.vaEnd) / Math.abs(m.vaEnd)).toBeLessThanOrEqual(old + 1e-12)
  })

  it('a smooth quantity (speed) keeps its value: the trapezoid of the samples', () => {
    const r = simulateDrive({ view: 'startup' })
    const last = r.length - 1
    const w = periodWindow(r as never, r.signals.n, last)
    expect(Math.abs(w.mean - r.signals.n[last]) / r.signals.n[last]).toBeLessThan(0.002)
  })

  it('the WHY text quotes the corrected terminal voltage', () => {
    const t = DRIVES['dc-motor']
    const r = t.simulate({ ...(t.defaults as object), view: 'startup', bridge: '2q', event: 'duty', d2: 0.3 } as never)
    const m = t.measure(r) as unknown as { vaEnd: number }
    const k = r.length - 20
    const text = nextConsequenceOf(t, r, k)!.text
    const quoted = /Armature terminal voltage (?:stays at|[^→]*→) ([\d.]+) V/.exec(text)
    expect(quoted).not.toBeNull()
    expect(Math.abs(Number(quoted![1]) - m.vaEnd) / m.vaEnd).toBeLessThan(0.005)
  })

  it('an alternating quantity in a switched-circuit run (SPWM start-up) still averages to its RMS consistently', () => {
    const t = INV.spwm
    const r = t.simulate({ ...(t.defaults as object), view: 'startup' } as never)
    const w = periodWindow(r as never, r.signals.vo, r.length - 1)
    // a bipolar ±Vdc pulse train: its RMS over a period is Vdc
    expect(w.rms / (r.params as unknown as { vdc: number }).vdc).toBeCloseTo(1, 2)
  })
})
