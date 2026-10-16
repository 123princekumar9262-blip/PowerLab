import { describe, expect, it } from 'vitest'
import { abs, add, arg, C, mul, polar, sub, type Complex } from '../src/powersys/engine/complex.ts'
import { angleToOwnVoltage, conventionGap, defaultAc, powerBalance, solveAc, superpositionVA, type AcDistributor, type AcOk } from '../src/powersys/modules/distribution/acdist.ts'
import {
  defaultDc,
  discretiseUniform,
  feedCurrentA,
  loopPerM,
  nodalDc,
  profile,
  solveDc,
  uniformDropAt,
  uniformTotalDrop,
  type DcDistributor,
  type DcOk,
  type Feed,
} from '../src/powersys/modules/distribution/distributor.ts'
import { EXPERIMENTS } from '../src/powersys/modules/distribution/experiments.ts'
import { DEFAULT_KELVIN, kelvinArea, kelvinCost, kelvinNumeric, validateKelvin, type KelvinInput } from '../src/powersys/modules/distribution/kelvin.ts'
import {
  annualCost,
  capPerPhase,
  DEFAULT_FEEDER,
  DEFAULT_PF,
  DEFAULT_TARIFF,
  economicPf,
  economicPfNumeric,
  kvarOf,
  pfCorrection,
  solveFeeder,
  type PfOk,
} from '../src/powersys/modules/distribution/pf.ts'
import { changeWords, pctWords } from '../src/powersys/modules/distribution/words.ts'

/*
 * Module 16 — Distribution Systems & Power Factor. No published numbers are typed in: every expected value is derived
 * here independently — a conductance-matrix solve written in THIS file (Gauss–Jordan, not the module's solver), the
 * closed forms of the uniformly loaded distributor and their discretised limit, complex KVL by superposition, complex
 * power balance, and numerical minimisation for Kelvin's law and the economical power factor.
 */

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b))
const ok = (r: ReturnType<typeof solveDc>): DcOk => {
  if (!r.ok) throw new Error(r.message)
  return r
}
const okAc = (r: ReturnType<typeof solveAc>): AcOk => {
  if (!r.ok) throw new Error(r.message)
  return r
}
const okPf = (r: ReturnType<typeof pfCorrection>): PfOk => {
  if (!r.ok) throw new Error(r.message)
  return r
}

/** A seeded random generator (mulberry32), so the sampled cases are reproducible. */
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

/** An independent nodal solve: every node (ends + loads) an unknown, sources as fixed rows; Gauss–Jordan elimination. */
function independentNodal(d: DcDistributor): { xs: number[]; V: number[] } {
  const xs = [...new Set([0, d.L, ...d.loads.map((l) => l.x)])].sort((a, b) => a - b)
  const n = xs.length
  const rl = (2 * d.rCond) / 1000
  const inj = xs.map((x) => -d.loads.filter((l) => l.x === x).reduce((s, l) => s + l.I, 0))
  // uniform load: half of each section's current at each of its ends
  for (let k = 0; k < n - 1; k++) {
    const h = (d.i * (xs[k + 1] - xs[k])) / 2
    inj[k] -= h
    inj[k + 1] -= h
  }
  const A = xs.map(() => new Array<number>(n + 1).fill(0))
  for (let k = 0; k < n - 1; k++) {
    const g = 1 / (rl * (xs[k + 1] - xs[k]))
    A[k][k] += g
    A[k + 1][k + 1] += g
    A[k][k + 1] -= g
    A[k + 1][k] -= g
  }
  for (let k = 0; k < n; k++) A[k][n] = inj[k]
  const fix = (k: number, v: number) => {
    A[k] = new Array<number>(n + 1).fill(0)
    A[k][k] = 1
    A[k][n] = v
  }
  fix(0, d.VA)
  if (d.feed === 'both') fix(n - 1, d.VB)
  if (d.feed === 'ring') fix(n - 1, d.VA)
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]
    }
  }
  return { xs, V: A.map((row, k) => row[n] / row[k]) }
}

function randomDc(r: () => number, feed: Feed, uniform = false): DcDistributor {
  const L = 100 + Math.round(r() * 900)
  const nLoads = 1 + Math.floor(r() * 5)
  const loads = Array.from({ length: nLoads }, (_, k) => ({ id: `L${k + 1}`, x: Math.round(r() * L), I: Math.round(r() * 1000) / 10 }))
  const VA = 200 + r() * 40
  return { L, rCond: 0.02 + r() * 0.2, VA, VB: feed === 'both' ? VA - 5 + r() * 10 : VA, feed, loads, i: uniform ? r() * 0.3 : 0 }
}

