import { describe, expect, it } from 'vitest'
import {
  airDensity,
  arcLength,
  bundleGradient,
  catenary,
  computeCorona,
  computeSpan,
  computeString,
  coronaVerdict,
  criticalDisruptive,
  G,
  G0_RMS,
  gradedCaps,
  guardRingCaps,
  iceWeight,
  ladderVoltages,
  loads,
  nodalString,
  parabola,
  RHO_ICE,
  solveLinear,
  solveT0ForSupportTension,
  spanPoints,
  surfaceGradient,
  visualCritical,
  windForce,
  type SpanInput,
  type SpanResult,
  type StringResult,
} from '../src/powersys/modules/mechanical/calc.ts'
import { allChecks, CORONA_HAND_TOL, coronaCheck, lengthTensionCheck, loadsCheck, parabolaCheck, RANGES, stringCheck, unequalCheck } from '../src/powersys/modules/mechanical/checks.ts'
import { EXPERIMENTS } from '../src/powersys/modules/mechanical/experiments.ts'
import { meta } from '../src/powersys/modules/mechanical/meta.ts'
import { coronaOf, DESIGN0, spanOf, stringOf, toSpanInput, type Design } from '../src/powersys/modules/mechanical/model.ts'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
const BASE: SpanInput = toSpanInput(DESIGN0.span)
function span(s: Partial<SpanInput>): SpanResult {
  const r = computeSpan({ ...BASE, ...s })
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join(' '))
  return r
}
function str(n: number, m: number, grading: 'none' | 'capacitance' | 'guard' = 'none', kv = 66): StringResult {
  const r = computeString({ n, m, kv, grading })
  if (!r.ok) throw new Error('string invalid')
  return r
}

/** A seeded pseudo-random generator (mulberry32) so the sampled tests are repeatable. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r: () => number, [a, b]: readonly [number, number]) => a + (b - a) * r()

/**
 * Independent shape: integrate the equilibrium ODE of a hanging flexible cable, y″ = (w/T₀)·√(1 + y′²), from the
 * vertex (y = y′ = 0) with RK4, together with the arc length s′ = √(1 + y′²). Returns y, y′ and s at x.
 */
function odeCable(w: number, T0: number, x: number, steps = 4000) {
  const k = w / T0
  let y = 0
  let p = 0
  let s = 0
  const h = x / steps
  const f = (pp: number) => [pp, k * Math.sqrt(1 + pp * pp), Math.sqrt(1 + pp * pp)]
  for (let i = 0; i < steps; i++) {
    const k1 = f(p)
    const k2 = f(p + (h / 2) * k1[1])
    const k3 = f(p + (h / 2) * k2[1])
    const k4 = f(p + h * k3[1])
    y += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
    s += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
    p += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
  }
  return { y, p, s }
}

// ── catenary ───────────────────────────────────────────────────────────────────────────────────────────────

