import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../types.ts'

/*
 * Salient-pole synchronous machine — shared original procedural geometry (alternator and synchronous motor).
 *
 * Frame of reference: the shaft is the z axis; front (+z) = slip-ring end, rear (−z) = drive end (coupling, prime
 * mover or load). Seen from the front, a positive angle is counter-clockwise.
 *
 * Stator: 24 slots, 4 poles, single-layer full-pitch three-phase winding (2 slots per pole per phase). In electrical
 * degrees θe = 2·θm, the phase belts (60° el. each) are centred at
 *     −b 30°, +a 90°, −c 150°, +b 210°, −a 270°, +c 330°
 * so the magnetic axes of the phases a, b, c sit at θe = 0°, 120°, 240°: the positive-sequence currents make a field
 * that rotates counter-clockwise (a → b → c), and a rotor turning counter-clockwise induces EMFs in the order a, b, c.
 * Rotor: 4 salient poles, N at θm = 0° and 180°, S at 90° and 270° (rotor angle 0).
 */

export const LC = 1.4 // stator/rotor core length
export const BORE = 1.0
export const SLOT_R = 1.24
export const STATOR_R = 1.5
export const FRAME_R = 1.68
export const SLOTS = 24
export const COND_R = 1.12 // radius of the conductors in the slots
export const POLE_FACE = 0.93
export const POLE_ARC = (32 * Math.PI) / 180 // half pole arc
export const HUB_R = 0.36
export const BODY_W = 0.17
export const SHOE_IN = 0.76
export const SHAFT_R = 0.12
export const RING_Z = [1.25, 1.47] as const

export const COLORS = {
  steel: '#9aa4b2',
  darkSteel: '#5d6878',
  frame: '#4f6072',
  copper: '#c27a3c',
  brass: '#b8913a',
  carbon: '#2a2d33',
  insul: '#2b2f36',
  shaft: '#c3cad4',
  phase: { a: '#d0533f', b: '#e0b43a', c: '#4f86d9' } as Record<Phase, string>,
}
export type Phase = 'a' | 'b' | 'c'

export const slotAngle = (k: number) => ((k + 0.5) * 2 * Math.PI) / SLOTS
/** Phase and polarity of slot k (single-layer winding, see the header). */
export function slotPhase(k: number): { phase: Phase; sign: 1 | -1 } {
  const e = ((((k + 0.5) * 30) % 360) + 360) % 360
  const belt = Math.floor(e / 60) // centred at 30 + 60·belt
  const table: Array<{ phase: Phase; sign: 1 | -1 }> = [
    { phase: 'b', sign: -1 },
    { phase: 'a', sign: 1 },
    { phase: 'c', sign: -1 },
    { phase: 'b', sign: 1 },
    { phase: 'a', sign: -1 },
    { phase: 'c', sign: 1 },
  ]
  return table[belt]
}
/** Mechanical angles of the magnetic axes of the phases (4 poles: two per phase). */
export const PHASE_AXIS: Record<Phase, number> = { a: 0, b: Math.PI / 3, c: (2 * Math.PI) / 3 }

const polar = (r: number, a: number, z = 0): Vec3 => [r * Math.cos(a), r * Math.sin(a), z]

/** Stator lamination stack: annulus with 24 open slots, extruded along z, centred on z = 0. */
export function statorGeometry() {
  const s = new THREE.Shape()
  s.absarc(0, 0, STATOR_R, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  const half = (Math.PI / SLOTS) * 0.46
  for (let k = 0; k < SLOTS; k++) {
    const c = slotAngle(k)
    const a = c - half
    const b = c + half
    if (k === 0) hole.moveTo(BORE * Math.cos(a), BORE * Math.sin(a))
    else hole.lineTo(BORE * Math.cos(a), BORE * Math.sin(a))
    hole.lineTo(SLOT_R * Math.cos(a), SLOT_R * Math.sin(a))
    hole.lineTo(SLOT_R * Math.cos(b), SLOT_R * Math.sin(b))
    hole.lineTo(BORE * Math.cos(b), BORE * Math.sin(b))
    const next = slotAngle(k + 1) - half
    const n = 4
    for (let i = 1; i <= n; i++) {
      const t = b + ((next - b) * i) / n
      hole.lineTo(BORE * Math.cos(t), BORE * Math.sin(t))
    }
  }
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth: LC, bevelEnabled: false, curveSegments: 48 })
  g.translate(0, 0, -LC / 2)
  return g
}

