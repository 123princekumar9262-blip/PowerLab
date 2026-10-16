import { add, C, mul, polarDeg, ZERO, type Complex } from '../../engine/complex.ts'
import { computeLine, EPS0, MU0, presetDesign, type LineResult } from '../line-params/calc.ts'

/*
 * Module 10 — Underground cables. Every number on the page comes from here (no React, so the tests can call it).
 *
 * Single-core cable model (stated on screen):
 *  - a long, straight, coaxial cable: a round conductor of radius r inside an earthed metallic sheath whose inner
 *    radius is R. r is measured over the conductor screen and R under the insulation screen (the screens make the two
 *    boundaries smooth equipotentials);
 *  - one uniform, homogeneous, isotropic dielectric between them (relative permittivity ε_r, resistivity ρ);
 *  - conductor and sheath are equipotentials; no space charge; end effects ignored (the field is purely radial);
 *  - V is the rms voltage between core and sheath. In a three-phase system with earthed sheaths it is the phase
 *    voltage V_LL/√3. Stresses are rms unless marked peak (peak = √2 × rms).
 *
 * Units: radii in cm inside the formulas (inputs in mm), voltage in kV, stress in kV/cm, capacitance in µF/km,
 * insulation resistance in MΩ·km (resistance × length) or MΩ for a given length, current in A or mA.
 */

export { EPS0 }

export interface CableInput {
  /** Conductor radius r (over the conductor screen) [mm]. */
  rMm: number
  /** Sheath inner radius R (under the insulation screen) [mm]. */
  RMm: number
  /** Core-to-sheath voltage V, rms [kV]. */
  vKv: number
  /** Relative permittivity of the insulation. */
  epsR: number
  /** Resistivity of the insulation [Ω·m]. */
  rhoOhmM: number
  /** Loss factor tan δ of the insulation at the working frequency. */
  tanDelta: number
  /** Supply frequency [Hz]. */
  fHz: number
  /** Route length [km]. */
  lengthKm: number
}

/** The cable every mode starts from: illustrative values for a single-core XLPE cable on a 66 kV system. */
export const DEFAULT_CABLE: CableInput = { rMm: 10, RMm: 22, vKv: 38.1, epsR: 2.3, rhoOhmM: 1e14, tanDelta: 0.001, fHz: 50, lengthKm: 5 }
/** The permissible maximum stress the economical-size and colour scale use by default [kV/cm rms] — a design value, not a material property. */
export const G_PERM_DEFAULT = 60

/** Slider ranges [min, max, step]. ρ is set by its base-10 logarithm. */
export const RANGE = {
  rMm: [2, 40, 0.5],
  RMm: [3, 80, 0.5],
  vKv: [1, 130, 0.1],
  epsR: [1, 8, 0.1],
  log10Rho: [11, 16, 0.1],
  tanDelta: [0.0001, 0.03, 0.0001],
  lengthKm: [0.1, 50, 0.1],
  gPerm: [10, 200, 1],
} as const

export interface CableIssue {
  field: keyof CableInput
  message: string
}

const fmt = (x: number, d = 1) => x.toFixed(d).replace('-', '−')

/** Everything that makes a cable impossible (or outside the model). Empty: valid. */
export function validateCable(c: CableInput): CableIssue[] {
  const out: CableIssue[] = []
  for (const k of Object.keys(c) as Array<keyof CableInput>) if (typeof c[k] !== 'number' || !Number.isFinite(c[k])) out.push({ field: k, message: `${k} must be a finite number.` })
  if (out.length) return out
  if (c.rMm <= 0) out.push({ field: 'rMm', message: 'The conductor radius r must be greater than zero.' })
  if (c.RMm <= c.rMm)
    out.push({
      field: 'RMm',
      message: `The sheath radius R (${fmt(c.RMm)} mm) must be larger than the conductor radius r (${fmt(c.rMm)} mm): there is no room for insulation.`,
    })
  if (c.vKv <= 0) out.push({ field: 'vKv', message: 'The core-to-sheath voltage must be greater than zero.' })
  if (c.epsR < 1) out.push({ field: 'epsR', message: 'A relative permittivity below 1 is not a real material.' })
  if (c.rhoOhmM <= 0) out.push({ field: 'rhoOhmM', message: 'The insulation resistivity must be greater than zero.' })
  if (c.tanDelta < 0) out.push({ field: 'tanDelta', message: 'tan δ cannot be negative.' })
  if (c.fHz <= 0) out.push({ field: 'fHz', message: 'The frequency must be greater than zero.' })
  if (c.lengthKm <= 0) out.push({ field: 'lengthKm', message: 'The length must be greater than zero.' })
  return out
}

