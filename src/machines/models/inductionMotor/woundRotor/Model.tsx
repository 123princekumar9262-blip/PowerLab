import { useMemo } from 'react'
import * as THREE from 'three'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { FlowLine, LAYER_COLOR } from '../../../visualizations/viz.tsx'
import {
  BarCurrents,
  Bearings,
  DIM,
  EndShield,
  EnergyFlow,
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
  tube,
  Turn,
  Winding,
} from '../common.tsx'
import { BELTS_3PH, windingLayout, type Phase } from '../layout.ts'
import { IM_EXAMPLE } from '../../../calculations/induction.ts'
import { WR_RMAX } from './content.ts'

/*
 * Wound-rotor induction motor — original procedural geometry (simplified). Same stator as the cage model
 * (36 slots); rotor with 24 slots and a three-phase single-layer winding of the same pole number, star-connected,
 * leads through the hollow shaft to three slip rings at the non-drive end; brushes; an external star resistor
 * bank whose shorting bar follows Rext.
 */
const Z = { shield: 1.1, frame: 1.05, shaftBack: -1.9, shaftFront: 2.1 }
const RING_Z = [-1.36, -1.52, -1.68]
const RING_R = 0.27
const BANK = { x: 2.05, yTop: 0.35, yBot: -1.0, z: [-1.3, -1.6, -1.9] }
const ROTOR_COLORS: Record<Phase, string> = { a: '#eb9a8f', b: '#eed98a', c: '#97b6ea', m: '#eb9a8f', x: '#97b6ea' }
const PH: Phase[] = ['a', 'b', 'c']
const fmtW = (x: number | null | undefined) => (x == null ? '—' : x >= 1000 ? `${(x / 1000).toFixed(2)} kW` : `${Math.round(x)} W`)

function rotorRatio(step: string | null, s: number | null) {
  if (step === 'induced' || step === 'rings' || step === 'starting') return 0
  return s == null ? 0 : 1 - s
}

function helix(x: number, z: number, y0: number, y1: number, r = 0.075, turns = 9): Vec3[] {
  const n = turns * 12
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const a = t * turns * 2 * Math.PI
    return [x + r * Math.cos(a), y1 + (y0 - y1) * t, z + r * Math.sin(a)] as Vec3
  })
}

