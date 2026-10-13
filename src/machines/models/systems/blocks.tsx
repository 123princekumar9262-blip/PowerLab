import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../types.ts'

/*
 * Simplified blocks for the electromechanical system assemblies — original procedural geometry. Each block is drawn
 * around its own origin; rotating parts are drawn about their own axis so a <Spin> can turn them.
 * These are blocks (recognisable shapes and the connections between them), not detailed machines: the individual
 * machines have their own detailed models in the catalogue.
 */

export const C = {
  steel: '#9aa4b2',
  darkSteel: '#5d6878',
  alu: '#b7c0cc',
  castAlu: '#8e98a6',
  copper: '#c27a3c',
  rubber: '#1f2328',
  battery: '#2f5d8a',
  batteryLid: '#3a6ea0',
  inverter: '#5a6577',
  motor: '#4f6a86',
  gear: '#a9b2bf',
  engine: '#5b6b4f',
  alternator: '#4f6072',
  red: '#c0392b',
  black: '#25282d',
  phase: ['#d0533f', '#e0b43a', '#4f86d9'],
  pcb: '#2e7d4f',
}

export function Box({ size, at = [0, 0, 0], color, metal = 0.3, rough = 0.6 }: { size: Vec3; at?: Vec3; color: string; metal?: number; rough?: number }) {
  return (
    <mesh position={at}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={metal} roughness={rough} />
    </mesh>
  )
}

/** A cylinder along x or z (three's cylinder is along y). */
export function Cyl({ r, len, at = [0, 0, 0], axis = 'x', color, metal = 0.5, rough = 0.45, seg = 32, r2 }: { r: number; len: number; at?: Vec3; axis?: 'x' | 'y' | 'z'; color: string; metal?: number; rough?: number; seg?: number; r2?: number }) {
  const rot: Vec3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]
  return (
    <mesh position={at} rotation={rot}>
      <cylinderGeometry args={[r2 ?? r, r, len, seg]} />
      <meshStandardMaterial color={color} metalness={metal} roughness={rough} />
    </mesh>
  )
}

/** Battery pack: a case with module lids, two terminals (+ red, − black) on the face at +x. */
export function BatteryPack({ size = [1.4, 0.55, 1.0] as Vec3, modules = [3, 2] as [number, number] }: { size?: Vec3; modules?: [number, number] }) {
  const [w, h, d] = size
  return (
    <group>
      <Box size={size} color={C.battery} metal={0.35} rough={0.5} />
      {Array.from({ length: modules[0] * modules[1] }, (_, i) => {
        const ix = i % modules[0]
        const iz = Math.floor(i / modules[0])
        const mw = (w - 0.12) / modules[0]
        const md = (d - 0.12) / modules[1]
        return <Box key={i} size={[mw - 0.05, 0.04, md - 0.05]} at={[-w / 2 + 0.06 + mw * (ix + 0.5), h / 2 + 0.02, -d / 2 + 0.06 + md * (iz + 0.5)]} color={C.batteryLid} metal={0.3} rough={0.5} />
      })}
      <Cyl r={0.05} len={0.12} axis="x" at={[w / 2 + 0.05, h * 0.18, d * 0.22]} color={C.red} />
      <Cyl r={0.05} len={0.12} axis="x" at={[w / 2 + 0.05, h * 0.18, -d * 0.22]} color={C.black} />
    </group>
  )
}

/** Inverter enclosure: a box with heat-sink fins on top (the outer casing). */
export function InverterCase({ size = [1.2, 0.5, 0.9] as Vec3, fins = 9 }: { size?: Vec3; fins?: number }) {
  const [w, h, d] = size
  return (
    <group>
      {/* thin walls so the internals can be shown by hiding the case */}
      <Box size={[w, 0.04, d]} at={[0, -h / 2, 0]} color={C.inverter} />
      <Box size={[w, 0.04, d]} at={[0, h / 2, 0]} color={C.inverter} />
      <Box size={[0.04, h, d]} at={[-w / 2, 0, 0]} color={C.inverter} />
      <Box size={[0.04, h, d]} at={[w / 2, 0, 0]} color={C.inverter} />
      <Box size={[w, h, 0.04]} at={[0, 0, -d / 2]} color={C.inverter} />
      <Box size={[w, h, 0.04]} at={[0, 0, d / 2]} color={C.inverter} />
      {Array.from({ length: fins }, (_, i) => (
        <Box key={i} size={[0.025, 0.14, d * 0.92]} at={[-w / 2 + 0.08 + ((w - 0.16) * i) / (fins - 1), h / 2 + 0.09, 0]} color={C.alu} metal={0.6} rough={0.35} />
      ))}
    </group>
  )
}

