import { useMemo } from 'react'
import * as THREE from 'three'
import { Label3D, SCENE_COLORS, Scene3D, Selectable, useHighlight, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { TwoAreaDiagram } from './diagrams.tsx'
import { beta, type LfcParams, type LfcRun, type LfcSnap } from './lfc.ts'

/*
 * Two control areas joined by a tie line, in 3D. GEOMETRY: the equipment and its layout (schematic, not to scale).
 * CALCULATED (from the simulation at the time shown): each area's frequency needle (Δf), the generator output bars
 * (ΔP_m), the load-step bars (ΔP_L) and the tie-line arrows (direction and size from ΔP_tie12). Nothing moves on its
 * own: the picture changes only when the time shown or the model changes.
 */

const C1 = '#4f95ea'
const C2 = '#e0a91c'
const CTIE = '#9085e9'
const CLOAD = '#e66767'
const DIM = new THREE.Color('#1b222c')

function tone(h: ReturnType<typeof useHighlight>, base: string): string {
  if (h === 'selected') return SCENE_COLORS.selected
  if (h === 'hovered') return SCENE_COLORS.hovered
  if (h === 'dim') return '#' + new THREE.Color(base).lerp(DIM, 0.55).getHexString()
  return base
}

export const LFC_PARTS: ScenePart[] = [
  { id: 'gen1', name: 'Area 1 · turbine-generator', what: 'All of area 1’s generating units, lumped into one equivalent machine with one governor.' },
  { id: 'load1', name: 'Area 1 · load', what: 'Area 1’s consumers. The red bar is the sudden extra demand ΔP_L1.' },
  { id: 'gauge1', name: 'Area 1 · frequency', what: 'Area 1’s frequency deviation Δf₁ at the time shown.' },
  { id: 'tie', name: 'Tie line', what: 'The interconnection between the areas. Its power changes with the angle between them.' },
  { id: 'gen2', name: 'Area 2 · turbine-generator', what: 'All of area 2’s generating units, lumped into one equivalent machine with one governor.' },
  { id: 'load2', name: 'Area 2 · load', what: 'Area 2’s consumers.' },
  { id: 'gauge2', name: 'Area 2 · frequency', what: 'Area 2’s frequency deviation Δf₂ at the time shown.' },
]

/** A "nice" full scale for the frequency dials [Hz]. */
export function dialScale(run: LfcRun): number {
  const m = Math.max(Math.abs(run.nadir1), Math.abs(run.nadir2), ...run.df1.map(Math.abs), ...run.df2.map(Math.abs), 1e-3) * 1.1
  return [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((s) => s >= m) ?? 5
}
/** The power that fills a bar [pu]. */
export function barScale(p: LfcParams, run: LfcRun): number {
  const m = Math.max(Math.abs(p.dPL1), Math.abs(p.dPL2), ...run.pm1.map(Math.abs), ...run.pm2.map(Math.abs), ...run.tie.map(Math.abs), 1e-3)
  return m * 1.05
}

const BAR_H = 2.0

function Bar({ x, z, value, scale, color, label, always }: { x: number; z: number; value: number; scale: number; color: string; label: string; always?: boolean }) {
  const h = Math.max(0.02, (Math.min(Math.abs(value), scale * 1.5) / scale) * BAR_H)
  const neg = value < 0
  return (
    <group position={[x, 0.1, z]}>
      {/* height ∝ |value|; a negative value is drawn translucent (its label carries the sign) */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[0.36, h, 0.36]} />
        <meshStandardMaterial color={color} roughness={0.55} transparent={neg} opacity={neg ? 0.4 : 1} />
      </mesh>
      {/* the full-scale frame (empty glass) */}
      <mesh position={[0, BAR_H / 2, 0]}>
        <boxGeometry args={[0.4, BAR_H, 0.4]} />
        <meshStandardMaterial color="#9fb0c4" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <Label3D position={[0, BAR_H + 0.3, 0]} className="is-value" always={always}>
        {label}
      </Label3D>
    </group>
  )
}

/** inner = +1 for area 1 (the tie is to its right), −1 for area 2: the two areas are mirror images. */
function Station({ id, cx, color, pm, scale, k }: { id: string; cx: number; color: string; pm: number; scale: number; k: 1 | 2 }) {
  const inner = k === 1 ? 1 : -1
  const h = useHighlight(id)
  const body = tone(h, color)
  const steel = tone(h, SCENE_COLORS.steel)
  return (
    <Selectable id={id} position={[cx - inner * 0.7, 0, -1.6]}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[3.0, 0.3, 1.2]} />
        <meshStandardMaterial color={tone(h, SCENE_COLORS.steelDark)} roughness={0.8} />
      </mesh>
      {/* turbine (steam, three casings stepping up in size) */}
      {[
        [-1.15, 0.36],
        [-0.75, 0.44],
        [-0.3, 0.5],
      ].map(([x, r], j) => (
        <mesh key={j} position={[inner * x, 0.35 + r, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[r, r, 0.38, 20]} />
          <meshStandardMaterial color={steel} metalness={0.4} roughness={0.45} />
        </mesh>
      ))}
      {/* shaft */}
      <mesh position={[inner * 0.1, 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.5, 10]} />
        <meshStandardMaterial color={steel} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* generator */}
      <mesh position={[inner * 0.8, 0.9, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.55, 0.55, 1.1, 24]} />
        <meshStandardMaterial color={body} metalness={0.2} roughness={0.5} />
      </mesh>
      <Bar x={inner * 2.7} z={0} value={pm} scale={scale} color={color} label={`ΔP_m${k === 1 ? '₁' : '₂'} ${fx(pm, 3)} pu`} always />
    </Selectable>
  )
}

function Load({ id, cx, dPL, scale, k }: { id: string; cx: number; dPL: number; scale: number; k: 1 | 2 }) {
  const inner = k === 1 ? 1 : -1
  const h = useHighlight(id)
  const b = tone(h, '#5b6b80')
  const blocks: Array<[number, number, number, number]> = [
    [-0.7, 0.9, 0.7, 0.6],
    [0.1, 1.5, 0.6, 0.6],
    [0.8, 0.7, 0.7, 0.7],
    [-0.2, 0.55, 0.9, 0.5],
  ]
  return (
    <Selectable id={id} position={[cx - inner * 0.2, 0, 1.5]}>
      {blocks.map(([x, hh, w, d], j) => (
        <mesh key={j} position={[inner * x, 0.1 + hh / 2, j === 3 ? 0.75 : 0]}>
          <boxGeometry args={[w, hh, d]} />
          <meshStandardMaterial color={b} roughness={0.85} />
        </mesh>
      ))}
      {Math.abs(dPL) > 1e-9 && <Bar x={inner * 2.2} z={0} value={dPL} scale={scale} color={CLOAD} label={`ΔP_L${k === 1 ? '₁' : '₂'} ${dPL > 0 ? '+' : ''}${fx(dPL, 2)} pu`} always />}
    </Selectable>
  )
}

function Gauge({ id, cx, df, fs, color, k }: { id: string; cx: number; df: number; fs: number; color: string; k: 1 | 2 }) {
  const inner = k === 1 ? 1 : -1
  const h = useHighlight(id)
  const ang = Math.max(-1.1, Math.min(1.1, -df / fs)) * (Math.PI / 3)
  const ticks = [-3, -2, -1, 0, 1, 2, 3]
  return (
    <Selectable id={id} position={[cx - inner * 2.75, 0, 0.3]}>
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[0.12, 2.0, 0.12]} />
        <meshStandardMaterial color={tone(h, SCENE_COLORS.steelDark)} />
      </mesh>
      <group position={[0, 2.75, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.85, 0.85, 0.08, 40]} />
          <meshStandardMaterial color={tone(h, '#263040')} roughness={0.6} />
        </mesh>
        {ticks.map((t) => {
          const a = (t / 3) * (Math.PI / 3)
          return (
            <mesh key={t} position={[-Math.sin(a) * 0.68, Math.cos(a) * 0.68, 0.05]} rotation={[0, 0, a]}>
              <boxGeometry args={[t === 0 ? 0.05 : 0.03, t === 0 ? 0.2 : 0.12, 0.02]} />
              <meshStandardMaterial color={t === 0 ? '#e8ecf2' : '#8591a3'} />
            </mesh>
          )
        })}
        {/* needle: pivots at the dial centre, points up at Δf = 0, to the left when the frequency falls */}
        <group rotation={[0, 0, ang]}>
          <mesh position={[0, 0.32, 0.07]}>
            <boxGeometry args={[0.05, 0.64, 0.02]} />
            <meshStandardMaterial color={tone(h, color)} emissive={color} emissiveIntensity={0.25} />
          </mesh>
        </group>
        <mesh position={[0, 0, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.03, 16]} />
          <meshStandardMaterial color="#e8ecf2" />
        </mesh>
        <Label3D position={[0, -1.15, 0]} className="is-value" always>
          Δf{k === 1 ? '₁' : '₂'} {fx(df, 3)} Hz
        </Label3D>
      </group>
    </Selectable>
  )
}

