import { ConductionChart } from '../components/inverter/ConductionChart.tsx'
import { InverterDiagram } from '../components/inverter/InverterDiagram.tsx'
import { SpectrumChart } from '../components/lab/SpectrumChart.tsx'
import { simulateCircuit } from '../converters/engine.ts'
import { compare120, lineTheoryAmp, measure120, textbook120, theorySegments, type Meas120, type Run120 } from '../converters/inverter/analysis120.ts'
import { INV120_DEFAULTS, model120, type Inv120Params } from '../converters/inverter/conduction120.ts'
import { energy120, eventLabel120, eventWhy120, EXPERIMENTS_120, LESSONS_120, path120, predictions120, readings120, state120, status120, view120, why120, type State120 } from '../converters/inverter/content120.ts'
import { legDevices } from '../converters/inverter/model.ts'
import { INVERTER_LIMITS as L } from '../converters/inverter/modulation.ts'
import type { AnalysisCategory, ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

const COLORS = { v: '#3987e5', i: '#d95926' }
const CH: Record<string, ChannelMeta> = {
  vaN: { id: 'vaN', label: 'vaN', name: 'Leg A voltage (to DC−)', unit: 'V', color: '#d55181', group: 'Leg voltages' },
  vbN: { id: 'vbN', label: 'vbN', name: 'Leg B voltage (to DC−)', unit: 'V', color: '#c98500', group: 'Leg voltages' },
  vcN: { id: 'vcN', label: 'vcN', name: 'Leg C voltage (to DC−)', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Leg voltages' },
  van: { id: 'van', label: 'van', name: 'Phase voltage a to the load neutral', unit: 'V', color: '#d55181', group: 'Phase voltages' },
  vbn: { id: 'vbn', label: 'vbn', name: 'Phase voltage b to the load neutral', unit: 'V', color: '#c98500', group: 'Phase voltages' },
  vcn: { id: 'vcn', label: 'vcn', name: 'Phase voltage c to the load neutral', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Phase voltages' },
  vnN: { id: 'vnN', label: 'vnN', name: 'Load neutral to DC−', unit: 'V', color: '#aeb7c5', group: 'Phase voltages' },
  vab: { id: 'vab', label: 'vab', name: 'Line voltage a−b', unit: 'V', color: COLORS.v, group: 'Line voltages' },
  vbc: { id: 'vbc', label: 'vbc', name: 'Line voltage b−c', unit: 'V', color: '#c98500', group: 'Line voltages' },
  ia: { id: 'ia', label: 'ia', name: 'Phase current a', unit: 'A', color: '#d95926', group: 'Current' },
  ib: { id: 'ib', label: 'ib', name: 'Phase current b', unit: 'A', color: '#c98500', group: 'Current' },
  ic: { id: 'ic', label: 'ic', name: 'Phase current c', unit: 'A', color: '#3987e5', dash: [6, 4], group: 'Current' },
  idc: { id: 'idc', label: 'idc', name: 'DC source current', unit: 'A', color: '#9085e9', dash: [6, 4], group: 'Current' },
  pdc: { id: 'pdc', label: 'Pdc', name: 'Power from the DC source (negative = returned)', unit: 'W', color: '#9085e9', group: 'Power' },
}
for (const d of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'])
  CH[`i${d}`] = { id: `i${d}`, label: `i${d}`, name: `${d.startsWith('D') ? 'Diode' : 'IGBT'} ${d} current`, unit: 'A', color: d.startsWith('D') ? '#008300' : '#3987e5', dash: ['2', '4', '6'].includes(d[1]) ? [6, 4] : undefined, group: 'Device currents' }

const ANALYSIS: Array<AnalysisCategory<Run120, Meas120>> = [
  { id: 'overview', label: 'Overview', rows: ['v1', 'vph1', 'irms', 'floatFraction'] },
  { id: 'phase', label: 'Phase voltage', rows: ['vph1', 'vphRms', 'thdPh'] },
  { id: 'line', label: 'Line voltage', rows: ['v1', 'vrms', 'v5', 'v7', 'v11'] },
  { id: 'current', label: 'Current', rows: ['irms', 'i1', 'ipeak', 'thdI'] },
  { id: 'power', label: 'Power', rows: ['pLoad', 'pDc', 'eReturned'] },
  {
    id: 'devices',
    label: 'Devices',
    rows: ['diodeFraction', 'floatFraction', 's1Frac', 'maxConducting'],
    note: (m, r) => (r.params.conduction === 120 ? `Each leg floats ${((m.floatFraction / 3) * 360).toFixed(1)}° per cycle (SIMULATION); with an R load THEORY gives 2 × 60° = 120°.` : undefined),
  },
  { id: 'spectrum', label: 'Spectrum', tab: 'spectrum' },
]

const model = model120()

export const INV120_TOPIC: Topic<Inv120Params, Run120, Meas120, State120> = {
  id: '120',
  label: '120° conduction',
  title: 'Three-phase VSI, 120° conduction',
  defaults: INV120_DEFAULTS,
  basic: [
    { kind: 'choice', key: 'conduction', label: 'Conduction per switch', options: [{ value: 120, label: '120°', title: 'Two switches at a time; one leg has no gate' }, { value: 180, label: '180° (six-step)', title: 'Three switches at a time, for comparison' }] },
    { kind: 'choice', key: 'load', label: 'Load (each phase)', options: [{ value: 'R', label: 'R', title: 'Resistive: the textbook staircase' }, { value: 'RL', label: 'R-L', title: 'Inductive: the freewheeling diodes clamp the released leg' }] },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'r', label: 'Load resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
    { kind: 'number', key: 'l', label: 'Load inductance L', unit: 'mH', scale: 1e-3, min: L.l.min, max: L.l.max, log: true, when: (p) => p.load === 'RL', hint: (p) => `τ = L/R = ${formatTime(p.l / p.r)} · φ = ${((Math.atan((2 * Math.PI * p.f1 * p.l) / p.r) * 180) / Math.PI).toFixed(1)}°` },
  ],
  advanced: [
    { kind: 'number', key: 'f1', label: 'Output frequency f1', unit: 'Hz', min: L.f1.min, max: L.f1.max, log: true },
    { kind: 'choice', key: 'devices', label: 'Device model', options: [{ value: 'ideal', label: 'Ideal devices', title: '1 mΩ, no voltage drop' }, { value: 'real', label: 'Real devices', title: 'IGBT VCE, diode Vf and on-resistance as set below' }] },
    { kind: 'number', key: 'vce', label: 'IGBT on-state voltage', unit: 'V', min: L.vce.min, max: L.vce.max, step: 0.05, when: (p) => p.devices === 'real' },
    { kind: 'number', key: 'vfD', label: 'Diode forward voltage', unit: 'V', min: L.vfD.min, max: L.vfD.max, step: 0.05, when: (p) => p.devices === 'real' },
    { kind: 'number', key: 'ron', label: 'On-resistance', unit: 'mΩ', scale: 1e-3, min: L.ron.min, max: L.ron.max, log: true, when: (p) => p.devices === 'real' },
    { kind: 'number', key: 'periods', label: 'Cycles shown', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
    { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per cycle', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 60, hint: (p) => `Δt = ${formatSI(1 / p.f1 / p.stepsPerPeriod, 's')}` },
  ],
  viewKey: 'view',
  paramNote: (_p, r) => `T = ${formatTime(r.params.period)} · each switch ${r.params.conduction}° = ${formatTime((r.params.period * r.params.conduction) / 360)}${r.params.load === 'RL' ? ` · τ = L/R = ${formatTime(r.params.l / r.params.r)}` : ''}`,
  simulate: (p) => simulateCircuit(model, p) as Run120,
  measure: measure120,
  state: state120,
  view: (st, r) => view120(st, r),
  why: why120,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => (
    <>
      <InverterDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />
      <ConductionChart r={r} st={st} />
    </>
  ),
  channels: CH,
  defaultChannels: ['vaN', 'van', 'vab', 'ia'],
  primaryChannels: ['van', 'vab'],
  addOrder: Object.keys(CH),
  shade: (r, k) => {
    for (const d of r.devices) if (d.kind === 'diode' && d.on[k]) return 'rgba(0,131,0,0.09)'
    return null
  },
  shadeLegend: 'green band: a freewheeling diode conducts',
  eventLabel: eventLabel120,
  eventWhy: eventWhy120,
  eventColor: (e) => (e.kind.startsWith('gate') ? '#aeb7c5' : e.kind.startsWith('diode') ? '#22b14c' : '#3987e5'),
  initialCursor: (r) => r.params.period * ((r.params.periods > 1 ? 1 : 0) + 30 / 360),
  periodName: 'cycle',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Conduction">
      <div className="dc-mode-head">
        <span className={`mode-pill ${r.params.conduction === 120 ? 'mode-pill--ccm' : 'mode-pill--dcm'}`}>{r.params.conduction === 120 ? '120°' : '180°'}</span>
        <span className="small">
          VLL1 {formatV(m.v1, false)} · Vph1 {formatV(m.vph1, false)} peak · I {formatA(m.irms)} RMS · P {formatW(m.pLoad)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        Legs open {(m.floatFraction * 100).toFixed(1)} % · diodes conduct {(m.diodeFraction * 100).toFixed(1)} % of the cycle (Σ legs) · phase THD {(m.thdPh * 100).toFixed(1)} %
      </p>
    </section>
  ),
  summary: (r, m) => `${r.params.conduction}° conduction: VLL1 = ${formatV(m.v1, false)} peak, phase fundamental ${formatV(m.vph1, false)} (SIMULATION)`,
  energyModel: (st, _m, r) => energy120(st, r),
  path: (st) => path120(st),
  status: (st) => status120(st),
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part.startsWith('load')) {
      const z = Math.hypot(p.r, p.load === 'RL' ? p.omega * p.l : 0)
      const ph = part.slice(5) || 'a'
      const k = 'abc'.indexOf(ph)
      return {
        title: `Load phase ${ph}`,
        role: 'One phase of the balanced star load. With 120° conduction a phase carries no current while its leg is open.',
        rows: [
          ['R', formatSI(p.r, 'Ω')],
          ['L', p.load === 'RL' ? formatSI(p.l, 'H') : '—'],
          ['|Z| at f1', formatSI(z, 'Ω')],
          ['Current now', formatA([st.ia, st.ib, st.ic][k] ?? 0, true)],
          ['Phase voltage now', formatV([st.van, st.vbn, st.vcn][k] ?? 0)],
          ['RMS current', formatA(m.irms)],
        ],
      }
    }
    const d = m.devices[part]
    const isDiode = part.startsWith('D')
    const leg = legDevices(p).findIndex((x) => x.includes(part))
    return {
      title: `${isDiode ? 'Diode' : 'IGBT'} ${part}`,
      role: isDiode ? 'Freewheeling diode: carries the phase current when it flows against the switches — in 120° conduction also in the released leg, until that current dies.' : `Controlled switch: gated for ${p.conduction}° per cycle; conducts forward current while gated.`,
      rows: [
        ['State now', st.legs.some((l) => l.conducting === part) ? 'CONDUCTING' : isDiode ? 'BLOCKING' : st.gated.includes(part) ? 'GATED, NO CURRENT' : 'OFF'],
        ['Conduction (fraction of the cycle)', d ? `${(d.frac * 100).toFixed(2)} %` : '—'],
        ['Average current', d ? formatA(d.iavg) : '—'],
        ['Leg', leg >= 0 ? 'ABC'[leg] : '—'],
      ],
    }
  },
  analyze: {
    compare: compare120,
    theory: (r) => {
      const p = r.params
      const tb = textbook120(p)
      const { th } = theorySegments(p)
      return (
        <>
          <h3>{p.conduction}° conduction: the exact solution with ideal switches</h3>
          <ol className="derivation">
            <li>Firing order S1 … S6, one switch every 60°, each gated for {p.conduction}°{p.conduction === 120 ? ': two switches (one upper, one lower, different legs) at any time; the third leg has no gate.' : ': every leg always has one switch gated (six-step).'}</li>
            <li>
              A leg without a gate is tied to a rail by a diode while its current flows (i &gt; 0: lower diode, 0 V; i &lt; 0: upper diode, Vdc). Once the current is zero it is open and sits at the neutral.
            </li>
            <li>
              All three legs tied: <span className="mono">vn = (vaN + vbN + vcN)/3</span>, each phase <span className="mono">L·di/dt + R·i = vxN − vn</span>. One leg open: the other two carry ±i, <span className="mono">2L·di/dt + 2R·i = vyN − vzN</span>, so the connected phases
              see ±(vyN − vzN)/2 = ±Vdc/2 and the open one 0.
            </li>
            <li>
              Every interval has the same time constant τ = L/R, so each current is A + B·e^(−t/τ): the instant a diode-held current reaches zero is exact. The periodic steady state is the fixed point of one cycle ({th.cycles} cycle
              {th.cycles === 1 ? '' : 's'} of iteration here, {th.segs.length} intervals per cycle).
            </li>
            <li>
              R load: the released current stops at once — <span className="mono">van = ±Vdc/2</span> for 120°, 0 for 60°; its Fourier series is (2Vdc/(nπ))·cos(nπ/6) for odd n, so the fundamental is √3·Vdc/π and only n = 6k ± 1 remain.
            </li>
          </ol>
          <h3>Textbook relations</h3>
          <ul className="theory-notes">
            {Object.values(tb).map((t) => (
              <li key={t.key}>
                <span className="mono">{t.formula}</span> — {t.assumptions.join(', ')}
                {t.notApplicable ? ` (${t.notApplicable})` : ''}
              </li>
            ))}
          </ul>
          <p className="small">The simulation solves the circuit with gated IGBTs, freewheeling diodes and the floating star point on the generic switched-circuit engine; which device conducts — and so the voltage of a released leg — comes out of that solution.</p>
        </>
      )
    },
    tabs: [
      {
        id: 'spectrum',
        label: 'Spectrum',
        render: ({ r, m }) => (
          <>
            <SpectrumChart title="Line voltage vab" sim={m.vHarm} theory={(h) => lineTheoryAmp(r.params, h)} unit="V" f1={r.params.f1} skipDc hMax={25} />
            <SpectrumChart title="Phase voltage van" sim={m.phHarm} unit="V" f1={r.params.f1} skipDc hMax={25} />
          </>
        ),
      },
      {
        id: 'devices',
        label: 'Devices',
        render: ({ m }) => (
          <div className="table-wrap">
            <table className="ba-table">
              <thead>
                <tr>
                  <th>Device (SIMULATION)</th>
                  <th className="num">Conducts (% of cycle)</th>
                  <th className="num">Average current</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(m.devices).map(([id, d]) => (
                  <tr key={id}>
                    <th>{id}</th>
                    <td className="num">{(d.frac * 100).toFixed(2)} %</td>
                    <td className="num">{formatA(d.iavg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">From the exact switching events. Each leg floats (no device conducts): {m.floatPerLeg.map((f, i) => `${'ABC'[i]} ${(f * 360).toFixed(1)}°`).join(', ')} per cycle.</p>
          </div>
        ),
      },
    ],
    convergence: ['irms', 'vph1'],
  },
  analysis: ANALYSIS,
  parts: [
    ...['S1', 'D1', 'S4', 'D4', 'S3', 'D3', 'S6', 'D6', 'S5', 'D5', 'S2', 'D2'].map((id) => ({ id, label: `${id.startsWith('S') ? 'IGBT' : 'Diode'} ${id}` })),
    { id: 'load-a', label: 'Load phase a' },
    { id: 'load-b', label: 'Load phase b' },
    { id: 'load-c', label: 'Load phase c' },
  ],
  readings: readings120,
  lessons: LESSONS_120,
  experiments: EXPERIMENTS_120,
  predictions: predictions120,
  measureLabels: {
    v1: { label: 'Line voltage VLL1 (peak)', fmt: (v) => formatV(v, false) },
    vrms: { label: 'Line voltage RMS', fmt: (v) => formatV(v, false) },
    vph1: { label: 'Phase voltage Vph1 (peak)', fmt: (v) => formatV(v, false) },
    vphRms: { label: 'Phase voltage RMS', fmt: (v) => formatV(v, false) },
    thdPh: { label: 'Phase voltage THD', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    thdV: { label: 'Line voltage THD', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    v5: { label: 'Line 5th harmonic', fmt: (v) => formatV(v, false) },
    v7: { label: 'Line 7th harmonic', fmt: (v) => formatV(v, false) },
    v11: { label: 'Line 11th harmonic', fmt: (v) => formatV(v, false) },
    irms: { label: 'Phase current RMS', fmt: (v) => formatA(v) },
    i1: { label: 'Current fundamental (peak)', fmt: (v) => formatA(v) },
    ipeak: { label: 'Peak phase current', fmt: (v) => formatA(v) },
    thdI: { label: 'Current THD', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    pLoad: { label: 'Load power', fmt: (v) => formatW(v) },
    pDc: { label: 'Power from DC', fmt: (v) => formatW(v) },
    eReturned: { label: 'Energy returned per cycle', fmt: (v) => formatSI(v, 'J') },
    diodeFraction: { label: 'Diode conduction (Σ legs)', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    floatFraction: { label: 'Legs open, no device (Σ legs)', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    s1Frac: { label: 'S1 conducts (fraction of cycle)', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    maxConducting: { label: 'Most devices conducting at once', fmt: (v) => String(v) },
  },
}
