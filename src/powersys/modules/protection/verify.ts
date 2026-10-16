import { abs, add, C, div, mul, polarDeg, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'
import { toPhase, toSeq, type Trio } from '../faults/sequence.ts'
import { sourceDuty, trvAt, trvIssues, trvMetrics, trvRk4 } from './breaker.ts'
import { biasThreshold, COMP_MATRIX, CT_HV, differential, I_RATED_HV } from './differential.ts'
import { apparentOhm, K0, L1_KM, L3_KM, LOOP_OF, loopVI, routeFault, Z1L, Z1L3, ZB, zoneIssues, type Loop } from './distance.ts'
import {
  earthFault,
  EARTH0,
  genSequence,
  IB_GEN_A,
  neutralOhm,
  petersenClassic,
  petersenExact,
  statorCoverage,
  statorIssues,
  VPH_GEN,
  W,
  X0G_OHM,
  ZB_GEN,
  type EarthParams,
  type StatorParams,
} from './earthing.ts'
import { phaseImpedance } from '../faults/phase.ts'
import { solveComplex } from '../../engine/linalg.ts'
import type { DiffState, DistState, StatorState, TrvState } from './state.ts'

/*
 * The Verify checks as pure functions: a hand calculation and an independent second method, with the tolerance that
 * the approximation between them justifies. Tests run every check over the whole allowed input range.
 */

// ── 1 · apparent impedance: V/I against KVL along the line data ──────────────────────────────────────────────────

export interface ZappCheck {
  loop: Loop
  vLoop: Complex
  iLoop: Complex
  /** V/I [Ω]. */
  zDirect: Complex
  /** Σ (segment Z₁ × its loop current) + V_F,loop, divided by I_relay,loop [Ω]. */
  zKvl: Complex
  /** The line-impedance part and the fault-point part [Ω]. */
  zLine: Complex
  zFault: Complex
  ok: boolean
}

export const ZAPP_TOL = 1e-9

export function checkZapp(s: DistState): ZappCheck | null {
  if (zoneIssues(s.zones).length) return null
  const f = routeFault(s.spec, s.opts)
  const k0 = s.zones.k0On ? K0 : ZERO
  const loop = LOOP_OF[s.spec.type]
  const v = f.relays.RA
  const { v: vL, i: iL } = loopVI(loop, v.vabc, v.iabc, k0)
  if (!apparentOhm(loop, v, k0)) return null
  // the line from A to the fault: L1 (all, or up to the fault) carries R_A's current; the part of L3 carries L3's own current
  const km = Math.min(Math.max(s.spec.km, 0), L1_KM + L3_KM)
  // the line's own voltage drop always uses the line's true k₀ (Z₀ − Z₁ for the residual current), whatever the relay's setting
  const iTrue = loopVI(loop, v.vabc, v.iabc, K0).i
  let drop = mul(scale(Z1L, Math.min(km, L1_KM) / L1_KM / ZB), iTrue)
  if (km > L1_KM) {
    const seg = f.result.branches.find((b) => b.id === 'L3a') ?? f.result.branches.find((b) => b.id === 'L3')!
    const iSeg = toPhase(seg.i012From)
    // L3 has the same construction, so the same k₀
    const { i } = loopVI(loop, v.vabc, iSeg, K0)
    drop = add(drop, mul(scale(Z1L3, (km - L1_KM) / L3_KM / ZB), i))
  }
  const vf = f.result.point.vabc
  const vF = loop.endsWith('E') ? vf[0] : sub(vf[1], vf[2])
  const zLine = scale(div(drop, iL), ZB)
  const zFault = scale(div(vF, iL), ZB)
  const zKvl = add(zLine, zFault)
  const zDirect = scale(div(vL, iL), ZB)
  return { loop, vLoop: vL, iLoop: iL, zDirect, zKvl, zLine, zFault, ok: abs(sub(zDirect, zKvl)) <= ZAPP_TOL * Math.max(1, abs(zDirect)) }
}

// ── 2 · k₀ ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function checkK0(m = 0.7) {
  const f = routeFault({ km: m * L1_KM, type: 'slg', rfOhm: 0 })
  const zc = apparentOhm('aE', f.relays.RA, K0)!
  const want = scale(Z1L, m)
  return { zc, want, ok: abs(sub(zc, want)) <= 1e-9 * abs(want) }
}

