import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * EV BATTERY & BMS — a series string of N lithium-ion cells, each a Thevenin equivalent:
 *
 *   OCV(SOC) ── R0 ── (R1 ∥ C1) ── (R2 ∥ C2) ── terminals        (+ a bleed resistor Rbal and its switch)
 *
 *   dSOC/dt = −i / Q            (Q = capacity [A·s]; i = cell current, discharge positive)
 *   du/dt   = (R1·i − u) / τ1    (the RC pairs: u → R1·i with time constant τ1 = R1·C1)
 *   dw/dt   = (R2·i − w) / τ2
 *   V       = OCV(SOC) − u − w − R0·i
 *
 * OCV(SOC) is a tabulated NMC/graphite curve, linearly interpolated (so the model is piecewise linear).
 * Every cell carries the same pack current I; a cell whose bleed switch is closed also feeds its own
 * resistor: i = I + V/Rbal. Cells differ in capacity and starting SOC (a fixed, labelled spread pattern).
 *
 * The BMS:
 *  - counts charge (coulomb counting) to estimate the pack SOC: SOCest = SOCest(0) − ∫(I + offset)dt / Qnom;
 *  - stops a discharge the instant any cell reaches the cut-off voltage Vmin (contactor opens);
 *  - charges CC-CV: constant current until a cell reaches Vmax, then it lowers the current so that no cell
 *    exceeds Vmax (the highest cell is held at Vmax); the charge ends when |I| < C/20 and no cell bleeds;
 *  - balances passively while charging and in the rest right after a charge: every second (balancing paused
 *    while it measures) a cell more than `threshold` above the lowest cell gets its bleed resistor switched on,
 *    and off again once it is within threshold/2 (hysteresis).
 *
 * The bleed current (≈ 0.4 A with the default 10 Ω) is larger than in most real packs (50–200 mA), so that
 * balancing acts within one charge of the lab — stated in the lab.
 */
export type BatteryProfile = 'cycle' | 'discharge' | 'pulse' | 'charge'

