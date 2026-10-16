import { describe, expect, it } from 'vitest'
import {
  carnot,
  chain,
  chainLosses,
  chainOutput,
  changeWords,
  coalTonnesPerDay,
  DEFAULT_HYDRO,
  DEFAULT_NUCLEAR,
  DEFAULT_PLANTS,
  DEFAULT_PUMPED,
  DEFAULT_THERMAL,
  etaFromHeatRate,
  fissionEnergyPerKgJ,
  flowForPower,
  fuelKgPerHour,
  heatRateFromEta,
  hydro,
  hydroPowerW,
  fissionMassDefect,
  heatRateBounds,
  ETA_CYCLE_RANGE,
  MEV_J,
  nuclear,
  pumped,
  reservoirEnergyJ,
  roundTrip,
  T_COOL_C,
  T_STEAM_C,
  thermal,
  timesWords,
  withHeatRate,
  type Plants,
  type PumpedIn,
  type ThermalIn,
} from '../src/powersys/modules/generation/calc.ts'
import { EXPERIMENTS } from '../src/powersys/modules/generation/experiments.ts'
import { meta } from '../src/powersys/modules/generation/meta.ts'
import { reliability, verdict } from '../src/powersys/modules/generation/scada.tsx'
import {
  chi2Cdf,
  chi2Quantile,
  DEG,
  estimate,
  LAB0,
  labMeasurements,
  LNR_THRESHOLD,
  MEAS_IDS,
  measDefs,
  minimiseJ,
  NET,
  normals,
  objective,
  rng,
  trueState,
  trueValues,
  type LabState,
  type MeasId,
} from '../src/powersys/modules/generation/se.ts'
import { checkCoal, checkHydro, checkNuclear, checkPumped, verifyData } from '../src/powersys/modules/generation/verify.ts'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
const r01 = rng(20261016)
const between = (a: number, b: number) => a + (b - a) * r01()

// constants re-stated here independently (exact SI values / textbook values)
const E_CHARGE = 1.602176634e-19
const AVOGADRO = 6.02214076e23
const RHO = 1000
const GRAV = 9.81

// ── units ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('unit consistency', () => {
  it('kJ/kWh ↔ efficiency: 1 kWh = 3600 kJ, so η = 3600/HR and HR·η = 3600', () => {
    expect(etaFromHeatRate(3600)).toBe(1)
    for (let k = 0; k < 200; k++) {
      const hr = between(7000, 16000)
      // independent: energy out per kWh (3.6 MJ) over the heat in per kWh (hr kJ = hr × 1000 J)
      expect(etaFromHeatRate(hr)).toBeCloseTo(3.6e6 / (hr * 1000), 14)
      expect(heatRateFromEta(etaFromHeatRate(hr))).toBeCloseTo(hr, 9)
    }
  })

  it('MW ↔ kg/h: coal per hour from the heat flow in SI units', () => {
    for (let k = 0; k < 200; k++) {
      const p = between(50, 1000)
      const hr = between(8000, 14000)
      const cv = between(12000, 30000)
      const heatW = (p * 1e6) / etaFromHeatRate(hr) // J/s
      const kgPerS = heatW / (cv * 1000) // (J/s)/(J/kg)
      expect(rel(fuelKgPerHour(p, hr, cv), kgPerS * 3600)).toBeLessThan(1e-12)
      expect(rel(coalTonnesPerDay(p, hr, cv), (kgPerS * 86400) / 1000)).toBeLessThan(1e-12)
    }
  })

  it('MeV ↔ J: 1 MeV = 10⁶ × e joules', () => {
    expect(rel(MEV_J, 1e6 * E_CHARGE)).toBeLessThan(1e-15)
  })

  it('m³/s and m ↔ MW: P = ρgQHη from first principles (mass flow × g × height per second)', () => {
    for (let k = 0; k < 200; k++) {
      const q = between(1, 2000)
      const h = between(5, 800)
      const eta = between(0.7, 1)
      const massFlow = RHO * q // kg/s
      const potentialPerS = massFlow * GRAV * h // J/s
      expect(rel(hydroPowerW(q, h, eta), potentialPerS * eta)).toBeLessThan(1e-12)
      // and the inverse
      expect(rel(flowForPower(hydroPowerW(q, h, eta) / 1e6, h, eta), q)).toBeLessThan(1e-12)
    }
    // E = ρgVH: 1 million m³ falling 100 m is 981 GJ = 272.5 MWh
    expect(reservoirEnergyJ(1e6, 100)).toBeCloseTo(RHO * GRAV * 1e6 * 100, 3)
    expect(reservoirEnergyJ(1e6, 100) / 3.6e9).toBeCloseTo(9.81e11 / 3.6e9, 9)
  })
})

// ── energy chains ────────────────────────────────────────────────────────────────────────────────────────────

