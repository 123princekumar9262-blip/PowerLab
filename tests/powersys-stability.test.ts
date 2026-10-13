import { describe, expect, it } from 'vitest'
import { EXPERIMENTS } from '../src/powersys/modules/stability/experiments.ts'
import { FREQ0, rocof0, simulateFrequency, steadyStateHz, type FreqParams } from '../src/powersys/modules/stability/frequency.ts'
import {
  angleAtTime,
  angleDuringBusFault,
  areaAcc,
  areaDec,
  criticalAngle,
  criticalTimeBySim,
  deg,
  delta0,
  deltaMax,
  energyTrace,
  measuredFrequency,
  naturalFreq,
  powerLimits,
  reactances,
  SMIB0,
  simulateSwing,
  stableAt,
  summarise,
  syncPower,
  ws,
  type SmibParams,
} from '../src/powersys/modules/stability/swing.ts'

/*
 * Module 6 — Stability & Frequency Control. No published reference numbers are used: every check is an independent
 * property of the models (equilibria, conserved energy, closed forms that are exact for special cases, equal areas
 * versus bisection on the simulation, linearisation, step-halving convergence).
 */

const bus: SmibParams = { ...SMIB0, fault: 'bus' }
const mid: SmibParams = { ...SMIB0, fault: 'mid' }

describe('SMIB network and steady state', () => {
  it('transfer reactances: pre 0.6, post 0.9, mid-line fault 3·Xg + Xl, bus fault infinite', () => {
    const r = reactances(mid)
    expect(r.X1).toBeCloseTo(0.6, 12)
    expect(r.X3).toBeCloseTo(0.9, 12)
    expect(r.X2).toBeCloseTo(3 * SMIB0.Xg + SMIB0.Xl, 12)
    expect(reactances(bus).X2).toBe(Infinity)
    expect(powerLimits(bus).P2).toBe(0)
  })
  it('equilibrium δ0 = asin(Pm/Pmax), and an undisturbed simulation stays there', () => {
    const lim = powerLimits(bus)
    const d0 = delta0(SMIB0.Pm, lim.P1)
    expect(lim.P1 * Math.sin(d0)).toBeCloseTo(SMIB0.Pm, 12)
    const r = simulateSwing(bus, { kind: 'none' }, { tEnd: 5 })
    const drift = Math.max(...r.d.map((d) => Math.abs(d - d0)))
    expect(drift).toBeLessThan(1e-12)
    expect(Math.max(...r.w.map(Math.abs))).toBeLessThan(1e-12)
    expect(r.stable).toBe(true)
  })
  it('no operating point when Pm ≥ Pmax; no post-fault equilibrium when Pm ≥ P3', () => {
    expect(Number.isNaN(delta0(2, 1.8))).toBe(true)
    expect(Number.isNaN(deltaMax(1.0, 0.9))).toBe(true)
    // Pm 1.0 pu with 1.0 pu lines: P3 = 1.1/1.3 < 1 → every clearing time loses synchronism
    expect(Number.isNaN(criticalTimeBySim({ ...SMIB0, Pm: 1.0, Xl: 1.0 }))).toBe(true)
  })
})

