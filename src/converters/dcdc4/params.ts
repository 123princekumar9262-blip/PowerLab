import type { RunParams } from '../types.ts'
import { IDEAL_RON } from '../params.ts'

/**
 * Advanced DC-DC converters of the DC-DC lab (new module, separate from the buck/boost/buck-boost types so
 * none of their behaviour changes):
 *
 *  - three FOURTH-ORDER converters with a coupling capacitor C1 between two inductors (Ćuk, SEPIC, Zeta),
 *    one controlled switch Q1 and one diode D1;
 *  - the non-isolated BIDIRECTIONAL half-bridge between a battery (low-voltage side) and a DC bus
 *    (high-voltage side), two switches with antiparallel diodes, complementary gating.
 *
 * Every value here is a SIMULATION VALUE (an input), not a recommended design.
 */
export type CoupledKind = 'cuk' | 'sepic' | 'zeta'

export interface CoupledParams {
  /** Input DC voltage [V]. */
  vin: number
  /** Switching frequency [Hz]. */
  fs: number
  /** Duty ratio of Q1 (0.10 … 0.90). */
  duty: number
  /** Input-side inductor L1 and output-side inductor L2 [H]. */
  l1: number
  l2: number
  /** Coupling (energy-transfer) capacitor C1 [F]. */
  c1: number
  /** Output capacitor C [F]. */
  c: number
  /** Load resistance [Ω]. */
  r: number
  /** 'ideal' uses Ron = 1 mΩ for Q1 and D1 and Vf = 0. */
  devices: 'ideal' | 'real'
  ronQ: number
  vfD: number
  ronD: number
  /** Winding resistance (DCR) of EACH inductor [Ω]. */
  rl: number
  /** ESR of the output capacitor [Ω]. */
  esr: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedCoupled extends CoupledParams, RunParams {
  kind: CoupledKind
  ts: number
  q: { ron: number }
  d: { vf: number; ron: number }
}

/**
 * Defaults: 12 V in, D = 50 %, 12 Ω → |Vout| = 12 V at 1 A (ideal). L1 = L2 = 200 µH gives
 * Le = L1‖L2 = 100 µH, just above the CCM/DCM boundary Le,crit = (1 − D)²·R/(2·fs) = 75 µH — the same
 * margin as the basic converters, so DCM is one experiment away. C1 = 47 µF keeps its ripple small
 * (|Iout|·D/(C1·fs) ≈ 0.53 V) and the L–C1 resonance (≈ 1.2 kHz) far below fs.
 */
export const COUPLED_DEFAULTS: CoupledParams = {
  vin: 12,
  fs: 20e3,
  duty: 0.5,
  l1: 200e-6,
  l2: 200e-6,
  c1: 47e-6,
  c: 100e-6,
  r: 12,
  devices: 'ideal',
  ronQ: 0.05,
  vfD: 0.7,
  ronD: 0.02,
  rl: 0,
  esr: 0,
  view: 'steady',
  periods: 4,
  stepsPerPeriod: 200,
}

export const COUPLED_LIMITS = {
  vin: { min: 1, max: 400 },
  fs: { min: 1e3, max: 500e3 },
  duty: { min: 0.1, max: 0.9 },
  l1: { min: 1e-6, max: 10e-3 },
  l2: { min: 1e-6, max: 10e-3 },
  c1: { min: 1e-6, max: 10e-3 },
  c: { min: 1e-6, max: 10e-3 },
  r: { min: 0.5, max: 1000 },
  ronQ: { min: 1e-3, max: 2 },
  vfD: { min: 0, max: 2 },
  ronD: { min: 1e-3, max: 2 },
  rl: { min: 0, max: 5 },
  esr: { min: 0, max: 5 },
  periods: { min: 1, max: 20 },
  stepsPerPeriod: { min: 50, max: 2000 },
} as const

const clamp = (x: number, lo: number, hi: number, fallback: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback)

function clampAll<P extends object>(p: P, defaults: P, limits: Record<string, { min: number; max: number }>, issues: string[]): P {
  const out = { ...p } as Record<string, unknown>
  for (const [key, lim] of Object.entries(limits)) {
    const raw = out[key] as number
    const v = clamp(raw, lim.min, lim.max, (defaults as Record<string, number>)[key])
    if (v !== raw) issues.push(`${key} limited to ${v}`)
    out[key] = v
  }
  return out as P
}

export function resolveCoupled(input: Partial<CoupledParams>, kind: CoupledKind): { params: ResolvedCoupled; issues: string[] } {
  const issues: string[] = []
  const p = clampAll({ ...COUPLED_DEFAULTS, ...input }, COUPLED_DEFAULTS, COUPLED_LIMITS, issues)
  p.periods = Math.round(p.periods)
  p.stepsPerPeriod = Math.round(p.stepsPerPeriod)
  const ts = 1 / p.fs
  const ideal = p.devices === 'ideal'
  return {
    params: {
      ...p,
      kind,
      ts,
      period: ts,
      dt: ts / p.stepsPerPeriod,
      duration: p.periods * ts,
      q: { ron: ideal ? IDEAL_RON : p.ronQ },
      d: { vf: ideal ? 0 : p.vfD, ron: ideal ? IDEAL_RON : p.ronD },
    },
    issues,
  }
}

// ── Bidirectional half-bridge ─────────────────────────────────────────────────────────────────────

export interface BidiParams {
  /** DC-bus (high-voltage side) voltage [V]: a stiff source that can supply or absorb power. */
  vhv: number
  /** Battery EMF [V] and internal resistance [Ω] (low-voltage side). */
  eb: number
  rb: number
  /** Power-flow direction asked of the controller: buck = bus → battery (charge), boost = battery → bus. */
  dir: 'buck' | 'boost'
  /** Magnitude of the battery-current reference [A] (signed by `dir`). */
  iref: number
  /**
   * 'current': the duty is the controller's FEED-FORWARD from the reference,
   *            D = (Eb + Iref·(Rb + DCR + Ron))/VHV (an input command, not a measurement);
   * 'duty':    the duty is set by hand.
   */
  control: 'current' | 'duty'
  /** Duty of the upper switch Q1 when control = 'duty'. */
  duty: number
  fs: number
  l: number
  /** LV-side capacitor [F] (across the battery terminals). */
  c: number
  devices: 'ideal' | 'real'
  ronQ: number
  vfD: number
  ronD: number
  rl: number
  esr: number
  /** Dead time after each gate edge [s] (both switches OFF; an antiparallel diode carries iL). */
  deadTime: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedBidi extends BidiParams, RunParams {
  kind: 'bidirectional'
  ts: number
  /** Signed battery-current reference [A]: + charging (buck), − discharging (boost). */
  irefSigned: number
  /** Duty of Q1 actually applied (command). */
  d: number
  q: { ron: number }
  dio: { vf: number; ron: number }
}

/**
 * Defaults: a 48 V bus and a 24 V battery (0.1 Ω). Buck mode, 5 A charging: D ≈ 51 %.
 * L = 200 µH: ΔiL = VHV·D·(1 − D)/(L·fs) ≈ 3 A, so the current stays one-signed at 5 A and crosses zero
 * every period below ≈ 1.5 A. C = 470 µF: 1/(2π·fs·C) ≈ 17 mΩ ≪ Rb, so C takes the ripple, not the battery.
 */
export const BIDI_DEFAULTS: BidiParams = {
  vhv: 48,
  eb: 24,
  rb: 0.1,
  dir: 'buck',
  iref: 5,
  control: 'current',
  duty: 0.5,
  fs: 20e3,
  l: 200e-6,
  c: 470e-6,
  devices: 'ideal',
  ronQ: 0.05,
  vfD: 0.7,
  ronD: 0.02,
  rl: 0,
  esr: 0,
  deadTime: 0,
  view: 'steady',
  periods: 4,
  stepsPerPeriod: 200,
}

export const BIDI_LIMITS = {
  vhv: { min: 5, max: 800 },
  eb: { min: 1, max: 600 },
  rb: { min: 0.005, max: 5 },
  iref: { min: 0, max: 50 },
  duty: { min: 0.05, max: 0.95 },
  fs: { min: 1e3, max: 500e3 },
  l: { min: 1e-6, max: 10e-3 },
  c: { min: 1e-6, max: 10e-3 },
  ronQ: { min: 1e-3, max: 2 },
  vfD: { min: 0, max: 2 },
  ronD: { min: 1e-3, max: 2 },
  rl: { min: 0, max: 5 },
  esr: { min: 0, max: 5 },
  deadTime: { min: 0, max: 5e-6 },
  periods: { min: 1, max: 20 },
  stepsPerPeriod: { min: 50, max: 2000 },
} as const

/** The feed-forward duty of the current controller: average-model volt balance with the series resistances. */
export function feedForwardDuty(p: Pick<BidiParams, 'eb' | 'rb' | 'rl' | 'vhv'>, iSigned: number, ron: number): number {
  return (p.eb + iSigned * (p.rb + p.rl + ron)) / p.vhv
}

export function resolveBidi(input: Partial<BidiParams>): { params: ResolvedBidi; issues: string[] } {
  const issues: string[] = []
  const p = clampAll({ ...BIDI_DEFAULTS, ...input }, BIDI_DEFAULTS, BIDI_LIMITS, issues)
  p.periods = Math.round(p.periods)
  p.stepsPerPeriod = Math.round(p.stepsPerPeriod)
  const ts = 1 / p.fs
  const ideal = p.devices === 'ideal'
  const ron = ideal ? IDEAL_RON : p.ronQ
  const irefSigned = (p.dir === 'boost' ? -1 : 1) * p.iref
  let d = p.control === 'duty' ? p.duty : feedForwardDuty(p, irefSigned, ron)
  if (!(d >= 0.02 && d <= 0.98)) {
    const c = Math.min(0.98, Math.max(0.02, Number.isFinite(d) ? d : 0.5))
    issues.push(`duty limited to ${(c * 100).toFixed(1)} % (the reference needs ${(d * 100).toFixed(1)} %)`)
    d = c
  }
  // A dead time needs room on both sides of each edge.
  const maxDead = 0.45 * ts * Math.min(d, 1 - d)
  if (p.deadTime > maxDead) {
    issues.push(`dead time limited to ${(maxDead * 1e6).toFixed(2)} µs`)
    p.deadTime = maxDead
  }
  return {
    params: {
      ...p,
      kind: 'bidirectional',
      ts,
      period: ts,
      dt: ts / p.stepsPerPeriod,
      duration: p.periods * ts,
      irefSigned,
      d,
      q: { ron },
      dio: { vf: ideal ? 0 : p.vfD, ron: ideal ? IDEAL_RON : p.ronD },
    },
    issues,
  }
}