function Tower({ x, color }: { x: number; color: string }) {
  return (
    <group position={[x, 0, 0]}>
      {[-0.22, 0.22].map((dx) => (
        <mesh key={dx} position={[dx * 0.6, 1.2, 0]} rotation={[0, 0, dx > 0 ? -0.08 : 0.08]}>
          <boxGeometry args={[0.08, 2.4, 0.08]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.35, 0]}>
        <boxGeometry args={[0.08, 0.08, 1.3]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
      </mesh>
    </group>
  )
}

function TieLine({ tie, scale }: { tie: number; scale: number }) {
  const h = useHighlight('tie')
  const steel = tone(h, SCENE_COLORS.steel)
  const wire = tone(h, CTIE)
  const xs = [-2.3, -0.8, 0.8, 2.3]
  const show = Math.abs(tie) > scale * 0.01
  const size = 0.5 + 0.9 * Math.min(1, Math.abs(tie) / scale)
  const dir = tie >= 0 ? -Math.PI / 2 : Math.PI / 2 // cone points +y; −90° about z → +x (area 1 → area 2)
  return (
    <Selectable id="tie">
      {xs.map((x) => (
        <Tower key={x} x={x} color={steel} />
      ))}
      {[-0.6, 0.6].map((z) => (
        <mesh key={z} position={[0, 2.3, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 4.6, 6]} />
          <meshStandardMaterial color={wire} emissive={CTIE} emissiveIntensity={h === 'normal' ? 0.15 : 0} />
        </mesh>
      ))}
      {show &&
        [-1.55, 0, 1.55].map((x) => (
          <mesh key={x} position={[x, 3.2, 0]} rotation={[0, 0, dir]} scale={[size, size, size]}>
            <coneGeometry args={[0.16, 0.42, 16]} />
            <meshStandardMaterial color={CTIE} emissive={CTIE} emissiveIntensity={0.35} />
          </mesh>
        ))}
      <Label3D position={[0, 3.85, 0]} className="is-value" always>
        ΔP_tie12 {fx(tie, 3)} pu{show ? (tie < 0 ? ' · area 2 → area 1' : ' · area 1 → area 2') : ''}
      </Label3D>
    </Selectable>
  )
}

function Ground() {
  return (
    <>
      <mesh position={[-5.2, -0.05, 0]}>
        <boxGeometry args={[7.2, 0.1, 6]} />
        <meshStandardMaterial color="#17202b" roughness={1} />
      </mesh>
      <mesh position={[5.2, -0.05, 0]}>
        <boxGeometry args={[7.2, 0.1, 6]} />
        <meshStandardMaterial color="#1d1d1a" roughness={1} />
      </mesh>
      <mesh position={[0, -0.08, 0]}>
        <boxGeometry args={[3.2, 0.06, 2.2]} />
        <meshStandardMaterial color={SCENE_COLORS.ground} roughness={1} />
      </mesh>
      {/* area edges in the area colours */}
      <mesh position={[-5.2, 0.005, 3.0]}>
        <boxGeometry args={[7.2, 0.02, 0.05]} />
        <meshStandardMaterial color={C1} />
      </mesh>
      <mesh position={[5.2, 0.005, 3.0]}>
        <boxGeometry args={[7.2, 0.02, 0.05]} />
        <meshStandardMaterial color={C2} />
      </mesh>
      <Label3D position={[-5.2, 0.05, 3.35]}>Area 1</Label3D>
      <Label3D position={[5.2, 0.05, 3.35]}>Area 2</Label3D>
    </>
  )
}

export function LfcWorld({ p, at, fs, ps }: { p: LfcParams; at: LfcSnap; fs: number; ps: number }) {
  return (
    <>
      <Ground />
      <Station id="gen1" cx={-5.2} color={C1} pm={at.pm1} scale={ps} k={1} />
      <Load id="load1" cx={-5.2} dPL={p.dPL1} scale={ps} k={1} />
      <Gauge id="gauge1" cx={-5.2} df={at.df1} fs={fs} color={C1} k={1} />
      <Station id="gen2" cx={5.2} color={C2} pm={at.pm2} scale={ps} k={2} />
      <Load id="load2" cx={5.2} dPL={p.dPL2} scale={ps} k={2} />
      <Gauge id="gauge2" cx={5.2} df={at.df2} fs={fs} color={C2} k={2} />
      {p.T12 > 0 ? (
        <TieLine tie={at.tie} scale={ps} />
      ) : (
        <Label3D position={[0, 1.0, 0]} always>
          No tie line (T₁₂ = 0)
        </Label3D>
      )}
    </>
  )
}

/** What the info panel shows for a selected part: its live values at the time shown. */
function PartInfo({ id, p, at, run }: { id: string; p: LfcParams; at: LfcSnap; run: LfcRun }) {
  const rows: Array<[string, string]> = []
  const k = id.endsWith('2') ? 2 : 1
  const a = k === 1 ? p.a1 : p.a2
  const df = k === 1 ? at.df1 : at.df2
  if (id.startsWith('gen')) {
    const pm = k === 1 ? at.pm1 : at.pm2
    rows.push(
      ['Extra output ΔP_m', `${fx(pm, 4)} pu (${fx(pm * p.sBase, 1)} MW)`],
      ['Droop R', `${fx(a.R * 100, 1)} %  →  1/R = ${fx(1 / a.R, 1)} pu/pu`],
      ['Governor says', `ΔP_m → −Δf/R = ${fx(-(df / p.f0) / a.R, 4)} pu`],
    )
    const agc = k === 1 ? p.agc1 : p.agc2
    rows.push(['AGC', agc ? `on · ACE ${fx(k === 1 ? at.ace1 : at.ace2, 4)} pu` : 'off'])
  } else if (id.startsWith('load')) {
    const dPL = k === 1 ? p.dPL1 : p.dPL2
    rows.push(['Load step ΔP_L', `${fx(dPL, 3)} pu (${fx(dPL * p.sBase, 0)} MW)`], ['Load relief D·Δf', `${fx(a.D * (df / p.f0), 5)} pu`], ['Damping D', `${fx(a.D, 2)} pu/pu`])
  } else if (id.startsWith('gauge')) {
    const nadir = k === 1 ? run.nadir1 : run.nadir2
    const tN = k === 1 ? run.tNadir1 : run.tNadir2
    rows.push(['Δf', `${fx(df, 4)} Hz`], ['Frequency', `${fx(p.f0 + df, 3)} Hz`], ['Nadir of the run', `${fx(nadir, 3)} Hz at ${fx(tN, 2)} s`], ['β = D + 1/R', `${fx(beta(a), 1)} pu/pu`])
  } else if (id === 'tie') {
    rows.push(
      ['ΔP_tie12', `${fx(at.tie, 4)} pu (${fx(at.tie * p.sBase, 1)} MW)`],
      ['Direction', Math.abs(at.tie) < 1e-6 ? '—' : at.tie < 0 ? 'area 2 → area 1' : 'area 1 → area 2'],
      ['Δf₁ − Δf₂', `${fx(at.df1 - at.df2, 4)} Hz`],
      ['T₁₂', `${fx(p.T12, 3)} pu/rad`],
    )
  }
  return (
    <dl className="ps-gc-info">
      {rows.map(([l, v]) => (
        <div key={l}>
          <dt>{l}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      <div>
        <dt>Time shown</dt>
        <dd>t = {fx(at.t, 2)} s</dd>
      </div>
    </dl>
  )
}

export function LfcScene({
  p,
  run,
  at,
  selected,
  onSelect,
  height = 360,
  tour,
  highlight,
}: {
  p: LfcParams
  run: LfcRun
  at: LfcSnap
  selected: string | null
  onSelect(id: string | null): void
  height?: number
  tour?: TourStep[]
  highlight?: string[]
}) {
  const fs = useMemo(() => dialScale(run), [run])
  const ps = useMemo(() => barScale(p, run), [p, run])
  return (
    <Scene3D
      label="Two control areas joined by a tie line"
      parts={LFC_PARTS}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: [0, 5.4, 10.2], target: [0, 1.1, 0], fov: 40 }}
      radius={8.5}
      height={height}
      deps={[at, p, fs, ps]}
      tour={tour}
      kindNote={`Calculated at t = ${fx(at.t, 2)} s: needles (Δf, full scale ±${fs} Hz), output and load bars (ΔP_m, ΔP_L, full bar = ${fx(ps, 3)} pu), tie-line arrows (ΔP_tie). Equipment shapes are schematic, not to scale.`}
      info={(id) => <PartInfo id={id} p={p} at={at} run={run} />}
      fallback={
        <TwoAreaDiagram p={p} at={at} highlight={highlight} label={`Two-area block diagram at t = ${fx(at.t, 2)} s: Δf₁ ${fx(at.df1, 3)} Hz, Δf₂ ${fx(at.df2, 3)} Hz, ΔP_tie12 ${fx(at.tie, 4)} pu`} />
      }
    >
      <LfcWorld p={p} at={at} fs={fs} ps={ps} />
    </Scene3D>
  )
}
