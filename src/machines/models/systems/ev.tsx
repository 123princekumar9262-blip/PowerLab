import type { MachineDef, ModelState, Vec3 } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { Arrow, LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { BatteryPack, Box, C, Cyl, Gear, InverterCase, MotorBlock, Wheel } from './blocks.tsx'
import { AxisArrow, Cable, Flow, kw } from './flow.tsx'
import { EV_CONTENT, EV_LAYERS, EV_PARAMS, EV_PARTS, EV_QUIZ, EV_STEPS, evCalc } from './evContent.ts'

/*
 * Rear half of an EV — original procedural blocks. x = forward, y = up, z = across (the axle). The car moves towards
 * +x, so the wheels (and, through two gear stages, the motor) turn negatively about +z; the intermediate shaft turns
 * the other way. Gear geometry (centre distances = sums of pitch radii): motor pinion r 0.08 → intermediate gear
 * r 0.24 (3 : 1), intermediate pinion r 0.09 → ring gear r 0.27 on the axle (3 : 1): G = 9 as drawn.
 */

const AXLE: Vec3 = [-1.45, 0, 0]
const INTER: Vec3 = [-1.27, 0.312, 0]
const MOTOR: Vec3 = [-0.993, 0.152, 0]
const WHEEL_Z = 1.0
const HV = '#e07b26'
const DC_A: Vec3[] = [[-0.62, -0.28, 0.3], [-0.68, 0.1, 0.32], [-0.75, 0.5, 0.15], [-0.8, 0.62, -0.05]]
const DC_B: Vec3[] = [[-0.62, -0.28, 0.42], [-0.62, 0.15, 0.44], [-0.68, 0.55, 0.2], [-0.72, 0.62, 0.0]]
const PHASE = [-0.45, -0.3, -0.15].map((z) => [[-1.1, 0.55, z], [-1.12, 0.47, z], [-1.08, 0.42, z]] as Vec3[])

function EvModel({ state }: { state: ModelState }) {
  const L = state.layers
  const c = state.calc
  const G = state.params.gear || 9
  const stage1 = Math.sqrt(G)
  return (
    <group>
      <Part id="chassis">
        {[0.8, -0.8].map((z) => (
          <Box key={z} size={[3.6, 0.1, 0.08]} at={[-0.15, -0.15, z]} color={C.darkSteel} metal={0.5} />
        ))}
        <Box size={[0.1, 0.1, 1.68]} at={[-1.95, -0.15, 0]} color={C.darkSteel} metal={0.5} />
        <Box size={[0.1, 0.1, 1.68]} at={[1.65, -0.15, 0]} color={C.darkSteel} metal={0.5} />
      </Part>
      <Part id="battery-pack">
        <group position={[0.5, -0.36, 0]}>
          <BatteryPack size={[2.2, 0.2, 1.4]} modules={[5, 3]} />
        </group>
      </Part>
      <Part id="hv-cables">
        <Cable points={DC_A} color={HV} radius={0.025} />
        <Cable points={DC_B} color={HV} radius={0.025} />
        {PHASE.map((p, i) => (
          <Cable key={i} points={p} color={HV} radius={0.018} />
        ))}
      </Part>
      <Part id="inverter">
        <group position={[-1.0, 0.65, -0.28]}>
          <InverterCase size={[0.62, 0.2, 0.5]} fins={6} />
          <Box size={[0.58, 0.16, 0.46]} color="#465163" />
        </group>
      </Part>
      <Part id="motor">
        <group position={[MOTOR[0], MOTOR[1], -0.33]} rotation={[0, -Math.PI / 2, 0]}>
          <MotorBlock r={0.27} len={0.52} feet={false} terminal={false} />
        </group>
      </Part>
      <Part id="gearbox">
        <Box size={[1.08, 0.82, 0.3]} at={[-1.22, 0.1, 0.15]} color={C.castAlu} metal={0.5} rough={0.5} />
      </Part>
      <Part id="gears">
        {/* motor pinion (turns with the motor) */}
        <group position={[MOTOR[0], MOTOR[1], 0.08]}>
          <Spin axis="z" ratio={-1}>
            <Gear r={0.08} teeth={10} width={0.08} />
            <Cyl r={0.03} len={0.2} axis="z" color={C.steel} />
          </Spin>
        </group>
        {/* intermediate shaft: big gear (stage 1) + small pinion (stage 2) */}
        <group position={[INTER[0], INTER[1], 0]}>
          <Spin axis="z" ratio={1 / stage1}>
            <group position={[0, 0, 0.08]}>
              <Gear r={0.24} teeth={30} width={0.07} />
            </group>
            <group position={[0, 0, 0.18]}>
              <Gear r={0.09} teeth={11} width={0.08} color="#c3cad4" />
            </group>
            <Cyl r={0.03} len={0.26} axis="z" at={[0, 0, 0.13]} color={C.steel} />
          </Spin>
        </group>
        {/* ring gear and differential on the axle */}
        <group position={[AXLE[0], AXLE[1], 0]}>
          <Spin axis="z" ratio={-1 / G}>
            <group position={[0, 0, 0.18]}>
              <Gear r={0.27} teeth={33} width={0.07} />
            </group>
            <Cyl r={0.12} len={0.2} axis="z" at={[0, 0, 0.06]} color="#7c8794" />
          </Spin>
        </group>
      </Part>
      <Part id="half-shafts">
        <group position={[AXLE[0], AXLE[1], 0]}>
          <Spin axis="z" ratio={-1 / G}>
            {[1, -1].map((s) => (
              <group key={s}>
                <Cyl r={0.035} len={0.72} axis="z" at={[0, 0, s * 0.55]} color={C.steel} metal={0.8} rough={0.3} />
                <mesh position={[0, 0, s * 0.2]}>
                  <sphereGeometry args={[0.07, 16, 12]} />
                  <meshStandardMaterial color={C.rubber} roughness={0.9} />
                </mesh>
                <mesh position={[0, 0, s * 0.88]}>
                  <sphereGeometry args={[0.07, 16, 12]} />
                  <meshStandardMaterial color={C.rubber} roughness={0.9} />
                </mesh>
                <Box size={[0.02, 0.09, 0.3]} at={[0, 0.04, s * 0.55]} color="#8a939f" />
              </group>
            ))}
          </Spin>
        </group>
      </Part>
      <Part id="wheels">
        {[1, -1].map((s) => (
          <group key={s} position={[AXLE[0], AXLE[1], s * WHEEL_Z]}>
            <Spin axis="z" ratio={-1 / G}>
              <group rotation={[0, s > 0 ? 0 : Math.PI, 0]}>
                <Wheel r={0.33} width={0.22} />
              </group>
            </Spin>
          </group>
        ))}
      </Part>

      {L.has('rotation') && (
        <group>
          <AxisArrow axis="z" at={[AXLE[0], 0, WHEEL_Z + 0.16]} radius={0.22} start={Math.PI * 0.9} sweep={-Math.PI * 1.2} color={LAYER_COLOR.rotation} tube={0.02} />
          <AxisArrow axis="z" at={[MOTOR[0], MOTOR[1], -0.68]} radius={0.17} start={Math.PI * 0.9} sweep={-Math.PI * 1.2} color={LAYER_COLOR.rotation} tube={0.016} />
          <Marker at={[-1.45, 0.48, 1.28]} text="ω_wheel = ω_motor / G" tone="neutral" />
        </group>
      )}
      {L.has('torque') && (
        <group>
          <AxisArrow axis="z" at={[MOTOR[0], MOTOR[1], -0.7]} radius={0.32} start={Math.PI * 0.75} sweep={-Math.PI * 0.6} color={LAYER_COLOR.torque} tube={0.02} />
          <Marker at={[-0.85, 0.6, -0.72]} text="Tm" tone="torque" />
          <AxisArrow axis="z" at={[AXLE[0], 0, WHEEL_Z + 0.18]} radius={0.42} start={Math.PI * 0.75} sweep={-Math.PI * 0.6} color={LAYER_COLOR.torque} />
          <Marker at={[-1.3, 0.55, 1.3]} text="T_wheel = G·η·Tm" tone="torque" />
          <Arrow from={[AXLE[0] - 0.25, -0.33, WHEEL_Z]} dir={[1, 0, 0]} length={0.75} color={LAYER_COLOR.torque} radius={0.025} />
          <Marker at={[-0.85, -0.5, WHEEL_Z + 0.1]} text="F = T_wheel / r  (push on the road)" tone="torque" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={[[0.5, -0.1, 0], [-0.3, 0.1, 0.2], [-0.75, 0.85, -0.1], [-1.0, 0.85, -0.3], [MOTOR[0], MOTOR[1], -0.33], [MOTOR[0], MOTOR[1], 0.1], [AXLE[0], 0, 0.2], [AXLE[0], 0, WHEEL_Z]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Flow points={[[-1.0, 0.85, -0.3], [-1.0, 1.25, -0.3]]} color={LAYER_COLOR.energy} width={1.4} onTop />
          <Flow points={[[MOTOR[0], MOTOR[1], -0.33], [-0.7, 0.75, -0.75]]} color={LAYER_COLOR.energy} width={1.4} onTop />
          <Marker at={[0.6, 0.12, 0]} text={`battery${kw(c.pbatt)}`} tone="energy" />
          <Marker at={[-1.0, 1.38, -0.3]} text="inverter loss" tone="energy" />
          <Marker at={[-0.6, 0.88, -0.85]} text={`motor loss · shaft${kw(c.pshaft)}`} tone="energy" />
          <Marker at={[-1.45, -0.55, WHEEL_Z - 0.1]} text={`wheels${kw(c.pwheel)}`} tone="energy" />
        </group>
      )}
      {L.has('current') && (
        <group>
          <Flow points={DC_A.map(([x, y, z]) => [x + 0.04, y, z] as Vec3)} color={LAYER_COLOR.current} rate={1} width={2.2} onTop />
          <Flow points={[...DC_B].reverse().map(([x, y, z]) => [x + 0.04, y, z] as Vec3)} color={LAYER_COLOR.current} rate={1} width={2.2} onTop />
          {PHASE.map((p, k) => (
            <Flow key={k} points={p.map(([x, y, z]) => [x + 0.04, y + 0.02, z] as Vec3)} color={LAYER_COLOR.current} rate={(a) => 1.5 * Math.cos(4 * a - (k * 2 * Math.PI) / 3)} width={2} onTop />
          ))}
          <Marker at={[-0.45, 0.2, 0.62]} text="Idc" tone="current" />
          <Marker at={[-1.3, 0.62, -0.62]} text="ia ib ic" tone="current" />
        </group>
      )}
    </group>
  )
}

const SLOW = 100
const def: MachineDef = {
  id: 'sys-ev',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified block model of the rear half of a rear-drive EV: flat battery pack, chassis rails, HV cables, an inverter on a drive unit with the motor parallel to the axle, a two-stage reduction gearbox (3 × 3 = 9 drawn, with correct centre distances) and differential, half-shafts with CV joints and the two driven wheels. Front wheels and body are not drawn.',
    camera: { position: [-4.1, 3.0, 4.6], target: [-0.5, -0.05, 0] },
    radius: 3,
    views: { front: [-5.6, 0.8, 0], side: [-0.5, 0.6, 6.2], top: [-0.5, 6.4, 0.3], iso: [-4.1, 3.0, 4.6] },
    limitations: [
      'Energy, current and force layers are conceptual; the numbers come from the explicit calculation with assumed efficiencies.',
      'The motor turns at the calculated speed slowed down ×100; the wheels turn exactly 1/G as fast (G from the parameter; the gear teeth are drawn for G = 9).',
      'The motor, inverter and battery are blocks; the EV lab simulates the drivetrain over a drive cycle.',
      'Level road, no slip, equal torque split; auxiliary loads not included.',
    ],
  },
  parts: EV_PARTS,
  layers: EV_LAYERS,
  steps: EV_STEPS,
  params: EV_PARAMS,
  calc: evCalc,
  motion: (_c, p) => {
    const wm = ((p.gear || 9) * ((p.v ?? 0) / 3.6)) / (p.rw || 0.33)
    return { omega: wm / SLOW, note: `Motor at ${((wm * 60) / (2 * Math.PI)).toFixed(0)} rpm, slowed down ×${SLOW}; the wheels turn G = ${p.gear} times slower.` }
  },
  content: EV_CONTENT,
  quiz: EV_QUIZ,
  Model: EvModel,
}
export default def
