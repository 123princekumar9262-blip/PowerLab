import { batteryCurrent, batteryPower, cruisePlateau, regenMax, roadLoad, tractionMax, type ResolvedEv } from './vehicle.ts'

/**
 * EV THEORY — independent of the time-stepping simulation.
 *
 * 1. CYCLE (exact for a perfectly followed cycle): the reference speed is piecewise linear, so the wheel
 *    power P(t) = (m·a + road load(v))·v is a cubic on each segment. Every kink — motoring/braking, the regen
 *    limit, the torque/power corner — is located by bisection, and each smooth piece is integrated by
 *    16-point Gauss–Legendre quadrature (exact to rounding): distance, battery energy, regen, brake energy.
 * 2. ACCELERATION: t(v) = ∫ m·dv/(Fmax(v) − road load(v)), split at the base speed, by Gauss–Legendre.
 *    Top speed: Fmax(v) = road load(v), by bisection.
 * 3. TEXTBOOK: ideal regeneration without limits and without battery resistance; constant-power
 *    acceleration t ≈ m·v²/(2·Pmax).
 */

// 16-point Gauss–Legendre nodes and weights on [−1, 1]
const GL_X = [-0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.755404408355003, -0.6178762444026438, -0.4580167776572274, -0.2816035507792589, -0.0950125098376374, 0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499]
const GL_W = [0.0271524594117541, 0.0622535239386479, 0.0951585116824928, 0.1246289712555339, 0.1495959888165767, 0.1691565193950025, 0.1826034150449236, 0.1894506104550685, 0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541]

/** ∫ f over [a, b] by Gauss–Legendre on `pieces` equal parts (f must be smooth on [a, b]). */
export function gauss(f: (x: number) => number[], a: number, b: number, dim: number, pieces = 4): number[] {
  const out = new Array(dim).fill(0)
  const w = (b - a) / pieces
  for (let q = 0; q < pieces; q++) {
    const c = a + (q + 0.5) * w
    for (let i = 0; i < 16; i++) {
      const y = f(c + 0.5 * w * GL_X[i])
      for (let d = 0; d < dim; d++) out[d] += 0.5 * w * GL_W[i] * y[d]
    }
  }
  return out
}

/** Roots of g on [a, b] (sign changes on a fine scan, refined by bisection). */
function roots(g: (t: number) => number, a: number, b: number, scan = 400): number[] {
  const out: number[] = []
  let ta = a
  let ga = g(a)
  for (let i = 1; i <= scan; i++) {
    const tb = a + ((b - a) * i) / scan
    const gb = g(tb)
    if ((ga < 0 && gb >= 0) || (ga >= 0 && gb < 0)) {
      let lo = ta
      let hi = tb
      for (let it = 0; it < 100 && hi - lo > 1e-14 * (1 + Math.abs(hi)); it++) {
        const mid = 0.5 * (lo + hi)
        const gm = g(mid)
        if ((ga < 0 && gm >= 0) || (ga >= 0 && gm < 0)) hi = mid
        else lo = mid
      }
      out.push(0.5 * (lo + hi))
    }
    ta = tb
    ga = gb
  }
  return out
}

export interface CycleTheory {
  dist: number
  eBatt: number
  eChem: number
  eRegen: number
  eBrake: number
  consumption: number
  /** The cycle asks for more force than the motor can give somewhere (the car cannot follow it). */
  limited: boolean
  pCruise: number | null
  /** Textbook: ideal regeneration, no regen limit, no battery resistance [J]. */
  eIdeal: number
  ePos: number
  eNeg: number
}

