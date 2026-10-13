import { Html } from '../../viewer/Html.tsx'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../types.ts'
import { useViewer } from '../../viewer/context.tsx'
import { arc, Arrow, CurvedArrow, FlowLine, LAYER_COLOR, Marker } from '../../visualizations/viz.tsx'
import { barCurrent, phaseCurrent, type Layout, type Phase } from './layout.ts'
import './induction-machines.css'

/*
 * Shared procedural geometry and conceptual layers of the induction machine models (three-phase cage, wound
 * rotor, single-phase). Original geometry, simplified. Shaft = z axis; the drive end (output shaft) is +z.
 * Positive angles are counter-clockwise seen from the drive end: the field and the rotor turn that way.
 *
 * Proportions (model units): stator core outer radius 1.0, bore 0.58, rotor radius 0.555 (the air gap is drawn
 * about 10× too wide so that it can be seen), core length 1.4.
 */
export const DIM = {
  len: 1.4,
  rStator: 1.0,
  rBore: 0.58,
  rSlotMid: 0.69,
  rRotor: 0.555,
  rShaft: 0.12,
  frameOut: 1.07,
  finOut: 1.24,
}
export const STEEL = '#9aa4b2'
export const LAM_EDGE = '#59626f'
export const COPPER = '#c27a3c'
export const ALU = '#c9ced6'
export const FRAME = '#4f6a84'
export const PHASE_COLOR: Record<Phase, string> = { a: '#d6524b', b: '#e0b43c', c: '#4f84dc', m: '#d6524b', x: '#4f84dc' }
export const PHASE_NAME: Record<Phase, string> = { a: 'a', b: 'b', c: 'c', m: 'main', x: 'aux' }

// ── geometry helpers ─────────────────────────────────────────────────────────────────────────────────
/** A full or partial annulus extruded along z, centred on z = 0. */
export function annulus(rIn: number, rOut: number, len: number, a0 = 0, a1 = Math.PI * 2, seg = 48) {
  const s = new THREE.Shape()
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    s.absarc(0, 0, rOut, 0, Math.PI * 2, false)
    const h = new THREE.Path()
    h.absarc(0, 0, rIn, 0, Math.PI * 2, true)
    s.holes.push(h)
  } else {
    s.absarc(0, 0, rOut, a0, a1, false)
    s.absarc(0, 0, rIn, a1, a0, true)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: seg })
  g.translate(0, 0, -len / 2)
  return g
}

/**
 * One stator lamination (extruded to `depth`): outer circle, bore with `slots` semi-closed slots (narrow opening,
 * wider slot body). Slot k is centred at (k + offset)·2π/slots.
 */
export function statorLamination(slots: number, offset: number, depth: number, rOut = DIM.rStator) {
  const pitch = (2 * Math.PI) / slots
  const rB = DIM.rBore
  const rLip = rB + 0.022
  const rBot = 0.8
  const open = pitch * 0.12
  const body = pitch * 0.3
  const shape = new THREE.Shape()
  shape.absarc(0, 0, rOut, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  const pts: Array<[number, number]> = []
  const P = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)]
  for (let k = 0; k < slots; k++) {
    const c = (k + offset) * pitch
    // bore arc up to the slot opening, then into the slot and back
    const prevEnd = c - pitch + open
    for (let j = 1; j <= 3; j++) pts.push(P(rB, prevEnd + ((c - open - prevEnd) * j) / 3))
    pts.push(P(rLip, c - open), P(rLip, c - body), P(rBot, c - body * 0.86), P(rBot + 0.012, c), P(rBot, c + body * 0.86), P(rLip, c + body), P(rLip, c + open), P(rB, c + open))
  }
  hole.moveTo(...pts[0])
  for (const p of pts.slice(1)) hole.lineTo(...p)
  hole.closePath()
  shape.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 40 })
  return g
}

/**
 * One rotor lamination: a disc with `n` slots open to the surface by a narrow slit (round bars for a cage, wider
 * slots for a wound rotor), and the shaft hole.
 */
