import { useState, type Dispatch, type ReactNode } from 'react'
import { fullName, labById, modesOf, rectifierTopicFor, workspaceModes, type ModeId } from '../catalogue/catalogue.ts'
import { LOADS } from '../circuits/registry.ts'
import { AngleView } from '../components/AngleView.tsx'
import { ChannelBar } from '../components/ChannelBar.tsx'
import { CircuitDiagram } from '../components/CircuitDiagram.tsx'
import { CompareView } from '../components/CompareView.tsx'
import { ParameterPanel } from '../components/ParameterPanel.tsx'
import { Scope } from '../components/Scope.tsx'
import { Transport } from '../components/Transport.tsx'
import { pathView } from '../explanations/concise.ts'
import { rectifierEnergy } from '../explanations/energy.ts'
import { eventTitle, type EventExplanation, type StateExplanation } from '../explanations/index.ts'
import { rectifierNextConsequence, rectifierStatus, rectifierTime, rectifierWhyQuestions } from '../explanations/status.ts'
import type { Inspection } from '../inspect/inspect.ts'
import type { Comparison } from '../measurements/compare.ts'
import { href } from '../shell/router.ts'
import type { Drawer, LabAction, LabState, ScopeView } from '../state/labState.ts'
import { isThreePhase, supportsFreewheel, type CircuitEvent, type LoadType, type SignalId, type SimulationResult } from '../types/simulation.ts'
import { formatDeg } from '../utils/format.ts'
import type { EventGroup } from '../visualization/eventGroups.ts'
import type { ChannelPreset } from '../visualization/presets.ts'
import type { Viewport } from '../visualization/scopeRenderer.ts'
import type { ComponentInspection, CurrentPath, WorkspaceEvent } from '../workspace/contract.ts'
import { AnalyzeView, EnergyView, EventsView, InspectorView, StatusLine, WhyView } from '../workspace/views.tsx'
import { WorkspaceShell, type ExploreItem, type ShellPanel } from '../workspace/WorkspaceShell.tsx'
import { categoryFor, rectifierAnalysis } from './analyze.tsx'
import '../styles/workspace.css'
import '../styles/rectifier-shell.css'

/*
 * The adapter between the Rectifier Lab and the universal workspace shell. It owns no simulation state and
 * runs nothing: it reads the lab's state (labReducer), its one run, its measurements and the explanation at
 * the cursor, turns them into the workspace contract (status, path, WHY, events, inspection, analysis,
 * energy) and places the lab's own renderers (parameters, circuit, scope) in the shell's regions.
 */

/** Shell panel ⇄ the lab's drawer state (one source of truth: `state.drawer`). */
export function panelOf(drawer: Drawer | null): string | null {
  switch (drawer?.kind) {
    case 'why':
    case 'energy':
    case 'inspect':
    case 'state':
    case 'learn':
      return drawer.kind
    case 'event':
    case 'events':
      return 'events'
    case 'measure':
    case 'theory':
      return 'analyze'
    default:
      return null
  }
}
export function drawerOf(panel: string, current: Drawer | null, hasSelectedEvent: boolean): Drawer | null {
  switch (panel) {
    case 'why':
    case 'energy':
    case 'state':
    case 'learn':
      return { kind: panel }
    case 'inspect':
      return { kind: 'inspect', part: current?.kind === 'inspect' ? current.part : undefined }
    case 'events':
      return { kind: hasSelectedEvent ? 'event' : 'events' }
    case 'analyze':
      return { kind: 'measure' }
    default:
      return null
  }
}

/** The conducting loop at the cursor (the "Show current path" overlay), from the simulated devices. */
export function rectifierPath(result: SimulationResult, ex: StateExplanation): CurrentPath {
  const v = pathView(result, ex)
  return { elements: v.nodes ?? [], text: v.nodes ? v.nodes.join(' → ') : '', reasons: v.reasons }
}

/** The inspectable parts of this circuit (the same ids a click on the circuit gives). */
export function rectifierParts(result: SimulationResult, ex: StateExplanation): Array<{ id: string; label: string }> {
  const names = ex.threePhase?.names ?? ex.names ?? {}
  const p = result.params
  return [
    ...(isThreePhase(p.topology) ? (['a', 'b', 'c'] as const).map((q) => ({ id: `phase-${q}`, label: `Phase ${q.toUpperCase()}` })) : [{ id: 'source', label: 'Source' }]),
    ...result.diodeIds.map((id) => ({ id: id as string, label: names[id] ?? id })),
    { id: 'R', label: 'R' },
    ...(p.load === 'RL' || p.load === 'RLC' ? [{ id: 'L', label: 'L' }] : []),
    ...(p.load === 'RC' || p.load === 'RLC' ? [{ id: 'C', label: 'C' }] : []),
  ]
}

