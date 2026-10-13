import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * PMSM DRIVE WITH FIELD-ORIENTED CONTROL — a permanent-magnet synchronous machine with sinusoidal back-EMF, in
 * the rotor (d–q) frame:
 *
 *   vd = R·id + Ld·did/dt − ωe·Lq·iq                     Te = 1.5·p·(ψ·iq + (Ld − Lq)·id·iq)
 *   vq = R·iq + Lq·diq/dt + ωe·(Ld·id + ψ)               J·dω/dt = Te − B·ω − TL,   ωe = p·ω,  dθe/dt = ωe
 *
 * (amplitude-invariant Park transform: id, iq are phase-current amplitudes; ia = id·cos θe − iq·sin θe, …).
 *
 * Control: a PI speed loop sets iq* (limited to the current limit, its integrator frozen while limited); PI
 * current loops in d and q (zero cancelling the winding pole: Kp = ωc·L, Ki = ωc·R, so each closed current loop
 * is first order with bandwidth ωc) with optional decoupling (−ωe·Lq·iq and +ωe·(Ld·id + ψ) added); id* = 0, or
 * field weakening (an integrator lowers id* while the voltage demand exceeds 95 % of the limit).
 *
 * The inverter is an AVERAGED voltage source: it delivers the commanded dq voltage exactly, limited to the
 * space-vector (SVPWM) linear range |v| ≤ Vdc/√3. The switching ripple is NOT modelled.
 *
 * SIMULATION: classical RK4 on [id, iq, ω, θe, controller states, energy integrals] with a fixed step far below
 * 1/ωc and the electrical period; the speed and load steps are step boundaries, and every switch between
 * linear/limited regimes (current limit, voltage limit, field-weakening clamp) is located by bisection, so the
 * right-hand side is smooth inside every step.
 */
export type PmsmEvent = 'none' | 'speed' | 'load' | 'both'
export type PmsmControl = 'id0' | 'fw'

export interface PmsmParams {
  vdc: number
  /** Speed reference from the start, and after the speed step [rpm]. */
  nref: number
  n2: number
  tl: number
  tl2: number
  event: PmsmEvent
  control: PmsmControl
  decouple: 'on' | 'off'
  /** Current limit (amplitude of the phase current) [A]. */
  imax: number
  /** Current-loop and speed-loop bandwidths [Hz], speed-loop damping ratio. */
  fcc: number
  fsc: number
  zeta: number
  r: number
  ld: number
  lq: number
  /** Permanent-magnet flux linkage (peak per phase) [Wb]. */
  psi: number
  pp: number
  j: number
  b: number
  /** Samples per electrical period (0 = automatic). */
  stepsPerPeriod: number
}

export interface ResolvedPmsm extends PmsmParams, RunParams {
  kt: number
  vmax: number
  wc: number
  ws: number
  kpd: number
  kpq: number
  ki: number
  kpw: number
  kiw: number
  kfw: number
  /** Field weakening: voltage target and lowest id*. */
  vfw: number
  idMin: number
  /** Speed step and load step instants (null if none). */
  t1: number | null
  t2: number | null
  w1: number
  w2: number
  tauE: number
  sub: number
}

export const PMSM_DEFAULTS: PmsmParams = {
  vdc: 48,
  nref: 1500,
  n2: 1800,
  tl: 0.2,
  tl2: 0.5,
  event: 'both',
  control: 'id0',
  decouple: 'on',
  imax: 12,
  fcc: 500,
  fsc: 15,
  zeta: 1,
  r: 0.15,
  ld: 0.4e-3,
  lq: 0.4e-3,
  psi: 0.015,
  pp: 4,
  j: 1e-4,
  b: 1e-5,
  stepsPerPeriod: 0,
}

export const PMSM_LIMITS = {
  vdc: { min: 12, max: 800 },
  nref: { min: 50, max: 20000 },
  n2: { min: 50, max: 20000 },
  tl: { min: 0, max: 50 },
  tl2: { min: 0, max: 50 },
  imax: { min: 0.5, max: 500 },
  fcc: { min: 50, max: 5000 },
  fsc: { min: 1, max: 200 },
  zeta: { min: 0.4, max: 3 },
  r: { min: 0.005, max: 20 },
  ld: { min: 20e-6, max: 0.1 },
  lq: { min: 20e-6, max: 0.1 },
  psi: { min: 0.001, max: 2 },
  pp: { min: 1, max: 12 },
  j: { min: 1e-6, max: 1 },
  b: { min: 0, max: 0.1 },
}

const SAMPLE_BUDGET = 24000
const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
export const rad = (n: number) => (n * 2 * Math.PI) / 60
export const rpm = (w: number) => (w * 60) / (2 * Math.PI)

