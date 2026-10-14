import { add, C, div, mul, polarDeg, ZERO, type Complex } from '../../engine/complex.ts'
import type { DesignedLine } from '../../lineDesign.ts'

/*
 * Module 8 — Transmission-line parameters. Every number on the page comes from here (no React, so the tests can call
 * it directly).
 *
 * Model and assumptions (shown on screen too):
 *  - Conductors are long, straight, parallel and round; each is replaced by a line current / line charge at its
 *    centre (valid when spacings are much larger than radii).
 *  - A sub-conductor is a SOLID round aluminium conductor of radius r: dc resistance ρ/(πr²), GMR r′ = e^(−1/4)·r
 *    (uniform current), skin effect from the exact Bessel (ber/bei) solution. Stranded ACSR (steel core, strands) is
 *    beyond this model.
 *  - Bundles: n identical sub-conductors on a circle (twin: side by side, triple: triangle apex up, quad: square),
 *    sharing current and charge equally (the textbook assumption).
 *  - Three-phase operation is balanced; the operating (positive-sequence) inductance and capacitance per phase are
 *    reported. Transposed: averaged over a full transposition cycle. Earth: a flat perfectly conducting plane at
 *    height 0 (method of images) for capacitance only — earth is ignored for inductance (balanced currents).
 *
 * Units: positions and radii in metres; L in mH/km, C in nF/km, R and X in Ω/km, B in µS/km.
 */

export const MU0 = 4e-7 * Math.PI
export const EPS0 = 8.8541878128e-12
/** μ0 / 2π [H/m]: the 2×10⁻⁷ in every inductance formula. */
export const K_L = 2e-7
/** r′ / r for a solid round conductor with uniform current: e^(−1/4). */
export const R_PRIME = Math.exp(-0.25)
/** Aluminium (typical handbook values, not a particular product): resistivity at 20 °C and its temperature coefficient. */
export const ALUMINIUM = { rho20: 2.826e-8, alpha20: 0.00403 }
/** Air this lab requires between the outlines of two phase bundles [m] (a lab rule; real clearances depend on voltage and are much larger). */
export const MIN_AIR_M = 1
/** The design frequency [Hz] (reactance, susceptance and the hand-off to Module 2). */
export const F_DESIGN = 50

export type PhaseIndex = 0 | 1 | 2
export const PHASES = ['a', 'b', 'c'] as const
export type Bundle = 1 | 2 | 3 | 4

export interface Pt {
  x: number
  y: number
}

/** The cross-section of a single-circuit three-phase line. */
export interface LineGeometry {
  /** Bundle centres of phases a, b, c: x horizontal, y height above the ground [m]. */
  phases: [Pt, Pt, Pt]
  /** Sub-conductor radius [m]. */
  rM: number
  /** Sub-conductors per phase. */
  n: Bundle
  /** Bundle spacing: centre-to-centre distance of neighbouring sub-conductors [m]. */
  dM: number
}

export interface LineOptions {
  transposed: boolean
  earth: boolean
  /** Conductor temperature [°C]. */
  tempC: number
  /** Nominal line-to-line voltage [kV]. */
  kv: number
}

export const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y)

// ── bundles ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Radius of the circle the sub-conductor centres lie on (0 for one conductor). */
export function bundleRadius(n: Bundle, d: number): number {
  if (n === 1) return 0
  if (n === 2) return d / 2
  if (n === 3) return d / Math.sqrt(3)
  return d / Math.SQRT2
}

/** Sub-conductor centres relative to the bundle centre: twin side by side, triple apex up, quad a square. */
export function bundleOffsets(n: Bundle, d: number): Pt[] {
  if (n === 1) return [{ x: 0, y: 0 }]
  const rho = bundleRadius(n, d)
  const start = n === 2 ? 0 : n === 3 ? 90 : 45
  return Array.from({ length: n }, (_, k) => {
    const a = ((start + (360 * k) / n) * Math.PI) / 180
    return { x: rho * Math.cos(a), y: rho * Math.sin(a) }
  })
}

/**
 * Geometric mean radius of a bundle from its own geometry: (ρ_self · Π d_1j)^(1/n), with ρ_self = r′ for inductance
 * or r for capacitance. (Regular bundles: every sub-conductor sees the same distances.)
 */
