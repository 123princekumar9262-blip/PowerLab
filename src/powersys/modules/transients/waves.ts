import { computeLine, EPS0, MU0, presetDesign } from '../line-params/calc.ts'

/*
 * Module 15 — Transients & insulation coordination. Every number on the page comes from here (no React).
 *
 * Model and assumptions (shown on screen too):
 *  - One lossless line: distributed series inductance L and shunt capacitance C per metre, no resistance, no
 *    conductance, no corona or skin-effect attenuation, one propagation mode (a real three-phase line carries a surge in
 *    several modes; this lab uses one, with the line's operating L and C from Module 8).
 *  - The source is an ideal voltage e(t) behind a resistance R_s at x = 0; the far end (x = ℓ) is a resistive
 *    termination (open, short, matched, a resistor, or a long cable/line whose surge impedance acts as a resistor) and
 *    an optional surge arrester modelled as an IDEAL CLAMP: no current below its residual voltage V_res, any current
 *    needed to hold |v| = V_res above it (a simplification of a real metal-oxide arrester's steep V–I curve).
 *  - Sign conventions: x is measured from the source towards the termination. Each travelling wave's current is
 *    positive in ITS OWN direction of travel, i_wave = v_wave / Z_c. The line current i(x, t) is reported positive in
 *    +x (towards the termination): i = (v_forward − v_backward) / Z_c.
 *
 * Units: kV, A (kA inside: kV/Ω), µs, m, m/µs, Ω.
 */

/** Speed of light [m/µs]. */
export const C_LIGHT = 299.792458

// ── the media: an overhead line from Module 8, and a cable ──────────────────────────────────────────────────────

export type MediumId = 'ohl-twin' | 'ohl-single' | 'cable'
export interface Medium {
  id: MediumId
  name: string
  short: string
  kind: 'overhead' | 'cable'
  /** Per-unit-length inductance and capacitance (mH/km = µH/m, nF/km = pF/m). */
  lMhKm: number
  cNfKm: number
  /** Surge impedance √(L/C) [Ω] and velocity 1/√(LC) [m/µs]. */
  zc: number
  v: number
  /** Where the numbers come from. */
  source: string
}

export const surgeImpedance = (lHm: number, cFm: number): number => Math.sqrt(lHm / cFm)
/** 1/√(LC) in m/µs (L in H/m, C in F/m). */
export const velocity = (lHm: number, cFm: number): number => 1 / Math.sqrt(lHm * cFm) / 1e6

function medium(id: MediumId, name: string, short: string, kind: Medium['kind'], lMhKm: number, cNfKm: number, source: string): Medium {
  const l = lMhKm * 1e-6
  const c = cNfKm * 1e-12
  return { id, name, short, kind, lMhKm, cNfKm, zc: surgeImpedance(l, c), v: velocity(l, c), source }
}

function fromModule8(n: 1 | 2): Medium {
  const d = presetDesign('horizontal', 11, 15, { n })
  const r = computeLine(d.geometry, d.options)
  if (!r.ok) throw new Error('Module 8 preset is invalid')
  return medium(
    n === 2 ? 'ohl-twin' : 'ohl-single',
    n === 2 ? '400 kV overhead line, twin bundle (Module 8)' : '400 kV overhead line, single conductor (Module 8)',
    n === 2 ? 'Overhead line (twin)' : 'Overhead line (single)',
    'overhead',
    r.lMhKm,
    r.cNfKm,
    `Module 8’s computed operating L and C of its default flat 400 kV line (${n === 2 ? 'twin bundle' : 'one conductor per phase'})`,
  )
}

/** A coaxial cable: typical XLPE values (illustrative, not a particular cable). */
export const CABLE_TYPICAL = { epsR: 2.3, rcMm: 20, riMm: 50 }
export function cableMedium(epsR = CABLE_TYPICAL.epsR, rcMm = CABLE_TYPICAL.rcMm, riMm = CABLE_TYPICAL.riMm): Medium {
  const ln = Math.log(riMm / rcMm)
  // external inductance only: at surge frequencies the current flows on the conductor surface (skin effect)
  const l = (MU0 / (2 * Math.PI)) * ln
  const c = (2 * Math.PI * EPS0 * epsR) / ln
  return medium(
    'cable',
    `Cable (XLPE, ε_r ${epsR}, conductor ${rcMm} mm, insulation to ${riMm} mm radius)`,
    'Cable',
    'cable',
    l * 1e6,
    c * 1e12,
    `coaxial formulas with typical values (ε_r = ${epsR}, radii ${rcMm} and ${riMm} mm) — illustrative, not a particular cable`,
  )
}

export const MEDIA: Record<MediumId, Medium> = { 'ohl-twin': fromModule8(2), 'ohl-single': fromModule8(1), cable: cableMedium() }