describe('Swing equation, RK4', () => {
  it('without damping the energy ½·M·Δω² − ∫(Pm − Pe)dδ is conserved through fault and clearing', () => {
    for (const p of [bus, mid, { ...bus, tc: 0.3 }]) {
      const r = simulateSwing(p, { kind: 'fault' }, { tEnd: 3 })
      const e = energyTrace(p, r)
      const span = Math.max(...e) - Math.min(...e)
      expect(span).toBeLessThan(1e-9)
    }
  })
  it('with damping the energy only decreases after clearing', () => {
    const p = { ...bus, D: 10 }
    const r = simulateSwing(p, { kind: 'fault' }, { tEnd: 3 })
    const e = energyTrace(p, r)
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeLessThanOrEqual(e[i - 1] + 1e-12)
    expect(e[e.length - 1]).toBeLessThan(e[0] - 1e-3)
  })
  it('during a fault at the bus the angle follows δ0 + ωs·Pm·t²/(4H) (constant acceleration)', () => {
    const lim = powerLimits(bus)
    const d0 = delta0(bus.Pm, lim.P1)
    for (const t of [0.05, 0.1, 0.173, 0.25]) expect(angleAtTime(bus, t)).toBeCloseTo(angleDuringBusFault(bus.f0, bus.H, bus.Pm, d0, t), 10)
  })
  it('the clearing instant is hit exactly even when it is not a multiple of the step', () => {
    const r = simulateSwing({ ...bus, tc: 0.1234 }, { kind: 'fault' }, { tEnd: 1 })
    const k = r.phase.lastIndexOf(1)
    expect(r.t[k]).toBeCloseTo(0.1234, 12)
  })
  it('RK4 step halving converges at fourth order', () => {
    const at = (h: number) => {
      const r = simulateSwing({ ...mid, tc: 0.2 }, { kind: 'fault' }, { tEnd: 1, h })
      return r.d[r.d.length - 1]
    }
    const a = at(4e-3)
    const b = at(2e-3)
    const c = at(1e-3)
    const ratio = (a - b) / (b - c)
    expect(ratio).toBeGreaterThan(12)
    expect(ratio).toBeLessThan(20)
    expect(Math.abs(b - c)).toBeLessThan(1e-8)
  })
})

describe('Equal-area criterion vs simulation', () => {
  it('default case: δcr from the formula, and the areas are equal at δcr', () => {
    const lim = powerLimits(bus)
    const d0 = delta0(bus.Pm, lim.P1)
    const dm = deltaMax(bus.Pm, lim.P3)
    const { dcr, ok } = criticalAngle(bus.Pm, lim.P1, lim.P2, lim.P3)
    expect(ok).toBe(true)
    expect(areaAcc(bus.Pm, 0, d0, dcr)).toBeCloseTo(areaDec(bus.Pm, lim.P3, dcr, dm), 10)
    const lm = powerLimits(mid)
    const cm = criticalAngle(mid.Pm, lm.P1, lm.P2, lm.P3)
    expect(areaAcc(mid.Pm, lm.P2, d0, cm.dcr)).toBeCloseTo(areaDec(mid.Pm, lm.P3, cm.dcr, dm), 10)
  })
  it('P2 = 0: closed-form t_cr is meaningful (0.1–0.4 s); 0.98·t_cr stays in step, 1.02·t_cr loses synchronism', () => {
    const s = summarise(bus)
    expect(s.tcrClosed).toBeGreaterThan(0.1)
    expect(s.tcrClosed).toBeLessThan(0.4)
    const ok = simulateSwing({ ...bus, tc: 0.98 * s.tcrClosed }, { kind: 'fault' }, { tEnd: 5 })
    expect(ok.stable).toBe(true)
    expect(Math.max(...ok.d)).toBeLessThan(Math.PI)
    expect(Math.max(...ok.d)).toBeLessThan(deltaMax(bus.Pm, s.lim.P3))
    // the angle returns: it comes back below the post-fault equilibrium
    expect(Math.min(...ok.d.slice(ok.d.length / 2))).toBeLessThan(Math.asin(bus.Pm / s.lim.P3))
    const bad = simulateSwing({ ...bus, tc: 1.02 * s.tcrClosed }, { kind: 'fault' }, { tEnd: 5, dStop: 4 * Math.PI })
    expect(bad.stable).toBe(false)
    expect(Math.max(...bad.d)).toBeGreaterThan(Math.PI)
  })
  it('P2 = 0: the bisection on the simulation finds the closed-form t_cr', () => {
    const s = summarise(bus)
    expect(Math.abs(s.tcrSim - s.tcrClosed) / s.tcrClosed).toBeLessThan(1e-3)
  })
  it('P2 > 0 (mid-line fault): the angle at the simulated t_cr equals δcr from equal areas, and ±2 % decides', () => {
    const tcr = criticalTimeBySim(mid, { tol: 1e-6 })
    expect(tcr).toBeGreaterThan(0.1)
    expect(tcr).toBeLessThan(1)
    const lm = powerLimits(mid)
    const { dcr } = criticalAngle(mid.Pm, lm.P1, lm.P2, lm.P3)
    expect(Math.abs(deg(angleAtTime(mid, tcr) - dcr))).toBeLessThan(0.02)
    expect(stableAt(mid, 0.98 * tcr)).toBe(true)
    expect(stableAt(mid, 1.02 * tcr)).toBe(false)
  })
  it('the same agreement holds for other loadings and networks', () => {
    for (const p of [
      { ...SMIB0, Pm: 1.0, Xl: 0.3, fault: 'mid' as const },
      { ...SMIB0, Pm: 0.6, Xl: 1.0, fault: 'mid' as const },
      { ...SMIB0, Pm: 0.5, H: 3, fault: 'bus' as const },
    ]) {
      const lim = powerLimits(p)
      const { dcr } = criticalAngle(p.Pm, lim.P1, lim.P2, lim.P3)
      const tcr = criticalTimeBySim(p, { tol: 1e-6 })
      expect(Math.abs(deg(angleAtTime(p, tcr) - dcr)), JSON.stringify(p)).toBeLessThan(0.05)
    }
  })
  it('a large P2 (fault alone cannot pull it out of step): the formula has no angle and the search says Infinity', () => {
    const p = { ...SMIB0, Pm: 0.3, Xl: 0.3, fault: 'mid' as const }
    const lim = powerLimits(p)
    expect(criticalAngle(p.Pm, lim.P1, lim.P2, lim.P3).ok).toBe(false)
    expect(criticalTimeBySim(p)).toBe(Infinity)
  })
  it('heavier loading shortens t_cr; a stronger network lengthens it', () => {
    const base = summarise(bus).tcrClosed
    expect(summarise({ ...bus, Pm: 1.0 }).tcrClosed).toBeLessThan(base)
    expect(summarise({ ...bus, Xl: 0.4 }).tcrClosed).toBeGreaterThan(base)
    expect(summarise({ ...bus, H: 8 }).tcrClosed).toBeGreaterThan(base)
  })
})

