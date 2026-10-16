import { describe, expect, it } from 'vitest'
import { C, sub } from '../src/powersys/engine/complex.ts'
import {
  beltedByMatrix,
  beltedCharging,
  beltedFromMeasurements,
  capacitanceByCharge,
  capacitanceByEnergy,
  capacitanceGraded,
  capacitancePerM,
  changeWords,
  compareWithLine,
  computeCable,
  criticalLength,
  DEFAULT_CABLE,
  economicNumeric,
  economicSize,
  EPS0,
  equalPeakRadii,
  equipotentialRadius,
  gMaxFixedSheath,
  goldenMin,
  gradedProfile,
  gradedStressAt,
  gradedVoltageByIntegration,
  G_PERM_DEFAULT,
  insulationByShells,
  insulationOhmM,
  intersheathEqualPeak,
  intersheathGraded,
  overheadLine,
  potentialAt,
  probeRadius,
  profile,
  RANGE,
  sheathFor,
  simpson,
  stressAt,
  stressByDerivative,
  surgeImpedanceClosed,
  timesWords,
  validateCable,
  verifyChecks,
  voltageByIntegration,
  type CableInput,
  type CableResult,
  type GradedResult,
} from '../src/powersys/modules/cables/calc.ts'
import { EXPERIMENTS } from '../src/powersys/modules/cables/experiments.ts'
import { meta } from '../src/powersys/modules/cables/meta.ts'
import { stressCss, stressRgb } from '../src/powersys/modules/cables/scale.ts'
import { equalPeakState, gradingOutcome, peaksEqual, type GradingState } from '../src/powersys/modules/cables/grading.ts'
import { computeLine, MU0, presetDesign } from '../src/powersys/modules/line-params/calc.ts'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
function solve(c: Partial<CableInput> = {}): CableResult {
  const r = computeCable({ ...DEFAULT_CABLE, ...c })
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join(' '))
  return r
}
/** A deterministic pseudo-random generator (so a failure can be reproduced). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const pick = (rand: () => number, [lo, hi, step]: readonly [number, number, number]) => Math.round((lo + rand() * (hi - lo)) / step) * step
/** A random VALID cable over the slider ranges (R > r). */
function randomCable(rand: () => number): CableInput {
  for (;;) {
    const c: CableInput = {
      rMm: pick(rand, RANGE.rMm),
      RMm: pick(rand, RANGE.RMm),
      vKv: pick(rand, RANGE.vKv),
      epsR: pick(rand, RANGE.epsR),
      rhoOhmM: 10 ** pick(rand, RANGE.log10Rho),
      tanDelta: pick(rand, RANGE.tanDelta),
      fHz: rand() < 0.5 ? 50 : 60,
      lengthKm: pick(rand, RANGE.lengthKm),
    }
    if (c.RMm > c.rMm && c.rMm >= RANGE.rMm[0]) return c
  }
}

// ── the coaxial field ───────────────────────────────────────────────────────────────────────────────────────

