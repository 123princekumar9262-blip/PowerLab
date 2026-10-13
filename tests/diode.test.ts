import { describe, expect, it } from 'vitest'
import { closedFormDiode, VT_25C, diodeCurrentLambert, diodeCurrentNewton, DIODE_DEFAULTS, exactDiode, ivCurve, measureDiode, shockleyV, simulateDiode, TB_FACTOR, type DiodeParams } from '../src/converters/devices/diode.ts'
import { compareDiode, DIODE_EXPERIMENTS, DIODE_LESSONS, diodeEnergyModel, diodeNext, diodePredictions, diodeReadings, diodeStateAt, diodeStatus, diodeWhy } from '../src/converters/devices/diodeContent.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { DIODE_TOPIC } from '../src/topics/devicesDiode.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<DiodeParams> = {}) => {
  const r = simulateDiode({ ...DIODE_DEFAULTS, ...o })
  return { r, m: measureDiode(r) }
}
const noBad = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

describe('diode: static I–V', () => {
  it('Newton (implicit Shockley + Rs) agrees with the Lambert-W closed form', () => {
    for (const q of [DIODE_DEFAULTS, { isat: 1e-12, n: 1, rs: 0.002 }, { isat: 1e-7, n: 2.2, rs: 0.1 }]) {
      for (const x of ivCurve({ ...(q as typeof DIODE_DEFAULTS), i0: 30 } as never, 40)) if (x.iLambert > 1e-9) expect(rel(x.iNewton, x.iLambert)).toBeLessThan(1e-9)
    }
  })
  it('the explicit v(i) and the solved i(v) are inverses; the run’s forward drop is Vf(I0)', () => {
    const p = { isat: 1e-9, n: 1.8, rs: 0.01 }
    for (const i of [0.01, 1, 20, 80]) expect(rel(diodeCurrentNewton(p, shockleyV(p, i)), i)).toBeLessThan(1e-10)
    expect(rel(diodeCurrentLambert({ ...p, rs: 0 }, 0.5), 1e-9 * Math.expm1(0.5 / (1.8 * VT_25C)))).toBeLessThan(1e-12)
    const { r, m } = run()
    expect(m.vf).toBeCloseTo(shockleyV(r.params, r.params.i0), 10)
  })
})

describe('diode: reverse-recovery physics', () => {
  it('the commutation has its phases in order: fall, reverse current, recovery', () => {
    const { r, m } = run()
    expect(r.pwlEvents.map((e) => `${e.from}→${e.to}`)).toEqual(['Fp|off→Fp|sat', 'Fp|sat→Fn|sat', 'Fn|sat→R|ohm'])
    expect(m.t0!).toBeLessThan(m.tRec!)
    expect(m.irr!).toBeGreaterThan(0.2 * r.params.i0)
    expect(m.limit).toBe('gate')
  })
  it('KCL iQ + iD = I0 and the power ledger balances at every sample', () => {
    const { r } = run()
    for (let k = 0; k < r.length; k += 7) {
      expect(r.signals.iq[k] + r.signals.id[k]).toBeCloseTo(r.params.i0, 9)
      const e = diodeEnergyModel(diodeStateAt(r, k), r)
      expect(Math.abs(e.balance!)).toBeLessThanOrEqual(e.tolerance)
    }
  })
  it('charge: the recovered charge is the area of the reverse current; the stored charge is τ·I0', () => {
    const { r, m } = run()
    let q = 0
    for (let k = 1; k < r.length; k++) q -= 0.5 * (Math.min(0, r.signals.id[k - 1]) + Math.min(0, r.signals.id[k])) * r.params.dt
    expect(rel(q, m.qrr)).toBeLessThan(0.01)
    expect(rel(m.qStored, r.params.tau * r.params.i0)).toBeLessThan(1e-9)
    // only part of the stored charge is recovered: the rest recombines
    expect(m.qrr).toBeLessThan(m.qStored)
  })
  it('limit cases: a short lifetime recovers little; a charge-free diode costs less; more lifetime, more charge', () => {
    const fast = run({ tau: 5e-9 }).m
    const base = run().m
    const slow = run({ tau: 100e-9 }).m
    expect(fast.qrr).toBeLessThan(base.qrr)
    expect(slow.qrr).toBeGreaterThan(2 * base.qrr)
    expect(fast.deon).toBeLessThan(base.deon)
    for (const m of [fast, base, slow]) expect(m.eon).toBeGreaterThan(m.eon0)
    // the reference (charge-free diode) does not depend on τ
    expect(rel(fast.eon0, slow.eon0)).toBeLessThan(0.02)
  })
  it('a fast switch: the loop inductance limits di/dt to ≈ Vdc/Ls', () => {
    const { r, m } = run({ didt: 20000e6 })
    expect(m.limit).toBe('loop')
    expect(rel(m.didt!, r.params.vdc / r.params.ls)).toBeLessThan(0.02)
  })
})