// ── 3 · differential ────────────────────────────────────────────────────────────────────────────────────────────

export function checkDiff(st: DiffState) {
  const d = differential(st.loc, st.type, st.s)
  // second method: the relay's phase-domain "delta-CT" matrix on the matched star-side currents
  const matched = d.hvSec.map((x) => scale(x, CT_HV / I_RATED_HV)) as Trio
  const M = COMP_MATRIX[st.s.relayClock]
  let comp = M.map((r) => r.reduce((s, m, k) => add(s, scale(matched[k], m)), ZERO)) as Trio
  if (!st.s.zsFilter) {
    const i0 = toSeq(matched)[0]
    comp = comp.map((x) => add(x, i0)) as Trio
  }
  const iop = comp.map((x, p) => abs(add(x, d.lvPu[p])))
  const ires = comp.map((x, p) => (abs(x) + abs(d.lvPu[p])) / 2)
  const thr = ires.map((x) => biasThreshold(x, st.s.bias))
  const trip = iop.some((x, p) => x > thr[p])
  const ok = iop.every((x, p) => Math.abs(x - d.iop[p]) <= 1e-9 * Math.max(1, x)) && ires.every((x, p) => Math.abs(x - d.ires[p]) <= 1e-9 * Math.max(1, x)) && trip === d.trip
  return { d, matched, comp, iop, ires, thr, trip, ok }
}

// ── 4 · Petersen coil ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * An independent model of the earth fault at the generator terminals, solved in PHASE quantities (no symmetrical
 * components, no z0Of, no faultAtPoint): the winding is three emfs E_a, E_b, E_c behind its phase impedance matrix
 * (from the machine's Z₁, Z₂, Z₀ — Module 4's phase.ts), its star point N goes to earth through Z_n (or nowhere), each
 * terminal has C₀ to earth, and phase a is bolted to earth. Unknowns V_a, V_b, V_c, I_a, I_b, I_c, V_N (per unit):
 *   V_p − V_N + Σ Z_pq I_q = E_p      (each phase)
 *   V_N + Z_n (I_a + I_b + I_c) = 0   (or I_a + I_b + I_c = 0 when unearthed)
 *   V_a = 0,  I_b = jωC₀ V_b,  I_c = jωC₀ V_c,  and the fault current is I_a − jωC₀ V_a = I_a.
 */
export function phaseDomainEarthFault(p: EarthParams): { iFaultA: number; vPu: [number, number, number] } | null {
  const { z1, z2, z0g } = genSequence()
  const Z = phaseImpedance(z0g, z1, z2)
  const zn = neutralOhm(p)
  const yc = C(0, p.withC ? W * p.c0uF * 1e-6 * ZB_GEN : 0)
  const E = [C(1), polarDeg(1, -120), polarDeg(1, 120)]
  const O = ZERO
  const I1 = C(1)
  // columns: Va Vb Vc Ia Ib Ic VN
  const rows: Complex[][] = [0, 1, 2].map((r) => [r === 0 ? I1 : O, r === 1 ? I1 : O, r === 2 ? I1 : O, Z[r][0], Z[r][1], Z[r][2], C(-1)])
  const rhs: Complex[] = [...E]
  if (zn) {
    const z = scale(zn, 1 / ZB_GEN)
    rows.push([O, O, O, z, z, z, I1])
  } else rows.push([O, O, O, I1, I1, I1, O])
  rhs.push(O)
  rows.push([I1, O, O, O, O, O, O])
  rhs.push(O)
  rows.push([O, scale(yc, -1), O, O, I1, O, O])
  rhs.push(O)
  rows.push([O, O, scale(yc, -1), O, O, I1, O])
  rhs.push(O)
  const x = solveComplex(rows, rhs)
  if (!x) return null
  return { iFaultA: abs(x[3]) * IB_GEN_A, vPu: [abs(x[0]), abs(x[1]), abs(x[2])] }
}

