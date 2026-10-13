import { diodeCurrentLambert, ivCurve, DIODE_LIMITS as L, simulateDiode, type DiodeMeasurements, type DiodeParams, type DiodeRun } from '../converters/devices/diode.ts'
import {
  compareDiode,
  DIODE_ANALYSIS,
  DIODE_DEFAULTS,
  DIODE_EXPERIMENTS,
  DIODE_LESSONS,
  DIODE_PARTS,
  diodeEnergyModel,
  diodeEventLabel,
  diodeEventWhy,
  diodeMeasured,
  diodeNext,
  diodePath,
  diodePredictions,
  diodeReadings,
  diodeStateAt,
  diodeStatus,
  diodeView,
  diodeWhy,
  formatSlope,
  type DiodeState,
} from '../converters/devices/diodeContent.ts'
import { Flow, flowThr } from '../components/devices/WbgDiagrams.tsx'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  id: { id: 'id', label: 'iD', name: 'Diode current', unit: 'A', color: '#008300', group: 'Diode current' },
  vd: { id: 'vd', label: 'vAK', name: 'Diode voltage (anode − cathode)', unit: 'V', color: '#22b14c', dash: [6, 4], group: 'Diode voltage' },
  iq: { id: 'iq', label: 'iQ', name: 'Switch current', unit: 'A', color: '#e66767', group: 'Switch current' },
  vq: { id: 'vq', label: 'vQ', name: 'Switch voltage', unit: 'V', color: '#d95926', group: 'Switch voltage' },
  qe: { id: 'qe', label: 'qE', name: 'Junction charge qE [nC]', unit: '', color: '#9085e9', group: 'Stored charge' },
  qm: { id: 'qm', label: 'qM', name: 'Base charge qM [nC]', unit: '', color: '#c98500', dash: [6, 4], group: 'Stored charge' },
  qrrn: { id: 'qrrn', label: 'Qrr', name: 'Charge recovered so far [nC]', unit: '', color: '#3987e5', group: 'Recovered charge' },
  pq: { id: 'pq', label: 'pQ', name: 'Power in the switch vQ·iQ', unit: 'W', color: '#d55181', group: 'Power' },
  pd: { id: 'pd', label: 'pD', name: 'Power in the diode vAK·iD', unit: 'W', color: '#5fb87a', group: 'Power' },
  eq: { id: 'eq', label: 'EQ', name: 'Switch energy so far', unit: 'J', color: '#d55181', dash: [6, 4], group: 'Energy' },
  ed: { id: 'ed', label: 'ED', name: 'Diode energy so far', unit: 'J', color: '#5fb87a', dash: [6, 4], group: 'Energy' },
  vls: { id: 'vls', label: 'vLs', name: 'Loop-inductance voltage Ls·diD/dt', unit: 'V', color: '#aeb7c5', group: 'Loop inductance' },
}

