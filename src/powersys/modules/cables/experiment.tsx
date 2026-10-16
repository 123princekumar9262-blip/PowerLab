import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { EXPERIMENTS, type Experiment } from './experiments.ts'
import { MODULE } from './shared.tsx'

export function Experiments() {
  const [current, setCurrent] = useState(EXPERIMENTS[0].id)
  const progress = usePsProgress()
  const e = EXPERIMENTS.find((x) => x.id === current)!
  const onAnswered = (id: string) => {
    completeActivity(MODULE, `exp-${id}`)
    const done = new Set([...EXPERIMENTS.filter((x) => isDone(progress, MODULE, `exp-${x.id}`)).map((x) => x.id), id])
    if (done.size >= 3) completeActivity(MODULE, 'experiments')
  }
  return (
    <div className="ps-stack">
      <nav className="ps-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the calculation says. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <ExperimentRun key={e.id} e={e} onAnswered={() => onAnswered(e.id)} />
    </div>
  )
}

function ExperimentRun({ e, onAnswered }: { e: Experiment; onAnswered(): void }) {
  const r = useMemo(() => e.run(), [e])
  const [answered, setAnswered] = useState(false)
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <div className="ps-stack">
      <div className="ps-card">
        <p className="eyebrow">Experiment</p>
        <h3>{e.title}</h3>
        <p>{e.change}</p>
      </div>
      <Predict
        question={e.question}
        options={e.options}
        answer={r.answer}
        onAnswered={() => {
          setAnswered(true)
          onAnswered()
        }}
        why={
          <>
            {r.explain.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
          </>
        }
      />
      {answered && (
        <>
          {r.plot && (
            <div className="ps-card cb-flush">
              <div className="cb-plot-narrow">
                <Plot series={r.plot.series} xLabel={r.plot.xLabel} yLabel={r.plot.yLabel} vlines={r.plot.vlines} label={r.plot.label} height={230} />
              </div>
            </div>
          )}
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Before and after: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">{r.columns?.[0] ?? 'Before'}</th>
                  <th scope="col">{r.columns?.[1] ?? 'After'}</th>
                  <th scope="col">{r.columns ? 'Difference' : 'Change'}</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => {
                  const d = row.after - row.before
                  const changed = Math.abs(d) > 0.5 * 10 ** -row.decimals
                  return (
                    <tr key={row.label} className={changed ? 'is-changed' : ''}>
                      <td>{row.label}</td>
                      <td>
                        {fx(row.before, row.decimals)} {row.unit}
                      </td>
                      <td>
                        {fx(row.after, row.decimals)} {row.unit}
                      </td>
                      <td className={!changed ? '' : d > 0 ? 'up' : 'down'}>
                        {!changed ? 'no change' : `${d > 0 ? '+' : '−'}${fx(Math.abs(d), row.decimals)} (${d > 0 ? '+' : '−'}${fx((Math.abs(d) / Math.abs(row.before)) * 100, 1)} %)`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
