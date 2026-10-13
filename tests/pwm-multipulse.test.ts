import { describe, expect, it } from 'vitest'
import { carrierMag, simulateMultiPulse, type MultiPulseParams } from '../src/converters/pwm/multipulse.ts'
import { bnClosed, bnSum, compareMulti, deltaTheory, measureMulti, vrmsTheory } from '../src/converters/pwm/multipulseAnalysis.ts'
import { multiNext, multiReadings, multiStateAt, multiStatus, multiView, multiWhy } from '../src/converters/pwm/multipulseContent.ts'
import { PWM_MULTI_TOPIC as T } from '../src/topics/pwmMultiPulse.tsx'
import { cpuNow } from './helpers.ts'

/*
 * UNIFORM MULTIPLE-PULSE PWM. SIMULATION: comparator edges found by bisection, the steered ±Vdc pulse train and
 * its exact Fourier integrals. THEORY: δ = M·π/p, θk = (2k − 1)π/(2p), the textbook sum
 * Bn = Σk (4Vdc/(nπ))·sin(nδ/2)·sin(nθk), Vrms = Vdc·√(p·δ/π). The edges are exact to the bisection's
 * precision, so every comparison is held to 10⁻⁶ of Vdc (measured agreement ~10⁻¹³).
 */
const run = (o: Partial<MultiPulseParams> = {}) => {
  const r = simulateMultiPulse({ ...T.defaults, ...o })
  return { r, m: measureMulti(r) }
}
const noBad = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('multiple-pulse PWM: the simulated modulator', () => {
  it('every comparator edge is an exact crossing of M and the carrier', () => {
    for (const o of [{}, { p: 1, m: 0.3 }, { p: 15, m: 0.9 }, { p: 7, m: 0.05 }]) {
      const { r } = run(o)
      expect(r.edges.length).toBe(2 * 2 * r.params.p)
      for (const e of r.edges) expect(Math.abs(carrierMag(r.params, e.t) - r.params.m)).toBeLessThan(1e-12)
    }
  })
  it('the output is +Vdc only in the positive half, −Vdc only in the negative half, and zero between pulses', () => {
    const { r } = run({ p: 4, m: 0.6 })
    const T0 = r.params.period
    for (const s of r.segs) {
      if (s.va > 0) expect(s.tb).toBeLessThanOrEqual(T0 / 2 + 1e-15)
      if (s.va < 0) expect(s.ta).toBeGreaterThanOrEqual(T0 / 2 - 1e-15)
      expect([0, r.params.vdc, -r.params.vdc]).toContain(s.va)
    }
    // leg commands are never both HIGH; vout follows them
    for (let k = 0; k < r.length; k++) {
      expect(r.signals.gA[k] && r.signals.gB[k]).toBeFalsy()
      expect(r.signals.vout[k]).toBe(r.params.vdc * (r.signals.gA[k] - r.signals.gB[k]))
    }
  })
  it('the local average over a carrier period is a square wave of height M·Vdc', () => {
    const { r } = run({ p: 5, m: 0.4 })
    const p = r.params
    for (let k = 0; k < r.length; k += 7) {
      const t = r.time[k]
      const u = t / p.period - Math.floor(t / p.period)
      // a carrier-period window lies inside one half cycle exactly at the carrier boundaries (u·2p integer)
      const x = u * 2 * p.p
      if (Math.abs(x - Math.round(x)) > 1e-9) continue
      const half = Math.round(x) >= 1 && Math.round(x) <= p.p ? 1 : -1
      expect(r.signals.vavg[k]).toBeCloseTo(half * p.m * p.vdc, 9)
    }
  })
})

