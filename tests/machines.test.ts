import { describe, expect, it } from 'vitest'
import { dcGenerator, dcMotor, genFrequency, idealTransformer, radFromRpm, rotorSpeed, rpmFromRad, slip, syncSpeed } from '../src/machines/calculations/formulas.ts'
import { filterMachines, MACHINES, NO_FILTER } from '../src/machines/catalog.ts'

describe('3D Machines Lab: engineering relations', () => {
  it('DC motor: steady state from V = E + Ia·Ra, E = kΦ·ω, T = kΦ·Ia = TL', () => {
    const r = dcMotor({ va: 24, kphi: 0.05, ra: 1, tl: 0.1 })!
    expect(r.stalled).toBe(false)
    expect(r.ia).toBeCloseTo(2, 12) // 0.1 / 0.05
    expect(r.e).toBeCloseTo(22, 12) // 24 − 2·1
    expect(r.w).toBeCloseTo(440, 10) // 22 / 0.05
    expect(r.n).toBeCloseTo(4201.69, 1)
    expect(r.pin).toBeCloseTo(48, 12)
    expect(r.pcu).toBeCloseTo(4, 12)
    expect(r.pout).toBeCloseTo(44, 10) // = E·Ia: power balance
    expect(r.pout + r.pcu).toBeCloseTo(r.pin, 10)
    expect(r.eff!).toBeCloseTo(44 / 48, 12)
    expect(r.stallTorque).toBeCloseTo(1.2, 12)
    expect(r.noLoad).toBeCloseTo(480, 12)
  })
  it('DC motor: more load → more current, less speed; above the stall torque it stalls (no invented speed)', () => {
    const a = dcMotor({ va: 24, kphi: 0.05, ra: 1, tl: 0.1 })!
    const b = dcMotor({ va: 24, kphi: 0.05, ra: 1, tl: 0.5 })!
    expect(b.ia).toBeGreaterThan(a.ia)
    expect(b.n).toBeLessThan(a.n)
    const s = dcMotor({ va: 24, kphi: 0.05, ra: 1, tl: 1.3 })!
    expect(s.stalled).toBe(true)
    expect(s.n).toBe(0)
    expect(s.ia).toBeCloseTo(24, 12)
    expect(dcMotor({ va: 24, kphi: 0, ra: 1, tl: 0.1 })).toBeNull()
  })
  it('DC generator: E = kΦ·ω, terminal voltage below E by Ia·Ra; power balance', () => {
    const g = dcGenerator({ kphi: 0.1, n: 1500, ra: 0.5, rl: 10 })
    expect(g.e).toBeCloseTo(0.1 * radFromRpm(1500), 12)
    expect(g.v).toBeCloseTo(g.e - g.ia * 0.5, 12)
    expect(g.pmech).toBeCloseTo(g.pout + g.pcu, 10)
  })
  it('AC: Ns = 120f/P, slip, rotor speed, generated frequency', () => {
    expect(syncSpeed(50, 4)).toBe(1500)
    expect(syncSpeed(60, 2)).toBe(3600)
    expect(slip(1500, 1440)).toBeCloseTo(0.04, 12)
    expect(rotorSpeed(1500, 0.04)).toBeCloseTo(1440, 9)
    expect(genFrequency(4, 1500)).toBe(50)
    expect(rpmFromRad(radFromRpm(1234))).toBeCloseTo(1234, 9)
  })
  it('ideal transformer: V2 = V1·N2/N1, I1 = I2·N2/N1, P1 = P2, R seen = a²·R', () => {
    const t = idealTransformer({ v1: 230, n1: 500, n2: 50, rl: 10 })
    expect(t.v2).toBeCloseTo(23, 12)
    expect(t.i2).toBeCloseTo(2.3, 12)
    expect(t.i1).toBeCloseTo(0.23, 12)
    expect(t.i1 * 230).toBeCloseTo(t.p, 10)
    expect(t.rSeen).toBeCloseTo(1000, 9)
  })
})