// ── DC distributors ────────────────────────────────────────────────────────────────────────────────────────────

describe('DC distributor — the default case by hand', () => {
  it('fed at one end: section currents are the sums of the loads beyond; drops use the LOOP resistance', () => {
    const d = defaultDc('one')
    const r = ok(solveDc(d))
    const rl = loopPerM(d.rCond)
    expect(rl).toBeCloseTo(0.0002, 15) // 2 × 0.1 Ω/km per conductor = 0.2 Ω/km of loop
    const beyond = (x: number) => d.loads.filter((l) => l.x > x).reduce((s, l) => s + l.I, 0)
    r.sections.forEach((s) => expect(rel(s.Iin, beyond(s.x0))).toBeLessThan(1e-12))
    const drop = d.loads.reduce((s, l) => s + l.I * l.x * rl, 0) // Σ I_k · (loop R from A to the load)
    expect(rel(r.minV, d.VA - drop)).toBeLessThan(1e-12)
    expect(r.minX).toBe(350)
    expect(r.minKind).toBe('load')
  })
  it('fed at both ends with equal voltages: I_A by moments, the lowest point where the current reverses', () => {
    const d = defaultDc('both')
    const r = ok(solveDc(d))
    const IA = d.loads.reduce((s, l) => s + (l.I * (d.L - l.x)) / d.L, 0)
    expect(rel(r.IA, IA)).toBeLessThan(1e-12)
    expect(rel(r.IA + r.IB, 180)).toBeLessThan(1e-12)
    // the current reverses after the first point where the loads so far use up I_A
    let left = IA
    let at = -1
    for (const l of [...d.loads].sort((a, b) => a.x - b.x)) {
      left -= l.I
      if (left <= 0) {
        at = l.x
        break
      }
    }
    expect(r.minX).toBe(at)
  })
})

describe('DC distributor — section-current method vs an independent nodal solve', () => {
  const r = rng(16)
  for (const feed of ['one', 'both', 'ring'] as Feed[])
    for (const uniform of [false, true])
      it(`${feed}${uniform ? ' + uniform load' : ''}: node voltages and section currents agree to 1e-9 (200 random cases)`, () => {
        for (let t = 0; t < 200; t++) {
          const d = randomDc(r, feed, uniform)
          const s = solveDc(d)
          if (!s.ok) {
            expect(s.field).toBe('collapse')
            continue
          }
          const ind = independentNodal(d)
          ind.xs.forEach((x, k) => {
            const node = s.nodes.find((n) => n.x === x)!
            expect(rel(node.V, ind.V[k])).toBeLessThan(1e-9)
          })
          const mod = nodalDc(d)!
          s.sections.forEach((sec, k) => expect(Math.abs(sec.Iin - mod.Iafter[k]) / Math.max(1, s.totalLoad)).toBeLessThan(1e-9))
          expect(Math.abs(mod.IA - s.IA) / Math.max(1, s.totalLoad)).toBeLessThan(1e-9)
          expect(Math.abs(mod.IB - s.IB) / Math.max(1, s.totalLoad)).toBeLessThan(1e-9)
          // KCL overall: what the feeds supply is what the loads draw
          expect(Math.abs(s.IA + s.IB - s.totalLoad) / Math.max(1, s.totalLoad)).toBeLessThan(1e-9)
          // the drop over each section is its current × its loop resistance (uniform: mean current)
          s.sections.forEach((sec) => expect(Math.abs(sec.drop - (sec.R * (sec.Iin + sec.Iout)) / 2)).toBeLessThan(1e-9 * d.VA))
        }
      })
  it('the point of minimum potential is the node with the lowest voltage in the nodal solve (concentrated loads)', () => {
    const r2 = rng(7)
    for (let t = 0; t < 400; t++) {
      const feed = (['one', 'both', 'ring'] as Feed[])[t % 3]
      const d = randomDc(r2, feed)
      const s = solveDc(d)
      if (!s.ok) continue
      const ind = independentNodal(d)
      const vmin = Math.min(...ind.V)
      expect(rel(s.minV, vmin)).toBeLessThan(1e-9)
      // the model's point carries that lowest voltage (when several nodes tie, it is one of them)
      const k = ind.xs.indexOf(s.minX)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(rel(ind.V[k], vmin)).toBeLessThan(1e-9)
    }
  })
  it('with a uniform load the minimum may lie between nodes: no point of a fine profile is lower', () => {
    const r3 = rng(99)
    for (let t = 0; t < 100; t++) {
      const d = randomDc(r3, t % 2 ? 'both' : 'ring', true)
      const s = solveDc(d)
      if (!s.ok) continue
      for (let k = 0; k <= 2000; k++) expect(s.V((d.L * k) / 2000)).toBeGreaterThanOrEqual(s.minV - 1e-9 * d.VA)
      expect(Math.abs(s.I(s.minX - 1e-6) * s.I(s.minX + 1e-6)) < 1e-3 || s.I(s.minX - 1e-6) * s.I(s.minX + 1e-6) <= 0 || s.minKind !== 'between').toBe(true)
    }
  })
  it('the profile passes through every node voltage', () => {
    const d = { ...defaultDc('both'), i: 0.1 }
    const s = ok(solveDc(d))
    const pts = profile(d, s)
    s.nodes.forEach((n) => expect(pts.some(([x, v]) => x === n.x && Math.abs(v - n.V) < 1e-9)).toBe(true))
  })
})

