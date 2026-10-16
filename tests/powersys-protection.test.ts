import { describe, expect, it } from 'vitest'
import { abs, add, arg, C, div, mul, polarDeg, scale, sub, ZERO, type Complex } from '../src/powersys/engine/complex.ts'
import { iBaseKa } from '../src/powersys/network/perunit.ts'
import { FAULT_TYPES, toPhase, type Trio } from '../src/powersys/modules/faults/sequence.ts'
import { faultModel, SETUP0 } from '../src/powersys/modules/faults/study.ts'
import { faultStudy, sequenceModel, theveninAt } from '../src/powersys/modules/faults/zbus.ts'
import {
  clearing,
  decide,
  directional,
  distanceCase,
  inMho,
  K0,
  k0Of,
  L1_KM,
  L3_KM,
  loadCheck,
  LOOP_OF,
  mhoComparator,
  mhoReachAt,
  reachOhm,
  RELAY_IDS,
  ROUTE0,
  routeFault,
  routeNetwork,
  sourceImpedances,
  sweep,
  twoSource3ph,
  Z0L,
  Z1L,
  ZB,
  IB_KA,
  ZONES0,
  zoneIssues,
  apparentOhm,
  type RelayDecision,
  type RelayId,
} from '../src/powersys/modules/protection/distance.ts'
import { biasIssues, biasThreshold, BIAS0, COMP_MATRIX, compensate, DIFF0, DIFF_SETUP, differential, I_RATED_LV, spillClosedForm } from '../src/powersys/modules/protection/differential.ts'
import {
  capacitiveCurrent,
  EARTH0,
  earthFault,
  earthIssues,
  genSequence,
  IB_GEN_A,
  petersenClassic,
  petersenExact,
  statorCoverage,
  statorFault,
  STATOR0,
  statorIssues,
  W,
  X0G_OHM,
  ZB_GEN,
  VPH_GEN,
} from '../src/powersys/modules/protection/earthing.ts'
import { peakFactor, rCritical, sourceDuty, trvAt, trvIssues, trvMetrics, trvRk4, xrForDoubling } from '../src/powersys/modules/protection/breaker.ts'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
/** Relative closeness (absolute near zero: the scale is at least 1e-6 of the unit). */
const nearC = (a: Complex, b: Complex, tol: number) => expect(abs(sub(a, b)) / Math.max(abs(b), 1e-6)).toBeLessThan(tol)
const mZ = (km: number) => scale(Z1L, km / L1_KM)

