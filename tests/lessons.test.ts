import { describe, expect, it } from 'vitest'
import { fill, factsFor } from '../src/learning/facts.ts'
import { LESSONS } from '../src/learning/lessons.ts'
import { resolveTarget } from '../src/learning/target.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { indexAtTime, runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { getExplainer } from '../src/explanations/index.ts'
import { indexAtOrAfter } from '../src/simulation/engine.ts'

const runLesson = (id: string) => {
  const l = LESSONS.find((x) => x.id === id)!
  const r = runSimulation(l.params, `${l.topology}:${l.load}`)
  return { l, r, c: compareWithTheory(r) }
}
const at = (r: ReturnType<typeof runSimulation>, target: Parameters<typeof resolveTarget>[1]) => {
  const t = resolveTarget(r, target)
  return sampleAt(r, 'event' in target ? indexAtOrAfter(r, t) : indexAtTime(r, t))
}

describe('Phase 8 — every lesson step is true in the simulation', () => {
  it('all placeholders resolve and every cursor target exists', () => {
    for (const l of LESSONS) {
      const r = runSimulation(l.params, `${l.topology}:${l.load}`)
      const c = compareWithTheory(r)
      for (const step of l.steps) {
        const s = step.at ? at(r, step.at) : null
        const text = fill(step.body, factsFor(r, c, s))
        expect(text, `${l.id}/${step.title}`).not.toMatch(/\{\w+\}|NaN|undefined|Infinity/)
        if (step.at && 'event' in step.at) expect(r.events.some((e) => e.kind === (step.at as { event: string }).event), `${l.id}: event ${step.at.event}`).toBe(true)
        if (step.quiz) expect(step.quiz.answer).toBeLessThan(step.quiz.options.length)
      }
      // Lessons run in steady state, so quoted measurements are the settled values.
      expect(c.measurements.steady.reached, l.id).toBe(true)
    }
  })

  it('one-way valve: conducts at 45°, blocks at 270°', () => {
    const { r } = runLesson('hw-r')
    expect(at(r, { angleDeg: 45 }).diodeState).toBe('ON')
    expect(at(r, { angleDeg: 270 }).diodeState).toBe('OFF')
    expect(at(r, { angleDeg: 270 }).vout).toBe(0)
  })

  it('real diode: turn-on step lands where Vin = Vf', () => {
    const { r } = runLesson('hw-real')
    const s = at(r, { event: 'diode-on' })
    expect(s.diodeState).toBe('ON')
    expect(s.vin).toBeGreaterThan(0.7)
    expect(s.vin).toBeLessThan(0.8)
  })

  it('bridge: D1+D4 at 60°, D2+D3 at 240°', () => {
    const { r } = runLesson('bridge-r')
    const a = at(r, { angleDeg: 60 }).diodes.map((d) => d.on)
    const b = at(r, { angleDeg: 240 }).diodes.map((d) => d.on)
    expect(a).toEqual([true, false, false, true])
    expect(b).toEqual([false, true, true, false])
  })

  it('center-tap: PIV quoted at the negative peak is ≈ 2Vm', () => {
    const { r, c } = runLesson('ct-r')
    expect(c.measurements.piv / r.params.vm).toBeGreaterThan(1.9)
  })

  it('RL: vL > 0 at 60°, current still rising at 120°, D1 ON with vin < 0 at 200°', () => {
    const { r } = runLesson('hw-rl')
    expect(at(r, { angleDeg: 60 }).values.vl!).toBeGreaterThan(0)
    const ex = getExplainer(r.circuitId)
    expect(ex.state(r, indexAtTime(r, resolveTarget(r, { angleDeg: 120 }))).current.trend).toBe('increasing')
    const s200 = at(r, { angleDeg: 200 })
    expect(s200.vin).toBeLessThan(0)
    expect(s200.diodeState).toBe('ON')
    expect(s200.vout).toBeLessThan(0)
    expect(ex.state(r, s200.index).headline).toMatch(/held on by the inductor/)
  })

  it('RC: conducting at 75°, capacitor alone at 270°', () => {
    const { r } = runLesson('hw-rc')
    expect(at(r, { angleDeg: 75 }).diodeState).toBe('ON')
    const s = at(r, { angleDeg: 270 })
    expect(s.diodeState).toBe('OFF')
    expect(s.values.ic!).toBeLessThan(0)
    expect(s.io).toBeGreaterThan(0)
  })

  it('LC filter: inductor current continuous', () => {
    const { c } = runLesson('bridge-rlc')
    expect(c.measurements.rectCurrentMin!).toBeGreaterThan(0)
  })

  it('energy lesson: C charging at 80°, C supplying R at 150° with all diodes off', () => {
    const { r } = runLesson('energy')
    expect(at(r, { angleDeg: 80 }).values.ic!).toBeGreaterThan(0)
    const s = at(r, { angleDeg: 150 })
    expect(s.diodes.every((d) => !d.on)).toBe(true)
    expect(s.values.ic!).toBeLessThan(0)
  })
})

describe('three-phase lessons are true in the simulation', () => {
  it('six-pulse bridge: D1+D6 at 60°, D1+D2 at 120°; 3-pulse: Da at 75°', () => {
    const b = runLesson('3ph-bridge').r
    expect(at(b, { angleDeg: 60 }).diodes.filter((d) => d.on).map((d) => d.id).sort()).toEqual(['D1', 'D6'])
    expect(at(b, { angleDeg: 120 }).diodes.filter((d) => d.on).map((d) => d.id).sort()).toEqual(['D1', 'D2'])
    const h = runLesson('3ph-halfwave').r
    expect(at(h, { angleDeg: 75 }).diodes.filter((d) => d.on).map((d) => d.id)).toEqual(['Da'])
  })
  it('SCR lesson: D1 turns on α = 45° after its natural point (θ = 75°)', () => {
    const { r } = runLesson('3ph-scr')
    const t = resolveTarget(r, { event: 'diode-on', device: 'D1' })
    expect((((r.params.omega * t * 180) / Math.PI) % 360 + 360) % 360).toBeCloseTo(75, 1)
  })
  it('RL lesson: same Vdc as the R load (inductor average voltage is zero)', () => {
    const { c } = runLesson('3ph-rl')
    const rload = compareWithTheory(runSimulation({ ...LESSONS.find((l) => l.id === '3ph-rl')!.params }, '3ph-bridge:R'))
    expect(c.measurements.voutAvg).toBeCloseTo(rload.measurements.voutAvg, 2)
  })
})
