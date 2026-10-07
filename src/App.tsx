import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { CircuitDiagram } from './components/CircuitDiagram.tsx'
import { EnergyPanel } from './components/EnergyPanel.tsx'
import { EventDetail } from './components/EventPanels.tsx'
import { Header } from './components/Header.tsx'
import { ParameterPanel } from './components/ParameterPanel.tsx'
import { Scope } from './components/Scope.tsx'
import { Transport } from './components/Transport.tsx'
import { ChannelBar } from './components/ChannelBar.tsx'
import { ChallengePanel } from './components/modes/ChallengePanel.tsx'
import { LessonPanel } from './components/modes/LessonPanel.tsx'
import { PredictPanel } from './components/modes/PredictPanel.tsx'
import { ExperimentPanel } from './components/modes/ExperimentPanel.tsx'
import { WhatIfPanel } from './components/modes/WhatIfPanel.tsx'
import { ReversePanel } from './components/modes/ReversePanel.tsx'
import { AngleView } from './components/AngleView.tsx'
import { PhysicsLens } from './components/PhysicsLens.tsx'
import { FreewheelPanel } from './components/FreewheelPanel.tsx'
import { CompareView } from './components/CompareView.tsx'
import { StepThrough } from './components/StepThrough.tsx'
import { Drawer } from './components/ui/Drawer.tsx'
import { StateCard } from './components/panels/StateCard.tsx'
import { WhyPanel } from './components/panels/WhyPanel.tsx'
import { LearnTab } from './components/panels/LearnTab.tsx'
import { PathPanel } from './components/panels/PathPanel.tsx'
import { InspectPanel } from './components/panels/InspectPanel.tsx'
import { MeasurementsPanel } from './components/panels/MeasurementsPanel.tsx'
import { TheoryPanel } from './components/panels/TheoryPanel.tsx'
import { EventsView } from './components/panels/EventsView.tsx'
import { useModes } from './state/useModes.ts'
import { lensStages } from './explanations/lens.ts'
import { stateLine } from './explanations/concise.ts'
import { inspectPart } from './inspect/inspect.ts'
import { resolveTarget } from './learning/target.ts'
import { isThreePhase, supportsFreewheel, type SignalId } from './types/simulation.ts'
import { getExplainer } from './explanations/index.ts'
import { compareWithTheory } from './measurements/compare.ts'
import { indexAtTime, runSimulation } from './simulation/engine.ts'
import { sanitizeParams } from './simulation/params.ts'
import { sineSource, threePhaseSource } from './simulation/source.ts'
import { circuitIdOf, initialLabState, labReducer, type RightTab, type ScopeView } from './state/labState.ts'
import { stepTarget } from './state/stepping.ts'
import { usePlayback } from './state/usePlayback.ts'
import { getModel } from './circuits/registry.ts'
import { presetVisible, type ChannelPreset } from './visualization/presets.ts'
import { groupEvents, groupIndex, type EventGroup } from './visualization/eventGroups.ts'
import { formatA, formatDeg, formatTime, formatV } from './utils/format.ts'

const MODE_LABEL = { lab: 'Explore', learn: 'Lesson', experiment: 'Experiment', predict: 'Predict', challenge: 'Challenge', reverse: 'Reverse' } as const

/** "What do you want to study?" — each choice configures channels, view and panels. */
const STUDIES = [
  { id: 'switching', label: 'How the diodes switch' },
  { id: 'output', label: 'How the output voltage is formed' },
  { id: 'load', label: 'How the load current behaves' },
  { id: 'firing', label: 'How the firing angle affects the output' },
  { id: 'energy', label: 'Energy flow' },
  { id: 'measure', label: 'Measurements' },
  { id: 'theory', label: 'Theory' },
] as const
type StudyId = (typeof STUDIES)[number]['id']

/**
 * The lab. Progressive disclosure: the circuit, one primary view, the state and the main
 * controls are always visible; everything else (path, why, energy, measurements, theory,
 * component details, events) opens on request in a tab or a drawer. All of it is read from
 * the same simulation result — presentation only, no physics here.
 */
