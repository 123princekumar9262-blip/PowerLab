import { describe, expect, it } from 'vitest'
import { abs, add, conj, mul, sub, ZERO, type Complex } from '../src/powersys/engine/complex.ts'
import { solveLoadFlow } from '../src/powersys/network/loadflow.ts'
import { dcBusOutflow, dcLoadFlow } from '../src/powersys/modules/load-flow/dcflow.ts'
import { FD_MAX_ITER, agreementBound, bDoublePrimeFull, bPrimeFull, decoupling, fastDecoupled, luFactor, luSolve } from '../src/powersys/modules/load-flow/fdlf.ts'
import { dcRows, methodsModel, parallelPstPhi, pstTable, rxStudy } from '../src/powersys/modules/load-flow/methodsModel.ts'
import { flowsFrom, hasParallelPath, pstSensitivity, pstSweep, pstYbus, solveAc } from '../src/powersys/modules/load-flow/pst.ts'
import { solveCase } from '../src/powersys/modules/load-flow/analysis.ts'
import { editCase, fiveBusCase, lfBuses, saadatCase, type CaseEdits, type LfCase } from '../src/powersys/modules/load-flow/systems.ts'
import { ybusSteps } from '../src/powersys/modules/load-flow/ybusSteps.ts'

/*
 * The additive extension of Module 5: fast decoupled load flow (XB), DC load flow and the phase-shifting transformer.
 * Expected values are derived independently (Y_bus of a modified network, Cramer's rule, closed forms, limits).
 */

const D2R = Math.PI / 180
/** S_i = V_i·conj(Σ_k Y_ik V_k), plain complex arithmetic. */
const injections = (Y: Complex[][], V: Complex[]) => V.map((vi, i) => mul(vi, conj(Y[i].reduce((a, y, k) => add(a, mul(y, V[k])), ZERO))))

const CASES_UNDER_TEST: Array<[string, LfCase, CaseEdits]> = [
  ['Saadat 3-bus', saadatCase(), {}],
  ['Saadat, bus-3 Q limited to 100 Mvar', saadatCase(), { qMax: { bus: 2, mvar: 100 } }],
  ['Saadat, loads × 2', saadatCase(), { loadScale: 2 }],
  ['5-bus', fiveBusCase(), {}],
  ['5-bus, loads × 1.6 (East plant at its Q limit)', fiveBusCase(), { loadScale: 1.6 }],
  ['5-bus, 50 Mvar capacitor at Valley town', fiveBusCase(), { shunt: { bus: 4, mvar: 50 } }],
  ['5-bus, line 2–4 out', fiveBusCase(), { outages: ['2–4'] }],
  ['5-bus, loads × 0.5', fiveBusCase(), { loadScale: 0.5 }],
]

/** A lossless copy of a case: r = 0, no charging, no shunts. */
const lossless = (c: LfCase): LfCase => ({ ...c, buses: c.buses.map((b) => ({ ...b, shuntMvar: undefined })), lines: c.lines.map((l) => ({ ...l, r: 0, b: 0 })) })

/** A lossless case at |V| = 1 set-points, no reactive load, every active power (load AND generation) scaled by k. */
const lightly = (c: LfCase, k: number): LfCase => ({
  ...lossless(c),
  buses: c.buses.map((b) => ({ ...b, vSet: 1, pGenMw: b.pGenMw * k, pLoadMw: b.pLoadMw * k, qLoadMvar: 0, qMinMvar: undefined, qMaxMvar: undefined, shuntMvar: undefined })),
})

/** Seeded random numbers (mulberry32) for sampling valid inputs. */
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

