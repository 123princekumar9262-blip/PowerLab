import { useEffect, useId, useMemo, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { CommitStrip, CostChart, DispatchBars, IcChart, unitColor } from './charts.tsx'
import { DAILY_LOAD_MW, FACTORY_KW, TARIFF, curveStats, dailyCommitment, enumerate, monthlyBill, optimalCommitment, priorityCommitment, shiftLoad } from './commitment.ts'
import { CASES, CURRENCY, dispatch, scaleFuel, equalShareCost, indiaCase, type CaseId, type Unit } from './dispatch.ts'
import { ComboTable, KktTable, LambdaTable, MODULE, costD, lamD, money, tiny } from './shared.tsx'
import { grp } from './fmt.ts'

type Tab = 'dispatch' | 'commit' | 'tariff'

export function Explore() {
  const [tab, setTab] = useState<Tab>('dispatch')
  return (
    <div className="ps-stack">
      <div className="ps-toolbar ed-tabs">
        <Seg
          label="What to explore"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'dispatch', label: 'Economic dispatch' },
            { id: 'commit', label: 'Unit commitment' },
            { id: 'tariff', label: 'Load curve & tariff' },
          ]}
        />
      </div>
      {tab === 'dispatch' && <DispatchLab />}
      {tab === 'commit' && <CommitLab />}
      {tab === 'tariff' && <TariffLab />}
    </div>
  )
}

// ── economic dispatch ─────────────────────────────────────────────────────────────────────────────────────────

interface DState {
  caseId: CaseId
  demand: number
  units: Unit[]
  /** Fuel-price multiplier per unit: scales the whole cost curve (a, b and c). */
  price: number[]
  losses: boolean
  /** Bumped on reset / case change so the typed limit fields start again from the case's values. */
  rev: number
}
const init = (id: CaseId, rev = 0): DState => {
  const c = CASES[id]()
  return { caseId: id, demand: c.demand, units: c.units, price: c.units.map(() => 1), losses: false, rev }
}
const sameUnit = (a: Unit, b: Unit) => a.on === b.on && a.pMin === b.pMin && a.pMax === b.pMax

/** What is wrong with the edited units (empty when valid). */
function invalid(units: Unit[]): string[] {
  const out: string[] = []
  units.forEach((u) => {
    if (!Number.isFinite(u.pMin) || !Number.isFinite(u.pMax)) out.push(`${u.name}: enter both limits as numbers (MW).`)
    else if (u.pMin < 0) out.push(`${u.name}: P_min cannot be negative.`)
    else if (u.pMax <= u.pMin) out.push(`${u.name}: P_max (${fx(u.pMax, 0)} MW) must be above P_min (${fx(u.pMin, 0)} MW).`)
  })
  return out
}

