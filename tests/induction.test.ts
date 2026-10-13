import { describe, expect, it } from 'vitest'
import { compareInduction, imNextConsequence, imReadings, imStateAt, imStatus, imView, imWhy, INDUCTION_EXPERIMENTS, INDUCTION_LESSONS, inductionPredictions, measureInduction, imEventLabel, imEventWhy } from '../src/converters/drives/inductionContent.ts'
import { INDUCTION_DEFAULTS, resolveInduction, simulateInduction, syncRpm, type InductionParams } from '../src/converters/drives/induction.ts'
import { breakdown, eqCircuit, inductionTheory, stablePoint, torqueAt } from '../src/converters/drives/inductionTheory.ts'
import { INDUCTION_TOPIC } from '../src/topics/induction.tsx'
import { cpuNow } from './helpers.ts'

const run = (o: Partial<InductionParams> = {}) => {
  const r = simulateInduction({ ...INDUCTION_DEFAULTS, ...o })
  return { r, m: measureInduction(r), th: inductionTheory(r.params) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)

/*
 * Tolerances. The run declares a plateau settled when its 20 ms means change by less than 2·10⁻⁶ of the
 * synchronous speed (speed) and 2·10⁻⁵ (torque, current) for three windows, then holds it a while longer; RK4 at
 * ≥ 200 steps per supply cycle is accurate to ~10⁻⁸. The steady state of the dynamic model at constant frequency
 * IS the equivalent circuit, so the settled points must agree with it to well under 10⁻³.
 */
describe('induction motor: settled simulation vs the steady-state equivalent circuit', () => {
  const cases: Array<[string, Partial<InductionParams>]> = [
    ['DOL, default load', {}],
    ['DOL, no load', { tl: 0 }],
    ['DOL, heavy load', { tl: 40 }],
    ['V/f at 50 Hz', { supply: 'vf' }],
    ['V/f at 25 Hz', { supply: 'vf', f: 25 }],
    ['V/f at 80 Hz (field weakening: V capped)', { supply: 'vf', f: 80, tl: 8 }],
    ['V/f at 5 Hz, no boost', { supply: 'vf', f: 5, boost: 0 }],
    ['2-pole, 60 Hz, 460 V machine', { pp: 1, fr: 60, vll: 460, tl: 8, j: 0.02 }],
    ['high rotor resistance, light inertia', { rr: 3, j: 0.01, tl: 10 }],
  ]
  it.each(cases)('%s', (_n, o) => {
    const { r, m, th } = run(o)
    expect(r.diagnostics.steady.converged).toBe(true)
    expect(th.end.locked).toBe(false)
    const tp = th.end.point
    expect(Math.abs(m.nEnd - tp.n) / tp.nsync).toBeLessThan(5e-5)
    expect(Math.abs(m.slip - tp.s) / Math.max(tp.s, 2e-3)).toBeLessThan(2e-3)
    expect(rel(m.isEnd, tp.i1)).toBeLessThan(5e-4)
    expect(Math.abs(m.te - tp.te)).toBeLessThan(5e-4 * Math.max(Math.abs(tp.te), 0.01 * th.end.bd.tMax))
    expect(rel(m.pin, tp.pin)).toBeLessThan(5e-4)
    expect(Math.abs(m.pf - tp.pf)).toBeLessThan(5e-4)
    expect(Math.abs(m.pcuR - tp.pcuR)).toBeLessThan(1e-3 * Math.max(tp.pcuR, 1e-3 * tp.pin))
    // the analyze panel agrees
    const c = compareInduction(r, m)
    expect(c.allPass).toBe(true)
    expect(c.rows.filter((x) => !x.expected).every((x) => x.pass)).toBe(true)
  })

  it('a load step and a frequency step: both plateaus agree with the circuit', () => {
    for (const o of [{ event: 'load' as const, tl2: 30 }, { supply: 'vf' as const, event: 'freq' as const, f2: 25 }, { supply: 'vf' as const, event: 'freq' as const, f: 30, f2: 60 }]) {
      const { r, m, th } = run(o)
      expect(r.pre).not.toBeNull()
      expect(r.tSettledA).not.toBeNull()
      expect(r.tSettled).not.toBeNull()
      expect(Math.abs(m.nPre! - th.start.point.n) / th.start.point.nsync).toBeLessThan(5e-5)
      expect(Math.abs(m.nEnd - th.end.point.n) / th.end.point.nsync).toBeLessThan(5e-5)
      expect(rel(m.isPre!, th.start.point.i1)).toBeLessThan(5e-4)
      expect(compareInduction(r, m).allPass).toBe(true)
    }
  })

  it('every settled point lies on the torque–speed curve of its frequency', () => {
    for (const tl of [0, 10, 25, 50]) {
      const { r, m } = run({ tl, event: 'none' })
      const p = r.params
      const curve = torqueAt(p, m.fEnd, m.vEnd, 1 - m.nEnd / syncRpm(m.fEnd, p.pp))
      expect(Math.abs(curve - m.te)).toBeLessThan(2e-3 * Math.max(m.te, 1))
      // torque balance: Te = TL + B·ω in steady state
      expect(Math.abs(m.te - tl - (p.b * m.nEnd * 2 * Math.PI) / 60)).toBeLessThan(1e-3 * Math.max(tl, 1))
    }
  })

  it('rotor copper loss = slip × air-gap power (simulation)', () => {
    for (const tl of [5, 15, 40]) {
      const { m } = run({ tl })
      expect(rel(m.pcuR, m.slip * m.pag)).toBeLessThan(2e-3)
    }
  })
})

describe('induction motor: breakdown torque, stall and limits', () => {
  it('the Thevenin breakdown formulas give the maximum of the circuit torque', () => {
    const p = resolveInduction(INDUCTION_DEFAULTS).params
    for (const f of [5, 25, 50, 80]) {
      const v = f >= p.fr ? p.vr : p.vb + ((p.vr - p.vb) * f) / p.fr
      const bd = breakdown(p, f, v)
      let best = 0
      let sBest = 0
      for (let q = 1; q <= 20000; q++) {
        const s = q / 20000
        const t = torqueAt(p, f, v, s)
        if (t > best) [best, sBest] = [t, s]
      }
      expect(rel(bd.tMax, best)).toBeLessThan(1e-6)
      expect(Math.abs(bd.sMax - sBest)).toBeLessThan(1e-4)
      // T = 3·p/ωs·I2²·Rr/s from the currents equals the Thevenin form
      const e = eqCircuit(p, f, v, 0.03)
      expect(rel(e.te, ((3 * p.pp) / (2 * Math.PI * f)) * ((e.i2 * e.i2 * p.rr) / 0.03))).toBeLessThan(1e-12)
    }
  })

  it('below the breakdown torque the motor carries the load, above it it stalls (simulation confirms the theory)', () => {
    const p = resolveInduction(INDUCTION_DEFAULTS).params
    const tMax = breakdown(p, p.fr, p.vr).tMax
    const below = run({ event: 'load', tl2: 0.92 * tMax })
    expect(below.m.locked).toBe(false)
    expect(below.m.slip).toBeLessThan(breakdown(p, p.fr, p.vr).sMax)
    expect(below.th.end.locked).toBe(false)
    expect(Math.abs(below.m.nEnd - below.th.end.point.n) / below.th.end.point.nsync).toBeLessThan(2e-4)
    const above = run({ event: 'load', tl2: 1.05 * tMax })
    expect(above.m.locked).toBe(true)
    expect(above.m.stalled).toBe(true)
    expect(above.th.end.locked).toBe(true)
    expect(above.r.events.some((e) => e.device === 'stall')).toBe(true)
    // the locked rotor draws the locked-rotor current of the circuit (s = 1)
    expect(rel(above.m.isEnd, above.th.lockedRotor.i1)).toBeLessThan(5e-4)
    expect(compareInduction(above.r, above.m).allPass).toBe(true)
  })

  it('a load above the starting torque: the rotor cannot run up; a load just below it: it can', () => {
    const p = resolveInduction(INDUCTION_DEFAULTS).params
    const tLR = torqueAt(p, p.fr, p.vr, 1)
    expect(run({ tl: 1.1 * tLR }).m.locked).toBe(true)
    expect(run({ tl: 0.8 * tLR }).m.locked).toBe(false)
  })

  it('no load and no friction: the rotor runs at synchronous speed', () => {
    const { m } = run({ tl: 0, b: 0 })
    expect(Math.abs(m.slip)).toBeLessThan(1e-5)
    expect(Math.abs(m.te)).toBeLessThan(1e-3)
    expect(stablePoint(resolveInduction({ ...INDUCTION_DEFAULTS, b: 0 }).params, 50, 400 / Math.sqrt(3), 0)!.s).toBe(0)
  })

  it('energy is conserved over every run: supply = copper + friction + load + kinetic + magnetic', () => {
    for (const o of [{}, { supply: 'vf' as const }, { event: 'load' as const, tl2: 100 }, { supply: 'vf' as const, event: 'freq' as const, f2: 20 }, { tl: 0 }]) {
      expect(Math.abs(run(o).m.balance)).toBeLessThan(1e-6)
    }
  })

  it('RK4 has converged: halving the step changes the operating point by < 1e-6', () => {
    const a = run({ stepsPerPeriod: 200 }).m
    const b = run({ stepsPerPeriod: 400 }).m
    expect(rel(a.nEnd, b.nEnd)).toBeLessThan(1e-6)
    expect(rel(a.isEnd, b.isEnd)).toBeLessThan(1e-5)
    expect(rel(a.iPeak, b.iPeak)).toBeLessThan(2e-3)
    // the shell's convergence check passes these extra keys: they are ignored
    const c = INDUCTION_TOPIC.simulate({ ...INDUCTION_DEFAULTS, stepsPerPeriod: 100, view: 'steady', periods: 1 } as never)
    expect(c.params.stepsPerPeriod).toBe(100)
    expect(c.params.duration).toBeGreaterThan(0.2)
  })
})

describe('induction motor: starting and speed control', () => {
  it('DOL draws a large inrush and pulsating torque; V/f starts with a fraction of it and ends at the same point', () => {
    const dol = run({ supply: 'dol' }).m
    const vf = run({ supply: 'vf' }).m
    expect(dol.iPeak).toBeGreaterThan(8 * Math.SQRT2 * dol.isEnd)
    expect(dol.teMin).toBeLessThan(0)
    expect(dol.teMax).toBeGreaterThan(1.3 * run().th.end.bd.tMax)
    expect(vf.iPeak).toBeLessThan(0.3 * dol.iPeak)
    expect(Math.abs(vf.nEnd - dol.nEnd)).toBeLessThan(1e-3)
    // a DOL start heats the rotor by more than the kinetic energy it gives; the ramp heats it far less
    expect(dol.ecuRStart).toBeGreaterThan(dol.ekinStart)
    expect(vf.ecuRStart).toBeLessThan(0.3 * dol.ecuRStart)
  })

  it('the peak inrush is of the order of the locked-rotor peak √2·I1(s = 1)', () => {
    const { m, th } = run()
    const lr = Math.SQRT2 * th.lockedRotor.i1
    expect(m.iPeak).toBeGreaterThan(0.9 * lr)
    expect(m.iPeak).toBeLessThan(2 * lr)
  })

  it('V/f keeps the flux about constant; without boost it sags at low frequency', () => {
    const f50 = run({ supply: 'vf', f: 50 }).m
    const f25 = run({ supply: 'vf', f: 25 }).m
    expect(rel(f25.psi, f50.psi)).toBeLessThan(0.05)
    const noBoost = run({ supply: 'vf', f: 5, boost: 0 }).m
    const boost = run({ supply: 'vf', f: 5, boost: 0.06 }).m
    expect(noBoost.psi).toBeLessThan(0.85 * f50.psi)
    expect(boost.psi).toBeGreaterThan(noBoost.psi)
    expect(boost.slip).toBeLessThan(noBoost.slip)
  })

  it('speed control by frequency: the slip speed stays about the same, the speed follows f', () => {
    const { m } = run({ supply: 'vf', event: 'freq', f: 50, f2: 25 })
    expect(Math.abs(m.slipRpm / m.slipRpmPre! - 1)).toBeLessThan(0.1)
    expect(m.nEnd / m.nPre!).toBeGreaterThan(0.45)
    expect(m.nEnd / m.nPre!).toBeLessThan(0.5)
    // ramping down faster than the load alone would slow the rotor, the machine generates for a while
    const r = run({ supply: 'vf', event: 'freq', f: 50, f2: 25, tramp: 0.4 }).r
    expect(r.events.some((e) => e.device === 'regen-start')).toBe(true)
    let pMin = 0
    for (const v of r.signals.pin) pMin = Math.min(pMin, v)
    expect(pMin).toBeLessThan(0)
    // a gentle ramp: the load slows the rotor faster than the field slows down — no regeneration
    expect(run({ supply: 'vf', event: 'freq', f: 50, f2: 25, tramp: 1 }).r.events.some((e) => e.device === 'regen-start')).toBe(false)
  })
})

describe('induction motor: words, lessons, experiments, predictions', () => {
  it('state, status, WHY, readings and next consequence read real numbers along the run', () => {
    for (const o of [{}, { supply: 'vf' as const, event: 'freq' as const }, { event: 'load' as const, tl2: 100 }, { tl: 70 }]) {
      const { r, m } = run(o)
      const rd = imReadings(m, r)
      expect(rd.length).toBeGreaterThanOrEqual(3)
      for (const x of rd) noBadText(`${x.value} ${x.unit} ${x.note}`)
      for (const k of [0, Math.floor(r.length / 7), Math.floor(r.length / 2), r.length - 2, r.length - 1]) {
        const st = imStateAt(r, k)
        const v = imView(st, r)
        noBadText(JSON.stringify(v))
        noBadText(JSON.stringify(imStatus(st)))
        for (const c of imWhy(r, st, m)) noBadText(Object.values(c).join(' '))
        const nx = imNextConsequence(r, st)
        if (nx) noBadText(nx.text)
      }
      for (const e of r.events) {
        noBadText(imEventLabel(e))
        noBadText(imEventWhy(e))
      }
      for (const row of compareInduction(r, m).rows) expect(Number.isFinite(row.sim) && Number.isFinite(row.exact)).toBe(true)
    }
  })

  it('every lesson: 3–6 steps, a check, cursors inside the run, texts from the simulation', () => {
    expect(INDUCTION_LESSONS.length).toBeGreaterThanOrEqual(2)
    for (const l of INDUCTION_LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.steps.length).toBeLessThanOrEqual(6)
      expect(l.check).toBeDefined()
      for (const s of l.steps) {
        const r = simulateInduction({ ...INDUCTION_DEFAULTS, ...l.base, ...s.params })
        const m = measureInduction(r)
        const t = s.at(r)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration + 1e-9)
        const w = s.window?.(r)
        if (w) expect(w[0] < w[1] && w[0] >= 0 && w[1] <= r.params.duration + 1e-9).toBe(true)
        const st = imStateAt(r, Math.round(t / r.params.dt))
        noBadText(s.body(st, m, r))
        for (const c of s.channels) expect(r.signals[c], c).toBeDefined()
      }
    }
  })

  it('the lesson checks are confirmed by the simulation', () => {
    const lesson = (id: string) => INDUCTION_LESSONS.find((l) => l.id === id)!
    // DOL: several times the running current
    const dol = run(lesson('dol').base).m
    expect(dol.iPeak / (Math.SQRT2 * dol.isEnd)).toBeGreaterThan(5)
    // V/f: the slip frequency stays small during the ramp (the rotor follows the field)
    const vfr = run(lesson('vf').base).r
    const kMid = Math.round((0.75 * (vfr.params.f / vfr.params.rate)) / vfr.params.dt)
    expect(vfr.signals.slip[kMid] * vfr.signals.f[kMid]).toBeLessThan(3)
    // slip: twice the load ≈ twice the slip, a small speed drop
    const sl = run(lesson('slip').base).m
    expect(sl.slip / sl.slipPre!).toBeGreaterThan(1.8)
    expect(sl.slip / sl.slipPre!).toBeLessThan(2.4)
    expect(sl.nEnd / sl.nPre!).toBeGreaterThan(0.95)
    // speed: the slip speed stays about the same
    const sp = run(lesson('speed').base).m
    expect(Math.abs(sp.slipRpm / sp.slipRpmPre! - 1)).toBeLessThan(0.1)
    // the slip lesson's stall step really stalls; its near-breakdown step still runs
    expect(run({ ...lesson('slip').base, ...lesson('slip').steps[3].params }).m.locked).toBe(true)
    expect(run({ ...lesson('slip').base, ...lesson('slip').steps[2].params }).m.locked).toBe(false)
  })

  it('experiments: the verdict from the two simulations is the expected answer', () => {
    const p0 = { ...INDUCTION_DEFAULTS }
    for (const e of INDUCTION_EXPERIMENTS) {
      const b = run(p0).m
      const a = run({ ...p0, ...e.change(p0) }).m
      expect(e.judge(b, a), e.id).toBe(0)
      noBadText(e.why(b, a, p0, { ...p0, ...e.change(p0) }))
      noBadText(e.question(p0))
    }
  })

  it('predictions: answers come from measure, the stated theory is close', () => {
    for (const seed of [1, 2, 3]) {
      for (const t of inductionPredictions(seed)) {
        const p = { ...INDUCTION_DEFAULTS, ...t.params }
        const m = run(p).m
        const ans = t.answer(m)
        expect(Number.isFinite(ans)).toBe(true)
        noBadText(t.prompt)
        noBadText(t.theory(p))
        if (t.id === 'nsync') expect(rel(ans, syncRpm(p.f, p.pp))).toBeLessThan(t.tolerance!)
        if (t.id === 'start') expect(ans).toBe(p.tl > torqueAt(resolveInduction(p).params, p.fr, resolveInduction(p).params.vr, 1) ? 1 : 0)
      }
    }
  })

  it('a default run is fast enough for interactive use', () => {
    const t0 = cpuNow()
    const r = simulateInduction({ ...INDUCTION_DEFAULTS, tl: 15.000001 }) // not cached
    const ms = cpuNow() - t0
    expect(r.length).toBeGreaterThan(100)
    expect(ms).toBeLessThan(3000)
    const t1 = cpuNow()
    simulateInduction({ ...INDUCTION_DEFAULTS, supply: 'vf', event: 'freq', tl: 15.000001 })
    expect(cpuNow() - t1).toBeLessThan(3000)
    console.info(`induction: DOL default ${ms.toFixed(0)} ms, V/f with a frequency step ${(cpuNow() - t1).toFixed(0)} ms`)
  })
})
