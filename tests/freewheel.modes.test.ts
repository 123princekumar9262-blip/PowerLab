import { describe, expect, it } from 'vitest'
import { compareWithTheory, ROW_GROUPS } from '../src/measurements/compare.ts'
import { conductionSteps, freewheelIntervals } from '../src/explanations/freewheel.ts'
import { getExplainer } from '../src/explanations/index.ts'
import { lensStages } from '../src/explanations/lens.ts'
import { FREEWHEEL_EXPERIMENTS } from '../src/experiment/freewheel.ts'
import { measure } from '../src/measurements/measurements.ts'
import { indexAtTime, runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { fwParams } from './freewheel.test.ts'

const run = (fw: boolean, over: Parameters<typeof fwParams>[1] = {}) => runSimulation(fwParams(fw, over), 'half-wave:RL')
const ex = getExplainer('half-wave:RL')
const BAD = /NaN|undefined|Infinity|\{\w+\}/

describe('Phase 6 — WHY engine is state-aware', () => {
  const r = run(true)
  const n = r.trace.length

  it('mode, path and headline follow the simulated diode states at every instant', () => {
    for (let k = Math.floor(n / 2); k < n; k += 37) {
      const e = ex.state(r, k)
      const fi = e.freewheel!
      const [d1, fw] = e.sample.diodes
      expect(fi.mode).toBe(d1.on && fw.on ? 'overlap' : fw.on ? 'freewheel' : d1.on ? 'source' : 'off')
      if (fi.mode === 'freewheel') {
        expect(e.path).toEqual(['L', 'R', 'Dfw', 'back to L'])
        expect(e.headline).toMatch(/Dfw ON/)
        expect(fi.whyTitle).toMatch(/ON\?/)
        expect(fi.energyTrend).toBe('releasing')
      }
      if (fi.mode === 'source') {
        expect(e.path).toEqual(['Source (+)', 'D1', 'L', 'R', 'Source (−)'])
        expect(fi.whyTitle).toMatch(/OFF\?/)
        expect(fi.fw.current).toBe(0)
      }
      // The numbers quoted are the simulated ones.
      expect(fi.il).toBe(e.sample.io)
      expect(fi.wl).toBe(e.sample.values.wl)
      const text = [e.headline, e.summary, ...e.chain.map((c) => c.text), ...fi.why, fi.energyText].join(' ')
      expect(text).not.toMatch(BAD)
    }
  })

  it('the causal chain is Source → D1 → inductor requirement → Dfw → path → load voltage → energy', () => {
    const e = ex.state(r, n - 1)
    expect(e.chain.map((c) => c.stage)).toEqual(['source', 'diode', 'inductor', 'freewheel', 'path', 'output', 'energy', 'waveform'])
  })

  it('"why is Dfw ON?" has the seven steps and quotes E_L = ½·L·i² with the simulated current', () => {
    const k = r.trace.diodes[1].on.lastIndexOf(1) - 200
    const e = ex.state(r, k)
    const fi = e.freewheel!
    expect(fi.mode).toBe('freewheel')
    expect(fi.why).toHaveLength(7)
    expect(fi.why[1]).toMatch(/E_L = ½·L·i²/)
    expect(fi.why[2]).toMatch(/cannot change instantaneously/)
  })

  it('discontinuous case: after the current dies the WHY says the energy was all dissipated', () => {
    const rd = run(true, { L: 0.005 })
    const off = rd.events.filter((e) => e.kind === 'diode-off' && e.device === 'Dfw').pop()!
    const k = indexAtTime(rd, off.time) + 20
    const e = ex.state(rd, k)
    expect(e.freewheel!.mode).toBe('off')
    expect(e.freewheel!.why.join(' ')).toMatch(/reached zero/)
  })

  it('event explanations: Dfw ON, D1 OFF at the zero crossing, current continuity, energy minimum', () => {
    const last = r.events.filter((e) => e.time > r.params.duration - r.params.period)
    for (const e of last) expect(JSON.stringify(ex.event(r, e))).not.toMatch(BAD)
    const d1off = ex.event(r, last.find((e) => e.kind === 'diode-off' && e.device === 'D1')!)
    expect(d1off.why).toMatch(/zero crossing/)
    expect(ex.event(r, last.find((e) => e.kind === 'current-transfer')!).why).toMatch(/cannot change instantaneously/)
  })

  it('without the freewheeling diode the original explainer is used (no freewheel insight)', () => {
    expect(ex.state(run(false), 500).freewheel).toBeUndefined()
  })
})

describe('Phase 7 — energy', () => {
  it('each freewheel interval conserves energy: ΔE_L = ∫R·i² dt + ∫vDfw·iDfw dt', () => {
    for (const over of [{}, { L: 0.005 }, { ron: 0.2 }]) {
      const r = run(true, over)
      const list = freewheelIntervals(r).filter((x) => x.tOff !== null)
      expect(list.length).toBeGreaterThan(3)
      // Backward Euler dissipates ½·L·(Δi)² per step numerically: a relative error of about
      // Δt/(2τ). With τ = L/R = 0.5 ms that is 1 %; at the default τ = 5 ms, 0.1 %.
      const tol = 0.002 + r.params.dt / (r.params.inductance / r.params.resistance)
      for (const x of list) {
        const released = x.wlStart - x.wlEnd
        expect(Math.abs(x.eR + x.eDfw - released)).toBeLessThan(tol * x.wlStart)
      }
    }
  })
})

describe('Physics Lens and step-through', () => {
  const r = run(true)
  it('the freewheel lens has the ten stages, built from the cursor state', () => {
    for (const k of [r.trace.length - 1500, r.trace.length - 300]) {
      const stages = lensStages(r, ex.state(r, k))
      expect(stages.map((s) => s.key)).toEqual(['source', 'rectifier', 'inductor', 'energy', 'mainoff', 'continue', 'path', 'on', 'dissipate', 'decay'])
      for (const s of stages) expect(`${s.what} ${s.why} ${s.equation}`).not.toMatch(BAD)
    }
  })

  it('step-through: 7 steps in time order, landing on the simulated switching instants', () => {
    const steps = conductionSteps(r)
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (let k = 1; k < steps.length; k++) expect(steps[k].time).toBeGreaterThanOrEqual(steps[k - 1].time)
    const at = (t: number) => sampleAt(r, indexAtTime(r, t))
    expect(at(steps[0].time).diodes.map((d) => d.on)).toEqual([true, false])
    // Step 5 (freewheel current flows): Dfw conducts, D1 does not.
    expect(at(steps[4].time).diodes.map((d) => d.on)).toEqual([false, true])
    // Step 6: the stored energy is lower than at Dfw turn-on.
    expect(at(steps[5].time).values.wl!).toBeLessThan(at(steps[3].time + 1e-6).values.wl!)
    for (const s of steps) expect(s.text).not.toMatch(BAD)
  })

  it('discontinuous step 7 says the current decayed to zero', () => {
    const steps = conductionSteps(run(true, { L: 0.005 }))
    expect(steps[6].text).toMatch(/decayed to zero/)
  })
})

describe('Phase 9 — guided experiments', () => {
  const base = fwParams(false)
  const m = (p: Parameters<typeof runSimulation>[0]) => measure(runSimulation(p, 'half-wave:RL'))
  it('every experiment runs and its physics text uses the measured numbers', () => {
    for (const x of FREEWHEEL_EXPERIMENTS) {
      const a = m(x.after(base))
      const b = x.before ? m(x.before(base)) : null
      expect(x.physics(a, b)).not.toMatch(BAD)
    }
  })
  it('the simulations agree with what each experiment says the physics does', () => {
    const pair = (id: string) => {
      const x = FREEWHEEL_EXPERIMENTS.find((e) => e.id === id)!
      return { b: m(x.before!(base)), a: m(x.after(base)) }
    }
    const e2 = pair('fw-2')
    expect(e2.a.voutAvg).toBeGreaterThan(e2.b.voutAvg)
    expect(e2.a.voutMin).toBeGreaterThan(e2.b.voutMin)
    const e3 = pair('fw-3')
    expect(e3.a.ioRippleFactor!).toBeLessThan(e3.b.ioRippleFactor!)
    expect(e3.a.voutAvg).toBeCloseTo(e3.b.voutAvg, 2)
    const e4 = pair('fw-4')
    expect(e4.a.ioAvg).toBeCloseTo(2 * e4.b.ioAvg, 1)
    expect(e4.a.ioRippleFactor!).toBeLessThan(e4.b.ioRippleFactor!)
    const e5 = pair('fw-5')
    expect(e5.a.ioRippleFactor!).toBeLessThan(e5.b.ioRippleFactor!)
    expect(e5.b.ioMin).toBe(0)
    expect(e5.a.ioMin).toBeGreaterThan(0)
  })
})

describe('regression — existing circuits are unchanged', () => {
  it('other single-phase circuits keep their rows (no ripple/energy rows added)', () => {
    const c = compareWithTheory(runSimulation(fwParams(false), 'bridge:RL'))
    expect(c.rows.some((r) => r.key === 'wlMax' || r.key === 'ifwAvg')).toBe(false)
  })
  it('three-phase freewheeling diode now also exposes its current as Ifw (= the Dfw device current)', () => {
    const p = { ...THREE_PHASE_DEFAULTS, control: { device: 'scr' as const, alphaDeg: 90, freewheel: true } }
    const r = runSimulation(p, '3ph-bridge:RL')
    const fw = r.trace.diodes.find((d) => d.id === 'Dfw')!
    const ifw = r.trace.signals.ifw!
    let any = 0
    for (let k = 0; k < r.trace.length; k++) {
      expect(ifw[k]).toBe(fw.current[k])
      if (fw.on[k]) any++
    }
    expect(any).toBeGreaterThan(100)
    expect(r.diagnostics.solverFallbacks).toBe(0)
  })
})

describe('UI contract', () => {
  it('every comparison row belongs to a group the measurement table renders', () => {
    const c = compareWithTheory(run(true))
    for (const r of c.rows) expect(ROW_GROUPS).toContain(r.group)
  })
})
