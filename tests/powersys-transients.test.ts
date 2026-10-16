import { describe, expect, it } from 'vitest'
import { computeLine, EPS0, MU0, presetDesign } from '../src/powersys/modules/line-params/calc.ts'
import { bergeronGrid, gridForModel, gridSeparation } from '../src/powersys/modules/transients/bergeron.ts'
import { EXPERIMENTS } from '../src/powersys/modules/transients/experiments.ts'
import { meta } from '../src/powersys/modules/transients/meta.ts'
import { PRACTICE } from '../src/powersys/modules/transients/practiceData.ts'
import { verifyChecks } from '../src/powersys/modules/transients/verify.ts'
import {
  analyse,
  arrivalRatio,
  C_LIGHT,
  CABLE_TYPICAL,
  convergence,
  endResponse,
  firstPeak,
  fitImpulse,
  gammaIOf,
  gammaOf,
  impulseTimes,
  latticeSegments,
  latticeSum,
  LI_FIT,
  makeField,
  margin,
  maxAbs,
  MEDIA,
  MODEL0,
  PU_KV,
  powerSplit,
  profile,
  separationFormula,
  separationRun,
  steadyState,
  surgeValue,
  tauIOf,
  tauOf,
  validate,
  type Analysis,
  type SurgeKind,
  type Termination,
  type WaveModel,
} from '../src/powersys/modules/transients/waves.ts'

/** Both the lattice/wave solution and the Courant-1 characteristic grid are exact for a lossless line: rounding only. */
const EXACT_KV = 1e-6

function an(m: Partial<WaveModel>): Analysis {
  const r = analyse({ ...MODEL0, ...m })
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join(' '))
  return r
}