/** The commutation circuit: Vdc, loop inductance, the diode under test, the load inductor and the switch. */
function DiodeDiagram({ st, r, selected, onSelect, values, live, showPath }: { st: DiodeState; r: DiodeRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath: boolean }) {
  const p = r.params
  // current flow at the cursor (KCL at the switch node: I0 = iQ + iD). iD > 0 flows up through the diode
  // (anode → cathode); during reverse recovery iD < 0 and the dashes run backwards, down through Ls and the diode
  // into the switch, which then carries I0 + |iD|. Scale: the run's peak current I0 + Irr.
  const thr = flowThr(Math.max(p.i0, diodeMeasured(r).ipk))
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
  const dOn = st.dev !== 'R'
  const qOn = st.sw !== 'off'
  // stored-charge gauge: the base charge relative to its value at I0 (0…1)
  const qFrac = Math.max(0, Math.min(1, st.qm / Math.max(p.qm0, 1e-18)))
  const coil = 'M380 46 V52 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 V96'
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Diode reverse recovery: ${st.phase}`}>
      {/* rails: Vdc+ on top, Vdc− at the bottom */}
      <path d="M380 40 H560 V112 M560 152 V236 H380" className="wire" />
      <path d="M380 40 V46" className={`wire ${hue(dOn ? 'wire--diode' : '')}`} />
      <path d="M380 96 V104 M380 128 V150" className={`wire ${hue(dOn ? 'wire--diode' : '')}`} />
      <path d="M470 40 V77 M470 113 V150 H380" className="wire" />
      <path d="M380 150 V168 M380 212 V236" className={`wire ${hue(qOn ? 'wire--igbt' : '')}`} />
      <Flow on={showPath} i={st.iq} thr={thr} runs={[[[560, 112], [560, 40], [470, 40]]]} />
      <Flow on={showPath} i={st.iq} thr={thr} runs={[[[380, 236], [560, 236], [560, 152]]]} />
      <Flow on={showPath} i={st.iq} thr={thr} runs={[[[380, 150], [380, 168]], [[380, 212], [380, 236]]]} />
      <Flow
        on={showPath}
        i={st.id}
        thr={thr}
        runs={[
          [[380, 150], [380, 128]],
          [[380, 104], [380, 96]],
          [[380, 46], [380, 40], [470, 40]],
        ]}
      />
      <Flow on={showPath} i={p.i0} thr={thr} runs={[[[470, 40], [470, 77]], [[470, 113], [470, 150], [380, 150]]]} />
      {/* DC source */}
      <g {...part('vdc', `Vdc ${p.vdc} V`)}>
        <rect x={545} y={112} width={30} height={40} className="cpart-hit" />
        <line x1={544} x2={576} y1={126} y2={126} className="sym" />
        <line x1={551} x2={569} y1={136} y2={136} className="sym sym--thick" />
        <text x={584} y={135} className="cvalue">
          Vdc {formatV(p.vdc, false)}
        </text>
      </g>
      {/* loop (stray) inductance */}
      <g {...part('ls', `Loop inductance ${formatSI(p.ls, 'H')}`)}>
        <rect x={364} y={44} width={34} height={54} className="cpart-hit" />
        <path d={coil} className="sym sym--coil" />
        <text x={358} y={66} className="clabel" textAnchor="end">
          Ls
        </text>
        <text x={358} y={82} className="cvalue" textAnchor="end">
          {formatSI(p.ls, 'H')}
        </text>
      </g>
      {/* the diode under test: anode at the switch node (bottom), cathode towards Ls (top) */}
      <g {...part('diode', `Diode ${dOn ? 'conducting' : 'blocking'}`)}>
        <rect x={354} y={100} width={52} height={32} className="cpart-hit" />
        <path d="M368 128 H392 L380 104 Z" className={`sym-fill ${dOn ? 'sym-fill--on-d' : ''}`} />
        <line x1={368} x2={392} y1={104} y2={104} className="sym" />
        <text x={350} y={116} className="clabel" textAnchor="end">
          D
        </text>
        {live && (
          <text x={350} y={131} className="cvalue" textAnchor="end">
            {formatA(st.id)}
          </text>
        )}
        {values && (
          <text x={350} y={146} className="cvalue" textAnchor="end">
            {formatV(st.vd)}
          </text>
        )}
        {/* stored-charge gauge */}
        <rect x={404} y={102} width={9} height={28} rx={2} className="sym-body" />
        <rect x={405} y={103 + 26 * (1 - qFrac)} width={7} height={26 * qFrac} fill="#c98500" />
        <text x={418} y={112} className="cnote">
          q
        </text>
      </g>
      {/* load inductor = current source I0 (from Vdc+ into the switch node) */}
      <g {...part('load', `Load current ${p.i0} A`)}>
        <rect x={450} y={72} width={40} height={46} className="cpart-hit" />
        <circle cx={470} cy={95} r={16} className="sym-body" />
        <path d="M470 82 V108 M464 102 L470 108 L476 102" className="sym" />
        <text x={492} y={86} className="cvalue">
          I0
        </text>
        <text x={492} y={100} className="cvalue">
          {formatA(p.i0)}
        </text>
        <text x={492} y={114} className="cnote">
          (inductor)
        </text>
      </g>
      {/* the switch */}
      <g {...part('switch', `Switch ${st.sw}`)}>
        <rect x={340} y={160} width={72} height={58} className="cpart-hit" />
        <line x1={366} x2={366} y1={170} y2={210} className="sym sym--thick" />
        <line x1={374} x2={374} y1={168} y2={212} className={`sym ${qOn ? 'sym--on-q' : ''}`} strokeDasharray={st.sw === 'off' ? '5 4' : undefined} />
        <path d="M374 176 H380 M374 204 H380" className="sym" />
        <text x={418} y={182} className="clabel">
          Q
        </text>
        <text x={418} y={198} className="cvalue">
          {st.sw === 'off' ? 'OFF' : st.sw === 'sat' ? 'turning on' : 'ON'}
        </text>
        {live && (
          <text x={418} y={213} className="cvalue cvalue--out">
            {formatA(st.iq)}
          </text>
        )}
      </g>
      {/* gate drive: sets the current slope S */}
      <path d="M310 190 H366" className="wire" />
      <g {...part('gate', 'Gate drive')}>
        <rect x={206} y={172} width={104} height={36} rx={8} className={`pblock ${qOn ? 'pblock--on' : ''}`} />
        <text x={258} y={188} textAnchor="middle" className="clabel">
          gate
        </text>
        <text x={258} y={202} textAnchor="middle" className="cvalue">
          S = {formatSlope(p.didt)}
        </text>
      </g>
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {st.phase}
        {live && ` · iD ${formatA(st.id)} · vAK ${formatV(st.vd)}`}
      </text>
    </svg>
  )
}

/** Static I–V: Newton's solve of the implicit Shockley equation (SIMULATION) and the Lambert-W closed form (THEORY). */
function IvPlot({ r, m }: { r: DiodeRun; m: DiodeMeasurements }) {
  const p = r.params
  const pts = ivCurve(p, 80)
  const W = 320
  const H = 210
  const vMax = pts[pts.length - 1].v
  const iMax = 2 * p.i0
  const X = (v: number) => 40 + (v / vMax) * (W - 54)
  const Y = (i: number) => 12 + (1 - Math.min(i, iMax * 1.05) / iMax) * (H - 44)
  const curve = pts.map((x, k) => `${k ? 'L' : 'M'}${X(x.v).toFixed(1)} ${Y(Math.max(0, x.iNewton)).toFixed(1)}`).join(' ')
  // the PWL tangent used in the transient: v = V0 + rd·i
  const tangent = `M${X(Math.max(0, p.v0)).toFixed(1)} ${Y(0).toFixed(1)} L${X(Math.min(vMax, p.v0 + p.rd * iMax)).toFixed(1)} ${Y(Math.min(iMax, (vMax - p.v0) / p.rd)).toFixed(1)}`
  let maxErr = 0
  for (const x of pts) if (x.iLambert > 1e-6 * p.i0) maxErr = Math.max(maxErr, Math.abs(x.iNewton - x.iLambert) / x.iLambert)
  return (
    <section className="dc-energy" aria-label="Static I–V">
      <h3 className="eyebrow">Static I–V at 25 °C</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="bi-plot" role="img" aria-label="Diode current against forward voltage">
        <line x1={40} x2={W - 10} y1={Y(0)} y2={Y(0)} className="bi-axis" />
        <line x1={40} x2={40} y1={10} y2={Y(0)} className="bi-axis" />
        <path d={curve} className="bi-traj" />
        <path d={tangent} className="bi-sat" />
        <circle cx={X(m.vf)} cy={Y(p.i0)} r={4} className="bi-dot" />
        <text x={X(m.vf) - 6} y={Y(p.i0) - 8} textAnchor="end" className="bi-label">
          I0 at {formatV(m.vf, false)}
        </text>
        <text x={44} y={22} className="bi-label">
          {formatA(iMax)}
        </text>
        <text x={W - 10} y={H - 16} textAnchor="end" className="bi-label">
          {formatV(vMax, false)}
        </text>
        <text x={40} y={H - 16} className="bi-label">
          0 V
        </text>
      </svg>
      <p className="muted small">
        Solid: i(v) solved by Newton's method from i = Is·(e^((v − Rs·i)/nVT) − 1) (SIMULATION); it matches the Lambert-W closed form to {maxErr.toExponential(1)} (THEORY). Dashed: the straight
        line vAK = V0 + rd·iD = {formatV(p.v0, false)} + {formatSI(p.rd, 'Ω')}·iD the transient uses — the tangent at I0. Below about {formatV(p.v0, false)} the real diode hardly conducts (
        {formatSI(diodeCurrentLambert(p, 0.5 * p.v0), 'A')} at {formatV(0.5 * p.v0, false)}).
      </p>
    </section>
  )
}

export const DIODE_TOPIC: Topic<DiodeParams, DiodeRun, DiodeMeasurements, DiodeState> = {
  id: 'diode',
  label: 'Diode recovery',
  title: 'Power diode: reverse recovery',
  defaults: DIODE_DEFAULTS,
  basic: [
    { kind: 'number', key: 'didt', label: 'Switch speed di/dt', unit: 'A/µs', scale: 1e6, min: L.didt.min, max: L.didt.max, log: true },
    { kind: 'number', key: 'tau', label: 'Carrier lifetime τ', unit: 'ns', scale: 1e-9, min: L.tau.min, max: L.tau.max, log: true },
    { kind: 'number', key: 'i0', label: 'Load current I0', unit: 'A', min: L.i0.min, max: L.i0.max, log: true },
    { kind: 'number', key: 'vdc', label: 'DC voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'ls', label: 'Loop inductance Ls', unit: 'nH', scale: 1e-9, min: L.ls.min, max: L.ls.max, log: true },
  ],
  advanced: [
    { kind: 'number', key: 'tm', label: 'Transit time T (softness)', unit: 'ns', scale: 1e-9, min: L.tm.min, max: L.tm.max, log: true },
    { kind: 'number', key: 'isat', label: 'Saturation current Is', unit: 'nA', scale: 1e-9, min: L.isat.min, max: L.isat.max, log: true },
    { kind: 'number', key: 'n', label: 'Ideality factor n', unit: '', min: L.n.min, max: L.n.max, step: 0.05 },
    { kind: 'number', key: 'rs', label: 'Series resistance Rs', unit: 'mΩ', scale: 1e-3, min: L.rs.min, max: L.rs.max, step: 1 },
    { kind: 'number', key: 'ron', label: 'Switch on-resistance', unit: 'mΩ', scale: 1e-3, min: L.ron.min, max: L.ron.max, log: true },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    const m = diodeMeasured(r)
    return `Stored charge τ·I0 = ${formatSI(p.qm0, 'C')} · tail τrr = τT/(τ + T) = ${formatTime(p.tauRR)} · Vdc/Ls = ${formatSlope(p.vdc / p.ls)} vs S = ${formatSlope(p.didt)}: the ${m.limit === 'gate' ? 'switch gate' : 'loop inductance'} sets di/dt (SIMULATION) · model: two-region charge control, no junction or switch capacitance (no ringing), 25 °C`
  },
  simulate: (p) => simulateDiode(p),
  measure: diodeMeasured,
  state: diodeStateAt,
  view: (st) => diodeView(st),
  why: diodeWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <DiodeDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['id', 'vd', 'iq'],
  primaryChannels: ['id'],
  addOrder: ['id', 'vd', 'iq', 'vq', 'qe', 'qm', 'qrrn', 'pq', 'pd', 'eq', 'ed', 'vls'],
  // while the reverse current is more than 2 % of its peak (the tail decays exponentially and never ends exactly)
  shade: (r, k) => (r.signals.id[k] < -0.02 * (diodeMeasured(r).irr ?? Infinity) ? 'rgba(0,131,0,0.13)' : null),
  shadeLegend: 'green band: the diode conducts backwards (reverse recovery)',
  eventLabel: diodeEventLabel,
  eventWhy: diodeEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' ? '#aeb7c5' : '#22b14c'),
  repeats: () => false,
  initialCursor: (r) => {
    const m = diodeMeasured(r)
    return m.tRec !== null ? m.tRec + 0.3 * r.params.tauRR : r.params.ton + 0.5 * (r.params.tend - r.params.ton)
  },
  periodName: 'test',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Reverse recovery">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{m.limit === 'gate' ? 'GATE di/dt' : 'LOOP di/dt'}</span>
        <span className="small">
          Irr {formatA(m.irr ?? NaN)} · trr {formatTime(m.trr ?? NaN)} · Qrr {formatSI(m.qrr, 'C')}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        di/dt {formatSlope(m.didt ?? NaN)} · peak reverse voltage {formatV(m.vrm, false)} (Vdc {formatV(r.params.vdc, false)}) · Eon {formatSI(m.eon, 'J')} (charge-free diode {formatSI(m.eon0, 'J')})
      </p>
    </section>
  ),
  summary: (_r, m) => `Irr ${formatA(m.irr ?? NaN)} · trr ${formatTime(m.trr ?? NaN)} · Qrr ${formatSI(m.qrr, 'C')} (SIMULATION)`,
  readings: (m) => diodeReadings(m),
  status: (st) => diodeStatus(st),
  nextConsequence: (r, st, m) => diodeNext(r, st, m),
  next: (r, st, m) => diodeNext(r, st, m)?.text ?? null,
  path: (st) => diodePath(st),
  energyModel: (st, _m, r) => diodeEnergyModel(st, r),
  analysis: DIODE_ANALYSIS,
  parts: DIODE_PARTS,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'diode')
      return {
        title: 'Diode under test',
        role: 'A PN power diode. Its stored charge lets it conduct backwards for a short time before it can block.',
        rows: [
          ['State now', st.dev === 'R' ? 'BLOCKING (recovered)' : st.id >= 0 ? 'CONDUCTING forward' : 'CONDUCTING backwards'],
          ['iD / vAK', `${formatA(st.id)} / ${formatV(st.vd)}`],
          ['Junction charge qE / base charge qM', `${formatSI(st.qe, 'C')} / ${formatSI(st.qm, 'C')}`],
          ['Vf at I0 (Shockley)', formatV(m.vf, false)],
          ['Lifetime τ, transit time T', `${formatTime(p.tau)}, ${formatTime(p.tm)}`],
          ['Irr / trr / Qrr', `${formatA(m.irr ?? NaN)} / ${formatTime(m.trr ?? NaN)} / ${formatSI(m.qrr, 'C')}`],
        ],
      }
    if (part === 'switch')
      return {
        title: 'Switch Q',
        role: 'Turns on and takes the load current from the diode. Its gate limits how fast its current can rise (S).',
        rows: [
          ['State now', st.sw === 'off' ? 'OFF' : st.sw === 'sat' ? 'TURNING ON (current set by its gate)' : 'ON (Ron)'],
          ['iQ / vQ', `${formatA(st.iq)} / ${formatV(st.vq)}`],
          ['Peak current I0 + Irr', formatA(m.ipk)],
          ['Eon / charge-free diode', `${formatSI(m.eon, 'J')} / ${formatSI(m.eon0, 'J')}`],
        ],
      }
    if (part === 'ls')
      return {
        title: 'Loop inductance Ls',
        role: 'The stray inductance of the commutation loop (wiring, package). It limits di/dt and turns the end of the recovery into a voltage spike.',
        rows: [
          ['Ls', formatSI(p.ls, 'H')],
          ['Voltage now Ls·diD/dt', formatV(st.vls)],
          ['Loop limit Vdc/Ls', formatSlope(p.vdc / p.ls)],
          ['Overshoot above Vdc', formatV(m.overshoot, false)],
        ],
      }
    if (part === 'gate')
      return { title: 'Gate drive', role: 'Turns the switch on at ton; how fast its current may rise is set here as the slope S.', rows: [['Slope S', formatSlope(p.didt)], ['Turn-on at', formatTime(p.ton)]] }
    if (part === 'load') return { title: 'Load inductor', role: 'Over the nanoseconds of the commutation the load inductor holds its current constant: a current source I0.', rows: [['I0', formatA(p.i0)]] }
    return { title: 'DC source', role: 'The DC link: supplies the switch current and sets the reverse voltage on the recovered diode.', rows: [['Vdc', formatV(p.vdc, false)]] }
  },
  analyze: {
    compare: compareDiode,
    theory: (r) => (
      <>
        <h3>Reverse recovery, phase by phase</h3>
        <ol className="derivation">
          <li>
            <b>Forward conduction</b> — the diode carries I0 at <span className="mono">Vf = n·VT·ln(1 + I0/Is) + Rs·I0</span>; its base stores <span className="mono">qM = τ·I0</span> (charge balance dqM/dt = iD − qM/τ = 0).
          </li>
          <li>
            <b>Current fall</b> — the switch takes the current: <span className="mono">diD/dt = −S</span> (gate-limited) or <span className="mono">−(Vdc + vAK − Ron·iQ)/Ls</span> (loop-limited).
          </li>
          <li>
            <b>Reverse current</b> — iD &lt; 0 while the junction charge <span className="mono">qE = qM + T·iD</span> is positive. For a constant slope S: <span className="mono">qM(s) = τ(I0 − S·s) + S·τ²(1 − e^(−s/τ))</span>; the junction recovers when{' '}
            <span className="mono">(τ + T)(I0 − S·s) + S·τ²(1 − e^(−s/τ)) = 0</span>, and <span className="mono">Irr = S·s − I0</span>, <span className="mono">ta = Irr/S</span>.
          </li>
          <li>
            <b>Tail</b> — the junction blocks; the base charge leaves as <span className="mono">iD = −qM/T</span>, decaying with <span className="mono">τrr = τT/(τ + T) = {formatTime(r.params.tauRR)}</span>. The reverse voltage jumps to{' '}
            <span className="mono">Vdc + Ls·Irr/τrr − Ron·(I0 + Irr)</span>; <span className="mono">tb = τrr·(ln(10/9) + 0.9/0.65·ln(3.6)) ≈ 1.88·τrr</span> (90 %–25 % rule).
          </li>
          <li>
            <b>Charge</b> — <span className="mono">Qrr = ½·Irr·ta + Irr·τrr</span> (exact for a constant slope); the triangle rule ½·Irr·trr and the abrupt rule Irr = √(2·Qrr·di/dt) are textbook approximations.
          </li>
        </ol>
        <p className="small">
          The exact THEORY solves the same piecewise-linear circuit analytically (matrix exponential) and finds every region change exactly; the energies are integrated with Simpson's rule between them. The
          tests also check the closed form above against the simulation when the gate sets di/dt.
        </p>
      </>
    ),
    tabs: [{ id: 'iv', label: 'Static I–V', render: ({ r, m }) => <IvPlot r={r} m={m} /> }],
    convergence: ['irr', 'qrr'],
  },
  lessons: DIODE_LESSONS,
  experiments: DIODE_EXPERIMENTS,
  predictions: diodePredictions,
  measureLabels: {
    irr: { label: 'Irr', fmt: (v) => formatA(v) },
    trr: { label: 'trr', fmt: (v) => formatTime(v) },
    ta: { label: 'ta', fmt: (v) => formatTime(v) },
    tb: { label: 'tb', fmt: (v) => formatTime(v) },
    tf: { label: 'Current fall time', fmt: (v) => formatTime(v) },
    didt: { label: 'di/dt', fmt: (v) => formatSlope(v) },
    qrr: { label: 'Qrr', fmt: (v) => formatSI(v, 'C') },
    qStored: { label: 'Stored charge τ·I0', fmt: (v) => formatSI(v, 'C') },
    softness: { label: 'Softness tb/ta', fmt: (v) => v.toFixed(2) },
    vrm: { label: 'Peak reverse voltage', fmt: (v) => formatV(v, false) },
    overshoot: { label: 'Overshoot above Vdc', fmt: (v) => formatV(v, false) },
    vf: { label: 'Forward voltage at I0', fmt: (v) => formatV(v, false) },
    eon: { label: 'Switch Eon', fmt: (v) => formatSI(v, 'J') },
    eon0: { label: 'Eon, charge-free diode', fmt: (v) => formatSI(v, 'J') },
    deon: { label: 'Extra Eon ΔEon', fmt: (v) => formatSI(v, 'J') },
    erec: { label: 'Diode recovery energy', fmt: (v) => formatSI(v, 'J') },
    ipk: { label: 'Peak switch current', fmt: (v) => formatA(v) },
  },
}
