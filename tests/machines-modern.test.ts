import { describe, expect, it } from 'vitest'
import {
  bldcSixStep,
  electricalFrequency,
  fullStepState,
  HALL_TABLE,
  hallBits,
  hallCode,
  HYBRID,
  hybridPolePolarity,
  hybridStepsPerRev,
  invPark,
  park,
  pmsmSteady,
  pullAngleE,
  radSFromRpm,
  rpmFromRadS,
  servoLoop,
  SIX_STEP,
  sixStepFromHalls,
  sixStepSector,
  srm64Offset,
  srm64Phase,
  SRM64_AXIS,
  srmPhaseFrequency,
  srmStroke,
  srmTorque,
  srmValid,
  stepAngle,
  stepperMove,
  stepperRestoringTorque,
  trapezoid,
  wrap360,
} from '../src/machines/calculations/modern.ts'
import { MACHINES } from '../src/machines/catalog.ts'
import { MODEL_LOADERS } from '../src/machines/models/index.ts'

const MODERN = ['bldc', 'pmsm', 'srm', 'stepper', 'servo']

describe('BLDC six-step steady state: E = ke·ω, T = kt·I, ω0 = V/ke', () => {
  const base = { vdc: 24, duty: 1, ke: 0.03, rph: 0.25, tl: 0.15 }
  it('worked example', () => {
    const r = bldcSixStep(base)!
    expect(r.stalled).toBe(false)
    expect(r.kt).toBe(0.03) // SI: kt = ke
    expect(r.i).toBeCloseTo(5, 12) // 0.15 / 0.03
    expect(r.rll).toBe(0.5) // two phases in series
    expect(r.e).toBeCloseTo(24 - 5 * 0.5, 12)
    expect(r.w).toBeCloseTo(21.5 / 0.03, 9)
    expect(r.e).toBeCloseTo(r.kt * r.w, 12) // E = ke·ω
    expect(r.torque).toBeCloseTo(0.15, 12) // T = kt·I = TL
    expect(r.w0).toBeCloseTo(800, 9) // 24 / 0.03
    expect(r.n0).toBeCloseTo(rpmFromRadS(800), 9)
    expect(r.stallTorque).toBeCloseTo((0.03 * 24) / 0.5, 12)
  })
  it('power balance: Pin = Pout + Pcu, Pout = E·I', () => {
    for (const tl of [0, 0.05, 0.3, 1.2]) {
      const r = bldcSixStep({ ...base, tl })!
      expect(r.pin).toBeCloseTo(r.pout + r.pcu, 9)
      expect(r.pout).toBeCloseTo(r.e * r.i, 9)
    }
  })
  it('speed is set by the average voltage d·Vdc (PWM)', () => {
    const a = bldcSixStep({ ...base, duty: 0.5 })!
    const b = bldcSixStep({ ...base, duty: 1 })!
    expect(a.v).toBe(12)
    expect(a.n0 * 2).toBeCloseTo(b.n0, 9)
    expect(a.n).toBeLessThan(b.n)
    expect(a.i).toBeCloseTo(b.i, 12) // current set by the load, not the voltage
  })
  it('edge cases: stalled above stall torque, invalid inputs null, zero voltage', () => {
    const s = bldcSixStep({ ...base, tl: 2 })!
    expect(s.stalled).toBe(true)
    expect(s.n).toBe(0)
    expect(s.i).toBeCloseTo(48, 9)
    expect(s.pout).toBe(0)
    expect(bldcSixStep({ ...base, ke: 0 })).toBeNull()
    expect(bldcSixStep({ ...base, duty: 1.2 })).toBeNull()
    const z = bldcSixStep({ ...base, duty: 0, tl: 0 })!
    expect(z.n0).toBe(0)
    expect(z.eff).toBeNull()
  })
  it('electrical frequency f = P·n/120', () => {
    expect(electricalFrequency(4, 3000)).toBe(100)
    expect(electricalFrequency(8, 1500)).toBe(100)
  })
})

