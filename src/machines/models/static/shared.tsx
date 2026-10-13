import { Line } from '@react-three/drei'
import { Html } from '../../viewer/Html.tsx'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../types.ts'
import { useViewer } from '../../viewer/context.tsx'

/*
 * Helpers shared by the static devices (transformers, autotransformer, inductor). Static devices do not turn: the
 * animation clock's angle is used as the ELECTRICAL phase θ = ωt of a conceptual sinusoidal supply. At rest the
 * scene shows one instant of the positive half-cycle (θ0 = π/4: flux, voltage and load current all positive), so
 * every arrow has a definite direction in the still picture too.
 */
export const THETA0 = Math.PI / 4
export const theta = (angle: number) => angle + THETA0

// ── materials (colours) ──
export const SIL_STEEL = '#8e98a6' // grain-oriented silicon steel laminations
export const LAM_EDGE = '#3f4652'
export const COPPER_HV = '#b8692f' // fine enamelled copper (many turns)
export const COPPER_LV = '#d08a45' // heavy copper strip (few turns)
export const PRESSBOARD = '#d6c08f' // insulation (pressboard / Nomex)
export const PORCELAIN = '#e7e3da'
export const BRASS = '#c9a227'
export const FRAME_STEEL = '#4f5968'
export const FERRITE = '#4d5056'
export const BOBBIN = '#2f2f33'

/** A rectangle path (helper for core shapes). */
export function rectShape(x0: number, y0: number, x1: number, y1: number) {
  const s = new THREE.Shape()
  s.moveTo(x0, y0)
  s.lineTo(x1, y0)
  s.lineTo(x1, y1)
  s.lineTo(x0, y1)
  s.closePath()
  return s
}

/** A polygon shape from points. */
export function polyShape(pts: Array<[number, number]>) {
  const s = new THREE.Shape()
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)))
  s.closePath()
  return s
}

function roundedRectPath(p: THREE.Path, hx: number, hy: number, r: number, cw: boolean) {
  const rr = Math.min(r, hx, hy)
  if (!cw) {
    p.moveTo(-hx + rr, -hy)
    p.lineTo(hx - rr, -hy)
    p.absarc(hx - rr, -hy + rr, rr, -Math.PI / 2, 0, false)
    p.lineTo(hx, hy - rr)
    p.absarc(hx - rr, hy - rr, rr, 0, Math.PI / 2, false)
    p.lineTo(-hx + rr, hy)
    p.absarc(-hx + rr, hy - rr, rr, Math.PI / 2, Math.PI, false)
    p.lineTo(-hx, -hy + rr)
    p.absarc(-hx + rr, -hy + rr, rr, Math.PI, Math.PI * 1.5, false)
  } else {
    p.moveTo(-hx + rr, -hy)
    p.absarc(-hx + rr, -hy + rr, rr, Math.PI * 1.5, Math.PI, true)
    p.lineTo(-hx, hy - rr)
    p.absarc(-hx + rr, hy - rr, rr, Math.PI, Math.PI / 2, true)
    p.lineTo(hx - rr, hy)
    p.absarc(hx - rr, hy - rr, rr, Math.PI / 2, 0, true)
    p.lineTo(hx, -hy + rr)
    p.absarc(hx - rr, -hy + rr, rr, 0, -Math.PI / 2, true)
  }
}

/**
 * A rounded-rectangle ring (a coil turn / layer, an insulating tube) whose axis is +y: inner half-extents
 * (ix along x, iz along z), outer (ox, oz), height h, bottom at y = 0.
 */
export function ringGeometry(ix: number, iz: number, ox: number, oz: number, h: number, r = 0.12) {
  const s = new THREE.Shape()
  roundedRectPath(s, ox, oz, r + (ox - ix), false)
  const hole = new THREE.Path()
  roundedRectPath(hole, ix, iz, r, true)
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 })
  g.rotateX(-Math.PI / 2) // extrusion along +y; the shape's y becomes −z (symmetric shapes)
  return g
}

/**
 * A laminated stack: the 2D core profile (xy plane) as `n` thin plates along z, centred on z = 0, total depth
 * `depth`, with a small gap between plates (the insulating coating) so the lamination is visible.
 */
