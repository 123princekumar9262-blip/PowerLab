import { BldcDiagram } from '../components/bldc/BldcDiagram.tsx'
import {
  BLDC_DEFAULTS,
  BLDC_EXPERIMENTS,
  BLDC_LESSONS,
  bldcEnergy,
  bldcEventLabel,
  bldcEventWhy,
  bldcNext,
  bldcPath,
  bldcPredictions,
  bldcReadings,
  bldcStateAt,
  bldcStatus,
  bldcView,
  bldcWhy,
  compareBldc,
  D_LO,
  D_UP,
  hallCode,
  LOWER,
  measureBldc,
  simulateBldc,
  UPPER,
  type BldcState,
} from '../converters/bldc/content.ts'
import { BLDC_LIMITS as L, lastCycle, rpm, type BldcMeasurements, type BldcParams, type BldcRun } from '../converters/bldc/model.ts'
import { textbookBldc } from '../converters/bldc/theory.ts'
import type { AnalysisCategory, ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

const PH = ['a', 'b', 'c']
const CH: Record<string, ChannelMeta> = {
  n: { id: 'n', label: 'n', name: 'Speed [rpm]', unit: '', color: '#199e70', group: 'Speed' },
  ia: { id: 'ia', label: 'ia', name: 'Phase current a', unit: 'A', color: '#d55181', group: 'Phase currents' },
  ib: { id: 'ib', label: 'ib', name: 'Phase current b', unit: 'A', color: '#c98500', group: 'Phase currents' },
  ic: { id: 'ic', label: 'ic', name: 'Phase current c', unit: 'A', color: '#3987e5', dash: [6, 4], group: 'Phase currents' },
  ea: { id: 'ea', label: 'ea', name: 'Back-EMF of phase a', unit: 'V', color: '#d55181', dash: [2, 3], group: 'Back-EMF' },
  eb: { id: 'eb', label: 'eb', name: 'Back-EMF of phase b', unit: 'V', color: '#c98500', dash: [2, 3], group: 'Back-EMF' },
  ec: { id: 'ec', label: 'ec', name: 'Back-EMF of phase c', unit: 'V', color: '#3987e5', dash: [2, 3], group: 'Back-EMF' },
  te: { id: 'te', label: 'Te', name: 'Motor torque [N·m]', unit: '', color: '#d95926', group: 'Torque' },
  tav: { id: 'tav', label: 'T̄e', name: 'Motor torque, PWM-period average [N·m]', unit: '', color: '#9085e9', dash: [6, 4], group: 'Torque' },
  tl: { id: 'tl', label: 'TL', name: 'Load torque [N·m]', unit: '', color: '#aeb7c5', dash: [6, 4], group: 'Torque' },
  ha: { id: 'ha', label: 'Ha', name: 'Hall sensor a', unit: '', color: '#d55181', group: 'Hall sensors', logic: true },
  hb: { id: 'hb', label: 'Hb', name: 'Hall sensor b', unit: '', color: '#c98500', group: 'Hall sensors', logic: true },
  hc: { id: 'hc', label: 'Hc', name: 'Hall sensor c', unit: '', color: '#3987e5', group: 'Hall sensors', logic: true },
  gate: { id: 'gate', label: 'PWM', name: 'PWM gate of the upper switch', unit: '', color: '#aeb7c5', group: 'Gate', logic: true },
  va: { id: 'va', label: 'va', name: 'Leg a voltage (to DC−)', unit: 'V', color: '#d55181', group: 'Leg voltages' },
  vb: { id: 'vb', label: 'vb', name: 'Leg b voltage (to DC−)', unit: 'V', color: '#c98500', group: 'Leg voltages' },
  vc: { id: 'vc', label: 'vc', name: 'Leg c voltage (to DC−)', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Leg voltages' },
  vn: { id: 'vn', label: 'vn', name: 'Star point voltage (to DC−)', unit: 'V', color: '#aeb7c5', group: 'Leg voltages' },
  vab: { id: 'vab', label: 'vab', name: 'Line voltage a−b', unit: 'V', color: '#3987e5', group: 'Line voltage' },
  theta: { id: 'theta', label: 'θe', name: 'Rotor angle, electrical [°]', unit: '', color: '#199e70', dash: [2, 3], group: 'Angle' },
  idc: { id: 'idc', label: 'idc', name: 'DC-link current', unit: 'A', color: '#9085e9', group: 'DC link' },
  pin: { id: 'pin', label: 'Pdc', name: 'Power from the DC supply', unit: 'W', color: '#9085e9', group: 'Power' },
  duty: { id: 'duty', label: 'd', name: 'Duty ratio', unit: '', color: '#c98500', group: 'Duty' },
}

/** Largest |phase current| of the run (cached per run): currents below 1e-3 of it are drawn as not flowing. */
const PEAK = new WeakMap<BldcRun, number>()
function phasePeak(r: BldcRun): number {
  let v = PEAK.get(r)
  if (v === undefined) {
    v = 0
    for (const a of [r.signals.ia, r.signals.ib, r.signals.ic]) for (let k = 0; k < a.length; k++) v = Math.max(v, Math.abs(a[k]))
    PEAK.set(r, v)
  }
  return v
}

const ANALYSIS: Array<AnalysisCategory<BldcRun, BldcMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['nEnd', 'teMean', 'iPair', 'ripple'] },
  { id: 'speed', label: 'Speed', rows: ['nEnd', 'fe', 't90', 'wPre'], note: (m) => (m.settled ? undefined : 'The run had not settled at its end.') },
  { id: 'current', label: 'Current', rows: ['iPair', 'idcMean', 'irms', 'iPeakCycle', 'iPeak'] },
  { id: 'torque', label: 'Torque ripple', rows: ['teMean', 'teMin', 'teMax', 'ripple', 'dipUp', 'dipLow', 'tcUp', 'tcLow'], note: (_m, r) => (r.params.chop === 'pwm' ? 'With PWM chopping the ripple is taken on the torque averaged over each PWM period (the switching ripple removed).' : undefined) },
  { id: 'power', label: 'Power', rows: ['pin', 'pcu', 'pshaft', 'pfr', 'eff'] },
]

