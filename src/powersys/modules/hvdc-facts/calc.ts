/*
 * Module 14 — HVDC & FACTS: the calculations (pure functions, no React).
 *
 * Units. The HVDC links work in kV, kA, Ω, MW and Mvar (kV/Ω = kA and kV·kA = MW, so no factors of 1000 appear).
 * Compensation and the weak bus work in per unit. Angles are given and returned in degrees; radians inside.
 *
 * Sign conventions (stated on screen too):
 *  · Rectifier: firing angle α measured from the natural commutation point; V_dr > 0 drives I_d into the line.
 *  · Inverter: extinction angle γ; its DC voltage V_di is counted POSITIVE as a back-EMF opposing I_d (the bridge's
 *    own voltage, with the rectifier's polarity, is −V_di). Firing advance β = 180° − α_i, and μ = β − γ.
 *  · Both converters ABSORB reactive power; Q_r and Q_i are reported as positive Mvar drawn from the AC side.
 *  · VSC: P and Q are what a converter delivers TO its AC grid (P < 0: rectifying, Q > 0: supplying vars).
 *  · Weak bus: the load consumes P + jQ; a compensator injects Q_c (positive = capacitive, supplying).
 */

const D2R = Math.PI / 180
const R2D = 180 / Math.PI
/** V_d0 = (3√2/π)·V_LL = 1.3505·V_LL — the ideal no-load DC voltage of a 6-pulse bridge. */
export const K_VD0 = (3 * Math.SQRT2) / Math.PI
/** The commutation "resistance" factor: ΔV_d = (3/π)·X_c·I_d per 6-pulse bridge. */
export const K_RC = 3 / Math.PI

export interface Fail {
  ok: false
  issues: string[]
}
const fail = (...issues: string[]): Fail => ({ ok: false, issues })
const fin = (...xs: number[]) => xs.every((x) => Number.isFinite(x))
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Composite Simpson's rule on [a, b] with n (even) intervals. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 400): number {
  if (b <= a) return 0
  const m = n % 2 ? n + 1 : n
  const h = (b - a) / m
  let s = f(a) + f(b)
  for (let k = 1; k < m; k++) s += (k % 2 ? 4 : 2) * f(a + k * h)
  return (s * h) / 3
}

/** Maximise a unimodal f on [a, b] by golden-section search. */
export function goldenMax(f: (x: number) => number, a: number, b: number, tol = 1e-10): { x: number; f: number } {
  const g = (Math.sqrt(5) - 1) / 2
  let lo = a
  let hi = b
  let x1 = hi - g * (hi - lo)
  let x2 = lo + g * (hi - lo)
  let f1 = f(x1)
  let f2 = f(x2)
  for (let it = 0; it < 300 && hi - lo > tol; it++) {
    if (f1 < f2) {
      lo = x1
      x1 = x2
      f1 = f2
      x2 = lo + g * (hi - lo)
      f2 = f(x2)
    } else {
      hi = x2
      x2 = x1
      f2 = f1
      x1 = hi - g * (hi - lo)
      f1 = f(x1)
    }
  }
  const x = (lo + hi) / 2
  return { x, f: f(x) }
}

// ── LCC: one 6-pulse bridge ────────────────────────────────────────────────────────────────────────────────────

export interface BridgeResult {
  ok: true
  /** Ideal no-load DC voltage (3√2/π)·V_LL [kV]. */
  vd0: number
  /** Average DC voltage [kV] (rectifier: V_dr; inverter: V_di counted positive). */
  vd: number
  /** Commutation drop (3/π)·X_c·I_d [kV]. */
  drop: number
  /** Overlap angle μ [°]. */
  muDeg: number
  /** The control angle used: α (rectifier) or γ (inverter) [°]. */
  angleDeg: number
  /** Inverter only: firing advance β = γ + μ [°]. */
  betaDeg: number | null
  /** Displacement factor, standard approximation ½[cos α + cos(α + μ)] (= V_d/V_d0). */
  cosPhi: number
  phiDeg: number
  /** Active power (rectifier: drawn from AC; inverter: delivered to AC) [MW]. */
  p: number
  /** Reactive power absorbed by the converter, Q = P·tan φ [Mvar]. */
  q: number
  /** Apparent power of the AC fundamental, ≈ V_d0·I_d [MVA]. */
  s: number
  /** √2·X_c·I_d / V_LL — the overlap term (dimensionless). */
  k: number
}
export type BridgeOutcome = BridgeResult | Fail

function checkBridgeInputs(vll: number, xc: number, id: number, angleName: string, angleDeg: number): string[] {
  const out: string[] = []
  if (!fin(vll, xc, id, angleDeg)) out.push('Every input must be a finite number.')
  if (!(vll > 0)) out.push('The valve-side line voltage V_LL must be positive.')
  if (!(xc >= 0)) out.push('The commutation reactance X_c cannot be negative.')
  if (!(id >= 0)) out.push('The DC current I_d cannot be negative: the thyristors conduct one way only.')
  if (out.length === 0 && !(angleDeg >= 0)) out.push(`${angleName} cannot be negative.`)
  return out
}

/** A 6-pulse rectifier bridge at firing angle α with commutation reactance X_c [Ω per phase] and current I_d [kA]. */
export function rectifierBridge(vll: number, alphaDeg: number, xc: number, id: number): BridgeOutcome {
  const bad = checkBridgeInputs(vll, xc, id, 'The firing angle α', alphaDeg)
  if (bad.length) return fail(...bad)
  if (alphaDeg > 90) return fail(`α = ${alphaDeg.toFixed(1)}° is outside the rectifier range 0°–90° (above 90° the bridge inverts).`)
  const a = alphaDeg * D2R
  const k = (Math.SQRT2 * xc * id) / vll
  const c2 = Math.cos(a) - k
  if (c2 < -1) return fail(`The current is too large for this reactance: cos(α + μ) = ${c2.toFixed(3)} < −1 — the commutation cannot finish (commutation failure).`)
  const mu = Math.acos(c2) - a
  if (mu >= Math.PI / 3)
    return fail(`The overlap μ = ${(mu * R2D).toFixed(1)}° is 60° or more: the bridge leaves normal two-and-three-valve conduction, which this model does not cover. Lower I_d or X_c.`)
  const vd0 = K_VD0 * vll
  const drop = K_RC * xc * id
  const vd = vd0 * Math.cos(a) - drop
  if (vd < -1e-9) return fail(`At α = ${alphaDeg.toFixed(1)}° and this current V_d would be negative: the bridge would no longer rectify.`)
  const cosPhi = clamp((Math.cos(a) + c2) / 2, 0, 1)
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
  const s = vd0 * id
  return { ok: true, vd0, vd: Math.max(0, vd), drop, muDeg: mu * R2D, angleDeg: alphaDeg, betaDeg: null, cosPhi, phiDeg: Math.acos(cosPhi) * R2D, p: Math.max(0, vd) * id, q: s * sinPhi, s, k }
}

