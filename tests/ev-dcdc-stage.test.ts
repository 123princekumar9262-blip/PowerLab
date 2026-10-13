import { describe, expect, it, vi } from 'vitest'

// many full simulations per test: a loaded machine (the full suite in parallel) must not hit the 5-s default
vi.setConfig({ testTimeout: 120_000 })
import { measureStage, resolveStage, simulateStage, STAGE_DEFAULTS, type StageParams } from '../src/converters/ev/dcdcStage.ts'
import {
  compareStage,
  STAGE_EXPERIMENTS,
  STAGE_LESSONS,
  stageEnergy,
  stagePath,
  stagePredictions,
  stageReadings,
  stageStateAt,
  stageStatus,
  stageView,
  stageWhy,
} from '../src/converters/ev/dcdcStageContent.ts'
import { stageExact, stageTextbook } from '../src/converters/ev/dcdcStageTheory.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { EV_DCDC_STAGE_TOPIC } from '../src/topics/evDcdcStage.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<StageParams> = {}) => {
  const r = simulateStage({ ...STAGE_DEFAULTS, ...o })
  return { r, m: measureStage(r) }
}
const noBad = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('EV DC-DC stage: SIMULATION vs THEORY', () => {
  // Tolerances (see compareStage): averages and ΔiL ≤ 1e-4 (trapezoidal rule vs exact flow agree to ~1e-5),
  // capacitor ripple 1e-3 (its interior extremum is sampled), body-diode loss 1 % (the dead time spans 2–3 steps).
  const cases: Array<Partial<StageParams>> = [
    {},
    { power: -50e3 },
    { power: 150e3, vbat: 250 },
    { power: -100e3, vbat: 420, vlink: 800 },
    { power: 10e3 },
    { power: 0 },
    { fs: 50e3, l: 80e-6 },
    { fs: 8e3, c: 2e-3, esr: 0.005, td: 800e-9 },
    { rbat: 0, rl: 0, esr: 0, ron: 0.02, vf: 1.5 },
    { vbat: 200, vlink: 700, power: 80e3, stepsPerPeriod: 400 },
  ]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    expect(r.diagnostics.issues.filter((x) => /controller/.test(x))).toEqual([])
    expect(r.diagnostics.steady.converged).toBe(true)
    // the controller put the link on its target
    expect(Math.abs(m.vlinkAvg - r.params.vlink)).toBeLessThan(1e-4 * r.params.vlink)
    const cmp = compareStage(r, m)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(9)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
  })
  it('power balance of the simulated circuit: battery = inverter + conduction losses (steady state)', () => {
    for (const o of [{}, { power: -60e3 }, { power: 120e3, vbat: 300 }]) {
      const { m } = run(o)
      expect(Math.abs(m.pBat - m.pLink - m.pCond)).toBeLessThan(5e-5 * Math.abs(m.pBat))
    }
  })
  it('textbook relations hold where they should', () => {
    const { r, m } = run()
    const tb = stageTextbook(r.params, m.vbtAvg, m.ilAvg)
    // the boost law with the measured terminal voltage and duty, corrected by the losses: within 2 %
    expect(m.vlinkAvg / tb.vlink).toBeGreaterThan(0.98)
    expect(m.vlinkAvg / tb.vlink).toBeLessThan(1.0)
    // ΔiL = Vt·D/(L·fs) within 2 % (Vt and the slope change a little with the losses and the dead time)
    expect(Math.abs(m.ilPP / tb.ilPP - 1)).toBeLessThan(0.02)
    // the capacitor ripple law (no ESR): within 5 %
    expect(Math.abs(m.vcPP / tb.vlinkPP - 1)).toBeLessThan(0.05)
    // conduction ≈ Irms²·(Ron + DCR) (the diode and ESR terms are small)
    expect(Math.abs(m.pCond / tb.pCond - 1)).toBeLessThan(0.05)
  })
  it('the exact model is periodic and its Newton converges', () => {
    const p = resolveStage({ duty: 0.48 }).params
    const ex = stageExact(p)
    expect(ex.newton).toBeLessThanOrEqual(4)
    expect(ex.efficiency).toBeGreaterThan(0.98)
  })
})

