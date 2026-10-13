import { describe, expect, it } from 'vitest'
import { converterIndexAt } from '../src/converters/engine.ts'
import { exactScr, gateDelay, measureScr, rlCurrent, rlTimeTo, SCR_DEFAULTS, simulateScr, textbookScr, type ScrParams } from '../src/converters/devices/scr.ts'
import { compareScr, SCR_EXPERIMENTS, SCR_LESSONS, scrEnergyModel, scrNext, scrPredictions, scrReadings, scrStateAt, scrStatus, scrWhy } from '../src/converters/devices/scrContent.ts'
import { SCR_TOPIC } from '../src/topics/devicesScr.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<ScrParams> = {}) => {
  const r = simulateScr({ ...SCR_DEFAULTS, ...o })
  return { r, m: measureScr(r) }
}
const noBad = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

describe('SCR: triggering and latching', () => {
  it('the gate charge fires the SCR after td = τ·ln(IG/(IG − IGT)) (exact for the model)', () => {
    for (const ig of [0.04, 0.1, 0.5]) {
      const { r, m } = run({ test: 'latch', ig })
      expect(rel(m.td!, gateDelay(r.params))).toBeLessThan(1e-4)
    }
  })
  it('a gate current at or below IGT never fires it', () => {
    const { m } = run({ test: 'latch', ig: 0.029 })
    expect(m.td).toBeNull()
    expect(m.iaPeak).toBe(0)
  })
  it('latching needs iA ≥ IL before the gate ends: i(t) = (V − VT0)/R′·(1 − e^(−tR′/L))', () => {
    const { r } = run({ test: 'latch' })
    const twMin = gateDelay(r.params) + rlTimeTo(r.params, r.params.il)
    // just longer than needed: latches; just shorter: turns off at the gate end
    const ok = run({ test: 'latch', tw: twMin * 1.02 }).m
    const bad = run({ test: 'latch', tw: twMin * 0.98 }).m
    expect(ok.latched).toBe(true)
    expect(bad.latched).toBe(false)
    expect(bad.failedLatch).toBe(true)
    expect(rel(ok.tLatch!, twMin)).toBeLessThan(1e-4)
    // the anode current at the gate end follows the RL law from the firing instant
    expect(rel(bad.iaGateEnd, rlCurrent(r.params, twMin * 0.98 - gateDelay(r.params)))).toBeLessThan(1e-4)
  })
  it('after a failed latch the load current freewheels through Dfw and the SCR stays off', () => {
    const { r } = run({ test: 'latch', tw: 8e-6 })
    const k = r.length - 1
    expect(r.signals.ia[k]).toBe(0)
    expect(r.signals.ifw[k]).toBeGreaterThan(0)
    expect(r.modes[k].startsWith('off')).toBe(true)
  })
})

describe('SCR: holding', () => {
  it('a current below IH after the step: drops out once the charge falls below Qc; above IH it holds', () => {
    const drop = run({ test: 'hold', r2: 2500 }).m
    expect(drop.dropped).toBe(true)
    expect(drop.iDrop!).toBeLessThan(SCR_DEFAULTS.ih)
    const hold = run({ test: 'hold', r2: 1000 })
    expect(hold.m.dropped).toBe(false)
    // held at a current between IH and IL
    expect(hold.m.iEnd).toBeGreaterThan(SCR_DEFAULTS.ih)
    expect(hold.m.iEnd).toBeLessThan(SCR_DEFAULTS.il)
    expect(hold.r.signals.q[hold.r.length - 1]).toBeGreaterThan(1)
  })
  it('the drop-out time follows τ·ln((I1 − I2)/(IH − I2)) when L/R2 ≪ τ', () => {
    const { r, m } = run({ test: 'hold', r2: 2500 })
    expect(rel(m.tDrop!, textbookScr(r.params).tDrop!)).toBeLessThan(0.05)
  })
})

