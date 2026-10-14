import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { DispatchBars, IcChart } from './charts.tsx'
import { enumerate, optimalCommitment, priorityCommitment } from './commitment.ts'
import { CURRENCY } from './dispatch.ts'
import { EXPERIMENTS, runExperiment, type EdExperiment, type Snapshot } from './experiments.ts'
import { grp } from './fmt.ts'
import { ComboTable, MODULE } from './shared.tsx'

/** Money in rupees with digit grouping; everything else to the row's decimals. */
const num = (x: number, r: { unit: string; decimals: number }) => (r.unit.includes('₹') && r.unit.endsWith('/h') ? grp(x, r.decimals) : fx(x, r.decimals))

/** Experiment: predict first, then compare the two computed dispatches. */
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
        <p className="small muted">Predict first, then see what the dispatch does. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-exp-item ed-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ps-stack" key={e.id}>
        <ExperimentRun e={e} onAnswered={() => onAnswered(e.id)} />
      </div>
    </div>
  )
}

function ExperimentRun({ e, onAnswered }: { e: EdExperiment; onAnswered(): void }) {
  const { before, after } = useMemo(() => runExperiment(e), [e])
  const [answered, setAnswered] = useState(false)
  const answer = e.answer(before, after)
  const cur = CURRENCY[e.currency]
  const why = e.explain(before, after)
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${why.join(' ')}` : 'The student has not predicted yet.'}`)
  // axis: up to the largest P_max, or a little beyond the outputs when the limits are far away
  const pTop = Math.max(...before.d.P, ...after.d.P)
  const xMax = Math.min(Math.max(...before.units.map((u) => u.pMax)), Math.ceil((pTop * 1.35) / 100) * 100)
  return (
    <>
      <div className="ps-card">
        <p className="eyebrow">Experiment</p>
        <h3>{e.title}</h3>
        <p>{e.change}</p>
      </div>
      <Predict
        question={e.question}
        options={e.options}
        answer={answer}
        onAnswered={() => {
          setAnswered(true)
          onAnswered()
        }}
        why={
          <>
            {why.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
          </>
        }
      />
      {answered && (
        <>
          {e.id === 'priority' ? (
            <ComboTable
              units={before.units}
              combos={enumerate(before.units, before.demand)}
              best={optimalCommitment(before.units, before.demand)}
              pl={priorityCommitment(before.units, before.demand).combo}
              cur={e.currency}
            />
          ) : (
            <div className="ed-row-2">
              {([before, after] as Snapshot[]).map((s, k) => (
                <section key={k} className="ps-stack" aria-label={e.cols[k]}>
                  <p className="eyebrow">{e.cols[k]}</p>
                  <IcChart units={s.units} d={s.d} perMWh={cur.perMWh} xMax={xMax} height={240} label={`${e.cols[k]}: incremental costs and operating points`} />
                  <DispatchBars units={s.units} d={s.d} xMax={xMax} />
                </section>
              ))}
            </div>
          )}
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Before and after: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">{e.cols[0]}</th>
                  <th scope="col">{e.cols[1]}</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {e.rows.map((r) => {
                  const b = r.get(before)
                  const a = r.get(after)
                  const d = a !== null && b !== null ? a - b : null
                  return (
                    <tr key={r.label} className={d !== null && Math.abs(d) > 10 ** -r.decimals ? 'is-changed' : ''}>
                      <td>{r.label}</td>
                      <td>
                        {b === null ? '—' : num(b, r)} {r.unit}
                      </td>
                      <td>
                        {a === null ? '—' : num(a, r)} {r.unit}
                      </td>
                      <td className={d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d === null ? '—' : `${d > 0 ? '+' : ''}${fx(d, r.decimals)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
