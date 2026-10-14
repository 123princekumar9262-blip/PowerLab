import { beforeEach, describe, expect, it } from 'vitest'
import { getDesignedLine, LINE_KEY, setDesignedLine, type DesignedLine } from '../src/powersys/lineDesign.ts'
import { LINE_PRESETS, lineAbcd, lineParams, linePerformance, sil } from '../src/powersys/modules/three-phase/calc.ts'

/*
 * The hand-off from Module 8 (line constants calculated from conductor geometry) to Module 2 (line performance).
 * Module 2's preset stays its default; the designed constants are used only when the student opts in.
 */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  setDesignedLine(null)
})

const design: DesignedLine = { rOhmPerKm: 0.03, xOhmPerKm: 0.32, bUsPerKm: 3.6, kv: 400, fHz: 50, summary: 'horizontal, twin bundle', at: 1 }

describe('Module 8 → Module 2 line-constants hand-off', () => {
  it('stores a valid design and gives it back', () => {
    expect(setDesignedLine(design)).toBe(true)
    expect(getDesignedLine()).toEqual(design)
    expect(JSON.parse(store.get(LINE_KEY)!)).toEqual(design)
  })
  it('refuses invalid constants and keeps what was there', () => {
    setDesignedLine(design)
    for (const bad of [
      { ...design, xOhmPerKm: 0 },
      { ...design, bUsPerKm: -1 },
      { ...design, rOhmPerKm: Number.NaN },
      { ...design, kv: 0 },
    ])
      expect(setDesignedLine(bad)).toBe(false)
    expect(getDesignedLine()).toEqual(design)
  })
  it('withdrawing the design removes it', () => {
    setDesignedLine(design)
    setDesignedLine(null)
    expect(getDesignedLine()).toBeNull()
    expect(store.has(LINE_KEY)).toBe(false)
  })
  it('Module 2 computes with the designed constants exactly as with the same constants typed in, and its 400 kV preset is unchanged', () => {
    const k = { rOhmPerKm: design.rOhmPerKm, xOhmPerKm: design.xOhmPerKm, bUsPerKm: design.bUsPerKm }
    const load = { pMw: 400, pf: 0.95, lagging: true }
    const a = linePerformance(lineAbcd(k, 300, 'long'), design.kv, load)
    const b = linePerformance(lineAbcd({ ...k }, 300, 'long'), 400, load)
    expect(a.vsLL).toBe(b.vsLL)
    expect(sil(design.kv, lineParams(k, 300).zcLossless)).toBeCloseTo((400 * 400) / Math.sqrt(0.32 / 3.6e-6), 9)
    // the preset Module 2 opens with is still its validated default
    expect(LINE_PRESETS.find((p) => p.id === '400')).toMatchObject({ kv: 400, rOhmPerKm: 0.03, xOhmPerKm: 0.33, bUsPerKm: 3.5 })
  })
})
