import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { CircuitDiagram } from './components/CircuitDiagram.tsx'
import { EnergyPanel } from './components/EnergyPanel.tsx'
import { EventDetail, EventStrip } from './components/EventPanels.tsx'
import { Header } from './components/Header.tsx'
import { MeasurementTable } from './components/MeasurementTable.tsx'
import { ParameterPanel } from './components/ParameterPanel.tsx'
import { Scope } from './components/Scope.tsx'
import { StatePanel } from './components/StatePanel.tsx'
import { Transport } from './components/Transport.tsx'
import { ChallengePanel } from './components/modes/ChallengePanel.tsx'
import { LessonPanel } from './components/modes/LessonPanel.tsx'
import { PredictPanel } from './components/modes/PredictPanel.tsx'
import { useModes } from './state/useModes.ts'
import { ExperimentPanel } from './components/modes/ExperimentPanel.tsx'
import { WhatIfPanel } from './components/modes/WhatIfPanel.tsx'
import { ReversePanel } from './components/modes/ReversePanel.tsx'
import { AngleView } from './components/AngleView.tsx'
import { PhysicsLens } from './components/PhysicsLens.tsx'
import { lensStages } from './explanations/lens.ts'
import { resolveTarget } from './learning/target.ts'
import { isThreePhase } from './types/simulation.ts'
import { getExplainer } from './explanations/index.ts'
import { compareWithTheory } from './measurements/compare.ts'
import { indexAtTime, runSimulation } from './simulation/engine.ts'
import { sanitizeParams } from './simulation/params.ts'
import { sineSource } from './simulation/source.ts'
import { circuitIdOf, initialLabState, labReducer } from './state/labState.ts'
import { stepTarget } from './state/stepping.ts'
import { usePlayback } from './state/usePlayback.ts'
import { getModel } from './circuits/registry.ts'
import { SIGNAL_META } from './visualization/signals.ts'
import { groupEvents, groupIndex, type EventGroup } from './visualization/eventGroups.ts'

