import { SPEEDS } from '../state/labState.ts'
import { ANGLE_STEP_DEG, type StepMode } from '../state/stepping.ts'
import { formatDeg, formatTime } from '../utils/format.ts'

interface Props {
  playing: boolean
  speed: number
  stepMode: StepMode
  time: number
  angleDeg: number
  cycle: number
  cycles: number
  onTogglePlay: () => void
  onReset: () => void
  onStep: (dir: 1 | -1) => void
  onSpeed: (s: number) => void
  onStepMode: (m: StepMode) => void
}

const STEP_MODES: Array<{ id: StepMode; label: string; title: string }> = [
  { id: 'event', label: 'Event', title: 'Jump to the next detected event (diode switching, zero crossing, peak)' },
  { id: 'angle', label: `${ANGLE_STEP_DEG}°`, title: `Advance the source angle θ by ${ANGLE_STEP_DEG}°` },
  { id: 'sample', label: 'Δt', title: 'Advance one simulation timestep' },
]

export function Transport(p: Props) {
  return (
    <div className="transport" role="toolbar" aria-label="Playback">
      <div className="transport-group">
        <button className="t-btn t-btn--primary" onClick={p.onTogglePlay} aria-label={p.playing ? 'Pause' : 'Play'} title={p.playing ? 'Pause (Space)' : 'Play (Space)'}>
          {p.playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" /></svg>
          )}
        </button>
        <button className="t-btn" onClick={p.onReset} aria-label="Reset to t = 0" title="Reset (Home)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v4h4" fill="none" strokeWidth="1.6" /><path d="M3.6 6.6A5 5 0 1 1 3.3 10" fill="none" strokeWidth="1.6" /></svg>
        </button>
        <span className="t-sep" />
        <button className="t-btn" onClick={() => p.onStep(-1)} aria-label="Step backward" title="Step backward (←)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 3v10L5 8z" /><rect x="3" y="3" width="1.8" height="10" rx=".6" /></svg>
        </button>
        <button className="t-btn" onClick={() => p.onStep(1)} aria-label="Step forward" title="Step forward (→)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3v10l7-5z" /><rect x="11.2" y="3" width="1.8" height="10" rx=".6" /></svg>
        </button>
        <div className="seg" role="radiogroup" aria-label="Step size">
          {STEP_MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={p.stepMode === m.id} className={p.stepMode === m.id ? 'on' : ''} onClick={() => p.onStepMode(m.id)} title={m.title}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="seg" role="radiogroup" aria-label="Playback speed" title="1× = one source cycle every 4 s (slow motion)">
        {SPEEDS.map((s) => (
          <button key={s} role="radio" aria-checked={p.speed === s} className={p.speed === s ? 'on' : ''} onClick={() => p.onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="transport-readout" aria-live="off">
        <span>
          <em>t</em> {formatTime(p.time)}
        </span>
        <span>
          <em>θ</em> {formatDeg(p.angleDeg)}
        </span>
        <span>
          <em>cycle</em> {p.cycle}/{p.cycles}
        </span>
      </div>

    </div>
  )
}