describe('LU factorisation (factorise once, solve many)', () => {
  it('solves A·x = b for several right-hand sides, and reports a singular matrix', () => {
    const A = [
      [4, -2, 1],
      [-2, 4, -2],
      [1, -2, 4],
    ]
    const f = luFactor(A)!
    for (const b of [
      [11, -16, 17],
      [1, 0, 0],
      [0, 3, -1],
    ]) {
      const x = luSolve(f, b)
      A.forEach((row, i) => expect(row.reduce((s, a, j) => s + a * x[j], 0)).toBeCloseTo(b[i], 12))
    }
    expect(
      luFactor([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull()
  })
})

describe('B′ and B″', () => {
  it('B′ = −Im(Y_bus) of the same network with r = 0, no charging and no shunts (every case)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const Bp = bPrimeFull(c)
      const Y0 = ybusSteps(lossless(c)).Y
      Bp.forEach((r, i) => r.forEach((v, k) => expect(Math.abs(v + Y0[i][k].im), `${name} B′[${i}][${k}]`).toBeLessThan(1e-9)))
      // symmetric, rows sum to zero (a network Laplacian)
      Bp.forEach((r, i) => {
        expect(Math.abs(r.reduce((s, v) => s + v, 0))).toBeLessThan(1e-9)
        r.forEach((v, k) => expect(v).toBe(Bp[k][i]))
      })
    }
  })
  it('B″ = −Im(Y_bus) on the PQ buses; B′ on the non-slack buses — as used by the solver', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const Y = ybusSteps(c).Y
      const fd = fastDecoupled(Y, lfBuses(c), bPrimeFull(c), bDoublePrimeFull(Y))
      expect(fd.converged, name).toBe(true)
      fd.magIdx.forEach((i, a) => fd.magIdx.forEach((k, b) => expect(fd.Bpp[a][b]).toBe(-Y[i][k].im)))
      expect(fd.angIdx).toEqual(c.buses.map((_, i) => i).filter((i) => c.buses[i].type !== 'slack'))
      expect(fd.magIdx).toEqual(c.buses.map((_, i) => i).filter((i) => fd.types[i] === 'pq'))
    }
  })
  it('Saadat: B′ by hand (1/x) and B″ = −B₂₂ = 52', () => {
    const c = saadatCase()
    const Bp = bPrimeFull(c)
    expect(Bp[1][1]).toBeCloseTo(1 / 0.04 + 1 / 0.025, 12)
    expect(Bp[2][2]).toBeCloseTo(1 / 0.03 + 1 / 0.025, 12)
    expect(Bp[1][2]).toBeCloseTo(-40, 12)
    // y12 = 1/(0.02 + j0.04) = 10 − j20, y23 = 1/(0.0125 + j0.025) = 16 − j32 → B22 = −52
    expect(-ybusSteps(c).Y[1][1].im).toBeCloseTo(52, 12)
  })
})

