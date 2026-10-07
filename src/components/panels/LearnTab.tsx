import { useState } from 'react'
import { LESSONS, type Lesson } from '../../learning/lessons.ts'
import type { Section } from '../../state/labState.ts'

interface Props {
  section: Section
  completed: string[]
  onOpen: (l: Lesson) => void
}

/** LEARN tab — one lesson at a time: title, one-line idea, previous / open / next. */
export function LearnTab({ section, completed, onOpen }: Props) {
  const list = LESSONS.filter((l) => (l.section ?? 'single') === section)
  const firstOpen = Math.max(0, list.findIndex((l) => !completed.includes(l.id)))
  const [k, setK] = useState(firstOpen)
  const l = list[Math.min(k, list.length - 1)]
  if (!l) return null
  return (
    <section className="learn-tab" aria-labelledby="learn-tab-title">
      <p className="eyebrow">
        Learn · lesson {k + 1} of {list.length}
        {completed.includes(l.id) && <span className="done-mark"> · ✓ done</span>}
      </p>
      <h2 id="learn-tab-title" className="learn-title">
        {k + 1}. {l.title}
      </h2>
      <p className="lesson-body">{l.summary}</p>
      <div className="mode-actions">
        <button className="text-btn" disabled={k === 0} onClick={() => setK(k - 1)}>
          ← Previous
        </button>
        <button className="primary-btn" onClick={() => onOpen(l)}>
          Open lesson
        </button>
        <button className="text-btn" disabled={k >= list.length - 1} onClick={() => setK(k + 1)}>
          Next →
        </button>
      </div>
      <p className="muted small">
        {completed.filter((id) => list.some((x) => x.id === id)).length} of {list.length} lessons done in this section.
      </p>
    </section>
  )
}
