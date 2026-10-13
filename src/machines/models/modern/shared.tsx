import { Html } from '../../viewer/Html.tsx'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import './modern.css'
import { useViewer } from '../../viewer/context.tsx'
import type { Vec3 } from '../../types.ts'

/*
 * Shared procedural geometry and small scene helpers for the modern motors (BLDC, PMSM, SRM, stepper, servo).
 * Convention for all of them: the shaft is the z axis, the output (drive) end is +z, angles are measured
 * counter-clockwise seen from the front (+z looking towards −z).
 */

export const MAT = {
  steel: '#9aa4b2',
  darkSteel: '#5d6878',
  lam: '#454d59',
  copper: '#c27a3c',
  copperDark: '#a6652f',
  magnetN: '#b4463f',
  magnetS: '#3e64a8',
  alu: '#b8c1cc',
  aluDark: '#8c96a3',
  shaft: '#c3cad4',
  bearing: '#b9c2cf',
  pcb: '#1f6b45',
  chip: '#22262c',
  insul: '#d9c27a',
} as const
/** Phase colours (the same as the Drives lab waveforms: a magenta, b amber, c blue). */
export const PHASE_COLOR = { A: '#d55181', B: '#c98500', C: '#3987e5' } as const

export const deg = (d: number) => (d * Math.PI) / 180
export const polar = (r: number, a: number, z = 0): Vec3 => [r * Math.cos(a), r * Math.sin(a), z]

/** Extrude a 2D shape along z, centred on z = 0. */
export function extrude(shape: THREE.Shape, len: number, curveSegments = 12) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments })
  g.translate(0, 0, -len / 2)
  return g
}

/** An annular sector (arc magnet, segment) extruded along z, centred on z = 0. Angles in rad, a1 > a0. */
export function arcShell(rIn: number, rOut: number, a0: number, a1: number, len: number, seg = 24) {
  const s = new THREE.Shape()
  s.absarc(0, 0, rOut, a0, a1, false)
  s.absarc(0, 0, rIn, a1, a0, true)
  return extrude(s, len, seg)
}

/** A plain ring (tube) extruded along z. */
export function ring(rIn: number, rOut: number, len: number, seg = 48) {
  const s = new THREE.Shape()
  s.absarc(0, 0, rOut, 0, Math.PI * 2, false)
  const h = new THREE.Path()
  h.absarc(0, 0, rIn, 0, Math.PI * 2, true)
  s.holes.push(h)
  return extrude(s, len, seg)
}

/**
 * A stator lamination with `n` inward teeth (salient poles or slotted core). Tooth k is centred at angle
 * `phase + k·2π/n`. Teeth have parallel flanks (width `w`) from the yoke (`rYoke`) to the shoe, and a shoe of half
 * angle `shoeHalf` and radial depth `shoeDepth` at the bore radius `rBore`. `toothTeeth` > 0 cuts that many small
 * teeth into each pole face (hybrid stepper), with the given pitch (rad) and depth.
 */
export function statorShape(o: { rOut: number; rYoke: number; rBore: number; n: number; w: number; shoeHalf?: number; shoeDepth?: number; phase?: number; faceTeeth?: number; facePitch?: number; faceDepth?: number; square?: number }) {
  const { rOut, rYoke, rBore, n, w } = o
  const phase = o.phase ?? 0
  const shoeDepth = o.shoeDepth ?? 0
  const rShoe = rBore + shoeDepth
  const s = new THREE.Shape()
  if (o.square) {
    // a square lamination with chamfered corners (stepper motors): half side `square`, corners cut at rOut
    const h = o.square
    const c = Math.sqrt(Math.max(0, rOut * rOut - h * h)) // where the corner circle meets the side
    const pts: Array<[number, number]> = [[h, -c], [h, c], [c, h], [-c, h], [-h, c], [-h, -c], [-c, -h], [c, -h]]
    pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)))
  } else {
    // the outer circle as explicit points (smooth whatever curveSegments the small arcs use)
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2
      if (i === 0) s.moveTo(rOut, 0)
      else s.lineTo(rOut * Math.cos(a), rOut * Math.sin(a))
    }
  }
  const h = new THREE.Path()
  let started = false
  const flank = (r: number) => Math.asin(Math.min(0.999, w / 2 / r))
  for (let k = 0; k < n; k++) {
    const c = phase + (k * 2 * Math.PI) / n
    const shoeHalf = Math.max(o.shoeHalf ?? 0, flank(rShoe))
    const p = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)] as const
    const pt = (r: number, a: number) => {
      const [x, y] = p(r, a)
      if (!started) {
        h.moveTo(x, y)
        started = true
      } else h.lineTo(x, y)
    }
    pt(rYoke, c - flank(rYoke))
    if (shoeDepth > 0 && shoeHalf > flank(rShoe) + 1e-6) {
      pt(rShoe, c - flank(rShoe))
      pt(rShoe, c - shoeHalf)
    } else pt(rBore, c - flank(rBore))
    pt(rBore, c - shoeHalf)
    const ft = o.faceTeeth ?? 0
    if (ft > 0) {
      // small teeth on the pole face: alternate between rBore (tooth) and rBore + faceDepth (groove)
      const pitch = o.facePitch ?? 0.1
      const depth = o.faceDepth ?? 0.03
      const start = -((ft - 1) / 2) * pitch
      for (let j = 0; j < ft; j++) {
        const tc = c + start + j * pitch
        const a0 = tc - pitch * 0.25
        const a1 = tc + pitch * 0.25
        if (j > 0) pt(rBore + depth, a0)
        pt(rBore, a0)
        pt(rBore, a1)
        if (j < ft - 1) pt(rBore + depth, a1)
      }
      pt(rBore, c + shoeHalf)
    } else h.absarc(0, 0, rBore, c - shoeHalf, c + shoeHalf, false)
    if (shoeDepth > 0 && shoeHalf > flank(rShoe) + 1e-6) {
      pt(rShoe, c + shoeHalf)
      pt(rShoe, c + flank(rShoe))
    } else pt(rBore, c + flank(rBore))
    pt(rYoke, c + flank(rYoke))
    const next = phase + ((k + 1) * 2 * Math.PI) / n
    h.absarc(0, 0, rYoke, c + flank(rYoke), next - flank(rYoke), false)
  }
  s.holes.push(h)
  return s
}

