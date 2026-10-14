import { useMemo } from 'react'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { DAILY_LOAD_MW, curveStats, optimalCommitment, priorityCommitment, twoPartBill, TARIFF } from './commitment.ts'
import { closedFormLambda, dispatch, ic, indiaCase, itlOf, saadatCase, saadatWithLimits, type DispatchOk, type Unit } from './dispatch.ts'
import { MODULE } from './shared.tsx'
import { grp } from './fmt.ts'

const ok = (d: ReturnType<typeof dispatch>) => (d.ok ? d : null) as DispatchOk

/** A small two-plant system written for this practice set (₹; not from any examination paper). */
const TWO: Unit[] = [
  { id: 'p1', name: 'Plant 1', kind: '', a: 120, b: 40, c: 0.1, pMin: 0, pMax: 500, on: true },
  { id: 'p2', name: 'Plant 2', kind: '', a: 100, b: 30, c: 0.125, pMin: 0, pMax: 500, on: true },
]

export function Practise() {
  const q = useMemo(() => {
    const s = saadatCase()
    const lim = saadatWithLimits()
    const dl = ok(dispatch(lim.units, 975))
    const ind = indiaCase()
    const dw = ok(dispatch(ind.units, 900, ind.B))
    const two = ok(dispatch(TWO, 180))
    const pl = priorityCommitment(ind.units, 700).combo!
    const best = optimalCommitment(ind.units, 700)!
    const stats = curveStats(DAILY_LOAD_MW)
    const icR = Number(fx(dw.ic[0], 0))
    const lR = Number(fx(dw.pf[0], 3))
    const itl = itlOf([100], [[0.0005]])[0]
    const bill = twoPartBill(400, 150000)
    return { s, lim, dl, dw, two, pl, best, stats, icR, lR, itl, bill }
  }, [])
  const { s, dl, two, pl, best, stats, icR, lR, itl, bill } = q
  const [, u2] = s.units
  const items: QuizItem[] = [
    {
      id: 'equal-ic',
      level: 'concept',
      kind: 'choice',
      q: 'At the cheapest dispatch (no losses, no unit at a limit), which quantity is the same for every running unit?',
      options: [
        { id: 'p', label: 'Its output P' },
        { id: 'avg', label: 'Its average cost C/P' },
        { id: 'ic', label: 'Its incremental cost dC/dP' },
        { id: 'c', label: 'Its fuel cost C' },
      ],
      answer: 'ic',
      why: 'If one unit’s next MW were cheaper than another’s, moving load to it would save money. No saving is left only when every incremental cost equals λ.',
      mistake: 'Equal outputs or equal average costs are not the condition: a unit with a flat IC line should carry more.',
    },
    {
      id: 'flat',
      level: 'concept',
      kind: 'choice',
      q: 'The demand rises by a small amount. Which unit takes the largest share of the rise?',
      options: [
        { id: 'b', label: 'The one with the largest b' },
        { id: 'c', label: 'The one with the smallest c (flattest incremental-cost line)' },
        { id: 'a', label: 'The one with the smallest no-load cost a' },
      ],
      answer: 'c',
      why: 'Every unit moves up its IC line by the same Δλ, so ΔPᵢ = Δλ/2cᵢ: the smallest c gives the largest ΔP.',
      mistake: 'The no-load cost a does not change with output, so it plays no part in sharing an increase.',
    },
    {
      id: 'ic2',
      level: 'numerical',
      kind: 'number',
      q: `Unit 2 of the textbook case, C₂ = ${u2.a} + ${u2.b}P + ${u2.c}P² $/h, runs at 300 MW. What is its incremental cost?`,
      answer: ic(u2, 300),
      unit: '$/MWh',
      tol: 0.01,
      why: `IC₂ = b + 2cP = ${u2.b} + 2 × ${u2.c} × 300 = ${fx(ic(u2, 300), 3)} $/MWh.`,
      mistake: 'The incremental cost is the derivative b + 2cP — not C/P (the average cost) and not b + cP.',
    },
    {
      id: 'lam600',
      level: 'numerical',
      kind: 'number',
      q: 'The three textbook units (no limits, no losses) supply 600 MW. What is λ?',
      answer: closedFormLambda(s.units, 600),
      unit: '$/MWh',
      tol: 0.005,
      why: `λ = (600 + Σ bᵢ/2cᵢ) / Σ 1/2cᵢ = ${fx(closedFormLambda(s.units, 600), 4)} $/MWh.`,
    },
    {
      id: 'lim-p2',
      level: 'university',
      kind: 'number',
      q: 'The textbook units now have limits 200–450, 150–350 and 100–225 MW. At 975 MW Unit 1 reaches 450 MW. What is Unit 2’s output?',
      answer: dl.P[1],
      unit: 'MW',
      tol: 0.5,
      why: `With P₁ = 450 MW, Units 2 and 3 share ${fx(975 - dl.P[0], 0)} MW at λ = ${fx(dl.lambda, 3)} $/MWh, so P₂ = (λ − 5.5)/0.012 = ${fx(dl.P[1], 1)} MW.`,
      mistake: 'Fix the unit at its limit first, then share only the remaining demand between the free units.',
    },
    {
      id: 'coord',
      level: 'university',
      kind: 'number',
      q: `With losses, a remote unit runs where its incremental cost is ${grp(icR, 0)} ₹/MWh and its penalty factor is ${fx(lR, 3)}. What is λ (the incremental cost of power delivered)?`,
      answer: icR * lR,
      unit: '₹/MWh',
      tol: 1,
      why: `λ = L · IC = ${fx(lR, 3)} × ${fx(icR, 0)} = ${fx(icR * lR, 1)} ₹/MWh.`,
      mistake: 'The coordination equation multiplies the IC by the penalty factor; it does not divide.',
    },
    {
      id: 'two',
      level: 'gate',
      kind: 'number',
      q: 'Two plants have incremental costs dC₁/dP₁ = 40 + 0.2P₁ and dC₂/dP₂ = 30 + 0.25P₂ (₹/MWh, P in MW). Neglecting losses and limits, how much does Plant 1 supply when the total load is 180 MW?',
      answer: two.P[0],
      unit: 'MW',
      tol: 0.5,
      why: `40 + 0.2P₁ = 30 + 0.25P₂ = λ and P₁ + P₂ = 180 give λ = ${fx(two.lambda, 2)} ₹/MWh, P₁ = ${fx(two.P[0], 1)} MW, P₂ = ${fx(two.P[1], 1)} MW.`,
    },
    {
      id: 'loss-pf',
      level: 'gate',
      kind: 'number',
      q: 'A plant’s output reaches the load through a line whose loss is P_L = 0.0005·P₁² MW. At P₁ = 100 MW, what is the plant’s penalty factor?',
      answer: 1 / (1 - itl),
      unit: '',
      tol: 0.002,
      why: `∂P_L/∂P₁ = 2 × 0.0005 × 100 = ${fx(itl, 2)}, so L₁ = 1/(1 − ${fx(itl, 2)}) = ${fx(1 / (1 - itl), 4)}.`,
      mistake: 'Differentiate the loss formula first: ∂P_L/∂P₁ = 2·B₁₁·P₁, not B₁₁·P₁.',
    },
    {
      id: 'pl-rank',
      level: 'concept',
      kind: 'choice',
      q: 'The priority list ranks units by…',
      options: [
        { id: 'a', label: 'their no-load cost' },
        { id: 'avg', label: 'their average cost at full output, C(P_max)/P_max' },
        { id: 'b', label: 'their incremental cost at zero output' },
      ],
      answer: 'avg',
      why: 'Units are switched on in order of full-load average cost until their capacity covers the load.',
    },
    {
      id: 'pl-opt',
      level: 'university',
      kind: 'choice',
      q: 'For the illustrative Indian units at 700 MW (no start-up costs), does the priority list give the cheapest commitment?',
      options: [
        { id: 'yes', label: 'Yes — it always does' },
        { id: 'no', label: 'No — another combination is cheaper' },
      ],
      answer: best.mask === pl.mask ? 'yes' : 'no',
      why: `The list commits ${pl.label} (${grp(pl.cost!, 0)} ₹/h); enumerating all 8 combinations finds ${best.label} (${grp(best.cost!, 0)} ₹/h).`,
      mistake: 'The list uses full-load average costs; at part load a unit with a low no-load cost can be cheaper.',
    },
    {
      id: 'lf',
      level: 'numerical',
      kind: 'number',
      q: `The illustrative daily load curve has a peak of ${fx(stats.peak, 0)} MW and supplies ${grp(stats.energy, 0)} MWh in 24 h. What is its load factor?`,
      answer: stats.loadFactor * 100,
      unit: '%',
      tol: 0.2,
      why: `Load factor = average / peak = (${fx(stats.energy, 0)}/24) / ${fx(stats.peak, 0)} = ${fx(stats.loadFactor * 100, 2)} %.`,
    },
    {
      id: 'tariff',
      level: 'gate',
      kind: 'number',
      q: `A consumer’s maximum demand is 400 kW and it uses 150,000 kWh in a month. A two-part tariff charges ₹${TARIFF.fixedPerKwMonth} per kW of maximum demand per month plus ₹${TARIFF.energyPerKwh}/kWh. What is the monthly bill?`,
      answer: bill.total,
      unit: '₹',
      tol: 1,
      why: `₹${TARIFF.fixedPerKwMonth} × 400 + ₹${TARIFF.energyPerKwh} × 150,000 = ₹${grp(bill.fixed, 0)} + ₹${grp(bill.energy, 0)} = ₹${grp(bill.total, 0)}.`,
    },
  ]
  useTutorContext(
    () =>
      'Practise mode: questions on economic dispatch (equal incremental cost, λ, limits, penalty factors), unit commitment (priority list vs enumeration), load factor and a two-part tariff. Numbers come from the module’s models; questions are written for this app, not taken from past papers.',
  )
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">From concept to GATE-style. Every number comes from the module’s models; the questions are written for this app, not taken from examination papers.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
