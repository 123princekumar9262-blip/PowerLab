import type { Mat } from '../expm.ts'
import { exactPwl, simulatePwl, type PwlEvent, type PwlResult, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * DEVICES — POWER DIODE: static I–V and REVERSE RECOVERY in a clamped-inductive (double-pulse) commutation.
 *
 *   Vdc+ ── Ls ──┬── cathode │ DIODE (DUT) │ anode ──┬── switch node
 *                │                                 │
 *                └──── load inductor (current I0) ─┘        switch node ── switch Q ── Vdc−
 *
 * The load inductor holds I0 constant over the nanoseconds shown. Before the switch turns on, the diode
 * freewheels I0. At ton the switch turns on: the diode current falls (iD = I0 − iQ), goes negative while
 * the diode still holds stored charge, peaks at −Irr when the junction recovers, then decays (the tail).
 *
 * DIODE — two-region charge-control model (after Lauritzen & Ma, linearised):
 *   qM  stored charge in the lightly doped base (drift) region, lifetime τ
 *   qE  charge at the junction:  iD = (qE − qM)/T   (T: transit time base ↔ junction)
 *   dqM/dt = (qE − qM)/T − qM/τ = iD − qM/τ
 *   conducting (qE > 0): vAK = V0 + rd·iD — the tangent of the Shockley curve at I0 (PWL);
 *   recovered  (qE = 0): the junction blocks and iD = −qM/T: the remaining base charge decays as
 *                        dqM/dt = −qM/τrr, τrr = τ·T/(τ + T) — the soft recovery TAIL.
 *   Static curve: v = n·VT·ln(1 + i/Is) + Rs·i (Shockley + series resistance, 25 °C).
 *
 * SWITCH — gate-limited current rise: while its voltage stays above Ron·iQ the switch current rises at the
 * gate-set slope S ('sat'); otherwise it is the resistance Ron ('ohm') and the loop inductance alone sets
 * di/dt = (Vdc + vAK − Ron·iQ)/Ls ≈ Vdc/Ls. Once ohmic it stays ohmic.
 *
 * Neglected: junction and switch capacitances (no ringing — voltages transfer at once when the junction
 * recovers), temperature, conductivity modulation of Rs.
 *
 * State x = [iD, qM, qrr]; qrr = ∫(−iD)dt while iD < 0 (the recovered charge, an integrator state so the
 * exact solution gives it exactly). Each (diode region, switch region) is linear: a PWL hybrid system,
 * simulated (trapezoidal) and solved exactly (matrix exponential) by converters/pwl.ts.
 */
export interface DiodeParams {
  vdc: number
  i0: number
  /** Commutation-loop (stray) inductance [H]. */
  ls: number
  /** The switch's gate-controlled current slope S [A/s]. */
  didt: number
  /** Carrier lifetime τ [s]: stored charge ≈ τ·I0. */
  tau: number
  /** Transit time T [s]: sets the softness of the recovery (τrr = τT/(τ+T)). */
  tm: number
  /** Shockley saturation current [A], ideality n, series resistance [Ω]. */
  isat: number
  n: number
  rs: number
  /** Switch on-resistance [Ω]. */
  ron: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedDiode extends DiodeParams, RunParams {
  /** Thermal voltage at 25 °C [V]. */
  vt: number
  /** Forward voltage at I0 (Shockley), its tangent: vAK = v0 + rd·iD. */
  vf: number
  rd: number
  v0: number
  tauRR: number
  ton: number
  tend: number
  steps: number
  /** Stored charge at I0: base qM = τ·I0, junction qE = (τ + T)·I0. */
  qm0: number
}

export const DIODE_DEFAULTS: DiodeParams = {
  vdc: 400,
  i0: 20,
  ls: 100e-9,
  didt: 1000e6,
  tau: 25e-9,
  tm: 10e-9,
  isat: 1e-9,
  n: 1.8,
  rs: 0.01,
  ron: 0.01,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 6000,
}

export const DIODE_LIMITS = {
  vdc: { min: 20, max: 1200 },
  i0: { min: 1, max: 100 },
  ls: { min: 10e-9, max: 2e-6 },
  didt: { min: 50e6, max: 20000e6 },
  tau: { min: 5e-9, max: 500e-9 },
  tm: { min: 1e-9, max: 100e-9 },
  isat: { min: 1e-14, max: 1e-6 },
  n: { min: 1, max: 2.5 },
  rs: { min: 0, max: 0.2 },
  ron: { min: 1e-3, max: 0.5 },
}

/** Thermal voltage kT/q at 25 °C. */
export const VT_25C = (1.380649e-23 * 298.15) / 1.602176634e-19

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

/** Static forward voltage of the diode at current i (Shockley + series resistance). */
export const shockleyV = (p: { isat: number; n: number; rs: number }, i: number) => p.n * VT_25C * Math.log1p(i / p.isat) + p.rs * i

/**
 * The static I–V the other way round, i(v), from the implicit equation i = Is·(e^((v − Rs·i)/nVT) − 1)
 * solved by Newton's method (what a circuit simulator does for a DC sweep).
 */
export function diodeCurrentNewton(p: { isat: number; n: number; rs: number }, v: number): number {
  const nvt = p.n * VT_25C
  if (p.rs === 0) return p.isat * Math.expm1(v / nvt)
  // f(i) = i − Is·(e^((v − Rs·i)/nVT) − 1) is increasing and concave: from a start with f ≤ 0 (left of the
  // root) Newton converges monotonically without overshooting
  let i = v >= 0 ? 0 : -p.isat
  for (let it = 0; it < 200; it++) {
    const e = Math.exp(Math.min((v - p.rs * i) / nvt, 700))
    const f = i - p.isat * (e - 1)
    const df = 1 + (p.isat * e * p.rs) / nvt
    const di = f / df
    i -= di
    if (Math.abs(di) <= 1e-13 * Math.max(1, Math.abs(i))) break
  }
  return i
}

/** Lambert W (principal branch, x ≥ 0) by Halley's iteration — for the closed-form I–V. */
export function lambertW(x: number): number {
  if (x === 0) return 0
  // a start near the root: ln(1 + x) for small x, the asymptote ln x − ln ln x for large x
  let w = x < 3 ? 0.8 * Math.log1p(x) : Math.log(x) - Math.log(Math.log(x))
  for (let it = 0; it < 100; it++) {
    const ew = Math.exp(w)
    const f = w * ew - x
    const w1 = w + 1
    const dw = f / (ew * w1 - ((w + 2) * f) / (2 * w1))
    w -= dw
    if (Math.abs(dw) <= 1e-15 * Math.max(1, Math.abs(w))) break
  }
  return w
}

/** THEORY of the static curve: i(v) in closed form with the Lambert W function (Banwell & Jayakumaran). */
export function diodeCurrentLambert(p: { isat: number; n: number; rs: number }, v: number): number {
  const nvt = p.n * VT_25C
  if (p.rs === 0) return p.isat * Math.expm1(v / nvt)
  // i = (nVT/Rs)·W((Is·Rs/nVT)·e^((v + Is·Rs)/nVT)) − Is; the argument is formed in logs to avoid overflow
  const lnArg = Math.log((p.isat * p.rs) / nvt) + (v + p.isat * p.rs) / nvt
  let w: number
  if (lnArg < 500) w = lambertW(Math.exp(lnArg))
  else {
    // W(e^L) for huge L: solve w + ln w = L
    w = lnArg - Math.log(lnArg)
    for (let it = 0; it < 50; it++) w -= (w + Math.log(w) - lnArg) / (1 + 1 / w)
  }
  return (nvt / p.rs) * w - p.isat
}

/** A first estimate of the falling slope (gate- or loop-limited), for sizing the window. */
const slopeEstimate = (q: { didt: number; vdc: number; ls: number }) => Math.min(q.didt, q.vdc / q.ls)

/**
 * The recovery instant s (after ton) for a CONSTANT falling slope a, from the closed-form charge:
 * qM(s) = τ(I0 − a·s) + a·τ²(1 − e^(−s/τ)); the junction recovers when qM + T·iD = 0, i.e.
 * f(s) = (τ + T)(I0 − a·s) + a·τ²(1 − e^(−s/τ)) = 0  (one root after I0/a; Newton from the right).
 */
export function recoveryInstant(i0: number, a: number, tau: number, tm: number): number {
  const f = (s: number) => (tau + tm) * (i0 - a * s) + a * tau * tau * -Math.expm1(-s / tau)
  const df = (s: number) => -(tau + tm) * a + a * tau * Math.exp(-s / tau)
  // f is concave and decreasing after I0/a: start right of the root (where f < 0) and Newton converges monotonically
  let s = i0 / a + Math.sqrt((2 * (tau + tm) * i0) / a) + tau
  for (let g = 0; g < 60 && f(s) > 0; g++) s *= 2
  for (let it = 0; it < 100; it++) {
    const ds = f(s) / df(s)
    s -= ds
    if (Math.abs(ds) <= 1e-15 * s) break
  }
  return s
}

export function resolveDiode(input: Partial<DiodeParams>): { params: ResolvedDiode; issues: string[] } {
  const p = { ...DIODE_DEFAULTS, ...input }
  const issues: string[] = []
  const L = DIODE_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, DIODE_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = { vdc: c('vdc'), i0: c('i0'), ls: c('ls'), didt: c('didt'), tau: c('tau'), tm: c('tm'), isat: c('isat'), n: c('n'), rs: c('rs'), ron: c('ron') }
  const vt = VT_25C
  const vf = shockleyV(q, q.i0)
  const rd = (q.n * vt) / (q.i0 + q.isat) + q.rs
  const v0 = vf - rd * q.i0
  const tauRR = (q.tau * q.tm) / (q.tau + q.tm)
  // window: the fall, the recovery and 12 tail time constants after it, with a lead-in before ton
  const a = slopeEstimate(q)
  const sRec = recoveryInstant(q.i0, a, q.tau, q.tm)
  const span = sRec + 12 * tauRR
  const ton = 0.2 * span
  const tend = ton + 1.15 * span
  // the time steps of the window (Analyze → convergence varies them)
  const steps = Math.round(clamp(p.stepsPerPeriod, 500, 64000, 6000))
  const params: ResolvedDiode = {
    ...p,
    ...q,
    vt,
    vf,
    rd,
    v0,
    tauRR,
    ton,
    tend,
    steps,
    qm0: q.tau * q.i0,
    view: 'steady',
    periods: 1,
    stepsPerPeriod: steps,
    period: tend,
    dt: tend / steps,
    duration: tend,
  }
  return { params, issues }
}

/** Diode region: Fp forward current, Fn reverse current with stored charge left, R recovered (blocking). */
export type DiodeRegion = 'Fp' | 'Fn' | 'R'
export type SwitchRegion = 'off' | 'sat' | 'ohm'

/**
 * The commutation as a PWL hybrid system. `ideal` = a diode without stored charge (τ → 0): the reference
 * for the switching energy the recovery adds.
 */
export function diodeSystem(p: ResolvedDiode, ideal = false): PwlSystem {
  const S = p.didt
  return {
    n: 3,
    breakpoints: [p.ton],
    mode(x, t, prev) {
      const [iD, qM] = x
      const [pd, ps] = prev ? (prev.split('|') as [DiodeRegion, SwitchRegion]) : (['Fp', 'off'] as const)
      let dev: DiodeRegion
      if (pd === 'R') dev = 'R'
      else if (iD < 0 && qM + p.tm * iD <= 0) dev = 'R'
      else dev = iD > 0 ? 'Fp' : 'Fn'
      let sw: SwitchRegion
      if (t < p.ton) sw = 'off'
      else if (dev === 'R' || ps === 'ohm') sw = 'ohm'
      else {
        // current-limited while the switch voltage it implies stays above the ohmic line Ron·iQ
        const vSat = p.vdc - p.ls * S + p.v0 + p.rd * iD
        sw = vSat >= p.ron * (p.i0 - iD) ? 'sat' : 'ohm'
      }
      return `${dev}|${sw}`
    },
    sys(mode) {
      const [dev, sw] = mode.split('|') as [DiodeRegion, SwitchRegion]
      if (dev === 'R') {
        const k = -1 / p.tauRR
        return {
          A: [
            [k, 0, 0],
            [0, ideal ? 0 : k, 0],
            [-1, 0, 0],
          ],
          b: [0, 0, 0],
        }
      }
      const dq = dev === 'Fn' ? -1 : 0
      const qRow = ideal ? [0, 0, 0] : [1, -1 / p.tau, 0]
      let a00 = 0
      let b0 = 0
      if (sw === 'sat') b0 = -S
      else if (sw === 'ohm') {
        a00 = -(p.ron + p.rd) / p.ls
        b0 = (p.ron * p.i0 - p.vdc - p.v0) / p.ls
      }
      const A: Mat = [[a00, 0, 0], qRow, [dq, 0, 0]]
      return { A, b: [b0, 0, 0] }
    },
  }
}

/** Initial state: steady forward conduction at I0 (qM = τ·I0). */
export const diodeX0 = (p: ResolvedDiode, ideal = false) => [p.i0, ideal ? 0 : p.tau * p.i0, 0]

/** Derived quantities at a state in a mode: terminal voltages, slopes, powers. */
export function diodeDerived(p: ResolvedDiode, iD: number, qM: number, mode: string) {
  const [dev, sw] = mode.split('|') as [DiodeRegion, SwitchRegion]
  const iq = p.i0 - iD
  let didt: number
  if (dev === 'R') didt = -iD / p.tauRR
  else if (sw === 'sat') didt = -p.didt
  else if (sw === 'ohm') didt = (p.ron * p.i0 - p.vdc - p.v0 - (p.ron + p.rd) * iD) / p.ls
  else didt = 0
  const vls = p.ls * didt
  let vak: number
  let vq: number
  if (dev === 'R') {
    vq = p.ron * iq
    vak = vq - p.vdc - vls
  } else {
    vak = p.v0 + p.rd * iD
    vq = p.vdc + vls + vak
  }
  const qE = dev === 'R' ? 0 : qM + p.tm * iD
  return { dev, sw, iq, didt, vls, vak, vq, qE, pq: vq * iq, pd: vak * iD, pls: vls * iD, psrc: -p.vdc * iq, pload: (p.vdc - vq) * p.i0 }
}

export type DiodeRun = Run<ResolvedDiode> & {
  pwlEvents: PwlEvent[]
  modes: string[]
  knots: PwlResult['knots']
  /** The same test with a charge-free diode (SIMULATION): the reference switching energy. */
  ref: { eon: number; ipk: number }
}

type Pt = { t: number; x: number[]; mode: string; before: string; sample: number }

/** The stored samples AND the mode-change knots between them, in time order (a knot keeps the mode before it). */
function timeline(res: PwlResult): Pt[] {
  const pts: Pt[] = []
  const n = res.t.length
  let j = 0
  let prevMode = res.modes[0]
  for (let k = 0; k < n; k++) {
    while (j < res.knots.length && res.knots[j].t < res.t[k]) {
      const kn = res.knots[j]
      pts.push({ t: kn.t, x: kn.x, mode: kn.mode, before: prevMode, sample: -1 })
      prevMode = kn.mode
      j++
    }
    pts.push({ t: res.t[k], x: res.x.map((row) => row[k]), mode: res.modes[k], before: res.modes[k], sample: k })
    prevMode = res.modes[k]
  }
  return pts
}

/**
 * ∫ f dt up to every sample (trapezoid over samples and knots): the integrand may jump at a knot (the
 * switch voltage collapses when the junction recovers), so each interval uses its left end in its own mode
 * and its right end in the mode BEFORE that knot.
 */
function cumulative(pts: Pt[], f: (x: number[], mode: string) => number, n: number): Float64Array {
  const out = new Float64Array(n)
  let e = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    e += 0.5 * (f(a.x, a.mode) + f(b.x, b.before)) * (b.t - a.t)
    if (b.sample >= 0) out[b.sample] = e
  }
  return out
}

/** SIMULATION: the commutation integrated by the PWL simulator (and the charge-free reference). */
export function simulateDiode(input: Partial<DiodeParams>): DiodeRun {
  const started = performance.now()
  const { params: p, issues } = resolveDiode(input)
  const res = simulatePwl(diodeSystem(p), diodeX0(p), 0, p.tend, p.steps, 'Fp|off')
  const n = p.steps + 1
  const names = ['id', 'vd', 'iq', 'vq', 'qe', 'qm', 'qrr', 'qrrn', 'pq', 'pd', 'vls']
  const signals: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  for (let k = 0; k < n; k++) {
    const iD = res.x[0][k]
    const qM = res.x[1][k]
    const d = diodeDerived(p, iD, qM, res.modes[k])
    signals.id[k] = iD
    signals.vd[k] = d.vak
    signals.iq[k] = d.iq
    signals.vq[k] = d.vq
    signals.qe[k] = d.qE * 1e9
    signals.qm[k] = qM * 1e9
    signals.qrr[k] = res.x[2][k]
    signals.qrrn[k] = res.x[2][k] * 1e9
    signals.pq[k] = d.pq
    signals.pd[k] = d.pd
    signals.vls[k] = d.vls
  }
  // energies: trapezoid over the samples and the knots (the power jumps at the recovery instant)
  const pts = timeline(res)
  signals.eq = cumulative(pts, (x, m) => diodeDerived(p, x[0], x[1], m).pq, n)
  signals.ed = cumulative(pts, (x, m) => diodeDerived(p, x[0], x[1], m).pd, n)
  const resRef = simulatePwl(diodeSystem(p, true), diodeX0(p, true), 0, p.tend, p.steps, 'Fp|off')
  const eRef = cumulative(timeline(resRef), (x, m) => diodeDerived(p, x[0], 0, m).pq, n)
  let ipkRef = 0
  for (let k = 0; k < n; k++) ipkRef = Math.max(ipkRef, p.i0 - resRef.x[0][k])
  // (the switch carries no current before ton: its energy from 0 is its energy from ton)
  const ref = { eon: eRef[n - 1], ipk: ipkRef }

  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.ceil(t / p.dt - 1e-9))
    events.push({ id: `d${seq++}`, kind, time: t, device, values: { id: signals.id[k], vd: signals.vd[k], iq: signals.iq[k], vq: signals.vq[k] } })
  }
  ev('gate-on', p.ton, 'switch')
  for (const x of res.events) if (x.t > p.ton) ev('mode', x.t, `${x.from}→${x.to}`)
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'diode',
    params: p,
    length: n,
    time: res.t,
    signals,
    devices: [],
    events,
    steadyFrom: 0,
    pwlEvents: res.events,
    modes: res.modes,
    knots: res.knots,
    ref,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

