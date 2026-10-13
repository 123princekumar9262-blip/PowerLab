import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { useViewer } from '../../../viewer/context.tsx'
import { CurvedArrow, FlowLine, LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import { arcShell, Chip, deg, extrude, MAT, polar, ring, squarePlateShape, statorShape } from '../shared.tsx'

/*
 * Servo assembly — original procedural geometry (simplified). Motor axis = z at x = MX; drive box at x ≈ 2.
 * The arm's motion is an ILLUSTRATION of a proportional position loop with an ideal speed loop: every PERIOD seconds
 * of the animation clock a new command is given and the drawn angle approaches it exponentially with time constant
 * TC (θ = θprev + (θ* − θprev)·(1 − e^(−t/TC))). It is not a simulation of a tuned drive.
 */
const MX = -0.7
const SEQ = [90, -45, 135, 0]
const PERIOD = 3.5
const TC = 0.35

function servoAt(t: number) {
  const m = Math.max(0, Math.floor(t / PERIOD))
  const cmd = SEQ[m % SEQ.length]
  const prev = m === 0 ? 0 : SEQ[(m - 1) % SEQ.length]
  const tau = t - m * PERIOD
  const theta = prev + (cmd - prev) * (1 - Math.exp(-tau / TC))
  return { cmd, theta }
}

/** The turning parts (rotor, shaft, load), about the motor axis, following the illustrated position loop. */
function ServoRotor({ children }: { children: ReactNode }) {
  const v = useViewer()
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (g.current) g.current.rotation.z = deg(servoAt(v.anim.current.time).theta)
  })
  return (
    <group position={[MX, 0, 0]}>
      <group ref={g}>{children}</group>
    </group>
  )
}

/** Command / encoder / error read-out, updated every frame without re-rendering React. */
function LoopChip({ at }: { at: Vec3 }) {
  const v = useViewer()
  const cmd = useRef<HTMLElement>(null)
  const enc = useRef<HTMLElement>(null)
  const err = useRef<HTMLElement>(null)
  useFrame(() => {
    const s = servoAt(v.anim.current.time)
    if (cmd.current) cmd.current.textContent = `${s.cmd.toFixed(0)}°`
    if (enc.current) enc.current.textContent = `${s.theta.toFixed(1)}°`
    if (err.current) err.current.textContent = `${(s.cmd - s.theta).toFixed(1)}°`
  })
  return (
    <Chip at={at}>
      <span className="mxm-on">command θ*</span> <b ref={cmd}>0°</b> · <span className="mxm-c">encoder θ</span> <b ref={enc}>0°</b>
      <br />
      <span className="mxm-dim">error θ* − θ =</span> <b ref={err}>0°</b> <span className="mxm-dim">→ torque command</span>
    </Chip>
  )
}

const tube = (pts: Vec3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 48, r, 8)
const POWER_PATH: Vec3[] = [[1.9, -0.7, 0.66], [1.6, -0.85, 1.0], [0.8, -0.5, 1.05], [0.0, 0.9, 0.6], [MX, 1.02, 0.25], [MX, 0.86, 0.2]]
const FEEDBACK_PATH: Vec3[] = [[MX, 0.62, -1.0], [MX, 1.1, -1.0], [0.5, 1.25, -0.4], [1.5, 1.0, 0.6], [1.85, 0.75, 0.66]]