describe('DC distributor — uniformly loaded', () => {
  const d: DcDistributor = { L: 500, rCond: 0.1, VA: 220, VB: 220, feed: 'one', loads: [], i: 0.4 }
  it('the drop at x is i·r·(Lx − x²/2) per loop resistance r; the total is i·r·L²/2', () => {
    const s = ok(solveDc(d))
    const rl = loopPerM(d.rCond)
    for (const x of [0, 50, 125, 250, 400, 500]) expect(rel(d.VA - s.V(x), uniformDropAt(d.i, rl, d.L, x))).toBeLessThan(1e-12)
    expect(rel(d.VA - s.minV, uniformTotalDrop(d.i, rl, d.L))).toBeLessThan(1e-12)
    // the total equals the whole load i·L acting at the MIDDLE: (i·L)·r·(L/2)
    expect(rel(uniformTotalDrop(d.i, rl, d.L), d.i * d.L * rl * (d.L / 2))).toBeLessThan(1e-12)
  })
  it('a fine discretisation converges to the closed form: error = i·r·L²/(2N), → 0 as N → ∞', () => {
    const rl = loopPerM(d.rCond)
    const exact = uniformTotalDrop(d.i, rl, d.L)
    let prev = Infinity
    for (const N of [1, 10, 100, 1000, 10000]) {
      const s = ok(solveDc(discretiseUniform(d, N)))
      const err = d.VA - s.minV - exact
      expect(rel(err, (d.i * rl * d.L * d.L) / (2 * N))).toBeLessThan(1e-9) // loads at the section ends: + i r L²/(2N)
      expect(Math.abs(err)).toBeLessThan(prev)
      prev = Math.abs(err)
    }
    expect(rel(prev / exact, 1e-4)).toBeLessThan(1e-9) // relative error 1/N at N = 10 000
  })
  it('the same total load at the far end drops twice as much (ratio ½)', () => {
    const rl = loopPerM(d.rCond)
    const far = ok(solveDc({ ...d, i: 0, loads: [{ id: 'F', x: d.L, I: d.i * d.L }] }))
    const uni = ok(solveDc(d))
    expect(rel((d.VA - uni.minV) / (d.VA - far.minV), 0.5)).toBeLessThan(1e-12)
    expect(rel(d.VA - far.minV, d.i * d.L * rl * d.L)).toBeLessThan(1e-12)
  })
  it('fed at both ends with equal voltages, uniform load only: the lowest point is the middle, drop i·r·L²/8', () => {
    const s = ok(solveDc({ ...d, feed: 'both' }))
    const rl = loopPerM(d.rCond)
    expect(Math.abs(s.minX - d.L / 2)).toBeLessThan(1e-9)
    expect(rel(d.VA - s.minV, (d.i * rl * d.L * d.L) / 8)).toBeLessThan(1e-12)
  })
})