export function bundleGm(n: Bundle, d: number, rSelf: number): number {
  const o = bundleOffsets(n, d)
  let lnSum = Math.log(rSelf)
  for (let j = 1; j < n; j++) lnSum += Math.log(dist(o[0], o[j]))
  return Math.exp(lnSum / n)
}

/** The textbook closed forms: √(r·d), ∛(r·d²), 1.09·⁴√(r·d³) (1.09 is 2^(1/8) = 1.0905, from the square's diagonal d√2). */
export function bundleGmFormula(n: Bundle, d: number, rSelf: number): number {
  if (n === 1) return rSelf
  if (n === 2) return Math.sqrt(rSelf * d)
  if (n === 3) return Math.cbrt(rSelf * d * d)
  return 2 ** (1 / 8) * (rSelf * d ** 3) ** 0.25
}

/** All sub-conductors of the line, with their phase. */
export function subConductors(g: LineGeometry): Array<Pt & { phase: PhaseIndex }> {
  const o = bundleOffsets(g.n, g.dM)
  return g.phases.flatMap((p, k) => o.map((q) => ({ x: p.x + q.x, y: p.y + q.y, phase: k as PhaseIndex })))
}

// ── validation ───────────────────────────────────────────────────────────────────────────────────────────────

export interface GeometryIssue {
  /** What is wrong ('spacing' names the two phases). */
  kind: 'number' | 'radius' | 'bundle' | 'ground' | 'spacing'
  message: string
  /** The phases concerned (drawn in the critical colour). */
  phases?: PhaseIndex[]
}

export const LIMITS = { rMinMm: 3, rMaxMm: 40, dMin: 0.1, dMax: 1.2, xAbsMax: 40, yMax: 80 }

const pairs: Array<[PhaseIndex, PhaseIndex]> = [
  [0, 1],
  [1, 2],
  [2, 0],
]

/** Minimum centre-to-centre phase spacing this lab allows: two bundle outlines plus MIN_AIR_M of air. */
export const minPhaseSpacing = (g: Pick<LineGeometry, 'rM' | 'n' | 'dM'>): number => 2 * (bundleRadius(g.n, g.dM) + g.rM) + MIN_AIR_M

/** Everything that makes a cross-section physically impossible (or outside this model). Empty: valid. */
export function validateGeometry(g: LineGeometry): GeometryIssue[] {
  const out: GeometryIssue[] = []
  const nums = [g.rM, g.dM, ...g.phases.flatMap((p) => [p.x, p.y])]
  if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return [{ kind: 'number', message: 'Every position and size must be a number.' }]
  const rMm = g.rM * 1000
  if (rMm < LIMITS.rMinMm || rMm > LIMITS.rMaxMm) out.push({ kind: 'radius', message: `The conductor radius must be between ${LIMITS.rMinMm} and ${LIMITS.rMaxMm} mm.` })
  if (![1, 2, 3, 4].includes(g.n)) out.push({ kind: 'bundle', message: 'A bundle has 1 to 4 sub-conductors here.' })
  else if (g.n > 1) {
    if (g.dM < LIMITS.dMin || g.dM > LIMITS.dMax) out.push({ kind: 'bundle', message: `The bundle spacing must be between ${LIMITS.dMin} and ${LIMITS.dMax} m.` })
    else if (g.dM <= 2 * g.rM) out.push({ kind: 'bundle', message: 'The sub-conductors overlap: the bundle spacing must exceed the conductor diameter.' })
  }
  g.phases.forEach((p, k) => {
    if (Math.abs(p.x) > LIMITS.xAbsMax || p.y > LIMITS.yMax)
      out.push({ kind: 'number', phases: [k as PhaseIndex], message: `Phase ${PHASES[k]} is outside the editing area (|x| ≤ ${LIMITS.xAbsMax} m, height ≤ ${LIMITS.yMax} m).` })
    const lowest = p.y - bundleRadius(g.n, g.dM) - g.rM
    if (lowest <= 0)
      out.push({ kind: 'ground', phases: [k as PhaseIndex], message: `Phase ${PHASES[k]} touches or is below the ground (its lowest point is at ${lowest.toFixed(2).replace('-', '−')} m).` })
  })
  const dmin = minPhaseSpacing(g)
  for (const [i, j] of pairs) {
    const d = dist(g.phases[i], g.phases[j])
    if (d < dmin)
      out.push({
        kind: 'spacing',
        phases: [i, j],
        message: `Phases ${PHASES[i]} and ${PHASES[j]} are ${d.toFixed(2)} m apart; this lab needs at least ${dmin.toFixed(2)} m (two bundle outlines plus ${MIN_AIR_M} m of air).`,
      })
  }
  return out
}

