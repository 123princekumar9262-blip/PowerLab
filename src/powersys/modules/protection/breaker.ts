import { abs } from '../../engine/complex.ts'
import { zBaseOhm } from '../../network/perunit.ts'
import { BREAKERS, faultModel, SETUP0 } from '../faults/study.ts'
import { faultStudy } from '../faults/zbus.ts'

/*
 * Circuit-breaker duty: the symmetrical breaking current (Module 4's three-phase fault current at the breaker's bus),
 * the making current (the first peak of a fully offset fault current), and the transient recovery voltage (TRV) after
 * the arc is interrupted at a current zero.
 *
 * TRV model (single-phase equivalent of the source side): the source is an inductance L (from the fault level:
 * L = X₁/ω) with a capacitance C to earth at the breaker (bushings, CTs, the busbar). At the current zero the source
 * voltage is at its peak V_m (the fault current lags it by ≈ 90°) and, over the few hundred microseconds of the
 * transient, it is taken as constant. With C uncharged (the arc held it near zero) and no current in L:
 *   L·C·v″ + (L/R)·v′ + v = V_m       (R = a resistor across the contacts, "resistance switching"; R = ∞: none)
 *   no damping:  v(t) = V_m (1 − cos ω₀t),  ω₀ = 1/√(LC),  peak 2V_m at t = π/ω₀,  RRRV = max dv/dt = V_m·ω₀ at t = π/(2ω₀).
 * Assumptions (stated on screen): ideal interruption at the current zero, lumped lossless L and C, the arc voltage
 * and post-arc current neglected; the first-pole-to-clear factor of a three-phase fault is not included.
 */

export interface SourceDuty {
  id: string
  what: string
  kv: number
  /** Symmetrical three-phase fault current at the bus [kA rms] (Module 4). */
  iSymKa: number
  /** The breaker's rated breaking current [kA] (Module 4's equipment data). */
  ratingKa: number
  /** Thevenin resistance and reactance at the bus [Ω]. */
  rOhm: number
  xOhm: number
  /** Source inductance L = X₁/ω [H]. */
  lH: number
  /** Phase peak voltage √2·V/√3 [V]. */
  vPeakV: number
}

export const W50 = 2 * Math.PI * 50

/** The duty of one of Module 4's breakers, from Module 4's fault model. */
export function sourceDuty(id: string): SourceDuty {
  const b = BREAKERS.find((x) => x.id === id) ?? BREAKERS[0]
  const m = faultModel(SETUP0)
  const r = faultStudy(m, b.at, '3ph')
  const zb = zBaseOhm(m.kv[m.busIds.indexOf(b.at)], m.net.baseMva)
  const rOhm = r.z1!.re * zb
  const xOhm = r.z1!.im * zb
  return {
    id: b.id,
    what: b.what.includes('kV') ? b.what : `${b.kv} kV ${b.what}`,
    kv: b.kv,
    iSymKa: r.faultKa,
    ratingKa: b.ratingKa,
    rOhm,
    xOhm,
    lH: xOhm / W50,
    vPeakV: (Math.SQRT2 * b.kv * 1000) / Math.sqrt(3),
  }
}
export const DUTY_BREAKERS = BREAKERS.map((b) => ({ id: b.id, label: `${b.id} · ${b.what.includes('kV') ? b.what : `${b.kv} kV ${b.what}`}` }))

// ── making current ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The first peak of a fault current with the largest DC offset, as a multiple of the symmetrical peak √2·I:
 * i(θ)/(√2 I) = e^(−θ/(X/R)) − cos θ (θ = ωt), maximised over the first cycle. X/R → ∞ gives 2 (full doubling).
 */
export function peakFactor(xr: number): number {
  if (!Number.isFinite(xr) || xr <= 0) return 1
  const f = (t: number) => Math.exp(-t / xr) - Math.cos(t)
  // the maximum lies just before θ = π: golden-section search on [π/2, π]
  let a = Math.PI / 2
  let b = Math.PI
  const g = (Math.sqrt(5) - 1) / 2
  for (let i = 0; i < 80; i++) {
    const c = b - g * (b - a)
    const d = a + g * (b - a)
    if (f(c) > f(d)) b = d
    else a = c
  }
  return f((a + b) / 2)
}
/** The textbook making-current factor: 1.8 × √2 ≈ 2.55 (1.8 = the doubling factor assumed). */
export const TEXTBOOK_DOUBLING = 1.8
/** X/R at which the simple estimate 1 + e^(−π/(X/R)) gives the doubling factor 1.8. */
export const xrForDoubling = (k: number) => Math.PI / -Math.log(k - 1)

// ── transient recovery voltage ───────────────────────────────────────────────────────────────────────────────────

export interface TrvParams {
  lH: number
  cF: number
  vPeakV: number
  /** Resistor across the contacts [Ω]; null = none. */
  rOhm: number | null
}

export function trvIssues(p: TrvParams): string[] {
  const out: string[] = []
  if (!(p.lH > 0)) out.push('The source inductance must be above zero.')
  if (!(p.cF > 0)) out.push('The capacitance at the breaker must be above zero: with none, the voltage would jump instantly (an infinite rate of rise).')
  if (p.rOhm !== null && !(p.rOhm > 0)) out.push('A switching resistor must be above zero ohms.')
  return out
}

/** Critical damping resistance across the contacts: R_c = ½·√(L/C). */
export const rCritical = (lH: number, cF: number) => 0.5 * Math.sqrt(lH / cF)