// ── reflection and transmission ────────────────────────────────────────────────────────────────────────────────

/** Voltage reflection coefficient at a load Z_L (Infinity = open end). */
export function gammaOf(zl: number, zc: number): number {
  if (zl === Infinity) return 1
  return (zl - zc) / (zl + zc)
}
/** Voltage transmission coefficient 1 + Γ = 2Z_L/(Z_L + Z_c) (the end voltage ÷ the incident wave). */
export const tauOf = (zl: number, zc: number): number => 1 + gammaOf(zl, zc)
/** Current reflection coefficient −Γ (each wave's current measured in its own direction of travel). */
export const gammaIOf = (zl: number, zc: number): number => -gammaOf(zl, zc)
/** Current transmission coefficient 1 − Γ = 2Z_c/(Z_L + Z_c) (the load current ÷ the incident current wave). */
export const tauIOf = (zl: number, zc: number): number => 1 - gammaOf(zl, zc)

// ── surge shapes ───────────────────────────────────────────────────────────────────────────────────────────────

export type SurgeKind = 'step' | 'impulse' | 'switching' | 'ramp'
export const SURGE_LABEL: Record<SurgeKind, string> = { step: 'Step', impulse: '1.2/50 µs impulse', switching: 'Switching (energise)', ramp: 'Ramp front' }

/** Times of a double exponential (e^(−αt) − e^(−βt)), α, β in 1/µs, by the conventional test-waveform definition. */
export interface ImpulseTimes {
  tPeak: number
  /** Normalising factor: the peak of e^(−αt) − e^(−βt). */
  eta: number
  t30: number
  t90: number
  /** Front time T1 = (t90 − t30)/0.6. */
  front: number
  /** Virtual origin O1 = t30 − 0.3·T1. */
  origin: number
  /** Instant the tail falls to half the peak. */
  t50: number
  /** Time to half value T2 = t50 − O1. */
  tail: number
}

const dexpRaw = (a: number, b: number, t: number) => Math.exp(-a * t) - Math.exp(-b * t)

function bisect(f: (t: number) => number, lo: number, hi: number): number {
  let a = lo
  let b = hi
  const fa = f(a)
  for (let k = 0; k < 200; k++) {
    const m = (a + b) / 2
    if (f(m) * fa > 0) a = m
    else b = m
  }
  return (a + b) / 2
}

export function impulseTimes(alpha: number, beta: number): ImpulseTimes {
  const tPeak = Math.log(beta / alpha) / (beta - alpha)
  const eta = dexpRaw(alpha, beta, tPeak)
  const w = (t: number) => dexpRaw(alpha, beta, t) / eta
  const t30 = bisect((t) => w(t) - 0.3, 0, tPeak)
  const t90 = bisect((t) => w(t) - 0.9, 0, tPeak)
  let hi = tPeak * 2 + 1
  while (w(hi) > 0.5) hi *= 2
  const t50 = bisect((t) => w(t) - 0.5, tPeak, hi)
  const front = (t90 - t30) / 0.6
  const origin = t30 - 0.3 * front
  return { tPeak, eta, t30, t90, front, origin, t50, tail: t50 - origin }
}

/** Fit α and β (1/µs) so that the front and tail times equal T1 and T2 (Newton's method on ln α, ln β). */
export function fitImpulse(T1 = 1.2, T2 = 50): { alpha: number; beta: number; iterations: number } {
  let x = [Math.log(0.0146), Math.log(2.47)]
  const res = (p: number[]) => {
    const r = impulseTimes(Math.exp(p[0]), Math.exp(p[1]))
    return [r.front / T1 - 1, r.tail / T2 - 1]
  }
  let it = 0
  for (; it < 40; it++) {
    const r0 = res(x)
    if (Math.abs(r0[0]) < 1e-12 && Math.abs(r0[1]) < 1e-12) break
    const h = 1e-6
    const J = [0, 1].map((j) => {
      const xp = [...x]
      xp[j] += h
      const r1 = res(xp)
      return [(r1[0] - r0[0]) / h, (r1[1] - r0[1]) / h]
    })
    // J[j][i] = ∂r_i/∂x_j → solve [∂r/∂x] Δ = −r
    const a = J[0][0]
    const b = J[1][0]
    const c = J[0][1]
    const d = J[1][1]
    const det = a * d - b * c
    const dx0 = (-r0[0] * d + r0[1] * b) / det
    const dx1 = (-r0[1] * a + r0[0] * c) / det
    x = [x[0] + dx0, x[1] + dx1]
  }
  return { alpha: Math.exp(x[0]), beta: Math.exp(x[1]), iterations: it }
}

/** The lightning-impulse shape used here: fitted once to the conventional 1.2/50 µs definition. */
export const LI_FIT = (() => {
  const f = fitImpulse(1.2, 50)
  return { ...f, times: impulseTimes(f.alpha, f.beta) }
})()

