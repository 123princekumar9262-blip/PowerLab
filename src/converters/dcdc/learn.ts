import type { LessonCheck } from '../../lab/types.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'
import { resolveConverter } from '../params.ts'
import type { ConverterKind, ConverterParams, ConverterResult } from '../types.ts'
import { voltSecondFromSim, type DcdcState } from './explain.ts'
import type { DcdcMeasurements } from './measure.ts'
import { dcdcBoundary, dcdcTextbook, idealCcmM } from './theory.ts'

/**
 * Boost and buck-boost learning content (the buck's is in buck/learn.ts). Every value in a sentence is
 * read from the simulation; formulas appear only where the content is ABOUT the formula, as theory.
 */

export interface DcdcLessonStep {
  title: string
  params?: Partial<ConverterParams>
  /** Cursor: a fraction of the ON interval or of the OFF part of the period (second shown period). */
  at: ['on' | 'off', number]
  channels: string[]
  body(st: DcdcState, m: DcdcMeasurements, r: ConverterResult): string
  look: string
}
export interface DcdcLesson {
  id: string
  title: string
  summary: string
  base: Partial<ConverterParams>
  steps: DcdcLessonStep[]
  check?: LessonCheck
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`

export const BOOST_LESSONS: DcdcLesson[] = [
  {
    id: 'how',
    title: 'How a boost converter works',
    summary: 'Why the output ends up ABOVE the input: the inductor adds its voltage to Vin.',
    check: {
      question: 'Why is the boost converter’s output above its input?',
      options: ['The capacitor raises the voltage on its own', 'While the switch is OFF the inductor’s voltage adds to Vin', 'The diode amplifies the voltage'],
      answer: 1,
      explain: 'With the switch OFF the inductor keeps its current flowing and its voltage adds to Vin to push it into the output. Volt-second balance gives Vout = Vin/(1 − D).',
    },
    base: {},
    steps: [
      {
        title: 'Switch ON: the inductor charges from Vin',
        at: ['on', 0.5],
        channels: ['gate', 'vsw', 'il'],
        look: 'iL ramps UP while the gate is high; Vsw sits near 0 V.',
        body: (st) =>
          `Q1 ties the switch node to ground (vsw = ${formatV(st.vsw)}), so the whole input appears across the inductor: vL = Vin − vsw = ${formatV(st.vl)}. iL rises (${formatA(st.il)} now) and the magnetic energy EL = ${formatSI(st.el, 'J')} grows. D1 is reverse biased (vD = ${formatV(st.vd)}): the output is cut off, and C alone feeds the load (iC = ${formatA(st.ic, true)}).`,
      },
      {
        title: 'Switch OFF: the inductor pushes into the output',
        at: ['off', 0.03],
        channels: ['gate', 'vsw', 'il', 'id'],
        look: 'At the falling edge iL continues — now through D1 — and Vsw jumps ABOVE Vout.',
        body: (st) =>
          `Q1 opened, but iL = ${formatA(st.il)} cannot stop. The switch node is pushed up until D1 conducts: vsw = ${formatV(st.vsw)}, just above Vout = ${formatV(st.vout)}. Now vL = Vin − vsw = ${formatV(st.vl)} is negative: the inductor's voltage ADDS to the input, and together they drive the output.`,
      },
      {
        title: 'The output current comes in pulses',
        at: ['off', 0.5],
        channels: ['id', 'io', 'ic', 'vout'],
        look: 'iD is a pulse (zero while Q1 is ON); C smooths it into the steady iR.',
        body: (st, m) =>
          `The diode only delivers current while Q1 is OFF; its average is the load current ${formatA(m.idAvg)}. The capacitor charges during the pulses (iC = ${formatA(st.ic, true)} now) and alone feeds the load while Q1 is ON. Output ripple: ${formatSI(m.voutPP, 'V')} peak-to-peak.`,
      },
      {
        title: 'Why Vout = Vin/(1 − D): volt-second balance',
        at: ['on', 0.5],
        channels: ['vsw', 'vl', 'vout'],
        look: 'vL = Vin − vsw: positive while ON, negative while OFF — the areas cancel.',
        body: (_st, m, r) => {
          const vs = voltSecondFromSim(r)
          const p = r.params
          return `In steady state the average inductor voltage is zero (simulated ${formatV(vs.vlAvg)}), so average(vsw) = Vin: simulated ${formatV(vs.vswAvg)}. vsw is ~0 V for D·Ts and ~Vout for (1 − D)·Ts, so (1 − D)·Vout = Vin ⇒ Vout = Vin/(1 − D) = ${formatV(p.vin / (1 - p.duty))} (theory, ideal CCM). The simulation gives ${formatV(m.voutAvg)}.`
        },
      },
      {
        title: 'The input current is continuous',
        at: ['on', 0.5],
        channels: ['iin', 'il', 'iq'],
        look: 'iin = iL: it never drops to zero in CCM — unlike the buck, whose input current is chopped.',
        body: (_st, m) => `The source is in series with the inductor, so the input current IS the inductor current: between ${formatA(m.ilMin)} and ${formatA(m.ilMax)}. A boost draws a smooth current from its source; the switch Q1 carries iL only while it is ON (RMS ${formatA(m.iqRms)}).`,
      },
    ],
  },
  {
    id: 'dcm',
    title: 'Discontinuous conduction in a boost',
    summary: 'Light load: iL reaches zero, the switch node rests at Vin, and Vout climbs above Vin/(1 − D).',
    check: {
      question: 'At light load the boost’s inductor current reaches zero every period. Its output…',
      options: ['is exactly Vin/(1 − D)', 'climbs above Vin/(1 − D)', 'drops below Vin'],
      answer: 1,
      explain: 'In discontinuous conduction each period delivers a fixed parcel of energy, ½·L·i², however little the load takes, so the output climbs above the CCM value Vin/(1 − D).',
    },
    base: { r: 200 },
    steps: [
      {
        title: 'Light load: R = 200 Ω',
        at: ['off', 0.9],
        channels: ['gate', 'il', 'vsw'],
        look: 'iL reaches zero before the period ends; Vsw then rests at Vin.',
        body: (st, m, r) => {
          const b = dcdcBoundary(r.params)
          return `With R = ${formatSI(r.params.r, 'Ω')} the converter is in ${m.mode}. ${st.interval === 'idle' ? `Here iL = 0 and both devices are OFF: vL = 0, so the switch node sits at Vin (vsw = ${formatV(st.vsw)}).` : 'Move the cursor to the end of the period to see the idle interval.'} (Theory: CCM needs L > ${b.lCritFormula.replace('Lcrit = ', '')} = ${formatSI(b.lCrit, 'H')}.)`
        },
      },
      {
        title: 'In DCM the output rises with the load resistance',
        at: ['on', 0.5],
        channels: ['vsw', 'vout'],
        look: 'Vout is well above Vin/(1 − D).',
        body: (_st, m, r) =>
          `The energy taken in each period is ½·L·iL,peak², independent of the load; a lighter load needs a higher voltage to burn it. Simulated Vout = ${formatV(m.voutAvg)} against the CCM value Vin/(1 − D) = ${formatV(r.params.vin / (1 - r.params.duty))}. In DCM the output depends on R, L and fs — which is why a boost needs feedback control.`,
      },
    ],
  },
]

