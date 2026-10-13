import { describe, expect, it } from 'vitest'
import { alternator, EMF_FACTOR, phaseEmf, syncFrequency, syncMotor, syncSpeedRpm } from '../src/machines/calculations/sync.ts'
import { chainEfficiency, evDrive, G_ACC, genset, inverterMotor, motorLoad, powerChain, radPerS, regen, RHO_AIR, rpmOf, shaftPower } from '../src/machines/calculations/systems.ts'
import { MODEL_LOADERS } from '../src/machines/models/index.ts'
import { machineById } from '../src/machines/catalog.ts'

/*
 * Synchronous machines and electromechanical systems of the 3D Machines Lab: every explicit relation, its edge
 * cases and the power balances. Tolerances are floating-point only (1e-9 relative or better): these are closed
 * forms, nothing is integrated.
 */

const ALT = { poles: 4, n: 1500, ifield: 4.5, kf: 0.004, turns: 60, kw: 0.95, xs: 2, ra: 0.1, rl: 10 }
const SM = { vline: 400, f: 50, poles: 4, e: 260, xs: 6, tl: 80 }

describe('synchronous machines: basic relations', () => {
  it('f = P·n/120 and Ns = 120·f/P are inverse', () => {
    expect(syncFrequency(4, 1500)).toBe(50)
    expect(syncFrequency(2, 3600)).toBe(60)
    expect(syncFrequency(40, 150)).toBe(50) // slow hydro generator
    expect(syncSpeedRpm(50, 6)).toBeCloseTo(1000, 12)
    for (const p of [2, 4, 6, 8]) expect(syncFrequency(p, syncSpeedRpm(50, p))).toBeCloseTo(50, 12)
  })
  it('E = 4.44·kw·N·f·Φ (the factor is √2·π)', () => {
    expect(EMF_FACTOR).toBeCloseTo(4.4429, 4)
    expect(phaseEmf(1, 100, 50, 0.01)).toBeCloseTo(222.144, 3)
    expect(phaseEmf(0.95, 60, 50, 0.018)).toBeCloseTo(EMF_FACTOR * 0.95 * 60 * 50 * 0.018, 12)
  })
})

describe('alternator on a resistive load', () => {
  const r = alternator(ALT)!
  it('frequency, flux, EMF at the defaults', () => {
    expect(r.f).toBe(50)
    expect(r.flux).toBeCloseTo(0.018, 12)
    expect(r.e).toBeCloseTo(227.92, 2)
    expect(r.eLine).toBeCloseTo(Math.sqrt(3) * r.e, 12)
  })
  it('the phasor equation E = V + I·(Ra + jXs) holds (I in phase with V)', () => {
    expect(r.i).toBeCloseTo(r.e / Math.hypot(10.1, 2), 12)
    expect(r.v).toBeCloseTo(r.i * 10, 12)
    expect(Math.hypot(r.v + r.i * 0.1, r.i * 2)).toBeCloseTo(r.e, 9)
    expect(Math.tan(r.delta)).toBeCloseTo((r.i * 2) / (r.v + r.i * 0.1), 12)
    expect(r.v).toBeLessThan(r.e) // regulation: V < E under load
  })
  it('power balance: Pmech = Pout + Pcu = T·ω', () => {
    expect(r.pout).toBeCloseTo(3 * r.v * r.i, 9)
    expect(r.pmech).toBeCloseTo(r.pout + r.pcu, 9)
    expect(r.torque * r.w).toBeCloseTo(r.pmech, 9)
    expect(r.w).toBeCloseTo((2 * Math.PI * 1500) / 60, 12)
    expect(r.eff!).toBeCloseTo(10 / 10.1, 12) // with a resistive load η = RL/(RL + Ra)
  })
  it('speed doubles → f and E double; field current raises E but not f', () => {
    const fast = alternator({ ...ALT, n: 3000 })!
    expect(fast.f).toBeCloseTo(2 * r.f, 12)
    expect(fast.e).toBeCloseTo(2 * r.e, 9)
    const more = alternator({ ...ALT, ifield: 9 })!
    expect(more.f).toBe(r.f)
    expect(more.e).toBeCloseTo(2 * r.e, 9)
  })
  it('more load (smaller RL) → more current, more counter-torque, lower terminal voltage', () => {
    const heavy = alternator({ ...ALT, rl: 5 })!
    expect(heavy.i).toBeGreaterThan(r.i)
    expect(heavy.torque).toBeGreaterThan(r.torque)
    expect(heavy.v).toBeLessThan(r.v)
    expect(heavy.delta).toBeGreaterThan(r.delta)
  })
  it('near open circuit V → E; no excitation → no EMF, no torque, efficiency undefined', () => {
    const open = alternator({ ...ALT, rl: 1e9 })!
    expect(open.v / open.e).toBeCloseTo(1, 6)
    const dead = alternator({ ...ALT, ifield: 0 })!
    expect(dead.e).toBe(0)
    expect(dead.torque).toBe(0)
    expect(dead.eff).toBeNull()
    expect(dead.delta).toBe(0)
  })
  it('impossible inputs give null, not invented numbers', () => {
    expect(alternator({ ...ALT, n: 0 })).toBeNull()
    expect(alternator({ ...ALT, rl: 0 })).toBeNull()
    expect(alternator({ ...ALT, poles: 0 })).toBeNull()
  })
})