describe('BLDC commutation logic (Hall code → pair) agrees with the rotor angle', () => {
  it('six distinct valid Hall codes, never 000 or 111', () => {
    const codes = new Set<string>()
    for (let t = 0; t < 360; t += 1) codes.add(hallCode(hallBits(t + 0.5)))
    expect(codes.size).toBe(6)
    expect(codes.has('000') || codes.has('111')).toBe(false)
    for (const c of codes) expect(HALL_TABLE[c]).toBeDefined()
  })
  it('the pair chosen from the Halls is the sector pair, and its pull leads the rotor by 60…120° electrical', () => {
    for (let t = 0.25; t < 720; t += 0.5) {
      const s = sixStepFromHalls(t)
      expect(s.sector).toBe(sixStepSector(t))
      const lead = wrap360(pullAngleE(s.hi, s.lo) - t)
      expect(lead).toBeGreaterThanOrEqual(60 - 1e-9)
      expect(lead).toBeLessThanOrEqual(120 + 1e-9)
    }
  })
  it('the sequence is A+B−, A+C−, B+C−, B+A−, C+A−, C+B− every 60° electrical, and each phase conducts 120° each way', () => {
    expect(SIX_STEP.map((s) => s.hi + s.lo).join(' ')).toBe('AB AC BC BA CA CB')
    expect(sixStepSector(30)).toBe(0)
    expect(sixStepSector(89.9)).toBe(0)
    expect(sixStepSector(90)).toBe(1)
    expect(sixStepSector(29.9)).toBe(5)
    let plus = 0
    let minus = 0
    for (let t = 0.5; t < 360; t += 1) {
      const s = SIX_STEP[sixStepSector(t)]
      if (s.hi === 'A') plus++
      if (s.lo === 'A') minus++
    }
    expect(plus).toBe(120)
    expect(minus).toBe(120)
  })
  it('current is switched into each phase while its trapezoidal back EMF is on its flat top (motoring: e·i > 0)', () => {
    for (let t = 0.5; t < 360; t += 1) {
      const s = SIX_STEP[sixStepSector(t)]
      expect(trapezoid(t, s.hi)).toBeCloseTo(1, 12)
      expect(trapezoid(t, s.lo)).toBeCloseTo(-1, 12)
    }
    // the three trapezoids sum to zero only on average; each is bounded
    for (let t = 0; t < 360; t += 7) expect(Math.abs(trapezoid(t, 'B'))).toBeLessThanOrEqual(1)
  })
})

describe('PMSM: Ns = 120f/P, T = 1.5·p·ψ·iq (id = 0), power balance', () => {
  const base = { f: 100, poles: 4, psi: 0.05, iq: 20, rs: 0.1, lq: 0.0005 }
  it('worked example', () => {
    const r = pmsmSteady(base)!
    expect(r.ns).toBe(3000)
    expect(r.pp).toBe(2)
    expect(r.torque).toBeCloseTo(1.5 * 2 * 0.05 * 20, 12) // 3 N·m
    expect(r.wm).toBeCloseTo(radSFromRpm(3000), 9)
    expect(r.emfPeak).toBeCloseTo(2 * Math.PI * 100 * 0.05, 12)
    expect(r.vq).toBeCloseTo(0.1 * 20 + r.emfPeak, 12)
    expect(r.vd).toBeCloseTo(-2 * Math.PI * 100 * 0.0005 * 20, 12)
  })
  it('Pin = 1.5·vq·iq = Pcu + T·ωm', () => {
    for (const iq of [0, 5, 20, -10]) {
      const r = pmsmSteady({ ...base, iq })!
      expect(r.pin).toBeCloseTo(r.pcu + r.pmech, 9)
    }
  })
  it('torque does not depend on speed (id = 0), speed does not depend on load', () => {
    const a = pmsmSteady({ ...base, f: 50 })!
    const b = pmsmSteady({ ...base, f: 200 })!
    expect(a.torque).toBeCloseTo(b.torque, 12)
    expect(pmsmSteady({ ...base, iq: 40 })!.ns).toBe(3000)
  })
  it('edge cases: odd or <2 poles null; f = 0 gives zero speed', () => {
    expect(pmsmSteady({ ...base, poles: 3 })).toBeNull()
    expect(pmsmSteady({ ...base, poles: 0 })).toBeNull()
    const z = pmsmSteady({ ...base, f: 0 })!
    expect(z.ns).toBe(0)
    expect(z.pmech).toBe(0)
  })
  it('Park / inverse Park round trip; id = 0 puts the current 90° ahead of the d axis', () => {
    for (const th of [0, 0.7, 2, 4.4]) {
      const [a, b, c] = invPark(3, 7, th)
      expect(a + b + c).toBeCloseTo(0, 12)
      const [d, q] = park(a, b, c, th)
      expect(d).toBeCloseTo(3, 12)
      expect(q).toBeCloseTo(7, 12)
    }
    // id = 0: ia peaks when the rotor d axis is at −90° electrical (current vector on +q)
    const [ia] = invPark(0, 1, -Math.PI / 2)
    expect(ia).toBeCloseTo(1, 12)
  })
})

