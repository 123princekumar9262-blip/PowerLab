import { describe, expect, it } from 'vitest'
import { diodeRecovery, driftDepletion, EPS_SI, linearOnState, mosfetOn, Q_E, scrStaysOn, scrTwoTransistor } from '../src/machines/calculations/semiconductors.ts'
import { MODEL_LOADERS } from '../src/machines/models/index.ts'
import { diodeCalc, DIODE_PARAMS, DIODE_STEP_MODE, DIODE_STEPS } from '../src/machines/models/semiconductors/diode/content.ts'
import { igbtCalc, IGBT_PARAMS, IGBT_STEP_MODE, IGBT_STEPS } from '../src/machines/models/semiconductors/igbt/content.ts'
import { mosfetCalc, MOSFET_PARAMS, MOSFET_STEP_MODE, MOSFET_STEPS } from '../src/machines/models/semiconductors/mosfet/content.ts'
import { scrCalc, SCR_PARAMS, SCR_STEP_MODE, SCR_STEPS } from '../src/machines/models/semiconductors/scr/content.ts'
import { MACHINES } from '../src/machines/catalog.ts'
import type { CalcResult, MachineParam } from '../src/machines/types.ts'

const defaults = (ps: MachineParam[]) => Object.fromEntries(ps.map((p) => [p.id, p.value]))
const val = (rows: CalcResult[], id: string) => rows.find((r) => r.id === id)!.value

describe('semiconductors: drift depletion (one-sided abrupt junction)', () => {
  it('silicon constants', () => {
    expect(EPS_SI).toBeCloseTo(1.0359e-12, 15) // F/cm
    expect(Q_E).toBe(1.602176634e-19)
  })
  it('W = √(2εV/(qND)) and Emax = 2V/W = qND·W/ε (non-punch-through)', () => {
    const d = driftDepletion({ v: 600, nd: 1e14, wdUm: 200 })!
    const w = Math.sqrt((2 * EPS_SI * 600) / (Q_E * 1e14)) // cm
    expect(d.punchThrough).toBe(false)
    expect(d.wUm).toBeCloseTo(w * 1e4, 9)
    expect(d.wUm).toBeCloseTo(88.0, 0) // textbook order: ~88 µm for 600 V at 1e14 cm⁻³
    expect(d.emax).toBeCloseTo((2 * 600) / w, 6)
    expect(d.emax).toBeCloseTo((Q_E * 1e14 * w) / EPS_SI, 3) // Gauss: the same peak field
    expect(d.emin).toBe(0)
    expect(d.fraction).toBeCloseTo(d.wUm / 200, 12)
  })
  it('W ∝ √V and ∝ 1/√ND', () => {
    const a = driftDepletion({ v: 100, nd: 1e14, wdUm: 1000 })!
    const b = driftDepletion({ v: 400, nd: 1e14, wdUm: 1000 })!
    const c = driftDepletion({ v: 100, nd: 4e14, wdUm: 1000 })!
    expect(b.wUm / a.wUm).toBeCloseTo(2, 12)
    expect(a.wUm / c.wUm).toBeCloseTo(2, 12)
  })
  it('punch-through: trapezoidal field, and the voltage is its area', () => {
    const d = driftDepletion({ v: 600, nd: 1e14, wdUm: 50 })!
    expect(d.punchThrough).toBe(true)
    expect(d.wUm).toBe(50)
    expect(d.fraction).toBe(1)
    const wd = 50e-4
    expect(d.emax - d.emin).toBeCloseTo((Q_E * 1e14 * wd) / EPS_SI, 6) // slope × thickness
    expect(((d.emax + d.emin) / 2) * wd).toBeCloseTo(600, 9) // ∫E dx = V
    expect(d.emin).toBeGreaterThan(0)
  })
  it('continuity at the punch-through boundary', () => {
    const wFree = driftDepletion({ v: 300, nd: 2e14, wdUm: 1e4 })!.wUm
    const just = driftDepletion({ v: 300, nd: 2e14, wdUm: wFree * (1 - 1e-9) })!
    const free = driftDepletion({ v: 300, nd: 2e14, wdUm: wFree * (1 + 1e-9) })!
    expect(just.punchThrough).toBe(true)
    expect(free.punchThrough).toBe(false)
    expect(just.emax).toBeCloseTo(free.emax, 0)
    expect(just.emin).toBeCloseTo(0, 0)
  })
  it('edge cases: V = 0 gives W = 0, E = 0; invalid inputs give null', () => {
    const z = driftDepletion({ v: 0, nd: 1e14, wdUm: 100 })!
    expect(z.wUm).toBe(0)
    expect(z.emax).toBe(0)
    expect(driftDepletion({ v: -1, nd: 1e14, wdUm: 100 })).toBeNull()
    expect(driftDepletion({ v: 100, nd: 0, wdUm: 100 })).toBeNull()
    expect(driftDepletion({ v: 100, nd: 1e14, wdUm: 0 })).toBeNull()
  })
})