/** A small deterministic random generator (so failures are reproducible). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const TERMS: Termination[] = ['open', 'short', 'matched', 'resistor', 'junction']

// ── the media ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('line and cable constants', () => {
  it('the overhead presets use Module 8’s computed L and C: Z_c = √(L/C), v = 1/√(LC)', () => {
    for (const [id, n] of [
      ['ohl-twin', 2],
      ['ohl-single', 1],
    ] as const) {
      const d = presetDesign('horizontal', 11, 15, { n })
      const r = computeLine(d.geometry, d.options)
      if (!r.ok) throw new Error('preset invalid')
      const L = r.lMhKm * 1e-6
      const C = r.cNfKm * 1e-12
      expect(MEDIA[id].zc).toBeCloseTo(Math.sqrt(L / C), 9)
      expect(MEDIA[id].v * 1e6).toBeCloseTo(1 / Math.sqrt(L * C), 0)
      // an overhead line travels a little slower than light (internal inductance), never faster
      expect(MEDIA[id].v).toBeLessThan(C_LIGHT)
      expect(MEDIA[id].v).toBeGreaterThan(0.95 * C_LIGHT)
    }
  })
  it('the cable: Z_c = (1/2π)·√(μ₀/ε₀ε_r)·ln(R/r) and v = c/√ε_r (coaxial, independent closed forms)', () => {
    const { epsR, rcMm, riMm } = CABLE_TYPICAL
    const zc = (1 / (2 * Math.PI)) * Math.sqrt(MU0 / (EPS0 * epsR)) * Math.log(riMm / rcMm)
    expect(MEDIA.cable.zc).toBeCloseTo(zc, 9)
    expect(MEDIA.cable.v).toBeCloseTo(C_LIGHT / Math.sqrt(epsR), 3)
    expect(MEDIA.cable.zc).toBeLessThan(MEDIA['ohl-twin'].zc / 4)
  })
})

// ── coefficients ───────────────────────────────────────────────────────────────────────────────────────────────

describe('reflection and transmission coefficients', () => {
  it('match the closed forms for open, short, matched and random loads', () => {
    expect(gammaOf(Infinity, 300)).toBe(1)
    expect(gammaOf(0, 300)).toBe(-1)
    expect(gammaOf(300, 300)).toBe(0)
    expect(tauOf(Infinity, 300)).toBe(2)
    expect(tauOf(0, 300)).toBe(0)
    const r = rng(1)
    for (let k = 0; k < 200; k++) {
      const zc = 20 + 600 * r()
      const zl = 5000 * r()
      const g = (zl - zc) / (zl + zc)
      expect(gammaOf(zl, zc)).toBeCloseTo(g, 12)
      expect(tauOf(zl, zc)).toBeCloseTo((2 * zl) / (zl + zc), 12)
      expect(gammaIOf(zl, zc)).toBeCloseTo(-g, 12)
      expect(tauIOf(zl, zc)).toBeCloseTo((2 * zc) / (zl + zc), 12)
      // the transmitted current is the end voltage divided by the load
      const a = 100
      if (zl > 0) expect(((tauOf(zl, zc) * a) / zl) * zc).toBeCloseTo(tauIOf(zl, zc) * a, 9)
    }
  })
  it('conserves power at a resistive end: 1/Z_c = Γ²/Z_c + τ²/Z_L', () => {
    const r = rng(2)
    for (let k = 0; k < 100; k++) {
      const zc = 20 + 600 * r()
      const zl = 1 + 5000 * r()
      const p = powerSplit(zl, zc)
      expect(p.reflected + p.absorbed).toBeCloseTo(p.incident, 12)
    }
    expect(powerSplit(Infinity, 300).reflected).toBeCloseTo(1 / 300, 15)
  })
})

// ── boundary conditions in the solution ────────────────────────────────────────────────────────────────────────

describe('the end conditions and single waves, against the independent grid and hand formulas', () => {
  it('the far-end voltage and currents of the solution equal the Bergeron grid’s; the grid satisfies v = Z_L·i (open: i = 0, short: v = 0)', () => {
    for (const term of TERMS)
      for (const surge of ['step', 'impulse', 'ramp', 'switching'] as SurgeKind[])
        for (const arrester of [false, true]) {
          const a = an({ term, surge, rs: 120, arrester, vres: 900, ekv: 1500 })
          const f = makeField(a)
          const N = 80
          const g = gridForModel(a, N, [N])
          g.t.forEach((t, s) => {
            const e = f.end(t)
            const gi = g.i[N][s]
            const gArr = g.iArr[N]?.[s] ?? 0
            const gLoad = gi - gArr
            expect(Math.abs(e.v - g.v[N][s])).toBeLessThan(EXACT_KV)
            expect(Math.abs(e.iLine - gi)).toBeLessThan(1e-6 * Math.max(1, Math.abs(gi)))
            expect(Math.abs(e.iArr - gArr)).toBeLessThan(1e-6 * Math.max(1, Math.abs(gArr)))
            if (term === 'open') expect(Math.abs(gLoad)).toBeLessThan(1e-9)
            else if (term === 'short') expect(Math.abs(g.v[N][s])).toBeLessThan(1e-9)
            else expect(Math.abs(g.v[N][s] - (gLoad / 1000) * a.zl)).toBeLessThan(1e-6 * Math.max(1, Math.abs(g.v[N][s])))
            if (arrester) expect(Math.abs(g.v[N][s])).toBeLessThanOrEqual(900 + 1e-9)
          })
          // the first arrival by hand: v = τ·k·e(T/2) (capped at V_res), i = (2a − v)/Z_c
          const aH = a.k * surgeValue(surge, 1500, a.model.steep, 0.5 * a.T)
          const vLin = (1 + gammaOf(a.zl, a.zc)) * aH
          const vH = arrester && Math.abs(vLin) > 900 ? Math.sign(vLin) * 900 : vLin
          const k = Math.round(1.5 * N)
          expect(Math.abs(g.v[N][k] - vH)).toBeLessThan(EXACT_KV)
          expect(Math.abs(g.i[N][k] - ((2 * aH - vH) / a.zc) * 1000)).toBeLessThan(1e-6 * Math.max(1, Math.abs(g.i[N][k])))
        }
  })
  it('a single travelling wave: the grid gives v = k·e(t − x/v) and i = v/Z_c (current positive in its direction of travel)', () => {
    for (const line of ['ohl-twin', 'ohl-single', 'cable'] as const)
      for (const surge of ['step', 'impulse', 'ramp'] as SurgeKind[]) {
        const a = an({ line, rs: 37, surge })
        const N = 100
        const g = gridForModel(a, N, [25])
        for (const s of [30, 50, 99]) {
          const vH = a.k * surgeValue(surge, a.model.ekv, a.model.steep, g.t[s] - 0.25 * a.T)
          expect(Math.abs(g.v[25][s] - vH)).toBeLessThan(EXACT_KV)
          expect(Math.abs(g.i[25][s] - (vH / a.zc) * 1000)).toBeLessThan(1e-6 * Math.max(1, Math.abs(vH)))
        }
        // after the reflection passes x, i = (v_fwd − v_bwd)/Z_c: the backward wave carries a negative +x current
        const f = makeField(a)
        const x = 0.9 * a.lengthM
        const t = 1.2 * a.T
        expect(f.R(t - 0.1 * a.T)).toBeCloseTo(a.gammaL * f.F(t - 1.1 * a.T), 9)
        expect((f.i(x, t) * a.zc) / 1000).toBeCloseTo(f.F(t - 0.9 * a.T) - f.R(t - 0.1 * a.T), 6)
      }
  })
})

// ── the lattice against an independent time-domain method ──────────────────────────────────────────────────────

describe('lattice vs the method of characteristics (Bergeron grid)', () => {
  it(`agree at every grid point within ${EXACT_KV} kV for step, impulse and ramp surges and resistive ends (random inputs)`, () => {
    const r = rng(3)
    for (let k = 0; k < 24; k++) {
      const term = TERMS[k % TERMS.length]
      const surge = (['step', 'impulse', 'ramp'] as SurgeKind[])[k % 3]
      const a = an({
        term,
        surge,
        rs: Math.round(2000 * r()),
        rl: 5 + Math.round(4000 * r()),
        lengthKm: 0.5 + Math.round(195 * r()) / 10,
        line: (['ohl-twin', 'ohl-single', 'cable'] as const)[k % 3],
        ekv: 50 + 2000 * r(),
        steep: 100 + 3000 * r(),
      })
      const N = 100
      const nodes = [0, 10, 37, 50, 100]
      const g = gridForModel(a, N, nodes)
      let worst = 0
      g.t.forEach((t, s) => {
        for (const j of nodes) {
          const x = (a.lengthM * j) / N
          worst = Math.max(worst, Math.abs(latticeSum(a, x, t).v - g.v[j][s]))
        }
      })
      expect(worst).toBeLessThan(EXACT_KV)
    }
  })
  it('the lattice sum and the wave-function recursion are the same solution', () => {
    const r = rng(4)
    for (let k = 0; k < 10; k++) {
      const a = an({ term: TERMS[k % 5], surge: (['step', 'impulse', 'ramp'] as SurgeKind[])[k % 3], rs: 1000 * r() })
      const f = makeField(a)
      for (let s = 0; s < 200; s++) {
        const x = a.lengthM * r()
        const t = a.window * r()
        expect(latticeSum(a, x, t).v).toBeCloseTo(f.v(x, t), 6)
      }
    }
  })
  it('the lattice segments carry Γ_L(Γ_sΓ_L)ⁿ and the step values add up to the end voltages', () => {
    const a = an({ term: 'resistor', rl: 1500, rs: 100 })
    const f = makeField(a)
    const segs = latticeSegments(f)
    expect(segs.length).toBe(8)
    for (const s of segs) {
      const mult = s.dir === 'fwd' ? a.rho ** s.n : a.gammaL * a.rho ** s.n
      expect(s.mult).toBeCloseTo(mult, 12)
      expect(s.value).toBeCloseTo(mult * a.k * a.model.ekv, 6)
    }
    // the end voltage after the (2n+1)-th travel time = the sum of all waves that reached it
    let sum = 0
    for (let n = 0; n < 4; n++) {
      sum += segs.filter((s) => s.n === n).reduce((acc, s) => acc + (s.value ?? 0), 0)
      expect(f.v(a.lengthM, (2 * n + 2) * a.T)).toBeCloseTo(sum, 6)
    }
  })
})

// ── steady state ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the DC steady state (closed form) and convergence', () => {
  it('E·Z_L/(R_s + Z_L) equals the infinite lattice sum (1 + Γ_L)kE/(1 − Γ_sΓ_L)', () => {
    const r = rng(5)
    for (let k = 0; k < 100; k++) {
      const a = an({ term: TERMS[k % 5], rs: 1 + 1999 * r(), rl: 5 + 4000 * r() })
      const ss = steadyState(a)
      if (ss.kind !== 'value') throw new Error('expected a value')
      expect(ss.v).toBeCloseTo(((1 + a.gammaL) * a.k * a.model.ekv) / (1 - a.rho), 6)
    }
  })
  it('the far end after n round trips is V_final(1 − ρⁿ⁺¹): it approaches but does not equal the final value', () => {
    const a = an({ term: 'open', rs: 50 })
    const f = makeField(a)
    const ss = steadyState(a)
    if (ss.kind !== 'value') throw new Error('expected a value')
    for (const c of convergence(f, 8)) {
      expect(c.v).toBeCloseTo(ss.v * (1 - a.rho ** (c.n + 1)), 6)
      expect(Math.abs(c.err!)).toBeGreaterThan(0)
    }
    // late time on the independent grid, far beyond the window shown: converges to the closed form
    const g = bergeronGrid({ n: 50, dx: a.lengthM / 50, zc: a.zc, v: a.line.v, e: () => 1000, rs: 50, zl: Infinity, steps: 50 * 200, record: [50] })
    expect(g.v[50][g.v[50].length - 1]).toBeCloseTo(ss.v, 6)
  })
  it('no steady state when R_s = 0 with an open or shorted end (|Γ_sΓ_L| = 1); an impulse decays', () => {
    expect(steadyState(an({ rs: 0, term: 'open' })).kind).toBe('none')
    expect(steadyState(an({ rs: 0, term: 'short' })).kind).toBe('none')
    expect(steadyState(an({ surge: 'impulse' })).kind).toBe('decays')
    expect(steadyState(an({ surge: 'switching', rs: 10 })).kind).toBe('value')
  })
  it('the first peak is measured over a fixed interval (first arrival to the first re-reflection): not the run length', () => {
    const a = an({ term: 'open', rs: 10, surge: 'switching', lengthKm: 20 })
    const f = makeField(a)
    const p = firstPeak(f, a.lengthM)
    expect(p.v / PU_KV).toBeCloseTo(2 * a.k, 6)
    // a longer time window (a longer line has a longer window, same ratio) does not change the ratio of the first peak
    const b = an({ term: 'open', rs: 10, surge: 'switching', lengthKm: 10 })
    expect(firstPeak(makeField(b), b.lengthM).v).toBeCloseTo(p.v, 6)
  })
})

// ── arrester ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('the arrester (ideal clamp)', () => {
  it('the end never exceeds V_res, in the solution and on the independent grid, and the two agree', () => {
    for (const term of ['open', 'resistor', 'matched', 'junction'] as Termination[])
      for (const surge of ['step', 'impulse', 'ramp'] as SurgeKind[]) {
        const a = an({ term, surge, arrester: true, vres: 700, ekv: 1500, rl: 2000, rs: 30 })
        const f = makeField(a)
        const g = gridForModel(a, 100, [100])
        let clamped = false
        g.t.forEach((t, s) => {
          const v = f.v(a.lengthM, t)
          expect(Math.abs(v)).toBeLessThanOrEqual(700 + 1e-9)
          expect(Math.abs(g.v[100][s])).toBeLessThanOrEqual(700 + 1e-9)
          expect(Math.abs(v - g.v[100][s])).toBeLessThan(EXACT_KV)
          if (f.end(t).clamped) clamped = true
        })
        if (term === 'open') expect(clamped).toBe(true)
      }
  })
  it('the arrester current balances the end: i_line = i_load + i_arrester, and is zero below V_res', () => {
    const a = an({ term: 'resistor', rl: 2000, arrester: true, vres: 900 })
    for (const inc of [100, 300, 600, 800]) {
      const e = endResponse(a, inc)
      expect(e.iLine).toBeCloseTo(e.iLoad + e.iArr, 6)
      if (Math.abs((1 + a.gammaL) * inc) <= 900) expect(e.iArr).toBe(0)
      else expect(e.v).toBe(900)
    }
  })
})

// ── surge shapes ───────────────────────────────────────────────────────────────────────────────────────────────

describe('surge shapes', () => {
  it('the fitted double exponential has a 1.2 µs front and a 50 µs tail (times found by an independent scan)', () => {
    const { alpha, beta } = LI_FIT
    const w = (t: number) => Math.exp(-alpha * t) - Math.exp(-beta * t)
    let pk = 0
    for (let t = 0; t < 10; t += 1e-4) pk = Math.max(pk, w(t))
    const first = (lvl: number) => {
      for (let t = 0; t < 10; t += 1e-5) if (w(t) >= lvl * pk) return t
      return NaN
    }
    const t30 = first(0.3)
    const t90 = first(0.9)
    let t50 = NaN
    for (let t = 5; t < 200; t += 1e-4)
      if (w(t) <= 0.5 * pk) {
        t50 = t
        break
      }
    const T1 = (t90 - t30) / 0.6
    const T2 = t50 - (t30 - 0.3 * T1)
    expect(T1).toBeCloseTo(1.2, 3)
    expect(T2).toBeCloseTo(50, 2)
    expect(surgeValue('impulse', 1000, 0, LI_FIT.times.tPeak)).toBeCloseTo(1000, 9)
  })
  it('the fit converges near the standard shape (1.2/50, 1/50 and 1.5/40 µs)', () => {
    for (const [T1, T2] of [
      [1.2, 50],
      [1, 50],
      [1.5, 40],
    ]) {
      const f = fitImpulse(T1, T2)
      const t = impulseTimes(f.alpha, f.beta)
      expect(t.front).toBeCloseTo(T1, 6)
      expect(t.tail).toBeCloseTo(T2, 6)
    }
  })
  it('step, ramp and switching sources: zero before t = 0, the right values after', () => {
    expect(surgeValue('step', 500, 0, -1)).toBe(0)
    expect(surgeValue('step', 500, 0, 3)).toBe(500)
    expect(surgeValue('ramp', 800, 1000, 0.5)).toBe(500)
    expect(surgeValue('ramp', 800, 1000, 5)).toBe(800)
    expect(surgeValue('switching', 0, 0, 1)).toBeCloseTo((Math.SQRT2 * 400) / Math.sqrt(3), 9)
  })
  it('energising an open line from a stiff source approaches 2 pu (lossless)', () => {
    const a = an({ surge: 'switching', term: 'open', rs: 0.5, lengthKm: 20 })
    const f = makeField(a)
    expect(firstPeak(f, a.lengthM).v / PU_KV).toBeGreaterThan(1.99)
    expect(firstPeak(f, a.lengthM).v / PU_KV).toBeLessThanOrEqual(2)
  })
})

// ── insulation coordination ────────────────────────────────────────────────────────────────────────────────────

describe('separation distance and protective margin', () => {
  it('V_res + 2Sd/v agrees with the simulation (recursion and Bergeron grid) whenever its assumptions hold', () => {
    const r = rng(6)
    let tested = 0
    for (let k = 0; k < 60; k++) {
      const c = { zc: 300, v: 280 + 18 * r(), dM: 1 + Math.round(59 * r()), s: 200 + 3000 * r(), ekv: 1500 + 2500 * r(), vres: 400 + 1200 * r() }
      const fm = separationFormula(c)
      const run = separationRun(c)
      const g = gridSeparation(c, 40)
      const gMax = maxAbs(g.v[g.nodeT])
      expect(Math.abs(gMax - run.vtMax)).toBeLessThanOrEqual(2 * c.s * g.dt + run.peakTol + 1e-9)
      // the arrester terminal is always clamped
      expect(run.vaMax).toBeLessThanOrEqual(c.vres + 1e-9)
      if (fm.valid) {
        tested++
        expect(Math.abs(run.vtMax - fm.value)).toBeLessThanOrEqual(run.peakTol + 1e-9)
      } else if (2 * c.s * (c.dM / c.v) > c.vres) {
        // the reflection is not back in time: the doubling limit 2·V_res applies instead
        expect(run.vtMax).toBeLessThanOrEqual(2 * c.vres + 1e-9)
      }
    }
    expect(tested).toBeGreaterThan(20)
  })
  it('the peak does not depend on the run length (the run lasts past the crest by a whole period of the stub)', () => {
    const c = { zc: 300, v: 290, dM: 30, s: 2000, ekv: 2000, vres: 850 }
    const a = gridSeparation(c, 40)
    const b = gridSeparation(c, 40, 3 * (c.ekv / c.s + (6 * c.dM) / c.v))
    expect(maxAbs(b.v[b.nodeT])).toBeCloseTo(maxAbs(a.v[a.nodeT]), 9)
    expect(separationRun(c).vtMax).toBeCloseTo(c.vres + (2 * c.s * c.dM) / c.v, 0)
  })
  it('d = 0: the transformer sees V_res', () => {
    const c = { zc: 300, v: 290, dM: 0, s: 2000, ekv: 2000, vres: 850 }
    expect(separationRun(c).vtMax).toBe(850)
    expect(separationFormula(c).value).toBe(850)
  })
  it('protective margin = (BIL − V)/V', () => {
    expect(margin(1050, 750)).toBeCloseTo(0.4, 12)
    expect(margin(1300, 850)).toBeCloseTo(450 / 850, 12)
    expect(margin(800, 1000)).toBeLessThan(0)
  })
})

// ── units, invalid inputs, the 2D/3D profile ──────────────────────────────────────────────────────────────────

describe('units and invalid inputs', () => {
  it('travel time T [µs] = ℓ [m] / v [m/µs]; currents in A = kV/Ω × 1000', () => {
    const a = an({ lengthKm: 3, rs: 0, term: 'matched' })
    expect(a.T).toBeCloseTo(3000 / MEDIA['ohl-twin'].v, 12)
    const f = makeField(a)
    expect(f.i(0, 0.5 * a.T)).toBeCloseTo((1000 / a.zc) * 1000, 6)
  })
  it('refuses invalid inputs with a reason and no numbers', () => {
    for (const bad of [{ lengthKm: 0 }, { lengthKm: -1 }, { rs: -5 }, { ekv: Number.NaN }, { term: 'resistor' as const, rl: 0 }, { surge: 'ramp' as const, steep: 0 }, { arrester: true, vres: -1 }]) {
      const out = analyse({ ...MODEL0, ...bad })
      expect(out.ok).toBe(false)
      expect(validate({ ...MODEL0, ...bad }).length).toBeGreaterThan(0)
    }
    expect(analyse(MODEL0).ok).toBe(true)
  })
  it('the v(x) profile (shared by the 2D snapshot and the 3D wave) is the solution itself; the front is where v/t says', () => {
    const a = an({ rs: MEDIA['ohl-twin'].zc, term: 'matched' })
    const f = makeField(a)
    const t = 0.5 * a.T
    const pts = profile(f, t, 240)
    for (const [km, v] of pts) expect(v).toBeCloseTo(f.v(km * 1000, t), 9)
    // the step front is half-way along at half the travel time
    const front = pts.find(([, v]) => v < 1)![0]
    expect(front).toBeCloseTo(a.model.lengthKm / 2, 1)
  })
  it('the arrival ratio is 1 + Γ_L for every linear end', () => {
    for (const term of TERMS) {
      const a = an({ term, rs: 200 })
      expect(arrivalRatio(makeField(a))).toBeCloseTo(1 + a.gammaL, 9)
    }
  })
})

// ── experiments and the module's description ───────────────────────────────────────────────────────────────────

describe('experiments decide their answers from the computation', () => {
  const expected: Record<string, string> = (() => {
    const zc = MEDIA['ohl-twin'].zc
    const zcab = MEDIA.cable.zc
    const nearest = (r: number) => (['0', '1', '2'] as const).reduce((b, c) => (Math.abs(Number(c) - r) < Math.abs(Number(b) - r) ? c : b))
    const sep = (d: number) => 850 + (2 * 2000 * d) / MEDIA['ohl-twin'].v
    const k = zc / (10 + zc)
    return {
      open: nearest(1 + 1),
      short: nearest(1 - 1),
      matched: nearest(1 + 0),
      cable: (2 * zcab) / (zcab + zc) < 1 ? 'down' : 'up',
      separation: sep(30) - sep(3) > 0.02 * 850 ? 'far-higher' : 'same',
      energise: 2 * k > 1.75 && 2 * k < 2.5 ? 'two' : 'other',
    }
  })()
  for (const e of EXPERIMENTS)
    it(`${e.id}: the computed answer is ${expected[e.id]}`, () => {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      expect(r.answer).toBe(expected[e.id])
      for (const row of r.rows) expect(Number.isFinite(row.value)).toBe(true)
      for (const s of r.plot.series) for (const p of s.points) expect(Number.isFinite(p[1])).toBe(true)
    })
})

describe('every Verify check holds for every valid input', () => {
  it('random models over the whole allowed range, edge values and limits: no ✗', () => {
    const r = rng(7)
    const cases: Array<[WaveModel, number]> = []
    const SURGES: SurgeKind[] = ['step', 'impulse', 'switching', 'ramp']
    for (let k = 0; k < 40; k++)
      cases.push([
        {
          line: (['ohl-twin', 'ohl-single', 'cable'] as const)[k % 3],
          lengthKm: Math.round((0.5 + 19.5 * r()) * 10) / 10,
          rs: Math.round((2000 * r()) / 5) * 5,
          term: TERMS[k % 5],
          rl: 5 + Math.round((4995 * r()) / 5) * 5,
          surge: SURGES[k % 4],
          ekv: 50 + Math.round((2950 * r()) / 50) * 50,
          steep: 50 + Math.round((4950 * r()) / 50) * 50,
          arrester: k % 3 === 0,
          vres: 100 + Math.round((2900 * r()) / 10) * 10,
        },
        Math.round(20 * r()) / 20,
      ])
    // edges: the slider limits
    for (const rs of [0, 2000]) for (const term of TERMS) for (const lengthKm of [0.5, 20]) cases.push([{ ...MODEL0, rs, term, lengthKm, rl: 5 }, rs === 0 ? 0 : 1])
    cases.push([{ ...MODEL0, arrester: true, vres: 100, ekv: 3000, surge: 'ramp', steep: 5000 }, 0.5])
    cases.push([{ ...MODEL0, arrester: true, vres: 3000, ekv: 50 }, 1])
    for (const vres of [900, 1000, 1200, 1500, 2000]) cases.push([{ ...MODEL0, rs: 0, arrester: true, vres, ekv: 1000 }, 1])
    cases.push([{ ...MODEL0, term: 'matched', rs: 50 }, 0.5])
    for (const [m, p] of cases) {
      const c = verifyChecks(m, p)
      const ok = c.coefficientsOk && c.gridOk && c.singleOk && c.steadyOk && c.sepOk && c.impulseOk
      if (!ok) throw new Error(`a check fails for ${JSON.stringify(m)} probe ${p}: ${JSON.stringify({ a: c.coefficientsOk, g: c.gridOk, gd: c.maxDiff, s: c.singleOk, ss: c.steadyOk, sep: c.sepOk })}`)
      expect(ok).toBe(true)
    }
  })
})

describe('physical data: nothing travels faster than light (LC ≥ μ₀ε₀, v ≤ c)', () => {
  it('every line preset, the practice data and the experiment data', () => {
    const mu0eps0 = MU0 * EPS0
    for (const m of Object.values(MEDIA)) {
      expect(m.lMhKm * 1e-6 * m.cNfKm * 1e-12).toBeGreaterThanOrEqual(mu0eps0)
      expect(m.v).toBeLessThanOrEqual(C_LIGHT)
    }
    const L = PRACTICE.line.lMhKm * 1e-6
    const C = PRACTICE.line.cNfKm * 1e-12
    expect(L * C).toBeGreaterThanOrEqual(mu0eps0)
    expect(1 / Math.sqrt(L * C) / 1e6).toBeLessThanOrEqual(C_LIGHT)
    expect(PRACTICE.sep.v).toBeLessThanOrEqual(C_LIGHT)
    // the separation experiment and Learn use the twin-bundle line's own velocity (checked above)
  })
})

describe('R_s = 0: the special cases of the steady state, against the solution itself', () => {
  const late = (m: Partial<WaveModel>) => {
    const a = an({ term: 'open', rs: 0, ...m })
    const f = makeField(a)
    // the far end for 200 round trips and the source current for 40 (past every transient tested)
    const ends = Array.from({ length: 400 }, (_, n) => f.v(a.lengthM, (n + 1.5) * a.T))
    const iSrc = Array.from({ length: 40 }, (_, n) => f.i(0, (2 * n + 1) * a.T))
    return { a, ss: steadyState(a), ends, iSrc }
  }
  it('no arrester, or 2E ≤ V_res: the end swings 0 ↔ 2E for ever', () => {
    for (const m of [{ arrester: false }, { arrester: true, vres: 2000 }, { arrester: true, vres: 2600 }]) {
      const { ss, ends } = late({ ekv: 1000, ...m })
      expect(ss.kind).toBe('none')
      if (ss.kind === 'none') expect(ss.swing).toEqual([0, 2000])
      const tail = ends.slice(300)
      expect(Math.min(...tail)).toBeCloseTo(0, 6)
      expect(Math.max(...tail)).toBeCloseTo(2000, 6)
    }
  })
  it('E < V_res < 2E: settles at E only when E/2 is a whole multiple of V_res − E; otherwise keeps swinging around E by the closed-form amount', () => {
    for (const vres of [1010, 1050, 1100, 1150, 1200, 1250, 1300, 1400, 1500, 1700, 1800, 1950]) {
      const { ss, ends } = late({ ekv: 1000, arrester: true, vres })
      const tail = ends.slice(300)
      // closed form, independently: settles iff E/2 is a whole multiple of V_res − E
      const ratio = 500 / (vres - 1000)
      if (Math.abs(ratio - Math.round(ratio)) < 1e-9) {
        expect(ss.kind).toBe('value')
        if (ss.kind === 'value') expect(ss.v).toBe(1000)
        for (const v of tail) expect(v).toBeCloseTo(1000, 6)
      } else {
        expect(ss.kind).toBe('none')
        if (ss.kind !== 'none') return
        expect(Math.min(...tail)).toBeCloseTo(ss.swing![0], 6)
        expect(Math.max(...tail)).toBeCloseTo(ss.swing![1], 6)
        expect((ss.swing![0] + ss.swing![1]) / 2).toBeCloseTo(1000, 9)
      }
    }
  })
  it('V_res = E: settles at E with the arrester carrying a constant current E/Z_c', () => {
    const { a, ss, ends, iSrc } = late({ ekv: 1000, arrester: true, vres: 1000 })
    expect(ss.kind).toBe('value')
    if (ss.kind === 'value') {
      expect(ss.v).toBe(1000)
      expect(ss.arresterHolds).toBe(true)
      expect(ss.iA).toBeCloseTo((1000 / a.zc) * 1000, 6)
    }
    for (const v of ends.slice(2)) expect(v).toBeCloseTo(1000, 6)
    for (const i of iSrc) expect(i).toBeCloseTo((1000 / a.zc) * 1000, 6)
  })
  it('V_res < E: the arrester current grows by 2(E − V_res)/Z_c every round trip, without limit (any non-short end)', () => {
    for (const term of ['open', 'resistor', 'matched'] as Termination[]) {
      const { a, ss, iSrc } = late({ term, ekv: 1000, arrester: true, vres: 900, rl: 2000 })
      expect(ss.kind).toBe('none')
      if (ss.kind !== 'none') return
      const step = ((2 * 100) / a.zc) * 1000
      expect(ss.growthA).toBeCloseTo(step, 9)
      for (let n = 20; n < 39; n++) expect(iSrc[n + 1] - iSrc[n]).toBeCloseTo(step, 6)
    }
  })
  it('a short with R_s = 0: the current grows by 2E/Z_c every round trip', () => {
    const { a, ss, iSrc } = late({ term: 'short', ekv: 1000, arrester: true, vres: 500 })
    expect(ss.kind).toBe('none')
    if (ss.kind === 'none') expect(ss.growthA).toBeCloseTo((2000 / a.zc) * 1000, 9)
    for (let n = 5; n < 39; n++) expect(iSrc[n + 1] - iSrc[n]).toBeCloseTo((2000 / a.zc) * 1000, 6)
  })
  it('ρ = 0 (matched end or matched source): the far end is at the final value from the first arrival on', () => {
    for (const m of [
      { term: 'matched' as Termination, rs: 50 },
      { term: 'open' as Termination, rs: MEDIA['ohl-twin'].zc },
    ]) {
      const a = an(m)
      expect(Math.abs(a.rho)).toBeLessThan(1e-12)
      for (const c of convergence(makeField(a), 8)) expect(Math.abs(c.err!)).toBeLessThan(1e-9)
    }
  })
})

describe('meta', () => {
  it('is complete: five modes, six activities, outcomes and keywords', () => {
    expect(meta.id).toBe('transients')
    expect(meta.modes).toEqual(['learn', 'explore', 'experiment', 'verify', 'practise'])
    expect(meta.activities.length).toBe(6)
    expect(meta.learn.length).toBeGreaterThanOrEqual(3)
    expect(meta.keywords).toContain('bewley lattice')
  })
})
