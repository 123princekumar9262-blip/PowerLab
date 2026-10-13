import type { Experiment, LessonCheck, PredictTask } from '../../lab/types.ts'
import { formatA, formatSI, formatV, formatW } from '../../utils/format.ts'
import { segmentAverage } from '../engine.ts'
import { coupledName, type BidiState, type CoupledState } from './explain.ts'
import type { BidiMeasurements, BidiRun, CoupledMeasurements, CoupledRun } from './measure.ts'
import { resolveBidi, resolveCoupled, type BidiParams, type CoupledKind, type CoupledParams } from './params.ts'
import { bidiTextbook, coupledBoundary, coupledIdeal, coupledLaw, coupledTextbook, coupledVc1Law } from './theory.ts'

/**
 * Learning content of the advanced converters. Every value in a sentence is read from the simulation;
 * formulas appear only where the content is ABOUT the formula, labelled as theory. Each lesson check has a
 * `confirm` the tests run on the simulation: the right answer must be what the simulated circuit does.
 */

const pct = (x: number) => `${(x * 100).toFixed(0)} %`
const ratio = (a: number, b: number) => (Math.abs(b) > 1e-12 ? a / b : NaN)

export interface CoupledLessonStep {
  title: string
  params?: Partial<CoupledParams>
  /** Cursor: a fraction of the ON interval or of the OFF part of the period (second shown period). */
  at: ['on' | 'off', number]
  channels: string[]
  body(st: CoupledState, m: CoupledMeasurements, r: CoupledRun): string
  look: string
}
export interface CoupledLesson {
  id: string
  title: string
  summary: string
  base: Partial<CoupledParams>
  steps: CoupledLessonStep[]
  check: LessonCheck
  /** The check's answer, confirmed on the simulation of the lesson's base circuit. */
  confirm(m: CoupledMeasurements, r: CoupledRun): boolean
}

export function coupledLessonTime(at: CoupledLessonStep['at'], p: { ts: number; duty: number }): number {
  const [part, f] = at
  const u = part === 'on' ? f * p.duty : p.duty + f * (1 - p.duty)
  return (1 + u) * p.ts
}

const CONTINUITY: Record<CoupledKind, { title: string; look: string; channels: string[]; body: (m: CoupledMeasurements) => string }> = {
  cuk: {
    title: 'Both the input and the output current are continuous',
    look: 'iin (= iL1) and the output current iL2 never drop to zero: no pulsed current on either side.',
    channels: ['iin', 'il2', 'io'],
    body: (m) =>
      `L1 is in series with the source and L2 in series with the output, so the input current swings only between ${formatA(m.il1Min)} and ${formatA(m.il1Max)} and the output inductor current between ${formatA(m.il2Min)} and ${formatA(m.il2Max)}. That is the Ćuk's big advantage: small filters on both sides. The price: the output is inverted and C1 must carry the full energy every period (RMS ripple current in the output capacitor only ${formatA(m.icRms)}).`,
  },
  sepic: {
    title: 'Continuous input current, pulsed output current',
    look: 'iin = iL1 is smooth; the diode current iD is a pulse train, zero while Q1 is ON.',
    channels: ['iin', 'id', 'io'],
    body: (m) =>
      `L1 is in series with the source, so the input current is smooth (${formatA(m.il1Min)} … ${formatA(m.il1Max)}). The output, however, is fed through D1 only while Q1 is OFF (iD peak ${formatA(m.idPeak)}, average ${formatA(m.idAvg)}): like a boost, the output capacitor has to carry a large ripple current (${formatA(m.icRms)} RMS). In exchange the SEPIC keeps the output NON-inverted and can step up or down.`,
  },
  zeta: {
    title: 'Pulsed input current, continuous output current',
    look: 'iin is zero while Q1 is OFF; iL2 (the output current) never stops.',
    channels: ['iin', 'il2', 'io'],
    body: (m) =>
      `Q1 sits in series with the source, so the source current is chopped (it falls to ${formatA(Math.max(0, m.iinMin))} while Q1 is OFF). L2 feeds the output continuously (${formatA(m.il2Min)} … ${formatA(m.il2Max)}), so the output capacitor only smooths a small triangle (${formatA(m.icRms)} RMS) — like a buck. The Zeta is the SEPIC turned around: the same conversion law, the input and output roles exchanged.`,
  },
}

