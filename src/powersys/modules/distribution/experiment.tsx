import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { DistributorDiagram, VoltageProfile } from './DistributorDiagram.tsx'
import { EXPERIMENTS, type Experiment } from './experiments.ts'
import { grp, MODULE } from './shared.tsx'
import { PowerTriangle } from './visuals.tsx'

const num = (x: number, r: { unit: string; decimals: number }) => (r.unit.includes('₹') ? grp(x, r.decimals) : fx(x, r.decimals))

/** Experiment: predict first, then compare the two computed results. */
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
        <p className="small muted">Predict first, then see the computed result. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-exp-item ds-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
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

function ExperimentRun({ e, onAnswered }: { e: Experiment; onAnswered(): void }) {
  const res = useMemo(() => e.run(), [e])
  const [answered, setAnswered] = useState(false)
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${res.explain.join(' ')}` : 'The student has not predicted yet.'}`)
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
        answer={res.answer}
        onAnswered={() => {
          setAnswered(true)
          onAnswered()
        }}
        why={
          <>
            {res.explain.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
          </>
        }
      />
      {answered && (
        <>
          {res.dc && (
            <div className="ps-stack">
              {[res.dc.before, res.dc.after].map((s, k) => (
                <section key={k} className="ps-card ps-stack" aria-label={e.cols[k]}>
                  <p className="ds-h">{e.cols[k]}</p>
                  <DistributorDiagram d={s.d} r={s.r} label={e.cols[k]} />
                  <VoltageProfile d={s.d} r={s.r} height={190} />
                </section>
              ))}
            </div>
          )}
          {res.pf && e.id !== 'delta' && (
            <div className="ds-row-2">
              {[res.pf.before, res.pf.after].map((s, k) => (
                <section key={k} className="ps-card" aria-label={e.cols[k]}>
                  <p className="ds-h">{e.cols[k]}</p>
                  <PowerTriangle P={s.inp.P} r={s.r} height={260} />
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
                {res.rows.map((r) => {
                  const d = r.after - r.before
                  return (
                    <tr key={r.label} className={Math.abs(d) > 10 ** -r.decimals ? 'is-changed' : ''}>
                      <td>{r.label}</td>
                      <td>
                        {num(r.before, r)} {r.unit}
                      </td>
                      <td>
                        {num(r.after, r)} {r.unit}
                      </td>
                      <td className={d > 0 ? 'up' : d < 0 ? 'down' : ''}>{Math.abs(d) < 0.5 * 10 ** -r.decimals ? '—' : `${d > 0 ? '+' : '−'}${num(Math.abs(d), r)}`}</td>
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
