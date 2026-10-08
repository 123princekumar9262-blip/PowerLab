import { affineFlow } from '../expm.ts'
import type { Mat } from '../expm.ts'
import { initialPi, idealDuty, operatingState, piStep, rAt, vinAt, vrefAt, type ResolvedControl } from './control.ts'

/**
 * CONTROL THEORY — independent of the switching simulation.
 *
 * 1. The AVERAGED model of the converter (ideal, CCM), advanced exactly over each switching period with
 *    the duty the same PI law computes from the averaged output at the period start:
 *      buck:  L·diL/dt = d·Vin − DCR·iL − v,        C·dv/dt = iL − v/R
 *      boost: L·diL/dt = Vin − DCR·iL − (1 − d)·v,  C·dv/dt = (1 − d)·iL − v/R
 *    With d and R constant inside a period both are linear: one matrix exponential per period (split at
 *    the load step).
 * 2. The small-signal LOOP GAIN T = Gc(z)·Gvd(jω)·ZOH(jω), z = e^(jωTs), with the discrete PID
 *      Gc(z) = Kp + Ki·Ts·z⁻¹/(1 − z⁻¹) + Kd·(1 − z⁻¹)/Ts,   ZOH = (1 − e^(−jωTs))/(jωTs)
 *    and the control-to-output transfer functions
 *      buck:  Gvd = Vin / (1 + jωL/R − ω²LC)
 *      boost: Gvd = (Vo/D')·(1 − jωL/(R·D'²)) / (1 + jωL/(R·D'²) − ω²LC/D'²),  D' = 1 − D  (RHP zero)
 *    → crossover frequency, phase margin, gain margin.
 * 3. Exact small-signal STABILITY of the sampled loop: the spectral radius of the linearised period map
 *    of the averaged model + PID (states iL, v, integrator, previous sample; |λ|max < 1 ⇔ stable).
 */

function plant(p: ResolvedControl, d: number, r: number, vin: number): { A: Mat; b: number[] } {
  if (p.kind === 'buck')
    return {
      A: [
        [-p.rl / p.l, -1 / p.l],
        [1 / p.c, -1 / (r * p.c)],
      ],
      b: [(d * vin) / p.l, 0],
    }
  const dp = 1 - d
  return {
    A: [
      [-p.rl / p.l, -dp / p.l],
      [dp / p.c, -1 / (r * p.c)],
    ],
    b: [vin / p.l, 0],
  }
}

/** Advance the averaged state over [t, t + h] with duty d (splitting at the load step). */
function advance(p: ResolvedControl, x: number[], t: number, h: number, d: number): number[] {
  const cuts = [t, t + h]
  for (const tc of [p.loadStep === 'on' ? p.tload : NaN, p.lineStep === 'on' ? p.tline : NaN]) if (tc > t && tc < t + h) cuts.push(tc)
  cuts.sort((a, b) => a - b)
  let y = x
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2
    const { A, b } = plant(p, d, rAt(p, mid), vinAt(p, mid))
    y = affineFlow(A, b, cuts[i + 1] - cuts[i])(y)
  }
  return y
}

export interface AveragedRun {
  /** Period-start times, averaged states, the controller's samples and outputs. */
  t: number[]
  il: number[]
  v: number[]
  d: number[]
  /** Average of v over each period (Simpson on the exact solution). */
  vavg: number[]
}

export function averagedRun(p: ResolvedControl): AveragedRun {
  const s = initialPi(p)
  let x = operatingState(p)
  const out: AveragedRun = { t: [], il: [], v: [], d: [], vavg: [] }
  for (let m = 0; m < p.periods; m++) {
    const t = m * p.ts
    const o = piStep(p, s, x[1], t)
    out.t.push(t)
    out.il.push(x[0])
    out.v.push(x[1])
    out.d.push(o.d)
    // Simpson average of v over the period from 4 sub-intervals of the exact flow.
    const pts = [x[1]]
    let y = x
    for (let j = 1; j <= 4; j++) {
      y = advance(p, y, t + ((j - 1) * p.ts) / 4, p.ts / 4, o.d)
      pts.push(y[1])
    }
    out.vavg.push((pts[0] + 4 * pts[1] + 2 * pts[2] + 4 * pts[3] + pts[4]) / 12)
    x = y
  }
  return out
}

/** Model output at any time (for the scope overlay): linear between period starts. */
export function averagedAt(run: AveragedRun, ts: number, t: number): number {
  const m = Math.min(run.t.length - 1, Math.max(0, Math.floor(t / ts)))
  const next = m + 1 < run.v.length ? run.v[m + 1] : run.v[m]
  const f = (t - m * ts) / ts
  return run.v[m] + (next - run.v[m]) * Math.min(1, Math.max(0, f))
}

export interface StepMetrics {
  /** Reference step: overshoot (fraction of the step), 2 % settling time [s], 10–90 % rise time [s]. */
  overshoot: number | null
  settling: number | null
  rise: number | null
  /** Load step: largest deviation of the averaged output [V] and the time to return within 1 % of Vref [s]. */
  loadDev: number | null
  recovery: number | null
  /** Steady-state error of the controller's samples at the end [V]. */
  ssError: number
  dFinal: number
}

