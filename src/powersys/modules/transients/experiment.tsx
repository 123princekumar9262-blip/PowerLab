import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { Chart } from './charts.tsx'
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
  const [cursor, setCursor] = useState<number | null>(null)
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  const xs = r.plot.series.flatMap((s) => s.points.map((p) => p[0]))
  const xDomain: [number, number] = [Math.min(...xs), Math.max(...xs)]
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
        <div className="ps-split tr-exp-result">
          <div className="ps-card tr-flush">
            <Chart
              series={r.plot.series}
              xLabel={r.plot.xLabel}
              yLabel={r.plot.yLabel}
              xUnit="µs"
              yUnit={r.plot.yUnit}
              xDomain={xDomain}
              hlines={r.plot.hlines}
              cursor={cursor}
              onCursor={setCursor}
              label={`Computed result: ${e.title}`}
              height={250}
            />
          </div>
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Computed values: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">Computed</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="tr-num">
                      {fx(row.value, row.decimals)} {row.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
