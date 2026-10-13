import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { fullName, labById, topicOf } from '../catalogue/catalogue.ts'
import { search, type SearchEntry } from '../catalogue/search.ts'
import { GuidePage } from './guide.tsx'
import { Icon, type IconName } from './icons.tsx'
import { EngineeringPage, HomePage, LabLandingPage, LabsPage, NotFoundPage, ProgressPage, SettingsPage } from './pages.tsx'
import { SubjectRoute } from './subjects.tsx'
import { homeOfLab, homeOfMachine, subjectById, SUBJECTS, topicHref } from '../catalogue/subjects.ts'
import { LEVELS, setLevel, useLevel, type Level } from './prefs.ts'
import { lessonsDoneIn, useProgress } from './progress.ts'
import { moduleProgress, usePsProgress } from '../powersys/progress.ts'
import { href, navigate, useRoute, type Route } from './router.ts'
import { StatusTag } from './ui.tsx'
import { WorkspacePage } from './WorkspacePage.tsx'
import type { MachinesView } from '../machines/pages.tsx'

/** The 3D Machines Lab loads only when it is opened (its 3D code even later, with a machine). */
const MachinesSection = lazy(() => import('../machines/pages.tsx'))
function machinesView(sub: string | null, query: Record<string, string>): MachinesView {
  if (!sub) return { view: 'overview' }
  if (sub === 'compare') return { view: 'compare', ids: (query.m ?? '').split(',').filter(Boolean) }
  if (sub === 'checks') return { view: 'checks' }
  return { view: 'machine', id: sub, tab: query.tab }
}

type Section = 'home' | 'labs' | 'machines' | 'engineering' | 'guide' | 'progress' | 'settings' | null

const sectionOf = (r: Route): Section =>
  r.page === 'home' || r.page === 'subject'
    ? 'home'
    : r.page === 'labs' || r.page === 'lab' || r.page === 'workspace'
      ? 'labs'
      : r.page === 'machines'
        ? 'machines'
        : r.page === 'engineering'
        ? 'engineering'
        : r.page === 'guide'
          ? 'guide'
          : r.page === 'progress'
            ? 'progress'
            : r.page === 'settings'
              ? 'settings'
              : null

function titleOf(r: Route): string {
  const app = 'Power Electronics Lab'
  switch (r.page) {
    case 'home':
      return app
    case 'subject': {
      const s = subjectById(r.subject)
      const t = s && r.topic ? s.topics.find((x) => x.id === r.topic) : null
      return `${t ? `${t.title} — ` : ''}${s?.title ?? 'Subject'} · ${app}`
    }
    case 'labs':
      return `Labs · ${app}`
    case 'lab':
      return `${labById(r.lab)?.title ?? 'Lab'} · ${app}`
    case 'workspace': {
      const lab = labById(r.lab)
      const t = lab && topicOf(lab, r.topic)
      return `${t ? fullName(t) : 'Workspace'} — ${lab?.title ?? ''} · ${app}`
    }
    case 'engineering':
      return `Practice · ${app}`
    case 'machines':
      return `3D Machines Lab · ${app}`
    case 'guide':
      return `${r.lab ? `${labById(r.lab)?.title ?? 'Lab'} guide` : 'Lab guide'} · ${app}`
    case 'progress':
      return `Progress · ${app}`
    case 'settings':
      return `Help & settings · ${app}`
    default:
      return `Not found · ${app}`
  }
}

/**
 * The platform shell: a left sidebar (the app's sections and every lab, grouped) beside a slim top bar
 * (search, detail level) and the page for the current route. Inside a lab workspace the sidebar folds to
 * an icon rail, so the circuit keeps its width; the rail opens the full sidebar over the page. Below
 * 900 px the sidebar is a drawer behind the menu button. Pages render from the catalogue; workspaces load
 * lazily.
 */
