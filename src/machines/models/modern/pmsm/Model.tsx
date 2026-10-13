import { useMemo } from 'react'
import * as THREE from 'three'
import { invPark } from '../../../calculations/modern.ts'
import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { Arrow, CurvedArrow, FlowLine, LAYER_COLOR, Marker, Spin } from '../../../visualizations/viz.tsx'
import { Bearing, deg, EndCap, extrude, Housing, LamLines, MAT, PHASE_COLOR, polar, ring, Shaft, statorShape, useDiscrete, WaveChart } from '../shared.tsx'

/*
 * IPM PMSM — original procedural geometry (simplified). 24 slots at 7.5° + k·15°, belts of 2 slots:
 * A, −C, B, −A, C, −B (counter-clockwise), twice, placed so that phase A's axis is at 0° (A+ belt centred at −45°). Full-pitch coils join slot s to slot s + 6 (90° mechanical =
 * 180° electrical). Rotor: 4 buried flat magnets, N outwards at 0° and 180°. θe = 2·θm; the rotor turns
 * counter-clockwise. With id = 0 the stator field's S poles are 90° electrical (45° mechanical) ahead of the rotor N
 * poles, so they turn with the rotor: the stator-field markers are drawn in the rotor frame on purpose.
 */
const STACK = 1.2
const SLOTS = 24
const BELTS: Array<{ ph: 'A' | 'B' | 'C'; sign: 1 | -1 }> = [
  { ph: 'A', sign: 1 },
  { ph: 'C', sign: -1 },
  { ph: 'B', sign: 1 },
  { ph: 'A', sign: -1 },
  { ph: 'C', sign: 1 },
  { ph: 'B', sign: -1 },
]
const LAYER = { A: 0, B: 1, C: 2 } as const
const slotAngle = (s: number) => deg(7.5 + 15 * s)
// belt j (centre 15° + 30°·j) carries pattern entry (j + 2) mod 6: phase A's axis is then at 0° (A+ at −45°, −A at +45°)
const beltOf = (j: number) => BELTS[(j + 2) % 6]
const belt = (s: number) => beltOf(Math.floor(s / 2))
const zEnd = (ph: 'A' | 'B' | 'C') => STACK / 2 + 0.06 + LAYER[ph] * 0.075
const thetaE = (angle: number) => (2 * angle * 180) / Math.PI

function rotorShape() {
  const s = new THREE.Shape()
  s.absarc(0, 0, 0.64, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.13, 0, Math.PI * 2, true)
  s.holes.push(hole)
  for (let k = 0; k < 4; k++) {
    const c = deg(k * 90)
    const u = new THREE.Vector2(Math.cos(c), Math.sin(c))
    const v = new THREE.Vector2(-Math.sin(c), Math.cos(c))
    const P = (r: number, t: number) => new THREE.Vector2(u.x * r + v.x * t, u.y * r + v.y * t)
    const pocket = new THREE.Path([P(0.43, -0.25), P(0.43, 0.25), P(0.51, 0.25), P(0.51, -0.25)])
    s.holes.push(pocket)
  }
  return s
}

