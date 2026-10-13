/*
 * Rotor-angle stability of one machine connected to an infinite bus (SMIB), classical model.
 *
 * Network: the generator's internal EMF E′ behind its transient reactance and step-up transformer (Xg, together),
 * feeding an HV bus; two identical parallel lines (each Xl) to an infinite bus V∠0. A three-phase fault on line 2 —
 * at the HV bus (the generator's end of the line) or at its midpoint — is cleared after t_c by opening line 2.
 *
 *   pre-fault   X1 = Xg + Xl/2
 *   during      bus fault: E′ is shorted from the infinite bus → P_e = 0
 *               fault at a fraction λ along line 2: star (Xg, Xl, λ·Xl) at the HV bus → X2 = (Xg·Xl + Xl·c + c·Xg)/c, c = λ·Xl
 *   post-fault  X3 = Xg + Xl  (line 2 open)
 *
 * Swing equation (per unit on the system base; machine base = system base):
 *   (2H/ω_s) · d²δ/dt² = P_m − P_e(δ) − D · Δω/ω_s,     P_e = P_max · sin δ,  P_max = E′·V/X
 * State: δ [rad, electrical] and Δω = dδ/dt [rad/s, electrical], ω_s = 2π f₀.
 * Assumes: constant E′ (no AVR, no flux decay), constant P_m (no governor action in the first second), no PSS,
 * lossless network, balanced three-phase fault, D = 0 unless set (damping in pu power per pu speed).
 *
 * Integrated with fourth-order Runge–Kutta at a fixed step (1 ms by default); the step is adjusted so that one step
 * ends exactly at the clearing instant (P_e changes discontinuously there).
 */

export type FaultAt = 'bus' | 'mid'

export interface SmibParams {
  /** System frequency [Hz] */
  f0: number
  /** Inertia constant [s] (MJ/MVA) on the system base */
  H: number
  /** Damping [pu power per pu speed] */
  D: number
  /** Internal EMF behind transient reactance [pu] */
  E: number
  /** Infinite-bus voltage [pu] */
  V: number
  /** Generator transient reactance + step-up transformer [pu] */
  Xg: number
  /** Reactance of each of the two parallel lines [pu] */
  Xl: number
  /** Mechanical input power [pu] */
  Pm: number
  /** Fault location on line 2 */
  fault: FaultAt
  /** Clearing time [s] */
  tc: number
}

export const SMIB0: SmibParams = { f0: 50, H: 5, D: 0, E: 1.1, V: 1, Xg: 0.3, Xl: 0.6, Pm: 0.8, fault: 'bus', tc: 0.15 }

export const ws = (f0: number) => 2 * Math.PI * f0
export const deg = (r: number) => (r * 180) / Math.PI
export const rad = (d: number) => (d * Math.PI) / 180

/** Fraction along line 2 (from the HV bus) for each fault location. */
export const FAULT_LAMBDA: Record<FaultAt, number> = { bus: 0, mid: 0.5 }

export interface Reactances {
  /** pre-fault transfer reactance */
  X1: number
  /** during-fault transfer reactance (Infinity for a fault at the HV bus) */
  X2: number
  /** post-fault transfer reactance */
  X3: number
}

export function reactances(p: Pick<SmibParams, 'Xg' | 'Xl' | 'fault'>): Reactances {
  const c = FAULT_LAMBDA[p.fault] * p.Xl
  const X2 = c <= 0 ? Infinity : (p.Xg * p.Xl + p.Xl * c + c * p.Xg) / c
  return { X1: p.Xg + p.Xl / 2, X2, X3: p.Xg + p.Xl }
}

export interface PowerLimits {
  P1: number
  P2: number
  P3: number
}

export function powerLimits(p: SmibParams): PowerLimits {
  const r = reactances(p)
  const k = p.E * p.V
  return { P1: k / r.X1, P2: Number.isFinite(r.X2) ? k / r.X2 : 0, P3: k / r.X3 }
}

/** Pre-fault equilibrium angle δ0 = asin(P_m / P1) [rad]; NaN when P_m ≥ P1 (no steady state). */
export function delta0(Pm: number, P1: number): number {
  return Pm < P1 ? Math.asin(Pm / P1) : NaN
}

/** Synchronising power coefficient P_s = dP_e/dδ at δ0 = P_max · cos δ0 [pu/rad]. */
export const syncPower = (Pmax: number, d0: number) => Pmax * Math.cos(d0)

