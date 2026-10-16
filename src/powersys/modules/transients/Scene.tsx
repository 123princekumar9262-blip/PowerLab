import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { Label3D, Scene3D, SCENE_COLORS, Selectable, useHighlight, useScene, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { quartiles, termShort, type Solved } from './shared.tsx'
import { nextMedium, profile } from './waves.ts'

/*
 * The 3D line: a source, the line (towers, or a cable on low supports), the termination, the optional arrester and a
 * probe. The ribbon above the conductor is the voltage v(x, t) at the chosen time, computed by profile() — the same
 * function the 2D snapshot uses (CALCULATED: its height is to scale, its position along the line is to scale in
 * travel time). The line length is compressed to fit; towers, the source building and the symbols are illustrations.
 */

type V3 = [number, number, number]
export const PART_IDS = ['source', 'line', 'termination', 'arrester', 'probe'] as const

const LX = 60
const WAVE_H = 6
const SAMPLES = 160

const tone = (h: ReturnType<typeof useHighlight>, base: string) =>
  h === 'selected' ? SCENE_COLORS.selected : h === 'hovered' ? SCENE_COLORS.hovered : h === 'dim' ? new THREE.Color(base).multiplyScalar(0.45).getStyle() : base

function Bar({ a, b, w, color }: { a: V3; b: V3; w: number; color: string }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const d = vb.clone().sub(va)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
    return { pos: va.add(vb).multiplyScalar(0.5), quat: q, len: d.length() }
  }, [a, b])
  return (
    <mesh position={pos} quaternion={quat}>
      <boxGeometry args={[w, len, w]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
    </mesh>
  )
}

function Tower({ x, y0, color }: { x: number; y0: number; color: string }) {
  const top = y0 + 1.6
  return (
    <group position={[x, 0, 0]}>
      <Bar a={[-1.4, 0, -1]} b={[-0.3, top, 0]} w={0.16} color={color} />
      <Bar a={[1.4, 0, -1]} b={[0.3, top, 0]} w={0.16} color={color} />
      <Bar a={[-1.4, 0, 1]} b={[-0.3, top, 0]} w={0.16} color={color} />
      <Bar a={[1.4, 0, 1]} b={[0.3, top, 0]} w={0.16} color={color} />
      <Bar a={[0, top, -2.2]} b={[0, top, 2.2]} w={0.16} color={color} />
      <Bar a={[0, top, 0]} b={[0, y0 + 0.15, 0]} w={0.07} color={SCENE_COLORS.insulator} />
    </group>
  )
}

/** The voltage ribbon: vertices from the computed samples (bottom on the conductor, top at v·scale). */
function WaveRibbon({ pts, y0, scale, lengthKm }: { pts: Array<[number, number]>; y0: number; scale: number; lengthKm: number }) {
  const { invalidate } = useScene()
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SAMPLES * 2 * 3 + 6), 3))
    const idx: number[] = []
    for (let s = 0; s < SAMPLES; s++) {
      const a = 2 * s
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    g.setIndex(idx)
    return g
  }, [])
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SAMPLES + 1) * 3), 3))
    return g
  }, [])
  const lineObj = useMemo(() => new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#cfe1ff' })), [lineGeo])
  useLayoutEffect(() => {
    const p = geo.getAttribute('position') as THREE.BufferAttribute
    const q = lineGeo.getAttribute('position') as THREE.BufferAttribute
    pts.forEach(([km, v], s) => {
      const x = (km / lengthKm) * LX
      const y = y0 + v * scale
      p.setXYZ(2 * s, x, y0, 0)
      p.setXYZ(2 * s + 1, x, y, 0)
      q.setXYZ(s, x, y, 0)
    })
    p.needsUpdate = true
    q.needsUpdate = true
    geo.computeBoundingSphere()
    lineGeo.computeBoundingSphere()
    invalidate()
  }, [pts, y0, scale, lengthKm, geo, lineGeo, invalidate])
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color={SCENE_COLORS.accent} transparent opacity={0.32} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <primitive object={lineObj} />
    </group>
  )
}

function Source({ y0 }: { y0: number }) {
  const h = useHighlight('source')
  return (
    <Selectable id="source">
      <mesh position={[-5, 1.6, 0]}>
        <boxGeometry args={[3.2, 3.2, 3.2]} />
        <meshStandardMaterial color={tone(h, '#58677a')} roughness={0.8} />
      </mesh>
      <Bar a={[-3.4, 3, 0]} b={[0, y0, 0]} w={0.08} color={tone(h, SCENE_COLORS.steel)} />
      <Label3D position={[-5, 4.4, 0]}>Source e(t), R_s</Label3D>
    </Selectable>
  )
}

