import { describe, expect, it } from 'vitest'
import { breakdown as drivesBreakdown, eqCircuit } from '../src/converters/drives/inductionTheory.ts'
import {
  imBreakdown,
  imOperating,
  imPoint,
  IM_EXAMPLE,
  rotorFreq,
  rotorRpm,
  slipOf,
  spOperating,
  spPeak,
  spPoint,
  SPIM_EXAMPLE,
  syncRad,
  syncRpm,
  vPhaseVf,
} from '../src/machines/calculations/induction.ts'
import { imCalc, imMotion, IM_PARAMS, IM_STEPS } from '../src/machines/models/inductionMotor/content.ts'
import { barCurrent, barForce, BELTS_1PH, BELTS_3PH, gapField, sheetFundamental, windingLayout } from '../src/machines/models/inductionMotor/layout.ts'
import { spCalc, SP_PARAMS } from '../src/machines/models/inductionMotor/singlePhase/content.ts'
import { wrCalc, WR_PARAMS } from '../src/machines/models/inductionMotor/woundRotor/content.ts'

const M = IM_EXAMPLE
const V = vPhaseVf(50)
const drivesMachine = { rs: M.r1, rr: M.r2, lls: M.l1, llr: M.l2, lm: M.lm, pp: 2, b: 0 }
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b))
const defaults = (ps: { id: string; value: number }[]) => Object.fromEntries(ps.map((p) => [p.id, p.value]))
const val = (rows: { id: string; value: number | null }[], id: string) => rows.find((r) => r.id === id)!.value

describe('induction: basic relations', () => {
  it('Ns = 120 f / P, slip, Nr = (1 − s) Ns, f2 = s f, ωs = 2π Ns / 60', () => {
    expect(syncRpm(50, 4)).toBe(1500)
    expect(syncRpm(50, 6)).toBe(1000)
    expect(syncRpm(60, 2)).toBe(3600)
    expect(slipOf(1500, 1440)).toBeCloseTo(0.04, 12)
    expect(rotorRpm(1500, 0.04)).toBeCloseTo(1440, 9)
    expect(rotorFreq(0.04, 50)).toBeCloseTo(2, 12)
    expect(rotorFreq(1, 50)).toBe(50) // at standstill the rotor sees the supply frequency
    expect(syncRad(50, 4)).toBeCloseTo((2 * Math.PI * 1500) / 60, 12)
    expect(slipOf(1500, 1500)).toBe(0)
    expect(slipOf(1500, 0)).toBe(1)
  })
})

