import { useMemo } from 'react'
import * as THREE from 'three'
import type { ModelState, Vec3 } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { LAYER_COLOR, Marker } from '../../../visualizations/viz.tsx'
import { AcArrow, AcFlow, AcGlow, BOBBIN, BRASS, ellipse, FERRITE, polyShape, rectLoop, ringGeometry, Wire } from '../shared.tsx'

/*
 * Gapped EE ferrite inductor — original procedural geometry (simplified). Core in the xy plane, front +z, depth 1.0.
 * Centre leg |x| ≤ 0.25 with the air gap at |y| ≤ G/2; outer legs at 1.0 ≤ |x| ≤ 1.25 touching at y = 0.
 * Winding: two helical layers on the bobbin round the centre leg. The helix angle DEcreases along the wire, so a
 * positive current (entering at the left pin, start of layer 1) flows +x on the front: flux UP the centre leg.
 */
const G = 0.12 // drawn gap (exaggerated)
const DEPTH = 1.0
const COPPER = '#c98a4a'

/** A rounded-rectangle helix (superellipse) around the y axis. */
class Helix extends THREE.Curve<THREE.Vector3> {
  hx: number
  hz: number
  y0: number
  y1: number
  turns: number
  constructor(hx: number, hz: number, y0: number, y1: number, turns: number) {
    super()
    this.hx = hx
    this.hz = hz
    this.y0 = y0
    this.y1 = y1
    this.turns = turns
  }
  getPoint(u: number, target = new THREE.Vector3()) {
    const a = Math.PI / 2 - u * this.turns * 2 * Math.PI
    const c = Math.cos(a)
    const s = Math.sin(a)
    const e = 2 / 6 // superellipse exponent: a rounded rectangle
    return target.set(this.hx * Math.sign(c) * Math.abs(c) ** e, this.y0 + (this.y1 - this.y0) * u, this.hz * Math.sign(s) * Math.abs(s) ** e)
  }
}

function eHalf(top: boolean) {
  // the lower E (legs up); the upper one is mirrored in y
  const pts: Array<[number, number]> = [
    [-1.25, -1.2],
    [1.25, -1.2],
    [1.25, 0],
    [1.0, 0],
    [1.0, -0.9],
    [0.25, -0.9],
    [0.25, -G / 2],
    [-0.25, -G / 2],
    [-0.25, -0.9],
    [-1.0, -0.9],
    [-1.0, 0],
    [-1.25, 0],
  ]
  const shape = polyShape(top ? pts.map(([x, y]) => [x, -y] as [number, number]).reverse() : pts)
  const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1, curveSegments: 4 })
  g.translate(0, 0, -DEPTH / 2)
  return g
}

