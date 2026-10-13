import { describe, expect, it } from 'vitest'
import { compare120, measure120, textbook120, type Run120 } from '../src/converters/inverter/analysis120.ts'
import { fractions120, resolve120, theory120, type Inv120Params } from '../src/converters/inverter/conduction120.ts'
import { energy120, path120, readings120, state120, status120, view120, why120 } from '../src/converters/inverter/content120.ts'
import { legDevices } from '../src/converters/inverter/model.ts'
import { INV120_TOPIC as T } from '../src/topics/inverters120.tsx'
import { cpuNow } from './helpers.ts'

/*
 * 120° CONDUCTION on the generic switched-circuit engine (gated IGBTs, freewheeling diodes, floating star
 * point) against an independent theory: the exact interval-by-interval solution of the same circuit with ideal
 * switches (`theory120`), and for an R load the textbook staircase. The simulation's "ideal" devices still have
 * Ron = 1 mΩ against R = 10 Ω and the 1 MΩ bleed resistors (≈10⁻⁴ relative), plus the trapezoidal time step:
 * the comparison uses the inverter lab's tolerances (0.2 % voltages, 0.3 % currents, 0.5 % power, 0.01 of a
 * cycle for conduction fractions). Measured agreement is ≤ 5·10⁻⁴.
 */
const sim = (o: Partial<Inv120Params> = {}) => T.simulate({ ...T.defaults, ...o }) as Run120
const run = (o: Partial<Inv120Params> = {}) => {
  const r = sim(o)
  return { r, m: measure120(r) }
}
const noBad = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const kAt = (r: Run120, deg: number) => Math.round(((r.params.periods > 1 ? 1 : 0) + deg / 360) * r.params.stepsPerPeriod)

describe('120° conduction: circuit physics from the simulation', () => {
  it('IGBTs conduct only while gated and forward; no leg shoots through; every step finds a consistent state', () => {
    for (const o of [{}, { load: 'RL' as const }, { conduction: 180 as const, load: 'RL' as const }]) {
      const r = sim(o)
      for (const d of r.devices)
        for (let k = 1; k < r.length; k++) {
          if (!d.on[k]) continue
          expect(d.current[k]).toBeGreaterThan(-1e-9)
          if (d.kind === 'igbt') expect(d.gate![k]).toBe(1)
        }
      for (const [su, , sl] of legDevices(r.params)) {
        const up = r.devices.find((x) => x.id === su)!
        const lo = r.devices.find((x) => x.id === sl)!
        for (let k = 0; k < r.length; k++) expect(up.gate![k] && lo.gate![k]).toBeFalsy()
      }
      expect(r.diagnostics.fallbacks).toBe(0)
      for (let k = 0; k < r.length; k++) expect(Math.abs(r.signals.ia[k] + r.signals.ib[k] + r.signals.ic[k])).toBeLessThan(1e-6)
    }
  })
  it('two switches are gated at any time (120°), three (180°)', () => {
    for (const [c, n] of [
      [120, 2],
      [180, 3],
    ] as const) {
      const r = sim({ conduction: c })
      for (let k = 1; k < r.length; k++) expect(r.devices.filter((d) => d.kind === 'igbt' && d.gate![k]).length).toBe(n)
    }
  })
  it('R load: two devices conduct, the third leg carries no current and floats at the neutral = Vdc/2', () => {
    const { r, m } = run()
    expect(m.maxConducting).toBe(2)
    expect(m.diodeFraction).toBeLessThan(1e-9)
    const st = state120(r, kAt(r, 30))
    expect(st.gated).toEqual(['S1', 'S6'])
    expect(st.ties).toEqual(['igbt-up', 'igbt-down', 'open'])
    expect(Math.abs(st.ic)).toBeLessThan(1e-4)
    expect(st.legs[2].v).toBeCloseTo(st.vnN, 3)
    expect(st.vnN).toBeCloseTo(50, 1)
    // van takes only +Vdc/2, 0, −Vdc/2
    for (let k = 1; k < r.length; k++) {
      const v = r.signals.van[k]
      expect(Math.min(Math.abs(v - 50), Math.abs(v), Math.abs(v + 50))).toBeLessThan(0.05)
    }
  })
  it('R-L load: after S6 is released at 60°, D3 carries ib and ties leg B to the upper rail until ib reaches zero', () => {
    const { r } = run({ load: 'RL' })
    const st = state120(r, kAt(r, 62))
    expect(st.gated).toEqual(['S1', 'S2'])
    expect(st.legs[1].conducting).toBe('D3')
    expect(st.ties[1]).toBe('diode-up')
    expect(st.legs[1].v).toBeCloseTo(100, 1)
    const t60 = r.params.period * (1 + 60 / 360)
    const off = r.events.find((e) => e.kind === 'diode-off' && e.device === 'D3' && e.time > t60 && e.time < t60 + r.params.period / 6)!
    expect(off).toBeDefined()
    // the exact theory puts the turn-off at the same instant
    const th = theory120(r.params)
    const seg = th.segs.find((s) => s.ta > 60 / 360 / r.params.f1 - 1e-12 && s.legs[1] === 'open')!
    expect(Math.abs(off.time - t60 - (seg.ta - r.params.period / 6))).toBeLessThan(2 * r.params.dt)
    const after = state120(r, Math.ceil(off.time / r.params.dt) + 2)
    expect(after.ties[1]).toBe('open')
    expect(Math.abs(after.ib)).toBeLessThan(1e-3)
  })
  it('the periodic steady state is reached by shooting; a start-up from rest settles to it', () => {
    const r = sim({ load: 'RL' })
    expect(r.diagnostics.steady.method).toBe('shooting')
    expect(r.diagnostics.steady.residual).toBeLessThan(1e-8)
    const s = run({ load: 'RL', view: 'startup' })
    expect(s.r.diagnostics.steady.converged).toBe(true)
    expect(Math.abs(s.m.irms / run({ load: 'RL' }).m.irms - 1)).toBeLessThan(0.01)
  })
  it('power balance at the cursor: source = resistors + inductors + devices + bleed', () => {
    for (const o of [{}, { load: 'RL' as const }, { load: 'RL' as const, devices: 'real' as const }]) {
      const r = sim(o)
      for (let k = 1; k < r.length; k += 37) {
        const e = energy120(state120(r, k), r)
        expect(Math.abs(e.balance!)).toBeLessThan(1e-6 * Math.max(...e.ledger.map((x) => Math.abs(x.watts))) + 1e-6)
      }
    }
  })
})