describe('DC distributor — ring main and unequal feeding voltages', () => {
  it('a ring main is the same as fed at both ends with equal voltages', () => {
    const a = ok(solveDc(defaultDc('ring')))
    const b = ok(solveDc({ ...defaultDc('both'), VB: 220 }))
    a.nodes.forEach((n, k) => expect(n.V).toBeCloseTo(b.nodes[k].V, 12))
    expect(a.minX).toBe(b.minX)
  })
  it('raising V_B moves the lowest point towards A, and I_A follows (V_A − V_B)/R_total', () => {
    const base = defaultDc('both')
    const lo = ok(solveDc(base))
    const hi = ok(solveDc({ ...base, VB: 223 }))
    expect(hi.minX).toBeLessThanOrEqual(lo.minX)
    expect(rel(lo.IA - hi.IA, 3 / (loopPerM(base.rCond) * base.L))).toBeLessThan(1e-12)
    expect(rel(feedCurrentA({ ...base, VB: 223 }), hi.IA)).toBeLessThan(1e-12)
  })
  it('a much higher V_B makes A receive current, and the lowest point is A itself', () => {
    const s = ok(solveDc({ ...defaultDc('both'), VB: 240 }))
    expect(s.IA).toBeLessThan(0)
    expect(s.minKind).toBe('A')
    expect(s.minV).toBe(220)
  })
  it('the conductor loss equals Σ I²R of the sections (concentrated loads)', () => {
    const s = ok(solveDc(defaultDc('both')))
    const byHand = s.sections.reduce((t, sec) => t + sec.Iin * sec.Iin * sec.R, 0)
    expect(rel(s.loss, byHand)).toBeLessThan(1e-12)
  })
})

describe('DC distributor — the practice case with unequal end voltages', () => {
  it('230 V / 226 V: the minimum is at a load, found where the current reverses, and matches the nodal solve', () => {
    const d: DcDistributor = {
      L: 500,
      rCond: 0.05,
      VA: 230,
      VB: 226,
      feed: 'both',
      i: 0,
      loads: [
        { id: 'P', x: 100, I: 60 },
        { id: 'Q', x: 250, I: 80 },
        { id: 'R', x: 400, I: 50 },
      ],
    }
    const s = ok(solveDc(d))
    const rl = loopPerM(d.rCond)
    const IA = (d.VA - d.VB + rl * (60 * 400 + 80 * 250 + 50 * 100)) / (rl * d.L)
    expect(rel(s.IA, IA)).toBeLessThan(1e-12)
    expect(s.minKind).toBe('load')
    const ind = independentNodal(d)
    expect(rel(s.minV, Math.min(...ind.V))).toBeLessThan(1e-12)
  })
})

describe('DC distributor — invalid inputs', () => {
  it('a negative load, a load beyond the end, a zero length or resistance are refused with a reason', () => {
    const d = defaultDc('one')
    const neg = solveDc({ ...d, loads: [...d.loads, { id: 'X', x: 50, I: -10 }] })
    expect(neg.ok).toBe(false)
    expect(!neg.ok && neg.field).toBe('load')
    const far = solveDc({ ...d, L: 300 })
    expect(!far.ok && far.message).toMatch(/beyond the end/)
    expect(solveDc({ ...d, L: 0 }).ok).toBe(false)
    expect(solveDc({ ...d, rCond: 0 }).ok).toBe(false)
    expect(solveDc({ ...d, i: -1 }).ok).toBe(false)
    expect(nodalDc({ ...d, L: 300 })).toBeNull()
  })
  it('loads too heavy for the conductor: the voltage would collapse — reported, never a negative voltage', () => {
    const s = solveDc({ ...defaultDc('one'), rCond: 20 })
    expect(s.ok).toBe(false)
    expect(!s.ok && s.field).toBe('collapse')
  })
  it('no load at all: no current, no drop', () => {
    const s = ok(solveDc({ ...defaultDc('both'), loads: [] }))
    expect(s.IA).toBe(0)
    expect(s.minV).toBe(220)
  })
})

// ── AC distributor ────────────────────────────────────────────────────────────────────────────────────────────

