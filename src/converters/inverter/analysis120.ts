import type { CompareResult, CompareRow, TextbookValue } from '../../lab/types.ts'
import { runSegments } from '../engine.ts'
import { fourier, rmsOf, thdFrom, type Harmonic, type Segment } from '../fourier.ts'
import type { Run } from '../types.ts'
import { measureInverter, type InverterMeasurements } from './analysis.ts'
import { fractions120, theory120, type Resolved120 } from './conduction120.ts'
import { legDevices } from './model.ts'

export type Run120 = Run<Resolved120>

/**
 * 120° CONDUCTION — measurements and theory.
 *  SIMULATION: the inverter lab's measurements of the simulated run (line voltage vab, phase current ia, power,
 *  device conduction from the exact switching events) plus the phase voltage van (to the load neutral) and the
 *  time each leg spends with no conducting device (floating).
 *  THEORY: `theory120` — the exact piecewise solution of the same circuit with ideal switches, solved interval
 *  by interval with exponentials (independent of the netlist engine). For an R load it is the textbook staircase.
 */
export interface Meas120 extends InverterMeasurements {
  /** Phase voltage van: fundamental (peak), RMS, THD, harmonics. */
  vph1: number
  vphRms: number
  thdPh: number
  phHarm: Harmonic[]
  /** Line-voltage harmonics 5, 7, 11 (peak). */
  v5: number
  v7: number
  v11: number
  /** Fraction of the cycle (Σ over the three legs) with no conducting device: the leg floats. */
  floatFraction: number
  /** Fraction of the cycle, per leg, with no conducting device. */
  floatPerLeg: number[]
  /** Conduction of one IGBT (S1), fraction of the cycle. */
  s1Frac: number
  /** Most devices conducting at the same time (over the cycle, from the simulated device states). */
  maxConducting: number
}

export function measure120(r: Run120): Meas120 {
  const base = measureInverter(r as never)
  const p = r.params
  const k0 = r.steadyFrom
  const k1 = Math.min(r.length - 1, k0 + p.stepsPerPeriod)
  const T = r.time[k1] - r.time[k0]
  const segs = runSegments(r, 'van', k0, k1)
  const phHarm = fourier(segs, T, 61)
  const vphRms = rmsOf(segs, T)
  const floatPerLeg = legDevices(p).map((devs) => Math.max(0, 1 - devs.reduce((s, id) => s + (base.devices[id]?.frac ?? 0), 0)))
  let maxConducting = 0
  for (let k = k0 + 1; k <= k1; k++) maxConducting = Math.max(maxConducting, r.devices.reduce((s, d) => s + d.on[k], 0))
  return {
    ...base,
    vph1: phHarm[1].amp,
    vphRms,
    thdPh: thdFrom(vphRms, phHarm[0].amp, phHarm[1].amp),
    phHarm,
    v5: base.vHarm[5]?.amp ?? 0,
    v7: base.vHarm[7]?.amp ?? 0,
    v11: base.vHarm[11]?.amp ?? 0,
    floatFraction: floatPerLeg.reduce((a, b) => a + b, 0),
    floatPerLeg,
    s1Frac: base.devices.S1?.frac ?? 0,
    maxConducting,
  }
}

