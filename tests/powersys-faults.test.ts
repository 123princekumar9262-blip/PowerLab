import { describe, expect, it } from 'vitest'
import { A_OP, abs, add, C, div, inv, mul, neg, polarDeg, scale, sub, ZERO, type Complex } from '../src/powersys/engine/complex.ts'
import { invertComplex, solveComplex } from '../src/powersys/engine/linalg.ts'
import { branchPu, iBaseKa, zBaseOhm, zFromMagXr } from '../src/powersys/network/perunit.ts'
import { solveNetwork } from '../src/powersys/network/solve.ts'
import type { Network } from '../src/powersys/network/types.ts'
import { buildYbus } from '../src/powersys/network/ybus.ts'
import { gridNetwork } from '../src/powersys/modules/grid/network.ts'
import { phaseDomainFault, phaseImpedance } from '../src/powersys/modules/faults/phase.ts'
import { CURVES, grade, tmsFor, tripTime, type Relay } from '../src/powersys/modules/faults/relays.ts'
import { A2, faultAtPoint, FAULT_TYPES, sequenceSets, shiftSeq, toPhase, toSeq, type Trio } from '../src/powersys/modules/faults/sequence.ts'
import { allTypes, faultModel, RELAYS0, relayCurrents, SETUP0 } from '../src/powersys/modules/faults/study.ts'
import { directThreePhase, faultStudy, sequenceModel, theveninAt, threePhaseWithLoadFlow, zeroConnection } from '../src/powersys/modules/faults/zbus.ts'

const near = (a: Complex, b: Complex, tol = 1e-9) => expect(abs(sub(a, b))).toBeLessThan(tol)
const nearTrio = (a: Trio, b: Trio, tol = 1e-9) => a.forEach((x, i) => near(x, b[i], tol))
const matVec = (M: Complex[][], v: Complex[]) => M.map((r) => r.reduce((s, m, k) => add(s, mul(m, v[k])), ZERO))

describe('Symmetrical components', () => {
  it('the operator a: 1 + a + a² = 0, a³ = 1', () => {
    near(add(add(C(1), A_OP), A2), ZERO, 1e-15)
    near(mul(A2, A_OP), C(1), 1e-15)
  })
  it('abc → 012 → abc is the identity, and x₀ is the average of the phases', () => {
    const x: Trio = [polarDeg(1.2, 10), polarDeg(0.4, -100), polarDeg(0.9, 150)]
    const s = toSeq(x)
    nearTrio(toPhase(s), x, 1e-14)
    near(s[0], scale(add(add(x[0], x[1]), x[2]), 1 / 3), 1e-15)
    nearTrio(toSeq(toPhase([C(0.1, 0.2), C(0.7, -0.3), C(-0.2, 0.05)])), [C(0.1, 0.2), C(0.7, -0.3), C(-0.2, 0.05)], 1e-14)
  })
  it('a balanced positive set has only x₁; one phase alone splits into three equal thirds', () => {
    const s = toSeq([polarDeg(1, 0), polarDeg(1, -120), polarDeg(1, 120)])
    near(s[0], ZERO, 1e-15)
    near(s[1], C(1), 1e-15)
    near(s[2], ZERO, 1e-15)
    const t = toSeq([C(1), ZERO, ZERO])
    t.forEach((x) => near(x, C(1 / 3), 1e-15))
  })
  it('the three sets add up, phase by phase, to the original', () => {
    const x: Trio = [polarDeg(1, 0), polarDeg(0.3, -140), polarDeg(0.8, 95)]
    const { zero, pos, neg: ng } = sequenceSets(toSeq(x))
    for (let p = 0; p < 3; p++) near(add(add(zero[p], pos[p]), ng[p]), x[p], 1e-14)
  })
})

