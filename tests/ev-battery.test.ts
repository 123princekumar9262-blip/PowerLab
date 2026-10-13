import { describe, expect, it, vi } from 'vitest'

// many full simulations per test: a loaded machine (the full suite in parallel) must not hit the 5-s default
vi.setConfig({ testTimeout: 120_000 })
import { BAT_DEFAULTS, OCV_TABLE, ocv, resolveBattery, simulateBattery, socAtOcv, type BatteryParams } from '../src/converters/ev/battery.ts'
import {
  BATTERY_EXPERIMENTS,
  BATTERY_LESSONS,
  batteryEnergy,
  batteryNext,
  batteryPath,
  batteryPredictions,
  batteryReadings,
  batteryStateAt,
  batteryStatus,
  batteryView,
  batteryWhy,
  compareBattery,
  exactFor,
  measureBattery,
} from '../src/converters/ev/batteryContent.ts'
import { ccDischargeClosedForm, piecewiseClosedForm, rcStep } from '../src/converters/ev/batteryTheory.ts'
import { EV_BATTERY_TOPIC } from '../src/topics/evBattery.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<BatteryParams> = {}) => {
  const r = simulateBattery({ ...BAT_DEFAULTS, ...o })
  return { r, m: measureBattery(r) }
}
const noBad = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('battery: cell physics', () => {
  it('the OCV table rises monotonically from 3.0 V to 4.2 V and inverts', () => {
    for (let k = 1; k < OCV_TABLE.length; k++) expect(OCV_TABLE[k][1]).toBeGreaterThan(OCV_TABLE[k - 1][1])
    for (const s of [0.02, 0.17, 0.5, 0.83, 0.99]) expect(socAtOcv(ocv(s))).toBeCloseTo(s, 12)
  })
  it('the RC step response reaches 63 % after one time constant', () => {
    expect(rcStep(0, 0.01, 10, 5, 10) / (0.01 * 5)).toBeCloseTo(1 - Math.exp(-1), 12)
    expect(rcStep(0.05, 0.01, 10, 0, 1e6)).toBeCloseTo(0, 12)
  })
})

