import * as THREE from 'three'
import type { MachineDef, ModelState } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { Box, C, Cyl, Disc, MotorBlock } from './blocks.tsx'
import { AxisArrow, Flow, kw } from './flow.tsx'
import { ML_CONTENT, ML_LAYERS, ML_PARAMS, ML_PARTS, ML_QUIZ, ML_STEPS, mlCalc } from './motorLoadContent.ts'

/*
 * Motor + coupling + line shaft + flywheel + fan — original procedural blocks. Shaft = x axis at y = 0.
 * Positive rotation about +x (counter-clockwise seen from the fan end).
 */

const BLADES = 6

function MotorLoadModel({ state }: { state: ModelState }) {
  const L = state.layers
  const c = state.calc
  return (
    <group>
      <Part id="baseplate">
        <Box size={[5.0, 0.1, 1.3]} at={[-0.2, -0.8, 0]} color={C.darkSteel} metal={0.5} />
      </Part>
      <Part id="motor">
        <group position={[-1.7, 0, 0]}>
          <MotorBlock r={0.5} len={1.3} />
          <Box size={[0.95, 0.2, 0.9]} at={[0, -0.65, 0]} color={C.darkSteel} />
        </group>
      </Part>
      <Part id="coupling-guard">
        <mesh position={[-0.75, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.3, 0.3, 0.55, 32, 1, true, 0, Math.PI]} />
          <meshStandardMaterial color="#d9a32b" metalness={0.3} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
      </Part>
      <Part id="bearings">
        {[-0.35, 0.75].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <Cyl r={0.16} len={0.2} axis="x" color="#55606e" />
            <Box size={[0.22, 0.6, 0.32]} at={[0, -0.42, 0]} color="#55606e" />
            <Box size={[0.3, 0.06, 0.55]} at={[0, -0.72, 0]} color="#55606e" />
          </group>
        ))}
      </Part>
      <Part id="fan-housing">
        <mesh position={[1.65, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.66, 0.66, 0.42, 48, 1, true]} />
          <meshStandardMaterial color="#5a6577" metalness={0.4} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <Box size={[0.3, 0.12, 0.7]} at={[1.65, -0.72, 0]} color="#5a6577" />
        <Box size={[0.08, 0.1, 0.5]} at={[1.65, -0.66, 0]} color="#5a6577" />
      </Part>
      <Spin axis="x">
        <Part id="shaft">
          <Cyl r={0.06} len={2.75} axis="x" at={[0.5, 0, 0]} color={C.steel} metal={0.85} rough={0.25} />
          <Box size={[0.2, 0.03, 0.03]} at={[1.1, 0.065, 0]} color="#8a939f" metal={0.8} />
        </Part>
        <Part id="coupling">
          <Cyl r={0.17} len={0.14} axis="x" at={[-0.86, 0, 0]} color="#8e98a6" metal={0.7} />
          <Cyl r={0.17} len={0.14} axis="x" at={[-0.64, 0, 0]} color="#8e98a6" metal={0.7} />
          <Cyl r={0.16} len={0.07} axis="x" at={[-0.75, 0, 0]} color="#d24b3a" metal={0} rough={0.8} />
          <Box size={[0.3, 0.05, 0.05]} at={[-0.75, 0.15, 0]} color="#6c7582" />
        </Part>
        <Part id="flywheel">
          <group position={[0.2, 0, 0]}>
            <Disc r={0.66} t={0.18} color="#7d8794" holes={5} holeR={0.08} />
          </group>
        </Part>
        <Part id="load">
          <group position={[1.65, 0, 0]}>
            <Cyl r={0.13} len={0.22} axis="x" color="#3a4350" />
            {Array.from({ length: BLADES }, (_, i) => {
              const a = (i * 2 * Math.PI) / BLADES
              return (
                <mesh key={i} position={[0, 0.36 * Math.sin(a), 0.36 * Math.cos(a)]} rotation={[Math.PI / 2 - a, 0.5, 0]}>
                  <boxGeometry args={[0.26, 0.46, 0.025]} />
                  <meshStandardMaterial color="#c8ced8" metalness={0.6} roughness={0.35} />
                </mesh>
              )
            })}
          </group>
        </Part>
      </Spin>

      {L.has('rotation') && <AxisArrow axis="x" at={[1.25, 0, 0]} radius={0.3} start={Math.PI * 0.45} sweep={Math.PI * 1.05} color={LAYER_COLOR.rotation} tube={0.02} />}
      {L.has('torque') && (
        <group>
          <AxisArrow axis="x" at={[-0.75, 0, 0]} radius={0.42} start={Math.PI * 0.55} sweep={Math.PI * 0.75} color={LAYER_COLOR.torque} />
          <Marker at={[-0.75, 0.55, 0.45]} text="Tm (motor)" tone="torque" />
          <AxisArrow axis="x" at={[2.0, 0, 0]} radius={0.62} start={Math.PI * 1.3} sweep={-Math.PI * 0.75} color={LAYER_COLOR.torque} />
          <Marker at={[2.05, 0.72, 0.45]} text="TL (fan + friction)" tone="torque" />
          <Marker at={[0.2, 0.95, 0.3]} text="J·dω/dt = Tm − TL" tone="torque" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={[[-1.87, 1.0, 0], [-1.87, 0.6, 0], [-1.6, 0, 0], [-0.75, 0, 0], [0.2, 0, 0], [1.65, 0, 0], [2.3, 0, 0], [2.8, 0, 0]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Marker at={[-1.87, 1.12, 0]} text="electrical in" tone="energy" />
          <Marker at={[-0.4, -0.25, 0.5]} text={`P = T·ω${kw(c.p)}`} tone="energy" />
          <Marker at={[2.95, 0.15, 0]} text="to the air" tone="energy" />
          <Marker at={[0.2, -0.95, 0.5]} text="flywheel stores ½·J·ω²" tone="energy" />
        </group>
      )}
    </group>
  )
}

const SLOW = 40
const def: MachineDef = {
  id: 'sys-motor-load',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified block model: a motor drawn as a finned housing, a jaw coupling under a guard, a line shaft in two pillow-block bearings, a flywheel and a six-blade axial fan in its housing, on one baseplate. Proportions are illustrative.',
    camera: { position: [3.6, 2.9, 5.8], target: [0.2, -0.15, 0] },
    radius: 3,
    views: { front: [0.2, 0.2, 7.2], side: [7.2, 0.5, 0], top: [0.2, 7.4, 0.3], iso: [3.6, 2.9, 5.8] },
    limitations: [
      'Torque and energy layers are conceptual illustrations of directions; the numbers come from the explicit operating-point calculation.',
      'The rotation follows the calculated operating speed, slowed down ×40.',
      'The motor is a block with a linear torque–speed characteristic; its internal losses are not part of the shaft balance.',
      'Rigid shaft: torsional oscillations and coupling compliance are not modelled.',
    ],
  },
  parts: ML_PARTS,
  layers: ML_LAYERS,
  steps: ML_STEPS,
  params: ML_PARAMS,
  calc: mlCalc,
  motion: (calc) => {
    const n = calc.n ?? 0
    return { omega: ((n / 60) * 2 * Math.PI) / SLOW, note: n > 0 ? `The shaft turns at the calculated operating speed (${n.toFixed(0)} rpm), slowed down ×${SLOW}.` : 'The motor cannot start this load: the shaft stays still.' }
  },
  content: ML_CONTENT,
  quiz: ML_QUIZ,
  Model: MotorLoadModel,
}
export default def
