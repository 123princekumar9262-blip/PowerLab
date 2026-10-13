import { useEffect, useState } from 'react'
import { DcdcStageDiagram } from '../components/ev/DcdcStageDiagram.tsx'
import { measureStage, simulateStage, STAGE_DEFAULTS, STAGE_LIMITS as L, type StageMeasurements, type StageParams, type StageRun } from '../converters/ev/dcdcStage.ts'
import {
  compareStage,
  STAGE_EXPERIMENTS,
  STAGE_LESSONS,
  STAGE_MEASURE_LABELS,
  stageEnergy,
  stageEventLabel,
  stageEventWhy,
  stagePath,
  stagePredictions,
  stageReadings,
  stageStateAt,
  stageStatus,
  stageView,
  stageWhy,
  type StageState,
} from '../converters/ev/dcdcStageContent.ts'
import type { AnalysisCategory, ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import '../components/ev/evsub.css'

const CH: Record<string, ChannelMeta> = {
  g2: { id: 'g2', label: 'S2', name: 'S2 (low side, the boost switch) ON', unit: '', color: '#3987e5', group: 'Gates', logic: true },
  g1: { id: 'g1', label: 'S1', name: 'S1 (high side, the synchronous switch) ON', unit: '', color: '#1aa3b8', group: 'Gates', logic: true },
  il: { id: 'il', label: 'iL', name: 'Inductor current = battery current', unit: 'A', color: '#e66767', group: 'Currents' },
  iinv: { id: 'iinv', label: 'Iinv', name: 'Current into the inverter', unit: 'A', color: '#199e70', dash: [2, 3], group: 'Currents' },
  ic: { id: 'ic', label: 'iC', name: 'Link capacitor current', unit: 'A', color: '#9085e9', group: 'Currents' },
  is2: { id: 'is2', label: 'iS2', name: 'S2 channel current', unit: 'A', color: '#3987e5', dash: [6, 4], group: 'Device currents' },
  is1: { id: 'is1', label: 'iS1', name: 'S1 channel current (switch node → link)', unit: 'A', color: '#1aa3b8', dash: [6, 4], group: 'Device currents' },
  id1: { id: 'id1', label: 'iD1', name: 'D1 body-diode current', unit: 'A', color: '#008300', group: 'Device currents' },
  id2: { id: 'id2', label: 'iD2', name: 'D2 body-diode current', unit: 'A', color: '#59a14f', dash: [2, 3], group: 'Device currents' },
  vlink: { id: 'vlink', label: 'Vlink', name: 'DC-link voltage', unit: 'V', color: '#d95926', group: 'Link voltage' },
  vc: { id: 'vc', label: 'vC', name: 'Link capacitor voltage (= Vlink without ESR)', unit: 'V', color: '#9085e9', dash: [6, 4], group: 'Link voltage' },
  vsw: { id: 'vsw', label: 'vsw', name: 'Switch-node voltage', unit: 'V', color: '#3987e5', group: 'Switch node' },
  vbt: { id: 'vbt', label: 'Vbat', name: 'Battery terminal voltage', unit: 'V', color: '#c98500', group: 'Battery' },
  pbat: { id: 'pbat', label: 'Pbat', name: 'Battery terminal power (+ out of the battery)', unit: 'W', color: '#c98500', group: 'Power' },
  plink: { id: 'plink', label: 'Pinv', name: 'Inverter power (+ into the inverter)', unit: 'W', color: '#199e70', dash: [6, 4], group: 'Power' },
  el: { id: 'el', label: 'EL', name: 'Energy in L, ½·L·iL²', unit: 'J', color: '#e66767', group: 'Stored energy' },
  ec: { id: 'ec', label: 'EC', name: 'Energy in C, ½·C·v²', unit: 'J', color: '#9085e9', dash: [6, 4], group: 'Stored energy' },
}

const SWEEP_KW = [-100, -60, -30, -15, -5, -2, 2, 5, 15, 30, 60, 100, 150]

/** Efficiency vs load: one simulation per point (the controller finds its duty each time), drawn as they finish. */
function EfficiencySweep({ p }: { p: StageParams }) {
  const [run, setRun] = useState(false)
  const [pts, setPts] = useState<Array<{ kw: number; eta: number; cond: number; sw: number }>>([])
  const key = JSON.stringify({ ...p, power: 0 })
  useEffect(() => {
    if (!run) return
    const out: Array<{ kw: number; eta: number; cond: number; sw: number }> = []
    let i = 0
    let timer = 0
    setPts([])
    const step = () => {
      const kw = SWEEP_KW[i]
      const m = measureStage(simulateStage({ ...p, power: kw * 1000, periods: 1 }))
      out.push({ kw, eta: m.efficiency, cond: m.pCond, sw: m.pSw })
      setPts([...out])
      if (++i < SWEEP_KW.length) timer = window.setTimeout(step, 0)
    }
    timer = window.setTimeout(step, 0)
    return () => window.clearTimeout(timer)
  }, [run, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const W = 860
  const H = 280
  const Lm = 56
  const B = 36
  const lo = Math.min(97, ...pts.map((q) => Math.floor(q.eta * 200) / 2))
  const x = (kw: number) => Lm + ((kw + 100) / 250) * (W - Lm - 12)
  const y = (eta: number) => H - B - ((eta * 100 - lo) / (100 - lo)) * (H - B - 12)
  const ticks = [lo, lo + (100 - lo) / 2, 100]
  const pos = pts.filter((q) => q.kw > 0)
  const neg = pts.filter((q) => q.kw < 0)
  const line = (qs: typeof pts) => qs.map((q, k) => `${k ? 'L' : 'M'}${x(q.kw).toFixed(1)} ${y(q.eta).toFixed(1)}`).join(' ')
  return (
    <div className="dc-sweep">
      <p className="small">
        Simulates the stage at {SWEEP_KW.length} loads from −100 kW (regenerating) to +150 kW (motoring), with the present battery, link, L, C, fs and devices. Each point is a full simulation: the controller
        finds its own duty, and the efficiency includes the switching losses.
      </p>
      {!run ? (
        <button className="run-btn" onClick={() => setRun(true)}>
          Run the load sweep ({SWEEP_KW.length} simulations)
        </button>
      ) : (
        <>
          {pts.length < SWEEP_KW.length && (
            <p className="small muted" role="status">
              Simulating {SWEEP_KW[pts.length]} kW … ({pts.length} / {SWEEP_KW.length})
            </p>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} className="evd-chart" role="img" aria-label="Efficiency versus load, simulated">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={Lm} x2={W - 12} y1={y(v / 100)} y2={y(v / 100)} className="evd-grid" />
                <text x={Lm - 6} y={y(v / 100) + 4} textAnchor="end" className="evd-tick">
                  {v.toFixed(1)} %
                </text>
              </g>
            ))}
            {[-100, -50, 0, 50, 100, 150].map((kw) => (
              <text key={kw} x={x(kw)} y={H - B + 16} textAnchor="middle" className="evd-tick">
                {kw}
              </text>
            ))}
            <text x={(W + Lm) / 2} y={H - 4} textAnchor="middle" className="evd-tick">
              inverter power [kW] — negative: regenerating
            </text>
            <line x1={x(p.power / 1000)} x2={x(p.power / 1000)} y1={12} y2={H - B} className="evd-now" />
            <path d={line(neg)} className="evd-line" />
            <path d={line(pos)} className="evd-line" />
            {pts.map((q) => (
              <circle key={q.kw} cx={x(q.kw)} cy={y(q.eta)} r={3.5} className="evd-dot">
                <title>{`${q.kw} kW: η ${(q.eta * 100).toFixed(2)} %, conduction ${formatW(q.cond)}, switching ${formatW(q.sw)}`}</title>
              </circle>
            ))}
          </svg>
          <p className="evd-legend small">
            <span>dots: SIMULATION</span>
            <span>dashed line: the present load</span>
            {pts.length === SWEEP_KW.length && <span>best: {(Math.max(...pts.map((q) => q.eta)) * 100).toFixed(2)} % at {pts.reduce((a, q) => (q.eta > a.eta ? q : a)).kw} kW</span>}
          </p>
        </>
      )}
    </div>
  )
}

const ANALYSIS: Array<AnalysisCategory<StageRun, StageMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['vlinkAvg', 'duty', 'dutyIdeal', 'ilAvg', 'efficiency', 'direction'] },
  { id: 'ripple', label: 'Ripple', rows: ['ilPP', 'ilMax', 'ilMin', 'vcPP', 'vlinkPP'] },
  { id: 'power', label: 'Power', rows: ['pBat', 'pLink', 'pLoss', 'vbtAvg', 'ilRms'] },
  { id: 'losses', label: 'Losses', rows: ['pS1', 'pS2', 'pD', 'pDcr', 'pEsr', 'pCond', 'pSw', 'hardEdges'], note: (_m, r) => `Switching energies ${formatSI(r.params.eon, 'J')} (on) and ${formatSI(r.params.eoff, 'J')} (off) at 600 V / 300 A, scaled by V and I at each hard edge.` },
  { id: 'sweep', label: 'Efficiency vs load', tab: 'sweep' },
]