describe('diode: simulation vs the exact PWL solution', () => {
  const cases: Array<Partial<DiodeParams>> = [{}, { didt: 3000e6 }, { didt: 20000e6 }, { tm: 2e-9 }, { tau: 100e-9 }, { ls: 1e-6 }, { i0: 5, vdc: 100 }, { tau: 5e-9, tm: 30e-9 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareDiode(r, m)
    // 0.5 % for times, currents, charges, voltages; 1 % for energies (the power jumps at the recovery instant
    // and the two methods integrate across it differently)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(10)
  })
  it('converges: the error of Irr and Qrr falls with the time step', () => {
    const e = (spp: number) => {
      const r = simulateDiode({ ...DIODE_DEFAULTS, stepsPerPeriod: spp })
      const ex = exactDiode(r.params)
      const m = measureDiode(r)
      return Math.abs(m.qrr - ex.qrr) / ex.qrr
    }
    expect(e(12000)).toBeLessThan(e(3000))
  })
})

describe('diode: the closed form for a constant slope, and the textbook relations', () => {
  it.each([[{}], [{ tau: 50e-9 }], [{ tm: 3e-9 }], [{ i0: 40, didt: 500e6 }]] as Array<[Partial<DiodeParams>]>)('closed form %j', (c) => {
    const { r, m } = run(c)
    const cf = closedFormDiode(r.params)
    expect(cf.valid).toBe(true)
    expect(rel(m.irr!, cf.irr)).toBeLessThan(1e-4)
    expect(rel(m.ta!, cf.ta)).toBeLessThan(1e-4)
    expect(rel(m.tf!, cf.tf)).toBeLessThan(1e-6)
    expect(rel(m.qrr, cf.qrr)).toBeLessThan(1e-3)
    expect(rel(m.tb!, cf.tb)).toBeLessThan(1e-3)
    expect(rel(m.vrm, cf.vrm)).toBeLessThan(1e-4)
    expect(rel(m.eon, cf.eon)).toBeLessThan(2e-3)
  })
  it('tb by the 90 %/25 % rule is 1.88·τrr for the exponential tail', () => {
    expect(TB_FACTOR).toBeCloseTo(1.8789, 3)
    const { r, m } = run()
    expect(rel(m.tb!, TB_FACTOR * r.params.tauRR)).toBeLessThan(1e-3)
  })
  it('Qrr ≈ ½·Irr·trr within 10 %; the abrupt rule √(2·Qrr·di/dt) fits a snappy diode far better than a soft one', () => {
    const soft = run({ tm: 30e-9 }).m
    const snap = run({ tm: 1e-9 }).m
    const base = run().m
    expect(rel(0.5 * base.irr! * base.trr!, base.qrr)).toBeLessThan(0.1)
    const abrupt = (m: typeof base) => Math.sqrt(2 * m.qrr * m.didt!) / m.irr!
    expect(abrupt(snap) - 1).toBeLessThan(0.15)
    expect(abrupt(soft) - 1).toBeGreaterThan(abrupt(snap) - 1)
  })
})