export function Laminated({ shape, depth, n, color = SIL_STEEL, fill = 0.88 }: { shape: THREE.Shape; depth: number; n: number; color?: string; fill?: number }) {
  const geo = useMemo(() => {
    const t = (depth / n) * fill
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 4 })
    g.translate(0, 0, -t / 2)
    return g
  }, [shape, depth, n, fill])
  const alt = useMemo(() => new THREE.Color(color).multiplyScalar(0.8).getStyle(), [color])
  return (
    <group>
      {Array.from({ length: n }, (_, k) => (
        <mesh key={k} geometry={geo} position={[0, 0, -depth / 2 + (depth / n) * (k + 0.5)]}>
          {/* alternate plates a shade darker: the stack reads as separate insulated sheets */}
          <meshStandardMaterial color={k % 2 ? alt : color} metalness={0.65} roughness={0.42} />
        </mesh>
      ))}
    </group>
  )
}

/** A coil drawn as a stack of `turns` rings (each ring = one turn or layer, enamel gap between them). */
export function CoilStack({ ix, iz, ox, oz, y0, y1, turns, color, gap = 0.012 }: { ix: number; iz: number; ox: number; oz: number; y0: number; y1: number; turns: number; color: string; gap?: number }) {
  const h = (y1 - y0 - gap * (turns - 1)) / turns
  const geo = useMemo(() => ringGeometry(ix, iz, ox, oz, h, 0.1), [ix, iz, ox, oz, h])
  return (
    <group>
      {Array.from({ length: turns }, (_, k) => (
        <mesh key={k} geometry={geo} position={[0, y0 + k * (h + gap), 0]}>
          <meshStandardMaterial color={color} metalness={0.72} roughness={0.33} />
        </mesh>
      ))}
    </group>
  )
}

/** A wire / lead along a polyline (tube). */
export function Wire({ points, radius = 0.025, color = COPPER_LV, metal = 0.7 }: { points: Vec3[]; radius?: number; color?: string; metal?: number }) {
  const geo = useMemo(() => {
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i]), new THREE.Vector3(...points[i + 1])))
    return new THREE.TubeGeometry(path, Math.max(2, (points.length - 1) * 6), radius, 8, false)
  }, [points, radius])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} metalness={metal} roughness={0.35} />
    </mesh>
  )
}

/** A porcelain bushing standing on +y: a stem with `sheds` rain sheds and a brass terminal stud on top. */
export function Bushing({ at, height = 0.5, r = 0.07, sheds = 3 }: { at: Vec3; height?: number; r?: number; sheds?: number }) {
  return (
    <group position={at}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[r * 0.8, r, height, 20]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.35} metalness={0.05} />
      </mesh>
      {Array.from({ length: sheds }, (_, k) => (
        <mesh key={k} position={[0, (height * (k + 0.8)) / (sheds + 0.6), 0]}>
          <cylinderGeometry args={[r * 1.55, r * 1.85, 0.03, 22]} />
          <meshStandardMaterial color={PORCELAIN} roughness={0.35} metalness={0.05} />
        </mesh>
      ))}
      <mesh position={[0, height + 0.06, 0]}>
        <cylinderGeometry args={[r * 0.35, r * 0.35, 0.14, 12]} />
        <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
      </mesh>
    </group>
  )
}

// ── conceptual, phase-driven visuals ────────────────────────────────────────────────────────────────

/** Reads the conceptual electrical phase every frame. */
export function usePhase(cb: (th: number, playing: boolean, dt: number) => void) {
  const v = useViewer()
  useFrame((_, dt) => cb(theta(v.anim.current.angle), v.anim.current.playing && !v.reducedMotion, dt))
}

/**
 * An arrow centred on `at` along `dir`, whose length and direction follow amp·sin(θ + phase): it shrinks to
 * nothing at a zero crossing and points the other way in the negative half-cycle. Drawn over the model
 * (`xray`) when the quantity is inside the iron or the coil.
 */