/** Salient-pole rotor lamination: hub, 4 pole bodies and pole shoes, a hole for the shaft. */
export function rotorGeometry() {
  const s = new THREE.Shape()
  const pts: Array<[number, number]> = []
  const rot = (x: number, y: number, c: number): [number, number] => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]
  const xHub = Math.sqrt(HUB_R * HUB_R - BODY_W * BODY_W)
  const xShoe = Math.sqrt(SHOE_IN * SHOE_IN - BODY_W * BODY_W)
  const aBody = Math.asin(BODY_W / SHOE_IN)
  const aHub = Math.atan2(BODY_W, xHub)
  for (let i = 0; i < 4; i++) {
    const c = (i * Math.PI) / 2
    const local: Array<[number, number]> = []
    local.push([xHub, -BODY_W], [xShoe, -BODY_W])
    for (let t = 1; t <= 4; t++) {
      const a = -aBody - ((POLE_ARC - aBody) * t) / 4
      local.push([SHOE_IN * Math.cos(a), SHOE_IN * Math.sin(a)])
    }
    for (let t = 0; t <= 16; t++) {
      const a = -POLE_ARC + (2 * POLE_ARC * t) / 16
      local.push([POLE_FACE * Math.cos(a), POLE_FACE * Math.sin(a)])
    }
    for (let t = 0; t <= 3; t++) {
      const a = POLE_ARC - ((POLE_ARC - aBody) * t) / 4
      local.push([SHOE_IN * Math.cos(a), SHOE_IN * Math.sin(a)])
    }
    local.push([xShoe, BODY_W], [xHub, BODY_W])
    for (const [x, y] of local) pts.push(rot(x, y, c))
    // hub arc to the next pole
    for (let t = 1; t < 6; t++) {
      const a = c + aHub + ((Math.PI / 2 - 2 * aHub) * t) / 6
      pts.push([HUB_R * Math.cos(a), HUB_R * Math.sin(a)])
    }
  }
  s.moveTo(...pts[0])
  for (const p of pts.slice(1)) s.lineTo(...p)
  s.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, SHAFT_R, 0, Math.PI * 2, true)
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth: LC, bevelEnabled: false, curveSegments: 12 })
  g.translate(0, 0, -LC / 2)
  return g
}

/** One field coil around a pole body, pole axis along +x (rotate the mesh to the pole angle). */
export function fieldCoilGeometry() {
  const w = BODY_W + 0.008
  const t = 0.075
  const hl = LC / 2 + 0.005
  const round = (sh: THREE.Shape | THREE.Path, hx: number, hy: number, r: number) => {
    sh.moveTo(-hx + r, -hy)
    sh.lineTo(hx - r, -hy)
    sh.absarc(hx - r, -hy + r, r, -Math.PI / 2, 0, false)
    sh.lineTo(hx, hy - r)
    sh.absarc(hx - r, hy - r, r, 0, Math.PI / 2, false)
    sh.lineTo(-hx + r, hy)
    sh.absarc(-hx + r, hy - r, r, Math.PI / 2, Math.PI, false)
    sh.lineTo(-hx, -hy + r)
    sh.absarc(-hx + r, -hy + r, r, Math.PI, Math.PI * 1.5, false)
  }
  const s = new THREE.Shape()
  round(s, w + t, hl + t, t)
  const h = new THREE.Path()
  round(h, w, hl, 0.01)
  s.holes.push(h)
  const depth = 0.27
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 })
  // shape x → world y (tangential), shape y → world z (axial), extrusion → world x (radial), from r = 0.42
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0.42, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1))
  return g
}