describe('the single-core cable field', () => {
  it('g(x) from Gauss’s law equals −dV/dx of V(x) everywhere in the insulation (numerical derivative, 1e-6)', () => {
    for (const [r, R] of [
      [1, 2.2],
      [0.2, 8],
      [2, 2.05],
      [0.5, 1.4],
    ]) {
      for (let k = 0; k <= 20; k++) {
        const x = r + ((R - r) * k) / 20
        const g = stressAt(66, x, r, R)
        // Gauss: E = q/(2π ε x) with q fixed by V — written out independently here
        const q = (2 * Math.PI * EPS0 * 2.5 * 66e3) / Math.log(R / r)
        const gauss = q / (2 * Math.PI * EPS0 * 2.5 * (x / 100)) / 1e5 // V/m → kV/cm
        expect(rel(g, gauss)).toBeLessThan(1e-12)
        expect(rel(stressByDerivative(66, x, r, R), g)).toBeLessThan(1e-6)
      }
    }
  })

  it('∫ g dx from r to R equals V (Simpson), and V(r) = V, V(R) = 0', () => {
    for (const [r, R, v] of [
      [1, 2.2, 38.1],
      [0.2, 8, 130],
      [3, 3.05, 1],
    ]) {
      expect(rel(voltageByIntegration(v, r, R), v)).toBeLessThan(1e-7)
      expect(potentialAt(v, r, r, R)).toBeCloseTo(v, 12)
      expect(Math.abs(potentialAt(v, R, r, R))).toBeLessThan(1e-12)
    }
  })

  it('g_max is at the conductor and g_min at the sheath; g_max/g_min = R/r', () => {
    const res = solve()
    const p = profile(res, 50)
    const gs = p.g.map(([, g]) => g)
    expect(gs[0]).toBeCloseTo(res.gMax, 10)
    expect(gs[gs.length - 1]).toBeCloseTo(res.gMin, 10)
    for (let i = 1; i < gs.length; i++) expect(gs[i]).toBeLessThan(gs[i - 1])
    expect(res.gMax / res.gMin).toBeCloseTo(res.R / res.r, 10)
    // V(x) is monotone from V to 0 along the same grid
    const vs = p.v.map(([, v]) => v)
    for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeLessThan(vs[i - 1])
  })

  it('equipotential radii x = R(r/R)^k carry exactly the potential kV', () => {
    for (const k of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const x = equipotentialRadius(k, 1, 2.2)
      expect(potentialAt(38.1, x, 1, 2.2)).toBeCloseTo(38.1 * k, 10)
    }
  })

  it('C from q/V (Gauss’s field integrated numerically) and from the stored energy both equal 2πε₀ε_r/ln(R/r)', () => {
    for (const [eps, r, R] of [
      [2.3, 1, 2.2],
      [4, 0.2, 8],
      [1, 3, 3.1],
    ]) {
      const cf = capacitancePerM(eps, r, R)
      expect(rel(capacitanceByCharge(eps, r, R), cf)).toBeLessThan(1e-7)
      expect(rel(capacitanceByEnergy(eps, r, R, 38100), cf)).toBeLessThan(1e-7)
    }
  })

  it('insulation resistance: ρ ln(R/r)/(2πl) equals the sum of thin shells in series; it falls as 1/length', () => {
    expect(rel(insulationByShells(1e14, 1, 2.2), insulationOhmM(1e14, 1, 2.2))).toBeLessThan(1e-7)
    const a = solve({ lengthKm: 2 })
    const b = solve({ lengthKm: 4 })
    expect(b.rInsMOhm).toBeCloseTo(a.rInsMOhm / 2, 6)
    expect(b.rInsMOhmKm).toBeCloseTo(a.rInsMOhmKm, 6)
  })

  it('units: µF/km, MΩ·km, kV/cm, A/km and kvar/km from first principles (a textbook-style case)', () => {
    // r = 0.5 cm, R = 2 cm, ε_r = 4, ρ = 5×10¹² Ω·m, V = 33 kV, 50 Hz
    const res = solve({ rMm: 5, RMm: 20, epsR: 4, rhoOhmM: 5e12, vKv: 33, fHz: 50, lengthKm: 1 })
    const ln4 = Math.log(4)
    expect(res.cUfKm).toBeCloseTo(((2 * Math.PI * 8.8541878128e-12 * 4) / ln4) * 1e9, 10) // F/m × 1000 m × 10⁶
    expect(res.cUfKm).toBeCloseTo(0.1605, 4)
    expect(res.rInsMOhmKm).toBeCloseTo((5e12 * ln4) / (2 * Math.PI) / 1e9, 6)
    expect(res.gMax).toBeCloseTo(33 / (0.5 * ln4), 10) // kV/cm
    expect(res.gMin).toBeCloseTo(33 / (2 * ln4), 10)
    expect(res.icAKm).toBeCloseTo(2 * Math.PI * 50 * res.cUfKm * 1e-6 * 33e3, 10)
    expect(res.qKvarKm).toBeCloseTo((2 * Math.PI * 50 * res.cUfKm * 1e-6 * 33e3 * 33e3) / 1e3, 8)
    expect(res.pWKm).toBeCloseTo(res.qKvarKm * 1000 * res.c.tanDelta, 8)
    expect(res.gMaxPeak).toBeCloseTo(Math.SQRT2 * res.gMax, 12)
  })

  it('every quantity a physical change affects changes (and nothing else does)', () => {
    const a = solve()
    const eps = solve({ epsR: 4 })
    expect(eps.gMax).toBeCloseTo(a.gMax, 12) // single dielectric: stress unchanged
    expect(eps.cUfKm / a.cUfKm).toBeCloseTo(4 / 2.3, 10)
    expect(eps.icAKm / a.icAKm).toBeCloseTo(4 / 2.3, 10)
    expect(eps.pWKm / a.pWKm).toBeCloseTo(4 / 2.3, 10)
    expect(eps.zc / a.zc).toBeCloseTo(Math.sqrt(2.3 / 4), 10)
    const len = solve({ lengthKm: 10 })
    expect(len.cUf / a.cUf).toBeCloseTo(2, 10)
    expect(len.ic / a.ic).toBeCloseTo(2, 10)
    expect(len.p3Kw / a.p3Kw).toBeCloseTo(2, 10)
    expect(len.rInsMOhm / a.rInsMOhm).toBeCloseTo(0.5, 10)
    expect(len.gMax).toBe(a.gMax)
    const f = solve({ fHz: 60 })
    expect(f.icAKm / a.icAKm).toBeCloseTo(1.2, 10)
    expect(f.pWKm / a.pWKm).toBeCloseTo(1.2, 10)
    expect(f.cUfKm).toBe(a.cUfKm)
    const v = solve({ vKv: 76.2 })
    expect(v.gMax / a.gMax).toBeCloseTo(2, 10)
    expect(v.pWKm / a.pWKm).toBeCloseTo(4, 10)
    expect(v.leakW / a.leakW).toBeCloseTo(4, 10)
    expect(v.cUfKm).toBe(a.cUfKm)
  })

  it('surge impedance √(L/C) equals 60·ln(R/r)/√ε_r (closed form) and the wave travels at c/√ε_r', () => {
    const res = solve()
    expect(rel(res.zc, surgeImpedanceClosed(2.3, res.r, res.R))).toBeLessThan(1e-12)
    expect(rel(res.zc, (59.9585 * Math.log(res.R / res.r)) / Math.sqrt(2.3))).toBeLessThan(1e-5)
    expect(rel(res.speed, 299.792458 / Math.sqrt(2.3))).toBeLessThan(1e-6)
    expect(res.lMhKm).toBeCloseTo((MU0 / (2 * Math.PI)) * Math.log(2.2) * 1e6, 12)
  })

  it('limits: as R → r, C → ∞ and g_max → V/(R − r), the uniform (parallel-plate) field', () => {
    let last = 0
    for (const d of [1e-1, 1e-2, 1e-3, 1e-4, 1e-5]) {
      const r = 1
      const R = r + d
      const c = capacitancePerM(2.3, r, R)
      expect(c).toBeGreaterThan(last)
      last = c
      // parallel plate: C ≈ ε·(2πr)/d per metre; g_max ≈ V/d
      expect(rel(c, (EPS0 * 2.3 * 2 * Math.PI * (r / 100)) / (d / 100))).toBeLessThan(d)
      expect(rel(stressAt(10, r, r, R), 10 / d)).toBeLessThan(d)
    }
    expect(last).toBeGreaterThan(1e-5)
  })

  it('invalid geometry and inputs are refused with a message, never numbers', () => {
    for (const bad of [{ RMm: 10 }, { RMm: 8 }, { rMm: 0 }, { vKv: 0 }, { epsR: 0.5 }, { rhoOhmM: -1 }, { tanDelta: -0.1 }, { fHz: 0 }, { lengthKm: 0 }, { rMm: Number.NaN }]) {
      const out = computeCable({ ...DEFAULT_CABLE, ...bad })
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.issues[0].message.length).toBeGreaterThan(10)
    }
    expect(validateCable({ ...DEFAULT_CABLE, RMm: 10 })[0].message).toMatch(/larger than the conductor radius/)
    expect(validateCable(DEFAULT_CABLE)).toEqual([])
  })

  it('every output is finite over random valid cables across the slider ranges', () => {
    const rand = rng(7)
    for (let k = 0; k < 400; k++) {
      const res = computeCable(randomCable(rand))
      expect(res.ok).toBe(true)
      if (!res.ok) continue
      for (const [key, v] of Object.entries(res)) if (typeof v === 'number') expect(Number.isFinite(v), key).toBe(true)
    }
  })

  it('the probe stays inside the insulation', () => {
    const res = solve()
    expect(probeRadius(res, -1)).toBe(res.r)
    expect(probeRadius(res, 2)).toBe(res.R)
    expect(probeRadius(res, 0.5)).toBeCloseTo((res.r + res.R) / 2, 12)
  })
})