describe('induction: three-phase equivalent circuit', () => {
  it('agrees with the Drives lab theory (independent implementation) at motoring, standstill and generating slips', () => {
    for (const s of [0.005, 0.03, 0.1, 0.36, 1, -0.03]) {
      const a = imPoint(M, 50, V, 4, s)
      const b = eqCircuit(drivesMachine, 50, V, s)
      expect(rel(a.te, b.te), `te at s=${s}`).toBeLessThan(1e-9)
      expect(rel(a.i1, b.i1), `i1 at s=${s}`).toBeLessThan(1e-9)
      expect(rel(a.i2, b.i2)).toBeLessThan(1e-9)
      expect(rel(a.pin, b.pin)).toBeLessThan(1e-9)
      expect(rel(a.pf, b.pf)).toBeLessThan(1e-9)
    }
  })
  it('power balance: Pin = Pcu1 + Pag, Pcu2 = s·Pag, Pmech = (1 − s)·Pag = Te·ωr', () => {
    for (const s of [0.01, 0.042, 0.2, 1]) {
      const p = imPoint(M, 50, V, 4, s)
      expect(rel(p.pin, p.pcu1 + p.pag)).toBeLessThan(1e-9)
      expect(rel(p.pcu2, s * p.pag)).toBeLessThan(1e-9)
      expect(Math.abs(p.pmech - (1 - s) * p.pag)).toBeLessThan(1e-9 * p.pag)
      expect(Math.abs(p.pmech - p.te * (1 - s) * syncRad(50, 4))).toBeLessThan(1e-6)
      expect(rel(p.te * syncRad(50, 4), p.pag)).toBeLessThan(1e-12)
    }
    const z = imPoint(M, 50, V, 4, 0)
    expect(z.te).toBe(0) // no slip, no torque
    expect(z.i2).toBe(0)
  })
  it('pull-out torque: the closed form equals the numerical maximum and the Drives lab value', () => {
    const b = imBreakdown(M, 50, V, 4)
    let best = 0
    let sBest = 0
    for (let k = 1; k <= 20000; k++) {
      const s = k / 20000
      const t = imPoint(M, 50, V, 4, s).te
      if (t > best) [best, sBest] = [t, s]
    }
    expect(rel(b.tMax, best)).toBeLessThan(1e-6)
    expect(Math.abs(b.sMax - sBest)).toBeLessThan(1e-4)
    const d = drivesBreakdown(drivesMachine, 50, V)
    expect(rel(b.tMax, d.tMax)).toBeLessThan(1e-9)
    expect(rel(b.sMax, d.sMax)).toBeLessThan(1e-9)
    // independent of R2, s_max ∝ R2
    const b2 = imBreakdown(M, 50, V, 4, 2)
    expect(rel(b2.tMax, b.tMax)).toBeLessThan(1e-12)
    expect(rel(b2.sMax / b.sMax, (M.r2 + 2) / M.r2)).toBeLessThan(1e-12)
  })
  it('operating point: Te = TL; more load → more slip, more current; above pull-out → null (stalls)', () => {
    let prev = -1
    let prevI = 0
    for (const tl of [0, 5, 15, 25, 40, 60, 85]) {
      const op = imOperating(M, 50, V, 4, tl)!
      expect(op, `TL=${tl}`).not.toBeNull()
      expect(Math.abs(op.te - tl)).toBeLessThan(1e-8 * Math.max(1, tl))
      expect(op.s).toBeGreaterThan(prev)
      expect(op.i1).toBeGreaterThan(prevI)
      expect(op.s).toBeLessThan(imBreakdown(M, 50, V, 4).sMax)
      prev = op.s
      prevI = op.i1
    }
    expect(imOperating(M, 50, V, 4, 0)!.s).toBeLessThan(1e-12)
    expect(imOperating(M, 50, V, 4, imBreakdown(M, 50, V, 4).tMax * 1.01)).toBeNull()
    expect(imOperating(M, 0, V, 4, 10)).toBeNull()
  })
  it('the calculation table: defaults, units and null when stalled', () => {
    const p = defaults(IM_PARAMS)
    const r = imCalc(p)
    expect(val(r, 'ns')).toBe(1500)
    const s = val(r, 's')!
    expect(s).toBeGreaterThan(0.02)
    expect(s).toBeLessThan(0.08) // a few % at about rated load
    expect(val(r, 'nr')!).toBeCloseTo(1500 * (1 - s), 9)
    expect(val(r, 'f2')!).toBeCloseTo(50 * s, 12)
    expect(val(r, 'pcu2')!).toBeCloseTo(s * val(r, 'pag')!, 6)
    expect(val(r, 'pin')!).toBeCloseTo(val(r, 'pcu1')! + val(r, 'pag')!, 6)
    expect(val(r, 'eff')!).toBeLessThan(1 - s) // η < 1 − s always (stator loss too)
    const st = imCalc({ ...p, tl: 200 })
    for (const id of ['s', 'nr', 'f2', 'i1', 'pmech', 'eff']) expect(val(st, id), id).toBeNull()
    expect(val(st, 'ns')).toBe(1500)
    expect(val(st, 'tmax')!).toBeGreaterThan(0)
  })
  it('motion: the field turns forwards at Ns slowed ×50; the rotor ratio 1 − s is below 1', () => {
    const p = defaults(IM_PARAMS)
    const r = Object.fromEntries(imCalc(p).map((c) => [c.id, c.value]))
    const m = imMotion(r, p)
    expect(m.omega).toBeCloseTo(syncRad(50, 4) / 50, 12)
    expect(m.omega).toBeGreaterThan(0)
    expect(m.note).toContain('×50')
    expect(1 - (r.s as number)).toBeLessThan(1)
  })
  it('the guided steps quote numbers that come from the calculation', () => {
    const p = defaults(IM_PARAMS)
    const op = imOperating(M, 50, V, 4, p.tl)!
    const op2 = imOperating(M, 50, V, 4, 2 * p.tl)!
    const slipStep = IM_STEPS.find((s) => s.id === 'slip')!.text
    expect(slipStep).toContain(`${Math.round(op.nr)} rpm`)
    expect(slipStep).toContain(`${(op.s * 100).toFixed(1)} %`)
    const loadStep = IM_STEPS.find((s) => s.id === 'load')!.text
    expect(loadStep).toContain(`${(op2.s * 100).toFixed(1)} %`)
    expect(op2.s).toBeGreaterThan(op.s)
  })
})

