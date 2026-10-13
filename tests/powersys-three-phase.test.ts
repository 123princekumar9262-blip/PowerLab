import { describe, expect, it } from 'vitest'
import { abs, add, arg, C, conj, deg, div, mul, polarDeg, scale, sub, sum, type Complex } from '../src/powersys/engine/complex.ts'
import {
  abcdDiff,
  abcdLong,
  abcdNominalPi,
  abcdSections,
  abcdShort,
  angDeg,
  balancedSet,
  betaL,
  cascade,
  ccosh,
  csinh,
  csqrt,
  det,
  disturbedSet,
  ferrantiLossless,
  inst,
  instantaneousPower,
  LINE_PRESETS,
  lineAbcd,
  lineParams,
  linePerformance,
  lossless,
  maxReceivingPower,
  powerAngle,
  powerSummary,
  receivingPower,
  receivingPowerCircle,
  setSum,
  sil,
  singlePhasePower,
  solveLoad,
  SQRT3,
  starToDelta,
  voltageProfile,
  wrapDeg,
} from '../src/powersys/modules/three-phase/calc.ts'
import { meta } from '../src/powersys/modules/three-phase/meta.ts'

const close = (a: Complex, b: Complex, tol = 1e-9) => {
  expect(abs(sub(a, b))).toBeLessThan(tol * Math.max(1, abs(b)))
}
const L400 = LINE_PRESETS.find((p) => p.id === '400')!

describe('complex helpers', () => {
  it('csqrt squares back; cosh² − sinh² = 1; principal root has Re ≥ 0', () => {
    for (const z of [C(3, 4), C(-0.4, 1e-3), C(-2, -5), C(0.1, -7)]) {
      const r = csqrt(z)
      close(mul(r, r), z, 1e-12)
      expect(r.re).toBeGreaterThanOrEqual(0)
      const ch = ccosh(z)
      const sh = csinh(z)
      close(sub(mul(ch, ch), mul(sh, sh)), C(1, 0), 1e-9)
    }
  })
  it('cosh and sinh agree with their exponential definitions', () => {
    const z = C(0.3, 1.1)
    const e = (w: Complex) => polarDeg(Math.exp(w.re), deg(w.im))
    close(ccosh(z), scale(add(e(z), e(scale(z, -1))), 0.5), 1e-12)
    close(csinh(z), scale(sub(e(z), e(scale(z, -1))), 0.5), 1e-12)
  })
})

describe('1 · a three-phase set', () => {
  it('a balanced set sums to zero, at every instant too', () => {
    const s = balancedSet(230, 17)
    expect(abs(setSum(s))).toBeLessThan(1e-12)
    for (let k = 0; k < 50; k++) {
      const wt = k * 0.137
      expect(Math.abs(inst(s.a, wt) + inst(s.b, wt) + inst(s.c, wt))).toBeLessThan(1e-9)
    }
    // sequence a-b-c: b lags a by 120°, c lags b by 120°
    expect(wrapDeg(angDeg(s.a) - angDeg(s.b))).toBeCloseTo(120, 9)
    expect(wrapDeg(angDeg(s.b) - angDeg(s.c))).toBeCloseTo(120, 9)
  })
  it('disturbing phase b leaves exactly the disturbance as the sum', () => {
    const s = disturbedSet(230, 0.8, 0)
    // sum = V_b' − V_b = −0.2·V_b
    expect(abs(setSum(s))).toBeCloseTo(0.2 * 230, 9)
    expect(wrapDeg(angDeg(setSum(s)) - (-120 + 180))).toBeCloseTo(0, 9)
    // an angle error θ alone: |sum| = |V|·2·sin(θ/2)
    const t = disturbedSet(230, 1, 20)
    expect(abs(setSum(t))).toBeCloseTo(230 * 2 * Math.sin((10 * Math.PI) / 180), 9)
  })
  it('instantaneous value is √2·|V|·sin(ωt + θ)', () => {
    expect(inst(polarDeg(230, 30), Math.PI / 3)).toBeCloseTo(230 * Math.SQRT2, 9)
  })
})

