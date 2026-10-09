import { compareCore, CORE_DEFAULTS, CORE_EXPERIMENTS, CORE_LESSONS, coreEventLabel, coreEventWhy, corePredictions, coreStateAt, coreView, coreWhy, measureCore, simulateCore, type CoreState } from '../converters/magnetics/content.ts'
import { CORE_LIMITS as L, currentOf, type CoreMeasurements, type CoreParams, type CoreRun } from '../converters/magnetics/core.ts'
import { textbookCore } from '../converters/magnetics/theory.ts'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  v: { id: 'v', label: 'v', name: 'Applied voltage (H-bridge)', unit: 'V', color: '#3987e5', group: 'Voltage' },
  vl: { id: 'vl', label: 'vL', name: 'Voltage on the inductance v − R·i', unit: 'V', color: '#9085e9', dash: [6, 4], group: 'Voltage' },
  i: { id: 'i', label: 'i', name: 'Winding current', unit: 'A', color: '#e66767', group: 'Current' },
  b: { id: 'b', label: 'B', name: 'Flux density in the core [T]', unit: '', color: '#199e70', group: 'Flux density' },
  h: { id: 'h', label: 'H', name: 'Field strength in the core [A/m]', unit: '', color: '#c98500', group: 'Field' },
  linc: { id: 'linc', label: 'L', name: 'Incremental inductance [H]', unit: '', color: '#d95926', group: 'Inductance' },
}