describe('induction: wound rotor (external rotor resistance)', () => {
  it('starting torque rises up to the pull-out torque (s_max = 1), then falls; starting current falls throughout', () => {
    const b0 = imBreakdown(M, 50, V, 4)
    const rBest = M.r2 / b0.sMax - M.r2
    const tst = (r: number) => imPoint(M, 50, V, 4, 1, r).te
    const ist = (r: number) => imPoint(M, 50, V, 4, 1, r).i1
    expect(tst(rBest)).toBeCloseTo(b0.tMax, 6)
    expect(tst(0)).toBeLessThan(tst(rBest * 0.5))
    expect(tst(rBest * 0.5)).toBeLessThan(tst(rBest))
    expect(tst(rBest * 3)).toBeLessThan(tst(rBest))
    let prev = Infinity
    for (const r of [0, 1, 2, 5, 10]) {
      expect(ist(r)).toBeLessThan(prev)
      prev = ist(r)
    }
  })
  it('same load, more rotor resistance → more slip, lower speed; slip power into the resistors', () => {
    const p = defaults(WR_PARAMS)
    let prev = -1
    for (const rext of [0, 1, 3, 6]) {
      const r = wrCalc({ ...p, rext })
      const s = val(r, 's')!
      expect(s).toBeGreaterThan(prev)
      prev = s
      const pcu2 = val(r, 'pcu2')!
      expect(pcu2).toBeCloseTo(s * val(r, 'pag')!, 6)
      expect(val(r, 'pext')!).toBeCloseTo((pcu2 * rext) / (M.r2 + rext), 9)
      expect(val(r, 'tmax')!).toBeCloseTo(imBreakdown(M, 50, V, 4).tMax, 9) // unchanged
      expect(val(r, 'smax')!).toBeCloseTo((imBreakdown(M, 50, V, 4).sMax * (M.r2 + rext)) / M.r2, 9)
      expect(Math.abs(imOperating(M, 50, V, 4, p.tl, rext)!.te - p.tl)).toBeLessThan(1e-8 * p.tl)
    }
    expect(val(wrCalc({ ...p, rext: 0 }), 'pext')).toBe(0)
  })
  it('with s_max above 1 the operating search stays on 0 … 1', () => {
    const op = imOperating(M, 50, V, 4, 60, 10)! // s_max ≈ 2.9 for Rext = 10 Ω
    expect(op.s).toBeGreaterThan(0)
    expect(op.s).toBeLessThanOrEqual(1)
    expect(Math.abs(op.te - 60)).toBeLessThan(1e-6)
    expect(imOperating(M, 50, V, 4, 200, 10)).toBeNull()
  })
})

describe('induction: single-phase (double revolving field)', () => {
  const S = SPIM_EXAMPLE
  it('no starting torque on the main winding alone: Tf = Tb exactly at s = 1', () => {
    const st = spPoint(S, 50, 4, 1)
    expect(st.tf).toBeGreaterThan(0)
    expect(st.te).toBe(0)
    expect(st.f2f).toBe(50)
    expect(st.f2b).toBe(50)
  })
  it('symmetry T(s) = −T(2 − s); forward torque wins for 0 < s < 1; slightly negative at s = 0', () => {
    for (const s of [0.02, 0.1, 0.4, 0.8]) {
      expect(spPoint(S, 50, 4, s).te).toBeCloseTo(-spPoint(S, 50, 4, 2 - s).te, 10)
      const p = spPoint(S, 50, 4, s)
      expect(p.tf).toBeGreaterThan(p.tb)
      expect(p.f2b).toBeCloseTo((2 - s) * 50, 12)
    }
    expect(spPoint(S, 50, 4, 0).te).toBeLessThan(0) // the backward field brakes a synchronously turning rotor
  })
  it('power balance: Pin = Pcu1 + PagF + PagB, Pmech = PagF + PagB − Pcu2 = (1 − s)(PagF − PagB) = T·ωr', () => {
    for (const s of [0.03, 0.2, 0.7]) {
      const p = spPoint(S, 50, 4, s)
      expect(rel(p.pin, p.pcu1 + p.pagF + p.pagB)).toBeLessThan(1e-9)
      expect(Math.abs(p.pmech - (p.pagF + p.pagB - p.pcu2))).toBeLessThan(1e-9 * p.pin)
      expect(Math.abs(p.pmech - p.te * (1 - s) * syncRad(50, 4))).toBeLessThan(1e-9 * p.pin)
    }
  })
  it('running point: Te = TL, more load → more slip; above the peak → null', () => {
    let prev = -1
    for (const tl of [0, 1, 2, 3, 4]) {
      const op = spOperating(S, 50, 4, tl)!
      expect(Math.abs(op.te - tl)).toBeLessThan(1e-8)
      expect(op.s).toBeGreaterThan(prev)
      prev = op.s
    }
    expect(spOperating(S, 50, 4, 0)!.s).toBeGreaterThan(0) // no load still needs a little slip
    expect(spOperating(S, 50, 4, spPeak(S, 50, 4).tMax * 1.01)).toBeNull()
    const r = spCalc(defaults(SP_PARAMS))
    expect(val(r, 'tst')).toBe(0)
    expect(val(r, 'fp')).toBe(100)
    expect(val(r, 'nsw')).toBeCloseTo(0.75 * 1500, 9)
    const s = val(r, 's')!
    expect(s).toBeGreaterThan(0.02)
    expect(s).toBeLessThan(0.1)
  })
})