describe('Small-signal oscillation', () => {
  it('the simulated swing after a small step oscillates at √(ωs·Ps/2H)/2π within 2 %', () => {
    for (const p of [SMIB0, { ...SMIB0, H: 3, Pm: 1.0 }, { ...SMIB0, Xl: 0.9, Pm: 0.5 }]) {
      const lim = powerLimits(p)
      const dP = 0.01
      const d1 = delta0(p.Pm + dP, lim.P1)
      const r = simulateSwing(p, { kind: 'step', dPm: dP }, { tEnd: 6 })
      const f = measuredFrequency(r.t, r.d, d1)
      const fn = naturalFreq(p.f0, p.H, syncPower(lim.P1, delta0(p.Pm, lim.P1))) / (2 * Math.PI)
      expect(Math.abs(f - fn) / fn).toBeLessThan(0.02)
      // and at the new operating point the linear prediction is much closer still
      const fn1 = naturalFreq(p.f0, p.H, syncPower(lim.P1, d1)) / (2 * Math.PI)
      expect(Math.abs(f - fn1) / fn1).toBeLessThan(0.002)
    }
  })
  it('ωn formula: ωs = 2π f0, units rad/s', () => {
    expect(ws(50)).toBeCloseTo(100 * Math.PI, 12)
    expect(naturalFreq(50, 5, 1.5)).toBeCloseTo(Math.sqrt((100 * Math.PI * 1.5) / 10), 12)
  })
})

