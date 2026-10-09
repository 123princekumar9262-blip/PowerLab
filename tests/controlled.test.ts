import { describe, expect, it } from 'vitest'
import { runComparison, whyTheyDiffer, advise, DEFAULT_SETUP, type CompareSetup } from '../src/compare/compare.ts'
import { getExplainer } from '../src/explanations/index.ts'
import { stateLine } from '../src/explanations/concise.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { measure } from '../src/measurements/measurements.ts'
import { overlapAnalysis } from '../src/measurements/overlap.ts'
import { NOT_APPLICABLE } from '../src/measurements/theory/freewheel.ts'
import { resolveTarget } from '../src/learning/target.ts'
import { indexAtTime, runSimulation } from '../src/simulation/engine.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import type { CircuitId, LabParams } from '../src/types/simulation.ts'

const scr = (alphaDeg: number, o: { L?: number; model?: 'ideal' | 'real'; fw?: boolean; cycles?: number; R?: number } = {}): LabParams => ({
  ...DEFAULT_PARAMS,
  diode: { model: o.model ?? 'real', vf: 0.7, ron: 0 },
  load: { ...DEFAULT_PARAMS.load, inductance: o.L ?? 0.05, resistance: o.R ?? 10 },
  control: { device: 'scr', alphaDeg, freewheel: !!o.fw },
  sim: { ...DEFAULT_PARAMS.sim, cycles: o.cycles ?? 10 },
})
const angle = (r: ReturnType<typeof runSimulation>, t: number) => ((((r.params.omega * t + r.params.phase) * 180) / Math.PI) % 360 + 360) % 360
const lastCycle = (r: ReturnType<typeof runSimulation>) => r.events.filter((e) => e.time > r.params.duration - r.params.period + 1e-9)
const ons = (r: ReturnType<typeof runSimulation>, dev: string) => lastCycle(r).filter((e) => e.kind === 'diode-on' && e.device === dev).map((e) => angle(r, e.time))
const Vm = Math.SQRT2 * 12

describe('single-phase half-wave controlled rectifier', () => {
  it('R load: the SCR fires exactly at α — not when the source turns positive — and Vdc = (Vm/2π)(1 + cos α)', () => {
    for (const a of [30, 60, 90, 135]) {
      const r = runSimulation(scr(a, { model: 'ideal' }), 'half-wave:R')
      expect(ons(r, 'D1')[0]).toBeCloseTo(a, 3)
      expect(measure(r).voutAvg).toBeCloseTo((Vm / (2 * Math.PI)) * (1 + Math.cos((a * Math.PI) / 180)), 2)
    }
  })
  it('before α the SCR is forward biased but blocks (gate off); it never turns on without a gate pulse', () => {
    const r = runSimulation(scr(60), 'half-wave:R')
    const tr = r.trace.diodes[0]
    let blocked = 0
    for (let k = 1; k < r.trace.length; k++) {
      if (tr.on[k] && !tr.on[k - 1]) expect(tr.gate![k] || tr.gate![k - 1]).toBe(1)
      if (!tr.on[k] && tr.voltage[k] > 1 && !tr.gate![k]) blocked++
    }
    expect(blocked).toBeGreaterThan(500)
  })
  it('RL load: extinction β comes from the simulated current (not hard-coded) and matches the theory root', () => {
    const r = runSimulation(scr(60, { L: 0.1 }), 'half-wave:RL')
    const c = compareWithTheory(r)
    const β = c.measurements.turnOffAngleDeg!
    expect(β).toBeGreaterThan(180)
    expect(c.rows.find((x) => x.key === 'turnOffAngleDeg')!.withinTolerance).toBe(true)
    // At extinction the current is zero and the SCR is not re-fired in that cycle.
    const off = lastCycle(r).find((e) => e.kind === 'diode-off' && e.device === 'D1')!
    expect(Math.abs(off.values.io ?? 1)).toBeLessThan(1e-6)
  })
})

