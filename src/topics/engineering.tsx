import { compareThermal, measureThermal, simulateThermal, THERMAL_DEFAULTS, THERMAL_EXPERIMENTS, THERMAL_LESSONS, thermalEventLabel, thermalEventWhy, thermalPredictions, thermalStateAt, thermalView, thermalWhy, type ThermalState } from '../converters/engineering/content.ts'
import { textbookThermal, zth } from '../converters/engineering/theory.ts'
import { THERMAL_LIMITS as L, type ThermalMeasurements, type ThermalParams, type ThermalRun } from '../converters/engineering/thermal.ts'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatSI, formatTime, formatW } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  tj: { id: 'tj', label: 'Tj', name: 'Junction temperature [°C]', unit: '', color: '#e66767', group: 'Temperature' },
  ths: { id: 'ths', label: 'Ths', name: 'Heatsink stage (approx.) [°C]', unit: '', color: '#c98500', dash: [6, 4], group: 'Temperature' },
  ta: { id: 'ta', label: 'Ta', name: 'Ambient [°C]', unit: '', color: '#aeb7c5', dash: [2, 3], group: 'Temperature' },
  p: { id: 'p', label: 'P', name: 'Total loss', unit: 'W', color: '#d55181', group: 'Loss' },
  pc: { id: 'pc', label: 'Pcond', name: 'Conduction loss', unit: 'W', color: '#3987e5', dash: [6, 4], group: 'Loss' },
  ps: { id: 'ps', label: 'Psw', name: 'Switching loss', unit: 'W', color: '#9085e9', dash: [2, 3], group: 'Loss' },
  load: { id: 'load', label: 'Load', name: 'Load on', unit: '', color: '#aeb7c5', group: 'Load', logic: true },
}

