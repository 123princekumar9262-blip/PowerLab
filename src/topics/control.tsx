import { BodePlot, ControlDiagram } from '../components/control/ControlViews.tsx'
import { autoGains, CONTROL_DEFAULTS, CONTROL_LIMITS as L, idealDuty, type ControlParams, type PlantKind } from '../converters/control/control.ts'
import {
  compareControl,
  controlEventLabel,
  controlEventWhy,
  controlExperiments,
  controlLessons,
  controlPredictions,
  controlStateAt,
  controlView,
  controlWhy,
  measureControl,
  simulateControl,
  type ControlMeasurements,
  type ControlRun,
  type ControlState,
} from '../converters/control/content.ts'
import type { ChannelMeta, ParamSpec, Topic } from '../lab/types.ts'
import { formatSI, formatTime, formatV } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  vout: { id: 'vout', label: 'Vout', name: 'Output voltage (SIMULATION)', unit: 'V', color: '#d95926', group: 'Output' },
  vref: { id: 'vref', label: 'Vref', name: 'Reference', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'Output' },
  vmodel: { id: 'vmodel', label: 'model', name: 'THEORY: averaged model with the same controller', unit: 'V', color: '#9085e9', dash: [2, 3], group: 'Output' },
  duty: { id: 'duty', label: 'd', name: 'Duty ratio set by the controller', unit: '', color: '#3987e5', group: 'Control' },
  err: { id: 'err', label: 'e', name: 'Error sampled by the controller', unit: 'V', color: '#c98500', group: 'Control' },
  il: { id: 'il', label: 'iL', name: 'Inductor current', unit: 'A', color: '#e66767', group: 'Currents' },
  io: { id: 'io', label: 'iR', name: 'Load current', unit: 'A', color: '#199e70', dash: [6, 4], group: 'Currents' },
  gate: { id: 'gate', label: 'Gate', name: 'PWM gate of Q1', unit: '', color: '#aeb7c5', group: 'Gate', logic: true },
  vsw: { id: 'vsw', label: 'Vsw', name: 'Switch-node voltage', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Converter' },
  vin: { id: 'vin', label: 'Vin', name: 'Input voltage', unit: 'V', color: '#d55181', group: 'Converter' },
}