describe('single-phase semi-controlled and fully controlled bridges', () => {
  it('semi-controlled: T1 at α, T2 at 180° + α; the bridge’s own leg freewheels (D3 takes over at 180° while T1 stays on)', () => {
    const r = runSimulation(scr(60, { L: 0.2 }), 'semi-bridge:RL')
    expect(ons(r, 'D1')[0]).toBeCloseTo(60, 3)
    expect(ons(r, 'D2')[0]).toBeCloseTo(240, 3)
    expect(ons(r, 'D3')[0]).toBeCloseTo(180, 2)
    const m = measure(r)
    expect(m.voutMin).toBeGreaterThanOrEqual(-1.4 - 1e-6) // never below −2Vf: no inversion
    expect(m.voutAvg).toBeCloseTo((Vm / Math.PI) * 1.5 - 1.4, 2)
  })
  it('fully controlled: T1 + T4 at α, T2 + T3 at 180° + α; continuous RL gives Vdc = (2Vm/π)·cos α − 2Vf', () => {
    for (const a of [30, 60]) {
      const r = runSimulation(scr(a, { L: 0.5, cycles: 16 }), 'bridge:RL')
      expect(ons(r, 'D1')[0]).toBeCloseTo(a, 3)
      expect(ons(r, 'D4')[0]).toBeCloseTo(a, 3)
      expect(ons(r, 'D2')[0]).toBeCloseTo(180 + a, 3)
      expect(ons(r, 'D3')[0]).toBeCloseTo(180 + a, 3)
      const c = compareWithTheory(r)
      expect(c.theory.mode).toBe('continuous')
      expect(c.measurements.voutAvg).toBeCloseTo(((2 * Vm) / Math.PI) * Math.cos((a * Math.PI) / 180) - 1.4, 1)
    }
  })
  // One case per configuration (42): each has its own time budget, and a failure names the circuit.
  // (Was one 42-run test: under heavy host load its ~22–30 s total once crossed the shared timeout.)
  const theoryCases = (['half-wave:R', 'half-wave:RL', 'center-tap:RL', 'bridge:R', 'bridge:RL', 'semi-bridge:R', 'semi-bridge:RL'] as CircuitId[]).flatMap((id) =>
    [0, 45, 90].flatMap((a) => [false, true].map((fw) => [id, a, fw] as const)),
  )
  it.each(theoryCases)('theory agrees with simulation: %s, α = %i°, Dfw %s', (id, a, fw) => {
    const c = compareWithTheory(runSimulation(scr(a, { fw, cycles: 16 }), id))
    const bad = c.rows.filter((x) => !x.withinTolerance).map((x) => `${x.key}: ${x.simulated} vs ${x.theory}`)
    expect(bad, `${id} α=${a} fw=${fw}`).toEqual([])
    expect(c.rows.filter((x) => x.kind === 'exact' && x.error !== null).length, `${id} α=${a}`).toBeGreaterThan(10)
  })
  it('the theory says when no closed form applies (capacitor filter fed by SCRs)', () => {
    const c = compareWithTheory(runSimulation(scr(30), 'bridge:RC'))
    expect(c.theory.notes).toContain(NOT_APPLICABLE)
    // The waveform has no closed form; only the pulse count (ripple frequency) is still exact.
    expect(c.rows.filter((x) => x.group !== 'Source' && x.key !== 'rippleFrequency').every((x) => x.kind === 'none')).toBe(true)
  })
  it('no solver fallbacks across α for every controlled topology and load', () => {
    for (const id of ['half-wave:RL', 'center-tap:RLC', 'bridge:RC', 'semi-bridge:RL', 'bridge:RL'] as CircuitId[])
      for (const a of [0, 60, 120, 170]) expect(runSimulation(scr(a, { cycles: 4 }), id).diagnostics.solverFallbacks, `${id} α=${a}`).toBe(0)
  })
})

describe('firing explanations come from the simulated state', () => {
  const r = runSimulation(scr(60, { L: 0.5, cycles: 8 }), 'bridge:RL')
  const ex = getExplainer('bridge:RL')
  it('devices are named T1…T4; "why is the SCR OFF?" before firing names the gate; "why did it turn ON?" after', () => {
    // θ = 50°: T1/T4 forward biased but not fired yet (T2/T3 still carry the current).
    const k = indexAtTime(r, resolveTarget(r, { angleDeg: 50 }))
    const e = ex.state(r, k)
    expect(Object.values(e.names!)).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(e.firing!.whyOff.join(' ')).toMatch(/gate/)
    const k2 = indexAtTime(r, resolveTarget(r, { angleDeg: 70 }))
    const on = ex.state(r, k2).firing!.whyOn.join(' ')
    expect(on).toMatch(/turned ON at θ = 60\.0°/)
    expect(on).toMatch(/gate pulse/)
  })
})

