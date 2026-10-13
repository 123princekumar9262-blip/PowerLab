/**
 * Modern motors (BLDC, PMSM, SRM, stepper, servo) — explicit steady-state / kinematic relations used by the
 * 3D Machines Lab. Each one is a standard textbook relation with its assumptions stated next to it, unit-tested in
 * tests/machines-modern.test.ts. They are calculations, not a simulation (the Drives lab simulates BLDC and PMSM).
 * A result the inputs cannot support is null, never invented.
 */

export const TWO_PI = 2 * Math.PI
export const rpmFromRadS = (w: number) => (w * 60) / TWO_PI
export const radSFromRpm = (n: number) => (n * TWO_PI) / 60
/** Wrap an angle in degrees to [0, 360). */
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360

// ── BLDC: six-step (120° conduction), two phases in series at any instant ───────────────────────────────
/**
 * Ideal six-step BLDC in steady state, seen from the DC side: two phases conduct in series, so the motor looks like
 * a DC motor with the line-to-line back EMF E = ke·ω (ke = line-to-line constant, V·s/rad) and resistance 2·Rph.
 * In SI units kt = ke (N·m/A), T = kt·I. Average applied voltage V = d·Vdc (PWM duty d, ideal switches).
 * Neglected: inductance and commutation intervals (torque ripple), switch drops, friction and iron loss.
 * Returns null when ke ≤ 0 or Rph < 0; above the stall torque the motor is stalled (speed 0, I = V / 2Rph).
 */
export function bldcSixStep(p: { vdc: number; duty: number; ke: number; rph: number; tl: number }) {
  const { vdc, duty, ke, rph, tl } = p
  if (!(ke > 0) || !(rph >= 0) || !(vdc >= 0) || duty < 0 || duty > 1 || tl < 0) return null
  const v = duty * vdc
  const kt = ke
  const rll = 2 * rph
  const w0 = v / ke // no-load speed (I = 0)
  const stallTorque = rll > 0 ? (kt * v) / rll : Infinity
  if (tl > stallTorque) {
    const i = v / rll
    return { stalled: true as const, v, kt, rll, i, e: 0, w: 0, n: 0, w0, n0: rpmFromRadS(w0), stallTorque, torque: kt * i, pin: v * i, pcu: i * i * rll, pout: 0, eff: 0 }
  }
  const i = tl / kt
  const e = v - i * rll
  const w = e / ke
  const pin = v * i
  const pcu = i * i * rll
  const pout = tl * w
  return { stalled: false as const, v, kt, rll, i, e, w, n: rpmFromRadS(w), w0, n0: rpmFromRadS(w0), stallTorque, torque: kt * i, pin, pcu, pout, eff: pin > 0 ? pout / pin : null }
}

/** Electrical frequency f = P·n/120 [Hz] (P poles, n rpm), and the commutation events per second 6·f. */
export const electricalFrequency = (poles: number, n: number) => (poles * n) / 120

export type Phase = 'A' | 'B' | 'C'
export interface SixStepState {
  /** Sector 0…5 of the electrical revolution. */
  sector: number
  /** Phase with current in (+) and out (−). */
  hi: Phase
  lo: Phase
}

/**
 * The six-step sequence used by the BLDC model (rotation in +θ, phases A, B, C spaced +120° electrical).
 * Sector k covers θe ∈ [30° + 60°·k, 90° + 60°·k): A+B−, A+C−, B+C−, B+A−, C+A−, C+B−.
 */
export const SIX_STEP: Array<{ hi: Phase; lo: Phase }> = [
  { hi: 'A', lo: 'B' },
  { hi: 'A', lo: 'C' },
  { hi: 'B', lo: 'C' },
  { hi: 'B', lo: 'A' },
  { hi: 'C', lo: 'A' },
  { hi: 'C', lo: 'B' },
]
export function sixStepSector(thetaE: number): number {
  return Math.floor(wrap360(thetaE - 30) / 60) % 6
}

/**
 * Hall sensors (latching, output 1 when a rotor N pole is over them) placed at the electrical angles `posE`
 * (default 60°, 180°, 300°: the slot openings of the drawn 6-slot / 4-pole motor). A magnet N pole centred at θe
 * covers θe ± 90° electrical. Returns the three bits [Ha, Hb, Hc].
 */
