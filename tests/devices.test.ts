import { describe, expect, it } from 'vitest'
import { compareMosfet, MOSFET_EXPERIMENTS, MOSFET_LESSONS, mosfetPredictions, mosfetStateAt, mosfetWhy } from '../src/converters/devices/content.ts'
import { exactMosfet, measureMosfet, MOSFET_DEFAULTS, simulateMosfet, textbookMosfet, type MosfetParams } from '../src/converters/devices/mosfet.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { exactPwl, simulatePwl, type PwlSystem } from '../src/converters/pwl.ts'

const run = (o: Partial<MosfetParams> = {}) => {
  const r = simulateMosfet({ ...MOSFET_DEFAULTS, ...o })
  return { r, m: measureMosfet(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('PWL toolkit', () => {
  it('both solvers reproduce an RC charge with a mode change exactly', () => {
    // x' = (1 − x)/τ until x reaches 0.5 (mode a), then x' = −x/τ (mode b, latched)
    const tau = 1
    const sys: PwlSystem = {
      n: 1,
      breakpoints: [],
      mode: (x, _t, prev) => (prev === 'b' || x[0] >= 0.5 ? 'b' : 'a'),
      sys: (m) => (m === 'a' ? { A: [[-1 / tau]], b: [1 / tau] } : { A: [[-1 / tau]], b: [0] }),
    }
    const tSwitch = Math.log(2)
    const sim = simulatePwl(sys, [0], 0, 2, 4000, 'a')
    expect(sim.events[0].t).toBeCloseTo(tSwitch, 6)
    expect(sim.x[0][4000]).toBeCloseTo(0.5 * Math.exp(-(2 - tSwitch)), 6)
    const ex = exactPwl(sys, [0], 0, [2], 'a')
    expect(ex.events[0].t).toBeCloseTo(tSwitch, 12)
    expect(ex.x[0][0]).toBeCloseTo(0.5 * Math.exp(-(2 - tSwitch)), 12)
  })
})

describe('MOSFET double-pulse test: physics', () => {
  const { r, m } = run()
  const p = r.params
  it('the transient has the six textbook phase boundaries, in order', () => {
    const order = r.pwlEvents.map((e) => `${e.from}→${e.to}`)
    expect(order).toEqual(['cut|D→sat|D', 'sat|D→sat|off', 'sat|off→ohm|off', 'ohm|off→sat|off', 'sat|off→sat|D', 'sat|D→cut|D'])
  })
  it('KCL at the drain: iD + iF = I0 at every instant; vDS never exceeds the clamp', () => {
    for (let k = 0; k < r.length; k++) {
      expect(r.signals.id[k] + r.signals.idiode[k]).toBeCloseTo(p.i0, 9)
      expect(r.signals.vds[k]).toBeLessThanOrEqual(p.vdc * (1 + 1e-6))
    }
  })
  it('on the Miller plateau vGS is nearly flat while vDS swings the full voltage', () => {
    const t2 = p.ton + m.tdOn! + m.tri!
    const k0 = Math.round((t2 + 0.1 * m.tfv!) / p.dt)
    const k1 = Math.round((t2 + 0.9 * m.tfv!) / p.dt)
    expect(Math.abs(r.signals.vgs[k1] - r.signals.vgs[k0])).toBeLessThan(0.02 * p.vpl)
    expect(r.signals.vds[k0] - r.signals.vds[k1]).toBeGreaterThan(0.6 * p.vdc)
  })
  it('in the on state vDS = I0·Ron; energy is only lost in the transitions', () => {
    expect(m.vdsOn).toBeCloseTo(p.i0 * p.ron, 4)
    expect(m.eon).toBeGreaterThan(0)
    expect(m.eoff).toBeGreaterThan(0)
  })
})

describe('MOSFET: simulation vs the exact PWL solution and the textbook', () => {
  const cases: Array<Partial<MosfetParams>> = [{}, { rg: 20 }, { rg: 1 }, { cgd: 0.3e-9 }, { cds: 0.5e-9 }, { i0: 30 }, { voff: -5 }, { vdc: 400 }, { gm: 50 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareMosfet(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBe(9)
  })
  it('textbook: the turn-on delay is exact; the plateau phases are close (Miller current) unless Cds matters', () => {
    const { r, m } = run()
    const tb = textbookMosfet(r.params)
    expect(m.tdOn!).toBeCloseTo(tb.tdOn, 12)
    expect(Math.abs(m.tfv! / tb.tfv - 1)).toBeLessThan(0.08)
    expect(Math.abs(m.eon / tb.eon - 1)).toBeLessThan(0.1)
    const withCds = run({ cds: 0.5e-9 })
    expect(withCds.m.tfv! / textbookMosfet(withCds.r.params).tfv).toBeGreaterThan(1.15)
  })
  it('switching energy scales with Rg and with Vdc·I0', () => {
    const a = run().m
    const b = run({ rg: 10 }).m
    expect(b.eon / a.eon).toBeGreaterThan(1.8)
    const c = run({ vdc: 200 }).m
    expect(c.eoff / a.eoff).toBeGreaterThan(1.8)
    const ex = exactMosfet({ ...run().r.params })
    expect(ex.eon).toBeCloseTo(a.eon, 9)
  })
})

describe('MOSFET: explanations and content', () => {
  it('the phase at the cursor follows the simulation and the WHY never contains NaN', () => {
    const { r, m } = run()
    const seen = new Set<string>()
    for (let k = 0; k < r.length; k += 20) {
      const st = mosfetStateAt(r, k)
      seen.add(st.phase)
      for (const c of mosfetWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
    }
    for (const ph of ['off', 'turn-on delay', 'current rise', 'voltage fall (Miller plateau)', 'on (ohmic)', 'turn-off delay', 'voltage rise (Miller plateau)', 'current fall']) expect(seen.has(ph)).toBe(true)
  })
  it('lessons, experiments and predictions', () => {
    for (const l of MOSFET_LESSONS)
      for (const s of l.steps) {
        const r = simulateMosfet({ ...MOSFET_DEFAULTS, ...l.base, ...s.params })
        noBadText(s.body(mosfetStateAt(r, converterIndexAt(r, s.at(r))), measureMosfet(r), r))
      }
    for (const e of MOSFET_EXPERIMENTS) {
      const p0 = { ...MOSFET_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureMosfet(simulateMosfet(p0))
      const a = measureMosfet(simulateMosfet(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
    for (const t of mosfetPredictions(1)) {
      const p = { ...MOSFET_DEFAULTS, ...t.params }
      expect(Number.isFinite(t.answer(measureMosfet(simulateMosfet(p))))).toBe(true)
      noBadText(t.theory(p))
    }
  })
})