/** System voltage behind the switching (energising) case: 1 pu = peak phase-to-earth voltage of a 400 kV system. */
export const SWITCHING_KV_LL = 400
export const PU_KV = (Math.SQRT2 * SWITCHING_KV_LL) / Math.sqrt(3)

/** Tolerance on time comparisons [µs]: a wave that has just arrived counts as arrived. */
const T_EPS = 1e-9

/** The source voltage e(t) [kV] of a surge (zero before t = 0). */
export function surgeValue(kind: SurgeKind, ekv: number, steep: number, t: number): number {
  if (t < -T_EPS) return 0
  switch (kind) {
    case 'step':
      return ekv
    case 'switching':
      return PU_KV
    case 'ramp':
      return Math.min(steep * Math.max(0, t), ekv)
    case 'impulse': {
      const tt = Math.max(0, t)
      return (ekv * dexpRaw(LI_FIT.alpha, LI_FIT.beta, tt)) / LI_FIT.times.eta
    }
  }
}
/** Step-like surges: the source is constant from t = 0, so every wave is a step (lattice values are exact voltages). */
export const isStepLike = (k: SurgeKind) => k === 'step' || k === 'switching'
/** The source's final value (for the DC steady state): the impulse returns to zero. */
export const surgeFinal = (kind: SurgeKind, ekv: number): number => (kind === 'impulse' ? 0 : kind === 'switching' ? PU_KV : ekv)
/** The crest of the source voltage [kV]. */
export const surgeCrest = (kind: SurgeKind, ekv: number): number => (kind === 'switching' ? PU_KV : ekv)

// ── the line model ─────────────────────────────────────────────────────────────────────────────────────────────

export type Termination = 'open' | 'short' | 'matched' | 'resistor' | 'junction'
export const TERM_LABEL: Record<Termination, string> = { open: 'Open', short: 'Short', matched: 'Matched', resistor: 'Resistor', junction: 'Junction' }

export interface WaveModel {
  line: MediumId
  lengthKm: number
  /** Source resistance [Ω]. */
  rs: number
  term: Termination
  /** Terminating resistance for 'resistor' [Ω]. */
  rl: number
  surge: SurgeKind
  /** Surge amplitude (step height / impulse crest / ramp crest) [kV]; the switching case uses 1 pu instead. */
  ekv: number
  /** Front steepness of the ramp surge [kV/µs]. */
  steep: number
  arrester: boolean
  /** Arrester residual (clamp) voltage [kV]. */
  vres: number
}

export const MODEL0: WaveModel = { line: 'ohl-twin', lengthKm: 3, rs: 50, term: 'open', rl: 1500, surge: 'step', ekv: 1000, steep: 1000, arrester: false, vres: 850 }

export const LIMITS = { lengthKm: [0.5, 20], rs: [0, 2000], rl: [5, 5000], ekv: [50, 3000], steep: [50, 5000], vres: [100, 3000] } as const

/** The medium on the other side of a junction: a cable after an overhead line, an overhead line after a cable. */
export const nextMedium = (m: WaveModel): Medium => (MEDIA[m.line].kind === 'cable' ? MEDIA['ohl-twin'] : MEDIA.cable)

/** The load the line sees at its far end [Ω] (Infinity = open). A long line/cable beyond a junction looks like its Z_c. */
export function loadOf(m: WaveModel): number {
  const zc = MEDIA[m.line].zc
  switch (m.term) {
    case 'open':
      return Infinity
    case 'short':
      return 0
    case 'matched':
      return zc
    case 'resistor':
      return m.rl
    case 'junction':
      return nextMedium(m).zc
  }
}

export interface Issue {
  field: keyof WaveModel
  message: string
}
export function validate(m: WaveModel): Issue[] {
  const out: Issue[] = []
  const pos = (k: keyof WaveModel, v: number, name: string, unit: string, allowZero = false) => {
    if (!Number.isFinite(v)) out.push({ field: k, message: `${name} must be a number.` })
    else if (allowZero ? v < 0 : v <= 0) out.push({ field: k, message: `${name} must be ${allowZero ? 'zero or more' : 'greater than zero'} (${unit}).` })
  }
  pos('lengthKm', m.lengthKm, 'The line length', 'km')
  pos('rs', m.rs, 'The source resistance', 'Ω', true)
  if (m.term === 'resistor') pos('rl', m.rl, 'The terminating resistance', 'Ω')
  pos('ekv', m.ekv, 'The surge amplitude', 'kV')
  if (m.surge === 'ramp') pos('steep', m.steep, 'The front steepness', 'kV/µs')
  if (m.arrester) pos('vres', m.vres, 'The arrester residual voltage', 'kV')
  if (!(m.line in MEDIA)) out.push({ field: 'line', message: 'Unknown line type.' })
  return out
}

