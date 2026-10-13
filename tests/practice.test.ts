import { describe, expect, it } from 'vitest'
import { labById, topicOf } from '../src/catalogue/catalogue.ts'
import { loadProgress, markSolved, progressKey, updateProgress } from '../src/practice/common.ts'
import {
  BENCHES,
  CASE_POINTS,
  compareRows,
  explainFault,
  faultyCircuit,
  judge,
  KINDS_FOR,
  makeCase,
  roundCases,
  runCircuit,
  runFaulty,
  runHealthy,
  simulable,
  TEMPLATES,
  type Bench,
  type BenchRun,
  type FaultKind,
} from '../src/practice/faults.ts'
import { band, FILTER, lower, nextFilterC, simulateDcdc, simulateFilter, SPECS, upper } from '../src/practice/design.ts'
import { isRight, QUESTIONS } from '../src/practice/interview.ts'
import { PRACTICE_LOADERS } from '../src/practice/index.ts'
import type { SignalId } from '../src/types/simulation.ts'
import { formatSI } from '../src/utils/format.ts'
import { TOPICS as DCDC } from '../src/workspaces/dcdc.tsx'
import { TOPICS as INVERTERS } from '../src/workspaces/inverters.tsx'
import { TOPICS as MAGNETICS } from '../src/workspaces/magnetics.tsx'
import { cpuNow } from './helpers.ts'

// Node has no localStorage: a minimal in-memory one (the stores read it through the guarded helpers)
if (!('localStorage' in globalThis)) {
  const m = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}

// ── Fault diagnosis ─────────────────────────────────────────────────────────

/**
 * The evidence a student sees without the current probe: the output voltage over the last (steady) cycle and
 * the three phase voltages. Two faults are told apart when some sample differs by more than EVIDENCE_V
 * (0.3 V: well above the solver's numerical noise, ~mV, and below what a scope trace shows clearly).
 */
const EVIDENCE_V = 0.3
function evidenceGap(a: BenchRun, b: BenchRun): number {
  const ids: SignalId[] = ['vout', 'vin', 'vb', 'vc']
  const n = Math.min(a.result.trace.length, b.result.trace.length)
  const i0 = n - 1 - Math.round(a.result.params.period / a.result.params.dt)
  let gap = 0
  for (const s of ids) {
    const x = a.result.trace.signals[s]
    const y = b.result.trace.signals[s]
    if (!x || !y) continue
    for (let i = i0; i < n; i++) gap = Math.max(gap, Math.abs(x[i] - y[i]))
  }
  return gap
}

/** Every (part, cause) answer the engine can simulate on a bench, simulated once. */
const candidateCache = new Map<string, Array<{ part: string; kind: FaultKind; run: BenchRun }>>()
function candidates(b: Bench) {
  let c = candidateCache.get(b.id)
  if (!c) {
    c = []
    for (const p of b.parts)
      for (const kind of KINDS_FOR[p.type])
        if (simulable(b, p.id, kind)) {
          const f = faultyCircuit(b, p.id, kind)
          c.push({ part: p.id, kind, run: runCircuit(f.params, f.circuitId) })
        }
    candidateCache.set(b.id, c)
  }
  return c
}

