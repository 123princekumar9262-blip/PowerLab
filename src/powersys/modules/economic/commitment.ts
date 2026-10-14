import { cost, dispatch, type DispatchOk, type Unit } from './dispatch.ts'

/**
 * Unit commitment, deliberately scoped: which units to switch on for ONE load level (or each hour of a short daily
 * curve treated independently). No start-up or shut-down costs, no ramp limits, no minimum up/down times, no spinning
 * reserve, no transmission losses. Each committed unit pays its no-load cost a_i and is dispatched economically.
 *
 * Two methods: the priority list (commit units in order of full-load average cost until their capacity covers the
 * load) and the exact answer by enumerating every on/off combination (2ⁿ — 8 for three units).
 */

export interface Combo {
  /** Bit i set ⇔ unit i is on. */
  mask: number
  on: boolean[]
  label: string
  capMin: number
  capMax: number
  feasible: boolean
  /** Why it cannot supply the load (when infeasible). */
  why?: string
  dispatch: DispatchOk | null
  /** Total cost [currency/h] (null when infeasible). */
  cost: number | null
}

const withOn = (units: Unit[], on: boolean[]): Unit[] => units.map((u, i) => ({ ...u, on: on[i] }))
export const comboLabel = (units: Unit[], on: boolean[]) =>
  on.some(Boolean)
    ? units
        .filter((_, i) => on[i])
        .map((u) => u.name.replace('Unit ', 'U'))
        .join(' + ')
    : 'none'

export function evaluateCombo(units: Unit[], on: boolean[], demand: number): Combo {
  const mask = on.reduce((m, b, i) => m | ((b ? 1 : 0) << i), 0)
  const capMin = units.reduce((s, u, i) => s + (on[i] ? u.pMin : 0), 0)
  const capMax = units.reduce((s, u, i) => s + (on[i] ? u.pMax : 0), 0)
  const base = { mask, on, label: comboLabel(units, on), capMin, capMax }
  if (!on.some(Boolean)) return { ...base, feasible: false, why: 'no unit on', dispatch: null, cost: null }
  if (demand > capMax + 1e-9) return { ...base, feasible: false, why: `too small: at most ${capMax.toFixed(0)} MW`, dispatch: null, cost: null }
  if (demand < capMin - 1e-9) return { ...base, feasible: false, why: `too large: at least ${capMin.toFixed(0)} MW`, dispatch: null, cost: null }
  const d = dispatch(withOn(units, on), demand)
  if (!d.ok) return { ...base, feasible: false, why: d.message, dispatch: null, cost: null }
  return { ...base, feasible: true, dispatch: d, cost: d.total }
}

/** Every on/off combination, in binary order (all off first). */
export function enumerate(units: Unit[], demand: number): Combo[] {
  const n = units.length
  const out: Combo[] = []
  for (let m = 0; m < 1 << n; m++)
    out.push(
      evaluateCombo(
        units,
        units.map((_, i) => !!(m & (1 << i))),
        demand,
      ),
    )
  return out
}

/** The cheapest feasible combination (null when none can supply the load). */
export function optimalCommitment(units: Unit[], demand: number): Combo | null {
  return enumerate(units, demand)
    .filter((c) => c.feasible)
    .reduce<Combo | null>((best, c) => (!best || c.cost! < best.cost! - 1e-9 ? c : best), null)
}

/** Full-load average cost C_i(P_max)/P_max [currency/MWh] and the order it gives (cheapest first). */
export function priorityOrder(units: Unit[]): { avg: number[]; order: number[] } {
  const avg = units.map((u) => cost(u, u.pMax) / u.pMax)
  const order = units.map((_, i) => i).sort((x, y) => avg[x] - avg[y])
  return { avg, order }
}