export function App() {
  const [state, dispatch] = useReducer(labReducer, initialLabState)
  const circuitId = circuitIdOf(state)

  // ── Simulation: the single source of truth. Re-runs whenever parameters change. ──
  const result = useMemo(() => (state.hasRun ? runSimulation(state.params, circuitId) : null), [state.hasRun, state.params, circuitId])
  const preview = useMemo(() => sanitizeParams(state.params, circuitId), [state.params, circuitId])
  const comparison = useMemo(() => (result ? compareWithTheory(result) : null), [result])
  const groups = useMemo(() => (result ? groupEvents(result) : []), [result])
  const explainer = getExplainer(circuitId)

  const channels = useMemo(
    () => (result ? result.signalIds.filter((sid) => state.showEnergy || !SIGNAL_META[sid].advanced) : []),
    [result, state.showEnergy],
  )
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

  const selectedGroup = groups.find((g) => g.id === state.selectedEventGroupId) ?? null
  const visibleGroups = viewport ? groups.filter((g) => g.time >= viewport.t0 && g.time <= viewport.t1) : []
  const m = comparison?.measurements

  return (
    <div className="app">
      <Header
        state={state}
        onTopology={(topology) => dispatch({ type: 'chooseTopology', topology })}
        onLoad={(load) => dispatch({ type: 'chooseLoad', load })}
        onRun={onRun}
        onMode={(mode) => dispatch({ type: 'setMode', mode })}
        onSection={(section) => dispatch({ type: 'setSection', section })}
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
        <main className="lab">
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
            />
            )}
          </aside>

          <div className="col-main">
            {hideCircuit ? (
              <section className="bench instrument--hidden" aria-label="Circuit (hidden)">
                <p className="intro-lead">The circuit is hidden.</p>
                <p className="muted">Read the waveforms below and answer the questions on the right.</p>
              </section>
            ) : (
            <section className="bench" aria-label="Circuit">
              <div className="bench-bar">
                <h2 className="bench-title">{getModel(circuitId).name}</h2>
                <button className={`text-btn energy-toggle ${state.showEnergy ? 'is-on' : ''}`} aria-pressed={state.showEnergy} onClick={() => dispatch({ type: 'toggleEnergy' })}>
                  ⚡ Energy view
                </button>
              </div>
              <CircuitDiagram topology={result.params.topology} load={result.params.load} sample={hide ? null : explanation.sample} result={hide ? null : result} params={result.params} lens={lens && state.lensStage !== null ? lens[state.lensStage].highlight : null} />
            </section>
            )}

            {isThreePhase(result.params.topology) && !hide && !hideCircuit && (
              <AngleView
                result={result}
                angleDeg={explanation.angleDeg}
                onAngle={(deg) => {
                  dispatch({ type: 'pause' })
                  setCursor(resolveTarget(result, { angleDeg: deg }), true)
                }}
              />
            )}

            {state.showEnergy && !hide && !hideCircuit && <EnergyPanel result={result} sample={explanation.sample} measurements={m!} />}

            {hide ? (
              <section className="instrument instrument--hidden" aria-label="Oscilloscope (hidden)">
                <p className="intro-lead">The oscilloscope is covered until you reveal your prediction.</p>
                <p className="muted">Sketch the output on the right and estimate the numbers — then compare with the simulation.</p>
              </section>
            ) : (
            <section className="instrument" aria-label="Oscilloscope">
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
              <Scope
                result={result}
                viewport={viewport}
                onViewport={(vp) => dispatch({ type: 'setViewport', viewport: vp })}
                cursorIndex={cursorIndex}
                onCursorTime={(t) => setCursor(t, true)}
                onScrubStart={() => {
                  dispatch({ type: 'pause' })
                  if (state.selectedEventGroupId) dispatch({ type: 'selectEventGroup', id: null })
                }}
                visible={state.visible}
                channels={shownChannels}
                layoutMode={state.layoutMode}
                onLayoutMode={(mode) => dispatch({ type: 'setLayoutMode', mode })}
                onToggleSignal={(signal) => dispatch({ type: 'toggleSignal', signal })}
                showConduction={state.showConduction}
                groups={hideCircuit ? [] : groups}
                selectedGroupId={state.selectedEventGroupId}
                onSelectGroup={selectGroup}
              />
              <div className="instrument-foot">
                <label className="check">
                  <input type="checkbox" checked={state.showConduction} onChange={() => dispatch({ type: 'toggleConduction' })} />
                  Shade D1 conduction
                </label>
                <EventStrip groups={hideCircuit ? [] : visibleGroups} selectedId={state.selectedEventGroupId} onSelect={selectGroup} />
              </div>
            </section>
            )}

            {!hide && !hideCircuit && <MeasurementTable comparison={comparison} />}
          </div>

          <aside className="col-state">
            {lens && state.lensStage !== null && !hide && !hideCircuit && (
              <PhysicsLens stages={lens} stage={state.lensStage} onStage={(k) => dispatch({ type: 'setLens', stage: k })} onClose={() => dispatch({ type: 'setLens', stage: null })} />
            )}
            {state.mode === 'learn' && (
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
            )}
            {state.mode === 'challenge' && (
              <ChallengePanel
                section={state.section}
                challenge={modes.challenge}
                result={modes.challengeResult}
                best={modes.bestStars}
                onStart={modes.startChallenge}
                onExit={modes.exitChallenge}
                onSubmit={modes.submitChallenge}
              />
            )}
            {state.mode === 'experiment' && (
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
              />
            )}
            {state.mode === 'predict' && (
              <div className="seg seg--full predict-tabs" role="tablist" aria-label="Prediction type">
                {(['whatif', 'sketch'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={modes.predictTab === t} className={modes.predictTab === t ? 'on' : ''} onClick={() => modes.setPredictTab(t)}>
                    {t === 'whatif' ? 'What if…?' : 'Sketch the output'}
                  </button>
                ))}
              </div>
            )}
            {state.mode === 'predict' && modes.predictTab === 'whatif' && <WhatIfPanel section={state.section} onShowInLab={modes.showWhatIfInLab} />}
            {state.mode === 'reverse' && modes.reverse && modes.reverseAns && (
              <ReversePanel
                task={modes.reverse.task}
                answers={modes.reverseAns}
                revealed={modes.reverse.revealed}
                onReveal={modes.revealReverse}
                onNext={modes.newReverse}
                onExplore={() => dispatch({ type: 'setMode', mode: 'lab' })}
              />
            )}
            {state.mode === 'predict' && modes.predictTab === 'sketch' && modes.prediction && (
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
            {selectedGroup && !hide && !hideCircuit && (
              <EventDetail
                group={selectedGroup}
                angleDeg={sineSource(result.params).angleDeg(selectedGroup.time)}
                explanations={selectedGroup.events.map((e) => explainer.event(result, e))}
                onClose={() => dispatch({ type: 'selectEventGroup', id: null })}
              />
            )}
            {!hide && !hideCircuit && <StatePanel
                ex={explanation}
                signalIds={result.signalIds}
                topology={result.params.topology}
                whyOpen={state.whyOpen}
                onToggleWhy={() => dispatch({ type: 'toggleWhy' })}
                lensOn={state.lensStage !== null}
                onToggleLens={() => dispatch({ type: 'setLens', stage: state.lensStage === null ? 0 : null })}
              />}
          </aside>
        </main>
      )}
    </div>
  )
}