/** Recovery figures from the event times and the states at them (the same definitions for SIMULATION and THEORY). */
export interface RecoveryFigures {
  /** Zero crossing of iD, and the recovery instant (the reverse-current peak). */
  t0: number | null
  tRec: number | null
  /** Current fall time ton → t0 and the mean slope I0/(t0 − ton). */
  tf: number | null
  didt: number | null
  irr: number | null
  ta: number | null
  tb: number | null
  trr: number | null
  qrr: number
  /** Peak reverse voltage across the diode, and its overshoot above Vdc. */
  vrm: number
  /** Which element set di/dt: the switch's gate ('gate') or the loop inductance ('loop'). */
  limit: 'gate' | 'loop'
  eon: number
  eon0: number
  deon: number
  erec: number
  ipk: number
}

const firstEvent = (evs: PwlEvent[], test: (e: PwlEvent) => boolean) => evs.find(test)?.t ?? null

/**
 * tb by the datasheet rule (IEC 60747-2): the straight line through 90 % and 25 % of Irr on the falling tail,
 * extended to zero current. For the model's exponential tail this is τrr·(ln(10/9) + 0.9/0.65·(ln 4 − ln(10/9))).
 */
export const TB_FACTOR = Math.log(10 / 9) + (0.9 / 0.65) * (Math.log(4) - Math.log(10 / 9))