/** Slowest decay rate of the ideal speed loop (current loop instantaneous): s² + 2ζωs·s + ωs². */
export function speedLoopRate(ws: number, zeta: number): number {
  return zeta <= 1 ? zeta * ws : ws * (zeta - Math.sqrt(zeta * zeta - 1))
}

export function resolvePmsm(input: Partial<PmsmParams>): { params: ResolvedPmsm; issues: string[] } {
  const p = { ...PMSM_DEFAULTS, ...input }
  const issues: string[] = []
  const L = PMSM_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, PMSM_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    vdc: c('vdc'),
    nref: c('nref'),
    n2: c('n2'),
    tl: c('tl'),
    tl2: c('tl2'),
    imax: c('imax'),
    fcc: c('fcc'),
    fsc: c('fsc'),
    zeta: c('zeta'),
    r: c('r'),
    ld: c('ld'),
    lq: c('lq'),
    psi: c('psi'),
    pp: Math.round(c('pp')),
    j: c('j'),
    b: c('b'),
  }
  const event: PmsmEvent = p.event === 'none' || p.event === 'speed' || p.event === 'load' ? p.event : 'both'
  const control: PmsmControl = p.control === 'fw' ? 'fw' : 'id0'
  const decouple = p.decouple === 'off' ? 'off' : 'on'
  const kt = 1.5 * q.pp * q.psi
  const vmax = q.vdc / Math.sqrt(3)
  const wc = 2 * Math.PI * q.fcc
  const ws = 2 * Math.PI * q.fsc
  const kiw = (q.j * ws * ws) / kt
  const kpw = Math.max(0, (2 * q.zeta * ws * q.j - q.b) / kt)
  // field weakening: a voltage loop about ten times slower than the current loop
  const wBase = vmax / (q.pp * q.psi)
  const kfw = wc / 10 / (q.pp * wBase * q.ld)
  const w1 = rad(q.nref)
  const w2 = event === 'speed' || event === 'both' ? rad(q.n2) : w1
  // window: accelerate at the current limit, then let the speed loop settle (10 time constants)
  const settle = 10 / speedLoopRate(ws, q.zeta) + 10 / wc
  const tmax = kt * q.imax
  const accel = (wa: number, wb: number, tl: number) => {
    const net = tmax - tl - q.b * Math.max(Math.abs(wa), Math.abs(wb))
    return net > 0 ? (q.j * Math.abs(wb - wa)) / net : 0.2
  }
  let T = accel(0, w1, q.tl) + settle
  let t1: number | null = null
  let t2: number | null = null
  if (event === 'speed' || event === 'both') {
    t1 = T
    T += accel(w1, w2, q.tl) * (control === 'fw' ? 2.5 : 1) + settle
  }
  if (event === 'load' || event === 'both') {
    t2 = T
    T += settle
  }
  const nMax = Math.max(q.nref, event === 'speed' || event === 'both' ? q.n2 : 0)
  const period = 60 / (q.pp * nMax)
  const periods = Math.max(2, Math.ceil(T / period))
  // samples: well inside the current loop and the electrical period, within the budget
  const dtMax = Math.min(0.1 / wc, period / 60, q.ld / q.r / 20, q.lq / q.r / 20)
  let spp = p.stepsPerPeriod > 0 ? Math.max(8, Math.round(p.stepsPerPeriod)) : Math.ceil(period / dtMax)
  if (!(p.stepsPerPeriod > 0) && spp * periods > SAMPLE_BUDGET) spp = Math.max(8, Math.floor(SAMPLE_BUDGET / periods))
  const dt = period / spp
  const hMax = Math.min(0.1 / wc, period / 100, Math.min(q.ld, q.lq) / q.r / 40)
  const sub = Math.max(1, Math.ceil(dt / hMax))
  const params: ResolvedPmsm = {
    ...p,
    ...q,
    event,
    control,
    decouple,
    kt,
    vmax,
    wc,
    ws,
    kpd: wc * q.ld,
    kpq: wc * q.lq,
    ki: wc * q.r,
    kpw,
    kiw,
    kfw,
    vfw: 0.95 * vmax,
    idMin: -0.95 * q.imax,
    t1,
    t2,
    w1,
    w2,
    tauE: Math.min(q.ld, q.lq) / q.r,
    sub,
    period,
    dt,
    stepsPerPeriod: spp,
    periods,
    duration: periods * period,
    view: 'startup',
  }
  return { params, issues }
}

export const wRefAt = (p: ResolvedPmsm, t: number) => (p.t1 !== null && t >= p.t1 - 1e-12 ? p.w2 : p.w1)
export const loadAt = (p: ResolvedPmsm, t: number) => (p.t2 !== null && t >= p.t2 - 1e-12 ? p.tl2 : p.tl)