export interface Analysis {
  ok: true
  model: WaveModel
  line: Medium
  lengthM: number
  /** One-way travel time ℓ/v [µs]. */
  T: number
  /** Time shown: eight travel times [µs]. */
  window: number
  zc: number
  zl: number
  gammaL: number
  tauL: number
  gammaS: number
  /** Fraction of e(t) launched into the line: Z_c/(R_s + Z_c). */
  k: number
  /** Product Γ_s·Γ_L: each round trip multiplies the waves by it. */
  rho: number
}
export type Outcome = Analysis | { ok: false; issues: Issue[] }

export const WINDOW_T = 8

export function analyse(m: WaveModel): Outcome {
  const issues = validate(m)
  if (issues.length) return { ok: false, issues }
  const line = MEDIA[m.line]
  const lengthM = m.lengthKm * 1000
  const T = lengthM / line.v
  const zc = line.zc
  const zl = loadOf(m)
  const gammaL = gammaOf(zl, zc)
  const gammaS = gammaOf(m.rs, zc)
  return { ok: true, model: m, line, lengthM, T, window: WINDOW_T * T, zc, zl, gammaL, tauL: 1 + gammaL, gammaS, k: zc / (m.rs + zc), rho: gammaS * gammaL }
}

// ── the solution: forward and backward wave functions ──────────────────────────────────────────────────────────

/** What happens at the far end when a wave A arrives there (with the termination and the optional clamp). */
export interface EndState {
  /** Incident wave [kV]. */
  a: number
  /** Reflected wave [kV]. */
  r: number
  /** End voltage [kV]. */
  v: number
  /** Line current arriving at the end, + towards the end [A]. */
  iLine: number
  /** Current in the termination [A]. */
  iLoad: number
  /** Current in the arrester [A] (0 when it does not conduct or is not fitted). */
  iArr: number
  clamped: boolean
}

export function endResponse(an: Analysis, a: number): EndState {
  const { zc, zl, gammaL } = an
  let v = (1 + gammaL) * a
  let clamped = false
  if (an.model.arrester && Math.abs(v) > an.model.vres) {
    v = Math.sign(v) * an.model.vres
    clamped = true
  }
  const r = v - a
  const iLine = ((a - r) / zc) * 1000
  const iLoad = zl === Infinity ? 0 : zl === 0 ? iLine : (v / zl) * 1000
  return { a, r, v, iLine, iLoad, iArr: clamped ? iLine - iLoad : 0, clamped }
}

export interface Field {
  an: Analysis
  /** Source voltage e(t) [kV]. */
  e(t: number): number
  /** Forward wave leaving x = 0 at time t [kV]. */
  F(t: number): number
  /** Backward wave leaving x = ℓ at time t [kV]. */
  R(t: number): number
  /** Voltage at position x [m] and time t [µs] [kV]. */
  v(x: number, t: number): number
  /** Line current at x, t, positive towards the termination [A]. */
  i(x: number, t: number): number
  /** The far end at time t. */
  end(t: number): EndState
}

/**
 * The exact solution of the lossless line (d'Alembert): v(x, t) = F(t − x/v) + R(t − (ℓ − x)/v), with
 *   F(t) = k·e(t) + Γ_s·R(t − T)    (the source end re-reflects what returns)
 *   R(t) = end response to F(t − T)  (Γ_L·F for a resistive end; the clamp with an arrester)
 * F and R are zero before t = 0. The recursion is exact in continuous time; it unrolls into the Bewley lattice.
 */
export function makeField(an: Analysis): Field {
  const { T, k, gammaS, lengthM } = an
  const { surge, ekv, steep } = an.model
  const vel = an.line.v
  const e = (t: number) => surgeValue(surge, ekv, steep, t)
  const F = (t: number): number => (t < -T_EPS ? 0 : k * e(t) + (gammaS === 0 ? 0 : gammaS * R(t - T)))
  const R = (t: number): number => (t < -T_EPS ? 0 : endResponse(an, F(t - T)).r)
  const v = (x: number, t: number) => F(t - x / vel) + R(t - (lengthM - x) / vel)
  const i = (x: number, t: number) => ((F(t - x / vel) - R(t - (lengthM - x) / vel)) / an.zc) * 1000
  return { an, e, F, R, v, i, end: (t: number) => endResponse(an, F(t - T)) }
}

// ── the Bewley lattice ─────────────────────────────────────────────────────────────────────────────────────────

export interface LatticeSeg {
  dir: 'fwd' | 'bwd'
  /** Index of the round trip (0 = the first wave). */
  n: number
  t0: number
  t1: number
  x0: number
  x1: number
  /** Multiplier relative to the first launched wave k·e: (Γ_sΓ_L)^n, or Γ_L(Γ_sΓ_L)^n (linear ends only). */
  mult: number | null
  /** The new wave's value [kV]: the step it adds behind its front — step-like surges only (each wave is a constant step). */
  value: number | null
}

