import type { Inspection } from '../../inspect/inspect.ts'

/** Inspect mode — one component's state and history, from the simulation. */
export function InspectPanel({ info }: { info: Inspection | null }) {
  if (!info) return <p className="lesson-body">Click a component on the circuit: a diode or SCR, R, L, C, or a source.</p>
  return (
    <div className="inspect-panel">
      <dl className="inspect-rows">
        {info.rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {info.why && <p className="lesson-body inspect-why">{info.why}</p>}
      <p className="muted small">Move the cursor — these values follow it. Click another component to inspect it.</p>
    </div>
  )
}