describe('fault diagnosis: cases', () => {
  it('a round is seedable: same set number → same cases; five distinct fault types, at most two per circuit family', () => {
    for (const seed of [1000, 1234, 4821, 9999]) {
      const a = roundCases(seed)
      expect(a.map((c) => c.key)).toEqual(roundCases(seed).map((c) => c.key))
      expect(a).toHaveLength(5)
      expect(new Set(a.map((c) => c.id)).size).toBe(5)
      const fam: Record<string, number> = {}
      for (const c of a) {
        const f = c.bench.id === 'b6l' ? 'b6' : c.bench.id
        fam[f] = (fam[f] ?? 0) + 1
        expect(c.bench.parts.some((p) => p.id === c.part), c.key).toBe(true)
        expect(c.accepted[0]).toEqual({ part: c.part, kind: c.kind })
      }
      expect(Math.max(...Object.values(fam))).toBeLessThanOrEqual(2)
    }
    // different sets differ
    expect(new Set([1000, 2000, 3000, 4000, 5000].map((s) => roundCases(s).map((c) => c.key).join())).size).toBeGreaterThan(1)
  })

  it('every fault changes the waveforms the student sees (vs the healthy circuit), and the runs are steady', () => {
    for (const t of TEMPLATES)
      for (const part of t.parts) {
        const c = makeCase(t, part)
        const h = runHealthy(c)
        const f = runFaulty(c)
        expect(evidenceGap(h, f), c.key).toBeGreaterThan(EVIDENCE_V)
        expect(h.m.steady.reached, `${c.key} healthy steady`).toBe(true)
        expect(f.m.steady.reached, `${c.key} faulty steady`).toBe(true)
      }
  }, 600_000) // every fault of every circuit, twice (faulty and healthy): minutes under a parallel run

  it('every case is solvable: an answer is accepted exactly when its simulated evidence equals the fault’s', () => {
    for (const t of TEMPLATES) {
      const bench = BENCHES[t.bench]
      const cands = candidates(bench)
      for (const part of t.parts) {
        const c = makeCase(t, part)
        const truth = cands.find((x) => x.part === part && x.kind === t.kind)!
        expect(truth, c.key).toBeDefined()
        for (const alt of cands) {
          const accepted = c.accepted.some((a) => a.part === alt.part && a.kind === alt.kind)
          const gap = evidenceGap(truth.run, alt.run)
          if (accepted) expect(gap, `${c.key}: ${alt.part} ${alt.kind} accepted but distinguishable`).toBeLessThan(EVIDENCE_V)
          else expect(gap, `${c.key}: ${alt.part} ${alt.kind} indistinguishable but not accepted`).toBeGreaterThan(EVIDENCE_V)
        }
      }
    }
  })

  it('the symptoms named in WHY are what the simulation measured', () => {
    const peak = (r: BenchRun, id: string) => r.peaks[id] ?? { max: 0, min: 0 }
    for (const t of TEMPLATES) {
      const c = makeCase(t, t.parts[t.parts.length - 1])
      const h = runHealthy(c)
      const f = runFaulty(c)
      switch (c.kind) {
        case 'open':
          if (c.part === 'Dfw') {
            expect(f.result.diodeIds).not.toContain('Dfw')
            expect(f.m.voutMin).toBeLessThan(h.m.voutMin - 5)
            expect(f.m.voutAvg).toBeLessThan(h.m.voutAvg)
          } else {
            expect(peak(f, c.part).max).toBeLessThan(1e-6)
            expect(peak(h, c.part).max).toBeGreaterThan(1)
          }
          break
        case 'short':
          expect(peak(f, c.part).min).toBeLessThan(-10)
          expect(peak(h, c.part).min).toBeGreaterThan(-1e-6)
          break
        case 'high-vf':
          expect(peak(f, c.part).max).toBeGreaterThan(1)
          expect(f.m.voutAvg).toBeLessThan(h.m.voutAvg)
          break
        case 'disconnected':
        case 'weak':
          expect(f.m.voutAvg).toBeLessThan(h.m.voutAvg)
          break
        case 'cap-open':
        case 'cap-dried':
          expect(f.m.ripplePP).toBeGreaterThan(2 * h.m.ripplePP)
          break
      }
      // the comparison table and WHY quote the two runs' own numbers
      const rows = compareRows(c, h, f)
      expect(rows[0].healthy).toBe(formatSI(h.m.voutAvg, 'V'))
      expect(rows[0].faulty).toBe(formatSI(f.m.voutAvg, 'V'))
      const why = explainFault(c, h, f).join(' ')
      expect(why, c.key).not.toMatch(/NaN|undefined|Infinity/)
      expect(why, c.key).toContain(formatSI(f.m.voutAvg, 'V'))
    }
  })

  it('judging: part 2 pt + cause 1 pt, the probe costs 1, equivalent answers count', () => {
    const c = makeCase(TEMPLATES.find((t) => t.id === '6p-open')!, 'D3')
    expect(judge(c, { part: 'D3', kind: 'open' }, false)).toEqual({ partOk: true, kindOk: true, points: CASE_POINTS })
    expect(judge(c, { part: 'D3', kind: 'open' }, true).points).toBe(CASE_POINTS - 1)
    expect(judge(c, { part: 'D3', kind: 'short' }, false)).toEqual({ partOk: true, kindOk: false, points: 2 })
    expect(judge(c, { part: 'D5', kind: 'open' }, true)).toEqual({ partOk: false, kindOk: false, points: 0 })
    const c3 = makeCase(TEMPLATES.find((t) => t.id === '3p-open')!, 'Db')
    expect(judge(c3, { part: 'phase-b', kind: 'disconnected' }, false).points).toBe(CASE_POINTS)
    expect(judge(c3, { part: 'phase-b', kind: 'weak' }, false).points).toBe(2)
  })

  it('a case simulates fast enough for interactive use', () => {
    for (const t of TEMPLATES) {
      const c = makeCase(t, t.parts[0])
      const t0 = cpuNow()
      runFaulty(c)
      expect(cpuNow() - t0, c.key).toBeLessThan(3000)
    }
  })
})