function ThermalDiagram({ st, r, selected, onSelect, values, live }: { st: ThermalState; r: ThermalRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean }) {
  const p = r.params
  const part = (id: string, label: string) => ({
    'data-part': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === id,
    className: `cpart ${selected === id ? 'cpart--sel' : ''}`,
    onClick: () => onSelect(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      }
    },
  })
  // node temperatures along the chain: Tj, then minus each stage's drop
  const nodes: number[] = [st.tj]
  for (const th of st.theta) nodes.push(nodes[nodes.length - 1] - th)
  const heat = (t: number) => {
    const f = Math.max(0, Math.min(1, (t - p.ta) / Math.max(1, 150 - p.ta)))
    return `rgba(230,103,103,${0.12 + 0.6 * f})`
  }
  const x0 = 170
  const w = 115
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Thermal path: Tj ${st.tj.toFixed(1)} °C`}>
      <g {...part('switch', 'Power switch (heat source)')}>
        <rect x={30} y={70} width={110} height={80} rx={8} className="cpart-hit" />
        <rect x={34} y={74} width={102} height={72} rx={8} fill={heat(st.tj)} className="sym-body" />
        <text x={85} y={100} textAnchor="middle" className="clabel">
          switch
        </text>
        {live && (
          <text x={85} y={118} textAnchor="middle" className="cvalue cvalue--strong">
            {formatW(st.p)}
          </text>
        )}
        <text x={85} y={134} textAnchor="middle" className="cvalue">
          {st.on ? 'loaded' : 'idle'}
        </text>
      </g>
      <path d={`M140 110 H${x0}`} className={`wire ${st.on ? 'wire--igbt' : ''}`} />
      {p.stages.map((s, j) => {
        const x = x0 + j * w
        const isHs = j === p.stages.length - 1
        return (
          <g key={j} {...part(isHs ? 'heatsink' : 'jc', isHs ? 'Heatsink stage' : `Junction-case Foster stage ${j + 1}`)}>
            <rect x={x} y={70} width={w - 10} height={110} className="cpart-hit" />
            <circle cx={x} cy={110} r={5} fill={heat(nodes[j])} className="sym" />
            <path d={`M${x} 110 H${x + 18}`} className="wire" />
            <rect x={x + 18} y={102} width={50} height={16} rx={2} className="sym-body" />
            <path d={`M${x + 68} 110 H${x + w}`} className="wire" />
            <path d={`M${x + 10} 110 V140 M${x + 76} 110 V140 M${x + 10} 140 H${x + 36} M${x + 50} 140 H${x + 76} M${x + 36} 132 V148 M${x + 50} 132 V148`} className="sym" />
            <text x={x + 43} y={96} textAnchor="middle" className="cvalue">
              {s.r.toFixed(2)} K/W
            </text>
            <text x={x + 43} y={164} textAnchor="middle" className="cvalue">
              τ {formatTime(s.tau)}
            </text>
            {values && (
              <text x={x} y={192} textAnchor="middle" className="cvalue cvalue--strong">
                {nodes[j].toFixed(1)} °C
              </text>
            )}
            <text x={x + 43} y={64} textAnchor="middle" className="clabel">
              {isHs ? 'heatsink' : `Zth(j-c) ${j + 1}`}
            </text>
          </g>
        )
      })}
      <g {...part('ambient', 'Ambient')}>
        <rect x={x0 + 4 * w - 20} y={90} width={60} height={40} className="cpart-hit" />
        <circle cx={x0 + 4 * w} cy={110} r={5} className="sym" />
        <text x={x0 + 4 * w + 10} y={114} className="clabel">
          Ta {p.ta} °C
        </text>
      </g>
      <text x={345} y={240} className="path-caption" textAnchor="middle">
        {live ? (
          <>
            Tj {st.tj.toFixed(1)} °C · Rth(j-a) {p.rth.toFixed(2)} K/W · b·Rth {(p.b * p.rth).toFixed(2)}
            {p.runaway ? ' — RUNAWAY' : ''}
          </>
        ) : p.runaway ? (
          'Thermal runaway: the heat path cannot keep up'
        ) : (
          'Heat flows: junction → case → heatsink → air'
        )}
      </text>
    </svg>
  )
}

/** Zth(t) of the whole path on a logarithmic time axis, with the pulse length marked. */
function ZthPlot({ r }: { r: ThermalRun }) {
  const p = r.params
  const W = 300
  const H = 200
  const t0 = 1e-4
  const t1 = Math.max(10 * p.tauha, 10)
  const X = (t: number) => 34 + ((Math.log10(t) - Math.log10(t0)) / (Math.log10(t1) - Math.log10(t0))) * (W - 44)
  const Y = (z: number) => 10 + (1 - z / p.rth) * (H - 40)
  const pts = Array.from({ length: 121 }, (_, i) => {
    const t = t0 * Math.pow(t1 / t0, i / 120)
    return `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(zth(p, t)).toFixed(1)}`
  }).join(' ')
  const decades: number[] = []
  for (let e = Math.ceil(Math.log10(t0)); e <= Math.floor(Math.log10(t1)); e++) decades.push(10 ** e)
  const tb = textbookThermal(p)
  return (
    <section className="dc-energy" aria-label="Thermal impedance">
      <h3 className="eyebrow">Thermal impedance Zth(t), junction to ambient</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="bi-plot" role="img" aria-label="Zth against time">
        <line x1={34} x2={W - 10} y1={Y(0)} y2={Y(0)} className="bi-axis" />
        <line x1={34} x2={34} y1={10} y2={Y(0)} className="bi-axis" />
        {decades
          .filter((_, i) => decades.length <= 5 || i % 2 === 0)
          .map((d) => (
            <text key={d} x={X(d)} y={H - 16} textAnchor="middle" className="bi-label">
              {d < 1e-3 ? `${Math.round(d * 1e6)} µs` : d < 1 ? `${Math.round(d * 1e3)} ms` : `${Math.round(d)} s`}
            </text>
          ))}
        <path d={pts} className="bi-traj" />
        {p.load === 'pulsed' && (
          <>
            <line x1={X(p.ton)} x2={X(p.ton)} y1={10} y2={Y(0)} className="bi-sat" />
            <text x={X(p.ton) + 3} y={22} className="bi-label">
              ton
            </text>
          </>
        )}
        <text x={38} y={20} className="bi-label">
          {p.rth.toFixed(2)} K/W
        </text>
      </svg>
      <p className="muted small">
        A pulse of length t sees Zth(t), not the full Rth: {p.load === 'pulsed' ? `Zth(ton) = ${zth(p, p.ton).toFixed(3)} K/W of ${p.rth.toFixed(2)} K/W. ` : ''}Loss at 25 °C {formatW(tb.p25)}; temperature
        feedback b = {formatSI(p.b, 'W')}/K.
      </p>
    </section>
  )
}

export const THERMAL_TOPIC: Topic<ThermalParams, ThermalRun, ThermalMeasurements, ThermalState> = {
  id: 'thermal',
  label: 'Losses & thermal',
  title: 'Switch losses through the thermal path',
  defaults: THERMAL_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'load',
      label: 'Load',
      options: [
        { value: 'pulsed', label: 'Pulsed', title: 'Load on for ton, off for toff: power cycling' },
        { value: 'constant', label: 'Constant' },
      ],
    },
    { kind: 'number', key: 'i', label: 'Current I', unit: 'A', min: L.i.min, max: L.i.max, log: true },
    { kind: 'number', key: 'fs', label: 'Switching frequency', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
    { kind: 'number', key: 'rha', label: 'Heatsink Rth(c-a)', unit: 'K/W', min: L.rha.min, max: L.rha.max, log: true },
    { kind: 'number', key: 'ton', label: 'Pulse on-time', unit: 's', min: L.ton.min, max: L.ton.max, log: true, when: (p) => p.load === 'pulsed' },
    { kind: 'number', key: 'toff', label: 'Pause', unit: 's', min: L.toff.min, max: L.toff.max, log: true, when: (p) => p.load === 'pulsed' },
  ],
  advanced: [
    { kind: 'number', key: 'vdc', label: 'DC voltage', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'duty', label: 'Duty D', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 1 },
    { kind: 'number', key: 'ron', label: 'Ron at 25 °C', unit: 'mΩ', scale: 1e-3, min: L.ron.min, max: L.ron.max, log: true },
    { kind: 'number', key: 'alpha', label: 'Ron temperature coefficient', unit: '%/K', scale: 0.01, min: L.alpha.min, max: L.alpha.max, step: 0.05 },
    { kind: 'number', key: 'tsw', label: 'Switching time tsw', unit: 'ns', scale: 1e-9, min: L.tsw.min, max: L.tsw.max, log: true },
    { kind: 'number', key: 'kappa', label: 'Switching-loss temperature coefficient', unit: '%/K', scale: 0.01, min: L.kappa.min, max: L.kappa.max, step: 0.05 },
    { kind: 'number', key: 'tauha', label: 'Heatsink time constant', unit: 's', min: L.tauha.min, max: L.tauha.max, log: true },
    { kind: 'number', key: 'ta', label: 'Ambient Ta', unit: '°C', min: L.ta.min, max: L.ta.max, step: 1 },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    return `P at 25 °C = ${formatW(p.pc25)} conduction + ${formatW(p.ps25)} switching · Rth(j-a) = ${p.rth.toFixed(2)} K/W · b·Rth = ${(p.b * p.rth).toFixed(2)}${p.load === 'pulsed' ? ` · growth per cycle ρ = ${p.growth.toFixed(3)}` : ''}${p.runaway ? ' — THERMAL RUNAWAY' : ''}`
  },
  viewKey: 'view',
  simulate: (p) => simulateThermal(p),
  measure: measureThermal,
  state: thermalStateAt,
  view: (st, r) => thermalView(st, r),
  why: thermalWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true }) => <ThermalDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} />,
  channels: CH,
  defaultChannels: ['tj', 'ths', 'p'],
  addOrder: ['tj', 'ths', 'ta', 'p', 'pc', 'ps', 'load'],
  shade: (r, k) => (r.signals.load[k] > 0.5 ? 'rgba(230,103,103,0.10)' : null),
  shadeLegend: 'red band: load on',
  eventLabel: thermalEventLabel,
  eventWhy: thermalEventWhy,
  eventColor: (e) => (e.device === 'tj-max' ? '#e66767' : '#aeb7c5'),
  // just before the hottest instant (the end of a load pulse), so the cursor shows the loaded state
  initialCursor: (r) => Math.max(0, (r.events.find((e) => e.device === 'tj-max')?.time ?? 0) - 2 * r.params.dt),
  periodName: 'cycle',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Junction temperature">
      <div className="dc-mode-head">
        <span className={`mode-pill ${m.runaway || m.tjMax > 150 ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>{m.runaway ? 'RUNAWAY' : `Tj ${m.tjMax.toFixed(0)} °C`}</span>
        <span className="small">
          mean {m.tjMean.toFixed(1)} °C{r.params.load === 'pulsed' ? ` · ΔTj ${m.dTj.toFixed(1)} K` : ''} · loss {formatW(m.pMean)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        conduction {formatW(m.pcMean)} · switching {formatW(m.psMean)}
        {r.params.view === 'startup' ? ` · 90 % of the rise after ${m.t90 === null ? '—' : formatTime(m.t90)}` : ''}
      </p>
    </section>
  ),
  summary: (_r, m) => `Tj max ${m.tjMax.toFixed(1)} °C · loss ${formatW(m.pMean)} (SIMULATION)`,
  energy: (_st, _m, r) => <ZthPlot r={r} />,
  energyLabel: 'Zth',
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'switch')
      return {
        title: 'Power switch',
        role: 'Turns electrical loss into heat at the junction: conduction loss while on, switching loss at every transition.',
        rows: [
          ['Loss now', formatW(st.p)],
          ['Conduction / switching (mean)', `${formatW(m.pcMean)} / ${formatW(m.psMean)}`],
          ['Ron at 25 °C / at Tj', `${formatSI(p.ron, 'Ω')} / ${formatSI(p.ron * (1 + p.alpha * (st.tj - 25)), 'Ω')}`],
          ['I, D, fs', `${p.i} A, ${(p.duty * 100).toFixed(0)} %, ${formatSI(p.fs, 'Hz')}`],
        ],
      }
    if (part === 'jc')
      return {
        title: 'Junction-to-case (Foster model)',
        role: 'A curve fit of the datasheet thermal impedance: die, solder and baseplate. The individual stages are not physical layers.',
        rows: [...p.stages.slice(0, -1).map((s, j) => [`Stage ${j + 1}`, `${s.r} K/W · τ ${formatTime(s.tau)}`] as [string, string]), ['Rth(j-c)', `${p.rjc.toFixed(2)} K/W`]],
      }
    if (part === 'heatsink') return { title: 'Heatsink', role: 'The large heat capacity: it averages the loss over minutes.', rows: [['Rth(c-a)', `${p.rha} K/W`], ['Time constant', formatTime(p.tauha)], ['Mean temperature (approx.)', `${m.thsMean.toFixed(1)} °C`]] }
    return { title: 'Ambient', role: 'The heat finally goes to the air (or coolant) at Ta.', rows: [['Ta', `${p.ta} °C`]] }
  },
  analyze: {
    compare: compareThermal,
    theory: () => (
      <>
        <h3>Losses, feedback and the thermal path</h3>
        <ol className="derivation">
          <li>
            <b>Losses</b> — <span className="mono">P = D·I²·Ron(Tj) + fs·½·V·I·tsw·(1 + κ·(Tj − 25))</span>, with Ron(Tj) = Ron25·(1 + α·(Tj − 25)): an affine function a + b·(Tj − 25).
          </li>
          <li>
            <b>Thermal path</b> — Foster stages <span className="mono">Ci·dθi/dt = P − θi/Ri</span>, Tj = Ta + Σθi; Zth(t) = Σ Ri·(1 − e^(−t/τi)).
          </li>
          <li>
            <b>Steady state</b> — constant load: <span className="mono">Tj = (Ta + Rth·(a − 25·b))/(1 − b·Rth)</span>; it exists only while b·Rth &lt; 1 — otherwise thermal runaway. Pulsed load: stable while one load cycle shrinks a disturbance,{' '}
            <span className="mono">ρ(e^(A_off·t_off)·e^(A_on·t_on)) &lt; 1</span> — the idle time cools the junction, so a pulsed load can stay stable even with b·Rth ≥ 1.
          </li>
          <li>
            <b>Pulsed load</b> — the exact periodic solution; the datasheet estimate Tj,max ≈ Ta + δ·P·Rth + (1 − δ)·P·Zth(ton) ignores the feedback and the exact pulse history.
          </li>
        </ol>
      </>
    ),
    convergence: ['tjMax', 'pMean'],
  },
  lessons: THERMAL_LESSONS,
  experiments: THERMAL_EXPERIMENTS,
  predictions: thermalPredictions,
  measureLabels: {
    tjMean: { label: 'Mean Tj', fmt: (v) => `${v.toFixed(1)} °C` },
    tjMax: { label: 'Peak Tj', fmt: (v) => `${v.toFixed(1)} °C` },
    dTj: { label: 'ΔTj', fmt: (v) => `${v.toFixed(2)} K` },
    pMean: { label: 'Mean loss', fmt: (v) => formatW(v) },
  },
}