/** Independent: V_A by complex KVL around the loop for each section, building the load currents from scratch. */
function kvlVA(d: AcDistributor, ref: 'receiving' | 'own'): Complex {
  const z = C(d.R / 1000, d.X / 1000)
  const loads = [...d.loads].sort((a, b) => b.x - a.x) // far to near
  let V = C(d.VB, 0)
  let x = d.L
  let I = C(0, 0)
  for (const l of loads) {
    V = add(V, mul(I, mul(z, C(x - l.x, 0))))
    x = l.x
    const ang = (ref === 'receiving' ? 0 : arg(V)) + (l.lag ? -1 : 1) * Math.acos(l.pf)
    I = add(I, polar(l.I, ang))
  }
  return add(V, mul(I, mul(z, C(x, 0))))
}

describe('AC distributor — power factors referred to V_B or to the load voltages', () => {
  const r = rng(5)
  const randomAc = (): AcDistributor => {
    const L = 200 + r() * 1800
    return {
      L,
      R: 0.05 + r() * 0.5,
      X: r() * 0.5,
      VB: 200 + r() * 40,
      loads: Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => ({ id: `${k}`, x: Math.round(r() * L), I: r() * 100, pf: 0.5 + r() * 0.5, lag: r() < 0.8 })),
    }
  }
  it('both conventions agree with complex KVL section by section and with superposition (300 random cases)', () => {
    for (let t = 0; t < 300; t++) {
      const d = randomAc()
      for (const ref of ['receiving', 'own'] as const) {
        const s = okAc(solveAc(d, ref))
        const kvl = kvlVA(d, ref)
        expect(abs(sub(s.VA, kvl)) / d.VB).toBeLessThan(1e-9)
        expect(abs(sub(s.VA, superpositionVA(d, s))) / d.VB).toBeLessThan(1e-9)
        const bal = powerBalance(d, s)
        const tot = add(bal.loads, bal.losses)
        expect(abs(sub(bal.sending, tot)) / Math.max(1, abs(bal.sending))).toBeLessThan(1e-9)
      }
      // convention (b): every load current lags (or leads) ITS OWN voltage by acos(pf)
      const b = okAc(solveAc(d, 'own'))
      angleToOwnVoltage(d, b).forEach((a, j) => expect(Math.abs(a - ((d.loads[j].lag ? -1 : 1) * (Math.acos(d.loads[j].pf) * 180)) / Math.PI)).toBeLessThan(1e-9))
    }
  })
  it('the default case: referring to own voltages changes V_A (both computed), and convention (a) has all currents on V_B', () => {
    const d = defaultAc()
    const g = conventionGap(d)!
    expect(Math.abs(g.dMag)).toBeGreaterThan(0)
    angleToOwnVoltage(d, g.a).forEach((a, j) => {
      // in (a) the angle to the own voltage differs from acos(pf) by that node's angle
      const k = g.a.xs.indexOf(d.loads[j].x)
      expect(Math.abs(a - (-Math.acos(d.loads[j].pf) * 180) / Math.PI + (arg(g.a.V[k]) * 180) / Math.PI)).toBeLessThan(1e-9)
    })
  })
  it('at unity power factor with R only, both conventions reduce to the DC result', () => {
    const d: AcDistributor = { ...defaultAc(), X: 0, loads: defaultAc().loads.map((l) => ({ ...l, pf: 1 })) }
    const a = okAc(solveAc(d, 'receiving'))
    const b = okAc(solveAc(d, 'own'))
    // the DC model with that sending voltage gives V_B back (R here is the loop resistance: per conductor = R/2)
    const dc = ok(solveDc({ L: d.L, rCond: d.R / 2, VA: a.VA.re, VB: 0, feed: 'one', i: 0, loads: d.loads.map((l) => ({ id: l.id, x: l.x, I: l.I })) }))
    expect(Math.abs(a.VA.im)).toBeLessThan(1e-12)
    expect(abs(sub(a.VA, b.VA))).toBeLessThan(1e-12)
    expect(rel(dc.nodes[dc.nodes.length - 1].V, d.VB)).toBeLessThan(1e-12)
  })
  it('invalid AC inputs are refused', () => {
    const d = defaultAc()
    expect(solveAc({ ...d, loads: [{ ...d.loads[0], pf: 1.2 }] }, 'own').ok).toBe(false)
    expect(solveAc({ ...d, loads: [{ ...d.loads[0], x: 2000 }] }, 'own').ok).toBe(false)
    expect(solveAc({ ...d, loads: [{ ...d.loads[0], I: -5 }] }, 'own').ok).toBe(false)
    expect(solveAc({ ...d, R: 0, X: 0 }, 'own').ok).toBe(false)
  })
})