describe('energy balance of the efficiency chains', () => {
  it('a chain: input = output + Σ losses, output = input × Π η', () => {
    for (let k = 0; k < 200; k++) {
      const etas = Array.from({ length: 1 + Math.floor(r01() * 4) }, () => between(0.3, 1))
      const input = between(1, 5000)
      const c = chain(
        'MW',
        'in',
        input,
        etas.map((eta) => ({ eta, lossLabel: 'l', outLabel: 'o' })),
      )
      expect(rel(chainOutput(c) + chainLosses(c), input)).toBeLessThan(1e-12)
      expect(rel(chainOutput(c), input * etas.reduce((p, e) => p * e, 1))).toBeLessThan(1e-12)
      c.steps.forEach((s) => expect(s.loss).toBeGreaterThanOrEqual(0))
    }
  })

  it('coal station: fuel heat = boiler loss + condenser + generator loss + output, and = coal × CV', () => {
    for (let k = 0; k < 300; k++) {
      const i: ThermalIn = {
        pMw: between(50, 1000),
        etaBoiler: between(0.8, 0.94),
        etaCycle: between(0.3, 0.5),
        etaGen: between(0.95, 0.99),
        cvKjKg: between(12000, 30000),
        co2KgPerGj: between(80, 110),
        dTCondK: between(6, 14),
      }
      const r = thermal(i)
      if (!r.ok) throw new Error(r.issues.join())
      expect(rel(r.boilerLossMw + r.condenserMw + r.genLossMw + i.pMw, r.qInMw)).toBeLessThan(1e-12)
      expect(rel((r.fuelKgH * i.cvKjKg) / 3.6e6, r.qInMw)).toBeLessThan(1e-12) // kg/h × kJ/kg = kJ/h → MW
      expect(rel(r.eta, i.etaBoiler * i.etaCycle * i.etaGen)).toBeLessThan(1e-12)
      // condenser cooling water: Q = ṁ c ΔT with c = 4.18 kJ/(kg·K)
      expect(rel(r.coolingM3s * 1000 * 4.18 * i.dTCondK, r.condenserMw * 1000)).toBeLessThan(1e-12)
      // CO₂: GJ of heat per hour × factor
      expect(rel(r.co2TH, (r.qInMw * 3600 * 1e6 * 1e-9 * i.co2KgPerGj) / 1000)).toBeLessThan(1e-12)
    }
  })

  it('setting the heat rate through the steam cycle gives exactly that heat rate — and never leaves the η_cycle range', () => {
    for (let k = 0; k < 300; k++) {
      const base = { ...DEFAULT_THERMAL, etaBoiler: between(0.8, 0.94), etaGen: between(0.95, 0.99) }
      const [lo, hi] = heatRateBounds(base)
      expect(3600 / (lo * base.etaBoiler * base.etaGen)).toBeCloseTo(ETA_CYCLE_RANGE[1], 12)
      expect(3600 / (hi * base.etaBoiler * base.etaGen)).toBeCloseTo(ETA_CYCLE_RANGE[0], 12)
      const hr = between(lo, hi)
      const r = thermal(withHeatRate(base, hr))
      if (!r.ok) throw new Error(r.issues.join())
      expect(rel(r.heatRate, hr)).toBeLessThan(1e-12)
      const any = withHeatRate(base, between(5000, 20000))
      expect(any.etaCycle).toBeGreaterThanOrEqual(ETA_CYCLE_RANGE[0] - 1e-12)
      expect(any.etaCycle).toBeLessThanOrEqual(ETA_CYCLE_RANGE[1] + 1e-12)
    }
    // η_b 0.80, η_g 0.95, HR 8 500 would need η_cycle 55.7 %: clamped to 50 %
    expect(withHeatRate({ ...DEFAULT_THERMAL, etaBoiler: 0.8, etaGen: 0.95 }, 8500).etaCycle).toBeCloseTo(0.5, 12)
  })

  it('the condenser is the largest single loss over the whole allowed range — but not always most of the heat', () => {
    for (let k = 0; k < 500; k++) {
      const r = thermal({ ...DEFAULT_THERMAL, etaBoiler: between(0.8, 0.94), etaCycle: between(0.3, 0.5), etaGen: between(0.95, 0.99) })
      if (!r.ok) throw new Error()
      expect(r.condenserMw).toBeGreaterThan(Math.max(r.boilerLossMw, r.genLossMw))
    }
    const r = thermal(withHeatRate(DEFAULT_THERMAL, 9500))
    if (!r.ok) throw new Error()
    expect(r.condenserMw / r.qInMw).toBeLessThan(0.5)
  })

  it('the default coal station: 500 MW at 10 000 kJ/kWh and 17 000 kJ/kg burns 294.1 t/h', () => {
    const r = thermal(DEFAULT_THERMAL)
    if (!r.ok) throw new Error()
    expect(r.heatRate).toBeCloseTo(10000, 9)
    expect(r.fuelKgH / 1000).toBeCloseTo((500e3 * 10000) / 17000 / 1000, 9)
  })

  it('Carnot limit: 1 − T_c/T_h in kelvin, and a steam cycle above it is refused', () => {
    expect(carnot(T_STEAM_C, T_COOL_C)).toBeCloseTo(1 - (T_COOL_C + 273.15) / (T_STEAM_C + 273.15), 14)
    const r = thermal({ ...DEFAULT_THERMAL, etaCycle: carnot(T_STEAM_C, T_COOL_C) + 0.01 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/Carnot/)
  })

  it('hydro: the water power, losses and output balance; stored energy ρgVH', () => {
    for (let k = 0; k < 200; k++) {
      const i = { pMw: between(10, 1000), headM: between(20, 600), etaTurbine: between(0.8, 0.95), etaGen: between(0.95, 0.99), volumeMm3: between(5, 500) }
      const r = hydro(i)
      if (!r.ok) throw new Error()
      expect(rel(hydroPowerW(r.qM3s, i.headM, 1) / 1e6, r.waterMw)).toBeLessThan(1e-12)
      expect(rel(chainOutput(r.chain), i.pMw)).toBeLessThan(1e-12)
      expect(rel((RHO * GRAV * i.volumeMm3 * 1e6 * i.headM) / 3.6e9, r.storedMwh)).toBeLessThan(1e-12)
      expect(rel(r.hours * i.pMw, r.storedMwh * r.eta)).toBeLessThan(1e-12)
      // water per MWh: one hour of flow per MW
      expect(rel(r.m3PerMwh, 3.6e9 / (RHO * GRAV * i.headM * r.eta))).toBeLessThan(1e-12)
    }
  })
})

// ── nuclear ────────────────────────────────────────────────────────────────────────────────────────────────

describe('nuclear: fission energy', () => {
  it('energy per kg of U-235 from Avogadro, computed independently here', () => {
    const atoms = (1000 / 235.0439) * AVOGADRO
    const perFissionJ = 200 * 1e6 * E_CHARGE
    expect(rel(fissionEnergyPerKgJ(), atoms * perFissionJ)).toBeLessThan(1e-14)
    // the well-known order: about 8.2 × 10¹³ J per kg, about 0.95 MW·day per gram
    expect(fissionEnergyPerKgJ()).toBeGreaterThan(8.1e13)
    expect(fissionEnergyPerKgJ()).toBeLessThan(8.3e13)
    expect(fissionEnergyPerKgJ() / 1000 / 86400 / 1e6).toBeCloseTo(0.95, 2)
  })

  it('a genuine mass defect: U-235 + n → Ba-141 + Kr-92 + 3n from atomic masses gives ≈ 173 MeV, 80–100 % of the 200 MeV total', () => {
    // atomic masses restated here (u): U-235 235.0439299, n 1.0086649, Ba-141 140.9144033, Kr-92 91.9261731
    const dm = 235.0439299 + 1.0086649 - (140.9144033 + 91.9261731 + 3 * 1.0086649)
    const md = fissionMassDefect()
    expect(md.dmU).toBeCloseTo(dm, 12)
    expect(md.dmU).toBeCloseTo(0.18602, 5)
    expect(md.mev).toBeCloseTo(dm * 931.49410242, 9)
    expect(md.mev).toBeGreaterThan(173)
    expect(md.mev).toBeLessThan(173.6)
    expect(md.mev / 200).toBeGreaterThan(0.8)
    expect(md.mev / 200).toBeLessThan(1)
  })

  it('fuel per day = reactor heat × 1 day / energy per kg; fission rate = heat / energy per fission', () => {
    for (let k = 0; k < 100; k++) {
      const pMw = between(200, 1600)
      const etaTh = between(0.28, 0.4)
      const r = nuclear({ pMw, etaTh })
      if (!r.ok) throw new Error()
      const heatJperDay = (pMw / etaTh) * 1e6 * 86400
      expect(rel(r.kgPerDay, heatJperDay / ((1000 / 235.0439) * AVOGADRO * 200e6 * E_CHARGE))).toBeLessThan(1e-12)
      expect(rel(r.fissionsPerS, ((pMw / etaTh) * 1e6) / (200e6 * E_CHARGE))).toBeLessThan(1e-12)
      expect(rel(r.rejectedMw + pMw, r.thermalMw)).toBeLessThan(1e-12)
    }
    const d = nuclear(DEFAULT_NUCLEAR)
    if (!d.ok) throw new Error()
    expect(d.kgPerDay).toBeGreaterThan(3.1)
    expect(d.kgPerDay).toBeLessThan(3.3)
  })
})

// ── pumped storage ─────────────────────────────────────────────────────────────────────────────────────────

describe('pumped storage: the round trip', () => {
  it('E_out = E_in · η_m·η_p·η_t·η_g, the same through the water volume, and the energies balance', () => {
    for (let k = 0; k < 300; k++) {
      const i: PumpedIn = {
        pMw: between(50, 1000),
        headM: between(100, 600),
        etaMotor: between(0.9, 0.99),
        etaPump: between(0.8, 0.95),
        etaTurbine: between(0.8, 0.95),
        etaGen: between(0.9, 0.99),
        hoursPumping: between(1, 10),
        mode: r01() < 0.5 ? 'pump' : 'generate',
      }
      const r = pumped(i)
      if (!r.ok) throw new Error()
      const prod = i.etaMotor * i.etaPump * i.etaTurbine * i.etaGen
      expect(rel(r.etaRt, prod)).toBeLessThan(1e-14)
      expect(rel(roundTrip(i), prod)).toBeLessThan(1e-14)
      expect(rel(r.eOutMwh, i.pMw * i.hoursPumping * prod)).toBeLessThan(1e-12)
      // through the water: V = stored/(ρgH), back down: ρgVH·η_t·η_g
      const V = (i.pMw * i.hoursPumping * i.etaMotor * i.etaPump * 3.6e9) / (RHO * GRAV * i.headM)
      expect(rel(r.volumeM3, V)).toBeLessThan(1e-12)
      expect(rel((RHO * GRAV * V * i.headM * i.etaTurbine * i.etaGen) / 3.6e9, r.eOutMwh)).toBeLessThan(1e-12)
      expect(rel(chainLosses(r.chain) + r.eOutMwh, r.eInMwh)).toBeLessThan(1e-12)
      expect(rel(r.breakEven * r.etaRt, 1)).toBeLessThan(1e-14)
      // flows: pumping volume / pumping time; generating the same volume back at the rating
      expect(rel(r.qPump * i.hoursPumping * 3600, V)).toBeLessThan(1e-12)
      expect(rel(r.qGen * r.hoursGen * 3600, V)).toBeLessThan(1e-12)
    }
  })

  it('the mode changes nothing but the direction', () => {
    const a = pumped({ ...DEFAULT_PUMPED, mode: 'pump' })
    const b = pumped({ ...DEFAULT_PUMPED, mode: 'generate' })
    if (!a.ok || !b.ok) throw new Error()
    expect(a.eOutMwh).toBe(b.eOutMwh)
  })
})

// ── invalid inputs ─────────────────────────────────────────────────────────────────────────────────────────

describe('invalid inputs give reasons, never numbers', () => {
  it('stations', () => {
    for (const bad of [NaN, -1, 0, Infinity]) {
      expect(thermal({ ...DEFAULT_THERMAL, pMw: bad }).ok).toBe(false)
      expect(thermal({ ...DEFAULT_THERMAL, cvKjKg: bad }).ok).toBe(false)
      expect(hydro({ ...DEFAULT_HYDRO, headM: bad }).ok).toBe(false)
      expect(hydro({ ...DEFAULT_HYDRO, volumeMm3: bad }).ok).toBe(false)
      expect(nuclear({ ...DEFAULT_NUCLEAR, pMw: bad }).ok).toBe(false)
      expect(pumped({ ...DEFAULT_PUMPED, hoursPumping: bad }).ok).toBe(false)
    }
    for (const eta of [0, 1.2, -0.5, NaN]) {
      expect(thermal({ ...DEFAULT_THERMAL, etaBoiler: eta }).ok).toBe(false)
      expect(hydro({ ...DEFAULT_HYDRO, etaTurbine: eta }).ok).toBe(false)
      expect(nuclear({ ...DEFAULT_NUCLEAR, etaTh: eta }).ok).toBe(false)
      expect(pumped({ ...DEFAULT_PUMPED, etaPump: eta }).ok).toBe(false)
    }
    const r = thermal({ ...DEFAULT_THERMAL, pMw: -5 })
    expect(r.ok === false && r.issues.length > 0).toBe(true)
  })

  it('estimator: non-positive σ or non-finite values are invalid; too few or wrong measurements are unobservable', () => {
    expect(estimate([{ id: 'P12', z: 1, sigma: 0 }]).ok).toBe(false)
    expect(estimate([{ id: 'P12', z: NaN, sigma: 0.01 }]).ok).toBe(false)
    const one = estimate([{ id: 'P12', z: 1, sigma: 0.01 }])
    expect(one.ok === false && one.reason === 'unobservable').toBe(true)
    // flow 2→3 alone (twice) only sees θ₂ − θ₃
    const p23 = estimate([
      { id: 'P23', z: 0.1, sigma: 0.01 },
      { id: 'P23', z: 0.11, sigma: 0.01 },
    ])
    expect(p23.ok === false && p23.reason === 'unobservable').toBe(true)
    // and the lab's verdict says so, with no numbers
    const lab: LabState = { ...LAB0, enabled: { P12: false, P13: false, P23: true, P1: false, P2: false, P3: false, TH3: false } }
    const v = verdict(estimate(labMeasurements(lab)), lab)
    expect(v.tone).toBe('bad')
    expect(v.text).not.toMatch(/NaN|undefined|Infinity/)
  })
})

// ── state estimation ─────────────────────────────────────────────────────────────────────────────────────────

/** A random lab state (any subset of meters, any accuracies, any noise seed, maybe a gross error). */
function randomLab(): LabState {
  const enabled = Object.fromEntries(MEAS_IDS.map((id) => [id, r01() < 0.65])) as Record<MeasId, boolean>
  const id = MEAS_IDS[Math.floor(r01() * MEAS_IDS.length)]
  return {
    enabled,
    sigma: { flowMw: between(0.2, 5), injMw: between(0.5, 10), angleDeg: between(0.01, 0.5) },
    noise: r01() < 0.8,
    seed: Math.floor(r01() * 1e6),
    bad: r01() < 0.5 ? { id, size: id === 'TH3' ? between(-2, 2) : between(-60, 60) } : null,
  }
}

describe('WLS state estimation', () => {
  it('the true state is a DC load flow: the flows into each bus add up to its injection', () => {
    const tv = trueValues()
    expect(tv.P12 + tv.P13).toBeCloseTo(tv.P1, 14)
    expect(-tv.P12 + tv.P23).toBeCloseTo(tv.P2, 14)
    expect(-tv.P13 - tv.P23).toBeCloseTo(tv.P3, 14)
    expect(tv.P2).toBeCloseTo(-0.9, 14)
    expect(tv.P3).toBeCloseTo(-0.6, 14)
    expect(tv.P1).toBeCloseTo(1.5, 14)
  })

  it('normal equations vs a direct numerical minimisation of J(x) — agree to 1e-9 rad over random labs', () => {
    let n = 0
    for (let k = 0; k < 600; k++) {
      const ms = labMeasurements(randomLab())
      const se = estimate(ms)
      if (!se.ok) continue
      n++
      const d = minimiseJ(ms)
      expect(Math.abs(d.x[0] - se.x[0])).toBeLessThan(1e-9)
      expect(Math.abs(d.x[1] - se.x[1])).toBeLessThan(1e-9)
      // and x̂ really is the minimum: any nearby state has a larger J
      for (let j = 0; j < 4; j++) {
        const dx: [number, number] = [se.x[0] + between(-1e-3, 1e-3), se.x[1] + between(-1e-3, 1e-3)]
        expect(objective(ms, dx)).toBeGreaterThanOrEqual(se.J)
      }
      expect(se.J).toBeCloseTo(objective(ms, se.x), 9)
    }
    expect(n).toBeGreaterThan(200)
  })

  it('with exact measurements the residuals are zero and x̂ is the true state, for every observable meter set', () => {
    const xt = trueState()
    for (let mask = 1; mask < 1 << MEAS_IDS.length; mask++) {
      const enabled = Object.fromEntries(MEAS_IDS.map((id, i) => [id, !!(mask & (1 << i))])) as Record<MeasId, boolean>
      const se = estimate(labMeasurements({ ...LAB0, enabled, noise: false, bad: null }))
      if (!se.ok) continue
      expect(Math.abs(se.x[0] - xt[0])).toBeLessThan(1e-12)
      expect(Math.abs(se.x[1] - xt[1])).toBeLessThan(1e-12)
      se.meas.forEach((m) => expect(Math.abs(m.r)).toBeLessThan(1e-12))
      expect(se.J).toBeLessThan(1e-20)
    }
  })

  it('residual statistics: E[J] = m − n and each r_N has unit variance (Monte Carlo, 4000 samples)', () => {
    const N = 4000
    let sumJ = 0
    const sumRn2 = new Map<MeasId, number>()
    for (let s = 0; s < N; s++) {
      const se = estimate(labMeasurements({ ...LAB0, seed: 10000 + s }))
      if (!se.ok) throw new Error()
      sumJ += se.J
      for (const m of se.meas) sumRn2.set(m.id, (sumRn2.get(m.id) ?? 0) + (m.rN ?? 0) ** 2)
    }
    expect(sumJ / N).toBeGreaterThan(4 * 0.93)
    expect(sumJ / N).toBeLessThan(4 * 1.07)
    for (const v of sumRn2.values()) {
      expect(v / N).toBeGreaterThan(0.9)
      expect(v / N).toBeLessThan(1.1)
    }
  })

  it('adding any measurement never increases the variance of the estimate', () => {
    for (let mask = 1; mask < 1 << MEAS_IDS.length; mask++) {
      const enabled = Object.fromEntries(MEAS_IDS.map((id, i) => [id, !!(mask & (1 << i))])) as Record<MeasId, boolean>
      const a = estimate(labMeasurements({ ...LAB0, enabled }))
      if (!a.ok) continue
      for (const extra of MEAS_IDS.filter((id) => !enabled[id])) {
        const b = estimate(labMeasurements({ ...LAB0, enabled: { ...enabled, [extra]: true } }))
        if (!b.ok) throw new Error('adding a meter cannot make it unobservable')
        expect(b.cov[0][0]).toBeLessThanOrEqual(a.cov[0][0] * (1 + 1e-12))
        expect(b.cov[1][1]).toBeLessThanOrEqual(a.cov[1][1] * (1 + 1e-12))
      }
    }
  })

  it('χ² quantiles: closed forms for 2 and 4 degrees of freedom, the table value for 1', () => {
    // k = 2: F(x) = 1 − e^(−x/2)  →  x = −2 ln(0.01)
    expect(chi2Quantile(0.99, 2)).toBeCloseTo(-2 * Math.log(0.01), 8)
    // k = 4: F(x) = 1 − e^(−x/2)(1 + x/2), solved here by its own bisection
    let lo = 0
    let hi = 50
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (1 - Math.exp(-mid / 2) * (1 + mid / 2) < 0.99) lo = mid
      else hi = mid
    }
    expect(chi2Quantile(0.99, 4)).toBeCloseTo(lo, 8)
    expect(chi2Quantile(0.99, 1)).toBeCloseTo(6.635, 3)
    for (let k = 0; k < 50; k++) {
      const x = between(0.01, 40)
      expect(chi2Cdf(x, 2)).toBeCloseTo(1 - Math.exp(-x / 2), 12)
      expect(chi2Cdf(x, 4)).toBeCloseTo(1 - Math.exp(-x / 2) * (1 + x / 2), 12)
    }
  })

  it('bad data: with all six power meters, a single gross error of 15–50 σ is flagged on the right meter (random tests)', () => {
    // Detection rule: the largest normalised residual r_N = |r|/√Ω_ii, flagged if above 3; J(x̂) tested against χ² (99 %).
    const ids: MeasId[] = ['P12', 'P13', 'P23', 'P1', 'P2', 'P3']
    let trials = 0
    for (let k = 0; k < 600; k++) {
      const id = ids[Math.floor(r01() * ids.length)]
      const sigmaMw = defsKind(id) === 'flow' ? LAB0.sigma.flowMw : LAB0.sigma.injMw
      const size = (r01() < 0.5 ? -1 : 1) * between(15, 50) * sigmaMw
      const lab: LabState = { ...LAB0, seed: Math.floor(r01() * 1e6), bad: { id, size } }
      const se = estimate(labMeasurements(lab))
      if (!se.ok) throw new Error()
      trials++
      expect(se.flagged).toBe(id)
      expect(se.ties).toEqual([id])
      expect(se.detected).toBe(true)
      expect(verdict(se, lab).caught).toBe(true)
    }
    expect(trials).toBe(600)
  })

  it('…and without a gross error, false alarms are rare (largest r_N > 3 in under 5 % of samples)', () => {
    let alarms = 0
    for (let s = 0; s < 1000; s++) {
      const se = estimate(labMeasurements({ ...LAB0, seed: 50000 + s }))
      if (se.ok && se.flagged) alarms++
    }
    expect(alarms / 1000).toBeLessThan(0.05)
  })

  it('cannot locate: with only the three line flows (m − n = 1) every normalised residual is equal — detected, not identified', () => {
    const enabled = { P12: true, P13: true, P23: true, P1: false, P2: false, P3: false, TH3: false }
    for (const id of ['P12', 'P13', 'P23'] as MeasId[]) {
      const lab: LabState = { ...LAB0, enabled, bad: { id, size: 30 } }
      const se = estimate(labMeasurements(lab))
      if (!se.ok) throw new Error()
      expect(se.dof).toBe(1)
      const rn = se.meas.map((m) => m.rN as number)
      expect(Math.max(...rn) - Math.min(...rn)).toBeLessThan(1e-9 * Math.max(...rn))
      expect(se.ties.length).toBe(3)
      expect(se.pairs.length).toBe(3)
      expect(se.detected).toBe(true)
      const v = verdict(se, lab)
      expect(v.caught).toBe(false)
      expect(v.title).toMatch(/cannot be located/)
    }
  })

  it('cannot detect: a critical measurement (its removal makes the network unobservable) never shows its error', () => {
    // flow 1→2 is the only measurement of θ₂: critical. Flow 1→3 and the PMU angle both see only θ₃: a critical pair.
    const enabled = { P12: true, P13: true, P23: false, P1: false, P2: false, P3: false, TH3: true }
    const clean = estimate(labMeasurements({ ...LAB0, enabled }))
    const lab: LabState = { ...LAB0, enabled, bad: { id: 'P12', size: 50 } }
    const se = estimate(labMeasurements(lab))
    if (!se.ok || !clean.ok) throw new Error()
    const p12 = se.meas.find((m) => m.id === 'P12')!
    expect(p12.critical).toBe(true)
    expect(Math.abs(p12.r)).toBeLessThan(1e-12)
    expect(se.J).toBeCloseTo(clean.J, 9) // the error left J unchanged …
    expect(Math.abs(se.x[0] - clean.x[0]) / DEG).toBeGreaterThan(1) // … but moved the estimate of θ₂
    expect(se.pairs).toEqual([['P13', 'TH3']])
    const v = verdict(se, lab)
    expect(v.caught).toBe(false)
    expect(v.title).toMatch(/critical/)
  })

  it('the noise is reproducible (seeded) and standard normal', () => {
    expect(normals(5, 10)).toEqual(normals(5, 10))
    const xs = normals(99, 20000)
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(v - 1)).toBeLessThan(0.04)
  })
})

