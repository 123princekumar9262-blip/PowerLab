import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Label3D, Scene3D, SCENE_COLORS, Selectable, useHighlight, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { spanPoints, type SpanResult, type StringResult } from './calc.ts'
import { deg, DISC_DIA, DISC_PITCH, shareColor } from './shared.tsx'

/*
 * The 3D span: two lattice towers, the conductor drawn through the COMPUTED catenary points (with the wind's sideways
 * swing), its lowest point, the sag and ground-clearance dimension lines, the minimum-clearance line and an insulator
 * string at each tower whose discs are coloured by their COMPUTED share of the phase voltage.
 *
 * Scale: heights, sags, clearance and the swing are in true metres; the span is drawn shortened to SPAN_W units, so
 * the vertical is exaggerated by L / SPAN_W (stated on screen). The tower lattice, conductor thickness and insulator
 * string size are enlarged for recognition (also stated).
 */

type V3 = [number, number, number]
type Member = [V3, V3]

export const SPAN_W = 60
/** Cross-arm reach: the conductor hangs this far from the tower's centre line (drawn). */
const Z_ARM = 3.2
/** The insulator string is drawn this many times its real size. */
export const INS_SCALE = 3
/** The conductor is drawn with this radius (scene units) when bare. */
const R_DRAW = 0.11

export const stringDrawLen = (n: number) => n * DISC_PITCH * INS_SCALE
export const vExag = (L: number) => L / SPAN_W

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

