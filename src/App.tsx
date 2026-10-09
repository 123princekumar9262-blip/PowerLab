import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ChallengePanel } from './components/modes/ChallengePanel.tsx'
import { LessonPanel } from './components/modes/LessonPanel.tsx'
import { PredictPanel } from './components/modes/PredictPanel.tsx'
import { ExperimentPanel } from './components/modes/ExperimentPanel.tsx'
import { WhatIfPanel } from './components/modes/WhatIfPanel.tsx'
import { ReversePanel } from './components/modes/ReversePanel.tsx'
import { PhysicsLens } from './components/PhysicsLens.tsx'
import { FreewheelPanel } from './components/FreewheelPanel.tsx'
import { StepThrough } from './components/StepThrough.tsx'
import { StateCard } from './components/panels/StateCard.tsx'
import { WhyPanel } from './components/panels/WhyPanel.tsx'
import { LearnTab } from './components/panels/LearnTab.tsx'
import { FiringPanel } from './components/panels/FiringPanel.tsx'
import { CompareLab } from './components/compare/CompareLab.tsx'
import { useModes } from './state/useModes.ts'
import { lensStages } from './explanations/lens.ts'
import { inspectPart } from './inspect/inspect.ts'
import { resolveTarget } from './learning/target.ts'
import { isThreePhase, supportsFreewheel, type SignalId } from './types/simulation.ts'
import { getExplainer } from './explanations/index.ts'
import { compareWithTheory } from './measurements/compare.ts'
import { indexAtTime, runSimulation } from './simulation/engine.ts'
import { sineSource, threePhaseSource } from './simulation/source.ts'
import { circuitIdOf, initialLabState, labReducer, RECOMMENDED_CYCLES, type AppMode, type Density, type LabState, type ScopeView } from './state/labState.ts'
import { LESSONS } from './learning/lessons.ts'
import type { LabParams, LoadType, RectifierTopology } from './types/simulation.ts'
import { rememberParams, type CarryReport } from './workspace/carry.ts'
import { CarryNotice } from './workspace/views.tsx'
import { loadJSON, saveJSON } from './utils/storage.ts'
import { stepTarget } from './state/stepping.ts'
import { usePlayback } from './state/usePlayback.ts'
import { presetVisible, type ChannelPreset } from './visualization/presets.ts'
import { groupEvents, groupIndex, type EventGroup } from './visualization/eventGroups.ts'
import { RectifierShell } from './rectifier/RectifierShell.tsx'
import { rectifierEnergy } from './explanations/energy.ts'
import { EnergyView } from './workspace/views.tsx'

/** Where the workspace starts when it is opened from a route (Home → Lab → Circuit → running). */
export interface RectifierInitial {
  topology: RectifierTopology
  device: 'diode' | 'scr'
  load: LoadType
  mode?: AppMode
  density?: Density
  /** Optional starting point: freewheeling diode fitted, firing angle [°], source inductance [H]. */
  freewheel?: boolean
  alphaDeg?: number
  ls?: number
  /** Open the Measurements sheet on a tab (e.g. 'commutation'). */
  sheet?: string
  /** Resume a lesson at a step. */
  lesson?: { id: string; step: number }
  /** Values carried over from the previous circuit (Change circuit); the route's own values still win. */
  carried?: LabParams
}

/** What the workspace is showing now — reported so the address and "Continue" stay truthful. */
export interface RectifierActivity {
  topology: RectifierTopology
  device: 'diode' | 'scr'
  load: LoadType
  freewheel: boolean
  mode: AppMode
  density: Density
  lesson?: { id: string; title: string; step: number; of: number }
}

/** Build the starting state exactly as the student's own clicks would: section, circuit, load, run. */
function initialState(init?: RectifierInitial): LabState {
  let s: LabState = init?.density ? { ...initialLabState, density: init.density } : initialLabState
  if (!init) return s
  if (init.topology.startsWith('3ph')) s = labReducer(s, { type: 'setSection', section: 'three' })
  s = labReducer(s, { type: 'chooseRectifier', topology: init.topology, device: init.device })
  s = labReducer(s, { type: 'chooseLoad', load: init.load })
  // carried values replace the section defaults (never below the load's recommended run length)
  if (init.carried) s = labReducer(s, { type: 'setParams', params: { ...init.carried, sim: { ...init.carried.sim, cycles: Math.max(init.carried.sim.cycles, RECOMMENDED_CYCLES[init.load]) } } })
  const ctl = s.params.control ?? { device: init.device, alphaDeg: 30, freewheel: false }
  const params = { ...s.params, control: { ...ctl, freewheel: !!init.freewheel, alphaDeg: init.alphaDeg ?? ctl.alphaDeg } }
  if (init.ls !== undefined && s.params.threePhase) params.threePhase = { ...s.params.threePhase, ls: init.ls }
  s = labReducer(s, { type: 'setParams', params })
  // the cursor starts at the first positive peak (found by the engine's event detector), as Run did
  const first = runSimulation(s.params, circuitIdOf(s)).events.find((e) => e.kind === 'vin-positive-peak')
  s = labReducer(s, { type: 'run', cursorTime: first?.time ?? 0 })
  if (init.mode && init.mode !== 'lab') s = labReducer(s, { type: 'setMode', mode: init.mode })
  if (init.sheet) s = labReducer(s, { type: 'openDrawer', drawer: { kind: 'measure', part: init.sheet } })
  return s
}

