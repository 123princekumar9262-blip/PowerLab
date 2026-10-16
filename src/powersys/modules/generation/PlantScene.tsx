import { useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { Label3D, SCENE_COLORS, Scene3D, Selectable, useHighlight, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { MEV_PER_FISSION, PLANT_LABEL, T_COOL_C, T_STEAM_C, type Plants, type PlantType } from './calc.ts'
import { grp, pc, sci, type PlantResults } from './shared.tsx'

/*
 * One power station in 3D, switched by plant type: a coal station (boiler, turbine, generator, condenser, cooling
 * tower, feed pump), a hydro station (reservoir, dam, penstock, turbine-generator, tailrace), a nuclear station
 * (containment, core, control rods, steam generator and the same turbine hall) and a pumped-storage scheme (upper
 * and lower reservoirs, one machine that pumps or generates).
 * GEOMETRY: the equipment and its layout — schematic, not to scale; only the drawn head of the hydro and pumped-
 * storage schemes follows the chosen head (on a compressed scale, labelled with its value). CALCULATED: every value in
 * the labels and the info panel, and the direction of the water arrows (from the mode). Nothing moves on its own.
 */

type V3 = [number, number, number]
type Hl = ReturnType<typeof useHighlight>
const DIM = new THREE.Color('#1b222c')
function tone(h: Hl, base: string): string {
  if (h === 'selected') return SCENE_COLORS.selected
  if (h === 'hovered') return SCENE_COLORS.hovered
  if (h === 'dim') return '#' + new THREE.Color(base).lerp(DIM, 0.55).getHexString()
  return base
}
const UP = new THREE.Vector3(0, 1, 0)

const C = {
  concrete: '#a7aeb8',
  building: '#7a8696',
  steel: SCENE_COLORS.steel,
  dark: SCENE_COLORS.steelDark,
  hot: '#e07a5f',
  cold: '#4f95ea',
  cooling: '#62c2dc',
  water: '#3f7fc4',
  gen: '#6d8fbf',
  coal: '#2b2b2e',
  fuel: '#e0a91c',
  rock: '#3a4350',
  grass: '#26302a',
}

/** A cylinder between two points. */
function Pipe({ a, b, r, color, opacity }: { a: V3; b: V3; r: number; color: string; opacity?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const len = Math.max(dir.length(), 1e-6)
    return { pos: va.add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()), len }
  }, [a, b])
  return (
    <mesh position={pos} quaternion={quat}>
      <cylinderGeometry args={[r, r, len, 12]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.55} transparent={opacity !== undefined} opacity={opacity ?? 1} />
    </mesh>
  )
}
/** A pipe along a polyline. */
function Run({ pts, r, color }: { pts: V3[]; r: number; color: string }) {
  return (
    <>
      {pts.slice(1).map((p, k) => (
        <Pipe key={k} a={pts[k]} b={p} r={r} color={color} />
      ))}
      {pts.slice(1, -1).map((p, k) => (
        <mesh key={`j${k}`} position={p}>
          <sphereGeometry args={[r, 10, 8]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.55} />
        </mesh>
      ))}
    </>
  )
}
function Box({ p, s, color, opacity }: { p: V3; s: V3; color: string; opacity?: number }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={0.8} transparent={opacity !== undefined} opacity={opacity ?? 1} depthWrite={opacity === undefined} />
    </mesh>
  )
}
/** A horizontal cylinder along x. */
function CylX({ p, r, len, color, metal = 0.4 }: { p: V3; r: number; len: number; color: string; metal?: number }) {
  return (
    <mesh position={p} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[r, r, len, 24]} />
      <meshStandardMaterial color={color} metalness={metal} roughness={0.45} />
    </mesh>
  )
}

// ── shared equipment (the turbine hall is the same for coal and nuclear) ────────────────────────────────────────