describe('Fast decoupled load flow converges to the Newton–Raphson solution', () => {
  it('on every Module 5 system: same angles and |V| (within the bound set by the tolerance), same Q-limited buses', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const Y = ybusSteps(c).Y
      const lb = lfBuses(c)
      const nr = solveLoadFlow(Y, lb)
      const fd = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y))
      expect(nr.converged && fd.converged, name).toBe(true)
      expect(fd.qLimited, name).toEqual(nr.qLimited)
      const m = methodsModel(c, { pstLine: '1–3', phiDeg: 0 })
      const ag = m.agree!
      // the tolerance 1e-8 pu on the mismatch maps to ‖J⁻¹‖·(m1 + m2) on the state
      expect(ag.bound, name).toBeLessThan(1e-7)
      fd.V.forEach((v, i) => {
        expect(Math.abs(Math.atan2(v.im, v.re) - Math.atan2(nr.V[i].im, nr.V[i].re)), `${name} θ${i + 1}`).toBeLessThanOrEqual(2 * ag.bound)
        expect(Math.abs(abs(v) - abs(nr.V[i])), `${name} |V${i + 1}|`).toBeLessThanOrEqual(2 * ag.bound)
      })
      // the residuals of the fast decoupled answer are the specified injections
      const S = injections(Y, fd.V)
      lb.forEach((b, i) => {
        if (b.type !== 'slack') expect(Math.abs(S[i].re - b.p)).toBeLessThan(1e-8)
      })
    }
  })
  it('reports its iterations honestly: more than NR, a record per state, linear (not quadratic) convergence', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const Y = ybusSteps(c).Y
      const lb = lfBuses(c)
      const nr = solveLoadFlow(Y, lb)
      const fd = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y))
      expect(fd.iterations, name).toBeGreaterThan(nr.iterations)
      expect(fd.records.length, name).toBe(fd.iterations + fd.factorisations.bpp) // one extra record per pass
      expect(fd.records[fd.records.length - 1].k).toBe(fd.iterations)
      expect(fd.history[fd.history.length - 1]).toBeLessThan(1e-8)
      expect(fd.factorisations.bp).toBe(1)
      expect(fd.factorisations.bpp).toBe(1 + fd.qLimited.length)
    }
    // on the 5-bus network the reduction per iteration is roughly constant (linear convergence)
    const c = fiveBusCase()
    const Y = ybusSteps(c).Y
    const h = fastDecoupled(Y, lfBuses(c), bPrimeFull(c), bDoublePrimeFull(Y)).history.map(Math.log10)
    const steps = h.slice(1).map((v, k) => v - h[k])
    for (const s of steps.slice(1)) expect(s).toBeLessThan(-0.8) // every iteration gains > 0.8 digits …
    for (const s of steps.slice(1)) expect(s).toBeGreaterThan(-2.5) // … but not the doubling of NR
  })
  it('the main cost is linear convergence (even with r = 0 it needs more than NR); a large r/x adds more; NR is hardly affected', () => {
    const study = rxStudy('saadat', [0, 1, 4])
    expect(study.every((p) => p.nr !== null && p.fd !== null)).toBe(true)
    expect(study[0].fd!).toBeGreaterThan(study[0].nr! + 2) // r = 0: no coupling from resistance, still slower
    expect(study[2].fd!).toBeGreaterThan(3 * study[1].fd!) // r × 4: far slower
    expect(Math.max(...study.map((p) => p.nr!)) - Math.min(...study.map((p) => p.nr!))).toBeLessThanOrEqual(2)
    // 5-bus (r/x 0.10) needs fewer FDLF iterations than Saadat (r/x up to 0.5)
    const sa = methodsModel(saadatCase(), { pstLine: '1–3', phiDeg: 0 })
    const fv = methodsModel(fiveBusCase(), { pstLine: '1–3', phiDeg: 0 })
    expect(fv.fd.iterations).toBeLessThan(sa.fd.iterations)
    expect(sa.dec!.ratio).toBeGreaterThan(fv.dec!.ratio) // weaker decoupling with the higher r/x
  })
  it('the first iteration equals the hand calculation (Cramer on B′, then ΔQ/B″)', () => {
    const c = saadatCase()
    const Y = ybusSteps(c).Y
    const lb = lfBuses(c)
    const fd = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y))
    const dP2 = -2.86 // P2 at the flat start = −1.14 (see the module test), spec −4
    // P3 at the flat start: |V3| Σ |Vk| G3k = 1.04·(−10·1.05 − 16·1 + 26·1.04)
    const P3 = 1.04 * (-10 * 1.05 - 16 * 1 + 26 * 1.04)
    const r2 = dP2 / 1
    const r3 = (2 - P3) / 1.04
    const [a, b, d] = [65, -40, 1 / 0.03 + 40]
    const det = a * d - b * b
    const th2 = (r2 * d - b * r3) / det
    const th3 = (a * r3 - b * r2) / det
    expect(fd.records[1].th[1]).toBeCloseTo(th2, 12)
    expect(fd.records[1].th[2]).toBeCloseTo(th3, 12)
  })
  it('the agreement check (“Same solution?”) holds for randomly sampled valid settings', () => {
    const r = rng(42)
    let compared = 0
    for (let s = 0; s < 60; s++) {
      const five = r() < 0.6
      const base = five ? fiveBusCase() : saadatCase()
      const edits: CaseEdits = {
        loadScale: 0.5 + r() * (five ? 1.7 : 3.5),
        outages: r() < 0.3 ? [base.lines[Math.floor(r() * base.lines.length)].id] : [],
        shunt: five && r() < 0.5 ? { bus: 4, mvar: Math.round(r() * 20) * 5 } : undefined,
        qLimits: r() < 0.8,
      }
      const c = editCase(base, edits)
      const phi = r() < 0.5 ? 0 : Math.round((r() * 40 - 20) * 2) / 2
      const m = methodsModel(c, { pstLine: base.lines[Math.floor(r() * base.lines.length)].id, phiDeg: phi })
      if (!m.ac.converged || !m.fd.converged) continue
      if (m.fd.qLimited.join() !== m.ac.run.qLimited.join()) continue // a different limit set is a different problem (not seen in practice)
      compared++
      expect(m.agree!.dth, `sample ${s}`).toBeLessThanOrEqual(2 * m.agree!.bound)
      expect(m.agree!.dv, `sample ${s}`).toBeLessThanOrEqual(2 * m.agree!.bound)
    }
    expect(compared).toBeGreaterThan(30)
  })
})