export interface BatteryParams {
  profile: BatteryProfile
  /** Cells in series. */
  cells: number
  /** Nominal capacity of one cell [Ah]. */
  capacity: number
  /** Discharge (and pulse) current [C]. */
  crate: number
  /** Constant-current charge rate [C]. */
  chargeRate: number
  /** Mean starting state of charge (0…1). */
  soc0: number
  /** Cell-to-cell capacity spread (± fraction of the nominal). */
  capSpread: number
  /** Cell-to-cell starting-SOC spread (± fraction). */
  socSpread: number
  r0: number
  /** RC pairs in the cell model (1 or 2). */
  rcPairs: number
  r1: number
  tau1: number
  r2: number
  tau2: number
  /** Cut-off voltage under discharge and maximum cell voltage under charge [V]. */
  vmin: number
  vmax: number
  balancing: 'on' | 'off'
  /** Balancing threshold above the lowest cell [V]. */
  threshold: number
  /** Bleed resistor [Ω]. */
  rbal: number
  /** Current-sensor offset of the coulomb counter [A]. */
  iOffset: number
  /** Pulse profile: on and off times [s] and the number of pulses. */
  pulseOn: number
  pulseOff: number
  pulses: number
  /** Rest after the load or the charge [s]. */
  rest: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export type PhaseKind = 'rest' | 'dis' | 'pulse' | 'charge'
export interface Phase {
  kind: PhaseKind
  /** Fixed duration (rest, pulse train) or safety limit (discharge, charge) [s]. */
  dur: number
  /** The BMS may balance in this phase. */
  balance: boolean
  name: string
}

export interface ResolvedBattery extends BatteryParams, RunParams {
  n: number
  /** Capacity of each cell [A·s] and its starting SOC. */
  q: number[]
  s0: number[]
  /** 1 C [A], the discharge current [A], the CC charge current [A] (negative), the CV end current [A]. */
  iNom: number
  iDis: number
  iCc: number
  iTerm: number
  /** Timing resolution of the BMS and the load profile [s]: pulse edges, rest ends; the BMS samples every 1 s. */
  tick: number
  bmsT: number
  phases: Phase[]
  /** The BMS's starting SOC estimate (the mean of the cells, from a rested OCV reading). */
  socEst0: number
}

export const BAT_DEFAULTS: BatteryParams = {
  profile: 'cycle',
  cells: 8,
  capacity: 5,
  crate: 1,
  chargeRate: 1,
  soc0: 0.3,
  capSpread: 0.03,
  socSpread: 0.05,
  r0: 0.015,
  rcPairs: 2,
  r1: 0.01,
  tau1: 10,
  r2: 0.012,
  tau2: 150,
  vmin: 3.0,
  vmax: 4.2,
  balancing: 'on',
  threshold: 0.01,
  rbal: 10,
  iOffset: 0,
  pulseOn: 20,
  pulseOff: 40,
  pulses: 6,
  rest: 600,
  view: 'startup',
  periods: 1,
  stepsPerPeriod: 0,
}

export const BAT_LIMITS = {
  cells: { min: 4, max: 12 },
  capacity: { min: 1, max: 100 },
  crate: { min: 0.1, max: 5 },
  chargeRate: { min: 0.1, max: 3 },
  soc0: { min: 0.05, max: 0.95 },
  capSpread: { min: 0, max: 0.15 },
  socSpread: { min: 0, max: 0.1 },
  r0: { min: 0.001, max: 0.1 },
  r1: { min: 0, max: 0.05 },
  tau1: { min: 1, max: 100 },
  r2: { min: 0, max: 0.05 },
  tau2: { min: 20, max: 2000 },
  vmin: { min: 3.0, max: 3.4 },
  vmax: { min: 4.0, max: 4.2 },
  threshold: { min: 0.002, max: 0.1 },
  rbal: { min: 5, max: 200 },
  iOffset: { min: -0.5, max: 0.5 },
  pulseOn: { min: 1, max: 120 },
  pulseOff: { min: 1, max: 300 },
  pulses: { min: 1, max: 20 },
  rest: { min: 60, max: 3600 },
}

/**
 * Open-circuit voltage of an NMC/graphite cell [SOC, V] (typical shape of a 21700 cell, 25 °C): steep at the
 * bottom, a gentle plateau in the middle, rising towards 4.2 V at full charge. Linearly interpolated;
 * outside 0…1 the end segments are extended.
 */
export const OCV_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 3.0],
  [0.05, 3.32],
  [0.1, 3.45],
  [0.2, 3.55],
  [0.3, 3.61],
  [0.4, 3.66],
  [0.5, 3.71],
  [0.6, 3.78],
  [0.7, 3.87],
  [0.8, 3.96],
  [0.9, 4.06],
  [1, 4.2],
]
const OCV_S = OCV_TABLE.map((r) => r[0])
const NSEG = OCV_TABLE.length - 1

/** The OCV segment holding SOC s (end segments extended). */
export function ocvSeg(s: number): number {
  let k = 0
  while (k < NSEG - 1 && s >= OCV_S[k + 1]) k++
  return k
}
/** OCV = a + b·SOC on segment k. */
export function ocvLine(k: number): { a: number; b: number } {
  const [s0, v0] = OCV_TABLE[k]
  const [s1, v1] = OCV_TABLE[k + 1]
  const b = (v1 - v0) / (s1 - s0)
  return { a: v0 - b * s0, b }
}
/** Segment boundaries [lo, hi) of segment k (the end segments are open-ended). */
export function segBounds(k: number): [number, number] {
  return [k === 0 ? -Infinity : OCV_S[k], k === NSEG - 1 ? Infinity : OCV_S[k + 1]]
}
export function ocv(s: number): number {
  const { a, b } = ocvLine(ocvSeg(s))
  return a + b * s
}
/** The SOC where OCV = v (inverse of the table; extended at the ends). */
export function socAtOcv(v: number): number {
  for (let k = 0; k < NSEG; k++) {
    const { a, b } = ocvLine(k)
    const s = (v - a) / b
    if (s < OCV_S[k + 1] || k === NSEG - 1) return k === 0 || s >= OCV_S[k] ? s : OCV_S[k]
  }
  return 1
}