describe('catenary: sag, length and tension', () => {
  it('level span: S, half-length and support tension agree with an independent ODE integration of the hanging cable', () => {
    for (const [L, w, T0] of [
      [300, 9.6, 25e3],
      [600, 15.9, 8e3],
      [100, 3.9, 2e3],
      [800, 25, 30e3],
    ]) {
      const c = catenary(T0, w, L, 0)
      const ode = odeCable(w, T0, L / 2)
      expect(rel(c.SA, ode.y)).toBeLessThan(1e-8)
      expect(rel(c.SB, ode.y)).toBeLessThan(1e-8)
      expect(rel(c.length, 2 * ode.s)).toBeLessThan(1e-8)
      // support tension: T₀ along the tangent → T₀·√(1 + y′²)
      expect(rel(c.TB, T0 * Math.sqrt(1 + ode.p * ode.p))).toBeLessThan(1e-8)
    }
  })

  it('length agrees with direct numerical integration of the arc length (Simpson) — also for unequal supports', () => {
    for (const [L, w, T0, h] of [
      [300, 9.6, 25e3, 0],
      [400, 12, 15e3, 30],
      [250, 9.6, 5e3, 60],
    ]) {
      const c = catenary(T0, w, L, h)
      const num = arcLength((u) => Math.sinh((u - c.u0) / c.c), 0, L)
      expect(rel(c.length, num)).toBeLessThan(1e-9)
    }
  })

  it('T = T₀ + wS at each support (vertical balance) equals T₀·cosh(x/c) (tension along the tangent)', () => {
    const c = catenary(20e3, 10, 350, 25)
    expect(rel(c.TA, 20e3 * Math.cosh(c.u0 / c.c))).toBeLessThan(1e-12)
    expect(rel(c.TB, 20e3 * Math.cosh((350 - c.u0) / c.c))).toBeLessThan(1e-12)
    expect(c.TB).toBeGreaterThan(c.TA)
  })

  it('level supports are symmetric: vertex at mid-span, equal sags, a symmetric curve', () => {
    const r = span({})
    expect(r.cat.u0).toBeCloseTo(BASE.L / 2, 9)
    expect(r.cat.SA).toBeCloseTo(r.cat.SB, 12)
    const { cat } = spanPoints(r, 100)
    for (let k = 0; k <= 50; k++) expect(cat[k][1]).toBeCloseTo(cat[100 - k][1], 9)
    expect(r.vSagA).toBeCloseTo(r.cat.SB, 12)
    expect(r.clearance).toBeCloseTo(BASE.hA - r.cat.SB, 12)
  })

  it('the parabola approaches the catenary in the small-sag limit: (S_cat − S_par)/S_par → 0 inside the bracket [(4/3)(S/L)², (4/3)(S/L)²·cosh u]', () => {
    let prev = Infinity
    for (const T0 of [2e3, 5e3, 1e4, 3e4, 1e5, 1e6]) {
      const k = parabolaCheck(T0, 9.6, 300)
      expect(k.ok).toBe(true)
      expect(k.d).toBeGreaterThan(0) // the parabola always underestimates
      expect(k.d).toBeLessThan(prev)
      prev = k.d
    }
    expect(prev).toBeLessThan(1e-6)
    // the on-screen estimate (4/3)(S/L)²
    const r = span({})
    expect(rel(r.relDiff, r.relDiffEst)).toBeLessThan(0.01)
    expect(r.relDiff).toBeLessThan(0.001)
  })

  it('the on-screen parabola verdict: within 1 % of the catenary exactly when (S_cat − S_par)/S_par ≤ 1 %', () => {
    const shallow = span({ T0: 25e3 })
    expect(shallow.warnings.some((w) => w.id === 'parabola')).toBe(false)
    const deep = span({ L: 400, T0: 5.2e3, hA: 40 })
    expect(deep.relDiff).toBeGreaterThan(0.01)
    expect(deep.warnings.some((w) => w.id === 'parabola')).toBe(true)
  })

  it('unequal supports: S₂ − S₁ = h for both the catenary and the parabola; the curve passes through both supports', () => {
    const r = span({ h: 20 })
    expect(r.cat.SB - r.cat.SA).toBeCloseTo(20, 9)
    expect(r.par.SB - r.par.SA).toBeCloseTo(20, 9)
    const { cat, par } = spanPoints(r, 50)
    expect(cat[0][1]).toBeCloseTo(BASE.hA, 9)
    expect(cat[50][1]).toBeCloseTo(BASE.hA + 20, 9)
    expect(par[50][1]).toBeCloseTo(BASE.hA + 20, 9)
    expect(cat[50][0]).toBeCloseTo(BASE.L, 9)
    // textbook x₁, x₂
    const p = parabola(25e3, BASE.w, BASE.L, 20)
    expect(p.x1).toBeCloseTo(BASE.L / 2 - (25e3 * 20) / (BASE.w * BASE.L), 9)
    expect(p.x1 + p.x2).toBeCloseTo(BASE.L, 9)
    expect(unequalCheck(r).ok).toBe(true)
  })

  it('unequal supports with x₁ < 0: the lowest point is the lower support itself, and a warning says so', () => {
    const r = span({ h: 60, T0: 60e3 })
    expect(r.par.x1).toBeLessThan(0)
    expect(r.vertexInSpan).toBe(false)
    expect(r.low.x).toBeCloseTo(0, 9)
    expect(r.clearance).toBeCloseTo(BASE.hA, 9)
    expect(r.warnings.some((w) => w.id === 'vertex-outside')).toBe(true)
  })

  it('tension from breaking strength ÷ factor of safety: the solved T₀ gives exactly that support tension', () => {
    for (const fos of [1.5, 2, 2.5, 4]) {
      const r = span({ mode: 'fos', fos })
      expect(rel(r.Tmax, BASE.uts / fos)).toBeLessThan(1e-9)
      expect(r.fosActual).toBeCloseTo(fos, 9)
      expect(r.T0).toBeLessThan(BASE.uts / fos)
    }
    // the shallow branch: of the two T₀ with the same support tension, the larger one
    const T0 = solveT0ForSupportTension(30e3, 9.6, 300, 0)!
    const c = catenary(T0, 9.6, 300, 0)
    expect(c.TB).toBeCloseTo(30e3, 4)
    expect(c.SB).toBeLessThan(10)
    // too weak for the span: no solution, a message and no numbers
    const bad = computeSpan({ ...BASE, mode: 'fos', fos: 5, L: 800, uts: 20e3, w: 25 })
    expect(bad.ok).toBe(false)
  })
})

