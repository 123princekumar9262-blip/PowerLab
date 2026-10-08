import type { CompareResult, CompareRow, TextbookValue } from '../../lab/types.ts'
import { runSegments, segmentAverage } from '../engine.ts'
import { fourier, rmsOf, thdFrom, type Harmonic, type Segment } from '../fourier.ts'
import { pwmTheoryPhasor } from '../pwm/analysis.ts'
import type { Run } from '../types.ts'
import { commandAt, legCommands, type ResolvedInverter } from './modulation.ts'
import { legDevices } from './model.ts'

export type InverterRun = Run<ResolvedInverter>

/**
 * INVERTER ANALYSIS.
 *  SIMULATION: from the simulated waveforms (device drops, dead time and diode decisions included).
 *  THEORY, two independent parts:
 *   1. The IDEAL output voltage the gate commands define (ideal switches, no dead time) — exact
 *      piecewise-constant waveform, its closed-form harmonics (square, quasi-square, six-step) and the
 *      Bessel double-Fourier series of sine-triangle PWM.
 *   2. The exact load current for that voltage: L·di/dt + R·i = v(t), solved per segment with
 *      exponentials, periodic fixed point i(T) = i(0); current harmonics I_h = V_h/|R + j·h·ω·L|; diode
 *      vs IGBT conduction from the sign of the leg current while its switch is commanded ON.
 */

/** The voltage that drives each load branch: the full-bridge/half-bridge output, or phase a/b/c to the load neutral. */
export function loadVoltageNames(p: ResolvedInverter): string[] {
  return p.topology === 'three' ? ['van', 'vanb', 'vanc'] : ['vo']
}

export interface IdealSeg {
  ta: number
  tb: number
  /** Leg commands in this segment. */
  g: boolean[]
  /** Voltage across each load branch. */
  v: number[]
  /** Output voltage shown (vo or vab). */
  vo: number
}

export function idealSegments(p: ResolvedInverter): IdealSeg[] {
  const cmds = legCommands(p)
  const T = p.period
  const times = [0, T, ...cmds.flat().map((e) => e.t)].filter((t) => t >= 0 && t <= T).sort((a, b) => a - b)
  const uniq: number[] = []
  for (const t of times) if (!uniq.length || t - uniq[uniq.length - 1] > T * 1e-13) uniq.push(t)
  const segs: IdealSeg[] = []
  for (let i = 0; i + 1 < uniq.length; i++) {
    const ta = uniq[i]
    const tb = uniq[i + 1]
    const g = cmds.map((c) => commandAt(c, T, (ta + tb) / 2))
    let v: number[]
    let vo: number
    if (p.topology === 'half') {
      vo = g[0] ? p.vdc / 2 : -p.vdc / 2
      v = [vo]
    } else if (p.topology === 'full') {
      vo = p.vdc * ((g[0] ? 1 : 0) - (g[1] ? 1 : 0))
      v = [vo]
    } else {
      const vx = g.map((x) => (x ? p.vdc : 0))
      const vn = (vx[0] + vx[1] + vx[2]) / 3
      v = vx.map((x) => x - vn)
      vo = vx[0] - vx[1]
    }
    segs.push({ ta, tb, g, v, vo })
  }
  return segs
}

export interface CurrentTheory {
  /** Branch current at the start of each segment, per branch. */
  i0: number[][]
  rms: number[]
  peak: number
  /** Value of branch b at time t (periodic). */
  at(b: number, t: number): number
}

/** Exact periodic load current for the ideal voltage (R or series R-L per branch). */
export function currentTheory(p: ResolvedInverter, segs: IdealSeg[]): CurrentTheory {
  const nB = segs[0].v.length
  const tau = p.load === 'RL' ? p.l / p.r : 0
  const i0: number[][] = segs.map(() => new Array<number>(nB).fill(0))
  const rms: number[] = []
  let peak = 0
  for (let b = 0; b < nB; b++) {
    if (tau === 0) {
      let s2 = 0
      segs.forEach((s, j) => {
        i0[j][b] = s.v[b] / p.r
        s2 += (s.v[b] / p.r) ** 2 * (s.tb - s.ta)
        peak = Math.max(peak, Math.abs(s.v[b] / p.r))
      })
      rms.push(Math.sqrt(s2 / p.period))
      continue
    }
    // i(T) = a·i(0) + c  ⇒  i(0) = c/(1 − a)
    const run = (start: number) => {
      let i = start
      for (const s of segs) i = s.v[b] / p.r + (i - s.v[b] / p.r) * Math.exp(-(s.tb - s.ta) / tau)
      return i
    }
    const c = run(0)
    const a = Math.exp(-p.period / tau)
    let i = c / (1 - a)
    let s2 = 0
    segs.forEach((s, j) => {
      i0[j][b] = i
      const A = s.v[b] / p.r
      const B = i - A
      const D = s.tb - s.ta
      const e1 = Math.exp(-D / tau)
      // ∫₀ᴰ (A + B·e^(−s/τ))² ds
      s2 += A * A * D + 2 * A * B * tau * (1 - e1) + ((B * B * tau) / 2) * (1 - e1 * e1)
      peak = Math.max(peak, Math.abs(i))
      i = A + B * e1
    })
    rms.push(Math.sqrt(s2 / p.period))
  }
  const at = (b: number, t: number) => {
    const u = t - p.period * Math.floor(t / p.period)
    const j = segs.findIndex((s) => u >= s.ta && u < s.tb)
    const s = segs[j < 0 ? segs.length - 1 : j]
    const A = s.v[b] / p.r
    return tau === 0 ? A : A + (i0[j < 0 ? segs.length - 1 : j][b] - A) * Math.exp(-(u - s.ta) / tau)
  }
  return { i0, rms, peak, at }
}

