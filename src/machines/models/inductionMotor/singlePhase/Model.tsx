import { useMemo } from 'react'
import { spPoint, SPIM_EXAMPLE } from '../../../calculations/induction.ts'
import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { CurvedArrow, LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import {
  Bearings,
  CageBars,
  DIM,
  EndRing,
  EndShield,
  EnergyFlow,
  FieldPattern,
  Frame,
  PhaseScope,
  PulsatingPoles,
  RotationArrows,
  RotorCore,
  Shaft,
  SlotCurrents,
  StatorCore,
  Turn,
  Winding,
} from '../common.tsx'
import { BELTS_1PH, windingLayout } from '../layout.ts'

/*
 * Single-phase capacitor-start induction motor — original procedural geometry (simplified). 24-slot stator with
 * a main winding (two-thirds of the slots, red) and an auxiliary winding 90° electrical behind it (blue), a skewed
 * 18-bar cage, a start capacitor on the frame and a centrifugal switch at the rear.
 */
const BARS = 18
const SKEW = (2 * Math.PI) / 24
const Z = { shieldF: 1.1, shieldR: -1.35, frameF: 1.05, frameR: -1.3, shaftBack: -1.65, shaftFront: 2.1, sw: -1.12 }
const BACKWARD = '#a98be8'
const FORWARD_FAINT = '#57c7c0'
const fmtW = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x)} W`)

type Mode = 'rest-main' | 'rest-start' | 'running'
function modeOf(step: string | null): Mode {
  if (step === 'pulsating' || step === 'double-field') return 'rest-main'
  if (step === 'start') return 'rest-start'
  return 'running'
}

export function SinglePhaseModel({ state }: { state: ModelState }) {
  const P = state.params.poles ?? 4
  const pp = P / 2
  const layout = useMemo(() => windingLayout(24, P, BELTS_1PH)!, [P])
  const L = state.layers
  const step = state.step
  const mode = modeOf(step)
  const s = state.calc.s ?? null
  const ratio = mode === 'running' && s != null ? 1 - s : 0
  const auxOn = mode === 'rest-start'
  const switchOpen = mode === 'running' && s != null
  const c = state.calc
  const atRest = useMemo(() => spPoint(SPIM_EXAMPLE, state.params.f, P, 1), [state.params.f, P])
  const tf = mode === 'running' ? c.tf : atRest.tf
  const tb = mode === 'running' ? c.tb : atRest.tb
  const qMax = Math.max(...layout.coils.map((x) => x.q))
  const rw = switchOpen ? 0.36 : 0.22
  const collarZ = switchOpen ? Z.sw + 0.1 : Z.sw - 0.04

  return (
    <group>
      {/* ── stator ── */}
      <Part id="frame">
        <Frame zBack={Z.frameR} zFront={Z.frameF} />
      </Part>
      <Part id="capacitor">
        <group position={[0, DIM.frameOut + 0.2, -0.05]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.17, 0.17, 0.62, 32]} />
            <meshStandardMaterial color="#2b2f36" metalness={0.3} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 0.03, 32]} />
            <meshStandardMaterial color="#8d949e" metalness={0.6} roughness={0.4} />
          </mesh>
          {[-0.06, 0.06].map((x) => (
            <mesh key={x} position={[x, 0.02, 0.37]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.08, 10]} />
              <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          {[-0.2, 0.2].map((z) => (
            <mesh key={z} position={[0, -0.02, z]}>
              <torusGeometry args={[0.18, 0.018, 8, 32]} />
              <meshStandardMaterial color="#6b7686" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
        </group>
      </Part>
      <Part id="end-shield-front">
        <EndShield z={Z.shieldF} outward={1} />
      </Part>
      <Part id="end-shield-rear">
        <EndShield z={Z.shieldR} outward={-1} />
      </Part>
      <Part id="stator-core">
        <StatorCore slots={24} offset={layout.offset} />
      </Part>
      <Part id="main-winding">
        <Winding layout={layout} phases={['m']} phaseLift={{ m: 0 }} dh={0.14 / Math.max(1, qMax - 1)} slotW={0.09} />
      </Part>
      <Part id="aux-winding">
        <Winding layout={layout} phases={['x']} phaseLift={{ x: 0.07 }} dh={0.14 / Math.max(1, qMax - 1)} slotW={0.09} />
      </Part>
      <Part id="bearings">
        <Bearings at={[Z.shieldF, Z.shieldR]} />
      </Part>

      {/* ── rotor ── */}
      <Turn ratio={ratio}>
        <Part id="shaft">
          <Shaft zBack={Z.shaftBack} zFront={Z.shaftFront} />
        </Part>
        <Part id="rotor-core">
          <RotorCore n={BARS} skew={SKEW} />
        </Part>
        <Part id="rotor-cage">
          <CageBars n={BARS} skew={SKEW} />
          <EndRing z={DIM.len / 2 + 0.045} />
          <EndRing z={-DIM.len / 2 - 0.045} />
        </Part>
        <Part id="centrifugal-switch">
          {/* rotating half: hub, sliding collar, two flyweights on arms */}
          <mesh position={[0, 0, Z.sw + 0.12]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.17, 0.17, 0.06, 28]} />
            <meshStandardMaterial color="#7f8894" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, collarZ]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.24, 0.24, 0.06, 28]} />
            <meshStandardMaterial color="#d6dbe2" metalness={0.6} roughness={0.35} />
          </mesh>
          {[1, -1].map((sg) => (
            <group key={sg}>
              <mesh position={[sg * (rw / 2 + 0.06), 0, Z.sw + 0.04]}>
                <boxGeometry args={[rw, 0.04, 0.03]} />
                <meshStandardMaterial color="#7f8894" metalness={0.7} roughness={0.35} />
              </mesh>
              <mesh position={[sg * (rw + 0.09), 0, Z.sw + 0.04]}>
                <boxGeometry args={[0.13, 0.24, 0.16]} />
                <meshStandardMaterial color="#e0a030" metalness={0.6} roughness={0.35} />
              </mesh>
            </group>
          ))}
          {/* stationary half: contact arm on the rear shield (counter-rotated: it does not turn) */}
          <Turn ratio={-ratio}>
            <mesh position={[0, 0.3, Z.sw - 0.1]}>
              <boxGeometry args={[0.12, 0.26, 0.04]} />
              <meshStandardMaterial color="#e3d7b8" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.22, Z.sw - 0.07]}>
              <boxGeometry args={[0.06, 0.06, 0.03]} />
              <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.3} />
            </mesh>
          </Turn>
        </Part>
      </Turn>

      {/* ── conceptual layers ── */}
      {L.has('current') && (
        <group>
          <SlotCurrents layout={layout} pp={pp} auxOn={auxOn} />
          <PhaseScope at={[-1.5, 1.45, 0.9]} phases={['m', 'x']} pp={pp} auxOn={auxOn} title={auxOn ? 'Main and auxiliary currents' : 'Main current (auxiliary off)'} />
        </group>
      )}
      {L.has('rotatingField') &&
        (mode === 'rest-start' ? (
          <Turn ratio={1}>
            <FieldPattern pp={pp} />
          </Turn>
        ) : (
          <group>
            <PulsatingPoles pp={pp} />
            {step !== 'pulsating' && (
              <>
                <Turn ratio={1}>
                  <FieldPattern pp={pp} color={FORWARD_FAINT} lines={false} labels={false} arrowLen={0.2} faint z={DIM.len / 2 + 0.22} />
                </Turn>
                <Turn ratio={-1}>
                  <FieldPattern pp={pp} color={BACKWARD} lines={false} labels={false} arrowLen={0.2} faint z={DIM.len / 2 + 0.22} />
                </Turn>
              </>
            )}
          </group>
        ))}
      {L.has('torque') && (
        <group>
          <CurvedArrow radius={1.36} start={Math.PI * 0.68} sweep={Math.PI * 0.55} z={0.95} color={LAYER_COLOR.torque} tube={0.026} />
          <Marker at={[-1.75, 0.1, 0.95]} text={`Tf = ${tf == null ? '—' : tf.toFixed(2)} N·m ↺`} tone="torque" />
          <CurvedArrow radius={1.36} start={Math.PI * 1.95} sweep={-Math.PI * 0.5} z={0.95} color={BACKWARD} tube={0.026} />
          <Marker at={[0.75, -1.05, 1.0]} text={`Tb = ${tb == null ? '—' : tb.toFixed(2)} N·m ↻`} tone="neutral" />
        </group>
      )}
      {L.has('rotation') && <RotationArrows z={1.95} fieldLabel="Ns (forward)" />}
      {L.has('energy') && (
        <EnergyFlow
          main={[[0, 1.45, 0.3], [0, 1.05, 0.75], [0, 0.74, 0.92], [0, 0.56, 0.92], [0, 0.3, 0.92], [0, 0.17, 1.2], [0, 0.17, 2.4]]}
          branches={[
            [[0, 0.74, 0.92], [-0.5, 1.2, 1.0]],
            [[0, 0.3, 0.92], [-0.75, 0.05, 1.1]],
          ]}
          labels={[
            { at: [0.2, 1.75, 0.35], text: `Pin = ${fmtW(c.pin)}` },
            { at: [-0.6, 1.36, 1.0], text: `stator Cu = ${fmtW(c.pcu1)}` },
            { at: [-0.95, -0.08, 1.1], text: `rotor Cu (fwd + bwd) = ${fmtW(c.pcu2)}` },
            { at: [0.3, 0.42, 2.45], text: `Pmech = ${fmtW(c.pmech)}` },
          ]}
        />
      )}
    </group>
  )
}