// state layout
export const ID = 0
export const IQ = 1
export const W = 2
export const TH = 3
export const XID = 4
export const XIQ = 5
export const XW = 6
export const XFW = 7
export const QEL = 8
export const QCU = 9
export const QFR = 10
export const QLD = 11
export const QW = 12
export const QT = 13
const NY = 14

/**
 * Regimes, fixed inside a step: the speed PI (0 linear; ±1 at the ±current limit with its integrator frozen;
 * ±2 sliding along the limit — the integrator then moves just enough to keep the PI output on the limit, the
 * Filippov solution of a frozen/linear chatter), voltage limit, field-weakening integrator clamp.
 */
export interface Mode {
  sw: -2 | -1 | 0 | 1 | 2
  vl: boolean
  fw: 'top' | 'free' | 'bot'
}

export interface Ctl {
  e: number
  idRef: number
  iqLim: number
  u: number
  iqRef: number
  vdStar: number
  vqStar: number
  vStar: number
  vd: number
  vq: number
  te: number
}

/** The controller and inverter outputs at a state (in a given regime). */
export function control(p: ResolvedPmsm, y: ArrayLike<number>, mode: Mode, wRef: number): Ctl {
  const id = y[ID]
  const iq = y[IQ]
  const we = p.pp * y[W]
  const e = wRef - y[W]
  const idRef = p.control === 'fw' ? Math.min(0, y[XFW]) : 0
  const iqLim = Math.sqrt(Math.max(p.imax * p.imax - idRef * idRef, 0))
  const u = p.kpw * e + y[XW]
  const iqRef = mode.sw > 0 ? iqLim : mode.sw < 0 ? -iqLim : u
  const dec = p.decouple === 'on'
  const vdStar = p.kpd * (idRef - id) + y[XID] - (dec ? we * p.lq * iq : 0)
  const vqStar = p.kpq * (iqRef - iq) + y[XIQ] + (dec ? we * (p.ld * id + p.psi) : 0)
  const vStar = Math.hypot(vdStar, vqStar)
  const s = mode.vl && vStar > 0 ? p.vmax / vStar : 1
  const te = 1.5 * p.pp * (p.psi * iq + (p.ld - p.lq) * id * iq)
  return { e, idRef, iqLim, u, iqRef, vdStar, vqStar, vStar, vd: vdStar * s, vq: vqStar * s, te }
}

function deriv(p: ResolvedPmsm, y: Float64Array, mode: Mode, wRef: number, tl: number, out: Float64Array) {
  const c = control(p, y, mode, wRef)
  const id = y[ID]
  const iq = y[IQ]
  const w = y[W]
  const we = p.pp * w
  out[ID] = (c.vd - p.r * id + we * p.lq * iq) / p.ld
  out[IQ] = (c.vq - p.r * iq - we * (p.ld * id + p.psi)) / p.lq
  out[W] = (c.te - p.b * w - tl) / p.j
  out[TH] = we
  out[XID] = mode.vl ? 0 : p.ki * (c.idRef - id)
  out[XIQ] = mode.vl ? 0 : p.ki * (c.iqRef - iq)
  out[XW] = mode.sw === 0 ? p.kiw * c.e : Math.abs(mode.sw) === 2 ? Math.sign(mode.sw) * limRate(p, mode, c) + p.kpw * out[W] : 0
  out[XFW] = p.control === 'fw' && mode.fw === 'free' ? p.kfw * (p.vfw - c.vStar) : 0
  out[QEL] = 1.5 * (c.vd * id + c.vq * iq)
  out[QCU] = 1.5 * p.r * (id * id + iq * iq)
  out[QFR] = p.b * w * w
  out[QLD] = tl * w
  out[QW] = w
  out[QT] = c.te
}

/** d(iq limit)/dt: the limit √(Imax² − id*²) moves while field weakening changes id*. */
function limRate(p: ResolvedPmsm, mode: Mode, c: Ctl): number {
  if (p.control !== 'fw' || mode.fw !== 'free' || c.iqLim <= 1e-12) return 0
  return (-c.idRef * p.kfw * (p.vfw - c.vStar)) / c.iqLim
}

/**
 * At the current limit on side s (±1): which regime the speed PI follows — 'frozen' if the frozen-integrator
 * field keeps the PI output beyond the limit, 'linear' if the linear field takes it back inside, otherwise
 * 'slide' along the limit. Also returns the two rates (their signs are the regime's exit conditions).
 */
