import { describe, expect, it } from 'vitest'
import { add, C, div, mul, scale, sub, type Complex } from '../src/powersys/engine/complex.ts'
import { setDesignedLine, getDesignedLine } from '../src/powersys/lineDesign.ts'
import {
  ALUMINIUM,
  arrangementPhases,
  bundleGm,
  bundleGmFormula,
  bundleOffsets,
  computeLine,
  currentDensity,
  DEFAULT_OPTIONS,
  dist,
  EPS0,
  F_DESIGN,
  gmd3,
  inductanceMatrix,
  invert,
  kelvin,
  linkages,
  matrixModel,
  matrixTol,
  skinCheck,
  skinWords,
  zeroNetCharge,
  minPhaseSpacing,
  MU0,
  potentialMatrix,
  presetDesign,
  R_PRIME,
  rDcPerKm,
  reduceSum,
  rhoAt,
  singlePhase,
  skinDepth,
  skinRatio,
  skinRatioHigh,
  skinRatioLow,
  skinRatioQ,
  subConductors,
  toDesignedLine,
  transpositionAverage,
  validateGeometry,
  type LineGeometry,
  type LineOptions,
  type LineResult,
  type Matrix,
  type Pt,
} from '../src/powersys/modules/line-params/calc.ts'
import { EXPERIMENTS } from '../src/powersys/modules/line-params/experiments.ts'
import { meta } from '../src/powersys/modules/line-params/meta.ts'
import { chargingMvar, lineParams, sil } from '../src/powersys/modules/three-phase/calc.ts'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
const W = 2 * Math.PI * 50
const NO_EARTH: LineOptions = { ...DEFAULT_OPTIONS, earth: false }
function solve(g: LineGeometry, o: LineOptions = NO_EARTH): LineResult {
  const r = computeLine(g, o)
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join(' '))
  return r
}
const geom = (phases: [Pt, Pt, Pt], rM = 0.01, n: 1 | 2 | 3 | 4 = 1, dM = 0.4): LineGeometry => ({ phases, rM, n, dM })
const equilateral = (D: number, h = 20): [Pt, Pt, Pt] => [
  { x: -D / 2, y: h },
  { x: D / 2, y: h },
  { x: 0, y: h + (D * Math.sqrt(3)) / 2 },
]
const flat = (D: number, h = 20): [Pt, Pt, Pt] => arrangementPhases('horizontal', D, h)

// ── closed forms ─────────────────────────────────────────────────────────────────────────────────────────────