export const BUCK_BOOST_LESSONS: DcdcLesson[] = [
  {
    id: 'how',
    title: 'How an inverting buck-boost works',
    summary: 'The inductor charges from Vin, then discharges into the output with reversed polarity.',
    check: {
      question: 'Why is the output of an inverting buck-boost negative?',
      options: ['The diode reverses the source', 'The inductor discharges into the output with reversed polarity', 'The switch connects the output backwards'],
      answer: 1,
      explain: 'The inductor charges from Vin while Q1 is ON, then pushes the same current up through the output from its negative side: Vout = −D·Vin/(1 − D).',
    },
    base: {},
    steps: [
      {
        title: 'Switch ON: the inductor charges, the output is isolated',
        at: ['on', 0.5],
        channels: ['gate', 'vsw', 'il'],
        look: 'iL ramps UP while Q1 is ON.',
        body: (st) =>
          `Q1 connects the inductor straight across the input: vL = vsw = ${formatV(st.vl)}, and iL rises (${formatA(st.il)}). D1 is reverse biased by Vin + |Vout| (vD = ${formatV(st.vd)}), so nothing reaches the output; C alone feeds the load (iC = ${formatA(st.ic, true)}).`,
      },
      {
        title: 'Switch OFF: the current is pulled out of the output',
        at: ['off', 0.03],
        channels: ['gate', 'vsw', 'il', 'id'],
        look: 'Vsw swings NEGATIVE at turn-off; D1 carries iL.',
        body: (st) =>
          `Q1 opened; iL = ${formatA(st.il)} keeps flowing down through L to ground. The only way back to the top of L is out of the output node through D1, so the switch node drops to vsw = ${formatV(st.vsw)} — below the output (${formatV(st.vout)}). Charge is drawn OUT of the output capacitor's top plate: that is why Vout is negative.`,
      },
      {
        title: 'Why Vout = −D·Vin/(1 − D): volt-second balance',
        at: ['on', 0.5],
        channels: ['vsw', 'vl', 'vout'],
        look: 'vL = vsw: +Vin while ON, ≈ Vout (negative) while OFF.',
        body: (_st, m, r) => {
          const vs = voltSecondFromSim(r)
          const p = r.params
          return `The inductor sits between the switch node and ground, so vL = vsw. Average vL = 0 (simulated ${formatV(vs.vlAvg)}) ⇒ D·Vin + (1 − D)·Vout = 0 ⇒ Vout = −D·Vin/(1 − D) = ${formatV((-p.duty * p.vin) / (1 - p.duty))} (theory, ideal CCM). Simulated: ${formatV(m.voutAvg)}. With D below 50 % it steps down, above 50 % it steps up.`
        },
      },
      {
        title: 'Both currents are pulsed',
        at: ['off', 0.5],
        channels: ['iin', 'id', 'il'],
        look: 'iin flows only while Q1 is ON; iD only while it is OFF.',
        body: (_st, m) => `The source supplies iL only while Q1 conducts (average ${formatA(m.iqAvg)}) and the diode delivers iL only while Q1 is OFF (average ${formatA(m.idAvg)}). Both the input and the output need good capacitors in a real design.`,
      },
    ],
  },
]

