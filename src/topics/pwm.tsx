import { SpectrumChart } from '../components/lab/SpectrumChart.tsx'
import { PwmDiagram } from '../components/pwm/PwmDiagram.tsx'
import { comparePwm, measurePwm, pwmTheoryAmp, pwmTextbook, type PwmMeasurements } from '../converters/pwm/analysis.ts'
import { PWM_EXPERIMENTS, PWM_LESSONS, pwmEventLabel, pwmEventWhy, pwmPredictions, pwmStateAt, pwmView, pwmWhy, type PwmState } from '../converters/pwm/content.ts'
import { PWM_DEFAULTS, PWM_LIMITS, simulatePwm, type PwmParams, type PwmRun } from '../converters/pwm/modulator.ts'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatSI, formatTime, formatV } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  carrier: { id: 'carrier', label: 'c', name: 'Carrier c(t) (per unit)', unit: '', color: '#aeb7c5', group: 'Modulator' },
  ref: { id: 'ref', label: 'r', name: 'Reference r(t) (per unit)', unit: '', color: '#d95926', dash: [6, 4], group: 'Modulator' },
  cmp: { id: 'cmp', label: 'r cmp', name: 'Reference as the comparator sees it (sampled for regular sampling)', unit: '', color: '#d95926', group: 'Modulator' },
  gate: { id: 'gate', label: 'Gate', name: 'Comparator output g = (r > c)', unit: '', color: '#3987e5', group: 'Gate', logic: true },
  gh: { id: 'gh', label: 'GH', name: 'Upper gate (after dead time)', unit: '', color: '#3987e5', group: 'Gates', logic: true },
  gl: { id: 'gl', label: 'GL', name: 'Lower gate (after dead time)', unit: '', color: '#008300', group: 'Gates', logic: true },
  vout: { id: 'vout', label: 'vout', name: 'Output voltage (pulse train)', unit: 'V', color: '#3987e5', group: 'Output' },
  vavg: { id: 'vavg', label: 'vavg', name: 'Average of vout over the last carrier period', unit: 'V', color: '#d95926', group: 'Output' },
}

