import { describe, expect, it } from 'vitest'
import {
  DAILY_LOAD_MW,
  FACTORY_KW,
  TARIFF,
  curveStats,
  dailyCommitment,
  enumerate,
  evaluateCombo,
  monthlyBill,
  optimalCommitment,
  priorityCommitment,
  priorityOrder,
  shiftLoad,
  twoPartBill,
} from '../src/powersys/modules/economic/commitment.ts'
import {
  CURRENCY,
  closedFormLambda,
  cost,
  dispatch,
  dispatchBreakpoints,
  ic,
  indiaCase,
  itlOf,
  lossOf,
  saadatCase,
  saadatWithLimits,
  scaleFuel,
  type DispatchOk,
  type Unit,
} from '../src/powersys/modules/economic/dispatch.ts'
import { EXPERIMENTS } from '../src/powersys/modules/economic/experiments.ts'
import { newtonLagrangian } from '../src/powersys/modules/economic/lagrangian.ts'

/*
 * Module 11 — Economic Operation. One published reference (Saadat, Power System Analysis, Example 7.4), whose answer
 * is DERIVED here from the closed form; every other check is an independent method: the exact breakpoint solution
 * and an exhaustive grid search (limits), Newton on the full Lagrangian and a grid search on the loss-constrained
 * balance (losses), enumeration against the priority list (commitment), and direct arithmetic (load curve, tariff).
 */

const ok = (d: ReturnType<typeof dispatch>): DispatchOk => {
  if (!d.ok) throw new Error(d.message)
  return d
}

/** Kuhn–Tucker conditions of the dispatch: free units at L·IC = λ, at P_min L·IC ≥ λ, at P_max L·IC ≤ λ. */
function expectKkt(units: Unit[], d: DispatchOk, tol: number) {
  units.forEach((u, i) => {
    if (!u.on) return
    const eff = ic(u, d.P[i]) * d.pf[i]
    expect(d.P[i]).toBeGreaterThanOrEqual(u.pMin - 1e-9)
    expect(d.P[i]).toBeLessThanOrEqual(u.pMax + 1e-9)
    if (d.P[i] > u.pMin + 1e-6 && d.P[i] < u.pMax - 1e-6) expect(Math.abs(eff - d.lambda)).toBeLessThan(tol)
    else if (d.P[i] <= u.pMin + 1e-6) expect(eff).toBeGreaterThanOrEqual(d.lambda - tol)
    else expect(eff).toBeLessThanOrEqual(d.lambda + tol)
  })
}

/** Exhaustive grid search over (P1, P2) with P3 from the balance (lossless): the cheapest feasible dispatch. */
function gridSearchLossless(units: Unit[], demand: number, h: number) {
  const [u1, u2, u3] = units
  let best = Infinity
  for (let p1 = u1.pMin; p1 <= u1.pMax + 1e-9; p1 += h)
    for (let p2 = u2.pMin; p2 <= u2.pMax + 1e-9; p2 += h) {
      const p3 = demand - p1 - p2
      if (p3 < u3.pMin - 1e-9 || p3 > u3.pMax + 1e-9) continue
      best = Math.min(best, cost(u1, p1) + cost(u2, p2) + cost(u3, p3))
    }
  return best
}

