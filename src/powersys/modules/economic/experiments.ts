import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { evaluateCombo, optimalCommitment, priorityCommitment, type Combo } from './commitment.ts'
import { CURRENCY, cost, dispatch, ic, indiaCase, scaleFuel, saadatCase, saadatWithLimits, type DispatchCase, type DispatchOk, type Unit } from './dispatch.ts'
import { grp } from './fmt.ts'

/**
 * Predict-first experiments: change one thing, then compare two computed dispatches (or commitments). The correct
 * option is decided from the computed results, never written in advance, and every number in an explanation is
 * read from them.
 */

export interface Snapshot {
  units: Unit[]
  B: number[][] | null
  demand: number
  d: DispatchOk
  /** For commitment experiments: the combination shown. */
  combo?: Combo
}

export interface Row {
  label: string
  unit: string
  decimals: number
  get(s: Snapshot): number | null
}

export interface EdExperiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  /** The two columns of the comparison table. */
  cols: [string, string]
  currency: 'USD' | 'INR'
  run(): { before: Snapshot; after: Snapshot }
  answer(before: Snapshot, after: Snapshot): string
  rows: Row[]
  explain(before: Snapshot, after: Snapshot): string[]
}

function snap(c: DispatchCase, demand: number, withLoss = false, units = c.units): Snapshot {
  const B = withLoss ? c.B : null
  const d = dispatch(units, demand, B)
  if (!d.ok) throw new Error(`experiment case infeasible: ${d.message}`)
  return { units, B, demand, d }
}

const pRow = (i: number): Row => ({ label: `Unit ${i + 1} output`, unit: 'MW', decimals: 1, get: (s) => s.d.P[i] })
const lamRow = (cur: string): Row => ({ label: 'λ (system incremental cost)', unit: cur, decimals: 3, get: (s) => s.d.lambda })
const costRow = (cur: string, decimals = 0): Row => ({ label: 'Total fuel cost', unit: cur, decimals, get: (s) => s.d.total })
const argmax = (xs: number[]) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0)

const USD = CURRENCY.USD
const INR = CURRENCY.INR