describe('semiconductors: on-state relations', () => {
  it('piecewise-linear device: v = V0 + r·i, P = V0·i + r·i² = v·i', () => {
    const d = linearOnState({ v0: 0.9, r: 0.012, i: 30 })!
    expect(d.v).toBeCloseTo(1.26, 12)
    expect(d.p).toBeCloseTo(37.8, 10)
    expect(d.pKnee + d.pRes).toBeCloseTo(d.p, 12)
    expect(d.pKnee).toBeCloseTo(27, 12)
    expect(linearOnState({ v0: 0.9, r: 0.012, i: 0 })!.p).toBe(0)
    expect(linearOnState({ v0: 0.9, r: 0.012, i: -1 })).toBeNull()
  })
  it('MOSFET: channel only above Vth; vDS = iD·RDS(on), P = iD²·RDS(on) = vDS·iD', () => {
    const m = mosfetOn({ id: 20, rdson: 0.08, vgs: 12, vth: 4 })!
    expect(m.vds).toBeCloseTo(1.6, 12)
    expect(m.p).toBeCloseTo(32, 12)
    expect(m.p).toBeCloseTo(m.vds * 20, 12)
    expect(m.overdrive).toBe(8)
    expect(mosfetOn({ id: 20, rdson: 0.08, vgs: 4, vth: 4 })).toBeNull() // VGS = Vth: no channel
    expect(mosfetOn({ id: 20, rdson: 0.08, vgs: 3, vth: 4 })).toBeNull()
    // doubling the current quadruples the loss
    expect(mosfetOn({ id: 40, rdson: 0.08, vgs: 12, vth: 4 })!.p / m.p).toBeCloseTo(4, 12)
  })
  it('diode reverse recovery: Qrr = ½·Irr·trr and Irr = di/dt·trr', () => {
    const r = diodeRecovery({ qrr: 1e-6, didt: 200e6 })!
    expect(r.irr).toBeCloseTo(20, 9)
    expect(r.trr).toBeCloseTo(100e-9, 15)
    expect(0.5 * r.irr * r.trr).toBeCloseTo(1e-6, 15)
    expect(r.irr / r.trr).toBeCloseTo(200e6, 0)
    // faster di/dt: larger Irr, shorter trr (√ scaling)
    const f = diodeRecovery({ qrr: 1e-6, didt: 800e6 })!
    expect(f.irr / r.irr).toBeCloseTo(2, 12)
    expect(r.trr / f.trr).toBeCloseTo(2, 12)
    expect(diodeRecovery({ qrr: 0, didt: 1e8 })).toBeNull()
  })
  it('SCR two-transistor model: IA = (α2·IG + ICBO)/(1 − α1 − α2); latches at α1 + α2 ≥ 1', () => {
    const t = scrTwoTransistor({ a1: 0.4, a2: 0.45, ig: 0.02, ico: 10e-6 })!
    expect(t.latched).toBe(false)
    expect(t.loop).toBeCloseTo(0.85, 12)
    expect(t.ia!).toBeCloseTo((0.45 * 0.02 + 10e-6) / 0.15, 12)
    // the anode current grows without bound as the loop gain approaches 1
    const near = scrTwoTransistor({ a1: 0.5, a2: 0.49, ig: 0.02, ico: 10e-6 })!
    expect(near.ia!).toBeGreaterThan(t.ia! * 9)
    const l = scrTwoTransistor({ a1: 0.5, a2: 0.5, ig: 0.02, ico: 10e-6 })!
    expect(l.latched).toBe(true)
    expect(l.ia).toBeNull()
    // with no gate current and small gains it carries only the leakage, amplified
    expect(scrTwoTransistor({ a1: 0, a2: 0, ig: 0, ico: 1e-6 })!.ia).toBeCloseTo(1e-6, 15)
    expect(scrTwoTransistor({ a1: 1, a2: 0, ig: 0, ico: 0 })).toBeNull()
  })
  it('SCR holding condition', () => {
    expect(scrStaysOn(0.06, 0.05)).toBe(true)
    expect(scrStaysOn(0.05, 0.05)).toBe(true)
    expect(scrStaysOn(0.04, 0.05)).toBe(false)
  })
})

