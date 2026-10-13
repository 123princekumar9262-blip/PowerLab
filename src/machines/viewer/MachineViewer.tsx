import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import type { LayerId, MachineDef, ModelState, Vec3 } from '../types.ts'
import { Ctx, ease, type AnimRef, type ViewerCtx } from './context.tsx'
import { slotsOf } from '../hierarchy.ts'
import { HtmlOverlay, HtmlProjector, LabelStore } from './Html.tsx'

/**
 * A camera command. `inspect` frames the given parts (keeping the viewing direction) and remembers the view it left;
 * `back` returns to that view. `fit` steps back only if part of the model is out of the frame (an exploded
 * assembly); `unfit` undoes an automatic `fit` once the model is together again.
 */
export type CameraCmd = { kind: 'reset' | 'front' | 'side' | 'top' | 'iso' | 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | 'inspect' | 'back' | 'fit' | 'unfit'; nonce: number; ids?: string[] }

export interface ViewerProps {
  def: MachineDef
  anim: MutableRefObject<AnimRef>
  selected: string | null
  selectedParts: Set<string>
  onSelect(id: string | null): void
  focus: Set<string>
  glow: Set<string>
  hidden: Set<string>
  assembled: boolean
  learning: boolean
  fadeOthers: boolean
  pulls: Map<string, [number, number, number]>
  /** Reports how large the selection looks on screen [px, its larger side] (0 when nothing is selected). */
  onSelectionSize?(px: number): void
  showInside: boolean
  isolate: boolean
  labels: 'off' | 'focus' | 'all'
  layers: Set<LayerId>
  reducedMotion: boolean
  model: ModelState
  camera: CameraCmd
  /** The workspace asks for frames through this (play, explode, a changed value). */
  kick: MutableRefObject<() => void>
}

/** Can this browser draw WebGL at all? (checked once, before the canvas is created) */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * The reusable 3D viewer: one canvas that renders on demand (a still scene costs nothing), orbit / zoom / pan,
 * standard views, and the machine's model inside the viewer context its parts read.
 */
export function MachineViewer(p: ViewerProps) {
  const parts = useMemo(() => new Map(p.def.parts.map((x) => [x.id, x])), [p.def])
  const slots = useMemo(() => slotsOf(p.def), [p.def])
  const invalidateRef = useRef<() => void>(() => {})
  const labelStore = useMemo(() => new LabelStore(), [p.def])
  const ctx: ViewerCtx = {
    anim: p.anim,
    parts,
    selected: p.selected,
    selectedParts: p.selectedParts,
    select: p.onSelect,
    focus: p.focus,
    glow: p.glow,
    hidden: p.hidden,
    assembled: p.assembled,
    slots,
    pulls: p.pulls,
    learning: p.learning,
    fadeOthers: p.fadeOthers,
    showInside: p.showInside,
    isolate: p.isolate,
    labels: p.labels,
    layers: p.layers,
    reducedMotion: p.reducedMotion,
    invalidate: () => invalidateRef.current(),
    labelStore,
  }
  const m = p.def.manifest
  const Model = p.def.Model
  return (
    <ViewerBoundary>
      <div className="mx-canvas-host">
      <Canvas
        className="mx-canvas"
        frameloop="demand"
        dpr={[1, 1.75]}
        camera={{ position: m.camera.position, fov: m.camera.fov ?? 38, near: 0.05, far: 200 }}
        gl={{ antialias: true, powerPreference: 'low-power' }}
        onPointerMissed={(e) => {
          // a click on empty space clears the selection (not the end of an orbit drag)
          if ((e as MouseEvent).type === 'click') p.onSelect(null)
        }}
        aria-label={`3D model of the ${p.def.id}`}
      >
        <Ctx.Provider value={ctx}>
          <Invalidator target={invalidateRef} kick={p.kick} />
          <color attach="background" args={['#0b0f14']} />
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#eef3fb', '#2a3441', 1.1]} />
          <directionalLight position={[4, 6, 6]} intensity={2.2} />
          <directionalLight position={[-6, 2, -4]} intensity={0.9} />
          <directionalLight position={[0, -5, 3]} intensity={0.5} />
          <Driver anim={p.anim} reduced={p.reducedMotion} />
          <CameraRig cmd={p.camera} target={m.camera.target} start={m.camera.position} views={m.views} radius={m.radius} reduced={p.reducedMotion} />
          <group name={MODEL_ROOT}>
            <Model state={p.model} />
          </group>
          {/* after the model: frame hooks run in mount order, so the labels are placed after the parts have moved */}
          <HtmlProjector />
          {p.onSelectionSize && <SelectionSize ids={p.selectedParts} camera={p.camera} report={p.onSelectionSize} />}
        </Ctx.Provider>
      </Canvas>
      {/* labels are ordinary page elements over the canvas (moved each frame by HtmlProjector) */}
      <HtmlOverlay store={labelStore} onMounted={() => invalidateRef.current()} />
      </div>
    </ViewerBoundary>
  )
}

