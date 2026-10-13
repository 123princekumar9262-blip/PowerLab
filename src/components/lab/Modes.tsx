import { useEffect, useMemo, useState } from 'react'
import type { AnyTopic, Experiment, Lesson, LessonCheck, MeasureLabel } from '../../lab/types.ts'
import { formatSI } from '../../utils/format.ts'

type M = Record<string, unknown>

const show = (labels: Record<string, MeasureLabel>, k: string, v: unknown) => (typeof v === 'number' ? (labels[k]?.fmt(v) ?? v.toPrecision(4)) : String(v))

/**
 * Where the student is in a mode: one segment per step (done, current, to come). The same bar in every
 * mode — a lesson's steps, a prediction round's questions, an experiment's four phases.
 */
export function StepBar({ at, of, label }: { at: number; of: number; label: string }) {
  return (
    <div className="step-bar" role="progressbar" aria-valuemin={1} aria-valuemax={of} aria-valuenow={at + 1} aria-label={label}>
      {Array.from({ length: of }, (_, k) => (
        <span key={k} className={k < at ? 'done' : k === at ? 'on' : ''} />
      ))}
    </div>
  )
}

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
  // An experiment starts from the lab's standard values: its question, its "before" and its judgement are all
  // about that circuit (from the student's own settings a fixed judgement could call the wrong answer right).
  const base = { ...(topic.defaults as object), view: 'steady' }
  const changed = Object.keys(base).some((k) => k !== 'view' && (params as Record<string, unknown>)[k] !== (base as Record<string, unknown>)[k])
  const run = () => {
    if (!exp) return
    const p0 = base
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
        <StepBar at={res ? 3 : choice === null ? 0 : 1} of={4} label="Experiment: predict, run, result, why" />
        <h3>{exp.title}</h3>
        {changed && <p className="small muted">This experiment starts from the lab’s standard values, not the ones you set in Explore.</p>}
        <p className="exp-q">
          <b>1 · Predict.</b> {exp.question(base)}
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
              <button className="text-btn" onClick={() => onApply(res.p1)}>
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
      <p className="small muted">Each one starts from the lab’s standard values: predict first, then the simulation answers.</p>
      <ul className="exp-list">
        {(topic.experiments as Array<Experiment<object, M>>).map((e) => (
          <li key={e.id}>
            <button className="exp-item" onClick={() => setExp(e)}>
              <b>{e.title}</b>
              <span className="small muted">{e.question(base)}</span>
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
export function PredictPanel({ topic, onShow, onCovered }: { topic: AnyTopic; onShow: (patch: object) => void; onCovered?: (covered: boolean) => void }) {
  const [seed, setSeed] = useState(1)
  const tasks = useMemo(() => topic.predictions(seed), [topic, seed])
  const [idx, setIdx] = useState(0)
  const [text, setText] = useState('')
  const [pick, setPick] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<null | { truth: number; ok: boolean; theory: string }>(null)
  // the workspace covers its answers (waveforms, values, WHY) until this prediction is checked
  useEffect(() => onCovered?.(!revealed), [revealed]) // eslint-disable-line react-hooks/exhaustive-deps
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
      <StepBar at={idx} of={tasks.length} label={`Prediction ${idx + 1} of ${tasks.length}`} />
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

/** The lesson's check: one question about what it showed — answered once, then the right option and why. */
function LessonCheckView({ check }: { check: LessonCheck }) {
  const [pick, setPick] = useState<number | null>(null)
  const done = pick !== null
  return (
    <section className="lesson-check" aria-label="Check your understanding">
      <p className="lesson-check-q">
        <b>Check:</b> {check.question}
      </p>
      <div className="choice-list" role="radiogroup" aria-label="Your answer">
        {check.options.map((o, i) => (
          <button
            key={o}
            role="radio"
            aria-checked={pick === i}
            disabled={done}
            className={`choice ${pick === i ? 'on' : ''} ${done && i === check.answer ? 'choice--right' : ''} ${done && pick === i && i !== check.answer ? 'choice--wrong' : ''}`}
            onClick={() => setPick(i)}
          >
            {o}
          </button>
        ))}
      </div>
      {done && (
        <p className={`exp-verdict ${pick === check.answer ? 'tone-ok' : 'tone-bad'}`}>
          {pick === check.answer ? '✓ Right.' : `✗ Not quite — the answer is “${check.options[check.answer]}”.`} {check.explain}
        </p>
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
      <StepBar at={step} of={lesson.steps.length} label={`Step ${step + 1} of ${lesson.steps.length}`} />
      <h3>{s.title}</h3>
      <p className="lesson-text">{props.body}</p>
      <p className="small">
        <b>Look:</b> {s.look}
      </p>
      {step + 1 === lesson.steps.length && lesson.check && <LessonCheckView key={lesson.id} check={lesson.check} />}
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