function howLesson(kind: CoupledKind): CoupledLesson {
  const N = coupledName(kind)
  const checks: Record<CoupledKind, { check: LessonCheck; confirm: CoupledLesson['confirm'] }> = {
    cuk: {
      check: {
        question: 'What is the polarity of the Ćuk converter’s output?',
        options: ['The same as the input (positive)', 'Inverted (negative)', 'It alternates every period'],
        answer: 1,
        explain: 'L2 pulls current OUT of the output node through the load: the output is negative. Volt-second balance gives Vout = −D·Vin/(1 − D).',
      },
      confirm: (m) => m.voutAvg < 0 && m.voutMax < 0,
    },
    sepic: {
      check: {
        question: 'In steady state, what is the average voltage on the SEPIC’s coupling capacitor C1?',
        options: ['Vin', 'Vout', 'Vin + Vout'],
        answer: 0,
        explain: 'L1 and L2 both have zero average voltage, and the loop Vin → L1 → C1 → L2 → ground then leaves vC1 = Vin on average.',
      },
      confirm: (m, r) => Math.abs(m.vc1Avg - r.params.vin) < 0.02 * r.params.vin && Math.abs(m.vc1Avg - m.voutAvg) > 0.05 * r.params.vin,
    },
    zeta: {
      check: {
        question: 'Which current of the Zeta converter is continuous (never falls to zero in CCM)?',
        options: ['The input current from the source', 'The output current (through L2)', 'Both'],
        answer: 1,
        explain: 'Q1 is in series with the source, so the input current is chopped; L2 is in series with the output, so the output current is smooth.',
      },
      confirm: (m) => m.il2Min > 0 && m.iinMin < 0.01 * m.il1Avg,
    },
  }
  return {
    id: 'how',
    title: `How the ${N} converter works`,
    summary:
      kind === 'cuk'
        ? 'Two inductors, one switch and a coupling capacitor that ferries the energy: an inverted output with smooth currents on both sides.'
        : kind === 'sepic'
          ? 'A boost-like input, a coupling capacitor and a second inductor: a non-inverted output above OR below the input.'
          : 'A buck-like output, a coupling capacitor and a second inductor: a non-inverted output above OR below the input.',
    // D = 60 %: a step-up point where Vin, |Vout| and VC1 all differ, so each relation can be told apart
    base: { duty: 0.6 },
    ...checks[kind],
    steps: [
      {
        title: 'Switch ON: both inductors charge',
        at: ['on', 0.5],
        channels: ['gate', 'il1', 'il2'],
        look: 'iL1 and iL2 ramp UP together while the gate is high.',
        body: (st) =>
          `Q1 is ON and carries the sum of both inductor currents: ${formatA(st.iq)}. L1 sees vL1 = ${formatV(st.vl1)} and L2 sees vL2 = ${formatV(st.vl2)} — both about +Vin — so both currents rise (iL1 = ${formatA(st.il1)}, iL2 = ${formatA(st.il2)}). D1 is reverse biased (vD = ${formatV(st.vd)}).`,
      },
      {
        title: 'Switch OFF: the diode carries iL1 + iL2',
        at: ['off', 0.1],
        channels: ['gate', 'il1', 'il2', 'id'],
        look: 'At the falling edge both currents continue — now through D1 — and both ramp DOWN.',
        body: (st) =>
          `Q1 opened, but neither inductor current can stop: their only path is D1, which now carries iD = iL1 + iL2 = ${formatA(st.id)}. Both inductors see about −|Vout| (vL1 = ${formatV(st.vl1)}, vL2 = ${formatV(st.vl2)}) and give energy away.`,
      },
      {
        title: 'The coupling capacitor ferries the energy',
        at: ['off', 0.5],
        channels: ['vc1', 'ic1'],
        look: 'vC1 is almost constant: it rises a little while Q1 is OFF and falls while Q1 is ON.',
        body: (st, m, r) =>
          `C1 holds ${formatV(m.vc1Avg, false)} on average (theory: ${coupledVc1Law(kind)} = ${formatV(coupledIdeal(r.params).v1, false)}). While Q1 is OFF it is charged through L1 (iC1 = ${formatA(st.ic1, true)} now); while Q1 is ON it is discharged into L2. Its ripple is only ${formatV(m.vc1PP, false)}: the charge in and the charge out are equal every period.`,
      },
      {
        title: `Why ${coupledLaw(kind)}`,
        at: ['on', 0.5],
        channels: ['vl1', 'vl2', 'vout'],
        look: 'vL1 and vL2: about +Vin for D·Ts, about −|Vout| for (1 − D)·Ts — the areas cancel.',
        body: (_st, m, r) => {
          const p = r.params
          const vl1 = segmentAverage(r, 'vl1')
          const vl2 = segmentAverage(r, 'vl2')
          return `In steady state each inductor's average voltage is zero (simulated ${formatV(vl1)} and ${formatV(vl2)}). Both see +Vin for D·Ts and −|Vout| for (1 − D)·Ts, so D·Vin = (1 − D)·|Vout| ⇒ ${coupledLaw(kind)} = ${formatV(coupledIdeal(p).vout)} (theory, ideal CCM). The simulation gives ${formatV(m.voutAvg)}. Below D = 50 % it steps down, above it steps up.`
        },
      },
      { ...CONTINUITY[kind], at: ['on', 0.5], body: (_st, m) => CONTINUITY[kind].body(m) },
    ],
  }
}

