import { Html } from '../../viewer/Html.tsx'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { ModelState, Vec3 } from '../../types.ts'
import { ease, stageFactor, useViewer } from '../../viewer/context.tsx'
import { Part } from '../../viewer/Part.tsx'
import { arc, Arrow, CurvedArrow, FlowLine, LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { ARM_LEN, armatureGeometry, arcShell, coilGeometry, coilLoop, CORE_HY, CORE_HZ, SHOE_IN, SHOE_OUT, SLOTS, YOKE_HALF, YOKE_IN, YOKE_OUT, type Kind } from './geometry.ts'
import { ConnectionInset, EmfInset } from './Schematic.tsx'

/*
 * Wound-field DC machine — original procedural geometry (simplified educational model), one model for the five
 * connections. Shaft = z axis, front (+z) = commutator end. Main pole N on +x, S on −x, made by the field coils:
 * the coil current circulates so that the flux in both pole cores points −x (right-hand grip rule), crosses the
 * armature from N to S and returns through the yoke. The armature turns clockwise seen from the front in every
 * variant (a generator is driven that way by its prime mover). Motor: current ⊙ under N → F = I·L×B points −y at
 * +x → clockwise torque. Generator: the induced EMF under N is ⊗ (v×B), the load current follows it, and the force
 * on that current opposes the rotation (counter-torque). All layer arrows below follow exactly this geometry.
 */
const STEEL = '#9aa4b2'
const POLE_STEEL = '#8a95a5'
const FRAME = '#56606e'
const COPPER = '#c27a3c'
const SHUNT_CU = '#a9632f' // enamelled fine wire, many turns
const SERIES_CU = '#dd9150' // thick strip, few turns
const INSUL = '#1f232a'
const CARBON = '#2a2d33'

type Stud = { name: string; x: number }

/** Terminal markings (IEC 60034-8): A armature, E shunt field, F separately excited field, D series field. */
function studsFor(kind: Kind): string[] {
  if (kind === 'shunt') return ['E1', 'A1', 'A2', 'E2']
  if (kind === 'series') return ['A1', 'A2', 'D1', 'D2']
  if (kind === 'compound') return ['E1', 'A1', 'A2', 'D1', 'D2', 'E2']
  return ['A1', 'A2', 'F1', 'F2'] // separately excited motor and generator
}
/** Links fitted between studs in the terminal box (they make the connection). */
function linksFor(kind: Kind): Array<[string, string]> {
  if (kind === 'shunt') return [['E1', 'A1'], ['A2', 'E2']]
  if (kind === 'series') return [['A2', 'D1']]
  if (kind === 'compound') return [['E1', 'A1'], ['A2', 'D1'], ['D2', 'E2']]
  return []
}
/** External cable pairs: [+ stud, − stud, tag, side (+1 right / −1 left)]. */
function cablesFor(kind: Kind): Array<[string, string, string, number]> {
  if (kind === 'generator') return [['A1', 'A2', 'to the load RL', 1], ['F1', 'F2', 'field supply Vf', -1]]
  if (kind === 'separate') return [['A1', 'A2', 'armature supply Va', 1], ['F1', 'F2', 'field supply Vf', -1]]
  if (kind === 'series') return [['A1', 'D2', 'DC supply V', 1]]
  if (kind === 'compound') return [['A1', 'E2', 'DC supply V', 1]]
  return [['A1', 'A2', 'DC supply V', 1]]
}

const BOX_Y = 1.69
const BOX_Z = 0.3
const STUD_DX = 0.22

/** A group that moves by `offset` while the assembly explodes through `stage` (same easing as <Part>). */
function Sub({ offset, stage, children }: { offset: Vec3; stage: number; children: ReactNode }) {
  const v = useViewer()
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    const f = ease(stageFactor(v.anim.current.explode, stage))
    g.current?.position.set(offset[0] * f, offset[1] * f, offset[2] * f)
  })
  return <group ref={g}>{children}</group>
}

function Tube({ points, radius = 0.014, color }: { points: Vec3[]; radius?: number; color: string }) {
  const geo = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 48, radius, 8, false), [points, radius])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  )
}

