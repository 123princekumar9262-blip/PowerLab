import { describe, expect, it } from 'vitest'
import { esrRipple, rippleNote } from '../src/converters/dcdc/explain.ts'
import type { AnyTopic } from '../src/lab/types.ts'
import { TOPICS as DCDC } from '../src/workspaces/dcdc.tsx'

/*
 * DC-DC output ripple texts with and without capacitor ESR. Without ESR the ripple is the capacitor's own
 * (∝ 1/C); with ESR a step ESR·ΔiC adds a part that no capacitance changes. The texts must say what the
 * simulation shows for the actual parameters.
 */
const run = (t: AnyTopic, patch: Record<string, unknown>) => {
  const p = { ...(t.defaults as object), view: 'steady', ...patch }
  return { p: p as unknown as Record<string, number>, m: t.measure(t.simulate(p as never)) as Record<string, number> }
}
const exp = (t: AnyTopic, id: string) => t.experiments.find((e) => e.id === id)!
const runExp = (t: AnyTopic, id: string, patch: Record<string, unknown>) => {
  const e = exp(t, id)
  const a = run(t, patch)
  const b = run(t, { ...patch, ...e.change(a.p as never) })
  return { before: a.m, after: b.m, p0: a.p, p1: b.p, why: e.why(a.m as never, b.m as never, a.p as never, b.p as never), verdict: e.judge(a.m as never, b.m as never) }
}

describe('the ESR part of the ripple is estimated from the simulated currents', () => {
  it.each(['buck', 'boost', 'buck-boost'] as const)('%s: with a very large C the ripple is the ESR step, and the estimate matches it', (kind) => {
    const t = DCDC[kind]
    const { m } = run(t, { esr: 0.05, c: 1 })
    const est = esrRipple(kind, 0.05, m as never)
    expect(Math.abs(est / m.voutPP - 1)).toBeLessThan(0.05)
  })
  it('without ESR there is no ESR part and no note', () => {
    expect(esrRipple('buck', 0, { ilPP: 1, ilMax: 2 })).toBe(0)
    expect(rippleNote('boost', 0, { ilPP: 1, ilMax: 2, voutPP: 0.1 })).toBe('')
  })
})

describe('"Quadruple the capacitance": the text follows the simulated ripple', () => {
  it.each(['buck', 'boost', 'buck-boost'] as const)('%s without ESR: ∝ 1/C, and the simulation drops to about a quarter', (kind) => {
    const r = runExp(DCDC[kind], 'capacitor', { esr: 0 })
    expect(r.after.voutPP / r.before.voutPP).toBeLessThan(0.375)
    expect(r.why).not.toMatch(/ESR/)
  })
  it.each(['buck', 'boost', 'buck-boost'] as const)('%s with a large ESR: the step is named, "dominates" only when 4×C barely helps', (kind) => {
    const r = runExp(DCDC[kind], 'capacitor', { esr: 0.2 })
    expect(r.why).toMatch(/ESR·ΔiC/)
    const q = r.after.voutPP / r.before.voutPP
    if (/dominates/.test(r.why)) expect(q).toBeGreaterThan(0.5)
    else expect(q).toBeLessThan(0.75)
    // and the verdict is the simulation's: it is not "a quarter" when the ESR step dominates
    if (/dominates/.test(r.why)) expect(r.verdict).not.toBe(0)
  })
  it('a small ESR is named but not called dominant (the capacitor\'s own ripple is larger)', () => {
    const r = runExp(DCDC.buck, 'capacitor', { esr: 0.001 })
    expect(r.why).toMatch(/ESR·ΔiC/)
    expect(r.why).not.toMatch(/dominates/)
  })
})

describe('"Double the switching frequency" with ESR', () => {
  it('buck: says the ESR step only follows ΔiL', () => {
    const r = runExp(DCDC.buck, 'frequency', { esr: 0.2 })
    expect(r.why).toMatch(/ESR step ESR·ΔiL only follows ΔiL/)
    // the simulation agrees: the output ripple falls no faster than ΔiL when ESR dominates
    expect(r.after.voutPP / r.before.voutPP).toBeGreaterThan(0.9 * (r.after.ilPP / r.before.ilPP))
  })
  it('boost: says the ESR step does not halve, and the simulated ripple does not halve', () => {
    const r = runExp(DCDC.boost, 'frequency', { esr: 0.2 })
    expect(r.why).toMatch(/does not halve/)
    expect(r.after.voutPP / r.before.voutPP).toBeGreaterThan(0.75)
  })
})

describe('the capacitor WHY card in Explore', () => {
  it('no ESR: "Ripple ∝ 1/C"; with ESR: only the capacitor\'s own part halves', () => {
    const t = DCDC.buck
    for (const esr of [0, 0.2]) {
      const p = { ...(t.defaults as object), esr }
      const r = t.simulate(p as never)
      const m = t.measure(r)
      const card = t.why(r, t.state(r, 10), m).find((c) => c.id === 'vout')!
      if (esr === 0) expect(card.whatIf).toMatch(/^Ripple ∝ 1\/C \(no ESR\)/)
      else expect(card.whatIf).toMatch(/only the capacitor's own part/)
    }
  })
})