describe('diode: lessons, WHY, experiments, predictions', () => {
  it('the checks are confirmed by the simulation', () => {
    // lesson 1: the current reverses before the diode blocks
    const a = run().m
    expect(a.t0!).toBeLessThan(a.tRec!)
    // lesson 2: a faster switch → larger Irr
    expect(run({ didt: 3000e6 }).m.irr!).toBeGreaterThan(a.irr!)
    // lesson 3: snappy → higher reverse-voltage peak; a smaller loop lowers it
    const snap = run({ tm: 2e-9 }).m
    expect(snap.vrm).toBeGreaterThan(a.vrm)
    expect(run({ tm: 2e-9, ls: 30e-9 }).m.vrm).toBeLessThan(snap.vrm)
  })
  it('every lesson step, WHY card, status, reading and next consequence reads real numbers', () => {
    for (const l of DIODE_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      for (const s of l.steps) {
        const r = simulateDiode({ ...DIODE_DEFAULTS, ...l.base, ...s.params })
        const m = measureDiode(r)
        const st = diodeStateAt(r, converterIndexAt(r, s.at(r)))
        noBad(s.body(st, m, r))
        const w = s.window!(r)
        expect(w[1]).toBeGreaterThan(w[0])
      }
    }
    const { r, m } = run()
    const seen = new Set<string>()
    for (let k = 0; k < r.length; k += 25) {
      const st = diodeStateAt(r, k)
      seen.add(st.phase)
      for (const c of diodeWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBad(t)
      const s = diodeStatus(st)
      noBad(s.headline + s.facts.join())
      const n = diodeNext(r, st, m)
      expect(n).not.toBeNull()
      noBad(n!.text)
      if (n!.time !== null) expect(n!.time).toBeGreaterThanOrEqual(r.time[k] - r.params.dt)
    }
    expect([...seen].sort()).toEqual(['blocking', 'current fall', 'freewheeling', 'recovery tail', 'reverse current (stored charge)'].sort())
    for (const x of diodeReadings(m)) noBad(x.value + x.unit)
  })
  it('the experiments’ verdicts come from the before/after runs', () => {
    const expected: Record<string, number> = { didt: 0, tau: 0, ls: 0 }
    for (const e of DIODE_EXPERIMENTS) {
      const p0 = { ...DIODE_DEFAULTS }
      const b = measureDiode(simulateDiode(p0))
      const a = measureDiode(simulateDiode({ ...p0, ...e.change(p0) }))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, expected[e.id]])
      noBad(e.why(b, a, p0, { ...p0, ...e.change(p0) }))
    }
  })
  it('predictions: answers from the simulation, matching the theory shown after', () => {
    for (const seed of [0, 1, 2]) {
      for (const t of diodePredictions(seed)) {
        const p = { ...DIODE_DEFAULTS, ...t.params }
        const r = simulateDiode(p)
        const ans = t.answer(measureDiode(r))
        expect(Number.isFinite(ans)).toBe(true)
        noBad(t.theory(r.params))
        if (t.id === 'tf') expect(rel(ans, r.params.i0 / r.params.didt)).toBeLessThan(t.tolerance!)
        if (t.id === 'stored') expect(rel(ans, r.params.tau * r.params.i0)).toBeLessThan(t.tolerance!)
        if (t.id === 'vf') expect(rel(ans, shockleyV(r.params, r.params.i0))).toBeLessThan(t.tolerance!)
        if (t.id === 'limit') expect(ans).toBe(1)
      }
    }
  })
  it('the topic: ≥ 2 lessons with checks, ≥ 2 experiments, ≥ 3 predictions, 4 readings', () => {
    expect(DIODE_TOPIC.lessons.length).toBeGreaterThanOrEqual(2)
    for (const l of DIODE_TOPIC.lessons) expect(l.check).toBeDefined()
    expect(DIODE_TOPIC.experiments.length).toBeGreaterThanOrEqual(2)
    expect(DIODE_TOPIC.predictions(0).length).toBeGreaterThanOrEqual(3)
    const r = DIODE_TOPIC.simulate(DIODE_DEFAULTS)
    expect(DIODE_TOPIC.readings!(DIODE_TOPIC.measure(r), r)).toHaveLength(4)
  })
  it('a default run is fast enough for interactive use', () => {
    simulateDiode(DIODE_DEFAULTS)
    const t0 = cpuNow()
    const r = simulateDiode({ ...DIODE_DEFAULTS, i0: 21 })
    measureDiode(r)
    expect(cpuNow() - t0).toBeLessThan(3000)
  })
})
