import { describe, expect, it } from 'vitest'
import { branchPu, iBaseKa, zBaseOhm } from '../src/powersys/network/perunit.ts'
import { isBranch, type Network } from '../src/powersys/network/types.ts'
import { gridNetwork } from '../src/powersys/modules/grid/network.ts'
import {
  baseVoltages,
  buildModel,
  changeBase,
  compOf,
  faultOhms,
  faultPerUnit,
  iBase,
  networkBase,
  rebased,
  relDiff,
  transformerSides,
  zBase,
  zones,
  type BaseChoice,
} from '../src/powersys/modules/per-unit/calc.ts'
import { EXPERIMENTS, runExperiment } from '../src/powersys/modules/per-unit/experiments.ts'
import { conversion, ELEMENT_ORDER } from '../src/powersys/modules/per-unit/steps.ts'

/*
 * Validation of Module 3 (per unit). No published reference numbers are used other than the elementary
 * hand-computable base quantities; everything else is checked by independent routes: the shared engine's branchPu,
 * base-change round trips, the transformer-seen-from-both-sides identity, and the same physical answer (a bolted
 * fault current) computed in ohms through the turns ratios and in per unit on several different bases.
 */

const net = gridNetwork()
const A = networkBase(net)
const CHOICES: BaseChoice[] = [
  A,
  { sMva: 250, refBus: 'hvA', vRefKv: 230, follow: 'nominal' },
  { sMva: 10, refBus: 'gen', vRefKv: 13.8, follow: 'nominal' },
  { sMva: 37, refBus: 'lv', vRefKv: 11.5, follow: 'nominal' },
  { sMva: 100, refBus: 'gen', vRefKv: 13.8, follow: 'rated' },
  { sMva: 1000, refBus: 'mvB', vRefKv: 34, follow: 'rated' },
]
const close = (a: number, b: number, rel = 1e-12) => expect(relDiff(a, b), `${a} vs ${b}`).toBeLessThanOrEqual(rel)

describe('Base quantities (hand-computed)', () => {
  it('220 kV, 100 MVA: Z_base = 484 Ω, I_base = 0.2624 kA', () => {
    expect(zBase(220, 100)).toBeCloseTo(484, 12)
    expect(iBase(220, 100)).toBeCloseTo(100 / (Math.sqrt(3) * 220), 14)
    expect(iBase(220, 100)).toBeCloseTo(0.2624, 4)
  })
  it('33 kV → 10.89 Ω and 11 kV → 1.21 Ω on 100 MVA; 13.8 kV → 4.1837 kA', () => {
    expect(zBase(33, 100)).toBeCloseTo(10.89, 12)
    expect(zBase(11, 100)).toBeCloseTo(1.21, 12)
    expect(iBase(13.8, 100)).toBeCloseTo(4.1837, 4)
  })
  it('agree with the shared engine for any voltage and power', () => {
    for (const kv of [0.4, 11, 13.8, 33, 132, 220, 400])
      for (const mva of [1, 10, 100, 1000]) {
        close(zBase(kv, mva), zBaseOhm(kv, mva))
        close(iBase(kv, mva), iBaseKa(kv, mva))
      }
  })
  it('S_base = √3 · V_base · I_base and Z_base = V_base / (√3 · I_base) in every zone', () => {
    for (const c of CHOICES)
      for (const z of zones(net, c)) {
        close(Math.sqrt(3) * z.vBaseKv * z.iBaseKa, c.sMva)
        close(z.vBaseKv / (Math.sqrt(3) * z.iBaseKa), z.zBaseOhm)
      }
  })
})

