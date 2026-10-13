import { gateDelay, rlTimeTo, SCR_LIMITS as L, simulateScr, textbookScr, type ScrMeasurements, type ScrParams, type ScrRun } from '../converters/devices/scr.ts'
import {
  compareScr,
  SCR_ANALYSIS,
  SCR_DEFAULTS,
  SCR_EXPERIMENTS,
  SCR_LESSONS,
  SCR_PARTS,
  scrEnergyModel,
  scrEventLabel,
  scrEventWhy,
  scrMeasured,
  scrNext,
  scrPath,
  scrPredictions,
  scrReadings,
  scrStateAt,
  scrStatus,
  scrView,
  scrWhy,
  type ScrView,
} from '../converters/devices/scrContent.ts'
import { Flow, flowThr, peakAbs } from '../components/devices/WbgDiagrams.tsx'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  ig: { id: 'ig', label: 'iG', name: 'Gate current', unit: 'A', color: '#c98500', group: 'Gate' },
  ia: { id: 'ia', label: 'iA', name: 'SCR anode current', unit: 'A', color: '#e66767', group: 'SCR current' },
  vak: { id: 'vak', label: 'vAK', name: 'SCR voltage (anode − cathode)', unit: 'V', color: '#d95926', group: 'SCR voltage' },
  q: { id: 'q', label: 'q/Qc', name: 'Stored charge over the critical charge q/Qc', unit: '', color: '#9085e9', group: 'Stored charge' },
  il: { id: 'il', label: 'iL', name: 'Load current', unit: 'A', color: '#aeb7c5', dash: [6, 4], group: 'Load current' },
  ifw: { id: 'ifw', label: 'iDfw', name: 'Freewheeling diode current', unit: 'A', color: '#008300', dash: [6, 4], group: 'Load current' },
  ic: { id: 'ic', label: 'iC', name: 'Commutation capacitor current', unit: 'A', color: '#3987e5', group: 'Commutation' },
  vc: { id: 'vc', label: 'vC', name: 'Commutation capacitor voltage', unit: 'V', color: '#3987e5', dash: [6, 4], group: 'Commutation' },
  vk: { id: 'vk', label: 'vLoad', name: 'Load voltage', unit: 'V', color: '#d55181', group: 'Load voltage' },
}

const TEST_NAME = { latch: 'Gate pulse and latching', hold: 'Holding current', commutate: 'Forced commutation' } as const