// ── the coaxial field (closed forms) ─────────────────────────────────────────────────────────────────────────

/** Stress at radius x: g(x) = V / (x · ln(R/r)) [kV/cm with V in kV and x in cm]. */
export const stressAt = (vKv: number, xCm: number, rCm: number, RCm: number): number => vKv / (xCm * Math.log(RCm / rCm))
/** Potential at radius x (sheath = 0): V(x) = V · ln(R/x) / ln(R/r) [kV]. */
export const potentialAt = (vKv: number, xCm: number, rCm: number, RCm: number): number => (vKv * Math.log(RCm / xCm)) / Math.log(RCm / rCm)
/** The radius where the potential is the fraction k of V: x = R·(r/R)^k (k = 0 → R, k = 1 → r). */
export const equipotentialRadius = (k: number, rCm: number, RCm: number): number => RCm * (rCm / RCm) ** k
/** Capacitance per metre 2πε₀ε_r / ln(R/r) [F/m]. */
export const capacitancePerM = (epsR: number, rCm: number, RCm: number): number => (2 * Math.PI * EPS0 * epsR) / Math.log(RCm / rCm)
/** Insulation resistance × length: ρ·ln(R/r) / 2π [Ω·m] (so R_ins = this / l). */
export const insulationOhmM = (rhoOhmM: number, rCm: number, RCm: number): number => (rhoOhmM * Math.log(RCm / rCm)) / (2 * Math.PI)
/** Loop inductance per metre between conductor and sheath from the flux in the insulation: (μ₀/2π)·ln(R/r) [H/m]. */
export const inductancePerM = (rCm: number, RCm: number): number => (MU0 / (2 * Math.PI)) * Math.log(RCm / rCm)

export interface CableResult {
  ok: true
  c: CableInput
  /** r and R [cm], ln(R/r), insulation thickness [mm]. */
  r: number
  R: number
  ln: number
  thicknessMm: number
  /** Capacitance per core: per metre [F/m], per km [µF/km], whole length [µF]. */
  cFm: number
  cUfKm: number
  cUf: number
  /** Insulation resistance: × length [MΩ·km], of the whole length [MΩ]. */
  rInsMOhmKm: number
  rInsMOhm: number
  /** Stresses [kV/cm rms]: at the conductor (maximum) and at the sheath (minimum); maximum as a peak value. */
  gMax: number
  gMin: number
  gMaxPeak: number
  /** g_max / g_min = R / r. */
  ratio: number
  omega: number
  /** Charging current per core: per km [A/km], whole length [A]. */
  icAKm: number
  ic: number
  /** Charging reactive power per core [kvar/km]; three cores (a three-phase circuit), whole length [Mvar]. */
  qKvarKm: number
  q3Mvar: number
  /** Dielectric loss ωCV²·tan δ per core [W/km]; three cores, whole length [kW]. */
  pWKm: number
  p3Kw: number
  /** Conduction through the insulation resistance: leakage current [µA] and loss V²/R_ins [W] of one core, whole length. */
  leakUa: number
  leakW: number
  /** The loss factor the insulation resistance alone would give: 1/(ω ε₀ ε_r ρ). */
  tanCond: number
  /** Loop inductance (flux in the insulation) [mH/km], surge impedance [Ω], wave speed [m/µs]. */
  lMhKm: number
  zc: number
  speed: number
}
export type CableOutcome = CableResult | { ok: false; issues: CableIssue[] }

