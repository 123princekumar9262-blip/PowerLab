import type { MachineDef, ModelState, Vec3 } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { BatteryPack, C, ControlBoard, Cyl, DcLinkCaps, Disc, InverterCase, MotorBlock, SwitchModules } from './blocks.tsx'
import { AxisArrow, Cable, Flow, kw } from './flow.tsx'
import { IM_CONTENT, IM_LAYERS, IM_PARAMS, IM_PARTS, IM_QUIZ, IM_STEPS, imCalc } from './inverterMotorContent.ts'

/*
 * Battery → inverter → motor — original procedural blocks laid out along +x (the direction of the energy flow).
 * The motor shaft is the x axis at y = 0; positive rotation about +x = counter-clockwise seen from the shaft end.
 */

const DC_PLUS: Vec3[] = [[-1.93, -0.2, 0.2], [-1.6, -0.45, 0.32], [-1.2, -0.42, 0.3], [-1.0, -0.12, 0.25]]
const DC_MINUS: Vec3[] = [[-1.93, -0.2, -0.2], [-1.6, -0.45, -0.32], [-1.2, -0.42, -0.3], [-1.0, -0.12, -0.25]]
const AC_Z = [0.2, 0, -0.2]
const acPath = (z: number): Vec3[] => [[0.1, 0.0, z], [0.55, 0.12, z], [1.05, 0.7, z * 0.6], [1.4, 0.72, z * 0.4]]
const lift = (pts: Vec3[], dy = 0.05): Vec3[] => pts.map(([x, y, z]) => [x, y + dy, z])

function InverterMotorModel({ state }: { state: ModelState }) {
  const L = state.layers
  const c = state.calc
  const pp = (state.params.poles ?? 8) / 2
  return (
    <group>
      <Part id="battery">
        <group position={[-2.6, -0.3, 0]}>
          <BatteryPack size={[1.2, 0.55, 0.9]} modules={[3, 2]} />
        </group>
      </Part>
      <Part id="dc-cables">
        <Cable points={DC_PLUS} color={C.red} radius={0.04} />
        <Cable points={DC_MINUS} color={C.black} radius={0.04} />
      </Part>
      <Part id="inverter-housing">
        <group position={[-0.45, 0, 0]}>
          <InverterCase size={[1.1, 0.5, 0.9]} />
        </group>
      </Part>
      <Part id="dc-link">
        <group position={[-0.78, -0.1, 0]}>
          <DcLinkCaps n={3} spacing={0.16} />
        </group>
      </Part>
      <Part id="power-switches">
        <group position={[-0.15, 0, 0]}>
          <SwitchModules w={0.6} />
        </group>
      </Part>
      <Part id="controller">
        <group position={[-0.45, 0.16, 0]}>
          <ControlBoard size={[0.9, 0.02, 0.7]} />
        </group>
      </Part>
      <Part id="ac-cables">
        {AC_Z.map((z, k) => (
          <Cable key={z} points={acPath(z)} color={C.phase[k]} radius={0.03} />
        ))}
      </Part>
      <Part id="motor">
        <group position={[1.55, 0, 0]}>
          <MotorBlock r={0.45} len={1.1} />
        </group>
      </Part>
      <Spin axis="x">
        <Part id="shaft">
          <Cyl r={0.06} len={0.8} axis="x" at={[2.45, 0, 0]} color={C.steel} metal={0.85} rough={0.25} />
          <group position={[2.75, 0, 0]}>
            <Disc r={0.26} t={0.1} color="#8e98a6" holes={4} holeR={0.04} />
          </group>
        </Part>
      </Spin>

      {L.has('rotation') && <AxisArrow axis="x" at={[2.5, 0, 0]} radius={0.36} start={Math.PI * 0.45} sweep={Math.PI * 1.05} color={LAYER_COLOR.rotation} tube={0.02} />}
      {L.has('current') && (
        <group>
          <Flow points={lift(DC_PLUS, 0.06)} color={LAYER_COLOR.current} rate={1} width={2.4} onTop />
          <Flow points={lift([...DC_MINUS].reverse(), 0.06)} color={LAYER_COLOR.current} rate={1} width={2.4} onTop />
          <Marker at={[-1.55, -0.72, 0.62]} text="Idc (+ out)" tone="current" />
          <Marker at={[-1.45, -0.2, -0.8]} text="Idc (− back)" tone="current" />
          {AC_Z.map((z, k) => (
            <Flow key={z} points={lift(acPath(z), 0.05)} color={LAYER_COLOR.current} rate={(a) => 1.6 * Math.cos(pp * a - (k * 2 * Math.PI) / 3)} width={2.2} onTop />
          ))}
          <Marker at={[0.75, 0.75, 0]} text="ia, ib, ic (AC)" tone="current" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={[[-2.6, 0.1, 0], [-1.95, -0.1, 0], [-1.0, -0.1, 0], [0.1, 0, 0], [1.0, 0.5, 0], [1.55, 0.3, 0], [2.1, 0, 0], [3.0, 0, 0]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Flow points={[[-0.45, 0.3, 0], [-0.45, 0.85, 0]]} color={LAYER_COLOR.energy} width={1.6} onTop />
          <Flow points={[[1.55, 0.6, 0], [1.55, 1.05, 0]]} color={LAYER_COLOR.energy} width={1.6} onTop />
          <Marker at={[-2.6, 0.32, 0]} text={`P_dc${kw(c.pdc)}`} tone="energy" />
          <Marker at={[-0.45, 0.98, 0]} text={`inverter heat${kw(c.lossInv)}`} tone="energy" />
          <Marker at={[0.6, 0.55, 0.5]} text={`P_ac${kw(c.pac)}`} tone="energy" />
          <Marker at={[1.55, 1.18, 0]} text={`motor heat${kw(c.lossMotor)}`} tone="energy" />
          <Marker at={[3.0, 0.2, 0]} text={`T·ω${kw(c.pshaft)}`} tone="energy" />
        </group>
      )}
    </group>
  )
}

const SLOW = 100
const def: MachineDef = {
  id: 'sys-inverter-motor',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified block model: a battery pack, DC cables, an inverter (three DC-link capacitors, six switch modules in three legs on busbars, a control board, a finned housing), three AC cables and a motor drawn as a housing with its output shaft. Proportions are illustrative.',
    camera: { position: [2.0, 3.7, 8.8], target: [0.15, -0.05, 0] },
    radius: 3.2,
    views: { front: [0.15, 0.2, 9.4], side: [9.4, 0.6, 0], top: [0.15, 9.4, 0.3], iso: [2.0, 3.7, 8.8] },
    limitations: [
      'Energy and current layers are conceptual: the dash direction shows the sense of the flow; the AC dashes reverse in sequence as an illustration, not a waveform.',
      'The shaft turns at the set speed slowed down ×100.',
      'The motor and the battery are blocks; the switching itself is described, not simulated — the Drives & Motors and EV labs simulate it.',
      'Efficiencies are assumed constants.',
    ],
  },
  parts: IM_PARTS,
  layers: IM_LAYERS,
  steps: IM_STEPS,
  params: IM_PARAMS,
  calc: imCalc,
  motion: (_c, p) => ({ omega: (((p.n ?? 0) / 60) * 2 * Math.PI) / SLOW, note: `The shaft turns at the set speed n = ${p.n} rpm, slowed down ×${SLOW}.` }),
  content: IM_CONTENT,
  quiz: IM_QUIZ,
  Model: InverterMotorModel,
}
export default def
