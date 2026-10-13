import { lazy, Suspense, useEffect } from 'react'
import { ENGINEERING, LABS, MODE_LABEL, type Lab } from '../catalogue/catalogue.ts'
import { homeOfLab, subjectById, topicCounts, topicHref, type Subject, type SubjectTopic } from '../catalogue/subjects.ts'
import { GUIDE } from '../guide/content.ts'
import { MACHINES } from '../machines/catalog.ts'
import { recentMachines, solvedChecks } from '../machines/progress.ts'
import type { MachineEntry } from '../machines/types.ts'
import { Icon } from './icons.tsx'
import { NotFoundPage } from './pages.tsx'
import { lessonsDoneIn, useProgress } from './progress.ts'
import { href, replace } from './router.ts'
import { Crumbs, LearningPath, PageHead, type PathStep } from './ui.tsx'
import { psModule } from '../powersys/catalog.ts'
import { moduleProgress, usePsProgress } from '../powersys/progress.ts'
import { PS_MODE_LABEL } from '../powersys/types.ts'

/** A Power Systems module's page loads only when it is opened. */
const PsModulePage = lazy(() => import('../powersys/ui/ModulePage.tsx').then((m) => ({ default: m.PsModulePage })))

/*
 * Subject pages: the overview of a subject (#/subjects/:subject) and the page of a topic that has no page of its
 * own (#/subjects/:subject/:topic). A topic that IS one circuit lab opens that lab's existing page — the canonical
 * one — so nothing is duplicated. Everything listed comes from the registry and the catalogues; progress comes
 * only from what this browser has stored.
 */

export { topicHref }

const labOf = (id: string): Lab | undefined => LABS.find((l) => l.id === id)
const machineOf = (id: string): MachineEntry | undefined => MACHINES.find((m) => m.id === id)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a topic contains, in a short line (only what exists). */
function containsLine(t: SubjectTopic): string {
  const c = topicCounts(t)
  if (t.modules?.length) {
    const m = psModule(t.modules[0])
    return m?.status === 'ready' ? `Interactive module · ${m.modes.map((x) => PS_MODE_LABEL[x]).join(' · ')}` : 'Planned — not built yet'
  }
  return [c.simulations > 0 && plural(c.simulations, 'circuit simulation'), c.models > 0 && plural(c.models, '3D model'), c.lessons > 0 && plural(c.lessons, 'guided lesson'), c.articles > 0 && plural(c.articles, 'theory page')].filter(Boolean).join(' · ')
}

/** The student's real progress in a topic: lessons finished in its labs, 3D models with a right check answer. */
function useTopicProgress() {
  const progress = useProgress()
  const ps = usePsProgress()
  return (t: SubjectTopic): { text: string; done: boolean } | null => {
    if (t.modules?.length) {
      const { done, total } = moduleProgress(ps, t.modules[0])
      if (!ps.visited.includes(t.modules[0]) || total === 0) return null
      return { text: done === total ? 'all activities done' : `${done} of ${total} activities done`, done: done === total }
    }
    const labs = (t.labs ?? []).map(labOf).filter((l): l is Lab => !!l)
    const total = labs.reduce((n, l) => n + l.lessons, 0)
    const lessons = labs.reduce((n, l) => n + Math.min(lessonsDoneIn(l, progress), l.lessons), 0)
    const visited = labs.some((l) => progress.visited.includes(l.id))
    const models = t.machines ?? []
    const checked = models.filter((id) => solvedChecks(id).length > 0).length
    const parts: string[] = []
    if (total > 0 && (lessons > 0 || visited)) parts.push(lessons === total ? 'all lessons completed' : `${lessons} of ${total} lessons`)
    if (checked > 0) parts.push(`${checked} of ${models.length} 3D models checked`)
    if (!parts.length) return null
    return { text: parts.join(' · '), done: total > 0 && lessons === total && (models.length === 0 || checked === models.length) }
  }
}