describe('SCR: forced commutation and tq', () => {
  it('tc > tq: turned off; tc < tq: fires again without a gate', () => {
    const ok = run().m
    expect(ok.commutated).toBe(true)
    expect(ok.refired).toBe(false)
    expect(ok.margin!).toBeGreaterThan(0)
    // the SCR recovered (q < Qc) before the forward voltage came back, at exactly the predicted tq
    expect(ok.tqRun!).toBeLessThan(ok.tc!)
    expect(rel(ok.tqRun!, ok.tq!)).toBeLessThan(1e-4)
    const bad = run({ c: 3e-6 }).m
    expect(bad.refired).toBe(true)
    expect(bad.tc!).toBeLessThan(bad.tq!)
  })
  it('the stored charge follows τ·IT (with a lag) before commutation, so tq ≈ τ·ln(IT/IH)', () => {
    const { r, m } = run()
    // q lags the rising current by τ: q0 ≈ τ·(IT − τ·diA/dt), diA/dt = (V − VT0 − (R + rT)·IT)/L
    const p = r.params
    const didt = (p.vs - p.vt0 - (p.r + p.rt) * m.iT) / p.l
    expect(rel(m.q0, p.tau * (m.iT - p.tau * didt))).toBeLessThan(1e-3)
    expect(rel(m.q0, p.tau * m.iT)).toBeLessThan(0.03)
    expect(rel(m.tq!, r.params.tau * Math.log(m.iT / r.params.ih))).toBeLessThan(0.01)
  })
  it('tc ≈ C·V/IT is the constant-current estimate; the real tc is shorter because the load current grows', () => {
    const { r, m } = run()
    const tb = textbookScr(r.params, m.iT).tc
    expect(m.tc!).toBeLessThan(tb)
    expect(m.tc!).toBeGreaterThan(0.75 * tb)
  })
  it('the power ledger balances at every sample', () => {
    for (const test of ['latch', 'hold', 'commutate'] as const) {
      const { r } = run({ test })
      for (let k = 0; k < r.length; k += 13) {
        const e = scrEnergyModel(scrStateAt(r, k), r)
        expect(Math.abs(e.balance!)).toBeLessThanOrEqual(e.tolerance)
      }
    }
  })
})

describe('SCR: simulation vs the exact PWL solution', () => {
  const cases: Array<Partial<ScrParams>> = [
    {},
    { c: 3e-6 },
    { tcom: 100e-6 },
    { tau: 20e-6 },
    { test: 'latch' },
    { test: 'latch', tw: 8e-6 },
    { test: 'latch', l: 10e-3, tw: 60e-6 },
    { test: 'hold' },
    { test: 'hold', r2: 1000 },
    { vs: 300, r: 30 },
  ]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareScr(r, m)
    // 0.5 %: event times and currents of the same piecewise-linear system
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(2)
    // the qualitative outcome is the same as well
    const ex = exactScr(r.params)
    expect([ex.latched, ex.refired, ex.dropped, ex.failedLatch]).toEqual([m.latched, m.refired, m.dropped, m.failedLatch])
  })
})

