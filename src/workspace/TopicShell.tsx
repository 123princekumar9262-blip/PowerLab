import { useEffect, useState } from 'react'
import { fullName, labById, modesOf, topicOf, workspaceModes } from '../catalogue/catalogue.ts'
import { MeasureTable, Numerics } from '../components/lab/Analyze.tsx'
import { ExperimentPanel, LearnPanel, PredictPanel } from '../components/lab/Modes.tsx'
import { StateCard } from '../components/lab/Panels.tsx'
import type { AnyTopic, CompareResult, InspectInfo } from '../lab/types.ts'
import { isFirstVisit, markSeen, type Level } from '../shell/prefs.ts'
import { href } from '../shell/router.ts'
import { subjectOf } from '../catalogue/subjects.ts'
import { formatSI, formatTime } from '../utils/format.ts'
import type { WorkspaceProps } from '../workspaces/types.ts'
import type { AnalysisCategory, AnalysisRow, ComponentInspection, WhyQuestion, WorkspaceEvent } from './contract.ts'
import { categoryRows, CircuitView, ParameterPanel, WaveformPanel } from './panels.tsx'
import { useTopicWorkspace, type WorkspaceModel, type WsMode } from './useTopicWorkspace.ts'
import { AnalyzeView, EnergyView, EventsView, InspectorView, StatusLine, SymbolsView, WhyView } from './views.tsx'
import { GLOSSARY } from '../lab/glossary.ts'
import { AskPanel } from '../assist/AskPanel.tsx'
import { WorkspaceBoot, WorkspaceShell, type ExploreItem, type ShellPanel } from './WorkspaceShell.tsx'
import '../styles/workspace.css'

const WS_MODES: WsMode[] = ['explore', 'learn', 'experiment', 'predict']
const isWsMode = (m: string): m is WsMode => (WS_MODES as string[]).includes(m)
/** A circuit whose last solve took longer than this says "Updating" while it is re-solved (faster ones would only flicker). */
const SLOW_MS = 150

// ── Topic → workspace contract (pure; tested) ───────────────────────────────

/** WHY cards → What · Why · Physical principle (+ what-if under "More detail"). */
export const whyQuestions = (w: Pick<WorkspaceModel, 'cards'>): WhyQuestion[] =>
  w.cards.map((c) => ({ id: c.id, question: c.question, what: c.what, why: c.why, principle: c.physics, equation: c.equation, more: c.whatIf ? [`What if… ${c.whatIf}`] : [] }))

/** An inspector's rows → common fields (its "State now") + its own rows. */
export function inspection(id: string, info: InspectInfo): ComponentInspection {
  const state = info.rows.find(([k]) => /^State/.test(k))?.[1]
  return { id, title: info.title, kind: info.role, state, rows: info.rows.filter(([k]) => !/^State/.test(k)) }
}

/** The run's events in the shown window (first 60), with the topic's own words. */
export function topicEvents(w: Pick<WorkspaceModel, 'result' | 'topic' | 'viewport'>): { events: WorkspaceEvent[]; total: number } {
  const inView = w.result.events.filter((e) => e.time >= w.viewport.t0 && e.time <= w.viewport.t1)
  return { total: inView.length, events: inView.slice(0, 60).map((e) => ({ id: e.id, time: e.time, label: w.topic.eventLabel(e), category: 'switching', why: w.topic.eventWhy(e) })) }
}

const fmtRow = (unit: string, v: number) => (unit === '%' ? `${(v * 100).toFixed(2)} %` : formatSI(v, unit))
const compareRow = (r: CompareResult['rows'][number], label?: string): AnalysisRow => ({
  key: r.key,
  label: label ?? r.label,
  simulation: fmtRow(r.unit, r.sim),
  theory: fmtRow(r.unit, r.exact),
  // an absolute difference of a ratio shown in % is in percentage points (not an SI-prefixed "µ%")
  error: r.absolute ? (r.unit === '%' ? `${(r.error * 100).toPrecision(3)} %` : formatSI(r.error, r.unit)) : `${(r.error * 100).toFixed(3)} %`,
  // an EXPECTED difference (the exact theory omits something the simulation includes) is explained, not checked
  pass: r.expected ? null : r.pass,
  note: r.expected,
  formula: r.textbook?.formula ?? null,
})