export function rotorLamination(n: number, depth: number, opts: { rSlot: number; slotR: number; offset?: number } = { rSlot: 0.505, slotR: 0.04 }) {
  const R = DIM.rRotor
  const pitch = (2 * Math.PI) / n
  const off = (opts.offset ?? 0) * pitch
  const slit = 0.012 / R // half-angle of the opening
  const shape = new THREE.Shape()
  const first = off - slit
  shape.moveTo(R * Math.cos(first), R * Math.sin(first))
  for (let k = 0; k < n; k++) {
    const c = off + k * pitch
    // the slit down to the slot circle, round the slot, back up
    const cxs = opts.rSlot * Math.cos(c)
    const cys = opts.rSlot * Math.sin(c)
    const ux = Math.cos(c)
    const uy = Math.sin(c)
    const vx = -uy
    const vy = ux
    const ws = 0.012
    const top = Math.sqrt(Math.max(0, opts.slotR * opts.slotR - ws * ws))
    shape.lineTo(R * Math.cos(c - slit), R * Math.sin(c - slit))
    // slit side at −w down to the circle
    shape.lineTo(cxs + ux * top - vx * ws, cys + uy * top - vy * ws)
    const a0 = Math.atan2(-ws, top)
    for (let j = 1; j <= 10; j++) {
      const a = a0 - (j / 10) * (2 * Math.PI - 2 * Math.abs(a0))
      shape.lineTo(cxs + ux * opts.slotR * Math.cos(a) + vx * opts.slotR * Math.sin(a), cys + uy * opts.slotR * Math.cos(a) + vy * opts.slotR * Math.sin(a))
    }
    shape.lineTo(R * Math.cos(c + slit), R * Math.sin(c + slit))
    const next = c + pitch - slit
    for (let j = 1; j <= 4; j++) {
      const a = c + slit + ((next - c - slit) * j) / 4
      shape.lineTo(R * Math.cos(a), R * Math.sin(a))
    }
  }
  const hole = new THREE.Path()
  hole.absarc(0, 0, DIM.rShaft, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 })
}

/** A tube along a list of points (smooth curve). */
export function tube(points: Vec3[], radius: number, seg = 32, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  return new THREE.TubeGeometry(curve, seg, radius, radial, false)
}

/**
 * The end turn of one coil: leaves the slot at angle `from` (radius r0) at the core face z0 (dir = +1 front,
 * −1 back), bulges out axially by h and radially by dr, and enters the slot at from + span.
 */
export function endTurn(from: number, span: number, r0: number, z0: number, dir: 1 | -1, h: number, dr: number, n = 16): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const a = from + span * t
    const bulge = Math.sin(Math.PI * t)
    const r = r0 + dr * bulge
    const z = z0 + dir * (0.03 + h * Math.pow(bulge, 0.55))
    return [r * Math.cos(a), r * Math.sin(a), z] as Vec3
  })
}

// ── reusable parts ───────────────────────────────────────────────────────────────────────────────────
function mat(color: string, metalness = 0.5, roughness = 0.5, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} {...extra} />
}

/** Laminated stator core: a stack of slotted laminations with thin gaps (the lamination lines). */
export function StatorCore({ slots, offset, stack = 12 }: { slots: number; offset: number; stack?: number }) {
  const gap = 0.008
  const t = DIM.len / stack
  const g = useMemo(() => statorLamination(slots, offset, t - gap), [slots, offset, t])
  return (
    <group>
      {Array.from({ length: stack }, (_, i) => (
        <mesh key={i} geometry={g} position={[0, 0, -DIM.len / 2 + i * t + gap / 2]}>
          {mat(STEEL, 0.65, 0.4)}
        </mesh>
      ))}
      {/* the dark gaps between laminations, seen on the outside */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[DIM.rStator - 0.004, DIM.rStator - 0.004, DIM.len - 0.01, 64, 1, true]} />
        {mat(LAM_EDGE, 0.4, 0.7, { side: THREE.BackSide })}
      </mesh>
    </group>
  )
}

