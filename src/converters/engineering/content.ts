import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatSI, formatTime, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { exactThermal, textbookThermal, zth } from './theory.ts'
import { loadOn, lossAt, measureThermal, resolveThermal, simulateThermal, THERMAL_DEFAULTS, type ThermalMeasurements, type ThermalParams, type ThermalRun } from './thermal.ts'

const resolveThermalLite = (p: ThermalParams) => resolveThermal(p).params

export { measureThermal, simulateThermal }

const degC = (t: number) => `${t.toFixed(1)} °C`
const kel = (t: number) => `${t.toFixed(2)} K`

export interface ThermalState {
  k: number
  t: number
  tj: number
  ths: number
  p: number
  pc: number
  ps: number
  on: boolean
  /** Temperature drop across each Foster stage [K]. */
  theta: number[]
  /** Net power stored in the thermal capacitances [W] (P − heat leaving to ambient). */
  pStore: number
}

export function thermalStateAt(r: ThermalRun, k: number): ThermalState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const theta = p.stages.map((_, j) => s[`th${j}`][i])
  const out = theta[theta.length - 1] / p.stages[p.stages.length - 1].r
  return { k: i, t: r.time[i], tj: s.tj[i], ths: s.ths[i], p: s.p[i], pc: s.pc[i], ps: s.ps[i], on: s.load[i] > 0.5, theta, pStore: s.p[i] - out }
}

export function thermalView(st: ThermalState, r: ThermalRun): StateView {
  const p = r.params
  return {
    badge: { text: st.on ? (st.pStore > 0 ? 'loaded · heating' : 'loaded') : 'idle · cooling', tone: st.on ? 'on' : 'off' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'junction Tj', v: degC(st.tj), tone: st.tj > 150 ? 'bad' : 'ok' },
      { k: 'heatsink (approx.)', v: degC(st.ths) },
      { k: 'total loss', v: formatW(st.p) },
      { k: 'ambient', v: degC(p.ta) },
      { k: 'conduction loss', v: formatW(st.pc), min: 'standard' },
      { k: 'switching loss', v: formatW(st.ps), min: 'standard' },
      { k: 'Ron at Tj', v: formatSI(p.ron * (1 + p.alpha * (st.tj - 25)), 'Ω'), min: 'standard' },
      { k: 'stored in heat capacity', v: formatW(st.pStore), min: 'engineer' },
      ...st.theta.map((th, j) => ({ k: j < st.theta.length - 1 ? `Foster stage ${j + 1}` : 'heatsink stage', v: kel(th), min: 'engineer' as const })),
    ],
    path: st.on ? `junction → case → heatsink → ambient (${formatW(st.p)} generated)` : 'no loss: the stored heat flows out to ambient',
  }
}

