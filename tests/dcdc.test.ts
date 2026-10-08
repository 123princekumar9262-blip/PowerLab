import { describe, expect, it } from 'vitest'
import { compareDcdc } from '../src/converters/dcdc/compare.ts'
import { dcdcStateAt, dcdcWhy, voltSecondFromSim } from '../src/converters/dcdc/explain.ts'
import { BOOST_LESSONS, BUCK_BOOST_LESSONS, dcdcExperiments, dcdcLessonTime, dcdcPredictTasks } from '../src/converters/dcdc/learn.ts'
import { measureDcdc } from '../src/converters/dcdc/measure.ts'
import { dcdcModel } from '../src/converters/dcdc/model.ts'
import { dcdcBoundary, dcdcExact, dcdcTextbook, dcdcVoutEstimate } from '../src/converters/dcdc/theory.ts'
import { converterIndexAt, simulateCircuit } from '../src/converters/engine.ts'
import { DCDC_DEFAULTS, resolveConverter } from '../src/converters/params.ts'
import type { ConverterKind, ConverterParams, ConverterResult } from '../src/converters/types.ts'
import { dcdcTopic } from '../src/topics/dcdc.tsx'

const KINDS: Array<Exclude<ConverterKind, 'buck'>> = ['boost', 'buck-boost']
const sim = (kind: ConverterKind, o: Partial<ConverterParams> = {}) => simulateCircuit(dcdcModel(kind), { ...DCDC_DEFAULTS[kind], ...o })
const run = (kind: ConverterKind, o: Partial<ConverterParams> = {}) => {
  const r = sim(kind, o)
  return { r, m: measureDcdc(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe.each(KINDS)('%s: circuit physics from the simulation', (kind) => {
  const { r } = run(kind)
  const s = r.signals
  it('KCL: iL = iQ + iD at the switch node; the output gets iD (boost) or loses it (buck-boost)', () => {
    for (let k = 0; k < r.length; k++) {
      expect(Math.abs(s.il[k] - s.iq[k] - s.id[k])).toBeLessThan(1e-9)
      const feed = kind === 'boost' ? s.id[k] : -s.id[k]
      expect(Math.abs(feed - s.ic[k] - s.io[k])).toBeLessThan(1e-9)
    }
  })
  it('the inductor voltage is the right node difference (boost: Vin − vsw; buck-boost: vsw)', () => {
    for (let k = 0; k < r.length; k += 7) expect(s.vl[k]).toBeCloseTo(kind === 'boost' ? r.params.vin - s.vsw[k] : s.vsw[k], 9)
  })
  it('Q1 follows its gate; D1 never conducts backwards; the output polarity is right', () => {
    for (let k = 0; k < r.length; k++) {
      expect(r.devices[0].on[k]).toBe(s.gate[k])
      expect(s.id[k]).toBeGreaterThanOrEqual(-1e-12)
    }
    const m = measureDcdc(r)
    if (kind === 'boost') expect(m.voutAvg).toBeGreaterThan(r.params.vin)
    else expect(m.voutAvg).toBeLessThan(0)
  })
  it('periodic steady state by shooting, no inconsistent steps', () => {
    expect(r.diagnostics.steady.method).toBe('shooting')
    expect(r.diagnostics.steady.residual).toBeLessThan(1e-8)
    expect(r.diagnostics.fallbacks).toBe(0)
  })
  it('a start-up run settles to the same averages', () => {
    const st = run(kind, { view: 'startup' })
    expect(st.r.diagnostics.steady.converged).toBe(true)
    expect(Math.abs(st.m.voutAvg - run(kind).m.voutAvg) / Math.abs(run(kind).m.voutAvg)).toBeLessThan(0.01)
  })
  it('volt-second balance holds in the simulated data', () => {
    for (const o of [{}, { r: 300 }, { devices: 'real' as const }]) {
      const vs = voltSecondFromSim(sim(kind, o))
      expect(Math.abs(vs.vlAvg)).toBeLessThan(2e-4)
    }
  })
})

describe.each(KINDS)('%s: simulation agrees with the exact analytic solution', (kind) => {
  const grid: Array<Partial<ConverterParams>> = []
  for (const duty of [0.1, 0.3, 0.5, 0.7, 0.85]) for (const r of [kind === 'boost' ? 6 : 3, 24, 120, 600]) grid.push({ duty, r })
  grid.push({ devices: 'real' }, { devices: 'real', rl: 0.1, esr: 0.05 }, { l: 20e-6 }, { c: 10e-6 }, { fs: 200e3 }, { esr: 0.2 })
  it.each(grid.map((g) => [JSON.stringify(g), g] as const))('%s', (_n, g) => {
    const { r, m } = run(kind, g)
    const c = compareDcdc(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    expect(c.modeAgrees).toBe(true)
  })
  it('second-order convergence: the error falls ~4× when Δt halves', () => {
    const err = [100, 200, 400].map((spp) => {
      const { r, m } = run(kind, { stepsPerPeriod: spp, periods: 1 })
      return compareDcdc(r, m).rows.find((x) => x.key === 'ilAvg')!.error
    })
    expect(err[1] / err[0]).toBeLessThan(0.5)
    expect(err[2] / err[1]).toBeLessThan(0.5)
  })
})

describe('boost and buck-boost: textbook relations where their assumptions hold', () => {
  it('ideal CCM conversion laws (small ripple): boost Vin/(1 − D), buck-boost −D·Vin/(1 − D)', () => {
    for (const kind of KINDS)
      for (const duty of [0.3, 0.5, 0.7]) {
        const { r, m } = run(kind, { duty, l: 2e-3, c: 2e-3 })
        const tb = dcdcTextbook(r.params)
        expect(m.mode).toBe('CCM')
        expect(Math.abs(m.voutAvg - tb.voutAvg.value!) / Math.abs(tb.voutAvg.value!)).toBeLessThan(0.002)
        expect(Math.abs(m.ilAvg - tb.ilAvg.value!) / tb.ilAvg.value!).toBeLessThan(0.003)
        expect(Math.abs(m.ilPP - tb.ilPP.value!) / tb.ilPP.value!).toBeLessThan(0.01)
        expect(Math.abs(m.voutPP - tb.voutPP.value!) / tb.voutPP.value!).toBeLessThan(0.03)
      }
  })
  it('CCM/DCM boundary: L 10 % above Lcrit is CCM, 10 % below is DCM', () => {
    for (const kind of KINDS) {
      const p = resolveConverter({ ...DCDC_DEFAULTS[kind] }, kind).params
      const lc = dcdcBoundary(p).lCrit
      expect(run(kind, { l: lc * 1.1 }).m.mode).toBe('CCM')
      expect(run(kind, { l: lc * 0.9 }).m.mode).toBe('DCM')
    }
  })
  it('ideal DCM relations: Vout and D2', () => {
    for (const kind of KINDS)
      for (const r of [150, 600]) {
        const { r: rr, m } = run(kind, { r, c: 1e-3 })
        const tb = dcdcTextbook(rr.params)
        expect(m.mode).toBe('DCM')
        expect(Math.abs(m.voutAvg - tb.voutAvg.value!) / Math.abs(tb.voutAvg.value!)).toBeLessThan(0.01)
        expect(Math.abs(m.d2 - tb.d2.value!)).toBeLessThan(0.01)
      }
  })
  it('the boost ripple formula is flagged where iL dips below the load current', () => {
    const tb = dcdcTextbook(resolveConverter({ ...DCDC_DEFAULTS.boost, duty: 0.2 }, 'boost').params)
    expect(tb.voutPP.notApplicable).toMatch(/discharges/)
  })
  it('ESTIMATED Vout with device drops is within 1 % of the simulation (real devices, CCM)', () => {
    for (const kind of KINDS) {
      const { r, m } = run(kind, { devices: 'real', rl: 0.05, l: 1e-3, c: 1e-3 })
      expect(Math.abs(dcdcVoutEstimate(r.params) - m.voutAvg) / Math.abs(m.voutAvg)).toBeLessThan(0.01)
    }
  })
  it('energy: Pin = Pout + losses (simulation) and η matches the exact theory', () => {
    for (const kind of KINDS) {
      const { r, m } = run(kind, { devices: 'real', rl: 0.05 })
      expect(Math.abs(m.pinAvg - m.poutAvg - m.losses.total) / m.pinAvg).toBeLessThan(0.002)
      expect(Math.abs(m.efficiency - dcdcExact(r.params).metrics.efficiency)).toBeLessThan(0.002)
    }
  })
})

describe('boost and buck-boost: explanations and content from the simulation', () => {
  const at = (r: ConverterResult, part: 'on' | 'off' | 'idle') => {
    const p = r.params
    const u = part === 'on' ? 0.5 * p.duty : part === 'off' ? p.duty + 0.03 * (1 - p.duty) : 0.985
    return dcdcStateAt(r, converterIndexAt(r, (1 + u) * p.ts))
  }
  it.each(KINDS)('%s: WHY follows the interval and never contains NaN', (kind) => {
    const r = sim(kind)
    const m = measureDcdc(r)
    expect(dcdcWhy(r, at(r, 'on'), m)[0].question).toBe('Why is D1 OFF?')
    expect(dcdcWhy(r, at(r, 'off'), m)[0].question).toBe('Why did D1 turn ON?')
    const rd = sim(kind, { r: 600 })
    const idle = at(rd, 'idle')
    expect(idle.interval).toBe('idle')
    expect(idle.vsw).toBeCloseTo(kind === 'boost' ? rd.params.vin : 0, 3)
    for (let k = 0; k < r.length; k += 11) for (const c of dcdcWhy(r, dcdcStateAt(r, k), m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
  })
  it('lessons land the cursor in their interval with values in the text', () => {
    for (const [kind, lessons] of [
      ['boost', BOOST_LESSONS],
      ['buck-boost', BUCK_BOOST_LESSONS],
    ] as const)
      for (const l of lessons)
        for (const s of l.steps) {
          const r = sim(kind, { ...l.base, ...s.params })
          const st = dcdcStateAt(r, converterIndexAt(r, dcdcLessonTime(s.at, r.params)))
          if (s.at[0] === 'on') expect(st.interval).toBe('on')
          else expect(st.interval).not.toBe('on')
          noBadText(s.body(st, measureDcdc(r), r))
        }
  })
  it('experiments: from the defaults the simulation confirms the expected answer', () => {
    for (const kind of KINDS)
      for (const e of dcdcExperiments(kind)) {
        const p0 = { ...DCDC_DEFAULTS[kind] }
        const p1 = { ...p0, ...e.change(p0) }
        const before = measureDcdc(sim(kind, p0))
        const after = measureDcdc(sim(kind, p1))
        expect([kind, e.id, e.judge(before, after)]).toEqual([kind, e.id, 0])
        noBadText(e.why(before, after, p0, p1))
      }
  })
  it('predictions are answered by the simulation, with a theory line', () => {
    for (const kind of KINDS)
      for (let seed = 1; seed <= 4; seed++)
        for (const t of dcdcPredictTasks(kind, seed)) {
          const p = { ...DCDC_DEFAULTS[kind], ...t.params }
          expect(Number.isFinite(t.answer(measureDcdc(sim(kind, p))))).toBe(true)
          noBadText(t.theory(p))
        }
  })
  it('every DC-DC topic renders its state view and compare rows', () => {
    for (const kind of ['buck', ...KINDS] as ConverterKind[]) {
      const topic = dcdcTopic(kind)
      const r = topic.simulate(topic.defaults)
      const m = topic.measure(r)
      const v = topic.view(topic.state(r, 50), r, 'engineer')
      expect(v.rows.length).toBeGreaterThan(8)
      expect(topic.analyze.compare(r, m).allPass).toBe(true)
    }
  })
})
