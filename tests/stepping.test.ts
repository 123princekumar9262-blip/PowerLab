import { describe, expect, it } from 'vitest'
import { getExplainer } from '../src/explanations/index.ts'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { stepTarget } from '../src/state/stepping.ts'
import { groupEvents, groupIndex } from '../src/visualization/eventGroups.ts'
import { ideal, real } from './helpers.ts'

describe('event landing and stepping', () => {
  for (const [name, r] of [
    ['ideal', runSimulation(ideal())],
    ['real', runSimulation(real())],
  ] as const) {
    const groups = groupEvents(r)

    it(`${name}: a switching event lands on a sample that shows the new diode state`, () => {
      for (const g of groups) {
        const sw = g.events.find((e) => e.kind === 'diode-on' || e.kind === 'diode-off')
        if (!sw) continue
        const s = sampleAt(r, groupIndex(r, g))
        expect(s.diodeState, `${sw.kind} @ ${sw.time}`).toBe(sw.kind === 'diode-on' ? 'ON' : 'OFF')
        // ...and the WHY engine agrees with it.
        expect(getExplainer(r.circuitId).state(r, s.index).diode.on).toBe(sw.kind === 'diode-on')
      }
    })

    it(`${name}: a peak lands on the nearest sample (θ = 90.0°, not one sample late)`, () => {
      const peak = groups.find((g) => g.events.some((e) => e.kind === 'vin-positive-peak'))!
      const s = sampleAt(r, groupIndex(r, peak))
      expect(Math.abs(s.time - r.params.period / 4)).toBeLessThanOrEqual(r.params.dt / 2)
    })

    it(`${name}: stepping forward then backward visits every event in order`, () => {
      let i = 0
      const visited: number[] = []
      for (let k = 0; k < 200; k++) {
        const next = stepTarget(r, groups, i, 1, 'event')
        if (next === i) break
        visited.push(next)
        i = next
      }
      expect(visited.length).toBeGreaterThan(groups.length - 2)
      for (let k = 1; k < visited.length; k++) expect(visited[k]).toBeGreaterThan(visited[k - 1])
      expect(stepTarget(r, groups, visited[3], -1, 'event')).toBe(visited[2])
    })
  }

  it('15° angle steps land on multiples of 15°', () => {
    const r = runSimulation(real({ source: { phaseDeg: 7 } }))
    let i = 0
    for (let k = 0; k < 30; k++) {
      i = stepTarget(r, [], i, 1, 'angle')
      const theta = ((r.params.omega * r.trace.time[i] + r.params.phase) * 180) / Math.PI
      const rem = ((theta % 15) + 15) % 15
      expect(Math.min(rem, 15 - rem)).toBeLessThan(0.1)
    }
  })
})
