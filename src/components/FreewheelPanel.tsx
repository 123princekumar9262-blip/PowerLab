import { useMemo, useState } from 'react'
import type { StateExplanation } from '../explanations/index.ts'
import type { SimulationResult } from '../types/simulation.ts'
import { formatA, formatSI, formatV, formatW } from '../utils/format.ts'

interface Props {
  result: SimulationResult
  ex: StateExplanation
  compareOn: boolean
  onToggleCompare: () => void
  stepOn: boolean
  onToggleStep: () => void
  /** Show the "why is Dfw ON/OFF?" steps here (they also live in the WHY tab). */
  showWhy?: boolean
}

/**
 * Freewheeling-diode card: the state of Dfw, the instant's key values, the inductor's stored
 * energy and where it is going, and "why is Dfw ON / OFF?" — all from the simulated sample.
 */
export function FreewheelPanel({ result, ex, compareOn, onToggleCompare, stepOn, onToggleStep, showWhy = true }: Props) {
  const [whyOpen, setWhyOpen] = useState(true)
  const fi = ex.freewheel!
  const s = ex.sample
  const wlMax = useMemo(() => {
    const w = result.trace.signals.wl
    let m = 0
    if (w) for (let k = 0; k < w.length; k++) m = Math.max(m, w[k])
    return m || 1
  }, [result])
  const on = fi.fw.on
  const flowTo =
    fi.mode === 'freewheel' || fi.mode === 'overlap'
      ? [
          { label: 'heat in R', p: fi.pR },
          { label: 'loss in Dfw', p: fi.pDfw },
        ]
      : []

  return (
    <section className="fw-panel" aria-labelledby="fw-title">
      <header className="section-head section-head--row">
        <h2 id="fw-title" className="eyebrow">Freewheeling diode</h2>
        <span className={`fw-chip fw-chip--${fi.mode}`}>{fi.modeLabel}</span>
      </header>

      <div className={`fw-state ${on ? 'is-on' : 'is-off'}`} aria-live="polite">
        <div className="fw-state-main">
          <span className="fw-state-big">{on ? 'ON' : 'OFF'}</span>
          <span className="fw-state-bias">{on ? 'Forward biased' : fi.fw.bias === 'reverse' ? 'Reverse biased' : fi.fw.bias === 'forward-below-threshold' ? 'Forward, below Vf' : 'Zero bias'}</span>
        </div>
        <dl className="fw-state-vals">
          <div>
            <dt>Current</dt>
            <dd>{formatA(fi.fw.current)}</dd>
          </div>
          <div>
            <dt>Voltage</dt>
            <dd>{formatV(fi.fw.voltage)}</dd>
          </div>
        </dl>
      </div>

      <dl className="fw-instant" aria-label="Values at the cursor">
        <div>
          <dt>Vin</dt>
          <dd>{formatV(s.vin)}</dd>
        </div>
        <div>
          <dt>Vout</dt>
          <dd>{formatV(s.vout)}</dd>
        </div>
        <div>
          <dt>IL</dt>
          <dd>{formatA(fi.il)}</dd>
        </div>
        <div>
          <dt>D1</dt>
          <dd className={fi.d1.on ? 'ok' : 'off'}>{fi.d1.on ? 'ON' : 'OFF'}</dd>
        </div>
      </dl>

      <div className="fw-energy">
        <div className="fw-energy-head">
          <span className="eyebrow">Inductor energy</span>
          <span className="chain-eq">E_L = ½·L·i² = {formatSI(fi.wl, 'J')}</span>
        </div>
        <span className="store-bar" role="img" aria-label={`Stored energy ${formatSI(fi.wl, 'J')} of a maximum ${formatSI(wlMax, 'J')} in this run`}>
          <span className="store-fill store-fill--l" style={{ width: `${(fi.wl / wlMax) * 100}%` }} />
        </span>
        <p className="small">
          {fi.energyTrend === 'empty' ? (
            <span className="muted">Empty — no current.</span>
          ) : fi.energyTrend === 'storing' ? (
            <>
              <b>Storing</b> {formatW(fi.pL)} from the source
            </>
          ) : (
            <>
              <b>Releasing</b> {formatW(-fi.pL)}
              {flowTo.length > 0 && (
                <>
                  {' → '}
                  {flowTo.map((f, k) => (
                    <span key={f.label}>
                      {k > 0 && ' + '}
                      {formatW(f.p)} {f.label}
                    </span>
                  ))}
                </>
              )}
              {flowTo.length === 0 && <span className="muted"> — to R and back through D1 to the source</span>}
            </>
          )}
        </p>
      </div>

      {showWhy && (
      <button className={`why-btn ${whyOpen ? 'why-btn--open' : ''}`} onClick={() => setWhyOpen((o) => !o)} aria-expanded={whyOpen} aria-controls="fw-why">
        <span>WHY?</span>
        <span className="why-btn-sub">{fi.whyTitle}</span>
      </button>
      )}
      {showWhy && whyOpen && (
        <ol className="fw-why" id="fw-why">
          {fi.why.map((t, k) => (
            <li key={k}>{t}</li>
          ))}
        </ol>
      )}

      <div className="fw-actions">
        <button className={`text-btn ${compareOn ? 'is-on' : ''}`} aria-pressed={compareOn} onClick={onToggleCompare}>
          ⇄ Compare with / without Dfw
        </button>
        <button className={`text-btn ${stepOn ? 'is-on' : ''}`} aria-pressed={stepOn} onClick={onToggleStep}>
          ⏭ Step through conduction
        </button>
      </div>
    </section>
  )
}
