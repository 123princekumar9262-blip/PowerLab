import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { useViewer } from '../../viewer/context.tsx'
import { Arrow, FlowLine, LAYER_COLOR, Marker } from '../../visualizations/viz.tsx'

/*
 * Shared drawing kit of the power-semiconductor models (diode, MOSFET, IGBT, SCR).
 *
 * Every device is drawn as a CUT-AWAY CELL: a 2D cross-section in the xy plane (x lateral, +y = top surface of the
 * die), extruded along z into a slab. The front face (z = +DEPTH/2) is the cut, and all conceptual visuals
 * (depletion region, carriers, current, heat) are drawn on that face. Doping is shown by colour: n-type cool blues
 * (n+ dark, n− pale), p-type warm reds (p+ dark, p pale); oxide is translucent ivory, metal is aluminium grey.
 * Proportions are illustrative: in a real device the n− drift is tens to hundreds of µm thick while the top
 * structures are a few µm.
 */

export type P2 = [number, number]
export const DEPTH = 1.6
/** z of the front (cut) face, plus a hair so overlays draw in front of it. */
export const FZ = DEPTH / 2 + 0.012

export const COLOR = {
  nPlus: '#2f58b8',
  nMinus: '#8fb0e0',
  nBuffer: '#5a7fc9',
  pPlus: '#a63b35',
  p: '#d98a74',
  oxide: '#eee6c4',
  poly: '#7d6f92',
  metal: '#c8ced8',
  backMetal: '#a7aeb9',
  channel: '#4bd7ff',
} as const

/** Carriers and other conceptual colours (also told apart by shape: electrons = solid dots, holes = rings). */
export const CARRIER = { electron: '#ffd84d', hole: '#ffffff' } as const
export const E_FIELD = '#ff9f1c'

export const rect = (x0: number, y0: number, x1: number, y1: number): P2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]
/** Points of a circle arc (both ends included), angles in radians. */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): P2[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2
  })
}
/** Mirror a polygon about x = 0 (order reversed so the winding stays the same). */
export const mirror = (pts: P2[]): P2[] => pts.map(([x, y]) => [-x, y] as P2).reverse()

/** Drop consecutive duplicate points (an arc that starts where the previous segment ended). */
function clean(pts: P2[]): P2[] {
  const out = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6)
  const a = out[0]
  const b = out[out.length - 1]
  if (out.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop()
  return out
}

function shapeOf(pts: P2[], holes: P2[][] = []) {
  const s = new THREE.Shape(clean(pts).map(([x, y]) => new THREE.Vector2(x, y)))
  for (const h of holes) s.holes.push(new THREE.Path(clean(h).map(([x, y]) => new THREE.Vector2(x, y))))
  return s
}

/** A doped region, oxide or metal layer: the 2D profile extruded through the slab (centred on z = 0). */
export function Region({ pts, holes, color, kind = 'si', depth = DEPTH, opacity }: { pts: P2[]; holes?: P2[][]; color: string; kind?: 'si' | 'metal' | 'oxide'; depth?: number; opacity?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes), { depth, bevelEnabled: false, curveSegments: 8 })
    g.translate(0, 0, -depth / 2)
    return g
  }, [pts, holes, depth])
  const transparent = kind === 'oxide' || opacity !== undefined
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        color={color}
        metalness={kind === 'metal' ? 0.75 : 0.05}
        roughness={kind === 'metal' ? 0.35 : kind === 'oxide' ? 0.2 : 0.62}
        transparent={transparent}
        opacity={opacity ?? (kind === 'oxide' ? 0.82 : 1)}
      />
    </mesh>
  )
}

/**
 * Renders its children one frame after mounting. Screen-space markers (drei <Html>, each its own React root) that
 * exist from the very first render of the canvas are otherwise unmounted by StrictMode's mount → unmount → mount
 * check while the canvas is still rendering, which React reports as an error.
 */