describe('Faults at a point: sequence formulas against an independent phase-domain solution', () => {
  const z1 = C(0.02, 0.2)
  const z2 = C(0.03, 0.25)
  const z0 = C(0.01, 0.1)
  const vf = polarDeg(1.03, 5)
  for (const zf of [ZERO, C(0.05, 0.01)])
    for (const t of FAULT_TYPES)
      it(`${t}, Z_f = ${zf.re}: phase currents and voltages agree`, () => {
        const s = faultAtPoint(t, vf, z1, z2, z0, zf)
        const p = phaseDomainFault(t, vf, z1, z2, z0, zf)!
        nearTrio(s.iabc, p.iabc, 1e-12)
        nearTrio(s.vabc, p.vabc, 1e-12)
      })
  it('the fault conditions hold', () => {
    const zf = C(0.05)
    const lg = faultAtPoint('slg', vf, z1, z2, z0, zf)
    near(lg.iabc[1], ZERO, 1e-14)
    near(lg.iabc[2], ZERO, 1e-14)
    near(lg.vabc[0], mul(zf, lg.iabc[0]), 1e-14)
    near(lg.iabc[0], scale(lg.i012[0], 3), 1e-14)
    const ll = faultAtPoint('ll', vf, z1, z2, z0, zf)
    near(ll.iabc[0], ZERO, 1e-14)
    near(add(ll.iabc[1], ll.iabc[2]), ZERO, 1e-14)
    near(sub(ll.vabc[1], ll.vabc[2]), mul(zf, ll.iabc[1]), 1e-14)
    const dg = faultAtPoint('dlg', vf, z1, z2, z0, zf)
    near(dg.iabc[0], ZERO, 1e-14)
    near(dg.vabc[1], dg.vabc[2], 1e-14)
    near(dg.vabc[1], mul(zf, add(dg.iabc[1], dg.iabc[2])), 1e-14)
    const f3 = faultAtPoint('3ph', vf, z1, z2, z0, zf)
    near(mul(f3.i012[1], add(z1, zf)), vf, 1e-14)
  })
  it('closed form for a single source, X₁ = X₂ = 0.2, X₀ = 0.1 pu, bolted', () => {
    const j = (x: number) => C(0, x)
    expect(abs(faultAtPoint('3ph', C(1), j(0.2), j(0.2), j(0.1)).iabc[0])).toBeCloseTo(5, 12)
    expect(abs(faultAtPoint('slg', C(1), j(0.2), j(0.2), j(0.1)).iabc[0])).toBeCloseTo(6, 12) // 3/(0.2+0.2+0.1)
    expect(abs(faultAtPoint('ll', C(1), j(0.2), j(0.2), j(0.1)).iabc[1])).toBeCloseTo(Math.sqrt(3) / 0.4, 12) // √3·V/(Z1+Z2)
    // DLG: I1 = 1/(j0.2 + j0.2‖j0.1) = 1/j0.26667, I0 = −I1·Z2/(Z2+Z0); earth current 3I0 = 3·3.75·2/3 = 7.5
    const d = faultAtPoint('dlg', C(1), j(0.2), j(0.2), j(0.1))
    expect(abs(d.i012[1])).toBeCloseTo(3.75, 12)
    expect(abs(scale(d.i012[0], 3))).toBeCloseTo(7.5, 12)
  })
  it('no earth path (Z₀ = ∞): no earth-fault current, and the healthy phases rise to √3', () => {
    const lg = faultAtPoint('slg', C(1), C(0, 0.2), C(0, 0.2), null)
    lg.iabc.forEach((i) => expect(abs(i)).toBe(0))
    expect(abs(lg.vabc[0])).toBeLessThan(1e-15)
    expect(abs(lg.vabc[1])).toBeCloseTo(Math.sqrt(3), 12)
    expect(abs(lg.vabc[2])).toBeCloseTo(Math.sqrt(3), 12)
    const dg = faultAtPoint('dlg', C(1), C(0, 0.2), C(0, 0.25), null)
    const ll = faultAtPoint('ll', C(1), C(0, 0.2), C(0, 0.25), null)
    nearTrio(dg.iabc, ll.iabc, 1e-14)
    expect(abs(dg.vabc[1])).toBeLessThan(1e-14) // b and c pulled to earth potential
  })
  it('a Y–d shift changes which phase carries current, never the set of magnitudes', () => {
    const f = faultAtPoint('slg', C(1), C(0.01, 0.3), C(0.01, 0.3), C(0, 0.2))
    const delta: Trio = [ZERO, f.i012[1], f.i012[2]] // zero sequence does not pass a delta
    const m = (deg: number) =>
      toPhase(shiftSeq(delta, deg))
        .map(abs)
        .sort((a, b) => a - b)
    m(30).forEach((x, i) => expect(x).toBeCloseTo(m(-30)[i], 12))
    m(60).forEach((x, i) => expect(x).toBeCloseTo(m(0)[i], 12))
    expect(m(30)[0]).toBeLessThan(1e-12) // one phase carries nothing
    expect(m(30)[2]).toBeCloseTo(abs(f.iabc[0]) / Math.sqrt(3), 12) // the other two: I_f/√3
  })
})

