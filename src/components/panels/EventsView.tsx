import { useState } from 'react'
import { eventTitle } from '../../explanations/index.ts'
import type { EventGroup } from '../../visualization/eventGroups.ts'
import { formatDeg, formatTime } from '../../utils/format.ts'

interface Props {
  groups: EventGroup[]
  selectedId: string | null
  angleOf: (t: number) => number
  onSelect: (g: EventGroup) => void
  /** Device display names (SCRs are T1…). */
  names?: Record<string, string>
}

const FILTERS: Array<{ id: 'diode' | 'source' | 'output' | 'all'; label: string }> = [
  { id: 'diode', label: 'Switching' },
  { id: 'source', label: 'Source' },
  { id: 'output', label: 'Output' },
  { id: 'all', label: 'All' },
]

/** EVENTS view — the detected events in the visible window; click one for what & why. */
export function EventsView({ groups, selectedId, angleOf, onSelect, names }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('diode')
  const list = groups.filter((g) => filter === 'all' || g.category === filter)
  return (
    <div className="events-view">
      <div className="seg" role="radiogroup" aria-label="Event type">
        {FILTERS.map((f) => (
          <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="muted small">No events of this type in the visible window. Zoom out on the Waveforms view (Fit) to see more.</p>
      ) : (
        <ol className="events-list" aria-label="Detected events">
          {list.map((g) => (
            <li key={g.id}>
              <button className={`event-row ${selectedId === g.id ? 'is-selected' : ''}`} onClick={() => onSelect(g)}>
                <span className="event-chip-glyph" aria-hidden="true">
                  {g.category === 'diode' ? '◆' : '○'}
                </span>
                <span className="event-row-time">
                  {formatTime(g.time)} · θ = {formatDeg(angleOf(g.time))}
                </span>
                <span>{g.events.map((e) => eventTitle(e, names)).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
