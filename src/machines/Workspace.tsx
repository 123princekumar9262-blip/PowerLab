import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isFirstVisit, markSeen, useLevel } from '../shell/prefs.ts'
import { href } from '../shell/router.ts'
import { Crumbs } from '../shell/ui.tsx'
import { machineCrumbs } from './crumbs.ts'
import { assemblyOf, disassemblyMoves, inspectOffset, pullOffsets, labelOf, parentOf, partMatches, partsIn, roots, stageCount, type Move } from './hierarchy.ts'
import { MODEL_LOADERS } from './models/index.ts'
import { noteOpened } from './progress.ts'
import { QuizPanel } from './learning/Quiz.tsx'
import type { CalcResult, LayerId, MachineDef, MachineEntry, MLevel } from './types.ts'
import type { AnimRef } from './viewer/context.tsx'
import { MachineViewer, webglAvailable, type CameraCmd } from './viewer/MachineViewer.tsx'

type Tab = 'explore' | 'learn' | 'calculate' | 'details' | 'check'
const TABS: Array<[Tab, string]> = [
  ['explore', 'Explore'],
  ['learn', 'How it works'],
  ['calculate', 'Calculate'],
  ['details', 'Details'],
  ['check', 'Check'],
]
const RANK: Record<MLevel, number> = { beginner: 0, standard: 1, engineer: 2 }
/** The Explore animation toggle, in the words of each kind of device (nothing rotates in a transformer). */
const ANIM_LABEL: Record<MachineEntry['family'], string> = {
  dc: 'Turn the rotor',
  ac: 'Turn the rotor',
  modern: 'Turn the rotor',
  transformer: 'Animate the AC cycle',
  magnetic: 'Animate the current',
  semiconductor: 'Animate the carriers',
  system: 'Run the system',
}

/** Loads a machine's model (lazy) and shows its workspace. */
export default function Workspace({ entry, tab }: { entry: MachineEntry; tab?: string }) {
  const [def, setDef] = useState<MachineDef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setError(null)
    const load = MODEL_LOADERS[entry.id]
    if (!load) return setError('This model is not available.')
    load()
      .then((m) => live && setDef(m.default))
      .catch((e: Error) => live && setError(e.message || 'The model could not be loaded.'))
    noteOpened(entry.id)
    return () => {
      live = false
    }
  }, [entry.id, attempt])
  if (error)
    return (
      <div className="page page--narrow">
        <Crumbs items={machineCrumbs(entry.id, entry.name)} />
        <h1 tabIndex={-1}>{entry.name}</h1>
        <div className="mx-fallback" role="alert">
          <p>The 3D model could not be loaded: {error}</p>
          <button className="btn" onClick={() => setAttempt(attempt + 1)}>
            Retry
          </button>
        </div>
      </div>
    )
  if (!def) return <div className="ws-loading" role="status">Loading the 3D model of the {entry.name}…</div>
  return <MachineWorkspace entry={entry} def={def} initialTab={(TABS.find(([t]) => t === tab)?.[0] ?? 'explore') as Tab} />
}

const EMPTY = new Set<string>()
/** What each standard view shows (toolbar tooltips). */
const VIEW_TIP: Record<'front' | 'side' | 'top' | 'iso', string> = {
  front: 'Look at the front (along the shaft, for machines)',
  side: 'Look from the side',
  top: 'Look from above',
  iso: 'Three-quarter 3D view',
}
const EMPTY_PULLS = new Map<string, [number, number, number]>()
/** How long the tour shows a step when it plays through [ms]. */
const STEP_MS = 9000

