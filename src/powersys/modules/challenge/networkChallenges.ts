import { solveNetwork, type Solution } from '../../network/solve.ts'
import type { Network } from '../../network/types.ts'
import { fx } from '../../ui/format.ts'
import { gridNetwork } from '../grid/network.ts'
import { bool, num, type Challenge, type Evaluation, type Measurement, type Objective } from './types.ts'

/*
 * Challenges solved with the network load flow (Modules 1, 3 and 5): the Grid Explorer network under new
 * conditions. Every value is read from solveNetwork; the objectives are the limits a utility works to.
 */

const V_MIN = 0.95
const V_MAX = 1.05
const SLD = { place: { G1: { side: 'left' as const }, factory: { side: 'below' as const }, town: { side: 'right' as const } }, viewBox: '-70 46 1170 290' }
const TAGS = {
  G1: 'G1',
  T1: 'T1',
  L1: 'L1 220 kV',
  T2: 'T2 220/33',
  L2: 'L2 33 kV',
  L3: 'L3 33 kV',
  T3: 'T3 33/11',
  factory: 'Factory',
  town: 'Town',
  gen: 'Generator',
  hvA: 'Switchyard',
  hvB: 'Grid s/s',
  mvA: 'Grid s/s 33 kV',
  mvB: 'Dist. s/s',
  lv: 'Town 11 kV',
}

const setTap = (n: Network, id: string, side: 'from' | 'to', pct: number) => {
  const t = n.components.find((c) => c.id === id)
  if (t?.kind !== 'transformer') return
  if (side === 'to') t.kvTo = 33 * (1 + pct / 100)
  else t.kvFrom = 33 * (1 + pct / 100)
}
const loadingOf = (sol: Solution, ids: string[]) => ids.map((id) => ({ id, pct: sol.branch[id]?.energized ? (sol.branch[id].loadingPct ?? 0) : 0 }))
const worst = (xs: Array<{ id: string; pct: number }>) => xs.reduce((a, b) => (b.pct > a.pct ? b : a))
const failed = (sol: Solution) => sol.islands.find((i) => i.lf && !i.lf.converged)

function noSolution(sol: Solution, objectives: Array<Pick<Objective, 'id' | 'label'>>, net: Network): Evaluation {
  const f = failed(sol)
  return {
    objectives: objectives.map((o) => ({ ...o, ok: false, detail: 'no operating point' })),
    measurements: [{ label: 'Load flow', value: 'no solution', tone: 'bad', note: f?.lf?.error }],
    diagram: { net, sol: null, ...SLD, tags: TAGS },
    alarm: f?.lf?.error,
  }
}

// ── 1 · the evening peak ────────────────────────────────────────────────────────────────────────────────────────

const PEAK = { town: 19, townQ: 6.24, factory: 15, factoryQ: 9.3 }

function peakNetwork(s: Record<string, unknown>): Network {
  const n = gridNetwork()
  for (const c of n.components) {
    if (c.kind === 'load' && c.id === 'town') Object.assign(c, { pMw: PEAK.town, qMvar: PEAK.townQ - Number(s.cap) })
    if (c.kind === 'load' && c.id === 'factory') Object.assign(c, { pMw: PEAK.factory, qMvar: PEAK.factoryQ })
    if (c.kind === 'generator') c.vPu = Number(s.genV)
  }
  setTap(n, 'T2', 'to', Number(s.t2))
  setTap(n, 'T3', 'from', Number(s.t3))
  return n
}

