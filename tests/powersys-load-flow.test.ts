import { describe, expect, it } from 'vitest'
import { abs, add, arg, C, conj, deg, mul, sub, ZERO, type Complex } from '../src/powersys/engine/complex.ts'
import { solveLoadFlow, type LfBus } from '../src/powersys/network/loadflow.ts'
import { branchFlow, solveNetwork } from '../src/powersys/network/solve.ts'
import { buildYbus, ybusFromImpedances } from '../src/powersys/network/ybus.ts'
import { iterateCase, noseCurve, solveCase } from '../src/powersys/modules/load-flow/analysis.ts'
import { EXPERIMENTS, runExperiment, startFrom } from '../src/powersys/modules/load-flow/experiments.ts'
import { gaussSeidel } from '../src/powersys/modules/load-flow/gaussSeidel.ts'
import { injectionsPolar, jacobian, newtonRaphson } from '../src/powersys/modules/load-flow/stepwise.ts'
import { editCase, fiveBusCase, fiveBusNetwork, lfBuses, SAADAT_PUBLISHED, saadatCase, type CaseEdits, type LfCase } from '../src/powersys/modules/load-flow/systems.ts'
import { nonZeros, ybusSteps } from '../src/powersys/modules/load-flow/ybusSteps.ts'

/** S_i = V_i · conj(Σ_k Y_ik V_k) in plain complex arithmetic — independent of the solvers' polar formulas. */
const injections = (Y: Complex[][], V: Complex[]) => V.map((vi, i) => mul(vi, conj(Y[i].reduce((a, y, k) => add(a, mul(y, V[k])), ZERO))))
const maxDiff = (A: Complex[][], B: Complex[][]) => Math.max(...A.flatMap((r, i) => r.map((y, k) => abs(sub(y, B[i][k])))))

const CASES_UNDER_TEST: Array<[string, LfCase, CaseEdits]> = [
  ['Saadat 3-bus', saadatCase(), {}],
  ['Saadat, bus-3 Q limited to 100 Mvar', saadatCase(), { qMax: { bus: 2, mvar: 100 } }],
  ['5-bus', fiveBusCase(), {}],
  ['5-bus, loads × 1.6 (East plant at its Q limit)', fiveBusCase(), { loadScale: 1.6 }],
  ['5-bus, 50 Mvar capacitor at Valley town', fiveBusCase(), { shunt: { bus: 4, mvar: 50 } }],
  ['5-bus, line 2–4 out', fiveBusCase(), { outages: ['2–4'] }],
]

describe('Saadat Example 6.10 through this module’s own pipeline (case → Y_bus → shared solver → results)', () => {
  it('matches the published voltages, slack power and Q3', () => {
    const s = solveCase(saadatCase())
    expect(s.converged).toBe(true)
    expect(s.bus[1].vm).toBeCloseTo(SAADAT_PUBLISHED.v2, 5)
    expect(s.bus[1].thDeg).toBeCloseTo(SAADAT_PUBLISHED.th2Deg, 2)
    expect(s.bus[2].vm).toBeCloseTo(1.04, 12)
    expect(s.bus[2].thDeg).toBeCloseTo(SAADAT_PUBLISHED.th3Deg, 3)
    expect(s.bus[0].pGenMw).toBeCloseTo(SAADAT_PUBLISHED.p1Mw, 1)
    expect(s.bus[0].qGenMvar).toBeCloseTo(SAADAT_PUBLISHED.q1Mvar, 1)
    expect(s.bus[2].qGenMvar).toBeCloseTo(SAADAT_PUBLISHED.q3Mvar, 1)
  })
})