// ── the most economical size ────────────────────────────────────────────────────────────────────────────────

describe('the most economical conductor size', () => {
  it('R = e·r (ln(R/r) = 1) and r = V/G — the same as a numerical minimisation of R(r) with g_max = G', () => {
    for (const [v, g] of [
      [38.1, 60],
      [66, 40],
      [1, 200],
      [130, 10],
    ]) {
      const cf = economicSize(v, g)
      const nm = economicNumeric(v, g)
      expect(rel(nm.rCm, cf.rCm)).toBeLessThan(1e-6)
      expect(rel(nm.RCm, cf.RCm)).toBeLessThan(1e-9)
      expect(cf.RCm / cf.rCm).toBeCloseTo(Math.E, 12)
      // and the design really has g_max = G
      expect(stressAt(v, cf.rCm, cf.rCm, cf.RCm)).toBeCloseTo(g, 9)
      // any other r needs a larger sheath
      for (const f of [0.5, 0.9, 1.1, 2]) expect(sheathFor(cf.rCm * f, v, g)).toBeGreaterThan(cf.RCm)
    }
  })

  it('for a fixed sheath R, g_max(r) first falls then rises, with its minimum at r = R/e (= e·V/R)', () => {
    const R = 2.5
    const rs = Array.from({ length: 200 }, (_, k) => 0.05 + (k / 199) * 2.4)
    const gs = rs.map((r) => gMaxFixedSheath(38.1, r, R))
    const kmin = gs.indexOf(Math.min(...gs))
    expect(kmin).toBeGreaterThan(0)
    expect(kmin).toBeLessThan(rs.length - 1)
    const rOpt = goldenMin((r) => gMaxFixedSheath(38.1, r, R), 0.01, 2.49)
    expect(rel(rOpt, R / Math.E)).toBeLessThan(1e-6)
    expect(gMaxFixedSheath(38.1, R / Math.E, R)).toBeCloseTo((Math.E * 38.1) / R, 10)
  })
})

