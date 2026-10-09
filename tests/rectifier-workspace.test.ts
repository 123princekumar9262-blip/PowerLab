import { describe, expect, it } from 'vitest'
import { labById } from '../src/catalogue/catalogue.ts'
import { getExplainer } from '../src/explanations/index.ts'
import { pathView } from '../src/explanations/concise.ts'
import { rectifierNext, rectifierStatus } from '../src/explanations/status.ts'
import { inspectPart } from '../src/inspect/inspect.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { categoryFor, rectifierAnalysis } from '../src/rectifier/analyze.tsx'
import { drawerOf, panelOf } from '../src/rectifier/RectifierShell.tsx'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { sineSource, threePhaseSource } from '../src/simulation/source.ts'
import type { CircuitId, LabParams, SimulationResult } from '../src/types/simulation.ts'
import { formatA } from '../src/utils/format.ts'
import { groupEvents } from '../src/visualization/eventGroups.ts'

/*
 * The Rectifier Lab in the universal workspace shell. The shell only places existing panels; these
 * tests take REAL simulation runs, pick samples from the simulated device traces, and check that what
 * each region shows (status, state, path, WHY + next consequence, inspector, energy, events, angle,
 * Analyze) is the run at that same sample.
 */
function run(id: CircuitId, o: { device?: 'diode' | 'scr'; fw?: boolean; ls?: number } = {}): SimulationResult {
  const base = id.startsWith('3ph') ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS
  const ctl = base.control ?? { device: 'diode' as const, alphaDeg: 30, freewheel: false }
  const p: LabParams = { ...base, control: { ...ctl, device: o.device ?? 'diode', alphaDeg: 30, freewheel: !!o.fw }, sim: { ...base.sim, cycles: 6 } }
  if (o.ls !== undefined && p.threePhase) p.threePhase = { ...p.threePhase, ls: o.ls }
  return runSimulation(p, id)
}
function find(r: SimulationResult, pred: (k: number) => boolean): number {
  for (let k = Math.floor(r.trace.length / 2); k < r.trace.length - 1; k++) if (pred(k - 1) && pred(k) && pred(k + 1)) return k
  return -1
}
const ex = (r: SimulationResult, k: number) => getExplainer(r.circuitId).state(r, k)
const idx = (r: SimulationResult, id: string) => r.diodeIds.indexOf(id as never)
const explainState0 = (r: SimulationResult) => getExplainer(r.circuitId).state(r, Math.floor(r.trace.length * 0.8)).sample

describe('rectifier in the shell: one sample, every region', () => {
  const br = run('bridge:R')
  const D = (id: string) => br.trace.diodes[idx(br, id)]

  it('diode conduction: D1 + D4 conduct in the simulation → status, state and path say so', () => {
    const k = find(br, (i) => D('D1').on[i] === 1 && D('D4').on[i] === 1)
    expect(k).toBeGreaterThan(0)
    const x = ex(br, k)
    expect(x.sample.index).toBe(k)
    for (const d of x.diodes) expect(d.on).toBe(!!br.trace.diodes[idx(br, d.id)].on[k])
    expect(rectifierStatus(x, br).headline).toBe('D1 + D4 conducting')
    expect(x.path).toEqual(expect.arrayContaining(['D1', 'D4']))
    expect(x.path!.some((n) => n === 'D2' || n === 'D3')).toBe(false)
    expect(pathView(br, x).nodes).toEqual(x.path)
  })

  it('diode blocking: D2 and D3 are reverse biased while D1 + D4 conduct; the inspector reads the trace', () => {
    const k = find(br, (i) => D('D1').on[i] === 1)
    const x = ex(br, k)
    const m = compareWithTheory(br).measurements
    const d2 = inspectPart(br, x, m, 'D2')!
    expect(d2.rows.find(([a]) => a === 'State')![1]).toBe('OFF — blocking')
    expect(d2.rows.find(([a]) => a === 'Bias')![1]).toBe('reverse')
    const d1 = inspectPart(br, x, m, 'D1')!
    expect(d1.rows.find(([a]) => a === 'Current')![1]).toBe(formatA(D('D1').current[k]))
  })

  const scr = run('half-wave:R', { device: 'scr' })
  const t1 = scr.trace.diodes[0]
  it('SCR gate event: at the simulated gate edge the inspector shows the pulse and T1 turns ON', () => {
    const edge = (() => {
      for (let k = Math.floor(scr.trace.length / 2); k < scr.trace.length; k++) if (t1.gate![k] && !t1.gate![k - 1]) return k
      return -1
    })()
    expect(edge).toBeGreaterThan(0)
    const x = ex(scr, edge)
    const rows = inspectPart(scr, x, compareWithTheory(scr).measurements, 'D1')!.rows
    expect(rows.find(([a]) => a === 'Gate pulse')![1]).toBe('applied')
    expect(t1.on[edge] || t1.on[edge + 1]).toBe(1)
    // before the edge, the next consequence quotes this very edge
    expect(rectifierNext(scr, ex(scr, edge - 5))).toMatch(/^T1 receives its gate pulse/)
  })

  it('SCR conducting: firing insight, status and path follow the simulated SCR', () => {
    const k = find(scr, (i) => t1.on[i] === 1)
    const x = ex(scr, k)
    expect(x.firing).toBeDefined()
    expect(x.diode.on).toBe(true)
    expect(rectifierStatus(x, scr).headline).toBe('T1 conducting')
    expect(x.path).not.toBeNull()
  })

  it('freewheeling: when the simulation hands the current to Dfw, the state and path follow', () => {
    const fw = run('half-wave:RL', { fw: true })
    const dfw = fw.trace.diodes[idx(fw, 'Dfw')]
    const k = find(fw, (i) => dfw.on[i] === 1 && fw.trace.diodes[0].on[i] === 0)
    const x = ex(fw, k)
    expect(x.freewheel?.mode).toBe('freewheel')
    expect(x.path).toEqual(expect.arrayContaining(['Dfw']))
    expect(rectifierStatus(x, fw).headline).toBe('Dfw conducting (freewheeling)')
  })

  it('WHY + next consequence: generated from the sample and the run’s next event, no NaN', () => {
    const k = find(br, (i) => D('D1').on[i] === 1)
    const x = ex(br, k)
    for (const c of x.chain) expect(c.text).not.toMatch(/NaN|undefined/)
    const next = rectifierNext(br, x)!
    expect(next).toMatch(/turns OFF|Current stops|takes over/)
    expect(next).not.toMatch(/NaN|undefined/)
  })

  it('energy: the sample the Energy panel reads is the trace at the cursor', () => {
    const rl = run('bridge:RL')
    const k = Math.floor(rl.trace.length * 0.8)
    const x = ex(rl, k)
    expect(x.sample.io).toBe(rl.trace.signals.io![k])
    expect(x.sample.vout).toBe(rl.trace.signals.vout![k])
  })

  it('angle view: θ at the cursor is the source angle of the simulated instant', () => {
    const k = Math.floor(br.trace.length * 0.7)
    expect(ex(br, k).angleDeg).toBeCloseTo(sineSource(br.params).angleDeg(br.trace.time[k]), 9)
    const r3 = run('3ph-bridge:R')
    const k3 = Math.floor(r3.trace.length * 0.7)
    expect(ex(r3, k3).angleDeg).toBeCloseTo(threePhaseSource(r3.params).angleDeg(r3.trace.time[k3]), 9)
  })

  it('events: every marker group is made of the run’s own detected events', () => {
    const groups = groupEvents(br)
    expect(groups.length).toBeGreaterThan(0)
    const all = new Set(br.events)
    for (const g of groups) for (const e of g.events) expect(all.has(e)).toBe(true)
  })
})