function scaleGeometry() {
  const pts: number[] = []
  for (let a = -180; a < 180; a += 15) {
    const r0 = 0.62
    const r1 = a % 45 === 0 ? 0.74 : 0.69
    pts.push(r0 * Math.cos(deg(a)), r0 * Math.sin(deg(a)), 0, r1 * Math.cos(deg(a)), r1 * Math.sin(deg(a)), 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}
function encoderLines() {
  const pts: number[] = []
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2
    pts.push(0.33 * Math.cos(a), 0.33 * Math.sin(a), 0, 0.41 * Math.cos(a), 0.41 * Math.sin(a), 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

export function ServoModel({ state }: { state: ModelState }) {
  const geo = useMemo(
    () => ({
      body: extrude(squarePlateShape(0.7, 0.92, 0.6), 1.1, 32),
      flange: extrude(squarePlateShape(0.78, 1.02, 0.12), 0.12, 32),
      stator: extrude(statorShape({ rOut: 0.6, rYoke: 0.5, rBore: 0.36, n: 12, w: 0.1, shoeHalf: deg(11), shoeDepth: 0.02 }), 1.0, 8),
      rotor: ring(0.08, 0.3, 1.0, 32),
      magnets: Array.from({ length: 8 }, (_, k) => arcShell(0.3, 0.345, deg(k * 45 + 3), deg(k * 45 + 42), 1.0, 8)),
      encCover: ring(0.5, 0.55, 0.62, 40),
      scale: scaleGeometry(),
      lines: encoderLines(),
      power: tube(POWER_PATH, 0.055),
      feedback: tube(FEEDBACK_PATH, 0.04),
    }),
    [],
  )
  const L = state.layers
  const showChip = L.has('current') || state.step === 'loop'
  return (
    <group>
      {/* ── motor (fixed parts) ── */}
      <Part id="housing">
        <group position={[MX, 0, 0]}>
          <mesh geometry={geo.body} position={[0, 0, -0.05]}>
            <meshStandardMaterial color="#3a414c" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh geometry={geo.flange} position={[0, 0, 0.56]}>
            <meshStandardMaterial color={MAT.alu} metalness={0.55} roughness={0.42} />
          </mesh>
          <lineSegments geometry={geo.scale} position={[0, 0, 0.625]}>
            <lineBasicMaterial color="#e8ecf2" />
          </lineSegments>
          <mesh position={[0, 0.78, 0.2]}>
            <boxGeometry args={[0.3, 0.16, 0.3]} />
            <meshStandardMaterial color="#20252c" roughness={0.7} />
          </mesh>
        </group>
      </Part>
      <Part id="encoder-cover">
        <group position={[MX, 0, 0]}>
          <mesh geometry={geo.encCover} position={[0, 0, -0.91]}>
            <meshStandardMaterial color="#3a414c" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, -1.23]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.55, 0.55, 0.04, 40]} />
            <meshStandardMaterial color="#3a414c" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.6, -1.0]}>
            <boxGeometry args={[0.18, 0.1, 0.18]} />
            <meshStandardMaterial color="#20252c" roughness={0.7} />
          </mesh>
        </group>
      </Part>
      <Part id="stator">
        <group position={[MX, 0, 0]}>
          <mesh geometry={geo.stator}>
            <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
          </mesh>
          {Array.from({ length: 12 }, (_, k) => (
            <mesh key={k} position={polar(0.43, deg(15 + k * 30))} rotation={[0, 0, deg(15 + k * 30)]}>
              <boxGeometry args={[0.1, 0.08, 1.08]} />
              <meshStandardMaterial color={MAT.copper} metalness={0.65} roughness={0.38} />
            </mesh>
          ))}
          {[0.56, -0.56].map((z) => (
            <mesh key={z} position={[0, 0, z]}>
              <torusGeometry args={[0.43, 0.06, 10, 48]} />
              <meshStandardMaterial color={MAT.copper} metalness={0.65} roughness={0.38} />
            </mesh>
          ))}
        </group>
      </Part>
      <Part id="encoder">
        <group position={[MX, 0, -0.95]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.42, 0.42, 0.012, 48]} />
            <meshStandardMaterial color="#7fa9c9" metalness={0.2} roughness={0.15} transparent opacity={0.55} />
          </mesh>
          <lineSegments geometry={geo.lines} position={[0, 0, 0.008]}>
            <lineBasicMaterial color="#10161d" />
          </lineSegments>
          {/* read head: a U-shaped block straddling the disc edge */}
          {[0.05, -0.05].map((z) => (
            <mesh key={z} position={[0, 0.39, z]}>
              <boxGeometry args={[0.16, 0.12, 0.035]} />
              <meshStandardMaterial color={MAT.chip} roughness={0.6} />
            </mesh>
          ))}
          <mesh position={[0, 0.47, 0]}>
            <boxGeometry args={[0.16, 0.04, 0.135]} />
            <meshStandardMaterial color={MAT.pcb} roughness={0.7} />
          </mesh>
        </group>
      </Part>

      {/* ── turning parts ── */}
      <ServoRotor>
        <Part id="shaft">
          <mesh position={[0, 0, 0.27]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 2.55, 20]} />
            <meshStandardMaterial color={MAT.shaft} metalness={0.85} roughness={0.25} />
          </mesh>
        </Part>
        <Part id="rotor">
          <mesh geometry={geo.rotor}>
            <meshStandardMaterial color={MAT.darkSteel} metalness={0.7} roughness={0.4} />
          </mesh>
          {geo.magnets.map((g, k) => (
            <mesh key={k} geometry={g}>
              <meshStandardMaterial color={k % 2 === 0 ? MAT.magnetN : MAT.magnetS} metalness={0.25} roughness={0.55} />
            </mesh>
          ))}
        </Part>
        <Part id="load">
          <mesh position={[0, 0, 1.38]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 0.14, 24]} />
            <meshStandardMaterial color={MAT.aluDark} metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0.45, 0, 1.38]}>
            <boxGeometry args={[0.9, 0.12, 0.07]} />
            <meshStandardMaterial color="#d9a441" metalness={0.4} roughness={0.45} />
          </mesh>
          <mesh position={[0.88, 0, 1.38]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.16, 24]} />
            <meshStandardMaterial color="#5d6878" metalness={0.7} roughness={0.35} />
          </mesh>
        </Part>
      </ServoRotor>

      {/* ── servo drive ── */}
      <Part id="drive-cover">
        <group position={[2.0, 0, -0.1]}>
          {/* front panel with display and connectors, top, bottom, left wall; the heatsink side stays open */}
          <mesh position={[0, 0, 0.76]}>
            <boxGeometry args={[0.72, 1.9, 0.03]} />
            <meshStandardMaterial color="#2c333d" metalness={0.3} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.62, 0.78]}>
            <boxGeometry args={[0.4, 0.2, 0.02]} />
            <meshStandardMaterial color="#0f2a1e" emissive="#2fc28d" emissiveIntensity={0.35} />
          </mesh>
          {[0.85, -0.6].map((y) => (
            <mesh key={y} position={[-0.15, y, 0.79]}>
              <boxGeometry args={[0.22, 0.14, 0.04]} />
              <meshStandardMaterial color="#14181d" roughness={0.7} />
            </mesh>
          ))}
          {[0.95, -0.95].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <boxGeometry args={[0.72, 0.03, 1.52]} />
              <meshStandardMaterial color="#2c333d" metalness={0.3} roughness={0.6} />
            </mesh>
          ))}
          <mesh position={[-0.35, 0, 0]}>
            <boxGeometry args={[0.03, 1.9, 1.52]} />
            <meshStandardMaterial color="#2c333d" metalness={0.3} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0, -0.76]}>
            <boxGeometry args={[0.72, 1.9, 0.03]} />
            <meshStandardMaterial color="#2c333d" metalness={0.3} roughness={0.6} />
          </mesh>
        </group>
      </Part>
      <Part id="controller">
        <group position={[1.82, 0.4, -0.1]}>
          <mesh>
            <boxGeometry args={[0.03, 0.95, 1.3]} />
            <meshStandardMaterial color={MAT.pcb} roughness={0.7} />
          </mesh>
          <mesh position={[0.03, 0.1, 0]}>
            <boxGeometry args={[0.03, 0.22, 0.22]} />
            <meshStandardMaterial color={MAT.chip} roughness={0.5} />
          </mesh>
          {[[-0.25, 0.35], [-0.25, -0.35], [0.3, 0.4], [0.3, -0.3]].map(([y, z]) => (
            <mesh key={`${y}${z}`} position={[0.025, y, z]}>
              <boxGeometry args={[0.02, 0.1, 0.14]} />
              <meshStandardMaterial color={MAT.chip} roughness={0.5} />
            </mesh>
          ))}
        </group>
      </Part>
      <Part id="power-stage">
        <group position={[2.12, -0.5, -0.1]}>
          <mesh>
            <boxGeometry args={[0.05, 0.75, 1.25]} />
            <meshStandardMaterial color={MAT.alu} metalness={0.6} roughness={0.4} />
          </mesh>
          {Array.from({ length: 9 }, (_, k) => (
            <mesh key={k} position={[0.1, 0, -0.56 + k * 0.14]}>
              <boxGeometry args={[0.16, 0.72, 0.025]} />
              <meshStandardMaterial color={MAT.alu} metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
          {[0, 1, 2].map((i) =>
            [0.17, -0.17].map((y) => (
              <mesh key={`${i}${y}`} position={[-0.05, y, -0.35 + i * 0.35]}>
                <boxGeometry args={[0.04, 0.2, 0.16]} />
                <meshStandardMaterial color={MAT.chip} roughness={0.5} />
              </mesh>
            )),
          )}
          {[0.25, -0.25].map((z) => (
            <mesh key={z} position={[-0.25, -0.05, z]}>
              <cylinderGeometry args={[0.1, 0.1, 0.4, 20]} />
              <meshStandardMaterial color="#2d4f7a" metalness={0.3} roughness={0.5} />
            </mesh>
          ))}
        </group>
      </Part>
      <Part id="cables">
        <mesh geometry={geo.power}>
          <meshStandardMaterial color="#c2621f" roughness={0.65} />
        </mesh>
        <mesh geometry={geo.feedback}>
          <meshStandardMaterial color="#3f6fb0" roughness={0.65} />
        </mesh>
      </Part>

      {/* ── conceptual layers ── */}
      {L.has('current') && (
        <group>
          <FlowLine points={[[1.82, 1.85, 0.75], [1.82, 1.2, 0.72], [1.82, 0.75, 0.66]]} color={LAYER_COLOR.current} rate={1} width={3} />
          <Marker at={[1.82, 2.0, 0.75]} text="θ* (position command)" tone="current" />
          <FlowLine points={[[1.86, 0.2, 0.4], [1.98, -0.1, 0.4], [2.06, -0.35, 0.4]]} color={LAYER_COLOR.current} rate={1} width={3} />
          <Marker at={[1.45, -0.05, 0.5]} text="current command" tone="current" />
          <FlowLine points={[...FEEDBACK_PATH.map((p) => [p[0], p[1] + 0.09, p[2]] as Vec3)]} color={LAYER_COLOR.field} rate={1} width={3} />
          <Marker at={[0.45, 1.5, -0.4]} text="θ (encoder feedback)" tone="field" />
        </group>
      )}
      {showChip && <LoopChip at={[-0.7, -1.45, 0.7]} />}
      {L.has('energy') && (
        <group>
          <FlowLine points={[[2.0, -1.3, -0.6], [2.0, -0.95, -0.4], [2.06, -0.6, 0.2], [1.9, -0.7, 0.66], ...POWER_PATH.slice(1).map((p) => [p[0], p[1] + 0.1, p[2]] as Vec3), [MX, 0.45, 0.2], [MX, 0.1, 0.8], [MX, 0, 1.38], [MX + 0.8, 0, 1.45]]} color={LAYER_COLOR.energy} rate={1} width={3.5} />
          <Marker at={[2.0, -1.45, -0.6]} text="supply (DC link)" tone="energy" />
          <Marker at={[0.85, -0.85, 1.1]} text="phase currents" tone="energy" />
          <Marker at={[MX + 1.1, 0.2, 1.55]} text="mechanical power to the load" tone="energy" />
        </group>
      )}
      {L.has('rotation') && (
        <group position={[MX, 0, 0]}>
          <CurvedArrow radius={0.32} start={deg(-30)} sweep={deg(150)} z={1.62} color={LAYER_COLOR.rotation} tube={0.022} />
          <Marker at={[0.0, 0.5, 1.65]} text="moves to θ*, then holds" tone="neutral" />
        </group>
      )}
    </group>
  )
}