describe('Bus impedance matrix of the Grid Explorer network', () => {
  const net = gridNetwork()
  const m = sequenceModel(net)
  const n = m.busIds.length
  it('Z_bus · Y_bus = I in the positive sequence', () => {
    const { Y, Z } = m.seq[1]
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++)
        near(
          Y[i].reduce((s, y, j) => add(s, mul(y, Z[j][k])), ZERO),
          C(i === k ? 1 : 0),
          1e-10,
        )
  })
  it('radial network: Z_kk at the town = the sum of the series impedances from the generator', () => {
    const g = net.components.find((c) => c.kind === 'generator')!
    let z = g.kind === 'generator' ? C(0, (g.x1Pu! * net.baseMva) / g.ratedMva) : ZERO
    for (const id of ['T1', 'L1', 'T2', 'L2', 'T3']) {
      const b = net.components.find((c) => c.id === id)!
      // lines from their data; transformers at nominal ratio (taps ignored): nameplate % on the network base, by hand
      if (b.kind === 'line') z = add(z, branchPu(net, b).z)
      if (b.kind === 'transformer') z = add(z, scale(zFromMagXr(b.zPct / 100, b.xr), net.baseMva / b.ratedMva))
    }
    near(theveninAt(m, m.busIds.indexOf('lv')).z1!, z, 1e-12)
  })
  it('three-phase faults: Z_bus method = direct solution of the faulted network, at every bus, bolted and through Z_f', () => {
    for (const id of m.busIds)
      for (const zf of [ZERO, C(0.05, 0.02)]) {
        const r = faultStudy(m, id, '3ph', zf)
        const d = directThreePhase(m, id, zf)!
        near(r.point.i012[1], d.iF, 1e-10)
        r.buses.forEach((b, i) => near(b.v012[1], d.v[i], 1e-10))
      }
  })
  it('bolted three-phase fault: I_f · Z_kk = V_f, and the fault level = S_base / |Z_kk|', () => {
    for (const id of m.busIds) {
      const r = faultStudy(m, id, '3ph')
      near(mul(r.point.i012[1], r.z1!), C(1), 1e-12)
      expect(r.levelMva).toBeCloseTo(net.baseMva / abs(r.z1!), 9)
      expect(r.faultKa).toBeCloseTo(abs(r.point.i012[1]) * iBaseKa(net.buses[r.bus].kv, net.baseMva), 12)
    }
  })
  it('generator terminals: 1/(j·x″d·S_base/S_rated) — 600 MVA, 25.1 kA', () => {
    const r = faultStudy(m, 'gen', '3ph')
    expect(r.levelMva).toBeCloseTo(100 / ((0.2 * 100) / 120), 9)
    expect(r.faultKa).toBeCloseTo(600 / (Math.sqrt(3) * 13.8), 9)
  })
  it('KCL in every sequence at the fault: what the branches bring in is the fault current', () => {
    for (const t of FAULT_TYPES) {
      const r = faultStudy(m, 'lv', t)
      const t3 = r.branches.find((b) => b.id === 'T3')!
      nearTrio(t3.i012To, r.point.i012, 1e-10) // the town bus is fed only through T3
      // the generator's positive- and negative-sequence currents go on through T1 (hvA → gen is the branch's direction)
      const t1 = r.branches.find((b) => b.id === 'T1')!
      near(r.sources[0].i012[1], neg(t1.i012To[1]), 1e-10)
      near(r.sources[0].i012[2], neg(t1.i012To[2]), 1e-10)
    }
  })
  it('zero sequence: YN–d windings earth the YN side and isolate the delta side', () => {
    expect(zeroConnection('YN', 'D')).toBe('earth-from')
    expect(zeroConnection('D', 'YN')).toBe('earth-to')
    expect(zeroConnection('YN', 'YN')).toBe('series')
    expect(zeroConnection('Y', 'YN')).toBe('open')
    expect(zeroConnection('D', 'D')).toBe('open')
    // the 33 kV system is fed through deltas at both ends: no earth path there
    expect(m.seq[0].earthed[m.busIds.indexOf('mvA')]).toBe(false)
    expect(m.seq[0].earthed[m.busIds.indexOf('mvB')]).toBe(false)
    // generator bus: only the generator's own earthed star — Z₀ = j·x₀·S_base/S_rated
    near(theveninAt(m, m.busIds.indexOf('gen')).z0!, C(0, (0.06 * 100) / 120), 1e-12)
  })
  it('an earth fault on the unearthed 33 kV system draws no current and lifts the whole 33 kV system’s healthy phases to √3', () => {
    const r = faultStudy(m, 'mvB', 'slg')
    expect(r.faultKa).toBe(0)
    for (const id of ['mvA', 'mvB']) {
      const v = r.buses.find((b) => b.id === id)!.vabc.map(abs)
      expect(v[0]).toBeLessThan(1e-12)
      expect(v[1]).toBeCloseTo(Math.sqrt(3), 9)
    }
    // other voltage levels are untouched
    expect(abs(r.buses.find((b) => b.id === 'hvB')!.vabc[0])).toBeCloseTo(1, 12)
  })
  it('an earthing transformer gives the 33 kV system an earth path: I = 3V_f/(Z₁ + Z₂ + Z₀)', () => {
    const me = faultModel({ ...SETUP0, et33: true, rnOhm: 10 })
    const k = me.busIds.indexOf('mvB')
    const th = theveninAt(me, k)
    expect(th.z0).not.toBeNull()
    const r = faultStudy(me, 'mvB', 'slg')
    near(r.point.iabc[0], div(C(3), add(add(th.z1!, th.z2!), th.z0!)), 1e-12)
    // all of the earth-fault current returns through the earthing transformer
    near(scale(r.sources.find((s) => s.id === 'ET')!.i012[0], 3), r.point.iabc[0], 1e-10)
  })
  it('the fault types at the generator terminals: earth fault is the largest (x₀ < x₁)', () => {
    const a = allTypes(m, 'gen')
    expect(a.slg.faultKa).toBeGreaterThan(a['3ph'].faultKa)
    expect(a.ll.faultKa / a['3ph'].faultKa).toBeCloseTo(Math.sqrt(3) / 2, 9) // Z2 = Z1
  })
  it('pre-fault load flow: superposition is consistent and close to the 1.0 pu result', () => {
    const lf = threePhaseWithLoadFlow(net, 'lv', C(0.1))!
    near(lf.vDuring[net.buses.findIndex((b) => b.id === 'lv')], mul(C(0.1), lf.iF), 1e-10)
    const flat = faultStudy(m, 'lv', '3ph')
    expect(Math.abs(lf.ka / flat.faultKa - 1)).toBeLessThan(0.1)
  })
  it('pre-fault load flow: an independent direct solve of the faulted network gives the same currents and voltages', () => {
    // the network with loads as constant admittances (at their load-flow voltage) and sources as Norton equivalents
    const sol = solveNetwork(net)
    const ids = net.buses.map((x) => x.id)
    const Y = buildYbus(net, ids).map((r) => [...r])
    for (const c of net.components)
      if (c.kind === 'load') {
        const i = ids.indexOf(c.bus)
        const vm = sol.bus[c.bus].vPu
        Y[i][i] = add(Y[i][i], scale(C(c.pMw, -c.qMvar), 1 / (net.baseMva * vm * vm)))
      }
    for (const g of m.sources) if (g.z1) Y[g.bus][g.bus] = add(Y[g.bus][g.bus], inv(g.z1))
    const v0 = ids.map((id) => polarDeg(sol.bus[id].vPu, sol.bus[id].angDeg))
    const J = matVec(Y, v0)
    // the load model reproduces the load flow: no injection at buses without a source
    const srcBuses = new Set(m.sources.map((g) => g.bus))
    ids.forEach((_, i) => {
      if (!srcBuses.has(i)) expect(abs(J[i])).toBeLessThan(1e-8)
    })
    const k = ids.indexOf('lv')
    const zf = C(0.1)
    const Yf = Y.map((r, i) => r.map((y, j) => (i === k && j === k ? add(y, inv(zf)) : y)))
    const V = solveComplex(Yf, J)!
    const lf = threePhaseWithLoadFlow(net, 'lv', zf)!
    near(div(V[k], zf), lf.iF, 1e-10)
    V.forEach((v, i) => near(v, lf.vDuring[i], 1e-10))
  })
})

