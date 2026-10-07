import { RELATIVE_TOLERANCE, type Comparison } from '../measurements/compare.ts'
import { formatPercent, formatSI, formatTime, formatW } from '../utils/format.ts'

function fmt(v: number | null, unit: string): string {
  if (v === null) return '—'
  if (unit === '°') return `${v.toFixed(2)}°`
  if (unit === 'Hz') return `${v.toFixed(3)} Hz`
  return formatSI(v, unit)
}

/** Measurements from the simulated waveforms, next to closed-form theory, with the error. */
export function MeasurementTable({ comparison }: { comparison: Comparison }) {
  const { rows, measurements: m, allWithinTolerance } = comparison
  return (
    <section className="measure" aria-labelledby="measure-title">
      <header className="section-head">
        <h2 id="measure-title" className="eyebrow">Measurements · simulation vs theory</h2>
        <p className="muted small">
          Measured over the last full cycle ({formatTime(m.window.t0)} – {formatTime(m.window.t1)}). Tolerance ±{RELATIVE_TOLERANCE * 100}%.
        </p>
      </header>

      {!allWithinTolerance && (
        <p className="flag" role="alert">
          ⚠ Simulation error exceeds expected tolerance for {rows.filter((r) => !r.withinTolerance).length} quantit
          {rows.filter((r) => !r.withinTolerance).length === 1 ? 'y' : 'ies'}. Try a smaller timestep (Advanced → Timestep).
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col" className="num">Simulated</th>
              <th scope="col" className="num">Theory</th>
              <th scope="col" className="num">Error</th>
              <th scope="col">Formula</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.withinTolerance ? '' : 'row-bad'}>
                <th scope="row">
                  {r.label} <span className="sym">{r.symbol}</span>
                </th>
                <td className="num">{fmt(r.simulated, r.unit)}</td>
                <td className="num">{fmt(r.theory, r.unit)}</td>
                <td className="num">
                  {r.error === null ? (
                    <span className="muted">n/a</span>
                  ) : (
                    <span className={`err ${r.withinTolerance ? 'err--ok' : 'err--bad'}`}>
                      {r.withinTolerance ? '✓' : '⚠'} {r.errorIsAbsolute ? fmt(r.error, r.unit) : formatPercent(r.error)}
                    </span>
                  )}
                </td>
                <td className="formula">{r.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Also measured: average load power P = {formatW(m.loadPower)}. Theory uses the same diode model as the simulation (Vf + Ron); an
        error of exactly 0 % on peaks means a sample landed on the crest.
      </p>
    </section>
  )
}
