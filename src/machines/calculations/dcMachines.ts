/**
 * Wound-field DC machines — explicit steady-state relations for each field connection (3D Machines Lab).
 *
 * Common assumptions (stated in every machine's content): steady state (constant speed), LINEAR magnetics (flux
 * proportional to the exciting current — no saturation, no residual flux), armature reaction, brush contact drop,
 * friction, windage and iron loss neglected; the load torque is the only mechanical torque on the shaft.
 *
 * Constants:
 *   kf  [V·s/rad per A]  shunt / separate field: kΦ = kf · If
 *   ks  [V·s/rad per A]  series field:           kΦ = ks · Ia
 * Machine relations: E = kΦ·ω,  T = kΦ·Ia,  motor V = E + Ia·R,  generator V = E − Ia·Ra.
 * A value the inputs cannot support is null, never invented (e.g. the speed of an unloaded series motor).
 */
import { radFromRpm, rpmFromRad } from './formulas.ts'

export type DcMode = 'motoring' | 'generating' | 'stalled' | 'no-field' | 'runaway' | 'no-operating-point'

/** Result shared by the motor connections. Powers in W, speeds in rad/s and rpm. */
export interface DcMotorResult {
  mode: DcMode
  /** Field current (shunt / separate) [A]; for a series motor it equals Ia. */
  iField: number
  /** Armature current [A] (negative = generating). */
  ia: number | null
  /** Line (supply) current [A]: Ia + If for shunt / long-shunt compound, Ia for series. */
  iLine: number | null
  /** Flux constant kΦ at the operating point [V·s/rad]. */
  kphi: number | null
  e: number | null
  w: number | null
  n: number | null
  /** Electrical input at the terminals (all supplies) [W]. */
  pin: number | null
  /** Shaft power T·ω [W] (negative when the shaft drives the machine). */
  pout: number | null
  /** Armature-circuit copper loss Ia²·R (R = Ra, + Rse where a series field carries Ia) [W]. */
  pcuA: number | null
  /** Shunt / separate field loss If²·Rf [W]. */
  pField: number
  eff: number | null
  /** Torque at standstill with full voltage (E = 0) [N·m]. */
  stallTorque: number | null
  /** No-load speed (TL = 0) [rpm]; null when it does not exist (series motor). */
  n0: number | null
  warning?: string
}

const eff = (useful: number, input: number) => (input > 0 ? useful / input : null)

/** Running point of a motor with constant kΦ and armature-circuit resistance r on a voltage v, load tl. */
function constantFluxPoint(v: number, kphi: number, r: number, tl: number) {
  const ia = tl / kphi
  const e = v - ia * r
  const w = e / kphi
  return { ia, e, w }
}

const fieldLost = (iField: number, pField: number): DcMotorResult => ({
  mode: 'no-field', iField, ia: null, iLine: null, kphi: 0, e: null, w: null, n: null, pin: null, pout: null, pcuA: null, pField, eff: null, stallTorque: 0, n0: null,
  warning: 'No field current: no flux, so no torque and no back EMF. A real machine keeps a little residual flux and can race to a dangerous speed — field-loss protection must trip the supply.',
})

// ── Separately excited DC motor (it generates when the shaft is driven: TL < 0) ───────────────────────
/**
 * If = Vf/Rf, kΦ = kf·If, Ia = TL/kΦ, E = Va − Ia·Ra, ω = E/kΦ. TL < 0 means the load drives the shaft: Ia < 0,
 * E > Va and power flows back into the armature supply (generating / regenerative braking).
 */
export function separatelyExcitedMotor(p: { va: number; vf: number; rf: number; kf: number; ra: number; tl: number }): DcMotorResult | null {
  const { va, vf, rf, kf, ra, tl } = p
  if (rf <= 0 || ra <= 0 || kf <= 0 || va < 0 || vf < 0) return null
  const iField = vf / rf
  const pField = vf * iField
  if (iField <= 0) return fieldLost(iField, pField)
  const kphi = kf * iField
  const stallTorque = (kphi * va) / ra
  const n0 = rpmFromRad(va / kphi)
  if (tl > stallTorque) {
    const ia = va / ra
    return { mode: 'stalled', iField, ia, iLine: ia, kphi, e: 0, w: 0, n: 0, pin: va * ia + pField, pout: 0, pcuA: ia * ia * ra, pField, eff: 0, stallTorque, n0, warning: 'The load torque is above the stall torque: the motor cannot turn and draws Va/Ra.' }
  }
  const { ia, e, w } = constantFluxPoint(va, kphi, ra, tl)
  const pa = va * ia
  const pout = tl * w
  const generating = ia < 0
  return {
    mode: generating ? 'generating' : 'motoring',
    iField, ia, iLine: ia, kphi, e, w, n: rpmFromRad(w),
    pin: pa + pField, pout, pcuA: ia * ia * ra, pField,
    // motoring: shaft power / (armature + field input); generating: power returned / (shaft input + field input)
    eff: generating ? eff(-pa, -pout + pField) : eff(pout, pa + pField),
    stallTorque, n0,
    warning: generating ? 'The shaft is driven (TL < 0): E > Va, the armature current reverses and power flows back to the supply — the machine generates.' : undefined,
  }
}

