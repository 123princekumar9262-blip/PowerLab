import { MeasureSummary } from '../components/panels/MeasurementsPanel.tsx'
import { OverlapPanel } from '../components/panels/OverlapPanel.tsx'
import { TheoryPanel } from '../components/panels/TheoryPanel.tsx'
import type { Comparison, ComparisonRow } from '../measurements/compare.ts'
import type { MeasureKey } from '../measurements/theory/index.ts'
import type { Density } from '../state/labState.ts'
import { isThreePhase, type SimulationResult, type SimulationSample } from '../types/simulation.ts'
import { formatPercent, formatSI, formatTime } from '../utils/format.ts'
import type { AnalysisCategory, AnalysisRow } from '../workspace/contract.ts'

/*
 * Analyze for the rectifier: the rows of compareWithTheory(result), regrouped into the workspace's
 * categories (contract.ts AnalysisCategory). Nothing is computed here — values are formatted, not derived.
 */
export interface RectifierCategory {
  id: string
  label: string
  /** Rows (MeasureKey) shown in this category; empty for the views below. */
  keys: readonly MeasureKey[]
  threePhase?: boolean
}

export const RECTIFIER_CATEGORIES: readonly RectifierCategory[] = [
  { id: 'overview', label: 'Overview', keys: [] },
  { id: 'output', label: 'Output', keys: ['voutAvg', 'voutRms', 'voutPeak', 'voutMin'] },
  { id: 'current', label: 'Current', keys: ['ioAvg', 'ioRms', 'ioPeak', 'ioMin', 'wlMax', 'wlMin'] },
  { id: 'ripple', label: 'Ripple', keys: ['ripplePP', 'rippleFactor', 'rippleFrequency', 'ioRipplePP', 'ioRippleFactor'] },
  { id: 'power', label: 'Power & efficiency', keys: ['efficiency'] },
  { id: 'stress', label: 'Device stress', keys: ['idPeak', 'idAvg', 'piv', 'ifwAvg', 'ifwPeak', 'fwConductionDeg'] },
  { id: 'timing', label: 'Timing', keys: ['conductionAngleDeg', 'turnOnAngleDeg', 'turnOffAngleDeg'] },
  { id: 'commutation', label: 'Commutation μ', keys: ['overlapDeg'], threePhase: true },
  { id: 'theory', label: 'Theory vs Simulation', keys: [] },
]

/** A value in its unit, as the measurement table always showed it. */
export function fmtValue(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return '—'
  if (unit === '°') return `${v.toFixed(2)}°`
  if (unit === 'Hz') return `${v.toFixed(3)} Hz`
  if (unit === '') return v.toFixed(4)
  return formatSI(v, unit)
}

export function analysisRow(r: ComparisonRow): AnalysisRow {
  const compared = !r.skipped && r.error !== null
  return {
    key: r.key,
    label: `${r.label} (${r.symbol})`,
    simulation: fmtValue(r.simulated, r.unit),
    theory: r.kind === 'none' ? null : fmtValue(r.theory, r.unit),
    error: !compared ? null : r.errorIsAbsolute ? fmtValue(r.error, r.unit) : formatPercent(r.error!),
    pass: compared ? r.withinTolerance : null,
    note: r.skipped ?? (r.kind === 'none' ? 'no closed-form solution for this circuit' : undefined),
    formula: r.formula ?? (r.kind === 'none' ? 'no closed form' : null),
  }
}

/** Measurement window, steady state, operating mode and the theory's own notes and approximations. */
function assumptions(c: Comparison, keys: readonly string[] | null): string[] {
  const m = c.measurements
  const out = [`Measured on the simulated waveforms over the last full cycle (${formatTime(m.window.t0)} – ${formatTime(m.window.t1)}). Exact rows must agree within ±1 %.`]
  if (!m.steady.reached) out.push(`Not yet in steady state (Vdc still changed by ${m.steady.change === null ? '—' : formatPercent(m.steady.change, 2)} between the last two cycles): steady-state formulas are not compared.`)
  if (c.theory.mode) out.push(`Operating mode (theory): ${c.theory.mode}.`)
  for (const a of c.theory.approximations.filter((x) => !keys || keys.includes(x.key))) {
    const row = c.rows.find((r) => r.key === a.key)
    const diff = row?.simulated != null && a.value !== 0 ? ` — differs from the simulation by ${formatPercent((row.simulated - a.value) / Math.abs(a.value), 1)}` : ''
    out.push(`Textbook approximation, ${a.label}: ${fmtValue(a.value, row?.unit ?? '')} (${a.formula})${diff}.`)
  }
  return [...out, ...c.theory.notes]
}

/** The categories with real content for this run (empty ones are dropped). */
export function rectifierAnalysis(c: Comparison, result: SimulationResult, sample: SimulationSample, density: Density): AnalysisCategory[] {
  const three = isThreePhase(result.params.topology)
  const out: AnalysisCategory[] = []
  for (const cat of RECTIFIER_CATEGORIES) {
    if (cat.threePhase && !three) continue
    if (cat.id === 'overview') {
      out.push({ id: 'overview', label: 'Overview', rows: [], extra: <MeasureSummary comparison={c} density={density} hint=" Pick a category for its rows next to theory, or Theory vs Simulation for everything." /> })
      continue
    }
    if (cat.id === 'theory') {
      out.push({
        id: 'theory',
        label: 'Theory vs Simulation',
        rows: c.rows.map(analysisRow),
        assumptions: assumptions(c, null),
        extra: (
          <details className="rx-equations" open={density === 'engineer'}>
            <summary>Equations and derivations</summary>
            <TheoryPanel comparison={c} />
          </details>
        ),
      })
      continue
    }
    const rows = c.rows.filter((r) => cat.keys.includes(r.key)).map(analysisRow)
    if (cat.id === 'commutation') {
      out.push({ id: cat.id, label: cat.label, rows, extra: <OverlapPanel result={result} sample={sample} /> })
      continue
    }
    if (rows.length) out.push({ id: cat.id, label: cat.label, rows, assumptions: assumptions(c, cat.keys) })
  }
  return out
}

/** Maps the entry points (the commutation sheet, the old Theory button) to a category. */
export function categoryFor(part: string | undefined, kind: 'measure' | 'theory'): string {
  if (kind === 'theory') return 'theory'
  return part && RECTIFIER_CATEGORIES.some((c) => c.id === part) ? part : 'overview'
}