/** A distributed winding: the conductors in the slots (copper) and the end turns at both ends (coloured by phase). */
export function Winding({ layout, r0 = DIM.rSlotMid, phaseLift, h0 = 0.08, dh = 0.03, tubeR = 0.026, len = DIM.len, slotW = 0.06, slotH = 0.17, phases, colors = PHASE_COLOR, bulge = 0.05 }: { layout: Layout; r0?: number; phaseLift: Partial<Record<Phase, number>>; h0?: number; dh?: number; tubeR?: number; len?: number; slotW?: number; slotH?: number; phases?: Phase[]; colors?: Record<Phase, string>; bulge?: number }) {
  const shown = (p: Phase) => !phases || phases.includes(p)
  const ends = useMemo(
    () =>
      layout.coils.filter((c) => shown(c.phase)).flatMap((c, k) =>
        ([1, -1] as const).map((dir) => {
          const lift = phaseLift[c.phase] ?? 0
          return { key: `${k}${dir}`, phase: c.phase, geo: tube(endTurn(c.from, c.span, r0, (dir * len) / 2, dir, h0 + lift + c.rank * dh, bulge + lift * 0.6), tubeR, 28, 6) }
        }),
      ),
    [layout, r0, h0, dh, tubeR, len, bulge, phases?.join()], // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (
    <group>
      {layout.slots.filter((s) => shown(s.phase)).map((s, k) => (
        <mesh key={k} position={[r0 * Math.cos(s.angle), r0 * Math.sin(s.angle), 0]} rotation={[0, 0, s.angle]}>
          <boxGeometry args={[slotH, slotW, len + 0.06]} />
          {mat(COPPER, 0.7, 0.35)}
        </mesh>
      ))}
      {ends.map((e) => (
        <mesh key={e.key} geometry={e.geo}>
          {mat(colors[e.phase], 0.35, 0.45)}
        </mesh>
      ))}
    </group>
  )
}