function CoreDiagram({ st, r, selected, onSelect, values, live }: { st: CoreState; r: CoreRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean }) {
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
  const sat = st.region !== 'lin'
  const fill = Math.min(1, Math.abs(st.b) / p.bsat)
  const coreColor = sat ? '#e66767' : `rgba(25,158,112,${0.15 + 0.5 * fill})`
  const gapPx = Math.max(3, Math.min(14, 3 + p.lg * 4000))
  const turns = Math.min(8, Math.max(3, Math.round(p.n / 5)))
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Gapped core: ${REGION[st.region]}`}>
      {/* source → R → winding */}
      <path d="M80 60 H230 M80 210 H330 V190" className={`wire ${Math.abs(st.i) > 1e-9 ? 'wire--igbt' : ''}`} />
      <path d="M80 60 V115 M80 155 V210" className="wire" />
      <path d="M290 60 H330 V80" className="wire" />
      <g {...part('bridge', `H-bridge ${formatV(st.v)}`)}>
        <rect x={50} y={110} width={60} height={50} className="cpart-hit" />
        <circle cx={80} cy={135} r={20} className="sym-body" />
        <path d="M70 140 V128 H80 V142 H90 V130" className="sym" />
        <text x={116} y={130} className="clabel">
          ±{formatV(p.vdc, false)}
        </text>
        <text x={116} y={146} className="cvalue">
          {formatSI(p.f, 'Hz')} · d {(p.duty * 100).toFixed(0)} %
        </text>
        {values && (
          <text x={116} y={162} className="cvalue cvalue--strong">
            now {formatV(st.v)}
          </text>
        )}
      </g>
      <g {...part('r', `Winding resistance ${p.r} Ω`)}>
        <rect x={226} y={46} width={68} height={28} className="cpart-hit" />
        <rect x={236} y={53} width={44} height={14} rx={2} className="sym-body" />
        <text x={258} y={44} className="cvalue" textAnchor="middle">
          R {formatSI(p.r, 'Ω')}
        </text>
      </g>
      {/* core with gap */}
      <g {...part('core', `Core, B = ${st.b.toFixed(3)} T`)}>
        <rect x={360} y={40} width={200} height={190} className="cpart-hit" />
        <path
          d={`M540 ${135 - gapPx / 2} V50 H380 V220 H540 V${135 + gapPx / 2}`}
          fill="none"
          stroke={coreColor}
          strokeWidth={22}
          strokeLinejoin="miter"
        />
        <text x={562} y={139} className="cvalue">
          gap {formatSI(p.lg, 'm')}
        </text>
        {live && (
          <text x={460} y={140} textAnchor="middle" className="clabel">
            B {st.b.toFixed(3)} T
          </text>
        )}
        {(live || sat) && (
          <text x={460} y={156} textAnchor="middle" className="cvalue">
            {sat ? 'SATURATED' : `${(fill * 100).toFixed(0)} % of Bsat`}
          </text>
        )}
      </g>
      {/* winding on the left leg */}
      <g {...part('winding', `Winding N = ${p.n}`)}>
        <rect x={320} y={70} width={80} height={130} className="cpart-hit" />
        {Array.from({ length: turns }, (_, k) => (
          <path key={k} d={`M330 ${86 + k * (100 / turns)} C 360 ${78 + k * (100 / turns)}, 400 ${78 + k * (100 / turns)}, 400 ${92 + k * (100 / turns)}`} className="sym sym--coil" />
        ))}
        <text x={312} y={140} className="clabel" textAnchor="end">
          N = {p.n}
        </text>
        {values && (
          <text x={312} y={156} className="cvalue cvalue--il" textAnchor="end">
            i {formatA(st.i, true)}
          </text>
        )}
      </g>
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {REGION[st.region]}
        {live && ` · L now ${formatSI(st.linc, 'H')}`}
      </text>
    </svg>
  )
}

const REGION: Record<CoreState['region'], string> = { lin: 'linear', 'sat+': 'saturated (+)', 'sat−': 'saturated (−)' }

/** The winding's B–i characteristic (piecewise linear), the last period's trajectory and the cursor. */
function BiPlot({ st, r }: { st: CoreState; r: CoreRun }) {
  const p = r.params
  const s = r.signals
  const k0 = r.params.view === 'steady' ? 0 : (p.periods - 1) * p.stepsPerPeriod
  let bMax = p.bsat * 1.3
  let iMax = 0
  for (let k = k0; k < r.length; k++) {
    bMax = Math.max(bMax, Math.abs(s.b[k]) * 1.05)
    iMax = Math.max(iMax, Math.abs(s.i[k]) * 1.05)
  }
  bMax = Math.max(bMax, Math.abs(st.b) * 1.05)
  iMax = Math.max(iMax, Math.abs(st.i) * 1.05, Math.abs(currentOf(p, p.lamS)) * 1.2)
  const W = 300
  const H = 220
  const X = (i: number) => 30 + ((i + iMax) / (2 * iMax)) * (W - 40)
  const Y = (b: number) => 10 + ((bMax - b) / (2 * bMax)) * (H - 40)
  const na = p.n * p.ae
  const curve = Array.from({ length: 81 }, (_, q) => {
    const b = -bMax + (2 * bMax * q) / 80
    return `${q ? 'L' : 'M'}${X(currentOf(p, b * na)).toFixed(1)} ${Y(b).toFixed(1)}`
  }).join(' ')
  const step = Math.max(1, Math.floor((r.length - k0) / 400))
  const traj: string[] = []
  for (let k = k0; k < r.length; k += step) traj.push(`${traj.length ? 'L' : 'M'}${X(s.i[k]).toFixed(1)} ${Y(s.b[k]).toFixed(1)}`)
  return (
    <section className="dc-energy" aria-label="B–i characteristic">
      <h3 className="eyebrow">B against winding current (SIMULATION)</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="bi-plot" role="img" aria-label="Flux density against current">
        <line x1={30} x2={W - 10} y1={Y(0)} y2={Y(0)} className="bi-axis" />
        <line x1={X(0)} x2={X(0)} y1={10} y2={H - 30} className="bi-axis" />
        <line x1={30} x2={W - 10} y1={Y(p.bsat)} y2={Y(p.bsat)} className="bi-sat" />
        <line x1={30} x2={W - 10} y1={Y(-p.bsat)} y2={Y(-p.bsat)} className="bi-sat" />
        <text x={W - 12} y={Y(p.bsat) - 4} textAnchor="end" className="bi-label">
          +Bsat
        </text>
        <path d={curve} className="bi-curve" />
        <path d={traj.join(' ')} className="bi-traj" />
        <circle cx={X(st.i)} cy={Y(st.b)} r={4.5} className="bi-dot" />
        <text x={W - 12} y={Y(0) - 4} textAnchor="end" className="bi-label">
          i → {formatA(iMax)}
        </text>
        <text x={X(0) + 4} y={20} className="bi-label">
          B ↑ {bMax.toFixed(2)} T
        </text>
      </svg>
      <p className="muted small">
        Grey: the piecewise-linear characteristic (slope ∝ 1/L). Coloured: the {p.view === 'steady' ? 'steady-state cycle' : 'last period'}; the dot is the cursor. Its steep part beyond ±Bsat is saturation — a flat line on
        this plot means a large current for no extra flux. Copper loss {formatW(measureCore(r).pcu)}; core loss is not modelled.
      </p>
    </section>
  )
}

export const CORE_TOPIC: Topic<CoreParams, CoreRun, CoreMeasurements, CoreState> = {
  id: 'inductor',
  label: 'Gapped inductor',
  title: 'Gapped-core winding on a square-wave bridge',
  defaults: CORE_DEFAULTS,
  basic: [
    { kind: 'number', key: 'f', label: 'Frequency f', unit: 'kHz', scale: 1e3, min: L.f.min, max: L.f.max, log: true },
    { kind: 'number', key: 'vdc', label: 'Bridge voltage ±V', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'duty', label: 'Duty (+V share)', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 0.5 },
    { kind: 'number', key: 'n', label: 'Turns N', unit: '', min: L.n.min, max: L.n.max, step: 1 },
    { kind: 'number', key: 'lg', label: 'Air gap lg', unit: 'mm', scale: 1e-3, min: L.lg.min, max: L.lg.max, step: 0.05 },
  ],
  advanced: [
    { kind: 'number', key: 'ae', label: 'Core area Ae', unit: 'mm²', scale: 1e-6, min: L.ae.min, max: L.ae.max, log: true },
    { kind: 'number', key: 'le', label: 'Magnetic path le', unit: 'mm', scale: 1e-3, min: L.le.min, max: L.le.max, log: true },
    { kind: 'number', key: 'mur', label: 'Permeability μr', unit: '', min: L.mur.min, max: L.mur.max, log: true },
    { kind: 'number', key: 'bsat', label: 'Saturation Bsat', unit: 'T', min: L.bsat.min, max: L.bsat.max, step: 0.01 },
    { kind: 'number', key: 'musat', label: 'Saturated μr', unit: '', min: L.musat.min, max: L.musat.max, log: true },
    { kind: 'number', key: 'r', label: 'Winding resistance R', unit: 'mΩ', scale: 1e-3, min: L.r.min, max: L.r.max, log: true },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    const tb = textbookCore(p)
    return `L = N²μ0Ae/(lg + le/μr) = ${formatSI(p.l1, 'H')} · saturated ${formatSI(p.l2, 'H')} · ΔB = V·d·T/(N·Ae) = ${tb.dB.toFixed(3)} T · τ = L/R = ${formatTime(p.tau1)}`
  },
  viewKey: 'view',
  simulate: (p) => simulateCore(p),
  measure: measureCore,
  state: coreStateAt,
  view: (st, r) => coreView(st, r),
  why: coreWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true }) => <CoreDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} />,
  channels: CH,
  defaultChannels: ['v', 'b', 'i'],
  addOrder: ['v', 'b', 'i', 'vl', 'h', 'linc'],
  shade: (r, k) => (r.modes[k] !== 'lin' ? 'rgba(230,103,103,0.16)' : null),
  shadeLegend: 'red band: core saturated',
  eventLabel: coreEventLabel,
  eventWhy: coreEventWhy,
  eventColor: (e) => (e.kind === 'mode' ? '#e66767' : '#aeb7c5'),
  initialCursor: (r) => (r.params.view === 'steady' ? r.params.duty * r.params.period * 0.98 : (measureCore(r).tSat ?? r.params.period * 0.48) + 0.02 * r.params.period),
  periodName: 'period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Core state">
      <div className="dc-mode-head">
        <span className={`mode-pill ${m.saturated ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>{m.saturated ? 'SATURATES' : 'LINEAR'}</span>
        <span className="small">
          Bpk {m.bpk.toFixed(3)} T · ΔB {m.dB.toFixed(3)} T · îpk {formatA(m.ipk)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        mean current {formatA(m.idc, true)}
        {m.saturated ? ` · saturated ${(m.satFrac * 100).toFixed(1)} % of the period` : ''}
        {r.params.view === 'startup' ? ` · start-up peak ${formatA(m.iPeakRun)}` : ''}
      </p>
    </section>
  ),
  summary: (_r, m) => `Bpk ${m.bpk.toFixed(3)} T · peak ${formatA(m.ipk)}${m.saturated ? ' · SATURATES' : ''} (SIMULATION)`,
  energy: (st, _m, r) => <BiPlot st={st} r={r} />,
  energyLabel: 'B–i',
  inspect: (part, st, m, r) => {
    const p = r.params
    const tb = textbookCore(p)
    if (part === 'core')
      return {
        title: 'Core and gap',
        role: 'The steel guides the flux; the gap stores most of the energy and sets the inductance. Above Bsat the steel stops helping.',
        rows: [
          ['B now', `${st.b.toFixed(4)} T`],
          ['Bsat', `${p.bsat} T`],
          ['Ae, le, lg', `${formatSI(p.ae, 'm²')}, ${formatSI(p.le, 'm')}, ${formatSI(p.lg, 'm')}`],
          ['μr (saturated)', `${p.mur} (${p.musat})`],
          ['Energy share in the gap', `${(tb.gapShare * 100).toFixed(1)} %`],
          ['Peak flux density', `${m.bpk.toFixed(3)} T`],
        ],
      }
    if (part === 'winding')
      return {
        title: 'Winding',
        role: 'N turns link the flux: the voltage sets dλ/dt = N·Ae·dB/dt.',
        rows: [
          ['N', String(p.n)],
          ['L (unsaturated / saturated)', `${formatSI(p.l1, 'H')} / ${formatSI(p.l2, 'H')}`],
          ['Current now', formatA(st.i, true)],
          ['RMS current', formatA(m.irms)],
        ],
      }
    if (part === 'r') return { title: 'Winding resistance', role: 'The only loss modelled — and the only thing that limits a DC current.', rows: [['R', formatSI(p.r, 'Ω')], ['Copper loss', formatW(m.pcu)], ['τ = L/R', formatTime(p.tau1)]] }
    return { title: 'H-bridge', role: 'Applies +V for d·T and −V for the rest of each period: a square wave of volt-seconds.', rows: [['±V', formatV(p.vdc, false)], ['f', formatSI(p.f, 'Hz')], ['d', `${(p.duty * 100).toFixed(1)} %`], ['Mean voltage', formatV((2 * p.duty - 1) * p.vdc)]] }
  },
  analyze: {
    compare: compareCore,
    theory: () => (
      <>
        <h3>From volt-seconds to current</h3>
        <ol className="derivation">
          <li>
            <b>Faraday</b> — <span className="mono">v = R·i + dλ/dt</span>, λ = N·B·Ae: the applied volt-seconds move the flux.
          </li>
          <li>
            <b>Ampère</b> — <span className="mono">N·i = Hcore·le + (B/μ0)·lg</span>: the current needed for that flux; with a linear core <span className="mono">L = N²·μ0·Ae/(lg + le/μr)</span>.
          </li>
          <li>
            <b>Saturation</b> — above Bsat the core's slope drops to μ0·μsat: the inductance falls to <span className="mono">N²·μ0·Ae/(lg + le/μsat)</span> and the current rises steeply.
          </li>
          <li>
            <b>Steady state</b> — the mean voltage on the inductance is zero, so <span className="mono">Idc = (2d − 1)·V/R</span> exactly, and <span className="mono">ΔB = V·d·T/(N·Ae)</span> while R·i is small.
          </li>
        </ol>
        <p className="small">The exact THEORY solves the same piecewise-linear equation region by region (matrix exponential); the textbook column is the linear inductor, which cannot follow the core into saturation.</p>
      </>
    ),
    convergence: ['bpk', 'ipk'],
  },
  lessons: CORE_LESSONS,
  experiments: CORE_EXPERIMENTS,
  predictions: corePredictions,
  measureLabels: {
    dB: { label: 'Flux swing ΔB', fmt: (v) => `${v.toFixed(3)} T` },
    bpk: { label: 'Peak B', fmt: (v) => `${v.toFixed(3)} T` },
    ipk: { label: 'Peak current', fmt: (v) => formatA(v) },
    idc: { label: 'Mean current', fmt: (v) => formatA(v, true) },
    lMeas: { label: 'Inductance Δλ/Δi', fmt: (v) => formatSI(v, 'H') },
    satFrac: { label: 'Time saturated', fmt: (v) => `${(v * 100).toFixed(1)} %` },
  },
}