describe('battery: SIMULATION vs THEORY', () => {
  // RK4 at 1 s (0.5 s for pulses) against the exact matrix-exponential solution: both locate events to
  // 1e-12 s, and RK4's local error on time constants ≥ 5 s is ~1e-6 of the RC voltage per step — the compare
  // tolerance (0.01 %) is two orders above what we see, and below anything a student would read.
  const cases: Array<Partial<BatteryParams>> = [
    {},
    { balancing: 'off' },
    { profile: 'discharge', soc0: 0.9 },
    { profile: 'discharge', soc0: 0.7, crate: 3, rcPairs: 1 },
    { profile: 'pulse', soc0: 0.6, crate: 2 },
    { profile: 'pulse', soc0: 0.25, crate: 4, pulses: 10 },
    { profile: 'charge', cells: 12, socSpread: 0.08 },
    { profile: 'charge', cells: 4, rbal: 40, threshold: 0.005, chargeRate: 0.5 },
    { profile: 'cycle', capSpread: 0.1, socSpread: 0.02, iOffset: 0.1 },
    { profile: 'discharge', soc0: 0.9, tau1: 5, r1: 0.03, r0: 0.05 },
  ]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareBattery(r, m)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(4)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    // the whole trajectory: every cell's SOC and RC voltages, at every sample
    const ex = exactFor(r)
    expect(ex.x.length).toBe(r.length)
    let ds = 0
    let du = 0
    for (let k = 0; k < r.length; k++)
      for (let i = 0; i < r.params.n; i++) {
        ds = Math.max(ds, Math.abs(r.signals[`s${i + 1}`][k] / 100 - ex.x[k][3 * i]))
        du = Math.max(du, Math.abs(r.signals[`u${i + 1}`][k] - ex.x[k][3 * i + 1]))
      }
    expect(ds).toBeLessThan(1e-6)
    expect(du).toBeLessThan(1e-5)
    // same events at the same instants (bleed switching included)
    const se = r.events.map((e) => `${e.device}:${e.values.cell ?? ''}`)
    const te = ex.events.map((e) => `${e.device}:${e.cell ?? ''}`)
    expect(se).toEqual(te)
    // (a switch of the held cell in CV is where two hold currents cross almost in parallel: the crossing instant
    // is ill-conditioned — 1e-9 of state moves it by ~1e-5 s — so it gets 1 ms)
    r.events.forEach((e, i) => expect(Math.abs(e.time - ex.events[i].t), `${e.device} at ${e.time}`).toBeLessThan(e.device === 'cv-cell' ? 1e-3 : 1e-5))
  })
  it('a constant-current discharge agrees with the closed form (RC step response, SOC by charge)', () => {
    for (const o of [{ soc0: 0.9 }, { soc0: 0.6, crate: 2.5 }, { soc0: 0.8, rcPairs: 1, crate: 0.5 }]) {
      const { r, m } = run({ profile: 'discharge', ...o })
      const p = r.params
      const cf = ccDischargeClosedForm(p, p.s0.map((s) => ({ s, u: 0, w: 0 })), p.iDis)
      expect(m.cutCell).toBe(cf.cell + 1)
      expect(Math.abs(m.tCut! - 30 - cf.t)).toBeLessThan(1e-6 * cf.t)
      expect(m.qDis! / (cf.q / 3600)).toBeCloseTo(1, 7)
      expect(m.eDis! / (cf.e / 3600)).toBeCloseTo(1, 7)
      // usable charge = I·t and every cell lost exactly that charge (no bleeding while discharging)
      expect(m.qDis!).toBeCloseTo((p.iDis * (m.tCut! - 30)) / 3600, 9)
      for (let i = 0; i < p.n; i++) expect((p.s0[i] - m.socEnd[i] / 100) * p.q[i]).toBeCloseTo(m.qDis! * 3600, 6)
    }
  })
  it('pulses: the pack voltage at every sample follows the piecewise closed form', () => {
    const { r } = run({ profile: 'pulse', soc0: 0.6, crate: 2, pulses: 3 })
    const p = r.params
    const pieces: Array<{ I: number; h: number }> = []
    let cur = p.s0.map((s) => ({ s, u: 0, w: 0 }))
    let worst = 0
    for (let k = 1; k < r.length; k++) {
      const I = r.signals.ipack[k]
      cur = piecewiseClosedForm(p, cur, [{ I, h: p.dt }])[1]
      pieces.push({ I, h: p.dt })
      const v = cur.reduce((a, c) => a + ocv(c.s) - c.u - c.w - p.r0 * I, 0)
      worst = Math.max(worst, Math.abs(v - r.signals.vpack[k]))
    }
    expect(worst).toBeLessThan(1e-5)
  })
  it('charge is conserved and the BMS counts it exactly', () => {
    for (const o of [{ profile: 'discharge' as const, soc0: 0.9, iOffset: 0.05 }, { iOffset: -0.08 }]) {
      const { r, m } = run(o)
      const p = r.params
      const q = r.signals.qpack[r.length - 1] * 3600
      expect(m.socEstEnd).toBeCloseTo(100 * (p.socEst0 - (q + p.iOffset * p.duration) / (3600 * p.capacity)), 9)
    }
  })
})

