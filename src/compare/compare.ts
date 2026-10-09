import { RECTIFIERS, type RectifierChoice } from '../circuits/registry.ts'
import { deviceName } from '../circuits/devices.ts'
import { sourceWindings } from '../circuits/rectifier.ts'
import { compareWithTheory, type Comparison } from '../measurements/compare.ts'
import { overlapAnalysis } from '../measurements/overlap.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import { runSimulation } from '../simulation/engine.ts'
import { supportsFreewheel, type CircuitId, type LabParams, type LoadType, type SimulationResult } from '../types/simulation.ts'

/**
 * COMPARE RECTIFIERS — two rectifiers simulated under one declared basis; every metric is
 * computed from the two simulated datasets. Theoretical-only values (the textbook TUF) are
 * returned separately and labelled as such.
 */
export type Basis = 'vph' | 'vll' | 'pout' | 'pin'

export const BASES: Array<{ id: Basis; label: string; explain: string }> = [
  { id: 'vph', label: 'Same phase RMS voltage', explain: 'Every source winding (single-phase secondary, each half of a center-tapped winding, each three-phase phase) has the same RMS voltage V.' },
  { id: 'vll', label: 'Same line-to-line RMS voltage', explain: 'Three-phase: VLL = V (Vph = V/√3). Single-phase: the winding voltage is V (it is the only "line" voltage).' },
  { id: 'pout', label: 'Same output (load) power', explain: 'Rectifier A runs at V; rectifier B’s source voltage is adjusted (by re-simulating) until its load power equals A’s.' },
  { id: 'pin', label: 'Same input power', explain: 'Rectifier A runs at V; rectifier B’s source voltage is adjusted (by re-simulating) until it draws the same average source power.' },
]

export interface CompareSetup {
  a: string
  b: string
  basis: Basis
  /** Basis voltage [V RMS]. */
  v: number
  frequency: number
  load: LoadType
  resistance: number
  inductance: number
  capacitance: number
  diode: 'ideal' | 'real'
  vf: number
  alphaDeg: number
  freewheel: boolean
}

export const DEFAULT_SETUP: CompareSetup = {
  a: 'br',
  b: '6p',
  basis: 'vph',
  v: 12,
  frequency: 50,
  load: 'R',
  resistance: 10,
  inductance: 0.05,
  capacitance: 1000e-6,
  diode: 'real',
  vf: 0.7,
  alphaDeg: 30,
  freewheel: false,
}

export interface Metric {
  value: number | null
  /** 'sim' = measured on the simulated waveforms; 'theory' = theoretical only. */
  source: 'sim' | 'theory'
  note?: string
}

export interface SideMetrics {
  vdc: Metric
  vrms: Metric
  vpk: Metric
  vmin: Metric
  ripplePP: Metric
  rippleFactor: Metric
  rippleFrequency: Metric
  idc: Metric
  irms: Metric
  ipk: Metric
  iripple: Metric
  pdc: Metric
  pload: Metric
  pin: Metric
  efficiency: Metric
  rectRatio: Metric
  devPeakI: Metric
  devAvgI: Metric
  devRmsI: Metric
  piv: Metric
  devPeakV: Metric
  conduction: Metric
  pulses: Metric
  alpha: Metric
  overlap: Metric
  tufSim: Metric
  tufTheory: Metric
}

export interface CompareSide {
  choice: RectifierChoice
  circuitId: CircuitId
  params: LabParams
  result: SimulationResult
  comparison: Comparison
  metrics: SideMetrics
  /** The source voltage actually used and how it relates to the basis. */
  sourceNote: string
  devices: number
  controlled: boolean
}

export interface CompareResult {
  a: CompareSide
  b: CompareSide
  basis: Basis
  basisNote: string
  heldConstant: string[]
}