// ── power-factor correction ───────────────────────────────────────────────────────────────────────────────────

describe('Power-factor correction', () => {
  it('complex power before and after: P unchanged, Q reduced by exactly Q_c; units kW, kVAr, kVA, A, µF', () => {
    const r = rng(3)
    for (let t = 0; t < 300; t++) {
      const pf1 = 0.4 + r() * 0.55
      const lead2 = r() < 0.2
      const pf2 = lead2 ? 0.8 + r() * 0.2 : pf1 + r() * (1 - pf1)
      const inp = { P: 10 + r() * 990, pf1, pf2, lead2, VLL: 400 + r() * 10600, f: r() < 0.5 ? 50 : 60 }
      const s = okPf(pfCorrection(inp))
      // S = P + jQ before; the bank adds −jQ_c
      const S1 = C(inp.P, s.Q1)
      const S2 = add(S1, C(0, -s.Qc))
      expect(rel(S2.re, inp.P)).toBeLessThan(1e-12)
      expect(rel(abs(S2), s.S2)).toBeLessThan(1e-9)
      expect(rel(S2.re / abs(S2), inp.pf2)).toBeLessThan(1e-9)
      expect(Math.sign(S2.im) || 1).toBe(lead2 && pf2 < 1 ? -1 : 1)
      // the capacitance really delivers Q_c, star and delta: Q = 3·V_c²·ωC
      expect(rel(kvarOf(s.Cstar, inp.VLL, inp.f, 'star'), s.Qc)).toBeLessThan(1e-9)
      expect(rel(kvarOf(s.Cdelta, inp.VLL, inp.f, 'delta'), s.Qc)).toBeLessThan(1e-9)
      if (s.Qc > 0) expect(rel(s.Cstar / s.Cdelta, 3)).toBeLessThan(1e-12)
      // line current I = S/(√3 V) in A (S in kVA)
      expect(rel(s.I1, (s.S1 * 1000) / (Math.sqrt(3) * inp.VLL))).toBeLessThan(1e-12)
      // the star capacitor's current is the bank's line current; delta: line current / √3
      expect(rel(s.IcapStar, s.IbankLine)).toBeLessThan(1e-9)
      expect(rel(s.IcapDelta * Math.sqrt(3), s.IbankLine)).toBeLessThan(1e-9)
    }
  })
  it('the default case: 0.7 → 0.95 lagging, current falls by 1 − 0.7/0.95', () => {
    const s = okPf(pfCorrection(DEFAULT_PF))
    expect(rel(s.dI, 0.7 / 0.95 - 1)).toBeLessThan(1e-12)
    expect(rel(s.Qc, 200 * (Math.sqrt(1 - 0.49) / 0.7 - Math.sqrt(1 - 0.95 ** 2) / 0.95))).toBeLessThan(1e-12)
    expect(rel(capPerPhase(s.Qc, 400, 50, 'star'), s.Cstar)).toBeLessThan(1e-12)
    // in µF: C = Q/(ω V_LL²) for star (V_ph² = V_LL²/3)
    expect(rel(s.Cstar, ((s.Qc * 1000) / (2 * Math.PI * 50 * 400 * 400)) * 1e6)).toBeLessThan(1e-12)
  })
  it('impossible targets are refused: below the initial lagging PF, out of (0, 1], bad voltage', () => {
    expect(pfCorrection({ ...DEFAULT_PF, pf2: 0.6 }).ok).toBe(false)
    expect(pfCorrection({ ...DEFAULT_PF, pf2: 1.1 }).ok).toBe(false)
    expect(pfCorrection({ ...DEFAULT_PF, pf1: 0 }).ok).toBe(false)
    expect(pfCorrection({ ...DEFAULT_PF, P: -5 }).ok).toBe(false)
    expect(pfCorrection({ ...DEFAULT_PF, VLL: 0 }).ok).toBe(false)
    const msg = pfCorrection({ ...DEFAULT_PF, pf2: 0.6 })
    expect(!msg.ok && msg.message).toMatch(/reactor/)
  })
  it('over-correction: a leading target needs a larger bank and draws more current than unity', () => {
    const u = okPf(pfCorrection({ ...DEFAULT_PF, pf2: 1 }))
    const lead = okPf(pfCorrection({ ...DEFAULT_PF, pf2: 0.9, lead2: true }))
    expect(lead.Qc).toBeGreaterThan(u.Qc)
    expect(lead.I2).toBeGreaterThan(u.I2)
  })
})