describe('Distance: a fault part-way along the line, on Module 4’s model', () => {
  it('k₀ = (Z₀L − Z₁L)/(3Z₁L) from the line data', () => {
    nearC(K0, div(sub(Z0L, Z1L), scale(Z1L, 3)), 1e-14)
    nearC(k0Of(Z1L, Z0L), K0, 1e-14)
  })
  it('with the infeed off the network is Module 4’s own: every bus-fault current and voltage unchanged (L3 is a dead end)', () => {
    const m4 = faultModel(SETUP0)
    const ours = sequenceModel(routeNetwork(ROUTE0))
    for (const bus of ['gen', 'hvA', 'hvB', 'mvA', 'lv'])
      for (const t of FAULT_TYPES) {
        const a = faultStudy(m4, bus, t)
        const b = faultStudy(ours, bus, t)
        expect(b.faultKa).toBeCloseTo(a.faultKa, 9)
        a.buses.forEach((x, i) => x.vabc.forEach((v, p) => nearC(b.buses[i].vabc[p], v, 1e-9)))
      }
  })
  for (const t of FAULT_TYPES)
    it(`m = 0 and m = 1 reproduce Module 4’s bus faults at A and B (${t})`, () => {
      const m4 = faultModel(SETUP0)
      const atA = faultStudy(m4, 'hvA', t)
      const atB = faultStudy(m4, 'hvB', t)
      const f0 = routeFault({ km: 0, type: t, rfOhm: 0 })
      const f1 = routeFault({ km: L1_KM, type: t, rfOhm: 0 })
      expect(f0.faultKa).toBeCloseTo(atA.faultKa, 9)
      expect(f1.faultKa).toBeCloseTo(atB.faultKa, 9)
      // at m = 1 the relay at A carries Module 4's L1 current for a fault at B
      const l1 = atB.branches.find((b) => b.id === 'L1')!
      f1.relays.RA.iabc.forEach((x, p) => expect(abs(x) * IB_KA).toBeCloseTo(abs(l1.iabcFrom[p]) * IB_KA, 9))
      // at m = 0 (line side of A's CT) it carries the fault current less what arrives from B through L1
      const l1a = atA.branches.find((b) => b.id === 'L1')!
      const want = toPhase(atA.point.i012.map((x, s) => add(x, l1a.i012From[s])) as Trio)
      f0.relays.RA.iabc.forEach((x, p) => nearC(x, want[p], 1e-9))
      // and a fault 1 m inside the line agrees with both ends' limits
      const near0 = routeFault({ km: 0.001, type: t, rfOhm: 0 })
      expect(rel(near0.faultKa, f0.faultKa)).toBeLessThan(1e-4)
      const near1 = routeFault({ km: L1_KM - 0.001, type: t, rfOhm: 0 })
      expect(rel(near1.faultKa, f1.faultKa)).toBeLessThan(1e-4)
    })
  it('bolted three-phase faults: Z_app = m·Z₁L (relative 1e-9), single source and with a remote infeed and pre-fault transfer', () => {
    for (const opts of [ROUTE0, { infeed: true, sscMva: 3000, deltaDeg: 0 }, { infeed: true, sscMva: 1500, deltaDeg: 15 }, { infeed: true, sscMva: 800, deltaDeg: -10 }])
      for (const km of [1, 12, 50.5, 84, 96, 119.9]) {
        const f = routeFault({ km, type: '3ph', rfOhm: 0 }, opts)
        const z = apparentOhm('aE', f.relays.RA, K0)!
        nearC(z, mZ(km), 1e-9)
        nearC(apparentOhm('ab', f.relays.RA, K0)!, mZ(km), 1e-9)
      }
  })
  it('bolted L-G faults: compensated Z_app = m·Z₁L, even with zero-sequence infeed from T2 at B', () => {
    for (const opts of [ROUTE0, { infeed: true, sscMva: 2000, deltaDeg: 10 }])
      for (const km of [6, 42, 84, 108]) {
        const f = routeFault({ km, type: 'slg', rfOhm: 0 }, opts)
        nearC(apparentOhm('aE', f.relays.RA, K0)!, mZ(km), 1e-9)
      }
  })
  it('L-L and L-L-G faults: the b–c loop measures m·Z₁L', () => {
    for (const t of ['ll', 'dlg'] as const) for (const km of [30, 90]) nearC(apparentOhm(LOOP_OF[t], routeFault({ km, type: t, rfOhm: 0 }).relays.RA, K0)!, mZ(km), 1e-9)
  })
  it('uncompensated earth loop: Z = m·Z₁L·(1 + k₀·3I₀/I_a) in general, and m(2Z₁L + Z₀L)/3 when the relay carries the whole fault current', () => {
    const km = 84
    const f = routeFault({ km, type: 'slg', rfOhm: 0 })
    const v = f.relays.RA
    const ires = add(add(v.iabc[0], v.iabc[1]), v.iabc[2])
    const zUnc = apparentOhm('aE', v, ZERO)!
    nearC(zUnc, mul(mZ(km), add(C(1), div(mul(K0, ires), v.iabc[0]))), 1e-9)
    expect(abs(zUnc)).toBeGreaterThan(abs(mZ(km))) // Z₀ > Z₁: the relay sees the fault further away (under-reach)
    // radial case: no earth path at B (T2's HV star not earthed) → I_a = 3I₀ at the relay
    const net = routeNetwork(ROUTE0)
    const t2 = net.components.find((c) => c.id === 'T2')!
    if (t2.kind === 'transformer') t2.connFrom = 'Y'
    const g = routeFault({ km, type: 'slg', rfOhm: 0 }, ROUTE0, net)
    nearC(apparentOhm('aE', g.relays.RA, ZERO)!, scale(add(scale(Z1L, 2), Z0L), km / L1_KM / 3), 1e-9)
  })
  it('fault resistance, single source: Z_app = m·Z₁L + R_f (three-phase)', () => {
    for (const rf of [1, 5, 20, 40]) for (const km of [24, 84]) nearC(apparentOhm('aE', routeFault({ km, type: '3ph', rfOhm: rf }).relays.RA, K0)!, add(mZ(km), C(rf)), 1e-9)
  })
  it('fault resistance with a remote infeed: the network agrees with the two-source circuit by hand (infeed factor), with and without pre-fault transfer', () => {
    for (const deltaDeg of [0, 12, -8]) {
      const opts = { infeed: true, sscMva: 2500, deltaDeg }
      const { zs, zr, zl } = sourceImpedances(opts)
      for (const [km, rf] of [
        [36, 10],
        [84, 15],
        [110, 3],
      ]) {
        const f = routeFault({ km, type: '3ph', rfOhm: rf }, opts)
        const z = apparentOhm('aE', f.relays.RA, K0)!
        const h = twoSource3ph(zs, zr, zl, km / L1_KM, C(rf / ZB), C(1), polarDeg(1, -deltaDeg))
        nearC(z, scale(h.zApp, ZB), 1e-9)
        // the infeed form: Z = mZ_L + R_f(1 + I_B/I_A), larger than the single-source shift R_f
        const iB = sub(h.iF, h.iA)
        nearC(z, add(mZ(km), scale(add(C(1), div(iB, h.iA)), rf)), 1e-9)
        if (deltaDeg === 0) expect(abs(sub(z, mZ(km)))).toBeGreaterThan(rf)
      }
    }
  })
  it('pre-fault transfer rotates the fault-resistance term (export: tilts down; import: tilts up)', () => {
    const z = (d: number) => sub(apparentOhm('aE', routeFault({ km: 84, type: '3ph', rfOhm: 15 }, { infeed: true, sscMva: 2000, deltaDeg: d }).relays.RA, K0)!, mZ(84))
    expect(arg(z(12))).toBeLessThan(arg(z(0)))
    expect(arg(z(-12))).toBeGreaterThan(arg(z(0)))
  })
})

