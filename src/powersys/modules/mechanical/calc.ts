/*
 * Module 9 — Mechanical Design & Insulation: the pure calculations (no React).
 *
 *  1 · Sag and tension. A uniform flexible conductor under a uniform load hangs as a CATENARY (exact for that model).
 *      Wind and ice change the load: its size (w_r) and its direction (the swing angle θ); the conductor then hangs in
 *      the plane that contains both supports and the resultant load. Everything is solved in that plane, then mapped
 *      back to metres above the ground. The textbook PARABOLA is computed alongside for comparison.
 *  2 · Insulator strings. Discs = equal capacitors C in series, with a shunt capacitance mC from every link (pin) to
 *      the earthed tower. Voltages by the textbook ladder recurrence, and independently by a nodal solve (which also
 *      handles graded discs and line-to-pin "guard ring" capacitances).
 *  3 · Corona. Peek's empirical critical disruptive and visual critical voltages, the air-density factor, and the
 *      conductor surface gradient from Gauss's law (an independent physical check of V_c).
 *
 * Units inside: m, N, N/m, Pa (N/m²), kV for voltages; cm only where Peek's formula needs them (named …Cm).
 */

import { bundleGmFormula } from '../line-params/calc.ts'

export const G = 9.81
/** Density of glaze ice — a typical value, not from a specific standard [kg/m³]. */
export const RHO_ICE = 915

// ── conductors (illustrative values) ─────────────────────────────────────────────────────────────────────────

export type ConductorId = 'light' | 'medium' | 'heavy' | 'custom'
export interface Conductor {
  id: ConductorId
  name: string
  /** Overall diameter [m]. */
  d: number
  /** Weight per metre [N/m]. */
  w: number
  /** Breaking strength [N]. */
  uts: number
}
/** Three illustrative conductors (roughly the size of common aluminium–steel conductors; not catalogue data). */
export const CONDUCTORS: Record<Exclude<ConductorId, 'custom'>, Conductor> = {
  light: { id: 'light', name: 'Light', d: 0.0142, w: 3.9, uts: 32e3 },
  medium: { id: 'medium', name: 'Medium', d: 0.021, w: 9.6, uts: 89e3 },
  heavy: { id: 'heavy', name: 'Heavy', d: 0.0286, w: 15.9, uts: 130e3 },
}

// ── loads ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Loads {
  /** Bare conductor weight [N/m]. */
  w: number
  /** Ice weight [N/m]: ρ_ice·g·π·t(d + t). */
  wi: number
  /** Total vertical load w + w_i [N/m]. */
  wv: number
  /** Wind force [N/m]: p·(d + 2t), horizontal, across the line. */
  ww: number
  /** Resultant load √((w + w_i)² + w_w²) [N/m]. */
  wr: number
  /** Swing angle of the conductor plane from the vertical [rad]: atan(w_w / (w + w_i)). */
  theta: number
  /** Diameter with ice [m]: d + 2t. */
  dIce: number
}

/** Ice weight per metre of a radial layer t on a conductor of diameter d [N/m]. */
export const iceWeight = (d: number, t: number, rho = RHO_ICE, g = G) => rho * g * Math.PI * t * (d + t)
/** Wind force per metre on the projected area (d + 2t) per metre of line, at pressure p [N/m]. */
export const windForce = (d: number, t: number, p: number) => p * (d + 2 * t)

export function loads(w: number, d: number, t: number, p: number): Loads {
  const wi = iceWeight(d, t)
  const ww = windForce(d, t, p)
  const wv = w + wi
  return { w, wi, wv, ww, wr: Math.hypot(wv, ww), theta: Math.atan2(ww, wv), dIce: d + 2 * t }
}

// ── the catenary in the plane of the load ────────────────────────────────────────────────────────────────────

/** One span solved in the plane of the resultant load (u along the span, v "up" against the load). */
export interface Curve {
  /** Catenary parameter c = T₀ / w_r [m]. */
  c: number
  /** Position of the curve's lowest point (vertex) from support A [m]; outside [0, L′] when it falls beyond a support. */
  u0: number
  /** Depth of the vertex below support A and below support B [m] (catenary). S_B − S_A = h′. */
  SA: number
  SB: number
  /** Tension at A and B [N]: T₀ + w_r·S. */
  TA: number
  TB: number
  /** Conductor length between the supports [m]. */
  length: number
}