describe('freewheeling diode on the center-tapped and bridge rectifiers', () => {
  for (const id of ['center-tap:RL', 'bridge:RL'] as CircuitId[]) {
    it(`${id}: Dfw is a real element — conducts only with Vout ≈ −Vf; io = rectifier + Dfw currents`, () => {
      const r = runSimulation(scr(60, { fw: true, L: 0.2 }), id)
      const { io, ifw, vout } = r.trace.signals
      const fw = r.trace.diodes.find((d) => d.id === 'Dfw')!
      let on = 0
      for (let k = 0; k < r.trace.length; k++) {
        const main = r.trace.diodes.filter((d) => d.id !== 'Dfw' && ['D1', 'D2'].includes(d.id)).reduce((s, d) => s + d.current[k], 0)
        expect(io![k]).toBeCloseTo(main + ifw![k], 9)
        if (fw.on[k]) {
          on++
          expect(vout![k]).toBeCloseTo(-0.7, 6)
        }
      }
      expect(on).toBeGreaterThan(1000)
      const ex = getExplainer(id)
      // A sample in the middle of a freewheel interval of the last cycle.
      let k = r.trace.length - 1
      while (k > 0 && !(fw.on[k] && fw.on[k - 60] && fw.on[k + 60 < r.trace.length ? k + 60 : k])) k--
      const fi = ex.state(r, k).freewheel!
      expect(fi.mode).toBe('freewheel')
      expect(fi.why).toHaveLength(7)
      expect(fi.why[5]).toMatch(/LOAD → FREEWHEEL DIODE → LOAD/)
      // While the source supplies the load, the state line names the conducting devices.
      const kSrc = indexAtTime(r, r.params.duration - r.params.period + (100 / 360) * r.params.period)
      const exSrc = ex.state(r, kSrc)
      expect(exSrc.freewheel!.mode).toBe('source')
      expect(stateLine(exSrc)).toMatch(id.startsWith('bridge') ? /^T1 \+ T4 conducting$/ : /^T1 conducting$/)
    })
  }
})

const tp = (o: { dev?: 'diode' | 'scr'; a?: number; ls?: number; rs?: number; L?: number; id?: CircuitId; model?: 'ideal' | 'real' } = {}) =>
  runSimulation(
    {
      ...THREE_PHASE_DEFAULTS,
      diode: { ...THREE_PHASE_DEFAULTS.diode, model: o.model ?? 'real' },
      load: { ...THREE_PHASE_DEFAULTS.load, inductance: o.L ?? 0.1 },
      threePhase: { sequence: 'abc', rs: o.rs ?? 0, ls: o.ls ?? 0 },
      control: { device: o.dev ?? 'diode', alphaDeg: o.a ?? 0, freewheel: false },
      sim: { ...THREE_PHASE_DEFAULTS.sim, cycles: 8 },
    },
    o.id ?? '3ph-bridge:RL',
  )

describe('three-phase commutation overlap μ', () => {
  it('Ls = 0: every commutation is instantaneous (μ = 0), no overlap events, theory comparison unavailable', () => {
    const r = tp()
    const o = overlapAnalysis(r)!
    expect(o.rows.length).toBe(6)
    for (const row of o.rows) expect(row.c.muDeg).toBeLessThan(1e-6)
    expect(r.events.some((e) => e.kind === 'commutation-start')).toBe(false)
    expect(o.available).toBe(false)
    expect(compareWithTheory(r).rows.find((x) => x.key === 'overlapDeg')!.error).toBeNull()
  })
  it('Ls > 0: μ is measured from the events (end − start) and agrees with cos α − cos(α+μ) = 2ωLs·Id/(√6·Vph)', () => {
    for (const [dev, a, ls] of [['diode', 0, 0.001], ['diode', 0, 0.003], ['scr', 30, 0.001]] as Array<['diode' | 'scr', number, number]>) {
      const r = tp({ dev, a, ls })
      const o = overlapAnalysis(r)!
      expect(o.available).toBe(true)
      for (const row of o.rows) {
        const start = r.events.find((e) => e.kind === 'commutation-start' && Math.abs(e.time - row.c.tStart) < 1e-12)!
        const end = r.events.find((e) => e.kind === 'commutation-end' && Math.abs(e.time - row.c.tEnd) < 1e-12)!
        expect(((end.time - start.time) / r.params.period) * 360).toBeCloseTo(row.c.muDeg, 9)
      }
      expect(Math.abs(o.difference!)).toBeLessThan(0.03)
      expect(compareWithTheory(r).rows.find((x) => x.key === 'overlapDeg')!.withinTolerance).toBe(true)
    }
  })
  it('μ grows with Ls; the outgoing + incoming device currents add up to the load current during the overlap', () => {
    const m1 = overlapAnalysis(tp({ ls: 0.001 }))!.measuredMu!
    const m3 = overlapAnalysis(tp({ ls: 0.003 }))!.measuredMu!
    expect(m3).toBeGreaterThan(m1)
    const r = tp({ ls: 0.002 })
    const c = overlapAnalysis(r)!.rows[0].c
    const k = Math.round((c.tStart + c.tEnd) / 2 / r.params.dt)
    const i = (id: string) => r.trace.diodes[r.diodeIds.indexOf(id as never)].current[k]
    const group = c.group === 'upper' ? ['D1', 'D3', 'D5'] : ['D2', 'D4', 'D6']
    expect(i(c.outgoing)).toBeGreaterThan(0)
    expect(i(c.incoming)).toBeGreaterThan(0)
    expect(group.reduce((s, id) => s + i(id), 0)).toBeCloseTo(r.trace.signals.io![k], 6)
  })
  it('the comparison is withheld (with the reason) when assumptions fail: Rs > 0, or a strongly varying current (R load)', () => {
    expect(overlapAnalysis(tp({ ls: 0.001, rs: 0.2 }))!.reasons.join(' ')).toMatch(/Rs/)
    const o = overlapAnalysis(tp({ ls: 0.001, id: '3ph-bridge:R' }))!
    expect(o.available).toBe(false)
    expect(o.measuredMu!).toBeGreaterThan(0) // still measured — just not compared
  })
})

