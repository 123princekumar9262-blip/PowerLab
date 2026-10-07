import type { LensStage } from '../explanations/lens.ts'

interface Props {
  stages: LensStage[]
  stage: number
  onStage: (k: number) => void
  onClose: () => void
}

/** Physics Lens — one stage of the cause → effect chain at a time: what, why, equation. */
export function PhysicsLens({ stages, stage, onStage, onClose }: Props) {
  const s = stages[Math.min(stage, stages.length - 1)]
  return (
    <section className="mode-panel lens-panel" aria-labelledby="lens-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">Physics Lens · stage {stage + 1} of {stages.length}</p>
          <h2 id="lens-title">{s.title}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close Physics Lens">
          ✕
        </button>
      </header>
      <ol className="lens-steps" aria-label="Stages">
        {stages.map((x, k) => (
          <li key={x.key}>
            <button className={k === stage ? 'on' : k < stage ? 'done' : ''} onClick={() => onStage(k)} aria-current={k === stage}>
              {x.title}
            </button>
          </li>
        ))}
      </ol>
      <p className="event-q">What happened?</p>
      <p className="lesson-body">{s.what}</p>
      <p className="event-q">Why?</p>
      <p className="lesson-body">{s.why}</p>
      <p className="event-q">Equation</p>
      <p className="chain-eq">{s.equation}</p>
      <div className="mode-actions">
        <button className="text-btn" disabled={stage === 0} onClick={() => onStage(stage - 1)}>
          ← Back
        </button>
        <button className="primary-btn" disabled={stage === stages.length - 1} onClick={() => onStage(stage + 1)}>
          Next stage →
        </button>
      </div>
      <p className="muted small">The schematic highlights the part of the circuit this stage is about. Move the cursor — every stage updates to the new instant.</p>
    </section>
  )
}
