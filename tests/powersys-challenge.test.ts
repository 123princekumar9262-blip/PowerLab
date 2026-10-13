import { describe, expect, it } from 'vitest'
import { meta } from '../src/powersys/modules/challenge/meta.ts'
import { CHALLENGES } from '../src/powersys/modules/challenge/challenges.ts'
import { PEAK_CHALLENGE, RESTORE_CHALLENGE } from '../src/powersys/modules/challenge/networkChallenges.ts'

describe("Engineer's Challenge — every challenge is a real problem with a real solution", () => {
  it('each challenge is listed as an activity, with unique ids', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length)
    for (const c of CHALLENGES)
      expect(
        meta.activities.some((a) => a.id === `ch-${c.id}`),
        c.id,
      ).toBe(true)
  })
  for (const c of CHALLENGES) {
    it(`${c.title}: the starting state fails, the known solution meets every objective`, () => {
      const start = c.evaluate(c.initial)
      expect(
        start.objectives.some((o) => !o.ok),
        'the starting state must not already be solved',
      ).toBe(true)
      const end = c.evaluate(c.solution)
      expect(end.objectives.map((o) => `${o.ok ? '✓' : '✗'} ${o.label}: ${o.detail}`).filter((x) => x.startsWith('✗'))).toEqual([])
      // controls cover every state key, and values stay in range
      for (const k of c.controls) {
        expect(c.initial[k.id], `${c.id}.${k.id} initial`).toBeDefined()
        expect(c.solution[k.id], `${c.id}.${k.id} solution`).toBeDefined()
        if (k.kind === 'slider')
          for (const v of [c.initial[k.id], c.solution[k.id]]) {
            expect(Number(v)).toBeGreaterThanOrEqual(k.min)
            expect(Number(v)).toBeLessThanOrEqual(k.max)
            expect(Math.abs(Math.round((Number(v) - k.min) / k.step) * k.step + k.min - Number(v))).toBeLessThan(1e-9)
          }
      }
      expect(c.debrief(c.solution, end).length).toBeGreaterThan(0)
      expect(c.hints.length).toBeGreaterThan(0)
    })
  }
})

describe('Challenge physics', () => {
  it('evening peak: the start overloads T3; capacitors unload it, taps alone cannot', () => {
    const start = PEAK_CHALLENGE.evaluate(PEAK_CHALLENGE.initial)
    expect(start.objectives.find((o) => o.id === 'thermal')!.ok).toBe(false)
    const tapsOnly = PEAK_CHALLENGE.evaluate({ ...PEAK_CHALLENGE.initial, t2: 10, t3: -10 })
    expect(tapsOnly.objectives.find((o) => o.id === 'thermal')!.ok).toBe(false)
    const caps = PEAK_CHALLENGE.evaluate({ ...PEAK_CHALLENGE.initial, cap: 4 })
    expect(caps.diagram!.sol!.branch.T3.loadingPct!).toBeLessThan(start.diagram!.sol!.branch.T3.loadingPct!)
    expect(caps.diagram!.sol!.totals.lossMw).toBeLessThan(start.diagram!.sol!.totals.lossMw)
  })
  it('restoration: closing onto the fault is refused; L3 alone leaves the town too low; a T3 tap fixes it', () => {
    const onFault = RESTORE_CHALLENGE.evaluate({ ...RESTORE_CHALLENGE.initial, cb2: true })
    expect(onFault.alarm).toMatch(/closed CB2 onto the fault/)
    expect(onFault.objectives.every((o) => !o.ok)).toBe(true)
    const viaL3 = RESTORE_CHALLENGE.evaluate({ ...RESTORE_CHALLENGE.initial, cb5: true })
    expect(viaL3.objectives.find((o) => o.id === 'served')!.ok).toBe(true)
    expect(viaL3.objectives.find((o) => o.id === 'voltage')!.ok).toBe(false)
    expect(viaL3.diagram!.sol!.bus.lv.vPu).toBeLessThan(0.95)
  })
})