describe('Y_bus built step by step', () => {
  it('equals the shared ybusFromImpedances for both cases (with line charging and a shunt capacitor)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const { Y, steps } = ybusSteps(c)
      const lines = c.lines.filter((l) => l.inService !== false)
      const Ys = ybusFromImpedances(
        c.buses.length,
        lines.map((l) => ({ i: l.from, k: l.to, z: C(l.r, l.x), yHalf: C(0, l.b / 2) })),
      )
      c.buses.forEach((b, i) => {
        if (b.shuntMvar) Ys[i][i] = add(Ys[i][i], C(0, b.shuntMvar / c.baseMva))
      })
      expect(maxDiff(Y, Ys), name).toBeLessThan(1e-12)
      expect(steps.length).toBe(lines.length + c.buses.filter((b) => b.shuntMvar).length)
    }
  })
  it('the 5-bus case equals the shared buildYbus of the same network in km and Ω/km', () => {
    const net = fiveBusNetwork()
    const Yn = buildYbus(
      net,
      net.buses.map((b) => b.id),
    )
    expect(maxDiff(ybusSteps(fiveBusCase()).Y, Yn)).toBeLessThan(1e-12)
  })
  it('each step changes only Y_ii, Y_kk, Y_ik, Y_ki; zeros where no branch joins two buses', () => {
    const { steps } = ybusSteps(fiveBusCase())
    for (let s = 1; s < steps.length; s++) {
      const changed = new Set(steps[s].cells.map(([i, k]) => `${i},${k}`))
      steps[s].Y.forEach((r, i) =>
        r.forEach((y, k) => {
          if (!changed.has(`${i},${k}`)) expect(abs(sub(y, steps[s - 1].Y[i][k]))).toBe(0)
        }),
      )
    }
    const Y = steps[steps.length - 1].Y
    expect(nonZeros(Y)).toBe(5 + 2 * 7)
    expect(abs(Y[0][3])).toBe(0) // buses 1 and 4 are not joined
  })
})