describe('Saadat Example 7.4 — no limits, no losses', () => {
  const c = saadatCase()
  // the published data: C1 = 500 + 5.3P + 0.004P², C2 = 400 + 5.5P + 0.006P², C3 = 200 + 5.8P + 0.009P² $/h; P_D = 800 MW
  const a = [500, 400, 200]
  const b = [5.3, 5.5, 5.8]
  const cc = [0.004, 0.006, 0.009]
  const PD = 800
  // closed form derived here: λ = (P_D + Σ b_i/2c_i) / Σ 1/2c_i, P_i = (λ − b_i)/2c_i
  const lam = (PD + b.reduce((s, bi, i) => s + bi / (2 * cc[i]), 0)) / cc.reduce((s, ci) => s + 1 / (2 * ci), 0)
  const P = b.map((bi, i) => (lam - bi) / (2 * cc[i]))

  it('the case holds the published coefficients', () => {
    expect(c.units.map((u) => [u.a, u.b, u.c])).toEqual(a.map((ai, i) => [ai, b[i], cc[i]]))
    expect(c.demand).toBe(PD)
  })
  it('closed form: λ = 8.5 $/MWh, P = 400, 250, 150 MW (the published answer)', () => {
    expect(lam).toBeCloseTo(8.5, 12)
    expect(P[0]).toBeCloseTo(400, 9)
    expect(P[1]).toBeCloseTo(250, 9)
    expect(P[2]).toBeCloseTo(150, 9)
    expect(closedFormLambda(c.units, PD)).toBeCloseTo(lam, 12)
  })
  it('the λ-iteration gives the same λ and outputs (1e-9), in one Newton step', () => {
    const d = ok(dispatch(c.units, PD))
    expect(Math.abs(d.lambda - lam)).toBeLessThan(1e-9)
    d.P.forEach((p, i) => expect(Math.abs(p - P[i])).toBeLessThan(1e-9))
    expect(d.steps.length).toBe(2)
    expect(d.steps[0].next).toBe('newton')
    expect(Math.abs(d.steps[1].mismatch)).toBeLessThan(1e-9)
    const total = a.reduce((s, ai, i) => s + ai + b[i] * P[i] + cc[i] * P[i] ** 2, 0)
    expect(d.total).toBeCloseTo(total, 9)
    expect(d.total).toBeCloseTo(6682.5, 9)
  })
  it('the breakpoint method agrees too, and no wide limit binds anywhere on the slider', () => {
    for (let pd = c.range[0]; pd <= c.range[1]; pd += 50) {
      const d = ok(dispatch(c.units, pd))
      const e = ok(dispatchBreakpoints(c.units, pd))
      expect(Math.abs(d.lambda - closedFormLambda(c.units, pd))).toBeLessThan(1e-9)
      expect(Math.abs(e.lambda - d.lambda)).toBeLessThan(1e-9)
      expect(d.limit.every((l) => l === null)).toBe(true)
    }
  })
})

describe('Dispatch with generator limits (no losses)', () => {
  const cases = [saadatWithLimits(), { ...indiaCase(), B: null }]
  it('KKT conditions hold, and the breakpoint solution agrees (λ and P to 1e-7)', () => {
    for (const c of cases)
      for (let pd = c.range[0]; pd <= c.range[1]; pd += 12.5) {
        const d = ok(dispatch(c.units, pd))
        expectKkt(c.units, d, 1e-7)
        expect(Math.abs(d.mismatch)).toBeLessThan(1e-6)
        const e = ok(dispatchBreakpoints(c.units, pd))
        d.P.forEach((p, i) => expect(Math.abs(p - e.P[i])).toBeLessThan(1e-7))
        if (d.limit.some((l) => l === null)) expect(Math.abs(d.lambda - e.lambda)).toBeLessThan(1e-7)
      }
  })
  it('an exhaustive 0.5 MW grid search finds no cheaper dispatch (within the grid’s own error)', () => {
    for (const c of cases)
      for (const pd of [c.range[0] + 50, (c.range[0] + c.range[1]) / 2, c.range[1] - 40]) {
        const d = ok(dispatch(c.units, pd))
        const g = gridSearchLossless(c.units, pd, 0.5)
        // the grid optimum can only be higher; with h = 0.5 MW its error is ≤ Σ c_i·h² (here < 1 $ or ₹ per hour)
        const tol = c.units.reduce((s, u) => s + u.c, 0) * 0.25 * 2
        expect(g).toBeGreaterThanOrEqual(d.total - 1e-6)
        expect(g - d.total).toBeLessThan(tol)
      }
  })
  it('at 975 MW the limited textbook units give λ = 9.4 $/MWh with Unit 1 at 450 MW (derived from the two free units)', () => {
    const c = saadatWithLimits()
    const d = ok(dispatch(c.units, 975))
    const [, u2, u3] = c.units
    const lam = (975 - 450 + u2.b / (2 * u2.c) + u3.b / (2 * u3.c)) / (1 / (2 * u2.c) + 1 / (2 * u3.c))
    expect(d.lambda).toBeCloseTo(lam, 9)
    expect(d.limit[0]).toBe('max')
    expect(d.P[0]).toBeCloseTo(450, 9)
    expect(ic(c.units[0], 450)).toBeLessThan(d.lambda)
  })
})

