import { describe, expect, it } from 'vitest'
import { compareEv, EV_EXPERIMENTS, EV_LESSONS, evPredictions, evStateAt, evView, evWhy } from '../src/converters/ev/content.ts'
import { accelTheory, cycleTheory, gauss, timeToSpeed } from '../src/converters/ev/theory.ts'
import { batteryCurrent, EV_DEFAULTS, measureEv, resolveEv, simulateEv, type EvParams } from '../src/converters/ev/vehicle.ts'
import { converterIndexAt } from '../src/converters/engine.ts'

const run = (o: Partial<EvParams> = {}) => {
  const r = simulateEv({ ...EV_DEFAULTS, ...o })
  return { r, m: measureEv(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('EV drivetrain: physics', () => {
  it('Gauss–Legendre integrates polynomials up to degree 31 exactly', () => {
    expect(gauss((x) => [x ** 7 - 3 * x ** 3], 0, 2, 1, 1)[0]).toBeCloseTo(2 ** 8 / 8 - (3 * 2 ** 4) / 4, 10)
  })
  it('the battery current delivers exactly the requested power through Rb', () => {
    const p = resolveEv({}).params
    for (const pb of [-50e3, -1e3, 0, 500, 80e3, 150e3]) {
      const i = batteryCurrent(p, pb)
      expect((p.voc - p.rb * i) * i).toBeCloseTo(pb, 6)
    }
  })
  it('the driver follows the cycle and the energy balances', () => {
    for (const cycle of ['urban', 'highway'] as const) {
      const { r, m } = run({ cycle })
      expect(m.trackErr).toBeLessThan(1e-3)
      expect(m.limitedFrac).toBe(0)
      // cells = terminals + Rb loss; regeneration only while braking
      expect(m.eChem - m.eBatt).toBeCloseTo(m.eBattLoss, 6)
      expect(m.eBattLoss).toBeGreaterThan(0)
      expect(m.eRegen).toBeGreaterThan(0)
      expect(m.dSoc).toBeCloseTo((m.eChem / 3600 / r.params.capacity) * 100, 9)
    }
  })
  it('highway consumption is higher than urban (drag ∝ v²); a hill raises it; no regen raises it', () => {
    const urban = run().m
    expect(run({ cycle: 'highway' }).m.consumption).toBeGreaterThan(urban.consumption)
    expect(run({ grade: 3 }).m.consumption).toBeGreaterThan(1.5 * urban.consumption)
    const noRegen = run({ pregen: 0 }).m
    expect(noRegen.eRegen).toBe(0)
    expect(noRegen.consumption).toBeGreaterThan(1.1 * urban.consumption)
    expect(noRegen.eBrake).toBeGreaterThan(0)
  })
  it('acceleration: torque-limited then power-limited; the constant-power formula is too optimistic', () => {
    const { r, m } = run({ cycle: 'accel' })
    const th = accelTheory(r.params)
    expect(m.t100!).toBeGreaterThan(th.t100Textbook)
    const k = converterIndexAt(r, 1)
    expect(r.signals.f[k]).toBeCloseTo(r.params.fTmax, 6)
    const kHigh = r.signals.vkmh.findIndex((v) => v > 1.5 * r.params.vBase * 3.6)
    expect(r.signals.pwheel[kHigh]).toBeCloseTo(r.params.pmax, 3)
    expect(timeToSpeed(r.params, (th.vTop / 3.6) * 1.01)).toBeNull()
  })
  it('a weak battery limits the drive: the wheels never get more power than the battery can supply', () => {
    // Voc = 100 V, Rb = 0.5 Ω: at most Voc²/(4·Rb) = 5 kW at the terminals — far below the motor's 150 kW
    for (const cycle of ['accel', 'highway'] as const) {
      const { r } = run({ cycle, voc: 100, rb: 0.5 })
      const p = r.params
      expect(p.pDrive).toBeCloseTo((5000 - p.aux) * p.eta, 6)
      expect(r.diagnostics.issues.some((x) => /battery limits the drive/.test(x))).toBe(true)
      // energy is conserved at every sample: terminal power = wheel power / η + auxiliaries (nothing is clipped away)
      for (let k = 0; k < r.length; k++) {
        const pw = r.signals.pwheel[k]
        const want = (pw >= 0 ? pw / p.eta : pw * p.eta) + p.aux
        expect(Math.abs(r.signals.pbatt[k] - want)).toBeLessThan(1e-6 * Math.max(1, Math.abs(want)))
        expect(pw).toBeLessThanOrEqual(p.pDrive * (1 + 1e-9))
      }
    }
    // the exact theory uses the same limit: the speed reached agrees (5 kW never reaches 100 km/h, so no t100 row)
    const { r, m } = run({ cycle: 'accel', voc: 100, rb: 0.5 })
    expect(m.t100).toBeNull()
    const cmp = compareEv(r, m)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(1)
    for (const row of cmp.rows) expect(row.pass, row.key).toBe(true)
    // and the default battery (500 kW available) does not limit the 150 kW motor
    expect(resolveEv({}).params.pDrive).toBe(resolveEv({}).params.pmax)
  })
})

describe('EV drivetrain: simulation vs theory', () => {
  const cases: Array<Partial<EvParams>> = [{}, { cycle: 'highway' }, { cycle: 'accel' }, { grade: 4 }, { grade: -3 }, { pregen: 10e3 }, { pregen: 0 }, { mass: 3000, cycle: 'accel' }, { rb: 0.3, cycle: 'highway' }, { cycle: 'highway', pmax: 30e3 }]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareEv(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(2)
    // a motor too weak for the cycle is reported as an expected difference, never a silent pass
    if (c.pmax === 30e3) expect(cmp.rows.some((x) => x.expected)).toBe(true)
    else expect(cmp.rows.every((x) => !x.expected && x.error < 1e-4)).toBe(true)
  })
  it('the regeneration limit moves braking energy into the friction brakes (theory and simulation)', () => {
    const a = cycleTheory(resolveEv({ pregen: 10e3 }).params)
    const b = cycleTheory(resolveEv({}).params)
    expect(a.eBrake).toBeGreaterThan(b.eBrake)
    expect(a.eRegen).toBeLessThan(b.eRegen)
  })
})

describe('EV drivetrain: explanations and content', () => {
  it('state, view and WHY never contain NaN', () => {
    for (const o of [{}, { cycle: 'accel' as const }, { pregen: 10e3 }]) {
      const { r, m } = run(o)
      const phases = new Set<string>()
      for (let k = 0; k < r.length; k += 25) {
        const st = evStateAt(r, k)
        phases.add(st.phase)
        for (const row of evView(st).rows) noBadText(row.v)
        for (const c of evWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
      if (!o.cycle) for (const ph of ['standstill', 'accelerating', 'cruising', 'regenerating']) expect(phases.has(ph)).toBe(true)
      if (o.pregen) expect(phases.has('braking (friction too)')).toBe(true)
    }
  })
  it('lessons, experiments and predictions', () => {
    for (const l of EV_LESSONS)
      for (const s of l.steps) {
        const r = simulateEv({ ...EV_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        noBadText(s.body(evStateAt(r, converterIndexAt(r, t)), measureEv(r), r))
      }
    for (const e of EV_EXPERIMENTS)
      for (const base of [{}, { cycle: 'highway' as const }]) {
        const p0 = { ...EV_DEFAULTS, ...base }
        const p1 = { ...p0, ...e.change(p0) }
        const b = measureEv(simulateEv(p0))
        const a = measureEv(simulateEv(p1))
        expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
        noBadText(e.why(b, a, p0, p1))
      }
    for (const t of evPredictions(1)) {
      const p = { ...EV_DEFAULTS, ...t.params }
      expect(Number.isFinite(t.answer(measureEv(simulateEv(p))))).toBe(true)
      noBadText(t.theory(p))
    }
    // the cruise prediction's theory is the simulated answer (constant speed, exact model)
    const cr = evPredictions(0)[0]
    const p = { ...EV_DEFAULTS, ...cr.params }
    const v = 120 / 3.6
    const theory = ((0.5 * 1.2 * p.cd * p.area * v * v + p.crr * p.mass * 9.81) * v) / p.eta + p.aux
    expect(cr.answer(measureEv(simulateEv(p))) / theory).toBeCloseTo(1, 6)
  })
})