describe('synchronous motor on an infinite bus', () => {
  const r = syncMotor(SM)!
  it('runs exactly at Ns; P = 3·V·E·sin δ / Xs = T·ωs', () => {
    expect(r.pullOut).toBe(false)
    expect(r.ns).toBe(1500)
    expect(r.v).toBeCloseTo(400 / Math.sqrt(3), 12)
    expect(r.pout!).toBeCloseTo(80 * r.ws, 9)
    expect((3 * r.v * 260 * Math.sin(r.delta!)) / 6).toBeCloseTo(r.pout!, 9)
    expect((r.delta! * 180) / Math.PI).toBeCloseTo(24.76, 1)
  })
  it('pull-out torque Tmax = 3·V·E/(Xs·ωs); above it there is no steady state', () => {
    expect(r.tmax).toBeCloseTo((3 * r.v * 260) / (6 * r.ws), 9)
    const out = syncMotor({ ...SM, tl: r.tmax * 1.01 })!
    expect(out.pullOut).toBe(true)
    expect(out.delta).toBeNull()
    expect(out.i).toBeNull()
    const edge = syncMotor({ ...SM, tl: r.tmax * 0.999999 })!
    expect(edge.pullOut).toBe(false)
    expect(edge.delta!).toBeCloseTo(Math.PI / 2, 2)
  })
  it('load angle grows with load at the same speed', () => {
    const more = syncMotor({ ...SM, tl: 160 })!
    expect(more.ns).toBe(r.ns)
    expect(more.delta!).toBeGreaterThan(r.delta!)
    expect(Math.sin(more.delta!)).toBeCloseTo(2 * Math.sin(r.delta!), 9)
  })
  it('current phasor: |I| = |V − E∠−δ|/Xs and 3·V·Re(I) = P', () => {
    const ire = (260 * Math.sin(r.delta!)) / 6
    const iim = -(r.v - 260 * Math.cos(r.delta!)) / 6
    expect(r.i!).toBeCloseTo(Math.hypot(ire, iim), 12)
    const vecDiff = Math.hypot(r.v - 260 * Math.cos(r.delta!), 260 * Math.sin(r.delta!))
    expect(r.i!).toBeCloseTo(vecDiff / 6, 12)
    expect(3 * r.v * ire).toBeCloseTo(r.pout!, 9)
    expect(r.pf!).toBeCloseTo(r.pout! / (3 * r.v * r.i!), 12)
  })
  it('excitation sets the reactive power: over-excited leads, under-excited lags, E·cos δ = V gives unity pf', () => {
    expect(r.q!).toBeLessThan(0) // E = 260 V > V = 231 V at this load: over-excited
    expect(r.leading).toBe(true)
    const under = syncMotor({ ...SM, e: 150 })!
    expect(under.q!).toBeGreaterThan(0)
    expect(under.leading).toBe(false)
    // choose E so that E·cos δ = V: E² = V² + (P·Xs/3V)²
    const pq = (80 * r.ws * 6) / (3 * r.v)
    const unity = syncMotor({ ...SM, e: Math.hypot(r.v, pq) })!
    expect(unity.q!).toBeCloseTo(0, 6)
    expect(unity.pf!).toBeCloseTo(1, 9)
  })
  it('no load: δ = 0 and the current is purely reactive |V − E|/Xs', () => {
    const nl = syncMotor({ ...SM, tl: 0 })!
    expect(nl.delta).toBe(0)
    expect(nl.i!).toBeCloseTo(Math.abs(nl.v - 260) / 6, 12)
    expect(nl.pf).toBe(0)
  })
  it('invalid inputs → null', () => {
    expect(syncMotor({ ...SM, xs: 0 })).toBeNull()
    expect(syncMotor({ ...SM, e: 0 })).toBeNull()
    expect(syncMotor({ ...SM, tl: -1 })).toBeNull()
  })
})

