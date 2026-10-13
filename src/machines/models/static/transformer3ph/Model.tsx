import { useMemo } from 'react'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { Arrow, LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import { AcArrow, AcFlow, BRASS, Bushing, CoilStack, COPPER_HV, COPPER_LV, FRAME_STEEL, Laminated, polyShape, PRESSBOARD, rectShape, ringGeometry, Wire } from '../shared.tsx'

/*
 * Three-phase three-limb core-type transformer — original procedural geometry (simplified). Limbs A, B, C at
 * x = −1.6, 0, +1.6 (0.45 wide, core depth 0.7), yokes at y = ±1.225. LV winding inside, HV outside on each limb.
 *
 * Directions: limb flux Φk ∝ sin(θ − k·120°), positive = up the limb. The flux leaving the top of limb A goes right
 * along the top yoke (amount Φa); between B and C the top yoke carries Φa + Φb = −Φc to the right. Winding
 * voltages ∝ cos(θ − k·120°). HV winding currents circulate +x on the front face when positive; the LV current on
 * the same limb circulates the other way (ampere-turn balance). Star: winding current = line current; delta: the
 * winding current leads its line current by 30° (positive sequence, I_A = I_AB − I_CA).
 */
const XS = [-1.6, 0, 1.6]
const NAMES = ['A', 'B', 'C']
const LV_NAMES = ['a', 'b', 'c']
const PH = (k: number) => (-k * 2 * Math.PI) / 3
const HZ = 0.72 // HV lead plane (front)
const LZ = 0.5 // LV lead plane
const HT = 1.05 // HV lead level (above the coils)
const LB = -1.05 // LV lead level (below the coils)
const STUD_Z = 1.05

/** HV wiring: line leads (to the bushings) and the star point or the delta links, from the connection. */
function hvWires(delta: boolean): { lines: Vec3[][]; links: Vec3[][] } {
  const s = (k: number) => XS[k] - 0.35
  const e = (k: number) => XS[k] + 0.35
  const ends: Vec3[][] = XS.flatMap((_, k) => [
    [[s(k), 0.86, HZ], [s(k), HT, HZ]],
    [[e(k), 0.86, HZ], [e(k), HT, HZ]],
  ])
  const lines: Vec3[][] = XS.map((_, k) => [[s(k), HT, HZ], [s(k), 1.52, HZ]])
  const links: Vec3[][] = delta
    ? [
        [[e(0), HT, HZ], [s(1), HT, HZ]],
        [[e(1), HT, HZ], [s(2), HT, HZ]],
        [[e(2), HT, HZ], [e(2), 1.17, HZ], [e(2), 1.17, 0.95], [s(0), 1.17, 0.95], [s(0), 1.17, HZ]],
      ]
    : [...XS.map((_, k) => [[e(k), HT, HZ], [e(k), HT, 0.95]] as Vec3[]), [[e(0), HT, 0.95], [e(2), HT, 0.95]]]
  return { lines, links: [...ends, ...links] }
}

/** LV wiring at the bottom front: line leads to the studs a, b, c and the neutral (star) or the delta links. */
function lvWires(delta: boolean): { lines: Vec3[][]; links: Vec3[][] } {
  const s = (k: number) => XS[k] - 0.2
  const e = (k: number) => XS[k] + 0.2
  const ends: Vec3[][] = XS.flatMap((_, k) => [
    [[s(k), -0.93, LZ], [s(k), LB, LZ]],
    [[e(k), -0.93, LZ], [e(k), LB, LZ]],
  ])
  const lines: Vec3[][] = XS.map((_, k) => [[s(k), LB, LZ], [s(k), -1.2, LZ], [s(k), -1.2, STUD_Z], [s(k), -1.3, STUD_Z]])
  const links: Vec3[][] = delta
    ? [
        [[e(0), LB, LZ], [s(1), LB, LZ]],
        [[e(1), LB, LZ], [s(2), LB, LZ]],
        [[e(2), LB, LZ], [e(2), -1.12, LZ], [e(2), -1.12, 0.8], [s(0), -1.12, 0.8], [s(0), -1.12, LZ]],
      ]
    : [...XS.map((_, k) => [[e(k), LB, LZ], [e(k), LB, STUD_Z]] as Vec3[]), [[e(0), LB, STUD_Z], [2.05, LB, STUD_Z], [2.05, -1.3, STUD_Z]]]
  return { lines, links: [...ends, ...links] }
}

export function Transformer3phModel({ state }: { state: ModelState }) {
  const hvDelta = state.params.c1 !== 0
  const lvDelta = state.params.c2 === 1
  const shapes = useMemo(
    () => ({
      comb: polyShape([
        [-1.825, -1.45],
        [1.825, -1.45],
        [1.825, 1.0],
        [1.375, 1.0],
        [1.375, -1.0],
        [0.225, -1.0],
        [0.225, 1.0],
        [-0.225, 1.0],
        [-0.225, -1.0],
        [-1.375, -1.0],
        [-1.375, 1.0],
        [-1.825, 1.0],
      ]),
      top: rectShape(-1.825, 1.0, 1.825, 1.45),
      tube: ringGeometry(0.245, 0.37, 0.27, 0.395, 1.94, 0.05),
      barrier: ringGeometry(0.45, 0.575, 0.47, 0.595, 1.86, 0.1),
    }),
    [],
  )
  const hv = useMemo(() => hvWires(hvDelta), [hvDelta])
  const lv = useMemo(() => lvWires(lvDelta), [lvDelta])
  const L = state.layers
  // current phases (relative to the flux): line current in phase with the winding voltage (unity power factor)
  const vPh = (k: number) => Math.PI / 2 + PH(k)
  const hvWindPh = (k: number) => vPh(k) + (hvDelta ? Math.PI / 6 : 0)
  const lvLinePh = (k: number) => hvWindPh(k) - (lvDelta ? Math.PI / 6 : 0)

  return (
    <group>
      <Part id="frame">
        {[1.225, -1.225].map((y) =>
          [0.41, -0.41].map((z) => (
            <mesh key={`${y}${z}`} position={[0, y, z]}>
              <boxGeometry args={[4.0, 0.42, 0.08]} />
              <meshStandardMaterial color={FRAME_STEEL} metalness={0.55} roughness={0.5} />
            </mesh>
          )),
        )}
        {[0.6, -0.6].map((z) => (
          <mesh key={`foot${z}`} position={[0, -1.49, z]}>
            <boxGeometry args={[4.0, 0.06, 0.4]} />
            <meshStandardMaterial color={FRAME_STEEL} metalness={0.55} roughness={0.5} />
          </mesh>
        ))}
      </Part>
      <Part id="core">
        <Laminated shape={shapes.comb} depth={0.7} n={12} />
      </Part>
      <Part id="top-yoke">
        <Laminated shape={shapes.top} depth={0.7} n={12} />
      </Part>
      <Part id="insulation">
        {XS.map((x) => (
          <group key={x}>
            <mesh geometry={shapes.tube} position={[x, -0.97, 0]}>
              <meshStandardMaterial color={PRESSBOARD} roughness={0.85} />
            </mesh>
            <mesh geometry={shapes.barrier} position={[x, -0.93, 0]}>
              <meshStandardMaterial color={PRESSBOARD} roughness={0.85} />
            </mesh>
          </group>
        ))}
      </Part>
      <Part id="lv-windings">
        {XS.map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <CoilStack ix={0.29} iz={0.415} ox={0.42} oz={0.545} y0={-0.95} y1={0.95} turns={9} color={COPPER_LV} gap={0.02} />
          </group>
        ))}
      </Part>
      <Part id="hv-windings">
        {XS.map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <CoilStack ix={0.5} iz={0.625} ox={0.7} oz={0.825} y0={-0.88} y1={0.88} turns={16} color={COPPER_HV} />
          </group>
        ))}
      </Part>
      <Part id="hv-connections">
        {[...hv.lines, ...hv.links].map((pts, k) => (
          <Wire key={k} points={pts} radius={0.022} color={COPPER_HV} />
        ))}
        <mesh position={[-0.3, 1.52, 0.72]}>
          <boxGeometry args={[3.9, 0.04, 0.42]} />
          <meshStandardMaterial color="#7a5a35" roughness={0.8} />
        </mesh>
        {XS.map((x) => (
          <Bushing key={x} at={[x - 0.35, 1.54, HZ]} height={0.45} />
        ))}
      </Part>
      <Part id="lv-connections">
        {[...lv.lines, ...lv.links].map((pts, k) => (
          <Wire key={k} points={pts} radius={0.03} color={COPPER_LV} />
        ))}
        <mesh position={[0.1, -1.48, 1.07]}>
          <boxGeometry args={[4.3, 0.04, 0.42]} />
          <meshStandardMaterial color="#7a5a35" roughness={0.8} />
        </mesh>
        {[...XS.map((x) => x - 0.2), ...(lvDelta ? [] : [2.05])].map((x) => (
          <mesh key={x} position={[x, -1.38, STUD_Z]}>
            <cylinderGeometry args={[0.05, 0.05, 0.18, 14]} />
            <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
          </mesh>
        ))}
      </Part>

      {/* ── conceptual layers ── */}
      {L.has('flux') && (
        <group>
          {XS.map((x, k) => (
            <group key={x}>
              <AcArrow at={[x, 0.4, 0.38]} dir={[0, 1, 0]} length={0.6} color={LAYER_COLOR.field} phase={PH(k)} xray />
              <Marker at={[x - 0.16, 0.78, 0.9]} text={`Φ${LV_NAMES[k]}`} tone="field" />
            </group>
          ))}
          {/* yokes: A→B segment carries Φa, B→C carries Φa + Φb = −Φc */}
          <AcArrow at={[-0.8, 1.225, 0.42]} dir={[1, 0, 0]} length={0.5} color={LAYER_COLOR.field} phase={0} xray />
          <AcArrow at={[0.8, 1.225, 0.42]} dir={[1, 0, 0]} length={0.5} color={LAYER_COLOR.field} phase={-Math.PI / 3} xray />
          <AcArrow at={[-0.8, -1.225, 0.42]} dir={[-1, 0, 0]} length={0.5} color={LAYER_COLOR.field} phase={0} xray />
          <AcArrow at={[0.8, -1.225, 0.42]} dir={[-1, 0, 0]} length={0.5} color={LAYER_COLOR.field} phase={-Math.PI / 3} xray />
          <Marker at={[0, -0.45, 0.95]} text="Φa + Φb + Φc = 0" tone="field" />
        </group>
      )}
      {L.has('current') && (
        <group>
          {XS.map((x, k) => (
            <group key={x}>
              {/* HV line lead: positive = into the transformer (down from the bushing) */}
              <AcFlow points={[[x - 0.35, 2.65, HZ], [x - 0.35, 2.12, HZ]]} color={LAYER_COLOR.current} phase={vPh(k)} />
              <AcArrow at={[x - 0.52, 2.38, HZ]} dir={[0, -1, 0]} length={0.3} radius={0.02} color={LAYER_COLOR.current} phase={vPh(k)} min={0.3} />
              <Marker at={[x - 0.35, 2.8, HZ]} text={NAMES[k]} tone="current" />
              <AcArrow at={[x, -0.35, 0.88]} dir={[1, 0, 0]} length={0.42} color={LAYER_COLOR.current} phase={hvWindPh(k)} />
              <AcArrow at={[x, -0.66, 0.6]} dir={[-1, 0, 0]} length={0.3} radius={0.022} color={LAYER_COLOR.current} phase={hvWindPh(k)} xray />
              {/* LV line lead: positive = out of the transformer */}
              <AcFlow points={[[x - 0.2, -1.2, 0.55], [x - 0.2, -1.2, STUD_Z], [x - 0.2, -1.75, STUD_Z]]} color={LAYER_COLOR.current} phase={lvLinePh(k)} />
              <Marker at={[x - 0.2, -1.92, STUD_Z]} text={LV_NAMES[k]} tone="current" />
            </group>
          ))}
          {!lvDelta && <Marker at={[2.05, -1.92, STUD_Z]} text="n" tone="current" />}
          <Marker at={[2.35, 1.05, 0.95]} text={hvDelta ? 'HV: delta Δ' : 'HV: star Y'} tone="neutral" />
          <Marker at={[2.4, -0.98, 1.1]} text={lvDelta ? 'LV: delta Δ' : 'LV: star Y (n)'} tone="neutral" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          {XS.map((x) => (
            <group key={x}>
              <Arrow from={[x - 0.35, 2.6, HZ]} dir={[0, -1, 0]} length={0.4} radius={0.022} color={LAYER_COLOR.energy} />
              <Arrow from={[x, 0.55, 0.92]} dir={[0, -1, 0]} length={0.8} radius={0.03} color={LAYER_COLOR.energy} />
              <Arrow from={[x - 0.2, -1.55, STUD_Z]} dir={[0, -1, 0]} length={0.4} radius={0.022} color={LAYER_COLOR.energy} />
            </group>
          ))}
          <Marker at={[0, 2.85, HZ]} text="S in = √3·VL1·IL1" tone="energy" />
          <Marker at={[0, -2.1, STUD_Z]} text="S out = √3·VL2·IL2" tone="energy" />
          <Marker at={[0, 1.225, 0.6]} text="core loss" tone="energy" />
        </group>
      )}
    </group>
  )
}