describe('multiple-pulse PWM: simulation vs theory', () => {
  const cases: Array<Partial<MultiPulseParams>> = []
  for (const p of [1, 2, 3, 5, 8, 15]) for (const m of [0.05, 0.3, 0.5, 0.8, 0.99, 1]) cases.push({ p, m })
  cases.push({ p: 6, m: 0.7, vdc: 400, f1: 60 }, { p: 9, m: 0.45, vdc: 12, f1: 400 }, { p: 2, m: 0.5, vdc: 1000, f1: 1 })
  it.each(cases.map((o) => [JSON.stringify(o), o] as const))('%s: every compare row within 1e-6', (_n, o) => {
    const { r, m } = run(o)
    const c = compareMulti(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} theory ${row.exact} error ${row.error}`)
    expect(c.rows.length).toBeGreaterThanOrEqual(9)
  })
  it('the sine series: each simulated harmonic has the theory’s sign and no cosine part; even harmonics and the average vanish', () => {
    for (const o of [{ p: 3, m: 0.5 }, { p: 5, m: 0.8 }, { p: 1, m: 0.3 }]) {
      const { r, m } = run(o)
      const V = r.params.vdc
      expect(Math.abs(m.avg)).toBeLessThan(1e-12 * V)
      for (const h of m.harmonics.slice(1)) {
        expect(Math.abs(h.re)).toBeLessThan(1e-10 * V)
        expect(-h.im).toBeCloseTo(bnSum(r.params, h.h), 9)
        if (h.h % 2 === 0) expect(h.amp).toBeLessThan(1e-10 * V)
      }
    }
  })
  it('the textbook sum equals its closed form, and the closed forms have the right limits', () => {
    for (const p of [1, 2, 4, 7, 15]) for (const m of [0.1, 0.5, 0.9]) for (const n of [1, 3, 5, 7, 2 * p - 1, 2 * p + 1, 41]) {
      if (n % 2 === 0) continue
      expect(bnSum({ p, m, vdc: 100 }, n)).toBeCloseTo(bnClosed({ p, m, vdc: 100 }, n), 9)
    }
    // p = 1: the single-pulse spectrum (4Vdc/(nπ))·sin(nδ/2)·sin(nπ/2); M = 1: the square wave 4Vdc/(nπ)
    const one = run({ p: 1, m: 0.6 })
    for (const n of [1, 3, 5, 7]) expect(one.m.at[n]).toBeCloseTo(Math.abs(((4 * 100) / (n * Math.PI)) * Math.sin((n * 0.6 * Math.PI) / 2)), 9)
    for (const p of [1, 4, 9]) {
      const sq = run({ p, m: 1 })
      expect(sq.m.pulses).toBe(1)
      for (const n of [1, 3, 5]) expect(sq.m.at[n]).toBeCloseTo((4 * 100) / (n * Math.PI), 9)
      expect(sq.m.rms).toBeCloseTo(100, 9)
    }
  })
  it('Vrms = Vdc·√(p·δ/π) = Vdc·√M for every p: the RMS depends on M only', () => {
    for (const m of [0.2, 0.5, 0.9]) {
      const rms = [1, 3, 6, 12].map((p) => run({ p, m }).m.rms)
      for (const x of rms) expect(x).toBeCloseTo(100 * Math.sqrt(m), 9)
      expect(vrmsTheory({ p: 3, m, vdc: 100 })).toBeCloseTo(100 * Math.sqrt(m), 12)
      expect(deltaTheory({ p: 3, m })).toBeCloseTo((m * Math.PI) / 3, 15)
    }
  })
  it('the largest harmonic moves to 2p − 1 as p grows (moderate M); the 3rd stays near B1/3 (square-wave local average)', () => {
    for (const p of [2, 3, 4, 5, 6, 8, 10, 15]) expect(run({ p, m: 0.5 }).m.dominant).toBe(2 * p - 1)
    expect(run({ p: 1, m: 0.5 }).m.dominant).toBe(3)
    // B3/B1 → 1/3 for many pulses
    expect(Math.abs(run({ p: 15, m: 0.3 }).m.h3Ratio - 1 / 3)).toBeLessThan(0.02)
    // at the same low fundamental, more pulses lower the 3rd and the distortion factor (Rashid), but not the THD
    const single = run({ p: 1, m: 0.151 }).m
    const five = run({ p: 5, m: 0.232 }).m
    expect(Math.abs(single.v1 / five.v1 - 1)).toBeLessThan(0.01)
    expect(five.h3Ratio).toBeLessThan(0.5 * single.h3Ratio)
    expect(five.df).toBeLessThan(0.5 * single.df)
    expect(five.thd).toBeGreaterThan(single.thd)
  })
})

describe('multiple-pulse PWM: the topic', () => {
  it('a default run is fast enough for interactive use', () => {
    T.simulate(T.defaults)
    const t0 = cpuNow()
    const r = T.simulate({ ...T.defaults, p: 15 })
    const simMs = cpuNow() - t0
    T.measure(r)
    const ms = cpuNow() - t0
    expect(ms).toBeLessThan(3000)
    expect(simMs).toBeLessThan(300)
  })
  it('state, view, status, WHY, next and readings read the run without NaN at every sampled cursor', () => {
    for (const o of [{}, { p: 1 }, { p: 1, m: 1 }, { p: 12, m: 0.9 }]) {
      const { r, m } = run(o)
      const rd = multiReadings(m, r)
      expect(rd.length).toBeGreaterThanOrEqual(3)
      expect(rd.length).toBeLessThanOrEqual(4)
      for (const x of rd) noBad(`${x.label} ${x.value} ${x.unit} ${x.note}`)
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 80))) {
        const st = multiStateAt(r, k)
        expect(st.vout).toBe(r.signals.vout[k])
        expect(st.gate).toBe(r.signals.gate[k] > 0.5)
        if (st.gate) expect(st.pulse && st.pulse.start <= r.time[k] && st.pulse.end >= r.time[k] - r.params.dt).toBeTruthy()
        noBad(JSON.stringify(multiView(st, r)))
        noBad(JSON.stringify(multiStatus(st, r)))
        for (const c of multiWhy(r, st, m)) noBad(Object.values(c).join(' '))
        const n = multiNext(r, st)
        noBad(n.text)
        if (n.time !== null) expect(n.time).toBeGreaterThanOrEqual(r.time[k] - 1e-9 * r.params.dt)
        for (const part of T.parts ?? []) noBad(JSON.stringify(T.inspect!(part.id, st, m, r)))
      }
    }
  })
  it('lessons: steps render from the simulation; the checks agree with the simulation', () => {
    expect(T.lessons.length).toBeGreaterThanOrEqual(2)
    for (const l of T.lessons) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3)
      expect(l.steps.length).toBeLessThanOrEqual(6)
      for (const s of l.steps) {
        const r = T.simulate({ ...T.defaults, ...l.base, ...s.params })
        const m = T.measure(r)
        const t = s.at(r)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(r.params.duration)
        const st = T.state(r, Math.round(t / r.params.dt))
        noBad(s.body(st, m, r))
        for (const c of s.channels) expect(T.channels[c]).toBeDefined()
      }
    }
    // check 1: p = 4, M = 0.6 → δ = 27°
    const a = run({ p: 4, m: 0.6 }).m
    expect(a.deltaDeg).toBeCloseTo(27, 9)
    expect(T.lessons[0].check!.options[T.lessons[0].check!.answer]).toBe('27°')
    // check 2: p = 6 → the largest harmonics at 11 and 13
    const b = run({ p: 6, m: 0.5 }).m
    expect([11, 13]).toContain(b.dominant)
    expect(T.lessons[1].check!.options[T.lessons[1].check!.answer]).toBe('11 and 13')
  })
  it('experiments: each verdict comes from the before/after simulations and is the expected one', () => {
    const p0 = { ...T.defaults }
    for (const e of T.experiments) {
      const before = run(p0).m
      const after = run({ ...p0, ...e.change(p0) }).m
      expect(e.judge(before, after)).toBe(0)
      noBad(e.why(before, after, p0, { ...p0, ...e.change(p0) }))
      noBad(e.question(p0))
    }
  })
  it('predictions: the answer is read from the simulation and agrees with the stated theory', () => {
    for (const seed of [0, 1, 2, 3, 4, 7, 11]) {
      for (const task of T.predictions(seed)) {
        const p = { ...T.defaults, ...task.params }
        const { r, m } = run(p)
        const ans = task.answer(m)
        expect(Number.isFinite(ans)).toBe(true)
        noBad(task.theory(r.params))
        if (task.id === 'delta') expect(ans).toBeCloseTo((r.params.m * 180) / r.params.p, 9)
        if (task.id === 'rms') expect(ans).toBeCloseTo(r.params.vdc * Math.sqrt(r.params.m), 9)
        if (task.id === 'single') expect(ans).toBeCloseTo(((4 * r.params.vdc) / Math.PI) * Math.sin((r.params.m * Math.PI) / 2), 9)
        if (task.id === 'band') expect(ans).toBe(1)
      }
    }
  })
})