/** #/subjects/:subject[/:topic] */
export function SubjectRoute({ subject, topic, query = {} }: { subject: string; topic: string | null; query?: Record<string, string> }) {
  const s = subjectById(subject)
  const t = s && topic ? s.topics.find((x) => x.id === topic) : null
  const canonical = s && t ? topicHref(s, t) : null
  // a topic whose page is a lab's own page: go there (the address stays valid as a link)
  useEffect(() => {
    if (canonical && !canonical.startsWith('#/subjects/')) replace(canonical)
  }, [canonical])
  if (!s) return <NotFoundPage path={`/subjects/${subject}`} />
  if (topic && !t) return <NotFoundPage path={`/subjects/${subject}/${topic}`} />
  if (t?.modules?.length)
    return (
      <Suspense fallback={<p className="page muted">Loading…</p>}>
        <PsModulePage id={t.modules[0]} mode={query.mode} />
      </Suspense>
    )
  if (t) return canonical?.startsWith('#/subjects/') ? <TopicPage s={s} t={t} /> : null
  return <SubjectPage s={s} />
}

function SubjectPage({ s }: { s: Subject }) {
  const progress = useProgress()
  const topicProgress = useTopicProgress()
  const c = s.topics.map(topicCounts).reduce((a, x) => ({ simulations: a.simulations + x.simulations, models: a.models + x.models, lessons: a.lessons + x.lessons, articles: a.articles + x.articles, modules: a.modules + x.modules }), { simulations: 0, models: 0, lessons: 0, articles: 0, modules: 0 })
  // continue: only real saved activity in this subject
  const last = progress.last && homeOfLab(progress.last.lab)?.subject.id === s.id ? progress.last : null
  const lastMachine = !last ? recentMachines().find((id) => s.topics.some((t) => t.machines?.includes(id))) : undefined
  const lastModel = lastMachine ? machineOf(lastMachine) : undefined
  const ps = usePsProgress()
  const lastPs = s.id === 'power-systems' && ps.last ? psModule(ps.last.module) : undefined
  return (
    <div className="page subject-page">
      <Crumbs items={[{ label: 'Subjects', href: href.home() }, { label: s.title }]} />
      <PageHead title={s.title} lead={s.description} />
      <div className="subject-intro">
        <div>
          <p className="eyebrow">You will learn</p>
          <ul className="subject-learn">
            {s.learn.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <p className="subject-contains">
          {[plural(s.topics.length, 'topic'), c.modules > 0 && plural(c.modules, 'interactive module'), c.simulations > 0 && plural(c.simulations, 'circuit simulation'), c.models > 0 && plural(c.models, '3D model'), c.lessons > 0 && plural(c.lessons, 'guided lesson'), c.articles > 0 && plural(c.articles, 'theory page')].filter(Boolean).join(' · ')}
        </p>
      </div>
      {lastPs && ps.last && (
        <section className="subject-continue" aria-label="Continue learning">
          <span>
            <span className="eyebrow">Continue learning</span>
            <b>{lastPs.title}</b>
            <span className="muted small">
              Module {lastPs.n} · {PS_MODE_LABEL[ps.last.mode]}
            </span>
          </span>
          <a className="btn btn--primary" href={href.subject('power-systems', lastPs.id, { mode: ps.last.mode })}>
            Continue
          </a>
        </section>
      )}
      {(last || lastModel) && (
        <section className="subject-continue" aria-label="Continue learning">
          <span>
            <span className="eyebrow">Continue learning</span>
            <b>{last ? last.title : lastModel!.name}</b>
            <span className="muted small">{last ? `${last.labTitle} · ${MODE_LABEL[last.mode]}${last.lesson ? ` · ${last.lesson.title}` : ''}` : '3D model you opened recently'}</span>
          </span>
          <a className="btn btn--primary" href={last ? href.workspace(last.lab, last.topic, last.mode, last.query) : href.machines(lastModel!.id)}>
            Continue
          </a>
        </section>
      )}
      {s.groups.map((g) => (
        <section key={g} className="topic-section" aria-labelledby={`g-${s.id}-${g}`}>
          <h2 id={`g-${s.id}-${g}`} className="group-title">
            {g}
          </h2>
          <div className="subject-topic-grid">
            {s.topics
              .filter((t) => t.group === g)
              .map((t) => {
                const p = topicProgress(t)
                return (
                  <a key={t.id} className="subject-topic-card" href={topicHref(s, t)}>
                    <span className="topic-title">{t.title}</span>
                    <span className="topic-line">{t.line}</span>
                    <span className="subject-topic-contains">{containsLine(t)}</span>
                    {p && <span className={`subject-topic-progress ${p.done ? 'is-done' : ''}`}>{p.done ? '✓ ' : ''}{p.text}</span>}
                  </a>
                )
              })}
          </div>
        </section>
      ))}
      <SubjectExtras s={s} />
    </div>
  )
}

/** The practice and tools that belong to the whole subject (existing pages, linked). */
function SubjectExtras({ s }: { s: Subject }) {
  if (s.id === 'power-systems') return null
  if (s.id === 'power-electronics') {
    const areas = ENGINEERING.filter((a) => a.status === 'ready')
    return (
      <section className="topic-section" aria-labelledby="g-practice">
        <h2 id="g-practice" className="group-title">
          Practise
        </h2>
        <div className="subject-topic-grid">
          {areas.map((a) => (
            <a key={a.id} className="subject-topic-card" href={href.engineering(a.id)}>
              <span className="topic-title">{a.title}</span>
              <span className="topic-line">{a.purpose}</span>
            </a>
          ))}
        </div>
        <p className="small muted subject-all-link">
          <a href={href.labs()}>All circuit labs</a> — the full list, with levels and the recommended order
        </p>
      </section>
    )
  }
  return (
    <section className="topic-section" aria-labelledby="g-tools">
      <h2 id="g-tools" className="group-title">
        Across all machines
      </h2>
      <div className="subject-topic-grid">
        <a className="subject-topic-card" href={href.machines('compare')}>
          <span className="topic-title">Compare machines</span>
          <span className="topic-line">Two machines side by side: construction, excitation, speed, torque, control</span>
        </a>
        <a className="subject-topic-card" href={href.machines('checks')}>
          <span className="topic-title">Knowledge checks</span>
          <span className="topic-line">Identify parts and predict behaviour, machine by machine</span>
        </a>
        <a className="subject-topic-card" href={href.machines()}>
          <span className="topic-title">All 3D models</span>
          <span className="topic-line">The full catalogue, with search and filters</span>
        </a>
      </div>
    </section>
  )
}

/** What every ready 3D model offers (tests/subjects.test.ts checks each one really has these). */
const MODEL_FEATURES = ['Components', 'Disassembly', 'How it works', 'Calculate', 'Check']

function TopicPage({ s, t }: { s: Subject; t: SubjectTopic }) {
  const models = (t.machines ?? []).map(machineOf).filter((m): m is MachineEntry => !!m && m.status === 'ready')
  const labs = (t.labs ?? []).map(labOf).filter((l): l is Lab => !!l)
  // simulations: the topic's related workspaces and those its models are simulated in (each once)
  const sims = new Map<string, { lab: string; topic: string; label: string }>()
  for (const w of t.related?.workspaces ?? []) {
    const lab = labOf(w.lab)
    const tp = lab?.topics.find((x) => x.id === w.topic)
    if (lab && tp) sims.set(`${w.lab}/${w.topic}`, { ...w, label: `${lab.title} › ${tp.name ?? tp.title}` })
  }
  for (const m of models) if (m.simulatedIn && !labs.some((l) => l.id === m.simulatedIn!.lab) && !sims.has(`${m.simulatedIn.lab}/${m.simulatedIn.topic}`)) sims.set(`${m.simulatedIn.lab}/${m.simulatedIn.topic}`, { lab: m.simulatedIn.lab, topic: m.simulatedIn.topic, label: m.simulatedIn.label.replace(/ \(simulated\)$/, '') })
  const articles = GUIDE.filter((a) => (t.labs ?? []).includes(a.lab))
  const relatedLabs = (t.related?.labs ?? []).map(labOf).filter((l): l is Lab => !!l)
  const progress = useProgress()
  // the suggested path, with the topic's first model (the recommended one when there is one)
  const first = models.find((m) => m.recommended) ?? models[0]
  const firstSim = [...sims.values()][0]
  const pathSteps: PathStep[] = [
    first && { title: 'Explore it in 3D', meta: first.name, href: href.machines(first.id) },
    first && { title: 'How it works', meta: 'step by step', href: href.machines(first.id, { tab: 'learn' }) },
    first && { title: 'Calculate', meta: 'its equations, live', href: href.machines(first.id, { tab: 'calculate' }) },
    first && { title: 'Check yourself', meta: solvedChecks(first.id).length > 0 ? `${plural(solvedChecks(first.id).length, 'question')} answered right` : 'short questions', href: href.machines(first.id, { tab: 'check' }), done: solvedChecks(first.id).length > 0 },
    firstSim && { title: 'Simulate it', meta: firstSim.label, href: href.workspace(firstSim.lab, firstSim.topic) },
    labs[0] && labs[0].lessons > 0 && { title: 'Guided lessons', meta: `${labs[0].title}`, href: href.workspace(labs[0].id, labs[0].start, 'learn') },
    articles.length > 0 && { title: 'Read the theory', meta: plural(articles.length, 'page'), href: href.guide(articles[0].lab) },
  ].filter(Boolean) as PathStep[]
  return (
    <div className="page subject-page">
      <Crumbs items={[{ label: 'Subjects', href: href.home() }, { label: s.title, href: href.subject(s.id) }, { label: t.title }]} />
      <PageHead title={t.title} lead={t.line} />
      <p className="subject-contains">{containsLine(t)}</p>
      <LearningPath id="t-path" title={first ? `Learning path — start with the ${first.name}` : 'Learning path'} steps={pathSteps} />

      {models.length > 0 && (
        <section className="topic-section" aria-labelledby="t-models">
          <h2 id="t-models" className="group-title">
            3D models
          </h2>
          <p className="small muted">Each model: {MODEL_FEATURES.join(' · ')}.</p>
          <div className="model-list">
            {models.map((m) => {
              const solved = solvedChecks(m.id).length
              return (
                <article key={m.id} className="model-card" aria-labelledby={`m-${m.id}`}>
                  <div className="model-card-text">
                    <h3 id={`m-${m.id}`}>{m.name}</h3>
                    <p className="small">{m.summary}</p>
                    <p className="small muted">
                      {m.role} · {m.supply === 'Static' ? 'static device' : `${m.supply} supply`}
                      {solved > 0 && <span className="model-checked"> · ✓ {plural(solved, 'check question')} answered right</span>}
                    </p>
                  </div>
                  <div className="model-card-actions">
                    <a className="btn btn--primary" href={href.machines(m.id)}>
                      Open in 3D
                    </a>
                    <a className="text-btn" href={href.machines(m.id, { tab: 'learn' })}>
                      How it works
                    </a>
                    <a className="text-btn" href={href.machines(m.id, { tab: 'check' })}>
                      Check
                    </a>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {labs.length > 0 && (
        <section className="topic-section" aria-labelledby="t-labs">
          <h2 id="t-labs" className="group-title">
            Circuit lab
          </h2>
          <div className="subject-topic-grid">
            {labs.map((l) => {
              const done = Math.min(lessonsDoneIn(l, progress), l.lessons)
              const sims2 = l.topics.filter((x) => x.status === 'ready' && !x.opens)
              return (
                <a key={l.id} className="subject-topic-card" href={href.lab(l.id)}>
                  <span className="topic-title">{l.title}</span>
                  <span className="topic-line">{l.tagline}</span>
                  <span className="subject-topic-contains">
                    {sims2.map((x) => x.name ?? x.title).join(' · ')} — {plural(l.lessons, 'guided lesson')}
                    {done > 0 && ` · ${done} done`}
                  </span>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {sims.size > 0 && (
        <section className="topic-section" aria-labelledby="t-sims">
          <h2 id="t-sims" className="group-title">
            Simulate it
          </h2>
          <ul className="topic-links">
            {[...sims.values()].map((w) => (
              <li key={`${w.lab}/${w.topic}`}>
                <a href={href.workspace(w.lab, w.topic)}>
                  {w.label} <Icon name="arrow" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {articles.length > 0 && (
        <section className="topic-section" aria-labelledby="t-theory">
          <h2 id="t-theory" className="group-title">
            Theory
          </h2>
          <ul className="topic-links">
            {articles.map((a) => (
              <li key={`${a.lab}/${a.id}`}>
                <a href={href.guide(a.lab, a.id)}>{a.title}</a> <span className="muted small">— {a.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {relatedLabs.length > 0 && (
        <p className="small muted">
          Related:{' '}
          {relatedLabs.map((l, k) => (
            <span key={l.id}>
              {k > 0 && ' · '}
              <a href={href.lab(l.id)}>{l.title}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