describe('Economical power factor: sin φ₂ = y/x vs numerical minimisation', () => {
  it('the closed form equals the minimum found numerically (300 random tariffs)', () => {
    const r = rng(11)
    for (let t = 0; t < 300; t++) {
      const pf1 = 0.4 + r() * 0.55
      const x = 500 + r() * 5000
      const y = r() * x * 1.2
      const tf = { x, y }
      const cf = economicPf(pf1, tf)
      const num = economicPfNumeric(100, pf1, tf)
      // the cost at the closed form is the minimum (to the search's accuracy) and the pf agrees
      expect(annualCost(100, pf1, cf.pf, tf).total).toBeLessThanOrEqual(num.cost * (1 + 1e-12) + 1e-9)
      expect(Math.abs(cf.pf - num.pf)).toBeLessThan(1e-6)
    }
  })
  it('limits: y → 0 gives unity; y/x ≥ sin φ₁ (in particular y ≥ x) gives no correction', () => {
    expect(economicPf(0.7, { x: 2400, y: 0 }).pf).toBe(1)
    expect(economicPf(0.7, { x: 2400, y: 1e-9 }).pf).toBeCloseTo(1, 12)
    expect(economicPf(0.7, { x: 2400, y: 2400 })).toMatchObject({ pf: 0.7, kind: 'none' })
    expect(economicPf(0.7, { x: 2400, y: 3000 })).toMatchObject({ pf: 0.7, kind: 'none' })
    expect(economicPf(0.7, { x: 2400, y: 2400 * Math.sqrt(1 - 0.49) })).toMatchObject({ pf: 0.7, kind: 'none' })
    expect(economicPfNumeric(100, 0.7, { x: 2400, y: 3000 }).pf).toBeCloseTo(0.7, 9)
  })
  it('the default illustrative tariff: y/x = 0.2 → cos φ₂ = √0.96; unity correction costs more per year', () => {
    const e = economicPf(DEFAULT_PF.pf1, DEFAULT_TARIFF)
    expect(rel(e.pf, Math.sqrt(1 - 0.04))).toBeLessThan(1e-12)
    expect(annualCost(200, 0.7, 1, DEFAULT_TARIFF).total).toBeGreaterThan(annualCost(200, 0.7, e.pf, DEFAULT_TARIFF).total)
  })
})

describe('Feeder model: loss reduction and voltage rise from correction', () => {
  it('complex KVL holds at the solution; V_r rises and the loss falls when the bank is added', () => {
    const s = okPf(pfCorrection(DEFAULT_PF))
    const before = solveFeeder(DEFAULT_FEEDER, 200, s.Q1, 0)
    const after = solveFeeder(DEFAULT_FEEDER, 200, s.Q1, s.Qc)
    if (!before.ok || !after.ok) throw new Error('feeder')
    expect(rel(before.VsCheck, DEFAULT_FEEDER.VsLL)).toBeLessThan(1e-9)
    expect(rel(after.VsCheck, DEFAULT_FEEDER.VsLL)).toBeLessThan(1e-9)
    expect(after.VrLL).toBeGreaterThan(before.VrLL)
    expect(after.loss).toBeLessThan(before.loss)
    // the bank's output follows V²: Q_bank = Q_c (V_r/400)²
    expect(rel(after.Qbank, s.Qc * (after.VrLL / 400) ** 2)).toBeLessThan(1e-9)
    // per-phase power balance: P_s = P_load + loss
    const Vr = after.VrLL / Math.sqrt(3)
    const I = C(200e3 / 3 / Vr, -((after.Qnet * 1000) / 3) / Vr)
    const Vs = add(C(Vr, 0), mul(C(DEFAULT_FEEDER.R, DEFAULT_FEEDER.X), I))
    const Ps = 3 * (Vs.re * I.re + Vs.im * I.im)
    expect(rel(Ps / 1000, 200 + after.loss)).toBeLessThan(1e-9)
  })
  it('complex KVL holds for every solvable random feeder, with and without a bank (the Verify check)', () => {
    const r = rng(31)
    let solved = 0
    for (let t = 0; t < 300; t++) {
      const fd = { VsLL: 380 + r() * 60, R: r() * 0.1, X: r() * 0.1, VratedLL: 400 }
      const P = 10 + r() * 400
      const Q = r() * 400
      const bank = r() * 1.2 * Q
      const s = solveFeeder(fd, P, Q, bank)
      if (!s.ok) continue
      solved++
      expect(rel(s.VsCheck, fd.VsLL)).toBeLessThan(1e-9)
      expect(s.VrLL).toBeGreaterThan(0)
    }
    expect(solved).toBeGreaterThan(200)
  })
  it('an impossible load (beyond maximum transfer) is reported, not given a voltage', () => {
    const r = solveFeeder({ ...DEFAULT_FEEDER, R: 1, X: 1 }, 50000, 0, 0)
    expect(r.ok).toBe(false)
  })
})

