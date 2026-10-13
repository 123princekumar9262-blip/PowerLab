import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { AskPanel } from '../../assist/AskPanel.tsx'
import { href, replace } from '../../shell/router.ts'
import { Crumbs } from '../../shell/ui.tsx'
import { PS_MODULES, psModule } from '../catalog.ts'
import { MODULE_LOADERS } from '../modules/index.ts'
import { isDone, moduleProgress, usePsProgress, visitModule } from '../progress.ts'
import { PS_MODE_LABEL, type ModuleId, type ModuleProps, type PsMode, type PsModuleMeta } from '../types.ts'
import { TutorContext } from './kit.tsx'
import './powersys.css'

/**
 * The page of one Power Systems module (#/subjects/power-systems/:module?mode=…): its header, the modes it offers
 * (Learn · Explore · Experiment · Verify · Practise), its activities and the student's progress in them, the Ask
 * panel (the module tells it what is on screen) and the way to the previous and next modules. A module that is not
 * built yet shows what it will cover — and opens nothing.
 */

const lazyCache = new Map<string, ComponentType<ModuleProps>>()
function moduleComponent(id: ModuleId) {
  let c = lazyCache.get(id)
  if (!c) {
    c = lazy(MODULE_LOADERS[id])
    lazyCache.set(id, c)
  }
  return c
}

export function PsModulePage({ id, mode: rawMode }: { id: string; mode?: string }) {
  const m = psModule(id)
  if (!m) return null
  return m.status === 'ready' ? <ReadyModule m={m} rawMode={rawMode} /> : <PlannedModule m={m} />
}