describe('Step-wise Newton–Raphson', () => {
  it('reaches the shared solver’s solution, with the same iteration count and mismatch history', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const { Y } = ybusSteps(c)
      const lb = lfBuses(c)
      const shared = solveLoadFlow(Y, lb)
      const mine = newtonRaphson(Y, lb)
      expect(shared.converged, name).toBe(true)
      expect(mine.converged, name).toBe(true)
      expect(mine.iterations, name).toBe(shared.iterations)
      expect(mine.qLimited, name).toEqual(shared.qLimited)
      mine.V.forEach((v, i) => expect(abs(sub(v, shared.V[i])), `${name} bus ${i + 1}`).toBeLessThan(1e-12))
      mine.history.forEach((m, k) => expect(m).toBeCloseTo(shared.history[k], 10))
    }
  })
  it('records a Jacobian and a correction at every non-final state, and the corrections lead to the next state', () => {
    const { run } = iterateCase(saadatCase())
    const recs = run.records
    expect(recs.length).toBe(run.iterations + 1)
    for (let k = 0; k < recs.length - 1; k++) {
      const r = recs[k]
      expect(r.J!.length).toBe(3)
      const n = r.angIdx.length
      r.angIdx.forEach((i, j) => expect(recs[k + 1].th[i]).toBeCloseTo(r.th[i] + r.dx![j], 14))
      r.magIdx.forEach((i, j) => expect(recs[k + 1].Vm[i]).toBeCloseTo(r.Vm[i] * (1 + r.dx![n + j]), 14))
    }
    // the flat-start mismatch of Saadat 6.10 (computed by hand: P2 = −10·1.05 + 26 − 16·1.04 = −1.14)
    expect(recs[0].dP[0]).toBeCloseTo(-2.86, 12)
    expect(recs[0].dQ[0]).toBeCloseTo(-0.22, 12)
    expect(recs[recs.length - 1].J).toBeUndefined()
  })
  it('converges quadratically: near the solution log10(mismatch) roughly doubles each iteration', () => {
    const h = iterateCase(fiveBusCase()).run.history.map((m) => Math.log10(m))
    // e.g. −3.0 → −7.3 → −14.1
    for (let k = h.length - 2; k < h.length; k++) if (h[k - 1] < -2) expect(h[k] / h[k - 1]).toBeGreaterThan(1.7)
  })
  it('the Jacobian matches a central-difference Jacobian of the mismatch function (relative 1e-5)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const { Y } = ybusSteps(c)
      const { run } = iterateCase(base, edits)
      // at the flat start and at an intermediate state
      for (const rec of [run.records[0], run.records[1]]) {
        const { angIdx, magIdx } = rec
        const J = jacobian(Y, rec.Vm, rec.th, angIdx, magIdx)
        const F = (Vm: number[], th: number[]) => {
          const { P, Q } = injectionsPolar(Y, Vm, th)
          return [...angIdx.map((i) => P[i]), ...magIdx.map((i) => Q[i])]
        }
        const h = 1e-6
        const cols = [...angIdx.map((k) => ({ k, v: false })), ...magIdx.map((k) => ({ k, v: true }))]
        cols.forEach(({ k, v }, j) => {
          const Vp = [...rec.Vm]
          const Vn = [...rec.Vm]
          const tp = [...rec.th]
          const tn = [...rec.th]
          if (v) {
            Vp[k] += h
            Vn[k] -= h
          } else {
            tp[k] += h
            tn[k] -= h
          }
          const fp = F(Vp, tp)
          const fn = F(Vn, tn)
          const scale = Math.max(...J.map((r) => Math.abs(r[j])))
          fp.forEach((_, i) => {
            const fd = ((fp[i] - fn[i]) / (2 * h)) * (v ? rec.Vm[k] : 1)
            expect(Math.abs(fd - J[i][j]) / scale, `${name} J[${i}][${j}]`).toBeLessThan(1e-5)
          })
        })
      }
    }
  })
  it('a poor start can converge to a different, low-voltage solution of the same equations', () => {
    const base = saadatCase()
    const flat = startFrom(base, 1)
    const poor = startFrom(base, 0.2)
    expect(poor.converged).toBe(true)
    expect(Math.abs(poor.Vm[1] - flat.Vm[1])).toBeGreaterThan(0.5)
    const { Y } = ybusSteps(base)
    const S = injections(Y, poor.V)
    expect(abs(sub(S[1], C(-4, -2.5)))).toBeLessThan(1e-8)
    expect(Math.abs(S[2].re - 2)).toBeLessThan(1e-8)
  })
})

describe('Independent checks of the solutions', () => {
  it('residuals S = V·conj(Y·V) equal the specified injections; PV magnitudes are held (or Q is at its limit)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const s = solveCase(base, edits)
      const lb: LfBus[] = lfBuses(c)
      const S = injections(s.Y, s.V)
      lb.forEach((b, i) => {
        if (b.type === 'slack') return
        expect(Math.abs(S[i].re - b.p), `${name} P${i + 1}`).toBeLessThan(1e-8)
        if (b.type === 'pq') expect(Math.abs(S[i].im - b.q), `${name} Q${i + 1}`).toBeLessThan(1e-8)
        if (b.type === 'pv') {
          if (s.bus[i].atQLimit) expect(Math.min(...[b.qMax, b.qMin].filter((x) => x !== undefined).map((x) => Math.abs(S[i].im - x!)))).toBeLessThan(1e-8)
          else expect(abs(s.V[i])).toBeCloseTo(b.v, 12)
        }
      })
    }
  })
  it('power balance: ΣP_gen = ΣP_load + losses, and Q likewise (with charging and capacitors)', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const t = solveCase(base, edits).totals
      expect(Math.abs(t.pGen - t.pLoad - t.pLoss), name).toBeLessThan(1e-6)
      expect(Math.abs(t.qGen + t.qShunt - t.qLoad - t.qLoss), name).toBeLessThan(1e-6)
    }
  })
  it('line flows equal the shared branchFlow; a line’s loss is S_ik + S_ki = |I|²r when it has no charging', () => {
    const s = solveCase(fiveBusCase())
    const net = fiveBusNetwork()
    for (const l of s.lines) {
      const comp = net.components.find((x) => x.id === `L${l.id}`)
      const ref = branchFlow(net, comp as never, s.V[l.from], s.V[l.to])
      expect(l.pFromMw).toBeCloseTo(ref.pFromMw, 9)
      expect(l.qFromMvar).toBeCloseTo(ref.qFromMvar, 9)
      expect(l.pToMw).toBeCloseTo(ref.pToMw, 9)
      expect(l.qToMvar).toBeCloseTo(ref.qToMvar, 9)
    }
    // the shared network solver gives the same bus voltages for the 5-bus network
    const sn = solveNetwork(net)
    expect(sn.ok).toBe(true)
    s.bus.forEach((b, i) => expect(sn.bus[`b${i + 1}`].vPu).toBeCloseTo(b.vm, 9))
    const sa = solveCase(saadatCase())
    sa.lines.forEach((l, j) => {
      const L = saadatCase().lines[j]
      expect(l.lossMw).toBeCloseTo(l.iSeriesPu ** 2 * L.r * 100, 9)
    })
  })
})

