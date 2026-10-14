import { useMemo, useState } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { computeLine } from './calc.ts'
import { CrossSection } from './CrossSection.tsx'
import { EXPERIMENTS, type Experiment } from './experiments.ts'
import { MODULE } from './shared.tsx'
import { SkinPlot } from './visuals.tsx'

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
  const transpose = e.id === 'transpose'
  useTutorContext(() => `Experiment mode — "${e.title}": ${e.change} Question: ${e.question} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  const resB = r.designs ? computeLine(r.designs.before.geometry, r.designs.before.options) : null
  const resA = r.designs ? computeLine(r.designs.after.geometry, r.designs.after.options) : null
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
          {r.designs && resB?.ok && resA?.ok && (
            <div className="ps-cols-2 lp-exp-pair">
              <div className="ps-card lp-flush">
                <p className="eyebrow">Before</p>
                <CrossSection design={r.designs.before} res={resB} compact frame={[...r.designs.before.geometry.phases, ...r.designs.after.geometry.phases]} label={`Before: ${e.title}`} />
              </div>
              <div className="ps-card lp-flush">
                <p className="eyebrow">After</p>
                <CrossSection design={r.designs.after} res={resA} compact frame={[...r.designs.before.geometry.phases, ...r.designs.after.geometry.phases]} label={`After: ${e.title}`} />
              </div>
            </div>
          )}
          {r.profiles && (
            <div className="ps-card lp-flush">
              <SkinPlot
                curves={[
                  { q: 0, label: 'dc (uniform)', color: 'var(--text-3)', dashed: true },
                  { q: r.profiles.qBefore, label: `${r.profiles.fBefore} Hz`, color: 'var(--ps-c)' },
                  { q: r.profiles.qAfter, label: `${r.profiles.fAfter} Hz`, color: 'var(--ps-a)' },
                ]}
              />
            </div>
          )}
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Before and after: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">{transpose ? 'Transposed' : 'Before'}</th>
                  <th scope="col">{transpose ? 'Not transposed' : 'After'}</th>
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
                        {!changed ? 'no change' : `${d > 0 ? '+' : ''}${fx(d, row.decimals)} (${d > 0 ? '+' : ''}${fx((d / Math.abs(row.before)) * 100, 1)} %)`}
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