export function PmsmModel({ state }: { state: ModelState }) {
  const geo = useMemo(
    () => ({
      stator: extrude(statorShape({ rOut: 1.12, rYoke: 0.95, rBore: 0.66, n: SLOTS, w: 0.085, shoeHalf: deg(6), shoeDepth: 0.025 }), STACK, 8),
      rotor: extrude(rotorShape(), STACK, 32),
      resolverStator: ring(0.2, 0.34, 0.12, 32),
      resolverRotor: (() => {
        const sh = new THREE.Shape()
        sh.absellipse(0, 0, 0.17, 0.12, 0, Math.PI * 2, false, 0)
        const h = new THREE.Path()
        h.absarc(0, 0, 0.1, 0, Math.PI * 2, true)
        sh.holes.push(h)
        return extrude(sh, 0.1, 24)
      })(),
    }),
    [],
  )
  const L = state.layers
  // which belts carry clearly positive / negative current: changes every 30° electrical
  const k30 = useDiscrete((a) => Math.floor(thetaE(a) / 30))
  const currents = invPark(0, 1, deg((k30 + 0.5) * 30))
  const iOf = { A: currents[0], B: currents[1], C: currents[2] }

  return (
    <group>
      <Part id="housing">
        <Housing rIn={1.12} rOut={1.22} len={1.9} fins={28} />
      </Part>
      <Part id="terminal-box">
        <mesh position={[0, 1.43, 0.2]}>
          <boxGeometry args={[0.55, 0.26, 0.62]} />
          <meshStandardMaterial color={MAT.aluDark} metalness={0.5} roughness={0.45} />
        </mesh>
        {[-0.15, 0, 0.15].map((x, k) => (
          <mesh key={x} position={[x, 1.6, 0.2]}>
            <cylinderGeometry args={[0.035, 0.035, 0.08, 12]} />
            <meshStandardMaterial color={Object.values(PHASE_COLOR)[k]} metalness={0.4} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0.31, 1.43, 0.2]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.1, 16]} />
          <meshStandardMaterial color="#2a2d33" roughness={0.8} />
        </mesh>
      </Part>
      <Part id="end-cap-front">
        <EndCap r={1.22} z={1.05} dir={1} />
      </Part>
      <Part id="end-cap-rear">
        <EndCap r={1.22} z={-1.05} dir={-1} />
      </Part>
      <Part id="stator-core">
        <mesh geometry={geo.stator}>
          <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
        </mesh>
        <LamLines r={1.12} len={STACK} n={14} />
      </Part>
      <Part id="stator-winding">
        {Array.from({ length: SLOTS }, (_, s) => {
          const b = belt(s)
          const zl = zEnd(b.ph)
          return (
            <mesh key={s} position={polar(0.81, slotAngle(s))} rotation={[0, 0, slotAngle(s)]}>
              <boxGeometry args={[0.2, 0.078, 2 * zl]} />
              <meshStandardMaterial color={MAT.copper} metalness={0.65} roughness={0.38} />
            </mesh>
          )
        })}
        {Array.from({ length: SLOTS }, (_, s) => {
          const b = belt(s)
          if (b.sign < 0) return null // each coil starts in a + belt and returns in the − belt 6 slots on
          const zl = zEnd(b.ph)
          return [1, -1].map((side) => (
            <mesh key={`${s}${side}`} position={[0, 0, side * zl]} rotation={[0, 0, slotAngle(s)]}>
              <torusGeometry args={[0.81, 0.038, 8, 28, deg(90)]} />
              <meshStandardMaterial color={PHASE_COLOR[b.ph]} metalness={0.3} roughness={0.55} />
            </mesh>
          ))
        })}
      </Part>
      <Part id="bearing-front">
        <Bearing z={1.0} rIn={0.13} rOut={0.28} />
      </Part>
      <Part id="bearing-rear">
        <Bearing z={-1.0} rIn={0.13} rOut={0.28} />
      </Part>

      {/* ── rotor (counter-clockwise seen from the front) ── */}
      <Spin axis="z">
        <Part id="shaft">
          <Shaft r={0.13} z0={-1.15} z1={1.85} keyAt={1.6} />
          {/* the resolver rotor: an oval iron lamination on the shaft */}
          <mesh geometry={geo.resolverRotor} position={[0, 0, -0.8]}>
            <meshStandardMaterial color={MAT.darkSteel} metalness={0.7} roughness={0.4} />
          </mesh>
        </Part>
        <Part id="rotor-core">
          <mesh geometry={geo.rotor}>
            <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
          </mesh>
          <LamLines r={0.64} len={STACK} n={14} />
        </Part>
        <Part id="magnets">
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={polar(0.47, deg(k * 90))} rotation={[0, 0, deg(k * 90)]}>
              <boxGeometry args={[0.07, 0.42, STACK]} />
              <meshStandardMaterial color={k % 2 === 0 ? MAT.magnetN : MAT.magnetS} metalness={0.25} roughness={0.55} />
            </mesh>
          ))}
        </Part>
        {L.has('field') && (
          <group>
            {[0, 1, 2, 3].map((k) => (
              <Marker key={k} at={polar(0.36, deg(k * 90), 0.68)} text={k % 2 === 0 ? 'N' : 'S'} tone={k % 2 === 0 ? 'north' : 'south'} />
            ))}
            <Arrow from={[0.14, 0, 0.7]} dir={[1, 0, 0]} length={0.62} color={LAYER_COLOR.field} />
            <Marker at={[0.86, 0.0, 0.72]} text="d" tone="field" />
          </group>
        )}
        {L.has('rotatingField') && (
          <group>
            {[0, 1, 2, 3].map((k) => (
              <Marker key={k} at={polar(0.74, deg(45 + k * 90), 0.7)} text={k % 2 === 0 ? 'S' : 'N'} tone="field" />
            ))}
            <Arrow from={polar(0.14, deg(45), 0.7)} dir={[Math.cos(deg(45)), Math.sin(deg(45)), 0]} length={0.5} color={LAYER_COLOR.torque} />
            <Marker at={polar(0.6, deg(55), 0.72)} text="q" tone="torque" />
          </group>
        )}
      </Spin>
      <Part id="resolver">
        <mesh geometry={geo.resolverStator} position={[0, 0, -0.8]}>
          <meshStandardMaterial color={MAT.steel} metalness={0.6} roughness={0.4} />
        </mesh>
        {Array.from({ length: 8 }, (_, k) => (
          <mesh key={k} position={polar(0.27, deg(k * 45), -0.8)} rotation={[0, 0, deg(k * 45)]}>
            <boxGeometry args={[0.08, 0.06, 0.16]} />
            <meshStandardMaterial color={MAT.copper} metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
      </Part>

      {/* ── conceptual layers ── */}
      {L.has('current') && (
        <group>
          {Array.from({ length: 12 }, (_, j) => {
            const b = beltOf(j)
            const i = b.sign * iOf[b.ph]
            if (Math.abs(i) < 0.4) return null
            // positive direction of a + belt: into the screen (so that ia > 0 makes the field point along +A)
            return <Marker key={j} at={polar(0.81, deg(15 + 30 * j), STACK / 2 + 0.02)} text={i > 0 ? '⊗' : '⊙'} tone="current" />
          })}
          <WaveChart
            at={[-1.85, 1.55, 0.4]}
            title="Phase currents (id = 0) vs θe"
            angleOf={(a) => thetaE(a)}
            traces={[
              { label: 'ia', color: PHASE_COLOR.A, fn: (d) => invPark(0, 1, deg(d))[0] },
              { label: 'ib', color: PHASE_COLOR.B, fn: (d) => invPark(0, 1, deg(d))[1] },
              { label: 'ic', color: PHASE_COLOR.C, fn: (d) => invPark(0, 1, deg(d))[2] },
            ]}
          />
        </group>
      )}
      {L.has('torque') && (
        <group>
          <CurvedArrow radius={1.45} start={deg(-50)} sweep={deg(100)} z={0.8} color={LAYER_COLOR.torque} />
          <Marker at={polar(1.62, deg(56), 0.8)} text="T = 1.5·p·ψ·iq" tone="torque" />
        </group>
      )}
      {L.has('rotation') && <CurvedArrow radius={0.34} start={deg(-120)} sweep={deg(250)} z={1.95} color={LAYER_COLOR.rotation} tube={0.022} />}
      {L.has('energy') && (
        <group>
          <FlowLine points={[[0.31, 1.75, 0.2], [0.31, 1.45, 0.2], [0, 1.2, 0.2], [0, 0.85, 0.3], [0, 0.4, 0.5], [0, 0.1, 0.9], [0, 0, 1.4], [0, 0, 2.35]]} color={LAYER_COLOR.energy} rate={1} width={3.5} />
          <Marker at={[0.5, 1.9, 0.2]} text="Pin = 1.5·vq·iq (from the inverter)" tone="energy" />
          <Marker at={[0, -0.32, 2.35]} text="Pout = T·ωm" tone="energy" />
          <Marker at={[-1.2, -0.9, 0.8]} text="heat: stator copper + iron" tone="energy" />
        </group>
      )}
    </group>
  )
}
