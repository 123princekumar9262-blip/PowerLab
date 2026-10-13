import { Html } from './Html.tsx'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { MachinePart } from '../types.ts'
import { ease, stageFactor, useViewer } from './context.tsx'

const ACCENT = new THREE.Color('#6ea8ff')
const FOCUS = new THREE.Color('#2fc28d')
const GUIDE = '#6ea8ff'
const ZERO3: [number, number, number] = [0, 0, 0]
const TMP = new THREE.Vector3()

interface MatState {
  emissive: THREE.Color
  intensity: number
  opacity: number
  transparent: boolean
}

/**
 * A selectable part of a machine model. It owns, for its meshes: the click to select, the highlight (a restrained
 * emissive tint, the material otherwise unchanged), dimming when a learning step focuses other parts, a soft glow
 * (related parts, the parts of a disassembly stage), its exploded offset (stage by stage, eased, always computed
 * from the assembled position — never added to the last one), visibility (hidden by the student, casing hidden,
 * isolate), its label, and — selected while apart — a dashed guide back to where it belongs. Models only draw
 * geometry.
 */
export function Part({ id, children }: { id: string; children: ReactNode }) {
  const v = useViewer()
  const part = v.parts.get(id)
  const group = useRef<THREE.Group>(null)
  const label = useRef<HTMLDivElement>(null)
  const saved = useRef(new Map<THREE.Material, MatState>())

  const selected = v.selectedParts.has(id)
  const focused = v.focus.has(id)
  const glowing = v.glow.has(id)
  // a selection must be visible wherever it sits: with the machine together, the other parts fade (the parts it
  // works with a little less); a casing always fades when something inside it is selected
  const xray = v.assembled && !selected && v.selectedParts.size > 0 && (v.fadeOthers || (!!part?.outer && [...v.selectedParts].some((s) => !v.parts.get(s)?.outer)))
  const dimmed = v.focus.size > 0 && !focused && !selected
  const fade = dimmed ? 0.16 : xray ? (glowing ? 0.32 : 0.1) : 1
  // How it works: a casing the step does not need is taken away, so the working parts can be seen
  const hidden = v.hidden.has(id) || (v.isolate && v.selectedParts.size > 0 && !selected) || (!!part?.outer && (v.showInside || (v.learning && v.focus.size > 0 && !focused)))

  // highlight / dim through each mesh's own material (restored exactly when the state ends)
  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || o.userData.noHighlight) return
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
      for (const m of mats) {
        if (!saved.current.has(m)) saved.current.set(m, { emissive: m.emissive?.clone() ?? new THREE.Color(0), intensity: m.emissiveIntensity ?? 1, opacity: m.opacity, transparent: m.transparent })
        const s = saved.current.get(m)!
        if (m.emissive) {
          m.emissive.copy(selected ? ACCENT : focused ? FOCUS : glowing ? ACCENT : s.emissive)
          m.emissiveIntensity = selected ? 0.55 : focused ? 0.1 : glowing ? 0.06 : s.intensity
        }
        m.transparent = fade < 1 || s.transparent
        m.opacity = Math.min(s.opacity, fade)
        m.depthWrite = fade === 1
        m.needsUpdate = true
      }
    })
    v.invalidate()
  }, [selected, focused, glowing, fade]) // eslint-disable-line react-hooks/exhaustive-deps

  // pulled out on its own: the offset glides to its target (always a fresh target from the pulled set — never added
  // to the last position, so nothing drifts)
  const pull = useRef(new THREE.Vector3())
  const pullTarget = v.pulls.get(id)
  useEffect(() => v.invalidate(), [pullTarget?.[0], pullTarget?.[1], pullTarget?.[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  // position = exploded offset (from the disassembly progress) + pulled-out offset, both from the original place
  useFrame((_, dt) => {
    const g = group.current
    if (!g || !part) return
    const f = ease(stageFactor(v.anim.current.explode, v.slots.get(id) ?? part.stage))
    const t = pullTarget ?? ZERO3
    const c = pull.current
    if (c.x !== t[0] || c.y !== t[1] || c.z !== t[2]) {
      if (v.reducedMotion) c.set(t[0], t[1], t[2])
      else {
        c.lerp(TMP.set(t[0], t[1], t[2]), 1 - Math.exp(-Math.min(dt, 0.05) * 7))
        if (c.distanceTo(TMP) < 1e-3) c.copy(TMP)
        v.invalidate()
      }
    }
    g.position.set(part.explode[0] * f + c.x, part.explode[1] * f + c.y, part.explode[2] * f + c.z)
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // the nearest visible part takes the click; a drag (orbit) is not a click
    if (e.delta > 4) return
    e.stopPropagation()
    v.select(v.selected === id ? null : id)
  }
  const showLabel = !hidden && !!part && (v.labels === 'all' || (v.labels === 'focus' && (selected || focused)))
  const moves = !!part && (part.explode.some((x) => x !== 0) || !!pullTarget)
  return (
    <group name={id} visible={!hidden}>
      <group
        ref={group}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        {children}
        {showLabel && (
          <Html position={part.anchor} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div ref={label} className={`mx-label ${selected ? 'mx-label--sel' : ''}`}>
              {part.label}
            </div>
          </Html>
        )}
      </group>
      {selected && moves && <HomeGuide part={part} group={group} />}
    </group>
  )
}

/**
 * Where a separated part belongs: a dashed line from its place in the assembly (a small dot) to where it is now.
 * Shown only while the part is apart.
 */
function HomeGuide({ part, group }: { part: MachinePart; group: React.RefObject<THREE.Group | null> }) {
  const v = useViewer()
  const dot = useRef<THREE.Mesh>(null)
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: GUIDE, dashSize: 0.09, gapSize: 0.06, transparent: true, opacity: 0.9, depthTest: false }))
    l.renderOrder = 10
    l.frustumCulled = false
    l.userData.noFit = true
    return l
  }, [])
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )
  useEffect(() => v.invalidate(), []) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    // the part's own offset from its place (exploded and/or pulled out), as its group was just positioned
    const o = group.current?.position
    const [ax, ay, az] = part.anchor
    const pos = line.geometry.attributes.position as THREE.BufferAttribute
    pos.setXYZ(0, ax, ay, az)
    pos.setXYZ(1, ax + (o?.x ?? 0), ay + (o?.y ?? 0), az + (o?.z ?? 0))
    pos.needsUpdate = true
    line.computeLineDistances()
    const apart = !!o && o.length() > 0.02
    line.visible = apart
    if (dot.current) dot.current.visible = apart
  })
  return (
    <group>
      <primitive object={line} />
      <mesh ref={dot} position={part.anchor} renderOrder={10} userData={{ noHighlight: true, noFit: true }}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshBasicMaterial color={GUIDE} transparent opacity={0.9} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
