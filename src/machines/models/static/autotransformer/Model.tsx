import { useMemo } from 'react'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { Arrow, LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import { AcArrow, AcFlow, BOBBIN, BRASS, CoilStack, FRAME_STEEL, Laminated, polyShape, rectLoop, rectShape, ringGeometry, Wire } from '../shared.tsx'
import { tapFraction } from './content.ts'

/*
 * Step-down autotransformer on a shell-type E-I core — original procedural geometry (simplified). Core in the xy
 * plane (front +z): centre limb x = ±0.4, outer limbs at |x| = 1.1…1.5, I bar on top (y 1.1…1.5). One winding of
 * RINGS rings on the centre limb from y = −1 to +1: the lower k·RINGS rings are the common section, the rest the
 * series section; the tap is taken at their boundary (k = N2/N1 from the parameters).
 *
 * Directions: positive flux goes UP the centre limb and down both outer limbs. The input current I1 (in phase
 * with V1, resistive load) circulates +x on the front of the series section; the common-section current
 * Ic = I2 − I1 circulates −x (ampere-turn balance).
 */
const RINGS = 20
const WY0 = -1.0
const WY1 = 1.0
const FZ = 1.04 // just in front of the winding
const BOARD_Y = 1.14
const STUD_Z = 0.85
const COPPER_SERIES = '#c27a3c'
const COPPER_COMMON = '#a95f2c'

export function AutotransformerModel({ state }: { state: ModelState }) {
  const k = tapFraction(state.params)
  const nCommon = Math.max(1, Math.min(RINGS, Math.round(k * RINGS)))
  const pitch = (WY1 - WY0) / RINGS
  const yTap = WY0 + nCommon * pitch
  const shapes = useMemo(
    () => ({
      e: polyShape([
        [-1.5, -1.5],
        [1.5, -1.5],
        [1.5, 1.1],
        [1.1, 1.1],
        [1.1, -1.1],
        [0.4, -1.1],
        [0.4, 1.1],
        [-0.4, 1.1],
        [-0.4, -1.1],
        [-1.1, -1.1],
        [-1.1, 1.1],
        [-1.5, 1.1],
      ]),
      i: rectShape(-1.5, 1.1, 1.5, 1.5),
      tube: ringGeometry(0.42, 0.42, 0.46, 0.46, 2.16, 0.06),
      flange: ringGeometry(0.46, 0.46, 1.06, 1.06, 0.04, 0.1),
    }),
    [],
  )
  const L = state.layers
  const iPh = Math.PI / 2 // load currents in phase with the voltage
  const ySeries = (yTap + WY1) / 2
  const yCommon = (WY0 + yTap) / 2
  const studTop = BOARD_Y + 0.3
  const paths = useMemo(() => {
    const conducted: Vec3[] = [[-0.6, studTop, STUD_Z], [-0.6, 1.0, FZ], [-0.6, Math.max(yTap, -0.9), FZ], [0, Math.max(yTap, -0.9), FZ], [0, 1.0, FZ], [0, studTop, STUD_Z]]
    const transformed: Vec3[] = [[-0.6, studTop, STUD_Z], [-0.6, 1.0, FZ], [-0.45, ySeries, 0.6], [0.2, ySeries, 0.45], [0.2, yCommon, 0.45], [0.45, yCommon, 0.6], [0.0, yTap, FZ], [0, 1.0, FZ], [0, studTop, STUD_Z]]
    return { conducted, transformed }
  }, [yTap, ySeries, yCommon, studTop])

  return (
    <group>
      <Part id="frame">
        {[1.3, -1.3].map((y) =>
          [0.46, -0.46].map((z) => (
            <mesh key={`${y}${z}`} position={[0, y, z]}>
              <boxGeometry args={[3.3, 0.36, 0.08]} />
              <meshStandardMaterial color={FRAME_STEEL} metalness={0.55} roughness={0.5} />
            </mesh>
          )),
        )}
        {[0.62, -0.62].map((z) => (
          <mesh key={`foot${z}`} position={[0, -1.52, z]}>
            <boxGeometry args={[3.3, 0.05, 0.36]} />
            <meshStandardMaterial color={FRAME_STEEL} metalness={0.55} roughness={0.5} />
          </mesh>
        ))}
      </Part>
      <Part id="core-e">
        <Laminated shape={shapes.e} depth={0.8} n={14} />
      </Part>
      <Part id="core-i">
        <Laminated shape={shapes.i} depth={0.8} n={14} />
      </Part>
      <Part id="bobbin">
        <mesh geometry={shapes.tube} position={[0, -1.08, 0]}>
          <meshStandardMaterial color={BOBBIN} roughness={0.7} />
        </mesh>
        {[-1.08, 1.04].map((y) => (
          <mesh key={y} geometry={shapes.flange} position={[0, y, 0]}>
            <meshStandardMaterial color={BOBBIN} roughness={0.7} />
          </mesh>
        ))}
      </Part>
      <Part id="winding-common">
        <CoilStack key={`c${nCommon}`} ix={0.5} iz={0.5} ox={1.0} oz={1.0} y0={WY0} y1={yTap - 0.006} turns={nCommon} color={COPPER_COMMON} gap={0.01} />
      </Part>
      <Part id="winding-series">
        {nCommon < RINGS && <CoilStack key={`s${nCommon}`} ix={0.5} iz={0.5} ox={1.0} oz={1.0} y0={yTap + 0.006} y1={WY1} turns={RINGS - nCommon} color={COPPER_SERIES} gap={0.01} />}
      </Part>
      <Part id="tap">
        <Wire points={[[0, yTap, FZ - 0.02], [0, 1.06, FZ], [0, BOARD_Y, STUD_Z]]} radius={0.022} color={COPPER_SERIES} />
        <mesh position={[0, yTap, FZ - 0.01]}>
          <sphereGeometry args={[0.04, 12, 10]} />
          <meshStandardMaterial color={BRASS} metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, BOARD_Y + 0.15, STUD_Z]}>
          <cylinderGeometry args={[0.05, 0.05, 0.3, 14]} />
          <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
        </mesh>
      </Part>
      <Part id="terminals">
        <mesh position={[0, BOARD_Y - 0.02, 0.8]}>
          <boxGeometry args={[1.7, 0.04, 0.5]} />
          <meshStandardMaterial color="#7a5a35" roughness={0.8} />
        </mesh>
        {/* H1 from the top turn; N from the bottom turn, brought up the front of the coil */}
        <Wire points={[[-0.6, 0.97, 0.9], [-0.6, 1.06, 0.95], [-0.6, BOARD_Y, STUD_Z]]} radius={0.022} color={COPPER_SERIES} />
        <Wire points={[[0.6, -0.97, FZ - 0.02], [0.6, 1.06, FZ], [0.6, BOARD_Y, STUD_Z]]} radius={0.022} color={COPPER_COMMON} />
        {[-0.6, 0.6].map((x) => (
          <mesh key={x} position={[x, BOARD_Y + 0.15, STUD_Z]}>
            <cylinderGeometry args={[0.05, 0.05, 0.3, 14]} />
            <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
          </mesh>
        ))}
      </Part>

      {/* ── conceptual layers ── */}
      {L.has('flux') && (
        <group>
          <AcFlow points={rectLoop(0.12, -1.3, 1.3, 1.3, 0.45)} color={LAYER_COLOR.field} xray width={2.5} />
          <AcFlow points={rectLoop(-0.12, -1.3, -1.3, 1.3, 0.45)} color={LAYER_COLOR.field} xray width={2.5} />
          <AcArrow at={[0.22, 0.1, 0.45]} dir={[0, 1, 0]} length={0.6} color={LAYER_COLOR.field} xray />
          <AcArrow at={[-1.3, 0, 0.45]} dir={[0, -1, 0]} length={0.5} color={LAYER_COLOR.field} amp={0.75} />
          <AcArrow at={[1.3, 0, 0.45]} dir={[0, -1, 0]} length={0.5} color={LAYER_COLOR.field} amp={0.75} />
          <AcArrow at={[-0.75, 1.3, 0.45]} dir={[-1, 0, 0]} length={0.4} color={LAYER_COLOR.field} amp={0.75} />
          <AcArrow at={[0.75, 1.3, 0.45]} dir={[1, 0, 0]} length={0.4} color={LAYER_COLOR.field} amp={0.75} />
          <Marker at={[-1.3, -0.55, 0.5]} text="Φ/2" tone="field" />
          <Marker at={[1.3, -0.55, 0.5]} text="Φ/2" tone="field" />
        </group>
      )}
      {L.has('current') && (
        <group>
          {/* supply: from the N node through the source into H1 (amplitude k: I1 = k·I2) */}
          <AcFlow points={[[0.6, 1.8, STUD_Z], [0.6, 2.35, STUD_Z], [-0.6, 2.35, STUD_Z], [-0.6, studTop, STUD_Z]]} color={LAYER_COLOR.current} phase={iPh} amp={k} />
          <Marker at={[0, 2.5, STUD_Z]} text="~ V1" tone="current" />
          <AcArrow at={[-0.6, 1.85, STUD_Z]} dir={[0, -1, 0]} length={0.28} radius={0.02} color={LAYER_COLOR.current} phase={iPh} min={0.4} />
          <Marker at={[-0.85, 1.85, STUD_Z]} text="I1" tone="current" />
          {/* load: out of the tap X1, through the load, to the N node */}
          <AcFlow points={[[0, studTop, STUD_Z], [0, 1.8, STUD_Z], [0.6, 1.8, STUD_Z]]} color={LAYER_COLOR.current} phase={iPh} />
          <mesh position={[0.3, 1.8, STUD_Z]} userData={{ noHighlight: true }}>
            <boxGeometry args={[0.22, 0.1, 0.1]} />
            <meshBasicMaterial color="#d7dbe2" toneMapped={false} />
          </mesh>
          <Marker at={[0.3, 1.97, STUD_Z]} text="load" tone="current" />
          <Marker at={[-0.2, 1.62, STUD_Z]} text="I2" tone="current" />
          {/* the N node returns I2 − I1 into the common section */}
          <AcFlow points={[[0.6, 1.8, STUD_Z], [0.6, studTop, STUD_Z]]} color={LAYER_COLOR.current} phase={iPh} amp={1 - k} />
          <Marker at={[0.98, 1.6, STUD_Z]} text="I2 − I1" tone="current" />
          {/* circulation on the front of the two sections: opposite senses, length ∝ current */}
          {nCommon < RINGS && <AcArrow at={[-0.3, ySeries, 1.08]} dir={[1, 0, 0]} length={0.5} color={LAYER_COLOR.current} phase={iPh} amp={k} />}
          <AcArrow at={[-0.3, yCommon, 1.08]} dir={[-1, 0, 0]} length={0.5} color={LAYER_COLOR.current} phase={iPh} amp={1 - k} />
          {nCommon < RINGS && <Marker at={[-0.78, ySeries, 1.1]} text="I1" tone="current" />}
          <Marker at={[-0.86, yCommon, 1.1]} text="I2 − I1" tone="current" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <AcFlow points={paths.conducted} color={LAYER_COLOR.energy} phase={iPh} power width={1.5 + 6 * k} xray />
          <AcFlow points={paths.transformed} color="#f2a383" phase={iPh} power width={1.5 + 6 * (1 - k)} xray dash={0.08} gap={0.08} />
          <Arrow from={[0, 0.62, FZ + 0.04]} dir={[0, 1, 0]} length={0.3} radius={0.022} color={LAYER_COLOR.energy} />
          <Arrow from={[0.2, ySeries, 0.62]} dir={[0, -1, 0]} length={Math.max(0.15, Math.min(0.35, ySeries - yCommon - 0.05))} radius={0.022} color="#f2a383" />
          <Marker at={[-1.05, 1.95, STUD_Z]} text={`conducted ${(k * 100).toFixed(0)} %`} tone="energy" />
          <Marker at={[-1.05, -0.2, 1.0]} text={`transformed ${((1 - k) * 100).toFixed(0)} %`} tone="energy" />
        </group>
      )}
    </group>
  )
}