describe('Zones and base voltages', () => {
  it('the Grid Explorer network has four zones; on its own base they are its nominal voltages', () => {
    const zs = zones(net, A)
    expect(zs.map((z) => z.buses)).toEqual([['gen'], ['hvA', 'hvB'], ['mvA', 'mvB'], ['lv']])
    expect(zs.map((z) => z.vBaseKv)).toEqual([13.8, 220, 33, 11])
    expect(A).toEqual({ sMva: 100, refBus: 'hvA', vRefKv: 220, follow: 'nominal' })
  })
  it('choosing V_base in one zone fixes every zone through the transformer ratios', () => {
    const vb = baseVoltages(net, { sMva: 100, refBus: 'hvA', vRefKv: 230, follow: 'nominal' })
    close(vb.gen, (13.8 * 230) / 220)
    close(vb.mvA, (33 * 230) / 220)
    close(vb.lv, (11 * 230) / 220)
    expect(vb.hvB).toBe(230)
    // rated rule: across T2 (220/34.65 kV) and T3 (31.35/11 kV) the bases follow the rated windings
    const vr = baseVoltages(net, { sMva: 100, refBus: 'gen', vRefKv: 13.8, follow: 'rated' })
    close(vr.hvA, 220)
    close(vr.mvA, 34.65)
    close(vr.lv, (34.65 * 11) / 31.35)
  })
  it('the bases do not depend on which zone is the reference, if they are consistent', () => {
    const vb = baseVoltages(net, A)
    for (const b of net.buses) {
      const again = baseVoltages(net, { ...A, refBus: b.id, vRefKv: vb[b.id] })
      for (const x of net.buses) close(again[x.id], vb[x.id])
    }
  })
})

describe('Change of base', () => {
  it('round trips: there and back gives the original value', () => {
    for (const z of [0.05, 0.1, 0.2])
      for (const [s1, v1, s2, v2] of [
        [120, 13.8, 100, 13.8],
        [60, 34.65, 100, 33],
        [20, 11, 250, 11.5],
      ]) {
        close(changeBase(changeBase(z, s1, v1, s2, v2), s2, v2, s1, v1), z)
        // via a third base
        close(changeBase(changeBase(z, s1, v1, 7, 9), 7, 9, s2, v2), changeBase(z, s1, v1, s2, v2))
      }
  })
  it('the same ohms: a per-unit value times its Z_base is unchanged by a change of base', () => {
    const z = 0.08
    const zNew = changeBase(z, 20, 11, 100, 11.5)
    close(z * zBase(11, 20), zNew * zBase(11.5, 100))
  })
  it('hand values: T3 8 % on 20 MVA → 0.40 pu on 100 MVA; T2 10 % on 60 MVA at 34.65 kV → 0.18375 pu at 33 kV', () => {
    expect(changeBase(0.08, 20, 11, 100, 11)).toBeCloseTo(0.4, 14)
    expect(changeBase(0.1, 60, 34.65, 100, 33)).toBeCloseTo(0.18375, 12)
    expect(changeBase(0.2, 120, 13.8, 100, 13.8)).toBeCloseTo(1 / 6, 14)
  })
})