describe('Gauss–Seidel', () => {
  it('converges to the Newton–Raphson solution, in many more iterations', () => {
    for (const [name, base, edits] of CASES_UNDER_TEST) {
      const c = editCase(base, edits)
      const { Y } = ybusSteps(c)
      const lb = lfBuses(c)
      const nr = newtonRaphson(Y, lb)
      const gs = gaussSeidel(Y, lb, { alpha: 1.2, maxIter: 3000 })
      expect(gs.converged, name).toBe(true)
      gs.V.forEach((v, i) => expect(abs(sub(v, nr.V[i])), `${name} bus ${i + 1}`).toBeLessThan(1e-6))
      expect(gs.iterations, name).toBeGreaterThan(2 * nr.iterations)
    }
  })
  it('acceleration helps: some α > 1 needs fewer iterations than α = 1', () => {
    for (const base of [saadatCase(), fiveBusCase()]) {
      const { Y } = ybusSteps(base)
      const lb = lfBuses(base)
      const plain = gaussSeidel(Y, lb).iterations
      const best = Math.min(...[1.2, 1.3, 1.4, 1.5].map((a) => gaussSeidel(Y, lb, { alpha: a }).iterations))
      expect(best).toBeLessThan(plain)
    }
  })
})

describe('Maximum loadability (the P–V nose)', () => {
  it('two buses, lossless line jX, unity-power-factor load: the maximum is V1²/(2X), bracketed', () => {
    const X = 0.5
    const V1 = 1.0
    const P0 = 0.5 // pu at multiplier 1
    const two: LfCase = {
      id: 'saadat',
      name: 'two-bus',
      short: 'two-bus',
      baseMva: 100,
      buses: [
        { name: 'Source', tag: '1', type: 'slack', vSet: V1, pGenMw: 0, pLoadMw: 0, qLoadMvar: 0, x: 0, y: 0 },
        { name: 'Load', tag: '2', type: 'pq', vSet: 1, pGenMw: 0, pLoadMw: P0 * 100, qLoadMvar: 0, x: 0, y: 0 },
      ],
      lines: [{ id: '1–2', from: 0, to: 1, r: 0, x: X, b: 0 }],
      source: 'test',
      weakBus: 1,
    }
    const pMax = (V1 * V1) / (2 * X)
    const n = noseCurve(two, {}, { resolution: 1e-4 })
    expect(n.lo * P0).toBeLessThanOrEqual(pMax + 1e-12)
    expect(n.hi * P0).toBeGreaterThan(pMax)
    expect(n.hi - n.lo).toBeLessThanOrEqual(1e-4 + 1e-12)
    expect(Math.abs(n.lo * P0 - pMax) / pMax).toBeLessThan(1e-3)
    // at the tip the receiving voltage approaches V1/√2
    expect(n.points[n.points.length - 1].vm[1]).toBeCloseTo(V1 / Math.SQRT2, 1)
  })
  it('5-bus network: converges just below the bracket, fails just above it; voltages fall monotonically', () => {
    const base = fiveBusCase()
    const n = noseCurve(base)
    expect(n.lo).toBeGreaterThan(1.5)
    expect(n.hi - n.lo).toBeLessThanOrEqual(1e-3 + 1e-12)
    const below = solveCase(base, { loadScale: n.lo })
    expect(below.converged).toBe(true)
    const prev = n.points[n.points.length - 1]
    const above = iterateCase(base, { loadScale: n.hi }, { Vm: prev.vm, th: prev.vm.map(() => 0) })
    expect(above.run.converged).toBe(false)
    expect(solveCase(base, { loadScale: n.hi }).converged).toBe(false)
    const v5 = n.points.map((p) => p.vm[4])
    for (let k = 1; k < v5.length; k++) expect(v5[k]).toBeLessThan(v5[k - 1])
  })
})

