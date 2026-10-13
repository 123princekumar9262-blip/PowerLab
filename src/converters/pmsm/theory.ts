import { affineFlow, expm, type Mat } from '../expm.ts'
import { exactPwl, type PwlSystem } from '../pwl.ts'
import { loadAt, measureCore, wRefAt, type CoreMeasures, type PmsmRun, type ResolvedPmsm } from './model.ts'

/**
 * PMSM THEORY — independent of the time-stepping simulation.
 *
 * 1. STEADY STATE (closed form): the d–q equations with d/dt = 0 at the final reference speed ω (the speed PI's
 *    integral removes any speed error):
 *      Te = 1.5·p·(ψ + (Ld − Lq)·id)·iq = TL + B·ω,   vd = R·id − ωe·Lq·iq,   vq = R·iq + ωe·(Ld·id + ψ)
 *    with id = 0, or — field weakening — the id ≤ 0 that puts |v| on the controller's target 0.95·Vdc/√3.
 * 2. DYNAMICS (exact): with decoupling and id = 0 the cross terms cancel and the loop is LINEAR:
 *      Lq·diq/dt = Kp·(iq* − iq) + xq − R·iq,  dxq/dt = Ki·(iq* − iq),  J·dω/dt = kt·iq − B·ω − TL,
 *      iq* = Kpω·(ω* − ω) + xω,  dxω/dt = Kiω·(ω* − ω)
 *    — piecewise linear with the current limit (iq* = ±Imax, integrator frozen). It is solved exactly by matrix
 *    exponentials (converters/pwl.ts → exactPwl), the limit exits located on the exact flow, and measured with the
 *    same functions as the simulation. It does not apply with decoupling off, with field weakening active, or
 *    when the voltage limit is reached (the rows then say so).
 * 3. TEXTBOOK: kt = 1.5·p·ψ; the PI zero cancels the winding pole (Ki/Kp = R/L), so the closed current loop is
 *    ωc/(s + ωc): 10–90 % rise ln 9/ωc; ideal current loop ⇒ speed loop s² + 2ζωs·s + ωs² with a zero:
 *    13.5 % overshoot at t = 2/ωs for ζ = 1, load-step dip ΔTL/(e·J·ωs).
 */

export interface PmsmSteady {
  w: number
  id: number
  iq: number
  vd: number
  vq: number
  v: number
  te: number
  iAmp: number
  /** The voltage target can be met within the current limit. */
  feasible: boolean
  fw: boolean
}

export function steadyPmsm(p: ResolvedPmsm, w: number, tl: number): PmsmSteady {
  const we = p.pp * w
  const T = tl + p.b * w
  const iqOf = (id: number) => T / (1.5 * p.pp * (p.psi + (p.ld - p.lq) * id))
  const volts = (id: number) => {
    const iq = iqOf(id)
    const vd = p.r * id - we * p.lq * iq
    const vq = p.r * iq + we * (p.ld * id + p.psi)
    return { iq, vd, vq, v: Math.hypot(vd, vq) }
  }
  let id = 0
  let feasible = true
  let fw = false
  if (p.control === 'fw' && volts(0).v > p.vfw) {
    fw = true
    let lo = p.idMin
    let hi = 0
    if (volts(lo).v > p.vfw) feasible = false
    else
      for (let it = 0; it < 100; it++) {
        const mid = 0.5 * (lo + hi)
        if (volts(mid).v > p.vfw) hi = mid
        else lo = mid
      }
    id = 0.5 * (lo + hi)
  } else if (volts(0).v > p.vmax) feasible = false
  const v = volts(id)
  if (Math.hypot(id, v.iq) > p.imax) feasible = false
  return { w, id, iq: v.iq, vd: v.vd, vq: v.vq, v: v.v, te: T, iAmp: Math.hypot(id, v.iq), feasible, fw }
}

/**
 * The decoupled, id = 0 closed loop as a piecewise-linear system: x = [iq, xq, ω, xω]; modes l (linear),
 * p / n (at the ± current limit, integrator frozen) and ps / ns (sliding along the limit: the integrator keeps
 * the PI output on it) — the same regime rule as the simulation.
 */