describe('3D Machines Lab: catalogue', () => {
  it('ids are unique; search and filters work', () => {
    expect(new Set(MACHINES.map((m) => m.id)).size).toBe(MACHINES.length)
    expect(filterMachines({ ...NO_FILTER, q: 'commutator' }).map((m) => m.id)).toContain('dc-motor')
    expect(filterMachines({ ...NO_FILTER, family: 'semiconductor' }).every((m) => m.family === 'semiconductor')).toBe(true)
    expect(filterMachines({ ...NO_FILTER, supply: 'AC', role: 'Generator' }).map((m) => m.id)).toContain('alternator')
    expect(filterMachines({ ...NO_FILTER, q: 'zzzz' })).toEqual([])
  })
})

// ── every built machine: its data is complete and consistent ─────────────────────────────────────────────
import { MODEL_LOADERS } from '../src/machines/models/index.ts'

describe('3D Machines Lab: built models', () => {
  it('a catalogue entry is ready exactly when its model exists', () => {
    for (const m of MACHINES) expect(m.status === 'ready', m.id).toBe(m.id in MODEL_LOADERS)
    for (const id of Object.keys(MODEL_LOADERS)) expect(MACHINES.some((m) => m.id === id), id).toBe(true)
  })
  it.each(Object.keys(MODEL_LOADERS))('%s: parts, steps, layers, quiz, calculations are consistent', async (id) => {
    const def = (await MODEL_LOADERS[id]()).default
    expect(def.id).toBe(id)
    const parts = new Set(def.parts.map((p) => p.id))
    expect(parts.size, 'unique part ids').toBe(def.parts.length)
    expect(def.parts.length).toBeGreaterThanOrEqual(5)
    for (const p of def.parts) {
      expect(p.what.length > 5 && p.function.length > 10, `${p.id} described`).toBe(true)
      expect(p.stage).toBeGreaterThanOrEqual(1)
      for (const r of p.related ?? []) expect(parts.has(r), `${p.id} → ${r}`).toBe(true)
    }
    // explode stages run 1 … S without gaps
    const stages = [...new Set(def.parts.map((p) => p.stage))].sort((a, b) => a - b)
    expect(stages).toEqual(stages.map((_, k) => k + 1))
    const layers = new Set(def.layers.map((l) => l.id))
    expect(def.steps.length).toBeGreaterThanOrEqual(4)
    for (const s of def.steps) {
      for (const f of s.focus) expect(parts.has(f), `${s.id} focus ${f}`).toBe(true)
      for (const l of s.layers) expect(layers.has(l), `${s.id} layer ${l}`).toBe(true)
      expect(s.text.length).toBeGreaterThan(60)
    }
    for (const l of def.layers) expect(l.legend.length, `${l.id} legend`).toBeGreaterThan(15)
    expect(def.quiz.length).toBeGreaterThanOrEqual(4)
    for (const q of def.quiz) {
      if (q.part) expect(parts.has(q.part), `${q.id} part`).toBe(true)
      if (q.kind === 'order') expect(q.options.length).toBeGreaterThanOrEqual(3)
      else expect(q.answer >= 0 && q.answer < q.options.length, q.id).toBe(true)
      expect(q.explain.length).toBeGreaterThan(20)
    }
    // calculations: every value finite or explicitly null, at the defaults and at every parameter's extremes
    const base = Object.fromEntries(def.params.map((p) => [p.id, p.value]))
    const sets = [base, ...def.params.flatMap((p) => [{ ...base, [p.id]: p.options?.[0] ?? p.min }, { ...base, [p.id]: p.options?.at(-1) ?? p.max }])]
    for (const ps of sets)
      for (const c of def.calc(ps)) {
        expect(c.formula.length, `${c.id} formula`).toBeGreaterThan(2)
        expect(c.value === null || Number.isFinite(c.value), `${id} ${c.id} at ${JSON.stringify(ps)}`).toBe(true)
      }
    expect(def.content.overview.length).toBeGreaterThan(40)
    expect(def.manifest.limitations.length).toBeGreaterThan(0)
  })
})
