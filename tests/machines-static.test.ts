import { describe, expect, it } from 'vitest'
import { autotransformer, gappedInductor, K_EMF, lineVoltage, MU0, phaseCurrent, phaseVoltage, singlePhaseTransformer, SQRT3, threePhaseTransformer } from '../src/machines/calculations/static.ts'
import { MODEL_LOADERS } from '../src/machines/models/index.ts'

describe('static devices: single-phase transformer', () => {
  it('turns ratio, currents, power balance, referred load', () => {
    const t = singlePhaseTransformer({ v1: 230, f: 50, n1: 920, n2: 96, rl: 4.8, ae: 10e-4 })!
    expect(t.a).toBeCloseTo(920 / 96, 12)
    expect(t.v2).toBeCloseTo(24, 12) // 230·96/920
    expect(t.i2).toBeCloseTo(5, 12)
    expect(t.i1).toBeCloseTo(5 * (96 / 920), 12)
    expect(230 * t.i1).toBeCloseTo(t.v2 * t.i2, 10) // P1 = P2 (ideal)
    expect(t.s).toBeCloseTo(120, 10)
    expect(t.mmf1).toBeCloseTo(t.mmf2, 10) // N1·I1 = N2·I2
    expect(t.rSeen).toBeCloseTo(4.8 * (920 / 96) ** 2, 9)
    expect(230 / t.rSeen).toBeCloseTo(t.i1, 12) // the source sees a²·RL
    expect(t.voltsPerTurn).toBeCloseTo(230 / 920, 12)
  })
  it('EMF equation: V1 = 4.44·f·N1·Φm, Bm = Φm/Ae', () => {
    expect(K_EMF).toBeCloseTo(4.4429, 4)
    const t = singlePhaseTransformer({ v1: 230, f: 50, n1: 920, n2: 96, rl: 4.8, ae: 10e-4 })!
    expect(K_EMF * 50 * 920 * t.phiM).toBeCloseTo(230, 9)
    expect(t.bm).toBeCloseTo(t.phiM / 10e-4, 12)
    expect(t.bm).toBeCloseTo(1.1257, 3)
    // halving the frequency at the same voltage doubles the flux (the V/f limit)
    const lowF = singlePhaseTransformer({ v1: 230, f: 25, n1: 920, n2: 96, rl: 4.8, ae: 10e-4 })!
    expect(lowF.bm).toBeCloseTo(2 * t.bm, 10)
    // the flux does not depend on the load (ideal model)
    const heavy = singlePhaseTransformer({ v1: 230, f: 50, n1: 920, n2: 96, rl: 0.5, ae: 10e-4 })!
    expect(heavy.phiM).toBeCloseTo(t.phiM, 15)
  })
  it('invalid inputs give null', () => {
    expect(singlePhaseTransformer({ v1: 230, f: 0, n1: 920, n2: 96, rl: 4.8, ae: 1e-3 })).toBeNull()
    expect(singlePhaseTransformer({ v1: 230, f: 50, n1: 920, n2: 96, rl: 0, ae: 1e-3 })).toBeNull()
    expect(singlePhaseTransformer({ v1: 230, f: 50, n1: 0, n2: 96, rl: 4, ae: 1e-3 })).toBeNull()
  })
})