function ReadyModule({ m, rawMode }: { m: PsModuleMeta; rawMode?: string }) {
  const mode: PsMode = (m.modes as string[]).includes(rawMode ?? '') ? (rawMode as PsMode) : m.modes[0]
  const progress = usePsProgress()
  const { done, total } = moduleProgress(progress, m.id)
  const [askOpen, setAskOpen] = useState(false)
  const ctxFn = useRef<(() => string) | null>(null)
  const tutor = useMemo(() => ({ set: (fn: (() => string) | null) => (ctxFn.current = fn) }), [])
  const setMode = useCallback((next: PsMode) => replace(href.subject('power-systems', m.id, next === m.modes[0] ? undefined : { mode: next })), [m])
  const Module = moduleComponent(m.id)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => visitModule(m.id, mode), [m.id, mode])
  useEffect(() => {
    if (!askOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAskOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [askOpen])

  const context = () =>
    [
      `Subject: Power Systems. Module ${m.n}: ${m.title} — ${m.line}.`,
      `The student is in ${PS_MODE_LABEL[mode]} mode.`,
      ctxFn.current?.() ?? '',
      'Answer as a power-systems tutor: use the numbers on screen, give units, and state assumptions (balanced three-phase, steady state, per-unit bases) where they matter.',
    ]
      .filter(Boolean)
      .join('\n')

  const idx = PS_MODULES.findIndex((x) => x.id === m.id)
  const prev = PS_MODULES[idx - 1]
  const next = PS_MODULES[idx + 1]
  const tabId = (md: PsMode) => `ps-tab-${md}`

  return (
    <TutorContext.Provider value={tutor}>
      <div className="page ps-page">
        <Crumbs items={[{ label: 'Subjects', href: href.home() }, { label: 'Power Systems', href: href.subject('power-systems') }, { label: m.title }]} />
        <header className="ps-head">
          <div>
            <p className="eyebrow">
              Module {m.n} of {PS_MODULES.length}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              {m.title}
            </h1>
            <p className="page-lead">{m.line}</p>
          </div>
          <div className="ps-head-side">
            <details className="ps-acts">
              <summary>
                <span className="ps-acts-count">
                  {done} of {total}
                </span>{' '}
                activities done
              </summary>
              <ul>
                {m.activities.map((a) => (
                  <li key={a.id} className={isDone(progress, m.id, a.id) ? 'is-done' : ''}>
                    <button type="button" className="ps-link" onClick={() => setMode(a.mode)}>
                      <span aria-hidden="true">{isDone(progress, m.id, a.id) ? '✓' : '○'}</span> {a.title}
                    </button>
                    <span className="muted small"> · {PS_MODE_LABEL[a.mode]}</span>
                  </li>
                ))}
              </ul>
            </details>
            <button type="button" className={`btn ps-ask-btn ${askOpen ? 'on' : ''}`} aria-expanded={askOpen} aria-controls="ps-ask" onClick={() => setAskOpen((o) => !o)}>
              Ask a doubt
            </button>
          </div>
        </header>

        <div className="ps-modes" role="tablist" aria-label="Modes">
          {m.modes.map((md) => (
            <button
              key={md}
              id={tabId(md)}
              type="button"
              role="tab"
              aria-selected={md === mode}
              aria-controls="ps-panel"
              tabIndex={md === mode ? 0 : -1}
              className={md === mode ? 'on' : ''}
              onClick={() => setMode(md)}
              onKeyDown={(e) => {
                const i = m.modes.indexOf(md)
                const to = e.key === 'ArrowRight' ? m.modes[(i + 1) % m.modes.length] : e.key === 'ArrowLeft' ? m.modes[(i - 1 + m.modes.length) % m.modes.length] : null
                if (to) {
                  e.preventDefault()
                  setMode(to)
                  requestAnimationFrame(() => document.getElementById(tabId(to))?.focus())
                }
              }}
            >
              {PS_MODE_LABEL[md]}
            </button>
          ))}
        </div>

        <div id="ps-panel" role="tabpanel" aria-labelledby={tabId(mode)} className="ps-panel">
          <Suspense fallback={<p className="muted ps-loading">Loading the module…</p>}>
            <Module mode={mode} setMode={setMode} />
          </Suspense>
        </div>

        <nav className="ps-pager" aria-label="Modules">
          {prev ? (
            <a href={href.subject('power-systems', prev.id)}>
              <span className="eyebrow">← Module {prev.n}</span>
              <span>{prev.title}</span>
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a href={href.subject('power-systems', next.id)} className="ps-pager-next">
              <span className="eyebrow">Module {next.n} →</span>
              <span>{next.title}</span>
            </a>
          )}
        </nav>

        {askOpen && (
          <aside id="ps-ask" className="drawer ps-ask" aria-label="Ask a doubt">
            <div className="ps-ask-head">
              <span>
                <span className="eyebrow">{m.title} · live</span>
                <b>Ask a doubt</b>
              </span>
              <button type="button" className="text-btn" onClick={() => setAskOpen(false)}>
                Close
              </button>
            </div>
            <AskPanel id={`power-systems/${m.id}`} context={context} intro="Ask anything about this module — in English or Hindi. Your question is sent with what is on screen now, so the answer can use these numbers." starters={['Explain what I am seeing on screen', 'Why do these numbers come out like this?', 'इसे हिंदी में समझाइए']} />
          </aside>
        )}
      </div>
    </TutorContext.Provider>
  )
}

function PlannedModule({ m }: { m: PsModuleMeta }) {
  const ready = PS_MODULES.filter((x) => x.status === 'ready')
  return (
    <div className="page ps-page">
      <Crumbs items={[{ label: 'Subjects', href: href.home() }, { label: 'Power Systems', href: href.subject('power-systems') }, { label: m.title }]} />
      <header className="ps-head">
        <div>
          <p className="eyebrow">
            Module {m.n} of {PS_MODULES.length}
          </p>
          <div className="page-title-row">
            <h1 tabIndex={-1}>{m.title}</h1>
            <span className="status status--in-development">Planned</span>
          </div>
          <p className="page-lead">{m.line}</p>
        </div>
      </header>
      <p className="notice">This module is planned and not built yet — nothing here is simulated. {ready.length > 0 && 'These modules are ready:'}</p>
      {ready.length > 0 && (
        <ul className="topic-links">
          {ready.map((r) => (
            <li key={r.id}>
              <a href={href.subject('power-systems', r.id)}>
                Module {r.n} · {r.title}
              </a>{' '}
              <span className="muted small">— {r.line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
