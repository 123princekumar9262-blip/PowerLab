import { useEffect, useRef, useState } from 'react'
import type { Density } from '../state/labState.ts'
import type { SignalId, SimulationResult } from '../types/simulation.ts'
import { CHANNEL_GROUPS, PRESETS, type ChannelPreset } from '../visualization/presets.ts'
import { metaFor } from '../visualization/signals.ts'

interface Props {
  result: SimulationResult
  /** Channels this view may show (all of the circuit's signals, or a restricted set). */
  channels: SignalId[]
  visible: Record<SignalId, boolean>
  preset: ChannelPreset
  density: Density
  onPreset: (p: Exclude<ChannelPreset, 'custom'>) => void
  onToggle: (s: SignalId) => void
}

/** Presets offered per density (every channel stays reachable through "+ Add channel"). */
const PRESETS_FOR: Record<Density, ChannelPreset[]> = {
  beginner: ['basic'],
  standard: ['basic', 'diode', 'load'],
  engineer: ['basic', 'diode', 'load', 'power', 'everything'],
}

/**
 * Waveform channels: a preset row, the active channels (click to hide), and "+ Add channel"
 * with every signal the circuit produces. Only the chosen channels are drawn.
 */
export function ChannelBar({ result, channels, visible, preset, density, onPreset, onToggle }: Props) {
  const [open, setOpen] = useState(false)
  const pop = useRef<HTMLDivElement>(null)
  const topology = result.params.topology
  const meta = (s: SignalId) => metaFor(s, topology)
  const active = channels.filter((s) => visible[s])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (pop.current && !pop.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="channel-bar">
      {/* presets only where there is a choice (Beginner keeps the one essential set + "Add waveform") */}
      {(PRESETS_FOR[density].length > 1 || preset === 'custom') && (
      <div className="seg seg--presets" role="radiogroup" aria-label="Channel preset">
        {PRESETS.filter((p) => PRESETS_FOR[density].includes(p.id)).map((p) => (
          <button key={p.id} role="radio" aria-checked={preset === p.id} className={preset === p.id ? 'on' : ''} title={p.title} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <button role="radio" aria-checked className="on" title="Channels picked by hand">
            Custom
          </button>
        )}
      </div>
      )}
      <div className="legend" role="group" aria-label="Shown channels (click to hide)">
        {active.map((sid) => (
          <button key={sid} className="chip chip--on" aria-pressed title={`${meta(sid).name} — click to hide`} onClick={() => onToggle(sid)}>
            <span className={`swatch ${meta(sid).dashed ? 'swatch--dashed' : ''}`} style={{ ['--c' as string]: `var(${meta(sid).cssVar})` }} />
            {meta(sid).label}
          </button>
        ))}
      </div>
      <div className="add-channel" ref={pop}>
        <button className="chip chip--more" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
          + Add waveform
        </button>
        {open && (
          <div className="channel-pop" role="group" aria-label="Select channels">
            {CHANNEL_GROUPS.map((g) => {
              const list = g.signals.filter((s) => channels.includes(s))
              if (!list.length) return null
              return (
                <fieldset key={g.title}>
                  <legend>{g.title}</legend>
                  {list.map((s) => (
                    <label key={s} className="check">
                      <input type="checkbox" checked={!!visible[s]} onChange={() => onToggle(s)} />
                      <span className="swatch" style={{ ['--c' as string]: `var(${meta(s).cssVar})` }} />
                      {meta(s).label} <span className="muted small">{meta(s).name}</span>
                    </label>
                  ))}
                </fieldset>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