describe('closed forms', () => {
  it('r′ = e^(−1/4)·r = 0.7788·r', () => {
    expect(R_PRIME).toBeCloseTo(0.7788, 4)
  })

  it('single-phase line: loop L = 4×10⁻⁷ ln(D/r′) and C = πε₀/ln(D/r) — and the matrix model gives the same', () => {
    for (const [D, r] of [
      [1, 0.01],
      [3, 0.005],
      [0.5, 0.012],
    ]) {
      const sp = singlePhase(D, r)
      expect(rel(sp.loopH, 4e-7 * Math.log(D / (Math.exp(-0.25) * r)))).toBeLessThan(1e-12)
      // independent: two conductors, currents +1 and −1, loop inductance = (λ₁ − λ₂)/I
      const pts = [
        { x: -D / 2, y: 10 },
        { x: D / 2, y: 10 },
      ]
      const lam = linkages(inductanceMatrix(pts, R_PRIME * r), [C(1), C(-1)])
      expect(rel(sub(lam[0], lam[1]).re, sp.loopH)).toBeLessThan(1e-12)
      // independent: charges +q and −q, V₁ − V₂ from the potential coefficients (no earth)
      const P = potentialMatrix(pts, r, false)
      const v12 = P[0][0] - P[0][1] - P[1][0] + P[1][1]
      expect(rel(1 / v12, sp.cLineF)).toBeLessThan(1e-12)
      expect(rel(sp.cNeutralF, (2 * Math.PI * EPS0) / Math.log(D / r))).toBeLessThan(1e-12)
    }
  })

  it('three-phase equilateral line: L = 2×10⁻⁷ ln(D/r′), C = 2πε₀/ln(D/r), GMD = D', () => {
    for (const D of [2, 4, 11]) {
      const res = solve(geom(equilateral(D)))
      expect(rel(res.gmd, D)).toBeLessThan(1e-12)
      expect(rel(res.lMhKm, 0.2 * Math.log(D / (R_PRIME * 0.01)))).toBeLessThan(1e-12) // 2×10⁻⁷ H/m = 0.2 mH/km
      expect(rel(res.cNfKm, ((2 * Math.PI * EPS0) / Math.log(D / 0.01)) * 1e12)).toBeLessThan(1e-12)
    }
  })

  it('GMD of unsymmetrical, transposed spacing = (D_ab·D_bc·D_ca)^(1/3)', () => {
    const res = solve(geom(flat(8)))
    expect(rel(res.gmd, 8 * 2 ** (1 / 3))).toBeLessThan(1e-12)
    const odd = solve(
      geom([
        { x: -3, y: 12 },
        { x: 4, y: 15 },
        { x: 1, y: 22 },
      ]),
    )
    const d = [Math.hypot(7, 3), Math.hypot(3, 7), Math.hypot(4, 10)]
    expect(rel(odd.gmd, Math.cbrt(d[0] * d[1] * d[2]))).toBeLessThan(1e-12)
    expect(gmd3(5, 5, 5)).toBeCloseTo(5, 12)
  })

  it('bundle GMR formulas √(r′d), ∛(r′d²), 1.09·⁴√(r′d³) match the bundle geometry', () => {
    const r = 0.012
    const d = 0.4
    for (const n of [1, 2, 3, 4] as const) {
      // geometry: product of the distances from one sub-conductor to the others, by brute force
      const o = bundleOffsets(n, d)
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const isDiag = n === 4 && Math.abs(i - j) === 2
          expect(dist(o[i], o[j])).toBeCloseTo(isDiag ? d * Math.SQRT2 : d, 12)
        }
      expect(rel(bundleGm(n, d, r), bundleGmFormula(n, d, r))).toBeLessThan(1e-12)
    }
    expect(rel(bundleGmFormula(2, d, r), Math.sqrt(r * d))).toBeLessThan(1e-12)
    expect(rel(bundleGmFormula(3, d, r), Math.cbrt(r * d * d))).toBeLessThan(1e-12)
    // the textbook's 1.09 is 2^(1/8) = 1.0905 rounded: 0.05 % apart
    expect(rel(bundleGmFormula(4, d, r), 1.09 * (r * d ** 3) ** 0.25)).toBeLessThan(6e-4)
  })
})

// ── the independent matrix method ─────────────────────────────────────────────────────────────────────────────

/** Capacitance with EQUAL charge on each phase in every transposition section (the textbook's assumption): average the potential coefficients, then invert. */
function capacitanceEqualCharge(g: LineGeometry, earth: boolean): number {
  const subs = subConductors(g)
  const P = potentialMatrix(subs, g.rM, earth)
  // each phase charge shared equally by its sub-conductors; phase potential = mean of its sub-conductors'
  const P3 = [0, 1, 2].map((p) =>
    [0, 1, 2].map((q) => {
      let s = 0
      let c = 0
      subs.forEach((a, k) =>
        subs.forEach((b, j) => {
          if (a.phase === p && b.phase === q) {
            s += P[k][j]
            c++
          }
        }),
      )
      return s / c
    }),
  )
  const t = transpositionAverage(P3)
  return 1e12 / (t[0][0] - t[0][1])
}

