import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LEVELS, type Level } from '../shell/prefs.ts'
import { loadJSON, saveJSON } from '../utils/storage.ts'

/**
 * THE UNIVERSAL WORKSPACE SHELL — layout only. It knows no physics: a lab fills its regions (parameters,
 * circuit, status, waveforms), gives its WHY panel and the tools of its Explore menu (contract.ts shapes,
 * rendered by views.tsx); the shell arranges them for the screen and hosts the overlays.
 *
 *   desktop (>= 1024) [parameters] [circuit · status · WHY / Explore] [side panel, only while one is open]
 *                     waveforms (full width)
 *   tablet (768-1023) circuit · status · WHY / Explore · waveforms; parameters and panels as side drawers
 *   phone (< 768)     circuit · status · waveform; a sticky bar (Parameters · WHY · Explore); bottom sheets
 *
 * The same panels in every presentation — only where they appear changes.
 */
export type Presentation = 'desktop' | 'tablet' | 'phone'

const query = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)
function readPresentation(): Presentation {
  return query('(min-width: 1024px)') ? 'desktop' : query('(min-width: 768px)') ? 'tablet' : 'phone'
}
export function usePresentation(): Presentation {
  return useSyncExternalStore(
    (cb) => {
      const lists = ['(min-width: 1024px)', '(min-width: 768px)'].map((q) => window.matchMedia(q))
      lists.forEach((l) => l.addEventListener('change', cb))
      return () => lists.forEach((l) => l.removeEventListener('change', cb))
    },
    readPresentation,
    () => 'desktop',
  )
}

/** A tool in the Explore menu: a panel to open, or a toggle (e.g. the current-path overlay). */
export interface ExploreItem {
  id: string
  label: string
  icon: string
  kind: 'panel' | 'toggle'
  /** The panel it opens (kind 'panel'). */
  target?: string
  pressed?: boolean
  /** A warning shown beside it (e.g. a failed theory check). */
  badge?: string
  run?(): void
  /** Steps aside in Focus view (analysis, events, energy, learning lists). */
  secondary?: boolean
}

export interface ShellPanel {
  title: string
  eyebrow?: string
  /** Wide panels (tables) dock under the circuit on desktop instead of in the side column. */
  wide?: boolean
  render(): ReactNode
}

export interface ShellHeader {
  back: { href: string; label: string }
  lab: string
  title: string
  /** The lab's other circuits; `group` (optional) heads a section of the menu. */
  siblings: Array<{ id: string; label: string; href: string; current: boolean; group?: string }>
  /** The everyday modes, as tabs (`hint`: what the mode is for, in plain words). */
  modes: Array<{ id: string; label: string; hint?: string }>
  /** Further practice modes, in a small "More" menu. */
  moreModes?: Array<{ id: string; label: string; hint?: string }>
  mode: string
  onMode(id: string): void
  level: Level
  onLevel(l: Level): void
}

export interface WorkspaceShellProps {
  header: ShellHeader
  params: ReactNode
  circuit: ReactNode
  status: ReactNode
  waveform: ReactNode
  /** WHY — the primary learning action, beside the circuit (null while a mode hides the answers). */
  why: ShellPanel | null
  /** Everything else, behind one Explore menu. */
  explore: ExploreItem[]
  panels: Record<string, ShellPanel>
  /** The open panel ('why' or a key of `panels`), owned by the lab so the circuit can open the inspector. */
  open: string | null
  onOpen(id: string | null): void
  /** The current mode's own panel (a lesson, an experiment…): shown while that mode is active. */
  activity?: ShellPanel | null
  focus: boolean
  onFocus(on: boolean): void
  /** A short message under the header (e.g. which values were kept when the circuit changed). */
  notice?: ReactNode
  /** Changes only when the simulation runs again (cursor moves keep it): exposed for tests. */
  runId?: number
  /** Full-width content that replaces the regions under the header (e.g. a side-by-side comparison). */
  body?: ReactNode
}

