import { useEffect, useMemo, useState } from 'react'
import { noteSolved, solvedChecks } from '../progress.ts'
import type { MachinePart, QuizItem } from '../types.ts'

/** A fixed shuffle (the same each time for a question): the order question never starts solved. */
function shuffled<T>(xs: T[], seed: string): T[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const j = Math.abs(h) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (out.every((x, i) => x === xs[i]) && out.length > 1) out.push(out.shift()!)
  return out
}

/**
 * Knowledge checks: identify (the part is highlighted on the model, not named), predict, match, order. The answer
 * and its explanation appear only after the student commits.
 */
export function QuizPanel({ machine, items, parts, onShowPart }: { machine: string; items: QuizItem[]; parts: MachinePart[]; onShowPart(id: string | null): void }) {
  const [k, setK] = useState(0)
  const [solved, setSolved] = useState(() => new Set(solvedChecks(machine)))
  const q = items[k]
  useEffect(() => {
    onShowPart(q?.kind === 'identify' ? (q.part ?? null) : null)
    return () => onShowPart(null)
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return <p className="muted">No questions for this model yet.</p>
  return (
    <section className="mx-quiz">
      <div className="mx-quiz-head">
        <span className="small muted">
          Question {k + 1} of {items.length} · {solved.size} answered right
        </span>
        <span className="step-bar mx-quiz-bar" aria-hidden="true">
          {items.map((x, i) => (
            <span key={x.id} className={solved.has(x.id) ? 'done' : i === k ? 'on' : ''} />
          ))}
        </span>
      </div>
      <Question
        key={q.id}
        q={q}
        partLabel={parts.find((p) => p.id === q.part)?.label}
        onRight={() => {
          noteSolved(machine, q.id)
          setSolved(new Set([...solved, q.id]))
        }}
      />
      <div className="mx-step-controls">
        <button className="btn" disabled={k === 0} onClick={() => setK(k - 1)}>
          ← Previous
        </button>
        <button className="btn btn--primary" disabled={k === items.length - 1} onClick={() => setK(k + 1)}>
          Next question →
        </button>
      </div>
    </section>
  )
}

function Question({ q, partLabel, onRight }: { q: QuizItem; partLabel?: string; onRight(): void }) {
  const [pick, setPick] = useState<number | null>(null)
  const order = useMemo(() => (q.kind === 'order' ? shuffled(q.options, q.id) : []), [q])
  const [arranged, setArranged] = useState<string[]>(order)
  const [checked, setChecked] = useState(false)
  const done = q.kind === 'order' ? checked : pick !== null
  const right = q.kind === 'order' ? arranged.every((x, i) => x === q.options[i]) : pick === q.answer
  useEffect(() => {
    if (done && right) onRight()
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= arranged.length) return
    const next = [...arranged]
    ;[next[i], next[j]] = [next[j], next[i]]
    setArranged(next)
  }
  return (
    <div className="mx-q">
      <p className="mx-q-prompt">
        {q.prompt}
        {q.kind === 'identify' && <span className="small muted"> (highlighted on the model)</span>}
      </p>
      {q.kind === 'order' ? (
        <ol className="mx-order">
          {arranged.map((x, i) => (
            <li key={x} className={checked ? (x === q.options[i] ? 'ok' : 'bad') : ''}>
              <span>{x}</span>
              {!checked && (
                <span className="mx-order-btns">
                  <button className="mx-tool" aria-label={`Move “${x}” up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="mx-tool" aria-label={`Move “${x}” down`} disabled={i === arranged.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="choice-list" role="radiogroup" aria-label="Your answer">
          {q.options.map((o, i) => (
            <button
              key={o}
              role="radio"
              aria-checked={pick === i}
              disabled={done}
              className={`choice ${pick === i ? 'on' : ''} ${done && i === q.answer ? 'choice--right' : ''} ${done && pick === i && i !== q.answer ? 'choice--wrong' : ''}`}
              onClick={() => setPick(i)}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      {q.kind === 'order' && !checked && (
        <button className="btn btn--primary" onClick={() => setChecked(true)}>
          Check the order
        </button>
      )}
      {done && (
        <p className={`exp-verdict ${right ? 'tone-ok' : 'tone-bad'}`}>
          {right ? '✓ Right. ' : q.kind === 'order' ? '✗ Not quite — the correct order is shown by the numbers above. ' : `✗ Not quite — the answer is “${q.options[q.answer]}”. `}
          {q.explain}
          {!right && pick !== null && q.misconceptions?.[pick] && <span className="mx-mis"> {q.misconceptions[pick]}</span>}
          {q.kind === 'identify' && partLabel && !right && <span> (It is the {partLabel.toLowerCase()}.)</span>}
        </p>
      )}
      {q.kind === 'order' && checked && !right && (
        <ol className="mx-order mx-order--answer">
          {q.options.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
