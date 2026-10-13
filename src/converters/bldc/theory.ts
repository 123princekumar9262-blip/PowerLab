import type { Mat } from '../expm.ts'
import { exactPwl, type PwlSystem } from '../pwl.ts'
import { averagedSteady, SECTORS, SHIFT, trap, trapSlope, type ResolvedBldc } from './model.ts'

/**
 * BLDC THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT (frozen speed): at constant speed ω the rotor angle is θ = 30° + p·ω·τ, so every back-EMF is a
 *    LINEAR function of time inside a Hall sector (the trapezoid's corners fall on the sector edges). With the
 *    time τ carried as a state, the phase equations are piecewise linear: the same Hall commutation and the same
 *    diode rules as the simulation, solved exactly by matrix exponentials (converters/pwl.ts → exactPwl), each
 *    diode turn-off found on the exact flow. The chopped switch is replaced by its mean voltage d·Vdc (the
 *    switching ripple is not in this theory). The periodic current waveform is the fixed point of the exact
 *    120° map (two sectors, then the phases rotate a→b→c), found by Newton; the speed is the one at which its
 *    mean torque balances TL + B·ω (Newton on ω as well). Means and extremes are read off the exact solution.
 * 2. TEXTBOOK: two phases in series carry I, flat back-EMFs, instant commutation:
 *      d·Vdc = 2·ke·ω + 2·R·I,   Te = 2·ke·I = TL + B·ω
 *    and, for the commutation, R neglected and the back-EMFs frozen at their flat values E = ke·ω:
 *      upper commutation (outgoing phase into the lower diode):  tc = 3·L·I/(d·Vdc + 2E),   ΔT/T = (d·Vdc − 4E)/(d·Vdc + 2E)
 *      lower commutation (outgoing phase into the upper diode):  tc = 3·L·I/((2 − d)·Vdc + 2E),   ΔT/T = (2d·Vdc − Vdc − 4E)/((2 − d)·Vdc + 2E)
 *    (at d = 1 both give the classic (Vdc − 4E)/(Vdc + 2E): no ripple only when Vdc = 4E).
 */

const DEG = Math.PI / 180

export interface BldcExact {
  converged: boolean
  w: number
  te: number
  idc: number
  iPair: number
  irms: number
  /** Torque extremes of the exact waveform, and of its average over one PWM period (chopping). */
  teMin: number
  teMax: number
  tavMin: number
  tavMax: number
  ripple: number
  tcUp: number | null
  tcLow: number | null
  /** Torque step over each commutation (T(end) − T(start))/T(start). */
  dipUp: number | null
  dipLow: number | null
  /** Phase currents at the start of sector 0 (θ = 30°) on the periodic orbit. */
  x0: number[]
  iterations: number
}