describe('EV DC-DC stage: physics', () => {
  it('motoring: D above the ideal; regenerating: below it (losses and dead time change sides)', () => {
    const mot = run({ power: 60e3 }).m
    const reg = run({ power: -60e3 }).m
    expect(mot.duty).toBeGreaterThan(mot.dutyIdeal)
    expect(reg.duty).toBeLessThan(reg.dutyIdeal)
    expect(mot.ilAvg).toBeGreaterThan(0)
    expect(reg.ilAvg).toBeLessThan(0)
    expect(reg.pBat).toBeLessThan(0)
    expect(mot.direction).toBe('motoring')
    expect(reg.direction).toBe('regenerating')
    // the dead time is carried by D1 while motoring, by D2 while regenerating
    expect(mot.deadDiode).toBe(1)
    expect(reg.deadDiode).toBe(2)
  })
  it('switching losses: two hard edges per period, none of them a turn-on of the "soft" switch', () => {
    const { m } = run()
    expect(m.hardEdges).toBe(2)
    expect(m.pSw).toBeGreaterThan(0)
  })
  it('efficiency vs load: falls at light load and at heavy load', () => {
    const eta = (kw: number) => run({ power: kw * 1000, periods: 1 }).m.efficiency
    // (the light-load drop comes from the nearly fixed ripple and edge losses, ~10 W here: visible below a few kW)
    const light = eta(2)
    const mid = eta(15)
    const heavy = eta(150)
    expect(mid).toBeGreaterThan(light)
    expect(mid).toBeGreaterThan(heavy)
  })
  it('higher fs: smaller ripple, larger switching loss', () => {
    const a = run().m
    const b = run({ fs: 50e3 }).m
    expect(b.ilPP).toBeLessThan(0.5 * a.ilPP)
    expect(b.pSw).toBeGreaterThan(2 * a.pSw)
  })
  it('limits: the link target is kept above the battery; the battery power is limited', () => {
    const r = resolveStage({ vbat: 450, vlink: 400 })
    expect(r.params.vlink).toBeCloseTo(495, 9)
    expect(r.issues.some((x) => /link target/.test(x))).toBe(true)
    const q = resolveStage({ vbat: 200, rbat: 0.2, power: 150e3 })
    expect(q.params.power).toBeLessThan(150e3)
  })
  it('the energy ledger balances at every sample', () => {
    for (const o of [{}, { power: -40e3 }]) {
      const { r } = run(o)
      for (let k = 0; k < r.length; k += 7) {
        const e = stageEnergy(stageStateAt(r, k), r)
        expect(Math.abs(e.balance!)).toBeLessThan(1e-6 * Math.max(1, Math.abs(e.ledger[0].watts)) + 1e-6)
      }
    }
  })
})

