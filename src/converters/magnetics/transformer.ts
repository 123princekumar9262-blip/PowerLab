import { simulatePwl, type PwlEvent, type PwlResult, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'
import { inductances, MU0 } from './core.ts'

/**
 * MAGNETICS — a two-winding transformer driven by a square-wave bridge (±V) or a sine source, with an
 * optional DC offset, feeding an R (or R + L) load. The T-equivalent circuit, referred to the primary
 * (a = N1/N2; a secondary quantity x' is x·a² for R and L, i2·N2/N1 = i2/a for the current):
 *
 *   v1 ── R1 ── Ll1 ──┬── Ll2' ── R2' ── RL' (+ LL')
 *                     │
 *                 magnetising branch: λm = N1·B·Ae  (vm = dλm/dt)
 *
 * The magnetising branch is the SAME two-slope B–H core as the gapped inductor (converters/magnetics/core.ts):
 *   |B| ≤ Bsat: Lm = N1²·μ0·Ae/(lg + le/μr);   |B| > Bsat: Lsat = N1²·μ0·Ae/(lg + le/μsat)
 * so the magnetising current im(λm) is continuous and piecewise linear in λm.
 *
 * States: the core flux density B = λm/(N1·Ae) and j = i2·N2/N1 (the secondary current referred to the primary);
 * i1 = im(λm) + j (KCL at the magnetising node, i.e. N1·i1 − N2·i2 = N1·im: Ampère). (B rather than λm keeps the
 * two states on comparable scales, so the solvers' stiffness test sees only the circuit's real time constants.) A sine source adds its own oscillator
 * (s, c) = (sin, cos)(ωt + φ) as two more linear states, so both drives are exact PWL systems.
 *
 *   KVL primary:   v1 = R1·i1 + Ll1·di1/dt + vm
 *   KVL secondary: vm = (R2' + RL')·j + (Ll2' + LL')·dj/dt
 * With i1' = am·λm' + j' in the region where im = am·λm + cm, solving for λm' and j' gives
 *   λm' = (v1 − R1·i1 + Ll1·Rs·j/Ls)/(1 + Ll1·am + Ll1/Ls),   j' = (λm' − Rs·j)/Ls,
 * Rs = R2' + RL', Ls = Ll2' + LL' (> 0: the secondary always has some leakage).
 *
 * Modes: the core region ('lin', 'sat+', 'sat−') and the sign of j ('p'/'n'): the sign never changes the
 * equations; it only makes the solvers locate the instant the secondary current reverses (the current transfer
 * that leakage slows down). Core losses (hysteresis, eddy currents) are NOT modelled: the only losses are the
 * winding resistances.
 */
export type XfSource = 'square' | 'sine'
export interface XfParams {
  source: XfSource
  /** Square: the bridge's ±V; sine: the peak voltage [V]. */
  v: number
  f: number
  /** DC offset of the source [V] (a bridge's duty error has the same effect). */
  voff: number
  n1: number
  n2: number
  /** Load resistance [Ω] and optional load series inductance [H] (on the secondary). */
  rload: number
  lload: number
  r1: number
  r2: number
  /** Leakage inductances of each winding [H] (each on its own side). */
  ll1: number
  ll2: number
  ae: number
  le: number
  lg: number
  mur: number
  bsat: number
  musat: number
  view: 'steady' | 'startup'
  /** Start-up (sine): switch-on angle φ [°] — 0 = at a voltage zero crossing, 90 = at the peak. */
  phase: number
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedXf extends XfParams, RunParams {
  /** Turns ratio a = N1/N2. */
  a: number
  /** Magnetising inductance (unsaturated, saturated) [H], primary side; saturation flux linkage [Wb-turns]. */
  lm: number
  lsat: number
  lamS: number
  /** Referred secondary: R2', Ll2', RL', LL', Rs = R2' + RL', Ls = Ll2' + LL'. */
  r2r: number
  ll2r: number
  rlr: number
  llr: number
  rs: number
  ls: number
  /** Current-transfer time constant (Lm neglected): (Ll1 + Ls)/(R1 + Rs). */
  tauLk: number
  /** Decay of a DC flux offset: Lm/(R1 ∥ Rs). */
  tauM: number
  omega: number
}

export const XF_DEFAULTS: XfParams = {
  source: 'square',
  v: 48,
  f: 50e3,
  voff: 0,
  n1: 20,
  n2: 10,
  rload: 5,
  lload: 0,
  r1: 0.05,
  r2: 0.02,
  ll1: 2e-6,
  ll2: 0.5e-6,
  ae: 100e-6,
  le: 80e-3,
  lg: 0,
  mur: 2000,
  bsat: 0.35,
  musat: 1,
  view: 'steady',
  phase: 0,
  periods: 0,
  stepsPerPeriod: 0,
}

export const XF_LIMITS = {
  v: { min: 1, max: 400 },
  f: { min: 1e3, max: 500e3 },
  voff: { min: -5, max: 5 },
  n1: { min: 1, max: 200 },
  n2: { min: 1, max: 200 },
  rload: { min: 0.5, max: 500 },
  lload: { min: 0, max: 1e-3 },
  r1: { min: 1e-3, max: 5 },
  r2: { min: 1e-3, max: 5 },
  ll1: { min: 0, max: 200e-6 },
  ll2: { min: 0.01e-6, max: 200e-6 },
  ae: { min: 5e-6, max: 1e-3 },
  le: { min: 10e-3, max: 300e-3 },
  lg: { min: 0, max: 5e-3 },
  mur: { min: 100, max: 20000 },
  bsat: { min: 0.2, max: 1.5 },
  musat: { min: 1, max: 100 },
  phase: { min: 0, max: 90 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveXf(input: Partial<XfParams>): { params: ResolvedXf; issues: string[] } {
  const p = { ...XF_DEFAULTS, ...input }
  const issues: string[] = []
  const L = XF_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, XF_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    v: c('v'),
    f: c('f'),
    voff: c('voff'),
    n1: Math.round(c('n1')),
    n2: Math.round(c('n2')),
    rload: c('rload'),
    lload: c('lload'),
    r1: c('r1'),
    r2: c('r2'),
    ll1: c('ll1'),
    ll2: c('ll2'),
    ae: c('ae'),
    le: c('le'),
    lg: c('lg'),
    mur: c('mur'),
    bsat: c('bsat'),
    musat: c('musat'),
    phase: c('phase'),
  }
  if (q.musat > q.mur) q.musat = q.mur
  const source: XfSource = p.source === 'sine' ? 'sine' : 'square'
  const view = p.view === 'startup' ? 'startup' : 'steady'
  const { l1: lm, l2: lsat } = inductances({ n: q.n1, ae: q.ae, le: q.le, lg: q.lg, mur: q.mur, musat: q.musat })
  const a = q.n1 / q.n2
  const a2 = a * a
  const r2r = q.r2 * a2
  const ll2r = q.ll2 * a2
  const rlr = q.rload * a2
  const llr = q.lload * a2
  const rs = r2r + rlr
  const ls = ll2r + llr
  const T = 1 / q.f
  const tauLk = (q.ll1 + ls) / (q.r1 + rs)
  const tauM = lm / ((q.r1 * rs) / (q.r1 + rs))
  // enough steps to resolve the current transfer (≥ 10 per leakage time constant), within a sample budget
  const periods = view === 'steady' ? 2 : p.periods > 0 ? Math.min(40, Math.round(p.periods)) : 8
  const budget = view === 'steady' ? 8000 : 48000
  let spp = Math.max(400, Math.min(4000, Math.ceil((10 * T) / tauLk)))
  spp = Math.min(spp, Math.floor(budget / periods))
  // an explicit step count (convergence checks) overrides the automatic one
  if (p.stepsPerPeriod > 0) spp = Math.max(40, Math.min(20000, Math.round(p.stepsPerPeriod)))
  spp = 2 * Math.round(spp / 2)
  const params: ResolvedXf = {
    ...p,
    ...q,
    source,
    view,
    // the switch-on angle matters only from rest; the steady state is shown from a zero crossing
    phase: view === 'startup' ? q.phase : 0,
    periods,
    stepsPerPeriod: spp,
    period: T,
    dt: T / spp,
    duration: periods * T,
    a,
    lm,
    lsat,
    lamS: q.n1 * q.bsat * q.ae,
    r2r,
    ll2r,
    rlr,
    llr,
    rs,
    ls,
    tauLk,
    tauM,
    omega: 2 * Math.PI * q.f,
  }
  return { params, issues }
}

export type XfRegion = 'lin' | 'sat+' | 'sat−'

/** Region of the B–H curve for a magnetising flux linkage. */
export const xfRegionOf = (p: ResolvedXf, lam: number): XfRegion => (lam > p.lamS ? 'sat+' : lam < -p.lamS ? 'sat−' : 'lin')
/** The core region part of a mode ('lin/p' → 'lin'). */
export const regionOfMode = (mode: string): XfRegion => (mode.split('/')[0] || 'lin') as XfRegion

/** im(λ) = am·λ + cm in a region (continuous at ±λs). */
export function magCoeffs(p: ResolvedXf, region: XfRegion): { am: number; cm: number } {
  if (region === 'lin') return { am: 1 / p.lm, cm: 0 }
  const c = p.lamS * (1 / p.lm - 1 / p.lsat)
  return { am: 1 / p.lsat, cm: region === 'sat+' ? c : -c }
}
export const magCurrentOf = (p: ResolvedXf, lam: number) => {
  const k = magCoeffs(p, xfRegionOf(p, lam))
  return k.am * lam + k.cm
}

/** Core field strength H [A/m] from B (the same two-slope curve as the gapped inductor). */
export function xfHOf(p: ResolvedXf, b: number): number {
  const hs = p.bsat / (MU0 * p.mur)
  if (Math.abs(b) <= p.bsat) return b / (MU0 * p.mur)
  return Math.sign(b) * (hs + (Math.abs(b) - p.bsat) / (MU0 * p.musat))
}

/** Square drive: the bridge level (±V, without the offset) on the interval containing t (an edge takes the new value). */
export function squareLevel(p: ResolvedXf, t: number): number {
  const m = Math.floor(t / p.period + 1e-9)
  return t - m * p.period < 0.5 * p.period - 1e-9 * p.period ? p.v : -p.v
}

/** Edges of the square drive in (t0, t1). */
export function xfBreakpoints(p: ResolvedXf, t0 = 0, t1 = p.duration): number[] {
  if (p.source !== 'square') return []
  const out: number[] = []
  const m1 = Math.ceil(t1 / p.period) + 1
  for (let m = Math.max(0, Math.floor(t0 / p.period) - 1); m <= m1; m++)
    for (const t of [m * p.period, (m + 0.5) * p.period]) if (t > t0 + 1e-12 * p.period && t < t1 - 1e-12 * p.period) out.push(t)
  return out
}

/** Number of states: [B, j] (+ the sine's oscillator [s, c]). */
export const xfStates = (p: ResolvedXf) => (p.source === 'sine' ? 4 : 2)

/** Initial oscillator state for a sine starting at angle φ. */
export const oscStart = (phaseDeg: number) => [Math.sin((phaseDeg * Math.PI) / 180), Math.cos((phaseDeg * Math.PI) / 180)]

/** The source voltage for a state x on an interval whose inputs are those at tIn. */
export function sourceV(p: ResolvedXf, x: ArrayLike<number>, tIn: number): number {
  return p.source === 'sine' ? p.v * x[2] + p.voff : squareLevel(p, tIn) + p.voff
}

/** dλm/dt and dj/dt as linear functions of (λ, j, v1) in a region. */
function rates(p: ResolvedXf, region: XfRegion) {
  const { am, cm } = magCoeffs(p, region)
  const D = 1 + p.ll1 * am + p.ll1 / p.ls
  const aL = (-p.r1 * am) / D
  const aJ = (-p.r1 + (p.ll1 * p.rs) / p.ls) / D
  const aV = 1 / D
  const a0 = (-p.r1 * cm) / D
  return { am, cm, aL, aJ, aV, a0, bL: aL / p.ls, bJ: (aJ - p.rs) / p.ls, bV: aV / p.ls, b0: a0 / p.ls }
}

/** Flux linkage λm = N1·Ae·B of a state. */
export const lamOf = (p: ResolvedXf, x: ArrayLike<number>) => x[0] * p.n1 * p.ae

/** Mode: core region and the sign of the referred secondary current (kept at zero: no spurious event). */
export function xfMode(p: ResolvedXf, x: ArrayLike<number>, prev: string): string {
  const prevSign = prev.split('/')[1]
  const sign = x[1] > 0 ? 'p' : x[1] < 0 ? 'n' : prevSign || 'p'
  return `${xfRegionOf(p, lamOf(p, x))}/${sign}`
}

/** The transformer as a PWL system (converters/pwl.ts). */
export function xfSystem(p: ResolvedXf, breakpoints = xfBreakpoints(p)): PwlSystem {
  const n = xfStates(p)
  return {
    n,
    breakpoints,
    mode: (x, _t, prev) => xfMode(p, x, prev),
    sys(mode, t) {
      const k = rates(p, regionOfMode(mode))
      // state B = λm/na: the λm row divided by na, the λm column multiplied by na
      const na = p.n1 * p.ae
      if (p.source === 'square') {
        const v1 = squareLevel(p, t) + p.voff
        return {
          A: [
            [k.aL, k.aJ / na],
            [k.bL * na, k.bJ],
          ],
          b: [(k.aV * v1 + k.a0) / na, k.bV * v1 + k.b0],
        }
      }
      const w = p.omega
      return {
        A: [
          [k.aL, k.aJ / na, (k.aV * p.v) / na, 0],
          [k.bL * na, k.bJ, k.bV * p.v, 0],
          [0, 0, 0, w],
          [0, 0, -w, 0],
        ],
        b: [(k.aV * p.voff + k.a0) / na, k.bV * p.voff + k.b0, 0, 0],
      }
    },
  }
}

/** Every circuit quantity from the state (the same algebra for the simulation and the theory). */
export interface XfOutputs {
  v1: number
  vm: number
  v2: number
  i1: number
  i2: number
  j: number
  im: number
  b: number
  djdt: number
  di1dt: number
}
export function xfOutputs(p: ResolvedXf, x: ArrayLike<number>, tIn: number, region: XfRegion = xfRegionOf(p, lamOf(p, x))): XfOutputs {
  const k = rates(p, region)
  const lam = lamOf(p, x)
  const j = x[1]
  const v1 = sourceV(p, x, tIn)
  const vm = k.aL * lam + k.aJ * j + k.aV * v1 + k.a0
  const djdt = (vm - p.rs * j) / p.ls
  const im = k.am * lam + k.cm
  const v2r = vm - p.r2r * j - p.ll2r * djdt
  return { v1, vm, v2: v2r / p.a, i1: im + j, i2: j * p.a, j, im, b: lam / (p.n1 * p.ae), djdt, di1dt: k.am * vm + djdt }
}

/** Energy stored in the magnetising field ∫ im dλ (from λ = 0), along the two-slope curve. */
export function magEnergy(p: ResolvedXf, lam: number): number {
  const a = Math.min(Math.abs(lam), p.lamS)
  let w = (0.5 * a * a) / p.lm
  if (Math.abs(lam) > p.lamS) {
    const d = Math.abs(lam) - p.lamS
    w += (p.lamS / p.lm) * d + (0.5 * d * d) / p.lsat
  }
  return w
}

/** Newton shooting on an n-dimensional one-period map (finite-difference Jacobian, damped). */
export function shootPeriodic(map: (x: number[]) => number[], guess: number[], scales: number[]): { x: number[]; iterations: number; residual: number } {
  const n = guess.length
  let x = [...guess]
  let residual = Infinity
  let it = 0
  const res = (y: number[], fx: number[]) => Math.max(...fx.map((v, i) => Math.abs(v - y[i]) / scales[i]))
  for (; it < 40; it++) {
    const fx = map(x)
    residual = res(x, fx)
    if (residual < 1e-12) break
    const F = fx.map((v, i) => v - x[i])
    // Jacobian of F(x) = map(x) − x
    const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    for (let c = 0; c < n; c++) {
      const h = 1e-7 * scales[c]
      const xh = [...x]
      xh[c] += h
      const fh = map(xh)
      for (let r = 0; r < n; r++) J[r][c] = (fh[r] - xh[r] - F[r]) / h
    }
    const step = solveSmall(J, F.map((v) => -v))
    if (!step) break
    // a saturated core makes the map very flat: limit each step to a few unsaturated scales
    let lim = 1
    for (let i = 0; i < n; i++) lim = Math.max(lim, Math.abs(step[i]) / (4 * scales[i]))
    for (let i = 0; i < n; i++) x[i] += step[i] / lim
  }
  return { x, iterations: it, residual }
}

function solveSmall(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (!(Math.abs(M[piv][c]) > 0)) return null
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let q = c; q <= n; q++) M[r][q] -= f * M[c][q]
    }
  }
  return M.map((r, i) => r[n] / r[i])
}

