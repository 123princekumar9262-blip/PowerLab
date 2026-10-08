import { useMemo, useState } from 'react'
import type { Run } from '../../converters/types.ts'
import type { AnyTopic, CompareResult, CompareRow, Density } from '../../lab/types.ts'
import { formatSI } from '../../utils/format.ts'

const fmt = (row: CompareRow, v: number) => (row.unit === '%' ? `${(v * 100).toFixed(2)} %` : row.unit === '°' ? `${v.toFixed(2)}°` : formatSI(v, row.unit))
const fmtErr = (row: CompareRow) => (row.absolute ? `${(row.error * 100).toFixed(3)} pt` : `${(row.error * 100).toFixed(3)} %`)

/** ANALYZE: measurements with their theory, the derivation, topic tabs and the numerical checks. */
export function AnalyzePanel({ topic, r, m, p, density }: { topic: AnyTopic; r: Run; m: unknown; p: unknown; density: Density }) {
  const [tab, setTab] = useState('measure')
  const cmp = useMemo(() => topic.analyze.compare(r, m), [topic, r, m])
  const tabs: Array<[string, string]> = [['measure', 'Measurements'], ['theory', 'Theory'], ...(topic.analyze.tabs ?? []).map((t) => [t.id, t.label] as [string, string]), ['numerics', 'Numerical checks']]
  const extra = topic.analyze.tabs?.find((t) => t.id === tab)
  return (
    <section className="dc-analyze" aria-label="Analyze">
      <div className="seg tabs-seg" role="tablist" aria-label="Analysis">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'measure' && <MeasureTable cmp={cmp} />}
      {tab === 'theory' && <div className="dc-theory">{topic.analyze.theory(r, m)}</div>}
      {extra && extra.render({ r, m, p, density })}
      {tab === 'numerics' && <Numerics topic={topic} r={r} p={p} cmp={cmp} />}
    </section>
  )
}