export interface DiodeMeasurements extends RecoveryFigures {
  /** Forward voltage before the switch turns on (= Vf at I0), the dynamic resistance and the stored charge. */
  vf: number
  rd: number
  qStored: number
  /** tb/ta: softness. */
  softness: number | null
  overshoot: number
  /** Peak power in the diode during the tail. */
  pdPeak: number
}

export function measureDiode(r: DiodeRun): DiodeMeasurements {
  const p = r.params
  const s = r.signals
  const t0 = firstEvent(r.pwlEvents, (e) => e.from.startsWith('Fp') && !e.to.startsWith('Fp'))
  const tRec = firstEvent(r.pwlEvents, (e) => e.to.startsWith('R'))
  const knotAt = (t: number | null) => (t === null ? null : (r.knots.find((k) => k.t === t) ?? null))
  const kRec = knotAt(tRec)
  const irr = kRec ? Math.max(0, -kRec.x[0]) : null
  // tb from the simulated tail samples: 90 % and 25 % crossings (linear interpolation between samples)
  let tb: number | null = null
  if (tRec !== null && irr !== null && irr > 1e-9) {
    const cross = (lvl: number) => {
      for (let k = Math.ceil(tRec / p.dt); k < r.length; k++) {
        if (r.time[k] <= tRec) continue
        if (-s.id[k] <= lvl) {
          const ya = k > 0 && r.time[k - 1] >= tRec ? -s.id[k - 1] : irr
          const ta = k > 0 && r.time[k - 1] >= tRec ? r.time[k - 1] : tRec
          return ta + ((ya - lvl) / (ya - -s.id[k])) * (r.time[k] - ta)
        }
      }
      return null
    }
    const t90 = cross(0.9 * irr)
    const t25 = cross(0.25 * irr)
    if (t90 !== null && t25 !== null) tb = t90 - tRec + ((t25 - t90) * 0.9) / 0.65
  }
  const swModeAt = (t: number) => r.modes[Math.min(r.length - 1, Math.ceil(t / p.dt))]
  const limit: 'gate' | 'loop' = t0 !== null && swModeAt(0.5 * (p.ton + t0)).endsWith('sat') ? 'gate' : 'loop'
  let vrm = 0
  let pdPeak = 0
  let ipk = 0
  for (let k = 0; k < r.length; k++) {
    vrm = Math.max(vrm, -s.vd[k])
    pdPeak = Math.max(pdPeak, s.pd[k])
    ipk = Math.max(ipk, s.iq[k])
  }
  // the reverse voltage jumps at the recovery instant: its peak is the state there in the new mode
  if (kRec) vrm = Math.max(vrm, -diodeDerived(p, kRec.x[0], kRec.x[1], kRec.mode).vak)
  if (irr !== null) ipk = Math.max(ipk, p.i0 + irr)
  const kOn = Math.floor(p.ton / p.dt)
  // the switch carries no current before ton: its whole energy is the turn-on energy
  const eon = s.eq[r.length - 1]
  // energy at an instant between samples (the integrand is smooth at the zero crossing: linear interpolation)
  const at = (a: Float64Array, t: number) => {
    const k = Math.min(r.length - 1, Math.max(1, Math.ceil(t / p.dt)))
    const u = (t - r.time[k - 1]) / (r.time[k] - r.time[k - 1])
    return a[k - 1] + u * (a[k] - a[k - 1])
  }
  const ta = t0 !== null && tRec !== null ? tRec - t0 : null
  return {
    t0,
    tRec,
    tf: t0 !== null ? t0 - p.ton : null,
    didt: t0 !== null ? p.i0 / (t0 - p.ton) : null,
    irr,
    ta,
    tb,
    trr: ta !== null && tb !== null ? ta + tb : null,
    qrr: s.qrr[r.length - 1],
    vrm,
    overshoot: vrm - p.vdc,
    limit,
    eon,
    eon0: r.ref.eon,
    deon: eon - r.ref.eon,
    erec: t0 !== null ? s.ed[r.length - 1] - at(s.ed, t0) : 0,
    ipk,
    vf: s.vd[Math.max(0, kOn - 1)],
    rd: p.rd,
    qStored: s.qm[kOn] * 1e-9,
    softness: ta !== null && tb !== null && ta > 0 ? tb / ta : null,
    pdPeak,
  }
}

