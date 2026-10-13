import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ModelState } from '../../types.ts'
import { useViewer } from '../../viewer/context.tsx'
import { Part } from '../../viewer/Part.tsx'
import { arc, Arrow, CurvedArrow, FlowLine, LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'

/*
 * Brushed PM DC motor — original procedural geometry (simplified educational model). Shaft = z axis, front (+z) =
 * commutator end. N magnet on +x, S on −x: B crosses the armature towards −x. With current out of the screen (+z)
 * under the N pole, F = I·L × B points −y there and +y under the S pole: the armature turns clockwise seen from the
 * front — the layers below follow exactly that geometry.
 */
const STEEL = '#9aa4b2'
const DARK_STEEL = '#5d6878'
const COPPER = '#c27a3c'
const CARBON = '#2a2d33'
const LEN = 1.6 // armature length
const SLOTS = 8

/** An annular sector (magnet, commutator segment) extruded along z and centred on z = 0. */
function arcShell(rIn: number, rOut: number, a0: number, a1: number, len: number) {
  const s = new THREE.Shape()
  s.absarc(0, 0, rOut, a0, a1, false)
  s.absarc(0, 0, rIn, a1, a0, true)
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 24 })
  g.translate(0, 0, -len / 2)
  return g
}

/** The slotted lamination profile, extruded: teeth between SLOTS open slots, a hole for the shaft. */
function armatureGeometry() {
  const r = 0.72
  const rSlot = 0.48
  const half = (Math.PI / SLOTS) * 0.42 // half slot width (angle)
  const s = new THREE.Shape()
  for (let k = 0; k < SLOTS; k++) {
    const c = (k * 2 * Math.PI) / SLOTS
    const a = c - half
    const b = c + half
    if (k === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a))
    else s.lineTo(r * Math.cos(a), r * Math.sin(a))
    s.lineTo(rSlot * Math.cos(a), rSlot * Math.sin(a))
    s.lineTo(rSlot * Math.cos(b), rSlot * Math.sin(b))
    s.lineTo(r * Math.cos(b), r * Math.sin(b))
    const next = ((k + 1) * 2 * Math.PI) / SLOTS - half
    s.absarc(0, 0, r, b, next, false)
  }
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true)
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth: LEN, bevelEnabled: false, curveSegments: 6 })
  g.translate(0, 0, -LEN / 2)
  return g
}

