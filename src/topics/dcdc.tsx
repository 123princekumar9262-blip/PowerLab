import { DcdcDiagram } from '../components/dcdc/DcdcDiagram.tsx'
import { DcdcBadge, DcdcEnergy, DcdcStress, DcdcSweep, DcdcTheory, dcdcInspect } from '../components/dcdc/DcdcViews.tsx'
import { BUCK_EXPERIMENTS, BUCK_LESSONS, buckPredictTasks } from '../converters/buck/learn.ts'
import { compareDcdc } from '../converters/dcdc/compare.ts'
import { dcdcEnergy, dcdcNext, dcdcNextConsequence, dcdcStateAt, dcdcStatus, dcdcWhy, eventLabel, eventWhy, formatSlopeA, formatSlopeV, INTERVAL_NAME, type DcdcState } from '../converters/dcdc/explain.ts'
import { BOOST_LESSONS, BUCK_BOOST_LESSONS, dcdcExperiments, dcdcLessonTime, dcdcPredictTasks, type DcdcLesson } from '../converters/dcdc/learn.ts'
import { measureDcdc, type DcdcMeasurements } from '../converters/dcdc/measure.ts'
import { dcdcModel } from '../converters/dcdc/model.ts'
import { dcdcBoundary, dcdcTextbook } from '../converters/dcdc/theory.ts'
import { simulateCircuit } from '../converters/engine.ts'
import { BUCK_LIMITS, DCDC_DEFAULTS, resolveConverter } from '../converters/params.ts'
import type { ConverterKind, ConverterParams, ConverterResult } from '../converters/types.ts'
import type { AnalysisCategory, ChannelMeta, Experiment, InspectInfo, Lesson, MeasureLabel, ParamSpec, PredictTask, StateRow, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import { dcdcReadings } from './readings.ts'

/**
 * Converter channels. Colour follows the ENTITY: switch Q1 blue, diode D1 green, inductor red,
 * capacitor violet, output orange, load current aqua, gate neutral. Validated (dataviz validator,
 * dark surface #0e1217): the default current group iL/iQ/iD passes all-pairs; the remaining close
 * pairs always carry a dash pattern and a direct label (secondary encoding).
 */
export const DCDC_CHANNELS: Record<string, ChannelMeta> = {
  gate: { id: 'gate', label: 'Gate', name: 'PWM gate signal of Q1 (1 = ON command)', unit: '', color: '#aeb7c5', group: 'Gate', logic: true },
  vsw: { id: 'vsw', label: 'Vsw', name: 'Switch-node voltage', unit: 'V', color: '#3987e5', group: 'Voltages' },
  il: { id: 'il', label: 'iL', name: 'Inductor current', unit: 'A', color: '#e66767', group: 'Currents' },
  vout: { id: 'vout', label: 'Vout', name: 'Output (load) voltage', unit: 'V', color: '#d95926', group: 'Voltages' },
  vl: { id: 'vl', label: 'vL', name: 'Inductor voltage L·diL/dt', unit: 'V', color: '#e66767', dash: [10, 4], group: 'Voltages' },
  vc: { id: 'vc', label: 'vC', name: 'Capacitor voltage (= Vout without ESR)', unit: 'V', color: '#9085e9', dash: [6, 4], group: 'Voltages' },
  ic: { id: 'ic', label: 'iC', name: 'Capacitor current', unit: 'A', color: '#9085e9', group: 'Currents' },
  io: { id: 'io', label: 'iR', name: 'Load (output) current', unit: 'A', color: '#199e70', dash: [2, 3], group: 'Currents' },
  iq: { id: 'iq', label: 'iQ', name: 'Switch current', unit: 'A', color: '#3987e5', group: 'Currents' },
  vq: { id: 'vq', label: 'vQ', name: 'Switch voltage (blocking voltage when OFF)', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Voltages' },
  id: { id: 'id', label: 'iD', name: 'Diode current', unit: 'A', color: '#008300', group: 'Currents' },
  vd: { id: 'vd', label: 'vD', name: 'Diode voltage, anode − cathode', unit: 'V', color: '#008300', dash: [2, 3], group: 'Voltages' },
  iin: { id: 'iin', label: 'iin', name: 'Input current from the source', unit: 'A', color: '#3987e5', dash: [2, 3], group: 'Currents' },
  el: { id: 'el', label: 'EL', name: 'Energy stored in L, ½·L·iL²', unit: 'J', color: '#e66767', group: 'Stored energy' },
  ec: { id: 'ec', label: 'EC', name: 'Energy stored in C, ½·C·vC²', unit: 'J', color: '#9085e9', group: 'Stored energy' },
  pin: { id: 'pin', label: 'Pin', name: 'Instantaneous input power', unit: 'W', color: '#3987e5', group: 'Power' },
  pout: { id: 'pout', label: 'Pout', name: 'Instantaneous load power', unit: 'W', color: '#d95926', group: 'Power' },
}
const ADD_ORDER = ['gate', 'vsw', 'il', 'vout', 'id', 'iq', 'ic', 'vc', 'iin', 'io', 'vl', 'vq', 'vd', 'el', 'ec', 'pin', 'pout']

const L = BUCK_LIMITS
export const DCDC_BASIC: Array<ParamSpec<ConverterParams>> = [
  { kind: 'number', key: 'vin', label: 'Input voltage Vin', unit: 'V', min: L.vin.min, max: L.vin.max, log: true, step: 1 },
  { kind: 'number', key: 'duty', label: 'Duty ratio D', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 1, hint: (p) => `ton = ${formatSI(p.duty / p.fs, 's')}` },
  { kind: 'number', key: 'fs', label: 'Switching frequency fs', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
  { kind: 'number', key: 'l', label: 'Inductance L', unit: 'µH', scale: 1e-6, min: L.l.min, max: L.l.max, log: true },
  { kind: 'number', key: 'c', label: 'Capacitance C', unit: 'µF', scale: 1e-6, min: L.c.min, max: L.c.max, log: true },
  { kind: 'number', key: 'r', label: 'Load resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
]
export const DCDC_ADVANCED: Array<ParamSpec<ConverterParams>> = [
  {
    kind: 'choice',
    key: 'devices',
    label: 'Device model',
    options: [
      { value: 'ideal', label: 'Ideal devices', title: 'Q1 and D1 have 1 mΩ on-resistance and no forward voltage' },
      { value: 'real', label: 'Real devices', title: 'Switch Ron, diode Vf and Ron as set below' },
    ],
  },
  { kind: 'number', key: 'ronQ', label: 'Switch Ron', unit: 'mΩ', scale: 1e-3, min: L.ronQ.min, max: L.ronQ.max, log: true, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'vfD', label: 'Diode Vf', unit: 'V', min: L.vfD.min, max: L.vfD.max, step: 0.01, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'ronD', label: 'Diode Ron', unit: 'mΩ', scale: 1e-3, min: L.ronD.min, max: L.ronD.max, log: true, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'rl', label: 'Inductor DCR', unit: 'Ω', min: 0, max: L.rl.max, step: 0.005 },
  { kind: 'number', key: 'esr', label: 'Capacitor ESR', unit: 'Ω', min: 0, max: L.esr.max, step: 0.005 },
  { kind: 'number', key: 'periods', label: 'Periods shown (steady state)', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
  { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per period', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 10, hint: (p) => `Δt = ${formatSI(1 / p.fs / p.stepsPerPeriod, 's')}` },
]

export const DCDC_MEASURE_LABELS: Record<string, MeasureLabel> = {
  voutAvg: { label: 'Vout (average)', fmt: (v) => formatV(v, false) },
  voutPP: { label: 'ΔVout (peak-to-peak)', fmt: (v) => formatSI(v, 'V') },
  ilAvg: { label: 'IL (average)', fmt: (v) => formatA(v) },
  ilPP: { label: 'ΔiL (peak-to-peak)', fmt: (v) => formatA(v) },
  ilMax: { label: 'iL,max', fmt: (v) => formatA(v) },
  ilMin: { label: 'iL,min', fmt: (v) => formatA(v) },
  icRms: { label: 'IC (RMS)', fmt: (v) => formatA(v) },
  d3: { label: 'Idle fraction D3', fmt: (v) => `${(v * 100).toFixed(1)} %` },
  mode: { label: 'Conduction mode', fmt: (v) => String(v) },
  efficiency: { label: 'Efficiency', fmt: (v) => `${(v * 100).toFixed(2)} %` },
}

const TITLES: Record<ConverterKind, string> = { buck: 'Buck converter', boost: 'Boost converter', 'buck-boost': 'Inverting buck-boost converter' }

function toLesson(l: DcdcLesson): Lesson<ConverterParams, ConverterResult, DcdcMeasurements, DcdcState> {
  return {
    ...l,
    steps: l.steps.map((s) => ({
      ...s,
      at: (r: ConverterResult) => dcdcLessonTime(s.at, r.params),
      window: (r: ConverterResult) => [0.5 * r.params.ts, 2.5 * r.params.ts] as [number, number],
    })),
  }
}

/** Buck predictions keep their tested definitions; the theory line is added here. */
function buckPredictions(seed: number): Array<PredictTask<ConverterParams, DcdcMeasurements>> {
  return buckPredictTasks(seed).map((t) => ({
    ...t,
    answer: (m: DcdcMeasurements) => t.answer(m),
    theory: (p: ConverterParams) => {
      const rp = resolveConverter(p, 'buck').params
      const tb = dcdcTextbook(rp)
      if (t.id === 'vout') return `${tb.voutAvg.formula} = ${formatV(tb.voutAvg.value ?? NaN, false)}`
      if (t.id === 'ripple') return tb.ilPP ? `${tb.ilPP.formula} = ${formatA(tb.ilPP.value ?? NaN)}` : 'DCM: the CCM ripple formula does not apply'
      return `CCM while R < Rcrit = 2·L·fs/(1 − D) = ${formatSI(dcdcBoundary(rp).rCrit, 'Ω')}`
    },
  }))
}

export function dcdcTopic(kind: ConverterKind): Topic<ConverterParams, ConverterResult, DcdcMeasurements, DcdcState> {
  const model = dcdcModel(kind)
  const lessons = kind === 'buck' ? BUCK_LESSONS.map((l) => toLesson(l as unknown as DcdcLesson)) : (kind === 'boost' ? BOOST_LESSONS : BUCK_BOOST_LESSONS).map(toLesson)
  return {
    id: kind,
    label: kind === 'buck' ? 'Buck' : kind === 'boost' ? 'Boost' : 'Buck-Boost',
    title: TITLES[kind],
    defaults: DCDC_DEFAULTS[kind],
    basic: DCDC_BASIC,
    advanced: DCDC_ADVANCED,
    viewKey: 'view',
    paramNote: (p) => {
      const b = dcdcBoundary(resolveConverter(p, kind).params)
      return `CCM/DCM boundary (theory): Lcrit = ${formatSI(b.lCrit, 'H')} · Rcrit = ${formatSI(b.rCrit, 'Ω')}`
    },
    simulate: (p) => simulateCircuit(model, p),
    measure: measureDcdc,
    state: dcdcStateAt,
    view: (st, r) => {
      const rows: StateRow[] = [
        { k: 't', v: `${formatTime(st.t)} (${(st.phase * 100).toFixed(1)} % of Ts)`, full: true },
        { k: 'Switch Q1', v: st.qOn ? 'ON' : 'OFF', tone: st.qOn ? 'on-q' : 'off' },
        { k: 'Diode D1', v: st.dOn ? 'ON' : 'OFF', tone: st.dOn ? 'on-d' : 'off' },
        { k: 'iL', v: `${formatA(st.il)} · ${st.interval === 'idle' ? 'constant' : formatSlopeA(st.dildt)}`, full: true },
        { k: 'vL', v: formatV(st.vl) },
        { k: 'vC', v: formatV(st.vc) },
        { k: 'Vout', v: formatV(st.vout) },
        { k: 'PWM gate', v: st.gate ? 'HIGH' : 'LOW' },
        { k: 'EL', v: formatSI(st.el, 'J'), min: 'standard' },
        { k: 'EC', v: formatSI(st.ec, 'J'), min: 'standard' },
        { k: 'vsw', v: formatV(st.vsw), min: 'engineer' },
        { k: 'iC', v: formatA(st.ic, true), min: 'engineer' },
        { k: 'iQ', v: formatA(st.iq), min: 'engineer' },
        { k: 'iD', v: formatA(st.id), min: 'engineer' },
        { k: 'dvC/dt', v: formatSlopeV(st.dvcdt), min: 'engineer' },
      ]
      void r
      return { badge: { text: INTERVAL_NAME[st.interval], tone: st.interval }, rows, path: st.pathText }
    },
    why: (r, st, m) => dcdcWhy(r, st, m),
    Diagram: ({ r, st, selected, onSelect, values, showPath }) => <DcdcDiagram st={st} params={r.params} selected={selected} onSelect={onSelect} values={values} showPath={showPath} />,
    channels: DCDC_CHANNELS,
    defaultChannels: ['gate', 'vsw', 'il', 'vout'],
    addOrder: ADD_ORDER,
    shade: (r, k) => (r.devices[0].on[k] ? 'rgba(57,135,229,0.08)' : r.devices[1].on[k] ? 'rgba(0,131,0,0.1)' : null),
    shadeLegend: 'blue band: Q1 ON · green band: D1 ON',
    eventLabel,
    eventWhy,
    initialCursor: (r) => (1 + r.params.duty / 2) * r.params.ts,
    periodName: 'period',
    badge: (r, m) => <DcdcBadge m={m} p={r.params} />,
    summary: (_r, m) => `Mode: ${m.mode} · Vout ${formatV(m.voutAvg, false)} average (SIMULATION)`,
    energy: (st, m, r) => <DcdcEnergy st={st} m={m} p={r.params} />,
    inspect: dcdcInspect,
    analyze: {
      compare: (r, m) => {
        const c = compareDcdc(r, m)
        return {
          rows: c.rows,
          allPass: c.allPass,
          header: `Measured on ${m.periods} switching period${m.periods === 1 ? '' : 's'} of the ${r.params.view === 'startup' ? 'end of the start-up run' : 'periodic steady state'}. Mode: ${m.mode} (SIMULATION) · ${c.exact.mode} (THEORY)${c.modeAgrees ? '' : ' — they differ'}.`,
          note: c.voutEstimate !== null ? `ESTIMATED Vout with device drops (first-order volt-second balance, constant iL): ${formatV(c.voutEstimate, false)} vs simulated ${formatV(m.voutAvg, false)}.` : undefined,
        }
      },
      theory: (r, m) => <DcdcTheory r={r} m={m} />,
      tabs: [
        { id: 'sweep', label: 'Duty sweep', render: ({ p }) => <DcdcSweep p={{ ...p, kind }} /> },
        { id: 'stress', label: 'Stress & losses', render: ({ m }) => <DcdcStress m={m} /> },
      ],
      convergence: ['voutAvg', 'ilPP'],
    },
    lessons,
    experiments: (kind === 'buck' ? BUCK_EXPERIMENTS : dcdcExperiments(kind)) as unknown as Array<Experiment<ConverterParams, DcdcMeasurements>>,
    predictions: (seed) => (kind === 'buck' ? buckPredictions(seed) : dcdcPredictTasks(kind, seed)),
    readings: dcdcReadings(kind),
    measureLabels: DCDC_MEASURE_LABELS,
  }
}


// ── Buck in the universal workspace shell (Phase 2 reference) ─────────────────────────────────────────

const byKey = (k: string) => DCDC_BASIC.find((x) => x.key === k)!
/** Basic: what operates the circuit. L and C stay one click away under Advanced (same values, same lessons). */
const BUCK_BASIC: Array<ParamSpec<ConverterParams>> = [byKey('vin'), byKey('fs'), byKey('duty'), byKey('r')]
const BUCK_ADVANCED: Array<ParamSpec<ConverterParams>> = [byKey('l'), byKey('c'), ...DCDC_ADVANCED]

const BUCK_LABELS: Record<string, MeasureLabel> = {
  ...DCDC_MEASURE_LABELS,
  ioAvg: { label: 'Iout (average)', fmt: (v) => formatA(v) },
  pinAvg: { label: 'Pin (average)', fmt: (v) => formatW(v) },
  poutAvg: { label: 'Pout (average)', fmt: (v) => formatW(v) },
  'losses.q': { label: 'Switch Q1 loss', fmt: (v) => formatW(v) },
  'losses.d': { label: 'Diode D1 loss', fmt: (v) => formatW(v) },
  'losses.dcr': { label: 'Inductor DCR loss', fmt: (v) => formatW(v) },
  'losses.esr': { label: 'Capacitor ESR loss', fmt: (v) => formatW(v) },
  'losses.total': { label: 'Total loss', fmt: (v) => formatW(v) },
  iqPeak: { label: 'Switch peak current', fmt: (v) => formatA(v) },
  iqRms: { label: 'Switch RMS current', fmt: (v) => formatA(v) },
  idRms: { label: 'Diode RMS current', fmt: (v) => formatA(v) },
  vqMax: { label: 'Switch blocking voltage', fmt: (v) => formatV(v, false) },
  vdReverseMax: { label: 'Diode reverse voltage', fmt: (v) => formatV(v, false) },
  d2: { label: 'Diode conduction D2', fmt: (v) => `${(v * 100).toFixed(1)} %` },
}

/** Analyze categories: existing measurements only (SIMULATION, with THEORY where a compare row exists). */
const BUCK_ANALYSIS: Array<AnalysisCategory<ConverterResult, DcdcMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['voutAvg', 'ilAvg', 'mode', 'efficiency'] },
  { id: 'output', label: 'Output', rows: ['voutAvg', 'voutPP', 'ioAvg'] },
  { id: 'current', label: 'Current', rows: ['ilAvg', 'ilMax', 'ilMin', 'ilPP', 'icRms'] },
  {
    id: 'ripple',
    label: 'Ripple',
    rows: ['ilPP', 'voutPP', 'd2', 'd3'],
    note: (m, r) => {
      const b = dcdcBoundary(r.params)
      return `${m.mode} (SIMULATION). The CCM/DCM boundary (theory): Lcrit = ${formatSI(b.lCrit, 'H')}, Rcrit = ${formatSI(b.rCrit, 'Ω')}.`
    },
  },
  { id: 'power', label: 'Power', rows: ['pinAvg', 'poutAvg', 'losses.total'] },
  { id: 'efficiency', label: 'Efficiency', rows: ['efficiency', 'losses.q', 'losses.d', 'losses.dcr', 'losses.esr'] },
  { id: 'stress', label: 'Device stress', tab: 'stress' },
]

const BUCK_PARTS = [
  { id: 'vin', label: 'Source Vin' },
  { id: 'q1', label: 'Switch Q1' },
  { id: 'd1', label: 'Diode D1' },
  { id: 'l', label: 'Inductor L' },
  { id: 'c', label: 'Capacitor C' },
  { id: 'r', label: 'Load R' },
]

/** The inspector of the shell adds what a storage element is doing right now (from the simulated power into it). */
function buckInspect(part: string, st: DcdcState, m: DcdcMeasurements, r: ConverterResult): InspectInfo {
  const info = dcdcInspect(part, st, m, r)
  const eps = 1e-9 * Math.max(1, Math.abs(m.pinAvg))
  if (part === 'l') return { ...info, rows: [['State now', st.pL > eps ? 'STORING ENERGY' : st.pL < -eps ? 'RELEASING ENERGY' : st.il === 0 ? 'NO CURRENT' : 'STEADY'], ...info.rows] }
  if (part === 'c') return { ...info, rows: [['State now', st.pC > eps ? 'CHARGING' : st.pC < -eps ? 'DISCHARGING' : 'STEADY'], ...info.rows] }
  return info
}

/** A DC-DC converter as the universal workspace shell shows it: the same simulator, configured for progressive disclosure. */
export function dcdcShellTopic(kind: ConverterKind): Topic<ConverterParams, ConverterResult, DcdcMeasurements, DcdcState> {
  const t = dcdcTopic(kind)
  return {
    ...t,
    title: TITLES[kind],
    basic: BUCK_BASIC,
    advanced: BUCK_ADVANCED,
    defaultChannels: ['gate', 'vout', 'il'],
    measureLabels: BUCK_LABELS,
    inspect: buckInspect,
    status: (st) => dcdcStatus(st),
    next: (r, st) => dcdcNext(r, st),
    nextConsequence: (r, st) => dcdcNextConsequence(r, st),
    path: (st) => ({ elements: st.path, text: st.pathText, reasons: [] }),
    energyModel: (st, m, r) => dcdcEnergy(st, m, r.params),
    primaryChannels: ['gate', 'vout'],
    analysis: BUCK_ANALYSIS,
    parts: BUCK_PARTS,
    Diagram: ({ r, st, selected, onSelect, values, showPath }) => <DcdcDiagram st={st} params={r.params} selected={selected} onSelect={onSelect} values={values} showPath={showPath} minimal />,
  }
}

/** Buck in the shell (the Phase 2 reference). */
export const buckShellTopic = () => dcdcShellTopic('buck')