const L = PWM_LIMITS
export const PWM_TOPIC: Topic<PwmParams, PwmRun, PwmMeasurements, PwmState> = {
  id: 'pwm',
  label: 'PWM Lab',
  title: 'PWM modulator',
  defaults: PWM_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'reference',
      label: 'Reference',
      options: [
        { value: 'dc', label: 'DC (duty)', title: 'A constant reference: the classic DC-DC PWM' },
        { value: 'sine', label: 'Sine', title: 'A sine reference: sine-triangle PWM for inverters' },
      ],
    },
    { kind: 'number', key: 'duty', label: 'Duty ratio D', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 1, when: (p) => p.reference === 'dc' },
    { kind: 'number', key: 'fc', label: 'Carrier frequency fc', unit: 'kHz', scale: 1e3, min: L.fc.min, max: L.fc.max, log: true, when: (p) => p.reference === 'dc' },
    { kind: 'number', key: 'm', label: 'Modulation index M', unit: '', min: L.m.min, max: L.m.max, step: 0.01, when: (p) => p.reference === 'sine', hint: (p) => (p.m > 1 ? 'overmodulation' : 'linear') },
    { kind: 'number', key: 'mf', label: 'Frequency ratio mf = fc/f1', unit: '', min: L.mf.min, max: L.mf.max, step: 1, when: (p) => p.reference === 'sine', hint: (p) => `fc = ${formatSI(p.mf * p.f1, 'Hz')}` },
    { kind: 'number', key: 'f1', label: 'Reference frequency f1', unit: 'Hz', min: L.f1.min, max: L.f1.max, log: true, when: (p) => p.reference === 'sine' },
    {
      kind: 'choice',
      key: 'carrier',
      label: 'Carrier',
      options: [
        { value: 'triangle', label: 'Triangle', title: 'Symmetric (centre-aligned) PWM' },
        { value: 'sawtooth', label: 'Sawtooth', title: 'Trailing-edge (edge-aligned) PWM' },
      ],
    },
    {
      kind: 'choice',
      key: 'sampling',
      label: 'Sampling',
      options: [
        { value: 'natural', label: 'Natural', title: 'Analog comparator: the reference is compared as it is' },
        { value: 'regular-sym', label: 'Regular (symmetric)', title: 'Digital: one sample per carrier period' },
        { value: 'regular-asym', label: 'Regular (asymmetric)', title: 'Digital: two samples per carrier period (triangle only)' },
      ],
    },
  ],
  advanced: [
    {
      kind: 'choice',
      key: 'output',
      label: 'Output stage',
      options: [
        { value: 'bipolar', label: 'Bipolar ±Vdc/2', title: 'A half-bridge leg measured from the DC midpoint' },
        { value: 'unipolar', label: 'Unipolar 0…Vdc', title: 'A single switch to ground (DC-DC style)' },
      ],
    },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'bits', label: 'Counter resolution (0 = analog)', unit: 'bit', min: L.bits.min, max: L.bits.max, step: 1, hint: (p) => (p.sampling === 'natural' ? 'applies to regular sampling' : undefined) },
    { kind: 'number', key: 'td', label: 'Dead time td', unit: 'µs', scale: 1e-6, min: L.td.min, max: L.td.max, step: 0.1 },
    { kind: 'number', key: 'periods', label: 'Periods shown', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
    { kind: 'number', key: 'stepsPerPeriod', label: 'Display samples per carrier period', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 10, hint: () => 'edges are exact at any resolution' },
  ],
  paramNote: (_p, r) => `fc = ${formatSI(r.params.fcEff, 'Hz')} · Tc = ${formatTime(r.params.tc)}${r.params.reference === 'sine' ? ` · ${r.params.mf} pulses per cycle` : ''}`,
  simulate: (p) => simulatePwm(p),
  measure: measurePwm,
  state: pwmStateAt,
  view: (st, r) => pwmView(st, r),
  why: pwmWhy,
  Diagram: ({ r, st, selected, onSelect, values }) => <PwmDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} />,
  channels: CH,
  defaultChannels: ['carrier', 'cmp', 'gate', 'vout'],
  addOrder: ['carrier', 'ref', 'cmp', 'gate', 'gh', 'gl', 'vout', 'vavg'],
  shade: (r, k) => (r.signals.gate[k] > 0.5 ? 'rgba(57,135,229,0.07)' : null),
  shadeLegend: 'blue band: gate HIGH',
  eventLabel: pwmEventLabel,
  eventWhy: pwmEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' ? '#3987e5' : '#aeb7c5'),
  initialCursor: (r) => (r.params.reference === 'sine' ? r.params.period / 4 : r.params.tc * 1.05),
  periodName: 'period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Modulation">
      <div className="dc-mode-head">
        <span className={`mode-pill ${r.params.reference === 'sine' && r.params.m > 1 ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>{r.params.reference === 'dc' ? 'DC' : r.params.m > 1 ? 'OVERMOD' : 'LINEAR'}</span>
        <span className="small">
          {r.params.reference === 'dc'
            ? `D = ${(m.dutyMeasured * 100).toFixed(2)} %, average ${formatV(m.avg)}`
            : `V1 = ${formatV(m.v1, false)} peak, THD of the pulses ${(m.thd * 100).toFixed(1)} %${m.dropped ? `, ${m.dropped} carrier periods without switching` : ''}`}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
    </section>
  ),
  summary: (r, m) => (r.params.reference === 'dc' ? `D = ${(m.dutyMeasured * 100).toFixed(1)} % · average ${formatV(m.avg)} (SIMULATION)` : `Fundamental ${formatV(m.v1, false)} peak · ${m.pulses} pulses per cycle (SIMULATION)`),
  energyLabel: 'Spectrum',
  energy: (_st, m, r) => (
    <SpectrumChart
      compact
      title="Spectrum of vout"
      sim={m.harmonics}
      theory={(h) => pwmTheoryAmp(r.params, h)}
      unit="V"
      f1={1 / r.params.period}
      skipDc
      hMax={r.params.reference === 'sine' ? 3 * r.params.mf + 6 : 12}
    />
  ),
  inspect: (part, st, m, r) => {
    const p = r.params
    switch (part) {
      case 'ref':
        return { title: 'Reference', role: 'What the output should do on average: a constant (DC-DC) or a sine (inverter).', rows: [['Now', st.ref.toFixed(4)], ['Kind', p.reference === 'dc' ? `DC, D = ${(p.duty * 100).toFixed(1)} %` : `sine, M = ${p.m}, f1 = ${p.f1} Hz`]] }
      case 'sh':
        return { title: 'Sample & hold', role: 'A digital controller reads the reference once (symmetric) or twice (asymmetric) per carrier period.', rows: [['Held value now', st.cmp.toFixed(4)], ['True reference now', st.ref.toFixed(4)], ['Error', (st.cmp - st.ref).toFixed(4)]] }
      case 'carrier':
        return { title: 'Carrier', role: 'A fast triangle or sawtooth that sweeps the full range once per period.', rows: [['Now', st.carrier.toFixed(4)], ['Frequency', formatSI(p.fcEff, 'Hz')], ['Shape', p.carrier]] }
      case 'cmp':
        return { title: 'Comparator', role: 'Outputs HIGH while the reference is above the carrier.', rows: [['Output now', st.gate ? 'HIGH' : 'LOW'], ['Pulses per period', String(m.pulses)], ['Narrowest pulse', formatTime(m.minPulse)]] }
      case 'dt':
        return { title: 'Dead time', role: 'Delays every turn-on so the two switches of a leg never conduct together.', rows: [['td', formatTime(p.td)], ['GH now', st.gh ? 'ON' : 'OFF'], ['GL now', st.gl ? 'ON' : 'OFF']] }
      default:
        return { title: 'Output stage', role: 'Two switches connect the output to the upper or the lower rail.', rows: [['vout now', formatV(st.vout)], ['Average', formatV(m.avg)], ['RMS', formatV(m.rms, false)], ['Fundamental (peak)', formatV(m.v1, false)], ['THD', `${(m.thd * 100).toFixed(2)} %`]] }
    }
  },
  analyze: {
    compare: comparePwm,
    theory: (r) => {
      const p = r.params
      const tb = pwmTextbook(p)
      return (
        <>
          <h3>{p.reference === 'dc' ? 'A pulse train: average D·Vdc, harmonics at fc, 2fc, …' : 'Sine-triangle PWM: V1 = M·Vdc/2, harmonics around m·mf'}</h3>
          <ol className="derivation">
            <li>
              Comparator: <span className="mono">g = (r &gt; c)</span>. A triangle from −1 to +1 stays below a constant r for a fraction <span className="mono">D = (1 + r)/2</span> of each period.
            </li>
            <li>
              Average over a carrier period: <span className="mono">{p.output === 'bipolar' ? 'vavg = D·(Vdc/2) + (1 − D)·(−Vdc/2) = r·Vdc/2' : 'vavg = D·Vdc'}</span>. With a sine reference r = M·sin(ω1·t) the slow content is
              M·Vdc/2·sin(ω1·t) — the fundamental (natural sampling, M ≤ 1).
            </li>
            <li>
              A pulse of width D·Tc repeated every Tc has the Fourier coefficients <span className="mono">|c_h| = (2·Vdc/(h·π))·|sin(h·π·D)|</span>.
            </li>
            <li>
              With a sine reference every carrier period has a different width; the double Fourier series (Holmes &amp; Lipo) gives the exact spectrum: groups at h = m·mf ± n with amplitudes{' '}
              <span className="mono">(2Vdc/π)·(1/m)·J_n(m·π·M/2)</span> (natural sampling). Regular sampling replaces m by q = m + n/mf and adds small baseband terms.
            </li>
          </ol>
          <ul className="theory-notes">
            {Object.values(tb).map((t) => (
              <li key={t.key}>
                <span className="mono">{t.formula}</span> — {t.assumptions.join(', ')}
                {t.notApplicable ? ` (${t.notApplicable})` : ''}
              </li>
            ))}
          </ul>
          <p className="small">
            The simulation never uses these formulas: it locates every comparator edge by root finding and computes the spectrum by exact Fourier integrals of the resulting pulses.
          </p>
        </>
      )
    },
    tabs: [
      {
        id: 'spectrum',
        label: 'Spectrum',
        render: ({ r, m }) => (
          <SpectrumChart
            title="Harmonic spectrum of vout"
            sim={m.harmonics}
            theory={(h) => pwmTheoryAmp(r.params, h)}
            unit="V"
            f1={1 / r.params.period}
            skipDc
          />
        ),
      },
    ],
    convergence: undefined,
  },
  lessons: PWM_LESSONS,
  experiments: PWM_EXPERIMENTS,
  predictions: pwmPredictions,
  measureLabels: {
    v1: { label: 'Fundamental V1 (peak)', fmt: (v) => formatV(v, false) },
    thd: { label: 'THD of vout', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    rms: { label: 'RMS', fmt: (v) => formatV(v, false) },
    avg: { label: 'Average', fmt: (v) => formatV(v) },
    firstSignificant: { label: 'First significant harmonic (order)', fmt: (v) => String(v) },
    pulses: { label: 'Pulses per period', fmt: (v) => String(v) },
    dropped: { label: 'Carrier periods without switching', fmt: (v) => String(v) },
    h3: { label: '3rd harmonic', fmt: (v) => formatV(v, false) },
    h5: { label: '5th harmonic', fmt: (v) => formatV(v, false) },
  },
}
