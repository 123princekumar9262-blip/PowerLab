/**
 * Economic load dispatch — the calculation core of Module 11 (no React, unit-tested in tests/powersys-economic.test.ts).
 *
 * Each committed thermal unit i has a fuel-cost curve C_i(P) = a_i + b_i·P + c_i·P² [currency/h, P in MW] and limits
 * P_min,i ≤ P_i ≤ P_max,i. The dispatch minimises Σ C_i(P_i) subject to the power balance Σ P_i = P_D + P_L, where the
 * transmission loss is the B-coefficient quadratic form P_L = Σ_i Σ_j P_i·B_ij·P_j (B in 1/MW; no B0 terms).
 *
 * Optimality (KKT): a unit between its limits runs where L_i·dC_i/dP_i = λ, with the penalty factor
 * L_i = 1/(1 − ∂P_L/∂P_i) (L_i = 1 without losses); a unit held at P_min has L_i·IC_i ≥ λ, at P_max L_i·IC_i ≤ λ.
 *
 * Two independent solutions are provided: the λ-iteration (Newton steps on λ, safeguarded by a bracket, recorded
 * step by step for display) and, without losses, the exact piecewise-linear solution of Σ P_i(λ) = P_D through the
 * breakpoints λ = IC_i(P_min,i), IC_i(P_max,i). A third, Newton on the full Lagrangian, is in lagrangian.ts.
 */

export type Currency = 'USD' | 'INR'
export const CURRENCY: Record<Currency, { sym: string; perH: string; perMWh: string; name: string }> = {
  USD: { sym: '$', perH: '$/h', perMWh: '$/MWh', name: 'US dollars' },
  INR: { sym: '₹', perH: '₹/h', perMWh: '₹/MWh', name: 'rupees' },
}

export interface Unit {
  id: string
  /** Short label, e.g. "Unit 1". */
  name: string
  /** What kind of plant (shown in words). */
  kind: string
  /** No-load cost coefficient [currency/h]. */
  a: number
  /** Linear coefficient [currency/MWh]. */
  b: number
  /** Quadratic coefficient [currency/MW²h]; must be > 0. */
  c: number
  pMin: number
  pMax: number
  on: boolean
}

export interface DispatchCase {
  id: string
  title: string
  currency: Currency
  units: Unit[]
  /** Loss coefficients [1/MW], symmetric; null = losses not modelled. */
  B: number[][] | null
  demand: number
  /** Demand range offered on the slider [MW]. */
  range: [number, number]
  /** Where the data come from, in words. */
  source: string
}

export const cost = (u: Unit, p: number) => u.a + u.b * p + u.c * p * p
/** Incremental cost dC/dP [currency/MWh]. */
export const ic = (u: Unit, p: number) => u.b + 2 * u.c * p
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * A change in the price of a unit's fuel. The whole cost curve is taken to be fuel cost — including the no-load
 * term a, the fuel burnt to keep the unit hot and spinning — so a price ×k scales a, b and c together: C → k·C.
 */
export const scaleFuel = (u: Unit, k: number): Unit => ({ ...u, a: u.a * k, b: u.b * k, c: u.c * k })

/** P_L = Σ Σ P_i B_ij P_j [MW]. */
export function lossOf(P: number[], B: number[][] | null): number {
  if (!B) return 0
  let s = 0
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) s += P[i] * B[i][j] * P[j]
  return s
}
/** Incremental transmission loss ∂P_L/∂P_i = 2 Σ_j B_ij P_j. */
export function itlOf(P: number[], B: number[][] | null): number[] {
  if (!B) return P.map(() => 0)
  return P.map((_, i) => 2 * P.reduce((s, pj, j) => s + B[i][j] * pj, 0))
}

/** One row of the λ-iteration, as shown to the student. */
export interface LambdaStep {
  k: number
  lambda: number
  P: number[]
  sumP: number
  loss: number
  /** ΣP − P_D − P_L [MW]. */
  mismatch: number
  /** How the next λ was chosen from this row. */
  next: 'newton' | 'bisection' | 'done'
}

export type LimitState = 'min' | 'max' | null

export interface DispatchOk {
  ok: true
  /** Output of every unit (0 for a unit that is off) [MW]. */
  P: number[]
  lambda: number
  loss: number
  /** Total cost of the committed units [currency/h]. */
  total: number
  costs: number[]
  ic: number[]
  /** ∂P_L/∂P_i. */
  itl: number[]
  /** Penalty factor L_i = 1/(1 − ∂P_L/∂P_i). */
  pf: number[]
  limit: LimitState[]
  steps: LambdaStep[]
  /** Final ΣP − P_D − P_L [MW]. */
  mismatch: number
  demand: number
}
export interface DispatchFail {
  ok: false
  reason: 'none' | 'over' | 'under'
  message: string
  capMin: number
  capMax: number
  demand: number
}
export type Dispatch = DispatchOk | DispatchFail