/** The priority list: commit in order until Σ P_max ≥ load, then dispatch economically. */
export function priorityCommitment(units: Unit[], demand: number): { combo: Combo | null; order: number[]; avg: number[]; n: number } {
  const { avg, order } = priorityOrder(units)
  const on = units.map(() => false)
  let cap = 0
  let n = 0
  for (const i of order) {
    if (cap >= demand - 1e-9) break
    on[i] = true
    cap += units[i].pMax
    n++
  }
  if (cap < demand - 1e-9) return { combo: null, order, avg, n }
  return { combo: evaluateCombo(units, on, demand), order, avg, n }
}

// ── a daily load curve ─────────────────────────────────────────────────────────────────────────────────────────

/** An illustrative 24-hour system load curve [MW], hour 0 = 00:00–01:00 (not measured data). */
export const DAILY_LOAD_MW = [520, 490, 470, 460, 470, 520, 610, 720, 820, 880, 900, 910, 890, 870, 860, 870, 920, 1010, 1120, 1150, 1080, 940, 760, 610]

export interface HourPlan {
  hour: number
  load: number
  best: Combo | null
  pl: Combo | null
}

export function dailyCommitment(units: Unit[], loads: number[]): { hours: HourPlan[]; costBest: number | null; costPl: number | null } {
  const hours = loads.map((load, hour) => ({ hour, load, best: optimalCommitment(units, load), pl: priorityCommitment(units, load).combo }))
  const sum = (k: 'best' | 'pl') => (hours.every((h) => h[k]?.feasible) ? hours.reduce((s, h) => s + h[k]!.cost!, 0) : null)
  return { hours, costBest: sum('best'), costPl: sum('pl') }
}

// ── load curve and tariff ──────────────────────────────────────────────────────────────────────────────────────

export interface CurveStats {
  peak: number
  min: number
  average: number
  /** Energy over the curve [unit·h], each sample one hour. */
  energy: number
  loadFactor: number
  /** Load duration curve: the samples sorted from highest to lowest. */
  ldc: number[]
  peakHour: number
}

export function curveStats(loads: number[]): CurveStats {
  const energy = loads.reduce((s, x) => s + x, 0)
  const peak = Math.max(...loads)
  const average = energy / loads.length
  return { peak, min: Math.min(...loads), average, energy, loadFactor: average / peak, ldc: [...loads].sort((x, y) => y - x), peakHour: loads.indexOf(peak) }
}

/** An illustrative factory's daily demand [kW] (one shift pattern; not measured data). */
export const FACTORY_KW = [180, 170, 170, 170, 180, 220, 380, 560, 720, 760, 780, 780, 640, 760, 780, 760, 700, 560, 420, 320, 260, 220, 200, 190]

/**
 * Two-part tariff for one month: bill = fixed (demand) charge × maximum demand + energy charge × energy.
 * Rates are ILLUSTRATIVE (₹/kW per month and ₹/kWh), not a real tariff schedule.
 */
export const TARIFF = { fixedPerKwMonth: 350, energyPerKwh: 7, days: 30 }

export function twoPartBill(mdKw: number, kwh: number, t = TARIFF) {
  const fixed = t.fixedPerKwMonth * mdKw
  const energy = t.energyPerKwh * kwh
  const total = fixed + energy
  return { fixed, energy, total, perKwh: total / kwh }
}

/**
 * Move a share of the factory's load out of the hours above its average into the night hours (same energy each
 * day): `shift` = 0 … 1 of the excess above the daily average is moved, spread evenly over the hours below it.
 */
export function shiftLoad(loads: number[], shift: number): number[] {
  const avg = loads.reduce((s, x) => s + x, 0) / loads.length
  const moved = loads.reduce((s, x) => s + Math.max(0, x - avg) * shift, 0)
  const lowHours = loads.filter((x) => x < avg)
  const room = lowHours.reduce((s, x) => s + (avg - x), 0)
  return loads.map((x) => (x > avg ? x - (x - avg) * shift : x < avg ? x + (room > 0 ? ((avg - x) / room) * moved : 0) : x))
}

export function monthlyBill(dailyKw: number[], t = TARIFF) {
  const s = curveStats(dailyKw)
  const kwh = s.energy * t.days
  return { stats: s, kwh, md: s.peak, ...twoPartBill(s.peak, kwh, t) }
}