/** Thin members (boxes) between point pairs, one draw call. */
function Members({ members, thick, color }: { members: Member[]; thick: number; color: string }) {
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
    m.computeBoundingBox()
  }, [members, thick])
  return (
    <instancedMesh key={members.length} ref={ref} args={[undefined, undefined, Math.max(1, members.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
    </instancedMesh>
  )
}

const tone = (h: ReturnType<typeof useHighlight>, base: string) =>
  h === 'selected' ? SCENE_COLORS.selected : h === 'hovered' ? SCENE_COLORS.hovered : h === 'dim' ? new THREE.Color(base).multiplyScalar(0.45).getStyle() : base

/** A lattice tower at x with its cross-arm reaching to z = Z_ARM at height armY. */
function towerMembers(x: number, armY: number): Member[] {
  const H = armY + 1.4
  const hw = (y: number) => 2.2 + ((0.75 - 2.2) * y) / H
  const cs: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  const c = (y: number, sx: number, sz: number): V3 => [x + sx * hw(y), y, sz * hw(y)]
  const out: Member[] = []
  for (const [a, b] of cs) out.push([c(0, a, b), c(H, a, b)])
  const levels = Math.max(4, Math.round(H / 3))
  for (let i = 0; i <= levels; i++) {
    const y = (H * i) / levels
    for (let k = 0; k < 4; k++) out.push([c(y, ...cs[k]), c(y, ...cs[(k + 1) % 4])])
    if (i < levels) {
      const y2 = (H * (i + 1)) / levels
      for (let k = 0; k < 4; k++) out.push([c(y, ...cs[k]), c(y2, ...cs[(k + 1) % 4])])
    }
  }
  // peak
  out.push([c(H, -1, -1), [x, H + 1.6, 0]], [c(H, 1, 1), [x, H + 1.6, 0]], [c(H, 1, -1), [x, H + 1.6, 0]], [c(H, -1, 1), [x, H + 1.6, 0]])
  // cross-arms towards +z (this conductor) and a stub towards −z (the other side of the tower)
  const w = hw(armY)
  for (const s of [1, -1]) {
    const tip: V3 = [x, armY, s * (Z_ARM + 0.3)]
    out.push(
      [[x - w, armY, s * w], tip],
      [[x + w, armY, s * w], tip],
      [[x, armY + 1.1, s * w], tip],
      [
        [x - w, armY, s * w],
        [x, armY + 1.1, s * w],
      ],
      [
        [x + w, armY, s * w],
        [x, armY + 1.1, s * w],
      ],
    )
  }
  return out
}

function Towers({ hA, h, sLen }: { hA: number; h: number; sLen: number }) {
  const hl = useHighlight('towers')
  const members = useMemo(() => [...towerMembers(-SPAN_W / 2, hA + sLen), ...towerMembers(SPAN_W / 2, hA + h + sLen)], [hA, h, sLen])
  return (
    <Selectable id="towers">
      <Members members={members} thick={0.14} color={tone(hl, SCENE_COLORS.steel)} />
      <Label3D position={[-SPAN_W / 2 - 4.8, 1.2, 0]}>Tower A</Label3D>
      <Label3D position={[SPAN_W / 2 + 4.8, 1.2, 0]}>Tower B</Label3D>
    </Selectable>
  )
}

function Ground() {
  const h = useHighlight('ground')
  return (
    <Selectable id="ground">
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[260, 0.1, 160]} />
        <meshStandardMaterial color={h === 'selected' ? '#2c3a2a' : h === 'hovered' ? '#25302a' : SCENE_COLORS.ground} roughness={1} />
      </mesh>
    </Selectable>
  )
}

function Disc({ k, pos, color }: { k: number; pos: V3; color: string }) {
  const id = `disc-${k}`
  const h = useHighlight(id)
  const r = (DISC_DIA / 2) * INS_SCALE
  return (
    <Selectable id={id}>
      <mesh position={pos}>
        <cylinderGeometry args={[r, r * 0.55, 0.06 * INS_SCALE, 20]} />
        <meshStandardMaterial
          color={h === 'selected' ? SCENE_COLORS.selected : h === 'dim' ? new THREE.Color(color).multiplyScalar(0.55).getStyle() : color}
          emissive={h === 'selected' || h === 'hovered' ? SCENE_COLORS.selected : '#000000'}
          emissiveIntensity={h === 'selected' ? 0.35 : h === 'hovered' ? 0.15 : 0}
          roughness={0.35}
          metalness={0.05}
        />
      </mesh>
    </Selectable>
  )
}

/** The insulator string at one tower: n discs, top (cross-arm) first, hanging from armY down to the conductor. */
function InsulatorString({ x, attachY, n, str, labelled }: { x: number; attachY: number; n: number; str: StringResult | null; labelled: boolean }) {
  const pitch = DISC_PITCH * INS_SCALE
  const top = attachY + n * pitch
  const rod: Member[] = useMemo(
    () => [
      [
        [x, attachY - 0.15, Z_ARM],
        [x, top + 0.05, Z_ARM],
      ],
    ],
    [x, attachY, top],
  )
  return (
    <group>
      <Members members={rod} thick={0.07} color={SCENE_COLORS.steelDark} />
      {Array.from({ length: n }, (_, i) => {
        const k = i + 1
        const y = top - (i + 0.5) * pitch
        const col = str ? shareColor(str.discV[i] / (str.V / n)) : SCENE_COLORS.insulator
        return <Disc key={k} k={k} pos={[x, y, Z_ARM]} color={col} />
      })}
      {labelled && str && (
        <>
          <Label3D position={[x - 2.4, top + 1.0, Z_ARM]} className="is-value">
            disc 1 · {fx((str.discV[0] / str.V) * 100, 1)} %
          </Label3D>
          <Label3D position={[x - 2.4, attachY - 1.3, Z_ARM]} className="is-value">
            disc {n} · {fx((str.discV[n - 1] / str.V) * 100, 1)} %
          </Label3D>
        </>
      )}
    </group>
  )
}

function Conductor({ res }: { res: SpanResult }) {
  const h = useHighlight('conductor')
  const L = res.input.L
  const geo = useMemo(() => {
    const pts = spanPoints(res, 140).cat.map((p) => new THREE.Vector3((p[0] / L - 0.5) * SPAN_W, p[1], Z_ARM + p[2]))
    const curve = new THREE.CatmullRomCurve3(pts)
    const r = R_DRAW * (res.loads.dIce / res.input.d)
    return { tube: new THREE.TubeGeometry(curve, 160, r, 10, false), hit: new THREE.TubeGeometry(curve, 60, Math.max(0.7, r * 3), 5, false) }
  }, [res, L])
  useLayoutEffect(
    () => () => {
      geo.tube.dispose()
      geo.hit.dispose()
    },
    [geo],
  )
  const iced = res.input.iceT > 0
  const base = iced ? '#dcecff' : '#c3cad3'
  return (
    <Selectable id="conductor">
      <mesh geometry={geo.tube}>
        <meshStandardMaterial
          color={tone(h, base)}
          metalness={iced ? 0.05 : 0.55}
          roughness={iced ? 0.25 : 0.4}
          emissive={h === 'selected' ? SCENE_COLORS.selected : '#000000'}
          emissiveIntensity={h === 'selected' ? 0.25 : 0}
        />
      </mesh>
      <mesh geometry={geo.hit} visible={false}>
        <meshBasicMaterial />
      </mesh>
    </Selectable>
  )
}

function LowPoint({ res }: { res: SpanResult }) {
  const h = useHighlight('low')
  const p: V3 = [(res.low.x / res.input.L - 0.5) * SPAN_W, res.low.y, Z_ARM + res.low.z]
  return (
    <Selectable id="low">
      <mesh position={p}>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshStandardMaterial color={h === 'selected' ? SCENE_COLORS.selected : SCENE_COLORS.warn} emissive={SCENE_COLORS.warn} emissiveIntensity={h === 'selected' ? 0.2 : 0.35} />
      </mesh>
    </Selectable>
  )
}

/** Dimension lines: sag(s), the swing in the load plane, the ground clearance, the minimum clearance and the span. */
function Dimensions({ res }: { res: SpanResult }) {
  const s = res.input
  const L = s.L
  const X = (x: number) => (x / L - 0.5) * SPAN_W
  const xl = X(res.low.x)
  const zl = Z_ARM + res.low.z
  const yl = res.low.y
  const level = s.h === 0
  const wind = res.loads.theta > 1e-9
  const bad = res.clearance < s.minClear
  const lines = useMemo(() => {
    const ref: Member[] = [
      [
        [X(0), s.hA, Z_ARM],
        [xl, s.hA, zl],
      ],
    ]
    const sag: Member[] = []
    if (res.vSagA > 1e-6)
      sag.push([
        [xl, s.hA, zl],
        [xl, yl, zl],
      ])
    if (!level) {
      ref.push([
        [X(L), s.hA + s.h, Z_ARM],
        [xl + 0.7, s.hA + s.h, zl],
      ])
      sag.push([
        [xl + 0.7, s.hA + s.h, zl],
        [xl + 0.7, yl, zl],
      ])
    }
    const swing: Member[] =
      wind && level
        ? [
            [
              [xl, s.hA, Z_ARM],
              [xl, yl, zl],
            ],
          ]
        : []
    const clear: Member[] = [
      [
        [xl, yl, zl],
        [xl, 0.02, zl],
      ],
    ]
    const minc: Member[] = [
      [
        [X(0), s.minClear, zl],
        [X(L), s.minClear, zl],
      ],
    ]
    const span: Member[] = [
      [
        [X(0), 0.08, Z_ARM + 7],
        [X(L), 0.08, Z_ARM + 7],
      ],
      [
        [X(0), 0.08, Z_ARM + 6],
        [X(0), 0.08, Z_ARM + 8],
      ],
      [
        [X(L), 0.08, Z_ARM + 6],
        [X(L), 0.08, Z_ARM + 8],
      ],
    ]
    return { ref, sag, swing, clear, minc, span }
  }, [res]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <Members members={lines.ref} thick={0.05} color="#5d6878" />
      {lines.sag.length > 0 && <Members members={lines.sag} thick={0.09} color={SCENE_COLORS.accent} />}
      {lines.swing.length > 0 && <Members members={lines.swing} thick={0.07} color="#9ec5ff" />}
      <Members members={lines.clear} thick={0.09} color={bad ? '#e66767' : SCENE_COLORS.good} />
      <Members members={lines.minc} thick={0.06} color={bad ? '#e66767' : '#6b7685'} />
      <Members members={lines.span} thick={0.07} color="#6b7685" />
      {res.vSagA > 1e-6 && (
        <Label3D position={[xl - 3.4, (s.hA + yl) / 2, zl]} className="is-value">
          {level ? 'sag' : 'S₁'} {fx(res.vSagA, 2)} m{wind && level ? ' (vertical)' : ''}
        </Label3D>
      )}
      {!level && (
        <Label3D position={[xl + 4.2, (s.hA + s.h + yl) / 2, zl]} className="is-value">
          S₂ {fx(res.vSagB, 2)} m
        </Label3D>
      )}
      {wind && level && (
        <Label3D position={[xl, s.hA + 1.6, Z_ARM + res.low.z / 2]} className="is-value">
          swing θ {fx(deg(res.loads.theta), 1)}° · {fx(res.low.z, 2)} m sideways
        </Label3D>
      )}
      <Label3D position={[xl + 4.4, yl / 2, zl]} className="is-value" always>
        clearance {fx(res.clearance, 2)} m
      </Label3D>
      <Label3D position={[X(res.low.x < L / 2 ? L * 0.8 : L * 0.2), s.minClear + 0.9, zl]}>min {fx(s.minClear, 1)} m</Label3D>
      <Label3D position={[0, 0.3, Z_ARM + 7]} className="is-value">
        span {fx(L, 0)} m
      </Label3D>
    </group>
  )
}

/** Frame the span again when the towers' heights change (not while the span or tension is dragged). */
function AutoFrame({ frame, position, target }: { frame: number; position: V3; target: V3 }) {
  const camera = useThree((st) => st.camera)
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  const invalidate = useThree((st) => st.invalidate)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    camera.position.set(...position)
    controls?.target.set(...target)
    controls?.update()
    invalidate()
  }, [frame]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export interface SpanSceneProps {
  /** Geometry to draw even when the span cannot be solved (towers, string). */
  geom: { L: number; hA: number; h: number; n: number }
  res: SpanResult | null
  str: StringResult | null
  selected: string | null
  onSelect(id: string | null): void
  fallback: ReactNode
  info?(id: string): ReactNode
  tour?: TourStep[]
  height?: number
  label?: string
}

export function sceneCamera(geom: SpanSceneProps['geom']) {
  const top = geom.hA + geom.h + stringDrawLen(geom.n) + 1.6
  const target: V3 = [0, top * 0.44, Z_ARM]
  const dist = Math.max(43, top * 1.65 + 4)
  const position: V3 = [8, top * 0.55 + 5, Z_ARM + dist]
  return { target, position, top }
}

/** A camera position that looks at the string of tower A from just outside it (the scene's target stays behind). */
export function stringCamera(geom: SpanSceneProps['geom'], dist: number, discK?: number): V3 {
  const { target } = sceneCamera(geom)
  const pitch = DISC_PITCH * INS_SCALE
  const top = geom.hA + geom.n * pitch
  const y = discK ? top - (discK - 0.5) * pitch : geom.hA + (geom.n * pitch) / 2
  const S = new THREE.Vector3(-SPAN_W / 2, y, Z_ARM)
  const T = new THREE.Vector3(...target)
  const d = S.clone().sub(T).normalize()
  const p = S.clone()
    .add(d.multiplyScalar(dist))
    .add(new THREE.Vector3(0, 0.6, 1.4))
  return [p.x, p.y, p.z]
}

export function SpanScene({ geom, res, str, selected, onSelect, fallback, info, tour, height = 440, label = 'One span of an overhead line between two towers' }: SpanSceneProps) {
  const n = geom.n
  const sLen = stringDrawLen(n)
  const parts: ScenePart[] = [
    { id: 'towers', name: 'Towers', what: 'Earthed steel lattice towers. Each holds the conductor at its support point through an insulator string.' },
    { id: 'conductor', name: 'Conductor', what: 'Hangs under its own weight (plus any ice and wind) in a catenary; its tension pulls on the towers.' },
    { id: 'low', name: 'Lowest point', what: 'Where the conductor is closest to the ground — the point that sets the ground clearance.' },
    { id: 'ground', name: 'Ground', what: 'The clearance from the lowest point to the ground must stay above the minimum the designer sets.' },
    ...Array.from({ length: n }, (_, i) => ({
      id: `disc-${i + 1}`,
      name: `Disc ${i + 1}${i === 0 ? ' · cross-arm end' : i === n - 1 ? ' · line end' : ''}`,
      what: 'A porcelain or glass disc: a capacitor between its metal cap and pin. The discs share the phase voltage — unequally.',
    })),
  ]
  const cam = sceneCamera(geom)
  const conductorThick = res ? R_DRAW / (res.input.d / 2) : null
  const ex = vExag(geom.L)
  const scaleText =
    Math.abs(ex - 1) < 0.05
      ? `the span is drawn at true scale (${fx(geom.L, 0)} m shown as ${SPAN_W} units)`
      : ex > 1
        ? `the span is drawn shortened (${fx(geom.L, 0)} m shown as ${SPAN_W} units), so the vertical is exaggerated ×${fx(ex, 1)} against the horizontal`
        : `the span is drawn lengthened (${fx(geom.L, 0)} m shown as ${SPAN_W} units), so the vertical is compressed ×${fx(ex, 2)} against the horizontal`
  const kind = `Heights, sag, clearance and the wind swing are in true metres; ${scaleText}. The lattice, the conductor's thickness${conductorThick ? ` (×${fx(conductorThick, 0)}${res && res.input.iceT > 0 ? ', ice to the same scale' : ''})` : ''} and the insulator strings (×${INS_SCALE}) are enlarged for recognition; disc colours are the computed voltage shares.`
  return (
    <Scene3D
      label={label}
      parts={parts}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: cam.position, target: cam.target, fov: 40 }}
      radius={Math.max(34, cam.top * 0.7)}
      fallback={fallback}
      info={info}
      tour={tour}
      height={height}
      deps={[res, str, geom.L, geom.hA, geom.h, n, selected]}
      kindNote={kind}
    >
      <AutoFrame frame={Math.round(cam.top / 4)} position={cam.position} target={cam.target} />
      <Ground />
      <Towers hA={geom.hA} h={geom.h} sLen={sLen} />
      <InsulatorString x={-SPAN_W / 2} attachY={geom.hA} n={n} str={str} labelled />
      <InsulatorString x={SPAN_W / 2} attachY={geom.hA + geom.h} n={n} str={str} labelled={false} />
      {res && <Conductor res={res} />}
      {res && <LowPoint res={res} />}
      {res && <Dimensions res={res} />}
    </Scene3D>
  )
}