describe('matrix model vs the GMD/GMR formulas', () => {
  it('inductance: single conductors, any spacing — the transposition-averaged matrix equals 2×10⁻⁷ ln(GMD/r′) (1e-9)', () => {
    for (const phases of [
      equilateral(6),
      flat(11, 15),
      arrangementPhases('vertical', 8, 12),
      [
        { x: -5, y: 14 },
        { x: 2, y: 18 },
        { x: 7, y: 13 },
      ] as [Pt, Pt, Pt],
    ]) {
      const res = solve(geom(phases))
      expect(rel(res.matrix.lMhKm, res.lMhKm)).toBeLessThan(1e-9)
    }
  })

  it('inductance from raw flux linkages with balanced currents (Σi = 0), averaged over the three sections of a transposition cycle', () => {
    const g = geom(flat(10, 15))
    const subs = subConductors(g)
    const L = inductanceMatrix(subs, R_PRIME * g.rM)
    const a = (deg: number): Complex => C(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180))
    // section k: phase a sits in position k, b in k+1, c in k+2
    let lamA = C(0)
    for (let k = 0; k < 3; k++) {
      const I: Complex[] = [C(0), C(0), C(0)]
      I[k % 3] = a(0)
      I[(k + 1) % 3] = a(-120)
      I[(k + 2) % 3] = a(120)
      expect(Math.hypot(I.reduce(add, C(0)).re, I.reduce(add, C(0)).im)).toBeLessThan(1e-12)
      lamA = add(lamA, scale(linkages(L, I)[k % 3], 1 / 3))
    }
    const res = solve(g)
    expect(rel(lamA.re * 1e6, res.lMhKm)).toBeLessThan(1e-9)
    expect(Math.abs(lamA.im)).toBeLessThan(1e-15)
  })

  it('bundles: the formula (centre distances) agrees with the sub-conductor matrix to within (ρ/D)^n-order terms — under 0.1 % for real bundles', () => {
    for (const n of [2, 3, 4] as const)
      for (const D of [6, 11]) {
        const g = geom(flat(D, 18), 0.0159, n, 0.45)
        const res = solve(g)
        const dl = rel(res.matrix.lMhKm, res.lMhKm)
        expect(dl).toBeLessThan(1e-3)
        // the difference shrinks quickly with spacing (bundle looks like a point from far away)
        const far = solve(geom(flat(3 * D, 18), 0.0159, n, 0.45))
        expect(rel(far.matrix.lMhKm, far.lMhKm)).toBeLessThan(dl / 4 + 1e-12)
      }
  })

  it('capacitance: the formula is exactly the equal-charge solution of the potential-coefficient matrix (with and without earth)', () => {
    for (const earth of [false, true])
      for (const g of [geom(equilateral(5)), geom(flat(11, 15)), geom(flat(11, 15), 0.0159, 2, 0.45), geom(arrangementPhases('triangular', 9, 14), 0.0159, 4, 0.45)]) {
        const res = solve(g, { ...NO_EARTH, earth })
        const tol = g.n === 1 ? 1e-9 : 1e-3 // bundles: centre distances vs sub-conductor distances, as for inductance
        expect(rel(capacitanceEqualCharge(g, earth), res.cNfKm)).toBeLessThan(tol)
        expect(rel(res.matrix.cEqualNfKm, capacitanceEqualCharge(g, earth))).toBeLessThan(1e-12)
      }
  })

  it('capacitance: the exact equipotential solution (P inverted, bundles at one potential, C averaged over the cycle) is within 2 % of the formula (the equal-charge assumption is the only difference for single conductors)', () => {
    for (const earth of [false, true])
      for (const g of [geom(equilateral(5)), geom(flat(11, 15)), geom(flat(11, 15), 0.0159, 2, 0.45), geom(arrangementPhases('vertical', 8, 12), 0.0159, 3, 0.45)]) {
        const res = solve(g, { ...NO_EARTH, earth })
        expect(rel(res.matrix.cNfKm, res.cNfKm)).toBeLessThan(0.02)
      }
    // symmetric case without earth: identical (1e-9)
    const eq = solve(geom(equilateral(5)))
    expect(rel(eq.matrix.cNfKm, eq.cNfKm)).toBeLessThan(1e-9)
  })

  it('effect of earth: the image formula raises C slightly, less as the line goes higher', () => {
    const at = (h: number) => solve(geom(flat(11, h), 0.0159, 2, 0.45), { ...NO_EARTH, earth: true })
    const low = at(10)
    const high = at(30)
    expect(low.cNfKm).toBeGreaterThan(low.cNoEarthNfKm)
    expect(high.cNfKm - high.cNoEarthNfKm).toBeLessThan(low.cNfKm - low.cNoEarthNfKm)
    expect(rel(low.cNfKm, low.cNoEarthNfKm)).toBeLessThan(0.05)
    // earth does not change inductance in this model
    expect(low.lMhKm).toBe(solve(geom(flat(11, 10), 0.0159, 2, 0.45)).lMhKm)
  })

  it('untransposed flat line: unequal per-phase inductances (middle phase lowest); their mean is the transposed value', () => {
    const res = solve(geom(flat(11, 15), 0.0159, 2, 0.45))
    const re = res.matrix.lPhase.map((z) => z.re)
    expect(re[1]).toBeLessThan(re[0])
    expect(re[1]).toBeLessThan(re[2])
    expect(rel(re[0], re[2])).toBeLessThan(1e-12) // the outer phases mirror each other
    expect(rel((re[0] + re[1] + re[2]) / 3, res.matrix.lMhKm)).toBeLessThan(1e-12)
    expect(Math.abs(res.matrix.lPhase.reduce((s, z) => s + z.im, 0))).toBeLessThan(1e-12)
    const c = res.matrix.cPhase.map((z) => z.re)
    expect(rel((c[0] + c[1] + c[2]) / 3, res.matrix.cNfKm)).toBeLessThan(1e-12)
    // equilateral: every phase the same and real
    const eq = solve(geom(equilateral(6)))
    for (const z of eq.matrix.lPhase) {
      expect(rel(z.re, eq.lMhKm)).toBeLessThan(1e-9)
      expect(Math.abs(z.im)).toBeLessThan(1e-12)
    }
  })

  it('matrix inversion is correct', () => {
    const M: Matrix = potentialMatrix(subConductors(geom(flat(9, 14), 0.0159, 4, 0.45)), 0.0159, true)
    const I = invert(M)
    const prod = M.map((row) => M.map((_, j) => row.reduce((s, v, k) => s + v * I[k][j], 0)))
    prod.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - (i === j ? 1 : 0))).toBeLessThan(1e-9)))
    expect(
      reduceSum(
        [
          [1, 2],
          [3, 4],
        ],
        [0, 0],
      )
        .flat()
        .reduce((s, v) => s + v, 0),
    ).toBe(10)
  })
})

