import { describe, expect, it } from 'vitest'
import { getExplainer } from '../src/explanations/index.ts'
import { rectifierNext, rectifierStatus, rectifierWhyQuestions } from '../src/explanations/status.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import type { CircuitId, LabParams, SimulationResult } from '../src/types/simulation.ts'
import { formatA, formatTime, formatV } from '../src/utils/format.ts'

/*
 * Workspace-shell wording for the rectifier (status line, WHY next consequence). Every check picks a
 * sample from the REAL simulated device traces and compares the wording with the run at that sample.
 */
function run(id: CircuitId, o: { device?: 'diode' | 'scr'; fw?: boolean; ls?: number } = {}): SimulationResult {
  const base = id.startsWith('3ph') ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS
  const ctl = base.control ?? { device: 'diode' as const, alphaDeg: 30, freewheel: false }
  const p: LabParams = { ...base, control: { ...ctl, device: o.device ?? 'diode', alphaDeg: 30, freewheel: !!o.fw }, sim: { ...base.sim, cycles: 6 } }
  if (o.ls !== undefined && p.threePhase) p.threePhase = { ...p.threePhase, ls: o.ls }
  return runSimulation(p, id)
}
const DEVICE_KINDS = ['diode-on', 'diode-off', 'current-start', 'current-stop', 'current-transfer', 'commutation-start', 'commutation-end']
const nextDeviceEvent = (r: SimulationResult, k: number) => r.events.filter((e) => e.time > r.trace.time[k] + 0.5 * r.params.dt && DEVICE_KINDS.includes(e.kind)).sort((a, b) => a.time - b.time)[0]
/** First sample in the last cycles where `pred` holds for this and the neighbouring samples. */
function find(r: SimulationResult, pred: (k: number) => boolean): number {
  for (let k = Math.floor(r.trace.length / 2); k < r.trace.length - 1; k++) if (pred(k - 1) && pred(k) && pred(k + 1)) return k
  return -1
}
const at = (r: SimulationResult, k: number) => {
  const ex = getExplainer(r.circuitId).state(r, k)
  return { ex, status: rectifierStatus(ex, r), values: rectifierStatus(ex, r, true), next: rectifierNext(r, ex) }
}