/** The fixed cell-to-cell pattern (−1…1) of capacity and of starting SOC; scaled by the spreads. */
export const CAP_PATTERN = [0.35, -1, 0.6, -0.2, 1, -0.55, 0.15, 0.8, -0.75, 0.45, -0.35, 0.05]
export const SOC_PATTERN = [0.5, 0.1, -1, 0.7, -0.3, 1, -0.6, 0.2, 0.9, -0.8, 0.3, -0.1]

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
const ceilTo = (t: number, q: number) => Math.ceil(t / q - 1e-9) * q

export function resolveBattery(input: Partial<BatteryParams>): { params: ResolvedBattery; issues: string[] } {
  const p = { ...BAT_DEFAULTS, ...input }
  const issues: string[] = []
  const L = BAT_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, BAT_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = Object.fromEntries((Object.keys(L) as Array<keyof typeof L>).map((k) => [k, c(k)])) as Record<keyof typeof L, number>
  const n = Math.round(q.cells)
  const profile: BatteryProfile = (['cycle', 'discharge', 'pulse', 'charge'] as const).includes(p.profile) ? p.profile : 'cycle'
  const rcPairs = p.rcPairs === 1 ? 1 : 2
  const tick = profile === 'pulse' ? 0.5 : 1
  const pulseOn = Math.max(tick, Math.round(q.pulseOn / tick) * tick)
  const pulseOff = Math.max(tick, Math.round(q.pulseOff / tick) * tick)
  const pulses = Math.round(q.pulses)
  const rest = Math.round(q.rest)
  const capN = CAP_PATTERN.slice(0, n)
  const socN = SOC_PATTERN.slice(0, n)
  const cm = Math.max(...capN.map(Math.abs))
  const sm = Math.max(...socN.map(Math.abs))
  const caps = capN.map((x) => q.capacity * (1 + (q.capSpread * x) / cm) * 3600)
  const s0 = socN.map((x) => Math.min(0.99, Math.max(0.01, q.soc0 + (q.socSpread * x) / sm)))
  const iNom = q.capacity
  const pre: Phase = { kind: 'rest', dur: 30, balance: false, name: 'rest' }
  const disLimit = ceilTo((1.5 * 3600) / q.crate, tick)
  const chLimit = ceilTo((1.5 * 3600) / q.chargeRate + 3600, tick)
  const dis: Phase = { kind: 'dis', dur: disLimit, balance: false, name: 'discharge' }
  const charge: Phase = { kind: 'charge', dur: chLimit, balance: true, name: 'charge (CC-CV)' }
  const after = (balance: boolean): Phase => ({ kind: 'rest', dur: rest, balance, name: balance ? 'rest after the charge' : 'rest' })
  const phases: Phase[] =
    profile === 'discharge'
      ? [pre, dis, after(false)]
      : profile === 'pulse'
        ? [pre, { kind: 'pulse', dur: pulses * (pulseOn + pulseOff), balance: false, name: 'pulses' }, { kind: 'rest', dur: Math.min(rest, 120), balance: false, name: 'rest' }]
        : profile === 'charge'
          ? [pre, charge, after(true)]
          : [pre, charge, after(true), dis, after(false)]
  const params: ResolvedBattery = {
    ...p,
    ...q,
    cells: n,
    profile,
    rcPairs,
    r2: rcPairs === 2 ? q.r2 : 0,
    pulseOn,
    pulseOff,
    pulses,
    rest,
    balancing: p.balancing === 'off' ? 'off' : 'on',
    n,
    q: caps,
    s0,
    iNom,
    iDis: q.crate * iNom,
    iCc: -q.chargeRate * iNom,
    iTerm: iNom / 20,
    tick,
    bmsT: 1,
    phases,
    socEst0: s0.reduce((a, b) => a + b, 0) / n,
    // filled in by the simulation (the run's length is not known in advance: the cut-off ends it)
    view: 'startup',
    periods: 1,
    stepsPerPeriod: 0,
    period: 0,
    dt: tick,
    duration: 0,
  }
  return { params, issues }
}