// ── wind and ice ───────────────────────────────────────────────────────────────────────────────────────────

describe('wind and ice loading', () => {
  it('ice weight from the area of the ice annulus; wind on the projected diameter d + 2t; resultant and angle', () => {
    const d = 0.021
    const t = 0.01
    const p = 400
    const annulus = (Math.PI / 4) * ((d + 2 * t) ** 2 - d ** 2)
    expect(rel(iceWeight(d, t), annulus * 915 * 9.81)).toBeLessThan(1e-12)
    expect(windForce(d, t, p)).toBeCloseTo(400 * 0.041, 12)
    const ld = loads(9.6, d, t, p)
    expect(rel(ld.wr, Math.sqrt((9.6 + ld.wi) ** 2 + ld.ww ** 2))).toBeLessThan(1e-12)
    expect(Math.tan(ld.theta)).toBeCloseTo(ld.ww / (9.6 + ld.wi), 12)
    expect(RHO_ICE).toBe(915)
    expect(G).toBe(9.81)
    // units: 10 mm of ice on a 21 mm conductor weighs ≈ 8.74 N/m (≈ 0.89 kg per metre)
    expect(ld.wi / G).toBeCloseTo(915 * annulus, 12)
  })

  it('zero wind and zero ice reduce exactly to the bare conductor', () => {
    const r = span({ iceT: 0, windP: 0 })
    expect(r.loads.wr).toBe(BASE.w)
    expect(r.loads.theta).toBe(0)
    expect(r.low.z).toBe(0)
    const c = catenary(BASE.T0, BASE.w, BASE.L, 0)
    expect(r.cat.SB).toBeCloseTo(c.SB, 12)
  })

  it('wind: the sag lies in the plane of w_r; vertical sag = S·cos θ, sideways swing = S·sin θ, clearance = h_A − S·cos θ', () => {
    const r = span({ windP: 600, iceT: 0.005 })
    const S = r.cat.SB
    expect(r.vSagA).toBeCloseTo(S * Math.cos(r.loads.theta), 9)
    expect(r.low.z).toBeCloseTo(S * Math.sin(r.loads.theta), 9)
    expect(r.clearance).toBeCloseTo(BASE.hA - S * Math.cos(r.loads.theta), 9)
    // parabola: wind alone leaves the vertical sag wL²/8T₀ unchanged
    const wind = span({ windP: 600 })
    const bare = span({})
    expect(wind.par.Slevel * Math.cos(wind.loads.theta)).toBeCloseTo(bare.par.Slevel, 9)
  })

  it('factor-of-safety mode: ice leaves the support tension at the working tension, lowers T₀ and deepens the sag', () => {
    const b = span({ mode: 'fos', fos: 2.5 })
    const a = span({ mode: 'fos', fos: 2.5, iceT: 0.01 })
    expect(a.Tmax).toBeCloseTo(b.Tmax, 6)
    expect(a.Tmax).toBeCloseTo(BASE.uts / 2.5, 6)
    expect(a.T0).toBeLessThan(b.T0)
    expect(a.vSagA).toBeGreaterThan(b.vSagA)
  })

  it('ice and wind raise the support tension (T₀ held) and the ice raises the sag', () => {
    const bare = span({})
    const ice = span({ iceT: 0.01 })
    const both = span({ iceT: 0.01, windP: 400 })
    expect(ice.vSagA).toBeGreaterThan(bare.vSagA)
    expect(ice.Tmax).toBeGreaterThan(bare.Tmax)
    expect(both.Tmax).toBeGreaterThan(ice.Tmax)
    // units: kN on screen = N / 1000
    expect(bare.Tmax / 1000).toBeGreaterThan(25)
    expect(bare.Tmax / 1000).toBeLessThan(25.1)
  })

  it('unequal supports with wind: the 3D curve still passes through both supports, and the lowest point is the minimum of its height', () => {
    const r = span({ h: 25, windP: 500, iceT: 0.01 })
    const { cat } = spanPoints(r, 400)
    expect(cat[0][1]).toBeCloseTo(BASE.hA, 9)
    expect(cat[400][1]).toBeCloseTo(BASE.hA + 25, 9)
    expect(cat[400][2]).toBeCloseTo(0, 9)
    expect(cat[400][0]).toBeCloseTo(BASE.L, 9)
    const minSampled = Math.min(...cat.map((p) => p[1]))
    expect(r.clearance).toBeLessThanOrEqual(minSampled + 1e-9)
    expect(minSampled - r.clearance).toBeLessThan(1e-3)
    // the sags in the load plane differ by h' = h·cos θ
    expect(r.cat.SB - r.cat.SA).toBeCloseTo(25 * Math.cos(r.loads.theta), 9)
  })
})

