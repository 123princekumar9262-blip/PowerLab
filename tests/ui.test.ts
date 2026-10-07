import { describe, expect, it } from 'vitest'
import { conciseWhy, pathView, stateLine } from '../src/explanations/concise.ts'
import { getExplainer } from '../src/explanations/index.ts'
import { inspectPart } from '../src/inspect/inspect.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { FORMULA_NOTES } from '../src/measurements/formulaNotes.ts'
import { resolveTarget } from '../src/learning/target.ts'
import { indexAtTime, runSimulation } from '../src/simulation/engine.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { initialLabState, labReducer, type LabState } from '../src/state/labState.ts'
import type { CircuitId, LabParams } from '../src/types/simulation.ts'
import { presetChannels, presetVisible } from '../src/visualization/presets.ts'
import { fwParams } from './helpers.ts'

const at = (p: LabParams, id: CircuitId, deg: number) => {
  const r = runSimulation(p, id)
  const ex = getExplainer(id).state(r, indexAtTime(r, resolveTarget(r, { angleDeg: deg })))
  return { r, ex }
}
const BAD = /NaN|undefined|Infinity/

describe('channel presets', () => {
  const bridge = runSimulation(THREE_PHASE_DEFAULTS, '3ph-bridge:RL')
  it('Basic = the three phases, Vo and Io (three-phase); Vin, Vout, Io (single-phase)', () => {
    expect(presetChannels('basic', bridge.signalIds, '3ph-bridge')).toEqual(['vin', 'vb', 'vc', 'vout', 'io'])
    const hw = runSimulation(DEFAULT_PARAMS, 'half-wave:R')
    expect(presetChannels('basic', hw.signalIds, 'half-wave')).toEqual(['vin', 'vout', 'io'])
    // With a freewheeling diode the freewheel current is part of the basic picture.
    const fw = runSimulation(fwParams(true), 'half-wave:RL')
    expect(presetChannels('basic', fw.signalIds, 'half-wave')).toContain('ifw')
  })
  it('Diode analysis = Vo + every device current; Everything = every signal; only signals the circuit has', () => {
    expect(presetChannels('diode', bridge.signalIds, '3ph-bridge')).toEqual(['vout', 'id', 'id2', 'id3', 'id4', 'id5', 'id6'])
    expect(presetChannels('everything', bridge.signalIds, '3ph-bridge')).toEqual([...bridge.signalIds])
    for (const p of ['basic', 'diode', 'load', 'power'] as const) for (const s of presetChannels(p, bridge.signalIds, '3ph-bridge')) expect(bridge.signalIds).toContain(s)
  })
  it('the energy view adds the energy channels to a preset', () => {
    const v = presetVisible('basic', bridge.signalIds, '3ph-bridge', true)
    expect(v.wl && v.ps && v.vout).toBe(true)
    expect(presetVisible('basic', bridge.signalIds, '3ph-bridge', false).wl).toBe(false)
  })
})

describe('progressive-disclosure state', () => {
  const s0: LabState = { ...initialLabState, hasRun: true, topology: '3ph-bridge', load: 'R', section: 'three', params: THREE_PHASE_DEFAULTS }
  it('modes open their own tab; Explore returns to STATE; drawers open and close', () => {
    let s = labReducer(s0, { type: 'setMode', mode: 'experiment' })
    expect(s.rightTab).toBe('mode')
    s = labReducer(s, { type: 'setMode', mode: 'lab' })
    expect(s.rightTab).toBe('state')
    s = labReducer(s, { type: 'openDrawer', drawer: { kind: 'path' } })
    expect(s.drawer?.kind).toBe('path')
    s = labReducer(s, { type: 'closeDrawer' })
    expect(s.drawer).toBeNull()
  })
  it('density changes what is shown, never the simulation parameters', () => {
    let s = labReducer({ ...s0, rightTab: 'energy', scopeView: 'angle' }, { type: 'setDensity', density: 'beginner' })
    expect(s.rightTab).toBe('state')
    expect(s.scopeView).toBe('waveforms')
    expect(s.params).toBe(s0.params)
    s = labReducer(s, { type: 'setDensity', density: 'engineer' })
    expect(s.density).toBe('engineer')
  })
  it('picking a channel by hand switches to a custom preset; the Physics Lens opens the WHY tab', () => {
    const s = labReducer(s0, { type: 'setChannels', preset: 'custom', visible: { ...s0.visible, id3: true } })
    expect(s.preset).toBe('custom')
    expect(s.visible.id3).toBe(true)
    expect(labReducer(s0, { type: 'setLens', stage: 0 }).rightTab).toBe('why')
    expect(labReducer({ ...s0, focus: true }, { type: 'setLens', stage: 0 }).drawer?.kind).toBe('why')
  })
  it('an event marker opens the event drawer; showing energy opens the ENERGY tab', () => {
    expect(labReducer(s0, { type: 'selectEventGroup', id: 'g1', time: 0.01 }).drawer?.kind).toBe('event')
    expect(labReducer(s0, { type: 'setEnergy', on: true }).rightTab).toBe('energy')
    // …but a lesson keeps its own panel in front.
    expect(labReducer({ ...s0, mode: 'learn', rightTab: 'mode' }, { type: 'setEnergy', on: true }).rightTab).toBe('mode')
  })
})

