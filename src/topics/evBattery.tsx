import { BatteryDiagram } from '../components/ev/BatteryDiagram.tsx'
import { BAT_DEFAULTS, BAT_LIMITS as L, OCV_TABLE, type BatteryParams, type BatteryRun } from '../converters/ev/battery.ts'
import {
  BATTERY_EXPERIMENTS,
  BATTERY_LESSONS,
  BATTERY_MEASURE_LABELS,
  batteryEnergy,
  batteryEventLabel,
  batteryEventWhy,
  batteryNext,
  batteryParamNote,
  batteryPath,
  batteryPredictions,
  batteryReadings,
  batteryStateAt,
  batteryStatus,
  batteryView,
  batteryWhy,
  compareBattery,
  fmtDur,
  measureBattery,
  simulateBattery,
  type BatteryMeasurements,
  type BatteryState,
} from '../converters/ev/batteryContent.ts'
import type { AnalysisCategory, ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatV } from '../utils/format.ts'

/** Cell colours: one per cell (the cell voltages and SOCs share their cell's colour; SOC dashed). */
export const CELL_COLORS = ['#3987e5', '#d95926', '#199e70', '#9085e9', '#c98500', '#d55181', '#1aa3b8', '#8a9a2b', '#b5651d', '#6c7fd8', '#2e9e9e', '#a05195']

const CH: Record<string, ChannelMeta> = {
  ipack: { id: 'ipack', label: 'I', name: 'Pack current (+ discharge, − charge)', unit: 'A', color: '#e66767', group: 'Current' },
  vpack: { id: 'vpack', label: 'Vpack', name: 'Pack terminal voltage', unit: 'V', color: '#3987e5', group: 'Pack voltage' },
  vocv: { id: 'vocv', label: 'ΣOCV', name: 'Sum of the cells’ open-circuit voltages', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'Pack voltage' },
  vr0: { id: 'vr0', label: 'R0·i', name: 'R0 drop, all cells', unit: 'V', color: '#d95926', group: 'Drops inside the cells' },
  vpol: { id: 'vpol', label: 'u+w', name: 'RC polarisation, all cells', unit: 'V', color: '#9085e9', dash: [6, 4], group: 'Drops inside the cells' },
  vmin: { id: 'vmin', label: 'Vcell,min', name: 'Lowest cell voltage', unit: 'V', color: '#e66767', dash: [6, 3], group: 'Cell voltages' },
  vmax: { id: 'vmax', label: 'Vcell,max', name: 'Highest cell voltage', unit: 'V', color: '#199e70', dash: [6, 3], group: 'Cell voltages' },
  soce: { id: 'soce', label: 'SOCest', name: 'BMS SOC estimate, coulomb counting [%]', unit: '', color: '#c98500', group: 'State of charge' },
  socavg: { id: 'socavg', label: 'SOCmean', name: 'Mean SOC of the cells (true) [%]', unit: '', color: '#c98500', dash: [6, 4], group: 'State of charge' },
  socmin: { id: 'socmin', label: 'SOCmin', name: 'Lowest cell SOC [%]', unit: '', color: '#e66767', dash: [2, 3], group: 'State of charge' },
  socmax: { id: 'socmax', label: 'SOCmax', name: 'Highest cell SOC [%]', unit: '', color: '#199e70', dash: [2, 3], group: 'State of charge' },
  qpack: { id: 'qpack', label: 'Q', name: 'Charge out of the pack [Ah]', unit: '', color: '#d55181', group: 'Charge' },
  epack: { id: 'epack', label: 'E', name: 'Energy out of the pack terminals', unit: 'J', color: '#d55181', group: 'Energy' },
  pbleed: { id: 'pbleed', label: 'Pbleed', name: 'Power burnt in the bleed resistors', unit: 'W', color: '#d95926', group: 'Balancing' },
  nbleed: { id: 'nbleed', label: 'bleeding', name: 'Cells bleeding [count]', unit: '', color: '#d95926', dash: [2, 3], group: 'Balancing' },
}
for (let i = 1; i <= 12; i++) {
  CH[`v${i}`] = { id: `v${i}`, label: `V${i}`, name: `Cell ${i} voltage`, unit: 'V', color: CELL_COLORS[i - 1], group: 'Cell voltages' }
  CH[`s${i}`] = { id: `s${i}`, label: `SOC${i}`, name: `Cell ${i} state of charge [%]`, unit: '', color: CELL_COLORS[i - 1], dash: [6, 3], group: 'Cell SOC' }
}
const CELLS_V = Array.from({ length: 12 }, (_, i) => `v${i + 1}`)
const CELLS_S = Array.from({ length: 12 }, (_, i) => `s${i + 1}`)

