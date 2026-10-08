import { describe, expect, it } from 'vitest'
import { autoGains, CONTROL_DEFAULTS, idealDuty, piStep, resolveControl, type ControlParams, type PlantKind } from '../src/converters/control/control.ts'
import { compareControl, controlExperiments, controlLessons, controlPredictions, controlStateAt, controlWhy, measureControl, simulateControl } from '../src/converters/control/content.ts'
import { averagedRun, loopGain, spectralRadius } from '../src/converters/control/theory.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { controlTopic } from '../src/topics/control.tsx'

const run = (kind: PlantKind, o: Partial<ControlParams> = {}) => {
  const r = simulateControl(kind, { ...CONTROL_DEFAULTS[kind], ...o })
  return { r, m: measureControl(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)
const KINDS: PlantKind[] = ['buck', 'boost']

describe('control: the controller and the closed loop', () => {
  it('the PID law: P, I, D terms, clamping and anti-windup', () => {
    const p = resolveControl({ ...CONTROL_DEFAULTS.buck, tuning: 'manual', kp: 0.01, ki: 100, kd: 1e-6, refStep: 'off' }, CONTROL_DEFAULTS.buck).params
    const s = { integ: 0.5, prev: null as number | null }
    const o1 = piStep(p, s, 11, 0)
    expect(o1.e).toBeCloseTo(1, 12)
    expect(o1.pTerm).toBeCloseTo(0.01, 12)
    expect(o1.dTerm).toBe(0)
    expect(o1.d).toBeCloseTo(0.51, 12)
    expect(s.integ).toBeCloseTo(0.5 + 100 * p.ts * 1, 12)
    const o2 = piStep(p, s, 11.5, p.ts)
    expect(o2.dTerm).toBeCloseTo((1e-6 * (0.5 - 1)) / p.ts, 12)
    // saturation: a huge error clamps the duty and stops the integrator winding up
    const big = { integ: 0.89, prev: null as number | null }
    const o3 = piStep(p, big, -100, 0)
    expect(o3.d).toBe(p.dmax)
    expect(big.integ).toBe(0.89)
  })
  it('the controller sets every period\'s duty: Q1 is ON for exactly d·Ts at the start of each period', () => {
    const { r } = run('buck')
    const p = r.params
    const ons = r.events.filter((e) => e.kind === 'gate-on' && e.device === 'Q1').map((e) => e.time)
    const offs = r.events.filter((e) => e.kind === 'gate-off' && e.device === 'Q1').map((e) => e.time)
    for (let m = 1; m < 40; m++) {
      const off = offs.find((t) => t > m * p.ts - 1e-12)!
      expect(off - m * p.ts).toBeCloseTo(r.trace.d[m] * p.ts, 12)
      expect(ons.some((t) => Math.abs(t - m * p.ts) < 1e-12)).toBe(true)
    }
    expect(r.diagnostics.fallbacks).toBe(0)
  })
  it('auto tuning places the crossover at the target with a large phase margin (buck)', () => {
    for (const [fc, pmMin] of [
      [300, 75],
      [1000, 60],
      [2000, 45],
    ]) {
      const p = resolveControl({ ...CONTROL_DEFAULTS.buck, fcTarget: fc }, CONTROL_DEFAULTS.buck).params
      const lg = loopGain(p)
      expect(Math.abs(lg.fc! / fc - 1)).toBeLessThan(0.05)
      // the sampling delay costs ≈ ωc·Ts/2 of phase: more at a higher crossover
      expect(lg.pm!).toBeGreaterThan(pmMin)
      expect(spectralRadius(p)).toBeLessThan(1)
    }
    const g = autoGains('buck', 24, 12, 100e-6, 100e-6, 6, 1000)
    expect(g.ki).toBeCloseTo((2 * Math.PI * 1000) / 24, 9)
    expect(g.kd).toBeCloseTo(g.ki / (g.w0 * g.w0), 15)
  })
})

describe('control: switching simulation vs the averaged model with the same controller', () => {
  const cases: Array<[PlantKind, Partial<ControlParams>]> = [
    ['buck', {}],
    ['buck', { fcTarget: 500 }],
    ['buck', { fcTarget: 2000 }],
    ['buck', { tuning: 'manual', ki: 0 }],
    ['buck', { loop: 'open' }],
    ['buck', { r2: 12 }],
    ['buck', { dvref: -4 }],
    ['boost', {}],
    ['boost', { fcTarget: 60 }],
  ]
  it.each(cases.map(([k, o]) => [`${k} ${JSON.stringify(o)}`, k, o] as const))('%s', (_n, kind, o) => {
    const { r, m } = run(kind, o)
    const c = compareControl(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
    expect(c.rows.length).toBeGreaterThan(4)
  })
  it('integral action removes the steady-state error; P-only and open loop leave one', () => {
    expect(Math.abs(run('buck').m.ssError)).toBeLessThan(0.005 * 15)
    expect(Math.abs(run('boost').m.ssError)).toBeLessThan(0.005 * 28)
    expect(Math.abs(run('buck', { tuning: 'manual', ki: 0 }).m.ssError)).toBeGreaterThan(0.5)
    expect(Math.abs(run('buck', { loop: 'open' }).m.ssError)).toBeGreaterThan(0.05)
  })
  it('a faster loop gives a smaller, shorter load-step dip; too fast is unstable (|λ|max ≥ 1, no settling)', () => {
    const slow = run('buck', { fcTarget: 500 }).m
    const fast = run('buck', { fcTarget: 2000 }).m
    expect(Math.abs(fast.loadDev!)).toBeLessThan(Math.abs(slow.loadDev!))
    const { r, m } = run('buck', { fcTarget: CONTROL_DEFAULTS.buck.fs / 3 })
    expect(r.rho).toBeGreaterThanOrEqual(1)
    expect(m.stable).toBe(false)
  })
  it('integral action finds the loss-compensating duty: D = (Vo/Vin)·(1 + DCR/R) for the buck, in model and circuit alike', () => {
    const p = resolveControl(CONTROL_DEFAULTS.buck, CONTROL_DEFAULTS.buck).params
    const mod = averagedRun(p)
    const dLoss = idealDuty('buck', 24, 15) * (1 + p.rl / p.r2)
    expect(mod.d[mod.d.length - 1]).toBeCloseTo(dLoss, 3)
    expect(run('buck').m.dFinal).toBeCloseTo(dLoss, 2)
  })
})

describe('control: explanations and content', () => {
  it.each(KINDS)('%s: WHY cards never contain NaN and follow the loop state', (kind) => {
    const { r, m } = run(kind)
    for (let k = 0; k < r.length; k += Math.floor(r.length / 40)) {
      const st = controlStateAt(r, k)
      const cards = controlWhy(r, st, m)
      expect(cards[0].question).toMatch(/Why is the duty/)
      for (const c of cards) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
    }
  })
  it.each(KINDS)('%s: lessons, experiments and predictions run on the simulation', (kind) => {
    const topic = controlTopic(kind)
    for (const l of controlLessons(kind))
      for (const s of l.steps) {
        const r = simulateControl(kind, { ...CONTROL_DEFAULTS[kind], ...l.base, ...s.params })
        noBadText(s.body(controlStateAt(r, converterIndexAt(r, s.at(r))), measureControl(r), r))
      }
    for (const e of controlExperiments(kind)) {
      const p0 = { ...CONTROL_DEFAULTS[kind] }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureControl(topic.simulate(p0))
      const a = measureControl(topic.simulate(p1))
      expect([kind, e.id, e.judge(b, a)]).toEqual([kind, e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
    for (const t of controlPredictions(kind, 1)) {
      const p = { ...CONTROL_DEFAULTS[kind], ...t.params }
      expect(Number.isFinite(t.answer(measureControl(topic.simulate(p))))).toBe(true)
      noBadText(t.theory(p))
    }
  })
})