/** Small-signal natural frequency ω_n = √(ω_s · P_s / (2H)) [rad/s]. */
export const naturalFreq = (f0: number, H: number, Ps: number) => Math.sqrt((ws(f0) * Ps) / (2 * H))

/** Post-fault unstable equilibrium δ_max = π − asin(P_m / P3) [rad]; NaN when P_m ≥ P3. */
export function deltaMax(Pm: number, P3: number): number {
  return Pm < P3 ? Math.PI - Math.asin(Pm / P3) : NaN
}

/**
 * Critical clearing angle by the equal-area criterion:
 * cos δ_cr = [P_m (δ_max − δ0) + P3 cos δ_max − P2 cos δ0] / (P3 − P2).
 * Returns ok = false (dcr NaN) when there is no post-fault equilibrium, or when |cos δ_cr| > 1 (P2 so large that the fault alone cannot drive the rotor past δ_max).
 */
export function criticalAngle(Pm: number, P1: number, P2: number, P3: number): { dcr: number; ok: boolean; cosDcr: number } {
  const d0 = delta0(Pm, P1)
  const dm = deltaMax(Pm, P3)
  if (!Number.isFinite(d0) || !Number.isFinite(dm) || P3 <= P2) return { dcr: NaN, ok: false, cosDcr: NaN }
  const c = (Pm * (dm - d0) + P3 * Math.cos(dm) - P2 * Math.cos(d0)) / (P3 - P2)
  if (c > 1 || c < -1) return { dcr: NaN, ok: false, cosDcr: c }
  return { dcr: Math.acos(c), ok: true, cosDcr: c }
}

/** Critical clearing time for a fault with P2 = 0 (constant acceleration): t_cr = √(4H(δ_cr − δ0) / (ω_s P_m)) [s]. */
export function criticalTimeBusFault(f0: number, H: number, Pm: number, d0: number, dcr: number): number {
  return Math.sqrt((4 * H * (dcr - d0)) / (ws(f0) * Pm))
}

/** Angle reached at time t during a fault with P2 = 0, starting at rest from δ0: δ = δ0 + ω_s P_m t² / (4H) [rad]. */
export const angleDuringBusFault = (f0: number, H: number, Pm: number, d0: number, t: number) => d0 + (ws(f0) * Pm * t * t) / (4 * H)

/** Accelerating area A1 = ∫δ0→δc (P_m − P2 sin δ) dδ [pu·rad]. */
export const areaAcc = (Pm: number, P2: number, d0: number, dc: number) => Pm * (dc - d0) + P2 * (Math.cos(dc) - Math.cos(d0))

/** Decelerating area ∫δc→δx (P3 sin δ − P_m) dδ [pu·rad]. */
export const areaDec = (Pm: number, P3: number, dc: number, dx: number) => P3 * (Math.cos(dc) - Math.cos(dx)) - Pm * (dx - dc)

// ── simulation ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Disturbance = { kind: 'fault' } | { kind: 'step'; dPm: number } | { kind: 'none' }

export interface SwingRun {
  /** time [s] */
  t: number[]
  /** rotor angle [rad] */
  d: number[]
  /** speed deviation [rad/s, electrical] */
  w: number[]
  /** electrical power [pu] */
  pe: number[]
  /** 0 pre/none, 1 during fault, 2 post-fault */
  phase: number[]
  /** the run's power limits and parameters */
  lim: PowerLimits
  d0: number
  /** angle and speed at clearing (fault runs) */
  dc: number
  wc: number
  /** largest angle reached [rad] */
  dPeak: number
  /** time of the first forward peak (Δω returns to 0 after the disturbance), NaN if none */
  tPeak: number
  /** loss of synchronism: the angle passed the post-fault unstable equilibrium while still accelerating away */
  lost: boolean
  /** time at which δ passed π (or the unstable equilibrium), NaN when stable */
  tLost: number
  stable: boolean
}

export interface SimOptions {
  tEnd?: number
  h?: number
  /** stop as soon as the outcome is known (stable first swing or loss of synchronism) — used by searches */
  firstSwingOnly?: boolean
  /** keep every k-th sample (and the last) in the output arrays */
  keepEvery?: number
  /** stop integrating once δ exceeds this [rad] (the trajectory is gone) */
  dStop?: number
}

