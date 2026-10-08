import { describe, expect, it } from 'vitest'
import { compareDrive, DRIVE_EXPERIMENTS, DRIVE_LESSONS, drivePredictions, driveStateAt, driveView, driveWhy } from '../src/converters/drives/content.ts'
import { averagedSteady, DRIVE_DEFAULTS, measureDrive, rpm, simulateDrive, type DriveParams } from '../src/converters/drives/motor.ts'
import { averagedDrive, exactDrive } from '../src/converters/drives/theory.ts'
import { converterIndexAt } from '../src/converters/engine.ts'

const run = (o: Partial<DriveParams> = {}) => {
  const r = simulateDrive({ ...DRIVE_DEFAULTS, ...o })
  return { r, m: measureDrive(r) }
}
const noBadText = (s: string) => expect(s).not.toMatch(/NaN|undefined|Infinity/)

describe('DC motor drive: physics', () => {
  it('continuous conduction: the period means satisfy the averaged equations exactly', () => {
    for (const bridge of ['1q', '2q'] as const) {
      const { r, m } = run({ view: 'steady', bridge })
      const p = r.params
      expect(m.dcm).toBe(false)
      const av = averagedSteady(p, p.duty, p.tl)
      expect(m.wEnd / av.w - 1).toBeLessThan(1e-6)
      expect(Math.abs(m.iEnd / av.i - 1)).toBeLessThan(1e-5)
      // the armature equation averaged over the period: v̄a = Ra·ī + k·ω̄ = d·Vdc
      expect(m.vaEnd).toBeCloseTo(p.duty * p.vdc, 6)
      expect(r.diagnostics.steady.converged).toBe(true)
    }
  })
  it('discontinuous conduction (1Q, light load): the current stops and the speed exceeds the averaged value', () => {
    const { r, m } = run({ view: 'steady', tl: 0.02 })
    expect(m.dcm).toBe(true)
    expect(m.iMin).toBeGreaterThan(-1e-9)
    expect(m.wEnd).toBeGreaterThan(1.05 * averagedSteady(r.params, r.params.duty, r.params.tl).w)
    // two quadrants never stop the current: the averaged speed holds
    const q2 = run({ view: 'steady', tl: 0.02, bridge: '2q' })
    expect(q2.m.dcm).toBe(false)
    expect(q2.m.iMin).toBeLessThan(0)
    expect(Math.abs(q2.m.wEnd / averagedSteady(q2.r.params, 0.6, 0.02).w - 1)).toBeLessThan(1e-6)
  })
  it('start-up: a large inrush current, then the run settles at the steady state', () => {
    const { r, m } = run()
    expect(m.iPeak).toBeGreaterThan(10 * m.iEnd)
    expect(m.iPeak).toBeLessThan((r.params.duty * r.params.vdc) / r.params.ra)
    expect(m.settled).toBe(true)
    const ss = run({ view: 'steady' }).m
    expect(Math.abs(m.wEnd / ss.wEnd - 1)).toBeLessThan(2e-3)
    // soft start lowers the peak
    expect(run({ tramp: 0.02 }).m.iPeak).toBeLessThan(0.7 * m.iPeak)
  })
  it('energy is conserved over the run: supply = rotor + Ra + load + friction + La', () => {
    for (const o of [{}, { bridge: '2q' as const, event: 'duty' as const }, { tl: 0.02 }]) expect(Math.abs(run(o).m.balance)).toBeLessThan(1e-3)
  })
  it('braking: only the two-quadrant chopper reverses the current and returns energy', () => {
    const a = run({ event: 'duty', bridge: '1q' }).m
    const b = run({ event: 'duty', bridge: '2q' }).m
    expect(a.iNeg).toBeGreaterThan(-1e-9)
    expect(a.eregen).toBe(0)
    expect(b.iNeg).toBeLessThan(-5)
    expect(b.eregen).toBeGreaterThan(0.1)
    expect(b.nEnd).toBeLessThan(a.nEnd)
  })
  it('load step: the speed droops by Ra·ΔTL/(k² + Ra·B)', () => {
    const { r, m } = run({ event: 'load' })
    const p = r.params
    const droop = (p.ra * (p.tl2 - p.tl)) / (p.ke * p.ke + p.ra * p.b)
    // both plateaus are within ~0.05 % of settled (8 slowest time constants): the droop to ~1 %
    expect(Math.abs((m.wPre! - m.wEnd) / droop - 1)).toBeLessThan(0.015)
  })
  it('the current ripple follows Vdc·d·(1 − d)/(La·fs) when La/Ra ≫ Ts', () => {
    for (const fs of [5e3, 20e3]) {
      const { r, m } = run({ view: 'steady', fs, tl: 0.3 })
      const p = r.params
      expect(Math.abs(m.ripple / ((p.vdc * p.duty * (1 - p.duty)) / (p.la * p.fs)) - 1)).toBeLessThan(0.02)
    }
  })
})

