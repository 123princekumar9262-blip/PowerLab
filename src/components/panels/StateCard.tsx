import type { StateExplanation } from '../../explanations/index.ts'
import type { Density } from '../../state/labState.ts'
import type { RectifierTopology, SignalId } from '../../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV } from '../../utils/format.ts'
import { metaFor } from '../../visualization/signals.ts'

interface Props {
  ex: StateExplanation
  signalIds: readonly SignalId[]
  topology: RectifierTopology
  density: Density
}

const TREND_ARROW = { increasing: '↗', decreasing: '↘', 'at peak': '⤒', zero: '' } as const
const SOURCE_TREND = { rising: 'rising', falling: 'falling', peak: 'at + peak', trough: 'at − peak', flat: 'steady' } as const
const BIAS = { 'forward-conducting': 'conducting', 'forward-below-threshold': 'below Vf', reverse: 'reverse biased', zero: 'zero bias' } as const

/**
 * STATE tab — the instant at the cursor in a few numbers: time, angle, what conducts, Vo, Io
 * (and the phase order for three-phase). Device states from Standard up, every reading at
 * Engineer, the rest under "More details".
 */
export function StateCard({ ex, signalIds, topology, density }: Props) {
  const s = ex.sample
  const tp = ex.threePhase
  const meta = (id: SignalId) => metaFor(id, topology)
  const readings = signalIds.filter((id) => !meta(id).advanced)
  const names = tp?.names ?? ex.names ?? {}

  return (
    <section className="state state--card" aria-labelledby="state-title">
      <header className="state-head">
        <h2 id="state-title" className="eyebrow">What's happening?</h2>
        <div className="state-time">
          <span>t = {formatTime(s.time)}</span>
          <span>θ = {formatDeg(ex.angleDeg)}</span>
        </div>
      </header>

      <p className={`state-headline ${ex.diodes.some((d) => d.on) ? 'is-on' : 'is-off'}`} aria-live="polite">
        {ex.headline}
      </p>

      <dl className="state-big">
        <div>
          <dt>Vo</dt>
          <dd>{formatV(s.vout)}</dd>
        </div>
        <div>
          <dt>Io</dt>
          <dd>
            {formatA(s.io)} <span className="muted small">{ex.current.trend === 'zero' ? '' : TREND_ARROW[ex.current.trend]}</span>
          </dd>
        </div>
      </dl>

      {tp && (
        <p className="phase-order">
          <span className="muted small">Phase order </span>
          {tp.order.map((q, k) => (
            <span key={q} className={`phase-chip phase-chip--${q}`}>
              {k === 0 ? '▲ ' : k === 2 ? '▼ ' : ''}
              {q.toUpperCase()}
            </span>
          ))}
          <span className="muted small"> highest → lowest</span>
        </p>
      )}

      {density !== 'beginner' && (
        <div className="diode-list" aria-label="Device states">
          {ex.diodes.map((d) => (
            <span key={d.id} className={`status ${d.on ? 'status--on' : 'status--off'}`} title={BIAS[d.bias]}>
              {d.on ? '●' : '✕'} {names[d.id] ?? d.id} {d.on ? 'ON' : 'OFF'}
            </span>
          ))}
        </div>
      )}

      {density === 'engineer' && (
        <dl className="readings">
          {readings.map((sid) => (
            <div key={sid}>
              <dt>
                <span className={`swatch ${meta(sid).dashed ? 'swatch--dashed' : ''}`} style={{ ['--c' as string]: `var(${meta(sid).cssVar})` }} />
                {meta(sid).label}
              </dt>
              <dd>{formatSI(s.values[sid] ?? 0, meta(sid).unit, { signed: meta(sid).unit === 'V' || sid === 'ic' })}</dd>
            </div>
          ))}
        </dl>
      )}

      <details className="state-more">
        <summary>More details</summary>
        <dl className="facts">
          {tp && (
            <div>
              <dt>Conducting</dt>
              <dd>
                <b>{tp.pairLabel}</b>
                <span className="muted"> · {tp.region}</span>
                {tp.overlap && <span className="muted"> · commutation overlap</span>}
              </dd>
            </div>
          )}
          <div>
            <dt>Source</dt>
            <dd>
              {ex.source.polarity === 'zero' ? 'Zero' : ex.source.polarity === 'positive' ? 'Positive' : 'Negative'}
              <span className="muted"> · {SOURCE_TREND[ex.source.trend]}</span>
            </dd>
          </div>
          <div>
            <dt>Load current</dt>
            <dd>
              {formatSI(s.io, 'A')}
              <span className="muted"> · {ex.current.trend === 'zero' ? 'no current' : ex.current.trend}</span>
            </dd>
          </div>
          <div className="facts-path">
            <dt>Current path</dt>
            <dd>{ex.path ? ex.path.join(' → ') : <span className="muted">None — loop open</span>}</dd>
          </div>
        </dl>
        <p className="summary">{ex.summary}</p>
      </details>
    </section>
  )
}