/** Simulate the SMIB after a disturbance at t = 0, starting from the pre-fault equilibrium. */
export function simulateSwing(p: SmibParams, dist: Disturbance = { kind: 'fault' }, opt: SimOptions = {}): SwingRun {
  const h0 = opt.h ?? 1e-3
  const tEnd = opt.tEnd ?? 3
  const keep = Math.max(1, opt.keepEvery ?? 1)
  const dStop = opt.dStop ?? 2 * Math.PI
  const lim = powerLimits(p)
  const W = ws(p.f0)
  const M = (2 * p.H) / W
  const d0 = delta0(p.Pm, lim.P1)
  const Pm = dist.kind === 'step' ? p.Pm + dist.dPm : p.Pm
  const isFault = dist.kind === 'fault'
  const tc = isFault ? Math.max(0, p.tc) : Infinity
  const Ppost = isFault ? lim.P3 : lim.P1
  const dU = deltaMax(Pm, Ppost)
  const out: SwingRun = {
    t: [],
    d: [],
    w: [],
    pe: [],
    phase: [],
    lim,
    d0,
    dc: NaN,
    wc: NaN,
    dPeak: d0,
    tPeak: NaN,
    lost: false,
    tLost: NaN,
    stable: true,
  }
  if (!Number.isFinite(d0)) {
    out.stable = false
    out.lost = true
    return out
  }
  const pmaxAt = (ph: number) => (ph === 1 ? lim.P2 : ph === 2 ? lim.P3 : lim.P1)
  const f = (ph: number, d: number, w: number): [number, number] => [w, (Pm - pmaxAt(ph) * Math.sin(d) - (p.D * w) / W) / M]
  const step = (ph: number, d: number, w: number, h: number): [number, number] => {
    const [a1, b1] = f(ph, d, w)
    const [a2, b2] = f(ph, d + (h / 2) * a1, w + (h / 2) * b1)
    const [a3, b3] = f(ph, d + (h / 2) * a2, w + (h / 2) * b2)
    const [a4, b4] = f(ph, d + h * a3, w + h * b3)
    return [d + (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4), w + (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4)]
  }
  let k = 0
  const push = (t: number, d: number, w: number, ph: number, force = false) => {
    if (force || k % keep === 0) {
      out.t.push(t)
      out.d.push(d)
      out.w.push(w)
      out.pe.push(pmaxAt(ph) * Math.sin(d))
      out.phase.push(ph)
    }
    k++
  }
  // segments: [0, tc) during fault, [tc, tEnd] post-fault (or one segment for a step / no disturbance)
  const segs: Array<{ ph: number; t1: number }> = isFault ? (tc > 0 ? [{ ph: 1, t1: Math.min(tc, tEnd) }] : []) : []
  if (!isFault || tc < tEnd) segs.push({ ph: isFault ? 2 : 0, t1: tEnd })
  let t = 0
  let d = d0
  let w = 0
  let prevW = 0
  let done = false
  if (isFault && tc === 0) {
    out.dc = d0
    out.wc = 0
  }
  for (const seg of segs) {
    if (done) break
    const n = Math.max(1, Math.ceil((seg.t1 - t) / h0 - 1e-9))
    const h = (seg.t1 - t) / n
    if (k === 0) push(t, d, w, seg.ph, true)
    for (let i = 0; i < n; i++) {
      ;[d, w] = step(seg.ph, d, w, h)
      t = seg.t1 - (n - i - 1) * h
      const last = i === n - 1
      if (d > out.dPeak) out.dPeak = d
      // first forward peak: Δω changes sign from + to − after the disturbance
      const peak = prevW > 0 && w <= 0
      if (peak && Number.isNaN(out.tPeak)) out.tPeak = t
      // a forward peak after clearing below the unstable equilibrium decides the first swing (D ≥ 0)
      if (peak && opt.firstSwingOnly && seg.ph !== 1) done = true
      prevW = w
      // loss of synchronism: past the unstable equilibrium of the network it is now in, still moving away
      if (!out.lost && seg.ph !== 1 && (!Number.isFinite(dU) || d > dU) && w > 0) {
        out.lost = true
        out.stable = false
      }
      if (out.lost && Number.isNaN(out.tLost)) out.tLost = t
      push(t, d, w, seg.ph, last)
      if (out.lost && (opt.firstSwingOnly || d > dStop)) {
        done = true
        break
      }
      if (done) break
    }
    if (isFault && seg.ph === 1) {
      out.dc = d
      out.wc = w
    }
  }
  return out
}

/** Is the system stable when the fault is cleared at tc? (simulation, first swing decides; D ≥ 0) */
export function stableAt(p: SmibParams, tc: number, h = 1e-3): boolean {
  const r = simulateSwing({ ...p, tc }, { kind: 'fault' }, { tEnd: tc + 4, h, firstSwingOnly: true })
  return r.stable
}