/**
 * The catenary through two supports in its own plane: span Lp (perpendicular to the load), support B higher than A by
 * hp (along the load direction), load wr per metre, tension T0 at the vertex. Vertex: u0 = Lp/2 − c·asinh(hp / (2c·sinh(Lp/2c))).
 */
/** cosh x − 1 without cancellation: 2·sinh²(x/2). */
export const coshm1 = (x: number) => 2 * Math.sinh(x / 2) ** 2

export function catenary(T0: number, wr: number, Lp: number, hp: number): Curve {
  const c = T0 / wr
  const u0 = Lp / 2 - c * Math.asinh(hp / (2 * c * Math.sinh(Lp / (2 * c))))
  // c(cosh x − 1) written as 2c·sinh²(x/2): no loss of digits for shallow spans
  const SA = coshm1(u0 / c) * c
  const SB = coshm1((Lp - u0) / c) * c
  return { c, u0, SA, SB, TA: T0 + wr * SA, TB: T0 + wr * SB, length: c * (Math.sinh((Lp - u0) / c) + Math.sinh(u0 / c)) }
}

/** The textbook parabola for the same span: x₁ = L/2 − T₀h/(wL), x₂ = L/2 + T₀h/(wL), S = w x²/(2T₀). */
export function parabola(T0: number, wr: number, Lp: number, hp: number) {
  const x1 = Lp / 2 - (T0 * hp) / (wr * Lp)
  const x2 = Lp / 2 + (T0 * hp) / (wr * Lp)
  const SA = (wr * x1 * x1) / (2 * T0)
  const SB = (wr * x2 * x2) / (2 * T0)
  // the usual length approximation for level supports: L + 8S²/(3L)
  const Slevel = (wr * Lp * Lp) / (8 * T0)
  return { x1, x2, SA, SB, Slevel, lengthLevel: Lp + (8 * Slevel * Slevel) / (3 * Lp), TB: T0 + wr * SB }
}

// ── the span ─────────────────────────────────────────────────────────────────────────────────────────────────

export type TensionMode = 'T0' | 'fos'
export interface SpanInput {
  /** Horizontal span between the supports [m]. */
  L: number
  /** Height of support B above support A [m] (0: level supports). */
  h: number
  /** Height of support A (the conductor's attachment point) above the ground [m]. */
  hA: number
  /** Bare conductor weight [N/m], diameter [m] and breaking strength [N]. */
  w: number
  d: number
  uts: number
  /** 'T0': the tension at the lowest point is set; 'fos': the support tension is set to breaking strength ÷ FoS. */
  mode: TensionMode
  T0: number
  fos: number
  /** Radial ice thickness [m] (0: no ice) and wind pressure [N/m²] (0: no wind). */
  iceT: number
  windP: number
  /** The minimum ground clearance the designer wants [m]. */
  minClear: number
}

export interface Issue {
  field: string
  message: string
}
export interface SpanWarning {
  id: 'clearance' | 'parabola' | 'vertex-outside' | 'fos'
  message: string
}

export interface SpanResult {
  ok: true
  input: SpanInput
  loads: Loads
  T0: number
  /** Span and height difference in the plane of the load [m] (= L and h without wind). */
  Lp: number
  hp: number
  cat: Curve
  par: ReturnType<typeof parabola>
  /** Unit vectors of the load plane in metres-space (x along the span, y up, z across, towards which the wind blows). */
  uHat: [number, number, number]
  vHat: [number, number, number]
  /** Is the vertex between the supports? (false: the conductor rises all the way from support A) */
  vertexInSpan: boolean
  /** The lowest conductor point: along the load plane (u), horizontal distance from A (x), height above ground (y), sideways swing (z). */
  low: { u: number; x: number; y: number; z: number }
  /** Vertical depth of the lowest point below support A and below support B [m] (level supports: S·cos θ). */
  vSagA: number
  vSagB: number
  /** Ground clearance at the lowest point [m]. */
  clearance: number
  /** The largest tension (at the higher support) [N] and the factor of safety it leaves. */
  Tmax: number
  fosActual: number
  /** The working (support) tension the FoS asks for, when the tension is set by FoS [N]. */
  Tworking: number | null
  /** (catenary − parabola) / parabola for the sag below the higher support (the mid-span sag for level supports). */
  relDiff: number
  /** The series estimate of relDiff for level supports: (4/3)(S/L)². */
  relDiffEst: number
  /** The largest difference between the two curves along the span [m]. */
  maxGap: number
  warnings: SpanWarning[]
}
export type SpanOutcome = SpanResult | { ok: false; issues: Issue[] }