/** A square plate with chamfered corners (corner circle radius rCorner) and a central hole. */
export function squarePlateShape(half: number, rCorner: number, rHole: number) {
  const s = new THREE.Shape()
  const c = Math.sqrt(Math.max(0, rCorner * rCorner - half * half))
  const pts: Array<[number, number]> = [[half, -c], [half, c], [c, half], [-c, half], [-half, c], [-half, -c], [-c, -half], [c, -half]]
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)))
  const h = new THREE.Path()
  h.absarc(0, 0, rHole, 0, Math.PI * 2, true)
  s.holes.push(h)
  return s
}

/**
 * A rotor lamination with `n` outward teeth/poles (SRM rotor, stepper cup): root radius `rRoot`, tip radius `rTip`,
 * tip half angle `tipHalf`, root half angle `rootHalf` (≥ tipHalf gives a tapered pole), shaft hole `rHole`.
 */
export function rotorTeethShape(o: { rRoot: number; rTip: number; n: number; tipHalf: number; rootHalf?: number; rHole: number; phase?: number }) {
  const { rRoot, rTip, n, tipHalf, rHole } = o
  const rootHalf = o.rootHalf ?? tipHalf
  const phase = o.phase ?? 0
  const s = new THREE.Shape()
  for (let k = 0; k < n; k++) {
    const c = phase + (k * 2 * Math.PI) / n
    const a = c - rootHalf
    if (k === 0) s.moveTo(rRoot * Math.cos(a), rRoot * Math.sin(a))
    else s.lineTo(rRoot * Math.cos(a), rRoot * Math.sin(a))
    s.lineTo(rTip * Math.cos(c - tipHalf), rTip * Math.sin(c - tipHalf))
    s.absarc(0, 0, rTip, c - tipHalf, c + tipHalf, false)
    s.lineTo(rRoot * Math.cos(c + rootHalf), rRoot * Math.sin(c + rootHalf))
    const next = phase + ((k + 1) * 2 * Math.PI) / n
    s.absarc(0, 0, rRoot, c + rootHalf, next - rootHalf, false)
  }
  const h = new THREE.Path()
  h.absarc(0, 0, rHole, 0, Math.PI * 2, true)
  s.holes.push(h)
  return s
}

/**
 * A concentrated coil wound round a radial tooth: a rounded rectangular loop in the (tangential, axial) plane,
 * spanning radii rIn…rOut. `w` and `len` are the inner opening (tooth width × stack length), `t` the coil build.
 */
