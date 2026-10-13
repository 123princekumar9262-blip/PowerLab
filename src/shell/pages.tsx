import { Suspense, useState } from 'react'
import {
  areaById,
  CATEGORY_LABEL,
  CATEGORY_LINE,
  CATEGORY_ORDER,
  ENGINEERING,
  labById,
  LABS,
  MODE_HINT,
  MODE_LABEL,
  MODE_ORDER,
  PRIMARY_MODES,
  targetOf,
  fullName,
  type Lab,
  type Topic,
} from '../catalogue/catalogue.ts'
import { practicePage } from '../practice/index.ts'
import { homeOfLab, PRACTICE_FOR, subjectCounts, subjectLabs, subjectMachines, SUBJECTS, type Subject } from '../catalogue/subjects.ts'
import { MACHINES } from '../machines/catalog.ts'
import { solvedChecks } from '../machines/progress.ts'
import { AssistSettingsBlock } from '../assist/AssistSettings.tsx'
import { essentialsEnabled, LEVELS, setEssentialsEnabled, setLevel, useLevel } from './prefs.ts'
import { AREA_META, LAB_LEVEL, LEVEL_LABEL, suggestedOrder } from '../catalogue/levels.ts'
import { Icon } from './icons.tsx'
import { clearProgress, learningPath, lessonsDoneIn, useProgress, type Activity, type PathState } from './progress.ts'
import { href } from './router.ts'
import { learningStats, practiceStat, type Stat } from './stats.ts'
import { Crumbs, LearningPath, modesText, PageHead, StatusTag, type PathStep } from './ui.tsx'
import { GUIDE } from '../guide/content.ts'
import { PS_MODULES } from '../powersys/catalog.ts'
import { moduleProgress, usePsProgress, type PsProgress } from '../powersys/progress.ts'

const activityHref = (a: Activity) => href.workspace(a.lab, a.topic, a.mode, a.query)
/** Home → "How it works": the three things every lab is about. */
const HOW: Array<[string, string]> = [
  ['Choose a circuit', 'Every lab is an interactive simulation of a circuit or a system. New to the subject? Start with Rectifiers.'],
  ['Change a value', 'Move a slider. The circuit is simulated again at once and every waveform updates.'],
  ['Ask WHY', 'Drag the cursor along the waveforms. WHY explains what the circuit is doing at that instant, and what happens next.'],
]
const PATH_MARK: Record<PathState, string> = { done: '✓', recommended: '→', started: '●', open: '○' }
const PATH_TEXT: Record<PathState, string> = { done: 'completed', recommended: 'recommended next', started: 'started', open: '' }

// ── Home ────────────────────────────────────────────────────────────────────