function defsKind(id: MeasId) {
  return measDefs(NET)[id].kind
}

// ── Verify holds for every valid input ──────────────────────────────────────────────────────────────────────

describe('Verify: every check holds for every valid input', () => {
  const randomPlants = (): Plants => ({
    type: 'thermal',
    thermal: {
      pMw: between(50, 1000),
      etaBoiler: between(0.8, 0.94),
      etaCycle: between(0.3, 0.5),
      etaGen: between(0.95, 0.99),
      cvKjKg: between(12000, 30000),
      co2KgPerGj: between(80, 110),
      dTCondK: between(6, 14),
    },
    hydro: { pMw: between(10, 1000), headM: between(20, 600), etaTurbine: between(0.8, 0.95), etaGen: between(0.95, 0.99), volumeMm3: between(5, 500) },
    nuclear: { pMw: between(200, 1600), etaTh: between(0.28, 0.4) },
    pumped: {
      pMw: between(50, 1000),
      headM: between(100, 600),
      etaMotor: between(0.9, 0.99),
      etaPump: between(0.8, 0.95),
      etaTurbine: between(0.8, 0.95),
      etaGen: between(0.9, 0.99),
      hoursPumping: between(1, 10),
      mode: 'generate',
    },
  })
  const allOk = (p: Plants, l: LabState) => {
    const v = verifyData(p, l)
    expect(v.thermal.ok).toBe(true)
    expect(v.thermal.balanceOk).toBe(true)
    expect(v.hydro.ok).toBe(true)
    expect(v.nuclear.ok).toBe(true)
    expect(v.nuclear.mdOk).toBe(true)
    expect(v.pumped.ok).toBe(true)
    expect(v.pumped.balanceOk).toBe(true)
    expect(v.wls.ok).toBe(true)
    expect(v.exact.ok).toBe(true)
    return v
  }
  it('random stations and random labs (including unobservable ones, which fall back to the default lab)', () => {
    for (let k = 0; k < 400; k++) allOk(randomPlants(), randomLab())
  })
  it('edges of every range, and the heat-rate slider’s ends', () => {
    const lo = randomPlants()
    lo.thermal = { ...DEFAULT_THERMAL, pMw: 50, etaBoiler: 0.8, etaCycle: 0.3, etaGen: 0.95, cvKjKg: 12000, dTCondK: 6 }
    lo.hydro = { pMw: 10, headM: 20, etaTurbine: 0.8, etaGen: 0.95, volumeMm3: 5 }
    lo.pumped = { ...DEFAULT_PUMPED, pMw: 50, headM: 100, hoursPumping: 1, etaMotor: 0.9, etaPump: 0.8, etaTurbine: 0.8, etaGen: 0.9 }
    lo.nuclear = { pMw: 200, etaTh: 0.28 }
    allOk(lo, LAB0)
    const hi = randomPlants()
    hi.thermal = { ...DEFAULT_THERMAL, pMw: 1000, etaBoiler: 0.94, etaCycle: 0.5, etaGen: 0.99, cvKjKg: 30000, dTCondK: 14 }
    hi.hydro = { pMw: 1000, headM: 600, etaTurbine: 0.95, etaGen: 0.99, volumeMm3: 500 }
    hi.pumped = { ...DEFAULT_PUMPED, pMw: 1000, headM: 600, hoursPumping: 10, etaMotor: 0.99, etaPump: 0.95, etaTurbine: 0.95, etaGen: 0.99 }
    hi.nuclear = { pMw: 1600, etaTh: 0.4 }
    allOk(hi, { ...LAB0, sigma: { flowMw: 0.2, injMw: 10, angleDeg: 0.01 }, enabled: { ...LAB0.enabled, TH3: true }, bad: { id: 'TH3', size: 2 } })
    for (const hr of [5000, 8500, 13000, 20000]) allOk({ ...DEFAULT_PLANTS, thermal: withHeatRate({ ...DEFAULT_THERMAL, etaBoiler: 0.8, etaGen: 0.95 }, hr) }, LAB0)
  })
  it('each second route can fail: a model value that is off by 0.1 % is caught', () => {
    for (let k = 0; k < 50; k++) {
      const p = randomPlants()
      const th = thermal(p.thermal)
      const hy = hydro(p.hydro)
      const nu = nuclear(p.nuclear)
      const pu = pumped(p.pumped)
      if (!th.ok || !hy.ok || !nu.ok || !pu.ok) throw new Error()
      expect(checkCoal(p.thermal, th).ok).toBe(true)
      expect(checkCoal(p.thermal, { ...th, fuelKgH: th.fuelKgH * 1.001 }).ok).toBe(false)
      expect(checkCoal(p.thermal, { ...th, qInMw: th.qInMw * 1.001 }).ok).toBe(false)
      expect(checkHydro(p.hydro, hy).ok).toBe(true)
      expect(checkHydro(p.hydro, { ...hy, qM3s: hy.qM3s * 1.001 }).ok).toBe(false)
      expect(checkNuclear(p.nuclear, nu).ok).toBe(true)
      expect(checkNuclear(p.nuclear, { kgPerDay: nu.kgPerDay * 1.001 }).ok).toBe(false)
      expect(checkPumped(p.pumped, pu).ok).toBe(true)
      expect(checkPumped(p.pumped, { ...pu, qGen: pu.qGen * 1.001 }).ok).toBe(false)
      expect(checkPumped(p.pumped, { ...pu, qPump: pu.qPump * 1.001 }).ok).toBe(false)
      expect(checkPumped(p.pumped, { ...pu, eOutMwh: pu.eOutMwh * 1.001 }).ok).toBe(false)
    }
    // the mass-defect plausibility check fails for wrong masses
    const wrong = fissionMassDefect({ U235: 235.0439299, n: 1.0086649, Ba141: 140.9644033, Kr92: 91.9261731 })
    expect(wrong.mev / 200).toBeLessThan(0.8)
  })
  it('invalid Explore inputs fall back to the defaults (and say so)', () => {
    const v = verifyData({ ...DEFAULT_PLANTS, hydro: { ...DEFAULT_HYDRO, headM: -1 } }, { ...LAB0, enabled: { P12: true, P13: false, P23: false, P1: false, P2: false, P3: false, TH3: false } })
    expect(v.own).toBe(false)
    expect(v.ownLab).toBe(false)
    expect(v.plants).toBe(DEFAULT_PLANTS)
  })
})

