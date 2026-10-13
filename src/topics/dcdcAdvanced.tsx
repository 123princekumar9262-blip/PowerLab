import { BidiDiagram, CoupledDiagram } from '../components/dcdc/Dcdc4Diagram.tsx'
import { BidiBadge, BidiStress, BidiTheory, CoupledBadge, CoupledStress, CoupledSweep, CoupledTheory } from '../components/dcdc/Dcdc4Views.tsx'
import { compareBidi, compareCoupled, REVERSE_TURN_OFF } from '../converters/dcdc4/compare.ts'
import {
  bidiEnergy,
  bidiEventLabel,
  bidiEventWhy,
  bidiNextConsequence,
  bidiStateAt,
  bidiStatus,
  bidiWhy,
  COUPLED_INTERVAL,
  coupledEnergy,
  coupledEventLabel,
  coupledEventWhy,
  coupledName,
  coupledNextConsequence,
  coupledStateAt,
  coupledStatus,
  coupledWhy,
  formatSlopeA,
  type BidiState,
  type CoupledState,
} from '../converters/dcdc4/explain.ts'
import { BIDI_LESSONS, bidiExperiments, bidiLessonTime, bidiPredictTasks, COUPLED_LESSONS, coupledExperiments, coupledLessonTime, coupledPredictTasks } from '../converters/dcdc4/learn.ts'
import { measureBidi, measureCoupled, type BidiMeasurements, type BidiRun, type CoupledMeasurements, type CoupledRun } from '../converters/dcdc4/measure.ts'
import { bidiModel, coupledModel } from '../converters/dcdc4/model.ts'
import { BIDI_DEFAULTS, BIDI_LIMITS, COUPLED_DEFAULTS, COUPLED_LIMITS as L, resolveCoupled, type BidiParams, type CoupledKind, type CoupledParams } from '../converters/dcdc4/params.ts'
import { coupledBoundary, coupledLaw, coupledVc1Law } from '../converters/dcdc4/theory.ts'
import { simulateCircuit } from '../converters/engine.ts'
import { reading } from '../lab/readings.ts'
import type { AnalysisCategory, ChannelMeta, InspectInfo, Lesson, MeasureLabel, ParamSpec, StateRow, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

/*
 * The advanced converters of the DC-DC lab: Ćuk, SEPIC, Zeta (fourth order, coupling capacitor) and the
 * bidirectional half-bridge. Same engine, same shell contract and the same colour conventions as the basic
 * converters (switch blue, diode green, inductor red, capacitor violet, output orange, load aqua).
 */

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)} %`

// ── Ćuk, SEPIC, Zeta ──────────────────────────────────────────────────────────────────────────────────

export const COUPLED_CHANNELS: Record<string, ChannelMeta> = {
  gate: { id: 'gate', label: 'Gate', name: 'PWM gate signal of Q1 (1 = ON command)', unit: '', color: '#aeb7c5', group: 'Gate', logic: true },
  il1: { id: 'il1', label: 'iL1', name: 'Input-side inductor current', unit: 'A', color: '#e66767', group: 'Currents' },
  il2: { id: 'il2', label: 'iL2', name: 'Output-side inductor current', unit: 'A', color: '#c98500', group: 'Currents' },
  vout: { id: 'vout', label: 'Vout', name: 'Output (load) voltage', unit: 'V', color: '#d95926', group: 'Voltages' },
  vc1: { id: 'vc1', label: 'vC1', name: 'Coupling-capacitor voltage', unit: 'V', color: '#9085e9', group: 'Voltages' },
  ic1: { id: 'ic1', label: 'iC1', name: 'Coupling-capacitor current', unit: 'A', color: '#9085e9', dash: [6, 4], group: 'Currents' },
  id: { id: 'id', label: 'iD', name: 'Diode current (= iL1 + iL2 while ON)', unit: 'A', color: '#008300', group: 'Currents' },
  iq: { id: 'iq', label: 'iQ', name: 'Switch current (= iL1 + iL2 while ON)', unit: 'A', color: '#3987e5', group: 'Currents' },
  vsw: { id: 'vsw', label: 'vA', name: 'Switch-node voltage (node A)', unit: 'V', color: '#3987e5', dash: [10, 4], group: 'Voltages' },
  iin: { id: 'iin', label: 'iin', name: 'Input current from the source', unit: 'A', color: '#3987e5', dash: [2, 3], group: 'Currents' },
  io: { id: 'io', label: 'iR', name: 'Load current', unit: 'A', color: '#199e70', dash: [2, 3], group: 'Currents' },
  ic: { id: 'ic', label: 'iC', name: 'Output-capacitor current', unit: 'A', color: '#b8a9f0', dash: [3, 3], group: 'Currents' },
  vl1: { id: 'vl1', label: 'vL1', name: 'Voltage on L1 (L1·diL1/dt)', unit: 'V', color: '#e66767', dash: [10, 4], group: 'Voltages' },
  vl2: { id: 'vl2', label: 'vL2', name: 'Voltage on L2 (L2·diL2/dt)', unit: 'V', color: '#c98500', dash: [10, 4], group: 'Voltages' },
  vq: { id: 'vq', label: 'vQ', name: 'Switch voltage (blocking voltage when OFF)', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Voltages' },
  vd: { id: 'vd', label: 'vD', name: 'Diode voltage, anode − cathode', unit: 'V', color: '#008300', dash: [2, 3], group: 'Voltages' },
  vb: { id: 'vb', label: 'vB', name: 'Node B voltage (far plate of C1)', unit: 'V', color: '#9085e9', dash: [2, 3], group: 'Voltages' },
  el: { id: 'el', label: 'EL', name: 'Energy in L1 and L2', unit: 'J', color: '#e66767', group: 'Stored energy' },
  ec: { id: 'ec', label: 'EC', name: 'Energy in C1 and C', unit: 'J', color: '#9085e9', group: 'Stored energy' },
  pin: { id: 'pin', label: 'Pin', name: 'Instantaneous input power', unit: 'W', color: '#3987e5', group: 'Power' },
  pout: { id: 'pout', label: 'Pout', name: 'Instantaneous load power', unit: 'W', color: '#d95926', group: 'Power' },
}
const COUPLED_ADD = ['gate', 'il1', 'il2', 'vout', 'vc1', 'id', 'iq', 'iin', 'io', 'ic1', 'ic', 'vsw', 'vb', 'vl1', 'vl2', 'vq', 'vd', 'el', 'ec', 'pin', 'pout']

// the same basic set and order as the basic converters: Vin, fs, D, R
const COUPLED_BASIC: Array<ParamSpec<CoupledParams>> = [
  { kind: 'number', key: 'vin', label: 'Input voltage Vin', unit: 'V', min: L.vin.min, max: L.vin.max, log: true, step: 1 },
  { kind: 'number', key: 'fs', label: 'Switching frequency fs', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
  { kind: 'number', key: 'duty', label: 'Duty ratio D', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 1, hint: (p) => `ton = ${formatSI(p.duty / p.fs, 's')}` },
  { kind: 'number', key: 'r', label: 'Load resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
]
const COUPLED_ADVANCED: Array<ParamSpec<CoupledParams>> = [
  { kind: 'number', key: 'l1', label: 'Input inductor L1', unit: 'µH', scale: 1e-6, min: L.l1.min, max: L.l1.max, log: true },
  { kind: 'number', key: 'l2', label: 'Output-side inductor L2', unit: 'µH', scale: 1e-6, min: L.l2.min, max: L.l2.max, log: true },
  { kind: 'number', key: 'c1', label: 'Coupling capacitor C1', unit: 'µF', scale: 1e-6, min: L.c1.min, max: L.c1.max, log: true },
  { kind: 'number', key: 'c', label: 'Output capacitor C', unit: 'µF', scale: 1e-6, min: L.c.min, max: L.c.max, log: true },
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
  { kind: 'number', key: 'rl', label: 'Inductor DCR (each)', unit: 'Ω', min: 0, max: L.rl.max, step: 0.005 },
  { kind: 'number', key: 'esr', label: 'Output capacitor ESR', unit: 'Ω', min: 0, max: L.esr.max, step: 0.005 },
  { kind: 'number', key: 'periods', label: 'Periods shown (steady state)', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
  { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per period', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 10, hint: (p) => `Δt = ${formatSI(1 / p.fs / p.stepsPerPeriod, 's')}` },
]

export const COUPLED_LABELS: Record<string, MeasureLabel> = {
  voutAvg: { label: 'Vout (average)', fmt: (v) => formatV(v) },
  voutPP: { label: 'ΔVout (peak-to-peak)', fmt: (v) => formatSI(v, 'V') },
  vc1Avg: { label: 'VC1 (average)', fmt: (v) => formatV(v, false) },
  vc1PP: { label: 'ΔVC1 (peak-to-peak)', fmt: (v) => formatSI(v, 'V') },
  il1Avg: { label: 'IL1 (average)', fmt: (v) => formatA(v, true) },
  il1PP: { label: 'ΔiL1 (peak-to-peak)', fmt: (v) => formatA(v) },
  il1Max: { label: 'iL1,max', fmt: (v) => formatA(v, true) },
  il1Min: { label: 'iL1,min', fmt: (v) => formatA(v, true) },
  il2Avg: { label: 'IL2 (average)', fmt: (v) => formatA(v, true) },
  il2PP: { label: 'ΔiL2 (peak-to-peak)', fmt: (v) => formatA(v) },
  il2Max: { label: 'iL2,max', fmt: (v) => formatA(v, true) },
  il2Min: { label: 'iL2,min', fmt: (v) => formatA(v, true) },
  ioAvg: { label: 'Iout (average)', fmt: (v) => formatA(v, true) },
  iinAvg: { label: 'Iin (average)', fmt: (v) => formatA(v) },
  iinPP: { label: 'Input current ripple', fmt: (v) => formatA(v) },
  pinAvg: { label: 'Pin (average)', fmt: (v) => formatW(v) },
  poutAvg: { label: 'Pout (average)', fmt: (v) => formatW(v) },
  efficiency: { label: 'Efficiency', fmt: (v) => `${(v * 100).toFixed(2)} %` },
  mode: { label: 'Conduction mode', fmt: (v) => String(v) },
  d2: { label: 'Diode conduction D2', fmt: (v) => pct(v) },
  d3: { label: 'Idle fraction D3', fmt: (v) => pct(v) },
  idleCurrent: { label: 'Circulating current in the idle loop', fmt: (v) => formatA(Math.abs(v)) },
  icRms: { label: 'Output capacitor RMS current', fmt: (v) => formatA(v) },
  iqPeak: { label: 'Switch peak current', fmt: (v) => formatA(v) },
  iqRms: { label: 'Switch RMS current', fmt: (v) => formatA(v) },
  idAvg: { label: 'Diode average current', fmt: (v) => formatA(v) },
  vqMax: { label: 'Switch blocking voltage', fmt: (v) => formatV(v, false) },
  vdReverseMax: { label: 'Diode reverse voltage', fmt: (v) => formatV(v, false) },
  'losses.q': { label: 'Switch Q1 loss', fmt: (v) => formatW(v) },
  'losses.d': { label: 'Diode D1 loss', fmt: (v) => formatW(v) },
  'losses.dcr': { label: 'Inductor DCR loss', fmt: (v) => formatW(v) },
  'losses.esr': { label: 'Capacitor ESR loss', fmt: (v) => formatW(v) },
  'losses.total': { label: 'Total loss', fmt: (v) => formatW(v) },
}

const COUPLED_ANALYSIS: Array<AnalysisCategory<CoupledRun, CoupledMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['voutAvg', 'vc1Avg', 'mode', 'efficiency'] },
  { id: 'output', label: 'Output', rows: ['voutAvg', 'voutPP', 'ioAvg'] },
  { id: 'current', label: 'Currents', rows: ['il1Avg', 'il1Max', 'il1Min', 'il1PP', 'il2Avg', 'il2Max', 'il2Min', 'il2PP'] },
  { id: 'c1', label: 'Coupling capacitor', rows: ['vc1Avg', 'vc1PP'], note: (_m, r) => `THEORY: ${coupledVc1Law(r.params.kind)}; ΔVC1 = |Iout|·D/(C1·fs).` },
  {
    id: 'ripple',
    label: 'Mode',
    rows: ['d2', 'd3', 'idleCurrent'],
    note: (m, r) => {
      const b = coupledBoundary(r.params)
      return `${m.mode} (SIMULATION). The CCM/DCM boundary (theory): Le = L1‖L2 = ${formatSI(b.le, 'H')}, Le,crit = ${formatSI(b.leCrit, 'H')}, Rcrit = ${formatSI(b.rCrit, 'Ω')}.`
    },
  },
  { id: 'power', label: 'Power', rows: ['pinAvg', 'poutAvg', 'losses.total'] },
  { id: 'efficiency', label: 'Efficiency', rows: ['efficiency', 'losses.q', 'losses.d', 'losses.dcr', 'losses.esr'] },
  { id: 'stress', label: 'Device stress', tab: 'stress', rows: ['vqMax', 'iqPeak'] },
]

const COUPLED_PARTS: Record<CoupledKind, Array<{ id: string; label: string }>> = {
  cuk: [
    { id: 'vin', label: 'Source Vin' },
    { id: 'l1', label: 'Inductor L1' },
    { id: 'q1', label: 'Switch Q1' },
    { id: 'c1', label: 'Coupling capacitor C1' },
    { id: 'd1', label: 'Diode D1' },
    { id: 'l2', label: 'Inductor L2' },
    { id: 'c', label: 'Output capacitor C' },
    { id: 'r', label: 'Load R' },
  ],
  sepic: [
    { id: 'vin', label: 'Source Vin' },
    { id: 'l1', label: 'Inductor L1' },
    { id: 'q1', label: 'Switch Q1' },
    { id: 'c1', label: 'Coupling capacitor C1' },
    { id: 'l2', label: 'Inductor L2' },
    { id: 'd1', label: 'Diode D1' },
    { id: 'c', label: 'Output capacitor C' },
    { id: 'r', label: 'Load R' },
  ],
  zeta: [
    { id: 'vin', label: 'Source Vin' },
    { id: 'q1', label: 'Switch Q1' },
    { id: 'l1', label: 'Inductor L1' },
    { id: 'c1', label: 'Coupling capacitor C1' },
    { id: 'd1', label: 'Diode D1' },
    { id: 'l2', label: 'Inductor L2' },
    { id: 'c', label: 'Output capacitor C' },
    { id: 'r', label: 'Load R' },
  ],
}

const ROLE: Record<CoupledKind, Record<string, string>> = {
  cuk: {
    vin: 'Supplies energy through L1: a continuous input current.',
    l1: 'Input inductor: charges from Vin while Q1 is ON, recharges C1 while Q1 is OFF.',
    l2: 'Output inductor in series with the load: a continuous (inverted) output current.',
    c1: 'Energy-transfer capacitor: charged by L1 while Q1 is OFF, discharged into L2 while Q1 is ON. VC1 = Vin + |Vout|.',
    q1: 'Grounds node A while ON: L1 charges and C1 discharges into L2.',
    d1: 'Grounds node B while Q1 is OFF: L1 recharges C1 and L2 freewheels. Carries iL1 + iL2.',
  },
  sepic: {
    vin: 'Supplies energy through L1: a continuous input current (like a boost).',
    l1: 'Input inductor: charges from Vin while Q1 is ON, feeds C1 and the output while OFF.',
    l2: 'Second inductor from ground to node B: its average voltage is zero, which pins VC1 = Vin.',
    c1: 'Coupling capacitor: blocks DC between input and output (VC1 = Vin) and passes the energy across.',
    q1: 'Grounds node A while ON: L1 charges from Vin, and C1 charges L2.',
    d1: 'Delivers iL1 + iL2 to the output while Q1 is OFF: a pulsed output current.',
  },
  zeta: {
    vin: 'Supplies energy only while Q1 is ON (pulsed input current, like a buck).',
    l1: 'Inductor from node A to ground: charges from Vin while ON, recharges C1 while OFF.',
    l2: 'Output inductor in series with the load: a continuous output current.',
    c1: 'Coupling capacitor between A and B: VC1 = Vout. It shifts node B above node A.',
    q1: 'Connects Vin to node A (high-side switch).',
    d1: 'Clamps node B to ground while Q1 is OFF: L1 recharges C1 and L2 freewheels.',
  },
}

function coupledInspect(part: string, st: CoupledState, m: CoupledMeasurements, r: CoupledRun): InspectInfo {
  const p = r.params
  const role = ROLE[p.kind]
  switch (part) {
    case 'vin':
      return { title: 'Input source Vin', role: role.vin, rows: [['Voltage', formatV(p.vin, false)], ['Current now', formatA(st.iin, true)], ['Average / ripple', `${formatA(m.iinAvg)} / ${formatA(m.iinPP)}`], ['Average input power', formatW(m.pinAvg)]] }
    case 'q1':
      return {
        title: 'Switch Q1',
        role: role.q1,
        rows: [
          ['State now', st.qOn ? 'ON (gate HIGH)' : 'OFF (gate LOW)'],
          ['Current now', formatA(st.iq, true)],
          ['Voltage now', formatV(st.vq)],
          ['Peak / RMS current', `${formatA(m.iqPeak)} / ${formatA(m.iqRms)}`],
          ['Max blocking voltage', formatV(m.vqMax, false)],
          ['Conduction loss', formatW(m.losses.q)],
        ],
      }
    case 'd1':
      return {
        title: 'Diode D1',
        role: role.d1,
        rows: [
          ['State now', st.dOn ? 'ON (forward)' : 'OFF'],
          ['Current now', formatA(st.id)],
          ['Voltage now (anode − cathode)', formatV(st.vd)],
          ['Average / peak current', `${formatA(m.idAvg)} / ${formatA(m.idPeak)}`],
          ['Max reverse voltage', formatV(m.vdReverseMax, false)],
          ['Conduction loss', formatW(m.losses.d)],
        ],
      }
    case 'l1':
    case 'l2': {
      const one = part === 'l1'
      return {
        title: one ? 'Inductor L1' : 'Inductor L2',
        role: role[part],
        rows: [
          ['State now', (one ? st.vl1 * st.il1 : st.vl2 * st.il2) > 0 ? 'STORING ENERGY' : 'RELEASING ENERGY'],
          ['Inductance', formatSI(one ? p.l1 : p.l2, 'H')],
          ['Current now', formatA(one ? st.il1 : st.il2, true)],
          ['diL/dt now', formatSlopeA(one ? st.dil1dt : st.dil2dt)],
          ['Average / peak-to-peak', one ? `${formatA(m.il1Avg, true)} / ${formatA(m.il1PP)}` : `${formatA(m.il2Avg, true)} / ${formatA(m.il2PP)}`],
        ],
      }
    }
    case 'c1':
      return {
        title: 'Coupling capacitor C1',
        role: role.c1,
        rows: [
          ['State now', st.vc1 * st.ic1 >= 0 ? 'CHARGING' : 'DISCHARGING'],
          ['Capacitance', formatSI(p.c1, 'F')],
          ['Voltage now', formatV(st.vc1, false)],
          ['Current now', formatA(st.ic1, true)],
          ['Average / ripple', `${formatV(m.vc1Avg, false)} / ${formatV(m.vc1PP, false)}`],
        ],
      }
    case 'c':
      return { title: 'Output capacitor C', role: 'Holds the output voltage and absorbs the ripple of the current fed to the output.', rows: [['Capacitance', formatSI(p.c, 'F')], ['Current now', formatA(st.ic, true)], ['RMS current', formatA(m.icRms)], ['Output ripple', formatSI(m.voutPP, 'V')], ['ESR loss', formatW(m.losses.esr)]] }
    case 'r':
      return { title: 'Load R', role: 'Consumes the output power.', rows: [['Resistance', formatSI(p.r, 'Ω')], ['Current now', formatA(st.io, true)], ['Average power', formatW(m.poutAvg)]] }
    case 'sw':
      return { title: 'Node A (switch node)', role: 'Where Q1 meets L1 and C1.', rows: [['Voltage now', formatV(st.vsw)]] }
    case 'b':
      return { title: 'Node B', role: 'The far plate of C1: it moves with node A, shifted by vC1.', rows: [['Voltage now', formatV(st.vb)]] }
    default:
      return { title: 'Output node', role: 'The DC output.', rows: [['Voltage now', formatV(st.vout)], ['Average', formatV(m.voutAvg)], ['Ripple (p-p)', formatSI(m.voutPP, 'V')]] }
  }
}

function coupledLessons(kind: CoupledKind): Array<Lesson<CoupledParams, CoupledRun, CoupledMeasurements, CoupledState>> {
  return COUPLED_LESSONS[kind].map((l) => ({
    ...l,
    steps: l.steps.map((s) => ({
      ...s,
      at: (r: CoupledRun) => coupledLessonTime(s.at, r.params),
      window: (r: CoupledRun) => [0.5 * r.params.ts, 2.5 * r.params.ts] as [number, number],
    })),
  }))
}

const TITLE: Record<CoupledKind, string> = { cuk: 'Ćuk converter', sepic: 'SEPIC converter', zeta: 'Zeta converter' }

export function coupledTopic(kind: CoupledKind): Topic<CoupledParams, CoupledRun, CoupledMeasurements, CoupledState> {
  const model = coupledModel(kind)
  return {
    id: kind,
    label: coupledName(kind),
    title: TITLE[kind],
    defaults: COUPLED_DEFAULTS,
    basic: COUPLED_BASIC,
    advanced: COUPLED_ADVANCED,
    viewKey: 'view',
    paramNote: (p) => {
      const b = coupledBoundary(resolveCoupled(p, kind).params)
      return `CCM/DCM boundary (theory): Le = L1‖L2 = ${formatSI(b.le, 'H')} · Le,crit = ${formatSI(b.leCrit, 'H')} · Rcrit = ${formatSI(b.rCrit, 'Ω')}`
    },
    simulate: (p) => simulateCircuit(model, p),
    measure: measureCoupled,
    state: coupledStateAt,
    view: (st) => {
      const rows: StateRow[] = [
        { k: 't', v: `${formatTime(st.t)} (${(st.phase * 100).toFixed(1)} % of Ts)`, full: true },
        { k: 'Switch Q1', v: st.qOn ? 'ON' : 'OFF', tone: st.qOn ? 'on-q' : 'off' },
        { k: 'Diode D1', v: st.dOn ? 'ON' : 'OFF', tone: st.dOn ? 'on-d' : 'off' },
        { k: 'iL1', v: `${formatA(st.il1, true)} · ${formatSlopeA(st.dil1dt)}`, full: true },
        { k: 'iL2', v: `${formatA(st.il2, true)} · ${formatSlopeA(st.dil2dt)}`, full: true },
        { k: 'vC1', v: formatV(st.vc1, false) },
        { k: 'Vout', v: formatV(st.vout) },
        { k: 'iD = iL1 + iL2', v: formatA(st.id) },
        { k: 'PWM gate', v: st.gate ? 'HIGH' : 'LOW' },
        { k: 'iC1', v: formatA(st.ic1, true), min: 'standard' },
        { k: 'EL (L1 + L2)', v: formatSI(st.el, 'J'), min: 'standard' },
        { k: 'vA', v: formatV(st.vsw), min: 'engineer' },
        { k: 'vB', v: formatV(st.vb), min: 'engineer' },
        { k: 'iQ', v: formatA(st.iq, true), min: 'engineer' },
        { k: 'iin', v: formatA(st.iin, true), min: 'engineer' },
      ]
      return { badge: { text: COUPLED_INTERVAL[st.interval], tone: st.interval }, rows, path: st.pathText }
    },
    why: coupledWhy,
    Diagram: ({ r, st, selected, onSelect, values, live, showPath }) => <CoupledDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={!!live} showPath={showPath} />,
    channels: COUPLED_CHANNELS,
    defaultChannels: ['gate', 'il1', 'il2', 'vout'],
    primaryChannels: ['gate', 'vout'],
    addOrder: COUPLED_ADD,
    shade: (r, k) => (r.devices[0].on[k] ? 'rgba(57,135,229,0.08)' : r.devices[1].on[k] ? 'rgba(0,131,0,0.1)' : null),
    shadeLegend: 'blue band: Q1 ON · green band: D1 ON · no band: idle (DCM)',
    eventLabel: coupledEventLabel,
    eventWhy: coupledEventWhy,
    initialCursor: (r) => (1 + r.params.duty / 2) * r.params.ts,
    periodName: 'period',
    badge: (r, m) => <CoupledBadge m={m} p={r.params} />,
    summary: (_r, m) => `Mode: ${m.mode} · Vout ${formatV(m.voutAvg)} average · VC1 ${formatV(m.vc1Avg, false)} (SIMULATION)`,
    inspect: coupledInspect,
    analyze: {
      compare: (r, m) => {
        const c = compareCoupled(r, m)
        return {
          rows: c.rows,
          allPass: c.allPass,
          header: `Measured on ${m.periods} switching period${m.periods === 1 ? '' : 's'} of the ${r.params.view === 'startup' ? 'end of the start-up run' : 'periodic steady state'}. Mode: ${m.mode} (SIMULATION) · ${c.exact.mode} (THEORY)${c.modeAgrees ? '' : ' — they differ'}.`,
          note: c.outside
            ? REVERSE_TURN_OFF
            : r.params.view === 'startup' && !m.steady
              ? 'The start-up run has not settled yet: its last period is not the periodic steady state the theory describes.'
              : undefined,
        }
      },
      theory: (r, m) => <CoupledTheory r={r} m={m} />,
      tabs: [
        { id: 'sweep', label: 'Duty sweep', render: ({ p }) => <CoupledSweep p={p} kind={kind} /> },
        { id: 'stress', label: 'Stress & losses', render: ({ m }) => <CoupledStress m={m} /> },
      ],
      convergence: ['voutAvg', 'il1PP'],
    },
    lessons: coupledLessons(kind),
    experiments: coupledExperiments(kind),
    predictions: (seed) => coupledPredictTasks(kind, seed),
    measureLabels: COUPLED_LABELS,
    status: (st) => coupledStatus(st),
    next: (r, st) => coupledNextConsequence(r, st)?.text ?? null,
    nextConsequence: (r, st) => coupledNextConsequence(r, st),
    path: (st) => ({ elements: st.path, text: st.pathText, reasons: [] }),
    energyModel: coupledEnergy,
    analysis: COUPLED_ANALYSIS,
    parts: COUPLED_PARTS[kind],
    readings: (m) => [
      reading('vout', 'Output voltage, average', formatV(m.voutAvg), coupledLaw(kind).replace(/ /g, '').replace('=', ' = ')),
      reading('vc1', 'Coupling capacitor C1, average', formatV(m.vc1Avg, false), coupledVc1Law(kind).split(' = ').slice(0, 2).join(' = ')),
      reading('il', 'Inductor currents IL1 · IL2', `${Math.abs(m.il1Avg).toFixed(3)} · ${Math.abs(m.il2Avg).toFixed(3)} A`, 'IL1 = Iin, IL2 = |Iout| (averages)'),
      reading('mode', 'Conduction mode', m.mode, m.mode === 'CCM' ? 'diode current iL1 + iL2 > 0 all period' : `iD = 0 for ${pct(m.d3)} of the period`),
      reading('eff', 'Efficiency', pct(m.efficiency), `η = Pout / Pin, Pout = ${formatW(m.poutAvg)}`, 'standard'),
    ],
  }
}

// ── Bidirectional half-bridge ─────────────────────────────────────────────────────────────────────────

export const BIDI_CHANNELS: Record<string, ChannelMeta> = {
  gate1: { id: 'gate1', label: 'Q1 gate', name: 'Gate of the upper switch Q1', unit: '', color: '#3987e5', group: 'Gates', logic: true },
  gate2: { id: 'gate2', label: 'Q2 gate', name: 'Gate of the lower switch Q2', unit: '', color: '#aeb7c5', group: 'Gates', logic: true },
  il: { id: 'il', label: 'iL', name: 'Inductor current (+ toward the battery)', unit: 'A', color: '#e66767', group: 'Currents' },
  vsw: { id: 'vsw', label: 'vsw', name: 'Switch-node voltage', unit: 'V', color: '#3987e5', dash: [10, 4], group: 'Voltages' },
  vlv: { id: 'vlv', label: 'VLV', name: 'Battery-side (LV) voltage', unit: 'V', color: '#d95926', group: 'Voltages' },
  ib: { id: 'ib', label: 'Ib', name: 'Battery current (+ charging)', unit: 'A', color: '#199e70', group: 'Currents' },
  ihv: { id: 'ihv', label: 'iHV', name: 'Bus current (+ out of the bus)', unit: 'A', color: '#3987e5', dash: [2, 3], group: 'Currents' },
  phv: { id: 'phv', label: 'PHV', name: 'Bus power (+ bus supplies, − bus absorbs)', unit: 'W', color: '#3987e5', group: 'Power' },
  plv: { id: 'plv', label: 'PLV', name: 'Battery-side power (+ into the battery)', unit: 'W', color: '#199e70', group: 'Power' },
  iq1: { id: 'iq1', label: 'iQ1', name: 'Q1 current (drain → source)', unit: 'A', color: '#3987e5', group: 'Currents' },
  iq2: { id: 'iq2', label: 'iQ2', name: 'Q2 current (drain → source)', unit: 'A', color: '#7aa5c9', dash: [6, 4], group: 'Currents' },
  id1: { id: 'id1', label: 'iD1', name: 'D1 current', unit: 'A', color: '#008300', group: 'Currents' },
  id2: { id: 'id2', label: 'iD2', name: 'D2 current', unit: 'A', color: '#22b14c', dash: [6, 4], group: 'Currents' },
  vl: { id: 'vl', label: 'vL', name: 'Inductor voltage L·diL/dt', unit: 'V', color: '#e66767', dash: [10, 4], group: 'Voltages' },
  ic: { id: 'ic', label: 'iC', name: 'LV capacitor current', unit: 'A', color: '#9085e9', group: 'Currents' },
  el: { id: 'el', label: 'EL', name: 'Energy in L, ½·L·iL²', unit: 'J', color: '#e66767', group: 'Stored energy' },
}
const BIDI_ADD = ['gate1', 'gate2', 'il', 'vsw', 'phv', 'plv', 'ib', 'ihv', 'vlv', 'iq1', 'iq2', 'id1', 'id2', 'vl', 'ic', 'el']

const BL = BIDI_LIMITS
const BIDI_BASIC: Array<ParamSpec<BidiParams>> = [
  {
    kind: 'choice',
    key: 'dir',
    label: 'Power direction',
    options: [
      { value: 'buck', label: 'Buck: bus → battery', title: 'Charge the battery from the DC bus' },
      { value: 'boost', label: 'Boost: battery → bus', title: 'Return the battery energy to the DC bus' },
    ],
    when: (p) => p.control === 'current',
  },
  { kind: 'number', key: 'iref', label: 'Battery current |Iref|', unit: 'A', min: BL.iref.min, max: BL.iref.max, step: 0.1, when: (p) => p.control === 'current' },
  { kind: 'number', key: 'duty', label: 'Duty of Q1, D', unit: '%', scale: 0.01, min: BL.duty.min, max: BL.duty.max, step: 0.5, when: (p) => p.control === 'duty' },
  { kind: 'number', key: 'vhv', label: 'Bus voltage VHV', unit: 'V', min: BL.vhv.min, max: BL.vhv.max, log: true, step: 1 },
  { kind: 'number', key: 'eb', label: 'Battery EMF Eb', unit: 'V', min: BL.eb.min, max: BL.eb.max, log: true, step: 1 },
]
const BIDI_ADVANCED: Array<ParamSpec<BidiParams>> = [
  {
    kind: 'choice',
    key: 'control',
    label: 'Duty from',
    options: [
      { value: 'current', label: 'Current reference', title: 'Feed-forward: D = (Eb + Iref·(Rb + DCR + Ron))/VHV' },
      { value: 'duty', label: 'Set by hand', title: 'Choose D directly' },
    ],
  },
  { kind: 'number', key: 'fs', label: 'Switching frequency fs', unit: 'kHz', scale: 1e3, min: BL.fs.min, max: BL.fs.max, log: true },
  { kind: 'number', key: 'l', label: 'Inductance L', unit: 'µH', scale: 1e-6, min: BL.l.min, max: BL.l.max, log: true },
  { kind: 'number', key: 'c', label: 'LV capacitor C', unit: 'µF', scale: 1e-6, min: BL.c.min, max: BL.c.max, log: true },
  { kind: 'number', key: 'rb', label: 'Battery resistance Rb', unit: 'mΩ', scale: 1e-3, min: BL.rb.min, max: BL.rb.max, log: true },
  { kind: 'number', key: 'deadTime', label: 'Dead time', unit: 'µs', scale: 1e-6, min: BL.deadTime.min, max: BL.deadTime.max, step: 0.05 },
  {
    kind: 'choice',
    key: 'devices',
    label: 'Device model',
    options: [
      { value: 'ideal', label: 'Ideal devices', title: 'Switches 1 mΩ both ways, diodes 0 V / 1 mΩ' },
      { value: 'real', label: 'Real devices', title: 'Switch Ron, diode Vf and Ron as set below' },
    ],
  },
  { kind: 'number', key: 'ronQ', label: 'Switch Ron', unit: 'mΩ', scale: 1e-3, min: BL.ronQ.min, max: BL.ronQ.max, log: true, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'vfD', label: 'Diode Vf', unit: 'V', min: BL.vfD.min, max: BL.vfD.max, step: 0.01, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'ronD', label: 'Diode Ron', unit: 'mΩ', scale: 1e-3, min: BL.ronD.min, max: BL.ronD.max, log: true, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'rl', label: 'Inductor DCR', unit: 'Ω', min: 0, max: BL.rl.max, step: 0.005 },
  { kind: 'number', key: 'esr', label: 'Capacitor ESR', unit: 'Ω', min: 0, max: BL.esr.max, step: 0.005 },
  { kind: 'number', key: 'periods', label: 'Periods shown (steady state)', unit: '', min: BL.periods.min, max: BL.periods.max, step: 1 },
  { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per period', unit: '', min: BL.stepsPerPeriod.min, max: BL.stepsPerPeriod.max, log: true, step: 10, hint: (p) => `Δt = ${formatSI(1 / p.fs / p.stepsPerPeriod, 's')}` },
]

export const BIDI_LABELS: Record<string, MeasureLabel> = {
  vlvAvg: { label: 'VLV (average)', fmt: (v) => formatV(v, false) },
  vlvPP: { label: 'ΔVLV (peak-to-peak)', fmt: (v) => formatSI(v, 'V') },
  ilAvg: { label: 'IL (average, + toward the battery)', fmt: (v) => formatA(v, true) },
  ilPP: { label: 'ΔiL (peak-to-peak)', fmt: (v) => formatA(v) },
  ilMax: { label: 'iL,max', fmt: (v) => formatA(v, true) },
  ilMin: { label: 'iL,min', fmt: (v) => formatA(v, true) },
  ibAvg: { label: 'Battery current (average, + charging)', fmt: (v) => formatA(v, true) },
  ihvAvg: { label: 'Bus current (average, + out of the bus)', fmt: (v) => formatA(v, true) },
  phvAvg: { label: 'Bus power (+ bus → battery)', fmt: (v) => formatW(v) },
  plvAvg: { label: 'Battery-side power (+ into the battery)', fmt: (v) => formatW(v) },
  pbatAvg: { label: 'Power into the battery EMF', fmt: (v) => formatW(v) },
  prbAvg: { label: 'Loss in the battery resistance', fmt: (v) => formatW(v) },
  efficiency: { label: 'Converter efficiency', fmt: (v) => `${(v * 100).toFixed(2)} %` },
  direction: { label: 'Power direction', fmt: (v) => String(v) },
  diodeFraction: { label: 'Antiparallel-diode conduction', fmt: (v) => pct(v, 2) },
  dutyMeasured: { label: 'Q1 gate HIGH (fraction of Ts)', fmt: (v) => pct(v, 2) },
  irefError: { label: 'Battery current − reference', fmt: (v) => formatA(v, true) },
  vswAvg: { label: 'Switch node (average)', fmt: (v) => formatV(v, false) },
  'losses.sw': { label: 'Switch losses', fmt: (v) => formatW(v) },
  'losses.dio': { label: 'Diode losses', fmt: (v) => formatW(v) },
  'losses.dcr': { label: 'Inductor DCR loss', fmt: (v) => formatW(v) },
  'losses.esr': { label: 'Capacitor ESR loss', fmt: (v) => formatW(v) },
  'losses.total': { label: 'Converter losses', fmt: (v) => formatW(v) },
}

const BIDI_ANALYSIS: Array<AnalysisCategory<BidiRun, BidiMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['ibAvg', 'phvAvg', 'direction', 'efficiency'] },
  { id: 'lv', label: 'Battery side', rows: ['vlvAvg', 'vlvPP', 'ibAvg', 'plvAvg', 'pbatAvg', 'prbAvg', 'irefError'] },
  { id: 'current', label: 'Inductor current', rows: ['ilAvg', 'ilMax', 'ilMin', 'ilPP'] },
  { id: 'power', label: 'Power flow', rows: ['phvAvg', 'ihvAvg', 'plvAvg', 'losses.total'], note: (m, r) => `THEORY (lossless): IHV = D·IL = ${formatA(r.params.d * m.ilAvg, true)} with the simulated IL.` },
  { id: 'efficiency', label: 'Efficiency', rows: ['efficiency', 'losses.sw', 'losses.dio', 'losses.dcr', 'losses.esr', 'diodeFraction'] },
  { id: 'stress', label: 'Device stress', tab: 'stress' },
]

const BIDI_PARTS = [
  { id: 'hv', label: 'DC bus VHV' },
  { id: 'q1', label: 'Upper switch Q1' },
  { id: 'd1', label: 'Diode D1' },
  { id: 'q2', label: 'Lower switch Q2' },
  { id: 'd2', label: 'Diode D2' },
  { id: 'l', label: 'Inductor L' },
  { id: 'c', label: 'LV capacitor C' },
  { id: 'bat', label: 'Battery' },
]

function bidiInspect(part: string, st: BidiState, m: BidiMeasurements, r: BidiRun): InspectInfo {
  const p = r.params
  const dev = (name: string, on: boolean, i: number, v: number, role: string): InspectInfo => ({ title: name, role, rows: [['State now', on ? 'ON' : 'OFF'], ['Current now', formatA(i, true)], ['Voltage now', formatV(v)]] })
  switch (part) {
    case 'hv':
      return { title: 'DC bus VHV', role: 'A stiff DC bus that can supply power (buck) or absorb it (boost).', rows: [['Voltage', formatV(p.vhv, false)], ['Current now (+ out)', formatA(st.ihv, true)], ['Average power (+ out)', formatW(m.phvAvg)]] }
    case 'q1':
      return { ...dev('Upper switch Q1', st.q1On, st.iq1, st.vq1, 'Connects the switch node to the bus. Forward current in buck mode, reverse current (into the bus) in boost mode.'), rows: [...dev('', st.q1On, st.iq1, st.vq1, '').rows, ['RMS current', formatA(m.iq1Rms)]] }
    case 'q2':
      return { ...dev('Lower switch Q2', st.q2On, st.iq2, st.vq2, 'Connects the switch node to ground. Reverse current (synchronous rectification) in buck mode, forward current in boost mode.'), rows: [...dev('', st.q2On, st.iq2, st.vq2, '').rows, ['RMS current', formatA(m.iq2Rms)]] }
    case 'd1':
      return dev('Diode D1 (antiparallel to Q1)', st.d1On, st.id1, st.vd1, 'Carries a negative iL into the bus during the dead time.')
    case 'd2':
      return dev('Diode D2 (antiparallel to Q2)', st.d2On, st.id2, st.vd2, 'Carries a positive iL from ground during the dead time.')
    case 'l':
      return { title: 'Inductor L', role: 'Its current sets the direction of power flow; its sign reverses between buck and boost.', rows: [['Inductance', formatSI(p.l, 'H')], ['Current now', formatA(st.il, true)], ['diL/dt now', formatSlopeA(st.dildt)], ['Average / peak-to-peak', `${formatA(m.ilAvg, true)} / ${formatA(m.ilPP)}`]] }
    case 'c':
      return { title: 'LV capacitor C', role: 'Takes the ripple current so the battery sees a smooth current.', rows: [['Capacitance', formatSI(p.c, 'F')], ['Current now', formatA(st.ic, true)], ['LV ripple', formatSI(m.vlvPP, 'V')]] }
    case 'bat':
      return { title: 'Battery', role: 'EMF Eb behind its internal resistance Rb. Positive current charges it.', rows: [['EMF / resistance', `${formatV(p.eb, false)} / ${formatSI(p.rb, 'Ω')}`], ['Current now', formatA(st.ib, true)], ['Average current', formatA(m.ibAvg, true)], ['Power into the EMF', formatW(m.pbatAvg)]] }
    case 'sw':
      return { title: 'Switch node', role: 'VHV while the upper leg conducts, 0 while the lower leg conducts.', rows: [['Voltage now', formatV(st.vsw)], ['Average', formatV(m.vswAvg, false)]] }
    default:
      return { title: 'LV node', role: 'The battery terminals.', rows: [['Voltage now', formatV(st.vlv, false)], ['Average', formatV(m.vlvAvg, false)]] }
  }
}

function bidiLessons(): Array<Lesson<BidiParams, BidiRun, BidiMeasurements, BidiState>> {
  return BIDI_LESSONS.map((l) => ({
    ...l,
    steps: l.steps.map((s) => ({
      ...s,
      at: (r: BidiRun) => bidiLessonTime(s.at, r.params),
      window: (r: BidiRun) => [0.5 * r.params.ts, 2.5 * r.params.ts] as [number, number],
    })),
  }))
}

export function bidiTopic(): Topic<BidiParams, BidiRun, BidiMeasurements, BidiState> {
  const model = bidiModel()
  return {
    id: 'bidirectional',
    label: 'Bidirectional',
    title: 'Bidirectional half-bridge converter',
    defaults: BIDI_DEFAULTS,
    basic: BIDI_BASIC,
    advanced: BIDI_ADVANCED,
    viewKey: 'view',
    paramNote: (p, r) => `Applied duty D = ${pct(r.params.d, 2)} · battery at balance when D = Eb/VHV = ${pct(p.eb / p.vhv, 2)}`,
    simulate: (p) => simulateCircuit(model, p),
    measure: measureBidi,
    state: bidiStateAt,
    view: (st) => {
      const rows: StateRow[] = [
        { k: 't', v: `${formatTime(st.t)} (${(st.phase * 100).toFixed(1)} % of Ts)`, full: true },
        { k: 'Switch Q1', v: st.q1On ? 'ON' : 'OFF', tone: st.q1On ? 'on-q' : 'off' },
        { k: 'Switch Q2', v: st.q2On ? 'ON' : 'OFF', tone: st.q2On ? 'on-q' : 'off' },
        { k: 'Diode D1', v: st.d1On ? 'ON' : 'OFF', tone: st.d1On ? 'on-d' : 'off' },
        { k: 'Diode D2', v: st.d2On ? 'ON' : 'OFF', tone: st.d2On ? 'on-d' : 'off' },
        { k: 'iL', v: `${formatA(st.il, true)} · ${formatSlopeA(st.dildt)}`, full: true },
        { k: 'vsw', v: formatV(st.vsw) },
        { k: 'VLV', v: formatV(st.vlv, false) },
        { k: 'Battery current', v: formatA(st.ib, true) },
        { k: 'Bus power now', v: formatW(st.phv), min: 'standard' },
        { k: 'Carried by', v: st.carrier, min: 'standard' },
        { k: 'iQ1 · iQ2', v: `${formatA(st.iq1, true)} · ${formatA(st.iq2, true)}`, min: 'engineer', full: true },
        { k: 'iD1 · iD2', v: `${formatA(st.id1)} · ${formatA(st.id2)}`, min: 'engineer', full: true },
      ]
      const tone = st.leg === 'upper' ? 'on' : st.leg === 'lower' ? 'off' : 'idle'
      return { badge: { text: bidiStatus(st).headline, tone }, rows, path: st.pathText }
    },
    why: bidiWhy,
    Diagram: ({ r, st, selected, onSelect, values, live, showPath }) => <BidiDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={!!live} showPath={showPath} />,
    channels: BIDI_CHANNELS,
    defaultChannels: ['gate1', 'il', 'phv'],
    primaryChannels: ['il', 'phv'],
    addOrder: BIDI_ADD,
    shade: (r, k) => (r.devices[1].on[k] || r.devices[3].on[k] ? (r.devices[0].on[k] || r.devices[2].on[k] ? null : 'rgba(0,131,0,0.12)') : r.devices[0].on[k] ? 'rgba(57,135,229,0.08)' : null),
    shadeLegend: 'blue band: Q1 ON · green band: dead time, a diode conducts',
    eventLabel: bidiEventLabel,
    eventWhy: bidiEventWhy,
    initialCursor: (r) => r.params.ts * (1 + r.params.d / 2),
    periodName: 'period',
    badge: (r, m) => <BidiBadge m={m} r={r} />,
    summary: (_r, m) => `${m.direction === 'buck' ? 'Buck: bus → battery' : 'Boost: battery → bus'} · battery current ${formatA(m.ibAvg, true)} · bus power ${formatW(m.phvAvg)} (SIMULATION)`,
    inspect: bidiInspect,
    analyze: {
      compare: (r, m) => {
        const c = compareBidi(r, m)
        return {
          rows: c.rows,
          allPass: c.allPass,
          header: `Measured on ${m.periods} switching period${m.periods === 1 ? '' : 's'} of the ${r.params.view === 'startup' ? 'end of the start-up run' : 'periodic steady state'}. Direction: ${m.direction} (SIMULATION)${c.directionAgrees ? ', the same in THEORY' : ' — THEORY differs'}.`,
          note: r.params.view === 'startup' && !m.steady ? 'The start-up run has not settled yet: its last period is not the periodic steady state the theory describes.' : undefined,
        }
      },
      theory: (r, m) => <BidiTheory r={r} m={m} />,
      tabs: [{ id: 'stress', label: 'Stress & losses', render: ({ m, r }) => <BidiStress m={m} r={r} /> }],
      convergence: ['ilAvg', 'ilPP'],
    },
    lessons: bidiLessons(),
    experiments: bidiExperiments(),
    predictions: bidiPredictTasks,
    measureLabels: BIDI_LABELS,
    status: (st) => bidiStatus(st),
    next: (r, st) => bidiNextConsequence(r, st)?.text ?? null,
    nextConsequence: (r, st) => bidiNextConsequence(r, st),
    path: (st) => ({ elements: st.path, text: st.pathText, reasons: [] }),
    energyModel: bidiEnergy,
    analysis: BIDI_ANALYSIS,
    parts: BIDI_PARTS,
    readings: (m, r) => [
      reading('ib', 'Battery current, average', formatA(m.ibAvg, true), m.ibAvg >= 0 ? '+ charging (buck mode)' : '− discharging (boost mode)'),
      reading('phv', 'Power from the bus, average', formatW(m.phvAvg), m.phvAvg >= 0 ? 'bus → battery' : 'battery → bus (negative: the bus absorbs)'),
      reading('vlv', 'Battery-side voltage, average', formatV(m.vlvAvg, false), `ideal: VLV = D·VHV = ${formatV(r.params.d * r.params.vhv, false)}`),
      reading('ilpp', 'Inductor current ripple', formatA(m.ilPP), m.reverses ? 'iL changes sign inside every period (no DCM)' : 'ΔiL = VHV·D·(1 − D)/(L·fs)'),
      reading('eff', 'Converter efficiency', pct(m.efficiency, 2), 'output power / input power', 'standard'),
    ],
  }
}

/** The shell-ready topics of the DC-DC lab's "Advanced converters" section. */
export const DCDC_ADVANCED_TOPICS = {
  cuk: coupledTopic('cuk'),
  sepic: coupledTopic('sepic'),
  zeta: coupledTopic('zeta'),
  bidirectional: bidiTopic(),
}