/** The zig-zag of the lattice up to the time shown, with each wave's multiplier and (step-like surges) its value. */
export function latticeSegments(f: Field): LatticeSeg[] {
  const { T, window, lengthM, gammaL, rho } = f.an
  const linear = !f.an.model.arrester
  const step = isStepLike(f.an.model.surge)
  const out: LatticeSeg[] = []
  for (let n = 0; 2 * n * T < window - 1e-9; n++) {
    out.push({ dir: 'fwd', n, t0: 2 * n * T, t1: (2 * n + 1) * T, x0: 0, x1: lengthM, mult: linear ? rho ** n : null, value: step ? f.F(2 * n * T + T / 2) - f.F(2 * n * T - T / 2) : null })
    if ((2 * n + 1) * T < window - 1e-9)
      out.push({
        dir: 'bwd',
        n,
        t0: (2 * n + 1) * T,
        t1: (2 * n + 2) * T,
        x0: lengthM,
        x1: 0,
        mult: linear ? gammaL * rho ** n : null,
        value: step ? f.R((2 * n + 1) * T + T / 2) - f.R((2 * n + 1) * T - T / 2) : null,
      })
  }
  return out
}

/** One term of the lattice sum at (x, t): a wave that has passed the point, its multiplier and delay. */
export interface LatticeTerm {
  dir: 'fwd' | 'bwd'
  n: number
  mult: number
  /** Delay from t = 0 until this wave reaches x [µs]. */
  delay: number
  /** Its contribution k·mult·e(t − delay) [kV]. */
  value: number
}

/**
 * The Bewley lattice sum at (x, t) for a LINEAR termination (no arrester):
 *   v = Σₙ k(Γ_sΓ_L)ⁿ [ e(t − 2nT − x/v) + Γ_L e(t − (2n+1)T − (ℓ − x)/v) ]
 * Only waves that have reached x by time t contribute, so the sum is finite and exact.
 */
export function latticeSum(an: Analysis, x: number, t: number): { v: number; terms: LatticeTerm[] } {
  const { T, k, gammaL, rho, lengthM } = an
  const { surge, ekv, steep } = an.model
  const vel = an.line.v
  const terms: LatticeTerm[] = []
  for (let n = 0; ; n++) {
    const df = 2 * n * T + x / vel
    if (t < df - T_EPS) break
    const mf = rho ** n
    terms.push({ dir: 'fwd', n, mult: mf, delay: df, value: k * mf * surgeValue(surge, ekv, steep, t - df) })
    const db = (2 * n + 1) * T + (lengthM - x) / vel
    if (t < db - T_EPS) break
    const mb = gammaL * rho ** n
    terms.push({ dir: 'bwd', n, mult: mb, delay: db, value: k * mb * surgeValue(surge, ekv, steep, t - db) })
    if (n > 10000) break
  }
  return { v: terms.reduce((s, q) => s + q.value, 0), terms }
}

// ── steady state, first peaks, convergence ─────────────────────────────────────────────────────────────────────

export type SteadyState =
  { kind: 'value'; v: number; iA: number; arresterHolds: boolean } | { kind: 'decays' } | { kind: 'none'; reason: string; note: string; swing?: [number, number]; growthA?: number }

const kvTxt = (x: number) => `${Math.abs(x) < 0.05 ? '0' : x.toFixed(Math.abs(x - Math.round(x)) < 0.05 ? 0 : 1)} kV`

/**
 * The DC steady state, in closed form: v = E·Z_L/(R_s + Z_L) everywhere, i = E/(R_s + Z_L) — or, with an arrester
 * whose V_res is below that, V_res held by the clamp. With R_s = 0 (and an open or shorted end, or an arrester that
 * would have to hold less than E) the lossless model has special cases, each found in closed form:
 *  - an arrester below E: the ideal source and the clamp fight; the current grows by 2(E − V_res)/Z_c per round trip;
 *  - a short: the current grows by 2E/Z_c per round trip;
 *  - an open end without a clamp that acts (2E ≤ V_res): the end swings 0 ↔ 2E for ever;
 *  - an open end with E ≤ V_res < 2E: with G = F − E/2 (F the wave arriving at the end) and d = V_res − E, each
 *    arrival either lowers G by d (while the clamp conducts, G > d/2) or reverses it (G ↦ −G). So G ends in a
 *    2-cycle G* ↔ −G* with G* = E/2 − m·d, m = ⌈E/(2d) − ½⌉: the end swings E ± 2|G*| — a steady state E only when
 *    E/2 is a whole multiple of d (and for V_res = E, where the arrester carries E/Z_c for ever).
 */