/** The frozen-speed electrical model over two sectors (θ from 30° to 150°), chopping averaged. */
function frozenSystem(p: ResolvedBldc, w: number, d: number): { sys: PwlSystem; T6: number; mode0: (x: number[]) => string } {
  const we = p.pp * w
  const T6 = (60 * DEG) / we
  const k = p.ke * w
  /** e_x = k·(α_x + β_x·τ) inside sector s (0 or 1). */
  const lin = (s: number) => {
    const thA = (30 + 60 * s) * DEG
    const thM = thA + 30 * DEG
    const alpha: number[] = []
    const beta: number[] = []
    for (let x = 0; x < 3; x++) {
      const sl = trapSlope(thM - SHIFT[x])
      // θ(τ) = 30° + we·τ (τ from the start of sector 0)
      alpha.push(trap(thM - SHIFT[x]) - sl * (thM - 30 * DEG))
      beta.push(sl * we)
    }
    return { alpha, beta }
  }
  const L = [lin(0), lin(1)]
  const cur = (x: number[], ph: number) => (ph === 0 ? x[0] : ph === 1 ? x[1] : -x[0] - x[1])
  const volts = (s: number, cond: string): Array<number | null> => {
    const sec = SECTORS[s]
    const v: Array<number | null> = [0, 0, 0]
    v[sec.hi] = d * p.vdc
    v[sec.lo] = 0
    v[sec.off] = cond === '+' ? 0 : cond === '-' ? p.vdc : null
    return v
  }
  /** Open-circuit voltage of the off phase (two phases conducting). */
  const vOpen = (s: number, x: number[]) => {
    const sec = SECTORS[s]
    const v = volts(s, '0')
    const tau = x[2]
    const e = (ph: number) => k * (L[s].alpha[ph] + L[s].beta[ph] * tau)
    const vn = ((v[sec.hi] as number) + (v[sec.lo] as number) - e(sec.hi) - e(sec.lo)) / 2
    return vn + e(sec.off)
  }
  const condFor = (s: number, x: number[], prev: string | null): string => {
    const off = SECTORS[s].off
    const i = cur(x, off)
    const scale = 1e-12 * (Math.abs(x[0]) + Math.abs(x[1]) + 1e-9)
    if (prev === '+' && i > 0) return '+'
    if (prev === '-' && i < 0) return '-'
    if (prev === null && Math.abs(i) > scale) return i > 0 ? '+' : '-'
    const vo = vOpen(s, x)
    if (vo > p.vdc) return '-'
    if (vo < 0) return '+'
    return '0'
  }
  const sys: PwlSystem = {
    n: 3,
    breakpoints: [T6],
    mode(x, t, prev) {
      const s = t < T6 ? 0 : 1
      const ps = prev ? Number(prev[0]) : -1
      return `${s}${condFor(s, x, ps === s ? prev[1] : null)}`
    },
    sys(mode) {
      const s = Number(mode[0])
      const cond = mode[1]
      const sec = SECTORS[s]
      const { alpha, beta } = L[s]
      const v = volts(s, cond)
      const A: Mat = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]
      const b = [0, 0, 1]
      if (cond !== '0') {
        // three phases conduct: vn = (Σv − Σe)/3
        const sv = (v[0] as number) + (v[1] as number) + (v[2] as number)
        const sa = alpha[0] + alpha[1] + alpha[2]
        const sb = beta[0] + beta[1] + beta[2]
        for (let ph = 0; ph < 2; ph++) {
          A[ph][ph] = -p.r / p.l
          A[ph][2] = (-k * (beta[ph] - sb / 3)) / p.l
          b[ph] = ((v[ph] as number) - sv / 3 - k * (alpha[ph] - sa / 3)) / p.l
        }
      } else {
        // two phases (p, q) in series, the off phase open
        const pq = [0, 1, 2].filter((ph) => ph !== sec.off)
        const [pp, qq] = pq
        const row = [0, 0, 0]
        const vpq = ((v[pp] as number) - (v[qq] as number)) / 2
        const a0 = (k * (alpha[pp] - alpha[qq])) / 2
        const b0 = (k * (beta[pp] - beta[qq])) / 2
        // the state of the conducting pair: its first phase's current (ia or ib)
        const st = pp // 0 or 1 (pp < qq, pp is never c)
        row[st] = -p.r / p.l
        row[2] = -b0 / p.l
        const bb = (vpq - a0) / p.l
        A[st] = row
        b[st] = bb
        // the second state: ib = −ia when c is the other conducting phase? (states are ia, ib; ic = −ia − ib)
        const other = 1 - st
        if (qq === other) {
          A[other] = row.map((z) => -z)
          b[other] = -bb
        } // else the other state is the open phase (a or b): it stays constant (zero)
      }
      return { A, b }
    },
  }
  return { sys, T6, mode0: (x) => `0${condFor(0, [...x, 0], null)}` }
}