export function AcArrow({ at, dir, length = 0.5, color, phase = 0, amp = 1, radius = 0.03, xray = false, min = 0.12 }: { at: Vec3; dir: Vec3; length?: number; color: string; phase?: number; amp?: number; radius?: number; xray?: boolean; min?: number }) {
  const g = useRef<THREE.Group>(null)
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()), [dir])
  usePhase((th) => {
    if (!g.current) return
    const k = amp * Math.sin(th + phase)
    const m = Math.abs(k) < 1e-3 ? 0.0001 : Math.sign(k) * Math.max(min, Math.min(1, Math.abs(k)))
    g.current.scale.setScalar(m) // a negative uniform scale = a point reflection: the arrow reverses
  })
  const head = Math.min(0.16, length * 0.35)
  const shaft = length - head
  const mat = <meshBasicMaterial color={color} toneMapped={false} depthTest={!xray} transparent={xray} opacity={xray ? 0.95 : 1} />
  return (
    <group position={at} quaternion={quat}>
      <group ref={g}>
        <mesh position={[0, -length / 2 + shaft / 2, 0]} renderOrder={xray ? 10 : 0} userData={{ noHighlight: true }}>
          <cylinderGeometry args={[radius, radius, shaft, 10]} />
          {mat}
        </mesh>
        <mesh position={[0, length / 2 - head / 2, 0]} renderOrder={xray ? 10 : 0} userData={{ noHighlight: true }}>
          <coneGeometry args={[radius * 3, head, 14]} />
          {mat}
        </mesh>
      </group>
    </group>
  )
}

/**
 * Moving dashes along a path whose direction and speed follow amp·sin(θ + phase) (a sign change reverses the
 * flow), brightness following the magnitude. `steady` > 0 adds a never-reversing flow (energy: p = v·i ≥ 0).
 */
export function AcFlow({ points, color, phase = 0, amp = 1, width = 2.5, dash = 0.14, gap = 0.1, xray = false, power = false, opacityFloor = 0.25 }: { points: Vec3[]; color: string; phase?: number; amp?: number; width?: number; dash?: number; gap?: number; xray?: boolean; power?: boolean; opacityFloor?: number }) {
  const ref = useRef<{ material: { dashOffset: number; opacity: number; transparent: boolean } } | null>(null)
  usePhase((th, playing, dt) => {
    const m = ref.current?.material
    if (!m) return
    const s = Math.sin(th + phase)
    const k = power ? amp * s * s * 2 : amp * s
    m.transparent = true
    m.opacity = opacityFloor + (1 - opacityFloor) * Math.min(1, Math.abs(power ? amp * s * s : k))
    if (playing) m.dashOffset -= k * Math.min(dt, 0.05) * 0.9
  })
  return <Line ref={ref as never} points={points} color={color} lineWidth={width} dashed dashSize={dash} gapSize={gap} toneMapped={false} depthTest={!xray} renderOrder={xray ? 9 : 0} />
}

/** A text marker that shows `pos` in the positive half-cycle of sin(θ + phase) and `neg` in the negative one. */
export function AcText({ at, pos, neg, phase = 0, tone = 'neutral', fade = false }: { at: Vec3; pos: string; neg: string; phase?: number; tone?: string; fade?: boolean }) {
  const el = useRef<HTMLSpanElement>(null)
  usePhase((th) => {
    const s = Math.sin(th + phase)
    const t = s >= 0 ? pos : neg
    if (el.current) {
      if (el.current.textContent !== t) el.current.textContent = t
      if (fade) el.current.style.opacity = String(0.35 + 0.65 * Math.abs(s))
    }
  })
  return (
    <Html position={at} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
      <span ref={el} className={`mx-marker mx-marker--${tone}`}>
        {pos}
      </span>
    </Html>
  )
}

/** A translucent glow volume (energy density) whose opacity follows amp·sin²(θ + phase). */
export function AcGlow({ children, color, phase = 0, amp = 1, max = 0.7, xray = false }: { children: ReactNode; color: string; phase?: number; amp?: number; max?: number; xray?: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  usePhase((th) => {
    const s = Math.sin(th + phase)
    if (mat.current) mat.current.opacity = Math.max(0.04, Math.min(max, max * amp * s * s))
  })
  return (
    <mesh userData={{ noHighlight: true }} renderOrder={8}>
      {children}
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.4} depthWrite={false} depthTest={!xray} toneMapped={false} />
    </mesh>
  )
}

/** A rectangle loop (closed polyline) in a plane z = const, from corner to corner, clockwise or not. */
export function rectLoop(x0: number, y0: number, x1: number, y1: number, z: number): Vec3[] {
  return [
    [x0, y0, z],
    [x0, y1, z],
    [x1, y1, z],
    [x1, y0, z],
    [x0, y0, z],
  ]
}

/** Points of an ellipse in the plane z = const (counter-clockwise from angle a0). */
export function ellipse(cx: number, cy: number, rx: number, ry: number, z: number, a0 = 0, sweep = Math.PI * 2, n = 40): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / n
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a), z] as Vec3
  })
}