describe('2 · star and delta', () => {
  it('star: V_L = √3·V_ph leading by 30°; I_L = I_ph', () => {
    const l = solveLoad(400, 20, 36.87, 'star')
    for (const k of ['a', 'b', 'c'] as const) {
      close(l.vLine[k], mul(l.vPh[k], polarDeg(SQRT3, 30)), 1e-12)
      close(l.iLine[k], l.iZ[k], 1e-12)
    }
    expect(abs(l.vLine.a)).toBeCloseTo(400, 9)
    expect(abs(l.vPh.a)).toBeCloseTo(400 / SQRT3, 9)
  })
  it('delta: V_L = V_ph; I_L = √3·I_ph lagging by 30°', () => {
    const l = solveLoad(400, 30, -25, 'delta')
    for (const k of ['a', 'b', 'c'] as const) {
      close(l.vZ[k], l.vLine[k], 1e-12)
      close(l.iLine[k], mul(l.iZ[k], polarDeg(SQRT3, -30)), 1e-12)
    }
    // KCL: the three line currents of a 3-wire delta sum to zero
    expect(abs(sum([l.iLine.a, l.iLine.b, l.iLine.c]))).toBeLessThan(1e-12)
  })
  it('Z_Δ = 3·Z_Y draws the same line currents and the same power', () => {
    const zY = 12
    const y = solveLoad(400, zY, 30, 'star')
    const d = solveLoad(400, abs(starToDelta(C(zY, 0))), 30, 'delta')
    for (const k of ['a', 'b', 'c'] as const) close(y.iLine[k], d.iLine[k], 1e-12)
    close(y.sTotal, d.sTotal, 1e-12)
  })
  it('the same impedances in delta take three times the power of star', () => {
    const y = solveLoad(400, 20, 25, 'star')
    const d = solveLoad(400, 20, 25, 'delta')
    expect(d.sTotal.re / y.sTotal.re).toBeCloseTo(3, 12)
    expect(abs(d.iLine.a) / abs(y.iLine.a)).toBeCloseTo(3, 12)
  })
})

describe('3 · three-phase power', () => {
  it('P = √3·V_L·I_L·cos φ = 3·V_ph·I_ph·cos φ = Σ Re(V·I*), for star and delta', () => {
    for (const conn of ['star', 'delta'] as const) {
      const l = solveLoad(400, 15, 36.87, conn)
      const s = powerSummary(l)
      const perPhaseSum = [l.vZ.a, l.vZ.b, l.vZ.c].reduce((n, v, k) => n + mul(v, conj([l.iZ.a, l.iZ.b, l.iZ.c][k])).re, 0)
      expect(s.p).toBeCloseTo(perPhaseSum, 6)
      expect(s.pFromLine).toBeCloseTo(s.p, 6)
      expect(s.p).toBeCloseTo(3 * s.vPh * s.iPh * Math.cos((36.87 * Math.PI) / 180), 6)
      expect(s.pf).toBeCloseTo(Math.cos((36.87 * Math.PI) / 180), 9)
      expect(Math.hypot(s.p, s.q)).toBeCloseTo(s.s, 6)
    }
  })
  it('the total instantaneous power of a balanced set is constant and equals P', () => {
    const l = solveLoad(400, 15, 40, 'star')
    const P = powerSummary(l).p
    const pts = instantaneousPower(l, 360)
    for (const p of pts) expect(p.total).toBeCloseTo(P, 6)
    // while each phase pulsates between P/3 ± S/3
    const pa = pts.map((p) => p.pa)
    expect(Math.max(...pa) - Math.min(...pa)).toBeCloseTo((2 * powerSummary(l).s) / 3, 3)
  })
  it('single-phase power pulsates at twice the supply frequency around V·I·cos φ', () => {
    const n = 360
    const pts = singlePhasePower(230, 10, 30, n)
    const mean = pts.slice(0, n).reduce((a, p) => a + p.p, 0) / n
    expect(mean).toBeCloseTo(230 * 10 * Math.cos(Math.PI / 6), 6)
    // period T/2: p(ωt + π) = p(ωt)
    for (let k = 0; k < n / 2; k++) expect(pts[k + n / 2].p).toBeCloseTo(pts[k].p, 6)
    const ps = pts.map((p) => p.p)
    expect(Math.max(...ps) - Math.min(...ps)).toBeCloseTo(2 * 230 * 10, 3)
  })
})