/** Textbook transformer-secondary TUF (ideal diodes, resistive load) — theoretical values. */
const TUF_THEORY: Partial<Record<string, { value: number; formula: string }>> = {
  hw: { value: (2 * Math.SQRT2) / Math.PI ** 2, formula: 'TUF = 2√2/π² ≈ 0.287' },
  ct: { value: (4 * Math.SQRT2) / Math.PI ** 2, formula: 'TUF(secondary) = 4√2/π² ≈ 0.573' },
  br: { value: 8 / Math.PI ** 2, formula: 'TUF = 8/π² ≈ 0.811' },
  '3p': { value: 0.664, formula: 'TUF(secondary) ≈ 0.664' },
  '6p': { value: 0.954, formula: 'TUF(secondary) ≈ 0.954' },
}

const choiceOf = (key: string) => {
  const c = RECTIFIERS.find((r) => r.key === key)
  if (!c) throw new Error(`Unknown rectifier ${key}`)
  return c
}

function paramsFor(c: RectifierChoice, s: CompareSetup, vSource: number): LabParams {
  const base = c.phases === 3 ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS
  const cycles = s.load === 'RLC' ? 16 : s.load === 'R' ? 6 : 10
  return {
    ...base,
    source: { ...base.source, vrms: vSource, frequency: s.frequency, phaseDeg: 0 },
    diode: { model: s.diode, vf: s.vf, ron: 0 },
    load: { resistance: s.resistance, inductance: s.inductance, capacitance: s.capacitance },
    control: { device: c.device, alphaDeg: s.alphaDeg, freewheel: s.freewheel && supportsFreewheel(c.topology, s.load) },
    threePhase: { sequence: 'abc', rs: 0, ls: 0 },
    faults: {},
    sim: { ...base.sim, cycles, timestepMode: 'auto' },
  }
}

/** Basis voltage → this rectifier's source voltage (RMS per winding / per phase). */
function sourceVoltage(c: RectifierChoice, s: CompareSetup): number {
  if (s.basis === 'vll' && c.phases === 3) return s.v / Math.sqrt(3)
  return s.v
}

function simulate(c: RectifierChoice, s: CompareSetup, v: number) {
  const params = paramsFor(c, s, v)
  const circuitId = `${c.topology}:${s.load}` as CircuitId
  const result = runSimulation(params, circuitId)
  return { params, circuitId, result, comparison: compareWithTheory(result) }
}