export const EV_DCDC_STAGE_TOPIC: Topic<StageParams, StageRun, StageMeasurements, StageState> = {
  id: 'evdcdc',
  label: 'DC-DC stage',
  title: 'Bidirectional boost: battery → DC link',
  defaults: STAGE_DEFAULTS,
  basic: [
    { kind: 'number', key: 'power', label: 'Inverter power (− = braking)', unit: 'kW', scale: 1e3, min: L.power.min, max: L.power.max, step: 5 },
    { kind: 'number', key: 'vbat', label: 'Battery voltage', unit: 'V', min: L.vbat.min, max: L.vbat.max, step: 5 },
    { kind: 'number', key: 'vlink', label: 'DC-link target', unit: 'V', min: L.vlink.min, max: L.vlink.max, step: 10 },
    { kind: 'number', key: 'fs', label: 'Switching frequency', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
  ],
  advanced: [
    { kind: 'number', key: 'l', label: 'Inductance L', unit: 'µH', scale: 1e-6, min: L.l.min, max: L.l.max, log: true },
    { kind: 'number', key: 'rl', label: 'Inductor DCR', unit: 'mΩ', scale: 1e-3, min: L.rl.min, max: L.rl.max, step: 0.5 },
    { kind: 'number', key: 'c', label: 'Link capacitance C', unit: 'µF', scale: 1e-6, min: L.c.min, max: L.c.max, log: true },
    { kind: 'number', key: 'esr', label: 'Capacitor ESR', unit: 'mΩ', scale: 1e-3, min: L.esr.min, max: L.esr.max, step: 0.5 },
    { kind: 'number', key: 'rbat', label: 'Battery resistance Rb', unit: 'mΩ', scale: 1e-3, min: L.rbat.min, max: L.rbat.max, step: 5 },
    { kind: 'number', key: 'ron', label: 'MOSFET Ron', unit: 'mΩ', scale: 1e-3, min: L.ron.min, max: L.ron.max, log: true },
    { kind: 'number', key: 'vf', label: 'Body-diode Vf', unit: 'V', min: L.vf.min, max: L.vf.max, step: 0.1 },
    { kind: 'number', key: 'td', label: 'Dead time', unit: 'ns', scale: 1e-9, min: L.td.min, max: L.td.max, log: true },
    { kind: 'number', key: 'eon', label: 'Eon at 600 V, 300 A', unit: 'mJ', scale: 1e-3, min: L.eon.min, max: L.eon.max, step: 0.1 },
    { kind: 'number', key: 'eoff', label: 'Eoff at 600 V, 300 A', unit: 'mJ', scale: 1e-3, min: L.eoff.min, max: L.eoff.max, step: 0.1 },
    { kind: 'number', key: 'periods', label: 'Periods shown', unit: '', min: L.periods.min, max: L.periods.max, step: 1 },
    { kind: 'number', key: 'stepsPerPeriod', label: 'Time steps per period', unit: '', min: L.stepsPerPeriod.min, max: L.stepsPerPeriod.max, log: true, step: 10, hint: (p) => `Δt = ${formatSI(1 / p.fs / p.stepsPerPeriod, 's')}` },
  ],
  paramNote: (_p, r) => `Ideal duty 1 − Vt/Vlink = ${(r.params.dutyIdeal * 100).toFixed(2)} % · the controller found ${(r.params.duty * 100).toFixed(2)} % (${r.params.iterations} simulations) · SiC MOSFETs, synchronous, dead time ${formatSI(r.params.td, 's')}`,
  simulate: (p) => simulateStage(p),
  measure: measureStage,
  state: stageStateAt,
  view: (st) => stageView(st),
  why: stageWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <DcdcStageDiagram r={r} st={st} selected={selected} onSelect={onSelect} live={live} values={values} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['g2', 'il', 'vlink'],
  primaryChannels: ['g2', 'il'],
  addOrder: ['g2', 'g1', 'il', 'vlink', 'vsw', 'vc', 'iinv', 'ic', 'is2', 'is1', 'id1', 'id2', 'vbt', 'pbat', 'plink', 'el', 'ec'],
  shade: (r, k) => {
    const d = (id: string) => r.devices.find((x) => x.id === id)!.on[k]
    return d('S2') ? 'rgba(57,135,229,0.08)' : d('D1') || d('D2') ? 'rgba(0,131,0,0.12)' : d('S1') ? 'rgba(26,163,184,0.08)' : null
  },
  shadeLegend: 'blue band: S2 on · teal band: S1 on · green band: a body diode (dead time)',
  eventLabel: stageEventLabel,
  eventWhy: stageEventWhy,
  eventColor: (e) => (e.kind.startsWith('diode') ? '#22b14c' : e.device === 'S2' ? '#3987e5' : '#1aa3b8'),
  initialCursor: (r) => (r.params.periods - 1 + r.params.duty / 2) * r.params.ts,
  periodName: 'period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Operating point">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{m.direction === 'motoring' ? 'MOTORING' : 'REGENERATING'}</span>
        <span className="small">
          η {(m.efficiency * 100).toFixed(2)} % · D {(m.duty * 100).toFixed(2)} %<span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        Vlink {formatV(m.vlinkAvg, false)} (target {r.params.vlink} V) · iL {formatA(m.ilAvg, true)} ± {formatA(m.ilPP / 2)} · losses {formatW(m.pLoss)}
      </p>
    </section>
  ),
  summary: (_r, m) => `${m.direction === 'motoring' ? 'Motoring' : 'Regenerating'}: Vlink ${formatV(m.vlinkAvg, false)}, η ${(m.efficiency * 100).toFixed(2)} % (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'battery')
      return {
        title: 'Traction battery',
        role: 'The energy store. Its voltage is lower than the link the inverter wants, and it sags by Rb·I under load.',
        rows: [
          ['State now', st.il >= 0 ? 'DISCHARGING' : 'CHARGING'],
          ['Open-circuit voltage', formatV(p.vbat, false)],
          ['Terminal voltage now', formatV(st.vbt, false)],
          ['Current now / average', `${formatA(st.il, true)} / ${formatA(m.ilAvg, true)}`],
          ['Internal resistance', formatSI(p.rbat, 'Ω')],
          ['Average power at the terminals', formatW(m.pBat)],
        ],
      }
    if (part === 'l')
      return {
        title: 'Inductor L',
        role: 'Stores energy while S2 is on and releases it into the link while S1 is on (motoring) — the other way round when braking.',
        rows: [
          ['State now', Math.sign(st.dildt) === Math.sign(st.il) ? 'STORING ENERGY' : 'RELEASING ENERGY'],
          ['L / DCR', `${formatSI(p.l, 'H')} / ${formatSI(p.rl, 'Ω')}`],
          ['iL now', formatA(st.il, true)],
          ['diL/dt now', formatSI(st.dildt, 'A/s')],
          ['Ripple ΔiL', formatA(m.ilPP)],
          ['RMS current', formatA(m.ilRms)],
          ['DCR loss', formatW(m.pDcr)],
        ],
      }
    if (part === 's1' || part === 's2' || part === 'd1' || part === 'd2') {
      const up = part.endsWith('1')
      const sw = up ? 'S1' : 'S2'
      return {
        title: `${up ? 'High side' : 'Low side'}: ${sw} and ${up ? 'D1' : 'D2'}`,
        role: up
          ? 'The synchronous switch: carries the current into the link while motoring and from the link when braking. D1 is its body diode.'
          : 'The boost switch: shorts the inductor to ground for D·Ts so that its current builds up. D2 is its body diode.',
        rows: [
          ['State now', (up ? st.s1 : st.s2) ? 'ON' : (up ? st.d1 : st.d2) ? 'DIODE CONDUCTING' : 'OFF'],
          ['Gate now', (up ? st.g1 : st.g2) ? 'HIGH' : 'LOW'],
          ['Channel current now', formatA(up ? st.is1 : st.is2, true)],
          ['Diode current now', formatA(up ? st.id1 : st.id2)],
          ['Ron / diode Vf', `${formatSI(p.ron, 'Ω')} / ${formatV(p.vf, false)}`],
          ['Conduction loss', formatW(up ? m.pS1 : m.pS2)],
          ['Blocking voltage', formatV(m.vlinkAvg, false)],
        ],
      }
    }
    if (part === 'c')
      return {
        title: 'DC-link capacitor C',
        role: 'Holds the link voltage steady: it feeds the inverter while S2 is on and is recharged while S1 is on.',
        rows: [
          ['State now', st.ic >= 0 ? 'CHARGING' : 'DISCHARGING'],
          ['C / ESR', `${formatSI(p.c, 'F')} / ${formatSI(p.esr, 'Ω')}`],
          ['Vlink now', formatV(st.vlink, false)],
          ['Capacitor ripple ΔvC', formatSI(m.vcPP, 'V')],
          ['ESR loss', formatW(m.pEsr)],
        ],
      }
    return {
      title: 'Inverter and motor',
      role: 'Seen from the link as a source E behind 1 Ω, set so that it takes (or, braking, returns) the power you choose at the target voltage.',
      rows: [
        ['Power set', formatW(p.power)],
        ['Power now', formatW(st.vlink * st.iinv)],
        ['Average power', formatW(m.pLink)],
        ['Current now', formatA(st.iinv, true)],
        ['E / Rinv', `${formatV(p.einv, false)} / ${p.rinv} Ω`],
      ],
    }
  },
  parts: [
    { id: 'battery', label: 'Battery' },
    { id: 'l', label: 'Inductor L' },
    { id: 's2', label: 'Low side S2 / D2' },
    { id: 's1', label: 'High side S1 / D1' },
    { id: 'c', label: 'Link capacitor C' },
    { id: 'inv', label: 'Inverter and motor' },
  ],
  analyze: {
    compare: compareStage,
    theory: (r) => {
      const p = r.params
      return (
        <>
          <h3>Boost law, ripple, losses and the exact solution</h3>
          <ol className="derivation">
            <li>
              <b>Volt-second balance</b> — over one period the inductor current returns to its start: <span className="mono">Vt·D = (Vlink − Vt)·(1 − D)</span>, so <span className="mono">Vlink = Vt/(1 − D)</span> and{' '}
              <span className="mono">D = 1 − Vt/Vlink</span> (ideal).
            </li>
            <li>
              <b>Ripple</b> — <span className="mono">ΔiL = Vt·D/(L·fs)</span>; the capacitor feeds the inverter while S2 is on: <span className="mono">ΔvC ≈ Ilink·D/(C·fs)</span>.
            </li>
            <li>
              <b>Losses</b> — conduction <span className="mono">≈ Irms²·(Ron + DCR)</span>, <span className="mono">Irms² = I² + ΔiL²/12</span>; switching{' '}
              <span className="mono">fs·(Eon + Eoff)·(V/600 V)·(I/300 A)</span> for each hard edge; <span className="mono">η = Pout / Pin</span>.
            </li>
            <li>
              <b>Both directions</b> — synchronous switches conduct both ways, so a negative average iL simply carries power back (regeneration). In the dead time ({formatSI(p.td, 's')}) the body diode
              matching the current conducts.
            </li>
            <li>
              <b>Exact solution</b> — in every mode the circuit is linear: <span className="mono">x(t) = e^(A·t)·x0 + ∫e^(A·τ)dτ·b</span>, x = [iL, vC]. The periodic state solves Φ(x0) = x0 (Newton on the exact period map); averages
              by Gauss–Legendre on each piece. Period {formatTime(p.ts)}.
            </li>
          </ol>
        </>
      )
    },
    tabs: [{ id: 'sweep', label: 'Efficiency vs load', render: ({ p }) => <EfficiencySweep p={p} /> }],
    convergence: ['vlinkAvg', 'ilPP'],
  },
  analysis: ANALYSIS,
  status: (st, r) => stageStatus(st, r),
  path: (st) => stagePath(st),
  energyModel: (st, _m, r) => stageEnergy(st, r),
  readings: stageReadings,
  lessons: STAGE_LESSONS,
  experiments: STAGE_EXPERIMENTS,
  predictions: stagePredictions,
  measureLabels: STAGE_MEASURE_LABELS,
}
