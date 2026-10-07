import { describe, expect, it } from 'vitest'
import { CHALLENGES, evaluateChallenge, withOverrides } from '../src/challenges/challenges.ts'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { runSimulation } from '../src/simulation/engine.ts'

describe('Phase 10 — every challenge is solvable and not pre-solved', () => {
  for (const ch of CHALLENGES) {
    const id = `${ch.topology}:${ch.load}` as const

    it(`${ch.id}: the starting design does not already pass`, () => {
      const r = runSimulation(ch.params, id)
      expect(evaluateChallenge(ch, compareWithTheory(r), r.params).stars).toBe(0)
    })

    it(`${ch.id}: a known design earns all three stars`, () => {
      const r = runSimulation(withOverrides(ch.params, ch.solution), id)
      const res = evaluateChallenge(ch, compareWithTheory(r), r.params)
      expect(res.steady).toBe(true)
      expect(res.criteria.map((c) => `${c.label}: ${c.value} ${c.pass}`).join(' | ')).not.toMatch(/false/)
      expect(res.stars).toBe(3)
    })

    it(`${ch.id}: the solution only touches editable parameters`, () => {
      const map: Record<string, string> = { vrms: 'vrms', frequency: 'frequency', resistance: 'resistance', inductance: 'inductance', capacitance: 'capacitance', ron: 'ron', vf: 'vf', alphaDeg: 'alpha' }
      for (const k of Object.keys(ch.solution)) expect(ch.editable).toContain(map[k])
    })
  }
})