export const PEAK_CHALLENGE: Challenge = {
  id: 'peak',
  title: 'Hold the voltage through the evening peak',
  line: 'Taps, generator voltage and capacitors — keep every limit at peak demand',
  brief: [
    `It is 7 pm in winter. The town draws ${PEAK.town} MW at 0.95 power factor and the factory ${PEAK.factory} MW at 0.85 — more than the network was set up for.`,
    'The control room has three tools: the generator’s voltage set-point, the off-load taps of T2 and T3 (set before the peak), and a capacitor bank at the town’s 11 kV bus (0–8 Mvar).',
    `Your job: keep the town’s 11 kV supply within ±2 % of nominal, every 33 kV and 11 kV bus within ${V_MIN}–${V_MAX} pu, and no transformer or line above its rating.`,
  ],
  uses: ['grid', 'load-flow', 'per-unit'],
  level: 'Core',
  controls: [
    { kind: 'slider', id: 'genV', label: 'Generator voltage set-point', min: 0.95, max: 1.05, step: 0.01, unit: 'pu', decimals: 2 },
    { kind: 'slider', id: 't2', label: 'T2 tap (33 kV winding)', min: -5, max: 10, step: 1.25, unit: '%', decimals: 2, hint: '+ raises the 33 kV side' },
    { kind: 'slider', id: 't3', label: 'T3 tap (33 kV winding)', min: -10, max: 5, step: 2.5, unit: '%', decimals: 1, hint: '− raises the 11 kV side' },
    { kind: 'slider', id: 'cap', label: 'Capacitor bank at the town', min: 0, max: 8, step: 1, unit: 'Mvar', decimals: 0 },
  ],
  initial: { genV: 1.02, t2: 5, t3: -5, cap: 0 },
  solution: { genV: 1.02, t2: 5, t3: -2.5, cap: 4 },
  evaluate(s) {
    const net = peakNetwork(s)
    const sol = solveNetwork(net)
    const objs = [
      { id: 'town', label: 'Town 11 kV supply within 0.98–1.02 pu' },
      { id: 'buses', label: `Every 33 kV and 11 kV bus within ${V_MIN}–${V_MAX} pu` },
      { id: 'thermal', label: 'No transformer or line above 100 % of its rating' },
    ]
    if (!sol.ok) return noSolution(sol, objs, net)
    const town = sol.bus.lv.vPu
    const buses = ['mvA', 'mvB', 'lv'].map((id) => ({ id, v: sol.bus[id].vPu }))
    const low = buses.reduce((a, b) => (b.v < a.v ? b : a))
    const high = buses.reduce((a, b) => (b.v > a.v ? b : a))
    const w = worst(loadingOf(sol, ['T1', 'L1', 'T2', 'L2', 'T3']))
    const measurements: Measurement[] = [
      { label: 'Town 11 kV', value: fx(town, 3), unit: 'pu', note: `${fx(sol.bus.lv.kv, 2)} kV`, tone: town < 0.98 || town > 1.02 ? 'warn' : 'good' },
      { label: 'Distribution s/s 33 kV', value: fx(sol.bus.mvB.vPu, 3), unit: 'pu', tone: sol.bus.mvB.vPu < V_MIN || sol.bus.mvB.vPu > V_MAX ? 'warn' : undefined },
      { label: 'Grid s/s 33 kV', value: fx(sol.bus.mvA.vPu, 3), unit: 'pu', tone: sol.bus.mvA.vPu < V_MIN || sol.bus.mvA.vPu > V_MAX ? 'warn' : undefined },
      { label: 'T3 loading', value: fx(sol.branch.T3.loadingPct ?? 0, 0), unit: '%', tone: (sol.branch.T3.loadingPct ?? 0) > 100 ? 'bad' : undefined },
      { label: 'Losses', value: fx(sol.totals.lossMw, 3), unit: 'MW' },
    ]
    return {
      objectives: [
        { ...objs[0], ok: town >= 0.98 && town <= 1.02, detail: `${fx(town, 3)} pu` },
        { ...objs[1], ok: low.v >= V_MIN && high.v <= V_MAX, detail: `lowest ${fx(low.v, 3)} pu, highest ${fx(high.v, 3)} pu` },
        { ...objs[2], ok: w.pct <= 100, detail: `most loaded: ${w.id} at ${fx(w.pct, 0)} %` },
      ],
      measurements,
      diagram: { net, sol, highlight: [], ...SLD, tags: TAGS },
    }
  },
  hints: [
    'Start with the overload: T3 carries both the town’s active and reactive power. Which of your tools reduces the current through T3 without reducing what the town uses?',
    'Reactive power supplied by the capacitor bank at the town no longer flows through T3 and L2 — its current, its loading and the voltage drop all fall.',
    'Then trim the voltage with a tap: one step of T3 moves the town by about 2.5 %; one step of T2 moves every 33 kV and 11 kV bus by about 1.25 %.',
  ],
  debrief(s, e) {
    const sol = e.diagram?.sol
    const q = PEAK.townQ - num(s, 'cap')
    return [
      `The capacitors supply ${fx(num(s, 'cap'), 0)} Mvar locally, so T3 now carries ${fx(q, 2)} Mvar of the town’s reactive power instead of ${fx(PEAK.townQ, 2)}: its apparent power — and so its current — falls${sol ? ` (loading ${fx(sol.branch.T3.loadingPct ?? 0, 0)} %)` : ''}. Taps cannot do that: they move voltages, not power.`,
      'Utilities combine both: on-load tap changers for the voltage as the load moves through the day, and capacitor banks (switched in at peak) for the reactive power. Losses fall too, since every element carries less current.',
    ]
  },
}