export const HALL_POS_E = [60, 180, 300] as const
export function hallBits(thetaE: number, posE: readonly number[] = HALL_POS_E): [0 | 1, 0 | 1, 0 | 1] {
  const bit = (a: number): 0 | 1 => {
    const d = wrap360(a - thetaE)
    return d < 90 || d >= 270 ? 1 : 0
  }
  return [bit(posE[0]), bit(posE[1]), bit(posE[2])]
}
export const hallCode = (b: readonly number[]) => `${b[0]}${b[1]}${b[2]}`
/** Commutation table: Hall code → the pair to switch on (what the controller looks up). */
export const HALL_TABLE: Record<string, { hi: Phase; lo: Phase }> = {
  '100': SIX_STEP[0],
  '110': SIX_STEP[1],
  '010': SIX_STEP[2],
  '011': SIX_STEP[3],
  '001': SIX_STEP[4],
  '101': SIX_STEP[5],
}
/** The state the controller selects at rotor angle θe (from the Hall code, as the real controller does). */
export function sixStepFromHalls(thetaE: number): SixStepState & { halls: [0 | 1, 0 | 1, 0 | 1]; code: string } {
  const halls = hallBits(thetaE)
  const code = hallCode(halls)
  const pair = HALL_TABLE[code]
  return { sector: SIX_STEP.indexOf(pair), hi: pair.hi, lo: pair.lo, halls, code }
}
/** Phase axis (electrical degrees) of A, B, C. */
export const PHASE_AXIS_E: Record<Phase, number> = { A: 0, B: 120, C: 240 }
/**
 * Direction (electrical degrees) the energised pair pulls the rotor N pole towards: the + phase's teeth become N,
 * the − phase's teeth S; the rotor N pole is attracted to the S teeth and repelled by the N teeth. For a pair hi/lo
 * this is the direction opposite to (axis_hi − axis_lo).
 */
export function pullAngleE(hi: Phase, lo: Phase): number {
  const a = (PHASE_AXIS_E[hi] * Math.PI) / 180
  const b = (PHASE_AXIS_E[lo] * Math.PI) / 180
  const x = Math.cos(a) - Math.cos(b)
  const y = Math.sin(a) - Math.sin(b)
  return wrap360((Math.atan2(y, x) * 180) / Math.PI + 180)
}
/** Ideal trapezoidal back-EMF shape of a phase (−1 … 1) vs θe: flat ±1 over 120°, linear over 60° (A peaks at 90°). */
export function trapezoid(thetaE: number, phase: Phase = 'A'): number {
  const t = wrap360(thetaE - PHASE_AXIS_E[phase])
  if (t < 30) return t / 30
  if (t < 150) return 1
  if (t < 210) return 1 - (t - 150) / 30
  if (t < 330) return -1
  return -1 + (t - 330) / 30
}

// ── PMSM: d–q model, steady state, id = 0 ────────────────────────────────────────────────────────────────
/**
 * Synchronous speed Ns = 120·f/P. With id = 0 (amplitude-invariant d–q): T = 1.5·p·ψ·iq, p = P/2 pole pairs,
 * ψ = magnet flux linkage (peak, per phase), iq = peak phase current. Steady state voltages: vd = −ωe·Lq·iq,
 * vq = Rs·iq + ωe·ψ; P_in = 1.5·(vd·id + vq·iq) = 1.5·Rs·iq² + T·ωm. Iron loss, friction and saturation neglected.
 * The relation T = 1.5·p·ψ·iq holds for surface or interior magnets when id = 0 (reluctance torque 1.5·p·(Ld − Lq)·id·iq = 0).
 */