// ── The cell physics, shared by the SIMULATION (time-stepping) and the THEORY (exact flow) ────────────

/** E = OCV − u − w: the voltage behind R0. */
export const behindR0 = (s: number, u: number, w: number) => ocv(s) - u - w
/** Cell current for pack current I: the bleed resistor (β) draws V/Rbal from the cell on top of I. */
export function cellCurrent(p: ResolvedBattery, e: number, I: number, beta: number): number {
  return beta ? (p.rbal * I + e) / (p.rbal + p.r0) : I
}
/** Terminal voltage of a cell. */
export function cellVoltage(p: ResolvedBattery, e: number, I: number, beta: number): number {
  return e - p.r0 * cellCurrent(p, e, I, beta)
}
/** The pack current that holds a cell exactly at Vmax (negative = charging). */
export function holdCurrent(p: ResolvedBattery, e: number, beta: number): number {
  return (e - p.vmax * (1 + (beta * p.r0) / p.rbal)) / p.r0
}

/** Within a phase, the way the pack current is set. */
export type Mode = { kind: 'rest' } | { kind: 'load' } | { kind: 'cc' } | { kind: 'cv'; m: number }
export const modeKey = (m: Mode) => (m.kind === 'cv' ? `cv${m.m}` : m.kind)

/** Pack current in a mode, from the cell states (x packed [s, u, w] per cell). */
export function packCurrent(p: ResolvedBattery, mode: Mode, x: ArrayLike<number>, beta: ArrayLike<number>): number {
  if (mode.kind === 'rest') return 0
  if (mode.kind === 'load') return p.iDis
  if (mode.kind === 'cc') return p.iCc
  const m = mode.m
  return holdCurrent(p, behindR0(x[3 * m], x[3 * m + 1], x[3 * m + 2]), beta[m])
}

/** Charging: the active constraint — the CC current, or the cell that would exceed Vmax first. */
export function chargeMode(p: ResolvedBattery, x: ArrayLike<number>, beta: ArrayLike<number>): Mode {
  let best = p.iCc
  let m = -1
  for (let i = 0; i < p.n; i++) {
    const h = holdCurrent(p, behindR0(x[3 * i], x[3 * i + 1], x[3 * i + 2]), beta[i])
    if (h > best) {
      best = h
      m = i
    }
  }
  return m < 0 ? { kind: 'cc' } : { kind: 'cv', m }
}

/**
 * Event guards of a mode (an event happens when one turns positive): cut-off under load, CC → CV, a switch
 * of the held cell, CV → CC, and the end of the charge.
 */
export function guards(p: ResolvedBattery, mode: Mode, x: ArrayLike<number>, beta: ArrayLike<number>): Array<{ g: number; what: 'cutoff' | 'cv' | 'cv-cell' | 'cc' | 'full'; cell: number }> {
  const out: Array<{ g: number; what: 'cutoff' | 'cv' | 'cv-cell' | 'cc' | 'full'; cell: number }> = []
  const I = packCurrent(p, mode, x, beta)
  for (let i = 0; i < p.n; i++) {
    const e = behindR0(x[3 * i], x[3 * i + 1], x[3 * i + 2])
    if (mode.kind === 'load') out.push({ g: p.vmin - cellVoltage(p, e, I, beta[i]), what: 'cutoff', cell: i })
    else if (mode.kind === 'cc') out.push({ g: holdCurrent(p, e, beta[i]) - p.iCc, what: 'cv', cell: i })
    else if (mode.kind === 'cv' && i !== mode.m) out.push({ g: holdCurrent(p, e, beta[i]) - I, what: 'cv-cell', cell: i })
  }
  if (mode.kind === 'cv') {
    out.push({ g: p.iCc - I, what: 'cc', cell: mode.m })
    let bleeding = false
    for (let i = 0; i < p.n; i++) if (beta[i]) bleeding = true
    if (!bleeding) out.push({ g: I + p.iTerm, what: 'full', cell: mode.m })
  }
  return out
}

/**
 * The BMS balancing decision at a sample (balancing paused while it measures, so each cell reads E − R0·I):
 * bleed a cell more than `threshold` above the lowest; stop once within threshold/2.
 */
