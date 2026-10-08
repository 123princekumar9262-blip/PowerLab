import { describe, expect, it } from 'vitest'
import { compareCore, CORE_EXPERIMENTS, CORE_LESSONS, corePredictions, coreStateAt, coreView, coreWhy } from '../src/converters/magnetics/content.ts'
import { CORE_DEFAULTS, currentOf, hCoreOf, measureCore, MU0, resolveCore, simulateCore, type CoreParams } from '../src/converters/magnetics/core.ts'
import { textbookCore } from '../src/converters/magnetics/theory.ts'
import { converterIndexAt } from '../src/converters/engine.ts'

const run = (o: Partial<CoreParams> = {}) => {
  const r = simulateCore({ ...CORE_DEFAULTS, ...o })
  return { r, m: measureCore(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('Gapped inductor: physics', () => {
  it('Ampère: N·i = Hcore·le + B·lg/μ0 on both sides of saturation, and i(λ) is continuous', () => {
    const p = resolveCore({}).params
    for (const b of [-0.6, -0.36, -0.35, -0.1, 0, 0.2, 0.35, 0.351, 0.5, 0.9]) {
      const lam = b * p.n * p.ae
      expect(p.n * currentOf(p, lam)).toBeCloseTo(hCoreOf(p, b) * p.le + (b * p.lg) / MU0, 6)
    }
    expect(currentOf(p, p.lamS * (1 + 1e-12))).toBeCloseTo(currentOf(p, p.lamS * (1 - 1e-12)), 8)
    expect(p.l1).toBeCloseTo((p.n * p.n * MU0 * p.ae) / (p.lg + p.le / p.mur), 15)
  })
  it('volt-seconds: ΔB = V·d·T/(N·Ae) and L = Δλ/Δi while the core stays linear', () => {
    for (const o of [{}, { lg: 0 }, { n: 40 }, { f: 40e3 }]) {
      const { r, m } = run(o)
      const tb = textbookCore(r.params)
      expect(m.saturated).toBe(false)
      // the R·i drop makes the true swing slightly smaller
      expect(Math.abs(m.dB / tb.dB - 1)).toBeLessThan(0.01)
      expect(m.lMeas / r.params.l1).toBeCloseTo(1, 9)
    }
  })
  it('steady state: the mean current is exactly (2d − 1)·V/R, saturated or not', () => {
    for (const o of [{ duty: 0.52 }, { duty: 0.6, r: 1 }, { duty: 0.45, r: 0.5 }]) {
      const { r, m } = run(o)
      expect(m.idc / (((2 * r.params.duty - 1) * r.params.vdc) / r.params.r)).toBeCloseTo(1, 6)
    }
  })
  it('saturation: lower frequency or a DC bias drives the core past Bsat and the current spikes', () => {
    const base = run().m
    const lowF = run({ f: 12e3 }).m
    const bias = run({ duty: 0.52 }).m
    for (const m of [lowF, bias]) {
      expect(m.saturated).toBe(true)
      expect(m.satFrac).toBeGreaterThan(0.05)
      expect(m.ipk).toBeGreaterThan(5 * base.ipk)
    }
  })
  it('start-up from zero flux: the first half-period saturates (flux doubling), then the offset decays', () => {
    const { r, m } = run({ view: 'startup' })
    const tb = textbookCore(r.params)
    expect(m.tSat).not.toBeNull()
    expect(Math.abs(m.tSat! / tb.tSat! - 1)).toBeLessThan(0.05)
    expect(m.iPeakRun).toBeGreaterThan(10 * m.ipk)
    expect(m.settled).toBe(true)
    expect(m.saturated).toBe(false)
    // half the voltage: the doubled flux stays below Bsat — no saturation at all
    expect(run({ view: 'startup', vdc: 12 }).m.tSat).toBeNull()
  })
})

describe('Gapped inductor: simulation vs the exact PWL solution', () => {
  const cases: Array<Partial<CoreParams>> = [{}, { duty: 0.52 }, { f: 12e3 }, { view: 'startup' }, { view: 'startup', vdc: 12 }, { lg: 0 }, { lg: 2e-3 }, { duty: 0.6, r: 1 }, { musat: 20, f: 10e3 }, { n: 8, vdc: 50 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareCore(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(5)
    if (m.saturated) expect(cmp.rows.find((x) => x.key === 'ipk')!.textbook!.notApplicable).toBeTruthy()
  })
})

describe('Gapped inductor: explanations and content', () => {
  it('state, view and WHY never contain NaN; the region follows the simulation', () => {
    for (const o of [{}, { duty: 0.52 }, { view: 'startup' as const }]) {
      const { r, m } = run(o)
      const regions = new Set<string>()
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 300))) {
        const st = coreStateAt(r, k)
        regions.add(st.region)
        // the region at a sample is the one of the interval ending there: |B| sits on its side of Bsat
        if (st.region !== 'lin') expect(Math.abs(st.b)).toBeGreaterThanOrEqual(r.params.bsat * (1 - 1e-9))
        else expect(Math.abs(st.b)).toBeLessThanOrEqual(r.params.bsat * (1 + 1e-9))
        for (const row of coreView(st, r).rows) noBadText(row.v)
        for (const c of coreWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
      if (o.duty === 0.52) expect(regions.has('sat+')).toBe(true)
    }
  })
  it('lessons, experiments and predictions', () => {
    for (const l of CORE_LESSONS)
      for (const s of l.steps) {
        const r = simulateCore({ ...CORE_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        noBadText(s.body(coreStateAt(r, converterIndexAt(r, t)), measureCore(r), r))
      }
    for (const e of CORE_EXPERIMENTS) {
      const p0 = { ...CORE_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureCore(simulateCore(p0))
      const a = measureCore(simulateCore(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
    for (const t of corePredictions(1)) {
      const p = { ...CORE_DEFAULTS, ...t.params }
      const v = t.answer(measureCore(simulateCore(p)))
      expect(Number.isFinite(v)).toBe(true)
      noBadText(t.theory(p))
    }
    // the inductance prediction is answered by the simulation and matches the formula
    const pr = corePredictions(0)[0]
    const p = { ...CORE_DEFAULTS, ...pr.params }
    expect(pr.answer(measureCore(simulateCore(p))) / ((p.n * p.n * MU0 * p.ae) / (p.lg + p.le / p.mur))).toBeCloseTo(1, 6)
  })
})