// ── grading ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('grading', () => {
  const ok = (g: ReturnType<typeof capacitanceGraded>): GradedResult => {
    if (!g.ok) throw new Error(g.message)
    return g
  }
  it('capacitance grading: layer voltages add to V, D is continuous (ε₁g₁ = ε₂g₂) at each boundary, numerical ∫g dx = V', () => {
    const rand = rng(3)
    for (let t = 0; t < 200; t++) {
      const r = 0.3 + rand() * 2
      const R = r * (1.2 + rand() * 4)
      const n = rand() < 0.5 ? 2 : 3
      const cuts = Array.from({ length: n - 1 }, () => r + rand() * (R - r)).sort((a, b) => a - b)
      const radii = [r, ...cuts, R]
      if (radii.some((x, i) => i > 0 && x - radii[i - 1] < 1e-3)) continue
      const eps = Array.from({ length: n }, () => 1 + rand() * 6)
      const v = 1 + rand() * 129
      const g = ok(capacitanceGraded(v, radii, eps))
      expect(
        rel(
          g.layers.reduce((s, l) => s + l.vKv, 0),
          v,
        ),
      ).toBeLessThan(1e-12)
      for (let i = 1; i < n; i++) {
        const a = g.layers[i - 1]
        const b = g.layers[i]
        expect(rel(a.eps * a.gMin, b.eps * b.gMax)).toBeLessThan(1e-12) // D continuous at r_i
      }
      expect(rel(gradedVoltageByIntegration(g), v)).toBeLessThan(1e-6)
      // capacitance of the series layers = 1 / Σ(1/C_layer)
      const cSeries = 1 / g.layers.reduce((s, l) => s + 1 / capacitancePerM(l.eps, l.inner, l.outer), 0)
      expect(rel(g.cUfKm as number, cSeries * 1e9)).toBeLessThan(1e-12)
    }
  })

  it('a single layer reduces to the ungraded cable', () => {
    const g = ok(capacitanceGraded(38.1, [1, 2.2], [2.3]))
    const res = solve()
    expect(g.peak).toBeCloseTo(res.gMax, 12)
    expect(g.cUfKm as number).toBeCloseTo(res.cUfKm, 12)
  })

  it('ε₁r₀ = ε₂r₁ = ε₃r₂ gives equal maximum stresses in every layer — and a lower peak than one dielectric of ε₁', () => {
    const r = 1
    const eps = [5, 4, 3]
    const radii = [r, ...equalPeakRadii(r, eps), 2.5]
    expect(radii[1]).toBeCloseTo(1.25, 12)
    expect(radii[2]).toBeCloseTo(5 / 3, 12)
    const g = ok(capacitanceGraded(66, radii, eps))
    const peaks = g.layers.map((l) => l.gMax)
    for (const p of peaks) expect(rel(p, peaks[0])).toBeLessThan(1e-12)
    const plain = ok(capacitanceGraded(66, [1, 2.5], [5]))
    expect(g.peak).toBeLessThan(plain.peak)
  })

  it('intersheath grading: layer stresses from ΔV/(x ln), voltages add to V, equal-peak potentials equalise the maxima', () => {
    const radii = [1, 1.6, 2.5]
    const pots = intersheathEqualPeak(66, radii)
    expect(pots).toHaveLength(1)
    const g = intersheathGraded(66, radii, pots)
    expect(g.ok).toBe(true)
    if (!g.ok) return
    expect(rel(g.layers[0].gMax, g.layers[1].gMax)).toBeLessThan(1e-12)
    expect(g.layers[0].vKv + g.layers[1].vKv).toBeCloseTo(66, 12)
    // hand: G = V / (r0 ln(r1/r0) + r1 ln(r2/r1))
    const G = 66 / (1 * Math.log(1.6) + 1.6 * Math.log(2.5 / 1.6))
    expect(g.layers[0].gMax).toBeCloseTo(G, 10)
    expect(g.peak).toBeLessThan(stressAt(66, 1, 1, 2.5))
    expect(rel(gradedVoltageByIntegration(g), 66)).toBeLessThan(1e-6)
    // three layers too
    const r3 = [1, 1.4, 1.9, 2.5]
    const p3 = intersheathEqualPeak(66, r3)
    const g3 = intersheathGraded(66, r3, p3)
    expect(g3.ok).toBe(true)
    if (g3.ok) for (const l of g3.layers) expect(rel(l.gMax, g3.layers[0].gMax)).toBeLessThan(1e-12)
  })

  it('the graded stress profile matches the layer formulas (and the jumps sit at the boundaries)', () => {
    const g = ok(capacitanceGraded(66, [1, 1.5, 2.5], [4, 2.5]))
    const pts = gradedProfile(g, 10)
    expect(pts[0][1]).toBeCloseTo(g.layers[0].gMax, 12)
    expect(pts[10][1]).toBeCloseTo(g.layers[0].gMin, 12)
    expect(pts[11][1]).toBeCloseTo(g.layers[1].gMax, 12)
    expect(gradedStressAt(g, 1.2)).toBeCloseTo(g.kKv! / (4 * 1.2), 12)
  })

  it('invalid grading inputs are refused', () => {
    expect(capacitanceGraded(66, [1, 3, 2.5], [4, 3]).ok).toBe(false)
    expect(capacitanceGraded(66, [1, 1.5, 2.5], [4, 0.5]).ok).toBe(false)
    expect(intersheathGraded(66, [1, 1.5, 2.5], [70]).ok).toBe(false)
    expect(intersheathGraded(66, [1, 1.5, 2.5], [-1]).ok).toBe(false)
  })
})

