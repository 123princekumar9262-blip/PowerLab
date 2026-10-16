import { describe, expect, it } from 'vitest'
import {
  acFundamental,
  angleFor,
  bisectUpper,
  breakEven,
  capabilityBoundary,
  characteristics,
  commutationNumeric,
  dcWaveform,
  E_TH,
  goldenMax,
  insideCapability,
  inverterBridge,
  K_RC,
  K_VD0,
  LCC0,
  newtonBus,
  noseClosedForm,
  numericPmax,
  pAtV,
  pMaxMidShunt,
  pMaxSeries,
  pMidShunt,
  pSeries,
  pvCurve,
  qAtLimit,
  qcRequired,
  qMidShunt,
  rectifierBridge,
  solveBus,
  solveLcc,
  solveVsc,
  tanPhi,
  tcrAlphaFor,
  tcrB,
  tcrBNumeric,
  vClosedForm,
  VSC0,
  vscLimits,
  vscPoint,
  V_REF,
  WEAK0,
  xTh,
  type BridgeResult,
  type LccLink,
  type LccResult,
  type PvCurve,
  type WeakBus,
} from '../src/powersys/modules/hvdc-facts/calc.ts'
import { EXPERIMENTS } from '../src/powersys/modules/hvdc-facts/experiments.ts'
import { meta } from '../src/powersys/modules/hvdc-facts/meta.ts'
import { acDc, linkCheckNumeric } from '../src/powersys/modules/hvdc-facts/calc.ts'
import { inverterRole, modeSentence, pWords, qWords, whyFor } from '../src/powersys/modules/hvdc-facts/notes.ts'
import { compute, lccLinkOf, STATE0, type HfState } from '../src/powersys/modules/hvdc-facts/state.ts'