/** A 6-pulse inverter bridge held at extinction angle γ. V_di is counted positive (a back-EMF). */
export function inverterBridge(vll: number, gammaDeg: number, xc: number, id: number): BridgeOutcome {
  const bad = checkBridgeInputs(vll, xc, id, 'The extinction angle γ', gammaDeg)
  if (bad.length) return fail(...bad)
  if (gammaDeg <= 0 || gammaDeg > 90) return fail(`γ = ${gammaDeg.toFixed(1)}° is outside the inverter range (0°, 90°]: the valves need a positive extinction angle to recover.`)
  const g = gammaDeg * D2R
  const k = (Math.SQRT2 * xc * id) / vll
  const cb = Math.cos(g) - k
  if (cb < -1) return fail('The current is too large for this reactance: the commutation cannot finish before the voltage reverses (commutation failure).')
  const beta = Math.acos(cb)
  const mu = beta - g
  if (mu >= Math.PI / 3) return fail(`The overlap μ = ${(mu * R2D).toFixed(1)}° is 60° or more: outside normal operation; this model does not cover it.`)
  const vd0 = K_VD0 * vll
  const drop = K_RC * xc * id
  const vd = vd0 * Math.cos(g) - drop
  if (vd <= 0) return fail('At this γ and current the inverter would have no back-EMF left (V_di ≤ 0).')
  const cosPhi = clamp((Math.cos(g) + cb) / 2, 0, 1)
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
  const s = vd0 * id
  return { ok: true, vd0, vd, drop, muDeg: mu * R2D, angleDeg: gammaDeg, betaDeg: beta * R2D, cosPhi, phiDeg: Math.acos(cosPhi) * R2D, p: vd * id, q: s * sinPhi, s, k }
}

/**
 * The commutation, computed numerically and independently of the closed form: during overlap the two commutating
 * phases are shorted through their reactances, so 2·L_c·di/dt = √2·V_LL·sin x (x from the natural commutation point),
 * i.e. di/dx = √2·V_LL·sin x / (2·X_c). Integrate (RK4) from x = α until i reaches I_d → μ. The DC voltage is the
 * incoming line voltage minus the reactance drop X_c·di/dx during overlap, averaged over one 60° pulse (Simpson).
 */
export function commutationNumeric(vll: number, alphaDeg: number, xc: number, id: number, n = 3000): { ok: true; muDeg: number; vd: number } | Fail {
  const bad = checkBridgeInputs(vll, xc, id, 'α', alphaDeg)
  if (bad.length) return fail(...bad)
  const a = alphaDeg * D2R
  const pk = Math.SQRT2 * vll
  const lineV = (x: number) => pk * Math.sin(x + Math.PI / 3)
  const avg = (mu: number) => (3 / Math.PI) * (simpson((x) => lineV(x) - (xc > 0 ? xc * didx(x) : 0), a, a + mu, n) + simpson(lineV, a + mu, a + Math.PI / 3, n))
  const didx = (x: number) => (pk * Math.sin(x)) / (2 * xc)
  if (xc === 0 || id === 0) return { ok: true, muDeg: 0, vd: avg(0) }
  const h = Math.PI / 3 / n
  // RK4 step of di/dx = f(x) (no dependence on i)
  const step = (x: number, i: number, dx: number) => i + (dx / 6) * (didx(x) + 4 * didx(x + dx / 2) + didx(x + dx))
  let x = a
  let i = 0
  for (let k = 0; k < n; k++) {
    const iNext = step(x, i, h)
    if (iNext >= id) {
      // the crossing lies inside this step: bisect on the step length
      let lo = 0
      let hi = h
      for (let it = 0; it < 80; it++) {
        const m = (lo + hi) / 2
        if (step(x, i, m) < id) lo = m
        else hi = m
      }
      const mu = x + (lo + hi) / 2 - a
      return { ok: true, muDeg: mu * R2D, vd: avg(mu) }
    }
    x += h
    i = iNext
  }
  return fail('The current never reaches I_d within 60°: overlap of 60° or more (outside the model).')
}

/**
 * An inverter bridge by the numerical commutation alone: find (by bisection) the firing angle α_i whose numerically
 * integrated overlap ends exactly γ before 180°, then average its DC voltage numerically. Returns V_di counted
 * positive (minus the bridge voltage), the firing angle and the overlap.
 */
export function inverterNumeric(vll: number, gammaDeg: number, xc: number, id: number): { ok: true; vdi: number; alphaDeg: number; muDeg: number } | Fail {
  const target = 180 - gammaDeg
  const end = (a: number) => {
    const n = commutationNumeric(vll, a, xc, id, 1500)
    return n.ok ? a + n.muDeg : Infinity
  }
  let lo = 90
  let hi = target
  if (!(end(lo) < target)) return fail('The inverter cannot reach this extinction angle (numerically).')
  for (let it = 0; it < 50; it++) {
    const m = (lo + hi) / 2
    if (end(m) < target) lo = m
    else hi = m
  }
  const a = (lo + hi) / 2
  const n = commutationNumeric(vll, a, xc, id)
  if (!n.ok) return n
  return { ok: true, vdi: -n.vd, alphaDeg: a, muDeg: n.muDeg }
}

/**
 * An independent check of a solved LCC operating point: both station voltages recomputed by numerical integration
 * of the commutation (no closed form), then Kirchhoff's voltage law on the DC line gives the current again.
 * It fails if the angles, the current or either converter's voltage formula is wrong.
 */
export function linkCheckNumeric(L: LccLink, r: { alphaDeg: number; gammaDeg: number; id: number; vdr: number; vdi: number }) {
  const nb = L.pulses / 6
  const rn = commutationNumeric(L.vllR, r.alphaDeg, L.xc, r.id)
  const inv = inverterNumeric(L.vllI, r.gammaDeg, L.xc, r.id)
  if (!rn.ok || !inv.ok) return { ok: false as const, vdr: NaN, vdi: NaN, id: NaN }
  const vdr = nb * rn.vd
  const vdi = nb * inv.vdi
  const id = (vdr - vdi) / L.rdc
  return { ok: Math.abs(id - r.id) < 1e-5 && Math.abs(vdr - r.vdr) < 1e-4 && Math.abs(vdi - r.vdi) < 1e-4, vdr, vdi, id }
}

/**
 * The DC voltage of one 6-pulse bridge against ωt over one cycle, built valve by valve (ideal valves, constant I_d):
 * positive-rail valves fire at 30° + α, 150° + α, 270° + α (phases a, b, c), negative-rail valves at 90° + α, 210° + α,
 * 330° + α (phases c, a, b); during an overlap μ the rail sits at the mean of the two commutating phase voltages.
 * Returns points [ωt in degrees, v_d in kV] and the six-pulse envelope (no overlap, α = 0).
 */
