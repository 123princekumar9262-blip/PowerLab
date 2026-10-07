import { useState } from 'react'
import { formatQuantity } from '../../experiment/experiment.ts'
import { evaluateWhatIf, WHAT_IFS, type Outcome, type WhatIf, type WhatIfResult } from '../../prediction/whatIf.ts'
import type { Section } from '../../state/labState.ts'

interface Props {
  section: Section
  onShowInLab: (q: WhatIf) => void
}

const OPTIONS: Array<{ id: Outcome; label: string }> = [
  { id: 'increases', label: 'It increases' },
  { id: 'decreases', label: 'It decreases' },
  { id: 'unchanged', label: 'It stays the same' },
]

/** Phase G — predict first, then the simulation decides. */
export function WhatIfPanel({ section, onShowInLab }: Props) {
  const list = WHAT_IFS.filter((q) => q.section === section)
  const [k, setK] = useState(0)
  const [guess, setGuess] = useState<Outcome | null>(null)
  const [res, setRes] = useState<WhatIfResult | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const q = list[k % list.length]

  const run = () => {
    const r = evaluateWhatIf(q) // runs BOTH simulations now
    setRes(r)
    setScore((s) => ({ right: s.right + (r.actual === guess ? 1 : 0), total: s.total + 1 }))
  }
  const next = () => {
    setK((x) => x + 1)
    setGuess(null)
    setRes(null)
  }

  return (
    <section className="mode-panel" aria-labelledby="wi-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">
            Predict · question {(k % list.length) + 1} of {list.length}
          </p>
          <h2 id="wi-title">What if…?</h2>
        </div>
        <span className="muted small">
          score {score.right}/{score.total}
        </span>
      </header>
      <p className="lesson-body">{q.question}</p>
      <div className="quiz" role="group" aria-label="Your prediction">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            className={`quiz-opt ${guess === o.id ? 'is-picked' : ''} ${res ? (o.id === res.actual ? 'is-right' : guess === o.id ? 'is-wrong' : '') : ''}`}
            disabled={!!res}
            onClick={() => setGuess(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {!res ? (
        <div className="mode-actions">
          <span />
          <button className="primary-btn" disabled={!guess} onClick={run}>
            Run the simulation
          </button>
        </div>
      ) : (
        <>
          <div className="wi-grid">
            <div>
              <p className="event-q">Your prediction</p>
              <p className="lesson-body">{OPTIONS.find((o) => o.id === guess)?.label}</p>
            </div>
            <div>
              <p className="event-q">Actual result (simulated)</p>
              <p className="lesson-body">
                {q.quantityLabel}: <b>{formatQuantity(res.before, q.unit)}</b> → <b>{formatQuantity(res.after, q.unit)}</b> — {OPTIONS.find((o) => o.id === res.actual)?.label.toLowerCase()}.
              </p>
            </div>
          </div>
          <p className={`quiz-feedback ${guess === res.actual ? 'ok' : 'no'}`}>{guess === res.actual ? '✓ Your prediction was right.' : '✕ The simulation disagrees with your prediction.'}</p>
          <p className="event-q">Why?</p>
          <p className="lesson-body">{q.why}</p>
          <div className="mode-actions">
            <button className="text-btn" onClick={() => onShowInLab(q)}>
              See it in the lab
            </button>
            <button className="primary-btn" onClick={next}>
              Next question →
            </button>
          </div>
        </>
      )}
    </section>
  )
}