export function computeCable(c: CableInput): CableOutcome {
  const issues = validateCable(c)
  if (issues.length) return { ok: false, issues }
  const r = c.rMm / 10
  const R = c.RMm / 10
  const ln = Math.log(R / r)
  const cFm = capacitancePerM(c.epsR, r, R)
  const omega = 2 * Math.PI * c.fHz
  const rInsOhmM = insulationOhmM(c.rhoOhmM, r, R)
  const cUfKm = cFm * 1e3 * 1e6
  const cUf = cUfKm * c.lengthKm
  const vV = c.vKv * 1000
  const icAKm = omega * cFm * 1000 * vV
  const qKvarKm = (omega * cFm * 1000 * vV * vV) / 1000
  const pWKm = omega * cFm * 1000 * vV * vV * c.tanDelta
  const rInsOhm = rInsOhmM / (c.lengthKm * 1000)
  const lFm = inductancePerM(r, R)
  return {
    ok: true,
    c,
    r,
    R,
    ln,
    thicknessMm: c.RMm - c.rMm,
    cFm,
    cUfKm,
    cUf,
    rInsMOhmKm: rInsOhmM / 1000 / 1e6,
    rInsMOhm: rInsOhm / 1e6,
    gMax: stressAt(c.vKv, r, r, R),
    gMin: stressAt(c.vKv, R, r, R),
    gMaxPeak: Math.SQRT2 * stressAt(c.vKv, r, r, R),
    ratio: R / r,
    omega,
    icAKm,
    ic: icAKm * c.lengthKm,
    qKvarKm,
    q3Mvar: (3 * qKvarKm * c.lengthKm) / 1000,
    pWKm,
    p3Kw: (3 * pWKm * c.lengthKm) / 1000,
    leakUa: (vV / rInsOhm) * 1e6,
    leakW: (vV * vV) / rInsOhm,
    tanCond: 1 / (omega * EPS0 * c.epsR * c.rhoOhmM),
    lMhKm: lFm * 1e6,
    zc: Math.sqrt(lFm / cFm),
    speed: 1 / Math.sqrt(lFm * cFm) / 1e6,
  }
}

/** Closed form of the coaxial surge impedance: (1/2π)·√(μ₀/(ε₀ε_r))·ln(R/r) ≈ 60·ln(R/r)/√ε_r [Ω]. */
export const surgeImpedanceClosed = (epsR: number, rCm: number, RCm: number): number => (Math.sqrt(MU0 / (EPS0 * epsR)) / (2 * Math.PI)) * Math.log(RCm / rCm)

/** g(x) and V(x) across the insulation for plotting: [x in mm, value]. */
export function profile(res: CableResult, n = 80): { g: Array<[number, number]>; v: Array<[number, number]> } {
  const g: Array<[number, number]> = []
  const v: Array<[number, number]> = []
  for (let k = 0; k <= n; k++) {
    const x = res.r + ((res.R - res.r) * k) / n
    g.push([x * 10, stressAt(res.c.vKv, x, res.r, res.R)])
    v.push([x * 10, potentialAt(res.c.vKv, x, res.r, res.R)])
  }
  return { g, v }
}

/** The probe radius for a position t ∈ [0, 1] across the insulation (0 = at the conductor, 1 = at the sheath) [cm]. */
export const probeRadius = (res: Pick<CableResult, 'r' | 'R'>, t: number): number => res.r + (res.R - res.r) * Math.min(1, Math.max(0, t))

// ── independent second methods (numerical) ─────────────────────────────────────────────────────────────────────

/** Composite Simpson's rule with n (even) intervals. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 4000): number {
  const m = n % 2 === 0 ? n : n + 1
  const h = (b - a) / m
  let s = f(a) + f(b)
  for (let k = 1; k < m; k++) s += (k % 2 ? 4 : 2) * f(a + k * h)
  return (s * h) / 3
}
/** How closely a 4000-step Simpson integral must agree with a closed form here (its error for these 1/x-type integrands is below 1e-7 for R/r ≤ 40). */
export const NUM_TOL = 1e-6

/** Gauss's law: a charge q per metre gives D = q/(2πx), so E = q/(2π ε₀ ε_r x) [V/m] (x in m). */
export const gaussField = (qPerM: number, epsR: number, xM: number): number => qPerM / (2 * Math.PI * EPS0 * epsR * xM)

/** C from its definition q/V: put 1 µC/m on the conductor, integrate Gauss's field from r to R for V [F/m]. */
export function capacitanceByCharge(epsR: number, rCm: number, RCm: number): number {
  const q = 1e-6
  const v = simpson((x) => gaussField(q, epsR, x), rCm / 100, RCm / 100)
  return q / v
}

/** C from the stored energy: ½CV² = ∫ ½ ε E² · 2πx dx (per metre), with E from the closed-form stress [F/m]. */
export function capacitanceByEnergy(epsR: number, rCm: number, RCm: number, vV = 1000): number {
  const ln = Math.log(RCm / rCm)
  const e = EPS0 * epsR
  const w = simpson((x) => 0.5 * e * (vV / (x * ln)) ** 2 * 2 * Math.PI * x, rCm / 100, RCm / 100)
  return (2 * w) / (vV * vV)
}