/** An inspection → the shell's inspector: its State row as the common state field, the rest as rows. */
export function rectifierInspection(id: string, info: Inspection): ComponentInspection {
  const state = info.rows.find(([k]) => k === 'State')?.[1]
  return { id, title: info.title, kind: info.kind === 'device' ? 'Device' : info.kind === 'source' ? 'Source' : 'Component', state, rows: info.rows.filter(([k]) => k !== 'State'), why: info.why }
}

/** The event groups in the shown window, as workspace events (words from the circuit's explainer). */
export function rectifierEvents(groups: EventGroup[], names: Record<string, string> | undefined, angleOf: (t: number) => number): WorkspaceEvent[] {
  return groups.map((g) => ({
    id: g.id,
    time: g.time,
    label: g.events.map((e) => eventTitle(e, names)).join(' · '),
    category: g.category === 'diode' ? 'switching' : g.category,
    at: `θ = ${formatDeg(angleOf(g.time))}`,
  }))
}

const toApp = (m: string) => (m === 'explore' ? 'lab' : m) as LabState['mode']
const fromApp = (m: LabState['mode']): ModeId => (m === 'lab' ? 'explore' : m)

export interface RectifierShellProps {
  state: LabState
  dispatch: Dispatch<LabAction>
  result: SimulationResult
  comparison: Comparison
  explanation: StateExplanation
  viewport: Viewport
  cursorIndex: number
  /** Changes only when the simulation runs again. */
  runId: number
  groups: EventGroup[]
  visibleGroups: EventGroup[]
  selectedGroup: EventGroup | null
  explainEvent(e: CircuitEvent): EventExplanation
  inspect(part: string): Inspection | null
  shownChannels: SignalId[]
  shownVisible: Record<SignalId, boolean>
  /** Predict (sketch) covers the answers; reverse engineering also hides the circuit. */
  hide: boolean
  hideCircuit: boolean
  /** A lesson, challenge or prediction owns the circuit choice. */
  circuitLocked: boolean
  /** Challenge: only these fields are editable. */
  editable?: Parameters<typeof ParameterPanel>[0]['editable']
  /** The active mode's own panel (lesson, experiment…), its title, and the lab's existing panels. */
  modePanel: ReactNode | null
  modeTitle: string
  /** The full causal chain, Physics Lens and firing Q&A: WHY's "More detail". */
  whyDetail: ReactNode
  statePanel: ReactNode
  learnPanel: ReactNode
  stepThrough: ReactNode
  scopeViews: Array<{ id: ScopeView; label: string }>
  scopeView: ScopeView
  fwCircuit: boolean
  std: boolean
  angleOf(t: number): number
  onCursor(t: number): void
  /** Move the cursor to an event's time (WHY → "Go to that instant"), on the sample showing the new state. */
  onLand(t: number): void
  onAngle(deg: number): void
  onStep(dir: 1 | -1): void
  onSelectGroup(g: EventGroup): void
  onToggleChannel(sid: SignalId): void
  onPreset(p: Exclude<ChannelPreset, 'custom'>): void
  onToggleFreewheel(): void
  /** Physics Lens: the elements its current stage highlights on the circuit. */
  lensHighlight: Parameters<typeof CircuitDiagram>[0]['lens']
  notice?: ReactNode
  /** Compare mode: a full-width body instead of the regions. */
  body?: ReactNode
}

