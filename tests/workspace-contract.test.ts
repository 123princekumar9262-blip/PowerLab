import { describe, expect, it, vi } from 'vitest'

/*
 * THE WORKSPACE CONTRACT (src/workspace/contract.ts), checked on REAL runs of both shell labs (Buck and the
 * Rectifier Lab): one master cursor that only re-reads the run; events that land where the trace shows the
 * new state; a current path, an inspector, WHY and an energy ledger that agree with the simulation at the
 * cursor; and "Change circuit" carrying compatible values.
 */

// Count every simulation run (the wrapped functions are the real ones).
const runs = { rect: 0, conv: 0 }
vi.mock('../src/simulation/engine.ts', async (orig) => {
  const m = await orig<typeof import('../src/simulation/engine.ts')>()
  return {
    ...m,
    runSimulation: (...a: Parameters<typeof m.runSimulation>) => {
      runs.rect++
      return m.runSimulation(...a)
    },
  }
})

const { buckShellTopic } = await import('../src/topics/dcdc.tsx')
const { eventSample } = await import('../src/workspace/useTopicWorkspace.ts')
const { whyQuestions, inspection, topicEvents } = await import('../src/workspace/TopicShell.tsx')
const { getExplainer } = await import('../src/explanations/index.ts')
const { rectifierStatus, rectifierWhy, rectifierNextConsequence } = await import('../src/explanations/status.ts')
const { rectifierEnergy } = await import('../src/explanations/energy.ts')
const { rectifierPath, rectifierInspection, rectifierParts, rectifierEvents } = await import('../src/rectifier/RectifierShell.tsx')
const { carryRectifier } = await import('../src/rectifier/carry.ts')
const { inspectPart } = await import('../src/inspect/inspect.ts')
const { compareWithTheory } = await import('../src/measurements/compare.ts')
const { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } = await import('../src/simulation/params.ts')
const { runSimulation } = await import('../src/simulation/engine.ts')
const { groupEvents, groupIndex } = await import('../src/visualization/eventGroups.ts')
type DcdcState = import('../src/converters/dcdc/explain.ts').DcdcState
type LabParams = import('../src/types/simulation.ts').LabParams
type CircuitId = import('../src/types/simulation.ts').CircuitId

const buck = buckShellTopic()
const simulateSpy = vi.fn(buck.simulate)
const topic = { ...buck, simulate: simulateSpy }
const r = topic.simulate(topic.defaults)
const m = topic.measure(r)
const rectP = (o: Partial<LabParams> = {}): LabParams => ({ ...DEFAULT_PARAMS, ...o })
const rect = runSimulation(rectP({ control: { device: 'scr', alphaDeg: 45, freewheel: true } }), 'half-wave:RL')
const rectM = compareWithTheory(rect).measurements
const ex = (k: number) => getExplainer(rect.circuitId).state(rect, k)

describe('master cursor: moving it re-reads the run — it never runs the simulation again', () => {
  it('Buck: every region at 200 instants, zero new simulations', () => {
    simulateSpy.mockClear()
    for (let k = 0; k < r.length; k += Math.ceil(r.length / 200)) {
      const st = topic.state(r, k) as DcdcState
      topic.status!(st, r)
      topic.view(st, r, 'beginner')
      topic.why(r, st, m)
      topic.nextConsequence!(r, st, m)
      topic.path!(st, r)
      topic.energyModel!(st, m, r)
      for (const part of topic.parts ?? []) topic.inspect?.(part.id, st, m, r)
    }
    expect(simulateSpy).toHaveBeenCalledTimes(0)
  })
  it('Rectifier: every region at 200 instants, zero new simulations', () => {
    const before = runs.rect
    const groups = groupEvents(rect)
    for (let k = 0; k < rect.trace.length; k += Math.ceil(rect.trace.length / 200)) {
      const x = ex(k)
      rectifierStatus(x, rect, true)
      rectifierWhy(rect, x)
      rectifierNextConsequence(rect, x)
      rectifierPath(rect, x)
      rectifierEnergy(rect, x.sample, rectM)
      for (const p of rectifierParts(rect, x)) inspectPart(rect, x, rectM, p.id)
    }
    rectifierEvents(groups, undefined, () => 0)
    expect(runs.rect - before).toBe(0)
  })
})

