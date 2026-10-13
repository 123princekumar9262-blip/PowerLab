import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { assemble, iterateCase, noseCurve, solveCase, type CaseSolution, type NoseCurve } from './analysis.ts'
import type { NrRun } from './stepwise.ts'
import { CASES, type CaseEdits, type LfCase } from './systems.ts'
import { ybusSteps } from './ybusSteps.ts'

/**
 * Load-flow experiments: change one thing, predict, then compare the solved cases. The right answer is decided from
 * the computed results (never written in advance) and every number in an explanation is read from them.
 */

export type ExpId = 'nose' | 'qlimit' | 'cap' | 'n1' | 'start'

export interface ExpResult {
  base: LfCase
  before: CaseSolution
  after: CaseSolution
  edits: CaseEdits
  nose?: NoseCurve
  noseFree?: NoseCurve
  /** Poor-start experiment: the flat-start and the poor-start Newton runs. */
  flat?: NrRun
  poor?: NrRun
  poorV?: number
}

export interface Row {
  label: string
  unit: string
  decimals: number
  get(s: CaseSolution): number | null
}

export interface LfExperiment {
  id: ExpId
  title: string
  system: LfCase['id']
  change: string
  question: string
  options: Choice[]
  answer(r: ExpResult): string
  explain(r: ExpResult): string[]
  rows: Row[]
  /** Buses to point at on the diagram. */
  focus: number[]
}

const pct = (a: number, b: number) => ((b - a) / a) * 100
const vRow = (i: number, name: string): Row => ({ label: `|V| at ${name}`, unit: 'pu', decimals: 4, get: (s) => (s.converged ? s.bus[i].vm : null) })
const flowRow = (id: string): Row => ({
  label: `Line ${id} (sending end)`,
  unit: 'MW',
  decimals: 1,
  get: (s) => {
    const l = s.lines.find((x) => x.id === id)
    return s.converged && l ? (l.inService ? Math.abs(l.pFromMw) : 0) : null
  },
})
const LOSS: Row = { label: 'Total line losses', unit: 'MW', decimals: 3, get: (s) => (s.converged ? s.totals.pLoss : null) }
const SLACK_Q: Row = { label: 'Slack generator Q', unit: 'Mvar', decimals: 2, get: (s) => (s.converged ? s.bus.find((b) => b.type === 'slack')!.qGenMvar : null) }

/** The poor starting voltage used by the start experiment [pu]. */
export const POOR_START = 0.2