/** One-time hint (replaces the permanent 6-step guide). */
const HINT_KEY = 'pel.hints'

const MODE_LABEL = { lab: 'Explore', learn: 'Lesson', experiment: 'Experiment', predict: 'Predict', challenge: 'Challenge', reverse: 'Reverse', compare: 'Compare' } as const

/**
 * The Rectifier Lab: its state (labReducer), its one simulation run and everything read from it —
 * measurements, the explanation at the cursor, events, modes. RectifierShell places all of it in the
 * universal workspace shell; nothing here is layout, and nothing here is physics.
 */
export function App({ initial, onActivity, carryReport }: { initial?: RectifierInitial; onActivity?: (a: RectifierActivity) => void; carryReport?: CarryReport | null } = {}) {
  const [state, dispatch] = useReducer(labReducer, initial, initialState)
  // the lab's last values, for "Change circuit" (kept where the next circuit uses them)
  useEffect(() => rememberParams('rectifiers', state.params), [state.params])
  const [noticeOpen, setNoticeOpen] = useState(true)
  const circuitId = circuitIdOf(state)
  const [hintSeen, setHintSeen] = useState(() => loadJSON<{ rect?: boolean }>(HINT_KEY, {}).rect === true)
  const dismissHint = () => {
    setHintSeen(true)
    saveJSON(HINT_KEY, { ...loadJSON<Record<string, boolean>>(HINT_KEY, {}), rect: true })
  }

  // ── Simulation: the single source of truth. Re-runs whenever parameters change. ──
  const result = useMemo(() => (state.hasRun ? runSimulation(state.params, circuitId) : null), [state.hasRun, state.params, circuitId])
  // The master cursor's run id: changes only when the simulation runs again (never on a cursor move).
  const runs = useRef({ result: null as typeof result, id: 0 })
  if (runs.current.result !== result) runs.current = { result, id: runs.current.id + 1 }
  const runId = runs.current.id
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

  // Resume a lesson at its step (from "Continue learning").
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || !initial?.lesson || state.mode !== 'learn') return
    const l = LESSONS.find((x) => x.id === initial.lesson!.id)
    resumed.current = true
    if (!l) return
    modes.startLesson(l)
    if (initial.lesson.step > 0) modes.setLessonStep(Math.min(initial.lesson.step, l.steps.length - 1))
  }, [initial, state.mode, modes])

  // Report what is shown, so the address, "Continue" and "Recent" follow the student.
  const device = state.params.control?.device ?? 'diode'
  const freewheel = !!state.params.control?.freewheel
  const lessonNow = state.mode === 'learn' && modes.lesson ? { id: modes.lesson.id, title: modes.lesson.title, step: modes.lessonStep, of: modes.lesson.steps.length } : undefined
  const lessonKey = lessonNow ? `${lessonNow.id}:${lessonNow.step}` : ''
  useEffect(() => {
    if (!onActivity || !state.hasRun || !state.topology || !state.load) return
    onActivity({ topology: state.topology, device, load: state.load, freewheel, mode: state.mode, density: state.density, lesson: lessonNow })
  }, [state.hasRun, state.topology, state.load, device, freewheel, state.mode, state.density, lessonKey]) // eslint-disable-line react-hooks/exhaustive-deps
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
      if (!result || el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"][aria-modal="true"]')) return
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

  const toggleChannel = (sid: SignalId) => dispatch({ type: 'setChannels', preset: 'custom', visible: { ...visible, [sid]: !visible[sid] } })
  const setPreset = (preset: Exclude<ChannelPreset, 'custom'>) => dispatch({ type: 'setChannels', preset })
  const setView = (view: ScopeView) => dispatch({ type: 'setScopeView', view })

  const selectedGroup = groups.find((g) => g.id === state.selectedEventGroupId) ?? null
  const visibleGroups = viewport ? groups.filter((g) => g.time >= viewport.t0 && g.time <= viewport.t1) : []
  const angleOf = (t: number) => (result && three ? threePhaseSource(result.params).angleDeg(t) : result ? sineSource(result.params).angleDeg(t) : 0)

  // ── Right panel tabs (one at a time) ──────────────────────────────────────────────
  const answersHidden = hide || hideCircuit
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

  const scopeViews: Array<{ id: ScopeView; label: string }> = [
    { id: 'waveforms', label: 'Waveforms' },
    ...(three && std ? [{ id: 'angle' as const, label: 'Angle view' }] : []),
    { id: 'events', label: 'Events' },
    ...(fwCircuit ? [{ id: 'compare' as const, label: 'With / without Dfw' }] : []),
  ]
  const scopeView = hideCircuit || hide ? 'waveforms' : scopeViews.some((v) => v.id === state.scopeView) ? state.scopeView : 'waveforms'
  const circuitLocked = (state.mode === 'learn' && !!modes.lesson) || (state.mode === 'challenge' && !!modes.challenge) || (state.mode === 'predict' && modes.predictTab === 'sketch') || state.mode === 'reverse'
  const toggleFreewheel = () => {
    if (!result) return
    dispatch({ type: 'setParams', params: { ...state.params, control: { device: 'diode', alphaDeg: state.params.control?.alphaDeg ?? 0, freewheel: !result.params.control.freewheel } } })
  }

  // ── The universal workspace shell: the same state, run and panels, placed in the shell's regions ──
  if (result && explanation && viewport && comparison)
    return (
      <RectifierShell
        state={state}
        dispatch={dispatch}
        result={result}
        comparison={comparison}
        explanation={explanation}
        viewport={viewport}
        cursorIndex={cursorIndex}
        groups={groups}
        visibleGroups={visibleGroups}
        selectedGroup={selectedGroup}
        runId={runId}
        explainEvent={(e) => explainer.event(result, e)}
        inspect={(part) => inspectPart(result, explanation, comparison.measurements, part)}
        shownChannels={shownChannels}
        shownVisible={shownVisible}
        hide={hide}
        hideCircuit={hideCircuit}
        circuitLocked={circuitLocked}
        editable={state.mode === 'challenge' && modes.challenge ? modes.challenge.editable : undefined}
        modePanel={
          <>
            {modePanel()}
            {state.mode === 'learn' && modes.lesson && state.showEnergy && <EnergyView model={rectifierEnergy(result, explanation.sample, comparison.measurements)} />}
          </>
        }
        modeTitle={MODE_LABEL[state.mode]}
        whyDetail={
          <>
            {explanation.firing && !three && <FiringPanel ex={explanation} params={state.params} circuitId={circuitId} measurements={comparison.measurements} />}
            <WhyPanel result={result} ex={explanation} detailed={state.whyOpen} onToggleDetailed={() => dispatch({ type: 'toggleWhy' })} onLens={() => dispatch({ type: 'setLens', stage: 0 })} lens={lensPanel} />
          </>
        }
        statePanel={
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
        }
        learnPanel={
          <LearnTab
            section={state.section}
            completed={modes.completed}
            onOpen={(l) => {
              dispatch({ type: 'setMode', mode: 'learn' })
              modes.startLesson(l)
            }}
          />
        }
        stepThrough={
          fwFitted && stepOn && !answersHidden ? (
            <StepThrough result={result} cursorTime={state.cursorTime} playing={state.playing} onCursor={(t) => setCursor(t, true)} onPlay={play} onPause={pause} onClose={() => setStepOn(false)} />
          ) : null
        }
        onLand={(t) => {
          // an event's own time → the sample the trace confirms shows the new state (as the Events list)
          dispatch({ type: 'pause' })
          const g = groups.find((x) => x.events.some((e) => e.time === t))
          setCursor(g ? result.trace.time[groupIndex(result, g)] : t, true)
        }}
        scopeViews={scopeViews}
        scopeView={scopeView}
        hint={{ seen: hintSeen, dismiss: dismissHint }}
        fwCircuit={fwCircuit}
        std={std}
        angleOf={angleOf}
        onCursor={(t) => setCursor(t, true)}
        onAngle={(deg) => {
          dispatch({ type: 'pause' })
          setCursor(resolveTarget(result, { angleDeg: deg }), true)
        }}
        onStep={step}
        onSelectGroup={selectGroup}
        onToggleChannel={toggleChannel}
        onPreset={setPreset}
        onToggleFreewheel={toggleFreewheel}
        lensHighlight={lens && state.lensStage !== null ? lens[state.lensStage].highlight : null}
        notice={noticeOpen ? <CarryNotice report={carryReport} onDismiss={() => setNoticeOpen(false)} /> : null}
        body={state.mode === 'compare' ? <CompareLab /> : undefined}
      />
    )

  // the workspace opens on a running circuit (initialState runs it); nothing to show before that
  return null
}