/** Textbook values (ideal switches): 120° with an R load — or 180° (six-step). */
export function textbook120(p: Resolved120): Record<string, TextbookValue> {
  const V = p.vdc
  const ideal = ['ideal switches']
  if (p.conduction === 180) {
    const a = [...ideal, '180° conduction (six-step), any load']
    return {
      vph1: { key: 'vph1', value: (2 * V) / Math.PI, formula: 'Vph1 = 2·Vdc/π (peak) — 0.450·Vdc RMS', assumptions: a },
      vphRms: { key: 'vphRms', value: (Math.SQRT2 / 3) * V, formula: 'Vph,rms = √2·Vdc/3 = 0.471·Vdc', assumptions: a },
      v1: { key: 'v1', value: (2 * Math.sqrt(3) * V) / Math.PI, formula: 'VLL1 = 2√3·Vdc/π (peak) — 0.780·Vdc RMS', assumptions: a },
      vrms: { key: 'vrms', value: Math.sqrt(2 / 3) * V, formula: 'VLL,rms = √(2/3)·Vdc = 0.816·Vdc', assumptions: a },
      thdPh: { key: 'thdPh', value: Math.sqrt(Math.PI ** 2 / 9 - 1), formula: 'THD = √(π²/9 − 1) = 31.1 %', assumptions: a },
    }
  }
  const a = [...ideal, '120° conduction', 'R load (the open leg carries no current)']
  const na = p.load === 'RL' ? 'R-L load: after each commutation a freewheeling diode clamps the "floating" leg to a rail until its current dies, so the staircase does not hold.' : undefined
  return {
    vph1: { key: 'vph1', value: (Math.sqrt(3) * V) / Math.PI, formula: 'Vph1 = √3·Vdc/π (peak) = (√6/π)·(Vdc/2) RMS = 0.390·Vdc RMS', assumptions: a, notApplicable: na },
    vphRms: { key: 'vphRms', value: V / Math.sqrt(6), formula: 'Vph,rms = Vdc/√6 = 0.408·Vdc  (±Vdc/2 for 2 × 120°)', assumptions: a, notApplicable: na },
    v1: { key: 'v1', value: (3 * V) / Math.PI, formula: 'VLL1 = 3·Vdc/π (peak) — 0.675·Vdc RMS', assumptions: a, notApplicable: na },
    vrms: { key: 'vrms', value: V / Math.SQRT2, formula: 'VLL,rms = Vdc/√2 = 0.707·Vdc  (steps Vdc/2 and Vdc)', assumptions: a, notApplicable: na },
    thdPh: { key: 'thdPh', value: Math.sqrt(Math.PI ** 2 / 9 - 1), formula: 'THD = √(π²/9 − 1) = 31.1 %  (harmonics 6k ± 1 only)', assumptions: a, notApplicable: na },
  }
}

/** Closed-form amplitude of line-voltage harmonic h (ideal; 120° needs an R load), for the spectrum markers. */
export function lineTheoryAmp(p: Resolved120, h: number): number | null {
  if (h === 0) return 0
  if (p.conduction === 120 && p.load === 'RL') return null
  if (h % 2 === 0 || h % 3 === 0) return 0
  // 120° (R): phase = quasi-square ±Vdc/2, 120° wide → (2Vdc/(hπ))·cos(hπ/6); line = √3 × phase for h = 6k ± 1
  return p.conduction === 120 ? Math.sqrt(3) * Math.abs(((2 * p.vdc) / (h * Math.PI)) * Math.cos((h * Math.PI) / 6)) : (2 * Math.sqrt(3) * p.vdc) / (Math.PI * h)
}

/** The exact theory's waveforms as segments (piecewise constant voltages). */
export function theorySegments(p: Resolved120) {
  const th = theory120(p)
  const van: Segment[] = th.segs.map((s) => ({ ta: s.ta, tb: s.tb, va: s.vph[0], vb: s.vph[0] }))
  const vab: Segment[] = th.segs.map((s) => ({ ta: s.ta, tb: s.tb, va: s.vx[0] - s.vx[1], vb: s.vx[0] - s.vx[1] }))
  return { th, van, vab }
}