function Turbine({ name }: { name: string }) {
  const h = useHighlight('turbine')
  const c = tone(h, C.steel)
  return (
    <Selectable id="turbine">
      {(
        [
          [-2.6, 0.8, 1.6],
          [-0.8, 1.1, 1.8],
          [1.5, 1.4, 2.4],
        ] as Array<[number, number, number]>
      ).map(([x, r, l], k) => (
        <CylX key={k} p={[x, 3.0, 0]} r={r} len={l} color={c} />
      ))}
      <Box p={[-1.7, 0.75, 0]} s={[3.2, 1.5, 1.6]} color={tone(h, C.dark)} />
      <Label3D position={[-0.8, 4.9, 0]}>{name}</Label3D>
    </Selectable>
  )
}
function Generator({ label }: { label: string }) {
  const h = useHighlight('generator')
  return (
    <Selectable id="generator">
      <CylX p={[1.95, 3.0, 0]} r={0.12} len={7.5} color={tone(h, C.dark)} metal={0.7} />
      <CylX p={[5.6, 3.0, 0]} r={1.2} len={3} color={tone(h, C.gen)} metal={0.25} />
      <Box p={[5.6, 0.9, 0]} s={[3, 1.8, 1.8]} color={tone(h, C.dark)} />
      <Label3D position={[5.6, 4.7, 0]}>Generator</Label3D>
      <Label3D position={[5.6, 6.6, 0]} className="is-value" always>
        {label}
      </Label3D>
    </Selectable>
  )
}
function Condenser() {
  const h = useHighlight('condenser')
  return (
    <Selectable id="condenser">
      <Box p={[1.5, 0.8, 0]} s={[3.0, 1.6, 2.6]} color={tone(h, '#8a96a6')} />
      <Run
        pts={[
          [2.2, 0.5, -1.3],
          [2.2, 0.5, -3.2],
          [10.6, 0.5, -3.2],
        ]}
        r={0.22}
        color={tone(h, C.cooling)}
      />
      <Run
        pts={[
          [1.0, 0.9, -1.3],
          [1.0, 0.9, -3.8],
          [10.6, 0.9, -3.8],
        ]}
        r={0.22}
        color={tone(h, C.hot)}
      />
      <Label3D position={[1.5, 0.6, 2.2]}>Condenser</Label3D>
    </Selectable>
  )
}
function CoolingTower({ label }: { label: string }) {
  const h = useHighlight('tower')
  const geo = useMemo(() => {
    const pts = [
      [4.4, 0],
      [3.7, 3],
      [3.05, 7],
      [3.05, 9],
      [3.35, 11.5],
    ].map(([r, y]) => new THREE.Vector2(r, y))
    return new THREE.LatheGeometry(pts, 28)
  }, [])
  return (
    <Selectable id="tower">
      <mesh position={[14, 0, -3.5]} geometry={geo}>
        <meshStandardMaterial color={tone(h, '#c3cad3')} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Label3D position={[14, 12.6, -3.5]}>Cooling tower</Label3D>
      <Label3D position={[14, 6, 0.4]} className="is-value" always>
        {label}
      </Label3D>
    </Selectable>
  )
}
function Transformer() {
  const h = useHighlight('transformer')
  const c = tone(h, '#6b7480')
  return (
    <Selectable id="transformer">
      <Box p={[10, 1.0, 4]} s={[2, 2, 1.6]} color={c} />
      {[-0.6, 0, 0.6].map((dx) => (
        <Pipe key={dx} a={[10 + dx, 2, 4]} b={[10 + dx, 3.1, 4]} r={0.09} color={tone(h, SCENE_COLORS.insulator)} />
      ))}
      <Run
        pts={[
          [7.1, 3.0, 0],
          [8.4, 3.0, 0],
          [8.4, 3.0, 4],
          [9.2, 3.0, 4],
        ]}
        r={0.14}
        color={tone(h, '#9fb0c4')}
      />
      <Label3D position={[11.6, 0.2, 7.0]}>Step-up transformer</Label3D>
    </Selectable>
  )
}
function Ground() {
  return <Box p={[0, -0.06, 0]} s={[100, 0.1, 80]} color={C.grass} />
}

// ── coal ──────────────────────────────────────────────────────────────────────────────────────────────────────

function ThermalPlant({ res, p }: { res: PlantResults; p: Plants }) {
  const r = res.thermal.ok ? res.thermal : null
  const hb = useHighlight('boiler')
  const hs = useHighlight('stack')
  const hc = useHighlight('coal')
  const hp = useHighlight('pump')
  return (
    <group>
      <Selectable id="coal">
        <mesh position={[-15.5, 0.8, 3.5]}>
          <coneGeometry args={[2.6, 1.6, 10]} />
          <meshStandardMaterial color={tone(hc, C.coal)} roughness={1} />
        </mesh>
        <Pipe a={[-14.5, 1.2, 3]} b={[-10.4, 7.5, 1.2]} r={0.28} color={tone(hc, C.dark)} />
        <Label3D position={[-15.5, 2.4, 3.5]}>Coal yard</Label3D>
      </Selectable>
      <Selectable id="boiler">
        <Box p={[-8, 6.5, 0]} s={[5, 13, 5]} color={tone(hb, C.building)} />
        <Box p={[-8, 3, 2.52]} s={[2.4, 2.4, 0.05]} color={tone(hb, '#ff7a3d')} />
        <Label3D position={[-8, 13.8, 0]}>Boiler</Label3D>
        <Label3D position={[-8, 8, 2.8]} className="is-value" always>
          {r ? `coal ${grp(r.fuelKgH / 1000, 0)} t/h` : 'no result'}
        </Label3D>
      </Selectable>
      <Selectable id="stack">
        <mesh position={[-8, 11, -6]}>
          <cylinderGeometry args={[0.6, 0.95, 22, 16]} />
          <meshStandardMaterial color={tone(hs, '#9aa3ad')} roughness={0.85} />
        </mesh>
        <Pipe a={[-8, 2, -2.5]} b={[-8, 2, -5.4]} r={0.6} color={tone(hs, C.dark)} />
        <Label3D position={[-8, 22.8, -6]}>Stack</Label3D>
      </Selectable>
      <Turbine name="Steam turbine" />
      <Generator label={`${grp(p.thermal.pMw, 0)} MW`} />
      <Condenser />
      <CoolingTower label={r ? `${grp(r.condenserMw, 0)} MW of heat` : '—'} />
      <Transformer />
      <Selectable id="pump">
        <CylX p={[-4.4, 0.5, 2.8]} r={0.42} len={1.2} color={tone(hp, C.cold)} />
        <Label3D position={[-4.4, 1.4, 3.6]}>Feed pump</Label3D>
      </Selectable>
      {/* steam main, condensate and feed water (illustration of the loop) */}
      <Run
        pts={[
          [-5.5, 9, 0],
          [-2.6, 9, 0],
          [-2.6, 3.8, 0],
        ]}
        r={0.28}
        color={C.hot}
      />
      <Run
        pts={[
          [1.5, 0.3, 1.3],
          [1.5, 0.3, 2.8],
          [-3.8, 0.3, 2.8],
        ]}
        r={0.18}
        color={C.cold}
      />
      <Run
        pts={[
          [-5.0, 0.5, 2.8],
          [-6.2, 0.5, 2.8],
          [-6.2, 3.6, 2.8],
          [-6.2, 3.6, 2.4],
        ]}
        r={0.18}
        color={C.cold}
      />
    </group>
  )
}

// ── nuclear ───────────────────────────────────────────────────────────────────────────────────────────────────

