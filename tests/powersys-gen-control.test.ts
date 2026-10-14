import { describe, expect, it } from 'vitest'
import { AVR0, charPoly, errSteady, loopGain, routh, simulateAvr, vtSteady, type AvrParams } from '../src/powersys/modules/gen-control/avr.ts'
import { EXPERIMENTS, LFC_T_END, runExperiment, type LfcCase } from '../src/powersys/modules/gen-control/experiments.ts'
import { AREA0, beta, LFC0, rocof0, simulateLfc, steadyState, steadyStateSolve, tieDynamics, type LfcParams } from '../src/powersys/modules/gen-control/lfc.ts'
import { simulateFrequency, type FreqParams } from '../src/powersys/modules/stability/frequency.ts'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)

describe('Two-area LFC — steady state without AGC', () => {
  const cases: Array<[string, LfcParams]> = [
    ['equal areas, load in area 1', LFC0],
    ['unequal areas (area 2 twice as large)', { ...LFC0, a2: { ...AREA0, H: 10, D: 2, R: 0.025 } }],
    ['different droops, loads in both areas', { ...LFC0, a1: { ...AREA0, R: 0.04 }, a2: { ...AREA0, R: 0.06, D: 1.5 }, dPL1: 0.08, dPL2: 0.03 }],
  ]
  for (const [name, p] of cases) {
    it(`${name}: Δf and ΔP_tie match the closed forms (rel 1e-4 after a long run)`, () => {
      const b1 = beta(p.a1)
      const b2 = beta(p.a2)
      // the closed forms written out here, independently of steadyState()
      const df = -(p.dPL1 + p.dPL2) / (b1 + b2)
      const tie = (b1 * p.dPL2 - b2 * p.dPL1) / (b1 + b2)
      const r = simulateLfc(p, { tEnd: 150 })
      expect(r.bounded).toBe(true)
      expect(r.settled).toBe(true)
      expect(rel(r.end.df1, df * p.f0)).toBeLessThan(1e-4)
      expect(rel(r.end.df2, df * p.f0)).toBeLessThan(1e-4)
      expect(rel(r.end.tie, tie)).toBeLessThan(1e-4)
      // generators: ΔP_mi = −Δf/R_i
      expect(rel(r.end.pm1, -df / p.a1.R)).toBeLessThan(1e-4)
      expect(rel(r.end.pm2, -df / p.a2.R)).toBeLessThan(1e-4)
      // the module's closed form and the independent 9×9 linear solve agree
      const s = steadyState(p)
      const q = steadyStateSolve(p)!
      expect(rel(s.df1, df)).toBeLessThan(1e-12)
      expect(rel(s.tie, tie)).toBeLessThan(1e-12)
      expect(rel(q.df1, df)).toBeLessThan(1e-10)
      expect(rel(q.tie, tie)).toBeLessThan(1e-10)
      expect(rel(q.pm1, s.pm1)).toBeLessThan(1e-10)
    })
  }
  it('a load rise in area 1 draws power FROM area 2 (ΔP_tie12 < 0) and lowers the frequency', () => {
    const r = simulateLfc(LFC0, { tEnd: 120 })
    expect(r.end.tie).toBeLessThan(0)
    expect(r.end.df1).toBeLessThan(0)
    expect(r.nadir1).toBeLessThan(r.nadir2) // area 1 dips deeper
    // equal areas: the tie carries half the load step, and each area's generation rises by half of it
    expect(r.end.tie).toBeCloseTo(-0.05, 6)
    expect(r.end.pm2).toBeCloseTo((-r.end.df2 / LFC0.f0 / AREA0.R) as number, 6)
  })
  it('a load rise in area 2 reverses the tie flow (ΔP_tie12 > 0)', () => {
    const r = simulateLfc({ ...LFC0, dPL1: 0, dPL2: 0.1 }, { tEnd: 120 })
    expect(r.end.tie).toBeGreaterThan(0)
    expect(r.end.tie).toBeCloseTo(0.05, 6)
  })
})