describe('Distance: mho zones and decisions', () => {
  it('mho geometry: centre Z_r/2, the origin and Z_r on the circle, the comparator equals the circle test', () => {
    const zr = reachOhm(Z1L, 80)
    expect(inMho(C(0), zr)).toBe(true)
    expect(inMho(zr, zr)).toBe(true)
    expect(inMho(scale(zr, 1.000001), zr)).toBe(false)
    expect(mhoReachAt(zr, arg(zr))).toBeCloseTo(abs(zr), 12)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    for (let k = 0; k < 2000; k++) {
      const z = C(rnd() * 60, rnd() * 60)
      if (Math.abs(abs(sub(z, scale(zr, 0.5))) - abs(zr) / 2) < 1e-9) continue
      expect(mhoComparator(z, zr)).toBe(inMho(z, zr))
    }
  })
  it('zone decisions at the boundaries: inside / outside by 0.1 %', () => {
    const at = (km: number) => decide('RA', routeFault({ km, type: '3ph', rfOhm: 0 }).relays.RA, '3ph', ZONES0)
    expect(at(0.8 * L1_KM * 0.999).zone).toBe(1)
    expect(at(0.8 * L1_KM * 1.001).zone).toBe(2)
    // zone 2 reaches 120 % of Z₁L: with no infeed and the same per-km data on L3, that is 144 km along the route
    expect(at(1.2 * L1_KM * 0.999).zone).toBe(2)
    expect(at(1.2 * L1_KM * 1.001).zone).toBe(3)
    // zone 3 (200 %) reaches past the end of L3; with 150 % it ends at 180 km
    expect(at(L1_KM + L3_KM).zone).toBe(3)
    const z150 = { ...ZONES0, reachPct: [80, 120, 150] as [number, number, number] }
    const at3 = (km: number) => decide('RA', routeFault({ km, type: '3ph', rfOhm: 0 }).relays.RA, '3ph', z150).zone
    expect(at3(1.5 * L1_KM * 0.999)).toBe(3)
    expect(at3(1.5 * L1_KM * 1.001)).toBe(0)
    expect(at(0.7 * L1_KM).tripS).toBe(0)
    expect(at(0.9 * L1_KM).tripS).toBe(0.3)
  })
  it('the mho is directional: the relay at B on L3 does not operate for faults on L1 (behind it), but does for faults on L3', () => {
    const opts = { infeed: true, sscMva: 2000, deltaDeg: 0 }
    const c = distanceCase({ km: 60, type: '3ph', rfOhm: 0 }, opts, ZONES0)
    expect(c.decisions.RBC.zone).toBe(0)
    expect(c.decisions.RBA.zone).toBe(1)
    const d = distanceCase({ km: L1_KM + 30, type: '3ph', rfOhm: 0 }, opts, ZONES0)
    expect(d.decisions.RBC.zone).toBe(1)
    expect(d.decisions.RBA.zone).toBe(0)
  })
  it('fault resistance makes the relay under-reach: a 3-phase fault at 70 % leaves zone 1 once R_f is large enough', () => {
    const z = (rf: number) => distanceCase({ km: 0.7 * L1_KM, type: '3ph', rfOhm: rf }, ROUTE0, ZONES0).decisions.RA.zone
    expect(z(0)).toBe(1)
    expect(z(15)).toBe(2)
  })
  it('clearing: an L1 fault with infeed opens both ends; an L3 fault is cleared at B and A resets; no source at B → A alone', () => {
    const opts = { infeed: true, sscMva: 2000, deltaDeg: 0 }
    const c = distanceCase({ km: 60, type: '3ph', rfOhm: 0 }, opts, ZONES0).clearing
    expect(c.open.cbA).not.toBeNull()
    expect(c.open.cbB1).not.toBeNull()
    expect(c.open.cbB2).toBeNull()
    expect(c.dead.L1).toBe(true)
    expect(c.dead.L3).toBe(false)
    const d = distanceCase({ km: L1_KM + 10, type: '3ph', rfOhm: 0 }, ROUTE0, ZONES0)
    expect(d.decisions.RA.zone).toBe(2)
    expect(d.decisions.RBC.zone).toBe(1)
    expect(d.clearing.open.cbB2).toBeCloseTo(0.06, 12)
    expect(d.clearing.open.cbA).toBeNull()
    expect(d.clearing.reset).toContain('RA')
    const e = distanceCase({ km: 60, type: '3ph', rfOhm: 0 }, ROUTE0, ZONES0)
    expect(e.decisions.RBA.z).toBeNull() // no current from B: it cannot measure
    expect(e.clearing.clearedS).toBeCloseTo(0.06, 12)
    expect(e.clearing.dead.B).toBe(true)
    // nothing operates → not cleared
    const none: Record<RelayId, RelayDecision> = Object.fromEntries(RELAY_IDS.map((r) => [r, { relay: r, loop: 'aE', z: null, iA: 0, zone: 0, tripS: null }])) as Record<RelayId, RelayDecision>
    expect(clearing(none, true, false).clearedS).toBeNull()
  })
  it('the time–distance sweep finds the zone boundaries where the single decisions put them', () => {
    const s = sweep('3ph', 0, ROUTE0, { ...ZONES0, reachPct: [80, 120, 150] }, 60)
    const ra = s.steps.RA.filter((x) => x.x1 - x.x0 > 1e-3)
    expect(ra.map((x) => x.zone)).toEqual([1, 2, 3, 0])
    expect(ra[0].x1).toBeCloseTo(0.8 * L1_KM, 3)
    expect(ra[1].x1).toBeCloseTo(1.2 * L1_KM, 3)
    expect(ra[2].x1).toBeCloseTo(1.5 * L1_KM, 3)
    const rbc = s.steps.RBC.filter((x) => x.x1 - x.x0 > 1e-3)
    expect(rbc[0].zone).toBe(1)
    expect(rbc[0].x1).toBeCloseTo(L1_KM + 0.8 * L3_KM, 3)
    // the trajectory is m·Z₁L for every sample
    for (const p of s.points) if (p.z && p.km > 0) nearC(p.z, mZ(p.km), 1e-9)
  })
  it('invalid settings are refused with a reason', () => {
    expect(zoneIssues(ZONES0)).toEqual([])
    expect(zoneIssues({ ...ZONES0, reachPct: [0, 120, 200] }).length).toBeGreaterThan(0)
    expect(zoneIssues({ ...ZONES0, reachPct: [80, 70, 200] }).length).toBeGreaterThan(0)
    expect(zoneIssues({ ...ZONES0, reachPct: [80, 120, NaN] }).length).toBeGreaterThan(0)
    expect(zoneIssues({ ...ZONES0, timeS: [0, -0.1, 0.8] }).length).toBeGreaterThan(0)
  })
  it('load encroachment: Z_load,min = (0.9·220)²/250 Ω, compared with zone 3 along the load angle', () => {
    const l = loadCheck(ZONES0)
    expect(l.zMin).toBeCloseTo((0.9 * 220) ** 2 / 250, 9)
    expect(l.reachAtLoad).toBeCloseTo(abs(Z1L) * 2 * Math.cos(arg(Z1L) - Math.acos(0.85)), 9)
    expect(l.encroaches).toBe(false)
    expect(loadCheck({ ...ZONES0, reachPct: [80, 120, 500] }).encroaches).toBe(true)
  })
})

