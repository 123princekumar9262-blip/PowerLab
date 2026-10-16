import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { Label3D, Scene3D, SCENE_COLORS, Selectable, useHighlight, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { stressAt, type CableResult } from './calc.ts'
import { stressRgb } from './scale.ts'
import { CABLE_PARTS, layerSpecs, probeValues, type LayerId, type LayerSpec } from './shared.tsx'

/*
 * The cable in 3D, laid along x. GEOMETRY to scale: r and R (and the probe radius). CALCULATED: the insulation's
 * colour (the computed radial stress, on the colour scale below the scene) and the probe's values. Illustration: the
 * thickness of the screens, sheath, bedding, armour and serving, the armour wires and the strip-back lengths.
 *
 * Two views: "assembled" — the whole cable with a quarter cut away over its front half, so the layers are seen to
 * scale on the cut faces; "stepped" — each layer stripped back further than the one inside it (the way a cable is
 * prepared for a joint), so every layer is exposed. Any layer can be hidden.
 *
 * Scene units: centimetres.
 */

export type CableView = 'assembled' | 'stepped'
type V3 = [number, number, number]
type RGB = [number, number, number]

/** A point at axial position x, radius ρ, angle θ (θ = 0 straight up, θ = π/2 towards the viewer). */
const P = (x: number, rho: number, th: number): V3 => [x, rho * Math.cos(th), rho * Math.sin(th)]

interface Patch {
  nu: number
  nv: number
  pos(u: number, v: number): V3
  col?(u: number, v: number): RGB
}

/** One mesh geometry from parametric patches (each with its own vertices, so edges stay crisp). */
function buildGeometry(patches: Patch[]): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const coloured = patches.some((p) => p.col)
  for (const p of patches) {
    const base = pos.length / 3
    for (let i = 0; i <= p.nu; i++)
      for (let j = 0; j <= p.nv; j++) {
        const u = i / p.nu
        const v = j / p.nv
        pos.push(...p.pos(u, v))
        if (coloured) col.push(...(p.col ? p.col(u, v) : ([1, 1, 1] as RGB)))
      }
    for (let i = 0; i < p.nu; i++)
      for (let j = 0; j < p.nv; j++) {
        const a = base + i * (p.nv + 1) + j
        const b = a + p.nv + 1
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  if (coloured) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** The patches of an annular tube a ≤ ρ ≤ b, x0 ≤ x ≤ x1, th0 ≤ θ ≤ th1 (a sector when the span is under 2π). */
function tubePatches(a: number, b: number, x0: number, x1: number, th0: number, th1: number, colorAt?: (rho: number) => RGB, nRho = 1): Patch[] {
  const span = th1 - th0
  const full = Math.abs(span - 2 * Math.PI) < 1e-9
  const nTh = Math.max(8, Math.round((48 * span) / (2 * Math.PI)))
  const th = (u: number) => th0 + u * span
  const X = (v: number) => x0 + v * (x1 - x0)
  const rho = (v: number) => a + v * (b - a)
  const c = colorAt
  const out: Patch[] = [
    { nu: nTh, nv: 1, pos: (u, v) => P(X(v), b, th(u)), col: c && (() => c(b)) },
    { nu: nTh, nv: c ? nRho : 1, pos: (u, v) => P(x1, rho(v), th(u)), col: c && ((_, v) => c(rho(v))) },
    { nu: nTh, nv: c ? nRho : 1, pos: (u, v) => P(x0, rho(v), th(u)), col: c && ((_, v) => c(rho(v))) },
  ]
  if (a > 0) out.push({ nu: nTh, nv: 1, pos: (u, v) => P(X(v), a, th(u)), col: c && (() => c(a)) })
  if (!full) for (const t of [th0, th1]) out.push({ nu: c ? nRho : 1, nv: 1, pos: (u, v) => P(X(v), rho(u), t), col: c && ((u) => c(rho(u))) })
  return out
}

/** A ring (torus) of centre-line radius ρ₀ and tube radius t in the plane x = xp, over the angles th0…th1. */
function ringPatch(xp: number, rho0: number, t: number, th0: number, th1: number): Patch {
  return {
    nu: Math.max(12, Math.round((64 * (th1 - th0)) / (2 * Math.PI))),
    nv: 8,
    pos: (u, v) => {
      const th = th0 + u * (th1 - th0)
      const psi = v * 2 * Math.PI
      return P(xp + t * Math.cos(psi), rho0 + t * Math.sin(psi), th)
    },
  }
}

/** A thin straight rod between two points (a box), as a patch-free mesh. */
function Rod({ a, b, thick, color }: { a: V3; b: V3; thick: number; color: string }) {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const dir = vb.clone().sub(va)
  const len = Math.max(dir.length(), 1e-6)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  const mid = va.add(vb).multiplyScalar(0.5)
  return (
    <mesh position={mid} quaternion={q}>
      <boxGeometry args={[thick, len, thick]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

const CUT0 = Math.PI / 2
const CUT1 = 2 * Math.PI

export interface SceneLayout {
  layers: Array<LayerSpec & { a: number; b: number; x1: number }>
  /** Outer radius, back end, cut start and front end [cm]. */
  ro: number
  xBack: number
  xFront: number
  step: number
  /** Where the insulation's end face is (the probe ring sits on it). */
  xProbe: number
  target: V3
  camera: V3
  radius: number
}

/** Positions and lengths of every layer for a view (lengths scale with the cable's outer radius). */
export function sceneLayout(res: Pick<CableResult, 'c'>, view: CableView): SceneLayout {
  const specs = layerSpecs(res.c.rMm, res.c.RMm)
  const ro = specs[specs.length - 1].outer / 10
  const step = 0.78 * ro
  const xBack = -2.4 * ro
  const n = specs.length
  const layers = specs.map((s, i) => ({ ...s, a: s.inner / 10, b: s.outer / 10, x1: view === 'stepped' ? (n - 1 - i) * step : 2.4 * ro }))
  const xFront = Math.max(...layers.map((l) => l.x1))
  const ins = layers.find((l) => l.id === 'insulation')!
  const cx = (xBack + xFront) / 2
  const half = (xFront - xBack) / 2
  const d = Math.max(half, 3 * ro) * 1.8
  const target: V3 = [cx + (view === 'stepped' ? 0.6 * ro : 0.9 * ro), view === 'stepped' ? -0.3 * ro : -0.45 * ro, 0]
  const camera: V3 = view === 'stepped' ? [target[0] + d * 0.42, target[1] + d * 0.45, d * 0.86] : [target[0] + d * 0.78, target[1] + d * 0.5, d * 0.62]
  return { layers, ro, xBack, xFront, step, xProbe: ins.x1, target, camera, radius: Math.max(half, 2 * ro) }
}

const tone = (h: ReturnType<typeof useHighlight>, base: string) =>
  h === 'selected' ? SCENE_COLORS.selected : h === 'hovered' ? SCENE_COLORS.hovered : h === 'dim' ? new THREE.Color(base).multiplyScalar(0.45).getStyle() : base

function useDispose(g: THREE.BufferGeometry) {
  useEffect(() => () => g.dispose(), [g])
}

function LayerMesh({
  L,
  view,
  xBack,
  colorAt,
  labelAt,
  showLabel,
}: {
  L: SceneLayout['layers'][number]
  view: CableView
  xBack: number
  colorAt?: (rho: number) => RGB
  labelAt: V3
  showLabel: boolean
}) {
  const h = useHighlight(L.id)
  const geo = useMemo(() => {
    const nR = colorAt ? 28 : 1
    const patches =
      view === 'stepped'
        ? tubePatches(L.a, L.b, xBack, L.x1, 0, 2 * Math.PI, colorAt, nR)
        : [...tubePatches(L.a, L.b, xBack, 0, 0, 2 * Math.PI, colorAt, nR), ...tubePatches(L.a, L.b, 0, L.x1, CUT0, CUT1, colorAt, nR)]
    return buildGeometry(patches)
  }, [L.a, L.b, L.x1, view, xBack, colorAt])
  useDispose(geo)
  const coloured = !!colorAt
  const base = coloured ? '#ffffff' : L.color
  const color = coloured ? (h === 'dim' ? '#6f6f6f' : h === 'hovered' ? '#dfe9ff' : '#ffffff') : tone(h, base)
  const metal = L.id === 'conductor' || L.id === 'sheath' || L.id === 'armour'
  return (
    <Selectable id={L.id}>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color={color}
          vertexColors={coloured}
          metalness={metal ? 0.45 : 0.05}
          roughness={metal ? 0.45 : 0.75}
          side={THREE.DoubleSide}
          emissive={h === 'selected' ? SCENE_COLORS.selected : '#000000'}
          emissiveIntensity={h === 'selected' ? (coloured ? 0.18 : 0.25) : 0}
        />
      </mesh>
      {showLabel && <Label3D position={labelAt}>{view === 'stepped' ? L.short : L.name}</Label3D>}
    </Selectable>
  )
}

/** Armour wires drawn over the armour layer (illustration): a ring of round wires. */
function ArmourWires({ L, view, xBack }: { L: SceneLayout['layers'][number]; view: CableView; xBack: number }) {
  const h = useHighlight('armour')
  const ref = useRef<THREE.InstancedMesh>(null)
  const wr = (L.b - L.a) / 2
  const rc = L.a + wr
  const n = Math.max(12, Math.floor((2 * Math.PI * rc) / (2 * wr * 1.08)))
  const wires = useMemo(() => {
    const out: Array<{ th: number; x0: number; x1: number }> = []
    for (let k = 0; k < n; k++) {
      const th = (k / n) * 2 * Math.PI
      // assembled: the wires in the cut-away quarter (0 ≤ θ < π/2) stop at x = 0
      const cut = view === 'assembled' && th < CUT0 - 1e-9
      out.push({ th, x0: xBack, x1: cut ? 0 : L.x1 })
    }
    return out
  }, [n, view, xBack, L.x1])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))
    wires.forEach((w, i) => {
      const len = w.x1 - w.x0
      const p = P((w.x0 + w.x1) / 2, rc, w.th)
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, len, 1)))
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [wires, rc])
  return (
    <Selectable id="armour">
      <instancedMesh key={wires.length} ref={ref} args={[undefined, undefined, wires.length]}>
        <cylinderGeometry args={[wr * 0.96, wr * 0.96, 1, 8]} />
        <meshStandardMaterial color={tone(h, L.color)} metalness={0.5} roughness={0.4} />
      </instancedMesh>
    </Selectable>
  )
}

function Probe({ res, lay, view, t }: { res: CableResult; lay: SceneLayout; view: CableView; t: number }) {
  const h = useHighlight('probe')
  const pv = probeValues(res, t)
  const tube = Math.max(0.018, 0.012 * lay.ro)
  const th0 = view === 'assembled' ? CUT0 : 0
  const th1 = view === 'assembled' ? CUT1 : 2 * Math.PI
  const xp = lay.xProbe + tube * 0.6
  const geo = useMemo(() => buildGeometry([ringPatch(xp, pv.xCm, tube, th0, th1)]), [xp, pv.xCm, tube, th0, th1])
  useDispose(geo)
  const color = h === 'selected' ? SCENE_COLORS.selected : h === 'hovered' ? SCENE_COLORS.hovered : '#ffffff'
  const yLabel = -(lay.ro * (view === 'stepped' ? 2.3 : 1.4))
  return (
    <Selectable id="probe">
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.4} />
      </mesh>
      {view === 'assembled' && (
        <>
          {/* the probe radius traced along both cut faces */}
          <Rod a={[0, 0.004, pv.xCm]} b={[lay.xFront, 0.004, pv.xCm]} thick={tube * 0.9} color={color} />
          <Rod a={[0, pv.xCm, 0.004]} b={[lay.xFront, pv.xCm, 0.004]} thick={tube * 0.9} color={color} />
        </>
      )}
      <Rod a={[xp, -pv.xCm, 0]} b={[xp, yLabel + 0.15 * lay.ro, 0]} thick={tube * 0.5} color="#9fb0c4" />
      <Label3D position={[xp, yLabel, 0]} className="is-value cb-probe-label" always>
        x {fx(pv.xMm, 1)} mm · g {fx(pv.g, 2)} kV/cm · V {fx(pv.v, 1)} kV
      </Label3D>
    </Selectable>
  )
}

/** Frame the cable again when the view changes (not while the student moves a slider). */
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
    camera.position.set(...position)
    controls?.target.set(...target)
    controls?.update()
    invalidate()
  }, [frame]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export interface CableSceneProps {
  res: CableResult
  view: CableView
  hidden?: LayerId[]
  probeT: number
  gPerm: number
  selected: string | null
  onSelect(id: string | null): void
  fallback: ReactNode
  info?(id: string): ReactNode
  tour?: TourStep[]
  height?: number
  label?: string
}