// ── 2 · restore the town after a line fault ─────────────────────────────────────────────────────────────────────

function restoreNetwork(s: Record<string, unknown>): Network {
  const n = gridNetwork()
  n.components.push({ kind: 'line', id: 'L3', name: '33 kV line L3 (alternative route)', from: 'mvA', to: 'mvB', lengthKm: 18, rOhmPerKm: 0.17, xOhmPerKm: 0.38, bUsPerKm: 3, ratingMva: 25 })
  n.components.push({ kind: 'breaker', id: 'CB5', name: 'Breaker CB5 (line L3)', target: 'L3', closed: s.cb5 === true })
  for (const c of n.components) if (c.kind === 'breaker' && c.id === 'CB2') c.closed = s.cb2 === true
  setTap(n, 'T2', 'to', Number(s.t2))
  setTap(n, 'T3', 'from', Number(s.t3))
  return n
}

export const RESTORE_CHALLENGE: Challenge = {
  id: 'restore',
  title: 'Restore the town after a line fault',
  line: 'Switching and taps: bring the supply back without re-energising the fault',
  brief: [
    'A tree has fallen across the 33 kV line L2. Its protection opened CB2 in a fraction of a second, and the town is without supply.',
    'There is a second, older 33 kV route to the distribution substation — line L3, 18 km of smaller conductor, normally left open at breaker CB5.',
    'Restore the town. The faulted line must stay isolated until the line crew has cleared it, and the town’s 11 kV supply must be within 0.95–1.05 pu with nothing overloaded.',
  ],
  uses: ['grid', 'load-flow', 'faults'],
  level: 'Core',
  controls: [
    { kind: 'switch', id: 'cb2', label: 'CB2 — line L2 (faulted)', on: 'Closed', off: 'Open' },
    { kind: 'switch', id: 'cb5', label: 'CB5 — line L3 (alternative route)', on: 'Closed', off: 'Open' },
    { kind: 'slider', id: 't2', label: 'T2 tap (33 kV winding)', min: -5, max: 10, step: 1.25, unit: '%', decimals: 2 },
    { kind: 'slider', id: 't3', label: 'T3 tap (33 kV winding)', min: -10, max: 5, step: 2.5, unit: '%', decimals: 1, hint: '− raises the 11 kV side' },
  ],
  initial: { cb2: false, cb5: false, t2: 5, t3: -5 },
  solution: { cb2: false, cb5: true, t2: 5, t3: -7.5 },
  evaluate(s) {
    const objs = [
      { id: 'isolated', label: 'The faulted line L2 stays isolated (CB2 open)' },
      { id: 'served', label: 'The town is supplied' },
      { id: 'voltage', label: 'Town 11 kV supply within 0.95–1.05 pu' },
      { id: 'thermal', label: 'Nothing above 100 % of its rating' },
    ]
    if (bool(s, 'cb2')) {
      // closing onto the fault: the protection trips CB2 again at once — the network is as before the closure
      const net = restoreNetwork({ ...s, cb2: false })
      const sol = solveNetwork(net)
      return {
        objectives: objs.map((o) => ({ ...o, ok: false, detail: o.id === 'isolated' ? 'CB2 was closed onto the fault' : 'not assessed: the fault was re-energised' })),
        measurements: [{ label: 'Protection', value: 'CB2 tripped again', tone: 'bad', note: 'closed onto a permanent fault' }],
        diagram: { net, sol: sol.ok ? sol : null, ...SLD, tags: TAGS, highlight: ['L2', 'CB2'] },
        alarm:
          'You closed CB2 onto the fault. Full fault current flowed again until the protection re-tripped it — a hazard to the line crew and to the equipment. Leave a faulted line open until it is cleared.',
      }
    }
    const net = restoreNetwork(s)
    const sol = solveNetwork(net)
    if (!sol.ok) return noSolution(sol, objs, net)
    const served = sol.load.town.served
    const v = sol.bus.lv.vPu
    const w = worst(loadingOf(sol, ['T1', 'L1', 'T2', 'L3', 'T3']))
    return {
      objectives: [
        { ...objs[0], ok: true, detail: 'CB2 open' },
        { ...objs[1], ok: served, detail: served ? `${fx(sol.load.town.pMw, 0)} MW supplied` : `${fx(sol.totals.unservedMw, 0)} MW without supply` },
        { ...objs[2], ok: served && v >= V_MIN && v <= V_MAX, detail: served ? `${fx(v, 3)} pu` : 'no supply' },
        { ...objs[3], ok: w.pct <= 100, detail: `most loaded: ${w.id} at ${fx(w.pct, 0)} %` },
      ],
      measurements: [
        {
          label: 'Town supply',
          value: served ? fx(sol.bus.lv.kv, 2) : '0',
          unit: 'kV',
          note: served ? `${fx(v, 3)} pu` : 'no supply',
          tone: !served ? 'bad' : v < V_MIN || v > V_MAX ? 'warn' : 'good',
        },
        { label: 'Distribution s/s 33 kV', value: served ? fx(sol.bus.mvB.vPu, 3) : '—', unit: served ? 'pu' : undefined },
        { label: 'L3 loading', value: fx(sol.branch.L3?.energized ? (sol.branch.L3.loadingPct ?? 0) : 0, 0), unit: '%' },
        { label: 'Load without supply', value: fx(sol.totals.unservedMw, 1), unit: 'MW', tone: sol.totals.unservedMw > 0 ? 'bad' : undefined },
      ],
      diagram: { net, sol, ...SLD, tags: TAGS, highlight: [] },
    }
  },
  hints: [
    'Never close a breaker back onto a permanent fault. Which breaker connects the other route?',
    'L3 is longer and thinner than L2: with the same current it drops more voltage. Look at the town’s voltage once it is supplied.',
    'A tap on T3’s 33 kV winding compensates the extra drop for the town (each −2.5 % step raises the 11 kV side by about 2.5 %).',
  ],
  debrief(_s, e) {
    const sol = e.diagram?.sol
    return [
      `The town is back on supply through L3${sol ? `, at ${fx(sol.bus.lv.vPu, 3)} pu` : ''}. The alternative route is weaker — ${sol ? `the distribution substation’s 33 kV bus is at ${fx(sol.bus.mvB.vPu, 3)} pu` : 'its voltage drop is larger'} — so the tap had to compensate.`,
      'This is why distribution networks are built with alternative feeds (rings, or radial feeders with normally-open points): a fault isolates one section, switching restores the rest, and the faulted section stays dead until it is repaired.',
    ]
  },
}

export const NETWORK_CHALLENGES = [PEAK_CHALLENGE, RESTORE_CHALLENGE]
