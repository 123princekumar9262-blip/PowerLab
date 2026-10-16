import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Component, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { useReducedMotion } from '../ui/kit.tsx'
import './three.css'

/*
 * The Power Systems 3D layer: one canvas that renders only when something changes, with orbit / zoom / pan, reset
 * and fit, selectable parts (mouse, or the keyboard part list beside it), an info panel, labels that can be hidden,
 * an optional guided tour, reduced motion, and a 2D fallback when WebGL is unavailable or the scene fails.
 *
 * What a scene shows is GEOMETRY (shapes and positions — model inputs), CALCULATED (anything sized, coloured or
 * moved by the model's numbers) or CONCEPTUAL (an illustration of an idea; it shows no number). A scene says which
 * through `kind` notes, so an illustration is never mistaken for a result.
 *
 * Patterns follow the 3D Machines Lab's viewer (render on demand, labels as page elements projected each frame, no
 * positive useFrame priority) without depending on its machine-specific context.
 */

export interface ScenePart {
  id: string
  name: string
  /** One line: what it is (shown in the info panel and the part list). */
  what?: string
}

export interface TourStep {
  title: string
  text: ReactNode
  /** Parts to select (the first) and frame. */
  focus: string[]
  /** Camera position for this step (target stays the scene's). */
  camera?: [number, number, number]
}

export interface SceneProps {
  /** Accessible name of the scene. */
  label: string
  parts: ScenePart[]
  selected: string | null
  onSelect(id: string | null): void
  camera: { position: [number, number, number]; target: [number, number, number]; fov?: number }
  /** Rough size of the scene (sets zoom limits and "fit"). */
  radius: number
  /** The 3D content (meshes, <Selectable>, <Label3D>). */
  children: ReactNode
  /** The 2D equivalent, shown when 3D cannot be drawn (and on request). */
  fallback: ReactNode
  /** Extra content for the info panel of the selected part (live values from the model). */
  info?(id: string): ReactNode
  tour?: TourStep[]
  /** Short statement of what is geometry, calculated or conceptual in this scene. */
  kindNote?: string
  /** Canvas height [px]. */
  height?: number
  /** Changes to these values ask for a new frame (the scene's inputs). */
  deps?: unknown[]
}

/** Can this browser draw WebGL at all? (checked once, before a canvas is created) */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

// ── scene context ───────────────────────────────────────────────────────────────────────────────────────────

interface SceneCtx {
  selected: string | null
  hovered: string | null
  select(id: string | null): void
  hover(id: string | null): void
  labels: LabelStore
  showLabels: boolean
  reducedMotion: boolean
  invalidate(): void
}
const Ctx = createContext<SceneCtx | null>(null)
export function useScene(): SceneCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useScene outside <Scene3D>')
  return c
}

/** How a part should look now: selected, hovered, dimmed (something else is selected) or normal. */
export function useHighlight(id: string): 'selected' | 'hovered' | 'dim' | 'normal' {
  const s = useScene()
  if (s.selected === id) return 'selected'
  if (s.hovered === id) return 'hovered'
  if (s.selected) return 'dim'
  return 'normal'
}

/** A group that can be selected with the mouse (the part list does the same from the keyboard). */
export function Selectable({ id, children, position }: { id: string; children: ReactNode; position?: [number, number, number] }) {
  const s = useScene()
  return (
    <group
      position={position}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        s.select(s.selected === id ? null : id)
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        s.hover(id)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        s.hover(null)
        document.body.style.cursor = ''
      }}
    >
      {children}
    </group>
  )
}

// ── labels: page elements projected to their 3D anchors (no React root per label) ──────────────────────────────

