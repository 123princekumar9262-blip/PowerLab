/*
 * The Verify checks of Module 9 as pure functions: each repeats a model result by hand (the textbook formula) and
 * compares it with an independent second method. They are unit-tested over the whole range of every control, so a
 * valid design never shows ✗. Each tolerance is justified by the approximation involved (stated with the check).
 */

import { arcLength, catenary, computeCorona, G0_RMS, iceWeight, ladderVoltages, nodalString, parabola, RHO_ICE, G, windForce, type CoronaResult, type SpanResult, type StringResult } from './calc.ts'

/** The ranges of the controls (the UI uses exactly these; the tests sample them). */
export const RANGES = {
  L: [50, 800] as const, // m
  T0kN: [2, 80] as const,
  hA: [8, 40] as const, // m
  h: [0, 60] as const, // m
  iceMm: [0, 30] as const,
  windPa: [0, 1000] as const,
  fos: [1.5, 5] as const,
  minClear: [3, 15] as const,
  w: [2, 25] as const, // N/m
  dMm: [8, 40] as const,
  utsKN: [20, 200] as const,
  n: [2, 12] as const,
  m: [0, 0.5] as const,
  kv: [11, 33, 66, 132, 220, 400] as const,
  Dm: [0.5, 12] as const,
  b: [50, 80] as const, // cmHg
  t: [-10, 50] as const, // °C
  m0: [0.7, 1] as const,
  mv: [0.6, 1] as const,
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)

// ── 1 · parabola against catenary (level supports) ──────────────────────────────────────────────────────────

/**
 * For level supports, S_cat / S_par = 2(cosh u − 1)/u² = 1 + u²/12 + u⁴/360 + … with u = L/(2c). Every term is
 * positive and each is at most the matching term of (u²/12)·cosh u, so
 *     (4/3)(S/L)² ≤ (S_cat − S_par)/S_par ≤ (4/3)(S/L)²·cosh u        (S = S_par, since S_par/L = u/4).
 * The check: the model's catenary and the hand parabola differ by an amount inside that bracket.
 */
export function parabolaCheck(T0: number, wr: number, L: number) {
  const cat = catenary(T0, wr, L, 0)
  const Spar = (wr * L * L) / (8 * T0)
  const Scat = cat.SB
  const u = L / (2 * cat.c)
  const lo = (4 / 3) * (Spar / L) ** 2
  const hi = lo * Math.cosh(u)
  const d = (Scat - Spar) / Spar
  // a relative slack of 1e-9 covers rounding in cosh for very shallow spans (where d itself is ~1e-8)
  const ok = d >= lo * (1 - 1e-6) - 1e-12 && d <= hi * (1 + 1e-6) + 1e-12
  return { Spar, Scat, u, lo, hi, d, ok, c: cat.c }
}

// ── 2 · length and support tension: closed forms against numerical integration ─────────────────────────────

/**
 * Length: c[sinh((L′ − u₀)/c) + sinh(u₀/c)] against Simpson's rule on √(1 + v′²) (2000 intervals; the error of
 * Simpson's rule for this smooth integrand is far below 1e-7 of the length for every allowed span).
 * Support tension: T₀ + w_r·S_B (from the vertical balance) against T₀·√(1 + v′(L′)²) (tension along the tangent).
 */
export function lengthTensionCheck(r: SpanResult) {
  const { cat, Lp, T0 } = r
  const slope = (u: number) => Math.sinh((u - cat.u0) / cat.c)
  const numLen = arcLength(slope, 0, Lp)
  const tTangent = T0 * Math.sqrt(1 + slope(Lp) ** 2)
  const tBalance = T0 + r.loads.wr * cat.SB
  const okLen = rel(cat.length, numLen) < 1e-7
  const okT = rel(tBalance, tTangent) < 1e-9
  return { numLen, tTangent, tBalance, okLen, okT, ok: okLen && okT }
}

// ── 3 · wind and ice by hand ────────────────────────────────────────────────────────────────────────────────

/**
 * Loads from the textbook formulas (ice from the area of the ice annulus, π/4·((d+2t)² − d²)), then for level supports
 * the vertical sag S·cos θ and the clearance h_A − S·cos θ by hand — against the model, which finds the lowest point of
 * the 3D curve by minimising its height (no use of cos θ). Agreement to 1e-9 m.
 */
export function loadsCheck(r: SpanResult) {
  const s = r.input
  const iceArea = (Math.PI / 4) * ((s.d + 2 * s.iceT) ** 2 - s.d ** 2)
  const wi = iceArea * RHO_ICE * G
  const ww = s.windP * (s.d + 2 * s.iceT)
  const wv = s.w + wi
  const wr = Math.hypot(wv, ww)
  const theta = Math.atan(ww / wv)
  const level = s.h === 0
  const S = r.cat.SB
  const vSag = S * Math.cos(theta)
  const clear = s.hA - vSag
  const okLoads =
    rel(wi + 1e-300, iceWeight(s.d, s.iceT) + 1e-300) < 1e-12 &&
    rel(ww + 1e-300, windForce(s.d, s.iceT, s.windP) + 1e-300) < 1e-12 &&
    rel(wr, r.loads.wr) < 1e-12 &&
    Math.abs(theta - r.loads.theta) < 1e-12
  const okSag = !level || (Math.abs(vSag - r.vSagA) < 1e-9 && Math.abs(clear - r.clearance) < 1e-9)
  return { wi, ww, wv, wr, theta, S, vSag, clear, level, okLoads, okSag, ok: okLoads && okSag }
}