describe('Directional element (quadrature connection)', () => {
  it('convention: in a balanced system V_bc lags V_a by 90°; a current lagging V_a by the line angle is forward, its reverse is reverse', () => {
    const va = C(1)
    const vb = polarDeg(1, -120)
    const vc = polarDeg(1, 120)
    expect(((arg(sub(vb, vc)) - arg(va)) * 180) / Math.PI).toBeCloseTo(-90, 9)
    const th = arg(Z1L)
    const view = (s: number) => ({
      id: 'RA' as const,
      v012: [ZERO, ZERO, ZERO] as Trio,
      i012: [ZERO, ZERO, ZERO] as Trio,
      vabc: [va, vb, vc] as Trio,
      iabc: [polarDeg(s, (-th * 180) / Math.PI), ZERO, ZERO] as Trio,
    })
    expect(directional(view(1), 'slg').forward).toBe(true)
    expect(directional(view(-1), 'slg').forward).toBe(false)
    // the operating angle: I_a ahead of V_bc by 90° − θ_line
    expect(directional(view(1), 'slg').angleDeg).toBeCloseTo(90 - (th * 180) / Math.PI, 9)
  })
  it('the relay at B on L1: faults on L1 are forward, faults on L3 (behind it) reverse — for each fault type', () => {
    const opts = { infeed: true, sscMva: 2000, deltaDeg: 0 }
    for (const t of FAULT_TYPES) {
      expect(directional(routeFault({ km: 50, type: t, rfOhm: 0 }, opts).relays.RBA, t).forward).toBe(true)
      expect(directional(routeFault({ km: L1_KM + 40, type: t, rfOhm: 0 }, opts).relays.RBA, t).forward).toBe(false)
    }
  })
})

describe('Transformer differential (Module 4’s T2)', () => {
  it('the phase-domain "delta CT" matrices equal the sequence-domain compensation (zero sequence removed)', () => {
    const i: Trio = [polarDeg(1.3, 10), polarDeg(0.4, -150), polarDeg(0.8, 95)]
    for (const h of [1, 11] as const) {
      const M = COMP_MATRIX[h]
      const direct = M.map((row) => row.reduce((s, m, k) => add(s, scale(i[k], m)), ZERO))
      compensate(i, h, true).forEach((x, p) => nearC(x, direct[p], 1e-12))
    }
  })
  for (const type of FAULT_TYPES)
    it(`through fault on the 33 kV side, YNd11 compensated as Yd11, ideal CTs: I_op = 0 (${type})`, () => {
      const d = differential('ext-lv', type, DIFF0)
      d.iop.forEach((x) => expect(x).toBeLessThan(1e-9))
      expect(d.trip).toBe(false)
    })
  it('YNd1 transformer compensated as Yd1 also balances; the wrong setting does not', () => {
    const ok = differential('ext-lv', '3ph', { ...DIFF0, clock: 1, relayClock: 1 })
    ok.iop.forEach((x) => expect(x).toBeLessThan(1e-9))
    const bad = differential('ext-lv', '3ph', { ...DIFF0, clock: 11, relayClock: 1 })
    // a 60° error: I_op = 2·sin(30°)·I = I
    const through = abs(bad.lvA[0]) / I_RATED_LV
    expect(bad.iop[0]).toBeCloseTo(through, 9)
    expect(bad.trip).toBe(true)
  })
  it('external earth fault on the 220 kV side: T2’s earthed star feeds zero sequence — removed by the filter, a false trip without it', () => {
    const f = differential('ext-hv', 'slg', DIFF0)
    f.iop.forEach((x) => expect(x).toBeLessThan(1e-9))
    const nf = differential('ext-hv', 'slg', { ...DIFF0, zsFilter: false })
    expect(nf.trip).toBe(true)
  })
  it('internal three-phase fault at the LV terminals: I_op equals the fault current (in pu of rating)', () => {
    const d = differential('int-lv', '3ph', DIFF0)
    const fault = faultStudy(faultModel(DIFF_SETUP), 'mvA', '3ph')
    for (const p of [0, 1, 2]) expect(d.iop[p] * I_RATED_LV).toBeCloseTo(fault.faultKa * 1000, 6)
    expect(d.trip).toBe(true)
  })
  it('tap and CT errors give a spill current I_op = I_t·|ε + t/(1+t)|, restrained by the bias', () => {
    for (const [t, e] of [
      [10, 0],
      [-10, 5],
      [5, -3],
    ]) {
      const d = differential('ext-lv', '3ph', { ...DIFF0, tapPct: t, ctErrPct: e })
      const it = abs(d.lvA[0]) / I_RATED_LV
      expect(d.iop[0]).toBeCloseTo(spillClosedForm(it, t, e), 9)
    }
    expect(differential('ext-lv', '3ph', { ...DIFF0, tapPct: 10 }).trip).toBe(false)
  })
  it('bias characteristic: continuous at the knee, minimum pick-up, slopes', () => {
    const b = BIAS0
    expect(biasThreshold(0, b)).toBe(b.is1)
    expect(biasThreshold(b.is2, b)).toBeCloseTo(b.k1 * b.is2, 12)
    expect(biasThreshold(b.is2 + 1e-9, b)).toBeCloseTo(b.k1 * b.is2, 6)
    expect(biasThreshold(b.is2 + 1, b)).toBeCloseTo(b.k1 * b.is2 + b.k2, 12)
    expect(biasThreshold(0.5, b)).toBeCloseTo(Math.max(b.is1, b.k1 * 0.5), 12)
    expect(biasIssues(b)).toEqual([])
    expect(biasIssues({ ...b, is1: 0 }).length).toBeGreaterThan(0)
  })
})