export function pmsmSteady(p: { f: number; poles: number; psi: number; iq: number; rs: number; lq: number }) {
  const { f, poles, psi, iq, rs, lq } = p
  if (!(poles >= 2) || poles % 2 !== 0 || f < 0 || psi < 0 || rs < 0 || lq < 0) return null
  const pp = poles / 2
  const ns = (120 * f) / poles
  const we = TWO_PI * f
  const wm = we / pp
  const torque = 1.5 * pp * psi * iq
  const vd = -we * lq * iq
  const vq = rs * iq + we * psi
  const vmag = Math.hypot(vd, vq)
  const emfPeak = we * psi
  const pmech = torque * wm
  const pcu = 1.5 * rs * iq * iq
  const pin = 1.5 * (vd * 0 + vq * iq)
  return { pp, ns, we, wm, torque, vd, vq, vmag, emfPeak, emfRms: emfPeak / Math.SQRT2, irms: Math.abs(iq) / Math.SQRT2, pmech, pcu, pin, eff: pin > 0 ? pmech / pin : null }
}
/** Phase currents from d–q (inverse Park, amplitude invariant) at electrical angle θe [rad]. */
export function invPark(id: number, iq: number, thetaE: number): [number, number, number] {
  const f = (s: number) => id * Math.cos(thetaE - s) - iq * Math.sin(thetaE - s)
  return [f(0), f((2 * Math.PI) / 3), f((-2 * Math.PI) / 3)]
}
/** d–q from phase currents (Park, amplitude invariant). */
export function park(ia: number, ib: number, ic: number, thetaE: number): [number, number] {
  const k = 2 / 3
  const s = (2 * Math.PI) / 3
  const d = k * (ia * Math.cos(thetaE) + ib * Math.cos(thetaE - s) + ic * Math.cos(thetaE + s))
  const q = -k * (ia * Math.sin(thetaE) + ib * Math.sin(thetaE - s) + ic * Math.sin(thetaE + s))
  return [d, q]
}

// ── Switched reluctance motor ───────────────────────────────────────────────────────────────────────────
/** A regular SRM works only if the rotor pole count is not a multiple of the phase count (else all phases align together). */
export const srmValid = (nph: number, nr: number) => nph >= 2 && nr >= 2 && Number.isInteger(nph) && Number.isInteger(nr) && nr % nph !== 0
/** Stroke (step) angle ε = 360° / (Nph·Nr); strokes per revolution Nph·Nr. Null for an invalid combination. */
export function srmStroke(nph: number, nr: number) {
  if (!srmValid(nph, nr)) return null
  return { stroke: 360 / (nph * nr), strokesPerRev: nph * nr, rotorPitch: 360 / nr }
}
/** Each phase is switched once per rotor pole passing: f_ph = n·Nr/60 [Hz]; stroke rate Nph·f_ph. */
export const srmPhaseFrequency = (n: number, nr: number) => (n * nr) / 60
/**
 * Torque of one phase while the inductance rises linearly (no saturation): T = ½·i²·dL/dθ, dL/dθ = (La − Lu)/β.
 * β in degrees (converted to rad). Null when β ≤ 0 or La < Lu.
 */
export function srmTorque(i: number, la: number, lu: number, betaDeg: number) {
  if (!(betaDeg > 0) || la < lu) return null
  const dLdTheta = (la - lu) / ((betaDeg * Math.PI) / 180)
  return { dLdTheta, torque: 0.5 * i * i * dLdTheta }
}

// ── Stepper (two-phase hybrid) ──────────────────────────────────────────────────────────────────────────
/** Step angle = 360° / (steps per revolution). A two-phase hybrid takes 4·Nr full steps per revolution. */
export const stepAngle = (stepsPerRev: number) => (stepsPerRev > 0 ? 360 / stepsPerRev : null)
export const hybridStepsPerRev = (nr: number, phases = 2) => 2 * phases * nr
/**
 * Steps → angle and angle → steps (open loop, no missed steps). Microstepping divides each full step by `micro`.
 * The steps for a target are rounded to the nearest whole (micro)step; the residual is the positioning error.
 */
export function stepperMove(p: { stepsPerRev: number; micro: number; steps: number; target: number; rate: number }) {
  const { stepsPerRev, micro, steps, target, rate } = p
  if (!(stepsPerRev > 0) || !(micro >= 1)) return null
  const full = 360 / stepsPerRev
  const res = full / micro
  const angle = steps * res
  const need = Math.round(target / res)
  const reached = need * res
  const speedRpm = (rate * res * 60) / 360 // rate in (micro)steps per second
  return { full, res, angle, need, reached, error: target - reached, speedRpm, revs: angle / 360 }
}
/**
 * Full-step (one phase on, "wave drive") sequence of a two-phase stepper: A+, B+, A−, B−. Step k → state k mod 4.
 */