// ── resistance and skin effect ────────────────────────────────────────────────────────────────────────────────

/** Independent: J0 and J1 of a complex argument by trapezoidal quadrature of Bessel's integrals (spectrally accurate). */
const ccos = (z: Complex): Complex => C(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im))
const csin = (z: Complex): Complex => C(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im))
function besselJ(z: Complex, order: 0 | 1, N = 400): Complex {
  let s = C(0)
  for (let k = 0; k < N; k++) {
    const th = (Math.PI * (k + 0.5)) / N
    const arg = scale(z, Math.sin(th))
    s = add(s, order === 0 ? ccos(arg) : scale(csin(arg), Math.sin(th)))
  }
  return scale(s, 1 / N)
}
/** R_ac/R_dc = Re[(kr/2)·J0(kr)/J1(kr)], k = (1 − j)/δ — the internal impedance of a round wire. */
function skinByQuadrature(q: number): number {
  // kr = q·e^(−jπ/4)  (q = √2 r/δ)
  const kr = C(q * Math.cos(-Math.PI / 4), q * Math.sin(-Math.PI / 4))
  return mul(scale(kr, 0.5), div(besselJ(kr, 0), besselJ(kr, 1))).re
}

describe('resistance and skin effect', () => {
  it('R_T = R₂₀·[1 + α(T − 20)] and R = ρ/(πr²)', () => {
    expect(rel(rDcPerKm(0.0159, 75) / rDcPerKm(0.0159, 20), 1 + 0.00403 * 55)).toBeLessThan(1e-12)
    expect(rel(rDcPerKm(0.01, 20), (ALUMINIUM.rho20 * 1000) / (Math.PI * 1e-4))).toBeLessThan(1e-12)
    expect(rhoAt(20)).toBe(ALUMINIUM.rho20)
  })

  it('skin depth δ = √(2ρ/(ωμ)) = 1/√(π f μ σ)', () => {
    for (const f of [50, 400, 5000]) expect(rel(skinDepth(1.72e-8, f), 1 / Math.sqrt(Math.PI * f * MU0 * (1 / 1.72e-8)))).toBeLessThan(1e-12)
    // aluminium at 20 °C, 50 Hz: about 12 mm — comparable to the conductor radius
    expect(skinDepth(ALUMINIUM.rho20, 50)).toBeGreaterThan(0.011)
    expect(skinDepth(ALUMINIUM.rho20, 50)).toBeLessThan(0.013)
  })

  it('the ber/bei series agrees with an independent quadrature of the Bessel integrals', () => {
    for (const q of [0.3, 1, 2, 3.5, 6, 10, 18, 25]) expect(rel(skinRatioQ(q), skinByQuadrature(q))).toBeLessThan(1e-9)
    // ber + j·bei = J0(x·e^(3jπ/4))
    for (const x of [0.5, 2, 7]) {
      const k = kelvin(x)
      const j0 = besselJ(C(x * Math.cos((3 * Math.PI) / 4), x * Math.sin((3 * Math.PI) / 4)), 0)
      expect(Math.abs(k.ber - j0.re)).toBeLessThan(1e-9 * Math.max(1, Math.abs(k.ber)))
      expect(Math.abs(k.bei - j0.im)).toBeLessThan(1e-9 * Math.max(1, Math.abs(k.bei)))
    }
  })

  it('low-frequency limit → 1 + q⁴/192, high-frequency asymptote → r/(2δ) + 1/4', () => {
    expect(skinRatioQ(0)).toBe(1)
    for (const q of [0.05, 0.2, 0.5]) expect(Math.abs(skinRatioQ(q) - skinRatioLow(q))).toBeLessThan(q ** 8 / 1000)
    let prevErr = Infinity
    for (const q of [10, 20, 30]) {
      const err = Math.abs(skinRatioQ(q) - skinRatioHigh(q))
      expect(err).toBeLessThan(0.3 / q) // next term of the asymptotic series: 3/(32√2·q) ≈ 0.066/q
      expect(err).toBeLessThan(prevErr)
      prevErr = err
    }
    // r/(2δ) + 1/4 written with the radius and skin depth directly
    const r = 0.02
    const f = 20000
    expect(Math.abs(skinRatio(r, ALUMINIUM.rho20, f) - (r / (2 * skinDepth(ALUMINIUM.rho20, f)) + 0.25))).toBeLessThan(0.3 / ((Math.SQRT2 * r) / skinDepth(ALUMINIUM.rho20, f)))
  })

  it('the ratio rises with frequency and the current crowds to the surface', () => {
    const fs = [0, 50, 200, 1000, 5000]
    const rs = fs.map((f) => skinRatio(0.0159, ALUMINIUM.rho20, f))
    for (let k = 1; k < rs.length; k++) expect(rs[k]).toBeGreaterThan(rs[k - 1])
    const prof = currentDensity(5, 200)
    expect(prof[prof.length - 1][1]).toBeGreaterThan(1.5) // the surface carries more than the dc density
    expect(prof[0][1]).toBeLessThan(0.5)
    // dc: uniform; and the profile averages to J_dc (|mean of J| = 1 by construction; the magnitudes average to ≥ 1)
    for (const [, j] of currentDensity(0, 20)) expect(j).toBeCloseTo(1, 12)
  })
})