/** Inverse of im(λ): the flux linkage that carries a magnetising current i. */
export function lamForCurrent(p: ResolvedXf, i: number): number {
  const iS = p.lamS / p.lm
  if (Math.abs(i) <= iS) return i * p.lm
  return Math.sign(i) * (p.lamS + (Math.abs(i) - iS) * p.lsat)
}

/**
 * A good start for the periodic steady state: the mean magnetising current is Voff/R1 (the windings' mean
 * voltage is zero), the flux swings ±(volt-seconds)/2 around the flux of that current, and the referred
 * secondary current flows as through the resistive divider.
 */
export function xfSteadyGuess(p: ResolvedXf): number[] {
  const na = p.n1 * p.ae
  const lamDc = lamForCurrent(p, p.voff / p.r1)
  if (p.source === 'square') return [(lamDc - (0.25 * p.v) / p.f) / na, -p.v / (p.r1 + p.rs)]
  // sine sin(ωt + φ): λm ≈ λdc − (V/ω)·cos(ωt + φ)
  return [(lamDc - (p.v / p.omega) * Math.cos((p.phase * Math.PI) / 180)) / na, 0]
}

/** Scales of the steady-state residual: the flux swing (or Bsat) and the larger of the load and magnetising currents. */
export const xfScales = (p: ResolvedXf) => [Math.max(p.bsat, p.v / (p.f * p.n1 * p.ae)), Math.max(p.v / (p.r1 + p.rs), (0.25 * p.v) / (p.f * p.lm), 1e-9)]

