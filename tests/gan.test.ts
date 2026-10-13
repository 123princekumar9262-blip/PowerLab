import { describe, expect, it } from 'vitest'
import { GAN_TOPIC } from '../src/topics/devices-wbg.tsx'
import { nextConsequenceOf, repeatsEveryPeriod } from '../src/workspace/useTopicWorkspace.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { compareGan, GAN_EXPERIMENTS, GAN_LESSONS, ganPredictions, ganReadings, ganStateAt, ganWhy } from '../src/converters/devices/gan-content.ts'
import { GAN_DEFAULTS, measureGan, simulateGan, textbookGan, type GanParams } from '../src/converters/devices/gan.ts'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<GanParams> = {}) => {
  const r = simulateGan({ ...GAN_DEFAULTS, ...o })
  return { r, m: measureGan(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('GaN half-bridge: physics', () => {
  const { r, m } = run()
  const p = r.params
  it('the sequence: synchronous → dead time (reverse) → turn-on → on → turn-off → dead time (reverse) → synchronous', () => {
    expect(r.pwlEvents.map((e) => `${e.from}→${e.to}`)).toEqual(['cut|on→cut|off', 'cut|off→cut|rev', 'cut|rev→sat|rev', 'sat|rev→sat|off', 'sat|off→ohm|off', 'ohm|off→sat|off', 'sat|off→cut|off', 'cut|off→cut|rev', 'cut|rev→cut|on'])
    expect(m.shootThrough).toBe(0)
  })
  it('KCL at the switch node, from the stored states: Cn·dvDS/dt − Cgd·dvGS/dt = I0 − i_ch − iHS (finite differences)', () => {
    // in the middle of the turn-on voltage fall, the turn-off voltage rise and the dead time
    const ts = [p.ton + m.tdOn! + m.tri! + 0.5 * m.tfv!, p.toff + m.tdOff! + 0.5 * m.trv!, 0.5 * (p.thsOff + p.ton)]
    for (const t of ts) {
      const k = converterIndexAt(r, t)
      const s = r.signals
      const lhs = (p.cn * (s.vds[k + 1] - s.vds[k - 1]) - p.cgd * (s.vgs[k + 1] - s.vgs[k - 1])) / (2 * p.dt)
      const rhs = p.i0 - s.ich[k] - s.iF[k]
      expect(Math.abs(lhs - rhs)).toBeLessThan(0.01 * p.i0)
    }
  })
  it('no body diode: in the dead time the high side drops Vth − Voff + Ron·I0; with its gate on only Ron·I0', () => {
    expect(m.vsdRev).toBeCloseTo(p.vth - p.voff + p.ron * p.i0, 6)
    expect(m.vsdSync).toBeCloseTo(p.ron * p.i0, 6)
    const neg = run({ voff: -3 }).m
    expect(neg.vsdRev - m.vsdRev).toBeCloseTo(3, 6)
  })
  it('no reverse recovery: the high-side current never goes negative at turn-on; the extra charge is its Coss', () => {
    expect(m.iFmin).toBeGreaterThanOrEqual(0)
    expect(Math.abs(m.qoss / textbookGan(p).qoss - 1)).toBeLessThan(0.01)
  })
  it('very fast edges: about 100 V/ns, nanosecond transitions', () => {
    expect(m.dvdtOn!).toBeGreaterThan(50e9)
    expect(m.tfv!).toBeLessThan(10e-9)
  })
  it('a dead time shorter than the turn-off causes shoot-through, and it is reported', () => {
    const { r: r2, m: m2 } = run({ tdead: 2e-9 })
    expect(m2.shootThrough).toBeGreaterThan(p.i0)
    expect(r2.diagnostics.issues.some((x) => x.startsWith('shoot-through'))).toBe(true)
    expect(m2.eoff).toBeGreaterThan(3 * m.eoff)
  })
  it('a default run simulates fast enough for interactive use', () => {
    const t0 = cpuNow()
    run()
    expect(cpuNow() - t0).toBeLessThan(3000)
  })
})

describe('GaN: simulation vs the exact PWL solution (0.5 %: trapezoidal steps, events located by bisection)', () => {
  const cases: Array<Partial<GanParams>> = [{}, { voff: -3 }, { tdead: 30e-9 }, { tdead: 5e-9 }, { rg: 2 }, { rg: 10, tdead: 20e-9 }, { i0: 40 }, { i0: 3 }, { vdc: 100 }, { ron: 0.02 }, { cds: 30e-12 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareGan(r, m)
    for (const row of cmp.rows) if (!row.pass && !row.expected) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.map((x) => x.key)).toEqual(expect.arrayContaining(['vsdRev', 'vsdSync', 'erevOn', 'eon', 'qoss']))
  })
  it('shoot-through: the turn-off energy is marked as not comparable (a ps spike), everything else still agrees', () => {
    const { r, m } = run({ tdead: 2e-9 })
    const cmp = compareGan(r, m)
    expect(cmp.rows.find((x) => x.key === 'eoff')?.expected).toMatch(/shoot-through/)
    for (const row of cmp.rows) if (!row.expected) expect(row.pass, row.key).toBe(true)
  })
  it('textbook dead-time loss V_SD·I0·t_dead underestimates the turn-on side (the reverse conduction also covers td(on))', () => {
    const { r, m } = run()
    const tb = textbookGan(r.params)
    expect(m.erevOn).toBeGreaterThan(tb.erevDead)
    expect(m.erevOn / tb.erevDead).toBeLessThan(1.15)
    expect(m.trevOn!).toBeGreaterThan(r.params.tdead)
    expect(m.trevOff!).toBeLessThan(r.params.tdead)
  })
})

describe('GaN: content judged by the simulation', () => {
  it('phases, WHY and readings never contain NaN', () => {
    for (const o of [{}, { tdead: 2e-9 }]) {
      const { r, m } = run(o)
      const seen = new Set<string>()
      for (let k = 0; k < r.length; k += 10) {
        const st = ganStateAt(r, k)
        seen.add(st.phase)
        for (const c of ganWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
      if (!o.tdead) for (const ph of ['high side on (synchronous)', 'dead time: reverse conduction', 'turn-on delay', 'current rise', 'voltage fall', 'on (ohmic)', 'turn-off delay', 'voltage rise']) expect(seen.has(ph), ph).toBe(true)
      else expect(seen.has('shoot-through')).toBe(true)
      for (const x of ganReadings(m, r)) noBadText(`${x.label} ${x.value} ${x.unit} ${x.note}`)
    }
  })
  it('lessons: every step renders; the checks agree with the simulation', () => {
    expect(GAN_LESSONS.length).toBeGreaterThanOrEqual(2)
    for (const l of GAN_LESSONS)
      for (const s of l.steps) {
        const r = simulateGan({ ...GAN_DEFAULTS, ...l.base, ...s.params })
        noBadText(s.body(ganStateAt(r, converterIndexAt(r, s.at(r))), measureGan(r), r))
      }
    // −3 V off: the drop rises by about 3 V (answer 1)
    const d = run({ voff: -3 }).m.vsdRev - run().m.vsdRev
    expect(Math.abs(d - 3) < 0.1 ? 1 : 0).toBe(GAN_LESSONS[0].check!.answer)
    // no reverse recovery: the high side current stays ≥ 0 (answer 1)
    expect(run().m.iFmin >= 0 ? 1 : 0).toBe(GAN_LESSONS[1].check!.answer)
  })
  it('experiments: the verdicts follow the two simulations', () => {
    const expected: Record<string, number> = { voff: 0, deadtime: 0, short: 1 }
    for (const e of GAN_EXPERIMENTS) {
      const p0 = { ...GAN_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureGan(simulateGan(p0))
      const a = measureGan(simulateGan(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, expected[e.id]])
      noBadText(e.why(b, a, p0, p1))
    }
  })
  it('predictions: the answers come from measure and agree with the theory shown', () => {
    for (const seed of [0, 1, 2])
      for (const t of ganPredictions(seed)) {
        const p = { ...GAN_DEFAULTS, ...t.params }
        const m = measureGan(simulateGan(p))
        const a = t.answer(m)
        expect(Number.isFinite(a), t.id).toBe(true)
        noBadText(t.theory(p))
        if (t.id === 'vsd') expect(a).toBeCloseTo(p.vth - p.voff + p.ron * p.i0, 6)
        if (t.id === 'sync') expect(a).toBeCloseTo(p.ron * p.i0, 6)
        if (t.id === 'erev') expect(Math.abs(a / ((p.vth - p.voff + p.ron * p.i0) * p.i0 * p.tdead * 1e9) - 1)).toBeLessThan(t.tolerance!)
        if (t.id === 'qrr') expect(a).toBe(1)
      }
  })
})

describe('GaN topic in the workspace shell', () => {
  const t = GAN_TOPIC
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