// ── limits, symmetry, units, hand-off ────────────────────────────────────────────────────────────────────────

describe('limits, units and the hand-off to Module 2', () => {
  it('one sub-conductor is a single conductor', () => {
    const a = solve(geom(flat(10, 15), 0.0159, 1, 0.45))
    expect(a.gmrL).toBeCloseTo(R_PRIME * 0.0159, 15)
    expect(a.req).toBeCloseTo(0.0159, 15)
    expect(a.matrix.conductors).toBe(3)
  })

  it('wider spacing → L up, C down; more sub-conductors → L down, C up, Z_c down, SIL up', () => {
    const base = solve(geom(flat(8, 15), 0.0159, 1))
    const wide = solve(geom(flat(16, 15), 0.0159, 1))
    expect(wide.lMhKm).toBeGreaterThan(base.lMhKm)
    expect(wide.cNfKm).toBeLessThan(base.cNfKm)
    // doubling every spacing adds 0.2·ln 2 mH/km exactly
    expect(wide.lMhKm - base.lMhKm).toBeCloseTo(0.2 * Math.log(2), 12)
    let prev = base
    for (const n of [2, 3, 4] as const) {
      const b = solve(geom(flat(8, 15), 0.0159, n, 0.45))
      expect(b.lMhKm).toBeLessThan(prev.lMhKm)
      expect(b.cNfKm).toBeGreaterThan(prev.cNfKm)
      expect(b.zcOhm).toBeLessThan(prev.zcOhm)
      expect(b.silMw).toBeGreaterThan(prev.silMw)
      expect(b.r.rDc).toBeCloseTo(base.r.rDc / n, 12)
      prev = b
    }
  })

  it('units: X = ωL [Ω/km], B = ωC [µS/km], X·B = ω²LC', () => {
    const res = solve(geom(flat(11, 15), 0.0159, 2, 0.45))
    expect(rel(res.xOhmKm, W * res.lMhKm * 1e-3)).toBeLessThan(1e-12)
    expect(rel(res.bUsKm, W * res.cNfKm * 1e-9 * 1e6)).toBeLessThan(1e-12)
    expect(rel(res.xOhmKm * res.bUsKm * 1e-6, W * W * (res.lMhKm * 1e-3) * (res.cNfKm * 1e-9))).toBeLessThan(1e-12)
    expect(F_DESIGN).toBe(50)
  })

  it('Z_c, SIL and charging match Module 2’s own formulas for the constants sent to it', () => {
    for (const kv of [132, 220, 400, 765]) {
      const d = presetDesign('horizontal', 11, 15, undefined, { ...DEFAULT_OPTIONS, kv })
      const res = solve(d.geometry, d.options)
      const sent = toDesignedLine(d, res, 1)
      const k = { rOhmPerKm: sent.rOhmPerKm, xOhmPerKm: sent.xOhmPerKm, bUsPerKm: sent.bUsPerKm }
      expect(rel(lineParams(k, 1).zcLossless, res.zcOhm)).toBeLessThan(1e-9)
      expect(rel(sil(kv, lineParams(k, 1).zcLossless), res.silMw)).toBeLessThan(1e-9)
      expect(rel(chargingMvar(kv, k, 100), res.chargingMvar100)).toBeLessThan(1e-9)
      expect(rel(Math.sqrt((res.lMhKm * 1e-3) / (res.cNfKm * 1e-9)), res.zcOhm)).toBeLessThan(1e-12)
      expect(setDesignedLine(sent)).toBe(true)
      expect(getDesignedLine()).toEqual(sent)
    }
    setDesignedLine(null)
  })

  it('the default design is a plausible 400 kV twin-bundle line', () => {
    const d = presetDesign('horizontal')
    const res = solve(d.geometry, d.options)
    expect(res.xOhmKm).toBeGreaterThan(0.25)
    expect(res.xOhmKm).toBeLessThan(0.4)
    expect(res.bUsKm).toBeGreaterThan(3)
    expect(res.bUsKm).toBeLessThan(4.5)
    expect(res.silMw).toBeGreaterThan(400)
    expect(res.silMw).toBeLessThan(650)
  })
})