describe('Two-area LFC — with AGC', () => {
  it('AGC in both areas: Δf → 0, ΔP_tie → 0 and area 1’s generation rises by ΔP_L1', () => {
    const p = { ...LFC0, agc1: true, agc2: true }
    const r = simulateLfc(p, { tEnd: 300 })
    expect(r.bounded).toBe(true)
    expect(Math.abs(r.end.df1)).toBeLessThan(1e-6)
    expect(Math.abs(r.end.df2)).toBeLessThan(1e-6)
    expect(Math.abs(r.end.tie)).toBeLessThan(1e-6)
    expect(rel(r.end.pm1, p.dPL1)).toBeLessThan(1e-4)
    expect(Math.abs(r.end.pm2)).toBeLessThan(1e-6)
    const q = steadyStateSolve(p)!
    expect(Math.abs(q.df1) + Math.abs(q.tie) + Math.abs(q.pm2)).toBeLessThan(1e-12)
    expect(q.pm1).toBeCloseTo(p.dPL1, 12)
  })
  it('AGC in area 1 only (load in area 1) gives the same final state; in area 2 only it follows its closed form', () => {
    const r1 = simulateLfc({ ...LFC0, agc1: true }, { tEnd: 300 })
    expect(Math.abs(r1.end.df1)).toBeLessThan(1e-6)
    expect(Math.abs(r1.end.tie)).toBeLessThan(1e-6)
    const p2 = { ...LFC0, agc2: true }
    const r2 = simulateLfc(p2, { tEnd: 400 })
    const s2 = steadyState(p2)
    const q2 = steadyStateSolve(p2)!
    expect(rel(s2.df1, q2.df1)).toBeLessThan(1e-10)
    expect(rel(s2.tie, q2.tie)).toBeLessThan(1e-10)
    expect(rel(r2.end.df1, s2.df1 * p2.f0)).toBeLessThan(1e-3)
    expect(rel(r2.end.tie, s2.tie)).toBeLessThan(1e-3)
  })
  it('at the primary-control steady state, area 2’s ACE is zero (tie-line bias control)', () => {
    const s = steadyState(LFC0)
    const ace2 = -s.tie + beta(LFC0.a2) * s.df2
    const ace1 = s.tie + beta(LFC0.a1) * s.df1
    expect(Math.abs(ace2)).toBeLessThan(1e-14)
    expect(ace1).toBeCloseTo(-LFC0.dPL1, 12)
    const r = simulateLfc(LFC0, { tEnd: 150 })
    expect(Math.abs(r.end.ace2)).toBeLessThan(1e-6)
    expect(rel(r.end.ace1, -LFC0.dPL1)).toBeLessThan(1e-4)
  })
})

describe('Two-area LFC — independent check against Module 6 (T₁₂ = 0)', () => {
  const variants: Array<[string, Partial<FreqParams>]> = [
    ['default', {}],
    ['AGC on', { agc: true, Ki: 0.15 }],
    ['low inertia, soft droop', { H: 3, R: 0.08, D: 0.5, Tg: 0.3, Tt: 0.8, dPL: 0.05 }],
  ]
  for (const [name, v] of variants) {
    it(`each area equals the validated single-area simulation (${name})`, () => {
      const f: FreqParams = { f0: 50, H: 5, D: 1, R: 0.05, Tg: 0.2, Tt: 0.5, dPL: 0.1, agc: false, Ki: 0.1, ...v }
      const area = { H: f.H, D: f.D, R: f.R, Tg: f.Tg, Tt: f.Tt }
      // area 1 carries the load step; area 2 a different one, to show they do not interact
      const p: LfcParams = { ...LFC0, f0: f.f0, a1: area, a2: { ...area, H: f.H * 2 }, T12: 0, dPL1: f.dPL, dPL2: 0.5 * f.dPL, agc1: f.agc, agc2: f.agc, Ki: f.Ki, kB: 1 }
      const two = simulateLfc(p, { tEnd: 40 })
      const one1 = simulateFrequency(f, { tEnd: 40 })
      const one2 = simulateFrequency({ ...f, H: f.H * 2, dPL: 0.5 * f.dPL }, { tEnd: 40 })
      expect(two.t.length).toBe(one1.t.length)
      let err = 0
      for (let i = 0; i < two.t.length; i++) {
        err = Math.max(err, Math.abs(two.df1[i] - one1.df[i]), Math.abs(two.df2[i] - one2.df[i]), Math.abs(two.pm1[i] - one1.dPm[i]), Math.abs(two.pm2[i] - one2.dPm[i]))
      }
      expect(err).toBeLessThan(1e-9)
      expect(Math.max(...two.tie.map(Math.abs))).toBe(0)
    })
  }
})