const TOL = 1e-9

/** The outputs that satisfy the coordination equations for a given λ (limits enforced). */
export function outputsAt(units: Unit[], B: number[][] | null, lambda: number, start?: number[]): number[] {
  const n = units.length
  const P = start ? start.slice() : units.map((u) => (u.on ? clamp((lambda - u.b) / (2 * u.c), u.pMin, u.pMax) : 0))
  if (!B) return units.map((u) => (u.on ? clamp((lambda - u.b) / (2 * u.c), u.pMin, u.pMax) : 0))
  // Gauss–Seidel on (2c_i + 2λB_ii)·P_i = λ(1 − 2Σ_{j≠i} B_ij P_j) − b_i, each clamped to its limits
  for (let it = 0; it < 500; it++) {
    let change = 0
    for (let i = 0; i < n; i++) {
      const u = units[i]
      if (!u.on) {
        P[i] = 0
        continue
      }
      let off = 0
      for (let j = 0; j < n; j++) if (j !== i) off += B[i][j] * P[j]
      const p = clamp((lambda * (1 - 2 * off) - u.b) / (2 * (u.c + lambda * B[i][i])), u.pMin, u.pMax)
      change = Math.max(change, Math.abs(p - P[i]))
      P[i] = p
    }
    if (change < 1e-12) break
  }
  return P
}

/** Σ ∂P_i/∂λ over the units between their limits (Saadat's expression, B0 = 0); off-diagonal coupling held fixed. */
function slope(units: Unit[], B: number[][] | null, lambda: number, P: number[]): number {
  let s = 0
  units.forEach((u, i) => {
    if (!u.on) return
    if (P[i] <= u.pMin + 1e-9 || P[i] >= u.pMax - 1e-9) return
    if (!B) {
      s += 1 / (2 * u.c)
      return
    }
    let off = 0
    for (let j = 0; j < units.length; j++) if (j !== i) off += B[i][j] * P[j]
    s += (u.c + B[i][i] * u.b - 2 * u.c * off) / (2 * (u.c + lambda * B[i][i]) ** 2)
  })
  return s
}

function capacity(units: Unit[]) {
  const on = units.filter((u) => u.on)
  return { on, capMin: on.reduce((s, u) => s + u.pMin, 0), capMax: on.reduce((s, u) => s + u.pMax, 0) }
}

/** The starting guess shown in the table: share the demand equally and take the mean incremental cost there. */
export function lambdaStart(units: Unit[], demand: number): number {
  const on = units.filter((u) => u.on)
  return on.reduce((s, u) => s + ic(u, clamp(demand / on.length, u.pMin, u.pMax)), 0) / on.length
}

/**
 * Economic dispatch by λ-iteration. Without losses and limits one Newton step is exact; with limits the step uses
 * only the units between their limits; with losses the outputs at each λ come from the coordination equations and
 * the step neglects ∂P_L/∂λ (so it converges linearly). A bracket [λ_lo, λ_hi] guarantees convergence.
 */
