/*
 * Frequency control of one area (all generators lumped into one equivalent machine), linearised, per unit on the
 * system base. Δf is in pu of f₀ inside the model and converted to Hz for display.
 *
 *   inertia + load       2H · dΔf/dt   = ΔP_m − ΔP_L − D·Δf
 *   governor (droop R)   T_g · dΔP_v/dt = ΔP_ref − Δf/R − ΔP_v
 *   turbine              T_t · dΔP_m/dt = ΔP_v − ΔP_m
 *   AGC (secondary)      dΔP_ref/dt    = −K_I · β · Δf,   β = D + 1/R  (area control error ACE = β·Δf, one area)
 *
 * Units: H [s] (MJ/MVA on the system base), D [pu power / pu frequency], R [pu frequency / pu power], T_g, T_t [s],
 * K_I [1/s], ΔP_L [pu of the system base, a step at t = 0].
 * Results: RoCoF(0) = −ΔP_L·f₀/(2H) [Hz/s]; without AGC Δf_ss = −ΔP_L/(D + 1/R) [pu] (× f₀ for Hz); with AGC Δf → 0.
 * Assumes: small deviations (linear), a non-reheat steam turbine as one first-order lag, one area (no tie lines),
 * no governor dead band or rate limits, no under-frequency load shedding. Integrated with RK4 at a fixed step.
 */

export interface FreqParams {
  f0: number
  H: number
  D: number
  R: number
  Tg: number
  Tt: number
  /** load step [pu] */
  dPL: number
  agc: boolean
  Ki: number
}

export const FREQ0: FreqParams = { f0: 50, H: 5, D: 1, R: 0.05, Tg: 0.2, Tt: 0.5, dPL: 0.1, agc: false, Ki: 0.1 }

export interface FreqRun {
  t: number[]
  /** Δf [Hz] */
  df: number[]
  /** ΔP_m [pu] */
  dPm: number[]
  /** ΔP_ref (AGC set-point change) [pu] */
  dPref: number[]
  /** initial rate of change of frequency from the simulation (first step) [Hz/s] */
  rocofSim: number
  /** lowest frequency deviation [Hz] and when */
  nadir: number
  tNadir: number
  /** the deviation at the end of the run [Hz] */
  end: number
  /** with AGC: the time after the nadir at which |Δf| last falls to within 5 % of |nadir| (NaN if not within the run) */
  tRecover: number
}

type State = [number, number, number, number] // Δf (pu), ΔP_m, ΔP_v, ΔP_ref

export function derivative(p: FreqParams, x: State): State {
  const [df, pm, pv, pref] = x
  const beta = p.D + 1 / p.R
  return [(pm - p.dPL - p.D * df) / (2 * p.H), (pv - pm) / p.Tt, (pref - df / p.R - pv) / p.Tg, p.agc ? -p.Ki * beta * df : 0]
}

/** Analytical results. */
export const rocof0 = (p: FreqParams) => (-p.dPL * p.f0) / (2 * p.H) // Hz/s
export const steadyStatePu = (p: FreqParams) => (p.agc ? 0 : -p.dPL / (p.D + 1 / p.R))
export const steadyStateHz = (p: FreqParams) => steadyStatePu(p) * p.f0
/** Of the load step, what the generators pick up and what the load relief (D·Δf) covers, without AGC [pu]. */
export function shareWithoutAgc(p: FreqParams): { gen: number; load: number } {
  const df = -p.dPL / (p.D + 1 / p.R)
  return { gen: -df / p.R, load: -p.D * df }
}

export function simulateFrequency(p: FreqParams, opt: { tEnd?: number; h?: number; keepEvery?: number } = {}): FreqRun {
  const tEnd = opt.tEnd ?? 30
  const h = opt.h ?? 0.01
  const keep = Math.max(1, opt.keepEvery ?? 1)
  const n = Math.round(tEnd / h)
  let x: State = [0, 0, 0, 0]
  const out: FreqRun = { t: [0], df: [0], dPm: [0], dPref: [0], rocofSim: NaN, nadir: 0, tNadir: 0, end: 0, tRecover: NaN }
  const add = (a: State, b: State, k: number): State => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2], a[3] + k * b[3]]
  let prev = 0
  for (let i = 1; i <= n; i++) {
    const k1 = derivative(p, x)
    const k2 = derivative(p, add(x, k1, h / 2))
    const k3 = derivative(p, add(x, k2, h / 2))
    const k4 = derivative(p, add(x, k3, h))
    x = [0, 1, 2, 3].map((j) => x[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) as State
    const t = i * h
    const dfHz = x[0] * p.f0
    if (i === 1) out.rocofSim = dfHz / h
    if (dfHz < out.nadir) {
      out.nadir = dfHz
      out.tNadir = t
    }
    if (i % keep === 0 || i === n) {
      out.t.push(t)
      out.df.push(dfHz)
      out.dPm.push(x[1])
      out.dPref.push(x[3])
    }
    prev = dfHz
  }
  out.end = prev
  // refine the nadir with a parabola through the three samples around it (sub-step accuracy)
  if (out.tNadir > 0 && out.tNadir < tEnd) {
    const r = simulateAround(p, out.tNadir, h)
    if (r) {
      out.nadir = r.v
      out.tNadir = r.t
    }
  }
  if (p.agc) {
    const thr = 0.05 * Math.abs(out.nadir)
    let last = NaN
    for (let i = out.t.length - 1; i >= 0; i--) {
      if (Math.abs(out.df[i]) > thr) {
        last = i < out.t.length - 1 ? out.t[i + 1] : NaN
        break
      }
    }
    out.tRecover = last
  }
  return out
}

/** Re-integrate up to the samples either side of the nadir and fit a parabola. */
function simulateAround(p: FreqParams, tN: number, h: number): { t: number; v: number } | null {
  const pts: number[] = []
  let x: State = [0, 0, 0, 0]
  const n = Math.round(tN / h) + 1
  const add = (a: State, b: State, k: number): State => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2], a[3] + k * b[3]]
  for (let i = 1; i <= n; i++) {
    const k1 = derivative(p, x)
    const k2 = derivative(p, add(x, k1, h / 2))
    const k3 = derivative(p, add(x, k2, h / 2))
    const k4 = derivative(p, add(x, k3, h))
    x = [0, 1, 2, 3].map((j) => x[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) as State
    if (i >= n - 2) pts.push(x[0] * p.f0)
  }
  if (pts.length !== 3) return null
  const [a, b, c] = pts
  const den = a - 2 * b + c
  if (den <= 0) return { t: tN, v: b }
  const off = (0.5 * (a - c)) / den // in steps, relative to the middle sample
  return { t: tN + off * h, v: b - 0.25 * (a - c) * off }
}