export function steadyState(an: Analysis): SteadyState {
  const { surge, ekv, rs, arrester, vres } = an.model
  if (surge === 'impulse') return { kind: 'decays' }
  const E = surgeFinal(surge, ekv)
  const tol = 1e-9 * Math.max(1, E)
  if (arrester && rs === 0 && an.zl !== 0 && E > vres + tol) {
    const growthA = ((2 * (E - vres)) / an.zc) * 1000
    return {
      kind: 'none',
      note: 'arrester current grows without limit',
      growthA,
      reason: `With R_s = 0 the ideal source holds ${kvTxt(E)} at the line’s input while the arrester holds the far end at V_res = ${kvTxt(vres)}. The difference drives a current into the arrester that grows by 2(E − V_res)/Z_c = ${growthA.toFixed(0)} A every round trip, without limit — there is no steady state (with an ideal source and an ideal clamp; a real arrester would fail).`,
    }
  }
  if (Math.abs(an.rho) >= 1 - 1e-12) {
    if (an.zl === 0) {
      const growthA = ((2 * E) / an.zc) * 1000
      return {
        kind: 'none',
        note: 'current grows without limit',
        growthA,
        reason: `With R_s = 0 and a short-circuited end there is no resistance anywhere: the current grows by 2E/Z_c = ${growthA.toFixed(0)} A every round trip, so there is no steady state.`,
      }
    }
    // open end, R_s = 0
    if (!arrester || 2 * E <= vres + tol)
      return {
        kind: 'none',
        note: `swings 0 ↔ ${kvTxt(2 * E)} for ever`,
        swing: [0, 2 * E],
        reason: `With R_s = 0 and an open end every wave is reflected in full at both ends (Γ_s·Γ_L = −1)${arrester ? ' and the end never reaches V_res' : ''}: the far end swings between 0 and ${kvTxt(2 * E)} for ever on a lossless line — no steady state.`,
      }
    const d = vres - E
    if (d <= tol) return { kind: 'value', v: E, iA: (E / an.zc) * 1000, arresterHolds: true }
    const m = Math.ceil(E / (2 * d) - 0.5 - 1e-12)
    const amp = 2 * Math.abs(E / 2 - m * d)
    if (amp <= 1e-6 * Math.max(1, E)) return { kind: 'value', v: E, iA: 0, arresterHolds: false }
    return {
      kind: 'none',
      note: `keeps swinging ${kvTxt(E - amp)} ↔ ${kvTxt(E + amp)}`,
      swing: [E - amp, E + amp],
      reason: `The arrester trims the overshoot while the end would exceed V_res, but with no resistance anywhere else the rest is reflected in full at both ends: the far end keeps alternating between ${kvTxt(E - amp)} and ${kvTxt(E + amp)} (around E = ${kvTxt(E)}) — no steady state on this lossless model.`,
    }
  }
  const zl = an.zl
  let v = zl === Infinity ? E : (E * zl) / (rs + zl)
  let iA = zl === Infinity ? 0 : (E / (rs + zl)) * 1000
  let arresterHolds = false
  if (arrester && Math.abs(v) > vres) {
    // the clamp holds V_res: the source drives (E − V_res)/R_s (R_s > 0 here), the load takes V_res/Z_L
    v = Math.sign(v) * vres
    iA = ((E - v) / rs) * 1000
    arresterHolds = true
  }
  return { kind: 'value', v, iA, arresterHolds }
}

/**
 * The far-end voltage on each round trip of a step-like surge: the value between the (2n+1)-th and (2n+3)-th
 * travel times, read at its middle, with the closed-form steady state and the remaining error.
 */
export function convergence(f: Field, rounds = 8): Array<{ n: number; t: number; v: number; err: number | null }> {
  const ss = steadyState(f.an)
  const { T } = f.an
  return Array.from({ length: rounds }, (_, n) => {
    const t = (2 * n + 2) * T
    const v = f.v(f.an.lengthM, t)
    return { n, t, v, err: ss.kind === 'value' ? v - ss.v : null }
  })
}

/**
 * The first peak at a point: the largest |v| between the first arrival at x and the arrival of the first wave
 * re-reflected by the source (2T later) — a measure that does not depend on how long the run is shown.
 */
export function firstPeak(f: Field, x: number, samples = 600): { v: number; t: number } {
  const { T, lengthM } = f.an
  const t0 = x / f.an.line.v
  const t1 = 2 * T + t0
  let best = { v: 0, t: t0 }
  for (let s = 0; s <= samples; s++) {
    const t = t0 + ((t1 - t0) * s) / samples
    const v = f.v(Math.min(x, lengthM), t)
    if (Math.abs(v) > Math.abs(best.v)) best = { v, t }
  }
  return best
}