// ── experiments ───────────────────────────────────────────────────────────────────────────────────────────

describe('experiments: answers decided from the computation', () => {
  it('each runs, its answer is one of its options, and its text has no unformatted numbers', () => {
    for (const e of EXPERIMENTS) {
      const r = e.run()
      expect(e.options.map((o) => o.id)).toContain(r.answer)
      for (const t of r.explain) expect(t).not.toMatch(/NaN|undefined|Infinity/)
      for (const row of r.rows) {
        expect(Number.isFinite(row.before)).toBe(true)
        expect(Number.isFinite(row.after)).toBe(true)
      }
    }
  })
  it('the expected answers follow from independent arithmetic', () => {
    const get = (id: string) => EXPERIMENTS.find((e) => e.id === id)!.run()
    const saving = 1 - 9500 / 10500 // fuel ∝ heat rate
    expect(get('heat-rate').answer).toBe(saving < 0.05 ? 'lt5' : saving <= 0.15 ? '5to15' : 'gt15')
    expect(get('head').answer).toBe('x2') // P ∝ H at fixed Q
    const coalKg = ((1000e3 * 10000) / 17000) * 24
    const u235 = ((1000 / 0.33) * 1e6 * 86400) / ((1000 / 235.0439) * AVOGADRO * 200e6 * E_CHARGE)
    expect(coalKg / u235).toBeGreaterThan(1e6)
    expect(get('nuclear-coal').answer).toBe('e6')
    const back = 100 * 0.98 * 0.9 * 0.91 * 0.98
    expect(get('round-trip').answer).toBe(Math.abs(back - 78) < Math.abs(back - 95) && Math.abs(back - 78) < Math.abs(back - 60) ? '78' : 'other')
    expect(get('redundancy').answer).toBe('down')
    expect(get('bad-data').answer).toBe('P23')
  })
})

