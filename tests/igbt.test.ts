import { describe, expect, it } from 'vitest'
import { IGBT_TOPIC } from '../src/topics/devices-wbg.tsx'
import { nextConsequenceOf, repeatsEveryPeriod } from '../src/workspace/useTopicWorkspace.ts'
import { compareIgbt, IGBT_EXPERIMENTS, IGBT_LESSONS, igbtPredictions, igbtReadings, igbtStateAt, igbtWhy } from '../src/converters/devices/igbt-content.ts'
import { exactIgbt, IGBT_DEFAULTS, measureIgbt, simulateIgbt, textbookIgbt, type IgbtParams } from '../src/converters/devices/igbt.ts'
import { MOSFET_DEFAULTS, measureMosfet, simulateMosfet } from '../src/converters/devices/mosfet.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<IgbtParams> = {}) => {
  const r = simulateIgbt({ ...IGBT_DEFAULTS, ...o })
  return { r, m: measureIgbt(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('IGBT double-pulse test: physics', () => {
  const { r, m } = run()
  const p = r.params
  it('the transient has the six phase boundaries, then the tail with the channel off', () => {
    expect(r.pwlEvents.map((e) => `${e.from}→${e.to}`)).toEqual(['cut|D→sat|D', 'sat|D→sat|off', 'sat|off→ohm|off', 'ohm|off→sat|off', 'sat|off→sat|D', 'sat|D→cut|D'])
    const k = converterIndexAt(r, p.toff + (m.tdOff ?? 0) + (m.trv ?? 0) + (m.tfi ?? 0) + p.tau)
    expect(igbtStateAt(r, k).phase).toBe('tail current')
  })
  it('KCL at the collector at every sample: iC + iF = I0; vCE never exceeds the clamp; iC = i_ch + i_p inside the device', () => {
    for (let k = 0; k < r.length; k++) {
      expect(r.signals.ic[k] + r.signals.idiode[k]).toBeCloseTo(p.i0, 9)
      expect(r.signals.vce[k]).toBeLessThanOrEqual(p.vdc * (1 + 1e-6))
    }
  })
  it('in the on-state the holes carry α·I0 and vCE = V0 + r·I0', () => {
    const k = Math.floor(p.toff / p.dt) - 1
    expect(r.signals.ip[k] / (p.alpha * p.i0)).toBeCloseTo(1, 3)
    expect(m.vceSat).toBeCloseTo(p.v0 + p.rce * p.i0, 9)
  })
  it('the tail is an exponential with the lifetime: i_p(t6 + n·τ) = I_tail·e^(−n), at vCE = Vdc', () => {
    const t6 = p.toff + (m.tdOff ?? 0) + (m.trv ?? 0) + (m.tfi ?? 0)
    for (const n of [0.5, 1, 2, 4]) {
      const k = converterIndexAt(r, t6 + n * p.tau)
      const tk = r.time[k]
      expect(r.signals.ip[k] / (m.itail0! * Math.exp(-(tk - t6) / p.tau))).toBeCloseTo(1, 5)
      expect(r.signals.vce[k] / p.vdc).toBeCloseTo(1, 8) // the clamp is entered with a 1e-9 hysteresis
    }
  })
  it('energy balance of the tail: E_tail = Vdc·Q_tail (the collector is clamped at Vdc)', () => {
    expect(m.etail / (p.vdc * m.qtail)).toBeCloseTo(1, 6)
  })
  it('a default run simulates fast enough for interactive use', () => {
    const t0 = cpuNow()
    simulateIgbt(IGBT_DEFAULTS)
    expect(cpuNow() - t0).toBeLessThan(3000)
  })
})

describe('IGBT: simulation vs the exact PWL solution (tolerance 0.5 %: trapezoidal steps, events located by bisection)', () => {
  const cases: Array<Partial<IgbtParams>> = [{}, { rg: 30 }, { rg: 2 }, { tau: 800e-9 }, { tau: 50e-9 }, { alpha: 0.1 }, { alpha: 0.6 }, { i0: 5 }, { i0: 60 }, { voff: 0 }, { vdc: 800 }, { cgc: 0.3e-9 }, { cce: 0 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareIgbt(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBe(15)
  })
  it('α = 0: no tail at all (no hole current, the tail rows are not shown)', () => {
    const { r, m } = run({ alpha: 0 })
    expect(m.itail0).toBe(0)
    expect(m.tailShare).toBeLessThan(0.01)
    expect(compareIgbt(r, m).rows.some((x) => x.key === 'itail0')).toBe(false)
  })
  it('textbook: I_tail ≈ α·I0 a little low (holes decay during the voltage rise); E_tail ≈ Vdc·α·I0·τ', () => {
    const { r, m } = run()
    const tb = textbookIgbt(r.params)
    expect(m.itail0! / tb.itail0).toBeGreaterThan(0.95)
    expect(m.itail0! / tb.itail0).toBeLessThan(1)
    expect(Math.abs(m.etail / tb.etail - 1)).toBeLessThan(0.05)
    expect(Math.abs(m.tdOn! / tb.tdOn - 1)).toBeLessThan(1e-4)
    const ex = exactIgbt(r.params)
    expect(ex.tauTail).toBe(r.params.tau)
  })
})

describe('IGBT vs the MOSFET compared', () => {
  it('the MOSFET simulated alongside is the MOSFET topic’s model: same Eon as the MOSFET topic at the same values', () => {
    const { r, m } = run()
    const p = r.params
    const alone = measureMosfet(simulateMosfet({ ...MOSFET_DEFAULTS, vdc: p.vdc, i0: p.i0, vdrv: p.vdrv, voff: p.voff, rg: p.rg, cgs: p.cge, cgd: p.cgc, cds: p.cce, vth: p.vth, gm: p.gm, ron: p.ronMos }))
    // different time windows and energy integration (sample-rounded vs event-aware): agreement within 0.5 %
    expect(Math.abs(m.mos.eon / alone.eon - 1)).toBeLessThan(0.005)
    expect(Math.abs(m.mos.eoff / alone.eoff - 1)).toBeLessThan(0.005)
    expect(m.mos.vdsOn).toBeCloseTo(p.i0 * p.ronMos, 6)
  })
  it('without a tail and knee the IGBT’s turn-off equals the MOSFET’s (α = 0)', () => {
    const { m } = run({ alpha: 0 })
    expect(Math.abs(m.eoffMos / m.mos.eoff - 1)).toBeLessThan(0.02)
    expect(Math.abs(m.trv! / m.mos.trv! - 1)).toBeLessThan(0.02)
  })
  it('the tail makes Eoff several times the MOSFET’s; the IGBT conducts better at 20 A and worse at 5 A (crossover V0/(Ron − r))', () => {
    const a = run().m
    expect(a.eoffRatio).toBeGreaterThan(3)
    expect(a.pcond).toBeLessThan(a.mosPcond)
    const b = run({ i0: 5 }).m
    expect(b.pcond).toBeGreaterThan(b.mosPcond)
    const ic = textbookIgbt(run().r.params).iCross
    const c = run({ i0: ic }).m
    expect(c.pcond / c.mosPcond).toBeCloseTo(1, 6)
  })
})

describe('IGBT: content judged by the simulation', () => {
  it('phases, WHY and readings never contain NaN', () => {
    const { r, m } = run()
    const seen = new Set<string>()
    for (let k = 0; k < r.length; k += 20) {
      const st = igbtStateAt(r, k)
      seen.add(st.phase)
      for (const c of igbtWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
    }
    for (const ph of ['off', 'turn-on delay', 'current rise', 'voltage fall (Miller plateau)', 'on-state', 'turn-off delay', 'voltage rise (Miller plateau)', 'tail current']) expect(seen.has(ph), ph).toBe(true)
    for (const x of igbtReadings(m, r)) noBadText(`${x.label} ${x.value} ${x.unit} ${x.note}`)
  })
  it('lessons: every step renders; the checks agree with the simulation', () => {
    expect(IGBT_LESSONS.length).toBeGreaterThanOrEqual(2)
    for (const l of IGBT_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      for (const s of l.steps) {
        const r = simulateIgbt({ ...IGBT_DEFAULTS, ...l.base, ...s.params })
        noBadText(s.body(igbtStateAt(r, converterIndexAt(r, s.at(r))), measureIgbt(r), r))
      }
    }
    // tail lesson: after the channel is off the collector current is the decaying hole current, not zero
    const { r, m } = run()
    const t6 = r.params.toff + (m.tdOff ?? 0) + (m.trv ?? 0) + (m.tfi ?? 0)
    const st = igbtStateAt(r, converterIndexAt(r, t6 + 0.5 * r.params.tau))
    expect(st.ich).toBe(0)
    expect(st.ic).toBeGreaterThan(0.1 * r.params.i0)
    // IGBT vs MOSFET at 5 A: the MOSFET has the lower on-state voltage (answer 1)
    const low = run({ i0: 5 }).m
    expect(IGBT_LESSONS[1].check!.answer).toBe(low.mosVon < low.vceSat ? 1 : 0)
  })
  it('experiments: the verdicts follow the two simulations', () => {
    const expected: Record<string, number> = { tau: 0, rg: 1, current: 1 }
    for (const e of IGBT_EXPERIMENTS) {
      const p0 = { ...IGBT_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureIgbt(simulateIgbt(p0))
      const a = measureIgbt(simulateIgbt(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, expected[e.id]])
      noBadText(e.why(b, a, p0, p1))
    }
  })
  it('predictions: the answers come from measure and agree with the theory shown', () => {
    for (const seed of [0, 1, 2]) {
      for (const t of igbtPredictions(seed)) {
        const p = { ...IGBT_DEFAULTS, ...t.params }
        const m = measureIgbt(simulateIgbt(p))
        const a = t.answer(m)
        expect(Number.isFinite(a), t.id).toBe(true)
        noBadText(t.theory(p))
        if (t.id === 'vce') expect(a).toBeCloseTo(p.v0 + p.rce * p.i0, 6)
        if (t.id === 'itail') expect(Math.abs(a / (p.alpha * p.i0) - 1)).toBeLessThan(t.tolerance!)
        if (t.id === 'etail') expect(Math.abs(a / (p.vdc * p.alpha * p.i0 * p.tau * 1e6) - 1)).toBeLessThan(t.tolerance!)
        if (t.id === 'who') expect(a).toBe(0)
      }
    }
  })
})

describe('IGBT topic in the workspace shell', () => {
  const t = IGBT_TOPIC
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
