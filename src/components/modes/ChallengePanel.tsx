import { CHALLENGES, type Challenge, type ChallengeResult } from '../../challenges/challenges.ts'

interface Props {
  section: 'single' | 'three'
  challenge: Challenge | null
  result: ChallengeResult | null
  best: Record<string, number>
  onStart: (c: Challenge) => void
  onExit: () => void
  onSubmit: (id: string, stars: number) => void
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n)

/** Phase 10 — design challenges, checked live against the simulation. */
export function ChallengePanel({ section, challenge, result, best, onStart, onExit, onSubmit }: Props) {
  if (!challenge) {
    return (
      <section className="mode-panel" aria-labelledby="ch-title">
        <h2 id="ch-title" className="eyebrow">Challenge · design tasks</h2>
        <p className="muted small">Each task fixes a circuit and unlocks a few parameters. The simulation checks your design: one star for the goal, one for each bonus.</p>
        <ol className="lesson-list">
          {CHALLENGES.filter((c) => (c.section ?? 'single') === section).map((c) => (
            <li key={c.id}>
              <button className="lesson-card" onClick={() => onStart(c)}>
                <span className="lesson-n lesson-n--stars" aria-label={`${best[c.id] ?? 0} of 3 stars`}>
                  {stars(best[c.id] ?? 0)}
                </span>
                <span>
                  <span className="lesson-title">{c.title}</span>
                  <span className="lesson-sum">{c.story}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  const earned = result?.stars ?? 0
  return (
    <section className="mode-panel" aria-labelledby="ch-active">
      <header className="mode-head">
        <div>
          <p className="eyebrow">Challenge</p>
          <h2 id="ch-active">{challenge.title}</h2>
        </div>
        <button className="text-btn" onClick={onExit}>
          All challenges
        </button>
      </header>
      <p className="lesson-body">{challenge.story}</p>
      <p className="muted small">
        Unlocked: <b>{challenge.editable.join(', ')}</b> — everything else is fixed. Adjust them in the Parameters panel.
      </p>
      {result && !result.steady && <p className="flag flag--info">⏳ Waiting for steady state — checks apply to the settled waveform.</p>}
      <ul className="criteria">
        {result?.criteria.map((c) => (
          <li key={c.label} className={c.pass ? 'pass' : 'fail'}>
            <span className="crit-mark" aria-hidden="true">{c.pass ? '✓' : '○'}</span>
            <span className="crit-label">
              {c.kind === 'bonus' && <span className="approx-tag">bonus</span>} {c.label}
            </span>
            <span className="crit-value">{c.value}</span>
          </li>
        ))}
      </ul>
      <p className="stars" aria-label={`${earned} of 3 stars`}>
        {stars(earned)} <span className="muted small">best {stars(best[challenge.id] ?? 0)}</span>
      </p>
      <details className="hint">
        <summary>Hint</summary>
        <p>{challenge.hint}</p>
      </details>
      <div className="mode-actions">
        <button className="primary-btn" disabled={!result?.steady || earned === 0} onClick={() => onSubmit(challenge.id, earned)}>
          Submit design ({earned}★)
        </button>
      </div>
    </section>
  )
}