export function thermalWhy(r: ThermalRun, st: ThermalState, m: ThermalMeasurements): WhyCard[] {
  const p = r.params
  const tb = textbookThermal(p)
  const cards: WhyCard[] = []
  cards.push(
    st.on
      ? {
          id: 'now',
          question: 'Where does the heat come from?',
          what: `The switch dissipates ${formatW(st.p)}: ${formatW(st.pc)} conduction + ${formatW(st.ps)} switching, at Tj = ${degC(st.tj)}.`,
          why: 'Conduction loss is I²·Ron while the switch is on; switching loss is the V·I overlap during every transition, times the switching frequency. Both grow with temperature (Ron rises, the transitions slow down).',
          equation: 'P = D·I²·Ron(Tj) + fs·½·V·I·tsw·(1 + κ·ΔT)',
          physics: `Ron is now ${formatSI(p.ron * (1 + p.alpha * (st.tj - 25)), 'Ω')} — ${((p.alpha * (st.tj - 25)) * 100).toFixed(0)} % above its 25 °C value.`,
          whatIf: 'A lower switching frequency trades switching loss for larger magnetics; a larger die lowers Ron.',
        }
      : {
          id: 'now',
          question: 'Why does the junction cool so fast at first?',
          what: `The load is off: no loss. Tj = ${degC(st.tj)} is falling towards the heatsink temperature (${degC(st.ths)}).`,
          why: 'The die and its solder layer have tiny heat capacities (the fast Foster stages): they cool in milliseconds. The heatsink, with a large capacity, cools over minutes.',
          equation: 'θi(t) = θi(0)·e^(−t/τi)',
          physics: `Time constants: ${p.stages.map((x) => formatTime(x.tau)).join(', ')}.`,
          whatIf: 'Longer pauses let more of the heatsink heat escape: a lower mean temperature.',
        },
  )
  cards.push({
    id: 'feedback',
    question: 'Why is Tj higher than Ta + P·Rth?',
    what: `SIMULATION: mean Tj ${degC(m.tjMean)}; with the loss taken at 25 °C the textbook gives ${degC(tb.tjMeanNoFeedback)}.`,
    why: 'Hotter silicon loses more (Ron and the switching energy rise with temperature), which heats it further. The loop converges as long as the extra loss per kelvin, b, times Rth stays below 1.',
    equation: `P = a + b·(Tj − 25),  b·Rth = ${(p.b * p.rth).toFixed(3)}${p.b * p.rth >= 1 ? ' ≥ 1: RUNAWAY' : ' < 1: stable'}`,
    physics: p.load === 'constant' && tb.tjSelfConsistent !== null ? `Constant load: Tj = (Ta + Rth·(a − 25·b))/(1 − b·Rth) = ${degC(tb.tjSelfConsistent)}.` : `Rth junction-to-ambient = ${p.rth.toFixed(3)} K/W.`,
    whatIf: 'A better heatsink (lower Rha) helps twice: less temperature rise per watt, and fewer watts.',
  })
  if (p.load === 'pulsed')
    cards.push({
      id: 'cycling',
      question: 'Why does the temperature swing matter?',
      what: `SIMULATION: Tj cycles between ${degC(m.tjMin)} and ${degC(m.tjMax)} — ΔTj = ${kel(m.dTj)} every ${formatTime(p.period)}.`,
      why: 'Silicon, solder, copper and bond wires expand differently. Every temperature cycle strains the joints; their lifetime falls steeply with ΔTj (roughly as ΔTj^−5 in Coffin–Manson fits — an ESTIMATE).',
      equation: `ΔTj ≈ P·Zth(ton) = ${formatW(tb.p25)} × ${zth(p, p.ton).toFixed(3)} K/W (datasheet estimate)`,
      physics: 'The heatsink is too slow to follow a short pulse: only the fast stages (die, solder, case) swing — the heatsink stays near its mean.',
      whatIf: 'Shorter pulses (faster cycling) shrink ΔTj; long pulses let the junction reach almost its full steady rise.',
    })
  return cards
}

export function compareThermal(r: ThermalRun, m: ThermalMeasurements): CompareResult {
  const p = r.params
  const ex = exactThermal(p)
  const tb = textbookThermal(p)
  const rows: CompareRow[] = []
  const rise = Math.max(1, Math.abs(ex.tjMean - p.ta))
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tbv: number | null, formula: string, notes: string[], scale?: number) => {
    if (sim === null || exact === null) return
    const den = scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = tbv === null ? null : { key, value: tbv, formula, assumptions: notes }
    rows.push({ key, label, unit, sim, exact, error, tolerance: 0.005, pass: error <= 0.005, absolute: scale !== undefined, textbook, textbookError: tbv !== null ? (sim - tbv) / Math.max(Math.abs(tbv), 1e-30) : null })
  }
  const noFb = ['loss at 25 °C: no temperature feedback']
  add('tjMean', 'Mean junction temperature', '°C', m.tjMean, ex.tjMean, p.load === 'constant' && p.view === 'steady' ? tb.tjSelfConsistent : tb.tjMeanNoFeedback, p.load === 'constant' && p.view === 'steady' ? '(Ta + Rth·(a − 25·b))/(1 − b·Rth)' : 'Ta + δ·P25·Rth', p.load === 'constant' && p.view === 'steady' ? ['exact for a constant load (self-consistent loss)'] : noFb, rise)
  add('tjMax', 'Peak junction temperature', '°C', m.tjMax, ex.tjMax, tb.tjMaxPulse, 'Ta + δ·P·Rth + (1 − δ)·P·Zth(ton)', ['datasheet pulse-train estimate', ...noFb], rise)
  if (p.load === 'pulsed') {
    add('tjMin', 'Lowest junction temperature', '°C', m.tjMin, ex.tjMin, null, '', [], rise)
    add('dTj', 'Temperature swing ΔTj', 'K', m.dTj, ex.dTj, tb.p25 * zth(p, p.ton), 'P·Zth(ton)', ['single pulse from the mean', ...noFb], rise)
  }
  add('pMean', 'Mean loss', 'W', m.pMean, ex.pMean, tb.p25 * (p.load === 'constant' ? 1 : p.ton / p.period), 'δ·P25', noFb)
  add('thsMean', 'Heatsink stage (mean)', '°C', m.thsMean, ex.thsMean, null, '', [], rise)
  if (p.view === 'startup') {
    add('peakRun', 'Highest Tj in the run', '°C', m.tjPeakRun, ex.tjPeakRun, null, '', [], rise)
    add('t90', 'Time to 90 % of the temperature rise', 's', m.t90, ex.t90, null, '', [])
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `SIMULATION: trapezoidal time-stepping of the thermal network with temperature-dependent losses. THEORY: the exact solution (matrix exponential)${p.view === 'steady' ? ' and the exact periodic steady state' : ''}; one-cycle spectral radius ${ex.rho.toFixed(4)}${ex.rho >= 1 ? ' — UNSTABLE' : ''}. Textbook: Tj = Ta + P·Rth and the datasheet Zth estimate.`,
    note: 'The Foster stages are a datasheet curve fit: the heatsink stage is only an approximate heatsink temperature. Temperatures are compared relative to the junction temperature rise.',
  }
}