function dcmLesson(kind: CoupledKind): CoupledLesson {
  const N = coupledName(kind)
  return {
    id: 'dcm',
    title: `Light load: discontinuous conduction in a ${N}`,
    summary: 'The DIODE current reaches zero — but the two inductor currents keep circulating through C1.',
    base: { r: 60 },
    check: {
      question: `At light load the ${N} enters DCM. What reaches zero in every period?`,
      options: ['Both inductor currents', 'Only the diode current iL1 + iL2 — the inductor currents keep circulating', 'Nothing: a fourth-order converter has no DCM'],
      answer: 1,
      explain: 'When iL1 + iL2 reaches zero the diode turns off, but L1 and L2 form one series loop through C1 and their (opposite) currents keep flowing until Q1 turns on again.',
    },
    confirm: (m) => m.mode === 'DCM' && m.d3 > 0.02 && Math.abs(m.idleCurrent) > 0.02 * Math.max(m.il1Avg, m.il2Avg),
    steps: [
      {
        title: 'Light load: R = 60 Ω',
        at: ['off', 0.95],
        channels: ['il1', 'il2', 'id'],
        look: 'iD reaches zero before the period ends; iL1 and iL2 then stay constant at equal and opposite values.',
        body: (st, m, r) => {
          const b = coupledBoundary(r.params)
          return `With R = ${formatSI(r.params.r, 'Ω')} the converter is in ${m.mode}. ${st.interval === 'idle' ? `Here Q1 and D1 are both OFF: iD = iL1 + iL2 = ${formatA(st.il1 + st.il2, true)}, yet iL1 = ${formatA(st.il1, true)} and iL2 = ${formatA(st.il2, true)} still flow — around the loop through C1.` : 'Move the cursor to the end of the period to see the idle interval.'} (Theory: CCM needs Le = L1‖L2 > (1 − D)²·R/(2·fs) = ${formatSI(b.leCrit, 'H')}; here Le = ${formatSI(b.le, 'H')}.)`
        },
      },
      {
        title: 'The output rises with the load resistance',
        at: ['on', 0.5],
        channels: ['vout'],
        look: `|Vout| is well above the CCM value.`,
        body: (_st, m, r) => {
          const tb = coupledTextbook(r.params)
          return `Each period delivers a fixed parcel of energy, so a lighter load needs a higher voltage to absorb it: simulated Vout = ${formatV(m.voutAvg)} against the CCM law ${formatV(coupledIdeal(r.params).vout)}. The DCM relation (theory) ${tb.voutAvg.formula} gives ${formatV(tb.voutAvg.value ?? NaN)}. Idle fraction D3 = ${pct(m.d3)}.`
        },
      },
      {
        title: 'C1 still follows its law',
        at: ['off', 0.95],
        channels: ['vc1', 'vout'],
        look: 'vC1 stays at its average even in DCM.',
        body: (_st, m) => `The circulating loop current stays constant only if the loop voltage averages to zero, so C1 still settles at ${coupledVc1Law(kind)}: simulated ${formatV(m.vc1Avg, false)} with the output at ${formatV(m.voutAvg)}.`,
      },
    ],
  }
}

export const COUPLED_LESSONS: Record<CoupledKind, CoupledLesson[]> = {
  cuk: [howLesson('cuk'), dcmLesson('cuk')],
  sepic: [howLesson('sepic'), dcmLesson('sepic')],
  zeta: [howLesson('zeta'), dcmLesson('zeta')],
}

