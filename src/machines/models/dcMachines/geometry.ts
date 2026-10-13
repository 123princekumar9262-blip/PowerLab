import * as THREE from 'three'

/*
 * Wound-field DC machines — 2D profiles extruded into geometry (original, procedural). The armature lamination and
 * the arc-sector helper follow the lead's dcMotor model (copied here because they are not exported there; the
 * dcMotor files are not edited). Coordinates: the shaft is the z axis, the N pole on +x, the S pole on −x.
 */

export type Kind = 'generator' | 'separate' | 'shunt' | 'series' | 'compound'

export const ARM_R = 0.72
export const ARM_LEN = 1.6
export const SLOTS = 8
/** Air-gap side of the pole shoe, pole shoe back, pole core end at the yoke. */
export const SHOE_IN = 0.8
export const SHOE_OUT = 0.92
export const YOKE_IN = 1.4
export const YOKE_OUT = 1.58
export const YOKE_HALF = 0.95
/** Pole core cross-section (half sizes) in y and z. */
export const CORE_HY = 0.22
export const CORE_HZ = 0.66

/** An annular sector extruded along z, centred on z = 0. */
export function arcShell(rIn: number, rOut: number, a0: number, a1: number, len: number) {
  const s = new THREE.Shape()
  s.absarc(0, 0, rOut, a0, a1, false)
  s.absarc(0, 0, rIn, a1, a0, true)
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 20 })
  g.translate(0, 0, -len / 2)
  return g
}

/** The slotted armature lamination profile, extruded (as in the dcMotor model). */
export function armatureGeometry() {
  const r = ARM_R
  const rSlot = 0.48
  const half = (Math.PI / SLOTS) * 0.42
  const s = new THREE.Shape()
  for (let k = 0; k < SLOTS; k++) {
    const c = (k * 2 * Math.PI) / SLOTS
    const a = c - half
    const b = c + half
    if (k === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a))
    else s.lineTo(r * Math.cos(a), r * Math.sin(a))
    s.lineTo(rSlot * Math.cos(a), rSlot * Math.sin(a))
    s.lineTo(rSlot * Math.cos(b), rSlot * Math.sin(b))
    s.lineTo(r * Math.cos(b), r * Math.sin(b))
    s.absarc(0, 0, r, b, ((k + 1) * 2 * Math.PI) / SLOTS - half, false)
  }
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true)
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth: ARM_LEN, bevelEnabled: false, curveSegments: 6 })
  g.translate(0, 0, -ARM_LEN / 2)
  return g
}

/** Points of a rounded rectangle, counter-clockwise (reverse them for a hole). */
function roundedRectPts(hw: number, hh: number, r: number) {
  const pts: THREE.Vector2[] = []
  const corners: Array<[number, number, number]> = [
    [hw - r, -hh + r, -Math.PI / 2],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
  ]
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 5; i++) pts.push(new THREE.Vector2(cx + r * Math.cos(a0 + (i * Math.PI) / 10), cy + r * Math.sin(a0 + (i * Math.PI) / 10)))
  return pts
}

/**
 * A field coil wound round a pole core: a rounded-rectangle ring (in the y–z plane) extruded radially by `depth`.
 * The ring's inner opening clears the pole core by `clear`; `build` is the coil's build (ring width).
 * The geometry extrudes along +x from x = 0 (place it with a position; mirror for the −x pole).
 */
export function coilGeometry(depth: number, build: number, clear = 0.03) {
  const hwIn = CORE_HZ + clear // along z (shape x → world −z after rotation; symmetric)
  const hhIn = CORE_HY + clear // along y
  const s = new THREE.Shape(roundedRectPts(hwIn + build, hhIn + build, Math.min(0.12, build + 0.04)))
  s.holes.push(new THREE.Path(roundedRectPts(hwIn, hhIn, 0.04).reverse()))
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 })
  // local z (extrusion) → world +x ; local x → world −z ; local y → world y
  g.rotateY(Math.PI / 2)
  return g
}

/** The rectangular loop (y–z plane, at x) a field-coil current follows, in the sense that makes flux along −x. */
export function coilLoop(x: number, hy: number, hz: number): Array<[number, number, number]> {
  // normal −x: front edge (+z) runs +y, top (+y) runs −z, rear runs −y, bottom runs +z
  return [
    [x, -hy, hz],
    [x, hy, hz],
    [x, hy, -hz],
    [x, -hy, -hz],
    [x, -hy, hz],
  ]
}