/** Source, SCR with its gate driver, R-L load with a freewheeling diode, and the commutation branch TA + C. */
function ScrDiagram({ st, r, selected, onSelect, values, live, showPath }: { st: ScrView; r: ScrRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath: boolean }) {
  const p = r.params
  // current flow at the cursor: the load current iL goes through the SCR (iA), the commutation branch (iC) or the
  // freewheeling diode (iDfw); the source carries iA + iC. Scale: the run's peak load current.
  const thr = flowThr(peakAbs(r.signals.il))
  const iSrc = st.ia + st.ic
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
  const on = st.s === 'on' || st.s === 'lat'
  const capOn = st.ic > 0
  const fw = st.ifw > 1e-9
  const loadOn = on || capOn || fw
  const com = p.test === 'commutate'
  const resistor = 'M540 96 V102 L548 106 L532 114 L548 122 L532 130 L548 138 L540 142 V148'
  const coil = 'M540 160 V166 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 V222'
  const qBar = Math.max(0, Math.min(1, st.qn / 2))
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`SCR test: ${st.phase}`}>
      {/* main loop: V+ → SCR → load → back */}
      <path d="M60 80 H200" className={`wire ${hue(on || capOn ? 'wire--igbt' : '')}`} />
      <path d="M200 80 H230" className={`wire ${hue(on ? 'wire--igbt' : '')}`} />
      <path d="M300 80 H330" className={`wire ${hue(on || capOn ? 'wire--igbt' : '')}`} />
      <path d="M330 80 H540 V96" className={`wire ${hue(loadOn ? 'wire--igbt' : '')}`} />
      <path d="M540 148 V160 M540 222 V240 H60" className={`wire ${hue(loadOn ? 'wire--igbt' : '')}`} />
      <path d="M60 80 V140 M60 180 V240" className={`wire ${hue(on || capOn ? 'wire--igbt' : '')}`} />
      {/* freewheeling diode branch */}
      <path d="M430 80 V128 M430 156 V240" className={`wire ${hue(fw ? 'wire--diode' : '')}`} />
      <Flow on={showPath} i={iSrc} thr={thr} runs={[[[60, 140], [60, 80], [200, 80]]]} />
      <Flow on={showPath} i={st.ia} thr={thr} runs={[[[200, 80], [230, 80]], [[300, 80], [330, 80]]]} />
      <Flow on={showPath} i={iSrc} thr={thr} runs={[[[330, 80], [430, 80]]]} />
      <Flow
        on={showPath}
        i={st.il}
        thr={thr}
        runs={[
          [[430, 80], [540, 80], [540, 96]],
          [[540, 148], [540, 160]],
          [[540, 222], [540, 240], [430, 240]],
        ]}
      />
      <Flow on={showPath} i={iSrc} thr={thr} runs={[[[430, 240], [60, 240], [60, 180]]]} />
      <Flow on={showPath} i={st.ifw} thr={thr} runs={[[[430, 240], [430, 156]], [[430, 128], [430, 80]]]} />
      {/* commutation branch above the SCR */}
      <g opacity={com ? 1 : 0.35}>
        <path d="M200 80 V36 H226 M262 36 H290 M304 36 H330 V80" className={`wire ${hue(capOn ? 'wire--hi' : '')}`} />
      </g>
      <Flow
        on={showPath}
        i={st.ic}
        thr={thr}
        runs={[
          [[200, 80], [200, 36], [226, 36]],
          [[262, 36], [290, 36]],
          [[304, 36], [330, 36], [330, 80]],
        ]}
      />
      {/* DC source */}
      <g {...part('vs', `Source ${p.vs} V`)}>
        <rect x={44} y={140} width={32} height={40} className="cpart-hit" />
        <line x1={44} x2={76} y1={154} y2={154} className="sym" />
        <line x1={51} x2={69} y1={164} y2={164} className="sym sym--thick" />
        <text x={72} y={205} className="cvalue">
          V {formatV(p.vs, false)}
        </text>
      </g>
      {/* SCR: anode left, cathode right, gate at the cathode */}
      <g {...part('scr', `SCR ${st.s}`)}>
        <rect x={226} y={62} width={78} height={40} className="cpart-hit" />
        <path d="M244 68 V92 L268 80 Z" className={`sym-fill ${on ? 'sym-fill--on-d' : ''}`} />
        <line x1={268} x2={268} y1={68} y2={92} className="sym" />
        <path d="M230 80 H244 M268 80 H300" className="sym" />
        <path d="M266 88 L278 100" className="sym" />
        <text x={236} y={118} className="clabel" textAnchor="end">
          SCR
        </text>
        <text x={236} y={133} className="cvalue" textAnchor="end">
          {st.s === 'off' ? 'OFF' : st.s === 'on' ? 'ON (gate)' : st.s === 'lat' ? 'latched' : 'OFF, charged'}
        </text>
        {live && (
          <text x={236} y={148} className="cvalue" textAnchor="end">
            {formatA(st.ia)}
          </text>
        )}
        {values && (
          <text x={236} y={163} className="cvalue cvalue--out" textAnchor="end">
            vAK {formatV(st.vak)}
          </text>
        )}
        {/* stored-charge gauge: q/Qc from 0 to 2, the mark at 1 = Qc */}
        <rect x={312} y={92} width={9} height={40} rx={2} className="sym-body" />
        <rect x={313} y={93 + 38 * (1 - qBar)} width={7} height={38 * qBar} fill={st.qn >= 1 ? '#9085e9' : '#6b6f7a'} />
        <line x1={309} x2={324} y1={112} y2={112} className="sym" strokeWidth={1.2} />
        <text x={327} y={116} className="cnote">
          Qc
        </text>
      </g>
      {/* gate driver */}
      <path d="M278 100 V170" className={`wire wire--thin ${hue(st.ig > 0 ? 'wire--hi' : '')}`} />
      <Flow on={showPath} i={st.ig} thr={flowThr(peakAbs(r.signals.ig))} runs={[[[278, 170], [278, 100]]]} />
      <g {...part('gate', `Gate driver ${formatA(st.ig)}`)}>
        <rect x={218} y={170} width={120} height={38} rx={8} className={`pblock ${st.ig > 0 ? 'pblock--on' : ''}`} />
        <text x={278} y={186} textAnchor="middle" className="clabel">
          gate
        </text>
        <text x={278} y={200} textAnchor="middle" className="cvalue">
          {formatA(p.ig)} · {formatTime(p.tw)}
        </text>
      </g>
      {/* commutation branch: auxiliary thyristor TA and capacitor C */}
      <g {...part('comm', 'Commutation branch')} opacity={com ? 1 : 0.35}>
        <rect x={214} y={18} width={100} height={36} className="cpart-hit" />
        <path d="M232 28 V44 L248 36 Z" className={`sym-fill ${capOn ? 'sym-fill--on-d' : ''}`} />
        <line x1={248} x2={248} y1={28} y2={44} className="sym" />
        <path d="M226 36 H232 M248 36 H262" className="sym" />
        <line x1={290} x2={290} y1={24} y2={48} className="sym" />
        <line x1={304} x2={304} y1={24} y2={48} className="sym" />
        <text x={240} y={16} textAnchor="middle" className="cvalue">
          TA
        </text>
        <text x={344} y={30} className="cvalue">
          C {formatSI(p.c, 'F')}
        </text>
        {live && com && (
          <text x={344} y={46} className="cvalue">
            vC {formatV(st.vc)}
          </text>
        )}
      </g>
      {/* freewheeling diode: anode at the bottom rail, cathode at the load node */}
      <g {...part('dfw', `Freewheeling diode ${fw ? 'ON' : 'OFF'}`)}>
        <rect x={408} y={124} width={44} height={36} className="cpart-hit" />
        <path d="M418 154 H442 L430 130 Z" className={`sym-fill ${fw ? 'sym-fill--on-d' : ''}`} />
        <line x1={418} x2={442} y1={130} y2={130} className="sym" />
        <text x={404} y={146} className="clabel" textAnchor="end">
          Dfw
        </text>
        {live && fw && (
          <text x={404} y={161} className="cvalue" textAnchor="end">
            {formatA(st.ifw)}
          </text>
        )}
      </g>
      {/* load */}
      <g {...part('load', 'Load R + L')}>
        <rect x={522} y={92} width={36} height={134} className="cpart-hit" />
        <path d={resistor} className="sym" />
        <path d={coil} className="sym sym--coil" />
        <text x={562} y={118} className="clabel">
          R
        </text>
        <text x={562} y={134} className="cvalue">
          {formatSI(st.r, 'Ω')}
        </text>
        <text x={562} y={186} className="clabel">
          L
        </text>
        <text x={562} y={202} className="cvalue">
          {formatSI(p.l, 'H')}
        </text>
        {live && (
          <text x={562} y={218} className="cvalue cvalue--out">
            {formatA(st.il)}
          </text>
        )}
      </g>
      <text x={345} y={262} className="path-caption" textAnchor="middle">
        {TEST_NAME[p.test]}: {st.phase}
        {live && ` · q/Qc ${st.qn.toFixed(2)}`}
      </text>
    </svg>
  )
}