describe('events: real timestamps, landing on the sample that shows the new state', () => {
  it('Buck: each event keeps its own time; the cursor lands where the trace shows the new state', () => {
    const { events } = topicEvents({ result: r, topic, viewport: { t0: 0, t1: r.params.duration } })
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) expect(r.events.find((x) => x.id === e.id)!.time).toBe(e.time)
    // (an event exactly at the end of the run has no later sample to show its new state: excluded)
    const end = r.time[r.length - 1] - r.params.dt / 2
    for (const e of r.events.filter((x) => (x.kind === 'diode-on' || x.kind === 'diode-off' || x.kind === 'gate-on' || x.kind === 'gate-off') && x.time < end)) {
      const k = eventSample(r, e)
      expect(r.time[k]).toBeGreaterThanOrEqual(e.time - r.params.dt * 1e-6)
      const want = e.kind.endsWith('-on') ? 1 : 0
      if (e.kind.startsWith('gate')) expect(r.signals.gate[k] > 0.5 ? 1 : 0).toBe(want)
      else expect(r.devices.find((d) => d.id === e.device)!.on[k] ? 1 : 0).toBe(want)
    }
  })
  it('Rectifier: each event group keeps its time; its landing sample shows the switched device state', () => {
    const groups = groupEvents(rect)
    const evs = rectifierEvents(groups, undefined, () => 0)
    for (const e of evs) expect(groups.find((g) => g.id === e.id)!.time).toBe(e.time)
    for (const g of groups.filter((x) => x.category === 'diode')) {
      const sw = g.events.find((e) => e.kind === 'diode-on' || e.kind === 'diode-off')
      if (!sw) continue
      const k = groupIndex(rect, g)
      const tr = rect.trace.diodes.find((d) => d.id === sw.device)!
      expect(tr.on[k]).toBe(sw.kind === 'diode-on' ? 1 : 0)
    }
  })
})

describe('current path: from the simulated conducting devices', () => {
  it('Buck: the path contains Q1 while it conducts and D1 while it freewheels — never both', () => {
    for (let k = 0; k < r.length; k += 9) {
      const st = topic.state(r, k) as DcdcState
      const path = topic.path!(st, r)
      if (st.qOn) expect(path.elements).toContain('q1')
      if (st.dOn && !st.qOn) expect(path.elements).toContain('d1')
      expect(path.elements.includes('q1') && path.elements.includes('d1')).toBe(false)
      expect(path.text.length).toBeGreaterThan(0)
    }
  })
  it('Rectifier: every device named in the path is ON in the trace at that sample', () => {
    for (let k = 0; k < rect.trace.length; k += 37) {
      const x = ex(k)
      const path = rectifierPath(rect, x)
      const names = x.names ?? {}
      for (const d of rect.trace.diodes) {
        const name = names[d.id] ?? d.id
        if (path.elements.includes(name)) expect(d.on[k], `${name} at k=${k}`).toBe(1)
      }
      if (path.elements.length === 0) expect(rect.trace.diodes.every((d) => d.on[k] === 0)).toBe(true)
    }
  })
})

describe('inspector: common fields + domain rows, read at the cursor', () => {
  it('Buck: the inductor shows its state now and the current of this very sample', () => {
    const k = Math.floor(r.length / 2)
    const st = topic.state(r, k) as DcdcState
    const info = inspection('l', topic.inspect!('l', st, m, r)!)
    expect(info.state).toMatch(/STORING|RELEASING/)
    expect(info.rows.find(([key]) => key === 'Current now')).toBeDefined()
  })
  it('Rectifier: an SCR shows ON/OFF exactly as its trace, at every sampled instant', () => {
    for (let k = 0; k < rect.trace.length; k += 53) {
      const x = ex(k)
      const info = rectifierInspection('D1', inspectPart(rect, x, rectM, 'D1')!)
      expect(info.state).toBe(rect.trace.diodes[0].on[k] ? 'ON — conducting' : 'OFF — blocking')
      expect(info.kind).toBe('Device')
    }
  })
})

