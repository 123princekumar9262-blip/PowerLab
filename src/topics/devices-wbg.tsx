import { dptPath, DptDiagramWbg, halfBridgePath, HalfBridgeDiagram, peakAbs } from '../components/devices/WbgDiagrams.tsx'
import { mosfetEventLabel, mosfetEventWhy, mosfetStateAt, mosfetView, type MosfetState } from '../converters/devices/content.ts'
import { compareGan, GAN_EXPERIMENTS, GAN_LESSONS, ganEventLabel, ganEventWhy, ganPredictions, ganReadings, ganStateAt, ganStatus, ganView, ganWhy, type GanState } from '../converters/devices/gan-content.ts'
import { GAN_DEFAULTS, GAN_LIMITS, measureGan, simulateGan, type GanMeasurements, type GanParams, type GanRun } from '../converters/devices/gan.ts'
import { compareIgbt, IGBT_EXPERIMENTS, IGBT_LESSONS, igbtEventLabel, igbtEventWhy, igbtPredictions, igbtReadings, igbtStateAt, igbtStatus, igbtView, igbtWhy, type IgbtState } from '../converters/devices/igbt-content.ts'
import { IGBT_DEFAULTS, IGBT_LIMITS, measureIgbt, simulateIgbt, textbookIgbt, type IgbtMeasurements, type IgbtParams, type IgbtRun } from '../converters/devices/igbt.ts'
import { compareSic, SIC_EXPERIMENTS, SIC_LESSONS, sicPredictions, sicReadings, sicStatus, sicWhy } from '../converters/devices/sic-content.ts'
import { MATERIAL, measureSic, SIC_DEFAULTS, SIC_LIMITS, simulateSic, type SicMeasurements, type SicParams, type SicRun } from '../converters/devices/sic.ts'
import type { AnalysisCategory, ChannelMeta, MeasureLabel, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../utils/format.ts'

/*
 * Switching Devices lab: the IGBT, SiC MOSFET and GaN HEMT topics. Each is a double-pulse test simulated as a
 * piecewise-linear circuit (converters/devices/igbt.ts, sic.ts → mosfet.ts, gan.ts) and validated against the
 * exact solution of the same equations. Colours follow the MOSFET topic: gate blue, drain/collector voltage
 * orange, device current red, freewheeling path green, power and energy pink.
 */

const fmtT = (v: number) => formatTime(v)
const fmtJ = (v: number) => formatSI(v, 'J')
const fmtV = (v: number) => formatV(v, false)
const fmtA = (v: number) => formatA(v)
const fmtW = (v: number) => formatSI(v, 'W')
const fmtVns = (v: number) => `${(v / 1e9).toFixed(1)} V/ns`

const sharedParts = [
  { id: 'device', label: 'Device under test' },
  { id: 'diode', label: 'Freewheeling diode' },
  { id: 'load', label: 'Inductive load' },
  { id: 'vdc', label: 'DC source' },
  { id: 'rg', label: 'Gate resistor' },
  { id: 'driver', label: 'Gate driver' },
  { id: 'caps', label: 'Device capacitances' },
]

// ─────────────────────────────── IGBT ───────────────────────────────

const IGBT_CH: Record<string, ChannelMeta> = {
  vg: { id: 'vg', label: 'Vdrv', name: 'Gate driver output', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'Gate' },
  vge: { id: 'vge', label: 'vGE', name: 'Gate–emitter voltage', unit: 'V', color: '#3987e5', group: 'Gate' },
  ig: { id: 'ig', label: 'iG', name: 'Gate current', unit: 'A', color: '#c98500', group: 'Gate current' },
  vce: { id: 'vce', label: 'vCE', name: 'Collector–emitter voltage', unit: 'V', color: '#d95926', group: 'Collector' },
  ic: { id: 'ic', label: 'iC', name: 'Collector current', unit: 'A', color: '#e66767', group: 'Currents' },
  ip: { id: 'ip', label: 'i_p', name: 'Hole (PNP) part of iC — the tail', unit: 'A', color: '#0f9fb5', dash: [6, 3], group: 'Currents' },
  ich: { id: 'ich', label: 'i_ch', name: 'Channel (electron) part of iC', unit: 'A', color: '#9085e9', dash: [2, 3], group: 'Currents' },
  idiode: { id: 'idiode', label: 'iF', name: 'Freewheeling diode current', unit: 'A', color: '#008300', dash: [6, 4], group: 'Currents' },
  pdev: { id: 'pdev', label: 'p', name: 'Power in the IGBT vCE·iC', unit: 'W', color: '#d55181', group: 'Power' },
  energy: { id: 'energy', label: 'E', name: 'Energy dissipated so far (IGBT)', unit: 'J', color: '#d55181', dash: [6, 4], group: 'Energy' },
  vdsMos: { id: 'vdsMos', label: 'vDS MOSFET', name: 'MOSFET compared: drain–source voltage', unit: 'V', color: '#b58a5a', dash: [3, 3], group: 'MOSFET compared' },
  idMos: { id: 'idMos', label: 'iD MOSFET', name: 'MOSFET compared: drain current', unit: 'A', color: '#8f7ad6', dash: [8, 3], group: 'MOSFET compared' },
  energyMos: { id: 'energyMos', label: 'E MOSFET', name: 'MOSFET compared: energy so far', unit: 'J', color: '#8a8f99', dash: [8, 3], group: 'MOSFET compared' },
}

const IGBT_LABELS: Record<string, MeasureLabel> = {
  tdOn: { label: 'td(on)', fmt: fmtT },
  tri: { label: 't_ri', fmt: fmtT },
  tfv: { label: 't_fv', fmt: fmtT },
  tdOff: { label: 'td(off)', fmt: fmtT },
  trv: { label: 't_rv', fmt: fmtT },
  tfi: { label: 't_fi (channel)', fmt: fmtT },
  eon: { label: 'Eon', fmt: fmtJ },
  eoffMos: { label: 'Eoff, channel part', fmt: fmtJ },
  etail: { label: 'E_tail', fmt: fmtJ },
  eoff: { label: 'Eoff (with tail)', fmt: fmtJ },
  tailShare: { label: 'Tail share of Eoff', fmt: (v) => `${(v * 100).toFixed(1)} %` },
  itail0: { label: 'I_tail at channel off', fmt: fmtA },
  qtail: { label: 'Q_tail', fmt: (v) => formatSI(v, 'C') },
  tauTail: { label: 'Tail 1/e time', fmt: fmtT },
  vceSat: { label: 'VCE(sat)', fmt: fmtV },
  pcond: { label: 'Conduction loss (IGBT)', fmt: fmtW },
  plateauOn: { label: 'Turn-on plateau', fmt: fmtV },
  plateauOff: { label: 'Turn-off plateau', fmt: fmtV },
  dvdtOff: { label: 'dv/dt at turn-off', fmt: fmtVns },
  mosEon: { label: 'Eon (MOSFET)', fmt: fmtJ },
  mosEoff: { label: 'Eoff (MOSFET)', fmt: fmtJ },
  mosVon: { label: 'On-state voltage (MOSFET)', fmt: fmtV },
  mosPcond: { label: 'Conduction loss (MOSFET)', fmt: fmtW },
  eoffRatio: { label: 'Eoff IGBT / MOSFET', fmt: (v) => `×${v.toFixed(2)}` },
  pcondRatio: { label: 'Conduction loss IGBT / MOSFET', fmt: (v) => `×${v.toFixed(2)}` },
}

const IGBT_ANALYSIS: Array<AnalysisCategory<IgbtRun, IgbtMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['eon', 'eoff', 'tailShare', 'vceSat'] },
  { id: 'turnon', label: 'Turn-on', rows: ['tdOn', 'tri', 'tfv', 'plateauOn', 'eon'] },
  { id: 'turnoff', label: 'Turn-off', rows: ['tdOff', 'trv', 'tfi', 'plateauOff', 'dvdtOff', 'eoffMos'] },
  {
    id: 'tail',
    label: 'Tail',
    rows: ['itail0', 'tauTail', 'qtail', 'etail', 'eoff'],
    note: (_m, r) => `After the channel closes the hole current obeys di_p/dt = −i_p/τ (τ = ${formatTime(r.params.tau)}): Q_tail = I_tail·τ·(1 − e^(−T/τ)), E_tail = Vdc·Q_tail.`,
  },
  { id: 'conduction', label: 'Conduction', rows: ['vceSat', 'pcond', 'mosVon', 'mosPcond', 'pcondRatio'] },
  {
    id: 'compare',
    label: 'vs MOSFET',
    rows: ['eon', 'mosEon', 'eoff', 'mosEoff', 'eoffRatio', 'pcondRatio'],
    note: (_m, r) => {
      const ic = textbookIgbt(r.params).iCross
      return `The MOSFET compared has the same gate, capacitances and test, Ron = ${formatSI(r.params.ronMos, 'Ω')} and no tail (SIMULATION, same time steps). On-state crossover (theory): I = V0/(Ron − r) = ${Number.isFinite(ic) ? formatA(ic) : '—'}.`
    },
  },
]