/** THEORY: the exact PWL solution (matrix exponential) — events found on the exact flow, energies by Simpson per smooth piece. */
export function exactDiode(p: ResolvedDiode): RecoveryFigures & { tailSlope: number | null } {
  const sys = diodeSystem(p)
  const x0 = diodeX0(p)
  const run = exactPwl(sys, x0, 0, [p.tend], 'Fp|off')
  const evs = run.events
  const t0 = firstEvent(evs, (e) => e.from.startsWith('Fp') && !e.to.startsWith('Fp'))
  const tRec = firstEvent(evs, (e) => e.to.startsWith('R'))
  const stateAt = (t: number) => exactPwl(sys, x0, 0, [t], 'Fp|off')
  let irr: number | null = null
  let vrm = 0
  if (tRec !== null) {
    // the state is continuous at the recovery instant; the reverse voltage there is the recovered mode's
    const x = stateAt(tRec).x[0]
    irr = Math.max(0, -x[0])
    vrm = -diodeDerived(p, x[0], x[1], 'R|ohm').vak
  }
  const ta = t0 !== null && tRec !== null ? tRec - t0 : null
  // the tail is exactly exponential with τrr in the recovered mode: tb by the 90 %/25 % rule in closed form
  const tb = irr !== null && irr > 0 ? p.tauRR * TB_FACTOR : null
  const qrr = run.x[0][2]
  const limitMode = t0 !== null ? stateAt(0.5 * (p.ton + t0)).modes[0] : ''
  const energy = (sysE: PwlSystem, x0E: number[], from: number, to: number, power: (x: number[], m: string) => number) => {
    // split at every mode change (the integrand is smooth between them) and use Simpson on each piece
    const all = exactPwl(sysE, x0E, 0, [to], 'Fp|off').events.map((e) => e.t).filter((t) => t > from && t < to)
    const cuts = [from, ...all, to]
    let e = 0
    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c]
      const b = cuts[c + 1]
      const M = 200
      const h = (b - a) / M
      // sample strictly inside the piece at its ends (a mode change sits exactly on a and b)
      const ts = Array.from({ length: M + 1 }, (_, i) => (i === 0 ? a + h * 1e-9 : i === M ? b - h * 1e-9 : a + i * h))
      const sol = exactPwl(sysE, x0E, 0, ts, 'Fp|off')
      let sum = 0
      for (let i = 0; i <= M; i++) {
        const w = i === 0 || i === M ? 1 : i % 2 ? 4 : 2
        sum += w * power(sol.x[i], sol.modes[i])
      }
      e += (sum * h) / 3
    }
    return e
  }
  const pq = (x: number[], m: string) => diodeDerived(p, x[0], x[1], m).pq
  const pd = (x: number[], m: string) => diodeDerived(p, x[0], x[1], m).pd
  const eon = energy(sys, x0, p.ton, p.tend, pq)
  const sysRef = diodeSystem(p, true)
  const eon0 = energy(sysRef, diodeX0(p, true), p.ton, p.tend, (x, m) => diodeDerived(p, x[0], 0, m).pq)
  const erec = t0 !== null ? energy(sys, x0, t0, p.tend, pd) : 0
  return {
    t0,
    tRec,
    tf: t0 !== null ? t0 - p.ton : null,
    didt: t0 !== null ? p.i0 / (t0 - p.ton) : null,
    irr,
    ta,
    tb,
    trr: ta !== null && tb !== null ? ta + tb : null,
    qrr,
    vrm,
    limit: limitMode.endsWith('sat') ? 'gate' : 'loop',
    eon,
    eon0,
    deon: eon - eon0,
    erec,
    ipk: p.i0 + (irr ?? 0),
    tailSlope: irr !== null ? irr / p.tauRR : null,
  }
}