function metricsOf(c: RectifierChoice, run: ReturnType<typeof simulate>): SideMetrics {
  const { result, comparison } = run
  const m = comparison.measurements
  const p = result.params
  const tr = result.trace
  const n = tr.length
  const k0 = Math.max(0, n - 1 - Math.round(p.period / p.dt))
  const N = n - k0
  // Device stress over the last cycle: worst device of the circuit (the freewheeling diode included).
  let peakI = 0
  let avgI = 0
  let rmsI = 0
  let piv = 0
  let peakV = 0
  for (const d of tr.diodes) {
    let pk = 0
    let s = 0
    let s2 = 0
    for (let i = k0; i < n; i++) {
      pk = Math.max(pk, d.current[i])
      s += d.current[i]
      s2 += d.current[i] ** 2
      piv = Math.max(piv, -d.voltage[i])
      peakV = Math.max(peakV, Math.abs(d.voltage[i]))
    }
    peakI = Math.max(peakI, pk)
    avgI = Math.max(avgI, s / N)
    rmsI = Math.max(rmsI, Math.sqrt(s2 / N))
  }
  // Transformer secondary VA from the SIMULATED winding currents: Σ Vrms·Irms over the windings.
  let va = 0
  for (const w of sourceWindings(p.topology)) {
    let s2 = 0
    for (let i = k0; i < n; i++) {
      let iw = 0
      for (const [id, sign] of w.terms) iw += sign * (tr.diodes[result.diodeIds.indexOf(id)]?.current[i] ?? 0)
      s2 += iw * iw
    }
    va += p.vrms * Math.sqrt(s2 / N)
  }
  const pdc = m.voutAvg * m.ioAvg
  const pload = m.loadPower
  const sim = (value: number | null, note?: string): Metric => ({ value, source: 'sim', note })
  const tufTh = TUF_THEORY[c.key]
  const textbookOk = !!tufTh && p.load === 'R' && p.diode.kind === 'ideal'
  const ov = overlapAnalysis(result)
  return {
    vdc: sim(m.voutAvg),
    vrms: sim(m.voutRms),
    vpk: sim(m.voutPeak),
    vmin: sim(m.voutMin),
    ripplePP: sim(m.ripplePP),
    rippleFactor: sim(m.rippleFactor),
    rippleFrequency: sim(m.rippleFrequency),
    idc: sim(m.ioAvg),
    irms: sim(m.ioRms),
    ipk: sim(m.ioPeak),
    iripple: sim(m.ioRipplePP),
    pdc: sim(pdc, 'Vdc·Idc'),
    pload: sim(pload, 'average R·i²'),
    pin: sim(m.sourcePower, 'average source power'),
    efficiency: sim(m.efficiency, p.diode.kind === 'ideal' ? 'ideal (lossless) devices: 100 % by definition of the model' : 'P_load / (P_load + device losses)'),
    rectRatio: sim(m.sourcePower > 1e-12 ? pdc / m.sourcePower : null, 'Pdc / P_in'),
    devPeakI: sim(peakI),
    devAvgI: sim(avgI),
    devRmsI: sim(rmsI),
    piv: sim(piv),
    devPeakV: sim(peakV),
    conduction: sim(m.conductionAngleDeg, `${deviceName(p, result.diodeIds[0])} per cycle`),
    pulses: sim(m.rippleFrequency !== null ? Math.round(m.rippleFrequency / p.frequency) : null, 'output repetitions per source cycle'),
    alpha: { value: c.device === 'scr' ? (p.control.alpha * 180) / Math.PI : null, source: 'sim', note: c.device === 'scr' ? 'firing angle (an input)' : 'uncontrolled' },
    overlap: sim(ov ? ov.measuredMu : null, ov ? 'from the switching events (Ls = 0 here)' : 'single-phase: no overlap model'),
    tufSim: sim(va > 0 ? pdc / va : null, 'Pdc / Σ(Vrms·Irms) of the source windings — secondary side, from simulated currents'),
    tufTheory: { value: textbookOk ? tufTh!.value : null, source: 'theory', note: tufTh ? (textbookOk ? `Theoretical: ${tufTh.formula} (ideal diodes, R load)` : 'Theoretical value exists only for ideal diodes with an R load') : 'no textbook value for this rectifier' },
  }
}

function side(c: RectifierChoice, sim: ReturnType<typeof simulate>, note: string): CompareSide {
  return {
    choice: c,
    circuitId: sim.circuitId,
    params: sim.params,
    result: sim.result,
    comparison: sim.comparison,
    metrics: metricsOf(c, sim),
    sourceNote: note,
    devices: sim.result.diodeIds.filter((id) => id !== 'Dfw').length,
    controlled: c.device === 'scr',
  }
}