describe('Neutral earthing (Module 4’s generator system)', () => {
  const m4 = (genEarth: 'solid' | 'reactor' | 'unearthed', xnPu = 0.1) => faultStudy(faultModel({ ...SETUP0, genEarth, xnPu }), 'gen', 'slg')
  it('with C₀ left out, solid / reactance / unearthed reproduce Module 4’s line-to-ground faults (current and voltages)', () => {
    const base = { ...EARTH0, withC: false }
    const zbRating = 13.8 ** 2 / 120
    const cases: Array<[ReturnType<typeof earthFault>, ReturnType<typeof m4>]> = [
      [earthFault({ ...base, method: 'solid' }), m4('solid')],
      [earthFault({ ...base, method: 'reactance', xnOhm: 3 }), m4('reactor', 3 / zbRating)],
      [earthFault({ ...base, method: 'unearthed' }), m4('unearthed')],
    ]
    for (const [a, b] of cases) {
      expect(a.iFaultA).toBeCloseTo(b.faultKa * 1000, 6)
      a.point.vabc.forEach((v, p) => expect(abs(v)).toBeCloseTo(abs(b.point.vabc[p]), 12))
    }
  })
  it('unearthed (ideal, no capacitance): no current, healthy phases at √3 pu', () => {
    const f = earthFault({ ...EARTH0, method: 'unearthed', withC: false })
    expect(f.iFaultA).toBe(0)
    expect(f.vPu[1]).toBeCloseTo(Math.sqrt(3), 12)
    expect(f.vPu[2]).toBeCloseTo(Math.sqrt(3), 12)
  })
  it('unearthed with C₀: the fault current is the capacitive current ≈ 3ωC₀V_ph', () => {
    for (const c0uF of [0.2, 0.5, 2]) {
      const f = earthFault({ ...EARTH0, method: 'unearthed', c0uF })
      expect(rel(f.iFaultA, capacitiveCurrent(c0uF))).toBeLessThan(1e-3)
    }
  })
  it('resistance earthing: I = 3V/(Z₁ + Z₂ + Z₀g + 3R_n) by hand', () => {
    const { z1, z2, z0g } = genSequence()
    const rn = 25
    const f = earthFault({ ...EARTH0, method: 'resistance', rnOhm: rn, withC: false })
    const hand = abs(div(C(3), add(add(z1, z2), add(z0g, C((3 * rn) / ZB_GEN))))) * IB_GEN_A
    expect(f.iFaultA).toBeCloseTo(hand, 6)
  })
  it('Petersen coil: X = 1/(3ωC₀) classically; exact tuning (with the generator’s X₀) zeroes the fault current; detuning leaves a residual', () => {
    for (const c0uF of [0.1, 0.5, 1, 3]) {
      expect(petersenClassic(c0uF)).toBeCloseTo(1 / (3 * W * c0uF * 1e-6), 9)
      expect(3 * petersenExact(c0uF) + X0G_OHM).toBeCloseTo(1 / (W * c0uF * 1e-6), 6)
      const f = earthFault({ ...EARTH0, method: 'resonant', c0uF, detunePct: 0 })
      expect(f.iFaultA).toBeLessThan(1e-9)
      // √3 × the pre-fault terminal voltage, which the capacitance lifts very slightly above the emf (1/(1 + jωC₀Z₁))
      expect(Math.abs(f.vHealthyPu - Math.sqrt(3))).toBeLessThan(1e-3)
      expect(f.vHealthyPu).toBeCloseTo(phaseDomainEarthFault({ ...EARTH0, method: 'resonant', c0uF, detunePct: 0 })!.vPu[1], 9)
      const g = earthFault({ ...EARTH0, method: 'resonant', c0uF, detunePct: 10 })
      expect(g.iFaultA).toBeGreaterThan(0)
      expect(g.iFaultA).toBeLessThan(capacitiveCurrent(c0uF))
      // nearly tuned → nearly zero (continuous)
      expect(earthFault({ ...EARTH0, method: 'resonant', c0uF, detunePct: 1e-6 }).iFaultA).toBeLessThan(1e-5 * capacitiveCurrent(c0uF))
    }
  })
  it('solid earthing keeps the healthy phases lower than resistance earthing, which approaches √3', () => {
    const s = earthFault({ ...EARTH0, method: 'solid' })
    const r = earthFault({ ...EARTH0, method: 'resistance', rnOhm: 500 })
    expect(s.vHealthyPu).toBeLessThan(r.vHealthyPu)
    expect(r.vHealthyPu).toBeLessThan(Math.sqrt(3) * 1.01)
    expect(earthIssues({ ...EARTH0, method: 'resistance', rnOhm: 0 }).length).toBeGreaterThan(0)
    expect(earthIssues({ ...EARTH0, method: 'resonant', withC: false }).length).toBeGreaterThan(0)
  })
  it('the generator sequence impedances come from Module 4', () => {
    const m = faultModel({ ...SETUP0, genEarth: 'solid' })
    const th = theveninAt(m, m.busIds.indexOf('gen'))
    expect(abs(sub(genSequence().z0g, th.z0!))).toBe(0)
  })
})