/**
 * Transient metrics from a per-period series — the same function for the simulation and the model.
 * `avg` = per-period average output, `sampled` = the controller's samples.
 */
export function stepMetrics(p: ResolvedControl, t: number[], avg: number[], sampled: number[], d: number[]): StepMetrics {
  const idx = (time: number) => t.findIndex((x) => x >= time - 1e-12)
  const end = t.length
  let overshoot: number | null = null
  let settling: number | null = null
  let rise: number | null = null
  if (p.refStep === 'on' && p.dvref !== 0 && p.tref < p.duration) {
    const i0 = idx(p.tref)
    const i1 = p.loadStep === 'on' && p.tload > p.tref ? Math.max(i0 + 2, idx(p.tload)) : end
    const before = avg[Math.max(0, i0 - 1)]
    const tail = avg.slice(i0 + Math.floor((i1 - i0) * 0.8), i1)
    const final = tail.reduce((s, x) => s + x, 0) / Math.max(1, tail.length)
    const sgn = Math.sign(p.dvref)
    let peak = -Infinity
    for (let i = i0; i < i1; i++) peak = Math.max(peak, sgn * (avg[i] - final))
    overshoot = Math.max(0, peak) / Math.abs(p.dvref)
    const band = 0.02 * Math.abs(p.dvref)
    let last = i0
    for (let i = i0; i < i1; i++) if (Math.abs(avg[i] - final) > band) last = i + 1
    settling = last < i1 ? (t[last] ?? t[i1 - 1]) - p.tref : null
    const lvl = (f: number) => before + f * (final - before)
    const t10 = t.slice(i0, i1).find((_x, k) => sgn * (avg[i0 + k] - lvl(0.1)) >= 0)
    const t90 = t.slice(i0, i1).find((_x, k) => sgn * (avg[i0 + k] - lvl(0.9)) >= 0)
    rise = t10 !== undefined && t90 !== undefined ? t90 - t10 : null
  }
  let loadDev: number | null = null
  let recovery: number | null = null
  if (p.loadStep === 'on' && p.r2 !== p.r && p.tload < p.duration) {
    const i0 = idx(p.tload)
    const before = avg[Math.max(0, i0 - 1)]
    let dev = 0
    for (let i = i0; i < end; i++) if (Math.abs(avg[i] - before) > Math.abs(dev)) dev = avg[i] - before
    loadDev = dev
    const tail = avg.slice(end - Math.max(3, Math.floor((end - i0) * 0.1)))
    const final = tail.reduce((s, x) => s + x, 0) / tail.length
    const band = 0.01 * vrefAt(p, p.duration)
    let last = i0
    for (let i = i0; i < end; i++) if (Math.abs(avg[i] - final) > band) last = i + 1
    recovery = last < end ? (t[last] ?? t[end - 1]) - p.tload : null
  }
  const n = Math.min(10, sampled.length)
  const ssError = vrefAt(p, p.duration) - sampled.slice(-n).reduce((s, x) => s + x, 0) / n
  return { overshoot, settling, rise, loadDev, recovery, ssError, dFinal: d[d.length - 1] }
}

export interface LoopGain {
  /** Crossover frequency [Hz] (|T| = 1), phase margin [deg], gain margin [dB] (null if none). */
  fc: number | null
  pm: number | null
  gm: number | null
  /** Bode data. */
  f: number[]
  mag: number[]
  phase: number[]
  /** Right-half-plane zero (boost) [Hz]. */
  fRhp: number | null
  /** LC resonance of the averaged plant [Hz]. */
  f0: number
}

