import { Fragment } from 'react'
import { RELATIVE_TOLERANCE, ROW_GROUPS, type Comparison, type RowGroup } from '../measurements/compare.ts'
import { formatPercent, formatSI, formatTime, formatW } from '../utils/format.ts'

function fmt(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return '—'
  if (unit === '°') return `${v.toFixed(2)}°`
  if (unit === 'Hz') return `${v.toFixed(3)} Hz`
  if (unit === '') return v.toFixed(4)
  return formatSI(v, unit)
}

const GROUP_ORDER = ROW_GROUPS

/** Measurements from the simulated waveforms, next to closed-form theory, with the error. */
export function MeasurementTable({ comparison, groups }: { comparison: Comparison; groups?: RowGroup[] }) {
  const { rows, measurements: m, theory, allWithinTolerance } = comparison
  const shownGroups = groups ? GROUP_ORDER.filter((g) => groups.includes(g)) : GROUP_ORDER
  const bad = rows.filter((r) => !r.withinTolerance)
  return (
    <section className="measure" aria-labelledby="measure-title">
      <header className="section-head">
        <h2 id="measure-title" className="eyebrow">Measurements · simulation vs theory</h2>
        <p className="muted small">
          Measured over the last full cycle ({formatTime(m.window.t0)} – {formatTime(m.window.t1)}). Exact rows must agree within ±{RELATIVE_TOLERANCE * 100}%.
          {theory.mode && <> Operating mode (theory): <b>{theory.mode}</b>.</>}
        </p>
      </header>

      {!m.steady.reached && (
        <p className="flag flag--info" role="status">
          ⏳ Not yet in steady state — Vdc still changed by {m.steady.change === null ? '—' : formatPercent(m.steady.change, 2)} between the last two cycles. Steady-state formulas
          are not compared; increase Duration (Advanced) to let the transient die out.
        </p>
      )}
      {!allWithinTolerance && (
        <p className="flag" role="alert">
          ⚠ Simulation error exceeds expected tolerance for {bad.length} quantit{bad.length === 1 ? 'y' : 'ies'} ({bad.map((r) => r.symbol).join(', ')}). Try a smaller timestep (Advanced → Timestep).
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
            {shownGroups.map((g) => {
              const gr = rows.filter((r) => r.group === g)
              const approx = theory.approximations.filter((a) => gr.some((r) => r.key === a.key))
              if (!gr.length) return null
              return (
                <Fragment key={g}>
                  <tr className="group-row">
                    <th colSpan={5} scope="colgroup">{g}</th>
                  </tr>
                  {gr.map((r) => (
                    <Fragment key={r.key}>
                      <tr className={r.withinTolerance ? '' : 'row-bad'}>
                        <th scope="row">
                          {r.label} <span className="sym">{r.symbol}</span>
                        </th>
                        <td className="num">{fmt(r.simulated, r.unit)}</td>
                        <td className="num">{r.kind === 'none' ? <span className="muted" title="No closed-form solution for this circuit">—</span> : fmt(r.theory, r.unit)}</td>
                        <td className="num">
                          {r.skipped ? (
                            <span className="muted" title={r.skipped}>n/a</span>
                          ) : r.error === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <span className={`err ${r.withinTolerance ? 'err--ok' : 'err--bad'}`}>
                              {r.withinTolerance ? '✓' : '⚠'} {r.errorIsAbsolute ? fmt(r.error, r.unit) : formatPercent(r.error)}
                            </span>
                          )}
                        </td>
                        <td className="formula">{r.formula ?? (r.kind === 'none' ? 'no closed form' : '')}</td>
                      </tr>
                      {approx
                        .filter((a) => a.key === r.key)
                        .map((a) => (
                          <tr key={a.label} className="row-approx">
                            <th scope="row">
                              <span className="approx-tag">approx.</span> {a.label}
                            </th>
                            <td className="num muted">vs sim</td>
                            <td className="num">{fmt(a.value, r.unit)}</td>
                            <td className="num">
                              {r.simulated !== null && a.value !== 0 ? <span className="muted">{formatPercent((r.simulated - a.value) / Math.abs(a.value), 1)}</span> : '—'}
                            </td>
                            <td className="formula">{a.formula}</td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Average power: source {formatW(m.sourcePower)} → load {formatW(m.loadPower)} + diodes {formatW(m.diodeLoss)}. Theory is an independent closed-form derivation (see
        docs/simulation.md); "approx." rows are textbook approximations, shown so you can see how good they are.
      </p>
      {theory.notes.length > 0 && (
        <ul className="notes">
          {theory.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