// ── Shunt DC motor ───────────────────────────────────────────────────────────────────────────────────
/** If = V/Rf, kΦ = kf·If (constant), Ia = TL/kΦ, IL = Ia + If, E = V − Ia·Ra, ω = E/kΦ. */
export function shuntMotor(p: { v: number; rf: number; kf: number; ra: number; tl: number }): DcMotorResult | null {
  const { v, rf, kf, ra, tl } = p
  if (rf <= 0 || ra <= 0 || kf <= 0 || v <= 0 || tl < 0) return null
  const iField = v / rf
  const pField = v * iField
  const kphi = kf * iField
  const stallTorque = (kphi * v) / ra
  const n0 = rpmFromRad(v / kphi)
  if (tl > stallTorque) {
    const ia = v / ra
    return { mode: 'stalled', iField, ia, iLine: ia + iField, kphi, e: 0, w: 0, n: 0, pin: v * (ia + iField), pout: 0, pcuA: ia * ia * ra, pField, eff: 0, stallTorque, n0, warning: 'The load torque is above the stall torque: the motor cannot turn.' }
  }
  const { ia, e, w } = constantFluxPoint(v, kphi, ra, tl)
  const iLine = ia + iField
  const pin = v * iLine
  const pout = tl * w
  return { mode: 'motoring', iField, ia, iLine, kphi, e, w, n: rpmFromRad(w), pin, pout, pcuA: ia * ia * ra, pField, eff: eff(pout, pin), stallTorque, n0 }
}

// ── Series DC motor ──────────────────────────────────────────────────────────────────────────────────
/**
 * Unsaturated: kΦ = ks·Ia, so T = ks·Ia² → Ia = √(TL/ks); E = V − Ia·(Ra + Rse); ω = E/(ks·Ia).
 * As TL → 0, Ia → 0 and ω → ∞: there is NO no-load speed — returned as `runaway`, never as a number.
 */
export function seriesMotor(p: { v: number; ks: number; ra: number; rse: number; tl: number }): DcMotorResult | null {
  const { v, ks, ra, rse, tl } = p
  const r = ra + rse
  if (ks <= 0 || r <= 0 || v <= 0 || tl < 0) return null
  const iStall = v / r
  const stallTorque = ks * iStall * iStall
  if (tl <= 0)
    return {
      mode: 'runaway', iField: 0, ia: 0, iLine: 0, kphi: 0, e: null, w: null, n: null, pin: null, pout: null, pcuA: null, pField: 0, eff: null, stallTorque, n0: null,
      warning: 'No load: the current and the flux fall towards zero, and the speed needed to balance the voltage rises without limit (runaway). Never run a series motor unloaded or on a belt that can slip.',
    }
  if (tl >= stallTorque) {
    return { mode: 'stalled', iField: iStall, ia: iStall, iLine: iStall, kphi: ks * iStall, e: 0, w: 0, n: 0, pin: v * iStall, pout: 0, pcuA: iStall * iStall * r, pField: 0, eff: 0, stallTorque, n0: null, warning: 'The load torque is above the stall torque: the motor cannot turn.' }
  }
  const ia = Math.sqrt(tl / ks)
  const kphi = ks * ia
  const e = v - ia * r
  const w = e / kphi
  const pin = v * ia
  const pout = tl * w
  return { mode: 'motoring', iField: ia, ia, iLine: ia, kphi, e, w, n: rpmFromRad(w), pin, pout, pcuA: ia * ia * r, pField: 0, eff: eff(pout, pin), stallTorque, n0: null }
}

