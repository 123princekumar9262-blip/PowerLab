import type { ModelState, Vec3 } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { arc, Arrow, CurvedArrow, LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { Flow, PhaseBars } from '../systems/flow.tsx'
import {
  BODY_W,
  Brushes,
  COLORS,
  Coupling,
  CoupledStub,
  DamperBars,
  EndShield,
  FieldCoils,
  Frame,
  LC,
  PHASE_AXIS,
  RING_Z,
  RotorCore,
  Shaft,
  SlipRings,
  StatorCore,
  StatorWinding,
  TerminalBox,
  useSyncGeometry,
  type Phase,
} from './geometry.tsx'

/*
 * The two synchronous machines drawn from the shared geometry. Rotor angle 0: N poles at θm = 0° and 180°.
 * The rotor turns counter-clockwise seen from the front (+z): positive rotation about z.
 *   Alternator: the phase EMF of phase x is e_x ∝ sin(2·(θ − θx)), θx = mechanical angle of its magnetic axis
 *   (a 0°, b 60°, c 120° for 4 poles): the bars peak a → b → c as θ grows.
 *   Under an N pole the EMF in a stator conductor points towards the front (⊙): v_rel × B with v_rel = −θ̂, B = +r̂.
 *   Motor: the stator field axis leads the rotor N axis by the mechanical load angle δm = δ / (P/2), P = 4 drawn.
 */

const ZF = LC / 2 + 0.1 // the plane where the layers are drawn (just in front of the coil ends)
const polar = (r: number, a: number, z = ZF): Vec3 => [r * Math.cos(a), r * Math.sin(a), z]
const POLES = [0, 1, 2, 3].map((i) => ({ a: (i * Math.PI) / 2, north: i % 2 === 0 }))
const STATOR_FIELD = '#a78bfa'
const ROTOR_FIELD = '#ff8a80'

function kW(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return ''
  return ` = ${x >= 100 ? x.toFixed(0) : x.toFixed(1)} kW`
}

/** The flux of the rotor poles: out of each N pole, round the stator yoke, into the neighbouring S poles. */
function RotorFlux() {
  const paths: Vec3[][] = []
  for (const n of POLES.filter((p) => p.north))
    for (const s of [1, -1]) {
      const a = n.a
      const b = n.a + (s * Math.PI) / 2
      paths.push([...[0.24, 0.6, 0.95, 1.36].map((r) => polar(r, a)), ...arc(1.36, a, b, ZF, 16).slice(1), ...[0.95, 0.6, 0.24].map((r) => polar(r, b)), ...arc(0.24, b, a, ZF, 8).slice(1)])
    }
  return (
    <group>
      {paths.map((p, i) => (
        <Flow key={i} points={p} color={LAYER_COLOR.field} onTop width={2.2} />
      ))}
      {POLES.map((p) => (
        <Marker key={p.a} at={polar(0.84, p.a, ZF + 0.02)} text={p.north ? 'N' : 'S'} tone={p.north ? 'north' : 'south'} />
      ))}
    </group>
  )
}

/** DC field current on the pole coils (inside the rotor frame) — ⊙/⊗ on the coil sides, an arrow on the front end. */
function FieldCurrent() {
  const w = BODY_W + 0.045
  return (
    <group>
      {POLES.map((p) => {
        const c = Math.cos(p.a)
        const s = Math.sin(p.a)
        const at = (x: number, y: number, z: number): Vec3 => [x * c - y * s, x * s + y * c, z]
        const tdir: Vec3 = p.north ? [s, -c, 0] : [-s, c, 0] // N: −ŷ local at the front end
        return (
          <group key={p.a}>
            <Marker at={at(0.56, w, ZF)} text={p.north ? '⊙' : '⊗'} tone="current" />
            <Marker at={at(0.56, -w, ZF)} text={p.north ? '⊗' : '⊙'} tone="current" />
            <Arrow from={at(0.5, p.north ? 0.12 : -0.12, LC / 2 + 0.09)} dir={tdir} length={0.24} color={LAYER_COLOR.current} radius={0.014} head={0.07} />
          </group>
        )
      })}
    </group>
  )
}

function BrushCurrent() {
  return (
    <group>
      <Flow points={[[0, 1.05, RING_Z[0]], [0, 0.27, RING_Z[0]]]} color={LAYER_COLOR.current} onTop />
      <Flow points={[[0, 0.27, RING_Z[1]], [0, 1.05, RING_Z[1]]]} color={LAYER_COLOR.current} onTop />
      <Marker at={[0, 1.16, RING_Z[0] - 0.05]} text="+ If" tone="current" />
      <Marker at={[0, 1.16, RING_Z[1] + 0.07]} text="−" tone="current" />
    </group>
  )
}

/** Shared static parts of both machines. */
function Stator({ geo }: { geo: ReturnType<typeof useSyncGeometry> }) {
  return (
    <>
      <Part id="frame">
        <Frame />
      </Part>
      <Part id="terminal-box">
        <TerminalBox />
      </Part>
      <Part id="end-shield-front">
        <EndShield side={1} />
      </Part>
      <Part id="end-shield-rear">
        <EndShield side={-1} />
      </Part>
      <Part id="stator-core">
        <StatorCore geo={geo.stator} />
      </Part>
      <Part id="stator-winding">
        <StatorWinding />
      </Part>
      <Part id="brushes">
        <Brushes />
      </Part>
    </>
  )
}

function RotorParts({ geo, damper }: { geo: ReturnType<typeof useSyncGeometry>; damper: boolean }) {
  return (
    <>
      <Part id="shaft">
        <Shaft />
      </Part>
      <Part id="rotor">
        <RotorCore geo={geo.rotor} />
      </Part>
      <Part id="field-winding">
        <FieldCoils geo={geo.coil} />
      </Part>
      {damper && (
        <Part id="damper-winding">
          <DamperBars />
        </Part>
      )}
      <Part id="slip-rings">
        <SlipRings />
      </Part>
      <Part id="coupling">
        <Coupling />
      </Part>
    </>
  )
}

const PH: Phase[] = ['a', 'b', 'c']

export function AlternatorModel({ state }: { state: ModelState }) {
  const geo = useSyncGeometry()
  const L = state.layers
  const c = state.calc
  return (
    <group>
      <Stator geo={geo} />
      <Part id="prime-mover">
        <CoupledStub color="#5b6b4f" kind="prime-mover" />
      </Part>
      <Spin axis="z">
        <RotorParts geo={geo} damper={false} />
        {L.has('field') && <RotorFlux />}
        {L.has('current') && <FieldCurrent />}
        {L.has('emf') &&
          POLES.map((p) => <Marker key={p.a} at={polar(1.13, p.a, ZF + 0.06)} text={p.north ? 'e ⊙' : 'e ⊗'} tone="emf" />)}
      </Spin>

      {L.has('current') && <BrushCurrent />}
      {L.has('rotation') && <CurvedArrow radius={0.42} start={-Math.PI * 0.2} sweep={Math.PI * 1.3} z={1.78} color={LAYER_COLOR.rotation} tube={0.022} />}
      {L.has('emf') && (
        <group>
          {PH.map((ph) => (
            <Marker key={ph} at={polar(1.62, PHASE_AXIS[ph] + Math.PI / 4, 1.12)} text={`${ph}+`} tone="emf" />
          ))}
          <PhaseBars at={[0, -2.35, -2.5]} title="Phase EMFs (a → b → c)" labels={['ea', 'eb', 'ec']} colors={[COLORS.phase.a, COLORS.phase.b, COLORS.phase.c]} value={(ang, k) => Math.sin(2 * (ang - PHASE_AXIS[PH[k]]))} />
        </group>
      )}
      {L.has('torque') && (
        <group>
          <CurvedArrow radius={1.0} start={-Math.PI * 0.1} sweep={Math.PI * 0.9} z={-2.1} color={LAYER_COLOR.torque} />
          <Marker at={[1.2, -0.5, -2.1]} text="T prime mover (drives)" tone="torque" />
          <CurvedArrow radius={1.85} start={Math.PI * 0.85} sweep={-Math.PI * 0.6} z={1.15} color={LAYER_COLOR.torque} />
          <Marker at={[-1.8, 1.2, 1.15]} text="Te counter-torque" tone="torque" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={[[0, 0, -2.45], [0, 0, -0.3], [0, 0.9, 0], [0, 1.9, 0.25], [0.9, 2.05, 0.25], [1.9, 2.05, 0.25]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Flow points={[[0, 0.9, 0], [-1.2, 1.4, 0], [-2.0, 1.4, 0]]} color={LAYER_COLOR.energy} width={1.6} onTop />
          <Marker at={[0.25, -0.45, -2.3]} text={`Pmech = T·ω${kW(c.pmech)}`} tone="energy" />
          <Marker at={[1.85, 2.3, 0.25]} text={`Pout = 3·V·I${kW(c.pout)}`} tone="energy" />
          <Marker at={[-2.05, 1.62, 0]} text="heat: I²R, iron, friction" tone="energy" />
        </group>
      )}
    </group>
  )
}

export function SyncMotorModel({ state }: { state: ModelState }) {
  const geo = useSyncGeometry()
  const L = state.layers
  const c = state.calc
  const atRest = state.step === 'stator-field' || state.step === 'starting'
  const pulledOut = c.delta === null && c.tmax !== null
  // mechanical load angle on the drawn 4-pole machine; nothing before the rotor is excited and locked
  const deltaM = atRest ? 0 : (((c.delta ?? 0) * Math.PI) / 180) / 2
  const rotorRatio = atRest ? 0 : pulledOut ? 0.8 : 1
  const showDelta = !atRest && !pulledOut && deltaM > 0.02 && L.has('rotatingField') && L.has('field')
  return (
    <group>
      <Stator geo={geo} />
      <Part id="load">
        <CoupledStub color="#6b5b8a" kind="load" />
      </Part>
      <Spin axis="z" ratio={rotorRatio}>
        <RotorParts geo={geo} damper />
        {L.has('field') && (
          <group>
            {POLES.map((p) => (
              <Marker key={p.a} at={polar(0.84, p.a, ZF + 0.02)} text={p.north ? 'N' : 'S'} tone={p.north ? 'north' : 'south'} />
            ))}
            {POLES.filter((p) => p.north).map((p) => (
              <Arrow key={p.a} from={polar(0.12, p.a, ZF + 0.04)} dir={[Math.cos(p.a), Math.sin(p.a), 0]} length={0.62} color={ROTOR_FIELD} radius={0.022} />
            ))}
            <Marker at={polar(0.5, -0.32, ZF + 0.06)} text="Br" tone="north" />
            {showDelta && (
              <group>
                <Flow points={arc(0.42, 0, deltaM, ZF + 0.05, 12)} color={LAYER_COLOR.torque} rate={0} width={2.5} onTop />
                <Marker at={polar(0.52, deltaM / 2, ZF + 0.06)} text="δ" tone="torque" />
              </group>
            )}
          </group>
        )}
        {L.has('current') && !atRest && <FieldCurrent />}
      </Spin>
      {L.has('rotatingField') && (
        <Spin axis="z" phase={deltaM}>
          {[0, Math.PI].map((a) => (
            <Arrow key={a} from={polar(0.16, a, ZF + 0.12)} dir={[Math.cos(a), Math.sin(a), 0]} length={1.15} color={STATOR_FIELD} radius={0.026} />
          ))}
          <Marker at={polar(1.42, 0.1, ZF + 0.12)} text="Bs" tone="neutral" />
          <Marker at={polar(1.42, Math.PI + 0.1, ZF + 0.12)} text="Bs" tone="neutral" />
          {/* starting: the field sweeps over the still damper bars — EMF v_rel × B is ⊙ where Bs points outwards, ⊗ where it points inwards */}
          {L.has('current') && state.step === 'starting' &&
            POLES.map((p) => <Marker key={p.a} at={polar(0.9, p.a, ZF + 0.04)} text={p.north ? '⊙' : '⊗'} tone="current" />)}
        </Spin>
      )}
      {L.has('current') && !atRest && <BrushCurrent />}
      {L.has('rotation') && <CurvedArrow radius={0.42} start={-Math.PI * 0.2} sweep={Math.PI * 1.3} z={1.78} color={LAYER_COLOR.rotation} tube={0.022} />}
      {L.has('torque') && (
        <group>
          <CurvedArrow radius={1.85} start={Math.PI * 0.25} sweep={Math.PI * 0.6} z={1.15} color={LAYER_COLOR.torque} />
          <Marker at={[1.45, 1.5, 1.15]} text="Te (motoring)" tone="torque" />
          <CurvedArrow radius={1.0} start={Math.PI * 0.8} sweep={-Math.PI * 0.9} z={-2.1} color={LAYER_COLOR.torque} />
          <Marker at={[-1.0, 0.8, -2.1]} text="TL load (opposes)" tone="torque" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={[[1.9, 2.05, 0.25], [0.9, 2.05, 0.25], [0, 1.9, 0.25], [0, 0.9, 0], [0, 0, -0.3], [0, 0, -2.45]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Marker at={[1.85, 2.3, 0.25]} text="Pin = 3·V·I·cos φ" tone="energy" />
          <Marker at={[0.25, -0.45, -2.3]} text={`Pout = T·ωs${kW(c.pout)}`} tone="energy" />
        </group>
      )}
      {pulledOut && !atRest && <Marker at={[0, -2.05, 1.0]} text="Beyond pull-out: the rotor slips poles (no steady state)" tone="torque" />}
      {atRest && L.has('rotatingField') && <Marker at={[0, -2.05, 1.0]} text={state.step === 'starting' ? 'Rotor at rest: the field sweeps past it and induces currents (⊙/⊗) in the damper bars' : 'Rotor at rest, not excited: only the field turns'} tone="neutral" />}
    </group>
  )
}