describe('120° conduction: simulation vs the exact theory', () => {
  const cases: Array<Partial<Inv120Params>> = [
    {},
    { load: 'RL' },
    { load: 'RL', l: 1e-3 },
    { load: 'RL', l: 5e-3, f1: 400 },
    { load: 'RL', l: 0.1 },
    { load: 'RL', l: 0.5, r: 1 },
    { vdc: 400, r: 2 },
    { conduction: 180 },
    { conduction: 180, load: 'RL' },
    { load: 'RL', devices: 'real' },
  ]
  it.each(cases.map((o) => [JSON.stringify(o), o] as const))('%s', (_n, o) => {
    const { r, m } = run(o)
    const c = compare120(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    // with ideal devices the agreement is far inside the tolerance
    if (r.params.devices === 'ideal') for (const row of c.rows) expect(row.error).toBeLessThan(row.tolerance / 3)
  })
  it('R load: the textbook values hold (and the theory reproduces them exactly)', () => {
    const { r, m } = run()
    const V = 100
    const tb = textbook120(r.params)
    expect(m.vph1).toBeCloseTo((Math.sqrt(3) * V) / Math.PI, 1)
    expect(m.vph1 / Math.SQRT2).toBeCloseTo((Math.sqrt(6) / Math.PI) * (V / 2), 1)
    expect(m.v1).toBeCloseTo((3 * V) / Math.PI, 1)
    expect(m.vphRms).toBeCloseTo(V / Math.sqrt(6), 1)
    expect(m.vrms).toBeCloseTo(V / Math.SQRT2, 1)
    expect(m.thdPh).toBeCloseTo(Math.sqrt(Math.PI ** 2 / 9 - 1), 3)
    for (const h of [2, 3, 4, 6, 9]) expect(m.vHarm[h].amp).toBeLessThan(1e-3 * m.v1)
    for (const h of [5, 7, 11, 13]) expect(m.vHarm[h].amp).toBeCloseTo(Math.sqrt(3) * Math.abs(((2 * V) / (h * Math.PI)) * Math.cos((h * Math.PI) / 6)), 1)
    expect(m.floatFraction).toBeCloseTo(1, 3)
    for (const k of ['vph1', 'vphRms', 'v1', 'vrms', 'thdPh']) expect(tb[k].notApplicable).toBeUndefined()
    // the theory on its own equals the textbook to rounding
    const c = compare120(r, m)
    for (const k of ['vph1', 'vphRms', 'v1', 'vrms', 'thdPh']) {
      const row = c.rows.find((x) => x.key === k)!
      expect(Math.abs(row.exact - row.textbook!.value!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(row.exact)))
    }
  })
  it('180° vs 120°: the line fundamental is 2/√3 larger, no leg ever floats, each switch conducts 1/2 instead of 1/3', () => {
    const a = run().m
    const b = run({ conduction: 180 }).m
    expect(b.v1 / a.v1).toBeCloseTo(2 / Math.sqrt(3), 3)
    expect(b.v1).toBeCloseTo((2 * Math.sqrt(3) * 100) / Math.PI, 1)
    expect(b.floatFraction).toBeLessThan(1e-6)
    expect(a.s1Frac).toBeCloseTo(1 / 3, 3)
    expect(b.s1Frac).toBeCloseTo(1 / 2, 3)
  })
  it('R-L load: the staircase does not hold — the diodes shorten the open intervals; a large L gives six-step', () => {
    const rl = run({ load: 'RL' }).m
    expect(rl.diodeFraction).toBeGreaterThan(0.1)
    expect(rl.floatFraction).toBeLessThan(0.9)
    expect(Math.abs(rl.vph1 - (Math.sqrt(3) * 100) / Math.PI)).toBeGreaterThan(0.5)
    const big = run({ load: 'RL', l: 0.1 }).m
    expect(big.floatFraction).toBeLessThan(1e-3)
    expect(big.vph1).toBeCloseTo((2 * 100) / Math.PI, 1)
    expect(textbook120(resolve120({ load: 'RL' }).params).vph1.notApplicable).toBeDefined()
  })
  it('theory fractions: R load — no diode, each leg open 2 × 60°', () => {
    const p = resolve120({}).params
    const f = fractions120(p, theory120(p))
    expect(f.diode).toBe(0)
    expect(f.open).toBeCloseTo(1, 12)
  })
})

describe('120° conduction: the topic', () => {
  it('a default run is fast enough for interactive use', () => {
    for (const o of [{}, { load: 'RL' as const }]) {
      const t0 = cpuNow()
      const r = sim(o)
      const simMs = cpuNow() - t0
      T.measure(r)
      expect(cpuNow() - t0).toBeLessThan(3000)
      expect(simMs).toBeLessThan(1500)
    }
  })
  it('state, view, status, path, WHY, inspector and readings read the run without NaN', () => {
    for (const o of [{}, { load: 'RL' as const }, { conduction: 180 as const }]) {
      const { r, m } = run(o)
      for (const x of readings120(m, r)) noBad(`${x.label} ${x.value} ${x.unit} ${x.note}`)
      expect(readings120(m, r).length).toBe(4)
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 60))) {
        const st = state120(r, k)
        noBad(JSON.stringify(view120(st, r)))
        noBad(JSON.stringify(status120(st)))
        noBad(JSON.stringify(path120(st)))
        for (const c of why120(r, st, m)) noBad(Object.values(c).join(' '))
        for (const part of T.parts ?? []) noBad(JSON.stringify(T.inspect!(part.id, st, m, r)))
      }
    }
  })
  it('lessons: every step renders from its own run; the lesson claims hold in the simulation', () => {
    expect(T.lessons.length).toBe(3)
    for (const l of T.lessons) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      for (const s of l.steps) {
        const r = T.simulate({ ...T.defaults, ...l.base, ...s.params }) as Run120
        const m = T.measure(r)
        const t = s.at(r)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration)
        noBad(s.body(T.state(r, Math.round(t / r.params.dt)), m, r))
        for (const c of s.channels) expect(T.channels[c], c).toBeDefined()
      }
    }
    // 'two': van levels ±Vdc/2 and 0 (checked above); 'rl' step 1: D3 conducts at 62°
    const rl = T.lessons[1]
    const r = T.simulate({ ...T.defaults, ...rl.base }) as Run120
    expect(T.state(r, Math.round(rl.steps[0].at(r) / r.params.dt)).legs[1].conducting).toBe('D3')
    // 'vs180': ×2/√3
    const a = run().m.v1
    const b = run({ conduction: 180 }).m.v1
    expect(b / a).toBeCloseTo(1.1547, 3)
    expect(T.lessons[2].check!.answer).toBe(0)
  })
  it('experiments: verdicts from the before/after simulations are the expected ones', () => {
    const p0 = { ...T.defaults }
    for (const e of T.experiments) {
      const before = run(p0).m
      const p1 = { ...p0, ...e.change(p0) }
      const after = run(p1).m
      expect(e.judge(before, after), e.id).toBe(0)
      noBad(e.why(before, after, p0, p1))
    }
  })
  it('predictions: answers come from the simulation and agree with the stated theory', () => {
    for (const seed of [0, 1, 2, 3, 5]) {
      for (const task of T.predictions(seed)) {
        const { r, m } = run(task.params)
        const ans = task.answer(m)
        noBad(task.theory(r.params))
        const V = r.params.vdc
        if (task.id === 'vph1') expect(Math.abs(ans / ((Math.sqrt(3) * V) / Math.PI) - 1)).toBeLessThan(0.005)
        if (task.id === 'vll1') expect(Math.abs(ans / ((3 * V) / Math.PI) - 1)).toBeLessThan(0.005)
        if (task.id === 'vphrms') expect(Math.abs(ans / (V / Math.sqrt(6)) - 1)).toBeLessThan(0.005)
        if (task.id === 'count') expect(ans).toBe(1)
      }
    }
  })
})