describe('honest statements about redundancy', () => {
  const none: Record<MeasId, boolean> = { P12: false, P13: false, P23: false, P1: false, P2: false, P3: false, TH3: false }
  it('the Monte-Carlo panel says when nothing can be tested (unobservable, m = n) and when a meter is critical or paired', () => {
    const un = reliability({ ...LAB0, enabled: { ...none, P23: true } })
    expect(un.n).toBe(0)
    expect(un.text).toMatch(/unobservable/)
    const exact2 = reliability({ ...LAB0, enabled: { ...none, P12: true, P13: true } })
    expect(exact2.n).toBe(0)
    expect(exact2.text).toMatch(/no redundancy/)
    const crit = reliability({ ...LAB0, enabled: { ...none, P12: true, P13: true, TH3: true }, bad: { id: 'P12', size: 50 } })
    expect(crit.text).toMatch(/critical in this set: its error can never be flagged \(0 of 200/)
    const pair = reliability({ ...LAB0, enabled: { ...none, P12: true, P13: true, P23: true, TH3: true }, bad: { id: 'P12', size: 50 } })
    expect(pair.text).toMatch(/critical pair with Flow 2→3/)
  })
  it('m − n = 2 does not guarantee location: some sets still contain a critical pair (counted here)', () => {
    let sets = 0
    let withPair = 0
    for (let mask = 1; mask < 1 << MEAS_IDS.length; mask++) {
      const enabled = Object.fromEntries(MEAS_IDS.map((id, i) => [id, !!(mask & (1 << i))])) as Record<MeasId, boolean>
      const se = estimate(labMeasurements({ ...LAB0, enabled }))
      if (!se.ok || se.dof !== 2) continue
      sets++
      if (se.pairs.length) withPair++
    }
    expect(sets).toBeGreaterThan(0)
    expect(withPair).toBe(10)
    const e = EXPERIMENTS.find((x) => x.id === 'redundancy')!.run()
    const after = estimate(labMeasurements({ ...LAB0, enabled: { ...none, P12: true, P13: true, P23: true, P2: true } }))
    if (!after.ok) throw new Error()
    expect(e.explain.join(' ')).toMatch(after.pairs.length ? /still cannot be told apart/ : /there is no critical pair/)
    expect(e.explain.join(' ')).toMatch(/unless the meter belongs to a critical pair/)
  })
})

// ── words and meta ─────────────────────────────────────────────────────────────────────────────────────────

describe('computed wording and the module description', () => {
  it('timesWords and changeWords state the number', () => {
    expect(timesWords(3.76e6)).toBe('about 3.8 million times')
    expect(timesWords(12000)).toMatch(/12,000/)
    expect(changeWords(90, 100)).toBe('falls 10.0 %')
    expect(changeWords(103, 100)).toBe('rises 3.0 %')
    expect(changeWords(100, 100)).toBe('does not change')
  })
  it('meta: ready, five modes, six activities with unique ids, the agreed id and number', () => {
    expect(meta.id).toBe('generation')
    expect(meta.n).toBe(17)
    expect(meta.status).toBe('ready')
    expect(meta.modes).toEqual(['learn', 'explore', 'experiment', 'verify', 'practise'])
    expect(meta.activities.length).toBe(6)
    expect(new Set(meta.activities.map((a) => a.id)).size).toBe(6)
    expect(meta.learn.length).toBeGreaterThanOrEqual(3)
    expect(meta.learn.length).toBeLessThanOrEqual(5)
  })
  it('defaults are valid and sensible', () => {
    expect(thermal(DEFAULT_PLANTS.thermal).ok).toBe(true)
    expect(hydro(DEFAULT_PLANTS.hydro).ok).toBe(true)
    expect(nuclear(DEFAULT_PLANTS.nuclear).ok).toBe(true)
    expect(pumped(DEFAULT_PLANTS.pumped).ok).toBe(true)
    const se = estimate(labMeasurements(LAB0))
    expect(se.ok && !se.flagged && !se.detected).toBe(true)
    expect(LNR_THRESHOLD).toBe(3)
  })
})