function NuclearPlant({ res, p }: { res: PlantResults; p: Plants }) {
  const r = res.nuclear.ok ? res.nuclear : null
  const hc = useHighlight('containment')
  const hk = useHighlight('core')
  const hr = useHighlight('rods')
  const hl = useHighlight('coolant')
  const hs = useHighlight('sg')
  const fuel = useMemo(() => {
    const out: V3[] = []
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push([-11.2 + i * 0.42, 2.2, j * 0.42])
    return out
  }, [])
  return (
    <group>
      <Selectable id="containment">
        <mesh position={[-10, 3.5, 0]}>
          <cylinderGeometry args={[4.2, 4.2, 7, 32, 1, true]} />
          <meshStandardMaterial color={tone(hc, '#c9d2de')} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[-10, 7, 0]}>
          <sphereGeometry args={[4.2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={tone(hc, '#c9d2de')} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <Label3D position={[-10, 11.8, 0]}>Containment (shielding)</Label3D>
      </Selectable>
      <Selectable id="core">
        <mesh position={[-11.2, 2.6, 0]}>
          <cylinderGeometry args={[1.05, 1.05, 4, 24]} />
          <meshStandardMaterial color={tone(hk, C.steel)} transparent opacity={0.35} depthWrite={false} />
        </mesh>
        {fuel.map((q, k) => (
          <mesh key={k} position={q}>
            <cylinderGeometry args={[0.12, 0.12, 2.4, 8]} />
            <meshStandardMaterial color={tone(hk, C.fuel)} emissive={hk === 'selected' ? '#000' : '#5a3a00'} emissiveIntensity={0.4} />
          </mesh>
        ))}
        <Label3D position={[-13.9, 2.4, 1.4]}>Reactor core</Label3D>
        <Label3D position={[-11.2, 0.3, 2]} className="is-value" always>
          {r ? `${grp(r.thermalMw, 0)} MW heat` : '—'}
        </Label3D>
      </Selectable>
      <Selectable id="rods">
        {(
          [
            [-11.41, -0.21],
            [-10.99, 0.21],
            [-11.41, 0.21],
            [-10.99, -0.21],
          ] as Array<[number, number]>
        ).map(([x, z], k) => (
          <Pipe key={k} a={[x, 2.7, z]} b={[x, 5.6, z]} r={0.07} color={tone(hr, '#30343a')} />
        ))}
        <Label3D position={[-12.6, 6.6, 0]}>Control rods</Label3D>
      </Selectable>
      <Selectable id="coolant">
        <Run
          pts={[
            [-10.2, 3.6, 0],
            [-8.6, 3.6, 0],
          ]}
          r={0.22}
          color={tone(hl, C.hot)}
        />
        <Run
          pts={[
            [-8.6, 1.2, 0],
            [-10.2, 1.2, 0],
          ]}
          r={0.22}
          color={tone(hl, C.cold)}
        />
        <CylX p={[-9.4, 1.2, 0.6]} r={0.3} len={0.6} color={tone(hl, C.dark)} />
      </Selectable>
      <Selectable id="sg">
        <mesh position={[-8, 3.2, 0]}>
          <cylinderGeometry args={[0.7, 0.7, 5, 20]} />
          <meshStandardMaterial color={tone(hs, '#b9c2cc')} metalness={0.3} roughness={0.5} />
        </mesh>
        <Label3D position={[-6.8, 8.8, 1.8]}>Steam generator</Label3D>
      </Selectable>
      <Run
        pts={[
          [-8, 5.7, 0],
          [-8, 6.3, 0],
          [-2.6, 6.3, 0],
          [-2.6, 3.8, 0],
        ]}
        r={0.26}
        color={C.hot}
      />
      <Run
        pts={[
          [1.5, 0.3, 1.3],
          [1.5, 0.3, 2.8],
          [-7.6, 0.3, 2.8],
          [-7.6, 0.8, 0.5],
        ]}
        r={0.16}
        color={C.cold}
      />
      <Turbine name="Steam turbine" />
      <Generator label={`${grp(p.nuclear.pMw, 0)} MW`} />
      <Condenser />
      <CoolingTower label={r ? `${grp(r.rejectedMw, 0)} MW of heat` : '—'} />
      <Transformer />
    </group>
  )
}

// ── hydro and pumped storage ───────────────────────────────────────────────────────────────────────────────

/** Drawn height of the head (a compressed scale: 3 + 9·H/600, at most 12 units). */
export const drawnHead = (headM: number) => 3 + 9 * Math.min(1, Math.max(0, headM / 600))

function HeadDim({ x, z, y0, y1, headM }: { x: number; z: number; y0: number; y1: number; headM: number }) {
  return (
    <group>
      <Pipe a={[x, y0, z]} b={[x, y1, z]} r={0.05} color={SCENE_COLORS.accent} />
      <Pipe a={[x - 0.5, y1, z]} b={[x + 0.5, y1, z]} r={0.05} color={SCENE_COLORS.accent} />
      <Pipe a={[x - 0.5, y0, z]} b={[x + 0.5, y0, z]} r={0.05} color={SCENE_COLORS.accent} />
      <Label3D position={[x + 0.4, (y0 + y1) / 2, z]} className="is-value" always>
        head H = {grp(headM, 0)} m
      </Label3D>
    </group>
  )
}

function PowerHouse({ x, z, machineId, genId, machineName, genName, value }: { x: number; z: number; machineId: string; genId: string; machineName: string; genName: string; value: string }) {
  const hm = useHighlight(machineId)
  const hg = useHighlight(genId)
  return (
    <group>
      <Box p={[x, 2.2, z]} s={[5.4, 4.4, 5]} color={C.building} opacity={0.18} />
      <Selectable id={machineId}>
        <mesh position={[x, 0.9, z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.05, 0.36, 10, 24]} />
          <meshStandardMaterial color={tone(hm, C.steel)} metalness={0.4} roughness={0.45} />
        </mesh>
        <mesh position={[x, 0.9, z]}>
          <cylinderGeometry args={[0.66, 0.5, 0.6, 16]} />
          <meshStandardMaterial color={tone(hm, '#c9a24a')} metalness={0.5} roughness={0.4} />
        </mesh>
        <Label3D position={[x + 1.4, 0.5, z + 2.9]}>{machineName}</Label3D>
      </Selectable>
      <Selectable id={genId}>
        <Pipe a={[x, 1.2, z]} b={[x, 2.2, z]} r={0.12} color={tone(hg, C.dark)} />
        <mesh position={[x, 2.8, z]}>
          <cylinderGeometry args={[1.3, 1.3, 1.2, 24]} />
          <meshStandardMaterial color={tone(hg, C.gen)} metalness={0.25} roughness={0.5} />
        </mesh>
        <Label3D position={[x, 5.6, z]}>{genName}</Label3D>
        <Label3D position={[x - 2.8, 2.4, z + 2.8]} className="is-value" always>
          {value}
        </Label3D>
      </Selectable>
    </group>
  )
}
function HydroTransformer({ x, z }: { x: number; z: number }) {
  const h = useHighlight('transformer')
  return (
    <Selectable id="transformer">
      <Box p={[x, 1.0, z]} s={[2, 2, 1.6]} color={tone(h, '#6b7480')} />
      {[-0.6, 0, 0.6].map((dx) => (
        <Pipe key={dx} a={[x + dx, 2, z]} b={[x + dx, 3.1, z]} r={0.09} color={tone(h, SCENE_COLORS.insulator)} />
      ))}
      <Label3D position={[x + 1.4, 0.2, z + 2.6]}>Step-up transformer</Label3D>
    </Selectable>
  )
}

function HydroPlant({ res, p }: { res: PlantResults; p: Plants }) {
  const r = res.hydro.ok ? res.hydro : null
  const hd = drawnHead(p.hydro.headM)
  const bw = Math.max(2.2, hd * 0.62)
  const hR = useHighlight('reservoir')
  const hD = useHighlight('dam')
  const hP = useHighlight('penstock')
  const hT = useHighlight('tailrace')
  const dam = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-5, 0)
    s.lineTo(-5 + bw, 0)
    s.lineTo(-4, hd + 0.6)
    s.lineTo(-5, hd + 0.6)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 16, bevelEnabled: false })
    g.translate(0, 0, -8)
    return g
  }, [hd, bw])
  const lo = 0.35
  return (
    <group>
      <Box p={[-12, (hd + 2) / 2, -10]} s={[18, hd + 2, 4]} color={C.rock} />
      <Selectable id="reservoir">
        <Box p={[-12, hd / 2, 0]} s={[14, hd, 16]} color={tone(hR, C.water)} opacity={0.55} />
        <Label3D position={[-13, hd + 0.8, 0]}>Reservoir</Label3D>
        <Label3D position={[-12, hd * 0.5, 8.4]} className="is-value" always>
          {r ? `${grp(r.storedMwh, 0)} MWh stored` : '—'}
        </Label3D>
      </Selectable>
      <Selectable id="dam">
        <mesh geometry={dam}>
          <meshStandardMaterial color={tone(hD, C.concrete)} roughness={0.9} />
        </mesh>
        <Label3D position={[-4.5, hd + 1.4, 0]}>Dam</Label3D>
      </Selectable>
      <Selectable id="penstock">
        <Pipe a={[-5.6, hd * 0.5, -3]} b={[4.2, 0.9, -3]} r={0.45} color={tone(hP, C.steel)} />
        <Label3D position={[-2.6, hd * 0.35 + 1.6, -3]}>Penstock</Label3D>
      </Selectable>
      <PowerHouse x={5} z={-3} machineId="turbine" genId="generator" machineName="Turbine" genName="Generator" value={`${grp(p.hydro.pMw, 0)} MW`} />
      <Selectable id="tailrace">
        <Box p={[13.5, lo / 2, -3.5]} s={[11, lo, 9]} color={tone(hT, C.water)} opacity={0.55} />
        <Pipe a={[5.8, 0.6, -3]} b={[7.4, 0.25, -3]} r={0.4} color={tone(hT, C.steel)} />
        <Label3D position={[16, 1.0, -5]}>Tailrace</Label3D>
        <Label3D position={[15, 0.6, 1.2]} className="is-value" always>
          {r ? `${grp(r.qM3s, r.qM3s < 100 ? 1 : 0)} m³/s` : '—'}
        </Label3D>
      </Selectable>
      <HydroTransformer x={11} z={5.5} />
      <HeadDim x={-2.2} z={8.3} y0={lo} y1={hd} headM={p.hydro.headM} />
    </group>
  )
}

