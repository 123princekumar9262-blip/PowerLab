import { abs, add, arg, C, deg, mul, polar, scale, sub, sum, ZERO, type Complex } from '../../engine/complex.ts'

/*
 * A single-phase AC distributor fed at end A, with loads tapped along it and the voltage at the far end B known.
 * A load's power factor is an angle between its current and SOME voltage; the two textbook conventions differ in
 * which voltage:
 *  (a) every power factor referred to the receiving-end voltage V_B (all load currents drawn from one reference);
 *  (b) every power factor referred to the load's OWN voltage (each current lags its own node voltage).
 * Both are solved exactly with complex arithmetic, working back from B (V_B is the reference phasor, 0°). The check is
 * superposition: V_A = V_B + Σ I_k · z·x_k (each load current flows through the impedance from A to its own point).
 */

export interface AcLoad {
  id: string
  /** Distance from A [m]. */
  x: number
  /** Current magnitude [A]. */
  I: number
  /** Power factor (0 < pf ≤ 1). */
  pf: number
  /** Lagging (inductive) when true. */
  lag: boolean
}

export interface AcDistributor {
  /** Length A → B [m]; B is the far (receiving) end. */
  L: number
  /** Loop impedance (go + return) per km [Ω/km]. */
  R: number
  X: number
  /** Voltage magnitude at the far end B [V] — the reference phasor. */
  VB: number
  loads: AcLoad[]
}

export type PfRef = 'receiving' | 'own'

export interface AcOk {
  ok: true
  ref: PfRef
  /** Node positions (sorted, from A at 0 to B at L) and their voltages. */
  xs: number[]
  V: Complex[]
  /** Load currents, in the order of `d.loads`. */
  Iload: Complex[]
  /** Current in each section k (from xs[k] to xs[k+1]), flowing towards B. */
  Isec: Complex[]
  VA: Complex
  /** |V_A| − |V_B| [V]. */
  drop: number
}
export interface AcErr {
  ok: false
  message: string
}
export type AcResult = AcOk | AcErr

const phi = (l: AcLoad) => (l.lag ? -1 : 1) * Math.acos(l.pf)

export function validateAc(d: AcDistributor): string | null {
  if (!(d.L > 0)) return 'The distributor length must be positive.'
  if (!(d.R >= 0) || !(d.X >= 0) || d.R + d.X === 0) return 'The loop impedance must be positive (R ≥ 0, X ≥ 0, not both zero).'
  if (!(d.VB > 0)) return 'The far-end voltage V_B must be positive.'
  for (const l of d.loads) {
    if (!(l.I >= 0)) return `Load ${l.id}: the current cannot be negative.`
    if (!(l.pf > 0 && l.pf <= 1)) return `Load ${l.id}: a power factor must lie between 0 and 1 (got ${l.pf}).`
    if (!(l.x >= 0) || l.x > d.L + 1e-9) return `Load ${l.id} at ${l.x} m lies outside the ${d.L} m distributor.`
  }
  return null
}

/** Solve by working back from B: section currents are sums of the load currents beyond; V rises by I·Z per section. */
export function solveAc(d: AcDistributor, ref: PfRef): AcResult {
  const bad = validateAc(d)
  if (bad) return { ok: false, message: bad }
  const z = C(d.R / 1000, d.X / 1000) // Ω per metre of loop
  const xs = [...new Set([0, d.L, ...d.loads.map((l) => l.x)])].sort((a, b) => a - b)
  const n = xs.length
  const V: Complex[] = new Array(n).fill(ZERO)
  const Iload: Complex[] = d.loads.map(() => ZERO)
  const Isec: Complex[] = new Array(n - 1).fill(ZERO)
  V[n - 1] = C(d.VB, 0)
  let carried = ZERO // current arriving at node k from the A side = everything drawn at k and beyond
  for (let k = n - 1; k >= 0; k--) {
    // loads at node k: angle from V_B (convention a) or from V_k (convention b)
    const refAngle = ref === 'receiving' ? 0 : arg(V[k])
    d.loads.forEach((l, j) => {
      if (l.x !== xs[k]) return
      Iload[j] = polar(l.I, refAngle + phi(l))
      carried = add(carried, Iload[j])
    })
    if (k > 0) {
      Isec[k - 1] = carried
      V[k - 1] = add(V[k], mul(carried, scale(z, xs[k] - xs[k - 1])))
    }
  }
  const VA = V[0]
  return { ok: true, ref, xs, V, Iload, Isec, VA, drop: abs(VA) - d.VB }
}

/** The check: V_A by superposition, V_B + Σ I_k · z·x_k, from the solved load currents. */
export function superpositionVA(d: AcDistributor, r: AcOk): Complex {
  const z = C(d.R / 1000, d.X / 1000)
  return add(C(d.VB, 0), sum(d.loads.map((l, j) => mul(r.Iload[j], scale(z, l.x)))))
}

/** Each load current's angle from its own node voltage [deg] (= ∓acos pf in convention b). */
export function angleToOwnVoltage(d: AcDistributor, r: AcOk): number[] {
  return d.loads.map((l, j) => {
    const k = r.xs.indexOf(l.x)
    let a = deg(arg(r.Iload[j]) - arg(r.V[k]))
    while (a > 180) a -= 360
    while (a <= -180) a += 360
    return a
  })
}

/** Complex power balance: S_A = Σ V_k·I_k* (loads) + Σ |I_sec|²·Z_sec (losses). Returns both sides. */
export function powerBalance(d: AcDistributor, r: AcOk): { sending: Complex; loads: Complex; losses: Complex } {
  const z = C(d.R / 1000, d.X / 1000)
  const conjc = (c: Complex) => C(c.re, -c.im)
  const Itot = r.Isec.length ? r.Isec[0] : ZERO
  // current fed at A = everything drawn beyond node 0 + loads at node 0
  const I0 = add(Itot, sum(d.loads.filter((l) => l.x === 0).map((l) => r.Iload[d.loads.indexOf(l)])))
  const sending = mul(r.VA, conjc(I0))
  const loads = sum(d.loads.map((l, j) => mul(r.V[r.xs.indexOf(l.x)], conjc(r.Iload[j]))))
  const losses = sum(r.Isec.map((I, k) => scale(z, abs(I) ** 2 * (r.xs[k + 1] - r.xs[k]))))
  return { sending, loads, losses }
}

/** The difference between the two conventions' sending voltages. */
export function conventionGap(d: AcDistributor): { a: AcOk; b: AcOk; dMag: number; dAngDeg: number } | null {
  const a = solveAc(d, 'receiving')
  const b = solveAc(d, 'own')
  if (!a.ok || !b.ok) return null
  return { a, b, dMag: abs(b.VA) - abs(a.VA), dAngDeg: deg(arg(b.VA) - arg(a.VA)) }
}

export const vDiff = (p: Complex, q: Complex) => abs(sub(p, q))

/** The default AC case (illustrative values): a 1 km single-phase distributor, two loads, 230 V at the far end. */
export function defaultAc(): AcDistributor {
  return {
    L: 1000,
    R: 0.2,
    X: 0.3,
    VB: 230,
    loads: [
      { id: 'C', x: 500, I: 100, pf: 0.707, lag: true },
      { id: 'D', x: 1000, I: 80, pf: 0.8, lag: true },
    ],
  }
}