export function bmsBalance(p: ResolvedBattery, x: ArrayLike<number>, I: number, prev: ArrayLike<number>, allow: boolean): Uint8Array {
  const out = new Uint8Array(p.n)
  if (!allow || p.balancing !== 'on') return out
  const v = Array.from({ length: p.n }, (_, i) => behindR0(x[3 * i], x[3 * i + 1], x[3 * i + 2]) - p.r0 * I)
  const lo = Math.min(...v)
  for (let i = 0; i < p.n; i++) out[i] = v[i] - lo > (prev[i] ? p.threshold / 2 : p.threshold) ? 1 : 0
  return out
}

/** Pulse train: is the load on at t (the phase started at t0)? Edges lie on the tick grid. */
export function pulseOnAt(p: ResolvedBattery, t0: number, t: number): boolean {
  const c = p.pulseOn + p.pulseOff
  const rel = t - t0
  const k = Math.floor(rel / c + 1e-9)
  return k < p.pulses && rel - k * c < p.pulseOn - 1e-9
}

// ── SIMULATION ─────────────────────────────────────────────────────────────────────────────────────────

export type BatteryRun = Run<ResolvedBattery> & {
  /** Phase index per sample (of params.phases). */
  phaseAt: Uint8Array
  /** Start and end time of every phase that ran. */
  phaseSpan: Array<{ index: number; t0: number; t1: number; q0: number; q1: number; e0: number; e1: number; eb0: number; eb1: number }>
}

const RK = { a: [0, 0.5, 0.5, 1], w: [1 / 6, 1 / 3, 1 / 3, 1 / 6] }

/**
 * SIMULATION: classical fourth-order Runge–Kutta, fixed step (one tick: 1 s, or 0.5 s for pulses), on the
 * state [SOC, u, w] of every cell plus the pack's charge, energy and bleed-energy counters. Phase changes
 * that depend on the state (cut-off, CC → CV, held-cell switch, end of charge) are located inside the step
 * by bisection on the step length; the BMS samples, pulse edges and rest ends fall on the grid.
 */