const ANALYSIS: Array<AnalysisCategory<BatteryRun, BatteryMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['qDis', 'eDis', 'cutCell', 'tCut', 'qCh', 'eCh', 'tCharge'] },
  { id: 'cells', label: 'Cells & SOC', rows: ['spread0', 'spreadCh', 'spreadEnd', 'socMinEnd', 'socMaxEnd', 'socAvgEnd', 'socAtCut'] },
  { id: 'sag', label: 'Voltage sag', rows: ['vSag0', 'vSagT', 'vRec', 'rebound', 'vCellMin'], note: (_m, r) => `R0 = ${(r.params.r0 * 1000).toFixed(1)} mΩ, R1 = ${(r.params.r1 * 1000).toFixed(1)} mΩ (τ1 = ${r.params.tau1} s)${r.params.rcPairs === 2 ? `, R2 = ${(r.params.r2 * 1000).toFixed(1)} mΩ (τ2 = ${r.params.tau2} s)` : ''} per cell.` },
  { id: 'bms', label: 'BMS', rows: ['socEstEnd', 'socEstErr', 'tCv', 'eBleed'], note: (_m, r) => `Coulomb counting with Qnom = ${r.params.capacity} Ah and a sensor offset of ${formatA(r.params.iOffset, true)}; balancing ${r.params.balancing}.` },
]

function OcvTable() {
  return (
    <p className="muted small">
      OCV table: {OCV_TABLE.map(([s, v]) => `${(s * 100).toFixed(0)} % → ${v.toFixed(2)} V`).join(' · ')}
    </p>
  )
}