export function dcWaveform(vll: number, alphaDeg: number, muDeg: number, nPts = 721): { vd: Array<[number, number]>; envelope: Array<[number, number]>; mean: number } {
  const vph = (vll / Math.sqrt(3)) * Math.SQRT2
  const ph = (k: number, t: number) => vph * Math.sin(t - (k * 2 * Math.PI) / 3)
  const pos = [0, 1, 2].map((k) => ({ phase: k, fire: (30 + 120 * k + alphaDeg) * D2R }))
  const neg = [
    { phase: 2, fire: (90 + alphaDeg) * D2R },
    { phase: 0, fire: (210 + alphaDeg) * D2R },
    { phase: 1, fire: (330 + alphaDeg) * D2R },
  ]
  const mu = muDeg * D2R
  const rail = (valves: typeof pos, t: number) => {
    // the last valve fired at or before t (cyclically), and the one before it
    let best = -1
    let bestAge = Infinity
    valves.forEach((v, j) => {
      const age = (((t - v.fire) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      if (age < bestAge) {
        bestAge = age
        best = j
      }
    })
    const cur = valves[best]
    const prev = valves[(best + 2) % 3]
    return bestAge < mu ? (ph(cur.phase, t) + ph(prev.phase, t)) / 2 : ph(cur.phase, t)
  }
  const vd: Array<[number, number]> = []
  const envelope: Array<[number, number]> = []
  let sum = 0
  for (let j = 0; j < nPts; j++) {
    const deg = (360 * j) / (nPts - 1)
    const t = deg * D2R
    const v = rail(pos, t) - rail(neg, t)
    vd.push([deg, v])
    const e = Math.max(...[0, 1, 2].flatMap((p) => [0, 1, 2].map((q) => ph(p, t) - ph(q, t))))
    envelope.push([deg, e])
    if (j < nPts - 1) sum += v
  }
  return { vd, envelope, mean: sum / (nPts - 1) }
}

/**
 * The AC line current of a rectifier bridge (phase a, with overlap) and its fundamental, by numerical Fourier
 * integration. The current rises as i_c(x) = (√2·V_LL / 2X_c)(cos α − cos x) during each commutation, is I_d for the
 * rest of its 120°, and repeats negatively half a cycle later. Returns the fundamental's rms value, its exact
 * displacement factor, and the fundamental AC powers P = √3·V_LL·I₁·cos φ₁, Q = √3·V_LL·I₁·sin φ₁ [MW, Mvar].
 */
export function acFundamental(vll: number, alphaDeg: number, xc: number, id: number, n = 600): { ok: true; i1: number; cosPhi1: number; pAc: number; qAc: number; i1Ideal: number } | Fail {
  const b = rectifierBridge(vll, alphaDeg, xc, id)
  if (!b.ok) return b
  const a = alphaDeg * D2R
  const mu = b.muDeg * D2R
  const ic = (x: number) => (xc > 0 ? ((Math.SQRT2 * vll) / (2 * xc)) * (Math.cos(a) - Math.cos(x)) : id)
  const t0 = Math.PI / 6 + a // valve 1 (phase a, positive rail) fires
  // segments of s = θ − t0 over one period
  const segs: Array<[number, number, (s: number) => number]> = [
    [0, mu, (s) => ic(a + s)],
    [mu, (2 * Math.PI) / 3, () => id],
    [(2 * Math.PI) / 3, (2 * Math.PI) / 3 + mu, (s) => id - ic(a + s - (2 * Math.PI) / 3)],
    [(2 * Math.PI) / 3 + mu, Math.PI, () => 0],
    [Math.PI, Math.PI + mu, (s) => -ic(a + s - Math.PI)],
    [Math.PI + mu, (5 * Math.PI) / 3, () => -id],
    [(5 * Math.PI) / 3, (5 * Math.PI) / 3 + mu, (s) => -(id - ic(a + s - (5 * Math.PI) / 3))],
    [(5 * Math.PI) / 3 + mu, 2 * Math.PI, () => 0],
  ]
  let a1 = 0
  let b1 = 0
  for (const [s0, s1, f] of segs) {
    if (s1 <= s0) continue
    a1 += simpson((s) => f(s) * Math.cos(s + t0), s0, s1, n) / Math.PI
    b1 += simpson((s) => f(s) * Math.sin(s + t0), s0, s1, n) / Math.PI
  }
  const peak = Math.hypot(a1, b1)
  const i1 = peak / Math.SQRT2
  const cosPhi1 = b1 / peak
  const vph = vll / Math.sqrt(3)
  return { ok: true, i1, cosPhi1, pAc: 3 * vph * i1 * cosPhi1, qAc: 3 * vph * i1 * Math.sqrt(Math.max(0, 1 - cosPhi1 * cosPhi1)), i1Ideal: (Math.sqrt(6) / Math.PI) * id }
}

// ── LCC: the DC link and its controls ──────────────────────────────────────────────────────────────────────────

export type LccControl = { kind: 'power'; pMw: number } | { kind: 'current'; idKa: number } | { kind: 'alpha'; alphaDeg: number }

export interface LccLink {
  /** 6: one bridge per station; 12: two 6-pulse bridges in series per station. */
  pulses: 6 | 12
  /** Valve-side line voltage of each bridge, rectifier [kV rms]. */
  vllR: number
  /** … inverter [kV rms]. */
  vllI: number
  /** Commutation reactance per phase of each bridge (both stations) [Ω]. */
  xc: number
  /** DC line (loop) resistance [Ω]. */
  rdc: number
  /** Rectifier minimum firing angle [°]. */
  alphaMinDeg: number
  /** Inverter extinction-angle setting γ₀ (constant extinction angle control) [°]. */
  gammaDeg: number
  /** Current margin ΔI between the rectifier's and the inverter's current orders [kA]. */
  marginKa: number
  control: LccControl
}

/** Illustrative values (not a specific project): a 12-pulse monopole of about 500 kV, 2 kA, with a 10 Ω line. */
export const LCC0: LccLink = { pulses: 12, vllR: 213, vllI: 208, xc: 12, rdc: 10, alphaMinDeg: 5, gammaDeg: 18, marginKa: 0.2, control: { kind: 'power', pMw: 1000 } }

/** The straight-line characteristics in the V_d–I_d plane, voltages at the RECTIFIER terminal [kV] vs I_d [kA]. */
export function characteristics(L: LccLink) {
  const nb = L.pulses / 6
  const vd0r = nb * K_VD0 * L.vllR
  const vd0i = nb * K_VD0 * L.vllI
  const rcr = nb * K_RC * L.xc
  const rci = nb * K_RC * L.xc
  return {
    nb,
    vd0r,
    vd0i,
    rcr,
    rci,
    /** Rectifier at its minimum firing angle (the most voltage it can make). */
    cia: (i: number) => vd0r * Math.cos(L.alphaMinDeg * D2R) - rcr * i,
    /** Rectifier at a firing angle α. */
    alphaLine: (alphaDeg: number, i: number) => vd0r * Math.cos(alphaDeg * D2R) - rcr * i,
    /** Inverter at constant extinction angle γ₀, seen from the rectifier (its V_di plus the line drop). */
    cea: (i: number) => vd0i * Math.cos(L.gammaDeg * D2R) + (L.rdc - rci) * i,
  }
}

export type LccMode = 'normal' | 'shift' | 'limits' | 'manual'
export const LCC_MODE_TEXT: Record<LccMode, string> = {
  normal: 'Rectifier controls the current (CC); inverter holds γ (CEA)',
  shift: 'Mode shift: rectifier at α_min; inverter controls the current at I_order − ΔI',
  limits: 'Both converters at their angle limits (α_min and γ₀): no controller holds the current',
  manual: 'Firing angle set by hand; inverter holds γ (CEA)',
}

export interface LccResult {
  ok: true
  mode: LccMode
  /** The current order [kA] (null when α is set by hand). */
  iOrder: number | null
  id: number
  vdr: number
  vdi: number
  alphaDeg: number
  gammaDeg: number
  muRDeg: number
  muIDeg: number
  pr: number
  pi: number
  loss: number
  qr: number
  qi: number
  cosPhiR: number
  cosPhiI: number
  vd0r: number
  vd0i: number
  rcr: number
  rci: number
  rect: BridgeResult
  inv: BridgeResult
  /** Power order [MW] (when controlled by power). */
  pOrder: number | null
  /** dI_d/dα at this point [kA per degree] (how sensitive the current is to the firing angle). */
  dIdAlpha: number
}
export type LccOutcome = LccResult | Fail

/** The steady operating point of the link: where the rectifier's and the inverter's characteristics cross. */
export function solveLcc(L: LccLink): LccOutcome {
  const issues: string[] = []
  if (!fin(L.vllR, L.vllI, L.xc, L.rdc, L.alphaMinDeg, L.gammaDeg, L.marginKa)) return fail('Every input must be a finite number.')
  if (!(L.vllR > 0 && L.vllI > 0)) issues.push('Both AC voltages must be positive.')
  if (!(L.xc >= 0)) issues.push('X_c cannot be negative.')
  if (!(L.rdc > 0)) issues.push('The DC line resistance must be positive.')
  if (!(L.alphaMinDeg >= 0 && L.alphaMinDeg < 90)) issues.push('α_min must be between 0° and 90°.')
  if (!(L.gammaDeg > 0 && L.gammaDeg < 90)) issues.push('γ₀ must be between 0° and 90°.')
  if (!(L.marginKa >= 0)) issues.push('The current margin cannot be negative.')
  if (issues.length) return fail(...issues)
  const ch = characteristics(L)
  const { vd0r, vd0i, rcr, rci, nb } = ch
  const denom = L.rdc + rcr - rci
  let mode: LccMode
  let id: number
  let alphaDeg: number
  let gammaDeg = L.gammaDeg
  let iOrder: number | null = null
  let pOrder: number | null = null
  if (L.control.kind === 'alpha') {
    const al = L.control.alphaDeg
    if (!Number.isFinite(al)) return fail('α must be a number.')
    if (al < L.alphaMinDeg || al >= 90) return fail(`α = ${al.toFixed(1)}° is outside the range α_min (${L.alphaMinDeg}°) to 90°.`)
    id = (vd0r * Math.cos(al * D2R) - vd0i * Math.cos(L.gammaDeg * D2R)) / denom
    if (!(id > 0)) return fail(`At α = ${al.toFixed(1)}° the rectifier's voltage is below the inverter's back-EMF, so no current flows (the thyristors block reverse current).`)
    mode = 'manual'
    alphaDeg = al
  } else {
    if (L.control.kind === 'current') {
      iOrder = L.control.idKa
      if (!(Number.isFinite(iOrder) && iOrder > 0)) return fail('The current order must be a positive number.')
    } else {
      pOrder = L.control.pMw
      if (!(Number.isFinite(pOrder) && pOrder > 0)) return fail('The power order must be a positive number.')
      // P = V_dr·I with V_dr on the inverter's CEA line: (R_dc − R_ci)·I² + V_d0i·cos γ₀·I − P = 0
      const a = L.rdc - rci
      const b = vd0i * Math.cos(L.gammaDeg * D2R)
      const disc = b * b + 4 * a * pOrder
      if (disc < 0) return fail(`A power order of ${pOrder.toFixed(0)} MW is more than this link can carry on the inverter's CEA characteristic.`)
      iOrder = Math.abs(a) < 1e-12 ? pOrder / b : (2 * pOrder) / (b + Math.sqrt(disc))
    }
    const io = iOrder
    if (ch.cea(io) <= ch.cia(io)) {
      mode = 'normal'
      id = io
      const c = (ch.cea(io) + rcr * io) / vd0r
      alphaDeg = Math.acos(clamp(c, -1, 1)) * R2D
      if (c <= 0) return fail('The rectifier would need α ≥ 90° to match the inverter — not a rectifier any more.')
    } else {
      const i2 = io - L.marginKa
      if (i2 > 0 && ch.cia(i2) <= ch.cea(i2)) {
        mode = 'shift'
        id = i2
        alphaDeg = L.alphaMinDeg
        const vdi = ch.cia(i2) - L.rdc * i2
        const c = (vdi + rci * i2) / vd0i
        if (!(vdi > 0) || c > 1) return fail('The rectifier AC voltage is too low: no operating point exists even with the inverter controlling the current.')
        gammaDeg = Math.acos(clamp(c, -1, 1)) * R2D
      } else {
        id = (vd0r * Math.cos(L.alphaMinDeg * D2R) - vd0i * Math.cos(L.gammaDeg * D2R)) / denom
        if (!(id > 0) || id >= io) return fail('The rectifier AC voltage is too low: at α_min its voltage is below the inverter’s, so no current flows.')
        mode = 'limits'
        alphaDeg = L.alphaMinDeg
      }
    }
  }
  const rect = rectifierBridge(L.vllR, alphaDeg, L.xc, id)
  if (!rect.ok) return fail(...rect.issues.map((m) => `Rectifier: ${m}`))
  const inv = inverterBridge(L.vllI, gammaDeg, L.xc, id)
  if (!inv.ok) return fail(...inv.issues.map((m) => `Inverter: ${m}`))
  const vdr = nb * rect.vd
  const vdi = nb * inv.vd
  return {
    ok: true,
    mode,
    iOrder,
    pOrder,
    id,
    vdr,
    vdi,
    alphaDeg,
    gammaDeg,
    muRDeg: rect.muDeg,
    muIDeg: inv.muDeg,
    pr: vdr * id,
    pi: vdi * id,
    loss: vdr * id - vdi * id,
    qr: nb * rect.q,
    qi: nb * inv.q,
    cosPhiR: rect.cosPhi,
    cosPhiI: inv.cosPhi,
    vd0r,
    vd0i,
    rcr,
    rci,
    rect,
    inv,
    dIdAlpha: (vd0r * Math.sin(alphaDeg * D2R) * D2R) / denom,
  }
}

// ── VSC-HVDC ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One VSC behind its phase reactor: the converter voltage V_c∠δ needed to deliver P + jQ to a grid bus V_s∠0. */
export interface VscPoint {
  /** Converter AC voltage [pu]. */
  vc: number
  /** Angle of V_c ahead of the grid voltage [°]. */
  deltaDeg: number
  /** Converter current [pu]. */
  i: number
  /** Apparent power [pu]. */
  s: number
  /** Checks of the solved point: P = V_s·V_c·sin δ / X and Q = (V_s·V_c·cos δ − V_s²)/X. */
  pCheck: number
  qCheck: number
  withinCurrent: boolean
  withinVoltage: boolean
}
export function vscPoint(vs: number, x: number, p: number, q: number, iMax: number, vcMax: number): VscPoint {
  const re = vs + (q * x) / vs
  const im = (p * x) / vs
  const vc = Math.hypot(re, im)
  const d = Math.atan2(im, re)
  const s = Math.hypot(p, q)
  return {
    vc,
    deltaDeg: d * R2D,
    i: s / vs,
    s,
    pCheck: (vs * vc * Math.sin(d)) / x,
    qCheck: (vs * vc * Math.cos(d) - vs * vs) / x,
    withinCurrent: s / vs <= iMax + 1e-12,
    withinVoltage: vc <= vcMax + 1e-12,
  }
}
/** The two capability limits in the P–Q plane (P, Q delivered to the grid): a current circle and a voltage circle. */
export function vscLimits(vs: number, x: number, iMax: number, vcMax: number) {
  return { current: { cp: 0, cq: 0, r: vs * iMax }, voltage: { cp: 0, cq: (-vs * vs) / x, r: (vs * vcMax) / x } }
}
/** Is (p, q) inside both limits? */
export const insideCapability = (vs: number, x: number, iMax: number, vcMax: number, p: number, q: number) => {
  const pt = vscPoint(vs, x, p, q, iMax, vcMax)
  return pt.withinCurrent && pt.withinVoltage
}
/** The P–Q boundary (both limits), sampled by angle: for each direction, the largest S inside both circles. */
export function capabilityBoundary(vs: number, x: number, iMax: number, vcMax: number, n = 181): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const lim = vscLimits(vs, x, iMax, vcMax)
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / (n - 1)
    const u = Math.cos(th)
    const w = Math.sin(th)
    // ray (u, w)·s from the origin; voltage circle |(s u, s w) − (0, cq)| = r → s² − 2 s w cq + cq² − r² = 0
    const cq = lim.voltage.cq
    const r = lim.voltage.r
    const disc = w * w * cq * cq - (cq * cq - r * r)
    const sV = disc >= 0 ? w * cq + Math.sqrt(disc) : 0
    const sMax = Math.max(0, Math.min(lim.current.r, sV))
    out.push([sMax * u, sMax * w])
  }
  return out
}

