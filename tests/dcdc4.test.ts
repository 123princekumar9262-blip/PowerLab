import { describe, expect, it } from 'vitest'
import { compareBidi, compareCoupled } from '../src/converters/dcdc4/compare.ts'
import { bidiStateAt, bidiWhy, coupledEnergy, bidiEnergy, coupledStateAt, coupledWhy } from '../src/converters/dcdc4/explain.ts'
import { BIDI_LESSONS, bidiExperiments, bidiLessonTime, bidiPredictTasks, COUPLED_LESSONS, coupledExperiments, coupledLessonTime, coupledPredictTasks } from '../src/converters/dcdc4/learn.ts'
import { measureBidi, measureCoupled, type BidiRun, type CoupledRun } from '../src/converters/dcdc4/measure.ts'
import { bidiModel, coupledModel } from '../src/converters/dcdc4/model.ts'
import { BIDI_DEFAULTS, COUPLED_DEFAULTS, resolveCoupled, type BidiParams, type CoupledKind, type CoupledParams } from '../src/converters/dcdc4/params.ts'
import { bidiExact, bidiTextbook, coupledBoundary, coupledExact, coupledTextbook } from '../src/converters/dcdc4/theory.ts'
import { converterIndexAt, segmentAverage, simulateCircuit } from '../src/converters/engine.ts'
import { coupledTopic, bidiTopic, DCDC_ADVANCED_TOPICS } from '../src/topics/dcdcAdvanced.tsx'
import { cpuNow } from './helpers.ts'

/*
 * The advanced DC-DC converters (Ćuk, SEPIC, Zeta, bidirectional half-bridge): the netlist simulation on the
 * generic engine against an INDEPENDENT theory — the hand-written mode equations solved exactly (matrix
 * exponential, exact mode changes, Newton on the exact period map) — and against the textbook relations
 * where their assumptions hold.
 *
 * Tolerances (the same as the basic converters, see compare.ts): averages 0.2 %, ripples 3 %, peaks 1 % of
 * the current scale, efficiency 0.2 % and timing 0.5 % of Ts absolute. The trapezoidal integrator conserves
 * charge and volt-seconds per step, so the measured agreement is far tighter (< 0.05 %); the tolerances
 * leave margin for the O(Δt²) waveform error at 200 steps per period.
 */

