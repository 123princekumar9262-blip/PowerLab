import type React from 'react'
import {
  compareXf,
  XF_DEFAULTS,
  XF_EXPERIMENTS,
  XF_LESSONS,
  xfEnergy,
  xfEventLabel,
  xfEventWhy,
  xfNextConsequence,
  xfPath,
  xfPredictions,
  xfStateAt,
  xfStatus,
  xfView,
  xfWhy,
  type XfState,
} from '../converters/magnetics/transformerContent.ts'
import { magCurrentOf, measureXf, simulateXf, XF_LIMITS as L, type XfMeasurements, type XfParams, type XfRun } from '../converters/magnetics/transformer.ts'
import { textbookXf } from '../converters/magnetics/transformerTheory.ts'
import type { AnalysisCategory, ChannelMeta, Reading, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  v1: { id: 'v1', label: 'v1', name: 'Primary (source) voltage', unit: 'V', color: '#3987e5', group: 'Voltage' },
  v2: { id: 'v2', label: 'v2', name: 'Secondary (load) voltage', unit: 'V', color: '#d95926', group: 'Voltage' },
  v2i: { id: 'v2i', label: 'v1·N2/N1', name: 'Ideal transformer output v1·N2/N1', unit: 'V', color: '#d95926', dash: [6, 4], group: 'Voltage' },
  vm: { id: 'vm', label: 'vm', name: 'Voltage on the magnetising inductance (primary side)', unit: 'V', color: '#7c8aa5', dash: [3, 3], group: 'Voltage' },
  i1: { id: 'i1', label: 'i1', name: 'Primary current', unit: 'A', color: '#e66767', group: 'Current' },
  i2r: { id: 'i2r', label: 'i2·N2/N1', name: 'Secondary current seen from the primary (i2·N2/N1)', unit: 'A', color: '#9085e9', group: 'Current' },
  im: { id: 'im', label: 'im', name: 'Magnetising current i1 − i2·N2/N1', unit: 'A', color: '#c98500', group: 'Current' },
  i2: { id: 'i2', label: 'i2', name: 'Secondary current', unit: 'A', color: '#b45fc9', dash: [6, 4], group: 'Current' },
  b: { id: 'b', label: 'B', name: 'Flux density in the core [T]', unit: '', color: '#199e70', group: 'Flux density' },
  h: { id: 'h', label: 'H', name: 'Field strength in the core [A/m]', unit: '', color: '#8c6d1f', group: 'Field' },
  lm: { id: 'lm', label: 'Lm', name: 'Magnetising inductance now [H]', unit: '', color: '#a0522d', group: 'Inductance' },
}

const REGION: Record<XfState['region'], string> = { lin: 'core linear', 'sat+': 'core saturated (+)', 'sat−': 'core saturated (−)' }

/** A small coil drawn along a horizontal wire (four bumps). */
const coilH = (x: number, y: number, w: number) => {
  const r = w / 8
  return `M${x} ${y} ` + Array.from({ length: 4 }, () => `a${r} ${r} 0 0 1 ${2 * r} 0`).join(' ')
}