describe('SRM: stroke angle ε = 360°/(Nph·Nr)', () => {
  it('6/4 three-phase: 30°, 12 strokes per revolution; 8/6: 15°; 12/8: 15°', () => {
    expect(srmStroke(3, 4)).toEqual({ stroke: 30, strokesPerRev: 12, rotorPitch: 90 })
    expect(srmStroke(4, 6)!.stroke).toBe(15)
    expect(srmStroke(3, 8)!.stroke).toBe(15)
  })
  it('invalid combinations (Nr a multiple of Nph) give null', () => {
    expect(srmValid(3, 6)).toBe(false)
    expect(srmStroke(3, 6)).toBeNull()
    expect(srmStroke(4, 8)).toBeNull()
    expect(srmStroke(1, 4)).toBeNull()
  })
  it('phase switching frequency n·Nr/60 and linear-inductance torque ½·i²·dL/dθ', () => {
    expect(srmPhaseFrequency(1500, 4)).toBe(100)
    const t = srmTorque(10, 0.012, 0.002, 30)!
    expect(t.dLdTheta).toBeCloseTo(0.01 / (Math.PI / 6), 12)
    expect(t.torque).toBeCloseTo(0.5 * 100 * t.dLdTheta, 12)
    // torque does not depend on the current direction
    expect(srmTorque(-10, 0.012, 0.002, 30)!.torque).toBeCloseTo(t.torque, 12)
    expect(srmTorque(10, 0.001, 0.002, 30)).toBeNull()
    expect(srmTorque(10, 0.012, 0.002, 0)).toBeNull()
  })
})

describe('Stepper: step angle, steps ↔ angle', () => {
  it('200 steps/rev → 1.8°; a 50-tooth two-phase hybrid makes 200 full steps', () => {
    expect(stepAngle(200)).toBe(1.8)
    expect(stepAngle(0)).toBeNull()
    expect(hybridStepsPerRev(50)).toBe(200)
    expect(hybridStepsPerRev(18)).toBe(72) // the drawn teaching model: 5° steps
    expect(stepAngle(hybridStepsPerRev(18))).toBe(5)
  })
  it('steps to angle and angle to steps, with microstepping and the rounding error', () => {
    const r = stepperMove({ stepsPerRev: 200, micro: 1, steps: 50, target: 100, rate: 200 })!
    expect(r.angle).toBeCloseTo(90, 12)
    expect(r.need).toBe(56) // 100 / 1.8 = 55.6
    expect(r.reached).toBeCloseTo(100.8, 9)
    expect(r.error).toBeCloseTo(-0.8, 9)
    expect(r.speedRpm).toBeCloseTo(60, 12) // 200 steps/s = 1 rev/s
    const m = stepperMove({ stepsPerRev: 200, micro: 16, steps: 3200, target: 100, rate: 3200 })!
    expect(m.res).toBeCloseTo(0.1125, 12)
    expect(m.angle).toBeCloseTo(360, 9)
    expect(Math.abs(m.error)).toBeLessThanOrEqual(m.res / 2 + 1e-12)
    expect(m.speedRpm).toBeCloseTo(60, 9)
    expect(stepperMove({ stepsPerRev: 200, micro: 0, steps: 1, target: 1, rate: 1 })).toBeNull()
  })
  it('full-step sequence A+, B+, A−, B− repeats every 4 steps (also backwards)', () => {
    expect([0, 1, 2, 3, 4, -1].map(fullStepState)).toEqual(['A+', 'B+', 'A−', 'B−', 'A+', 'B−'])
  })
})

