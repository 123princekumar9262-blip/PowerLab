import { useMemo } from 'react'
import * as THREE from 'three'
import { sixStepFromHalls, sixStepSector, trapezoid, type Phase } from '../../../calculations/modern.ts'
import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { CurvedArrow, FlowLine, LAYER_COLOR, Marker, Spin } from '../../../visualizations/viz.tsx'
import { arcShell, Bearing, Chip, deg, EndCap, extrude, GlowLoop, Housing, LamLines, MAT, PHASE_COLOR, polar, ring, Shaft, statorShape, ToothCoil, toothCoilGeometry, useDiscrete, WaveChart } from '../shared.tsx'

/*
 * Inner-rotor BLDC — original procedural geometry (simplified). 6 teeth at k·60° carry phases A, B, C, A, B, C.
 * 4 magnets: N centred at 0° and 180°, S at 90° and 270° (mechanical) at rotor angle 0. Hall sensors at 30°, 90°,
 * 150° mechanical = 60°, 180°, 300° electrical. The rotor turns counter-clockwise (positive angle about +z);
 * θe = 2·θm. Which pair is switched is computed from the drawn rotor angle with the tested commutation table.
 */
const STACK = 1.2
const R_BORE = 0.62
const MAG_IN = 0.46
const MAG_OUT = 0.58
const MAG_Z0 = -0.76 // magnets overhang at the rear, over the Hall sensors
const MAG_Z1 = 0.6
const PHASES: Phase[] = ['A', 'B', 'C', 'A', 'B', 'C']
const HALL_MECH = [30, 90, 150]
const thetaE = (angle: number) => (2 * angle * 180) / Math.PI