// ── resistance and skin effect ───────────────────────────────────────────────────────────────────────────────

/** Resistivity at temperature T: ρ_T = ρ₂₀·[1 + α·(T − 20)]. */
export const rhoAt = (tempC: number): number => ALUMINIUM.rho20 * (1 + ALUMINIUM.alpha20 * (tempC - 20))

/** dc resistance of one solid round conductor [Ω/km]: ρ·1000 / (π r²). */
export const rDcPerKm = (rM: number, tempC: number): number => (rhoAt(tempC) * 1000) / (Math.PI * rM * rM)

/** Skin depth δ = √(2ρ / (ω μ)) [m]. */
export const skinDepth = (rho: number, fHz: number, mu = MU0): number => Math.sqrt((2 * rho) / (2 * Math.PI * fHz * mu))

export interface Kelvin {
  ber: number
  bei: number
  dber: number
  dbei: number
}

/** Kelvin functions ber, bei and their derivatives by their power series (accurate for x up to about 40). */
export function kelvin(x: number): Kelvin {
  const h4 = (x / 2) ** 4
  // t_k = (x/2)^{4k} / ((2k)!)²,  s_k = (x/2)^{4k+2} / ((2k+1)!)²
  let t = 1
  let s = (x / 2) ** 2
  let ber = 0
  let bei = 0
  let dber = 0
  let dbei = 0
  for (let k = 0; k < 400; k++) {
    const sign = k % 2 === 0 ? 1 : -1
    ber += sign * t
    bei += sign * s
    if (x !== 0) {
      dber += (sign * 4 * k * t) / x // d/dx of (x/2)^{4k} = 4k/x · (x/2)^{4k}
      dbei += (sign * (4 * k + 2) * s) / x
    }
    const tNext = (t * h4) / ((2 * k + 1) * (2 * k + 2)) ** 2
    const sNext = (s * h4) / ((2 * k + 2) * (2 * k + 3)) ** 2
    t = tNext
    s = sNext
    if (k > 2 && t + s < 1e-18 * (Math.abs(ber) + Math.abs(bei) + 1)) break
  }
  return { ber, bei, dber, dbei }
}

/** q = r·√(ωμσ) = √2·r/δ: the one number the skin-effect ratio depends on. */
export const skinQ = (rM: number, rho: number, fHz: number): number => (fHz <= 0 ? 0 : (Math.SQRT2 * rM) / skinDepth(rho, fHz))

/** R_ac / R_dc of a solid round conductor (exact Bessel solution): (q/2)·(ber·bei′ − bei·ber′) / (ber′² + bei′²). */
export function skinRatioQ(q: number): number {
  if (q < 1e-6) return 1
  const k = kelvin(q)
  return ((q / 2) * (k.ber * k.dbei - k.bei * k.dber)) / (k.dber * k.dber + k.dbei * k.dbei)
}
export const skinRatio = (rM: number, rho: number, fHz: number): number => skinRatioQ(skinQ(rM, rho, fHz))
/** Low-frequency limit: 1 + q⁴/192. */
export const skinRatioLow = (q: number): number => 1 + q ** 4 / 192
/** High-frequency asymptote: q/(2√2) + 1/4 = r/(2δ) + 1/4. */
export const skinRatioHigh = (q: number): number => q / (2 * Math.SQRT2) + 0.25

/**
 * How the exact ratio compares with its two simple estimates. For every q, max(1, r/(2δ) + ¼) ≤ R_ac/R_dc ≤ 1 + q⁴/192
 * (checked over 0 < q ≤ 40 in the tests). The low-frequency estimate is within 1 % up to q ≈ 2.2; the high-frequency
 * asymptote is within about 1.5 % from q ≈ 3 (the error is not monotonic: 0.6 % at q = 3, 1.2 % at q = 5, 0.3 % at q = 10).
 */
export interface SkinCheck {
  exact: number
  low: number
  high: number
  /** Which estimate describes this q: 'low' (q ≤ 2), 'high' (q ≥ 3) or neither ('between'). */
  regime: 'low' | 'high' | 'between'
  /** The exact value lies between the two estimates. */
  bracketed: boolean
}
export function skinCheck(q: number): SkinCheck {
  const exact = skinRatioQ(q)
  const low = skinRatioLow(q)
  const high = skinRatioHigh(q)
  return { exact, low, high, regime: q <= 2 ? 'low' : q >= 3 ? 'high' : 'between', bracketed: Math.max(1, high) <= exact + 1e-12 && exact <= low + 1e-12 }
}