export interface VscLink {
  /** Converter rating [MVA] (the per-unit base). */
  sMva: number
  /** DC voltage held by station 2 [kV] (pole to pole). */
  vdc: number
  /** DC loop resistance [Ω]. */
  rdc: number
  /** Phase-reactor (plus transformer) reactance [pu]. */
  x: number
  /** Converter current limit [pu] and the largest AC voltage the DC voltage allows [pu]. */
  iMax: number
  vcMax: number
  /** Grid voltages [pu]. */
  vs1: number
  vs2: number
  /** Power ordered from station 1 into the DC link [pu] (negative: reversed). */
  pOrder: number
  /** Reactive power each station delivers to its grid [pu]. */
  q1: number
  q2: number
}
export const VSC0: VscLink = { sMva: 1000, vdc: 640, rdc: 8, x: 0.15, iMax: 1, vcMax: 1.15, vs1: 1, vs2: 1, pOrder: 0.8, q1: 0.2, q2: -0.1 }

export type VscOutcome =
  | { ok: true; idc: number; vdc1: number; loss: number; p1: number; p2: number; st1: VscPoint; st2: VscPoint; pDc1Mw: number; pDc2Mw: number }
  | (Fail & { requested?: { p1: number; q1: number; p2: number; q2: number; in1: boolean; in2: boolean } })