export function MeasureTable({ cmp }: { cmp: CompareResult }) {
  const [theory, setTheory] = useState<'textbook' | 'exact'>('textbook')
  return (
    <>
      {cmp.header && <p className="small">{cmp.header}</p>}
      <div className="seg" role="radiogroup" aria-label="Theory column">
        <button role="radio" aria-checked={theory === 'textbook'} className={theory === 'textbook' ? 'on' : ''} onClick={() => setTheory('textbook')} title="Ideal closed-form relations, with their assumptions">
          Textbook formulas
        </button>
        <button role="radio" aria-checked={theory === 'exact'} className={theory === 'exact' ? 'on' : ''} onClick={() => setTheory('exact')} title="Exact analytic solution of the same equations (validates the solver)">
          Exact solution
        </button>
      </div>
      <div className="table-wrap">
        <table className="ba-table dc-table">
          <thead>
            <tr>
              <th>Quantity</th>
              <th className="num">SIMULATION</th>
              <th className="num">THEORY</th>
              <th className="num">Difference</th>
              <th>{theory === 'textbook' ? 'Formula / note' : 'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => {
              if (theory === 'exact')
                return (
                  <tr key={r.key}>
                    <th>{r.label}</th>
                    <td className="num">{fmt(r, r.sim)}</td>
                    <td className="num">{fmt(r, r.exact)}</td>
                    <td className="num">{fmtErr(r)}</td>
                    {r.expected ? (
                      <td className="small muted">{r.expected}</td>
                    ) : (
                      <td className={r.pass ? 'tone-ok' : 'tone-bad'}>
                        {r.pass ? '✓' : '✗'} within {r.absolute ? `${(r.tolerance * 100).toFixed(2)} pt` : `${(r.tolerance * 100).toFixed(2)} %`}
                      </td>
                    )}
                  </tr>
                )
              const t = r.textbook
              const tv = t && t.value !== null ? t.value : null
              return (
                <tr key={r.key}>
                  <th>{r.label}</th>
                  <td className="num">{fmt(r, r.sim)}</td>
                  <td className="num">{tv !== null ? fmt(r, tv) : '—'}</td>
                  <td className="num">
                    {r.textbookError === null
                      ? '—'
                      : r.unit === '%' || Math.abs(tv ?? 0) < 1e-12
                        ? `${(r.textbookError * 100).toFixed(2)} pt`
                        : `${r.textbookError >= 0 ? '+' : '−'}${Math.abs(r.textbookError * 100).toFixed(2)} %`}
                  </td>
                  <td className="small">
                    {t ? (
                      <>
                        {t.value !== null && <span className="mono">{t.formula}</span>}
                        {t.notApplicable && (
                          <span className="muted">
                            {t.value !== null ? ' — ' : ''}
                            {t.notApplicable}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted">No textbook relation listed; compare with the exact solution.</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {cmp.note && <p className="small">{cmp.note}</p>}
      <p className="muted small">
        SIMULATION = computed from the simulated waveforms. THEORY ={' '}
        {theory === 'textbook' ? 'ideal textbook relations; each holds only under its stated assumptions (see Theory)' : 'the exact analytic solution of the same circuit equations — agreement validates the numerical solver'}.
        Nothing here is MEASURED on hardware.
      </p>
    </>
  )
}

function Numerics({ topic, r, p, cmp }: { topic: AnyTopic; r: Run; p: unknown; cmp: CompareResult }) {
  const d = r.diagnostics
  const keys = topic.analyze.convergence ?? cmp.rows.slice(0, 2).map((x) => x.key)
  const [conv, setConv] = useState<null | Array<{ spp: number; errs: number[] }>>(null)
  const runConvergence = () => {
    const out: Array<{ spp: number; errs: number[] }> = []
    const base = r.params.stepsPerPeriod
    for (const spp of [base / 2, base, base * 2, base * 4].map((x) => Math.round(x))) {
      const rr = topic.simulate({ ...(p as object), stepsPerPeriod: spp, view: 'steady', periods: 1 })
      const c = topic.analyze.compare(rr, topic.measure(rr))
      out.push({ spp, errs: keys.map((k) => c.rows.find((x) => x.key === k)?.error ?? NaN) })
    }
    setConv(out)
  }
  return (
    <div className="dc-numerics">
      <dl className="dc-kv dc-kv--wide">
        <div>
          <dt>Steady state</dt>
          <dd>
            {d.steady.method === 'shooting'
              ? `shooting method, ${d.steady.iterations} Newton iteration${d.steady.iterations === 1 ? '' : 's'}`
              : d.steady.method === 'integration'
                ? 'period-by-period integration'
                : d.steady.method === 'direct'
                  ? 'direct evaluation: no energy storage, every edge located exactly'
                  : 'start-up run (not periodic yet)'}
          </dd>
        </div>
        <div>
          <dt>Periodicity residual</dt>
          <dd>{Number.isFinite(d.steady.residual) ? d.steady.residual.toExponential(2) : '—'} (relative; 0 = exactly periodic)</dd>
        </div>
        <div>
          <dt>Time step Δt</dt>
          <dd>
            {formatSI(r.params.dt, 's')} ({r.params.stepsPerPeriod} per {topic.periodName})
          </dd>
        </div>
        <div>
          <dt>Integrator</dt>
          <dd>trapezoidal rule, backward Euler on the step after each switching instant; switching instants located by bisection; gate edges stepped exactly</dd>
        </div>
        <div>
          <dt>Inconsistent device steps</dt>
          <dd>{d.fallbacks}</dd>
        </div>
        <div>
          <dt>Simulation vs exact theory</dt>
          <dd className={cmp.allPass ? 'tone-ok' : 'tone-bad'}>{cmp.allPass ? '✓ every quantity within tolerance' : '✗ some quantities outside tolerance'}</dd>
        </div>
        <div>
          <dt>Compute time</dt>
          <dd>{d.computeMs.toFixed(0)} ms</dd>
        </div>
      </dl>
      <button className="text-btn" onClick={runConvergence}>
        Check convergence (Δt halved three times)
      </button>
      {conv && (
        <table className="ba-table">
          <thead>
            <tr>
              <th>Steps / {topic.periodName}</th>
              {keys.map((k) => (
                <th key={k} className="num">
                  {cmp.rows.find((x) => x.key === k)?.label ?? k} error
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conv.map((c) => (
              <tr key={c.spp}>
                <th>{c.spp}</th>
                {c.errs.map((e, i) => (
                  <td key={i} className="num">
                    {(e * 100).toExponential(2)} %
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