export function satChoice(p: ResolvedPmsm, y: ArrayLike<number>, mode: Mode, wRef: number, tl: number, s: 1 | -1): { a: number; b: number; sw: Mode['sw'] } {
  const c = control(p, y, { ...mode, sw: s }, wRef)
  const wdot = (c.te - p.b * y[W] - tl) / p.j
  const dLim = limRate(p, mode, c)
  const a = s * (-p.kpw * wdot) - dLim
  const b = s * (-p.kpw * wdot + p.kiw * c.e) - dLim
  return { a, b, sw: a >= 0 ? s : b <= 0 ? 0 : ((2 * s) as 2 | -2) }
}

function rk4(p: ResolvedPmsm, y: Float64Array, mode: Mode, wRef: number, tl: number, h: number, ws: Float64Array[], out: Float64Array) {
  const [k1, k2, k3, k4, tmp] = ws
  deriv(p, y, mode, wRef, tl, k1)
  for (let i = 0; i < NY; i++) tmp[i] = y[i] + 0.5 * h * k1[i]
  deriv(p, tmp, mode, wRef, tl, k2)
  for (let i = 0; i < NY; i++) tmp[i] = y[i] + 0.5 * h * k2[i]
  deriv(p, tmp, mode, wRef, tl, k3)
  for (let i = 0; i < NY; i++) tmp[i] = y[i] + h * k3[i]
  deriv(p, tmp, mode, wRef, tl, k4)
  for (let i = 0; i < NY; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
}

/** The regime consistent with a state (used at the start and after an input step). */
export function modeAt(p: ResolvedPmsm, y: ArrayLike<number>, wRef: number, tl: number, prev?: Mode): Mode {
  const m: Mode = { sw: 0, vl: false, fw: prev?.fw ?? 'top' }
  const c0 = control(p, y, { sw: 0, vl: false, fw: m.fw }, wRef)
  // beyond the limit (an input step, the start): the integrator is frozen until the output comes back to it;
  // exactly on it, the regime rule decides
  const tolU = 1e-9 * Math.max(c0.iqLim, 1e-9)
  if (c0.u > c0.iqLim + tolU) m.sw = 1
  else if (c0.u < -c0.iqLim - tolU) m.sw = -1
  else if (c0.u >= c0.iqLim) m.sw = satChoice(p, y, m, wRef, tl, 1).sw || 1
  else if (c0.u <= -c0.iqLim) m.sw = satChoice(p, y, m, wRef, tl, -1).sw || -1
  else m.sw = 0
  const c1 = control(p, y, m, wRef)
  m.vl = c1.vStar > p.vmax
  if (p.control === 'fw') {
    if (m.fw === 'top' && p.vfw - c1.vStar < 0) m.fw = 'free'
    if (m.fw === 'bot' && p.vfw - c1.vStar > 0) m.fw = 'free'
  }
  return m
}

interface EvFn {
  kind: string
  g: (y: Float64Array) => number
  apply: (y: Float64Array) => void
}

export interface PmsmKnot {
  t: number
  x: number[]
  what: string
}

export type PmsmRun = Run<ResolvedPmsm> & {
  knots: PmsmKnot[]
  /** Regime per sample (the interval ending at it): speed limit, voltage limit, field weakening active. */
  sat: Int8Array
  vlim: Uint8Array
  fwOn: Uint8Array
  q: Float64Array[]
}

export function simulatePmsm(input: Partial<PmsmParams>): PmsmRun {
  const started = performance.now()
  const { params: p, issues } = resolvePmsm(input)
  const n = p.periods * p.stepsPerPeriod + 1
  const names = ['n', 'nref', 'w', 'id', 'iq', 'idref', 'iqref', 'ia', 'ib', 'ic', 'va', 'vb', 'vc', 'vd', 'vq', 'vmag', 'vmax', 'te', 'tl', 'theta', 'pel', 'pmech']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  const q = Array.from({ length: NY }, () => new Float64Array(n))
  const sat = new Int8Array(n)
  const vlim = new Uint8Array(n)
  const fwOn = new Uint8Array(n)
  const time = new Float64Array(n)
  const knots: PmsmKnot[] = []
  const events: RunEvent[] = []
  const ws = Array.from({ length: 5 }, () => new Float64Array(NY))
  let y = new Float64Array(NY)
  let mode = modeAt(p, y, wRefAt(p, 0), loadAt(p, 0))

  const store = (k: number, t: number) => {
    time[k] = t
    const wRef = wRefAt(p, k > 0 ? t - 1e-9 * p.dt : 0)
    const c = control(p, y, mode, wRef)
    const th = y[TH]
    const cs = [0, 1, 2].map((x) => Math.cos(th - (2 * Math.PI * x) / 3))
    const sn = [0, 1, 2].map((x) => Math.sin(th - (2 * Math.PI * x) / 3))
    s.w[k] = y[W]
    s.n[k] = rpm(y[W])
    s.nref[k] = rpm(wRef)
    s.id[k] = y[ID]
    s.iq[k] = y[IQ]
    s.idref[k] = c.idRef
    s.iqref[k] = c.iqRef
    s.ia[k] = y[ID] * cs[0] - y[IQ] * sn[0]
    s.ib[k] = y[ID] * cs[1] - y[IQ] * sn[1]
    s.ic[k] = y[ID] * cs[2] - y[IQ] * sn[2]
    s.va[k] = c.vd * cs[0] - c.vq * sn[0]
    s.vb[k] = c.vd * cs[1] - c.vq * sn[1]
    s.vc[k] = c.vd * cs[2] - c.vq * sn[2]
    s.vd[k] = c.vd
    s.vq[k] = c.vq
    s.vmag[k] = Math.hypot(c.vd, c.vq)
    s.vmax[k] = p.vmax
    s.te[k] = c.te
    s.tl[k] = loadAt(p, k > 0 ? t - 1e-9 * p.dt : 0)
    let deg = ((th * 180) / Math.PI) % 360
    if (deg < 0) deg += 360
    s.theta[k] = deg
    s.pel[k] = 1.5 * (c.vd * y[ID] + c.vq * y[IQ])
    s.pmech[k] = c.te * y[W]
    for (let i = 0; i < NY; i++) q[i][k] = y[i]
    sat[k] = Math.sign(mode.sw)
    vlim[k] = mode.vl ? 1 : 0
    fwOn[k] = p.control === 'fw' && y[XFW] < -1e-9 ? 1 : 0
  }
  store(0, 0)

  const ev = (kind: RunEvent['kind'], t: number, device: string, values: Record<string, number> = {}) =>
    events.push({ id: `p${events.length}`, kind, time: t, device, values: { n: rpm(y[W]), iq: y[IQ], id: y[ID], ...values } })

  const eventFns = (wRef: number, tl: number): EvFn[] => {
    const out: EvFn[] = []
    const cc = (yy: Float64Array) => control(p, yy, mode, wRef)
    // reaching or leaving the current limit: the next regime by the rule of satChoice
    const choose = (yy: Float64Array, s: 1 | -1) => {
      const sw = satChoice(p, yy, mode, wRef, tl, s).sw
      mode = { ...mode, sw }
      if (sw === 0) inside(yy, s)
    }
    // back to the linear regime exactly on the limit: place the PI output a hair inside (1e-12 of the limit),
    // so the limit is not found "reached" again at once
    const inside = (yy: Float64Array, s: 1 | -1) => {
      const c = control(p, yy, { ...mode, sw: 0 }, wRef)
      const over = s * c.u - c.iqLim * (1 - 1e-12)
      if (over > 0) yy[XW] -= s * over
    }
    const sc = 1 / (p.kpw * (p.kt * p.imax) / p.j + p.kiw * Math.max(Math.abs(wRef), 1) + 1e-12)
    if (mode.sw === 0) {
      out.push({ kind: 'sat+', g: (yy) => { const c = cc(yy); return (c.u - c.iqLim) / p.imax }, apply: (yy) => choose(yy, 1) })
      out.push({ kind: 'sat-', g: (yy) => { const c = cc(yy); return (-c.u - c.iqLim) / p.imax }, apply: (yy) => choose(yy, -1) })
    } else if (mode.sw === 1 || mode.sw === -1) {
      const s = mode.sw
      out.push({ kind: 'unsat', g: (yy) => { const c = cc(yy); return (c.iqLim - s * c.u) / p.imax }, apply: (yy) => choose(yy, s) })
    } else {
      const s = mode.sw > 0 ? 1 : -1
      out.push({ kind: 'slide-frozen', g: (yy) => satChoice(p, yy, mode, wRef, tl, s).a * sc, apply: () => (mode = { ...mode, sw: s }) })
      out.push({ kind: 'unsat', g: (yy) => -satChoice(p, yy, mode, wRef, tl, s).b * sc, apply: (yy) => ((mode = { ...mode, sw: 0 }), inside(yy, s)) })
    }
    if (!mode.vl) out.push({ kind: 'vlim', g: (yy) => (cc(yy).vStar - p.vmax) / p.vmax, apply: () => (mode = { ...mode, vl: true }) })
    else out.push({ kind: 'vfree', g: (yy) => (p.vmax - cc(yy).vStar) / p.vmax, apply: () => (mode = { ...mode, vl: false }) })
    if (p.control === 'fw') {
      if (mode.fw === 'top') out.push({ kind: 'fw-on', g: (yy) => (cc(yy).vStar - p.vfw) / p.vmax, apply: () => (mode = { ...mode, fw: 'free' }) })
      else if (mode.fw === 'bot') out.push({ kind: 'fw-unclamp', g: (yy) => (p.vfw - cc(yy).vStar) / p.vmax, apply: () => (mode = { ...mode, fw: 'free' }) })
      else {
        out.push({ kind: 'fw-off', g: (yy) => yy[XFW] / p.imax, apply: (yy) => ((yy[XFW] = 0), (mode = { ...mode, fw: 'top' })) })
        out.push({ kind: 'fw-clamp', g: (yy) => (p.idMin - yy[XFW]) / p.imax, apply: (yy) => ((yy[XFW] = p.idMin), (mode = { ...mode, fw: 'bot' })) })
      }
    }
    return out
  }

  const g0 = new Float64Array(16)
  let yNext = new Float64Array(NY)
  let yMid = new Float64Array(NY)
  let yHiBuf = new Float64Array(NY)
  const advance = (t0: number, t1: number) => {
    const wRef = wRefAt(p, 0.5 * (t0 + t1))
    const tl = loadAt(p, 0.5 * (t0 + t1))
    let t = t0
    const h0 = (t1 - t0) / Math.max(1, Math.ceil((t1 - t0) / (p.dt / p.sub) - 1e-9))
    for (let guard = 0; guard < 10000 && t < t1 - 1e-15 * Math.max(t1, 1e-9); guard++) {
      const h = Math.min(h0, t1 - t)
      const evs = eventFns(wRef, tl)
      for (let i = 0; i < evs.length; i++) g0[i] = evs[i].g(y)
      const fires = (yy: Float64Array) => {
        for (let i = 0; i < evs.length; i++) {
          const g = evs[i].g(yy)
          if (g > 0 || (g >= 0 && g0[i] < 0)) return true
        }
        return false
      }
      rk4(p, y, mode, wRef, tl, h, ws, yNext)
      if (!fires(yNext)) {
        const tmp = y
        y = yNext
        yNext = tmp
        t += h
        continue
      }
      let lo = 0
      let hi = h
      yHiBuf.set(yNext)
      for (let it = 0; it < 48; it++) {
        const mid = 0.5 * (lo + hi)
        rk4(p, y, mode, wRef, tl, mid, ws, yMid)
        if (fires(yMid)) {
          hi = mid
          const tmp = yHiBuf
          yHiBuf = yMid
          yMid = tmp
        } else lo = mid
      }
      const yOld = y
      y = yHiBuf
      yHiBuf = yOld
      t += hi
      let best = -1
      let bestG = -Infinity
      for (let i = 0; i < evs.length; i++) {
        const g = evs[i].g(y)
        if ((g > 0 || (g >= 0 && g0[i] < 0)) && g > bestG) {
          best = i
          bestG = g
        }
      }
      if (best >= 0) {
        const e = evs[best]
        const before = mode.sw
        e.apply(y)
        knots.push({ t, x: Array.from(y), what: e.kind })
        if (knots.length > 200000) throw new Error('pmsm: the regime switches without end (chattering) — a bug in the regime rules')
        if (before !== 0 && mode.sw === 0) ev('mode', t, 'unsat')
        else if (before === 0 && mode.sw !== 0) ev('mode', t, 'sat')
        else if (e.kind === 'vlim') ev('mode', t, 'vlim')
        else if (e.kind === 'vfree') ev('mode', t, 'vfree')
        else if (e.kind === 'fw-on') ev('mode', t, 'fw-on')
        else if (e.kind === 'fw-off') ev('mode', t, 'fw-off')
      }
    }
  }

  const bps = [p.t1, p.t2].filter((x): x is number => x !== null).sort((a, b) => a - b)
  for (let k = 1; k < n; k++) {
    const ta = (k - 1) * p.dt
    const tb = k * p.dt
    const cuts = [ta, ...bps.filter((x) => x > ta + 1e-12 * p.dt && x < tb - 1e-12 * p.dt), tb]
    for (let ci = 0; ci + 1 < cuts.length; ci++) {
      if (ci > 0) {
        // an input step: the regime may change at once
        const wRef = wRefAt(p, 0.5 * (cuts[ci] + cuts[ci + 1]))
        const m2 = modeAt(p, y, wRef, loadAt(p, 0.5 * (cuts[ci] + cuts[ci + 1])), mode)
        knots.push({ t: cuts[ci], x: Array.from(y), what: 'step' })
        if ((m2.sw === 0) !== (mode.sw === 0)) ev('mode', cuts[ci], m2.sw !== 0 ? 'sat' : 'unsat')
        mode = m2
      }
      advance(cuts[ci], cuts[ci + 1])
    }
    // an input step exactly on a sample boundary
    const next = bps.find((x) => Math.abs(x - tb) <= 1e-12 * p.dt)
    store(k, tb)
    if (next !== undefined) {
      const m2 = modeAt(p, y, wRefAt(p, tb + 1e-9 * p.dt), loadAt(p, tb + 1e-9 * p.dt), mode)
      knots.push({ t: tb, x: Array.from(y), what: 'step' })
      if ((m2.sw === 0) !== (mode.sw === 0)) ev('mode', tb, m2.sw !== 0 ? 'sat' : 'unsat')
      mode = m2
    }
  }
  if (p.t1 !== null) ev('mode', p.t1, 'speed-step', { from: rpm(p.w1), to: rpm(p.w2) })
  if (p.t2 !== null) ev('mode', p.t2, 'load-step', { from: p.tl, to: p.tl2 })
  // speed overshoot after the speed step and dip after the load step (on their own samples)
  const m = measureCore(p, time, s.w, s.iq, s.id)
  if (m.kPeak !== null) events.push({ id: 'peak', kind: 'mode', time: time[m.kPeak], device: 'peak', values: { n: s.n[m.kPeak], iq: s.iq[m.kPeak] } })
  if (m.kDip !== null) events.push({ id: 'dip', kind: 'mode', time: time[m.kDip], device: 'dip', values: { n: s.n[m.kDip], iq: s.iq[m.kDip] } })
  events.sort((a, b) => a.time - b.time)
  // settled: the speed error and its change over the last electrical period are small
  const kL = n - 1
  const kP = Math.max(0, kL - p.stepsPerPeriod)
  const wEnd = wRefAt(p, p.duration)
  const residual = (Math.abs(s.w[kL] - wEnd) + Math.abs(s.w[kL] - s.w[kP])) / Math.max(Math.abs(wEnd), 1)
  return {
    kind: 'pmsm',
    params: p,
    length: n,
    time,
    signals: s,
    devices: [],
    events,
    steadyFrom: kP,
    knots,
    sat,
    vlim,
    fwOn,
    q,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'startup', iterations: 0, residual, converged: residual < 1e-3 }, issues },
  }
}

