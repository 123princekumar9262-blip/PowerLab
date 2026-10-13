import { PmsmDiagram } from '../components/pmsm/PmsmDiagram.tsx'
import {
  comparePmsm,
  measurePmsm,
  PMSM_DEFAULTS,
  PMSM_EXPERIMENTS,
  PMSM_LESSONS,
  pmsmEnergy,
  pmsmEventLabel,
  pmsmEventWhy,
  pmsmNext,
  pmsmPredictions,
  pmsmReadings,
  pmsmStateAt,
  pmsmStatus,
  pmsmView,
  pmsmWhy,
  simulatePmsm,
  type PmsmState,
} from '../converters/pmsm/content.ts'
import { PMSM_LIMITS as L, rpm, type PmsmMeasurements, type PmsmParams, type PmsmRun } from '../converters/pmsm/model.ts'
import { textbookPmsm } from '../converters/pmsm/theory.ts'
import type { AnalysisCategory, ChannelMeta, Topic } from '../lab/types.ts'
import type { CurrentPath } from '../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  n: { id: 'n', label: 'n', name: 'Speed [rpm]', unit: '', color: '#199e70', group: 'Speed' },
  nref: { id: 'nref', label: 'n*', name: 'Speed reference [rpm]', unit: '', color: '#199e70', dash: [6, 4], group: 'Speed' },
  iq: { id: 'iq', label: 'iq', name: 'q-axis current (torque)', unit: 'A', color: '#d95926', group: 'd–q currents' },
  iqref: { id: 'iqref', label: 'iq*', name: 'q-axis current reference', unit: 'A', color: '#d95926', dash: [6, 4], group: 'd–q currents' },
  id: { id: 'id', label: 'id', name: 'd-axis current (flux)', unit: 'A', color: '#9085e9', group: 'd–q currents' },
  idref: { id: 'idref', label: 'id*', name: 'd-axis current reference', unit: 'A', color: '#9085e9', dash: [6, 4], group: 'd–q currents' },
  ia: { id: 'ia', label: 'ia', name: 'Phase current a', unit: 'A', color: '#d55181', group: 'Phase currents' },
  ib: { id: 'ib', label: 'ib', name: 'Phase current b', unit: 'A', color: '#c98500', group: 'Phase currents' },
  ic: { id: 'ic', label: 'ic', name: 'Phase current c', unit: 'A', color: '#3987e5', dash: [6, 4], group: 'Phase currents' },
  va: { id: 'va', label: 'va', name: 'Phase voltage a (averaged)', unit: 'V', color: '#d55181', group: 'Phase voltages' },
  vb: { id: 'vb', label: 'vb', name: 'Phase voltage b (averaged)', unit: 'V', color: '#c98500', group: 'Phase voltages' },
  vc: { id: 'vc', label: 'vc', name: 'Phase voltage c (averaged)', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Phase voltages' },
  vd: { id: 'vd', label: 'vd', name: 'd-axis voltage', unit: 'V', color: '#9085e9', group: 'd–q voltages' },
  vq: { id: 'vq', label: 'vq', name: 'q-axis voltage', unit: 'V', color: '#d95926', group: 'd–q voltages' },
  vmag: { id: 'vmag', label: '|v|', name: 'Voltage magnitude √(vd² + vq²)', unit: 'V', color: '#3987e5', group: 'd–q voltages' },
  vmax: { id: 'vmax', label: 'Vdc/√3', name: 'Inverter voltage limit Vdc/√3', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'd–q voltages' },
  te: { id: 'te', label: 'Te', name: 'Motor torque [N·m]', unit: '', color: '#d95926', group: 'Torque' },
  tl: { id: 'tl', label: 'TL', name: 'Load torque [N·m]', unit: '', color: '#aeb7c5', dash: [6, 4], group: 'Torque' },
  theta: { id: 'theta', label: 'θe', name: 'Rotor angle, electrical [°]', unit: '', color: '#199e70', dash: [2, 3], group: 'Angle' },
  pel: { id: 'pel', label: 'Pel', name: 'Electrical power 1.5·(vd·id + vq·iq)', unit: 'W', color: '#9085e9', group: 'Power' },
  pmech: { id: 'pmech', label: 'Pm', name: 'Mechanical power Te·ω', unit: 'W', color: '#199e70', dash: [6, 4], group: 'Power' },
}

