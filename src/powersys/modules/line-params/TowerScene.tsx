import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Label3D, Scene3D, SCENE_COLORS, Selectable, useHighlight, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { bundleOffsets, bundleRadius, PHASES, type Design, type LineResult, type PhaseIndex } from './calc.ts'

/*
 * The 3D tower: a steel lattice tower with cross-arms, insulator strings and the three phase bundles, built from the
 * design's cross-section (GEOMETRY — positions to scale), with the spacings and heights the calculation uses drawn as
 * dimension lines and the computed L and C in the info panel (CALCULATED). Insulator length, conductor thickness and
 * the lattice are drawn for recognition (illustration); sag is not drawn.
 */

type V3 = [number, number, number]
type Member = [V3, V3]

export const PART_IDS = ['pa', 'pb', 'pc', 'ins', 'tower', 'ground'] as const
export const phaseOfPart = (id: string | null): PhaseIndex | null => (id === 'pa' ? 0 : id === 'pb' ? 1 : id === 'pc' ? 2 : null)
export const partOfPhase = (k: PhaseIndex) => (['pa', 'pb', 'pc'] as const)[k]

const PHASE_COLOR = [SCENE_COLORS.phaseA, SCENE_COLORS.phaseB, SCENE_COLORS.phaseC]
const BASE_W = 7
const TOP_W = 1.8
const ARM_H = 1.6
/** z of the plane where dimensions are drawn (in front of the tower, along the conductors). */
const ZDIM = 27
const Z_NEAR = 34
const Z_FAR = -34
const TOWER_Z = [22, -22]
const Z0 = [0]

/** Insulator string length drawn for a voltage (an illustration of scale, not a design value). */
export const insulatorLength = (kv: number) => Math.min(6.5, Math.max(1.2, 0.6 + 0.0072 * kv))

interface Hang {
  /** Bundle centre. */
  x: number
  y: number
  /** 'string': hangs from an arm at yA; 'post': stands on the tower top. */
  kind: 'string' | 'post'
  yA: number
}

interface TowerGeo {
  top: number
  body: Member[]
  arms: Member[]
  hangs: Hang[]
}

