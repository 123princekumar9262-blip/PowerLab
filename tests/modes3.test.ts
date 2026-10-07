import { describe, expect, it } from 'vitest'
import { diffParams, diffQuantities, explainChanges } from '../src/experiment/experiment.ts'
import { measure } from '../src/measurements/measurements.ts'
import { evaluateWhatIf, WHAT_IFS } from '../src/prediction/whatIf.ts'
import { conductingOptions, randomReverseTask, reverseAnswers } from '../src/reverse/reverse.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'

describe('Phase G — "What if?" answers come from the simulation and agree with the WHY text', () => {
  for (const q of WHAT_IFS) {
    it(`${q.id}: simulation says "${q.expected}"`, () => {
      const r = evaluateWhatIf(q)
      expect(r.before).not.toBeNull()
      expect(r.after).not.toBeNull()
      expect(r.actual).toBe(q.expected)
    })
  }
})

describe('Phase G — Experiment: before/after explanations', () => {
  it('doubling R: Vdc unchanged, Idc halved, and the WHY text says so', () => {
    const before = THREE_PHASE_DEFAULTS
    const after = { ...before, load: { ...before.load, resistance: 20 } }
    const mb = measure(runSimulation(before, '3ph-bridge:R'))
    const ma = measure(runSimulation(after, '3ph-bridge:R'))
    const changes = diffParams({ circuitId: '3ph-bridge:R', params: before, m: mb }, '3ph-bridge:R', after)
    expect(changes.map((c) => c.key)).toEqual(['resistance'])
    const q = diffQuantities(mb, ma)
    expect(Math.abs(q.find((x) => x.key === 'voutAvg')!.rel!)).toBeLessThan(0.005)
    expect(q.find((x) => x.key === 'ioAvg')!.rel!).toBeCloseTo(-0.5, 3)
    const why = explainChanges(changes, q, true).join(' ')
    expect(why).toMatch(/Vdc stayed the same/)
    expect(why).toMatch(/fell 50\.0 %/)
  })
})

describe('Phase G — Reverse engineering', () => {
  it('for many random tasks the true conducting devices are among the offered options, and pulses are 1/2/3/6', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < 16; k++) {
      const task = randomReverseTask(k % 2 ? 'three' : 'single', rand)
      const r = runSimulation(task.params, `${task.topology}:${task.load}`)
      const a = reverseAnswers(task, r, measure(r).rippleFrequency)
      expect([1, 2, 3, 6]).toContain(a.pulses)
      expect(conductingOptions(task.topology)).toContain(a.conducting)
    }
  })
})