describe('Generator stator earth fault', () => {
  it('V_N = x·V_ph for a bolted fault; a relay set at k % protects (100 − k) % of the winding', () => {
    for (const x of [0.05, 0.3, 1]) expect(statorFault(x, STATOR0).vnV).toBeCloseTo(x * VPH_GEN, 6)
    for (const k of [2, 5, 10, 20]) expect(statorCoverage({ ...STATOR0, kPct: k }).protectedPct).toBeCloseTo(100 - k, 9)
  })
  it('with fault resistance the coverage shrinks, and the boundary is where V_N equals the setting (bisection check)', () => {
    const p = { ...STATOR0, rfOhm: 1500 }
    const c = statorCoverage(p)
    expect(c.protectedPct).toBeLessThan(100 - p.kPct)
    let a = 0
    let b = 1
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2
      if (statorFault(m, p).vnPct < p.kPct) a = m
      else b = m
    }
    expect(a).toBeCloseTo(c.xMin, 9)
    expect(statorIssues({ ...STATOR0, rnOhm: 0 }).length).toBeGreaterThan(0)
  })
})

describe('Circuit breaker: TRV and making current', () => {
  const duty = sourceDuty('CB1')
  it('the breaking current is Module 4’s three-phase fault current at the bus', () => {
    expect(duty.iSymKa).toBeCloseTo(faultStudy(faultModel(SETUP0), 'hvA', '3ph').faultKa, 12)
    expect(duty.lH).toBeCloseTo(duty.xOhm / (2 * Math.PI * 50), 12)
  })
  it('undamped TRV: closed form against RK4; peak 2V_m at π/ω₀; RRRV = V_m·ω₀', () => {
    for (const cF of [2e-9, 10e-9, 50e-9]) {
      const p = { lH: duty.lH, cF, vPeakV: duty.vPeakV, rOhm: null }
      const mt = trvMetrics(p)
      expect(mt.peakV).toBeCloseTo(2 * duty.vPeakV, 6)
      expect(mt.rrrv).toBeCloseTo(duty.vPeakV / Math.sqrt(duty.lH * cF), 3)
      const T = (2 * Math.PI) / mt.w0
      const n = 4000
      const r = trvRk4(p, 1.5 * T, n)
      for (let k = 0; k <= n; k += 97) expect(Math.abs(r.v[k] - trvAt(r.t[k], p)) / duty.vPeakV).toBeLessThan(1e-9)
      expect(rel(r.vMax, mt.peakV)).toBeLessThan(1e-6)
      expect(rel(r.sMax, mt.rrrv)).toBeLessThan(1e-5)
    }
  })
  it('a resistor across the contacts damps the TRV (under, critical, over): closed forms against RK4', () => {
    const cF = 10e-9
    const rc = rCritical(duty.lH, cF)
    for (const R of [4 * rc, 1.5 * rc, rc, 0.5 * rc]) {
      const p = { lH: duty.lH, cF, vPeakV: duty.vPeakV, rOhm: R }
      const mt = trvMetrics(p)
      const T = (2 * Math.PI) / mt.w0
      const r = trvRk4(p, 2 * T, 8000)
      for (let k = 0; k <= 8000; k += 113) expect(Math.abs(r.v[k] - trvAt(r.t[k], p)) / duty.vPeakV).toBeLessThan(1e-8)
      expect(rel(r.sMax, mt.rrrv)).toBeLessThan(1e-4)
      if (mt.regime === 'under') expect(rel(r.vMax, mt.peakV)).toBeLessThan(1e-6)
      expect(mt.rrrv).toBeLessThan(duty.vPeakV * mt.w0)
    }
  })
  it('larger capacitance → slower rise (RRRV ∝ 1/√C), same 2V_m peak', () => {
    const a = trvMetrics({ lH: duty.lH, cF: 10e-9, vPeakV: duty.vPeakV, rOhm: null })
    const b = trvMetrics({ lH: duty.lH, cF: 40e-9, vPeakV: duty.vPeakV, rOhm: null })
    expect(b.rrrv / a.rrrv).toBeCloseTo(0.5, 9)
    expect(b.peakV).toBeCloseTo(a.peakV, 6)
  })
  it('making current: the doubling factor 1.8 corresponds to X/R ≈ 14; X/R → ∞ gives 2', () => {
    expect(xrForDoubling(1.8)).toBeCloseTo(Math.PI / Math.log(1.25), 12)
    expect(1 + Math.exp(-Math.PI / xrForDoubling(1.8))).toBeCloseTo(1.8, 12)
    expect(peakFactor(1e9)).toBeCloseTo(2, 6)
    // the exact maximum is slightly above the 1 + e^(−π/(X/R)) estimate
    for (const xr of [5, 14, 30]) {
      expect(peakFactor(xr)).toBeGreaterThanOrEqual(1 + Math.exp(-Math.PI / xr) - 1e-12)
      expect(peakFactor(xr) - (1 + Math.exp(-Math.PI / xr))).toBeLessThan(0.01)
    }
    expect(1.8 * Math.SQRT2).toBeCloseTo(2.55, 2)
  })
  it('invalid TRV inputs are refused', () => {
    expect(trvIssues({ lH: 0.1, cF: 0, vPeakV: 1, rOhm: null }).length).toBeGreaterThan(0)
    expect(trvIssues({ lH: 0.1, cF: 1e-9, vPeakV: 1, rOhm: 0 }).length).toBeGreaterThan(0)
    expect(trvIssues({ lH: 0.1, cF: 1e-9, vPeakV: 1, rOhm: null })).toEqual([])
  })
  it('iBase sanity for the 220 kV level', () => {
    expect(IB_KA).toBeCloseTo(iBaseKa(220, 100), 12)
  })
})

