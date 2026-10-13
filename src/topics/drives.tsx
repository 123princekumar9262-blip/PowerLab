import { compareDrive, DRIVE_DEFAULTS, DRIVE_EXPERIMENTS, DRIVE_LESSONS, driveEventLabel, driveEventWhy, drivePredictions, driveStateAt, driveView, driveWhy, measureDrive, simulateDrive, type DriveState } from '../converters/drives/content.ts'
import { averagedSteady, DRIVE_LIMITS as L, rpm, type DriveMeasurements, type DriveParams, type DriveRun } from '../converters/drives/motor.ts'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import type { CurrentPath } from '../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import { driveReadings } from './readings.ts'

const CH: Record<string, ChannelMeta> = {
  n: { id: 'n', label: 'n', name: 'Speed [rpm]', unit: '', color: '#199e70', group: 'Speed' },
  ia: { id: 'ia', label: 'ia', name: 'Armature current', unit: 'A', color: '#e66767', group: 'Current' },
  va: { id: 'va', label: 'va', name: 'Armature terminal voltage', unit: 'V', color: '#3987e5', group: 'Voltage' },
  e: { id: 'e', label: 'E', name: 'Back-EMF k·ω', unit: 'V', color: '#9085e9', dash: [6, 4], group: 'Voltage' },
  te: { id: 'te', label: 'Te', name: 'Motor torque k·ia [N·m]', unit: '', color: '#d95926', group: 'Torque' },
  tl: { id: 'tl', label: 'TL', name: 'Load torque [N·m]', unit: '', color: '#aeb7c5', dash: [6, 4], group: 'Torque' },
  gate: { id: 'gate', label: 'Gate', name: 'PWM gate of Q1', unit: '', color: '#aeb7c5', group: 'Gate', logic: true },
  duty: { id: 'duty', label: 'd', name: 'Duty ratio', unit: '', color: '#c98500', group: 'Duty' },
  iin: { id: 'iin', label: 'iin', name: 'Supply current', unit: 'A', color: '#d55181', dash: [2, 3], group: 'Current' },
  pin: { id: 'pin', label: 'Pin', name: 'Power from the supply', unit: 'W', color: '#d55181', group: 'Power' },
}

/** Largest |x| of a simulated signal (cached per array): the scale below which a branch counts as carrying no current. */
const PEAK = new WeakMap<object, number>()
function peakAbs(a: ArrayLike<number>): number {
  let v = PEAK.get(a)
  if (v === undefined) {
    v = 0
    for (let k = 0; k < a.length; k++) v = Math.max(v, Math.abs(a[k]))
    PEAK.set(a, v)
  }
  return v
}

/**
 * Animated conventional-current loop at the cursor, read from the simulated state: which device conducts
 * (st.device, from the simulated mode, gate and sign of ia) and the sign of ia. Segments run on the wires
 * only (device and component bodies are skipped). Returns the path strings in the direction of flow.
 */
function driveFlow(st: DriveState, r: DriveRun): { wires: string[]; shaft: string | null } {
  const p = r.params
  const iFloor = 1e-3 * peakAbs(r.signals.ia)
  if (st.device === 'none' || Math.abs(st.ia) <= iFloor) return { wires: [], shaft: null }
  const pos = st.ia > 0
  // armature branch: switch node → Ra → La → motor → bottom rail (reversed when ia < 0)
  const arm = pos ? ['M200 135 H250', 'M300 135 H330', 'M410 135 H480 V156', 'M480 204 V230 H200'] : ['M200 230 H480 V204', 'M480 156 V135 H410', 'M330 135 H300', 'M250 135 H200']
  const two = p.bridge === '2q'
  let dev: string[] = []
  if (st.device === 'Q1') dev = ['M200 230 H60 V146', 'M60 124 V40 H200 V70', 'M200 110 V135']
  else if (st.device === 'D2') dev = two ? ['M200 230 V200 H226 V196', 'M226 170 V162 H200 V135'] : ['M200 230 V200', 'M200 170 V135']
  else if (st.device === 'D1') dev = ['M60 146 V230 H200', 'M200 135 V106 H226 V100', 'M226 84 V74 H200 V40 H60 V124']
  else if (st.device === 'Q2') dev = ['M200 135 V160', 'M200 200 V230']
  // shaft: mechanical power k·ia·ω flows motor → load when positive, load → motor when negative
  const wFloor = 1e-3 * peakAbs(r.signals.w)
  const pm = st.e * st.ia
  const shaft = Math.abs(st.w) > wFloor ? (pm >= 0 ? 'M506 180 H580' : 'M580 180 H506') : null
  return { wires: [...dev, ...arm], shaft }
}