describe('Dispatch with transmission losses (B coefficients)', () => {
  const c = indiaCase()
  const B = c.B!
  /** Grid search on (P1, P2), P3 from the balance P1 + P2 + P3 − P_D − PᵀBP = 0 (the smaller root of the quadratic). */
  function gridSearchLossy(demand: number, h: number, around: number[], span: number) {
    const [u1, u2, u3] = c.units
    let best = Infinity
    for (let p1 = Math.max(u1.pMin, around[0] - span); p1 <= Math.min(u1.pMax, around[0] + span) + 1e-9; p1 += h)
      for (let p2 = Math.max(u2.pMin, around[1] - span); p2 <= Math.min(u2.pMax, around[1] + span) + 1e-9; p2 += h) {
        const qa = B[2][2]
        const qb = 2 * (B[0][2] * p1 + B[1][2] * p2) - 1
        const rest = B[0][0] * p1 * p1 + B[1][1] * p2 * p2 + 2 * B[0][1] * p1 * p2
        const qc = demand + rest - p1 - p2
        const disc = qb * qb - 4 * qa * qc
        if (disc < 0) continue
        const p3 = (-qb - Math.sqrt(disc)) / (2 * qa)
        if (p3 < u3.pMin - 1e-9 || p3 > u3.pMax + 1e-9) continue
        best = Math.min(best, cost(u1, p1) + cost(u2, p2) + cost(u3, p3))
      }
    return best
  }
  it('the loss formula and incremental losses match their definitions', () => {
    const P = [500, 300, 100]
    let PL = 0
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) PL += P[i] * B[i][j] * P[j]
    expect(lossOf(P, B)).toBeCloseTo(PL, 12)
    // ∂P_L/∂P_i by central differences
    const itl = itlOf(P, B)
    for (let i = 0; i < 3; i++) {
      const up = P.map((p, k) => (k === i ? p + 1e-3 : p))
      const dn = P.map((p, k) => (k === i ? p - 1e-3 : p))
      expect(itl[i]).toBeCloseTo((lossOf(up, B) - lossOf(dn, B)) / 2e-3, 9)
    }
  })
  it('power balance ΣP = P_D + P_L to 1e-6 MW and the coordination equations hold, across the range', () => {
    for (let pd = c.range[0]; pd <= c.range[1]; pd += 25) {
      const d = ok(dispatch(c.units, pd, B))
      const sum = d.P.reduce((s, p) => s + p, 0)
      expect(Math.abs(sum - pd - lossOf(d.P, B))).toBeLessThan(1e-6)
      d.pf.forEach((L, i) => expect(L).toBeCloseTo(1 / (1 - 2 * B[i].reduce((s, bij, j) => s + bij * d.P[j], 0)), 12))
      expectKkt(c.units, d, 1e-6)
    }
  })
  it('Newton on the full Lagrangian (an independent method) reaches the same dispatch', () => {
    for (let pd = c.range[0]; pd <= c.range[1]; pd += 50) {
      const d = ok(dispatch(c.units, pd, B))
      const n = newtonLagrangian(c.units, pd, B)!
      expect(n).not.toBeNull()
      n.P.forEach((p, i) => expect(Math.abs(p - d.P[i])).toBeLessThan(1e-6))
      expect(Math.abs(n.total - d.total)).toBeLessThan(1e-3)
      if (d.limit.some((l) => l === null)) expect(Math.abs(n.lambda - d.lambda)).toBeLessThan(1e-6)
    }
  })
  it('a 0.05 MW grid search on the loss-constrained balance finds no cheaper dispatch near it', () => {
    for (const pd of [600, 900, 1150]) {
      const d = ok(dispatch(c.units, pd, B))
      const g = gridSearchLossy(pd, 0.05, d.P, 3)
      expect(g).toBeGreaterThanOrEqual(d.total - 1e-3)
      expect(g - d.total).toBeLessThan(1)
    }
  })
  it('the remote unit (highest penalty factor) is dispatched less once losses are included', () => {
    const d0 = ok(dispatch(c.units, 900))
    const d1 = ok(dispatch(c.units, 900, B))
    expect(d1.pf[0]).toBeGreaterThan(d1.pf[1])
    expect(d1.pf[0]).toBeGreaterThan(d1.pf[2])
    expect(d1.P[0]).toBeLessThan(d0.P[0])
    expect(d1.loss).toBeGreaterThan(0)
  })
  it('the λ-iteration converges: the mismatch falls to below 1e-9 MW', () => {
    const d = ok(dispatch(c.units, 900, B))
    const last = d.steps[d.steps.length - 1]
    expect(last.next).toBe('done')
    expect(Math.abs(last.mismatch)).toBeLessThan(1e-9)
    expect(d.steps.length).toBeLessThan(30)
  })
})

