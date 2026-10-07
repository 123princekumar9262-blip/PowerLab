import { useEffect, useMemo, useState } from 'react'
import { conductionSteps } from '../explanations/freewheel.ts'
import type { SimulationResult } from '../types/simulation.ts'

interface Props {
  result: SimulationResult
  cursorTime: number
  playing: boolean
  onCursor: (t: number) => void
  onPlay: () => void
  onPause: () => void
  onClose: () => void
}

/**
 * "Step through conduction": the important instants of one steady cycle, found from the
 * simulation's events. Next/Back jump the master cursor; Auto plays and pauses at each step,
 * so the circuit, waveforms, diode states, current path and WHY all show that instant.
 */
export function StepThrough({ result, cursorTime, playing, onCursor, onPlay, onPause, onClose }: Props) {
  const steps = useMemo(() => conductionSteps(result), [result])
  const [k, setK] = useState(0)
  const [auto, setAuto] = useState(false)
  const s = steps[Math.min(k, steps.length - 1)]

  // Auto mode: while playing, stop exactly at the next step's instant.
  useEffect(() => {
    if (!auto || !playing) return
    const next = steps[k + 1]
    if (!next) {
      setAuto(false)
      return
    }
    if (cursorTime >= next.time) {
      onPause()
      onCursor(next.time)
      setK(k + 1)
    }
  }, [auto, playing, cursorTime, k, steps, onPause, onCursor])

  const go = (j: number) => {
    setAuto(false)
    onPause()
    setK(j)
    onCursor(steps[j].time)
  }
  if (!s) return null
  const last = k >= steps.length - 1

  return (
    <section className="mode-panel step-panel" aria-labelledby="step-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">
            Step through conduction · step {s.n} of {steps.length}
          </p>
          <h2 id="step-title">{s.title}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close step-through">
          ✕
        </button>
      </header>
      <ol className="lens-steps" aria-label="Steps">
        {steps.map((x, j) => (
          <li key={x.n}>
            <button className={j === k ? 'on' : j < k ? 'done' : ''} onClick={() => go(j)} aria-current={j === k} title={x.title}>
              {x.n}
            </button>
          </li>
        ))}
      </ol>
      <p className="lesson-body">{s.text}</p>
      <div className="mode-actions">
        <button className="text-btn" disabled={k === 0} onClick={() => go(k - 1)}>
          ← Back
        </button>
        <button
          className={`text-btn ${auto ? 'is-on' : ''}`}
          disabled={last}
          onClick={() => {
            if (auto) {
              setAuto(false)
              onPause()
            } else {
              onCursor(s.time)
              setAuto(true)
              onPlay()
            }
          }}
        >
          {auto ? '❚❚ Stop auto' : '▶ Auto (pause at each step)'}
        </button>
        <button className="primary-btn" disabled={last} onClick={() => go(k + 1)}>
          Next step →
        </button>
      </div>
      <p className="muted small">Each step moves the master cursor: the schematic, waveforms, diode states, current path and the WHY panel all show this instant.</p>
    </section>
  )
}