// ── three-core belted cable ─────────────────────────────────────────────────────────────────────────────────

describe('three-core belted cable', () => {
  it('C_s = C₁/3, C_c = (C₂ − C_s)/2, C_n = C_s + 3C_c — equal to q/V of a core with balanced phase voltages (matrix)', () => {
    const rand = rng(11)
    for (let t = 0; t < 100; t++) {
      const cs = 0.05 + rand()
      const cc = 0.01 + rand()
      // synthesise the two measurements from the matrix (independent of the formulas under test)
      const m1 = 3 * cs // all cores at 1 V: total charge 3(cs+2cc) − 6cc
      const m2 = cs + 2 * cc // core a at 1 V, others at 0: charge on a
      const b = beltedFromMeasurements(m1, m2)
      expect(b.ok).toBe(true)
      if (!b.ok) continue
      expect(b.cs).toBeCloseTo(cs, 12)
      expect(b.cc).toBeCloseTo(cc, 12)
      const q = beltedByMatrix(cs, cc)
      expect(rel(q.re, b.cn)).toBeLessThan(1e-12)
      expect(Math.abs(q.im)).toBeLessThan(1e-12)
    }
  })
  it('charging current ω C_n V_LL/√3, and impossible measurements are refused', () => {
    expect(beltedCharging(1, 11, 50)).toBeCloseTo(2 * Math.PI * 50 * 1e-6 * (11000 / Math.sqrt(3)), 12)
    expect(beltedFromMeasurements(0.9, 0.3).ok).toBe(false)
    expect(beltedFromMeasurements(-1, 0.3).ok).toBe(false)
    const z = sub(beltedByMatrix(0.3, 0), C(0.3))
    expect(Math.hypot(z.re, z.im)).toBeLessThan(1e-12)
  })
})

