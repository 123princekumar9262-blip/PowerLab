import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { fullStepState, HYBRID, hybridPolePolarity } from '../../../calculations/modern.ts'
import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { useViewer } from '../../../viewer/context.tsx'
import { CurvedArrow, LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import { Bearing, Chip, deg, extrude, GlowLoop, MAT, PHASE_COLOR, polar, ring, rotorTeethShape, Shaft, squarePlateShape, statorShape, ToothCoil, toothCoilGeometry, useDiscrete } from '../shared.tsx'

/*
 * Two-phase hybrid stepper — original procedural geometry (simplified). 8 poles at k·45° (A even, B odd), 5 teeth
 * per pole face, rotor cups of 50 teeth (front N, rear S offset by 3.6°). The rotor STEPS: the animation clock is the
 * commanded pulse train; in each step period the rotor moves to the next holding position k·1.8° in the first 30 %
 * of the period, then holds. Counter-clockwise seen from the front.
 */
const STACK = 1.0
const STEP = deg(360 / (4 * HYBRID.nr)) // 1.8°
const CUP = 0.42
const smooth = (x: number) => x * x * (3 - 2 * x)
/** Step index k from the animation angle (the commanded pulse count), and the drawn rotor angle. */
const stepIndex = (angle: number) => Math.max(0, Math.floor(angle / STEP))
function rotorAngle(angle: number) {
  const s = Math.max(0, angle / STEP)
  const k = Math.floor(s)
  if (k === 0) return 0
  return (k - 1 + smooth(Math.min(1, (s - k) / 0.3))) * STEP
}

/** The rotor group: turned step by step from the animation clock. */
function StepRotor({ children }: { children: ReactNode }) {
  const v = useViewer()
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (g.current) g.current.rotation.z = rotorAngle(v.anim.current.angle)
  })
  return <group ref={g}>{children}</group>
}