export function towerGeometry(d: Design): TowerGeo {
  const g = d.geometry
  const L = insulatorLength(d.options.kv)
  const rb = bundleRadius(g.n, g.dM)
  const hwAt = (y: number, H: number) => (BASE_W + ((TOP_W - BASE_W) * Math.min(y, H)) / H) / 2
  // which conductors could stand on posts on the tower top (near the centre line, above every arm)
  const sideTop = (H: number) => Math.max(0, ...g.phases.filter((p) => Math.abs(p.x) > hwAt(p.y + L, H) + 0.6).map((p) => p.y + L + ARM_H))
  let H = Math.max(8, sideTop(40) + 2.5)
  const centre = g.phases.filter((p) => Math.abs(p.x) <= TOP_W / 2 + 0.6)
  const postTop = centre.length ? Math.min(...centre.map((p) => p.y - rb - 0.75 * L)) : Infinity
  const usePosts = centre.length > 0 && postTop >= sideTop(40) + 0.3
  if (usePosts) H = postTop
  for (let it = 0; it < 3; it++) H = usePosts ? postTop : Math.max(8, sideTop(H) + 2.5)
  const hangs: Hang[] = g.phases.map((p) => {
    const isPost = usePosts && Math.abs(p.x) <= TOP_W / 2 + 0.6
    return { x: p.x, y: p.y, kind: isPost ? 'post' : 'string', yA: isPost ? H : p.y + rb + L }
  })
  // the body: four legs, rings and X-bracing
  const body: Member[] = []
  const levels = Math.max(4, Math.round(H / 3.2))
  const corner = (y: number, sx: number, sz: number): V3 => {
    const hw = hwAt(y, H)
    return [sx * hw, y, sz * hw]
  }
  const cs: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  for (const [a, b] of cs) body.push([corner(0, a, b), corner(H, a, b)])
  for (let i = 0; i <= levels; i++) {
    const y = (H * i) / levels
    for (let c = 0; c < 4; c++) body.push([corner(y, ...cs[c]), corner(y, ...cs[(c + 1) % 4])])
    if (i < levels) {
      const y2 = (H * (i + 1)) / levels
      for (let c = 0; c < 4; c++) {
        body.push([corner(y, ...cs[c]), corner(y2, ...cs[(c + 1) % 4])])
        body.push([corner(y, ...cs[(c + 1) % 4]), corner(y2, ...cs[c])])
      }
    }
  }
  // a short peak on top
  if (!usePosts)
    body.push(
      [
        [0, H, 0],
        [0, H + 1.6, 0],
      ],
      [corner(H, -1, -1), [0, H + 1.6, 0]],
      [corner(H, 1, 1), [0, H + 1.6, 0]],
      [corner(H, 1, -1), [0, H + 1.6, 0]],
      [corner(H, -1, 1), [0, H + 1.6, 0]],
    )
  // cross-arms
  const arms: Member[] = []
  for (const h of hangs) {
    if (h.kind === 'post') continue
    const hw = hwAt(h.yA, H)
    const s = h.x >= 0 ? 1 : -1
    const root = s * hw
    if (Math.abs(h.x) <= hw + 0.2) {
      // inside the body outline: a beam across the tower
      arms.push([
        [-hw, h.yA, 0],
        [hw, h.yA, 0],
      ])
      continue
    }
    const tip: V3 = [h.x, h.yA, 0]
    const topRoot: V3 = [root, h.yA + ARM_H, 0]
    arms.push([[root, h.yA, -hw], tip], [[root, h.yA, hw], tip], [topRoot, tip], [[root, h.yA, -hw], topRoot], [[root, h.yA, hw], topRoot])
    // lacing
    const n = Math.max(1, Math.round(Math.abs(h.x - root) / 2))
    for (let i = 1; i < n; i++) {
      const f = i / n
      const bx = root + (h.x - root) * f
      const tz = hw * (1 - f)
      const ty = h.yA + ARM_H * (1 - f)
      arms.push(
        [
          [bx, h.yA, -tz],
          [bx, ty, 0],
        ],
        [
          [bx, h.yA, tz],
          [bx, ty, 0],
        ],
      )
    }
  }
  return { top: H, body, arms, hangs }
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

/** Thin members (boxes) between point pairs, one draw call. */
function Members({ members, thick, color, zs = Z0 }: { members: Member[]; thick: number; color: string; zs?: number[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = members.length * zs.length
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    let i = 0
    for (const z of zs)
      for (const [a, b] of members) {
        const va = new THREE.Vector3(a[0], a[1], a[2] + z)
        const vb = new THREE.Vector3(b[0], b[1], b[2] + z)
        const dir = vb.clone().sub(va)
        const len = Math.max(dir.length(), 1e-6)
        tmpQ.setFromUnitVectors(UP, dir.normalize())
        tmpM.compose(va.add(vb).multiplyScalar(0.5), tmpQ, new THREE.Vector3(thick, len, thick))
        m.setMatrixAt(i++, tmpM)
      }
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
    m.computeBoundingBox()
  }, [members, thick, zs])
  return (
    <instancedMesh key={count} ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
    </instancedMesh>
  )
}

const tone = (h: ReturnType<typeof useHighlight>, base: string) =>
  h === 'selected' ? SCENE_COLORS.selected : h === 'hovered' ? SCENE_COLORS.hovered : h === 'dim' ? new THREE.Color(base).multiplyScalar(0.45).getStyle() : base

function Tower({ geo }: { geo: TowerGeo }) {
  const h = useHighlight('tower')
  return (
    <Selectable id="tower">
      <Members members={geo.body} thick={0.16} color={tone(h, SCENE_COLORS.steel)} zs={TOWER_Z} />
      <Members members={geo.arms} thick={0.13} color={tone(h, SCENE_COLORS.steel)} zs={TOWER_Z} />
    </Selectable>
  )
}

function Insulators({ geo, design }: { geo: TowerGeo; design: Design }) {
  const h = useHighlight('ins')
  const g = design.geometry
  const rb = bundleRadius(g.n, g.dM)
  const discs = useMemo(() => {
    const out: Member[] = []
    for (const hg of geo.hangs) {
      const yTop = hg.kind === 'post' ? geo.top : hg.yA
      const yBot = hg.kind === 'post' ? hg.y - rb - 0.15 : hg.y + rb + 0.15
      const n = Math.max(4, Math.round(Math.abs(yTop - yBot) / 0.2))
      for (let i = 0; i < n; i++) {
        const y = yBot + ((yTop - yBot) * (i + 0.5)) / n
        out.push([
          [hg.x, y - 0.035, 0],
          [hg.x, y + 0.035, 0],
        ])
      }
    }
    return out
  }, [geo, rb])
  const rods = useMemo(() => geo.hangs.map((hg) => [[hg.x, hg.kind === 'post' ? geo.top : hg.yA, 0] as V3, [hg.x, hg.kind === 'post' ? hg.y - rb : hg.y + rb, 0] as V3] as Member), [geo, rb])
  return (
    <Selectable id="ins">
      <Members members={discs} thick={0.34} color={tone(h, SCENE_COLORS.insulator)} zs={TOWER_Z} />
      <Members members={rods} thick={0.05} color={tone(h, SCENE_COLORS.steelDark)} zs={TOWER_Z} />
    </Selectable>
  )
}

function Phase({ k, design }: { k: PhaseIndex; design: Design }) {
  const id = partOfPhase(k)
  const h = useHighlight(id)
  const g = design.geometry
  const p = g.phases[k]
  const off = bundleOffsets(g.n, g.dM)
  const rDraw = Math.max(g.rM, 0.06)
  const len = Z_NEAR - Z_FAR
  const zMid = (Z_NEAR + Z_FAR) / 2
  const color = tone(h, PHASE_COLOR[k])
  // bundle spacers every 12 m and a yoke at each tower
  const spacers = useMemo(() => {
    if (g.n === 1) return [] as Member[]
    const out: Member[] = []
    for (let z = Z_FAR + 5; z < Z_NEAR; z += 11)
      for (let j = 0; j < off.length; j++) {
        const a = off[j]
        const b = off[(j + 1) % off.length]
        if (off.length === 2 && j === 1) continue
        out.push([
          [p.x + a.x, p.y + a.y, z],
          [p.x + b.x, p.y + b.y, z],
        ])
      }
    return out
  }, [g.n, off, p.x, p.y])
  return (
    <Selectable id={id}>
      {off.map((o, j) => (
        <mesh key={j} position={[p.x + o.x, p.y + o.y, zMid]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[rDraw, rDraw, len, 8]} />
          <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} emissive={h === 'selected' ? SCENE_COLORS.selected : '#000000'} emissiveIntensity={h === 'selected' ? 0.25 : 0} />
        </mesh>
      ))}
      {spacers.length > 0 && <Members members={spacers} thick={0.05} color={SCENE_COLORS.steelDark} />}
      {/* a fat invisible hit target so the thin conductors are easy to pick */}
      <mesh position={[p.x, p.y, zMid]} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <cylinderGeometry args={[Math.max(0.6, bundleRadius(g.n, g.dM) + 0.4), Math.max(0.6, bundleRadius(g.n, g.dM) + 0.4), len, 6]} />
        <meshBasicMaterial />
      </mesh>
      <Label3D position={[p.x - 1.6, p.y + 1.1, ZDIM]}>{PHASES[k]}</Label3D>
    </Selectable>
  )
}