describe('review fixes: checks that hold for every valid design', () => {
  it('the exact skin ratio always lies between max(1, r/(2δ) + ¼) and 1 + q⁴/192 (0 < q ≤ 40)', () => {
    for (let q = 0.01; q <= 40; q *= 1.01) expect(skinCheck(q).bracketed).toBe(true)
    expect(skinCheck(1.5).regime).toBe('low')
    expect(skinCheck(2.5).regime).toBe('between')
    expect(skinCheck(5).regime).toBe('high')
    // in its stated range: the low-frequency estimate within 1 %, the asymptote within 1.5 %
    for (const q of [0.5, 1, 1.5, 2]) expect(rel(skinCheck(q).low, skinCheck(q).exact)).toBeLessThan(0.01)
    for (let q = 3; q <= 40; q += 0.25) expect(rel(skinCheck(q).high, skinCheck(q).exact)).toBeLessThan(0.015)
  })

  it('large-radius conductors (up to 25 mm, 0–100 °C): valid, bracketed, and described from the computed ratio', () => {
    for (const rMm of [5, 10, 15.9, 20, 22, 25])
      for (const tempC of [0, 20, 50, 100]) {
        const d = presetDesign('horizontal', 11, 15, { rM: rMm / 1000 }, { ...DEFAULT_OPTIONS, tempC })
        const res = solve(d.geometry, d.options)
        const sk = skinCheck(res.r.q50)
        expect(sk.bracketed).toBe(true)
        expect(sk.exact).toBeCloseTo(res.r.ratio50, 12)
      }
    // 25 mm at 0 °C: the low-frequency estimate is far off (q is between the regimes) — the page must not lean on it
    const big = solve(presetDesign('horizontal', 11, 15, { rM: 0.025 }, { ...DEFAULT_OPTIONS, tempC: 0 }).geometry, { ...DEFAULT_OPTIONS, tempC: 0 })
    const sk = skinCheck(big.r.q50)
    expect(sk.regime).not.toBe('low')
    expect(rel(sk.low, sk.exact)).toBeGreaterThan(0.05)
    expect(skinWords(sk.exact)).toMatch(/^large/)
    expect(skinWords(1.0497)).toBe('small (about 5.0 %)')
    expect(skinWords(1.004)).toMatch(/^negligible/)
  })

  it('random valid cross-sections down to the minimum spacing: formula and matrix agree within the stated tolerance', () => {
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647)
    let n0 = 0
    for (let t = 0; t < 3000; t++) {
      const n = (1 + Math.floor(rnd() * 4)) as 1 | 2 | 3 | 4
      const g: LineGeometry = {
        rM: (5 + rnd() * 20) / 1000,
        n,
        dM: 0.2 + rnd() * 0.4,
        phases: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      }
      const dmin = minPhaseSpacing(g)
      const pts: Pt[] = [{ x: (rnd() - 0.5) * 6, y: 3 + rnd() * 10 }]
      for (let k = 1; k < 3; k++) {
        const a = rnd() * 2 * Math.PI
        const D = dmin * (1 + rnd() * 0.3)
        const b = pts[Math.floor(rnd() * k)]
        pts.push({ x: b.x + D * Math.cos(a), y: b.y + D * Math.sin(a) })
      }
      g.phases = pts as [Pt, Pt, Pt]
      for (const earth of [false, true]) {
        const r = computeLine(g, { ...DEFAULT_OPTIONS, earth })
        if (!r.ok) continue
        n0++
        expect(rel(r.matrix.lMhKm, r.lMhKm)).toBeLessThan(matrixTol(n))
        expect(rel(r.matrix.cEqualNfKm, r.cNfKm)).toBeLessThan(matrixTol(n))
        expect(r.matrix.cNfKm).toBeGreaterThan(0)
        expect(skinCheck(r.r.q50).bracketed).toBe(true)
      }
    }
    expect(n0).toBeGreaterThan(1000)
  })

  it('without earth the exact capacitance does not depend on the potential reference (Σq = 0)', () => {
    const subs = subConductors(geom(flat(9, 14), 0.0159, 2, 0.45))
    const P = potentialMatrix(subs, 0.0159, false)
    const k = 1 / (2 * Math.PI * EPS0)
    const shifted = P.map((row) => row.map((v) => v + k * Math.log(37))) // a different reference distance
    const a = zeroNetCharge(invert(P))
    const b = zeroNetCharge(invert(shifted))
    a.forEach((row, i) => {
      expect(Math.abs(row.reduce((s2, v) => s2 + v, 0))).toBeLessThan(1e-20)
      row.forEach((v, j) => expect(Math.abs(v - b[i][j])).toBeLessThan(1e-9 * Math.abs(a[i][i])))
    })
  })
})