export function WoundRotorModel({ state }: { state: ModelState }) {
  const P = state.params.poles ?? 4
  const pp = P / 2
  const stator = useMemo(() => windingLayout(36, P, BELTS_3PH)!, [P])
  const rotor = useMemo(() => windingLayout(24, P, BELTS_3PH)!, [P])
  const rotorSlot = useMemo(() => ({ rSlot: 0.47, slotR: 0.06, offset: rotor.offset }), [rotor.offset])
  const L = state.layers
  const step = state.step
  const s = state.calc.s ?? null
  const ratio = rotorRatio(step, s)
  const atRest = ratio === 0
  const rext = state.params.rext ?? 0
  const r2 = IM_EXAMPLE.r2 + rext
  const phi2 = atRest ? Math.atan2(2 * Math.PI * state.params.f * IM_EXAMPLE.l2, r2) : ((state.calc.phi2 ?? 0) * Math.PI) / 180
  const c = state.calc
  const barY = BANK.yTop - 0.06 - (Math.min(rext, WR_RMAX) / WR_RMAX) * (BANK.yTop - BANK.yBot - 0.12)

  const geo = useMemo(() => {
    const leads = PH.map((_, k) => {
      const a = (k * 2 * Math.PI) / 3 + 0.4
      const u = (r: number, z: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), z]
      return [tube([u(0.42, -0.86), u(0.3, -0.9), u(0.15, -0.95), u(0.123, -0.98)], 0.018, 12, 6), tube([u(0.123, RING_Z[k] + 0.12), u(0.18, RING_Z[k] + 0.08), u(0.23, RING_Z[k])], 0.018, 8, 6)]
    }).flat()
    const coils = BANK.z.map((z) => tube(helix(BANK.x, z, BANK.yBot, BANK.yTop), 0.018, 108, 6))
    const cables = BANK.z.map((z, k) => tube([[0, 0.62, RING_Z[k]], [0.6, 0.95, RING_Z[k]], [1.5, 0.85, (RING_Z[k] + z) / 2], [BANK.x, BANK.yTop + 0.2, z], [BANK.x, BANK.yTop + 0.05, z]], 0.022, 24, 6))
    const ring = new THREE.CylinderGeometry(RING_R, RING_R, 0.09, 40)
    ring.rotateX(Math.PI / 2)
    return { leads, coils, cables, ring }
  }, [])

  // rotor current out through the rings, brushes and cables to the resistor bank (AC: the path, not a direction)
  const extPaths: Vec3[][] = BANK.z.map((z, k) => [[0, RING_R + 0.02, RING_Z[k]], [0, 0.62, RING_Z[k]], [0.6, 0.95, RING_Z[k]], [1.5, 0.85, (RING_Z[k] + z) / 2], [BANK.x, BANK.yTop + 0.2, z], [BANK.x + 0.1, BANK.yTop, z], [BANK.x + 0.1, barY, z]])

  return (
    <group>
      {/* ── stator (as the cage motor) ── */}
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
      <Part id="stator-core">
        <StatorCore slots={36} offset={stator.offset} />
      </Part>
      <Part id="stator-winding">
        <Winding layout={stator} phaseLift={{ a: 0, b: 0.05, c: 0.1 }} dh={0.12 / Math.max(1, stator.coils[0].q - 1)} />
      </Part>
      <Part id="bearings">
        <Bearings at={[Z.shield, -Z.shield]} />
      </Part>
      <Part id="brushes">
        {RING_Z.map((z) => (
          <group key={z}>
            <mesh position={[0, RING_R + 0.075, z]}>
              <boxGeometry args={[0.09, 0.15, 0.07]} />
              <meshStandardMaterial color="#2a2d33" roughness={0.9} />
            </mesh>
            <mesh position={[0, RING_R + 0.2, z]}>
              <boxGeometry args={[0.14, 0.12, 0.1]} />
              <meshStandardMaterial color="#a8823a" metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, RING_R + 0.29, -1.45]}>
          <boxGeometry args={[0.07, 0.05, 0.62]} />
          <meshStandardMaterial color="#59626f" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[0, RING_R + 0.17, -1.17]}>
          <boxGeometry args={[0.07, 0.29, 0.06]} />
          <meshStandardMaterial color="#59626f" metalness={0.5} roughness={0.5} />
        </mesh>
      </Part>
      <Part id="resistors">
        {/* base and top insulating plates, three helical resistor elements, the shorting (star) bar and the cables */}
        <mesh position={[BANK.x, BANK.yBot - 0.08, -1.6]}>
          <boxGeometry args={[0.42, 0.08, 0.95]} />
          <meshStandardMaterial color="#3b4048" roughness={0.8} />
        </mesh>
        <mesh position={[BANK.x, BANK.yTop + 0.07, -1.6]}>
          <boxGeometry args={[0.42, 0.06, 0.95]} />
          <meshStandardMaterial color="#c9b98f" roughness={0.8} />
        </mesh>
        {[-1.12, -2.08].map((z) => (
          <mesh key={z} position={[BANK.x, (BANK.yTop + BANK.yBot) / 2, z]}>
            <boxGeometry args={[0.36, BANK.yTop - BANK.yBot + 0.1, 0.04]} />
            <meshStandardMaterial color="#59626f" metalness={0.4} roughness={0.6} />
          </mesh>
        ))}
        {geo.coils.map((g, k) => (
          <mesh key={k} geometry={g}>
            <meshStandardMaterial color="#8a6d4a" metalness={0.6} roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[BANK.x + 0.1, barY, -1.6]}>
          <boxGeometry args={[0.06, 0.06, 0.8]} />
          <meshStandardMaterial color="#d0a24a" metalness={0.8} roughness={0.3} />
        </mesh>
        {geo.cables.map((g, k) => (
          <mesh key={`c${k}`} geometry={g}>
            <meshStandardMaterial color={ROTOR_COLORS[PH[k]]} roughness={0.7} />
          </mesh>
        ))}
      </Part>

      {/* ── rotor ── */}
      <Turn ratio={ratio}>
        <Part id="shaft">
          <Shaft zBack={Z.shaftBack} zFront={Z.shaftFront} />
        </Part>
        <Part id="rotor-core">
          <RotorCore n={24} skew={0} slot={rotorSlot} />
        </Part>
        <Part id="rotor-winding">
          <Winding layout={rotor} r0={0.47} phaseLift={{ a: 0, b: 0.03, c: 0.06 }} h0={0.05} dh={0.06 / Math.max(1, rotor.coils[0].q - 1)} slotH={0.09} slotW={0.07} tubeR={0.022} bulge={0.03} colors={ROTOR_COLORS} />
          {geo.leads.map((g, k) => (
            <mesh key={k} geometry={g}>
              <meshStandardMaterial color={ROTOR_COLORS[PH[Math.floor(k / 2)]]} roughness={0.6} />
            </mesh>
          ))}
        </Part>
        <Part id="slip-rings">
          <mesh position={[0, 0, -1.52]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.21, 0.21, 0.5, 32]} />
            <meshStandardMaterial color="#1f2329" roughness={0.9} />
          </mesh>
          {RING_Z.map((z) => (
            <mesh key={z} geometry={geo.ring} position={[0, 0, z]}>
              <meshStandardMaterial color="#c79a55" metalness={0.85} roughness={0.25} />
            </mesh>
          ))}
        </Part>
        {L.has('emf') && <BarCurrents angles={rotor.slots.map((x) => x.angle)} pp={pp} rotorRatio={ratio} phi2={phi2} r={0.47} z={DIM.len / 2 + 0.2} />}
      </Turn>

      {/* ── conceptual layers ── */}
      {L.has('current') && (
        <group>
          <SlotCurrents layout={stator} pp={pp} />
          <PhaseScope at={[-1.5, 1.45, 0.9]} phases={['a', 'b', 'c']} pp={pp} title="Stator phase currents (per unit)" />
        </group>
      )}
      {L.has('rotatingField') && (
        <Turn ratio={1}>
          <FieldPattern pp={pp} />
        </Turn>
      )}
      {L.has('emf') && extPaths.map((pts, k) => <FlowLine key={k} points={pts} color={LAYER_COLOR.emf} rate={0.6} width={2} />)}
      {L.has('torque') && (
        <group>
          <Turn ratio={1}>
            <PoleForces pp={pp} phi2={phi2} />
          </Turn>
          <TorqueArrow />
        </group>
      )}
      {L.has('rotation') && <RotationArrows z={1.95} />}
      {L.has('energy') && (
        <EnergyFlow
          main={[[0, 1.45, 0.15], [0, 1.05, 0.75], [0, 0.74, 0.92], [0, 0.56, 0.92], [0, 0.3, 0.92], [0, 0.17, 1.2], [0, 0.17, 2.4]]}
          branches={[
            [[0, 0.74, 0.92], [-0.5, 1.2, 1.0]],
            [[0, 0.3, 0.92], [0.25, 0.25, 0], [0.25, 0.3, -1.4], [0, 0.62, RING_Z[1]], [0.6, 0.95, RING_Z[1]], [1.5, 0.85, -1.55], [BANK.x, BANK.yTop + 0.2, -1.6]],
          ]}
          labels={[
            { at: [0.15, 1.7, 0.2], text: `Pin = ${fmtW(c.pin)}` },
            { at: [-0.6, 1.36, 1.0], text: `stator Cu = ${fmtW(c.pcu1)}` },
            { at: [0.55, 0.42, 1.05], text: `Pag = ${fmtW(c.pag)}` },
            { at: [BANK.x, BANK.yBot - 0.4, -1.6], text: `rotor circuit s·Pag = ${fmtW(c.pcu2)} (resistors ${fmtW(c.pext)})` },
            { at: [0.3, 0.42, 2.45], text: `Pmech = ${fmtW(c.pmech)}` },
          ]}
        />
      )}
    </group>
  )
}