/** Insulation resistance × length by summing thin cylindrical shells in series: ∫ ρ dx / (2πx) [Ω·m]. */
export const insulationByShells = (rhoOhmM: number, rCm: number, RCm: number): number => simpson((x) => rhoOhmM / (2 * Math.PI * x), rCm / 100, RCm / 100)

/** The stress as −dV/dx of the potential (central difference, h = 10⁻⁵·x) [kV/cm]. */
export function stressByDerivative(vKv: number, xCm: number, rCm: number, RCm: number): number {
  const h = 1e-5 * xCm
  return -(potentialAt(vKv, xCm + h, rCm, RCm) - potentialAt(vKv, xCm - h, rCm, RCm)) / (2 * h)
}

/** ∫ g dx from r to R (should equal V) [kV]. */
export const voltageByIntegration = (vKv: number, rCm: number, RCm: number): number => simpson((x) => stressAt(vKv, x, rCm, RCm), rCm, RCm)

// ── the most economical conductor size ─────────────────────────────────────────────────────────────────────────

/** The sheath radius needed to keep g_max = G with conductor radius r: R = r·e^{V/(G r)} [cm]. */
export const sheathFor = (rCm: number, vKv: number, gPerm: number): number => rCm * Math.exp(vKv / (gPerm * rCm))
/** The closed-form optimum: r = V/G, R = e·r (ln(R/r) = 1). */
export function economicSize(vKv: number, gPerm: number): { rCm: number; RCm: number } {
  const r = vKv / gPerm
  return { rCm: r, RCm: Math.E * r }
}

/** Golden-section minimum of a unimodal f on [a, b]. */
export function goldenMin(f: (x: number) => number, a: number, b: number, tol = 1e-12): number {
  const k = (Math.sqrt(5) - 1) / 2
  let lo = a
  let hi = b
  let c = hi - k * (hi - lo)
  let d = lo + k * (hi - lo)
  let fc = f(c)
  let fd = f(d)
  for (let i = 0; i < 300 && hi - lo > tol * (1 + Math.abs(lo) + Math.abs(hi)); i++) {
    if (fc < fd) {
      hi = d
      d = c
      fd = fc
      c = hi - k * (hi - lo)
      fc = f(c)
    } else {
      lo = c
      c = d
      fc = fd
      d = lo + k * (hi - lo)
      fd = f(d)
    }
  }
  return (lo + hi) / 2
}

/** The same optimum found numerically: minimise ln R(r) = ln r + V/(G r) over r from 1 µm to 100 m (no formula used). */
export function economicNumeric(vKv: number, gPerm: number): { rCm: number; RCm: number } {
  const u = goldenMin((u) => u + vKv / (gPerm * Math.exp(u)), Math.log(1e-4), Math.log(1e4))
  const r = Math.exp(u)
  return { rCm: r, RCm: sheathFor(r, vKv, gPerm) }
}

/** g_max for a conductor of radius r inside a fixed sheath R: V / (r ln(R/r)); smallest at r = R/e. */
export const gMaxFixedSheath = (vKv: number, rCm: number, RCm: number): number => stressAt(vKv, rCm, rCm, RCm)

// ── grading ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface GradedLayer {
  /** Inner and outer radius [cm]. */
  inner: number
  outer: number
  eps: number
  /** Voltage across the layer [kV]. */
  vKv: number
  /** Stress at the inner (maximum) and outer (minimum) radius of the layer [kV/cm]. */
  gMax: number
  gMin: number
}
export interface GradedResult {
  ok: true
  kind: 'capacitance' | 'intersheath'
  layers: GradedLayer[]
  /** The highest stress anywhere [kV/cm]. */
  peak: number
  /** Capacitance grading: q/(2πε₀) [kV] and the cable's capacitance [µF/km]. */
  kKv?: number
  cUfKm?: number
  /** Intersheath grading: the potentials of the conductor, each intersheath and the sheath [kV]. */
  potentials?: number[]
}
export type GradedOutcome = GradedResult | { ok: false; message: string }

function checkRadii(radii: number[]): string | null {
  if (radii.length < 2 || !radii.every((x) => Number.isFinite(x) && x > 0)) return 'Every radius must be a positive number.'
  for (let i = 1; i < radii.length; i++) if (radii[i] <= radii[i - 1]) return 'The layer boundaries must lie in order between the conductor and the sheath.'
  return null
}

