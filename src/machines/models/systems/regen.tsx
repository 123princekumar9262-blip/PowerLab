import type { MachineDef, ModelState, Vec3 } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { BatteryPack, Box, C, Cyl, Disc, InverterCase, MotorBlock, Wheel } from './blocks.tsx'
import { AxisArrow, Cable, Flow, kw } from './flow.tsx'
import { RG_CONTENT, RG_LAYERS, RG_PARAMS, RG_PARTS, RG_QUIZ, RG_STEPS, rgCalc } from './regenContent.ts'

/*
 * Regenerative braking chain along +x: battery → inverter → motor → gearbox (G = 9 drawn) → drive shaft → wheel.
 * Drive axis = x; the wheel turns positively about +x in both modes (vehicle moving towards +z). Driving and
 * braking differ only in the sign of the torque and of the energy flow, which the layers show.
 */

const G_DRAWN = 9
const WHEEL_R = 0.32 // wheel radius assumed for the animation speed [m]
const DC_PLUS: Vec3[] = [[-2.45, -0.15, 0.18], [-2.1, -0.4, 0.3], [-1.75, -0.35, 0.28], [-1.6, -0.1, 0.2]]
const DC_MINUS: Vec3[] = [[-2.45, -0.15, -0.18], [-2.1, -0.4, -0.3], [-1.75, -0.35, -0.28], [-1.6, -0.1, -0.2]]
const AC_Z = [0.16, 0, -0.16]
const acPath = (z: number): Vec3[] => [[-0.7, 0.0, z], [-0.4, 0.15, z], [0.05, 0.55, z * 0.6], [0.35, 0.58, z * 0.4]]
const CHAIN: Vec3[] = [[-3.0, 0.1, 0], [-2.45, -0.05, 0], [-1.15, 0, 0], [-0.7, 0, 0], [0.45, 0, 0], [1.4, 0, 0], [2.45, 0, 0]]
const up = (pts: Vec3[], dy: number): Vec3[] => pts.map(([x, y, z]) => [x, y + dy, z])

const BRAKING_STEPS = new Set(['regen', 'charging', 'limits', 'energy'])