describe('Two-area LFC — symmetry, signs, RoCoF and numerics', () => {
  it('identical areas, the same load step in each (mirror-symmetric about the tie): no tie flow at any time', () => {
    const s = simulateLfc({ ...LFC0, dPL1: 0.1, dPL2: 0.1 }, { tEnd: 30 })
    expect(Math.max(...s.tie.map(Math.abs))).toBeLessThan(1e-15)
    expect(s.df1.every((v, i) => v === s.df2[i])).toBe(true)
  })
  it('identical areas, opposite load steps (+ in 1, − in 2): mirror-image frequencies; the tie carries the whole step', () => {
    const r = simulateLfc({ ...LFC0, dPL1: 0.1, dPL2: -0.1 }, { tEnd: 120 })
    expect(r.df1.every((v, i) => Math.abs(v + r.df2[i]) < 1e-12)).toBe(true)
    expect(Math.abs(r.end.df1)).toBeLessThan(1e-6)
    expect(r.end.tie).toBeCloseTo(-0.1, 6)
  })
  it('a load rise gives a negative Δf and a positive ΔP_m; a load drop the opposite', () => {
    const up = simulateLfc(LFC0, { tEnd: 30 })
    const down = simulateLfc({ ...LFC0, dPL1: -0.1 }, { tEnd: 30 })
    expect(up.end.df1).toBeLessThan(0)
    expect(up.end.pm1).toBeGreaterThan(0)
    expect(down.end.df1).toBeGreaterThan(0)
    expect(down.end.pm1).toBeLessThan(0)
    // linear: the responses are exact negatives
    expect(up.df1.every((v, i) => Math.abs(v + down.df1[i]) < 1e-12)).toBe(true)
  })
  it('initial RoCoF = −ΔP·f₀/(2H) in the area with the load step, ≈ 0 in the other (before the tie line acts)', () => {
    for (const [H1, H2] of [
      [5, 5],
      [3, 8],
    ]) {
      const p = { ...LFC0, a1: { ...AREA0, H: H1 }, a2: { ...AREA0, H: H2 } }
      const r = simulateLfc(p, { tEnd: 1e-3, h: 1e-5 })
      expect(rel(r.rocof1, rocof0(p.dPL1, H1, p.f0))).toBeLessThan(1e-3)
      expect(Math.abs(r.rocof2)).toBeLessThan(1e-6)
      // a load step in area 2 instead
      const q = simulateLfc({ ...p, dPL1: 0, dPL2: 0.1 }, { tEnd: 1e-3, h: 1e-5 })
      expect(rel(q.rocof2, rocof0(0.1, H2, p.f0))).toBeLessThan(1e-3)
    }
  })
  it('RK4 step halving: the error falls ≈ 16× per halving (order ≈ 4)', () => {
    const p = { ...LFC0, agc1: true, agc2: true, T12: 0.2 }
    const at = (h: number) => {
      const r = simulateLfc(p, { tEnd: 4, h })
      return [r.end.df1, r.end.tie]
    }
    const a = at(0.04)
    const b = at(0.02)
    const c = at(0.01)
    for (const k of [0, 1]) {
      const ratio = (a[k] - b[k]) / (b[k] - c[k])
      const order = Math.log2(ratio)
      expect(order).toBeGreaterThan(3.6)
      expect(order).toBeLessThan(4.4)
    }
  })
  it('stiffer tie: T₁₂ = 0.01 rises monotonically (no first peak); T₁₂ = 0.08 peaks early and swings; same final value', () => {
    const p1 = { ...LFC0, T12: 0.01 }
    const p8 = { ...LFC0, T12: 0.08 }
    const r1 = simulateLfc(p1, { tEnd: 60, keepEvery: 5 })
    const r8 = simulateLfc(p8, { tEnd: 60, keepEvery: 5 })
    const final = (-beta(LFC0.a2) * LFC0.dPL1) / (beta(LFC0.a1) + beta(LFC0.a2))
    const d1 = tieDynamics(r1, steadyState(p1).tie)
    const d8 = tieDynamics(r8, steadyState(p8).tie)
    // monotonic: no first peak, no overshoot, no period (the old “time of the largest |ΔP_tie|” was just the run end)
    expect(d1.firstPeak).toBeNull()
    expect(d1.overshootPct).toBe(0)
    expect(Number.isNaN(d1.period)).toBe(true)
    // oscillatory: the first peak comes well before the end of the run, beyond the final value, with a period
    expect(d8.firstPeak).not.toBeNull()
    expect(d8.firstPeak!.t).toBeLessThan(5)
    expect(d8.overshootPct).toBeGreaterThan(10)
    expect(d8.period).toBeGreaterThan(1)
    expect(d8.t90).toBeLessThan(d1.t90)
    // both runs settle to the closed-form final value
    expect(r1.settled && r8.settled).toBe(true)
    expect(Math.abs(r1.end.tie - final)).toBeLessThan(1e-3)
    expect(Math.abs(r8.end.tie - final)).toBeLessThan(1e-3)
    expect(steadyState(p1).tie).toBeCloseTo(final, 12)
    // run-length independent: the same measures from a run twice as long
    const e8 = tieDynamics(simulateLfc(p8, { tEnd: 120, keepEvery: 5 }), steadyState(p8).tie)
    expect(e8.firstPeak!.t).toBe(d8.firstPeak!.t)
    expect(e8.period).toBe(d8.period)
    expect(e8.overshootPct).toBeCloseTo(d8.overshootPct, 10)
    expect(e8.tSettle).toBe(d8.tSettle)
    // a run that has not settled is not mistaken for one that has
    expect(simulateLfc(p8, { tEnd: 20 }).settled).toBe(false)
  })
  it('a very stiff tie with these governor lags gives a growing inter-area oscillation, detected from the simulation', () => {
    const ok = simulateLfc({ ...LFC0, T12: 0.03 }, { tEnd: 60 })
    expect(ok.trend).toBe('decaying')
    expect(ok.settled).toBe(true)
    const bad = simulateLfc({ ...LFC0, T12: 0.25 }, { tEnd: 60 })
    expect(bad.trend).toBe('growing')
    expect(bad.settled).toBe(false)
    expect([...bad.df1, ...bad.tie].every(Number.isFinite)).toBe(true)
  })
  it('never produces NaN; an unstable gain is reported as unbounded', () => {
    const r = simulateLfc({ ...LFC0, agc1: true, agc2: true, Ki: 5 }, { tEnd: 120 })
    expect([...r.df1, ...r.tie].every(Number.isFinite)).toBe(true)
    expect(r.bounded).toBe(false)
  })
})