describe('Fast decoupled: why it stopped', () => {
  it('a slow but converging run is told apart from a stalled one; the default cap lets the slow case finish', () => {
    const c = editCase(fiveBusCase(), { loadScale: 1.1, outages: ['1–3'], shunt: { bus: 4, mvar: 100 } })
    const pst = { line: '3–5', phiDeg: -7.5 }
    const Y = pstYbus(c, pst)
    const Y0 = ybusSteps(c).Y
    const lb = lfBuses(c)
    expect(solveAc(c, pst).converged).toBe(true)
    const capped = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y0), { maxIter: 100 })
    expect(capped.converged).toBe(false)
    expect(capped.stop).toBe('cap-converging')
    const full = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y0))
    expect(full.converged).toBe(true)
    expect(full.iterations).toBeGreaterThan(100)
    expect(full.iterations).toBeLessThan(FD_MAX_ITER)
    // beyond the maximum loadability nothing converges, and the run is not called "still converging"
    const far = editCase(fiveBusCase(), { loadScale: 2.2 })
    const Yf = ybusSteps(far).Y
    const r = fastDecoupled(Yf, lfBuses(far), bPrimeFull(far), bDoublePrimeFull(Yf))
    expect(r.converged).toBe(false)
    expect(r.stop).not.toBe('cap-converging')
  })
})

describe('DC load flow', () => {
  it('Σ injections = 0, θ_slack = 0, and every bus satisfies KCL with the line flows (with and without a PST)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      for (const pst of [null, { line: '1–3', phiDeg: 7.5 }]) {
        const dc = dcLoadFlow(c, pst)
        expect(dc.ok, name).toBe(true)
        expect(dc.th[dc.slack]).toBe(0)
        expect(Math.abs(dc.pInjMw.reduce((s, p) => s + p, 0)), name).toBeLessThan(1e-9)
        const out = dcBusOutflow(c, dc)
        out.forEach((o, i) => expect(Math.abs(o - dc.pInjMw[i]), `${name} bus ${i + 1}`).toBeLessThan(1e-9))
      }
    }
  })
  it('Saadat by hand (Cramer’s rule): θ₂, θ₃ and the three flows', () => {
    const dc = dcLoadFlow(saadatCase())
    const [a, b, d] = [65, -40, 1 / 0.03 + 40]
    const det = a * d - b * b
    const t2 = (-4 * d - b * 2) / det
    const t3 = (a * 2 - b * -4) / det
    expect(dc.th[1]).toBeCloseTo(t2, 12)
    expect(dc.th[2]).toBeCloseTo(t3, 12)
    expect(dc.flows[0].pMw).toBeCloseTo((-t2 / 0.04) * 100, 9)
    expect(dc.flows[1].pMw).toBeCloseTo((-t3 / 0.03) * 100, 9)
    expect(dc.flows[2].pMw).toBeCloseTo(((t2 - t3) / 0.025) * 100, 9)
    expect(dc.pInjMw[0]).toBeCloseTo(200, 9) // lossless slack: 400 − 200
  })
  it('is exact in the limit: lossless, |V| = 1, loading → 0 (error falls like the square of the loading)', () => {
    for (const base of [saadatCase(), fiveBusCase()]) {
      const err = [0.1, 0.01].map((k) => {
        const c = lightly(base, k)
        const ac = solveAc(c, null)
        expect(ac.converged).toBe(true)
        const dc = dcLoadFlow(c)
        const scale = Math.max(...ac.lines.map((l) => Math.abs(l.pFromMw)))
        return Math.max(...dc.flows.map((f, j) => Math.abs(f.pMw - ac.lines[j].pFromMw))) / scale
      })
      expect(err[1]).toBeLessThan(1e-3)
      expect(err[0] / err[1]).toBeGreaterThan(30) // ≈ 100 for an O(k²) error
    }
  })
  it('compared with the full AC solution: errors are reported per line, the slack differs by about the losses', () => {
    for (const base of [saadatCase(), fiveBusCase()]) {
      const m = methodsModel(base, { pstLine: '1–3', phiDeg: 0 })
      const rows = dcRows(base, m.dc, m.ac)
      expect(rows.length).toBe(base.lines.length)
      rows.forEach((r, j) => expect(r.errMw).toBeCloseTo(m.dc.flows[j].pMw - m.ac.lines[j].pFromMw, 9))
      const s = solveCase(base)
      expect(m.ac.slackMw).toBeCloseTo(s.bus[0].pGenMw, 6) // the methods view's AC solve = the module's solver
      const diff = m.ac.slackMw - m.dc.pInjMw[m.dc.slack]
      expect(diff).toBeCloseTo(s.totals.pLoss, 6) // lossless DC: the slack misses exactly the AC losses
    }
  })
})