/** The end-winding overhang of one coil: slot k → slot k + 6 at the end z0 (side +1 front, −1 rear). */
function endTurnCurve(k: number, side: 1 | -1, lift: number, bulge: number) {
  const a1 = slotAngle(k)
  const a2 = slotAngle(k + 6)
  const z0 = (side * LC) / 2
  const r = COND_R
  const pts = [
    polar(r, a1, z0 - side * 0.04),
    polar(r, a1, z0 + side * 0.1),
    polar(r + bulge, a1 + (a2 - a1) * 0.25, z0 + side * lift * 0.85),
    polar(r + bulge, (a1 + a2) / 2, z0 + side * lift),
    polar(r + bulge, a1 + (a2 - a1) * 0.75, z0 + side * lift * 0.85),
    polar(r, a2, z0 + side * 0.1),
    polar(r, a2, z0 - side * 0.04),
  ].map((p) => new THREE.Vector3(...p))
  return new THREE.CatmullRomCurve3(pts)
}

/** All winding geometry, grouped by phase: slot conductors and end turns. */
export function useStatorWinding() {
  return useMemo(() => {
    const byPhase: Record<Phase, { slots: number[]; ends: THREE.TubeGeometry[] }> = { a: { slots: [], ends: [] }, b: { slots: [], ends: [] }, c: { slots: [], ends: [] } }
    const lift: Record<Phase, number> = { a: 0.11, b: 0.165, c: 0.22 }
    const bulge: Record<Phase, number> = { a: 0.02, b: 0.075, c: 0.13 }
    for (let k = 0; k < SLOTS; k++) {
      const { phase, sign } = slotPhase(k)
      byPhase[phase].slots.push(k)
      if (sign !== 1) continue
      const second = slotPhase(k - 1).phase === phase && slotPhase(k - 1).sign === 1 ? 0.025 : 0
      for (const side of [1, -1] as const) byPhase[phase].ends.push(new THREE.TubeGeometry(endTurnCurve(k, side, lift[phase] + second, bulge[phase] + second), 36, 0.042, 6, false))
    }
    return byPhase
  }, [])
}

/** Hooks for the meshes that every synchronous model draws. */
export function useSyncGeometry() {
  return useMemo(() => ({ stator: statorGeometry(), rotor: rotorGeometry(), coil: fieldCoilGeometry() }), [])
}

// ── reusable drawn pieces (geometry only: the models wrap them in <Part>) ────────────────────────────

export function Frame() {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[FRAME_R, FRAME_R, 2.0, 64, 1, true]} />
        <meshStandardMaterial color={COLORS.frame} metalness={0.55} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[STATOR_R + 0.005, STATOR_R + 0.005, 2.0, 64, 1, true]} />
        <meshStandardMaterial color={COLORS.darkSteel} metalness={0.5} roughness={0.5} side={THREE.BackSide} />
      </mesh>
      {/* cooling ribs */}
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 14 + 0.12
        if (Math.sin(a) < -0.72) return null // none between the feet
        return (
          <mesh key={i} position={[(FRAME_R + 0.05) * Math.cos(a), (FRAME_R + 0.05) * Math.sin(a), 0]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.11, 0.05, 1.9]} />
            <meshStandardMaterial color={COLORS.frame} metalness={0.55} roughness={0.5} />
          </mesh>
        )
      })}
      {/* feet */}
      {[1.12, -1.12].map((x) => (
        <group key={x}>
          <mesh position={[x, -1.52, 0]}>
            <boxGeometry args={[0.32, 0.42, 1.7]} />
            <meshStandardMaterial color={COLORS.frame} metalness={0.5} roughness={0.55} />
          </mesh>
          <mesh position={[x * 1.08, -1.76, 0]}>
            <boxGeometry args={[0.5, 0.08, 1.8]} />
            <meshStandardMaterial color={COLORS.darkSteel} metalness={0.5} roughness={0.55} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function TerminalBox() {
  return (
    <group position={[0, FRAME_R + 0.2, 0.25]}>
      <mesh>
        <boxGeometry args={[0.72, 0.36, 0.62]} />
        <meshStandardMaterial color={COLORS.frame} metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.78, 0.05, 0.68]} />
        <meshStandardMaterial color={COLORS.darkSteel} metalness={0.5} roughness={0.5} />
      </mesh>
      {(['a', 'b', 'c'] as Phase[]).map((ph, i) => (
        <mesh key={ph} position={[(i - 1) * 0.22, 0.3, 0.12]}>
          <cylinderGeometry args={[0.05, 0.05, 0.18, 16]} />
          <meshStandardMaterial color={COLORS.phase[ph]} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      {/* cable gland */}
      <mesh position={[0.43, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.1, 0.14, 20]} />
        <meshStandardMaterial color="#20242a" roughness={0.8} />
      </mesh>
    </group>
  )
}

export function EndShield({ side }: { side: 1 | -1 }) {
  const z = side * 1.05
  return (
    <group position={[0, 0, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[FRAME_R, FRAME_R, 0.1, 64]} />
        <meshStandardMaterial color={COLORS.darkSteel} metalness={0.55} roughness={0.45} />
      </mesh>
      {/* bearing boss and bearing */}
      <mesh position={[0, 0, side * 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.16, 32]} />
        <meshStandardMaterial color={COLORS.steel} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, side * 0.19]}>
        <torusGeometry args={[0.19, 0.05, 10, 28]} />
        <meshStandardMaterial color="#b9c2cf" metalness={0.9} roughness={0.25} />
      </mesh>
      {/* ventilation openings (dark) */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4 + Math.PI / 8
        return (
          <mesh key={i} position={[0.95 * Math.cos(a), 0.95 * Math.sin(a), side * 0.051]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.36, 0.14, 0.01]} />
            <meshStandardMaterial color="#12161c" roughness={0.9} />
          </mesh>
        )
      })}
    </group>
  )
}