describe('An independent phase-domain nodal solution of a meshed network', () => {
  // a 110 kV grid infeed, two parallel 110 kV lines (a loop), a YN–yn transformer to 33 kV and an earthed generator there
  const net: Network = {
    id: 't',
    name: 't',
    baseMva: 100,
    fHz: 50,
    buses: [
      { id: 'A', name: 'A', kv: 110, x: 0, y: 0 },
      { id: 'B', name: 'B', kv: 110, x: 100, y: 0 },
      { id: 'C', name: 'C', kv: 33, x: 200, y: 0 },
    ],
    components: [
      { kind: 'grid', id: 'S', name: 'S', bus: 'A', vPu: 1, scMva: 2000, xr: 10 },
      { kind: 'line', id: 'L1', name: 'L1', from: 'A', to: 'B', lengthKm: 30, rOhmPerKm: 0.1, xOhmPerKm: 0.4, bUsPerKm: 0, r0OhmPerKm: 0.3, x0OhmPerKm: 1.2 },
      { kind: 'line', id: 'L2', name: 'L2', from: 'A', to: 'B', lengthKm: 45, rOhmPerKm: 0.12, xOhmPerKm: 0.42, bUsPerKm: 0, r0OhmPerKm: 0.35, x0OhmPerKm: 1.3 },
      { kind: 'transformer', id: 'T', name: 'T', from: 'B', to: 'C', ratedMva: 40, kvFrom: 110, kvTo: 33, zPct: 10, xr: 20, connFrom: 'YN', connTo: 'YN' },
      { kind: 'generator', id: 'G', name: 'G', bus: 'C', mode: 'pv', vPu: 1, pMw: 0, ratedMva: 50, x1Pu: 0.15, x2Pu: 0.18, x0Pu: 0.05, grounded: true, xnPu: 0.02 },
    ],
  }
  const m = sequenceModel(net)
  const nb = 3
  // phase-domain admittance matrix 9×9 and Norton injections
  const Y: Complex[][] = Array.from({ length: 3 * nb }, () => Array.from({ length: 3 * nb }, () => ZERO))
  const J: Complex[] = new Array(3 * nb).fill(ZERO)
  const E = [C(1), A2, A_OP]
  const addBlock = (i: number, k: number, Yb: Complex[][], sign: number) => {
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) Y[3 * i + p][3 * k + q] = add(Y[3 * i + p][3 * k + q], scale(Yb[p][q], sign))
  }
  const series: Record<string, Complex[][]> = {}
  for (const b of m.branches) {
    const Yb = invertComplex(phaseImpedance(b.z0, b.z1, b.z2))!
    series[b.id] = Yb
    addBlock(b.from, b.from, Yb, 1)
    addBlock(b.to, b.to, Yb, 1)
    addBlock(b.from, b.to, Yb, -1)
    addBlock(b.to, b.from, Yb, -1)
  }
  for (const s of m.sources) {
    const Ys = invertComplex(phaseImpedance(s.z0!, s.z1!, s.z2!))!
    addBlock(s.bus, s.bus, Ys, 1)
    matVec(Ys, E).forEach((x, p) => (J[3 * s.bus + p] = add(J[3 * s.bus + p], x)))
  }
  it('builds the sequence model with the infeed equal in all sequences', () => {
    near(m.sources[0].z0!, zFromMagXr(100 / 2000, 10), 1e-15)
    expect(zBaseOhm(110, 100)).toBeCloseTo(121, 12)
  })
  for (const t of FAULT_TYPES)
    for (const bus of ['B', 'C'])
      it(`${t} at ${bus}: fault and branch phase currents from Z_bus + sequences = phase-domain nodal solution`, () => {
        const k = m.busIds.indexOf(bus)
        const zf = C(0.02, 0.01)
        // unknowns: 9 node voltages + 3 fault currents leaving bus k
        const N = 3 * nb + 3
        const M: Complex[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => ZERO))
        const rhs: Complex[] = new Array(N).fill(ZERO)
        for (let r = 0; r < 3 * nb; r++) {
          for (let c = 0; c < 3 * nb; c++) M[r][c] = Y[r][c]
          rhs[r] = J[r]
        }
        for (let p = 0; p < 3; p++) M[3 * k + p][3 * nb + p] = C(1) // Y·V + I_f = J
        const V = (p: number) => 3 * k + p
        const I = (p: number) => 3 * nb + p
        const row = (cells: Array<[number, Complex]>) => {
          const r = new Array(N).fill(ZERO)
          for (const [c, v] of cells) r[c] = add(r[c], v)
          return r
        }
        const nz = neg(zf)
        const cons =
          t === '3ph'
            ? [0, 1, 2].map((p) =>
                row([
                  [V(p), C(1)],
                  [I(p), nz],
                ]),
              )
            : t === 'slg'
              ? [
                  row([
                    [V(0), C(1)],
                    [I(0), nz],
                  ]),
                  row([[I(1), C(1)]]),
                  row([[I(2), C(1)]]),
                ]
              : t === 'll'
                ? [
                    row([[I(0), C(1)]]),
                    row([
                      [I(1), C(1)],
                      [I(2), C(1)],
                    ]),
                    row([
                      [V(1), C(1)],
                      [V(2), C(-1)],
                      [I(1), nz],
                    ]),
                  ]
                : [
                    row([[I(0), C(1)]]),
                    row([
                      [V(1), C(1)],
                      [V(2), C(-1)],
                    ]),
                    row([
                      [V(1), C(1)],
                      [I(1), nz],
                      [I(2), nz],
                    ]),
                  ]
        cons.forEach((r, q) => (M[3 * nb + q] = r))
        const x = solveComplex(M, rhs)!
        const r = faultStudy(m, bus, t, zf)
        nearTrio(r.point.iabc, [x[I(0)], x[I(1)], x[I(2)]], 1e-9)
        // a branch current: L1 from A to B
        const l1 = m.branches.find((b) => b.id === 'L1')!
        const dv = [0, 1, 2].map((p) => sub(x[3 * l1.from + p], x[3 * l1.to + p]))
        nearTrio(r.branches.find((b) => b.id === 'L1')!.iabcFrom, matVec(series.L1, dv) as Trio, 1e-9)
        // and every bus voltage
        r.buses.forEach((b, i) => nearTrio(b.vabc, [x[3 * i], x[3 * i + 1], x[3 * i + 2]], 1e-9))
      })
})

