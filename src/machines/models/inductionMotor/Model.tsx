import { useMemo } from 'react'
import { imOperating, IM_EXAMPLE, vPhaseVf } from '../../calculations/induction.ts'
import type { ModelState } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { Marker } from '../../visualizations/viz.tsx'
import {
  AirGapRing,
  BarCurrents,
  Bearings,
  CageBars,
  DIM,
  EndRing,
  EndShield,
  EnergyFlow,
  Fan,
  FanCover,
  FieldPattern,
  Frame,
  PhaseScope,
  PoleForces,
  RotationArrows,
  RotorCore,
  Shaft,
  SlotCurrents,
  StatorCore,
  TerminalBox,
  TorqueArrow,
  Turn,
  Winding,
} from './common.tsx'
import { BELTS_3PH, windingLayout } from './layout.ts'

/*
 * Three-phase squirrel-cage induction motor — original procedural geometry (simplified educational model).
 * 36 stator slots, single-layer concentric three-phase winding laid out for the chosen pole number (2, 4 or 6),
 * 28 skewed cage bars. Field and rotor turn counter-clockwise seen from the drive end (+z); the rotor turns at
 * (1 − s) times the field speed, s from the calculation.
 */
const BARS = 28
const SKEW = (2 * Math.PI) / 36 // one stator slot pitch
const Z = { shield: 1.1, frame: 1.05, fan: -1.42, cowl0: -1.18, cowl1: -1.72, shaftBack: -1.55, shaftFront: 2.1 }
const fmtW = (x: number | null | undefined) => (x == null ? '—' : x >= 1000 ? `${(x / 1000).toFixed(2)} kW` : `${Math.round(x)} W`)

/** Rotor speed ratio Nr/Ns for the animation in a given step (starting steps: rotor at rest). */
function rotorRatio(step: string | null, s: number | null, sLoad?: number | null): number {
  if (step === 'currents' || step === 'field' || step === 'induced') return 0
  const x = step === 'load' ? sLoad : s
  return x == null ? 0 : 1 - x
}

export function InductionMotorModel({ state }: { state: ModelState }) {
  const P = state.params.poles ?? 4
  const pp = P / 2
  const layout = useMemo(() => windingLayout(36, P, BELTS_3PH)!, [P])
  const barAngles = useMemo(() => Array.from({ length: BARS }, (_, k) => (k * 2 * Math.PI) / BARS), [])
  const L = state.layers
  const step = state.step
  const s = state.calc.s ?? null
  const sLoad = useMemo(() => (step === 'load' ? (imOperating(IM_EXAMPLE, state.params.f, vPhaseVf(state.params.f), P, 2 * state.params.tl)?.s ?? null) : null), [step, state.params.f, state.params.tl, P])
  const ratio = rotorRatio(step, s, sLoad)
  const atRest = ratio === 0 && (step === 'currents' || step === 'field' || step === 'induced' || s === null)
  // rotor power-factor angle: at rest s = 1
  const phi2 = atRest ? Math.atan2(2 * Math.PI * state.params.f * IM_EXAMPLE.l2, IM_EXAMPLE.r2) : ((state.calc.phi2 ?? 0) * Math.PI) / 180
  const c = state.calc
  return (
    <group>
      {/* ── stator ── */}
      <Part id="frame">
        <Frame zBack={-Z.frame} zFront={Z.frame} />
      </Part>
      <Part id="terminal-box">
        <TerminalBox z={0.15} />
      </Part>
      <Part id="end-shield-front">
        <EndShield z={Z.shield} outward={1} />
      </Part>
      <Part id="end-shield-rear">
        <EndShield z={-Z.shield} outward={-1} />
      </Part>
      <Part id="fan-cover">
        <FanCover z0={Z.cowl0} z1={Z.cowl1} />
      </Part>
      <Part id="stator-core">
        <StatorCore slots={36} offset={layout.offset} />
      </Part>
      <Part id="stator-winding">
        <Winding layout={layout} phaseLift={{ a: 0, b: 0.05, c: 0.1 }} dh={0.12 / Math.max(1, layout.coils[0].q - 1)} />
      </Part>
      <Part id="air-gap">
        <AirGapRing />
      </Part>
      <Part id="bearing-de">
        <Bearings at={[Z.shield]} />
      </Part>
      <Part id="bearing-nde">
        <Bearings at={[-Z.shield]} />
      </Part>

      {/* ── rotor: turns at (1 − s) × the field speed ── */}
      <Turn ratio={ratio}>
        <Part id="shaft">
          <Shaft zBack={Z.shaftBack} zFront={Z.shaftFront} />
        </Part>
        <Part id="rotor-core">
          <RotorCore n={BARS} skew={SKEW} />
        </Part>
        <Part id="rotor-bars">
          <CageBars n={BARS} skew={SKEW} />
        </Part>
        <Part id="end-rings">
          <EndRing z={DIM.len / 2 + 0.045} />
          <EndRing z={-DIM.len / 2 - 0.045} />
        </Part>
        <Part id="fan">
          <Fan z={Z.fan} />
        </Part>
        {L.has('emf') && <BarCurrents angles={barAngles} pp={pp} rotorRatio={ratio} phi2={phi2} />}
      </Turn>

      {/* ── conceptual layers ── */}
      {L.has('current') && (
        <group>
          <SlotCurrents layout={layout} pp={pp} />
          <PhaseScope at={[-1.5, 1.45, 0.9]} phases={['a', 'b', 'c']} pp={pp} title="Phase currents (per unit)" />
        </group>
      )}
      {L.has('rotatingField') && (
        <Turn ratio={1}>
          <FieldPattern pp={pp} />
        </Turn>
      )}
      {L.has('torque') && (
        <group>
          <Turn ratio={1}>
            <PoleForces pp={pp} phi2={phi2} />
          </Turn>
          <TorqueArrow />
        </group>
      )}
      {L.has('rotation') && <RotationArrows z={1.95} />}
      {step === 'load' && sLoad != null && <Marker at={[0, -0.55, 2.0]} text={`load ×2: s = ${(sLoad * 100).toFixed(1)} %`} tone="torque" />}
      {step === 'load' && sLoad == null && <Marker at={[0, -0.55, 2.0]} text="load ×2: above pull-out — stalls" tone="torque" />}
      {L.has('energy') && (
        <EnergyFlow
          main={[[0, 1.45, 0.15], [0, 1.05, 0.75], [0, 0.74, 0.92], [0, 0.56, 0.92], [0, 0.3, 0.92], [0, 0.17, 1.2], [0, 0.17, 2.4]]}
          branches={[
            [[0, 0.74, 0.92], [-0.5, 1.2, 1.0]],
            [[0, 0.3, 0.92], [-0.75, 0.05, 1.1]],
          ]}
          labels={[
            { at: [0.15, 1.7, 0.2], text: `Pin = ${fmtW(c.pin)}` },
            { at: [-0.6, 1.36, 1.0], text: `stator Cu = ${fmtW(c.pcu1)}` },
            { at: [0.55, 0.42, 1.05], text: `Pag = ${fmtW(c.pag)}` },
            { at: [-0.95, -0.08, 1.1], text: `rotor Cu = s·Pag = ${fmtW(c.pcu2)}` },
            { at: [0.3, 0.42, 2.45], text: `Pmech = ${fmtW(c.pmech)}` },
          ]}
        />
      )}
    </group>
  )
}
