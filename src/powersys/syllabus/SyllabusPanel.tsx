import { href } from '../../shell/router.ts'
import { PS_MODULES, psModule } from '../catalog.ts'
import { Seg } from '../ui/kit.tsx'
import { isTaught, pathSummary, plannedPhase, pathTopics, prerequisiteGaps, setLearningPath, statusFor, useLearningPath, PATH_LABEL, type LearningPath } from './coverage.ts'
import { SOURCES, VIT_COURSE_TITLES, VIT_STUDENT_COURSES } from './sources.ts'
import type { Coverage, SyllabusId, SyllabusTopic } from './types.ts'
import './syllabus.css'

/*
 * The Power Systems subject page's syllabus view: choose GATE EE, VIT Vellore or both, and see each topic of that
 * syllabus — where it is taught (or planned), how the official text names it (verified / partial), and topics that
 * are useful but not named (supplementary). Everything comes from topics.ts and sources.ts; nothing is estimated.
 */

const STATUS_LABEL: Record<Coverage, string> = { verified: 'Named', partial: 'Partly named', supplementary: 'Not named', pending: 'Not checked' }
const PHASE_LABEL = { 'phase-a': 'Phase A (in progress)', 'phase-b': 'Phase B', 'phase-c': 'Phase C', 'phase-d': 'Phase D', 'follow-up': 'a follow-up phase' } as const

function Chip({ s, t }: { s: SyllabusId; t: SyllabusTopic }) {
  const r = statusFor(t, s)
  const name = s === 'gate-ee' ? 'GATE' : 'VIT'
  const where = r.ref.where ? (s === 'gate-ee' ? `Section ${r.ref.where}` : `${r.ref.where}${r.ref.unit ? ` Module ${r.ref.unit}` : ''}`) : ''
  const title = r.elective ? `In the elective ${r.elective} — not one of your VIT courses` : r.ref.quote ? `${where}: “${r.ref.quote}”` : (r.ref.note ?? '')
  return (
    <span className={`ps-syl-chip ps-syl-chip--${r.status}`} title={title}>
      <b>{name}</b> {r.elective ? 'Elective only' : STATUS_LABEL[r.status]}
    </span>
  )
}

function TopicRow({ t }: { t: SyllabusTopic }) {
  const m = t.module ? psModule(t.module) : undefined
  const taught = isTaught(t)
  const gaps = prerequisiteGaps(t)
  const g = statusFor(t, 'gate-ee')
  const v = statusFor(t, 'vit-eee')
  return (
    <li className="ps-syl-topic">
      <div className="ps-syl-line">
        <span className="ps-syl-title">{t.title}</span>
        <span className="ps-syl-chips">
          <Chip s="gate-ee" t={t} />
          <Chip s="vit-eee" t={t} />
        </span>
      </div>
      <div className="ps-syl-meta small">
        {taught && m ? (
          <a href={href.subject('power-systems', m.id)}>
            Module {m.n} · {m.short}
          </a>
        ) : (
          <span className="muted">
            Not taught yet
            {m && m.status !== 'ready' ? ` — Module ${m.n} · ${m.short}` : ''}, planned for {plannedPhase(t) ? PHASE_LABEL[plannedPhase(t)!] : 'a later phase'}.
            {t.plan && !(m && t.plan === `Part of Module ${m.n}.`) ? ` ${t.plan}` : ''}
          </span>
        )}
        {gaps.length > 0 && <span className="muted"> · needs {gaps.map((x) => x.title.toLowerCase()).join(', ')} (not taught yet)</span>}
      </div>
      {(g.ref.quote || v.ref.quote) && (
        <details className="ps-more ps-syl-words">
          <summary>Official wording</summary>
          <ul>
            {g.ref.quote && (
              <li>
                GATE EE 2027, Section {g.ref.where}: “{g.ref.quote}”{g.ref.note ? ` — ${g.ref.note}` : ''}
              </li>
            )}
            {v.ref.quote && (
              <li>
                VIT {v.ref.where} {VIT_COURSE_TITLES[v.ref.where ?? ''] ?? ''}, Module {v.ref.unit}: “{v.ref.quote}”{v.ref.note ? ` — ${v.ref.note}` : ''}
              </li>
            )}
          </ul>
        </details>
      )}
    </li>
  )
}

export function SyllabusPanel() {
  const path = useLearningPath()
  const topics = pathTopics(path)
  const sum = pathSummary(path)
  // group by module in the subject's order; topics not in a built module go last
  const groups = new Map<string, SyllabusTopic[]>()
  for (const t of topics) {
    const key = t.module && isTaught(t) ? t.module : 'later'
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const order = [...PS_MODULES.map((m) => m.id as string), 'later'].filter((k) => groups.has(k))
  return (
    <section className="topic-section ps-syl" aria-labelledby="ps-syl-h">
      <div className="ps-syl-head">
        <h2 id="ps-syl-h" className="group-title">
          Your syllabus
        </h2>
        <Seg
          label="Learning path"
          value={path}
          onChange={(p) => setLearningPath(p as LearningPath)}
          options={(['gate-ee', 'vit-eee', 'combined'] as const).map((p) => ({ id: p, label: PATH_LABEL[p] }))}
        />
      </div>
      <p className="ps-syl-summary">
        {sum.named} topics named by {path === 'combined' ? 'GATE EE or your VIT courses' : path === 'gate-ee' ? 'GATE EE' : 'your VIT courses'} —{' '}
        {sum.planned === 0 ? (
          <>
            all <b>{sum.taught}</b> taught in a module.
          </>
        ) : (
          <>
            <b>{sum.taught}</b> taught in a module now, {sum.planned} planned.
          </>
        )}
      </p>
      <p className="small muted ps-syl-sources">
        From the official documents:{' '}
        {SOURCES.map((s, k) => (
          <span key={s.id}>
            {k > 0 && ' · '}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          </span>
        ))}
        . Your VIT courses: {VIT_STUDENT_COURSES.map((c) => `${c} ${VIT_COURSE_TITLES[c]}`).join(', ')}. “Named” means the official text names the topic; no exam weightings are given in these
        documents.
      </p>
      {order.map((k) => {
        const m = psModule(k)
        return (
          <div key={k} className="ps-syl-group">
            <h3 className="ps-syl-group-title">{m ? `Module ${m.n} · ${m.title}` : 'Not taught yet'}</h3>
            <ul className="ps-syl-list">
              {groups.get(k)!.map((t) => (
                <TopicRow key={t.id} t={t} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

/** The syllabus relevance of one module (shown on its page): its topics and how each syllabus names them. */
export function ModuleSyllabus({ module, open = false }: { module: string; open?: boolean }) {
  const ts = pathTopics('combined').filter((t) => t.module === module)
  if (ts.length === 0) return null
  return (
    <details className="ps-more ps-syl-module" open={open}>
      <summary>Syllabus: {ts.length === 1 ? 'one topic' : `${ts.length} topics`} in GATE EE and VIT</summary>
      <ul className="ps-syl-list">
        {ts.map((t) => (
          <TopicRow key={t.id} t={t} />
        ))}
      </ul>
    </details>
  )
}