/** The size of the skin effect in words, from the computed ratio: "negligible (0.4 %)", "small (about 5 %)", "large (about 35 %)". */
export function skinWords(ratio: number): string {
  const p = (ratio - 1) * 100
  const n = p < 10 ? p.toFixed(1) : p.toFixed(0)
  if (p < 1) return `negligible (${n} %)`
  if (p < 10) return `small (about ${n} %)`
  if (p < 25) return `noticeable (about ${n} %)`
  return `large (about ${n} %)`
}

/**
 * |J(ρ)| / J_dc across a solid conductor (ρ from 0 to r): J ∝ ber(qρ/r) + j·bei(qρ/r), normalised by the dc current
 * density of the same total current (the complex average over the cross-section, by the trapezoidal rule).
 */
export function currentDensity(q: number, points = 60): Array<[number, number]> {
  const vals = Array.from({ length: points + 1 }, (_, k) => {
    const f = k / points
    const v = kelvin(q * f)
    return { f, re: v.ber, im: v.bei }
  })
  // average over the area: (2/r²)∫ J ρ dρ → 2∫ J f df
  let re = 0
  let im = 0
  for (let k = 1; k <= points; k++) {
    const a = vals[k - 1]
    const b = vals[k]
    const h = b.f - a.f
    re += h * (a.re * a.f + b.re * b.f)
    im += h * (a.im * a.f + b.im * b.f)
  }
  const avg = Math.hypot(re, im)
  return vals.map((v) => [v.f, Math.hypot(v.re, v.im) / avg] as [number, number])
}

export interface Resistance {
  rho: number
  /** dc, one sub-conductor and per phase [Ω/km]. */
  rDcSub: number
  rDc: number
  /** At the design frequency (50 Hz). */
  delta50: number
  q50: number
  ratio50: number
  rAc: number
}

export function resistance(rM: number, n: Bundle, tempC: number): Resistance {
  const rho = rhoAt(tempC)
  const rDcSub = rDcPerKm(rM, tempC)
  const q50 = skinQ(rM, rho, F_DESIGN)
  const ratio50 = skinRatioQ(q50)
  return { rho, rDcSub, rDc: rDcSub / n, delta50: skinDepth(rho, F_DESIGN), q50, ratio50, rAc: (rDcSub * ratio50) / n }
}

// ── closed forms (the textbook method) ───────────────────────────────────────────────────────────────────────

/** Single-phase two-wire line: loop inductance 4×10⁻⁷·ln(D/r′) [H/m], capacitance between the wires πε₀/ln(D/r) [F/m]. */
export function singlePhase(dM: number, rM: number) {
  const loopH = 2 * K_L * Math.log(dM / (R_PRIME * rM))
  const cLineF = (Math.PI * EPS0) / Math.log(dM / rM)
  return { loopH, perConductorH: loopH / 2, cLineF, cNeutralF: 2 * cLineF }
}

/** Inductance per phase 2×10⁻⁷·ln(GMD/GMR) [H/m]. */
export const inductanceH = (gmd: number, gmr: number): number => K_L * Math.log(gmd / gmr)
/** Capacitance to neutral 2πε₀ / ln(GMD/r_eq) [F/m] (without earth). */
export const capacitanceF = (gmd: number, req: number): number => (2 * Math.PI * EPS0) / Math.log(gmd / req)

export const gmd3 = (dab: number, dbc: number, dca: number): number => Math.cbrt(dab * dbc * dca)

/** Distance from p to the image (mirror in the ground) of q. */
export const imageDist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y + q.y)