const D2R = Math.PI / 180
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b))
/** A small deterministic generator, so random sampling is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const okB = (b: ReturnType<typeof rectifierBridge>): BridgeResult => {
  if (!b.ok) throw new Error(b.issues.join(' '))
  return b
}
const okL = (r: ReturnType<typeof solveLcc>): LccResult => {
  if (!r.ok) throw new Error(r.issues.join(' '))
  return r
}
const okC = (c: ReturnType<typeof pvCurve>): PvCurve => {
  if (!c.ok) throw new Error(c.issues.join(' '))
  return c
}

// ── LCC converter ──────────────────────────────────────────────────────────────────────────────────────────

describe('LCC: the 6-pulse bridge', () => {
  it('V_d at α = 0 and X_c = 0 is (3√2/π)·V_LL = 1.3505·V_LL', () => {
    expect(K_VD0).toBeCloseTo(1.3505, 4)
    for (const v of [50, 213, 400]) expect(okB(rectifierBridge(v, 0, 0, 2)).vd).toBeCloseTo((3 * Math.SQRT2 * v) / Math.PI, 9)
  })

  it('V_d = V_d0·cos α without overlap, and falls by exactly (3/π)·X_c·I_d with current', () => {
    const r = rng(1)
    for (let k = 0; k < 200; k++) {
      const v = 100 + 300 * r()
      const a = 80 * r()
      const x = 30 * r()
      const i = 0.1 + 2.5 * r()
      const b = rectifierBridge(v, a, x, i)
      if (!b.ok) continue
      const b0 = okB(rectifierBridge(v, a, x, 0))
      expect(b0.vd).toBeCloseTo(K_VD0 * v * Math.cos(a * D2R), 9)
      expect(b0.vd - b.vd).toBeCloseTo((3 / Math.PI) * x * i, 9)
      expect(K_RC).toBeCloseTo(3 / Math.PI, 15)
    }
  })

  it('the overlap formula cos(α + μ) = cos α − √2·X_c·I_d/V_LL matches a numerical integration of the commutation (μ and V_d)', () => {
    const r = rng(2)
    let n = 0
    for (let k = 0; k < 300; k++) {
      const v = 100 + 300 * r()
      const a = 85 * r()
      const x = 40 * r()
      const i = 0.05 + 3 * r()
      const b = rectifierBridge(v, a, x, i)
      if (!b.ok) continue
      const num = commutationNumeric(v, a, x, i)
      if (!num.ok) throw new Error(num.issues.join(' '))
      expect(Math.abs(num.muDeg - b.muDeg)).toBeLessThan(1e-6)
      expect(Math.abs(num.vd - b.vd)).toBeLessThan(1e-6 * b.vd0)
      n++
    }
    expect(n).toBeGreaterThan(150)
  })

  it('the overlap term is dimensionless: scaling V_LL, X_c and I_d consistently (kV/Ω = kA) leaves μ unchanged', () => {
    const b1 = okB(rectifierBridge(213, 15, 12, 2))
    const b2 = okB(rectifierBridge(213e3, 15, 12, 2e3)) // volts and amperes
    expect(b2.muDeg).toBeCloseTo(b1.muDeg, 9)
    expect(b2.vd / 1000).toBeCloseTo(b1.vd, 9)
  })

  it('the waveform built valve by valve averages to V_d', () => {
    for (const [a, x, i] of [
      [0, 0, 1],
      [15, 12, 2],
      [40, 20, 1.5],
      [70, 8, 2.5],
    ]) {
      const b = okB(rectifierBridge(213, a, x, i))
      const w = dcWaveform(213, a, b.muDeg, 36001)
      expect(rel(w.mean, b.vd)).toBeLessThan(2e-4)
    }
  })

  it('more current → more overlap; more α → less overlap for the same current', () => {
    const m1 = okB(rectifierBridge(213, 15, 12, 1)).muDeg
    const m2 = okB(rectifierBridge(213, 15, 12, 2)).muDeg
    expect(m2).toBeGreaterThan(m1)
    expect(okB(rectifierBridge(213, 40, 12, 2)).muDeg).toBeLessThan(m2)
  })

  it('reactive power: cos φ ≈ ½[cos α + cos(α+μ)] = V_d/V_d0, Q = P·tan φ = S·sin φ with S = V_d0·I_d', () => {
    const r = rng(3)
    for (let k = 0; k < 200; k++) {
      const a = 5 + 80 * r()
      const b = rectifierBridge(213, a, 20 * r(), 0.1 + 2.5 * r())
      if (!b.ok || b.p < 1e-6) continue
      expect(b.cosPhi).toBeCloseTo((Math.cos(a * D2R) + Math.cos((a + b.muDeg) * D2R)) / 2, 12)
      expect(b.cosPhi).toBeCloseTo(b.vd / b.vd0, 12)
      expect(rel(b.q, b.p * Math.tan(b.phiDeg * D2R))).toBeLessThan(1e-9)
      expect(rel(b.q * b.q + b.p * b.p, b.s * b.s)).toBeLessThan(1e-9)
    }
  })

  it('α → 90° with no overlap: V_d → 0, P → 0 and Q → the full S = V_d0·I_d', () => {
    const b = okB(rectifierBridge(213, 90, 0, 2))
    expect(Math.abs(b.vd)).toBeLessThan(1e-9)
    expect(Math.abs(b.p)).toBeLessThan(1e-9)
    expect(rel(b.q, b.vd0 * 2)).toBeLessThan(1e-12)
    const near = okB(rectifierBridge(213, 89.9, 0, 2))
    expect(near.q / near.s).toBeGreaterThan(0.99999)
  })

  it('the exact AC fundamental (numerical Fourier of the line current) balances the DC power, and links the cos φ approximation exactly', () => {
    const r = rng(4)
    let worst = 0
    for (let k = 0; k < 80; k++) {
      const a = 5 + 75 * r()
      const x = 25 * r()
      const i = 0.2 + 2.5 * r()
      const b = rectifierBridge(213, a, x, i)
      if (!b.ok) continue
      const f = acFundamental(213, a, x, i)
      if (!f.ok) throw new Error(f.issues.join(' '))
      // lossless converter: the fundamental carries all the power
      expect(rel(f.pAc, b.p)).toBeLessThan(1e-7)
      // cos φ_approx = (I₁/I₁,ideal)·cos φ₁ exactly
      expect(Math.abs(b.cosPhi - (f.i1 / f.i1Ideal) * f.cosPhi1)).toBeLessThan(1e-8)
      if (b.muDeg <= 30) worst = Math.max(worst, Math.abs(f.cosPhi1 - b.cosPhi))
    }
    // the approximation itself: within 0.01 of the exact displacement factor while μ ≤ 30°
    expect(worst).toBeLessThan(0.01)
    // no overlap: I₁ = (√6/π)·I_d at φ₁ = α exactly
    const f0 = acFundamental(213, 25, 0, 2)
    if (!f0.ok) throw new Error()
    expect(f0.i1).toBeCloseTo((Math.sqrt(6) / Math.PI) * 2, 9)
    expect(f0.cosPhi1).toBeCloseTo(Math.cos(25 * D2R), 9)
  })

  it('inverter sign convention: V_di (positive back-EMF) equals minus the bridge voltage at α_i = 180° − β, by the numerical commutation', () => {
    const r = rng(5)
    for (let k = 0; k < 100; k++) {
      const g = 10 + 40 * r()
      const x = 20 * r()
      const i = 0.2 + 2.5 * r()
      const inv = inverterBridge(208, g, x, i)
      if (!inv.ok) continue
      expect(inv.betaDeg! - inv.muDeg).toBeCloseTo(g, 9)
      expect(inv.vd).toBeCloseTo((inv.vd0 / 2) * (Math.cos(g * D2R) + Math.cos(inv.betaDeg! * D2R)), 9)
      const num = commutationNumeric(208, 180 - inv.betaDeg!, x, i)
      if (!num.ok) throw new Error(num.issues.join(' '))
      expect(Math.abs(num.muDeg - inv.muDeg)).toBeLessThan(1e-6)
      expect(Math.abs(num.vd + inv.vd)).toBeLessThan(1e-6 * inv.vd0)
    }
  })

  it('invalid inputs give a clear message and no numbers', () => {
    for (const out of [
      rectifierBridge(213, 95, 12, 2),
      rectifierBridge(213, -5, 12, 2),
      rectifierBridge(213, 15, 12, -1),
      rectifierBridge(-1, 15, 12, 2),
      rectifierBridge(213, NaN, 12, 2),
      rectifierBridge(213, 15, 200, 5),
    ]) {
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.issues.length).toBeGreaterThan(0)
        expect(out.issues[0].length).toBeGreaterThan(10)
        expect(out).not.toHaveProperty('vd')
      }
    }
    expect(inverterBridge(208, 0, 12, 2).ok).toBe(false)
    expect(inverterBridge(208, 120, 12, 2).ok).toBe(false)
  })
})

// ── LCC link control ───────────────────────────────────────────────────────────────────────────────────────

describe('LCC: the DC link and CC/CEA control', () => {
  const link = (patch: Partial<LccLink>): LccLink => ({ ...LCC0, ...patch })

  it('normal operation: the operating point lies on the rectifier CC line and the inverter CEA line; P = power order', () => {
    for (const p of [300, 700, 1000, 1200]) {
      const L = link({ control: { kind: 'power', pMw: p } })
      const r = okL(solveLcc(L))
      const ch = characteristics(L)
      expect(r.mode).toBe('normal')
      expect(r.id).toBeCloseTo(r.iOrder!, 12)
      expect(r.vdr).toBeCloseTo(ch.cea(r.id), 9) // on the CEA characteristic
      expect(r.vdr).toBeCloseTo(ch.alphaLine(r.alphaDeg, r.id), 9) // and the rectifier's line at its α
      expect(r.alphaDeg).toBeGreaterThanOrEqual(L.alphaMinDeg)
      expect(r.gammaDeg).toBe(L.gammaDeg)
      expect(r.pr).toBeCloseTo(p, 8)
    }
  })

  it('the DC line obeys Ohm’s law and the power balance P_dr − P_di = I_d²·R_dc', () => {
    for (const c of [{ kind: 'power', pMw: 900 } as const, { kind: 'current', idKa: 1.5 } as const, { kind: 'alpha', alphaDeg: 16 } as const]) {
      const r = okL(solveLcc(link({ control: c })))
      expect(r.id).toBeCloseTo((r.vdr - r.vdi) / LCC0.rdc, 9)
      expect(r.pr - r.pi).toBeCloseTo(r.id * r.id * LCC0.rdc, 9)
      expect(r.loss).toBeCloseTo(r.id * r.id * LCC0.rdc, 9)
    }
  })

  it('12-pulse = two 6-pulse bridges in series: twice the voltage and Q of one bridge at the same α and I_d', () => {
    const r = okL(solveLcc(link({ control: { kind: 'current', idKa: 2 } })))
    const one = okB(rectifierBridge(LCC0.vllR, r.alphaDeg, LCC0.xc, 2))
    expect(r.vdr).toBeCloseTo(2 * one.vd, 9)
    expect(r.qr).toBeCloseTo(2 * one.q, 9)
    expect(r.vd0r).toBeCloseTo(2 * K_VD0 * LCC0.vllR, 9)
  })

  it('a low rectifier AC voltage shifts the mode: α = α_min and the inverter takes the current at I_order − ΔI with γ > γ₀', () => {
    const L = link({ vllR: 0.9 * LCC0.vllR, control: { kind: 'current', idKa: 2 } })
    const r = okL(solveLcc(L))
    const ch = characteristics(L)
    expect(r.mode).toBe('shift')
    expect(r.alphaDeg).toBe(L.alphaMinDeg)
    expect(r.id).toBeCloseTo(2 - L.marginKa, 12)
    expect(r.gammaDeg).toBeGreaterThan(L.gammaDeg)
    expect(r.vdr).toBeCloseTo(ch.cia(r.id), 9)
  })

  it('a firing angle set by hand: I_d = (V_d0r cos α − V_d0i cos γ)/(R_dc + R_cr − R_ci), and dI/dα matches a finite difference', () => {
    const r = okL(solveLcc(link({ control: { kind: 'alpha', alphaDeg: 15 } })))
    const ch = characteristics(LCC0)
    expect(r.id).toBeCloseTo((ch.vd0r * Math.cos(15 * D2R) - ch.vd0i * Math.cos(LCC0.gammaDeg * D2R)) / LCC0.rdc, 9)
    const r2 = okL(solveLcc(link({ control: { kind: 'alpha', alphaDeg: 15.001 } })))
    expect(rel((r.id - r2.id) / 0.001, r.dIdAlpha)).toBeLessThan(1e-3)
  })

  it('infeasible operating points give a message and no numbers', () => {
    for (const L of [
      link({ vllR: 0.1 * LCC0.vllR, control: { kind: 'current', idKa: 2 } }),
      link({ control: { kind: 'alpha', alphaDeg: 60 } }),
      link({ control: { kind: 'alpha', alphaDeg: 2 } }),
      link({ control: { kind: 'power', pMw: -5 } }),
      link({ rdc: 0 }),
    ]) {
      const r = solveLcc(L)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.issues[0].length).toBeGreaterThan(10)
        expect(r).not.toHaveProperty('id')
      }
    }
  })
})

// ── VSC ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('VSC-HVDC', () => {
  it('the solved converter voltage delivers exactly the ordered P and Q (P = V_s·V_c·sin δ/X), checked with complex phasors', () => {
    const r = rng(6)
    for (let k = 0; k < 200; k++) {
      const vs = 0.9 + 0.2 * r()
      const x = 0.05 + 0.25 * r()
      const p = -1 + 2 * r()
      const q = -1 + 2 * r()
      const pt = vscPoint(vs, x, p, q, 1, 1.2)
      expect(pt.pCheck).toBeCloseTo(p, 12)
      expect(pt.qCheck).toBeCloseTo(q, 12)
      // phasor check: I = (V_c∠δ − V_s)/(jX), S = V_s·I*
      const d = pt.deltaDeg * D2R
      const ire = (pt.vc * Math.sin(d)) / x
      const iim = -(pt.vc * Math.cos(d) - vs) / x
      expect(vs * ire).toBeCloseTo(p, 12)
      expect(-vs * iim).toBeCloseTo(q, 12)
      expect(Math.hypot(ire, iim)).toBeCloseTo(Math.hypot(p, q) / vs, 12)
    }
  })

  it('the capability boundary lies on the current circle or the voltage circle, and nothing outside is accepted', () => {
    const vs = 1
    const x = 0.15
    const lim = vscLimits(vs, x, 1, 1.15)
    for (const [p, q] of capabilityBoundary(vs, x, 1, 1.15, 73)) {
      const onI = Math.abs(Math.hypot(p, q) - lim.current.r) < 1e-9
      const onV = Math.abs(Math.hypot(p, q - lim.voltage.cq) - lim.voltage.r) < 1e-9
      expect(onI || onV).toBe(true)
      expect(insideCapability(vs, x, 1, 1.15, p * 0.999, q * 0.999)).toBe(true)
      expect(insideCapability(vs, x, 1, 1.15, p * 1.01, q * 1.01)).toBe(false)
    }
    const out = solveVsc({ ...VSC0, pOrder: 0.95, q1: 0.5 })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.issues.some((m) => /current/.test(m))).toBe(true)
      expect(out).not.toHaveProperty('idc')
    }
  })

  it('the DC link balances: P_dc1 − P_dc2 = I²R; P and Q are set independently at each end', () => {
    const a = solveVsc(VSC0)
    const b = solveVsc({ ...VSC0, q1: -0.3, q2: 0.4 })
    if (!a.ok || !b.ok) throw new Error()
    expect(a.pDc1Mw - a.pDc2Mw).toBeCloseTo(a.idc * a.idc * VSC0.rdc, 9)
    expect(a.vdc1 - VSC0.vdc).toBeCloseTo(a.idc * VSC0.rdc, 9)
    expect(b.p1).toBe(a.p1)
    expect(b.p2).toBeCloseTo(a.p2, 12)
    const rev = solveVsc({ ...VSC0, pOrder: -0.6 })
    if (!rev.ok) throw new Error()
    expect(rev.idc).toBeLessThan(0)
    expect(rev.pDc1Mw - rev.pDc2Mw).toBeCloseTo(rev.idc * rev.idc * VSC0.rdc, 9)
  })
})

// ── compensation ───────────────────────────────────────────────────────────────────────────────────────────

describe('series and shunt compensation', () => {
  it('series: P_max = V_s·V_r/(X(1 − k)) equals the numerical maximum of the power–angle curve; 50 % doubles it', () => {
    for (const k of [0, 0.25, 0.5, 0.7]) {
      const m = numericPmax((d) => pSeries(1, 1, 0.5, k, d))
      expect(rel(m.f, pMaxSeries(1, 1, 0.5, k))).toBeLessThan(1e-12)
      expect(m.x).toBeCloseTo(90, 3)
    }
    expect(pMaxSeries(1, 1, 0.5, 0.5) / pMaxSeries(1, 1, 0.5, 0)).toBeCloseTo(2, 12)
  })

  it('ideal midpoint shunt: P = (2V²/X)·sin(δ/2), maximum 2V²/X at 180° (twice the uncompensated), checked by phasors', () => {
    const m = numericPmax((d) => pMidShunt(1, 0.5, d))
    expect(rel(m.f, pMaxMidShunt(1, 0.5))).toBeLessThan(1e-12)
    expect(m.x).toBeCloseTo(180, 3)
    expect(pMaxMidShunt(1, 0.5) / pMaxSeries(1, 1, 0.5, 0)).toBeCloseTo(2, 12)
    // phasor check: V_s = V∠δ/2, V_m = V∠0, V_r = V∠−δ/2, each half jX/2
    for (const d of [20, 60, 120, 170]) {
      const v = 1.05
      const x = 0.4
      const h = (d / 2) * D2R
      // I₁ = (V_s − V_m)/(jX/2); P = Re(V_m·I₁*) and the compensator supplies Im(V_m·I₁*) for each half, negated
      const i1re = (v * Math.sin(h)) / (x / 2)
      const i1im = -(v * Math.cos(h) - v) / (x / 2)
      expect(v * i1re).toBeCloseTo(pMidShunt(v, x, d), 12)
      expect(-2 * (v * -i1im)).toBeCloseTo(qMidShunt(v, x, d), 12)
    }
  })

  it('angleFor returns the angle on each curve, or null beyond its maximum', () => {
    expect(angleFor(1, 2, false)).toBeCloseTo(30, 12)
    expect(angleFor(1, 2, true)).toBeCloseTo(60, 12)
    expect(angleFor(2.1, 2, false)).toBeNull()
  })

  it('TCR susceptance: B(90°) = full conduction, B(180°) = 0, monotone, and equal to the numerical Fourier fundamental', () => {
    expect(tcrB(90)).toBeCloseTo(1, 15)
    expect(tcrB(180)).toBeCloseTo(0, 15)
    expect(tcrB(89)).toBeNull()
    expect(tcrB(181)).toBeNull()
    let prev = 2
    for (let a = 90; a <= 180; a += 2.5) {
      const b = tcrB(a)!
      expect(b).toBeLessThan(prev + 1e-15)
      prev = b
      expect(Math.abs(tcrBNumeric(a)! - b)).toBeLessThan(1e-9)
      expect(tcrAlphaFor(b)).toBeCloseTo(a, 6)
    }
  })

  it('SVC output ∝ V² and STATCOM ∝ V at their limits; at 0.7 pu the STATCOM gives 0.7/0.49 of the SVC', () => {
    for (const v of [0.5, 0.7, 0.9, 1]) {
      expect(qAtLimit('svc', 0.5, v)).toBeCloseTo(0.5 * v * v, 15)
      expect(qAtLimit('statcom', 0.5, v)).toBeCloseTo(0.5 * v, 15)
    }
    expect(qAtLimit('statcom', 1, 0.7) / qAtLimit('svc', 1, 0.7)).toBeCloseTo(1 / 0.7, 12)
  })
})

// ── weak bus ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the weak bus: P–V curves, collapse, SVC and STATCOM', () => {
  const sample = (r: () => number): WeakBus => ({ scr: 1.5 + 6 * r(), pf: 0.85 + 0.15 * r(), rating: 0.1 + 0.8 * r(), p: 0 })

  it('no support: closed form (quadratic in V²) and Newton agree to 1e-9 on the upper branch', () => {
    const r = rng(7)
    for (let k = 0; k < 150; k++) {
      const w = sample(r)
      const c = okC(pvCurve(w, 'none'))
      const p = c.nose.p * (0.02 + 0.95 * r())
      const x = xTh(w.scr)
      const t = tanPhi(w.pf)
      const cf = vClosedForm(p, x, p * t)!
      const nw = newtonBus(
        p,
        x,
        t,
        () => 0,
        () => 0,
      )
      if (!nw.ok) throw new Error(nw.issues.join(' '))
      expect(Math.abs(nw.v - cf.upper)).toBeLessThan(1e-9)
      const sb = solveBus({ ...w, p }, 'none')
      if (!sb.ok) throw new Error(sb.issues.join(' '))
      expect(Math.abs(sb.v - sb.vCheck)).toBeLessThan(1e-9)
    }
  })

  it('the collapse point is the maximum of the P–V curve: the closed-form nose equals a golden-section and a dense-scan maximum', () => {
    const r = rng(8)
    for (let k = 0; k < 60; k++) {
      const w = sample(r)
      const x = xTh(w.scr)
      const t = tanPhi(w.pf)
      const cf = noseClosedForm(x, t, 0)!
      const c = okC(pvCurve(w, 'none'))
      expect(rel(c.nose.p, cf.p)).toBeLessThan(1e-9)
      expect(Math.abs(c.nose.v - cf.v)).toBeLessThan(1e-5)
      let scan = 0
      for (let v = 0.05; v <= 1; v += 1e-4) scan = Math.max(scan, pAtV(v, x, t, 0) ?? 0)
      expect(rel(scan, cf.p)).toBeLessThan(1e-6)
      // the scan of the closed-form V(P) must have no solution just beyond the nose
      expect(vClosedForm(cf.p * 1.001, x, cf.p * 1.001 * t)).toBeNull()
    }
  })

  it('SVC at its limit is a fixed susceptance: closed form vs Newton to 1e-9, and its nose matches the equivalent-Thevenin formula', () => {
    const r = rng(9)
    let n = 0
    for (let k = 0; k < 150; k++) {
      const w = sample(r)
      const c = okC(pvCurve(w, 'svc'))
      if (c.pSwitch === null || c.nose.p <= c.pSwitch * (1 + 1e-6)) continue
      const p = c.pSwitch + (c.nose.p - c.pSwitch) * (0.05 + 0.9 * r())
      const sb = solveBus({ ...w, p }, 'svc')
      if (!sb.ok) throw new Error(sb.issues.join(' '))
      expect(sb.state).toBe('at-limit')
      expect(Math.abs(sb.v - sb.vCheck)).toBeLessThan(1e-9)
      expect(sb.qc).toBeCloseTo(w.rating * sb.v * sb.v, 12)
      const nc = noseClosedForm(xTh(w.scr), tanPhi(w.pf), w.rating)!
      if (nc.v < V_REF) expect(rel(c.nose.p, nc.p)).toBeLessThan(1e-9)
      n++
    }
    expect(n).toBeGreaterThan(40)
  })

  it('STATCOM at its current limit: Newton vs bisection on the closed-form P(V) curve to 1e-9; Q_c = I_max·V', () => {
    const r = rng(10)
    let n = 0
    for (let k = 0; k < 150; k++) {
      const w = sample(r)
      const c = okC(pvCurve(w, 'statcom'))
      if (c.pSwitch === null || c.nose.p <= c.pSwitch * (1 + 1e-6)) continue
      const p = c.pSwitch + (c.nose.p - c.pSwitch) * (0.05 + 0.9 * r())
      const sb = solveBus({ ...w, p }, 'statcom')
      if (!sb.ok) throw new Error(sb.issues.join(' '))
      expect(Math.abs(sb.v - sb.vCheck)).toBeLessThan(1e-9)
      expect(sb.qc).toBeCloseTo(w.rating * sb.v, 12)
      const x = xTh(w.scr)
      const t = tanPhi(w.pf)
      const b2 = bisectUpper(p, x, t, (v) => w.rating * v, c.nose.v, V_REF)!
      expect(Math.abs(b2 - sb.v)).toBeLessThan(1e-9)
      n++
    }
    expect(n).toBeGreaterThan(40)
  })

  it('a regulating compensator holds V_ref and supplies exactly the Q needed; the curve is continuous where it reaches its limit', () => {
    const r = rng(11)
    for (let k = 0; k < 80; k++) {
      const w = sample(r)
      for (const s of ['svc', 'statcom'] as const) {
        const c = okC(pvCurve(w, s))
        const x = xTh(w.scr)
        const t = tanPhi(w.pf)
        const p = c.pSwitch! * r()
        const sb = solveBus({ ...w, p }, s)
        if (!sb.ok) throw new Error(sb.issues.join(' '))
        expect(sb.state).toBe('regulating')
        expect(Math.abs(sb.v - V_REF)).toBeLessThan(1e-9)
        expect(Math.abs(sb.vCheck - V_REF)).toBeLessThan(1e-9)
        expect(sb.qc).toBeCloseTo(qcRequired(p, x, t)!, 12)
        if (c.nose.p > c.pSwitch! * (1 + 1e-9)) expect(pAtV(V_REF, x, t, qAtLimit(s, w.rating, V_REF))!).toBeCloseTo(c.pSwitch!, 8)
      }
    }
  })

  it('collapse ordering: STATCOM ≥ SVC ≥ none, and a weaker system (lower SCR) collapses at a lower load', () => {
    const r = rng(12)
    for (let k = 0; k < 60; k++) {
      const w = sample(r)
      const n0 = okC(pvCurve(w, 'none')).nose.p
      const ns = okC(pvCurve(w, 'svc')).nose.p
      const nt = okC(pvCurve(w, 'statcom')).nose.p
      expect(ns).toBeGreaterThanOrEqual(n0 - 1e-12)
      expect(nt).toBeGreaterThanOrEqual(ns - 1e-9)
    }
    const strong = okC(pvCurve({ ...WEAK0, scr: 5 }, 'none')).nose.p
    const weak = okC(pvCurve({ ...WEAK0, scr: 2 }, 'none')).nose.p
    expect(weak).toBeLessThan(strong)
    // the nose of a bus with no support scales with SCR (X = 1/SCR)
    expect(strong / weak).toBeCloseTo(5 / 2, 9)
  })

  it('dense grid over every slider range: a regulating compensator always shows V = V_ref exactly; every solution agrees with its second method within the conditioning tolerance and satisfies the power flow', () => {
    const scrs = [1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.5, 3, 4, 5, 7, 10]
    let regulating = 0
    let solved = 0
    for (const scr of scrs)
      for (let pf = 0.8; pf <= 1.0001; pf += 0.02)
        for (let rating = 0.1; rating <= 1.0001; rating += 0.1)
          for (const s of ['none', 'svc', 'statcom'] as const) {
            if (s === 'none' && rating > 0.15) continue
            const c = okC(pvCurve({ scr, pf: Math.min(1, pf), rating, p: 0 }, s))
            for (let p = 0; p <= 1.8001; p += 0.02) {
              const w = { scr, pf: Math.min(1, pf), rating, p }
              const sb = solveBus(w, s)
              if (p > c.nose.p + 1e-12) {
                expect(sb.ok).toBe(false)
                continue
              }
              if (!sb.ok) throw new Error(`${JSON.stringify(w)} ${s}: ${sb.issues[0]}`)
              solved++
              if (sb.state === 'regulating') {
                regulating++
                expect(sb.v).toBe(V_REF)
                // the angle is the one the power equation needs at V_ref
                expect(Math.sin((sb.deltaDeg * Math.PI) / 180)).toBeCloseTo((p * xTh(scr)) / (E_TH * V_REF), 12)
              }
              expect(Math.abs(sb.v - sb.vCheck)).toBeLessThanOrEqual(sb.tolV)
              expect(sb.residual).toBeLessThan(1e-9)
              expect(sb.v).toBeGreaterThanOrEqual(c.nose.v - 1e-4)
            }
          }
    expect(regulating).toBeGreaterThan(10000)
    expect(solved).toBeGreaterThan(30000)
  })

  it('the reported repro: SCR 1.5, unity pf, rating 1.0, load 1.40 with a STATCOM or SVC is regulating at exactly 1.000 pu, δ = asin(P·X)', () => {
    for (const s of ['statcom', 'svc'] as const) {
      const sb = solveBus({ scr: 1.5, pf: 1, rating: 1, p: 1.4 }, s)
      if (!sb.ok) throw new Error(sb.issues[0])
      expect(sb.state).toBe('regulating')
      expect(sb.v).toBe(1)
      expect(sb.deltaDeg).toBeCloseTo((Math.asin(1.4 / 1.5) * 180) / Math.PI, 9)
      expect(Math.abs(sb.vCheck - 1)).toBeLessThan(1e-9)
    }
  })

  it('exactly at the nose the two methods agree within the conditioning tolerance (V is ill-conditioned there)', () => {
    for (const [w, s] of [
      [{ scr: 2, pf: 1, rating: 0.5, p: 0 }, 'none'],
      [{ scr: 3, pf: 0.8, rating: 0.5, p: 0 }, 'svc'],
      [{ scr: 3, pf: 0.95, rating: 0.5, p: 0 }, 'statcom'],
      [{ scr: 1.5, pf: 0.9, rating: 0.3, p: 0 }, 'none'],
    ] as const) {
      const c = okC(pvCurve(w, s))
      const sb = solveBus({ ...w, p: c.nose.p }, s)
      if (!sb.ok) throw new Error(sb.issues[0])
      expect(Math.abs(sb.v - sb.vCheck)).toBeLessThanOrEqual(sb.tolV)
      expect(sb.tolV).toBeLessThanOrEqual(1e-6)
      expect(sb.residual).toBeLessThan(1e-9)
    }
    // the reported case: unity pf, SCR 2 → nose at P = 1, V = 1/√2
    const sb = solveBus({ scr: 2, pf: 1, rating: 0.5, p: 1 }, 'none')
    if (!sb.ok) throw new Error(sb.issues[0])
    expect(Math.abs(sb.v - Math.SQRT1_2)).toBeLessThan(1e-6)
  })

  it('beyond the collapse point: a clear message and no numbers; invalid inputs too', () => {
    const c = okC(pvCurve(WEAK0, 'none'))
    const out = solveBus({ ...WEAK0, p: c.nose.p * 1.01 }, 'none')
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.issues[0]).toMatch(/collapse/)
      expect(out).not.toHaveProperty('v')
    }
    expect(solveBus({ ...WEAK0, p: c.nose.p * 0.999 }, 'none').ok).toBe(true)
    for (const w of [
      { ...WEAK0, scr: 0.5 },
      { ...WEAK0, pf: 0.5 },
      { ...WEAK0, rating: -1 },
      { ...WEAK0, p: NaN },
    ])
      expect(solveBus(w, 'svc').ok).toBe(false)
    expect(E_TH).toBe(1)
  })
})

// ── the rest ───────────────────────────────────────────────────────────────────────────────────────────────

describe('AC vs DC, experiments and meta', () => {
  it('the illustrative break-even distance is where the two cost lines meet', () => {
    const d = breakEven(4, 0.7)!
    expect(1 + d / 100).toBeCloseTo(4 + (0.7 * d) / 100, 12)
    expect(breakEven(0.5, 0.7)).toBeNull()
  })

  it('golden-section search finds a known maximum', () => {
    expect(goldenMax((x) => -((x - 0.3) ** 2), 0, 1).x).toBeCloseTo(0.3, 6)
  })

  it('every experiment decides its answer from the computation, among its options', () => {
    for (const e of EXPERIMENTS) {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      expect(r.rows.length).toBeGreaterThan(0)
      for (const row of r.rows) {
        expect(Number.isFinite(row.before)).toBe(true)
        expect(Number.isFinite(row.after)).toBe(true)
      }
      for (const t of r.explain) expect(t).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('the experiments’ answers match an independent calculation', () => {
    const by = (id: string) => EXPERIMENTS.find((e) => e.id === id)!.run().answer
    expect(by('alpha')).toBe('up')
    expect(by('current')).toBe('up')
    expect(by('series')).toBe('x2')
    expect(by('shunt')).toBe('x2')
    expect(by('svc-statcom')).toBe('statcom')
    expect(by('scr')).toBe('lower')
  })

  it('meta: ready, 5–6 activities, learning outcomes', () => {
    expect(meta.id).toBe('hvdc-facts')
    expect(meta.activities.length).toBeGreaterThanOrEqual(5)
    expect(meta.activities.length).toBeLessThanOrEqual(6)
    expect(meta.learn.length).toBeGreaterThanOrEqual(3)
    expect(new Set(meta.activities.map((a) => a.id)).size).toBe(meta.activities.length)
  })
})

// ── review fixes: mode-dependent wording, the independent link check, the exact long line ─────────────────────

describe('wording follows the actual control mode', () => {
  const st = (lcc: Partial<HfState['lcc']>): HfState => ({ ...STATE0, lcc: { ...STATE0.lcc, ...lcc } })
  const L = (s: HfState) => okL(compute(s).lcc)
  // a rectifier AC voltage that puts the link in the "both at their limits" mode
  let limitsAc = 0
  for (let a = 0.94; a <= 1.0; a += 0.0005) if (L(st({ acPu: a })).mode === 'limits') limitsAc = a
  const modes = {
    normal: st({}),
    manual: st({ ctrl: 'alpha', alphaDeg: 16 }),
    shift: st({ acPu: 0.95 }),
    limits: st({ acPu: limitsAc }),
  }

  it('each mode is reachable and described truthfully', () => {
    expect(limitsAc).toBeGreaterThan(0)
    for (const [m, s] of Object.entries(modes)) expect(L(s).mode).toBe(m)
    expect(modeSentence(L(modes.normal))).toMatch(/current controller holds I_d/)
    expect(modeSentence(L(modes.manual))).toMatch(/set by hand.*no controller holds the current/)
    expect(modeSentence(L(modes.shift))).toMatch(/inverter controls the current/)
    expect(modeSentence(L(modes.limits))).toMatch(/no controller holds the current/)
    expect(inverterRole(L(modes.normal))).toMatch(/holds its extinction angle/)
    expect(inverterRole(L(modes.manual))).toMatch(/holds its extinction angle/)
    expect(inverterRole(L(modes.shift))).toMatch(/controls the current/)
    expect(inverterRole(L(modes.limits))).toMatch(/neither controls the current/)
  })

  it('change notes: manual + AC voltage, limits + power order, shift + R_dc say only what is true', () => {
    const why = (a: HfState, b: HfState, key: string) => whyFor(key, a, b, compute(a), compute(b))
    const m2 = { ...modes.manual, lcc: { ...modes.manual.lcc, acPu: 1.05 } }
    const tm = why(modes.manual, m2, 'lcc-ac')
    expect(tm).not.toMatch(/α_min|inverter controls/)
    expect(tm).toMatch(/fixed by hand/)
    const l2 = { ...modes.limits, lcc: { ...modes.limits.lcc, pMw: 1010 } }
    expect(L(l2).mode).toBe('limits')
    const tl = why(modes.limits, l2, 'lcc-p')
    expect(tl).not.toMatch(/set by the inverter/)
    expect(tl).toMatch(/no controller holds the current/)
    const s2 = { ...modes.shift, lcc: { ...modes.shift.lcc, rdc: 12 } }
    const ts = why(modes.shift, s2, 'lcc-rdc')
    expect(ts).not.toMatch(/rectifier makes up/)
    expect(ts).toMatch(/V_di/)
    expect(L(s2).vdi).toBeLessThan(L(modes.shift).vdi) // the inverter, not the rectifier, absorbs the extra drop
  })

  it('VSC exchanges are worded with supplies/absorbs and takes/delivers, never a signed amount', () => {
    expect(qWords(-100, 'grid B')).toBe('absorbs 100 Mvar from grid B')
    expect(qWords(200, 'grid A')).toBe('supplies 200 Mvar to grid A')
    expect(pWords(-800, 'grid A')).toBe('takes 800 MW from grid A')
    expect(pWords(600, 'grid A')).toBe('delivers 600 MW to grid A')
    for (const t of [qWords(-100, 'x'), pWords(-800, 'x')]) expect(t).not.toMatch(/−|-\d/)
  })
})

describe('the independent link check (numerical commutation at both ends + Kirchhoff)', () => {
  it('confirms every solved operating point over random link settings, in every mode', () => {
    const r = rng(21)
    const seen = new Set<string>()
    for (let k = 0; k < 60; k++) {
      const u = {
        ...STATE0.lcc,
        ctrl: (r() < 0.25 ? 'alpha' : 'power') as 'alpha' | 'power',
        pMw: 200 + 1100 * r(),
        alphaDeg: 5 + 25 * r(),
        acPu: 0.85 + 0.25 * r(),
        gammaDeg: 12 + 18 * r(),
        marginKa: 0.05 + 0.35 * r(),
        xc: 24 * r(),
        rdc: 2 + 18 * r(),
      }
      const link = lccLinkOf(u)
      const res = solveLcc(link)
      if (!res.ok) continue
      seen.add(res.mode)
      expect(linkCheckNumeric(link, res).ok).toBe(true)
    }
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })

  it('can fail: a perturbed current or firing angle is caught', () => {
    const link = lccLinkOf(STATE0.lcc)
    const res = okL(solveLcc(link))
    expect(linkCheckNumeric(link, res).ok).toBe(true)
    expect(linkCheckNumeric(link, { ...res, id: res.id * 1.001 }).ok).toBe(false)
    expect(linkCheckNumeric(link, { ...res, alphaDeg: res.alphaDeg + 0.01 }).ok).toBe(false)
    expect(linkCheckNumeric(link, { ...res, gammaDeg: res.gammaDeg + 0.01 }).ok).toBe(false)
  })
})

describe('AC vs DC: the exact lossless long line', () => {
  const ac = { kv: 400, xOhmKm: 0.3282, bUsKm: 3.506 }
  const dc = { kvPole: 400, ka: 2, rOhmKmPole: 0.02 }
  it('|B| = Z_c·sin βℓ equals a chain of 2000 lumped π sections; short lines match the lumped x·ℓ', () => {
    for (const len of [100, 500, 1000, 1400]) {
      const n = 2000
      const dz = (ac.xOhmKm * len) / n // series reactance per section [Ω]
      const dy = (ac.bUsKm * 1e-6 * len) / n // shunt susceptance per section [S]
      // ABCD of one lossless π section (all real coefficients with j factors tracked): A = D = 1 − dz·dy/2, B = j·dz, C = j·dy(1 − dz·dy/4)
      let A = 1
      let Bi = 0 // B = j·Bi
      let Ci = 0 // C = j·Ci
      let D = 1
      const a = 1 - (dz * dy) / 2
      const b = dz
      const c = dy * (1 - (dz * dy) / 4)
      for (let k = 0; k < n; k++) {
        // [A jB; jC D] × [a jb; jc a]
        const A2 = A * a - Bi * c
        const B2 = A * b + Bi * a
        const C2 = Ci * a + D * c
        const D2 = -Ci * b + D * a
        A = A2
        Bi = B2
        Ci = C2
        D = D2
      }
      const x = acDc(len, ac, dc)
      expect(rel(Bi, x.zc * Math.sin(x.beta * len))).toBeLessThan(1e-5)
      expect(rel(x.pAcMax, (ac.kv * ac.kv) / Bi)).toBeLessThan(1e-5)
    }
    const s = acDc(50, ac, dc)
    expect(rel(s.pAcMax, s.pAcMaxLumped)).toBeLessThan(1e-3)
  })
  it('below a quarter wavelength the AC power falls with length; the quarter wavelength is π/(2β)', () => {
    const q = acDc(1, ac, dc).quarterKm
    expect(q).toBeCloseTo(Math.PI / (2 * Math.sqrt(ac.xOhmKm * ac.bUsKm * 1e-6)), 9)
    let prev = Infinity
    for (let l = 100; l < q; l += 50) {
      const p = acDc(l, ac, dc).pAc30
      expect(p).toBeLessThan(prev)
      prev = p
    }
  })
})