/** The six switches of a three-phase bridge (three legs), with DC busbars, inside the inverter. */
export function SwitchModules({ w = 1.0 }: { w?: number }) {
  return (
    <group>
      {[0, 1, 2].map((k) => {
        const x = -w / 3 + (k * w) / 3
        return (
          <group key={k}>
            <Box size={[0.22, 0.08, 0.18]} at={[x, -0.12, 0.13]} color="#30343b" />
            <Box size={[0.22, 0.08, 0.18]} at={[x, -0.12, -0.13]} color="#30343b" />
            <Box size={[0.05, 0.03, 0.08]} at={[x, -0.065, 0.13]} color={C.copper} metal={0.7} rough={0.3} />
            <Box size={[0.05, 0.03, 0.08]} at={[x, -0.065, -0.13]} color={C.copper} metal={0.7} rough={0.3} />
          </group>
        )
      })}
      {/* DC busbars + / − */}
      <Box size={[w * 0.95, 0.025, 0.05]} at={[0, -0.05, 0.28]} color={C.red} metal={0.5} rough={0.4} />
      <Box size={[w * 0.95, 0.025, 0.05]} at={[0, -0.05, -0.28]} color={C.black} metal={0.5} rough={0.4} />
    </group>
  )
}

export function DcLinkCaps({ n = 3, spacing = 0.18 }: { n?: number; spacing?: number }) {
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[(i - (n - 1) / 2) * spacing, 0, 0]}>
          <Cyl r={0.07} len={0.24} axis="y" color="#2a3a66" metal={0.2} rough={0.6} />
          <Cyl r={0.071} len={0.02} axis="y" at={[0, 0.12, 0]} color={C.alu} metal={0.7} rough={0.3} />
        </group>
      ))}
    </group>
  )
}

export function ControlBoard({ size = [0.6, 0.02, 0.4] as Vec3 }: { size?: Vec3 }) {
  return (
    <group>
      <Box size={size} color={C.pcb} metal={0.1} rough={0.7} />
      {[[-0.15, 0.1], [0.05, -0.08], [0.18, 0.08], [-0.05, 0.0]].map(([x, z], i) => (
        <Box key={i} size={[0.09, 0.03, 0.09]} at={[x * (size[0] / 0.6), 0.025, z * (size[2] / 0.4)]} color="#15181c" />
      ))}
    </group>
  )
}

/** A finned motor housing along x (shaft out at +x), with feet and a terminal box. Drawn as a block. */
export function MotorBlock({ r = 0.5, len = 1.3, feet = true, terminal = true, color = C.motor }: { r?: number; len?: number; feet?: boolean; terminal?: boolean; color?: string }) {
  return (
    <group>
      <Cyl r={r} len={len} axis="x" color={color} metal={0.5} rough={0.45} seg={40} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 12 + 0.26
        if (feet && Math.sin(a) < -0.7) return null
        return (
          <mesh key={i} position={[0, (r + 0.03) * Math.sin(a), (r + 0.03) * Math.cos(a)]} rotation={[Math.PI / 2 - a, 0, 0]}>
            <boxGeometry args={[len * 0.92, 0.07, 0.035]} />
            <meshStandardMaterial color={color} metalness={0.5} roughness={0.45} />
          </mesh>
        )
      })}
      {/* end shields */}
      <Cyl r={r * 1.02} len={0.08} axis="x" at={[len / 2 + 0.04, 0, 0]} color={C.darkSteel} />
      <Cyl r={r * 1.02} len={0.08} axis="x" at={[-len / 2 - 0.04, 0, 0]} color={C.darkSteel} />
      <Cyl r={r * 0.3} len={0.1} axis="x" at={[len / 2 + 0.12, 0, 0]} color={C.steel} />
      {feet && (
        <group>
          <Box size={[len * 0.7, r * 0.5, 0.18]} at={[0, -r * 0.88, r * 0.62]} color={color} />
          <Box size={[len * 0.7, r * 0.5, 0.18]} at={[0, -r * 0.88, -r * 0.62]} color={color} />
        </group>
      )}
      {terminal && <Box size={[0.36, 0.2, 0.34]} at={[-len * 0.1, r + 0.12, 0]} color={color} />}
    </group>
  )
}

