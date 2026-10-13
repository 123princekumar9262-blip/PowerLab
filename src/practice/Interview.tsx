import { useState } from 'react'
import { href } from '../shell/router.ts'
import { Crumbs, PageHead } from '../shell/ui.tsx'
import { loadProgress, markSolved } from './common.ts'
import { isRight, QUESTIONS, type Outcome, type Question } from './interview.ts'
import '../styles/practice.css'

const ID = 'interview'

interface Answered {
  given: number
  outcome: Outcome
  right: boolean
}

/** Interview: answer first, then the lab's own simulation runs at the question's settings and decides. */
export default function Interview() {
  const [k, setK] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answered>>({})
  const [progress, setProgress] = useState(() => loadProgress(ID, QUESTIONS.length))
  const q = QUESTIONS[k]
  const session = Object.values(answers).filter((a) => a.right).length
  return (
    <div className="page px-page">
      <Crumbs items={[{ label: 'Practice', href: href.engineering() }, { label: 'Interview' }]} />
      <PageHead
        title="Interview"
        lead="Classic power-electronics interview questions. Answer first — then the matching lab simulates the circuit at the question's settings, and its result decides. Every answer comes with the why and a link to the circuit."
        side={
          <span className="px-score" aria-label={`${session} right of ${Object.keys(answers).length} answered`}>
            {session} <span>/ {QUESTIONS.length}</span>
          </span>
        }
      />
      <div className="px-roundbar">
        <ol className="px-qnav" aria-label="Questions">
          {QUESTIONS.map((x, i) => {
            const a = answers[x.id]
            const state = a ? (a.right ? 'ok' : 'bad') : i === k ? 'now' : 'todo'
            return (
              <li key={x.id}>
                <button type="button" className={`px-step px-step--${state}`} aria-current={i === k ? 'step' : undefined} onClick={() => setK(i)} title={x.prompt}>
                  <span className="px-step-n">{i + 1}</span>
                  <span className="px-step-label">{i === k ? x.lab : ''}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <p className="px-roundmeta">
          Answered right at least once: {progress.solved.length} of {progress.total}
        </p>
      </div>
      <QuestionCard
        key={q.id}
        q={q}
        n={k}
        done={answers[q.id] ?? null}
        onAnswer={(a) => {
          setAnswers({ ...answers, [q.id]: a })
          if (a.right) setProgress(markSolved(ID, QUESTIONS.length, q.id))
        }}
        onNext={k < QUESTIONS.length - 1 ? () => setK(k + 1) : null}
      />
    </div>
  )
}

function QuestionCard({ q, n, done, onAnswer, onNext }: { q: Question; n: number; done: Answered | null; onAnswer: (a: Answered) => void; onNext: (() => void) | null }) {
  const [choice, setChoice] = useState<number | null>(done && q.kind === 'choice' ? done.given : null)
  const [text, setText] = useState(done && q.kind === 'number' ? String(done.given) : '')
  const [busy, setBusy] = useState(false)
  const given = q.kind === 'choice' ? choice : text.trim() === '' ? null : Number(text)
  const ready = given !== null && Number.isFinite(given)
  const submit = () => {
    if (!ready || done || busy) return
    setBusy(true)
    window.setTimeout(() => {
      const outcome = q.simulate()
      onAnswer({ given: given!, outcome, right: isRight(q, outcome, given!) })
      setBusy(false)
    }, 30)
  }
  return (
    <section className="px-card px-qcard" aria-labelledby="px-q-h">
      <p className="eyebrow">
        Question {n + 1} of {QUESTIONS.length} · {q.lab}
      </p>
      <p id="px-q-h" className="px-qprompt">
        {q.prompt}
      </p>
      <p className="px-qsettings">Simulated at: {q.settings}</p>
      {q.kind === 'choice' ? (
        <div className="px-choices" role="radiogroup" aria-label="Your answer">
          {q.choices!.map((c, i) => {
            const cls = done ? (i === done.outcome.answer ? 'is-right' : i === done.given ? 'is-wrong' : '') : choice === i ? 'is-on' : ''
            return (
              <button key={c} type="button" role="radio" aria-checked={choice === i} className={`px-choice ${cls}`} disabled={!!done || busy} onClick={() => setChoice(i)}>
                {c}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="px-numrow">
          <label className="px-quiet" htmlFor="px-num">
            Your answer
          </label>
          <span className="px-input">
            <input id="px-num" type="number" inputMode="decimal" value={text} disabled={!!done || busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <span className="px-input-unit">{q.unit}</span>
          </span>
          <span className="px-quiet">within ±{((q.tolerance ?? 0.03) * 100).toFixed(0)} % of the simulation counts</span>
        </div>
      )}
      {!done ? (
        <div className="px-actions">
          <button type="button" className="btn btn--primary" disabled={!ready || busy} onClick={submit}>
            {busy ? 'Simulating…' : 'Answer, then simulate'}
          </button>
          <span className="px-quiet">The simulation runs only after you commit to an answer.</span>
        </div>
      ) : (
        <div className="px-result" aria-live="polite">
          <div>
            <div className={`px-verdict px-verdict--${done.right ? 'pass' : 'fail'}`} style={{ marginTop: 0 }}>
              <p className="px-verdict-head">
                <span className="px-verdict-tag">{done.right ? 'Right' : 'Not quite'}</span>
              </p>
              <p>
                You answered <b>{q.kind === 'choice' ? q.choices![done.given] : `${done.given} ${q.unit}`}</b>
                {!done.right && q.kind === 'choice' && (
                  <>
                    ; the simulation says <b>{q.choices![done.outcome.answer]}</b>
                  </>
                )}
                .
              </p>
            </div>
            <p className="px-subhead">Simulation result</p>
            <p className="px-big">{done.outcome.value}</p>
            <dl className="px-mini">
              {done.outcome.rows.map(([a, b]) => (
                <div key={a}>
                  <dt>{a}</dt>
                  <dd>{b}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <p className="px-subhead" style={{ marginTop: 0 }}>
              Why
            </p>
            <p className="px-explain">{done.outcome.explain}</p>
            <div className="px-actions">
              {onNext && (
                <button type="button" className="btn btn--primary" onClick={onNext}>
                  Next question →
                </button>
              )}
              <a className="btn" href={href.workspace(q.link.lab, q.link.topic, q.link.mode ?? 'explore', q.link.query)}>
                Open this circuit
              </a>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