/** A run: the stored signals plus the solver's own states (λm, j and, for a sine, the oscillator) per sample. */
export type XfRun = Run<ResolvedXf> & { modes: string[]; pwlEvents: PwlEvent[]; knots: PwlResult['knots']; xs: Float64Array[] }

/** The start of the run: from rest (start-up) or the periodic steady state (shooting on the simulation itself). */
function startState(p: ResolvedXf, solve: (x0: number[]) => number[]): { x0: number[]; steady: XfRun['diagnostics']['steady'] } {
  if (p.view === 'startup') return { x0: p.source === 'sine' ? [0, 0, ...oscStart(p.phase)] : [0, 0], steady: { method: 'startup', iterations: 0, residual: NaN, converged: false } }
  const osc = p.source === 'sine' ? oscStart(p.phase) : []
  const map = (x: number[]) => solve([...x, ...osc]).slice(0, 2)
  const sh = shootPeriodic(map, xfSteadyGuess(p), xfScales(p))
  return { x0: [...sh.x, ...osc], steady: { method: 'shooting', iterations: sh.iterations, residual: sh.residual, converged: sh.residual < 1e-9 } }
}

export function simulateXf(input: Partial<XfParams>): XfRun {
  const started = performance.now()
  const { params: p, issues } = resolveXf(input)
  const sys1 = xfSystem(p, xfBreakpoints(p, 0, p.period))
  const solve1 = (x0: number[]) => {
    const r = simulatePwl(sys1, x0, 0, p.period, p.stepsPerPeriod, xfMode(p, x0, ''))
    return r.x.map((a) => a[p.stepsPerPeriod])
  }
  const { x0, steady: st0 } = startState(p, solve1)
  let steady = st0
  const sys = xfSystem(p)
  const steps = p.periods * p.stepsPerPeriod
  const res = simulatePwl(sys, x0, 0, p.duration, steps, xfMode(p, x0, ''))
  const n = steps + 1
  const names = ['v1', 'v2', 'v2i', 'vm', 'i1', 'i2', 'i2r', 'im', 'b', 'h', 'lm', ...(p.source === 'square' ? ['gate'] : [])]
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  const x = new Array<number>(res.x.length)
  for (let k = 0; k < n; k++) {
    for (let q = 0; q < x.length; q++) x[q] = res.x[q][k]
    const t = res.t[k]
    // a sample holds the interval ending there: its inputs and its region
    const tIn = k > 0 ? t - 0.5 * p.dt : 0
    const region = regionOfMode(res.modes[k])
    const o = xfOutputs(p, x, tIn, region)
    s.v1[k] = o.v1
    s.v2[k] = o.v2
    s.v2i[k] = (o.v1 * p.n2) / p.n1
    s.vm[k] = o.vm
    s.i1[k] = o.i1
    s.i2[k] = o.i2
    s.i2r[k] = o.j
    s.im[k] = o.im
    s.b[k] = o.b
    s.h[k] = xfHOf(p, o.b)
    s.lm[k] = region === 'lin' ? p.lm : p.lsat
    if (s.gate) s.gate[k] = squareLevel(p, tIn) > 0 ? 1 : 0
  }
  if (p.view === 'startup') {
    // how far the last period still is from the periodic steady state (found by shooting, phase 0 of the source):
    // the flux offset of a switch-on decays only with Lm/(R1 ∥ Rs), usually thousands of periods
    const st = startState({ ...p, view: 'steady' }, solve1)
    const k = (p.periods - 1) * p.stepsPerPeriod
    const sc = xfScales(p)
    const residual = Math.max(Math.abs(res.x[0][k] - st.x0[0]) / sc[0], Math.abs(res.x[1][k] - st.x0[1]) / sc[1])
    steady = { method: 'startup', iterations: 0, residual, converged: residual < 2e-3 }
  }
  const events: RunEvent[] = []
  let seq = 0
  const stateAt = (t: number): number[] => {
    const kn = res.knots.find((y) => Math.abs(y.t - t) <= 1e-9 * p.dt)
    if (kn) return kn.x
    const k = Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
    return res.x.map((a) => a[k])
  }
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const y = stateAt(t)
    const o = xfOutputs(p, y, t + 1e-6 * p.dt)
    events.push({ id: `x${seq++}`, kind, time: t, device, values: { i1: o.i1, i2: o.i2, im: o.im, b: o.b, v1: o.v1 } })
  }
  if (p.source === 'square')
    for (let m = 0; m < p.periods; m++) {
      if (m > 0) ev('gate-on', m * p.period, '+V')
      ev('gate-off', (m + 0.5) * p.period, '−V')
    }
  for (const e of res.events) {
    const [r0, s0] = e.from.split('/')
    const [r1, s1] = e.to.split('/')
    if (r0 !== r1) ev('mode', e.t, `core:${r0}→${r1}`)
    if (s0 !== s1 && s0 && s1) ev('mode', e.t, `i2:${s0}→${s1}`)
  }
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'transformer',
    params: p,
    length: n,
    time: res.t,
    signals: s,
    devices: [],
    events,
    steadyFrom: p.view === 'steady' ? 0 : (p.periods - 1) * p.stepsPerPeriod,
    modes: res.modes,
    pwlEvents: res.events,
    knots: res.knots,
    xs: res.x,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady, issues },
  }
}