function XfDiagram({ st, r, selected, onSelect, values, live, showPath }: { st: XfState; r: XfRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath: boolean }) {
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
  const secOn = Math.abs(st.j) > 1e-6 * Math.max(1, Math.abs(st.i1))
  const wire = (on: boolean) => `wire ${showPath && on ? 'wire--flow' : on && !showPath ? 'wire--igbt' : ''}`
  const turns1 = Math.min(7, Math.max(3, Math.round(p.n1 / 5)))
  const turns2 = Math.min(7, Math.max(3, Math.round(p.n2 / 5)))
  const coilY = (k: number, n: number) => 92 + k * (88 / Math.max(1, n - 1))
  const gapPx = p.lg > 0 ? Math.max(3, Math.min(12, 3 + p.lg * 4000)) : 0
  const sine = p.source === 'sine'
  return (
    <svg className="buck-diagram" viewBox="0 0 720 270" role="group" aria-label={`Transformer ${p.n1}:${p.n2}, ${REGION[st.region]}`}>
      {/* primary loop */}
      <path d="M60 113 V60 H102 M142 60 H170 M214 60 H262 V84" className={wire(true)} />
      <path d="M60 157 V214 H262 V186" className={wire(true)} />
      {/* secondary loop */}
      <path d="M468 84 V60 H492 M536 60 H560 M600 60 H630 V100" className={wire(secOn)} />
      <path d="M630 170 V214 H468 V186" className={wire(secOn)} />
      <g {...part('source', `Source ${formatV(st.v1)}`)}>
        <rect x={34} y={108} width={140} height={60} className="cpart-hit" />
        <circle cx={60} cy={135} r={22} className="sym-body" />
        <path d={sine ? 'M46 135 C 51 121, 56 121, 60 135 S 69 149, 74 135' : 'M47 141 V128 H60 V142 H73 V130'} className="sym" />
        <text x={90} y={130} className="clabel">
          {sine ? `${formatV(p.v, false)} peak` : `±${formatV(p.v, false)}`}
        </text>
        <text x={90} y={146} className="cvalue">
          {formatSI(p.f, 'Hz')}
          {p.voff !== 0 ? ` · DC ${formatSI(p.voff, 'V', { signed: true })}` : ''}
        </text>
        {live && (
          <text x={90} y={162} className="cvalue cvalue--strong">
            v1 {formatV(st.v1)}
          </text>
        )}
        {values && (
          <text x={90} y={178} className="cvalue cvalue--il">
            i1 {formatA(st.i1, true)}
          </text>
        )}
      </g>
      <g {...part('r1', `Primary resistance ${formatSI(p.r1, 'Ω')}`)}>
        <rect x={98} y={34} width={48} height={56} className="cpart-hit" />
        <rect x={102} y={53} width={40} height={14} rx={2} className="sym-body" />
        <text x={122} y={44} className="clabel" textAnchor="middle">
          R1
        </text>
        <text x={122} y={84} className="cvalue" textAnchor="middle">
          {formatSI(p.r1, 'Ω')}
        </text>
      </g>
      <g {...part('ll1', `Primary leakage ${formatSI(p.ll1, 'H')}`)}>
        <rect x={164} y={34} width={56} height={56} className="cpart-hit" />
        <path d={coilH(170, 60, 44)} className="sym sym--coil" />
        <text x={192} y={44} className="clabel" textAnchor="middle">
          Ll1
        </text>
        <text x={192} y={84} className="cvalue" textAnchor="middle">
          {formatSI(p.ll1, 'H')}
        </text>
      </g>
      {/* the core */}
      <g {...part('core', `Core, B = ${st.b.toFixed(3)} T`)}>
        <rect x={278} y={36} width={174} height={198} className="cpart-hit" />
        <path d="M290 48 H440 V222 H290 Z" fill="none" stroke={coreColor} strokeWidth={18} strokeLinejoin="miter" />
        {gapPx > 0 && <rect x={365 - gapPx / 2} y={38} width={gapPx} height={20} className="gap-mask" />}
        <text x={365} y={118} textAnchor="middle" className="cvalue">
          N1:N2 = {p.n1}:{p.n2}
        </text>
        {live && (
          <text x={365} y={138} textAnchor="middle" className="clabel">
            B {st.b.toFixed(3)} T
          </text>
        )}
        {(live || sat) && (
          <text x={365} y={156} textAnchor="middle" className="cvalue">
            {sat ? 'SATURATED' : `${(fill * 100).toFixed(0)} % of Bsat`}
          </text>
        )}
        {values && (
          <text x={365} y={174} textAnchor="middle" className="cvalue">
            im {formatA(st.im, true)}
          </text>
        )}
      </g>
      <g {...part('primary', `Primary winding N1 = ${p.n1}`)}>
        <rect x={252} y={80} width={62} height={112} className="cpart-hit" />
        {Array.from({ length: turns1 }, (_, k) => (
          <path key={k} d={`M262 ${coilY(k, turns1)} C 278 ${coilY(k, turns1) - 9}, 306 ${coilY(k, turns1) - 9}, 306 ${coilY(k, turns1) + 5}`} className="sym sym--coil" />
        ))}
        <text x={256} y={104} className="clabel" textAnchor="end">
          N1
        </text>
      </g>
      <g {...part('secondary', `Secondary winding N2 = ${p.n2}`)}>
        <rect x={416} y={80} width={62} height={112} className="cpart-hit" />
        {Array.from({ length: turns2 }, (_, k) => (
          <path key={k} d={`M468 ${coilY(k, turns2)} C 452 ${coilY(k, turns2) - 9}, 424 ${coilY(k, turns2) - 9}, 424 ${coilY(k, turns2) + 5}`} className="sym sym--coil" />
        ))}
        <text x={474} y={104} className="clabel">
          N2
        </text>
      </g>
      <g {...part('ll2', `Secondary leakage ${formatSI(p.ll2, 'H')}`)}>
        <rect x={486} y={34} width={56} height={56} className="cpart-hit" />
        <path d={coilH(492, 60, 44)} className="sym sym--coil" />
        <text x={514} y={44} className="clabel" textAnchor="middle">
          Ll2
        </text>
        <text x={514} y={84} className="cvalue" textAnchor="middle">
          {formatSI(p.ll2, 'H')}
        </text>
      </g>
      <g {...part('r2', `Secondary resistance ${formatSI(p.r2, 'Ω')}`)}>
        <rect x={556} y={34} width={48} height={56} className="cpart-hit" />
        <rect x={560} y={53} width={40} height={14} rx={2} className="sym-body" />
        <text x={580} y={44} className="clabel" textAnchor="middle">
          R2
        </text>
        <text x={580} y={84} className="cvalue" textAnchor="middle">
          {formatSI(p.r2, 'Ω')}
        </text>
      </g>
      <g {...part('load', `Load ${formatSI(p.rload, 'Ω')}`)}>
        <rect x={548} y={96} width={166} height={78} className="cpart-hit" />
        <rect x={622} y={100} width={16} height={70} rx={2} className="sym-body" />
        <text x={614} y={124} className="clabel" textAnchor="end">
          {p.lload > 0 ? 'RL + LL' : 'Load RL'}
        </text>
        <text x={614} y={140} className="cvalue" textAnchor="end">
          {formatSI(p.rload, 'Ω')}
        </text>
        {p.lload > 0 && (
          <text x={614} y={156} className="cvalue" textAnchor="end">
            {formatSI(p.lload, 'H')}
          </text>
        )}
        {live && (
          <text x={646} y={124} className="cvalue cvalue--out">
            {formatV(st.v2)}
          </text>
        )}
        {(live || values) && (
          <text x={646} y={140} className="cvalue cvalue--il">
            {formatA(st.i2, true)}
          </text>
        )}
      </g>
      <text x={365} y={252} className="path-caption" textAnchor="middle">
        {REGION[st.region]}
        {r.params.source === 'square' && Math.abs(st.j) > 1e-9 && Math.sign(st.j) !== Math.sign(st.v1 - p.voff) ? ' · load current reversing' : ''}
        {live && ` · Lm now ${formatSI(st.lmNow, 'H')}`}
      </text>
    </svg>
  )
}