function RegenModel({ state }: { state: ModelState }) {
  const L = state.layers
  const c = state.calc
  // which way does the power flow? the guided steps say it; in Explore the calculation does (P_wheel < 0: braking)
  const braking = state.step ? BRAKING_STEPS.has(state.step) : (c.pwheel ?? 0) < 0
  const dir = braking ? -1 : 1
  return (
    <group>
      <Part id="battery">
        <group position={[-3.0, -0.25, 0]}>
          <BatteryPack size={[1.0, 0.5, 0.8]} modules={[2, 2]} />
        </group>
      </Part>
      <Part id="dc-cables">
        <Cable points={DC_PLUS} color={C.red} radius={0.035} />
        <Cable points={DC_MINUS} color={C.black} radius={0.035} />
      </Part>
      <Part id="inverter">
        <group position={[-1.15, 0, 0]}>
          <InverterCase size={[0.9, 0.45, 0.75]} fins={7} />
          <Box size={[0.86, 0.41, 0.71]} color="#465163" />
        </group>
      </Part>
      <Part id="ac-cables">
        {AC_Z.map((z, k) => (
          <Cable key={z} points={acPath(z)} color={C.phase[k]} radius={0.028} />
        ))}
      </Part>
      <Part id="motor">
        <group position={[0.45, 0, 0]}>
          <MotorBlock r={0.4} len={0.9} />
        </group>
      </Part>
      <Part id="gearbox">
        <Box size={[0.5, 0.78, 0.62]} at={[1.4, -0.05, 0]} color={C.castAlu} metal={0.5} rough={0.5} />
        <Cyl r={0.2} len={0.52} axis="x" at={[1.4, 0.22, 0]} color={C.castAlu} />
        <Box size={[0.5, 0.06, 0.66]} at={[1.4, -0.47, 0]} color={C.darkSteel} />
      </Part>
      {/* motor-speed shaft between motor and gearbox */}
      <Spin axis="x">
        <Cyl r={0.06} len={0.3} axis="x" at={[1.02, 0, 0]} color={C.steel} metal={0.85} rough={0.25} />
        <Box size={[0.12, 0.03, 0.03]} at={[1.02, 0.065, 0]} color="#8a939f" />
      </Spin>
      {/* wheel-speed parts: ω_wheel = ω_motor / G */}
      <Part id="drive-shaft">
        <Spin axis="x" ratio={1 / G_DRAWN}>
          <Cyl r={0.055} len={0.85} axis="x" at={[2.05, 0, 0]} color={C.steel} metal={0.85} rough={0.25} />
          <Cyl r={0.09} len={0.1} axis="x" at={[1.72, 0, 0]} color="#6c7582" />
        </Spin>
      </Part>
      <Part id="brake">
        <Box size={[0.13, 0.16, 0.18]} at={[2.12, 0.28, 0]} color="#b03a2e" metal={0.4} />
        <group position={[2.12, 0, 0]}>
          <Spin axis="x" ratio={1 / G_DRAWN}>
            <Disc r={0.3} t={0.035} color="#a7b0bc" holes={8} holeR={0.025} />
          </Spin>
        </group>
      </Part>
      <Part id="wheel">
        <group position={[2.5, 0, 0]}>
          <Spin axis="x" ratio={1 / G_DRAWN}>
            <group rotation={[0, Math.PI / 2, 0]}>
              <Wheel r={0.42} width={0.24} />
            </group>
          </Spin>
        </group>
      </Part>

      {L.has('rotation') && (
        <group>
          <AxisArrow axis="x" at={[2.85, 0, 0]} radius={0.28} start={Math.PI * 0.45} sweep={Math.PI * 1.05} color={LAYER_COLOR.rotation} tube={0.02} />
          <Marker at={[3.05, -0.8, 0]} text="ω_wheel = ω_motor / G" tone="neutral" />
        </group>
      )}
      {L.has('torque') && (
        <group>
          <AxisArrow axis="x" at={[1.02, 0, 0]} radius={0.3} start={Math.PI * (braking ? 1.25 : 0.55)} sweep={Math.PI * 0.7 * dir} color={LAYER_COLOR.torque} />
          <Marker at={[1.0, 0.5, 0.45]} text={braking ? 'T motor < 0 (generating)' : 'T motor > 0 (driving)'} tone="torque" />
          <AxisArrow axis="x" at={[2.72, 0, 0]} radius={0.55} start={Math.PI * (braking ? 1.25 : 0.55)} sweep={Math.PI * 0.7 * dir} color={LAYER_COLOR.torque} />
          <Marker at={[2.7, 0.72, 0.5]} text={braking ? "braking torque" : "driving torque"} tone="torque" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={up(CHAIN, 0.75)} color={LAYER_COLOR.energy} rate={dir} width={4} onTop />
          <Marker at={braking ? [-3.0, 1.3, 0] : [2.45, 1.3, 0]} text={braking ? 'to the battery ◀' : '▶ to the wheel'} tone="energy" />
          <Marker at={[-3.0, 1.0, 0]} text={`battery${kw(c.pbatt === null || c.pbatt === undefined ? null : Math.abs(c.pbatt))}`} tone="energy" />
          <Marker at={[2.45, 1.0, 0]} text={`wheel${kw(c.pwheel === null || c.pwheel === undefined ? null : Math.abs(c.pwheel))}`} tone="energy" />
          <Flow points={[[0.45, 0.75, 0], [0.45, 1.25, -0.2]]} color={LAYER_COLOR.energy} width={1.4} onTop />
          <Marker at={[0.45, 1.38, -0.2]} text="losses → heat" tone="energy" />
        </group>
      )}
      {L.has('current') && (
        <group>
          <Flow points={up(DC_PLUS, 0.06)} color={LAYER_COLOR.current} rate={dir} width={2.4} onTop />
          <Flow points={up(DC_MINUS, 0.06)} color={LAYER_COLOR.current} rate={-dir} width={2.4} onTop />
          <Marker at={[-2.15, -0.65, 0.5]} text={braking ? 'I into + : charging' : 'I out of + : discharging'} tone="current" />
        </group>
      )}
    </group>
  )
}

const SLOW = 100
const def: MachineDef = {
  id: 'sys-regen',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified block model of one driven corner: battery, DC cables, inverter, AC cables, motor, an in-line reduction gearbox (ratio 9 drawn), drive shaft, brake disc and caliper, and the wheel. Proportions are illustrative.',
    camera: { position: [4.0, 3.4, 7.8], target: [-0.15, 0.05, 0] },
    radius: 3.4,
    views: { front: [-0.2, 0.3, 8.2], side: [8.4, 0.6, 0], top: [-0.2, 8.4, 0.3], iso: [4.0, 3.4, 7.8] },
    limitations: [
      'Energy, current and torque layers are conceptual: they show directions (which reverse when braking), not waveforms.',
      'The animation speed assumes a 0.32 m wheel and the drawn ratio G = 9, slowed down ×100; the wheel turns exactly 1/9 of the motor speed.',
      'Road drag, rolling resistance and the friction brake share are not in the calculation (an upper bound on recovery).',
      'The EV lab simulates a whole drive cycle with regeneration; this model only explains the mechanism.',
    ],
  },
  parts: RG_PARTS,
  layers: RG_LAYERS,
  steps: RG_STEPS,
  params: RG_PARAMS,
  calc: rgCalc,
  motion: (_c, p) => {
    const wm = (G_DRAWN * ((p.v ?? 0) / 3.6)) / WHEEL_R
    return { omega: wm / SLOW, note: `Motor speed ${((wm * 60) / (2 * Math.PI)).toFixed(0)} rpm (G = 9, wheel radius 0.32 m assumed), slowed down ×${SLOW}; the wheel turns 9 times slower.` }
  },
  content: RG_CONTENT,
  quiz: RG_QUIZ,
  Model: RegenModel,
}
export default def
