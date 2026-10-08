import { useState } from 'react'
import type { Density, InspectInfo, StateView, WhyCard } from '../../lab/types.ts'

const LEVEL: Record<Density, number> = { beginner: 0, standard: 1, engineer: 2 }

/** Master cursor readout: the complete circuit state at one instant, read from the simulation. */
export function StateCard({ view, density, foot }: { view: StateView; density: Density; foot?: string }) {
  const rows = view.rows.filter((r) => LEVEL[r.min ?? 'beginner'] <= LEVEL[density])
  return (
    <section className="dc-state" aria-label="Circuit state at the cursor">
      <div className={`dc-interval dc-interval--${view.badge.tone}`}>
        <span className="dc-interval-dot" aria-hidden="true" />
        {view.badge.text}
      </div>
      <dl className="dc-kv">
        {rows.map((r) => (
          <div key={r.k} className={r.full ? 'dc-kv-full' : undefined}>
            <dt className="no-case">{r.k}</dt>
            <dd className={r.tone ? `tone-${r.tone}` : ''}>{r.v}</dd>
          </div>
        ))}
      </dl>
      {view.path && (
        <p className="dc-path">
          <b>Current path</b> {view.path}
        </p>
      )}
      {foot && <p className="muted small">{foot}</p>}
    </section>
  )
}

/** WHY: What → Why → Equation → Physics → What-if, one card per question. */
export function WhyPanel({ cards, detailed }: { cards: WhyCard[]; detailed: boolean }) {
  const [open, setOpen] = useState<string>(cards[0]?.id ?? '')
  const current = cards.find((c) => c.id === open) ?? cards[0]
  if (!current) return null
  return (
    <section className="dc-why" aria-label="Why">
      <div className="dc-why-qs" role="tablist" aria-label="Questions">
        {cards.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === current.id} className={`why-q ${c.id === current.id ? 'on' : ''}`} onClick={() => setOpen(c.id)}>
            {c.question}
          </button>
        ))}
      </div>
      <ol className="why-steps">
        <li>
          <h3>What</h3>
          <p>{current.what}</p>
        </li>
        <li>
          <h3>Why</h3>
          <p>{current.why}</p>
        </li>
        <li>
          <h3>Equation</h3>
          <p className="chain-eq">{current.equation}</p>
        </li>
        {detailed && (
          <>
            <li>
              <h3>Physics</h3>
              <p>{current.physics}</p>
            </li>
            <li>
              <h3>What if…</h3>
              <p>{current.whatIf}</p>
            </li>
          </>
        )}
      </ol>
      <p className="muted small">Generated from the simulated state at the cursor — move the cursor and the answer changes with the circuit.</p>
    </section>
  )
}

export function Inspector({ info }: { info: InspectInfo }) {
  return (
    <section className="dc-inspect" aria-label={`Inspector: ${info.title}`}>
      <h3>{info.title}</h3>
      <p className="small">{info.role}</p>
      <dl className="dc-kv dc-kv--wide">
        {info.rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">“Now” values at the cursor; averages, RMS and peaks over the measurement window. All SIMULATION.</p>
    </section>
  )
}