export function simulateBattery(input: Partial<BatteryParams>): BatteryRun {
  const started = performance.now()
  const { params: p, issues } = resolveBattery(input)
  const N = p.n
  const NX = 3 * N + 3
  const IQ = 3 * N
  const IE = IQ + 1
  const IB = IQ + 2
  let y: Float64Array = new Float64Array(NX)
  for (let i = 0; i < N; i++) y[3 * i] = p.s0[i]
  let beta: Uint8Array = new Uint8Array(N)
  const dt = p.tick
  const deriv = (z: Float64Array, mode: Mode, out: Float64Array) => {
    const I = packCurrent(p, mode, z, beta)
    let vp = 0
    let pb = 0
    for (let i = 0; i < N; i++) {
      const e = behindR0(z[3 * i], z[3 * i + 1], z[3 * i + 2])
      const ic = cellCurrent(p, e, I, beta[i])
      out[3 * i] = -ic / p.q[i]
      out[3 * i + 1] = (p.r1 * ic - z[3 * i + 1]) / p.tau1
      out[3 * i + 2] = (p.r2 * ic - z[3 * i + 2]) / p.tau2
      const v = e - p.r0 * ic
      vp += v
      pb += v * (ic - I)
    }
    out[IQ] = I
    out[IE] = I * vp
    out[IB] = pb
  }
  const ks = Array.from({ length: 4 }, () => new Float64Array(NX))
  const tmp = new Float64Array(NX)
  const rk4 = (z: Float64Array, h: number, mode: Mode): Float64Array => {
    for (let s = 0; s < 4; s++) {
      if (s === 0) tmp.set(z)
      else for (let j = 0; j < NX; j++) tmp[j] = z[j] + RK.a[s] * h * ks[s - 1][j]
      deriv(tmp, mode, ks[s])
    }
    const out = new Float64Array(NX)
    for (let j = 0; j < NX; j++) out[j] = z[j] + h * (RK.w[0] * ks[0][j] + RK.w[1] * ks[1][j] + RK.w[2] * ks[2][j] + RK.w[3] * ks[3][j])
    return out
  }

  // ── run bookkeeping ──
  const names = ['ipack', 'vpack', 'vocv', 'vr0', 'vpol', 'soce', 'socavg', 'socmin', 'socmax', 'vmin', 'vmax', 'qpack', 'epack', 'pbleed', 'nbleed', 'mode']
  const cellNames = (pre: string) => Array.from({ length: N }, (_, i) => `${pre}${i + 1}`)
  const all = [...names, ...cellNames('v'), ...cellNames('s'), ...cellNames('b'), ...cellNames('u'), ...cellNames('w')]
  const cap = Math.ceil(p.phases.reduce((a, x) => a + x.dur, 0) / dt) + 12
  const sig: Record<string, Float64Array> = Object.fromEntries(all.map((k) => [k, new Float64Array(cap)]))
  const cv = (pre: string) => Array.from({ length: N }, (_, i) => sig[`${pre}${i + 1}`])
  const [SV, SS, SB, SU, SW] = [cv('v'), cv('s'), cv('b'), cv('u'), cv('w')]
  const time = new Float64Array(cap)
  const phaseAt = new Uint8Array(cap)
  let ns = 0
  const events: RunEvent[] = []
  let seq = 0
  const snapshot = (z: Float64Array, I: number): Record<string, number> => {
    let vp = 0
    let vo = 0
    let vr = 0
    let vpol = 0
    let pb = 0
    let nb = 0
    let smin = Infinity
    let smax = -Infinity
    let savg = 0
    let vmn = Infinity
    let vmx = -Infinity
    const out: Record<string, number> = {}
    for (let i = 0; i < N; i++) {
      const s = z[3 * i]
      const u = z[3 * i + 1]
      const w = z[3 * i + 2]
      const e = behindR0(s, u, w)
      const ic = cellCurrent(p, e, I, beta[i])
      const v = e - p.r0 * ic
      vp += v
      vo += ocv(s)
      vr += p.r0 * ic
      vpol += u + w
      pb += v * (ic - I)
      nb += beta[i]
      smin = Math.min(smin, s)
      smax = Math.max(smax, s)
      savg += s / N
      vmn = Math.min(vmn, v)
      vmx = Math.max(vmx, v)
      out[`v${i + 1}`] = v
      out[`s${i + 1}`] = 100 * s
      out[`b${i + 1}`] = beta[i]
      out[`u${i + 1}`] = u
      out[`w${i + 1}`] = w
    }
    Object.assign(out, {
      ipack: I,
      vpack: vp,
      vocv: vo,
      vr0: vr,
      vpol,
      soce: 100 * (p.socEst0 - (z[IQ] + p.iOffset * curT) / (3600 * p.capacity)),
      socavg: 100 * savg,
      socmin: 100 * smin,
      socmax: 100 * smax,
      vmin: vmn,
      vmax: vmx,
      qpack: z[IQ] / 3600,
      epack: z[IE],
      pbleed: pb,
      nbleed: nb,
    })
    return out
  }
  let curT = 0
  const push = (t: number, device: string, z: Float64Array, I: number, extra: Record<string, number> = {}) => {
    curT = t
    const s = snapshot(z, I)
    events.push({ id: `b${seq++}`, kind: 'mode', time: t, device, values: { ...s, q: z[IQ], e: z[IE], eb: z[IB], ...extra } })
  }

  let ph = 0
  let phT0 = 0
  let phEnd = ceilTo(p.phases[0].dur, dt)
  let mode: Mode = { kind: 'rest' }
  let lastI = 0
  const phaseSpan: BatteryRun['phaseSpan'] = []
  let span = { index: 0, t0: 0, t1: 0, q0: 0, q1: 0, e0: 0, e1: 0, eb0: 0, eb1: 0 }
  const modeFor = (t: number, z: Float64Array): Mode => {
    const k = p.phases[ph]?.kind
    if (k === 'dis') return { kind: 'load' }
    if (k === 'pulse') return pulseOnAt(p, phT0, t + 0.25 * dt) ? { kind: 'load' } : { kind: 'rest' }
    if (k === 'charge') return chargeMode(p, z, beta)
    return { kind: 'rest' }
  }
  const startPhase = (t: number, z: Float64Array) => {
    phT0 = t
    const P = p.phases[ph]
    phEnd = ceilTo(t + P.dur, dt)
    span = { index: ph, t0: t, t1: t, q0: z[IQ], q1: z[IQ], e0: z[IE], e1: z[IE], eb0: z[IB], eb1: z[IB] }
    if (P.kind === 'dis' || P.kind === 'pulse') push(t, 'load-on', z, p.iDis)
    if (P.kind === 'charge') push(t, 'charge-on', z, packCurrent(p, chargeMode(p, z, beta), z, beta))
  }
  /** End the phase (the event's values: the state with the current just before the end). */
  const endPhase = (t: number, z: Float64Array, device: string | null, cell = -1, iBefore = 0) => {
    phaseSpan.push({ ...span, t1: t, q1: z[IQ], e1: z[IE], eb1: z[IB] })
    if (device) push(t, device, z, iBefore, cell >= 0 ? { cell: cell + 1 } : {})
    ph++
    if (ph < p.phases.length) startPhase(t, z)
  }
  // the first phase starts at 0 (a rest)
  span = { index: 0, t0: 0, t1: 0, q0: 0, q1: 0, e0: 0, e1: 0, eb0: 0, eb1: 0 }

  const store = (t: number, I: number) => {
    const k = ns++
    let vp = 0
    let vo = 0
    let vr = 0
    let vpol = 0
    let pb = 0
    let nb = 0
    let smin = Infinity
    let smax = -Infinity
    let savg = 0
    let vmn = Infinity
    let vmx = -Infinity
    for (let i = 0; i < N; i++) {
      const s = y[3 * i]
      const u = y[3 * i + 1]
      const w = y[3 * i + 2]
      const e = behindR0(s, u, w)
      const ic = cellCurrent(p, e, I, beta[i])
      const v = e - p.r0 * ic
      vp += v
      vo += e + u + w
      vr += p.r0 * ic
      vpol += u + w
      pb += v * (ic - I)
      nb += beta[i]
      if (s < smin) smin = s
      if (s > smax) smax = s
      savg += s / N
      if (v < vmn) vmn = v
      if (v > vmx) vmx = v
      SV[i][k] = v
      SS[i][k] = 100 * s
      SB[i][k] = beta[i]
      SU[i][k] = u
      SW[i][k] = w
    }
    sig.ipack[k] = I
    sig.vpack[k] = vp
    sig.vocv[k] = vo
    sig.vr0[k] = vr
    sig.vpol[k] = vpol
    sig.soce[k] = 100 * (p.socEst0 - (y[IQ] + p.iOffset * t) / (3600 * p.capacity))
    sig.socavg[k] = 100 * savg
    sig.socmin[k] = 100 * smin
    sig.socmax[k] = 100 * smax
    sig.vmin[k] = vmn
    sig.vmax[k] = vmx
    sig.qpack[k] = y[IQ] / 3600
    sig.epack[k] = y[IE]
    sig.pbleed[k] = pb
    sig.nbleed[k] = nb
    sig.mode[k] = mode.kind === 'rest' ? 0 : mode.kind === 'load' ? 1 : mode.kind === 'cc' ? 2 : 3
    time[k] = t
    phaseAt[k] = Math.min(ph, p.phases.length - 1)
  }
  store(0, 0)
  const maxSteps = cap - 2
  let k = 0
  for (; k < maxSteps && ph < p.phases.length; k++) {
    const t = k * dt
    // 1. phases that end by time at this instant
    while (ph < p.phases.length && t >= phEnd - 1e-9) {
      const P = p.phases[ph]
      endPhase(t, y, P.kind === 'rest' ? null : P.kind === 'pulse' ? 'pulses-done' : 'timer', -1, lastI)
    }
    if (ph >= p.phases.length) break
    // 2. the BMS samples (every 1 s): balancing decision with the current just before this instant
    if (Math.abs(t / p.bmsT - Math.round(t / p.bmsT)) < 1e-9) {
      const nb = bmsBalance(p, y, lastI, beta, p.phases[ph].balance)
      const was = beta
      beta = nb
      for (let i = 0; i < N; i++) if (nb[i] !== was[i]) push(t, nb[i] ? 'bleed-on' : 'bleed-off', y, lastI, { cell: i + 1 })
    }
    // 3. the mode for this step (pulse edges on the grid)
    const prevMode = mode
    mode = modeFor(t, y)
    if (p.phases[ph].kind === 'pulse' && modeKey(prevMode) !== modeKey(mode) && t > phT0 + 1e-9) push(t, mode.kind === 'load' ? 'pulse-on' : 'pulse-off', y, packCurrent(p, mode, y, beta))
    if (p.phases[ph].kind === 'charge' && modeKey(prevMode) !== modeKey(mode) && !(prevMode.kind === 'rest' && mode.kind === 'cc'))
      push(t, mode.kind === 'cc' ? 'cc' : prevMode.kind === 'cv' ? 'cv-cell' : 'cv', y, packCurrent(p, mode, y, beta), mode.kind === 'cv' ? { cell: mode.m + 1 } : {})
    // 4. integrate to t + dt, locating the state events
    let tt = t
    const tEnd = t + dt
    for (let guard = 0; guard < 24 && tt < tEnd - 1e-12 && ph < p.phases.length; guard++) {
      const h = tEnd - tt
      // an event already due at the start (e.g. a cut-off the instant a load starts)
      const g0 = guards(p, mode, y, beta)
      let fired = g0.find((g) => g.g > 0)
      let hS = 0
      if (!fired) {
        const y1 = rk4(y, h, mode)
        const g1 = guards(p, mode, y1, beta)
        if (!g1.some((g) => g.g > 0)) {
          y = y1
          tt = tEnd
          break
        }
        let lo = 0
        let hi = h
        for (let it = 0; it < 52; it++) {
          const mid = 0.5 * (lo + hi)
          if (guards(p, mode, rk4(y, mid, mode), beta).some((g) => g.g > 0)) hi = mid
          else lo = mid
        }
        y = rk4(y, hi, mode)
        hS = hi
        const gs = guards(p, mode, y, beta)
        fired = gs.reduce((a, b) => (b.g > a.g ? b : a), gs[0])
      }
      tt += hS
      // apply the transition
      if (fired.what === 'cutoff') {
        lastI = 0
        endPhase(tt, y, 'cutoff', fired.cell, packCurrent(p, mode, y, beta))
        mode = { kind: 'rest' }
      } else if (fired.what === 'full') {
        endPhase(tt, y, 'charge-end', -1, packCurrent(p, mode, y, beta))
        mode = { kind: 'rest' }
      } else {
        const next = chargeMode(p, y, beta)
        if (modeKey(next) === modeKey(mode)) {
          // the guard sits exactly on its boundary: step on in the same mode
          y = rk4(y, Math.min(h - hS, dt * 1e-9), mode)
          tt += Math.min(h - hS, dt * 1e-9)
          continue
        }
        mode = next
        push(tt, next.kind === 'cc' ? 'cc' : fired.what === 'cv' ? 'cv' : 'cv-cell', y, packCurrent(p, mode, y, beta), next.kind === 'cv' ? { cell: next.m + 1 } : {})
      }
      if (ph < p.phases.length && p.phases[ph].kind === 'rest') mode = { kind: 'rest' }
    }
    lastI = packCurrent(p, mode, y, beta)
    store(tEnd, lastI)
  }
  if (ph < p.phases.length) issues.push('the run was cut short')
  const n = ns
  const duration = time[n - 1]
  const params: ResolvedBattery = { ...p, stepsPerPeriod: n - 1, period: duration, duration, dt }
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'battery',
    params,
    length: n,
    time: time.slice(0, n),
    signals: Object.fromEntries(Object.entries(sig).map(([kk, v]) => [kk, v.slice(0, n)])),
    devices: [],
    events,
    steadyFrom: 0,
    phaseAt: phaseAt.slice(0, n),
    phaseSpan,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}