/** Exposes the canvas's invalidate() to the parts (context) and to the workspace (kick). */
function Invalidator({ target, kick }: { target: MutableRefObject<() => void>; kick: MutableRefObject<() => void> }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    target.current = () => invalidate()
    kick.current = () => invalidate()
    invalidate()
  }, [invalidate, target, kick])
  return null
}

/**
 * The animation clock and the explode motion. It keeps asking for frames only while something moves; a still
 * scene renders nothing. Reduced motion: no clock, and the assembly jumps straight to its target.
 */
function Driver({ anim, reduced }: { anim: MutableRefObject<AnimRef>; reduced: boolean }) {
  useFrame((state, dt) => {
    const a = anim.current
    const step = Math.min(dt, 0.05)
    let moving = false
    if (a.playing && !reduced) {
      a.angle += a.omega * step
      a.time += step
      moving = true
    }
    if (a.explode !== a.explodeTarget) {
      if (reduced) a.explode = a.explodeTarget
      else {
        const d = a.explodeTarget - a.explode
        const mv = Math.sign(d) * Math.min(Math.abs(d), a.explodeRate * step)
        a.explode += mv
        if (Math.abs(a.explodeTarget - a.explode) < 1e-4) a.explode = a.explodeTarget
      }
      moving = true
    }
    if (moving) state.invalidate()
  })
  return null
}

const MODEL_ROOT = '__model'

/** The world-space box of the visible meshes under the named objects (or the whole model). */
function visibleBox(scene: THREE.Object3D, ids?: string[]): THREE.Box3 {
  scene.updateMatrixWorld()
  const box = new THREE.Box3()
  const tmp = new THREE.Box3()
  const tops = (ids ?? [MODEL_ROOT]).map((id) => scene.getObjectByName(id)).filter((o): o is THREE.Object3D => !!o)
  for (const top of tops) {
    // a part hidden higher up (isolate, casing hidden) does not count
    let shown = true
    for (let x: THREE.Object3D | null = top.parent; x; x = x.parent) if (!x.visible) shown = false
    if (!shown) continue
    top.traverseVisible((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || o.userData.noFit || !mesh.geometry) return
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      if (!mesh.geometry.boundingBox) return
      tmp.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
      box.union(tmp)
    })
  }
  return box
}

/** Measures how large the selected parts look on screen (after the frame that shows them). */
function SelectionSize({ ids, camera: cmd, report }: { ids: Set<string>; camera: CameraCmd; report(px: number): void }) {
  const { scene, camera, size } = useThree()
  useEffect(() => {
    if (ids.size === 0) return report(0)
    const t = window.setTimeout(() => {
      const box = visibleBox(scene, [...ids])
      if (box.isEmpty()) return report(0)
      camera.updateMatrixWorld()
      const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera))
      const w = ((Math.max(...pts.map((v) => v.x)) - Math.min(...pts.map((v) => v.x))) / 2) * size.width
      const h = ((Math.max(...pts.map((v) => v.y)) - Math.min(...pts.map((v) => v.y))) / 2) * size.height
      // thin parts (wires) have a large box but few pixels: use the smaller side too
      report(Math.min(Math.max(w, h), 4 * Math.min(w, h)))
    }, 700)
    return () => window.clearTimeout(t)
  }, [ids, cmd.nonce, size.width, size.height]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** The camera distance that shows a sphere of radius r whole (vertical and horizontal field of view). */
function fitDistance(cam: THREE.PerspectiveCamera, r: number, margin: number) {
  const v = THREE.MathUtils.degToRad(cam.fov) / 2
  const h = Math.atan(Math.tan(v) * (cam.aspect || 1))
  return (r / Math.sin(Math.min(v, h))) * margin
}

