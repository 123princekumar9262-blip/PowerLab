/*
 * Winding layouts for the induction machine models (pure data, no 3D code; tested in
 * tests/machines-induction.test.ts).
 *
 * A distributed single-layer winding: around the air gap, in ELECTRICAL degrees, the slots are divided into phase
 * belts. Three-phase (60° belts): a+ c− b+ a− c+ b−, so the belt of phase b is 120° ahead of a and c 240° ahead.
 * With ia = cos θe, ib = cos(θe − 120°), ic = cos(θe − 240°) the current sheet is K(θ) ∝ cos(p·θ − θe): it turns
 * forward (counter-clockwise seen from the drive end, +z) at θe/p — the field turns a → b → c.
 *
 * Single-phase: main winding m (120° belts) and auxiliary winding x (60° belts) whose axis is 90° electrical from
 * the main one. The auxiliary belt is placed 90° BEHIND the main one, so that an auxiliary current LEADING the
 * main current by 90° (capacitor) makes the field turn forward too: K ∝ cos θe·cos pθ + cos(θe + 90°)·cos(pθ + 90°)
 * = cos(pθ − θe).
 *
 * Coils are concentric: in each pole pair, the slots of a + belt are joined to the slots of the matching − belt,
 * π electrical further on (innermost to innermost).
 */
export type Phase = 'a' | 'b' | 'c' | 'm' | 'x'
export interface Belt {
  phase: Phase
  sign: 1 | -1
  /** Centre and width in electrical radians. */
  centre: number
  width: number
}
const D = Math.PI / 180
export const BELTS_3PH: Belt[] = [
  { phase: 'a', sign: 1, centre: 0, width: 60 * D },
  { phase: 'c', sign: -1, centre: 60 * D, width: 60 * D },
  { phase: 'b', sign: 1, centre: 120 * D, width: 60 * D },
  { phase: 'a', sign: -1, centre: 180 * D, width: 60 * D },
  { phase: 'c', sign: 1, centre: 240 * D, width: 60 * D },
  { phase: 'b', sign: -1, centre: 300 * D, width: 60 * D },
]
export const BELTS_1PH: Belt[] = [
  { phase: 'm', sign: 1, centre: 0, width: 120 * D },
  { phase: 'x', sign: -1, centre: 90 * D, width: 60 * D },
  { phase: 'm', sign: -1, centre: 180 * D, width: 120 * D },
  { phase: 'x', sign: 1, centre: 270 * D, width: 60 * D },
]

export interface SlotInfo {
  /** Mechanical angle of the slot centre [rad]. */
  angle: number
  phase: Phase
  sign: 1 | -1
}
export interface Coil {
  phase: Phase
  /** Mechanical angle of the + side and the (positive) span to the − side [rad]. */
  from: number
  span: number
  /** 0 = innermost coil of its group … q − 1 = outermost. */
  rank: number
  q: number
}
export interface Layout {
  slots: SlotInfo[]
  coils: Coil[]
  /** Slot offset (fraction of a slot pitch) that centres the belts on their axes. */
  offset: number
  poles: number
}

const wrap = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
/** Signed distance a − b wrapped into [−π, π). */
const dist = (a: number, b: number) => wrap(a - b + Math.PI) - Math.PI

/** The layout of `slots` slots wound for `poles` poles with the given belts; null if they do not fit evenly. */
export function windingLayout(slots: number, poles: number, belts: Belt[]): Layout | null {
  const pp = poles / 2
  const de = (pp * 2 * Math.PI) / slots // slot pitch, electrical
  const counts = belts.map((b) => b.width / de)
  if (!Number.isInteger(pp) || counts.some((c) => Math.abs(c - Math.round(c)) > 1e-9 || c < 1)) return null
  const parity = new Set(counts.map((c) => Math.round(c) % 2))
  if (parity.size !== 1) return null
  const offset = parity.has(0) ? 0.5 : 0
  const slotList: SlotInfo[] = []
  const coils: Coil[] = []
  for (let k = 0; k < slots; k++) {
    const angle = ((k + offset) * 2 * Math.PI) / slots
    const e = pp * angle
    const belt = belts.find((b) => {
      const d = dist(e, b.centre)
      return d >= -b.width / 2 - 1e-9 && d < b.width / 2 - 1e-9
    })
    if (!belt) return null
    slotList.push({ angle, phase: belt.phase, sign: belt.sign })
    if (belt.sign === 1) {
      const d = dist(e, belt.centre) // position inside the belt, −w/2 … +w/2
      const q = Math.round(belt.width / de)
      coils.push({ phase: belt.phase, from: angle, span: (Math.PI - 2 * d) / pp, rank: Math.round((belt.width / 2 - d) / de - 0.5), q })
    }
  }
  return { slots: slotList, coils, offset, poles }
}

/** Phase currents (per unit) at the electrical angle θe. Single-phase: the auxiliary current leads by 90° (ideal capacitor). */
export function phaseCurrent(phase: Phase, te: number, auxOn = true): number {
  switch (phase) {
    case 'a':
    case 'm':
      return Math.cos(te)
    case 'b':
      return Math.cos(te - (2 * Math.PI) / 3)
    case 'c':
      return Math.cos(te - (4 * Math.PI) / 3)
    case 'x':
      return auxOn ? Math.cos(te + Math.PI / 2) : 0
  }
}

/**
 * The fundamental of the radial air-gap flux density made by a current sheet K(θ) = Σ slot currents:
 * Ampère's law gives dBr/dθ ∝ −K, so a sheet K ∝ cos(p·θ − φ) makes Br ∝ −sin(p·θ − φ).
 * Returns the electrical angle φ of the sheet's fundamental and its amplitude (per unit).
 */
export function sheetFundamental(layout: Layout, te: number, auxOn = true): { phi: number; amp: number } {
  const pp = layout.poles / 2
  let c = 0
  let s = 0
  for (const sl of layout.slots) {
    const i = sl.sign * phaseCurrent(sl.phase, te, auxOn)
    c += i * Math.cos(pp * sl.angle)
    s += i * Math.sin(pp * sl.angle)
  }
  return { phi: Math.atan2(s, c), amp: Math.hypot(c, s) / layout.slots.length }
}

/**
 * Radial air-gap flux density (per unit) at the mechanical angle θ when the stator current sheet is
 * K ∝ cos(p·θ − θe): Br = −sin(p·θ − θe). Negative = into the rotor (a stator N pole), positive = out of it (S).
 */
export const gapField = (theta: number, te: number, pp: number) => -Math.sin(pp * theta - te)

/**
 * Induced current (per unit, + = out of the drive end ⊙) in a rotor conductor at the stator-frame angle θ while
 * the field runs ahead of the rotor: e = v_rel × B gives i in phase with Br, lagging in time by the rotor
 * power-factor angle φ2: i = −sin(p·θ − θe + φ2).
 */
export const barCurrent = (theta: number, te: number, pp: number, phi2: number) => -Math.sin(pp * theta - te + phi2)

/** Tangential force (per unit, + = counter-clockwise) on that conductor: F = I·L × B → Fθ = i·Br. */
export const barForce = (theta: number, te: number, pp: number, phi2: number) => barCurrent(theta, te, pp, phi2) * gapField(theta, te, pp)
