import { describe, expect, it } from 'vitest'
import { compoundMotor, separatelyExcitedGenerator, separatelyExcitedMotor, seriesMotor, shuntMotor } from '../src/machines/calculations/dcMachines.ts'
import { dcMotor, radFromRpm, rpmFromRad } from '../src/machines/calculations/formulas.ts'

/** Power balance of a motor result: electrical input = shaft output + armature copper loss + field loss. */
function balance(r: { pin: number | null; pout: number | null; pcuA: number | null; pField: number }) {
  return r.pin! - (r.pout! + r.pcuA! + r.pField)
}

describe('DC machines: separately excited motor', () => {
  const base = { va: 220, vf: 220, rf: 220, kf: 1.3, ra: 0.5, tl: 10 }
  it('If = Vf/Rf, kΦ = kf·If, Ia = TL/kΦ, E = Va − Ia·Ra, ω = E/kΦ (hand-checked numbers)', () => {
    const r = separatelyExcitedMotor(base)!
    expect(r.mode).toBe('motoring')
    expect(r.iField).toBeCloseTo(1, 12)
    expect(r.kphi).toBeCloseTo(1.3, 12)
    expect(r.ia!).toBeCloseTo(10 / 1.3, 12)
    expect(r.e!).toBeCloseTo(220 - (10 / 1.3) * 0.5, 12)
    expect(r.w!).toBeCloseTo(r.e! / 1.3, 12)
    expect(r.n0!).toBeCloseTo(rpmFromRad(220 / 1.3), 9)
    expect(r.stallTorque!).toBeCloseTo((1.3 * 220) / 0.5, 9)
    expect(Math.abs(balance(r))).toBeLessThan(1e-9)
    expect(r.pout!).toBeCloseTo(r.e! * r.ia!, 9) // E·Ia = T·ω
    expect(r.pField).toBeCloseTo(220, 12) // Vf·If = If²·Rf
  })
  it('agrees with the lead’s PM motor formula when kΦ is the same (field supply aside)', () => {
    const r = separatelyExcitedMotor(base)!
    const pm = dcMotor({ va: 220, kphi: 1.3, ra: 0.5, tl: 10 })!
    expect(r.ia!).toBeCloseTo(pm.ia, 12)
    expect(r.n!).toBeCloseTo(pm.n, 9)
  })
  it('field weakening: less field current → less flux → higher speed (and more current for the same torque)', () => {
    const a = separatelyExcitedMotor(base)!
    const b = separatelyExcitedMotor({ ...base, vf: 150 })!
    expect(b.n!).toBeGreaterThan(a.n!)
    expect(b.ia!).toBeGreaterThan(a.ia!)
  })
  it('driven shaft (TL < 0): current reverses, E > Va, power returns to the supply; balance still holds', () => {
    const r = separatelyExcitedMotor({ ...base, tl: -10 })!
    expect(r.mode).toBe('generating')
    expect(r.ia!).toBeLessThan(0)
    expect(r.e!).toBeGreaterThan(220)
    expect(220 * r.ia!).toBeLessThan(0) // armature power flows back
    expect(Math.abs(balance(r))).toBeLessThan(1e-9)
    expect(r.eff!).toBeGreaterThan(0)
    expect(r.eff!).toBeLessThan(1)
  })
  it('no field current: no speed is invented, a field-loss warning instead', () => {
    const r = separatelyExcitedMotor({ ...base, vf: 0 })!
    expect(r.mode).toBe('no-field')
    expect(r.n).toBeNull()
    expect(r.warning).toMatch(/field/i)
  })
  it('above the stall torque it stalls: n = 0, Ia = Va/Ra', () => {
    const r = separatelyExcitedMotor({ ...base, tl: 1000 })!
    expect(r.mode).toBe('stalled')
    expect(r.n).toBe(0)
    expect(r.ia!).toBeCloseTo(440, 9)
    expect(Math.abs(balance(r))).toBeLessThan(1e-9)
  })
  it('invalid inputs give null', () => {
    expect(separatelyExcitedMotor({ ...base, ra: 0 })).toBeNull()
    expect(separatelyExcitedMotor({ ...base, rf: 0 })).toBeNull()
  })
})