describe('AVR loop', () => {
  it('the characteristic polynomial is the product of the four lags plus K (default: Routh limit ≈ 12.16)', () => {
    const [a0, a1, a2, a3, a4] = charPoly(AVR0)
    // expanded by hand: (1 + 0.1s)(1 + 0.4s) = 1 + 0.5s + 0.04s²;  (1 + s)(1 + 0.05s) = 1 + 1.05s + 0.05s²
    expect(a0).toBeCloseTo(1 + loopGain(AVR0), 12)
    expect(a1).toBeCloseTo(0.5 + 1.05, 12)
    expect(a2).toBeCloseTo(0.04 + 0.5 * 1.05 + 0.05, 12)
    expect(a3).toBeCloseTo(0.5 * 0.05 + 0.04 * 1.05, 12)
    expect(a4).toBeCloseTo(0.04 * 0.05, 12)
    const r = routh(AVR0)
    const b1 = (a3 * a2 - a4 * a1) / a3
    expect(r.kaMax).toBeCloseTo((b1 * a1) / a3 - 1, 10)
    expect(r.kaMax).toBeGreaterThan(12.1)
    expect(r.kaMax).toBeLessThan(12.2)
  })
  it('Routh limit: the polynomial has a pair of imaginary roots ±jω exactly at K_max', () => {
    for (const p of [AVR0, { ...AVR0, TA: 0.05, TE: 0.5, TG: 1.5, TR: 0.02, KE: 1.2, KG: 0.9 }]) {
      const r = routh(p)
      const K = r.kMax
      const kOther = p.KE * p.KG * p.KR
      const a = charPoly({ ...p, KA: K / kOther })
      const w = r.wOsc
      // P(jω) = a₀ − a₂ω² + a₄ω⁴ + j(a₁ω − a₃ω³) = 0
      const re = a[0] - a[2] * w * w + a[4] * w ** 4
      const im = a[1] * w - a[3] * w ** 3
      expect(Math.abs(re)).toBeLessThan(1e-9 * a[0])
      expect(Math.abs(im)).toBeLessThan(1e-9 * a[1] * w)
    }
  })
  it('simulation agrees with Routh: decays just below the limit, grows just above', () => {
    for (const base of [AVR0, { ...AVR0, TA: 0.05, TE: 0.5, TG: 1.5, TR: 0.02 }]) {
      const lim = routh(base).kaMax
      const below = simulateAvr({ ...base, KA: 0.95 * lim }, { tEnd: 60 })
      const above = simulateAvr({ ...base, KA: 1.05 * lim }, { tEnd: 60, bound: 1e6 })
      expect(routh({ ...base, KA: 0.95 * lim }).stable).toBe(true)
      expect(routh({ ...base, KA: 1.05 * lim }).stable).toBe(false)
      expect(routh({ ...base, KA: 1.05 * lim }).rhp).toBe(2)
      expect(below.trend).toBe('decaying')
      expect(above.trend).toBe('growing')
    }
  })
  it('steady-state error = 1/(1 + K_A·K_E·K_G·K_R) — closed form vs simulation', () => {
    for (const KA of [2, 5, 8]) {
      const p: AvrParams = { ...AVR0, KA }
      const r = simulateAvr(p, { tEnd: 40 })
      expect(r.trend).toBe('decaying')
      const e = p.dVref - p.KR * r.end
      expect(rel(e, 1 / (1 + KA))).toBeLessThan(1e-5)
      expect(rel(errSteady(p), 1 / (1 + KA))).toBeLessThan(1e-14)
      expect(rel(r.end, vtSteady(p))).toBeLessThan(1e-5)
      // units: per unit in, per unit out — a 0.05 pu step scales every value by 0.05
      const s = simulateAvr({ ...p, dVref: 0.05 }, { tEnd: 40 })
      expect(rel(s.end, 0.05 * r.end)).toBeLessThan(1e-9)
    }
  })
  it('raising K_A lowers the error but the overshoot grows', () => {
    const lo = simulateAvr({ ...AVR0, KA: 3 }, { tEnd: 30 })
    const hi = simulateAvr({ ...AVR0, KA: 9 }, { tEnd: 30 })
    expect(errSteady({ ...AVR0, KA: 9 })).toBeLessThan(errSteady({ ...AVR0, KA: 3 }))
    expect(hi.overshootPct).toBeGreaterThan(lo.overshootPct)
  })
  it('an unstable gain is stopped at the display bound (no NaN)', () => {
    const r = simulateAvr({ ...AVR0, KA: 25 }, { tEnd: 10 })
    expect(r.stopped).toBe(true)
    expect(r.vt.every(Number.isFinite)).toBe(true)
    expect(Math.max(...r.vt.map((v) => Math.abs(v - vtSteady({ ...AVR0, KA: 25 }))))).toBeLessThan(3.2)
  })
})