/** Run both simulations under the chosen basis and compute every metric from them. */
export function runComparison(s: CompareSetup): CompareResult {
  const ca = choiceOf(s.a)
  const cb = choiceOf(s.b)
  const va = sourceVoltage(ca, s)
  const simA = simulate(ca, s, va)
  let vb = sourceVoltage(cb, s)
  let simB = simulate(cb, s, vb)
  if (s.basis === 'pout' || s.basis === 'pin') {
    // Match B's power to A's: power scales roughly as V², refine by re-simulating (secant on √P).
    const pick = (x: ReturnType<typeof simulate>) => (s.basis === 'pout' ? x.comparison.measurements.loadPower : x.comparison.measurements.sourcePower)
    const target = pick(simA)
    for (let it = 0; it < 6 && target > 0; it++) {
      const pb = pick(simB)
      if (!(pb > 0) || Math.abs(pb - target) <= 1e-3 * target) break
      vb = Math.min(400, vb * Math.sqrt(target / pb))
      simB = simulate(cb, s, vb)
    }
  }
  const unit = (c: RectifierChoice, v: number) => (c.phases === 3 ? `Vph = ${v.toFixed(2)} V (VLL = ${(v * Math.sqrt(3)).toFixed(2)} V)` : c.topology === 'center-tap' ? `${v.toFixed(2)} V per half-winding` : `Vrms = ${v.toFixed(2)} V`)
  const basis = BASES.find((b) => b.id === s.basis)!
  return {
    a: side(ca, simA, unit(ca, va)),
    b: side(cb, simB, unit(cb, vb) + (s.basis === 'pout' || s.basis === 'pin' ? ' (adjusted to match power)' : '')),
    basis: s.basis,
    basisNote: `${basis.label}: ${basis.explain}`,
    heldConstant: [
      `load ${s.load}, R = ${s.resistance} Ω${s.load === 'RL' || s.load === 'RLC' ? `, L = ${(s.inductance * 1e3).toFixed(3)} mH` : ''}${s.load === 'RC' || s.load === 'RLC' ? `, C = ${(s.capacitance * 1e6).toFixed(0)} µF` : ''}`,
      `f = ${s.frequency} Hz`,
      `devices ${s.diode === 'ideal' ? 'ideal' : `Vf = ${s.vf} V`}`,
      'α = ' + s.alphaDeg + '° for controlled rectifiers',
      s.freewheel ? 'freewheeling diode fitted where supported' : 'no freewheeling diode',
      'no source impedance (Ls = Rs = 0)',
    ],
  }
}

/** "Why do they differ?" — statements derived from the two simulated datasets. */
export function whyTheyDiffer(r: CompareResult): string[] {
  const { a, b } = r
  const A = a.choice.short
  const B = b.choice.short
  const ma = a.metrics
  const mb = b.metrics
  const f2 = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d))
  const out: string[] = []
  const pa = ma.pulses.value ?? 0
  const pb = mb.pulses.value ?? 0
  if (pa !== pb)
    out.push(
      `Pulses per cycle: ${A} ${pa}, ${B} ${pb} → ripple frequency ${f2(ma.rippleFrequency.value, 0)} Hz vs ${f2(mb.rippleFrequency.value, 0)} Hz. More pulses means the output is built from more, shorter pieces of the source waveform, so the dips between them are shallower: ripple factor ${f2(ma.rippleFactor.value, 3)} vs ${f2(mb.rippleFactor.value, 3)}.`,
    )
  else out.push(`Both repeat ${pa} times per cycle (ripple frequency ${f2(ma.rippleFrequency.value, 0)} Hz); differences come from the voltage each conducting path sees and from the device drops.`)
  out.push(
    `Average output: ${A} ${f2(ma.vdc.value)} V vs ${B} ${f2(mb.vdc.value)} V on the basis “${BASES.find((x) => x.id === r.basis)!.label}”. ${a.choice.phases !== b.choice.phases ? 'A three-phase bridge rectifies the line voltage (√3·Vph), a single-phase bridge only its own winding voltage — so the basis decides which looks “stronger”.' : ''}`,
  )
  out.push(
    `Device utilisation: ${A} has ${a.devices} devices, the reference device conducts ${f2(ma.conduction.value, 0)}° per cycle; ${B} has ${b.devices}, ${f2(mb.conduction.value, 0)}°. Worst-case device: ${f2(ma.devPeakI.value)} A peak / ${f2(ma.devAvgI.value)} A average vs ${f2(mb.devPeakI.value)} A / ${f2(mb.devAvgI.value)} A, PIV ${f2(ma.piv.value)} V vs ${f2(mb.piv.value)} V.`,
  )
  if (ma.efficiency.value !== null && mb.efficiency.value !== null && a.params.diode.model !== 'ideal')
    out.push(`Efficiency ${(ma.efficiency.value * 100).toFixed(1)} % vs ${(mb.efficiency.value * 100).toFixed(1)} %: every conducting path loses Vf per device (bridges have two in series), so the loss share depends on how high the output voltage is compared with the drops.`)
  if (ma.tufSim.value !== null && mb.tufSim.value !== null)
    out.push(`Transformer utilisation (simulated, secondary): ${f2(ma.tufSim.value, 3)} vs ${f2(mb.tufSim.value, 3)} — how much DC power each gets per VA of winding rating. Windings that carry current in both directions (bridges) are used better than half-wave ones.`)
  if (a.controlled || b.controlled) out.push(`${a.controlled ? A : B}${a.controlled && b.controlled ? ` and ${B}` : ''} use${a.controlled && b.controlled ? '' : 's'} SCRs fired at α = ${r.a.params.control?.alphaDeg ?? 0}°: the output can be adjusted, at the cost of delayed conduction and a lower average.`)
  return out
}

