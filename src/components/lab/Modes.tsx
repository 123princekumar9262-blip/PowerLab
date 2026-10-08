import { useMemo, useState } from 'react'
import type { AnyTopic, Experiment, Lesson, MeasureLabel } from '../../lab/types.ts'
import { formatSI } from '../../utils/format.ts'

type M = Record<string, unknown>

const show = (labels: Record<string, MeasureLabel>, k: string, v: unknown) => (typeof v === 'number' ? (labels[k]?.fmt(v) ?? v.toPrecision(4)) : String(v))

/** Before/after table of simulated measurements. */
export function BeforeAfter({ rows, before, after, labels }: { rows: string[]; before: M; after: M; labels: Record<string, MeasureLabel> }) {
  return (
    <div className="table-wrap">
      <table className="ba-table">
        <thead>
          <tr>
            <th>SIMULATION</th>
            <th className="num">Before</th>
            <th className="num">After</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => {
            const a = before[k]
            const b = after[k]
            const num = typeof a === 'number' && typeof b === 'number'
            const ratio = num && Math.abs(a) > 1e-12 ? b / a : null
            return (
              <tr key={k} className={a !== b ? 'changed' : ''}>
                <th>{labels[k]?.label ?? k}</th>
                <td className="num">{show(labels, k, a)}</td>
                <td className="num">{show(labels, k, b)}</td>
                <td className="num">{num ? (ratio !== null ? `×${ratio.toFixed(3)}` : '—') : a === b ? 'same' : 'changed'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** EXPERIMENT: predict → run → result → why; plus a free before/after capture. */
export function ExperimentPanel({ topic, params, m, onApply, captureRows }: { topic: AnyTopic; params: object; m: M; onApply: (patch: object) => void; captureRows: string[] }) {
  const [exp, setExp] = useState<Experiment<object, M> | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [res, setRes] = useState<{ before: M; after: M; p0: object; p1: object } | null>(null)
  const [snap, setSnap] = useState<{ m: M; p: object } | null>(null)
  const run = () => {
    if (!exp) return
    const p0 = { ...params, view: 'steady' }
    const p1 = { ...p0, ...exp.change(p0) }
    setRes({ before: topic.measure(topic.simulate(p0)), after: topic.measure(topic.simulate(p1)), p0, p1 })
  }
  if (exp) {
    const verdict = res ? exp.judge(res.before, res.after) : null
    return (
      <section className="dc-mode-panel" aria-label={`Experiment: ${exp.title}`}>
        <button
          className="text-btn"
          onClick={() => {
            setExp(null)
            setRes(null)
            setChoice(null)
          }}
        >
          ← All experiments
        </button>
        <h3>{exp.title}</h3>
        <p className="exp-q">
          <b>1 · Predict.</b> {exp.question(params)}
        </p>
        <div className="choice-list" role="radiogroup" aria-label="Your prediction">
          {exp.choices.map((c, i) => (
            <button
              key={c}
              role="radio"
              aria-checked={choice === i}
              disabled={!!res}
              className={`choice ${choice === i ? 'on' : ''} ${res && verdict === i ? 'choice--right' : ''} ${res && choice === i && verdict !== i ? 'choice--wrong' : ''}`}
              onClick={() => setChoice(i)}
            >
              {c}
            </button>
          ))}
        </div>
        {!res && (
          <button className="run-btn" disabled={choice === null} onClick={run}>
            2 · Run the experiment
          </button>
        )}
        {res && verdict !== null && (
          <>
            <p className={`exp-verdict ${verdict === choice ? 'tone-ok' : 'tone-bad'}`}>
              {verdict === choice ? '✓ Your prediction matches the simulation.' : `✗ The simulation shows: “${exp.choices[verdict]}”.`}
            </p>
            <p>
              <b>3 · Result.</b>
            </p>
            <BeforeAfter rows={exp.rows} before={res.before} after={res.after} labels={topic.measureLabels} />
            <p>
              <b>4 · Why.</b> {exp.why(res.before, res.after, res.p0, res.p1)}
            </p>
            <div className="why-actions">
              <button className="text-btn" onClick={() => onApply(exp.change(res.p0))}>
                Open the “after” circuit in Explore
              </button>
              <button
                className="text-btn"
                onClick={() => {
                  setRes(null)
                  setChoice(null)
                }}
              >
                Try again
              </button>
            </div>
          </>
        )}
      </section>
    )
  }
  return (
    <section className="dc-mode-panel" aria-label="Experiments">
      <h3>Guided experiments</h3>
      <p className="small muted">Each one starts from your present parameters: predict first, then the simulation answers.</p>
      <ul className="exp-list">
        {(topic.experiments as Array<Experiment<object, M>>).map((e) => (
          <li key={e.id}>
            <button className="exp-item" onClick={() => setExp(e)}>
              <b>{e.title}</b>
              <span className="small muted">{e.question(params)}</span>
            </button>
          </li>
        ))}
      </ul>
      <h3>Before / after</h3>
      <p className="small muted">Capture the present circuit, change any parameter, and compare.</p>
      <div className="why-actions">
        <button className="text-btn" onClick={() => setSnap({ m, p: params })}>
          {snap ? 'Re-capture “before”' : 'Capture “before”'}
        </button>
        {snap && (
          <button className="text-btn" onClick={() => setSnap(null)}>
            Clear
          </button>
        )}
      </div>
      {snap && (
        <>
          <ChangedParams topic={topic} a={snap.p} b={params} />
          <BeforeAfter rows={captureRows} before={snap.m} after={m} labels={topic.measureLabels} />
        </>
      )}
    </section>
  )
}

function ChangedParams({ topic, a, b }: { topic: AnyTopic; a: object; b: object }) {
  const A = a as Record<string, unknown>
  const B = b as Record<string, unknown>
  const specs = [...topic.basic, ...topic.advanced]
  const diff = specs.filter((s) => A[s.key] !== B[s.key])
  if (!diff.length) return <p className="small muted">No parameter changed yet.</p>
  const val = (s: (typeof specs)[number], v: unknown) =>
    s.kind === 'number' ? `${+((v as number) / (s.scale ?? 1)).toPrecision(4)} ${s.unit}` : (s.options.find((o) => o.value === v)?.label ?? String(v))
  return (
    <p className="small">
      Changed:{' '}
      {diff.map((s) => (
        <span key={s.key} className="mono">
          {s.label}: {val(s, A[s.key])} → {val(s, B[s.key])}{' '}
        </span>
      ))}
    </p>
  )
}

/** PREDICT: the simulation answers first; the theory is shown afterwards. */
export function PredictPanel({ topic, onShow }: { topic: AnyTopic; onShow: (patch: object) => void }) {
  const [seed, setSeed] = useState(1)
  const tasks = useMemo(() => topic.predictions(seed), [topic, seed])
  const [idx, setIdx] = useState(0)
  const [text, setText] = useState('')
  const [pick, setPick] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<null | { truth: number; ok: boolean; theory: string }>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const task = tasks[Math.min(idx, tasks.length - 1)]
  const reveal = () => {
    const p = { ...topic.defaults, ...task.params, view: 'steady' }
    const m = topic.measure(topic.simulate(p))
    const truth = task.answer(m)
    const ok = task.kind === 'number' ? Math.abs(parseFloat(text) - truth) <= (task.tolerance ?? 0.05) * Math.abs(truth) : pick === truth
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))
    setRevealed({ truth, ok, theory: task.theory(p) })
  }
  const next = () => {
    setRevealed(null)
    setText('')
    setPick(null)
    if (idx + 1 < tasks.length) setIdx(idx + 1)
    else {
      setSeed(seed + 1)
      setIdx(0)
    }
  }
  return (
    <section className="dc-mode-panel" aria-label="Predict">
      <div className="predict-head">
        <h3>
          Prediction {idx + 1} of {tasks.length}
        </h3>
        <span className="small muted">
          Score {score.right} / {score.total}
        </span>
      </div>
      <p className="exp-q">{task.prompt}</p>
      {task.kind === 'number' ? (
        <label className="predict-input">
          Your prediction
          <input value={text} disabled={!!revealed} inputMode="decimal" onChange={(e) => setText(e.target.value)} aria-label="Your prediction" />
          <span>{task.unit}</span>
        </label>
      ) : (
        <div className="choice-list" role="radiogroup" aria-label="Your prediction">
          {task.choices!.map((c, i) => (
            <button key={c} role="radio" aria-checked={pick === i} disabled={!!revealed} className={`choice ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {!revealed ? (
        <div className="why-actions">
          <button className="run-btn" disabled={task.kind === 'number' ? !Number.isFinite(parseFloat(text)) : pick === null} onClick={reveal}>
            Simulate and check
          </button>
          <span className="small muted">Hint: {task.hint}</span>
        </div>
      ) : (
        <>
          <p className={`exp-verdict ${revealed.ok ? 'tone-ok' : 'tone-bad'}`}>
            {revealed.ok ? '✓ Correct' : '✗ Not quite'} — SIMULATION: <b>{task.kind === 'number' ? formatSI(revealed.truth, task.unit ?? '') : task.choices![revealed.truth]}</b>
            {task.kind === 'number' && ` (accepted within ±${((task.tolerance ?? 0.05) * 100).toFixed(0)} %)`}
          </p>
          <p className="small">
            THEORY: <span className="mono">{revealed.theory}</span>
          </p>
          <div className="why-actions">
            <button className="text-btn" onClick={() => onShow(task.params)}>
              Open this circuit in Explore
            </button>
            <button className="run-btn" onClick={next}>
              Next prediction
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** LEARN: lesson list, or the present step (its text is generated from the simulation). */
export function LearnPanel(props: {
  topic: AnyTopic
  lesson: Lesson<object, never, never, never> | null
  step: number
  body: string | null
  onStart: (id: string) => void
  onStep: (k: number) => void
  onExit: () => void
}) {
  const { topic, lesson, step } = props
  if (!lesson)
    return (
      <section className="dc-mode-panel" aria-label="Lessons">
        <h3>Lessons</h3>
        <ul className="exp-list">
          {topic.lessons.map((l) => (
            <li key={l.id}>
              <button className="exp-item" onClick={() => props.onStart(l.id)}>
                <b>{l.title}</b>
                <span className="small muted">
                  {l.summary} · {l.steps.length} steps
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  const s = lesson.steps[step]
  return (
    <section className="dc-mode-panel" aria-label={`Lesson: ${lesson.title}`}>
      <div className="predict-head">
        <button className="text-btn" onClick={props.onExit}>
          ← Lessons
        </button>
        <span className="small muted">
          Step {step + 1} of {lesson.steps.length}
        </span>
      </div>
      <h3>{s.title}</h3>
      <p className="lesson-text">{props.body}</p>
      <p className="small">
        <b>Look:</b> {s.look}
      </p>
      <div className="lesson-dots" aria-hidden="true">
        {lesson.steps.map((_, k) => (
          <span key={k} className={k === step ? 'on' : k < step ? 'done' : ''} />
        ))}
      </div>
      <div className="why-actions">
        <button className="text-btn" disabled={step === 0} onClick={() => props.onStep(step - 1)}>
          ← Back
        </button>
        {step + 1 < lesson.steps.length ? (
          <button className="run-btn" onClick={() => props.onStep(step + 1)}>
            Next →
          </button>
        ) : (
          <button className="run-btn" onClick={props.onExit}>
            Finish
          </button>
        )}
      </div>
    </section>
  )
}