describe('DC machines: shunt motor', () => {
  const base = { v: 220, rf: 220, kf: 1.3, ra: 0.5, tl: 10 }
  it('If = V/Rf, Ia = TL/kΦ, IL = Ia + If; power balance Pin = Pout + Ia²Ra + V·If', () => {
    const r = shuntMotor(base)!
    expect(r.iField).toBeCloseTo(1, 12)
    expect(r.ia!).toBeCloseTo(10 / 1.3, 12)
    expect(r.iLine!).toBeCloseTo(r.ia! + 1, 12)
    expect(r.pin!).toBeCloseTo(220 * r.iLine!, 9)
    expect(Math.abs(balance(r))).toBeLessThan(1e-9)
    expect(r.pField).toBeCloseTo(1 * 1 * 220, 12) // If²·Rf
    expect(r.eff!).toBeGreaterThan(0)
    expect(r.eff!).toBeLessThan(1)
  })
  it('nearly constant speed: from no load to TL = 20 N·m the speed falls only by Ia·Ra/E (a few %)', () => {
    const nl = shuntMotor({ ...base, tl: 0 })!
    const fl = shuntMotor({ ...base, tl: 20 })!
    expect(nl.n!).toBeCloseTo(nl.n0!, 9)
    expect(nl.ia!).toBe(0)
    expect(nl.iLine!).toBeCloseTo(1, 12) // the field current still flows
    const drop = (nl.n! - fl.n!) / nl.n!
    expect(drop).toBeGreaterThan(0)
    expect(drop).toBeLessThan(0.05)
    expect(drop).toBeCloseTo((fl.ia! * 0.5) / 220, 9) // Δω/ω0 = Ia·Ra/V
  })
  it('a higher field resistance (field rheostat) weakens the field and raises the speed', () => {
    expect(shuntMotor({ ...base, rf: 300 })!.n!).toBeGreaterThan(shuntMotor(base)!.n!)
  })
  it('the supply voltage sets both Ia·Ra headroom and the flux: n0 = V/(kf·V/Rf) = Rf/kf, independent of V', () => {
    const a = shuntMotor({ ...base, tl: 0 })!
    const b = shuntMotor({ ...base, v: 110, tl: 0 })!
    expect(a.n0!).toBeCloseTo(b.n0!, 9)
    expect(a.n0!).toBeCloseTo(rpmFromRad(220 / 1.3), 9)
  })
  it('stalls above the stall torque', () => {
    const r = shuntMotor({ ...base, tl: 10000 })!
    expect(r.mode).toBe('stalled')
    expect(r.n).toBe(0)
  })
})

describe('DC machines: series motor', () => {
  const base = { v: 220, ks: 0.1, ra: 0.5, rse: 0.2, tl: 10 }
  it('T = ks·Ia² → Ia = √(TL/ks); E = V − Ia(Ra+Rse); ω = E/(ks·Ia); power balance', () => {
    const r = seriesMotor(base)!
    expect(r.ia!).toBeCloseTo(10, 12)
    expect(r.kphi!).toBeCloseTo(1, 12)
    expect(r.e!).toBeCloseTo(220 - 10 * 0.7, 12)
    expect(r.w!).toBeCloseTo(213, 12)
    expect(r.iLine).toBe(r.ia)
    expect(r.iField).toBe(r.ia) // one current through field and armature
    expect(r.pField).toBe(0)
    expect(Math.abs(balance(r))).toBeLessThan(1e-9)
  })
  it('torque ∝ Ia² (unsaturated): double the current, four times the torque', () => {
    const a = seriesMotor({ ...base, tl: 5 })!
    const b = seriesMotor({ ...base, tl: 20 })!
    expect(b.ia! / a.ia!).toBeCloseTo(2, 12)
  })
  it('speed falls steeply with load (much more than a shunt motor)', () => {
    const light = seriesMotor({ ...base, tl: 2.5 })!
    const heavy = seriesMotor({ ...base, tl: 10 })!
    expect(light.n! / heavy.n!).toBeGreaterThan(1.9) // ≈ √4 = 2 when Ia·R is small
    const sh = { v: 220, rf: 220, kf: 1.3, ra: 0.5 }
    expect(shuntMotor({ ...sh, tl: 2.5 })!.n! / shuntMotor({ ...sh, tl: 10 })!.n!).toBeLessThan(1.05)
  })
  it('no load: runaway warning, no invented speed', () => {
    const r = seriesMotor({ ...base, tl: 0 })!
    expect(r.mode).toBe('runaway')
    expect(r.n).toBeNull()
    expect(r.n0).toBeNull()
    expect(r.warning).toMatch(/runaway|without limit/i)
  })
  it('the speed grows without bound as TL → 0 (the reason for the warning)', () => {
    const ns = [1, 0.1, 0.01].map((tl) => seriesMotor({ ...base, tl })!.n!)
    expect(ns[1]).toBeGreaterThan(ns[0] * 3)
    expect(ns[2]).toBeGreaterThan(ns[1] * 3)
  })
  it('stall torque ks·(V/(Ra+Rse))² and stalled beyond it', () => {
    const r = seriesMotor({ ...base, tl: 1e7 })!
    expect(r.mode).toBe('stalled')
    expect(r.stallTorque!).toBeCloseTo(0.1 * (220 / 0.7) ** 2, 6)
    expect(r.n).toBe(0)
  })
})