const KINDS: CoupledKind[] = ['cuk', 'sepic', 'zeta']
const simC = (kind: CoupledKind, o: Partial<CoupledParams> = {}) => simulateCircuit(coupledModel(kind), { ...COUPLED_DEFAULTS, ...o }) as CoupledRun
const runC = (kind: CoupledKind, o: Partial<CoupledParams> = {}) => {
  const r = simC(kind, o)
  return { r, m: measureCoupled(r) }
}
const simB = (o: Partial<BidiParams> = {}) => simulateCircuit(bidiModel(), { ...BIDI_DEFAULTS, ...o }) as BidiRun
const runB = (o: Partial<BidiParams> = {}) => {
  const r = simB(o)
  return { r, m: measureBidi(r) }
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe.each(KINDS)('%s: circuit physics from the simulation', (kind) => {
  const { r, m } = runC(kind)
  const s = r.signals
  it('the switch and the diode each carry iL1 + iL2 while they conduct; Q1 follows its gate; D1 never conducts backwards', () => {
    for (let k = 0; k < r.length; k++) {
      const sum = s.il1[k] + s.il2[k]
      if (r.devices[0].on[k]) expect(Math.abs(s.iq[k] - sum)).toBeLessThan(1e-9)
      if (r.devices[1].on[k]) expect(Math.abs(s.id[k] - sum)).toBeLessThan(1e-9)
      expect(r.devices[0].on[k]).toBe(s.gate[k])
      expect(s.id[k]).toBeGreaterThanOrEqual(-1e-12)
      expect(r.devices[0].on[k] && r.devices[1].on[k]).toBeFalsy()
    }
  })
  it('output polarity: Ćuk inverted, SEPIC and Zeta not', () => {
    if (kind === 'cuk') expect(m.voutMax).toBeLessThan(0)
    else expect(m.voutMin).toBeGreaterThan(0)
    expect(m.il1Min).toBeGreaterThan(0)
    expect(m.il2Min).toBeGreaterThan(0)
  })
  // CCM: exact to the steady-state residual (the trapezoidal rule conserves volt-seconds and charge per step). DCM: the diode
  // turn-off falls inside a step, which the event-aware average splits as a rectangle while the integrator
  // used the trapezoid on the held side — an O(Δt²) quadrature difference (measured ≤ 4e-5): bound 1e-4.
  it('volt-second balance on both inductors and charge balance on C1 hold in the simulated data', () => {
    for (const o of [{}, { r: 60 }, { devices: 'real' as const, rl: 0.05, esr: 0.02 }, { duty: 0.25 }, { duty: 0.75 }]) {
      const rr = simC(kind, o)
      const mm = measureCoupled(rr)
      const tol = mm.mode === 'CCM' ? 1e-7 : 1e-4
      expect(Math.abs(segmentAverage(rr, 'vl1')) / rr.params.vin).toBeLessThan(tol)
      expect(Math.abs(segmentAverage(rr, 'vl2')) / rr.params.vin).toBeLessThan(tol)
      expect(Math.abs(segmentAverage(rr, 'ic1')) / Math.max(mm.il1Avg, mm.il2Avg)).toBeLessThan(tol)
    }
  })
  it('periodic steady state by shooting, few iterations, no inconsistent steps', () => {
    for (const o of [{}, { r: 60 }, { duty: 0.2, r: 300 }]) {
      const rr = simC(kind, o)
      expect(rr.diagnostics.steady.method).toBe('shooting')
      expect(rr.diagnostics.steady.residual).toBeLessThan(1e-8)
      expect(rr.diagnostics.steady.iterations).toBeLessThanOrEqual(12)
      expect(rr.diagnostics.fallbacks).toBe(0)
    }
  })
  it('energy: Pin = Pout + measured losses, and the energy ledger at the cursor sums to zero', () => {
    const { r: rr, m: mm } = runC(kind, { devices: 'real', rl: 0.05, esr: 0.02 })
    expect(Math.abs(mm.pinAvg - mm.poutAvg - mm.losses.total) / mm.pinAvg).toBeLessThan(2e-3)
    for (let k = 3; k < rr.length; k += 17) {
      const e = coupledEnergy(coupledStateAt(rr, k), mm, rr)
      expect(Math.abs(e.balance!)).toBeLessThan(e.tolerance)
    }
  })
})

describe.each(KINDS)('%s: simulation agrees with the exact analytic solution', (kind) => {
  const grid: Array<Partial<CoupledParams>> = []
  for (const duty of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const r of [3, 12, 60, 300]) grid.push({ duty, r })
  grid.push({ devices: 'real' }, { devices: 'real', rl: 0.1, esr: 0.05, duty: 0.7 }, { l1: 50e-6, l2: 1e-3 }, { l1: 1e-3, l2: 40e-6, r: 30 }, { c1: 4.7e-6 }, { fs: 100e3 }, { esr: 0.2, r: 6 }, { vin: 48, duty: 0.3 },
    // C1 so small that it swings through zero: D1 conducts while Q1 is ON (mode 'ond')
    { c1: 1e-6, r: 3 },
    // the L–C1 resonance above fs: several diode transitions per period (needs finer steps for the 0.2 % averages)
    { l1: 10e-6, l2: 10e-6, c1: 1e-6, stepsPerPeriod: 800 })
  it.each(grid.map((g) => [JSON.stringify(g), g] as const))('%s', (_n, g) => {
    const { r, m } = runC(kind, g)
    const c = compareCoupled(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    expect(c.modeAgrees).toBe(true)
  })
  it('outside the validated range (Q1 turning off with reverse current) the comparison is withheld, not faked', () => {
    const { r, m } = runC(kind, { l1: 10e-3, l2: 1e-6 })
    const c = compareCoupled(r, m)
    if (kind === 'sepic') return // the SEPIC's L2 keeps iL1 + iL2 positive here
    expect(m.reverseTurnOff).toBe(true)
    expect(c.exact.reverseTurnOff).toBe(true)
    expect(c.outside).toBe(true)
    expect(c.allPass).toBe(false)
    for (const row of c.rows) expect(row.expected).toMatch(/reverse current/)
  })
  it('the error of the averages is far below the tolerance, and falls when Δt halves', () => {
    const err = [100, 200, 400].map((spp) => {
      const { r, m } = runC(kind, { stepsPerPeriod: spp, periods: 1 })
      return compareCoupled(r, m).rows.find((x) => x.key === 'vc1PP')!.error
    })
    expect(err[1]).toBeLessThan(1e-3)
    expect(err[1] / err[0]).toBeLessThan(0.5)
    expect(err[2] / err[1]).toBeLessThan(0.5)
  })
  it('a start-up run starts from rest, stays interactive, and (with damping) settles to the steady-state averages', () => {
    const t0 = cpuNow()
    const st = runC(kind, { view: 'startup' })
    expect(cpuNow() - t0).toBeLessThan(3000)
    expect(st.r.params.periods).toBeLessThanOrEqual(150)
    for (const sid of ['il1', 'il2', 'vc1', 'vc']) expect(Math.abs(st.r.signals[sid][0])).toBeLessThan(1e-6)
    // without DCR the L–C1 resonance is lightly damped and outlasts the start-up window (stated in the UI);
    // with 0.5 Ω of DCR it settles inside it
    const damped = runC(kind, { view: 'startup', rl: 0.5 })
    expect(damped.r.diagnostics.steady.converged).toBe(true)
    expect(rel(damped.m.voutAvg, runC(kind, { rl: 0.5 }).m.voutAvg)).toBeLessThan(0.002)
  })
})

describe('Ćuk, SEPIC, Zeta: textbook relations where their assumptions hold', () => {
  it('ideal CCM laws for D below and above 50 % (large L and C: small ripple)', () => {
    for (const kind of KINDS)
      for (const duty of [0.3, 0.5, 0.7]) {
        const { r, m } = runC(kind, { duty, l1: 3e-3, l2: 3e-3, c1: 1e-3, c: 2e-3, r: 12 })
        const tb = coupledTextbook(r.params)
        expect(m.mode).toBe('CCM')
        expect(rel(m.voutAvg, tb.voutAvg.value!)).toBeLessThan(0.002)
        expect(rel(m.vc1Avg, tb.vc1Avg.value!)).toBeLessThan(0.002)
        expect(rel(m.il1Avg, tb.il1Avg.value!)).toBeLessThan(0.003)
        expect(rel(m.il2Avg, tb.il2Avg.value!)).toBeLessThan(0.003)
        expect(rel(m.il1PP, tb.il1PP.value!)).toBeLessThan(0.01)
        expect(rel(m.il2PP, tb.il2PP.value!)).toBeLessThan(0.01)
        expect(rel(m.vc1PP, tb.vc1PP.value!)).toBeLessThan(0.03)
        expect(rel(m.voutPP, tb.voutPP.value!)).toBeLessThan(0.05)
        // step-down below 50 %, step-up above
        if (duty < 0.5) expect(Math.abs(m.voutAvg)).toBeLessThan(r.params.vin)
        if (duty > 0.5) expect(Math.abs(m.voutAvg)).toBeGreaterThan(r.params.vin)
        expect(rel(m.vqMax, r.params.vin + Math.abs(m.voutAvg))).toBeLessThan(0.02)
      }
  })
  it('CCM/DCM boundary: Le 10 % above Le,crit is CCM, 10 % below is DCM', () => {
    for (const kind of KINDS)
      for (const duty of [0.3, 0.6]) {
        const p = resolveCoupled({ duty }, kind).params
        const lc = coupledBoundary(p).leCrit
        expect(runC(kind, { duty, l1: 2 * lc * 1.1, l2: 2 * lc * 1.1, c1: 470e-6 }).m.mode).toBe('CCM')
        expect(runC(kind, { duty, l1: 2 * lc * 0.9, l2: 2 * lc * 0.9, c1: 470e-6 }).m.mode).toBe('DCM')
      }
  })
  it('ideal DCM relations |Vout|/Vin = D/√Ke and D2 = √Ke (large C1 and C)', () => {
    for (const kind of KINDS)
      for (const r of [60, 300]) {
        const { r: rr, m } = runC(kind, { r, c1: 470e-6, c: 2e-3 })
        const tb = coupledTextbook(rr.params)
        expect(m.mode).toBe('DCM')
        expect(rel(m.voutAvg, tb.voutAvg.value!)).toBeLessThan(0.01)
        expect(Math.abs(m.d2 - tb.d2.value!)).toBeLessThan(0.01)
        expect(rel(m.vc1Avg, tb.vc1Avg.value!)).toBeLessThan(0.01)
      }
  })
  it('in DCM only the diode current reaches zero: the inductor currents circulate at ±I through C1', () => {
    for (const kind of KINDS) {
      const { r, m } = runC(kind, { r: 60 })
      expect(m.mode).toBe('DCM')
      let seen = 0
      for (let k = 1; k < r.length; k++)
        if (!r.devices[0].on[k] && !r.devices[1].on[k]) {
          seen++
          expect(Math.abs(r.signals.il1[k] + r.signals.il2[k])).toBeLessThan(1e-6)
          expect(Math.abs(r.signals.il1[k])).toBeGreaterThan(0.02)
        }
      expect(seen).toBeGreaterThan(10)
      expect(r.events.some((e) => e.kind === 'il-zero')).toBe(true)
    }
  })
  it('the exact theory converges in a few Newton steps and its own volt-second balance holds', () => {
    for (const kind of KINDS)
      for (const o of [{}, { r: 300 }]) {
        const ex = coupledExact(resolveCoupled({ ...COUPLED_DEFAULTS, ...o }, kind).params)
        expect(ex.residual).toBeLessThan(1e-9)
        expect(ex.newtonIterations).toBeLessThan(20)
      }
  })
})

describe('bidirectional half-bridge: physics from the simulation', () => {
  it('complementary gates; KCL at the switch node; power flows both ways with iL reversing sign', () => {
    for (const dir of ['buck', 'boost'] as const) {
      const { r, m } = runB({ dir })
      const s = r.signals
      for (let k = 0; k < r.length; k++) {
        expect(r.devices[0].on[k] && r.devices[2].on[k]).toBeFalsy()
        expect(Math.abs(s.iup[k] + s.ilo[k] - s.il[k])).toBeLessThan(1e-9)
      }
      if (dir === 'buck') {
        expect(m.ilMin).toBeGreaterThan(0)
        expect(m.phvAvg).toBeGreaterThan(0)
        expect(m.pbatAvg).toBeGreaterThan(0)
      } else {
        expect(m.ilMax).toBeLessThan(0)
        expect(m.phvAvg).toBeLessThan(0)
        expect(m.pbatAvg).toBeLessThan(0)
      }
      expect(m.direction).toBe(dir)
      // power balance of the whole circuit: bus = battery EMF + Rb + converter losses
      expect(Math.abs(m.phvAvg - m.pbatAvg - m.prbAvg - m.losses.total) / Math.abs(m.phvAvg)).toBeLessThan(2e-3)
      for (let k = 3; k < r.length; k += 19) {
        const e = bidiEnergy(bidiStateAt(r, k), m, r)
        expect(Math.abs(e.balance!)).toBeLessThan(e.tolerance)
      }
    }
  })
  it('the current reference is met by the feed-forward duty (ideal, no dead time) and iL crosses zero at light load without DCM', () => {
    for (const dir of ['buck', 'boost'] as const)
      for (const iref of [0.5, 2, 5, 10]) {
        const { r, m } = runB({ dir, iref })
        expect(Math.abs(m.irefError)).toBeLessThan(0.01 * iref + 0.02)
        if (iref < 1.4) {
          expect(m.reverses).toBe(true)
          expect(r.events.some((e) => e.kind === 'il-zero')).toBe(false)
        }
      }
  })
  it('steady state by shooting, no inconsistent steps, fast', () => {
    for (const o of [{}, { dir: 'boost' as const }, { deadTime: 1e-6 }, { iref: 0.3, deadTime: 2e-6, devices: 'real' as const }]) {
      const t0 = cpuNow()
      const r = simB(o)
      expect(cpuNow() - t0).toBeLessThan(3000)
      expect(r.diagnostics.steady.method).toBe('shooting')
      expect(r.diagnostics.steady.residual).toBeLessThan(1e-8)
      expect(r.diagnostics.fallbacks).toBe(0)
    }
  })
  it('a start-up run (C precharged to the battery EMF) settles to the steady state', () => {
    const st = runB({ view: 'startup' })
    expect(st.r.diagnostics.steady.converged).toBe(true)
    expect(rel(st.m.ibAvg, runB().m.ibAvg)).toBeLessThan(0.01)
  })
})

describe('bidirectional: simulation agrees with the exact analytic solution', () => {
  const grid: Array<Partial<BidiParams>> = []
  for (const dir of ['buck', 'boost'] as const) for (const iref of [0.5, 3, 10]) for (const deadTime of [0, 0.25e-6, 1e-6]) grid.push({ dir, iref, deadTime })
  grid.push({ devices: 'real' }, { devices: 'real', dir: 'boost', deadTime: 0.5e-6, rl: 0.05, esr: 0.01 }, { control: 'duty', duty: 0.3 }, { control: 'duty', duty: 0.7, rb: 1 }, { l: 50e-6, iref: 1 }, { fs: 100e3, deadTime: 0.2e-6 }, { c: 47e-6 })
  it.each(grid.map((g) => [JSON.stringify(g), g] as const))('%s', (_n, g) => {
    const { r, m } = runB(g)
    const c = compareBidi(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    expect(c.directionAgrees).toBe(true)
  })
  it('textbook: VLV = D·VHV, IL = (D·VHV − Eb)/(Rb + DCR + Ron), IHV = D·IL, ΔiL = VHV·D·(1 − D)/(L·fs) (ideal, no dead time)', () => {
    for (const o of [{}, { dir: 'boost' as const }, { control: 'duty' as const, duty: 0.4 }, { control: 'duty' as const, duty: 0.6, rb: 0.5 }, { iref: 0.5 }]) {
      const { r, m } = runB({ ...o, c: 4.7e-3 })
      const tb = bidiTextbook(r.params)
      const iScale = Math.max(Math.abs(tb.ilAvg.value!), m.ilPP)
      expect(rel(m.vlvAvg, tb.vlvAvg.value!)).toBeLessThan(5e-4)
      expect(Math.abs(m.ilAvg - tb.ilAvg.value!) / iScale).toBeLessThan(0.005)
      expect(Math.abs(m.ihvAvg - tb.ihvAvg.value!) / iScale).toBeLessThan(0.005)
      expect(rel(m.ilPP, tb.ilPP.value!)).toBeLessThan(0.01)
      expect(rel(m.vlvPP, tb.vlvPP.value!)).toBeLessThan(0.05)
      expect(rel(m.vlvAvg, r.params.d * r.params.vhv)).toBeLessThan(0.02)
    }
  })
  it('dead time: the effective duty depends on the current direction (charging current falls in buck, discharging current falls in boost)', () => {
    for (const dir of ['buck', 'boost'] as const) {
      const a = runB({ dir }).m
      const b = runB({ dir, deadTime: 0.25e-6 }).m
      expect(Math.abs(b.ibAvg)).toBeLessThan(Math.abs(a.ibAvg) * 0.8)
      expect(b.diodeFraction).toBeGreaterThan(0.005)
      const ex = bidiExact(simB({ dir, deadTime: 0.25e-6 }).params)
      expect(rel(b.ibAvg, ex.metrics.ibAvg)).toBeLessThan(0.002)
    }
  })
})

describe('advanced converters: explanations and content from the simulation', () => {
  it.each(KINDS)('%s: WHY follows the interval and never contains NaN', (kind) => {
    const r = simC(kind)
    const m = measureCoupled(r)
    const p = r.params
    const at = (u: number) => coupledStateAt(r, converterIndexAt(r, (1 + u) * p.ts))
    expect(coupledWhy(r, at(0.5 * p.duty), m)[0].question).toBe('Why is D1 OFF?')
    expect(coupledWhy(r, at(p.duty + 0.1 * (1 - p.duty)), m)[0].question).toBe('Why did D1 turn ON?')
    const rd = simC(kind, { r: 300 })
    const idle = coupledStateAt(rd, converterIndexAt(rd, 1.985 * p.ts))
    expect(idle.interval).toBe('idle')
    expect(coupledWhy(rd, idle, measureCoupled(rd))[0].question).toMatch(/while Q1 is OFF/)
    for (let k = 0; k < r.length; k += 11) for (const c of coupledWhy(r, coupledStateAt(r, k), m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
  })
  it('bidirectional: WHY names the device that really carries iL', () => {
    for (const o of [{}, { dir: 'boost' as const }, { deadTime: 0.25e-6 }]) {
      const r = simB(o)
      const m = measureBidi(r)
      for (let k = 0; k < r.length; k += 7) {
        const st = bidiStateAt(r, k)
        if (st.leg === 'upper') expect(st.q1On || st.d1On).toBe(true)
        if (st.leg === 'lower') expect(st.q2On || st.d2On).toBe(true)
        for (const c of bidiWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
    }
  })
  it('lessons: every step lands in its interval with values in the text; each check is confirmed by the simulation', () => {
    for (const kind of KINDS)
      for (const l of COUPLED_LESSONS[kind]) {
        expect(l.steps.length).toBeGreaterThanOrEqual(3)
        expect(l.steps.length).toBeLessThanOrEqual(6)
        for (const s of l.steps) {
          const r = simC(kind, { ...l.base, ...s.params })
          const st = coupledStateAt(r, converterIndexAt(r, coupledLessonTime(s.at, r.params)))
          if (s.at[0] === 'on') expect(st.interval).toBe('on')
          else expect(st.interval).not.toBe('on')
          noBadText(s.body(st, measureCoupled(r), r))
        }
        const r = simC(kind, l.base)
        expect([kind, l.id, l.confirm(measureCoupled(r), r)]).toEqual([kind, l.id, true])
        expect(l.check.answer).toBeGreaterThanOrEqual(0)
      }
    for (const l of BIDI_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      for (const s of l.steps) {
        const r = simB({ ...l.base, ...s.params })
        const st = bidiStateAt(r, converterIndexAt(r, bidiLessonTime(s.at, r.params)))
        if (s.at[0] === 'q1') expect(st.q1On).toBe(true)
        else expect(st.q2On).toBe(true)
        noBadText(s.body(st, measureBidi(r), r))
      }
      const r = simB({ ...l.base, ...l.confirmParams })
      expect([l.id, l.confirm(measureBidi(r), r)]).toEqual([l.id, true])
    }
  })
  it('the DCM lesson cursor lands in the idle interval', () => {
    for (const kind of KINDS) {
      const l = COUPLED_LESSONS[kind].find((x) => x.id === 'dcm')!
      const r = simC(kind, l.base)
      const st = coupledStateAt(r, converterIndexAt(r, coupledLessonTime(l.steps[0].at, r.params)))
      expect(st.interval).toBe('idle')
    }
  })
  it('experiments: from the defaults the simulation confirms the expected answer', () => {
    for (const kind of KINDS)
      for (const e of coupledExperiments(kind)) {
        const p0 = { ...COUPLED_DEFAULTS }
        const p1 = { ...p0, ...e.change(p0) }
        const before = measureCoupled(simC(kind, p0))
        const after = measureCoupled(simC(kind, p1))
        expect([kind, e.id, e.judge(before, after)]).toEqual([kind, e.id, 0])
        noBadText(e.why(before, after, p0, p1))
      }
    for (const e of bidiExperiments()) {
      const p0 = { ...BIDI_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const before = measureBidi(simB(p0))
      const after = measureBidi(simB(p1))
      expect([e.id, e.judge(before, after)]).toEqual([e.id, 0])
      noBadText(e.why(before, after, p0, p1))
      // the same experiment in boost mode
      const q0 = { ...BIDI_DEFAULTS, dir: 'boost' as const }
      const q1 = { ...q0, ...e.change(q0) }
      if (e.id !== 'duty') expect([e.id, 'boost', e.judge(measureBidi(simB(q0)), measureBidi(simB(q1)))]).toEqual([e.id, 'boost', 0])
    }
  })
  it('predictions are answered by the simulation, with a theory line', () => {
    for (const kind of KINDS)
      for (let seed = 1; seed <= 4; seed++) {
        const tasks = coupledPredictTasks(kind, seed)
        expect(tasks.length).toBeGreaterThanOrEqual(3)
        for (const t of tasks) {
          const p = { ...COUPLED_DEFAULTS, ...t.params }
          const r = simC(kind, p)
          const m = measureCoupled(r)
          expect(Number.isFinite(t.answer(m))).toBe(true)
          noBadText(t.theory(p))
          if (t.id === 'vout' || t.id === 'vc1') expect(m.mode).toBe('CCM')
          if (t.id === 'mode') expect(t.answer(m)).toBe(coupledBoundary(r.params).ccm ? 0 : 1)
        }
      }
    for (let seed = 1; seed <= 4; seed++)
      for (const t of bidiPredictTasks(seed)) {
        const p = { ...BIDI_DEFAULTS, ...t.params }
        const m = measureBidi(simB(p))
        expect(Number.isFinite(t.answer(m))).toBe(true)
        noBadText(t.theory(p))
      }
  })
  it('every topic: defaults simulate fast, compare rows all pass, readings, state view, lessons/experiments/predictions counts', () => {
    for (const [id, topic] of Object.entries(DCDC_ADVANCED_TOPICS)) {
      const t0 = cpuNow()
      const r = (topic as ReturnType<typeof bidiTopic>).simulate((topic as ReturnType<typeof bidiTopic>).defaults as never)
      const ms = cpuNow() - t0
      expect(ms, id).toBeLessThan(3000)
      const tp = topic as unknown as ReturnType<typeof coupledTopic>
      const m = tp.measure(r as never)
      expect(tp.analyze.compare(r as never, m).allPass, id).toBe(true)
      const rd = tp.readings!(m, r as never)
      expect(rd.length).toBeGreaterThanOrEqual(3)
      for (const x of rd) noBadText(`${x.value} ${x.unit} ${x.note}`)
      const v = tp.view(tp.state(r as never, 50), r as never, 'engineer')
      expect(v.rows.length).toBeGreaterThan(8)
      expect(tp.lessons.length).toBeGreaterThanOrEqual(2)
      expect(tp.experiments.length).toBeGreaterThanOrEqual(2)
      expect(tp.predictions(1).length).toBeGreaterThanOrEqual(3)
      for (const l of tp.lessons) for (const s of l.steps) for (const ch of s.channels) expect(tp.channels[ch], `${id} ${l.id} ${ch}`).toBeDefined()
      for (const e of tp.experiments) for (const row of e.rows) expect(tp.measureLabels[row], `${id} ${e.id} ${row}`).toBeDefined()
      for (const c of tp.analysis ?? []) for (const row of c.rows ?? []) expect(tp.measureLabels[row], `${id} ${c.id} ${row}`).toBeDefined()
      for (const ch of tp.defaultChannels) expect(tp.channels[ch]).toBeDefined()
      for (const k of [0, 30, 120, r.length - 1]) {
        const st = tp.state(r as never, k)
        noBadText(tp.status!(st, r as never).headline)
        noBadText(tp.path!(st, r as never).text)
      }
    }
  })
})
