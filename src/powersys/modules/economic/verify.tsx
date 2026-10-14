import { useMemo } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { FACTORY_KW, TARIFF, DAILY_LOAD_MW, curveStats, evaluateCombo, monthlyBill, optimalCommitment, priorityCommitment } from './commitment.ts'
import { closedFormLambda, cost, dispatch, dispatchBreakpoints, ic, indiaCase, saadatCase, saadatWithLimits, type DispatchOk } from './dispatch.ts'
import { newtonLagrangian } from './lagrangian.ts'
import { KktTable, MODULE, tiny } from './shared.tsx'
import { grp } from './fmt.ts'

const ok = (d: ReturnType<typeof dispatch>) => (d.ok ? d : null) as DispatchOk

/** In words, how the units of a dispatch were set: who is held at a limit, who shares at equal IC. */
function u13Rule(d: DispatchOk): string {
  const held = d.limit.map((l, i) => (l ? `U${i + 1} at P_${l}` : null)).filter(Boolean)
  const free = d.limit.map((l, i) => (l === null && d.P[i] > 0 ? `U${i + 1}` : null)).filter(Boolean)
  if (!held.length)
    return `equal IC (${d.ic
      .filter((_, i) => d.P[i] > 0)
      .map((x) => fx(x, 0))
      .join(' = ')} ₹/MWh), all within limits`
  return `${held.join(', ')} (IC ${d.limit
    .map((l, i) => (l ? fx(d.ic[i], 0) : null))
    .filter(Boolean)
    .join(', ')}); ${free.length ? `${free.join(', ')} takes the rest (IC = λ = ${fx(d.lambda, 0)} ₹/MWh)` : 'no unit free'}`
}