export function Deferred({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return ready ? <>{children}</> : null
}

/**
 * Is the assembly together (not exploded, nothing isolated)? Screen-space markers are not hidden by a hidden
 * parent group, so markers tied to the assembled positions use this to unmount while the parts are moved apart.
 */
export function useAssembled(): boolean {
  const v = useViewer()
  const [together, setTogether] = useState(true)
  const last = useRef(true)
  useFrame(() => {
    const t = v.anim.current.explode < 0.02 && v.anim.current.explodeTarget === 0
    if (t !== last.current) {
      last.current = t
      setTogether(t)
    }
  })
  return together && !v.isolate
}

// ── modes ─────────────────────────────────────────────────────────────────────────────────────────────────
/** What the cell is doing: drives the conceptual layers (never the geometry of the doped regions). */
export type Mode = 'idle' | 'block' | 'rblock' | 'turnon' | 'on' | 'reverse' | 'turnoff'

/** The mode shown: the guided step's own mode, else the state chosen in Calculate (an index into `byState`). */
export function modeOf(step: string | null, stepMode: Record<string, Mode>, state: number | undefined, byState: Mode[]): Mode {
  if (step) return stepMode[step] ?? 'idle'
  return byState[Math.round(state ?? 0)] ?? 'idle'
}

// ── package (TO-247 style), drawn beside the magnified cell ──────────────────────────────────────────────
export interface Lead {
  /** −1, 0, +1: left, middle, right lead. */
  pos: -1 | 0 | 1
  label: string
  /** The lead is part of the tab (the die's back contact). */
  tab?: boolean
  /** Bond wires to this lead: from which die pad. */
  wire?: 'main' | 'gate'
}
/** Where the package sits (its group origin) and its scale. */
export const PKG = { x: -3.15, y: 0.45, s: 0.78 }
const PKG_W = 1.35
const LEAD_PITCH = 0.46

/**
 * The package: moulded epoxy body (drawn translucent to show the inside), copper lead frame (tab + leads), the
 * silicon die soldered on the tab, and aluminium bond wires from the die's top pads to the leads. Part ids:
 * `package`, `leadframe`, `die`, `bond-wires` (all `outer`). The die's back is the tab (drain / collector /
 * cathode / anode, per device).
 */
export function Package({ leads, gatePad = true }: { leads: Lead[]; gatePad?: boolean }) {
  const v = useViewer()
  const geo = useMemo(() => {
    const hole = arcPts(0, 0.62, 0.15, 0, -Math.PI * 2, 24).slice(0, -1)
    const outline = rect(-PKG_W / 2, -0.95, PKG_W / 2, 1.0)
    const tab = new THREE.ExtrudeGeometry(shapeOf(outline, [hole]), { depth: 0.15, bevelEnabled: false })
    tab.translate(0, 0, -0.215)
    const body = new THREE.ExtrudeGeometry(shapeOf(rect(-PKG_W / 2, -0.95, PKG_W / 2, 0.98), [hole]), { depth: 0.28, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 })
    body.translate(0, 0, -0.065)
    return { tab, body }
  }, [])
  const die = { x: 0, y: 0.05, z: -0.04, w: 0.56 }
  const dieTop = die.z + 0.03
  const wires = useMemo(() => {
    const out: THREE.TubeGeometry[] = []
    for (const l of leads) {
      if (!l.wire) continue
      const from = l.wire === 'gate' ? [[die.x - 0.19, die.y - 0.19]] : [[die.x + 0.02, die.y - 0.06], [die.x + 0.14, die.y - 0.06]]
      for (const [fx, fy] of from) {
        const tx = l.pos * LEAD_PITCH + (fx - die.x) * 0.25
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(fx, fy, dieTop), new THREE.Vector3((fx + tx) / 2, (fy - 0.82) / 2, dieTop + 0.16), new THREE.Vector3(tx, -0.82, -0.09)])
        out.push(new THREE.TubeGeometry(curve, 16, 0.014, 6, false))
      }
    }
    return out
  }, [leads]) // eslint-disable-line react-hooks/exhaustive-deps
  const showMarks = !v.showInside && !v.isolate
  return (
    <group position={[PKG.x, PKG.y, 0]} scale={PKG.s}>
      <Part id="leadframe">
        <mesh geometry={geo.tab}>
          <meshStandardMaterial color="#c58a4a" metalness={0.8} roughness={0.3} />
        </mesh>
        {leads.map((l) => (
          <group key={l.pos} position={[l.pos * LEAD_PITCH, 0, -0.14]}>
            <mesh position={[0, -1.6, 0]}>
              <boxGeometry args={[0.1, 1.3, 0.05]} />
              <meshStandardMaterial color="#d9dde3" metalness={0.85} roughness={0.25} />
            </mesh>
            {/* wider shoulder; the inner end of an isolated lead is a bonding post */}
            <mesh position={[0, l.tab ? -0.9 : -0.86, l.tab ? 0 : 0.04]}>
              <boxGeometry args={[l.tab ? 0.12 : 0.2, l.tab ? 0.12 : 0.2, 0.06]} />
              <meshStandardMaterial color="#c58a4a" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </Part>
      <Part id="die">
        <mesh position={[die.x, die.y, die.z]}>
          <boxGeometry args={[die.w, die.w, 0.05]} />
          <meshStandardMaterial color="#3a4250" metalness={0.3} roughness={0.5} />
        </mesh>
        {/* top metal: the main pad (source / emitter / anode / cathode) and the gate pad */}
        <mesh position={[die.x + 0.04, die.y + 0.02, dieTop - 0.002]}>
          <boxGeometry args={[gatePad ? 0.4 : 0.46, gatePad ? 0.4 : 0.46, 0.008]} />
          <meshStandardMaterial color={COLOR.metal} metalness={0.8} roughness={0.3} />
        </mesh>
        {gatePad && (
          <mesh position={[die.x - 0.19, die.y - 0.19, dieTop - 0.002]}>
            <boxGeometry args={[0.1, 0.1, 0.008]} />
            <meshStandardMaterial color="#e3e6ea" metalness={0.8} roughness={0.3} />
          </mesh>
        )}
      </Part>
      <Part id="bond-wires">
        {wires.map((g, k) => (
          <mesh key={k} geometry={g}>
            <meshStandardMaterial color="#e6e9ee" metalness={0.9} roughness={0.2} />
          </mesh>
        ))}
      </Part>
      <Part id="package">
        <mesh geometry={geo.body}>
          <meshStandardMaterial color="#20242b" metalness={0.1} roughness={0.7} transparent opacity={0.42} depthWrite={false} />
        </mesh>
      </Part>
      {showMarks && (
        <Deferred>
          {leads.map((l) => (
            <Marker key={l.pos} at={[l.pos * LEAD_PITCH, -2.42, 0]} text={l.label} tone="neutral" />
          ))}
        </Deferred>
      )}
    </group>
  )
}

/** Dashed lines from the die in the package to the magnified cell: "this is one cell of that die". */
export function Callout({ top, bottom }: { top: number; bottom: number }) {
  const v = useViewer()
  const together = useAssembled()
  if (v.showInside || !together) return null
  const dx = PKG.x + 0.32 * PKG.s
  const dy = PKG.y + 0.05 * PKG.s
  const dz = 0
  return (
    <group>
      <Line points={[[dx, dy + 0.22 * PKG.s, dz], [-2, top, DEPTH / 2]]} color="#7d8899" lineWidth={1} dashed dashSize={0.08} gapSize={0.06} />
      <Line points={[[dx, dy - 0.22 * PKG.s, dz], [-2, bottom, DEPTH / 2]]} color="#7d8899" lineWidth={1} dashed dashSize={0.08} gapSize={0.06} />
      <Deferred>
        <Marker at={[0, top + 0.5, DEPTH / 2]} text="one cell of the die, magnified — not to scale" tone="neutral" />
      </Deferred>
    </group>
  )
}

// ── conceptual layers ────────────────────────────────────────────────────────────────────────────────────

/** A carrier stream: points from where the carriers enter to where they leave (in the direction they MOVE). */
export interface Stream {
  pts: P2[]
  /** Carriers per unit length (density). */
  density?: number
}

const hash = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Conceptual carriers moving along streams on the cut face (instanced: one draw call). Electrons: solid dots;
 * holes: rings. `speed` in model units per second of the animation clock (holes are drawn slower — their mobility
 * is about a third of the electrons'). The positions follow the clock, so a paused scene shows a still snapshot.
 */
export function Carriers({ streams, kind, speed = 0.3, density = 7, jitter = 0.07 }: { streams: Stream[]; kind: 'electron' | 'hole'; speed?: number; density?: number; jitter?: number }) {
  const v = useViewer()
  const ref = useRef<THREE.InstancedMesh>(null)
  const data = useMemo(() => {
    const items: Array<{ s: number; seg: Float32Array; len: number; pts: P2[]; jx: number; jy: number }> = []
    streams.forEach((st, si) => {
      const seg = new Float32Array(st.pts.length)
      for (let k = 1; k < st.pts.length; k++) seg[k] = seg[k - 1] + Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1])
      const len = seg[st.pts.length - 1]
      const n = Math.max(2, Math.round(len * (st.density ?? density)))
      for (let i = 0; i < n; i++) items.push({ s: (i + hash(i, si) * 0.6) / n, seg, len, pts: st.pts, jx: (hash(i, si + 7) - 0.5) * 2 * jitter, jy: (hash(i, si + 13) - 0.5) * 2 * jitter })
    })
    return items
  }, [streams, density, jitter])
  const geo = useMemo(() => (kind === 'electron' ? new THREE.SphereGeometry(0.042, 10, 8) : new THREE.TorusGeometry(0.04, 0.013, 6, 16)), [kind])
  const m = useMemo(() => new THREE.Matrix4(), [])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const t = v.anim.current.time
    data.forEach((it, i) => {
      if (it.len <= 0) return
      let u = (it.s + (t * speed) / it.len) % 1
      if (u < 0) u += 1
      const d = u * it.len
      let k = 1
      while (k < it.pts.length - 1 && it.seg[k] < d) k++
      const a = it.pts[k - 1]
      const b = it.pts[k]
      const f = (d - it.seg[k - 1]) / Math.max(1e-9, it.seg[k] - it.seg[k - 1])
      m.makeTranslation(a[0] + (b[0] - a[0]) * f + it.jx, a[1] + (b[1] - a[1]) * f + it.jy, FZ + 0.03)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh key={data.length} ref={ref} args={[geo, undefined, data.length]} frustumCulled={false} userData={{ noHighlight: true }}>
      <meshBasicMaterial color={CARRIER[kind]} toneMapped={false} />
    </instancedMesh>
  )
}

/** Conventional current along a path on the cut face (moving dashes, first point → last). */
export function CurrentPath({ pts, rate = 1, width = 3 }: { pts: P2[]; rate?: number; width?: number }) {
  return <FlowLine points={pts.map(([x, y]) => [x, y, FZ + 0.05] as Vec3)} color={LAYER_COLOR.current} rate={rate} width={width} />
}

/**
 * The depletion region of a reverse-biased junction at y = yJ, spreading `depth` (model units) into the lightly
 * doped side (dir = −1: downwards, +1: upwards) and a thin sliver into the heavily doped side. Ionised donors (+)
 * and acceptors (−) are left behind; the field E points from the + side to the − side.
 * anim: 'grow' — while playing, the voltage ramps up and W follows √V; 'shrink' — the region collapses (turn-on);
 * 'none' — still, at full width. Paused: drawn at its full (final) width.
 */
export function Depletion({ x0, x1, yJ, depth, dir, nSign = '+', anim = 'none', label = true }: { x0: number; x1: number; yJ: number; depth: number; dir: 1 | -1; nSign?: '+' | '−'; anim?: 'grow' | 'shrink' | 'none'; label?: boolean }) {
  const v = useViewer()
  const main = useRef<THREE.Mesh>(null)
  const sliver = useRef<THREE.Mesh>(null)
  const arrows = useRef<THREE.Group>(null)
  const thin = Math.min(0.06, depth * 0.25)
  useFrame(() => {
    const a = v.anim.current
    let g = 1
    if (a.playing && anim !== 'none') {
      const tau = (a.time % 5) / 5
      const ramp = Math.min(1, tau / 0.7)
      g = anim === 'grow' ? Math.sqrt(ramp) : Math.sqrt(1 - ramp)
    }
    const h = Math.max(1e-3, depth * g)
    if (main.current) {
      main.current.scale.set(x1 - x0, h, 1)
      main.current.position.set((x0 + x1) / 2, yJ + (dir * h) / 2, FZ)
    }
    if (sliver.current) {
      sliver.current.scale.set(x1 - x0, Math.max(1e-3, thin * g), 1)
      sliver.current.position.set((x0 + x1) / 2, yJ - (dir * thin * g) / 2, FZ)
    }
    if (arrows.current) arrows.current.visible = g > 0.35
  })
  const n = Math.max(2, Math.round((x1 - x0) / 0.9))
  const xs = Array.from({ length: n }, (_, i) => x0 + ((i + 0.5) * (x1 - x0)) / n)
  const aLen = Math.min(0.42, depth * 0.85)
  return (
    <group>
      <mesh ref={main} userData={{ noHighlight: true }}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={sliver} userData={{ noHighlight: true }}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={arrows}>
        {aLen > 0.15 &&
          xs.map((x) => <Arrow key={x} from={[x + 0.12, yJ + dir * (aLen + 0.02), FZ + 0.04]} dir={[0, -dir, 0]} length={aLen} color={E_FIELD} radius={0.018} head={0.1} />)}
        {xs.map((x) => (
          <Marker key={`q${x}`} at={[x - 0.14, yJ + dir * Math.min(0.16, depth * 0.5), FZ + 0.04]} text={nSign === '+' ? '+ +' : '− −'} tone="neutral" />
        ))}
        {label && <Marker at={[x1 - 0.3, yJ + dir * Math.min(depth * 0.55, 0.5), FZ + 0.04]} text="E" tone="torque" />}
      </group>
    </group>
  )
}

/** A static depleted patch on the cut face (e.g. the pinched-off neck between two p wells). */
export function Shade({ x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) {
  return (
    <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, FZ]} userData={{ noHighlight: true }}>
      <planeGeometry args={[x1 - x0, y1 - y0]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Heat from the conduction loss flowing down through the die to the tab and heat sink. */
export function HeatFlow({ from, to, xs, text }: { from: number; to: number; xs: number[]; text: string }) {
  return (
    <group>
      {xs.map((x) => (
        <FlowLine key={x} points={[[x, from, FZ + 0.06], [x, to, FZ + 0.06]]} color={LAYER_COLOR.energy} rate={1} width={3.5} />
      ))}
      <Marker at={[0.3, -2.55, FZ + 0.06]} text={text} tone="energy" />
    </group>
  )
}

/** Terminal letters on the cell's contacts. */
export function Terminal({ at, text }: { at: P2; text: string }) {
  const together = useAssembled()
  if (!together) return null
  return (
    <Deferred>
      <Marker at={[at[0], at[1], FZ + 0.05]} text={text} tone="neutral" />
    </Deferred>
  )
}

/** A note on the model (e.g. "i ≈ 0: only leakage"). */
export function Note({ at, text, tone = 'neutral' }: { at: P2; text: string; tone?: 'neutral' | 'current' | 'torque' | 'energy' | 'emf' }) {
  return <Marker at={[at[0], at[1], FZ + 0.06]} text={text} tone={tone} />
}

/**
 * The inversion channel at the p-body surface under the gate: drawn faint (where it would form) when off, bright
 * when on; while turning on / off its strength follows the animation clock.
 */
export function Channel({ boxes, mode }: { boxes: Array<[number, number, number, number]>; mode: Mode }) {
  const v = useViewer()
  const mats = useRef<THREE.MeshStandardMaterial[]>([])
  const base = mode === 'on' || mode === 'turnon' ? 1 : mode === 'turnoff' ? 0.6 : 0.12
  useFrame(() => {
    const a = v.anim.current
    let s = base
    if (a.playing && (mode === 'turnon' || mode === 'turnoff')) {
      const ramp = Math.min(1, ((a.time % 5) / 5) / 0.6)
      s = mode === 'turnon' ? ramp : 1 - ramp
    }
    for (const m of mats.current) {
      if (!m) continue
      // the Part dims through opacity; keep the dimmed value when dimmed
      if (m.opacity > 0.17 || s < 0.16) m.opacity = Math.max(0.1, s)
      m.emissiveIntensity = 0.2 + 0.8 * s
    }
  })
  return (
    <group>
      {boxes.map(([x0, y0, x1, y1], k) => (
        <mesh key={k} position={[(x0 + x1) / 2, (y0 + y1) / 2, 0]}>
          <boxGeometry args={[x1 - x0, y1 - y0, DEPTH + 0.01]} />
          <meshStandardMaterial ref={(m: THREE.MeshStandardMaterial | null) => void (m && (mats.current[k] = m))} color={COLOR.channel} emissive={COLOR.channel} emissiveIntensity={0.6} transparent opacity={base} />
        </mesh>
      ))}
    </group>
  )
}