// ── cable versus overhead line ──────────────────────────────────────────────────────────────────────────────

describe('cable versus Module 8’s overhead line', () => {
  it('uses Module 8’s computed line, not typed-in numbers', () => {
    const d = presetDesign('horizontal')
    const line = computeLine(d.geometry, d.options)
    expect(line.ok).toBe(true)
    if (!line.ok) return
    const res = solve()
    const cmp = compareWithLine(res)
    expect(cmp.cLine).toBe(line.cNfKm)
    expect(cmp.zcLine).toBe(line.zcOhm)
    expect(overheadLine().cNfKm).toBe(line.cNfKm)
    expect(cmp.cRatio).toBeCloseTo((res.cUfKm * 1000) / line.cNfKm, 12)
    // same voltage, same length: the charging-current ratio is the capacitance ratio
    expect(cmp.icCableTotal / cmp.icLineTotal).toBeCloseTo(cmp.cRatio, 10)
    expect(cmp.cRatio).toBeGreaterThan(1)
    expect(cmp.zcCable).toBeLessThan(cmp.zcLine)
    // the line's wave speed is (just under) the speed of light: Module 8's L and C are consistent
    expect(cmp.speedLine).toBeLessThan(299.8)
    expect(cmp.speedLine).toBeGreaterThan(250)
    expect(criticalLength(1000, res.icAKm)).toBeCloseTo(1000 / res.icAKm, 12)
  })
})

// ── verify checks and words ─────────────────────────────────────────────────────────────────────────────────

describe('Verify checks hold for every valid input', () => {
  it('random sampling over the slider ranges, plus the edges: no ✗', () => {
    const rand = rng(42)
    const cases: CableInput[] = Array.from({ length: 300 }, () => randomCable(rand))
    cases.push(
      { ...DEFAULT_CABLE, rMm: 2, RMm: 80 },
      { ...DEFAULT_CABLE, rMm: 40, RMm: 40.5 },
      { ...DEFAULT_CABLE, rMm: 2, RMm: 2.5 },
      { ...DEFAULT_CABLE, vKv: 1, epsR: 1 },
      { ...DEFAULT_CABLE, vKv: 130, epsR: 8 },
    )
    for (const c of cases) {
      const res = computeCable(c)
      expect(res.ok).toBe(true)
      if (!res.ok) continue
      for (const g of [RANGE.gPerm[0], G_PERM_DEFAULT, RANGE.gPerm[1], 10 + rand() * 190]) {
        const ch = verifyChecks(res, g)
        for (const [id, x] of Object.entries(ch)) expect(x.ok, `${id} ${JSON.stringify(c)} G=${g}: ${x.rel}`).toBe(true)
      }
    }
  })

  it('words come from the numbers', () => {
    expect(changeWords(110, 100)).toBe('rises by 10.0 %')
    expect(changeWords(63.1, 100)).toBe('falls by 36.9 %')
    expect(changeWords(100, 100)).toBe('does not change')
    expect(timesWords(12.5)).toBe('about 13 times')
    expect(timesWords(3.04)).toBe('about 3.0 times')
    expect(timesWords(1.02)).toMatch(/about the same/)
  })

  it('the colour scale runs 0 → G and flags anything above G', () => {
    expect(stressCss(0)).toBe('#2b4c8c')
    expect(stressCss(1)).toBe('#f07b2c')
    expect(stressCss(1.2)).toBe('#ff4d7a')
    for (const f of [0, 0.2, 0.5, 0.9, 1]) for (const v of stressRgb(f)) expect(v >= 0 && v <= 1).toBe(true)
  })

  it('Simpson’s rule integrates a polynomial exactly', () => {
    expect(simpson((x) => x ** 3 - 2 * x, 0, 2, 10)).toBeCloseTo(0, 12)
  })
})