/** Cast frame with longitudinal cooling fins and feet; length from zBack to zFront. */
export function Frame({ zBack = -0.95, zFront = 0.95, finSkip = [Math.PI / 2] }: { zBack?: number; zFront?: number; finSkip?: number[] }) {
  const len = zFront - zBack
  const zc = (zFront + zBack) / 2
  const fins = useMemo(() => {
    const n = 28
    return Array.from({ length: n }, (_, k) => (k * 2 * Math.PI) / n + Math.PI / n).filter((a) => finSkip.every((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) > 0.32) && !(a > Math.PI * 1.3 && a < Math.PI * 1.7))
  }, [finSkip])
  return (
    <group position={[0, 0, zc]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[DIM.frameOut, DIM.frameOut, len, 72, 1, true]} />
        {mat(FRAME, 0.35, 0.55, { side: THREE.DoubleSide })}
      </mesh>
      {fins.map((a) => (
        <mesh key={a} position={[((DIM.frameOut + DIM.finOut) / 2) * Math.cos(a), ((DIM.frameOut + DIM.finOut) / 2) * Math.sin(a), 0]} rotation={[0, 0, a]}>
          <boxGeometry args={[DIM.finOut - DIM.frameOut + 0.02, 0.035, len - 0.04]} />
          {mat(FRAME, 0.35, 0.55)}
        </mesh>
      ))}
      {/* feet */}
      {[-0.72, 0.72].map((x) => (
        <group key={x}>
          <mesh position={[x, -1.12, 0]}>
            <boxGeometry args={[0.16, 0.26, len * 0.7]} />
            {mat(FRAME, 0.35, 0.55)}
          </mesh>
          <mesh position={[x * 1.12, -1.27, 0]}>
            <boxGeometry args={[0.42, 0.06, len * 0.7]} />
            {mat(FRAME, 0.35, 0.55)}
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Terminal box on top of the frame (the supply connections). */
export function TerminalBox({ z = 0.15, labels }: { z?: number; labels?: string[] }) {
  return (
    <group position={[0, DIM.frameOut + 0.16, z]}>
      <mesh>
        <boxGeometry args={[0.62, 0.32, 0.62]} />
        {mat(FRAME, 0.35, 0.55)}
      </mesh>
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[0.68, 0.06, 0.68]} />
        {mat('#5d7893', 0.35, 0.5)}
      </mesh>
      <mesh position={[0.36, 0, 0.1]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.12, 16]} />
        {mat('#2a2f36', 0.2, 0.8)}
      </mesh>
      {labels && labels.length > 0 && <Marker at={[0, 0.34, 0]} text={labels.join(' ')} tone="neutral" />}
    </group>
  )
}

/** An end shield (bearing housing) at z, with ribs and the bearing hub; `outward` = which way it faces. */
export function EndShield({ z, outward }: { z: number; outward: 1 | -1 }) {
  return (
    <group position={[0, 0, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[DIM.frameOut + 0.02, DIM.frameOut + 0.02, 0.1, 72]} />
        {mat('#5f7a95', 0.35, 0.5)}
      </mesh>
      <mesh position={[0, 0, outward * 0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.36, 0.16, 40]} />
        {mat('#5f7a95', 0.35, 0.5)}
      </mesh>
      {Array.from({ length: 6 }, (_, k) => {
        const a = (k * Math.PI) / 3 + Math.PI / 6
        return (
          <mesh key={k} position={[0.66 * Math.cos(a), 0.66 * Math.sin(a), outward * 0.07]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.66, 0.05, 0.06]} />
            {mat('#5f7a95', 0.35, 0.5)}
          </mesh>
        )
      })}
    </group>
  )
}

/** Ball bearings at the given z positions (stationary drawing). */
export function Bearings({ at }: { at: number[] }) {
  return (
    <group>
      {at.map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh>
            <torusGeometry args={[0.185, 0.05, 12, 32]} />
            {mat('#b9c2cf', 0.9, 0.25)}
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.245, 0.245, 0.09, 32, 1, true]} />
            {mat('#8e98a6', 0.8, 0.3, { side: THREE.DoubleSide })}
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** The shaft with a key at the drive end. */
export function Shaft({ zBack, zFront }: { zBack: number; zFront: number }) {
  return (
    <group>
      <mesh position={[0, 0, (zBack + zFront) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[DIM.rShaft, DIM.rShaft, zFront - zBack, 28]} />
        {mat('#c3cad4', 0.85, 0.25)}
      </mesh>
      <mesh position={[0, DIM.rShaft, zFront - 0.3]}>
        <boxGeometry args={[0.06, 0.05, 0.4]} />
        {mat('#7c8693', 0.8, 0.3)}
      </mesh>
    </group>
  )
}

/** Laminated rotor core: a stack of laminations, each turned a little further — this is how the skew is made. */
export function RotorCore({ n, skew, stack = 12, slot }: { n: number; skew: number; stack?: number; slot?: { rSlot: number; slotR: number; offset?: number } }) {
  const gap = 0.008
  const t = DIM.len / stack
  const g = useMemo(() => rotorLamination(n, t - gap, slot), [n, t, slot])
  return (
    <group>
      {Array.from({ length: stack }, (_, i) => {
        const z0 = -DIM.len / 2 + i * t + gap / 2
        const zm = z0 + (t - gap) / 2
        return (
          <mesh key={i} geometry={g} position={[0, 0, z0]} rotation={[0, 0, (skew * zm) / DIM.len]}>
            {mat(STEEL, 0.65, 0.4)}
          </mesh>
        )
      })}
    </group>
  )
}

/** Skewed cage bars: straight helices from −len/2 to +len/2, turned by `skew` [rad] over the length. */
export function CageBars({ n, skew, r = 0.505, barR = 0.036, extra = 0.06 }: { n: number; skew: number; r?: number; barR?: number; extra?: number }) {
  const geos = useMemo(() => {
    const half = DIM.len / 2 + extra
    return Array.from({ length: n }, (_, k) => {
      const a = (k * 2 * Math.PI) / n
      const pts: Vec3[] = Array.from({ length: 7 }, (_, j) => {
        const z = -half + (2 * half * j) / 6
        const aa = a + (skew * z) / DIM.len
        return [r * Math.cos(aa), r * Math.sin(aa), z]
      })
      return tube(pts, barR, 12, 8)
    })
  }, [n, skew, r, barR, extra])
  return (
    <group>
      {geos.map((g, k) => (
        <mesh key={k} geometry={g}>
          {mat(ALU, 0.75, 0.3)}
        </mesh>
      ))}
    </group>
  )
}

/** An end ring (short-circuit ring) at z: an aluminium annulus joining all the bars. */
export function EndRing({ z }: { z: number }) {
  const g = useMemo(() => annulus(0.43, DIM.rRotor - 0.005, 0.09), [])
  return (
    <mesh geometry={g} position={[0, 0, z]}>
      {mat(ALU, 0.75, 0.3)}
    </mesh>
  )
}

/** Cooling fan on the shaft (non-drive end). */
export function Fan({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.16, 24]} />
        {mat('#3b4048', 0.2, 0.7)}
      </mesh>
      {Array.from({ length: 9 }, (_, k) => {
        const a = (k * 2 * Math.PI) / 9
        return (
          <mesh key={k} position={[0.5 * Math.cos(a), 0.5 * Math.sin(a), 0]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.6, 0.03, 0.2]} />
            {mat('#3b4048', 0.2, 0.7)}
          </mesh>
        )
      })}
    </group>
  )
}

/** Fan cover (cowl) with an end grille, from z0 back to z1. */
export function FanCover({ z0, z1 }: { z0: number; z1: number }) {
  return (
    <group>
      <mesh position={[0, 0, (z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.98, 0.98, Math.abs(z1 - z0), 64, 1, true]} />
        {mat('#6a8299', 0.4, 0.5, { side: THREE.DoubleSide })}
      </mesh>
      {[0.3, 0.55, 0.8, 0.97].map((r) => (
        <mesh key={r} position={[0, 0, z1]}>
          <torusGeometry args={[r, 0.022, 8, 48]} />
          {mat('#6a8299', 0.4, 0.5)}
        </mesh>
      ))}
      {Array.from({ length: 8 }, (_, k) => {
        const a = (k * Math.PI) / 4
        return (
          <mesh key={k} position={[0.5 * Math.cos(a), 0.5 * Math.sin(a), z1]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.98, 0.035, 0.03]} />
            {mat('#6a8299', 0.4, 0.5)}
          </mesh>
        )
      })}
    </group>
  )
}

/** The air gap, drawn as a cyan ring on the front face of the cores (between rotor and stator bore). */
export function AirGapRing() {
  const g = useMemo(() => annulus(DIM.rRotor + 0.003, DIM.rBore - 0.003, 0.02, 0, Math.PI * 2, 64), [])
  return (
    <group>
      {[1, -1].map((s) => (
        <mesh key={s} geometry={g} position={[0, 0, s * (DIM.len / 2 + 0.01)]}>
          <meshStandardMaterial color="#5fd0e0" emissive="#1d6f7a" emissiveIntensity={0.6} metalness={0.1} roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// ── animation helpers ────────────────────────────────────────────────────────────────────────────────
/** Rotates its children by the animation angle × ratio — like <Spin>, but the ratio can follow the calculation. */
export function Turn({ ratio, children }: { ratio: number; children: ReactNode }) {
  const v = useViewer()
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (g.current) g.current.rotation.z = v.anim.current.angle * ratio
  })
  return <group ref={g}>{children}</group>
}

/** The field angle (mechanical, rad) is the animation angle: the field turns at the (scaled) synchronous speed. */
export const useAnim = () => useViewer().anim

// ── conceptual layers ────────────────────────────────────────────────────────────────────────────────
export const ZF = DIM.len / 2 + 0.16 // the plane in front of the cores where the cross-section diagram is drawn

/**
 * Current in each stator slot: a cone along the slot (out of the drive end = ⊙ positive, into it = ⊗ negative),
 * length ∝ the instantaneous phase current, colour = phase. Drawn just in front of the slots (inner edge, so the
 * end turns do not hide them).
 */
export function SlotCurrents({ layout, pp, auxOn = true }: { layout: Layout; pp: number; auxOn?: boolean }) {
  const anim = useAnim()
  const refs = useRef<Array<THREE.Group | null>>([])
  useFrame(() => {
    const te = pp * anim.current.angle
    layout.slots.forEach((s, k) => {
      const g = refs.current[k]
      if (!g) return
      const i = s.sign * phaseCurrent(s.phase, te, auxOn)
      const m = Math.abs(i)
      g.visible = m > 0.04
      g.scale.set(1, Math.max(0.05, m), 1)
      g.rotation.x = i >= 0 ? Math.PI / 2 : -Math.PI / 2
    })
  })
  const r = DIM.rBore + 0.045
  return (
    <group>
      {layout.slots.map((s, k) => (
        <group key={k} position={[r * Math.cos(s.angle), r * Math.sin(s.angle), DIM.len / 2 + 0.17]}>
          <group ref={(el) => void (refs.current[k] = el)}>
            <mesh userData={{ noHighlight: true }}>
              <coneGeometry args={[0.03, 0.26, 10]} />
              <meshBasicMaterial color={PHASE_COLOR[s.phase]} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

/**
 * The rotating (or pulsating) air-gap field, drawn on the front plane: radial arrows across the air gap at each
 * pole (into the rotor at a stator N pole, out of it at an S pole) and flux lines through the rotor from N to S.
 * Drawn for the field axis at angle 0: put it inside a <Turn ratio={1}> to make it turn at the field speed.
 */
export function FieldPattern({ pp, color = LAYER_COLOR.field, labels = true, z = ZF, faint = false, lines: showLines = true, arrowLen = 0.32 }: { pp: number; color?: string; labels?: boolean; z?: number; faint?: boolean; lines?: boolean; arrowLen?: number }) {
  // stator N poles (flux into the rotor) at π/(2p) + k·2π/p, S poles at −π/(2p) + k·2π/p
  const poles = Array.from({ length: 2 * pp }, (_, k) => ({ a: Math.PI / (2 * pp) + (k * Math.PI) / pp, north: k % 2 === 0 }))
  const lines = useMemo(() => {
    const out: Vec3[][] = []
    for (const p of poles.filter((x) => x.north))
      for (const dir of [1, -1])
        for (const d of pp === 1 ? [0.25, 0.5, 0.72] : [0.3, 0.6]) {
          const span = (dir * Math.PI) / pp
          out.push(
            Array.from({ length: 25 }, (_, i) => {
              const t = i / 24
              const a = p.a + span * t
              const r = 0.66 * (1 - d * Math.sin(Math.PI * t))
              return [r * Math.cos(a), r * Math.sin(a), z] as Vec3
            }),
          )
        }
    return out
  }, [pp, z]) // eslint-disable-line react-hooks/exhaustive-deps
  const w = faint ? 1.4 : 2.2
  return (
    <group>
      {showLines &&
        lines.map((pts, k) => (
          <FlowLine key={k} points={pts} color={color} rate={1} width={w} />
        ))}
      {poles.map((p) => {
        const u: Vec3 = [Math.cos(p.a), Math.sin(p.a), 0]
        const r0 = p.north ? 0.6 + arrowLen / 2 : 0.6 - arrowLen / 2
        return <Arrow key={p.a} from={[r0 * u[0], r0 * u[1], z]} dir={p.north ? [-u[0], -u[1], 0] : u} length={arrowLen} color={color} radius={faint ? 0.012 : 0.02} head={0.1} />
      })}
      {labels &&
        poles.map((p) => <Marker key={`m${p.a}`} at={[0.9 * Math.cos(p.a), 0.9 * Math.sin(p.a), z]} text={p.north ? 'N' : 'S'} tone={p.north ? 'north' : 'south'} />)}
    </group>
  )
}

/**
 * A pulsating field on a fixed axis (single winding): radial arrows across the air gap at the pole centres whose
 * length follows cos θe and whose direction reverses with it (into the rotor at a momentary N pole).
 */
export function PulsatingPoles({ pp, z = ZF, color = LAYER_COLOR.field }: { pp: number; z?: number; color?: string }) {
  const anim = useAnim()
  const refs = useRef<Array<THREE.Group | null>>([])
  const poles = Array.from({ length: 2 * pp }, (_, k) => ({ a: Math.PI / (2 * pp) + (k * Math.PI) / pp, north: k % 2 === 0 }))
  useFrame(() => {
    const amp = Math.cos(pp * anim.current.angle)
    poles.forEach((p, k) => {
      const g = refs.current[k]
      if (!g) return
      const m = Math.abs(amp)
      g.visible = m > 0.05
      g.scale.setScalar(Math.max(0.05, m))
      // inward (−x local) when this pole is momentarily N
      const inward = p.north === amp >= 0
      g.rotation.z = inward ? 0 : Math.PI
    })
  })
  return (
    <group>
      {poles.map((p, k) => (
        <group key={p.a} position={[0.6 * Math.cos(p.a), 0.6 * Math.sin(p.a), z]} rotation={[0, 0, p.a]}>
          <group ref={(el) => void (refs.current[k] = el)}>
            <Arrow from={[0.2, 0, 0]} dir={[-1, 0, 0]} length={0.4} color={color} radius={0.024} head={0.11} />
          </group>
        </group>
      ))}
      <Marker at={[0.95 * Math.cos(poles[0].a), 0.95 * Math.sin(poles[0].a), z]} text="main axis" tone="field" />
    </group>
  )
}

/**
 * Induced current in the rotor conductors at angles `angles` (rotor frame), drawn as cones along the bars on
 * the front: i ∝ −sin(p·θ − θe + φ2) in the stator frame (θ = bar angle + rotor angle): ⊗ under a stator N pole,
 * ⊙ under an S pole, lagging the flux by the rotor power-factor angle φ2. Put inside the rotor's <Turn>.
 */
export function BarCurrents({ angles, pp, rotorRatio, phi2, r = 0.505, z = DIM.len / 2 + 0.1, color = LAYER_COLOR.emf }: { angles: number[]; pp: number; rotorRatio: number; phi2: number; r?: number; z?: number; color?: string }) {
  const anim = useAnim()
  const refs = useRef<Array<THREE.Group | null>>([])
  useFrame(() => {
    const th = anim.current.angle
    const te = pp * th
    const rot = th * rotorRatio
    angles.forEach((a, k) => {
      const g = refs.current[k]
      if (!g) return
      const i = barCurrent(a + rot, te, pp, phi2)
      g.visible = Math.abs(i) > 0.08
      g.scale.set(1, Math.max(0.05, Math.abs(i)), 1)
      g.rotation.x = i >= 0 ? Math.PI / 2 : -Math.PI / 2
    })
  })
  return (
    <group>
      {angles.map((a, k) => (
        <group key={k} position={[r * Math.cos(a), r * Math.sin(a), z + 0.12]}>
          <group ref={(el) => void (refs.current[k] = el)}>
            <mesh userData={{ noHighlight: true }}>
              <coneGeometry args={[0.028, 0.24, 10]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

/** Tangential force arrows on the rotor conductors under each pole (counter-clockwise: the field's direction). Inside the field's <Turn>. */
export function PoleForces({ pp, phi2 = 0, z = ZF + 0.02 }: { pp: number; phi2?: number; z?: number }) {
  const at = Array.from({ length: 2 * pp }, (_, k) => Math.PI / (2 * pp) + (k * Math.PI) / pp - phi2 / pp)
  return (
    <group>
      {at.map((a) => {
        const r = 0.5
        return <Arrow key={a} from={[r * Math.cos(a), r * Math.sin(a), z]} dir={[-Math.sin(a), Math.cos(a), 0]} length={0.32} color={LAYER_COLOR.torque} radius={0.022} head={0.1} />
      })}
      <Marker at={[0.62 * Math.cos(at[0] + 0.5), 0.62 * Math.sin(at[0] + 0.5), z]} text="F" tone="torque" />
    </group>
  )
}

/** The torque on the rotor: a curved arrow outside the frame on the left, counter-clockwise (the field's direction). */
export function TorqueArrow({ z = DIM.len / 2 + 0.25, label = 'T' }: { z?: number; label?: string }) {
  return (
    <group>
      <CurvedArrow radius={1.36} start={Math.PI * 0.68} sweep={Math.PI * 0.55} z={z} color={LAYER_COLOR.torque} tube={0.026} />
      <Marker at={[-1.6, 0.1, z]} text={label} tone="torque" />
    </group>
  )
}

/** Rotation arrows: rotor (white) and field (blue, outside), both counter-clockwise. */
export function RotationArrows({ z, rotorLabel = 'Nr', fieldLabel = 'Ns' }: { z: number; rotorLabel?: string; fieldLabel?: string }) {
  return (
    <group>
      <CurvedArrow radius={0.3} start={Math.PI * 0.15} sweep={Math.PI * 1.3} z={z} color={LAYER_COLOR.rotation} tube={0.02} />
      <Marker at={[-0.36, -0.3, z]} text={rotorLabel} tone="neutral" />
      <CurvedArrow radius={1.42} start={Math.PI * 0.05} sweep={Math.PI * 0.55} z={DIM.len / 2 + 0.2} color={LAYER_COLOR.field} tube={0.02} />
      <Marker at={[1.2, 1.05, DIM.len / 2 + 0.2]} text={fieldLabel} tone="field" />
    </group>
  )
}

/**
 * Energy flow: a main path (terminals → winding → across the air gap → rotor → shaft) and loss branches leaving
 * it as heat, each with a label (values from the calculation).
 */
export function EnergyFlow({ main, branches, labels }: { main: Vec3[]; branches: Vec3[][]; labels: Array<{ at: Vec3; text: string }> }) {
  return (
    <group>
      <FlowLine points={main} color={LAYER_COLOR.energy} rate={1} width={4} />
      {branches.map((b, k) => (
        <FlowLine key={k} points={b} color={LAYER_COLOR.energy} rate={1} width={2} dash={0.07} gap={0.07} />
      ))}
      {labels.map((it) => (
        <Marker key={it.text} at={it.at} text={it.text} tone="energy" />
      ))}
    </group>
  )
}

/**
 * A small oscilloscope card in the scene: the phase currents over one electrical period and a cursor at the
 * present instant (moves with the animation). Conceptual: per-unit sine waves, not a measurement.
 */
export function PhaseScope({ at, phases, pp, auxOn = true, title }: { at: Vec3; phases: Phase[]; pp: number; auxOn?: boolean; title: string }) {
  const anim = useAnim()
  const cursor = useRef<SVGLineElement>(null)
  const W = 150
  const H = 64
  useFrame(() => {
    const te = (((pp * anim.current.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const x = (te / (2 * Math.PI)) * W
    if (cursor.current) {
      cursor.current.setAttribute('x1', String(x))
      cursor.current.setAttribute('x2', String(x))
    }
  })
  const path = (p: Phase) =>
    Array.from({ length: 61 }, (_, i) => {
      const te = (i / 60) * 2 * Math.PI
      return `${i === 0 ? 'M' : 'L'}${((i / 60) * W).toFixed(1)},${(H / 2 - phaseCurrent(p, te, auxOn) * (H / 2 - 6)).toFixed(1)}`
    }).join(' ')
  return (
    <Html position={at} center zIndexRange={[14, 0]} style={{ pointerEvents: 'none' }}>
      <div className="imx-scope">
        <div className="imx-scope-t">{title}</div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#3a4554" />
          {phases.map((p) => (
            <path key={p} d={path(p)} fill="none" stroke={PHASE_COLOR[p]} strokeWidth={2} />
          ))}
          <line ref={cursor} x1={0} x2={0} y1={2} y2={H - 2} stroke="#e8ecf2" strokeWidth={1.5} />
        </svg>
        <div className="imx-scope-k">
          {phases.map((p) => (
            <span key={p} style={{ color: PHASE_COLOR[p] }}>
              i{PHASE_NAME[p]}
            </span>
          ))}
        </div>
      </div>
    </Html>
  )
}

/** Points of a ring (for leads, rings). */
export const ring = (r: number, z: number, n = 48) => arc(r, 0, Math.PI * 2, z, n)