// ── Kelvin's law ──────────────────────────────────────────────────────────────────────────────────────────────

describe("Kelvin's law vs numerical minimisation", () => {
  it('the closed form a* is the minimum of the total annual cost, and there the two variable costs are equal', () => {
    const r = rng(21)
    for (let t = 0; t < 300; t++) {
      const q: KelvinInput = { I: 10 + r() * 500, T: 500 + r() * 8000, c: 2 + r() * 10, rho: r() < 0.5 ? 0.0172 : 0.0282, k: 300 + r() * 5000, p: 0.03 + r() * 0.2 }
      expect(validateKelvin(q)).toBeNull()
      const a = kelvinArea(q)
      const num = kelvinNumeric(q)
      expect(rel(num.a, a)).toBeLessThan(1e-6)
      const c = kelvinCost(q, a)
      expect(rel(c.capital, c.energy)).toBeLessThan(1e-12)
      expect(c.total).toBeLessThanOrEqual(kelvinCost(q, a * 1.01).total)
      expect(c.total).toBeLessThanOrEqual(kelvinCost(q, a * 0.99).total)
    }
  })
  it('a* scales with the current and with √(price of energy / price of conductor)', () => {
    const q = DEFAULT_KELVIN
    expect(rel(kelvinArea({ ...q, I: 2 * q.I }), 2 * kelvinArea(q))).toBeLessThan(1e-12)
    expect(rel(kelvinArea({ ...q, c: 4 * q.c }), 2 * kelvinArea(q))).toBeLessThan(1e-12)
    expect(rel(kelvinArea({ ...q, k: 4 * q.k }), kelvinArea(q) / 2)).toBeLessThan(1e-12)
  })
  it('invalid Kelvin inputs are refused', () => {
    expect(validateKelvin({ ...DEFAULT_KELVIN, I: 0 })).toMatch(/current/)
    expect(validateKelvin({ ...DEFAULT_KELVIN, T: 9000 })).toMatch(/8,760/)
    expect(validateKelvin({ ...DEFAULT_KELVIN, p: -0.1 })).toBeTruthy()
  })
})

// ── words and experiments ─────────────────────────────────────────────────────────────────────────────────────

describe('Computed wording', () => {
  it('size and change words follow the numbers', () => {
    expect(pctWords(0.004)).toMatch(/very small \(0\.4 %\)/)
    expect(pctWords(0.038)).toMatch(/noticeable \(3\.8 %\)/)
    expect(changeWords(100, 73.7)).toBe('falls by 26.3 %')
    expect(changeWords(100, 100)).toBe('does not change')
    expect(changeWords(100, 110)).toBe('rises by 10.0 %')
  })
})

describe('Experiments: answers decided from the computation', () => {
  for (const e of EXPERIMENTS)
    it(`${e.id}: runs, its answer is one of the options, every number finite`, () => {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      r.rows.forEach((row) => {
        expect(Number.isFinite(row.before)).toBe(true)
        expect(Number.isFinite(row.after)).toBe(true)
      })
      r.explain.forEach((s) => expect(s).not.toMatch(/NaN|undefined|Infinity/))
    })
  it('the expected physics: both ends → lowest at a load; uniform/far ratio ½; delta/star ⅓', () => {
    const get = (id: string) => EXPERIMENTS.find((e) => e.id === id)!.run()
    expect(get('uniform').answer).toBe('half')
    expect(get('delta').answer).toBe('third')
    expect(get('pf-current').answer).toBe('26')
  })
})
