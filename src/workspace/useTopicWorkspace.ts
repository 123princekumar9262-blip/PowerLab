import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { converterIndexAt } from '../converters/engine.ts'
import type { Run, RunEvent } from '../converters/types.ts'
import type { AnyTopic, ChannelMeta, StatusInfo, WhyCard } from '../lab/types.ts'
import type { NextConsequence } from './contract.ts'
import { formatSI, formatTime } from '../utils/format.ts'
import { setLevel, useLevel, type Level } from '../shell/prefs.ts'

/** Learning modes of a topic workspace (Analyze is an action, not a mode). */
export type WsMode = 'explore' | 'learn' | 'experiment' | 'predict'

export interface WorkspaceStart {
  mode?: WsMode
  /** Starting-point parameters from the route (cast to the topic's own types). */
  params?: Record<string, unknown>
  lesson?: { id: string; step: number }
}

export interface WorkspaceReport {
  mode: WsMode
  level: Level
  lesson?: { id: string; title: string; step: number; of: number }
}

/** A route's string values cast to the types of the topic's parameters (unknown keys are ignored). */
function coerce(defaults: Record<string, unknown>, patch?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in defaults)) continue
    const d = defaults[k]
    if (typeof d === 'number') {
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    } else if (typeof d === 'string' && typeof v === 'string') out[k] = v
  }
  return out
}

/**
 * The sample an event lands on (the workspace's event → cursor rule, shared with the rectifier): the first
 * sample after the event's refined time, moved forward (at most 3 samples) until the simulated trace shows
 * the new state — a device ON/OFF event lands where that device is ON/OFF, a gate edge where the gate is.
 */
export function eventSample(r: Run, e: RunEvent): number {
  let k = Math.min(r.length - 1, converterIndexAt(r, Math.min(r.params.duration, (Math.floor(e.time / r.params.dt + 1e-6) + 1) * r.params.dt)))
  const on = /-on$/.test(e.kind) ? 1 : /-off$/.test(e.kind) ? 0 : null
  if (on === null) return k
  const gate = e.kind.startsWith('gate') ? r.signals.gate : undefined
  const dev = e.device ? r.devices.find((d) => d.id === e.device) : undefined
  const state = (i: number) => (gate ? (gate[i] > 0.5 ? 1 : 0) : dev ? (dev.on[i] ? 1 : 0) : on)
  for (let g = 0; g < 3 && k < r.length - 1 && state(k) !== on; g++) k++
  return k
}

/**
 * The generic next consequence: the run's next detected event after the cursor, in the topic's own words
 * (its event label and explanation). Null when the shown run has no event ahead — nothing is extrapolated.
 */
export function nextEvent(topic: AnyTopic, r: Run, k: number): NextConsequence | null {
  const after = r.time[k] + 0.5 * r.params.dt
  let e: RunEvent | null = null
  for (const x of r.events) if (x.time > after && (!e || x.time < e.time)) e = x
  if (!e) return null
  const why = topic.eventWhy(e)
  return { text: `${topic.eventLabel(e)} at t = ${formatTime(e.time)}.${why ? ` ${why}` : ''}`, time: e.time }
}

/**
 * A run whose events repeat every period: a converged periodic steady state, or a directly computed
 * steady view (PWM) that ends exactly where it started — never a start-up, a drive cycle or a single test.
 */
export function repeatsEveryPeriod(topic: AnyTopic, r: Run): boolean {
  const s = r.diagnostics.steady
  if (!(r.params.period > 0)) return false
  if (s.method === 'shooting' || s.method === 'integration') return s.converged
  if (s.method !== 'direct' || (r.params as { view?: string }).view !== 'steady') return false
  return topic.defaultChannels.every((id) => {
    const a = r.signals[id]
    if (!a) return true
    let mx = 0
    for (const v of a) mx = Math.max(mx, Math.abs(v))
    return Math.abs(a[0] - a[a.length - 1]) <= 1e-6 * Math.max(mx, 1e-12)
  })
}

/**
 * A periodic steady state repeats: past the run's last event, the next one is the earliest event of the
 * pattern one period on. Quoted with its time; there is no sample of it to go to (it lies after the run).
 */