function igbtDiagramView(st: IgbtState, r: IgbtRun) {
  const p = r.params
  return {
    device: 'igbt' as const,
    name: 'IGBT',
    vLabel: 'vCE',
    iLabel: 'iC',
    vdc: p.vdc,
    i0: p.i0,
    rg: p.rg,
    cIn: p.cge,
    cMiller: p.cgc,
    inLabel: 'Cge',
    millerLabel: 'Cgc',
    vdrv: p.vdrv,
    voff: p.voff,
    vg: st.vg,
    vgate: st.vge,
    v: st.vce,
    i: st.ic,
    idiode: st.idiode,
    channelOn: st.region !== 'cut',
    diode: st.diode,
    tail: st.region === 'cut' ? st.ip : null,
    regionText: st.region === 'cut' ? (st.ip > 0.005 * p.i0 ? 'channel OFF · tail' : 'OFF') : st.region === 'sat' ? 'active' : 'on-state',
    phase: st.phase,
    p: st.p,
    ig: st.ig,
    igPeak: peakAbs(r.signals.ig),
  }
}

export const IGBT_TOPIC: Topic<IgbtParams, IgbtRun, IgbtMeasurements, IgbtState> = {
  id: 'igbt',
  label: 'IGBT switching',
  title: 'IGBT double-pulse test',
  defaults: IGBT_DEFAULTS,
  basic: [
    { kind: 'number', key: 'i0', label: 'Load current I0', unit: 'A', min: IGBT_LIMITS.i0.min, max: IGBT_LIMITS.i0.max, log: true },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: IGBT_LIMITS.vdc.min, max: IGBT_LIMITS.vdc.max, log: true },
    { kind: 'number', key: 'tau', label: 'Carrier lifetime τ', unit: 'ns', scale: 1e-9, min: IGBT_LIMITS.tau.min, max: IGBT_LIMITS.tau.max, log: true },
    { kind: 'number', key: 'rg', label: 'Gate resistance Rg', unit: 'Ω', min: IGBT_LIMITS.rg.min, max: IGBT_LIMITS.rg.max, log: true },
  ],
  advanced: [
    { kind: 'number', key: 'alpha', label: 'Hole share α of iC', unit: '%', scale: 0.01, min: IGBT_LIMITS.alpha.min, max: IGBT_LIMITS.alpha.max, step: 1 },
    { kind: 'number', key: 'v0', label: 'Knee voltage V0', unit: 'V', min: IGBT_LIMITS.v0.min, max: IGBT_LIMITS.v0.max, step: 0.05 },
    { kind: 'number', key: 'rce', label: 'On-state resistance r', unit: 'mΩ', scale: 1e-3, min: IGBT_LIMITS.rce.min, max: IGBT_LIMITS.rce.max, log: true },
    { kind: 'number', key: 'ronMos', label: 'MOSFET compared: Ron', unit: 'mΩ', scale: 1e-3, min: IGBT_LIMITS.ronMos.min, max: IGBT_LIMITS.ronMos.max, log: true },
    { kind: 'number', key: 'vdrv', label: 'Gate drive voltage', unit: 'V', min: IGBT_LIMITS.vdrv.min, max: IGBT_LIMITS.vdrv.max, step: 0.5 },
    { kind: 'number', key: 'voff', label: 'Gate off voltage', unit: 'V', min: IGBT_LIMITS.voff.min, max: IGBT_LIMITS.voff.max, step: 0.5 },
    { kind: 'number', key: 'cge', label: 'Cge', unit: 'nF', scale: 1e-9, min: IGBT_LIMITS.cge.min, max: IGBT_LIMITS.cge.max, log: true },
    { kind: 'number', key: 'cgc', label: 'Cgc (Miller)', unit: 'pF', scale: 1e-12, min: IGBT_LIMITS.cgc.min, max: IGBT_LIMITS.cgc.max, log: true },
    { kind: 'number', key: 'cce', label: 'Cce', unit: 'pF', scale: 1e-12, min: IGBT_LIMITS.cce.min, max: IGBT_LIMITS.cce.max, step: 10 },
    { kind: 'number', key: 'vth', label: 'Threshold Vth', unit: 'V', min: IGBT_LIMITS.vth.min, max: IGBT_LIMITS.vth.max, step: 0.1 },
    { kind: 'number', key: 'gm', label: 'Transconductance gm', unit: 'S', min: IGBT_LIMITS.gm.min, max: IGBT_LIMITS.gm.max, log: true },
  ],
  paramNote: (_p, r) =>
    `On-state VCE(sat) = V0 + r·I0 = ${formatV(r.params.v0 + r.params.rce * r.params.i0, false)} · tail ≈ α·I0 = ${formatA(r.params.alpha * r.params.i0)} decaying with τ = ${formatTime(r.params.tau)} · window ${formatTime(r.params.tend)} · model: charge-control tail (holes = α of iC in the on-state), constant capacitances and r (no conductivity-modulation delay), ideal diode (no reverse recovery), no stray inductance`,
  simulate: (p) => simulateIgbt(p),
  measure: measureIgbt,
  state: igbtStateAt,
  view: (st) => igbtView(st),
  why: igbtWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <DptDiagramWbg v={igbtDiagramView(st, r)} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  path: (st, r) => dptPath({ dev: st.region === 'cut' && st.ip > 1e-3 * r.params.i0 ? 'IGBT (tail)' : 'IGBT', devId: 'device', i: st.ic, idiode: st.idiode, i0: r.params.i0 }),
  channels: IGBT_CH,
  defaultChannels: ['vge', 'vce', 'ic', 'ip'],
  primaryChannels: ['vce', 'ic'],
  addOrder: ['vg', 'vge', 'ig', 'vce', 'ic', 'ip', 'ich', 'idiode', 'pdev', 'energy', 'vdsMos', 'idMos', 'energyMos'],
  shade: (r, k) => (r.signals.pdev[k] > 0.05 * r.params.vdc * r.params.i0 ? 'rgba(213,81,129,0.12)' : null),
  shadeLegend: 'pink band: large power in the IGBT (switching loss and tail)',
  eventLabel: igbtEventLabel,
  eventWhy: igbtEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' || e.kind === 'gate-off' ? '#aeb7c5' : (e.device ?? '').endsWith('cut|D') ? '#0f9fb5' : '#3987e5'),
  repeats: () => false,
  initialCursor: (r) => {
    const m = measureIgbt(r)
    return r.params.toff + (m.tdOff ?? 0) + (m.trv ?? 0) + (m.tfi ?? 0) + 0.5 * r.params.tau
  },
  periodName: 'test',
  badge: (_r, m) => (
    <section className="dc-mode" aria-label="Switching losses">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">DPT</span>
        <span className="small">
          Eon {formatSI(m.eon, 'J')} · Eoff {formatSI(m.eoff, 'J')} (tail {(m.tailShare * 100).toFixed(0)} %) · VCE(sat) {formatV(m.vceSat, false)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        MOSFET at the same test: Eon {formatSI(m.mos.eon, 'J')} · Eoff {formatSI(m.mos.eoff, 'J')} · on-state {formatV(m.mos.vdsOn, false)}
      </p>
    </section>
  ),
  summary: (_r, m) => `Eoff ${formatSI(m.eoff, 'J')}, ${(m.tailShare * 100).toFixed(0)} % of it in the tail · VCE(sat) ${formatV(m.vceSat, false)} (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'device')
      return {
        title: 'IGBT',
        role: 'A MOSFET gate driving a wide-base PNP transistor: the gate controls the electrons, the p+ collector injects holes that lower the on-state voltage — and form the tail.',
        rows: [
          ['State now', st.phase],
          ['vGE / vCE', `${formatV(st.vge)} / ${formatV(st.vce)}`],
          ['iC = electrons + holes', `${formatA(st.ic)} = ${formatA(st.ich)} + ${formatA(st.ip)}`],
          ['VCE(sat) at I0', formatV(m.vceSat, false)],
          ['Eon / Eoff', `${formatSI(m.eon, 'J')} / ${formatSI(m.eoff, 'J')}`],
          ['Tail: I_tail, τ', `${formatA(m.itail0 ?? NaN)}, ${formatTime(p.tau)}`],
        ],
      }
    if (part === 'diode') return { title: 'Freewheeling diode', role: 'Carries the inductor current while the IGBT is off; clamps the collector at Vdc (ideal: no reverse recovery).', rows: [['State now', st.diode ? 'ON' : 'OFF'], ['Current now', formatA(st.idiode)]] }
    if (part === 'rg' || part === 'driver') return { title: 'Gate drive', role: 'Charges and discharges the gate; Rg sets the MOS-controlled transition times — not the tail.', rows: [['Driver', `${formatV(p.vdrv, false)} / ${formatV(p.voff)}`], ['Rg', formatSI(p.rg, 'Ω')], ['Gate current now', formatA(st.ig, true)], ['τ = Rg·Ciss', formatTime(p.rg * p.ciss)]] }
    if (part === 'caps') return { title: 'IGBT capacitances', role: 'Cge must be charged to reach Vth; Cgc (Miller) is moved by the full collector swing — the plateaus.', rows: [['Cge', formatSI(p.cge, 'F')], ['Cgc', formatSI(p.cgc, 'F')], ['Cce', formatSI(p.cce, 'F')]] }
    if (part === 'vdc') return { title: 'DC source', role: 'The voltage the IGBT must block — and the voltage the tail current flows against.', rows: [['Vdc', formatV(p.vdc, false)]] }
    return { title: 'Inductive load', role: 'Over the microseconds of the test the load inductor holds its current constant: a current source.', rows: [['I0', formatA(p.i0)]] }
  },
  analyze: {
    compare: compareIgbt,
    theory: (r) => (
      <>
        <h3>The IGBT turn-off, phase by phase</h3>
        <ol className="derivation">
          <li>
            <b>Gate</b> — identical to a MOSFET: <span className="mono">Rg·Ciss</span> delays, Miller plateaus at <span className="mono">Vth + I/gm</span>; at turn-off the channel carries only <span className="mono">(1 − α)·I0</span>, so the plateau is lower.
          </li>
          <li>
            <b>On-state</b> — <span className="mono">VCE(sat) = V0 + r·iC</span>: the p+ collector junction (knee V0) in series with the hole-flooded drift region (r).
          </li>
          <li>
            <b>Stored charge</b> — <span className="mono">di_p/dt = (k·i_ch − i_p)/τ</span>, <span className="mono">k = α/(1 − α)</span>: in the on-state <span className="mono">i_p = α·iC</span>.
          </li>
          <li>
            <b>Tail</b> — once <span className="mono">vGE ≤ Vth</span>, <span className="mono">i_ch = 0</span> and <span className="mono">i_p(t) = I_tail·e^(−t/τ)</span> at <span className="mono">vCE = Vdc</span>:{' '}
            <span className="mono">Q_tail = I_tail·τ·(1 − e^(−T/τ))</span>, <span className="mono">E_tail = Vdc·Q_tail ≈ Vdc·α·I0·τ</span>.
          </li>
        </ol>
        <p className="small">
          The exact THEORY solves the same piecewise-linear equations analytically (matrix exponential) and integrates the tail in closed form; the textbook values use the classical formulas. The MOSFET compared (Ron ={' '}
          {formatSI(r.params.ronMos, 'Ω')}) is the MOSFET topic's model with this IGBT's gate and capacitances.
        </p>
      </>
    ),
    convergence: ['trv', 'eoff', 'etail'],
  },
  lessons: IGBT_LESSONS,
  experiments: IGBT_EXPERIMENTS,
  predictions: igbtPredictions,
  measureLabels: IGBT_LABELS,
  status: (st) => igbtStatus(st),
  analysis: IGBT_ANALYSIS,
  parts: sharedParts,
  readings: igbtReadings,
}

// ─────────────────────────────── SiC MOSFET ───────────────────────────────

const MOS_CH: Record<string, ChannelMeta> = {
  vg: { id: 'vg', label: 'Vdrv', name: 'Gate driver output', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'Gate' },
  vgs: { id: 'vgs', label: 'vGS', name: 'Gate–source voltage', unit: 'V', color: '#3987e5', group: 'Gate' },
  ig: { id: 'ig', label: 'iG', name: 'Gate current', unit: 'A', color: '#c98500', group: 'Gate current' },
  vds: { id: 'vds', label: 'vDS', name: 'Drain–source voltage', unit: 'V', color: '#d95926', group: 'Drain' },
  id: { id: 'id', label: 'iD', name: 'Drain current', unit: 'A', color: '#e66767', group: 'Currents' },
  idiode: { id: 'idiode', label: 'iF', name: 'Freewheeling diode current', unit: 'A', color: '#008300', dash: [6, 4], group: 'Currents' },
  ich: { id: 'ich', label: 'ich', name: 'Channel current', unit: 'A', color: '#9085e9', dash: [2, 3], group: 'Currents' },
  pdev: { id: 'pdev', label: 'p', name: 'Power in the MOSFET vDS·iD', unit: 'W', color: '#d55181', group: 'Power' },
  energy: { id: 'energy', label: 'E', name: 'Energy dissipated so far', unit: 'J', color: '#d55181', dash: [6, 4], group: 'Energy' },
}

const SIC_LABELS: Record<string, MeasureLabel> = {
  tdOn: { label: 'td(on)', fmt: fmtT },
  tri: { label: 't_ri', fmt: fmtT },
  tfv: { label: 't_fv', fmt: fmtT },
  tdOff: { label: 'td(off)', fmt: fmtT },
  trv: { label: 't_rv', fmt: fmtT },
  tfi: { label: 't_fi', fmt: fmtT },
  eon: { label: 'Eon', fmt: fmtJ },
  eoff: { label: 'Eoff', fmt: fmtJ },
  etot: { label: 'Eon + Eoff', fmt: fmtJ },
  plateau: { label: 'Miller plateau', fmt: fmtV },
  dvdtOff: { label: 'dv/dt at turn-off', fmt: fmtVns },
  dvdtOn: { label: 'dv/dt at turn-on', fmt: (v) => fmtVns(Math.abs(v)) },
  qg: { label: 'Gate charge Qg', fmt: (v) => formatSI(v, 'C') },
  vdsOn: { label: 'vDS(on)', fmt: fmtV },
  ronSim: { label: 'Ron (vDS/I0)', fmt: (v) => formatSI(v, 'Ω') },
  pcond: { label: 'Conduction loss', fmt: fmtW },
  psw100k: { label: 'Switching loss at 100 kHz', fmt: fmtW },
}

const SIC_ANALYSIS: Array<AnalysisCategory<SicRun, SicMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['etot', 'dvdtOff', 'vdsOn', 'qg'] },
  { id: 'turnon', label: 'Turn-on', rows: ['tdOn', 'tri', 'tfv', 'plateau', 'dvdtOn', 'eon'] },
  { id: 'turnoff', label: 'Turn-off', rows: ['tdOff', 'trv', 'tfi', 'dvdtOff', 'eoff'] },
  {
    id: 'conduction',
    label: 'Conduction',
    rows: ['vdsOn', 'ronSim', 'pcond'],
    note: (_m, r) => `Ron = ${formatSI(r.sic.ron25, 'Ω')} (25 °C, +${MATERIAL[r.sic.material].vref} V) × drive factor ${r.sic.driveFactor.toFixed(3)} × temperature factor ${r.sic.tempFactor.toFixed(3)} (Tj = ${r.sic.tj.toFixed(0)} °C) — a static model; the switching does not depend on Tj here.`,
  },
  { id: 'gate', label: 'Gate drive', rows: ['qg', 'plateau', 'tdOn', 'tdOff'], note: (m, r) => `Driver energy per cycle Qg·(Vdrv − Voff) = ${formatSI(m.qg * (r.params.vdrv - r.params.voff), 'J')}.` },
  { id: 'losses', label: 'Losses', rows: ['eon', 'eoff', 'etot', 'psw100k', 'pcond'] },
]

function sicDiagramView(st: MosfetState, r: SicRun) {
  const p = r.params
  return {
    device: 'mosfet' as const,
    name: `${MATERIAL[r.sic.material].name} MOSFET`,
    vLabel: 'vDS',
    iLabel: 'iD',
    vdc: p.vdc,
    i0: p.i0,
    rg: p.rg,
    cIn: p.cgs,
    cMiller: p.cgd,
    inLabel: 'Cgs',
    millerLabel: 'Cgd',
    vdrv: p.vdrv,
    voff: p.voff,
    vg: st.vg,
    vgate: st.vgs,
    v: st.vds,
    i: st.id,
    idiode: st.idiode,
    channelOn: st.region !== 'cut',
    diode: st.diode,
    tail: null,
    regionText: st.region === 'cut' ? 'OFF' : st.region === 'sat' ? 'saturation' : 'ohmic',
    phase: st.phase,
    p: st.p,
    ig: st.ig,
    igPeak: peakAbs(r.signals.ig),
  }
}

export const SIC_TOPIC: Topic<SicParams, SicRun, SicMeasurements, MosfetState> = {
  id: 'sic',
  label: 'SiC MOSFET switching',
  title: 'SiC MOSFET double-pulse test',
  defaults: SIC_DEFAULTS,
  basic: [
    { kind: 'number', key: 'rg', label: 'Gate resistance Rg', unit: 'Ω', min: SIC_LIMITS.rg.min, max: SIC_LIMITS.rg.max, log: true },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: SIC_LIMITS.vdc.min, max: SIC_LIMITS.vdc.max, log: true },
    { kind: 'number', key: 'i0', label: 'Load current I0', unit: 'A', min: SIC_LIMITS.i0.min, max: SIC_LIMITS.i0.max, log: true },
    { kind: 'number', key: 'tj', label: 'Junction temperature Tj', unit: '°C', min: SIC_LIMITS.tj.min, max: SIC_LIMITS.tj.max, step: 5 },
  ],
  advanced: [
    {
      kind: 'choice',
      key: 'material',
      label: 'Material (coefficients of Ron)',
      options: [
        { value: 'sic', label: 'SiC', title: 'Rated at +18 V, Ron +0.32 %/K' },
        { value: 'si', label: 'Si', title: 'Superjunction: rated at +10 V, Ron +0.8 %/K' },
      ],
    },
    { kind: 'number', key: 'vdrv', label: 'Gate drive voltage', unit: 'V', min: SIC_LIMITS.vdrv.min, max: SIC_LIMITS.vdrv.max, step: 0.5 },
    { kind: 'number', key: 'voff', label: 'Gate off voltage', unit: 'V', min: SIC_LIMITS.voff.min, max: SIC_LIMITS.voff.max, step: 0.5 },
    { kind: 'number', key: 'ron25', label: 'Ron at 25 °C (rated drive)', unit: 'mΩ', scale: 1e-3, min: SIC_LIMITS.ron25.min, max: SIC_LIMITS.ron25.max, log: true },
    { kind: 'number', key: 'cgs', label: 'Cgs', unit: 'nF', scale: 1e-9, min: SIC_LIMITS.cgs.min, max: SIC_LIMITS.cgs.max, log: true },
    { kind: 'number', key: 'cgd', label: 'Cgd (Miller, charge-equivalent)', unit: 'pF', scale: 1e-12, min: SIC_LIMITS.cgd.min, max: SIC_LIMITS.cgd.max, log: true },
    { kind: 'number', key: 'cds', label: 'Cds', unit: 'pF', scale: 1e-12, min: SIC_LIMITS.cds.min, max: SIC_LIMITS.cds.max, step: 10 },
    { kind: 'number', key: 'vth', label: 'Threshold Vth', unit: 'V', min: SIC_LIMITS.vth.min, max: SIC_LIMITS.vth.max, step: 0.1 },
    { kind: 'number', key: 'gm', label: 'Transconductance gm', unit: 'S', min: SIC_LIMITS.gm.min, max: SIC_LIMITS.gm.max, log: true },
  ],
  paramNote: (_p, r) =>
    `Ron = ${formatSI(r.params.ron, 'Ω')} at ${r.sic.tj.toFixed(0)} °C and +${r.params.vdrv} V · τ = Rg·Ciss = ${formatTime(r.params.rg * r.params.ciss)} · window ${formatTime(r.params.tend)} · model: the MOSFET topic's (constant charge-equivalent capacitances, ideal freewheeling diode, no stray inductance) with ${MATERIAL[r.sic.material].name} device values; the body diode is not part of this test`,
  simulate: (p) => simulateSic(p),
  measure: measureSic,
  state: (r, k) => mosfetStateAt(r, k),
  view: (st) => mosfetView(st),
  why: sicWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <DptDiagramWbg v={sicDiagramView(st, r)} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  path: (st, r) => dptPath({ dev: 'MOSFET', devId: 'device', i: st.id, idiode: st.idiode, i0: r.params.i0 }),
  channels: MOS_CH,
  defaultChannels: ['vg', 'vgs', 'vds', 'id'],
  primaryChannels: ['vds', 'id'],
  addOrder: ['vg', 'vgs', 'ig', 'vds', 'id', 'idiode', 'ich', 'pdev', 'energy'],
  shade: (r, k) => (r.signals.pdev[k] > 0.05 * r.params.vdc * r.params.i0 ? 'rgba(213,81,129,0.12)' : null),
  shadeLegend: 'pink band: large power in the device (switching loss)',
  eventLabel: mosfetEventLabel,
  eventWhy: mosfetEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' || e.kind === 'gate-off' ? '#aeb7c5' : '#3987e5'),
  repeats: () => false,
  initialCursor: (r) => {
    const m = measureSic(r)
    return r.params.ton + (m.tdOn ?? 0) + (m.tri ?? 0) + 0.5 * (m.tfv ?? 0)
  },
  periodName: 'test',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Switching losses">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{MATERIAL[r.sic.material].name}</span>
        <span className="small">
          Eon {formatSI(m.eon, 'J')} · Eoff {formatSI(m.eoff, 'J')} · dv/dt {m.dvdtOff === null ? '—' : fmtVns(m.dvdtOff)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        Ron {formatSI(m.ronSim, 'Ω')} at {r.sic.tj.toFixed(0)} °C · Qg {formatSI(m.qg, 'C')} · td(on) {formatTime(m.tdOn ?? NaN)} · t_fv {formatTime(m.tfv ?? NaN)} · t_rv {formatTime(m.trv ?? NaN)}
      </p>
    </section>
  ),
  summary: (_r, m) => `Eon + Eoff ${formatSI(m.etot, 'J')} · dv/dt ${m.dvdtOff === null ? '—' : fmtVns(m.dvdtOff)} (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    const s = r.sic
    if (part === 'device')
      return {
        title: `${MATERIAL[s.material].name} MOSFET`,
        role: s.material === 'sic' ? 'A wide-band-gap MOSFET: a thin, small die for its voltage — small capacitances, fast edges; it needs +18/−4 V on the gate.' : 'A silicon superjunction MOSFET of the same class: a larger die, larger capacitances.',
        rows: [
          ['State now', st.phase],
          ['vGS / vDS', `${formatV(st.vgs)} / ${formatV(st.vds)}`],
          ['Ron (Tj, drive)', `${formatSI(p.ron, 'Ω')} (${s.tj.toFixed(0)} °C, +${p.vdrv} V)`],
          ['Eon / Eoff', `${formatSI(m.eon, 'J')} / ${formatSI(m.eoff, 'J')}`],
          ['Body diode', s.material === 'sic' ? 'V_F ≈ 3–4.5 V (datasheet typical; not simulated)' : 'V_F ≈ 0.8 V, large Qrr (not simulated)'],
        ],
      }
    if (part === 'diode') return { title: 'Freewheeling diode', role: 'A separate ideal diode carries the load current while the MOSFET is off (in a half-bridge this would be the other switch).', rows: [['State now', st.diode ? 'ON' : 'OFF'], ['Current now', formatA(st.idiode)]] }
    if (part === 'rg' || part === 'driver') return { title: 'Gate drive', role: 'SiC needs a high positive drive for a low Ron and a negative off-level against false turn-on.', rows: [['Driver', `${formatV(p.vdrv, false)} / ${formatV(p.voff)}`], ['Rg', formatSI(p.rg, 'Ω')], ['Gate current now', formatA(st.ig, true)], ['Qg per turn-on', formatSI(m.qg, 'C')]] }
    if (part === 'caps') return { title: 'Capacitances (charge-equivalent)', role: 'Constant values with the datasheet charges; small for SiC.', rows: [['Cgs', formatSI(p.cgs, 'F')], ['Cgd', formatSI(p.cgd, 'F')], ['Cds', formatSI(p.cds, 'F')]] }
    if (part === 'vdc') return { title: 'DC source', role: 'The voltage the device blocks.', rows: [['Vdc', formatV(p.vdc, false)]] }
    return { title: 'Inductive load', role: 'A current source over the nanoseconds of the test.', rows: [['I0', formatA(p.i0)]] }
  },
  analyze: {
    compare: compareSic,
    theory: (r) => (
      <>
        <h3>The same MOSFET physics, different numbers</h3>
        <ol className="derivation">
          <li>
            <b>Edges</b> — every transition is an RC charge of the gate: <span className="mono">td = Rg·Ciss·ln(…)</span>, plateaus <span className="mono">t_v ≈ Rg·Cgd·Vdc/(Vdrv − Vpl)</span>. Small Cgd and Ciss → short plateaus, high dv/dt.
          </li>
          <li>
            <b>Gate charge</b> — <span className="mono">Qg = Cgs·(Vdrv − Voff) + Cgd·(Vdrv − Voff + Vdc − vDS,on)</span> (exact for constant capacitances).
          </li>
          <li>
            <b>On-resistance</b> — <span className="mono">Ron = Ron25·(s + (1 − s)·(Vref − Vth)/(Vdrv − Vth))·(1 + kT·(Tj − 25))</span>; {MATERIAL[r.sic.material].name}: Vref = {MATERIAL[r.sic.material].vref} V, s = {MATERIAL[r.sic.material].share}, kT = {(MATERIAL[r.sic.material].kT * 100).toFixed(2)} %/K.
          </li>
        </ol>
        <p className="small">The switching THEORY is the exact piecewise-linear solution of the MOSFET topic, run with these device values.</p>
      </>
    ),
    convergence: ['tfv', 'eon'],
  },
  lessons: SIC_LESSONS,
  experiments: SIC_EXPERIMENTS,
  predictions: sicPredictions,
  measureLabels: SIC_LABELS,
  status: (st, r) => sicStatus(st, r),
  analysis: SIC_ANALYSIS,
  parts: sharedParts,
  readings: sicReadings,
}

// ─────────────────────────────── GaN HEMT ───────────────────────────────

const GAN_CH: Record<string, ChannelMeta> = {
  vg: { id: 'vg', label: 'Vdrv LS', name: 'Low-side gate driver output', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'Gate' },
  hsgate: { id: 'hsgate', label: 'HS gate', name: 'High-side gate command (1 = ON)', unit: '', color: '#8a8f99', group: 'Gate', logic: true },
  vgs: { id: 'vgs', label: 'vGS', name: 'Low-side gate–source voltage', unit: 'V', color: '#3987e5', group: 'Gate' },
  ig: { id: 'ig', label: 'iG', name: 'Low-side gate current', unit: 'A', color: '#c98500', group: 'Gate current' },
  vds: { id: 'vds', label: 'vDS', name: 'Switch node: low-side drain–source voltage', unit: 'V', color: '#d95926', group: 'Switch node' },
  vsd: { id: 'vsd', label: 'vSD HS', name: 'High-side source–drain voltage (reverse drop)', unit: 'V', color: '#22b14c', group: 'High side' },
  id: { id: 'id', label: 'iD', name: 'Low-side drain current', unit: 'A', color: '#e66767', group: 'Currents' },
  iF: { id: 'iF', label: 'iHS', name: 'High-side current, reverse direction', unit: 'A', color: '#008300', dash: [6, 4], group: 'Currents' },
  ich: { id: 'ich', label: 'ich', name: 'Low-side channel current', unit: 'A', color: '#9085e9', dash: [2, 3], group: 'Currents' },
  pls: { id: 'pls', label: 'p LS', name: 'Power in the low side vDS·iD', unit: 'W', color: '#d55181', group: 'Power' },
  phs: { id: 'phs', label: 'p HS', name: 'Power in the high side vSD·iHS', unit: 'W', color: '#b0479b', dash: [6, 3], group: 'Power' },
  els: { id: 'els', label: 'E LS', name: 'Low-side energy so far', unit: 'J', color: '#d55181', dash: [6, 4], group: 'Energy' },
  ehs: { id: 'ehs', label: 'E HS', name: 'High-side energy so far', unit: 'J', color: '#b0479b', dash: [2, 3], group: 'Energy' },
}

const GAN_LABELS: Record<string, MeasureLabel> = {
  tdOn: { label: 'td(on)', fmt: fmtT },
  tri: { label: 't_ri', fmt: fmtT },
  tfv: { label: 't_fv', fmt: fmtT },
  tdOff: { label: 'td(off)', fmt: fmtT },
  trv: { label: 't_rv', fmt: fmtT },
  tChOff: { label: 'Gate-off to channel off', fmt: fmtT },
  trevOn: { label: 'Reverse conduction before turn-on', fmt: fmtT },
  trevOff: { label: 'Reverse conduction after turn-off', fmt: fmtT },
  eon: { label: 'Eon (low side)', fmt: fmtJ },
  eoff: { label: 'Eoff (low side)', fmt: fmtJ },
  erevOn: { label: 'Reverse-conduction energy, before turn-on', fmt: fmtJ },
  erevOff: { label: 'Reverse-conduction energy, after turn-off', fmt: fmtJ },
  edead: { label: 'Dead-time loss per cycle', fmt: fmtJ },
  vsdRev: { label: 'vSD in the dead time', fmt: fmtV },
  vsdSync: { label: 'vSD with the gate ON', fmt: fmtV },
  qoss: { label: 'Extra charge at turn-on (Coss)', fmt: (v) => formatSI(v, 'C') },
  iFmin: { label: 'Lowest high-side current at turn-on', fmt: (v) => formatA(v, true) },
  shootThrough: { label: 'Shoot-through current peak', fmt: fmtA },
  vdsOn: { label: 'vDS(on)', fmt: fmtV },
  dvdtOn: { label: 'dv/dt at turn-on', fmt: fmtVns },
  dvdtOff: { label: 'dv/dt at turn-off', fmt: fmtVns },
  plateau: { label: 'Miller plateau', fmt: fmtV },
}

const GAN_ANALYSIS: Array<AnalysisCategory<GanRun, GanMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['vsdRev', 'edead', 'eon', 'eoff'] },
  {
    id: 'reverse',
    label: 'Reverse conduction',
    rows: ['vsdRev', 'vsdSync', 'trevOn', 'trevOff', 'erevOn', 'erevOff', 'edead'],
    note: (_m, r) => `No body diode: with its gate at ${formatV(r.params.voff)} the high side conducts backwards at vSD = Vth − Voff + Ron·I; with the gate ON only Ron·I.`,
  },
  { id: 'turnon', label: 'Turn-on', rows: ['tdOn', 'tri', 'tfv', 'dvdtOn', 'qoss', 'iFmin', 'eon'] },
  { id: 'turnoff', label: 'Turn-off', rows: ['tdOff', 'trv', 'tChOff', 'dvdtOff', 'eoff', 'shootThrough'] },
]

function ganDiagramView(st: GanState, r: GanRun) {
  const p = r.params
  return {
    vdc: p.vdc,
    i0: p.i0,
    rg: p.rg,
    vdrv: p.vdrv,
    voff: p.voff,
    vg: st.vg,
    hsGate: st.hsGate,
    vgs: st.vgs,
    vds: st.vds,
    id: st.id,
    iF: st.iF,
    vsd: st.vsd,
    lsOn: st.region !== 'cut',
    hsMode: st.hs,
    lsText: st.region === 'cut' ? 'OFF' : st.region === 'sat' ? 'saturation' : 'ohmic',
    phase: st.phase,
    pls: st.pls,
    phs: st.phs,
    ig: st.ig,
    igPeak: peakAbs(r.signals.ig),
  }
}

export const GAN_TOPIC: Topic<GanParams, GanRun, GanMeasurements, GanState> = {
  id: 'gan',
  label: 'GaN HEMT switching',
  title: 'GaN HEMT half-bridge test',
  defaults: GAN_DEFAULTS,
  basic: [
    { kind: 'number', key: 'tdead', label: 'Dead time', unit: 'ns', scale: 1e-9, min: GAN_LIMITS.tdead.min, max: GAN_LIMITS.tdead.max, step: 0.5 },
    { kind: 'number', key: 'voff', label: 'Gate off voltage', unit: 'V', min: GAN_LIMITS.voff.min, max: GAN_LIMITS.voff.max, step: 0.5 },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: GAN_LIMITS.vdc.min, max: GAN_LIMITS.vdc.max, log: true },
    { kind: 'number', key: 'i0', label: 'Load current I0', unit: 'A', min: GAN_LIMITS.i0.min, max: GAN_LIMITS.i0.max, log: true },
  ],
  advanced: [
    { kind: 'number', key: 'rg', label: 'Gate resistance Rg', unit: 'Ω', min: GAN_LIMITS.rg.min, max: GAN_LIMITS.rg.max, log: true },
    { kind: 'number', key: 'vdrv', label: 'Gate drive voltage', unit: 'V', min: GAN_LIMITS.vdrv.min, max: GAN_LIMITS.vdrv.max, step: 0.1, hint: (p) => (p.vdrv > 6 ? 'above +6 V: beyond the recommended GaN gate drive' : undefined) },
    { kind: 'number', key: 'ron', label: 'On-resistance Ron', unit: 'mΩ', scale: 1e-3, min: GAN_LIMITS.ron.min, max: GAN_LIMITS.ron.max, log: true },
    { kind: 'number', key: 'cgs', label: 'Cgs', unit: 'pF', scale: 1e-12, min: GAN_LIMITS.cgs.min, max: GAN_LIMITS.cgs.max, log: true },
    { kind: 'number', key: 'cgd', label: 'Cgd (Miller)', unit: 'pF', scale: 1e-12, min: GAN_LIMITS.cgd.min, max: GAN_LIMITS.cgd.max, log: true },
    { kind: 'number', key: 'cds', label: 'Cds (each device)', unit: 'pF', scale: 1e-12, min: GAN_LIMITS.cds.min, max: GAN_LIMITS.cds.max, log: true },
    { kind: 'number', key: 'vth', label: 'Threshold Vth', unit: 'V', min: GAN_LIMITS.vth.min, max: GAN_LIMITS.vth.max, step: 0.1 },
    { kind: 'number', key: 'gm', label: 'Transconductance gm', unit: 'S', min: GAN_LIMITS.gm.min, max: GAN_LIMITS.gm.max, log: true },
  ],
  paramNote: (_p, r) =>
    `Dead-time drop vSD = Vth − Voff + Ron·I0 = ${formatV(r.params.vth - r.params.voff + r.params.ron * r.params.i0, false)} · τ = Rg·Ciss = ${formatTime(r.params.rg * r.params.ciss)} · window ${formatTime(r.params.tend)} · model: two identical e-mode HEMTs, constant capacitances, ideal high-side gate edges, no stray inductance (no ringing), no dynamic Ron${r.diagnostics.issues.some((x) => x.startsWith('shoot')) ? ' · SHOOT-THROUGH: the dead time is too short' : ''}`,
  simulate: (p) => simulateGan(p),
  measure: measureGan,
  state: ganStateAt,
  view: (st) => ganView(st),
  why: ganWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <HalfBridgeDiagram v={ganDiagramView(st, r)} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  path: (st, r) => halfBridgePath({ id: st.id, iF: st.iF, i0: r.params.i0, hsMode: st.hs }),
  channels: GAN_CH,
  defaultChannels: ['vg', 'vds', 'id', 'iF'],
  primaryChannels: ['vds', 'iF'],
  addOrder: ['vg', 'hsgate', 'vgs', 'ig', 'vds', 'vsd', 'id', 'iF', 'ich', 'pls', 'phs', 'els', 'ehs'],
  shade: (r, k) => (r.modes[k]?.endsWith('|rev') ? 'rgba(34,177,76,0.12)' : r.signals.pls[k] > 0.05 * r.params.vdc * r.params.i0 ? 'rgba(213,81,129,0.12)' : null),
  shadeLegend: 'green band: the high side conducts in reverse (dead time) · pink band: switching loss in the low side',
  eventLabel: ganEventLabel,
  eventWhy: ganEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' || e.kind === 'gate-off' ? '#aeb7c5' : (e.device ?? '').includes('rev') ? '#22b14c' : '#3987e5'),
  repeats: () => false,
  initialCursor: (r) => 0.5 * (r.params.thsOff + r.params.ton),
  periodName: 'test',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Losses">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">GaN</span>
        <span className="small">
          dead-time drop {formatV(m.vsdRev, false)} · dead-time loss {formatSI(m.edead, 'J')} · Eon {formatSI(m.eon, 'J')} · Eoff {formatSI(m.eoff, 'J')}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        {m.shootThrough > 0 ? `SHOOT-THROUGH: up to ${formatA(m.shootThrough)} — the ${formatTime(r.params.tdead)} dead time is shorter than the turn-off. ` : ''}No reverse recovery (lowest high-side current {formatA(m.iFmin, true)}); Coss charge {formatSI(m.qoss, 'C')} · dv/dt {m.dvdtOn === null ? '—' : fmtVns(m.dvdtOn)}
      </p>
    </section>
  ),
  summary: (_r, m) => `Dead-time drop ${formatV(m.vsdRev, false)} · dead-time loss ${formatSI(m.edead, 'J')} per cycle · Eon ${formatSI(m.eon, 'J')} (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'hs' || part === 'hsdrv')
      return {
        title: 'High-side GaN HEMT',
        role: 'The freewheeling path. No body diode: with the gate off it conducts in reverse at vSD = Vth − Voff + Ron·I; with the gate on it is a resistor (synchronous rectification).',
        rows: [
          ['State now', st.hs === 'rev' ? 'REVERSE CONDUCTION (gate off)' : st.hs === 'on' ? 'ON (synchronous)' : 'OFF (blocking)'],
          ['Gate', st.hsGate ? `ON (${formatV(p.vdrv, false)})` : `OFF (${formatV(p.voff)})`],
          ['vSD / current', `${formatV(st.vsd)} / ${formatA(st.iF, true)}`],
          ['Dead-time loss per cycle', formatSI(m.edead, 'J')],
          ['Reverse recovery', 'none (no minority carriers)'],
        ],
      }
    if (part === 'ls' || part === 'driver' || part === 'rg')
      return {
        title: 'Low-side GaN HEMT',
        role: 'The switch under test: tiny capacitances, +6 V gate, very fast edges.',
        rows: [
          ['State now', st.phase],
          ['vGS / vDS', `${formatV(st.vgs)} / ${formatV(st.vds)}`],
          ['Driver', `${formatV(p.vdrv, false)} / ${formatV(p.voff)} through ${formatSI(p.rg, 'Ω')}`],
          ['Eon / Eoff', `${formatSI(m.eon, 'J')} / ${formatSI(m.eoff, 'J')}`],
          ['Ciss, Cgd, Coss', `${formatSI(p.ciss, 'F')}, ${formatSI(p.cgd, 'F')}, ${formatSI(p.chs, 'F')}`],
        ],
      }
    if (part === 'vdc') return { title: 'DC source', role: 'The bus voltage; the high side is clamped between it and the switch node.', rows: [['Vdc', formatV(p.vdc, false)]] }
    return { title: 'Inductive load', role: 'Between Vdc and the switch node; its current is constant over the test.', rows: [['I0', formatA(p.i0)]] }
  },
  analyze: {
    compare: compareGan,
    theory: () => (
      <>
        <h3>A half-bridge without body diodes</h3>
        <ol className="derivation">
          <li>
            <b>Synchronous</b> — high-side gate ON: the channel is a resistor both ways, <span className="mono">vSD = Ron·I0</span>.
          </li>
          <li>
            <b>Dead time</b> — both gates OFF: the high side opens in reverse once <span className="mono">vGD &gt; Vth</span>, so <span className="mono">vSD = Vth − Voff + Ron·I</span>; the loss is about <span className="mono">vSD·I0·t_dead</span> per dead time.
          </li>
          <li>
            <b>Hard turn-on</b> — the low side takes the current; the high side current falls to zero (no stored charge, <span className="mono">Qrr = 0</span>); the low side then charges the high side's output capacitance: <span className="mono">Q ≈ Coss·(Vdc + vSD)</span>.
          </li>
          <li>
            <b>Turn-off</b> — a fast gate closes the channel early; the load current charges the node: <span className="mono">Cn·dv/dt = I0 − i_ch</span>.
          </li>
        </ol>
        <p className="small">The THEORY is the exact piecewise-linear solution (matrix exponential) of the same half-bridge equations; the drops are closed forms.</p>
      </>
    ),
    convergence: ['erevOn', 'eon'],
  },
  lessons: GAN_LESSONS,
  experiments: GAN_EXPERIMENTS,
  predictions: ganPredictions,
  measureLabels: GAN_LABELS,
  status: (st) => ganStatus(st),
  analysis: GAN_ANALYSIS,
  parts: [
    { id: 'hs', label: 'High-side HEMT' },
    { id: 'ls', label: 'Low-side HEMT' },
    { id: 'load', label: 'Inductive load' },
    { id: 'vdc', label: 'DC source' },
    { id: 'driver', label: 'Low-side driver' },
    { id: 'hsdrv', label: 'High-side gate' },
  ],
  readings: ganReadings,
}