/** A rotating disc about x (flywheel, coupling hub) with marks so the rotation is visible. */
export function Disc({ r, t, color, holes = 6, holeR = 0.05 }: { r: number; t: number; color: string; holes?: number; holeR?: number }) {
  return (
    <group>
      <Cyl r={r} len={t} axis="x" color={color} metal={0.7} rough={0.35} seg={48} />
      {Array.from({ length: holes }, (_, i) => {
        const a = (i * 2 * Math.PI) / holes
        return <Cyl key={i} r={holeR} len={t + 0.01} axis="x" at={[0, r * 0.6 * Math.sin(a), r * 0.6 * Math.cos(a)]} color="#1a1e24" metal={0.2} rough={0.8} seg={12} />
      })}
    </group>
  )
}

/** Gear wheel: extruded tooth profile in the xy plane (axis z), centred on z = 0. */
export function useGearGeometry(r: number, teeth: number, width: number) {
  return useMemo(() => {
    const s = new THREE.Shape()
    const ro = r
    const ri = r - Math.min(0.05, r * 0.18)
    for (let i = 0; i < teeth; i++) {
      const a0 = (i * 2 * Math.PI) / teeth
      const da = (2 * Math.PI) / teeth
      const pts: Array<[number, number]> = [
        [ri, a0],
        [ro, a0 + da * 0.15],
        [ro, a0 + da * 0.45],
        [ri, a0 + da * 0.6],
      ]
      pts.forEach(([rr, a], k) => (i === 0 && k === 0 ? s.moveTo(rr * Math.cos(a), rr * Math.sin(a)) : s.lineTo(rr * Math.cos(a), rr * Math.sin(a))))
    }
    s.closePath()
    const hole = new THREE.Path()
    hole.absarc(0, 0, Math.min(0.05, r * 0.4), 0, Math.PI * 2, true)
    s.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 8 })
    g.translate(0, 0, -width / 2)
    return g
  }, [r, teeth, width])
}
export function Gear({ r, teeth, width, color = C.gear }: { r: number; teeth: number; width: number; color?: string }) {
  const g = useGearGeometry(r, teeth, width)
  return (
    <mesh geometry={g}>
      <meshStandardMaterial color={color} metalness={0.75} roughness={0.3} />
    </mesh>
  )
}

/** A wheel (tyre + rim + spokes) about the z axis. */
export function Wheel({ r = 0.33, width = 0.22 }: { r?: number; width?: number }) {
  const tube = width / 2
  return (
    <group>
      <mesh>
        <torusGeometry args={[r - tube, tube, 16, 48]} />
        <meshStandardMaterial color={C.rubber} roughness={0.9} />
      </mesh>
      <Cyl r={r - tube * 1.4} len={width * 0.8} axis="z" color={C.alu} metal={0.7} rough={0.3} seg={40} />
      <Cyl r={r * 0.18} len={width * 0.9} axis="z" color={C.darkSteel} />
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 5
        return (
          <mesh key={i} position={[(r * 0.4) * Math.cos(a), (r * 0.4) * Math.sin(a), width * 0.42]} rotation={[0, 0, a]}>
            <boxGeometry args={[r * 0.4, 0.05, 0.03]} />
            <meshStandardMaterial color="#d6dce4" metalness={0.8} roughness={0.25} />
          </mesh>
        )
      })}
    </group>
  )
}