describe('Experiments', () => {
  it('every experiment’s answer is one of its options and is decided from the computed runs', () => {
    for (const e of EXPERIMENTS) {
      const res = runExperiment(e)
      const ans = e.answer(res)
      expect(e.options.map((o) => o.id)).toContain(ans)
      for (const line of e.explain(res)) expect(line).not.toMatch(/NaN|undefined|Infinity|not settled|has not settled/)
    }
  })
  it('every LFC experiment run settles within its length, and its final values are the closed forms', () => {
    for (const e of EXPERIMENTS.filter((x) => x.kind === 'lfc')) {
      for (const c of [e.before(), e.after()] as LfcCase[]) {
        expect(c.run.tEnd).toBe(LFC_T_END)
        expect(c.run.settled).toBe(true)
        expect(Math.abs(c.run.end.tie - c.ss.tie)).toBeLessThan(1e-3)
        expect(Math.abs(c.run.end.df1 - c.ss.df1 * c.p.f0)).toBeLessThan(1e-3)
      }
    }
  })
  it('stiffer-tie experiment: answer and explanation come from the first peak / rise time, not the run end', () => {
    const e = EXPERIMENTS.find((x) => x.id === 'stiff')!
    const res = runExperiment(e)
    expect(e.answer(res)).toBe('faster')
    const text = e.explain(res).join(' ')
    expect(text).toMatch(/rises monotonically/)
    expect(text).toMatch(/−0.0500 pu in both cases/)
    expect(text).not.toMatch(/20.00 s/)
  })
})