export function dispatch(units: Unit[], demand: number, B: number[][] | null = null, opts: { lambda0?: number; maxSteps?: number } = {}): Dispatch {
  const { on, capMin, capMax } = capacity(units)
  if (!on.length) return { ok: false, reason: 'none', message: 'No unit is switched on, so no demand can be supplied.', capMin, capMax, demand }
  if (!B) {
    if (demand > capMax + 1e-9)
      return { ok: false, reason: 'over', message: `The demand exceeds the most the committed units can produce (Σ P_max = ${capMax.toFixed(0)} MW).`, capMin, capMax, demand }
    if (demand < capMin - 1e-9)
      return { ok: false, reason: 'under', message: `The demand is below the least the committed units can run at (Σ P_min = ${capMin.toFixed(0)} MW).`, capMin, capMax, demand }
  }
  const f = (lam: number, start?: number[]) => {
    const P = outputsAt(units, B, lam, start)
    const sumP = P.reduce((s, p) => s + p, 0)
    const loss = lossOf(P, B)
    return { P, sumP, loss, mis: sumP - demand - loss }
  }
  // bracket: below every unit's IC at P_min, and above every unit's (penalised) IC at P_max
  let lo = Math.min(...on.map((u) => ic(u, u.pMin))) - 1
  let hi = Math.max(...on.map((u) => ic(u, u.pMax))) + 1
  if (B) {
    const pmax = units.map((u) => (u.on ? u.pMax : 0))
    const itl = itlOf(pmax, B)
    const worst = Math.max(...units.map((u, i) => (u.on ? 1 / Math.max(1e-6, 1 - itl[i]) : 1)))
    hi = hi * worst * 1.5
    lo = Math.min(lo, 0)
    let fh = f(hi)
    for (let k = 0; k < 40 && fh.mis < 0; k++) {
      hi *= 2
      fh = f(hi)
    }
    if (fh.mis < -1e-6)
      return {
        ok: false,
        reason: 'over',
        message: `The demand plus the transmission losses (${fh.loss.toFixed(1)} MW at full output) exceed what the committed units can produce (Σ P_max = ${capMax.toFixed(0)} MW).`,
        capMin,
        capMax,
        demand,
      }
    const fl = f(lo)
    if (fl.mis > 1e-6)
      return {
        ok: false,
        reason: 'under',
        message: `Even at their minimum outputs the committed units produce more than the demand plus losses (Σ P_min = ${capMin.toFixed(0)} MW).`,
        capMin,
        capMax,
        demand,
      }
  }
  const steps: LambdaStep[] = []
  let lam = clamp(opts.lambda0 ?? lambdaStart(units, demand), lo, hi)
  let r = f(lam)
  const maxSteps = opts.maxSteps ?? 200
  for (let k = 0; k < maxSteps; k++) {
    if (r.mis < 0) lo = lam
    else hi = lam
    const done = Math.abs(r.mis) < TOL || hi - lo < 1e-13 * Math.max(1, Math.abs(lam))
    const d = slope(units, B, lam, r.P)
    let next = d > 0 ? lam - r.mis / d : NaN
    let how: LambdaStep['next'] = 'newton'
    if (!(next > lo && next < hi)) {
      next = (lo + hi) / 2
      how = 'bisection'
    }
    steps.push({ k, lambda: lam, P: r.P, sumP: r.sumP, loss: r.loss, mismatch: r.mis, next: done ? 'done' : how })
    if (done) break
    lam = next
    r = f(lam, r.P)
  }
  return finish(units, demand, B, lam, r.P, steps)
}

function finish(units: Unit[], demand: number, B: number[][] | null, lambda: number, P: number[], steps: LambdaStep[]): DispatchOk {
  const loss = lossOf(P, B)
  const itl = itlOf(P, B)
  const costs = units.map((u, i) => (u.on ? cost(u, P[i]) : 0))
  return {
    ok: true,
    P,
    lambda,
    loss,
    total: costs.reduce((s, c) => s + c, 0),
    costs,
    ic: units.map((u, i) => ic(u, P[i])),
    itl,
    pf: itl.map((x) => 1 / (1 - x)),
    limit: units.map((u, i) => (!u.on ? null : P[i] <= u.pMin + 1e-7 ? 'min' : P[i] >= u.pMax - 1e-7 ? 'max' : null)),
    steps,
    mismatch: P.reduce((s, p) => s + p, 0) - demand - loss,
    demand,
  }
}

/** λ for the units without limits or losses: λ = (P_D + Σ b_i/2c_i) / Σ 1/2c_i (all committed units). */
export function closedFormLambda(units: Unit[], demand: number): number {
  const on = units.filter((u) => u.on)
  return (demand + on.reduce((s, u) => s + u.b / (2 * u.c), 0)) / on.reduce((s, u) => s + 1 / (2 * u.c), 0)
}

/**
 * The exact lossless dispatch with limits, independently of the iteration: Σ P_i(λ) is piecewise linear in λ with
 * breakpoints where a unit leaves or reaches a limit, so find the segment that contains P_D and interpolate.
 */