/** A field coil on each pole: `x0` radial start, `depth` radial size, `build` ring width; `turns` > 1 shows separate strip turns. */
function PoleCoils({ x0, depth, build, color, turns = 1, grooves = 0 }: { x0: number; depth: number; build: number; color: string; turns?: number; grooves?: number }) {
  const gap = turns > 1 ? 0.018 : 0
  const t = (depth - gap * (turns - 1)) / turns
  const geo = useMemo(() => coilGeometry(t, build), [t, build])
  const ring = useMemo(() => coilGeometry(0.006, build + 0.004, -0.002), [build])
  const one = (sign: number) => (
    <group>
      {Array.from({ length: turns }, (_, k) => {
        const x = x0 + k * (t + gap)
        return (
          <mesh key={k} geometry={geo} position={[sign > 0 ? x : -x - t, 0, 0]}>
            <meshStandardMaterial color={color} metalness={0.65} roughness={0.38} />
          </mesh>
        )
      })}
      {/* fine-wire coils: thin dark bands suggest the many layers of turns */}
      {Array.from({ length: grooves }, (_, k) => {
        const x = x0 + ((k + 1) * depth) / (grooves + 1)
        return (
          <mesh key={`g${k}`} geometry={ring} position={[sign > 0 ? x : -x - 0.006, 0, 0]}>
            <meshStandardMaterial color="#5a3216" roughness={0.8} />
          </mesh>
        )
      })}
    </group>
  )
  return (
    <>
      {one(1)}
      {/* the S-pole coil moves the other way when the assembly explodes */}
      <Sub offset={[-3, 0, 0]} stage={3}>
        {one(-1)}
      </Sub>
    </>
  )
}