/** Fraction of the period (summed over legs) a freewheeling diode conducts in the ideal theory: the leg
 *  is commanded to one rail but its current flows the other way, so the diode beside the switch carries
 *  it. Inside a segment the current is one exponential A + B·e^(−s/τ): its zero crossing is exact. */
export function diodeFractionsTheory(p: ResolvedInverter, segs: IdealSeg[], cur: CurrentTheory): number {
  const tau = p.load === 'RL' ? p.l / p.r : 0
  const nLegs = segs[0].g.length
  let tot = 0
  segs.forEach((s, j) => {
    const D = s.tb - s.ta
    for (let leg = 0; leg < nLegs; leg++) {
      const b = p.topology === 'three' ? leg : 0
      const sign = p.topology === 'full' && leg === 1 ? -1 : 1
      const A = (sign * s.v[b]) / p.r
      const i0 = sign * cur.i0[j][b]
      const Bc = i0 - A
      // diode conducts while the leg current opposes the commanded switch
      const bad = (x: number) => (s.g[leg] ? x < 0 : x > 0)
      if (tau === 0) {
        if (bad(A)) tot += D
        continue
      }
      const iEnd = A + Bc * Math.exp(-D / tau)
      // crossing time (if any): A + B·e^(−s/τ) = 0
      let sz = -1
      if (Bc !== 0 && -A / Bc > 0) sz = -tau * Math.log(-A / Bc)
      if (sz > 0 && sz < D) tot += bad(i0) ? sz : D - sz
      else if (bad(0.5 * (i0 + iEnd))) tot += D
    }
  })
  return tot / p.period
}

export interface InverterMeasurements {
  v1: number
  vrms: number
  thdV: number
  vHarm: Harmonic[]
  i1: number
  irms: number
  ipeak: number
  thdI: number
  iHarm: Harmonic[]
  pLoad: number
  pDc: number
  /** Energy returned to the DC source per cycle (∫ of negative DC power) [J]. */
  eReturned: number
  /** Fraction of the cycle (summed over legs) a freewheeling diode conducts. */
  diodeFraction: number
  /** Per device: conduction fraction and average current. */
  devices: Record<string, { frac: number; iavg: number }>
  efficiency: number
  /** Three-phase: neutral-point voltage RMS. */
  vnNrms: number
  /** Output-voltage 3rd harmonic (peak). */
  v3: number
}

/** The output voltage signal analysed (full/half bridge: vo; three-phase: the line voltage vab). */
export const outputSignal = (p: ResolvedInverter) => (p.topology === 'three' ? 'vab' : 'vo')