// ── invalid inputs ─────────────────────────────────────────────────────────────────────────────────────────

describe('invalid spans: a clear message and no numbers', () => {
  it.each([
    ['zero span', { L: 0 }],
    ['negative span', { L: -100 }],
    ['zero tension', { T0: 0 }],
    ['negative weight', { w: -1 }],
    ['negative ice', { iceT: -0.001 }],
    ['negative wind', { windP: -10 }],
    ['NaN span', { L: Number.NaN }],
    ['tension too low for the span (conductor reaches the ground)', { T0: 2e3, L: 600 }],
    ['support tension above the breaking strength', { T0: 95e3 }],
    ['factor of safety ≤ 1', { mode: 'fos' as const, fos: 1 }],
  ])('%s', (_, patch) => {
    const r = computeSpan({ ...BASE, ...patch })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0)
      expect(r.issues[0].message.length).toBeGreaterThan(10)
      expect(Object.keys(r)).toEqual(['ok', 'issues'])
    }
  })
})

// ── insulator strings ──────────────────────────────────────────────────────────────────────────────────────

describe('insulator string: voltage distribution', () => {
  it('ladder recurrence = independent nodal solve = closed form u_k = V·sinh(kα)/sinh(nα), cosh α = 1 + m/2 (relative 1e-9)', () => {
    for (const n of [2, 3, 4, 5, 8, 12]) {
      for (const m of [0.01, 0.1, 0.2, 0.5]) {
        const V = 38.1
        const lad = ladderVoltages(n, m, V)
        const nod = nodalString(new Array(n).fill(1), new Array(n - 1).fill(m), new Array(n - 1).fill(0), V).discV
        const a = Math.acosh(1 + m / 2)
        const u = (k: number) => (V * Math.sinh(k * a)) / Math.sinh(n * a)
        lad.forEach((v, k) => {
          expect(Math.abs(v - nod[k]) / V).toBeLessThan(1e-9)
          expect(Math.abs(v - (u(k + 1) - u(k))) / V).toBeLessThan(1e-9)
        })
      }
    }
  })

  it('textbook 3-disc string: V₂ = (1 + m)V₁, V₃ = (1 + 3m + m²)V₁', () => {
    const m = 0.1
    const v = ladderVoltages(3, m, 1)
    expect(v[1] / v[0]).toBeCloseTo(1 + m, 12)
    expect(v[2] / v[0]).toBeCloseTo(1 + 3 * m + m * m, 12)
    const eff = 1 / (3 * v[2])
    expect(str(3, m).eff).toBeCloseTo(eff, 12)
  })

  it('Σ disc voltages = phase voltage; V = kV_LL/√3', () => {
    const r = str(7, 0.15, 'none', 132)
    expect(r.V).toBeCloseTo(132 / Math.sqrt(3), 12)
    expect(r.discV.reduce((a, b) => a + b, 0)).toBeCloseTo(r.V, 9)
  })

  it('m = 0: equal sharing and η = 100 %', () => {
    const r = str(6, 0)
    r.discV.forEach((v) => expect(v).toBeCloseTo(r.V / 6, 12))
    expect(r.eff).toBeCloseTo(1, 12)
  })

  it('η falls as m rises and as n rises; the line-end disc carries the most', () => {
    let prev = 1.0000001
    for (const m of [0, 0.02, 0.05, 0.1, 0.2, 0.5]) {
      const e = str(5, m).eff
      expect(e).toBeLessThan(prev)
      prev = e
    }
    prev = 1.0000001
    for (let n = 2; n <= 12; n++) {
      const r = str(n, 0.1)
      expect(r.eff).toBeLessThan(prev)
      prev = r.eff
      expect(r.maxIdx).toBe(n - 1)
      for (let k = 1; k < n; k++) expect(r.discV[k]).toBeGreaterThan(r.discV[k - 1])
    }
  })

  it('capacitance grading C_k = C(1 + m·k(k−1)/2) and the ideal guard ring C_g,k = C·m·k/(n − k) equalise the voltages (1e-9, by the nodal solve)', () => {
    for (const n of [2, 3, 5, 9, 12]) {
      for (const m of [0.05, 0.1, 0.3]) {
        for (const g of ['capacitance', 'guard'] as const) {
          const r = str(n, m, g)
          r.discV.forEach((v) => expect(Math.abs(v - r.V / n) / r.V).toBeLessThan(1e-9))
          expect(r.eff).toBeCloseTo(1, 9)
        }
      }
    }
    expect(gradedCaps(3, 0.1)).toEqual([1, 1 + 0.1, 1 + 0.3].map((x) => expect.closeTo(x, 12)))
    expect(guardRingCaps(3, 0.1)[0]).toBeCloseTo(0.1 / 2, 12)
    expect(guardRingCaps(3, 0.1)[1]).toBeCloseTo(0.2, 12)
  })

  it('the dense solver solves a known system', () => {
    const x = solveLinear(
      [
        [4, -2, 1],
        [-2, 4, -2],
        [1, -2, 4],
      ],
      [11, -16, 17],
    )
    expect(x[0]).toBeCloseTo(1, 12)
    expect(x[1]).toBeCloseTo(-2, 12)
    expect(x[2]).toBeCloseTo(3, 12)
  })

  it('invalid strings: a message, no numbers', () => {
    for (const s of [
      { n: 0, m: 0.1, kv: 66, grading: 'none' as const },
      { n: 2.5, m: 0.1, kv: 66, grading: 'none' as const },
      { n: 4, m: -0.1, kv: 66, grading: 'none' as const },
      { n: 4, m: 0.1, kv: 0, grading: 'none' as const },
    ]) {
      const r = computeString(s)
      expect(r.ok).toBe(false)
    }
  })
})