/**
 * Capacitance grading: n layers with permittivities ε_i between radii r_0 = r < r_1 < … < r_n = R. D = q/(2πx) is the
 * same in every layer, so g_i(x) = q / (2π ε₀ ε_i x) = K/(ε_i x) with K = q/(2πε₀) = V / Σ ln(r_i/r_{i−1})/ε_i.
 */
export function capacitanceGraded(vKv: number, radiiCm: number[], eps: number[]): GradedOutcome {
  const bad = checkRadii(radiiCm)
  if (bad) return { ok: false, message: bad }
  if (eps.length !== radiiCm.length - 1 || !eps.every((e) => Number.isFinite(e) && e >= 1)) return { ok: false, message: 'Each layer needs a relative permittivity of at least 1.' }
  const S = eps.reduce((s, e, i) => s + Math.log(radiiCm[i + 1] / radiiCm[i]) / e, 0)
  const K = vKv / S
  const layers = eps.map((e, i) => {
    const a = radiiCm[i]
    const b = radiiCm[i + 1]
    return { inner: a, outer: b, eps: e, vKv: (K * Math.log(b / a)) / e, gMax: K / (e * a), gMin: K / (e * b) }
  })
  return { ok: true, kind: 'capacitance', layers, peak: Math.max(...layers.map((l) => l.gMax)), kKv: K, cUfKm: ((2 * Math.PI * EPS0) / S) * 1e9 }
}

/** Boundaries that give every layer the same maximum stress: ε₁r₀ = ε₂r₁ = ε₃r₂ = … → r_i = ε₁ r / ε_{i+1}. */
export const equalPeakRadii = (rCm: number, eps: number[]): number[] => eps.slice(1).map((e) => (eps[0] * rCm) / e)

/**
 * Intersheath grading: one dielectric (ε_r), metallic intersheaths at r_1 … r_{n−1} held at chosen potentials
 * (conductor V, sheath 0). Each layer is a small coaxial cable: g(x) = ΔV_i / (x · ln(r_i/r_{i−1})).
 */
export function intersheathGraded(vKv: number, radiiCm: number[], interKv: number[], epsR = 1): GradedOutcome {
  const bad = checkRadii(radiiCm)
  if (bad) return { ok: false, message: bad }
  if (interKv.length !== radiiCm.length - 2) return { ok: false, message: 'Give one potential for each intersheath.' }
  const pot = [vKv, ...interKv, 0]
  for (let i = 1; i < pot.length; i++)
    if (!(pot[i] < pot[i - 1]))
      return { ok: false, message: 'Each intersheath must be at a lower potential than the layer inside it (and above the earthed sheath) — otherwise a layer has no stress or a reversed one.' }
  const layers = pot.slice(1).map((p, i) => {
    const a = radiiCm[i]
    const b = radiiCm[i + 1]
    const dv = pot[i] - p
    return { inner: a, outer: b, eps: epsR, vKv: dv, gMax: dv / (a * Math.log(b / a)), gMin: dv / (b * Math.log(b / a)) }
  })
  return { ok: true, kind: 'intersheath', layers, peak: Math.max(...layers.map((l) => l.gMax)), potentials: pot }
}

/** Intersheath potentials for equal maximum stress in every layer: ΔV_i = G·r_{i−1}·ln(r_i/r_{i−1}), Σ ΔV_i = V. */
export function intersheathEqualPeak(vKv: number, radiiCm: number[]): number[] {
  const w = radiiCm.slice(1).map((b, i) => radiiCm[i] * Math.log(b / radiiCm[i]))
  const G = vKv / w.reduce((s, x) => s + x, 0)
  const out: number[] = []
  let v = vKv
  for (let i = 0; i < w.length - 1; i++) {
    v -= G * w[i]
    out.push(v)
  }
  return out
}

/** The stress at radius x in a graded cable (the layer that contains x; at a boundary, the outer layer's value) [kV/cm]. */
export function gradedStressAt(g: GradedResult, xCm: number): number {
  const L = g.layers.find((l) => xCm >= l.inner && xCm < l.outer) ?? g.layers[g.layers.length - 1]
  return g.kind === 'capacitance' ? (g.kKv as number) / (L.eps * xCm) : L.vKv / (xCm * Math.log(L.outer / L.inner))
}