// ── Compound DC motor (long shunt: shunt field across the supply, series field in the armature circuit) ──
/**
 * Φ = Φsh ± Φse: kΦ = kf·If ± ks·Ia (sense +1 cumulative, −1 differential), If = V/Rf.
 * T = kΦ·Ia = TL → ±ks·Ia² + kf·If·Ia − TL = 0 (the root with positive flux and the smaller current);
 * E = V − Ia·(Ra + Rse), ω = E/kΦ, IL = Ia + If.
 * Differential: the torque has a maximum (kf·If)²/(4ks); above it there is no operating point (the flux collapses).
 */
export function compoundMotor(p: { v: number; rf: number; kf: number; ks: number; ra: number; rse: number; tl: number; sense: number }): DcMotorResult | null {
  const { v, rf, kf, ks, ra, rse, tl } = p
  const sense = p.sense >= 0 ? 1 : -1
  const r = ra + rse
  if (rf <= 0 || kf <= 0 || ks < 0 || r <= 0 || v <= 0 || tl < 0) return null
  const iField = v / rf
  const pField = v * iField
  const a = kf * iField
  const iStall = v / r
  const stallTorque = (a + sense * ks * iStall) * iStall
  const n0 = rpmFromRad(v / a)
  let ia: number
  if (ks === 0) ia = tl / a
  else if (sense > 0) ia = (-a + Math.sqrt(a * a + 4 * ks * tl)) / (2 * ks)
  else {
    const disc = a * a - 4 * ks * tl
    if (disc < 0)
      return {
        mode: 'no-operating-point', iField, ia: null, iLine: null, kphi: null, e: null, w: null, n: null, pin: null, pout: null, pcuA: null, pField, eff: null, stallTorque, n0,
        warning: `Differential compound: the series field cancels so much flux that the torque cannot exceed (kf·If)²/(4ks) = ${((a * a) / (4 * ks)).toFixed(1)} N·m. At this load there is no steady operating point — the speed would rise and the machine become unstable.`,
      }
    ia = (a - Math.sqrt(disc)) / (2 * ks)
  }
  if (ia >= iStall) {
    return {
      mode: 'stalled', iField, ia: iStall, iLine: iStall + iField, kphi: a + sense * ks * iStall, e: 0, w: 0, n: 0, pin: v * (iStall + iField), pout: 0, pcuA: iStall * iStall * r, pField, eff: 0, stallTorque, n0,
      warning: stallTorque < 0 ? 'Differential compound at standstill: the series field outweighs the shunt field, so the starting torque is REVERSED.' : 'The load torque is above the stall torque: the motor cannot turn.',
    }
  }
  const kphi = a + sense * ks * ia
  const e = v - ia * r
  const w = e / kphi
  const iLine = ia + iField
  const pin = v * iLine
  const pout = tl * w
  return { mode: 'motoring', iField, ia, iLine, kphi, e, w, n: rpmFromRad(w), pin, pout, pcuA: ia * ia * r, pField, eff: eff(pout, pin), stallTorque, n0 }
}

// ── Separately excited DC generator on a resistive load ──────────────────────────────────────────────
/**
 * Driven at speed n by a prime mover. If = Vf/Rf, kΦ = kf·If, E = kΦ·ω, Ia = IL = E/(Ra + RL),
 * V = E − Ia·Ra = IL·RL, counter-torque T = kΦ·Ia (the prime mover must supply it), Pmech = T·ω = E·Ia.
 */
export function separatelyExcitedGenerator(p: { n: number; vf: number; rf: number; kf: number; ra: number; rl: number }) {
  const { n, vf, rf, kf, ra, rl } = p
  if (rf <= 0 || kf <= 0 || ra <= 0 || rl <= 0 || n < 0 || vf < 0) return null
  const w = radFromRpm(n)
  const iField = vf / rf
  const kphi = kf * iField
  const e = kphi * w
  const ia = e / (ra + rl)
  const v = e - ia * ra
  const torque = kphi * ia
  const pmech = torque * w
  const pout = v * ia
  const pcuA = ia * ia * ra
  const pField = vf * iField
  return {
    w, iField, kphi, e, ia, iLoad: ia, v, torque, pmech, pout, pcuA, pField,
    /** Electrical output / (shaft input + field input). */
    eff: eff(pout, pmech + pField),
    /** Voltage regulation (E − V)/V, as a fraction: E is the open-circuit (no-load) voltage at the same speed and field. */
    regulation: v > 0 ? (e - v) / v : null,
  }
}

export { radFromRpm, rpmFromRad }
