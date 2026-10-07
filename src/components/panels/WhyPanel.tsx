import { useMemo, type ReactNode } from 'react'
import { conciseWhy } from '../../explanations/concise.ts'
import type { StateExplanation } from '../../explanations/index.ts'
import type { SimulationResult } from '../../types/simulation.ts'

interface Props {
  result: SimulationResult
  ex: StateExplanation
  detailed: boolean
  onToggleDetailed: () => void
  onLens: () => void
  /** The Physics Lens, when it is open (it replaces the short answer). */
  lens: ReactNode
}

/**
 * WHY IS THIS HAPPENING? — five short steps (source → decision → path → output → load) with
 * the simulated values; the full causal chain only on request.
 */
export function WhyPanel({ result, ex, detailed, onToggleDetailed, onLens, lens }: Props) {
  const steps = useMemo(() => conciseWhy(result, ex), [result, ex])
  if (lens) return <>{lens}</>
  const fi = ex.freewheel
  return (
    <section className="why-panel" aria-labelledby="why-title">
      <h2 id="why-title" className="eyebrow">Why is this happening?</h2>
      <ol className="why-steps">
        {steps.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            {s.lines.map((l, k) => (
              <p key={k}>{l}</p>
            ))}
          </li>
        ))}
      </ol>
      <div className="why-actions">
        <button className="text-btn" aria-expanded={detailed} aria-controls="why-chain" onClick={onToggleDetailed}>
          {detailed ? 'Hide detailed explanation' : 'Show detailed explanation'}
        </button>
        <button className="lens-btn" onClick={onLens} title="Physics Lens: walk through the physics one stage at a time">
          🔍 Physics Lens
        </button>
      </div>
      {detailed && (
        <div id="why-chain">
          {fi && (
            <>
              <h3 className="why-sub">{fi.whyTitle}</h3>
              <ol className="fw-why" id="fw-why">
                {fi.why.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ol>
            </>
          )}
          <ol className="chain">
            {ex.chain.map((step) => (
              <li key={step.stage} className={`chain-step chain-step--${step.stage}`}>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                {step.equation && <p className="chain-eq">{step.equation}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