function Ground() {
  const h = useHighlight('ground')
  return (
    <Selectable id="ground">
      <mesh position={[0, -0.05, -60]}>
        <boxGeometry args={[400, 0.1, 400]} />
        <meshStandardMaterial color={h === 'selected' ? '#2c3a2a' : h === 'hovered' ? '#25302a' : SCENE_COLORS.ground} roughness={1} />
      </mesh>
    </Selectable>
  )
}

/** Dimension lines: the phase spacings (GMD) and each phase's height above the ground. */
function Dimensions({ design, res, selected }: { design: Design; res: LineResult; selected: PhaseIndex | null }) {
  const g = design.geometry
  const pairs: Array<[PhaseIndex, PhaseIndex, string, number]> = [
    [0, 1, 'D_ab', res.dab],
    [1, 2, 'D_bc', res.dbc],
    [2, 0, 'D_ca', res.dca],
  ]
  const lines = useMemo(() => {
    const spans: Member[] = []
    const hl: Member[] = []
    for (const [i, j] of pairs) {
      const m: Member = [
        [g.phases[i].x, g.phases[i].y, ZDIM],
        [g.phases[j].x, g.phases[j].y, ZDIM],
      ]
      if (selected !== null && (i === selected || j === selected)) hl.push(m)
      else spans.push(m)
    }
    const heights: Member[] = g.phases.map((p) => [
      [p.x, 0, ZDIM],
      [p.x, p.y, ZDIM],
    ])
    return { spans, hl, heights }
  }, [g.phases, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  // a collinear pair (flat or vertical) puts its label beside the others; otherwise labels sit outside the triangle
  const cx = (g.phases[0].x + g.phases[1].x + g.phases[2].x) / 3
  const cy = (g.phases[0].y + g.phases[1].y + g.phases[2].y) / 3
  const labelFor = (i: PhaseIndex, j: PhaseIndex): V3 => {
    const a = g.phases[i]
    const b = g.phases[j]
    const mid: V3 = [(a.x + b.x) / 2, (a.y + b.y) / 2, ZDIM]
    const third = g.phases[3 - i - j]
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1
    const t = ((third.x - a.x) * (b.x - a.x) + (third.y - a.y) * (b.y - a.y)) / len2
    const offLine = Math.abs((b.x - a.x) * (third.y - a.y) - (b.y - a.y) * (third.x - a.x)) / Math.sqrt(len2)
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x) * 3
    if (offLine < 1.2) {
      const between = t > 0 && t < 1
      if (between) return vertical ? [mid[0] + 3.6, mid[1], ZDIM] : [mid[0], mid[1] + 2.6, ZDIM]
      return vertical ? [mid[0] + 1.9, mid[1], ZDIM] : [mid[0], mid[1] - 1.1, ZDIM]
    }
    const dx = mid[0] - cx
    const dy = mid[1] - cy
    const n = Math.hypot(dx, dy) || 1
    return [mid[0] + (dx / n) * 1.6, mid[1] + (dy / n) * 1.6, ZDIM]
  }
  return (
    <group>
      <Members members={lines.spans} thick={0.05} color={SCENE_COLORS.accent} />
      {lines.hl.length > 0 && <Members members={lines.hl} thick={0.08} color={SCENE_COLORS.selected} />}
      <Members members={lines.heights} thick={0.035} color="#5d6878" />
      {pairs.map(([i, j, name, v]) => (
        <Label3D key={name} position={labelFor(i, j)} className="is-value">
          {name.replace('_', '')} {fx(v, 2)} m
        </Label3D>
      ))}
      {g.phases.map((p, k) => {
        const stacked = g.phases.some((q, j) => j !== k && Math.abs(q.x - p.x) < 3 && q.y < p.y)
        if (stacked) return null
        return (
          <Label3D key={`h${k}`} position={[p.x, p.y * 0.45, ZDIM]} className="is-value">
            h {fx(p.y, 1)} m
          </Label3D>
        )
      })}
    </group>
  )
}

/** Frame the tower again when the arrangement changes (not while the student drags a phase). */
function AutoFrame({ frame, position, target }: { frame: string; position: V3; target: V3 }) {
  const camera = useThree((st) => st.camera)
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  const invalidate = useThree((st) => st.invalidate)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (frame === 'custom') return
    camera.position.set(...position)
    controls?.target.set(...target)
    controls?.update()
    invalidate()
  }, [frame]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export interface TowerSceneProps {
  design: Design
  res: LineResult | null
  selected: string | null
  onSelect(id: string | null): void
  fallback: ReactNode
  info?(id: string): ReactNode
  tour?: TourStep[]
  height?: number
  label?: string
}

export function TowerScene({ design, res, selected, onSelect, fallback, info, tour, height = 430, label = 'Transmission tower and its three phase conductors' }: TowerSceneProps) {
  const geo = useMemo(() => towerGeometry(design), [design])
  const g = design.geometry
  const parts: ScenePart[] = [
    { id: 'pa', name: 'Phase a conductor', what: g.n > 1 ? `A bundle of ${g.n} sub-conductors held apart by spacers; together they carry phase a.` : 'One conductor carries phase a.' },
    { id: 'pb', name: 'Phase b conductor', what: g.n > 1 ? `A bundle of ${g.n} sub-conductors (phase b).` : 'One conductor carries phase b.' },
    { id: 'pc', name: 'Phase c conductor', what: g.n > 1 ? `A bundle of ${g.n} sub-conductors (phase c).` : 'One conductor carries phase c.' },
    { id: 'ins', name: 'Insulator strings', what: 'Chains of glass or porcelain discs that hold each conductor while keeping it insulated from the earthed tower.' },
    { id: 'tower', name: 'Tower and cross-arms', what: 'An earthed steel lattice. Its shape fixes where the conductors are — and so the line’s inductance and capacitance.' },
    { id: 'ground', name: 'Ground (earth)', what: 'The earth below is a conductor too: it changes the electric field around the line (capacitance).' },
  ]
  const sel = phaseOfPart(selected)
  const top = Math.max(geo.top, ...g.phases.map((p) => p.y))
  const midY = top * 0.5 + 1
  const dist = Math.max(57, top * 1.72 + 22, (Math.max(...g.phases.map((p) => Math.abs(p.x))) + 6) * 2.3)
  const xs = g.phases.map((p) => p.x)
  const narrow = Math.max(...xs) - Math.min(...xs) < 4
  const camPos: V3 = narrow ? [dist * 0.5, midY + dist * 0.12, dist * 0.88] : [dist * 0.19, midY + dist * 0.14, dist]
  const camTarget: V3 = [0, midY - 1.5, 0]
  return (
    <Scene3D
      label={label}
      parts={parts}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: camPos, target: camTarget, fov: 40 }}
      radius={18}
      fallback={fallback}
      info={info}
      tour={tour}
      height={height}
      deps={[design, res, selected]}
      kindNote="Positions, bundle layout and the dimension lines are the model’s geometry, to scale. Conductor thickness, insulator length and the lattice are drawn for recognition; sag is not drawn — the heights are the average heights used in the calculation."
    >
      <AutoFrame frame={design.arrangement} position={camPos} target={camTarget} />
      <Ground />
      <Tower geo={geo} />
      <Insulators geo={geo} design={design} />
      {([0, 1, 2] as PhaseIndex[]).map((k) => (
        <Phase key={k} k={k} design={design} />
      ))}
      {res && <Dimensions design={design} res={res} selected={sel} />}
    </Scene3D>
  )
}