/** The exact 120° map from θ = 30° (state [ia, ib]) to θ = 150°, rotated back to phase order. */
function sectorMap(p: ResolvedBldc, w: number, d: number) {
  const f = frozenSystem(p, w, d)
  return {
    ...f,
    map: (x: number[]) => {
      const y = exactPwl(f.sys, [x[0], x[1], 0], 0, [2 * f.T6], f.mode0(x)).x[0]
      // at 150° phase b plays a's role at 30°, c plays b's: ia(30°) ↔ ib(150°), ib(30°) ↔ ic(150°)
      return [y[1], -y[0] - y[1]]
    },
  }
}

function periodicCurrents(p: ResolvedBldc, w: number, d: number, guess: number[]): { x: number[]; iterations: number; residual: number } {
  const { map } = sectorMap(p, w, d)
  let x = [...guess]
  const sc = Math.max(Math.abs(guess[0]), Math.abs(guess[1]), 1e-3)
  let residual = Infinity
  let it = 0
  for (; it < 30; it++) {
    const fx = map(x)
    const r = [fx[0] - x[0], fx[1] - x[1]]
    residual = Math.max(Math.abs(r[0]), Math.abs(r[1])) / sc
    if (residual < 1e-12) break
    const h = 1e-7 * sc
    const J = [
      [0, 0],
      [0, 0],
    ]
    for (let j = 0; j < 2; j++) {
      const xp = [...x]
      xp[j] += h
      const fp = map(xp)
      for (let i = 0; i < 2; i++) J[i][j] = (fp[i] - xp[i] - r[i]) / h
    }
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0]
    if (!(Math.abs(det) > 0)) break
    let dx = [(-r[0] * J[1][1] + r[1] * J[0][1]) / det, (-J[0][0] * r[1] + J[1][0] * r[0]) / det]
    // damp large steps (the map is only piecewise smooth)
    const big = Math.max(Math.abs(dx[0]), Math.abs(dx[1])) / sc
    if (big > 0.5) dx = dx.map((z) => (z * 0.5) / big)
    x = [x[0] + dx[0], x[1] + dx[1]]
  }
  return { x, iterations: it, residual }
}

interface Waveform {
  t: number[]
  te: number[]
  pdc: number[]
  i2: number[]
  events: Array<{ t: number; from: string; to: string }>
  T6: number
}

/** The exact periodic waveform over 120°: torque, DC power and Σi² on a dense grid that includes every event. */
function waveform(p: ResolvedBldc, w: number, d: number, x0: number[], N = 1200): Waveform {
  const f = frozenSystem(p, w, d)
  const T = 2 * f.T6
  const first = exactPwl(f.sys, [x0[0], x0[1], 0], 0, [T], f.mode0(x0))
  const times = new Set<number>()
  for (let i = 1; i <= N; i++) times.add((i * T) / N)
  for (const e of first.events) times.add(e.t)
  times.add(f.T6)
  const ts = [...times].filter((t) => t > 0 && t <= T).sort((a, b) => a - b)
  const ex = exactPwl(f.sys, [x0[0], x0[1], 0], 0, ts, f.mode0(x0))
  const out: Waveform = { t: [0], te: [], pdc: [], i2: [], events: first.events, T6: f.T6 }
  const at = (x: number[], tau: number, mode: string) => {
    const th = 30 * DEG + p.pp * w * tau
    const i = [x[0], x[1], -x[0] - x[1]]
    const s = Number(mode[0])
    const sec = SECTORS[s]
    let te = 0
    for (let ph = 0; ph < 3; ph++) te += p.ke * trap(th - SHIFT[ph]) * i[ph]
    // DC power Σ v·i with the chopped leg at its mean d·Vdc and a diode leg at its rail
    const v = [0, 0, 0]
    v[sec.hi] = d * p.vdc
    v[sec.off] = mode[1] === '-' ? p.vdc : 0
    const pdc = mode[1] === '0' ? v[sec.hi] * i[sec.hi] : v[0] * i[0] + v[1] * i[1] + v[2] * i[2]
    return { te, pdc, i2: i[0] * i[0] + i[1] * i[1] + i[2] * i[2] }
  }
  const s0 = at([x0[0], x0[1], 0], 0, f.mode0(x0))
  out.te.push(s0.te)
  out.pdc.push(s0.pdc)
  out.i2.push(s0.i2)
  ts.forEach((t, i) => {
    const v = at(ex.x[i], t, ex.modes[i])
    out.t.push(t)
    out.te.push(v.te)
    out.pdc.push(v.pdc)
    out.i2.push(v.i2)
    // at the sector edge the DC power jumps (the leg leaving its lower switch now returns current through its
    // upper diode): add the right-hand value at the same instant
    if (Math.abs(t - f.T6) <= 1e-12 * f.T6 && i + 1 < ts.length) {
      const w2 = at(ex.x[i], t, f.sys.mode(ex.x[i], 0.5 * (t + ts[i + 1]), ex.modes[i]))
      out.t.push(t)
      out.te.push(w2.te)
      out.pdc.push(w2.pdc)
      out.i2.push(w2.i2)
    }
  })
  return out
}

