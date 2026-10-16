import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { Elevation, Ladder } from './diagrams.tsx'
import { EXPERIMENTS, type Experiment } from './experiments.ts'
import { MODULE } from './shared.tsx'
import { stringDrawLen } from './SpanScene.tsx'

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
  const frame = r.spans
    ? {
        L: Math.max(r.spans.before.input.L, r.spans.after.input.L),
        yMax: (Math.max(r.spans.before.input.hA + r.spans.before.input.h, r.spans.after.input.hA + r.spans.after.input.h) + stringDrawLen(5)) * 1.18 + 1,
      }
    : undefined
  return (
    <div className="ps-stack ps-exp-run">
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
          {r.spans && (
            <div className="ps-cols-2 mech-exp-pair">
              <div className="ps-card mech-flush">
                <p className="eyebrow">Before</p>
                <Elevation res={r.spans.before} stringLen={stringDrawLen(5)} frame={frame} compact label={`Before: ${e.title}`} />
              </div>
              <div className="ps-card mech-flush">
                <p className="eyebrow">After</p>
                <Elevation res={r.spans.after} stringLen={stringDrawLen(5)} frame={frame} compact label={`After: ${e.title}`} />
              </div>
            </div>
          )}
          {r.strings && (
            <div className="ps-cols-2 mech-exp-pair">
              <div className="ps-card mech-flush">
                <p className="eyebrow">Before</p>
                <Ladder str={r.strings.before} compact label={`Before: ${e.title}`} />
              </div>
              <div className="ps-card mech-flush">
                <p className="eyebrow">After</p>
                <Ladder str={r.strings.after} compact label={`After: ${e.title}`} />
              </div>
            </div>
          )}
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Before and after: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                  <th scope="col">Change</th>
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
                        {!changed ? 'no change' : `${d > 0 ? '+' : '−'}${fx(Math.abs(d), row.decimals)}${row.before !== 0 ? ` (${d > 0 ? '+' : '−'}${fx(Math.abs(d / row.before) * 100, 1)} %)` : ''}`}
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
