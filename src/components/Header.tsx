import { LOADS, TOPOLOGIES } from '../circuits/registry.ts'
import type { AppMode, LabState } from '../state/labState.ts'
import type { LoadType, RectifierTopology } from '../types/simulation.ts'

interface Props {
  state: LabState
  onTopology: (t: RectifierTopology) => void
  onLoad: (l: LoadType) => void
  onRun: () => void
  onMode: (m: AppMode) => void
}

const MODES: Array<{ id: AppMode; label: string; title: string }> = [
  { id: 'lab', label: 'Lab', title: 'Free exploration: any circuit, any parameter' },
  { id: 'learn', label: 'Learn', title: 'Guided lessons that walk through each circuit instant by instant' },
  { id: 'predict', label: 'Predict', title: 'Sketch what you expect, then reveal the simulation' },
  { id: 'challenge', label: 'Challenge', title: 'Design tasks checked by the simulation' },
]

/** Product header + the guided flow: choose → run → explore → ask WHY. */
export function Header({ state, onTopology, onLoad, onRun, onMode }: Props) {
  const { progress } = state
  const steps = [
    { label: 'Choose rectifier', done: state.topology !== null },
    { label: 'Choose load', done: state.load !== null },
    { label: 'Run', done: state.hasRun },
    { label: 'Move cursor', done: progress.cursorMoved },
    { label: 'Observe circuit', done: progress.sawOn && progress.sawOff, hint: 'see the diodes both ON and OFF' },
    { label: 'Press WHY', done: progress.whyPressed },
  ]
  const current = steps.findIndex((s) => !s.done)
  const canRun = state.topology !== null && state.load !== null
  const lockedCircuit = state.mode === 'learn' || state.mode === 'challenge'

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

      {state.hasRun && (
        <nav className="modes seg" role="tablist" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={state.mode === m.id} className={state.mode === m.id ? 'on' : ''} title={m.title} onClick={() => onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
      )}

      <div className="setup" aria-disabled={lockedCircuit}>
        <div className="picker" role="radiogroup" aria-label="Rectifier">
          <span className="picker-label">
            <b>1</b> Rectifier
          </span>
          {TOPOLOGIES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={state.topology === t.id}
              disabled={lockedCircuit}
              className={`pick ${state.topology === t.id ? 'on' : ''}`}
              onClick={() => onTopology(t.id)}
              title={t.label}
            >
              {t.short}
            </button>
          ))}
        </div>
        <div className="picker" role="radiogroup" aria-label="Load">
          <span className="picker-label">
            <b>2</b> Load
          </span>
          {LOADS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={state.load === l.id}
              disabled={lockedCircuit}
              className={`pick ${state.load === l.id ? 'on' : ''}`}
              onClick={() => onLoad(l.id)}
              title={l.name}
            >
              {l.label}
            </button>
          ))}
        </div>
        {!state.hasRun && (
          <button className="run-btn" disabled={!canRun} onClick={onRun}>
            <b>3</b> Run simulation
          </button>
        )}
      </div>

      {state.mode === 'lab' && (
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
      )}
    </header>
  )
}