/** Verify: the solver's results checked by hand and by a second, independent method. */
export function Verify() {
  const progress = usePsProgress()
  const v = useMemo(() => {
    const s = saadatCase()
    const d = ok(dispatch(s.units, 800))
    const lamCf = closedFormLambda(s.units, 800)
    const lim = saadatWithLimits()
    const dl = ok(dispatch(lim.units, 975))
    const bp = ok(dispatchBreakpoints(lim.units, 975))
    const ind = indiaCase()
    const dw = ok(dispatch(ind.units, 900, ind.B))
    const nl = newtonLagrangian(ind.units, 900, ind.B)
    const best = optimalCommitment(ind.units, 700)!
    const pl = priorityCommitment(ind.units, 700).combo!
    const u13 = evaluateCombo(ind.units, [true, false, true], 700)
    const stats = curveStats(DAILY_LOAD_MW)
    const bill = monthlyBill(FACTORY_KW)
    const d1000 = closedFormLambda(s.units, 1000)
    return { s, d, lamCf, lim, dl, bp, ind, dw, nl, best, pl, u13, stats, bill, d1000 }
  }, [])
  const { s, d, lamCf, lim, dl, bp, ind, dw, nl, best, pl, u13, stats, bill, d1000 } = v
  const B = ind.B!
  const P = dw.P
  const terms = [0, 1, 2].flatMap((i) => [0, 1, 2].filter((j) => j >= i).map((j) => ({ i, j, v: (i === j ? 1 : 2) * P[i] * B[i][j] * P[j] })))
  const hand13 = u13.dispatch ? ind.units.reduce((t, u, i) => t + (u13.on[i] ? cost(u, u13.dispatch!.P[i]) : 0), 0) : NaN
  useTutorContext(
    () =>
      'Verify mode: hand calculations of economic dispatch (closed form vs λ-iteration), limits (KKT, exact breakpoint method), losses (B-coefficient formula, penalty factors, coordination equations vs Newton on the Lagrangian), unit commitment costs, load factor and a two-part tariff bill.',
  )
  const quiz: QuizItem[] = [
    {
      id: 'lam1000',
      kind: 'number',
      q: `Your turn: the textbook units (no limits, no losses) must supply 1,000 MW. What is λ?`,
      answer: d1000,
      unit: '$/MWh',
      tol: 0.005,
      why: `λ = (1000 + Σ bᵢ/2cᵢ) / Σ 1/2cᵢ = (1000 + ${fx(
        s.units.reduce((t, u) => t + u.b / (2 * u.c), 0),
        3,
      )}) / ${fx(
        s.units.reduce((t, u) => t + 1 / (2 * u.c), 0),
        3,
      )} = ${fx(d1000, 4)} $/MWh.`,
      mistake: 'Use Σ bᵢ/2cᵢ and Σ 1/2cᵢ over all three units — not the average of the b values.',
    },
    {
      id: 'pf',
      kind: 'number',
      q: `Your turn: at 900 MW with losses, Unit 2’s incremental transmission loss is ∂P_L/∂P₂ = ${fx(dw.itl[1], 4)}. What is its penalty factor L₂?`,
      answer: 1 / (1 - Number(fx(dw.itl[1], 4))),
      unit: '',
      tol: 0.0005,
      why: `L₂ = 1 / (1 − ${fx(dw.itl[1], 4)}) = ${fx(1 / (1 - Number(fx(dw.itl[1], 4))), 4)}.`,
      mistake: 'The penalty factor is 1/(1 − ∂P_L/∂P), not 1 + ∂P_L/∂P (the two are close only for small losses).',
    },
  ]
  const tol = (a: number, b: number, t: number) => Math.abs(a - b) <= t
  return (
    <div className="ps-stack">
      <Callout title="The dispatches on this page come from the λ-iteration">
        <p>Here each result is checked by hand and by a second, independent method. {isDone(progress, MODULE, 'verify') && '✓ Done.'}</p>
      </Callout>
      <Calc
        title="1 · Saadat Example 7.4 by the closed form"
        steps={[
          {
            label: 'Σ bᵢ/2cᵢ',
            expr: s.units.map((u) => `${u.b}/${fx(2 * u.c, 3)}`).join(' + '),
            result: fx(
              s.units.reduce((t, u) => t + u.b / (2 * u.c), 0),
              4,
            ),
          },
          {
            label: 'Σ 1/2cᵢ',
            expr: s.units.map((u) => `1/${fx(2 * u.c, 3)}`).join(' + '),
            result: fx(
              s.units.reduce((t, u) => t + 1 / (2 * u.c), 0),
              4,
            ),
          },
          { label: 'λ', expr: '(P_D + Σ bᵢ/2cᵢ) / Σ 1/2cᵢ', result: `${fx(lamCf, 6)} $/MWh` },
          { label: 'λ-iteration', expr: `${d.steps.length} rows (one Newton step)`, result: `${fx(d.lambda, 6)} $/MWh` },
          { label: 'Outputs', expr: 'Pᵢ = (λ − bᵢ)/2cᵢ', result: d.P.map((p) => fx(p, 3)).join(', ') + ' MW' },
        ]}
        check={{ ok: tol(lamCf, d.lambda, 1e-9), text: `The two agree to ${tiny(Math.abs(lamCf - d.lambda), 3)} $/MWh — and give the published λ = 8.5 $/MWh, 400, 250, 150 MW.` }}
      />
      <Calc
        title="2 · With limits (975 MW): λ-iteration vs the exact breakpoint solution"
        steps={[
          {
            label: 'Breakpoints',
            expr: 'λ where a unit reaches P_min or P_max',
            result: [...new Set(lim.units.flatMap((u) => [ic(u, u.pMin), ic(u, u.pMax)]))]
              .sort((a, b) => a - b)
              .map((x) => fx(x, 2))
              .join(', '),
          },
          { label: 'Exact λ', expr: 'interpolate Σ Pᵢ(λ) = 975 in its segment', result: `${fx(bp.lambda, 6)} $/MWh` },
          { label: 'λ-iteration', expr: `${dl.steps.length} rows`, result: `${fx(dl.lambda, 6)} $/MWh` },
          { label: 'Outputs', expr: 'both methods', result: `${dl.P.map((p) => fx(p, 3)).join(', ')} MW` },
          { label: 'Cost', expr: 'both methods', result: `${fx(dl.total, 3)} / ${fx(bp.total, 3)} $/h` },
        ]}
        check={{
          ok: tol(dl.lambda, bp.lambda, 1e-7) && dl.P.every((p, i) => tol(p, bp.P[i], 1e-7)),
          text: 'The iteration and the exact piecewise solution agree; the optimality conditions hold (below).',
        }}
      />
      <section className="ps-card" aria-label="Optimality conditions at 975 MW">
        <KktTable units={lim.units} d={dl} cur="USD" />
      </section>
      <Calc
        title="3 · Losses (illustrative ₹ case, 900 MW): the B-coefficient formula"
        steps={[
          ...terms.map((t) => ({
            label: t.i === t.j ? `P${t.i + 1}²·B${t.i + 1}${t.j + 1}` : `2·P${t.i + 1}·P${t.j + 1}·B${t.i + 1}${t.j + 1}`,
            expr: t.i === t.j ? `${fx(P[t.i], 2)}² × ${B[t.i][t.j]}` : `2 × ${fx(P[t.i], 2)} × ${fx(P[t.j], 2)} × ${B[t.i][t.j]}`,
            result: `${fx(t.v, 4)} MW`,
          })),
          {
            label: 'P_L',
            expr: 'sum',
            result: `${fx(
              terms.reduce((a, t) => a + t.v, 0),
              4,
            )} MW`,
          },
          { label: 'Balance', expr: `${P.map((p) => fx(p, 3)).join(' + ')} − 900 − ${fx(dw.loss, 3)}`, result: `${tiny(dw.mismatch, 3)} MW` },
        ]}
        check={{
          ok:
            tol(
              terms.reduce((a, t) => a + t.v, 0),
              dw.loss,
              1e-9,
            ) && Math.abs(dw.mismatch) < 1e-6,
          text: 'Generation equals demand plus losses (to 10⁻⁶ MW).',
        }}
      />
      <Calc
        title="4 · The coordination equations λ = Lᵢ · ICᵢ"
        steps={ind.units.map((u, i) => ({
          label: u.name,
          expr: `L = 1/(1 − ${fx(dw.itl[i], 5)}) = ${fx(dw.pf[i], 5)};  IC = ${u.b} + ${fx(2 * u.c, 2)} × ${fx(P[i], 3)} = ${fx(dw.ic[i], 3)}`,
          result: dw.limit[i] ? `L·IC = ${fx(dw.pf[i] * dw.ic[i], 3)} (at P_${dw.limit[i]})` : `L·IC = ${fx(dw.pf[i] * dw.ic[i], 3)} ₹/MWh`,
        }))}
        check={{
          ok: !!nl && dw.P.every((p, i) => tol(p, nl.P[i], 1e-6)) && ind.units.every((_, i) => dw.limit[i] !== null || tol(dw.pf[i] * dw.ic[i], dw.lambda, 1e-6 * dw.lambda)),
          text: nl
            ? `Every unit between its limits gives L·IC = λ = ${fx(dw.lambda, 3)} ₹/MWh. Newton’s method on the whole Lagrangian (a second, independent solver) reaches ${nl.P.map((p) => fx(p, 3)).join(', ')} MW, λ = ${fx(nl.lambda, 3)} — the same.`
            : 'The second method did not converge.',
        }}
      />
      <Calc
        title="5 · Unit commitment at 700 MW: one combination by hand"
        steps={[
          { label: 'U1 + U3 dispatch', expr: u13.dispatch ? u13Rule(u13.dispatch) : '', result: u13.dispatch ? `${fx(u13.dispatch.P[0], 2)} + ${fx(u13.dispatch.P[2], 2)} MW` : '—' },
          {
            label: 'Cost',
            expr: u13.dispatch ? `C₁(${fx(u13.dispatch.P[0], 2)}) + C₃(${fx(u13.dispatch.P[2], 2)})` : '',
            result: `${grp(hand13, 0)} ₹/h`,
          },
          { label: 'Priority list (U1 + U2)', expr: 'enumeration', result: `${grp(pl.cost!, 0)} ₹/h` },
          { label: 'Best of all 8', expr: 'enumeration', result: `${best.label}, ${grp(best.cost!, 0)} ₹/h` },
        ]}
        check={{
          ok: tol(hand13, u13.cost!, 1e-6) && best.mask === u13.mask,
          text: `The hand cost matches the enumeration, and U1 + U3 is the cheapest — ${grp(pl.cost! - best.cost!, 0)} ₹/h below the priority list.`,
        }}
      />
      <Calc
        title="6 · Load factor and a two-part bill"
        steps={[
          { label: 'Energy', expr: 'Σ of the 24 hourly loads × 1 h', result: `${grp(stats.energy, 0)} MWh` },
          { label: 'Load factor', expr: `(${fx(stats.energy, 0)} / 24) / ${fx(stats.peak, 0)}`, result: `${fx(stats.loadFactor * 100, 2)} %` },
          { label: 'Factory bill', expr: `${TARIFF.fixedPerKwMonth} × ${fx(bill.md, 0)} kW + ${TARIFF.energyPerKwh} × ${grp(bill.kwh, 0)} kWh`, result: `₹${grp(bill.total, 0)}` },
        ]}
        check={{ ok: tol(bill.total, TARIFF.fixedPerKwMonth * bill.md + TARIFF.energyPerKwh * bill.kwh, 1e-6), text: 'Demand charge plus energy charge (illustrative rates).' }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}
