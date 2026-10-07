import type { Measurements } from '../measurements/measurements.ts'
import type { SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatPercent, formatSI, formatW } from '../utils/format.ts'

interface Props {
  result: SimulationResult
  sample: SimulationSample
  measurements: Measurements
}

/**
 * Phase 6 — where the energy is, and where it is going, at the cursor instant.
 *
 * Power ledger: every element either SUPPLIES power (source, a discharging L or C) or
 * ABSORBS it (resistor, diodes, a charging L or C). By energy conservation the signed
 * powers sum to zero at every instant — shown live as a check on the simulation.
 */
export function EnergyPanel({ result, sample, measurements: m }: Props) {
  const p = result.params
  const x = sample.values
  const hasL = p.load === 'RL' || p.load === 'RLC'
  const hasC = p.load === 'RC' || p.load === 'RLC'
  const vC = hasC ? (x.vout ?? 0) : 0
  // RL loads have no separate il channel: the inductor carries the load current.
  const il = x.il ?? (p.load === 'RL' ? (x.io ?? 0) : 0)

  // Positive = absorbing energy, negative = supplying.
  const rows: Array<{ id: string; label: string; p: number; note: string }> = [
    { id: 'src', label: 'Source', p: -(x.ps ?? 0), note: 'supplies energy while a diode conducts' },
    { id: 'd', label: 'Diodes', p: x.pd ?? 0, note: 'lose Vf·i (+ Ron·i²) as heat' },
  ]
  if (hasL) rows.push({ id: 'l', label: 'Inductor L', p: (x.vl ?? 0) * il, note: 'stores ½·L·i² in its magnetic field' })
  if (hasC) rows.push({ id: 'c', label: 'Capacitor C', p: vC * (x.ic ?? 0), note: 'stores ½·C·v² in its electric field' })
  rows.push({ id: 'r', label: 'Resistor R', p: x.pload ?? 0, note: 'turns energy into heat (always absorbing)' })

  const sum = rows.reduce((a, r) => a + r.p, 0)
  const scale = Math.max(1e-12, ...rows.map((r) => Math.abs(r.p)))
  const peak = Math.max(1e-12, m.sourcePower * 4, scale)

  const absMax = (arr?: Float64Array) => {
    let v = 0
    if (arr) for (let k = 0; k < arr.length; k++) v = Math.max(v, Math.abs(arr[k]))
    return v || 1
  }
  const wlMax = absMax(result.trace.signals.wl)
  const wcMax = absMax(result.trace.signals.wc)

  return (
    <section className="energy" aria-labelledby="energy-title">
      <header className="section-head section-head--row">
        <h2 id="energy-title" className="eyebrow">Energy · right now</h2>
        <span className={`balance ${Math.abs(sum) <= 1e-6 * peak + 1e-9 ? 'balance--ok' : 'balance--bad'}`} title="Sum of all element powers: zero by conservation of energy">
          Σ p = {formatW(sum)} {Math.abs(sum) <= 1e-6 * peak + 1e-9 ? '✓ conserved' : '⚠'}
        </span>
      </header>

      <div className="ledger" role="table" aria-label="Instantaneous power of each element">
        <div className="ledger-axis" role="row" aria-hidden="true">
          <span>◀ supplying</span>
          <span>absorbing ▶</span>
        </div>
        {rows.map((r) => {
          const w = Math.min(50, (Math.abs(r.p) / scale) * 50)
          const supplying = r.p < -scale * 1e-6
          return (
            <div key={r.id} className="ledger-row" role="row">
              <span className="ledger-label" role="cell">
                {r.label}
              </span>
              <span className="ledger-bar" role="cell" aria-label={`${r.label} ${supplying ? 'supplying' : 'absorbing'} ${formatW(Math.abs(r.p))}`}>
                <span className="ledger-mid" />
                <span className={`ledger-fill ledger-fill--${r.id} ${supplying ? 'is-supply' : 'is-absorb'}`} style={{ width: `${w}%`, [supplying ? 'right' : 'left']: '50%' }} />
              </span>
              <span className="ledger-value" role="cell">
                {Math.abs(r.p) < scale * 1e-6 ? '0 W' : `${supplying ? '−' : '+'}${formatW(Math.abs(r.p))}`}
              </span>
            </div>
          )
        })}
      </div>

      {(hasL || hasC) && (
        <div className="stores">
          {hasL && (
            <div className="store">
              <span className="store-label">Stored in L</span>
              <span className="store-bar">
                <span className="store-fill store-fill--l" style={{ width: `${((x.wl ?? 0) / wlMax) * 100}%` }} />
              </span>
              <span className="store-value">{formatSI(x.wl ?? 0, 'J')}</span>
            </div>
          )}
          {hasC && (
            <div className="store">
              <span className="store-label">Stored in C</span>
              <span className="store-bar">
                <span className="store-fill store-fill--c" style={{ width: `${((x.wc ?? 0) / wcMax) * 100}%` }} />
              </span>
              <span className="store-value">{formatSI(x.wc ?? 0, 'J')}</span>
            </div>
          )}
        </div>
      )}

      <p className="muted small">
        Per cycle (steady state): the source delivers {formatW(m.sourcePower)} on average; {formatW(m.loadPower)} reaches R and {formatW(m.diodeLoss)} is lost in the diodes
        {m.efficiency !== null && <> — efficiency {formatPercent(m.efficiency, 1).replace('+', '')}</>}. Stored energy returns to its starting value each cycle, so L and C only borrow and repay.
      </p>
    </section>
  )
}