export function thermalEventLabel(e: RunEvent): string {
  if (e.device === 'load-on') return 'Load on'
  if (e.device === 'load-off') return 'Load off'
  if (e.device === 'tj-max') return 'Highest junction temperature'
  return e.device ?? e.kind
}
export function thermalEventWhy(e: RunEvent): string {
  const v = `Tj = ${degC(e.values.tj ?? 0)}, loss ${formatW(e.values.p ?? 0)}.`
  if (e.device === 'tj-max') return `${v} The junction is hottest at the end of a load pulse: from here the heat leaves faster than it arrives.`
  if (e.device === 'load-on') return `${v} The losses start again: the die heats within milliseconds.`
  return `${v} No loss: the die cools quickly, the heatsink slowly.`
}

type L = Lesson<ThermalParams, ThermalRun, ThermalMeasurements, ThermalState>

export const THERMAL_LESSONS: L[] = [
  {
    id: 'heatup',
    title: 'From cold to hot: four time constants',
    summary: 'Switch on a constant load and watch the die, the case and the heatsink warm up.',
    base: { load: 'constant', view: 'startup' },
    steps: [
      {
        title: '1 · The die heats in milliseconds',
        at: () => 0.5,
        window: () => [0, 2],
        channels: ['tj', 'ths', 'p'],
        look: 'Tj jumps by several kelvin almost at once; the heatsink has not moved.',
        body: (st) => `After half a second Tj is already ${degC(st.tj)} while the heatsink is at ${degC(st.ths)}: the small die and solder heat capacities fill first.`,
      },
      {
        title: '2 · The heatsink takes minutes',
        at: (r) => 0.5 * r.params.duration,
        window: (r) => [0, r.params.duration],
        channels: ['tj', 'ths', 'p'],
        look: 'Tj and the heatsink rise together, slowly, with the heatsink time constant.',
        body: (st, m, r) => `Now ${degC(st.tj)}. The heatsink's time constant (${formatTime(r.params.tauha)}) sets the slow climb; 90 % of the rise took ${formatTime(m.t90 ?? NaN)}.`,
      },
      {
        title: '3 · Hotter means lossier',
        at: (r) => r.params.duration,
        window: (r) => [0, r.params.duration],
        channels: ['tj', 'p'],
        look: 'The loss rises while the device heats up.',
        body: (st, _m, r) => `The loss grew from ${formatW(r.params.a + r.params.b * (r.params.ta - 25))} at ambient to ${formatW(st.p)}: Ron and the switching energy increase with temperature. Final Tj ${degC(st.tj)}.`,
      },
    ],
  },
  {
    id: 'cycling',
    title: 'Power cycling',
    summary: 'A pulsed load: the junction temperature swings every cycle.',
    base: { load: 'pulsed', view: 'steady' },
    steps: [
      {
        title: '1 · A swing on top of a mean',
        params: { ton: 2, toff: 2 },
        at: (r) => r.params.ton,
        channels: ['tj', 'ths', 'p'],
        look: 'Tj saws up and down; the heatsink barely moves.',
        body: (_st, m) => `Tj swings ${kel(m.dTj)} (${degC(m.tjMin)} to ${degC(m.tjMax)}) around a mean of ${degC(m.tjMean)}.`,
      },
      {
        title: '2 · Faster cycling, smaller swing',
        params: { ton: 0.2, toff: 0.2 },
        at: (r) => r.params.ton,
        channels: ['tj', 'ths', 'p'],
        look: 'Same mean — a smaller swing, but not ten times smaller.',
        body: (_st, m) => `With 0.2 s pulses ΔTj is ${kel(m.dTj)}, at the same mean ${degC(m.tjMean)}: the slow stages now only see the average loss, but the die and solder — milliseconds — still heat fully in every pulse.`,
      },
    ],
  },
]