function dialGeometry() {
  // 200 ticks on the flange face, longer every 5 (9°) and every 25 (45°)
  const pts: number[] = []
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2
    const r0 = 0.84
    const r1 = i % 25 === 0 ? 0.98 : i % 5 === 0 ? 0.93 : 0.88
    pts.push(r0 * Math.cos(a), r0 * Math.sin(a), 0, r1 * Math.cos(a), r1 * Math.sin(a), 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

export function StepperModel({ state }: { state: ModelState }) {
  const geo = useMemo(
    () => ({
      stator: extrude(statorShape({ rOut: 1.22, square: 0.95, rYoke: 0.78, rBore: 0.515, n: 8, w: 0.18, shoeHalf: deg(17), shoeDepth: 0.05, faceTeeth: 5, facePitch: deg(HYBRID.pitch), faceDepth: 0.035 }), STACK, 6),
      cupFront: extrude(rotorTeethShape({ rRoot: 0.468, rTip: 0.5, n: HYBRID.nr, tipHalf: deg(1.8), rHole: 0.1 }), CUP, 4),
      cupRear: extrude(rotorTeethShape({ rRoot: 0.468, rTip: 0.5, n: HYBRID.nr, tipHalf: deg(1.8), rHole: 0.1, phase: deg(HYBRID.pitch / 2) }), CUP, 4),
      magnetN: ring(0.1, 0.4, 0.07, 40),
      magnetS: ring(0.1, 0.4, 0.07, 40),
      coil: toothCoilGeometry(0.2, STACK + 0.04, 0.065, 0.58, 0.76),
      flange: extrude(squarePlateShape(0.98, 1.25, 0.26), 0.18, 32),
      cap: extrude(squarePlateShape(0.98, 1.25, 0.1), 0.2, 32),
      dial: dialGeometry(),
      leads: [0, 1, 2, 3].map((k) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.7, 0.2 + k * 0.05, -0.82), new THREE.Vector3(-0.85, 0.2 + k * 0.05, -1.0), new THREE.Vector3(-1.3, 0.25 + k * 0.05, -1.15)]), 16, 0.018, 6)),
    }),
    [],
  )
  const L = state.layers
  const k = useDiscrete((a) => stepIndex(a))
  const st = fullStepState(k)
  const phase = st[0] as 'A' | 'B'

  const coils = (ph: 'A' | 'B') =>
    [0, 1, 2, 3, 4, 5, 6, 7]
      .filter((p) => (p % 2 === 0) === (ph === 'A'))
      .map((p) => (
        <group key={p}>
          <ToothCoil geometry={geo.coil} angle={deg(p * 45)} band={{ color: ph === 'A' ? PHASE_COLOR.A : PHASE_COLOR.B, pos: [0.67, 0, (STACK + 0.04) / 2 + 0.067], size: [0.14, 0.22, 0.012] }} />
          {L.has('current') && phase === ph && <GlowLoop geometry={geo.coil} angle={deg(p * 45)} color={LAYER_COLOR.current} />}
        </group>
      ))

  return (
    <group>
      <Part id="front-flange">
        <mesh geometry={geo.flange} position={[0, 0, 0.59]}>
          <meshStandardMaterial color={MAT.alu} metalness={0.55} roughness={0.42} />
        </mesh>
        <mesh position={[0, 0, 0.71]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.06, 48, 1, true]} />
          <meshStandardMaterial color={MAT.alu} metalness={0.55} roughness={0.42} side={THREE.DoubleSide} />
        </mesh>
        {[45, 135, 225, 315].map((a) => (
          <mesh key={a} position={polar(1.08, deg(a), 0.6)} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.2, 16]} />
            <meshStandardMaterial color="#20252c" roughness={0.8} />
          </mesh>
        ))}
        <lineSegments geometry={geo.dial} position={[0, 0, 0.685]}>
          <lineBasicMaterial color="#e8ecf2" />
        </lineSegments>
      </Part>
      <Part id="rear-cap">
        <mesh geometry={geo.cap} position={[0, 0, -0.6]}>
          <meshStandardMaterial color={MAT.alu} metalness={0.55} roughness={0.42} />
        </mesh>
      </Part>
      <Part id="leads">
        {geo.leads.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshStandardMaterial color={['#d55181', '#20252c', '#c98500', '#3987e5'][i]} roughness={0.7} />
          </mesh>
        ))}
      </Part>
      <Part id="stator-core">
        <mesh geometry={geo.stator}>
          <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
        </mesh>
      </Part>
      <Part id="phase-a">{coils('A')}</Part>
      <Part id="phase-b">{coils('B')}</Part>
      <Part id="bearing-front">
        <Bearing z={0.6} rIn={0.1} rOut={0.24} w={0.1} />
      </Part>
      <Part id="bearing-rear">
        <Bearing z={-0.6} rIn={0.1} rOut={0.24} w={0.1} />
      </Part>

      {/* ── rotor: steps counter-clockwise ── */}
      <StepRotor>
        <Part id="shaft">
          <Shaft r={0.1} z0={-0.85} z1={1.5} />
          {/* step pointer reading the scale on the flange */}
          <mesh position={[0.5, 0, 0.8]}>
            <boxGeometry args={[0.85, 0.03, 0.02]} />
            <meshStandardMaterial color="#e8ecf2" emissive="#e8ecf2" emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[0, 0, 0.8]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.05, 24]} />
            <meshStandardMaterial color="#8a939f" metalness={0.8} roughness={0.3} />
          </mesh>
        </Part>
        <Part id="cup-front">
          <mesh geometry={geo.cupFront} position={[0, 0, 0.07 + CUP / 2]}>
            <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
          </mesh>
        </Part>
        <Part id="cup-rear">
          <mesh geometry={geo.cupRear} position={[0, 0, -0.07 - CUP / 2]}>
            <meshStandardMaterial color={MAT.darkSteel} metalness={0.7} roughness={0.4} />
          </mesh>
        </Part>
        <Part id="magnet">
          <mesh geometry={geo.magnetN} position={[0, 0, 0.035]}>
            <meshStandardMaterial color={MAT.magnetN} metalness={0.25} roughness={0.55} />
          </mesh>
          <mesh geometry={geo.magnetS} position={[0, 0, -0.035]}>
            <meshStandardMaterial color={MAT.magnetS} metalness={0.25} roughness={0.55} />
          </mesh>
        </Part>
      </StepRotor>

      {/* ── conceptual layers ── */}
      {L.has('field') && (
        <group>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((p) => {
            const pol = hybridPolePolarity(st, p)
            return pol ? <Marker key={p} at={polar(0.66, deg(p * 45), STACK / 2 + 0.1)} text={pol} tone={pol === 'N' ? 'north' : 'south'} /> : null
          })}
          <Marker at={[0, 0.3, 0.55]} text="N cup" tone="north" />
          <Marker at={[0, -0.3, -0.55]} text="S cup" tone="south" />
        </group>
      )}
      {(L.has('current') || L.has('field')) && (
        <Chip at={[1.55, -1.2, 0.5]}>
          step <b>{k}</b> · <span className="mxm-on">{st}</span> <span className="mxm-dim">({phase === 'A' ? 'B' : 'A'} off)</span>
          <br />
          <span className="mxm-dim">holds at {k} × 1.8° = {(k * 1.8).toFixed(1)}°</span>
        </Chip>
      )}
      {L.has('torque') && (
        <group>
          <CurvedArrow radius={1.3} start={deg(20)} sweep={deg(40)} z={0.75} color={LAYER_COLOR.torque} tube={0.025} />
          <CurvedArrow radius={1.3} start={deg(100)} sweep={deg(-40)} z={0.75} color={LAYER_COLOR.torque} tube={0.025} />
          <Marker at={polar(1.62, deg(78), 0.75)} text="restoring torque ≤ T_H" tone="torque" />
        </group>
      )}
      {L.has('rotation') && <CurvedArrow radius={0.3} start={deg(-120)} sweep={deg(250)} z={1.6} color={LAYER_COLOR.rotation} tube={0.022} />}
    </group>
  )
}