export function WorkspaceShell(props: WorkspaceShellProps) {
  const pres = usePresentation()
  const { header, open, onOpen, panels, focus } = props
  const [paramsOpen, setParamsOpen] = useState(false)
  // "How this lab works": open on a first visit, then on demand (the header's "How to use")
  // (the app targets laptops: a phone-width window gets no guide)
  const [guideOn, setGuide] = useState(() => !loadJSON<Record<string, boolean>>(GUIDE_KEY, {}).workspace)
  const guide = guideOn && pres !== 'phone'
  const closeGuide = () => {
    setGuide(false)
    saveJSON(GUIDE_KEY, { ...loadJSON<Record<string, boolean>>(GUIDE_KEY, {}), workspace: true })
  }
  const mark = (n: number) => (guide && !props.body ? <GuideMark n={n} /> : null)
  useEffect(() => {
    if (pres === 'desktop') setParamsOpen(false)
  }, [pres])
  const panel: ShellPanel | null = open === 'why' ? props.why : open ? (panels[open] ?? null) : null
  const items: ExploreItem[] = [...(focus ? props.explore.filter((i) => !i.secondary) : props.explore), { id: 'focus', label: 'Focus view', icon: '◎', kind: 'toggle', pressed: focus, run: () => props.onFocus(!focus) }]
  const runItem = (i: ExploreItem) => {
    if (i.kind === 'toggle') return i.run?.()
    setParamsOpen(false)
    onOpen(open === i.target ? null : i.target!)
  }
  const toggleWhy = () => {
    setParamsOpen(false)
    onOpen(open === 'why' ? null : 'why')
  }
  const toggleParams = () => {
    onOpen(null)
    setParamsOpen(!paramsOpen)
  }

  if (props.body)
    return (
      <main className={`ws ws--${pres} ws--full`} data-run-id={props.runId}>
        <WorkspaceHeader h={header} pres={pres} guide={guide} onGuide={() => (guide ? closeGuide() : setGuide(true))} />
        {props.notice}
        <section className="ws-full" aria-label={header.title}>
          {props.body}
        </section>
      </main>
    )

  const small = pres !== 'desktop'
  const sidePanel = panel && !(pres === 'desktop' && panel.wide) ? panel : null
  // desktop: a third column only while something is open in it (a panel, or the current mode's activity)
  const side = pres === 'desktop' && !!(sidePanel || props.activity)
  const actions = <ActionBar whyOpen={open === 'why'} onWhy={props.why ? toggleWhy : undefined} items={items} openPanel={open} onItem={runItem} sticky={pres === 'phone'} onParams={pres === 'phone' ? toggleParams : undefined} paramsOpen={paramsOpen} mark={guide && props.why ? 4 : null} />
  return (
    <main className={`ws ws--${pres} ${focus ? 'ws--focus' : ''} ${side ? 'ws--side' : ''} ${guide ? 'ws--guide' : ''}`} data-run-id={props.runId}>
      <WorkspaceHeader h={header} pres={pres} onParams={pres === 'tablet' ? toggleParams : undefined} paramsOpen={paramsOpen} guide={guide} onGuide={() => (guide ? closeGuide() : setGuide(true))} />
      {props.notice}
      {guide && <WorkspaceGuide modes={[...header.modes, ...(header.moreModes ?? [])]} why={!!props.why} onClose={closeGuide} />}
      <div className="ws-grid">
        {pres === 'desktop' && !focus && (
          <aside className="ws-params" aria-label="Parameters">
            {mark(1)}
            {props.params}
          </aside>
        )}
        <section className="ws-bench" aria-label="Circuit">
          {mark(2)}
          {props.circuit}
          {props.status}
          {pres !== 'phone' && actions}
          {pres === 'desktop' && panel?.wide && (
            <Overlay kind="dock" title={panel.title} eyebrow={panel.eyebrow} onClose={() => onOpen(null)} wide>
              {panel.render()}
            </Overlay>
          )}
        </section>
        {side && (
          <aside className="ws-side" aria-label={sidePanel ? sidePanel.title : (props.activity?.title ?? 'Panel')}>
            {sidePanel ? (
              <Overlay kind="dock" title={sidePanel.title} eyebrow={sidePanel.eyebrow} onClose={() => onOpen(null)}>
                {sidePanel.render()}
              </Overlay>
            ) : (
              <Activity panel={props.activity!} />
            )}
          </aside>
        )}
      </div>
      {small && props.activity && <Activity panel={props.activity} inline />}
      <section className="ws-wave" aria-label="Waveforms">
        {mark(3)}
        {props.waveform}
      </section>
      {pres === 'phone' && actions}

      {/* tablets: non-blocking side drawers; phones: modal bottom sheets — the same panels */}
      {small && paramsOpen && (
        <Overlay kind={pres === 'phone' ? 'sheet' : 'drawer'} side="left" title="Parameters" onClose={() => setParamsOpen(false)}>
          {props.params}
          {pres === 'phone' && (
            <div className="ws-sheet-foot">
              <span className="small muted">Information level</span>
              <LevelSelect level={header.level} onLevel={header.onLevel} />
            </div>
          )}
        </Overlay>
      )}
      {small && panel && (
        <Overlay kind={pres === 'phone' ? 'sheet' : 'drawer'} title={panel.title} eyebrow={panel.eyebrow} onClose={() => onOpen(null)} wide={panel.wide}>
          {panel.render()}
        </Overlay>
      )}
    </main>
  )
}

