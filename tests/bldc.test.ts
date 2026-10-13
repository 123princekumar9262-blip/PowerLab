import { describe, expect, it } from 'vitest'
import { BLDC_EXPERIMENTS, BLDC_LESSONS, bldcEnergy, bldcNext, bldcPath, bldcPredictions, bldcReadings, bldcStateAt, bldcStatus, bldcView, bldcWhy, compareBldc } from '../src/converters/bldc/content.ts'
import { averagedSteady, BLDC_DEFAULTS, lastCycle, measureBldc, rpm, SECTORS, simulateBldc, type BldcParams } from '../src/converters/bldc/model.ts'
import { exactBldc, textbookBldc } from '../src/converters/bldc/theory.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { BLDC_TOPIC } from '../src/topics/bldc.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<BldcParams> = {}) => {
  const r = simulateBldc({ ...BLDC_DEFAULTS, ...o })
  return { r, m: measureBldc(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const rel = (a: number, b: number) => Math.abs(a / b - 1)

describe('BLDC: physics of the simulation', () => {
  it('energy is conserved over the run: supply = copper + friction + load + rotor + windings', () => {
    for (const o of [{}, { chop: 'none' as const }, { event: 'load' as const }, { event: 'duty' as const }]) expect(Math.abs(run(o).m.balance)).toBeLessThan(1e-8)
  })
  it('the Hall sensors give six codes per cycle, one bit changing at a time, never 000 or 111', () => {
    const { r } = run({ chop: 'none' })
    const c = lastCycle(r)!
    const codes = r.halls.filter((h) => h.t > c[0].t - 1e-12 && h.t <= c[1].t).map((h) => SECTORS[h.sector].hall.join(''))
    expect(new Set(codes).size).toBe(6)
    for (const code of codes) expect(['000', '111']).not.toContain(code)
    for (let i = 1; i < SECTORS.length; i++) {
      const a = SECTORS[i - 1].hall
      const b = SECTORS[i].hall
      expect(a.filter((x, k) => x !== b[k]).length).toBe(1)
    }
  })
  it('two phases conduct between commutations; with both back-EMFs flat the torque is exactly 2·ke·I', () => {
    const { r } = run({ chop: 'none' })
    const p = r.params
    const c = lastCycle(r)!
    let two = 0
    let n = 0
    for (let k = Math.ceil(c[0].t / p.dt); k <= Math.floor(c[1].t / p.dt); k++) {
      n++
      if (r.nconn[k] !== 2) continue
      two++
      const st = bldcStateAt(r, k)
      expect(Math.abs(st.te - 2 * p.ke * Math.abs(st.i[st.hi])) / Math.abs(st.te)).toBeLessThan(1e-9)
      // the off phase carries nothing
      expect(st.i[SECTORS[st.sector].off]).toBe(0)
    }
    expect(two / n).toBeGreaterThan(0.6)
  })
  it('quasi-square phase currents: each phase is off for about a third of the cycle (less the commutation tails)', () => {
    const { r } = run({ chop: 'none' })
    const c = lastCycle(r)!
    let off = 0
    let n = 0
    for (let k = Math.ceil(c[0].t / r.params.dt); k <= Math.floor(c[1].t / r.params.dt); k++) {
      n++
      if (r.signals.ia[k] === 0) off++
    }
    expect(off / n).toBeGreaterThan(0.2)
    expect(off / n).toBeLessThan(1 / 3 + 0.01)
  })
  it('steady state: mean torque = TL + B·ω, and at no load (six-step) the speed is Vdc/(2·ke)', () => {
    const { r, m } = run()
    expect(m.settled).toBe(true)
    expect(rel(m.teMean, r.params.tl + r.params.b * m.wEnd)).toBeLessThan(2e-3)
    for (const vdc of [12, 36]) {
      const nl = run({ chop: 'none', tl: 0, vdc })
      const p = nl.r.params
      expect(rel(nl.m.wEnd, averagedSteady(p, 1, 0).w)).toBeLessThan(0.005)
      expect(rel(nl.m.wEnd, p.vdc / (2 * p.ke))).toBeLessThan(0.01)
    }
  })
  it('PWM at no load: the chopped current stops in the off-times (discontinuous) and the speed rises above d·Vdc/(2·ke)', () => {
    const { r, m } = run({ tl: 0, duty: 0.5 })
    expect(m.dcm).toBe(true)
    expect(m.wEnd).toBeGreaterThan(1.05 * averagedSteady(r.params, 0.5, 0).w)
    // the compare rows are then explained, not checked
    for (const row of compareBldc(r, m).rows) expect(row.expected).toBeTruthy()
    expect(run().m.dcm).toBe(false)
  })
  it('loaded: the speed is below the textbook value d·Vdc = 2·ke·ω + 2·R·I (the commutations cost voltage and torque)', () => {
    for (const o of [{}, { chop: 'none' as const }, { tl: 0.3 }]) {
      const { r, m } = run(o)
      const tb = textbookBldc(r.params)
      expect(m.wEnd).toBeLessThan(tb.w)
      expect(m.wEnd).toBeGreaterThan(0.8 * tb.w)
    }
  })
  it('commutation: the torque dips; at heavy load R·I decides it, not the textbook sign of Vdc − 4E', () => {
    const hi = run({ chop: 'none' }) // light load, high speed: 4E ≈ 40 V > 24 V
    expect(4 * hi.r.params.ke * hi.m.wEnd).toBeGreaterThan(hi.r.params.vdc)
    expect(hi.m.dipUp!).toBeLessThan(-0.2)
    expect(hi.m.dipLow!).toBeLessThan(-0.2)
    expect(textbookBldc(hi.r.params).dipUp).toBeLessThan(0)
    // heavy load, low speed: 4E < Vdc, so the R-free formula predicts a RISE — but with R the common phase obeys
    // L·d|ic|/dt = (Vdc − 4E)/3 − R·I < 0 (in steady state Vdc ≈ 2E + 2RI): the simulation and the exact theory dip
    const lo = run({ chop: 'none', tl: 1.0 })
    const p = lo.r.params
    expect(4 * p.ke * lo.m.wEnd).toBeLessThan(p.vdc)
    expect(textbookBldc(p).dipUp).toBeGreaterThan(0)
    expect((p.vdc - 4 * p.ke * lo.m.wEnd) / 3 - p.r * lo.m.iPair).toBeLessThan(0)
    expect(lo.m.dipUp!).toBeLessThan(0)
    expect(Math.abs(lo.m.dipUp! - exactBldc(p).dipUp!)).toBeLessThan(0.01)
  })
  it('start-up: a large inrush current, bounded by the locked-rotor value d·Vdc/(2R)', () => {
    const { r, m } = run()
    expect(m.iPeak).toBeGreaterThan(5 * m.iPeakCycle)
    expect(m.iPeak).toBeLessThan((r.params.duty * r.params.vdc) / (2 * r.params.r))
    expect(m.t90).not.toBeNull()
  })
  it('load and duty steps move the speed the right way', () => {
    const a = run({ event: 'load' }).m
    expect(a.wPre!).toBeGreaterThan(a.wEnd)
    const b = run({ event: 'duty' }).m
    expect(b.wEnd / b.wPre!).toBeGreaterThan(0.45)
    expect(b.wEnd / b.wPre!).toBeLessThan(0.7)
  })
  it('a default run is fast enough for interactive use', () => {
    simulateBldc(BLDC_DEFAULTS) // warm-up
    const t0 = cpuNow()
    simulateBldc(BLDC_DEFAULTS)
    const ms = cpuNow() - t0
    expect(ms).toBeLessThan(3000)
  })
})

describe('BLDC: simulation vs the exact frozen-speed theory', () => {
  // six-step: the theory is the same model at the cycle's speed — tight tolerances (0.2 % means, 0.5 % commutation)
  const sixStep: Array<Partial<BldcParams>> = [{ chop: 'none' }, { chop: 'none', tl: 0.3 }, { chop: 'none', l: 2e-3 }, { chop: 'none', vdc: 48, ke: 0.06, pp: 2, j: 1e-4 }, { chop: 'none', tl: 1.0 }]
  // PWM: the theory averages the chopped switch; tolerances grow with Ts/tc (see bldcTolerances)
  const pwm: Array<Partial<BldcParams>> = [{}, { duty: 0.5 }, { tl: 0.3 }, { event: 'load' }, { fs: 50e3 }, { event: 'duty' }]
  it.each([...sixStep, ...pwm].map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    expect(m.settled).toBe(true)
    const cmp = compareBldc(r, m)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(6)
    // rows marked "expected" (instantaneous torque with the PWM ripple) are explained, not checked
    for (const row of cmp.rows) if (!row.pass && !row.expected) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} tolerance ${row.tolerance}`)
    if (c.chop === 'none') expect(cmp.rows.every((x) => !x.expected)).toBe(true)
  })
  it('six-step agreement is much tighter than the tolerances', () => {
    const { r, m } = run({ chop: 'none' })
    const ex = exactBldc(r.params)
    expect(rel(m.wEnd, ex.w)).toBeLessThan(2e-4)
    expect(rel(m.ripple, ex.ripple)).toBeLessThan(5e-3)
    expect(rel(m.tcUp!, ex.tcUp!)).toBeLessThan(2e-3)
    expect(rel(m.tcLow!, ex.tcLow!)).toBeLessThan(2e-3)
    expect(Math.abs(m.dipUp! - ex.dipUp!)).toBeLessThan(2e-3)
    expect(Math.abs(m.dipLow! - ex.dipLow!)).toBeLessThan(2e-3)
  })
  it('with PWM the difference is the switching ripple: it shrinks as the PWM frequency rises', () => {
    const err = (fs: number) => {
      const { r, m } = run({ fs })
      const ex = exactBldc(r.params)
      return { tc: rel(m.tcUp!, ex.tcUp!), ripple: rel(m.ripple, ex.ripple), w: rel(m.wEnd, ex.w) }
    }
    const a = err(10e3)
    const b = err(50e3)
    expect(b.tc).toBeLessThan(a.tc)
    expect(b.ripple).toBeLessThan(a.ripple)
    expect(b.w).toBeLessThan(a.w)
  })
  it('the exact theory conserves energy: Vdc·ī_dc = Te·ω + 3·R·I²rms', () => {
    for (const o of [{ chop: 'none' as const }, {}]) {
      const { r } = run(o)
      const ex = exactBldc(r.params)
      expect(rel(ex.idc * r.params.vdc, ex.te * ex.w + 3 * r.params.r * ex.irms ** 2)).toBeLessThan(1e-5)
    }
  })
  it('the textbook formulas are close but leave out R and the sloping EMF during the commutation', () => {
    const { r, m } = run({ chop: 'none' })
    const tb = textbookBldc(r.params)
    expect(rel(m.tcUp!, tb.tcUp)).toBeLessThan(0.35)
    expect(Math.sign(tb.dipUp)).toBe(-1)
    expect(rel(m.iPair, tb.i)).toBeLessThan(0.1)
  })
})

describe('BLDC: explanations, lessons, experiments, predictions', () => {
  it('state, view, status, path, WHY, energy and readings follow the run and never contain NaN', () => {
    for (const o of [{}, { chop: 'none' as const }, { event: 'duty' as const }]) {
      const { r, m } = run(o)
      const phases = new Set<string>()
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 300))) {
        const st = bldcStateAt(r, k)
        phases.add(st.phase)
        for (const row of bldcView(st, r).rows) noBadText(row.v)
        noBadText(JSON.stringify(bldcStatus(st, r)))
        noBadText(JSON.stringify(bldcPath(st, r)))
        for (const c of bldcWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
        const e = bldcEnergy(st, m, r)
        expect(Math.abs(e.balance!)).toBeLessThan(1e-6 * Math.max(1, ...e.ledger.map((x) => Math.abs(x.watts))))
        const nx = bldcNext(r, st)
        if (nx) noBadText(nx.text)
      }
      for (const x of bldcReadings(m, r)) noBadText(`${x.label} ${x.value} ${x.unit} ${x.note}`)
      expect(phases.has('commutating')).toBe(true)
      if (r.params.chop === 'pwm') expect(phases.has('freewheel')).toBe(true)
    }
  })
  it('every lesson step simulates and reads the run; the checks agree with the simulation', () => {
    for (const l of BLDC_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulateBldc({ ...BLDC_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration)
        const w = s.window?.(r)
        if (w) expect(w[1]).toBeGreaterThan(w[0])
        noBadText(s.body(bldcStateAt(r, converterIndexAt(r, t)), measureBldc(r), r))
      }
    }
    // six-step: two phases carry the current between commutations (answer 1)
    const six = run({ chop: 'none' }).r
    const k = converterIndexAt(six, BLDC_LESSONS[0].steps[1].at(six))
    expect(six.nconn[k]).toBe(2)
    // commutation: the outgoing current decays through a diode over a finite time (answer 1)
    const cm = six.comms.filter((c) => c.tEnd !== null)
    expect(cm.length).toBeGreaterThan(6)
    for (const c of cm.slice(-6)) expect(c.tEnd! - c.tHall).toBeGreaterThan(0)
    // speed: 80 % → 50 % duty lowers the speed roughly in proportion (answer 0)
    const sp = run(BLDC_LESSONS[2].base).m
    expect(sp.wEnd / sp.wPre!).toBeGreaterThan(0.45)
    expect(sp.wEnd / sp.wPre!).toBeLessThan(0.7)
  })
  it('experiments: the verdict comes from the two simulations and is the expected one at the standard values', () => {
    for (const e of BLDC_EXPERIMENTS) {
      const p0 = { ...BLDC_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureBldc(simulateBldc(p0))
      const a = measureBldc(simulateBldc(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
  })
  it('predictions: answers from the simulation, theory text close to it', () => {
    for (const seed of [0, 1, 2]) {
      const tasks = bldcPredictions(seed)
      expect(tasks.length).toBeGreaterThanOrEqual(3)
      for (const t of tasks) {
        const p = { ...BLDC_DEFAULTS, ...t.params }
        const m = measureBldc(simulateBldc(p))
        const ans = t.answer(m)
        expect(Number.isFinite(ans)).toBe(true)
        noBadText(t.theory(p))
        if (t.kind === 'choice') expect(ans).toBeGreaterThanOrEqual(0)
      }
    }
    const [noload, current, hall, dip] = bldcPredictions(0)
    const p0 = { ...BLDC_DEFAULTS, ...noload.params }
    expect(rel(noload.answer(measureBldc(simulateBldc(p0))), rpm(p0.vdc / (2 * p0.ke)))).toBeLessThan(noload.tolerance!)
    const p1 = { ...BLDC_DEFAULTS, ...current.params }
    expect(rel(current.answer(measureBldc(simulateBldc(p1))), p1.tl / (2 * p1.ke))).toBeLessThan(current.tolerance!)
    const p2 = { ...BLDC_DEFAULTS, ...hall.params }
    expect(rel(hall.answer(measureBldc(simulateBldc(p2))), (p2.pp * p2.vdc) / (2 * p2.ke) / (2 * Math.PI))).toBeLessThan(hall.tolerance!)
    expect(dip.answer(measureBldc(simulateBldc({ ...BLDC_DEFAULTS, ...dip.params })))).toBe(0)
  })
  it('the topic plugs into the shell: the convergence check and the experiment runner may pass view = steady', () => {
    const r = BLDC_TOPIC.simulate({ ...BLDC_DEFAULTS, view: 'steady', periods: 1 } as never)
    expect(r.params.periods).toBeGreaterThan(100)
    expect(BLDC_TOPIC.readings!(BLDC_TOPIC.measure(r), r)).toHaveLength(4)
  })
})
