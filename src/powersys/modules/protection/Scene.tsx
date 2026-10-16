import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { Label3D, Scene3D, SCENE_COLORS, Selectable, useHighlight, useScene, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { L1_KM, L3_KM, type CbId, type DistanceCase } from './distance.ts'

/*
 * The 3D route: substation A (source behind it, busbar, breaker CB A, current and voltage transformers, the relay
 * kiosk), the 120 km line L1 on towers, substation B (CB B1, busbar, CB B2, optional grid infeed) and the next line
 * L3 to C. GEOMETRY: the line lengths and the fault marker's position along them are to scale (one scale for both
 * lines). CALCULATED: the breakers' open/closed state and opening, the relay's zone and time, and the de-energised
 * (isolated) sections — all from the computed decisions. Equipment shapes and sizes are drawn for recognition
 * (illustration, not to scale).
 */

type V3 = [number, number, number]
type Member = [V3, V3]

/** Scene units per km along the route. */
const K = 0.13
const XA = -15
const XB1 = XA + L1_KM * K
const XB2 = XB1 + 2.4
const XC = XB2 + L3_KM * K
const H_LINE = 2.25
const PHASE_Z = [-0.42, 0, 0.42]
const PHASE_COLOR = [SCENE_COLORS.phaseA, SCENE_COLORS.phaseB, SCENE_COLORS.phaseC]
const DEAD = '#4a5566'

/** Scene x of a fault position [km along the route]. */
export const xOfKm = (km: number) => (km <= L1_KM ? XA + km * K : XB2 + (km - L1_KM) * K)

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

function Members({ members, thick, color, emissive }: { members: Member[]; thick: number; color: string; emissive?: string }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    members.forEach(([a, b], i) => {
      const va = new THREE.Vector3(...a)
      const vb = new THREE.Vector3(...b)
      const dir = vb.clone().sub(va)
      const len = Math.max(dir.length(), 1e-6)
      tmpQ.setFromUnitVectors(UP, dir.normalize())
      tmpM.compose(va.add(vb).multiplyScalar(0.5), tmpQ, new THREE.Vector3(thick, len, thick))
      m.setMatrixAt(i, tmpM)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [members, thick])
  return (
    <instancedMesh key={members.length} ref={ref} args={[undefined, undefined, members.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.35 : 0} />
    </instancedMesh>
  )
}

const tone = (h: ReturnType<typeof useHighlight>, base: string) =>
  h === 'selected' ? SCENE_COLORS.selected : h === 'hovered' ? SCENE_COLORS.hovered : h === 'dim' ? new THREE.Color(base).multiplyScalar(0.5).getStyle() : base

/** Support points of a line: gantry, towers every 20 km, gantry. */
function supports(x0: number, x1: number, km: number): number[] {
  const out = [x0]
  for (let d = 20; d < km - 1; d += 20) out.push(x0 + d * K)
  out.push(x1)
  return out
}

/** Conductors of one line with a little sag (an illustration), one member per short segment. */
function conductorMembers(xs: number[], z: number): Member[] {
  const out: Member[] = []
  for (let s = 0; s + 1 < xs.length; s++) {
    const a = xs[s]
    const b = xs[s + 1]
    const n = 6
    for (let i = 0; i < n; i++) {
      const u0 = i / n
      const u1 = (i + 1) / n
      const sag = (u: number) => H_LINE - 0.22 * 4 * u * (1 - u)
      out.push([
        [a + (b - a) * u0, sag(u0), z],
        [a + (b - a) * u1, sag(u1), z],
      ])
    }
  }
  return out
}

function towerMembers(x: number): Member[] {
  const w = 0.28
  const top = H_LINE + 0.35
  const legs: Member[] = [
    [
      [x - w, 0, -w],
      [x - 0.08, top, -0.08],
    ],
    [
      [x + w, 0, -w],
      [x + 0.08, top, -0.08],
    ],
    [
      [x - w, 0, w],
      [x - 0.08, top, 0.08],
    ],
    [
      [x + w, 0, w],
      [x + 0.08, top, 0.08],
    ],
  ]
  const arm: Member[] = [
    [
      [x, H_LINE + 0.18, -0.62],
      [x, H_LINE + 0.18, 0.62],
    ],
  ]
  const brace: Member[] = [
    [
      [x - w, 0, -w],
      [x + 0.15, 1.2, -0.17],
    ],
    [
      [x + w, 0, w],
      [x - 0.15, 1.2, 0.17],
    ],
  ]
  return [...legs, ...arm, ...brace]
}

function gantryMembers(x: number): Member[] {
  return [
    [
      [x, 0, -0.75],
      [x, H_LINE + 0.3, -0.75],
    ],
    [
      [x, 0, 0.75],
      [x, H_LINE + 0.3, 0.75],
    ],
    [
      [x, H_LINE + 0.3, -0.8],
      [x, H_LINE + 0.3, 0.8],
    ],
  ]
}

function LineConductors({ id, x0, x1, km, dead, label }: { id: 'l1' | 'l3'; x0: number; x1: number; km: number; dead: boolean; label: string }) {
  const h = useHighlight(id)
  const xs = useMemo(() => supports(x0, x1, km), [x0, x1, km])
  const towers = useMemo(() => xs.slice(1, -1).flatMap(towerMembers), [xs])
  const phases = useMemo(() => PHASE_Z.map((z) => conductorMembers(xs, z)), [xs])
  return (
    <Selectable id={id}>
      <Members members={towers} thick={0.05} color={tone(h, SCENE_COLORS.steel)} />
      {phases.map((m, k) => (
        <Members key={k} members={m} thick={0.045} color={tone(h, dead ? DEAD : PHASE_COLOR[k])} />
      ))}
      {/* an invisible fat hit target */}
      <mesh position={[(x0 + x1) / 2, H_LINE - 0.1, 0]} visible={false}>
        <boxGeometry args={[x1 - x0, 0.7, 1.4]} />
        <meshBasicMaterial />
      </mesh>
      <Label3D position={[x0 + (x1 - x0) * 0.3, H_LINE + 0.75, -0.6]}>{label}</Label3D>
    </Selectable>
  )
}

/** A live-tank breaker bay (three poles); the moving contacts slide apart when open (animated unless motion is reduced). */
function Breaker({ id, x, open, label, always = false }: { id: CbId; x: number; open: boolean; label: string; always?: boolean }) {
  const h = useHighlight(id)
  const { invalidate, reducedMotion } = useScene()
  const moving = useRef<THREE.Group[]>([])
  const pos = useRef(open ? 1 : 0)
  useFrame((_, dt) => {
    const target = open ? 1 : 0
    if (pos.current === target) return
    pos.current = reducedMotion ? target : target > pos.current ? Math.min(target, pos.current + dt / 0.35) : Math.max(target, pos.current - dt / 0.35)
    for (const g of moving.current) if (g) g.position.x = 0.16 * pos.current
    if (pos.current !== target) invalidate()
  })
  useLayoutEffect(() => {
    for (const g of moving.current) if (g) g.position.x = 0.16 * pos.current
    invalidate()
  }, [invalidate])
  useLayoutEffect(() => invalidate(), [open, invalidate])
  const color = tone(h, SCENE_COLORS.insulator)
  return (
    <Selectable id={id}>
      {PHASE_Z.map((z, k) => (
        <group key={k} position={[x, 0, z]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.16, 0.9, 0.16]} />
            <meshStandardMaterial color={SCENE_COLORS.steelDark} />
          </mesh>
          <mesh position={[0, 1.35, 0]}>
            <cylinderGeometry args={[0.07, 0.09, 0.9, 10]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          {/* fixed contact */}
          <mesh position={[-0.16, 1.88, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.075, 0.075, 0.3, 10]} />
            <meshStandardMaterial color={tone(h, '#9aa6b5')} metalness={0.6} roughness={0.35} />
          </mesh>
          {/* moving contact */}
          <group ref={(g) => void (g && (moving.current[k] = g))}>
            <mesh position={[0.15, 1.88, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.075, 0.075, 0.28, 10]} />
              <meshStandardMaterial color={tone(h, '#9aa6b5')} metalness={0.6} roughness={0.35} />
            </mesh>
          </group>
        </group>
      ))}
      {/* mechanism cabinet with its state lamp (red = closed, green = open: also written in the label) */}
      <mesh position={[x, 0.3, 0.95]}>
        <boxGeometry args={[0.36, 0.6, 0.22]} />
        <meshStandardMaterial color={tone(h, '#56606e')} />
      </mesh>
      <mesh position={[x, 0.5, 1.07]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color={open ? '#22b14c' : '#e05252'} emissive={open ? '#22b14c' : '#e05252'} emissiveIntensity={0.8} />
      </mesh>
      <Label3D position={[x, 0.15, 1.35]} always={open || always} className="is-value">
        {label}: {open ? 'OPEN' : 'closed'}
      </Label3D>
    </Selectable>
  )
}

function InstrumentTransformers() {
  const hc = useHighlight('ct')
  const hv = useHighlight('vt')
  const xct = XA - 2.3
  const xvt = XA - 1.2
  return (
    <>
      <Selectable id="ct">
        {PHASE_Z.map((z, k) => (
          <group key={k} position={[xct, 0, z]}>
            <mesh position={[0, 0.85, 0]}>
              <cylinderGeometry args={[0.06, 0.08, 1.7, 8]} />
              <meshStandardMaterial color={tone(hc, SCENE_COLORS.insulator)} />
            </mesh>
            <mesh position={[0, 1.85, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 0.32, 14]} />
              <meshStandardMaterial color={tone(hc, '#8e9aa9')} metalness={0.4} />
            </mesh>
          </group>
        ))}
        <Label3D position={[xct, 2.45, -0.75]}>CT</Label3D>
      </Selectable>
      <Selectable id="vt">
        {PHASE_Z.map((z, k) => (
          <group key={k} position={[xvt, 0, z]}>
            {[0, 1, 2, 3].map((j) => (
              <mesh key={j} position={[0, 0.4 + j * 0.42, 0]}>
                <cylinderGeometry args={[0.09, 0.11, 0.36, 10]} />
                <meshStandardMaterial color={tone(hv, SCENE_COLORS.insulator)} />
              </mesh>
            ))}
            <mesh position={[0, 2.0, 0]}>
              <sphereGeometry args={[0.12, 10, 8]} />
              <meshStandardMaterial color={tone(hv, '#8e9aa9')} metalness={0.4} />
            </mesh>
          </group>
        ))}
        <Label3D position={[xvt, 2.55, -0.75]}>VT</Label3D>
      </Selectable>
    </>
  )
}

function RelayKiosk({ text }: { text: string }) {
  const h = useHighlight('relay')
  const x = XA - 2.0
  const cable: Member[] = [
    [
      [XA - 2.3, 0.04, 0.45],
      [XA - 2.3, 0.04, 1.9],
    ],
    [
      [XA - 1.2, 0.04, 0.45],
      [XA - 1.2, 0.04, 1.9],
    ],
    [
      [XA - 2.3, 0.04, 1.9],
      [x, 0.04, 1.9],
    ],
  ]
  return (
    <Selectable id="relay">
      <mesh position={[x, 0.55, 2.3]}>
        <boxGeometry args={[0.9, 1.1, 0.55]} />
        <meshStandardMaterial color={tone(h, '#6b7686')} roughness={0.7} />
      </mesh>
      <mesh position={[x, 0.65, 2.58]}>
        <boxGeometry args={[0.32, 0.18, 0.02]} />
        <meshStandardMaterial color="#0f2a3a" emissive="#4fb7ff" emissiveIntensity={0.5} />
      </mesh>
      <Members members={cable} thick={0.06} color="#3b4452" />
      <Label3D position={[x, 1.45, 2.3]} always className="is-value">
        {text}
      </Label3D>
    </Selectable>
  )
}

function Source() {
  const h = useHighlight('source')
  const x = XA - 6.6
  return (
    <Selectable id="source">
      <mesh position={[x, 0.6, 0]}>
        <boxGeometry args={[1.1, 1.2, 1.4]} />
        <meshStandardMaterial color={tone(h, '#5d6a52')} roughness={0.8} />
      </mesh>
      {[-0.35, 0, 0.35].map((z) => (
        <mesh key={z} position={[x + 0.2, 1.45, z]}>
          <cylinderGeometry args={[0.05, 0.06, 0.5, 8]} />
          <meshStandardMaterial color={SCENE_COLORS.insulator} />
        </mesh>
      ))}
      <Label3D position={[x, 2.0, 0]}>G1 + T1 (source)</Label3D>
    </Selectable>
  )
}

function Busbar({ x, label, dead }: { x: number; label: string; dead?: boolean }) {
  const m: Member[] = PHASE_Z.map((z) => [
    [x - 0.5, 2.05, z],
    [x + 0.5, 2.05, z],
  ])
  const posts: Member[] = [
    [
      [x - 0.5, 0, 0],
      [x - 0.5, 2.05, 0],
    ],
    [
      [x + 0.5, 0, 0],
      [x + 0.5, 2.05, 0],
    ],
  ]
  return (
    <group>
      <Members members={posts} thick={0.07} color={SCENE_COLORS.steelDark} />
      <Members members={m} thick={0.06} color={dead ? DEAD : '#c9b27a'} />
      <Label3D position={[x, 2.75, 0]}>{label}</Label3D>
    </group>
  )
}

function FaultMarker({ c }: { c: DistanceCase }) {
  const h = useHighlight('fault')
  const x = xOfKm(c.fault.spec.km)
  const t = c.fault.spec.type
  const at = (k: number): V3 => [x, H_LINE - 0.05, PHASE_Z[k]]
  // phases involved: 3-phase a,b,c; L-G a; L-L and L-L-G b, c (Module 4's convention)
  const ks = t === '3ph' ? [0, 1, 2] : t === 'slg' ? [0] : [1, 2]
  const arcs: Member[] = []
  if (ks.length > 1) for (let i = 0; i + 1 < ks.length; i++) arcs.push([at(ks[i]), at(ks[i + 1])])
  if (t === 'slg' || t === 'dlg') arcs.push([at(ks[ks.length - 1]), [x + 0.25, 0, PHASE_Z[ks[ks.length - 1]] + 0.3]])
  return (
    <Selectable id="fault">
      {ks.map((k) => (
        <mesh key={k} position={at(k)}>
          <sphereGeometry args={[0.13, 14, 10]} />
          <meshStandardMaterial color={h === 'selected' ? SCENE_COLORS.selected : '#ff5a3d'} emissive="#ff5a3d" emissiveIntensity={0.9} />
        </mesh>
      ))}
      <Members members={arcs} thick={0.035} color="#ffb199" emissive="#ff7a3d" />
      <mesh position={[x, H_LINE - 0.05, 0]} visible={false}>
        <boxGeometry args={[0.8, 0.8, 1.4]} />
        <meshBasicMaterial />
      </mesh>
      <Label3D position={[x, H_LINE + 0.95, 0.9]} always className="is-value">
        Fault · {fx(c.fault.spec.km, 1)} km
      </Label3D>
    </Selectable>
  )
}

/** A translucent band over an isolated (de-energised) line. */
function Isolated({ x0, x1, text }: { x0: number; x1: number; text: string }) {
  return (
    <group>
      <mesh position={[(x0 + x1) / 2, H_LINE - 0.1, 0]}>
        <boxGeometry args={[x1 - x0, 0.8, 1.5]} />
        <meshStandardMaterial color="#fab219" transparent opacity={0.13} depthWrite={false} />
      </mesh>
      <Label3D position={[x0 + (x1 - x0) * 0.62, 0.35, 1.2]} always className="pr3-isolated">
        {text}
      </Label3D>
    </group>
  )
}

function Remote() {
  const h = useHighlight('remote')
  const x = (XB1 + XB2) / 2
  return (
    <Selectable id="remote">
      <mesh position={[x, 0.5, -2.1]}>
        <boxGeometry args={[1.0, 1.0, 0.9]} />
        <meshStandardMaterial color={tone(h, '#4f6b8a')} />
      </mesh>
      <Members
        members={[
          [
            [x, 1.0, -2.1],
            [x, 2.05, -0.6],
          ],
        ]}
        thick={0.05}
        color={SCENE_COLORS.steelDark}
      />
      <Label3D position={[x, 1.5, -2.6]}>Grid infeed at B</Label3D>
    </Selectable>
  )
}

function Ground() {
  return (
    <mesh position={[0, -0.05, 0]}>
      <boxGeometry args={[220, 0.1, 140]} />
      <meshStandardMaterial color={SCENE_COLORS.ground} roughness={1} />
    </mesh>
  )
}

/** Short connections through the bays (bus → breaker → CT → VT → line gantry), drawn at the conductors' height. */
const BAY_A: Member[] = PHASE_Z.map((z) => [
  [XA - 3.1, 2.05, z],
  [XA, H_LINE, z],
])
const BAY_B: Member[] = PHASE_Z.map((z) => [
  [XB1, H_LINE, z],
  [XB2, H_LINE, z],
])

export const SCENE_PARTS = (infeed: boolean): ScenePart[] => [
  { id: 'l1', name: 'Line L1 (protected)', what: '120 km of 220 kV overhead line from A to B — the line the relay at A protects.' },
  { id: 'ct', name: 'Current transformers', what: 'One per phase: they step the line current down (800 : 1) to a safe value for the relay.' },
  { id: 'vt', name: 'Voltage transformers', what: 'Capacitor voltage transformers: they step the 220 kV phase voltage down to 110 V (line to line) for the relay.' },
  { id: 'relay', name: 'Distance relay R_A', what: 'In the kiosk: it computes V/I from the CT and VT signals, compares the result with its zones, and trips CB A.' },
  { id: 'cbA', name: 'Breaker CB A', what: 'Opens line L1 at A when R_A trips. It interrupts the arc at a current zero.' },
  { id: 'fault', name: 'The fault', what: 'A short circuit you place along the route (type and resistance in the controls).' },
  { id: 'cbB1', name: 'Breaker CB B1', what: 'Opens line L1 at B, tripped by the relay at B looking back along L1.' },
  { id: 'cbB2', name: 'Breaker CB B2', what: 'Opens the next line L3 at B, tripped by the relay at B on L3.' },
  { id: 'l3', name: 'Line L3 (the next line)', what: '100 km of the same construction from B to C. Faults here belong to the relay at B.' },
  { id: 'source', name: 'Source behind A', what: 'Module 4’s generator G1 and step-up transformer T1: every fault on the route is fed from here.' },
  ...(infeed ? [{ id: 'remote', name: 'Grid infeed at B', what: 'A second source at B: faults on L1 are then fed from both ends.' }] : []),
]

export interface RouteSceneProps {
  c: DistanceCase
  selected: string | null
  onSelect(id: string | null): void
  fallback: ReactNode
  info?(id: string): ReactNode
  tour?: TourStep[]
  height?: number
  label?: string
}

/** Looking along the route from behind A: substation A in front, the line receding to B and C. */
export const CAM_HOME: { position: V3; target: V3 } = { position: [XA - 9, 5.2, 9.5], target: [-5, 1, 0] }
export const CAM_SUB_A: V3 = [XA - 9.5, 3.2, 3.6]
export const camAtKm = (km: number): V3 => {
  const x = xOfKm(km)
  return x < -5 ? [x - 5, 3.2, 5.5] : [x + 5, 3.2, 5.5]
}

export function RouteScene({ c, selected, onSelect, fallback, info, tour, height = 430, label = 'Line L1 between substations A and B, with the next line L3' }: RouteSceneProps) {
  const open = (id: CbId) => c.clearing.open[id] !== null
  const cleared = c.clearing.clearedS !== null
  const dead = c.clearing.dead
  const ra = c.decisions.RA
  const relayText = ra.z
    ? ra.zone
      ? `R_A: zone ${ra.zone} · ${c.clearing.reset.includes('RA') ? 'reset (cleared at B first)' : ra.tripS ? `trip ${fx(ra.tripS, 2)} s` : 'trip, no delay'}`
      : 'R_A: no zone · no trip'
    : 'R_A: no current'
  const isoL1 = dead.L1 && open('cbA')
  const isoL3 = dead.L3
  return (
    <Scene3D
      label={label}
      parts={SCENE_PARTS(c.fault.opts.infeed)}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: CAM_HOME.position, target: CAM_HOME.target, fov: 40 }}
      radius={18}
      fallback={fallback}
      info={info}
      tour={tour}
      height={height}
      deps={[c, selected]}
      kindNote="Geometry: the two line lengths and the fault position are to one scale. Calculated: breaker states, the relay’s zone and time, and the isolated sections. Equipment shapes, tower heights and sag are drawn for recognition (illustration)."
    >
      <Ground />
      <Source />
      <Members
        members={PHASE_Z.map((z) => [
          [XA - 6.0, 2.05, z],
          [XA - 3.3, 2.05, z],
        ])}
        thick={0.035}
        color="#c9b27a"
      />
      <Busbar x={XA - 3.6} label="Bus A" />
      <Members members={BAY_A} thick={0.035} color="#c9b27a" />
      <Members members={BAY_B} thick={0.035} color={cleared && dead.B ? DEAD : '#c9b27a'} />
      <Breaker id="cbA" x={XA - 3.0} open={open('cbA')} label="CB A" always />
      <InstrumentTransformers />
      <RelayKiosk text={relayText} />
      <Members members={gantryMembers(XA)} thick={0.08} color={SCENE_COLORS.steel} />
      <LineConductors id="l1" x0={XA} x1={XB1} km={L1_KM} dead={cleared && dead.L1} label={`L1 · ${L1_KM} km`} />
      <Members members={gantryMembers(XB1)} thick={0.08} color={SCENE_COLORS.steel} />
      <Breaker id="cbB1" x={XB1 + 0.55} open={open('cbB1')} label="CB B1" />
      <Busbar x={(XB1 + XB2) / 2} label="Bus B" dead={cleared && dead.B} />
      <Breaker id="cbB2" x={XB2 - 0.55} open={open('cbB2')} label="CB B2" />
      <Members members={gantryMembers(XB2)} thick={0.08} color={SCENE_COLORS.steel} />
      <LineConductors id="l3" x0={XB2} x1={XC} km={L3_KM} dead={cleared && dead.L3} label={`L3 · ${L3_KM} km`} />
      <Members members={gantryMembers(XC)} thick={0.08} color={SCENE_COLORS.steel} />
      <Label3D position={[XC, 2.95, 0]}>C</Label3D>
      {c.fault.opts.infeed && <Remote />}
      <FaultMarker c={c} />
      {cleared && isoL1 && <Isolated x0={XA} x1={XB1} text={dead.B ? 'De-energised: L1 and everything beyond A (no source at B)' : 'Isolated: L1'} />}
      {cleared && isoL3 && !isoL1 && <Isolated x0={XB2} x1={XC} text="Isolated: L3" />}
    </Scene3D>
  )
}