export function nextInNextCycle(topic: AnyTopic, r: Run, k: number): NextConsequence | null {
  if (!r.events.length || !repeatsEveryPeriod(topic, r)) return null
  const P = r.params.period
  const after = r.time[k] + 0.5 * r.params.dt
  let best: { e: RunEvent; t: number } | null = null
  for (const e of r.events) {
    const t = e.time + P * Math.max(1, Math.ceil((after - e.time) / P))
    if (t > after && (!best || t < best.t - 1e-12 * P)) best = { e, t }
  }
  if (!best) return null
  const why = topic.eventWhy(best.e)
  return { text: `${topic.eventLabel(best.e)} at t = ${formatTime(best.t)}, in the next ${topic.periodName} — the waveforms repeat every ${formatTime(P)}.${why ? ` ${why}` : ''}`, time: null }
}

const channelUnit = (c: ChannelMeta) => c.unit || (/\[([^\]]+)\]\s*$/.exec(c.name)?.[1] ?? '')
const channelName = (c: ChannelMeta) => c.name.replace(/\s*\[[^\]]*\]\s*$/, '')
function channelValue(c: ChannelMeta, v: number): string {
  if (c.unit) return formatSI(v, c.unit)
  const u = channelUnit(c)
  const n = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) < 1e-9 ? '0' : Number(v.toPrecision(3)).toString()
  return u ? `${n} ${u}` : n
}

/**
 * A run that settles rather than repeats (a motor start-up, a 0–100 run, a saturating core): past its last
 * event, what happens next is how the main waveforms move until the run ends — read from the simulated
 * samples (averaged over one switching period when the run spans many), never extrapolated beyond it.
 */
export function towardRunEnd(topic: AnyTopic, r: Run, k: number): NextConsequence | null {
  const last = r.length - 1
  if (k >= last - 1) return { text: `This is the end of the simulated run (t = ${formatTime(r.time[last])}): nothing later is computed. Move the cursor back to replay it.`, time: null }
  const spp = r.params.periods > 1 ? Math.max(1, Math.round(r.params.period / r.params.dt)) : 1
  // over the period ending at a sample: the mean, or the RMS for an alternating quantity (its mean is ~0)
  const window = (a: Float64Array, end: number) => {
    const from = Math.max(0, end - spp + 1)
    let s = 0
    let q = 0
    for (let i = from; i <= end; i++) {
      s += a[i]
      q += a[i] * a[i]
    }
    const n = end - from + 1
    return { mean: s / n, rms: Math.sqrt(q / n) }
  }
  const parts: string[] = []
  for (const id of topic.defaultChannels) {
    const c = topic.channels[id]
    const a = r.signals[id]
    if (!c || c.logic || !a) continue
    const w0 = window(a, k)
    const w1 = window(a, last)
    const ac = spp > 1 && Math.abs(w0.mean) < 0.25 * w0.rms && Math.abs(w1.mean) < 0.25 * w1.rms
    const now = ac ? w0.rms : w0.mean
    const end = ac ? w1.rms : w1.mean
    let peak = 0
    for (const v of a) peak = Math.max(peak, Math.abs(v))
    const v = (x: number) => `${channelValue(c, x)}${ac ? ' RMS' : ''}`
    // a change smaller than 2 % (of the value, or of 1 % of the run's peak for values near zero) is "stays"
    const steady = Math.abs(end - now) <= 0.02 * Math.max(Math.abs(now), Math.abs(end), 0.01 * peak, 1e-12)
    parts.push(steady ? `${channelName(c)} stays at ${v(end)}` : `${channelName(c)} ${v(now)} → ${v(end)}`)
    if (parts.length === 3) break
  }
  if (!parts.length) return null
  const avg = spp > 1 ? ` (over each ${topic.periodName})` : ''
  return { text: `No further event in this run. From here to its end at t = ${formatTime(r.time[last])}${avg}: ${parts.join(' · ')}.`, time: r.time[last] }
}

/** The generic next consequence: the run's next event, else the next cycle's (steady state), else the trend to the run's end. */
export const nextConsequenceOf = (topic: AnyTopic, r: Run, k: number): NextConsequence | null => nextEvent(topic, r, k) ?? nextInNextCycle(topic, r, k) ?? towardRunEnd(topic, r, k)

