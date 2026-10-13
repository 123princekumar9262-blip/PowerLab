import { SpectrumChart } from '../components/lab/SpectrumChart.tsx'
import { MultiPulseDiagram } from '../components/pwm/MultiPulseDiagram.tsx'
import { MULTI_DEFAULTS, MULTI_LIMITS, simulateMultiPulse, type MultiPulseParams, type MultiPulseRun } from '../converters/pwm/multipulse.ts'
import { bnSum, compareMulti, deltaTheory, hMaxMulti, measureMulti, multiTextbook, multiTheoryAmp, vrmsTheory, type MultiMeasurements } from '../converters/pwm/multipulseAnalysis.ts'
import {
  MULTI_EXPERIMENTS,
  MULTI_LESSONS,
  multiEventLabel,
  multiEventWhy,
  multiNext,
  multiPredictions,
  multiReadings,
  multiStateAt,
  multiStatus,
  multiView,
  multiWhy,
  type MultiState,
} from '../converters/pwm/multipulseContent.ts'
import type { AnalysisCategory, ChannelMeta, Topic } from '../lab/types.ts'
import { formatSI, formatTime, formatV } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  carrier: { id: 'carrier', label: 'c', name: 'Carrier (per unit, drawn mirrored in the negative half)', unit: '', color: '#aeb7c5', group: 'Modulator' },
  ref: { id: 'ref', label: 'r', name: 'Square-wave reference ±M (per unit)', unit: '', color: '#d95926', dash: [6, 4], group: 'Modulator' },
  gate: { id: 'gate', label: 'g', name: 'Comparator output g = (|r| > |c|)', unit: '', color: '#3987e5', group: 'Gates', logic: true },
  gA: { id: 'gA', label: 'gA', name: 'Leg A command (S1 ON)', unit: '', color: '#3987e5', group: 'Gates', logic: true },
  gB: { id: 'gB', label: 'gB', name: 'Leg B command (S3 ON)', unit: '', color: '#008300', group: 'Gates', logic: true },
  vout: { id: 'vout', label: 'vAB', name: 'Output voltage vAB (pulse train)', unit: 'V', color: '#3987e5', group: 'Output' },
  v1: { id: 'v1', label: 'v1', name: 'Fundamental of vAB (from the simulated spectrum)', unit: 'V', color: '#d95926', dash: [6, 4], group: 'Output' },
  vavg: { id: 'vavg', label: 'vavg', name: 'Average of vAB over the last carrier period', unit: 'V', color: '#9085e9', group: 'Output' },
}

const L = MULTI_LIMITS

const ANALYSIS: Array<AnalysisCategory<MultiPulseRun, MultiMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['v1', 'rms', 'deltaDeg', 'pulses'] },
  { id: 'output', label: 'Output', rows: ['v1', 'rms', 'avg', 'switchings'] },
  {
    id: 'harmonics',
    label: 'Harmonics',
    rows: ['h3', 'h5', 'dominant', 'thd', 'df'],
    note: (_m, r) => (r.params.p >= 2 ? `The largest harmonics sit near 2p ± 1 = ${2 * r.params.p - 1}, ${2 * r.params.p + 1} (THEORY: sin(nπ/2p) is small there).` : 'A single pulse: every odd harmonic, largest at n = 3 for most widths.'),
  },
  { id: 'spectrum', label: 'Spectrum', tab: 'spectrum' },
]