export function DcMotorModel({ state }: { state: ModelState }) {
  const geo = useMemo(
    () => ({
      armature: armatureGeometry(),
      magN: arcShell(0.8, 1.1, -Math.PI / 3, Math.PI / 3, 1.5),
      magS: arcShell(0.8, 1.1, (2 * Math.PI) / 3, (4 * Math.PI) / 3, 1.5),
      segs: Array.from({ length: SLOTS }, (_, k) => arcShell(0.2, 0.3, (k * 2 * Math.PI) / SLOTS + 0.05, ((k + 1) * 2 * Math.PI) / SLOTS - 0.05, 0.42)),
    }),
    [],
  )
  const L = state.layers
  const slotAngle = (k: number) => (k * 2 * Math.PI) / SLOTS
  return (
    <group>
      {/* ── stator ── */}
      <Part id="housing">
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.25, 1.25, 2.1, 64, 1, true]} />
          <meshStandardMaterial color={DARK_STEEL} metalness={0.6} roughness={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.12, 1.12, 2.1, 64, 1, true]} />
          <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} side={THREE.BackSide} />
        </mesh>
      </Part>
      <Part id="magnet-n">
        <mesh geometry={geo.magN}>
          <meshStandardMaterial color="#b4463f" metalness={0.2} roughness={0.6} />
        </mesh>
      </Part>
      <Part id="magnet-s">
        <mesh geometry={geo.magS}>
          <meshStandardMaterial color="#3e64a8" metalness={0.2} roughness={0.6} />
        </mesh>
      </Part>
      <Part id="end-cap-rear">
        <mesh position={[0, 0, -1.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.25, 1.25, 0.1, 64]} />
          <meshStandardMaterial color={DARK_STEEL} metalness={0.6} roughness={0.45} />
        </mesh>
      </Part>
      <Part id="end-cap-front">
        <mesh position={[0, 0, 1.3]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.25, 1.25, 0.5, 64, 1, true]} />
          <meshStandardMaterial color="#6b7686" metalness={0.45} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 1.6]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.25, 1.25, 0.08, 64]} />
          <meshStandardMaterial color="#6b7686" metalness={0.45} roughness={0.5} />
        </mesh>
      </Part>
      {/* supply terminals: + on top (wired to the + brush), − below */}
      <Part id="terminals">
        {[0.55, -0.55].map((y) => (
          <mesh key={y} position={[0.75, y, 1.72]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.2, 16]} />
            <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      </Part>
      <Part id="bearing-rear">
        <mesh position={[0, 0, -1.12]}>
          <torusGeometry args={[0.2, 0.06, 12, 32]} />
          <meshStandardMaterial color="#b9c2cf" metalness={0.9} roughness={0.25} />
        </mesh>
      </Part>
      <Part id="bearing-front">
        <mesh position={[0, 0, 1.6]}>
          <torusGeometry args={[0.2, 0.06, 12, 32]} />
          <meshStandardMaterial color="#b9c2cf" metalness={0.9} roughness={0.25} />
        </mesh>
      </Part>
      {/* brushes: carbon blocks pressed on the commutator, + at the top, − at the bottom */}
      {([['brush-pos', 1], ['brush-neg', -1]] as const).map(([id, s]) => (
        <Part key={id} id={id}>
          <mesh position={[0, s * 0.42, 1.18]}>
            <boxGeometry args={[0.16, 0.24, 0.2]} />
            <meshStandardMaterial color={CARBON} roughness={0.9} />
          </mesh>
        </Part>
      ))}
      <Part id="brush-holders">
        {[1, -1].map((s) => (
          <mesh key={s} position={[0, s * 0.62, 1.18]}>
            <boxGeometry args={[0.24, 0.18, 0.26]} />
            <meshStandardMaterial color="#a8823a" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
      </Part>

      {/* ── rotor: turns with the animation clock (clockwise seen from the front) ── */}
      <Spin axis="z">
        <Part id="shaft">
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 3.9, 24]} />
            <meshStandardMaterial color="#c3cad4" metalness={0.85} roughness={0.25} />
          </mesh>
          {/* a key on the shaft makes the rotation visible */}
          <mesh position={[0, 0.1, -1.75]}>
            <boxGeometry args={[0.06, 0.05, 0.3]} />
            <meshStandardMaterial color="#8a939f" metalness={0.8} roughness={0.3} />
          </mesh>
        </Part>
        <Part id="armature-core">
          <mesh geometry={geo.armature}>
            <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.38} />
          </mesh>
          {/* lamination lines */}
          {Array.from({ length: 15 }, (_, i) => (
            <mesh key={i} position={[0, 0, -LEN / 2 + ((i + 1) * LEN) / 16]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.723, 0.723, 0.006, 48, 1, true]} />
              <meshStandardMaterial color="#454d59" metalness={0.5} roughness={0.6} />
            </mesh>
          ))}
        </Part>
        <Part id="armature-winding">
          {Array.from({ length: SLOTS }, (_, k) => (
            <mesh key={k} position={[0.6 * Math.cos(slotAngle(k)), 0.6 * Math.sin(slotAngle(k)), 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.075, 0.075, LEN + 0.12, 12]} />
              <meshStandardMaterial color={COPPER} metalness={0.7} roughness={0.35} />
            </mesh>
          ))}
          {/* end turns: each full-pitch coil joins slot k to slot k + 4 at both ends */}
          {Array.from({ length: SLOTS / 2 }, (_, k) =>
            [1, -1].map((side) => (
              <mesh key={`${k}${side}`} position={[0, 0, side * (LEN / 2 + 0.07 + k * 0.035)]} rotation={[0, 0, slotAngle(k)]}>
                <torusGeometry args={[0.6, 0.045, 8, 40, Math.PI]} />
                <meshStandardMaterial color={COPPER} metalness={0.7} roughness={0.35} />
              </mesh>
            )),
          )}
        </Part>
        <Part id="commutator">
          <group position={[0, 0, 1.18]}>
            {geo.segs.map((g, k) => (
              <mesh key={k} geometry={g}>
                <meshStandardMaterial color="#d08a45" metalness={0.85} roughness={0.25} />
              </mesh>
            ))}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.42, 24]} />
              <meshStandardMaterial color="#1b1f26" roughness={0.9} />
            </mesh>
          </group>
        </Part>
        {L.has('commutation') && <SegmentsUnderBrushes />}
      </Spin>

      {/* ── conceptual layers ── */}
      {L.has('field') && (
        <group>
          {[-0.42, -0.21, 0, 0.21, 0.42].map((y) => (
            <FlowLine key={y} points={[[0.86, y, 0.9], [-0.86, y, 0.9]]} color={LAYER_COLOR.field} rate={1} />
          ))}
          <FlowLine points={arc(1.18, Math.PI, 0, 0.9)} color={LAYER_COLOR.field} rate={1} width={2} />
          <FlowLine points={arc(1.18, -Math.PI, 0, 0.9)} color={LAYER_COLOR.field} rate={1} width={2} />
          <Marker at={[1.0, 0, 0.95]} text="N" tone="north" />
          <Marker at={[-1.0, 0, 0.95]} text="S" tone="south" />
        </group>
      )}
      {L.has('current') && (
        <group>
          {[-0.6, 0, 0.6].map((a) => (
            <Marker key={`r${a}`} at={[0.6 * Math.cos(a), 0.6 * Math.sin(a), 0.98]} text="⊙" tone="current" />
          ))}
          {[Math.PI - 0.6, Math.PI, Math.PI + 0.6].map((a) => (
            <Marker key={`l${a}`} at={[0.6 * Math.cos(a), 0.6 * Math.sin(a), 0.98]} text="⊗" tone="current" />
          ))}
          <FlowLine points={[[0.75, 0.55, 1.85], [0.4, 0.75, 1.5], [0, 0.55, 1.3]]} color={LAYER_COLOR.current} rate={1} />
          <FlowLine points={[[0, -0.55, 1.3], [0.4, -0.75, 1.5], [0.75, -0.55, 1.85]]} color={LAYER_COLOR.current} rate={1} />
          <Marker at={[0.92, 0.6, 1.85]} text="+" tone="current" />
          <Marker at={[0.92, -0.6, 1.85]} text="−" tone="current" />
        </group>
      )}
      {L.has('torque') && (
        <group>
          <Arrow from={[0.6, 0.15, 0.95]} dir={[0, -1, 0]} length={0.5} color={LAYER_COLOR.torque} />
          <Arrow from={[-0.6, -0.15, 0.95]} dir={[0, 1, 0]} length={0.5} color={LAYER_COLOR.torque} />
          <Marker at={[0.75, -0.42, 1.0]} text="F" tone="torque" />
          <Marker at={[-0.75, 0.42, 1.0]} text="F" tone="torque" />
          <CurvedArrow radius={1.45} start={Math.PI * 0.6} sweep={-Math.PI * 0.55} z={0.9} color={LAYER_COLOR.torque} />
          <Marker at={[0.4, 1.55, 0.9]} text="T" tone="torque" />
        </group>
      )}
      {L.has('commutation') && (
        <group>
          {/* the neutral zone, midway between the poles: the coil sides passing here are being commutated */}
          <Marker at={[0, 0.6, 0.98]} text="⇄" tone="current" />
          <Marker at={[0, -0.6, 0.98]} text="⇄" tone="current" />
        </group>
      )}
      {L.has('rotation') && <CurvedArrow radius={0.42} start={Math.PI * 0.9} sweep={-Math.PI * 1.4} z={1.95} color={LAYER_COLOR.rotation} tube={0.022} />}
      {L.has('emf') && (
        <group>
          <Marker at={[0.95, 0.3, 1.0]} text="E ⊗" tone="emf" />
          <Marker at={[-0.95, -0.3, 1.0]} text="E ⊙" tone="emf" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <FlowLine points={[[0.75, 0.55, 1.95], [0.3, 0.3, 1.2], [0, 0, 0.5], [0, 0, -1.9], [0, 0, -2.5]]} color={LAYER_COLOR.energy} rate={1} width={3.5} />
          <Marker at={[1.0, 0.85, 1.95]} text="Pin = V·Ia" tone="energy" />
          <Marker at={[0, -0.32, -2.45]} text="Pout = T·ω" tone="energy" />
          <Marker at={[-0.85, 0.85, 0]} text="heat: Ia²·Ra" tone="energy" />
        </group>
      )}
    </group>
  )
}