function drivePath(st: DriveState, r: DriveRun): CurrentPath {
  const low = r.params.bridge === '1q' ? 'D' : st.device
  switch (st.device) {
    case 'Q1':
      return { elements: ['vdc', 'q1', 'ra', 'la', 'motor'], text: `Vdc+ → Q1 → Ra → La → motor → Vdc− (${formatA(st.ia)})`, reasons: [] }
    case 'D2':
      return { elements: ['low', 'ra', 'la', 'motor'], text: `${low} → Ra → La → motor → ${low}: freewheeling, va ≈ 0 V (${formatA(st.ia)})`, reasons: [] }
    case 'D1':
      return { elements: ['motor', 'la', 'ra', 'q1', 'vdc'], text: `motor → La → Ra → D1 → Vdc+ … Vdc− → motor: energy back to the supply (${formatA(st.ia, true)})`, reasons: [] }
    case 'Q2':
      return { elements: ['motor', 'la', 'ra', 'low'], text: `motor → La → Ra → Q2 → motor: the back-EMF drives the braking current (${formatA(st.ia, true)})`, reasons: [] }
    default:
      return { elements: [], text: 'no current: the armature current is zero at this instant', reasons: [] }
  }
}

function DriveDiagram({ st, r, selected, onSelect, values, live, showPath }: { st: DriveState; r: DriveRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath: boolean }) {
  const p = r.params
  const flow = showPath ? driveFlow(st, r) : { wires: [], shaft: null }
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
  const up = st.device === 'Q1' || st.device === 'D1'
  const low = st.device === 'D2' || st.device === 'Q2'
  // with the current path shown, the moving dashes carry the information: the static wires stay plain underneath
  const cls = (on: boolean, diode: boolean) => `wire ${on && !showPath ? (diode ? 'wire--diode' : 'wire--igbt') : ''}`
  const loopOn = st.device !== 'none'
  const upDiode = st.device === 'D1'
  const lowDiode = st.device === 'D2'
  const coil = `M330 135 ${Array.from({ length: 4 }, () => 'a10 10 0 0 1 20 0').join(' ')}`
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`DC motor drive: ${st.phase}`}>
      {/* rails and loop */}
      <path d="M60 40 H200 V70" className={cls(up, upDiode)} />
      <path d="M200 110 V160" className={cls(up || low, up ? upDiode : lowDiode)} />
      <path d="M200 135 H250" className={cls(loopOn, !up && lowDiode)} />
      <path d="M300 135 H330 M410 135 H480 V156" className={cls(loopOn, !up && lowDiode)} />
      <path d="M480 204 V230 H60" className={cls(loopOn, !up && lowDiode)} />
      <path d="M200 200 V230" className={cls(low, lowDiode)} />
      <path d="M60 40 V120 M60 150 V230" className={cls(up, upDiode)} />
      {/* DC supply */}
      <g {...part('vdc', `Supply ${p.vdc} V`)}>
        <rect x={40} y={115} width={40} height={40} className="cpart-hit" />
        <rect x={42} y={124} width={36} height={22} className="gap-mask" />
        <line x1={44} x2={76} y1={128} y2={128} className="sym" />
        <line x1={51} x2={69} y1={140} y2={140} className="sym sym--thick" />
        <text x={86} y={160} className="cvalue">
          Vdc {formatV(p.vdc, false)}
        </text>
      </g>
      {/* upper switch Q1 (with D1 in the 2Q bridge) */}
      <g {...part('q1', `Q1 ${st.gate ? 'gated' : 'off'}`)}>
        <rect x={176} y={66} width={70} height={48} className="cpart-hit" />
        <line x1={190} x2={190} y1={74} y2={106} className="sym sym--thick" />
        <line x1={198} x2={198} y1={72} y2={108} className={`sym ${st.device === 'Q1' ? 'sym--on-q' : ''}`} strokeDasharray={st.gate ? undefined : '5 4'} />
        <path d="M198 78 H200 V70 M198 102 H200 V110" className="sym" />
        <text x={168} y={86} className="clabel" textAnchor="end">
          Q1
        </text>
        <text x={168} y={102} className="cvalue" textAnchor="end">
          {st.gate ? 'ON' : 'OFF'}
        </text>
        {p.bridge === '2q' && (
          <>
            <path d="M226 74 V106 M216 100 H236 L226 84 Z" className={`sym-fill ${st.device === 'D1' ? 'sym-fill--on-d' : ''}`} />
            <line x1={216} x2={236} y1={84} y2={84} className="sym" />
            <path d="M200 74 H226 M200 106 H226" className="wire wire--thin" />
            <text x={240} y={96} className="cvalue">
              D1
            </text>
          </>
        )}
      </g>
      {/* lower device: freewheeling diode (1Q) or Q2 + D2 (2Q) */}
      <g {...part('low', p.bridge === '1q' ? `Freewheeling diode ${st.device === 'D2' ? 'ON' : 'OFF'}` : 'Lower switch Q2 and diode D2')}>
        <rect x={150} y={156} width={100} height={48} className="cpart-hit" />
        {p.bridge === '1q' ? (
          <>
            <path d="M188 196 H212 L200 170 Z" className={`sym-fill ${st.device === 'D2' ? 'sym-fill--on-d' : ''}`} />
            <line x1={188} x2={212} y1={170} y2={170} className="sym" />
            <path d="M200 160 V170 M200 196 V200" className="wire" />
            <text x={168} y={186} className="clabel" textAnchor="end">
              D
            </text>
          </>
        ) : (
          <>
            <line x1={190} x2={190} y1={166} y2={198} className="sym sym--thick" />
            <line x1={198} x2={198} y1={164} y2={200} className={`sym ${st.device === 'Q2' ? 'sym--on-q' : ''}`} strokeDasharray={!st.gate ? undefined : '5 4'} />
            <path d="M198 170 H200 V160 M198 194 H200 V200" className="sym" />
            <text x={168} y={186} className="clabel" textAnchor="end">
              Q2
            </text>
            <path d="M216 196 H236 L226 170 Z" className={`sym-fill ${st.device === 'D2' ? 'sym-fill--on-d' : ''}`} />
            <line x1={216} x2={236} y1={170} y2={170} className="sym" />
            <path d="M200 162 H226 V170 M226 196 V200 H200" className="wire wire--thin" />
            <text x={240} y={188} className="cvalue">
              D2
            </text>
          </>
        )}
      </g>
      {/* moving conventional current, from the simulated state at the cursor (drawn over the device stubs, on wires only) */}
      {flow.wires.map((d) => (
        <path key={d} d={d} className="wire wire--flow" pointerEvents="none" />
      ))}
      {values && (
        <text x={210} y={154} className="cvalue cvalue--strong">
          va {formatV(st.va)}
        </text>
      )}
      {/* armature: Ra, La, E */}
      <g {...part('ra', `Armature resistance ${p.ra} Ω`)}>
        <rect x={246} y={120} width={58} height={30} className="cpart-hit" />
        <rect x={252} y={128} width={44} height={14} rx={2} className="sym-body" />
        <text x={274} y={118} className="cvalue" textAnchor="middle">
          Ra {formatSI(p.ra, 'Ω')}
        </text>
      </g>
      <g {...part('la', `Armature inductance ${formatSI(p.la, 'H')}`)}>
        <rect x={326} y={110} width={88} height={34} className="cpart-hit" />
        <path d={coil} className="sym sym--coil" />
        <text x={370} y={108} className="cvalue" textAnchor="middle">
          La {formatSI(p.la, 'H')}
        </text>
        {values && (
          <text x={370} y={162} className="cvalue cvalue--il" textAnchor="middle">
            ia {formatA(st.ia, true)}
          </text>
        )}
      </g>
      <g {...part('motor', `Motor, ${st.n.toFixed(0)} rpm`)}>
        <rect x={450} y={150} width={60} height={60} className="cpart-hit" />
        <circle cx={480} cy={180} r={24} className="sym-body" />
        <text x={480} y={186} textAnchor="middle" className="clabel">
          M
        </text>
        {live && (
          <text x={448} y={176} textAnchor="end" className="cvalue">
            E {formatV(st.e)}
          </text>
        )}
        {values && (
          <text x={448} y={192} textAnchor="end" className="cvalue cvalue--out">
            {st.n.toFixed(0)} rpm
          </text>
        )}
      </g>
      {/* shaft and load */}
      <path d="M504 176 H580 M504 184 H580" className="wire wire--thin" />
      {flow.shaft && <path d={flow.shaft} className="wire wire--flow" pointerEvents="none" />}
      <g {...part('load', `Load torque ${st.tl} N·m`)}>
        <rect x={576} y={156} width={80} height={48} className="cpart-hit" />
        <rect x={582} y={162} width={64} height={36} rx={6} className="sym-body" />
        <text x={614} y={178} textAnchor="middle" className="clabel">
          load
        </text>
        {live && (
          <text x={614} y={192} textAnchor="middle" className="cvalue">
            {st.tl.toFixed(2)} N·m
          </text>
        )}
      </g>
      <text x={540} y={168} textAnchor="middle" className="cvalue">
        J, B
      </text>
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {st.phase}{live ? ` · Te ${st.te.toFixed(3)} N·m` : ''} · {p.bridge === '1q' ? 'one-quadrant chopper' : 'two-quadrant chopper'}
      </text>
    </svg>
  )
}