export function loopSystem(p: ResolvedPmsm): PwlSystem {
  const lim = p.imax
  /** The regime on side s at the limit (same rule as model.ts → satChoice, iq limit constant). */
  const choose = (x: number[], t: number, s: 1 | -1) => {
    const wdot = (p.kt * x[0] - p.b * x[2] - loadAt(p, t)) / p.j
    const e = wRefAt(p, t) - x[2]
    const a = s * (-p.kpw * wdot)
    const b = s * (-p.kpw * wdot + p.kiw * e)
    return { a, b, mode: a >= 0 ? (s > 0 ? 'p' : 'n') : b <= 0 ? 'l' : s > 0 ? 'ps' : 'ns' }
  }
  return {
    n: 4,
    breakpoints: [p.t1, p.t2].filter((x): x is number => x !== null),
    mode(x, t, prev) {
      const u = p.kpw * (wRefAt(p, t) - x[2]) + x[3]
      if (prev === 'p') return u < lim ? choose(x, t, 1).mode : 'p'
      if (prev === 'n') return u > -lim ? choose(x, t, -1).mode : 'n'
      if (prev === 'ps' || prev === 'ns') {
        const c = choose(x, t, prev === 'ps' ? 1 : -1)
        return c.a > 0 ? (prev === 'ps' ? 'p' : 'n') : c.b < 0 ? 'l' : prev
      }
      // from the linear regime: crossing the limit (u just beyond it) follows the regime rule; a jump far beyond
      // it (an input step) freezes the integrator until the output returns to the limit — as in the simulation
      const tolU = 1e-9 * lim
      if (u > lim + tolU) return prev === 'l' && u < lim * (1 + 1e-6) ? (choose(x, t, 1).mode === 'ps' ? 'ps' : 'p') : 'p'
      if (u < -lim - tolU) return prev === 'l' && u > -lim * (1 + 1e-6) ? (choose(x, t, -1).mode === 'ns' ? 'ns' : 'n') : 'n'
      return 'l'
    },
    sys(mode, t) {
      const wr = wRefAt(p, t)
      const tl = loadAt(p, t)
      const L = p.lq
      const A: Mat = [
        [-(p.kpq + p.r) / L, 1 / L, 0, 0],
        [-p.ki, 0, 0, 0],
        [p.kt / p.j, 0, -p.b / p.j, 0],
        [0, 0, 0, 0],
      ]
      const b = [0, 0, -tl / p.j, 0]
      if (mode === 'l') {
        A[0][2] = (-p.kpq * p.kpw) / L
        A[0][3] = p.kpq / L
        A[1][2] = -p.ki * p.kpw
        A[1][3] = p.ki
        A[3][2] = -p.kiw
        b[0] = (p.kpq * p.kpw * wr) / L
        b[1] = p.ki * p.kpw * wr
        b[3] = p.kiw * wr
      } else {
        const s = mode[0] === 'p' ? lim : -lim
        b[0] = (p.kpq * s) / L
        b[1] = p.ki * s
        if (mode.length === 2) {
          // sliding: dxω/dt = Kpω·dω/dt keeps Kpω·(ω* − ω) + xω on the limit
          A[3] = [(p.kpw * p.kt) / p.j, 0, (-p.kpw * p.b) / p.j, 0]
          b[3] = (-p.kpw * tl) / p.j
        }
      }
      return { A, b }
    },
  }
}

export interface PmsmExact extends CoreMeasures {
  /** Theory trajectory at the simulation's sample times. */
  w: Float64Array
  iq: Float64Array
  tDesat: number | null
}

/** The exact one-step map x ↦ e^(A·h)·x + ∫e^(A·τ)dτ·b as a flat (n+1)² matrix (fast to apply). */
function exactStep(A: Mat, b: number[], h: number): Float64Array {
  const n = A.length
  const M: Mat = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i < n ? (j < n ? A[i][j] * h : b[i] * h) : 0)))
  const E = expm(M)
  const out = new Float64Array((n + 1) * (n + 1))
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out[i * (n + 1) + j] = E[i][j]
  return out
}
function apply(E: Float64Array, x: number[]): number[] {
  const n = x.length
  const y: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    let a = E[i * (n + 1) + n]
    for (let j = 0; j < n; j++) a += E[i * (n + 1) + j] * x[j]
    y[i] = a
  }
  return y
}

/**
 * The exact solution of a piecewise-linear system at equally spaced times (the run's samples): one matrix
 * exponential per mode and input segment, reused for every sample; a mode change inside a step is located by
 * bisection on the exact flow (fresh exponentials), as converters/pwl.ts → exactPwl does. Same mathematics as
 * exactPwl, organised for thousands of equally spaced targets (tests check the two agree).
 */
export function exactOnGrid(sys: PwlSystem, x0: number[], dt: number, steps: number): { x: number[][]; events: Array<{ t: number; from: string; to: string }> } {
  const cache = new Map<string, Float64Array>()
  const bps = [...sys.breakpoints].sort((a, b) => a - b)
  const out: number[][] = [x0]
  const events: Array<{ t: number; from: string; to: string }> = []
  let x = x0
  let mode = sys.mode(x0, 0, '')
  for (let k = 1; k <= steps; k++) {
    const ta = (k - 1) * dt
    const tb = k * dt
    const cuts = [ta, ...bps.filter((t) => t > ta + 1e-12 * dt && t < tb - 1e-12 * dt), tb]
    for (let c = 0; c + 1 < cuts.length; c++) {
      let t = cuts[c]
      const tEnd = cuts[c + 1]
      const tIn = 0.5 * (t + tEnd)
      const m0 = sys.mode(x, tIn, mode)
      if (m0 !== mode) {
        events.push({ t, from: mode, to: m0 })
        mode = m0
      }
      for (let guard = 0; guard < 8 && t < tEnd - 1e-15 * tEnd; guard++) {
        const h = tEnd - t
        const { A, b } = sys.sys(mode, tIn)
        const full = Math.abs(h - dt) < 1e-9 * dt
        const key = `${mode}|${b.join(',')}`
        let E = full ? cache.get(key) : undefined
        if (!E) {
          E = exactStep(A, b, h)
          if (full) cache.set(key, E)
        }
        const y = apply(E, x)
        if (sys.mode(y, tIn, mode) === mode) {
          x = y
          t = tEnd
          break
        }
        // bisection on the exact flow for the first instant in the new mode
        let lo = 0
        let hi = h
        let yHi = y
        for (let it = 0; it < 60; it++) {
          const mid = 0.5 * (lo + hi)
          const ym = apply(exactStep(A, b, mid), x)
          if (sys.mode(ym, tIn, mode) === mode) lo = mid
          else {
            hi = mid
            yHi = ym
          }
        }
        x = yHi
        t += hi
        const next = sys.mode(x, tIn, mode)
        events.push({ t, from: mode, to: next })
        mode = next
      }
    }
    out.push(x)
  }
  return { x: out, events }
}

