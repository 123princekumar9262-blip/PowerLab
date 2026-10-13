import { useMemo, useState } from 'react'
import { Scope } from '../components/Scope.tsx'
import { indexAtTime } from '../simulation/engine.ts'
import type { SignalId, SimulationResult } from '../types/simulation.ts'
import { metaFor } from '../visualization/signals.ts'
import type { Viewport } from '../visualization/scopeRenderer.ts'

/**
 * The rectifier lab's oscilloscope, used read-only: it draws one simulated run; the student can move the cursor
 * (values at the cursor), zoom and pan — nothing else. Channel chips toggle the shown signals.
 */
export function PxScope({
  result,
  channels,
  shown,
  onToggle,
  cycles = 2,
  height,
  label,
  extra,
}: {
  result: SimulationResult
  /** Channels that can be shown (chips). */
  channels: SignalId[]
  /** Channels shown now. */
  shown: SignalId[]
  onToggle?: (s: SignalId) => void
  /** Initial window: the last `cycles` source cycles (steady state). */
  cycles?: number
  height?: 'short' | 'tall'
  label?: string
  /** Extra controls at the end of the chip row. */
  extra?: React.ReactNode
}) {
  const T = result.params.period
  const end = result.params.duration
  const initial: Viewport = { t0: Math.max(0, end - cycles * T), t1: end }
  const [vp, setVp] = useState<Viewport>(initial)
  const [cursor, setCursor] = useState(() => indexAtTime(result, end - cycles * T * 0.75))
  const avail = channels.filter((s) => result.trace.signals[s])
  const visible = useMemo(() => Object.fromEntries(avail.map((s) => [s, shown.includes(s)])) as Record<SignalId, boolean>, [avail, shown])
  const topology = result.params.topology
  const chips = (
    <div className="px-chips" role="group" aria-label={label ? `${label}: channels` : 'Channels'}>
      {label && <span className="px-scope-label">{label}</span>}
      {avail.map((s) => {
        const m = metaFor(s, topology)
        const on = shown.includes(s)
        return (
          <button key={s} type="button" className={`px-chip ${on ? 'is-on' : ''}`} aria-pressed={on} title={m.name} disabled={!onToggle} onClick={() => onToggle?.(s)}>
            <span className="px-chip-dot" style={{ background: `var(${m.cssVar})` }} aria-hidden="true" />
            {m.label}
          </button>
        )
      })}
      {extra}
    </div>
  )
  return (
    <div className={`px-scope ${height === 'short' ? 'px-scope--short' : ''}`}>
      <Scope
        result={result}
        viewport={vp}
        onViewport={(v) => setVp(v ?? initial)}
        cursorIndex={cursor}
        onCursorTime={(t) => setCursor(indexAtTime(result, t))}
        onScrubStart={() => {}}
        visible={visible}
        channels={avail}
        channelBar={chips}
        showLayoutSwitch={false}
        layoutMode="grouped"
        onLayoutMode={() => {}}
        showConduction={false}
        groups={[]}
        selectedGroupId={null}
        onSelectGroup={() => {}}
      />
    </div>
  )
}