function Line({ s, y0, cable }: { s: Solved; y0: number; cable: boolean }) {
  const h = useHighlight('line')
  const towers = [0, 15, 30, 45, 60]
  return (
    <Selectable id="line">
      <mesh position={[LX / 2, y0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[cable ? 0.32 : 0.09, cable ? 0.32 : 0.09, LX, 10]} />
        <meshStandardMaterial color={tone(h, cable ? '#2b3036' : SCENE_COLORS.phaseC)} metalness={cable ? 0.1 : 0.5} roughness={cable ? 0.8 : 0.4} />
      </mesh>
      {/* a fat invisible target for picking */}
      <mesh position={[LX / 2, y0, 0]} rotation={[0, 0, Math.PI / 2]} visible={false}>
        <cylinderGeometry args={[0.8, 0.8, LX, 6]} />
        <meshBasicMaterial />
      </mesh>
      {cable
        ? towers.map((x) => (
            <mesh key={x} position={[x, y0 / 2 - 0.15, 0]}>
              <boxGeometry args={[0.5, Math.max(0.3, y0 - 0.3), 0.9]} />
              <meshStandardMaterial color={tone(h, '#4c5563')} roughness={0.9} />
            </mesh>
          ))
        : towers.map((x) => <Tower key={x} x={x} y0={y0} color={tone(h, SCENE_COLORS.steel)} />)}
      <Label3D position={[LX * 0.3, y0 - (cable ? 1.6 : 2.2), 2.4]}>{s.an ? `${s.an.line.short}: Z_c ${fx(s.an.zc, 0)} Ω` : 'Line'}</Label3D>
    </Selectable>
  )
}

function Termination({ s, y0 }: { s: Solved; y0: number }) {
  const h = useHighlight('termination')
  const m = s.an!.model
  const x = LX + 2.2
  const lead = <Bar a={[LX, y0, 0]} b={[x, y0, 0]} w={0.07} color={tone(h, SCENE_COLORS.steel)} />
  let body: ReactNode = null
  if (m.term === 'open')
    body = (
      <mesh position={[x + 0.2, y0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.28, 0.28, 0.9, 10]} />
        <meshStandardMaterial color={tone(h, SCENE_COLORS.insulator)} />
      </mesh>
    )
  else if (m.term === 'short')
    body = (
      <>
        <Bar a={[x, y0, 0]} b={[x, 0, 0]} w={0.14} color={tone(h, SCENE_COLORS.warn)} />
        <mesh position={[x, 0.05, 0]}>
          <boxGeometry args={[1.2, 0.1, 1.2]} />
          <meshStandardMaterial color={tone(h, SCENE_COLORS.warn)} />
        </mesh>
      </>
    )
  else if (m.term === 'matched' || m.term === 'resistor')
    body = (
      <>
        <Bar a={[x, y0, 0]} b={[x, y0 * 0.62, 0]} w={0.07} color={tone(h, SCENE_COLORS.steel)} />
        <mesh position={[x, y0 * 0.42, 0]}>
          <boxGeometry args={[1.6, Math.max(0.6, y0 * 0.38), 1.6]} />
          <meshStandardMaterial color={tone(h, m.term === 'matched' ? '#3d7a5c' : '#7a6a3d')} roughness={0.7} />
        </mesh>
        <Bar a={[x, y0 * 0.22, 0]} b={[x, 0, 0]} w={0.07} color={tone(h, SCENE_COLORS.steel)} />
      </>
    )
  else {
    // a junction: the other medium continues beyond the end
    const other = nextMedium(m)
    const yb = other.kind === 'cable' ? 0.6 : 7.5
    body = (
      <>
        <Bar a={[x, y0, 0]} b={[x, yb, 0]} w={other.kind === 'cable' ? 0.5 : 0.09} color={tone(h, other.kind === 'cable' ? '#2b3036' : SCENE_COLORS.phaseC)} />
        <Bar a={[x, yb, 0]} b={[x + 16, yb, 0]} w={other.kind === 'cable' ? 0.55 : 0.12} color={tone(h, other.kind === 'cable' ? '#2b3036' : SCENE_COLORS.phaseC)} />
        <Bar a={[x - 0.5, 0, 0]} b={[x - 0.5, Math.max(y0, yb) + 0.8, 0]} w={0.3} color={tone(h, SCENE_COLORS.steelDark)} />
      </>
    )
  }
  return (
    <Selectable id="termination">
      {lead}
      {body}
      <Label3D position={[x + 3.2, y0 - 1.2, 0]}>{`End: ${termShort(m)}`}</Label3D>
    </Selectable>
  )
}

function Arrester({ on, y0, clampedNow }: { on: boolean; y0: number; clampedNow: boolean }) {
  const h = useHighlight('arrester')
  const discs = useMemo(() => Array.from({ length: 7 }, (_, k) => k), [])
  const x = LX + 0.9
  const top = y0 - 0.5
  const bottom = Math.max(0.4, top - 4)
  return (
    <Selectable id="arrester">
      <group position={[x, 0, 1.6]}>
        {discs.map((k) => (
          <mesh key={k} position={[0, bottom + ((top - bottom) * (k + 0.5)) / discs.length, 0]}>
            <cylinderGeometry args={[0.42, 0.42, ((top - bottom) / discs.length) * 0.7, 12]} />
            <meshStandardMaterial
              color={tone(h, on ? (clampedNow ? SCENE_COLORS.warn : '#9aa6b5') : '#4a5260')}
              transparent={!on}
              opacity={on ? 1 : 0.28}
              emissive={on && clampedNow ? SCENE_COLORS.warn : '#000000'}
              emissiveIntensity={on && clampedNow ? 0.35 : 0}
            />
          </mesh>
        ))}
        {on && <Bar a={[0, top, 0]} b={[-0.9, y0, -1.6]} w={0.06} color={SCENE_COLORS.steel} />}
        {on && <Bar a={[0, bottom, 0]} b={[0, 0, 0]} w={0.06} color={SCENE_COLORS.steel} />}
        <Label3D position={[1.4, 1.1, 0.8]}>{on ? (clampedNow ? 'Arrester: clamping' : 'Arrester') : 'Arrester (not fitted)'}</Label3D>
      </group>
    </Selectable>
  )
}

function Probe({ x, y0, v, cable }: { x: number; y0: number; v: number; cable: boolean }) {
  const h = useHighlight('probe')
  return (
    <Selectable id="probe">
      <mesh position={[x, y0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[cable ? 0.55 : 0.4, 0.09, 8, 20]} />
        <meshStandardMaterial color={tone(h, SCENE_COLORS.warn)} emissive={SCENE_COLORS.warn} emissiveIntensity={0.25} />
      </mesh>
      <Bar a={[x, y0 - 0.5, 0]} b={[x, y0 - 2.6, 0]} w={0.05} color={tone(h, SCENE_COLORS.warn)} />
      <Label3D position={[x, y0 - 3.2, 0]} className="is-value" always>
        probe {fx(v, 0)} kV
      </Label3D>
    </Selectable>
  )
}

function Ground() {
  return (
    <mesh position={[LX / 2, -0.05, 0]}>
      <boxGeometry args={[LX + 60, 0.1, 40]} />
      <meshStandardMaterial color={SCENE_COLORS.ground} roughness={1} />
    </mesh>
  )
}

export interface WaveSceneProps {
  s: Solved
  t: number
  probeX: number
  selected: string | null
  onSelect(id: string | null): void
  fallback: ReactNode
  info?(id: string): ReactNode
  tour?: TourStep[]
  height?: number
  label?: string
}

export function WaveScene({ s, t, probeX, selected, onSelect, fallback, info, tour, height = 400, label = 'A surge travelling along the line' }: WaveSceneProps) {
  const an = s.an!
  const f = s.f!
  const m = an.model
  const cable = an.line.kind === 'cable'
  const y0 = cable ? 1.4 : 7.5
  const pts = useMemo(() => profile(f, t, SAMPLES), [f, t])
  const scale = WAVE_H / s.vmax
  const vProbe = f.v(probeX, t)
  const end = f.end(t)
  const parts: ScenePart[] = [
    { id: 'source', name: 'Source', what: 'Where the surge enters: a voltage e(t) behind a resistance R_s (the rest of the network as the surge sees it).' },
    { id: 'line', name: cable ? 'Cable' : 'Line', what: 'Distributed inductance and capacitance: a voltage step travels along it as a wave at v = 1/√(LC).' },
    { id: 'termination', name: 'Termination', what: 'What the wave meets at the far end. Its impedance sets how much is reflected.' },
    { id: 'arrester', name: 'Surge arrester', what: 'A non-linear resistor from line to earth: it conducts only above its residual voltage, so it caps the voltage.' },
    { id: 'probe', name: 'Probe', what: 'The point where the voltage-time plot is read. Move it with the probe slider.' },
  ]
  return (
    <div className="tr-scene" data-wave={quartiles(pts)} data-t={t.toFixed(4)}>
      <Scene3D
        label={label}
        parts={parts}
        selected={selected}
        onSelect={onSelect}
        camera={{ position: [LX / 2, 17, 46], target: [LX / 2 + 1, 4, 0], fov: 40 }}
        radius={34}
        fallback={fallback}
        info={info}
        tour={tour}
        height={height}
        deps={[s, t, probeX, selected]}
        kindNote="The wave’s height is the computed voltage v(x, t) (to scale; full height = the largest voltage in the time shown) and its position is to scale along the line. The line length is compressed to fit; towers, the source building and the symbols are illustrations."
      >
        <Ground />
        <Source y0={y0} />
        <Line s={s} y0={y0} cable={cable} />
        <Termination s={s} y0={y0} />
        <Arrester on={m.arrester} y0={y0} clampedNow={m.arrester && end.clamped && t >= an.T} />
        <Probe x={(probeX / an.lengthM) * LX} y0={y0} v={vProbe} cable={cable} />
        <WaveRibbon pts={pts} y0={y0 + (cable ? 0.4 : 0)} scale={scale} lengthKm={m.lengthKm} />
        <Label3D position={[LX + 1, y0 + Math.max(0, end.v * scale) + 2.2, -0.5]} className="is-value" always>
          v(ℓ) {fx(end.v, 0)} kV
        </Label3D>
      </Scene3D>
    </div>
  )
}