describe('Agreement with the shared engine (network/perunit.ts branchPu)', () => {
  it('every branch of the Grid Explorer network, on its own base', () => {
    const m = buildModel(net, A)
    for (const c of net.components.filter(isBranch)) {
      const e = branchPu(net, c)
      const mine = c.kind === 'line' ? { z: m.line[c.id].z, tap: 1, yHalf: m.line[c.id].bHalfPu } : { z: m.tx[c.id].z, tap: m.tx[c.id].tap, yHalf: 0 }
      close(mine.z.re, e.z.re, 1e-12)
      close(mine.z.im, e.z.im, 1e-12)
      close(mine.tap, e.tap, 1e-12)
      close(mine.yHalf, e.yHalf.im, 1e-12)
    }
  })
  it('every branch, on every other base (the chosen bases written into the network as the engine reads them)', () => {
    for (const c of CHOICES) {
      const m = buildModel(net, c)
      const rn = rebased(net, c)
      for (const b of rn.components.filter(isBranch)) {
        const e = branchPu(rn, b)
        if (b.kind === 'line') {
          close(m.line[b.id].z.re, e.z.re)
          close(m.line[b.id].z.im, e.z.im)
          close(m.line[b.id].bHalfPu, e.yHalf.im)
        } else {
          close(m.tx[b.id].z.re, e.z.re)
          close(m.tx[b.id].z.im, e.z.im)
          close(m.tx[b.id].tap, e.tap)
        }
      }
    }
  })
  it('the conversion shown step by step on the page is the same number', () => {
    for (const c of CHOICES) {
      const rn = rebased(net, c)
      for (const id of ELEMENT_ORDER) {
        const cv = conversion(net, c, id)
        const comp = rn.components.find((x) => x.id === id)!
        if (isBranch(comp)) {
          close(cv.z!.re, branchPu(rn, comp).z.re)
          close(cv.z!.im, branchPu(rn, comp).z.im)
        }
      }
    }
  })
  it('hand values on 100 MVA: L1 = (7.2 + j49.2) Ω / 484 Ω; T3 |z| = 0.40; T2 tap = 1/1.05; T3 tap = 0.95', () => {
    const m = buildModel(net, A)
    close(m.line.L1.z.re, 7.2 / 484)
    close(m.line.L1.z.im, 49.2 / 484)
    close(Math.hypot(m.tx.T3.z.re, m.tx.T3.z.im), 0.4)
    close(Math.hypot(m.tx.T1.z.re, m.tx.T1.z.im), 0.1)
    close(m.tx.T2.tap, 1 / 1.05)
    close(m.tx.T3.tap, 0.95)
    close(m.tx.T1.tap, 1)
    close(m.gen.G1.x, 0.2 * (100 / 120))
  })
  it('with the bases following the rated ratios every off-nominal ratio is 1', () => {
    const m = buildModel(net, { sMva: 100, refBus: 'hvA', vRefKv: 220, follow: 'rated' })
    for (const t of Object.values(m.tx)) close(t.tap, 1)
    // and T2 is then just its nameplate on 100 MVA
    close(Math.hypot(m.tx.T2.z.re, m.tx.T2.z.im), 0.1 * (100 / 60))
  })
})

describe('A transformer’s per-unit impedance is the same from either side', () => {
  it('T1 (ratio = base ratio): ohms differ by (220/13.8)², per unit is identical', () => {
    for (const c of CHOICES.filter((x) => x.follow === 'nominal')) {
      const s = transformerSides(compOf(net, 'T1', 'transformer'), c.sMva, baseVoltages(net, c))
      close(s.from.ohm.im / s.to.ohm.im, (220 / 13.8) ** 2)
      close(s.from.pu.re, s.to.pu.re)
      close(s.from.pu.im, s.to.pu.im)
      expect(s.tap).toBeCloseTo(1, 14)
    }
    const s = transformerSides(compOf(net, 'T1', 'transformer'), 100, baseVoltages(net, A))
    expect(Math.hypot(s.from.ohm.re, s.from.ohm.im)).toBeCloseTo(48.4, 10)
    expect(Math.hypot(s.to.ohm.re, s.to.ohm.im)).toBeCloseTo(0.19044, 10)
  })
  it('every transformer on every base: pu(from side) = t² · pu(to side), equal whenever t = 1', () => {
    for (const c of CHOICES) {
      const vb = baseVoltages(net, c)
      for (const id of ['T1', 'T2', 'T3']) {
        const s = transformerSides(compOf(net, id, 'transformer'), c.sMva, vb)
        close(s.from.pu.im, s.tap * s.tap * s.to.pu.im)
        close(s.from.pu.re, s.tap * s.tap * s.to.pu.re)
        if (c.follow === 'rated') close(s.from.pu.im, s.to.pu.im)
      }
    }
  })
})