/** B against the magnetising current: the core's two-slope characteristic, the shown period and the cursor. */
function BimPlot({ st, r }: { st: XfState; r: XfRun }) {
  const p = r.params
  const s = r.signals
  const k0 = (p.periods - 1) * p.stepsPerPeriod
  let bMax = p.bsat * 1.3
  let iMax = 0
  for (let k = k0; k < r.length; k++) {
    bMax = Math.max(bMax, Math.abs(s.b[k]) * 1.05)
    iMax = Math.max(iMax, Math.abs(s.im[k]) * 1.05)
  }
  bMax = Math.max(bMax, Math.abs(st.b) * 1.05)
  iMax = Math.max(iMax, Math.abs(st.im) * 1.05, Math.abs(magCurrentOf(p, p.lamS)) * 1.2)
  const W = 300
  const H = 220
  const X = (i: number) => 30 + ((i + iMax) / (2 * iMax)) * (W - 40)
  const Y = (b: number) => 10 + ((bMax - b) / (2 * bMax)) * (H - 40)
  const na = p.n1 * p.ae
  const curve = Array.from({ length: 81 }, (_, q) => {
    const b = -bMax + (2 * bMax * q) / 80
    return `${q ? 'L' : 'M'}${X(magCurrentOf(p, b * na)).toFixed(1)} ${Y(b).toFixed(1)}`
  }).join(' ')
  const step = Math.max(1, Math.floor((r.length - k0) / 400))
  const traj: string[] = []
  for (let k = k0; k < r.length; k += step) traj.push(`${traj.length ? 'L' : 'M'}${X(s.im[k]).toFixed(1)} ${Y(s.b[k]).toFixed(1)}`)
  return (
    <section aria-label="B against the magnetising current">
      <svg viewBox={`0 0 ${W} ${H}`} className="bi-plot" role="img" aria-label="Flux density against magnetising current">
        <line x1={30} x2={W - 10} y1={Y(0)} y2={Y(0)} className="bi-axis" />
        <line x1={X(0)} x2={X(0)} y1={10} y2={H - 30} className="bi-axis" />
        <line x1={30} x2={W - 10} y1={Y(p.bsat)} y2={Y(p.bsat)} className="bi-sat" />
        <line x1={30} x2={W - 10} y1={Y(-p.bsat)} y2={Y(-p.bsat)} className="bi-sat" />
        <text x={W - 12} y={Y(p.bsat) - 4} textAnchor="end" className="bi-label">
          +Bsat
        </text>
        <path d={curve} className="bi-curve" />
        <path d={traj.join(' ')} className="bi-traj" />
        <circle cx={X(st.im)} cy={Y(st.b)} r={4.5} className="bi-dot" />
        <text x={W - 12} y={Y(0) - 4} textAnchor="end" className="bi-label">
          im → {formatA(iMax)}
        </text>
        <text x={X(0) + 4} y={20} className="bi-label">
          B ↑ {bMax.toFixed(2)} T
        </text>
      </svg>
      <p className="muted small">
        Grey: the core's two-slope characteristic (the same as the gapped inductor's). Green: the {p.view === 'steady' ? 'steady-state period' : 'last period shown'} (SIMULATION); the dot is the cursor. The load current does not appear here — it is cancelled in the core by the
        secondary's ampere-turns — only the magnetising current sets B.
      </p>
    </section>
  )
}

