import { InverterDiagram } from '../components/inverter/InverterDiagram.tsx'
import { SpectrumChart } from '../components/lab/SpectrumChart.tsx'
import { simulateCircuit } from '../converters/engine.ts'
import { compareInverter, idealSegments, inverterTextbook, measureInverter, outputSignal, voltageTheoryAmp, type InverterMeasurements, type InverterRun } from '../converters/inverter/analysis.ts'
import { invEventLabel, invEventWhy, invExperiments, invLessons, invPredictions, invStateAt, invView, invWhy, type InvKind, type InvState } from '../converters/inverter/content.ts'
import { inverterModel, legDevices } from '../converters/inverter/model.ts'
import { INVERTER_LIMITS as L, type InverterParams } from '../converters/inverter/modulation.ts'
import type { ChannelMeta, ParamSpec, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import { inverterReadings } from './readings.ts'

const BASE: InverterParams = {
  topology: 'full',
  modulation: 'square',
  vdc: 100,
  f1: 50,
  load: 'RL',
  r: 10,
  l: 20e-3,
  alphaDeg: 30,
  m: 0.8,
  mf: 15,
  sampling: 'natural',
  devices: 'ideal',
  vce: 1.5,
  vfD: 1,
  ron: 0.02,
  td: 0,
  view: 'steady',
  periods: 2,
  stepsPerPeriod: 1000,
}

export const INVERTER_DEFAULTS: Record<InvKind, InverterParams> = {
  '1ph': { ...BASE },
  '3ph': { ...BASE, topology: 'three', modulation: 'six-step', stepsPerPeriod: 1200 },
  spwm: { ...BASE, modulation: 'spwm-bipolar', periods: 1, stepsPerPeriod: 1500 },
  svpwm: { ...BASE, topology: 'three', modulation: 'svpwm', m: 0.9, periods: 1, stepsPerPeriod: 1500 },
}

const loadSpecs: Array<ParamSpec<InverterParams>> = [
  { kind: 'choice', key: 'load', label: 'Load', options: [{ value: 'RL', label: 'R-L', title: 'Inductive load (motor-like)' }, { value: 'R', label: 'R', title: 'Resistive load' }] },
  { kind: 'number', key: 'r', label: 'Load resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
  { kind: 'number', key: 'l', label: 'Load inductance L', unit: 'mH', scale: 1e-3, min: L.l.min, max: L.l.max, log: true, when: (p) => p.load === 'RL', hint: (p) => `φ = ${((Math.atan((2 * Math.PI * p.f1 * p.l) / p.r) * 180) / Math.PI).toFixed(1)}°` },
]
const advanced: Array<ParamSpec<InverterParams>> = [
  { kind: 'choice', key: 'devices', label: 'Device model', options: [{ value: 'ideal', label: 'Ideal devices', title: '1 mΩ, no voltage drop' }, { value: 'real', label: 'Real devices', title: 'IGBT VCE, diode Vf and on-resistance as set below' }] },
  { kind: 'number', key: 'vce', label: 'IGBT on-state voltage', unit: 'V', min: L.vce.min, max: L.vce.max, step: 0.05, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'vfD', label: 'Diode forward voltage', unit: 'V', min: L.vfD.min, max: L.vfD.max, step: 0.05, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'ron', label: 'On-resistance', unit: 'mΩ', scale: 1e-3, min: L.ron.min, max: L.ron.max, log: true, when: (p) => p.devices === 'real' },
  { kind: 'number', key: 'td', label: 'Dead time td', unit: 'µs', scale: 1e-6, min: L.td.min, max: L.td.max, step: 0.5 },
  { kind: 'number', key: 'periods', label: 'Cycles shown', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
  { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per cycle', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 50, hint: (p) => `Δt = ${formatSI(1 / p.f1 / p.stepsPerPeriod, 's')}` },
]

function basicSpecs(kind: InvKind): Array<ParamSpec<InverterParams>> {
  const vdc: ParamSpec<InverterParams> = { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true }
  const f1: ParamSpec<InverterParams> = { kind: 'number', key: 'f1', label: 'Output frequency f1', unit: 'Hz', min: L.f1.min, max: L.f1.max, log: true }
  const m: ParamSpec<InverterParams> = { kind: 'number', key: 'm', label: 'Modulation index m', unit: '', min: L.m.min, max: L.m.max, step: 0.01, hint: (p) => (p.m > (p.modulation === 'svpwm' ? 2 / Math.sqrt(3) : 1) ? 'overmodulation' : 'linear') }
  const mf: ParamSpec<InverterParams> = { kind: 'number', key: 'mf', label: 'Frequency ratio mf', unit: '', min: L.mf.min, max: L.mf.max, step: 1, hint: (p) => `fs = ${formatSI(p.mf * p.f1, 'Hz')}` }
  if (kind === '1ph')
    return [
      { kind: 'choice', key: 'topology', label: 'Bridge', options: [{ value: 'full', label: 'Full bridge (H)', title: 'Two legs: ±Vdc' }, { value: 'half', label: 'Half bridge', title: 'One leg and a split DC source: ±Vdc/2' }] },
      { kind: 'choice', key: 'modulation', label: 'Waveform', options: [{ value: 'square', label: 'Square wave' }, { value: 'quasi', label: 'Quasi-square (α)', title: 'Full bridge only: zero intervals of width 2α' }], when: (p) => p.topology === 'full' },
      { kind: 'number', key: 'alphaDeg', label: 'Zero-interval half-width α', unit: '°', min: L.alphaDeg.min, max: L.alphaDeg.max, step: 1, when: (p) => p.topology === 'full' && p.modulation === 'quasi' },
      vdc,
      f1,
      ...loadSpecs,
    ]
  if (kind === '3ph') return [vdc, f1, ...loadSpecs]
  if (kind === 'spwm')
    return [
      { kind: 'choice', key: 'modulation', label: 'Scheme', options: [{ value: 'spwm-bipolar', label: '1-ph bipolar' }, { value: 'spwm-unipolar', label: '1-ph unipolar' }, { value: 'spwm', label: '3-phase' }] },
      m,
      mf,
      { kind: 'choice', key: 'sampling', label: 'Sampling', options: [{ value: 'natural', label: 'Natural' }, { value: 'regular-sym', label: 'Regular' }] },
      vdc,
      f1,
      ...loadSpecs,
    ]
  return [m, mf, vdc, f1, ...loadSpecs]
}

/**
 * SPWM topic: the scheme decides the bridge. SVPWM topic: three-phase SVPWM — or three-phase sine-triangle PWM
 * when asked for explicitly (its "SVPWM vs SPWM" experiment compares the two on the same bridge).
 */
const normalise = (kind: InvKind, p: InverterParams): InverterParams =>
  kind === 'spwm' ? { ...p, topology: p.modulation === 'spwm' ? 'three' : 'full' } : kind === 'svpwm' ? { ...p, topology: 'three', modulation: p.modulation === 'spwm' ? 'spwm' : 'svpwm' } : kind === '3ph' ? { ...p, topology: 'three', modulation: 'six-step' } : p.topology === 'half' ? { ...p, modulation: 'square' } : p

const COLORS = { v: '#3987e5', i: '#d95926' }
function channels(kind: InvKind): Record<string, ChannelMeta> {
  const ch: Record<string, ChannelMeta> = {
    vo: { id: 'vo', label: kind === '3ph' || kind === 'svpwm' ? 'vab' : 'vo', name: kind === '3ph' || kind === 'svpwm' ? 'Line voltage vab' : 'Output voltage', unit: 'V', color: COLORS.v, group: 'Output voltage' },
    io: { id: 'io', label: kind === '3ph' || kind === 'svpwm' ? 'ia' : 'io', name: 'Load current', unit: 'A', color: COLORS.i, group: 'Current' },
    pdc: { id: 'pdc', label: 'Pdc', name: 'Power from the DC source (negative = returned)', unit: 'W', color: '#9085e9', group: 'Power' },
    idc: { id: 'idc', label: 'idc', name: 'DC source current', unit: 'A', color: '#9085e9', dash: [6, 4], group: 'Current' },
    vaN: { id: 'vaN', label: 'vaN', name: 'Leg A voltage', unit: 'V', color: '#d55181', group: 'Leg voltages' },
  }
  const three = kind === '3ph' || kind === 'svpwm' || kind === 'spwm'
  if (three) {
    Object.assign(ch, {
      vbN: { id: 'vbN', label: 'vbN', name: 'Leg B voltage', unit: 'V', color: '#c98500', group: 'Leg voltages' },
      vcN: { id: 'vcN', label: 'vcN', name: 'Leg C voltage', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Leg voltages' },
      vab: { id: 'vab', label: 'vab', name: 'Line voltage a−b', unit: 'V', color: COLORS.v, group: 'Line voltages' },
      vbc: { id: 'vbc', label: 'vbc', name: 'Line voltage b−c', unit: 'V', color: '#c98500', group: 'Line voltages' },
      van: { id: 'van', label: 'van', name: 'Phase voltage a to the load neutral', unit: 'V', color: '#d55181', group: 'Phase voltages' },
      vnN: { id: 'vnN', label: 'vnN', name: 'Load neutral to DC− (zero sequence)', unit: 'V', color: '#aeb7c5', group: 'Phase voltages' },
      ia: { id: 'ia', label: 'ia', name: 'Phase current a', unit: 'A', color: '#d55181', group: 'Current' },
      ib: { id: 'ib', label: 'ib', name: 'Phase current b', unit: 'A', color: '#c98500', group: 'Current' },
      ic: { id: 'ic', label: 'ic', name: 'Phase current c', unit: 'A', color: '#3987e5', dash: [6, 4], group: 'Current' },
    })
  } else {
    ch.vbN = { id: 'vbN', label: 'vbN', name: 'Leg B voltage', unit: 'V', color: '#c98500', group: 'Leg voltages' }
  }
  for (const d of ['D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3', 'S4'])
    ch[`i${d}`] = { id: `i${d}`, label: `i${d}`, name: `${d.startsWith('D') ? 'Diode' : 'IGBT'} ${d} current`, unit: 'A', color: d.startsWith('D') ? '#008300' : '#3987e5', dash: d.endsWith('2') || d.endsWith('4') ? [6, 4] : undefined, group: 'Device currents' }
  return ch
}

const TITLE: Record<InvKind, string> = { '1ph': 'Single-phase inverter', '3ph': 'Three-phase inverter (six-step)', spwm: 'Sinusoidal PWM inverter', svpwm: 'Space-vector PWM inverter' }

export function inverterTopic(kind: InvKind): Topic<InverterParams, InverterRun, InverterMeasurements, InvState> {
  const defaults = INVERTER_DEFAULTS[kind]
  const model = inverterModel(defaults, `inv-${kind}`)
  const ch = channels(kind)
  const three = (p: { topology: string }) => p.topology === 'three'
  const defaultChannels = kind === '1ph' ? ['vo', 'io', 'pdc'] : kind === '3ph' ? ['vaN', 'van', 'vab', 'ia'] : kind === 'spwm' ? ['vo', 'io'] : ['vaN', 'vnN', 'vab', 'ia']
  return {
    id: kind,
    label: kind === '1ph' ? 'Single-phase' : kind === '3ph' ? 'Three-phase' : kind === 'spwm' ? 'SPWM' : 'SVPWM',
    title: TITLE[kind],
    defaults,
    basic: basicSpecs(kind),
    advanced,
    viewKey: 'view',
    paramNote: (_p, r) => `T = ${formatTime(r.params.period)}${r.params.tc ? ` · fs = ${formatSI(1 / r.params.tc, 'Hz')}` : ''}${r.params.load === 'RL' ? ` · τ = L/R = ${formatTime(r.params.l / r.params.r)}` : ''}`,
    simulate: (p) => simulateCircuit(model, normalise(kind, p)),
    measure: measureInverter,
    state: invStateAt,
    view: (st, r) => invView(st, r),
    why: invWhy,
    Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <InverterDiagram st={st} p={r.params} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
    channels: ch,
    defaultChannels,
    addOrder: Object.keys(ch),
    shade: (r, k) => {
      // green band: a freewheeling diode carries a leg current
      for (const d of r.devices) if (d.kind === 'diode' && d.on[k]) return 'rgba(0,131,0,0.09)'
      return null
    },
    shadeLegend: 'green band: a diode carries current (energy returns to the DC side)',
    eventLabel: invEventLabel,
    eventWhy: invEventWhy,
    eventColor: (e) => (e.kind.startsWith('gate') ? '#aeb7c5' : e.kind.startsWith('diode') ? '#22b14c' : '#3987e5'),
    initialCursor: (r) => r.params.period * (r.params.periods > 1 ? 1.25 : 0.25),
    periodName: 'cycle',
    badge: (r, m) => (
      <section className="dc-mode" aria-label="Output">
        <div className="dc-mode-head">
          <span className={`mode-pill ${r.params.tc && r.params.m > (r.params.modulation === 'svpwm' ? 2 / Math.sqrt(3) : 1) ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>
            {r.params.modulation === 'six-step' ? '6-STEP' : r.params.tc ? (r.params.m > (r.params.modulation === 'svpwm' ? 2 / Math.sqrt(3) : 1) ? 'OVERMOD' : 'LINEAR') : r.params.modulation === 'quasi' ? 'QUASI' : 'SQUARE'}
          </span>
          <span className="small">
            {three(r.params) ? 'VLL1' : 'V1'} {formatV(m.v1, false)} peak · I {formatA(m.irms)} RMS · P {formatW(m.pLoad)}
            <span className="muted"> · SIMULATION</span>
          </span>
        </div>
        <p className="muted small">
          Voltage THD {(m.thdV * 100).toFixed(1)} % · current THD {(m.thdI * 100).toFixed(1)} % · diodes conduct {(m.diodeFraction * 100).toFixed(1)} % (Σ legs) · {formatSI(m.eReturned, 'J')} per cycle returned to DC
        </p>
      </section>
    ),
    summary: (r, m) => `${three(r.params) ? 'VLL1' : 'V1'} = ${formatV(m.v1, false)} peak · load current ${formatA(m.irms)} RMS (SIMULATION)`,
    energyLabel: 'Spectrum',
    energy: (_st, m, r) => (
      <SpectrumChart compact title={`Spectrum of ${outputSignal(r.params)}`} sim={m.vHarm} theory={(h) => voltageTheoryAmp(r.params, h)} unit="V" f1={r.params.f1} skipDc hMax={r.params.tc ? 2 * r.params.mf + 6 : 25} />
    ),
    inspect: (part, st, m, r) => {
      const p = r.params
      if (part.startsWith('load')) {
        const z = Math.hypot(p.r, p.load === 'RL' ? p.omega * p.l : 0)
        return { title: `Load ${part.slice(5) || ''}`.trim(), role: 'R in series with L: the inductance smooths the current and makes it lag the voltage.', rows: [['R', formatSI(p.r, 'Ω')], ['L', p.load === 'RL' ? formatSI(p.l, 'H') : '—'], ['|Z| at f1', formatSI(z, 'Ω')], ['Current now', formatA(st.ia, true)], ['RMS current', formatA(m.irms)], ['Current THD', `${(m.thdI * 100).toFixed(2)} %`], ['Power', formatW(m.pLoad)]] }
      }
      const d = m.devices[part]
      const isDiode = part.startsWith('D')
      return {
        title: `${isDiode ? 'Diode' : 'IGBT'} ${part}`,
        role: isDiode ? 'Freewheeling diode: carries the load current when it flows against the switch beside it — returning energy to the DC source.' : 'Controlled switch: conducts forward current while gated.',
        rows: [
          ['Conducting now', st.legs.some((l) => l.conducting === part) ? 'yes' : 'no'],
          ['Conduction (fraction of the cycle)', d ? `${(d.frac * 100).toFixed(2)} %` : '—'],
          ['Average current', d ? formatA(d.iavg) : '—'],
          ['Leg', legDevices(p).findIndex((x) => x.includes(part)) >= 0 ? 'ABC'[legDevices(p).findIndex((x) => x.includes(part))] : '—'],
        ],
      }
    },
    analyze: {
      compare: compareInverter,
      theory: (r) => {
        const p = r.params
        const tb = inverterTextbook(p)
        const segs = idealSegments(p)
        return (
          <>
            <h3>{TITLE[kind]}: what the theory assumes</h3>
            <ul className="theory-notes">
              <li>Ideal switches: each leg sits exactly on a rail as commanded; no dead time, no voltage drops.</li>
              <li>The output voltage is then a known piecewise-constant waveform ({segs.length} segments per cycle here): its Fourier series is exact.</li>
              <li>
                The load obeys <span className="mono">L·di/dt + R·i = v(t)</span>: on each segment <span className="mono">i(t) = v/R + (i₀ − v/R)·e^(−t/τ)</span>; the periodic steady state is the fixed point
                i(T) = i(0). Each current harmonic is <span className="mono">I_h = V_h/|R + j·h·ω·L|</span>.
              </li>
              {three(p) && <li>Balanced star load: the neutral sits at vnN = (vaN + vbN + vcN)/3, so van = vaN − vnN.</li>}
            </ul>
            <h3>Textbook relations</h3>
            <ul className="theory-notes">
              {Object.values(tb).map((t) => (
                <li key={t.key}>
                  <span className="mono">{t.formula}</span> — {t.assumptions.join(', ')}
                  {t.notApplicable ? ` (${t.notApplicable})` : ''}
                </li>
              ))}
              {p.tc ? (
                <li>
                  Sine-triangle PWM spectrum: every leg is a two-level PWM waveform with the Bessel double-Fourier series of the PWM lab; the output is the difference of two legs, so
                  {p.modulation === 'spwm-unipolar' ? ' the components at odd multiples of mf cancel (unipolar).' : p.topology === 'three' ? ' the carrier components (common to all legs) cancel in the line voltages.' : ' bipolar switching keeps them.'}
                </li>
              ) : null}
            </ul>
            <p className="small">The simulation solves the circuit with real diodes and gated IGBTs: which device conducts, and therefore the voltage during dead time, comes out of the solution.</p>
          </>
        )
      },
      tabs: [
        {
          id: 'spectrum',
          label: 'Spectrum',
          render: ({ r, m }) => (
            <>
              <SpectrumChart title={`Output voltage (${outputSignal(r.params)})`} sim={m.vHarm} theory={(h) => voltageTheoryAmp(r.params, h)} unit="V" f1={r.params.f1} skipDc />
              <SpectrumChart title="Load current" sim={m.iHarm} unit="A" f1={r.params.f1} skipDc />
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
              <p className="small muted">Conduction intervals from the exact switching events of the simulation. Energy returned to the DC source per cycle: {formatSI(m.eReturned, 'J')}.</p>
            </div>
          ),
        },
      ],
      convergence: ['irms', 'ipeak'],
    },
    lessons: invLessons(kind),
    experiments: invExperiments(kind),
    predictions: (seed) => invPredictions(kind, seed),
    readings: inverterReadings,
    measureLabels: {
      v1: { label: 'Output fundamental (peak)', fmt: (v) => formatV(v, false) },
      v3: { label: '3rd harmonic of the output', fmt: (v) => formatV(v, false) },
      thdV: { label: 'Voltage THD', fmt: (v) => `${(v * 100).toFixed(1)} %` },
      thdI: { label: 'Current THD', fmt: (v) => `${(v * 100).toFixed(2)} %` },
      i1: { label: 'Current fundamental (peak)', fmt: (v) => formatA(v) },
      irms: { label: 'Current RMS', fmt: (v) => formatA(v) },
      pLoad: { label: 'Load power', fmt: (v) => formatW(v) },
      diodeFraction: { label: 'Diode conduction (Σ legs)', fmt: (v) => `${(v * 100).toFixed(1)} %` },
      eReturned: { label: 'Energy returned per cycle', fmt: (v) => formatSI(v, 'J') },
      vnNrms: { label: 'Neutral voltage RMS', fmt: (v) => formatV(v, false) },
    },
  }
}