/**
 * CLOSED FORM for a constant slope (the gate-limited case, the switch never leaves 'sat' before recovery):
 * qM(s) = τ(I0 − S·s) + S·τ²(1 − e^(−s/τ)), recovery when qM + T·iD = 0; Irr = S·s_rec − I0; ta = Irr/S;
 * tail iD = −Irr·e^(−u/τrr) ⇒ Qrr = ½·Irr·ta + Irr·τrr; peak reverse voltage Vdc + Ls·Irr/τrr − Ron·(I0 + Irr).
 */
export function closedFormDiode(p: ResolvedDiode) {
  const S = p.didt
  const sRec = recoveryInstant(p.i0, S, p.tau, p.tm)
  const irr = S * sRec - p.i0
  const ta = irr / S
  const tf = p.i0 / S
  const qa = 0.5 * irr * ta
  const qrr = qa + irr * p.tauRR
  const tb = p.tauRR * TB_FACTOR
  const vrm = p.vdc + (p.ls * irr) / p.tauRR - p.ron * (p.i0 + irr)
  // switch energy in 'sat' (0 … s_rec): ∫(Vdc − Ls·S + V0 + rd·(I0 − S·s))·S·s ds, then Ron·iQ² on the tail to tend
  const vs0 = p.vdc - p.ls * S + p.v0 + p.rd * p.i0
  const eSat = (vs0 * S * sRec * sRec) / 2 - (p.rd * S * S * sRec ** 3) / 3
  const U = p.tend - p.ton - sRec
  const tr = p.tauRR
  const eTail = p.ron * (p.i0 * p.i0 * U + 2 * p.i0 * irr * tr * -Math.expm1(-U / tr) + ((irr * irr * tr) / 2) * -Math.expm1((-2 * U) / tr))
  // valid only if the switch voltage stays above Ron·iQ up to the recovery
  const valid = p.vdc - p.ls * S + p.v0 + p.rd * -irr >= p.ron * (p.i0 + irr)
  return { sRec, irr, ta, tf, qa, qrr, tb, trr: ta + tb, vrm, eon: eSat + eTail, valid }
}

/** The static I–V for the Analyze tab: Newton (SIMULATION) and Lambert W (THEORY) on the same voltages. */
export function ivCurve(p: ResolvedDiode, points = 60) {
  const vMax = shockleyV(p, 2 * p.i0)
  const out: Array<{ v: number; iNewton: number; iLambert: number }> = []
  for (let i = 0; i <= points; i++) {
    const v = (vMax * i) / points
    out.push({ v, iNewton: diodeCurrentNewton(p, v), iLambert: diodeCurrentLambert(p, v) })
  }
  return out
}