export const EXPERIMENTS: LfExperiment[] = [
  {
    id: 'nose',
    title: 'Raise the load until there is no solution',
    system: 'five',
    change:
      'Every load in the 5-bus network grows together (same power factor) in small steps; each step is a new load flow, started from the previous solution. Generation set-points stay; the slack plant supplies the rest.',
    question: 'How far can the total load grow before the load flow has no solution?',
    options: [
      { id: 'small', label: 'Only about 10–25 % more than today' },
      { id: 'mid', label: 'Somewhere between 1.25 and 3 times today’s load' },
      { id: 'any', label: 'Without limit — the slack bus supplies whatever is needed' },
    ],
    answer: (r) => (!r.nose || r.nose.lo >= 19.9 ? 'any' : r.nose.lo < 1.25 ? 'small' : r.nose.lo <= 3 ? 'mid' : 'any'),
    explain: (r) => {
      const n = r.nose!
      const last = n.points[n.points.length - 1]
      const firstLim = n.points.find((p) => p.qLimited.length > 0)
      const weak = r.base.weakBus
      return [
        `A solution exists up to a load multiplier of ${fx(n.lo, 3)} (it fails at ${fx(n.hi, 3)}): ${fx(n.maxLoadMw, 0)} MW of load instead of ${fx(n.baseLoadMw, 0)} MW. That is the network’s maximum loadability for this pattern of load growth.`,
        `At the tip of the nose the voltage at ${r.base.buses[weak].name} has fallen to ${fx(last.vm[weak], 3)} pu. The slack generator could supply more power, but the network cannot deliver it: the transfer is limited by the line reactances and by the reactive power available to hold the voltages up.`,
        firstLim
          ? `East plant reaches its ${fx(r.base.buses[1].qMaxMvar ?? 0, 0)} Mvar limit at a multiplier of about ${fx(firstLim.scale, 2)}; from then on it can no longer hold 1.02 pu and every voltage falls faster. Without that limit the nose would be at ${fx(r.noseFree!.lo, 2)}× (${fx(r.noseFree!.maxLoadMw, 0)} MW).`
          : 'No generator reaches a reactive limit before the nose.',
        'Near the nose the Jacobian becomes singular — that is why Newton–Raphson stops converging there. Real systems are operated with a large margin from this point.',
      ]
    },
    rows: [vRow(2, 'City'), vRow(3, 'Industrial park'), vRow(4, 'Valley town'), { label: 'Total load', unit: 'MW', decimals: 0, get: (s) => (s.converged ? s.totals.pLoad : null) }, LOSS],
    focus: [2, 3, 4],
  },
  {
    id: 'qlimit',
    title: 'A PV generator hits its reactive limit',
    system: 'saadat',
    change: 'In the Saadat system, the generator at bus 3 can produce at most 100 Mvar. Holding 1.04 pu needs more than that.',
    question: 'What happens to the voltage at bus 3?',
    options: [
      { id: 'hold', label: 'It stays at 1.04 pu — that is what a PV bus does' },
      { id: 'fall', label: 'It falls below 1.04 pu' },
      { id: 'rise', label: 'It rises above 1.04 pu' },
    ],
    answer: (r) => {
      const d = r.after.bus[2].vm - r.before.bus[2].vm
      return Math.abs(d) < 1e-4 ? 'hold' : d < 0 ? 'fall' : 'rise'
    },
    explain: (r) => [
      `To hold 1.04 pu, bus 3 would have to produce ${fx(r.before.bus[2].qGenMvar, 1)} Mvar — more than its 100 Mvar limit. The solver holds it at the limit (Q = ${fx(r.after.bus[2].qGenMvar, 1)} Mvar) and treats it as a PQ bus: its voltage becomes an unknown again.`,
      `Its voltage falls from ${fx(r.before.bus[2].vm, 4)} to ${fx(r.after.bus[2].vm, 4)} pu, and bus 2 follows (${fx(r.before.bus[1].vm, 4)} → ${fx(r.after.bus[1].vm, 4)} pu). The missing reactive power now comes from the slack generator, through the lines: its Q rises from ${fx(r.before.bus[0].qGenMvar, 1)} to ${fx(r.after.bus[0].qGenMvar, 1)} Mvar, and the losses rise from ${fx(r.before.totals.pLoss, 2)} to ${fx(r.after.totals.pLoss, 2)} MW.`,
      'A bus type is not fixed: a PV bus is a generator doing its job within its capability. In the iteration view you can see the switch happen after the first converged solution.',
    ],
    rows: [vRow(2, 'bus 3'), vRow(1, 'bus 2'), { label: 'Bus 3 generator Q', unit: 'Mvar', decimals: 2, get: (s) => (s.converged ? s.bus[2].qGenMvar : null) }, SLACK_Q, LOSS],
    focus: [2],
  },
  {
    id: 'cap',
    title: 'Add a shunt capacitor at the weak bus',
    system: 'five',
    change: 'A 50 Mvar capacitor bank (rated at 1 pu voltage) is connected at Valley town, the far end of the network.',
    question: 'What happens to Valley town’s voltage and to the network’s losses?',
    options: [
      { id: 'up-down', label: 'The voltage rises and the losses fall' },
      { id: 'up-up', label: 'The voltage rises and the losses rise' },
      { id: 'none', label: 'Nothing changes much — a capacitor uses no active power' },
    ],
    answer: (r) => {
      const dv = r.after.bus[4].vm - r.before.bus[4].vm
      const dl = r.after.totals.pLoss - r.before.totals.pLoss
      return dv < 0.005 ? 'none' : dl < 0 ? 'up-down' : 'up-up'
    },
    explain: (r) => [
      `Valley town rises from ${fx(r.before.bus[4].vm, 4)} to ${fx(r.after.bus[4].vm, 4)} pu (+${fx(pct(r.before.bus[4].vm, r.after.bus[4].vm), 1)} %). At that voltage the bank delivers B·|V|² = ${fx(r.after.bus[4].qShuntMvar, 1)} Mvar — more than its 50 Mvar rating, because it is above 1 pu.`,
      `That reactive power no longer has to travel down the long lines from the plants, so the line currents fall and the losses with them: ${fx(r.before.totals.pLoss, 3)} → ${fx(r.after.totals.pLoss, 3)} MW. The plants’ reactive output falls (North ${fx(r.before.bus[0].qGenMvar, 1)} → ${fx(r.after.bus[0].qGenMvar, 1)} Mvar, East ${fx(r.before.bus[1].qGenMvar, 1)} → ${fx(r.after.bus[1].qGenMvar, 1)} Mvar).`,
      'Reactive power is best supplied close to where it is used. In the load flow the capacitor is a shunt susceptance added to Y_bus’s diagonal — not a power injection — so its output depends on the voltage it helps to create.',
    ],
    rows: [vRow(4, 'Valley town'), vRow(3, 'Industrial park'), { label: 'Capacitor output', unit: 'Mvar', decimals: 2, get: (s) => (s.converged ? s.bus[4].qShuntMvar : null) }, LOSS, SLACK_Q],
    focus: [4],
  },
  {
    id: 'n1',
    title: 'A line trips: N − 1 in a meshed network',
    system: 'five',
    change: 'Line 2–4, which carries East plant’s power straight to the Industrial park, is switched out by its protection.',
    question: 'What happens?',
    options: [
      { id: 'lost', label: 'The Industrial park loses its supply' },
      { id: 'barely', label: 'The power reroutes through the other lines; voltages hardly change (under 2 %)' },
      { id: 'drops', label: 'The power reroutes, and the Industrial park’s voltage drops noticeably (more than 2 %)' },
    ],
    answer: (r) => (!r.after.converged ? 'lost' : -pct(r.before.bus[3].vm, r.after.bus[3].vm) > 2 ? 'drops' : 'barely'),
    explain: (r) => {
      const b = r.before
      const a = r.after
      const moved = a.lines
        .filter((l) => l.inService)
        .map((l) => ({ id: l.id, d: Math.abs(l.pFromMw) - Math.abs(b.lines.find((x) => x.id === l.id)!.pFromMw) }))
        .sort((x, y) => y.d - x.d)
      const tripped = b.lines.find((l) => l.id === '2–4')!
      return [
        `In a meshed network every bus has more than one path, so nobody loses supply: the ${fx(tripped.pFromMw, 1)} MW that line 2–4 carried now flows around it. The biggest increases are on line ${moved[0].id} (+${fx(moved[0].d, 1)} MW) and line ${moved[1].id} (+${fx(moved[1].d, 1)} MW).`,
        `The detour is longer — more reactance — so the voltages sag: the Industrial park falls from ${fx(b.bus[3].vm, 4)} to ${fx(a.bus[3].vm, 4)} pu (${fx(pct(b.bus[3].vm, a.bus[3].vm), 1)} %) and Valley town to ${fx(a.bus[4].vm, 4)} pu. Losses rise from ${fx(b.totals.pLoss, 2)} to ${fx(a.totals.pLoss, 2)} MW.`,
        'Planners run a load flow like this for every single outage (the N − 1 criterion): flows must stay within ratings and voltages within limits. Try other outages in Explore — one of them leaves no operating point at all.',
      ]
    },
    rows: ['1–2', '1–3', '2–3', '2–4', '3–4', '3–5', '4–5'].map(flowRow).concat([vRow(3, 'Industrial park'), vRow(4, 'Valley town'), LOSS]),
    focus: [1, 3],
  },
  {
    id: 'start',
    title: 'Flat start versus a poor start',
    system: 'saadat',
    change: `Newton–Raphson normally starts from the flat start (|V| = 1 pu, θ = 0 at every unknown bus). Here it starts instead from |V₂| = ${POOR_START} pu.`,
    question: 'Starting from the poor guess, what does Newton–Raphson do?',
    options: [
      { id: 'same', label: 'It reaches the same answer, perhaps in a few more iterations' },
      { id: 'other', label: 'It converges — but to a different answer' },
      { id: 'fail', label: 'It fails to converge' },
    ],
    answer: (r) => (!r.poor!.converged ? 'fail' : Math.abs(r.poor!.Vm[1] - r.flat!.Vm[1]) < 1e-6 ? 'same' : 'other'),
    explain: (r) => {
      const f = r.flat!
      const p = r.poor!
      return [
        p.converged
          ? `It converges in ${p.iterations} iterations — to |V₂| = ${fx(p.Vm[1], 4)} pu, not ${fx(f.Vm[1], 4)} pu. Both satisfy the load-flow equations to within 10⁻⁸ pu: the equations are nonlinear and have more than one solution.`
          : `It does not converge: ${p.error}`,
        p.converged
          ? `The second solution carries the same 400 MW at a voltage ${fx(f.Vm[1] / p.Vm[1], 0)} times lower, so with roughly that many times the current: the losses would be ${fx(r.after.totals.pLoss, 0)} MW instead of ${fx(r.before.totals.pLoss, 1)} MW. It is the lower half of the P–V nose — mathematically valid, physically useless.`
          : '',
        'Newton–Raphson converges quadratically only close to a solution; from far away it can go anywhere. The flat start works because a well-run network sits near 1 pu with small angles. Use the slider to try other starting voltages.',
      ].filter(Boolean)
    },
    rows: [
      vRow(1, 'bus 2'),
      { label: 'Voltage angle at bus 2', unit: '°', decimals: 3, get: (s) => (s.converged ? s.bus[1].thDeg : null) },
      { label: 'Slack generator P', unit: 'MW', decimals: 1, get: (s) => (s.converged ? s.bus[0].pGenMw : null) },
      LOSS,
    ],
    focus: [1],
  },
]