function DriveEnergy({ m, r }: { m: DriveMeasurements; r: DriveRun }) {
  const p = r.params
  if (p.view === 'steady') {
    const flows = [
      { label: 'Supply → motor', w: m.pin },
      { label: 'copper loss Ra·I²rms', w: m.pcu },
      { label: 'friction B·ω²', w: m.pfr },
      { label: 'shaft → load TL·ω', w: m.pshaft },
    ]
    const max = Math.max(...flows.map((f) => Math.abs(f.w)), 1e-12)
    return (
      <section className="dc-energy" aria-label="Power flow">
        <h3 className="eyebrow">Mean power over a period (SIMULATION)</h3>
        <ul className="eflows">
          {flows.map((f) => (
            <li key={f.label}>
              <span className="eflow-label">{f.label}</span>
              <span className="eflow-bar">
                <span style={{ width: `${(100 * Math.abs(f.w)) / max}%` }} />
              </span>
              <span className="eflow-value">{formatW(f.w)}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Efficiency (load power / supply power): {m.eff === null ? '—' : `${(m.eff * 100).toFixed(1)} %`}. The switches are ideal here: every loss is in Ra or in friction.
        </p>
      </section>
    )
  }
  const items = [
    { label: 'Supply delivered', w: m.ein },
    { label: 'stored in the rotor ½·J·ω²', w: m.ekin },
    { label: 'heat in Ra', w: m.ecu },
    { label: 'to the load', w: m.eload },
    { label: 'friction', w: m.efr },
    { label: 'stored in La', w: m.emag },
  ]
  const max = Math.max(...items.map((f) => Math.abs(f.w)), 1e-12)
  return (
    <section className="dc-energy" aria-label="Energy over the run">
      <h3 className="eyebrow">Energy over the whole run (SIMULATION)</h3>
      <ul className="eflows">
        {items.map((f) => (
          <li key={f.label}>
            <span className="eflow-label">{f.label}</span>
            <span className="eflow-bar">
              <span style={{ width: `${(100 * Math.abs(f.w)) / max}%` }} />
            </span>
            <span className="eflow-value">{formatSI(f.w, 'J')}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {m.eregen > 0 ? `Returned to the supply while braking: ${formatSI(m.eregen, 'J')} (already netted in "supply delivered"). ` : ''}Balance: supply = stored + heat + load + friction, residual {(Math.abs(m.balance) * 100).toFixed(3)} %
        (the trapezoidal sums of the sampled waveforms).
      </p>
    </section>
  )
}

export const DRIVE_TOPIC: Topic<DriveParams, DriveRun, DriveMeasurements, DriveState> = {
  id: 'dcmotor',
  label: 'DC motor drive',
  title: 'DC motor fed by a PWM chopper',
  defaults: DRIVE_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'bridge',
      label: 'Chopper',
      options: [
        { value: '1q', label: 'One-quadrant', title: 'One switch and a freewheeling diode: the current cannot reverse' },
        { value: '2q', label: 'Two-quadrant', title: 'A half bridge: the current can reverse — regenerative braking' },
      ],
    },
    { kind: 'number', key: 'duty', label: 'Duty ratio d', unit: '%', scale: 0.01, min: L.duty.min, max: L.duty.max, step: 1 },
    { kind: 'number', key: 'tl', label: 'Load torque TL', unit: 'N·m', min: L.tl.min, max: L.tl.max, step: 0.01 },
    {
      kind: 'choice',
      key: 'event',
      label: 'Step during the run',
      options: [
        { value: 'none', label: 'None' },
        { value: 'load', label: 'Load step', title: 'The load torque changes half-way through the run' },
        { value: 'duty', label: 'Duty step', title: 'The duty changes half-way through the run' },
      ],
      when: (p) => p.view === 'startup',
    },
    { kind: 'number', key: 'tl2', label: 'Load torque after the step', unit: 'N·m', min: L.tl2.min, max: L.tl2.max, step: 0.01, when: (p) => p.view === 'startup' && p.event === 'load' },
    { kind: 'number', key: 'd2', label: 'Duty after the step', unit: '%', scale: 0.01, min: L.d2.min, max: L.d2.max, step: 1, when: (p) => p.view === 'startup' && p.event === 'duty' },
  ],
  advanced: [
    { kind: 'number', key: 'vdc', label: 'Supply voltage Vdc', unit: 'V', min: L.vdc.min, max: L.vdc.max, log: true },
    { kind: 'number', key: 'fs', label: 'Switching frequency', unit: 'kHz', scale: 1e3, min: L.fs.min, max: L.fs.max, log: true },
    { kind: 'number', key: 'ra', label: 'Armature resistance Ra', unit: 'Ω', min: L.ra.min, max: L.ra.max, log: true },
    { kind: 'number', key: 'la', label: 'Armature inductance La', unit: 'mH', scale: 1e-3, min: L.la.min, max: L.la.max, log: true },
    { kind: 'number', key: 'ke', label: 'Motor constant k', unit: 'V·s/rad', min: L.ke.min, max: L.ke.max, log: true },
    { kind: 'number', key: 'j', label: 'Inertia J', unit: 'kg·cm²', scale: 1e-4, min: L.j.min, max: L.j.max, log: true },
    { kind: 'number', key: 'b', label: 'Viscous friction B', unit: 'mN·m·s', scale: 1e-3, min: L.b.min, max: L.b.max, step: 0.001 },
    { kind: 'number', key: 'tramp', label: 'Soft-start ramp', unit: 'ms', scale: 1e-3, min: L.tramp.min, max: L.tramp.max, step: 1, when: (p) => p.view === 'startup' },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    const av = averagedSteady(p, p.duty, p.tl)
    return `τe = La/Ra = ${formatTime(p.tauE)} · τm = J·Ra/k² = ${formatTime(p.tauM)} · averaged speed ${rpm(av.w).toFixed(0)} rpm${p.view === 'steady' ? ' · steady state ignores the step and the soft start' : ` · window ${formatTime(p.duration)}`}`
  },
  viewKey: 'view',
  simulate: (p) => simulateDrive(p),
  measure: measureDrive,
  state: driveStateAt,
  view: (st, r) => driveView(st, r),
  why: driveWhy,
  path: (st, r) => drivePath(st, r),
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <DriveDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['n', 'ia', 'va'],
  addOrder: ['n', 'ia', 'va', 'e', 'te', 'tl', 'gate', 'duty', 'iin', 'pin'],
  shade: (r, k) => (r.modes[k] === 'z' ? 'rgba(174,183,197,0.22)' : r.signals.ia[k] < 0 ? 'rgba(34,177,76,0.12)' : null),
  shadeLegend: 'grey band: zero current (discontinuous) · green band: negative current (braking)',
  eventLabel: driveEventLabel,
  eventWhy: driveEventWhy,
  eventColor: (e) => (e.kind === 'il-zero' ? '#aeb7c5' : e.device === 'peak' ? '#e66767' : '#3987e5'),
  initialCursor: (r) => (r.params.view === 'steady' ? r.params.period * (1 + 0.5 * r.params.duty) : r.events.find((e) => e.device === 'peak')?.time ?? 0),
  periodName: 'period',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Operating point">
      <div className="dc-mode-head">
        <span className={`mode-pill ${m.dcm ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>{m.dcm ? 'DCM' : 'CCM'}</span>
        <span className="small">
          {m.nEnd.toFixed(0)} rpm · ī {formatA(m.iEnd)} · ΔI {formatA(m.ripple)}
          <span className="muted"> · SIMULATION{r.params.view === 'startup' ? (m.settled ? ', settled' : ', still settling') : ''}</span>
        </span>
      </div>
      {r.params.view === 'startup' && (
        <p className="muted small">
          peak {formatA(m.iPeak)} · t90 {m.t90 === null ? '—' : formatTime(m.t90)}
          {r.params.bridge === '2q' && m.iNeg < 0 ? ` · braking ${formatA(m.iNeg, true)}, returned ${formatSI(m.eregen, 'J')}` : ''}
        </p>
      )}
    </section>
  ),
  summary: (_r, m) => `${m.nEnd.toFixed(0)} rpm · ${formatA(m.iEnd)} (SIMULATION)`,
  energy: (_st, m, r) => <DriveEnergy m={m} r={r} />,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'motor')
      return {
        title: 'DC motor',
        role: 'Converts current into torque (Te = k·ia) and speed into voltage (E = k·ω) — the same constant k both ways.',
        rows: [
          ['Speed now', `${st.n.toFixed(0)} rpm`],
          ['Back-EMF now', formatV(st.e)],
          ['Torque now', `${st.te.toFixed(3)} N·m`],
          ['k', `${p.ke} V·s/rad`],
          ['J, B', `${formatSI(p.j, 'kg·m²')}, ${formatSI(p.b, 'N·m·s')}`],
          ['Mechanical time constant J·Ra/k²', formatTime(p.tauM)],
        ],
      }
    if (part === 'ra' || part === 'la')
      return {
        title: 'Armature winding',
        role: 'Ra wastes power as heat; La smooths the current between the PWM pulses.',
        rows: [
          ['Ra', formatSI(p.ra, 'Ω')],
          ['La', formatSI(p.la, 'H')],
          ['τe = La/Ra', formatTime(p.tauE)],
          ['RMS current (last period)', formatA(m.irms)],
          ['Copper loss (last period)', formatW(m.pcu)],
        ],
      }
    if (part === 'q1' || part === 'low')
      return {
        title: part === 'q1' ? 'Upper switch Q1' : p.bridge === '1q' ? 'Freewheeling diode' : 'Lower switch Q2 + D2',
        role:
          part === 'q1'
            ? 'Connects the armature to the supply while gated: its duty sets the mean armature voltage.'
            : p.bridge === '1q'
              ? 'Gives the armature current a path while Q1 is off — but only in one direction.'
              : 'Switched opposite to Q1: lets the current flow in either direction, so the machine can brake.',
        rows: [
          ['Conducting now', st.device],
          ['Duty', `${(st.duty * 100).toFixed(1)} %`],
          ['Switching frequency', formatSI(p.fs, 'Hz')],
        ],
      }
    if (part === 'load') return { title: 'Mechanical load', role: 'A constant torque opposing the motor (like a hoist), plus viscous friction B·ω.', rows: [['Load torque now', `${st.tl} N·m`], ['Shaft power (last period)', formatW(m.pshaft)]] }
    return { title: 'DC supply', role: 'Delivers energy while Q1 conducts positive current; absorbs it when the current flows back (two-quadrant braking).', rows: [['Vdc', formatV(p.vdc, false)], ['Mean power (last period)', formatW(m.pin)], ['Returned while braking', formatSI(m.eregen, 'J')]] }
  },
  analyze: {
    compare: compareDrive,
    theory: (r) => {
      const p = r.params
      return (
        <>
          <h3>The DC motor and its chopper</h3>
          <ol className="derivation">
            <li>
              <b>Armature</b> — <span className="mono">La·dia/dt = va − Ra·ia − k·ω</span>, with va = Vdc while Q1 conducts and 0 V while the {p.bridge === '1q' ? 'diode freewheels' : 'lower device conducts'}.
            </li>
            <li>
              <b>Shaft</b> — <span className="mono">J·dω/dt = k·ia − B·ω − TL</span>: the motor torque against friction and load.
            </li>
            <li>
              <b>Averaged model</b> — replacing va by its mean d·Vdc gives a linear second-order system: steady speed <span className="mono">ω = (d·Vdc − Ra·TL/k)/(k + Ra·B/k)</span>, time constants τe = La/Ra ={' '}
              {formatTime(p.tauE)} and τm = J·Ra/k² = {formatTime(p.tauM)}.
            </li>
            <li>
              <b>Ripple</b> — with ω almost constant in a period, <span className="mono">ΔI ≈ Vdc·d·(1 − d)/(La·fs)</span>; a one-quadrant chopper enters discontinuous conduction when ī &lt; ΔI/2.
            </li>
          </ol>
          <p className="small">
            The exact THEORY solves the same piecewise-linear equations analytically (matrix exponential) and finds every current zero exactly; its period means come from integrals carried as extra states. The
            textbook column is the averaged model — no ripple, no discontinuous conduction.
          </p>
        </>
      )
    },
    convergence: ['n', 'ripple'],
  },
  lessons: DRIVE_LESSONS,
  experiments: DRIVE_EXPERIMENTS,
  predictions: drivePredictions,
  readings: driveReadings,
  measureLabels: {
    nEnd: { label: 'Speed', fmt: (v) => `${v.toFixed(0)} rpm` },
    iEnd: { label: 'Mean current', fmt: (v) => formatA(v) },
    ripple: { label: 'Current ripple', fmt: (v) => formatA(v) },
    vaEnd: { label: 'Mean armature voltage', fmt: (v) => formatV(v, false) },
    iPeak: { label: 'Peak current', fmt: (v) => formatA(v) },
  },
}
