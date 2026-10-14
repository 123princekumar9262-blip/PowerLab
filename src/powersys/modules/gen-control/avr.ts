/*
 * The automatic voltage regulator (AVR) loop of one generator: the standard linear textbook model, each element a
 * gain with one time constant, in per unit:
 *
 *   amplifier   K_A/(1 + sT_A)      exciter   K_E/(1 + sT_E)      generator field   K_G/(1 + sT_G)
 *   sensor      K_R/(1 + sT_R)      error     e = ΔV_ref − ΔV_s (the sensor output)
 *
 *   T_A·v_A′ = K_A·e − v_A      T_E·v_F′ = K_E·v_A − v_F      T_G·ΔV_t′ = K_G·v_F − ΔV_t      T_R·ΔV_s′ = K_R·ΔV_t − ΔV_s
 *
 * Closed loop:   ΔV_t/ΔV_ref = K_A·K_E·K_G·(1 + sT_R) / [(1 + sT_A)(1 + sT_E)(1 + sT_G)(1 + sT_R) + K],   K = K_A·K_E·K_G·K_R.
 * Steady state (s → 0) for a step ΔV_ref:   ΔV_t = K_A·K_E·K_G/(1 + K)·ΔV_ref;  with K_R = 1 the error is e_ss = ΔV_ref/(1 + K).
 * Stability: the characteristic polynomial a₄s⁴ + a₃s³ + a₂s² + a₁s + a₀ = 0 with a₀ = 1 + K; Routh's criterion.
 *
 * Assumes: small deviations (linear), the generator on open circuit or lightly loaded (one field time constant),
 * no exciter saturation or ceiling limits, no rate (stabilising) feedback. Integrated with RK4 at a fixed step.
 */

export interface AvrParams {
  KA: number
  TA: number
  KE: number
  TE: number
  KG: number
  TG: number
  KR: number
  TR: number
  /** reference step [pu] */
  dVref: number
}

export const AVR0: AvrParams = { KA: 10, TA: 0.1, KE: 1, TE: 0.4, KG: 1, TG: 1, KR: 1, TR: 0.05, dVref: 1 }

/** The open-loop gain K = K_A·K_E·K_G·K_R. */
export const loopGain = (p: AvrParams) => p.KA * p.KE * p.KG * p.KR

/** Steady-state terminal voltage change for the reference step [pu]. */
export const vtSteady = (p: AvrParams) => ((p.KA * p.KE * p.KG) / (1 + loopGain(p))) * p.dVref
/** Steady-state error e = ΔV_ref − ΔV_s = ΔV_ref/(1 + K) [pu]. */
export const errSteady = (p: AvrParams) => p.dVref / (1 + loopGain(p))

/** Coefficients [a₀, a₁, a₂, a₃, a₄] of (1 + sT_A)(1 + sT_E)(1 + sT_G)(1 + sT_R) + K. */
export function charPoly(p: AvrParams): [number, number, number, number, number] {
  let c = [1]
  for (const T of [p.TA, p.TE, p.TG, p.TR]) {
    const n = new Array(c.length + 1).fill(0)
    for (let i = 0; i < c.length; i++) {
      n[i] += c[i]
      n[i + 1] += c[i] * T
    }
    c = n
  }
  c[0] += loopGain(p)
  return [c[0], c[1], c[2], c[3], c[4]]
}

export interface Routh {
  a: [number, number, number, number, number]
  /** the Routh array, rows s⁴ … s⁰ (first two entries of each) */
  rows: Array<{ power: number; v: [number, number] }>
  /** the first column */
  first: number[]
  stable: boolean
  /** sign changes in the first column = poles in the right half plane */
  rhp: number
  /** the largest open-loop gain K (and K_A) for stability, and the oscillation frequency there [rad/s] */
  kMax: number
  kaMax: number
  wOsc: number
}

/**
 * Routh's criterion for the quartic. Rows:  s⁴: a₄ a₂ a₀ · s³: a₃ a₁ · s²: b₁ = (a₃a₂ − a₄a₁)/a₃, b₂ = a₀ ·
 * s¹: c₁ = (b₁a₁ − a₃a₀)/b₁ · s⁰: a₀. Only a₀ = 1 + K depends on K, so c₁ > 0 ⇔ K < b₁a₁/a₃ − 1 = K_max;
 * at K_max the s² row gives the auxiliary equation b₁s² + a₀ = 0, an oscillation at ω = √(a₀/b₁) = √(a₁/a₃).
 */