export const EXPERIMENTS: EdExperiment[] = [
  {
    id: 'demand',
    title: 'Demand rises by 100 MW',
    change: 'The textbook system (Saadat, Example 7.4) goes from 800 MW to 900 MW. No limits bind, no losses.',
    question: 'Which unit takes the largest share of the extra 100 MW?',
    options: [
      { id: 'u1', label: 'Unit 1 — the one with the flattest incremental-cost line' },
      { id: 'u2', label: 'Unit 2' },
      { id: 'u3', label: 'Unit 3 — the one with the cheapest no-load cost' },
      { id: 'equal', label: 'They share it equally — about 33 MW each' },
    ],
    cols: ['800 MW', '900 MW'],
    currency: 'USD',
    run: () => {
      const c = saadatCase()
      return { before: snap(c, 800), after: snap(c, 900) }
    },
    answer: (b, a) => {
      const dP = a.d.P.map((p, i) => p - b.d.P[i])
      return Math.max(...dP) - Math.min(...dP) < 1 ? 'equal' : ['u1', 'u2', 'u3'][argmax(dP)]
    },
    rows: [pRow(0), pRow(1), pRow(2), lamRow(USD.perMWh), costRow(USD.perH, 1)],
    explain: (b, a) => {
      const dP = a.d.P.map((p, i) => p - b.d.P[i])
      const dl = a.d.lambda - b.d.lambda
      const k = argmax(dP)
      return [
        `λ rises from ${fx(b.d.lambda, 3)} to ${fx(a.d.lambda, 3)} $/MWh (Δλ = ${fx(dl, 4)}). Every unit moves up its own incremental-cost line by the same Δλ, so each one’s extra output is ΔP_i = Δλ / 2c_i: ${dP.map((x, i) => `${fx(x, 1)} MW for Unit ${i + 1}`).join(', ')}.`,
        `Unit ${k + 1} has the smallest c (${b.units[k].c} $/MW²h): its incremental cost rises most slowly with output, so it takes the most. The no-load cost a plays no part — it does not change with output.`,
        `The extra 100 MW cost ${fx(a.d.total - b.d.total, 1)} $/h — about ${fx((a.d.total - b.d.total) / 100, 3)} $/MWh, between the two values of λ. That is what λ means: the cost of the next megawatt.`,
      ]
    },
  },
  {
    id: 'limit',
    title: 'A unit reaches its limit',
    change: 'The textbook units with limits 200–450, 150–350 and 100–225 MW (Unit 1 at most 450 MW). Demand rises from 900 MW to 975 MW; Unit 1 would need more than 450 MW.',
    question: 'Compared with the same 75 MW rise if there were no limits, λ rises…',
    options: [
      { id: 'less', label: 'less — the limit protects the system from expensive output' },
      { id: 'same', label: 'by the same amount — limits do not affect λ' },
      { id: 'more', label: 'more — the other units must climb further up their curves' },
    ],
    cols: ['900 MW', '975 MW'],
    currency: 'USD',
    run: () => {
      const c = saadatWithLimits()
      return { before: snap(c, 900), after: snap(c, 975) }
    },
    answer: (b, a) => {
      const free = saadatCase()
      const dFree = dispatch(free.units, 975)
      const dFree0 = dispatch(free.units, 900)
      const dl = a.d.lambda - b.d.lambda
      const dlFree = dFree.ok && dFree0.ok ? dFree.lambda - dFree0.lambda : NaN
      return dl > dlFree + 1e-6 ? 'more' : dl < dlFree - 1e-6 ? 'less' : 'same'
    },
    rows: [pRow(0), pRow(1), pRow(2), lamRow(USD.perMWh), costRow(USD.perH, 1)],
    explain: (b, a) => {
      const free = saadatCase()
      const f0 = dispatch(free.units, 900)
      const f1 = dispatch(free.units, 975)
      const dlFree = f0.ok && f1.ok ? f1.lambda - f0.lambda : NaN
      const at = a.d.limit.map((l, i) => (l ? `Unit ${i + 1} at its ${l === 'max' ? 'maximum' : 'minimum'}` : null)).filter(Boolean)
      return [
        `At 975 MW ${at.join(' and ') || 'no unit is at a limit'}: it is held at ${fx(a.d.P[0], 0)} MW and leaves the equal-λ set. Its incremental cost there (${fx(a.d.ic[0], 3)} $/MWh) is BELOW λ = ${fx(a.d.lambda, 3)} — it would like to produce more, but cannot.`,
        `Only Units 2 and 3 can take the extra load, so the remaining demand is shared by Σ 1/2c over two units instead of three: λ rises by ${fx(a.d.lambda - b.d.lambda, 3)} $/MWh, against ${fx(dlFree, 3)} $/MWh without limits.`,
        `This is the Kuhn–Tucker condition: a unit at P_max has IC ≤ λ, a unit at P_min has IC ≥ λ, and every unit between its limits has IC = λ.`,
      ]
    },
  },
  {
    id: 'losses',
    title: 'Include transmission losses',
    change: 'The illustrative Indian system at 900 MW, first without losses, then with the B-coefficient loss model. Unit 1 is a pit-head station far from the load.',
    question: 'What happens to the output of Unit 1, the remote pit-head station?',
    options: [
      { id: 'falls', label: 'It falls — its power has a long way to travel' },
      { id: 'same', label: 'It stays the same — it is still the cheapest unit' },
      { id: 'rises', label: 'It rises — someone must supply the losses' },
    ],
    cols: ['No losses', 'With losses'],
    currency: 'INR',
    run: () => {
      const c = indiaCase()
      return { before: snap(c, 900, false), after: snap(c, 900, true) }
    },
    answer: (b, a) => (a.d.P[0] < b.d.P[0] - 0.5 ? 'falls' : a.d.P[0] > b.d.P[0] + 0.5 ? 'rises' : 'same'),
    rows: [
      pRow(0),
      pRow(1),
      pRow(2),
      { label: 'Transmission losses', unit: 'MW', decimals: 2, get: (s) => s.d.loss },
      { label: 'Penalty factor of Unit 1', unit: '', decimals: 4, get: (s) => s.d.pf[0] },
      lamRow(INR.perMWh),
      costRow(INR.perH),
    ],
    explain: (b, a) => [
      `Unit 1’s output falls from ${fx(b.d.P[0], 1)} MW to ${fx(a.d.P[0], 1)} MW, while Units 2 and 3 — close to the load — rise to ${fx(a.d.P[1], 1)} and ${fx(a.d.P[2], 1)} MW.`,
      `Each extra MW from Unit 1 adds ∂P_L/∂P₁ = ${fx(a.d.itl[0], 4)} MW of loss, so only ${fx((1 - a.d.itl[0]) * 100, 1)} % of it reaches the load. Its penalty factor L₁ = 1/(1 − ${fx(a.d.itl[0], 4)}) = ${fx(a.d.pf[0], 4)}, against ${fx(a.d.pf[1], 4)} and ${fx(a.d.pf[2], 4)} for the nearby units.`,
      `The coordination equations λ = L_i · IC_i make the remote unit run where its own incremental cost is lower — ${fx(a.d.ic[0], 1)} ₹/MWh, against λ = ${fx(a.d.lambda, 1)} ₹/MWh delivered. The units now supply ${fx(a.d.loss, 2)} MW of losses as well as the demand; the total cost rises by ${grp(a.d.total - b.d.total, 0)} ₹/h.`,
    ],
  },
  {
    id: 'priority',
    title: 'Is the priority list the cheapest commitment?',
    change: 'The illustrative Indian units must supply 700 MW (no losses). Unit 1 alone cannot (600 MW maximum). The priority list adds the unit with the next-lowest full-load average cost.',
    question: 'Which commitment is actually the cheapest at 700 MW?',
    options: [
      { id: '3', label: 'U1 + U2 — the priority list’s choice' },
      { id: '5', label: 'U1 + U3' },
      { id: '7', label: 'All three units' },
    ],
    cols: ['Priority list', 'Best of all 8'],
    currency: 'INR',
    run: () => {
      const c = indiaCase()
      const pl = priorityCommitment(c.units, 700).combo!
      const best = optimalCommitment(c.units, 700)!
      return { before: { units: c.units, B: null, demand: 700, d: pl.dispatch!, combo: pl }, after: { units: c.units, B: null, demand: 700, d: best.dispatch!, combo: best } }
    },
    answer: (_, a) => String(a.combo!.mask),
    rows: [
      pRow(0),
      pRow(1),
      pRow(2),
      { label: 'No-load cost of the units on', unit: INR.perH, decimals: 0, get: (s) => s.units.reduce((t, u, i) => t + (s.combo!.on[i] ? u.a : 0), 0) },
      costRow(INR.perH),
    ],
    explain: (b, a) => {
      const all = evaluateCombo(b.units, [true, true, true], 700)
      return [
        `The priority list commits ${b.combo!.label} at ${grp(b.d.total, 0)} ₹/h. Enumerating all eight on/off combinations finds ${a.combo!.label} at ${grp(a.d.total, 0)} ₹/h — ${a.combo!.mask === b.combo!.mask ? 'the same' : `${grp(b.d.total - a.d.total, 0)} ₹/h cheaper`}${all.cost !== null ? ` (all three: ${grp(all.cost, 0)} ₹/h)` : ''}.`,
        `The list ranks units by their average cost at FULL output. At 700 MW the second unit runs far below its maximum, where Unit 2’s large no-load cost (${grp(b.units[1].a, 0)} ₹/h) dominates; Unit 3’s no-load cost is only ${grp(b.units[2].a, 0)} ₹/h.`,
        'The priority list is quick and usually close, but only an exact method — enumeration here, dynamic programming in practice — guarantees the cheapest commitment.',
      ]
    },
  },
  {
    id: 'fuel',
    title: 'Fuel for Unit 2 becomes 20 % dearer',
    change:
      'The illustrative Indian system at 900 MW (no losses). The price of Unit 2’s fuel rises 20 %. Its whole cost curve is fuel (the no-load term a too), so C₂ becomes 1.2 × C₂: a, b and c all rise by 20 %.',
    question: 'What happens to Unit 2’s output?',
    options: [
      { id: 'falls', label: 'It falls — the others take over part of its load' },
      { id: 'same', label: 'It stays the same — the demand has not changed' },
      { id: 'rises', label: 'It rises — it must burn more to earn the same' },
    ],
    cols: ['Before', 'Fuel price × 1.2'],
    currency: 'INR',
    run: () => {
      const c = indiaCase()
      const units = c.units.map((u, i) => (i === 1 ? scaleFuel(u, 1.2) : u))
      return { before: snap(c, 900), after: snap(c, 900, false, units) }
    },
    answer: (b, a) => (a.d.P[1] < b.d.P[1] - 0.5 ? 'falls' : a.d.P[1] > b.d.P[1] + 0.5 ? 'rises' : 'same'),
    rows: [pRow(0), pRow(1), pRow(2), lamRow(INR.perMWh), costRow(INR.perH)],
    explain: (b, a) => [
      `Unit 2’s whole incremental-cost line b₂ + 2c₂P is multiplied by 1.2: at its old output its IC rises from ${fx(b.d.ic[1], 1)} to ${fx(ic(a.units[1], b.d.P[1]), 1)} ₹/MWh, above everyone else’s. Load moves away from it until the units between their limits have equal ICs again: ${fx(b.d.P[1], 1)} → ${fx(a.d.P[1], 1)} MW.`,
      `Units 1 and 3 pick it up (${fx(a.d.P[0] - b.d.P[0], 1)} and ${fx(a.d.P[2] - b.d.P[2], 1)} MW${a.d.limit[0] === 'max' ? `; Unit 1 stops at its ${fx(a.units[0].pMax, 0)} MW maximum` : ''}), climbing their own curves, so λ rises from ${fx(b.d.lambda, 1)} to ${fx(a.d.lambda, 1)} ₹/MWh. The total cost rises by ${grp(a.d.total - b.d.total, 0)} ₹/h — less than the ${grp(0.2 * cost(b.units[1], b.d.P[1]), 0)} ₹/h (0.2 × C₂ at its old output) it would rise if nothing were re-dispatched.`,
    ],
  },
]

export function runExperiment(e: EdExperiment) {
  return e.run()
}