/** Analyze categories from the topic's own measurements and compare rows; empty categories are dropped. */
export function topicAnalysis(topic: AnyTopic, w: Pick<WorkspaceModel, 'result' | 'm' | 'params'>, cmp: CompareResult, level: Level): AnalysisCategory[] {
  const ctx = { r: w.result, m: w.m, p: w.params, density: level }
  const cats: AnalysisCategory[] = []
  // a topic without its own categories: its run summary, then each of its analysis tabs as a category
  if (!topic.analysis) {
    cats.push({ id: 'overview', label: 'Overview', rows: [], extra: topic.badge ? topic.badge(w.result, w.m) : <p>{topic.summary(w.result, w.m)}</p> })
    for (const t of topic.analyze.tabs ?? []) cats.push({ id: t.id, label: t.label, rows: [], extra: t.render(ctx) })
  }
  const usedTabs = new Set([...(topic.analysis ?? []).map((c) => c.tab).filter(Boolean), ...(topic.analysis ? [] : (topic.analyze.tabs ?? []).map((t) => t.id))])
  for (const c of topic.analysis ?? []) {
    if (c.tab) {
      const t = topic.analyze.tabs?.find((x) => x.id === c.tab)
      if (t) cats.push({ id: c.id, label: c.label, rows: [], extra: t.render(ctx) })
      continue
    }
    const rows: AnalysisRow[] = categoryRows(c, w.m, cmp.rows, topic.measureLabels).map((r) => {
      const cr = cmp.rows.find((x) => x.key === r.key)
      return cr ? { ...compareRow(cr, r.label), simulation: r.sim, theory: r.theory } : { key: r.key, label: r.label, simulation: r.sim, theory: null, error: null, pass: null }
    })
    const note = c.note?.(w.m, w.result)
    if (rows.length) cats.push({ id: c.id, label: c.label, rows, assumptions: note ? [note] : undefined })
  }
  const assumptions = [...new Set(cmp.rows.flatMap((r) => r.textbook?.assumptions ?? []))]
  const extraTabs = (topic.analyze.tabs ?? []).filter((t) => !usedTabs.has(t.id))
  cats.push({
    id: 'theory',
    label: 'Theory vs Simulation',
    rows: cmp.rows.map((r) => compareRow(r)),
    assumptions: [...(cmp.header ? [cmp.header] : []), ...assumptions, ...(cmp.note ? [cmp.note] : [])],
    extra: (
      <>
        <details className="wp-more">
          <summary>Textbook formulas compared</summary>
          <MeasureTable cmp={cmp} />
        </details>
        <details className="wp-more" open={level === 'engineer'}>
          <summary>Derivation</summary>
          <div className="dc-theory">{topic.analyze.theory(w.result, w.m)}</div>
        </details>
        {extraTabs.map((t) => (
          <details key={t.id} className="wp-more">
            <summary>{t.label}</summary>
            {t.render(ctx)}
          </details>
        ))}
        <details className="wp-more">
          <summary>Numerical checks</summary>
          <Numerics topic={topic} r={w.result} p={w.params} cmp={cmp} />
        </details>
      </>
    ),
  })
  return cats
}

/**
 * The adapter between a lab's topics and the universal workspace shell: it reads one workspace model (one
 * run, one master cursor) and hands the shell contract shapes and its own renderers.
 */
