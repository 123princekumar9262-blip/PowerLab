import { describe, expect, it } from 'vitest'
import { comparePmsm, PMSM_EXPERIMENTS, PMSM_LESSONS, pmsmEnergy, pmsmNext, pmsmPredictions, pmsmReadings, pmsmStateAt, pmsmStatus, pmsmView, pmsmWhy } from '../src/converters/pmsm/content.ts'
import { loadAt, measurePmsm, PMSM_DEFAULTS, rpm, simulatePmsm, wRefAt, type PmsmParams } from '../src/converters/pmsm/model.ts'
import { exactPmsm, exactPwlAt, steadyPmsm, textbookPmsm } from '../src/converters/pmsm/theory.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { PMSM_TOPIC } from '../src/topics/pmsm.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<PmsmParams> = {}) => {
  const r = simulatePmsm({ ...PMSM_DEFAULTS, ...o })
  return { r, m: measurePmsm(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const rel = (a: number, b: number) => Math.abs(a / b - 1)

describe('PMSM: physics of the simulation', () => {
  it('energy is conserved: electrical input = copper + friction + load + rotor + windings', () => {
    for (const o of [{}, { lq: 0.8e-3 }, { decouple: 'off' as const }, { control: 'fw' as const, n2: 5500, event: 'speed' as const }]) expect(Math.abs(run(o).m.balance)).toBeLessThan(1e-7)
  })
  it('the phase currents are the inverse Park transform of id, iq: balanced, amplitude √(id² + iq²)', () => {
    const { r, m } = run()
    const s = r.signals
    for (let k = 0; k < r.length; k += 97) expect(Math.abs(s.ia[k] + s.ib[k] + s.ic[k])).toBeLessThan(1e-9)
    expect(rel(m.iaRms * Math.SQRT2, m.iAmp)).toBeLessThan(2e-3)
    // power invariance of the amplitude-invariant transform: Σ v·i = 1.5·(vd·id + vq·iq)
    for (let k = 1; k < r.length; k += 211) expect(Math.abs(s.va[k] * s.ia[k] + s.vb[k] * s.ib[k] + s.vc[k] * s.ic[k] - s.pel[k])).toBeLessThan(1e-9 * Math.max(1, Math.abs(s.pel[k])))
  })
  it('id = 0 control with decoupling holds id at zero and Te = 1.5·p·ψ·iq', () => {
    const { r, m } = run()
    expect(m.idPeak).toBeLessThan(1e-9)
    for (let k = 0; k < r.length; k += 101) expect(Math.abs(r.signals.te[k] - r.params.kt * r.signals.iq[k])).toBeLessThan(1e-12)
  })
  it('steady state: the speed reaches the reference (integral action), iq = (TL + B·ω)/kt', () => {
    for (const o of [{}, { event: 'none' as const, nref: 3000, tl: 0.6 }, { lq: 0.8e-3 }]) {
      const { r, m } = run(o)
      const p = r.params
      expect(m.settled).toBe(true)
      expect(rel(m.wEnd, wRefAt(p, p.duration))).toBeLessThan(1e-3)
      expect(rel(m.iqEnd, (loadAt(p, p.duration) + p.b * m.wEnd) / p.kt)).toBeLessThan(2e-3)
    }
  })
  it('field weakening: above base speed id goes negative and |v| sits at 95 % of Vdc/√3; id = 0 cannot get there', () => {
    const fw = run({ control: 'fw', n2: 5500, event: 'speed' })
    const p = fw.r.params
    expect(fw.m.idEnd).toBeLessThan(-1)
    expect(rel(fw.m.vEnd, p.vfw)).toBeLessThan(2e-3)
    expect(rel(fw.m.nEnd, 5500)).toBeLessThan(1e-3)
    const ss = steadyPmsm(p, p.w2, p.tl)
    expect(ss.fw).toBe(true)
    expect(Math.abs(fw.m.idEnd - ss.id)).toBeLessThan(1e-3 * p.imax)
    const no = run({ control: 'id0', n2: 5500, event: 'speed' })
    expect(no.m.vlimFrac).toBeGreaterThan(0.1)
    expect(no.m.nEnd).toBeLessThan(0.95 * 5500)
  })
  it('a default run is fast enough for interactive use', () => {
    simulatePmsm(PMSM_DEFAULTS)
    const t0 = cpuNow()
    simulatePmsm(PMSM_DEFAULTS)
    expect(cpuNow() - t0).toBeLessThan(3000)
    const t1 = cpuNow()
    comparePmsm(...((r) => [r, measurePmsm(r)] as const)(simulatePmsm(PMSM_DEFAULTS)))
    expect(cpuNow() - t1).toBeLessThan(3000)
  })
})

describe('PMSM: simulation vs the exact linear-loop theory', () => {
  // zeta 1.5 and the heavy load reach the current limit after the steps (frozen and sliding integrator regimes)
  const cases: Array<Partial<PmsmParams>> = [{}, { zeta: 0.7 }, { zeta: 1.5 }, { tl: 0.4, tl2: 1.0 }, { lq: 0.6e-3 }, { fcc: 300 }, { fsc: 30 }, { tl: 0.5, tl2: 0.2 }, { n2: 1200 }, { j: 3e-4 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    expect(m.vlimHit).toBe(false)
    const cmp = comparePmsm(r, m)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(10)
    for (const row of cmp.rows) {
      expect(row.expected, row.key).toBeUndefined()
      if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} tolerance ${row.tolerance}`)
    }
  })
  it('the whole speed trajectory agrees with the exact solution to RK4 accuracy', () => {
    const { r } = run()
    const ex = exactPmsm(r)
    let dev = 0
    for (let k = 0; k < r.length; k++) dev = Math.max(dev, Math.abs(r.signals.w[k] - ex.w[k]))
    expect(dev).toBeLessThan(1e-4 * r.params.w2)
  })
  it('the fast grid solver equals the shared exactPwl toolkit', () => {
    const { r } = run()
    const p = r.params
    const ex = exactPmsm(r)
    const ks = [Math.round(0.3 * r.length), Math.round(0.6 * r.length), r.length - 1]
    const ref = exactPwlAt(p, ks.map((k) => r.time[k]))
    ks.forEach((k, i) => {
      expect(Math.abs(ex.w[k] - ref[i][2])).toBeLessThan(1e-7 * p.w2)
      expect(Math.abs(ex.iq[k] - ref[i][0])).toBeLessThan(1e-7 * p.imax)
    })
  })
  it('textbook: the current loop is ωc/(s + ωc) and ζ = 1 gives 13.5 % (the current loop adds a little)', () => {
    const { r, m } = run()
    const tb = textbookPmsm(r.params)
    expect(rel(m.iqRise!, Math.log(9) / r.params.wc)).toBeLessThan(5e-3)
    expect(tb.overshoot!).toBeCloseTo(Math.exp(-2), 3)
    expect(m.overshoot!).toBeGreaterThan(tb.overshoot!)
    expect(m.overshoot!).toBeLessThan(tb.overshoot! + 0.02)
    expect(rel(tb.dip!, 0.3 / (Math.E * r.params.j * r.params.ws))).toBeLessThan(1e-3)
    expect(rel(m.dip!, tb.dip!)).toBeLessThan(0.05)
  })
  it('without decoupling, with field weakening or at the voltage limit the exact rows are explained, not checked', () => {
    // a fast current loop asks for more than Vdc/√3 at start-up only: the start-up rows are explained, the later
    // step responses (from a steady state, within the limit) are still checked
    const fast = run({ fcc: 1000 })
    expect(fast.m.vlimHit).toBe(true)
    for (const x of comparePmsm(fast.r, fast.m).rows) {
      if (['t90', 'iqRise', 'tDesat'].includes(x.key)) expect(x.expected, x.key).toBeTruthy()
      else expect(x.expected === undefined && x.pass, x.key).toBe(true)
    }
    for (const o of [{ decouple: 'off' as const }, { control: 'fw' as const, n2: 5500, event: 'speed' as const }]) {
      const { r, m } = run(o)
      const cmp = comparePmsm(r, m)
      const dyn = cmp.rows.filter((x) => ['t90', 'iqRise', 'overshoot', 'tPeak', 'tDesat'].includes(x.key))
      expect(dyn.length).toBeGreaterThan(0)
      for (const x of dyn) expect(x.expected).toBeTruthy()
      // the steady rows still hold
      for (const x of cmp.rows.filter((y) => ['nEnd', 'iqEnd', 'idEnd', 'vqEnd', 'vdEnd'].includes(y.key))) expect(x.pass, x.key).toBe(true)
    }
  })
})

describe('PMSM: explanations, lessons, experiments, predictions', () => {
  it('state, view, status, WHY, energy and readings follow the run and never contain NaN', () => {
    for (const o of [{}, { control: 'fw' as const, n2: 5500, event: 'speed' as const }, { decouple: 'off' as const }]) {
      const { r, m } = run(o)
      const phases = new Set<string>()
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 300))) {
        const st = pmsmStateAt(r, k)
        phases.add(st.phase)
        for (const row of pmsmView(st, r).rows) noBadText(row.v)
        noBadText(JSON.stringify(pmsmStatus(st)))
        for (const c of pmsmWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
        const e = pmsmEnergy(st, m, r)
        expect(Math.abs(e.balance!)).toBeLessThan(1e-6 * Math.max(1, ...e.ledger.map((x) => Math.abs(x.watts))))
        const nx = pmsmNext(r, st)
        if (nx) noBadText(nx.text)
      }
      for (const x of pmsmReadings(m, r)) noBadText(`${x.label} ${x.value} ${x.unit} ${x.note}`)
      expect(phases.has('accelerating')).toBe(true)
      expect(phases.has('regulating')).toBe(true)
      if (r.params.control === 'fw') expect(phases.has('field-weakening')).toBe(true)
    }
  })
  it('every lesson step simulates and reads the run; the checks agree with the simulation', () => {
    for (const l of PMSM_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulatePmsm({ ...PMSM_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration)
        const w = s.window?.(r)
        if (w) expect(w[1]).toBeGreaterThan(w[0])
        noBadText(s.body(pmsmStateAt(r, converterIndexAt(r, t)), measurePmsm(r), r))
      }
    }
    // foc: Te = kt·iq with id = 0 (answer 1)
    const a = run(PMSM_LESSONS[0].base).m
    expect(Math.abs(a.idEnd)).toBeLessThan(1e-9)
    expect(rel(a.teEnd, PMSM_DEFAULTS.psi * 1.5 * PMSM_DEFAULTS.pp * a.iqEnd)).toBeLessThan(1e-12)
    // loops: back at the reference after the load step (answer 1)
    const b = run(PMSM_LESSONS[1].base)
    expect(rel(b.m.wEnd, b.r.params.w2)).toBeLessThan(1e-3)
    // field weakening: id negative (answer 0)
    expect(run(PMSM_LESSONS[2].base).m.idEnd).toBeLessThan(0)
  })
  it('experiments: the verdict comes from the two simulations and is the expected one at the standard values', () => {
    for (const e of PMSM_EXPERIMENTS) {
      const p0 = { ...PMSM_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measurePmsm(simulatePmsm(p0))
      const a = measurePmsm(simulatePmsm(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
  })
  it('predictions: answers from the simulation, within tolerance of the theory shown afterwards', () => {
    for (const seed of [0, 1, 2]) {
      const [iq, rise, os, vq] = pmsmPredictions(seed)
      const sim = (t: typeof iq) => {
        const p = { ...PMSM_DEFAULTS, ...t.params }
        const m = measurePmsm(simulatePmsm(p))
        noBadText(t.theory(p))
        return { p, v: t.answer(m) }
      }
      const a = sim(iq)
      expect(rel(a.v, a.p.tl2 / (1.5 * a.p.pp * a.p.psi))).toBeLessThan(iq.tolerance!)
      const b = sim(rise)
      expect(rel(b.v, (Math.log(9) / (2 * Math.PI * b.p.fcc)) * 1e3)).toBeLessThan(rise.tolerance!)
      const c = sim(os)
      expect(rel(c.v, 100 * Math.exp(-2))).toBeLessThan(os.tolerance!)
      const d = sim(vq)
      const we = d.p.pp * ((d.p.nref * 2 * Math.PI) / 60)
      expect(rel(d.v, d.p.r * (d.p.tl / (1.5 * d.p.pp * d.p.psi)) + we * d.p.psi)).toBeLessThan(vq.tolerance!)
    }
  })
  it('the topic plugs into the shell (the convergence check may pass view = steady, periods = 1)', () => {
    const r = PMSM_TOPIC.simulate({ ...PMSM_DEFAULTS, view: 'steady', periods: 1 } as never)
    expect(r.params.periods).toBeGreaterThan(10)
    const m = PMSM_TOPIC.measure(r)
    expect(PMSM_TOPIC.readings!(m, r).length).toBeGreaterThanOrEqual(3)
    expect(rpm(r.params.w2)).toBeCloseTo(PMSM_DEFAULTS.n2, 6)
  })
})
