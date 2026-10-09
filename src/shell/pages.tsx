import { useState } from 'react'
import {
  areaById,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  ENGINEERING,
  labById,
  LABS,
  MODE_LABEL,
  targetOf,
  type Lab,
} from '../catalogue/catalogue.ts'
import { loadJSON } from '../utils/storage.ts'
import { LEVELS, setLevel, useLevel } from './prefs.ts'
import { clearProgress, learningPath, lessonsDoneIn, useProgress, type Activity, type PathState } from './progress.ts'
import { href } from './router.ts'
import { Crumbs, LabCard, modesText, PageHead, StatusTag } from './ui.tsx'

const activityHref = (a: Activity) => href.workspace(a.lab, a.topic, a.mode, a.query)
const PATH_MARK: Record<PathState, string> = { done: '✓', recommended: '→', started: '●', open: '○' }
const PATH_TEXT: Record<PathState, string> = { done: 'completed', recommended: 'recommended next', started: 'started', open: '' }

// ── Home ────────────────────────────────────────────────────────────────────

export function HomePage() {
  const progress = useProgress()
  const path = learningPath(progress)
  const next = path.find((p) => p.state === 'recommended')?.lab ?? LABS[0]
  const last = progress.last
  const recent = progress.recent.filter((r) => !last || r.lab !== last.lab || r.topic !== last.topic).slice(0, 3)
  return (
    <div className="page page--home">
      <header className="home-head">
        <h1 tabIndex={-1}>Power Electronics Lab</h1>
        <p className="page-lead">Interactive simulation · learn by seeing · experiment by doing</p>
      </header>

      {last ? (
        <section className="hero" aria-label="Continue learning">
          <p className="eyebrow">Continue learning</p>
          <h2 className="hero-title">{last.title}</h2>
          <p className="hero-meta">
            {last.labTitle} · {MODE_LABEL[last.mode]}
            {last.lesson && (
              <>
                {' '}
                · {last.lesson.title} — step {last.lesson.step + 1} of {last.lesson.of}
              </>
            )}
          </p>
          <a className="btn btn--primary" href={activityHref(last)}>
            Continue
          </a>
        </section>
      ) : (
        <section className="hero" aria-label="Start here">
          <p className="eyebrow">Start here</p>
          <h2 className="hero-title">Explore your first power-electronics circuit.</h2>
          <p className="hero-meta">A half-wave rectifier: one diode, one source, one load. Change a value, watch the waveforms, and press WHY to see what the circuit is doing.</p>
          <a className="btn btn--primary" href={href.workspace('rectifiers', labById('rectifiers')!.start)}>
            Start learning
          </a>
        </section>
      )}

      <section className="home-section" aria-labelledby="h-learn">
        <h2 id="h-learn" className="section-title">
          Which circuit do you want to learn today?
        </h2>
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="lab-group">
            <h3 className="group-title">{CATEGORY_LABEL[cat]}</h3>
            <div className="lab-grid lab-grid--compact">
              {LABS.filter((l) => l.category === cat).map((l) => (
                <LabCard key={l.id} lab={l} compact />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="home-section" aria-labelledby="h-path">
        <div className="section-row">
          <h2 id="h-path" className="section-title">
            Your learning path
          </h2>
          <span className="muted small">A recommendation — every lab can be opened at any time.</span>
        </div>
        <ol className="lpath lpath--compact">
          {path.map((p) => (
            <li key={p.lab.id} className={`lpath-step lpath-step--${p.state}`}>
              <a href={href.lab(p.lab.id)}>
                <span className="lpath-mark" aria-hidden="true">
                  {PATH_MARK[p.state]}
                </span>
                {p.lab.title}
                {p.state !== 'open' && <span className="sr-only"> ({PATH_TEXT[p.state]})</span>}
              </a>
            </li>
          ))}
        </ol>
        {next && (
          <p className="small muted">
            Recommended next: <a href={href.lab(next.id)}>{next.title}</a>
          </p>
        )}
      </section>

      {recent.length > 0 && (
        <section className="home-section" aria-labelledby="h-recent">
          <h2 id="h-recent" className="section-title">
            Recent
          </h2>
          <ul className="recent">
            {recent.map((r) => (
              <li key={`${r.lab}/${r.topic}`}>
                <a href={activityHref(r)}>
                  {r.title} <span className="muted">· {r.labTitle}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ── Labs catalogue ──────────────────────────────────────────────────────────

const labDetail = (lab: Lab) => {
  const ready = lab.topics.filter((t) => t.status === 'ready' && !t.opens).length
  const soon = lab.topics.filter((t) => t.status === 'coming-soon').length
  return `${ready} ready${soon ? ` · ${soon} coming soon` : ''} · ${lab.lessons} lesson${lab.lessons === 1 ? '' : 's'}`
}

export function LabsPage() {
  return (
    <div className="page">
      <PageHead title="Labs" lead="Every laboratory of the platform. Open any lab directly — the learning path is only a recommendation." />
      {CATEGORY_ORDER.map((cat) => (
        <section key={cat} className="lab-group" aria-labelledby={`g-${cat}`}>
          <h2 id={`g-${cat}`} className="group-title">
            {CATEGORY_LABEL[cat]}
          </h2>
          <div className="lab-grid">
            {LABS.filter((l) => l.category === cat).map((l) => (
              <LabCard key={l.id} lab={l} detail={labDetail(l)} />
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
  const done = lessonsDoneIn(lab, progress)
  const related = (lab.related ?? []).map((id) => labById(id)).filter((l): l is Lab => !!l)
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Labs', href: href.labs() }, { label: lab.title }]} />
      <PageHead title={lab.title} lead={lab.description} side={<StatusTag status={lab.status} />} />
      {query.moved === 'engineering' && (
        <p className="notice" role="status">
          This lab used to be called “Engineering”. Engineering is now the <a href={href.engineering()}>practice area</a> (design, challenges, reverse engineering).
        </p>
      )}
      {lab.chain && (
        <ol className="chain" aria-label="System">
          {lab.chain.map((c, k) => (
            <li key={c} className="chain-step">
              {k > 0 && (
                <span className="chain-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <span className="chain-box">{c}</span>
            </li>
          ))}
        </ol>
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
              {items.map((t) => {
                if (t.status !== 'ready')
                  return (
                    <div key={t.id} className="topic-card topic-card--soon" aria-label={`${t.title}, coming soon`}>
                      <span className="topic-title">
                        {t.title} <StatusTag status={t.status} />
                      </span>
                      <span className="topic-line">{t.purpose}</span>
                    </div>
                  )
                const tg = targetOf(lab, t)
                return (
                  <a key={t.id} className="topic-card" href={href.workspace(tg.lab, tg.topic, tg.mode, tg.query)}>
                    <span className="topic-title">{t.title}</span>
                    <span className="topic-line">{t.purpose}</span>
                  </a>
                )
              })}
            </div>
          </section>
        )
      })}
      <footer className="lab-foot small muted">
        <p>
          {lab.lessons} guided lesson{lab.lessons === 1 ? '' : 's'} in Learn{done > 0 ? ` (${Math.min(done, lab.lessons)} done)` : ''} · Modes: {modesText(lab)}
        </p>
        {related.length > 0 && (
          <p>
            Related:{' '}
            {related.map((r, k) => (
              <span key={r.id}>
                {k > 0 && ' · '}
                <a href={href.lab(r.id)}>{r.title}</a>
              </span>
            ))}
          </p>
        )}
      </footer>
    </div>
  )
}

// ── Engineering ─────────────────────────────────────────────────────────────

export function EngineeringPage({ area }: { area: string | null }) {
  const a = area ? areaById(area) : null
  if (area && !a) return <NotFoundPage path={`/engineering/${area}`} />
  if (a) {
    const opens = a.opens
    return (
      <div className="page page--narrow">
        <Crumbs items={[{ label: 'Engineering', href: href.engineering() }, { label: a.title }]} />
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
      <PageHead title="Engineering" lead="Practice like an engineer: design, diagnose and explain. For students who already know the labs." />
      <div className="area-list">
        {ENGINEERING.map((x) => (
          <a key={x.id} className="area-row" href={href.engineering(x.id)}>
            <span className="area-title">
              {x.title} <StatusTag status={x.status} />
            </span>
            <span className="area-line">{x.purpose}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Progress ────────────────────────────────────────────────────────────────

export function ProgressPage() {
  const progress = useProgress()
  const path = learningPath(progress)
  const stars = loadJSON<Record<string, number>>('rectifier-lab.challenges', {})
  const solved = Object.values(stars).filter((v) => v > 0).length
  return (
    <div className="page page--narrow">
      <PageHead title="Progress" lead="Kept on this device only. The path is a recommendation — open any lab at any time." />
      <section aria-labelledby="p-path">
        <h2 id="p-path" className="group-title">
          Learning path
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
                <span className="lpath-meta">
                  {Math.min(p.done, p.lab.lessons)} of {p.lab.lessons} lessons
                  {p.state !== 'open' ? ` · ${PATH_TEXT[p.state]}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="p-recent">
        <h2 id="p-recent" className="group-title">
          Recently opened
        </h2>
        {progress.recent.length ? (
          <ul className="recent">
            {progress.recent.map((r) => (
              <li key={`${r.lab}/${r.topic}`}>
                <a href={activityHref(r)}>
                  {r.title} <span className="muted">· {r.labTitle}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing yet — open a lab and it will appear here.</p>
        )}
      </section>
      <section aria-labelledby="p-practice">
        <h2 id="p-practice" className="group-title">
          Practice
        </h2>
        <p>
          Rectifier challenges solved: {solved} of 9 · <a href={href.engineering('challenge')}>Challenge</a>
        </p>
      </section>
      <p className="small muted">
        To start over, use <a href={href.settings()}>Settings → Reset progress</a>.
      </p>
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const level = useLevel()
  const [cleared, setCleared] = useState(false)
  return (
    <div className="page page--narrow">
      <PageHead title="Settings" />
      <section aria-labelledby="set-level">
        <h2 id="set-level" className="group-title">
          Information level
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
      <section aria-labelledby="set-progress">
        <h2 id="set-progress" className="group-title">
          Progress
        </h2>
        <p className="muted small">Progress (last activity, recent labs, finished lessons) is stored in this browser only.</p>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm('Forget your progress on this device?')) {
              clearProgress()
              setCleared(true)
            }
          }}
        >
          Reset progress
        </button>
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
