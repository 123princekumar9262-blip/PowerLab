import type { PmsmState } from '../../converters/pmsm/content.ts'
import type { ResolvedPmsm } from '../../converters/pmsm/model.ts'
import '../bldc/bldc.css'

interface Props {
  st: PmsmState
  p: ResolvedPmsm
  selected: string | null
  onSelect: (part: string) => void
  values: boolean
  live: boolean
  /** Animate what flows at the cursor (DiagramProps.showPath). */
  showPath?: boolean
  /** Phase currents at or below this count as zero (1e-3 of the run's peak phase current). */
  iFloor?: number
  /** Electrical powers at or below this count as zero (1e-3 of the run's peak |Pel|). */
  pFloor?: number
}

function partProps(id: string, label: string, selected: string | null, onSelect: (x: string) => void) {
  return {
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
  }
}

function Block({ id, x, y, w, h, title, sub, active, label, selected, onSelect }: { id: string; x: number; y: number; w: number; h: number; title: string; sub?: string; active?: boolean; label: string; selected: string | null; onSelect: (s: string) => void }) {
  return (
    <g {...partProps(id, label, selected, onSelect)}>
      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} className="cpart-hit" />
      <rect x={x} y={y} width={w} height={h} rx={6} className={`pblock ${active ? 'pblock--on' : ''}`} />
      <text x={x + w / 2} y={y + h / 2 + (sub ? -2 : 4)} textAnchor="middle" className="clabel" style={{ fontSize: 12 }}>
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" className="cvalue" style={{ fontSize: 10.5 }}>
          {sub}
        </text>
      )}
    </g>
  )
}

const Sum = ({ x, y }: { x: number; y: number }) => (
  <g>
    <circle cx={x} cy={y} r={9} className="sym-body" />
    <text x={x} y={y + 4} textAnchor="middle" className="cvalue">
      Σ
    </text>
  </g>
)