export function routh(p: AvrParams): Routh {
  const a = charPoly(p)
  const [a0, a1, a2, a3, a4] = a
  const b1 = (a3 * a2 - a4 * a1) / a3
  const c1 = (b1 * a1 - a3 * a0) / b1
  const first = [a4, a3, b1, c1, a0]
  let rhp = 0
  for (let i = 1; i < first.length; i++) if (Math.sign(first[i]) !== Math.sign(first[i - 1])) rhp++
  const kMax = (b1 * a1) / a3 - 1
  const kOther = p.KE * p.KG * p.KR
  return {
    a,
    rows: [
      { power: 4, v: [a4, a2] },
      { power: 3, v: [a3, a1] },
      { power: 2, v: [b1, a0] },
      { power: 1, v: [c1, 0] },
      { power: 0, v: [a0, 0] },
    ],
    first,
    stable: first.every((v) => v > 0),
    rhp,
    kMax,
    kaMax: kMax / kOther,
    wOsc: Math.sqrt(a1 / a3),
  }
}

export interface AvrRun {
  t: number[]
  /** ΔV_t [pu] */
  vt: number[]
  /** ΔV_s, the sensor output [pu] */
  vs: number[]
  /** the run was stopped early because the response grew beyond the display bound */
  stopped: boolean
  /** the envelope trend of ΔV_t − ΔV_t,ss over the run, from the simulation alone */
  trend: 'decaying' | 'growing' | 'sustained'
  /** ratio of the envelope in the last 30 % of the run to the envelope in the 30 % before it */
  envRatio: number
  peak: number
  tPeak: number
  /** overshoot above the steady value [%] (stable runs) */
  overshootPct: number
  /** 2 % settling time [s] (NaN if not settled within the run) */
  tSettle: number
  end: number
  tEnd: number
  h: number
}

type S = [number, number, number, number] // v_A, v_F, ΔV_t, ΔV_s

function deriv(p: AvrParams, x: S): S {
  const [va, vf, vt, vs] = x
  return [(p.KA * (p.dVref - vs) - va) / p.TA, (p.KE * va - vf) / p.TE, (p.KG * vf - vt) / p.TG, (p.KR * vt - vs) / p.TR]
}

/** Step response of the AVR loop. A growing response is stopped once |ΔV_t − ΔV_t,ss| exceeds `bound` × ΔV_ref. */
export function simulateAvr(p: AvrParams, opt: { tEnd?: number; h?: number; keepEvery?: number; bound?: number } = {}): AvrRun {
  const tEnd = opt.tEnd ?? 10
  const h = opt.h ?? 0.002
  const keep = Math.max(1, opt.keepEvery ?? 1)
  const bound = (opt.bound ?? 3) * Math.max(Math.abs(p.dVref), 1e-9)
  const n = Math.round(tEnd / h)
  const vss = vtSteady(p)
  let x: S = [0, 0, 0, 0]
  const out: AvrRun = { t: [0], vt: [0], vs: [0], stopped: false, trend: 'decaying', envRatio: 0, peak: 0, tPeak: 0, overshootPct: 0, tSettle: NaN, end: 0, tEnd, h }
  const add = (a: S, b: S, k: number): S => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2], a[3] + k * b[3]]
  const dev: Array<[number, number]> = []
  for (let i = 1; i <= n; i++) {
    const k1 = deriv(p, x)
    const k2 = deriv(p, add(x, k1, h / 2))
    const k3 = deriv(p, add(x, k2, h / 2))
    const k4 = deriv(p, add(x, k3, h))
    x = [0, 1, 2, 3].map((j) => x[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) as S
    const t = i * h
    if (x[2] > out.peak) {
      out.peak = x[2]
      out.tPeak = t
    }
    dev.push([t, Math.abs(x[2] - vss)])
    const over = !Number.isFinite(x[2]) || Math.abs(x[2] - vss) > bound
    if (i % keep === 0 || i === n || over) {
      out.t.push(t)
      out.vt.push(x[2])
      out.vs.push(x[3])
    }
    if (over) {
      out.stopped = true
      break
    }
  }
  out.end = out.vt[out.vt.length - 1]
  const tLast = out.t[out.t.length - 1]
  // the envelope trend: the largest deviation from the steady value in two consecutive windows
  const env = (a: number, b: number) => dev.reduce((m, [t, d]) => (t > a && t <= b ? Math.max(m, d) : m), 0)
  const e1 = env(0.4 * tLast, 0.7 * tLast)
  const e2 = env(0.7 * tLast, tLast)
  out.envRatio = e1 > 0 ? e2 / e1 : 0
  if (out.stopped) out.trend = 'growing'
  else if (e2 < 1e-6 * Math.abs(p.dVref) || out.envRatio < 0.98) out.trend = 'decaying'
  else if (out.envRatio > 1.02) out.trend = 'growing'
  else out.trend = 'sustained'
  if (out.trend === 'decaying' && vss !== 0) {
    out.overshootPct = Math.max(0, ((out.peak - vss) / Math.abs(vss)) * 100)
    // 2 % band around the steady value
    let last = 0
    for (const [t, d] of dev) if (d > 0.02 * Math.abs(vss)) last = t
    out.tSettle = last < tLast - 1e-9 ? last : NaN
  }
  return out
}