describe('WHY: what · why · principle · next — from the simulated state, next from the run', () => {
  it('Buck: every question has all four parts; the next consequence quotes a real event time', () => {
    for (let k = 0; k < r.length; k += 23) {
      const st = topic.state(r, k) as DcdcState
      for (const q of whyQuestions({ cards: topic.why(r, st, m) })) for (const part of [q.what, q.why, q.principle]) expect(part.length).toBeGreaterThan(0)
      const next = topic.nextConsequence!(r, st, m)
      if (next) {
        expect(r.events.some((e) => e.time === next.time)).toBe(true)
        expect(next.time!).toBeGreaterThan(st.t)
      }
    }
  })
  it('Rectifier: all four parts; next = a real event time or a gate edge in the simulated gate trace', () => {
    const gate = rect.trace.diodes[0].gate!
    for (let k = 0; k < rect.trace.length - 1; k += 41) {
      const x = ex(k)
      const q = rectifierWhy(rect, x)
      for (const part of [q.what, q.why, q.principle, q.equation ?? '']) {
        expect(part.length).toBeGreaterThan(0)
        expect(part).not.toMatch(/NaN|undefined/)
      }
      const next = rectifierNextConsequence(rect, x)
      if (!next) continue
      const isEvent = rect.events.some((e) => e.time === next.time)
      const i = rect.trace.time.indexOf(next.time!)
      const isGateEdge = i > 0 && gate[i] === 1 && gate[i - 1] === 0
      expect(isEvent || isGateEdge).toBe(true)
      expect(next.time!).toBeGreaterThan(x.sample.time)
    }
  })
  it('Rectifier: no event left in the run → no consequence is invented', () => {
    expect(rectifierNextConsequence(rect, ex(rect.trace.length - 1))).toBeNull()
  })
})

describe('energy: signed element powers of the same sample; Σp = 0 is a check, not an assumption', () => {
  it('Buck: the ledger balances within its tolerance at every sampled instant', () => {
    for (let k = 0; k < r.length; k += 11) {
      const e = topic.energyModel!(topic.state(r, k) as DcdcState, m, r)
      expect(Math.abs(e.balance!)).toBeLessThanOrEqual(e.tolerance)
      expect(e.ledger.find((x) => x.id === 'src')!.watts).toBeLessThanOrEqual(1e-9)
    }
  })
  it('Rectifier (SCR + Dfw, RL): the ledger balances and the stored energy is the simulated ½·L·i²', () => {
    for (let k = 0; k < rect.trace.length; k += 29) {
      const x = ex(k)
      const e = rectifierEnergy(rect, x.sample, rectM)
      expect(Math.abs(e.balance!)).toBeLessThanOrEqual(e.tolerance)
      expect(e.stores.find((s) => s.id === 'l')!.joules).toBe(rect.trace.signals.wl![k])
    }
  })
})

describe('Change circuit: compatible values kept, the rest reported (never silently dropped)', () => {
  const prev: LabParams = { ...DEFAULT_PARAMS, source: { ...DEFAULT_PARAMS.source, frequency: 60 }, load: { ...DEFAULT_PARAMS.load, resistance: 20 }, control: { device: 'scr', alphaDeg: 60, freewheel: false } }
  it('SCR bridge → semi-controlled bridge: R, f and α are kept', () => {
    const c = carryRectifier(prev, 'semi-bridge', 'scr', 'RL')
    expect(c.params.load.resistance).toBe(20)
    expect(c.params.source.frequency).toBe(60)
    expect(c.params.control!.alphaDeg).toBe(60)
    expect(c.report.kept).toEqual(expect.arrayContaining(['R = 20.00 Ω', 'f = 60.00 Hz', 'α = 60°']))
    expect(c.report.notUsed).toEqual([])
  })
  it('→ diode bridge: α is not used — remembered and reported, R and f kept', () => {
    const c = carryRectifier(prev, 'bridge', 'diode', 'RL')
    expect(c.params.control!.device).toBe('diode')
    expect(c.params.control!.alphaDeg).toBe(60)
    expect(c.report.notUsed).toEqual(['α = 60° (no SCRs in this circuit)'])
    expect(c.report.kept).toEqual(expect.arrayContaining(['R = 20.00 Ω', 'f = 60.00 Hz']))
  })
  it('→ three-phase: the source impedance only applies there; the values run unchanged in the simulation', () => {
    const p3: LabParams = { ...THREE_PHASE_DEFAULTS, threePhase: { sequence: 'abc', rs: 0, ls: 2e-3 } }
    expect(carryRectifier(p3, '3ph-bridge', 'diode', 'RL').report.kept).toEqual(expect.arrayContaining(['source Ls = 2.000 mH, Rs = 0.000 Ω']))
    expect(carryRectifier(p3, 'bridge', 'diode', 'RL').report.notUsed).toEqual(['source Ls / Rs (three-phase only)'])
    // a carried set is a normal parameter set: the simulation accepts it as is
    const c = carryRectifier(prev, '3ph-bridge', 'diode', 'R')
    expect(runSimulation(c.params, '3ph-bridge:R' as CircuitId).diagnostics.solverFallbacks).toBe(0)
  })
  it('defaults carry nothing to report', () => {
    expect(carryRectifier(DEFAULT_PARAMS, 'bridge', 'diode', 'RL').report).toEqual({ kept: [], notUsed: [] })
  })
})