describe('Phase-shifting transformer', () => {
  it('φ = 0 reproduces the no-PST case exactly (Y_bus, AC and DC)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const Y = ybusSteps(c).Y
      const Yp = pstYbus(c, { line: '1–3', phiDeg: 0 })
      Y.forEach((r, i) => r.forEach((y, k) => expect(Yp[i][k]).toEqual(y)))
      const a0 = solveAc(c, null)
      const a1 = solveAc(c, { line: '1–3', phiDeg: 0 })
      a0.V.forEach((v, i) => expect(a1.V[i], name).toEqual(v))
      const d0 = dcLoadFlow(c, null)
      const d1 = dcLoadFlow(c, { line: '1–3', phiDeg: 0 })
      d0.flows.forEach((f, j) => expect(d1.flows[j].pMw).toBe(f.pMw))
      // a vanishing shift is continuous
      const a2 = solveAc(c, { line: '1–3', phiDeg: 1e-9 })
      a0.V.forEach((v, i) => expect(abs(sub(a2.V[i], v))).toBeLessThan(1e-9))
    }
  })
  it('the complex-tap model: non-symmetric Y_bus, residuals equal the specification, KCL with the PST line flows', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST.slice(0, 5)) {
      const c = editCase(base, edits)
      const pst = { line: '1–3', phiDeg: -8 }
      const ac = solveAc(c, pst)
      expect(ac.converged, name).toBe(true)
      expect(abs(sub(ac.Y[0][2], ac.Y[2][0]))).toBeGreaterThan(1e-3)
      const S = injections(ac.Y, ac.V)
      const lb = lfBuses(c)
      lb.forEach((b, i) => {
        if (b.type !== 'slack') expect(Math.abs(S[i].re - b.p), `${name} P${i + 1}`).toBeLessThan(1e-8)
      })
      // the sum of the line flows leaving each bus (PST line from its own formula) = the bus injection
      const lines = flowsFrom(c, ac.V, pst)
      c.buses.forEach((bus, i) => {
        let p = 0
        let q = 0
        for (const l of lines) {
          if (!l.inService) continue
          if (l.from === i) {
            p += l.pFromMw
            q += l.qFromMvar
          }
          if (l.to === i) {
            p += l.pToMw
            q += l.qToMvar
          }
        }
        const shunt = (bus.shuntMvar ?? 0) * abs(ac.V[i]) ** 2
        expect(Math.abs(p - S[i].re * c.baseMva), `${name} bus ${i + 1} P`).toBeLessThan(1e-6)
        expect(Math.abs(q - shunt - S[i].im * c.baseMva), `${name} bus ${i + 1} Q`).toBeLessThan(1e-6)
      })
    }
  })
  it('a lossless line with a PST carries (|V_i||V_k|/x)·sin(θ_i − θ_k + φ)', () => {
    const c = lossless(fiveBusCase())
    const pst = { line: '2–3', phiDeg: 12 }
    const ac = solveAc(c, pst)
    const l = c.lines.find((x) => x.id === '2–3')!
    const Vi = ac.V[l.from]
    const Vk = ac.V[l.to]
    const p = ((abs(Vi) * abs(Vk)) / l.x) * Math.sin(Math.atan2(Vi.im, Vi.re) - Math.atan2(Vk.im, Vk.re) + 12 * D2R) * 100
    expect(ac.lines.find((x) => x.id === '2–3')!.pFromMw).toBeCloseTo(p, 9)
  })
  it('the DC injection model equals the AC complex-tap model in the small-angle lossless limit', () => {
    for (const base of [saadatCase(), fiveBusCase()]) {
      const err = [0.1, 0.01].map((k) => {
        const c = lightly(base, k)
        const pst = { line: '1–3', phiDeg: 5 * k }
        const ac = solveAc(c, pst)
        const dc = dcLoadFlow(c, pst)
        expect(ac.converged).toBe(true)
        const scale = Math.max(...ac.lines.map((l) => Math.abs(l.pFromMw)))
        return Math.max(...dc.flows.map((f, j) => Math.abs(f.pMw - ac.lines[j].pFromMw))) / scale
      })
      expect(err[1]).toBeLessThan(1e-3)
      expect(err[0] / err[1]).toBeGreaterThan(30)
    }
  })
  it('one loop (Saadat): ΔP = φ/Σx round the loop, exactly in the DC model; X_rest = the other two reactances', () => {
    const c = saadatCase()
    const d0 = dcLoadFlow(c)
    const d1 = dcLoadFlow(c, { line: '1–3', phiDeg: 5 })
    const dP = ((5 * D2R) / (0.04 + 0.03 + 0.025)) * 100
    expect(d1.flows[1].pMw - d0.flows[1].pMw).toBeCloseTo(dP, 9)
    expect(d1.flows[0].pMw - d0.flows[0].pMw).toBeCloseTo(-dP, 9)
    expect(d1.flows[2].pMw - d0.flows[2].pMw).toBeCloseTo(-dP, 9)
    const s = pstSensitivity(c, '1–3')!
    expect(s.xRest).toBeCloseTo(0.04 + 0.025, 9)
    // no parallel path: a line that is the only route between its buses cannot be steered
    const radial = editCase(c, { outages: ['2–3'] })
    expect(Number.isFinite(pstSensitivity(radial, '1–3')!.xRest)).toBe(false)
    const r1 = dcLoadFlow(radial, { line: '1–3', phiDeg: 10 })
    expect(r1.flows[1].pMw).toBeCloseTo(dcLoadFlow(radial).flows[1].pMw, 9)
  })
  it('P on the PST line rises monotonically with φ over the range shown (−20° to +20°), AC and DC', () => {
    const phis = Array.from({ length: 41 }, (_, k) => k - 20)
    for (const [name, base, edits] of [...CASES_UNDER_TEST.filter(([, , e]) => !e.qMax), ['5-bus, loads × 1.5', fiveBusCase(), { loadScale: 1.5 }] as [string, LfCase, CaseEdits]]) {
      const c = editCase(base, edits)
      for (const l of c.lines.filter((x) => x.inService !== false)) {
        if (!Number.isFinite(pstSensitivity(c, l.id)!.xRest)) continue
        const sw = pstSweep(c, l.id, phis)
        for (let k = 1; k < sw.length; k++) {
          expect(sw[k].dcMw, `${name} ${l.id} DC`).toBeGreaterThan(sw[k - 1].dcMw)
          if (sw[k].acMw !== null && sw[k - 1].acMw !== null) expect(sw[k].acMw!, `${name} ${l.id} AC φ=${phis[k]}`).toBeGreaterThan(sw[k - 1].acMw!)
        }
        if (!edits.loadScale || edits.loadScale <= 1)
          expect(
            sw.every((p) => p.acMw !== null),
            `${name} ${l.id}: AC solves over the whole range`,
          ).toBe(true)
      }
    }
  })
  it('the engineering use: at loads × 1.5 a negative shift in line 1–3 relieves its overload', () => {
    const c = editCase(fiveBusCase(), { loadScale: 1.5 })
    const t = pstTable(c, '1–3', -5)
    const l0 = t.ac0.lines.find((l) => l.id === '1–3')!.loadingPct!
    const l1 = t.ac1.lines.find((l) => l.id === '1–3')!.loadingPct!
    expect(l0).toBeGreaterThan(100)
    expect(l1).toBeLessThan(100)
    // the load is unchanged, so the slack changes only by the change in losses
    expect(Math.abs(t.ac1.slackMw - t.ac0.slackMw - (t.ac1.lossMw - t.ac0.lossMw))).toBeLessThan(1e-6)
  })
  it('a line with no parallel path is recognised from the topology for every single and double outage', () => {
    for (const base of [saadatCase(), fiveBusCase()]) {
      const ids = base.lines.map((l) => l.id)
      const outageSets: string[][] = [[], ...ids.map((a) => [a]), ...ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b]))]
      for (const outages of outageSets) {
        const c = editCase(base, { outages })
        if (dcLoadFlow(c).ok === false) continue // a split network
        for (const l of c.lines.filter((x) => x.inService !== false)) {
          const s = pstSensitivity(c, l.id)!
          const d0 = dcLoadFlow(c).flows.find((f) => f.id === l.id)!.pMw
          const d1 = dcLoadFlow(c, { line: l.id, phiDeg: 10 }).flows.find((f) => f.id === l.id)!.pMw
          const parallel = hasParallelPath(c, l.id)
          expect(Number.isFinite(s.xRest), `${base.id} out ${outages.join(',')} PST ${l.id}`).toBe(parallel)
          if (parallel) {
            expect(Math.abs(d1 - d0)).toBeGreaterThan(1)
            expect(s.xRest).toBeGreaterThan(0)
          } else expect(Math.abs(d1 - d0)).toBeLessThan(1e-6)
        }
      }
    }
    // the cases found in review
    expect(Number.isFinite(pstSensitivity(editCase(fiveBusCase(), { outages: ['4–5'] }), '3–5')!.xRest)).toBe(false)
    expect(Number.isFinite(pstSensitivity(editCase(saadatCase(), { outages: ['1–2'] }), '1–3')!.xRest)).toBe(false)
  })
})

