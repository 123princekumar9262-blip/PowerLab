import { useEffect, useMemo } from 'react'
import { useViewer } from '../../../viewer/context.tsx'
import { SRM64_AXIS, srm64Offset, srm64Phase, type Phase } from '../../../calculations/modern.ts'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { Arrow, arc, CurvedArrow, FlowLine, LAYER_COLOR, Marker, Spin } from '../../../visualizations/viz.tsx'
import { Bearing, Chip, deg, EndCap, extrude, GlowLoop, Housing, LamLines, MAT, PHASE_COLOR, polar, rotorTeethShape, Shaft, statorShape, ToothCoil, toothCoilGeometry, useDiscrete } from '../shared.tsx'

/*
 * 6/4 SRM — original procedural geometry (simplified). Stator poles at k·60° (A, B, C, A, B, C), rotor poles at
 * θ + k·90° (θ = rotor angle, at 0 a rotor pole faces the A pole at 0°). The rotor turns clockwise (θ decreasing);
 * the energised phase is the one whose poles the rotor is approaching (tested rule srm64Phase).
 */
const STACK = 1.1
const PH: Phase[] = ['A', 'B', 'C', 'A', 'B', 'C']
const R_BORE = 0.52
const Z = STACK / 2 + 0.08 // front face of the stack (markers, flux path)
const toDeg = (a: number) => (a * 180) / Math.PI
const NEXT: Record<Phase, Phase> = { A: 'B', B: 'C', C: 'A' }

