import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Eq, Readouts, Slider, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { CommitStrip, Chart, CostChart, DispatchBars, IcChart, PlantIcon, unitColor } from './charts.tsx'
import { DAILY_LOAD_MW, FACTORY_KW, TARIFF, curveStats, dailyCommitment, enumerate, monthlyBill, optimalCommitment, priorityCommitment } from './commitment.ts'
import { closedFormLambda, cost, dispatch, ic, indiaCase, saadatCase, saadatWithLimits, type DispatchOk } from './dispatch.ts'
import { ComboTable, KktTable, LambdaTable, MODULE, SyllabusNote } from './shared.tsx'
import { grp } from './fmt.ts'

const ok = (d: ReturnType<typeof dispatch>) => (d.ok ? d : null) as DispatchOk

/** Learn: from "why do generators cost different amounts?" to the dispatch, commitment and the bill. */
export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [p1, setP1] = useState(300)
  const data = useMemo(() => {
    const s = saadatCase()
    const d74 = ok(dispatch(s.units, 800))
    const lim = saadatWithLimits()
    const dl = ok(dispatch(lim.units, 975))
    const ind = indiaCase()
    const dn = ok(dispatch(ind.units, 900))
    const dw = ok(dispatch(ind.units, 900, ind.B))
    const combos = enumerate(ind.units, 700)
    const best = optimalCommitment(ind.units, 700)
    const pl = priorityCommitment(ind.units, 700)
    const day = dailyCommitment(ind.units, DAILY_LOAD_MW)
    const stats = curveStats(DAILY_LOAD_MW)
    const bill = monthlyBill(FACTORY_KW)
    return { s, d74, lim, dl, ind, dn, dw, combos, best, pl, day, stats, bill }
  }, [])
  const { s, d74, lim, dl, ind, dn, dw, combos, best, pl, day, stats, bill } = data
  const [u1, u2, u3] = s.units

  // step 4: Units 1 and 3 share 550 MW while Unit 2 stays at 250 MW
  const share = 550
  const c13 = (x: number) => cost(u1, x) + cost(u2, 250) + cost(u3, share - x)
  const pStar = (u3.b - u1.b + 2 * u3.c * share) / (2 * u1.c + 2 * u3.c)
  const ic1 = ic(u1, p1)
  const ic3 = ic(u3, share - p1)
  const lam = closedFormLambda(s.units, 800)
  const sumB = s.units.reduce((t, u) => t + u.b / (2 * u.c), 0)
  const sumInv = s.units.reduce((t, u) => t + 1 / (2 * u.c), 0)

  const steps: Array<{ title: string; figure: ReactNode; body: ReactNode }> = [
    {
      title: 'Three power stations, one demand',
      figure: (
        <div className="ed-figure">
          <p className="ed-illus">Illustration — three thermal units of the textbook example</p>
          <div className="ed-plants">
            {s.units.map((u, i) => (
              <div key={u.id} className="ed-plant-card">
                <PlantIcon kind="coal" color={unitColor(i)} />
                <b>{u.name}</b>
                <code>
                  C = {u.a} + {u.b}·P + {u.c}·P² $/h
                </code>
              </div>
            ))}
          </div>
        </div>
      ),
      body: (
        <>
          <p className="ed-big">Why can’t every generator produce electricity at the same cost — and how should the grid share the load between them?</p>
          <p>
            A thermal power station burns fuel to make steam, and the steam turns a turbine and a generator. Different stations burn different fuels, at different efficiencies, at different distances
            from the load. So each has its own <b>fuel-cost curve</b>: how many dollars (or rupees) per hour it burns to produce P megawatts.
          </p>
          <p>
            Here three units must together supply <b>{s.demand} MW</b>. Any split that adds up to {s.demand} MW keeps the lights on — but they do not all cost the same. Finding the cheapest split is{' '}
            <b>economic load dispatch</b>; deciding which units to switch on at all is <b>unit commitment</b>.
          </p>
          <p className="small muted">Economic dispatch is in GATE EE (Section 6) and in the VIT elective BEEE402L; load curves and tariffs are in BEEE304L. From the syllabus mapping:</p>
          <SyllabusNote />
          <p className="small muted">Data: {s.source}</p>
        </>
      ),
    },
    {
      title: 'What a generator’s fuel costs',
      figure: <CostChart units={s.units} d={null} perH="$/h" xMax={600} highlight={{ i: 0, p: 400 }} />,
      body: (
        <>
          <p>
            Even at no output a unit burns fuel to stay hot and spinning (the constant <b>a</b>). Each extra megawatt needs more fuel (<b>b</b>), and at high output the efficiency falls a little, so
            the curve bends upwards (<b>c</b>).
          </p>
          <Eq
            title="Fuel-cost curve"
            expr="C(P) = a + b·P + c·P²"
            where={[
              ['C', 'fuel cost per hour', '$/h'],
              ['P', 'the unit’s output', 'MW'],
              ['a', 'no-load cost (does not change with output)', '$/h'],
              ['b, c', 'how the cost grows with output', '$/MWh, $/MW²h'],
            ]}
            assume="a smooth quadratic fitted to the unit’s heat-rate test data; steady output"
          />
          <Calc
            title="Worked example: Unit 1 at 400 MW"
            steps={[
              { label: 'Substitute', expr: `${u1.a} + ${u1.b} × 400 + ${u1.c} × 400²`, result: `${fx(u1.a, 0)} + ${fx(u1.b * 400, 0)} + ${fx(u1.c * 160000, 0)}` },
              { label: 'Fuel cost', expr: 'C₁(400)', result: `${fx(cost(u1, 400), 1)} $/h` },
              { label: 'Average cost', expr: `C₁(400) / 400`, result: `${fx(cost(u1, 400) / 400, 3)} $/MWh` },
            ]}
          />
        </>
      ),
    },
    {
      title: 'The cost of the next megawatt',
      figure: <IcChart units={s.units} d={null} perMWh="$/MWh" xMax={600} label="Incremental cost of each textbook unit" />,
      body: (
        <>
          <p>
            For sharing load, what matters is not the average cost but the cost of <b>one more megawatt</b> — the slope of the cost curve. It is called the <b>incremental cost</b> (IC). For a
            quadratic curve it is a straight line that rises with output.
          </p>
          <Eq
            title="Incremental cost"
            expr="IC(P) = dC/dP = b + 2c·P"
            where={[
              ['IC', 'cost of the next megawatt-hour', '$/MWh'],
              ['b', 'IC at zero output', '$/MWh'],
              ['2c', 'how fast IC rises with output', '$/MW²h'],
            ]}
          />
          <Calc
            title="Worked example"
            steps={[
              { label: 'Unit 1 at 400 MW', expr: `${u1.b} + 2 × ${u1.c} × 400`, result: `${fx(ic(u1, 400), 3)} $/MWh` },
              { label: 'Unit 3 at 150 MW', expr: `${u3.b} + 2 × ${u3.c} × 150`, result: `${fx(ic(u3, 150), 3)} $/MWh` },
            ]}
          />
          <p className="small muted">Unit 1’s line is the flattest (smallest c): its next megawatt gets dearer most slowly as it is loaded.</p>
        </>
      ),
    },
    {
      title: 'Move load to the cheaper unit',
      figure: (
        <div className="ed-row-2">
          <Chart
            label="Total cost as load moves between Unit 1 and Unit 3"
            series={[{ id: 'tot', label: 'Total cost, Units 1 + 2 + 3', color: 'var(--ps-sel)', points: Array.from({ length: 51 }, (_, k) => [250 + k * 5, c13(250 + k * 5)] as [number, number]) }]}
            markers={[{ x: p1, y: c13(p1), color: 'var(--ps-sel)', label: `${fx(c13(p1), 1)} $/h` }]}
            vlines={[{ x: pStar, label: 'cheapest' }]}
            drops
            xLabel="Unit 1 output P₁ [MW]  (Unit 3 = 550 − P₁)"
            yLabel="Total cost [$/h]"
            xDomain={[250, 500]}
            height={250}
            legend={false}
          />
          <div className="ps-card">
            <Slider label="Unit 1 output (Unit 3 gets the rest of 550 MW)" value={p1} min={250} max={500} step={5} unit="MW" onChange={setP1} />
            <Readouts
              items={[
                { label: 'IC of Unit 1', value: fx(ic1, 3), unit: '$/MWh' },
                { label: 'IC of Unit 3', value: fx(ic3, 3), unit: '$/MWh', note: `Unit 3 at ${fx(share - p1, 0)} MW` },
                {
                  label: 'Move 1 MW from Unit 3 to Unit 1',
                  value: `${ic1 - ic3 < 0 ? '−' : '+'}${fx(Math.abs(ic1 - ic3), 3)}`,
                  unit: '$/h',
                  tone: Math.abs(ic1 - ic3) < 0.01 ? 'good' : undefined,
                  note: Math.abs(ic1 - ic3) < 0.01 ? 'no saving left: the ICs are equal' : ic1 < ic3 ? 'a saving — keep moving load to Unit 1' : 'a loss — move load back to Unit 3',
                },
              ]}
            />
          </div>
        </div>
      ),
      body: (
        <>
          <p>
            Unit 2 stays at 250 MW; Units 1 and 3 share the other 550 MW. Move the slider. Whenever one unit’s next megawatt is cheaper than the other’s, moving a megawatt to it saves the difference.
            So keep moving load until <b>no move saves anything</b> — that is, until the two incremental costs are <b>equal</b>.
          </p>
          <p>
            The cheapest split is at P₁ = {fx(pStar, 1)} MW, where IC₁ = IC₃ = {fx(ic(u1, pStar), 3)} $/MWh. This is the whole idea of economic dispatch, before any equation:{' '}
            <b>equal incremental cost</b>.
          </p>
        </>
      ),
    },
    {
      title: 'Equal incremental cost: λ',
      figure: (
        <div className="ed-row-2">
          <IcChart units={s.units} d={d74} perMWh="$/MWh" xMax={600} height={260} />
          <div className="ps-card">
            <DispatchBars units={s.units} d={d74} xMax={600} />
          </div>
        </div>
      ),
      body: (
        <>
          <p>
            With all three units the same argument holds: at the cheapest dispatch every unit runs where its incremental cost equals one common value, called <b>λ</b> (lambda) — the system’s cost of
            the next megawatt. Mathematically it is the Lagrange multiplier of the power balance.
          </p>
          <Eq
            title="Economic dispatch (no losses, no limits)"
            expr="dCᵢ/dPᵢ = bᵢ + 2cᵢ·Pᵢ = λ   for every unit,    Σ Pᵢ = P_D"
            where={[
              ['λ', 'system incremental cost (unknown)', '$/MWh'],
              ['Pᵢ', 'each unit’s output (unknown)', 'MW'],
              ['P_D', 'the demand (known)', 'MW'],
            ]}
            assume="all units on, no generator limits, no transmission losses"
          />
          <Calc
            title="Saadat Example 7.4: P_D = 800 MW"
            steps={[
              { label: 'Solve for λ', expr: 'Pᵢ = (λ − bᵢ)/2cᵢ  and  Σ Pᵢ = P_D', result: 'λ = (P_D + Σ bᵢ/2cᵢ) / Σ 1/2cᵢ' },
              { label: 'Σ bᵢ/2cᵢ', expr: s.units.map((u) => `${u.b}/${fx(2 * u.c, 3)}`).join(' + '), result: fx(sumB, 3) },
              { label: 'Σ 1/2cᵢ', expr: s.units.map((u) => `1/${fx(2 * u.c, 3)}`).join(' + '), result: fx(sumInv, 3) },
              { label: 'λ', expr: `(${s.demand} + ${fx(sumB, 3)}) / ${fx(sumInv, 3)}`, result: `${fx(lam, 3)} $/MWh` },
              { label: 'Outputs', expr: s.units.map((u) => `(${fx(lam, 2)} − ${u.b})/${fx(2 * u.c, 3)}`).join(', '), result: d74.P.map((p) => `${fx(p, 0)}`).join(', ') + ' MW' },
              { label: 'Total cost', expr: 'C₁ + C₂ + C₃', result: `${fx(d74.total, 1)} $/h` },
            ]}
          />
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Where it comes from: the Lagrangian</summary>
            <p>
              Minimise F = Σ Cᵢ(Pᵢ) subject to Σ Pᵢ = P_D. Form ℒ = Σ Cᵢ(Pᵢ) + λ (P_D − Σ Pᵢ). Setting ∂ℒ/∂Pᵢ = 0 gives dCᵢ/dPᵢ = λ for every unit, and ∂ℒ/∂λ = 0 returns the balance. Because each Cᵢ
              is convex (cᵢ &gt; 0), this stationary point is the minimum.
            </p>
          </details>
        </>
      ),
    },
    {
      title: 'When a unit reaches its limit',
      figure: (
        <div className="ed-row-2">
          <IcChart units={lim.units} d={dl} perMWh="$/MWh" xMax={500} height={260} />
          <div className="ps-card">
            <DispatchBars units={lim.units} d={dl} xMax={500} />
          </div>
        </div>
      ),
      body: (
        <>
          <p>
            Real units have a minimum stable output and a maximum rating. Give the textbook units the limits 200–450, 150–350 and 100–225 MW and raise the demand to 975 MW. The equal-λ answer would
            ask Unit 1 for more than 450 MW, so Unit 1 is held at its maximum and <b>leaves the equal-λ set</b>; the other two share the rest at a higher λ.
          </p>
          <Eq
            title="With limits (Kuhn–Tucker conditions)"
            expr="ICᵢ = λ  if  P_min < Pᵢ < P_max ;   ICᵢ ≤ λ  at P_max ;   ICᵢ ≥ λ  at P_min"
            where={[
              ['ICᵢ ≤ λ at P_max', 'its next MW is cheaper than λ — it would like to produce more, but cannot go above P_max'],
              ['ICᵢ ≥ λ at P_min', 'its next MW is dearer than λ — it would like to produce less, but cannot go below P_min while it is on'],
            ]}
          />
          <Calc
            title="975 MW with limits"
            steps={[
              { label: 'Unit 1 fixed', expr: 'P₁ = P_max', result: `${fx(dl.P[0], 0)} MW` },
              { label: 'The rest', expr: `975 − ${fx(dl.P[0], 0)}`, result: `${fx(975 - dl.P[0], 0)} MW for Units 2 and 3` },
              {
                label: 'λ',
                expr: `(${fx(975 - dl.P[0], 0)} + ${u2.b}/${fx(2 * u2.c, 3)} + ${u3.b}/${fx(2 * u3.c, 3)}) / (1/${fx(2 * u2.c, 3)} + 1/${fx(2 * u3.c, 3)})`,
                result: `${fx(dl.lambda, 3)} $/MWh`,
              },
              { label: 'P₂, P₃', expr: `(λ − bᵢ)/2cᵢ`, result: `${fx(dl.P[1], 0)}, ${fx(dl.P[2], 0)} MW` },
              { label: 'Check Unit 1', expr: `IC₁(450) = ${u1.b} + ${fx(2 * u1.c, 3)} × 450`, result: `${fx(dl.ic[0], 3)} ≤ λ ✓` },
            ]}
          />
        </>
      ),
    },
    {
      title: 'Losses: where a unit is matters',
      figure: (
        <div className="ed-row-2">
          <IcChart units={ind.units} d={dw} perMWh="₹/MWh" height={260} label="Incremental costs with losses: solid points are ICᵢ, rings are Lᵢ·ICᵢ on λ" />
          <div className="ps-card">
            <p className="eyebrow">Illustrative Indian plants at 900 MW (₹)</p>
            <DispatchBars units={ind.units} d={dw} />
          </div>
        </div>
      ),
      body: (
        <>
          <p>
            Power from a station far from the load loses part of itself in the lines on the way. A megawatt generated there is worth less than a megawatt generated next to the load. Unit 1 here is a
            pit-head coal station far away; Units 2 and 3 are near the load centre (illustrative data, in ₹).
          </p>
          <Eq
            title="B-coefficient loss formula and penalty factors"
            expr="P_L = Σᵢ Σⱼ Pᵢ·Bᵢⱼ·Pⱼ ,   Lᵢ = 1 / (1 − ∂P_L/∂Pᵢ) ,   λ = Lᵢ · dCᵢ/dPᵢ ,   Σ Pᵢ = P_D + P_L"
            where={[
              ['Bᵢⱼ', 'loss coefficients of the network (known)', '1/MW'],
              ['∂P_L/∂Pᵢ', 'incremental transmission loss = 2 Σⱼ Bᵢⱼ Pⱼ: MW lost per extra MW from unit i'],
              ['Lᵢ', 'penalty factor (≥ 1 for a unit whose output raises losses)'],
            ]}
            assume="the B-coefficients stay valid around this operating point (they come from a load flow); B₀ terms neglected"
          />
          <p>
            Without losses Unit 1 would run at {fx(dn.P[0], 1)} MW. With losses its penalty factor is <b>{fx(dw.pf[0], 4)}</b> (against {fx(dw.pf[1], 4)} and {fx(dw.pf[2], 4)}), so it runs where its
            own IC is lower — at <b>{fx(dw.P[0], 1)} MW</b> — and the near units supply more. Losses are {fx(dw.loss, 2)} MW; λ is {fx(dw.lambda, 1)} ₹/MWh delivered.
          </p>
          <p>
            The equations are now coupled (each Pᵢ appears in every penalty factor), so they are solved by <b>λ-iteration</b>: guess λ, find each Pᵢ from its coordination equation, check the balance,
            and correct λ by Δλ = (P_D + P_L − ΣPᵢ) / Σ ∂Pᵢ/∂λ.
          </p>
          <LambdaTable units={ind.units} d={dw} cur="INR" caption="λ-iteration with losses, 900 MW" />
          {level !== 'beginner' && <KktTable units={ind.units} d={dw} cur="INR" />}
          <p className="small muted">The coordination equations are satisfied at the result; they are necessary conditions for the cheapest dispatch with losses.</p>
        </>
      ),
    },
    {
      title: 'Which units to switch on?',
      figure: <ComboTable units={ind.units} combos={combos} best={best} pl={pl.combo} cur="INR" />,
      body: (
        <>
          <p>
            Dispatch shares the load among units that are already running. <b>Unit commitment</b> decides which to run. Each running unit pays its no-load cost a, so running fewer, larger units can be
            cheaper — if they can carry the load.
          </p>
          <p>
            The quick rule is the <b>priority list</b>: rank the units by their average cost at full output (C(P_max)/P_max: {pl.avg.map((x, i) => `U${i + 1} ${fx(x, 0)}`).join(', ')} ₹/MWh) and
            switch them on in that order until their capacity covers the load. At 700 MW it chooses <b>{pl.combo?.label}</b> ({fx(pl.combo?.cost ?? NaN, 0)} ₹/h).
          </p>
          <p>
            The exact answer tries all 2³ = 8 combinations (left). The cheapest is <b>{best?.label}</b> at {grp(best?.cost ?? NaN, 0)} ₹/h —{' '}
            {best && pl.combo && best.mask !== pl.combo.mask ? `${grp(pl.combo.cost! - best.cost!, 0)} ₹/h less than the priority list` : 'the same as the priority list'}.
          </p>
          <p className="small muted">Scope: one load level, no start-up costs, no ramp limits, no minimum up/down times, no reserve, no losses.</p>
        </>
      ),
    },
    {
      title: 'The daily load curve and the bill',
      figure: (
        <div className="ed-row-2">
          <Plot
            label="Illustrative daily load curve and its load duration curve"
            series={[
              { id: 'load', label: 'Load curve', color: 'var(--ps-c)', points: DAILY_LOAD_MW.flatMap((v, h) => [[h, v] as [number, number], [h + 1, v] as [number, number]]) },
              { id: 'ldc', label: 'Duration curve', color: 'var(--ps-b)', points: stats.ldc.flatMap((v, h) => [[h, v] as [number, number], [h + 1, v] as [number, number]]), dashed: true },
            ]}
            hlines={[{ y: stats.average, label: `average ${fx(stats.average, 0)} MW` }]}
            xLabel="Hour of the day [h]"
            yLabel="Load [MW]"
            xDomain={[0, 24]}
            yDomain={[0, Math.ceil((stats.peak * 1.12) / 100) * 100]}
            height={250}
          />
          <CommitStrip units={ind.units} plan={day.hours.map((h) => h.best)} loads={DAILY_LOAD_MW} />
        </div>
      ),
      body: (
        <>
          <p>
            Demand changes through the day (illustrative curve). Its <b>load factor</b> = average / peak = {fx(stats.average, 1)} / {fx(stats.peak, 0)} = <b>{fx(stats.loadFactor * 100, 1)} %</b>.
            Sorting the hours from highest to lowest gives the <b>load duration curve</b>. Committing the cheapest combination hour by hour (right) switches units on as the load rises in the evening.
          </p>
          <p>
            Consumers pay for both: a <b>two-part tariff</b> charges for the maximum demand (the capacity that must be built) and for the energy used. Illustrative rates: ₹{TARIFF.fixedPerKwMonth}/kW
            per month and ₹{TARIFF.energyPerKwh}/kWh.
          </p>
          <Calc
            title="An illustrative factory, one month"
            steps={[
              { label: 'Maximum demand', expr: 'highest hour of its daily curve', result: `${fx(bill.md, 0)} kW` },
              { label: 'Energy', expr: `${grp(bill.stats.energy, 0)} kWh/day × ${TARIFF.days} days`, result: `${grp(bill.kwh, 0)} kWh` },
              { label: 'Demand charge', expr: `${TARIFF.fixedPerKwMonth} × ${fx(bill.md, 0)}`, result: `₹${grp(bill.fixed, 0)}` },
              { label: 'Energy charge', expr: `${TARIFF.energyPerKwh} × ${grp(bill.kwh, 0)}`, result: `₹${grp(bill.energy, 0)}` },
              { label: 'Bill', expr: 'sum', result: `₹${grp(bill.total, 0)} (₹${fx(bill.perKwh, 3)}/kWh)` },
            ]}
          />
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Dispatch the units yourself →
          </button>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — Economic Operation tour, step ${step + 1} of ${steps.length}: ${cur.title}. Textbook case Saadat Ex 7.4: C1 = 500 + 5.3P + 0.004P², C2 = 400 + 5.5P + 0.006P², C3 = 200 + 5.8P + 0.009P² $/h, P_D = 800 MW → λ = ${fx(d74.lambda, 3)} $/MWh, P = ${d74.P.map((p) => fx(p, 1)).join(', ')} MW. ${step === 3 ? `Student's split: P1 = ${p1} MW, P3 = ${share - p1} MW, IC1 = ${fx(ic1, 3)}, IC3 = ${fx(ic3, 3)}.` : ''}`,
  )
  return (
    <div className="ps-stack">
      <div className="ed-figure">{cur.figure}</div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps.map((x) => ({ title: x.title, body: x.body }))} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