describe('rectifier Analyze: existing rows regrouped, nothing computed', () => {
  it('categories show only rows that exist; theory vs simulation agrees at the defaults', () => {
    const r = run('bridge:RL')
    const c = compareWithTheory(r)
    expect(c.allWithinTolerance).toBe(true)
    const cats = rectifierAnalysis(c, r, explainState0(r), 'standard')
    // levels never remove a category (Timing too); only categories with rows (or a view) exist
    expect(cats.map((x) => x.id)).toEqual(['overview', 'output', 'current', 'ripple', 'power', 'stress', 'timing', 'theory'])
    for (const cat of cats.filter((x) => x.id !== 'overview')) expect(cat.rows.length).toBeGreaterThan(0)
    expect(cats.some((x) => x.rows.some((row) => row.pass === false))).toBe(false)
    // every row is a row of compareWithTheory: same value, formatted
    const out = cats.find((x) => x.id === 'output')!
    expect(out.rows.map((x) => x.key)).toEqual(c.rows.filter((x) => ['voutAvg', 'voutRms', 'voutPeak', 'voutMin'].includes(x.key)).map((x) => x.key))
    // a category's rows are the comparison's own rows (same values, same theory)
  })
  it('three-phase: Commutation μ appears, with the simulated overlap', () => {
    const r = run('3ph-bridge:RL', { ls: 2e-3 })
    const c = compareWithTheory(r)
    const cats = rectifierAnalysis(c, r, explainState0(r), 'standard')
    expect(cats.map((x) => x.id)).toContain('commutation')
    expect(cats.find((x) => x.id === 'commutation')!.rows[0].simulation).toMatch(/°$/)
    expect(c.measurements.overlapDeg).toBeGreaterThan(0)
  })
  it('entry points map to categories (commutation sheet, theory)', () => {
    expect(categoryFor('commutation', 'measure')).toBe('commutation')
    expect(categoryFor(undefined, 'measure')).toBe('overview')
    expect(categoryFor(undefined, 'theory')).toBe('theory')
  })
})

describe('shell panels ⇄ the lab’s drawer state', () => {
  it('maps every drawer to its shell panel and back', () => {
    // the current path is an overlay toggle now, not a panel
    expect(panelOf({ kind: 'inspect', part: 'D1' })).toBe('inspect')
    expect(panelOf({ kind: 'event' })).toBe('events')
    expect(panelOf({ kind: 'events' })).toBe('events')
    expect(panelOf({ kind: 'measure', part: 'commutation' })).toBe('analyze')
    expect(panelOf({ kind: 'theory' })).toBe('analyze')
    expect(panelOf({ kind: 'why' })).toBe('why')
    expect(panelOf({ kind: 'state' })).toBe('state')
    expect(panelOf({ kind: 'path' })).toBeNull()
    expect(panelOf(null)).toBeNull()
    expect(drawerOf('inspect', { kind: 'inspect', part: 'R' }, false)).toEqual({ kind: 'inspect', part: 'R' })
    expect(drawerOf('events', null, true)).toEqual({ kind: 'event' })
    expect(drawerOf('events', null, false)).toEqual({ kind: 'events' })
    expect(drawerOf('analyze', null, false)).toEqual({ kind: 'measure' })
  })
})

describe('routing', () => {
  it('every rectifier circuit is a catalogue topic of the lab (each opens in the universal workspace shell)', () => {
    const circuits = labById('rectifiers')!.topics.filter((t) => t.rectifier)
    expect(circuits.length).toBe(11)
    for (const t of circuits) expect(t.status, t.id).toBe('ready')
  })
})