export function WoundFieldModel({ state, kind }: { state: ModelState; kind: Kind }) {
  const v = useViewer()
  const generator = kind === 'generator'
  const hasShunt = kind !== 'series'
  const hasSeries = kind === 'series' || kind === 'compound'
  const sense = kind === 'compound' && (state.params.sense ?? 1) < 0 ? -1 : 1
  const ia = state.calc.ia
  // conductor current under the N pole: ⊙ (+z) when motoring, ⊗ when generating (generator, or a driven motor)
  const cur = generator ? -1 : ia !== null && ia !== undefined && ia < 0 ? -1 : 1
  const L = state.layers

  const geo = useMemo(
    () => ({
      armature: armatureGeometry(),
      shoeN: arcShell(SHOE_IN, SHOE_OUT, -0.85, 0.85, 1.5),
      shoeS: arcShell(SHOE_IN, SHOE_OUT, Math.PI - 0.85, Math.PI + 0.85, 1.5),
      segs: Array.from({ length: SLOTS }, (_, k) => arcShell(0.2, 0.3, (k * 2 * Math.PI) / SLOTS + 0.05, ((k + 1) * 2 * Math.PI) / SLOTS - 0.05, 0.42)),
      yokeRing: new THREE.RingGeometry(YOKE_IN, YOKE_OUT, 64),
    }),
    [],
  )

  // field-coil layout: [radial start, depth]
  const shuntCoil: [number, number] = kind === 'compound' ? [1.09, 0.25] : [0.945, 0.38]
  const seriesCoil: [number, number] = kind === 'compound' ? [0.945, 0.13] : [0.945, 0.37]
  const seriesTurns = kind === 'compound' ? 2 : 4

  // terminal box
  const names = studsFor(kind)
  const studs: Stud[] = names.map((name, i) => ({ name, x: (i - (names.length - 1) / 2) * STUD_DX }))
  const sx = (n: string) => studs.find((s) => s.name === n)!.x
  const boxW = names.length * STUD_DX + 0.14
  const studTop = BOX_Y + 0.17 + 0.1
  const showStudNames = v.selectedParts.has('terminal-box') || v.focus.has('terminal-box') || (L.has('current') && v.focus.size === 0)
  const fieldStuds = kind === 'shunt' || kind === 'compound' ? ['E1', 'E2'] : kind === 'series' ? null : ['F1', 'F2']
  const seriesStuds = hasSeries ? ['D1', 'D2'] : null

  /** Lead from a coil's top-front corner (N side: sign +1) to its stud, along the inside of the yoke. */
  const coilLead = (sign: number, xc: number, stud: string, z: number): Vec3[] => [
    [sign * xc, 0.36, z],
    [sign * 1.2, 0.62, z + 0.02],
    [sign * 0.9, 1.02, z + 0.02],
    [sx(stud), 1.3, 0.62],
    [sx(stud), 1.56, BOX_Z],
  ]
  /** The two pole coils are joined in series round the bottom of the frame. */
  const coilBridge = (xc: number, z: number, r: number): Vec3[] => [
    [xc, -0.36, z],
    [r * 0.87, -r * 0.5, z + 0.02],
    [0, -r, z + 0.02],
    [-r * 0.87, -r * 0.5, z + 0.02],
    [-xc, -0.36, z],
  ]

  const slotAngle = (k: number) => (k * 2 * Math.PI) / SLOTS
  const shaftRear = generator ? -1.86 : -1.95
  const shaftLen = 1.95 - shaftRear

  const coilHy = CORE_HY + 0.03
  const coilHz = CORE_HZ + 0.03
  return (
    <group>
      {/* ── stator ── */}
      <Part id="yoke">
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[YOKE_OUT, YOKE_OUT, 2 * YOKE_HALF, 64, 1, true]} />
          <meshStandardMaterial color={FRAME} metalness={0.55} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[YOKE_IN, YOKE_IN, 2 * YOKE_HALF, 64, 1, true]} />
          <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} side={THREE.BackSide} />
        </mesh>
        {[1, -1].map((s) => (
          <mesh key={s} geometry={geo.yokeRing} position={[0, 0, s * YOKE_HALF]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}>
            <meshStandardMaterial color={FRAME} metalness={0.55} roughness={0.5} />
          </mesh>
        ))}
        {/* mounting feet */}
        {[1, -1].map((s) => (
          <group key={`f${s}`}>
            <mesh position={[s * 1.02, -1.42, 0]}>
              <boxGeometry args={[0.36, 0.5, 1.5]} />
              <meshStandardMaterial color={FRAME} metalness={0.5} roughness={0.55} />
            </mesh>
            <mesh position={[s * 1.02, -1.7, 0]}>
              <boxGeometry args={[0.66, 0.07, 1.62]} />
              <meshStandardMaterial color={FRAME} metalness={0.5} roughness={0.55} />
            </mesh>
          </group>
        ))}
      </Part>

      {[1, -1].map((s) => (
        <Part key={s} id={s > 0 ? 'pole-n' : 'pole-s'}>
          {/* pole core, bolted to the yoke */}
          <mesh position={[s * 1.165, 0, 0]}>
            <boxGeometry args={[0.5, 2 * CORE_HY, 2 * CORE_HZ]} />
            <meshStandardMaterial color={POLE_STEEL} metalness={0.65} roughness={0.42} />
          </mesh>
          {/* pole shoe: spreads the flux over the air gap */}
          <mesh geometry={s > 0 ? geo.shoeN : geo.shoeS}>
            <meshStandardMaterial color={POLE_STEEL} metalness={0.65} roughness={0.42} />
          </mesh>
          {/* lamination lines on the shoe face */}
          {Array.from({ length: 9 }, (_, i) => (
            <mesh key={i} position={[0, 0, -0.75 + ((i + 1) * 1.5) / 10]} rotation={[0, 0, s > 0 ? -0.85 : Math.PI - 0.85]}>
              <torusGeometry args={[SHOE_IN + 0.001, 0.004, 4, 24, 1.7]} />
              <meshStandardMaterial color="#4a525e" roughness={0.7} />
            </mesh>
          ))}
        </Part>
      ))}

      {hasShunt && (
        <Part id="field-coils">
          <PoleCoils x0={shuntCoil[0]} depth={shuntCoil[1]} build={0.13} color={SHUNT_CU} grooves={kind === 'compound' ? 2 : 4} />
        </Part>
      )}
      {hasSeries && (
        <Part id="series-coils">
          <PoleCoils x0={seriesCoil[0]} depth={seriesCoil[1]} build={kind === 'compound' ? 0.11 : 0.14} color={SERIES_CU} turns={seriesTurns} />
        </Part>
      )}

      <Part id="terminal-box">
        <mesh position={[0, BOX_Y, BOX_Z]}>
          <boxGeometry args={[boxW, 0.34, 0.7]} />
          <meshStandardMaterial color={FRAME} metalness={0.5} roughness={0.55} />
        </mesh>
        <mesh position={[0, BOX_Y + 0.175, BOX_Z]}>
          <boxGeometry args={[boxW - 0.06, 0.02, 0.62]} />
          <meshStandardMaterial color={INSUL} roughness={0.85} />
        </mesh>
        {studs.map((s) => (
          <group key={s.name} position={[s.x, BOX_Y + 0.22, BOX_Z]}>
            <mesh>
              <cylinderGeometry args={[0.03, 0.03, 0.1, 12]} />
              <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.02, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.03, 6]} />
              <meshStandardMaterial color="#b8962a" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        ))}
        {/* stud markings, staggered in height so neighbours never overlap */}
        {showStudNames &&
          studs.map((s, i) => (
            <Html key={`l${s.name}`} position={[s.x, BOX_Y + (i % 2 ? 0.52 : 0.36), BOX_Z - 0.05]} center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
              <span className="dcm-stud">{s.name}</span>
            </Html>
          ))}
        {linksFor(kind).map(([a, b]) => (
          <mesh key={a + b} position={[(sx(a) + sx(b)) / 2, BOX_Y + 0.24, BOX_Z]}>
            <boxGeometry args={[Math.abs(sx(a) - sx(b)) + 0.07, 0.022, 0.075]} />
            <meshStandardMaterial color={COPPER} metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        {cablesFor(kind).map(([p, m, tag, side]) => {
          const end: Vec3 = [side * 1.3, studTop + 0.02, 1.45]
          const cable = (stud: string, dx: number, color: string) => (
            <Tube key={stud} radius={0.03} color={color} points={[[sx(stud), studTop - 0.02, BOX_Z], [sx(stud), studTop + 0.16, BOX_Z + 0.05], [(sx(stud) + end[0]) / 2 + dx, studTop + 0.2, 0.85], [end[0] + dx, end[1], end[2]]]} />
          )
          return (
            <group key={tag}>
              {cable(p, 0.05, side > 0 ? '#b8322a' : '#c9802a')}
              {cable(m, -0.05, '#2b2f36')}
              {showStudNames && <Marker at={[end[0] + side * 0.15, end[1] - 0.12, end[2] + 0.1]} text={tag} tone="neutral" />}
            </group>
          )
        })}
        {/* internal leads: field coils and brushes to their studs */}
        {fieldStuds && (
          <>
            <Tube color="#30343c" points={coilLead(1, shuntCoil[0] + shuntCoil[1] / 2, fieldStuds[0], CORE_HZ + 0.18)} />
            <Tube color="#30343c" points={coilLead(-1, shuntCoil[0] + shuntCoil[1] / 2, fieldStuds[1], CORE_HZ + 0.18)} />
            <Tube color="#30343c" points={coilBridge(shuntCoil[0] + shuntCoil[1] / 2, CORE_HZ + 0.18, 1.32)} />
          </>
        )}
        {seriesStuds && (
          <>
            <Tube color="#5b3a1e" radius={0.02} points={coilLead(1, seriesCoil[0] + seriesCoil[1] / 2, seriesStuds[0], CORE_HZ + 0.24)} />
            <Tube color="#5b3a1e" radius={0.02} points={coilLead(-1, seriesCoil[0] + seriesCoil[1] / 2, seriesStuds[1], CORE_HZ + 0.24)} />
            <Tube color="#5b3a1e" radius={0.02} points={coilBridge(seriesCoil[0] + seriesCoil[1] / 2, CORE_HZ + 0.24, 1.26)} />
          </>
        )}
        <Tube color="#30343c" points={[[0, 0.72, 1.18], [0.05, 1.0, 1.22], [sx('A1') * 0.6, 1.3, 1.05], [sx('A1'), 1.32, 0.62], [sx('A1'), 1.56, BOX_Z]]} />
        <Tube color="#30343c" points={[[0, -0.72, 1.18], [0.7, -1.1, 1.24], [1.3, -0.2, 1.24], [1.0, 0.9, 1.2], [sx('A2'), 1.32, 0.62], [sx('A2'), 1.56, BOX_Z]]} />
      </Part>

      <Part id="end-cap-rear">
        <mesh position={[0, 0, -YOKE_HALF - 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[YOKE_OUT, YOKE_OUT, 0.1, 64]} />
          <meshStandardMaterial color="#6b7686" metalness={0.45} roughness={0.5} />
        </mesh>
      </Part>
      <Part id="end-cap-front">
        <mesh position={[0, 0, 1.26]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[YOKE_OUT, YOKE_OUT, 0.6, 64, 1, true]} />
          <meshStandardMaterial color="#6b7686" metalness={0.45} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 1.6]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[YOKE_OUT, YOKE_OUT, 0.08, 64]} />
          <meshStandardMaterial color="#6b7686" metalness={0.45} roughness={0.5} />
        </mesh>
      </Part>
      <Part id="bearings">
        <mesh position={[0, 0, 1.6]}>
          <torusGeometry args={[0.2, 0.06, 12, 32]} />
          <meshStandardMaterial color="#b9c2cf" metalness={0.9} roughness={0.25} />
        </mesh>
        <Sub offset={[0, 0, generator ? -3.8 : -4.0]} stage={1}>
          <mesh position={[0, 0, -YOKE_HALF - 0.05]}>
            <torusGeometry args={[0.2, 0.06, 12, 32]} />
            <meshStandardMaterial color="#b9c2cf" metalness={0.9} roughness={0.25} />
          </mesh>
        </Sub>
      </Part>
      <Part id="brushes">
        {[1, -1].map((s) => (
          <group key={s}>
            <mesh position={[0, s * 0.42, 1.18]}>
              <boxGeometry args={[0.16, 0.24, 0.2]} />
              <meshStandardMaterial color={CARBON} roughness={0.9} />
            </mesh>
            <mesh position={[0, s * 0.62, 1.18]}>
              <boxGeometry args={[0.24, 0.18, 0.26]} />
              <meshStandardMaterial color="#a8823a" metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        ))}
      </Part>

      {generator && (
        <Part id="prime-mover">
          <Spin axis="z">
            {/* coupling: two flanges bolted together */}
            {[-1.72, -1.84].map((z) => (
              <mesh key={z} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.34, 0.34, 0.1, 32]} />
                <meshStandardMaterial color="#8d97a5" metalness={0.8} roughness={0.3} />
              </mesh>
            ))}
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} position={[0.24 * Math.cos((k * Math.PI) / 2 + 0.4), 0.24 * Math.sin((k * Math.PI) / 2 + 0.4), -1.78]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.035, 0.035, 0.3, 8]} />
                <meshStandardMaterial color="#c3cad4" metalness={0.9} roughness={0.2} />
              </mesh>
            ))}
            <mesh position={[0, 0, -1.94]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.1, 0.1, 0.2, 16]} />
              <meshStandardMaterial color="#c3cad4" metalness={0.85} roughness={0.25} />
            </mesh>
          </Spin>
          {/* the drive (engine, turbine or motor) — drawn as a generic finned body */}
          <mesh position={[0, 0, -2.65]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.95, 0.95, 1.3, 48]} />
            <meshStandardMaterial color="#4f6b5a" metalness={0.4} roughness={0.55} />
          </mesh>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[0, 0, -2.15 - i * 0.2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[1.03, 1.03, 0.05, 48]} />
              <meshStandardMaterial color="#45604f" metalness={0.4} roughness={0.55} />
            </mesh>
          ))}
          <mesh position={[0, -1.15, -2.65]}>
            <boxGeometry args={[1.5, 0.12, 1.2]} />
            <meshStandardMaterial color="#3d5345" metalness={0.4} roughness={0.6} />
          </mesh>
        </Part>
      )}

      {/* ── rotor: turns clockwise seen from the front ── */}
      <Spin axis="z">
        <Part id="shaft">
          <mesh position={[0, 0, (1.95 + shaftRear) / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.1, 0.1, shaftLen, 24]} />
            <meshStandardMaterial color="#c3cad4" metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.1, 1.82]}>
            <boxGeometry args={[0.06, 0.05, 0.22]} />
            <meshStandardMaterial color="#8a939f" metalness={0.8} roughness={0.3} />
          </mesh>
        </Part>
        <Part id="armature-core">
          <mesh geometry={geo.armature}>
            <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.38} />
          </mesh>
          {Array.from({ length: 15 }, (_, i) => (
            <mesh key={i} position={[0, 0, -ARM_LEN / 2 + ((i + 1) * ARM_LEN) / 16]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.723, 0.723, 0.006, 48, 1, true]} />
              <meshStandardMaterial color="#454d59" metalness={0.5} roughness={0.6} />
            </mesh>
          ))}
        </Part>
        <Part id="armature-winding">
          {Array.from({ length: SLOTS }, (_, k) => (
            <mesh key={k} position={[0.6 * Math.cos(slotAngle(k)), 0.6 * Math.sin(slotAngle(k)), 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.075, 0.075, ARM_LEN + 0.12, 12]} />
              <meshStandardMaterial color={COPPER} metalness={0.7} roughness={0.35} />
            </mesh>
          ))}
          {Array.from({ length: SLOTS / 2 }, (_, k) =>
            [1, -1].map((side) => (
              <mesh key={`${k}${side}`} position={[0, 0, side * (ARM_LEN / 2 + 0.07 + k * 0.035)]} rotation={[0, 0, slotAngle(k)]}>
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
      </Spin>

      {/* ── conceptual layers ── */}
      {L.has('field') && (
        <group>
          {[-0.14, 0, 0.14].map((y) => (
            <FlowLine key={y} points={[[1.45, y, 0.9], [-1.45, y, 0.9]]} color={LAYER_COLOR.field} rate={1} />
          ))}
          {[-0.45, -0.3, 0.3, 0.45].map((y) => (
            <FlowLine key={y} points={[[0.84, y * 0.8, 0.9], [0.5, y, 0.9], [-0.5, y, 0.9], [-0.84, y * 0.8, 0.9]]} color={LAYER_COLOR.field} rate={1} />
          ))}
          <FlowLine points={arc(1.49, Math.PI, 0, 0.9)} color={LAYER_COLOR.field} rate={1} width={2} />
          <FlowLine points={arc(1.49, -Math.PI, 0, 0.9)} color={LAYER_COLOR.field} rate={1} width={2} />
          <Marker at={[0.98, 0.5, 0.95]} text="N" tone="north" />
          <Marker at={[-0.98, -0.5, 0.95]} text="S" tone="south" />
        </group>
      )}
      {L.has('current') && (
        <group>
          {[-0.6, 0, 0.6].map((a) => (
            <Marker key={`r${a}`} at={[0.6 * Math.cos(a), 0.6 * Math.sin(a), 0.98]} text={cur > 0 ? '⊙' : '⊗'} tone="current" />
          ))}
          {[Math.PI - 0.6, Math.PI, Math.PI + 0.6].map((a) => (
            <Marker key={`l${a}`} at={[0.6 * Math.cos(a), 0.6 * Math.sin(a), 0.98]} text={cur > 0 ? '⊗' : '⊙'} tone="current" />
          ))}
          {hasShunt &&
            [1, -1].map((s) => (
              <FlowLine key={`sh${s}`} points={coilLoop(s * (shuntCoil[0] + shuntCoil[1] / 2), coilHy + 0.15, coilHz + 0.15)} color={LAYER_COLOR.current} rate={1} width={2} />
            ))}
          {hasSeries &&
            [1, -1].map((s) => (
              <FlowLine key={`se${s}`} points={coilLoop(s * (seriesCoil[0] + seriesCoil[1] / 2), coilHy + (kind === 'compound' ? 0.13 : 0.17), coilHz + (kind === 'compound' ? 0.13 : 0.17))} color={LAYER_COLOR.current} rate={sense} width={kind === 'compound' ? 3.5 : 4} />
            ))}
          <ConnectionInset kind={kind} calc={state.calc} sense={sense} />
        </group>
      )}
      {L.has('torque') && (
        <group>
          {/* force on the conductors: with the rotation (motoring) or against it (generating) */}
          <Arrow from={[0.6, cur * 0.15, 0.95]} dir={[0, -cur, 0]} length={0.5} color={LAYER_COLOR.torque} />
          <Arrow from={[-0.6, -cur * 0.15, 0.95]} dir={[0, cur, 0]} length={0.5} color={LAYER_COLOR.torque} />
          <Marker at={[0.78, -cur * 0.42, 1.0]} text="F" tone="torque" />
          <Marker at={[-0.78, cur * 0.42, 1.0]} text="F" tone="torque" />
          <CurvedArrow radius={1.72} start={cur > 0 ? Math.PI * 0.6 : Math.PI * 0.05} sweep={cur > 0 ? -Math.PI * 0.55 : Math.PI * 0.55} z={0.9} color={LAYER_COLOR.torque} />
          <Marker at={[2.05, 0.75, 0.9]} text={cur > 0 ? 'T (drives the shaft)' : 'T (counter-torque)'} tone="torque" />
          {generator && (
            <>
              <CurvedArrow radius={0.5} start={Math.PI * 0.9} sweep={-Math.PI * 1.3} z={-1.62} color={LAYER_COLOR.torque} tube={0.025} />
              <Marker at={[-0.9, 0.75, -1.62]} text="T from the prime mover" tone="torque" />
            </>
          )}
        </group>
      )}
      {L.has('rotation') && <CurvedArrow radius={0.42} start={Math.PI * 0.9} sweep={-Math.PI * 1.4} z={1.95} color={LAYER_COLOR.rotation} tube={0.022} />}
      {L.has('emf') && (
        <group>
          <Marker at={[0.98, -0.32, 1.0]} text="E ⊗" tone="emf" />
          <Marker at={[-0.98, 0.32, 1.0]} text="E ⊙" tone="emf" />
          {generator && <EmfInset />}
        </group>
      )}
      {L.has('energy') &&
        (generator ? (
          <group>
            <FlowLine points={[[0, 0, -2.0], [0, 0, 0.4], [0.3, 0.6, 0.6], [sx('A1'), 1.5, BOX_Z], [1.3, studTop + 0.02, 1.45]]} color={LAYER_COLOR.energy} rate={1} width={3.5} />
            <Marker at={[0, 1.2, -2.0]} text="Pmech = T·ω in" tone="energy" />
            <Marker at={[1.5, studTop + 0.3, 1.5]} text="Pout = V·IL to the load" tone="energy" />
            <Marker at={[-1.15, -1.3, 0.5]} text="heat: Ia²·Ra, If²·Rf" tone="energy" />
          </group>
        ) : (
          <group>
            <FlowLine points={[[1.3, studTop + 0.02, 1.45], [sx('A1'), 1.5, BOX_Z], [0.3, 0.6, 0.6], [0, 0, 0.4], [0, 0, -1.95], [0, 0, -2.55]]} color={LAYER_COLOR.energy} rate={cur} width={3.5} />
            <Marker at={[1.5, studTop + 0.3, 1.5]} text={cur > 0 ? 'Pin = V·IL' : 'power back to the supply'} tone="energy" />
            <Marker at={[0, -0.32, -2.5]} text={cur > 0 ? 'Pout = T·ω' : 'shaft power in'} tone="energy" />
            <Marker at={[-1.15, -1.3, 0.5]} text={kind === 'series' ? 'heat: Ia²·(Ra + Rse)' : kind === 'compound' ? 'heat: Ia²·(Ra+Rse), V·If' : 'heat: Ia²·Ra, If²·Rf'} tone="energy" />
          </group>
        ))}
    </group>
  )
}