describe('systems: P = T·ω and efficiency chains', () => {
  it('P = T·ω, rpm conversions', () => {
    expect(shaftPower(20, radPerS(1500))).toBeCloseTo(3141.59, 2)
    expect(rpmOf(radPerS(1234))).toBeCloseTo(1234, 9)
  })
  it('η_total = Π η_i and stage losses sum to Pin − Pout', () => {
    expect(chainEfficiency([0.97, 0.93, 0.97])).toBeCloseTo(0.875037, 6)
    expect(chainEfficiency([])).toBe(1)
    const c = powerChain(1000, [0.9, 0.8])
    expect(c.pout).toBeCloseTo(720, 12)
    expect(c.stages.reduce((a, s) => a + s.loss, 0)).toBeCloseTo(c.loss, 12)
    expect(c.stages[1].pin).toBeCloseTo(c.stages[0].pout, 12)
  })
})

describe('genset', () => {
  const g = genset({ torque: 600, n: 1500, poles: 4, etaEngine: 0.38, etaAlt: 0.93, vline: 400, pf: 0.8 })!
  it('f = P·n/120; shaft power T·ω; fuel and electrical power through the assumed efficiencies', () => {
    expect(g.f).toBe(50)
    expect(g.pShaft).toBeCloseTo(600 * radPerS(1500), 9)
    expect(g.pFuel).toBeCloseTo(g.pShaft / 0.38, 9)
    expect(g.pElec).toBeCloseTo(g.pShaft * 0.93, 9)
    expect(g.pFuel).toBeCloseTo(g.pElec + g.lossEngine + g.lossAlt, 9) // energy balance
    expect(g.etaTotal).toBeCloseTo(0.38 * 0.93, 12)
    expect(g.iLine).toBeCloseTo(g.pElec / (Math.sqrt(3) * 400 * 0.8), 9)
    expect(g.sApparent).toBeCloseTo(g.pElec / 0.8, 9)
    expect(g.nFor50).toBe(1500)
  })
  it('a 2-pole set must turn at 3000 rpm for 50 Hz; invalid inputs → null', () => {
    expect(genset({ torque: 100, n: 3000, poles: 2, etaEngine: 0.4, etaAlt: 0.9, vline: 400, pf: 1 })!.f).toBe(50)
    expect(genset({ torque: 100, n: 1500, poles: 4, etaEngine: 0, etaAlt: 0.9, vline: 400, pf: 1 })).toBeNull()
    expect(genset({ torque: 100, n: 1500, poles: 4, etaEngine: 0.4, etaAlt: 1.2, vline: 400, pf: 1 })).toBeNull()
  })
})

