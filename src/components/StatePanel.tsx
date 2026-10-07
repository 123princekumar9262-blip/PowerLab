import type { StateExplanation } from '../explanations/index.ts'
import type { RectifierTopology, SignalId } from '../types/simulation.ts'
import { formatDeg, formatSI, formatTime } from '../utils/format.ts'
import { metaFor } from '../visualization/signals.ts'

interface Props {
  ex: StateExplanation
  /** The circuit's signals (readings shown for the non-advanced ones). */
  signalIds: readonly SignalId[]
  topology: RectifierTopology
  whyOpen: boolean
  onToggleWhy: () => void
  /** Physics Lens toggle. */
  lensOn: boolean
  onToggleLens: () => void
}

const TREND_ARROW = { increasing: '↗', decreasing: '↘', 'at peak': '⤒', zero: '' } as const
const SOURCE_TREND = { rising: 'rising', falling: 'falling', peak: 'at + peak', trough: 'at − peak', flat: 'steady' } as const
const BIAS = { 'forward-conducting': 'conducting', 'forward-below-threshold': 'below Vf', reverse: 'reverse biased', zero: 'zero bias' } as const

export function StatePanel({ ex, signalIds, topology, whyOpen, onToggleWhy, lensOn, onToggleLens }: Props) {
  const s = ex.sample
  const meta = (id: SignalId) => metaFor(id, topology)
  const readings = signalIds.filter((id) => !meta(id).advanced && !meta(id).optional)
  const tp = ex.threePhase

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
              <span className={`swatch ${meta(sid).dashed ? 'swatch--dashed' : ''}`} style={{ ['--c' as string]: `var(${meta(sid).cssVar})` }} />
              {meta(sid).label}
            </dt>
            <dd>{formatSI(s.values[sid] ?? 0, meta(sid).unit, { signed: meta(sid).unit === 'V' || sid === 'ic' })}</dd>
          </div>
        ))}
      </dl>

      <dl className="facts">
        {tp && (
          <>
            <div>
              <dt>Phase order</dt>
              <dd>
                {tp.order.map((q, k) => (
                  <span key={q} className={`phase-chip phase-chip--${q}`}>
                    {k === 0 ? '▲ ' : k === 2 ? '▼ ' : ''}
                    {q.toUpperCase()}
                  </span>
                ))}
                <span className="muted"> · highest → lowest</span>
              </dd>
            </div>
            <div>
              <dt>Conducting</dt>
              <dd>
                <b>{tp.pairLabel}</b>
                <span className="muted"> · {tp.region}</span>
                {tp.overlap && <span className="muted"> · commutation overlap</span>}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Source</dt>
          <dd>
            {ex.source.polarity === 'zero' ? 'Zero' : ex.source.polarity === 'positive' ? 'Positive' : 'Negative'}
            <span className="muted"> · {SOURCE_TREND[ex.source.trend]}</span>
          </dd>
        </div>
        <div>
          <dt>{ex.diodes.length > 1 ? (tp && Object.values(tp.names).some((n) => n.startsWith('T')) ? 'Devices' : 'Diodes') : 'Diode D1'}</dt>
          <dd className="diode-list">
            {ex.diodes.map((d) => (
              <span key={d.id} className={`status ${d.on ? 'status--on' : 'status--off'}`} title={BIAS[d.bias]}>
                {d.on ? '●' : '✕'} {ex.diodes.length > 1 ? (tp?.names[d.id] ?? d.id) : ''} {d.on ? 'ON' : 'OFF'}
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

      <div className="why-row">
        <button className={`why-btn ${whyOpen ? 'why-btn--open' : ''}`} onClick={onToggleWhy} aria-expanded={whyOpen} aria-controls="why-chain">
          <span>WHY?</span>
          <span className="why-btn-sub">{whyOpen ? 'Hide the reasoning' : 'Follow the cause → effect chain'}</span>
        </button>
        <button className={`lens-btn ${lensOn ? 'is-on' : ''}`} onClick={onToggleLens} aria-pressed={lensOn} title="Physics Lens: walk through source → decision → path → output → load, one stage at a time">
          🔍 Physics Lens
        </button>
      </div>

      {whyOpen && (
        <ol className="chain" id="why-chain">
          {ex.chain.map((step) => (
            <li key={step.stage} className={`chain-step chain-step--${step.stage}`}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              {step.equation && <p className="chain-eq">{step.equation}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