/** The far-end voltage just after the first wave arrives, ÷ the incident wave (= 1 + Γ_L for a linear end). */
export function arrivalRatio(f: Field): number {
  const { T } = f.an
  const inc = f.F(T / 2)
  return inc === 0 ? NaN : f.v(f.an.lengthM, T + T / 2) / inc
}

// ── samples for plots and the 3D wave ──────────────────────────────────────────────────────────────────────────

export function timeSeries(f: Field, x: number, n = 800, what: 'v' | 'i' = 'v'): Array<[number, number]> {
  const w = f.an.window
  return Array.from({ length: n + 1 }, (_, s) => {
    const t = (w * s) / n
    return [t, what === 'v' ? f.v(x, t) : f.i(x, t)] as [number, number]
  })
}

/** v(x) along the line at time t [x in km, v in kV] — the one function behind both the 2D snapshot and the 3D wave. */
export function profile(f: Field, t: number, n = 240): Array<[number, number]> {
  const L = f.an.lengthM
  return Array.from({ length: n + 1 }, (_, s) => {
    const x = (L * s) / n
    return [x / 1000, f.v(x, t)] as [number, number]
  })
}

/** The largest |v| anywhere on the line in the time shown (for drawing scales only). */
export function maxAbsV(f: Field): number {
  const { window, lengthM } = f.an
  let m = 0
  for (let a = 0; a <= 40; a++)
    for (let b = 0; b <= 160; b++) {
      const v = Math.abs(f.v((lengthM * a) / 40, (window * b) / 160))
      if (v > m) m = v
    }
  return m
}

/** Times at which waves reach a point x (up to the time shown): direct arrivals and reflections. */
export function arrivals(an: Analysis, x: number): Array<{ t: number; dir: 'fwd' | 'bwd'; n: number }> {
  const out: Array<{ t: number; dir: 'fwd' | 'bwd'; n: number }> = []
  const vel = an.line.v
  for (let n = 0; ; n++) {
    const tf = 2 * n * an.T + x / vel
    if (tf > an.window + 1e-9) break
    out.push({ t: tf, dir: 'fwd', n })
    const tb = (2 * n + 1) * an.T + (an.lengthM - x) / vel
    if (tb > an.window + 1e-9) break
    if (Math.abs(tb - tf) > 1e-9) out.push({ t: tb, dir: 'bwd', n })
  }
  return out
}

// ── energy at a boundary ───────────────────────────────────────────────────────────────────────────────────────

/** Power balance at a resistive end: incident = reflected + absorbed (per kV² of incident wave, in 1/Ω). */
export function powerSplit(zl: number, zc: number): { incident: number; reflected: number; absorbed: number } {
  const g = gammaOf(zl, zc)
  const absorbed = zl === Infinity || zl === 0 ? 0 : (1 + g) ** 2 / zl
  return { incident: 1 / zc, reflected: g ** 2 / zc, absorbed }
}

// ── insulation coordination: protective margin and separation distance ───────────────────────────────────────

/** Protective margin (BIL − V)/V. */
export const margin = (bil: number, v: number): number => (bil - v) / v

export interface SepCase {
  /** Surge impedance [Ω] (cancels out of the voltages; kept for currents) and velocity [m/µs]. */
  zc: number
  v: number
  /** Separation between the arrester and the transformer [m]. */
  dM: number
  /** Front steepness of the incoming ramp [kV/µs] and its crest [kV]. */
  s: number
  ekv: number
  /** Arrester residual voltage [kV]. */
  vres: number
}
export const SEP0 = { dM: 30, s: 2000, ekv: 2000, vres: 850, bil: 1300 }
export const SEP_LIMITS = { dM: [0, 60], s: [100, 5000], ekv: [500, 4000], vres: [300, 2000], bil: [400, 3000] } as const

/** The incoming wave at the arrester: a ramp of steepness S up to the crest E (ramp-and-hold). */
export const rampWave = (s: number, ekv: number, t: number) => (t < 0 ? 0 : Math.min(s * t, ekv))

/** The approximate rule V_t ≈ V_res + 2·S·d/v, and when its derivation holds. */
export function separationFormula(c: SepCase): { value: number; extra: number; valid: boolean; reasons: string[]; tc: number } {
  const tau = c.dM / c.v
  const extra = 2 * c.s * tau
  const reasons: string[] = []
  // the arrester operates when a(t) + a(t − 2τ) = V_res, i.e. at t_c = (V_res + 2Sτ)/(2S) (if the reflection is back by then)
  const tc = (c.vres + extra) / (2 * c.s)
  if (extra > c.vres)
    reasons.push(`2Sd/v = ${extra.toFixed(0)} kV exceeds V_res: the reflection from the transformer is not back before the arrester operates (the voltage there is limited to 2·V_res instead)`)
  if (c.s * tc > c.ekv) reasons.push('the incoming wave reaches its crest before the arrester operates (the rule assumes the front is still rising)')
  if (2 * c.ekv <= c.vres) reasons.push('the surge never reaches the residual voltage, so the arrester never operates')
  return { value: c.vres + extra, extra, valid: reasons.length === 0, reasons, tc }
}