export function InductorModel({ state }: { state: ModelState }) {
  const geo = useMemo(() => {
    const l1 = new Helix(0.4, 0.65, -0.72, 0.72, 12)
    const l2 = new Helix(0.52, 0.77, 0.66, -0.66, 11)
    const clip = ringGeometry(1.27, 1.22, 1.31, 1.26, 0.24, 0.05)
    clip.rotateX(Math.PI / 2)
    clip.translate(0, 0, -0.12)
    return {
      top: eHalf(true),
      bottom: eHalf(false),
      l1: new THREE.TubeGeometry(l1, 12 * 40, 0.052, 6, false),
      l2: new THREE.TubeGeometry(l2, 11 * 40, 0.052, 6, false),
      tube: ringGeometry(0.28, 0.53, 0.32, 0.57, 1.76, 0.05),
      flange: ringGeometry(0.32, 0.57, 0.95, 1.18, 0.04, 0.08),
      tape: ringGeometry(0.6, 0.85, 0.63, 0.88, 1.5, 0.12),
      clip,
    }
  }, [])
  const L = state.layers
  const sat = state.calc.isat !== null && state.calc.isat !== undefined && (state.params.i ?? 0) > (state.calc.isat as number)
  const gapShare = state.calc.gap ?? null
  // lead ends: layer 1 starts at the front centre (x 0, z 0.65), layer 2 ends at the front centre (z 0.77)
  const leadIn: Vec3[] = [[-0.55, -1.42, 1.1], [-0.55, -0.9, 1.1], [-0.2, -0.82, 0.8], [0, -0.72, 0.65]]
  const leadOut: Vec3[] = [[0, -0.66, 0.77], [0.25, -0.8, 0.95], [0.55, -0.9, 1.1], [0.55, -1.42, 1.1]]

  return (
    <group>
      <Part id="clip">
        <mesh geometry={geo.clip}>
          <meshStandardMaterial color="#b8c0ca" metalness={0.85} roughness={0.3} />
        </mesh>
      </Part>
      <Part id="core-top">
        <mesh geometry={geo.top}>
          <meshStandardMaterial color={FERRITE} metalness={0.15} roughness={0.75} />
        </mesh>
      </Part>
      <Part id="core-bottom">
        <mesh geometry={geo.bottom}>
          <meshStandardMaterial color={FERRITE} metalness={0.15} roughness={0.75} />
        </mesh>
      </Part>
      <Part id="air-gap">
        <mesh>
          <boxGeometry args={[0.5, G, DEPTH]} />
          <meshStandardMaterial color="#9fd0ff" transparent opacity={0.28} depthWrite={false} roughness={0.2} />
        </mesh>
      </Part>
      <Part id="bobbin">
        <mesh geometry={geo.tube} position={[0, -0.88, 0]}>
          <meshStandardMaterial color={BOBBIN} roughness={0.7} />
        </mesh>
        {[-0.88, 0.84].map((y) => (
          <mesh key={y} geometry={geo.flange} position={[0, y, 0]}>
            <meshStandardMaterial color={BOBBIN} roughness={0.7} />
          </mesh>
        ))}
        {/* pin rail */}
        <mesh position={[0, -0.9, 1.1]}>
          <boxGeometry args={[1.5, 0.08, 0.16]} />
          <meshStandardMaterial color={BOBBIN} roughness={0.7} />
        </mesh>
      </Part>
      <Part id="winding">
        <mesh geometry={geo.l1}>
          <meshStandardMaterial color={COPPER} metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh geometry={geo.l2}>
          <meshStandardMaterial color={COPPER} metalness={0.7} roughness={0.35} />
        </mesh>
      </Part>
      <Part id="leads">
        <Wire points={leadIn} radius={0.03} color={COPPER} />
        <Wire points={leadOut} radius={0.03} color={COPPER} />
        {[-0.55, 0.55].map((x) => (
          <mesh key={x} position={[x, -1.3, 1.1]}>
            <cylinderGeometry args={[0.035, 0.035, 0.3, 10]} />
            <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
          </mesh>
        ))}
      </Part>
      <Part id="tape">
        <mesh geometry={geo.tape} position={[0, -0.75, 0]}>
          <meshStandardMaterial color="#d9b938" roughness={0.6} transparent opacity={0.92} />
        </mesh>
      </Part>

      {/* ── conceptual layers ── */}
      {L.has('flux') && (
        <group>
          <AcFlow points={rectLoop(0.1, -1.05, 1.125, 1.05, 0.56)} color={LAYER_COLOR.field} xray width={2.5} />
          <AcFlow points={rectLoop(-0.1, -1.05, -1.125, 1.05, 0.56)} color={LAYER_COLOR.field} xray width={2.5} />
          <AcArrow at={[0, 0.42, 0.56]} dir={[0, 1, 0]} length={0.5} color={LAYER_COLOR.field} xray />
          <AcArrow at={[0, -0.42, 0.56]} dir={[0, 1, 0]} length={0.5} color={LAYER_COLOR.field} xray />
          <AcArrow at={[-1.125, 0, 0.56]} dir={[0, -1, 0]} length={0.45} color={LAYER_COLOR.field} amp={0.75} />
          <AcArrow at={[1.125, 0, 0.56]} dir={[0, -1, 0]} length={0.45} color={LAYER_COLOR.field} amp={0.75} />
          {/* fringing at the gap: bulging out of the gap edges, same sense as the gap flux */}
          <AcFlow points={ellipse(0.25, 0, 0.14, 0.14, 0.3, -Math.PI / 2, Math.PI, 16)} color="#a9cdf7" width={1.6} xray dash={0.05} gap={0.04} />
          <AcFlow points={ellipse(-0.25, 0, 0.14, 0.14, 0.3, -Math.PI / 2, -Math.PI, 16)} color="#a9cdf7" width={1.6} xray dash={0.05} gap={0.04} />
          <Marker at={[0.62, 0.0, 0.62]} text="fringing" tone="field" />
          {sat && <Marker at={[0, 1.42, 0.5]} text="I > Isat: the core saturates — L collapses" tone="torque" />}
        </group>
      )}
      {L.has('current') && (
        <group>
          <AcFlow points={leadIn} color={LAYER_COLOR.current} />
          <AcFlow points={leadOut} color={LAYER_COLOR.current} />
          <AcArrow at={[0, 0.2, 0.92]} dir={[1, 0, 0]} length={0.5} color={LAYER_COLOR.current} />
          <AcArrow at={[-0.55, -1.62, 1.1]} dir={[0, 1, 0]} length={0.26} radius={0.02} color={LAYER_COLOR.current} min={0.4} />
          <Marker at={[-0.8, -1.62, 1.1]} text="i" tone="current" />
          <Marker at={[0.42, 0.36, 0.95]} text="N·i" tone="current" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <AcGlow color={LAYER_COLOR.energy} max={0.85} xray>
            <boxGeometry args={[0.56, G + 0.02, DEPTH + 0.04]} />
          </AcGlow>
          <group position={[0, 0.5, 0]}>
            <AcGlow color={LAYER_COLOR.energy} max={0.12}>
              <boxGeometry args={[0.52, 0.76, DEPTH + 0.02]} />
            </AcGlow>
          </group>
          <Marker at={[-2.0, 0.04, 0.62]} text={gapShare !== null ? `W = ½·L·i² — ${(gapShare * 100).toFixed(0)} % in the gap` : 'W = ½·L·i²'} tone="energy" />
        </group>
      )}
    </group>
  )
}