describe('static devices: three-phase transformer', () => {
  it('star and delta line/phase relations', () => {
    expect(phaseVoltage(400, 'Y')).toBeCloseTo(230.94, 2)
    expect(phaseVoltage(400, 'D')).toBe(400)
    expect(lineVoltage(230, 'Y')).toBeCloseTo(398.37, 2)
    expect(lineVoltage(230, 'D')).toBe(230)
    expect(phaseCurrent(10, 'Y')).toBe(10)
    expect(phaseCurrent(10 * SQRT3, 'D')).toBeCloseTo(10, 12)
  })
  it('Dy distribution transformer: 11 kV delta / 433 V star', () => {
    const t = threePhaseTransformer({ vl1: 11000, n1: 2200, n2: 50, c1: 'D', c2: 'Y', s: 250e3 })!
    expect(t.vph1).toBe(11000)
    expect(t.vph2).toBeCloseTo(250, 9)
    expect(t.vl2).toBeCloseTo(433.01, 2)
    expect(t.lineRatio).toBeCloseTo(11000 / (250 * SQRT3), 9)
    expect(t.shiftDeg).toBe(30)
    // S = √3·VL·IL = 3·Vph·Iph on each side
    expect(SQRT3 * 11000 * t.il1).toBeCloseTo(250e3, 6)
    expect(3 * t.vph1 * t.iph1).toBeCloseTo(250e3, 6)
    expect(3 * t.vph2 * t.iph2).toBeCloseTo(250e3, 6)
    expect(t.iph1).toBeCloseTo(t.il1 / SQRT3, 12)
    expect(t.iph2).toBeCloseTo(t.il2, 12)
    // per limb, ampere-turns balance: N1·Iph1 = N2·Iph2
    expect(2200 * t.iph1).toBeCloseTo(50 * t.iph2, 6)
  })
  it('Yy and Dd: line ratio = turns ratio, no phase shift; Yd changes the line ratio by √3', () => {
    const yy = threePhaseTransformer({ vl1: 400, n1: 200, n2: 100, c1: 'Y', c2: 'Y', s: 1000 })!
    expect(yy.lineRatio).toBeCloseTo(2, 12)
    expect(yy.shiftDeg).toBe(0)
    const dd = threePhaseTransformer({ vl1: 400, n1: 200, n2: 100, c1: 'D', c2: 'D', s: 1000 })!
    expect(dd.lineRatio).toBeCloseTo(2, 12)
    const yd = threePhaseTransformer({ vl1: 400, n1: 200, n2: 100, c1: 'Y', c2: 'D', s: 1000 })!
    expect(yd.lineRatio).toBeCloseTo(2 * SQRT3, 12)
    expect(yd.shiftDeg).toBe(30)
    expect(threePhaseTransformer({ vl1: 400, n1: 0, n2: 100, c1: 'Y', c2: 'D', s: 1000 })).toBeNull()
    expect(threePhaseTransformer({ vl1: 400, n1: 200, n2: 100, c1: 'Y', c2: 'Y', s: 0 })!.il1).toBe(0)
  })
})

describe('static devices: autotransformer', () => {
  it('power split S_t = S·(1 − V2/V1), S_c = S·V2/V1; KCL at the tap; ampere-turn balance', () => {
    const a = autotransformer({ v1: 230, n1: 400, n2: 300, rl: 10 })!
    expect(a.k).toBeCloseTo(0.75, 12)
    expect(a.v2).toBeCloseTo(172.5, 12)
    expect(a.i2).toBeCloseTo(17.25, 12)
    expect(a.i1).toBeCloseTo(12.9375, 12)
    expect(a.i1 + a.ic).toBeCloseTo(a.i2, 12)
    expect(230 * a.i1).toBeCloseTo(a.s, 9) // input = output (ideal)
    expect(a.sTransformed).toBeCloseTo(a.s * (1 - 172.5 / 230), 9)
    expect(a.sTransformed + a.sConducted).toBeCloseTo(a.s, 9)
    // the transformed power is what passes through each section: (V1 − V2)·I1 = V2·Ic
    expect((230 - a.v2) * a.i1).toBeCloseTo(a.sTransformed, 9)
    expect(a.v2 * a.ic).toBeCloseTo(a.sTransformed, 9)
    expect(a.mmfSeries).toBeCloseTo(a.mmfCommon, 9)
    expect(a.copperRatio).toBeCloseTo(0.25, 12)
  })
  it('limits: k = 1 transforms nothing; a small k transforms almost all; tap outside the winding is null', () => {
    const full = autotransformer({ v1: 230, n1: 400, n2: 400, rl: 10 })!
    expect(full.sTransformed).toBeCloseTo(0, 12)
    expect(full.ic).toBeCloseTo(0, 12)
    const low = autotransformer({ v1: 230, n1: 400, n2: 20, rl: 10 })!
    expect(low.sTransformed / low.s).toBeCloseTo(0.95, 12)
    expect(autotransformer({ v1: 230, n1: 400, n2: 401, rl: 10 })).toBeNull()
    expect(autotransformer({ v1: 230, n1: 400, n2: 200, rl: 0 })).toBeNull()
  })
})