export function coupledExperiments(kind: CoupledKind): Array<Experiment<CoupledParams, CoupledMeasurements>> {
  const V = kind === 'cuk' ? '|Vout|' : 'Vout'
  const mag = Math.abs
  return [
    {
      id: 'duty',
      title: 'Raise the duty ratio',
      change: (p) => ({ duty: Math.min(0.85, Math.round((p.duty + 0.15) * 100) / 100) }),
      question: (p) => `D goes from ${pct(p.duty)} to ${pct(Math.min(0.85, p.duty + 0.15))}. What happens to ${V}?`,
      choices: [`${V} rises`, `${V} falls`, `${V} stays the same`],
      judge: (b, a) => (mag(a.voutAvg) > mag(b.voutAvg) * 1.001 ? 0 : mag(a.voutAvg) < mag(b.voutAvg) * 0.999 ? 1 : 2),
      rows: ['voutAvg', 'vc1Avg', 'il1Avg', 'il2Avg', 'mode'],
      why: (b, a, p0, p1) =>
        `${V} went from ${formatV(mag(b.voutAvg), false)} to ${formatV(mag(a.voutAvg), false)}. Q1 now charges both inductors for longer and leaves less time to release the energy, so the output must rise: ideal CCM ${coupledLaw(kind)} goes from ${formatV(mag(coupledIdeal({ kind, vin: p0.vin, duty: p0.duty, r: p0.r }).vout), false)} to ${formatV(mag(coupledIdeal({ kind, vin: p1.vin, duty: p1.duty, r: p1.r }).vout), false)}. C1 follows: ${formatV(b.vc1Avg, false)} → ${formatV(a.vc1Avg, false)}.${a.mode !== b.mode ? ` Mode: ${b.mode} → ${a.mode}.` : ''}`,
    },
    {
      id: 'l2',
      title: 'Double the output-side inductor L2',
      change: (p) => ({ l2: p.l2 * 2 }),
      question: (p) => `L2 goes from ${formatSI(p.l2, 'H')} to ${formatSI(p.l2 * 2, 'H')}. What happens to the two ripples ΔiL1 and ΔiL2?`,
      choices: ['Only ΔiL2 roughly halves', 'Both roughly halve', 'Neither changes'],
      judge: (b, a) => {
        const q1 = ratio(a.il1PP, b.il1PP)
        const q2 = ratio(a.il2PP, b.il2PP)
        return q2 < 0.75 && q1 > 0.9 ? 0 : q2 < 0.75 && q1 < 0.75 ? 1 : 2
      },
      rows: ['il1PP', 'il2PP', 'il2Avg', 'voutAvg', 'mode'],
      why: (b, a) =>
        `ΔiL2: ${formatA(b.il2PP)} → ${formatA(a.il2PP)} (×${ratio(a.il2PP, b.il2PP).toFixed(3)}); ΔiL1: ${formatA(b.il1PP)} → ${formatA(a.il1PP)} (×${ratio(a.il1PP, b.il1PP).toFixed(3)}). Each inductor sees the same voltage as before (≈ Vin while Q1 is ON), so only the slope of the larger inductor halves. Averages are set by the power, not by L: IL2 ${formatA(b.il2Avg)} → ${formatA(a.il2Avg)}.`,
    },
    {
      id: 'c1',
      title: 'Double the coupling capacitor C1',
      change: (p) => ({ c1: p.c1 * 2 }),
      question: (p) => `C1 goes from ${formatSI(p.c1, 'F')} to ${formatSI(p.c1 * 2, 'F')}. What happens to the ripple on C1?`,
      choices: ['It roughly halves', 'It roughly doubles', 'It stays the same'],
      judge: (b, a) => {
        const q = ratio(a.vc1PP, b.vc1PP)
        return q < 0.75 ? 0 : q > 1.33 ? 1 : 2
      },
      rows: ['vc1PP', 'vc1Avg', 'voutAvg'],
      why: (b, a) =>
        `ΔVC1: ${formatV(b.vc1PP, false)} → ${formatV(a.vc1PP, false)} (×${ratio(a.vc1PP, b.vc1PP).toFixed(3)}). C1 receives the same charge every period (iL2 for D·Ts); on twice the capacitance it moves the voltage half as much. Its average stays: ${formatV(b.vc1Avg, false)} → ${formatV(a.vc1Avg, false)} (${coupledVc1Law(kind)}).`,
    },
    {
      id: 'dcm',
      title: 'Lighten the load until DCM',
      change: (p) => ({ r: Math.min(1000, p.r * 5) }),
      question: (p) => `R goes from ${formatSI(p.r, 'Ω')} to ${formatSI(Math.min(1000, p.r * 5), 'Ω')}. What happens to the currents?`,
      choices: ['The diode current iL1 + iL2 reaches zero; the inductor currents keep circulating', 'Both inductor currents reach zero each period', 'Nothing changes: still CCM'],
      judge: (_b, a) => (a.mode === 'DCM' ? (Math.abs(a.idleCurrent) > 1e-3 ? 0 : 1) : 2),
      rows: ['mode', 'd3', 'il1Min', 'il2Min', 'voutAvg'],
      why: (b, a, _p0, p1) => {
        const bd = coupledBoundary({ l1: p1.l1, l2: p1.l2, r: p1.r, fs: p1.fs, duty: p1.duty })
        return a.mode === 'DCM'
          ? `An idle interval of ${pct(a.d3)} appeared: iL1 + iL2 reaches zero and D1 turns off, but the loop current through L1, C1 and L2 is ${formatA(Math.abs(a.idleCurrent))} — not zero. ${V} rose from ${formatV(mag(b.voutAvg), false)} to ${formatV(mag(a.voutAvg), false)}. (Theory: the boundary is R = 2·Le·fs/(1 − D)² = ${formatSI(bd.rCrit, 'Ω')}.)`
          : `Still CCM (theory: DCM needs R > ${formatSI(bd.rCrit, 'Ω')}).`
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

export function coupledPredictTasks(kind: CoupledKind, seed: number): Array<PredictTask<CoupledParams, CoupledMeasurements>> {
  const rnd = mulberry(seed * 13 + kind.length * 7)
  const D = Math.round((0.3 + rnd() * 0.4) * 20) / 20
  const vin = [6, 12, 24][Math.floor(rnd() * 3)]
  const lMul = [1, 2, 4][Math.floor(rnd() * 3)]
  const rLoad = [6, 12, 48, 120][Math.floor(rnd() * 4)]
  const N = coupledName(kind)
  const res = (p: Partial<CoupledParams>) => resolveCoupled(p, kind).params
  return [
    {
      id: 'vout',
      prompt: `${N}: Vin = ${vin} V, D = ${pct(D)}, R = 12 Ω, L1 = L2 = 1 mH (CCM). What will the simulated average Vout be?`,
      params: { vin, duty: D, l1: 1e-3, l2: 1e-3 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.voutAvg,
      tolerance: 0.03,
      hint: 'Volt-second balance on either inductor: +Vin for D·Ts, −|Vout| for (1 − D)·Ts.',
      theory: (p) => {
        const t = coupledTextbook(res(p))
        return `${t.voutAvg.formula} = ${formatV(t.voutAvg.value ?? NaN)}`
      },
    },
    {
      id: 'vc1',
      prompt: `${N}: Vin = ${vin} V, D = ${pct(D)}, R = 12 Ω, L1 = L2 = 1 mH (CCM). What will the average voltage on the coupling capacitor C1 be?`,
      params: { vin, duty: D, l1: 1e-3, l2: 1e-3 },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vc1Avg,
      tolerance: 0.03,
      hint: 'Walk around a loop that contains C1 and only inductors (average voltage 0) and sources.',
      theory: (p) => {
        const t = coupledTextbook(res(p))
        return `${t.vc1Avg.formula} = ${formatV(t.vc1Avg.value ?? NaN, false)}`
      },
    },
    {
      id: 'ripple',
      prompt: `${N} defaults (12 V, D = 50 %, 20 kHz) with L1 = ${formatSI(100e-6 * lMul, 'H')}. Predict the input-inductor ripple ΔiL1.`,
      params: { l1: 100e-6 * lMul, l2: 400e-6 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.il1PP,
      tolerance: 0.05,
      hint: 'While Q1 is ON, L1 sees Vin for D·Ts.',
      theory: (p) => {
        const t = coupledTextbook(res(p))
        return `${t.il1PP.formula} = ${formatA(t.il1PP.value ?? NaN)}`
      },
    },
    {
      id: 'mode',
      prompt: `${N} defaults (12 V, D = 50 %, L1 = L2 = 200 µH, 20 kHz) with R = ${rLoad} Ω. CCM or DCM?`,
      params: { r: rLoad },
      kind: 'choice',
      choices: ['CCM', 'DCM'],
      answer: (m) => (m.mode === 'CCM' ? 0 : 1),
      hint: 'The diode carries iL1 + iL2: compare its average with half its ripple. Le = L1‖L2 acts like the buck-boost’s L.',
      theory: (p) => {
        const b = coupledBoundary(res(p))
        return `CCM while R < Rcrit = 2·Le·fs/(1 − D)² = ${formatSI(b.rCrit, 'Ω')} (Le = L1‖L2 = ${formatSI(b.le, 'H')})`
      },
    },
  ]
}

// ── Bidirectional ─────────────────────────────────────────────────────────────────────────────────────

export interface BidiLessonStep {
  title: string
  params?: Partial<BidiParams>
  /** Cursor: a fraction of the Q1 interval or of the Q2 interval (second shown period). */
  at: ['q1' | 'q2', number]
  channels: string[]
  body(st: BidiState, m: BidiMeasurements, r: BidiRun): string
  look: string
}
export interface BidiLesson {
  id: string
  title: string
  summary: string
  base: Partial<BidiParams>
  steps: BidiLessonStep[]
  check: LessonCheck
  /** The check's answer on the simulation: run with these parameters (on top of the base). */
  confirmParams: Partial<BidiParams>
  confirm(m: BidiMeasurements, r: BidiRun): boolean
}

export function bidiLessonTime(at: BidiLessonStep['at'], p: { ts: number; d: number; deadTime: number }): number {
  const [part, f] = at
  const a = part === 'q1' ? p.deadTime : p.d * p.ts + p.deadTime
  const b = part === 'q1' ? p.d * p.ts : p.ts
  return p.ts + a + f * (b - a)
}

export const BIDI_LESSONS: BidiLesson[] = [
  {
    id: 'how',
    title: 'One half-bridge, two directions',
    summary: 'The same two switches charge the battery from the bus (buck) or return its energy to the bus (boost): only the sign of the inductor current changes.',
    base: {},
    check: {
      question: 'In BOOST mode (battery → bus), which way does the average inductor current flow?',
      options: ['Toward the battery, as in buck mode', 'Toward the bus: iL is negative', 'It alternates every half period, averaging zero'],
      answer: 1,
      explain: 'The circuit is the same; to send power to the bus the average inductor current reverses, and the switches conduct it in the other direction.',
    },
    confirmParams: { dir: 'boost' },
    confirm: (m) => m.ilAvg < 0 && m.ilMax < 0 && m.phvAvg < 0,
    steps: [
      {
        title: 'Buck mode, Q1 ON: the bus drives iL up',
        at: ['q1', 0.5],
        channels: ['gate1', 'gate2', 'il', 'vsw'],
        look: 'While Q1 is ON the switch node sits at the bus voltage and iL ramps UP.',
        body: (st) =>
          `Q1 ties the switch node to the bus: vsw = ${formatV(st.vsw)}. The inductor sees vL = vsw − vLV = ${formatV(st.vl)}, so iL rises (${formatA(st.il, true)} now, toward the battery). The bus supplies ${formatW(st.phv)} at this instant.`,
      },
      {
        title: 'Buck mode, Q2 ON: synchronous freewheeling',
        at: ['q2', 0.5],
        channels: ['gate1', 'gate2', 'il', 'iq2'],
        look: 'iL keeps flowing toward the battery — through Q2, backwards.',
        body: (st) =>
          `Q1 is OFF and Q2 is ON. iL = ${formatA(st.il, true)} still flows toward the battery, so it must come up from ground through Q2: iQ2 = ${formatA(st.iq2, true)} (negative = from source to drain). A MOSFET channel conducts both ways, so Q2 replaces the buck's diode with a smaller voltage drop. vL = ${formatV(st.vl)}: iL falls.`,
      },
      {
        title: 'Buck mode: power flows bus → battery',
        at: ['q2', 0.5],
        channels: ['phv', 'plv'],
        look: 'The bus power is a pulse train (only while Q1 is ON); the battery receives a steady power.',
        body: (_st, m, r) =>
          `Averages (SIMULATION): the bus delivers ${formatW(m.phvAvg)}, the battery terminals receive ${formatW(m.plvAvg)} (efficiency ${(m.efficiency * 100).toFixed(2)} %). Battery current ${formatA(m.ibAvg, true)} for a reference of ${formatA(r.params.irefSigned, true)}. Power balance: IHV = ${formatA(m.ihvAvg, true)} ≈ D·IL = ${formatA(r.params.d * m.ilAvg, true)}.`,
      },
      {
        title: 'Boost mode, Q2 ON: the battery charges the inductor',
        params: { dir: 'boost' },
        at: ['q2', 0.5],
        channels: ['gate1', 'gate2', 'il', 'vsw'],
        look: 'Now iL is NEGATIVE (toward the bus) and grows in magnitude while Q2 is ON.',
        body: (st, _m, r) =>
          `Same circuit, reference reversed: the controller lowers D to ${(r.params.d * 100).toFixed(2)} %. With Q2 ON the switch node is at ground, so the battery drives current through L into Q2: iL = ${formatA(st.il, true)}, its magnitude growing (vL = ${formatV(st.vl)}). The inductor stores energy taken from the battery.`,
      },
      {
        title: 'Boost mode, Q1 ON: the inductor pushes energy into the bus',
        params: { dir: 'boost' },
        at: ['q1', 0.5],
        channels: ['il', 'iq1', 'phv'],
        look: 'Q1 carries iL BACKWARDS into the bus: the bus power is negative (the bus absorbs).',
        body: (st, m) =>
          `With Q1 ON the negative iL = ${formatA(st.il, true)} flows up through Q1 into the bus (iQ1 = ${formatA(st.iq1, true)}). The bus power is ${formatW(st.phv)} now and ${formatW(m.phvAvg)} on average: energy flows from the battery (${formatW(m.pbatAvg)} from its EMF) into the bus. Power reversed, same switches.`,
      },
    ],
  },
  {
    id: 'duty',
    title: 'The duty decides the direction',
    summary: 'The average switch-node voltage D·VHV against the battery EMF decides which way the current flows — and at balance iL swings through zero without any discontinuous mode.',
    base: { control: 'duty' },
    check: {
      question: 'With D·VHV equal to the battery EMF, what does the inductor current do?',
      options: ['It stays at zero (discontinuous conduction)', 'It swings positive and negative around zero every period', 'It flows only toward the battery'],
      answer: 1,
      explain: 'The average current is zero, but complementary switches conduct in both directions, so the triangle of iL simply crosses zero twice per period — there is no DCM.',
    },
    confirmParams: { duty: 0.5 },
    confirm: (m) => m.reverses && Math.abs(m.ilAvg) < 0.1 * m.ilPP,
    steps: [
      {
        title: 'D slightly above Eb/VHV: charging',
        params: { duty: 0.52 },
        at: ['q1', 0.5],
        channels: ['il', 'vlv'],
        look: 'iL is positive on average.',
        body: (_st, m, r) => `D = ${pct(r.params.d)}: the switch node averages ${formatV(m.vswAvg, false)}, above the battery EMF ${formatV(r.params.eb, false)}. The difference drives an average battery current of ${formatA(m.ibAvg, true)} (charging) through Rb = ${formatSI(r.params.rb, 'Ω')}.`,
      },
      {
        title: 'D slightly below Eb/VHV: discharging',
        params: { duty: 0.48 },
        at: ['q1', 0.5],
        channels: ['il', 'vlv'],
        look: 'The same circuit with 4 % less duty: iL is negative on average.',
        body: (_st, m, r) => `D = ${pct(r.params.d)}: the switch node averages ${formatV(m.vswAvg, false)}, BELOW the battery EMF. The battery now pushes current back: ${formatA(m.ibAvg, true)}, and ${formatW(-m.phvAvg)} flows into the bus. Nothing in the circuit changed but D.`,
      },
      {
        title: 'At balance: iL swings through zero',
        params: { duty: 0.5 },
        at: ['q2', 0.5],
        channels: ['il', 'gate1', 'gate2'],
        look: 'iL is a triangle centred on zero: it changes sign twice every period, with no flat zero interval.',
        body: (_st, m) =>
          `D·VHV equals Eb: the average current is ${formatA(m.ilAvg, true)}, but iL swings between ${formatA(m.ilMin, true)} and ${formatA(m.ilMax, true)}. A diode converter would enter DCM here; with two active switches the current simply reverses, so the converter stays in "continuous" conduction at any load.`,
      },
    ],
  },
]

export function bidiExperiments(): Array<Experiment<BidiParams, BidiMeasurements>> {
  return [
    {
      id: 'reverse',
      title: 'Reverse the power direction',
      change: (p) => ({ dir: p.dir === 'buck' ? 'boost' : 'buck' }),
      question: (p) => `The direction goes from ${p.dir} to ${p.dir === 'buck' ? 'boost' : 'buck'} (same current magnitude). What happens?`,
      choices: ['The inductor current and the bus power both change sign', 'Only the bus power changes sign; iL keeps its direction', 'Nothing: the circuit can only work one way'],
      judge: (b, a) => (Math.sign(a.ilAvg) !== Math.sign(b.ilAvg) && Math.sign(a.phvAvg) !== Math.sign(b.phvAvg) ? 0 : Math.sign(a.phvAvg) !== Math.sign(b.phvAvg) ? 1 : 2),
      rows: ['ilAvg', 'ibAvg', 'phvAvg', 'plvAvg', 'dutyMeasured'],
      why: (b, a, p0, p1) => {
        const d0 = resolveBidi(p0).params.d
        const d1 = resolveBidi(p1).params.d
        return `iL: ${formatA(b.ilAvg, true)} → ${formatA(a.ilAvg, true)}; bus power ${formatW(b.phvAvg)} → ${formatW(a.phvAvg)}. The controller only moved D from ${(d0 * 100).toFixed(2)} % to ${(d1 * 100).toFixed(2)} %: the average switch-node voltage went from above to below the battery EMF, and the same switches now carry the current the other way.`
      },
    },
    {
      id: 'deadtime',
      title: 'Add a dead time',
      change: () => ({ deadTime: 0.25e-6 }),
      question: (p) => `In ${p.dir} mode a dead time of 0.25 µs is added after each gate edge (the duty command is unchanged). What happens to the size of the battery current?`,
      choices: ['It falls', 'It rises', 'It stays the same'],
      judge: (b, a) => (Math.abs(a.ibAvg) < Math.abs(b.ibAvg) * 0.98 ? 0 : Math.abs(a.ibAvg) > Math.abs(b.ibAvg) * 1.02 ? 1 : 2),
      rows: ['ibAvg', 'vswAvg', 'diodeFraction', 'efficiency'],
      why: (b, a, p0) =>
        `|Ib|: ${formatA(Math.abs(b.ibAvg))} → ${formatA(Math.abs(a.ibAvg))}. During each dead time a diode carries iL, and WHICH diode depends on the current direction: ${p0.dir === 'buck' ? 'with iL toward the battery, D2 conducts and the switch node sits at ground instead of the bus at the start of each Q1 pulse' : 'with iL toward the bus, D1 conducts and the switch node sits at the bus instead of ground at the start of each Q2 interval'}. The average switch-node voltage moved ${formatV(b.vswAvg, false)} → ${formatV(a.vswAvg, false)} — toward the battery EMF, so the current shrinks. Diodes now conduct ${pct(a.diodeFraction)} of the time.`,
    },
    {
      id: 'inductor',
      title: 'Halve the inductance',
      change: (p) => ({ l: p.l / 2 }),
      question: (p) => `L goes from ${formatSI(p.l, 'H')} to ${formatSI(p.l / 2, 'H')}. What happens to the ripple ΔiL and the average current?`,
      choices: ['ΔiL roughly doubles; the average stays', 'Both double', 'ΔiL halves; the average stays'],
      judge: (b, a) => {
        const q = ratio(a.ilPP, b.ilPP)
        const qa = ratio(a.ilAvg, b.ilAvg)
        return q > 1.5 && Math.abs(qa - 1) < 0.05 ? 0 : q > 1.5 && qa > 1.5 ? 1 : 2
      },
      rows: ['ilPP', 'ilMax', 'ilMin', 'ilAvg'],
      why: (b, a) => `ΔiL: ${formatA(b.ilPP)} → ${formatA(a.ilPP)} (×${ratio(a.ilPP, b.ilPP).toFixed(3)}); the average: ${formatA(b.ilAvg, true)} → ${formatA(a.ilAvg, true)}. The slope vL/L doubles; the average is set by D·VHV against the battery, not by L.${a.reverses && !b.reverses ? ' The larger ripple now takes iL through zero every period — still no DCM.' : ''}`,
    },
    {
      id: 'duty',
      title: 'Raise the duty by 2 %',
      change: (p) => ({ control: 'duty', duty: Math.round((resolveBidi(p).params.d + 0.02) * 1e4) / 1e4 }),
      question: () => 'The current controller is switched off and D is raised by 2 percentage points by hand. What happens to the battery current?',
      choices: ['It rises by several amperes', 'It rises by a few milliamperes', 'It does not change'],
      judge: (b, a) => (a.ibAvg - b.ibAvg > 1 ? 0 : a.ibAvg - b.ibAvg > 1e-4 ? 1 : 2),
      rows: ['ibAvg', 'vlvAvg', 'vswAvg'],
      why: (b, a, p0) =>
        `Ib: ${formatA(b.ibAvg, true)} → ${formatA(a.ibAvg, true)}. 2 % of ${formatV(p0.vhv, false)} is ${formatV(0.02 * p0.vhv, false)} more on the average switch node; over Rb + DCR + Ron (${formatSI(p0.rb + p0.rl + resolveBidi(p0).params.q.ron, 'Ω')}) that is ${formatA((0.02 * p0.vhv) / (p0.rb + p0.rl + resolveBidi(p0).params.q.ron))}. A battery is a stiff voltage: the converter controls its CURRENT through a tiny voltage difference.`,
    },
  ]
}

export function bidiPredictTasks(seed: number): Array<PredictTask<BidiParams, BidiMeasurements>> {
  const rnd = mulberry(seed * 31 + 5)
  const dPick = [0.44, 0.46, 0.54, 0.56][Math.floor(rnd() * 4)]
  const iref = [3, 5, 8][Math.floor(rnd() * 3)]
  const lMul = [0.5, 1, 2][Math.floor(rnd() * 3)]
  const res = (p: Partial<BidiParams>) => resolveBidi(p).params
  return [
    {
      id: 'direction',
      prompt: `Bus 48 V, battery EMF 24 V. The duty is set by hand to D = ${pct(dPick)}. Which way does the power flow?`,
      params: { control: 'duty', duty: dPick },
      kind: 'choice',
      choices: ['Bus → battery (buck)', 'Battery → bus (boost)'],
      answer: (m) => (m.phvAvg >= 0 ? 0 : 1),
      hint: 'Compare the average switch-node voltage D·VHV with the battery EMF.',
      theory: (p) => {
        const r = res(p)
        return `D·VHV = ${formatV(r.d * r.vhv, false)} ${r.d * r.vhv > r.eb ? '>' : '<'} Eb = ${formatV(r.eb, false)} ⇒ ${r.d * r.vhv > r.eb ? 'buck (charging)' : 'boost (discharging)'}`
      },
    },
    {
      id: 'ihv',
      prompt: `Buck mode, the battery charged at ${iref} A (bus 48 V, battery 24 V, Rb = 0.1 Ω). Predict the average current drawn from the bus.`,
      params: { dir: 'buck', iref },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ihvAvg,
      tolerance: 0.03,
      hint: 'Power balance: VHV·IHV = VLV·IL (lossless), with VLV = Eb + Rb·Ib.',
      theory: (p) => {
        const t = bidiTextbook(res(p))
        return `${t.ihvAvg.formula} = ${formatA(t.ihvAvg.value ?? NaN)}`
      },
    },
    {
      id: 'ripple',
      prompt: `Default circuit (bus 48 V, D ≈ 51 %, 20 kHz) with L = ${formatSI(200e-6 * lMul, 'H')}. Predict the inductor ripple ΔiL.`,
      params: { l: 200e-6 * lMul },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ilPP,
      tolerance: 0.05,
      hint: 'While Q1 is ON the inductor sees VHV − VLV for D·Ts.',
      theory: (p) => {
        const t = bidiTextbook(res(p))
        return `${t.ilPP.formula} = ${formatA(t.ilPP.value ?? NaN)}`
      },
    },
    {
      id: 'ib',
      prompt: `Duty set by hand to D = 52 % (bus 48 V, battery 24 V behind Rb = 0.1 Ω, ideal switches). Predict the average battery current.`,
      params: { control: 'duty', duty: 0.52 },
      kind: 'number',
      unit: 'A',
      answer: (m) => m.ibAvg,
      tolerance: 0.05,
      hint: 'The average switch-node voltage is D·VHV; the battery sees it through Rb.',
      theory: (p) => {
        const t = bidiTextbook(res(p))
        return `${t.ibAvg.formula.replace('Ib = IL', 'Ib = IL = (D·VHV − Eb)/(Rb + DCR + Ron)')} = ${formatA(t.ibAvg.value ?? NaN, true)}`
      },
    },
  ]
}
