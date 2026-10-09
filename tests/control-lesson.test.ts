import { describe, expect, it } from 'vitest'
import { gainStepText, loopAt } from '../src/converters/control/content.ts'
import { TOPICS } from '../src/workspaces/control.tsx'

/*
 * Control lesson "Reference step and the phase margin", step 2 "Too much gain". The explanation must give the
 * cause the model shows: the buck overshoots (low margin) but is stable; the boost is stable at its starting
 * point and unstable at the operating point after the reference step (its gain grows with the duty).
 */
function tooMuchGain(kind: 'buck' | 'boost') {
  const t = TOPICS[kind]
  const l = t.lessons.find((x) => x.id === 'step')!
  const s = l.steps[1]
  const r = t.simulate({ ...(t.defaults as object), ...(l.base as object), ...(s.params as object) } as never) as never as Parameters<typeof gainStepText>[0]
  const m = t.measure(r as never) as never as Parameters<typeof gainStepText>[1]
  return { r, m, text: gainStepText(r, m), look: s.look }
}

describe('Control lesson "Too much gain": the cause the model shows', () => {
  it('boost: stable at the start (good margin), unstable after the reference step — said so, not blamed on the starting margin', () => {
    const { r, m, text, look } = tooMuchGain('boost')
    const a = loopAt(r.params, 0)
    const b = loopAt(r.params, r.params.duration)
    expect(a.rho).toBeLessThan(1)
    expect(a.lg.pm!).toBeGreaterThan(45)
    expect(b.rho).toBeGreaterThanOrEqual(1)
    expect(b.vref).toBeGreaterThan(a.vref)
    expect(r.rho).toBeGreaterThanOrEqual(1) // the badge reads UNSTABLE
    expect(m.stable).toBe(false) // and the simulated output never settles
    expect(text).toMatch(/UNSTABLE at the new operating point/)
    expect(text).toMatch(/not just slow/)
    expect(text).not.toMatch(/less phase to spare/)
    expect(look).toMatch(/UNSTABLE/)
  })
  it('buck: low margin means overshoot and ringing, but the loop is stable and settles', () => {
    const { r, m, text } = tooMuchGain('buck')
    expect(r.rho).toBeLessThan(1) // the badge reads STABLE
    expect(m.stable).toBe(true)
    expect(m.overshoot!).toBeGreaterThan(0.2)
    expect(text).toMatch(/stable\)/)
    expect(text).not.toMatch(/UNSTABLE/)
  })
  it('the first step (well damped) is stable for both', () => {
    for (const kind of ['buck', 'boost'] as const) {
      const t = TOPICS[kind]
      const l = t.lessons.find((x) => x.id === 'step')!
      const r = t.simulate({ ...(t.defaults as object), ...(l.base as object), ...(l.steps[0].params as object) } as never) as never as { rho: number }
      expect(r.rho).toBeLessThan(1)
    }
  })
})