export function SrmModel({ state }: { state: ModelState }) {
  const geo = useMemo(
    () => ({
      stator: extrude(statorShape({ rOut: 1.05, rYoke: 0.84, rBore: R_BORE, n: 6, w: 0.28 }), STACK, 16),
      rotor: extrude(rotorTeethShape({ rRoot: 0.32, rTip: 0.505, n: 4, tipHalf: deg(16), rootHalf: deg(19), rHole: 0.12 }), STACK, 16),
      vane: extrude(rotorTeethShape({ rRoot: 0.22, rTip: 0.42, n: 4, tipHalf: deg(22.5), rHole: 0.12 }), 0.02, 12),
      coil: toothCoilGeometry(0.3, STACK + 0.04, 0.09, 0.56, 0.82),
    }),
    [],
  )
  const L = state.layers
  const v = useViewer()
  // the "pull" step describes phase A pulling a rotor pole that is 20° away: show exactly that position
  useEffect(() => {
    if (state.step === 'pull') {
      v.anim.current.angle = deg(20)
      v.invalidate()
    }
  }, [state.step]) // eslint-disable-line react-hooks/exhaustive-deps
  const phase = useDiscrete((a) => srm64Phase(toDeg(a)))
  const theta = useDiscrete((a) => Math.round(toDeg(a))) // the drawn rotor angle to 1° (flux path, arrows)
  const alpha = SRM64_AXIS[phase]
  const d = srm64Offset(theta, alpha) // where the nearest rotor pole is, relative to the energised pole

  const coilsOf = (ph: Phase) =>
    PH.map((p, k) =>
      p !== ph ? null : (
        <group key={k}>
          <ToothCoil geometry={geo.coil} angle={deg(k * 60)} band={{ color: PHASE_COLOR[ph], pos: [0.7, 0, (STACK + 0.04) / 2 + 0.092], size: [0.18, 0.3, 0.012] }} />
          {L.has('current') && ph === phase && <GlowLoop geometry={geo.coil} angle={deg(k * 60)} color={LAYER_COLOR.current} />}
        </group>
      ),
    )

  // flux path of the energised phase: stator pole α → gap → rotor pole (α + d) → rotor → opposite poles → yoke back
  const fluxPaths = useMemo(() => {
    const a = deg(alpha)
    const r = deg(alpha + d)
    const main: Vec3[] = [polar(0.9, a, Z), polar(R_BORE + 0.01, a, Z), polar(0.47, r, Z), polar(0.25, r, Z), [0, 0, Z], polar(0.25, r + Math.PI, Z), polar(0.47, r + Math.PI, Z), polar(R_BORE + 0.01, a + Math.PI, Z), polar(0.9, a + Math.PI, Z)]
    const back1 = arc(0.94, a + Math.PI, a + 2 * Math.PI, Z, 24)
    const back2 = arc(0.94, a + Math.PI, a, Z, 24)
    return { main, back1, back2 }
  }, [alpha, d])

  return (
    <group>
      <Part id="housing">
        <Housing rIn={1.05} rOut={1.15} len={1.6} fins={0} color={MAT.darkSteel} />
      </Part>
      <Part id="end-cap-front">
        <EndCap r={1.15} z={0.9} dir={1} />
      </Part>
      <Part id="end-cap-rear">
        <EndCap r={1.15} z={-0.9} dir={-1} />
      </Part>
      <Part id="stator-core">
        <mesh geometry={geo.stator}>
          <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
        </mesh>
        <LamLines r={1.05} len={STACK} n={13} />
      </Part>
      <Part id="phase-a">{coilsOf('A')}</Part>
      <Part id="phase-b">{coilsOf('B')}</Part>
      <Part id="phase-c">{coilsOf('C')}</Part>
      <Part id="position-sensor">
        {[200, 230, 260].map((a) => (
          <group key={a} rotation={[0, 0, deg(a)]}>
            <mesh position={[0.43, 0, -0.71]}>
              <boxGeometry args={[0.12, 0.08, 0.03]} />
              <meshStandardMaterial color={MAT.chip} roughness={0.6} />
            </mesh>
            <mesh position={[0.43, 0, -0.77]}>
              <boxGeometry args={[0.12, 0.08, 0.03]} />
              <meshStandardMaterial color={MAT.chip} roughness={0.6} />
            </mesh>
            <mesh position={[0.5, 0, -0.74]}>
              <boxGeometry args={[0.03, 0.08, 0.09]} />
              <meshStandardMaterial color={MAT.chip} roughness={0.6} />
            </mesh>
          </group>
        ))}
        <mesh position={polar(0.53, deg(230), -0.74)} rotation={[0, 0, deg(230)]}>
          <boxGeometry args={[0.04, 0.5, 0.06]} />
          <meshStandardMaterial color={MAT.pcb} roughness={0.7} />
        </mesh>
      </Part>
      <Part id="bearing-front">
        <Bearing z={0.86} />
      </Part>
      <Part id="bearing-rear">
        <Bearing z={-0.86} />
      </Part>

      {/* ── rotor: clockwise seen from the front ── */}
      <Spin axis="z">
        <Part id="shaft">
          <Shaft r={0.12} z0={-1.05} z1={1.75} keyAt={1.5} />
          {/* the sensor's slotted vane disc turns with the shaft (4 vanes, one per rotor pole) */}
          <mesh geometry={geo.vane} position={[0, 0, -0.74]}>
            <meshStandardMaterial color="#c9a227" metalness={0.7} roughness={0.35} />
          </mesh>
        </Part>
        <Part id="rotor">
          <mesh geometry={geo.rotor}>
            <meshStandardMaterial color={MAT.steel} metalness={0.7} roughness={0.38} />
          </mesh>
        </Part>
      </Spin>

      {/* ── conceptual layers ── */}
      {L.has('flux') && (
        <group>
          <FlowLine points={fluxPaths.main} color={LAYER_COLOR.field} rate={1} />
          <FlowLine points={fluxPaths.back1} color={LAYER_COLOR.field} rate={1} width={2} />
          <FlowLine points={fluxPaths.back2} color={LAYER_COLOR.field} rate={1} width={2} />
          <Marker at={polar(0.68, deg(alpha), Z + 0.05)} text="N" tone="north" />
          <Marker at={polar(0.68, deg(alpha + 180), Z + 0.05)} text="S" tone="south" />
        </group>
      )}
      {L.has('current') && (
        <Chip at={[1.45, -1.25, 0.6]}>
          <span className="mxm-on">Phase {phase} on</span>{' '}
          <span className="mxm-dim">
            · {(['A', 'B', 'C'] as Phase[]).filter((p) => p !== phase).join(' and ')} off
          </span>
          <br />
          <span className="mxm-dim">
            rotor pole {Math.abs(d).toFixed(0)}° from alignment · next: {NEXT[phase]}
          </span>
        </Chip>
      )}
      {L.has('torque') && (
        <group>
          {[0, 180].map((o) => {
            const r = deg(alpha + d + o)
            return <Arrow key={o} from={polar(0.43, r, Z)} dir={[Math.sin(r), -Math.cos(r), 0]} length={0.3} color={LAYER_COLOR.torque} />
          })}
          <CurvedArrow radius={1.25} start={deg(150)} sweep={deg(-80)} z={0.95} color={LAYER_COLOR.torque} />
          <Marker at={polar(1.42, deg(160), 0.95)} text="T = ½·i²·dL/dθ" tone="torque" />
        </group>
      )}
      {L.has('rotation') && <CurvedArrow radius={0.32} start={deg(120)} sweep={deg(-250)} z={1.85} color={LAYER_COLOR.rotation} tube={0.022} />}
    </group>
  )
}