// ── Measurements (the same functions measure the simulation and the theory's trajectory) ──────────────

export interface CoreMeasures {
  /** Start-up: 90 % of the first reference, iq 10–90 % rise time (iq* at the limit). */
  t90: number | null
  iqRise: number | null
  /** Speed step: overshoot relative to the step, time of the peak after the step. */
  overshoot: number | null
  tPeak: number | null
  kPeak: number | null
  /** Load step: largest speed drop [rad/s] and its time after the step. */
  dip: number | null
  tDip: number | null
  kDip: number | null
  /** Speed just before the speed step and before the load step [rad/s]. */
  wAtT1: number | null
  wAtT2: number | null
  /** Largest |id| over the run (zero with id = 0 control and decoupling). */
  idPeak: number
  iqPeak: number
}

/** Linear interpolation of the first crossing of `level` by a rising signal after index k0. */
function crossing(time: ArrayLike<number>, x: ArrayLike<number>, level: number, k0: number, k1: number): number | null {
  for (let k = Math.max(k0 + 1, 1); k <= k1; k++)
    if (x[k] >= level && x[k - 1] < level) return time[k - 1] + ((level - x[k - 1]) / (x[k] - x[k - 1])) * (time[k] - time[k - 1])
  return null
}

export function measureCore(p: ResolvedPmsm, time: ArrayLike<number>, w: ArrayLike<number>, iq: ArrayLike<number>, id: ArrayLike<number>): CoreMeasures {
  const n = time.length
  const idx = (t: number) => Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
  const k1 = p.t1 !== null ? idx(p.t1) : n - 1
  const k2 = p.t2 !== null ? idx(p.t2) : n - 1
  const kStartEnd = Math.min(k1, k2)
  const t90 = crossing(time, w, 0.9 * p.w1, 0, kStartEnd)
  // iq rises toward the limit at the start: 10 % and 90 % of the current limit
  const a = crossing(time, iq, 0.1 * p.imax, 0, kStartEnd)
  const b = crossing(time, iq, 0.9 * p.imax, 0, kStartEnd)
  const iqRise = a !== null && b !== null ? b - a : null
  let overshoot: number | null = null
  let tPeak: number | null = null
  let kPeak: number | null = null
  let wAtT1: number | null = null
  if (p.t1 !== null) {
    wAtT1 = w[k1]
    const kEnd = p.t2 !== null && p.t2 > p.t1 ? k2 : n - 1
    let best = k1
    const up = p.w2 >= wAtT1
    for (let k = k1; k <= kEnd; k++) if (up ? w[k] > w[best] : w[k] < w[best]) best = k
    const step = p.w2 - wAtT1
    if (Math.abs(step) > 1e-9) {
      overshoot = (w[best] - p.w2) / step
      tPeak = time[best] - p.t1
      kPeak = best
    }
  }
  let dip: number | null = null
  let tDip: number | null = null
  let kDip: number | null = null
  let wAtT2: number | null = null
  if (p.t2 !== null) {
    wAtT2 = w[k2]
    let best = k2
    const down = p.tl2 >= p.tl
    for (let k = k2; k < n; k++) if (down ? w[k] < w[best] : w[k] > w[best]) best = k
    dip = Math.abs(wAtT2 - w[best])
    tDip = time[best] - p.t2
    kDip = best
  }
  let idPeak = 0
  let iqPeak = 0
  for (let k = 0; k < n; k++) {
    idPeak = Math.max(idPeak, Math.abs(id[k]))
    iqPeak = Math.max(iqPeak, Math.abs(iq[k]))
  }
  return { t90, iqRise, overshoot, tPeak, kPeak, dip, tDip, kDip, wAtT1, wAtT2, idPeak, iqPeak }
}