// ── 4 · unequal supports ───────────────────────────────────────────────────────────────────────────────────

/**
 * Supports at different levels: x₁ = L′/2 − T₀h′/(w_r L′), x₂ = L′/2 + T₀h′/(w_r L′), S₁ = w_r x₁²/(2T₀), S₂ = w_r x₂²/(2T₀).
 * Both methods must satisfy S₂ − S₁ = h′ (the curve passes through both supports) — to 1e-9 of the span.
 */
export function unequalCheck(r: SpanResult) {
  const par = parabola(r.T0, r.loads.wr, r.Lp, r.hp)
  const dPar = par.SB - par.SA
  const dCat = r.cat.SB - r.cat.SA
  const ok = Math.abs(dPar - r.hp) < 1e-9 * r.Lp && Math.abs(dCat - r.hp) < 1e-9 * r.Lp
  return { par, dPar, dCat, ok }
}

// ── 5 · insulator string: ladder against nodal solve ──────────────────────────────────────────────────────────

/**
 * Ungraded: the ladder recurrence against the nodal solve (relative 1e-9 — both are exact; the difference is rounding).
 * Graded or guard ring: the nodal solve must give every disc V/n (to 1e-9 of V), and the ungraded ladder is shown.
 */
export function stringCheck(r: StringResult) {
  const n = r.input.n
  const ladder = ladderVoltages(n, r.input.m, r.V)
  const plain = nodalString(new Array<number>(n).fill(1), new Array<number>(n - 1).fill(r.input.m), new Array<number>(n - 1).fill(0), r.V).discV
  const sum = r.discV.reduce((a, b) => a + b, 0)
  const okSum = Math.abs(sum - r.V) < 1e-9 * r.V
  const okLadder = ladder.every((v, k) => Math.abs(v - plain[k]) <= 1e-9 * r.V)
  const okEqual = r.input.grading === 'none' || r.discV.every((v) => Math.abs(v - r.V / n) < 1e-9 * r.V)
  return { ladder, plain, sum, okSum, okLadder, okEqual, ok: okSum && okLadder && okEqual }
}

// ── 6 · corona: V_c by hand, and the field at V_c ────────────────────────────────────────────────────────────

/** Permittivity of free space [F/m] (written here, not taken from the model). */
const EPS0 = 8.8541878128e-12
/** Relative tolerance between the hand V_c (textbook δ = 3.92·b/(273+t)) and the model (δ = (b/76)(298/(273+t))):
 * 3.92 is 298/76 = 3.92105… rounded, a relative difference of 2.7 × 10⁻⁴ in δ and so in V_c. */
export const CORONA_HAND_TOL = 4e-4

/**
 * 1 · An independent hand calculation: the textbook δ = 3.92·b/(273 + t) and g₀ = 30/√2 kV/cm written out here,
 *     ln(D/r) — against the model's V_c (which uses the exact δ). Agreement within CORONA_HAND_TOL.
 * 2 · A consistency check of what V_c means (not independent — the definition behind Peek's formula): at V_c the
 *     charge per metre q = 2πε₀V/ln(D/r) gives a surface field E = q/(2πε₀r) equal to the breakdown gradient m₀g₀δ.
 */
export function coronaCheck(r: CoronaResult) {
  const c = r.input
  const delta = (3.92 * c.b) / (273 + c.t)
  const g0 = 30 / Math.sqrt(2)
  const lnDr = Math.log(c.DCm / c.rCm)
  const vcHand = c.m0 * g0 * delta * c.rCm * lnDr
  const vc211 = vcHand * (21.1 / g0)
  const okHand = rel(vcHand, r.vc) < CORONA_HAND_TOL
  // SI: r and D in metres, V in volts
  const rM = c.rCm / 100
  const q = (2 * Math.PI * EPS0 * r.vc * 1e3) / Math.log(c.DCm / 100 / rM)
  const E = q / (2 * Math.PI * EPS0 * rM)
  const g = E / 1e5 // V/m → kV/cm
  const gCrit = c.m0 * G0_RMS * r.delta
  const okField = rel(g, gCrit) < 1e-9
  return { delta, deltaExact: r.delta, vcHand, vc211, q, g, gCrit, okHand, okField, ok: okHand && okField }
}

/** Every check for one state (used by the tests). */
export function allChecks(span: SpanResult, str: StringResult, cor: ReturnType<typeof computeCorona>) {
  return {
    parabola: parabolaCheck(span.T0, span.loads.wr, span.Lp).ok,
    lengthTension: lengthTensionCheck(span).ok,
    loads: loadsCheck(span).ok,
    unequal: unequalCheck(span).ok,
    string: stringCheck(str).ok,
    corona: cor.ok ? coronaCheck(cor).ok : true,
  }
}