export interface TrvMetrics {
  w0: number
  f0: number
  alpha: number
  regime: 'undamped' | 'under' | 'critical' | 'over'
  /** Highest voltage across the contacts [V] (for an over-damped circuit: the value it rises towards, V_m). */
  peakV: number
  tPeak: number | null
  /** Maximum rate of rise [V/s] and when it occurs. */
  rrrv: number
  tRrrv: number
}

/** ω₀, the damping α = 1/(2RC), and the regime (within 1e-9 of ω₀ counts as critical). */
function damping(p: TrvParams) {
  const w0 = 1 / Math.sqrt(p.lH * p.cF)
  const a = p.rOhm === null ? 0 : 1 / (2 * p.rOhm * p.cF)
  const regime: TrvMetrics['regime'] = a === 0 ? 'undamped' : Math.abs(a - w0) <= 1e-9 * w0 ? 'critical' : a < w0 ? 'under' : 'over'
  return { w0, a: regime === 'critical' ? w0 : a, regime }
}

/** v(t) [V] in closed form for each damping regime. */
export function trvAt(t: number, p: TrvParams): number {
  const V = p.vPeakV
  const { w0, a, regime } = damping(p)
  if (regime === 'undamped') return V * (1 - Math.cos(w0 * t))
  if (regime === 'under') {
    const wd = Math.sqrt(w0 * w0 - a * a)
    return V * (1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t)))
  }
  if (regime === 'critical') return V * (1 - Math.exp(-a * t) * (1 + a * t))
  const b = Math.sqrt(a * a - w0 * w0)
  const s1 = -a + b
  const s2 = -a - b
  return V * (1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2))
}

/** dv/dt [V/s] in closed form. */
export function trvSlope(t: number, p: TrvParams): number {
  const V = p.vPeakV
  const { w0, a, regime } = damping(p)
  if (regime === 'undamped') return V * w0 * Math.sin(w0 * t)
  if (regime === 'under') {
    const wd = Math.sqrt(w0 * w0 - a * a)
    return ((V * w0 * w0) / wd) * Math.exp(-a * t) * Math.sin(wd * t)
  }
  if (regime === 'critical') return V * a * a * t * Math.exp(-a * t)
  const b = Math.sqrt(a * a - w0 * w0)
  const s1 = -a + b
  const s2 = -a - b
  return ((V * s1 * s2) / (s1 - s2)) * (Math.exp(s1 * t) - Math.exp(s2 * t))
}

export function trvMetrics(p: TrvParams): TrvMetrics {
  const V = p.vPeakV
  const { w0, a, regime } = damping(p)
  const f0 = w0 / (2 * Math.PI)
  if (regime === 'undamped') return { w0, f0, alpha: 0, regime: 'undamped', peakV: 2 * V, tPeak: Math.PI / w0, rrrv: V * w0, tRrrv: Math.PI / (2 * w0) }
  if (regime === 'under') {
    const wd = Math.sqrt(w0 * w0 - a * a)
    const tR = Math.atan2(wd, a) / wd
    return { w0, f0, alpha: a, regime: 'under', peakV: V * (1 + Math.exp((-a * Math.PI) / wd)), tPeak: Math.PI / wd, rrrv: V * w0 * Math.exp(-a * tR), tRrrv: tR }
  }
  if (regime === 'critical') return { w0, f0, alpha: a, regime: 'critical', peakV: V, tPeak: null, rrrv: V * a * Math.exp(-1), tRrrv: 1 / a }
  const b = Math.sqrt(a * a - w0 * w0)
  const s1 = -a + b
  const s2 = -a - b
  const tR = Math.log(s2 / s1) / (s1 - s2)
  return { w0, f0, alpha: a, regime: 'over', peakV: V, tPeak: null, rrrv: trvSlope(tR, p), tRrrv: tR }
}

/**
 * The same circuit integrated numerically (the independent check): state x = (v, i_L), L·di/dt = V_m − v,
 * C·dv/dt = i_L − v/R, from v = 0, i_L = 0, by the classical 4th-order Runge–Kutta method with `n` equal steps.
 * Returns the samples, the highest v and the highest dv/dt (= i_C/C, read from the state at each step).
 */
export function trvRk4(p: TrvParams, tEnd: number, n: number) {
  const h = tEnd / n
  const g = p.rOhm === null ? 0 : 1 / p.rOhm
  const f = (v: number, i: number): [number, number] => [(i - g * v) / p.cF, (p.vPeakV - v) / p.lH]
  let v = 0
  let i = 0
  const t: number[] = [0]
  const vs: number[] = [0]
  let vMax = 0
  let sMax = 0
  for (let k = 1; k <= n; k++) {
    const k1 = f(v, i)
    const k2 = f(v + (h / 2) * k1[0], i + (h / 2) * k1[1])
    const k3 = f(v + (h / 2) * k2[0], i + (h / 2) * k2[1])
    const k4 = f(v + h * k3[0], i + h * k3[1])
    v += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
    i += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
    t.push(k * h)
    vs.push(v)
    vMax = Math.max(vMax, v)
    sMax = Math.max(sMax, (i - g * v) / p.cF)
  }
  return { t, v: vs, vMax, sMax }
}

/** Default capacitance at the breaker [nF] (illustrative: bushings, current transformers and a short busbar). */
export const C0_NF = 10

/** |Z| for a bus from R and X. */
export const zMag = (d: SourceDuty) => abs({ re: d.rOhm, im: d.xOhm })