describe('Infeasible demand is reported, not dispatched', () => {
  it('above Σ P_max, below Σ P_min, nothing on — with and without losses', () => {
    const c = indiaCase()
    const over = dispatch(c.units, 1400)
    const under = dispatch(c.units, 250)
    expect(over.ok).toBe(false)
    expect(!over.ok && over.reason).toBe('over')
    expect(!under.ok && under.reason).toBe('under')
    const none = dispatch(
      c.units.map((u) => ({ ...u, on: false })),
      500,
    )
    expect(!none.ok && none.reason).toBe('none')
    // with losses 1,340 MW + losses is more than 1,350 MW of capacity can deliver
    const lossy = dispatch(c.units, 1340, c.B)
    expect(!lossy.ok && lossy.reason).toBe('over')
    // and switching off a unit removes its capacity
    const two = dispatch(
      c.units.map((u, i) => ({ ...u, on: i !== 0 })),
      800,
    )
    expect(!two.ok && two.reason).toBe('over')
  })
})

describe('Unit commitment (single period, no start-up costs)', () => {
  const c = indiaCase()
  it('2³ = 8 combinations; infeasible ones are excluded with the reason', () => {
    const all = enumerate(c.units, 700)
    expect(all.length).toBe(8)
    for (const k of all) {
      const capMin = c.units.reduce((s, u, i) => s + (k.on[i] ? u.pMin : 0), 0)
      const capMax = c.units.reduce((s, u, i) => s + (k.on[i] ? u.pMax : 0), 0)
      const feasible = k.on.some(Boolean) && capMin <= 700 && 700 <= capMax
      expect(k.feasible).toBe(feasible)
      expect(k.cost === null).toBe(!feasible)
    }
  })
  it('each combination costs Σ (no-load + fuel) of its economic dispatch; one checked by hand', () => {
    const only1 = evaluateCombo(c.units, [true, false, false], 500)
    const u = c.units[0]
    expect(only1.cost).toBeCloseTo(u.a + u.b * 500 + u.c * 500 * 500, 9)
  })
  it('the optimum is the cheapest feasible combination; the priority list follows full-load average cost', () => {
    const { avg, order } = priorityOrder(c.units)
    c.units.forEach((u, i) => expect(avg[i]).toBeCloseTo((u.a + u.b * u.pMax + u.c * u.pMax ** 2) / u.pMax, 9))
    expect(order).toEqual([0, 1, 2].sort((x, y) => avg[x] - avg[y]))
    for (let pd = 300; pd <= 1350; pd += 25) {
      const best = optimalCommitment(c.units, pd)!
      const feasible = enumerate(c.units, pd).filter((k) => k.feasible)
      for (const k of feasible) expect(best.cost!).toBeLessThanOrEqual(k.cost! + 1e-9)
      const pl = priorityCommitment(c.units, pd).combo!
      expect(pl.feasible).toBe(true)
      expect(pl.cost!).toBeGreaterThanOrEqual(best.cost! - 1e-9)
    }
  })
  it('at 700 MW the priority list (U1 + U2) is not optimal: U1 + U3 is cheaper', () => {
    const pl = priorityCommitment(c.units, 700).combo!
    const best = optimalCommitment(c.units, 700)!
    expect(pl.on).toEqual([true, true, false])
    expect(best.on).toEqual([true, false, true])
    expect(pl.cost!).toBeGreaterThan(best.cost!)
  })
  it('over the daily curve the exact commitment is never dearer than the priority list', () => {
    const day = dailyCommitment(c.units, DAILY_LOAD_MW)
    expect(day.hours.length).toBe(24)
    expect(day.costBest!).toBeLessThan(day.costPl!)
    expect(day.costBest!).toBeCloseTo(
      day.hours.reduce((s, h) => s + h.best!.cost!, 0),
      6,
    )
  })
})