describe('induction: winding layouts and the drawn field directions', () => {
  it('three-phase, 36 slots, P = 2, 4, 6: balanced belts, concentric coils joining + to − slots of the same phase', () => {
    for (const P of [2, 4, 6]) {
      const l = windingLayout(36, P, BELTS_3PH)!
      expect(l).not.toBeNull()
      for (const ph of ['a', 'b', 'c'] as const) {
        expect(l.slots.filter((s) => s.phase === ph && s.sign === 1).length).toBe(6)
        expect(l.slots.filter((s) => s.phase === ph && s.sign === -1).length).toBe(6)
      }
      expect(l.coils.length).toBe(18)
      for (const c of l.coils) {
        const end = c.from + c.span
        const hit = l.slots.find((s) => Math.abs(Math.atan2(Math.sin(s.angle - end), Math.cos(s.angle - end))) < 1e-9)
        expect(hit, `P=${P}`).toBeDefined()
        expect(hit!.phase).toBe(c.phase)
        expect(hit!.sign).toBe(-1)
      }
    }
    expect(windingLayout(36, 8, BELTS_3PH)).toBeNull() // 1.5 slots per pole per phase does not fit
  })
  it('the current sheet turns forwards (counter-clockwise, a → b → c) at θe/p with constant amplitude', () => {
    for (const P of [2, 4, 6]) {
      const l = windingLayout(36, P, BELTS_3PH)!
      const a0 = sheetFundamental(l, 0).amp
      for (const te of [0, 0.5, 1.3, 2.9, 4.4]) {
        const f = sheetFundamental(l, te)
        expect(Math.abs(Math.atan2(Math.sin(f.phi - te), Math.cos(f.phi - te)))).toBeLessThan(1e-9)
        expect(f.amp).toBeCloseTo(a0, 9)
      }
    }
  })
  it('single-phase: main + auxiliary (leading 90°) rotate forwards; the main winding alone pulsates on a fixed axis', () => {
    for (const P of [2, 4]) {
      const l = windingLayout(24, P, BELTS_1PH)!
      expect(l.slots.filter((s) => s.phase === 'm').length).toBe(16)
      expect(l.slots.filter((s) => s.phase === 'x').length).toBe(8)
      // with both windings the field turns forwards, one pole pair per period (elliptical: the main winding has
      // more slots than the auxiliary one, so with equal per-unit currents the two MMFs differ — the model draws
      // the ideal circular field and says so)
      let total = 0
      let prev = sheetFundamental(l, 0, true).phi
      for (let k = 1; k <= 360; k++) {
        const phi = sheetFundamental(l, (k * 2 * Math.PI) / 360, true).phi
        const d = Math.atan2(Math.sin(phi - prev), Math.cos(phi - prev))
        expect(d).toBeGreaterThan(0)
        total += d
        prev = phi
      }
      expect(total).toBeCloseTo(2 * Math.PI, 9)
      for (const te of [0.3, 1.2, 2.5]) {
        const g = sheetFundamental(l, te, false)
        // fixed axis (0 or π) and amplitude ∝ |cos θe|
        expect(Math.abs(Math.sin(g.phi))).toBeLessThan(1e-9)
        expect(g.amp / sheetFundamental(l, 0, false).amp).toBeCloseTo(Math.abs(Math.cos(te)), 9)
      }
    }
  })
  it('rotor currents: ⊗ under a stator N pole, ⊙ under an S pole; the force on the bars is in the field’s direction', () => {
    for (const pp of [1, 2, 3]) {
      const te = 0.7
      const thN = (te + Math.PI / 2) / pp // gapField = −1: flux into the rotor
      expect(gapField(thN, te, pp)).toBeCloseTo(-1, 12)
      expect(barCurrent(thN, te, pp, 0)).toBeCloseTo(-1, 12)
      expect(barCurrent(thN - Math.PI / pp, te, pp, 0)).toBeCloseTo(1, 12)
      for (const phi2 of [0, 0.3, 0.9, 1.4]) {
        let sum = 0
        for (let k = 0; k < 360; k++) sum += barForce((k * 2 * Math.PI) / 360, te, pp, phi2)
        expect(sum / 360).toBeCloseTo(0.5 * Math.cos(phi2), 9) // mean force ∝ cos φ2 > 0: counter-clockwise torque
      }
    }
  })
})