describe('Practice and prediction answers come from the models', () => {
  it('two parallel lines: the phase shift that sets line 1’s share (checked with the DC load flow)', () => {
    const phi = parallelPstPhi(0.2, 0.3, 1, 0.4)
    expect(phi).toBeCloseTo((0.4 * 0.2 - 0.6 * 0.3) / D2R, 12)
    const two: LfCase = {
      id: 'saadat',
      name: 'two lines',
      short: 'two lines',
      baseMva: 100,
      buses: [
        { name: 'A', tag: 'A', type: 'slack', vSet: 1, pGenMw: 0, pLoadMw: 0, qLoadMvar: 0, x: 0, y: 0 },
        { name: 'B', tag: 'B', type: 'pq', vSet: 1, pGenMw: 0, pLoadMw: 100, qLoadMvar: 0, x: 0, y: 0 },
      ],
      lines: [
        { id: 'L1', from: 0, to: 1, r: 0, x: 0.2, b: 0 },
        { id: 'L2', from: 0, to: 1, r: 0, x: 0.3, b: 0 },
      ],
      source: 'test',
      weakBus: 1,
    }
    expect(dcLoadFlow(two).flows[0].pMw).toBeCloseTo(60, 9)
    const d = dcLoadFlow(two, { line: 'L1', phiDeg: phi })
    expect(d.flows[0].pMw).toBeCloseTo(40, 9)
    expect(d.flows[1].pMw).toBeCloseTo(60, 9)
  })
  it('decoupling evidence and the bound are finite on both systems', () => {
    for (const base of [saadatCase(), fiveBusCase()]) {
      const c = base
      const Y = ybusSteps(c).Y
      const nr = solveLoadFlow(Y, lfBuses(c))
      const Vm = nr.V.map(abs)
      const th = nr.V.map((v) => Math.atan2(v.im, v.re))
      const types = c.buses.map((b) => b.type)
      const d = decoupling(c, Y, Vm, th, types)
      expect(d.ratio).toBeGreaterThan(0)
      expect(d.ratio).toBeLessThan(1)
      expect(Number.isFinite(agreementBound(Y, Vm, th, types, 1e-9, 1e-9))).toBe(true)
    }
  })
})