export function checkPetersen(c0uF: number) {
  const xc = 1 / (W * c0uF * 1e-6)
  const classic = petersenClassic(c0uF)
  const exact = petersenExact(c0uF)
  const base = { ...EARTH0, method: 'resonant' as const, c0uF, withC: true }
  const f = earthFault({ ...base, detunePct: 0 })
  // the independent phase-domain solve with the coil at the exact tuning, and at the classical value
  const nodal = phaseDomainEarthFault({ ...base, detunePct: 0 })
  const nodalClassic = phaseDomainEarthFault({ ...base, detunePct: (classic / exact - 1) * 100 })
  const fClassic = earthFault({ ...base, detunePct: (classic / exact - 1) * 100 })
  const iTuned = nodal ? nodal.iFaultA : NaN
  const iClassic = nodalClassic ? nodalClassic.iFaultA : NaN
  // 1e-6 A: the solve is exact up to rounding of a 7×7 system whose capacitive admittance is ~1e-4 pu
  const ok = iTuned < 1e-6 && Math.abs(iClassic - fClassic.iFaultA) <= 1e-6 * Math.max(1, fClassic.iFaultA)
  return { xc, classic, exact, x0: X0G_OHM, iTuned, iClassic, iCap: f.iCapA, ok }
}

// ── 5 · TRV ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** RK4 with 4000 steps over 2.2 natural periods: local error ~ (ω₀h)⁵ ≈ 1e-14, so the two agree far inside 1e-6 of V_m; the sampled maximum slope is within (ω₀h)²/8 ≈ 2e-6 of the true one. */
export const TRV_TOL = { v: 1e-6, slope: 1e-4 }

export function checkTrv(st: TrvState) {
  const d = sourceDuty(st.cb)
  const p = { lH: d.lH, cF: st.cNf * 1e-9, vPeakV: d.vPeakV, rOhm: st.rOn ? st.rOhm : null }
  if (trvIssues(p).length) return null
  const mt = trvMetrics(p)
  const tEnd = 2.2 / mt.f0
  const r = trvRk4(p, tEnd, 4000)
  let dev = 0
  for (let k = 0; k < r.t.length; k++) dev = Math.max(dev, Math.abs(r.v[k] - trvAt(r.t[k], p)))
  const devRel = dev / d.vPeakV
  const slopeRel = Math.abs(r.sMax - mt.rrrv) / mt.rrrv
  // the RRRV may lie outside the window only for a heavily over-damped circuit: then compare with the window's own maximum
  return { d, p, mt, r, devRel, slopeRel, ok: devRel < TRV_TOL.v && slopeRel < TRV_TOL.slope }
}

// ── 6 · generator coverage ──────────────────────────────────────────────────────────────────────────────────────

/**
 * An independent nodal model of the stator earth fault: the neutral N (unknown V_N) connects to earth through R_n; each
 * terminal p sits at V_N + E_p and has C₀ to earth; the fault point P on phase a sits at V_N + x·E_a and connects to
 * earth through R_f. KCL at N (all currents to earth): V_N/R_n + Σ_p jωC₀(V_N + E_p) + (V_N + x·E_a)/R_f = 0 — solved
 * numerically with the actual phase emfs (for R_f = 0 the fault point is held at earth potential instead).
 */
export function statorNodal(x: number, p: StatorParams): number {
  const E = [C(1), polarDeg(1, -120), polarDeg(1, 120)].map((e) => scale(e, VPH_GEN))
  const yc = C(0, W * p.c0uF * 1e-6)
  if (p.rfOhm === 0) return abs(scale(E[0], x))
  // a·V_N + b = 0
  let a = C(1 / p.rnOhm + 1 / p.rfOhm)
  let b = scale(E[0], x / p.rfOhm)
  for (const e of E) {
    a = add(a, yc)
    b = add(b, mul(yc, e))
  }
  return abs(div(b, a))
}

export function checkStator(st: StatorState) {
  if (statorIssues(st.p).length) return null
  const cov = statorCoverage(st.p)
  // second method: bisection on the independent nodal model for V_N = k·V_ph
  const k = (st.p.kPct / 100) * VPH_GEN
  let xBis = 1
  if (statorNodal(1, st.p) >= k) {
    let a = 0
    let b = 1
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2
      if (statorNodal(m, st.p) < k) a = m
      else b = m
    }
    xBis = (a + b) / 2
  }
  const xMin = Math.min(1, cov.xMin)
  return { cov, xBis, ok: Math.abs(xBis - xMin) < 1e-9 }
}

export const ONE_C = C(1)