// ── corona ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('corona (Peek)', () => {
  it('δ = 1 at 76 cmHg and 25 °C; the textbook 3.92·b/(273 + t) agrees to 0.03 %', () => {
    expect(airDensity(76, 25)).toBe(1)
    for (const [b, t] of [
      [76, 25],
      [60, 10],
      [72, 40],
    ])
      expect(rel((3.92 * b) / (273 + t), airDensity(b, t))).toBeLessThan(3e-4)
    expect(airDensity(60, 25)).toBeLessThan(1)
    expect(airDensity(76, 0)).toBeGreaterThan(1)
  })

  it('g₀ = 30 kV/cm peak = 30/√2 kV/cm rms; V_c for r = 1 cm, D = 1 m, m₀ = δ = 1 is (30/√2)·ln 100 kV', () => {
    expect(G0_RMS).toBeCloseTo(21.2132, 4)
    expect(criticalDisruptive(1, 1, 1, 100)).toBeCloseTo((30 / Math.SQRT2) * Math.log(100), 9)
  })

  it('V_c ∝ δ and ∝ m₀, and follows r·ln(D/r)', () => {
    const v1 = criticalDisruptive(0.9, 1, 1.05, 200)
    expect(criticalDisruptive(0.9, 0.8, 1.05, 200) / v1).toBeCloseTo(0.8, 12)
    expect(criticalDisruptive(0.45, 1, 1.05, 200) / v1).toBeCloseTo(0.5, 12)
    expect(criticalDisruptive(0.9, 1, 2, 300) / v1).toBeCloseTo((2 * Math.log(150)) / (1.05 * Math.log(200 / 1.05)), 12)
  })

  it('monotonic: V_c rises with r (for D/r > e), with D and with δ; V_v > V_c when m_v = m₀', () => {
    let prev = 0
    for (const r of [0.5, 0.8, 1, 1.5, 2]) {
      const v = criticalDisruptive(0.9, 1, r, 300)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
    expect(criticalDisruptive(0.9, 1, 1, 400)).toBeGreaterThan(criticalDisruptive(0.9, 1, 1, 200))
    expect(visualCritical(0.9, 1, 1, 200)).toBeGreaterThan(criticalDisruptive(0.9, 1, 1, 200))
  })

  it('Verify block 6: the hand V_c with the textbook δ = 3.92b/(273+t) agrees within 4e-4, and the check FAILS for a wrong V_c', () => {
    const r = coronaOf(DESIGN0)
    if (!r.ok) throw new Error('corona invalid')
    const k = coronaCheck(r)
    expect(k.ok).toBe(true)
    // the stated tolerance is justified: 3.92 vs 298/76
    expect(Math.abs(3.92 / (298 / 76) - 1)).toBeLessThan(CORONA_HAND_TOL)
    expect(Math.abs(k.vcHand / r.vc - 1)).toBeCloseTo(Math.abs(3.92 / (298 / 76) - 1), 9)
    // the consistency line: charge → surface field equals m₀g₀δ (and V/(r ln(D/r)))
    expect(k.g).toBeCloseTo(surfaceGradient(r.vc, r.input.rCm, r.input.DCm), 9)
    // a model error the check must catch: V_c off by 0.1 %, or a wrong g₀
    expect(coronaCheck({ ...r, vc: r.vc * 1.001 }).ok).toBe(false)
    expect(coronaCheck({ ...r, vc: r.vc * (21.1 / G0_RMS) }).ok).toBe(false)
    expect(coronaCheck({ ...r, gCritical: r.gCritical, delta: r.delta * 1.01 }).ok).toBe(false)
    // units: line-to-line = √3 × phase
    expect(r.vcLine).toBeCloseTo(r.vc * Math.sqrt(3), 12)
  })

  it('the corona verdict is consistent with both comparisons for every combination in the ranges (V_v < V_c is flagged)', () => {
    const rr = rng(21)
    let inconsistent = 0
    for (let i = 0; i < 4000; i++) {
      const c = computeCorona({
        rCm: pick(rr, [0.4, 2]),
        DCm: pick(rr, RANGES.Dm) * 100,
        m0: pick(rr, RANGES.m0),
        mv: pick(rr, RANGES.mv),
        b: pick(rr, RANGES.b),
        t: pick(rr, RANGES.t),
        kv: RANGES.kv[Math.floor(rr() * RANGES.kv.length)],
      })
      if (!c.ok) continue
      const v = coronaVerdict(c)
      expect(/^No corona expected/.test(v.text)).toBe(!c.above)
      expect(/^Corona expected/.test(v.text)).toBe(c.above)
      expect(/glow would be visible/.test(v.text)).toBe(c.above && c.aboveVisual && v.consistent)
      expect(/no glow would be seen/.test(v.text)).toBe(c.above && !c.aboveVisual && v.consistent)
      expect(v.consistent).toBe(c.vv >= c.vc)
      if (!v.consistent) {
        inconsistent++
        expect(v.text).toMatch(/inconsistent/)
        expect(v.vvNote).toMatch(/inconsistent/)
      } else expect(v.vvNote).toBe(c.aboveVisual ? 'operating voltage above it' : 'operating voltage below it')
    }
    expect(inconsistent).toBeGreaterThan(0) // the ranges do allow V_v < V_c — and it is flagged
    // the reviewer's case: r 1.05 cm, D 4 m, m₀ 1, m_v 0.6, 220 kV
    const c = computeCorona({ rCm: 1.05, DCm: 400, m0: 1, mv: 0.6, b: 76, t: 25, kv: 220 })
    if (!c.ok) throw new Error('invalid')
    const v = coronaVerdict(c)
    expect(v.consistent).toBe(false)
    expect(v.text).toMatch(/^No corona expected.*inconsistent/)
  })

  it('bundles: a twin bundle of the same sub-conductor has a lower average surface gradient', () => {
    const g1 = bundleGradient(127, 1, 1.4, 40, 1100)
    const g2 = bundleGradient(127, 2, 1.4, 40, 1100)
    expect(g1).toBeCloseTo(surfaceGradient(127, 1.4, 1100), 12)
    expect(g2).toBeLessThan(g1)
  })

  it('invalid corona inputs: a message, no numbers', () => {
    const base = { rCm: 1, DCm: 200, m0: 0.9, mv: 0.8, b: 76, t: 25, kv: 132 }
    for (const p of [{ rCm: 0 }, { DCm: 5 }, { m0: 1.2 }, { b: 0 }, { t: -300 }, { kv: -1 }]) expect(computeCorona({ ...base, ...p }).ok).toBe(false)
  })
})

