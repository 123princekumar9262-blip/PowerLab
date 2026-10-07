import type { StateExplanation } from '../explanations/index.ts'
import type { SignalId } from '../types/simulation.ts'
import { formatDeg, formatSI, formatTime } from '../utils/format.ts'
import { SIGNAL_META } from '../visualization/signals.ts'

interface Props {
  ex: StateExplanation
  /** The circuit's signals (readings shown for the non-advanced ones). */
  signalIds: readonly SignalId[]
  whyOpen: boolean
  onToggleWhy: () => void
}

const TREND_ARROW = { increasing: '↗', decreasing: '↘', 'at peak': '⤒', zero: '' } as const
const SOURCE_TREND = { rising: 'rising', falling: 'falling', peak: 'at + peak', trough: 'at − peak', flat: 'steady' } as const
const BIAS = { 'forward-conducting': 'conducting', 'forward-below-threshold': 'below Vf', reverse: 'reverse biased', zero: 'zero bias' } as const

export function StatePanel({ ex, signalIds, whyOpen, onToggleWhy }: Props) {
  const s = ex.sample
  const readings = signalIds.filter((id) => !SIGNAL_META[id].advanced)

  return (
    <section className="state" aria-labelledby="state-title">
      <header className="state-head">
        <h2 id="state-title" className="eyebrow">What is happening right now?</h2>
        <div className="state-time">
          <span>t = {formatTime(s.time)}</span>
          <span>θ = {formatDeg(ex.angleDeg)}</span>
        </div>
      </header>

      <p className={`state-headline ${ex.diodes.some((d) => d.on) ? 'is-on' : 'is-off'}`} aria-live="polite">
        {ex.headline}
      </p>

      <dl className="readings">
        {readings.map((sid) => (
          <div key={sid}>
            <dt>
              <span className={`swatch ${SIGNAL_META[sid].dashed ? 'swatch--dashed' : ''}`} style={{ ['--c' as string]: `var(${SIGNAL_META[sid].cssVar})` }} />
              {SIGNAL_META[sid].label}
            </dt>
            <dd>{formatSI(s.values[sid] ?? 0, SIGNAL_META[sid].unit, { signed: SIGNAL_META[sid].unit === 'V' || sid === 'ic' })}</dd>
          </div>
        ))}
      </dl>

      <dl className="facts">
        <div>
          <dt>Source</dt>
          <dd>
            {ex.source.polarity === 'zero' ? 'Zero' : ex.source.polarity === 'positive' ? 'Positive' : 'Negative'}
            <span className="muted"> · {SOURCE_TREND[ex.source.trend]}</span>
          </dd>
        </div>
        <div>
          <dt>{ex.diodes.length > 1 ? 'Diodes' : 'Diode D1'}</dt>
          <dd className="diode-list">
            {ex.diodes.map((d) => (
              <span key={d.id} className={`status ${d.on ? 'status--on' : 'status--off'}`} title={BIAS[d.bias]}>
                {d.on ? '●' : '✕'} {ex.diodes.length > 1 ? d.id : ''} {d.on ? 'ON' : 'OFF'}
                {ex.diodes.length === 1 && <span className="muted"> · {BIAS[d.bias]}</span>}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>Load current</dt>
          <dd>
            {formatSI(s.io, 'A')}
            <span className="muted"> · {ex.current.trend === 'zero' ? 'no current' : `${TREND_ARROW[ex.current.trend]} ${ex.current.trend}`}</span>
          </dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>
            {ex.output.conducting ? 'Supplied' : 'No output'}
            <span className="muted"> · Vout {formatSI(s.vout, 'V', { signed: true })}</span>
          </dd>
        </div>
        <div className="facts-path">
          <dt>Current path</dt>
          <dd>
            {ex.path ? (
              <ol className="path">
                {ex.path.map((node, k) => (
                  <li key={k}>{node}</li>
                ))}
              </ol>
            ) : (
              <span className="muted">None — loop open at the diodes</span>
            )}
          </dd>
        </div>
      </dl>

      <p className="summary">{ex.summary}</p>

      <button className={`why-btn ${whyOpen ? 'why-btn--open' : ''}`} onClick={onToggleWhy} aria-expanded={whyOpen} aria-controls="why-chain">
        <span>WHY?</span>
        <span className="why-btn-sub">{whyOpen ? 'Hide the reasoning' : 'Follow the cause → effect chain'}</span>
      </button>

      {whyOpen && (
        <ol className="chain" id="why-chain">
          {ex.chain.map((step) => (
            <li key={step.stage} className={`chain-step chain-step--${step.stage}`}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