/** A graded profile for plotting, layer by layer (each layer's own points, so the jumps at the boundaries are drawn) [mm, kV/cm]. */
export function gradedProfile(g: GradedResult, perLayer = 30): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const L of g.layers)
    for (let k = 0; k <= perLayer; k++) {
      const x = L.inner + ((L.outer - L.inner) * k) / perLayer
      out.push([x * 10, g.kind === 'capacitance' ? (g.kKv as number) / (L.eps * x) : L.vKv / (x * Math.log(L.outer / L.inner))])
    }
  return out
}

/** Second method for a graded cable: integrate each layer's Gauss-law stress numerically and add (should equal V) [kV]. */
export const gradedVoltageByIntegration = (g: GradedResult): number => g.layers.reduce((s, L) => s + simpson((x) => gradedStressAt(g, x), L.inner, L.outer * (1 - 1e-12)), 0)

// ── three-core belted cable ─────────────────────────────────────────────────────────────────────────────────

export interface Belted {
  ok: true
  /** Core-to-sheath and core-to-core capacitance, and the effective capacitance per phase to neutral [µF]. */
  cs: number
  cc: number
  cn: number
}
export type BeltedOutcome = Belted | { ok: false; message: string }

/**
 * From two measurements on the whole cable: (1) all three cores joined, measured to the sheath: C₁ = 3C_s;
 * (2) one core against the other two joined to the sheath: C₂ = C_s + 2C_c. Then C_n = C_s + 3C_c (the delta of
 * core-to-core capacitances converted to star). Inputs and outputs in µF.
 */
export function beltedFromMeasurements(c1Uf: number, c2Uf: number): BeltedOutcome {
  if (!(Number.isFinite(c1Uf) && Number.isFinite(c2Uf)) || c1Uf <= 0 || c2Uf <= 0) return { ok: false, message: 'Both measured capacitances must be positive numbers.' }
  const cs = c1Uf / 3
  const cc = (c2Uf - cs) / 2
  if (cc <= 0) return { ok: false, message: `Measurement 2 (${c2Uf} µF) must exceed one third of measurement 1 (${fmt(cs, 3)} µF): otherwise the core-to-core capacitance would be zero or negative.` }
  return { ok: true, cs, cc, cn: cs + 3 * cc }
}

/**
 * Independent check: the cores' Maxwell capacitance matrix (diagonal C_s + 2C_c, off-diagonal −C_c, sheath at 0)
 * driven by a balanced set of phase voltages; the charge on core a divided by its voltage is C_n.
 */
export function beltedByMatrix(cs: number, cc: number): Complex {
  const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? cs + 2 * cc : -cc)))
  const v = [polarDeg(1, 0), polarDeg(1, -120), polarDeg(1, 120)]
  return M[0].reduce((acc, m, j) => add(acc, mul(C(m, 0), v[j])), ZERO)
}

/** Charging current per phase of the three-core cable: ω C_n V_LL/√3 [A]. */
export const beltedCharging = (cnUf: number, vLLkV: number, fHz: number): number => 2 * Math.PI * fHz * cnUf * 1e-6 * ((vLLkV * 1000) / Math.sqrt(3))

// ── comparison with Module 8's overhead line ─────────────────────────────────────────────────────────────────

let lineCache: LineResult | null = null
/** Module 8's default line (400 kV, flat, twin bundle), computed by Module 8's own code. */
export function overheadLine(): LineResult {
  if (lineCache) return lineCache
  const d = presetDesign('horizontal')
  const r = computeLine(d.geometry, d.options)
  if (!r.ok) throw new Error('Module 8 default line is invalid')
  lineCache = r
  return r
}

export interface LineCompare {
  /** Capacitance per km per phase [nF/km]: cable core-to-sheath, line to neutral. */
  cCable: number
  cLine: number
  cRatio: number
  /** Charging current per km at the cable's core-to-sheath voltage V [A/km]. */
  icCable: number
  icLine: number
  /** Over the cable's length [A]. */
  icCableTotal: number
  icLineTotal: number
  /** Surge impedances [Ω]. */
  zcCable: number
  zcLine: number
  /** Wave speed [m/µs]. */
  speedCable: number
  speedLine: number
  line: LineResult
}