describe('DC motor drive: simulation vs the exact PWL solution', () => {
  const cases: Array<Partial<DriveParams>> = [
    {},
    { view: 'steady' },
    { view: 'steady', bridge: '2q', duty: 0.3 },
    { tl: 0.02 },
    { tl: 0.02, view: 'steady' },
    { event: 'duty', bridge: '2q' },
    { event: 'duty' },
    { event: 'load' },
    { tramp: 0.02 },
    { view: 'steady', la: 0.3e-3, tl: 0.05 },
    { view: 'steady', fs: 1e3, la: 5e-3 },
    { vdc: 300, ke: 0.8, ra: 2, la: 20e-3, j: 5e-3, tl: 2, view: 'steady' },
  ]
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const { r, m } = run(c)
    const cmp = compareDrive(r, m)
    for (const row of cmp.rows) if (!row.pass) throw new Error(`${row.key}: sim ${row.sim} exact ${row.exact} error ${row.error}`)
    expect(cmp.rows.length).toBeGreaterThanOrEqual(4)
    if (m.dcm) expect(cmp.rows.find((x) => x.key === 'n')!.textbook!.notApplicable).toBeTruthy()
  })
  it('the exact theory and the averaged model agree on the mean in continuous conduction', () => {
    const { r } = run({ view: 'steady' })
    const ex = exactDrive(r.params)
    const av = averagedDrive(r.params)
    expect(ex.wEnd / av.wSteady - 1).toBeLessThan(1e-9)
    expect(ex.dcm).toBe(false)
    expect(av.dcmPredicted).toBe(false)
    expect(averagedDrive(run({ view: 'steady', tl: 0.02 }).r.params).dcmPredicted).toBe(true)
  })
})

describe('DC motor drive: explanations and content', () => {
  it('the state, the view and the WHY follow the simulation and never contain NaN', () => {
    for (const o of [{}, { view: 'steady' as const, tl: 0.02 }, { bridge: '2q' as const, event: 'duty' as const }]) {
      const { r, m } = run(o)
      const phases = new Set<string>()
      for (let k = 0; k < r.length; k += Math.max(1, Math.floor(r.length / 400))) {
        const st = driveStateAt(r, k)
        phases.add(st.phase)
        const v = driveView(st, r)
        for (const row of v.rows) noBadText(row.v)
        for (const c of driveWhy(r, st, m)) for (const t of [c.question, c.what, c.why, c.equation, c.physics, c.whatIf]) noBadText(t)
      }
      if (o.tl === 0.02) expect(phases.has('zero current')).toBe(true)
      if (o.bridge === '2q') expect(phases.has('regenerating') || phases.has('braking')).toBe(true)
    }
  })
  it('lessons, experiments and predictions', () => {
    for (const l of DRIVE_LESSONS)
      for (const s of l.steps) {
        const r = simulateDrive({ ...DRIVE_DEFAULTS, ...l.base, ...s.params })
        const t = s.at(r)
        expect(Number.isFinite(t)).toBe(true)
        noBadText(s.body(driveStateAt(r, converterIndexAt(r, t)), measureDrive(r), r))
      }
    for (const e of DRIVE_EXPERIMENTS) {
      const p0 = { ...DRIVE_DEFAULTS }
      const p1 = { ...p0, ...e.change(p0) }
      const b = measureDrive(simulateDrive(p0))
      const a = measureDrive(simulateDrive(p1))
      expect([e.id, e.judge(b, a)]).toEqual([e.id, 0])
      noBadText(e.why(b, a, p0, p1))
    }
    for (const t of drivePredictions(1)) {
      const p = { ...DRIVE_DEFAULTS, ...t.params }
      const m = measureDrive(simulateDrive(p))
      expect(Number.isFinite(t.answer(m))).toBe(true)
      noBadText(t.theory(p))
    }
    // the speed prediction's theory is close to the simulation
    const sp = drivePredictions(0)[0]
    const p = { ...DRIVE_DEFAULTS, ...sp.params }
    expect(Math.abs(sp.answer(measureDrive(simulateDrive(p))) / rpm((p.duty * p.vdc) / p.ke) - 1)).toBeLessThan(0.03)
  })
})