// ── Measurements (the simulation's) ─────────────────────────────────────────

export interface XfPeriodStats {
  v1rms: number
  v2rms: number
  i1rms: number
  i2rms: number
  i1dc: number
  /** Magnetising current: amplitude (max − min)/2, largest |im|, mean. */
  imPk: number
  imMax: number
  imDc: number
  /** Largest |i1| in the period. */
  i1Max: number
  bpk: number
  dB: number
  bdc: number
  p1: number
  p2: number
  pcu1: number
  pcu2: number
  satFrac: number
  /** Square drive: time from the +V edge until the secondary current reverses (null for a sine). */
  tRev: number | null
}

export interface XfMeasurements extends XfPeriodStats {
  /** V2rms/V1rms and the turns ratio N2/N1. */
  ratio: number
  turns: number
  /** 1 − V2rms/(V1rms·N2/N1): the drop from the ideal transformer's voltage. */
  regulation: number
  eff: number
  /** (P1 − P2 − losses)/P1: the energy balance of the period (0 = conserved). */
  balance: number
  /** Primary power factor P1/(V1rms·I1rms). */
  pf: number
  /** Whole run (start-up). */
  iPeakRun: number
  bPeakRun: number
  tSat: number | null
  settled: boolean
  saturated: boolean
}

/** Accumulates period statistics from points (t, state) with the interval's inputs and region. */
export class XfAccumulator {
  private s = { v1: 0, v2: 0, i1: 0, i1s: 0, i2s: 0, im: 0, lam: 0, p1: 0, p2: 0 }
  lamMax = -Infinity
  lamMin = Infinity
  imMax = -Infinity
  imMin = Infinity
  i1Abs = 0
  private p: ResolvedXf
  constructor(p: ResolvedXf) {
    this.p = p
  }
  /** Extremes of the continuous quantities at a point. */
  point(x: ArrayLike<number>) {
    const p = this.p
    const lam = lamOf(p, x)
    const im = magCurrentOf(p, lam)
    this.lamMax = Math.max(this.lamMax, lam)
    this.lamMin = Math.min(this.lamMin, lam)
    this.imMax = Math.max(this.imMax, im)
    this.imMin = Math.min(this.imMin, im)
    this.i1Abs = Math.max(this.i1Abs, Math.abs(im + x[1]))
  }
  /** Adds w·f(x) for every integrated quantity, with the given inputs and region. */
  weight(x: ArrayLike<number>, w: number, tIn: number, region: XfRegion) {
    const o = xfOutputs(this.p, x, tIn, region)
    const s = this.s
    s.v1 += w * o.v1 * o.v1
    s.v2 += w * o.v2 * o.v2
    s.i1 += w * o.i1
    s.i1s += w * o.i1 * o.i1
    s.i2s += w * o.i2 * o.i2
    s.im += w * o.im
    s.lam += w * lamOf(this.p, x)
    s.p1 += w * o.v1 * o.i1
    s.p2 += w * o.v2 * o.i2
  }
  stats(T: number, satFrac: number, tRev: number | null): XfPeriodStats {
    const p = this.p
    const s = this.s
    const na = p.n1 * p.ae
    const i1rms = Math.sqrt(s.i1s / T)
    const i2rms = Math.sqrt(s.i2s / T)
    return {
      v1rms: Math.sqrt(s.v1 / T),
      v2rms: Math.sqrt(s.v2 / T),
      i1rms,
      i2rms,
      i1dc: s.i1 / T,
      imPk: (this.imMax - this.imMin) / 2,
      imMax: Math.max(Math.abs(this.imMax), Math.abs(this.imMin)),
      imDc: s.im / T,
      i1Max: this.i1Abs,
      bpk: Math.max(Math.abs(this.lamMax), Math.abs(this.lamMin)) / na,
      dB: (this.lamMax - this.lamMin) / na,
      bdc: s.lam / T / na,
      p1: s.p1 / T,
      p2: s.p2 / T,
      pcu1: p.r1 * i1rms * i1rms,
      pcu2: p.r2 * i2rms * i2rms,
      satFrac,
      tRev,
    }
  }
}