// ── Design ─────────────────────────────────────────────────────────────────

describe('design: requirements judged on the simulation', () => {
  const spec = (id: string) => SPECS.find((s) => s.id === id)!
  /** Known-good designs (hand-calculated with the textbook ripple formulas, then confirmed by the simulation). */
  const GOOD: Record<string, Record<string, number>> = {
    'buck-48-12': { l: 68e-6, c: 22e-6, fs: 100e3, duty: 0.25 },
    'boost-12-24': { l: 47e-6, c: 33e-6, fs: 100e3, duty: 0.5 },
    'buck-light-load': { l: 100e-6, c: 100e-6, fs: 50e3, duty: 5 / 24 },
    'rect-filter': { c: 4700e-6 },
  }

  it('the starting design is not a solution; a sound design passes every requirement', () => {
    for (const s of SPECS) {
      expect(s.evaluate(s.start).verdict, s.id).not.toBe('pass')
      const r = s.evaluate(GOOD[s.id])
      expect(r.checks.map((c) => `${c.id}:${c.verdict}`), s.id).toEqual(r.checks.map((c) => `${c.id}:pass`))
      expect(r.verdict).toBe('pass')
    }
  })

  it('buck / boost: each check’s value IS the simulated value, and its verdict follows the rule', () => {
    for (const [id, kind, vin, vout, io, ilLim, vLim, ipkLim] of [
      ['buck-48-12', 'buck', 48, 12, 5, 0.3, 0.01, 6],
      ['boost-12-24', 'boost', 12, 24, 2, 0.4, 0.02, 5],
    ] as const) {
      for (const d of [GOOD[id], spec(id).start, { ...GOOD[id], l: GOOD[id].l * 0.8 }]) {
        const r = spec(id).evaluate(d)
        const { m } = simulateDcdc(kind, { vin, r: vout / io, l: d.l, c: d.c, fs: d.fs, duty: d.duty })
        const get = (cid: string) => r.checks.find((c) => c.id === cid)!
        expect(get('vout').sim).toBeCloseTo(m.voutAvg, 9)
        expect(get('vout').verdict).toBe(band(m.voutAvg, vout, 0.02, 0.05))
        expect(get('il-ripple').sim).toBeCloseTo(m.ilPP / m.ilAvg, 9)
        expect(get('il-ripple').verdict).toBe(upper(m.ilPP / m.ilAvg, ilLim))
        expect(get('vout-ripple').sim).toBeCloseTo(m.voutPP / m.voutAvg, 9)
        expect(get('vout-ripple').verdict).toBe(upper(m.voutPP / m.voutAvg, vLim))
        const ipk = kind === 'buck' ? m.iqPeak : m.ilMax
        expect(get('ipk').sim).toBeCloseTo(ipk, 9)
        expect(get('ipk').verdict).toBe(upper(ipk, ipkLim, 0.08))
        expect(get('ccm').verdict).toBe(m.mode === 'CCM' ? 'pass' : 'fail')
      }
    }
  })

  it('SIMULATION vs THEORY: the simulated ripples follow the CCM ripple formulas (within 3 %)', () => {
    // buck: ΔiL = Vout(1 − D)/(L·fs), ΔVout = ΔiL/(8·C·fs); boost: ΔiL = Vin·D/(L·fs), ΔVout = Io·D/(C·fs).
    // 3 %: the formulas assume a constant output voltage and ideal devices (1 mΩ here), and ΔVout ignores
    // the small ripple-current share the load takes.
    const b = simulateDcdc('buck', { vin: 48, r: 2.4, l: 68e-6, c: 22e-6, fs: 100e3, duty: 0.25 }).m
    const dil = (b.voutAvg * 0.75) / (68e-6 * 100e3)
    expect(Math.abs(b.ilPP / dil - 1)).toBeLessThan(0.03)
    expect(Math.abs(b.voutPP / (dil / (8 * 22e-6 * 100e3)) - 1)).toBeLessThan(0.03)
    const o = simulateDcdc('boost', { vin: 12, r: 12, l: 47e-6, c: 33e-6, fs: 100e3, duty: 0.5 }).m
    expect(Math.abs(o.ilPP / ((12 * 0.5) / (47e-6 * 100e3)) - 1)).toBeLessThan(0.03)
    expect(Math.abs(o.voutPP / (((o.voutAvg / 12) * 0.5) / (33e-6 * 100e3)) - 1)).toBeLessThan(0.03)
  })

  it('following a hint fixes that requirement (the hint scales the simulated value)', () => {
    const s = spec('buck-48-12')
    const d = { l: 22e-6, c: 10e-6, fs: 100e3, duty: 0.25 }
    const r = s.evaluate(d)
    const il = r.checks.find((c) => c.id === 'il-ripple')!
    expect(il.verdict).toBe('fail')
    const k = il.sim / 0.3
    const r2 = s.evaluate({ ...d, l: d.l * k * 1.02 })
    expect(r2.checks.find((c) => c.id === 'il-ripple')!.verdict).toBe('pass')
    const f = spec('rect-filter')
    const rf = f.evaluate({ c: 1000e-6 })
    const rip = rf.checks.find((c) => c.id === 'ripple')!
    const rf2 = f.evaluate({ c: nextFilterC(1000e-6, rip.sim) })
    expect(rf2.checks.find((c) => c.id === 'ripple')!.verdict).toBe('pass')
  })

  it('rectifier filter: ripple falls and the switch-on surge rises with C — a window exists, judged on the run', () => {
    const cs = [1000e-6, 2200e-6, 4700e-6, 10000e-6]
    const runs = cs.map((c) => simulateFilter(c))
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].m.ripplePP).toBeLessThan(runs[i - 1].m.ripplePP)
      expect(runs[i].inrush).toBeGreaterThan(runs[i - 1].inrush)
    }
    for (const r of runs) expect(r.m.steady.reached).toBe(true)
    const f = spec('rect-filter')
    expect(f.evaluate({ c: 2200e-6 }).checks.find((c) => c.id === 'ripple')!.verdict).toBe('fail')
    expect(f.evaluate({ c: 10000e-6 }).checks.find((c) => c.id === 'inrush')!.verdict).toBe('fail')
    const good = f.evaluate({ c: 4700e-6 })
    const sim = simulateFilter(4700e-6)
    expect(good.checks.find((c) => c.id === 'ripple')!.sim).toBeCloseTo(sim.m.ripplePP / sim.m.voutAvg, 9)
    expect(good.checks.find((c) => c.id === 'vdc')!.verdict).toBe(lower(sim.m.voutAvg, FILTER.vdcMin))
    // THEORY (small ripple): the capacitor alone feeds the load between the charging pulses, ΔV ≈ Idc·td/C with
    // td = (T/2)·(1 − θ/180°) the time between pulses (θ = each diode's conduction angle). The classic
    // Idc/(2·f·C) takes td = T/2 and is an upper bound. 5 %: the load current is not constant during the decay.
    for (const [k, c] of [[2, 4700e-6], [3, 10000e-6]] as const) {
      const r = runs[k]
      const td = (0.5 / 50) * (1 - r.m.conductionAngleDeg / 180)
      expect(Math.abs(r.m.ripplePP / ((r.m.ioAvg * td) / c) - 1), `C = ${c}`).toBeLessThan(0.05)
      expect(r.m.ripplePP).toBeLessThan(r.m.ioAvg / (2 * 50 * c))
    }
  })

  it('light-load buck: CCM at 0.5 A is the simulated mode; DCM raises Vout at light load', () => {
    const s = spec('buck-light-load')
    const bad = s.evaluate(s.start)
    expect(bad.checks.find((c) => c.id === 'ccm-light')!.value).toBe('DCM')
    expect((bad.runs[1] as { m: { voutAvg: number } }).m.voutAvg).toBeGreaterThan(5.1)
  })

  it('a design simulates fast enough for interactive use', () => {
    for (const s of SPECS) {
      const t0 = cpuNow()
      s.evaluate(GOOD[s.id])
      expect(cpuNow() - t0, s.id).toBeLessThan(3000)
    }
  })
})

