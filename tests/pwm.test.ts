import { describe, expect, it } from 'vitest'
import { comparePwm, measurePwm, pwmTheoryAmp } from '../src/converters/pwm/analysis.ts'
import { PWM_EXPERIMENTS, PWM_LESSONS, pwmPredictions, pwmStateAt, pwmWhy } from '../src/converters/pwm/content.ts'
import { carrierAt, comparedAt, PWM_DEFAULTS, simulatePwm, type PwmParams } from '../src/converters/pwm/modulator.ts'
import { besselJ, fourier } from '../src/converters/fourier.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { PWM_TOPIC } from '../src/topics/pwm.tsx'

const run = (o: Partial<PwmParams> = {}) => {
  const r = simulatePwm({ ...PWM_DEFAULTS, ...o })
  return { r, m: measurePwm(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('Fourier and Bessel helpers', () => {
  it('J_n matches reference values', () => {
    expect(besselJ(0, 1)).toBeCloseTo(0.7651976865579666, 14)
    expect(besselJ(1, 2.5)).toBeCloseTo(0.4970941024642741, 14)
    expect(besselJ(5, 3)).toBeCloseTo(0.04302843487704758, 14)
    expect(besselJ(-3, 2)).toBeCloseTo(-besselJ(3, 2), 15)
  })
  it('exact Fourier integrals: a square wave has 4V/(hπ) at odd h, a triangle 8V/(h²π²)', () => {
    const sq = fourier([{ ta: 0, tb: 0.5, va: 1, vb: 1 }, { ta: 0.5, tb: 1, va: -1, vb: -1 }], 1, 7)
    for (const h of [1, 3, 5, 7]) expect(sq[h].amp).toBeCloseTo(4 / (h * Math.PI), 12)
    for (const h of [2, 4, 6]) expect(sq[h].amp).toBeCloseTo(0, 12)
    const tri = fourier([{ ta: 0, tb: 0.5, va: -1, vb: 1 }, { ta: 0.5, tb: 1, va: 1, vb: -1 }], 1, 5)
    for (const h of [1, 3, 5]) expect(tri[h].amp).toBeCloseTo(8 / (h * h * Math.PI * Math.PI), 12)
  })
})

describe('PWM modulator: the simulation', () => {
  it('every edge is an exact comparator crossing (carrier = compared reference there)', () => {
    for (const o of [{}, { carrier: 'sawtooth' as const }, { sampling: 'regular-sym' as const }, { sampling: 'regular-asym' as const }, { reference: 'dc' as const, duty: 0.37 }]) {
      const { r } = run(o)
      const p = r.params
      for (const e of r.edges) {
        // the sawtooth reset edge at the period start is a carrier jump, not a crossing
        if (p.carrier === 'sawtooth' && Math.abs(e.t / p.tc - Math.round(e.t / p.tc)) < 1e-9) continue
        expect(Math.abs(carrierAt(p, e.t) - comparedAt(p, e.t + 1e-15))).toBeLessThan(1e-9)
      }
    }
  })
  it('DC reference: duty, average and RMS are exact for both carriers and every sampling', () => {
    for (const carrier of ['triangle', 'sawtooth'] as const)
      for (const sampling of ['natural', 'regular-sym'] as const)
        for (const duty of [0.1, 0.37, 0.5, 0.82]) {
          const { r, m } = run({ reference: 'dc', duty, carrier, sampling, output: 'unipolar' })
          expect(m.dutyMeasured).toBeCloseTo(duty, 9)
          expect(m.avg).toBeCloseTo(duty * r.params.vdc, 6)
          expect(m.rms).toBeCloseTo(r.params.vdc * Math.sqrt(duty), 6)
        }
  })
  it('the moving average over one carrier period equals D·Vdc for a DC reference', () => {
    const { r } = run({ reference: 'dc', duty: 0.3, output: 'unipolar' })
    for (let k = 0; k < r.length; k += 17) expect(r.signals.vavg[k]).toBeCloseTo(0.3 * r.params.vdc, 6)
  })
  it('counter resolution quantises the duty to 1/2^N', () => {
    const { m } = run({ reference: 'dc', duty: 0.3, sampling: 'regular-sym', bits: 3 })
    expect(m.dutyMeasured).toBeCloseTo(Math.round(0.3 * 8) / 8, 9)
  })
  it('dead time: the two gates are never ON together, each turn-on waits td', () => {
    const { r } = run({ td: 20e-6, stepsPerPeriod: 400 })
    const { gh, gl, gate } = r.signals
    for (let k = 0; k < r.length; k++) {
      expect(gh[k] && gl[k]).toBeFalsy()
      if (gh[k]) expect(gate[k]).toBe(1)
      if (gl[k]) expect(gate[k]).toBe(0)
    }
    let gap = 0
    for (let k = 0; k < r.length; k++) if (!gh[k] && !gl[k]) gap++
    expect(gap).toBeGreaterThan(0)
  })
  it('overmodulation drops pulses and the fundamental grows less than in proportion', () => {
    const lin = run({ m: 1 }).m
    const over = run({ m: 1.3 }).m
    expect(over.dropped).toBeGreaterThan(0)
    expect(over.v1).toBeGreaterThan(lin.v1)
    expect(over.v1 / lin.v1).toBeLessThan(1.3)
    expect(over.v1).toBeLessThan((4 / Math.PI) * 50 + 1e-9) // never more than a square wave
  })
})

describe('PWM: simulation vs independent theory (Fourier series, Bessel double-Fourier series)', () => {
  const cases: Array<Partial<PwmParams>> = []
  for (const sampling of ['natural', 'regular-sym', 'regular-asym'] as const)
    for (const m of [0.3, 0.8, 1]) for (const mf of [9, 15, 21]) cases.push({ sampling, m, mf })
  for (const duty of [0.2, 0.5, 0.71]) cases.push({ reference: 'dc', duty }, { reference: 'dc', duty, carrier: 'sawtooth', output: 'unipolar' })
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s: every harmonic matches its closed form', (_n, c) => {
    const { r, m } = run(c)
    for (const h of m.harmonics) {
      const th = pwmTheoryAmp(r.params, h.h)
      if (th === null) continue
      expect(Math.abs(h.amp - th)).toBeLessThan(1e-6 * r.params.vdc)
    }
    expect(comparePwm(r, m).allPass).toBe(true)
  })
  it('natural sampling: V1 = M·Vdc/2 exactly and no baseband harmonics; regular sampling adds them', () => {
    const nat = run({ m: 0.8 }).m
    expect(nat.v1).toBeCloseTo(40, 9)
    // only the far tails of the carrier sidebands reach the baseband (J_8(πM/2) ~ 10⁻⁶ at h = 7)
    for (const h of [2, 3, 4, 5, 6, 7]) expect(nat.at[h]).toBeLessThan(1e-5 * 100)
    const reg = run({ m: 0.8, sampling: 'regular-sym' }).m
    expect(reg.h3).toBeGreaterThan(1e-3)
  })
  it('a two-level output always has RMS Vdc/2 (bipolar), whatever M', () => {
    for (const m of [0.2, 0.8, 1.2]) expect(run({ m }).m.rms).toBeCloseTo(50, 9)
  })
})

describe('PWM: explanations and content', () => {
  it('WHY follows the comparator state and never contains NaN', () => {
    for (const o of [{}, { sampling: 'regular-sym' as const }, { td: 10e-6 }, { reference: 'dc' as const }]) {
      const { r, m } = run(o)
      for (let k = 0; k < r.length; k += 23) {
        const st = pwmStateAt(r, k)
        const cards = pwmWhy(r, st, m)
        expect(cards[0].question).toBe(`Why is the gate ${st.gate ? 'HIGH' : 'LOW'}?`)
        for (const c of cards) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
    }
  })
  it('lessons place the cursor and generate text from the simulation', () => {
    for (const l of PWM_LESSONS)
      for (const s of l.steps) {
        const r = simulatePwm({ ...PWM_DEFAULTS, ...l.base, ...s.params })
        const st = pwmStateAt(r, converterIndexAt(r, s.at(r)))
        noBadText(s.body(st, measurePwm(r), r))
      }
  })
  it('experiments: the simulation confirms the expected answer from the defaults', () => {
    for (const e of PWM_EXPERIMENTS) {
      const p0 = { ...PWM_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const before = measurePwm(simulatePwm(p0))
      const after = measurePwm(simulatePwm(p1))
      expect([e.id, e.judge(before, after)]).toEqual([e.id, 0])
      noBadText(e.why(before, after, p0, p1))
    }
  })
  it('predictions are answered by the simulation', () => {
    for (let seed = 1; seed <= 5; seed++)
      for (const t of pwmPredictions(seed)) {
        const p = { ...PWM_DEFAULTS, ...t.params }
        expect(Number.isFinite(t.answer(measurePwm(simulatePwm(p))))).toBe(true)
        noBadText(t.theory(p))
      }
  })
  it('the topic renders its state and compare rows', () => {
    const r = PWM_TOPIC.simulate(PWM_DEFAULTS)
    const m = PWM_TOPIC.measure(r)
    expect(PWM_TOPIC.view(PWM_TOPIC.state(r, 40), r, 'engineer').rows.length).toBeGreaterThan(8)
    expect(PWM_TOPIC.analyze.compare(r, m).allPass).toBe(true)
  })
})