describe('Overcurrent relays (IEC 60255 inverse-time curves)', () => {
  it('standard inverse, TMS 1, I/Is = 10: t = 0.14/(10^0.02 − 1) ≈ 2.971 s', () => {
    expect(tripTime('SI', 1, 100, 1000)).toBeCloseTo(0.14 / (10 ** 0.02 - 1), 12)
    expect(tripTime('SI', 1, 100, 1000)).toBeCloseTo(2.971, 3)
  })
  it('very inverse 13.5/(M − 1) and extremely inverse 80/(M² − 1); TMS scales the time', () => {
    expect(tripTime('VI', 1, 100, 1000)).toBeCloseTo(1.5, 12)
    expect(tripTime('EI', 1, 100, 1000)).toBeCloseTo(80 / 99, 12)
    expect(tripTime('SI', 0.25, 100, 500)).toBeCloseTo((0.25 * CURVES.SI.k) / (5 ** 0.02 - 1), 12)
  })
  it('no operation at or below pick-up; constant above 20 × I_s', () => {
    expect(tripTime('SI', 0.1, 100, 100)).toBe(Infinity)
    expect(tripTime('SI', 0.1, 100, 50)).toBe(Infinity)
    expect(tripTime('EI', 0.1, 100, 5000)).toBe(tripTime('EI', 0.1, 100, 2000))
  })
  it('tmsFor inverts tripTime', () => {
    const tms = tmsFor('VI', 400, 2000, 0.8)
    expect(tripTime('VI', tms, 400, 2000)).toBeCloseTo(0.8, 12)
  })
  it('grading R1 (town feeder) and R2 (33 kV line): the default settings are too close; the computed TMS grades with ≥ 0.3 s at the maximum fault', () => {
    const m = faultModel()
    const { downA, upA } = relayCurrents(m, 'feeder', '3ph')
    // both see the same fault: the 33 kV current is the 11 kV current divided by the 33/11 ratio
    expect(upA).toBeCloseTo(downA / 3, 6)
    const g0 = grade(RELAYS0.down, RELAYS0.up, downA, upA)
    expect(g0.ok).toBe(false)
    const tDown = tripTime(RELAYS0.down.curve, RELAYS0.down.tms, RELAYS0.down.isA, downA)
    const tms = Math.ceil(tmsFor('SI', RELAYS0.up.isA, upA, tDown + 0.3) * 100) / 100
    const up: Relay = { ...RELAYS0.up, tms }
    const g = grade(RELAYS0.down, up, downA, upA)
    expect(g.ok).toBe(true)
    expect(g.margin).toBeGreaterThanOrEqual(0.3)
    expect(g.margin).toBeLessThan(0.4)
    // earth faults on the feeder grade more easily: through the Dyn transformer the 33 kV side sees only I/√3 (referred)
    for (const t of ['slg', 'dlg'] as const) {
      const c = relayCurrents(m, 'feeder', t)
      expect(grade(RELAYS0.down, up, c.downA, c.upA).margin).toBeGreaterThan(0.3)
    }
    const slg = relayCurrents(m, 'feeder', 'slg')
    expect((slg.upA * 3) / slg.downA).toBeCloseTo(1 / Math.sqrt(3), 9)
    // a line-to-line fault behind a D–y transformer puts 2/√3 of the (referred) current in one 33 kV phase
    const ll = relayCurrents(m, 'feeder', 'll')
    expect((ll.upA * 3) / ll.downA).toBeCloseTo(2 / Math.sqrt(3), 9)
  })
  it('a fault on the 33 kV line is seen only by R2', () => {
    const c = relayCurrents(faultModel(), 'mvB', '3ph')
    expect(c.downA).toBe(0)
    expect(c.upA).toBeGreaterThan(0)
  })
})

describe('Sanity: per-unit bases used', () => {
  it('I_base = S_base/(√3·V)', () => {
    expect(iBaseKa(11, 100)).toBeCloseTo(100 / (Math.sqrt(3) * 11), 12)
    expect(abs(inv(C(0, 0.5)))).toBe(2)
  })
})
