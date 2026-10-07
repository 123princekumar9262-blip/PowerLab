import { useState } from 'react'
import type { Comparison, RowGroup } from '../../measurements/compare.ts'
import type { Density } from '../../state/labState.ts'
import { formatA, formatV } from '../../utils/format.ts'
import { MeasurementTable } from '../MeasurementTable.tsx'

type Tab = 'summary' | 'output' | 'load' | 'diodes' | 'timing' | 'theory'

const TABS: Array<{ id: Tab; label: string; groups?: RowGroup[]; engineer?: boolean }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'output', label: 'Output', groups: ['Output'] },
  { id: 'load', label: 'Load', groups: ['Load current', 'Inductor energy'] },
  { id: 'diodes', label: 'Diodes', groups: ['Diodes', 'Freewheeling diode', 'Power'] },
  { id: 'timing', label: 'Timing', groups: ['Timing'], engineer: true },
  { id: 'theory', label: 'Theory vs Simulation', engineer: true },
]

/** MEASUREMENTS — a six-number summary first; every detailed row in its own tab. */
export function MeasurementsPanel({ comparison, density }: { comparison: Comparison; density: Density }) {
  const [tab, setTab] = useState<Tab>('summary')
  const m = comparison.measurements
  const tabs = TABS.filter((t) => !t.engineer || density === 'engineer')
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0]
  const summary: Array<[string, string, string]> = [
    ['Vdc', 'Average output', formatV(m.voutAvg)],
    ['Vrms', 'RMS output', formatV(m.voutRms)],
    ['Vpeak', 'Peak output', formatV(m.voutPeak)],
    ['Idc', 'Average current', formatA(m.ioAvg)],
    ['Irms', 'RMS current', formatA(m.ioRms)],
    ['Ripple', 'Peak-to-peak output ripple', formatV(m.ripplePP, false)],
  ]
  return (
    <div className="measure-panel">
      <div className="seg tabs-seg" role="tablist" aria-label="Measurement group">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={cur.id === t.id} className={cur.id === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {cur.id === 'summary' ? (
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
            Measured on the simulated waveforms over the last full cycle{m.steady.reached ? ' (steady state)' : ' — not yet in steady state'}. Open a tab for the detailed rows
            {density === 'engineer' ? ', or Theory vs Simulation for the full comparison.' : '. Switch to Engineer for timing and the full theory comparison.'}
          </p>
        </>
      ) : (
        <MeasurementTable comparison={comparison} groups={cur.groups} />
      )}
    </div>
  )
}