const XF_ANALYSIS: Array<AnalysisCategory<XfRun, XfMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['v2rms', 'i1rms', 'imPk', 'bpk', 'eff'] },
  { id: 'turns', label: 'Turns ratio', rows: ['v1rms', 'v2rms', 'ratio', 'regulation'], note: (_m, r) => `Ideal: V2/V1 = N2/N1 = ${(r.params.n2 / r.params.n1).toFixed(4)}` },
  { id: 'currents', label: 'Currents', rows: ['i1rms', 'i2rms', 'imPk', 'imMax', 'i1dc'], note: () => 'i1 = i2·N2/N1 + im at every instant (Ampère: N1·i1 − N2·i2 = N1·im).' },
  { id: 'flux', label: 'Flux', rows: ['dB', 'bpk', 'bdc', 'satFrac'] },
  { id: 'leakage', label: 'Leakage', rows: ['tRev', 'regulation'] },
  { id: 'power', label: 'Power', rows: ['p1', 'p2', 'pcu1', 'pcu2', 'eff', 'balance', 'pf'] },
  { id: 'peaks', label: 'Run peaks', rows: ['iPeakRun', 'bPeakRun', 'tSat'], note: (_m, r) => (r.params.view === 'startup' ? 'From switch-on at zero flux (start-up view).' : 'Steady state: the peaks of the periods shown.') },
  { id: 'core', label: 'B–im', tab: 'bim' },
]