export function BldcModel({ state }: { state: ModelState }) {
  const geo = useMemo(
    () => ({
      stator: extrude(statorShape({ rOut: 1.1, rYoke: 0.9, rBore: R_BORE, n: 6, w: 0.26, shoeHalf: deg(25), shoeDepth: 0.06 }), STACK, 16),
      coil: toothCoilGeometry(0.28, STACK + 0.04, 0.085, 0.705, 0.875),
      magnets: Array.from({ length: 4 }, (_, k) => {
        const g = arcShell(MAG_IN, MAG_OUT, deg(k * 90 - 40), deg(k * 90 + 40), MAG_Z1 - MAG_Z0)
        g.translate(0, 0, (MAG_Z0 + MAG_Z1) / 2)
        return g
      }),
      rotor: ring(0.11, MAG_IN, STACK, 48),
      pcb: ring(0.2, 0.95, 0.03, 48),
      cable: new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.8, -0.84), new THREE.Vector3(0, -0.82, -1.1), new THREE.Vector3(0, -1.0, -1.35), new THREE.Vector3(0, -1.5, -1.5)]), 24, 0.05, 10),
    }),
    [],
  )
  const L = state.layers
  const step = state.step
  const showComm = L.has('current') || L.has('field')
  // the controller's state, from the drawn rotor angle (changes 12 times per revolution: re-render only then)
  const sector = useDiscrete((a) => sixStepSector(thetaE(a)))
  const comm = sixStepFromHalls(60 + 60 * sector) // the middle of the sector: the controller's Hall code and pair
  const halls = comm.halls
  const on = (ph: Phase) => (ph === comm.hi ? '+' : ph === comm.lo ? '−' : '')

  const coilsOf = (ph: Phase) =>
    PHASES.map((p, k) =>
      p !== ph ? null : (
        <group key={k}>
          <ToothCoil geometry={geo.coil} angle={deg(k * 60)} band={{ color: PHASE_COLOR[ph], pos: [0.79, 0, (STACK + 0.04) / 2 + 0.087], size: [0.15, 0.3, 0.012] }} />
          {L.has('current') && on(ph) && <GlowLoop geometry={geo.coil} angle={deg(k * 60)} color={LAYER_COLOR.current} />}
        </group>
      ),
    )

  return (
    <group>
      {/* ── stator ── */}
      <Part id="housing">
        <Housing rIn={1.1} rOut={1.2} len={1.7} fins={0} />
      </Part>
      <Part id="end-cap-front">
        <EndCap r={1.2} z={0.95} dir={1} />
      </Part>
      <Part id="end-cap-rear">
        <EndCap r={1.2} z={-0.95} dir={-1} />
      </Part>
      <Part id="stator-core">
        <mesh geometry={geo.stator}>
          <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
        </mesh>
        <LamLines r={1.1} len={STACK} n={14} />
      </Part>
      <Part id="phase-a">{coilsOf('A')}</Part>
      <Part id="phase-b">{coilsOf('B')}</Part>
      <Part id="phase-c">{coilsOf('C')}</Part>
      <Part id="hall-board">
        <mesh geometry={geo.pcb} position={[0, 0, -0.8]}>
          <meshStandardMaterial color={MAT.pcb} roughness={0.7} />
        </mesh>
        {HALL_MECH.map((a, k) => (
          <group key={a} position={polar(0.52, deg(a), -0.775)} rotation={[0, 0, deg(a)]}>
            <mesh>
              <boxGeometry args={[0.07, 0.05, 0.02]} />
              <meshStandardMaterial color={MAT.chip} roughness={0.6} />
            </mesh>
            {showComm && halls[k] === 1 && (
              <mesh userData={{ noHighlight: true }}>
                <boxGeometry args={[0.09, 0.07, 0.024]} />
                <meshBasicMaterial color={LAYER_COLOR.current} toneMapped={false} />
              </mesh>
            )}
          </group>
        ))}
        <mesh position={[0, -0.8, -0.83]}>
          <boxGeometry args={[0.22, 0.1, 0.06]} />
          <meshStandardMaterial color="#e6e1d3" roughness={0.6} />
        </mesh>
        <mesh geometry={geo.cable}>
          <meshStandardMaterial color="#2a2d33" roughness={0.8} />
        </mesh>
      </Part>
      <Part id="bearing-front">
        <Bearing z={0.88} />
      </Part>
      <Part id="bearing-rear">
        <Bearing z={-0.9} />
      </Part>

      {/* ── rotor (counter-clockwise seen from the front) ── */}
      <Spin axis="z">
        <Part id="shaft">
          <Shaft r={0.11} z0={-1.15} z1={1.8} keyAt={1.55} />
        </Part>
        <Part id="rotor-core">
          <mesh geometry={geo.rotor}>
            <meshStandardMaterial color={MAT.darkSteel} metalness={0.7} roughness={0.4} />
          </mesh>
        </Part>
        <Part id="magnets">
          {geo.magnets.map((g, k) => (
            <mesh key={k} geometry={g}>
              <meshStandardMaterial color={k % 2 === 0 ? MAT.magnetN : MAT.magnetS} metalness={0.25} roughness={0.55} />
            </mesh>
          ))}
        </Part>
        {L.has('field') &&
          [0, 1, 2, 3].map((k) => <Marker key={k} at={polar(0.52, deg(k * 90), 0.68)} text={k % 2 === 0 ? 'N' : 'S'} tone={k % 2 === 0 ? 'north' : 'south'} />)}
      </Spin>

      {/* ── conceptual layers ── */}
      {L.has('field') &&
        PHASES.map((ph, k) => {
          const o = on(ph)
          if (!o) return null
          return <Marker key={k} at={polar(0.75, deg(k * 60), 0.72)} text={o === '+' ? 'N' : 'S'} tone={o === '+' ? 'north' : 'south'} />
        })}
      {L.has('current') &&
        PHASES.map((ph, k) => {
          const o = on(ph)
          return o ? <Marker key={k} at={polar(1.0, deg(k * 60), 0.78)} text={`${o}${ph}`} tone="current" /> : null
        })}
      {(showComm || step === 'hall') && (
        <Chip at={[1.45, -1.3, -0.8]}>
          Halls <span className="mxm-dim">Ha Hb Hc</span> <b>{halls.join(' ')}</b> → <span className="mxm-on">switch {comm.hi}+ {comm.lo}−</span>
          <br />
          <span className="mxm-dim">
            step {comm.sector + 1} of 6 · phase {(['A', 'B', 'C'] as Phase[]).find((p) => p !== comm.hi && p !== comm.lo)} off
          </span>
        </Chip>
      )}
      {L.has('torque') && (
        <group>
          <CurvedArrow radius={1.38} start={deg(-50)} sweep={deg(100)} z={0.75} color={LAYER_COLOR.torque} />
          <Marker at={polar(1.55, deg(55), 0.75)} text="T = kt·I" tone="torque" />
        </group>
      )}
      {L.has('rotation') && <CurvedArrow radius={0.32} start={deg(-120)} sweep={deg(250)} z={1.9} color={LAYER_COLOR.rotation} tube={0.022} />}
      {L.has('emf') && (
        <WaveChart
          at={[-1.75, 1.5, 0.4]}
          title="Ideal back EMF (trapezoidal) vs θe"
          stacked
          height={128}
          angleOf={(a) => thetaE(a)}
          traces={[
            { label: 'ea', color: PHASE_COLOR.A, fn: (d) => trapezoid(d, 'A') },
            { label: 'eb', color: PHASE_COLOR.B, fn: (d) => trapezoid(d, 'B') },
            { label: 'ec', color: PHASE_COLOR.C, fn: (d) => trapezoid(d, 'C') },
          ]}
        />
      )}
      {L.has('energy') && (
        <group>
          <FlowLine points={[[0, -1.5, -1.5], [0, -1.0, -1.35], [0, -0.82, -1.0], [0.4, -0.7, -0.5], [0.4, -0.45, 0], [0.12, -0.12, 0.5], [0, 0, 1.2], [0, 0, 2.3]]} color={LAYER_COLOR.energy} rate={1} width={3.5} />
          <Marker at={[0.35, -1.65, -1.5]} text="Pin = V·I (from the inverter)" tone="energy" />
          <Marker at={[0, -0.3, 2.35]} text="Pout = T·ω" tone="energy" />
          <Marker at={[-1.0, 0.95, 0.75]} text="heat: I²·2Rph (stator)" tone="energy" />
        </group>
      )}
    </group>
  )
}
