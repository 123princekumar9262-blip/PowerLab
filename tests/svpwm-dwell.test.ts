import { describe, expect, it } from 'vitest'
import { invStateAt, svDwellText, svMidSectorTime } from '../src/converters/inverter/content.ts'
import { converterIndexAt } from '../src/converters/engine.ts'
import { TOPICS as INV } from '../src/workspaces/inverters.tsx'

/*
 * SVPWM dwell times: sampled once per switching period. The lesson step about dwell times lands where all
 * three are non-zero; on a sector boundary (a sample exactly on an active vector) one is zero, and the
 * text says why. Sector, sampled angle, T1, T2 and T0 stay consistent at every sample.
 */
const t = INV.svpwm
const r = t.simulate(t.defaults as never)
const p = r.params as unknown as { tc: number; period: number; m: number; vdc: number; omega: number }
const sv = (k: number) => invStateAt(r as never, k).sv!

describe('SVPWM dwell times', () => {
  it('the "dwell times" lesson step lands where T1, T2 and T0 are all non-zero', () => {
    const lesson = t.lessons.find((l) => l.id === 'sv')!
    const step = lesson.steps.find((s) => /Dwell times/.test(s.title))!
    const k = converterIndexAt(r as never, step.at(r as never))
    const s = sv(k)
    expect(s.sector).toBe(0)
    for (const x of [s.t1, s.t2, s.t0]) expect(x).toBeGreaterThan(0.05 * p.tc)
    expect(svDwellText(s)).not.toMatch(/= 0:/)
    expect(svMidSectorTime(p)).toBeGreaterThan(0)
  })

  it('every sample: T1 + T2 + T0 = Ts, and T1, T2 follow the sampled angle (volt-second balance)', () => {
    for (let k = 0; k < r.length; k += 7) {
      const s = sv(k)
      expect(s.t1 + s.t2 + s.t0).toBeCloseTo(p.tc, 15)
      const a = (Math.sqrt(3) * p.tc * ((p.m * p.vdc) / 2)) / p.vdc
      expect(s.t1).toBeCloseTo(a * Math.sin(Math.PI / 3 - s.thetaK), 15)
      expect(s.t2).toBeCloseTo(a * Math.sin(s.thetaK), 15)
      // the sampled angle is the reference angle at the start of the switching period the sample belongs to
      // (sample k holds the interval ending at t[k]: its middle decides the period)
      const tm = k === 0 ? 1e-12 : r.time[k] - (r.params as unknown as { dt: number }).dt / 2
      const ts = Math.floor(tm / p.tc + 1e-12) * p.tc
      const th = ((p.omega * ts) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
      expect(s.sector * (Math.PI / 3) + s.thetaK).toBeCloseTo(th, 9)
    }
  })

  it('the boundary: in the first switching period the sample is at 0°, T2 is exactly 0, and the text explains it', () => {
    const k = converterIndexAt(r as never, 0.5 * p.tc)
    const s = sv(k)
    expect(s.sector).toBe(0)
    expect(s.thetaK).toBe(0)
    expect(s.t2).toBe(0)
    expect(s.t1).toBeGreaterThan(0)
    expect(svDwellText(s)).toMatch(/T2 = 0: the sampled reference lies exactly on V1/)
  })
})