/** Remembers that the guide was read (one flag for every lab; the header's "How to use" reopens it). */
const GUIDE_KEY = 'pel.hints'

/**
 * "How this lab works" — the same four steps in every lab, numbered like the marks on the regions they
 * describe (1 values, 2 circuit, 3 waveforms, 4 WHY), and what each of the lab's modes is for.
 */
function WorkspaceGuide({ modes, why, onClose }: { modes: Array<{ id: string; label: string; hint?: string }>; why: boolean; onClose(): void }) {
  const steps: Array<[string, string]> = [
    ['Set the values', 'Move a slider or type a value. The circuit is simulated again at once — every number and waveform comes from that simulation.'],
    ['Watch the circuit', 'Coloured parts carry current at this instant. Click any part to see what it is doing.'],
    ['Move through time', 'Drag the white cursor along the waveforms. The circuit and the status line show that instant.'],
    ...(why ? [['Ask WHY', 'WHY explains what is happening at the cursor, why it happens, and what comes next.'] as [string, string]] : []),
  ]
  return (
    <section className="ws-guide" aria-label="How this lab works">
      <header className="ws-guide-head">
        <h2>How this lab works</h2>
        <button className="btn btn--primary ws-guide-close" onClick={onClose}>
          Got it
        </button>
      </header>
      <ol className="ws-guide-steps">
        {steps.map(([title, text], k) => (
          <li key={title}>
            <GuideMark n={k + 1} inline />
            <span>
              <b>{title}</b>
              <span className="ws-guide-text">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      {modes.length > 1 && (
        <p className="ws-guide-modes small">
          <b>Modes</b> (top of the page):{' '}
          {modes.map((m, k) => (
            <span key={m.id}>
              {k > 0 && ' · '}
              <b>{m.label}</b>
              {m.hint ? ` — ${m.hint}` : ''}
            </span>
          ))}
          . <b>Detail</b> (top right) sets how much each panel shows.
        </p>
      )}
    </section>
  )
}

/** A step number on the region the guide describes. */
function GuideMark({ n, inline }: { n: number; inline?: boolean }) {
  return (
    <span className={`ws-mark ${inline ? 'ws-mark--inline' : ''}`} aria-hidden="true">
      {n}
    </span>
  )
}

/**
 * The workspace's frame while its first simulation runs. No <h1>: focus and the browser checks wait for the
 * real header. The spinner turns on the compositor, so it keeps moving while the circuit is solved.
 */
export function WorkspaceBoot({ lab, title }: { lab: string; title: string }) {
  return (
    <div className="ws-boot" role="status">
      <p className="eyebrow">{lab}</p>
      <p className="ws-boot-title">{title}</p>
      <p className="ws-boot-line">
        <span className="ws-boot-spin" aria-hidden="true" /> Simulating the circuit…
      </p>
    </div>
  )
}

/** The current mode's panel (lesson, experiment…): part of the page, not an overlay. */
function Activity({ panel, inline }: { panel: ShellPanel; inline?: boolean }) {
  return (
    <section className={`ws-activity ${inline ? 'ws-activity--inline' : ''}`} aria-label={panel.title}>
      <header className="ws-activity-head">
        {panel.eyebrow && <p className="eyebrow">{panel.eyebrow}</p>}
        <h2>{panel.title}</h2>
      </header>
      <div className="ws-activity-body">{panel.render()}</div>
    </section>
  )
}

function WorkspaceHeader({ h, pres, onParams, paramsOpen = false, guide, onGuide }: { h: ShellHeader; pres: Presentation; onParams?(): void; paramsOpen?: boolean; guide: boolean; onGuide(): void }) {
  const inMore = h.moreModes?.find((m) => m.id === h.mode)
  return (
    <header className="ws-head">
      <div className="ws-head-row">
        <a className="ws-back-link" href={h.back.href} aria-label={`Back to ${h.back.label}`}>
          ← <span className="ws-back-text">{h.back.label}</span>
        </a>
        <div className="ws-title">
          <p className="eyebrow ws-lab">{h.lab}</p>
          <div className="ws-title-row">
            <h1 tabIndex={-1}>{h.title}</h1>
            {h.siblings.length > 1 && <SwitchMenu siblings={h.siblings} />}
          </div>
        </div>
        <div className="ws-head-tools">
          {onParams && (
            <button className={`ws-tool ${paramsOpen ? 'on' : ''}`} aria-expanded={paramsOpen} onClick={onParams}>
              <span aria-hidden="true">⚙</span> Parameters
            </button>
          )}
          <button className={`ws-tool ws-help ${guide ? 'on' : ''}`} aria-expanded={guide} onClick={onGuide} title="How this lab works">
            <span aria-hidden="true">?</span> How to use
          </button>
          {pres !== 'phone' && <LevelSelect level={h.level} onLevel={h.onLevel} />}
        </div>
      </div>
      <nav className="ws-modes" aria-label="Mode">
        <div role="tablist" aria-label="Mode" className="ws-modes-tabs">
          {h.modes.map((m) => (
            <button key={m.id} role="tab" aria-selected={h.mode === m.id} className={h.mode === m.id ? 'on' : ''} title={m.hint ? `${m.label}: ${m.hint}` : undefined} onClick={() => h.onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {h.moreModes && h.moreModes.length > 0 && (
          <details className="ws-more-modes">
            <summary className={inMore ? 'on' : ''} aria-label={inMore ? `${inMore.label} — more practice modes` : 'More practice modes'}>
              {inMore ? inMore.label : 'More'} ▾
            </summary>
            <ul>
              {h.moreModes.map((m) => (
                <li key={m.id}>
                  <button
                    className={h.mode === m.id ? 'on' : ''}
                    aria-current={h.mode === m.id ? 'true' : undefined}
                    title={m.hint}
                    onClick={(e) => {
                      const d = e.currentTarget.closest('details')
                      if (d) d.open = false
                      h.onMode(m.id)
                    }}
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </nav>
    </header>
  )
}

function LevelSelect({ level, onLevel }: { level: Level; onLevel(l: Level): void }) {
  return (
    <label className="ws-level">
      <span className="ws-level-label">Detail</span>
      <select value={level} onChange={(e) => onLevel(e.target.value as Level)} title="How much each panel shows (also in Settings)" aria-label="Information level">
        {LEVELS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** "Change circuit": the lab's other topics, as links (the address changes, Back works). */
function SwitchMenu({ siblings }: { siblings: ShellHeader['siblings'] }) {
  return (
    <details className="ws-switch-menu">
      <summary aria-label="Change circuit" title="Change circuit">
        ▾
      </summary>
      <ul>
        {siblings.map((s, i) => (
          <li key={s.id}>
            {s.group && s.group !== siblings[i - 1]?.group && <span className="ws-switch-group eyebrow">{s.group}</span>}
            <a href={s.href} aria-current={s.current ? 'page' : undefined} className={s.current ? 'on' : ''}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Two everyday actions — WHY and Explore (plus Parameters on a phone). */
function ActionBar({ whyOpen, onWhy, items, openPanel, onItem, sticky, onParams, paramsOpen, mark }: { whyOpen: boolean; onWhy?(): void; items: ExploreItem[]; openPanel: string | null; onItem(i: ExploreItem): void; sticky: boolean; onParams?(): void; paramsOpen: boolean; mark?: number | null }) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    ref.current?.querySelector<HTMLElement>('[role=menuitem], [role=menuitemcheckbox]')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMenu(false)
      ref.current?.querySelector<HTMLElement>('.ws-explore-btn')?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])
  const warn = items.some((i) => i.badge)
  return (
    <div className={`ws-actions ${sticky ? 'ws-actions--sticky' : ''}`} role="toolbar" aria-label="Explore this instant" ref={ref}>
      {onParams && (
        <button className={`ws-act ${paramsOpen ? 'on' : ''}`} aria-expanded={paramsOpen} onClick={onParams}>
          <span className="ws-act-icon" aria-hidden="true">
            ⚙
          </span>
          <span className="ws-act-label">Parameters</span>
        </button>
      )}
      {onWhy && (
        <button className={`ws-act ws-act--why ${whyOpen ? 'on' : ''}`} aria-expanded={whyOpen} onClick={onWhy}>
          <span className="ws-act-icon" aria-hidden="true">
            ?
          </span>
          <span className="ws-act-label">WHY</span>
        </button>
      )}
      {onWhy && mark ? <GuideMark n={mark} inline /> : null}
      <div className="ws-explore">
        <button className={`ws-act ws-explore-btn ${menu ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <span className="ws-act-icon" aria-hidden="true">
            ☰
          </span>
          <span className="ws-act-label">Explore</span>
          {warn && <span className="ws-act-badge"> ⚠</span>}
        </button>
        {menu && (
          <div className="ws-explore-menu" role="menu" aria-label="Explore">
            {items.map((i) => {
              const on = i.kind === 'toggle' ? !!i.pressed : openPanel === i.target
              return (
                <button
                  key={i.id}
                  role={i.kind === 'toggle' ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={i.kind === 'toggle' ? on : undefined}
                  className={on ? 'on' : ''}
                  onClick={() => {
                    setMenu(false)
                    onItem(i)
                  }}
                >
                  <span className="ws-act-icon" aria-hidden="true">
                    {i.icon}
                  </span>
                  <span className="ws-menu-label">{i.label}</span>
                  {i.kind === 'toggle' && (
                    <span className="ws-check" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                  )}
                  {i.badge && <span className="ws-act-badge">{i.badge}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The overlay host.
 *  dock   — inside the page (desktop): non-blocking; Esc closes; focus moves in and returns.
 *  drawer — fixed side panel (tablet): non-blocking; Esc closes; focus moves in and returns.
 *  sheet  — bottom sheet (phone): modal — backdrop, focus trapped, background inert, Esc or ✕ closes.
 */
export function Overlay({ kind, side = 'right', title, eyebrow, onClose, wide, children }: { kind: 'dock' | 'drawer' | 'sheet'; side?: 'left' | 'right'; title: string; eyebrow?: string; onClose(): void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('.ov-title')?.focus({ preventScroll: kind === 'dock' })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (kind === 'sheet' && e.key === 'Tab' && ref.current) {
        // keep keyboard focus inside the sheet
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null)
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    // document, bubble phase: a menu open above the panel (Explore) handles Esc first and stops it there
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    // a modal sheet makes everything behind it inert (no focus, no screen-reader access) while it is open
    const root = document.getElementById('root')
    if (kind === 'sheet') {
      document.body.style.overflow = 'hidden'
      root?.setAttribute('inert', '')
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      if (kind === 'sheet') {
        document.body.style.overflow = prevOverflow
        root?.removeAttribute('inert')
      }
      if (back && document.contains(back)) back.focus({ preventScroll: true })
    }
  }, [kind])
  const head = (
    <header className="ov-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="ov-title" tabIndex={-1}>
          {title}
        </h2>
      </div>
      <button className="ov-close" onClick={onClose} aria-label={`Close ${title}`} title="Close (Esc)">
        ✕
      </button>
    </header>
  )
  if (kind === 'sheet')
    return createPortal(
      <div className="ov-backdrop ov-portal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="ov ov--sheet" role="dialog" aria-modal="true" aria-label={title}>
          <span className="ov-grip" aria-hidden="true" />
          {head}
          <div className="ov-body">{children}</div>
        </div>
      </div>,
      document.body,
    )
  return (
    <div ref={ref} className={`ov ov--${kind} ${kind === 'drawer' ? `ov--${side}` : ''} ${wide ? 'ov--wide' : ''}`} role={kind === 'drawer' ? 'dialog' : 'region'} aria-modal={kind === 'drawer' ? false : undefined} aria-label={title}>
      {head}
      <div className="ov-body">{children}</div>
    </div>
  )
}