/** Run (cached) an experiment's computations. */
const cache = new Map<ExpId, ExpResult>()
export function runExperiment(e: LfExperiment): ExpResult {
  const hit = cache.get(e.id)
  if (hit) return hit
  const base = CASES[e.system]()
  const before = solveCase(base)
  let r: ExpResult
  switch (e.id) {
    case 'nose': {
      const nose = noseCurve(base)
      const edits = { loadScale: nose.lo }
      r = { base, before, after: solveCase(base, edits), edits, nose, noseFree: noseCurve(base, { qLimits: false }) }
      break
    }
    case 'qlimit': {
      const edits = { qMax: { bus: 2, mvar: 100 } }
      r = { base, before, after: solveCase(base, edits), edits }
      break
    }
    case 'cap': {
      const edits = { shunt: { bus: 4, mvar: 50 } }
      r = { base, before, after: solveCase(base, edits), edits }
      break
    }
    case 'n1': {
      const edits = { outages: ['2–4'] }
      r = { base, before, after: solveCase(base, edits), edits }
      break
    }
    case 'start': {
      const { run: flat } = iterateCase(base)
      const poor = startFrom(base, POOR_START)
      r = { base, before, after: poorSolution(base, poor), edits: {}, flat, poor, poorV: POOR_START }
      break
    }
  }
  cache.set(e.id, r)
  return r
}

/** Newton–Raphson on a case from |V| = v at every PQ bus (angles 0). */
export function startFrom(base: LfCase, v: number): NrRun {
  return iterateCase(base, {}, { Vm: base.buses.map(() => v), th: base.buses.map(() => 0) }).run
}

/** Results (flows, losses) for the solution a poor start reached. */
function poorSolution(base: LfCase, run: NrRun): CaseSolution {
  const { Y } = ybusSteps(base)
  if (!run.converged) return { ...solveCase(base), converged: false, error: run.error }
  return assemble(base, Y, run.V, run.S, run.qLimited, { converged: true, iterations: run.iterations, history: run.history })
}