describe('invalid geometry is rejected (no results)', () => {
  const ok = geom(flat(11, 15), 0.0159, 2, 0.45)
  it('valid default', () => expect(validateGeometry(ok)).toEqual([]))
  it('below ground', () => {
    const g = { ...ok, phases: [{ x: -11, y: 0.1 }, ok.phases[1], ok.phases[2]] as [Pt, Pt, Pt] }
    const r = computeLine(g, DEFAULT_OPTIONS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].kind).toBe('ground')
  })
  it('phases too close or overlapping', () => {
    const g = { ...ok, phases: [{ x: 0, y: 15 }, { x: 0.5, y: 15 }, ok.phases[2]] as [Pt, Pt, Pt] }
    const r = computeLine(g, DEFAULT_OPTIONS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.kind === 'spacing')).toBe(true)
    expect(minPhaseSpacing(ok)).toBeCloseTo(2 * (0.225 + 0.0159) + 1, 12)
  })
  it('sub-conductors overlapping, bad radius, not a number', () => {
    expect(validateGeometry({ ...ok, dM: 0.03 })[0].kind).toBe('bundle')
    expect(validateGeometry({ ...ok, n: 2, dM: 0.12, rM: 0.04 }).some((i) => i.kind === 'bundle')).toBe(false)
    expect(validateGeometry({ ...ok, rM: 0.1 })[0].kind).toBe('radius')
    expect(validateGeometry({ ...ok, phases: [{ x: NaN, y: 15 }, ok.phases[1], ok.phases[2]] })[0].kind).toBe('number')
    expect(computeLine({ ...ok, rM: Infinity }, DEFAULT_OPTIONS).ok).toBe(false)
  })
})