/** Largest |phase current| and |Pel| of the run (cached per run): smaller than 1e-3 of them counts as not flowing. */
const PEAKS = new WeakMap<PmsmRun, { i: number; p: number }>()
function pmsmPeaks(r: PmsmRun): { i: number; p: number } {
  let v = PEAKS.get(r)
  if (v === undefined) {
    const s = r.signals
    let i = 0
    let pw = 0
    for (let k = 0; k < r.length; k++) {
      i = Math.max(i, Math.abs(s.ia[k]), Math.abs(s.ib[k]), Math.abs(s.ic[k]))
      pw = Math.max(pw, Math.abs(s.pel[k]))
    }
    v = { i, p: pw }
    PEAKS.set(r, v)
  }
  return v
}

/** The power path at the cursor, in words, from the simulated electrical power and phase currents. */
function pmsmPath(st: PmsmState, r: PmsmRun): CurrentPath {
  const floor = 1e-3 * pmsmPeaks(r).p
  const cur = st.i.map((x, k) => `i${'abc'[k]} ${formatA(x, true)}`).join(', ')
  if (st.pel > floor) return { elements: ['inv', 'motor'], text: `DC link → inverter → windings (${cur}) → shaft: ${formatW(st.pel)} into the motor`, reasons: [] }
  if (st.pel < -floor) return { elements: ['motor', 'inv'], text: `shaft → windings (${cur}) → inverter → DC link: generating, ${formatW(-st.pel)} back`, reasons: [] }
  return { elements: [], text: `no power flows between the DC link and the motor at this instant (${cur})`, reasons: [] }
}

const ANALYSIS: Array<AnalysisCategory<PmsmRun, PmsmMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['nEnd', 'iqEnd', 'idEnd', 'overshoot', 'dipRpm'] },
  { id: 'current', label: 'Current loop', rows: ['iqRise', 'iqPeak', 'idPeak', 'iAmp', 'iaRms'] },
  { id: 'speed', label: 'Speed loop', rows: ['tDesat', 't90', 'overshoot', 'tPeak', 'dipRpm', 'tDip'] },
  { id: 'voltage', label: 'Voltage', rows: ['vdEnd', 'vqEnd', 'vEnd', 'vlimFrac', 'fwFrac'], note: (_m, r) => `Inverter limit Vdc/√3 = ${formatV(r.params.vmax, false)} (space-vector PWM, linear range). The inverter is averaged: no switching ripple.` },
  { id: 'power', label: 'Power', rows: ['pel', 'pcu', 'pshaft', 'eff'] },
]

const PARTS = [
  { id: 'speedpi', label: 'Speed PI controller' },
  { id: 'idref', label: 'id reference' },
  { id: 'piq', label: 'q-axis current PI' },
  { id: 'pid', label: 'd-axis current PI' },
  { id: 'park', label: 'Inverse Park transform' },
  { id: 'inv', label: 'Inverter (averaged)' },
  { id: 'motor', label: 'PMSM' },
  { id: 'clarke', label: 'Park transform (feedback)' },
  { id: 'vectors', label: 'Rotor-frame vectors' },
]

const fmtS = (v: number) => formatTime(v)