export interface LineResult {
  ok: true
  /** Phase spacings D_ab, D_bc, D_ca [m]. */
  dab: number
  dbc: number
  dca: number
  gmd: number
  /** Bundle GMR for inductance (with r′) and equivalent radius for capacitance (with r) [m]. */
  gmrL: number
  req: number
  /** Earth term of the capacitance: ln[(H_ab·H_bc·H_ca)^(1/3) / (H_a·H_b·H_c)^(1/3)] (0 when earth is off). */
  earthLn: number
  hMean: number
  /** Operating values per phase (transposed: averaged over the cycle). */
  lMhKm: number
  cNfKm: number
  cNoEarthNfKm: number
  r: Resistance
  xOhmKm: number
  bUsKm: number
  zcOhm: number
  silMw: number
  /** Charging current per phase [A/km] and three-phase charging reactive power [Mvar per 100 km] at the nominal voltage. */
  chargingAKm: number
  chargingMvar100: number
  /** The matrix model (independent): transposition-averaged values and, untransposed, each phase's own. */
  matrix: MatrixResult
}
export type LineOutcome = LineResult | { ok: false; issues: GeometryIssue[] }

export function computeLine(g: LineGeometry, o: LineOptions): LineOutcome {
  const issues = validateGeometry(g)
  if (issues.length) return { ok: false, issues }
  const [A, B, Cp] = g.phases
  const dab = dist(A, B)
  const dbc = dist(B, Cp)
  const dca = dist(Cp, A)
  const gmd = gmd3(dab, dbc, dca)
  const gmrL = bundleGmFormula(g.n, g.dM, R_PRIME * g.rM)
  const req = bundleGmFormula(g.n, g.dM, g.rM)
  const hProd = Math.cbrt(2 * A.y * 2 * B.y * 2 * Cp.y)
  const hMutual = Math.cbrt(imageDist(A, B) * imageDist(B, Cp) * imageDist(Cp, A))
  const earthLn = o.earth ? Math.log(hMutual / hProd) : 0
  const lH = inductanceH(gmd, gmrL)
  const cNoEarth = capacitanceF(gmd, req)
  const cF = (2 * Math.PI * EPS0) / (Math.log(gmd / req) - earthLn)
  const w = 2 * Math.PI * F_DESIGN
  const lMhKm = lH * 1e6
  const cNfKm = cF * 1e12
  const xOhmKm = w * lH * 1000
  const bUsKm = w * cF * 1000 * 1e6
  const zcOhm = Math.sqrt(lH / cF)
  const r = resistance(g.rM, g.n, o.tempC)
  const vPh = (o.kv * 1000) / Math.sqrt(3)
  return {
    ok: true,
    dab,
    dbc,
    dca,
    gmd,
    gmrL,
    req,
    earthLn,
    hMean: (A.y + B.y + Cp.y) / 3,
    lMhKm,
    cNfKm,
    cNoEarthNfKm: cNoEarth * 1e12,
    r,
    xOhmKm,
    bUsKm,
    zcOhm,
    silMw: (o.kv * o.kv) / zcOhm,
    chargingAKm: vPh * bUsKm * 1e-6,
    chargingMvar100: o.kv * o.kv * bUsKm * 1e-6 * 100,
    matrix: matrixModel(g, o.earth),
  }
}

// ── the matrix model (an independent second method) ──────────────────────────────────────────────────────────

export type Matrix = number[][]

/**
 * Inductance coefficients of N parallel conductors [H/m]: L_kk = 2×10⁻⁷·ln(1/r′), L_kj = 2×10⁻⁷·ln(1/D_kj). The
 * reference distance cancels when the currents add to zero, so it is left at 1 m.
 */
export function inductanceMatrix(pts: Pt[], rPrime: number): Matrix {
  return pts.map((p, k) => pts.map((q, j) => K_L * Math.log(1 / (k === j ? rPrime : dist(p, q)))))
}

/** Potential coefficients [m/F]: P_kk = ln(2h_k/r)/(2πε₀), P_kj = ln(D′_kj/D_kj)/(2πε₀) with earth; ln(1/r), ln(1/D) without. */
export function potentialMatrix(pts: Pt[], r: number, earth: boolean): Matrix {
  const k0 = 1 / (2 * Math.PI * EPS0)
  return pts.map((p, k) =>
    pts.map((q, j) => {
      if (k === j) return k0 * Math.log((earth ? 2 * p.y : 1) / r)
      return k0 * Math.log((earth ? imageDist(p, q) : 1) / dist(p, q))
    }),
  )
}

/** Inverse of a square matrix (Gauss–Jordan with partial pivoting). */
export function invert(m: Matrix): Matrix {
  const n = m.length
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (Math.abs(a[p][c]) < 1e-300) throw new Error('singular matrix')
    ;[a[c], a[p]] = [a[p], a[c]]
    const piv = a[c][c]
    for (let j = 0; j < 2 * n; j++) a[c][j] /= piv
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = a[r][c]
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]
    }
  }
  return a.map((row) => row.slice(n))
}