interface LabelEntry {
  node: ReactNode
  className?: string
  style?: CSSProperties
  anchor: THREE.Object3D | null
  el: HTMLElement | null
  always: boolean
}
class LabelStore {
  entries = new Map<number, LabelEntry>()
  private listeners = new Set<() => void>()
  private version = 0
  private next = 1
  id() {
    return this.next++
  }
  set(id: number, e: LabelEntry) {
    const prev = this.entries.get(id)
    this.entries.set(id, { ...e, el: prev?.el ?? null })
    this.emit()
  }
  remove(id: number) {
    if (this.entries.delete(id)) this.emit()
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  snapshot = () => this.version
  private emit() {
    this.version++
    this.listeners.forEach((l) => l())
  }
}

/** A label at a point of the scene. `always`: shown even when labels are switched off (e.g. a computed value). */
export function Label3D({
  position = [0, 0, 0],
  children,
  className,
  style,
  always = false,
}: {
  position?: [number, number, number]
  children: ReactNode
  className?: string
  style?: CSSProperties
  always?: boolean
}) {
  const { labels } = useScene()
  const group = useRef<THREE.Group>(null)
  const id = useMemo(() => labels.id(), [labels])
  useLayoutEffect(() => {
    labels.set(id, { node: children, className, style, anchor: group.current, el: null, always })
  })
  useLayoutEffect(() => () => labels.remove(id), [labels, id])
  return <group ref={group} position={position} />
}

const v = new THREE.Vector3()
const visibleChain = (o: THREE.Object3D | null) => {
  for (let x = o; x; x = x.parent) if (!x.visible) return false
  return true
}
function LabelProjector() {
  const { labels, showLabels } = useScene()
  const { camera, size } = useThree()
  useFrame(() => {
    for (const e of labels.entries.values()) {
      const el = e.el
      if (!el) continue
      let shown = (showLabels || e.always) && !!e.anchor && visibleChain(e.anchor)
      let x = -9999
      let y = -9999
      if (e.anchor) {
        e.anchor.getWorldPosition(v)
        v.project(camera)
        x = ((v.x + 1) / 2) * size.width
        y = ((1 - v.y) / 2) * size.height
        if (v.z > 1 || v.z < -1) shown = false
      }
      el.style.display = shown ? '' : 'none'
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`
    }
    // priority 0 on purpose: a positive priority would take over the render loop and nothing would be drawn
  })
  return null
}
function LabelOverlay({ store, onMounted }: { store: LabelStore; onMounted(): void }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  useLayoutEffect(onMounted)
  return (
    <div className="ps3-overlay" aria-hidden="true">
      {[...store.entries.entries()].map(([id, e]) => (
        <div
          key={id}
          ref={(el) => {
            const cur = store.entries.get(id)
            if (cur) cur.el = el
          }}
          className={`ps3-label ${e.className ?? ''}`}
          style={{ display: 'none', ...e.style }}
        >
          {e.node}
        </div>
      ))}
    </div>
  )
}

// ── camera ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Cmd = { kind: 'reset' | 'fit' | 'in' | 'out' | 'goto'; to?: [number, number, number]; nonce: number }

function CameraRig({ cmd, start, target, radius, reduced, zoom }: { cmd: Cmd; start: [number, number, number]; target: [number, number, number]; radius: number; reduced: boolean; zoom: boolean }) {
  const { camera, invalidate } = useThree()
  const controls = useRef<{ target: THREE.Vector3; update(): void } | null>(null)
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null)
  useEffect(() => {
    if (cmd.nonce === 0) return
    const tgt = new THREE.Vector3(...target)
    let to: THREE.Vector3
    if (cmd.kind === 'reset') to = new THREE.Vector3(...start)
    else if (cmd.kind === 'goto' && cmd.to) to = new THREE.Vector3(...cmd.to)
    else if (cmd.kind === 'fit')
      to = tgt.clone().add(
        camera.position
          .clone()
          .sub(tgt)
          .normalize()
          .multiplyScalar(radius * 2.4),
      )
    else {
      const d = camera.position.clone().sub(tgt)
      to = tgt.clone().add(d.multiplyScalar(cmd.kind === 'in' ? 0.8 : 1.25))
    }
    if (controls.current) controls.current.target.copy(tgt)
    if (reduced) {
      camera.position.copy(to)
      camera.lookAt(tgt)
      controls.current?.update()
      invalidate()
    } else {
      anim.current = { from: camera.position.clone(), to, t: 0 }
      invalidate()
    }
  }, [cmd.nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const a = anim.current
    if (!a) return
    a.t = Math.min(1, a.t + dt / 0.6)
    const e = a.t * a.t * (3 - 2 * a.t)
    camera.position.lerpVectors(a.from, a.to, e)
    controls.current?.update()
    if (a.t >= 1) anim.current = null
    else invalidate()
  })
  // maxPolarAngle: the camera stays above the horizon (dragging could otherwise end looking up from under the ground)
  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      target={target}
      enableDamping={false}
      enableZoom={zoom}
      minDistance={radius * 0.3}
      maxDistance={radius * 6}
      maxPolarAngle={Math.PI * 0.48}
      onChange={() => invalidate()}
    />
  )
}

function Invalidator({ target, deps }: { target: MutableRefObject<() => void>; deps: unknown[] }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    target.current = () => invalidate()
    invalidate()
  }, [invalidate, target])
  useEffect(() => invalidate(), deps) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * Full screen for one view: the browser's own full-screen mode where it is allowed, otherwise the view fills the window
 * (a fixed overlay). Esc leaves either; leaving full screen through the browser (Esc, F11) is followed too.
 */
function useFullScreen() {
  const ref = useRef<HTMLElement | null>(null)
  const [overlay, setOverlay] = useState(false)
  const [native, setNative] = useState(false)
  useEffect(() => {
    const sync = () => setNative(!!ref.current && document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  useEffect(() => {
    if (!overlay) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('ps3-no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('ps3-no-scroll')
    }
  }, [overlay])
  // leaving the page while in full screen must not leave the browser in full-screen mode
  useEffect(
    () => () => {
      if (ref.current && document.fullscreenElement === ref.current) void document.exitFullscreen().catch(() => {})
    },
    [],
  )
  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (native) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    if (overlay) {
      setOverlay(false)
      return
    }
    if (document.fullscreenEnabled && typeof el.requestFullscreen === 'function') el.requestFullscreen().catch(() => setOverlay(true))
    else setOverlay(true)
  }
  return { ref, on: native || overlay, toggle }
}

// ── the scene ───────────────────────────────────────────────────────────────────────────────────────────────────

export function Scene3D(p: SceneProps) {
  const reducedMotion = useReducedMotion()
  const [hasGl] = useState(() => webglAvailable())
  const [view, setView] = useState<'3d' | '2d'>(hasGl ? '3d' : '2d')
  const [hovered, setHovered] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [zoom, setZoom] = useState(false)
  const [cmd, setCmd] = useState<Cmd>({ kind: 'reset', nonce: 0 })
  const [step, setStep] = useState<number | null>(null)
  const full = useFullScreen()
  const labels = useMemo(() => new LabelStore(), [])
  const invalidateRef = useRef<() => void>(() => {})
  const command = (kind: Cmd['kind'], to?: [number, number, number]) => setCmd((c) => ({ kind, to, nonce: c.nonce + 1 }))
  const ctx: SceneCtx = { selected: p.selected, hovered, select: p.onSelect, hover: setHovered, labels, showLabels, reducedMotion, invalidate: () => invalidateRef.current() }
  const sel = p.parts.find((x) => x.id === p.selected)
  const goStep = (k: number | null) => {
    setStep(k)
    if (k === null || !p.tour) return
    const s = p.tour[k]
    p.onSelect(s.focus[0] ?? null)
    if (s.camera) command('goto', s.camera)
  }
  useEffect(() => invalidateRef.current(), [p.selected, hovered, showLabels, full.on])
  // entering full screen: frame the whole scene from the current angle (leaving keeps the camera where it was put)
  const firstFull = useRef(true)
  useEffect(() => {
    if (firstFull.current) {
      firstFull.current = false
      return
    }
    if (view !== '3d' || !full.on) return
    const t = window.setTimeout(() => command('fit'), 120)
    return () => window.clearTimeout(t)
  }, [full.on]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section ref={full.ref} className={`ps3 ${full.on ? 'is-full' : ''}`} aria-label={p.label}>
      <div className="ps3-toolbar" role="toolbar" aria-label="3D view controls">
        <div className="seg ps-seg" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={view === '3d'} className={view === '3d' ? 'on' : ''} disabled={!hasGl} onClick={() => setView('3d')}>
            3D
          </button>
          <button type="button" role="radio" aria-checked={view === '2d'} className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>
            2D diagram
          </button>
        </div>
        {view === '3d' && (
          <>
            <button type="button" className="text-btn" onClick={() => command('reset')}>
              Reset view
            </button>
            <button type="button" className="text-btn" onClick={() => command('fit')}>
              Fit
            </button>
            <button type="button" className="text-btn" aria-label="Zoom in" onClick={() => command('in')}>
              +
            </button>
            <button type="button" className="text-btn" aria-label="Zoom out" onClick={() => command('out')}>
              −
            </button>
            <label className="ps-toggle">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
            </label>
            {p.tour && step === null && (
              <button type="button" className="text-btn" onClick={() => goStep(0)}>
                Guided tour
              </button>
            )}
          </>
        )}
        <button type="button" className="text-btn ps3-full-btn" aria-pressed={full.on} title={full.on ? 'Leave full screen (Esc)' : 'Show this view on the whole screen'} onClick={full.toggle}>
          {full.on ? '✕ Exit full screen' : '⛶ Full screen'}
        </button>
      </div>
      {!hasGl && <p className="ps-hint">3D is not available in this browser; the 2D diagram shows the same model.</p>}
      <div className="ps3-body">
        <div className="ps3-stage" style={{ height: view === '3d' && !full.on ? (p.height ?? 380) : undefined }}>
          {view === '3d' ? (
            <SceneBoundary fallback={p.fallback}>
              <div
                className={`ps3-canvas-host ${zoom ? 'is-zoom' : ''}`}
                onPointerDown={() => setZoom(true)}
                onPointerLeave={() => setZoom(false)}
                title={zoom ? undefined : 'Drag to rotate · right-drag to pan · click once, then scroll to zoom'}
              >
                <Canvas
                  frameloop="demand"
                  dpr={[1, 1.75]}
                  camera={{ position: p.camera.position, fov: p.camera.fov ?? 40, near: 0.05, far: 500 }}
                  gl={{ antialias: true, powerPreference: 'low-power' }}
                  onPointerMissed={(e) => {
                    if ((e as MouseEvent).type === 'click') p.onSelect(null)
                  }}
                  aria-label={p.label}
                >
                  <Ctx.Provider value={ctx}>
                    <Invalidator target={invalidateRef} deps={p.deps ?? []} />
                    <color attach="background" args={['#0b0f14']} />
                    <ambientLight intensity={0.6} />
                    <hemisphereLight args={['#eef3fb', '#2a3441', 1.0]} />
                    <directionalLight position={[6, 10, 8]} intensity={2.0} />
                    <directionalLight position={[-8, 4, -6]} intensity={0.8} />
                    <CameraRig cmd={cmd} start={p.camera.position} target={p.camera.target} radius={p.radius} reduced={reducedMotion} zoom={zoom} />
                    {p.children}
                    {/* after the scene: frame hooks run in mount order */}
                    <LabelProjector />
                  </Ctx.Provider>
                </Canvas>
                <Ctx.Provider value={ctx}>
                  <LabelOverlay store={labels} onMounted={() => invalidateRef.current()} />
                </Ctx.Provider>
              </div>
            </SceneBoundary>
          ) : (
            <div className="ps3-fallback">{p.fallback}</div>
          )}
          {p.kindNote && <p className="ps3-kind">{p.kindNote}</p>}
        </div>
        <aside className="ps3-side" aria-label="Parts">
          {step !== null && p.tour ? (
            <div className="ps3-tour" aria-live="polite">
              <p className="eyebrow">
                Tour · {step + 1} of {p.tour.length}
              </p>
              <h4>{p.tour[step].title}</h4>
              <div className="ps3-tour-text">{p.tour[step].text}</div>
              <div className="ps3-tour-nav">
                <button type="button" className="text-btn" disabled={step === 0} onClick={() => goStep(step - 1)}>
                  ← Back
                </button>
                {step < p.tour.length - 1 ? (
                  <button type="button" className="text-btn" onClick={() => goStep(step + 1)}>
                    Next →
                  </button>
                ) : (
                  <button type="button" className="text-btn" onClick={() => goStep(0)}>
                    Replay
                  </button>
                )}
                <button type="button" className="text-btn" onClick={() => goStep(null)}>
                  Close tour
                </button>
              </div>
            </div>
          ) : sel ? (
            <div className="ps3-info" aria-live="polite">
              <p className="eyebrow">Selected</p>
              <h4>{sel.name}</h4>
              {sel.what && <p className="small">{sel.what}</p>}
              {p.info?.(sel.id)}
              <button type="button" className="text-btn" onClick={() => p.onSelect(null)}>
                Clear selection
              </button>
            </div>
          ) : (
            <p className="small muted">Select a part in the picture or in this list.</p>
          )}
          <ul className="ps3-parts">
            {p.parts.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className={`ps3-part ${p.selected === x.id ? 'on' : ''}`}
                  aria-pressed={p.selected === x.id}
                  onClick={() => p.onSelect(p.selected === x.id ? null : x.id)}
                  onMouseEnter={() => setHovered(x.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {x.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  )
}

/** A scene that throws while drawing falls back to its 2D diagram, with the reason and a retry. */
class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error)
      return (
        <div className="ps3-fallback" role="alert">
          <p className="ps-hint">
            The 3D view could not be drawn ({this.state.error.message}); the 2D diagram shows the same model.{' '}
            <button type="button" className="ps-link" onClick={() => this.setState({ error: null })}>
              Try 3D again
            </button>
          </p>
          {this.props.fallback}
        </div>
      )
    return this.props.children
  }
}

/** Colours shared by 3D scenes (match the 2D voltage-level and phase colours). */
export const SCENE_COLORS = {
  steel: '#7d8796',
  steelDark: '#4c5563',
  insulator: '#c9d2de',
  ground: '#1b222c',
  phaseA: '#e66767',
  phaseB: '#e0a91c',
  phaseC: '#4f95ea',
  selected: '#7ef0ff',
  hovered: '#9ec5ff',
  accent: '#6ea8ff',
  good: '#22b14c',
  warn: '#fab219',
} as const
