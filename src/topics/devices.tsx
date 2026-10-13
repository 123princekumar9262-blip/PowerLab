import { compareMosfet, measureMosfet, MOSFET_DEFAULTS, MOSFET_EXPERIMENTS, MOSFET_LESSONS, mosfetEventLabel, mosfetEventWhy, mosfetPredictions, mosfetStateAt, mosfetView, mosfetWhy, type MosfetState } from '../converters/devices/content.ts'
import { MOSFET_LIMITS as L, simulateMosfet, type MosfetMeasurements, type MosfetParams, type MosfetRun } from '../converters/devices/mosfet.ts'
import { DPT_RUNS, dptPath, Flow, flowThr, peakAbs } from '../components/devices/WbgDiagrams.tsx'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../utils/format.ts'
import { mosfetReadings } from './readings.ts'

const CH: Record<string, ChannelMeta> = {
  vg: { id: 'vg', label: 'Vdrv', name: 'Gate driver output', unit: 'V', color: '#aeb7c5', dash: [6, 4], group: 'Gate' },
  vgs: { id: 'vgs', label: 'vGS', name: 'Gate–source voltage', unit: 'V', color: '#3987e5', group: 'Gate' },
  ig: { id: 'ig', label: 'iG', name: 'Gate current', unit: 'A', color: '#c98500', group: 'Gate current' },
  vds: { id: 'vds', label: 'vDS', name: 'Drain–source voltage', unit: 'V', color: '#d95926', group: 'Drain' },
  id: { id: 'id', label: 'iD', name: 'Drain current', unit: 'A', color: '#e66767', group: 'Currents' },
  idiode: { id: 'idiode', label: 'iF', name: 'Freewheeling diode current', unit: 'A', color: '#008300', dash: [6, 4], group: 'Currents' },
  ich: { id: 'ich', label: 'ich', name: 'Channel current', unit: 'A', color: '#9085e9', dash: [2, 3], group: 'Currents' },
  pdev: { id: 'pdev', label: 'p', name: 'Power in the MOSFET vDS·iD', unit: 'W', color: '#d55181', group: 'Power' },
  energy: { id: 'energy', label: 'E', name: 'Energy dissipated so far', unit: 'J', color: '#d55181', dash: [6, 4], group: 'Energy' },
}

