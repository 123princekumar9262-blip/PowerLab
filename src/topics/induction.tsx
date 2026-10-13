import type { KeyboardEvent } from 'react'
import {
  compareInduction,
  imEventLabel,
  imEventWhy,
  imNextConsequence,
  imPath,
  imReadings,
  imStateAt,
  imStatus,
  imView,
  imWhy,
  INDUCTION_EXPERIMENTS,
  INDUCTION_LESSONS,
  inductionPredictions,
  measureInduction,
  type ImState,
  type InductionMeasurements,
} from '../converters/drives/inductionContent.ts'
import { INDUCTION_DEFAULTS, INDUCTION_LIMITS as L, simulateInduction, supplyVoltage, syncRpm, type InductionParams, type InductionRun } from '../converters/drives/induction.ts'
import { breakdown, inductionTheory, torqueSpeedCurve } from '../converters/drives/inductionTheory.ts'
import type { AnalysisCategory, ChannelMeta, InspectInfo, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import './induction.css'

const CH: Record<string, ChannelMeta> = {
  n: { id: 'n', label: 'n', name: 'Rotor speed [rpm]', unit: '', color: '#199e70', group: 'Speed' },
  nsync: { id: 'nsync', label: 'ns', name: 'Synchronous speed 120·f/P [rpm]', unit: '', color: '#199e70', dash: [6, 4], group: 'Speed' },
  ia: { id: 'ia', label: 'ia', name: 'Phase current a', unit: 'A', color: '#d55181', group: 'Current' },
  ib: { id: 'ib', label: 'ib', name: 'Phase current b', unit: 'A', color: '#c98500', group: 'Current' },
  ic: { id: 'ic', label: 'ic', name: 'Phase current c', unit: 'A', color: '#3987e5', dash: [6, 4], group: 'Current' },
  irms: { id: 'irms', label: 'Is', name: 'Stator current, RMS (from the space vector)', unit: 'A', color: '#e66767', group: 'Current' },
  irr: { id: 'irr', label: 'Ir', name: 'Rotor current (referred), RMS', unit: 'A', color: '#e66767', dash: [2, 3], group: 'Current' },
  te: { id: 'te', label: 'Te', name: 'Motor torque [N·m]', unit: '', color: '#d95926', group: 'Torque' },
  tl: { id: 'tl', label: 'TL', name: 'Load torque [N·m]', unit: '', color: '#aeb7c5', dash: [6, 4], group: 'Torque' },
  va: { id: 'va', label: 'va', name: 'Phase voltage a', unit: 'V', color: '#9085e9', group: 'Supply' },
  f: { id: 'f', label: 'f', name: 'Supply frequency [Hz]', unit: '', color: '#b8860b', group: 'Supply' },
  psi: { id: 'psi', label: '|ψs|', name: 'Stator flux linkage [Wb]', unit: '', color: '#2bb3c0', group: 'Flux' },
  slip: { id: 'slip', label: 's', name: 'Slip (1 = rotor at rest)', unit: '', color: '#199e70', dash: [2, 3], group: 'Slip' },
  pin: { id: 'pin', label: 'Pin', name: 'Input power (negative = returned)', unit: 'W', color: '#e66767', dash: [6, 3], group: 'Power' },
}

const PARTS = [
  { id: 'supply', label: 'Supply' },
  { id: 'stator', label: 'Stator windings' },
  { id: 'rotor', label: 'Cage rotor' },
  { id: 'load', label: 'Load and shaft' },
]

function partProps(id: string, label: string, selected: string | null, onSelect: (s: string) => void) {
  return {
    'data-part': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === id,
    className: `cpart ${selected === id ? 'cpart--sel' : ''}`,
    onClick: () => onSelect(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      }
    },
  }
}

const PHASE_WORD: Record<ImState['phase'], string> = { locked: 'rotor at rest', accelerating: 'accelerating', decelerating: 'slowing down', running: 'running', generating: 'generating' }

