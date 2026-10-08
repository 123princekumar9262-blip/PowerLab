import { describe, expect, it } from 'vitest'
import { compareBuck, TOL } from '../src/converters/buck/compare.ts'
import { buckStateAt, buckWhy, voltSecondFromSim } from '../src/converters/buck/explain.ts'
import { BUCK_EXPERIMENTS, BUCK_LESSONS, buckPredictTasks, lessonTime } from '../src/converters/buck/learn.ts'
import { measureBuck } from '../src/converters/buck/measure.ts'
import { BUCK_MODEL } from '../src/converters/buck/model.ts'
import { buckBoundary, buckExact, buckTextbook } from '../src/converters/buck/theory.ts'
import { converterIndexAt, simulateConverter } from '../src/converters/engine.ts'
import { expm } from '../src/converters/expm.ts'
import { BUCK_DEFAULTS, resolveConverter } from '../src/converters/params.ts'
import type { ConverterParams, ConverterResult } from '../src/converters/types.ts'

const sim = (o: Partial<ConverterParams> = {}) => simulateConverter(BUCK_MODEL, { ...BUCK_DEFAULTS, ...o })
const run = (o: Partial<ConverterParams> = {}) => {
  const r = sim(o)
  return { r, m: measureBuck(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('buck: circuit physics from the simulation', () => {
  const { r } = run()
  const { il, ic, io, iq, id, vl, vout, vsw, gate } = r.signals

  it('KCL holds at every sample: iL = iC + iR at the output, iL = iQ + iD at the switch node', () => {
    for (let k = 0; k < r.length; k++) {
      expect(Math.abs(il[k] - ic[k] - io[k])).toBeLessThan(1e-9)
      expect(Math.abs(il[k] - iq[k] - id[k])).toBeLessThan(1e-9)
    }
  })
  // The integrator is the trapezoidal rule, with one backward-Euler step after every switching instant.
  const eventSteps = (rr: ConverterResult) => {
    const set = new Set<number>()
    for (const e of rr.events) {
      const k = Math.ceil(e.time / rr.params.dt - 1e-9)
      for (const q of [k - 1, k, k + 1, k + 2]) set.add(q)
    }
    return set
  }
  it('the inductor obeys L·diL/dt = vL (trapezoidal rule: ΔiL = Δt·(vL[k−1] + vL[k])/(2L) on smooth steps)', () => {
    const p = r.params
    const skip = eventSteps(r)
    let checked = 0
    for (let k = 1; k < r.length; k++) {
      if (skip.has(k)) continue
      expect(il[k] - il[k - 1]).toBeCloseTo((p.dt * (vl[k] + vl[k - 1])) / (2 * p.l), 9)
      checked++
    }
    expect(checked).toBeGreaterThan(700)
  })
  it('vL = vsw − vout and C·dvC/dt = iC (energy-storage equations)', () => {
    const p = r.params
    const skip = eventSteps(r)
    for (let k = 1; k < r.length; k++) {
      expect(vl[k]).toBeCloseTo(vsw[k] - vout[k], 9)
      if (!skip.has(k)) expect(r.signals.vc[k] - r.signals.vc[k - 1]).toBeCloseTo((p.dt * (ic[k] + ic[k - 1])) / (2 * p.c), 9)
    }
  })
  it('Q1 follows its gate exactly; D1 never conducts backwards and never blocks a forward voltage', () => {
    const p = r.params
    for (let k = 0; k < r.length; k++) {
      expect(r.devices[0].on[k]).toBe(gate[k])
      expect(id[k]).toBeGreaterThanOrEqual(-1e-12)
      if (!r.devices[1].on[k]) expect(r.signals.vd[k]).toBeLessThanOrEqual(p.d.vf + 1e-9)
    }
  })
  it('PWM edges are exact: Q1 turns on at m·Ts and off at (m + D)·Ts, even when D·Ts is not on the time grid', () => {
    for (const duty of [0.5, 0.333, 0.71]) {
      const rr = sim({ duty })
      const T = rr.params.ts
      const ons = rr.events.filter((e) => e.kind === 'gate-on').map((e) => e.time / T)
      const offs = rr.events.filter((e) => e.kind === 'gate-off').map((e) => e.time / T)
      ons.forEach((u, i) => expect(u).toBeCloseTo(i, 9))
      offs.forEach((u, i) => expect(u).toBeCloseTo(i + duty, 9))
      expect(measureBuck(rr).dutyMeasured).toBeCloseTo(duty, 9)
    }
  })
  it('at turn-off the inductor current is continuous and moves into D1 at the same instant (forced commutation)', () => {
    for (const off of r.events.filter((e) => e.kind === 'gate-off')) {
      const on = r.events.find((e) => e.kind === 'diode-on' && Math.abs(e.time - off.time) < 1e-12)
      expect(on).toBeDefined()
      expect(on!.values.il!).toBeCloseTo(off.values.il!, 6)
      expect(on!.values.id!).toBeCloseTo(on!.values.il!, 6)
    }
  })
  it('the shown run is the periodic steady state (shooting method, verified over the shown periods)', () => {
    const d = r.diagnostics.steady
    expect(d.method).toBe('shooting')
    expect(d.converged).toBe(true)
    expect(d.residual).toBeLessThan(1e-8)
    const N = r.params.stepsPerPeriod
    for (let k = 0; k + N < r.length; k += 37) expect(il[k + N]).toBeCloseTo(il[k], 6)
    expect(r.diagnostics.fallbacks).toBe(0)
  })
  it('a start-up run from a discharged circuit settles to the same steady state', () => {
    const s = run({ view: 'startup' })
    expect(s.r.signals.vout[0]).toBeCloseTo(0, 12)
    expect(s.r.signals.il[0]).toBeCloseTo(0, 6)
    expect(s.r.diagnostics.steady.converged).toBe(true)
    const steady = run().m
    expect(s.m.voutAvg).toBeCloseTo(steady.voutAvg, 1)
    expect(Math.abs(s.m.ilPP - steady.ilPP) / steady.ilPP).toBeLessThan(0.01)
  })
})

describe('buck: simulation agrees with the exact analytic solution over the parameter space', () => {
  const grid: Array<Partial<ConverterParams>> = []
  for (const duty of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const r of [2, 6, 30, 200]) grid.push({ duty, r })
  grid.push(
    { devices: 'real' },
    { devices: 'real', rl: 0.1, esr: 0.05 },
    { devices: 'real', duty: 0.2, r: 40, vfD: 0.7 },
    { l: 10e-6, r: 3 },
    { c: 10e-6 },
    { fs: 200e3 },
    { fs: 2e3, l: 1e-3 },
    { vin: 400, r: 100 },
    { esr: 0.2 },
  )
  it.each(grid.map((g) => [JSON.stringify(g), g] as const))('%s', (_n, g) => {
    const { r, m } = run(g)
    const c = compareBuck(r, m)
    for (const row of c.rows) {
      if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    }
    expect(c.modeAgrees).toBe(true)
  })
  it('the error vs exact theory is first order: ΔiL error halves when Δt halves', () => {
    const err = [100, 200, 400].map((spp) => {
      const { r, m } = run({ stepsPerPeriod: spp, periods: 1 })
      return compareBuck(r, m).rows.find((x) => x.key === 'ilPP')!.error
    })
    expect(err[1] / err[0]).toBeLessThan(0.7)
    expect(err[2] / err[1]).toBeLessThan(0.7)
  })
})

describe('buck: textbook relations where their assumptions hold', () => {
  it('ideal CCM: Vout = D·Vin, IL = Vout/R, ΔiL = Vout(1 − D)/(L·fs), ΔVout = ΔiL/(8·C·fs)', () => {
    for (const duty of [0.3, 0.5, 0.7]) {
      const { r, m } = run({ duty, l: 300e-6, c: 470e-6 })
      const tb = buckTextbook(r.params)
      expect(m.mode).toBe('CCM')
      expect(Math.abs(m.voutAvg - duty * 24) / (duty * 24)).toBeLessThan(0.001)
      expect(Math.abs(m.ilAvg - tb.ilAvg.value!) / tb.ilAvg.value!).toBeLessThan(0.001)
      expect(Math.abs(m.ilPP - tb.ilPP.value!) / tb.ilPP.value!).toBeLessThan(0.01)
      expect(Math.abs(m.voutPP - tb.voutPP.value!) / tb.voutPP.value!).toBeLessThan(0.03)
    }
  })
  it('the CCM/DCM boundary: L 10 % above Lcrit is CCM, 10 % below is DCM', () => {
    const p = resolveConverter({ ...BUCK_DEFAULTS, r: 10 }).params
    const lc = buckBoundary(p).lCrit
    expect(run({ r: 10, l: lc * 1.1 }).m.mode).toBe('CCM')
    expect(run({ r: 10, l: lc * 0.9 }).m.mode).toBe('DCM')
  })
  it('ideal DCM: Vout/Vin = 2/(1 + √(1 + 4K/D²)) and D2 = D(1 − M)/M', () => {
    for (const [duty, r] of [
      [0.25, 6],
      [0.5, 40],
      [0.7, 200],
    ]) {
      const { r: rr, m } = run({ duty, r, c: 470e-6 })
      const tb = buckTextbook(rr.params)
      expect(m.mode).toBe('DCM')
      expect(Math.abs(m.voutAvg - tb.voutAvg.value!) / tb.voutAvg.value!).toBeLessThan(0.01)
      expect(Math.abs(m.d2 - tb.d2.value!)).toBeLessThan(0.01)
    }
  })
  it('textbook values carry their assumptions and are flagged where they do not apply', () => {
    const real = buckTextbook(resolveConverter({ ...BUCK_DEFAULTS, devices: 'real' }).params)
    expect(real.voutAvg.notApplicable).toMatch(/Non-ideal/)
    const esr = buckTextbook(resolveConverter({ ...BUCK_DEFAULTS, esr: 0.1 }).params)
    expect(esr.voutPP.notApplicable).toMatch(/ESR/)
    const ideal = buckTextbook(resolveConverter(BUCK_DEFAULTS).params)
    expect(ideal.voutAvg.assumptions.join(' ')).toMatch(/CCM/)
    expect(ideal.voutAvg.notApplicable).toBeUndefined()
  })
})

describe('buck: exact theory (independent of the simulator)', () => {
  it('the matrix exponential matches the scalar exponential and a rotation', () => {
    expect(expm([[-2]])[0][0]).toBeCloseTo(Math.exp(-2), 14)
    const R = expm([
      [0, -1],
      [1, 0],
    ])
    expect(R[0][0]).toBeCloseTo(Math.cos(1), 14)
    expect(R[1][0]).toBeCloseTo(Math.sin(1), 14)
  })
  it('ideal CCM limit: exact Vout → D·Vin and the exact ripple → the textbook ripple for small ripple', () => {
    const p = resolveConverter({ ...BUCK_DEFAULTS, l: 1e-3, c: 1e-3 }).params
    const ex = buckExact(p)
    expect(ex.mode).toBe('CCM')
    expect(ex.metrics.voutAvg / (0.5 * 24)).toBeCloseTo(1, 3)
    expect((ex.metrics.ilMax - ex.metrics.ilMin) / ((12 * 0.5) / (1e-3 * 20e3))).toBeCloseTo(1, 2)
  })
  it('the exact steady state is periodic and conserves energy: Pin = Pout + device losses', () => {
    const p = resolveConverter({ ...BUCK_DEFAULTS, devices: 'real', rl: 0.05 }).params
    const ex = buckExact(p)
    const a = ex.at(0)
    const b = ex.at(p.ts - 1e-15)
    expect(b.iL).toBeCloseTo(a.iL, 6)
    expect(b.vC).toBeCloseTo(a.vC, 6)
    const { m } = run({ devices: 'real', rl: 0.05 })
    expect(Math.abs(ex.metrics.pinAvg - (m.poutAvg + m.losses.total)) / ex.metrics.pinAvg).toBeLessThan(0.002)
  })
})

describe('buck: measurements', () => {
  it('efficiency: ideal ≈ 100 %, real devices lose power; matches the exact theory', () => {
    const ideal = run().m
    expect(ideal.efficiency).toBeGreaterThan(0.999)
    const { r, m } = run({ devices: 'real', rl: 0.05 })
    expect(m.efficiency).toBeLessThan(0.97)
    expect(Math.abs(m.efficiency - buckExact(r.params).metrics.efficiency)).toBeLessThan(TOL.efficiency)
    expect(m.losses.d).toBeGreaterThan(m.losses.q)
  })
  it('timing and stress: fs, D, D2 + D3 from the events; the switch blocks Vin (+Vf), the diode blocks Vin', () => {
    const { m } = run({ r: 30 })
    expect(m.fsMeasured).toBeCloseTo(20e3, 6)
    expect(m.dutyMeasured + m.d2 + m.d3).toBeCloseTo(1, 6)
    expect(m.mode).toBe('DCM')
    expect(m.vqMax).toBeCloseTo(24, 1)
    expect(m.vdReverseMax).toBeCloseTo(24, 1)
    const real = run({ devices: 'real' }).m
    expect(real.vqMax).toBeGreaterThan(24.5)
  })
  it('volt-second balance in the simulated data: average vL = 0 and average vsw = average Vout', () => {
    for (const o of [{}, { r: 30 }, { devices: 'real' as const }, { duty: 0.333 }, { r: 30, duty: 0.333 }]) {
      const vs = voltSecondFromSim(sim(o))
      expect(Math.abs(vs.vlAvg)).toBeLessThan(1e-4)
      expect(Math.abs(vs.vswAvg - vs.voutAvg)).toBeLessThan(1e-4)
    }
  })
})

describe('buck: explanations from the simulation state', () => {
  const at = (r: ConverterResult, part: 'on' | 'off' | 'idle') => {
    const p = r.params
    const u = part === 'on' ? 0.5 * p.duty : part === 'off' ? p.duty + 0.02 * (1 - p.duty) : 0.98
    return buckStateAt(r, converterIndexAt(r, (1 + u) * p.ts))
  }
  it('classifies the interval and the current path; WHY changes with the state', () => {
    const r = sim()
    const m = measureBuck(r)
    const on = at(r, 'on')
    expect(on.interval).toBe('on')
    expect(on.path).toContain('q1')
    expect(on.path).not.toContain('d1')
    const wOn = buckWhy(r, on, m)
    expect(wOn[0].question).toBe('Why is D1 OFF?')
    expect(wOn[1].question).toBe('Why is iL rising?')
    const off = at(r, 'off')
    expect(off.interval).toBe('off')
    expect(off.path).toContain('d1')
    const wOff = buckWhy(r, off, m)
    expect(wOff[0].question).toBe('Why did D1 turn ON?')
    expect(wOff[1].question).toBe('Why is iL falling?')
    const rd = sim({ r: 30 })
    const idle = at(rd, 'idle')
    expect(idle.interval).toBe('idle')
    expect(idle.il).toBeCloseTo(0, 9)
    expect(idle.vsw).toBeCloseTo(idle.vout, 6)
    expect(buckWhy(rd, idle, measureBuck(rd))[0].question).toBe('Why is D1 OFF while Q1 is OFF?')
  })
  it('every number in a WHY card is the simulated value at the cursor, and no card contains NaN', () => {
    for (const o of [{}, { r: 30 }, { devices: 'real' as const, esr: 0.05 }]) {
      const r = sim(o)
      const m = measureBuck(r)
      for (let k = 0; k < r.length; k += 13) {
        const st = buckStateAt(r, k)
        expect(st.dildt).toBeCloseTo(st.vl / r.params.l, 6)
        for (const c of buckWhy(r, st, m)) for (const s of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(s)
        const vCard = buckWhy(r, st, m).find((c) => c.id === 'vout')!
        if (st.ic > 1e-6) expect(vCard.why).toMatch(/charges the capacitor/)
        if (st.ic < -1e-6) expect(vCard.why).toMatch(/capacitor supplies/)
      }
    }
  })
})

describe('buck: learning content runs on the simulation', () => {
  it('lessons: every step places the cursor in its interval and its text has values', () => {
    for (const l of BUCK_LESSONS) {
      for (const s of l.steps) {
        const r = sim({ ...l.base, ...s.params })
        const m = measureBuck(r)
        const st = buckStateAt(r, converterIndexAt(r, lessonTime(s.at, r.params)))
        if (s.at[0] === 'on') expect(st.interval).toBe('on')
        else expect(st.interval).not.toBe('on')
        noBadText(s.body(st, m, r))
      }
    }
  })
  it('experiments: the simulation confirms the physically expected answer from the defaults', () => {
    for (const e of BUCK_EXPERIMENTS) {
      const p0 = { ...BUCK_DEFAULTS }
      const before = measureBuck(sim(p0))
      const p1 = { ...p0, ...e.change(p0) }
      const after = measureBuck(sim(p1))
      expect([e.id, e.judge(before, after)]).toEqual([e.id, 0])
      noBadText(e.why(before, after, p0, p1))
      noBadText(e.question(p0))
    }
  })
  it('prediction tasks are answered by the simulation with finite values', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const t of buckPredictTasks(seed)) {
        const m = measureBuck(sim(t.params))
        expect(Number.isFinite(t.answer(m))).toBe(true)
      }
    }
  })
})

describe('buck: parameters', () => {
  it('clamps out-of-range and non-finite values and reports them', () => {
    const { params, issues } = resolveConverter({ duty: 1.5, l: Number.NaN, fs: 10 })
    expect(params.duty).toBe(0.9)
    expect(params.l).toBe(BUCK_DEFAULTS.l)
    expect(params.fs).toBe(1e3)
    expect(issues.length).toBeGreaterThanOrEqual(3)
  })
  it('defaults are safe educational values: CCM, 12 V out, 2 A', () => {
    const { m } = run()
    expect(m.mode).toBe('CCM')
    expect(m.voutAvg).toBeCloseTo(12, 1)
    expect(m.ioAvg).toBeCloseTo(2, 2)
  })
})