describe('DC machines: compound motor (long shunt)', () => {
  const base = { v: 220, rf: 220, kf: 1.3, ks: 0.03, ra: 0.5, rse: 0.1, tl: 10, sense: 1 }
  it('cumulative: kΦ = kf·If + ks·Ia and T = kΦ·Ia = TL; power balance', () => {
    const r = compoundMotor(base)!
    expect(r.mode).toBe('motoring')
    expect(r.kphi! * r.ia!).toBeCloseTo(10, 9)
    expect(r.kphi!).toBeCloseTo(1.3 + 0.03 * r.ia!, 12)
    expect(r.iLine!).toBeCloseTo(r.ia! + 1, 12)
    expect(r.e!).toBeCloseTo(220 - r.ia! * 0.6, 12)
    expect(Math.abs(balance(r))).toBeLessThan(1e-9)
  })
  it('ks = 0 reduces to the shunt motor (with Ra + Rse)', () => {
    const c = compoundMotor({ ...base, ks: 0 })!
    const s = shuntMotor({ v: 220, rf: 220, kf: 1.3, ra: 0.6, tl: 10 })!
    expect(c.n!).toBeCloseTo(s.n!, 9)
    expect(c.ia!).toBeCloseTo(s.ia!, 12)
  })
  it('cumulative: speed falls more with load than shunt; differential: less (it can even rise)', () => {
    const drop = (sense: number, ks: number) => {
      const a = compoundMotor({ ...base, sense, ks, tl: 0 })!
      const b = compoundMotor({ ...base, sense, ks, tl: 8 })!
      return a.n! - b.n!
    }
    expect(drop(1, 0.03)).toBeGreaterThan(drop(1, 0))
    expect(drop(-1, 0.03)).toBeLessThan(drop(1, 0))
    expect(drop(-1, 0.05)).toBeLessThan(0) // differential with a strong series field: speed rises with load
  })
  it('both senses share the no-load point (Ia = 0 → only the shunt flux)', () => {
    const c = compoundMotor({ ...base, tl: 0 })!
    const d = compoundMotor({ ...base, tl: 0, sense: -1 })!
    expect(c.n!).toBeCloseTo(d.n!, 9)
    expect(c.n!).toBeCloseTo(c.n0!, 9)
  })
  it('differential above (kf·If)²/(4ks): no operating point — a warning, not a number', () => {
    const tmax = (1.3 * 1.3) / (4 * 0.03)
    expect(compoundMotor({ ...base, sense: -1, tl: tmax * 0.99 })!.mode).toBe('motoring')
    const r = compoundMotor({ ...base, sense: -1, tl: tmax * 1.01 })!
    expect(r.mode).toBe('no-operating-point')
    expect(r.n).toBeNull()
    expect(r.warning).toMatch(/differential/i)
  })
  it('cumulative stall torque (kf·If + ks·Ist)·Ist exceeds the shunt one', () => {
    const c = compoundMotor(base)!
    const s = shuntMotor({ v: 220, rf: 220, kf: 1.3, ra: 0.6, tl: 10 })!
    expect(c.stallTorque!).toBeGreaterThan(s.stallTorque!)
  })
})

describe('DC machines: separately excited generator', () => {
  const base = { n: 1500, vf: 220, rf: 220, kf: 1.3, ra: 0.5, rl: 20 }
  it('E = kΦ·ω, Ia = E/(Ra+RL), V = E − Ia·Ra = IL·RL (hand-checked numbers)', () => {
    const g = separatelyExcitedGenerator(base)!
    const w = radFromRpm(1500)
    expect(g.e).toBeCloseTo(1.3 * w, 12)
    expect(g.ia).toBeCloseTo(g.e / 20.5, 12)
    expect(g.v).toBeCloseTo(g.e - g.ia * 0.5, 12)
    expect(g.v).toBeCloseTo(g.iLoad * 20, 12)
  })
  it('the load current makes a counter-torque T = kΦ·Ia; shaft power = output + copper loss', () => {
    const g = separatelyExcitedGenerator(base)!
    expect(g.torque).toBeCloseTo(1.3 * g.ia, 12)
    expect(g.pmech).toBeCloseTo(g.e * g.ia, 9)
    expect(g.pmech).toBeCloseTo(g.pout + g.pcuA, 9)
    expect(g.eff!).toBeCloseTo(g.pout / (g.pmech + g.pField), 12)
  })
  it('more load (smaller RL) → more current, more counter-torque, lower terminal voltage', () => {
    const a = separatelyExcitedGenerator(base)!
    const b = separatelyExcitedGenerator({ ...base, rl: 5 })!
    expect(b.ia).toBeGreaterThan(a.ia)
    expect(b.torque).toBeGreaterThan(a.torque)
    expect(b.v).toBeLessThan(a.v)
    expect(b.regulation!).toBeGreaterThan(a.regulation!)
  })
  it('light load: V → E (regulation → 0); E ∝ speed and ∝ field current', () => {
    const light = separatelyExcitedGenerator({ ...base, rl: 1e6 })!
    expect(light.v / light.e).toBeGreaterThan(0.9999)
    expect(separatelyExcitedGenerator({ ...base, n: 750 })!.e).toBeCloseTo(light.e / 2, 9)
    expect(separatelyExcitedGenerator({ ...base, vf: 110 })!.e).toBeCloseTo(light.e / 2, 9)
  })
  it('no field or no speed: no EMF (linear model: no residual flux), nothing invented', () => {
    const g = separatelyExcitedGenerator({ ...base, vf: 0 })!
    expect(g.e).toBe(0)
    expect(g.v).toBe(0)
    expect(g.regulation).toBeNull()
    expect(separatelyExcitedGenerator({ ...base, n: 0 })!.e).toBe(0)
    expect(separatelyExcitedGenerator({ ...base, rl: 0 })).toBeNull()
  })
})