describe('battery: physics and limits', () => {
  it('identical cells end together; nothing to balance', () => {
    const { r, m } = run({ capSpread: 0, socSpread: 0 })
    expect(m.spread0).toBe(0)
    expect(m.spreadEnd).toBeLessThan(1e-9)
    expect(m.eBleed).toBe(0)
    expect(r.events.some((e) => /bleed/.test(e.device ?? ''))).toBe(false)
  })
  it('balancing recovers usable capacity (charge, then discharge)', () => {
    const on = run({ balancing: 'on' }).m
    const off = run({ balancing: 'off' }).m
    expect(on.spreadCh!).toBeLessThan(0.3 * off.spreadCh!)
    expect(on.qDis!).toBeGreaterThan(1.03 * off.qDis!)
    expect(on.eBleed).toBeGreaterThan(0)
    expect(off.eBleed).toBe(0)
  })
  it('a faster discharge delivers less charge; one RC pair keeps w at zero', () => {
    const a = run({ profile: 'discharge', soc0: 0.9, crate: 1 }).m
    const b = run({ profile: 'discharge', soc0: 0.9, crate: 4 }).m
    expect(b.qDis!).toBeLessThan(a.qDis!)
    expect(b.eDis! / b.qDis!).toBeLessThan(a.eDis! / a.qDis!)
    const { r } = run({ profile: 'discharge', rcPairs: 1, soc0: 0.9 })
    expect(Math.max(...Array.from(r.signals.w1).map(Math.abs))).toBe(0)
  })
  it('a nearly empty pack cuts off at once; the run stays well-formed', () => {
    const { r, m } = run({ profile: 'discharge', soc0: 0.05, socSpread: 0.04 })
    expect(m.tCut).not.toBeNull()
    expect(m.tCut! - 30).toBeLessThan(60)
    expect(r.length).toBeGreaterThan(10)
    const cmp = compareBattery(r, m)
    for (const row of cmp.rows) expect(row.pass, row.key).toBe(true)
  })
  it('CC-CV: no cell ever exceeds Vmax; the charge ends below C/20', () => {
    const { r, m } = run({ profile: 'charge', chargeRate: 2 })
    expect(m.vCellMax).toBeLessThanOrEqual(r.params.vmax + 1e-9)
    const end = r.events.find((e) => e.device === 'charge-end')!
    expect(Math.abs(end.values.ipack)).toBeLessThanOrEqual(r.params.iTerm + 1e-9)
  })
  it('the energy ledger balances at every instant', () => {
    for (const o of [{}, { profile: 'pulse' as const, soc0: 0.6 }]) {
      const { r } = run(o)
      for (let k = 0; k < r.length; k += 97) {
        const e = batteryEnergy(batteryStateAt(r, k), r)
        expect(Math.abs(e.balance!)).toBeLessThan(1e-6 * Math.max(1, Math.abs(e.ledger[0].watts)))
      }
    }
  })
})