export function RectifierShell(p: RectifierShellProps) {
  const { state, dispatch, result, comparison, explanation: ex } = p
  const [showPath, setShowPath] = useState(false)
  const lab = labById('rectifiers')!
  const device = state.params.control?.device ?? 'diode'
  const entry = rectifierTopicFor({ topology: result.params.topology, device: result.params.topology === 'semi-bridge' || result.params.topology === '3ph-half-controlled' ? 'scr' : device })
  const answersHidden = p.hide || p.hideCircuit
  const level = state.density
  // the Physics Lens lives in WHY: while it is open, WHY is the open panel
  const open = answersHidden ? null : state.lensStage !== null ? 'why' : panelOf(state.drawer)
  const setOpen = (id: string | null) => {
    if (state.lensStage !== null && id !== 'why') dispatch({ type: 'setLens', stage: null })
    if (id === null) return dispatch({ type: 'closeDrawer' })
    const d = drawerOf(id, state.drawer, !!p.selectedGroup)
    if (d) dispatch({ type: 'openDrawer', drawer: d })
  }
  const three = isThreePhase(result.params.topology)

  // ── header ──
  const siblings = p.circuitLocked
    ? []
    : lab.topics
        .filter((t) => t.status === 'ready' && t.rectifier && !t.opens)
        .map((t) => ({
          id: t.id,
          label: t.title,
          group: t.section,
          // the load and the freewheeling diode travel in the address; the other values are carried over by the lab
          href: href.workspace(lab.id, t.id, 'explore', { load: result.params.load, ...(result.params.control.freewheel && supportsFreewheel(t.rectifier!.topology, result.params.load) ? { fw: '1' } : {}) }),
          current: t.id === entry?.id,
        }))

  // ── parameters: the circuit choices first in Basic (load, freewheeling diode) ──
  const loadPicker = (
    <div className="rx-circuit-choice">
      <div className="picker rx-load" role="radiogroup" aria-label="Load">
        <span className="picker-label">Load</span>
        {LOADS.map((l) => (
          <button key={l.id} role="radio" aria-checked={state.load === l.id} disabled={p.circuitLocked} className={`pick ${state.load === l.id ? 'on' : ''}`} onClick={() => dispatch({ type: 'chooseLoad', load: l.id as LoadType })} title={l.name}>
            {l.label}
          </button>
        ))}
      </div>
      {p.fwCircuit && (
        <button className={`text-btn fw-toggle ${result.params.control.freewheel ? 'is-on' : ''}`} aria-pressed={result.params.control.freewheel} disabled={state.mode === 'challenge' && !!p.editable} onClick={p.onToggleFreewheel}>
          Freewheeling diode: {result.params.control.freewheel ? 'ON' : 'OFF'}
        </button>
      )}
    </div>
  )
  const params = p.hideCircuit ? (
    <section className="params params--hidden">
      <h2 className="eyebrow">Parameters</h2>
      <p className="muted small">Hidden until you reveal the answer — the circuit is the puzzle.</p>
    </section>
  ) : (
    <ParameterPanel
      topology={result.params.topology}
      load={result.params.load}
      params={state.params}
      resolved={result.params}
      issues={result.diagnostics.issues}
      computeMs={result.diagnostics.computeMs}
      samples={result.trace.length}
      onChange={(params) => dispatch({ type: 'setParams', params })}
      onReset={() => dispatch({ type: 'resetParams' })}
      editable={p.editable}
      density={level}
      loadPicker={loadPicker}
    />
  )

  // ── circuit: clean (numbers only at Engineer); click a part to inspect it; the path on request ──
  const circuit = p.hideCircuit ? (
    <section className="bench instrument--hidden" aria-label="Circuit (hidden)">
      <p className="intro-lead">The circuit is hidden.</p>
      <p className="muted">Read the waveforms below and answer the questions in the panel.</p>
    </section>
  ) : (
    <div className={`rx-circuit ${level === 'engineer' ? '' : 'rx-circuit--quiet'}`}>
      <CircuitDiagram
        topology={result.params.topology}
        load={result.params.load}
        sample={p.hide ? null : ex.sample}
        result={p.hide ? null : result}
        params={result.params}
        lens={p.lensHighlight}
        showPath={showPath && !answersHidden}
        inspecting={!p.hide}
        selectedPart={state.drawer?.kind === 'inspect' ? (state.drawer.part ?? null) : null}
        onPart={(part) => dispatch({ type: 'openDrawer', drawer: { kind: 'inspect', part } })}
      />
    </div>
  )

  // ── one status line (from the simulated state at the cursor) ──
  const status = p.hide ? (
    <p className="wp-status-line muted">The state is covered until you reveal your prediction.</p>
  ) : (
    <>
      {!p.hideCircuit && <StatusLine status={rectifierStatus(ex, result, level !== 'beginner')} time={rectifierTime(ex)} path={showPath ? rectifierPath(result, ex) : null} onOpen={() => setOpen(open === 'state' ? null : 'state')} />}
      {!comparison.allWithinTolerance && (
        <p className="flag" role="alert">
          ⚠ The simulation disagrees with theory for {comparison.rows.filter((r) => !r.withinTolerance).map((r) => r.symbol).join(', ')} — see Explore → Measurements &amp; theory. Try a smaller timestep (Advanced → Simulation).
        </p>
      )}
    </>
  )

  // ── waveforms: one primary view (oscilloscope, angle view, with/without Dfw) + transport ──
  const views = p.scopeViews.filter((v) => v.id !== 'events')
  const view = p.scopeView === 'events' ? 'waveforms' : p.scopeView
  // Focus view: the primary waveforms only (source and output voltage)
  const primary: SignalId[] = three ? ['vin', 'vb', 'vc', 'vout'] : ['vin', 'vout']
  const channels = state.focus ? p.shownChannels.filter((c) => primary.includes(c)) : p.shownChannels
  const visible = state.focus ? (Object.fromEntries(Object.entries(p.shownVisible).map(([k, v]) => [k, v && primary.includes(k as SignalId)])) as Record<SignalId, boolean>) : p.shownVisible
  const waveform = p.hide ? (
    <section className="instrument instrument--hidden" aria-label="Oscilloscope (hidden)">
      <p className="intro-lead">The oscilloscope is covered until you reveal your prediction.</p>
      <p className="muted">Sketch the output in the panel and estimate the numbers — then compare with the simulation.</p>
    </section>
  ) : (
    <section className="instrument rx-instrument" aria-label="Oscilloscope">
      <div className="view-bar">
        {views.length > 1 && !p.hideCircuit && !state.focus && (
          <div className="seg view-seg" role="tablist" aria-label="Primary view">
            {views.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => dispatch({ type: 'setScopeView', view: v.id })}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        <Transport
          playing={state.playing}
          speed={state.speed}
          stepMode={state.stepMode}
          time={ex.sample.time}
          angleDeg={ex.angleDeg}
          cycle={ex.cycle}
          cycles={result.params.cycles}
          onTogglePlay={() => dispatch({ type: 'togglePlay' })}
          onReset={() => dispatch({ type: 'reset' })}
          onStep={p.onStep}
          onSpeed={(speed) => dispatch({ type: 'setSpeed', speed })}
          onStepMode={(mode) => dispatch({ type: 'setStepMode', mode })}
          simple={level === 'beginner'}
        />
      </div>
      {view === 'waveforms' && (
        <>
          <Scope
            result={result}
            viewport={p.viewport}
            onViewport={(vp) => dispatch({ type: 'setViewport', viewport: vp })}
            cursorIndex={p.cursorIndex}
            onCursorTime={p.onCursor}
            onScrubStart={() => dispatch({ type: 'pause' })}
            visible={visible}
            channels={channels}
            channelBar={p.hideCircuit || state.focus ? null : <ChannelBar result={result} channels={p.shownChannels} visible={p.shownVisible} preset={state.preset} density={level} onPreset={p.onPreset} onToggle={p.onToggleChannel} />}
            showLayoutSwitch={p.std && !state.focus}
            layoutMode={state.layoutMode}
            onLayoutMode={(mode) => dispatch({ type: 'setLayoutMode', mode })}
            showConduction={state.showConduction}
            groups={p.hideCircuit || !p.std ? [] : p.groups}
            selectedGroupId={state.selectedEventGroupId}
            onSelectGroup={p.onSelectGroup}
          />
          {p.std && !p.hideCircuit && !state.focus && (
            <div className="instrument-foot">
              <label className="check">
                <input type="checkbox" checked={state.showConduction} onChange={() => dispatch({ type: 'toggleConduction' })} />
                {p.fwCircuit && result.params.control.freewheel ? (
                  <>
                    Shade conduction: <span className="shade-key shade-key--d1">D1</span> <span className="shade-key shade-key--fw">Dfw</span>
                  </>
                ) : (
                  'Shade D1 conduction'
                )}
              </label>
            </div>
          )}
        </>
      )}
      {view === 'angle' && <AngleView result={result} angleDeg={ex.angleDeg} onAngle={p.onAngle} />}
      {view === 'compare' && <CompareView result={result} params={state.params} circuitId={result.circuitId} cursorTime={state.cursorTime} onCursorTime={p.onCursor} />}
    </section>
  )

  // ── WHY (primary) ──
  // (none while a mode covers the answers: WHY would give them away)
  const why: ShellPanel | null = answersHidden
    ? null
    : {
        title: 'Why?',
        eyebrow: rectifierTime(ex),
        render: () => (
          <>
            {p.stepThrough}
            <WhyView questions={rectifierWhyQuestions(result, ex)} next={rectifierNextConsequence(result, ex)} onGoTo={p.onLand} detailed={level === 'engineer' || state.whyOpen || state.lensStage !== null} extra={p.whyDetail} />
          </>
        ),
      }

  // ── Explore: everything else, on request ──
  const explore: ExploreItem[] = answersHidden
    ? []
    : [
        { id: 'path', label: 'Show current path', icon: '⇢', kind: 'toggle', pressed: showPath, run: () => setShowPath(!showPath) },
        { id: 'inspect', label: 'Inspect a component', icon: '⌕', kind: 'panel', target: 'inspect' },
        { id: 'state', label: 'State details', icon: '◉', kind: 'panel', target: 'state' },
        { id: 'energy', label: 'Energy', icon: '⚡', kind: 'panel', target: 'energy', secondary: true },
        { id: 'events', label: 'Switching events', icon: '◆', kind: 'panel', target: 'events', secondary: true },
        { id: 'analyze', label: 'Measurements & theory', icon: '▤', kind: 'panel', target: 'analyze', secondary: true, badge: comparison.allWithinTolerance ? undefined : '⚠' },
        ...(state.mode === 'lab' ? [{ id: 'learn', label: 'Lessons', icon: '✎', kind: 'panel' as const, target: 'learn', secondary: true }] : []),
      ]

  const inspectPart = state.drawer?.kind === 'inspect' ? (state.drawer.part ?? null) : null
  const inspected = inspectPart ? p.inspect(inspectPart) : null
  const names = ex.threePhase?.names ?? ex.names
  const panels: Record<string, ShellPanel> = {
    state: {
      title: 'State details',
      eyebrow: rectifierTime(ex),
      render: () => (
        <>
          {p.stepThrough}
          {p.statePanel}
        </>
      ),
    },
    inspect: {
      title: inspected?.title ?? 'Inspect',
      eyebrow: 'Inspect',
      render: () => (
        <InspectorView
          parts={rectifierParts(result, ex)}
          selected={inspectPart}
          info={inspected && inspectPart ? rectifierInspection(inspectPart, inspected) : null}
          onPick={(part) => dispatch({ type: 'openDrawer', drawer: { kind: 'inspect', part } })}
          onWhy={() => setOpen('why')}
        />
      ),
    },
    energy: { title: 'Energy', eyebrow: 'Power at this instant', render: () => <EnergyView model={rectifierEnergy(result, ex.sample, comparison.measurements)} /> },
    events: {
      title: 'Switching events',
      eyebrow: 'Detected in the simulation',
      render: () => {
        const events = rectifierEvents(p.visibleGroups, names, p.angleOf).map((e) => {
          if (!p.selectedGroup || e.id !== p.selectedGroup.id) return e
          const ex2 = p.selectedGroup.events.map((x) => p.explainEvent(x))
          return { ...e, what: ex2.map((x) => x.what).join(' '), why: ex2.map((x) => x.why).join(' ') }
        })
        return (
          <EventsView
            events={events}
            total={p.visibleGroups.length}
            selectedId={state.selectedEventGroupId}
            onSelect={(e) => {
              const g = p.groups.find((x) => x.id === e.id)
              if (g) p.onSelectGroup(g)
            }}
          />
        )
      },
    },
    analyze: {
      title: 'Measurements & theory',
      eyebrow: 'SIMULATION vs THEORY',
      wide: true,
      render: () => (
        <AnalyzeView
          key={`${state.drawer?.kind}:${state.drawer?.part ?? ''}`}
          categories={rectifierAnalysis(comparison, result, ex.sample, level)}
          level={level}
          initial={categoryFor(state.drawer?.part, state.drawer?.kind === 'theory' ? 'theory' : 'measure')}
        />
      ),
    },
    learn: { title: 'Lessons', eyebrow: 'Learn', render: () => p.learnPanel },
  }
  const activity: ShellPanel | null = state.mode !== 'lab' && state.mode !== 'compare' && p.modePanel ? { title: p.modeTitle, render: () => p.modePanel } : null

  return (
    <WorkspaceShell
      header={{
        back: { href: href.lab(lab.id), label: lab.title },
        lab: lab.title,
        title: `${entry ? fullName(entry) : lab.title}${p.fwCircuit && result.params.control.freewheel ? ' + freewheeling diode' : ''}`,
        siblings,
        ...workspaceModes(modesOf(lab)),
        mode: fromApp(state.mode),
        onMode: (m) => dispatch({ type: 'setMode', mode: toApp(m) }),
        level,
        onLevel: (density) => dispatch({ type: 'setDensity', density }),
      }}
      params={params}
      circuit={circuit}
      status={status}
      waveform={waveform}
      why={why}
      explore={explore}
      panels={panels}
      open={open}
      onOpen={setOpen}
      activity={activity}
      focus={state.focus}
      onFocus={(on) => dispatch({ type: 'setFocus', on })}
      notice={p.notice}
      runId={p.runId}
      body={p.body}
    />
  )
}