/**
 * The commutator segments touching a brush (+ at the top, − at the bottom), shown with a green glow. It turns with
 * the rotor and is worked out from the rotor angle each frame: segment k covers the rotor angles k·45° … (k+1)·45°.
 */
function SegmentsUnderBrushes() {
  const v = useViewer()
  const geos = useMemo(() => Array.from({ length: SLOTS }, (_, k) => arcShell(0.3, 0.322, (k * 2 * Math.PI) / SLOTS + 0.05, ((k + 1) * 2 * Math.PI) / SLOTS - 0.05, 0.44)), [])
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  const meshes = useRef<Array<THREE.Mesh | null>>([])
  useFrame(() => {
    const w = 2 * Math.PI / SLOTS
    const under = (brush: number) => Math.floor((((brush - v.anim.current.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / w) % SLOTS
    const on = new Set([under(Math.PI / 2), under(-Math.PI / 2)])
    meshes.current.forEach((m, k) => m && (m.visible = on.has(k)))
  })
  return (
    <group position={[0, 0, 1.18]}>
      {geos.map((g, k) => (
        <mesh key={k} ref={(m) => void (meshes.current[k] = m)} geometry={g} userData={{ noHighlight: true, noFit: true }}>
          <meshBasicMaterial color={LAYER_COLOR.current} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

