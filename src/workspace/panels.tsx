import { useMemo, useState } from 'react'
import { LabScope } from '../components/lab/LabScope.tsx'
import { SpecList } from '../components/lab/ParamsPanel.tsx'
import type { AnalysisCategory, CompareRow, MeasureLabel } from '../lab/types.ts'
import { formatSI, formatTime } from '../utils/format.ts'
import type { WorkspaceModel } from './useTopicWorkspace.ts'

/*
 * The contents of the workspace regions. Every value shown is read from the workspace model (one run, one
 * cursor); these components only arrange it.
 */

// ── Parameters ──────────────────────────────────────────────────────────────

export function ParameterPanel({ w, focus, locked }: { w: WorkspaceModel; focus: boolean; locked: boolean }) {
  const { topic, params } = w
  const defaults = topic.defaults as Record<string, unknown>
  const changed = [...topic.basic, ...topic.advanced].some((s) => params[s.key] !== defaults[s.key])
  const viewKey = topic.viewKey
  return (
    <div className="wp-params">
      <div className="wp-params-head">
        <h2 className="eyebrow">Basic</h2>
        <span className="sim-tag" title="Educational defaults for simulation — not a recommended design">
          SIMULATION VALUES
        </span>
      </div>
      <SpecList specs={topic.basic} p={params} onChange={w.change} disabled={locked} idPrefix={`ws-${topic.id}`} />
      {!focus && topic.paramNote && <p className="wp-note muted small">{topic.paramNote(params, w.result)}</p>}
      {(viewKey || changed) && (
        <div className="wp-row">
          {viewKey && (
            <div className="seg" role="radiogroup" aria-label="Simulation view">
              {(
                [
                  ['steady', 'Steady state', 'The periodic steady state (found by the shooting method and verified)'],
                  ['startup', 'Start-up', 'From rest: watch the circuit settle'],
                ] as const
              ).map(([v, label, title]) => (
                <button key={v} role="radio" aria-checked={params[viewKey] === v} className={params[viewKey] === v ? 'on' : ''} title={title} disabled={locked} onClick={() => w.change({ [viewKey]: v })}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {changed && !locked && (
            <button className="text-btn" onClick={w.reset} title="Back to the default simulation values">
              Reset
            </button>
          )}
        </div>
      )}
      {!focus && (
        <details className="wp-advanced dc-advanced" open={w.level === 'engineer'}>
          <summary>Advanced parameters</summary>
          <SpecList specs={topic.advanced} p={params} onChange={w.change} disabled={locked} idPrefix={`ws-${topic.id}`} />
        </details>
      )}
      {locked && <p className="muted small">The lesson sets the parameters. Leave the lesson to change them.</p>}
    </div>
  )
}

// ── Circuit and status ──────────────────────────────────────────────────────

export function CircuitView({ w, showPath, selected, onSelect, quiet }: { w: WorkspaceModel; showPath: boolean; selected: string | null; onSelect(part: string): void; quiet?: boolean }) {
  const Diagram = w.topic.Diagram
  return (
    <div className="wp-circuit">
      {/* extra numbers on the circuit only at Engineer; live numbers from Standard (Beginner: names and words);
          `quiet` (an unanswered prediction): no numbers at all */}
      <Diagram r={w.result} st={w.st} selected={selected} onSelect={onSelect} values={!quiet && w.level === 'engineer'} live={!quiet && w.level !== 'beginner'} showPath={showPath} />
    </div>
  )
}

// ── Waveforms ───────────────────────────────────────────────────────────────

export function WaveformPanel({ w, focus, compact }: { w: WorkspaceModel; focus: boolean; compact: boolean }) {
  const { topic, result } = w
  const meta = topic.channels
  const [addOpen, setAddOpen] = useState(false)
  const present = w.channels.filter((c) => result.signals[c] && meta[c])
  // Focus view: the primary waveforms only (the topic's own choice, else the first channel)
  const primary = topic.primaryChannels ?? topic.defaultChannels.slice(0, 2)
  const shown = focus ? present.filter((c) => primary.includes(c)) : present
  const addable = topic.addOrder.filter((c) => result.signals[c] && meta[c])
  const groups = useMemo(() => {
    const g = new Map<string, string[]>()
    for (const c of addable) g.set(meta[c].group, [...(g.get(meta[c].group) ?? []), c])
    return [...g.entries()]
  }, [addable.join(','), meta]) // eslint-disable-line react-hooks/exhaustive-deps
  const std = w.level !== 'beginner'
  const toggle = (c: string) => w.setChannels(w.channels.includes(c) ? w.channels.filter((x) => x !== c) : topic.addOrder.filter((x) => x === c || w.channels.includes(x)))
  const bar = focus ? null : (
    <div className="dc-channels wp-channels" aria-label="Channels">
      {shown.map((c) => (
        <button key={c} className="chip chip--on" title={`${meta[c].name} — click to remove`} onClick={() => toggle(c)} aria-label={`Remove channel ${meta[c].label}`}>
          <span className="swatch" style={{ background: meta[c].color }} />
          {meta[c].label}
          <span aria-hidden="true" className="chip-x">
            ×
          </span>
        </button>
      ))}
      <span className="add-wrap">
        <button className="chip chip--more" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>
          + Add waveform
        </button>
        {addOpen && (
          <div className="add-menu wp-add-menu" role="group" aria-label="Add channel">
            {groups.map(([g, cs]) => (
              <fieldset key={g} className="wp-add-group">
                <legend>{g}</legend>
                {cs.map((c) => (
                  <label key={c} className="add-item">
                    <input type="checkbox" checked={w.channels.includes(c)} onChange={() => toggle(c)} />
                    <span className="swatch" style={{ background: meta[c].color }} />
                    <b>{meta[c].label}</b> <span className="muted">{meta[c].name}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <button className="text-btn" onClick={() => w.setChannels(topic.defaultChannels)}>
              Default channels
            </button>
          </div>
        )}
      </span>
      {std && !compact && (
        <div className="seg seg--layout" role="radiogroup" aria-label="Graph layout">
          {(['separate', 'grouped'] as const).map((l) => (
            <button key={l} role="radio" aria-checked={w.layout === l} className={w.layout === l ? 'on' : ''} onClick={() => w.setLayout(l)}>
              {l === 'separate' ? 'Separate' : 'Grouped'}
            </button>
          ))}
        </div>
      )}
      {std && (
      <div className="seg seg--layout" role="radiogroup" aria-label="Vertical scale">
        {(
          [
            ['zero', 'From 0', 'Every lane includes zero: true proportions'],
            ['fit', 'Zoom to ripple', 'Each lane fits its waveform: see the ripple'],
          ] as const
        ).map(([v, label, title]) => (
          <button key={v} role="radio" aria-checked={w.yMode === v} className={w.yMode === v ? 'on' : ''} title={title} onClick={() => w.setYMode(v)}>
            {label}
          </button>
        ))}
      </div>
      )}
    </div>
  )
  return (
    <div className="wp-wave">
      <LabScope
        result={result}
        channels={shown}
        meta={meta}
        layout={w.layout}
        yMode={w.yMode}
        viewport={w.viewport}
        onViewport={w.setViewport}
        cursorIndex={w.k}
        onCursorTime={(t) => {
          w.setCursorTime(t)
          w.setEvent(null)
        }}
        shading={w.shading}
        shade={topic.shade}
        shadeLegend={topic.shadeLegend}
        eventLabel={topic.eventLabel}
        eventColor={topic.eventColor}
        periodName={topic.periodName}
        selectedEventId={w.event?.id ?? null}
        onSelectEvent={w.jumpToEvent}
        toolbar={bar}
      />
      {result.diagnostics.steady.method === 'startup' && topic.viewKey && (
        <p className="small muted wp-run-note">
          Start-up from rest · {result.params.periods} {topic.periodName}s ({formatTime(result.params.duration)}) · {result.diagnostics.steady.converged ? 'settled at the end' : 'still settling at the end'}
        </p>
      )}
      {std && topic.shade && !focus && (
        <label className="toggle small wp-shade">
          <input type="checkbox" checked={w.shading} onChange={(e) => w.setShading(e.target.checked)} /> Shade conduction intervals
        </label>
      )}
    </div>
  )
}

// ── Analyze ─────────────────────────────────────────────────────────────────

const dig = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)

/** A category row: its SIMULATION value and, when a compare row exists, its THEORY value (formatted). */
export interface CategoryRow {
  key: string
  label: string
  sim: string
  theory: string | null
  pass: boolean | null
}

/** The rows of a category that exist in this run's measurements (pure: tested). */
export function categoryRows(cat: AnalysisCategory<unknown, unknown>, m: unknown, rows: CompareRow[], labels: Record<string, MeasureLabel>): CategoryRow[] {
  const out: CategoryRow[] = []
  for (const key of cat.rows ?? []) {
    const v = dig(m, key)
    if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) continue
    const c = rows.find((r) => r.key === key)
    const fmt = (x: number) => labels[key]?.fmt(x) ?? (c ? formatRow(c, x) : x.toPrecision(4))
    out.push({ key, label: labels[key]?.label ?? c?.label ?? key, sim: typeof v === 'number' ? fmt(v) : String(v), theory: c ? fmt(c.exact) : null, pass: c ? c.pass || !!c.expected : null })
  }
  return out
}
const formatRow = (row: CompareRow, v: number) => (row.unit === '%' ? `${(v * 100).toFixed(2)} %` : formatSI(v, row.unit))
