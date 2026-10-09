import { describe, expect, it } from 'vitest'
import { labById, topicOf } from '../src/catalogue/catalogue.ts'
import type { ConverterResult } from '../src/converters/types.ts'
import type { DcdcState } from '../src/converters/dcdc/explain.ts'
import { buckShellTopic } from '../src/topics/dcdc.tsx'
import { formatA, formatTime } from '../src/utils/format.ts'
import { categoryRows } from '../src/workspace/panels.tsx'
import { topicAnalysis } from '../src/workspace/TopicShell.tsx'
import { TOPICS as DCDC } from '../src/workspaces/dcdc.tsx'

/*
 * The universal workspace shell reads one run and one cursor. These tests take the REAL buck simulation,
 * pick a switch-ON and a switch-OFF sample from the simulated device states (not from the PWM command),
 * and check that every region the shell shows — status line, state, current path, WHY and its next
 * consequence, inspector, energy, events, analysis — agrees with the run at that same sample.
 */
const topic = buckShellTopic()
const r = topic.simulate(topic.defaults) as ConverterResult
const m = topic.measure(r)
const q = r.devices.find((d) => d.id === 'Q1') ?? r.devices[0]
const d = r.devices.find((x) => x.id === 'D1') ?? r.devices[1]
const mid = Math.floor(r.length / 2)
const kOn = (() => {
  for (let k = mid; k < r.length; k++) if (q.on[k] && !d.on[k] && q.on[k - 1] && q.on[k + 1]) return k
  return -1
})()
const kOff = (() => {
  for (let k = mid; k < r.length; k++) if (!q.on[k] && d.on[k] && d.on[k - 1] && d.on[k + 1]) return k
  return -1
})()

describe('Buck in the workspace shell: configuration', () => {
  it('Basic is Vin, fs, D, R; L and C stay reachable under Advanced; default channels Gate, Vout, iL', () => {
    expect(topic.basic.map((s) => s.key)).toEqual(['vin', 'fs', 'duty', 'r'])
    expect(topic.advanced.map((s) => s.key).slice(0, 2)).toEqual(['l', 'c'])
    expect(topic.defaultChannels).toEqual(['gate', 'vout', 'il'])
    // the simulation keeps using the same values: defaults unchanged
    expect(topic.defaults).toEqual(buckShellTopic().defaults)
  })
  it('every ready DC-DC converter opens in the shell with the same shell configuration as Buck', () => {
    const lab = labById('dc-dc')!
    const ready = lab.topics.filter((t) => t.status === 'ready' && !t.opens).map((t) => t.id)
    expect(Object.keys(DCDC)).toEqual(ready)
    for (const id of ready) {
      const t = (DCDC as Record<string, typeof topic>)[id]
      expect(topicOf(lab, id)).toBeDefined()
      expect(t.basic.map((s) => s.key), id).toEqual(['vin', 'fs', 'duty', 'r'])
      expect(t.status && t.nextConsequence && t.path && t.energyModel && t.analysis && t.parts, id).toBeTruthy()
    }
  })
})