const PARTS = [
  { id: 'vdc', label: 'DC supply' },
  ...UPPER.map((s) => ({ id: s.toLowerCase(), label: `Upper switch ${s}` })),
  ...LOWER.map((s) => ({ id: s.toLowerCase(), label: `Lower switch ${s}` })),
  ...PH.map((x) => ({ id: `ph-${x}`, label: `Phase ${x} winding` })),
  { id: 'rotor', label: 'Rotor and Hall sensors' },
  { id: 'load', label: 'Mechanical load' },
]

const fmtT = (v: number) => `${v.toFixed(3)} N·m`
const fmtS = (v: number | null) => (v === null ? '—' : formatTime(v))

export const BLDC_TOPIC: Topic<BldcParams, BldcRun, BldcMeasurements, BldcState> = {
  id: 'bldc',
  label: 'BLDC motor',
  title: 'BLDC motor: six-step inverter with Hall sensors',
  defaults: BLDC_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'chop',
      label: 'Speed control',
      options: [
        { value: 'pwm', label: 'PWM chopping', title: 'The upper switch of the conducting pair is chopped at duty d: the pair sees d·Vdc on average' },
        { value: 'none', label: 'Six-step, full Vdc', title: 'No chopping: the pair sees the full Vdc (the highest speed)' },
      ],
    },
    { kind: 'number', key: 'duty', label: 'Duty ratio d', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 1, when: (p) => p.chop === 'pwm' },
    { kind: 'number', key: 'tl', label: 'Load torque TL', unit: 'N·m', min: L.tl.min, max: L.tl.max, step: 0.01 },
    {
      kind: 'choice',
      key: 'event',
      label: 'Step during the run',
      options: [
        { value: 'none', label: 'None' },
        { value: 'load', label: 'Load step', title: 'The load torque changes once the drive has settled' },
        { value: 'duty', label: 'Duty step', title: 'The duty changes once the drive has settled (PWM chopping)' },
      ],
    },
    { kind: 'number', key: 'tl2', label: 'Load torque after the step', unit: 'N·m', min: L.tl2.min, max: L.tl2.max, step: 0.01, when: (p) => p.event === 'load' },
    { kind: 'number', key: 'd2', label: 'Duty after the step', unit: '%', scale: 0.01, min: L.d2.min, max: L.d2.max, step: 1, when: (p) => p.event === 'duty' && p.chop === 'pwm' },
  ],
  advanced: [
    { kind: 'number', key: 'vdc', label: 'DC-link voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'fs', label: 'PWM frequency', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
    { kind: 'number', key: 'r', label: 'Phase resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
    { kind: 'number', key: 'l', label: 'Phase inductance L (self − mutual)', unit: 'mH', scale: 1e-3, min: L.l.min, max: L.l.max, log: true },
    { kind: 'number', key: 'ke', label: 'Back-EMF constant ke (per phase)', unit: 'V·s/rad', min: L.ke.min, max: L.ke.max, log: true },
    { kind: 'number', key: 'pp', label: 'Pole pairs p', unit: '', min: L.pp.min, max: L.pp.max, step: 1 },
    { kind: 'number', key: 'j', label: 'Inertia J', unit: 'kg·cm²', scale: 1e-4, min: L.j.min, max: L.j.max, log: true },
    { kind: 'number', key: 'b', label: 'Viscous friction B', unit: 'mN·m·s', scale: 1e-3, min: L.b.min, max: L.b.max, step: 0.001 },
    { kind: 'number', key: 'theta0', label: 'Rotor angle at rest (electrical)', unit: '°', min: L.theta0.min, max: L.theta0.max, step: 1 },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    const tb = textbookBldc(p)
    return `L/R = ${formatTime(p.tauE)} · J·R/(2ke²) = ${formatTime(p.tauM)} · textbook speed ${rpm(tb.w).toFixed(0)} rpm · window ${formatTime(p.duration)}${r.diagnostics.issues.length ? ` · ${r.diagnostics.issues.join('; ')}` : ''}`
  },
  // the convergence check of the shell asks for a 'steady' one-period run: this drive always starts from rest
  simulate: (p) => {
    const q = { ...p } as BldcParams & { view?: string }
    if (q.view === 'steady') {
      delete q.view
      q.periods = 0
    }
    return simulateBldc(q)
  },
  measure: measureBldc,
  state: bldcStateAt,
  view: (st, r) => bldcView(st, r),
  why: bldcWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => (
    <BldcDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} iFloor={1e-3 * phasePeak(r)} />
  ),
  channels: CH,
  defaultChannels: ['n', 'ia', 'ib', 'ic', 'te'],
  primaryChannels: ['ia', 'ib', 'ic'],
  addOrder: ['n', 'ia', 'ib', 'ic', 'te', 'tav', 'tl', 'ea', 'eb', 'ec', 'ha', 'hb', 'hc', 'gate', 'va', 'vb', 'vc', 'vn', 'vab', 'theta', 'idc', 'pin', 'duty'],
  shade: (r, k) => (r.nconn[k] === 3 ? 'rgba(217, 89, 38, 0.14)' : r.nconn[k] < 2 ? 'rgba(174,183,197,0.22)' : null),
  shadeLegend: 'orange band: commutation (three phases conduct) · grey band: no current',
  eventLabel: bldcEventLabel,
  eventWhy: bldcEventWhy,
  eventColor: (e) => (e.kind === 'diode-off' ? '#22b14c' : e.device === 'peak' ? '#e66767' : e.device?.startsWith('hall') ? '#c98500' : '#3987e5'),
  initialCursor: (r) => {
    const c = lastCycle(r)
    if (!c) return r.params.duration - 0.5 * r.params.period
    // just after an upper commutation in the last cycle: three phases conduct
    const cm = r.comms.find((x) => x.tHall >= c[0].t && x.upper && x.tEnd !== null)
    return cm ? cm.tHall + 0.5 * (cm.tEnd! - cm.tHall) : 0.5 * (c[0].t + c[1].t)
  },
  periodName: 'PWM period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Operating point">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{r.params.chop === 'pwm' ? `PWM ${(r.params.duties[r.params.periods - 1] * 100).toFixed(0)} %` : 'SIX-STEP'}</span>
        <span className="small">
          {m.nEnd.toFixed(0)} rpm · {m.teMean.toFixed(3)} N·m · ripple {(m.ripple * 100).toFixed(0)} %<span className="muted"> · SIMULATION{m.settled ? ', settled' : ', still settling'}</span>
        </span>
      </div>
      <p className="muted small">
        start-up peak {formatA(m.iPeak)} · t90 {fmtS(m.t90)} · commutation {fmtS(m.tcUp)} / {fmtS(m.tcLow)}
      </p>
    </section>
  ),
  summary: (_r, m) => `${m.nEnd.toFixed(0)} rpm · torque ripple ${(m.ripple * 100).toFixed(0)} % (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    const leg = (s: string) => [UPPER, LOWER, D_UP, D_LO].map((a) => a.indexOf(s)).find((x) => x >= 0) ?? 0
    const up = part.toUpperCase()
    if ([...UPPER, ...LOWER].includes(up)) {
      const x = leg(up)
      const upper = UPPER.includes(up)
      const on = st.device[x] === up
      return {
        title: `${upper ? 'Upper' : 'Lower'} switch ${up} (phase ${PH[x]})`,
        role: upper ? `Connects phase ${PH[x]} to Vdc while its Hall sector asks for ${PH[x]}+${p.chop === 'pwm' ? ', chopped by the PWM' : ''}.` : `Connects phase ${PH[x]} to DC− for the 120° its Hall sectors ask for ${PH[x]}−; never chopped.`,
        rows: [
          ['State now', on ? 'CONDUCTING' : (upper ? st.legs[x] === 'H' : st.legs[x] === 'L') ? 'GATED (no current through it)' : 'OFF'],
          ['Phase current now', formatA(st.i[x], true)],
          ['Hall sector now', `${st.sector + 1} (${hallCode(st.hall)})`],
          ['PWM', p.chop === 'pwm' ? `${formatSI(p.fs, 'Hz')}, d = ${(st.duty * 100).toFixed(0)} %` : 'none (six-step)'],
        ],
      }
    }
    if ([...D_UP, ...D_LO].includes(up)) {
      const x = leg(up)
      const on = st.device[x] === up
      return {
        title: `Freewheeling diode ${up} (phase ${PH[x]})`,
        role: `Carries phase ${PH[x]}'s current when no switch of its leg is on: after each commutation (the outgoing current decays through it) and, for the lower diodes, during the PWM off-time.`,
        rows: [
          ['State now', on ? 'CONDUCTING' : 'BLOCKING'],
          ['Phase current now', formatA(st.i[x], true)],
          ['Commutation time (last cycle)', `${fmtS(m.tcUp)} upper / ${fmtS(m.tcLow)} lower`],
        ],
      }
    }
    if (part.startsWith('ph-')) {
      const x = PH.indexOf(part.slice(3))
      return {
        title: `Phase ${PH[x]} winding`,
        role: 'R and L in series with a trapezoidal back-EMF ke·ω·f(θ) — flat for 120° at ±ke·ω.',
        rows: [
          ['State now', st.device[x] ? `CONDUCTING via ${st.device[x]}` : 'OPEN'],
          ['Current now', formatA(st.i[x], true)],
          ['Back-EMF now', formatV(st.e[x])],
          ['R, L', `${formatSI(p.r, 'Ω')}, ${formatSI(p.l, 'H')}`],
          ['ke', `${p.ke} V·s/rad (flat-top EMF ke·ω)`],
          ['RMS current (last cycle)', formatA(m.irms)],
        ],
      }
    }
    if (part === 'rotor')
      return {
        title: 'Rotor and Hall sensors',
        role: 'Permanent magnets on the rotor; three Hall sensors, 120° apart, tell the controller which 60° sector the rotor is in.',
        rows: [
          ['Speed now', `${st.n.toFixed(0)} rpm`],
          ['Rotor angle (electrical)', `${st.theta.toFixed(1)}°`],
          ['Hall code a b c', hallCode(st.hall)],
          ['Torque now', fmtT(st.te)],
          ['Pole pairs', String(p.pp)],
          ['J, B', `${formatSI(p.j, 'kg·m²')}, ${formatSI(p.b, 'N·m·s')}`],
        ],
      }
    if (part === 'load') return { title: 'Mechanical load', role: 'A constant torque opposing the motor, plus viscous friction B·ω.', rows: [['Load torque now', fmtT(st.tl)], ['Shaft power (last cycle)', formatW(m.pshaft)]] }
    return { title: 'DC supply', role: 'The DC link feeding the inverter.', rows: [['Vdc', formatV(p.vdc, false)], ['DC current now', formatA(st.idc, true)], ['Mean power (last cycle)', formatW(m.pin)]] }
  },
  analyze: {
    compare: compareBldc,
    theory: (r) => {
      const p = r.params
      const tb = textbookBldc(p)
      return (
        <>
          <h3>The BLDC drive</h3>
          <ol className="derivation">
            <li>
              <b>Phases</b> — <span className="mono">L·dix/dt = vx − vn − R·ix − ex</span>, <span className="mono">ex = ke·ω·f(θe − k·120°)</span>, f a trapezoid with 120° flat tops; star point: ia + ib + ic = 0.
            </li>
            <li>
              <b>Torque and shaft</b> — <span className="mono">Te = ke·Σ f(θx)·ix</span>, <span className="mono">J·dω/dt = Te − B·ω − TL</span>, <span className="mono">dθe/dt = p·ω</span>.
            </li>
            <li>
              <b>Six-step</b> — the Hall code switches on one upper and one lower device; with both EMFs on their flat tops the pair is a DC machine: <span className="mono">d·Vdc = 2·ke·ω + 2·R·I</span>, <span className="mono">Te = 2·ke·I</span>. Textbook speed {rpm(tb.w).toFixed(0)} rpm, I = {formatA(tb.i)}.
            </li>
            <li>
              <b>Commutation</b> (R neglected, EMFs frozen at ±E): the outgoing current falls through a diode while the incoming one rises; the third phase changes by <span className="mono">ΔT/T = (d·Vdc − 4E)/(d·Vdc + 2E)</span> (upper) = {(tb.dipUp * 100).toFixed(1)} %, <span className="mono">(2d·Vdc − Vdc − 4E)/((2 − d)·Vdc + 2E)</span> (lower) = {(tb.dipLow * 100).toFixed(1)} %, in{' '}
              <span className="mono">tc = 3·L·I/(d·Vdc + 2E)</span> = {formatTime(tb.tcUp)} and <span className="mono">3·L·I/((2 − d)·Vdc + 2E)</span> = {formatTime(tb.tcLow)}.
            </li>
          </ol>
          <p className="small">
            The exact THEORY freezes the speed: the EMFs are then linear in time inside each sector, so the same phase equations and diode rules are solved exactly (matrix exponential), the periodic orbit found by Newton on the 120° map, and the speed from the torque balance. It includes R, the sloping EMF of the outgoing phase and the commutation, which the textbook formulas leave out.{' '}
            {p.chop === 'pwm' ? 'With PWM the theory uses the mean voltage d·Vdc of the chopped switch: the switching ripple is the only modelled effect it omits.' : ''}
          </p>
        </>
      )
    },
    convergence: ['nEnd', 'tcUp'],
  },
  lessons: BLDC_LESSONS,
  experiments: BLDC_EXPERIMENTS,
  predictions: bldcPredictions,
  measureLabels: {
    nEnd: { label: 'Speed', fmt: (v) => `${v.toFixed(0)} rpm` },
    wEnd: { label: 'Speed', fmt: (v) => `${v.toFixed(1)} rad/s` },
    wPre: { label: 'Speed before the step', fmt: (v) => `${rpm(v).toFixed(0)} rpm` },
    fe: { label: 'Electrical frequency', fmt: (v) => formatSI(v, 'Hz') },
    t90: { label: 'Time to 90 % speed', fmt: (v) => formatTime(v) },
    teMean: { label: 'Torque (mean)', fmt: fmtT },
    teMin: { label: 'Torque (min)', fmt: fmtT },
    teMax: { label: 'Torque (max)', fmt: fmtT },
    ripple: { label: 'Torque ripple', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    dipUp: { label: 'Torque step, upper commutation', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    dipLow: { label: 'Torque step, lower commutation', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    tcUp: { label: 'Commutation time (upper)', fmt: (v) => formatTime(v) },
    tcLow: { label: 'Commutation time (lower)', fmt: (v) => formatTime(v) },
    iPair: { label: 'Pair current I = ī_dc/d', fmt: (v) => formatA(v) },
    idcMean: { label: 'DC-link current (mean)', fmt: (v) => formatA(v) },
    irms: { label: 'Phase current (RMS)', fmt: (v) => formatA(v) },
    iPeakCycle: { label: 'Phase current peak (running)', fmt: (v) => formatA(v) },
    iPeak: { label: 'Phase current peak (start-up)', fmt: (v) => formatA(v) },
    pin: { label: 'Power from the supply', fmt: (v) => formatW(v) },
    pcu: { label: 'Copper loss', fmt: (v) => formatW(v) },
    pshaft: { label: 'Load power', fmt: (v) => formatW(v) },
    pfr: { label: 'Friction loss', fmt: (v) => formatW(v) },
    eff: { label: 'Efficiency', fmt: (v) => `${(v * 100).toFixed(1)} %` },
  },
  status: (st, r) => bldcStatus(st, r),
  next: (r, st) => bldcNext(r, st)?.text ?? null,
  nextConsequence: (r, st) => bldcNext(r, st),
  path: (st, r) => bldcPath(st, r),
  energyModel: (st, m, r) => bldcEnergy(st, m, r),
  analysis: ANALYSIS,
  parts: PARTS,
  readings: bldcReadings,
}