export const SCR_TOPIC: Topic<ScrParams, ScrRun, ScrMeasurements, ScrView> = {
  id: 'scr',
  label: 'SCR',
  title: 'Thyristor (SCR): latching and turn-off',
  defaults: SCR_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'test',
      label: 'Test',
      options: [
        { value: 'latch', label: 'Latch', title: 'Fire the SCR into an R-L load: turn-on delay and latching' },
        { value: 'hold', label: 'Hold', title: 'After latching, raise the load resistance: does it stay on?' },
        { value: 'commutate', label: 'Turn-off', title: 'Force the current to zero with a charged capacitor: tc vs tq' },
      ],
    },
    { kind: 'number', key: 'tw', label: 'Gate pulse width tw', unit: 'µs', scale: 1e-6, min: L.tw.min, max: L.tw.max, log: true },
    { kind: 'number', key: 'l', label: 'Load inductance L', unit: 'mH', scale: 1e-3, min: L.l.min, max: L.l.max, log: true },
    { kind: 'number', key: 'c', label: 'Commutation capacitor C', unit: 'µF', scale: 1e-6, min: L.c.min, max: L.c.max, log: true, when: (p) => p.test === 'commutate' },
    { kind: 'number', key: 'tcom', label: 'Commutation instant', unit: 'µs', scale: 1e-6, min: L.tcom.min, max: L.tcom.max, log: true, when: (p) => p.test === 'commutate' },
    { kind: 'number', key: 'r2', label: 'Load resistance after the step R2', unit: 'Ω', min: L.r2.min, max: L.r2.max, log: true, when: (p) => p.test === 'hold' },
    { kind: 'number', key: 'vs', label: 'Supply V', unit: 'V', min: L.vs.min, max: L.vs.max, log: true },
  ],
  advanced: [
    { kind: 'number', key: 'r', label: 'Load resistance R', unit: 'Ω', min: L.r.min, max: L.r.max, log: true },
    { kind: 'number', key: 'ig', label: 'Gate current IG', unit: 'mA', scale: 1e-3, min: L.ig.min, max: L.ig.max, log: true },
    { kind: 'number', key: 'igt', label: 'Gate trigger current IGT', unit: 'mA', scale: 1e-3, min: L.igt.min, max: L.igt.max, log: true },
    { kind: 'number', key: 'il', label: 'Latching current IL', unit: 'mA', scale: 1e-3, min: L.il.min, max: L.il.max, log: true },
    { kind: 'number', key: 'ih', label: 'Holding current IH', unit: 'mA', scale: 1e-3, min: L.ih.min, max: L.ih.max, log: true },
    { kind: 'number', key: 'tau', label: 'Carrier lifetime τ', unit: 'µs', scale: 1e-6, min: L.tau.min, max: L.tau.max, log: true },
    { kind: 'number', key: 'vt0', label: 'On-state threshold VT0', unit: 'V', min: L.vt0.min, max: L.vt0.max, step: 0.05 },
    { kind: 'number', key: 'rt', label: 'On-state resistance rT', unit: 'mΩ', scale: 1e-3, min: L.rt.min, max: L.rt.max, log: true },
    { kind: 'number', key: 't2', label: 'Resistance step at t2', unit: 'µs', scale: 1e-6, min: L.t2.min, max: L.t2.max, log: true, when: (p) => p.test === 'hold' },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    return `Critical charge Qc = τ·IH = ${formatSI(p.qc, 'C')} · gate fires after td = τ·ln(IG/(IG − IGT)) = ${formatTime(gateDelay(p))} · shortest latching pulse ≈ ${formatTime(textbookScr(p).twMin)} · model: charge control with IL/IH thresholds, no SCR reverse recovery, no dv/dt or di/dt limits, ideal Dfw and TA`
  },
  simulate: (p) => simulateScr(p),
  measure: scrMeasured,
  state: scrStateAt,
  view: (st) => scrView(st),
  why: scrWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <ScrDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['ia', 'vak', 'q'],
  primaryChannels: ['ia'],
  addOrder: ['ig', 'ia', 'vak', 'q', 'il', 'ifw', 'ic', 'vc', 'vk'],
  shade: (r, k) => {
    const m = r.modes[k]
    if (m.startsWith('on') || m.startsWith('lat')) return 'rgba(57,135,229,0.10)'
    if (m.startsWith('rec')) return 'rgba(230,140,40,0.16)'
    return null
  },
  shadeLegend: 'blue band: the SCR conducts · orange band: current zero but q ≥ Qc (it can fire again)',
  eventLabel: scrEventLabel,
  eventWhy: scrEventWhy,
  eventColor: (e) => (e.kind === 'gate-on' || e.kind === 'gate-off' ? '#aeb7c5' : /rec\|.→lat/.test(e.device ?? '') ? '#e66767' : '#3987e5'),
  repeats: () => false,
  initialCursor: (r) => {
    const p = r.params
    const m = scrMeasured(r)
    if (p.test === 'commutate') return p.tcom + 0.5 * (m.tc ?? (p.tend - p.tcom) / 2)
    if (p.test === 'hold') return p.t2 + 0.5 * (m.tDrop ?? (p.tend - p.t2) / 2)
    return p.tg0 + (m.td ?? 0) + 0.5 * p.tw
  },
  periodName: 'test',
  badge: (r, m) => {
    const p = r.params
    return (
      <section className="dc-mode" aria-label="SCR test result">
        <div className="dc-mode-head">
          <span className="mode-pill mode-pill--ccm">{p.test === 'commutate' ? (m.refired ? 'FAILED' : 'COMMUTATED') : p.test === 'hold' ? (m.dropped ? 'DROPPED OUT' : 'HELD') : m.latched ? 'LATCHED' : 'NOT LATCHED'}</span>
          <span className="small">
            td {formatTime(m.td ?? NaN)} · iA at gate end {formatA(m.iaGateEnd)}
            <span className="muted"> · SIMULATION</span>
          </span>
        </div>
        <p className="muted small">
          {p.test === 'commutate'
            ? `IT ${formatA(m.iT)} · tc ${formatTime(m.tc ?? NaN)} · tq ${formatTime(m.tq ?? NaN)} · margin ${formatTime(m.margin ?? NaN)}`
            : p.test === 'hold'
              ? `current after the step ${formatA(m.dropped ? (m.iDrop ?? NaN) : m.iEnd)} · ${m.dropped ? `dropped out after ${formatTime(m.tDrop ?? NaN)}` : 'still on at the end of the run'}`
              : `reached IL after ${formatTime(m.tLatch ?? NaN)} · pulse ${formatTime(p.tw)}`}
        </p>
      </section>
    )
  },
  summary: (r, m) =>
    r.params.test === 'commutate'
      ? `${m.refired ? 'Commutation FAILED' : 'Turned off'}: tc ${formatTime(m.tc ?? NaN)} vs tq ${formatTime(m.tq ?? NaN)} (SIMULATION)`
      : r.params.test === 'hold'
        ? `${m.dropped ? 'Dropped out' : 'Held'} at ${formatA(m.dropped ? (m.iDrop ?? NaN) : m.iEnd)} (SIMULATION)`
        : `${m.latched ? 'Latched' : 'Did not latch'}: iA ${formatA(m.iaGateEnd)} at the gate end (SIMULATION)`,
  readings: (m, r) => scrReadings(m, r),
  status: (st) => scrStatus(st),
  nextConsequence: (r, st, m) => scrNext(r, st, m),
  next: (r, st, m) => scrNext(r, st, m)?.text ?? null,
  path: (st) => scrPath(st),
  energyModel: (st, _m, r) => scrEnergyModel(st, r),
  analysis: SCR_ANALYSIS,
  parts: SCR_PARTS,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'scr')
      return {
        title: 'Thyristor (SCR)',
        role: 'A latching switch: a gate pulse turns it on, but only a current below IH (or forced to zero for longer than tq) turns it off.',
        rows: [
          ['State now', st.s === 'off' ? 'OFF' : st.s === 'on' ? 'ON (held by the gate)' : st.s === 'lat' ? 'ON (latched)' : 'OFF, still charged'],
          ['iA / vAK', `${formatA(st.ia)} / ${formatV(st.vak)}`],
          ['Stored charge q/Qc', st.qn.toFixed(3)],
          ['IGT / IL / IH', `${formatA(p.igt)} / ${formatA(p.il)} / ${formatA(p.ih)}`],
          ['Lifetime τ, Qc', `${formatTime(p.tau)}, ${formatSI(p.qc, 'C')}`],
          ['td (SIMULATION)', formatTime(m.td ?? NaN)],
        ],
      }
    if (part === 'gate')
      return {
        title: 'Gate driver',
        role: 'A current pulse into the gate. It must exceed IGT and last until the anode current reaches IL.',
        rows: [
          ['Gate current now', formatA(st.ig)],
          ['Pulse', `${formatA(p.ig)} for ${formatTime(p.tw)}`],
          ['Shortest latching pulse (theory)', formatTime(gateDelay(p) + rlTimeTo(p, p.il))],
        ],
      }
    if (part === 'comm')
      return {
        title: 'Commutation branch',
        role: 'The auxiliary thyristor TA connects C, pre-charged to −V, across the SCR: the SCR current drops to zero and it stays reverse biased for tc ≈ C·V/IT.',
        rows: [
          ['Used in this test', p.test === 'commutate' ? 'yes' : 'no'],
          ['C / pre-charge', `${formatSI(p.c, 'F')} / −${formatV(p.vc0, false)}`],
          ['vC / iC now', `${formatV(st.vc)} / ${formatA(st.ic)}`],
          ['tc / tq (SIMULATION)', `${formatTime(m.tc ?? NaN)} / ${formatTime(m.tq ?? NaN)}`],
        ],
      }
    if (part === 'dfw') return { title: 'Freewheeling diode', role: 'Gives the load inductance a path when the SCR is off.', rows: [['State now', st.ifw > 1e-9 ? 'ON' : 'OFF'], ['Current', formatA(st.ifw)]] }
    if (part === 'load')
      return {
        title: 'R-L load',
        role: 'The inductance makes the anode current rise slowly after firing: i = (V − VT0)/R′·(1 − e^(−tR′/L)).',
        rows: [
          ['R now / L', `${formatSI(st.r, 'Ω')} / ${formatSI(p.l, 'H')}`],
          ['L/R', formatTime(p.l / st.r)],
          ['Current now', formatA(st.il)],
        ],
      }
    return { title: 'DC supply', role: 'Forward-biases the SCR and drives the load.', rows: [['V', formatV(p.vs, false)]] }
  },
  analyze: {
    compare: compareScr,
    theory: () => (
      <>
        <h3>The SCR as a charge-controlled latch</h3>
        <ol className="derivation">
          <li>
            <b>Stored charge</b> — <span className="mono">dq/dt = iA + (IH/IGT)·iG − q/τ</span>; the transistor pair regenerates when <span className="mono">q ≥ Qc = τ·IH</span>.
          </li>
          <li>
            <b>Firing</b> — from q = 0 with a gate current IG: <span className="mono">q = (IH/IGT)·IG·τ·(1 − e^(−t/τ))</span> reaches Qc after <span className="mono">td = τ·ln(IG/(IG − IGT))</span>; IG ≤ IGT never fires.
          </li>
          <li>
            <b>Latching</b> — the anode current rises as <span className="mono">i(t) = (V − VT0)/R′·(1 − e^(−tR′/L))</span>, R′ = R + rT; the SCR latches if <span className="mono">i(tw − td) ≥ IL</span>, otherwise it turns off when the gate ends.
          </li>
          <li>
            <b>Holding</b> — latched, it stays on while q ≥ Qc; in steady state q = τ·iA, so while <span className="mono">iA &gt; IH</span>. After a step to I2 &lt; IH it drops out after <span className="mono">τ·ln((I1 − I2)/(IH − I2))</span>.
          </li>
          <li>
            <b>Forced commutation</b> — C (at −V) across the SCR: iA = 0, <span className="mono">q = q0·e^(−t/τ)</span>, so <span className="mono">tq = τ·ln(q0/Qc) ≈ τ·ln(IT/IH)</span>; C charges with the load current, <span className="mono">tc ≈ C·V/IT</span>. It turns off only if <span className="mono">tc &gt; tq</span>.
          </li>
        </ol>
        <p className="small">The exact THEORY solves the same piecewise-linear circuit analytically (matrix exponential) and finds every state change exactly; the textbook column shows the closed forms above with their simplifications.</p>
      </>
    ),
    convergence: ['td', 'tLatch'],
  },
  lessons: SCR_LESSONS,
  experiments: SCR_EXPERIMENTS,
  predictions: scrPredictions,
  measureLabels: {
    td: { label: 'Turn-on delay td', fmt: (v) => formatTime(v) },
    tLatch: { label: 'Gate start → iA = IL', fmt: (v) => formatTime(v) },
    iaGateEnd: { label: 'iA at the gate end', fmt: (v) => formatA(v) },
    latchFlag: { label: 'Latched', fmt: (v) => (v ? 'yes' : 'no') },
    iT: { label: 'On-state current IT', fmt: (v) => formatA(v) },
    vT: { label: 'On-state voltage', fmt: (v) => formatV(v, false) },
    q0n: { label: 'Stored charge q0/Qc at commutation', fmt: (v) => v.toFixed(1) },
    tc: { label: 'Circuit turn-off time tc', fmt: (v) => formatTime(v) },
    tq: { label: 'Device turn-off time tq', fmt: (v) => formatTime(v) },
    tqRun: { label: 'tq seen in the run', fmt: (v) => formatTime(v) },
    margin: { label: 'Margin tc − tq', fmt: (v) => formatTime(v) },
    refireFlag: { label: 'Fired again', fmt: (v) => (v ? 'yes' : 'no') },
    iDrop: { label: 'Current at the drop-out', fmt: (v) => formatA(v) },
    tDrop: { label: 'Drop-out after the step', fmt: (v) => formatTime(v) },
    dropFlag: { label: 'Dropped out', fmt: (v) => (v ? 'yes' : 'no') },
    iaPeak: { label: 'Peak anode current', fmt: (v) => formatA(v) },
    vkPeak: { label: 'Peak load voltage', fmt: (v) => formatV(v, false) },
  },
}