const trapzMean = (t: number[], y: number[]) => {
  let a = 0
  for (let i = 1; i < t.length; i++) a += 0.5 * (y[i] + y[i - 1]) * (t[i] - t[i - 1])
  return a / (t[t.length - 1] - t[0])
}

/** Mean torque of the periodic orbit at speed w (and the orbit). */
function meanTorque(p: ResolvedBldc, w: number, d: number, guess: number[]) {
  const pc = periodicCurrents(p, w, d, guess)
  const wf = waveform(p, w, d, pc.x, 600)
  return { te: trapzMean(wf.t, wf.te), x: pc.x, it: pc.iterations, residual: pc.residual }
}

/** EXACT frozen-speed steady state at the run's final duty and load. */
export function exactBldc(p: ResolvedBldc): BldcExact {
  const d = p.duties[p.periods - 1]
  const tl = p.event === 'load' ? p.tl2 : p.tl
  const av = averagedSteady(p, d, tl)
  if (!(av.w > 0)) return { converged: false, w: NaN, te: NaN, idc: NaN, iPair: NaN, irms: NaN, teMin: NaN, teMax: NaN, tavMin: NaN, tavMax: NaN, ripple: NaN, tcUp: null, tcLow: null, dipUp: null, dipLow: null, x0: [0, 0], iterations: 0 }
  // secant on g(ω) = T̄(ω) − TL − B·ω, bracketed (T̄ falls with speed)
  let guess = [0, -av.i]
  const g = (w: number) => {
    const m = meanTorque(p, w, d, guess)
    if (m.residual < 1e-8) guess = m.x
    return { g: m.te - tl - p.b * w, ...m }
  }
  let w0 = 0.9 * av.w
  let w1 = av.w
  let g0 = g(w0).g
  let g1 = g(w1).g
  let iterations = 0
  for (; iterations < 40 && Math.abs(w1 - w0) > 1e-12 * Math.abs(w1); iterations++) {
    let w2 = w1 - (g1 * (w1 - w0)) / (g1 - g0)
    if (!Number.isFinite(w2) || w2 <= 0) w2 = 0.5 * w1
    w0 = w1
    g0 = g1
    w1 = w2
    g1 = g(w1).g
    if (Math.abs(g1) < 1e-13 * Math.max(tl, 1e-6)) break
  }
  const w = w1
  const pc = periodicCurrents(p, w, d, guess)
  const wf = waveform(p, w, d, pc.x)
  const te = trapzMean(wf.t, wf.te)
  const pdc = trapzMean(wf.t, wf.pdc)
  const irms = Math.sqrt(trapzMean(wf.t, wf.i2) / 3)
  let teMin = Infinity
  let teMax = -Infinity
  for (const v of wf.te) {
    teMin = Math.min(teMin, v)
    teMax = Math.max(teMax, v)
  }
  // average over one PWM period (periodic extension of the 120° waveform)
  const T = 2 * wf.T6
  const cum = [0]
  for (let i = 1; i < wf.t.length; i++) cum.push(cum[i - 1] + 0.5 * (wf.te[i] + wf.te[i - 1]) * (wf.t[i] - wf.t[i - 1]))
  const total = cum[cum.length - 1]
  const C = (t: number) => {
    const n = Math.floor(t / T)
    const u = t - n * T
    let lo = 0
    let hi = wf.t.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (wf.t[mid] <= u) lo = mid
      else hi = mid
    }
    const f = (u - wf.t[lo]) / Math.max(wf.t[hi] - wf.t[lo], 1e-300)
    // within a grid interval the torque is close to linear: integrate the linear interpolant
    const part = (wf.te[lo] + 0.5 * f * (wf.te[hi] - wf.te[lo])) * (u - wf.t[lo])
    return n * total + cum[lo] + part
  }
  let tavMin = Infinity
  let tavMax = -Infinity
  for (const t of wf.t) {
    const v = (C(t + T) - C(t + T - p.period)) / p.period
    tavMin = Math.min(tavMin, v)
    tavMax = Math.max(tavMax, v)
  }
  const pwm = p.chop === 'pwm' && d < 1
  const ripple = pwm ? (tavMax - tavMin) / te : (teMax - teMin) / te
  // commutation times: the off phase's current reaching zero after each sector start
  const tcUp = wf.events.find((e) => e.t < wf.T6 && e.from === '0+' && e.to !== '0+')?.t ?? null
  const low = wf.events.find((e) => e.t >= wf.T6 && e.from === '1-' && e.to !== '1-')
  const tcLow = low ? low.t - wf.T6 : null
  // the torque on the exact waveform at a commutation's start and end (both instants are grid points)
  const teAt = (t: number, last: boolean) => {
    let idx = -1
    for (let i = 0; i < wf.t.length; i++) if (Math.abs(wf.t[i] - t) <= 1e-12 * T) idx = last || idx < 0 ? i : idx
    return idx >= 0 ? wf.te[idx] : NaN
  }
  const dipUp = tcUp !== null ? (teAt(tcUp, false) - wf.te[0]) / wf.te[0] : null
  const t0Low = teAt(wf.T6, true)
  const dipLow = tcLow !== null ? (teAt(wf.T6 + tcLow, false) - t0Low) / t0Low : null
  return { converged: pc.residual < 1e-8, w, te, idc: pdc / p.vdc, iPair: pdc / p.vdc / d, irms, teMin, teMax, tavMin, tavMax, ripple, tcUp, tcLow, dipUp, dipLow, x0: pc.x, iterations }
}

export interface BldcTextbook {
  w: number
  i: number
  e: number
  tcUp: number
  tcLow: number
  dipUp: number
  dipLow: number
  ripple: number
}
/** TEXTBOOK: the averaged pair model and the classic commutation formulas (R neglected, flat EMFs). */
export function textbookBldc(p: ResolvedBldc): BldcTextbook {
  const d = p.duties[p.periods - 1]
  const tl = p.event === 'load' ? p.tl2 : p.tl
  const av = averagedSteady(p, d, tl)
  const E = p.ke * av.w
  const V = p.vdc
  const tcUp = (3 * p.l * av.i) / (d * V + 2 * E)
  const tcLow = (3 * p.l * av.i) / ((2 - d) * V + 2 * E)
  const dipUp = (d * V - 4 * E) / (d * V + 2 * E)
  const dipLow = (2 * d * V - V - 4 * E) / ((2 - d) * V + 2 * E)
  return { w: av.w, i: av.i, e: E, tcUp, tcLow, dipUp, dipLow, ripple: Math.max(Math.abs(dipUp), Math.abs(dipLow)) }
}
