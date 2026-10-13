import type { BusType, LfBus } from '../../network/loadflow.ts'
import type { Network } from '../../network/types.ts'

/**
 * The load-flow cases of Module 5, in per unit on a 100 MVA base. A case is the data a load-flow program is given:
 * a bus table (type, set-points, loads) and a branch table (series impedance, line charging). Everything shown in the
 * module is computed from these tables.
 *
 *  (a) Saadat, Power System Analysis, Example 6.10 — three buses, three lines (no charging), slack 1.05∠0°,
 *      bus 2 a 400 + j250 MW/Mvar load, bus 3 a PV generator (200 MW at 1.04 pu).
 *  (b) An ILLUSTRATIVE 5-bus, 230 kV meshed network designed for this module (not a real utility's): two power
 *      plants, three load centres and seven overhead lines with typical 230 kV constants
 *      (0.05 + j0.48 Ω/km, 3.4 µS/km), so line charging is included.
 */

export interface CaseBus {
  name: string
  /** Short tag on the diagram. */
  tag: string
  type: BusType
  /** |V| set-point [pu] (slack, PV). */
  vSet: number
  /** Scheduled generation [MW] (PV; the slack's is solved). */
  pGenMw: number
  pLoadMw: number
  qLoadMvar: number
  /** Generator reactive limits [Mvar] (PV). */
  qMinMvar?: number
  qMaxMvar?: number
  /** Shunt capacitor bank [Mvar at 1 pu] — a constant susceptance, so it delivers B·|V|². */
  shuntMvar?: number
  /** Diagram position. */
  x: number
  y: number
}

export interface CaseLine {
  id: string
  /** Bus indices (0-based). */
  from: number
  to: number
  /** Series impedance r + jx and total charging susceptance b [pu]. */
  r: number
  x: number
  b: number
  /** Thermal rating [MVA], when known. */
  ratingMva?: number
  /** Physical data (display), when the case has it. */
  km?: number
  inService?: boolean
}

export interface LfCase {
  id: 'saadat' | 'five'
  name: string
  short: string
  baseMva: number
  /** Nominal voltage [kV] for display, when the case states one. */
  kv?: number
  buses: CaseBus[]
  lines: CaseLine[]
  /** Where the data come from. */
  source: string
  /** The bus where experiments add a shunt capacitor or watch the voltage (the weakest load bus). */
  weakBus: number
}

export const SAADAT_PUBLISHED = {
  v2: 0.971684,
  th2Deg: -2.696,
  th3Deg: -0.4988,
  p1Mw: 218.423,
  q1Mvar: 140.852,
  q3Mvar: 146.177,
}

export function saadatCase(): LfCase {
  return {
    id: 'saadat',
    name: 'Saadat 3-bus (Example 6.10)',
    short: 'Saadat 3-bus',
    baseMva: 100,
    buses: [
      { name: 'Bus 1', tag: '1', type: 'slack', vSet: 1.05, pGenMw: 0, pLoadMw: 0, qLoadMvar: 0, x: 140, y: 70 },
      { name: 'Bus 2', tag: '2', type: 'pq', vSet: 1, pGenMw: 0, pLoadMw: 400, qLoadMvar: 250, x: 140, y: 270 },
      { name: 'Bus 3', tag: '3', type: 'pv', vSet: 1.04, pGenMw: 200, pLoadMw: 0, qLoadMvar: 0, x: 520, y: 170 },
    ],
    lines: [
      { id: '1–2', from: 0, to: 1, r: 0.02, x: 0.04, b: 0 },
      { id: '1–3', from: 0, to: 2, r: 0.01, x: 0.03, b: 0 },
      { id: '2–3', from: 1, to: 2, r: 0.0125, x: 0.025, b: 0 },
    ],
    source: 'H. Saadat, Power System Analysis, Example 6.10 (100 MVA base; line charging neglected).',
    weakBus: 1,
  }
}

/** 230 kV overhead-line constants used for the illustrative network (typical single-circuit values). */
export const FIVE_LINE = { kv: 230, rOhmPerKm: 0.05, xOhmPerKm: 0.48, bUsPerKm: 3.4, ratingMva: 320 }

function line230(id: string, from: number, to: number, km: number): CaseLine {
  const zb = (FIVE_LINE.kv * FIVE_LINE.kv) / 100
  return {
    id,
    from,
    to,
    r: (FIVE_LINE.rOhmPerKm * km) / zb,
    x: (FIVE_LINE.xOhmPerKm * km) / zb,
    b: FIVE_LINE.bUsPerKm * 1e-6 * km * zb,
    ratingMva: FIVE_LINE.ratingMva,
    km,
  }
}

const FIVE_LINES: Array<[string, number, number, number]> = [
  ['1–2', 0, 1, 120],
  ['1–3', 0, 2, 80],
  ['2–3', 1, 2, 70],
  ['2–4', 1, 3, 90],
  ['3–4', 2, 3, 60],
  ['3–5', 2, 4, 140],
  ['4–5', 3, 4, 110],
]

