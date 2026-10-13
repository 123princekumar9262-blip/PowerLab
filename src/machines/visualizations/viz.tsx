import { Line } from '@react-three/drei'
import { Html } from '../viewer/Html.tsx'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useViewer } from '../viewer/context.tsx'
import type { Vec3 } from '../types.ts'

/*
 * The conceptual visual layer: arrows, rotation, flow along a path. These illustrate directions and sequences
 * (always shown with a legend in words); they are not field or speed measurements.
 */

/** The colours of the conceptual layers (each also has its own marker and a legend in words). */
export const LAYER_COLOR = {
  field: '#6ea8ff', // magnetic field / flux: blue
  current: '#2fc28d', // conventional current: green
  rotation: '#e8ecf2', // mechanical rotation: white
  torque: '#fab219', // force / torque: amber
  emf: '#d55181', // induced EMF: magenta
  energy: '#d95926', // energy flow: orange
} as const

/** Rotates its children about an axis with the animation clock: angle × ratio + phase. */
export function Spin({ axis = 'z', ratio = 1, phase = 0, children }: { axis?: 'x' | 'y' | 'z'; ratio?: number; phase?: number; children: ReactNode }) {
  const v = useViewer()
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!g.current) return
    g.current.rotation[axis] = v.anim.current.angle * ratio + phase
  })
  return <group ref={g}>{children}</group>
}

/** A straight arrow from `from` along `dir` (unit-free), `length` long. */
export function Arrow({ from, dir, length = 1, color, radius = 0.025, head = 0.12 }: { from: Vec3; dir: Vec3; length?: number; color: string; radius?: number; head?: number }) {
  const { pos, quat, shaft } = useMemo(() => {
    const d = new THREE.Vector3(...dir).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)
    const sh = Math.max(0.001, length - head)
    const p = new THREE.Vector3(...from)
    return { pos: p, quat: q, shaft: sh }
  }, [from, dir, length, head])
  return (
    <group position={pos} quaternion={quat}>
      <mesh position={[0, shaft / 2, 0]} userData={{ noHighlight: true }}>
        <cylinderGeometry args={[radius, radius, shaft, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, shaft + head / 2, 0]} userData={{ noHighlight: true }}>
        <coneGeometry args={[radius * 3, head, 14]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** A curved arrow around the z axis (rotation, torque): radius, start angle, sweep (sign = direction). */
export function CurvedArrow({ radius, start = 0, sweep = Math.PI * 1.2, z = 0, color, tube = 0.03 }: { radius: number; start?: number; sweep?: number; z?: number; color: string; tube?: number }) {
  const end = start + sweep
  const tip = useMemo(() => {
    const x = radius * Math.cos(end)
    const y = radius * Math.sin(end)
    const tangent = new THREE.Vector3(-Math.sin(end), Math.cos(end), 0).multiplyScalar(Math.sign(sweep))
    return { pos: new THREE.Vector3(x, y, z), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent) }
  }, [radius, end, sweep, z])
  return (
    <group>
      <mesh position={[0, 0, z]} rotation={[0, 0, sweep >= 0 ? start : end]} userData={{ noHighlight: true }}>
        <torusGeometry args={[radius, tube, 8, 48, Math.abs(sweep)]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={tip.pos} quaternion={tip.quat} userData={{ noHighlight: true }}>
        <coneGeometry args={[tube * 3.2, tube * 7, 14]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * Something flowing along a path (current, flux, energy): moving dashes. `rate` > 0 flows from the first point to
 * the last; < 0 backwards; 0 still. Speed of the dashes is illustrative only.
 */
export function FlowLine({ points, color, rate = 1, width = 2.5, dash = 0.14, gap = 0.1 }: { points: Vec3[]; color: string; rate?: number; width?: number; dash?: number; gap?: number }) {
  const v = useViewer()
  const ref = useRef<{ material: { dashOffset: number } } | null>(null)
  useFrame((_, dt) => {
    const m = ref.current?.material
    if (!m || v.reducedMotion || !v.anim.current.playing) return
    m.dashOffset -= rate * dt * 0.6
  })
  return <Line ref={ref as never} points={points} color={color} lineWidth={width} dashed={rate !== 0} dashSize={dash} gapSize={gap} toneMapped={false} />
}

/** A small text marker in the scene (N, S, +, −, ⊙, ⊗, "Ia"), screen-sized and never hiding the model. */
export function Marker({ at, text, tone = 'neutral' }: { at: Vec3; text: string; tone?: 'neutral' | 'field' | 'current' | 'torque' | 'emf' | 'energy' | 'north' | 'south' }) {
  return (
    <Html position={at} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
      <span className={`mx-marker mx-marker--${tone}`}>{text}</span>
    </Html>
  )
}

/** Points of a circle arc in the xy plane at height z. */
export function arc(radius: number, from: number, to: number, z = 0, n = 32): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n
    return [radius * Math.cos(a), radius * Math.sin(a), z] as Vec3
  })
}
