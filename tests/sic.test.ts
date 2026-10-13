import { describe, expect, it } from 'vitest'
import { SIC_TOPIC } from '../src/topics/devices-wbg.tsx'
import { nextConsequenceOf, repeatsEveryPeriod } from '../src/workspace/useTopicWorkspace.ts'
import { mosfetStateAt } from '../src/converters/devices/content.ts'
import { MOSFET_DEFAULTS, measureMosfet, simulateMosfet } from '../src/converters/devices/mosfet.ts'
import { compareSic, SIC_EXPERIMENTS, SIC_LESSONS, sicPredictions, sicReadings, sicWhy } from '../src/converters/devices/sic-content.ts'
import { gateChargeTheory, measureSic, SI_PRESET, SIC_DEFAULTS, simulateSic, type SicParams } from '../src/converters/devices/sic.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<SicParams> = {}) => {
  const r = simulateSic({ ...SIC_DEFAULTS, ...o })
  return { r, m: measureSic(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('SiC MOSFET: the MOSFET model with SiC values', () => {
  it('it is exactly the MOSFET topic’s simulation, run with the device values', () => {
    const { r, m } = run()
    const p = r.params
    const direct = measureMosfet(simulateMosfet({ ...MOSFET_DEFAULTS, vdc: p.vdc, i0: p.i0, vdrv: p.vdrv, voff: p.voff, rg: p.rg, cgs: p.cgs, cgd: p.cgd, cds: p.cds, vth: p.vth, gm: p.gm, ron: p.ron }))
    expect(m.eon).toBe(direct.eon)
    expect(m.eoff).toBe(direct.eoff)
    expect(m.tfv).toBe(direct.tfv)
    expect(r.params.vdrv).toBe(18)
    expect(r.params.voff).toBe(-4)
  })
  it('Ron rises with temperature (+0.32 %/K) and falls with gate drive; the simulated vDS(on) follows', () => {
    const a = run().m
    const hot = run({ tj: 150 }).m
    expect(hot.ronSim / a.ronSim).toBeCloseTo(1 + 0.0032 * 125, 6)
    const low = run({ vdrv: 12 }).m
    expect(low.ronSim).toBeGreaterThan(1.2 * a.ronSim)
    expect(a.ronSim).toBeCloseTo(0.075, 6)
  })
  it('vs a silicon superjunction die at the same test: far smaller switching energy, higher dv/dt, smaller gate charge', () => {
    const sic = run().m
    const si = run(SI_PRESET).m
    expect(si.etot / sic.etot).toBeGreaterThan(5)
    expect(sic.dvdtOff! / si.dvdtOff!).toBeGreaterThan(5)
    expect(sic.qg).toBeLessThan(si.qg)
    expect(sic.dvdtOff!).toBeGreaterThan(30e9) // tens of V/ns
  })
  it('a default run simulates fast enough for interactive use', () => {
    const t0 = cpuNow()
    run()
    expect(cpuNow() - t0).toBeLessThan(3000)
  })
})

describe('SiC: simulation vs theory (exact PWL, 0.5 %; gate charge exact for constant capacitances)', () => {
  const cases: Array<Partial<SicParams>> = [{}, { rg: 2 }, { rg: 20 }, { tj: 150 }, { vdrv: 12 }, { vdc: 400 }, { i0: 50 }, SI_PRESET, { ...SI_PRESET, tj: 125 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareSic(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.map((x) => x.key)).toEqual(expect.arrayContaining(['tdOn', 'tfv', 'eon', 'eoff', 'qg', 'vdsOn']))
  })
  it('gate charge: ∫iG dt equals Cgs·ΔvGS + Cgd·Δ(vGS − vDS) of the run', () => {
    const { r, m } = run()
    expect(m.qg / gateChargeTheory(r.params)).toBeCloseTo(1, 3)
  })
})

describe('SiC: content judged by the simulation', () => {
  it('WHY and readings never contain NaN', () => {
    for (const o of [{}, SI_PRESET]) {
      const { r, m } = run(o)
      for (let k = 0; k < r.length; k += 40) for (const c of sicWhy(r, mosfetStateAt(r, k), m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      for (const x of sicReadings(m, r)) noBadText(`${x.label} ${x.value} ${x.unit} ${x.note}`)
    }
  })
  it('lessons: every step renders; the checks agree with the simulation', () => {
    expect(SIC_LESSONS.length).toBeGreaterThanOrEqual(2)
    for (const l of SIC_LESSONS)
      for (const s of l.steps) {
        const r = simulateSic({ ...SIC_DEFAULTS, ...l.base, ...s.params })
        noBadText(s.body(mosfetStateAt(r, converterIndexAt(r, s.at(r))), measureSic(r), r))
      }
    // "fast": the silicon die's switching energy is several times larger (answer 1)
    expect(run(SI_PRESET).m.etot / run().m.etot > 2 ? 1 : 0).toBe(SIC_LESSONS[0].check!.answer)
    // "ron": hotter → more conduction loss (answer 0)
    expect(run({ tj: 150 }).m.vdsOn > run().m.vdsOn ? 0 : 1).toBe(SIC_LESSONS[1].check!.answer)
  })
  it('experiments: the verdicts follow the two simulations', () => {
    const expected: Record<string, number> = { si: 0, hot: 0, drive: 0 }
    for (const e of SIC_EXPERIMENTS) {
      const p0 = { ...SIC_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureSic(simulateSic(p0))
      const a = measureSic(simulateSic(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, expected[e.id]])
      noBadText(e.why(b, a, p0, p1))
    }
  })
  it('predictions: the answers come from measure and agree with the theory shown', () => {
    for (const seed of [0, 1, 2])
      for (const t of sicPredictions(seed)) {
        const p = { ...SIC_DEFAULTS, ...t.params }
        const m = measureSic(simulateSic(p))
        const a = t.answer(m)
        expect(Number.isFinite(a), t.id).toBe(true)
        noBadText(t.theory(p))
        if (t.id === 'ron') expect(a).toBeCloseTo(p.i0 * p.ron25 * (1 + 0.0032 * (p.tj - 25)), 6)
        if (t.id === 'qg') expect(Math.abs(a / (gateChargeTheory({ ...p, ron: m.ronSim }) * 1e9) - 1)).toBeLessThan(0.005)
        if (t.id === 'drive') expect(a).toBe(2)
        if (t.id === 'si') expect(a).toBe(2)
      }
  })
})

describe('SiC topic in the workspace shell', () => {
  const t = SIC_TOPIC
  it('a single test (not periodic); "what happens next" answers at every sampled cursor from the run; readings and status are clean', () => {
    const r = t.simulate(t.defaults)
    const m = t.measure(r)
    expect(repeatsEveryPeriod(t, r)).toBe(false)
    for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 60))) {
      const n = nextConsequenceOf(t, r, k)
      expect(n, `k=${k}`).not.toBeNull()
      noBadText(n!.text)
      if (n!.time !== null) expect(n!.time).toBeGreaterThanOrEqual(r.time[k] - 1e-9 * r.params.dt)
      const st = t.state(r, k)
      const s = t.status!(st, r)
      noBadText(`${s.headline} ${s.facts.join(' ')}`)
      for (const row of t.view(st, r, 'engineer').rows) noBadText(row.v)
    }
    const rd = t.readings!(m, r)
    expect(rd.length).toBeGreaterThanOrEqual(3)
    expect(rd.length).toBeLessThanOrEqual(4)
    for (const part of t.parts!) noBadText(JSON.stringify(t.inspect!(part.id, t.state(r, Math.floor(r.length / 2)), m, r)))
    noBadText(t.summary(r, m))
    noBadText(t.paramNote!(t.defaults, r))
    expect(t.predictions(1).length).toBeGreaterThanOrEqual(3)
    expect(t.experiments.length).toBeGreaterThanOrEqual(2)
    for (const l of t.lessons) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.steps.length).toBeLessThanOrEqual(6)
      for (const s of l.steps) for (const c of s.channels) expect(t.channels[c], c).toBeDefined()
    }
    for (const c of t.defaultChannels) expect(t.channels[c], c).toBeDefined()
    for (const cat of t.analysis!) for (const key of cat.rows ?? []) expect(key in (m as object), key).toBe(true)
  })
})