describe('experiments and meta', () => {
  it('every experiment decides its answer from the computation and offers it', () => {
    for (const e of EXPERIMENTS) {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      for (const row of r.rows) {
        expect(Number.isFinite(row.before)).toBe(true)
        expect(Number.isFinite(row.after)).toBe(true)
      }
      expect(r.explain.join(' ')).not.toMatch(/NaN|undefined|Infinity/)
    }
  })
  it('matrix model returns finite values for every preset', () => {
    for (const a of ['horizontal', 'vertical', 'triangular'] as const)
      for (const n of [1, 2, 3, 4] as const) {
        const d = presetDesign(a, undefined, undefined, { n })
        const m = matrixModel(d.geometry, true)
        expect([m.lMhKm, m.cNfKm, ...m.lPhase.map((z) => z.re), ...m.cPhase.map((z) => z.re)].every(Number.isFinite)).toBe(true)
      }
  })
  it('meta', () => {
    expect(meta.id).toBe('line-params')
    expect(meta.status).toBe('ready')
    expect(meta.learn.length).toBeGreaterThanOrEqual(3)
    expect(meta.activities.length).toBeGreaterThanOrEqual(5)
    expect(new Set(meta.activities.map((a) => a.id)).size).toBe(meta.activities.length)
  })
})