export const EV_BATTERY_TOPIC: Topic<BatteryParams, BatteryRun, BatteryMeasurements, BatteryState> = {
  id: 'evbattery',
  label: 'Battery & BMS',
  title: 'Battery pack and BMS',
  defaults: BAT_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'profile',
      label: 'What the pack does',
      options: [
        { value: 'cycle', label: 'Charge, then drive', title: 'CC-CV charge, a rest, then a constant-current discharge to the cut-off' },
        { value: 'discharge', label: 'Discharge', title: 'Constant-current discharge until the first cell reaches the cut-off' },
        { value: 'pulse', label: 'Pulses', title: 'Current pulses with rests: the instant drop and the RC relaxation' },
        { value: 'charge', label: 'Charge', title: 'CC-CV charge with balancing' },
      ],
    },
    { kind: 'number', key: 'crate', label: 'Discharge current', unit: 'C', min: L.crate.min, max: L.crate.max, step: 0.1, hint: (p) => `${formatA(p.crate * p.capacity)} for ${p.capacity} Ah cells` },
    { kind: 'number', key: 'soc0', label: 'Starting state of charge', unit: '%', scale: 0.01, min: L.soc0.min, max: L.soc0.max, step: 1 },
    {
      kind: 'choice',
      key: 'balancing',
      label: 'Balancing',
      options: [
        { value: 'on', label: 'On', title: 'Bleed resistors on the high cells while charging and in the rest after it' },
        { value: 'off', label: 'Off' },
      ],
    },
    { kind: 'number', key: 'socSpread', label: 'Starting SOC spread (±)', unit: '%', scale: 0.01, min: L.socSpread.min, max: L.socSpread.max, step: 0.5 },
  ],
  advanced: [
    { kind: 'number', key: 'cells', label: 'Cells in series', unit: '', min: L.cells.min, max: L.cells.max, step: 1 },
    { kind: 'number', key: 'capacity', label: 'Cell capacity', unit: 'Ah', min: L.capacity.min, max: L.capacity.max, log: true },
    { kind: 'number', key: 'capSpread', label: 'Capacity spread (±)', unit: '%', scale: 0.01, min: L.capSpread.min, max: L.capSpread.max, step: 0.5 },
    { kind: 'number', key: 'chargeRate', label: 'Charge current (CC)', unit: 'C', min: L.chargeRate.min, max: L.chargeRate.max, step: 0.1 },
    { kind: 'number', key: 'r0', label: 'Cell resistance R0', unit: 'mΩ', scale: 1e-3, min: L.r0.min, max: L.r0.max, log: true },
    {
      kind: 'choice',
      key: 'rcPairs',
      label: 'RC pairs in the cell model',
      options: [
        { value: 1, label: 'One' },
        { value: 2, label: 'Two' },
      ],
    },
    { kind: 'number', key: 'r1', label: 'R1', unit: 'mΩ', scale: 1e-3, min: L.r1.min, max: L.r1.max, step: 0.5 },
    { kind: 'number', key: 'tau1', label: 'τ1 = R1·C1', unit: 's', min: L.tau1.min, max: L.tau1.max, log: true },
    { kind: 'number', key: 'r2', label: 'R2', unit: 'mΩ', scale: 1e-3, min: L.r2.min, max: L.r2.max, step: 0.5, when: (p) => p.rcPairs === 2 },
    { kind: 'number', key: 'tau2', label: 'τ2 = R2·C2', unit: 's', min: L.tau2.min, max: L.tau2.max, log: true, when: (p) => p.rcPairs === 2 },
    { kind: 'number', key: 'vmin', label: 'Cut-off voltage Vmin', unit: 'V', min: L.vmin.min, max: L.vmin.max, step: 0.05 },
    { kind: 'number', key: 'vmax', label: 'Maximum cell voltage Vmax', unit: 'V', min: L.vmax.min, max: L.vmax.max, step: 0.05 },
    { kind: 'number', key: 'threshold', label: 'Balancing threshold', unit: 'mV', scale: 1e-3, min: L.threshold.min, max: L.threshold.max, log: true },
    { kind: 'number', key: 'rbal', label: 'Bleed resistor', unit: 'Ω', min: L.rbal.min, max: L.rbal.max, log: true },
    { kind: 'number', key: 'iOffset', label: 'Current-sensor offset', unit: 'mA', scale: 1e-3, min: L.iOffset.min, max: L.iOffset.max, step: 10 },
    { kind: 'number', key: 'pulseOn', label: 'Pulse length', unit: 's', min: L.pulseOn.min, max: L.pulseOn.max, step: 1, when: (p) => p.profile === 'pulse' },
    { kind: 'number', key: 'pulseOff', label: 'Rest between pulses', unit: 's', min: L.pulseOff.min, max: L.pulseOff.max, step: 1, when: (p) => p.profile === 'pulse' },
    { kind: 'number', key: 'pulses', label: 'Number of pulses', unit: '', min: L.pulses.min, max: L.pulses.max, step: 1, when: (p) => p.profile === 'pulse' },
    { kind: 'number', key: 'rest', label: 'Rest after the load / charge', unit: 's', min: L.rest.min, max: L.rest.max, step: 60 },
  ],
  paramNote: (_p, r) => batteryParamNote(r.params),
  simulate: (p) => simulateBattery(p),
  measure: measureBattery,
  state: batteryStateAt,
  view: (st, r) => batteryView(st, r),
  why: batteryWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <BatteryDiagram r={r} st={st} selected={selected} onSelect={onSelect} live={live} values={values} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['ipack', 'vmax', 'vmin'],
  addOrder: ['ipack', 'vmax', 'vmin', ...CELLS_V, 'vpack', 'vocv', 'vr0', 'vpol', 'soce', 'socavg', 'socmin', 'socmax', ...CELLS_S, 'qpack', 'epack', 'pbleed', 'nbleed'],
  primaryChannels: ['ipack', 'vmin'],
  shade: (r, k) => (r.signals.mode[k] === 1 ? 'rgba(230,103,103,0.07)' : r.signals.mode[k] >= 2 ? 'rgba(34,177,76,0.08)' : r.signals.nbleed[k] > 0 ? 'rgba(217,89,38,0.08)' : null),
  shadeLegend: 'red band: discharging · green band: charging · orange band: balancing at rest',
  eventLabel: batteryEventLabel,
  eventWhy: batteryEventWhy,
  eventColor: (e) => (e.device === 'cutoff' ? '#e66767' : /bleed/.test(e.device ?? '') ? '#d95926' : /cv|charge/.test(e.device ?? '') ? '#22b14c' : '#3987e5'),
  initialCursor: (r) => {
    const c = r.events.find((e) => e.device === 'cutoff')
    if (c) return Math.max(0, c.time - 120)
    const cv = r.events.find((e) => e.device === 'cv')
    if (cv) return cv.time + 300
    const l = r.events.find((e) => e.device === 'load-on')
    return l ? l.time + Math.min(r.params.pulseOn, 60) : r.params.duration / 2
  },
  periodName: 'run',
  repeats: () => false,
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Run result">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{m.qDis !== null ? `${m.qDis.toFixed(3)} Ah` : m.qCh !== null ? `${m.qCh.toFixed(3)} Ah in` : '—'}</span>
        <span className="small">
          {m.cutCell !== null ? `cell ${m.cutCell} ended the discharge after ${fmtDur(m.tDis ?? NaN)}` : m.tCharge !== null ? `charged in ${fmtDur(m.tCharge)}` : `${r.params.pulses} pulses`}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        SOC spread {m.spread0.toFixed(1)} % at the start{m.spreadCh !== null ? ` → ${m.spreadCh.toFixed(2)} % after the charge` : ''} · balancing burnt {m.eBleed.toFixed(2)} Wh
      </p>
    </section>
  ),
  summary: (r, m) =>
    m.qDis !== null && r.params.profile !== 'pulse'
      ? `Usable charge ${m.qDis.toFixed(3)} Ah; cell ${m.cutCell ?? '—'} ended the discharge (SIMULATION)`
      : m.qCh !== null
        ? `Charge accepted ${m.qCh.toFixed(3)} Ah in ${fmtDur(m.tCharge ?? NaN)} (SIMULATION)`
        : `Instant drop ${formatV(m.vSag0 ?? NaN, false)}, ${formatV(m.vSagT ?? NaN, false)} after ${m.sagT} s (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    const cm = /^cell(\d+)$/.exec(part)
    const cellPart = cm ? Number(cm[1]) - 1 : part === 'cellMin' ? st.lo : part === 'cellMax' ? st.hi : -1
    if (cellPart >= 0 && cellPart < p.n) {
      const c = st.cells[cellPart]
      return {
        title: `Cell ${cellPart + 1}`,
        role: 'One lithium-ion cell: an open-circuit voltage that depends on its charge, R0, and RC pairs for the slow drops.',
        rows: [
          ['State now', c.bleed ? 'BLEEDING' : Math.abs(c.i_cell) < 1e-9 ? 'AT REST' : c.i_cell > 0 ? 'DISCHARGING' : 'CHARGING'],
          ['Capacity', `${(p.q[cellPart] / 3600).toFixed(3)} Ah (${(((p.q[cellPart] / 3600 / p.capacity) - 1) * 100).toFixed(1)} % vs nominal)`],
          ['Starting SOC', `${(p.s0[cellPart] * 100).toFixed(1)} %`],
          ['SOC now', `${c.s.toFixed(2)} %`],
          ['OCV now', formatV(c.ocv, false)],
          ['Terminal voltage', formatV(c.v, false)],
          ['Cell current', formatA(c.i_cell, true)],
          ['R0 drop', formatV(p.r0 * c.i_cell, true)],
          ['RC drops u + w', `${formatV(c.u, true)} + ${formatV(c.w, true)}`],
          ['Bleed resistor', c.bleed ? `ON, ${formatA(c.v / p.rbal)}` : 'off'],
        ],
      }
    }
    if (part === 'bms')
      return {
        title: 'BMS',
        role: 'Measures every cell, counts the charge, protects the cells (Vmin, Vmax) and balances them.',
        rows: [
          ['SOC estimate', `${st.soce.toFixed(2)} %`],
          ['True mean SOC', `${st.socavg.toFixed(2)} %`],
          ['Sensor offset', formatA(p.iOffset, true)],
          ['Cut-off / max', `${p.vmin} V / ${p.vmax} V`],
          ['Balancing', p.balancing === 'on' ? `> ${(p.threshold * 1000).toFixed(0)} mV above the lowest, ${p.rbal} Ω` : 'off'],
          ['Bleeding now', st.bleeding.length ? st.bleeding.join(', ') : 'none'],
          ['Energy burnt (run)', `${m.eBleed.toFixed(3)} Wh`],
        ],
      }
    if (part === 'load')
      return {
        title: st.I < 0 || st.phaseKind === 'charge' ? 'Charger' : 'Load',
        role: 'Draws the discharge current (the car) or pushes the charge current (CC, then CV as the BMS asks).',
        rows: [
          ['Current now', formatA(st.I, true)],
          ['Pack voltage', formatV(st.vpack, false)],
          ['Power', formatSI(st.I * st.vpack, 'W')],
          ['Discharge current', `${formatA(p.iDis)} (${p.crate} C)`],
          ['CC charge current', `${formatA(-p.iCc)} (${p.chargeRate} C), ends below ${formatA(p.iTerm)}`],
        ],
      }
    return {
      title: 'Pack and contactor',
      role: `${p.n} cells in series: one current through all of them; the pack voltage is the sum of the cell voltages.`,
      rows: [
        ['Contactor', st.cutOff && st.phaseKind === 'rest' ? 'OPEN (cut-off)' : 'closed'],
        ['Pack voltage', formatV(st.vpack, false)],
        ['Sum of the OCVs', formatV(st.vocv, false)],
        ['Lowest / highest cell', `${formatV(st.cells[st.lo].v, false)} / ${formatV(st.cells[st.hi].v, false)}`],
        ['Nominal energy', `${((p.n * p.capacity * 3.7)).toFixed(0)} Wh (3.7 V × ${p.capacity} Ah × ${p.n})`],
      ],
    }
  },
  parts: [
    { id: 'pack', label: 'Pack and contactor' },
    { id: 'cellMin', label: 'Lowest cell now' },
    { id: 'cellMax', label: 'Highest cell now' },
    { id: 'bms', label: 'BMS' },
    { id: 'load', label: 'Load / charger' },
  ],
  analyze: {
    compare: compareBattery,
    theory: (r) => (
      <>
        <h3>Cell model, BMS and the exact solution</h3>
        <ol className="derivation">
          <li>
            <b>Cell</b> — <span className="mono">V = OCV(SOC) − R0·i − u − w</span>, with <span className="mono">du/dt = (R1·i − u)/τ1</span> and <span className="mono">dw/dt = (R2·i − w)/τ2</span>.
          </li>
          <li>
            <b>RC step response</b> — after a current step to I: <span className="mono">u(t) = u0·e^(−t/τ1) + R1·I·(1 − e^(−t/τ1))</span>. The R0 drop appears at once; u and w follow over τ1 = {r.params.tau1} s
            {r.params.rcPairs === 2 ? ` and τ2 = ${r.params.tau2} s` : ''}.
          </li>
          <li>
            <b>SOC by charge integration</b> — <span className="mono">SOC(t) = SOC0 − ∫i dt / Q</span>. The BMS counts the pack current: <span className="mono">SOCest = SOCest0 − ∫(I + offset) dt / Qnom</span>.
          </li>
          <li>
            <b>Energy</b> — <span className="mono">E = ∫ Vpack·I dt</span>. <b>Usable capacity</b> — the discharge ends when the first cell reaches Vmin:{' '}
            <span className="mono">Q_usable = min over the cells of the charge above the cut-off</span>.
          </li>
          <li>
            <b>Exact solution</b> — with OCV linear on each table segment, the pack is a linear system between BMS samples:{' '}
            <span className="mono">x(h) = e^(A·h)·x0 + ∫e^(A·τ)dτ·b</span>. Every event (OCV breakpoint, cut-off, CC → CV, end of charge) is found on this exact flow.
          </li>
        </ol>
        <OcvTable />
      </>
    ),
    convergence: ['qDis', 'qCh'],
  },
  analysis: ANALYSIS,
  status: (st, r) => batteryStatus(st, r),
  next: (r, st) => batteryNext(r, st)?.text ?? null,
  nextConsequence: (r, st) => batteryNext(r, st),
  path: (st) => batteryPath(st),
  energyModel: (st, _m, r) => batteryEnergy(st, r),
  readings: batteryReadings,
  lessons: BATTERY_LESSONS,
  experiments: BATTERY_EXPERIMENTS,
  predictions: batteryPredictions,
  measureLabels: BATTERY_MEASURE_LABELS,
}