const PARTS = [
  { id: 'source', label: 'Source' },
  { id: 'r1', label: 'Primary resistance R1' },
  { id: 'll1', label: 'Primary leakage Ll1' },
  { id: 'primary', label: 'Primary winding N1' },
  { id: 'core', label: 'Core' },
  { id: 'secondary', label: 'Secondary winding N2' },
  { id: 'll2', label: 'Secondary leakage Ll2' },
  { id: 'r2', label: 'Secondary resistance R2' },
  { id: 'load', label: 'Load' },
]

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)} %`

export const TRANSFORMER_TOPIC: Topic<XfParams, XfRun, XfMeasurements, XfState> = {
  id: 'transformer',
  label: 'Transformer',
  title: 'Two-winding transformer on a square-wave or sine source',
  defaults: XF_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'source',
      label: 'Source',
      options: [
        { value: 'square', label: 'Square (bridge)', title: 'An H-bridge: +V for half the period, −V for the other half' },
        { value: 'sine', label: 'Sine', title: 'A sinusoidal voltage of the given peak' },
      ],
    },
    { kind: 'number', key: 'v', label: 'Voltage (±V or peak)', unit: 'V', min: L.v.min, max: L.v.max, log: true },
    { kind: 'number', key: 'f', label: 'Frequency f', unit: 'kHz', scale: 1e3, min: L.f.min, max: L.f.max, log: true },
    { kind: 'number', key: 'n1', label: 'Primary turns N1', unit: '', min: L.n1.min, max: L.n1.max, step: 1 },
    { kind: 'number', key: 'n2', label: 'Secondary turns N2', unit: '', min: L.n2.min, max: L.n2.max, step: 1 },
    { kind: 'number', key: 'rload', label: 'Load resistance RL', unit: 'Ω', min: L.rload.min, max: L.rload.max, log: true },
    { kind: 'number', key: 'voff', label: 'DC offset Voff', unit: 'mV', scale: 1e-3, min: L.voff.min, max: L.voff.max, step: 1 },
  ],
  advanced: [
    { kind: 'number', key: 'll1', label: 'Primary leakage Ll1', unit: 'µH', scale: 1e-6, min: L.ll1.min, max: L.ll1.max, step: 0.1 },
    { kind: 'number', key: 'll2', label: 'Secondary leakage Ll2', unit: 'µH', scale: 1e-6, min: L.ll2.min, max: L.ll2.max, step: 0.01 },
    { kind: 'number', key: 'r1', label: 'Primary resistance R1', unit: 'mΩ', scale: 1e-3, min: L.r1.min, max: L.r1.max, log: true },
    { kind: 'number', key: 'r2', label: 'Secondary resistance R2', unit: 'mΩ', scale: 1e-3, min: L.r2.min, max: L.r2.max, log: true },
    { kind: 'number', key: 'lload', label: 'Load inductance LL', unit: 'µH', scale: 1e-6, min: L.lload.min, max: L.lload.max, step: 1 },
    { kind: 'number', key: 'ae', label: 'Core area Ae', unit: 'mm²', scale: 1e-6, min: L.ae.min, max: L.ae.max, log: true },
    { kind: 'number', key: 'le', label: 'Magnetic path le', unit: 'mm', scale: 1e-3, min: L.le.min, max: L.le.max, log: true },
    { kind: 'number', key: 'lg', label: 'Air gap lg', unit: 'mm', scale: 1e-3, min: L.lg.min, max: L.lg.max, step: 0.05 },
    { kind: 'number', key: 'mur', label: 'Permeability μr', unit: '', min: L.mur.min, max: L.mur.max, log: true },
    { kind: 'number', key: 'bsat', label: 'Saturation Bsat', unit: 'T', min: L.bsat.min, max: L.bsat.max, step: 0.01 },
    { kind: 'number', key: 'musat', label: 'Saturated μr', unit: '', min: L.musat.min, max: L.musat.max, log: true },
    { kind: 'number', key: 'phase', label: 'Switch-on angle φ', unit: '°', min: L.phase.min, max: L.phase.max, step: 1, when: (p) => p.source === 'sine' && p.view === 'startup' },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    const tb = textbookXf(p)
    return `a = N1/N2 = ${p.a.toFixed(3)} · Lm = N1²μ0Ae/(lg + le/μr) = ${formatSI(p.lm, 'H')} (saturated ${formatSI(p.lsat, 'H')}) · ΔB ≈ ${tb.dB.toFixed(3)} T · leakage τ = ${formatTime(p.tauLk)}`
  },
  viewKey: 'view',
  simulate: (p) => simulateXf(p),
  measure: measureXf,
  state: xfStateAt,
  view: (st, r) => xfView(st, r),
  why: xfWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <XfDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['v1', 'v2', 'i1', 'im'],
  primaryChannels: ['v1', 'v2'],
  addOrder: ['v1', 'v2', 'v2i', 'vm', 'i1', 'i2r', 'im', 'i2', 'b', 'h', 'lm'],
  shade: (r, k) => (r.modes[k] && !r.modes[k].startsWith('lin') ? 'rgba(230,103,103,0.16)' : null),
  shadeLegend: 'red band: core saturated',
  eventLabel: xfEventLabel,
  eventWhy: xfEventWhy,
  eventColor: (e) => ((e.device ?? '').startsWith('core:') ? '#e66767' : (e.device ?? '').startsWith('i2:') ? '#9085e9' : '#aeb7c5'),
  initialCursor: (r) => (r.params.view === 'steady' ? 0.45 * r.params.period : (measureXf(r).tSat ?? 0.45 * r.params.period) + 0.02 * r.params.period),
  periodName: 'period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Transformer state">
      <div className="dc-mode-head">
        <span className={`mode-pill ${m.saturated ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>{m.saturated ? 'SATURATES' : 'LINEAR CORE'}</span>
        <span className="small">
          V2 {formatV(m.v2rms, false)} · Bpk {m.bpk.toFixed(3)} T · îm {formatA(m.imMax)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        efficiency {pct(m.eff)} · regulation {pct(m.regulation)}
        {Math.abs(r.params.voff) > 0 ? ` · mean primary current ${formatA(m.i1dc, true)}` : ''}
        {m.saturated ? ` · saturated ${(m.satFrac * 100).toFixed(1)} % of the period` : ''}
        {r.params.view === 'startup' ? ` · switch-on peak ${formatA(m.iPeakRun)}` : ''}
      </p>
    </section>
  ),
  summary: (_r, m) => `V2 ${formatV(m.v2rms, false)} RMS · Bpk ${m.bpk.toFixed(3)} T${m.saturated ? ' · SATURATES' : ''} (SIMULATION)`,
  readings: (m, r) => {
    const p = r.params
    const out: Reading[] = [
      { id: 'v2', label: 'Secondary voltage, RMS', value: m.v2rms.toFixed(2), unit: 'V', note: `ideal V1·N2/N1 = ${((m.v1rms * p.n2) / p.n1).toFixed(2)} V` },
      { id: 'bpk', label: 'Peak flux density', value: m.bpk.toFixed(3), unit: 'T', note: m.saturated ? `SATURATES (Bsat ${p.bsat} T)` : `Bsat ${p.bsat} T` },
      { id: 'im', label: 'Magnetising current, peak', value: formatA(m.imMax).replace(/ [mµ]?A$/, ''), unit: formatA(m.imMax).replace(/^[^ ]+ /, ''), note: p.source === 'square' ? 'triangle, ≈ V·T/(4·Lm)' : 'sine, ≈ V̂/(ω·Lm)' },
      { id: 'eff', label: 'Efficiency', value: (m.eff * 100).toFixed(2), unit: '%', note: `P2/P1 = ${formatW(m.p2)}/${formatW(m.p1)}` },
    ]
    if (p.view === 'startup') out[2] = { id: 'inrush', label: 'Peak current after switch-on', value: formatA(m.iPeakRun).replace(/ [mµ]?A$/, ''), unit: formatA(m.iPeakRun).replace(/^[^ ]+ /, ''), note: m.tSat !== null ? `saturates at ${formatTime(m.tSat)}` : 'no saturation' }
    return out
  },
  status: (st, r) => xfStatus(st, r),
  next: (r, st) => xfNextConsequence(r, st)?.text ?? null,
  nextConsequence: (r, st) => xfNextConsequence(r, st),
  path: (st, r) => xfPath(st, r),
  energyModel: (st, m, r) => xfEnergy(st, m, r),
  analysis: XF_ANALYSIS,
  parts: PARTS,
  inspect: (part, st, m, r) => {
    const p = r.params
    const tb = textbookXf(p)
    switch (part) {
      case 'core':
        return {
          title: 'Core',
          role: 'Carries the flux that links both windings. Its volt-seconds set B; above Bsat it stops helping and the magnetising current shoots up.',
          rows: [
            ['B now', `${st.b.toFixed(4)} T`],
            ['Bsat', `${p.bsat} T`],
            ['Peak B (SIMULATION)', `${m.bpk.toFixed(3)} T`],
            ['ΔB (SIMULATION)', `${m.dB.toFixed(3)} T`],
            ['Lm (unsaturated / saturated)', `${formatSI(p.lm, 'H')} / ${formatSI(p.lsat, 'H')}`],
            ['Ae, le, lg', `${formatSI(p.ae, 'm²')}, ${formatSI(p.le, 'm')}, ${formatSI(p.lg, 'm')}`],
          ],
        }
      case 'primary':
        return {
          title: 'Primary winding',
          role: 'N1 turns: the source voltage sets dλ/dt = N1·Ae·dB/dt. Its current is the load current (scaled by N2/N1) plus the magnetising current.',
          rows: [
            ['N1', String(p.n1)],
            ['Current now', formatA(st.i1, true)],
            ['RMS current', formatA(m.i1rms)],
            ['Mean current', formatA(m.i1dc, true)],
          ],
        }
      case 'secondary':
        return {
          title: 'Secondary winding',
          role: 'N2 turns on the same flux: the voltage per turn is the same as on the primary, so v2 ≈ v1·N2/N1.',
          rows: [
            ['N2', String(p.n2)],
            ['Voltage now', formatV(st.v2)],
            ['Current now', formatA(st.i2, true)],
            ['RMS voltage / current', `${formatV(m.v2rms, false)} / ${formatA(m.i2rms)}`],
          ],
        }
      case 'r1':
        return { title: 'Primary resistance', role: 'Copper loss — and the only thing that limits a DC current from a source offset.', rows: [['R1', formatSI(p.r1, 'Ω')], ['Loss', formatW(m.pcu1)], ['Voff/R1', formatA(tb.i1dc, true)]] }
      case 'r2':
        return { title: 'Secondary resistance', role: 'Copper loss of the secondary.', rows: [['R2', formatSI(p.r2, 'Ω')], ["R2' = R2·(N1/N2)²", formatSI(p.r2r, 'Ω')], ['Loss', formatW(m.pcu2)]] }
      case 'll1':
      case 'll2':
        return {
          title: part === 'll1' ? 'Primary leakage' : 'Secondary leakage',
          role: 'Flux that links only this winding: an inductance in series with the load. It slows every reversal of the load current and causes a voltage drop.',
          rows: [
            [part === 'll1' ? 'Ll1' : 'Ll2', formatSI(part === 'll1' ? p.ll1 : p.ll2, 'H')],
            ...(part === 'll2' ? ([["Ll2' = Ll2·(N1/N2)²", formatSI(p.ll2r, 'H')]] as Array<[string, string]>) : []),
            ['Leakage time constant τ', formatTime(p.tauLk)],
            ['Reversal after an edge (SIMULATION)', m.tRev !== null ? formatTime(m.tRev) : '— (sine drive)'],
          ],
        }
      case 'load':
        return {
          title: 'Load',
          role: 'Where the useful power goes.',
          rows: [
            ['RL', formatSI(p.rload, 'Ω')],
            ...(p.lload > 0 ? ([['LL', formatSI(p.lload, 'H')]] as Array<[string, string]>) : []),
            ["Seen from the primary RL' = RL·(N1/N2)²", formatSI(p.rlr, 'Ω')],
            ['Power (SIMULATION)', formatW(m.p2)],
          ],
        }
      default:
        return {
          title: 'Source',
          role: p.source === 'square' ? 'An H-bridge: +V for half of each period, −V for the other half (plus the DC offset).' : 'A sine voltage (plus the DC offset).',
          rows: [
            [p.source === 'square' ? '±V' : 'Peak', formatV(p.v, false)],
            ['f', formatSI(p.f, 'Hz')],
            ['DC offset', formatV(p.voff)],
            ['Power delivered (SIMULATION)', formatW(m.p1)],
          ],
        }
    }
  },
  analyze: {
    compare: compareXf,
    theory: () => (
      <>
        <h3>From volt-seconds to the load</h3>
        <ol className="derivation">
          <li>
            <b>Faraday</b> — the same flux Φ links both windings: <span className="mono">v1 ≈ N1·dΦ/dt, v2 ≈ N2·dΦ/dt ⇒ V2 = V1·N2/N1</span>.
          </li>
          <li>
            <b>Ampère</b> — <span className="mono">N1·i1 − N2·i2 = N1·im</span>: the load's ampere-turns cancel in the core; only im magnetises it, <span className="mono">im = λm/Lm</span>, <span className="mono">Lm = N1²·μ0·Ae/(lg + le/μr)</span>.
          </li>
          <li>
            <b>Volt-seconds</b> — square drive: <span className="mono">ΔB = V·(T/2)/(N1·Ae)</span>, <span className="mono">îm = V·T/(4·Lm)</span>; sine: <span className="mono">B̂ = V̂/(ω·N1·Ae)</span>.
          </li>
          <li>
            <b>Zero mean voltage</b> — in steady state no winding holds a mean voltage, so a DC offset gives <span className="mono">I1dc = Voff/R1</span> and <span className="mono">Bdc = Lm·I1dc/(N1·Ae)</span>.
          </li>
          <li>
            <b>Leakage</b> — Ll1 and Ll2' = Ll2·(N1/N2)² are in series with the referred load: the load current reverses with <span className="mono">τ = (Ll1 + Ll2' + LL')/(R1 + R2' + RL')</span>, and V2 drops.
          </li>
          <li>
            <b>Saturation</b> — above Bsat the magnetising inductance falls to <span className="mono">N1²·μ0·Ae/(lg + le/μsat)</span> (the gapped inductor's two-slope core).
          </li>
          <li>
            <b>Energy</b> — <span className="mono">P1 = P2 + R1·I1² + R2·I2²</span> over a period of the steady state (no core loss modelled).
          </li>
        </ol>
        <p className="small">The exact THEORY solves the same piecewise-linear T-equivalent circuit region by region (matrix exponential); the textbook column is the ideal / linear transformer, which cannot follow the core into saturation.</p>
      </>
    ),
    tabs: [{ id: 'bim', label: 'B–im', render: ({ r }) => <BimPlot st={xfStateAt(r, Math.round(0.45 * r.params.stepsPerPeriod) + (r.params.periods - 1) * r.params.stepsPerPeriod)} r={r} /> }],
    convergence: ['v2rms', 'imPk', 'bpk'],
  },
  lessons: XF_LESSONS,
  experiments: XF_EXPERIMENTS,
  predictions: xfPredictions,
  measureLabels: {
    v1rms: { label: 'Primary voltage, RMS', fmt: (v) => formatV(v, false) },
    v2rms: { label: 'Secondary voltage, RMS', fmt: (v) => formatV(v, false) },
    ratio: { label: 'V2/V1', fmt: (v) => v.toFixed(4) },
    regulation: { label: 'Regulation (drop from V1·N2/N1)', fmt: (v) => pct(v) },
    i1rms: { label: 'Primary current, RMS', fmt: (v) => formatA(v) },
    i2rms: { label: 'Secondary current, RMS', fmt: (v) => formatA(v) },
    i1dc: { label: 'Mean primary current', fmt: (v) => formatA(v, true) },
    imPk: { label: 'Magnetising current, peak (half p-p)', fmt: (v) => formatA(v) },
    imMax: { label: 'Magnetising current, largest |im|', fmt: (v) => formatA(v) },
    dB: { label: 'Flux swing ΔB', fmt: (v) => `${v.toFixed(3)} T` },
    bpk: { label: 'Peak B', fmt: (v) => `${v.toFixed(3)} T` },
    bdc: { label: 'Mean B', fmt: (v) => `${v.toFixed(3)} T` },
    satFrac: { label: 'Time saturated', fmt: (v) => pct(v, 1) },
    p1: { label: 'Input power P1', fmt: (v) => formatW(v) },
    p2: { label: 'Load power P2', fmt: (v) => formatW(v) },
    pcu1: { label: 'Primary copper loss', fmt: (v) => formatW(v) },
    pcu2: { label: 'Secondary copper loss', fmt: (v) => formatW(v) },
    eff: { label: 'Efficiency', fmt: (v) => pct(v) },
    balance: { label: 'Energy balance (P1 − P2 − losses)/P1', fmt: (v) => pct(v, 3) },
    pf: { label: 'Primary power factor', fmt: (v) => v.toFixed(4) },
    tRev: { label: 'Load-current reversal after an edge', fmt: (v) => (Number.isFinite(v) ? formatTime(v) : '—') },
    iPeakRun: { label: 'Peak primary current in the run', fmt: (v) => formatA(v) },
    bPeakRun: { label: 'Peak B in the run', fmt: (v) => `${v.toFixed(3)} T` },
    tSat: { label: 'First saturation', fmt: (v) => (Number.isFinite(v) ? formatTime(v) : '—') },
  },
}
