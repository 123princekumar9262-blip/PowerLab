import { describe, expect, it } from 'vitest'
import { compareThermal, THERMAL_EXPERIMENTS, THERMAL_LESSONS, thermalPredictions, thermalStateAt, thermalView, thermalWhy } from '../src/converters/engineering/content.ts'
import { exactThermal, textbookThermal, zth } from '../src/converters/engineering/theory.ts'
import { lossAt, measureThermal, resolveThermal, simulateThermal, THERMAL_DEFAULTS, type ThermalParams } from '../src/converters/engineering/thermal.ts'
import { converterIndexAt } from '../src/converters/engine.ts'

const run = (o: Partial<ThermalParams> = {}) => {
  const r = simulateThermal({ ...THERMAL_DEFAULTS, ...o })
  return { r, m: measureThermal(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('Losses and thermal: physics', () => {
  it('loss model: conduction D·I²·Ron(Tj) and switching fs·½·V·I·tsw, both rising with Tj', () => {
    const p = resolveThermal({}).params
    expect(lossAt(p, 25).pc).toBeCloseTo(0.5 * 80 * 80 * 0.01, 12)
    expect(lossAt(p, 25).ps).toBeCloseTo(10e3 * 0.5 * 600 * 80 * 133e-9, 12)
    expect(lossAt(p, 125).pc / lossAt(p, 25).pc).toBeCloseTo(1 + 0.006 * 100, 12)
  })
  it('constant load, no temperature dependence: Tj = Ta + P·Rth exactly', () => {
    const { r, m } = run({ load: 'constant', alpha: 0, kappa: 0 })
    expect(m.tjMean).toBeCloseTo(r.params.ta + r.params.a * r.params.rth, 6)
    expect(m.dTj).toBeLessThan(1e-9)
  })
  it('constant load with feedback: the self-consistent formula is exact and hotter than Ta + P25·Rth', () => {
    const { r, m } = run({ load: 'constant' })
    const tb = textbookThermal(r.params)
    expect(m.tjMean).toBeCloseTo(tb.tjSelfConsistent!, 6)
    expect(m.tjMean).toBeGreaterThan(tb.tjMeanNoFeedback + 5)
  })
  it('power cycling: the heatsink barely moves while the junction swings; shorter pulses shrink ΔTj (as Zth(ton))', () => {
    const a = run({ ton: 2, toff: 2 })
    const b = run({ ton: 0.2, toff: 0.2 })
    let hsMin = Infinity
    let hsMax = -Infinity
    for (let k = 0; k < a.r.length; k++) {
      hsMin = Math.min(hsMin, a.r.signals.ths[k])
      hsMax = Math.max(hsMax, a.r.signals.ths[k])
    }
    expect(hsMax - hsMin).toBeLessThan(0.1 * a.m.dTj)
    // smaller, but the millisecond stages still swing fully: ΔTj ≈ P·Zth(ton)
    expect(b.m.dTj).toBeLessThan(0.85 * a.m.dTj)
    expect(b.m.dTj).toBeGreaterThan(0.5 * a.m.dTj)
    expect(Math.abs(b.m.tjMean - a.m.tjMean)).toBeLessThan(0.05 * (a.m.tjMean - 40))
  })
  it('start-up converges to the periodic steady state', () => {
    const s = run({ view: 'startup' }).m
    const ss = run().m
    expect(s.settled).toBe(true)
    expect(Math.abs(s.tjMean - ss.tjMean)).toBeLessThan(0.01 * (ss.tjMean - 40))
  })
  it('thermal runaway when b·Rth ≥ 1: no stable periodic state (spectral radius ≥ 1)', () => {
    const bad = resolveThermal({ i: 200, rha: 3, alpha: 0.012, kappa: 0.01, load: 'constant' }).params
    expect(bad.b * bad.rth).toBeGreaterThan(1)
    expect(exactThermal({ ...bad, view: 'steady' }).rho).toBeGreaterThan(1)
    const r = simulateThermal({ i: 200, rha: 3, alpha: 0.012, kappa: 0.01, load: 'constant' })
    expect(r.diagnostics.steady.converged).toBe(false)
    expect(measureThermal(r).runaway).toBe(true)
    expect(exactThermal(resolveThermal({}).params).rho).toBeLessThan(1)
  })
  it('Zth rises from 0 to Rth', () => {
    const p = resolveThermal({}).params
    expect(zth(p, 0)).toBe(0)
    expect(zth(p, 1e4)).toBeCloseTo(p.rth, 9)
    expect(zth(p, 0.01)).toBeLessThan(zth(p, 1))
  })
})

describe('Losses and thermal: simulation vs exact', () => {
  const cases: Array<Partial<ThermalParams>> = [{}, { load: 'constant' }, { view: 'startup' }, { view: 'startup', load: 'constant' }, { ton: 0.3, toff: 0.7 }, { ton: 10, toff: 20 }, { i: 140 }, { rha: 2 }, { ton: 0.13, toff: 0.29, view: 'startup' }, { fs: 50e3, tsw: 50e-9 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareThermal(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(4)
  })
})

describe('Losses and thermal: explanations and content', () => {
  it('state, view and WHY never contain NaN', () => {
    for (const o of [{}, { load: 'constant' as const, view: 'startup' as const }]) {
      const { r, m } = run(o)
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 300))) {
        const st = thermalStateAt(r, k)
        expect(st.tj).toBeCloseTo(r.params.ta + st.theta.reduce((a, b) => a + b, 0), 9)
        for (const row of thermalView(st, r).rows) noBadText(row.v)
        for (const c of thermalWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
    }
  })
  it('lessons, experiments and predictions', () => {
    for (const l of THERMAL_LESSONS)
      for (const s of l.steps) {
        const r = simulateThermal({ ...THERMAL_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        noBadText(s.body(thermalStateAt(r, converterIndexAt(r, t)), measureThermal(r), r))
      }
    for (const e of THERMAL_EXPERIMENTS) {
      const p0 = { ...THERMAL_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureThermal(simulateThermal(p0))
      const a = measureThermal(simulateThermal(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
    for (const t of thermalPredictions(1)) {
      const p = { ...THERMAL_DEFAULTS, ...t.params }
      const v = t.answer(measureThermal(simulateThermal(p)))
      expect(Number.isFinite(v)).toBe(true)
      noBadText(t.theory(p))
    }
    // without temperature dependence the predicted Tj is exactly the simulated one
    const pr = thermalPredictions(0)[1]
    const p = { ...THERMAL_DEFAULTS, ...pr.params }
    expect(pr.answer(measureThermal(simulateThermal(p)))).toBeCloseTo(40 + 64 * (0.3 + (p.rha as number)), 1)
  })
})