/** Double-pulse test circuit with the MOSFET's gate model; states read from the simulation. */
function DptDiagram({ st, r, selected, onSelect, values, live, showPath }: { st: MosfetState; r: MosfetRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath: boolean }) {
  const p = r.params
  // current flow at the cursor: the load carries I0 = iD + iF (KCL at the drain); the source carries iD
  const thr = flowThr(p.i0)
  // with the flow shown, the wires stay neutral under the green dashes (the symbols still show who conducts)
  const hue = (c: string) => (showPath ? '' : c)
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
  const chOn = st.region !== 'cut'
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Double-pulse test: ${st.phase}`}>
      <path d="M380 40 H560 V230 H380" className="wire" />
      <path d="M380 40 V70" className={`wire ${hue(st.diode ? 'wire--diode' : '')}`} />
      <path d="M380 120 V130" className="wire" />
      <path d="M470 40 V70" className="wire" />
      <path d="M470 120 V130 H380" className="wire" />
      <path d="M380 130 V160" className={`wire ${hue(chOn ? 'wire--igbt' : '')}`} />
      <path d="M380 200 V230" className={`wire ${hue(chOn ? 'wire--igbt' : '')}`} />
      <Flow on={showPath} i={st.id} thr={thr} runs={DPT_RUNS.srcTop} />
      <Flow on={showPath} i={st.id} thr={thr} runs={DPT_RUNS.srcBot} />
      <Flow on={showPath} i={st.id} thr={thr} runs={[[[380, 130], [380, 160]], [[380, 200], [380, 230]]]} />
      <Flow on={showPath} i={st.idiode} thr={thr} runs={DPT_RUNS.diode} />
      <Flow on={showPath} i={p.i0} thr={thr} runs={[[[470, 40], [470, 70]], [[470, 120], [470, 130], [380, 130]]]} />
      {/* DC source */}
      <g {...part('vdc', `Vdc ${p.vdc} V`)}>
        <rect x={545} y={115} width={30} height={30} className="cpart-hit" />
        <rect x={542} y={124} width={36} height={14} className="gap-mask" />
        <line x1={544} x2={576} y1={128} y2={128} className="sym" />
        <line x1={551} x2={569} y1={136} y2={136} className="sym sym--thick" />
        <text x={584} y={135} className="cvalue">
          Vdc {formatV(p.vdc, false)}
        </text>
      </g>
      {/* freewheeling diode: anode at the drain (bottom), cathode at Vdc (top) */}
      <g {...part('diode', `Freewheeling diode ${st.diode ? 'ON' : 'OFF'}`)}>
        <rect x={355} y={68} width={50} height={54} className="cpart-hit" />
        <path d="M368 110 H392 L380 84 Z" className={`sym-fill ${st.diode ? 'sym-fill--on-d' : ''}`} />
        <line x1={368} x2={392} y1={84} y2={84} className="sym" />
        <text x={350} y={100} className="clabel" textAnchor="end">
          D
        </text>
        {values && (
          <text x={350} y={116} className="cvalue" textAnchor="end">
            {formatA(st.idiode)}
          </text>
        )}
      </g>
      {/* inductive load = current source */}
      <g {...part('load', `Load current ${p.i0} A`)}>
        <rect x={450} y={70} width={40} height={50} className="cpart-hit" />
        <circle cx={470} cy={95} r={16} className="sym-body" />
        {/* arrow down: I0 flows from Vdc+ through the inductor into the drain node */}
        <path d="M470 82 V108 M464 102 L470 108 L476 102" className="sym" />
        {/* three short lines between the source and the loop's right-hand wire (x = 560) */}
        <text x={492} y={90} className="cvalue">
          I0
        </text>
        <text x={492} y={104} className="cvalue">
          {formatA(p.i0)}
        </text>
        <text x={492} y={118} className="cnote">
          (inductor)
        </text>
      </g>
      {/* MOSFET */}
      <g {...part('mosfet', `MOSFET ${st.region}`)}>
        <rect x={340} y={150} width={70} height={60} className="cpart-hit" />
        <line x1={366} x2={366} y1={160} y2={200} className="sym sym--thick" />
        <line x1={374} x2={374} y1={158} y2={202} className={`sym ${chOn ? 'sym--on-q' : ''}`} strokeDasharray={st.region === 'cut' ? '5 4' : undefined} />
        <path d="M374 166 H380 M374 194 H380" className="sym" />
        <text x={418} y={176} className="clabel">
          Q
        </text>
        <text x={418} y={192} className="cvalue">
          {st.region === 'cut' ? 'OFF' : st.region === 'sat' ? 'saturation' : 'ohmic'}
        </text>
        {values && (
          <text x={418} y={208} className="cvalue cvalue--out">
            vDS {formatV(st.vds)}
          </text>
        )}
      </g>
      {/* gate network */}
      <path d="M120 180 H200" className="wire" />
      <path d="M250 180 H366" className="wire" />
      <Flow on={showPath} i={st.ig} thr={flowThr(peakAbs(r.signals.ig))} runs={[[[120, 180], [200, 180]], [[250, 180], [366, 180]]]} />
      <g {...part('rg', `Gate resistor ${p.rg} Ω`)}>
        <rect x={198} y={168} width={54} height={24} className="cpart-hit" />
        <rect x={205} y={173} width={40} height={14} rx={2} className="sym-body" />
        <text x={225} y={164} textAnchor="middle" className="cvalue">
          Rg {formatSI(p.rg, 'Ω')}
        </text>
      </g>
      <g {...part('driver', `Gate driver ${formatV(st.vg)}`)}>
        <rect x={50} y={155} width={70} height={50} rx={8} className={`pblock ${st.vg > p.voff ? 'pblock--on' : ''}`} />
        <text x={85} y={177} textAnchor="middle" className="clabel">
          driver
        </text>
        {live && (
          <text x={85} y={194} textAnchor="middle" className="cvalue">
            {formatV(st.vg)}
          </text>
        )}
      </g>
      <g {...part('caps', 'Gate capacitances')}>
        <path d="M310 180 V205 M300 205 H320 M300 211 H320 M310 211 V230" className="sym" />
        <text x={296} y={226} textAnchor="end" className="cvalue">
          Cgs {formatSI(p.cgs, 'F')}
        </text>
        <path d="M330 180 V120 H380" className="wire wire--thin" strokeDasharray="3 3" />
        {/* left of its dashed branch, clear of the drain wire at x = 380 */}
        <text x={324} y={146} textAnchor="end" className="cvalue">
          Cgd {formatSI(p.cgd, 'F')}
        </text>
      </g>
      {values && (
        <text x={250} y={204} textAnchor="middle" className="cvalue cvalue--strong">
          vGS {formatV(st.vgs)}
        </text>
      )}
      <path d="M310 230 H380" className="wire" />
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {st.phase}
        {live && ` · iD ${formatA(st.id)} · p = ${formatSI(st.p, 'W')}`}
      </text>
    </svg>
  )
}

export const MOSFET_TOPIC: Topic<MosfetParams, MosfetRun, MosfetMeasurements, MosfetState> = {
  id: 'mosfet',
  label: 'MOSFET switching',
  title: 'MOSFET double-pulse test',
  defaults: MOSFET_DEFAULTS,
  basic: [
    { kind: 'number', key: 'rg', label: 'Gate resistance Rg', unit: 'Ω', min: L.rg.min, max: L.rg.max, log: true },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'i0', label: 'Load current I0', unit: 'A', min: L.i0.min, max: L.i0.max, log: true },
    { kind: 'number', key: 'vdrv', label: 'Gate drive voltage', unit: 'V', min: L.vdrv.min, max: L.vdrv.max, step: 0.5 },
    { kind: 'number', key: 'voff', label: 'Gate off voltage', unit: 'V', min: L.voff.min, max: L.voff.max, step: 0.5 },
  ],
  advanced: [
    { kind: 'number', key: 'cgs', label: 'Cgs', unit: 'nF', scale: 1e-9, min: L.cgs.min, max: L.cgs.max, log: true },
    { kind: 'number', key: 'cgd', label: 'Cgd (Miller)', unit: 'pF', scale: 1e-12, min: L.cgd.min, max: L.cgd.max, log: true },
    { kind: 'number', key: 'cds', label: 'Cds', unit: 'pF', scale: 1e-12, min: L.cds.min, max: L.cds.max, step: 10 },
    { kind: 'number', key: 'vth', label: 'Threshold Vth', unit: 'V', min: L.vth.min, max: L.vth.max, step: 0.1 },
    { kind: 'number', key: 'gm', label: 'Transconductance gm', unit: 'S', min: L.gm.min, max: L.gm.max, log: true },
    { kind: 'number', key: 'ron', label: 'On-resistance Ron', unit: 'mΩ', scale: 1e-3, min: L.ron.min, max: L.ron.max, log: true },
  ],
  paramNote: (_p, r) =>
    `τ = Rg·Ciss = ${formatTime(r.params.rg * r.params.ciss)} · plateau ≈ Vth + I0/gm = ${formatV(r.params.vpl, false)} · window ${formatTime(r.params.tend)} · model: constant Cgs, Cgd, Cds (a real Cgd grows as vDS falls, lengthening the plateau), no diode reverse recovery, no stray inductance (so no ringing)`,
  simulate: (p) => simulateMosfet(p),
  measure: measureMosfet,
  state: mosfetStateAt,
  view: (st) => mosfetView(st),
  why: mosfetWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <DptDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  path: (st, r) => dptPath({ dev: 'Q', devId: 'mosfet', i: st.id, idiode: st.idiode, i0: r.params.i0 }),
  channels: CH,
  defaultChannels: ['vg', 'vgs', 'vds', 'id'],
  addOrder: ['vg', 'vgs', 'ig', 'vds', 'id', 'idiode', 'ich', 'pdev', 'energy'],
  shade: (r, k) => (r.signals.pdev[k] > 0.05 * r.params.vdc * r.params.i0 ? 'rgba(213,81,129,0.12)' : null),
  shadeLegend: 'pink band: large power in the device (switching loss)',
  eventLabel: mosfetEventLabel,
  eventWhy: mosfetEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' || e.kind === 'gate-off' ? '#aeb7c5' : '#3987e5'),
  // one double-pulse test: nothing repeats after it
  repeats: () => false,
  initialCursor: (r) => {
    const m = measureMosfet(r)
    return r.params.ton + (m.tdOn ?? 0) + (m.tri ?? 0) + 0.5 * (m.tfv ?? 0)
  },
  periodName: 'test',
  badge: (_r, m) => (
    <section className="dc-mode" aria-label="Switching losses">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">DPT</span>
        <span className="small">
          Eon {formatSI(m.eon, 'J')} · Eoff {formatSI(m.eoff, 'J')} · plateau {formatV(m.plateau ?? NaN)}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        td(on) {formatTime(m.tdOn ?? NaN)} · t_ri {formatTime(m.tri ?? NaN)} · t_fv {formatTime(m.tfv ?? NaN)} · td(off) {formatTime(m.tdOff ?? NaN)} · t_rv {formatTime(m.trv ?? NaN)} · t_fi {formatTime(m.tfi ?? NaN)}
      </p>
    </section>
  ),
  summary: (_r, m) => `Eon ${formatSI(m.eon, 'J')} · Eoff ${formatSI(m.eoff, 'J')} (SIMULATION)`,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'mosfet')
      return { title: 'MOSFET', role: 'A voltage-controlled switch: the gate voltage sets the channel; its capacitances set how fast it can switch.', rows: [['Region now', st.region], ['vGS / vDS', `${formatV(st.vgs)} / ${formatV(st.vds)}`], ['Eon / Eoff', `${formatSI(m.eon, 'J')} / ${formatSI(m.eoff, 'J')}`], ['Conduction loss at I0', formatSI(m.pcond, 'W')], ['Ciss, Crss', `${formatSI(p.ciss, 'F')}, ${formatSI(p.cgd, 'F')}`]] }
    if (part === 'diode') return { title: 'Freewheeling diode', role: 'Carries the inductor current while the MOSFET is off; clamps the drain at Vdc.', rows: [['Current now', formatA(st.idiode)], ['State', st.diode ? 'ON' : 'OFF']] }
    if (part === 'rg' || part === 'driver') return { title: 'Gate drive', role: 'Charges and discharges the gate capacitances; Rg sets every transition time.', rows: [['Driver', `${formatV(p.vdrv, false)} / ${formatV(p.voff)}`], ['Rg', formatSI(p.rg, 'Ω')], ['Gate current now', formatA(st.ig, true)], ['τ = Rg·Ciss', formatTime(p.rg * p.ciss)]] }
    if (part === 'caps') return { title: 'Gate capacitances', role: 'Cgs must be charged to reach the threshold; Cgd (Miller) must be charged by the full drain swing — the plateau.', rows: [['Cgs', formatSI(p.cgs, 'F')], ['Cgd', formatSI(p.cgd, 'F')], ['Cds', formatSI(p.cds, 'F')]] }
    return { title: 'Inductive load', role: 'Over the nanoseconds of a switching transition the load inductor holds its current constant: a current source.', rows: [['I0', formatA(p.i0)], ['Vdc', formatV(p.vdc, false)]] }
  },
  analyze: {
    compare: compareMosfet,
    theory: (r) => (
      <>
        <h3>The switching transient, phase by phase</h3>
        <ol className="derivation">
          <li>
            <b>Delay</b> — the channel is off; the driver charges Ciss = Cgs + Cgd through Rg: <span className="mono">vGS(t) = Vdrv − (Vdrv − Voff)·e^(−t/RgCiss)</span>, until vGS = Vth.
          </li>
          <li>
            <b>Current rise</b> — the channel conducts gm·(vGS − Vth) but the diode still clamps the drain at Vdc; ends when the channel carries I0 (vGS ≈ Vth + I0/gm).
          </li>
          <li>
            <b>Voltage fall</b> — the diode releases; vDS falls while vGS stays on the Miller plateau because the gate current goes into Cgd: <span className="mono">dvDS/dt ≈ −(Vdrv − Vpl)/(Rg·Cgd)</span>.
          </li>
          <li>
            <b>Ohmic</b> — vDS = I0·Ron; vGS rises to Vdrv. Turn-off runs the same phases backwards.
          </li>
        </ol>
        <p className="small">
          The exact THEORY solves the same piecewise-linear circuit equations analytically (matrix exponential), finding each phase boundary exactly; the textbook formulas simplify the plateau (they ignore the
          Cgd current in the channel{r.params.cds > 0 ? ' and Cds' : ''}).
        </p>
      </>
    ),
    convergence: ['tfv', 'eon'],
  },
  lessons: MOSFET_LESSONS,
  experiments: MOSFET_EXPERIMENTS,
  predictions: mosfetPredictions,
  readings: mosfetReadings,
  measureLabels: {
    tdOn: { label: 'td(on)', fmt: (v) => formatTime(v) },
    tri: { label: 't_ri', fmt: (v) => formatTime(v) },
    tfv: { label: 't_fv', fmt: (v) => formatTime(v) },
    trv: { label: 't_rv', fmt: (v) => formatTime(v) },
    eon: { label: 'Eon', fmt: (v) => formatSI(v, 'J') },
    eoff: { label: 'Eoff', fmt: (v) => formatSI(v, 'J') },
    plateau: { label: 'Miller plateau', fmt: (v) => formatV(v, false) },
  },
}
