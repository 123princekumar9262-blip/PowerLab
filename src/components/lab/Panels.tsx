import type { Density, StateView } from '../../lab/types.ts'

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
