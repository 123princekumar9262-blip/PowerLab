import type { EventExplanation } from '../explanations/index.ts'
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