function MachineWorkspace({ entry, def, initialTab }: { entry: MachineEntry; def: MachineDef; initialTab: Tab }) {
  const level = useLevel()
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const hasGl = useMemo(webglAvailable, [])
  const stages = stageCount(def)
  // the explode axis runs move by move (one part, or parts that come off together, at a time): 0 … N
  const moves = useMemo(() => disassemblyMoves(def), [def])
  const N = Math.max(1, moves.length)

  const [tab, setTab] = useState<Tab>(initialTab)
  const [selected, setSelected] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // parts (or assemblies) pulled out on their own for inspection — independent of the disassembly
  const [pulled, setPulled] = useState<Set<string>>(new Set())
  const pulls = useMemo(() => pullOffsets(def, pulled), [def, pulled])
  const [showInside, setShowInside] = useState(false)
  const [isolate, setIsolate] = useState(false)
  const [showRelated, setShowRelated] = useState(true)
  const [labels, setLabels] = useState<'off' | 'focus' | 'all'>('focus')
  const [layers, setLayers] = useState<Set<LayerId>>(new Set())
  // explode: where the assembly is heading (0 … stages); shown: where it is now (follows the animation)
  const [explode, setExplode] = useState(0)
  const [shown, setShown] = useState(0)
  const [explodeRate, setExplodeRate] = useState(1)
  const [fadeOthers, setFadeOthers] = useState(true)
  const [maxed, setMaxed] = useState(false)
  const [panelOff, setPanelOff] = useState(false)
  const wsRef = useRef<HTMLElement>(null)
  const [camera, setCamera] = useState<CameraCmd>({ kind: 'reset', nonce: 0 })
  const [inspecting, setInspecting] = useState(false)
  // how large the selection looks on screen [px]: a small one is offered a closer look
  const [selPx, setSelPx] = useState(0)
  // a short "getting around" hint, once (part of the first-visit essentials, which Help & settings can switch off)
  const [hint, setHint] = useState(() => isFirstVisit('machines-viewer'))
  const closeHint = () => {
    markSeen('machines-viewer')
    setHint(false)
  }
  const [stepIdx, setStepIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // a new run of the step timer (Replay restarts it even while playing)
  const [run, setRun] = useState(0)
  const [offLayers, setOffLayers] = useState<Set<LayerId>>(new Set())
  const [spin, setSpin] = useState(false)
  const [params, setParams] = useState<Record<string, number>>(() => Object.fromEntries(def.params.map((p) => [p.id, p.value])))
  const [quizPart, setQuizPart] = useState<string | null>(null)
  const anim = useRef<AnimRef>({ angle: 0, time: 0, playing: false, omega: -1.2, explode: 0, explodeTarget: 0, explodeRate: 1 })
  const kick = useRef<() => void>(() => {})
  const cam = (kind: CameraCmd['kind'], ids?: string[]) => setCamera((c) => ({ kind, ids, nonce: c.nonce + 1 }))
  // the camera stepped back automatically to keep a disassembled machine in view (undone when it is together)
  const fitted = useRef(false)

  const calc: CalcResult[] = useMemo(() => def.calc(params), [def, params])
  const calcMap = useMemo(() => Object.fromEntries(calc.map((c) => [c.id, c.value])), [calc])
  const motion = def.motion?.(calcMap, params)

  const step = tab === 'learn' ? def.steps[stepIdx] : null
  const focus = useMemo(() => new Set(step ? step.focus.flatMap((id) => partsIn(def, id)) : quizPart ? partsIn(def, quizPart) : []), [def, step, quizPart])
  // the layers (arrows, flux, carriers) belong to the assembled machine: none while it is taken apart
  const exploded = shown > 0 || explode > 0
  const activeLayers = exploded ? new Set<LayerId>() : step ? new Set(step.layers.filter((l) => !offLayers.has(l))) : layers
  // the rotor turns: while a learning step that rotates is played, or while "Turn the rotor" is on (Explore)
  // a machine with parts pulled out does not run
  const turning = tab === 'learn' ? playing && !!step?.rotate : spin && pulled.size === 0
  const shownSelected = tab === 'check' ? quizPart : selected
  const selectedParts = useMemo(() => (shownSelected ? new Set(partsIn(def, shownSelected)) : EMPTY), [def, shownSelected])
  const moving = shown !== explode
  const activeMove: Move | undefined = moves[Math.min(N, Math.max(0, Math.ceil(shown - 1e-6))) - 1]
  const part = selected ? def.parts.find((p) => p.id === selected) : undefined
  // soft highlight: the parts the selected part works with, or (nothing selected) the parts of the stage just taken off
  const glow = useMemo(() => {
    if (tab !== 'explore') return EMPTY
    if (selected) return showRelated ? new Set((part?.relations?.map((r) => r.id) ?? part?.related ?? []).filter((id) => !selectedParts.has(id))) : EMPTY
    if (activeMove && !moving) return new Set(activeMove.parts)
    return EMPTY
  }, [tab, selected, showRelated, part, selectedParts, activeMove, moving])

  // the animation ref follows the React state
  useEffect(() => {
    const a = anim.current
    a.playing = turning && !reducedMotion
    a.omega = motion?.omega ?? -1.2
    a.explodeTarget = explode
    a.explodeRate = explodeRate
    kick.current()
  }, [turning, reducedMotion, motion?.omega, explode, explodeRate])
  // follow the assembly while it moves (only then: a still assembly costs nothing)
  useEffect(() => {
    const a = anim.current
    if (reducedMotion || a.explode === explode) {
      setShown(explode)
      return
    }
    let raf = 0
    const tick = () => {
      setShown(a.explode)
      if (a.explode !== a.explodeTarget) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [explode, reducedMotion])
  // when the parts have stopped: keep every part in the frame (step back if needed), and come back in once together
  const settled = !moving
  useEffect(() => {
    if (!settled) return
    if (explode > 0) {
      cam('fit')
      fitted.current = true
    } else if (fitted.current) {
      cam('unfit')
      fitted.current = false
    }
  }, [settled, explode])
  // a hidden tab stops the animation (nothing runs in the background)
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        setPlaying(false)
        setSpin(false)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      anim.current.playing = false
    }
  }, [])
  // how it works: playing runs the current step for STEP_MS, then moves on (the last step stops at its end)
  useEffect(() => {
    if (tab !== 'learn' || !playing) return
    const t0 = performance.now() - elapsed
    const id = window.setInterval(() => {
      const e = performance.now() - t0
      if (e < STEP_MS) return setElapsed(e)
      if (stepIdx < def.steps.length - 1) {
        setStepIdx(stepIdx + 1)
        setElapsed(0)
      } else {
        setElapsed(STEP_MS)
        setPlaying(false)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [tab, playing, stepIdx, run, def.steps.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // a new step shows all of its layers again
  useEffect(() => setOffLayers(new Set()), [stepIdx])
  // each step turns the view to where its working is best seen (the camera glides; a view chosen here is not undone)
  const stepView = tab === 'learn' ? def.steps[stepIdx]?.view : undefined
  useEffect(() => {
    if (!stepView) return
    fitted.current = false
    stepTurned.current = true
    setInspecting(false)
    cam(stepView)
  }, [stepView, stepIdx]) // eslint-disable-line react-hooks/exhaustive-deps
  // a part pulled out must stay in view: once it has arrived, step back if needed; come back in when all are back
  useEffect(() => {
    if (tab !== 'explore') return
    const t = window.setTimeout(() => {
      if (pulled.size > 0) {
        cam('fit')
        fitted.current = true
      } else if (fitted.current && explode === 0) {
        cam('unfit')
        fitted.current = false
      }
    }, reducedMotion ? 50 : 900)
    return () => window.clearTimeout(t)
  }, [pulled]) // eslint-disable-line react-hooks/exhaustive-deps
  // leaving How it works: back to the usual view, if a step had turned the camera
  const stepTurned = useRef(false)
  useEffect(() => {
    if (tab !== 'learn' && stepTurned.current) {
      stepTurned.current = false
      cam('reset')
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  // while the parts come off one by one, step back as soon as one would leave the frame
  const moveNo = activeMove?.slot ?? 0
  useEffect(() => {
    if (moveNo > 0 && explode > shown) {
      cam('fit')
      fitted.current = true
    }
  }, [moveNo]) // eslint-disable-line react-hooks/exhaustive-deps
  // full view: the 3D area fills the screen (browser full screen where allowed); Esc leaves it
  const leaveMax = () => {
    setMaxed(false)
    setPanelOff(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  const toggleMax = () => {
    if (maxed) return leaveMax()
    setMaxed(true)
    wsRef.current?.requestFullscreen?.().catch(() => {})
  }
  useEffect(() => {
    if (!maxed) return
    const onFs = () => {
      if (!document.fullscreenElement) {
        setMaxed(false)
        setPanelOff(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leaveMax()
    }
    document.addEventListener('fullscreenchange', onFs)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      window.removeEventListener('keydown', onKey)
    }
  }, [maxed]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    },
    [],
  )
  useEffect(() => {
    if (tab !== 'check') setQuizPart(null)
    if (tab !== 'learn') setPlaying(false)
    if (tab === 'learn') setLessonReturn(null)
    if (tab !== 'explore' && tab !== 'learn') setPanelOff(false)
    // how it works and the checks show the assembled machine (their arrows and markers belong to it)
    if (tab === 'learn' || tab === 'check') {
      setExplode(0)
      setIsolate(false)
    }
  }, [tab])

  const select = (id: string | null) => {
    setSelected(id)
    if (!id) setIsolate(false)
    // during a lesson, looking at a part pauses it (Resume carries on from the same moment)
    if (id && tab === 'learn') setPlaying(false)
  }
  // the lesson step a student left to inspect a part in Explore (Back to the lesson returns to it)
  const [lessonReturn, setLessonReturn] = useState<number | null>(null)
  const lessonTitle = useRef<HTMLHeadingElement>(null)
  const backToLesson = () => {
    setLessonReturn(null)
    setTab('learn')
    window.setTimeout(() => lessonTitle.current?.focus(), 50)
  }
  const hide = (id: string, h: boolean) => {
    const next = new Set(hidden)
    for (const x of partsIn(def, id)) h ? next.add(x) : next.delete(x)
    setHidden(next)
  }
  const jumpTo = (e: number) => {
    // the slider moves the parts directly (no animation): exactly the same positions as the stage steps pass through
    anim.current.explode = e
    setExplode(e)
    setShown(e)
  }
  const resetAll = () => {
    // the reset view replaces any automatic step-back: nothing to undo afterwards
    fitted.current = false
    select(null)
    setHidden(new Set())
    setPulled(new Set())
    setShowInside(false)
    setIsolate(false)
    jumpTo(0)
    setSpin(false)
    setPlaying(false)
    setElapsed(0)
    setLayers(new Set())
    setStepIdx(0)
    setInspecting(false)
    cam('reset')
    anim.current.angle = 0
    anim.current.time = 0
    kick.current()
  }
  const goStep = (i: number) => {
    setStepIdx(i)
    setElapsed(0)
  }
  const replayStep = () => {
    anim.current.angle = 0
    setElapsed(0)
    setRun(run + 1)
    setPlaying(true)
    kick.current()
  }
  const resetTour = () => {
    anim.current.angle = 0
    setPlaying(false)
    goStep(0)
    kick.current()
  }
  const toggleLayer = (id: LayerId) => {
    const next = new Set(layers)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setLayers(next)
  }
  const shownLayers = def.layers.filter((l) => activeLayers.has(l.id))
  const lastStep = stepIdx === def.steps.length - 1
  const finished = lastStep && elapsed >= STEP_MS

  return (
    <main ref={wsRef} className={`mx-ws ${maxed ? 'mx-ws--max' : ''} ${panelOff ? 'mx-ws--nopanel' : ''} ${tab === 'learn' ? 'mx-ws--learn' : ''}`} aria-labelledby="mx-title">
      <header className="mx-head">
        <Crumbs items={machineCrumbs(entry.id, entry.name)} />
        <div className="mx-title-row">
          <h1 id="mx-title" tabIndex={-1}>
            {entry.name}
          </h1>
          <span className="mx-avail mx-avail--ready">Simplified educational model</span>
          <span className="mx-family">
            {entry.subgroup} · {entry.role}
          </span>
          <button className="btn mx-reset" onClick={resetAll} title="Put the model back together, show every part, clear the selection and reset the view">
            Reset model
          </button>
        </div>
        <nav className="mx-tabs" aria-label="Workspace">
          <div role="tablist">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <div className="mx-grid">
        <section className="mx-stage" aria-label="3D model">
          <div className="mx-viewport">
            {hasGl ? (
              <MachineViewer
                def={def}
                anim={anim}
                selected={shownSelected}
                selectedParts={selectedParts}
                onSelect={(id) => tab !== 'check' && select(id)}
                focus={focus}
                glow={glow}
                hidden={tab === 'explore' ? hidden : EMPTY}
                pulls={tab === 'explore' ? pulls : EMPTY_PULLS}
                assembled={!exploded}
                learning={tab === 'learn'}
                fadeOthers={fadeOthers}
                onSelectionSize={setSelPx}
                showInside={showInside}
                isolate={isolate && tab === 'explore'}
                labels={tab === 'check' ? 'off' : labels}
                layers={activeLayers}
                reducedMotion={reducedMotion}
                model={{ layers: activeLayers, calc: calcMap, params, step: step?.id ?? null }}
                camera={camera}
                kick={kick}
              />
            ) : (
              <div className="mx-fallback" role="alert">
                <p>This browser cannot draw 3D (WebGL is off or unsupported).</p>
                <p className="muted small">Every part and every step is still described in the panel beside: use the component list and How it works.</p>
              </div>
            )}
            <div
              className="mx-toolbar"
              role="toolbar"
              aria-label="View"
              onKeyDown={(e) => {
                const k = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'in', '=': 'in', '-': 'out' } as const)[e.key as 'ArrowLeft']
                if (k) {
                  e.preventDefault()
                  cam(k)
                }
              }}
            >
              <span className="mx-orbit" aria-label="Turn the view">
                <button className="mx-tool" onClick={() => cam('left')} aria-label="Turn left" data-tip="Turn the view left (←)">
                  ⟲
                </button>
                <button className="mx-tool" onClick={() => cam('right')} aria-label="Turn right" data-tip="Turn the view right (→)">
                  ⟳
                </button>
                <button className="mx-tool" onClick={() => cam('up')} aria-label="Tilt up" data-tip="Tilt the view up (↑)">
                  ↑
                </button>
                <button className="mx-tool" onClick={() => cam('down')} aria-label="Tilt down" data-tip="Tilt the view down (↓)">
                  ↓
                </button>
                <button className="mx-tool" onClick={() => cam('in')} aria-label="Zoom in" data-tip="Zoom in (+)">
                  +
                </button>
                <button className="mx-tool" onClick={() => cam('out')} aria-label="Zoom out" data-tip="Zoom out (−)">
                  −
                </button>
              </span>
              {(['front', 'side', 'top', 'iso'] as const).filter((k) => def.manifest.views[k]).map((k) => (
                <button key={k} className="mx-tool" onClick={() => (setInspecting(false), cam(k))} data-tip={VIEW_TIP[k]}>
                  {k === 'iso' ? '3D' : k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
              <button className="mx-tool" onClick={() => (setInspecting(false), cam('reset'))} data-tip="Back to the starting view, the whole model in frame">
                Fit
              </button>
              <button className="mx-tool mx-tool--max" onClick={toggleMax} aria-pressed={maxed} data-tip={maxed ? 'Leave the full view (Esc)' : 'Show the 3D view full screen (Esc to leave)'}>
                {maxed ? '⤡ Exit full view' : '⤢ Full view'}
              </button>
              {(tab === 'explore' || tab === 'learn') && (
                <button className="mx-tool" onClick={() => setPanelOff(!panelOff)} aria-pressed={panelOff} data-tip={panelOff ? 'Show the side panel again' : 'Give the model the whole width; the main controls stay on the model'}>
                  {panelOff ? 'Show panel' : 'Hide panel'}
                </button>
              )}
            </div>
            {hint && tab === 'explore' && (
              <div className="mx-first" role="region" aria-label="Getting around the 3D model">
                <p className="mx-first-title">Getting around the 3D model</p>
                <ul>
                  <li>
                    <b>Drag</b> to turn it, <b>scroll</b> to zoom, <b>right-drag</b> to move it — or use the buttons above.
                  </li>
                  <li>
                    <b>Click a part</b> (or pick it under Components) to see what it is and what it does.
                  </li>
                  <li>
                    <b>Pull out</b> moves just that part; <b>Disassemble</b> takes the machine apart one part at a time.
                  </li>
                  <li>
                    <b>How it works</b> explains the working step by step.
                  </li>
                </ul>
                <button className="btn btn--primary" onClick={closeHint}>
                  Got it
                </button>
              </div>
            )}
            {tab === 'explore' && selected && (
              <div className="mx-selchip" role="status">
                <span className="mx-selchip-dot" aria-hidden="true" />
                <span>
                  <b>{labelOf(def, selected)}</b>
                  {parentOf(def, selected) && <span className="muted"> · {parentOf(def, selected)!.label}</span>}
                  {hidden.has(selected) && <span className="muted"> (hidden)</span>}
                </span>
                <button className="mx-selchip-x" onClick={() => select(null)} aria-label="Clear the selection" title="Clear the selection">
                  ✕
                </button>
              </div>
            )}
            {tab === 'learn' && step && (
              <div className="mx-caption" aria-hidden="true">
                <b>
                  {stepIdx + 1}/{def.steps.length} · {step.title.replace(/^\d+ · /, '')}
                </b>
                <span>{step.text.split(/(?<=\.)\s/)[0]}</span>
                {step.equation && <code>{step.equation}</code>}
              </div>
            )}
            {panelOff && tab === 'explore' && (
              <div className="mx-dock" role="group" aria-label="Disassembly">
                <button className="btn" disabled={shown <= 0 && explode <= 0} onClick={() => setExplode(Math.max(0, Math.ceil(Math.min(shown, explode) - 1e-6) - 1))}>
                  ◀ Part
                </button>
                {moving ? (
                  <button className="btn btn--primary" onClick={() => setExplode(anim.current.explode)}>
                    Pause
                  </button>
                ) : explode >= N ? (
                  <button className="btn btn--primary" onClick={() => setExplode(0)}>
                    Reassemble
                  </button>
                ) : (
                  <button className="btn btn--primary" onClick={() => setExplode(N)}>
                    Disassemble
                  </button>
                )}
                <button className="btn" disabled={explode >= N} onClick={() => setExplode(Math.min(N, Math.floor(Math.max(shown, explode) + 1e-6) + 1))}>
                  Part ▶
                </button>
                {activeMove && <span className="mx-dock-now">{activeMove.parts.map((id) => labelOf(def, id)).join(' + ')}</span>}
              </div>
            )}
            {panelOff && tab === 'learn' && (
              <div className="mx-dock" role="group" aria-label="How it works">
                <button className="btn" disabled={stepIdx === 0} onClick={() => goStep(stepIdx - 1)}>
                  ← Previous
                </button>
                <button className="btn btn--primary" onClick={() => (playing ? setPlaying(false) : (finished && goStep(0), setPlaying(true)))}>
                  {playing ? 'Pause' : elapsed > 0 && !finished ? 'Resume' : 'Start'}
                </button>
                <button className="btn" disabled={lastStep} onClick={() => goStep(stepIdx + 1)}>
                  Next →
                </button>
              </div>
            )}
            <p className={`mx-hint small ${(tab === 'explore' && selected) || tab === 'learn' || panelOff ? 'mx-hint--off' : ''}`}>Drag to rotate · scroll to zoom · right-drag to pan · click a part · keyboard: arrow keys on the toolbar</p>
          </div>
          {exploded && (layers.size > 0 || (step?.layers.length ?? 0) > 0) && <p className="small muted mx-motion">The field, current and force layers are shown on the assembled machine — reassemble it to see them.</p>}
          {tab === 'explore' && def.layers.length > 0 && (
            <div className="mx-legend mx-legend--explore" aria-label="Show on the model">
              <p className="mx-legend-head">
                <b>Show on the model</b> <span className="muted">— tick a layer to draw it; each one is explained here</span>
              </p>
              <div className="mx-toggles mx-layer-row">
                {def.layers.map((l) => (
                  <label key={l.id} className="toggle">
                    <input type="checkbox" checked={layers.has(l.id)} onChange={() => toggleLayer(l.id)} /> {l.label}
                    {l.conceptual && <span className="mx-concept">conceptual</span>}
                  </label>
                ))}
              </div>
              {shownLayers.map((l) => (
                <p key={l.id}>
                  <b>{l.label}</b>
                  {l.conceptual && <span className="mx-concept">conceptual</span>} {l.legend}
                </p>
              ))}
            </div>
          )}
          {tab !== 'explore' && shownLayers.length > 0 && (
            <div className="mx-legend" aria-label="Legend">
              {shownLayers.map((l) => (
                <p key={l.id}>
                  <b>{l.label}</b>
                  {l.conceptual && <span className="mx-concept">conceptual</span>} {l.legend}
                </p>
              ))}
            </div>
          )}
          {motion && (turning || tab === 'calculate') && <p className="small muted mx-motion">{motion.note}</p>}
        </section>

        <aside className="mx-panel" aria-label="Details">
          {tab === 'explore' && (
            <section className="mx-explore">
              {lessonReturn !== null && def.steps[lessonReturn] && (
                <div className="mx-back-lesson">
                  <span className="small">
                    From the lesson — <b>{def.steps[lessonReturn].title}</b>
                  </span>
                  <button className="btn btn--primary" onClick={backToLesson}>
                    ← Back to the lesson
                  </button>
                </div>
              )}
              <div className="mx-block">
                <p className="eyebrow">Components</p>
                <ComponentTree def={def} selected={selected} onSelect={select} hidden={hidden} onHide={hide} pulled={pulled} />
                {pulled.size > 0 && (
                  <p className="small mx-hidden-note mx-pulled-note">
                    Pulled out: {[...pulled].map((id) => labelOf(def, id)).join(', ')} ·{' '}
                    <button className="mx-link" onClick={() => setPulled(new Set())}>
                      Put all back
                    </button>
                  </p>
                )}
                {hidden.size > 0 && (
                  <p className="small mx-hidden-note">
                    {hidden.size} part{hidden.size === 1 ? '' : 's'} hidden ·{' '}
                    <button className="mx-link" onClick={() => setHidden(new Set())}>
                      Show all parts
                    </button>
                  </p>
                )}
              </div>
              {selected && (
                <PartCard
                  def={def}
                  id={selected}
                  hidden={partsIn(def, selected).every((x) => hidden.has(x))}
                  isolate={isolate}
                  inspecting={inspecting}
                  small={!inspecting && selPx > 0 && selPx < 60}
                  onSelect={select}
                  onIsolate={() => setIsolate(!isolate)}
                  onHide={(h) => hide(selected, h)}
                  pulled={pulled.has(selected)}
                  canPull={!!inspectOffset(def, selected)}
                  onPull={() => {
                    const n = new Set(pulled)
                    if (n.has(selected)) n.delete(selected)
                    else n.add(selected)
                    setPulled(n)
                  }}
                  onInspect={() => {
                    setInspecting(true)
                    cam('inspect', partsIn(def, selected))
                  }}
                  onBack={() => {
                    setInspecting(false)
                    cam('back')
                  }}
                  onLearn={() => setTab('learn')}
                />
              )}
              <div className="mx-block">
                <p className="eyebrow">Disassembly</p>
                <div className="mx-explode">
                  {moving && explode > shown ? (
                    <button className="btn btn--primary" onClick={() => setExplode(anim.current.explode)}>
                      Pause
                    </button>
                  ) : (
                    <button className="btn btn--primary" disabled={explode >= N} onClick={() => setExplode(N)} title="Take every part off, one at a time, in the order a technician would">
                      Disassemble
                    </button>
                  )}
                  {moving && explode < shown ? (
                    <button className="btn" onClick={() => setExplode(anim.current.explode)}>
                      Pause
                    </button>
                  ) : (
                    <button className="btn" disabled={explode <= 0} onClick={() => setExplode(0)}>
                      Reassemble
                    </button>
                  )}
                </div>
                <div className="mx-explode">
                  <button className="btn" disabled={shown <= 0 && explode <= 0} onClick={() => setExplode(Math.max(0, Math.ceil(Math.min(shown, explode) - 1e-6) - 1))} title="Put the last part back">
                    ◀ Previous part
                  </button>
                  <button className="btn" disabled={explode >= N} onClick={() => setExplode(Math.min(N, Math.floor(Math.max(shown, explode) + 1e-6) + 1))} title="Take the next part off">
                    Next part ▶
                  </button>
                </div>
                <label className="mx-slider">
                  <span>Separation</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((shown / N) * 100)}
                    aria-valuetext={`${Math.round((shown / N) * 100)} % apart`}
                    onChange={(e) => jumpTo((Number(e.target.value) / 100) * N)}
                  />
                  <output>{Math.round((shown / N) * 100)} %</output>
                </label>
                <StageNote def={def} move={activeMove} moves={N} stages={stages} moving={moving} apart={explode > shown} onSelect={select} />
                <label className="mx-inline small">
                  Speed
                  <select value={explodeRate} onChange={(e) => setExplodeRate(Number(e.target.value))}>
                    <option value={0.45}>Slow</option>
                    <option value={1}>Normal</option>
                    <option value={2.5}>Fast</option>
                  </select>
                </label>
              </div>
              <div className="mx-block">
                <p className="eyebrow">View</p>
                <div className="mx-toggles">
                  {def.parts.some((x) => x.outer) && (
                    <label className="toggle">
                      <input type="checkbox" checked={showInside} onChange={(e) => setShowInside(e.target.checked)} /> Show the inside (hide the casing)
                    </label>
                  )}
                  <label className="toggle">
                    <input type="checkbox" checked={fadeOthers} onChange={(e) => setFadeOthers(e.target.checked)} /> Fade the other parts when one is selected
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={showRelated} onChange={(e) => setShowRelated(e.target.checked)} /> Highlight the parts a selected part works with
                  </label>
                  <label className="mx-inline">
                    Labels
                    <select value={labels} onChange={(e) => setLabels(e.target.value as 'off' | 'focus' | 'all')}>
                      <option value="focus">Selected part</option>
                      <option value="all">All parts</option>
                      <option value="off">None</option>
                    </select>
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={spin} disabled={reducedMotion || pulled.size > 0} onChange={(e) => setSpin(e.target.checked)} /> {ANIM_LABEL[entry.family]}
                    {pulled.size > 0 && <span className="muted small"> — put the pulled-out parts back first</span>}
                  </label>
                </div>
              </div>
            </section>
          )}
          {tab === 'learn' && step && (
            <section className="mx-learn" aria-live="polite">
              <div className="step-bar" role="progressbar" aria-valuemin={1} aria-valuemax={def.steps.length} aria-valuenow={stepIdx + 1} aria-label={`Step ${stepIdx + 1} of ${def.steps.length}`}>
                {def.steps.map((s, k) => (
                  <span key={s.id} className={k < stepIdx ? 'done' : k === stepIdx ? 'on' : ''} />
                ))}
              </div>
              <p className="eyebrow">
                Step {stepIdx + 1} of {def.steps.length}
                {playing ? ' · playing' : elapsed > 0 && !finished ? ' · paused' : ''}
              </p>
              <h2 ref={lessonTitle} tabIndex={-1}>
                {step.title}
              </h2>
              <p>{step.text}</p>
              {step.equation && <p className="mx-eq">{step.equation}</p>}
              {step.equation && (
                <details className="mx-assume">
                  <summary>Assumptions behind the relation</summary>
                  <ul>
                    {def.content.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              )}
              {step.detail && RANK[level] >= 2 && <p className="small muted">{step.detail}</p>}
              {step.focus.length > 0 && (
                <p className="small">
                  <b>Highlighted:</b>{' '}
                  {step.focus.map((id, k) => (
                    <span key={id}>
                      {k > 0 && ', '}
                      <button className={`mx-link ${selected === id ? 'mx-link--on' : ''}`} aria-pressed={selected === id} onClick={() => select(selected === id ? null : id)}>
                        {labelOf(def, id)}
                      </button>
                    </span>
                  ))}
                </p>
              )}
              {selected && (
                <StepPart
                  def={def}
                  id={selected}
                  stepRole={step.roles?.[selected]}
                  inStep={partsIn(def, selected).some((x) => focus.has(x))}
                  onExplore={() => {
                    setLessonReturn(stepIdx)
                    setTab('explore')
                  }}
                  onClose={() => select(null)}
                />
              )}
              {step.layers.length > 0 && (
                <div className="mx-step-layers" aria-label="Shown on the model in this step">
                  {step.layers.map((id) => {
                    const l = def.layers.find((x) => x.id === id)
                    if (!l) return null
                    return (
                      <label key={id} className="toggle">
                        <input
                          type="checkbox"
                          checked={!offLayers.has(id)}
                          onChange={() => {
                            const n = new Set(offLayers)
                            if (n.has(id)) n.delete(id)
                            else n.add(id)
                            setOffLayers(n)
                          }}
                        />{' '}
                        {l.label}
                      </label>
                    )
                  })}
                </div>
              )}
              {reducedMotion && <p className="small muted">Reduced motion is on: the steps are shown still; the text describes the motion.</p>}
              <div className="mx-step-time" role="progressbar" aria-label="Time in this step" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((elapsed / STEP_MS) * 100)}>
                <span style={{ width: `${Math.min(100, (elapsed / STEP_MS) * 100)}%` }} />
              </div>
              <div className="mx-step-controls">
                <button className="btn" disabled={stepIdx === 0} onClick={() => goStep(stepIdx - 1)}>
                  ← Previous
                </button>
                <button
                  className={`btn ${playing ? '' : 'btn--primary'}`}
                  onClick={() => {
                    if (playing) return setPlaying(false)
                    if (finished) goStep(0)
                    setPlaying(true)
                  }}
                  aria-pressed={playing}
                >
                  {playing ? 'Pause' : elapsed > 0 && !finished ? 'Resume' : 'Start'}
                </button>
                <button className="btn" disabled={lastStep} onClick={() => goStep(stepIdx + 1)}>
                  Next →
                </button>
              </div>
              <div className="mx-step-controls">
                <button className="text-btn" onClick={replayStep}>
                  Replay this step
                </button>
                <button className="text-btn" onClick={resetTour}>
                  Reset to step 1
                </button>
              </div>
              <p className="small muted">Start plays each step for {STEP_MS / 1000} s with its motion, then moves on. The arrows and lines are conceptual illustrations of directions, not a field simulation.</p>
            </section>
          )}
          {tab === 'calculate' && <CalcPanel def={def} level={level} params={params} setParams={setParams} calc={calc} />}
          {tab === 'details' && <DetailsPanel def={def} entry={entry} level={level} />}
          {tab === 'check' && <QuizPanel machine={def.id} items={def.quiz} parts={def.parts} onShowPart={setQuizPart} />}
        </aside>
      </div>
    </main>
  )
}

const Eye = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
)

/**
 * The component tree: assemblies (expand / collapse, select all their parts) and parts, a search, and a hide/show
 * switch on every row. A part selected in the 3D view opens its assembly here, so the selected row is always seen.
 */
function ComponentTree({ def, selected, onSelect, hidden, onHide, pulled }: { def: MachineDef; selected: string | null; onSelect(id: string | null): void; hidden: Set<string>; onHide(id: string, hide: boolean): void; pulled: Set<string> }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!selected) return
    const path: string[] = assemblyOf(def, selected) ? [selected] : []
    for (let a = parentOf(def, selected); a; a = parentOf(def, a.id)) path.push(a.id)
    if (path.length) setOpen((o) => (path.every((x) => o.has(x)) ? o : new Set([...o, ...path])))
  }, [def, selected])
  const query = q.trim()
  const matches = (id: string): boolean => {
    const a = assemblyOf(def, id)
    if (a) return a.children.some(matches)
    const p = def.parts.find((x) => x.id === id)
    return !!p && partMatches(p, query)
  }
  const node = (id: string): ReactNode => {
    if (!matches(id)) return null
    const a = assemblyOf(def, id)
    const label = labelOf(def, id)
    const on = selected === id
    const ids = partsIn(def, id)
    const off = ids.every((x) => hidden.has(x))
    const eye = (
      <button className="mx-eye" aria-pressed={off} aria-label={`${off ? 'Show' : 'Hide'} ${label}`} title={off ? 'Show' : 'Hide'} onClick={() => onHide(id, !off)}>
        <Eye off={off} />
      </button>
    )
    if (!a)
      return (
        <li key={id} className={off ? 'is-off' : ''}>
          <div className="mx-node-row">
            <button className={`mx-node ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onSelect(on ? null : id)}>
              {label}
            </button>
            {pulled.has(id) && <span className="mx-out-tag" title="Pulled out for inspection">out</span>}
            {eye}
          </div>
        </li>
      )
    const expanded = !!query || open.has(id)
    return (
      <li key={id} className={`mx-asm ${off ? 'is-off' : ''}`}>
        <div className="mx-node-row">
          <button
            className="mx-twisty"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => {
              const n = new Set(open)
              if (n.has(id)) n.delete(id)
              else n.add(id)
              setOpen(n)
            }}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
          <button className={`mx-node mx-node--asm ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onSelect(on ? null : id)}>
            {label}
            <span className="mx-count" aria-label={`${ids.length} parts`}>
              {ids.length}
            </span>
          </button>
          {pulled.has(id) && <span className="mx-out-tag" title="Pulled out for inspection">out</span>}
          {eye}
        </div>
        {expanded && <ul>{a.children.map(node)}</ul>}
      </li>
    )
  }
  const tops = roots(def)
  const found = tops.some(matches)
  return (
    <div className="mx-tree">
      {def.parts.length > 8 && <input className="mx-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a part…" aria-label="Find a part" />}
      <ul className="mx-parts" aria-label="Components of the machine">
        {tops.map(node)}
      </ul>
      {!found && <p className="small muted">No part matches “{query}”.</p>}
    </div>
  )
}

/**
 * During a lesson: the part the student selected, and what it does in THIS step (its general function when the step
 * does not use it), with a way into Explore that keeps the place in the lesson.
 */
function StepPart({ def, id, stepRole, inStep, onExplore, onClose }: { def: MachineDef; id: string; stepRole?: string; inStep: boolean; onExplore(): void; onClose(): void }) {
  const part = def.parts.find((x) => x.id === id)
  const a = assemblyOf(def, id)
  const what = stepRole ?? (part ? part.function : (a?.what ?? ''))
  return (
    <section className="mx-step-part" aria-live="polite" aria-label="Selected part in this step">
      <p className="eyebrow">{stepRole ? 'Its role in this step' : inStep ? 'Highlighted in this step' : 'Not used in this step'}</p>
      <h3>{labelOf(def, id)}</h3>
      <p>{what}</p>
      {!stepRole && !inStep && <p className="small muted">This step does not involve it — its general function is shown.</p>}
      <div className="mx-step-part-actions">
        <button className="btn" onClick={onExplore} title="Open it in Explore (the lesson waits at this step)">
          Inspect it in Explore →
        </button>
        <button className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  )
}

/** The selected part or assembly: what it is, its role, where it sits, what it works with, and what you can do with it. */
function PartCard(p: {
  def: MachineDef
  id: string
  hidden: boolean
  isolate: boolean
  inspecting: boolean
  /** The selection looks small on screen: suggest Inspect. */
  small: boolean
  onSelect(id: string | null): void
  onIsolate(): void
  onHide(h: boolean): void
  /** Pulled out on its own for inspection, whether it can be, and the switch. */
  pulled: boolean
  canPull: boolean
  onPull(): void
  onInspect(): void
  onBack(): void
  onLearn(): void
}) {
  const a = assemblyOf(p.def, p.id)
  const part = p.def.parts.find((x) => x.id === p.id)
  const parent = parentOf(p.def, p.id)
  const rel = part?.relations ?? (part?.related ?? []).map((id) => ({ id, how: '' }))
  return (
    <section className="mx-part" aria-label="Selected component" aria-live="polite">
      <p className="eyebrow">
        {a ? 'Selected assembly' : 'Selected part'}
        {parent && (
          <>
            {' · in '}
            <button className="mx-link" onClick={() => p.onSelect(parent.id)}>
              {parent.label}
            </button>
          </>
        )}
      </p>
      <h2>{labelOf(p.def, p.id)}</h2>
      <div className="mx-part-actions">
        {p.inspecting ? (
          <button className="btn" onClick={p.onBack} title="Return to the view you had before">
            Back to the whole machine
          </button>
        ) : (
          <button className="btn" onClick={p.onInspect} disabled={p.hidden} title="Turn the view to this component and zoom in">
            Inspect
          </button>
        )}
        <button className={`btn ${p.isolate ? 'on' : ''}`} aria-pressed={p.isolate} onClick={p.onIsolate} disabled={p.hidden} title="Show only this component">
          {p.isolate ? 'Show all' : 'Isolate'}
        </button>
        <button className="btn" onClick={() => p.onHide(!p.hidden)}>
          {p.hidden ? 'Show' : 'Hide'}
        </button>
        <button
          className={`btn ${p.pulled ? 'on' : ''}`}
          aria-pressed={p.pulled}
          disabled={!p.canPull || p.hidden}
          onClick={p.onPull}
          title={!p.canPull ? (part && !a ? 'This is not a separate physical part in the model (it cannot be moved on its own)' : 'This assembly has no single direction to come out in — pull out its parts one by one') : p.pulled ? 'Move it back to its exact place' : a ? 'Move the whole assembly out as one unit, without moving anything else' : 'Move only this part out to inspect it — nothing else moves'}
        >
          {p.pulled ? 'Put back' : 'Pull out'}
        </button>
      </div>
      {p.pulled && part?.inspectNote && <p className="small mx-small-hint">For inspection only: {part.inspectNote}</p>}
      {p.small && !p.hidden && (
        <p className="small mx-small-hint">
          This part is small at this distance —{' '}
          <button className="mx-link" onClick={p.onInspect}>
            Inspect it close up
          </button>
          .
        </p>
      )}
      {a && (
        <>
          <p>{a.what}</p>
          <ul className="mx-members">
            {a.children.map((c) => (
              <li key={c}>
                <button className="mx-link" onClick={() => p.onSelect(c)}>
                  {labelOf(p.def, c)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {part && (
        <>
          <p>{part.what}</p>
          <p>
            <b>Function.</b> {part.function}
          </p>
          {part.location && (
            <p>
              <b>Where it sits.</b> {part.location}
            </p>
          )}
          {rel.length > 0 && (
            <div>
              <p>
                <b>Works with</b>
              </p>
              <ul className="mx-rel">
                {rel.map((r) => (
                  <li key={r.id}>
                    <button className="mx-link" onClick={() => p.onSelect(r.id)}>
                      {labelOf(p.def, r.id)}
                    </button>
                    {r.how && <span> — {r.how}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(part.material || part.ifFaulty) && (
            <details className="mx-detail">
              <summary>Material, and if it is missing or faulty</summary>
              {part.material && (
                <p>
                  <b>Material.</b> {part.material}
                </p>
              )}
              {part.ifFaulty && (
                <p>
                  <b>If it is missing or faulty.</b> {part.ifFaulty}
                </p>
              )}
            </details>
          )}
        </>
      )}
      <p className="small">
        <button className="mx-link" onClick={p.onLearn}>
          See how it works →
        </button>
      </p>
    </section>
  )
}

/** The part (or parts) moving now, its stage, and why (from the model's narration, or from its parts). */
function StageNote({ def, move, moves, stages, moving, apart, onSelect }: { def: MachineDef; move: Move | undefined; moves: number; stages: number; moving: boolean; apart: boolean; onSelect(id: string): void }) {
  if (!move)
    return (
      <p className="small muted">
        Assembled. Disassemble takes the machine apart one part at a time — {moves} moves in {stages} stage{stages === 1 ? '' : 's'}, in the order a technician would — and Reassemble puts every part back exactly. Next part steps through them; the slider moves between the two.
      </p>
    )
  const n = def.disassembly?.[move.stage - 1]
  const parts = move.parts.map((id) => def.parts.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p)
  return (
    <div className="mx-stage-note" aria-live="polite">
      <p className="eyebrow">
        Stage {move.stage} of {stages} · part {move.slot} of {moves}
        {moving ? (apart ? ' · coming off' : ' · going back') : ''}
      </p>
      <h3>{n?.title ?? `Stage ${move.stage}`}</h3>
      <p className="mx-now">
        <b>{moving && !apart ? 'Going back:' : 'Now:'}</b> {parts.map((p) => p.label).join(' + ')}
      </p>
      {n?.text && <p>{n.text}</p>}
      <ul className="mx-rel">
        {parts.map((x) => (
          <li key={x.id}>
            <button className="mx-link" onClick={() => onSelect(x.id)}>
              {x.label}
            </button>{' '}
            — {x.function}
            {x.location && <span className="muted"> Belongs: {x.location}</span>}
            {x.relations && x.relations.length > 0 && <span className="muted"> Works with: {x.relations.map((r) => labelOf(def, r.id)).join(', ')}.</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

const fmtVal = (c: CalcResult) => {
  if (c.value === null || !Number.isFinite(c.value)) return '—'
  const v = c.unit === '%' ? c.value * 100 : c.value
  const a = Math.abs(v)
  return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3)
}

function CalcPanel({ def, level, params, setParams, calc }: { def: MachineDef; level: MLevel; params: Record<string, number>; setParams(p: Record<string, number>): void; calc: CalcResult[] }) {
  const shown = def.params.filter((x) => !x.level || RANK[level] >= RANK[x.level])
  const hidden = def.params.length - shown.length
  return (
    <section className="mx-calc">
      <p className="small muted">Explicit steady-state relations (each with its formula). They are calculations, not a simulation — the circuit labs simulate.</p>
      {shown.map((x) => (
        <label key={x.id} className="mx-param">
          <span>
            {x.label} <b>{params[x.id]}</b> {x.unit}
          </span>
          {x.options ? (
            <select value={params[x.id]} onChange={(e) => setParams({ ...params, [x.id]: Number(e.target.value) })}>
              {x.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input type="range" min={x.min} max={x.max} step={x.step} value={params[x.id]} onChange={(e) => setParams({ ...params, [x.id]: Number(e.target.value) })} />
          )}
        </label>
      ))}
      {hidden > 0 && <p className="small muted">{hidden} more parameter{hidden === 1 ? '' : 's'} at the Standard or Engineer detail level.</p>}
      <table className="mx-results">
        <tbody>
          {calc.map((c) => (
            <tr key={c.id}>
              <th scope="row">
                {c.label}
                <span className="mx-formula">{c.formula}</span>
                {c.note && <span className="mx-note">{c.note}</span>}
              </th>
              <td>
                {fmtVal(c)} <span className="muted">{c.unit}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mx-assume">
        <summary>Assumptions</summary>
        <ul>
          {def.content.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}

function DetailsPanel({ def, entry, level }: { def: MachineDef; entry: MachineEntry; level: MLevel }) {
  const c = def.content
  const list = (title: string, items: string[], open = false) =>
    items.length > 0 && (
      <details className="mx-detail" open={open}>
        <summary>{title}</summary>
        <ul>
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    )
  return (
    <section className="mx-details">
      <p>{c.overview}</p>
      <details className="mx-detail" open>
        <summary>Construction</summary>
        <p>{c.construction}</p>
      </details>
      <details className="mx-detail">
        <summary>Operating principle</summary>
        <p>{c.principle}</p>
      </details>
      <details className="mx-detail" open={RANK[level] >= 1}>
        <summary>Equations</summary>
        <dl className="mx-eqs">
          {c.equations.map((e) => (
            <div key={e.expr}>
              <dt className="mx-eq">{e.expr}</dt>
              <dd>{e.meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
      {list('Assumptions of this model', c.assumptions)}
      {list('Operating characteristics', c.characteristics)}
      {list('Losses', c.losses)}
      {list('Advantages', c.advantages)}
      {list('Limitations', c.limitations)}
      {list('Typical applications', c.applications)}
      {list('Common misconceptions', c.misconceptions, RANK[level] >= 1)}
      {list('About this model', [def.manifest.simplified, ...def.manifest.limitations, `Source: ${def.manifest.source} License: ${def.manifest.license}`])}
      {c.sources && list('Sources', c.sources)}
      {entry.simulatedIn && (
        <p className="small">
          Simulated (validated circuit model): <a href={href.workspace(entry.simulatedIn.lab, entry.simulatedIn.topic)}>{entry.simulatedIn.label}</a>
        </p>
      )}
    </section>
  )
}