describe('motor coupled to a load', () => {
  const base = { ts: 40, n0: 1500, tc: 5, kf: 0.0004, j: 0.3 }
  const r = motorLoad(base)!
  it('the operating point satisfies Tm(ω*) = TL(ω*)', () => {
    expect(r.starts).toBe(true)
    const w0 = radPerS(1500)
    const tm = 40 * (1 - r.w / w0)
    const tl = 5 + 0.0004 * r.w * r.w
    expect(tm).toBeCloseTo(tl, 9)
    expect(r.t!).toBeCloseTo(tm, 9)
    expect(r.p).toBeCloseTo(r.t! * r.w, 9)
    expect(r.n).toBeCloseTo(1109.9, 1)
  })
  it('constant load (k = 0): closed form ω* = ω0·(1 − Tc/Ts), τ = J·ω0/Ts exactly', () => {
    const c = motorLoad({ ...base, kf: 0 })!
    expect(c.w).toBeCloseTo(radPerS(1500) * (1 - 5 / 40), 9)
    expect(c.tau!).toBeCloseTo((0.3 * radPerS(1500)) / 40, 12)
  })
  it('inertia changes the dynamics, not the operating point', () => {
    const heavy = motorLoad({ ...base, j: 0.6 })!
    expect(heavy.w).toBeCloseTo(r.w, 12)
    expect(heavy.alpha0).toBeCloseTo(r.alpha0 / 2, 12)
    expect(heavy.tau!).toBeCloseTo(2 * r.tau!, 12)
    expect(heavy.ke).toBeCloseTo(2 * r.ke, 9)
    expect(r.alpha0).toBeCloseTo((40 - 5) / 0.3, 12)
  })
  it('a bigger fan lowers the speed and raises the torque; Tc ≥ Ts cannot start', () => {
    const big = motorLoad({ ...base, kf: 0.0008 })!
    expect(big.w).toBeLessThan(r.w)
    expect(big.t!).toBeGreaterThan(r.t!)
    const stuck = motorLoad({ ...base, tc: 40 })!
    expect(stuck.starts).toBe(false)
    expect(stuck.t).toBeNull()
    expect(stuck.tau).toBeNull()
    expect(motorLoad({ ...base, j: 0 })).toBeNull()
  })
})

describe('battery → inverter → motor', () => {
  const r = inverterMotor({ vdc: 400, torque: 120, n: 3000, m: 0.9, poles: 8, etaInv: 0.97, etaMotor: 0.93 })!
  it('power chain backwards from the shaft; battery current; balance', () => {
    expect(r.pShaft).toBeCloseTo(120 * radPerS(3000), 9)
    expect(r.pAc).toBeCloseTo(r.pShaft / 0.93, 9)
    expect(r.pDc).toBeCloseTo(r.pAc / 0.97, 9)
    expect(r.idc).toBeCloseTo(r.pDc / 400, 12)
    expect(r.pDc).toBeCloseTo(r.pShaft + r.lossInv + r.lossMotor, 9)
    expect(r.etaTotal * r.pDc).toBeCloseTo(r.pShaft, 9)
  })
  it('SPWM fundamental V_LL = (√3/2√2)·m·Vdc ≈ 0.612·m·Vdc; f = P·n/120', () => {
    expect(r.vll).toBeCloseTo(0.6124 * 0.9 * 400, 0)
    expect(r.vll / (0.9 * 400)).toBeCloseTo(Math.sqrt(3) / (2 * Math.SQRT2), 12)
    expect(r.f).toBe(200)
    expect(r.iac!).toBeCloseTo(r.pAc / (Math.sqrt(3) * r.vll), 9)
  })
  it('double Vdc, same power → half the battery current; m > 1 or η > 1 → null; m = 0 → no AC current value', () => {
    const hv = inverterMotor({ vdc: 800, torque: 120, n: 3000, m: 0.45, poles: 8, etaInv: 0.97, etaMotor: 0.93 })!
    expect(hv.idc).toBeCloseTo(r.idc / 2, 12)
    expect(inverterMotor({ vdc: 400, torque: 1, n: 1, m: 1.2, poles: 8, etaInv: 0.97, etaMotor: 0.93 })).toBeNull()
    expect(inverterMotor({ vdc: 400, torque: 1, n: 1, m: 0.5, poles: 8, etaInv: 1.1, etaMotor: 0.93 })).toBeNull()
    expect(inverterMotor({ vdc: 400, torque: 1, n: 1, m: 0, poles: 8, etaInv: 0.97, etaMotor: 0.93 })!.iac).toBeNull()
  })
})

