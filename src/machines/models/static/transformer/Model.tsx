import { useMemo } from 'react'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { Arrow, LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import { AcArrow, AcFlow, AcText, Bushing, CoilStack, COPPER_HV, COPPER_LV, ellipse, FRAME_STEEL, Laminated, polyShape, PRESSBOARD, rectLoop, rectShape, ringGeometry, Wire } from '../shared.tsx'

/*
 * Single-phase core-type transformer — original procedural geometry (simplified). Core in the xy plane, front
 * +z. Limbs at x = ±1.25 (0.5 wide), yokes at y = ±1.25 (0.5 high), core depth 0.8. Primary on the left limb,
 * secondary on the right limb.
 *
 * Directions (consistent with content.ts): positive flux Φ goes UP the primary limb and DOWN the secondary limb
 * (clockwise seen from the front). A current that circulates in +x on the FRONT face of a coil (anticlockwise
 * seen from above) magnetises its limb upwards. Positive primary current does that on the left limb; the
 * secondary load current, which opposes the change, circulates +x on the front of the right limb too — upwards
 * in the right limb, i.e. against the clockwise flux. Phase: Φ ∝ sin θ, v and the load currents ∝ cos θ.
 */
const D = 0.8 // core depth
const LX = 1.25 // limb centre
const BUSH_Z = 0.7
/** Energy: supply → primary → (magnetic field in the core) → secondary → load; it never reverses (p = v·i ≥ 0). */
const ENERGY_PATH: Vec3[] = [[-1.25, 2.05, BUSH_Z], [-1.25, 0.45, 0.95], [-0.55, 1.25, 0.55], [0.55, 1.25, 0.55], [1.25, 0.45, 0.95], [1.25, 2.05, BUSH_Z]]
const ENERGY_ARROWS: Array<[Vec3, Vec3]> = [[[-1.25, 1.55, 0.78], [0, -1, 0.1]], [[-0.15, 1.25, 0.55], [1, 0, 0]], [[1.25, 1.2, 0.84], [0, 1, -0.1]]]

export function TransformerModel({ state }: { state: ModelState }) {
  const shapes = useMemo(
    () => ({
      u: polyShape([
        [-1.5, -1.5],
        [1.5, -1.5],
        [1.5, 1.0],
        [1.0, 1.0],
        [1.0, -1.0],
        [-1.0, -1.0],
        [-1.0, 1.0],
        [-1.5, 1.0],
      ]),
      top: rectShape(-1.5, 1.0, 1.5, 1.5),
      tube: ringGeometry(0.27, 0.42, 0.3, 0.45, 1.94, 0.06),
    }),
    [],
  )
  const L = state.layers
  const noLoad = state.step === 'magnetising'
  // currents: at no load only a small magnetising current in phase with Φ; loaded: in phase with v (cos θ)
  const iPhase = noLoad ? 0 : Math.PI / 2
  const i1Amp = noLoad ? 0.4 : 1
  const vPhase = Math.PI / 2

  return (
    <group>
      {/* ── frame (outer) ── */}
      <Part id="frame">
        {[1.25, -1.25].map((y) =>
          [0.46, -0.46].map((z) => (
            <mesh key={`${y}${z}`} position={[0, y, z]}>
              <boxGeometry args={[3.4, 0.42, 0.08]} />
              <meshStandardMaterial color={FRAME_STEEL} metalness={0.55} roughness={0.5} />
            </mesh>
          )),
        )}
        {[0.46, -0.46].map((z) => (
          <mesh key={`rod${z}`} position={[0, 0, z + Math.sign(z) * 0.02]}>
            <cylinderGeometry args={[0.025, 0.025, 2.1, 10]} />
            <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        {/* feet */}
        {[0.66, -0.66].map((z) => (
          <mesh key={`foot${z}`} position={[0, -1.52, z]}>
            <boxGeometry args={[3.4, 0.06, 0.4]} />
            <meshStandardMaterial color={FRAME_STEEL} metalness={0.55} roughness={0.5} />
          </mesh>
        ))}
      </Part>

      {/* ── core ── */}
      <Part id="core">
        <Laminated shape={shapes.u} depth={D} n={14} />
      </Part>
      <Part id="top-yoke">
        <Laminated shape={shapes.top} depth={D} n={14} />
      </Part>
      <Part id="insulation">
        {[-LX, LX].map((x) => (
          <mesh key={x} geometry={shapes.tube} position={[x, -0.97, 0]}>
            <meshStandardMaterial color={PRESSBOARD} roughness={0.85} />
          </mesh>
        ))}
      </Part>

      {/* ── windings ── */}
      <Part id="primary">
        <group position={[-LX, 0, 0]}>
          <CoilStack ix={0.32} iz={0.47} ox={0.58} oz={0.73} y0={-0.9} y1={0.9} turns={18} color={COPPER_HV} />
        </group>
        {/* its leads (the winding's ends) up to the bushings: they stay with the coil when it is disconnected */}
        {/* 1U: the winding start, brought up the front of the coil; 1V: the finish, from the top turn */}
        <Wire points={[[-1.5, -0.86, 0.755], [-1.5, 0.96, 0.755], [-1.5, 1.03, BUSH_Z]]} radius={0.018} color={COPPER_HV} />
        <Wire points={[[-1.0, 0.9, 0.6], [-1.0, 1.03, BUSH_Z]]} radius={0.018} color={COPPER_HV} />
      </Part>
      <Part id="secondary">
        <group position={[LX, 0, 0]}>
          <CoilStack ix={0.32} iz={0.47} ox={0.58} oz={0.73} y0={-0.9} y1={0.9} turns={7} color={COPPER_LV} gap={0.02} />
        </group>
        <Wire points={[[1.5, -0.86, 0.765], [1.5, 0.96, 0.765], [1.5, 1.03, BUSH_Z]]} radius={0.032} color={COPPER_LV} />
        <Wire points={[[1.0, 0.9, 0.6], [1.0, 1.03, BUSH_Z]]} radius={0.032} color={COPPER_LV} />
      </Part>

      {/* ── terminals ── */}
      <Part id="hv-terminals">
        <mesh position={[-LX, 1.005, 0.69]}>
          <boxGeometry args={[0.95, 0.05, 0.32]} />
          <meshStandardMaterial color="#7a5a35" roughness={0.8} />
        </mesh>
        <Bushing at={[-1.5, 1.03, BUSH_Z]} height={0.42} />
        <Bushing at={[-1.0, 1.03, BUSH_Z]} height={0.42} />
      </Part>
      <Part id="lv-terminals">
        <mesh position={[LX, 1.005, 0.69]}>
          <boxGeometry args={[0.95, 0.05, 0.32]} />
          <meshStandardMaterial color="#7a5a35" roughness={0.8} />
        </mesh>
        <Bushing at={[1.0, 1.03, BUSH_Z]} height={0.26} r={0.09} sheds={1} />
        <Bushing at={[1.5, 1.03, BUSH_Z]} height={0.26} r={0.09} sheds={1} />
      </Part>

      {/* ── conceptual layers ── */}
      {L.has('flux') && (
        <group>
          <AcFlow points={rectLoop(-LX, -1.25, LX, 1.25, 0.45)} color={LAYER_COLOR.field} xray width={3} />
          <AcArrow at={[0, 1.25, 0.5]} dir={[1, 0, 0]} length={0.6} color={LAYER_COLOR.field} xray />
          <AcArrow at={[0, -1.25, 0.5]} dir={[-1, 0, 0]} length={0.6} color={LAYER_COLOR.field} xray />
          <AcArrow at={[-LX, 0.4, 0.45]} dir={[0, 1, 0]} length={0.6} color={LAYER_COLOR.field} xray />
          <AcArrow at={[LX, 0.4, 0.45]} dir={[0, -1, 0]} length={0.6} color={LAYER_COLOR.field} xray />
          <Marker at={[0, 0.82, 0.5]} text="Φ (mutual flux)" tone="field" />
        </group>
      )}
      {L.has('field') && (
        <group>
          {/* primary window-side conductors carry current into the screen (+): field clockwise seen from the front */}
          <AcFlow points={ellipse(-0.8, 0, 0.17, 0.92, 0, 0, -Math.PI * 2)} color="#a9cdf7" phase={iPhase} width={2} xray />
          <AcFlow points={ellipse(0.8, 0, 0.17, 0.92, 0, Math.PI, Math.PI * 2)} color="#a9cdf7" phase={iPhase} width={2} xray />
          <AcArrow at={[-0.62, 0, 0]} dir={[0, -1, 0]} length={0.32} radius={0.018} color="#a9cdf7" phase={iPhase} xray />
          <AcArrow at={[0.62, 0, 0]} dir={[0, -1, 0]} length={0.32} radius={0.018} color="#a9cdf7" phase={iPhase} xray />
          <Marker at={[0, -0.45, 0.1]} text="leakage" tone="field" />
        </group>
      )}
      {L.has('current') && (
        <group>
          {/* supply loop: positive current enters 1U (x = −1.5) */}
          <AcFlow points={[[-1.0, 1.55, BUSH_Z], [-1.0, 2.05, BUSH_Z], [-1.5, 2.05, BUSH_Z], [-1.5, 1.55, BUSH_Z]]} color={LAYER_COLOR.current} phase={iPhase} amp={i1Amp} />
          <Marker at={[-1.25, 2.25, BUSH_Z]} text="~ v1" tone="current" />
          <AcArrow at={[-1.5, 1.8, BUSH_Z]} dir={[0, -1, 0]} length={0.3} radius={0.02} color={LAYER_COLOR.current} phase={iPhase} amp={i1Amp} min={0.4} />
          <AcArrow at={[-LX, -0.25, 0.8]} dir={[1, 0, 0]} length={0.55} color={LAYER_COLOR.current} phase={iPhase} amp={i1Amp} />
          <AcText at={[-LX - 0.42, -0.25, 0.85]} pos={noLoad ? 'i0' : 'i1'} neg={noLoad ? 'i0' : 'i1'} tone="current" />
          {!noLoad && (
            <>
              {/* load loop: positive i2 leaves 2U (x = +1.5) */}
              <AcFlow points={[[1.5, 1.4, BUSH_Z], [1.5, 2.05, BUSH_Z], [1.0, 2.05, BUSH_Z], [1.0, 1.4, BUSH_Z]]} color={LAYER_COLOR.current} phase={iPhase} />
              <mesh position={[1.25, 2.05, BUSH_Z]} userData={{ noHighlight: true }}>
                <boxGeometry args={[0.26, 0.11, 0.11]} />
                <meshBasicMaterial color="#d7dbe2" toneMapped={false} />
              </mesh>
              <Marker at={[1.25, 2.25, BUSH_Z]} text="load RL" tone="current" />
              <AcArrow at={[1.5, 1.75, BUSH_Z]} dir={[0, 1, 0]} length={0.3} radius={0.02} color={LAYER_COLOR.current} phase={iPhase} min={0.4} />
              <AcArrow at={[LX, -0.25, 0.8]} dir={[1, 0, 0]} length={0.55} color={LAYER_COLOR.current} phase={iPhase} />
              <AcText at={[LX + 0.42, -0.25, 0.85]} pos="i2" neg="i2" tone="current" />
            </>
          )}
          {noLoad && <Marker at={[1.25, 1.75, BUSH_Z]} text="open: i2 = 0" tone="current" />}
        </group>
      )}
      {L.has('emf') && (
        <group>
          <AcArrow at={[LX, -0.62, 0.8]} dir={[1, 0, 0]} length={0.5} color={LAYER_COLOR.emf} phase={vPhase} />
          <Marker at={[LX + 0.45, -0.62, 0.85]} text="e2" tone="emf" />
          <Marker at={[-LX - 0.48, -0.62, 0.85]} text="e1 ≈ v1" tone="emf" />
          {(
            [
              [-1.5, 1.66, 0],
              [-1.0, 1.66, Math.PI],
              [1.5, 1.5, 0],
              [1.0, 1.5, Math.PI],
            ] as Array<[number, number, number]>
          ).map(([x, y, ph]) => (
            <AcText key={x} at={[x + (x < 0 ? -0.15 : 0.15), y, BUSH_Z] as Vec3} pos="+" neg="−" phase={vPhase + ph} tone="emf" />
          ))}
          <Marker at={[-1.5, 0.82, 0.92]} text="1U" tone="neutral" />
          <Marker at={[1.5, 0.82, 0.92]} text="2U" tone="neutral" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <AcFlow points={ENERGY_PATH} color={LAYER_COLOR.energy} phase={vPhase} power width={4} xray />
          {ENERGY_ARROWS.map(([at, dir], k) => (
            <Arrow key={k} from={at} dir={dir} length={0.28} radius={0.02} head={0.12} color={LAYER_COLOR.energy} />
          ))}
          <Marker at={[-1.25, 2.3, BUSH_Z]} text="Pin = V1·I1" tone="energy" />
          <Marker at={[1.25, 2.45, BUSH_Z]} text="Pout = V2·I2" tone="energy" />
          <Marker at={[0, -1.25, 0.6]} text="core loss: hysteresis + eddy" tone="energy" />
          <Marker at={[-LX, -1.05, 0.9]} text="I1²R1" tone="energy" />
          <Marker at={[LX, -1.05, 0.9]} text="I2²R2" tone="energy" />
        </group>
      )}
    </group>
  )
}