export function compareWithLine(res: CableResult, line: LineResult = overheadLine()): LineCompare {
  const vV = res.c.vKv * 1000
  const cLine = line.cNfKm
  const icLine = res.omega * cLine * 1e-9 * vV
  const lineSpeed = 1 / Math.sqrt(line.lMhKm * 1e-6 * line.cNfKm * 1e-12) / 1e6
  return {
    cCable: res.cUfKm * 1000,
    cLine,
    cRatio: (res.cUfKm * 1000) / cLine,
    icCable: res.icAKm,
    icLine,
    icCableTotal: res.icAKm * res.c.lengthKm,
    icLineTotal: icLine * res.c.lengthKm,
    zcCable: res.zc,
    zcLine: line.zcOhm,
    speedCable: res.speed,
    speedLine: lineSpeed,
    line,
  }
}

/** The length at which the charging current alone equals a rated current [km]. */
export const criticalLength = (ratedA: number, icAKm: number): number => ratedA / icAKm

// ── words from numbers ─────────────────────────────────────────────────────────────────────────────────────────

/** Percentage change from b to a. */
export const pct = (a: number, b: number): number => ((a - b) / b) * 100

/** "rises by 12.3 %", "falls by 37 %", "does not change" — from the computed values. */
export function changeWords(after: number, before: number, decimals = 1): string {
  const p = pct(after, before)
  if (Math.abs(p) < 0.05) return 'does not change'
  return `${p > 0 ? 'rises' : 'falls'} by ${fmt(Math.abs(p), decimals)} %`
}

/** "about 12.5 times" / "about the same (×1.02)" / "less: ×0.40" — a ratio in words, with the number. */
export function timesWords(ratio: number): string {
  if (ratio >= 1.1) return `about ${ratio < 10 ? fmt(ratio, 1) : fmt(ratio, 0)} times`
  if (ratio > 0.91) return `about the same (×${fmt(ratio, 2)})`
  return `only ×${fmt(ratio, 2)} of`
}

/** How much of the dielectric loss the leakage conduction adds, in words. */
export function shareWords(part: number, whole: number): string {
  const p = (part / whole) * 100
  if (p < 0.01) return `under 0.01 % of it`
  if (p < 1) return `${p.toFixed(2)} % of it — negligible`
  if (p < 10) return `${p.toFixed(1)} % of it — small`
  return `${p.toFixed(0)} % of it — not negligible`
}

// ── checks (Verify) — each compares a closed form with an independent method; must hold for every valid cable ───

export interface CheckResult {
  id: string
  ok: boolean
  /** The closed-form and the second-method values, and their relative difference. */
  a: number
  b: number
  rel: number
  tol: number
}
const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
const mk = (id: string, a: number, b: number, tol: number): CheckResult => {
  const rel = relDiff(a, b)
  return { id, ok: Number.isFinite(rel) && rel <= tol, a, b, rel, tol }
}

/** All the Verify checks for one cable and one permissible stress. */
export function verifyChecks(res: CableResult, gPerm: number): Record<'cap' | 'energy' | 'rins' | 'gmax' | 'gmin' | 'vint' | 'econ' | 'reactive', CheckResult> {
  const { r, R, c } = res
  const econ = economicSize(c.vKv, gPerm)
  const num = economicNumeric(c.vKv, gPerm)
  const w = 0.5 * capacitanceByEnergy(c.epsR, r, R, c.vKv * 1000) * (c.vKv * 1000) ** 2 // stored energy per metre at V rms [J/m]
  return {
    cap: mk('cap', res.cFm, capacitanceByCharge(c.epsR, r, R), NUM_TOL),
    energy: mk('energy', res.cFm, capacitanceByEnergy(c.epsR, r, R, c.vKv * 1000), NUM_TOL),
    rins: mk('rins', res.rInsMOhmKm, insulationByShells(c.rhoOhmM, r, R) / 1e9, NUM_TOL),
    gmax: mk('gmax', res.gMax, stressByDerivative(c.vKv, r, r, R), NUM_TOL),
    gmin: mk('gmin', res.gMin, stressByDerivative(c.vKv, R, r, R), NUM_TOL),
    vint: mk('vint', c.vKv, voltageByIntegration(c.vKv, r, R), NUM_TOL),
    econ: mk('econ', econ.rCm, num.rCm, NUM_TOL),
    // Q = ωCV² must equal 2ω × (average stored electric energy) — energy from the field integral, per km [kvar/km]
    reactive: mk('reactive', res.qKvarKm, (2 * res.omega * w * 1000) / 1000, NUM_TOL),
  }
}