export function CableScene({ res, view, hidden = [], probeT, gPerm, selected, onSelect, fallback, info, tour, height = 420, label = 'An underground cable with its layers' }: CableSceneProps) {
  const lay = useMemo(() => sceneLayout(res, view), [res, view])
  const colorAt = useMemo(() => (rho: number) => stressRgb(stressAt(res.c.vKv, rho, res.r, res.R) / gPerm).map((v) => Math.pow(v, 2.2)) as RGB, [res, gPerm])
  const parts = CABLE_PARTS.filter((p) => !hidden.includes(p.id as LayerId))
  const labelPos = (L: SceneLayout['layers'][number], i: number): V3 => {
    if (view === 'stepped') {
      const x = L.x1 - lay.step / 2
      const up = i % 2 === 0
      const far = (i >> 1) % 2 === 1
      return [x, (up ? 1 : -1) * (L.b + (far ? 0.95 : 0.4) * lay.ro), 0]
    }
    return [lay.xFront + 0.3 * lay.ro, (L.a + L.b) / 2, -0.05]
  }
  return (
    <Scene3D
      label={label}
      parts={parts}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: lay.camera, target: lay.target, fov: 38 }}
      radius={lay.radius}
      fallback={fallback}
      info={info}
      tour={tour}
      height={height}
      deps={[res, view, hidden.join(','), probeT, gPerm, selected]}
      kindNote="To scale: the conductor radius r, the sheath radius R and the probe radius. Calculated: the insulation’s colour (the computed stress, scale below) and the probe’s values. Illustration: the thickness of the screens, sheath, bedding, armour and jacket, the armour wires and the strip-back lengths."
    >
      <AutoFrame frame={view} position={lay.camera} target={lay.target} />
      {lay.layers.map((L, i) =>
        hidden.includes(L.id) ? null : L.id === 'armour' ? (
          <group key={L.id}>
            <ArmourWires L={L} view={view} xBack={lay.xBack} />
            {view === 'stepped' && <Label3D position={labelPos(L, i)}>{L.short}</Label3D>}
          </group>
        ) : (
          <LayerMesh
            key={L.id}
            L={L}
            view={view}
            xBack={lay.xBack}
            colorAt={L.id === 'insulation' ? colorAt : undefined}
            labelAt={labelPos(L, i)}
            showLabel={view === 'stepped' || selected === L.id}
          />
        ),
      )}
      {!hidden.includes('insulation') && <Probe res={res} lay={lay} view={view} t={probeT} />}
    </Scene3D>
  )
}