/** The parabola is called "good" when it is within this fraction of the catenary. */
export const PARABOLA_OK = 0.01

/** A point of the span (load-plane coordinate u) in metres-space: [x along, y above ground, z across]. */
export function pointAt(r: Pick<SpanResult, 'uHat' | 'vHat' | 'input'>, u: number, v: number): [number, number, number] {
  return [u * r.uHat[0] + v * r.vHat[0], r.input.hA + u * r.uHat[1] + v * r.vHat[1], u * r.uHat[2] + v * r.vHat[2]]
}
/** Height of the catenary in its plane relative to support A (negative below A). */
export const vCat = (cat: Curve, u: number) => cat.c * coshm1((u - cat.u0) / cat.c) - cat.SA
/** Height of the parabola in its plane relative to support A. */
export const vPar = (par: SpanResult['par'], T0: number, wr: number, u: number) => (wr / (2 * T0)) * (u - par.x1) ** 2 - par.SA

/** Points along the span (catenary and parabola) in metres-space. */
export function spanPoints(r: SpanResult, n = 96): { cat: Array<[number, number, number]>; par: Array<[number, number, number]> } {
  const cat: Array<[number, number, number]> = []
  const par: Array<[number, number, number]> = []
  for (let k = 0; k <= n; k++) {
    const u = (r.Lp * k) / n
    cat.push(pointAt(r, u, vCat(r.cat, u)))
    par.push(pointAt(r, u, vPar(r.par, r.T0, r.loads.wr, u)))
  }
  return { cat, par }
}

/** Validate the inputs (no numbers come out of an invalid span). */
export function validateSpan(s: SpanInput): Issue[] {
  const out: Issue[] = []
  const bad = (x: number) => !Number.isFinite(x)
  if (bad(s.L) || s.L <= 0) out.push({ field: 'L', message: 'The span must be a positive length.' })
  if (bad(s.w) || s.w <= 0) out.push({ field: 'w', message: 'The conductor weight must be positive.' })
  if (bad(s.d) || s.d <= 0) out.push({ field: 'd', message: 'The conductor diameter must be positive.' })
  if (bad(s.uts) || s.uts <= 0) out.push({ field: 'uts', message: 'The breaking strength must be positive.' })
  if (bad(s.hA) || s.hA <= 0) out.push({ field: 'hA', message: 'The support must be above the ground.' })
  if (bad(s.h) || s.h < 0) out.push({ field: 'h', message: 'The height difference is measured upwards to the higher support (zero or positive).' })
  if (bad(s.iceT) || s.iceT < 0) out.push({ field: 'iceT', message: 'The ice thickness cannot be negative.' })
  if (bad(s.windP) || s.windP < 0) out.push({ field: 'windP', message: 'The wind pressure cannot be negative.' })
  if (bad(s.minClear) || s.minClear < 0) out.push({ field: 'minClear', message: 'The minimum clearance cannot be negative.' })
  if (s.mode === 'T0' && (bad(s.T0) || s.T0 <= 0)) out.push({ field: 'T0', message: 'The tension must be positive — a conductor cannot push.' })
  if (s.mode === 'fos' && (bad(s.fos) || s.fos <= 1)) out.push({ field: 'fos', message: 'A factor of safety must be greater than 1.' })
  return out
}

/** The support tension the catenary needs at the higher support, as a function of T₀ (for the FoS solve). */
function tbOf(T0: number, wr: number, Lp: number, hp: number): number {
  if (Lp / (T0 / wr) > 600) return Infinity
  const c = catenary(T0, wr, Lp, hp)
  return Number.isFinite(c.TB) ? c.TB : Infinity
}

/**
 * The T₀ that gives a support (maximum) tension of Tw: the shallow branch of T_B(T₀) = Tw. T_B has a minimum over T₀
 * (too slack: the sag and so the weight carried grow without limit); below it no tension can hold the span: null.
 */
