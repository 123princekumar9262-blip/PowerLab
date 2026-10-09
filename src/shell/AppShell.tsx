import { useEffect, useRef, useState } from 'react'
import { fullName, labById, topicOf } from '../catalogue/catalogue.ts'
import { search, type SearchEntry } from '../catalogue/search.ts'
import { EngineeringPage, HomePage, LabLandingPage, LabsPage, NotFoundPage, ProgressPage, SettingsPage } from './pages.tsx'
import { href, navigate, useRoute, type Route } from './router.ts'
import { StatusTag } from './ui.tsx'
import { WorkspacePage } from './WorkspacePage.tsx'

type Section = 'home' | 'labs' | 'engineering' | 'progress' | 'settings' | null

const sectionOf = (r: Route): Section =>
  r.page === 'home' ? 'home' : r.page === 'labs' || r.page === 'lab' || r.page === 'workspace' ? 'labs' : r.page === 'engineering' ? 'engineering' : r.page === 'progress' ? 'progress' : r.page === 'settings' ? 'settings' : null

const NAV: Array<{ id: Exclude<Section, null | 'settings'>; label: string; href: string }> = [
  { id: 'home', label: 'Home', href: href.home() },
  { id: 'labs', label: 'Labs', href: href.labs() },
  { id: 'engineering', label: 'Practice', href: href.engineering() },
  { id: 'progress', label: 'Progress', href: href.progress() },
]

function titleOf(r: Route): string {
  const app = 'Power Electronics Lab'
  switch (r.page) {
    case 'home':
      return app
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
    case 'progress':
      return `Progress · ${app}`
    case 'settings':
      return `Settings · ${app}`
    default:
      return `Not found · ${app}`
  }
}

/**
 * The platform shell: one top bar (Home · Labs · Practice · Progress · Search · Settings) and the
 * page for the current route. Pages render from the catalogue; workspaces load lazily.
 */
export function AppShell() {
  const { route, nav } = useRoute()
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const section = sectionOf(route)

  // a navigation lands at the top of the new page, with its title announced and focus on its heading
  useEffect(() => {
    document.title = titleOf(route)
    setMenuOpen(false)
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let page
  switch (route.page) {
    case 'home':
      page = <HomePage />
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
    <>
      <button className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <header className="shell-bar">
        <a className="shell-brand" href={href.home()}>
          <span className="shell-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M3 16h8M21 16h8" />
              <path className="brand-tri" d="M11 9v14l10-7z" />
              <path d="M21 9v14" />
            </svg>
          </span>
          <span className="shell-name">Power Electronics Lab</span>
        </a>
        <nav className="shell-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.id} href={n.href} className={section === n.id ? 'on' : ''} aria-current={section === n.id ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="shell-actions">
          <button className="shell-search" onClick={() => setSearchOpen(true)} aria-label="Search (Ctrl K)">
            <span aria-hidden="true">⌕</span>
            <span className="shell-search-text">Search</span>
            <kbd className="shell-kbd">Ctrl K</kbd>
          </button>
          <a className={`shell-icon ${section === 'settings' ? 'on' : ''}`} href={href.settings()} aria-label="Settings" aria-current={section === 'settings' ? 'page' : undefined} title="Settings">
            ⚙
          </a>
          <button className="shell-icon shell-menu-btn" aria-label="Menu" aria-expanded={menuOpen} aria-controls="shell-menu" onClick={() => setMenuOpen(!menuOpen)}>
            ☰
          </button>
        </div>
      </header>
      {menuOpen && (
        <div className="menu-sheet" id="shell-menu">
          <nav aria-label="Main (menu)">
            {NAV.map((n) => (
              <a key={n.id} href={n.href} aria-current={section === n.id ? 'page' : undefined} className={section === n.id ? 'on' : ''}>
                {n.label}
              </a>
            ))}
            <a href={href.settings()} aria-current={section === 'settings' ? 'page' : undefined} className={section === 'settings' ? 'on' : ''}>
              Settings
            </a>
          </nav>
        </div>
      )}
      {/* a workspace brings its own <main> (circuit and instruments); the shell must not nest a second one */}
      {route.page === 'workspace' ? (
        <div id="main" tabIndex={-1} className="shell-main shell-main--workspace">
          {page}
        </div>
      ) : (
        <main id="main" tabIndex={-1} className="shell-main">
          {page}
        </main>
      )}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </>
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
                    {r.context} · {r.detail}
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