export interface SepRun {
  t: number[]
  /** Arrester-node voltage, transformer voltage, incoming wave [kV]. */
  va: number[]
  vt: number[]
  a: number[]
  dt: number
  vtMax: number
  vaMax: number
  tEnd: number
  /** Read-out resolution of the peak: the voltage can move at most 2S per µs, so a sample is within 2S·Δt of it [kV]. */
  peakTol: number
}

/**
 * Arrester at distance d before an open-ended transformer, an incoming ramp from a long (matched) line. Exact
 * characteristic recursion sampled on a grid with Δt = 2τ/M (τ = d/v): forward wave into the stub
 *   f(t) = clamp(a(t) + f(t − 2τ)) − f(t − 2τ),   v_A = clamp(a + f(t − 2τ)),   v_T(t) = 2 f(t − τ).
 * The run lasts to the crest plus 6τ: after the crest the stub is periodic (period 4τ), so the peak is final.
 */
/** The largest |x| of an array (a loop: long runs would overflow Math.max(...xs)). */
export function maxAbs(xs: ArrayLike<number>): number {
  let m = 0
  for (let k = 0; k < xs.length; k++) if (Math.abs(xs[k]) > m) m = Math.abs(xs[k])
  return m
}

export function separationRun(c: SepCase, maxM = 400, maxSamples = 40000, minEnd = 0): SepRun {
  const tau = c.dM / c.v
  const clamp = (x: number) => (Math.abs(x) > c.vres ? Math.sign(x) * c.vres : x)
  const tCrest = c.ekv / c.s
  if (tau === 0) {
    const tEnd = Math.max(minEnd, tCrest * 1.5)
    const n = 2000
    const dt = tEnd / n
    const t: number[] = []
    const va: number[] = []
    const a: number[] = []
    for (let k = 0; k <= n; k++) {
      t.push(k * dt)
      a.push(rampWave(c.s, c.ekv, k * dt))
      va.push(clamp(2 * a[k]))
    }
    const vmax = maxAbs(va)
    return { t, va, vt: va, a, dt, vtMax: vmax, vaMax: vmax, tEnd, peakTol: 2 * c.s * dt }
  }
  const tEnd = Math.max(minEnd, tCrest + 6 * tau + tCrest * 0.25)
  // samples per 2τ: up to maxM, fewer for a long run (an even number, so v_T = 2f(t − τ) falls on the grid)
  const M = Math.max(2, Math.min(maxM, 2 * Math.round((maxSamples * tau) / tEnd)))
  const dt = (2 * tau) / M
  const n = Math.ceil(tEnd / dt)
  const f = new Float64Array(n + 1)
  const t: number[] = []
  const va: number[] = []
  const vt: number[] = []
  const a: number[] = []
  for (let k = 0; k <= n; k++) {
    const ak = rampWave(c.s, c.ekv, k * dt)
    const back = k >= M ? f[k - M] : 0
    const vA = clamp(ak + back)
    f[k] = vA - back
    t.push(k * dt)
    a.push(ak)
    va.push(vA)
    vt.push(k >= M / 2 ? 2 * f[k - M / 2] : 0)
  }
  return {
    t,
    va,
    vt,
    a,
    dt,
    vtMax: maxAbs(vt),
    vaMax: maxAbs(va),
    tEnd,
    peakTol: 2 * c.s * dt,
  }
}

// ── words from numbers ─────────────────────────────────────────────────────────────────────────────────────────

/** A ratio described in words, always with the number beside it. */
export function ratioWords(r: number): string {
  if (!Number.isFinite(r)) return 'undefined'
  if (Math.abs(r - 2) < 0.02) return 'doubled'
  if (Math.abs(r - 1) < 0.005) return 'unchanged'
  if (Math.abs(r) < 0.005) return 'zero'
  if (r > 1.5) return 'nearly doubled'
  if (r > 1) return 'raised'
  if (r > 0) return 'reduced'
  return 'reversed'
}

/** Γ described: full / partial, positive / negative reflection. */
export function reflectionWords(g: number): string {
  if (Math.abs(g) < 1e-9) return 'no reflection'
  if (Math.abs(g - 1) < 1e-9) return 'full positive reflection'
  if (Math.abs(g + 1) < 1e-9) return 'full negative reflection'
  return `${Math.abs(g) > 0.5 ? 'a large' : 'a partial'} ${g > 0 ? 'positive' : 'negative'} reflection`
}