function specs(kind: PlantKind): { basic: Array<ParamSpec<ControlParams>>; advanced: Array<ParamSpec<ControlParams>> } {
  return {
    basic: [
      { kind: 'choice', key: 'loop', label: 'Loop', options: [{ value: 'closed', label: 'Closed loop (PID)' }, { value: 'open', label: 'Open loop', title: 'Fixed feed-forward duty — no feedback' }] },
      { kind: 'choice', key: 'tuning', label: 'Tuning', options: [{ value: 'auto', label: 'Auto (target fc)', title: 'PID zeros cancel the LC resonance; Ki sets the crossover' }, { value: 'manual', label: 'Manual gains' }], when: (p) => p.loop === 'closed' },
      { kind: 'number', key: 'fcTarget', label: 'Target crossover fc', unit: 'Hz', min: L.fcTarget.min, max: L.fcTarget.max, log: true, when: (p) => p.loop === 'closed' && p.tuning === 'auto' },
      { kind: 'number', key: 'kp', label: 'Kp', unit: '1/V', min: L.kp.min, max: L.kp.max, step: 0.0001, when: (p) => p.loop === 'closed' && p.tuning === 'manual' },
      { kind: 'number', key: 'ki', label: 'Ki', unit: '1/(V·s)', min: L.ki.min, max: L.ki.max, step: 1, when: (p) => p.loop === 'closed' && p.tuning === 'manual' },
      { kind: 'number', key: 'kd', label: 'Kd', unit: 'µs/V', scale: 1e-6, min: L.kd.min, max: L.kd.max, step: 0.1, when: (p) => p.loop === 'closed' && p.tuning === 'manual' },
      { kind: 'number', key: 'vref', label: 'Reference Vref', unit: 'V', min: L.vref.min, max: L.vref.max, log: true, hint: (p) => `ideal D = ${(idealDuty(kind, p.vin, p.vref) * 100).toFixed(1)} %` },
      { kind: 'choice', key: 'refStep', label: 'Reference step', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
      { kind: 'number', key: 'dvref', label: 'Step size ΔVref', unit: 'V', min: L.dvref.min, max: L.dvref.max, step: 0.5, when: (p) => p.refStep === 'on' },
      { kind: 'choice', key: 'loadStep', label: 'Load step', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
      { kind: 'number', key: 'r2', label: 'Load after the step', unit: 'Ω', min: L.r2.min, max: L.r2.max, log: true, when: (p) => p.loadStep === 'on' },
      { kind: 'choice', key: 'lineStep', label: 'Input-voltage step', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
      { kind: 'number', key: 'dvin', label: 'ΔVin', unit: 'V', min: L.dvin.min, max: L.dvin.max, step: 0.5, when: (p) => p.lineStep === 'on' },
    ],
    advanced: [
      { kind: 'number', key: 'vin', label: 'Input voltage Vin', unit: 'V', min: L.vin.min, max: L.vin.max, log: true },
      { kind: 'number', key: 'l', label: 'Inductance L', unit: 'µH', scale: 1e-6, min: L.l.min, max: L.l.max, log: true },
      { kind: 'number', key: 'rl', label: 'Inductor DCR', unit: 'mΩ', scale: 1e-3, min: L.rl.min, max: L.rl.max, step: 5 },
      { kind: 'number', key: 'c', label: 'Capacitance C', unit: 'µF', scale: 1e-6, min: L.c.min, max: L.c.max, log: true },
      { kind: 'number', key: 'r', label: 'Load before the step', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
      { kind: 'number', key: 'fs', label: 'Switching / sampling frequency', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
      { kind: 'number', key: 'dmax', label: 'Maximum duty', unit: '%', scale: 0.01, min: L.dmax.min, max: L.dmax.max, step: 1 },
      { kind: 'number', key: 'tref', label: 'Reference step time', unit: 'ms', scale: 1e-3, min: L.tref.min, max: L.tref.max, step: 0.1 },
      { kind: 'number', key: 'tload', label: 'Load step time', unit: 'ms', scale: 1e-3, min: L.tload.min, max: L.tload.max, step: 0.1 },
      { kind: 'number', key: 'tline', label: 'Input step time', unit: 'ms', scale: 1e-3, min: L.tline.min, max: L.tline.max, step: 0.1 },
      { kind: 'choice', key: 'start', label: 'Start', options: [{ value: 'operating', label: 'At the operating point' }, { value: 'zero', label: 'Discharged (soft start)' }] },
      { kind: 'number', key: 'periods', label: 'Run length (periods)', unit: '', min: L.periods.min, max: L.periods.max, step: 10 },
      { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per period', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, step: 10 },
    ],
  }
}

export function controlTopic(kind: PlantKind): Topic<ControlParams, ControlRun, ControlMeasurements, ControlState> {
  const sp = specs(kind)
  return {
    id: kind,
    label: kind === 'buck' ? 'Buck voltage loop' : 'Boost voltage loop',
    title: `Closed-loop ${kind} converter`,
    defaults: CONTROL_DEFAULTS[kind],
    basic: sp.basic,
    advanced: sp.advanced,
    paramNote: (p, r) => {
      const g = autoGains(kind, p.vin, p.vref, p.l, p.c, p.r, p.fcTarget)
      return `Gains: Kp ${r.params.kp.toPrecision(3)}, Ki ${r.params.ki.toPrecision(3)}, Kd ${r.params.kd.toPrecision(3)} · LC resonance ${formatSI(g.w0 / (2 * Math.PI), 'Hz')}, Q ${g.q.toFixed(1)} · run ${formatTime(r.params.duration)}`
    },
    simulate: (p) => simulateControl(kind, p),
    measure: measureControl,
    state: controlStateAt,
    view: (st, r) => controlView(st, r),
    why: controlWhy,
    Diagram: ({ r, st, selected, onSelect, values, live = true }) => <ControlDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} />,
    channels: CH,
    defaultChannels: ['vout', 'vref', 'vmodel', 'duty', 'il'],
    addOrder: ['vout', 'vref', 'vmodel', 'duty', 'err', 'il', 'io', 'vin', 'gate', 'vsw'],
    shade: (r, k) => {
      const m = Math.floor((r.time[k] - 1e-12) / r.params.ts)
      return r.trace.sat[m] ? 'rgba(250,178,25,0.10)' : null
    },
    shadeLegend: 'amber band: duty saturated',
    eventLabel: controlEventLabel,
    eventWhy: controlEventWhy,
    eventColor: (e) => (e.device === 'SL' || e.device === 'LINE' ? '#fab219' : '#aeb7c5'),
    initialCursor: (r) => Math.min(r.params.duration, (r.params.refStep === 'on' ? r.params.tref : 0) + 4 * r.params.ts),
    periodName: 'period',
    badge: (r, m) => (
      <section className="dc-mode" aria-label="Loop">
        <div className="dc-mode-head">
          <span className={`mode-pill ${r.params.loop === 'open' ? 'mode-pill--dcm' : r.rho < 1 && m.stable ? 'mode-pill--ccm' : 'mode-pill--dcm'}`}>{r.params.loop === 'open' ? 'OPEN' : r.rho < 1 && m.stable ? 'STABLE' : 'UNSTABLE'}</span>
          <span className="small">
            fc {r.loop.fc ? formatSI(r.loop.fc, 'Hz') : '—'} · PM {r.loop.pm !== null ? `${r.loop.pm.toFixed(0)}°` : '—'} · |λ|max {Number.isFinite(r.rho) ? r.rho.toFixed(3) : '—'}
            <span className="muted"> · THEORY</span>
          </span>
        </div>
        <p className="muted small">
          SIMULATION: overshoot {m.overshoot !== null ? `${(m.overshoot * 100).toFixed(1)} %` : '—'}, settling {m.settling !== null ? formatTime(m.settling) : '—'}, load dip {m.loadDev !== null ? formatV(m.loadDev) : '—'}, final error {formatV(m.ssError)}
        </p>
      </section>
    ),
    summary: (r, m) => `${r.params.loop === 'closed' ? 'Closed loop' : 'Open loop'} · final error ${formatV(m.ssError)} · load dip ${m.loadDev !== null ? formatV(m.loadDev) : '—'} (SIMULATION)`,
    energyLabel: 'Bode',
    energy: (_st, _m, r) => <BodePlot lg={r.loop} />,
    inspect: (part, st, m, r) => {
      const p = r.params
      switch (part) {
        case 'pid':
          return { title: 'PID controller', role: 'Turns the sampled error into a duty ratio once per switching period.', rows: [['Kp', `${p.kp.toPrecision(3)} /V`], ['Ki', `${p.ki.toPrecision(3)} /(V·s)`], ['Kd', `${p.kd.toPrecision(3)} s/V`], ['P / I / D now', `${(st.pTerm * 100).toFixed(2)} / ${(st.iTerm * 100).toFixed(2)} / ${(st.dTerm * 100).toFixed(2)} %`], ['Saturated (fraction of periods)', `${(m.satFraction * 100).toFixed(1)} %`]] }
        case 'plant':
          return { title: `${p.kind} converter`, role: 'The power stage: an LC filter driven by the switched voltage.', rows: [['Vin', formatV(p.vin, false)], ['L, C', `${formatSI(p.l, 'H')}, ${formatSI(p.c, 'F')}`], ['LC resonance', formatSI(r.loop.f0, 'Hz')], ['Peak iL in the run', formatSI(m.ilMax, 'A')], ['DCM during the run', m.dcm ? 'yes' : 'no']] }
        case 'sensor':
          return { title: 'Sampler', role: 'Measures Vout once per period, at the start of the period — the only information the controller gets.', rows: [['Sample now', formatV(st.sampled)], ['Sampling frequency', formatSI(p.fs, 'Hz')]] }
        case 'load':
          return { title: 'Load', role: 'Resistive load, stepped once during the run.', rows: [['Before / after', `${formatSI(p.r, 'Ω')} / ${formatSI(p.r2, 'Ω')}`], ['Step time', formatTime(p.tload)], ['Current now', formatSI(st.io, 'A')]] }
        default:
          return { title: 'Reference', role: 'The desired output voltage.', rows: [['Vref now', formatV(st.vref, false)], ['Step', p.refStep === 'on' ? `${formatV(p.dvref)} at ${formatTime(p.tref)}` : 'off']] }
      }
    },
    analyze: {
      compare: compareControl,
      theory: (r) => {
        const p = r.params
        return (
          <>
            <h3>What the theory assumes</h3>
            <ul className="theory-notes">
              <li>
                <b>Averaged model</b> (CCM, ideal devices): {p.kind === 'buck' ? 'L·diL/dt = d·Vin − v,  C·dv/dt = iL − v/R' : 'L·diL/dt = Vin − (1 − d)·v,  C·dv/dt = (1 − d)·iL − v/R'}. With d and R constant over a period it is
                linear: one matrix exponential per period. The same PID law sets each period's duty from the averaged output.
              </li>
              <li>
                <b>Loop gain</b> T = Gc(z)·Gvd(jω)·ZOH: discrete PID Gc(z) = Kp + Ki·Ts·z⁻¹/(1 − z⁻¹) + Kd·(1 − z⁻¹)/Ts.{' '}
                {p.kind === 'buck' ? 'Gvd = Vin/(1 + jωL/R − ω²LC).' : "Gvd = (Vo/D')·(1 − jωL/(R·D'²))/(1 + jωL/(R·D'²) − ω²LC/D'²): note the right-half-plane zero."}
              </li>
              <li>
                <b>Auto tuning</b>: Gc(s) = Ki·(s²/ω0² + s/(Q·ω0) + 1)/s — the two zeros cancel the LC poles (ω0, Q at the nominal load), leaving T ≈ Ki·G0/s: crossover fc = Ki·G0/(2π), phase margin
                ≈ 90° minus the sampling delay.
              </li>
              <li>
                <b>Exact stability</b> of the sampled loop: |λ|max of the linearised period map (iL, v, integrator, previous error), at the start and the end operating point.
              </li>
              <li>The switching simulation needs none of this: it is the real circuit with the controller deciding each period's duty.</li>
            </ul>
            <BodePlot lg={r.loop} />
          </>
        )
      },
      tabs: [{ id: 'bode', label: 'Bode', render: ({ r }) => <BodePlot lg={r.loop} /> }],
      convergence: ['dFinal', 'ssError'],
    },
    lessons: controlLessons(kind),
    experiments: controlExperiments(kind),
    predictions: (seed) => controlPredictions(kind, seed),
    measureLabels: {
      ssError: { label: 'Final error', fmt: (v) => formatV(v) },
      loadDev: { label: 'Load-step deviation', fmt: (v) => formatV(v) },
      recovery: { label: 'Recovery time', fmt: (v) => formatTime(v) },
      settling: { label: 'Settling time', fmt: (v) => formatTime(v) },
      overshoot: { label: 'Overshoot', fmt: (v) => `${(v * 100).toFixed(1)} %` },
      dFinal: { label: 'Final duty', fmt: (v) => `${(v * 100).toFixed(2)} %` },
      satFraction: { label: 'Periods saturated', fmt: (v) => `${(v * 100).toFixed(0)} %` },
    },
  }
}