export const PWM_MULTI_TOPIC: Topic<MultiPulseParams, MultiPulseRun, MultiMeasurements, MultiState> = {
  id: 'multi-pulse',
  label: 'Multiple pulse',
  title: 'Uniform multiple-pulse PWM (full bridge)',
  defaults: MULTI_DEFAULTS,
  basic: [
    { kind: 'number', key: 'p', label: 'Pulses per half cycle p', unit: '', min: L.p.min, max: L.p.max, step: 1, hint: (p) => (Math.round(p.p) === 1 ? 'single pulse' : `fc = ${formatSI(2 * Math.round(p.p) * p.f1, 'Hz')}`) },
    { kind: 'number', key: 'm', label: 'Modulation index M', unit: '', min: L.m.min, max: L.m.max, step: 0.01, hint: (p) => `δ = ${((p.m * 180) / Math.max(1, Math.round(p.p))).toFixed(1)}°` },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
  ],
  advanced: [
    { kind: 'number', key: 'f1', label: 'Output frequency f1', unit: 'Hz', min: L.f1.min, max: L.f1.max, log: true },
    { kind: 'number', key: 'periods', label: 'Cycles shown', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
    { kind: 'number', key: 'stepsPerPeriod', label: 'Samples per carrier period', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 10, hint: () => 'display only' },
  ],
  paramNote: (_p, r) => `fc = 2p·f1 = ${formatSI(r.params.fc, 'Hz')} · ${r.params.p} pulse${r.params.p > 1 ? 's' : ''} per half cycle · T = ${formatTime(r.params.period)}`,
  simulate: (p) => simulateMultiPulse(p),
  measure: measureMulti,
  state: multiStateAt,
  view: (st, r) => multiView(st, r),
  why: multiWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <MultiPulseDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['carrier', 'ref', 'vout', 'v1'],
  primaryChannels: ['vout', 'v1'],
  addOrder: ['carrier', 'ref', 'gate', 'gA', 'gB', 'vout', 'v1', 'vavg'],
  shade: (r, k) => (r.signals.vout[k] > 0 ? 'rgba(57,135,229,0.08)' : r.signals.vout[k] < 0 ? 'rgba(0,131,0,0.08)' : null),
  shadeLegend: 'blue band: +Vdc pulse (S1 + S4) · green band: −Vdc pulse (S3 + S2)',
  eventLabel: multiEventLabel,
  eventWhy: multiEventWhy,
  eventColor: (e) => (e.kind === 'mode' ? '#d95926' : e.kind === 'gate-on' ? '#3987e5' : '#aeb7c5'),
  initialCursor: (r) => ((2 * Math.ceil(r.params.p / 2) - 1) / (4 * r.params.p)) * r.params.period + r.params.dt / 2,
  // p carrier periods fit exactly in each half cycle: the pattern repeats every fundamental period
  repeats: () => true,
  periodName: 'cycle',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Modulation">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{r.params.p === 1 ? 'SINGLE PULSE' : `${r.params.p} PULSES`}</span>
        <span className="small">
          δ = {m.deltaDeg.toFixed(2)}° · B1 = {formatV(m.v1, false)} peak · Vrms {formatV(m.rms, false)} · largest harmonic n = {m.dominant}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
    </section>
  ),
  summary: (_r, m) => `Fundamental ${formatV(m.v1, false)} peak · ${m.pulses} pulses of ${m.deltaDeg.toFixed(1)}° per half cycle (SIMULATION)`,
  energyLabel: 'Spectrum',
  energy: (_st, m, r) => <SpectrumChart compact title="Spectrum of vAB" sim={m.harmonics} theory={(h) => multiTheoryAmp(r.params, h)} unit="V" f1={r.params.f1} skipDc hMax={Math.max(15, 4 * r.params.p + 5)} />,
  inspect: (part, st, m, r) => {
    const p = r.params
    switch (part) {
      case 'ref':
        return { title: 'Reference', role: 'A square wave of amplitude M: +M in the positive half cycle, −M in the negative one. Its size sets the pulse width; its sign picks the leg.', rows: [['Now', st.ref.toFixed(3)], ['M = Ar/Ac', p.m.toFixed(3)], ['Frequency', formatSI(p.f1, 'Hz')]] }
      case 'carrier':
        return { title: 'Carrier', role: 'A 0…1 triangle, 2p times faster than the output: exactly p triangles per half cycle.', rows: [['|c| now', Math.abs(st.carrier).toFixed(4)], ['Frequency 2p·f1', formatSI(p.fc, 'Hz')], ['One period spans', `${(180 / p.p).toFixed(2)}°`]] }
      case 'cmp':
        return { title: 'Comparator', role: 'HIGH while the reference magnitude is above the carrier.', rows: [['Output now', st.gate ? 'HIGH' : 'LOW'], ['Edges per cycle', String(m.switchings)], ['Pulse width (SIMULATION)', `${m.deltaDeg.toFixed(3)}°`]] }
      case 'steer':
        return { title: 'Steering', role: 'Sends the comparator pulses to leg A in the positive half cycle and to leg B in the negative one; the other leg stays on the lower rail.', rows: [['Half cycle now', st.sign > 0 ? 'positive → leg A' : 'negative → leg B'], ['gA', st.gA ? 'HIGH' : 'LOW'], ['gB', st.gB ? 'HIGH' : 'LOW']] }
      default:
        return {
          title: 'Full bridge',
          role: 'Two legs. A pulse connects the load to +Vdc (S1 + S4) or −Vdc (S3 + S2); between pulses S2 + S4 short it.',
          rows: [
            ['vAB now', formatV(st.vout)],
            ['RMS', formatV(m.rms, false)],
            ['Fundamental (peak)', formatV(m.v1, false)],
            ['THD', `${(m.thd * 100).toFixed(1)} %`],
            ['Switch S1 ON', st.gA ? 'yes' : 'no'],
            ['Switch S3 ON', st.gB ? 'yes' : 'no'],
          ],
        }
    }
  },
  analyze: {
    compare: compareMulti,
    theory: (r) => {
      const p = r.params
      const tb = multiTextbook(p)
      const d = deltaTheory(p)
      return (
        <>
          <h3>Uniform PWM: p equal pulses per half cycle</h3>
          <ol className="derivation">
            <li>
              The carrier is a 0…1 triangle at fc = 2p·f1, so one carrier period spans π/p. It stays below |r| = M for a fraction M of each period: every pulse is <span className="mono">δ = M·π/p</span> = {((d * 180) / Math.PI).toFixed(3)}° wide,
              centred on <span className="mono">θk = (2k − 1)·π/(2p)</span>.
            </li>
            <li>
              vAB = ±Vdc for p·δ of each half cycle and 0 otherwise: <span className="mono">Vrms = Vdc·√(p·δ/π)</span> = Vdc·√M = {formatV(vrmsTheory(p), false)}.
            </li>
            <li>
              Half-wave symmetry leaves only odd harmonics. A pulse of height Vdc from θk − δ/2 to θk + δ/2 contributes (2/π)·∫ Vdc·sin(nθ) dθ = (4Vdc/(nπ))·sin(nδ/2)·sin(nθk), so{' '}
              <span className="mono">Bn = Σk (4Vdc/(nπ))·sin(nδ/2)·sin(nθk)</span> (B1 = {formatV(Math.abs(bnSum(p, 1)), false)}).
            </li>
            <li>
              The sum has a closed form, Σk sin((2k − 1)x) = sin²(px)/sin x: <span className="mono">Bn = (4Vdc/(nπ))·sin(nδ/2)/sin(nπ/(2p))</span>. Its denominator is small at n = 2p ± 1: there all p pulses add in step, which is where the
              largest harmonics move as p grows. Even harmonics vanish.
            </li>
          </ol>
          <ul className="theory-notes">
            {Object.values(tb).map((t) => (
              <li key={t.key}>
                <span className="mono">{t.formula}</span> — {t.assumptions.join(', ')}
              </li>
            ))}
          </ul>
          <p className="small">The simulation never uses these formulas: it locates every comparator edge by root finding and computes the spectrum by exact Fourier integrals of the resulting pulses (harmonics up to n = {hMaxMulti(p)}).</p>
        </>
      )
    },
    tabs: [
      {
        id: 'spectrum',
        label: 'Spectrum',
        render: ({ r, m }) => <SpectrumChart title="Harmonic spectrum of vAB" sim={m.harmonics} theory={(h) => multiTheoryAmp(r.params, h)} unit="V" f1={r.params.f1} skipDc />,
      },
    ],
  },
  analysis: ANALYSIS,
  parts: [
    { id: 'ref', label: 'Reference' },
    { id: 'carrier', label: 'Carrier' },
    { id: 'cmp', label: 'Comparator' },
    { id: 'steer', label: 'Steering' },
    { id: 'bridge', label: 'Full bridge' },
  ],
  status: multiStatus,
  nextConsequence: (r, st) => multiNext(r, st),
  readings: multiReadings,
  lessons: MULTI_LESSONS,
  experiments: MULTI_EXPERIMENTS,
  predictions: multiPredictions,
  measureLabels: {
    v1: { label: 'Fundamental B1 (peak)', fmt: (v) => formatV(v, false) },
    rms: { label: 'RMS', fmt: (v) => formatV(v, false) },
    avg: { label: 'Average', fmt: (v) => formatV(v) },
    thd: { label: 'THD of vAB', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    df: { label: 'Distortion factor', fmt: (v) => `${(v * 100).toFixed(2)} %` },
    pulses: { label: 'Pulses per half cycle', fmt: (v) => String(v) },
    deltaDeg: { label: 'Pulse width δ', fmt: (v) => `${v.toFixed(2)}°` },
    dominant: { label: 'Largest harmonic (order)', fmt: (v) => String(v) },
    h3: { label: '3rd harmonic B3', fmt: (v) => formatV(v, false) },
    h5: { label: '5th harmonic B5', fmt: (v) => formatV(v, false) },
    h3Ratio: { label: 'B3 / B1', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    switchings: { label: 'Comparator edges per cycle', fmt: (v) => String(v) },
  },
}
