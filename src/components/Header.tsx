import { LOADS, TOPOLOGIES, isAvailable } from '../circuits/registry.ts'
import type { LabState } from '../state/labState.ts'
import type { LoadType, RectifierTopology } from '../types/simulation.ts'

interface Props {
  state: LabState
  onTopology: (t: RectifierTopology) => void
  onLoad: (l: LoadType) => void
  onRun: () => void
}

/** Product header + the guided flow: choose → run → explore → ask WHY. */
export function Header({ state, onTopology, onLoad, onRun }: Props) {
  const { progress } = state
  const steps = [
    { label: 'Choose rectifier', done: state.topology !== null },
    { label: 'Choose load', done: state.load !== null },
    { label: 'Run', done: state.hasRun },
    { label: 'Move cursor', done: progress.cursorMoved },
    { label: 'Observe circuit', done: progress.sawOn && progress.sawOff, hint: 'see D1 both ON and OFF' },
    { label: 'Press WHY', done: progress.whyPressed },
  ]
  const current = steps.findIndex((s) => !s.done)
  const canRun = state.topology !== null && state.load !== null && isAvailable(state.topology, state.load)

  return (
    <header className={`top ${state.hasRun ? 'top--compact' : 'top--intro'}`}>
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M3 16h8M21 16h8" />
            <path className="brand-tri" d="M11 9v14l10-7z" />
            <path d="M21 9v14" />
          </svg>
        </div>
        <div>
          <h1>Rectifier Lab</h1>
          <p className="tagline">Understand the circuit by watching it work.</p>
        </div>
      </div>

      <div className="setup">
        <div className="picker" role="radiogroup" aria-label="Rectifier">
          <span className="picker-label">
            <b>1</b> Rectifier
          </span>
          {TOPOLOGIES.map((t) => {
            const soon = !LOADS.some((l) => isAvailable(t.id, l.id))
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={state.topology === t.id}
                disabled={soon}
                className={`pick ${state.topology === t.id ? 'on' : ''}`}
                onClick={() => onTopology(t.id)}
                title={soon ? `Planned for phase ${t.phase}` : undefined}
              >
                {t.label}
                {soon && <span className="soon">Soon</span>}
              </button>
            )
          })}
        </div>
        <div className="picker" role="radiogroup" aria-label="Load">
          <span className="picker-label">
            <b>2</b> Load
          </span>
          {LOADS.map((l) => {
            const soon = !isAvailable(state.topology ?? 'half-wave', l.id)
            return (
              <button
                key={l.id}
                role="radio"
                aria-checked={state.load === l.id}
                disabled={soon}
                className={`pick ${state.load === l.id ? 'on' : ''}`}
                onClick={() => onLoad(l.id)}
                title={soon ? `Planned for phase ${l.phase}` : undefined}
              >
                {l.label}
                {soon && <span className="soon">Soon</span>}
              </button>
            )
          })}
        </div>
        {!state.hasRun && (
          <button className="run-btn" disabled={!canRun} onClick={onRun}>
            <b>3</b> Run simulation
          </button>
        )}
      </div>

      <ol className="guide" aria-label="Guided steps">
        {steps.map((s, k) => (
          <li key={s.label} className={s.done ? 'done' : k === current ? 'current' : ''} title={s.hint}>
            <span className="guide-n" aria-hidden="true">
              {s.done ? '✓' : k + 1}
            </span>
            {s.label}
            {s.done && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>
    </header>
  )
}