function DispatchLab() {
  const level = useLevel()
  const progress = usePsProgress()
  const [st, setSt] = useState<DState>(() => init('saadat'))
  const [chart, setChart] = useState<'ic' | 'cost'>('ic')
  const [seen, setSeen] = useState({ limit: false, loss: false })
  const c = useMemo(() => CASES[st.caseId](), [st.caseId])
  const cur = c.currency
  const units = useMemo(() => st.units.map((u, i) => ({ ...scaleFuel(c.units[i], st.price[i]), name: u.name, kind: u.kind, pMin: u.pMin, pMax: u.pMax, on: u.on })), [st.units, st.price, c])
  const bad = invalid(units)
  const B = st.losses ? c.B : null
  const d = useMemo(() => (bad.length ? null : dispatch(units, st.demand, B)), [units, st.demand, B, bad.length])
  const okd = d && d.ok ? d : null
  const xMax = Math.max(...units.map((u) => (Number.isFinite(u.pMax) ? u.pMax : 0)), 100)
  const edited = st.demand !== c.demand || st.losses || st.price.some((p) => p !== 1) || st.units.some((u, i) => !sameUnit(u, c.units[i]))
  // the Explore activity: drive a unit to a limit, and switch losses on
  const atLimit = !!okd && okd.limit.some((l) => l !== null)
  useEffect(() => {
    if (atLimit && !seen.limit) setSeen((s) => ({ ...s, limit: true }))
    if (okd && st.losses && !seen.loss) setSeen((s) => ({ ...s, loss: true }))
  }, [atLimit, okd, st.losses, seen])
  useEffect(() => {
    if (seen.limit && seen.loss) completeActivity(MODULE, 'dispatch')
  }, [seen])
  const setUnit = (i: number, patch: Partial<Unit>) => setSt((s) => ({ ...s, units: s.units.map((u, k) => (k === i ? { ...u, ...patch } : u)) }))
  const eq =
    okd && !st.losses && units.every((u) => !u.on || (st.demand / units.filter((x) => x.on).length >= u.pMin && st.demand / units.filter((x) => x.on).length <= u.pMax))
      ? equalShareCost(units, st.demand)
      : null

  useTutorContext(() => {
    const unitsTxt = units.map((u) => `${u.name} (${u.kind}) ${u.on ? 'on' : 'off'}: C = ${u.a} + ${fx(u.b, 3)}P + ${u.c}P², limits ${u.pMin}–${u.pMax} MW`).join('; ')
    const res = okd
      ? `λ = ${fx(okd.lambda, 4)} ${CURRENCY[cur].perMWh}, outputs ${okd.P.map((p) => fx(p, 2)).join(', ')} MW, losses ${fx(okd.loss, 3)} MW, total cost ${fx(okd.total, 1)} ${CURRENCY[cur].perH}, units at limits: ${
          okd.limit
            .map((l, i) => (l ? `${units[i].name} at ${l}` : null))
            .filter(Boolean)
            .join(', ') || 'none'
        }.`
      : d && !d.ok
        ? `Infeasible: ${d.message}`
        : `Invalid input: ${bad.join(' ')}`
    return `Explore — economic dispatch. Case: ${c.title}. Demand ${st.demand} MW, losses ${st.losses ? 'on (B-coefficients)' : 'off'}. Units: ${unitsTxt}. Result: ${res}`
  })

  const readouts: ReadoutItem[] = okd
    ? [
        { label: 'System λ', value: fx(okd.lambda, lamD(cur)), unit: CURRENCY[cur].perMWh, note: 'cost of the next MW delivered' },
        { label: 'Total fuel cost', value: grp(okd.total, costD(cur)), unit: CURRENCY[cur].perH, note: `${fx(okd.total / st.demand, lamD(cur))} ${CURRENCY[cur].perMWh} on average` },
        ...(st.losses
          ? [{ label: 'Transmission losses', value: fx(okd.loss, 2), unit: 'MW', note: `${fx((okd.loss / (st.demand + okd.loss)) * 100, 2)} % of generation` }]
          : eq !== null
            ? [{ label: 'Sharing equally would cost', value: `+${grp(eq - okd.total, costD(cur))}`, unit: CURRENCY[cur].perH, note: `${fx(st.demand / units.filter((u) => u.on).length, 1)} MW each` }]
            : []),
        {
          label: 'Power balance',
          value: tiny(okd.mismatch, 3),
          unit: 'MW',
          tone: 'good' as const,
          note: `ΣP ${fx(
            okd.P.reduce((s, p) => s + p, 0),
            2,
          )} = P_D ${fx(st.demand, 0)}${st.losses ? ` + P_L ${fx(okd.loss, 2)}` : ''}`,
        },
      ]
    : []

  return (
    <div className="ps-stack">
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          {level !== 'beginner' && (
            <div className="ps-toolbar">
              <Seg
                label="Chart"
                value={chart}
                onChange={setChart}
                options={[
                  { id: 'ic', label: 'Incremental cost' },
                  { id: 'cost', label: 'Fuel cost' },
                ]}
              />
              {st.losses && chart === 'ic' && <span className="small muted">● ICᵢ · ○ Lᵢ·ICᵢ (on the λ line)</span>}
            </div>
          )}
          {chart === 'ic' || level === 'beginner' ? (
            <IcChart units={units} d={okd} perMWh={CURRENCY[cur].perMWh} xMax={xMax} />
          ) : (
            <CostChart units={units} d={okd} perH={CURRENCY[cur].perH} xMax={xMax} />
          )}
          {bad.length > 0 && (
            <Callout tone="bad" title="Check the unit data">
              {bad.map((m) => (
                <p key={m}>{m}</p>
              ))}
              <p>No dispatch is computed until the limits are valid.</p>
            </Callout>
          )}
          {d && !d.ok && (
            <Callout tone="bad" title={d.reason === 'none' ? 'No unit is on' : d.reason === 'over' ? 'The demand cannot be met' : 'The demand is too low for these units'}>
              <p>{d.message}</p>
              <p>
                {d.reason === 'over'
                  ? 'Lower the demand, switch on another unit, or raise a P_max.'
                  : d.reason === 'under'
                    ? 'Raise the demand or switch a unit off (unit commitment decides which units to run).'
                    : 'Switch on at least one unit.'}{' '}
                No dispatch is shown.
              </p>
            </Callout>
          )}
          <section className="ps-card" aria-label="Outputs">
            <DispatchBars units={units} d={okd} xMax={xMax} />
          </section>
        </div>
        <aside className="ps-stack">
          <section className="ps-card ed-controls" aria-labelledby="ed-operate">
            <h3 id="ed-operate">Dispatch the units</h3>
            <Seg
              label="Case"
              value={st.caseId}
              onChange={(id) => setSt(init(id, st.rev + 1))}
              full
              options={[
                { id: 'saadat', label: 'Textbook ($)' },
                { id: 'india', label: 'Indian plants (₹)' },
              ]}
            />
            <p className="small muted">{c.source}</p>
            <Slider label="Demand P_D" value={st.demand} min={c.range[0]} max={c.range[1]} step={5} unit="MW" onChange={(v) => setSt((s) => ({ ...s, demand: v }))} decimals={0} />
            {okd && <Readouts label="Dispatch result" items={readouts} />}
            <div className="ps-toolbar-group">
              <button type="button" className="text-btn" onClick={() => setSt(init(st.caseId, st.rev + 1))} disabled={!edited}>
                Reset
              </button>
            </div>
          </section>
          <details className="ps-card ps-more" open={level !== 'beginner'}>
            <summary>Units, limits, fuel price and losses</summary>
            <Toggle
              label={c.B ? 'Include transmission losses (B-coefficients)' : 'Transmission losses (no loss data for this case)'}
              checked={st.losses}
              onChange={(v) => c.B && setSt((s) => ({ ...s, losses: v }))}
            />
            {!c.B && <p className="small muted">The textbook example has no loss coefficients. Switch to the Indian plants to include losses.</p>}
            <div className="ed-units">
              {units.map((u, i) => (
                <UnitEditor
                  key={`${c.id}-${u.id}-${st.rev}`}
                  u={u}
                  i={i}
                  price={st.price[i]}
                  cur={CURRENCY[cur].perMWh}
                  onUnit={(p) => setUnit(i, p)}
                  onPrice={(v) => setSt((s) => ({ ...s, price: s.price.map((x, k) => (k === i ? v : x)) }))}
                />
              ))}
            </div>
          </details>
          <section className="ps-card">
            <p className="eyebrow">Activity</p>
            <ul className="ed-task">
              <li className={seen.limit ? 'is-done' : ''}>{seen.limit ? '✓' : '○'} Drive a unit to one of its limits (raise or lower the demand, or edit a limit)</li>
              <li className={seen.loss ? 'is-done' : ''}>{seen.loss ? '✓' : '○'} Include transmission losses (Indian plants)</li>
            </ul>
            {isDone(progress, MODULE, 'dispatch') && <p className="small muted">✓ Activity complete.</p>}
          </section>
        </aside>
      </div>
      {okd && (
        <details className="ps-card ps-more" open={level === 'engineer'}>
          <summary>The λ-iteration, step by step ({okd.steps.length} rows)</summary>
          <p className="small muted">
            Start from the incremental cost of an equal share; at each λ find every Pᵢ from{' '}
            {st.losses ? 'its coordination equation (clamped to its limits)' : 'Pᵢ = (λ − bᵢ)/2cᵢ, clamped to its limits'}; correct λ by Δλ = −mismatch / Σ ∂Pᵢ/∂λ over the units between their limits
            (bisection inside a bracket if that step would leave it). Stops when |ΣP − P_D{st.losses ? ' − P_L' : ''}| &lt; 10⁻⁹ MW.
          </p>
          <LambdaTable units={units} d={okd} cur={cur} />
        </details>
      )}
      {okd && (
        <details className="ps-card ps-more" open={level === 'engineer'}>
          <summary>Optimality conditions{st.losses ? ' and penalty factors' : ''}</summary>
          <KktTable units={units} d={okd} cur={cur} />
          <p className="small muted">
            {st.losses
              ? 'The coordination equations λ = Lᵢ·ICᵢ hold for every unit between its limits — necessary conditions for the cheapest dispatch with losses.'
              : 'Every unit between its limits runs at IC = λ; a unit at a limit has left the equal-λ set.'}
          </p>
        </details>
      )}
    </div>
  )
}