export function StatorCore({ geo }: { geo: THREE.BufferGeometry }) {
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial color={COLORS.steel} metalness={0.65} roughness={0.4} />
      </mesh>
      {/* lamination lines on the outside */}
      {Array.from({ length: 13 }, (_, i) => (
        <mesh key={i} position={[0, 0, -LC / 2 + ((i + 1) * LC) / 14]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[STATOR_R + 0.003, STATOR_R + 0.003, 0.006, 64, 1, true]} />
          <meshStandardMaterial color="#454d59" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

export function StatorWinding() {
  const w = useStatorWinding()
  return (
    <group>
      {(['a', 'b', 'c'] as Phase[]).map((ph) => (
        <group key={ph}>
          {w[ph].slots.map((k) => (
            <mesh key={k} position={polar(COND_R, slotAngle(k))} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, LC + 0.08, 10]} />
              <meshStandardMaterial color={COLORS.phase[ph]} metalness={0.45} roughness={0.45} />
            </mesh>
          ))}
          {w[ph].ends.map((g, i) => (
            <mesh key={i} geometry={g}>
              <meshStandardMaterial color={COLORS.phase[ph]} metalness={0.45} roughness={0.45} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

export function RotorCore({ geo }: { geo: THREE.BufferGeometry }) {
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#8d97a6" metalness={0.7} roughness={0.38} />
      </mesh>
      {/* end plates */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, 0, s * (LC / 2 + 0.015)]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[HUB_R, HUB_R, 0.03, 32]} />
          <meshStandardMaterial color={COLORS.darkSteel} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

export function FieldCoils({ geo }: { geo: THREE.BufferGeometry }) {
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} geometry={geo} rotation={[0, 0, (i * Math.PI) / 2]}>
          <meshStandardMaterial color={COLORS.copper} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

/** Damper (amortisseur) bars in the pole faces, joined at each end by a short segment ring per pole. */
export function DamperBars() {
  const bars = [-24, -12, 0, 12, 24].map((d) => (d * Math.PI) / 180)
  return (
    <group>
      {[0, 1, 2, 3].map((i) => {
        const c = (i * Math.PI) / 2
        return (
          <group key={i}>
            {bars.map((b) => (
              <mesh key={b} position={polar(0.875, c + b)} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.024, 0.024, LC + 0.1, 8]} />
                <meshStandardMaterial color="#d08a45" metalness={0.8} roughness={0.3} />
              </mesh>
            ))}
            {[1, -1].map((s) => (
              <mesh key={s} position={[0, 0, s * (LC / 2 + 0.05)]} rotation={[0, 0, c - 0.44]}>
                <torusGeometry args={[0.875, 0.022, 6, 16, 0.88]} />
                <meshStandardMaterial color="#d08a45" metalness={0.8} roughness={0.3} />
              </mesh>
            ))}
          </group>
        )
      })}
    </group>
  )
}

export function Shaft({ rear = -1.75, front = 1.68 }: { rear?: number; front?: number }) {
  const len = front - rear
  return (
    <group>
      <mesh position={[0, 0, (front + rear) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[SHAFT_R, SHAFT_R, len, 24]} />
        <meshStandardMaterial color={COLORS.shaft} metalness={0.85} roughness={0.25} />
      </mesh>
      {/* a key at the front end makes the rotation visible */}
      <mesh position={[0, SHAFT_R, front - 0.1]}>
        <boxGeometry args={[0.06, 0.05, 0.16]} />
        <meshStandardMaterial color="#8a939f" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  )
}

export function SlipRings() {
  return (
    <group>
      <mesh position={[0, 0, 1.36]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.17, 0.17, 0.48, 24]} />
        <meshStandardMaterial color={COLORS.insul} roughness={0.85} />
      </mesh>
      {RING_Z.map((z) => (
        <mesh key={z} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.12, 32]} />
          <meshStandardMaterial color="#d39a52" metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
      {/* field leads from the rings along the shaft to the field winding */}
      {[0.6, -0.6].map((a, i) => (
        <mesh key={a} position={[0.135 * Math.cos(a + Math.PI / 4), 0.135 * Math.sin(a + Math.PI / 4), 0.98 + i * 0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.4, 6]} />
          <meshStandardMaterial color={COLORS.copper} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

export function Brushes() {
  return (
    <group>
      {RING_Z.map((z) => (
        <group key={z}>
          <mesh position={[0, 0.32, z]}>
            <boxGeometry args={[0.1, 0.14, 0.09]} />
            <meshStandardMaterial color={COLORS.carbon} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.46, z]}>
            <boxGeometry args={[0.16, 0.14, 0.14]} />
            <meshStandardMaterial color={COLORS.brass} metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.6, z]}>
            <cylinderGeometry args={[0.03, 0.03, 0.16, 10]} />
            <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* insulated holder bar, fixed to the front end shield */}
      <mesh position={[0, 0.54, 1.3]}>
        <boxGeometry args={[0.1, 0.05, 0.5]} />
        <meshStandardMaterial color={COLORS.insul} roughness={0.8} />
      </mesh>
    </group>
  )
}

export function Coupling() {
  return (
    <group>
      {[-1.32, -1.46].map((z) => (
        <mesh key={z} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.12, 40]} />
          <meshStandardMaterial color="#7c8794" metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3
        return (
          <mesh key={i} position={[0.28 * Math.cos(a), 0.28 * Math.sin(a), -1.39]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.34, 10]} />
            <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
          </mesh>
        )
      })}
    </group>
  )
}

/** A machine coupled to the shaft, drawn cut short (prime mover or driven load). */
export function CoupledStub({ color, kind }: { color: string; kind: 'prime-mover' | 'load' }) {
  return (
    <group>
      <mesh position={[0, 0, -1.62]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.08, 48]} />
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, -2.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.75, 0.75, 0.92, 48]} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.55} />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 10
        return (
          <mesh key={i} position={[0.78 * Math.cos(a), 0.78 * Math.sin(a), -2.12]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.08, 0.04, 0.86]} />
            <meshStandardMaterial color={color} metalness={0.4} roughness={0.55} />
          </mesh>
        )
      })}
      {/* the cut end: hatched dark face */}
      <mesh position={[0, 0, -2.585]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.75, 0.75, 0.01, 48]} />
        <meshStandardMaterial color="#1a1e24" roughness={0.9} />
      </mesh>
      {kind === 'load' && (
        <mesh position={[0, 0.85, -2.12]}>
          <boxGeometry args={[0.36, 0.3, 0.5]} />
          <meshStandardMaterial color={color} metalness={0.4} roughness={0.55} />
        </mesh>
      )}
      {kind === 'prime-mover' && (
        <mesh position={[0.62, 0.62, -2.0]}>
          <boxGeometry args={[0.3, 0.3, 0.5]} />
          <meshStandardMaterial color="#3d4a36" metalness={0.4} roughness={0.55} />
        </mesh>
      )}
    </group>
  )
}