describe('SCR: lessons, WHY, experiments, predictions', () => {
  it('the checks are confirmed by the simulation', () => {
    // 1: the SCR conducts only after a delay
    expect(run({ test: 'latch' }).m.td!).toBeGreaterThan(0)
    // 2: a larger L needs a longer pulse
    expect(run({ test: 'latch', tw: 20e-6 }).m.latched).toBe(true)
    expect(run({ test: 'latch', tw: 20e-6, l: 10e-3 }).m.latched).toBe(false)
    // 3: a current between IH and IL keeps it on
    expect(run({ test: 'hold', r2: 1000 }).m.dropped).toBe(false)
    // 4: tc must exceed tq
    expect(run({ c: 3e-6 }).m.refired).toBe(true)
  })
  it('every lesson step, WHY card, status, reading and next consequence reads real numbers', () => {
    for (const l of SCR_LESSONS) {
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulateScr({ ...SCR_DEFAULTS, ...l.base, ...s.params })
        const m = measureScr(r)
        noBad(s.body(scrStateAt(r, converterIndexAt(r, s.at(r))), m, r))
        const w = s.window!(r)
        expect(w[1]).toBeGreaterThan(w[0])
      }
    }
    const seen = new Set<string>()
    for (const test of ['latch', 'hold', 'commutate'] as const)
      for (const extra of [{}, { c: 3e-6 }, { tw: 8e-6 }]) {
        const { r, m } = run({ test, ...extra })
        for (let k = 0; k < r.length; k += 40) {
          const st = scrStateAt(r, k)
          seen.add(st.phase)
          for (const c of scrWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBad(t)
          const s = scrStatus(st)
          noBad(s.headline + s.facts.join())
          const n = scrNext(r, st, m)
          if (n) {
            noBad(n.text)
            if (n.time !== null) expect(n.time).toBeGreaterThanOrEqual(r.time[k] - r.params.dt)
          }
        }
        for (const x of scrReadings(m, r)) noBad(x.value + x.unit)
      }
    expect([...seen].sort()).toEqual(['ON, held by the gate', 'blocking', 'commutating', 'gate charging', 'latched', 'turned off'].sort())
  })
  it('the experiments’ verdicts come from the before/after runs', () => {
    const expected: Record<string, number> = { cap: 0, gate: 0, tau: 0 }
    for (const e of SCR_EXPERIMENTS) {
      const p0 = { ...SCR_DEFAULTS }
      const b = measureScr(simulateScr(p0))
      const a = measureScr(simulateScr({ ...p0, ...e.change(p0) }))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, expected[e.id]])
      noBad(e.why(b, a, p0, { ...p0, ...e.change(p0) }))
    }
  })
  it('predictions: answers from the simulation agree with the theory shown after', () => {
    for (const seed of [0, 1, 2]) {
      for (const t of scrPredictions(seed)) {
        const r = simulateScr({ ...SCR_DEFAULTS, ...t.params })
        const m = measureScr(r)
        const ans = t.answer(m)
        expect(Number.isFinite(ans)).toBe(true)
        noBad(t.theory(r.params))
        const p = r.params
        if (t.id === 'td') expect(rel(ans, gateDelay(p))).toBeLessThan(t.tolerance!)
        if (t.id === 'latch') expect(ans).toBe(p.tw > gateDelay(p) + rlTimeTo(p, p.il) ? 0 : 1)
        if (t.id === 'hold') expect(ans).toBe((p.vs - p.vt0) / (p.r2 + p.rt) > p.ih ? 0 : 1)
        if (t.id === 'commutate') expect(ans).toBe(m.tc! > m.tq! ? 0 : 1)
      }
    }
  })
  it('the topic: ≥ 2 lessons, ≥ 2 experiments, ≥ 3 predictions, readings for each test', () => {
    expect(SCR_TOPIC.lessons.length).toBeGreaterThanOrEqual(2)
    expect(SCR_TOPIC.experiments.length).toBeGreaterThanOrEqual(2)
    expect(SCR_TOPIC.predictions(0).length).toBeGreaterThanOrEqual(3)
    for (const test of ['latch', 'hold', 'commutate'] as const) {
      const r = SCR_TOPIC.simulate({ ...SCR_DEFAULTS, test })
      const rd = SCR_TOPIC.readings!(SCR_TOPIC.measure(r), r)
      expect(rd.length).toBeGreaterThanOrEqual(3)
    }
  })
  it('a default run is fast enough for interactive use', () => {
    simulateScr(SCR_DEFAULTS)
    const t0 = cpuNow()
    measureScr(simulateScr({ ...SCR_DEFAULTS, vs: 101 }))
    expect(cpuNow() - t0).toBeLessThan(3000)
  })
})
