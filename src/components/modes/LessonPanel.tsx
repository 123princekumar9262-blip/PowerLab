import { useState } from 'react'
import { fill } from '../../learning/facts.ts'
import { LESSONS, type Lesson } from '../../learning/lessons.ts'

interface Props {
  lesson: Lesson | null
  step: number
  facts: Record<string, string>
  completed: string[]
  onStart: (l: Lesson) => void
  onStep: (k: number) => void
  onExit: () => void
  onComplete: (id: string) => void
}

/** Phase 8 — guided lessons: a list, then one step at a time, narrated from the simulation. */
export function LessonPanel({ lesson, step, facts, completed, onStart, onStep, onExit, onComplete }: Props) {
  const [answer, setAnswer] = useState<number | null>(null)

  if (!lesson) {
    return (
      <section className="mode-panel" aria-labelledby="learn-title">
        <h2 id="learn-title" className="eyebrow">Learn · guided lessons</h2>
        <p className="muted small">Each lesson sets up a circuit and walks you through it one instant at a time. Every number quoted comes from the simulation.</p>
        <ol className="lesson-list">
          {LESSONS.map((l, k) => (
            <li key={l.id}>
              <button className="lesson-card" onClick={() => onStart(l)}>
                <span className="lesson-n">{completed.includes(l.id) ? '✓' : k + 1}</span>
                <span>
                  <span className="lesson-title">{l.title}</span>
                  <span className="lesson-sum">{l.summary}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  const s = lesson.steps[step]
  const last = step === lesson.steps.length - 1
  const go = (k: number) => {
    setAnswer(null)
    onStep(k)
  }
  return (
    <section className="mode-panel" aria-labelledby="lesson-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">
            Lesson · step {step + 1} of {lesson.steps.length}
          </p>
          <h2 id="lesson-title">{lesson.title}</h2>
        </div>
        <button className="text-btn" onClick={onExit}>
          All lessons
        </button>
      </header>
      <div className="lesson-progress" aria-hidden="true">
        {lesson.steps.map((_, k) => (
          <span key={k} className={k < step ? 'done' : k === step ? 'current' : ''} />
        ))}
      </div>
      <h3 className="lesson-step-title">{s.title}</h3>
      <p className="lesson-body">{fill(s.body, facts)}</p>

      {s.quiz && (
        <div className="quiz" role="group" aria-label="Check yourself">
          <p className="quiz-q">{s.quiz.question}</p>
          {s.quiz.options.map((o, k) => (
            <button
              key={o}
              className={`quiz-opt ${answer === null ? '' : k === s.quiz!.answer ? 'is-right' : k === answer ? 'is-wrong' : ''}`}
              disabled={answer !== null}
              onClick={() => setAnswer(k)}
            >
              {o}
            </button>
          ))}
          {answer !== null && (
            <p className={`quiz-feedback ${answer === s.quiz.answer ? 'ok' : 'no'}`}>
              {answer === s.quiz.answer ? '✓ Right. ' : '✕ Not quite. '}
              {s.quiz.explain}
            </p>
          )}
        </div>
      )}

      <div className="mode-actions">
        <button className="text-btn" disabled={step === 0} onClick={() => go(step - 1)}>
          ← Back
        </button>
        {last ? (
          <button
            className="primary-btn"
            onClick={() => {
              onComplete(lesson.id)
              onExit()
            }}
          >
            Finish lesson ✓
          </button>
        ) : (
          <button className="primary-btn" onClick={() => go(step + 1)}>
            Next →
          </button>
        )}
      </div>
      <p className="muted small">The cursor has been placed for you — drag it anywhere to explore, the explanation follows.</p>
    </section>
  )
}