describe('4 · transmission-line models', () => {
  const k = L400
  it('AD − BC = 1 and A = D for every model (a symmetrical, passive line)', () => {
    for (const len of [50, 300, 800]) {
      for (const model of ['short', 'medium', 'long'] as const) {
        const m = lineAbcd(k, len, model)
        close(det(m), C(1, 0), 1e-12)
        close(m.A, m.D, 1e-15)
      }
    }
  })
  it('γ and Z_c: γ = √(zy), Z_c = √(z/y), γ·Z_c = z and γ/Z_c = y', () => {
    const p = lineParams(k, 1)
    close(mul(p.gamma, p.zc), p.z, 1e-12)
    close(div(p.gamma, p.zc), p.y, 1e-12)
    expect(p.gamma.re).toBeGreaterThan(0)
    expect(p.zc.re).toBeGreaterThan(0)
  })
  it('the exact long line tends to the nominal π as the line gets short', () => {
    const errs = [400, 200, 100, 50, 25].map((len) => {
      const p = lineParams(k, len)
      return abcdDiff(abcdLong(p.gamma, p.zc, len), abcdNominalPi(p.Z, p.Y))
    })
    for (let i = 1; i < errs.length; i++) expect(errs[i]).toBeLessThan(errs[i - 1] / 3.5) // ~ l² convergence
    // leading-order difference: B_exact = Z·(1 + ZY/6 + …) ⇒ relative error → |ZY|/6
    const p25 = lineParams(k, 25)
    expect(errs[errs.length - 1] / (abs(mul(p25.Z, p25.Y)) / 6)).toBeCloseTo(1, 2)
  })
  it('N nominal-π sections in cascade converge to the exact distributed line (error ∝ 1/N²)', () => {
    const len = 600
    const exact = lineAbcd(k, len, 'long')
    const errs = [1, 4, 16, 64].map((n) => abcdDiff(abcdSections(k, len, n), exact))
    for (let i = 1; i < errs.length; i++) {
      const ratio = errs[i - 1] / errs[i]
      expect(ratio).toBeGreaterThan(12) // ×4 sections → ~16× smaller error
      expect(ratio).toBeLessThan(20)
    }
    expect(errs[3]).toBeLessThan(2e-5)
  })
  it('cascading two halves of the exact line gives the whole line', () => {
    const p = lineParams(k, 1)
    close(cascade(abcdLong(p.gamma, p.zc, 170), abcdLong(p.gamma, p.zc, 230)).B, abcdLong(p.gamma, p.zc, 400).B, 1e-12)
  })
  it('short line: sending end from V_s = V_r + Z·I, losses = 3·|I|²·R', () => {
    const p = lineParams(k, 60)
    const perf = linePerformance(abcdShort(p.Z), 400, { pMw: 300, pf: 0.9, lagging: true })
    close(perf.vs, add(perf.vr, mul(p.Z, perf.ir)), 1e-12)
    expect(perf.lossMw).toBeCloseTo(3 * abs(perf.ir) ** 2 * p.Z.re, 9)
    expect(perf.pr).toBeCloseTo(300, 9)
    // lagging load: positive regulation; a leading load can give negative regulation
    expect(perf.regulationPct).toBeGreaterThan(0)
    const lead = linePerformance(abcdShort(p.Z), 400, { pMw: 300, pf: 0.6, lagging: false })
    expect(lead.regulationPct).toBeLessThan(0)
  })
  it('power balance through the exact line, and the profile ends at V_s', () => {
    const len = 350
    const p = lineParams(k, len)
    const m = abcdLong(p.gamma, p.zc, len)
    const perf = linePerformance(m, 400, { pMw: 450, pf: 0.95, lagging: true })
    expect(perf.lossMw).toBeGreaterThan(0)
    expect(perf.efficiencyPct).toBeLessThan(100)
    const prof = voltageProfile(p, len, perf.vr, perf.ir)
    expect(prof[0].dKm).toBe(0)
    expect(prof[0].vLL).toBeCloseTo(perf.vsLL, 9)
    expect(prof[prof.length - 1].vLL).toBeCloseTo(400, 9)
  })
})