describe('rectifier status line and next consequence (real samples)', () => {
  const hw = run('half-wave:R')
  const d1 = hw.trace.diodes[0]

  it('diode conducting: status names D1, Vo/Io are the simulated values, next = the run’s D1 turn-off', () => {
    const k = find(hw, (i) => d1.on[i] === 1)
    expect(k).toBeGreaterThan(0)
    const { ex, status, values, next } = at(hw, k)
    expect(status.headline).toBe('D1 conducting')
    expect(status.tone).toBe('on')
    expect(ex.sample.vout).toBe(hw.trace.signals.vout![k])
    // Beginner: the explainer's own meaning; from Standard: + Vo and Io at this very sample
    expect(status.facts).toEqual([ex.headline.split(' — ')[1]])
    expect(values.facts.slice(-2)).toEqual([`Vo = ${formatV(hw.trace.signals.vout![k])}`, `Io = ${formatA(hw.trace.signals.io![k])}`])
    const ev = nextDeviceEvent(hw, k)
    expect(ev.kind === 'diode-off' || ev.kind === 'current-stop').toBe(true)
    expect(next).toContain(`t = ${formatTime(ev.time)}`)
    expect(next).toMatch(/D1 turns OFF|Current stops/)
  })

  it('diode blocking: “No diode conducting”, next = the run’s D1 turn-on', () => {
    const k = find(hw, (i) => d1.on[i] === 0)
    const { status, next } = at(hw, k)
    expect(status.headline).toBe('No diode conducting')
    expect(status.tone).toBe('idle')
    const ev = nextDeviceEvent(hw, k)
    expect(next).toContain(`t = ${formatTime(ev.time)}`)
    expect(next).toMatch(/turns ON|Current starts/)
  })

  const scr = run('half-wave:R', { device: 'scr' })
  const t1 = scr.trace.diodes[0]
  it('SCR waiting for its gate: next consequence = the next gate rising edge in the simulated gate trace', () => {
    expect(t1.gate).toBeDefined()
    // forward biased (vin > 0), blocking, gate not yet applied
    const k = find(scr, (i) => t1.on[i] === 0 && scr.trace.signals.vin![i] > 1 && t1.gate![i] === 0)
    expect(k).toBeGreaterThan(0)
    const { status, next } = at(scr, k)
    expect(status.headline).toBe('No device conducting')
    let edge = -1
    for (let i = k + 1; i < scr.trace.length; i++)
      if (t1.gate![i] && !t1.gate![i - 1]) {
        edge = i
        break
      }
    expect(edge).toBeGreaterThan(k)
    expect(next).toContain(`T1 receives its gate pulse at t = ${formatTime(scr.trace.time[edge])}`)
    expect(next).toContain('turns ON')
    // the simulation agrees: T1 conducts right after its gate edge
    expect(t1.on[edge] || t1.on[edge + 1]).toBe(1)
  })

  it('SCR conducting: status names T1, next = its turn-off from the run', () => {
    const k = find(scr, (i) => t1.on[i] === 1)
    const { status, next } = at(scr, k)
    expect(status.headline).toBe('T1 conducting')
    expect(next).toContain(`t = ${formatTime(nextDeviceEvent(scr, k).time)}`)
  })

  it('bridge SCRs fired together are named together', () => {
    const br = run('bridge:RL', { device: 'scr' })
    const vin = br.trace.signals.vin!
    // T2 + T3 conducting before T1/T4 are fired in the positive half-cycle
    const k = find(br, (i) => vin[i] > 1 && br.trace.diodes.every((d) => !d.gate || d.gate[i] === 0) && br.trace.diodes[0].on[i] === 0)
    expect(k).toBeGreaterThan(0)
    expect(at(br, k).next).toMatch(/T1 and T4 receive their gate pulses|T4 and T1 receive their gate pulses/)
  })

  it('freewheeling: status says Dfw conducts, from the simulated Dfw trace', () => {
    const fw = run('half-wave:RL', { fw: true })
    const dfw = fw.trace.diodes.find((d) => d.id !== fw.trace.diodes[0].id)!
    const k = find(fw, (i) => dfw.on[i] === 1 && fw.trace.diodes[0].on[i] === 0)
    expect(k).toBeGreaterThan(0)
    expect(at(fw, k).status.headline).toBe('Dfw conducting (freewheeling)')
  })

  it('three-phase commutation (Ls = 2 mH): next = the first device event after the cursor', () => {
    const r = run('3ph-bridge:RL', { ls: 2e-3 })
    const k = Math.floor(r.trace.length * 0.8)
    const ev = nextDeviceEvent(r, k)
    const { next } = at(r, k)
    expect(next).toContain(`t = ${formatTime(ev.time)}`)
    expect(next).not.toMatch(/NaN|undefined/)
  })

  it('no device event left in the run → no invented consequence', () => {
    const k = hw.trace.length - 1
    expect(nextDeviceEvent(hw, k)).toBeUndefined()
    expect(at(hw, k).next).toBeNull()
  })
})

describe('rectifier WHY: three questions, each from the explanation of the same sample', () => {
  const cases: Array<[CircuitId, { device?: 'diode' | 'scr'; fw?: boolean; ls?: number }]> = [
    ['half-wave:R', {}],
    ['half-wave:RL', { fw: true }],
    ['bridge:RC', {}],
    ['bridge:RL', { device: 'scr' }],
    ['center-tap:RLC', {}],
    ['3ph-bridge:RL', { ls: 2e-3 }],
    ['3ph-half-wave:R', { device: 'scr' }],
  ]
  it.each(cases)('%s: now · path · output, every part filled, no NaN, at samples across a cycle', (id, o) => {
    const r = run(id, o)
    for (let k = Math.floor(r.trace.length * 0.6); k < r.trace.length; k += 37) {
      const { ex } = at(r, k)
      const qs = rectifierWhyQuestions(r, ex)
      expect(qs.map((q) => q.id)).toEqual(['now', 'path', 'output'])
      for (const q of qs) for (const part of [q.question, q.what, q.why, q.principle]) {
        expect(part.length, `${id} k=${k} ${q.id}`).toBeGreaterThan(0)
        expect(part).not.toMatch(/NaN|undefined/)
      }
      // the path question quotes the explainer's own path step, the output question its output step
      const by = (s: string) => ex.chain.find((c) => c.stage === s)
      expect(qs[1].what).toBe(by('path')?.text ?? ex.current.text)
      expect(qs[2].what).toBe(by('output')?.text ?? ex.output.text)
    }
  })
  it('a blocking instant: the path question says there is no closed loop', () => {
    const hw = run('half-wave:R')
    const k = find(hw, (i) => hw.trace.diodes[0].on[i] === 0)
    const path = rectifierWhyQuestions(hw, at(hw, k).ex)[1]
    expect(path.why).toMatch(/no closed loop/)
  })
  it('the output question names the load’s own rule (RC: the capacitor)', () => {
    const r = run('bridge:RC')
    const out = rectifierWhyQuestions(r, at(r, Math.floor(r.trace.length * 0.8)).ex)[2]
    expect(out.principle).toMatch(/capacitor holds its voltage/)
  })
})