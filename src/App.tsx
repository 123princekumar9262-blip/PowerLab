import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { CircuitDiagram } from './components/CircuitDiagram.tsx'
import { EventDetail, EventStrip } from './components/EventPanels.tsx'
import { Header } from './components/Header.tsx'
import { MeasurementTable } from './components/MeasurementTable.tsx'
import { ParameterPanel } from './components/ParameterPanel.tsx'
import { Scope } from './components/Scope.tsx'
import { StatePanel } from './components/StatePanel.tsx'
import { Transport } from './components/Transport.tsx'
import { getExplainer } from './explanations/index.ts'
import { compareWithTheory } from './measurements/compare.ts'
import { indexAtTime, runSimulation } from './simulation/engine.ts'
import { sanitizeParams } from './simulation/params.ts'
import { sineSource } from './simulation/source.ts'
import { initialLabState, labReducer } from './state/labState.ts'
import { stepTarget } from './state/stepping.ts'
import { usePlayback } from './state/usePlayback.ts'
import type { CircuitId } from './types/simulation.ts'
import { groupEvents, groupIndex, type EventGroup } from './visualization/eventGroups.ts'

export function App() {
  const [state, dispatch] = useReducer(labReducer, initialLabState)
  const circuitId: CircuitId = `${state.topology ?? 'half-wave'}:${state.load ?? 'R'}`

  // ── Simulation: the single source of truth. Re-runs whenever parameters change. ──
  const result = useMemo(() => (state.hasRun ? runSimulation(state.params, circuitId) : null), [state.hasRun, state.params, circuitId])
  const preview = useMemo(() => sanitizeParams(state.params), [state.params])
  const comparison = useMemo(() => (result ? compareWithTheory(result) : null), [result])
  const groups = useMemo(() => (result ? groupEvents(result) : []), [result])
  const explainer = getExplainer(circuitId)

  const cursorIndex = result ? indexAtTime(result, state.cursorTime) : 0
  const explanation = useMemo(() => (result ? explainer.state(result, cursorIndex) : null), [result, cursorIndex, explainer])
  const viewport = result ? (state.viewport ?? { t0: 0, t1: result.params.duration }) : null

  const setCursor = useCallback((time: number, byUser = false) => dispatch({ type: 'setCursor', time, byUser }), [])

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
      />

      {!result || !explanation || !viewport || !comparison ? (
        <main className="intro">
          <section className="bench bench--intro">
            {state.topology && state.load ? (
              <>
                <CircuitDiagram sample={null} params={preview.params} ioPeak={0} pPeak={0} />
                <p className="intro-caption">
                  Half-wave rectifier with a resistive load is on the bench. Press <b>Run simulation</b> — every waveform, highlight
                  and explanation you will see comes from solving this circuit, instant by instant.
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
            <ParameterPanel
              params={state.params}
              resolved={result.params}
              issues={result.diagnostics.issues}
              computeMs={result.diagnostics.computeMs}
              samples={result.trace.length}
              onChange={(params) => dispatch({ type: 'setParams', params })}
              onReset={() => dispatch({ type: 'resetParams' })}
            />
          </aside>

          <div className="col-main">
            <section className="bench" aria-label="Circuit">
              <CircuitDiagram sample={explanation.sample} params={result.params} ioPeak={m!.ioPeak} pPeak={m!.voutPeak * m!.ioPeak} />
            </section>

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
                onToggleSignal={(signal) => dispatch({ type: 'toggleSignal', signal })}
                showConduction={state.showConduction}
                groups={groups}
                selectedGroupId={state.selectedEventGroupId}
                onSelectGroup={selectGroup}
              />
              <div className="instrument-foot">
                <label className="check">
                  <input type="checkbox" checked={state.showConduction} onChange={() => dispatch({ type: 'toggleConduction' })} />
                  Shade D1 conduction
                </label>
                <EventStrip groups={visibleGroups} selectedId={state.selectedEventGroupId} onSelect={selectGroup} />
              </div>
            </section>

            <MeasurementTable comparison={comparison} />
          </div>

          <aside className="col-state">
            {selectedGroup && (
              <EventDetail
                group={selectedGroup}
                angleDeg={sineSource(result.params).angleDeg(selectedGroup.time)}
                explanations={selectedGroup.events.map((e) => explainer.event(result, e))}
                onClose={() => dispatch({ type: 'selectEventGroup', id: null })}
              />
            )}
            <StatePanel ex={explanation} whyOpen={state.whyOpen} onToggleWhy={() => dispatch({ type: 'toggleWhy' })} />
          </aside>
        </main>
      )}
    </div>
  )
}