export function solveVsc(L: VscLink): VscOutcome {
  if (!fin(L.sMva, L.vdc, L.rdc, L.x, L.iMax, L.vcMax, L.vs1, L.vs2, L.pOrder, L.q1, L.q2)) return fail('Every input must be a finite number.')
  if (!(L.sMva > 0 && L.vdc > 0 && L.rdc >= 0 && L.x > 0 && L.iMax > 0 && L.vcMax > 0 && L.vs1 > 0 && L.vs2 > 0)) return fail('Ratings, voltages and the reactor must be positive.')
  const p1Mw = L.pOrder * L.sMva
  // station 2 holds V_dc2 = V_dc; station 1 sends P1 = V_dc1·I with V_dc1 = V_dc2 + R·I
  let idc: number
  if (L.rdc === 0) idc = p1Mw / L.vdc
  else {
    const disc = L.vdc * L.vdc + 4 * L.rdc * p1Mw
    if (disc < 0) return fail('This power cannot be drawn through the DC line at this voltage.')
    idc = (-L.vdc + Math.sqrt(disc)) / (2 * L.rdc)
  }
  const vdc1 = L.vdc + L.rdc * idc
  const loss = idc * idc * L.rdc
  const pDc2 = L.vdc * idc
  // AC side, lossless converters: station 1 takes P1 from its grid, station 2 delivers P_dc2 to its grid
  const p1 = -L.pOrder
  const p2 = pDc2 / L.sMva
  const st1 = vscPoint(L.vs1, L.x, p1, L.q1, L.iMax, L.vcMax)
  const st2 = vscPoint(L.vs2, L.x, p2, L.q2, L.iMax, L.vcMax)
  const issues: string[] = []
  const why = (st: VscPoint, k: number) => {
    if (!st.withinCurrent) issues.push(`Station ${k}: |S| = ${st.s.toFixed(3)} pu needs ${st.i.toFixed(3)} pu current, above the converter’s ${L.iMax.toFixed(2)} pu limit.`)
    if (!st.withinVoltage) issues.push(`Station ${k}: it would need a converter voltage of ${st.vc.toFixed(3)} pu, above the ${L.vcMax.toFixed(2)} pu the DC voltage allows.`)
  }
  why(st1, 1)
  why(st2, 2)
  if (issues.length) return { ok: false, issues, requested: { p1, q1: L.q1, p2, q2: L.q2, in1: st1.withinCurrent && st1.withinVoltage, in2: st2.withinCurrent && st2.withinVoltage } }
  return { ok: true, idc, vdc1, loss, p1, p2, st1, st2, pDc1Mw: p1Mw, pDc2Mw: pDc2 }
}

// ── series and shunt compensation (per unit) ───────────────────────────────────────────────────────────────────

/** Uncompensated (or series-compensated) power–angle curve: P = V_s·V_r·sin δ / X_eff, X_eff = X(1 − k). */
export const pSeries = (vs: number, vr: number, x: number, k: number, deltaDeg: number) => (vs * vr * Math.sin(deltaDeg * D2R)) / (x * (1 - k))
/** Ideal midpoint shunt compensation holding V_m = V: each half has X/2 and carries δ/2: P = (2V²/X)·sin(δ/2). */
export const pMidShunt = (v: number, x: number, deltaDeg: number) => ((2 * v * v) / x) * Math.sin((deltaDeg * D2R) / 2)
/** Reactive power the ideal midpoint compensator must supply at angle δ: Q = (4V²/X)(1 − cos(δ/2)). */
export const qMidShunt = (v: number, x: number, deltaDeg: number) => ((4 * v * v) / x) * (1 - Math.cos((deltaDeg * D2R) / 2))
export const pMaxSeries = (vs: number, vr: number, x: number, k: number) => (vs * vr) / (x * (1 - k))
export const pMaxMidShunt = (v: number, x: number) => (2 * v * v) / x

/** The angle needed to carry P on each curve, or null when P is beyond its maximum. */
export function angleFor(p: number, pmax: number, halfAngle: boolean): number | null {
  if (!(p >= 0) || p > pmax * (1 + 1e-12)) return null
  const s = Math.asin(Math.min(1, p / pmax)) * R2D
  return halfAngle ? 2 * s : s
}

/** Numerical maximum of a power–angle curve on 0°–180° (golden section): the independent check of P_max. */
export const numericPmax = (f: (deltaDeg: number) => number) => goldenMax(f, 0, 180, 1e-9)

// ── SVC: thyristor-controlled reactor ──────────────────────────────────────────────────────────────────────────

/**
 * TCR susceptance relative to full conduction, α measured from the voltage ZERO crossing, valid 90°–180°:
 * B(α)/B_max = (2π − 2α + sin 2α)/π, with B_max = 1/(ωL). α = 90° → full conduction (1); α = 180° → off (0).
 */