function FlowCones({ a, b, reverse, color }: { a: V3; b: V3; reverse: boolean; color: string }) {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const dir = (reverse ? va.clone().sub(vb) : vb.clone().sub(va)).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir)
  return (
    <>
      {[0.25, 0.5, 0.75].map((t) => (
        <mesh
          key={t}
          position={va
            .clone()
            .lerp(vb, t)
            .add(new THREE.Vector3(0, 0.75, 0))}
          quaternion={q}
        >
          <coneGeometry args={[0.32, 0.8, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      ))}
    </>
  )
}

function PumpedPlant({ res, p }: { res: PlantResults; p: Plants }) {
  const r = res.pumped.ok ? res.pumped : null
  const gen = p.pumped.mode === 'generate'
  const hd = drawnHead(p.pumped.headM)
  const hU = useHighlight('upper')
  const hL = useHighlight('lower')
  const hP = useHighlight('penstock')
  const lo = 0.5
  return (
    <group>
      <Box p={[-12, (hd - 0.7) / 2, -1]} s={[12, hd - 0.7, 14]} color={C.rock} />
      <Selectable id="upper">
        <Box p={[-12, hd - 0.35, -1]} s={[10, 0.7, 12]} color={tone(hU, C.water)} opacity={0.6} />
        <Label3D position={[-12, hd + 0.9, -1]}>Upper reservoir</Label3D>
        <Label3D position={[-12, hd - 1.5, 6.4]} className="is-value" always>
          {r ? `${grp(r.storedMwh, 0)} MWh stored` : '—'}
        </Label3D>
      </Selectable>
      <Selectable id="penstock">
        <Pipe a={[-7.2, hd - 0.6, -2]} b={[4.2, 0.9, -2]} r={0.42} color={tone(hP, C.steel)} />
        <FlowCones a={[-7.2, hd - 0.6, -2]} b={[4.2, 0.9, -2]} reverse={!gen} color={SCENE_COLORS.accent} />
        <Label3D position={[-4, hd * 0.68 + 1.4, -2]}>Penstock / tunnel</Label3D>
      </Selectable>
      <PowerHouse
        x={5}
        z={-2}
        machineId="machine"
        genId="motorgen"
        machineName="Pump-turbine"
        genName="Motor-generator"
        value={`${grp(p.pumped.pMw, 0)} MW ${gen ? 'out (generating)' : 'in (pumping)'}`}
      />
      <Selectable id="lower">
        <Box p={[13.5, lo / 2, -3.5]} s={[11, lo, 9]} color={tone(hL, C.water)} opacity={0.6} />
        <Pipe a={[5.8, 0.6, -2]} b={[8.2, 0.3, -2]} r={0.4} color={tone(hL, C.steel)} />
        <Label3D position={[15, 1.2, -5]}>Lower reservoir</Label3D>
      </Selectable>
      <HydroTransformer x={11} z={5.5} />
      <HeadDim x={-5.6} z={6.8} y0={lo} y1={hd} headM={p.pumped.headM} />
    </group>
  )
}

// ── parts, info and tours ───────────────────────────────────────────────────────────────────────────────────

const TURBINE_HALL: ScenePart[] = [
  { id: 'turbine', name: 'Steam turbine', what: 'High-pressure steam expands through rows of blades in three casings that grow in size as the pressure falls; the blades turn the shaft.' },
  { id: 'generator', name: 'Generator', what: 'A synchronous generator on the same shaft: its spinning magnetised rotor induces three-phase voltage in the stator windings.' },
  { id: 'condenser', name: 'Condenser', what: 'Turns the exhaust steam back into water at low pressure, so the turbine can expand the steam further. Cooling water carries away the heat.' },
  { id: 'tower', name: 'Cooling tower', what: 'Cools the warmed cooling water in the open air (mostly by evaporating a little of it) before it returns to the condenser.' },
  { id: 'transformer', name: 'Step-up transformer', what: 'Raises the generator voltage to the transmission voltage, so the same power flows with far less current.' },
]
export function plantParts(type: PlantType): ScenePart[] {
  if (type === 'thermal')
    return [
      { id: 'coal', name: 'Coal yard and conveyor', what: 'Coal is stored, crushed to powder and blown into the furnace.' },
      { id: 'boiler', name: 'Boiler', what: 'Burns the coal; the heat turns high-pressure water in its tube walls into superheated steam.' },
      { id: 'stack', name: 'Stack', what: 'Carries the flue gas (after cleaning) high into the air. The heat it carries away is a boiler loss.' },
      ...TURBINE_HALL,
      { id: 'pump', name: 'Boiler feed pump', what: 'Raises the condensed water back to boiler pressure — closing the loop of the Rankine cycle.' },
    ]
  if (type === 'nuclear')
    return [
      { id: 'containment', name: 'Containment and shielding', what: 'A thick steel-lined concrete building: shields radiation and holds in anything released in an accident.' },
      {
        id: 'core',
        name: 'Reactor core (fuel and moderator)',
        what: 'Fuel rods of uranium oxide stand in water. U-235 nuclei split (fission), releasing heat and neutrons; the water slows the neutrons (moderator) so they cause more fissions.',
      },
      { id: 'rods', name: 'Control rods', what: 'Rods of a neutron-absorbing material. Lowering them absorbs more neutrons and slows the chain reaction; dropping them fully shuts it down.' },
      { id: 'coolant', name: 'Primary coolant loop and pump', what: 'Pressurised water carries the heat from the core to the steam generator and back, in a closed loop.' },
      { id: 'sg', name: 'Steam generator', what: 'A heat exchanger: the hot primary water boils a separate secondary loop into steam for the turbine — the turbine never sees the reactor water.' },
      ...TURBINE_HALL,
    ]
  if (type === 'hydro')
    return [
      { id: 'reservoir', name: 'Reservoir', what: 'Stores water at a height: potential energy E = ρgVH waiting to be used.' },
      { id: 'dam', name: 'Dam', what: 'Holds the water back and creates the head — the height difference between the reservoir and the tailrace.' },
      { id: 'penstock', name: 'Penstock', what: 'A large steel pipe that carries the water from the intake down to the turbine, turning height into pressure.' },
      {
        id: 'turbine',
        name: 'Water turbine',
        what: 'The water’s pressure and speed turn the runner. The type suits the head: Pelton for high heads, Francis for medium heads, Kaplan for low heads and large flows.',
      },
      { id: 'generator', name: 'Generator', what: 'On a vertical shaft above the turbine: a slow, many-pole synchronous generator.' },
      { id: 'tailrace', name: 'Tailrace', what: 'Where the water leaves the turbine and returns to the river — the lower level of the head.' },
      { id: 'transformer', name: 'Step-up transformer', what: 'Raises the generator voltage for transmission.' },
    ]
  return [
    { id: 'upper', name: 'Upper reservoir', what: 'Water pumped up here stores energy as height (E = ρgVH) until it is needed.' },
    { id: 'penstock', name: 'Penstock / tunnel', what: 'The same pipe carries water down to generate and up when pumping. The arrows show the direction for the mode chosen.' },
    { id: 'machine', name: 'Pump-turbine', what: 'One reversible machine: turned one way it is a turbine, driven the other way it is a pump.' },
    { id: 'motorgen', name: 'Motor-generator', what: 'The same synchronous machine: a generator when the water drives it, a motor (drawing power from the grid) when it drives the pump.' },
    { id: 'lower', name: 'Lower reservoir', what: 'The water collects here after generating, and is drawn from here when pumping.' },
    { id: 'transformer', name: 'Step-up transformer', what: 'Connects the machine to the grid in both directions.' },
  ]
}

function Dl({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="gen-info">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Live values for the selected part (from the model). */
export function PlantInfo({ id, p, res }: { id: string; p: Plants; res: PlantResults }): ReactNode {
  const t = p.type
  if (t === 'thermal') {
    if (!res.thermal.ok) return <p className="small">No values: the inputs are not valid.</p>
    const r = res.thermal
    const i = p.thermal
    const m: Record<string, Array<[string, ReactNode]>> = {
      coal: [
        ['Coal burnt', `${grp(r.fuelKgH / 1000, 1)} t/h · ${grp(r.fuelTDay, 0)} t/day`],
        ['Calorific value', `${grp(i.cvKjKg, 0)} kJ/kg`],
        ['Heat it brings', `${grp(r.qInMw, 0)} MW`],
      ],
      boiler: [
        ['Fuel heat in', `${grp(r.qInMw, 0)} MW`],
        ['Boiler efficiency', pc(i.etaBoiler)],
        ['Heat into steam', `${grp(r.steamMw, 0)} MW`],
        ['Boiler losses', `${grp(r.boilerLossMw, 0)} MW`],
      ],
      stack: [
        ['Heat lost up the stack and elsewhere in the boiler', `${grp(r.boilerLossMw, 0)} MW`],
        ['CO₂ (illustrative factor)', `${grp(r.co2TH, 0)} t/h`],
      ],
      turbine: [
        ['Heat into steam', `${grp(r.steamMw, 0)} MW`],
        ['Steam-cycle efficiency', pc(i.etaCycle)],
        ['Shaft power', `${grp(r.mechMw, 1)} MW`],
        ['Carnot limit (illustrative)', `${pc(r.carnot)} for ${T_STEAM_C} °C / ${T_COOL_C} °C`],
      ],
      generator: [
        ['Shaft power in', `${grp(r.mechMw, 1)} MW`],
        ['Generator efficiency', pc(i.etaGen)],
        ['Electrical output', `${grp(i.pMw, 0)} MW`],
        ['Station efficiency', `${pc(r.eta)} · heat rate ${grp(r.heatRate, 0)} kJ/kWh`],
      ],
      condenser: [
        ['Heat rejected', `${grp(r.condenserMw, 0)} MW (${pc(r.condenserMw / r.qInMw)} of the fuel heat)`],
        ['Cooling water', `${fx(r.coolingM3s, 1)} m³/s for a ${i.dTCondK} K rise`],
      ],
      tower: [
        ['Heat to the air', `${grp(r.condenserMw, 0)} MW`],
        ['Compared with the output', `${fx(r.condenserMw / i.pMw, 2)} × the electrical power`],
      ],
      transformer: [['Power out to the grid', `${grp(i.pMw, 0)} MW`]],
      pump: [['Feed water', 'the same mass of water the boiler turns into steam, back at boiler pressure (pump power not modelled)']],
    }
    return <Dl rows={m[id] ?? []} />
  }
  if (t === 'nuclear') {
    if (!res.nuclear.ok) return <p className="small">No values: the inputs are not valid.</p>
    const r = res.nuclear
    const i = p.nuclear
    const m: Record<string, Array<[string, ReactNode]>> = {
      containment: [['What it holds', `a core producing ${grp(r.thermalMw, 0)} MW of heat`]],
      core: [
        ['Heat produced', `${grp(r.thermalMw, 0)} MW`],
        ['Fissions per second', sci(r.fissionsPerS)],
        ['U-235 fissioned', `${fx(r.kgPerDay, 2)} kg/day`],
        ['Energy per fission', `≈ ${MEV_PER_FISSION} MeV (approximate)`],
      ],
      rods: [['Their job here', `hold the fission rate steady at ${sci(r.fissionsPerS)} per second`]],
      coolant: [['Heat carried', `${grp(r.thermalMw, 0)} MW, core → steam generator`]],
      sg: [['Heat to the steam', `${grp(r.thermalMw, 0)} MW`]],
      turbine: [['Overall thermal efficiency', pc(i.etaTh)]],
      generator: [
        ['Electrical output', `${grp(i.pMw, 0)} MW`],
        ['Thermal efficiency', pc(i.etaTh)],
      ],
      condenser: [['Heat rejected', `${grp(r.rejectedMw, 0)} MW (all losses lumped here)`]],
      tower: [['Heat to the air', `${grp(r.rejectedMw, 0)} MW`]],
      transformer: [['Power out', `${grp(i.pMw, 0)} MW`]],
    }
    return <Dl rows={m[id] ?? []} />
  }
  if (t === 'hydro') {
    if (!res.hydro.ok) return <p className="small">No values: the inputs are not valid.</p>
    const r = res.hydro
    const i = p.hydro
    const m: Record<string, Array<[string, ReactNode]>> = {
      reservoir: [
        ['Usable volume', `${grp(i.volumeMm3, 0)} million m³`],
        ['Energy stored ρgVH', `${grp(r.storedMwh, 0)} MWh`],
        ['As electricity (× η)', `${grp(r.electricalMwh, 0)} MWh`],
        ['Lasts at this output', `${grp(r.hours, 1)} h`],
      ],
      dam: [['Head it creates', `${grp(i.headM, 0)} m`]],
      penstock: [
        ['Flow', `${grp(r.qM3s, 1)} m³/s`],
        ['Power in the water ρgQH', `${grp(r.waterMw, 1)} MW`],
      ],
      turbine: [
        ['Turbine efficiency', pc(i.etaTurbine)],
        ['Shaft power', `${grp(r.mechMw, 1)} MW`],
        ['Water per MWh', `${grp(r.m3PerMwh, 0)} m³`],
      ],
      generator: [
        ['Generator efficiency', pc(i.etaGen)],
        ['Electrical output', `${grp(i.pMw, 0)} MW`],
      ],
      tailrace: [['Water returned', `${grp(r.qM3s, 1)} m³/s`]],
      transformer: [['Power out', `${grp(i.pMw, 0)} MW`]],
    }
    return <Dl rows={m[id] ?? []} />
  }
  if (!res.pumped.ok) return <p className="small">No values: the inputs are not valid.</p>
  const r = res.pumped
  const i = p.pumped
  const gen = i.mode === 'generate'
  const m: Record<string, Array<[string, ReactNode]>> = {
    upper: [
      ['Water raised', `${grp(r.volumeM3 / 1e6, 2)} million m³ in ${grp(i.hoursPumping, 1)} h`],
      ['Energy stored', `${grp(r.storedMwh, 0)} MWh`],
    ],
    penstock: [['Flow', gen ? `${grp(r.qGen, 1)} m³/s down (generating)` : `${grp(r.qPump, 1)} m³/s up (pumping)`]],
    machine: gen
      ? [
          ['As a turbine', pc(i.etaTurbine)],
          ['Flow', `${grp(r.qGen, 1)} m³/s`],
        ]
      : [
          ['As a pump', pc(i.etaPump)],
          ['Flow', `${grp(r.qPump, 1)} m³/s`],
        ],
    motorgen: gen
      ? [
          ['As a generator', pc(i.etaGen)],
          ['Power to the grid', `${grp(i.pMw, 0)} MW for ${grp(r.hoursGen, 2)} h`],
        ]
      : [
          ['As a motor', pc(i.etaMotor)],
          ['Power from the grid', `${grp(i.pMw, 0)} MW for ${grp(i.hoursPumping, 1)} h`],
        ],
    lower: [['Round trip', `${grp(r.eInMwh, 0)} MWh in → ${grp(r.eOutMwh, 0)} MWh back (${pc(r.etaRt)})`]],
    transformer: [['Energy through it', `${grp(r.eInMwh, 0)} MWh in, ${grp(r.eOutMwh, 0)} MWh out`]],
  }
  return <Dl rows={m[id] ?? []} />
}

export function plantTour(p: Plants, res: PlantResults): TourStep[] | undefined {
  if (p.type === 'thermal' && res.thermal.ok) {
    const r = res.thermal
    const condBiggest = r.condenserMw >= Math.max(r.boilerLossMw, r.genLossMw)
    return [
      {
        title: 'Coal in',
        focus: ['coal'],
        camera: [-14, 9, 20],
        text: (
          <p>
            The station burns {grp(r.fuelKgH / 1000, 0)} tonnes of coal an hour — {grp(r.fuelTDay, 0)} t a day — to make {grp(p.thermal.pMw, 0)} MW.
          </p>
        ),
      },
      {
        title: 'Heat makes steam',
        focus: ['boiler'],
        camera: [-4, 12, 22],
        text: (
          <p>
            Of the {grp(r.qInMw, 0)} MW of fuel heat, the boiler puts {grp(r.steamMw, 0)} MW into high-pressure steam; {grp(r.boilerLossMw, 0)} MW is lost, most of it up the stack.
          </p>
        ),
      },
      {
        title: 'Steam turns the turbine',
        focus: ['turbine'],
        camera: [4, 7, 15],
        text: (
          <p>
            Expanding through the blades, the steam gives {grp(r.mechMw, 0)} MW of shaft power — a steam-cycle efficiency of {pc(p.thermal.etaCycle)}, below the Carnot limit of {pc(r.carnot)} for the
            illustrative temperatures.
          </p>
        ),
      },
      {
        title: condBiggest ? 'The biggest single loss' : 'Heat leaves here',
        focus: ['condenser'],
        camera: [10, 6, 16],
        text: (
          <p>
            The condenser takes {grp(r.condenserMw, 0)} MW out of the exhaust steam — {pc(r.condenserMw / r.qInMw)} of the fuel heat{condBiggest ? ', the biggest single loss' : ''} — and the cooling
            tower releases it to the air. The water goes back to the boiler through the feed pump.
          </p>
        ),
      },
      {
        title: 'Electricity out',
        focus: ['generator'],
        camera: [12, 8, 18],
        text: (
          <p>
            The generator delivers {grp(p.thermal.pMw, 0)} MW: {pc(r.eta)} of the fuel heat, a heat rate of {grp(r.heatRate, 0)} kJ/kWh.
          </p>
        ),
      },
    ]
  }
  if (p.type === 'nuclear' && res.nuclear.ok) {
    const r = res.nuclear
    return [
      {
        title: 'Fission in the core',
        focus: ['core'],
        camera: [-8, 7, 12],
        text: (
          <p>
            About {sci(r.fissionsPerS)} U-235 nuclei split every second, each releasing ≈ {MEV_PER_FISSION} MeV: {grp(r.thermalMw, 0)} MW of heat — from only {fx(r.kgPerDay, 2)} kg of U-235 a day.
          </p>
        ),
      },
      { title: 'Control rods', focus: ['rods'], camera: [-8, 9, 10], text: <p>Rods that absorb neutrons set how many fissions the chain reaction sustains — and stop it when dropped in fully.</p> },
      {
        title: 'Heat to steam',
        focus: ['sg'],
        camera: [-4, 8, 14],
        text: <p>Pressurised water carries the heat to the steam generator, which boils a separate loop of water: from here on the station is a steam station like the coal one.</p>,
      },
      {
        title: 'The same turbine hall',
        focus: ['generator'],
        camera: [10, 8, 18],
        text: (
          <p>
            {grp(p.nuclear.pMw, 0)} MW of electricity at {pc(p.nuclear.etaTh)} thermal efficiency; {grp(r.rejectedMw, 0)} MW of heat leaves through the condenser and cooling tower.
          </p>
        ),
      },
    ]
  }
  if (p.type === 'hydro' && res.hydro.ok) {
    const r = res.hydro
    return [
      {
        title: 'Water held high',
        focus: ['reservoir'],
        camera: [-14, 12, 22],
        text: (
          <p>
            The reservoir holds {grp(p.hydro.volumeMm3, 0)} million m³ of usable water, {grp(p.hydro.headM, 0)} m above the tailrace: {grp(r.storedMwh, 0)} MWh of potential energy.
          </p>
        ),
      },
      {
        title: 'Down the penstock',
        focus: ['penstock'],
        camera: [0, 10, 20],
        text: (
          <p>
            To make {grp(p.hydro.pMw, 0)} MW the turbine needs {grp(r.qM3s, 1)} m³ of water every second, carrying ρgQH = {grp(r.waterMw, 1)} MW.
          </p>
        ),
      },
      {
        title: 'Turbine and generator',
        focus: ['turbine'],
        camera: [9, 6, 12],
        text: (
          <p>
            The runner turns at {pc(p.hydro.etaTurbine)} efficiency and the generator above it at {pc(p.hydro.etaGen)}: {pc(r.eta)} overall.
          </p>
        ),
      },
      { title: 'Back to the river', focus: ['tailrace'], camera: [14, 7, 16], text: <p>The water leaves through the tailrace. At this output the reservoir lasts {grp(r.hours, 1)} hours.</p> },
    ]
  }
  if (p.type === 'pumped' && res.pumped.ok) {
    const r = res.pumped
    return [
      {
        title: 'Off-peak: pump up',
        focus: ['machine'],
        camera: [9, 6, 12],
        text: (
          <p>
            At night the machine runs as a motor-driven pump: {grp(p.pumped.pMw, 0)} MW for {grp(p.pumped.hoursPumping, 1)} h draws {grp(r.eInMwh, 0)} MWh from the grid.
          </p>
        ),
      },
      {
        title: 'Energy stored as height',
        focus: ['upper'],
        camera: [-14, 12, 20],
        text: (
          <p>
            {grp(r.volumeM3 / 1e6, 2)} million m³ raised {grp(p.pumped.headM, 0)} m: {grp(r.storedMwh, 0)} MWh of potential energy.
          </p>
        ),
      },
      {
        title: 'Peak: generate',
        focus: ['motorgen'],
        camera: [9, 7, 14],
        text: (
          <p>
            At the evening peak the same machine runs as turbine and generator: {grp(r.eOutMwh, 0)} MWh comes back — {grp(r.hoursGen, 2)} h at {grp(p.pumped.pMw, 0)} MW.
          </p>
        ),
      },
      {
        title: 'The price of storing',
        focus: ['lower'],
        camera: [12, 8, 18],
        text: (
          <p>
            Round trip {pc(r.etaRt)}: {grp(r.eInMwh - r.eOutMwh, 0)} MWh is lost. Storing pays only if peak energy is worth more than {fx(r.breakEven, 2)} × off-peak energy.
          </p>
        ),
      },
    ]
  }
  return undefined
}

export interface PlantSceneProps {
  p: Plants
  res: PlantResults
  selected: string | null
  onSelect(id: string | null): void
  fallback: ReactNode
  tour?: boolean
  height?: number
}

export function PlantScene({ p, res, selected, onSelect, fallback, tour = true, height = 420 }: PlantSceneProps) {
  const parts = plantParts(p.type)
  return (
    <Scene3D
      key={p.type}
      label={`${PLANT_LABEL[p.type]} power station`}
      parts={parts}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: [12, 14, 34], target: [1, 3.5, -1], fov: 40 }}
      radius={17}
      fallback={fallback}
      info={(id) => <PlantInfo id={id} p={p} res={res} />}
      tour={tour ? plantTour(p, res) : undefined}
      height={height}
      deps={[p, res, selected]}
      kindNote={
        p.type === 'hydro' || p.type === 'pumped'
          ? 'Equipment and layout are schematic, not to scale; the drawn head grows with the chosen head on a compressed scale (its value is labelled). The numbers in the labels and the info panel are calculated; the water arrows follow the mode.'
          : 'Equipment and layout are schematic, not to scale (pipes show the water–steam loop, not sizes). The numbers in the labels and the info panel are calculated; the energy flows are drawn to scale in the chart below.'
      }
    >
      <Ground />
      {p.type === 'thermal' && <ThermalPlant res={res} p={p} />}
      {p.type === 'nuclear' && <NuclearPlant res={res} p={p} />}
      {p.type === 'hydro' && <HydroPlant res={res} p={p} />}
      {p.type === 'pumped' && <PumpedPlant res={res} p={p} />}
    </Scene3D>
  )
}
