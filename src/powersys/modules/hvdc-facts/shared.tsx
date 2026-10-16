import { useMemo } from 'react'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { Callout } from '../../ui/kit.tsx'
import { compute, MODULE, type HfState } from './state.ts'

export * from './state.ts'

export const useComputed = (s: HfState) => useMemo(() => compute(s), [s])

// ── pieces ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A state the model refuses: the reasons, and no numbers. */
export function Issues({ title, issues, hint }: { title: string; issues: string[]; hint?: string }) {
  return (
    <Callout tone="bad" title={title}>
      <ul className="hf-issues">
        {issues.map((m, k) => (
          <li key={k}>{m}</li>
        ))}
      </ul>
      {hint && <p className="small">{hint}</p>}
    </Callout>
  )
}

/** Where this module sits in the student's syllabi, from the mapping (never invented). */
export function SyllabusNote() {
  const ts = TOPICS.filter((t) => t.module === MODULE)
  return (
    <ul className="hf-syllabus small muted">
      {ts.map((t) => {
        const g = statusFor(t, 'gate-ee')
        const v = statusFor(t, 'vit-eee')
        return (
          <li key={t.id}>
            <b>{t.title}</b> — GATE EE{g.ref.where ? ` Section ${g.ref.where}` : ''}:{' '}
            {g.status === 'verified' ? `named (“${g.ref.quote}”)` : g.status === 'partial' ? `partly (“${g.ref.quote}”)` : 'not named'}
            {' · '}VIT:{' '}
            {v.status === 'supplementary' && v.elective
              ? `named in ${v.ref.where} ${v.elective}, Module ${v.ref.unit} — supplementary for you`
              : v.status === 'verified'
                ? `${v.ref.where} Module ${v.ref.unit}`
                : 'not named'}
            .
          </li>
        )
      })}
    </ul>
  )
}