/** Time spent saturated in [t0, t1] from the mode at t0 and the mode changes (the same rule for the theory). */
export function xfSatTime(events: PwlEvent[], mode0: string, t0: number, t1: number): number {
  let region = regionOfMode(mode0)
  let t = t0
  let acc = 0
  for (const e of events) {
    if (e.t <= t0 || e.t > t1) continue
    if (region !== 'lin') acc += e.t - t
    t = e.t
    region = regionOfMode(e.to)
  }
  if (region !== 'lin') acc += t1 - t
  return acc
}

/** Square drive: the first reversal n → p of the secondary current after the +V edge at t0. */
export function xfReversal(p: ResolvedXf, events: PwlEvent[], t0: number): number | null {
  if (p.source !== 'square') return null
  const e = events.find((x) => x.t > t0 && x.t < t0 + 0.5 * p.period && x.from.split('/')[1] === 'n' && x.to.split('/')[1] === 'p')
  return e ? e.t - t0 : null
}

/** Derived results shared by the simulation's and the theory's statistics. */
export function xfDerived(p: ResolvedXf, st: XfPeriodStats) {
  const turns = p.n2 / p.n1
  const ratio = st.v2rms / Math.max(st.v1rms, 1e-30)
  const losses = st.pcu1 + st.pcu2
  return {
    ratio,
    turns,
    regulation: 1 - ratio / turns,
    eff: st.p1 > 0 ? st.p2 / st.p1 : 0,
    balance: (st.p1 - st.p2 - losses) / Math.max(Math.abs(st.p1), 1e-30),
    pf: st.p1 / Math.max(st.v1rms * st.i1rms, 1e-30),
  }
}