/**
 * Without the earth there is no absolute zero of potential: the potential coefficients ln(1/D) carry an arbitrary
 * reference distance, and only a system whose charges add to zero is defined. The capacitance matrix of such a system
 * is C′ = C − (C·1)(1ᵀ·C) / (1ᵀ·C·1) with C = P⁻¹: then Σq = 0 for every set of voltages, and C′ does not depend on
 * the reference distance.
 */
export function zeroNetCharge(Cm: Matrix): Matrix {
  const n = Cm.length
  const row = Cm.map((r) => r.reduce((a, v) => a + v, 0)) // C·1 (C is symmetric, so also 1ᵀ·C)
  const tot = row.reduce((a, v) => a + v, 0)
  return Cm.map((r, i) => r.map((v, j) => v - (row[i] * row[j]) / tot)).slice(0, n)
}

/** Flux linkages λ = L·I for complex currents. */
export function linkages(L: Matrix, I: Complex[]): Complex[] {
  return L.map((row) => row.reduce((acc, l, j) => add(acc, mul(C(l, 0), I[j])), ZERO))
}

/**
 * Reduce an N×N inductance matrix to phases: each phase's current shared equally by its n sub-conductors, and the
 * phase's flux linkage taken as the average of its sub-conductors' (L3_pq = mean of the L_kj block).
 */
export function reduceAverage(M: Matrix, phase: PhaseIndex[]): Matrix {
  const out = [0, 1, 2].map(() => [0, 0, 0])
  const cnt = [0, 1, 2].map(() => [0, 0, 0])
  M.forEach((row, k) =>
    row.forEach((v, j) => {
      out[phase[k]][phase[j]] += v
      cnt[phase[k]][phase[j]]++
    }),
  )
  return out.map((row, p) => row.map((v, q) => v / cnt[p][q]))
}

/** Reduce an N×N capacitance (Maxwell) matrix to phases with each bundle at one potential: sum of the block. */
export function reduceSum(M: Matrix, phase: PhaseIndex[]): Matrix {
  const out = [0, 1, 2].map(() => [0, 0, 0])
  M.forEach((row, k) => row.forEach((v, j) => (out[phase[k]][phase[j]] += v)))
  return out
}

/** Average a 3×3 phase matrix over a full transposition cycle (each phase in each position for a third of the length). */
export function transpositionAverage(M: Matrix): Matrix {
  const perms = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ]
  const out = [0, 1, 2].map(() => [0, 0, 0])
  for (const P of perms) for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) out[p][q] += M[P[p]][P[q]] / 3
  return out
}

/**
 * How closely the GMD/GMR formulas and the sub-conductor matrix must agree: exactly (single conductors), or within
 * 5 % for bundles — the formulas use bundle-centre distances, an approximation that worsens as bundles approach each
 * other (over valid geometries in this lab the largest gap found is about 2 %, at the minimum spacing; see the tests).
 */
export const matrixTol = (n: Bundle): number => (n === 1 ? 1e-6 : 0.05)

/** Positive-sequence set: a = 1∠0°, b = 1∠−120°, c = 1∠+120°. */
export const POS_SEQ: Complex[] = [polarDeg(1, 0), polarDeg(1, -120), polarDeg(1, 120)]

/** Each phase's own operating value with balanced positive-sequence excitation: (M·x)_p / x_p (complex when untransposed). */
export function perPhase(M: Matrix): Complex[] {
  return M.map((row, p) =>
    div(
      row.reduce((acc, m, q) => add(acc, mul(C(m, 0), POS_SEQ[q])), ZERO),
      POS_SEQ[p],
    ),
  )
}

export interface MatrixResult {
  /** Transposition-averaged operating values from the matrices [mH/km, nF/km]. cNfKm: bundles at one potential and
   * the charge free to differ between transposition sections (exact for this model); cEqualNfKm: the textbook's
   * assumption — equal charge on each sub-conductor and in every section (potential coefficients averaged, then inverted). */
  lMhKm: number
  cNfKm: number
  cEqualNfKm: number
  /** Untransposed: each phase's (λ_p/I_p and q_p/V_p) [mH/km, nF/km] (complex: the imaginary part couples power between phases). */
  lPhase: Complex[]
  cPhase: Complex[]
  /** The 3×3 phase matrices (untransposed) [mH/km, nF/km]. */
  L3: Matrix
  C3: Matrix
  /** How many sub-conductors were modelled. */
  conductors: number
}