describe('EV DC-DC stage: explanations, lessons, experiments, predictions', () => {
  it('state, view, status, WHY, path, readings and inspector never show NaN', () => {
    for (const o of [{}, { power: -50e3 }, { power: 0 }]) {
      const { r, m } = run(o)
      for (const rd of stageReadings(m, r)) noBad(`${rd.value} ${rd.unit} ${rd.note}`)
      const seen = new Set<string>()
      for (let k = 0; k < r.length; k++) {
        const st = stageStateAt(r, k)
        seen.add(st.interval)
        if (k % 13) continue
        for (const row of stageView(st).rows) noBad(row.v)
        const s = stageStatus(st, r)
        noBad(s.headline + s.facts.join())
        noBad(stagePath(st).text)
        for (const c of stageWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBad(t)
        for (const part of ['battery', 'l', 's1', 's2', 'd1', 'd2', 'c', 'inv']) for (const [, v] of EV_DCDC_STAGE_TOPIC.inspect!(part, st, m, r).rows) noBad(v)
      }
      expect([...seen].sort()).toEqual(['S1 on', 'S2 on', 'dead time'])
    }
  })
  it('every lesson step lands in its run, shows what it says, and reads the simulation', () => {
    for (const l of STAGE_LESSONS) {
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulateStage({ ...STAGE_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration)
        const st = stageStateAt(r, converterIndexAt(r, t))
        noBad(s.body(st, measureStage(r), r))
        if (/S2 on/.test(s.title)) expect(st.interval).toBe('S2 on')
        if (/S1 on/.test(s.title)) expect(st.interval).toBe('S1 on')
        if (/[Dd]ead time/.test(s.title)) expect(st.interval).toBe('dead time')
      }
    }
  })
  it('lesson checks agree with the simulation', () => {
    // boost: D above the ideal while motoring
    const b = run(STAGE_LESSONS[0].base).m
    expect(b.duty).toBeGreaterThan(b.dutyIdeal)
    // regen: the current reverses, the duty stays close to the motoring one
    const g = run(STAGE_LESSONS[1].base).m
    expect(g.ilAvg).toBeLessThan(0)
    expect(Math.abs(g.duty - run({ ...STAGE_LESSONS[1].base, power: 50e3 }).m.duty)).toBeLessThan(0.05)
    // efficiency: from 60 to 150 kW the conduction losses grow faster than the switching losses
    const m60 = run({ power: 60e3 }).m
    const m150 = run({ power: 150e3 }).m
    expect(m150.efficiency).toBeLessThan(m60.efficiency)
    expect(m150.pCond / m60.pCond).toBeGreaterThan(m150.pSw / m60.pSw)
  })
  it('experiments: the simulation confirms the expected choice from the standard values', () => {
    for (const e of STAGE_EXPERIMENTS) {
      const p0 = { ...STAGE_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureStage(simulateStage(p0))
      const a = measureStage(simulateStage(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBad(e.why(b, a, p0, p1))
    }
  })
  it('predictions: answers come from the simulation; the textbook is close', () => {
    for (const seed of [0, 1, 2]) {
      const tasks = stagePredictions(seed)
      expect(tasks.length).toBeGreaterThanOrEqual(3)
      for (const t of tasks) {
        const p = { ...STAGE_DEFAULTS, ...t.params }
        const r = simulateStage(p)
        const m = measureStage(r)
        const a = t.answer(m)
        expect(Number.isFinite(a), t.id).toBe(true)
        noBad(t.theory(p))
        if (t.id === 'duty') expect(Math.abs(a / (100 * r.params.dutyIdeal) - 1)).toBeLessThan(t.tolerance!)
        if (t.id === 'ripple') {
          const vt = r.params.vlink * (1 - r.params.dutyIdeal)
          expect(Math.abs(a / ((vt * r.params.dutyIdeal) / (r.params.l * r.params.fs)) - 1)).toBeLessThan(t.tolerance!)
        }
        if (t.id === 'current') expect(Math.abs(a / (r.params.power / (r.params.vlink * (1 - r.params.dutyIdeal))) - 1)).toBeLessThan(t.tolerance!)
        if (t.id === 'deadtime') expect(a).toBe(1)
      }
    }
  })
  it('a default run (controller included) and its theory are fast enough', () => {
    // warm up (JIT), then the best of three
    compareStage(simulateStage(STAGE_DEFAULTS), measureStage(simulateStage(STAGE_DEFAULTS)))
    let sim = Infinity
    let th = Infinity
    for (let i = 0; i < 3; i++) {
      const t0 = cpuNow()
      const r = simulateStage(STAGE_DEFAULTS)
      const t1 = cpuNow()
      compareStage(r, measureStage(r))
      const t2 = cpuNow()
      sim = Math.min(sim, t1 - t0)
      th = Math.min(th, t2 - t1)
    }
    console.log(`dc-dc stage default run ${sim.toFixed(0)} ms, theory ${th.toFixed(0)} ms (best of 3)`)
    expect(sim).toBeLessThan(3000)
    expect(th).toBeLessThan(3000)
  })
})