/** Per-topic parameters survive leaving and re-entering the workspace. */
const paramStore = new Map<string, Record<string, unknown>>()

/**
 * THE WORKSPACE STATE — one source of truth for a topic workspace.
 *
 *   params ─► simulate (once per parameter set) ─► Run ─► measure ─► m
 *   master cursor t ─► k ─► state(Run, k) ─► view · status · WHY · next consequence
 *
 * Moving the cursor only re-reads the stored run at a new sample; the simulation runs again only when a
 * parameter changes. Nothing here computes an electrical value — the topic does, from its simulation.
 */
export function useTopicWorkspace(topic: AnyTopic, start: WorkspaceStart | undefined, onReport: (r: WorkspaceReport) => void) {
  const level = useLevel()
  const [mode, setModeRaw] = useState<WsMode>(start?.mode ?? 'explore')
  const [params, setParamsRaw] = useState<Record<string, unknown>>(() => ({
    ...((paramStore.get(topic.id) ?? topic.defaults) as Record<string, unknown>),
    ...coerce(topic.defaults as Record<string, unknown>, start?.params),
  }))
  const setParams = useCallback(
    (p: Record<string, unknown>) => {
      paramStore.set(topic.id, p)
      setParamsRaw(p)
    },
    [topic.id],
  )
  // Sliders stay responsive: the run follows the latest parameters as soon as React can afford it.
  const simParams = useDeferredValue(params)
  const [channels, setChannels] = useState<string[]>(topic.defaultChannels)
  const [layout, setLayout] = useState<'separate' | 'grouped'>('separate')
  const [yMode, setYMode] = useState<'zero' | 'fit'>('zero')
  const [shading, setShading] = useState(true)
  const [cursorTime, setCursorTime] = useState<number | null>(null)
  const [viewport, setViewport] = useState<{ t0: number; t1: number } | null>(null)
  const [event, setEvent] = useState<RunEvent | null>(null)
  const startLesson = start?.mode === 'learn' && start.lesson ? topic.lessons.find((l) => l.id === start.lesson!.id) : undefined
  const [lessonId, setLessonId] = useState<string | null>(startLesson?.id ?? null)
  const [lessonStep, setLessonStep] = useState(startLesson ? Math.min(start!.lesson!.step, startLesson.steps.length - 1) : 0)
  const lessonPending = useRef(false)

  // ── the simulation (once per parameter set) and its measurements ──
  const result: Run = useMemo(() => topic.simulate(simParams), [topic, simParams])
  // The master cursor's run id: changes only when the simulation runs again (never on a cursor move).
  const runs = useRef({ result: null as Run | null, id: 0 })
  if (runs.current.result !== result) runs.current = { result, id: runs.current.id + 1 }
  const runId = runs.current.id
  const m = useMemo(() => topic.measure(result), [topic, result])
  const p = result.params

  // ── the master cursor: one sample index for every panel ──
  const t0 = cursorTime ?? topic.initialCursor(result)
  const k = converterIndexAt(result, Math.min(t0, p.duration))
  const st = useMemo(() => topic.state(result, k), [topic, result, k])
  const cards: WhyCard[] = useMemo(() => topic.why(result, st, m), [topic, result, st, m])
  const nextC: NextConsequence | null = useMemo(() => {
    if (topic.nextConsequence) return topic.nextConsequence(result, st, m)
    if (topic.next) {
      const text = topic.next(result, st, m)
      return text ? { text, time: null } : null
    }
    return nextConsequenceOf(topic, result, k)
  }, [topic, result, st, m, k])
  const next = nextC?.text ?? null
  const view = useMemo(() => topic.view(st, result, level), [topic, st, result, level])
  const status: StatusInfo = useMemo(() => topic.status?.(st, result) ?? { headline: view.badge.text, facts: [], tone: view.badge.tone === 'on' ? 'on' : view.badge.tone === 'off' ? 'off' : 'neutral' }, [topic, st, result, view])
  const vp = viewport && viewport.t1 <= p.duration + 1e-12 ? viewport : { t0: 0, t1: p.duration }
  const lesson = topic.lessons.find((l) => l.id === lessonId) ?? null

  // ── report what is shown (address, Continue, Recent) ──
  useEffect(() => {
    onReport({ mode, level, lesson: mode === 'learn' && lesson ? { id: lesson.id, title: lesson.title, step: lessonStep, of: lesson.steps.length } : undefined })
  }, [mode, level, lessonId, lessonStep]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback(
    (patch: Record<string, unknown>) => {
      // a new time base (frequency, window, view) restarts the cursor and the zoom
      const tb = ['fs', 'f1', 'periods', 'view', 'mf'].some((key) => key in patch && patch[key] !== params[key])
      if (tb) {
        setViewport(null)
        setCursorTime(null)
      }
      setParams({ ...params, ...patch })
      setEvent(null)
    },
    [params, setParams],
  )
  const reset = useCallback(() => {
    setParams({ ...(topic.defaults as Record<string, unknown>) })
    setViewport(null)
    setCursorTime(null)
  }, [topic, setParams])

  // ── lessons drive parameters, channels and the cursor ──
  useEffect(() => {
    if (!lesson) return
    const s = lesson.steps[lessonStep]
    setParams({ ...(topic.defaults as object), ...lesson.base, ...s.params } as Record<string, unknown>)
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

  /** The sample after an event's (refined) time. */
  const landingTime = useCallback((t: number) => Math.min(p.duration, (Math.floor(t / p.dt + 1e-6) + 1) * p.dt), [p])
  /** Move the master cursor to an event: the first sample the TRACE confirms shows the new state. */
  const jumpToEvent = useCallback(
    (e: RunEvent) => {
      setEvent(e)
      setCursorTime(result.time[eventSample(result, e)])
      if (e.time < vp.t0 || e.time > vp.t1) {
        const span = vp.t1 - vp.t0
        const a = Math.max(0, Math.min(p.duration - span, e.time - span / 2))
        setViewport({ t0: a, t1: a + span })
      }
    },
    [p, vp, result],
  )
  /** Move the master cursor to a time quoted by WHY (an event's own time). */
  const goToEventTime = useCallback(
    (t: number) => {
      const e = result.events.find((x) => x.time === t)
      if (e) jumpToEvent(e)
      else setCursorTime(landingTime(t))
    },
    [result, jumpToEvent, landingTime],
  )

  // Keyboard: ← → one sample; Shift + ← → the previous/next event (not while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [role="dialog"][aria-modal="true"]')) return
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
  }, [result, k, p, jumpToEvent])

  const setMode = (mm: WsMode) => {
    setModeRaw(mm)
    if (mm !== 'learn') {
      setLessonId(null)
      setLessonStep(0)
    }
  }
  const lessons = {
    lesson,
    step: lessonStep,
    body: lesson ? lesson.steps[lessonStep].body(st as never, m as never, result as never) : null,
    start: (id: string) => {
      setModeRaw('learn')
      setLessonId(id)
      setLessonStep(0)
    },
    setStep: setLessonStep,
    exit: () => {
      setLessonId(null)
      setLessonStep(0)
      setChannels(topic.defaultChannels)
    },
  }
  /** From an experiment or prediction back to Explore with its parameters. */
  const goExplore = (patch: object) => {
    setLessonId(null)
    setParams({ ...params, ...patch, view: 'steady' })
    setViewport(null)
    setCursorTime(null)
    setModeRaw('explore')
  }

  return {
    topic,
    level,
    setLevel,
    mode,
    setMode,
    params,
    change,
    reset,
    pending: simParams !== params,
    result,
    m,
    k,
    st,
    view,
    status,
    cards,
    next,
    nextC,
    runId,
    goToEventTime,
    channels,
    setChannels,
    layout,
    setLayout,
    yMode,
    setYMode,
    shading,
    setShading,
    viewport: vp,
    setViewport,
    setCursorTime,
    event,
    setEvent,
    jumpToEvent,
    lessons,
    goExplore,
  }
}

export type WorkspaceModel = ReturnType<typeof useTopicWorkspace>
