import { solveNetwork, type Solution } from '../../network/solve.ts'
import type { Network } from '../../network/types.ts'
import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { gridNetwork } from './network.ts'

/**
 * What-if experiments on the Grid Explorer network: change one thing, predict, then compare the solved network
 * before and after. The correct answer is decided from the two solutions (never written in advance), and every
 * number in an explanation is read from them.
 */

export interface Row {
  label: string
  unit: string
  decimals: number
  get(s: Solution, n: Network): number | null
}

export interface Experiment {
  id: string
  title: string
  /** What is changed, in one sentence. */
  change: string
  question: string
  options: Choice[]
  answer(before: Solution, after: Solution): string
  /** The network after the change. */
  apply(): Network
  rows: Row[]
  explain(before: Solution, after: Solution, net: Network): string[]
  /** Elements to point at on the diagram. */
  focus: string[]
}

const comp = <K extends Network['components'][number]['kind']>(n: Network, id: string, kind: K) =>
  n.components.find((c) => c.id === id && c.kind === kind) as Extract<Network['components'][number], { kind: K }>
const pct = (a: number, b: number) => ((b - a) / a) * 100
const iA = (s: Solution, id: string) => (s.branch[id]?.energized ? s.branch[id].iFromKa * 1000 : 0)

const ROW = {
  townV: {
    label: 'Town voltage (11 kV bus)',
    unit: 'kV',
    decimals: 2,
    get: (s: Solution) => s.bus.lv.kv,
  },
  townPu: {
    label: 'Town voltage',
    unit: 'pu',
    decimals: 3,
    get: (s: Solution) => s.bus.lv.vPu,
  },
  genMw: {
    label: 'Generator output',
    unit: 'MW',
    decimals: 2,
    get: (s: Solution) => s.source.G1.pMw,
  },
  genMvar: {
    label: 'Generator reactive output',
    unit: 'Mvar',
    decimals: 2,
    get: (s: Solution) => s.source.G1.qMvar,
  },
  loss: {
    label: 'Total losses',
    unit: 'MW',
    decimals: 3,
    get: (s: Solution) => s.totals.lossMw,
  },
  l2I: {
    label: 'Current in the 33 kV line L2',
    unit: 'A',
    decimals: 0,
    get: (s: Solution) => iA(s, 'L2'),
  },
  l2Loss: {
    label: 'Losses in L2',
    unit: 'MW',
    decimals: 3,
    get: (s: Solution) => s.branch.L2.lossMw,
  },
  t3Load: {
    label: 'Loading of T3',
    unit: '%',
    decimals: 0,
    get: (s: Solution) => s.branch.T3.loadingPct ?? 0,
  },
  served: {
    label: 'Load supplied',
    unit: 'MW',
    decimals: 1,
    get: (s: Solution) => s.totals.loadMw,
  },
  unserved: {
    label: 'Load without supply',
    unit: 'MW',
    decimals: 1,
    get: (s: Solution) => s.totals.unservedMw,
  },
  mvA: {
    label: 'Grid substation 33 kV bus',
    unit: 'pu',
    decimals: 3,
    get: (s: Solution) => s.bus.mvA.vPu,
  },
  mvB: {
    label: 'Distribution substation 33 kV bus',
    unit: 'pu',
    decimals: 3,
    get: (s: Solution) => s.bus.mvB.vPu,
  },
  townQ: {
    label: 'Town reactive demand',
    unit: 'Mvar',
    decimals: 2,
    get: (_: Solution, n: Network) => comp(n, 'town', 'load').qMvar,
  },
} satisfies Record<string, Row>

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'peak',
    title: 'Evening peak: the town’s demand doubles',
    change: 'The town’s load goes from 16 MW to 32 MW (same 0.95 power factor).',
    question: 'What happens to the voltage the town receives?',
    options: [
      {
        id: 'same',
        label: 'It stays about the same — the generator holds its voltage',
      },
      { id: 'small', label: 'It falls a little (between 1 % and 10 %)' },
      { id: 'large', label: 'It falls a lot (more than 10 %)' },
    ],
    answer: (b, a) => {
      const drop = -pct(b.bus.lv.vPu, a.ok ? a.bus.lv.vPu : 0)
      return drop < 1 ? 'same' : drop <= 10 ? 'small' : 'large'
    },
    apply: () => {
      const n = gridNetwork()
      const t = comp(n, 'town', 'load')
      t.pMw = 32
      t.qMvar = 10.52
      return n
    },
    rows: [ROW.townV, ROW.townPu, ROW.l2I, ROW.l2Loss, ROW.t3Load, ROW.loss, ROW.genMw],
    explain: (b, a) => [
      `The town’s voltage falls from ${fx(b.bus.lv.kv, 2)} kV to ${fx(a.bus.lv.kv, 2)} kV (${fx(pct(b.bus.lv.vPu, a.bus.lv.vPu), 1)} %). The generator still holds ${fx(a.bus.gen.vPu, 3)} pu at its own terminals — but a voltage set at one end of a network cannot hold the far end.`,
      `The current in the 33 kV line rises from ${fx(iA(b, 'L2'), 0)} A to ${fx(iA(a, 'L2'), 0)} A. The voltage drop along it grows with the current, and its losses with the current squared: ${fx(b.branch.L2.lossMw, 3)} → ${fx(a.branch.L2.lossMw, 3)} MW (× ${fx(a.branch.L2.lossMw / b.branch.L2.lossMw, 1)}).`,
      `T3 is now loaded to ${fx(a.branch.T3.loadingPct ?? 0, 0)} % of its rating. A real utility could not run like this: protection would trip the overloaded transformer, or load would be shed. The network was designed for the normal demand.`,
    ],
    focus: ['town', 'L2', 'T3', 'lv'],
  },
  {
    id: 'cb2',
    title: 'Open breaker CB2 on the 33 kV line',
    change: 'CB2 opens, switching out the 33 kV line L2.',
    question: 'Which consumers lose their supply?',
    options: [
      { id: 'town', label: 'Only the town' },
      { id: 'both', label: 'The town and the factory' },
      { id: 'none', label: 'Neither — the power finds another path' },
    ],
    answer: (_, a) => (!a.load.town.served && a.load.factory.served ? 'town' : !a.load.town.served && !a.load.factory.served ? 'both' : 'none'),
    apply: () => {
      const n = gridNetwork()
      comp(n, 'CB2', 'breaker').closed = false
      return n
    },
    rows: [ROW.served, ROW.unserved, ROW.genMw, ROW.mvA],
    explain: (b, a) => [
      `This network is radial: every consumer has exactly one path from the source. The factory is supplied from the 33 kV bus before CB2, so it keeps its supply; the town is beyond the breaker and loses it — ${fx(a.totals.unservedMw, 0)} MW without supply.`,
      `The generator’s output falls at once from ${fx(b.source.G1.pMw, 1)} MW to ${fx(a.source.G1.pMw, 1)} MW. With less current there is less voltage drop: the grid substation’s 33 kV bus rises from ${fx(b.bus.mvA.vPu, 3)} to ${fx(a.bus.mvA.vPu, 3)} pu.`,
      'Real distribution networks add a second supply (a ring, or a normally open link to another substation) so one breaker operation does not black out a whole town.',
    ],
    focus: ['CB2', 'L2', 'town', 'factory'],
  },
  {
    id: 'tap',
    title: 'Remove the +5 % tap on the grid transformer',
    change: 'T2 is set to its nominal ratio, 220/33 kV, instead of 220/34.65 kV.',
    question: 'What happens to the town’s voltage?',
    options: [
      { id: 'rise', label: 'It rises' },
      { id: 'same', label: 'Nothing — the town has its own transformer' },
      { id: 'fall5', label: 'It falls by roughly 5 %' },
      { id: 'fall20', label: 'It falls by about 20 %' },
    ],
    answer: (b, a) => {
      const c = pct(b.bus.lv.vPu, a.bus.lv.vPu)
      return c > 1 ? 'rise' : c > -1 ? 'same' : c > -12 ? 'fall5' : 'fall20'
    },
    apply: () => {
      const n = gridNetwork()
      comp(n, 'T2', 'transformer').kvTo = 33
      return n
    },
    rows: [ROW.mvA, ROW.mvB, ROW.townPu, ROW.l2I, ROW.l2Loss],
    explain: (b, a) => [
      `A tap changes the transformer’s turns ratio, so it shifts every voltage beyond it by about the same percentage: the town falls from ${fx(b.bus.lv.vPu, 3)} to ${fx(a.bus.lv.vPu, 3)} pu (${fx(pct(b.bus.lv.vPu, a.bus.lv.vPu), 1)} %).`,
      `Slightly more than 5 %: at a lower voltage the same power needs more current (L2: ${fx(iA(b, 'L2'), 0)} → ${fx(iA(a, 'L2'), 0)} A), so the drop along the line grows too.`,
      'Utilities set taps to hold their customers’ voltage; on-load tap changers do it automatically as the load changes through the day.',
    ],
    focus: ['T2', 'mvA', 'mvB', 'lv'],
  },
  {
    id: 'pf',
    title: 'Correct the town’s power factor to 1.0',
    change: 'Capacitor banks in the town supply its 5.26 Mvar locally, so the town draws 16 MW and 0 Mvar from the network.',
    question: 'What happens to the current in the 33 kV line?',
    options: [
      { id: 'up', label: 'It rises' },
      { id: 'same', label: 'It stays the same — the town uses the same 16 MW' },
      { id: 'down', label: 'It falls' },
    ],
    answer: (b, a) => {
      const c = pct(iA(b, 'L2'), iA(a, 'L2'))
      return c > 1 ? 'up' : c < -1 ? 'down' : 'same'
    },
    apply: () => {
      const n = gridNetwork()
      comp(n, 'town', 'load').qMvar = 0
      return n
    },
    rows: [ROW.townQ, ROW.l2I, ROW.l2Loss, ROW.loss, ROW.townPu, ROW.genMvar],
    explain: (b, a) => [
      `The town still uses 16 MW, but no longer draws reactive power through the network. Current depends on the apparent power S = √(P² + Q²), not on P alone: the current in L2 falls from ${fx(iA(b, 'L2'), 0)} A to ${fx(iA(a, 'L2'), 0)} A (${fx(pct(iA(b, 'L2'), iA(a, 'L2')), 1)} %), and its losses with its square (${fx(b.branch.L2.lossMw, 3)} → ${fx(a.branch.L2.lossMw, 3)} MW).`,
      `The town’s voltage rises to ${fx(a.bus.lv.vPu, 3)} pu${a.bus.lv.vPu > 1.06 ? ' — now too high: with the capacitors installed, the utility would lower the transformer taps' : ''}. Reactive power is best supplied close to where it is used.`,
    ],
    focus: ['town', 'L2', 'T3'],
  },
  {
    id: 'lowv',
    title: 'Transmit at 33 kV instead of 220 kV',
    change: 'The generator steps up only to 33 kV, and a 33 kV line (the same conductor as L2) runs the whole 120 km to the grid substation’s 33 kV bus.',
    question: 'The same 28 MW must reach the same consumers. What happens?',
    options: [
      { id: 'fine', label: 'It works, with somewhat higher losses' },
      { id: 'loss', label: 'It works, but loses a large share of the power' },
      { id: 'none', label: 'There is no workable operating point' },
    ],
    answer: (_, a) => (!a.ok ? 'none' : a.totals.lossMw / a.totals.genMw > 0.15 ? 'loss' : 'fine'),
    apply: () => lowVoltageTransmission(),
    rows: [ROW.genMw, ROW.loss, ROW.served],
    explain: (b, a, n) => {
      const L1 = comp(n, 'L1', 'line')
      const xOhm = L1.xOhmPerKm * L1.lengthKm
      const pMax = (33 * 33) / xOhm
      const iLow = (Math.hypot(b.source.G1.pMw, b.source.G1.qMvar) / (Math.sqrt(3) * 33)) * 1000
      return [
        a.ok ? `The network still solves, with ${fx(a.totals.lossMw, 2)} MW of losses.` : `The load flow finds no operating point: ${a.islands[0]?.lf?.error ?? 'the iteration does not converge'}`,
        `At 33 kV the same power needs ${fx(220 / 33, 1)} times the current — about ${fx(iLow, 0)} A instead of ${fx(iA(b, 'L1'), 0)} A — and every ampere loses power in the line’s resistance (I²R: ${fx((220 / 33) ** 2, 0)} times the loss).`,
        `Worse, the most power a line can carry is about V²/X. For 120 km of this line X ≈ ${fx(xOhm, 0)} Ω, so even with both ends held at 33 kV it could carry at most ${fx(pMax, 1)} MW — less than the ${fx(b.totals.loadMw, 0)} MW needed. The voltage would collapse. That is why bulk power is transmitted at the highest practical voltage.`,
      ]
    },
    focus: ['L1', 'T1', 'T2'],
  },
  {
    id: 'cb1',
    title: 'The 220 kV line trips',
    change: 'Breaker CB1 opens, switching out the transmission line L1.',
    question: 'How much of the 28 MW of load keeps its supply?',
    options: [
      { id: 'all', label: 'All of it — the substations take over' },
      { id: 'part', label: 'Part of it' },
      { id: 'none', label: 'None of it' },
    ],
    answer: (_, a) => (a.totals.unservedMw === 0 ? 'all' : a.totals.loadMw === 0 ? 'none' : 'part'),
    apply: () => {
      const n = gridNetwork()
      comp(n, 'CB1', 'breaker').closed = false
      return n
    },
    rows: [ROW.served, ROW.unserved, ROW.genMw],
    explain: (_, a) => [
      `${fx(a.totals.unservedMw, 0)} MW lose their supply. Substations do not store or produce energy — every consumer beyond the line had a single path to the only source, and that path is open.`,
      'This is why transmission networks are meshed and planned to the “N − 1” criterion: losing any one element must not interrupt the supply.',
    ],
    focus: ['CB1', 'L1'],
  },
]

