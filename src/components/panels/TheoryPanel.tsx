import { useState } from 'react'
import type { Comparison } from '../../measurements/compare.ts'
import { FORMULA_NOTES } from '../../measurements/formulaNotes.ts'
import { formatSI } from '../../utils/format.ts'

const fmt = (v: number | null, unit: string) =>
  v === null || !Number.isFinite(v) ? '—' : unit === '°' ? `${v.toFixed(2)}°` : unit === 'Hz' ? `${v.toFixed(3)} Hz` : unit === '' ? v.toFixed(4) : formatSI(v, unit)

/**
 * THEORY & EQUATIONS — one card per quantity with a closed form: concept, formula, the
 * theoretical value, the simulated value and the error; "Explain formula" on request.
 */
export function TheoryPanel({ comparison }: { comparison: Comparison }) {
  const [open, setOpen] = useState<string | null>(null)
  const rows = comparison.rows.filter((r) => r.theory !== null && r.formula)
  return (
    <div className="theory-panel">
      {comparison.theory.mode && (
        <p className="muted small">
          Operating mode (theory): <b>{comparison.theory.mode}</b>. Exact formulas must agree with the simulation within ±1 %.
        </p>
      )}
      <div className="theory-cards">
        {rows.map((r) => {
          const note = FORMULA_NOTES[r.key]
          const err = r.error === null ? (r.skipped ? r.skipped : '—') : r.errorIsAbsolute ? `${fmt(r.error, r.unit)} (abs.)` : `${(r.error * 100).toFixed(3)} %`
          return (
            <article key={r.key} className={`theory-card ${r.withinTolerance ? '' : 'theory-card--bad'}`}>
              <h3>{note?.concept ?? r.label}</h3>
              <p className="chain-eq">{r.formula}</p>
              <dl>
                <div>
                  <dt>Theory</dt>
                  <dd>{fmt(r.theory, r.unit)}</dd>
                </div>
                <div>
                  <dt>Simulation</dt>
                  <dd>{fmt(r.simulated, r.unit)}</dd>
                </div>
                <div>
                  <dt>Error</dt>
                  <dd>
                    {r.kind === 'approx' ? 'approx.' : r.withinTolerance ? '✓ ' : '⚠ '}
                    {err}
                  </dd>
                </div>
              </dl>
              {note && (
                <>
                  <button className="text-btn" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>
                    {open === r.key ? 'Hide explanation' : 'Explain formula'}
                  </button>
                  {open === r.key && <p className="lesson-body">{note.explain}</p>}
                </>
              )}
            </article>
          )
        })}
      </div>
      {comparison.theory.notes.length > 0 && (
        <ul className="theory-notes">
          {comparison.theory.notes.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