/** FOC block diagram (speed PI → current PIs → inverse Park → averaged inverter → PMSM, Park feedback) + the d–q vectors. */
export function PmsmDiagram({ st, p, selected, onSelect, values, live, showPath = false, iFloor = 0, pFloor = 0 }: Props) {
  const RQ = 70
  const RD = 150
  const MY = (RQ + RD) / 2
  // signal wires of the control loop, each drawn from its source to its destination (references → PIs → Park →
  // inverter; measured currents, speed and angle fed back)
  const SIG = [
    `M14 ${RQ} H30 M50 ${RQ} H60 M124 ${RQ} H180 M200 ${RQ} H210 M262 ${RQ} H300`,
    `M124 ${RD} H180 M200 ${RD} H210 M262 ${RD} H300`,
    `M352 ${MY} H372`,
    `M458 ${MY + 20} V211 H352`,
    `M300 205 H190 V${RD + 10}`,
    `M300 217 H166 V92 H190 V${RQ + 10}`,
    `M478 ${MY} H490 V246 H40 V${RQ + 10}`,
    `M326 246 V226 M326 196 V${RD + 17}`,
  ]
  // power side, from the simulated state at the cursor: each phase current in its sign (positive = inverter →
  // motor) and the DC-link power, which is the electrical power Pel of the averaged (lossless) inverter
  const phaseY = [MY - 12, MY, MY + 12]
  const phaseEnd = [440, 438, 440]
  const flowPhases = showPath ? [0, 1, 2].filter((k) => Math.abs(st.i[k]) > iFloor).map((k) => (st.i[k] > 0 ? `M424 ${phaseY[k]} H${phaseEnd[k]}` : `M${phaseEnd[k]} ${phaseY[k]} H424`)) : []
  const flowDc = showPath && Math.abs(st.pel) > pFloor ? (st.pel > 0 ? `M398 22 V${RQ - 17}` : `M398 ${RQ - 17} V22`) : null
  const dec = p.decouple === 'on'
  // vector diagram in the rotor frame (d to the right, q up), lengths ÷ their limits
  const cx = 592
  const cy = 122
  const R = 72
  const iv = { x: (st.id / p.imax) * R, y: (st.iq / p.imax) * R }
  const vv = { x: (st.vd / p.vmax) * R, y: (st.vq / p.vmax) * R }
  const clip = (a: { x: number; y: number }) => {
    const m = Math.hypot(a.x, a.y)
    return m > R * 1.15 ? { x: (a.x * R * 1.15) / m, y: (a.y * R * 1.15) / m } : a
  }
  // without live numbers (Beginner, or an unanswered prediction) only the directions are drawn: no magnitudes
  const unit = (a: { x: number; y: number }) => {
    const m = Math.hypot(a.x, a.y)
    return m > 1e-9 ? { x: (a.x * 0.8 * R) / m, y: (a.y * 0.8 * R) / m } : a
  }
  const ic = live ? clip(iv) : unit(iv)
  const vc = live ? clip(vv) : unit(vv)
  const fA = (x: number) => `${x.toFixed(2)} A`
  const fV = (x: number) => `${x.toFixed(2)} V`
  return (
    <svg className="buck-diagram bldc-diagram pmsm-diagram" viewBox="0 0 690 270" role="group" aria-label={`PMSM field-oriented control: ${st.n.toFixed(0)} rpm, iq ${st.iq.toFixed(2)} A, id ${st.id.toFixed(2)} A`}>
      {/* forward signal path */}
      <path d={`M14 ${RQ} H30 M50 ${RQ} H60 M124 ${RQ} H180 M200 ${RQ} H210 M262 ${RQ} H300`} className="wire wire--sig" />
      <path d={`M124 ${RD} H180 M200 ${RD} H210 M262 ${RD} H300`} className="wire wire--sig" />
      <path d={`M352 ${MY} H372 M424 ${MY - 12} H440 M424 ${MY} H438 M424 ${MY + 12} H440`} className="wire" />
      {/* DC link feeding the averaged inverter */}
      <path d={`M398 22 V${RQ - 17}`} className="wire" />
      <text x={406} y={30} className="cvalue">
        DC link {Number(p.vdc.toPrecision(3))} V
      </text>
      {/* feedback: currents (abc → dq), speed and angle (encoder) */}
      <path d={`M458 ${MY + 20} V211 H352`} className="wire wire--sig" />
      <path d={`M300 205 H190 V${RD + 10}`} className="wire wire--sig" />
      <path d={`M300 217 H166 V92 H190 V${RQ + 10}`} className="wire wire--sig" />
      <path d={`M478 ${MY} H490 V246 H40 V${RQ + 10}`} className="wire wire--sig" />
      <path d={`M326 246 V226 M326 196 V${RD + 17}`} className="wire wire--sig" strokeDasharray="4 4" />
      {/* what flows at the cursor: the control signals (always), the phase currents in their sign, the DC-link power */}
      {showPath && SIG.map((d) => <path key={d} d={d} className="wire wire--flow" pointerEvents="none" />)}
      {flowPhases.map((d) => (
        <path key={d} d={d} className="wire wire--flow" pointerEvents="none" />
      ))}
      {flowDc && <path d={flowDc} className="wire wire--flow" pointerEvents="none" />}
      <text x={14} y={RQ - 9} className="cvalue">
        n*
      </text>
      <Sum x={40} y={RQ} />
      <Block id="speedpi" x={60} y={RQ - 17} w={64} h={34} title="Speed PI" active={st.sat !== 0} label={`Speed PI ${st.sat !== 0 ? 'at the current limit' : 'linear'}`} selected={selected} onSelect={onSelect} />
      <text x={157} y={RQ - 9} textAnchor="middle" className="cvalue">
        iq*
      </text>
      <Sum x={190} y={RQ} />
      <Block id="piq" x={210} y={RQ - 17} w={52} h={34} title="PI q" label="q-axis current PI" selected={selected} onSelect={onSelect} />
      <text x={281} y={RQ - 9} textAnchor="middle" className="cvalue">
        vq*
      </text>
      <Block id="idref" x={60} y={RD - 17} w={64} h={34} title={p.control === 'fw' ? 'FW: id*' : 'id* = 0'} active={st.fw} label={p.control === 'fw' ? 'Field-weakening id* reference' : 'id reference: zero'} selected={selected} onSelect={onSelect} />
      <text x={147} y={RD - 9} textAnchor="middle" className="cvalue">
        id*
      </text>
      <Sum x={190} y={RD} />
      <Block id="pid" x={210} y={RD - 17} w={52} h={34} title="PI d" label="d-axis current PI" selected={selected} onSelect={onSelect} />
      <text x={281} y={RD - 9} textAnchor="middle" className="cvalue">
        vd*
      </text>
      <text x={236} y={RD + 32} textAnchor="middle" className="cvalue">
        {dec ? '+ decoupling' : 'no decoupling'}
      </text>
      <Block id="park" x={300} y={RQ - 17} w={52} h={RD - RQ + 34} title="dq→abc" sub="θe" label="Inverse Park transform" selected={selected} onSelect={onSelect} />
      <Block id="inv" x={372} y={RQ - 17} w={52} h={RD - RQ + 34} title="Inverter" sub="averaged" active={st.vlim} label={`Inverter (averaged), |v| ${st.vlim ? 'at' : 'below'} the limit`} selected={selected} onSelect={onSelect} />
      <g {...partProps('motor', `PMSM at ${st.n.toFixed(0)} rpm`, selected, onSelect)}>
        <circle cx={458} cy={MY} r={26} className="cpart-hit" />
        <circle cx={458} cy={MY} r={20} className="sym-body" />
        <text x={458} y={MY + 5} textAnchor="middle" className="clabel">
          M
        </text>
      </g>
      <Block id="clarke" x={300} y={196} w={52} h={30} title="abc→dq" label="Park transform of the measured currents" selected={selected} onSelect={onSelect} />
      <text x={250} y={200} textAnchor="middle" className="cvalue">
        id
      </text>
      <text x={250} y={231} textAnchor="middle" className="cvalue">
        iq
      </text>
      <text x={336} y={241} className="cvalue">
        ω, θe (encoder)
      </text>
      {live && (
        <text x={458} y={MY - 30} textAnchor="middle" className="cvalue cvalue--out">
          {st.n.toFixed(0)} rpm
        </text>
      )}
      {/* rotor-frame vectors */}
      <g {...partProps('vectors', `Rotor-frame vectors: id ${st.id.toFixed(2)} A, iq ${st.iq.toFixed(2)} A`, selected, onSelect)}>
        <rect x={cx - R - 16} y={cy - R - 16} width={2 * R + 32} height={2 * R + 40} className="cpart-hit" />
        <circle cx={cx} cy={cy} r={R} className="pmsm-circle" />
        <line x1={cx - R - 8} x2={cx + R + 8} y1={cy} y2={cy} className="pmsm-axis pmsm-axis--d" />
        <line x1={cx} x2={cx} y1={cy + R + 8} y2={cy - R - 8} className="pmsm-axis pmsm-axis--q" />
        <text x={cx + R + 8} y={cy + 16} textAnchor="end" className="cvalue chalo">
          d (magnet)
        </text>
        <text x={cx + 7} y={cy - R - 2} className="cvalue chalo">
          q
        </text>
        <line x1={cx} x2={cx + vc.x} y1={cy} y2={cy - vc.y} className="pmsm-vec" style={{ stroke: '#3987e5' }} />
        <line x1={cx} x2={cx + ic.x} y1={cy} y2={cy - ic.y} className="pmsm-vec" style={{ stroke: '#e66767' }} />
        <circle cx={cx + ic.x} cy={cy - ic.y} r={3.5} fill="#e66767" />
        <circle cx={cx + vc.x} cy={cy - vc.y} r={3.5} fill="#3987e5" />
        <text x={cx - R - 10} y={cy + R + 20} className="cvalue" style={{ fill: '#ee8c8c' }}>
          {live ? 'i ÷ Imax' : 'current i'}
        </text>
        <text x={cx + R + 10} y={cy + R + 20} textAnchor="end" className="cvalue" style={{ fill: '#6fa8f0' }}>
          {live ? 'v ÷ Vdc/√3' : 'voltage v'}
        </text>
      </g>
      <text x={cx} y={30} textAnchor="middle" className="clabel">
        rotor (d–q) frame
      </text>
      <text x={250} y={264} className="path-caption" textAnchor="middle">
        {values
          ? `iq* ${fA(st.iqref)} · iq ${fA(st.iq)} · id* ${fA(st.idref)} · id ${fA(st.id)} · vq ${fV(st.vq)} · vd ${fV(st.vd)}`
          : `${st.sat !== 0 ? 'speed PI at the current limit' : 'speed regulated'}${st.vlim ? ' · voltage limit' : ''}${st.fw ? ' · field weakening' : ''}${live ? ` · Te ${st.te.toFixed(3)} N·m` : ''}`}
      </text>
    </svg>
  )
}