describe('Servo: encoder resolution and a proportional position loop', () => {
  it('quadrature: 4·PPR counts; following error ω/Kv; time constant 1/Kv', () => {
    const r = servoLoop({ ppr: 2500, kv: 50, n: 600, move: 90 })!
    expect(r.counts).toBe(10000)
    expect(r.resolution).toBeCloseTo(0.036, 12)
    expect(r.followRad).toBeCloseTo(radSFromRpm(600) / 50, 12)
    expect(r.followDeg).toBeCloseTo((radSFromRpm(600) / 50) * (180 / Math.PI), 9)
    expect(r.tau).toBeCloseTo(0.02, 12)
    expect(r.settle2).toBeCloseTo(0.08, 12)
    expect(r.moveCounts).toBeCloseTo(2500, 9)
    // a higher gain reduces the following error in proportion
    expect(servoLoop({ ppr: 2500, kv: 100, n: 600, move: 90 })!.followDeg * 2).toBeCloseTo(r.followDeg, 9)
    expect(servoLoop({ ppr: 0, kv: 50, n: 600, move: 90 })).toBeNull()
    expect(servoLoop({ ppr: 2500, kv: 0, n: 600, move: 90 })).toBeNull()
  })
})

describe('modern machines: built models', () => {
  it('each is ready in the catalogue and has a loader; BLDC and PMSM link the Drives lab simulation', () => {
    for (const id of MODERN) {
      const e = MACHINES.find((m) => m.id === id)!
      expect(e.status, id).toBe('ready')
      expect(id in MODEL_LOADERS, id).toBe(true)
      expect(e.traits && Object.keys(e.traits).length >= 6, `${id} traits`).toBe(true)
    }
    expect(MACHINES.find((m) => m.id === 'bldc')!.simulatedIn).toMatchObject({ lab: 'drives', topic: 'bldc' })
    expect(MACHINES.find((m) => m.id === 'pmsm')!.simulatedIn).toMatchObject({ lab: 'drives', topic: 'pmsm' })
  })
  it.each(MODERN)('%s: 6–14 parts, 5–8 steps with equations, 5–7 quiz items mixing kinds, calc results with formulas', async (id) => {
    const def = (await MODEL_LOADERS[id]()).default
    expect(def.parts.length).toBeGreaterThanOrEqual(6)
    expect(def.parts.length).toBeLessThanOrEqual(14)
    expect(def.steps.length).toBeGreaterThanOrEqual(5)
    expect(def.steps.length).toBeLessThanOrEqual(8)
    expect(def.steps.filter((s) => s.equation).length).toBeGreaterThanOrEqual(2)
    expect(def.quiz.length).toBeGreaterThanOrEqual(5)
    expect(def.quiz.length).toBeLessThanOrEqual(7)
    expect(new Set(def.quiz.map((q) => q.kind)).size).toBeGreaterThanOrEqual(3)
    for (const l of def.layers) if (l.id !== 'rotation') expect(l.conceptual, `${id} ${l.id}`).toBe(true)
    const stages = Math.max(...def.parts.map((p) => p.stage))
    expect(stages).toBeGreaterThanOrEqual(2)
    expect(stages).toBeLessThanOrEqual(4)
    const base = Object.fromEntries(def.params.map((p) => [p.id, p.value]))
    const calc = def.calc(base)
    expect(calc.length).toBeGreaterThanOrEqual(4)
    expect(calc.every((c) => c.value !== null), `${id}: defaults give values`).toBe(true)
    if (def.motion) {
      const m = def.motion(Object.fromEntries(calc.map((c) => [c.id, c.value])), base)
      expect(Number.isFinite(m.omega)).toBe(true)
      expect(m.note.length).toBeGreaterThan(10)
    }
  })
  it('the calculator tables use the tested formulas (BLDC no-load speed, PMSM torque, SRM stroke, stepper step angle)', async () => {
    const get = async (id: string, over: Record<string, number> = {}) => {
      const def = (await MODEL_LOADERS[id]()).default
      const ps = { ...Object.fromEntries(def.params.map((p) => [p.id, p.value])), ...over }
      return Object.fromEntries(def.calc(ps).map((c) => [c.id, c.value]))
    }
    const b = await get('bldc', { vdc: 24, duty: 1, ke: 0.03 })
    expect(b.n0).toBeCloseTo(rpmFromRadS(800), 6)
    const p = await get('pmsm', { f: 100, poles: 4, psi: 0.05, iq: 20 })
    expect(p.ns).toBe(3000)
    expect(p.torque).toBeCloseTo(3, 9)
    const s = await get('srm', { nph: 3, nr: 4 })
    expect(s.stroke).toBe(30)
    const st = await get('stepper', { spr: 200, micro: 1, steps: 50 })
    expect(st.step).toBe(1.8)
    expect(st.angle).toBeCloseTo(90, 9)
  })
})