export function fiveBusCase(): LfCase {
  return {
    id: 'five',
    name: 'Illustrative 5-bus meshed network (230 kV)',
    short: '5-bus meshed',
    baseMva: 100,
    kv: 230,
    buses: [
      { name: 'North plant', tag: '1', type: 'slack', vSet: 1.04, pGenMw: 0, pLoadMw: 0, qLoadMvar: 0, x: 120, y: 60 },
      { name: 'East plant', tag: '2', type: 'pv', vSet: 1.02, pGenMw: 160, pLoadMw: 0, qLoadMvar: 0, qMinMvar: -60, qMaxMvar: 90, x: 560, y: 60 },
      { name: 'City', tag: '3', type: 'pq', vSet: 1, pGenMw: 0, pLoadMw: 180, qLoadMvar: 60, x: 120, y: 230 },
      { name: 'Industrial park', tag: '4', type: 'pq', vSet: 1, pGenMw: 0, pLoadMw: 140, qLoadMvar: 70, x: 560, y: 230 },
      { name: 'Valley town', tag: '5', type: 'pq', vSet: 1, pGenMw: 0, pLoadMw: 70, qLoadMvar: 25, x: 340, y: 380 },
    ],
    lines: FIVE_LINES.map(([id, f, t, km]) => line230(id, f, t, km)),
    source: 'An illustrative network designed for this module — typical 230 kV line constants, not a real utility’s data.',
    weakBus: 4,
  }
}

export const CASES = { saadat: saadatCase, five: fiveBusCase }

const clone = (c: LfCase): LfCase => ({ ...c, buses: c.buses.map((b) => ({ ...b })), lines: c.lines.map((l) => ({ ...l })) })

/** Operating changes a student (or an experiment) can make to a case. */
export interface CaseEdits {
  /** Multiplier on every load (P and Q, so the power factor is kept). Generation set-points are unchanged. */
  loadScale?: number
  /** Lines switched out. */
  outages?: string[]
  /** Shunt capacitor added at a bus [Mvar at 1 pu]. */
  shunt?: { bus: number; mvar: number }
  /** Generator reactive limits enforced (default: as the case states them). */
  qLimits?: boolean
  /** Override a PV generator's upper reactive limit [Mvar]. */
  qMax?: { bus: number; mvar: number }
}

export function editCase(base: LfCase, e: CaseEdits): LfCase {
  const c = clone(base)
  const k = e.loadScale ?? 1
  for (const b of c.buses) {
    b.pLoadMw *= k
    b.qLoadMvar *= k
    if (e.qLimits === false) {
      delete b.qMinMvar
      delete b.qMaxMvar
    }
  }
  if (e.qMax) c.buses[e.qMax.bus].qMaxMvar = e.qMax.mvar
  for (const l of c.lines) l.inService = !(e.outages ?? []).includes(l.id)
  if (e.shunt && e.shunt.mvar !== 0) c.buses[e.shunt.bus].shuntMvar = (c.buses[e.shunt.bus].shuntMvar ?? 0) + e.shunt.mvar
  return c
}

export const activeLines = (c: LfCase) => c.lines.filter((l) => l.inService !== false)

/** The load-flow bus data: net injections (generation − load) in per unit, PV limits on the net injection. */
export function lfBuses(c: LfCase): LfBus[] {
  const S = c.baseMva
  return c.buses.map((b) => {
    const lf: LfBus = {
      type: b.type,
      p: (b.pGenMw - b.pLoadMw) / S,
      q: -b.qLoadMvar / S,
      v: b.type === 'pq' ? 1 : b.vSet,
    }
    if (b.type === 'pv') {
      if (b.qMinMvar !== undefined) lf.qMin = (b.qMinMvar - b.qLoadMvar) / S
      if (b.qMaxMvar !== undefined) lf.qMax = (b.qMaxMvar - b.qLoadMvar) / S
    }
    return lf
  })
}

/** Buses that cannot be reached from the slack bus through in-service lines (they would make Y_bus singular). */
export function unreachable(c: LfCase): number[] {
  const slack = c.buses.findIndex((b) => b.type === 'slack')
  const seen = new Set([slack])
  const stack = [slack]
  const lines = activeLines(c)
  while (stack.length) {
    const i = stack.pop()!
    for (const l of lines) {
      const k = l.from === i ? l.to : l.to === i ? l.from : -1
      if (k >= 0 && !seen.has(k)) {
        seen.add(k)
        stack.push(k)
      }
    }
  }
  return c.buses.map((_, i) => i).filter((i) => !seen.has(i))
}

/** The illustrative 5-bus case as a shared `Network` (km and Ω/km data), so the shared Y_bus builder and branch
 * flows can check this module's own calculations. */
export function fiveBusNetwork(): Network {
  const c = fiveBusCase()
  const id = (i: number) => `b${i + 1}`
  return {
    id: 'lf-five',
    name: c.name,
    baseMva: 100,
    fHz: 50,
    buses: c.buses.map((b, i) => ({ id: id(i), name: b.name, kv: FIVE_LINE.kv, x: b.x, y: b.y })),
    components: [
      ...FIVE_LINES.map(([lid, f, t, km]) => ({
        kind: 'line' as const,
        id: `L${lid}`,
        name: `Line ${lid}`,
        from: id(f),
        to: id(t),
        lengthKm: km,
        rOhmPerKm: FIVE_LINE.rOhmPerKm,
        xOhmPerKm: FIVE_LINE.xOhmPerKm,
        bUsPerKm: FIVE_LINE.bUsPerKm,
        ratingMva: FIVE_LINE.ratingMva,
      })),
      { kind: 'generator' as const, id: 'G1', name: 'North plant', bus: 'b1', mode: 'slack' as const, vPu: 1.04, ratedMva: 400 },
      { kind: 'generator' as const, id: 'G2', name: 'East plant', bus: 'b2', mode: 'pv' as const, vPu: 1.02, pMw: 160, qMinMvar: -60, qMaxMvar: 90, ratedMva: 250 },
      ...c.buses
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.pLoadMw > 0)
        .map(({ b, i }) => ({ kind: 'load' as const, id: `load${i + 1}`, name: b.name, bus: id(i), pMw: b.pLoadMw, qMvar: b.qLoadMvar })),
    ],
  }
}