function NumberField({ label, value, onChange, invalid }: { label: string; value: number; onChange(v: number): void; invalid?: boolean }) {
  const id = useId()
  const [text, setText] = useState(String(value))
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={10}
        value={text}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.trim() === '' ? NaN : Number(e.target.value))
        }}
      />
    </label>
  )
}

function UnitEditor({ u, i, price, cur, onUnit, onPrice }: { u: Unit; i: number; price: number; cur: string; onUnit(p: Partial<Unit>): void; onPrice(v: number): void }) {
  const wrong = !(u.pMax > u.pMin) || u.pMin < 0 || !Number.isFinite(u.pMin) || !Number.isFinite(u.pMax)
  return (
    <div className="ed-unit">
      <div className="ed-unit-head">
        <b>
          <span className="ed-dot" style={{ background: unitColor(i) }} aria-hidden="true" />
          {u.name}
        </b>
        <Toggle label="on" checked={u.on} onChange={(v) => onUnit({ on: v })} />
      </div>
      <div className="ed-lims">
        <NumberField label="P_min" value={u.pMin} onChange={(v) => onUnit({ pMin: v })} invalid={wrong} />
        <NumberField label="P_max" value={u.pMax} onChange={(v) => onUnit({ pMax: v })} invalid={wrong} />
        <span>MW</span>
      </div>
      <Slider label={`Fuel price (cost curve × k; b now ${fx(u.b, u.b < 100 ? 3 : 0)} ${cur})`} value={price} min={0.5} max={1.5} step={0.05} unit="×" onChange={onPrice} decimals={2} />
    </div>
  )
}