describe('WHY (short form), current path and state line — from the simulation', () => {
  it('six-pulse bridge at 60°: Va highest, Vb lowest → D1 + D6; Vo = Vab − 2Vf with the simulated value', () => {
    const { r, ex } = at(THREE_PHASE_DEFAULTS, '3ph-bridge:R', 60)
    const why = conciseWhy(r, ex)
    expect(why.map((s) => s.title)).toEqual(['Phase voltages', 'Diode decision', 'Current path', 'Output voltage', 'Load response'])
    expect(why[0].lines.join(' ')).toMatch(/Highest: A · lowest: B/)
    expect(why[1].lines.join(' ')).toMatch(/D1 \(upper, phase A\): phase A is the highest/)
    expect(why[1].lines.join(' ')).toMatch(/D6 \(lower, phase B\): phase B is the lowest/)
    expect(why[3].lines[0]).toBe('Vo = Vab − 2·Vf')
    expect(stateLine(ex)).toBe('D1 + D6 conducting')
    const pv = pathView(r, ex)
    expect(pv.nodes).toEqual(['Phase A', 'D1', 'Load', 'D6', 'Phase B'])
    expect(pv.reasons.join(' ')).toMatch(/Va is the highest eligible phase/)
    for (const s of why) expect(s.lines.join(' ')).not.toMatch(BAD)
  })
  it('half-controlled bridge names the SCR (T1) and says it is fired / latched', () => {
    const { ex } = at({ ...THREE_PHASE_DEFAULTS, control: { device: 'scr', alphaDeg: 30, freewheel: false } }, '3ph-half-controlled:R', 90)
    expect(stateLine(ex)).toMatch(/T1/)
  })
  it('single-phase and freewheel circuits have the same five steps and a path', () => {
    for (const [p, id] of [
      [DEFAULT_PARAMS, 'half-wave:RL'],
      [DEFAULT_PARAMS, 'bridge:RC'],
      [fwParams(true), 'half-wave:RL'],
    ] as Array<[LabParams, CircuitId]>) {
      for (const deg of [60, 250]) {
        const { r, ex } = at(p, id, deg)
        const why = conciseWhy(r, ex)
        expect(why).toHaveLength(5)
        expect(JSON.stringify(why)).not.toMatch(BAD)
        expect(JSON.stringify(pathView(r, ex))).not.toMatch(BAD)
      }
    }
    const { ex } = at(fwParams(true), 'half-wave:RL', 250)
    expect(stateLine(ex)).toBe('Dfw conducting (freewheeling)')
  })
})

describe('Inspect mode reads every value from the simulation', () => {
  const { r, ex } = at(THREE_PHASE_DEFAULTS, '3ph-bridge:R', 60)
  const m = compareWithTheory(r).measurements
  it('a device: state, current, conduction per cycle (120° in a six-pulse bridge)', () => {
    const d1 = inspectPart(r, ex, m, 'D1')!
    const row = (k: string) => d1.rows.find(([a]) => a === k)?.[1]
    expect(row('State')).toMatch(/ON/)
    expect(Number(row('Conduction per cycle')!.replace('°', ''))).toBeCloseTo(120, 0)
    expect(d1.why).toMatch(/Why ON\?/)
    const d3 = inspectPart(r, ex, m, 'D3')!
    expect(d3.why).toMatch(/Why OFF\?/)
  })
  it('the load resistor and a phase', () => {
    const R = inspectPart(r, ex, m, 'R')!
    expect(R.rows.find(([k]) => k === 'Power now')?.[1]).toBeTruthy()
    const a = inspectPart(r, ex, m, 'phase-a')!
    expect(a.rows.find(([k]) => k === 'Rank now')?.[1]).toBe('highest')
    expect(inspectPart(r, ex, m, 'nothing')).toBeNull()
  })
  it('single-phase L, C and source; freewheeling diode', () => {
    const rlc = at(DEFAULT_PARAMS, 'bridge:RLC', 80)
    const mm = compareWithTheory(rlc.r).measurements
    for (const part of ['L', 'C', 'R', 'source', 'D1', 'D4']) expect(JSON.stringify(inspectPart(rlc.r, rlc.ex, mm, part))).not.toMatch(BAD)
    const fw = at(fwParams(true), 'half-wave:RL', 250)
    const info = inspectPart(fw.r, fw.ex, compareWithTheory(fw.r).measurements, 'Dfw')!
    expect(info.title).toMatch(/freewheeling/)
    expect(info.rows[0][1]).toMatch(/ON/)
  })
})

describe('Theory & equations', () => {
  it('every compared quantity has a concept and an explanation', () => {
    for (const [p, id] of [
      [THREE_PHASE_DEFAULTS, '3ph-bridge:RL'],
      [DEFAULT_PARAMS, 'half-wave:RL'],
      [fwParams(true), 'half-wave:RL'],
      [DEFAULT_PARAMS, 'bridge:RC'],
    ] as Array<[LabParams, CircuitId]>) {
      const c = compareWithTheory(runSimulation(p, id))
      for (const row of c.rows.filter((x) => x.theory !== null)) expect(FORMULA_NOTES[row.key], `${id} ${row.key}`).toBeTruthy()
    }
  })
})