/**
 * Critical clearing time found by simulation: scan forward for the first clearing time that loses synchronism,
 * then bisect. Returns Infinity when even a fault left on for `tMax` does not (at the scan resolution) lose it,
 * and NaN when no clearing time is stable (no post-fault equilibrium).
 */
export function criticalTimeBySim(p: SmibParams, opt: { tMax?: number; scan?: number; tol?: number; h?: number } = {}): number {
  const tMax = opt.tMax ?? 1.5
  const scan = opt.scan ?? 0.01
  const tol = opt.tol ?? 1e-5
  const h = opt.h ?? 1e-3
  if (!stableAt(p, 0, h)) return NaN
  let lo = 0
  let hi = NaN
  for (let tc = scan; tc <= tMax + 1e-12; tc += scan) {
    if (stableAt(p, tc, h)) lo = tc
    else {
      hi = tc
      break
    }
  }
  if (Number.isNaN(hi)) return Infinity
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2
    if (stableAt(p, mid, h)) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Angle at time t of the during-fault trajectory (simulation), for a clearing time study. */
export function angleAtTime(p: SmibParams, t: number, h = 1e-3): number {
  if (t <= 0) return delta0(p.Pm, powerLimits(p).P1)
  const r = simulateSwing({ ...p, tc: t }, { kind: 'fault' }, { tEnd: t, h })
  return r.d[r.d.length - 1]
}

/** Everything the page shows about a case: limits, angles, the equal-area numbers and both critical clearing times. */
export interface SmibSummary {
  lim: PowerLimits
  X: Reactances
  d0: number
  dMax: number
  dcr: number
  /** closed-form t_cr (P2 = 0 only), else NaN */
  tcrClosed: number
  /** t_cr by simulation (bisection) */
  tcrSim: number
  Ps: number
  wn: number
  fn: number
}

export function summarise(p: SmibParams): SmibSummary {
  const lim = powerLimits(p)
  const X = reactances(p)
  const d0 = delta0(p.Pm, lim.P1)
  const dMax = deltaMax(p.Pm, lim.P3)
  const { dcr } = criticalAngle(p.Pm, lim.P1, lim.P2, lim.P3)
  const tcrClosed = lim.P2 === 0 && Number.isFinite(dcr) ? criticalTimeBusFault(p.f0, p.H, p.Pm, d0, dcr) : NaN
  const tcrSim = Number.isFinite(d0) ? criticalTimeBySim(p, { tol: 2e-5 }) : NaN
  const Ps = syncPower(lim.P1, d0)
  const wn = naturalFreq(p.f0, p.H, Ps)
  return { lim, X, d0, dMax, dcr, tcrClosed, tcrSim, Ps, wn, fn: wn / (2 * Math.PI) }
}

/**
 * The oscillation frequency of a simulated run, from the zero crossings of δ − δ_ref (linear interpolation).
 * Returns NaN with fewer than three crossings.
 */
export function measuredFrequency(t: number[], d: number[], dRef: number): number {
  const z: number[] = []
  for (let i = 1; i < t.length; i++) {
    const a = d[i - 1] - dRef
    const b = d[i] - dRef
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) z.push(t[i - 1] + (a / (a - b)) * (t[i] - t[i - 1]))
  }
  if (z.length < 3) return NaN
  // half-periods between successive crossings
  const halfPeriod = (z[z.length - 1] - z[0]) / (z.length - 1)
  return 1 / (2 * halfPeriod)
}

/** The energy-like function along a run: ½·M·Δω² − ∫(P_m − P_e)dδ (trapezoid in δ), which is constant when D = 0. */
export function energyTrace(p: SmibParams, r: SwingRun, Pm = p.Pm): number[] {
  const M = (2 * p.H) / ws(p.f0)
  const out: number[] = []
  let integral = 0
  for (let i = 0; i < r.t.length; i++) {
    if (i > 0) {
      // ∫(P_m − P_e) dδ exactly within a segment of constant network: P_m·Δδ + Pmax·(cos δ_i − cos δ_{i−1})
      const ph = r.phase[i]
      const pmax = ph === 1 ? r.lim.P2 : ph === 2 ? r.lim.P3 : r.lim.P1
      integral += Pm * (r.d[i] - r.d[i - 1]) + pmax * (Math.cos(r.d[i]) - Math.cos(r.d[i - 1]))
    }
    out.push(0.5 * M * r.w[i] * r.w[i] - integral)
  }
  return out
}