describe('Compare rectifiers', () => {
  const setup = (o: Partial<CompareSetup>): CompareSetup => ({ ...DEFAULT_SETUP, ...o })
  it('basis: same Vph / same VLL / same output power are applied and stated', () => {
    const r1 = runComparison(setup({ a: 'br', b: '6p', basis: 'vph', v: 12 }))
    expect(r1.a.result.params.vrms).toBe(12)
    expect(r1.b.result.params.vrms).toBe(12)
    const r2 = runComparison(setup({ a: 'br', b: '6p', basis: 'vll', v: 12 }))
    expect(r2.b.result.params.vrms).toBeCloseTo(12 / Math.sqrt(3), 9)
    const r3 = runComparison(setup({ a: 'br', b: '6p', basis: 'pout' }))
    expect(r3.b.metrics.pload.value! / r3.a.metrics.pload.value!).toBeCloseTo(1, 2)
    expect(r3.basisNote).toMatch(/Same output/)
    expect(r3.heldConstant.join(' ')).toMatch(/R = 10 Ω/)
  })
  it('metrics are computed from the two simulations; ripple frequency 100 Hz vs 300 Hz; efficiency < 1 with real devices, = 1 when ideal', () => {
    const r = runComparison(setup({ a: 'br', b: '6p' }))
    expect(r.a.metrics.vdc.value).toBe(measure(r.a.result).voutAvg)
    expect(r.a.metrics.rippleFrequency.value).toBeCloseTo(100, 6)
    expect(r.b.metrics.rippleFrequency.value).toBeCloseTo(300, 6)
    expect(r.a.metrics.pulses.value).toBe(2)
    expect(r.b.metrics.pulses.value).toBe(6)
    expect(r.a.metrics.efficiency.value!).toBeLessThan(1)
    expect(r.b.metrics.rippleFactor.value!).toBeLessThan(r.a.metrics.rippleFactor.value!)
    const ideal = runComparison(setup({ a: 'br', b: '6p', diode: 'ideal' }))
    expect(ideal.a.metrics.efficiency.value).toBeCloseTo(1, 9)
  })
  it('device stress: PIV ≈ Vm (single-phase bridge) and ≈ √3·Vm (6-pulse bridge) with ideal devices', () => {
    const r = runComparison(setup({ a: 'br', b: '6p', diode: 'ideal' }))
    expect(r.a.metrics.piv.value!).toBeCloseTo(Vm, 1)
    expect(r.b.metrics.piv.value!).toBeCloseTo(Math.sqrt(3) * Vm, 1)
  })
  it('TUF: the simulated value (from winding currents) matches the textbook value for ideal R loads; theory is labelled theoretical', () => {
    for (const [key, tuf] of [['hw', 0.287], ['ct', 0.573], ['br', 0.811], ['3p', 0.664], ['6p', 0.954]] as Array<[string, number]>) {
      const r = runComparison(setup({ a: key, b: 'br', diode: 'ideal', load: 'R' }))
      expect(r.a.metrics.tufSim.value!, key).toBeCloseTo(tuf, 2)
      expect(r.a.metrics.tufSim.source).toBe('sim')
      expect(r.a.metrics.tufTheory.source).toBe('theory')
      expect(r.a.metrics.tufTheory.value!).toBeCloseTo(tuf, 2)
    }
    // Not an ideal R load → no textbook value is claimed.
    const rl = runComparison(setup({ a: 'br', b: '6p', load: 'RL' }))
    expect(rl.a.metrics.tufTheory.value).toBeNull()
    // Every other metric is a simulated quantity.
    for (const [k, m] of Object.entries(rl.a.metrics)) if (k !== 'tufTheory') expect(m.source, k).toBe('sim')
  })
  it('controlled rectifiers compare with α; the explanations and advice come from the results', () => {
    const r = runComparison(setup({ a: 'br-scr', b: '6p-scr', alphaDeg: 45, load: 'RL' }))
    expect(r.a.metrics.alpha.value).toBeCloseTo(45, 9)
    const why = whyTheyDiffer(r).join(' ')
    expect(why).toMatch(/Pulses per cycle: Fully controlled 2, Fully controlled bridge 6/)
    const adv = advise(r, 'motor')
    expect(adv.reasons.length).toBeGreaterThan(0)
    expect(adv.tradeoffs.length).toBeGreaterThan(0)
  })
})