// ── every Verify check holds over the whole allowed input range (random sampling + edges) ─────────────────────────
import { checkDiff, checkK0, checkPetersen, checkStator, checkTrv, checkZapp } from '../src/powersys/modules/protection/verify.ts'
import { EXPERIMENTS } from '../src/powersys/modules/protection/experiments.ts'
import { practiceItems } from '../src/powersys/modules/protection/practise.tsx'
import { STATE0 } from '../src/powersys/modules/protection/state.ts'

describe('Verify checks hold for every valid input', () => {
  let seed = 12345
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  it('apparent impedance: V/I equals KVL along the line data (random faults, types, R_f, infeed, transfer, k₀)', () => {
    for (let n = 0; n < 120; n++) {
      const infeed = rnd() < 0.5
      const s = {
        spec: { km: n < 6 ? [0, 0.5, L1_KM, L1_KM + 0.5, L1_KM + L3_KM, 60][n] : rnd() * (L1_KM + L3_KM), type: pick(FAULT_TYPES), rfOhm: rnd() < 0.3 ? 0 : rnd() * 40 },
        opts: { infeed, sscMva: 300 + rnd() * 7700, deltaDeg: infeed ? Math.round(-20 + rnd() * 40) : 0 },
        zones: { ...ZONES0, k0On: rnd() < 0.8 },
      }
      const c = checkZapp(s)
      if (c) expect(c.ok, `${JSON.stringify(s)} diff ${abs(sub(c.zDirect, c.zKvl))} of ${abs(c.zDirect)}`).toBe(true)
    }
  })
  it('k₀ check', () => expect(checkK0().ok).toBe(true))
  it('differential: sequence compensation equals the phase-domain matrix (all locations, types, settings)', () => {
    for (let n = 0; n < 80; n++) {
      const st = {
        loc: pick(['ext-lv', 'int-lv', 'ext-hv'] as const),
        type: pick(FAULT_TYPES),
        s: { ...STATE0.diff.s, clock: pick([1, 11] as const), relayClock: pick([1, 11] as const), zsFilter: rnd() < 0.7, tapPct: -15 + rnd() * 30, ctErrPct: -10 + rnd() * 20 },
      }
      expect(checkDiff(st).ok).toBe(true)
    }
  })
  it('Petersen check over the C₀ range', () => {
    for (const c of [0.05, 0.1, 0.37, 1, 2.2, 3]) expect(checkPetersen(c).ok).toBe(true)
  })
  it('TRV: RK4 against the closed form over the breaker, C and R ranges (incl. near-critical and heavy damping)', () => {
    for (const cb of ['CB1', 'CB2', 'CB4'])
      for (const cNf of [1, 7, 33, 100])
        for (const r of [null, 50, 300, 1000, 3000, 20000]) {
          const c = checkTrv({ cb, cNf, rOn: r !== null, rOhm: r ?? 1000 })!
          expect(c.ok, `${cb} ${cNf} nF R ${r}: dev ${c.devRel} slope ${c.slopeRel}`).toBe(true)
        }
    const d = sourceDuty('CB1')
    const rc = rCritical(d.lH, 10e-9)
    expect(checkTrv({ cb: 'CB1', cNf: 10, rOn: true, rOhm: rc })!.ok).toBe(true)
  })
  it('generator coverage: formula against bisection over the range', () => {
    for (let n = 0; n < 60; n++) {
      const st = { xPct: 30, p: { rnOhm: 100 + rnd() * 9900, c0uF: rnd() * 2, rfOhm: rnd() < 0.3 ? 0 : rnd() * 5000, kPct: 1 + Math.round(rnd() * 29) } }
      expect(checkStator(st)!.ok).toBe(true)
    }
  })
})

describe('Experiments and practice answers come from the computation', () => {
  it('every experiment’s answer is one of its options, and the expected physics holds', () => {
    const ans = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.run().answer]))
    for (const e of EXPERIMENTS) expect(e.options.map((o) => o.id)).toContain(ans[e.id])
    expect(ans).toEqual({ zones: '1-2', rf: 'under', k0: 'further', through: 'no', spill: 'restrain', earthing: 'low-high', trv: 'slower' })
  })
  it('practice numbers are independently recomputed', () => {
    const q = Object.fromEntries(practiceItems().map((x) => [x.id, x]))
    const num = (id: string) => (q[id].kind === 'number' ? q[id].answer : NaN)
    expect(num('z-60')).toBeCloseTo(0.6 * Math.hypot(0.06 * 120, 0.41 * 120), 9)
    expect(num('pet')).toBeCloseTo(1 / (3 * 2 * Math.PI * 50e-6), 9)
    expect(num('rrrv')).toBeCloseTo(1, 9) // 10 kV × 1e5 rad/s = 1e9 V/s
    expect(num('making')).toBeCloseTo(50.91, 2)
    expect(num('spill')).toBeCloseTo(0.4 / 1.1, 12)
    expect(num('gate-ic')).toBeCloseTo(3 * 2 * Math.PI * 50e-6 * (11000 / Math.sqrt(3)), 9)
    // GATE mho: 13 + j20 against the circle centred 4 + j16, radius |8 + j32|/2
    expect(q['gate-mho'].kind === 'choice' && q['gate-mho'].answer).toBe(Math.hypot(9, 4) <= Math.hypot(8, 32) / 2 ? 'yes' : 'no')
    expect(q['gate-dir'].kind === 'choice' && q['gate-dir'].answer).toBe(Math.cos(((30 - 45) * Math.PI) / 180) > 0 ? 'yes' : 'no')
  })
})

