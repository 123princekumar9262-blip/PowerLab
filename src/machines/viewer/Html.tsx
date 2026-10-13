import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import * as THREE from 'three'
import { useViewer } from './context.tsx'

/**
 * Screen-space labels for the 3D scene, without a React root per label (drei's <Html> creates and destroys one
 * each time a label appears or goes, which React reports as "synchronously unmount a root while rendering").
 *
 * Inside the canvas, <Html> only registers its content and an anchor object in the viewer's label store. One
 * <HtmlOverlay> in the page (an ordinary DOM tree beside the canvas) renders every label, and one frame hook
 * projects each anchor to the screen and moves its element. A label whose anchor (or any parent) is hidden is
 * hidden too.
 */
export interface LabelEntry {
  node: ReactNode
  className?: string
  style?: CSSProperties
  center: boolean
  zIndex: number
  anchor: THREE.Object3D | null
  calc?: (el: HTMLElement, camera: THREE.Camera, size: { width: number; height: number }) => [number, number]
  el: HTMLElement | null
}

export class LabelStore {
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

/** Drop-in for drei's <Html> (the props this lab uses). */
export function Html({
  position = [0, 0, 0],
  center = false,
  zIndexRange,
  style,
  className,
  calculatePosition,
  children,
}: {
  position?: [number, number, number]
  center?: boolean
  zIndexRange?: [number, number]
  style?: CSSProperties
  className?: string
  calculatePosition?: (el: HTMLElement, camera: THREE.Camera, size: { width: number; height: number }) => [number, number]
  children?: ReactNode
}) {
  const { labelStore: labels } = useViewer()
  const group = useRef<THREE.Group>(null)
  const id = useMemo(() => labels.id(), [labels])
  // the content may change on every render (live values): re-register it each time
  useLayoutEffect(() => {
    labels.set(id, { node: children, className, style, center, zIndex: zIndexRange?.[0] ?? 10, anchor: group.current, calc: calculatePosition, el: null })
  })
  useLayoutEffect(() => () => labels.remove(id), [labels, id])
  return <group ref={group} position={position} />
}

const v = new THREE.Vector3()
const visibleChain = (o: THREE.Object3D | null) => {
  for (let x = o; x; x = x.parent) if (!x.visible) return false
  return true
}

/** Inside the canvas: moves every label to its anchor's screen position, each rendered frame. */
export function HtmlProjector() {
  const { labelStore: labels } = useViewer()
  const { camera, size } = useThree()
  useFrame(() => {
    for (const e of labels.entries.values()) {
      const el = e.el
      if (!el) continue
      let x: number
      let y: number
      let shown = !!e.anchor && visibleChain(e.anchor)
      if (e.calc) [x, y] = e.calc(el, camera, size)
      else if (e.anchor) {
        e.anchor.getWorldPosition(v)
        v.project(camera)
        x = ((v.x + 1) / 2) * size.width
        y = ((1 - v.y) / 2) * size.height
        if (v.z > 1 || v.z < -1) shown = false
      } else {
        x = -9999
        y = -9999
      }
      el.style.display = shown ? '' : 'none'
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${e.center ? ' translate(-50%, -50%)' : ''}`
    }
    // priority 0 on purpose: a positive priority would take over the render loop and nothing would be drawn
  })
  return null
}

/** In the page, over the canvas: the labels' DOM. */
export function HtmlOverlay({ store, onMounted }: { store: LabelStore; onMounted(): void }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  const items = [...store.entries.entries()]
  useLayoutEffect(onMounted)
  return (
    <div className="mx-overlay" aria-hidden="true">
      {items.map(([id, e]) => (
        <div
          key={id}
          ref={(el) => {
            const cur = store.entries.get(id)
            if (cur) cur.el = el
          }}
          className={e.className}
          style={{ position: 'absolute', left: 0, top: 0, zIndex: e.zIndex, display: 'none', ...e.style }}
        >
          {e.node}
        </div>
      ))}
    </div>
  )
}
