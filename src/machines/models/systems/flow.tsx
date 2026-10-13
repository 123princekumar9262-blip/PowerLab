import { Line } from '@react-three/drei'
import { Html } from '../../viewer/Html.tsx'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../types.ts'
import { CurvedArrow } from '../../visualizations/viz.tsx'
import { useViewer } from '../../viewer/context.tsx'

/*
 * Helpers of the synchronous-machine and system models (owned by these models; the shared viz.tsx is unchanged).
 * All of them illustrate directions or sequences — conceptual, never a measurement.
 */

/**
 * Moving dashes along a path, drawn over the geometry when `onTop` (so a flux path inside the iron stays visible).
 * `rate(angle)`: the flow rate as a function of the animation angle (sign = direction; e.g. an AC current that
 * reverses in sequence); a number for a constant rate.
 */
export function Flow({ points, color, rate = 1, width = 2.5, onTop = false, dash = 0.14, gap = 0.1 }: { points: Vec3[]; color: string; rate?: number | ((angle: number) => number); width?: number; onTop?: boolean; dash?: number; gap?: number }) {
  const v = useViewer()
  const ref = useRef<{ material: { dashOffset: number } } | null>(null)
  useFrame((_, dt) => {
    const m = ref.current?.material
    if (!m || v.reducedMotion || !v.anim.current.playing) return
    const r = typeof rate === 'number' ? rate : rate(v.anim.current.angle)
    m.dashOffset -= r * Math.min(dt, 0.05) * 0.6
  })
  const still = typeof rate === 'number' && rate === 0
  return <Line ref={ref as never} points={points} color={color} lineWidth={width} dashed={!still} dashSize={dash} gapSize={gap} toneMapped={false} depthTest={!onTop} transparent={onTop} renderOrder={onTop ? 10 : 0} />
}

/** A curved arrow about the x or z axis through `at` (sweep sign: right-handed about +axis). */
export function AxisArrow({ axis, at, radius, start = 0, sweep, color, tube = 0.03 }: { axis: 'x' | 'z'; at: Vec3; radius: number; start?: number; sweep: number; color: string; tube?: number }) {
  // rotating the arrow's own z axis onto +x: a +90° turn about y
  return (
    <group position={at} rotation={axis === 'x' ? [0, Math.PI / 2, 0] : [0, 0, 0]}>
      <CurvedArrow radius={radius} start={start} sweep={sweep} z={0} color={color} tube={tube} />
    </group>
  )
}

/** Points along a polyline with rounded resampling (for cables). */
export function smooth(points: Vec3[], n = 40): Vec3[] {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal')
  return c.getPoints(n).map((p) => [p.x, p.y, p.z] as Vec3)
}

/** A cable: a tube along a smooth path. */
export function Cable({ points, color, radius = 0.035 }: { points: Vec3[]; color: string; radius?: number }) {
  const geo = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal'), 48, radius, 8, false), [points, radius])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
    </mesh>
  )
}

/**
 * Three live bars (e.g. the phase EMFs ea, eb, ec) computed every frame from the animation angle:
 * value_k = f(angle, k) in −1 … 1. A conceptual indicator of sequence and sign, not a measurement.
 */
export function PhaseBars({ at, labels, colors, value, title }: { at: Vec3; labels: string[]; colors: string[]; value: (angle: number, k: number) => number; title: string }) {
  const v = useViewer()
  const bars = useRef<Array<HTMLDivElement | null>>([])
  useFrame(() => {
    const a = v.anim.current.angle
    bars.current.forEach((el, k) => {
      if (!el) return
      const x = Math.max(-1, Math.min(1, value(a, k)))
      el.style.height = `${Math.abs(x) * 22}px`
      el.style.top = x >= 0 ? `${24 - Math.abs(x) * 22}px` : '24px'
    })
  })
  return (
    <Html position={at} center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{ background: 'rgba(11,15,20,0.82)', border: '1px solid #3a4452', borderRadius: 8, padding: '6px 8px 4px', font: '600 11px/1.3 system-ui, sans-serif', color: '#e8ecf2', whiteSpace: 'nowrap' }}>
        <div style={{ marginBottom: 3 }}>{title}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {labels.map((l, k) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: 14, height: 48, margin: '0 auto', borderRadius: 3, background: '#1b222c' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 24, height: 1, background: '#5c6878' }} />
                <div ref={(el) => void (bars.current[k] = el)} style={{ position: 'absolute', left: 2, right: 2, top: 24, height: 0, background: colors[k], borderRadius: 2 }} />
              </div>
              <div style={{ color: colors[k] }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </Html>
  )
}

/** ' 12.3 kW' from a value already in kW (empty when not available). */
export const kw = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '' : ` ${Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)} kW`)