export function App() {
  const [state, dispatch] = useReducer(labReducer, initialLabState)
  const circuitId = circuitIdOf(state)

  // ── Simulation: the single source of truth. Re-runs whenever parameters change. ──
  const result = useMemo(() => (state.hasRun ? runSimulation(state.params, circuitId) : null), [state.hasRun, state.params, circuitId])
  const preview = useMemo(() => sanitizeParams(state.params, circuitId), [state.params, circuitId])
  const comparison = useMemo(() => (result ? compareWithTheory(result) : null), [result])
  const groups = useMemo(() => (result ? groupEvents(result) : []), [result])
  const explainer = getExplainer(circuitId)

  // Channels: a preset applied to this circuit's signals, or the student's own choice.
  const visible = useMemo(
    () => (result && state.preset !== 'custom' ? presetVisible(state.preset, result.signalIds, result.params.topology, state.showEnergy) : state.visible),
    [result, state.preset, state.visible, state.showEnergy],
  )
  const channels = useMemo(() => (result ? [...result.signalIds] : []), [result])
  const cursorIndex = result ? indexAtTime(result, state.cursorTime) : 0
  const explanation = useMemo(() => (result ? explainer.state(result, cursorIndex) : null), [result, cursorIndex, explainer])
  // Default view: the whole run, or for long runs the last 4 cycles (the settled steady state
  // the measurements use) — "Fit" still shows everything.
  const viewport = result
    ? (state.viewport ??
      (result.params.cycles > 6 ? { t0: result.params.duration - 4 * result.params.period, t1: result.params.duration } : { t0: 0, t1: result.params.duration }))
    : null

  const setCursor = useCallback((time: number, byUser = false) => dispatch({ type: 'setCursor', time, byUser }), [])
  const modes = useModes(state, dispatch, result, comparison, explanation?.sample ?? null)
  const lens = useMemo(() => (result && explanation && state.lensStage !== null ? lensStages(result, explanation) : null), [result, explanation, state.lensStage])
  const hide = modes.hideAnswers
  const hideCircuit = modes.hideCircuit
  // Reverse engineering: only the source and output channels.
  const shownChannels = hideCircuit ? channels.filter((sid) => sid === 'vin' || sid === 'vb' || sid === 'vc' || sid === 'vout') : channels
  const shownVisible = hideCircuit ? ({ ...visible, vin: true, vb: true, vc: true, vout: true } as typeof visible) : visible

  const [stepOn, setStepOn] = useState(false)
  const three = !!result && isThreePhase(result.params.topology)
  const fwCircuit = !!result && !three && supportsFreewheel(result.params.topology, result.params.load)
  const fwFitted = fwCircuit && result!.params.control.freewheel
  const std = state.density !== 'beginner'
  const eng = state.density === 'engineer'
  const pause = useCallback(() => dispatch({ type: 'pause' }), [])
  const play = useCallback(() => dispatch({ type: 'play' }), [])

  usePlayback({
    playing: state.playing,
    speed: state.speed,
    period: result?.params.period ?? 1,
    duration: result?.params.duration ?? 0,
    cursorTime: state.cursorTime,
    setCursor,
  })

  // Keep the cursor in view while playing (manual pan/zoom is otherwise left alone).
  const followCursor = useCallback(
    (t: number) => {
      if (!result || !state.viewport) return
      const { t0, t1 } = state.viewport
      if (t >= t0 && t <= t1) return
      const span = t1 - t0
      const start = Math.min(result.params.duration - span, Math.max(0, t - span * 0.1))
      dispatch({ type: 'setViewport', viewport: { t0: start, t1: start + span } })
    },
    [result, state.viewport],
  )
  useEffect(() => {
    if (state.playing && result) followCursor(result.trace.time[cursorIndex])
  }, [state.playing, cursorIndex, result, followCursor])

  // Guided flow: "Observe circuit" completes once the student has seen D1 both ON and OFF.
  const diodeOn = explanation?.diode.on
  useEffect(() => {
    if (diodeOn !== undefined && state.progress.cursorMoved) dispatch({ type: 'observedDiode', on: diodeOn })
  }, [diodeOn, state.progress.cursorMoved])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!result) return
      dispatch({ type: 'pause' })
      const target = stepTarget(result, groups, cursorIndex, dir, state.stepMode)
      setCursor(result.trace.time[target], true)
      followCursor(result.trace.time[target])
    },
    [result, groups, cursorIndex, state.stepMode, setCursor, followCursor],
  )

  const selectGroup = useCallback(
    (g: EventGroup) => {
      if (!result) return
      const t = result.trace.time[groupIndex(result, g)]
      dispatch({ type: 'selectEventGroup', id: g.id, time: t })
      followCursor(t)
    },
    [result, followCursor],
  )

  // Keyboard: Space play/pause, ←/→ step, Home reset (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (!result || el.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === ' ' && !el.closest('button')) {
        e.preventDefault()
        dispatch({ type: 'togglePlay' })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        step(-1)
      } else if (e.key === 'Home') {
        dispatch({ type: 'reset' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, step])

  const onRun = () => {
    // Start the cursor at the first positive peak (found by the engine's event detector),
    // so the first thing the student sees is the diode conducting.
    const first = runSimulation(state.params, circuitId).events.find((e) => e.kind === 'vin-positive-peak')
    dispatch({ type: 'run', cursorTime: first?.time ?? 0 })
  }

  const toggleChannel = (sid: SignalId) => dispatch({ type: 'setChannels', preset: 'custom', visible: { ...visible, [sid]: !visible[sid] } })
  const setPreset = (preset: Exclude<ChannelPreset, 'custom'>) => dispatch({ type: 'setChannels', preset })
  const setView = (view: ScopeView) => dispatch({ type: 'setScopeView', view })
  const openWhy = () => (state.focus ? dispatch({ type: 'openDrawer', drawer: { kind: 'why' } }) : dispatch({ type: 'setRightTab', tab: 'why' }))
  const openEnergy = () => (state.focus || !std ? dispatch({ type: 'openDrawer', drawer: { kind: 'energy' } }) : dispatch({ type: 'setRightTab', tab: 'energy' }))

  const applyStudy = (id: StudyId) => {
    if (!result) return
    switch (id) {
      case 'switching':
        setPreset('diode')
        setView(three && std ? 'angle' : 'waveforms')
        dispatch({ type: 'openDrawer', drawer: { kind: 'path' } })
        openWhy()
        break
      case 'output':
        setPreset('basic')
        setView(three && std ? 'angle' : 'waveforms')
        openWhy()
        break
      case 'load':
        setPreset('load')
        setView('waveforms')
        dispatch({ type: 'setInspecting', on: true })
        dispatch({ type: 'openDrawer', drawer: { kind: 'inspect', part: result.params.load === 'RL' || result.params.load === 'RLC' ? 'L' : 'R' } })
        break
      case 'firing':
        if (three && result.params.control.device !== 'scr') {
          const ctl = state.params.control ?? { device: 'diode' as const, alphaDeg: 30, freewheel: false }
          dispatch({ type: 'setParams', params: { ...state.params, control: { ...ctl, device: 'scr' } } })
        }
        setPreset('basic')
        setView(three && std ? 'angle' : 'waveforms')
        openWhy()
        break
      case 'energy':
        dispatch({ type: 'setEnergy', on: true })
        if (!std) dispatch({ type: 'openDrawer', drawer: { kind: 'energy' } })
        break
      case 'measure':
        dispatch({ type: 'openDrawer', drawer: { kind: 'measure' } })
        break
      case 'theory':
        dispatch({ type: 'openDrawer', drawer: { kind: 'theory' } })
        break
    }
  }

  const selectedGroup = groups.find((g) => g.id === state.selectedEventGroupId) ?? null
  const visibleGroups = viewport ? groups.filter((g) => g.time >= viewport.t0 && g.time <= viewport.t1) : []
  const m = comparison?.measurements
  const drawer = state.drawer
  const inspection = useMemo(
    () => (result && explanation && comparison && drawer?.kind === 'inspect' && drawer.part ? inspectPart(result, explanation, comparison.measurements, drawer.part) : null),
    [result, explanation, comparison, drawer],
  )
  const angleOf = (t: number) => (result && three ? threePhaseSource(result.params).angleDeg(t) : result ? sineSource(result.params).angleDeg(t) : 0)

  // ── Right panel tabs (one at a time) ──────────────────────────────────────────────
  const answersHidden = hide || hideCircuit
  const tabs: Array<{ id: RightTab; label: string }> = [
    ...(state.mode !== 'lab' ? [{ id: 'mode' as const, label: MODE_LABEL[state.mode] }] : []),
    ...(answersHidden ? [] : [{ id: 'state' as const, label: 'State' }, { id: 'why' as const, label: 'Why' }]),
    ...(state.mode === 'lab' ? [{ id: 'learn' as const, label: 'Learn' }] : []),
    ...(std && !answersHidden ? [{ id: 'energy' as const, label: 'Energy' }] : []),
  ]
  const rightTab = tabs.some((t) => t.id === state.rightTab) ? state.rightTab : tabs[0]?.id

  const lensPanel =
    lens && state.lensStage !== null ? <PhysicsLens stages={lens} stage={state.lensStage} onStage={(k) => dispatch({ type: 'setLens', stage: k })} onClose={() => dispatch({ type: 'setLens', stage: null })} /> : null

  const modePanel = () => {
    if (!result || !comparison) return null
    switch (state.mode) {
      case 'learn':
        return (
          <LessonPanel
            section={state.section}
            lesson={modes.lesson}
            step={modes.lessonStep}
            facts={modes.facts}
            completed={modes.completed}
            onStart={modes.startLesson}
            onStep={modes.setLessonStep}
            onExit={modes.exitLesson}
            onComplete={modes.completeLesson}
          />
        )
      case 'challenge':
        return <ChallengePanel section={state.section} challenge={modes.challenge} result={modes.challengeResult} best={modes.bestStars} onStart={modes.startChallenge} onExit={modes.exitChallenge} onSubmit={modes.submitChallenge} />
      case 'experiment':
        return (
          <ExperimentPanel
            circuitId={result.circuitId}
            topology={result.params.topology}
            params={state.params}
            measurements={comparison.measurements}
            steady={comparison.measurements.steady.reached}
            snapshot={modes.snapshot}
            onCapture={modes.captureBefore}
            onClearSnapshot={modes.clearSnapshot}
            onFaults={(faults) => dispatch({ type: 'setParams', params: { ...state.params, faults } })}
            load={result.params.load}
            guided={modes.guided}
            onRunGuided={modes.runGuided}
          />
        )
      case 'predict':
        return (
          <>
            <div className="seg seg--full predict-tabs" role="tablist" aria-label="Prediction type">
              {(['whatif', 'sketch'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={modes.predictTab === t} className={modes.predictTab === t ? 'on' : ''} onClick={() => modes.setPredictTab(t)}>
                  {t === 'whatif' ? 'What if…?' : 'Sketch the output'}
                </button>
              ))}
            </div>
            {modes.predictTab === 'whatif' && <WhatIfPanel section={state.section} focus={fwCircuit ? 'freewheel' : undefined} onShowInLab={modes.showWhatIfInLab} />}
            {modes.predictTab === 'sketch' && modes.prediction && (
              <PredictPanel
                task={modes.prediction.task}
                result={result}
                comparison={comparison}
                revealed={modes.prediction.revealed}
                best={modes.bestPredict}
                onReveal={modes.revealPrediction}
                onNext={modes.newPrediction}
                onExplore={() => dispatch({ type: 'setMode', mode: 'lab' })}
              />
            )}
          </>
        )
      case 'reverse':
        return modes.reverse && modes.reverseAns ? (
          <ReversePanel
            task={modes.reverse.task}
            answers={modes.reverseAns}
            revealed={modes.reverse.revealed}
            onReveal={modes.revealReverse}
            onNext={modes.newReverse}
            onExplore={() => dispatch({ type: 'setMode', mode: 'lab' })}
          />
        ) : null
      default:
        return null
    }
  }

  const whyPanel =
    result && explanation ? (
      <WhyPanel result={result} ex={explanation} detailed={state.whyOpen} onToggleDetailed={() => dispatch({ type: 'toggleWhy' })} onLens={() => dispatch({ type: 'setLens', stage: 0 })} lens={lensPanel} />
    ) : null
  const energyPanel = result && explanation && m ? <EnergyPanel result={result} sample={explanation.sample} measurements={m} /> : null
  const scopeViews: Array<{ id: ScopeView; label: string }> = [
    { id: 'waveforms', label: 'Waveforms' },
    ...(three && std ? [{ id: 'angle' as const, label: 'Angle view' }] : []),
    { id: 'events', label: 'Events' },
    ...(fwCircuit ? [{ id: 'compare' as const, label: 'With / without Dfw' }] : []),
  ]
  const scopeView = hideCircuit || hide ? 'waveforms' : scopeViews.some((v) => v.id === state.scopeView) ? state.scopeView : 'waveforms'

  return (
    <div className={`app ${state.focus ? 'app--focus' : ''}`}>
      <Header
        state={state}
        onTopology={(topology) => dispatch({ type: 'chooseTopology', topology })}
        onLoad={(load) => dispatch({ type: 'chooseLoad', load })}
        onRun={onRun}
        onMode={(mode) => dispatch({ type: 'setMode', mode })}
        onSection={(section) => dispatch({ type: 'setSection', section })}
        onDensity={(density) => dispatch({ type: 'setDensity', density })}
        circuitLocked={(state.mode === 'learn' && !!modes.lesson) || (state.mode === 'challenge' && !!modes.challenge) || (state.mode === 'predict' && modes.predictTab === 'sketch') || state.mode === 'reverse'}
      />

      {!result || !explanation || !viewport || !comparison ? (
        <main className="intro">
          <section className="bench bench--intro">
            {state.topology && state.load ? (
              <>
                <CircuitDiagram topology={state.topology} load={state.load} sample={null} result={null} params={preview.params} />
                <p className="intro-caption">
                  {getModel(circuitId).name} is on the bench. Press <b>Run simulation</b> — every waveform, highlight and explanation you will
                  see comes from solving this circuit, instant by instant.
                </p>
              </>
            ) : (
              <div className="intro-empty">
                <p className="intro-lead">Pick a rectifier and a load to put the circuit on the bench.</p>
                <p className="muted">
                  Then run it, drag the time cursor across the waveforms, and watch the circuit — which diode conducts, where current
                  flows, and why the output looks the way it does.
                </p>
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className={`lab ${state.focus ? 'lab--focus' : ''}`}>
          {!state.focus && (
            <aside className="col-params">
              {hideCircuit ? (
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
                  editable={state.mode === 'challenge' && modes.challenge ? modes.challenge.editable : undefined}
                  density={state.density}
                />
              )}
            </aside>
          )}

          <div className="col-bench">
            {hideCircuit ? (
              <section className="bench instrument--hidden" aria-label="Circuit (hidden)">
                <p className="intro-lead">The circuit is hidden.</p>
                <p className="muted">Read the waveforms below and answer the questions on the right.</p>
              </section>
            ) : (
              <section className="bench" aria-label="Circuit">
                <div className="bench-bar">
                  <h2 className="bench-title">
                    {getModel(circuitId).name}
                    {result.params.control.freewheel && !three ? ' + freewheeling diode' : ''}
                  </h2>
                  {fwCircuit && (
                    <button
                      className={`text-btn fw-toggle ${result.params.control.freewheel ? 'is-on' : ''}`}
                      aria-pressed={result.params.control.freewheel}
                      disabled={state.mode === 'challenge' && !!modes.challenge}
                      onClick={() =>
                        dispatch({ type: 'setParams', params: { ...state.params, control: { device: 'diode', alphaDeg: state.params.control?.alphaDeg ?? 0, freewheel: !result.params.control.freewheel } } })
                      }
                    >
                      Freewheeling diode: {result.params.control.freewheel ? 'ON' : 'OFF'}
                    </button>
                  )}
                  {!state.focus && !hide && (
                    <select
                      className="study-select"
                      aria-label="What do you want to study?"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) applyStudy(e.target.value as StudyId)
                      }}
                    >
                      <option value="">What do you want to study?</option>
                      {STUDIES.filter((s) => s.id !== 'firing' || three).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className={`text-btn focus-btn ${state.focus ? 'is-on' : ''}`}
                    aria-pressed={state.focus}
                    onClick={() => dispatch({ type: 'setFocus', on: !state.focus })}
                    title="Focus mode: only the circuit, the waveform and the state"
                  >
                    {state.focus ? 'Exit focus' : '◎ Focus'}
                  </button>
                </div>
                <CircuitDiagram
                  topology={result.params.topology}
                  load={result.params.load}
                  sample={hide ? null : explanation.sample}
                  result={hide ? null : result}
                  params={result.params}
                  lens={lens && state.lensStage !== null ? lens[state.lensStage].highlight : null}
                  showPath={drawer?.kind === 'path'}
                  inspecting={state.inspecting}
                  selectedPart={drawer?.kind === 'inspect' ? (drawer.part ?? null) : null}
                  onPart={(part) => dispatch({ type: 'openDrawer', drawer: { kind: 'inspect', part } })}
                />
                {!hide && !state.focus && (
                  <div className="state-strip">
                    <p className="strip-state" aria-live="polite">
                      <b>{stateLine(explanation)}</b>
                      <span>Vo = {formatV(explanation.sample.vout)}</span>
                      <span>Io = {formatA(explanation.sample.io)}</span>
                      <span className="muted">
                        t = {formatTime(explanation.sample.time)} · θ = {formatDeg(explanation.angleDeg)} · cycle {explanation.cycle}/{result.params.cycles}
                      </span>
                    </p>
                    {!state.focus && (
                      <div className="strip-actions" role="toolbar" aria-label="Explore this instant">
                        <button
                          className={`act-btn ${drawer?.kind === 'path' ? 'is-on' : ''}`}
                          aria-pressed={drawer?.kind === 'path'}
                          onClick={() => (drawer?.kind === 'path' ? dispatch({ type: 'closeDrawer' }) : dispatch({ type: 'openDrawer', drawer: { kind: 'path' } }))}
                        >
                          ⇢ Current path
                        </button>
                        <button className="act-btn act-btn--why" onClick={openWhy}>
                          WHY?
                        </button>
                        {std && (
                          <button className="act-btn" onClick={openEnergy}>
                            ⚡ Energy
                          </button>
                        )}
                        <button
                          className={`act-btn ${state.inspecting ? 'is-on' : ''}`}
                          aria-pressed={state.inspecting}
                          onClick={() => dispatch({ type: 'setInspecting', on: !state.inspecting })}
                          title="Inspect: click any component on the circuit"
                        >
                          🔎 Inspect
                        </button>
                        {std && (
                          <button className="act-btn" onClick={() => dispatch({ type: 'openDrawer', drawer: { kind: 'measure' } })}>
                            Measurements
                            {!comparison.allWithinTolerance && <span className="badge-warn"> ⚠</span>}
                          </button>
                        )}
                        {eng && (
                          <button className="act-btn" onClick={() => dispatch({ type: 'openDrawer', drawer: { kind: 'theory' } })}>
                            Theory &amp; equations
                          </button>
                        )}
                      </div>
                    )}
                    {state.inspecting && <p className="muted small inspect-hint">Inspect mode: click a diode, SCR, R, L, C or a source on the circuit.</p>}
                  </div>
                )}
                {!comparison.allWithinTolerance && !hide && (
                  <p className="flag" role="alert">
                    ⚠ The simulation disagrees with theory for {comparison.rows.filter((r) => !r.withinTolerance).map((r) => r.symbol).join(', ')} — see Measurements. Try a smaller timestep (Advanced → Simulation).
                  </p>
                )}
              </section>
            )}
          </div>

          <div className="col-scope">
            {hide ? (
              <section className="instrument instrument--hidden" aria-label="Oscilloscope (hidden)">
                <p className="intro-lead">The oscilloscope is covered until you reveal your prediction.</p>
                <p className="muted">Sketch the output on the right and estimate the numbers — then compare with the simulation.</p>
              </section>
            ) : (
              <section className="instrument" aria-label="Oscilloscope">
                <div className="view-bar">
                  {scopeViews.length > 1 && !hideCircuit && (
                    <div className="seg view-seg" role="tablist" aria-label="Primary view">
                      {scopeViews.map((v) => (
                        <button key={v.id} role="tab" aria-selected={scopeView === v.id} className={scopeView === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <Transport
                    playing={state.playing}
                    speed={state.speed}
                    stepMode={state.stepMode}
                    time={explanation.sample.time}
                    angleDeg={explanation.angleDeg}
                    cycle={explanation.cycle}
                    cycles={result.params.cycles}
                    onTogglePlay={() => dispatch({ type: 'togglePlay' })}
                    onReset={() => dispatch({ type: 'reset' })}
                    onStep={step}
                    onSpeed={(speed) => dispatch({ type: 'setSpeed', speed })}
                    onStepMode={(mode) => dispatch({ type: 'setStepMode', mode })}
                  />
                </div>
                {scopeView === 'waveforms' && (
                  <>
                    <Scope
                      result={result}
                      viewport={viewport}
                      onViewport={(vp) => dispatch({ type: 'setViewport', viewport: vp })}
                      cursorIndex={cursorIndex}
                      onCursorTime={(t) => setCursor(t, true)}
                      onScrubStart={() => dispatch({ type: 'pause' })}
                      visible={shownVisible}
                      channels={shownChannels}
                      channelBar={
                        hideCircuit ? null : (
                          <ChannelBar result={result} channels={shownChannels} visible={shownVisible} preset={state.preset} density={state.density} onPreset={setPreset} onToggle={toggleChannel} />
                        )
                      }
                      showLayoutSwitch={std}
                      layoutMode={state.layoutMode}
                      onLayoutMode={(mode) => dispatch({ type: 'setLayoutMode', mode })}
                      showConduction={state.showConduction}
                      groups={hideCircuit || !std ? [] : groups}
                      selectedGroupId={state.selectedEventGroupId}
                      onSelectGroup={selectGroup}
                    />
                    {std && !hideCircuit && !state.focus && (
                      <div className="instrument-foot">
                        <label className="check">
                          <input type="checkbox" checked={state.showConduction} onChange={() => dispatch({ type: 'toggleConduction' })} />
                          {fwFitted ? (
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
                {scopeView === 'angle' && (
                  <AngleView
                    result={result}
                    angleDeg={explanation.angleDeg}
                    onAngle={(deg) => {
                      dispatch({ type: 'pause' })
                      setCursor(resolveTarget(result, { angleDeg: deg }), true)
                    }}
                  />
                )}
                {scopeView === 'events' && <EventsView groups={visibleGroups} selectedId={state.selectedEventGroupId} angleOf={angleOf} onSelect={selectGroup} />}
                {scopeView === 'compare' && <CompareView result={result} params={state.params} circuitId={circuitId} cursorTime={state.cursorTime} onCursorTime={(t) => setCursor(t, true)} />}
              </section>
            )}

            {state.focus && (
              <section className="focus-bar" aria-label="Focus mode">
                <p className="strip-state">
                  <b>{stateLine(explanation)}</b>
                  <span>θ = {formatDeg(explanation.angleDeg)}</span>
                </p>
                <div className="strip-actions">
                  <button className="act-btn act-btn--why" onClick={openWhy}>
                    WHY?
                  </button>
                  <button className="act-btn" onClick={() => dispatch({ type: 'openDrawer', drawer: { kind: 'path' } })}>
                    ⇢ Current path
                  </button>
                  <button className="act-btn" onClick={() => dispatch({ type: 'setFocus', on: false })}>
                    Exit focus
                  </button>
                </div>
              </section>
            )}
          </div>

          {!state.focus && (
            <aside className="col-state">
              {fwFitted && stepOn && !answersHidden && (
                <StepThrough result={result} cursorTime={state.cursorTime} playing={state.playing} onCursor={(t) => setCursor(t, true)} onPlay={play} onPause={pause} onClose={() => setStepOn(false)} />
              )}
              <div className="seg seg--full panel-tabs" role="tablist" aria-label="Panel">
                {tabs.map((t) => (
                  <button key={t.id} role="tab" aria-selected={rightTab === t.id} className={rightTab === t.id ? 'on' : ''} onClick={() => dispatch({ type: 'setRightTab', tab: t.id })}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="panel-body" role="tabpanel">
                {rightTab === 'mode' && modePanel()}
                {rightTab === 'mode' && state.mode === 'learn' && modes.lesson && state.showEnergy && energyPanel}
                {rightTab === 'state' && (
                  <>
                    <StateCard ex={explanation} signalIds={result.signalIds} topology={result.params.topology} density={state.density} />
                    {fwFitted && explanation.freewheel && (
                      <FreewheelPanel
                        result={result}
                        ex={explanation}
                        showWhy={false}
                        compareOn={scopeView === 'compare'}
                        onToggleCompare={() => setView(scopeView === 'compare' ? 'waveforms' : 'compare')}
                        stepOn={stepOn}
                        onToggleStep={() => setStepOn((v) => !v)}
                      />
                    )}
                  </>
                )}
                {rightTab === 'why' && whyPanel}
                {rightTab === 'learn' && (
                  <LearnTab
                    section={state.section}
                    completed={modes.completed}
                    onOpen={(l) => {
                      dispatch({ type: 'setMode', mode: 'learn' })
                      modes.startLesson(l)
                    }}
                  />
                )}
                {rightTab === 'energy' && energyPanel}
              </div>
            </aside>
          )}

          {drawer && !answersHidden && (
            <>
              {drawer.kind === 'path' && (
                <Drawer eyebrow="Right now" title="Current path" onClose={() => dispatch({ type: 'closeDrawer' })}>
                  <PathPanel result={result} ex={explanation} />
                </Drawer>
              )}
              {drawer.kind === 'why' && (
                <Drawer title="Why is this happening?" onClose={() => dispatch({ type: 'closeDrawer' })}>
                  {whyPanel}
                </Drawer>
              )}
              {drawer.kind === 'energy' && (
                <Drawer title="Energy" onClose={() => dispatch({ type: 'closeDrawer' })}>
                  {energyPanel}
                </Drawer>
              )}
              {drawer.kind === 'inspect' && (
                <Drawer eyebrow={inspection?.kind === 'device' ? 'Device' : inspection?.kind === 'source' ? 'Source' : 'Component'} title={inspection?.title ?? 'Inspect'} onClose={() => dispatch({ type: 'closeDrawer' })}>
                  <InspectPanel info={inspection} />
                </Drawer>
              )}
              {drawer.kind === 'event' && selectedGroup && (
                <Drawer title="Event" onClose={() => dispatch({ type: 'selectEventGroup', id: null })}>
                  <EventDetail
                    group={selectedGroup}
                    angleDeg={angleOf(selectedGroup.time)}
                    explanations={selectedGroup.events.map((e) => explainer.event(result, e))}
                    onClose={() => dispatch({ type: 'selectEventGroup', id: null })}
                  />
                </Drawer>
              )}
              {drawer.kind === 'measure' && (
                <Drawer variant="sheet" eyebrow="Analysis" title="Measurements" onClose={() => dispatch({ type: 'closeDrawer' })}>
                  <MeasurementsPanel comparison={comparison} density={state.density} />
                </Drawer>
              )}
              {drawer.kind === 'theory' && (
                <Drawer variant="sheet" eyebrow="Analysis" title="Theory & equations" onClose={() => dispatch({ type: 'closeDrawer' })}>
                  <TheoryPanel comparison={comparison} />
                </Drawer>
              )}
            </>
          )}
        </main>
      )}
    </div>
  )
}