// ── Interview ──────────────────────────────────────────────────────────────

describe('interview: the simulation answers', () => {
  const outcomes = new Map(QUESTIONS.map((q) => [q.id, q.simulate()]))
  const o = (id: string) => outcomes.get(id)!

  it('every question is answerable: the simulated answer is valid and judged right', () => {
    for (const q of QUESTIONS) {
      const out = o(q.id)
      expect(Number.isFinite(out.answer), q.id).toBe(true)
      if (q.kind === 'choice') {
        expect(Number.isInteger(out.answer) && out.answer >= 0 && out.answer < q.choices!.length, q.id).toBe(true)
        for (let i = 0; i < q.choices!.length; i++) expect(isRight(q, out, i), `${q.id} #${i}`).toBe(i === out.answer)
      } else {
        expect(isRight(q, out, out.answer)).toBe(true)
        expect(isRight(q, out, out.answer * (1 + 2 * (q.tolerance ?? 0.03)))).toBe(false)
      }
      expect(out.explain, q.id).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('SIMULATION vs THEORY: each answer agrees with the textbook relation', () => {
    const vm = Math.SQRT2 * 12
    // choices: the option the simulation picked is the textbook one
    expect(QUESTIONS.find((q) => q.id === 'ripple-1ph')!.choices![o('ripple-1ph').answer]).toBe('100 Hz')
    expect(QUESTIONS.find((q) => q.id === 'ripple-6p')!.choices![o('ripple-6p').answer]).toBe('300 Hz')
    expect(o('freewheel').answer).toBe(0) // rises
    expect(o('ct-piv').answer).toBe(3) // 2·Vm
    expect(o('cap-peak').answer).toBe(0) // rises
    expect(o('buck-dcm').answer).toBe(1) // DCM
    expect(o('boost-double').answer).toBe(1) // D = 50 %
    expect(o('saturation').answer).toBe(0) // saturates
    // numbers (1 %: ideal devices; the residual is the 1 mΩ device model and the sampled waveforms)
    expect(Math.abs(o('6p-vdc').answer / ((3 * Math.sqrt(6)) / Math.PI) / 12 - 1)).toBeLessThan(0.01)
    expect(Math.abs(o('buck-vout').answer / 12 - 1)).toBeLessThan(0.01)
    expect(Math.abs(o('scr-alpha').answer / (((2 * Math.SQRT2) / Math.PI) * 12 * Math.cos(Math.PI / 4)) - 1)).toBeLessThan(0.01)
    expect(Math.abs(o('spwm-v1').answer / 80 - 1)).toBeLessThan(0.01)
    // ct-piv: the simulated PIV itself is 2·Vm
    expect(o('ct-piv').value).toBe(formatSI(2 * vm, 'V'))
  })

  it('the answers come from the topics’ own simulations (not from the formulas)', () => {
    const buck = DCDC.buck
    expect(o('buck-vout').answer).toBe((buck.measure(buck.simulate({ ...buck.defaults, vin: 24, duty: 0.5 })) as { voutAvg: number }).voutAvg)
    const sp = INVERTERS.spwm
    expect(o('spwm-v1').answer).toBe((sp.measure(sp.simulate({ ...sp.defaults, vdc: 100, m: 0.8 })) as { v1: number }).v1)
    const mg = MAGNETICS.inductor
    const a = mg.measure(mg.simulate({ ...mg.defaults, f: 12e3 })) as { ipk: number; saturated: boolean }
    expect(a.saturated).toBe(true)
    expect(o('saturation').value).toContain(formatSI(a.ipk, 'A'))
  })

  it('"Open this circuit" goes to a ready workspace, with settings that workspace understands', () => {
    for (const q of QUESTIONS) {
      const lab = labById(q.link.lab)!
      expect(lab, q.id).toBeDefined()
      expect(topicOf(lab, q.link.topic)?.status, q.id).toBe('ready')
      expect(topicOf(lab, q.link.topic)?.opens, q.id).toBeUndefined()
      const topics: Record<string, { defaults: object }> = { 'dc-dc': DCDC, inverters: INVERTERS, magnetics: MAGNETICS }[q.link.lab] ?? {}
      const defaults = topics[q.link.topic]?.defaults
      for (const k of Object.keys(q.link.query ?? {})) {
        if (q.link.lab === 'rectifiers') expect(['load', 'fw', 'alpha', 'ls'], `${q.id}: ${k}`).toContain(k)
        else expect(defaults && k in defaults, `${q.id}: ${k}`).toBe(true)
      }
    }
  })

  it('each question simulates fast enough for interactive use', () => {
    for (const q of QUESTIONS) {
      const t0 = cpuNow()
      q.simulate()
      expect(cpuNow() - t0, q.id).toBeLessThan(3000)
    }
  })
})

// ── Shell contract and progress ────────────────────────────────────────────

describe('practice pages and progress', () => {
  it('the three activities are lazy pages', () => {
    expect(Object.keys(PRACTICE_LOADERS).sort()).toEqual(['design', 'fault', 'interview'])
  })
  it('progress is stored as { solved: distinct ids, total } under pel.practice.<id>', () => {
    localStorage.clear()
    expect(loadProgress('fault', 12)).toEqual({ solved: [], total: 12 })
    markSolved('fault', 12, '6p-open')
    markSolved('fault', 12, '6p-open')
    markSolved('fault', 12, 'cap-open')
    const raw = JSON.parse(localStorage.getItem(progressKey('fault'))!)
    expect(raw.solved).toEqual(['6p-open', 'cap-open'])
    expect(raw.total).toBe(12)
    updateProgress('design', SPECS.length, (p) => ({ ...p, verdicts: { x: 'pass' } }))
    expect(JSON.parse(localStorage.getItem('pel.practice.design')!)).toEqual({ solved: [], total: SPECS.length, verdicts: { x: 'pass' } })
    localStorage.setItem('pel.practice.interview', '{broken')
    expect(loadProgress('interview', QUESTIONS.length)).toEqual({ solved: [], total: QUESTIONS.length })
  })
})