// ── review fixes: the decomposition behind every "why", and independent earthing / stator models ────────────────
import { causes, decomposeZapp, describeChange } from '../src/powersys/modules/protection/describe.ts'
import { phaseDomainEarthFault, statorNodal } from '../src/powersys/modules/protection/verify.ts'
import { statorFault as statorFaultF } from '../src/powersys/modules/protection/earthing.ts'

describe('Z_app decomposition and the causes named in the explanations', () => {
  let seed = 4242
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const mk = (km: number, type: (typeof FAULT_TYPES)[number], rfOhm: number, infeed: boolean, sscMva: number, deltaDeg: number, k0On: boolean) => ({
    spec: { km, type, rfOhm },
    opts: { infeed, sscMva, deltaDeg: infeed ? deltaDeg : 0 },
    zones: { ...ZONES0, k0On },
  })
  it('line + k₀ error + infeed + R_f term = Z_app, and each term vanishes exactly when its cause is absent (random settings)', () => {
    for (let n = 0; n < 150; n++) {
      const s = mk(0.5 + rnd() * (L1_KM + L3_KM - 0.5), pick(FAULT_TYPES), rnd() < 0.4 ? 0 : rnd() * 40, rnd() < 0.5, 300 + rnd() * 7700, Math.round(-20 + rnd() * 40), rnd() < 0.6)
      const c = distanceCase(s.spec, s.opts, s.zones)
      const p = decomposeZapp(c.fault, s.zones)
      if (!p) continue
      nearC(p.total, c.decisions.RA.z!, 1e-9)
      if (s.zones.k0On || s.spec.type === 'll' || s.spec.type === 'dlg') expect(causes(p)).not.toContain('k0')
      if (s.spec.rfOhm === 0) expect(causes(p)).not.toContain('rf')
      if (s.spec.km <= L1_KM) expect(abs(p.infeed)).toBe(0)
      if (s.spec.km <= L1_KM && s.spec.rfOhm === 0 && s.zones.k0On) expect(causes(p)).toEqual(['line'])
      // the explanation names exactly the significant causes
      const prev = { ...s, spec: { ...s.spec, km: s.spec.km * 0.9 } }
      const d = describeChange(prev, s, distanceCase(prev.spec, prev.opts, prev.zones), c)!
      expect(d.causes).toEqual(causes(p))
      expect(/exactly m·Z₁L/.test(d.why)).toBe(causes(p).length === 1 && causes(p)[0] === 'line')
      expect(/uncompensated-earth-loop error/.test(d.why)).toBe(causes(p).includes('k0'))
      expect(/infeed at B/.test(d.why)).toBe(causes(p).includes('infeed'))
    }
  })
  it('the cases found in review: L3 fault with infeed, R_f → 0; R_f 0 → 0.5 Ω; L-G without k₀', () => {
    const a = mk(150, '3ph', 0.5, true, 2000, 0, true)
    const b = { ...a, spec: { ...a.spec, rfOhm: 0 } }
    const ca = distanceCase(a.spec, a.opts, a.zones)
    const cb = distanceCase(b.spec, b.opts, b.zones)
    const d = describeChange(a, b, ca, cb)!
    expect(d.causes).toContain('infeed')
    expect(/exactly m·Z₁L/.test(d.why)).toBe(false)
    const up = describeChange(b, a, cb, ca)!
    const pa = decomposeZapp(ca.fault, a.zones)!
    expect(abs(pa.rf)).toBeLessThan(5) // the R_f term itself, not the infeed-magnified L3 segment
    expect(up.why).toMatch(/The R_f term/)
    const k = mk(84, 'slg', 0, false, 2000, 0, false)
    const pk = decomposeZapp(distanceCase(k.spec, k.opts, k.zones).fault, k.zones)!
    expect(causes(pk)).toEqual(['line', 'k0'])
  })
})

describe('Independent models behind the Verify earthing and stator checks', () => {
  it('the phase-domain nodal earth fault equals the sequence result for every method (random C₀, R_n, X_n, detuning)', () => {
    let seed = 99
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let n = 0; n < 60; n++) {
      const p = {
        ...EARTH0,
        method: (['solid', 'resistance', 'reactance', 'unearthed', 'resonant'] as const)[n % 5],
        rnOhm: 1 + rnd() * 3999,
        xnOhm: 0.1 + rnd() * 19.9,
        detunePct: -30 + rnd() * 60,
        c0uF: 0.05 + rnd() * 2.95,
        withC: n % 7 !== 0 || n % 5 === 4,
      }
      const a = earthFault(p)
      const b = phaseDomainEarthFault(p)!
      expect(Math.abs(b.iFaultA - a.iFaultA)).toBeLessThan(1e-6 * Math.max(1, a.iFaultA))
      b.vPu.forEach((v, k) => expect(v).toBeCloseTo(a.vPu[k], 9))
    }
  })
  it('the nodal stator model equals the closed form V_N = x·V_ph·|Z_N|/|Z_N + R_f|', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let n = 0; n < 80; n++) {
      const p = { rnOhm: 100 + rnd() * 9900, c0uF: rnd() * 2, rfOhm: n % 4 === 0 ? 0 : rnd() * 5000, kPct: 5 }
      const x = rnd()
      expect(statorNodal(x, p)).toBeCloseTo(statorFaultF(x, p).vnV, 6)
    }
  })
})