export function measureInverter(r: InverterRun): InverterMeasurements {
  const p = r.params
  const k0 = r.steadyFrom
  const k1 = Math.min(r.length - 1, k0 + p.stepsPerPeriod)
  const T = r.time[k1] - r.time[k0]
  const hMax = p.tc ? Math.round(4 * p.mf + 10) : 61
  const vSegs = runSegments(r, outputSignal(p), k0, k1)
  const vHarm = fourier(vSegs, T, hMax)
  const vrms = rmsOf(vSegs, T)
  const iSig = p.topology === 'three' ? 'ia' : 'io'
  const iSegs = runSegments(r, iSig, k0, k1)
  const iHarm = fourier(iSegs, T, hMax)
  const irms = rmsOf(iSegs, T)
  let ipeak = 0
  for (let k = k0; k <= k1; k++) ipeak = Math.max(ipeak, Math.abs(r.signals[iSig][k]))
  const phases = p.topology === 'three' ? ['ia', 'ib', 'ic'] : ['io']
  const pLoad = phases.reduce((s, ph) => s + rmsOf(runSegments(r, ph, k0, k1), T) ** 2 * p.r, 0)
  const pDc = segmentAverage(r, 'pdc', k0)
  const pdcSegs = runSegments(r, 'pdc', k0, k1)
  let eReturned = 0
  for (const s of pdcSegs) {
    // negative part of a linear segment
    const { ta, tb, va, vb } = s
    if (va >= 0 && vb >= 0) continue
    if (va <= 0 && vb <= 0) eReturned += -0.5 * (va + vb) * (tb - ta)
    else {
      const tz = ta + ((tb - ta) * va) / (va - vb)
      eReturned += va < 0 ? -0.5 * va * (tz - ta) : -0.5 * vb * (tb - tz)
    }
  }
  // Device conduction from the exact switching events.
  const devices: InverterMeasurements['devices'] = {}
  const t0 = r.time[k0]
  const t1 = r.time[k1]
  for (const d of r.devices) {
    let on = d.on[Math.min(k0 + 1, r.length - 1)] === 1
    // state just after t0: the first sample interval's state, corrected by events at t0
    const evs = r.events.filter((e) => e.device === d.id && (e.kind.endsWith('-on') || e.kind.endsWith('-off')) && !e.kind.startsWith('gate'))
    const firstAfter = evs.find((e) => e.time > t0 + p.dt * 1e-9)
    if (firstAfter && firstAfter.time < r.time[k0 + 1]) on = !firstAfter.kind.endsWith('-on')
    let t = t0
    let frac = 0
    for (const e of evs) {
      if (e.time <= t0 + p.dt * 1e-9 || e.time >= t1) continue
      const nowOn = e.kind.endsWith('-on')
      if (on) frac += e.time - t
      t = e.time
      on = nowOn
    }
    if (on) frac += t1 - t
    let iavg = 0
    for (let k = k0 + 1; k <= k1; k++) iavg += 0.5 * (d.current[k - 1] + d.current[k]) * p.dt
    devices[d.id] = { frac: frac / T, iavg: iavg / T }
  }
  const diodeFraction = legDevices(p)
    .slice(0, p.topology === 'half' ? 1 : p.topology === 'full' ? 2 : 3)
    .reduce((s, [, du, , dl]) => s + (devices[du]?.frac ?? 0) + (devices[dl]?.frac ?? 0), 0)
  let vnNrms = 0
  if (p.topology === 'three') vnNrms = rmsOf(runSegments(r, 'vnN', k0, k1), T)
  return {
    v1: vHarm[1].amp,
    vrms,
    thdV: thdFrom(vrms, vHarm[0].amp, vHarm[1].amp),
    vHarm,
    i1: iHarm[1].amp,
    irms,
    ipeak,
    thdI: thdFrom(irms, iHarm[0].amp, iHarm[1].amp),
    iHarm,
    pLoad,
    pDc,
    eReturned,
    diodeFraction,
    devices,
    efficiency: pDc > 0 ? pLoad / pDc : NaN,
    vnNrms,
    v3: vHarm[3]?.amp ?? 0,
  }
}

/** Closed-form / Bessel amplitude of output-voltage harmonic h (THEORY, ideal switches). */
export function voltageTheoryAmp(p: ResolvedInverter, h: number): number | null {
  if (h === 0) return 0
  const V = p.vdc
  switch (p.modulation) {
    case 'square':
      if (h % 2 === 0) return 0
      return p.topology === 'half' ? (2 * V) / (h * Math.PI) : (4 * V) / (h * Math.PI)
    case 'quasi': {
      if (h % 2 === 0) return 0
      const a = (p.alphaDeg * Math.PI) / 180
      return Math.abs(((4 * V) / (h * Math.PI)) * Math.cos(h * a))
    }
    case 'six-step':
      // line voltage vab: (2√3·Vdc/π)/h for h = 6k ± 1, zero for even and triplen h
      if (h % 2 === 0 || h % 3 === 0) return 0
      return (2 * Math.sqrt(3) * V) / (Math.PI * h)
    case 'svpwm':
      return null
    default: {
      if (p.m > 1) return null
      // Two-level leg phasors (Holmes & Lipo) with each leg's reference phase.
      const leg = (th0: number) => pwmTheoryPhasor({ m: p.m, mf: p.mf, sampling: p.sampling, vdc: V }, h, th0)
      const th = (shift: number) => -Math.PI / 2 - shift
      let ph: [number, number]
      if (p.topology === 'half') ph = leg(th(0))
      else if (p.topology === 'full') {
        const a = leg(th(0))
        const b = p.modulation === 'spwm-unipolar' ? leg(th(Math.PI)) : ([-a[0], -a[1]] as [number, number])
        ph = [a[0] - b[0], a[1] - b[1]]
      } else {
        const a = leg(th(0))
        const b = leg(th((2 * Math.PI) / 3))
        ph = [a[0] - b[0], a[1] - b[1]]
      }
      return Math.hypot(ph[0], ph[1])
    }
  }
}