export interface PmsmMeasurements extends CoreMeasures {
  /** The load-step dip in rpm. */
  dipRpm: number | null
  /** End of the run (steady): speed, dq currents and voltages, torque. */
  wEnd: number
  nEnd: number
  idEnd: number
  iqEnd: number
  vdEnd: number
  vqEnd: number
  vEnd: number
  teEnd: number
  /** Phase-current amplitude √(id² + iq²) and RMS of ia over the last electrical period. */
  iAmp: number
  iaRms: number
  fe: number
  /** Powers over the last electrical period [W]. */
  pel: number
  pcu: number
  pshaft: number
  eff: number | null
  /** Fraction of the run with the speed PI at the current limit / the voltage at its limit / field weakening on. */
  satFrac: number
  vlimFrac: number
  /** The voltage limit was reached at least once (even for less than a sample). */
  vlimHit: boolean
  fwFrac: number
  /** Time the speed PI leaves the current limit after the start. */
  tDesat: number | null
  /** Energy over the run and its balance. */
  ein: number
  balance: number
  settled: boolean
}

export function measurePmsm(r: PmsmRun): PmsmMeasurements {
  const p = r.params
  const s = r.signals
  const n = r.length
  const core = measureCore(p, r.time, s.w, s.iq, s.id)
  const kL = n - 1
  const kP = Math.max(0, kL - p.stepsPerPeriod)
  const T = r.time[kL] - r.time[kP]
  const mean = (i: number) => (r.q[i][kL] - r.q[i][kP]) / T
  let iaSq = 0
  for (let k = kP + 1; k <= kL; k++) iaSq += 0.5 * (s.ia[k] ** 2 + s.ia[k - 1] ** 2) * p.dt
  let sat = 0
  let vl = 0
  let fw = 0
  for (let k = 1; k < n; k++) {
    if (r.sat[k] !== 0) sat++
    if (r.vlim[k]) vl++
    if (r.fwOn[k]) fw++
  }
  const unsat = r.events.find((e) => e.device === 'unsat')
  const pel = mean(QEL)
  const pshaft = mean(QLD)
  const ein = r.q[QEL][kL]
  const ekin = 0.5 * p.j * s.w[kL] ** 2
  const emag = 0.75 * (p.ld * s.id[kL] ** 2 + p.lq * s.iq[kL] ** 2)
  const balance = (ein - r.q[QCU][kL] - r.q[QFR][kL] - r.q[QLD][kL] - ekin - emag) / Math.max(Math.abs(ein), 1e-12)
  return {
    ...core,
    dipRpm: core.dip === null ? null : rpm(core.dip),
    wEnd: s.w[kL],
    nEnd: s.n[kL],
    idEnd: s.id[kL],
    iqEnd: s.iq[kL],
    vdEnd: s.vd[kL],
    vqEnd: s.vq[kL],
    vEnd: s.vmag[kL],
    teEnd: s.te[kL],
    iAmp: Math.hypot(s.id[kL], s.iq[kL]),
    iaRms: Math.sqrt(iaSq / T),
    fe: (p.pp * s.w[kL]) / (2 * Math.PI),
    pel,
    pcu: mean(QCU),
    pshaft,
    eff: pel > 1e-9 && pshaft > 0 ? pshaft / pel : null,
    satFrac: sat / (n - 1),
    vlimFrac: vl / (n - 1),
    vlimHit: vl > 0 || r.vlim[0] === 1 || r.events.some((e) => e.device === 'vlim' || e.device === 'vfree'),
    fwFrac: fw / (n - 1),
    tDesat: unsat ? unsat.time : null,
    ein,
    balance,
    settled: r.diagnostics.steady.converged,
  }
}