export function tcrB(alphaDeg: number): number | null {
  if (!Number.isFinite(alphaDeg) || alphaDeg < 90 || alphaDeg > 180) return null
  const a = alphaDeg * D2R
  return Math.max(0, (2 * Math.PI - 2 * a + Math.sin(2 * a)) / Math.PI)
}
/** The same by numerical Fourier analysis of the TCR current i = (√2V/ωL)(cos α − cos θ) for θ ∈ [α, 2π − α] (and its mirror). */
export function tcrBNumeric(alphaDeg: number, n = 2000): number | null {
  if (!Number.isFinite(alphaDeg) || alphaDeg < 90 || alphaDeg > 180) return null
  const a = alphaDeg * D2R
  // with V = 1/√2 (peak 1) and ωL = 1 the current is (cos α − cos θ); the fundamental is a₁·cos θ
  const half = simpson((t) => (Math.cos(a) - Math.cos(t)) * Math.cos(t), a, 2 * Math.PI - a, n)
  const a1 = (2 * half) / Math.PI // both half-cycles contribute equally
  // fundamental peak |a₁| over voltage peak 1 → B/B_max
  return Math.abs(a1)
}
/** The firing angle that gives a TCR susceptance fraction b ∈ [0, 1] (bisection; B(α) falls monotonically). */
export function tcrAlphaFor(b: number): number | null {
  if (!Number.isFinite(b) || b < -1e-12 || b > 1 + 1e-12) return null
  if (b <= 0) return 180
  if (b >= 1) return 90
  let lo = 90
  let hi = 180
  for (let it = 0; it < 100; it++) {
    const m = (lo + hi) / 2
    if ((tcrB(m) as number) > b) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

// ── the weak bus: a load fed through a Thevenin reactance, with or without voltage support ───────────────────────

export type Support = 'none' | 'svc' | 'statcom'
export const SUPPORT_LABEL: Record<Support, string> = { none: 'No support', svc: 'SVC', statcom: 'STATCOM' }

export interface WeakBus {
  /** Short-circuit ratio S_sc / P_rated: X_th = E²/S_sc = 1/SCR pu on the load's rating (E = 1 pu). */
  scr: number
  /** Load power factor (lagging, ≥ 0.7). */
  pf: number
  /** Compensator rating [pu of the load rating] (capacitive limit at 1 pu voltage). */
  rating: number
  /** Load active power [pu]. */
  p: number
}
export const E_TH = 1
export const V_REF = 1
/** TCR rating relative to the SVC's fixed capacitor (illustrative design choice): inductive range = (1.5 − 1)·rating. */
export const TCR_RATIO = 1.5
export const WEAK0: WeakBus = { scr: 3, pf: 0.95, rating: 0.5, p: 0.8 }

export const xTh = (scr: number) => (E_TH * E_TH) / scr
export const tanPhi = (pf: number) => Math.tan(Math.acos(pf))

/** The compensator's reactive output (positive = supplying) when it sits at its CAPACITIVE limit, at voltage V. */
export function qAtLimit(s: Support, rating: number, v: number): number {
  if (s === 'svc') return rating * v * v // fixed susceptance B_C = rating: Q = B·V²
  if (s === 'statcom') return rating * v // fixed current I_max = rating: Q = I·V
  return 0
}
const dqAtLimit = (s: Support, rating: number, v: number) => (s === 'svc' ? 2 * rating * v : s === 'statcom' ? rating : 0)

/**
 * P on the P–V curve at bus voltage V for a compensator law Q_c(V) (closed form). From P = E·V·sin δ / X and
 * Q − Q_c = (E·V·cos δ − V²)/X with Q = P·tan φ: X²(1+t²)P² + 2Xt·a·P + a² − E²V² = 0, a = V² − X·Q_c(V).
 * Returns null when the bus cannot be at V.
 */
export function pAtV(v: number, x: number, t: number, qc: number): number | null {
  const a = v * v - x * qc
  const disc = (1 + t * t) * E_TH * E_TH * v * v - a * a
  if (disc < 0) return null
  const p = (-t * a + Math.sqrt(disc)) / (x * (1 + t * t))
  return p >= -1e-12 ? Math.max(0, p) : null
}

/**
 * Closed form, quadratic in V²: the bus voltage for a net reactive load q (= P·tan φ − Q_c for a fixed Q_c) and a
 * fixed shunt susceptance b (b = 0: none). From E·V·cos δ = X·q + (1 − X·b)·V² and E·V·sin δ = P·X:
 * (1 − Xb)²·u² + (2Xq(1 − Xb) − E²)·u + X²(P² + q²) = 0 with u = V². Upper and lower roots, or null.
 */
export function vClosedForm(p: number, x: number, q: number, b = 0): { upper: number; lower: number } | null {
  const c = 1 - x * b
  if (c <= 0) return null
  const A = c * c
  const B = 2 * x * q * c - E_TH * E_TH
  const C = x * x * (p * p + q * q)
  const disc = B * B - 4 * A * C
  if (disc < -1e-12) return null
  const r = Math.sqrt(Math.max(0, disc))
  const u1 = (-B + r) / (2 * A)
  const u2 = (-B - r) / (2 * A)
  if (!(u1 > 0)) return null
  return { upper: Math.sqrt(u1), lower: Math.sqrt(Math.max(0, u2)) }
}

/** Closed-form nose of a bus with a fixed shunt B: P_max = E² / (2X(1 − XB)(t + √(1 + t²))). */
export function noseClosedForm(x: number, t: number, b: number): { p: number; v: number } | null {
  const c = 1 - x * b
  if (c <= 0) return null
  const pmax = (E_TH * E_TH) / (2 * x * c * (t + Math.sqrt(1 + t * t)))
  // at the nose the discriminant vanishes: V² = (E² − 2XQc)/(2c²)
  const v = Math.sqrt((E_TH * E_TH - 2 * x * pmax * t * c) / (2 * c * c))
  return { p: pmax, v }
}

export interface NewtonStep {
  k: number
  v: number
  deltaDeg: number
  mismatch: number
}

/**
 * Newton–Raphson on (V, δ) for the two-bus power flow with a voltage-dependent compensator Q_c(V) = law(V):
 * f₁ = E·V·sin δ / X − P, f₂ = (E·V·cos δ − V²)/X − (P·t − Q_c(V)). Starts from V = 1, δ = 0 (the upper solution).
 */
export function newtonBus(
  p: number,
  x: number,
  t: number,
  law: (v: number) => number,
  dlaw: (v: number) => number,
  v0 = 1,
  d0 = 0,
): { ok: true; v: number; deltaDeg: number; steps: NewtonStep[] } | Fail {
  let v = v0
  let d = d0
  const steps: NewtonStep[] = []
  for (let k = 0; k < 60; k++) {
    const f1 = (E_TH * v * Math.sin(d)) / x - p
    const f2 = (E_TH * v * Math.cos(d) - v * v) / x - (p * t - law(v))
    const mis = Math.max(Math.abs(f1), Math.abs(f2))
    steps.push({ k, v, deltaDeg: d * R2D, mismatch: mis })
    if (mis < 1e-13) return { ok: true, v, deltaDeg: d * R2D, steps }
    const j11 = (E_TH * Math.sin(d)) / x
    const j12 = (E_TH * v * Math.cos(d)) / x
    const j21 = (E_TH * Math.cos(d) - 2 * v) / x + dlaw(v)
    const j22 = (-E_TH * v * Math.sin(d)) / x
    const det = j11 * j22 - j12 * j21
    if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return fail('The Newton iteration met a singular Jacobian (at or beyond the nose of the curve).')
    const dv = (f1 * j22 - f2 * j12) / det
    const dd = (j11 * f2 - j21 * f1) / det
    // damp large steps to stay on the upper branch
    const lam = Math.min(1, 0.3 / Math.max(Math.abs(dv), 1e-30))
    v -= lam * dv
    d -= lam * dd
    if (!(v > 0.05) || !Number.isFinite(v)) return fail('The Newton iteration did not converge: no power-flow solution (beyond the collapse point).')
  }
  return fail('The Newton iteration did not converge: no power-flow solution (beyond the collapse point).')
}

/** Largest root of the bus equation on a voltage interval by bisection (the STATCOM-at-limit check). */
export function bisectUpper(p: number, x: number, t: number, law: (v: number) => number, vLo: number, vHi: number): number | null {
  // g(V) = P(V) − p along the curve, on the upper branch P falls as V rises
  const g = (v: number) => {
    const pv = pAtV(v, x, t, law(v))
    return pv === null ? -p : pv - p
  }
  let lo = vLo
  let hi = vHi
  if (g(lo) < 0 || g(hi) > 0) return null
  for (let it = 0; it < 200; it++) {
    const m = (lo + hi) / 2
    if (g(m) >= 0) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

export interface BusPoint {
  ok: true
  v: number
  deltaDeg: number
  /** Compensator output [pu] (positive = supplying vars). */
  qc: number
  state: 'none' | 'regulating' | 'at-limit'
  /** Newton steps of the solve. */
  steps: NewtonStep[]
  /** Second method's voltage (closed form, or bisection for the STATCOM at its limit). */
  vCheck: number
  checkMethod: string
  /** Largest power-flow mismatch [pu] of the solved point and of the second method's voltage. */
  residual: number
  /** Slope dP/dV of the P–V curve at the solution (→ 0 at the nose, where V is ill-conditioned). */
  dPdV: number
  /** The agreement the two methods must reach [pu], from the conditioning: min(10⁻⁶, 10⁻⁹ + 10⁻¹²/|dP/dV|). */
  tolV: number
}
export type BusOutcome = BusPoint | Fail

/**
 * How closely two exact solutions of the bus equations can agree. Both are stopped at a power mismatch of about
 * 10⁻¹³ pu; a mismatch r moves V by about r/|dP/dV|, which grows without bound at the nose (dP/dV = 0, where the
 * error goes as √r instead). Hence min(10⁻⁶, 10⁻⁹ + 10⁻¹²/|dP/dV|) pu.
 */
export function busTolerance(dPdV: number): number {
  return Math.min(1e-6, 1e-9 + 1e-12 / Math.max(Math.abs(dPdV), 1e-15))
}
/** Power-flow mismatch of a voltage V under a compensator law: |P(V) − P| from the closed-form P(V). */
function pMismatch(p: number, v: number, x: number, t: number, law: (v: number) => number): number {
  const pv = pAtV(v, x, t, law(v))
  return pv === null ? Infinity : Math.abs(pv - p)
}
function slopeAt(v: number, x: number, t: number, law: (v: number) => number): number {
  const h = 1e-6
  const a = pAtV(v - h, x, t, law(v - h))
  const b = pAtV(v + h, x, t, law(v + h))
  return a === null || b === null ? 0 : (b - a) / (2 * h)
}

export interface PvCurve {
  ok: true
  support: Support
  /** Upper branch then lower branch, as [P, V] points (V from high to low). */
  points: Array<[number, number]>
  /** Where a regulating compensator reaches its limit (null for none). */
  pSwitch: number | null
  /** The collapse (nose) point: the largest P the bus can take. */
  nose: { p: number; v: number }
}

/** Regulated (V = V_ref) reactive power the compensator must supply at load P. */
export function qcRequired(p: number, x: number, t: number): number | null {
  const s = (p * x) / (E_TH * V_REF)
  if (s > 1) return null
  const qNet = (E_TH * V_REF * Math.sqrt(1 - s * s) - V_REF * V_REF) / x
  return p * t - qNet
}

function checkWeak(w: WeakBus): string[] {
  const out: string[] = []
  if (!fin(w.scr, w.pf, w.rating, w.p)) return ['Every input must be a finite number.']
  if (!(w.scr >= 1 && w.scr <= 20)) out.push('The short-circuit ratio must be between 1 and 20.')
  if (!(w.pf >= 0.7 && w.pf <= 1)) out.push('The load power factor must be between 0.7 and 1 (lagging).')
  if (!(w.rating >= 0 && w.rating <= 1.5)) out.push('The compensator rating must be between 0 and 1.5 pu.')
  if (!(w.p >= 0)) out.push('The load cannot be negative.')
  if (out.length === 0 && xTh(w.scr) * w.rating >= 1) out.push('The SVC’s capacitor would resonate with the system reactance (X·B ≥ 1).')
  return out
}

/** The P–V curve of the bus with a given support (V-parametrised, closed form at every point), and its nose. */
export function pvCurve(w: WeakBus, s: Support, n = 160): PvCurve | Fail {
  const bad = checkWeak(w)
  if (bad.length) return fail(...bad)
  const x = xTh(w.scr)
  const t = tanPhi(w.pf)
  const lawLim = (v: number) => qAtLimit(s, w.rating, v)
  const pv = (v: number) => pAtV(v, x, t, lawLim(v))
  const vMin = 0.05
  const points: Array<[number, number]> = []
  if (s === 'none') {
    const nm = goldenMax((v) => pv(v) ?? -1, vMin, E_TH, 1e-12)
    // from the no-load voltage (V = E at P = 0) downwards
    for (let k = 0; k <= n; k++) {
      const v = E_TH - ((E_TH - vMin) * k) / n
      const p = pv(v)
      if (p !== null) points.push([p, v])
    }
    return { ok: true, support: s, points, pSwitch: null, nose: { p: nm.f, v: nm.x } }
  }
  // regulating at V_ref until the required Q reaches the capacitive limit, or the angle reaches 90°
  const qmax = lawLim(V_REF)
  const pEnd = (E_TH * V_REF) / x
  const reachesLimit = (qcRequired(pEnd * (1 - 1e-12), x, t) as number) > qmax
  let pSwitch = pEnd
  if (reachesLimit) {
    let lo = 0
    let hi = pEnd
    for (let it = 0; it < 200; it++) {
      const m = (lo + hi) / 2
      if ((qcRequired(m, x, t) as number) <= qmax) lo = m
      else hi = m
    }
    pSwitch = (lo + hi) / 2
  }
  for (let k = 0; k <= 30; k++) points.push([(pSwitch * k) / 30, V_REF])
  if (!reachesLimit) return { ok: true, support: s, points, pSwitch, nose: { p: pSwitch, v: V_REF } }
  // beyond the switch: the compensator is a fixed B (SVC) or a fixed current (STATCOM); its curve from V_ref down
  const nm = goldenMax((v) => pv(v) ?? -1, vMin, V_REF, 1e-12)
  // if the limit curve only falls below V_ref (V_ref is already past its nose), collapse happens at the switch point
  const nose = nm.f > pSwitch + 1e-12 && nm.x < V_REF - 1e-9 ? { p: nm.f, v: nm.x } : { p: pSwitch, v: V_REF }
  for (let k = 1; k <= n; k++) {
    const v = V_REF - ((V_REF - vMin) * k) / n
    const p = pv(v)
    if (p !== null) points.push([p, v])
  }
  return { ok: true, support: s, points, pSwitch, nose }
}

/** The operating point of the bus at load P: Newton on the power flow, checked by a second method. */
export function solveBus(w: WeakBus, s: Support): BusOutcome {
  const bad = checkWeak(w)
  if (bad.length) return fail(...bad)
  const x = xTh(w.scr)
  const t = tanPhi(w.pf)
  const c = pvCurve(w, s)
  if (!c.ok) return c
  if (w.p > c.nose.p + 1e-12)
    return fail(`A load of ${w.p.toFixed(2)} pu is beyond the collapse point (${c.nose.p.toFixed(3)} pu at V = ${c.nose.v.toFixed(3)} pu): the power flow has no solution — the voltage collapses.`)
  if (s !== 'none' && c.pSwitch !== null && w.p <= c.pSwitch + 1e-12) {
    // Regulating: the controller holds V = V_ref, so V is known; δ follows from P = E·V·sin δ / X and the Q the
    // compensator must supply from the Q equation. (A Newton solve with that Q fixed could land on the OTHER root of
    // the fixed-Q quadratic — it is not used here.) Second method: the root of the fixed-Q quadratic nearest V_ref.
    const qc = qcRequired(w.p, x, t) as number
    const v = V_REF
    const d = Math.asin(Math.min(1, (w.p * x) / (E_TH * v)))
    const f1 = (E_TH * v * Math.sin(d)) / x - w.p
    const f2 = (E_TH * v * Math.cos(d) - v * v) / x - (w.p * t - qc)
    const steps: NewtonStep[] = [{ k: 0, v, deltaDeg: d * R2D, mismatch: Math.max(Math.abs(f1), Math.abs(f2)) }]
    const cf = vClosedForm(w.p, x, w.p * t - qc)
    if (!cf) return fail('The second method found no solution at this load.')
    const vCheck = Math.abs(cf.upper - V_REF) <= Math.abs(cf.lower - V_REF) ? cf.upper : cf.lower
    const law = () => qc
    const dPdV = slopeAt(v, x, t, law)
    return {
      ok: true,
      v,
      deltaDeg: d * R2D,
      qc,
      state: 'regulating',
      steps,
      vCheck,
      checkMethod: 'closed form (quadratic in V²) with that Q fixed — its root nearest V_ref',
      residual: Math.max(steps[0].mismatch, pMismatch(w.p, vCheck, x, t, law)),
      dPdV,
      tolV: busTolerance(dPdV),
    }
  }
  const law = (v: number) => qAtLimit(s, w.rating, v)
  const dlaw = (v: number) => dqAtLimit(s, w.rating, v)
  // Newton from a flat start. The answer must lie on the stable branch (V ≥ the nose voltage) and, for a compensator at
  // its limit, at or below V_ref (above it the controller would back off). Otherwise start again inside that range.
  const vTop = s === 'none' ? Infinity : V_REF + 1e-9
  const fits = (rr: ReturnType<typeof newtonBus>) => rr.ok && rr.v >= c.nose.v - 1e-4 && rr.v <= vTop
  let r = newtonBus(w.p, x, t, law, dlaw)
  for (const v0 of [s === 'none' ? 1.3 : (c.nose.v + V_REF) / 2, s === 'none' ? E_TH : V_REF]) {
    if (fits(r)) break
    const rr = newtonBus(w.p, x, t, law, dlaw, v0, Math.asin(Math.min(1, (w.p * x) / (E_TH * v0))))
    if (fits(rr)) r = rr
  }
  if (!r.ok) return r
  if (!fits(r)) return fail('The solve did not find the stable operating point; at this load the bus is at or beyond its collapse point.')
  let vCheck: number | null
  let method: string
  if (s === 'statcom') {
    vCheck = bisectUpper(w.p, x, t, law, c.nose.v, V_REF)
    method = 'bisection on the closed-form P(V) curve'
  } else {
    const cf = vClosedForm(w.p, x, w.p * t, s === 'svc' ? w.rating : 0)
    vCheck = cf ? cf.upper : null
    method = 'closed form (quadratic in V²)'
  }
  if (vCheck === null) return fail('The second method found no solution at this load (at the collapse point).')
  const last = r.steps[r.steps.length - 1].mismatch
  const dPdV = slopeAt(r.v, x, t, law)
  return {
    ok: true,
    v: r.v,
    deltaDeg: r.deltaDeg,
    qc: law(r.v),
    state: s === 'none' ? 'none' : 'at-limit',
    steps: r.steps,
    vCheck,
    checkMethod: method,
    residual: Math.max(last, pMismatch(w.p, vCheck, x, t, law)),
    dPdV,
    tolV: busTolerance(dPdV),
  }
}

// ── AC versus DC (illustrative comparison using Module 8's default 400 kV line) ────────────────────────────────────

export interface AcDcCompare {
  /** AC line charging [Mvar] = V²·b·ℓ (the line's total susceptance at rated voltage). */
  chargingMvar: number
  /** Phase constant β = √(x·b) [rad/km] and surge impedance Z_c = √(x/b) [Ω] of the lossless line. */
  beta: number
  zc: number
  /** Quarter-wavelength length π/(2β) [km]: the exact long-line model below holds; the slider stays below it. */
  quarterKm: number
  /** AC power at δ = 30° across the line, exact lossless long line: V²·sin 30° / (Z_c·sin βℓ) [MW]. */
  pAc30: number
  /** The angle-limited maximum V² / (Z_c·sin βℓ) [MW] (δ = 90°). */
  pAcMax: number
  /** The same with the lumped reactance x·ℓ (short-line approximation), for comparison [MW]. */
  pAcMaxLumped: number
  /** DC bipole: power sent and I²R loss over the length [MW]. */
  pDc: number
  lossDc: number
}
/**
 * AC versus DC over a length ℓ. The AC line is the exact lossless long line: its ABCD constant B = jZ_c·sin βℓ, so
 * P = V_s·V_r·sin δ / (Z_c·sin βℓ). Valid for any ℓ, but used here below a quarter wavelength.
 */
export function acDc(lengthKm: number, ac: { kv: number; xOhmKm: number; bUsKm: number }, dc: { kvPole: number; ka: number; rOhmKmPole: number }): AcDcCompare {
  const b = ac.bUsKm * 1e-6
  const beta = Math.sqrt(ac.xOhmKm * b)
  const zc = Math.sqrt(ac.xOhmKm / b)
  const bAbs = zc * Math.sin(beta * lengthKm)
  const pDc = 2 * dc.kvPole * dc.ka
  return {
    chargingMvar: ac.kv * ac.kv * b * lengthKm,
    beta,
    zc,
    quarterKm: Math.PI / (2 * beta),
    pAc30: (ac.kv * ac.kv * 0.5) / bAbs,
    pAcMax: (ac.kv * ac.kv) / bAbs,
    pAcMaxLumped: (ac.kv * ac.kv) / (ac.xOhmKm * lengthKm),
    pDc,
    lossDc: 2 * dc.ka * dc.ka * dc.rOhmKmPole * lengthKm,
  }
}

/** Illustrative cost model (relative units): AC = 1 + ℓ/100, DC = k_T + k_L·ℓ/100. Break-even where they are equal. */
export function breakEven(kT: number, kL: number): number | null {
  if (!(kT > 1) || !(kL > 0 && kL < 1)) return null
  return ((kT - 1) / (1 - kL)) * 100
}

// ── words from numbers ─────────────────────────────────────────────────────────────────────────────────────────

/** "×2.00 (100 % more)" style wording of a ratio, computed. */
export function ratioWords(r: number): string {
  if (!Number.isFinite(r)) return '—'
  if (Math.abs(r - 1) < 0.005) return 'the same'
  const pc = Math.abs(r - 1) * 100
  return r > 1 ? `${pc.toFixed(pc < 10 ? 1 : 0)} % more` : `${pc.toFixed(pc < 10 ? 1 : 0)} % less`
}
/** A direction word for a change from a to b, with a dead band. */
export const direction = (a: number, b: number, tol = 1e-9): 'up' | 'down' | 'same' => (b - a > tol * Math.max(1, Math.abs(a)) ? 'up' : a - b > tol * Math.max(1, Math.abs(a)) ? 'down' : 'same')