// ── Verify checks hold over the whole range of every control ─────────────────────────────────────────────────

describe('every Verify check holds for every valid input', () => {
  it('random sampling of the full slider ranges (and their corners): no ✗ for any valid design', () => {
    const r = rng(9)
    let valid = 0
    const conductors = ['light', 'medium', 'heavy', 'custom'] as const
    for (let i = 0; i < 4000; i++) {
      const corner = i < 400
      const v = (range: readonly [number, number]) => (corner ? (r() < 0.5 ? range[0] : range[1]) : pick(r, range))
      const d: Design = {
        span: {
          ...DESIGN0.span,
          L: v(RANGES.L),
          mode: r() < 0.5 ? 'T0' : 'fos',
          T0kN: v(RANGES.T0kN),
          fos: v(RANGES.fos),
          conductor: conductors[Math.floor(r() * 4)],
          w: v(RANGES.w),
          dMm: v(RANGES.dMm),
          utsKN: v(RANGES.utsKN),
          ice: r() < 0.5,
          iceMm: v(RANGES.iceMm),
          wind: r() < 0.5,
          windPa: v(RANGES.windPa),
          unequal: r() < 0.5,
          h: v(RANGES.h),
          hA: v(RANGES.hA),
          minClear: v(RANGES.minClear),
        },
        string: { n: Math.round(v(RANGES.n)), m: v(RANGES.m), kv: RANGES.kv[Math.floor(r() * RANGES.kv.length)], grading: (['none', 'capacitance', 'guard'] as const)[Math.floor(r() * 3)] },
        corona: { Dm: v(RANGES.Dm), b: v(RANGES.b), t: v(RANGES.t), m0: v(RANGES.m0), mv: v(RANGES.mv) },
      }
      const s = spanOf(d)
      const st = stringOf(d)
      const c = coronaOf(d)
      expect(st.ok).toBe(true)
      expect(c.ok).toBe(true) // the smallest D/r in range is 50/2 = 25 ≥ 10
      if (!s.ok || !st.ok) continue
      valid++
      const k = allChecks(s, st, c)
      expect(k, JSON.stringify(d.span)).toEqual({ parabola: true, lengthTension: true, loads: true, unequal: true, string: true, corona: true })
      // nothing on screen is NaN or infinite
      for (const x of [s.vSagA, s.clearance, s.Tmax, s.fosActual, s.cat.length, s.relDiff, s.maxGap, s.low.z, st.eff, ...st.discV]) expect(Number.isFinite(x)).toBe(true)
    }
    expect(valid).toBeGreaterThan(1500)
  })

  it('the individual checks at the default design', () => {
    const s = spanOf(DESIGN0)
    const st = stringOf(DESIGN0)
    if (!s.ok || !st.ok) throw new Error('default invalid')
    expect(lengthTensionCheck(s).ok).toBe(true)
    expect(loadsCheck(s).ok).toBe(true)
    expect(stringCheck(st).ok).toBe(true)
  })
})