describe('Base invariance: a bolted three-phase fault in ohms and in per unit', () => {
  const buses = ['gen', 'hvA', 'hvB', 'mvA', 'mvB', 'lv']
  it('the same fault current in kA from ohms and from per unit on six different bases (within 1e-9)', () => {
    for (const b of buses) {
      const o = faultOhms(net, b)
      for (const c of CHOICES) {
        const p = faultPerUnit(net, b, c)
        expect(relDiff(p.iKa, o.i), `${b} ${JSON.stringify(c)}`).toBeLessThan(1e-9)
        expect(relDiff(p.eKv, o.e)).toBeLessThan(1e-9)
        // the per-unit total reactance times the fault bus's Z_base is the ohmic total
        expect(relDiff(p.x * zBase(p.vBaseKv, c.sMva), o.x)).toBeLessThan(1e-9)
        // and every term, referred to the faulted bus
        p.terms.forEach((t, k) => expect(relDiff(t.referred * zBase(p.vBaseKv, c.sMva), o.terms[k].referred)).toBeLessThan(1e-9))
      }
    }
  })
  it('hand check at the 220 kV end of L1 (no off-nominal ratio on the way)', () => {
    // X in Ω referred to 220 kV: G1 0.2 × 13.8²/120 × (220/13.8)², T1 X on 220 kV, L1 0.41 × 120
    const xr = 40
    const xT1 = (0.12 * xr) / Math.sqrt(1 + xr * xr)
    const xOhm = (0.2 * (220 * 220)) / 120 + (xT1 * 220 * 220) / 120 + 0.41 * 120
    const iKa = 220 / (Math.sqrt(3) * xOhm)
    close(faultOhms(net, 'hvB').i, iKa, 1e-12)
    // in pu on 100 MVA: 1 / (0.2·100/120 + T1 + L1)
    const xPu = 0.2 * (100 / 120) + (xT1 * 100) / 120 + (0.41 * 120) / 484
    close(faultPerUnit(net, 'hvB', A).i, 1 / xPu, 1e-12)
    close(faultPerUnit(net, 'hvB', A).iKa, iKa, 1e-12)
  })
  it('the per-unit numbers DO change with the base, the physical answer does not', () => {
    const a = faultPerUnit(net, 'lv', A)
    const b = faultPerUnit(net, 'lv', CHOICES[1])
    expect(relDiff(a.i, b.i)).toBeGreaterThan(0.1)
    expect(relDiff(a.x, b.x)).toBeGreaterThan(0.1)
    expect(relDiff(a.iKa, b.iKa)).toBeLessThan(1e-12)
  })
  it('the generator EMF scales the fault current linearly', () => {
    close(faultOhms(net, 'mvB', 1.1).i, 1.1 * faultOhms(net, 'mvB', 1).i)
  })
})

describe('Experiments: answers come from the computed numbers', () => {
  it('each experiment yields an answer among its options and finite rows', () => {
    for (const e of EXPERIMENTS) {
      const r = runExperiment(e, net)
      expect(e.options(net).map((o) => o.id)).toContain(r.answer)
      for (const row of r.rows) for (const v of row.values) expect(Number.isFinite(v), `${e.id} ${row.label}`).toBe(true)
      expect(r.explain.length).toBeGreaterThan(0)
    }
  })
  it('the expected physics', () => {
    const ans = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, runExperiment(e, net).answer]))
    expect(ans).toEqual({ smva: 'double', vbase: 'follow', sides: 'same', nameplate: '40', fault: 'same', tap: 'one' })
  })
})

describe('the module works for another network too (not tied to the Grid Explorer data)', () => {
  it('a two-bus generator–transformer–line system', () => {
    const n: Network = {
      id: 't',
      name: 't',
      baseMva: 50,
      fHz: 50,
      buses: [
        { id: 'a', name: 'a', kv: 11, x: 0, y: 0 },
        { id: 'b', name: 'b', kv: 132, x: 0, y: 0 },
        { id: 'c', name: 'c', kv: 132, x: 0, y: 0 },
      ],
      components: [
        { kind: 'generator', id: 'G', name: 'G', bus: 'a', mode: 'slack', vPu: 1, ratedMva: 40, x1Pu: 0.15 },
        { kind: 'transformer', id: 'T', name: 'T', from: 'b', to: 'a', ratedMva: 45, kvFrom: 132, kvTo: 11, zPct: 9, xr: 20 },
        { kind: 'line', id: 'L', name: 'L', from: 'b', to: 'c', lengthKm: 60, rOhmPerKm: 0.1, xOhmPerKm: 0.4, bUsPerKm: 2.9 },
      ],
    }
    const o = faultOhms(n, 'c')
    for (const c of [networkBase(n), { sMva: 7, refBus: 'a', vRefKv: 10, follow: 'nominal' as const }]) expect(relDiff(faultPerUnit(n, 'c', c).iKa, o.i)).toBeLessThan(1e-9)
  })
})
