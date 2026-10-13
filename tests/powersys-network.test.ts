import { describe, expect, it } from 'vitest'
import { abs, add, arg, C, conj, deg, div, mul, polarDeg, scale, sub, ZERO, type Complex } from '../src/powersys/engine/complex.ts'
import { invertComplex, solveComplex, solveReal } from '../src/powersys/engine/linalg.ts'
import { solveLoadFlow, type LfBus } from '../src/powersys/network/loadflow.ts'
import { branchPu, iBaseKa, zBaseOhm, zFromMagXr } from '../src/powersys/network/perunit.ts'
import { solveNetwork } from '../src/powersys/network/solve.ts'
import { islands, validate } from '../src/powersys/network/topology.ts'
import type { Network } from '../src/powersys/network/types.ts'
import { buildYbus, ybusFromImpedances } from '../src/powersys/network/ybus.ts'
import { gridNetwork } from '../src/powersys/modules/grid/network.ts'

/** S_i = V_i · conj(Σ_k Y_ik V_k), computed independently of the solver's polar formulas. */
function injections(Y: Complex[][], V: Complex[]): Complex[] {
  return V.map((vi, i) => mul(vi, conj(Y[i].reduce((a, y, k) => add(a, mul(y, V[k])), ZERO))))
}

describe('Complex arithmetic and linear solvers', () => {
  it('basic identities', () => {
    const a = C(3, 4)
    expect(abs(a)).toBe(5)
    expect(div(mul(a, C(1, -2)), C(1, -2))).toEqual(
      expect.objectContaining({
        re: expect.closeTo(3, 12),
        im: expect.closeTo(4, 12),
      }),
    )
    expect(deg(arg(polarDeg(2, -30)))).toBeCloseTo(-30, 12)
    expect(() => div(a, ZERO)).toThrow(RangeError)
  })
  it('real and complex solves; singular systems return null', () => {
    expect(
      solveReal(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      )!.map((x) => +x.toFixed(12)),
    ).toEqual([0.8, 1.4])
    expect(
      solveReal(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull()
    const A = [
      [C(2, 1), C(0, -1)],
      [C(1, 0), C(3, -2)],
    ]
    const x = [C(1, -1), C(0.5, 2)]
    const b = A.map((r) => r.reduce((s, a, k) => add(s, mul(a, x[k])), ZERO))
    const y = solveComplex(A, b)!
    y.forEach((v, k) => expect(abs(sub(v, x[k]))).toBeLessThan(1e-12))
    const Ainv = invertComplex(A)!
    const I = A.map((r) => Ainv[0].map((_, j) => r.reduce((s, a, k) => add(s, mul(a, Ainv[k][j])), ZERO)))
    I.forEach((r, i) => r.forEach((v, j) => expect(abs(sub(v, C(i === j ? 1 : 0)))).toBeLessThan(1e-12)))
  })
})

describe('Per-unit bases and branch models', () => {
  it('Z_base = kV²/MVA, I_base = MVA/(√3 kV)', () => {
    expect(zBaseOhm(220, 100)).toBeCloseTo(484, 12)
    expect(zBaseOhm(11, 100)).toBeCloseTo(1.21, 12)
    expect(iBaseKa(220, 100)).toBeCloseTo(0.262432, 6)
  })
  it('R and X from |Z| and X/R', () => {
    const z = zFromMagXr(0.1, 10)
    expect(abs(z)).toBeCloseTo(0.1, 14)
    expect(z.im / z.re).toBeCloseTo(10, 12)
    expect(zFromMagXr(0.1, Infinity)).toEqual(C(0, 0.1))
  })
  it('a transformer changes base by (S_base/S_rated)·(V_rated/V_base)²; an off-nominal ratio is a tap', () => {
    const net: Network = {
      id: 't',
      name: 't',
      baseMva: 100,
      fHz: 50,
      buses: [
        { id: 'a', name: 'a', kv: 220, x: 0, y: 0 },
        { id: 'b', name: 'b', kv: 33, x: 0, y: 0 },
      ],
      components: [
        { kind: 'grid', id: 'S', name: 'S', bus: 'a', vPu: 1 },
        {
          kind: 'transformer',
          id: 'T',
          name: 'T',
          from: 'a',
          to: 'b',
          ratedMva: 50,
          kvFrom: 220,
          kvTo: 34.65,
          zPct: 10,
          xr: Infinity,
        },
      ],
    }
    const p = branchPu(net, net.components[1] as never)
    expect(p.z.im).toBeCloseTo(0.1 * (100 / 50) * (34.65 / 33) ** 2, 12)
    expect(p.tap).toBeCloseTo(33 / 34.65, 12)
    // Y_bus entries of the π-model with the tap at the `from` end
    const y = div(C(1), p.z)
    const Y = buildYbus(net, ['a', 'b'])
    expect(abs(sub(Y[0][0], scale(y, 1 / p.tap ** 2)))).toBeLessThan(1e-12)
    expect(abs(sub(Y[0][1], scale(y, -1 / p.tap)))).toBeLessThan(1e-12)
    expect(abs(sub(Y[1][1], y))).toBeLessThan(1e-12)
    // no load: the 33 kV side sits at 34.65/33 = 1.05 pu
    const s = solveNetwork(net)
    expect(s.ok).toBe(true)
    expect(s.bus.b.vPu).toBeCloseTo(1.05, 10)
    expect(s.bus.b.kv).toBeCloseTo(34.65, 8)
  })
  it('a line: Ω/km × km on the line’s voltage base, charging b/2 at each end', () => {
    const net = gridNetwork()
    const L1 = net.components.find((c) => c.id === 'L1')!
    const p = branchPu(net, L1 as never)
    expect(p.z.re).toBeCloseTo((0.06 * 120) / 484, 12)
    expect(p.z.im).toBeCloseTo((0.41 * 120) / 484, 12)
    expect(p.yHalf.im).toBeCloseTo((2.8e-6 * 120 * 484) / 2, 12)
  })
})

describe('Newton–Raphson load flow — references', () => {
  it('two buses: matches the closed-form receiving-end voltage of a lossless line', () => {
    // V2⁴ + (2QX − V1²)·V2² + X²(P² + Q²) = 0  (P, Q drawn at bus 2, line jX)
    const X = 0.1
    const P = 1.2
    const Q = 0.6
    const Y = ybusFromImpedances(2, [{ i: 0, k: 1, z: C(0, X) }])
    const r = solveLoadFlow(Y, [
      { type: 'slack', p: 0, q: 0, v: 1 },
      { type: 'pq', p: -P, q: -Q, v: 1 },
    ])
    const a = 1 - 2 * Q * X
    const v2 = Math.sqrt((a + Math.sqrt(a * a - 4 * X * X * (P * P + Q * Q))) / 2)
    expect(r.converged).toBe(true)
    expect(abs(r.V[1])).toBeCloseTo(v2, 10)
    // P·X = V1·V2·sin δ
    expect(Math.sin(-arg(r.V[1]))).toBeCloseTo((P * X) / v2, 10)
    // lossless: the slack supplies P; Q = load Q + I²X
    const I2 = (P * P + Q * Q) / (v2 * v2)
    expect(r.S[0].re).toBeCloseTo(P, 10)
    expect(r.S[0].im).toBeCloseTo(Q + I2 * X, 10)
  })

  // Saadat, Power System Analysis (3rd ed.), Example 6.7 data: three buses, 100 MVA base, slack 1.05∠0 pu,
  // loads 256.6 + j110.2 MW/Mvar (bus 2) and 138.6 + j45.2 (bus 3). The data were constructed so that the exact
  // solution is V2 = 0.98 − j0.06 pu and V3 = 1.00 − j0.05 pu.
  const lines3 = [
    { i: 0, k: 1, z: C(0.02, 0.04) },
    { i: 0, k: 2, z: C(0.01, 0.03) },
    { i: 1, k: 2, z: C(0.0125, 0.025) },
  ]
  it('Saadat 6.7 (three PQ/slack buses): exact constructed solution', () => {
    const Y = ybusFromImpedances(3, lines3)
    const r = solveLoadFlow(Y, [
      { type: 'slack', p: 0, q: 0, v: 1.05 },
      { type: 'pq', p: -2.566, q: -1.102, v: 1 },
      { type: 'pq', p: -1.386, q: -0.452, v: 1 },
    ])
    expect(r.converged).toBe(true)
    expect(abs(sub(r.V[1], C(0.98, -0.06)))).toBeLessThan(1e-4)
    expect(abs(sub(r.V[2], C(1.0, -0.05)))).toBeLessThan(1e-4)
    // slack: S1 = 409.5 + j189 MW/Mvar (Saadat: 4.095 + j1.890 pu)
    expect(r.S[0].re).toBeCloseTo(4.095, 2)
    expect(r.S[0].im).toBeCloseTo(1.89, 2)
  })

  it('Saadat 6.10 (PV bus): V2, θ3, slack power and Q3 as published; independent residuals ≈ 0', () => {
    // bus 2: load 400 + j250; bus 3: PV, |V| = 1.04, generates 200 MW
    const Y = ybusFromImpedances(3, lines3)
    const buses: LfBus[] = [
      { type: 'slack', p: 0, q: 0, v: 1.05 },
      { type: 'pq', p: -4, q: -2.5, v: 1 },
      { type: 'pv', p: 2, q: 0, v: 1.04 },
    ]
    const r = solveLoadFlow(Y, buses)
    expect(r.converged).toBe(true)
    expect(r.iterations).toBeLessThanOrEqual(6)
    expect(abs(r.V[1])).toBeCloseTo(0.971684, 5)
    expect(deg(arg(r.V[1]))).toBeCloseTo(-2.696, 2)
    expect(abs(r.V[2])).toBeCloseTo(1.04, 12)
    expect(deg(arg(r.V[2]))).toBeCloseTo(-0.4988, 3)
    expect(r.S[0].re * 100).toBeCloseTo(218.423, 1)
    expect(r.S[0].im * 100).toBeCloseTo(140.852, 1)
    expect(r.S[2].im * 100).toBeCloseTo(146.177, 1)
    // residuals from S = V·conj(Y·V), computed independently
    const S = injections(Y, r.V)
    expect(Math.abs(S[1].re + 4)).toBeLessThan(1e-8)
    expect(Math.abs(S[1].im + 2.5)).toBeLessThan(1e-8)
    expect(Math.abs(S[2].re - 2)).toBeLessThan(1e-8)
    // quadratic convergence: each mismatch is far smaller than the previous one near the solution
    const h = r.history
    expect(h[h.length - 1]).toBeLessThan(1e-8)
    expect(h[h.length - 2]).toBeLessThan(1e-3)
  })

  it('a PV bus that would exceed its reactive limit is held at the limit (voltage falls below its set-point)', () => {
    const Y = ybusFromImpedances(3, lines3)
    const r = solveLoadFlow(Y, [
      { type: 'slack', p: 0, q: 0, v: 1.05 },
      { type: 'pq', p: -4, q: -2.5, v: 1 },
      { type: 'pv', p: 2, q: 0, v: 1.04, qMax: 1.0 },
    ])
    expect(r.converged).toBe(true)
    expect(r.qLimited).toEqual([2])
    expect(r.S[2].im).toBeCloseTo(1.0, 8)
    expect(abs(r.V[2])).toBeLessThan(1.04)
  })

  it('a radial feeder: agrees with an independent backward/forward sweep', () => {
    const z = [C(0.01, 0.03), C(0.02, 0.04), C(0.015, 0.05)]
    const load = [C(0.5, 0.2), C(0.4, 0.15), C(0.3, 0.1)] // drawn at buses 1..3
    const Y = ybusFromImpedances(
      4,
      z.map((zz, j) => ({ i: j, k: j + 1, z: zz })),
    )
    const r = solveLoadFlow(Y, [{ type: 'slack', p: 0, q: 0, v: 1 }, ...load.map((s) => ({ type: 'pq' as const, p: -s.re, q: -s.im, v: 1 }))])
    // sweep: branch j carries the load currents of every bus beyond it
    let V = [C(1), C(1), C(1), C(1)]
    for (let it = 0; it < 100; it++) {
      const I = load.map((s, j) => conj(div(s, V[j + 1])))
      const Ib = I.map((_, j) => I.slice(j).reduce(add, ZERO))
      const next = [C(1)]
      for (let j = 0; j < 3; j++) next.push(sub(next[j], mul(z[j], Ib[j])))
      V = next
    }
    for (let j = 1; j < 4; j++) expect(abs(sub(r.V[j], V[j]))).toBeLessThan(1e-9)
  })

  it('reports a load that the network cannot carry instead of inventing an answer', () => {
    const Y = ybusFromImpedances(2, [{ i: 0, k: 1, z: C(0, 0.5) }])
    const r = solveLoadFlow(Y, [
      { type: 'slack', p: 0, q: 0, v: 1 },
      { type: 'pq', p: -3, q: -1, v: 1 },
    ])
    expect(r.converged).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('Network solution — the Grid Explorer network', () => {
  it('is valid, converges, and its voltages are within normal operating limits', () => {
    const net = gridNetwork()
    expect(validate(net)).toEqual([])
    const s = solveNetwork(net)
    expect(s.ok).toBe(true)
    expect(s.islands).toHaveLength(1)
    for (const b of Object.values(s.bus)) {
      expect(b.energized).toBe(true)
      expect(b.vPu).toBeGreaterThan(0.95)
      expect(b.vPu).toBeLessThan(1.05)
    }
    // angles lag further from the source
    const order = ['gen', 'hvA', 'hvB', 'mvA', 'mvB', 'lv']
    for (let i = 1; i < order.length; i++) expect(s.bus[order[i]].angDeg).toBeLessThan(s.bus[order[i - 1]].angDeg)
  })
  it('conserves power: generation = load + losses; each branch loss = sum of its end flows', () => {
    const s = solveNetwork(gridNetwork())
    const t = s.totals
    expect(t.genMw).toBeCloseTo(t.loadMw + t.lossMw, 6)
    expect(t.genMvar).toBeCloseTo(t.loadMvar + t.lossMvar, 6)
    expect(t.loadMw).toBe(28)
    expect(t.lossMw).toBeGreaterThan(0)
    expect(t.lossMw / t.genMw).toBeLessThan(0.05)
    for (const b of Object.values(s.branch)) {
      expect(b.lossMw).toBeGreaterThanOrEqual(0)
      expect(b.lossMw).toBeCloseTo(b.pFromMw + b.pToMw, 12)
    }
    // a long 220 kV line at light load generates reactive power (charging exceeds I²X)
    expect(s.branch.L1.lossMvar).toBeLessThan(0)
  })
  it('currents follow I = S/(√3·V): the same power is a much smaller current at a higher voltage', () => {
    const s = solveNetwork(gridNetwork())
    const T3 = s.branch.T3
    const sFrom = Math.hypot(T3.pFromMw, T3.qFromMvar)
    expect(T3.iFromKa).toBeCloseTo(sFrom / (Math.sqrt(3) * s.bus.mvB.kv), 9)
    expect(s.branch.L1.iFromKa).toBeLessThan(s.branch.T3.iToKa / 5)
  })
  it('the independent residuals of the whole network are zero', () => {
    const net = gridNetwork()
    const s = solveNetwork(net)
    const ids = net.buses.map((b) => b.id)
    const Y = buildYbus(net, ids)
    const V = ids.map((id) => polarDeg(s.bus[id].vPu, s.bus[id].angDeg))
    const S = injections(Y, V)
    const spec: Record<string, Complex> = {
      mvA: C(-0.12, -0.0744),
      lv: C(-0.16, -0.0526),
    }
    for (const [id, want] of Object.entries(spec)) expect(abs(sub(S[ids.indexOf(id)], want))).toBeLessThan(1e-8)
    for (const id of ['hvA', 'hvB', 'mvB']) expect(abs(S[ids.indexOf(id)])).toBeLessThan(1e-8)
  })
})

describe('Topology, breakers and islands', () => {
  const withOpen = (id: string) => {
    const net = gridNetwork()
    const cb = net.components.find((c) => c.id === id)
    if (cb?.kind === 'breaker') cb.closed = false
    return net
  }
  it('opening the transmission line breaker islands everything downstream — de-energised, not solved', () => {
    const net = withOpen('CB1')
    expect(islands(net)).toHaveLength(2)
    const s = solveNetwork(net)
    expect(s.ok).toBe(true)
    for (const id of ['hvB', 'mvA', 'mvB', 'lv']) expect(s.bus[id].energized).toBe(false)
    expect(s.bus.hvA.energized).toBe(true)
    expect(s.load.town.served).toBe(false)
    expect(s.totals.unservedMw).toBe(28)
    expect(s.totals.genMw).toBeCloseTo(0, 9)
    expect(s.branch.L1.inService).toBe(false)
  })
  it('opening a load breaker drops only that load', () => {
    const s = solveNetwork(withOpen('CB3'))
    expect(s.load.factory.served).toBe(false)
    expect(s.load.town.served).toBe(true)
    expect(s.totals.loadMw).toBe(16)
    expect(s.totals.genMw).toBeCloseTo(s.totals.loadMw + s.totals.lossMw, 6)
  })
  it('validation catches structural errors', () => {
    const net = gridNetwork()
    const L2 = net.components.find((c) => c.id === 'L2')
    if (L2?.kind === 'line') L2.to = 'lv' // 33 kV line into an 11 kV bus
    net.components = net.components.filter((c) => c.kind !== 'generator')
    const issues = validate(net)
    expect(issues.some((i) => i.at === 'L2' && /different voltage levels/.test(i.text))).toBe(true)
    expect(issues.some((i) => /no source/i.test(i.text))).toBe(true)
    expect(solveNetwork(net).ok).toBe(false)
  })
})