export function toothCoilGeometry(w: number, len: number, t: number, rIn: number, rOut: number) {
  const rr = Math.min(t * 0.9, 0.08)
  const rect = (hw: number, hl: number, r: number) => {
    const p = new THREE.Shape()
    p.moveTo(-hw + r, -hl)
    p.lineTo(hw - r, -hl)
    p.quadraticCurveTo(hw, -hl, hw, -hl + r)
    p.lineTo(hw, hl - r)
    p.quadraticCurveTo(hw, hl, hw - r, hl)
    p.lineTo(-hw + r, hl)
    p.quadraticCurveTo(-hw, hl, -hw, hl - r)
    p.lineTo(-hw, -hl + r)
    p.quadraticCurveTo(-hw, -hl, -hw + r, -hl)
    return p
  }
  const outer = rect(w / 2 + t, len / 2 + t, rr + t * 0.5)
  const inner = rect(w / 2, len / 2, rr * 0.5)
  outer.holes.push(new THREE.Path(inner.getPoints(4)))
  const g = new THREE.ExtrudeGeometry(outer, { depth: rOut - rIn, bevelEnabled: false, curveSegments: 4 })
  // shape x = tangential, y = axial, extrusion z = radial → rotate so that x→y (tangential at angle 0), y→z, z→x
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
  g.applyMatrix4(m)
  g.translate(rIn, 0, 0)
  return g
}

/** A coil mesh on the tooth at angle `a` (geometry from toothCoilGeometry). */
export function ToothCoil({ geometry, angle, color = MAT.copper, band }: { geometry: THREE.BufferGeometry; angle: number; color?: string; band?: { color: string; pos: Vec3; size: Vec3 } }) {
  return (
    <group rotation={[0, 0, angle]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={color} metalness={0.65} roughness={0.38} />
      </mesh>
      {band && (
        <mesh position={band.pos}>
          <boxGeometry args={band.size} />
          <meshStandardMaterial color={band.color} roughness={0.7} />
        </mesh>
      )}
    </group>
  )
}

/** Thin dark rings that show the lamination stack on an outer cylindrical surface. */
export function LamLines({ r, len, n = 14, z0 = 0 }: { r: number; len: number; n?: number; z0?: number }) {
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[0, 0, z0 - len / 2 + ((i + 1) * len) / (n + 1)]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r + 0.003, r + 0.003, 0.006, 64, 1, true]} />
          <meshStandardMaterial color={MAT.lam} metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

/** A ball bearing at z: outer and inner race with a ring of balls. */
export function Bearing({ z, rIn = 0.12, rOut = 0.26, w = 0.12 }: { z: number; rIn?: number; rOut?: number; w?: number }) {
  const geo = useMemo(() => ({ outer: ring(rOut - 0.04, rOut, w, 32), inner: ring(rIn, rIn + 0.035, w, 32) }), [rIn, rOut, w])
  const rb = (rIn + rOut) / 2
  const n = 9
  return (
    <group position={[0, 0, z]}>
      <mesh geometry={geo.outer}>
        <meshStandardMaterial color={MAT.bearing} metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh geometry={geo.inner}>
        <meshStandardMaterial color={MAT.bearing} metalness={0.9} roughness={0.25} />
      </mesh>
      {Array.from({ length: n }, (_, k) => (
        <mesh key={k} position={polar(rb, (k * 2 * Math.PI) / n)}>
          <sphereGeometry args={[(rOut - rIn) * 0.28, 10, 8]} />
          <meshStandardMaterial color="#dfe4ea" metalness={0.95} roughness={0.15} />
        </mesh>
      ))}
    </group>
  )
}

/** A steel shaft along z from z0 to z1 with a key flat (makes rotation visible). */
export function Shaft({ r, z0, z1, keyAt }: { r: number; z0: number; z1: number; keyAt?: number }) {
  return (
    <group>
      <mesh position={[0, 0, (z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, z1 - z0, 24]} />
        <meshStandardMaterial color={MAT.shaft} metalness={0.85} roughness={0.25} />
      </mesh>
      {keyAt !== undefined && (
        <mesh position={[0, r, keyAt]}>
          <boxGeometry args={[r * 0.6, r * 0.5, 0.3]} />
          <meshStandardMaterial color="#8a939f" metalness={0.8} roughness={0.3} />
        </mesh>
      )}
    </group>
  )
}

/** A cylindrical housing shell with optional axial cooling fins. */
export function Housing({ rIn, rOut, len, z = 0, fins = 0, color = MAT.alu }: { rIn: number; rOut: number; len: number; z?: number; fins?: number; color?: string }) {
  const geo = useMemo(() => ring(rIn, rOut, len, 64), [rIn, rOut, len])
  return (
    <group position={[0, 0, z]}>
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} metalness={0.55} roughness={0.42} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: fins }, (_, k) => {
        const a = (k * 2 * Math.PI) / fins
        return (
          <mesh key={k} position={polar(rOut + 0.05, a)} rotation={[0, 0, a]}>
            <boxGeometry args={[0.11, 0.035, len * 0.92]} />
            <meshStandardMaterial color={color} metalness={0.55} roughness={0.42} />
          </mesh>
        )
      })}
    </group>
  )
}