describe('4 · lossless-line identities', () => {
  const k = lossless(L400)
  it('A = cos βl, B = j·Z_c·sin βl — the Ferranti ratio is 1/cos βl', () => {
    for (const len of [100, 400, 900]) {
      const bl = betaL(k, len)
      const m = lineAbcd(k, len, 'long')
      close(m.A, C(Math.cos(bl), 0), 1e-12)
      const zc = Math.sqrt(k.xOhmPerKm / (k.bUsPerKm * 1e-6))
      close(m.B, C(0, zc * Math.sin(bl)), 1e-12)
      // no load: I_r = 0 ⇒ V_s = A·V_r ⇒ V_r/V_s = 1/cos βl
      const nl = linePerformance(m, 400, { pMw: 0, pf: 1, lagging: true })
      expect(400 / nl.vsLL).toBeCloseTo(ferrantiLossless(bl), 12)
    }
  })
  it('wavelength ≈ 6000 km at 50 Hz: the wave travels at about the speed of light', () => {
    const beta = betaL(k, 1) // rad/km
    const v = (2 * Math.PI * 50) / beta // km/s
    expect(v).toBeGreaterThan(2.6e5)
    expect(v).toBeLessThan(3.0e5)
  })
  it('at surge impedance loading the voltage profile is flat and Q_s = Q_r = 0', () => {
    const len = 500
    const p = lineParams(k, len)
    const m = abcdLong(p.gamma, p.zc, len)
    const P = sil(400, p.zcLossless)
    expect(P).toBeCloseTo((400 * 400) / Math.sqrt(0.33 / 3.5e-6), 9)
    const perf = linePerformance(m, 400, { pMw: P, pf: 1, lagging: true })
    for (const pt of voltageProfile(p, len, perf.vr, perf.ir)) expect(pt.vLL).toBeCloseTo(400, 8)
    expect(perf.qs).toBeCloseTo(0, 6)
    expect(perf.lossMw).toBeCloseTo(0, 9)
    // the load angle equals βl
    expect(perf.deltaDeg).toBeCloseTo(deg(betaL(k, len)), 9)
  })
  it('the power–angle curve: P = V_s·V_r·sin δ / (Z_c·sin βl), max at δ = 90°', () => {
    const len = 400
    const m = lineAbcd(k, len, 'long')
    const X = abs(m.B)
    for (const d of [10, 35, 60, 90, 120]) {
      expect(receivingPower(m, 400, 400, d).re).toBeCloseTo(powerAngle(400, 400, X, d), 6)
      expect(receivingPowerCircle(m, 400, 400, d)).toBeCloseTo(powerAngle(400, 400, X, d), 6)
    }
    const max = maxReceivingPower(m, 400, 400)
    expect(max.deltaDeg).toBeCloseTo(90, 9)
    expect(max.pMw).toBeCloseTo((400 * 400) / X, 6)
  })
})

describe('4 · power circle with losses', () => {
  it('the circle formula agrees with V_r·conj(I_r) for the lossy exact line', () => {
    const m = lineAbcd(L400, 300, 'long')
    for (const d of [5, 20, 45, 80]) {
      expect(receivingPowerCircle(m, 410, 395, d)).toBeCloseTo(receivingPower(m, 410, 395, d).re, 6)
    }
    const max = maxReceivingPower(m, 400, 400)
    expect(max.deltaDeg).toBeCloseTo(deg(arg(m.B)), 9)
    for (const d of [max.deltaDeg - 3, max.deltaDeg + 3]) expect(receivingPowerCircle(m, 400, 400, d)).toBeLessThan(max.pMw)
  })
})

describe('module metadata', () => {
  it('declares all five modes, unique activities in them and learning outcomes', () => {
    expect(meta.id).toBe('three-phase')
    expect(meta.modes).toEqual(['learn', 'explore', 'experiment', 'verify', 'practise'])
    expect(meta.learn.length).toBeGreaterThan(0)
    expect(new Set(meta.activities.map((a) => a.id)).size).toBe(meta.activities.length)
    for (const a of meta.activities) expect(meta.modes).toContain(a.mode)
  })
})
