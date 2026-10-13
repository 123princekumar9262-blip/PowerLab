import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { FaultDiagram } from './diagrams.tsx'
import { EXPERIMENTS, runExperiment, type FaultExperiment } from './experiments.ts'
import { FAULT_LABEL } from './sequence.ts'
import { BUS_SHORT, faultModel, faultNetwork, tagsFor } from './study.ts'
import { faultStudy } from './zbus.ts'

const MODULE = 'faults'

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
      <nav className="ps-ft-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the fault study gives. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-ft-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-ft-exp-n" aria-hidden="true">
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

function ExperimentRun({ e, onAnswered }: { e: FaultExperiment; onAnswered(): void }) {
  const r = useMemo(() => runExperiment(e), [e])
  const [answered, setAnswered] = useState(false)
  const net = useMemo(() => faultNetwork(r.show.setup), [r])
  const fr = useMemo(() => faultStudy(faultModel(r.show.setup), r.show.bus, r.show.type), [r])
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <>
      <div className="ps-ft-exp-run ps-stack">
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
      </div>
      {answered && (
        <>
          <div className="ps-card table-wrap">
            <table className="ps-table ps-ft-table">
              <caption className="sr-only">Results: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  {r.table.cols.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.table.rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {row.values.map((v, k) => (
                      <td key={k}>{v === null ? '—' : `${fx(v, row.decimals)}${row.unit ? ` ${row.unit}` : ''}`}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Shown: a {FAULT_LABEL[r.show.type].toLowerCase()} fault at {BUS_SHORT[r.show.bus]},{' '}
            {r.show.setup.genEarth === 'reactor' ? `generator earthed through X_n = ${r.show.setup.xnPu} pu` : 'network as built'}.
          </p>
          <FaultDiagram net={net} result={fr} tags={tagsFor(r.show.setup)} label={`Network during the experiment’s fault`} />
        </>
      )}
    </>
  )
}
