import { useMemo } from 'react'
import { pathView } from '../../explanations/concise.ts'
import type { StateExplanation } from '../../explanations/index.ts'
import type { SimulationResult } from '../../types/simulation.ts'
import { formatA, formatDeg } from '../../utils/format.ts'

/** CURRENT PATH — the loop the current takes at the cursor, and why it takes it. */
export function PathPanel({ result, ex }: { result: SimulationResult; ex: StateExplanation }) {
  const v = useMemo(() => pathView(result, ex), [result, ex])
  return (
    <div className="path-panel">
      <p className="muted small">
        θ = {formatDeg(ex.angleDeg)} · io = {formatA(ex.sample.io)} · the path is highlighted on the circuit.
      </p>
      {v.nodes ? (
        <ol className="path-vertical" aria-label="Current path">
          {v.nodes.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ol>
      ) : (
        <p className="lesson-body">No closed path — no current flows at this instant.</p>
      )}
      <h3 className="event-q">Why this path?</h3>
      <ul className="path-reasons">
        {v.reasons.map((r, k) => (
          <li key={k}>{r}</li>
        ))}
      </ul>
    </div>
  )
}