export function measureXf(r: XfRun): XfMeasurements {
  const p = r.params
  const spp = p.stepsPerPeriod
  const k0 = (p.periods - 1) * spp
  const k1 = p.periods * spp
  const tA = r.time[k0]
  const tB = r.time[k1]
  // the simulator's states: samples plus its states at the edges and mode changes between them
  const pts: Array<{ t: number; x: number[] }> = []
  const xs = r.xs
  let j = 0
  for (let k = k0; k <= k1; k++) {
    pts.push({ t: r.time[k], x: xs.map((a) => a[k]) })
    if (k === k1) break
    while (j < r.knots.length && r.knots[j].t <= r.time[k]) j++
    for (; j < r.knots.length && r.knots[j].t < r.time[k + 1]; j++) pts.push({ t: r.knots[j].t, x: r.knots[j].x })
  }
  const acc = new XfAccumulator(p)
  for (let q = 0; q < pts.length; q++) {
    acc.point(pts[q].x)
    if (q === 0) continue
    const a = pts[q - 1]
    const b = pts[q]
    const h = b.t - a.t
    if (!(h > 0)) continue
    // the interval's inputs (its midpoint) and its region (λ at its midpoint)
    const tIn = 0.5 * (a.t + b.t)
    const region = xfRegionOf(p, 0.5 * (lamOf(p, a.x) + lamOf(p, b.x)))
    acc.weight(a.x, 0.5 * h, tIn, region)
    acc.weight(b.x, 0.5 * h, tIn, region)
  }
  const T = tB - tA
  const st = acc.stats(T, xfSatTime(r.pwlEvents, r.modes[k0], tA, tB) / T, xfReversal(p, r.pwlEvents, tA))
  let iPeakRun = 0
  let bPeakRun = 0
  for (let k = 0; k < r.length; k++) {
    iPeakRun = Math.max(iPeakRun, Math.abs(r.signals.i1[k]))
    bPeakRun = Math.max(bPeakRun, Math.abs(r.signals.b[k]))
  }
  for (const kn of r.knots) {
    iPeakRun = Math.max(iPeakRun, Math.abs(magCurrentOf(p, lamOf(p, kn.x)) + kn.x[1]))
    bPeakRun = Math.max(bPeakRun, Math.abs(kn.x[0]))
  }
  const firstSat = r.pwlEvents.find((e) => regionOfMode(e.to) !== 'lin' && regionOfMode(e.from) === 'lin')
  return {
    ...st,
    ...xfDerived(p, st),
    iPeakRun,
    bPeakRun,
    tSat: firstSat ? firstSat.t : null,
    settled: r.diagnostics.steady.converged,
    saturated: st.satFrac > 0 || r.pwlEvents.some((e) => regionOfMode(e.to) !== 'lin' && e.t > tA),
  }
}