describe('battery: explanations, lessons, experiments, predictions', () => {
  it('state, view, status, WHY, path, next and readings never show NaN', () => {
    for (const o of [{}, { profile: 'discharge' as const, soc0: 0.9 }, { profile: 'pulse' as const, soc0: 0.6 }, { profile: 'charge' as const }]) {
      const { r, m } = run(o)
      for (const rd of batteryReadings(m, r)) noBad(`${rd.value} ${rd.unit} ${rd.note}`)
      for (let k = 0; k < r.length; k += Math.ceil(r.length / 40)) {
        const st = batteryStateAt(r, k)
        for (const row of batteryView(st, r).rows) noBad(row.v)
        const s = batteryStatus(st, r)
        noBad(s.headline + s.facts.join())
        noBad(batteryPath(st).text)
        noBad(batteryNext(r, st)?.text ?? '')
        for (const c of batteryWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBad(t)
        for (const part of ['pack', 'cellMin', 'cellMax', 'bms', 'load', 'cell1']) for (const [, v] of EV_BATTERY_TOPIC.inspect!(part, st, m, r).rows) noBad(v)
      }
    }
  })
  it('every lesson step lands inside its run and reads the simulation', () => {
    for (const l of BATTERY_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulateBattery({ ...BAT_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t), `${l.id}: ${s.title}`).toBe(true)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration)
        noBad(s.body(batteryStateAt(r, Math.round(t / r.params.dt)), measureBattery(r), r))
      }
    }
  })
  it('lesson checks are what the simulation shows', () => {
    // sag: when the pulse stops, the voltage jumps by N·R0·I at once and then keeps rising (RC relaxation)
    const l0 = BATTERY_LESSONS[0]
    const r0 = simulateBattery({ ...BAT_DEFAULTS, ...l0.base })
    const off = r0.events.find((e) => e.device === 'pulse-off')!
    const k = Math.round(off.time / r0.params.dt)
    const jump = r0.signals.vpack[k + 1] - r0.signals.vpack[k]
    expect(jump).toBeGreaterThan(0.9 * r0.params.n * r0.params.r0 * r0.params.iDis)
    for (let j = k + 2; j < k + 60; j++) expect(r0.signals.vpack[j]).toBeGreaterThan(r0.signals.vpack[j - 1])
    // weakest: the first cell at Vmin ends it while the mean SOC is clearly above the lowest
    const r1 = simulateBattery({ ...BAT_DEFAULTS, ...BATTERY_LESSONS[1].base })
    const m1 = measureBattery(r1)
    const c = r1.events.find((e) => e.device === 'cutoff')!
    expect(c.values[`v${m1.cutCell}`]).toBeCloseTo(r1.params.vmin, 9)
    expect(m1.socAtCut! - c.values.socmin).toBeGreaterThan(1)
    // balance: balancing narrows the spread and raises the usable charge
    const b = measureBattery(simulateBattery({ ...BAT_DEFAULTS, ...BATTERY_LESSONS[2].base }))
    const nb = measureBattery(simulateBattery({ ...BAT_DEFAULTS, ...BATTERY_LESSONS[2].base, balancing: 'off' }))
    expect(b.qDis!).toBeGreaterThan(nb.qDis!)
    expect(b.spreadCh!).toBeLessThan(nb.spreadCh!)
  })
  it('experiments: the simulation confirms the expected choice from the standard values', () => {
    for (const e of BATTERY_EXPERIMENTS) {
      const p0 = { ...BAT_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureBattery(simulateBattery(p0))
      const a = measureBattery(simulateBattery(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBad(e.why(b, a, p0, p1))
    }
  })
  it('predictions: answers come from the simulation and match their theory', () => {
    for (const seed of [0, 1, 2]) {
      const tasks = batteryPredictions(seed)
      expect(tasks.length).toBeGreaterThanOrEqual(3)
      for (const t of tasks) {
        const p = { ...BAT_DEFAULTS, ...t.params }
        const m = measureBattery(simulateBattery(p))
        const a = t.answer(m)
        expect(Number.isFinite(a), t.id).toBe(true)
        noBad(t.theory(p))
        if (t.id === 'sag') expect(a / (p.cells * p.r0 * p.crate * p.capacity)).toBeCloseTo(1, 9)
        if (t.id === 'weakest') expect(a).toBe(1)
        if (t.id === 'coulomb') {
          const rp = resolveBattery(p).params
          const r = simulateBattery(p)
          expect(Math.abs(a - (100 * rp.iOffset * r.params.duration) / (3600 * rp.capacity))).toBeLessThan(0.1 * a)
        }
      }
    }
  })
  it('a default run (and its exact theory) is fast enough for interactive use', () => {
    // warm up (JIT), then the best of three: the time of the code, not of whatever else the machine is doing
    compareBattery(simulateBattery(BAT_DEFAULTS), measureBattery(simulateBattery(BAT_DEFAULTS)))
    let sim = Infinity
    let th = Infinity
    let n = 0
    for (let i = 0; i < 3; i++) {
      const t0 = cpuNow()
      const r = simulateBattery(BAT_DEFAULTS)
      const t1 = cpuNow()
      compareBattery(r, measureBattery(r))
      const t2 = cpuNow()
      sim = Math.min(sim, t1 - t0)
      th = Math.min(th, t2 - t1)
      n = r.length
    }
    console.log(`battery default run ${sim.toFixed(0)} ms, exact theory ${th.toFixed(0)} ms, ${n} samples (best of 3)`)
    expect(sim).toBeLessThan(3000)
    expect(th).toBeLessThan(3000)
  })
})
