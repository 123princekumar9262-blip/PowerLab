import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { converterIndexAt } from '../../converters/engine.ts'
import type { Run, RunEvent } from '../../converters/types.ts'
import type { AnyTopic, Density } from '../../lab/types.ts'
import { formatSI, formatTime } from '../../utils/format.ts'
import { AnalyzePanel } from './Analyze.tsx'
import { LabScope, type Viewport } from './LabScope.tsx'
import { ExperimentPanel, LearnPanel, PredictPanel } from './Modes.tsx'
import { Inspector, StateCard, WhyPanel } from './Panels.tsx'
import { SpecList } from './ParamsPanel.tsx'

type Mode = 'explore' | 'learn' | 'experiment' | 'predict' | 'analyze'
type SideTab = 'why' | 'energy' | 'inspect'

const MODES: Array<{ id: Mode; label: string; title: string }> = [
  { id: 'explore', label: 'Explore', title: 'Free exploration: change any parameter, move the cursor, ask why' },
  { id: 'learn', label: 'Learn', title: 'Guided lessons, instant by instant' },
  { id: 'experiment', label: 'Experiment', title: 'Predict → run → result → why; before/after comparison' },
  { id: 'predict', label: 'Predict', title: 'Predict a value, then the simulation answers' },
  { id: 'analyze', label: 'Analyze', title: 'Measurements vs theory, derivation, numerical checks' },
]
const DENSITIES: Array<{ id: Density; label: string; title: string }> = [
  { id: 'beginner', label: 'Beginner', title: 'Circuit, the main channels, the state and WHY' },
  { id: 'standard', label: 'Standard', title: 'Adds values on the circuit, energy, status card and more channels' },
  { id: 'engineer', label: 'Engineer', title: 'Adds every quantity, advanced parameters and numerical details' },
]

export interface TopicEntry {
  topic: AnyTopic | null
  id: string
  label: string
  title: string
}

/**
 * One environment of the platform (DC-DC, PWM, Inverters): a sub-navigation of topics and, for the
 * chosen topic, the five modes with progressive disclosure. Everything shown comes from the topic's
 * simulation; the shell only arranges it.
 */
export function LabShell({ eyebrow, entries, initial }: { eyebrow: string; entries: TopicEntry[]; initial?: string }) {
  const [topicId, setTopicId] = useState(initial ?? entries.find((e) => e.topic)!.id)
  const entry = entries.find((e) => e.id === topicId && e.topic) ?? entries.find((e) => e.topic)!
  const topic = entry.topic!
  return (
    <div className="app dcdc">
      <TopicLab key={topic.id} topic={topic} eyebrow={eyebrow} entries={entries} onTopic={setTopicId} />
    </div>
  )
}

/** Per-topic state survives switching topics. */
const paramStore = new Map<string, object>()