export type Application = 'ripple' | 'power' | 'battery' | 'motor' | 'general'

export const APPLICATIONS: Array<{ id: Application; label: string }> = [
  { id: 'ripple', label: 'Low ripple DC' },
  { id: 'power', label: 'High power' },
  { id: 'battery', label: 'Battery charging' },
  { id: 'motor', label: 'Motor drive' },
  { id: 'general', label: 'General DC supply' },
]

/** "Which should I choose?" — a reasoned, trade-off-aware answer from the two simulations. */
export function advise(r: CompareResult, app: Application): { lean: 'A' | 'B' | 'either'; reasons: string[]; tradeoffs: string[] } {
  const { a, b } = r
  const A = a.choice.short
  const B = b.choice.short
  const ma = a.metrics
  const mb = b.metrics
  const better = (x: number | null, y: number | null, lower = true): 'A' | 'B' | 'either' => (x === null || y === null || Math.abs(x - y) <= 0.02 * Math.max(Math.abs(x), Math.abs(y)) ? 'either' : (x < y) === lower ? 'A' : 'B')
  const name = (w: 'A' | 'B' | 'either') => (w === 'A' ? A : w === 'B' ? B : 'Either')
  switch (app) {
    case 'ripple': {
      const w = better(ma.rippleFactor.value, mb.rippleFactor.value)
      return {
        lean: w,
        reasons: [
          w === 'either' ? 'Both give about the same ripple factor here.' : `${name(w)} has the lower ripple factor (${ma.rippleFactor.value?.toFixed(3)} vs ${mb.rippleFactor.value?.toFixed(3)}) and ${(w === 'A' ? ma : mb).rippleFrequency.value} Hz ripple — a higher ripple frequency is also easier to filter (smaller L and C).`,
        ],
        tradeoffs: ['More pulses needs a three-phase supply and more devices.', 'Any rectifier can reach low ripple with a large enough filter — at the cost of size, inrush current and peaky diode currents.'],
      }
    }
    case 'power': {
      const w = a.choice.phases === b.choice.phases ? better(ma.tufSim.value, mb.tufSim.value, false) : a.choice.phases === 3 ? 'A' : 'B'
      return {
        lean: w,
        reasons: [
          a.choice.phases !== b.choice.phases ? `${name(w)} is three-phase: it loads all three supply phases evenly, and at the same power each device carries a smaller share of the current.` : `${w === 'either' ? 'Both' : name(w)} make${w === 'either' ? '' : 's'} better use of the transformer (simulated TUF ${ma.tufSim.value?.toFixed(3)} vs ${mb.tufSim.value?.toFixed(3)}).`,
          `Worst-case device average current: ${ma.devAvgI.value?.toFixed(2)} A (${A}) vs ${mb.devAvgI.value?.toFixed(2)} A (${B}).`,
        ],
        tradeoffs: ['Three-phase rectifiers need a three-phase supply; single-phase is simpler for small loads.', 'Half-wave circuits draw a DC component from the transformer — avoided at high power.'],
      }
    }
    case 'battery': {
      const ctl = a.controlled !== b.controlled ? (a.controlled ? 'A' : 'B') : 'either'
      return {
        lean: ctl,
        reasons: [
          ctl === 'either'
            ? a.controlled
              ? 'Both are controlled: the charging current can be set with α.'
              : 'Neither is controlled: the output is fixed by the supply — a charger would need a regulator or controlled devices.'
            : `${name(ctl)} uses SCRs, so the charging current can be adjusted with α (here α = ${r.a.params.control?.alphaDeg}°); the uncontrolled one cannot regulate.`,
        ],
        tradeoffs: ['A battery is a back-EMF, which this lab does not model: conduction starts only when the source exceeds the battery voltage.', 'Ripple matters less than control and current limiting for charging.'],
      }
    }
    case 'motor': {
      const full = (s: CompareSide) => s.controlled && s.choice.topology !== 'semi-bridge' && s.choice.topology !== '3ph-half-controlled'
      const w = full(a) !== full(b) ? (full(a) ? 'A' : 'B') : a.controlled !== b.controlled ? (a.controlled ? 'A' : 'B') : 'either'
      return {
        lean: w,
        reasons: [
          w === 'either' ? 'Both offer the same kind of control for a DC motor.' : `${name(w)} ${full(w === 'A' ? a : b) ? 'is fully controlled: with α > 90° and a motor whose back-EMF keeps the current flowing it can invert (Vdc < 0) and return energy — regenerative braking (not shown here: this lab has no back-EMF, so an R-L load just goes discontinuous)' : 'is controlled: speed can be set with α'}.`,
          `Current continuity (minimum load current, simulated): ${a.comparison.measurements.ioMin.toFixed(3)} A vs ${b.comparison.measurements.ioMin.toFixed(3)} A — continuous current means smoother torque.`,
        ],
        tradeoffs: ['Semi-controlled bridges freewheel through their own leg: better power factor, but no inversion.', 'This lab models the motor as R + L only (no back-EMF).'],
      }
    }
    case 'general': {
      const simple = (s: CompareSide) => !s.controlled && s.choice.phases === 1 && s.choice.topology !== 'half-wave'
      const w = simple(a) !== simple(b) ? (simple(a) ? 'A' : 'B') : better(ma.rippleFactor.value, mb.rippleFactor.value)
      return {
        lean: w,
        reasons: [
          // the reason must describe the side it picks: a diode bridge only when that side is one
          w !== 'either' && simple(w === 'A' ? a : b)
            ? `${name(w)}: a single-phase diode bridge (usually with a capacitor filter) is the common choice — no control circuitry, both half-cycles used (TUF ${ma.tufSim.value?.toFixed(2)} vs ${mb.tufSim.value?.toFixed(2)}).`
            : `${w === 'either' ? 'Either works' : name(w)}: ${w === 'either' ? 'similar' : 'lower'} ripple (ripple factor ${ma.rippleFactor.value?.toFixed(3) ?? '—'} vs ${mb.rippleFactor.value?.toFixed(3) ?? '—'}, simulated); for a general-purpose supply a single-phase diode bridge with a capacitor filter is the usual choice (TUF ${ma.tufSim.value?.toFixed(2)} vs ${mb.tufSim.value?.toFixed(2)}).`,
        ],
        tradeoffs: ['A half-wave rectifier is cheaper but has high ripple and poor transformer use.', 'Three-phase is worth it only when a three-phase supply exists and the power is large.'],
      }
    }
  }
}