describe('the Explore grading design (Verify block 6) holds for every valid grading', () => {
  it('random cables and gradings of both kinds: voltages add to V and the numerical integral agrees (no ✗)', () => {
    const rand = rng(99)
    let valid = 0
    for (let t = 0; t < 300; t++) {
      const res = computeCable(randomCable(rand))
      if (!res.ok) continue
      const n = (rand() < 0.5 ? 2 : 3) as 2 | 3
      const b = [rand(), rand()].sort((x, y) => x - y)
      const st: GradingState = {
        kind: rand() < 0.5 ? 'capacitance' : 'intersheath',
        n,
        bounds: b,
        eps: [1 + rand() * 7, 1 + rand() * 7, 1 + rand() * 7],
        inter: [rand(), rand()].sort((x, y) => y - x),
      }
      const g = gradingOutcome(res, st)
      if (!g.ok) continue
      valid++
      expect(
        rel(
          g.layers.reduce((s, l) => s + l.vKv, 0),
          res.c.vKv,
        ),
      ).toBeLessThan(1e-9)
      expect(rel(gradedVoltageByIntegration(g), res.c.vKv)).toBeLessThan(1e-6)
      // the equal-peak button, where possible, really equalises the peaks
      const eq = equalPeakState(res, st)
      if (eq.ok) {
        const ge = gradingOutcome(res, eq.state)
        expect(ge.ok).toBe(true)
        if (ge.ok) expect(peaksEqual(ge, 1e-9)).toBe(true)
      }
    }
    expect(valid).toBeGreaterThan(100)
  })
})

// ── experiments ─────────────────────────────────────────────────────────────────────────────────────────────

describe('experiments', () => {
  it('every experiment runs, decides its answer from the computation, and the answer is one of its options', () => {
    expect(EXPERIMENTS.length).toBeGreaterThanOrEqual(5)
    for (const e of EXPERIMENTS) {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      for (const row of r.rows) {
        expect(Number.isFinite(row.before)).toBe(true)
        expect(Number.isFinite(row.after)).toBe(true)
      }
      for (const s of r.explain) expect(s).not.toMatch(/NaN|undefined|Infinity/)
    }
  })
  it('the expected physics: thicker insulation lowers g_max by less than half; ε_r leaves the stress unchanged; grading lowers the peak', () => {
    const by = (id: string) => EXPERIMENTS.find((e) => e.id === id)!.run()
    expect(by('thickness').answer).toBe('less')
    expect(by('conductor').answer).toBe('dip')
    expect(by('permittivity').answer).toBe('c-up')
    expect(by('grading').answer).toBe('down')
    expect(by('vs-line').answer).not.toBe('same')
    expect(by('length').answer).toBe('down')
  })
})

describe('meta', () => {
  it('is complete', () => {
    expect(meta.id).toBe('cables')
    expect(meta.learn.length).toBeGreaterThanOrEqual(3)
    expect(meta.learn.length).toBeLessThanOrEqual(5)
    expect(meta.activities.length).toBeGreaterThanOrEqual(5)
    expect(meta.activities.length).toBeLessThanOrEqual(6)
    expect(new Set(meta.activities.map((a) => a.id)).size).toBe(meta.activities.length)
  })
})