export function solveT0ForSupportTension(Tw: number, wr: number, Lp: number, hp: number): number | null {
  // the minimum of T_B over T₀ (unimodal): golden-section search on ln T₀
  let a = Math.log(1e-4 * wr * Lp)
  let b = Math.log(Math.max(Tw, wr * Lp) * 10)
  const gr = (Math.sqrt(5) - 1) / 2
  let x1 = b - gr * (b - a)
  let x2 = a + gr * (b - a)
  let f1 = tbOf(Math.exp(x1), wr, Lp, hp)
  let f2 = tbOf(Math.exp(x2), wr, Lp, hp)
  for (let i = 0; i < 200 && b - a > 1e-12; i++) {
    if (f1 < f2) {
      b = x2
      x2 = x1
      f2 = f1
      x1 = b - gr * (b - a)
      f1 = tbOf(Math.exp(x1), wr, Lp, hp)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = a + gr * (b - a)
      f2 = tbOf(Math.exp(x2), wr, Lp, hp)
    }
  }
  const tMin = Math.exp((a + b) / 2)
  if (tbOf(tMin, wr, Lp, hp) > Tw) return null
  // shallow branch: T_B rises with T₀ from tMin; T_B(Tw) ≥ Tw
  let lo = tMin
  let hi = Tw
  for (let i = 0; i < 300 && hi - lo > 1e-12 * hi; i++) {
    const mid = (lo + hi) / 2
    if (tbOf(mid, wr, Lp, hp) > Tw) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** Solve one span: loads, the catenary in the load plane, its 3D position, clearance, tensions and the parabola. */
export function computeSpan(s: SpanInput): SpanOutcome {
  const issues = validateSpan(s)
  if (issues.length) return { ok: false, issues }
  const ld = loads(s.w, s.d, s.iceT, s.windP)
  const { theta, wr } = ld
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  // load direction n = (0, −cos θ, sin θ) (down, and towards +z with the wind); v̂ = −n is "up" in the load frame
  const vHat: [number, number, number] = [0, cosT, -sinT]
  const hp = s.h * cosT
  const Lp = Math.sqrt(s.L * s.L + s.h * s.h * sinT * sinT)
  const uHat: [number, number, number] = [s.L / Lp, (s.h * sinT * sinT) / Lp, (s.h * sinT * cosT) / Lp]
  let T0 = s.T0
  let Tworking: number | null = null
  if (s.mode === 'fos') {
    Tworking = s.uts / s.fos
    const t = solveT0ForSupportTension(Tworking, wr, Lp, hp)
    if (t === null)
      return {
        ok: false,
        issues: [
          {
            field: 'fos',
            message:
              'No tension can hold this span: the working tension (breaking strength ÷ factor of safety) is too low for this span and load. Shorten the span, lower the factor of safety or lighten the load.',
          },
        ],
      }
    T0 = t
  }
  if (Lp / (T0 / wr) > 600) return { ok: false, issues: [{ field: 'T0', message: 'Tension too low for this span: the conductor would hang far down — raise the tension or shorten the span.' }] }
  const cat = catenary(T0, wr, Lp, hp)
  const par = parabola(T0, wr, Lp, hp)
  if (!Number.isFinite(cat.TB) || !Number.isFinite(cat.length))
    return { ok: false, issues: [{ field: 'T0', message: 'Tension too low for this span: the conductor would hang far down — raise the tension or shorten the span.' }] }
  // lowest point above the ground: minimise y(u) = u·û_y + v(u)·cos θ (convex) → sinh((u − u0)/c) = −û_y / cos θ
  let uLow = cat.u0 + cat.c * Math.asinh(-uHat[1] / cosT)
  uLow = Math.min(Lp, Math.max(0, uLow))
  const pLow = pointAt({ uHat, vHat, input: s }, uLow, vCat(cat, uLow))
  const clearance = pLow[1]
  const Tmax = Math.max(cat.TA, cat.TB)
  if (clearance <= 0)
    return {
      ok: false,
      issues: [{ field: 'T0', message: 'Tension too low for this span: the conductor would hang down to the ground. Raise the tension, shorten the span or raise the supports.' }],
    }
  if (Tmax >= s.uts)
    return {
      ok: false,
      issues: [{ field: 'T0', message: 'The tension at the support would reach the conductor’s breaking strength — it would snap. Lower the tension (accept more sag) or use a stronger conductor.' }],
    }
  // the gap between the two curves, in their plane
  let maxGap = 0
  for (let k = 0; k <= 200; k++) {
    const u = (Lp * k) / 200
    maxGap = Math.max(maxGap, Math.abs(vCat(cat, u) - vPar(par, T0, wr, u)))
  }
  const level = s.h === 0
  const sCat = level ? cat.SB : cat.SB
  const sPar = level ? par.Slevel : par.SB
  const relDiff = (sCat - sPar) / sPar
  const relDiffEst = (4 / 3) * (par.Slevel / Lp) ** 2
  const vertexInSpan = cat.u0 >= 0 && cat.u0 <= Lp
  const res: SpanResult = {
    ok: true,
    input: s,
    loads: ld,
    T0,
    Lp,
    hp,
    cat,
    par,
    uHat,
    vHat,
    vertexInSpan,
    low: { u: uLow, x: pLow[0], y: pLow[1], z: pLow[2] },
    vSagA: s.hA - pLow[1],
    vSagB: s.hA + s.h - pLow[1],
    clearance,
    Tmax,
    fosActual: s.uts / Tmax,
    Tworking,
    relDiff,
    relDiffEst,
    maxGap,
    warnings: [],
  }
  if (clearance < s.minClear) res.warnings.push({ id: 'clearance', message: `The lowest point is below the minimum clearance you set (${clearance.toFixed(2)} m < ${s.minClear.toFixed(1)} m).` })
  if (Math.abs(relDiff) > PARABOLA_OK)
    res.warnings.push({ id: 'parabola', message: `The parabola is ${(Math.abs(relDiff) * 100).toFixed(1)} % off the catenary here (more than ${PARABOLA_OK * 100} %): use the catenary.` })
  if (!vertexInSpan)
    res.warnings.push({
      id: 'vertex-outside',
      message: 'The lowest point of the curve lies beyond the lower support (x₁ < 0): the conductor rises all the way from the lower support, which is its lowest point in the span.',
    })
  return res
}

// ── insulator strings ────────────────────────────────────────────────────────────────────────────────────────

export type Grading = 'none' | 'capacitance' | 'guard'

/**
 * The textbook ladder: disc 1 at the cross-arm … disc n at the line. KCL at the link below disc k: the current in disc
 * k + 1 = the current in disc k + the current in that link's shunt capacitance mC, so V_{k+1} = V_k + m·(V_1 + … + V_k).
 * Scaled so that the disc voltages add up to the phase voltage V.
 */
export function ladderVoltages(n: number, m: number, V: number): number[] {
  const v = [1]
  let sum = 1
  for (let k = 1; k < n; k++) {
    v.push(v[k - 1] + m * sum)
    sum += v[k]
  }
  return v.map((x) => (x * V) / sum)
}

/** Disc capacitances (÷ C) that make every disc take V/n with shunt capacitance mC: C_k = C·(1 + m·k(k − 1)/2). */
export const gradedCaps = (n: number, m: number): number[] => Array.from({ length: n }, (_, i) => 1 + (m * (i + 1) * i) / 2)

/**
 * The ideal guard ring: line-to-link capacitances (÷ C) that exactly supply each link's shunt current when every disc
 * takes V/n. Link k (below disc k): C_g,k = C·m·k / (n − k), k = 1 … n − 1.
 */
export const guardRingCaps = (n: number, m: number): number[] => Array.from({ length: n - 1 }, (_, i) => (m * (i + 1)) / (n - i - 1))

/** Solve a dense linear system (Gaussian elimination with partial pivoting). */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/**
 * The string as a circuit, solved by nodal analysis: node 0 = cross-arm (0 V), nodes 1 … n − 1 = the links, node n = the
 * line (V). discC[k] joins node k and k + 1 (k = 0 … n − 1, top first); shunt[j] joins link j + 1 to earth; lineC[j]
 * joins link j + 1 to the line (a guard ring). Returns the link voltages and the voltage across each disc.
 */
export function nodalString(discC: number[], shunt: number[], lineC: number[], V: number): { nodeV: number[]; discV: number[] } {
  const n = discC.length
  const k = n - 1 // unknown links
  if (k === 0) return { nodeV: [0, V], discV: [V] }
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const b = new Array<number>(k).fill(0)
  for (let j = 0; j < k; j++) {
    const node = j + 1
    const up = discC[node - 1] // to node − 1
    const down = discC[node] // to node + 1
    A[j][j] = up + down + shunt[j] + lineC[j]
    if (j > 0) A[j][j - 1] = -up
    if (j < k - 1) A[j][j + 1] = -down
    if (node + 1 === n) b[j] += down * V
    b[j] += lineC[j] * V
  }
  const u = solveLinear(A, b)
  const nodeV = [0, ...u, V]
  return { nodeV, discV: discC.map((_, i) => nodeV[i + 1] - nodeV[i]) }
}

export interface StringInput {
  n: number
  m: number
  /** Line-to-line voltage [kV]. */
  kv: number
  grading: Grading
}
export interface StringResult {
  ok: true
  input: StringInput
  /** Phase (line-to-earth) voltage [kV]. */
  V: number
  /** Disc voltages, top (cross-arm) first [kV], from the nodal solve. */
  discV: number[]
  /** The same from the textbook ladder recurrence (ungraded strings only). */
  ladderV: number[] | null
  /** Disc capacitances ÷ C, shunt capacitances ÷ C, line-to-link capacitances ÷ C. */
  discC: number[]
  shunt: number[]
  lineC: number[]
  /** String efficiency V / (n·V_max). */
  eff: number
  /** Index of the most-stressed disc (0-based). */
  maxIdx: number
  /** The ungraded string's efficiency, for comparison. */
  effPlain: number
}
export type StringOutcome = StringResult | { ok: false; issues: Issue[] }

export function validateString(s: StringInput): Issue[] {
  const out: Issue[] = []
  if (!Number.isInteger(s.n) || s.n < 1) out.push({ field: 'n', message: 'A string needs a whole number of discs (at least one).' })
  if (!Number.isFinite(s.m) || s.m < 0) out.push({ field: 'm', message: 'The capacitance ratio m cannot be negative.' })
  if (!Number.isFinite(s.kv) || s.kv <= 0) out.push({ field: 'kv', message: 'The line voltage must be positive.' })
  return out
}

export const efficiency = (discV: number[], V: number) => V / (discV.length * Math.max(...discV))

export function computeString(s: StringInput): StringOutcome {
  const issues = validateString(s)
  if (issues.length) return { ok: false, issues }
  const V = s.kv / Math.sqrt(3)
  const n = s.n
  const discC = s.grading === 'capacitance' ? gradedCaps(n, s.m) : new Array<number>(n).fill(1)
  const shunt = new Array<number>(n - 1).fill(s.m)
  const lineC = s.grading === 'guard' ? guardRingCaps(n, s.m) : new Array<number>(n - 1).fill(0)
  const { discV } = nodalString(discC, shunt, lineC, V)
  const plain = ladderVoltages(n, s.m, V)
  const maxIdx = discV.reduce((best, v, i) => (v > discV[best] * (1 + 1e-12) ? i : best), 0)
  return {
    ok: true,
    input: s,
    V,
    discV,
    ladderV: s.grading === 'none' ? plain : null,
    discC,
    shunt,
    lineC,
    eff: efficiency(discV, V),
    maxIdx,
    effPlain: efficiency(plain, V),
  }
}

// ── corona (Peek) ────────────────────────────────────────────────────────────────────────────────────────────

/** Breakdown strength of air at 76 cmHg and 25 °C: 30 kV/cm peak, 30/√2 ≈ 21.2 kV/cm rms. */
export const G0_PEAK = 30
export const G0_RMS = G0_PEAK / Math.SQRT2

/** Air density factor δ = (b/76)·(298/(273 + t)) ≈ 3.92·b/(273 + t), b in cm of mercury, t in °C (δ = 1 at 76 cmHg, 25 °C). */
export const airDensity = (bCmHg: number, tC: number) => (bCmHg / 76) * (298 / (273 + tC))

export interface CoronaInput {
  /** Conductor radius [cm] and spacing between conductors [cm]. */
  rCm: number
  DCm: number
  /** Irregularity factor m₀ and the visual-corona factor m_v. */
  m0: number
  mv: number
  /** Air pressure [cm Hg] and temperature [°C]. */
  b: number
  t: number
  /** Line-to-line operating voltage [kV]. */
  kv: number
}
export interface CoronaResult {
  ok: true
  input: CoronaInput
  delta: number
  /** ln(D/r). */
  lnDr: number
  /** Critical disruptive voltage, rms phase-to-neutral [kV], and line-to-line [kV]. */
  vc: number
  vcLine: number
  /** Visual critical voltage, rms phase-to-neutral [kV]. */
  vv: number
  /** Operating phase voltage [kV] and the surface gradient it makes [kV/cm rms]. */
  vPhase: number
  gSurface: number
  /** The gradient at which corona starts by Peek's formula: m₀·g₀·δ [kV/cm rms]. */
  gCritical: number
  /** Is the operating voltage above V_c / above V_v? */
  above: boolean
  aboveVisual: boolean
}
export type CoronaOutcome = CoronaResult | { ok: false; issues: Issue[] }

/** Peek's formulas assume a long round conductor far from the others; below this D/r the two-wire field formula is poor. */
export const MIN_D_OVER_R = 10

export function validateCorona(c: CoronaInput): Issue[] {
  const out: Issue[] = []
  const bad = (x: number) => !Number.isFinite(x)
  if (bad(c.rCm) || c.rCm <= 0) out.push({ field: 'r', message: 'The conductor radius must be positive.' })
  if (bad(c.DCm) || c.DCm <= 0) out.push({ field: 'D', message: 'The spacing must be positive.' })
  if (!out.length && c.DCm / c.rCm < MIN_D_OVER_R) out.push({ field: 'D', message: `The conductors are too close for Peek’s formula (it needs D ≫ r; here D/r is below ${MIN_D_OVER_R}).` })
  if (bad(c.m0) || c.m0 <= 0 || c.m0 > 1) out.push({ field: 'm0', message: 'The irregularity factor m₀ lies between 0 and 1 (1 for a smooth, polished conductor).' })
  if (bad(c.mv) || c.mv <= 0 || c.mv > 1) out.push({ field: 'mv', message: 'The factor m_v lies between 0 and 1.' })
  if (bad(c.b) || c.b <= 0) out.push({ field: 'b', message: 'The air pressure must be positive.' })
  if (bad(c.t) || c.t <= -273) out.push({ field: 't', message: 'The temperature must be above absolute zero.' })
  if (bad(c.kv) || c.kv <= 0) out.push({ field: 'kv', message: 'The line voltage must be positive.' })
  return out
}

/** Peek's critical disruptive voltage, rms to neutral [kV]: m₀·g₀·δ·r·ln(D/r) (r in cm, g₀ in kV/cm rms). */
export const criticalDisruptive = (m0: number, delta: number, rCm: number, DCm: number, g0 = G0_RMS) => m0 * g0 * delta * rCm * Math.log(DCm / rCm)
/** Peek's visual critical voltage [kV rms to neutral]: m_v·g₀·δ·r·(1 + 0.3/√(δ·r))·ln(D/r). */
export const visualCritical = (mv: number, delta: number, rCm: number, DCm: number, g0 = G0_RMS) => mv * g0 * delta * rCm * (1 + 0.3 / Math.sqrt(delta * rCm)) * Math.log(DCm / rCm)
/** The surface gradient of a conductor at phase voltage V [kV] (Gauss's law, D ≫ r) [kV/cm]: V / (r·ln(D/r)). */
export const surfaceGradient = (V: number, rCm: number, DCm: number) => V / (rCm * Math.log(DCm / rCm))
/**
 * The AVERAGE surface gradient of an n-conductor bundle [kV/cm] at phase voltage V: the phase charge q = 2πε₀V/ln(D/r_eq)
 * shared equally by n sub-conductors of radius r, so g = V / (n·r·ln(D/r_eq)), with r_eq the bundle's equivalent radius.
 */
export function bundleGradient(V: number, n: 1 | 2 | 3 | 4, rCm: number, dCm: number, DCm: number): number {
  const req = bundleGmFormula(n, dCm, rCm)
  return V / (n * rCm * Math.log(DCm / req))
}

export function computeCorona(c: CoronaInput): CoronaOutcome {
  const issues = validateCorona(c)
  if (issues.length) return { ok: false, issues }
  const delta = airDensity(c.b, c.t)
  const vc = criticalDisruptive(c.m0, delta, c.rCm, c.DCm)
  const vv = visualCritical(c.mv, delta, c.rCm, c.DCm)
  const vPhase = c.kv / Math.sqrt(3)
  return {
    ok: true,
    input: c,
    delta,
    lnDr: Math.log(c.DCm / c.rCm),
    vc,
    vcLine: vc * Math.sqrt(3),
    vv,
    vPhase,
    gSurface: surfaceGradient(vPhase, c.rCm, c.DCm),
    gCritical: c.m0 * G0_RMS * delta,
    above: vPhase > vc,
    aboveVisual: vPhase > vv,
  }
}

/**
 * The corona verdict in words, from BOTH comparisons (operating phase voltage against V_c and against V_v). Visual
 * corona cannot start before disruptive corona, so V_v < V_c means the chosen factors m₀ and m_v are inconsistent —
 * then the text says so instead of drawing a conclusion about the glow.
 */
export function coronaVerdict(r: CoronaResult): { tone: 'good' | 'warn'; text: string; consistent: boolean; vvNote: string } {
  const f1 = (x: number) => x.toFixed(1)
  const consistent = r.vv >= r.vc
  const bad = consistent
    ? ''
    : ` Note: with m₀ = ${r.input.m0.toFixed(2)} and m_v = ${r.input.mv.toFixed(2)} the visual critical voltage (${f1(r.vv)} kV) comes out BELOW V_c — inconsistent factors, since a glow cannot appear before corona starts. Raise m_v or lower m₀.`
  let text: string
  if (!r.above) text = `No corona expected in fair weather: ${f1(r.vPhase)} kV per phase is below V_c = ${f1(r.vc)} kV (by Peek’s formula).`
  else if (!consistent) text = `Corona expected in fair weather: ${f1(r.vPhase)} kV per phase is above V_c = ${f1(r.vc)} kV.`
  else if (r.aboveVisual) text = `Corona expected in fair weather: ${f1(r.vPhase)} kV per phase is above V_c = ${f1(r.vc)} kV, and also above V_v = ${f1(r.vv)} kV: a faint glow would be visible.`
  else text = `Corona expected in fair weather: ${f1(r.vPhase)} kV per phase is above V_c = ${f1(r.vc)} kV but below V_v = ${f1(r.vv)} kV, so no glow would be seen yet.`
  const vvNote = !consistent ? 'below V_c — inconsistent m₀, m_v' : r.aboveVisual ? 'operating voltage above it' : 'operating voltage below it'
  return { tone: r.above || !consistent ? 'warn' : 'good', text: text + bad, consistent, vvNote }
}

// ── words from numbers ───────────────────────────────────────────────────────────────────────────────────────

/** A percentage written with a precision that suits its size. */
export function pctText(p: number): string {
  const a = Math.abs(p)
  return a < 0.001 ? '< 0.001' : a < 0.1 ? a.toFixed(3) : a < 1 ? a.toFixed(2) : a < 10 ? a.toFixed(1) : a.toFixed(0)
}

/** A size word for a relative difference, with the number beside it, e.g. "very small (0.21 %)". */
export function diffWords(rel: number): string {
  const p = Math.abs(rel) * 100
  const n = pctText(p)
  if (p < 0.1) return `negligible (${n} %)`
  if (p < 1) return `very small (${n} %)`
  if (p < 5) return `small (${n} %)`
  if (p < 25) return `noticeable (${n} %)`
  return `large (${n} %)`
}

/** "about 4.03 times", "1.5 times" … a ratio in words. */
export const timesText = (r: number) => `${r < 10 ? r.toFixed(2) : r.toFixed(1)} times`

/** The span's parabola verdict in words, computed. */
export const parabolaVerdict = (rel: number) => (Math.abs(rel) <= PARABOLA_OK ? `within ${PARABOLA_OK * 100} % of the catenary` : `more than ${PARABOLA_OK * 100} % off the catenary`)

/** The sag ÷ span at which the parabola is `rel` below the catenary (level supports; bisection on the closed form). */
export function parabolaLimit(rel: number): number {
  let lo = 1e-6
  let hi = 0.5
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const u = 4 * mid
    if (coshm1(u) / ((u * u) / 2) - 1 > rel) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** Numerical arc length of y(x) on [a, b] (composite Simpson, n even) — an independent check of the closed forms. */
export function arcLength(dydx: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n
  let s = 0
  for (let k = 0; k <= n; k++) {
    const f = Math.sqrt(1 + dydx(a + k * h) ** 2)
    s += k === 0 || k === n ? f : k % 2 ? 4 * f : 2 * f
  }
  return (s * h) / 3
}