describe('Load curve, load factor and tariff', () => {
  it('load factor = average / peak; the duration curve keeps the energy', () => {
    const s = curveStats(DAILY_LOAD_MW)
    const sum = DAILY_LOAD_MW.reduce((t, x) => t + x, 0)
    expect(s.energy).toBe(sum)
    expect(s.average).toBeCloseTo(sum / 24, 12)
    expect(s.peak).toBe(Math.max(...DAILY_LOAD_MW))
    expect(s.loadFactor).toBeCloseTo(sum / 24 / Math.max(...DAILY_LOAD_MW), 12)
    expect(s.ldc.reduce((t, x) => t + x, 0)).toBe(sum)
    for (let i = 1; i < 24; i++) expect(s.ldc[i]).toBeLessThanOrEqual(s.ldc[i - 1])
  })
  it('two-part bill = fixed × maximum demand + energy rate × kWh', () => {
    const bill = twoPartBill(500, 200000)
    expect(bill.fixed).toBe(TARIFF.fixedPerKwMonth * 500)
    expect(bill.energy).toBe(TARIFF.energyPerKwh * 200000)
    expect(bill.total).toBe(bill.fixed + bill.energy)
    const m = monthlyBill(FACTORY_KW)
    const kwh = FACTORY_KW.reduce((t, x) => t + x, 0) * TARIFF.days
    expect(m.kwh).toBe(kwh)
    expect(m.total).toBeCloseTo(TARIFF.fixedPerKwMonth * Math.max(...FACTORY_KW) + TARIFF.energyPerKwh * kwh, 9)
  })
  it('moving load out of the peak keeps the energy, lowers the maximum demand and the cost per kWh', () => {
    const before = monthlyBill(FACTORY_KW)
    for (const k of [0.25, 0.5, 1]) {
      const after = monthlyBill(shiftLoad(FACTORY_KW, k))
      expect(after.kwh).toBeCloseTo(before.kwh, 6)
      expect(after.md).toBeLessThan(before.md)
      expect(after.perKwh).toBeLessThan(before.perKwh)
      expect(after.stats.loadFactor).toBeGreaterThan(before.stats.loadFactor)
    }
    expect(monthlyBill(shiftLoad(FACTORY_KW, 1)).stats.loadFactor).toBeCloseTo(1, 9)
  })
  it('currencies and units are labelled', () => {
    expect(CURRENCY.USD.perH).toBe('$/h')
    expect(CURRENCY.USD.perMWh).toBe('$/MWh')
    expect(CURRENCY.INR.perH).toBe('₹/h')
    expect(CURRENCY.INR.perMWh).toBe('₹/MWh')
    expect(saadatCase().currency).toBe('USD')
    expect(indiaCase().currency).toBe('INR')
  })
})

describe('A fuel-price change scales the whole cost curve', () => {
  it('scaleFuel multiplies C(P) — and so IC(P) — by k at every output', () => {
    const u = indiaCase().units[1]
    const v = scaleFuel(u, 1.2)
    for (const p of [0, 100, 275.5, 450]) {
      expect(cost(v, p)).toBeCloseTo(1.2 * cost(u, p), 9)
      expect(ic(v, p)).toBeCloseTo(1.2 * ic(u, p), 9)
    }
  })
  it('fuel +20 % for Unit 2: the old dispatch would cost exactly 0.2·C₂(P₂) more; re-dispatching saves part of it', () => {
    const e = EXPERIMENTS.find((x) => x.id === 'fuel')!
    const { before, after } = e.run()
    const c = indiaCase()
    const P0 = before.d.P
    // the unchanged dispatch at the new price
    const unchanged = after.units.reduce((t, u, i) => t + cost(u, P0[i]), 0)
    expect(unchanged - before.d.total).toBeCloseTo(0.2 * cost(c.units[1], P0[1]), 6)
    expect(after.d.total).toBeLessThan(unchanged)
    expect(after.d.total).toBeGreaterThan(before.d.total)
    // the experiment's dispatch is the independent exact solution of the scaled units
    const exact = ok(dispatchBreakpoints(after.units, 900))
    after.d.P.forEach((p, i) => expect(Math.abs(p - exact.P[i])).toBeLessThan(1e-7))
    expect(after.units[1].a).toBeCloseTo(1.2 * c.units[1].a, 9)
    expect(after.units[1].c).toBeCloseTo(1.2 * c.units[1].c, 9)
    expect(after.d.P[1]).toBeLessThan(before.d.P[1])
  })
})

describe('Experiments: the right answer is decided from the computation', () => {
  it('every experiment runs, its answer is one of its options, and its explanation has no NaN', () => {
    for (const e of EXPERIMENTS) {
      const { before, after } = e.run()
      const ans = e.answer(before, after)
      expect(e.options.map((o) => o.id)).toContain(ans)
      for (const line of e.explain(before, after)) expect(line).not.toMatch(/NaN|undefined|Infinity/)
      for (const r of e.rows) {
        const v = r.get(after)
        expect(v === null || Number.isFinite(v)).toBe(true)
      }
    }
  })
  it('the physics the experiments teach', () => {
    const run = (id: string) => {
      const e = EXPERIMENTS.find((x) => x.id === id)!
      const r = e.run()
      return e.answer(r.before, r.after)
    }
    // the unit with the smallest c takes most of a rise
    const s = saadatCase()
    const smallestC = s.units.reduce((k, u, i) => (u.c < s.units[k].c ? i : k), 0)
    expect(run('demand')).toBe(`u${smallestC + 1}`)
    expect(run('limit')).toBe('more')
    expect(run('losses')).toBe('falls')
    expect(run('priority')).toBe('5')
    expect(run('fuel')).toBe('falls')
  })
})