describe('SRM 6/4 switching logic used by the model', () => {
  it('one phase at a time, each for 30° (one stroke) of every 90°; sequence A→B→C while the rotor turns clockwise', () => {
    const count = { A: 0, B: 0, C: 0 }
    for (let t = 0.25; t < 90; t += 0.5) count[srm64Phase(t)]++
    expect(count).toEqual({ A: 60, B: 60, C: 60 })
    // θ decreasing (clockwise): the energised phase changes B → C → A → B …
    const seq: string[] = []
    for (let t = 89.75; t > -180; t -= 0.5) {
      const p = srm64Phase(t)
      if (seq.at(-1) !== p) seq.push(p)
    }
    expect(seq.slice(0, 7).join('')).toBe('BCABCAB')
  })
  it('the energised phase always has a rotor pole 0…30° counter-clockwise of its axis: the pull is clockwise, towards alignment', () => {
    for (let t = 0.25; t < 360; t += 0.5) {
      const ph = srm64Phase(t)
      const d = srm64Offset(t, SRM64_AXIS[ph])
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThanOrEqual(30)
    }
  })
})

describe('hybrid stepper model: each full step holds where the teeth line up with the energised poles', () => {
  const mod = (x: number, m: number) => ((x % m) + m) % m
  const aligned = (a: number) => Math.min(mod(a, HYBRID.pitch), HYBRID.pitch - mod(a, HYBRID.pitch)) < 1e-9
  it('state k (A+, B+, A−, B−) holds at θ = k·1.8°: N-cup teeth under the S poles, S-cup teeth under the N poles', () => {
    for (let k = 0; k < 8; k++) {
      const st = fullStepState(k)
      const theta = k * 1.8
      let energised = 0
      for (let pole = 0; pole < 8; pole++) {
        const pol = hybridPolePolarity(st, pole)
        if (!pol) continue
        energised++
        const a = pole * 45
        if (pol === 'S') expect(aligned(a - theta), `${st} pole ${pole}`).toBe(true)
        else expect(aligned(a - theta - HYBRID.pitch / 2), `${st} pole ${pole}`).toBe(true)
      }
      expect(energised).toBe(4) // one phase on (wave drive): 4 of the 8 poles
    }
  })
  it('the drawn motor makes 4·50 = 200 full steps per revolution', () => {
    expect(hybridStepsPerRev(HYBRID.nr)).toBe(200)
  })
})

describe('stepper holding torque (first harmonic): T = −T_H·sin(Nr·Δθ)', () => {
  it('restoring, maximum at a quarter tooth pitch, zero at the next half pitch', () => {
    expect(stepperRestoringTorque(0.4, 50, 0)).toBeCloseTo(0, 12)
    expect(stepperRestoringTorque(0.4, 50, 1.8)).toBeCloseTo(-0.4, 12) // ¼ of 7.2°
    expect(stepperRestoringTorque(0.4, 50, -1.8)).toBeCloseTo(0.4, 12)
    expect(stepperRestoringTorque(0.4, 50, 0.9)).toBeLessThan(0) // pushes back towards 0
    expect(stepperRestoringTorque(0.4, 50, 3.6)).toBeCloseTo(0, 12) // unstable point: half a tooth pitch
  })
})
