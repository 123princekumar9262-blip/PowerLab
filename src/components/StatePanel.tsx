import type { StateExplanation } from '../explanations/index.ts'
import { SIGNAL_META } from '../visualization/signals.ts'
import { formatA, formatDeg, formatTime, formatV } from '../utils/format.ts'
import type { SignalId } from '../types/simulation.ts'

interface Props {
  ex: StateExplanation
  whyOpen: boolean
  onToggleWhy: () => void
}

const TREND_ARROW = { increasing: '↗', decreasing: '↘', 'at peak': '⤒', zero: '' } as const
const SOURCE_TREND = { rising: 'rising', falling: 'falling', peak: 'at + peak', trough: 'at − peak', flat: 'steady' } as const

export function StatePanel({ ex, whyOpen, onToggleWhy }: Props) {
  const s = ex.sample
  const readings: Array<[SignalId, string]> = [
    ['vin', formatV(s.vin)],
    ['vout', formatV(s.vout)],
    ['vd', formatV(s.vd)],
    ['io', formatA(s.io)],
    ['id', formatA(s.id)],
  ]

  return (
    <section className="state" aria-labelledby="state-title">
      <header className="state-head">
        <h2 id="state-title" className="eyebrow">What is happening right now?</h2>
        <div className="state-time">
          <span>t = {formatTime(s.time)}</span>
          <span>θ = {formatDeg(ex.angleDeg)}</span>
        </div>
      </header>

      <p className={`state-headline ${ex.diode.on ? 'is-on' : 'is-off'}`} aria-live="polite">
        {ex.headline}
      </p>

      <dl className="readings">
        {readings.map(([sid, val]) => (
          <div key={sid}>
            <dt>
              <span className={`swatch ${SIGNAL_META[sid].dashed ? 'swatch--dashed' : ''}`} style={{ ['--c' as string]: `var(${SIGNAL_META[sid].cssVar})` }} />
              {SIGNAL_META[sid].label}
            </dt>
            <dd>{val}</dd>
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
          <dt>Diode D1</dt>
          <dd>
            <span className={`status ${ex.diode.on ? 'status--on' : 'status--off'}`}>{ex.diode.on ? '● ON' : '✕ OFF'}</span>
            <span className="muted"> · {biasLabel(ex.diode.bias)}</span>
          </dd>
        </div>
        <div>
          <dt>Current</dt>
          <dd>
            {formatA(s.io)}
            <span className="muted">
              {' '}
              · {ex.current.trend === 'zero' ? 'no current' : `${TREND_ARROW[ex.current.trend]} ${ex.current.trend}`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>
            {ex.output.conducting ? 'Conducting' : 'No output'}
            <span className="muted"> · Vout {formatV(s.vout)}</span>
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
              <span className="muted">None — loop open at D1</span>
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

function biasLabel(b: StateExplanation['diode']['bias']): string {
  switch (b) {
    case 'forward-conducting':
      return 'forward biased'
    case 'forward-below-threshold':
      return 'forward, below Vf'
    case 'reverse':
      return 'reverse biased'
    case 'zero':
      return 'zero bias'
  }
}