describe('Experiments: answers are decided from the computed results', () => {
  it('every experiment computes, and its answer is one of its options', () => {
    for (const e of EXPERIMENTS) {
      const r = runExperiment(e)
      expect(r.before.converged, e.id).toBe(true)
      expect(e.options.map((o) => o.id)).toContain(e.answer(r))
      expect(e.explain(r).length).toBeGreaterThan(0)
      for (const row of e.rows) expect(row.get(r.before), `${e.id} ${row.label}`).not.toBeNull()
    }
  })
  it('the physics behind each experiment', () => {
    const get = (id: string) => runExperiment(EXPERIMENTS.find((e) => e.id === id)!)
    const q = get('qlimit')
    expect(q.after.bus[2].atQLimit).toBe(true)
    expect(q.after.bus[2].qGenMvar).toBeCloseTo(100, 6)
    expect(q.after.bus[2].vm).toBeLessThan(1.04)
    expect(EXPERIMENTS.find((e) => e.id === 'qlimit')!.answer(q)).toBe('fall')
    const cap = get('cap')
    expect(cap.after.bus[4].vm).toBeGreaterThan(cap.before.bus[4].vm)
    expect(cap.after.totals.pLoss).toBeLessThan(cap.before.totals.pLoss)
    expect(cap.after.bus[4].qShuntMvar).toBeCloseTo(50 * cap.after.bus[4].vm ** 2, 9)
    const n1 = get('n1')
    expect(n1.after.converged).toBe(true)
    expect(n1.after.totals.pLoad).toBeCloseTo(n1.before.totals.pLoad, 9)
    expect(n1.after.lines.find((l) => l.id === '2–4')!.inService).toBe(false)
    const st = get('start')
    expect(EXPERIMENTS.find((e) => e.id === 'start')!.answer(st)).toBe('other')
    const nose = get('nose')
    expect(EXPERIMENTS.find((e) => e.id === 'nose')!.answer(nose)).toBe('mid')
    expect(nose.noseFree!.lo).toBeGreaterThan(nose.nose!.lo) // without the Q limit the nose is further out
  })
  it('a split network (an isolated bus) is reported, not solved', () => {
    const s = solveCase(saadatCase(), { outages: ['1–3', '2–3'] })
    expect(s.converged).toBe(false)
    expect(s.error).toMatch(/Bus 3/)
  })
  it('angles are only relative: rotating every voltage leaves the flows unchanged', () => {
    const s = solveCase(saadatCase())
    const rot = s.V.map((v) => mul(v, C(Math.cos(0.5), Math.sin(0.5))))
    const S1 = injections(s.Y, s.V)
    const S2 = injections(s.Y, rot)
    S1.forEach((x, i) => expect(abs(sub(x, S2[i]))).toBeLessThan(1e-12))
    expect(deg(arg(rot[0]))).toBeCloseTo(deg(0.5), 9)
  })
})