/** The same network transmitting at 33 kV: T1 13.8/33 kV, a 120 km 33 kV line straight to the 33 kV bus. */
export function lowVoltageTransmission(): Network {
  const n = gridNetwork()
  n.id = 'grid-explorer-33kv'
  n.buses = n.buses.filter((b) => b.id !== 'hvB').map((b) => (b.id === 'hvA' ? { ...b, kv: 33, name: 'Power-station switchyard (33 kV)' } : b))
  n.components = n.components.filter((c) => c.id !== 'T2')
  const T1 = comp(n, 'T1', 'transformer')
  T1.kvFrom = 33
  T1.name = 'Step-up transformer T1 (13.8/33 kV)'
  const L1 = comp(n, 'L1', 'line')
  Object.assign(L1, {
    name: '33 kV line, 120 km',
    to: 'mvA',
    rOhmPerKm: 0.12,
    xOhmPerKm: 0.35,
    bUsPerKm: 3.2,
    ratingMva: 40,
  })
  return n
}

/** Solve an experiment (cached per id: the networks are fixed). */
const cache = new Map<string, { before: Solution; after: Solution; net: Network }>()
export function runExperiment(e: Experiment) {
  let r = cache.get(e.id)
  if (!r) {
    const net = e.apply()
    r = { before: solveNetwork(gridNetwork()), after: solveNetwork(net), net }
    cache.set(e.id, r)
  }
  return r
}