// ── experiments and meta ───────────────────────────────────────────────────────────────────────────────────

describe('experiments', () => {
  it('every experiment runs, and its answer is one of its options (decided from the computation)', () => {
    for (const e of EXPERIMENTS) {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      expect(r.rows.length).toBeGreaterThan(0)
      for (const row of r.rows) {
        expect(Number.isFinite(row.before)).toBe(true)
        expect(Number.isFinite(row.after)).toBe(true)
      }
      for (const p of r.explain) expect(p).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('the altitude experiment names the δ formula it uses', () => {
    const r = EXPERIMENTS.find((e) => e.id === 'altitude')!.run()
    expect(r.explain[0]).toMatch(/\(b\/76\)·\(298\/\(273 \+ t\)\)/)
    expect(r.explain[0]).toContain(r.rows[0].after.toFixed(4))
    expect(r.rows[0].after).toBeCloseTo(airDensity(60, 25), 12)
  })

  it('the expected physics: sag ≈ ×4, ice raises both, wind leaves the vertical sag practically unchanged, η falls, line-end share rises, V_c falls', () => {
    const ans = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.run().answer]))
    expect(ans).toEqual({ span: 'x4', ice: 'both', wind: 'same', discs: 'down', m: 'worse', altitude: 'lower' })
  })
})

describe('meta', () => {
  it('module 9 is complete: learn outcomes, activities in every mode', () => {
    expect(meta.id).toBe('mechanical')
    expect(meta.n).toBe(9)
    expect(meta.learn.length).toBeGreaterThanOrEqual(3)
    expect(meta.learn.length).toBeLessThanOrEqual(5)
    expect(meta.activities.length).toBeGreaterThanOrEqual(5)
    expect(new Set(meta.activities.map((a) => a.mode))).toEqual(new Set(['learn', 'explore', 'experiment', 'verify', 'practise']))
  })
})