/** An end cap (disc with a bearing boss), its outer face at z, facing `dir` (+1 front, −1 rear). */
export function EndCap({ r, z, t = 0.1, dir = 1, color = MAT.aluDark, boss = 0.3 }: { r: number; z: number; t?: number; dir?: 1 | -1; color?: string; boss?: number }) {
  return (
    <group position={[0, 0, z - (dir * t) / 2]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, t, 64]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, dir * (t / 2 + 0.04)]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[boss, boss, 0.08, 40]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.45} />
      </mesh>
    </group>
  )
}

/** Reads the model's animation angle every frame and reports a derived discrete value (re-renders only on change). */
export function useDiscrete<T>(fn: (angle: number, time: number) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const v = useViewer()
  const [val, setVal] = useState<T>(() => fn(v.anim.current.angle, v.anim.current.time))
  const last = useRef(val)
  useFrame(() => {
    const next = fn(v.anim.current.angle, v.anim.current.time)
    if (!eq(next, last.current)) {
      last.current = next
      setVal(next)
      v.invalidate()
    }
  })
  return val
}

/** A small info chip in the scene (screen-sized), e.g. the Hall code and the switched pair. */
export function Chip({ at, children }: { at: Vec3; children: ReactNode }) {
  return (
    <Html position={at} center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
      <div className="mxm-chip">{children}</div>
    </Html>
  )
}

/** A glow ring (outline) around an energised coil: basic material, never highlighted or dimmed by the viewer. */
export function GlowLoop({ geometry, angle, color }: { geometry: THREE.BufferGeometry; angle: number; color: string }) {
  return (
    <group rotation={[0, 0, angle]}>
      <mesh geometry={geometry} scale={[1.0, 1.06, 1.06]} userData={{ noHighlight: true }}>
        <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * A small waveform chart in the scene (screen-sized SVG): traces over one electrical cycle (0…360°) and a cursor at
 * the angle the drawn rotor has now. Ideal shapes for illustration — never a measurement.
 */
export function WaveChart({ at, title, traces, angleOf, xLabel = 'θe', width = 230, height = 104, stacked = false }: { at: Vec3; title: string; traces: Array<{ label: string; color: string; fn: (deg: number) => number }>; angleOf: (angle: number, time: number) => number; xLabel?: string; width?: number; height?: number; stacked?: boolean }) {
  const v = useViewer()
  const cursor = useRef<SVGLineElement>(null)
  const padL = 8
  const padR = 34
  const top = 18
  const h = height - top - 14
  const w = width - padL - padR
  // stacked: one row per trace (easier to read when the shapes overlap); else all on one axis
  const rows = stacked ? traces.length : 1
  const rowH = h / rows
  const mid = (k: number) => top + (stacked ? k : 0) * rowH + rowH / 2
  const paths = useMemo(
    () =>
      traces.map((t, k) => {
        const pts: string[] = []
        for (let d = 0; d <= 360; d += 3) pts.push(`${(padL + (d / 360) * w).toFixed(1)},${(mid(k) - (t.fn(d) * rowH) / 2.4).toFixed(1)}`)
        return pts.join(' ')
      }),
    [traces, w, h], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useFrame(() => {
    const c = cursor.current
    if (!c) return
    const d = (((angleOf(v.anim.current.angle, v.anim.current.time) % 360) + 360) % 360) / 360
    const x = (padL + d * w).toFixed(1)
    c.setAttribute('x1', x)
    c.setAttribute('x2', x)
  })
  return (
    <Html position={at} center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
      <div className="mxm-chip">
        <svg className="mxm-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <text x={padL} y={11}>
            {title}
          </text>
          {Array.from({ length: rows }, (_, k) => (
            <line key={k} x1={padL} x2={padL + w} y1={mid(k)} y2={mid(k)} stroke="#5b6675" strokeWidth={1} />
          ))}
          {traces.map((t, k) => (
            <g key={t.label}>
              <polyline points={paths[k]} fill="none" stroke={t.color} strokeWidth={1.8} />
              <text x={padL + w + 5} y={stacked ? mid(k) + 3 : top + 8 + k * 13} style={{ fill: t.color }}>
                {t.label}
              </text>
            </g>
          ))}
          <line ref={cursor} x1={padL} x2={padL} y1={top - 2} y2={top + h + 2} stroke="#e8ecf2" strokeWidth={1.4} />
          <text x={padL} y={height - 2}>
            0°
          </text>
          <text x={padL + w - 22} y={height - 2}>
            360°
          </text>
          <text x={padL + w / 2 - 8} y={height - 2}>
            {xLabel}
          </text>
        </svg>
      </div>
    </Html>
  )
}