function MotorDiagram({ st, r, selected, onSelect, values, live, showPath }: { st: ImState; r: InductionRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath: boolean }) {
  const p = r.params
  const part = (id: string, label: string) => partProps(id, label, selected, onSelect)
  const gen = st.phase === 'generating'
  const flow = showPath ? (gen ? 'wire wire--diode' : 'wire wire--igbt') : 'wire'
  const cx = 390
  const cy = 122
  // the field pattern has p pole pairs: p arrows at the stator flux angle / p (+ k·2π/p), mechanical angles
  const arrows = Array.from({ length: p.pp }, (_, q) => st.thf / p.pp + (2 * Math.PI * q) / p.pp)
  const at = (a: number, rad: number) => [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const
  const bars = Array.from({ length: 12 }, (_, q) => r.signals.thr[st.k] + (2 * Math.PI * q) / 12)
  const lineY = [100, 122, 144]
  const isAt = [st.ia, st.ib, st.ic]
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Induction motor: ${PHASE_WORD[st.phase]}`}>
      {/* the three lines */}
      {lineY.map((y) => (
        <path key={y} d={`M150 ${y} H322`} className={flow} />
      ))}
      {['a', 'b', 'c'].map((ph, q) => (
        <text key={ph} x={162} y={lineY[q] - 5} className="cvalue">
          {ph}
          {values ? ` ${formatA(isAt[q], true)}` : ''}
        </text>
      ))}
      {/* supply */}
      <g {...part('supply', p.supply === 'dol' ? 'Mains supply' : 'V/f drive')}>
        <rect x={24} y={76} width={128} height={92} rx={8} className="cpart-hit" />
        <rect x={28} y={80} width={120} height={84} rx={6} className={`pblock ${st.vrms > 0 ? 'pblock--on' : ''}`} />
        <text x={88} y={102} textAnchor="middle" className="clabel">
          {p.supply === 'dol' ? 'mains 3~' : 'V/f drive'}
        </text>
        <path d="M70 122 q9 -12 18 0 t18 0" className="sym" />
        <text x={88} y={146} textAnchor="middle" className="cvalue">
          {p.supply === 'dol' ? `${p.vll.toFixed(0)} V · ${p.fr.toFixed(0)} Hz` : live ? `${st.f.toFixed(1)} Hz · ${formatV(st.vrms * Math.sqrt(3), false)}` : `→ ${p.f.toFixed(0)} Hz`}
        </text>
        {p.supply === 'vf' && (
          <text x={88} y={160} textAnchor="middle" className="cvalue">
            line-to-line
          </text>
        )}
      </g>
      {/* stator */}
      <g {...part('stator', 'Stator windings')}>
        <circle cx={cx} cy={cy} r={70} className="cpart-hit" />
        <circle cx={cx} cy={cy} r={62} className="sym-body" />
        <circle cx={cx} cy={cy} r={56} className="im-ring" />
        <circle cx={cx} cy={cy} r={42} className="gap-mask" />
        <text x={cx} y={cy - 74} textAnchor="middle" className="cvalue">
          stator · {2 * p.pp} poles
        </text>
      </g>
      {/* field arrows in the air gap */}
      {arrows.map((a, q) => {
        const [x0, y0] = at(a, 6)
        const [x1, y1] = at(a, 52)
        const [hx, hy] = at(a, 58)
        const [lx, ly] = at(a + 0.12, 47)
        const [rx, ry] = at(a - 0.12, 47)
        return (
          <g key={q} aria-hidden="true">
            <path d={`M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`} className="im-field" />
            <path d={`M${hx.toFixed(1)} ${hy.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)} L${rx.toFixed(1)} ${ry.toFixed(1)} Z`} className="im-field-head" />
          </g>
        )
      })}
      {/* rotor: cage bars and a mark that turns with the shaft */}
      <g {...part('rotor', 'Cage rotor')}>
        <circle cx={cx} cy={cy} r={38} className="cpart-hit" />
        <circle cx={cx} cy={cy} r={34} className="sym-fill" style={{ fillOpacity: 0.55 }} />
        {bars.map((a, q) => {
          const [x, y] = at(a, 29)
          return <circle key={q} cx={x} cy={y} r={2.6} className="im-bar" />
        })}
        {(() => {
          const [x1, y1] = at(r.signals.thr[st.k], 30)
          return <path d={`M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)}`} className="im-rotor-mark" />
        })()}
      </g>
      <text x={cx} y={cy + 82} textAnchor="middle" className="cvalue">
        <tspan style={{ fill: '#3987e5' }}>field</tspan>
        {live ? ` ${st.nsync.toFixed(0)} rpm · ` : ' · '}
        <tspan style={{ fill: '#d95926' }}>rotor</tspan>
        {live ? ` ${st.n.toFixed(0)} rpm` : ''}
      </text>
      {values && (
        <text x={cx} y={cy + 97} textAnchor="middle" className="cvalue cvalue--out">
          Te {st.te.toFixed(1)} N·m · s {(st.slip * 100).toFixed(2)} %
        </text>
      )}
      {/* shaft and load */}
      <path d={`M${cx + 62} ${cy - 4} H560 M${cx + 62} ${cy + 4} H560`} className="wire wire--thin" />
      <text x={505} y={cy - 12} textAnchor="middle" className="cvalue">
        J, B
      </text>
      <g {...part('load', `Load torque ${st.tl.toFixed(1)} N·m`)}>
        <rect x={556} y={92} width={104} height={60} className="cpart-hit" />
        <rect x={562} y={98} width={92} height={48} rx={6} className="sym-body" />
        <text x={608} y={118} textAnchor="middle" className="clabel">
          load
        </text>
        <text x={608} y={134} textAnchor="middle" className="cvalue">
          {st.tl.toFixed(1)} N·m
        </text>
      </g>
      <text x={345} y={252} className="path-caption" textAnchor="middle">
        {PHASE_WORD[st.phase]}
        {live ? ` · slip ${(st.slip * 100).toFixed(2)} % · ${formatA(st.irms)} RMS · Te ${st.te.toFixed(1)} N·m` : ''}
      </text>
    </svg>
  )
}

/** The steady torque–speed curve (THEORY) with the simulated trajectory, operating points and the cursor. */
function TorqueSpeed({ r, st, m }: { r: InductionRun; st: ImState | null; m: InductionMeasurements }) {
  const p = r.params
  const th = inductionTheory(p)
  const s = r.signals
  const fEnd = th.end.f
  const fPre = th.start.f
  const freqs = fPre !== fEnd ? [fPre, fEnd] : [fEnd]
  let nHi = 1.06 * Math.max(...freqs.map((f) => syncRpm(f, p.pp)))
  let nLo = 0
  for (let k = 0; k < r.length; k++) {
    nHi = Math.max(nHi, s.n[k] * 1.02)
    nLo = Math.min(nLo, s.n[k])
  }
  const curves = freqs.map((f) => torqueSpeedCurve(p, f, supplyVoltage(p, f), nLo, nHi, 241))
  // the vertical range follows the motoring curve and the simulated torque; the deep generating part of a curve
  // (far above its synchronous speed) is clipped instead of squashing the rest
  let tHi = 0
  let tLo = 0
  for (const c of curves) for (const q of c) tHi = Math.max(tHi, q.te)
  for (let k = 0; k < r.length; k++) {
    tHi = Math.max(tHi, s.te[k])
    tLo = Math.min(tLo, s.te[k])
  }
  tHi *= 1.08
  tLo = Math.min(tLo * 1.08, -0.12 * tHi)
  const W = 560
  const H = 300
  const X0 = 46
  const X1 = W - 12
  const Y0 = 14
  const Y1 = H - 34
  const X = (n: number) => X0 + ((n - nLo) / (nHi - nLo)) * (X1 - X0)
  const Y = (t: number) => Y0 + ((tHi - t) / (tHi - tLo)) * (Y1 - Y0)
  const path = (pts: Array<{ n: number; te: number }>) => pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.n).toFixed(1)} ${Y(q.te).toFixed(1)}`).join(' ')
  const step = Math.max(1, Math.floor(r.length / 1500))
  const traj: Array<{ n: number; te: number }> = []
  for (let k = 0; k < r.length; k += step) traj.push({ n: s.n[k], te: s.te[k] })
  const loads = [...new Set([p.tl, ...(p.event === 'load' ? [p.tl2] : [])])]
  const loadLine = (tl: number) => path([nLo, nHi].map((n) => ({ n, te: tl + (p.b * n * 2 * Math.PI) / 60 })))
  const ticks = (lo: number, hi: number, nTick: number) => {
    const span = hi - lo
    const raw = span / nTick
    const mag = 10 ** Math.floor(Math.log10(raw))
    const stepT = [1, 2, 5, 10].map((x) => x * mag).find((x) => x >= raw) ?? raw
    const out: number[] = []
    for (let v = Math.ceil(lo / stepT) * stepT; v <= hi + 1e-9; v += stepT) out.push(Math.abs(v) < 1e-9 ? 0 : v)
    return out
  }
  const bd = breakdown(p, fEnd, supplyVoltage(p, fEnd))
  const pts = [
    ...(r.pre ? [{ sim: r.pre, th: th.start.point, key: 'pre' }] : []),
    { sim: r.end, th: th.end.point, key: 'end' },
  ]
  const flows = [
    { label: 'Input power', w: m.pin },
    { label: 'stator copper loss 3·I1²·Rs', w: m.pcuS },
    { label: 'air gap Pag = Te·ωs/p', w: m.pag },
    { label: 'rotor copper loss s·Pag', w: m.pcuR },
    { label: 'friction B·ω²', w: m.pfr },
    { label: 'to the load TL·ω', w: m.pout },
  ]
  const fMax = Math.max(...flows.map((f) => Math.abs(f.w)), 1e-12)
  return (
    <section className="dc-energy" aria-label="Torque against speed">
      <h3 className="eyebrow">Torque against speed — THEORY curve, SIMULATED run</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="im-tn" role="img" aria-label="Torque–speed curve with the simulated trajectory and operating points">
        {ticks(nLo, nHi, 6).map((n) => (
          <g key={`x${n}`}>
            <line x1={X(n)} x2={X(n)} y1={Y0} y2={Y1} className="im-grid" />
            <text x={X(n)} y={Y1 + 14} textAnchor="middle" className="im-tick">
              {n.toFixed(0)}
            </text>
          </g>
        ))}
        {ticks(tLo, tHi, 5).map((t) => (
          <g key={`y${t}`}>
            <line x1={X0} x2={X1} y1={Y(t)} y2={Y(t)} className="im-grid" />
            <text x={X0 - 5} y={Y(t) + 3.5} textAnchor="end" className="im-tick">
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={X0} x2={X1} y1={Y(0)} y2={Y(0)} className="im-axis" />
        <line x1={X(0)} x2={X(0)} y1={Y0} y2={Y1} className="im-axis" />
        <text x={X1} y={H - 4} textAnchor="end" className="im-axis-label">
          speed n [rpm] →
        </text>
        <text x={X0 + 4} y={Y1 - 6} className="im-axis-label">
          torque [N·m] ↑
        </text>
        <path d={path(traj)} className="im-traj" />
        {loads.map((tl) => (
          <path key={tl} d={loadLine(tl)} className="im-load" />
        ))}
        <clipPath id="im-tn-clip">
          <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} />
        </clipPath>
        <g clipPath="url(#im-tn-clip)">
          {curves.map((c, q) => (
            <path key={q} d={path(c)} className={`im-curve ${q === 0 && curves.length > 1 ? 'im-curve--pre' : ''}`} />
          ))}
        </g>
        {freqs.map((f) => (
          <g key={f}>
            <line x1={X(syncRpm(f, p.pp))} x2={X(syncRpm(f, p.pp))} y1={Y0} y2={Y1} className="im-load" />
            <text x={X(syncRpm(f, p.pp)) - 4} y={Y0 + 26} textAnchor="end" className="im-label">
              ns {syncRpm(f, p.pp).toFixed(0)}
            </text>
          </g>
        ))}
        <path d={`M${X(bd.nMax)} ${Y(bd.tMax) - 7} l-5 -8 h10 Z`} className="im-bd" />
        <text x={X(bd.nMax) + 9} y={Y(bd.tMax) - 9} className="im-label">
          Tmax {bd.tMax.toFixed(1)} N·m
        </text>
        {pts.map((q) => (
          <g key={q.key}>
            <circle cx={X(q.th.n)} cy={Y(q.th.te)} r={7} className="im-th-pt" />
            <circle cx={X(q.sim.n)} cy={Y(q.sim.te)} r={4} className="im-sim-pt" />
          </g>
        ))}
        {st && <circle cx={X(st.n)} cy={Y(st.te)} r={4.5} className="im-cursor" />}
      </svg>
      <ul className="im-legend">
        <li>
          <span className="im-key" /> equivalent circuit at {fEnd.toFixed(fEnd % 1 ? 1 : 0)} Hz{curves.length > 1 ? ` (dashed: ${fPre.toFixed(fPre % 1 ? 1 : 0)} Hz)` : ''}
        </li>
        <li>
          <span className="im-key im-key--load" /> load + friction
        </li>
        <li>
          <span className="im-key im-key--traj" /> simulated Te(n)
        </li>
        <li>
          <span className="im-key im-key--dot" /> simulated operating point
        </li>
        <li>
          <span className="im-key im-key--ring" /> theory
        </li>
      </ul>
      <p className="muted small">
        The steady curve holds only once the electrical transients have died away: {p.supply === 'dol' ? 'during a direct-on-line start' : 'while the drive ramps the frequency'} the simulated torque moves off it (the curve is drawn for a fixed frequency). The settled points sit on the curve where it crosses the
        load line{th.end.locked ? ' — or, when the load is above the curve everywhere, at standstill (s = 1)' : ''}.
      </p>
      <h3 className="eyebrow">Power at the final operating point (SIMULATION)</h3>
      <ul className="eflows">
        {flows.map((f) => (
          <li key={f.label}>
            <span className="eflow-label">{f.label}</span>
            <span className="eflow-bar">
              <span style={{ width: `${(100 * Math.abs(f.w)) / fMax}%` }} />
            </span>
            <span className="eflow-value">{formatW(f.w)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Efficiency {m.eff === null ? '— (no useful output)' : `${(m.eff * 100).toFixed(1)} %`}. Iron loss is not modelled. Energy over the whole run: residual {(Math.abs(m.balance) * 100).toExponential(1)} % of the input
        (supply = copper + friction + load + kinetic + magnetic).
      </p>
    </section>
  )
}

/** The per-phase equivalent circuit, labelled with this run's values at its final frequency and slip. */
function EquivalentCircuit({ r }: { r: InductionRun }) {
  const p = r.params
  const th = inductionTheory(p)
  const f = th.end.f
  const w = 2 * Math.PI * f
  const sl = th.end.point.s
  const coil = (x: number, y: number) => `M${x} ${y} ${Array.from({ length: 3 }, () => 'a8 8 0 0 1 16 0').join(' ')}`
  const coilV = (x: number, y: number) => `M${x} ${y} ${Array.from({ length: 3 }, () => 'a8 8 0 0 1 0 16').join(' ')}`
  return (
    <svg className="buck-diagram im-eqc" viewBox="0 0 560 170" role="img" aria-label="Per-phase equivalent circuit">
      <path d="M40 40 H80 M128 40 H160 M208 40 H330 M378 40 H440 V60 M440 108 V140 H40 M40 40 V70 M40 110 V140 M290 40 V64 M290 112 V140" className="wire" />
      <circle cx={40} cy={90} r={20} className="sym-body" />
      <path d="M30 90 q5 -8 10 0 t10 0" className="sym" />
      <text x={14} y={94} textAnchor="end" className="cvalue">
        V
      </text>
      <text x={40} y={128} textAnchor="middle" className="cvalue">
        {formatV(th.end.v, false)}
      </text>
      <rect x={80} y={33} width={48} height={14} rx={2} className="sym-body" />
      <text x={104} y={26} textAnchor="middle" className="cvalue">
        Rs {formatSI(p.rs, 'Ω')}
      </text>
      <path d={coil(160, 40)} className="sym sym--coil" />
      <text x={184} y={22} textAnchor="middle" className="cvalue">
        jXls {formatSI(w * p.lls, 'Ω')}
      </text>
      <path d={coilV(290, 64)} className="sym sym--coil" />
      <text x={300} y={92} className="cvalue">
        jXm {formatSI(w * p.lm, 'Ω')}
      </text>
      <path d={coil(330, 40)} className="sym sym--coil" />
      <text x={354} y={22} textAnchor="middle" className="cvalue">
        jXlr {formatSI(w * p.llr, 'Ω')}
      </text>
      <rect x={433} y={60} width={14} height={48} rx={2} className="sym-body" />
      <text x={456} y={82} className="cvalue">
        Rr/s
      </text>
      <text x={456} y={97} className="cvalue">
        {th.end.locked || sl > 1e-9 ? formatSI(p.rr / sl, 'Ω') : '∞'}
      </text>
      <text x={280} y={162} textAnchor="middle" className="path-caption">
        at {f.toFixed(1)} Hz, slip {(sl * 100).toFixed(3)} % (THEORY operating point)
      </text>
    </svg>
  )
}

function inspect(part: string, st: ImState, m: InductionMeasurements, r: InductionRun): InspectInfo {
  const p = r.params
  if (part === 'supply')
    return p.supply === 'dol'
      ? {
          title: 'Mains supply',
          role: 'A stiff three-phase sinusoidal voltage at rated voltage and frequency, connected at t = 0 (direct on line).',
          rows: [
            ['Line voltage', `${p.vll.toFixed(0)} V RMS (${formatV(p.vr, false)} per phase)`],
            ['Frequency', `${p.fr.toFixed(0)} Hz`],
            ['Input power now', formatW(st.pin)],
            ['Peak current drawn at the start', formatA(m.iPeak)],
          ],
        }
      : {
          title: 'V/f drive',
          role: 'Ramps the frequency and raises the voltage with it (constant V/f, plus a boost at low frequency) so the flux stays constant. Modelled by its fundamental: inverter switching is not simulated.',
          rows: [
            ['State now', `${st.f.toFixed(2)} Hz · ${formatV(st.vrms, false)} per phase`],
            ['V/f ratio (rated)', `${(p.vr / p.fr).toFixed(2)} V/Hz per phase`],
            ['Boost at 0 Hz', `${(p.boost * 100).toFixed(1)} % = ${formatV(p.vb, false)}`],
            ['Ramp', `${(p.rate).toFixed(1)} Hz/s (0 → ${p.fr} Hz in ${formatTime(p.tramp)})`],
            ['Input power now', formatW(st.pin)],
          ],
        }
  if (part === 'stator')
    return {
      title: 'Stator windings',
      role: 'Three windings 120° apart: three sinusoidal currents make one magnetic field that rotates at the synchronous speed 120·f/P.',
      rows: [
        ['Phase currents now', `${formatA(st.ia, true)}, ${formatA(st.ib, true)}, ${formatA(st.ic, true)}`],
        ['RMS current now', formatA(st.irms)],
        ['Stator flux |ψs|', `${st.psi.toFixed(3)} Wb`],
        ['Field speed now', `${st.nsync.toFixed(0)} rpm`],
        ['Rs, Lls, Lm', `${formatSI(p.rs, 'Ω')}, ${formatSI(p.lls, 'H')}, ${formatSI(p.lm, 'H')}`],
        ['Copper loss (final point)', formatW(m.pcuS)],
      ],
    }
  if (part === 'rotor')
    return {
      title: 'Squirrel-cage rotor',
      role: 'Bars shorted by end rings. The field slipping past induces currents in them; the force on those currents is the torque.',
      rows: [
        ['State now', PHASE_WORD[st.phase]],
        ['Speed now', `${st.n.toFixed(0)} rpm (slip ${(st.slip * 100).toFixed(2)} %)`],
        ['Rotor frequency s·f', `${(st.slip * st.f).toFixed(2)} Hz`],
        ['Rotor current (referred) now', formatA(st.irr)],
        ['Rr, Llr (referred)', `${formatSI(p.rr, 'Ω')}, ${formatSI(p.llr, 'H')}`],
        ['Rotor copper loss (final point)', `${formatW(m.pcuR)} = s·Pag`],
      ],
    }
  return {
    title: 'Load and shaft',
    role: 'A constant, passive load torque (it opposes the motion and holds a rotor at rest) plus viscous friction B·ω, on the inertia J.',
    rows: [
      ['Load torque now', `${st.tl.toFixed(2)} N·m`],
      ['Motor torque now', `${st.te.toFixed(2)} N·m`],
      ['J, B', `${p.j} kg·m², ${formatSI(p.b, 'N·m·s')}`],
      ['Output power (final point)', formatW(m.pout)],
    ],
  }
}

const ANALYSIS: Array<AnalysisCategory<InductionRun, InductionMeasurements>> = [
  { id: 'overview', label: 'Overview', rows: ['nEnd', 'slip', 'te', 'isEnd', 'eff', 'outcome'] },
  { id: 'point', label: 'Operating point', rows: ['nEnd', 'nsync', 'slip', 'slipRpm', 'te', 'isEnd', 'pf', 'psi', 'fEnd', 'vEnd'], note: (m) => (m.settled ? 'Means over the last supply cycle of the settled run.' : 'The run had not settled: these are the values at its end.') },
  { id: 'step', label: 'Before the step', rows: ['nPre', 'slipPre', 'isPre'] },
  { id: 'start', label: 'Start-up', rows: ['iPeak', 'teMax', 'teMin', 'tStart', 'ecuRStart', 'ekinStart', 'einStart'], note: () => 'Peaks from every integration step; energies from the start until the start settled.' },
  { id: 'power', label: 'Power & efficiency', rows: ['pin', 'pcuS', 'pag', 'pcuR', 'pfr', 'pout', 'eff'], note: (m) => `Rotor copper loss = s·Pag: ${formatW(m.pcuR)} vs ${formatW(m.slip * m.pag)} (SIMULATION).` },
  { id: 'tn', label: 'Torque–speed', tab: 'tn' },
  { id: 'energy', label: 'Energy over the run', rows: ['ein', 'ecuS', 'ecuR', 'efr', 'eload', 'ekin', 'emag', 'balance'] },
]

const rpmF = (v: number) => `${v.toFixed(0)} rpm`
const pctF = (v: number) => `${(v * 100).toFixed(2)} %`
const nmF = (v: number) => `${v.toFixed(2)} N·m`
const jF = (v: number) => formatSI(v, 'J')

export const INDUCTION_TOPIC: Topic<InductionParams, InductionRun, InductionMeasurements, ImState> = {
  id: 'induction',
  label: 'Induction motor',
  title: 'Three-phase induction motor: direct on line or V/f',
  defaults: INDUCTION_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'supply',
      label: 'Supply',
      options: [
        { value: 'dol', label: 'Direct on line', title: 'The motor is switched straight onto the mains at rated voltage and frequency' },
        { value: 'vf', label: 'V/f drive', title: 'A drive ramps the frequency, with the voltage in proportion (constant flux)' },
      ],
    },
    { kind: 'number', key: 'f', label: 'Drive frequency f', unit: 'Hz', min: L.f.min, max: L.f.max, step: 1, when: (p) => p.supply === 'vf', hint: (p) => `field speed ns = 120·f/P = ${syncRpm(p.f, p.pp).toFixed(0)} rpm` },
    { kind: 'number', key: 'tl', label: 'Load torque TL', unit: 'N·m', min: L.tl.min, max: L.tl.max, step: 0.5 },
    {
      kind: 'choice',
      key: 'event',
      label: 'Step during the run',
      options: [
        { value: 'none', label: 'None' },
        { value: 'load', label: 'Load step', title: 'The load torque changes once the start has settled' },
      ],
      when: (p) => p.supply === 'dol',
    },
    {
      kind: 'choice',
      key: 'event',
      label: 'Step during the run',
      options: [
        { value: 'none', label: 'None' },
        { value: 'load', label: 'Load step', title: 'The load torque changes once the start has settled' },
        { value: 'freq', label: 'Frequency step', title: 'The drive ramps to a new frequency once the start has settled' },
      ],
      when: (p) => p.supply === 'vf',
    },
    { kind: 'number', key: 'tl2', label: 'Load torque after the step', unit: 'N·m', min: L.tl2.min, max: L.tl2.max, step: 0.5, when: (p) => p.event === 'load' },
    { kind: 'number', key: 'f2', label: 'Frequency after the step', unit: 'Hz', min: L.f2.min, max: L.f2.max, step: 1, when: (p) => p.supply === 'vf' && p.event === 'freq' },
  ],
  advanced: [
    { kind: 'number', key: 'boost', label: 'Low-speed boost', unit: '% of V', scale: 0.01, min: L.boost.min, max: L.boost.max, step: 0.5, when: (p) => p.supply === 'vf' },
    { kind: 'number', key: 'tramp', label: 'Ramp time 0 → rated f', unit: 's', min: L.tramp.min, max: L.tramp.max, step: 0.1, when: (p) => p.supply === 'vf' },
    { kind: 'number', key: 'vll', label: 'Rated line voltage', unit: 'V', min: L.vll.min, max: L.vll.max, step: 10 },
    { kind: 'number', key: 'fr', label: 'Rated frequency', unit: 'Hz', min: L.fr.min, max: L.fr.max, step: 1 },
    {
      kind: 'choice',
      key: 'pp',
      label: 'Poles P',
      options: [
        { value: 1, label: '2' },
        { value: 2, label: '4' },
        { value: 3, label: '6' },
        { value: 4, label: '8' },
      ],
    },
    { kind: 'number', key: 'rs', label: 'Stator resistance Rs', unit: 'Ω', min: L.rs.min, max: L.rs.max, log: true },
    { kind: 'number', key: 'rr', label: 'Rotor resistance Rr (referred)', unit: 'Ω', min: L.rr.min, max: L.rr.max, log: true },
    { kind: 'number', key: 'lls', label: 'Stator leakage Lls', unit: 'mH', scale: 1e-3, min: L.lls.min, max: L.lls.max, log: true },
    { kind: 'number', key: 'llr', label: 'Rotor leakage Llr', unit: 'mH', scale: 1e-3, min: L.llr.min, max: L.llr.max, log: true },
    { kind: 'number', key: 'lm', label: 'Magnetising inductance Lm', unit: 'mH', scale: 1e-3, min: L.lm.min, max: L.lm.max, log: true },
    { kind: 'number', key: 'j', label: 'Inertia J (motor + load)', unit: 'kg·m²', min: L.j.min, max: L.j.max, log: true },
    { kind: 'number', key: 'b', label: 'Viscous friction B', unit: 'mN·m·s', scale: 1e-3, min: L.b.min, max: L.b.max, step: 0.1 },
  ],
  paramNote: (_p, r) => {
    const p = r.params
    const th = inductionTheory(p)
    return `Equivalent circuit at ${th.end.f.toFixed(1)} Hz: ns = ${syncRpm(th.end.f, p.pp).toFixed(0)} rpm · breakdown torque ${th.end.bd.tMax.toFixed(1)} N·m at slip ${(th.end.bd.sMax * 100).toFixed(1)} % · locked-rotor current ${formatA(th.lockedRotor.i1)} RMS · run ${formatTime(p.duration)}, RK4 step ${formatSI(p.h, 's')}`
  },
  simulate: (p) => simulateInduction(p),
  measure: measureInduction,
  state: imStateAt,
  view: (st, r) => imView(st, r),
  why: imWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true, showPath }) => <MotorDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} showPath={showPath} />,
  channels: CH,
  defaultChannels: ['n', 'ia', 'te'],
  primaryChannels: ['n', 'te'],
  addOrder: ['n', 'nsync', 'slip', 'ia', 'ib', 'ic', 'irms', 'irr', 'te', 'tl', 'va', 'f', 'psi', 'pin'],
  shade: (r, k) => (r.signals.stuck[k] > 0.5 ? 'rgba(174,183,197,0.22)' : r.signals.slip[k] < -1e-4 ? 'rgba(34,177,76,0.12)' : null),
  shadeLegend: 'grey band: rotor at rest · green band: generating (rotor faster than the field)',
  eventLabel: imEventLabel,
  eventWhy: imEventWhy,
  eventColor: (e) => (e.device === 'peak' || e.device === 'stall' ? '#e66767' : e.device === 'settled' ? '#199e70' : e.device?.startsWith('regen') ? '#22b14c' : '#3987e5'),
  initialCursor: (r) => r.events.find((e) => e.device === 'peak')?.time ?? 0,
  periodName: 'supply cycle',
  repeats: () => false,
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Operating point">
      <div className="dc-mode-head">
        <span className={`mode-pill ${m.locked ? 'mode-pill--dcm' : 'mode-pill--ccm'}`}>{m.outcome}</span>
        <span className="small">
          {m.nEnd.toFixed(0)} rpm · slip {(m.slip * 100).toFixed(2)} % · {formatA(m.isEnd)} RMS
          <span className="muted"> · SIMULATION{m.settled ? ', settled' : ', not settled'}</span>
        </span>
      </div>
      <p className="muted small">
        start: peak {formatA(m.iPeak)}
        {m.tStart === null ? '' : ` · 95 % speed after ${formatTime(m.tStart)}`} · {r.params.supply === 'dol' ? 'direct on line' : 'V/f ramp'}
      </p>
    </section>
  ),
  summary: (_r, m) => `${m.nEnd.toFixed(0)} rpm · slip ${(m.slip * 100).toFixed(2)} % · ${formatA(m.isEnd)} RMS (SIMULATION)`,
  energy: (st, m, r) => <TorqueSpeed r={r} st={st} m={m} />,
  energyLabel: 'Torque–speed',
  inspect,
  parts: PARTS,
  status: (st) => imStatus(st),
  next: (r, st) => imNextConsequence(r, st)?.text ?? null,
  nextConsequence: (r, st) => imNextConsequence(r, st),
  path: (st) => imPath(st),
  readings: imReadings,
  analysis: ANALYSIS,
  analyze: {
    compare: compareInduction,
    theory: (r, m) => {
      const p = r.params
      const th = inductionTheory(p)
      const tp = th.end.point
      return (
        <>
          <h3>The induction motor: dynamic model and equivalent circuit</h3>
          <ol className="derivation">
            <li>
              <b>Rotating field</b> — three windings 120° apart fed with three currents 120° apart make one field turning at <span className="mono">ns = 120·f/P</span> = {syncRpm(th.end.f, p.pp).toFixed(0)} rpm at{' '}
              {th.end.f.toFixed(1)} Hz.
            </li>
            <li>
              <b>Slip</b> — <span className="mono">s = (ns − n)/ns</span>. The rotor cage sees the field at s·f; its EMF and current grow with s.
            </li>
            <li>
              <b>Dynamic model (SIMULATION)</b> — stationary αβ frame: <span className="mono">dψs/dt = vs − Rs·is</span>, <span className="mono">dψr/dt = −Rr·ir + j·p·ωm·ψr</span>,{' '}
              <span className="mono">Te = (3/2)·p·(ψsα·isβ − ψsβ·isα)</span>, <span className="mono">J·dωm/dt = Te − B·ωm − TL</span>. RK4, step {formatSI(p.h, 's')} ({p.stepsPerPeriod} per{' '}
              {formatTime(p.period)}), {r.steps} steps.
            </li>
            <li>
              <b>Equivalent circuit (THEORY)</b> — in steady state at constant f every quantity is a rotating phasor and the model reduces to the per-phase circuit below:{' '}
              <span className="mono">T = 3·p/ωs · I2²·Rr/s</span>; operating point where <span className="mono">T(s) = TL + B·ωm</span>: slip {(tp.s * 100).toFixed(3)} %, {tp.n.toFixed(1)} rpm.
            </li>
            <li>
              <b>Breakdown torque</b> — from the Thevenin equivalent (Vth, Rth + jXth) seen by the rotor: <span className="mono">s_max = Rr/√(Rth² + (Xth + Xlr)²)</span>,{' '}
              <span className="mono">T_max = 3·p/ωs · Vth²/(2·(Rth + √(Rth² + (Xth + Xlr)²)))</span> = {th.end.bd.tMax.toFixed(1)} N·m at s = {(th.end.bd.sMax * 100).toFixed(1)} %.
            </li>
            <li>
              <b>Power split</b> — air gap <span className="mono">Pag = T·ωs/p</span>; rotor copper loss <span className="mono">s·Pag</span>; mechanical <span className="mono">(1 − s)·Pag</span>. SIMULATION:{' '}
              {formatW(m.pcuR)} vs s·Pag = {formatW(m.slip * m.pag)}.
            </li>
            {p.supply === 'vf' && (
              <li>
                <b>V/f law</b> — <span className="mono">V = Vb + (Vr − Vb)·f/fr</span> (constant above fr): Vr = {formatV(p.vr, false)}, boost Vb = {formatV(p.vb, false)}; the flux ≈ V/(2π·f) stays constant, Rs
                matters only at low frequency.
              </li>
            )}
          </ol>
          <EquivalentCircuit r={r} />
          <p className="small">
            Not modelled: iron loss, magnetic saturation, deep-bar effect, slot harmonics, inverter switching (the drive is its fundamental). The load is passive: it holds a rotor at rest while the motor torque is below it.
          </p>
        </>
      )
    },
    tabs: [{ id: 'tn', label: 'Torque–speed', render: ({ r, m }) => <TorqueSpeed r={r} st={null} m={m} /> }],
    convergence: ['nEnd', 'slip'],
  },
  lessons: INDUCTION_LESSONS,
  experiments: INDUCTION_EXPERIMENTS,
  predictions: inductionPredictions,
  measureLabels: {
    nEnd: { label: 'Speed', fmt: rpmF },
    nsync: { label: 'Synchronous speed', fmt: rpmF },
    slip: { label: 'Slip', fmt: pctF },
    slipRpm: { label: 'Slip speed ns − n', fmt: (v) => `${v.toFixed(1)} rpm` },
    te: { label: 'Motor torque', fmt: nmF },
    isEnd: { label: 'Stator current (RMS)', fmt: (v) => formatA(v) },
    pf: { label: 'Power factor', fmt: (v) => v.toFixed(3) },
    psi: { label: 'Stator flux |ψs|', fmt: (v) => `${v.toFixed(3)} Wb` },
    fEnd: { label: 'Supply frequency', fmt: (v) => `${v.toFixed(2)} Hz` },
    vEnd: { label: 'Phase voltage (RMS)', fmt: (v) => formatV(v, false) },
    pin: { label: 'Input power', fmt: formatW },
    pcuS: { label: 'Stator copper loss', fmt: formatW },
    pag: { label: 'Air-gap power', fmt: formatW },
    pcuR: { label: 'Rotor copper loss', fmt: formatW },
    pfr: { label: 'Friction loss', fmt: formatW },
    pout: { label: 'Output to the load', fmt: formatW },
    eff: { label: 'Efficiency', fmt: (v) => `${(v * 100).toFixed(2)} %` },
    nPre: { label: 'Speed before the step', fmt: rpmF },
    slipPre: { label: 'Slip before the step', fmt: pctF },
    isPre: { label: 'Current before the step (RMS)', fmt: (v) => formatA(v) },
    iPeak: { label: 'Peak starting current', fmt: (v) => formatA(v) },
    teMax: { label: 'Largest start-up torque', fmt: nmF },
    teMin: { label: 'Most negative start-up torque', fmt: nmF },
    tStart: { label: 'Time to 95 % speed', fmt: formatTime },
    ecuRStart: { label: 'Rotor heat during the start', fmt: jF },
    ekinStart: { label: 'Kinetic energy after the start', fmt: jF },
    einStart: { label: 'Energy drawn during the start', fmt: jF },
    ein: { label: 'Energy from the supply', fmt: jF },
    ecuS: { label: 'Stator copper heat', fmt: jF },
    ecuR: { label: 'Rotor copper heat', fmt: jF },
    efr: { label: 'Friction', fmt: jF },
    eload: { label: 'To the load', fmt: jF },
    ekin: { label: 'Kinetic energy at the end', fmt: jF },
    emag: { label: 'Magnetic energy at the end', fmt: jF },
    balance: { label: 'Energy balance residual', fmt: (v) => `${(v * 100).toExponential(1)} %` },
  },
}