export const PMSM_TOPIC: Topic<PmsmParams, PmsmRun, PmsmMeasurements, PmsmState> = {
  id: 'pmsm',
  label: 'PMSM (FOC)',
  title: 'PMSM with field-oriented control',
  defaults: PMSM_DEFAULTS,
  basic: [
    { kind: 'number', key: 'nref', label: 'Speed reference', unit: 'rpm', min: L.nref.min, max: L.nref.max, step: 10 },
    { kind: 'number', key: 'tl', label: 'Load torque TL', unit: 'N·m', min: L.tl.min, max: L.tl.max, step: 0.01 },
    {
      kind: 'choice',
      key: 'event',
      label: 'Steps during the run',
      options: [
        { value: 'both', label: 'Speed + load', title: 'A speed step, then a load step' },
        { value: 'speed', label: 'Speed step' },
        { value: 'load', label: 'Load step' },
        { value: 'none', label: 'None' },
      ],
    },
    { kind: 'number', key: 'n2', label: 'Speed after the step', unit: 'rpm', min: L.n2.min, max: L.n2.max, step: 10, when: (p) => p.event === 'speed' || p.event === 'both' },
    { kind: 'number', key: 'tl2', label: 'Load after the step', unit: 'N·m', min: L.tl2.min, max: L.tl2.max, step: 0.01, when: (p) => p.event === 'load' || p.event === 'both' },
    {
      kind: 'choice',
      key: 'control',
      label: 'd-axis current',
      options: [
        { value: 'id0', label: 'id = 0', title: 'All the current makes torque; the speed is limited by the voltage' },
        { value: 'fw', label: 'Field weakening', title: 'Negative id above base speed, to stay within the voltage limit' },
      ],
    },
  ],
  advanced: [
    { kind: 'choice', key: 'decouple', label: 'Decoupling feed-forward', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
    { kind: 'number', key: 'fcc', label: 'Current-loop bandwidth', unit: 'Hz', min: L.fcc.min, max: L.fcc.max, log: true },
    { kind: 'number', key: 'fsc', label: 'Speed-loop bandwidth', unit: 'Hz', min: L.fsc.min, max: L.fsc.max, log: true },
    { kind: 'number', key: 'zeta', label: 'Speed-loop damping ζ', unit: '', min: L.zeta.min, max: L.zeta.max, step: 0.05 },
    { kind: 'number', key: 'imax', label: 'Current limit Imax', unit: 'A', min: L.imax.min, max: L.imax.max, log: true },
    { kind: 'number', key: 'vdc', label: 'DC-link voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'r', label: 'Phase resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
    { kind: 'number', key: 'ld', label: 'd-axis inductance Ld', unit: 'mH', scale: 1e-3, min: L.ld.min, max: L.ld.max, log: true },
    { kind: 'number', key: 'lq', label: 'q-axis inductance Lq', unit: 'mH', scale: 1e-3, min: L.lq.min, max: L.lq.max, log: true },
    { kind: 'number', key: 'psi', label: 'Magnet flux linkage ψ', unit: 'mWb', scale: 1e-3, min: L.psi.min, max: L.psi.max, log: true },
    { kind: 'number', key: 'pp', label: 'Pole pairs p', unit: '', min: L.pp.min, max: L.pp.max, step: 1 },
    { kind: 'number', key: 'j', label: 'Inertia J', unit: 'kg·cm²', scale: 1e-4, min: L.j.min, max: L.j.max, log: true },
    { kind: 'number', key: 'b', label: 'Viscous friction B', unit: 'mN·m·s', scale: 1e-3, min: L.b.min, max: L.b.max, step: 0.001 },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    return `kt = 1.5·p·ψ = ${p.kt.toFixed(4)} N·m/A · base speed ≈ ${rpm(p.vmax / (p.pp * p.psi)).toFixed(0)} rpm · Kp = ${p.kpq.toFixed(3)} V/A, Ki = ${p.ki.toFixed(0)} V/(A·s) · window ${formatTime(p.duration)}${r.diagnostics.issues.length ? ` · ${r.diagnostics.issues.join('; ')}` : ''}`
  },
  // the convergence check of the shell asks for a 'steady' one-period run: this drive always starts from rest
  simulate: (p) => {
    const q = { ...p } as PmsmParams & { view?: string; periods?: number }
    delete q.view
    delete q.periods
    return simulatePmsm(q)
  },
  measure: measurePmsm,
  state: pmsmStateAt,
  view: (st, r) => pmsmView(st, r),
  why: pmsmWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => {
    const pk = pmsmPeaks(r)
    return <PmsmDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} iFloor={1e-3 * pk.i} pFloor={1e-3 * pk.p} />
  },
  path: (st, r) => pmsmPath(st, r),
  channels: CH,
  defaultChannels: ['n', 'nref', 'iq', 'id', 'ia'],
  primaryChannels: ['n', 'nref'],
  addOrder: ['n', 'nref', 'iq', 'iqref', 'id', 'idref', 'ia', 'ib', 'ic', 'te', 'tl', 'vd', 'vq', 'vmag', 'vmax', 'va', 'vb', 'vc', 'theta', 'pel', 'pmech'],
  shade: (r, k) => (r.vlim[k] ? 'rgba(230, 103, 103, 0.14)' : r.sat[k] !== 0 ? 'rgba(201, 133, 0, 0.13)' : r.fwOn[k] ? 'rgba(144, 133, 233, 0.13)' : null),
  shadeLegend: 'amber band: speed PI at the current limit · red band: voltage limit · violet band: field weakening',
  eventLabel: pmsmEventLabel,
  eventWhy: pmsmEventWhy,
  eventColor: (e) => (e.device === 'speed-step' || e.device === 'load-step' ? '#3987e5' : e.device === 'vlim' ? '#e66767' : e.device?.startsWith('fw') ? '#9085e9' : '#c98500'),
  initialCursor: (r) => r.params.duration - 0.25 * r.params.period,
  periodName: 'electrical period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Operating point">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{r.params.control === 'fw' ? (m.fwFrac > 0 ? 'FIELD WEAKENING' : 'FW READY') : 'id = 0'}</span>
        <span className="small">
          {m.nEnd.toFixed(0)} rpm · iq {formatA(m.iqEnd)} · id {formatA(m.idEnd, true)}
          <span className="muted"> · SIMULATION{m.settled ? ', settled' : ', still settling'}</span>
        </span>
      </div>
      <p className="muted small">
        iq rise {m.iqRise === null ? '—' : fmtS(m.iqRise)} · overshoot {m.overshoot === null ? '—' : `${(m.overshoot * 100).toFixed(1)} %`} · load dip {m.dip === null ? '—' : `${rpm(m.dip).toFixed(0)} rpm`}
        {m.vlimFrac > 0 ? ` · voltage-limited ${(m.vlimFrac * 100).toFixed(1)} % of the run` : ''}
      </p>
    </section>
  ),
  summary: (_r, m) => `${m.nEnd.toFixed(0)} rpm · iq ${formatA(m.iqEnd)} (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'speedpi')
      return {
        title: 'Speed PI controller',
        role: 'Turns the speed error into a torque-current reference iq*, limited to the current limit; its integrator is frozen while limited (anti-windup).',
        rows: [
          ['State now', st.sat !== 0 ? 'AT THE CURRENT LIMIT' : 'LINEAR'],
          ['Speed error now', `${(st.nref - st.n).toFixed(1)} rpm`],
          ['iq* now', formatA(st.iqref, true)],
          ['Kpω, Kiω', `${p.kpw.toFixed(4)} A·s/rad, ${p.kiw.toFixed(3)} A/rad`],
          ['Tuning', `ωs = 2π·${p.fsc} Hz, ζ = ${p.zeta}: Kiω = J·ωs²/kt, Kpω = (2ζωs·J − B)/kt`],
        ],
      }
    if (part === 'piq' || part === 'pid') {
      const q = part === 'piq'
      return {
        title: `${q ? 'q' : 'd'}-axis current PI`,
        role: `Holds ${q ? 'iq (torque)' : 'id (flux)'} on its reference. Its zero cancels the winding pole R/L${q ? 'q' : 'd'}: the closed loop is first order with bandwidth ωc.`,
        rows: [
          ['Reference / actual now', `${formatA(q ? st.iqref : st.idref, true)} / ${formatA(q ? st.iq : st.id, true)}`],
          ['Output now', formatV(q ? st.vq : st.vd)],
          ['Kp = ωc·L, Ki = ωc·R', `${(q ? p.kpq : p.kpd).toFixed(3)} V/A, ${p.ki.toFixed(0)} V/(A·s)`],
          ['Bandwidth', `${p.fcc} Hz (rise ln 9/ωc = ${formatTime(Math.log(9) / p.wc)})`],
          ['Decoupling', p.decouple === 'on' ? (q ? '+ωe·(Ld·id + ψ) added' : '−ωe·Lq·iq added') : 'off'],
        ],
      }
    }
    if (part === 'idref')
      return {
        title: p.control === 'fw' ? 'Field-weakening id reference' : 'id reference',
        role: p.control === 'fw' ? 'Zero below base speed; above it an integrator lowers id* while the voltage demand exceeds 95 % of Vdc/√3.' : 'Zero: all the current makes torque (maximum torque per ampere for a surface-magnet machine).',
        rows: [
          ['id* now', formatA(st.idref, true)],
          ['Field weakening', st.fw ? 'ACTIVE' : 'inactive'],
        ],
      }
    if (part === 'park' || part === 'clarke')
      return {
        title: part === 'park' ? 'Inverse Park transform' : 'Park transform',
        role: part === 'park' ? 'Turns the d–q voltage commands into three phase voltages, using the rotor angle θe.' : 'Turns the three measured phase currents into id and iq, seen from the rotor.',
        rows: [
          ['θe now', `${st.theta.toFixed(1)}°`],
          ['ia, ib, ic', st.i.map((x) => formatA(x, true)).join(', ')],
          ['id, iq', `${formatA(st.id, true)}, ${formatA(st.iq, true)}`],
        ],
      }
    if (part === 'inv')
      return {
        title: 'Inverter (averaged)',
        role: 'Delivers the commanded phase voltages exactly (the switching ripple is not modelled), up to the space-vector limit |v| ≤ Vdc/√3.',
        rows: [
          ['State now', st.vlim ? 'AT THE VOLTAGE LIMIT' : 'WITHIN RANGE'],
          ['|v| / limit', `${formatV(st.vmag, false)} / ${formatV(st.vmax, false)}`],
          ['va, vb, vc', st.v.map((x) => formatV(x)).join(', ')],
          ['Time at the limit', `${(m.vlimFrac * 100).toFixed(2)} % of the run`],
        ],
      }
    if (part === 'vectors')
      return {
        title: 'Current and voltage in the rotor frame',
        role: 'd along the magnet, q 90° ahead. With id = 0 the current is all on q; the voltage leans toward q (back-EMF ωe·ψ) and slightly to −d (−ωe·Lq·iq).',
        rows: [
          ['i = (id, iq)', `(${formatA(st.id, true)}, ${formatA(st.iq, true)}) of Imax ${formatA(p.imax)}`],
          ['v = (vd, vq)', `(${formatV(st.vd)}, ${formatV(st.vq)}) of ${formatV(p.vmax, false)}`],
        ],
      }
    return {
      title: 'Permanent-magnet synchronous motor',
      role: 'Sinusoidal back-EMF ωe·ψ; torque 1.5·p·(ψ·iq + (Ld − Lq)·id·iq).',
      rows: [
        ['Speed now', `${st.n.toFixed(0)} rpm`],
        ['Torque now', `${st.te.toFixed(3)} N·m`],
        ['R, Ld, Lq', `${formatSI(p.r, 'Ω')}, ${formatSI(p.ld, 'H')}, ${formatSI(p.lq, 'H')}`],
        ['ψ, p, kt', `${p.psi} Wb, ${p.pp}, ${p.kt.toFixed(4)} N·m/A`],
        ['J, B', `${formatSI(p.j, 'kg·m²')}, ${formatSI(p.b, 'N·m·s')}`],
        ['Shaft power (end)', formatW(m.pshaft)],
      ],
    }
  },
  analyze: {
    compare: comparePmsm,
    theory: (r) => {
      const p = r.params
      const tb = textbookPmsm(p)
      return (
        <>
          <h3>The PMSM and its field-oriented control</h3>
          <ol className="derivation">
            <li>
              <b>Machine (rotor frame)</b> — <span className="mono">vd = R·id + Ld·did/dt − ωe·Lq·iq</span>, <span className="mono">vq = R·iq + Lq·diq/dt + ωe·(Ld·id + ψ)</span>, <span className="mono">Te = 1.5·p·(ψ·iq + (Ld − Lq)·id·iq)</span>, <span className="mono">J·dω/dt = Te − B·ω − TL</span>.
            </li>
            <li>
              <b>Current loops</b> — PI with <span className="mono">Kp = ωc·L</span>, <span className="mono">Ki = ωc·R</span>: the zero cancels the pole R/L, the open loop is ωc/s, the closed loop <span className="mono">ωc/(s + ωc)</span>: rise ln 9/ωc = {formatTime(tb.iqRise)}. Decoupling adds the ωe terms so each axis sees only R and L.
            </li>
            <li>
              <b>Speed loop</b> — with an ideal current loop, <span className="mono">kt = 1.5·p·ψ</span> = {p.kt.toFixed(4)} N·m/A and <span className="mono">Kiω = J·ωs²/kt</span>, <span className="mono">Kpω = (2ζωs·J − B)/kt</span> give s² + 2ζωs·s + ωs² with the PI zero: overshoot{' '}
              {tb.overshoot === null ? '—' : `${(tb.overshoot * 100).toFixed(1)} %`}, load dip {tb.dip === null ? '—' : `${rpm(tb.dip).toFixed(1)} rpm`}.
            </li>
            <li>
              <b>Steady state</b> — d/dt = 0: <span className="mono">iq = (TL + B·ω)/kt</span>, <span className="mono">vd = R·id − ωe·Lq·iq</span>, <span className="mono">vq = R·iq + ωe·(Ld·id + ψ)</span>, limited by <span className="mono">√(vd² + vq²) ≤ Vdc/√3</span> = {formatV(p.vmax, false)}; field weakening finds the id ≤ 0 that keeps |v| at 0.95 of that.
            </li>
          </ol>
          <p className="small">
            The exact THEORY is the decoupled, id = 0 loop — linear, with the current limit as a second mode — solved by matrix exponentials at the simulation's sample times and measured with the same functions. The SIMULATION integrates the full nonlinear d–q machine (with Ld ≠ Lq, the voltage limit,
            field weakening and the inverse Park transform to the phases). The inverter is averaged: the switching ripple is not modelled.
          </p>
        </>
      )
    },
    convergence: ['overshoot', 'dipRpm'],
  },
  lessons: PMSM_LESSONS,
  experiments: PMSM_EXPERIMENTS,
  predictions: pmsmPredictions,
  measureLabels: {
    nEnd: { label: 'Speed at the end', fmt: (v) => `${v.toFixed(1)} rpm` },
    iqEnd: { label: 'iq at the end', fmt: (v) => formatA(v, true) },
    idEnd: { label: 'id at the end', fmt: (v) => formatA(v, true) },
    vdEnd: { label: 'vd at the end', fmt: (v) => formatV(v) },
    vqEnd: { label: 'vq at the end', fmt: (v) => formatV(v) },
    vEnd: { label: '|v| at the end', fmt: (v) => formatV(v, false) },
    teEnd: { label: 'Torque at the end', fmt: (v) => `${v.toFixed(4)} N·m` },
    iAmp: { label: 'Phase-current amplitude', fmt: (v) => formatA(v) },
    iaRms: { label: 'Phase current a (RMS)', fmt: (v) => formatA(v) },
    iqRise: { label: 'iq rise time 10–90 %', fmt: fmtS },
    iqPeak: { label: 'Largest |iq|', fmt: (v) => formatA(v) },
    idPeak: { label: 'Largest |id|', fmt: (v) => formatA(v) },
    tDesat: { label: 'Speed PI leaves the limit', fmt: fmtS },
    t90: { label: 'Time to 90 % speed', fmt: fmtS },
    overshoot: { label: 'Speed-step overshoot', fmt: (v) => `${(v * 100).toFixed(2)} %` },
    tPeak: { label: 'Time of the peak', fmt: fmtS },
    dipRpm: { label: 'Load-step speed dip', fmt: (v) => `${v.toFixed(2)} rpm` },
    tDip: { label: 'Time of the dip', fmt: fmtS },
    vlimFrac: { label: 'Time at the voltage limit', fmt: (v) => `${(v * 100).toFixed(2)} %` },
    fwFrac: { label: 'Time in field weakening', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    pel: { label: 'Electrical power in', fmt: (v) => formatW(v) },
    pcu: { label: 'Copper loss', fmt: (v) => formatW(v) },
    pshaft: { label: 'Load power', fmt: (v) => formatW(v) },
    eff: { label: 'Efficiency', fmt: (v) => `${(v * 100).toFixed(1)} %` },
  },
  status: (st) => pmsmStatus(st),
  next: (r, st) => pmsmNext(r, st)?.text ?? null,
  nextConsequence: (r, st) => pmsmNext(r, st),
  energyModel: (st, m, r) => pmsmEnergy(st, m, r),
  analysis: ANALYSIS,
  parts: PARTS,
  readings: pmsmReadings,
}