export interface PmsmExact extends CoreMeasures {
  /** Theory trajectory at the simulation's sample times. */
  w: Float64Array
  iq: Float64Array
  tDesat: number | null
}

/** EXACT closed-loop response at the run's sample times (decoupled, id = 0, no voltage limit). */
export function exactPmsm(r: PmsmRun): PmsmExact {
  const p = r.params
  const sys = loopSystem(p)
  const ex = exactOnGrid(sys, [0, 0, 0, 0], p.dt, r.length - 1)
  const n = r.length
  const w = new Float64Array(n)
  const iq = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    w[k] = ex.x[k][2]
    iq[k] = ex.x[k][0]
  }
  const core = measureCore(p, r.time, w, iq, new Float64Array(n))
  const unsat = ex.events.find((e) => e.from !== 'l' && e.to === 'l')
  return { ...core, w, iq, tDesat: unsat ? unsat.t : null }
}

/** Cross-check with the shared toolkit: exactPwl at a few instants. */
export function exactPwlAt(p: ResolvedPmsm, times: number[]): number[][] {
  const sys = loopSystem(p)
  const x0 = [0, 0, 0, 0]
  return exactPwl(sys, x0, 0, times, sys.mode(x0, 0, '')).x
}

export interface PmsmTextbook {
  kt: number
  iqRise: number
  /** Ideal current loop: speed-step overshoot and its time, load-step dip and its time. */
  overshoot: number | null
  tPeak: number | null
  dip: number | null
  tDip: number | null
  /** Constant-torque acceleration at the current limit to 90 % of the first reference. */
  t90: number | null
}

/** The speed loop with an ideal (instant) current loop: x = [ω, xω], iq = iq*. */
function idealSpeedLoop(p: ResolvedPmsm, wr: number, tl: number) {
  const A: Mat = [
    [-(p.b + p.kt * p.kpw) / p.j, p.kt / p.j],
    [-p.kiw, 0],
  ]
  const b = [(p.kt * p.kpw * wr - tl) / p.j, p.kiw * wr]
  return { A, b }
}

export function textbookPmsm(p: ResolvedPmsm): PmsmTextbook {
  const iqRise = Math.log(9) / p.wc
  // the steady state of the ideal loop before a step: ω = ω*, xω = (TL + B·ω)/kt
  const ss = (w: number, tl: number) => [w, (tl + p.b * w) / p.kt]
  const horizon = 12 / Math.min(p.ws * p.zeta, p.ws)
  const N = 4000
  const run = (x0: number[], wr: number, tl: number, pick: (w: number) => number) => {
    const { A, b } = idealSpeedLoop(p, wr, tl)
    const f = affineFlow(A, b, horizon / N)
    let x = x0
    let best = pick(x[0])
    let tBest = 0
    for (let i = 1; i <= N; i++) {
      x = f(x)
      const v = pick(x[0])
      if (v > best) {
        best = v
        tBest = (i * horizon) / N
      }
    }
    return { best, tBest }
  }
  let overshoot: number | null = null
  let tPeak: number | null = null
  if (p.t1 !== null && p.w2 !== p.w1) {
    const up = p.w2 > p.w1
    const res = run(ss(p.w1, p.tl), p.w2, p.tl, (w) => (up ? w : -w))
    overshoot = ((up ? res.best : -res.best) - p.w2) / (p.w2 - p.w1)
    tPeak = res.tBest
  }
  let dip: number | null = null
  let tDip: number | null = null
  if (p.t2 !== null) {
    const wr = p.t1 !== null && p.t1 < p.t2 ? p.w2 : p.w1
    const down = p.tl2 >= p.tl
    const res = run(ss(wr, p.tl), wr, p.tl2, (w) => (down ? wr - w : w - wr))
    dip = res.best
    tDip = res.tBest
  }
  const net = p.kt * p.imax - p.tl
  let t90: number | null = null
  if (net > 0) {
    const target = 0.9 * p.w1
    if (p.b > 0) {
      const wInf = net / p.b
      t90 = target < wInf ? -(p.j / p.b) * Math.log(1 - target / wInf) : null
    } else t90 = (p.j * target) / net
  }
  return { kt: p.kt, iqRise, overshoot, tPeak, dip, tDip, t90 }
}
