import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import type { ConverterParams, ConverterResult, ConverterSignal } from '../types.ts'
import type { BuckMeasurements } from './measure.ts'
import { buckBoundary } from './theory.ts'
import type { BuckState } from './explain.ts'
import { voltSecondFromSim } from './explain.ts'

/**
 * Buck learning content: lessons, experiments and prediction tasks. All text that states a value
 * reads it from the simulation (state at the cursor, measurements); formulas appear only where
 * the content is ABOUT the formula, labelled as theory.
 */

export interface LessonStep {
  title: string
  /** Parameter changes for this step (relative to the lesson's start). */
  params?: Partial<ConverterParams>
  /** Cursor position: a fraction of the ON interval or of the OFF part of the period (first shown period). */
  at: ['on' | 'off', number]
  channels: ConverterSignal[]
  body(st: BuckState, m: BuckMeasurements, r: ConverterResult): string
  /** What to look at on the scope. */
  look: string
}

export interface Lesson {
  id: string
  title: string
  summary: string
  base: Partial<ConverterParams>
  steps: LessonStep[]
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`

export const BUCK_LESSONS: Lesson[] = [
  {
    id: 'how',
    title: 'How a buck converter works',
    summary: 'The switch, the inductor, the diode and the capacitor — one switching period, instant by instant.',
    base: {},
    steps: [
      {
        title: 'The PWM gate chops the input',
        at: ['on', 0.5],
        channels: ['gate', 'vsw'],
        look: 'Gate and Vsw rise and fall together.',
        body: (st, _m, r) =>
          `Q1 is switched by a PWM signal: ON for D = ${pct(r.params.duty)} of every period Ts = ${formatTime(r.params.ts)}. While it is ON the switch node follows the input (now vsw = ${formatV(st.vsw)}); while it is OFF it drops to about 0 V. The switch node is a pulse train between 0 and Vin — the rest of the circuit turns it into DC.`,
      },
      {
        title: 'Switch ON: the inductor stores energy',
        at: ['on', 0.5],
        channels: ['gate', 'vsw', 'il'],
        look: 'iL ramps UP while the gate is high.',
        body: (st) =>
          `Q1 conducts, D1 is reverse biased (vD = ${formatV(st.vd)}). The inductor sees vL = vsw − Vout = ${formatV(st.vl)}, so its current rises at diL/dt = vL/L (${formatA(st.il)} now). The source supplies the inductor and the load; the magnetic energy EL = ${formatSI(st.el, 'J')} grows.`,
      },
      {
        title: 'Switch OFF: why the diode turns on',
        at: ['off', 0.02],
        channels: ['gate', 'vsw', 'il', 'id'],
        look: 'At the falling gate edge iL does NOT jump — it moves from Q1 into D1.',
        body: (st) =>
          `Q1 has just opened, but the inductor current is still ${formatA(st.il)}: an inductor current cannot change instantly. The switch node is pulled down until D1 conducts (vsw = ${formatV(st.vsw)}), and the same current now flows through D1: iD = ${formatA(st.id)}.`,
      },
      {
        title: 'Freewheeling: the inductor releases energy',
        at: ['off', 0.5],
        channels: ['gate', 'vsw', 'il', 'vout'],
        look: 'iL ramps DOWN while the gate is low.',
        body: (st) =>
          `Now vL = vsw − Vout = ${formatV(st.vl)} is negative, so iL falls. The current loop is L → load → ground → D1 → L: the inductor alone drives the load, from the energy it stored (EL = ${formatSI(st.el, 'J')}, shrinking).`,
      },
      {
        title: 'The capacitor smooths the output',
        at: ['on', 0.5],
        channels: ['il', 'io', 'ic', 'vout'],
        look: 'iC = iL − iR: positive when iL is above the load current.',
        body: (st, m) =>
          `The load wants a steady ${formatA(m.ioAvg)}; the inductor delivers a triangle around it (${formatA(m.ilMin)} … ${formatA(m.ilMax)}). The capacitor takes the difference: iC = ${formatA(st.ic, true)} now. The output therefore moves only ${formatSI(m.voutPP, 'V')} peak-to-peak.`,
      },
      {
        title: 'Why Vout ≈ D·Vin: volt-second balance',
        at: ['on', 0.5],
        channels: ['vsw', 'vl', 'vout'],
        look: 'vL is positive while ON and negative while OFF — the two areas cancel.',
        body: (_st, m, r) => {
          const vs = voltSecondFromSim(r)
          return `In steady state iL returns to the same value every period, so the average inductor voltage must be zero (simulated: ${formatV(vs.vlAvg)}). vL = vsw − Vout, so average(vsw) = average(Vout): simulated ${formatV(vs.vswAvg)} and ${formatV(vs.voutAvg)}. vsw is Vin for D·Ts and ~0 V otherwise, so Vout ≈ D·Vin = ${formatV(r.params.duty * r.params.vin)} (theory, ideal CCM); the simulation gives ${formatV(m.voutAvg)}.`
        },
      },
    ],
  },
  {
    id: 'dcm',
    title: 'Continuous and discontinuous conduction',
    summary: 'Light load: the inductor current reaches zero, the diode turns off, and Vout no longer equals D·Vin.',
    base: { r: 30 },
    steps: [
      {
        title: 'A lighter load: R = 30 Ω',
        at: ['on', 0.5],
        channels: ['gate', 'il', 'vout'],
        look: 'iL touches zero before the next gate pulse.',
        body: (_st, m, r) => {
          const b = buckBoundary(r.params)
          return `With R = ${formatSI(r.params.r, 'Ω')} the average current is only ${formatA(m.ilAvg)}, smaller than half the ripple. The falling iL reaches 0 before the period ends — the simulation reports ${m.mode}. (Theory: CCM needs L > Lcrit = (1 − D)·R/(2·fs) = ${formatSI(b.lCrit, 'H')}; here L = ${formatSI(r.params.l, 'H')}.)`
        },
      },
      {
        title: 'iL = 0: the diode turns OFF',
        at: ['off', 0.97],
        channels: ['gate', 'il', 'id', 'vsw'],
        look: 'In the idle interval iL = 0 and vsw rests at Vout.',
        body: (st) =>
          st.interval === 'idle'
            ? `Here both devices are OFF: iL = 0, iD = 0. D1 cannot carry reverse current, so it turned off when iL reached zero. With no current in L, vL = 0, so the switch node sits at Vout: vsw = ${formatV(st.vsw)}.`
            : `Move the cursor to the end of the period: after iL reaches zero both devices are OFF (here: ${st.interval === 'on' ? 'Q1 is ON' : 'D1 still conducts'}).`,
      },
      {
        title: 'In DCM, Vout rises above D·Vin',
        at: ['on', 0.5],
        channels: ['vsw', 'vout'],
        look: 'vsw has a third level (= Vout) during the idle interval.',
        body: (_st, m, r) =>
          `Volt-second balance still holds, but the switch node now has three levels: Vin (ON), 0 (diode ON) and Vout (idle). The idle part raises average(vsw), so Vout = ${formatV(m.voutAvg)} — above D·Vin = ${formatV(r.params.duty * r.params.vin)}. In DCM, Vout depends on the load, L and fs, not only on D.`,
      },
    ],
  },
]

/** Experiment: a parameter change with a prediction first. */
export interface Experiment {
  id: string
  title: string
  /** Builds the changed parameters from the current ones. */
  change(p: ConverterParams): Partial<ConverterParams>
  question(p: ConverterParams): string
  choices: string[]
  /** Index of the choice the SIMULATION will confirm, decided from the before/after results. */
  judge(before: BuckMeasurements, after: BuckMeasurements): number
  /** Rows to compare. */
  rows: Array<keyof BuckMeasurements>
  why(before: BuckMeasurements, after: BuckMeasurements, p0: ConverterParams, p1: ConverterParams): string
}

const ratio = (a: number, b: number) => (Math.abs(b) > 1e-12 ? a / b : NaN)

export const BUCK_EXPERIMENTS: Experiment[] = [
  {
    id: 'duty',
    title: 'Change the duty ratio',
    change: (p) => ({ duty: Math.min(0.9, Math.round((p.duty + 0.2) * 100) / 100) }),
    question: (p) => `D goes from ${pct(p.duty)} to ${pct(Math.min(0.9, p.duty + 0.2))}. What happens to Vout?`,
    choices: ['Vout rises', 'Vout falls', 'Vout stays the same'],
    judge: (b, a) => (a.voutAvg > b.voutAvg * 1.001 ? 0 : a.voutAvg < b.voutAvg * 0.999 ? 1 : 2),
    rows: ['voutAvg', 'ilAvg', 'ilPP', 'voutPP', 'mode'],
    why: (b, a, p0, p1) =>
      `Vout went from ${formatV(b.voutAvg)} to ${formatV(a.voutAvg)} (×${ratio(a.voutAvg, b.voutAvg).toFixed(3)}; D changed ×${(p1.duty! / p0.duty).toFixed(3)}). Q1 now stays on longer, so the switch node spends more of each period at Vin; volt-second balance moves the average output with it.${a.mode !== b.mode ? ` The conduction mode changed: ${b.mode} → ${a.mode}.` : ''}`,
  },
  {
    id: 'inductor',
    title: 'Double the inductance',
    change: (p) => ({ l: p.l * 2 }),
    question: (p) => `L goes from ${formatSI(p.l, 'H')} to ${formatSI(p.l * 2, 'H')}. What happens to the inductor ripple ΔiL?`,
    choices: ['ΔiL roughly halves', 'ΔiL roughly doubles', 'ΔiL stays the same'],
    judge: (b, a) => {
      const q = ratio(a.ilPP, b.ilPP)
      return q < 0.75 ? 0 : q > 1.33 ? 1 : 2
    },
    rows: ['ilPP', 'ilMax', 'ilMin', 'voutAvg', 'voutPP', 'mode'],
    why: (b, a) =>
      `ΔiL went from ${formatA(b.ilPP)} to ${formatA(a.ilPP)} (×${ratio(a.ilPP, b.ilPP).toFixed(3)}). The same voltage across a larger inductance makes the current change more slowly (diL/dt = vL/L), so it travels less in the same ON time. The average current is set by the load, so it did not change: ${formatA(b.ilAvg)} → ${formatA(a.ilAvg)}.${a.mode !== b.mode ? ` Mode: ${b.mode} → ${a.mode}.` : ''}`,
  },
  {
    id: 'capacitor',
    title: 'Quadruple the capacitance',
    change: (p) => ({ c: p.c * 4 }),
    question: (p) => `C goes from ${formatSI(p.c, 'F')} to ${formatSI(p.c * 4, 'F')}. What happens to the output ripple ΔVout?`,
    choices: ['ΔVout drops to about a quarter', 'ΔVout drops to about half', 'ΔVout stays the same'],
    judge: (b, a) => {
      const q = ratio(a.voutPP, b.voutPP)
      return q < 0.375 ? 0 : q < 0.75 ? 1 : 2
    },
    rows: ['voutPP', 'voutAvg', 'ilPP', 'icRms'],
    why: (b, a) =>
      `ΔVout went from ${formatSI(b.voutPP, 'V')} to ${formatSI(a.voutPP, 'V')} (×${ratio(a.voutPP, b.voutPP).toFixed(3)}). The capacitor still absorbs the same ripple current (ΔiL ${formatA(b.ilPP)} → ${formatA(a.ilPP)}), but a 4× larger C changes its voltage 4× less for the same charge (dv = i·dt/C). The average Vout does not depend on C: ${formatV(b.voutAvg)} → ${formatV(a.voutAvg)}.`,
  },
  {
    id: 'frequency',
    title: 'Double the switching frequency',
    change: (p) => ({ fs: Math.min(500e3, p.fs * 2) }),
    question: (p) => `fs goes from ${formatSI(p.fs, 'Hz')} to ${formatSI(Math.min(500e3, p.fs * 2), 'Hz')}. What happens to ΔiL?`,
    choices: ['ΔiL roughly halves', 'ΔiL roughly doubles', 'ΔiL stays the same'],
    judge: (b, a) => {
      const q = ratio(a.ilPP, b.ilPP)
      return q < 0.75 ? 0 : q > 1.33 ? 1 : 2
    },
    rows: ['ilPP', 'voutPP', 'voutAvg', 'mode'],
    why: (b, a) =>
      `ΔiL: ${formatA(b.ilPP)} → ${formatA(a.ilPP)} (×${ratio(a.ilPP, b.ilPP).toFixed(3)}); ΔVout: ${formatSI(b.voutPP, 'V')} → ${formatSI(a.voutPP, 'V')} (×${ratio(a.voutPP, b.voutPP).toFixed(3)}). Each ON and OFF interval is half as long, so the inductor current ramps for half the time. The output ripple falls even more, because the capacitor also has half the time to charge with a smaller ripple current. D (and so Vout) is unchanged.`,
  },
  {
    id: 'dcm',
    title: 'Lighten the load until DCM',
    change: (p) => ({ r: Math.min(1000, p.r * 4) }),
    question: (p) => `R goes from ${formatSI(p.r, 'Ω')} to ${formatSI(Math.min(1000, p.r * 4), 'Ω')} (a quarter of the load current). What happens to the inductor current?`,
    choices: ['It reaches zero for part of each period (DCM)', 'It keeps the same shape, just lower', 'It becomes negative for part of each period'],
    judge: (_b, a) => (a.mode === 'DCM' ? 0 : a.ilMin < -1e-6 ? 2 : 1),
    rows: ['mode', 'ilAvg', 'ilMin', 'ilPP', 'voutAvg', 'd3'],
    why: (b, a, _p0, p1) => {
      const bd = buckBoundary({ l: p1.l, r: p1.r!, ts: 1 / p1.fs, duty: p1.duty, fs: p1.fs })
      return a.mode === 'DCM'
        ? `The average inductor current fell to ${formatA(a.ilAvg)} while the ripple stays about ${formatA(a.ilPP)}: a triangle that wide cannot stay above zero. When iL reaches zero D1 turns off (it cannot conduct backwards), leaving an idle interval of ${(a.d3 * 100).toFixed(1)} % of the period. Vout rose from ${formatV(b.voutAvg)} to ${formatV(a.voutAvg)}: in DCM the output depends on the load. (Theory: the boundary is R = 2·L·fs/(1 − D) = ${formatSI(bd.rCrit, 'Ω')}.)`
        : `iL,min is now ${formatA(a.ilMin)} — still above zero, so the converter stays in CCM. (Theory: DCM needs R > 2·L·fs/(1 − D) = ${formatSI(bd.rCrit, 'Ω')}.)`
    },
  },
]

/** Prediction tasks: the answer is always the SIMULATION result; the theory is shown afterwards. */
export interface PredictTask {
  id: string
  prompt: string
  params: Partial<ConverterParams>
  kind: 'number' | 'choice'
  unit?: string
  /** Read the true answer from the simulation measurements. */
  answer(m: BuckMeasurements): number
  choices?: string[]
  /** Accepted error (relative) for a number answer. */
  tolerance?: number
  hint: string
}

export function buckPredictTasks(seed: number): PredictTask[] {
  const rnd = mulberry(seed)
  const D = Math.round((0.25 + rnd() * 0.5) * 20) / 20 // 0.25 … 0.75 in steps of 0.05
  const vin = [12, 24, 48][Math.floor(rnd() * 3)]
  const lMul = [0.5, 2, 4][Math.floor(rnd() * 3)]
  const rLight = [3, 6, 24, 48][Math.floor(rnd() * 4)]
  return [
    {
      id: 'vout',
      prompt: `Vin = ${vin} V, D = ${pct(D)}, R = 6 Ω (CCM). What will the simulated average Vout be?`,
      params: { vin, duty: D, r: 6, l: 200e-6 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.voutAvg,
      tolerance: 0.03,
      hint: 'Volt-second balance on the inductor.',
    },
    {
      id: 'ripple',
      prompt: `Defaults (24 V, D = 50 %, 20 kHz) with L = ${formatSI(100e-6 * lMul, 'H')}. Predict the inductor ripple ΔiL (peak-to-peak).`,
      params: { l: 100e-6 * lMul, r: lMul < 1 ? 3 : 6 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ilPP,
      tolerance: 0.05,
      hint: 'During the OFF time vL ≈ −Vout for (1 − D)·Ts.',
    },
    {
      id: 'mode',
      prompt: `Defaults (24 V, D = 50 %, L = 100 µH, 20 kHz) with R = ${rLight} Ω. CCM or DCM?`,
      params: { r: rLight },
      kind: 'choice',
      choices: ['CCM', 'DCM'],
      answer: (m) => (m.mode === 'CCM' ? 0 : 1),
      hint: 'Compare the average inductor current with half the ripple.',
    },
  ]
}

/** Small deterministic PRNG so a task set can be repeated. */
function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Display formatting of a measurement row. */
export const MEASURE_LABEL: Partial<Record<keyof BuckMeasurements, { label: string; fmt: (v: number) => string }>> = {
  voutAvg: { label: 'Vout (average)', fmt: (v) => formatV(v, false) },
  voutPP: { label: 'ΔVout (peak-to-peak)', fmt: (v) => formatSI(v, 'V') },
  ilAvg: { label: 'IL (average)', fmt: (v) => formatA(v) },
  ilPP: { label: 'ΔiL (peak-to-peak)', fmt: (v) => formatA(v) },
  ilMax: { label: 'iL,max', fmt: (v) => formatA(v) },
  ilMin: { label: 'iL,min', fmt: (v) => formatA(v) },
  icRms: { label: 'IC (RMS)', fmt: (v) => formatA(v) },
  d3: { label: 'Idle fraction D3', fmt: (v) => `${(v * 100).toFixed(1)} %` },
}

/** Cursor time [s] for a lesson step position (in the second shown period, away from the run edges). */
export function lessonTime(at: LessonStep['at'], p: { ts: number; duty: number }): number {
  const [part, f] = at
  const u = part === 'on' ? f * p.duty : p.duty + f * (1 - p.duty)
  return (1 + u) * p.ts
}