describe('semiconductors: calculation panels', () => {
  it('MOSFET defaults: on-state from RDS(on); off state; no channel ⇒ null, never invented', () => {
    const p = defaults(MOSFET_PARAMS)
    const r = mosfetCalc(p)
    expect(val(r, 'vds')).toBeCloseTo(20 * 0.08, 12)
    expect(val(r, 'pcond')).toBeCloseTo(20 * 20 * 0.08, 12)
    expect(val(r, 'vop')).toBeCloseTo(1.6, 12)
    expect(val(r, 'pop')).toBeCloseTo(32, 12)
    expect(val(r, 'vsd')).toBeCloseTo(0.8 + 0.015 * 20, 12)
    const off = mosfetCalc({ ...p, state: 0 })
    expect(val(off, 'vop')).toBe(400)
    expect(val(off, 'pop')).toBe(0)
    const noCh = mosfetCalc({ ...p, vgs: 3 })
    expect(val(noCh, 'vds')).toBeNull()
    expect(val(noCh, 'vop')).toBeNull()
    expect(val(mosfetCalc({ ...p, state: 1 }), 'vop')).toBeNull() // transient: not a steady relation
    const bd = mosfetCalc({ ...p, state: 4 })
    expect(val(bd, 'vop')).toBeCloseTo(-(0.8 + 0.3), 12)
    expect(val(bd, 'pop')).toBeCloseTo(1.1 * 20, 12)
    // depletion row matches the formula module
    const d = driftDepletion({ v: 400, nd: 2e14, wdUm: 60 })!
    expect(val(r, 'w')).toBeCloseTo(d.wUm, 12)
    expect(val(r, 'emax')).toBeCloseTo(d.emax / 1000, 12)
  })
  it('IGBT: vCE ≈ VCE0 + r·iC and the knee share of the loss', () => {
    const p = defaults(IGBT_PARAMS)
    const r = igbtCalc(p)
    expect(val(r, 'vce')).toBeCloseTo(0.9 + 0.02 * 40, 12)
    expect(val(r, 'pcond')).toBeCloseTo(0.9 * 40 + 0.02 * 1600, 12)
    expect(val(r, 'pknee')).toBeCloseTo(36, 12)
    expect(val(igbtCalc({ ...p, vge: 5 }), 'vce')).toBeNull()
    expect(val(igbtCalc({ ...p, state: 3 }), 'pop')).toBeNull()
    expect(val(igbtCalc({ ...p, state: 0 }), 'vop')).toBe(600)
  })
  it('diode: vF, loss, recovery and reverse blocking', () => {
    const p = defaults(DIODE_PARAMS)
    const r = diodeCalc(p)
    expect(val(r, 'vf')).toBeCloseTo(0.9 + 0.012 * 30, 12)
    expect(val(r, 'pcond')).toBeCloseTo(0.9 * 30 + 0.012 * 900, 12)
    expect(val(r, 'irr')).toBeCloseTo(20, 9)
    expect(val(r, 'trr')).toBeCloseTo(100, 6) // ns
    expect(val(diodeCalc({ ...p, state: 0 }), 'vop')).toBe(-600)
  })
  it('SCR: on-state, holding margin, two-transistor current, both blocking directions', () => {
    const p = defaults(SCR_PARAMS)
    const r = scrCalc(p)
    expect(val(r, 'vt')).toBeCloseTo(1.0 + 0.008 * 30, 12)
    expect(val(r, 'margin')).toBeCloseTo(30 - 0.05, 12)
    expect(val(r, 'loop')).toBeCloseTo(0.85, 12)
    expect(val(r, 'ia')).toBeCloseTo(((0.45 * 0.02 + 10e-6) / 0.15) * 1000, 9) // mA
    expect(val(scrCalc({ ...p, a1: 0.55, a2: 0.5 }), 'ia')).toBeNull()
    expect(val(scrCalc({ ...p, state: 0 }), 'vop')).toBe(800)
    expect(val(scrCalc({ ...p, state: 4 }), 'vop')).toBe(-800)
    // latched state with the current below IH: no on-state value — it would turn off
    const low = scrCalc({ ...p, it: 0 })
    expect(val(low, 'vop')).toBeNull()
    expect(val(low, 'margin')).toBeLessThan(0)
  })
  it('every state option and every guided step maps to a drawing mode', () => {
    for (const [steps, map] of [
      [MOSFET_STEPS, MOSFET_STEP_MODE],
      [IGBT_STEPS, IGBT_STEP_MODE],
      [DIODE_STEPS, DIODE_STEP_MODE],
      [SCR_STEPS, SCR_STEP_MODE],
    ] as const) {
      for (const s of steps) expect(map[s.id], s.id).toBeDefined()
      expect(steps.length).toBeGreaterThanOrEqual(5)
      expect(steps.length).toBeLessThanOrEqual(8)
    }
  })
})

describe('semiconductors: catalogue and models', () => {
  it.each(['power-diode', 'mosfet', 'igbt', 'scr'])('%s is ready, linked to its simulation, with a loader and 6–14 parts', async (id) => {
    const e = MACHINES.find((m) => m.id === id)!
    expect(e.status).toBe('ready')
    expect(e.simulatedIn?.lab).toBe('devices')
    expect(e.traits?.construction).toBeTruthy()
    const def = (await MODEL_LOADERS[id]()).default
    expect(def.parts.length).toBeGreaterThanOrEqual(6)
    expect(def.parts.length).toBeLessThanOrEqual(14)
    expect(def.quiz.length).toBeGreaterThanOrEqual(5)
    expect(def.quiz.some((q) => q.kind === 'identify') && def.quiz.some((q) => q.kind === 'order') && def.quiz.some((q) => q.kind === 'match')).toBe(true)
    expect(def.motion).toBeUndefined() // static devices: nothing rotates
    expect(def.steps.every((s) => !s.equation || s.equation.length > 3)).toBe(true)
    for (const l of def.layers) expect(l.conceptual).toBe(true)
  })
})
