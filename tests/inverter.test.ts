import { describe, expect, it } from 'vitest'
import { simulateCircuit } from '../src/converters/engine.ts'
import { compareInverter, idealSegments, measureInverter, voltageTheoryAmp, type InverterRun } from '../src/converters/inverter/analysis.ts'
import { invExperiments, invLessons, invPredictions, invStateAt, invWhy, type InvKind } from '../src/converters/inverter/content.ts'
import { inverterModel, legDevices } from '../src/converters/inverter/model.ts'
import { legCommands, resolveInverter, svDuty, svDwell, type InverterParams } from '../src/converters/inverter/modulation.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { INVERTER_DEFAULTS, inverterTopic } from '../src/topics/inverters.tsx'
import { cpuNow } from './helpers.ts'

const sim = (kind: InvKind, o: Partial<InverterParams> = {}) => inverterTopic(kind).simulate({ ...INVERTER_DEFAULTS[kind], ...o }) as InverterRun
const run = (kind: InvKind, o: Partial<InverterParams> = {}) => {
  const r = sim(kind, o)
  return { r, m: measureInverter(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('inverters: circuit physics from the simulation', () => {
  it('an IGBT conducts only while gated and only forward; a leg never shoots through', () => {
    for (const [kind, o] of [
      ['1ph', {}],
      ['1ph', { td: 20e-6 }],
      ['3ph', {}],
      ['spwm', { modulation: 'spwm-unipolar' as const }],
      ['svpwm', {}],
    ] as const) {
      const r = sim(kind, o)
      for (const d of r.devices) {
        for (let k = 1; k < r.length; k++) {
          if (!d.on[k]) continue
          expect(d.current[k]).toBeGreaterThan(-1e-9)
          if (d.kind === 'igbt') expect(d.gate![k]).toBe(1)
        }
      }
      for (const [su, , sl] of legDevices(r.params).slice(0, r.params.topology === 'three' ? 3 : r.params.topology === 'full' ? 2 : 1)) {
        const up = r.devices.find((x) => x.id === su)!
        const lo = r.devices.find((x) => x.id === sl)!
        for (let k = 0; k < r.length; k++) expect(up.on[k] && lo.on[k]).toBeFalsy()
      }
      expect(r.diagnostics.fallbacks).toBe(0)
    }
  })
  it('KCL: the three phase currents add to zero; the full-bridge current leaves leg A and enters leg B', () => {
    const r = sim('3ph')
    for (let k = 0; k < r.length; k++) expect(Math.abs(r.signals.ia[k] + r.signals.ib[k] + r.signals.ic[k])).toBeLessThan(1e-6)
    const f = sim('1ph')
    for (let k = 1; k < f.length; k += 7) {
      const legA = ['iS1', 'iD1', 'iS2', 'iD2'].reduce((s, id, j) => s + (j % 2 === 0 ? (j === 0 ? 1 : -1) : j === 1 ? -1 : 1) * f.signals[id][k], 0)
      expect(Math.abs(legA - f.signals.io[k])).toBeLessThan(1e-3)
    }
  })
  it('an R load never makes a diode conduct; an R-L load does after every commutation', () => {
    expect(run('1ph', { load: 'R' }).m.diodeFraction).toBeLessThan(1e-9)
    expect(run('1ph').m.diodeFraction).toBeGreaterThan(0.1)
    expect(run('1ph').m.eReturned).toBeGreaterThan(0)
  })
  it('the periodic steady state is reached by shooting and repeats exactly', () => {
    const r = sim('1ph')
    expect(r.diagnostics.steady.method).toBe('shooting')
    expect(r.diagnostics.steady.residual).toBeLessThan(1e-8)
    const N = r.params.stepsPerPeriod
    for (let k = 0; k + N < r.length; k += 53) expect(r.signals.io[k + N]).toBeCloseTo(r.signals.io[k], 6)
  })
  it('a start-up run from rest settles to the same current', () => {
    const st = run('1ph', { view: 'startup' })
    expect(st.r.diagnostics.steady.converged).toBe(true)
    expect(Math.abs(st.m.irms - run('1ph').m.irms) / run('1ph').m.irms).toBeLessThan(0.01)
  })
  it('dead time: both gates of a leg are OFF for td after every command edge; where the current is small or reverses, the voltage changes', () => {
    const r = sim('spwm', { td: 20e-6 })
    const up = r.devices.find((d) => d.id === 'S1')!
    const lo = r.devices.find((d) => d.id === 'S2')!
    let both = 0
    for (let k = 0; k < r.length; k++) if (!up.gate![k] && !lo.gate![k]) both++
    expect(both).toBeGreaterThan(0)
    expect(Math.abs(measureInverter(r).v1 - run('spwm').m.v1)).toBeGreaterThan(0.5)
    // a square wave with a lagging current is NOT affected: the diodes already conduct on the commanded side
    expect(Math.abs(run('1ph', { td: 50e-6 }).m.v1 - run('1ph').m.v1)).toBeLessThan(1e-3)
  })
})

describe('inverters: simulation vs theory (ideal switches, exact R-L current, closed-form/Bessel spectra)', () => {
  const cases: Array<[InvKind, Partial<InverterParams>]> = [
    ['1ph', {}],
    ['1ph', { topology: 'half' }],
    ['1ph', { modulation: 'quasi', alphaDeg: 30 }],
    ['1ph', { modulation: 'quasi', alphaDeg: 18 }],
    ['1ph', { load: 'R' }],
    ['1ph', { l: 0.1 }],
    ['3ph', {}],
    ['3ph', { load: 'R' }],
    ['spwm', {}],
    ['spwm', { modulation: 'spwm-unipolar' }],
    ['spwm', { modulation: 'spwm', mf: 21 }],
    ['spwm', { sampling: 'regular-sym' }],
    ['spwm', { m: 0.4, mf: 9 }],
    ['svpwm', {}],
    ['svpwm', { m: 1.1, mf: 21 }],
  ]
  it.each(cases.map(([k, o]) => [`${k} ${JSON.stringify(o)}`, k, o] as const))('%s', (_n, kind, o) => {
    const { r, m } = run(kind, o)
    const c = compareInverter(r, m)
    for (const row of c.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error} > ${row.tolerance}`)
  })
  it('closed forms: square 4Vdc/π, quasi-square (4Vdc/π)·cos α, six-step 2√3·Vdc/π, SPWM m·Vdc and (√3/2)·m·Vdc', () => {
    expect(run('1ph').m.v1).toBeCloseTo((4 * 100) / Math.PI, 1)
    expect(run('1ph', { topology: 'half' }).m.v1).toBeCloseTo((2 * 100) / Math.PI, 1)
    expect(run('1ph', { modulation: 'quasi', alphaDeg: 30 }).m.v1).toBeCloseTo(((4 * 100) / Math.PI) * Math.cos(Math.PI / 6), 1)
    expect(run('3ph').m.v1).toBeCloseTo((2 * Math.sqrt(3) * 100) / Math.PI, 1)
    expect(run('spwm').m.v1).toBeCloseTo(0.8 * 100, 1)
    expect(run('spwm', { modulation: 'spwm', mf: 21 }).m.v1).toBeCloseTo((Math.sqrt(3) / 2) * 0.8 * 100, 1)
  })
  it('harmonic structure: quasi-square α = 30° has no 3rd; six-step has only 6k ± 1; unipolar cancels the mf group', () => {
    const q = run('1ph', { modulation: 'quasi', alphaDeg: 30 }).m
    expect(q.vHarm[3].amp).toBeLessThan(1e-3 * q.v1)
    const s = run('3ph').m
    for (const h of [2, 3, 4, 6, 9]) expect(s.vHarm[h].amp).toBeLessThan(1e-3 * s.v1)
    for (const h of [5, 7, 11, 13]) expect(s.vHarm[h].amp).toBeCloseTo(s.v1 / h, 0)
    const u = run('spwm', { modulation: 'spwm-unipolar' })
    for (const h of [u.r.params.mf - 2, u.r.params.mf, u.r.params.mf + 2]) expect(u.m.vHarm[h].amp).toBeLessThan(1e-3 * u.m.v1)
    expect(u.m.vHarm[2 * u.r.params.mf + 1].amp).toBeGreaterThan(0.05 * u.m.v1)
  })
  it('the Bessel series predicts every SPWM output harmonic (bipolar, unipolar, three-phase)', () => {
    for (const o of [{}, { modulation: 'spwm-unipolar' as const }, { modulation: 'spwm' as const }]) {
      const { r, m } = run('spwm', o)
      for (let h = 1; h <= 3 * r.params.mf; h++) {
        const th = voltageTheoryAmp(r.params, h)!
        expect(Math.abs(m.vHarm[h].amp - th)).toBeLessThan(2e-3 * m.v1)
      }
    }
  })
})

describe('SVPWM: the modulator', () => {
  const p = resolveInverter({ ...INVERTER_DEFAULTS.svpwm, m: 0.95, mf: 24 }, INVERTER_DEFAULTS.svpwm).params
  it('dwell times reproduce the reference vector (volt-second balance) in every switching period', () => {
    const states = [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
      [1, 0, 1],
    ]
    const vec = (s: number[]) => {
      // αβ of a switching state (amplitude-invariant): (2/3)·Vdc·(sa + a·sb + a²·sc)
      const re = ((2 / 3) * p.vdc * (s[0] - 0.5 * s[1] - 0.5 * s[2]))
      const im = ((2 / 3) * p.vdc * ((Math.sqrt(3) / 2) * (s[1] - s[2])))
      return [re, im]
    }
    for (let k = 0; k < p.mf; k++) {
      const ts = k * p.tc
      const d = svDwell(p, ts)
      const v1 = vec(states[d.sector])
      const v2 = vec(states[(d.sector + 1) % 6])
      const avg = [(v1[0] * d.t1 + v2[0] * d.t2) / p.tc, (v1[1] * d.t1 + v2[1] * d.t2) / p.tc]
      const th = p.omega * ts
      const vref = (p.m * p.vdc) / 2
      expect(avg[0]).toBeCloseTo(vref * Math.cos(th), 9)
      expect(avg[1]).toBeCloseTo(vref * Math.sin(th), 9)
      expect(d.t0).toBeGreaterThanOrEqual(-1e-15)
    }
  })
  it('the leg duties equal sine references with min-max zero-sequence injection (an independent derivation)', () => {
    for (let k = 0; k < p.mf; k++) {
      const ts = k * p.tc
      const th = p.omega * ts
      const v = [0, 1, 2].map((x) => p.m * Math.cos(th - (x * 2 * Math.PI) / 3))
      const zs = -(Math.max(...v) + Math.min(...v)) / 2
      for (let leg = 0; leg < 3; leg++) expect(svDuty(p, leg, ts)).toBeCloseTo((1 + v[leg] + zs) / 2, 12)
    }
  })
  it('SVPWM stays linear up to m = 2/√3 (VLL1 ∝ m), sine-triangle PWM does not', () => {
    const at = (kind: 'svpwm' | 'spwm', m: number) => run(kind, kind === 'spwm' ? { modulation: 'spwm', m, mf: 21 } : { m, mf: 21 }).m.v1
    const sv = at('svpwm', 1.1) / at('svpwm', 0.55)
    const sp = at('spwm', 1.1) / at('spwm', 0.55)
    expect(sv).toBeCloseTo(2, 1)
    expect(sp).toBeLessThan(1.98)
  })
  it('the commands of each leg alternate ON/OFF (well-formed edge lists)', () => {
    for (const edges of legCommands(p)) for (let i = 1; i < edges.length; i++) expect(edges[i].rising).not.toBe(edges[i - 1].rising)
    expect(idealSegments(p).length).toBeGreaterThan(4 * p.mf)
  })
})

describe('inverters: explanations and content from the simulation', () => {
  const kinds: InvKind[] = ['1ph', '3ph', 'spwm', 'svpwm']
  it.each(kinds)('%s: WHY cards follow the device states and never contain NaN', (kind) => {
    const { r, m } = run(kind)
    let diodeSeen = false
    for (let k = 1; k < r.length; k += 29) {
      const st = invStateAt(r, k)
      const cards = invWhy(r, st, m)
      if (st.legs.some((l) => l.kind === 'diode')) {
        diodeSeen = true
        expect(cards[0].question).toMatch(/Why does D\d conduct/)
      }
      for (const c of cards) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
    }
    expect(diodeSeen).toBe(true)
  })
  it.each(kinds)('%s: lessons, experiments and predictions run on the simulation', (kind) => {
    const topic = inverterTopic(kind)
    for (const l of invLessons(kind))
      for (const s of l.steps) {
        const r = topic.simulate({ ...INVERTER_DEFAULTS[kind], ...l.base, ...s.params }) as InverterRun
        const st = invStateAt(r, converterIndexAt(r, s.at(r)))
        noBadText(s.body(st, measureInverter(r), r))
      }
    for (const e of invExperiments(kind)) {
      const p0 = { ...INVERTER_DEFAULTS[kind] }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureInverter(topic.simulate(p0) as InverterRun)
      const a = measureInverter(topic.simulate(p1) as InverterRun)
      expect([kind, e.id, e.judge(b, a)]).toEqual([kind, e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
    for (const t of invPredictions(kind, 2)) {
      const p = { ...INVERTER_DEFAULTS[kind], ...t.params }
      expect(Number.isFinite(t.answer(measureInverter(topic.simulate(p) as InverterRun)))).toBe(true)
      noBadText(t.theory(p))
    }
  })
  it('every inverter topic simulates its defaults fast enough for live interaction', () => {
    for (const kind of kinds) {
      const t0 = cpuNow()
      const r = sim(kind)
      expect(cpuNow() - t0).toBeLessThan(3000)
      expect(inverterTopic(kind).analyze.compare(r, measureInverter(r)).allPass).toBe(true)
    }
  })
})

export { simulateCircuit, inverterModel }
