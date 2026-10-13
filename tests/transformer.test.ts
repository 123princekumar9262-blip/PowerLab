import { describe, expect, it } from 'vitest'
import { converterIndexAt } from '../src/converters/engine.ts'
import { compareXf, XF_EXPERIMENTS, XF_LESSONS, xfEnergy, xfNextConsequence, xfPredictions, xfStateAt, xfStatus, xfView, xfWhy } from '../src/converters/magnetics/transformerContent.ts'
import { magCurrentOf, measureXf, resolveXf, simulateXf, XF_DEFAULTS, xfHOf, type XfParams } from '../src/converters/magnetics/transformer.ts'
import { MU0 } from '../src/converters/magnetics/core.ts'
import { exactXf, textbookXf } from '../src/converters/magnetics/transformerTheory.ts'
import { TRANSFORMER_TOPIC } from '../src/topics/transformer.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<XfParams> = {}) => {
  const r = simulateXf({ ...XF_DEFAULTS, ...o })
  return { r, m: measureXf(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const rel = (a: number, b: number) => Math.abs(a / b - 1)

describe('Transformer: physics of the model', () => {
  it('Ampère: N1·i1 − N2·i2 = N1·im at every sample, and im(λ) is the gapped inductor’s continuous two-slope curve', () => {
    for (const o of [{}, { voff: 0.05 }, { source: 'sine' as const, voff: 0.05 }]) {
      const { r } = run(o)
      const p = r.params
      const s = r.signals
      for (let k = 0; k < r.length; k += 7) {
        expect(p.n1 * s.i1[k] - p.n2 * s.i2[k]).toBeCloseTo(p.n1 * s.im[k], 9)
        // Ampère around the core: N1·im = Hcore·le + B·lg/μ0
        expect(p.n1 * s.im[k]).toBeCloseTo(xfHOf(p, s.b[k]) * p.le + (s.b[k] * p.lg) / MU0, 6)
      }
    }
    const p = resolveXf({}).params
    expect(magCurrentOf(p, p.lamS * (1 + 1e-15))).toBeCloseTo(magCurrentOf(p, p.lamS * (1 - 1e-15)), 9)
    expect(p.lm).toBeCloseTo((p.n1 * p.n1 * MU0 * p.ae) / (p.lg + p.le / p.mur), 15)
  })

  it('turns ratio: V2/V1 → N2/N1 as the load and the leakage vanish', () => {
    for (const n2 of [5, 10, 40]) {
      const light = run({ n2, rload: 500 })
      expect(rel(light.m.ratio, n2 / 20)).toBeLessThan(0.005)
      // with the full load (the same 20 Ω seen from the primary) the resistance and leakage drops lower V2 by a few %
      const loaded = run({ n2, rload: 5 * (n2 / 10) ** 2 })
      expect(loaded.m.regulation).toBeGreaterThan(0.005)
      expect(loaded.m.regulation).toBeLessThan(0.1)
    }
  })

  it('square drive: îm = V·T/(4·Lm) and ΔB = V·(T/2)/(N1·Ae) while the core is linear (the R1 and Ll1 drops the formulas neglect: within 4 %)', () => {
    for (const o of [{}, { f: 25e3 }, { n1: 30, n2: 15 }, { lg: 0.2e-3 }, { rload: 50 }]) {
      const { r, m } = run(o)
      const tb = textbookXf(r.params)
      expect(m.saturated).toBe(false)
      expect(rel(m.imPk, tb.imPk)).toBeLessThan(0.04)
      expect(rel(m.dB, tb.dB)).toBeLessThan(0.04)
      // the magnetising current hardly depends on the load: only the R1 and Ll1 drops (which grow with the load
      // current) take a little from the voltage on Lm — a few % for twice the load
      expect(rel(m.imPk, run({ ...o, rload: (o.rload ?? 5) / 2 }).m.imPk)).toBeLessThan(0.04)
    }
  })

  it('sine drive, linear core: the simulation matches the phasor solution of the T-circuit (0.2 %)', () => {
    for (const o of [{ source: 'sine' as const }, { source: 'sine' as const, f: 25e3, ll1: 20e-6, ll2: 5e-6 }, { source: 'sine' as const, lload: 20e-6 }, { source: 'sine' as const, lg: 0.5e-3 }]) {
      const { r, m } = run(o)
      const tb = textbookXf(r.params)
      expect(m.saturated).toBe(false)
      expect(rel(m.v2rms, tb.v2rms!)).toBeLessThan(0.002)
      expect(rel(m.i1rms, tb.i1rms)).toBeLessThan(0.002)
      expect(rel(m.i2rms, tb.i2rms)).toBeLessThan(0.002)
      expect(rel(m.imPk, tb.imPk)).toBeLessThan(0.002)
      expect(rel(m.dB, tb.dB)).toBeLessThan(0.002)
      expect(rel(m.p1, tb.p1)).toBeLessThan(0.002)
    }
  })

  it('zero mean volt-seconds: a DC offset drives exactly Voff/R1, saturated or not', () => {
    for (const o of [{ voff: 0.01 }, { voff: 0.05 }, { voff: -0.2, r1: 0.2 }, { source: 'sine' as const, voff: 0.05 }, { voff: 0.05, lg: 0.2e-3 }]) {
      const { r, m } = run(o)
      // tolerance: the trapezoidal mean of a current that spikes in saturation (relative to the RMS current)
      expect(Math.abs(m.i1dc - r.params.voff / r.params.r1) / m.i1rms).toBeLessThan(2e-4)
      expect(Math.abs(m.imDc - r.params.voff / r.params.r1) / m.i1rms).toBeLessThan(2e-4)
    }
    // an ungapped core saturates with 50 mV; a 0.2 mm gap (lower Lm) keeps the same DC current linear
    expect(run({ voff: 0.05 }).m.saturated).toBe(true)
    expect(run({ voff: 0.05, lg: 0.2e-3 }).m.saturated).toBe(false)
    expect(run({ voff: 0.01 }).m.saturated).toBe(false)
  })

  it('too many volt-seconds saturate the core and the magnetising current spikes', () => {
    const base = run().m
    const low = run({ f: 15e3 }).m
    expect(base.saturated).toBe(false)
    expect(low.saturated).toBe(true)
    expect(low.satFrac).toBeGreaterThan(0.05)
    expect(low.imMax).toBeGreaterThan(20 * base.imMax)
  })

  it('energy balance: P1 = P2 + R1·I1² + R2·I2² over a steady period (simulation 0.05 %, exact 1e-6)', () => {
    for (const o of [{}, { voff: 0.05 }, { source: 'sine' as const }, { lload: 50e-6 }, { f: 15e3 }]) {
      const { r, m } = run(o)
      expect(Math.abs(m.balance)).toBeLessThan(5e-4)
      expect(Math.abs(exactXf(r.params).balance)).toBeLessThan(1e-6)
    }
  })

  it('leakage: ten times the leakage → slower reversal (≈ τ·ln(1 + tanh(T/4τ))) and a larger voltage drop', () => {
    const a = run()
    const b = run({ ll1: 20e-6, ll2: 5e-6 })
    expect(b.m.tRev! / a.m.tRev!).toBeGreaterThan(5)
    expect(b.m.regulation).toBeGreaterThan(3 * a.m.regulation)
    for (const x of [a, b]) {
      // Lm and the magnetising current neglected by the formula: 3 %
      expect(rel(x.m.tRev!, textbookXf(x.r.params).tRev!)).toBeLessThan(0.03)
    }
  })

  it('switch-on: flux doubling saturates at N1·Ae·Bsat/V (square) and at a sine zero crossing, not at the sine peak', () => {
    const sq = run({ view: 'startup', f: 30e3 })
    const tb = textbookXf(sq.r.params)
    expect(sq.m.tSat).not.toBeNull()
    expect(rel(sq.m.tSat!, tb.tSat!)).toBeLessThan(0.02)
    expect(sq.m.iPeakRun).toBeGreaterThan(5 * run({ f: 30e3 }).m.i1Max)
    const zero = run({ view: 'startup', source: 'sine', f: 20e3, phase: 0 })
    const peak = run({ view: 'startup', source: 'sine', f: 20e3, phase: 90 })
    expect(zero.m.tSat).not.toBeNull()
    expect(rel(zero.m.tSat!, textbookXf(zero.r.params).tSat!)).toBeLessThan(0.02)
    expect(peak.m.tSat).toBeNull()
    expect(zero.m.iPeakRun).toBeGreaterThan(5 * peak.m.iPeakRun)
    // the run is honest about not having settled (the offset decays with Lm/(R1 ∥ Rs), thousands of periods)
    expect(zero.r.diagnostics.steady.converged).toBe(false)
    expect(peak.r.diagnostics.steady.converged).toBe(true)
  })

  it('a default run is fast enough for interactive use', () => {
    const t0 = cpuNow()
    run()
    const ms = cpuNow() - t0
    expect(ms).toBeLessThan(3000)
    // eslint-disable-next-line no-console
    console.log(`transformer default run: ${ms.toFixed(0)} ms`)
  })
})

describe('Transformer: simulation vs the exact PWL solution', () => {
  const cases: Array<Partial<XfParams>> = [
    {},
    { voff: 0.01 },
    { voff: 0.05 },
    { f: 15e3 },
    { source: 'sine' },
    { source: 'sine', voff: 0.05 },
    { source: 'sine', f: 20e3, lload: 20e-6 },
    { ll1: 20e-6, ll2: 5e-6 },
    { lload: 50e-6 },
    { rload: 500 },
    { ll1: 0, ll2: 0.01e-6 },
    { n1: 40, n2: 10, v: 100 },
    { lg: 0.2e-3, voff: 0.05 },
    { view: 'startup', f: 30e3 },
    { view: 'startup' },
    { view: 'startup', source: 'sine', f: 20e3 },
    { view: 'startup', source: 'sine', f: 20e3, phase: 90 },
  ]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareXf(r, m)
    for (const row of cmp.rows) if (!row.pass && !row.expected) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(12)
    if (m.saturated) expect(cmp.rows.find((x) => x.key === 'imPk')!.textbook!.notApplicable).toBeTruthy()
    if (r.params.view === 'steady') expect(r.diagnostics.steady.converged).toBe(true)
  })
  it('the step is fine enough: doubling it changes the headline results by < 0.1 %', () => {
    for (const o of [{}, { voff: 0.05 }, { source: 'sine' as const }]) {
      const a = run(o)
      const b = run({ ...o, stepsPerPeriod: 2 * a.r.params.stepsPerPeriod })
      for (const k of ['v2rms', 'i1rms', 'imPk', 'bpk'] as const) expect(rel(a.m[k], b.m[k])).toBeLessThan(1e-3)
    }
  })
})