describe('Single-area frequency control', () => {
  const end = (p: FreqParams, tEnd = 120) => simulateFrequency(p, { tEnd }).end
  it('initial slope equals −ΔP_L·f0/(2H) Hz/s (H in s, f0 in Hz, ΔP_L in pu of the system base)', () => {
    for (const p of [FREQ0, { ...FREQ0, H: 2, dPL: 0.2 }, { ...FREQ0, H: 8, D: 2 }]) {
      const r = simulateFrequency(p, { tEnd: 0.001, h: 1e-5 })
      expect(Math.abs(r.rocofSim - rocof0(p)) / Math.abs(rocof0(p))).toBeLessThan(1e-4)
    }
    expect(rocof0(FREQ0)).toBeCloseTo(-0.5, 12)
  })
  it('without AGC Δf settles at −ΔP_L/(D + 1/R)', () => {
    for (const p of [FREQ0, { ...FREQ0, R: 0.04 }, { ...FREQ0, R: 0.08, D: 0 }, { ...FREQ0, H: 2, dPL: 0.25 }]) {
      expect(end(p)).toBeCloseTo((-p.dPL / (p.D + 1 / p.R)) * p.f0, 8)
      expect(steadyStateHz(p)).toBeCloseTo((-p.dPL / (p.D + 1 / p.R)) * p.f0, 12)
    }
  })
  it('with AGC Δf returns to zero and the generators take the whole step', () => {
    const p = { ...FREQ0, agc: true }
    const r = simulateFrequency(p, { tEnd: 120 })
    expect(Math.abs(r.end)).toBeLessThan(1e-5)
    expect(r.dPm[r.dPm.length - 1]).toBeCloseTo(p.dPL, 5)
    expect(r.tRecover).toBeGreaterThan(5)
    expect(r.tRecover).toBeLessThan(60)
  })
  it('the nadir overshoots below the steady state, and less inertia makes it deeper and earlier', () => {
    const a = simulateFrequency(FREQ0, { tEnd: 20 })
    expect(a.nadir).toBeLessThan(steadyStateHz(FREQ0))
    const b = simulateFrequency({ ...FREQ0, H: 2 }, { tEnd: 20 })
    expect(b.nadir).toBeLessThan(a.nadir)
    expect(b.tNadir).toBeLessThan(a.tNadir)
  })
  it('RK4 step halving: nadir and the value at 5 s converge', () => {
    const at = (h: number) => {
      const r = simulateFrequency(FREQ0, { tEnd: 5, h })
      return { end: r.end, nadir: r.nadir }
    }
    const a = at(0.04)
    const b = at(0.02)
    const c = at(0.01)
    const ratio = (a.end - b.end) / (b.end - c.end)
    expect(ratio).toBeGreaterThan(12)
    expect(ratio).toBeLessThan(20)
    expect(Math.abs(b.nadir - c.nadir)).toBeLessThan(1e-6)
  })
})

describe('Experiments', () => {
  it('every experiment computes both cases, and its answer is one of its options', () => {
    for (const e of EXPERIMENTS) {
      const b = e.before()
      const a = e.after()
      const ans = e.kind === 'swing' ? e.answer(b as never, a as never) : e.answer(b as never, a as never)
      expect(
        e.options.map((o) => o.id),
        e.id,
      ).toContain(ans)
      const text = (e.kind === 'swing' ? e.explain(b as never, a as never) : e.explain(b as never, a as never)).join(' ')
      expect(text, e.id).not.toMatch(/NaN|undefined/)
    }
  })
  it('the expected physics: less inertia deepens the dip; 8 % droop ~doubles Δf; AGC returns 50 Hz; 1.05·t_cr is lost; loading shortens and a stronger network lengthens t_cr', () => {
    const answers = Object.fromEntries(
      EXPERIMENTS.map((e) => {
        const b = e.before()
        const a = e.after()
        return [e.id, e.answer(b as never, a as never)]
      }),
    )
    expect(answers).toEqual({ inertia: 'a', droop: 'double', agc: 'back', tcr: 'lost', loading: 'shorter', network: 'longer' })
  })
})
