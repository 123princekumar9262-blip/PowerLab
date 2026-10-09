import type { Comparison } from '../../measurements/compare.ts'
import type { Density } from '../../state/labState.ts'
import { formatA, formatV } from '../../utils/format.ts'

/** The six-number summary: what the simulated waveforms measure over the last full cycle. */
export function MeasureSummary({ comparison, density, hint }: { comparison: Comparison; density: Density; hint?: string }) {
  const m = comparison.measurements
  const summary: Array<[string, string, string]> = [
    ['Vdc', 'Average output', formatV(m.voutAvg)],
    ['Vrms', 'RMS output', formatV(m.voutRms)],
    ['Vpeak', 'Peak output', formatV(m.voutPeak)],
    ['Idc', 'Average current', formatA(m.ioAvg)],
    ['Irms', 'RMS current', formatA(m.ioRms)],
    ['Ripple', 'Peak-to-peak output ripple', formatV(m.ripplePP, false)],
  ]
  return (
    <>
      <dl className="summary-grid">
        {summary.map(([sym, label, v]) => (
          <div key={sym} title={label}>
            <dt>
              {sym} <span className="muted small">{label}</span>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        Measured on the simulated waveforms over the last full cycle{m.steady.reached ? ' (steady state)' : ' — not yet in steady state'}.
        {hint ?? (density === 'engineer' ? ' Open a tab for the detailed rows, or Theory vs Simulation for the full comparison.' : ' Open a tab for the detailed rows. Switch to Engineer for timing and the full theory comparison.')}
      </p>
    </>
  )
}