function TopicLab({ topic, eyebrow, entries, onTopic }: { topic: AnyTopic; eyebrow: string; entries: TopicEntry[]; onTopic: (id: string) => void }) {
  const [mode, setMode] = useState<Mode>('explore')
  const [density, setDensity] = useState<Density>('beginner')
  const [params, setParamsRaw] = useState<Record<string, unknown>>(() => ({ ...(paramStore.get(topic.id) ?? topic.defaults) }) as Record<string, unknown>)
  const setParams = (p: Record<string, unknown>) => {
    paramStore.set(topic.id, p)
    setParamsRaw(p)
  }
  const [channels, setChannels] = useState<string[]>(topic.defaultChannels)
  const [layout, setLayout] = useState<'separate' | 'grouped'>('separate')
  const [yMode, setYMode] = useState<'zero' | 'fit'>('zero')
  const [shading, setShading] = useState(true)
  const [cursorTime, setCursorTime] = useState<number | null>(null)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [part, setPart] = useState<string | null>(null)
  const [event, setEvent] = useState<RunEvent | null>(null)
  const [side, setSide] = useState<SideTab>('why')
  const [whyDetailed, setWhyDetailed] = useState(false)
  const [showPath, setShowPath] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [lessonId, setLessonId] = useState<string | null>(null)
  const [lessonStep, setLessonStep] = useState(0)
  const lessonPending = useRef(false)

  const result: Run = useMemo(() => topic.simulate(params), [topic, params])
  const m = useMemo(() => topic.measure(result), [topic, result])
  const p = result.params
  // Only channels this run produces (a topic's variants may have different signals).
  const shown = channels.filter((c) => result.signals[c] && topic.channels[c])
  const addable = topic.addOrder.filter((c) => result.signals[c])
  const t0 = cursorTime ?? topic.initialCursor(result)
  const vp = viewport && viewport.t1 <= p.duration + 1e-12 ? viewport : { t0: 0, t1: p.duration }
  const k = converterIndexAt(result, Math.min(t0, p.duration))
  const st = useMemo(() => topic.state(result, k), [topic, result, k])
  const cards = useMemo(() => topic.why(result, st, m), [topic, result, st, m])
  const view = topic.view(st, result, density)
  const lesson = topic.lessons.find((l) => l.id === lessonId) ?? null

  const change = useCallback(
    (patch: Record<string, unknown>) => {
      const next = { ...params, ...patch }
      const tb = ['fs', 'f1', 'periods', 'view', 'mf'].some((key) => key in patch && patch[key] !== params[key])
      if (tb) {
        setViewport(null)
        setCursorTime(null)
      }
      setParams(next)
      setEvent(null)
    },
    [params], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Lessons drive parameters, channels and cursor; the cursor needs the run of the step's parameters.
  useEffect(() => {
    if (!lesson) return
    const s = lesson.steps[lessonStep]
    setParams({ ...(topic.defaults as object), ...lesson.base, ...s.params })
    setChannels(s.channels)
    setLayout('separate')
    lessonPending.current = true
  }, [lessonId, lessonStep]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!lesson || !lessonPending.current) return
    lessonPending.current = false
    const s = lesson.steps[lessonStep]
    const t = s.at(result as never)
    setCursorTime(t)
    const w = s.window?.(result as never) ?? [Math.max(0, t - p.period), Math.min(p.duration, t + p.period)]
    setViewport({ t0: w[0], t1: w[1] })
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToEvent = (e: RunEvent) => {
    setEvent(e)
    setCursorTime(Math.min(p.duration, (Math.floor(e.time / p.dt + 1e-6) + 1) * p.dt))
  }
  // Keyboard: ← → one sample; Shift + ← → previous/next event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const dir = e.key === 'ArrowRight' ? 1 : -1
      if (e.shiftKey) {
        const t = result.time[k]
        const evs = result.events.filter((x) => (dir > 0 ? x.time > t + p.dt * 0.5 : x.time < t - p.dt * 0.5))
        const target = dir > 0 ? evs[0] : evs[evs.length - 1]
        if (target) jumpToEvent(target)
      } else setCursorTime(result.time[Math.min(result.length - 1, Math.max(0, k + dir))])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const std = density !== 'beginner'
  const eng = density === 'engineer'
  const exitLesson = () => {
    setLessonId(null)
    setLessonStep(0)
    setChannels(topic.defaultChannels)
  }
  const goExplore = (patch: object) => {
    setLessonId(null)
    setParams({ ...params, ...patch, view: 'steady' })
    setViewport(null)
    setCursorTime(null)
    setMode('explore')
  }
  const meta = topic.channels

  const channelBar = (
    <div className="dc-channels" aria-label="Channels">
      {shown.map((c) => (
        <button key={c} className="chip chip--on" title={`${meta[c].name} — click to remove`} onClick={() => setChannels(channels.filter((x) => x !== c))} aria-label={`Remove channel ${meta[c].label}`}>
          <span className="swatch" style={{ background: meta[c].color }} />
          {meta[c].label}
          <span aria-hidden="true" className="chip-x">
            ×
          </span>
        </button>
      ))}
      <span className="add-wrap">
        <button className="chip chip--more" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>
          + Add channel
        </button>
        {addOpen && (
          <div className="add-menu" role="group" aria-label="Add channel">
            {addable.map((c) => (
              <label key={c} className="add-item">
                <input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : topic.addOrder.filter((x) => x === c || channels.includes(x)))} />
                <span className="swatch" style={{ background: meta[c].color }} />
                <b>{meta[c].label}</b> <span className="muted">{meta[c].name}</span>
              </label>
            ))}
            <button className="text-btn" onClick={() => setChannels(topic.defaultChannels)}>
              Default channels
            </button>
          </div>
        )}
      </span>
      {std && (
        <div className="seg seg--layout" role="radiogroup" aria-label="Graph layout">
          {(['separate', 'grouped'] as const).map((l) => (
            <button key={l} role="radio" aria-checked={layout === l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)} title={l === 'separate' ? 'One lane per channel' : 'One lane per quantity'}>
              {l === 'separate' ? 'Separate' : 'Grouped'}
            </button>
          ))}
        </div>
      )}
      <div className="seg seg--layout" role="radiogroup" aria-label="Vertical scale">
        {(
          [
            ['zero', 'From 0', 'Every lane includes zero: true proportions'],
            ['fit', 'Zoom to ripple', 'Each lane fits its waveform: see the ripple'],
          ] as const
        ).map(([v, label, title]) => (
          <button key={v} role="radio" aria-checked={yMode === v} className={yMode === v ? 'on' : ''} title={title} onClick={() => setYMode(v)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  const lessonBody = lesson ? lesson.steps[lessonStep].body(st as never, m as never, result as never) : null
  const modePanel =
    mode === 'learn' ? (
      <LearnPanel
        topic={topic}
        lesson={lesson as never}
        step={lessonStep}
        body={lessonBody}
        onStart={(id) => {
          setLessonId(id)
          setLessonStep(0)
        }}
        onStep={setLessonStep}
        onExit={exitLesson}
      />
    ) : mode === 'experiment' ? (
      <ExperimentPanel topic={topic} params={params} m={m as Record<string, unknown>} onApply={goExplore} captureRows={topic.experiments[0]?.rows ?? []} />
    ) : mode === 'predict' ? (
      <PredictPanel topic={topic} onShow={goExplore} />
    ) : null

  const defaults = topic.defaults as Record<string, unknown>
  const changed = [...topic.basic, ...topic.advanced].some((s) => params[s.key] !== defaults[s.key])
  const viewKey = topic.viewKey
  const Diagram = topic.Diagram

  return (
    <>
      <header className="dc-top">
        <div className="dc-title">
          <p className="eyebrow">{eyebrow}</p>
          <nav className="seg dc-converters" role="tablist" aria-label="Topic">
            {entries.map((e) => (
              <button key={e.id} role="tab" aria-selected={e.id === topic.id} disabled={!e.topic} className={e.id === topic.id ? 'on' : ''} title={e.title} onClick={() => e.topic && onTopic(e.id)}>
                {e.label}
              </button>
            ))}
          </nav>
        </div>
        <nav className="modes seg" role="tablist" aria-label="Mode">
          {MODES.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={mode === x.id}
              className={mode === x.id ? 'on' : ''}
              title={x.title}
              onClick={() => {
                if (x.id !== 'learn' && lesson) exitLesson()
                setMode(x.id)
              }}
            >
              {x.label}
            </button>
          ))}
        </nav>
        <div className="seg density-seg" role="radiogroup" aria-label="Information level">
          {DENSITIES.map((d) => (
            <button key={d.id} role="radio" aria-checked={density === d.id} className={density === d.id ? 'on' : ''} title={d.title} onClick={() => setDensity(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
      </header>

      <div className={`dc-lab ${mode === 'analyze' ? 'dc-lab--analyze' : ''}`}>
        <aside className="dc-left">
          <section className="dc-params" aria-label="Parameters">
            <div className="dc-params-head">
              <h2 className="eyebrow">Parameters</h2>
              <span className="sim-tag" title="Educational defaults for simulation — not a recommended design">
                SIMULATION VALUES
              </span>
            </div>
            <SpecList specs={topic.basic} p={params} onChange={change} disabled={!!lesson} idPrefix={`p-${topic.id}`} />
            {topic.paramNote && <p className="dc-boundary-note muted small">{topic.paramNote(params, result)}</p>}
            <div className="dc-view-row">
              {viewKey && (
                <div className="seg" role="radiogroup" aria-label="Simulation view">
                  {(
                    [
                      ['steady', 'Steady state', 'The periodic steady state (found by the shooting method and verified)'],
                      ['startup', 'Start-up', 'From rest: watch the circuit settle'],
                    ] as const
                  ).map(([v, label, title]) => (
                    <button key={v} role="radio" aria-checked={params[viewKey] === v} className={params[viewKey] === v ? 'on' : ''} title={title} onClick={() => change({ [viewKey]: v })} disabled={!!lesson}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {changed && !lesson && (
                <button className="text-btn" onClick={() => change({ ...defaults })} title="Back to the default simulation values">
                  Reset
                </button>
              )}
            </div>
            <details className="dc-advanced" open={eng}>
              <summary>Advanced: non-ideal components &amp; simulation</summary>
              <SpecList specs={topic.advanced} p={params} onChange={change} disabled={!!lesson} idPrefix={`p-${topic.id}`} />
            </details>
          </section>
          {lesson && <p className="muted small">The lesson sets the parameters. Leave the lesson to change them.</p>}
        </aside>

        <main className="dc-center">
          <div className="dc-diagram-card">
            <div className="dc-diagram-head">
              <h2 className="eyebrow">{topic.title}</h2>
              <label className="toggle small">
                <input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} /> Show current path
              </label>
            </div>
            <Diagram
              r={result}
              st={st}
              selected={part}
              onSelect={(x) => {
                setPart(x)
                setSide('inspect')
              }}
              values={std}
              showPath={showPath}
            />
          </div>
          <LabScope
            result={result}
            channels={shown}
            meta={meta}
            layout={layout}
            yMode={yMode}
            viewport={vp}
            onViewport={setViewport}
            cursorIndex={k}
            onCursorTime={(t) => {
              setCursorTime(t)
              setEvent(null)
            }}
            shading={shading}
            shade={topic.shade}
            shadeLegend={topic.shadeLegend}
            eventLabel={topic.eventLabel}
            eventColor={topic.eventColor}
            periodName={topic.periodName}
            selectedEventId={event?.id ?? null}
            onSelectEvent={jumpToEvent}
            toolbar={channelBar}
          />
          <div className="dc-scope-foot">
            {topic.shade && (
              <label className="toggle small">
                <input type="checkbox" checked={shading} onChange={(e) => setShading(e.target.checked)} /> Shade conduction intervals
              </label>
            )}
            <span className="small muted">← → step the cursor · Shift + ← → jump between switching events</span>
            {result.diagnostics.steady.method === 'startup' && (
              <span className="small">
                Start-up from rest · {p.periods} {topic.periodName}s ({formatTime(p.duration)}) · {result.diagnostics.steady.converged ? 'settled at the end' : 'still settling at the end'}
              </span>
            )}
          </div>
          {mode === 'analyze' && <AnalyzePanel topic={topic} r={result} m={m} p={params} density={density} />}
        </main>

        <aside className="dc-right">
          {modePanel}
          {event && (
            <section className="dc-event" aria-label="Selected event">
              <p className="eyebrow">Event · {formatTime(event.time)}</p>
              <h3>{topic.eventLabel(event)}</h3>
              <p className="small">{topic.eventWhy(event)}</p>
            </section>
          )}
          <StateCard view={view} density={density} foot={eng ? `Δt = ${formatSI(p.dt, 's')} · sample #${k}` : undefined} />
          {std && topic.badge ? topic.badge(result, m) : <p className="dc-mode-mini small">{topic.summary(result, m)}</p>}
          <div className="seg seg--full panel-tabs" role="tablist" aria-label="Details">
            {(
              [
                ['why', 'Why?'],
                ...(std && topic.energy ? ([['energy', topic.energyLabel ?? 'Energy']] as Array<[SideTab, string]>) : []),
                ['inspect', 'Inspect'],
              ] as Array<[SideTab, string]>
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={side === id} className={side === id ? 'on' : ''} onClick={() => setSide(id)}>
                {label}
              </button>
            ))}
          </div>
          {side === 'why' && (
            <>
              <WhyPanel key={view.badge.text} cards={cards} detailed={whyDetailed || eng} />
              {!eng && (
                <button className="text-btn" onClick={() => setWhyDetailed(!whyDetailed)}>
                  {whyDetailed ? 'Less detail' : 'More: physics and what-if'}
                </button>
              )}
            </>
          )}
          {side === 'energy' && std && topic.energy?.(st, m, result)}
          {side === 'inspect' &&
            (part && topic.inspect ? (
              <Inspector info={topic.inspect(part, st, m, result)} />
            ) : (
              <p className="small muted">Click a component on the circuit to inspect it.</p>
            ))}
          {eng && (
            <p className="muted small">
              Steady state: {result.diagnostics.steady.method}, residual {Number.isFinite(result.diagnostics.steady.residual) ? result.diagnostics.steady.residual.toExponential(1) : '—'} ·{' '}
              {formatSI(result.diagnostics.computeMs / 1000, 's')} compute
            </p>
          )}
        </aside>
      </div>
    </>
  )
}