export const FULL_STEP = ['A+', 'B+', 'A−', 'B−'] as const
export const fullStepState = (k: number) => FULL_STEP[((k % 4) + 4) % 4]

// ── Servo: encoder and proportional position loop ───────────────────────────────────────────────────────
/**
 * Quadrature incremental encoder: counts/rev = 4·PPR; resolution 360°/counts. A proportional position loop with an
 * ideal inner speed loop gives ω_cmd = Kv·error: a first-order position response, time constant 1/Kv (2 % settling
 * ≈ 4/Kv), and a following error e = ω/Kv at constant speed ω. Null when PPR or Kv are not positive.
 */
export function servoLoop(p: { ppr: number; kv: number; n: number; move: number }) {
  const { ppr, kv, n, move } = p
  if (!(ppr > 0) || !(kv > 0)) return null
  const counts = 4 * ppr
  const resolution = 360 / counts
  const w = radSFromRpm(n)
  const followRad = w / kv
  const followDeg = (followRad * 180) / Math.PI
  return { counts, resolution, tau: 1 / kv, settle2: 4 / kv, followRad, followDeg, followCounts: followDeg / resolution, moveCounts: move / resolution }
}

/**
 * The 6/4 SRM model: stator poles of phases A, B, C at 0°, 60°, 120° (and opposite), rotor poles at θ + k·90°.
 * For clockwise rotation (θ decreasing), a phase is energised while the nearest rotor pole is approaching it from
 * the counter-clockwise side within one stroke (0 < θ − αX ≤ 30°, modulo the 90° rotor pole pitch) — the rising-
 * inductance region, where ½·i²·dL/dθ pulls the rotor towards alignment. Ideal flat-topped conduction.
 */
export const SRM64_AXIS = { A: 0, B: 60, C: 120 } as const
export function srm64Phase(thetaDeg: number): Phase {
  for (const ph of ['A', 'B', 'C'] as Phase[]) {
    const d = (((thetaDeg - SRM64_AXIS[ph]) % 90) + 90) % 90 // 0 … 90
    if (d > 0 && d <= 30) return ph
  }
  // exactly aligned on a boundary (d = 0): the phase that has just taken over
  return srm64Phase(thetaDeg - 1e-9)
}
/** Signed angle (−45° … 45°] from stator pole axis α to the nearest rotor pole (rotor poles at θ + k·90°). */
export function srm64Offset(thetaDeg: number, alphaDeg: number): number {
  let d = (((thetaDeg - alphaDeg) % 90) + 90) % 90
  if (d > 45) d -= 90
  return d
}

/**
 * The drawn two-phase hybrid stepper: 8 stator poles at k·45° (phase A on even k, B on odd k), 50 rotor teeth per
 * cup (pitch 7.2°). Front cup = N (axial magnet), rear cup = S, offset by half a tooth pitch. Polarity of each pole
 * (as seen from the rotor) for a full-step state: A+ makes poles 0 and 4 S (they attract the N cup) and 2, 6 N.
 * Equilibrium (holding) angle of full step k: θ = k·1.8° (front-cup tooth 0 at θ).
 */
export const HYBRID = { poles: 8, nr: 50, pitch: 7.2 } as const
export function hybridPolePolarity(state: (typeof FULL_STEP)[number], pole: number): 'N' | 'S' | null {
  const phaseA = pole % 2 === 0
  if (phaseA !== state.startsWith('A')) return null
  const positive = state.endsWith('+')
  const firstOfPair = phaseA ? pole % 4 === 0 : pole % 4 === 1
  // + current: poles 0, 4 (A) or 1, 5 (B) are S; the others of the phase N
  return firstOfPair === positive ? 'S' : 'N'
}
/**
 * Static torque of an energised hybrid stepper displaced by Δθ (mechanical, degrees) from its holding position,
 * first-harmonic approximation: T = −T_H · sin(Nr · Δθ). Maximum (= holding torque) at Δθ = ±¼ tooth pitch; beyond
 * ±½ tooth pitch the rotor falls into the next stable position.
 */
export const stepperRestoringTorque = (th: number, nr: number, dDeg: number) => -th * Math.sin((nr * dDeg * Math.PI) / 180)