export function HomePage() {
  const progress = useProgress()
  const path = learningPath(progress)
  const last = progress.last
  const returning = !!last
  const stats = learningStats(progress)
  const recommended = path.find((p) => p.state === 'recommended')
  // How it works: three steps and the four ways to learn (open for a new visitor, folded for a returning one)
  const how = (
    <>
      <ol className="how-steps">
        {HOW.map(([title, text], k) => (
          <li key={title}>
            <span className="how-n" aria-hidden="true">
              {k + 1}
            </span>
            <span>
              <b>{title}</b>
              <span className="how-text">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="how-modes">
        <p className="small">Every lab offers the same four ways to learn:</p>
        <ul className="how-modes-list">
          {PRIMARY_MODES.map((m) => (
            <li key={m}>
              <b>{MODE_LABEL[m]}</b> {MODE_HINT[m]}
            </li>
          ))}
        </ul>
      </div>
    </>
  )

  // "Suggested next": real next steps only — the lesson in progress, the recommended lab, a practice task
  const suggestions: Array<{ title: string; meta: string; href: string }> = []
  if (last?.lesson && last.lesson.step < last.lesson.of - 1) {
    const left = last.lesson.of - last.lesson.step - 1
    suggestions.push({ title: `Finish “${last.lesson.title}”`, meta: `${last.title} · ${left} step${left === 1 ? '' : 's'} left`, href: activityHref(last) })
  }
  if (recommended && recommended.lab.id !== last?.lab)
    suggestions.push({
      title: `${recommended.done > 0 ? 'Continue' : 'Start'} ${recommended.lab.title}`,
      meta: `Recommended next lab · ${Math.min(recommended.done, recommended.lab.lessons)} of ${recommended.lab.lessons} lessons`,
      href: href.lab(recommended.lab.id),
    })
  if (stats.challenges.done < stats.challenges.total)
    suggestions.push({ title: 'Solve a design challenge', meta: `Practice · ${stats.challenges.done} of ${stats.challenges.total} solved`, href: href.engineering('challenge') })
  if (suggestions.length < 3) suggestions.push({ title: 'Read the lab guide', meta: 'Theory pages with a “Try it” for every circuit', href: href.guide() })

  return (
    <div className="page page--home">
      <header className="home-head">
        <h1 tabIndex={-1}>{returning ? 'Welcome back' : 'Power Electronics Lab'}</h1>
        <p className="page-lead">
          {returning
            ? 'Pick up where you left off, or choose a subject below.'
            : 'Learn electrical engineering by watching it work. Choose a subject, pick a topic, change a value and watch it respond — every waveform comes from a simulation or model, never drawn by hand.'}
        </p>
      </header>

      {returning ? (
        <>
          <section className="stat-row" aria-label="Your progress">
            <StatCard label="Lessons completed" stat={stats.lessons} tone="good" />
            <StatCard label="Labs opened" stat={stats.labs} />
            <StatCard label="Challenges solved" stat={stats.challenges} />
            <StatCard label="Best sketch prediction" stat={stats.sketch === null ? null : { done: stats.sketch, total: 100 }} empty="Try Rectifiers › Predict › Sketch" />
          </section>
          <div className="home-row">
            <section className="dash-card dash-card--continue" aria-labelledby="h-continue">
              <p id="h-continue" className="eyebrow">
                Continue learning
              </p>
              <h2 className="dash-title">{last.title}</h2>
              <p className="dash-meta">
                {last.labTitle} · {MODE_LABEL[last.mode]}
                {last.lesson && (
                  <>
                    {' '}
                    · {last.lesson.title}, step {last.lesson.step + 1} of {last.lesson.of}
                  </>
                )}
              </p>
              {last.lesson && <Meter value={(last.lesson.step + 1) / last.lesson.of} label={`Step ${last.lesson.step + 1} of ${last.lesson.of}`} />}
              <a className="btn btn--primary" href={activityHref(last)}>
                Continue
              </a>
            </section>
            <section className="dash-card" aria-labelledby="h-next">
              <p id="h-next" className="eyebrow">
                Suggested next
              </p>
              <ul className="sugg-list">
                {suggestions.slice(0, 3).map((s) => (
                  <li key={s.title}>
                    <a className="sugg" href={s.href}>
                      <span>
                        <span className="sugg-title">{s.title}</span>
                        <span className="sugg-meta">{s.meta}</span>
                      </span>
                      <Icon name="arrow" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : (
        <section className="hero hero--start" aria-label="Start here">
          <div>
            <p className="eyebrow">Start here</p>
            <h2 className="hero-title">Explore your first power-electronics circuit.</h2>
            <p className="hero-meta">A half-wave rectifier: one diode, one source, one load. Change a value, watch the waveforms, and press WHY to see what the circuit is doing.</p>
          </div>
          <a className="btn btn--primary" href={href.workspace('rectifiers', labById('rectifiers')!.start)}>
            Start learning
          </a>
        </section>
      )}

      <section className="home-section" aria-labelledby="h-subjects">
        <h2 id="h-subjects" className="section-title">
          Choose a subject
        </h2>
        <div className="subject-grid">
          {SUBJECTS.map((s) => (
            <SubjectCard key={s.id} subject={s} progress={progress} />
          ))}
        </div>
      </section>

      {returning ? (
        <details className="home-section home-how">
          <summary className="section-title">How it works</summary>
          {how}
        </details>
      ) : (
        <section className="home-section" aria-labelledby="h-how">
          <h2 id="h-how" className="section-title">
            How it works
          </h2>
          {how}
        </section>
      )}

    </div>
  )
}

/** A subject opens its overview page. */
export const subjectHref = (s: Subject) => href.subject(s.id)
const SUBJECT_ICON: Record<Subject['id'], 'labs' | 'machines' | 'grid'> = { 'power-electronics': 'labs', machines: 'machines', 'power-systems': 'grid' }

/**
 * A subject as a card: what it covers, its topics, what it really contains (counted from the catalogues) and the
 * student's real progress in it — lessons finished, and 3D models whose knowledge check has a right answer.
 * Nothing is shown that is not stored.
 */
/** A student's stored progress in a subject: lessons finished in its labs, its 3D models with a right check answer. */
function subjectProgress(subject: Subject, progress: ReturnType<typeof useProgress>, ps?: PsProgress) {
  if (subject.id === 'power-systems') {
    const total = PS_MODULES.filter((m) => m.status === 'ready').reduce((n, m) => n + m.activities.length, 0)
    const done = ps ? PS_MODULES.reduce((n, m) => n + moduleProgress(ps, m.id).done, 0) : 0
    const visited = !!ps && ps.visited.length > 0
    return { lessonsDone: 0, checked: 0, visited, any: visited || done > 0, activities: { done, total } }
  }
  const labs = subjectLabs(subject)
  const lessonsDone = labs.reduce((n, l) => n + Math.min(lessonsDoneIn(l, progress), l.lessons), 0)
  const checked = subjectMachines(subject).filter((id) => solvedChecks(id).length > 0).length
  const visited = labs.some((l) => progress.visited.includes(l.id))
  return { lessonsDone, checked, visited, any: lessonsDone > 0 || checked > 0 || visited, activities: null as { done: number; total: number } | null }
}

function SubjectCard({ subject, progress }: { subject: Subject; progress: ReturnType<typeof useProgress> }) {
  const c = subjectCounts(subject)
  const ps = usePsProgress()
  const { lessonsDone, checked, visited, activities } = subjectProgress(subject, progress, ps)
  const contains = [
    `${c.topics} topics`,
    c.modules > 0 && `${c.modules} interactive module${c.modules === 1 ? '' : 's'}`,
    c.simulations > 0 && `${c.simulations} circuit simulations`,
    c.models > 0 && `${c.models} 3D models`,
    c.lessons > 0 && `${c.lessons} guided lessons`,
    c.articles > 0 && `${c.articles} theory pages`,
  ].filter(Boolean) as string[]
  const shownTopics = subject.topics.slice(0, 6)
  return (
    <a className="subject-card" href={subjectHref(subject)}>
      <span className="subject-card-head">
        <span className="subject-icon" aria-hidden="true">
          <Icon name={SUBJECT_ICON[subject.id]} />
        </span>
        <span className="subject-title">{subject.title}</span>
      </span>
      <span className="subject-line">{subject.description}</span>
      <span className="subject-topics" aria-label="Topics">
        {shownTopics.map((t) => (
          <span key={t.id} className="subject-topic">
            {t.title}
          </span>
        ))}
        {subject.topics.length > shownTopics.length && <span className="subject-topic subject-topic--more">+{subject.topics.length - shownTopics.length} more</span>}
      </span>
      <span className="subject-contains">{contains.join(' · ')}</span>
      {(lessonsDone > 0 || checked > 0 || visited) && (
        <span className="subject-progress">
          {c.lessons > 0 && <Meter value={lessonsDone / c.lessons} tone="good" label={`${lessonsDone} of ${c.lessons} lessons completed`} />}
          {activities && activities.total > 0 && <Meter value={activities.done / activities.total} tone="good" label={`${activities.done} of ${activities.total} activities done`} />}
          <span className="small">
            {[c.lessons > 0 && `${lessonsDone} of ${c.lessons} lessons completed`, checked > 0 && `${checked} of ${c.models} 3D models checked`, activities && `${activities.done} of ${activities.total} activities done`].filter(Boolean).join(' · ')}
          </span>
        </span>
      )}
      <span className="subject-open">
        Open {subject.title} <Icon name="arrow" />
      </span>
    </a>
  )
}

/** One summary number: what it counts, done of total, a bar (the same numbers as the text). */
function StatCard({ label, stat, tone, empty }: { label: string; stat: Stat | null; tone?: 'good'; empty?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      {stat ? (
        <>
          <span className="stat-value">
            {stat.done}
            <small> of {stat.total}</small>
          </span>
          <Meter value={stat.total ? stat.done / stat.total : 0} tone={tone} />
        </>
      ) : (
        <>
          <span className="stat-value stat-value--none">—</span>
          {empty && <span className="stat-empty">{empty}</span>}
        </>
      )}
    </div>
  )
}

function Meter({ value, label, tone }: { value: number; label?: string; tone?: 'good' }) {
  return (
    <span className={`meter ${tone ? `meter--${tone}` : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  )
}

/** A lab as a card: title, level, one line, lessons done (bar), circuits, Open. The whole card is the link. */
export function LabTile({ lab, done, state }: { lab: Lab; done: number; state?: PathState }) {
  const level = LAB_LEVEL[lab.id]
  const circuits = lab.topics.filter((t) => t.status === 'ready' && !t.opens).length
  const lessons = Math.min(done, lab.lessons)
  return (
    <a className={`lab-tile ${state === 'recommended' ? 'lab-tile--next' : ''}`} href={href.lab(lab.id)}>
      <span className="lab-tile-head">
        <span className="lab-glyph" aria-hidden="true">
          {lab.glyph}
        </span>
        <span className="lab-tile-title">{lab.title}</span>
        {level && <span className={`lvl lvl--${level}`}>{LEVEL_LABEL[level]}</span>}
      </span>
      <span className="lab-tile-line">{lab.tagline}</span>
      {lab.lessons > 0 && <Meter value={lessons / lab.lessons} tone="good" />}
      <span className="lab-tile-meta">
        <span>
          {state === 'recommended' ? 'Recommended next · ' : ''}
          {lab.lessons > 0 ? `${lessons} of ${lab.lessons} lessons` : 'No lessons yet'} · {circuits} circuit{circuits === 1 ? '' : 's'}
        </span>
        <span className="lab-tile-open">
          Open <Icon name="arrow" />
        </span>
      </span>
    </a>
  )
}

// ── Labs catalogue ──────────────────────────────────────────────────────────


export function LabsPage() {
  const progress = useProgress()
  const path = learningPath(progress)
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Subjects', href: href.home() }, { label: 'All circuit labs' }]} />
      <PageHead title="Labs" lead="Every circuit laboratory of the platform, grouped by what it is about — each also sits in its subject. Open any lab directly — the levels and the learning path are only recommendations." />
      {CATEGORY_ORDER.map((cat) => (
        <section key={cat} className="lab-group" aria-labelledby={`g-${cat}`}>
          <h2 id={`g-${cat}`} className="group-title">
            {CATEGORY_LABEL[cat]}
          </h2>
          <p className="group-line small">{CATEGORY_LINE[cat]}</p>
          <div className="tile-grid">
            {LABS.filter((l) => l.category === cat).map((l) => (
              <LabTile key={l.id} lab={l} done={lessonsDoneIn(l, progress)} state={path.find((p) => p.lab.id === l.id)?.state} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ── Lab landing page ────────────────────────────────────────────────────────

export function LabLandingPage({ lab, query }: { lab: Lab; query: Record<string, string> }) {
  const progress = useProgress()
  const done = Math.min(lessonsDoneIn(lab, progress), lab.lessons)
  const related = (lab.related ?? []).map((id) => labById(id)).filter((l): l is Lab => !!l)
  const order = suggestedOrder(lab)
  const level = LAB_LEVEL[lab.id]
  const circuits = lab.topics.filter((t) => t.status === 'ready' && !t.opens).length
  const topicHref = (t: Topic) => {
    const tg = targetOf(lab, t)
    return href.workspace(tg.lab, tg.topic, tg.mode, tg.query)
  }
  // the lab's place in its subject, and the 3D models that belong to (or are linked from) its topic
  const home = homeOfLab(lab.id)
  const ownModels = (home?.topic.machines ?? []).map((id) => MACHINES.find((m) => m.id === id)).filter((m) => m?.status === 'ready')
  const linkedModels = (home?.topic.related?.machines ?? []).map((id) => MACHINES.find((m) => m.id === id)).filter((m) => m?.status === 'ready')
  const models3d = [...ownModels, ...linkedModels] as typeof MACHINES
  // the suggested path through this lab: only the activities that exist for it
  const articles = GUIDE.filter((a) => a.lab === lab.id).length
  const startTopic = lab.topics.find((t) => t.id === lab.start)
  const practice = (PRACTICE_FOR[lab.id] ?? []).map((id) => areaById(id)).filter((a) => a?.status === 'ready')
  const pathSteps: PathStep[] = [
    articles > 0 && { title: 'Read the theory', meta: `${articles} short page${articles === 1 ? '' : 's'}`, href: href.guide(lab.id) },
    lab.lessons > 0 && lab.modes.includes('learn') && { title: 'Guided lessons', meta: done >= lab.lessons ? 'all done' : `${done} of ${lab.lessons} done`, href: href.workspace(lab.id, lab.start, 'learn'), done: done >= lab.lessons },
    { title: 'Explore the circuit', meta: startTopic ? `start with: ${fullName(startTopic)}` : undefined, href: href.workspace(lab.id, lab.start) },
    lab.modes.includes('experiment') && { title: 'Experiment', meta: 'change one thing, compare', href: href.workspace(lab.id, lab.start, 'experiment') },
    lab.modes.includes('predict') && { title: 'Predict, then check', meta: 'the simulation verifies', href: href.workspace(lab.id, lab.start, 'predict') },
    practice.length > 0 && { title: 'Practise', meta: practice.map((a) => a!.title).join(' · '), href: href.engineering(practice[0]!.id) },
    models3d.length > 0 && { title: 'See it in 3D', meta: models3d.length === 1 ? models3d[0].name : `${models3d[0].name} and ${models3d.length - 1} more`, href: href.machines(models3d[0].id) },
  ].filter(Boolean) as PathStep[]
  return (
    <div className="page">
      <Crumbs items={home ? [{ label: 'Subjects', href: href.home() }, { label: home.subject.title, href: href.subject(home.subject.id) }, { label: lab.title }] : [{ label: 'Labs', href: href.labs() }, { label: lab.title }]} />
      <PageHead
        title={lab.title}
        lead={lab.description}
        side={
          <>
            {level && <span className={`lvl lvl--${level}`}>{LEVEL_LABEL[level]}</span>}
            <StatusTag status={lab.status} quiet />
          </>
        }
      />
      <p className="lab-facts">
        <span>
          {circuits} circuit{circuits === 1 ? '' : 's'}
        </span>
        <span>
          {lab.lessons} lesson{lab.lessons === 1 ? '' : 's'} · {done} done
        </span>
        <span>Modes: {modesText(lab)}</span>
        <a href={href.guide(lab.id)}>Read the {lab.title} guide</a>
      </p>
      {query.moved === 'engineering' && (
        <p className="notice" role="status">
          This lab used to be called “Engineering”. Design tasks, challenges and reverse engineering are now under <a href={href.engineering()}>Practice</a>.
        </p>
      )}
      {lab.chain && (
        <ol className="sys-chain" aria-label="System">
          {lab.chain.map((c, k) => (
            <li key={c} className="sys-chain-step">
              {k > 0 && (
                <span className="sys-chain-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <span className="sys-chain-box">{c}</span>
            </li>
          ))}
        </ol>
      )}
      <LearningPath id={`s-${lab.id}-path`} title="Learning path" steps={pathSteps} />
      {order.length > 0 && (
        <section className="topic-section" aria-labelledby={`s-${lab.id}-order`}>
          <h2 id={`s-${lab.id}-order`} className="group-title">
            Suggested order
          </h2>
          <ol className="order-grid">
            {order.map(({ topic, label }, k) => (
              <li key={topic.id}>
                <a className={`topic-card order-card ${k === 0 ? 'order-card--first' : ''}`} href={topicHref(topic)}>
                  <span className="order-step">
                    {k + 1} · {label}
                  </span>
                  <span className="topic-title">{fullName(topic)}</span>
                  <span className="topic-line">{topic.purpose}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
      {lab.sections.map((sec) => {
        const items = lab.topics.filter((t) => t.section === sec)
        if (!items.length) return null
        return (
          <section key={sec} className="topic-section" aria-labelledby={`s-${lab.id}-${sec}`}>
            <h2 id={`s-${lab.id}-${sec}`} className="group-title">
              {sec}
            </h2>
            <div className="topic-grid">
              {items.map((t) =>
                t.status !== 'ready' ? (
                  <div key={t.id} className="topic-card topic-card--soon" aria-label={`${t.title}, coming soon`}>
                    <span className="topic-title">
                      {t.title} <StatusTag status={t.status} />
                    </span>
                    <span className="topic-line">{t.purpose}</span>
                  </div>
                ) : (
                  <a key={t.id} className="topic-card" href={topicHref(t)}>
                    <span className="topic-title">{t.title}</span>
                    <span className="topic-line">{t.purpose}</span>
                  </a>
                ),
              )}
            </div>
          </section>
        )
      })}
      {models3d.length > 0 && (
        <section className="topic-section" aria-labelledby={`s-${lab.id}-3d`}>
          <h2 id={`s-${lab.id}-3d`} className="group-title">
            See it in 3D
          </h2>
          <div className="topic-grid">
            {models3d.map((m) => (
              <a key={m.id} className="topic-card topic-card--3d" href={href.machines(m.id)}>
                <span className="topic-title">{m.name}</span>
                <span className="topic-line">{m.summary}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      {related.length > 0 && (
        <footer className="lab-foot small muted">
          <p>
            Related:{' '}
            {related.map((r, k) => (
              <span key={r.id}>
                {k > 0 && ' · '}
                <a href={href.lab(r.id)}>{r.title}</a>
              </span>
            ))}
          </p>
        </footer>
      )}
    </div>
  )
}

// ── Practice (route: /engineering) ──────────────────────────────────────────

export function EngineeringPage({ area }: { area: string | null }) {
  const a = area ? areaById(area) : null
  if (area && !a) return <NotFoundPage path={`/engineering/${area}`} />
  const Own = a && a.status === 'ready' ? practicePage(a.id) : null
  if (a && Own)
    return (
      <Suspense fallback={<div className="page page--narrow"><p className="muted">Loading {a.title}…</p></div>}>
        <Own />
      </Suspense>
    )
  if (a) {
    const opens = a.opens
    return (
      <div className="page page--narrow">
        <Crumbs items={[{ label: 'Practice', href: href.engineering() }, { label: a.title }]} />
        <PageHead title={a.title} lead={a.description} side={<StatusTag status={a.status} />} />
        {opens ? (
          <p>
            <a className="btn btn--primary" href={href.workspace(opens.lab, opens.topic, opens.mode)}>
              Open {a.title} in {labById(opens.lab)!.title}
            </a>
          </p>
        ) : (
          <div className="soon-box">
            <p>
              <b>Coming soon.</b> This practice area is planned but not built yet — nothing here pretends otherwise.
            </p>
            {a.foundation && <p className="muted">Available today: {a.foundation}</p>}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="page">
      <PageHead title="Practice" lead="Test yourself like an engineer. The simulation checks every answer. Best after you know a lab or two." />
      <div className="tile-grid">
        {ENGINEERING.filter((x) => x.status === 'ready').map((x) => {
          const meta = AREA_META[x.id]
          const stat = practiceStat(x.id)
          return (
            <a key={x.id} className="lab-tile" href={href.engineering(x.id)}>
              <span className="lab-tile-head">
                <span className="lab-tile-title">{x.title}</span>
                {meta && <span className={`lvl lvl--${meta.level}`}>{LEVEL_LABEL[meta.level]}</span>}
              </span>
              <span className="lab-tile-line">{x.description}</span>
              {stat && <Meter value={stat.done / stat.total} tone="good" />}
              <span className="lab-tile-meta">
                <span>
                  {meta?.effort}
                  {stat ? ` · ${stat.done} of ${stat.total} solved` : ''}
                </span>
                <span className="lab-tile-open">
                  Open <Icon name="arrow" />
                </span>
              </span>
            </a>
          )
        })}
      </div>
      {ENGINEERING.some((x) => x.status !== 'ready') && (
        <section aria-labelledby="pr-later">
          <h2 id="pr-later" className="group-title">
            Not available yet
          </h2>
          <div className="area-list area-list--soon">
            {ENGINEERING.filter((x) => x.status !== 'ready').map((x) => (
              <a key={x.id} className="area-row" href={href.engineering(x.id)}>
                <span className="area-title">
                  {x.title} <StatusTag status={x.status} />
                </span>
                <span className="area-line">{x.purpose}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Progress ────────────────────────────────────────────────────────────────

export function ProgressPage() {
  const progress = useProgress()
  const ps = usePsProgress()
  const path = learningPath(progress)
  const stats = learningStats(progress)
  const last = progress.last
  const nextStep = path.find((p) => p.state === 'recommended')
  const results = ENGINEERING.filter((x) => x.status === 'ready')
    .map((x) => ({ area: x, stat: practiceStat(x.id) }))
    .filter((r): r is { area: (typeof ENGINEERING)[number]; stat: Stat } => !!r.stat)
  return (
    <div className="page">
      <PageHead title="Progress" lead="Kept in this browser only. The path is a recommendation — open any lab at any time." />
      <section className="stat-row" aria-label="Summary">
        <StatCard label="Lessons completed" stat={stats.lessons} tone="good" />
        <StatCard label="Labs opened" stat={stats.labs} />
        <StatCard label="Challenges solved" stat={stats.challenges} />
        <StatCard label="Best sketch prediction" stat={stats.sketch === null ? null : { done: stats.sketch, total: 100 }} empty="Try Rectifiers › Predict › Sketch" />
      </section>
      <section className="subject-progress-row" aria-label="By subject">
        {SUBJECTS.map((s) => {
          const c = subjectCounts(s)
          const sp = subjectProgress(s, progress, ps)
          if (sp.activities)
            return (
              <a key={s.id} className="dash-card subject-progress-card" href={href.subject(s.id)}>
                <span className="eyebrow">{s.title}</span>
                <Meter value={sp.activities.total ? sp.activities.done / sp.activities.total : 0} tone="good" label={`${sp.activities.done} of ${sp.activities.total} activities done`} />
                <span className="small">
                  {sp.activities.done} of {sp.activities.total} activities done in {c.modules} interactive module{c.modules === 1 ? '' : 's'}
                </span>
              </a>
            )
          return (
            <a key={s.id} className="dash-card subject-progress-card" href={href.subject(s.id)}>
              <span className="eyebrow">{s.title}</span>
              {c.lessons > 0 && <Meter value={sp.lessonsDone / c.lessons} tone="good" label={`${sp.lessonsDone} of ${c.lessons} lessons completed`} />}
              <span className="small">
                {sp.lessonsDone} of {c.lessons} lessons completed
                {c.models > 0 && ` · ${sp.checked} of ${c.models} 3D models checked`}
              </span>
            </a>
          )
        })}
      </section>
      {/* the next step first: the activity to continue (if any) and the recommended lab — both from stored progress */}
      {(last || nextStep) && (
        <section className="next-step" aria-label="Next step">
          {last && (
            <a className="next-step-item" href={activityHref(last)}>
              <span className="eyebrow">Continue</span>
              <span className="next-step-title">{last.title}</span>
              <span className="next-step-meta">
                {last.labTitle} · {MODE_LABEL[last.mode]}
                {last.lesson ? ` · ${last.lesson.title} — step ${last.lesson.step + 1} of ${last.lesson.of}` : ''}
              </span>
            </a>
          )}
          {nextStep && (
            <a className="next-step-item" href={href.lab(nextStep.lab.id)}>
              <span className="eyebrow">Recommended next lab</span>
              <span className="next-step-title">{nextStep.lab.title}</span>
              <span className="next-step-meta">
                {Math.min(nextStep.done, nextStep.lab.lessons)} of {nextStep.lab.lessons} lessons done
              </span>
            </a>
          )}
        </section>
      )}
      <div className="progress-grid">
        <section className="dash-card" aria-labelledby="p-path">
          <h2 id="p-path" className="eyebrow">
            By lab, in the recommended order
          </h2>
          <ol className="lpath lpath--full">
            {path.map((p, k) => (
              <li key={p.lab.id} className={`lpath-step lpath-step--${p.state}`}>
                <a href={href.lab(p.lab.id)}>
                  <span className="lpath-mark" aria-hidden="true">
                    {PATH_MARK[p.state]}
                  </span>
                  <span className="lpath-n">{k + 1}</span>
                  <span className="lpath-name">{p.lab.title}</span>
                  {/* lessons done of the lab's lessons (the same numbers as the text beside it) */}
                  <span className="lpath-bar" aria-hidden="true">
                    <span style={{ width: `${p.lab.lessons ? (100 * Math.min(p.done, p.lab.lessons)) / p.lab.lessons : 0}%` }} />
                  </span>
                  <span className="lpath-meta">
                    {Math.min(p.done, p.lab.lessons)} of {p.lab.lessons} lessons
                    {p.state !== 'open' ? ` · ${PATH_TEXT[p.state]}` : ''}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
        <div className="progress-side">
          <section className="dash-card" aria-labelledby="p-recent">
            <h2 id="p-recent" className="eyebrow">
              Recent activity
            </h2>
            {progress.recent.length ? (
              <ul className="timeline">
                {progress.recent.map((r) => (
                  <li key={`${r.lab}/${r.topic}`}>
                    <span className="timeline-when">{whenText(r.at)}</span>
                    <a href={activityHref(r)}>
                      {r.title}
                      <span className="muted">
                        {' '}
                        · {MODE_LABEL[r.mode]}
                        {r.lesson ? `, ${r.lesson.title}` : ''}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing yet — open a lab and it will appear here.</p>
            )}
          </section>
          <section className="dash-card" aria-labelledby="p-practice">
            <h2 id="p-practice" className="eyebrow">
              Practice results
            </h2>
            {results.length ? (
              <ul className="result-list">
                {results.map(({ area, stat }) => (
                  <li key={area.id}>
                    <a href={href.engineering(area.id)}>{area.title}</a>
                    <span className="muted">
                      {stat.done} of {stat.total} solved
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No results yet.</p>
            )}
          </section>
          <p className="small muted">
            To start over, use <a href={href.settings()}>Help &amp; settings → Reset progress</a>.
          </p>
        </div>
      </div>
    </div>
  )
}

/** "Today", "Yesterday", a weekday within the week, else the date — from the stored timestamp. */
function whenText(at: number): string {
  const d = new Date(at)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(new Date()) - day(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ── Settings ────────────────────────────────────────────────────────────────

/** Keyboard shortcuts that exist in the app (each one is implemented where its comment says). */
const SHORTCUTS: Array<[string[], string]> = [
  [['Ctrl', 'K'], 'Search labs, circuits, concepts and lessons'],
  [['←', '→'], 'Move the cursor one sample along the waveforms'],
  [['Shift', '←', '→'], 'Jump to the previous or next event (labs other than Rectifiers)'],
  [['Space'], 'Play or pause the waveforms (Rectifiers)'],
  [['Home'], 'Back to the start of the run (Rectifiers)'],
  [['Esc'], 'Close a menu, a panel or the sidebar'],
]

export function SettingsPage() {
  const level = useLevel()
  const [cleared, setCleared] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [essentials, setEssentials] = useState(essentialsEnabled)
  return (
    <div className="page page--narrow">
      <PageHead title="Help & settings" lead="How the lab works, the keyboard shortcuts, and the settings stored in this browser." />
      <section className="help-block" aria-labelledby="set-how">
        <h2 id="set-how" className="group-title">
          How the lab works
        </h2>
        <ol className="how-steps how-steps--list">
          {HOW.map(([title, text], k) => (
            <li key={title}>
              <span className="how-n" aria-hidden="true">
                {k + 1}
              </span>
              <span>
                <b>{title}</b>
                <span className="how-text">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <dl className="help-modes">
          {MODE_ORDER.map((m) => (
            <div key={m}>
              <dt>{MODE_LABEL[m]}</dt>
              <dd>{MODE_HINT[m]}</dd>
            </div>
          ))}
        </dl>
        <p className="small muted">
          Theory for every lab is in the <a href={href.guide()}>Lab guide</a>; every page there opens its circuit with “Try it”.
        </p>
      </section>
      <section className="help-block" aria-labelledby="set-keys">
        <h2 id="set-keys" className="group-title">
          Keyboard shortcuts
        </h2>
        <table className="keys">
          <tbody>
            {SHORTCUTS.map(([keys, what]) => (
              <tr key={what}>
                <td>
                  {keys.map((k) => (
                    <kbd key={k} className="shell-kbd">
                      {k}
                    </kbd>
                  ))}
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">Arrow keys also move a focused slider. Shortcuts are ignored while you type in a field.</p>
      </section>
      <section className="help-block" aria-labelledby="set-level">
        <h2 id="set-level" className="group-title">
          Detail level
        </h2>
        <p className="muted small">How much each laboratory shows at first. Everything stays reachable at every level; each workspace also has a quick switch.</p>
        <div className="level-list" role="radiogroup" aria-labelledby="set-level">
          {LEVELS.map((l) => (
            <button key={l.id} role="radio" aria-checked={level === l.id} className={`level-option ${level === l.id ? 'on' : ''}`} onClick={() => setLevel(l.id)}>
              <span className="level-name">{l.label}</span>
              <span className="level-detail">{l.detail}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="help-block" aria-labelledby="set-ask">
        <h2 id="set-ask" className="group-title">
          Ask a doubt (AI tutor)
        </h2>
        <AssistSettingsBlock />
      </section>
      <section className="help-block" aria-labelledby="set-first">
        <h2 id="set-first" className="group-title">
          First visit of a lab
        </h2>
        <label className="toggle-row">
          <input type="checkbox" checked={essentials} onChange={(e) => (setEssentialsEnabled(e.target.checked), setEssentials(e.target.checked))} />
          <span>
            <b>Start each new lab with the essentials</b>
            <span className="muted small">The first time you open a lab it shows two readings and its main waveforms; “Show everything” (or your next visit) shows the rest. Nothing is removed.</span>
          </span>
        </label>
      </section>
      <section className="help-block" aria-labelledby="set-progress">
        <h2 id="set-progress" className="group-title">
          Progress
        </h2>
        <p className="muted small">Progress (last activity, recent labs, finished lessons, practice results) is stored in this browser only.</p>
        {confirming ? (
          <p className="confirm-row">
            <span>Forget your progress in this browser?</span>
            <button
              className="btn btn--danger"
              onClick={() => {
                clearProgress()
                setConfirming(false)
                setCleared(true)
              }}
            >
              Reset progress
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </p>
        ) : (
          <button
            className="btn"
            onClick={() => {
              setCleared(false)
              setConfirming(true)
            }}
          >
            Reset progress…
          </button>
        )}
        {cleared && (
          <p className="small" role="status">
            Progress cleared.
          </p>
        )}
      </section>
    </div>
  )
}

// ── Not found ───────────────────────────────────────────────────────────────

export function NotFoundPage({ path }: { path: string }) {
  return (
    <div className="page page--narrow">
      <PageHead title="Page not found" lead={`Nothing lives at “${path || '/'}”.`} />
      <p>
        <a className="btn btn--primary" href={href.home()}>
          Home
        </a>{' '}
        <a className="btn" href={href.labs()}>
          All labs
        </a>
      </p>
    </div>
  )
}