// ── unit commitment ───────────────────────────────────────────────────────────────────────────────────────────

function CommitLab() {
  const level = useLevel()
  const [view, setView] = useState<'single' | 'day'>('single')
  const [load, setLoad] = useState(900)
  const [plan, setPlan] = useState<'best' | 'pl'>('best')
  const c = useMemo(() => indiaCase(), [])
  const combos = useMemo(() => enumerate(c.units, load), [c, load])
  const best = useMemo(() => optimalCommitment(c.units, load), [c, load])
  const pl = useMemo(() => priorityCommitment(c.units, load), [c, load])
  const day = useMemo(() => dailyCommitment(c.units, DAILY_LOAD_MW), [c])
  const differs = !!best && !!pl.combo && best.mask !== pl.combo.mask
  useEffect(() => {
    if (differs) completeActivity(MODULE, 'commit')
  }, [differs])
  const capMax = c.units.reduce((s, u) => s + u.pMax, 0)
  useTutorContext(
    () =>
      `Explore — unit commitment (illustrative Indian units, ₹, no losses, no start-up costs). ${view === 'single' ? `Load ${load} MW. Priority list (full-load average cost ${pl.avg.map((x) => fx(x, 0)).join(', ')} ₹/MWh) commits ${pl.combo?.label ?? 'nothing feasible'} at ${grp(pl.combo?.cost ?? NaN, 0)} ₹/h; enumeration of 8 combinations finds ${best?.label ?? 'none'} at ${grp(best?.cost ?? NaN, 0)} ₹/h.` : `Daily plan: exact ${grp(day.costBest ?? NaN, 0)} ₹/day, priority list ${grp(day.costPl ?? NaN, 0)} ₹/day.`}`,
  )
  return (
    <div className="ps-stack">
      <Callout title="Scope">
        <p>
          The illustrative Indian units (₹). One load level at a time — each hour of the day is treated independently. No start-up or shut-down costs, no ramp limits, no minimum up/down times, no
          reserve, no losses. Each committed unit pays its no-load cost and is dispatched economically.
        </p>
      </Callout>
      <div className="ps-toolbar">
        <Seg
          label="Period"
          value={view}
          onChange={setView}
          options={[
            { id: 'single', label: 'One load level' },
            { id: 'day', label: 'A day, hour by hour' },
          ]}
        />
      </div>
      {view === 'single' ? (
        <div className="ps-split ps-split--wide-side">
          <div className="ps-stack">
            <ComboTable units={c.units} combos={combos} best={best} pl={pl.combo} cur="INR" />
            {best?.dispatch && <DispatchBars units={c.units.map((u, i) => ({ ...u, on: best.on[i] }))} d={best.dispatch} />}
          </div>
          <aside className="ps-stack">
            <section className="ps-card">
              <h3>Commit for one load</h3>
              <Slider label="Load" value={load} min={200} max={1400} step={10} unit="MW" onChange={setLoad} decimals={0} />
              {!best ? (
                <Callout tone="bad" title="No combination can supply this load">
                  <p>{load > capMax ? `All three units together give at most ${fx(capMax, 0)} MW.` : `Every combination’s minimum output is above ${fx(load, 0)} MW.`}</p>
                </Callout>
              ) : (
                <Readouts
                  items={[
                    { label: 'Best (all 8 tried)', value: best.label, note: money(best.cost!, 'INR') },
                    pl.combo
                      ? {
                          label: 'Priority list',
                          value: pl.combo.label,
                          note: pl.combo.feasible ? money(pl.combo.cost!, 'INR') : `infeasible: ${pl.combo.why}`,
                          tone: differs ? 'warn' : 'good',
                        }
                      : { label: 'Priority list', value: '—', note: 'cannot reach the load' },
                    ...(differs && pl.combo?.cost != null ? [{ label: 'Extra cost of the list', value: `+${grp(pl.combo.cost - best.cost!, 0)}`, unit: '₹/h', tone: 'warn' as const }] : []),
                  ]}
                />
              )}
              <p className="small muted">Activity: find a load where the priority list is not the cheapest commitment.</p>
            </section>
            <section className="ps-card">
              <h3>The priority list</h3>
              <p className="small">Full-load average cost C(P_max)/P_max, cheapest first:</p>
              <ol className="small">
                {pl.order.map((i) => (
                  <li key={i}>
                    {c.units[i].name} — {fx(pl.avg[i], 0)} ₹/MWh{' '}
                    <span className="muted">
                      ({c.units[i].kind}, up to {c.units[i].pMax} MW)
                    </span>
                  </li>
                ))}
              </ol>
              {level === 'engineer' && (
                <p className="small muted">The list ignores how cheap a unit is at part load and its no-load cost relative to the load — which is why it can miss the optimum.</p>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <div className="ps-stack">
          <div className="ps-toolbar">
            <Seg
              label="Plan shown"
              value={plan}
              onChange={setPlan}
              options={[
                { id: 'best', label: 'Best each hour' },
                { id: 'pl', label: 'Priority list' },
              ]}
            />
          </div>
          <CommitStrip width={1100} units={c.units} plan={day.hours.map((h) => (plan === 'best' ? h.best : h.pl))} loads={DAILY_LOAD_MW} diff={day.hours.map((h) => h.best?.mask !== h.pl?.mask)} />
          <Readouts
            items={[
              { label: 'Best commitment, whole day', value: grp(day.costBest ?? NaN, 0), unit: '₹/day' },
              { label: 'Priority list, whole day', value: grp(day.costPl ?? NaN, 0), unit: '₹/day' },
              {
                label: 'Saved by the exact method',
                value: grp((day.costPl ?? NaN) - (day.costBest ?? NaN), 0),
                unit: '₹/day',
                note: `${day.hours.filter((h) => h.best?.mask !== h.pl?.mask).length} of 24 hours differ`,
              },
            ]}
          />
          <p className="small muted">Illustrative load curve. Start-up costs are ignored, so switching a unit on for a single hour costs nothing extra here — in practice it would.</p>
        </div>
      )}
    </div>
  )
}

// ── load curve and tariff ─────────────────────────────────────────────────────────────────────────────────────

function TariffLab() {
  const [shift, setShift] = useState(0)
  const stats = useMemo(() => curveStats(DAILY_LOAD_MW), [])
  const base = useMemo(() => monthlyBill(FACTORY_KW), [])
  const kw = useMemo(() => shiftLoad(FACTORY_KW, shift), [shift])
  const bill = useMemo(() => monthlyBill(kw), [kw])
  const step = (xs: number[]) => xs.flatMap((v, h) => [[h, v] as [number, number], [h + 1, v] as [number, number]])
  useTutorContext(
    () =>
      `Explore — load curve and tariff (illustrative). System: peak ${stats.peak} MW, average ${fx(stats.average, 1)} MW, load factor ${fx(stats.loadFactor * 100, 1)} %. Factory with ${fx(shift * 100, 0)} % of its above-average load moved to night: maximum demand ${fx(bill.md, 1)} kW, ${grp(bill.kwh, 0)} kWh/month, load factor ${fx(bill.stats.loadFactor * 100, 1)} %, bill ₹${grp(bill.total, 0)} (two-part tariff ₹${TARIFF.fixedPerKwMonth}/kW·month + ₹${TARIFF.energyPerKwh}/kWh).`,
  )
  return (
    <div className="ps-stack">
      <div className="ed-row-2">
        <section className="ps-stack">
          <h3 className="ps-h3">System load curve (illustrative)</h3>
          <Plot
            label="Daily load curve and its load duration curve"
            series={[
              { id: 'load', label: 'Load curve', color: 'var(--ps-c)', points: step(DAILY_LOAD_MW) },
              { id: 'ldc', label: 'Duration curve', color: 'var(--ps-b)', points: step(stats.ldc), dashed: true },
            ]}
            hlines={[
              { y: stats.average, label: `average ${fx(stats.average, 0)} MW` },
              { y: stats.peak, label: `peak ${fx(stats.peak, 0)} MW` },
            ]}
            xLabel="Hour [h] (duration curve: hours at or above)"
            yLabel="Load [MW]"
            xDomain={[0, 24]}
            yDomain={[0, Math.ceil((stats.peak * 1.12) / 100) * 100]}
            height={250}
          />
          <Readouts
            items={[
              { label: 'Peak', value: fx(stats.peak, 0), unit: 'MW', note: `at ${String(stats.peakHour).padStart(2, '0')}:00` },
              { label: 'Average', value: fx(stats.average, 1), unit: 'MW' },
              { label: 'Energy', value: grp(stats.energy, 0), unit: 'MWh/day' },
              { label: 'Load factor', value: fx(stats.loadFactor * 100, 1), unit: '%', note: 'average ÷ peak' },
            ]}
          />
        </section>
        <section className="ps-stack">
          <h3 className="ps-h3">A factory’s bill: two-part tariff (illustrative)</h3>
          <Plot
            label="The factory's daily demand, before and after moving load out of the peak"
            series={[
              { id: 'orig', label: 'As it is', color: 'var(--text-3)', points: step(FACTORY_KW), dashed: true },
              { id: 'new', label: 'With load moved', color: 'var(--ps-mv)', points: step(kw) },
            ]}
            hlines={[{ y: bill.md, label: `maximum demand ${fx(bill.md, 0)} kW` }]}
            xLabel="Hour [h]"
            yLabel="Demand [kW]"
            xDomain={[0, 24]}
            yDomain={[0, 900]}
            height={250}
          />
          <Slider
            label="Move load out of the peak (same energy each day)"
            value={shift}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={setShift}
            decimals={2}
            hint="0 = as it is; 1 = flat all day. The above-average part of the load is moved into the hours below the average."
          />
          <Readouts
            items={[
              { label: 'Maximum demand', value: fx(bill.md, 0), unit: 'kW', note: `load factor ${fx(bill.stats.loadFactor * 100, 1)} %` },
              { label: 'Demand charge', value: `₹${grp(bill.fixed, 0)}`, note: `₹${TARIFF.fixedPerKwMonth}/kW × ${fx(bill.md, 0)} kW` },
              { label: 'Energy charge', value: `₹${grp(bill.energy, 0)}`, note: `₹${TARIFF.energyPerKwh}/kWh × ${grp(bill.kwh, 0)} kWh` },
              {
                label: 'Monthly bill',
                value: `₹${grp(bill.total, 0)}`,
                note: `₹${grp(bill.perKwh, 3)}/kWh${shift > 0 ? ` · saves ₹${grp(base.total - bill.total, 0)}` : ''}`,
                tone: shift > 0 ? 'good' : undefined,
              },
            ]}
          />
        </section>
      </div>
      <p className="small muted">Rates and load curves are illustrative, not a real tariff schedule. A month is taken as {TARIFF.days} identical days.</p>
    </div>
  )
}