describe('static devices: gapped inductor', () => {
  const base = { n: 20, ae: 100e-6, le: 0.06, lg: 0.5e-3, mur: 2000, i: 5, bsat: 0.35 }
  it('L = N²·μ0·Ae/(lg + le/μr) = N²/ℛ; W = ½LI²; B = μ0NI/(lg + le/μr)', () => {
    const r = gappedInductor(base)!
    const lEff = 0.5e-3 + 0.06 / 2000
    expect(r.rel).toBeCloseTo(lEff / (MU0 * 100e-6), 3)
    expect(r.l).toBeCloseTo((400 * MU0 * 100e-6) / lEff, 15)
    expect(r.l).toBeCloseTo(400 / r.rel, 15)
    expect(r.l * 1e6).toBeCloseTo(94.84, 2) // 400·μ0·1e-4 / 0.53e-3
    expect(r.w!).toBeCloseTo(0.5 * r.l * 25, 15)
    expect(r.b).toBeCloseTo((MU0 * 20 * 5) / lEff, 12)
    // flux linkage N·Φ = N·B·Ae equals L·I
    expect(20 * r.b * 100e-6).toBeCloseTo(r.l * 5, 15)
    expect(r.gapShare).toBeCloseTo(0.5 / 0.53, 12)
    expect(r.saturated).toBe(false)
    expect(r.isat).toBeCloseTo((0.35 * lEff) / (MU0 * 20), 12)
  })
  it('energy in the gap and in the core add up: W = ∫B²/2μ dV', () => {
    const r = gappedInductor(base)!
    const wGap = ((r.b * r.b) / (2 * MU0)) * 100e-6 * 0.5e-3
    const wCore = ((r.b * r.b) / (2 * MU0 * 2000)) * 100e-6 * 0.06
    expect(wGap + wCore).toBeCloseTo(r.w!, 12)
    expect(wGap / r.w!).toBeCloseTo(r.gapShare, 12)
  })
  it('a gap lowers L but raises the saturation current; ungapped core; above Isat → no linear energy', () => {
    const gapped = gappedInductor(base)!
    const noGap = gappedInductor({ ...base, lg: 0 })!
    expect(noGap.l).toBeCloseTo(gapped.lNoGap, 15)
    expect(noGap.l).toBeGreaterThan(gapped.l)
    expect(noGap.isat).toBeLessThan(gapped.isat)
    expect(noGap.gapShare).toBe(0)
    const sat = gappedInductor({ ...base, i: 10 })!
    expect(sat.saturated).toBe(true)
    expect(sat.w).toBeNull()
    expect(gappedInductor({ ...base, n: 0 })).toBeNull()
    expect(gappedInductor({ ...base, lg: -1e-3 })).toBeNull()
  })
})

describe('static devices: models', () => {
  const ids = ['transformer', 'transformer-3ph', 'autotransformer', 'inductor']
  it('every static model loads and its calc is finite or null at the defaults and every parameter limit', async () => {
    for (const id of ids) {
      const def = (await MODEL_LOADERS[id]()).default
      expect(def.id).toBe(id)
      const d = Object.fromEntries(def.params.map((p) => [p.id, p.value]))
      const sets = [d, ...def.params.flatMap((p) => [{ ...d, [p.id]: p.options ? p.options[0] : p.min }, { ...d, [p.id]: p.options ? p.options[p.options.length - 1] : p.max }])]
      for (const s of sets) for (const c of def.calc(s)) expect(c.value === null || Number.isFinite(c.value), `${id} ${c.id}`).toBe(true)
      const m = def.motion?.(Object.fromEntries(def.calc(d).map((c) => [c.id, c.value])), d)
      if (m) expect(Number.isFinite(m.omega)).toBe(true)
      // steps: focus parts exist; layers exist
      const partIds = new Set(def.parts.map((p) => p.id))
      for (const st of def.steps) {
        for (const f of st.focus) expect(partIds.has(f), `${id} ${st.id} ${f}`).toBe(true)
        for (const l of st.layers) expect(def.layers.some((x) => x.id === l)).toBe(true)
      }
    }
  })
})