/** Textbook relations for the output voltage (ideal switches). */
export function inverterTextbook(p: ResolvedInverter): Record<string, TextbookValue> {
  const V = p.vdc
  const out: Record<string, TextbookValue> = {}
  const ideal = ['ideal switches', 'no dead time']
  const a = (p.alphaDeg * Math.PI) / 180
  switch (p.modulation) {
    case 'square':
      out.v1 = { key: 'v1', value: p.topology === 'half' ? (2 * V) / Math.PI : (4 * V) / Math.PI, formula: p.topology === 'half' ? 'V1 = 2·Vdc/π (peak)' : 'V1 = 4·Vdc/π (peak) — 0.9·Vdc RMS', assumptions: ideal }
      out.vrms = { key: 'vrms', value: p.topology === 'half' ? V / 2 : V, formula: p.topology === 'half' ? 'Vrms = Vdc/2' : 'Vrms = Vdc', assumptions: ideal }
      out.thdV = { key: 'thdV', value: Math.sqrt(Math.PI ** 2 / 8 - 1), formula: 'THD = √(π²/8 − 1) = 48.3 %', assumptions: ideal }
      break
    case 'quasi':
      out.v1 = { key: 'v1', value: ((4 * V) / Math.PI) * Math.cos(a), formula: 'V1 = (4·Vdc/π)·cos α', assumptions: ideal }
      out.vrms = { key: 'vrms', value: V * Math.sqrt(1 - (2 * a) / Math.PI), formula: 'Vrms = Vdc·√(1 − 2α/π)', assumptions: ideal }
      out.h3 = { key: 'h3', value: ((4 * V) / (3 * Math.PI)) * Math.abs(Math.cos(3 * a)), formula: 'V3 = (4·Vdc/(3π))·|cos 3α| (zero at α = 30°)', assumptions: ideal }
      break
    case 'six-step':
      out.v1 = { key: 'v1', value: (2 * Math.sqrt(3) * V) / Math.PI, formula: 'VLL1 = 2√3·Vdc/π (peak) — 0.78·Vdc RMS', assumptions: ideal }
      out.vrms = { key: 'vrms', value: Math.sqrt(2 / 3) * V, formula: 'VLL,rms = √(2/3)·Vdc = 0.816·Vdc', assumptions: ideal }
      out.thdV = { key: 'thdV', value: Math.sqrt(Math.PI ** 2 / 9 - 1), formula: 'THD = √(π²/9 − 1) = 31.1 %', assumptions: ideal }
      break
    case 'svpwm':
      out.v1 = {
        key: 'v1',
        value: (Math.sqrt(3) / 2) * Math.min(p.m, 2 / Math.sqrt(3)) * V,
        formula: 'VLL1 = (√3/2)·m·Vdc (peak), linear up to m = 2/√3',
        assumptions: [...ideal, 'linear range', 'many samples per cycle (regular sampling lowers it by ~cos(π/2mf))'],
        notApplicable: p.m > 2 / Math.sqrt(3) ? 'Overmodulation: the vector is clipped to the hexagon.' : undefined,
      }
      break
    default: {
      const lin = p.m <= 1
      const v1 = p.topology === 'three' ? (Math.sqrt(3) / 2) * p.m * V : p.topology === 'half' ? (p.m * V) / 2 : p.m * V
      out.v1 = {
        key: 'v1',
        value: v1,
        formula: p.topology === 'three' ? 'VLL1 = (√3/2)·m·Vdc (peak)' : p.topology === 'half' ? 'V1 = m·Vdc/2 (peak)' : 'V1 = m·Vdc (peak)',
        assumptions: [...ideal, 'linear modulation (m ≤ 1)', p.sampling === 'natural' ? 'natural sampling' : 'regular sampling: approximately'],
        notApplicable: lin ? undefined : 'Overmodulation (m > 1): pulses drop, the fundamental grows less than in proportion.',
      }
    }
  }
  return out
}