/** Camera: start position, standard views, reset, inspect / back, fit — applied when the command changes. */
function CameraRig({ cmd, target, start, views, radius, reduced }: { cmd: CameraCmd; target: Vec3; start: Vec3; views: Partial<Record<string, Vec3>>; radius: number; reduced: boolean }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const { camera, invalidate, scene } = useThree()
  // the view before an inspect (back returns to it) and before an automatic fit (unfit returns to it)
  const beforeInspect = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const beforeFit = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const tween = useRef<{ p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; k: number } | null>(null)
  const here = () => ({ pos: camera.position.clone(), target: controls.current ? controls.current.target.clone() : new THREE.Vector3(...target) })
  const glide = (pos: THREE.Vector3, to: THREE.Vector3) => {
    const from = here()
    tween.current = { p0: from.pos, p1: pos, t0: from.target, t1: to, k: reduced ? 1 : 0 }
    invalidate()
  }
  // the glide is advanced by the frames it asks for (priority 0: the scene is still drawn as usual)
  useFrame((_, dt) => {
    const tw = tween.current
    const c = controls.current
    if (!tw || !c) return
    tw.k = Math.min(1, tw.k + Math.min(dt, 0.05) / 0.5)
    const e = ease(tw.k)
    camera.position.lerpVectors(tw.p0, tw.p1, e)
    c.target.lerpVectors(tw.t0, tw.t1, e)
    c.update()
    if (tw.k >= 1) tween.current = null
    else invalidate()
  })
  useEffect(() => {
    const c = controls.current
    const cam = camera as THREE.PerspectiveCamera
    if (cmd.kind === 'inspect' && cmd.ids?.length) {
      const box = visibleBox(scene, cmd.ids)
      if (box.isEmpty()) return
      const sph = box.getBoundingSphere(new THREE.Sphere())
      const cur = here()
      if (!beforeInspect.current) beforeInspect.current = cur
      const dir = cur.pos.clone().sub(cur.target).normalize()
      const d = Math.max(fitDistance(cam, Math.max(sph.radius, 0.25), 2.2), 1.2)
      glide(sph.center.clone().add(dir.multiplyScalar(d)), sph.center.clone())
      return
    }
    if (cmd.kind === 'back') {
      const b = beforeInspect.current
      beforeInspect.current = null
      if (b) glide(b.pos, b.target)
      return
    }
    if (cmd.kind === 'fit') {
      const box = visibleBox(scene)
      if (box.isEmpty()) return
      // already all in the frame? leave the view alone
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
      cam.updateMatrixWorld()
      const inFrame = corners.every((v) => {
        const n = v.clone().project(cam)
        return Math.abs(n.x) <= 0.97 && Math.abs(n.y) <= 0.97 && n.z < 1
      })
      if (inFrame) return
      const sph = box.getBoundingSphere(new THREE.Sphere())
      const cur = here()
      if (!beforeFit.current) beforeFit.current = cur
      const dir = cur.pos.clone().sub(cur.target).normalize()
      glide(sph.center.clone().add(dir.multiplyScalar(fitDistance(cam, sph.radius, 1.02))), sph.center.clone())
      return
    }
    if (cmd.kind === 'unfit') {
      const b = beforeFit.current
      beforeFit.current = null
      if (b) glide(b.pos, b.target)
      return
    }
    if (cmd.kind === 'reset') tween.current = null
    // keyboard / button orbit: 20° around the target, or 15 % closer / farther
    if (['left', 'right', 'up', 'down', 'in', 'out'].includes(cmd.kind) && c) {
      const t = c.target.clone()
      const off = camera.position.clone().sub(t)
      const sph = new THREE.Spherical().setFromVector3(off)
      const d = Math.PI / 9
      if (cmd.kind === 'left') sph.theta -= d
      if (cmd.kind === 'right') sph.theta += d
      if (cmd.kind === 'up') sph.phi = Math.max(0.15, sph.phi - d)
      if (cmd.kind === 'down') sph.phi = Math.min(Math.PI - 0.15, sph.phi + d)
      if (cmd.kind === 'in') sph.radius = Math.max(radius * 0.25, sph.radius * 0.85)
      if (cmd.kind === 'out') sph.radius = Math.min(radius * 8, sph.radius / 0.85)
      tween.current = null
      camera.position.copy(t.add(new THREE.Vector3().setFromSpherical(sph)))
      c.update()
      invalidate()
      return
    }
    // a standard view or reset starts afresh: nothing to go back to
    beforeInspect.current = null
    beforeFit.current = null
    const pos = cmd.kind === 'reset' ? start : (views[cmd.kind as 'front'] ?? start)
    // a narrow (portrait) viewer sees less across: step back so the whole model stays in frame
    const aspect = cam.aspect || 1
    const back = aspect < 1.2 ? Math.min(1.8, 1.2 / aspect) : 1
    const t = new THREE.Vector3(...target)
    const p = new THREE.Vector3(...pos).sub(t).multiplyScalar(back).add(t)
    // a named view glides there (easy to follow); reset jumps
    if (cmd.kind !== 'reset' && c) return glide(p, t)
    camera.position.copy(p)
    camera.lookAt(new THREE.Vector3(...target))
    if (c) {
      c.target.set(...target)
      c.update()
    }
    invalidate()
  }, [cmd.nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  return <OrbitControls ref={controls} makeDefault target={target} enableDamping={false} minDistance={radius * 0.25} maxDistance={radius * 8} />
}

/** A model that throws while drawing must not take the page down: it says so, with a way to retry. */
class ViewerBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error)
      return (
        <div className="mx-fallback" role="alert">
          <p>The 3D model could not be drawn.</p>
          <p className="muted small">{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    return this.props.children
  }
}