/** The full matrix model: every sub-conductor as its own conductor, then reduced to phases and transposition-averaged. */
export function matrixModel(g: LineGeometry, earth: boolean): MatrixResult {
  const subs = subConductors(g)
  const phase = subs.map((s) => s.phase)
  const L3 = reduceAverage(inductanceMatrix(subs, R_PRIME * g.rM), phase).map((r) => r.map((v) => v * 1e6))
  const P = potentialMatrix(subs, g.rM, earth)
  const Pinv = invert(P)
  const C3 = reduceSum(earth ? Pinv : zeroNetCharge(Pinv), phase).map((r) => r.map((v) => v * 1e12))
  const pAvg = transpositionAverage(reduceAverage(P, phase))
  const opVal = (M: Matrix) => {
    const t = transpositionAverage(M)
    return t[0][0] - t[0][1]
  }
  return { lMhKm: opVal(L3), cNfKm: opVal(C3), cEqualNfKm: 1e12 / (pAvg[0][0] - pAvg[0][1]), lPhase: perPhase(L3), cPhase: perPhase(C3), L3, C3, conductors: subs.length }
}

// ── presets ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Arrangement = 'horizontal' | 'vertical' | 'triangular'
export const ARRANGEMENT_LABEL: Record<Arrangement, string> = { horizontal: 'Horizontal (flat)', vertical: 'Vertical', triangular: 'Triangular (delta)' }

/** Phase positions for an arrangement with phase spacing D and lowest height h. */
export function arrangementPhases(a: Arrangement, D: number, h: number): [Pt, Pt, Pt] {
  if (a === 'horizontal')
    return [
      { x: -D, y: h },
      { x: 0, y: h },
      { x: D, y: h },
    ]
  if (a === 'vertical')
    return [
      { x: 6, y: h + 2 * D },
      { x: 6, y: h + D },
      { x: 6, y: h },
    ]
  return [
    { x: -D / 2, y: h },
    { x: 0, y: h + (D * Math.sqrt(3)) / 2 },
    { x: D / 2, y: h },
  ]
}

export interface Design {
  arrangement: Arrangement | 'custom'
  /** Spacing and height the preset was built from (kept for the sliders). */
  spacing: number
  height: number
  geometry: LineGeometry
  options: LineOptions
}

export const DEFAULT_OPTIONS: LineOptions = { transposed: true, earth: true, tempC: 50, kv: 400 }

export function presetDesign(a: Arrangement, spacing = a === 'vertical' ? 8 : 11, height = 15, base?: Partial<Pick<LineGeometry, 'rM' | 'n' | 'dM'>>, options = DEFAULT_OPTIONS): Design {
  return {
    arrangement: a,
    spacing,
    height,
    geometry: { phases: arrangementPhases(a, spacing, height), rM: base?.rM ?? 0.0159, n: base?.n ?? 2, dM: base?.dM ?? 0.45 },
    options,
  }
}

/** A short description of the design (shown in Module 2 when it is offered there). */
export function describe(d: Design, res: LineResult): string {
  const g = d.geometry
  const arr = d.arrangement === 'custom' ? 'custom spacing' : `${ARRANGEMENT_LABEL[d.arrangement].toLowerCase()}`
  const bundle =
    g.n === 1 ? `single ${(g.rM * 2000).toFixed(1)} mm conductor` : `${['', '', 'twin', 'triple', 'quad'][g.n]} bundle of ${(g.rM * 2000).toFixed(1)} mm conductors, ${g.dM.toFixed(2)} m apart`
  return `${arr}, GMD ${res.gmd.toFixed(2)} m, ${bundle}, ${d.options.tempC} °C`
}

/** Percentage change from b to a. */
export const pct = (a: number, b: number): number => ((a - b) / b) * 100

/** The constants offered to Module 2 (its per-km r, x, b at 50 Hz; the transposed, balanced values). */
export function toDesignedLine(d: Design, res: LineResult, at: number): DesignedLine {
  return { rOhmPerKm: res.r.rAc, xOhmPerKm: res.xOhmKm, bUsPerKm: res.bUsKm, kv: d.options.kv, fHz: F_DESIGN, summary: describe(d, res), at }
}