export function cycleTheory(p: ResolvedEv): CycleTheory {
  const pr = p.profile
  let acc = [0, 0, 0, 0, 0, 0, 0]
  let limited = false
  for (let s = 0; s + 1 < pr.length; s++) {
    const [t0, v0] = pr[s]
    const [t1, v1] = pr[s + 1]
    const a = (v1 - v0) / (t1 - t0)
    const v = (t: number) => v0 + a * (t - t0)
    const fReq = (t: number) => p.mass * a + roadLoad(p, v(t))
    const integrand = (t: number) => {
      const vt = v(t)
      const f = fReq(t)
      let fMotor = f
      let fBrake = 0
      if (f >= 0) {
        if (f > tractionMax(p, vt) * (1 + 1e-9) && vt > 0) limited = true
      } else if (vt <= 1e-9) {
        fMotor = 0
        fBrake = -f
      } else {
        fMotor = Math.max(f, -regenMax(p, vt))
        fBrake = fMotor - f
      }
      const pw = fMotor * vt
      const pb = batteryPower(p, pw)
      const i = batteryCurrent(p, pb)
      return [vt, (p.voc - p.rb * i) * i, p.voc * i, pw < 0 ? -pw * p.eta : 0, fBrake * vt, f * vt > 0 ? f * vt : 0, f * vt < 0 ? -f * vt : 0]
    }
    // kinks: force sign, the regen limit, the regen torque/power corner, standstill
    const kinks = [
      ...roots(fReq, t0, t1),
      ...roots((t) => fReq(t) + regenMax(p, Math.max(v(t), 1e-9)), t0, t1),
      ...roots((t) => v(t) - p.pregen / p.fTmax, t0, t1),
      ...roots((t) => v(t) - p.vBase, t0, t1),
    ].sort((x, y) => x - y)
    const cuts = [t0, ...kinks.filter((k) => k > t0 && k < t1), t1]
    for (let c = 0; c + 1 < cuts.length; c++) {
      const r = gauss(integrand, cuts[c], cuts[c + 1], 7)
      acc = acc.map((x, d) => x + r[d])
    }
  }
  const [dist, eBatt, eChem, eRegen, eBrake, ePos, eNeg] = acc
  const T = pr[pr.length - 1][0]
  const plateau = cruisePlateau(p)
  return {
    dist,
    eBatt,
    eChem,
    eRegen,
    eBrake,
    consumption: dist > 1 ? eChem / 3600 / (dist / 1000) : NaN,
    limited,
    pCruise: plateau ? batteryPower(p, roadLoad(p, plateau[2]) * plateau[2]) : null,
    eIdeal: ePos / p.eta - eNeg * p.eta + p.aux * T,
    ePos,
    eNeg,
  }
}

/** Net accelerating force at full throttle. */
const netForce = (p: ResolvedEv, v: number) => tractionMax(p, v) - roadLoad(p, Math.max(v, 1e-9))

/** Time to reach speed v [m/s] from rest at full throttle (null if unreachable). */
export function timeToSpeed(p: ResolvedEv, v: number): number | null {
  if (netForce(p, v) <= 0) return null
  const cuts = [0, ...(p.vBase > 0 && p.vBase < v ? [p.vBase] : []), v]
  let t = 0
  for (let c = 0; c + 1 < cuts.length; c++) t += gauss((x) => [p.mass / netForce(p, x)], cuts[c], cuts[c + 1], 1, 8)[0]
  return t
}

export function topSpeed(p: ResolvedEv): number {
  let lo = 0.1
  let hi = 200
  if (netForce(p, lo) <= 0) return 0
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi)
    if (netForce(p, mid) > 0) lo = mid
    else hi = mid
  }
  return lo
}

export interface AccelTheory {
  t100: number | null
  /** Speed at the end of the test window [km/h]. */
  vEnd: number
  vTop: number
  /** Textbook: constant power from rest, no drag, no torque limit. */
  t100Textbook: number
}

export function accelTheory(p: ResolvedEv): AccelTheory {
  const v100 = 100 / 3.6
  const vTop = topSpeed(p)
  const T = p.duration
  // invert t(v) = T by bisection below the top speed
  let lo = 0
  let hi = vTop * (1 - 1e-12)
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi)
    const tm = timeToSpeed(p, mid)
    if (tm !== null && tm < T) lo = mid
    else hi = mid
  }
  return { t100: v100 < vTop ? timeToSpeed(p, v100) : null, vEnd: lo * 3.6, vTop: vTop * 3.6, t100Textbook: (p.mass * v100 * v100) / (2 * p.pmax) }
}