export function dispatchBreakpoints(units: Unit[], demand: number): Dispatch {
  const { on, capMin, capMax } = capacity(units)
  if (!on.length) return { ok: false, reason: 'none', message: 'No unit is switched on.', capMin, capMax, demand }
  if (demand > capMax + 1e-9) return { ok: false, reason: 'over', message: 'Demand above Σ P_max.', capMin, capMax, demand }
  if (demand < capMin - 1e-9) return { ok: false, reason: 'under', message: 'Demand below Σ P_min.', capMin, capMax, demand }
  const total = (lam: number) => on.reduce((s, u) => s + clamp((lam - u.b) / (2 * u.c), u.pMin, u.pMax), 0)
  const bps = [...new Set(on.flatMap((u) => [ic(u, u.pMin), ic(u, u.pMax)]))].sort((x, y) => x - y)
  let lam = bps[bps.length - 1]
  for (let k = 1; k < bps.length; k++) {
    const t0 = total(bps[k - 1])
    const t1 = total(bps[k])
    if (demand <= t1 + 1e-12) {
      lam = t1 - t0 < 1e-12 ? bps[k - 1] : bps[k - 1] + ((demand - t0) / (t1 - t0)) * (bps[k] - bps[k - 1])
      break
    }
  }
  if (demand <= total(bps[0]) + 1e-12) lam = bps[0]
  const P = units.map((u) => (u.on ? clamp((lam - u.b) / (2 * u.c), u.pMin, u.pMax) : 0))
  return finish(units, demand, null, lam, P, [])
}

/** Total cost if the demand were shared equally among the committed units (for comparison; may break limits). */
export function equalShareCost(units: Unit[], demand: number): number {
  const on = units.filter((u) => u.on)
  return on.reduce((s, u) => s + cost(u, demand / on.length), 0)
}

// ── the cases ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reference case: H. Saadat, Power System Analysis, Example 7.4 — three units, P_D = 800 MW, no limits, no losses
 * (λ = 8.5 $/MWh; 400, 250, 150 MW, derived in the test from the closed form). The book gives no limits; here each
 * unit is given 0–800 MW, wide enough that none binds anywhere on the demand slider (100–1,200 MW).
 */
export function saadatCase(): DispatchCase {
  return {
    id: 'saadat',
    title: 'Textbook case (Saadat, Example 7.4)',
    currency: 'USD',
    units: [
      { id: 'u1', name: 'Unit 1', kind: 'Thermal unit', a: 500, b: 5.3, c: 0.004, pMin: 0, pMax: 800, on: true },
      { id: 'u2', name: 'Unit 2', kind: 'Thermal unit', a: 400, b: 5.5, c: 0.006, pMin: 0, pMax: 800, on: true },
      { id: 'u3', name: 'Unit 3', kind: 'Thermal unit', a: 200, b: 5.8, c: 0.009, pMin: 0, pMax: 800, on: true },
    ],
    B: null,
    demand: 800,
    range: [100, 1200],
    source: 'H. Saadat, Power System Analysis, Example 7.4 (costs in $/h). Limits are not part of the example: 0–800 MW is used so that none binds.',
  }
}

/** The three textbook units with operating limits 200–450, 150–350 and 100–225 MW (results derived, not quoted). */
export function saadatWithLimits(): DispatchCase {
  const c = saadatCase()
  const lim: Array<[number, number]> = [
    [200, 450],
    [150, 350],
    [100, 225],
  ]
  c.units = c.units.map((u, i) => ({ ...u, pMin: lim[i][0], pMax: lim[i][1] }))
  c.id = 'saadat-limits'
  c.title = 'Textbook units with limits'
  c.range = [450, 1025]
  c.demand = 900
  c.source = 'The three units of Saadat Example 7.4. Limits used for this case: 200–450, 150–350 and 100–225 MW.'
  return c
}

/**
 * Illustrative Indian case, in rupees: a pit-head coal station far from the load, a coal station near the load
 * centre and a gas (combined-cycle) station. Coefficients and loss coefficients are ILLUSTRATIVE — chosen to make the ideas
 * visible, not the data of any real plant, tariff or network.
 */
export function indiaCase(): DispatchCase {
  return {
    id: 'india',
    title: 'Illustrative Indian plants (₹)',
    currency: 'INR',
    units: [
      { id: 'u1', name: 'Unit 1', kind: 'Pit-head coal, far from the load', a: 90000, b: 1750, c: 0.45, pMin: 150, pMax: 600, on: true },
      { id: 'u2', name: 'Unit 2', kind: 'Older coal unit near the load centre', a: 110000, b: 1900, c: 0.7, pMin: 100, pMax: 450, on: true },
      { id: 'u3', name: 'Unit 3', kind: 'Gas combined cycle', a: 20000, b: 2150, c: 1.1, pMin: 50, pMax: 300, on: true },
    ],
    B: [
      [0.00008, 0.00001, 0.00001],
      [0.00001, 0.00003, 0.000005],
      [0.00001, 0.000005, 0.00004],
    ],
    demand: 900,
    range: [350, 1300],
    source: 'Illustrative coefficients in ₹ (not real plant, tariff or network data).',
  }
}

export const CASES = { saadat: saadatCase, india: indiaCase } as const
export type CaseId = keyof typeof CASES