export const THERMAL_EXPERIMENTS: Array<Experiment<ThermalParams, ThermalMeasurements>> = [
  {
    id: 'heatsink',
    title: 'Halve the heatsink resistance',
    change: (p) => ({ rha: p.rha / 2 }),
    question: () => 'A heatsink with half the thermal resistance. The temperature rise of the junction…',
    choices: ['falls by more than the heatsink share — the losses fall too', 'halves exactly', 'does not change'],
    judge: (b, a) => (a.tjMean < b.tjMean && a.pMean < b.pMean ? 0 : 2),
    rows: ['tjMean', 'pMean', 'dTj'],
    why: (b, a) => `Mean Tj ${degC(b.tjMean)} → ${degC(a.tjMean)}, loss ${formatW(b.pMean)} → ${formatW(a.pMean)}. The cooler junction also loses less (lower Ron), a second gain on top of the lower resistance. The swing ΔTj hardly changes (${kel(b.dTj)} → ${kel(a.dTj)}): it is set by the fast stages.`,
  },
  {
    id: 'current',
    title: '40 % more current',
    change: (p) => ({ i: p.i * 1.4 }),
    question: () => 'The current rises by 40 %. The conduction loss…',
    choices: ['about doubles — or more', 'rises by 40 %', 'stays the same'],
    judge: (b, a) => (a.pcMean / b.pcMean > 1.9 ? 0 : a.pcMean / b.pcMean > 1.3 ? 1 : 2),
    rows: ['pMean', 'tjMean', 'tjMax'],
    why: (b, a) => `Conduction loss ${formatW(b.pcMean)} → ${formatW(a.pcMean)} (×${(a.pcMean / b.pcMean).toFixed(2)}): I² alone gives ×1.96, and the hotter junction raises Ron as well. The switching loss only grows ∝ I (${formatW(b.psMean)} → ${formatW(a.psMean)}).`,
  },
  {
    id: 'pulse',
    title: 'Ten times shorter pulses',
    change: (p) => ({ ton: p.ton / 10, toff: p.toff / 10 }),
    question: () => 'Same duty cycle, ten times shorter load pulses. The temperature swing ΔTj…',
    choices: ['shrinks — but far less than ten times', 'shrinks ten times', 'stays the same'],
    judge: (b, a) => (a.dTj < 0.95 * b.dTj && a.dTj > 0.15 * b.dTj ? 0 : a.dTj <= 0.15 * b.dTj ? 1 : 2),
    rows: ['dTj', 'tjMean', 'tjMax'],
    why: (b, a, p0, p1) => `ΔTj ${kel(b.dTj)} → ${kel(a.dTj)} at almost the same mean (${degC(b.tjMean)} → ${degC(a.tjMean)}). The slow stages stop following, but the die and solder (τ of milliseconds) still heat fully in each ${formatTime(p1.ton)} pulse: ΔTj ≈ P·Zth(ton), and Zth(${formatTime(p1.ton)}) = ${zth({ ...resolveThermalLite(p1) }, p1.ton).toFixed(3)} K/W vs Zth(${formatTime(p0.ton)}) = ${zth({ ...resolveThermalLite(p0) }, p0.ton).toFixed(3)} K/W.`,
  },
]

export function thermalPredictions(seed: number): Array<PredictTask<ThermalParams, ThermalMeasurements>> {
  const rha = [0.3, 0.5, 0.8][seed % 3]
  return [
    {
      id: 'loss',
      prompt: 'I = 80 A, D = 50 %, Ron = 10 mΩ (at 25 °C), 600 V, 10 kHz, tsw = 133 ns. Predict the loss of the switch at 25 °C (switching + conduction).',
      params: { load: 'constant', view: 'steady', alpha: 0, kappa: 0 },
      kind: 'number',
      unit: 'W',
      answer: (m) => m.pMean,
      tolerance: 0.03,
      hint: 'D·I²·Ron plus fs·½·V·I·tsw.',
      theory: (p) => `P = D·I²·Ron + fs·½·V·I·tsw = ${formatW(p.duty * p.i * p.i * p.ron)} + ${formatW(p.fs * 0.5 * p.vdc * p.i * p.tsw)}`,
    },
    {
      id: 'tj',
      prompt: `Constant load, losses temperature-independent here (64 W), Rth(j-c) = 0.3 K/W, Rth(c-a) = ${rha} K/W, Ta = 40 °C. Predict Tj.`,
      params: { load: 'constant', view: 'steady', alpha: 0, kappa: 0, rha },
      kind: 'number',
      unit: '°C',
      answer: (m) => m.tjMean,
      tolerance: 0.02,
      hint: 'Tj = Ta + P·(Rth(j-c) + Rth(c-a)).',
      theory: (p) => `Tj = Ta + P·Rth = ${degC(40 + 64 * (0.3 + p.rha))}`,
    },
  ]
}

export { loadOn, lossAt, THERMAL_DEFAULTS }