const ratio = (a: number, b: number) => (Math.abs(b) > 1e-12 ? a / b : NaN)

export interface DcdcExperiment {
  id: string
  title: string
  change(p: ConverterParams): Partial<ConverterParams>
  question(p: ConverterParams): string
  choices: string[]
  judge(before: DcdcMeasurements, after: DcdcMeasurements): number
  rows: string[]
  why(before: DcdcMeasurements, after: DcdcMeasurements, p0: ConverterParams, p1: ConverterParams): string
}

/** Guided experiments for the boost and the buck-boost. "Vout" means |Vout| for the buck-boost. */
export function dcdcExperiments(kind: ConverterKind): DcdcExperiment[] {
  const V = kind === 'buck-boost' ? '|Vout|' : 'Vout'
  const mag = (x: number) => Math.abs(x)
  const law = kind === 'boost' ? 'Vin/(1 − D)' : 'D·Vin/(1 − D)'
  return [
    {
      id: 'duty',
      title: 'Change the duty ratio',
      change: (p) => ({ duty: Math.min(0.8, Math.round((p.duty + 0.15) * 100) / 100) }),
      question: (p) => `D goes from ${pct(p.duty)} to ${pct(Math.min(0.8, p.duty + 0.15))}. What happens to ${V}?`,
      choices: [`${V} rises`, `${V} falls`, `${V} stays the same`],
      judge: (b, a) => (mag(a.voutAvg) > mag(b.voutAvg) * 1.001 ? 0 : mag(a.voutAvg) < mag(b.voutAvg) * 0.999 ? 1 : 2),
      rows: ['voutAvg', 'ilAvg', 'ilPP', 'voutPP', 'mode'],
      why: (b, a, p0, p1) =>
        `${V} went from ${formatV(mag(b.voutAvg), false)} to ${formatV(mag(a.voutAvg), false)} (×${ratio(mag(a.voutAvg), mag(b.voutAvg)).toFixed(3)}). Q1 now stores energy in L for longer and leaves less time to release it, so the inductor must drive the output harder: ideal CCM ${V} = ${law} goes from ${formatV(mag(idealCcmM(kind, p0.duty)) * p0.vin, false)} to ${formatV(mag(idealCcmM(kind, p1.duty!)) * p1.vin, false)}. The inductor current rose too (${formatA(b.ilAvg)} → ${formatA(a.ilAvg)}): it now carries the output power at a smaller (1 − D).${a.mode !== b.mode ? ` Mode: ${b.mode} → ${a.mode}.` : ''}`,
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
      rows: ['ilPP', 'ilMax', 'ilMin', 'voutAvg', 'mode'],
      why: (b, a) =>
        `ΔiL went from ${formatA(b.ilPP)} to ${formatA(a.ilPP)} (×${ratio(a.ilPP, b.ilPP).toFixed(3)}). While Q1 is ON the inductor sees Vin; diL/dt = Vin/L halves when L doubles. The average current is set by the output power, so it stays: ${formatA(b.ilAvg)} → ${formatA(a.ilAvg)}.${a.mode !== b.mode ? ` Mode: ${b.mode} → ${a.mode}.` : ''}`,
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
      rows: ['voutPP', 'voutAvg', 'icRms'],
      why: (b, a) =>
        `ΔVout went from ${formatSI(b.voutPP, 'V')} to ${formatSI(a.voutPP, 'V')} (×${ratio(a.voutPP, b.voutPP).toFixed(3)}). While Q1 is ON the capacitor alone carries the load current; the same charge on a 4× larger C changes its voltage 4× less. The average output does not depend on C: ${formatV(b.voutAvg)} → ${formatV(a.voutAvg)}.`,
    },
    {
      id: 'frequency',
      title: 'Double the switching frequency',
      change: (p) => ({ fs: Math.min(500e3, p.fs * 2) }),
      question: (p) => `fs goes from ${formatSI(p.fs, 'Hz')} to ${formatSI(Math.min(500e3, p.fs * 2), 'Hz')}. What happens to ΔiL and ΔVout?`,
      choices: ['Both roughly halve', 'Both roughly double', 'Neither changes'],
      judge: (b, a) => {
        const q1 = ratio(a.ilPP, b.ilPP)
        const q2 = ratio(a.voutPP, b.voutPP)
        return q1 < 0.75 && q2 < 0.75 ? 0 : q1 > 1.33 && q2 > 1.33 ? 1 : 2
      },
      rows: ['ilPP', 'voutPP', 'voutAvg', 'mode'],
      why: (b, a) =>
        `ΔiL: ${formatA(b.ilPP)} → ${formatA(a.ilPP)} (×${ratio(a.ilPP, b.ilPP).toFixed(3)}); ΔVout: ${formatSI(b.voutPP, 'V')} → ${formatSI(a.voutPP, 'V')} (×${ratio(a.voutPP, b.voutPP).toFixed(3)}). The ON time halves: the inductor ramps for half as long, and the capacitor feeds the load alone for half as long. D (and so the average output) is unchanged.`,
    },
    {
      id: 'dcm',
      title: 'Lighten the load until DCM',
      change: (p) => ({ r: Math.min(1000, p.r * 4) }),
      question: (p) => `R goes from ${formatSI(p.r, 'Ω')} to ${formatSI(Math.min(1000, p.r * 4), 'Ω')}. What happens to the inductor current?`,
      choices: ['It reaches zero for part of each period (DCM)', 'It keeps the same shape, just lower', 'It becomes negative for part of each period'],
      judge: (_b, a) => (a.mode === 'DCM' ? 0 : a.ilMin < -1e-6 ? 2 : 1),
      rows: ['mode', 'ilAvg', 'ilMin', 'voutAvg', 'd3'],
      why: (b, a, _p0, p1) => {
        const bd = dcdcBoundary({ l: p1.l, r: p1.r!, ts: 1 / p1.fs, duty: p1.duty, fs: p1.fs, kind })
        return a.mode === 'DCM'
          ? `The average inductor current fell to ${formatA(a.ilAvg)} with a ripple of about ${formatA(a.ilPP)}: the triangle reaches zero, D1 turns off, and an idle interval of ${(a.d3 * 100).toFixed(1)} % appears. ${V} rose from ${formatV(mag(b.voutAvg), false)} to ${formatV(mag(a.voutAvg), false)}: in DCM the output depends on the load. (Theory: the boundary is R = 2·L·fs/Kcrit = ${formatSI(bd.rCrit, 'Ω')}.)`
          : `iL,min is now ${formatA(a.ilMin)} — still above zero: CCM. (Theory: DCM needs R > ${formatSI(bd.rCrit, 'Ω')}.)`
      },
    },
  ]
}