/** SIMULATION vs THEORY. */
export function compareInverter(r: InverterRun, m: InverterMeasurements): CompareResult {
  const p = r.params
  const segs = idealSegments(p)
  const cur = currentTheory(p, segs)
  const ideal = p.devices === 'ideal' && p.td === 0
  const expected = ideal ? undefined : p.td > 0 ? 'ideal-switch theory: dead time changes the voltage (see Why)' : 'ideal-switch theory: device drops lower the voltage'
  const oSegs: Segment[] = segs.map((s) => ({ ta: s.ta, tb: s.tb, va: s.vo, vb: s.vo }))
  const vH = fourier(oSegs, p.period, 3 * (p.mf || 7) + 10)
  const vrmsTh = rmsOf(oSegs, p.period)
  const zAbs = (h: number) => Math.hypot(p.r, p.load === 'RL' ? h * p.omega * p.l : 0)
  // Branch-voltage harmonic h (phase a to load neutral for three-phase).
  const bSegs: Segment[] = segs.map((s) => ({ ta: s.ta, tb: s.tb, va: s.v[0], vb: s.v[0] }))
  const bH = fourier(bSegs, p.period, 5)
  const i1Th = bH[1].amp / zAbs(1)
  const tb = inverterTextbook(p)
  const pLoadTh = cur.rms.reduce((s, x) => s + x * x * p.r, 0)
  const diodeTh = diodeFractionsTheory(p, segs, cur)
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number, exact: number, tol: number, scale: number, textbook: TextbookValue | null = null, absolute = false) => {
    const error = absolute ? Math.abs(sim - exact) : Math.abs(sim - exact) / Math.max(scale, 1e-12)
    const tbErr = textbook && textbook.value !== null && !textbook.notApplicable ? (Math.abs(textbook.value) > 1e-12 ? (sim - textbook.value) / Math.abs(textbook.value) : sim - textbook.value) : null
    rows.push({ key, label, unit, sim, exact, error, tolerance: tol, pass: error <= tol || !!expected, absolute, textbook, textbookError: tbErr, expected })
  }
  const V = p.vdc
  const vName = p.topology === 'three' ? 'VLL1' : 'V1'
  add('v1', `${vName} — output fundamental (peak)`, 'V', m.v1, vH[1].amp, 0.002, vH[1].amp, tb.v1 ?? null)
  add('vrms', p.topology === 'three' ? 'VLL RMS' : 'Output RMS', 'V', m.vrms, vrmsTh, 0.002, vrmsTh, tb.vrms ?? null)
  add('thdV', 'Voltage THD', '%', m.thdV, thdFrom(vrmsTh, vH[0].amp, vH[1].amp), 0.002, 1, tb.thdV ?? null, true)
  const hList = p.tc ? [p.mf - 2, p.mf, p.mf + 2, 2 * p.mf - 1, 2 * p.mf + 1] : p.modulation === 'six-step' ? [5, 7, 11] : [3, 5, 7]
  for (const h of hList) {
    const th = voltageTheoryAmp(p, h)
    add(`v${h}`, `Voltage harmonic h = ${h}`, 'V', m.vHarm[h]?.amp ?? 0, vH[h]?.amp ?? 0, 0.002, Math.max(vH[1].amp, 1e-9), th === null ? null : { key: `v${h}`, value: th, formula: p.tc ? 'Bessel double-Fourier series' : p.modulation === 'quasi' ? '(4·Vdc/(hπ))·|cos hα|' : p.modulation === 'six-step' ? '(2√3·Vdc/π)/h, h = 6k ± 1' : '4·Vdc/(hπ), odd h', assumptions: ['ideal switches'], notApplicable: p.tc && p.m > 1 ? 'overmodulation' : undefined })
  }
  add('irms', p.topology === 'three' ? 'Phase current RMS' : 'Load current RMS', 'A', m.irms, cur.rms[0], 0.003, cur.rms[0])
  add('i1', 'Current fundamental (peak)', 'A', m.i1, i1Th, 0.003, i1Th, { key: 'i1', value: i1Th, formula: 'I1 = V1/|R + jωL| (per phase)', assumptions: ['ideal switches', 'superposition'] })
  add('ipeak', 'Peak current', 'A', m.ipeak, cur.peak, 0.003, cur.peak)
  add('pload', 'Load power', 'W', m.pLoad, pLoadTh, 0.005, pLoadTh)
  add('diode', 'Diode conduction (Σ legs, fraction of cycle)', '%', m.diodeFraction, diodeTh, 0.01, 1, null, true)
  void V
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `One fundamental cycle (f1 = ${p.f1} Hz). THEORY: ideal switches driven by the same gate commands — closed-form/Bessel spectra and the exact R-L current.${ideal ? '' : ' The simulation includes device drops or dead time the ideal theory leaves out.'}`,
  }
}