describe('Buck in the workspace shell: one timestep, every panel', () => {
  it('found a switch-ON and a switch-OFF sample in the simulated device states', () => {
    expect(kOn).toBeGreaterThan(0)
    expect(kOff).toBeGreaterThan(0)
  })

  const check = (k: number, on: boolean) => {
    const st = topic.state(r, k) as DcdcState
    // device state = the simulation's own device trace
    expect(st.qOn).toBe(!!q.on[k])
    expect(st.dOn).toBe(!!d.on[k])
    // status line
    const status = topic.status!(st, r)
    expect(status.headline).toBe(on ? 'Switch ON' : 'Switch OFF')
    expect(status.facts.join(' ')).toMatch(on ? /diode OFF/ : /diode freewheeling/)
    // current path from the simulated devices
    if (on) expect(st.path).toEqual(expect.arrayContaining(['vin', 'q1', 'l']))
    else expect(st.path).toEqual(expect.arrayContaining(['d1', 'l']))
    expect(st.path.includes(on ? 'd1' : 'q1')).toBe(false)
    // state panel rows
    const view = topic.view(st, r, 'beginner')
    expect(view.rows.find((x) => x.k === 'Switch Q1')!.v).toBe(on ? 'ON' : 'OFF')
    expect(view.rows.find((x) => x.k === 'Diode D1')!.v).toBe(on ? 'OFF' : 'ON')
    // inspector: values are the waveform values at this sample
    const L = topic.inspect!('l', st, m, r)
    expect(L.rows.find(([k]) => k === 'Current now')![1]).toBe(formatA(r.signals.il[k]))
    expect(L.rows.find(([k]) => k === 'State now')![1]).toBe(on ? 'STORING ENERGY' : 'RELEASING ENERGY')
    const C = topic.inspect!('c', st, m, r)
    expect(C.rows.find(([k]) => k === 'Current now')![1]).toBe(formatA(r.signals.ic[k], true))
    // energy: EL = ½·L·iL² at the same sample
    expect(st.el).toBeCloseTo(0.5 * r.params.l * r.signals.il[k] ** 2, 12)
    // WHY
    const cards = topic.why(r, st, m)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) for (const t of [c.what, c.why, c.equation]) expect(t).not.toMatch(/NaN|undefined/)
    if (on) expect(cards.some((c) => c.question === 'Why is D1 OFF?')).toBe(true)
    else expect(cards.some((c) => c.question === 'Why did D1 turn ON?' || c.question === 'Why is iL falling?')).toBe(true)
    // NEXT CONSEQUENCE quotes the run's own next event
    const next = topic.next!(r, st, m)
    const after = st.t + 0.5 * r.params.dt
    const kinds = on ? ['gate-off'] : ['gate-on', 'il-zero', 'diode-off']
    const ev = r.events.filter((e) => e.time > after && kinds.includes(e.kind)).sort((a, b) => a.time - b.time)[0]
    expect(ev).toBeDefined()
    expect(next).toContain(`t = ${formatTime(ev.time)}`)
  }
  it('switch ON: status, devices, path, state, inspector, energy, WHY and next consequence agree', () => check(kOn, true))
  it('switch OFF: the diode freewheels in the simulation and every panel says so', () => check(kOff, false))

  it('no deterministic next event → no invented consequence', () => {
    const last = r.length - 1
    const st = topic.state(r, last) as DcdcState
    const ahead = r.events.filter((e) => e.time > st.t + 0.5 * r.params.dt)
    expect(ahead.length).toBe(0)
    expect(topic.next!(r, st, m)).toBeNull()
  })

  it('moving the cursor re-reads the stored run: no new simulation, same arrays', () => {
    const a = topic.state(r, kOn) as DcdcState
    const b = topic.state(r, kOff) as DcdcState
    expect(a.il).toBe(r.signals.il[kOn])
    expect(b.il).toBe(r.signals.il[kOff])
  })
})

describe('Analyze categories', () => {
  const cmp = topic.analyze.compare(r, m)
  it('shows only categories with real content, plus Theory vs Simulation', () => {
    const w = { result: r, m, params: topic.defaults as unknown as Record<string, unknown> }
    expect(topicAnalysis(topic, w, cmp, 'standard').map((c) => c.id)).toEqual(['overview', 'output', 'current', 'ripple', 'power', 'efficiency', 'stress', 'theory'])
    const fake = { ...topic, analysis: [{ id: 'nothing', label: 'Nothing', rows: ['notAMeasurement'] }] }
    expect(topicAnalysis(fake, w, cmp, 'standard').map((c) => c.id)).toEqual(['theory'])
    // Theory vs Simulation: every compare row, SIMULATION and THEORY formatted from the run and the exact theory
    const th = topicAnalysis(topic, w, cmp, 'standard').find((c) => c.id === 'theory')!
    expect(th.rows.map((x) => x.key)).toEqual(cmp.rows.map((x) => x.key))
    expect(th.rows.every((x) => x.pass !== false)).toBe(true)
  })
  it('rows are existing measurements with their theory value — nothing computed in the UI', () => {
    const cat = topic.analysis!.find((c) => c.id === 'output')!
    const rows = categoryRows(cat as never, m, cmp.rows, topic.measureLabels)
    expect(rows.map((x) => x.key)).toEqual(['voutAvg', 'voutPP', 'ioAvg'])
    const v = rows[0]
    expect(v.sim).toBe(topic.measureLabels.voutAvg.fmt(m.voutAvg))
    expect(v.theory).toBe(topic.measureLabels.voutAvg.fmt(cmp.rows.find((x) => x.key === 'voutAvg')!.exact))
    const eff = categoryRows(topic.analysis!.find((c) => c.id === 'efficiency')! as never, m, cmp.rows, topic.measureLabels)
    expect(eff.find((x) => x.key === 'losses.q')!.sim).toBe(topic.measureLabels['losses.q'].fmt(m.losses.q))
  })
})
