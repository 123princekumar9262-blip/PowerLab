import type { EventExplanation } from '../explanations/index.ts'
import { eventTitle } from '../explanations/index.ts'
import type { EventGroup } from '../visualization/eventGroups.ts'
import { formatDeg, formatTime } from '../utils/format.ts'

/** "WHAT HAPPENED? / WHY DID IT HAPPEN?" for the selected event marker. */
export function EventDetail(props: { group: EventGroup; angleDeg: number; explanations: EventExplanation[]; onClose: () => void }) {
  const { group, explanations } = props
  return (
    <section className="event-detail" aria-labelledby="event-title">
      <header>
        <div>
          <p className="eyebrow">
            Event · <span className="no-case">{formatTime(group.time)} · θ = {formatDeg(props.angleDeg)}</span>
          </p>
          <h2 id="event-title">{explanations.map((x) => x.title).join(' · ')}</h2>
        </div>
        <button className="icon-btn" onClick={props.onClose} aria-label="Close event">
          ✕
        </button>
      </header>
      {explanations.map((x) => (
        <div key={x.title} className="event-block">
          {explanations.length > 1 && <h3>{x.title}</h3>}
          <p className="event-q">What happened?</p>
          <p>{x.what}</p>
          <p className="event-q">Why did it happen?</p>
          <p>{x.why}</p>
        </div>
      ))}
    </section>
  )
}

/** Clickable list of the events inside the visible time window. */
export function EventStrip(props: { groups: EventGroup[]; selectedId: string | null; onSelect: (g: EventGroup) => void }) {
  if (props.groups.length === 0) return <p className="event-strip-empty">No events in view.</p>
  return (
    <div className="event-strip" role="list" aria-label="Detected events in view">
      {props.groups.map((g) => (
        <button
          key={g.id}
          role="listitem"
          className={`event-chip ${g.category === 'diode' ? 'event-chip--diode' : ''} ${props.selectedId === g.id ? 'is-selected' : ''}`}
          onClick={() => props.onSelect(g)}
        >
          <span className="event-chip-glyph" aria-hidden="true">
            {g.category === 'diode' ? '◆' : '○'}
          </span>
          <span className="event-chip-time">{formatTime(g.time)}</span>
          <span>{g.events.map(eventTitle).join(' · ')}</span>
        </button>
      ))}
    </div>
  )
}