export interface DcdcPredictTask {
  id: string
  prompt: string
  params: Partial<ConverterParams>
  kind: 'number' | 'choice'
  unit?: string
  answer(m: DcdcMeasurements): number
  choices?: string[]
  tolerance?: number
  hint: string
  theory(p: ConverterParams): string
}

export function dcdcPredictTasks(kind: ConverterKind, seed: number): DcdcPredictTask[] {
  const rnd = mulberry(seed * 7 + kind.length)
  const D = Math.round((0.25 + rnd() * 0.45) * 20) / 20
  const vin = [6, 12, 24][Math.floor(rnd() * 3)]
  const lMul = [2, 4][Math.floor(rnd() * 2)]
  const rLoad = kind === 'boost' ? [12, 24, 150, 300][Math.floor(rnd() * 4)] : [6, 12, 60, 120][Math.floor(rnd() * 4)]
  const res = (p: Partial<ConverterParams>) => resolveConverter(p, kind).params
  const name = kind === 'boost' ? 'boost' : 'buck-boost'
  return [
    {
      id: 'vout',
      prompt: `${name}: Vin = ${vin} V, D = ${pct(D)}, R = ${kind === 'boost' ? 24 : 12} Ω, L = 1 mH (CCM). What will the simulated average Vout be?`,
      params: { vin, duty: D, l: 1e-3, c: 470e-6 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.voutAvg,
      tolerance: 0.03,
      hint: kind === 'boost' ? 'Volt-second balance: vL = Vin while ON, Vin − Vout while OFF.' : 'Volt-second balance: vL = Vin while ON, Vout while OFF (Vout is negative).',
      theory: (p) => `${dcdcTextbook(res(p)).voutAvg.formula} = ${formatV(dcdcTextbook(res(p)).voutAvg.value ?? NaN, false)}`,
    },
    {
      id: 'ripple',
      prompt: `${name} defaults (12 V, D = 50 %, 20 kHz) with L = ${formatSI(100e-6 * lMul, 'H')}. Predict the inductor ripple ΔiL.`,
      params: { l: 100e-6 * lMul },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ilPP,
      tolerance: 0.05,
      hint: 'While Q1 is ON the inductor sees Vin for D·Ts.',
      theory: (p) => {
        const t = dcdcTextbook(res(p))
        return `${t.ilPP.formula} = ${formatA(t.ilPP.value ?? NaN)}`
      },
    },
    {
      id: 'mode',
      prompt: `${name} defaults (12 V, D = 50 %, L = 100 µH, 20 kHz) with R = ${rLoad} Ω. CCM or DCM?`,
      params: { r: rLoad },
      kind: 'choice',
      choices: ['CCM', 'DCM'],
      answer: (m) => (m.mode === 'CCM' ? 0 : 1),
      hint: 'Compare the average inductor current with half its ripple.',
      theory: (p) => {
        const b = dcdcBoundary(res(p))
        return `CCM while R < Rcrit = 2·L·fs/Kcrit = ${formatSI(b.rCrit, 'Ω')} (${b.lCritFormula})`
      },
    },
  ]
}

function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cursor time [s] for a lesson step position (second shown period, away from the run edges). */
export function dcdcLessonTime(at: DcdcLessonStep['at'], p: { ts: number; duty: number }): number {
  const [part, f] = at
  const u = part === 'on' ? f * p.duty : p.duty + f * (1 - p.duty)
  return (1 + u) * p.ts
}