describe('Transformer: explanations and content', () => {
  it('state, view, status, WHY, next consequence and energy at the cursor: no NaN, and the power ledger closes', () => {
    for (const o of [{}, { voff: 0.05 }, { source: 'sine' as const }, { view: 'startup' as const, f: 30e3 }, { lload: 50e-6 }]) {
      const { r, m } = run(o)
      const regions = new Set<string>()
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 200))) {
        const st = xfStateAt(r, k)
        regions.add(st.region)
        for (const row of xfView(st, r).rows) noBadText(row.v)
        const s = xfStatus(st, r)
        noBadText(s.headline + s.facts.join(' '))
        for (const c of xfWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
        const nc = xfNextConsequence(r, st)
        if (nc) {
          noBadText(nc.text)
          expect(nc.time).toBeGreaterThanOrEqual(st.t - 1e-12)
        }
        const e = xfEnergy(st, m, r)
        expect(Math.abs(e.balance!)).toBeLessThanOrEqual(e.tolerance)
      }
      if (o.voff === 0.05) expect(regions.has('sat+')).toBe(true)
    }
  })

  it('the topic: readings, compare and labels', () => {
    const t = TRANSFORMER_TOPIC
    const r = t.simulate(t.defaults)
    const m = t.measure(r)
    const rd = t.readings!(m, r)
    expect(rd.length).toBeGreaterThanOrEqual(3)
    for (const x of rd) noBadText(`${x.value} ${x.unit} ${x.note ?? ''}`)
    expect(Number(rd[0].value)).toBeCloseTo(m.v2rms, 1)
    for (const e of t.experiments) for (const k of e.rows) expect(t.measureLabels[k], k).toBeDefined()
    for (const l of t.lessons) for (const s of l.steps) for (const c of s.channels) expect(t.channels[c], c).toBeDefined()
    expect(t.lessons.length).toBeGreaterThanOrEqual(2)
    expect(t.experiments.length).toBeGreaterThanOrEqual(2)
    expect(t.predictions(0).length).toBeGreaterThanOrEqual(3)
  })

  it('lessons: every step runs, and each lesson check is what the simulation shows', () => {
    for (const l of XF_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulateXf({ ...XF_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        const st = xfStateAt(r, converterIndexAt(r, t))
        noBadText(s.body(st, measureXf(r), r))
        if (s.window) for (const w of s.window(r)) expect(Number.isFinite(w)).toBe(true)
      }
    }
    const byId = (id: string) => XF_LESSONS.find((l) => l.id === id)!
    // ratio: halving RL leaves the magnetising current unchanged (answer 1)
    {
      const b = run(byId('ratio').base).m
      const a = run({ ...byId('ratio').base, rload: XF_DEFAULTS.rload / 2 }).m
      expect(byId('ratio').check!.answer).toBe(1)
      expect(rel(a.imPk, b.imPk)).toBeLessThan(0.04)
      expect(a.i2rms / b.i2rms).toBeGreaterThan(1.9)
    }
    // voltsec: only R1 limits the DC current (answer 1): changing the core (Lm) or the load does not change it, R1 does
    {
      const base = { ...byId('voltsec').base, voff: 0.05 }
      const a = run(base).m
      const lm = run({ ...base, mur: 5000 }).m
      const load = run({ ...base, rload: 10 }).m
      const r1 = run({ ...base, r1: 0.1 }).m
      expect(byId('voltsec').check!.answer).toBe(1)
      expect(rel(lm.i1dc, a.i1dc)).toBeLessThan(1e-3)
      expect(rel(load.i1dc, a.i1dc)).toBeLessThan(1e-3)
      expect(rel(r1.i1dc, a.i1dc / 2)).toBeLessThan(1e-3)
    }
    // leakage: ten times the leakage → slower reversal and a lower V2 (answer 1)
    {
      const a = run(byId('leakage').base).m
      const b = run({ ...byId('leakage').base, ll1: 20e-6, ll2: 5e-6 }).m
      expect(byId('leakage').check!.answer).toBe(1)
      expect(b.tRev!).toBeGreaterThan(a.tRev!)
      expect(b.v2rms).toBeLessThan(a.v2rms)
    }
    // inrush: switching a sine on at its peak (answer 1) gives no saturation; at a zero crossing it saturates
    {
      const base = { ...byId('inrush').base, source: 'sine' as const, f: 20e3 }
      expect(byId('inrush').check!.answer).toBe(1)
      expect(run({ ...base, phase: 90 }).m.tSat).toBeNull()
      expect(run({ ...base, phase: 0 }).m.tSat).not.toBeNull()
    }
  })

  it('experiments: the simulation confirms the expected answer from the defaults', () => {
    for (const e of XF_EXPERIMENTS) {
      const p0 = { ...XF_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureXf(simulateXf(p0))
      const a = measureXf(simulateXf(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
      noBadText(e.question(p0))
    }
  })

  it('predictions: answered by the simulation, and the textbook theory lands within the accepted tolerance', () => {
    for (const seed of [0, 1, 2]) {
      for (const t of xfPredictions(seed)) {
        const p = { ...XF_DEFAULTS, ...t.params }
        const m = measureXf(simulateXf(p))
        const v = t.answer(m)
        expect(Number.isFinite(v)).toBe(true)
        noBadText(t.theory(p))
        noBadText(t.prompt)
        if (t.kind === 'choice') expect(v).toBe(0)
      }
      const [v2, im, dB, dc] = xfPredictions(seed)
      const pv = { ...XF_DEFAULTS, ...v2.params }
      expect(rel(v2.answer(measureXf(simulateXf(pv))), (pv.v * pv.n2) / pv.n1)).toBeLessThan(v2.tolerance!)
      const pi = resolveXf({ ...XF_DEFAULTS, ...im.params }).params
      expect(rel(im.answer(measureXf(simulateXf(pi))), pi.v / (4 * pi.f * pi.lm))).toBeLessThan(im.tolerance!)
      const pb = { ...XF_DEFAULTS, ...dB.params }
      expect(rel(dB.answer(measureXf(simulateXf(pb))), pb.v / (2 * pb.f * pb.n1 * pb.ae))).toBeLessThan(dB.tolerance!)
      const pd = { ...XF_DEFAULTS, ...dc.params }
      expect(rel(dc.answer(measureXf(simulateXf(pd))), pd.voff / pd.r1)).toBeLessThan(dc.tolerance!)
    }
  })
})