export function topicShell(labId: string, topics: Record<string, AnyTopic>) {
  const lab = labById(labId)!
  /**
   * The first solve of a circuit can take a second (the inverters): the lab's frame and a "Simulating" line are
   * painted first, then the circuit is solved — the page never sits blank.
   */
  return function TopicShellBoot(props: WorkspaceProps) {
    const [ready, setReady] = useState(false)
    useEffect(() => {
      let t = 0
      const f = requestAnimationFrame(() => (t = window.setTimeout(() => setReady(true), 0)))
      return () => {
        cancelAnimationFrame(f)
        clearTimeout(t)
      }
    }, [])
    if (ready) return <TopicShellWorkspace {...props} />
    const entry = topicOf(lab, props.topic)
    return <WorkspaceBoot lab={lab.title} title={entry ? fullName(entry) : ''} />
  }

  function TopicShellWorkspace({ topic: topicId, mode, query, onActivity }: WorkspaceProps) {
    const topic = topics[topicId]
    const entry = topicOf(lab, topicId)!
    const lessonQ = query.lesson ? { id: query.lesson, step: Number(query.step) || 0 } : undefined
    const startParams = Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'lesson' && k !== 'step'))
    const w = useTopicWorkspace(topic, { mode: isWsMode(mode) ? mode : 'explore', params: startParams, lesson: lessonQ }, (r) =>
      onActivity({ topic: topicId, mode: r.mode, level: r.level, lesson: r.lesson, query: r.lesson ? { lesson: r.lesson.id, step: String(r.lesson.step) } : startParams }),
    )
    const [open, setOpen] = useState<string | null>(null)
    const [part, setPart] = useState<string | null>(null)
    // the current flows on the circuit from the start (Explore → "Show current path" turns it off)
    const [showPath, setShowPath] = useState(true)
    const [focus, setFocus] = useState(false)
    // a lab's first visit: the essentials (two readings, the main waveforms) until "Show everything"
    const [essentials, setEssentials] = useState(() => isFirstVisit(lab.id))
    const primary = topic.primaryChannels ?? topic.defaultChannels.slice(0, 2)
    useEffect(() => {
      markSeen(lab.id)
      // a lesson sets its own channels (and essentials never override what a lesson shows)
      if (!essentials || (w.mode === 'learn' && w.lessons.lesson)) return
      const main = topic.defaultChannels.filter((c) => primary.includes(c))
      w.setChannels(main.length ? main : primary)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    const showAll = () => {
      setEssentials(false)
      w.setChannels(topic.defaultChannels)
    }
    // Predict: until the student checks the answer, nothing on screen may give it away (values, waveforms, WHY)
    const [predictOpen, setPredictOpen] = useState(true)
    const covered = w.mode === 'predict' && predictOpen

    const setMode = (id: string) => {
      if (!isWsMode(id)) return
      w.setMode(id)
      setOpen(null)
    }
    const inLesson = w.mode === 'learn' && !!w.lessons.lesson
    const path = showPath ? (topic.path ? topic.path(w.st, w.result) : { elements: [], text: w.view.path ?? '', reasons: [] }) : null
    const cmp = () => topic.analyze.compare(w.result, w.m)

    // ── the current mode's own panel ──
    const activity: ShellPanel | null =
      w.mode === 'learn'
        ? { title: w.lessons.lesson ? w.lessons.lesson.title : 'Lessons', eyebrow: 'Learn', render: () => <LearnPanel topic={topic} lesson={w.lessons.lesson as never} step={w.lessons.step} body={w.lessons.body} onStart={w.lessons.start} onStep={w.lessons.setStep} onExit={w.lessons.exit} /> }
        : w.mode === 'experiment'
          ? { title: 'Experiment', eyebrow: 'Change one thing, predict, run', render: () => <ExperimentPanel topic={topic} params={w.params} m={w.m as Record<string, unknown>} onApply={w.goExplore} captureRows={topic.experiments[0]?.rows ?? []} /> }
          : w.mode === 'predict'
            ? { title: 'Predict', eyebrow: 'Predict first, then simulate', render: () => <PredictPanel topic={topic} onShow={w.goExplore} onCovered={setPredictOpen} /> }
            : null

    // ── WHY (primary) and the Explore menu (everything else) ──
    const why: ShellPanel = {
      title: 'Why?',
      eyebrow: `At t = ${formatTime(w.result.time[w.k])}`,
      render: () => <WhyView questions={whyQuestions(w)} next={w.nextC} onGoTo={w.goToEventTime} detailed={w.level === 'engineer'} />,
    }
    const explore: ExploreItem[] = [
      { id: 'path', label: 'Show current path', icon: '⇢', kind: 'toggle', pressed: showPath, run: () => setShowPath(!showPath), hint: 'Moving dashes show where the current flows now, and in which direction' },
      { id: 'inspect', label: 'Inspect a component', icon: '⌕', kind: 'panel', target: 'inspect', hint: 'Pick a part (or click it on the circuit): its voltage, current and role now' },
      { id: 'state', label: 'State details', icon: '◉', kind: 'panel', target: 'state', hint: 'Every switch, diode and value at the cursor instant' },
      ...(topic.energyModel || topic.energy
        ? [{ id: 'energy', label: topic.energyLabel ?? 'Energy', icon: topic.energyLabel ? '∿' : '⚡︎', kind: 'panel' as const, target: 'energy', secondary: true, hint: topic.energyModel ? 'Where the power goes at this instant, and the energy stored' : 'A view of this run computed from the simulation' }]
        : []),
      { id: 'events', label: 'Switching events', icon: '◆', kind: 'panel', target: 'events', secondary: true, hint: 'Every turn-on and turn-off found in the run; click one to jump to it' },
      { id: 'analyze', label: 'Measurements & theory', icon: '▤', kind: 'panel', target: 'analyze', secondary: true, hint: 'Measured values, compared with the textbook theory' },
      { id: 'symbols', label: 'Symbols used here', icon: '§', kind: 'panel', target: 'symbols', secondary: true, hint: 'What every letter on this page means (GH, iL, D …)' },
      ...(w.mode === 'explore' ? [{ id: 'learn', label: 'Lessons', icon: '✎', kind: 'panel' as const, target: 'learn', secondary: true, hint: 'Short guided lessons on this circuit' }] : []),
    ]
    const panels: Record<string, ShellPanel> = {
      state: {
        title: 'State details',
        eyebrow: `At t = ${formatTime(w.result.time[w.k])}`,
        render: () => {
          const d = w.result.diagnostics
          return (
            <>
              <StateCard view={w.view} density={w.level} foot={w.level === 'engineer' ? `Δt = ${formatSI(w.result.params.dt, 's')} · sample #${w.k}` : undefined} />
              {w.level !== 'beginner' && topic.badge ? topic.badge(w.result, w.m) : <p className="dc-mode-mini small">{topic.summary(w.result, w.m)}</p>}
              {w.level === 'engineer' && (
                <p className="muted small">
                  Steady state: {d.steady.method}, residual {Number.isFinite(d.steady.residual) ? d.steady.residual.toExponential(1) : '—'} · {formatSI(d.computeMs / 1000, 's')} compute
                </p>
              )}
            </>
          )
        },
      },
      inspect: {
        title: part ? (topic.parts?.find((x) => x.id === part)?.label ?? 'Inspect') : 'Inspect',
        eyebrow: 'Inspect',
        render: () => {
          const info = part && topic.inspect ? topic.inspect(part, w.st, w.m, w.result) : null
          return <InspectorView parts={topic.parts ?? []} selected={part} info={info ? inspection(part!, info) : null} onPick={setPart} onWhy={() => setOpen('why')} />
        },
      },
      energy: {
        title: topic.energyLabel ?? 'Energy',
        // the instantaneous ledger says so; a lab's own view (cycle energy, Bode, spectrum…) describes itself
        eyebrow: topic.energyModel ? 'Power at this instant' : 'From the simulation',
        // a lab's own chart (Bode, Spectrum, Zth, B–i) needs width: it docks under the circuit
        wide: !topic.energyModel && !!topic.energyLabel,
        render: () => (topic.energyModel ? <EnergyView model={topic.energyModel(w.st, w.m, w.result)} /> : topic.energy?.(w.st, w.m, w.result)),
      },
      events: {
        title: 'Switching events',
        eyebrow: 'Detected in the simulation',
        render: () => {
          const { events, total } = topicEvents(w)
          return (
            <EventsView
              events={events}
              total={total}
              selectedId={w.event?.id ?? null}
              onSelect={(e) => {
                const ev = w.result.events.find((x) => x.id === e.id)
                if (ev) w.jumpToEvent(ev)
              }}
            />
          )
        },
      },
      analyze: { title: 'Measurements & theory', eyebrow: 'SIMULATION vs THEORY', wide: true, render: () => <AnalyzeView categories={topicAnalysis(topic, w, cmp(), w.level)} level={w.level} /> },
      symbols: {
        title: 'Symbols used here',
        eyebrow: lab.title,
        render: () => (
          <SymbolsView
            sections={[
              { title: 'On the circuit and in the texts', rows: GLOSSARY[lab.id] ?? [] },
              { title: 'Waveforms', rows: Object.values(topic.channels).map((c) => [c.label, c.unit ? c.name + ' [' + c.unit + ']' : c.name] as [string, string]) },
              { title: 'Parameters', rows: [...topic.basic, ...topic.advanced].map((sp) => (sp.kind === 'number' ? [sp.label, sp.unit ? 'set in ' + sp.unit : 'a number'] : [sp.label, sp.options.map((o) => o.label).join(' / ')]) as [string, string]) },
            ]}
          />
        ),
      },
      learn: { title: 'Lessons', eyebrow: 'Learn', render: () => <LearnPanel topic={topic} lesson={null} step={0} body={null} onStart={(id) => (setOpen(null), w.lessons.start(id))} onStep={() => {}} onExit={() => {}} /> },
    }

    // ── Ask a doubt: the question goes with what the simulation shows now ──
    const askContext = () => {
      const P = w.params as Record<string, unknown>
      const fmtNum = (v: number) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(3) : String(+v.toPrecision(4)))
      const params = [...topic.basic, ...topic.advanced]
        .filter((sp) => !sp.when || sp.when(w.params))
        .map((sp) =>
          sp.kind === 'number' ? `${sp.label} = ${fmtNum((P[sp.key] as number) / (sp.scale ?? 1))} ${sp.unit}` : `${sp.label} = ${sp.options.find((o) => o.value === P[sp.key])?.label ?? String(P[sp.key])}`,
        )
      const rd = topic.readings ? topic.readings(w.m, w.result).map((x) => `${x.label}: ${x.value} ${x.unit}${x.note ? ` (${x.note})` : ''}`) : []
      const pth = topic.path ? topic.path(w.st, w.result).text : w.view.path
      return [
        `Lab: ${lab.title} › ${fullName(entry)}. Mode: ${w.mode}.`,
        `Parameters: ${params.join('; ')}.`,
        rd.length ? `Readings of the run: ${rd.join('; ')}.` : '',
        `At the cursor (t = ${formatTime(w.result.time[w.k])}): ${w.status.headline}${w.status.facts.length ? ` — ${w.status.facts.join('; ')}` : ''}.`,
        pth ? `Current path now: ${pth}.` : '',
        `State: ${w.view.rows.map((r) => `${r.k} ${r.v}`).join('; ')}.`,
        w.next ? `What happens next: ${w.next}` : '',
        `WHY at the cursor: ${w.cards
          .slice(0, 3)
          .map((c) => `${c.question} → ${c.what} ${c.why}`)
          .join(' | ')}`,
        `Summary: ${topic.summary(w.result, w.m)}`,
        `Symbols: ${(GLOSSARY[lab.id] ?? []).map(([a, b]) => `${a} = ${b}`).join('; ')}; waveforms: ${Object.values(topic.channels)
          .map((c) => `${c.label} = ${c.name}`)
          .join('; ')}.`,
      ]
        .filter(Boolean)
        .join('\n')
    }
    const ask: ShellPanel = { title: 'Ask a doubt', eyebrow: `${fullName(entry)} · live`, render: () => <AskPanel id={`${lab.id}/${topicId}`} context={askContext} /> }

    const siblings = lab.topics
      .filter((t) => t.status === 'ready' && !t.opens)
      .map((t) => ({ id: t.id, label: t.short ?? t.title, href: href.workspace(lab.id, t.id), current: t.id === topicId }))

    return (
      <WorkspaceShell
        header={{
          back: { href: href.lab(lab.id), label: lab.title },
          lab: lab.title,
          subject: subjectOf(lab.id),
          title: fullName(entry),
          siblings,
          ...workspaceModes(modesOf(lab).filter(isWsMode)),
          mode: w.mode,
          onMode: setMode,
          level: w.level,
          onLevel: w.setLevel,
        }}
        params={covered ? <p className="wp-covered small">The prediction uses its own circuit values (in the question). The values, waveforms and WHY stay covered until you check your answer.</p> : <ParameterPanel w={w} focus={focus} locked={inLesson} />}
        circuit={
          <CircuitView
            w={w}
            showPath={showPath && !covered}
            quiet={covered}
            selected={open === 'inspect' ? part : null}
            onSelect={(x) => {
              if (covered) return
              setPart(x)
              setOpen('inspect')
            }}
          />
        }
        status={covered ? <p className="wp-status-line muted">The state is covered until you check your prediction.</p> : <StatusLine status={w.status} time={`t = ${formatTime(w.result.time[w.k])}`} path={path} onOpen={() => setOpen(open === 'state' ? null : 'state')} busy={w.pending && w.result.diagnostics.computeMs > SLOW_MS} />}
        waveform={covered ? <p className="wp-covered wp-covered--wave">Waveforms are covered until you check your prediction — then the simulation answers it.</p> : <WaveformPanel w={w} focus={focus} compact={false} />}
        why={covered ? null : why}
        ask={covered ? null : ask}
        explore={covered ? [] : explore}
        panels={panels}
        open={open}
        onOpen={setOpen}
        activity={activity}
        focus={focus}
        onFocus={setFocus}
        runId={w.runId}
        readings={topic.readings ? (covered ? null : topic.readings(w.m, w.result)) : undefined}
        essentials={essentials}
        onShowAll={showAll}
        busy={w.pending && w.result.diagnostics.computeMs > SLOW_MS}
      />
    )
  }
}