describe('regenerative braking', () => {
  const base = { mass: 1600, v: 60, a: -2, etaGear: 0.97, etaMotor: 0.92, etaInv: 0.97, vbatt: 400 }
  const r = regen(base)!
  it('braking: power flows wheel → battery, reduced by η_chain; the current is negative (charging)', () => {
    expect(r.braking).toBe(true)
    expect(r.f).toBe(-3200)
    expect(r.pWheel).toBeCloseTo(-3200 * (60 / 3.6), 9)
    expect(r.eta).toBeCloseTo(0.97 * 0.92 * 0.97, 12)
    expect(r.pBatt).toBeCloseTo(r.pWheel * r.eta, 9)
    expect(Math.abs(r.pBatt)).toBeLessThan(Math.abs(r.pWheel))
    expect(r.ibatt).toBeLessThan(0)
    expect(r.loss).toBeCloseTo(Math.abs(r.pWheel) - Math.abs(r.pBatt), 9)
  })
  it('driving: the battery supplies more than the wheel receives (division by η_chain)', () => {
    const d = regen({ ...base, a: 2 })!
    expect(d.braking).toBe(false)
    expect(d.pBatt).toBeCloseTo(d.pWheel / d.eta, 9)
    expect(d.ibatt).toBeGreaterThan(0)
    expect(d.pBatt).toBeGreaterThan(Math.abs(r.pBatt)) // round trip loses twice
  })
  it('kinetic energy ½·m·v² and its recoverable upper bound; regenerated power ∝ speed', () => {
    expect(r.ke).toBeCloseTo(0.5 * 1600 * (60 / 3.6) ** 2, 9)
    expect(r.keRecoverable).toBeCloseTo(r.ke * r.eta, 9)
    const slow = regen({ ...base, v: 30 })!
    expect(slow.pBatt).toBeCloseTo(r.pBatt / 2, 9)
    const coast = regen({ ...base, a: 0 })!
    expect(coast.pBatt).toBe(0)
    expect(regen({ ...base, mass: 0 })).toBeNull()
  })
})

describe('EV drivetrain', () => {
  const base = { mass: 1800, v: 60, gear: 9, rw: 0.33, tm: 100, etaGear: 0.97, etaMotor: 0.93, etaInv: 0.97, crr: 0.01, cda: 0.6, vbatt: 400 }
  const r = evDrive(base)!
  it('ω_wheel = v/r and ω_wheel = ω_motor / G', () => {
    expect(r.ww).toBeCloseTo(60 / 3.6 / 0.33, 12)
    expect(r.wm / r.ww).toBeCloseTo(9, 12)
    expect(r.nMotor).toBeCloseTo(9 * r.nWheel, 9)
  })
  it('T_wheel = G·η·Tm; F = T/r; power through the gears: T_wheel·ω_wheel = η·P_shaft = F·v', () => {
    expect(r.tw).toBeCloseTo(9 * 0.97 * 100, 12)
    expect(r.f).toBeCloseTo(r.tw / 0.33, 12)
    expect(r.tw * r.ww).toBeCloseTo(0.97 * r.pShaft, 9)
    expect(r.f * r.v).toBeCloseTo(r.pWheel, 9)
    expect(r.pWheel).toBeCloseTo(0.97 * r.pShaft, 9)
  })
  it('battery power and the whole chain balance; road load and acceleration', () => {
    expect(r.pBatt).toBeCloseTo(r.pWheel + r.lossGear + r.lossMotor + r.lossInv, 9)
    expect(r.etaTotal * r.pBatt).toBeCloseTo(r.pWheel, 9)
    expect(r.ibatt).toBeCloseTo(r.pBatt / 400, 12)
    expect(r.fRoll).toBeCloseTo(1800 * G_ACC * 0.01, 12)
    expect(r.fDrag).toBeCloseTo(0.5 * RHO_AIR * 0.6 * (60 / 3.6) ** 2, 12)
    expect(r.a).toBeCloseTo((r.f - r.fRoad) / 1800, 12)
  })
  it('higher gear ratio → more wheel torque, higher motor speed at the same road speed; standstill and invalid', () => {
    const g12 = evDrive({ ...base, gear: 12 })!
    expect(g12.tw).toBeGreaterThan(r.tw)
    expect(g12.nMotor).toBeGreaterThan(r.nMotor)
    const stand = evDrive({ ...base, v: 0 })!
    expect(stand.pShaft).toBe(0)
    expect(stand.a).toBeCloseTo((stand.f - 1800 * G_ACC * 0.01) / 1800, 12)
    expect(evDrive({ ...base, rw: 0 })).toBeNull()
  })
})