export function AppShell() {
  const { route, nav } = useRoute()
  const [searchOpen, setSearchOpen] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const section = sectionOf(route)
  const inWorkspace = route.page === 'workspace'
  const activeLab = route.page === 'lab' || route.page === 'workspace' || route.page === 'guide' ? route.lab : null
  // where the page sits in the subjects: the subject and topic the sidebar marks
  const place = route.page === 'subject' ? { subject: route.subject, topic: route.topic } : activeLab ? placeOf(homeOfLab(activeLab)) : route.page === 'machines' ? (route.sub ? placeOf(homeOfMachine(route.sub)) : null) ?? { subject: 'machines', topic: null } : null

  // a navigation lands at the top of the new page, with its title announced and focus on its heading
  useEffect(() => {
    document.title = titleOf(route)
    setDrawer(false)
    window.scrollTo(0, 0)
    if (nav > 0) {
      const h = document.querySelector<HTMLElement>('#main h1')
      ;(h ?? document.getElementById('main'))?.focus({ preventScroll: true })
    }
  }, [nav]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === 'Escape') setDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let page
  switch (route.page) {
    case 'home':
      page = <HomePage />
      break
    case 'subject':
      page = <SubjectRoute key={`${route.subject}/${route.topic ?? ''}`} subject={route.subject} topic={route.topic} query={route.query} />
      break
    case 'labs':
      page = <LabsPage />
      break
    case 'lab': {
      const lab = labById(route.lab)
      page = lab ? <LabLandingPage lab={lab} query={route.query} /> : <NotFoundPage path={`/labs/${route.lab}`} />
      break
    }
    case 'workspace':
      page = <WorkspacePage key={nav} labId={route.lab} topicId={route.topic} mode={route.mode} query={route.query} />
      break
    case 'engineering':
      page = <EngineeringPage area={route.area} />
      break
    case 'machines':
      page = (
        <Suspense fallback={<div className="ws-loading" role="status">Loading the 3D Machines Lab…</div>}>
          <MachinesSection route={machinesView(route.sub, route.query)} />
        </Suspense>
      )
      break
    case 'guide':
      page = <GuidePage lab={route.lab} section={route.section} />
      break
    case 'progress':
      page = <ProgressPage />
      break
    case 'settings':
      page = <SettingsPage />
      break
    default:
      page = <NotFoundPage path={route.path} />
  }

  return (
    <div className={`app-frame ${inWorkspace ? 'app-frame--rail' : ''}`}>
      <button className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <SideNav section={section} place={place} rail={inWorkspace} open={drawer} onToggle={() => setDrawer(!drawer)} onClose={() => setDrawer(false)} />
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <div className="app-col">
        <header className="shell-bar">
          <button className="shell-icon shell-menu-btn" aria-label="Menu" aria-expanded={drawer} aria-controls="side-nav" onClick={() => setDrawer(!drawer)}>
            <Icon name="menu" />
          </button>
          <a className="shell-brand shell-brand--bar" href={href.home()}>
            <BrandMark />
            <span className="shell-name">Power Electronics Lab</span>
          </a>
          <button className="shell-search" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl K)">
            <Icon name="search" />
            <span className="shell-search-text">Search labs, circuits, lessons</span>
            <kbd className="shell-kbd">Ctrl K</kbd>
          </button>
          <div className="shell-actions">{!inWorkspace && <LevelMenu />}</div>
        </header>
        {/* a workspace brings its own <main> (circuit and instruments); the shell must not nest a second one */}
        {inWorkspace ? (
          <div id="main" tabIndex={-1} className="shell-main shell-main--workspace">
            {page}
          </div>
        ) : (
          <main id="main" tabIndex={-1} className="shell-main">
            {page}
          </main>
        )}
      </div>
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

function BrandMark() {
  return (
    <span className="shell-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M3 16h8M21 16h8" />
        <path className="brand-tri" d="M11 9v14l10-7z" />
        <path d="M21 9v14" />
      </svg>
    </span>
  )
}

type NavItem = { id: Exclude<Section, null>; label: string; icon: IconName; href: string }
const MAIN_NAV: NavItem[] = [{ id: 'home', label: 'Home', icon: 'home', href: href.home() }]
const SUBJECT_ICON: Record<string, IconName> = { 'power-electronics': 'labs', machines: 'machines', 'power-systems': 'grid' }
type Place = { subject: string; topic: string | null } | null
const placeOf = (h: ReturnType<typeof homeOfLab>): Place => (h ? { subject: h.subject.id, topic: h.topic.id } : null)
const LEARN_NAV: NavItem[] = [
  { id: 'engineering', label: 'Practice', icon: 'practice', href: href.engineering() },
  { id: 'guide', label: 'Lab guide', icon: 'guide', href: href.guide() },
  { id: 'progress', label: 'Progress', icon: 'progress', href: href.progress() },
]
const SETTINGS_NAV: NavItem = { id: 'settings', label: 'Help & settings', icon: 'settings', href: href.settings() }

/**
 * The sidebar: brand, Home (the Subject Library), each subject with its topics (lessons done of lessons available,
 * from stored progress, where a topic has lessons), Practice · Lab guide · Progress, Help & settings at the foot.
 * The subject and topic of the current page are marked. As a rail it keeps the icons only; its toggle opens the
 * full sidebar over the page (Esc, the scrim or any link closes it).
 */
function SideNav({ section, place, rail, open, onToggle, onClose }: { section: Section; place: Place; rail: boolean; open: boolean; onToggle(): void; onClose(): void }) {
  const progress = useProgress()
  const ps = usePsProgress()
  const folded = rail && !open
  const item = (n: NavItem) => {
    const on = section === n.id && !(n.id === 'home' && place)
    return (
      <a key={n.id} href={n.href} className={`side-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined} title={folded ? n.label : undefined} onClick={onClose}>
        <Icon name={n.icon} />
        <span className="side-label">{n.label}</span>
      </a>
    )
  }
  return (
    <aside id="side-nav" className={`side-nav ${rail ? 'side-nav--rail' : ''} ${open ? 'is-open' : ''}`} aria-label="Main">
      <div className="side-top">
        <a className="shell-brand" href={href.home()} title={folded ? 'Power Electronics Lab' : undefined} onClick={onClose}>
          <BrandMark />
          <span className="shell-name side-label">Power Electronics Lab</span>
        </a>
        {rail && (
          <button className="shell-icon side-toggle" onClick={onToggle} aria-expanded={open} aria-controls="side-nav" aria-label={open ? 'Close the sidebar' : 'Open the sidebar'} title={open ? 'Close the sidebar' : 'Open the sidebar'}>
            <Icon name={open ? 'collapse' : 'expand'} />
          </button>
        )}
      </div>
      <nav className="side-scroll" aria-label="Subjects and sections">
        <div className="side-group">{MAIN_NAV.map(item)}</div>
        {SUBJECTS.map((s) => {
          const subjectOn = place?.subject === s.id
          const pageIsSubject = subjectOn && section === 'home' && !place?.topic
          return (
            <div key={s.id} className="side-group side-subject-group">
              <a href={href.subject(s.id)} className={`side-item side-subject ${subjectOn ? 'in' : ''} ${pageIsSubject ? 'on' : ''}`} aria-current={pageIsSubject ? 'page' : undefined} title={folded ? s.title : undefined} onClick={onClose}>
                <Icon name={SUBJECT_ICON[s.id] ?? 'labs'} />
                <span className="side-label">{s.title}</span>
              </a>
              <div className="side-labs">
                {s.topics.map((t) => {
                  const labs = (t.labs ?? []).map((id) => labById(id)).filter((l): l is NonNullable<typeof l> => !!l)
                  // a Power Systems module counts its activities; a lab topic its lessons
                  const acts = t.modules?.length ? moduleProgress(ps, t.modules[0]) : null
                  const total = acts ? acts.total : labs.reduce((n, l) => n + l.lessons, 0)
                  const done = acts ? acts.done : labs.reduce((n, l) => n + Math.min(lessonsDoneIn(l, progress), l.lessons), 0)
                  const unit = acts ? 'activities' : 'lessons'
                  const on = subjectOn && place?.topic === t.id
                  return (
                    <a key={t.id} href={topicHref(s, t)} className={`side-lab ${on ? 'on' : ''}`} aria-current={on ? 'location' : undefined} onClick={onClose}>
                      <span className="side-lab-name">{t.title}</span>
                      {total > 0 && (
                        <span className="side-count" title={`${done} of ${total} ${unit} done`}>
                          {done}/{total}
                        </span>
                      )}
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="side-group">
          <p className="side-heading">Learn &amp; practise</p>
          {LEARN_NAV.map(item)}
        </div>
      </nav>
      <div className="side-foot">{item(SETTINGS_NAV)}</div>
    </aside>
  )
}

/** The detail level the labs open with (the same setting as each workspace's own level control). */
function LevelMenu() {
  const level = useLevel()
  return (
    <label className="level-menu">
      <span className="level-menu-label">Detail</span>
      <select value={level} onChange={(e) => setLevel(e.target.value as Level)} aria-label="Detail level the labs open with">
        {LEVELS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const EXAMPLES = ['freewheeling diode', 'buck converter', 'SCR', 'SVPWM', 'commutation overlap', 'THD', 'inductor current']

/** Search over the platform's own content (the catalogue): labs, circuits, topics, concepts, practice. */
function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const back = useRef<Element | null>(document.activeElement)
  const results = search(q)
  useEffect(() => {
    input.current?.focus()
    const ret = back.current
    return () => (ret as HTMLElement | null)?.focus?.()
  }, [])
  useEffect(() => setSel(0), [q])
  const go = (e: SearchEntry) => {
    onClose()
    navigate(e.hash)
  }
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search the labs">
        <input
          ref={input}
          className="palette-input"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={results[sel] ? `pr-${sel}` : undefined}
          placeholder="Search labs, circuits, concepts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(results.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter' && results[sel]) go(results[sel])
          }}
        />
        {q.trim() === '' ? (
          <div className="palette-empty">
            <p className="muted small">Try:</p>
            <div className="palette-examples">
              {EXAMPLES.map((x) => (
                <button key={x} className="chip-btn" onClick={() => setQ(x)}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <p className="palette-empty muted">Nothing in the labs matches “{q}”.</p>
        ) : (
          <ul className="palette-list" id="palette-list" role="listbox" aria-label="Results">
            {results.map((r, k) => (
              <li key={r.hash} id={`pr-${k}`} role="option" aria-selected={k === sel} className={k === sel ? 'on' : ''} onMouseEnter={() => setSel(k)} onClick={() => go(r)}>
                <span className="pr-kind">{r.kind}</span>
                <span className="pr-main">
                  <span className="pr-title">
                    {r.title} <StatusTag status={r.status} quiet />
                  </span>
                  <span className="pr-detail">
                    {r.subject && r.kind !== 'Subject' && <span className="pr-subject">{r.subject} › </span>}
                    {r.context === r.subject ? '' : `${r.context} · `}
                    {r.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="palette-foot small muted">↑ ↓ to choose · Enter to open · Esc to close</p>
      </div>
    </div>
  )
}