export function loopGain(p: ResolvedControl): LoopGain {
  const vo = vrefAt(p, 0)
  const D = idealDuty(p.kind, p.vin, vo)
  const dp = 1 - D
  const r = p.r
  const G = (w: number): [number, number] => {
    // complex numbers as [re, im]
    if (p.kind === 'buck') {
      const den: [number, number] = [1 - w * w * p.l * p.c, (w * p.l) / r]
      return cdiv([p.vin, 0], den)
    }
    const num: [number, number] = [vo / dp, (-(vo / dp) * w * p.l) / (r * dp * dp)]
    const den: [number, number] = [1 - (w * w * p.l * p.c) / (dp * dp), (w * p.l) / (r * dp * dp)]
    return cdiv(num, den)
  }
  const T = (f: number): [number, number] => {
    const w = 2 * Math.PI * f
    const th = w * p.ts
    const zi: [number, number] = [Math.cos(th), -Math.sin(th)] // z⁻¹
    const one_zi: [number, number] = [1 - zi[0], -zi[1]] // 1 − z⁻¹
    const integ = cmul([p.ki * p.ts, 0], cdiv(zi, one_zi))
    const deriv = cmul([p.kd / p.ts, 0], one_zi)
    const gc: [number, number] = p.loop === 'open' ? [0, 0] : [p.kp + integ[0] + deriv[0], integ[1] + deriv[1]]
    const zoh = cdiv(one_zi, [0, th])
    return cmul(cmul(gc, G(w)), zoh)
  }
  const f: number[] = []
  const mag: number[] = []
  const phase: number[] = []
  let ph0 = 0
  const fMax = p.fs / 2
  for (let i = 0; i <= 400; i++) {
    const fr = Math.exp(Math.log(1) + (i / 400) * (Math.log(fMax) - Math.log(1)))
    const z = T(fr)
    f.push(fr)
    mag.push(20 * Math.log10(Math.hypot(z[0], z[1]) + 1e-300))
    // unwrap the phase
    let ph = (Math.atan2(z[1], z[0]) * 180) / Math.PI
    if (i > 0) while (ph - ph0 > 180) ph -= 360
    if (i > 0) while (ph - ph0 < -180) ph += 360
    phase.push(ph)
    ph0 = ph
  }
  let fc: number | null = null
  let pm: number | null = null
  for (let i = 1; i < f.length; i++)
    if (mag[i - 1] >= 0 && mag[i] < 0) {
      const a = mag[i - 1] / (mag[i - 1] - mag[i])
      fc = Math.exp(Math.log(f[i - 1]) + a * (Math.log(f[i]) - Math.log(f[i - 1])))
      const ph = phase[i - 1] + a * (phase[i] - phase[i - 1])
      pm = 180 + ph
      break
    }
  let gm: number | null = null
  for (let i = 1; i < f.length; i++)
    if (phase[i - 1] > -180 && phase[i] <= -180) {
      const a = (phase[i - 1] + 180) / (phase[i - 1] - phase[i])
      gm = -(mag[i - 1] + a * (mag[i] - mag[i - 1]))
      break
    }
  return {
    fc,
    pm,
    gm,
    f,
    mag,
    phase,
    fRhp: p.kind === 'boost' ? (r * dp * dp) / (2 * Math.PI * p.l) : null,
    f0: (p.kind === 'buck' ? 1 : dp) / (2 * Math.PI * Math.sqrt(p.l * p.c)),
  }
}

const cmul = (a: [number, number], b: [number, number]): [number, number] => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
function cdiv(a: [number, number], b: [number, number]): [number, number] {
  const d = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}

/**
 * Exact small-signal stability of the sampled loop: the spectral radius of the period map
 * (iL, v, I) → (iL, v, I)' of the averaged model + PI, linearised at the final operating point
 * (finite differences, then ‖M^k·x‖^(1/k)).
 */
export function spectralRadius(p: ResolvedControl): number {
  // The loop must be stable at every operating point it visits: before and after the steps.
  return Math.max(radiusAt(p, 0), radiusAt(p, p.duration))
}

function radiusAt(p: ResolvedControl, at: number): number {
  if (p.loop === 'open') return NaN
  const vo = vrefAt(p, at)
  const r = rAt(p, at)
  const D = idealDuty(p.kind, p.vin, vo)
  const pp: ResolvedControl = { ...p, refStep: 'off', loadStep: 'off', vref: vo, r }
  // States: iL, v, integrator I, previous sample v[k−1]. Without integral action the integrator state is
  // a constant (eigenvalue 1 that is not a dynamic mode), so it is left out.
  const withI = p.ki > 0
  const map = (x: number[]) => {
    const [il, v, I, vp] = withI ? x : [x[0], x[1], D, x[2]]
    const e = vo - v
    const d = I + p.kp * e - (p.kd * (v - vp)) / p.ts // linearised: no saturation
    const y = advance(pp, [il, v], 0, p.ts, d)
    return withI ? [y[0], y[1], I + p.ki * p.ts * e, v] : [y[0], y[1], v]
  }
  const x0 = withI ? [p.kind === 'buck' ? vo / r : vo / r / (1 - D), vo, D, vo] : [p.kind === 'buck' ? vo / r : vo / r / (1 - D), vo, vo]
  const n = x0.length
  const f0 = map(x0)
  const scale = withI ? [Math.max(1e-3, Math.abs(x0[0])), Math.max(1e-3, vo), 0.01, Math.max(1e-3, vo)] : [Math.max(1e-3, Math.abs(x0[0])), Math.max(1e-3, vo), Math.max(1e-3, vo)]
  const M: number[][] = Array.from({ length: n }, () => [])
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * scale[j]
    const xp = [...x0]
    xp[j] += h
    const fp = map(xp)
    for (let i = 0; i < n; i++) M[i][j] = (fp[i] - f0[i]) / h
  }
  let v = Array.from({ length: n }, (_, i) => 1 / (i + 1))
  let logNorm = 0
  const K = 600
  for (let k = 0; k < K; k++) {
    const w = M.map((row) => row.reduce((s, m, j) => s + m * v[j], 0))
    const nn = Math.hypot(...w) || 1e-300
    if (k >= K / 2) logNorm += Math.log(nn)
    v = w.map((x) => x / nn)
  }
  return Math.exp(logNorm / (K / 2))
}