// ── the built models: catalogue links and model-level behaviour ─────────────────────────────────────────────
const MINE = ['alternator', 'synchronous-motor', 'sys-genset', 'sys-motor-load', 'sys-inverter-motor', 'sys-regen', 'sys-ev']

describe('mx-sync models', () => {
  it('each is ready in the catalogue, with traits; systems link a validated simulation where one exists', () => {
    for (const id of MINE) {
      const e = machineById(id)!
      expect(e.status, id).toBe('ready')
      expect(id in MODEL_LOADERS, id).toBe(true)
      expect(Object.keys(e.traits ?? {}).length, id).toBeGreaterThanOrEqual(9)
    }
    for (const id of ['synchronous-motor', 'sys-motor-load', 'sys-inverter-motor', 'sys-regen', 'sys-ev']) expect(machineById(id)!.simulatedIn, id).toBeTruthy()
  })
  it.each(MINE)('%s: 6–14 parts, 5–8 steps with focus, 5–7 quiz items, explicit formulas', async (id) => {
    const def = (await MODEL_LOADERS[id]()).default
    expect(def.parts.length).toBeGreaterThanOrEqual(6)
    expect(def.parts.length).toBeLessThanOrEqual(14)
    expect(def.steps.length).toBeGreaterThanOrEqual(5)
    expect(def.steps.length).toBeLessThanOrEqual(8)
    for (const s of def.steps) expect(s.focus.length, s.id).toBeGreaterThan(0)
    expect(def.quiz.length).toBeGreaterThanOrEqual(5)
    expect(def.quiz.length).toBeLessThanOrEqual(7)
    expect(new Set(def.quiz.map((q) => q.kind)).size).toBeGreaterThanOrEqual(3)
    for (const l of def.layers) if (l.id !== 'rotation') expect(l.conceptual, l.id).toBe(true)
    const p = Object.fromEntries(def.params.map((x) => [x.id, x.value]))
    const calc = def.calc(p)
    expect(calc.length).toBeGreaterThanOrEqual(5)
    for (const c of calc) expect(c.value === null || Number.isFinite(c.value), c.id).toBe(true)
  })
  it('alternator: defaults give 50 Hz; the animation follows the set speed', async () => {
    const def = (await MODEL_LOADERS.alternator()).default
    const p = Object.fromEntries(def.params.map((x) => [x.id, x.value]))
    expect(def.calc(p).find((c) => c.id === 'f')!.value).toBe(50)
    const m1 = def.motion!({}, p)
    const m2 = def.motion!({}, { ...p, n: 3000 })
    expect(m2.omega / m1.omega).toBeCloseTo(2, 12)
    expect(m1.omega).toBeGreaterThan(0) // counter-clockwise seen from the front, as the layers draw it
  })
  it('synchronous motor: speed = Ns at any load below pull-out; null beyond it', async () => {
    const def = (await MODEL_LOADERS['synchronous-motor']()).default
    const p = Object.fromEntries(def.params.map((x) => [x.id, x.value]))
    const n = (q: Record<string, number>) => def.calc(q).find((c) => c.id === 'n')!.value
    expect(n(p)).toBe(1500)
    expect(n({ ...p, tl: 150 })).toBe(1500)
    expect(n({ ...p, tl: 300 })).toBeNull()
  })
  it('EV: the animation ratio of motor to wheel is the gear ratio (ω_wheel = ω_motor / G)', async () => {
    const def = (await MODEL_LOADERS['sys-ev']()).default
    const p = Object.fromEntries(def.params.map((x) => [x.id, x.value]))
    const c = Object.fromEntries(def.calc(p).map((x) => [x.id, x.value]))
    expect(c.nMotor! / c.nWheel!).toBeCloseTo(p.gear, 12)
    expect(def.motion!(c, p).omega * 100).toBeCloseTo(radPerS(c.nMotor!), 9)
  })
})