export function compare120(r: Run120, m: Meas120): CompareResult {
  const p = r.params
  const { th, van, vab } = theorySegments(p)
  const T = p.period
  const lH = fourier(vab, T, 13)
  const pH = fourier(van, T, 5)
  const lRms = rmsOf(vab, T)
  const pRms = rmsOf(van, T)
  const z1 = Math.hypot(p.r, p.load === 'RL' ? p.omega * p.l : 0)
  const fr = fractions120(p, th)
  const tb = textbook120(p)
  const ideal = p.devices === 'ideal'
  const expected = ideal ? undefined : 'ideal-switch theory: device drops lower the voltage'
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number, exact: number, tol: number, scale: number, textbook: TextbookValue | null = null, absolute = false) => {
    const error = absolute ? Math.abs(sim - exact) : Math.abs(sim - exact) / Math.max(scale, 1e-12)
    const tbErr = textbook && textbook.value !== null && !textbook.notApplicable ? (Math.abs(textbook.value) > 1e-12 ? (sim - textbook.value) / Math.abs(textbook.value) : sim - textbook.value) : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol || !!expected, absolute, textbook, textbookError: tbErr, expected })
  }
  add('vph1', 'Phase voltage van — fundamental (peak)', 'V', m.vph1, pH[1].amp, 0.002, pH[1].amp, tb.vph1)
  add('vphRms', 'Phase voltage van — RMS', 'V', m.vphRms, pRms, 0.002, pRms, tb.vphRms)
  add('thdPh', 'Phase voltage THD', '%', m.thdPh, thdFrom(pRms, pH[0].amp, pH[1].amp), 0.002, 1, tb.thdPh, true)
  add('v1', 'Line voltage vab — fundamental VLL1 (peak)', 'V', m.v1, lH[1].amp, 0.002, lH[1].amp, tb.v1)
  add('vrms', 'Line voltage vab — RMS', 'V', m.vrms, lRms, 0.002, lRms, tb.vrms)
  for (const h of [5, 7, 11]) {
    const cf = lineTheoryAmp(p, h)
    add(`v${h}`, `Line voltage harmonic h = ${h}`, 'V', m.vHarm[h]?.amp ?? 0, lH[h].amp, 0.002, Math.max(lH[1].amp, 1e-9), cf === null ? null : { key: `v${h}`, value: cf, formula: p.conduction === 120 ? '√3·(2Vdc/(hπ))·|cos(hπ/6)|, h = 6k ± 1' : '(2√3·Vdc/π)/h, h = 6k ± 1', assumptions: ['ideal switches', ...(p.conduction === 120 ? ['R load'] : [])] })
  }
  add('irms', 'Phase current RMS', 'A', m.irms, th.irms, 0.003, th.irms)
  add('i1', 'Phase current fundamental (peak)', 'A', m.i1, pH[1].amp / z1, 0.003, pH[1].amp / z1, { key: 'i1', value: pH[1].amp / z1, formula: 'I1 = Vph1/|R + jωL|', assumptions: ['the phase current is driven by van'] })
  add('ipeak', 'Peak phase current', 'A', m.ipeak, th.ipeak, 0.003, th.ipeak)
  add('pLoad', 'Load power (3 phases)', 'W', m.pLoad, 3 * th.irms * th.irms * p.r, 0.005, 3 * th.irms * th.irms * p.r)
  add('diodeFraction', 'Diode conduction (Σ legs, fraction of cycle)', '%', m.diodeFraction, fr.diode, 0.01, 1, null, true)
  add('floatFraction', 'Leg open — no device conducts (Σ legs)', '%', m.floatFraction, fr.open, 0.01, 1, { key: 'floatFraction', value: p.conduction === 120 ? 1 : 0, formula: p.conduction === 120 ? 'R load: each leg open 2 × 60° per cycle (Σ = 100 %)' : '180°: every leg always tied to a rail', assumptions: ['ideal switches', ...(p.conduction === 120 ? ['R load'] : [])], notApplicable: p.conduction === 120 && p.load === 'RL' ? 'R-L load: the diodes shorten the open intervals.' : undefined }, true)
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `One cycle (f1 = ${p.f1} Hz), ${p.conduction}° conduction, ${p.load === 'RL' ? 'R-L' : 'R'} load. THEORY: the same circuit with ideal switches, solved interval by interval (exponentials, exact diode turn-off instants, periodic fixed point after ${th.cycles} cycle${th.cycles === 1 ? '' : 's'}).${ideal ? '' : ' The simulation includes device drops the ideal theory leaves out.'}`,
    note: p.conduction === 120 && p.load === 'RL' ? 'Textbook values assume an R load; with R-L the freewheeling diodes change the waveform (see Why).' : undefined,
  }
}
