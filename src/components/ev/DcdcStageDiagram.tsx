import type { StageRun } from '../../converters/ev/dcdcStage.ts'
import type { StageState } from '../../converters/ev/dcdcStageContent.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'
import './evsub.css'

interface Props {
  st: StageState
  r: StageRun
  selected: string | null
  onSelect: (part: string) => void
  live: boolean
  values: boolean
  showPath: boolean
}

const YL = 40
const YS = 140
const YG = 236
const XB = 56
const XLEG = 300
const XC = 430
const XINV = 624

/**
 * The EV DC-DC stage: battery (Voc, Rb), inductor, the synchronous half-bridge (S1/D1 high side, S2/D2 low side),
 * the link capacitor and the inverter. Conducting devices, gate states and the direction of the power are read
 * from the simulated sample at the cursor.
 */
export function DcdcStageDiagram({ st, r, selected, onSelect, live, values, showPath }: Props) {
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
  const has = (id: string) => st.carriers.includes(id)
  const hi = has('S1') || has('D1')
  const flow = (on: boolean) => (showPath && on ? 'wire wire--flow' : on ? (st.il >= 0 ? 'wire wire--igbt' : 'wire wire--diode') : 'wire')
  const motoring = p.power >= 0
  /** One position of the leg: the switch (box) with its body diode to the right; diode points up (anode below). */
  const position = (y0: number, y1: number, sw: 'S1' | 'S2', d: 'D1' | 'D2', gated: boolean) => {
    const cy = (y0 + y1) / 2
    const sOn = has(sw)
    const dOn = has(d)
    return (
      <g>
        <line x1={XLEG} x2={XLEG} y1={y0} y2={cy - 16} className={sOn ? flow(true) : 'wire'} />
        <line x1={XLEG} x2={XLEG} y1={cy + 16} y2={y1} className={sOn ? flow(true) : 'wire'} />
        <g {...part(sw.toLowerCase(), `${sw} ${sOn ? 'conducting' : gated ? 'gated' : 'off'}`)}>
          <rect x={XLEG - 30} y={cy - 22} width={52} height={44} className="cpart-hit" />
          <rect x={XLEG - 14} y={cy - 16} width={28} height={32} rx={5} className={`evd-sw ${sOn ? 'evd-sw--on' : ''}`} />
          <text x={XLEG} y={cy + 4} textAnchor="middle" className="dchip-text">
            {sw}
          </text>
          {gated && <circle cx={XLEG - 22} cy={cy} r={4} className="gate-dot" />}
        </g>
        <g {...part(d.toLowerCase(), `${d} ${dOn ? 'conducting' : 'off'}`)}>
          <rect x={XLEG + 22} y={cy - 22} width={56} height={44} className="cpart-hit" />
          <path d={`M${XLEG} ${y0 + 8} H${XLEG + 34} V${y1 - 8} H${XLEG}`} className={`wire wire--thin ${dOn ? 'wire--diode' : ''}`} />
          <path d={`M${XLEG + 24} ${cy + 8} H${XLEG + 44} L${XLEG + 34} ${cy - 8} Z`} className={`sym-fill ${dOn ? 'sym-fill--on-d' : ''}`} />
          <line x1={XLEG + 24} x2={XLEG + 44} y1={cy - 8} y2={cy - 8} className="sym" />
          <text x={XLEG + 50} y={cy + 4} className="cvalue chalo">
            {d}
          </text>
        </g>
      </g>
    )
  }
  const arrow = motoring ? `M${XC - 70} 20 H${XC + 60} M${XC + 52} 14 L${XC + 60} 20 L${XC + 52} 26` : `M${XC + 60} 20 H${XC - 70} M${XC - 62} 14 L${XC - 70} 20 L${XC - 62} 26`
  return (
    <svg className="buck-diagram evd-diagram" viewBox="0 0 690 270" role="group" aria-label={`EV DC-DC stage, ${st.interval}: ${st.carriers.join(', ') || 'nothing'} carries ${st.il.toFixed(1)} A`}>
      {/* rails */}
      <path d={`M${XB} ${YS} H112`} className={flow(true)} />
      <path d={`M208 ${YS} H${XLEG}`} className={flow(true)} />
      <path d={`M${XLEG} ${YL} H${XINV} V96`} className={flow(hi)} />
      <path d={`M${XB} ${YG} H${XINV} V180`} className="wire" />
      <circle cx={XLEG} cy={YS} r={4} className="node-dot" />
      <circle cx={XLEG} cy={YL} r={3} className="node-dot" />
      <circle cx={XLEG} cy={YG} r={3} className="node-dot" />
      <circle cx={XC} cy={YL} r={3} className="node-dot" />
      <circle cx={XC} cy={YG} r={3} className="node-dot" />
      {/* battery */}
      <g {...part('battery', `Battery ${p.vbat} V`)}>
        <rect x={XB - 22} y={YS + 26} width={150} height={60} className="cpart-hit" />
        <path d={`M${XB} ${YS} V176 M${XB} 192 V${YG}`} className={flow(true)} />
        <rect x={XB - 18} y={174} width={36} height={20} className="gap-mask" />
        <line x1={XB - 16} x2={XB + 16} y1={178} y2={178} className="sym" />
        <line x1={XB - 9} x2={XB + 9} y1={190} y2={190} className="sym sym--thick" />
        <text x={XB + 26} y={182} className="clabel">
          battery
        </text>
        <text x={XB + 26} y={197} className="cvalue">
          {p.vbat} V · Rb {formatSI(p.rbat, 'Ω')}
        </text>
        {live && (
          <text x={XB + 26} y={212} className="cvalue">
            terminals {formatV(st.vbt, false)}
          </text>
        )}
      </g>
      {/* inductor */}
      <g {...part('l', `Inductor, iL = ${st.il.toFixed(1)} A`)}>
        <rect x={108} y={110} width={104} height={64} className="cpart-hit" />
        <path d={`M112 ${YS} ${Array.from({ length: 4 }, () => 'a12 12 0 0 1 24 0').join(' ')}`} className="sym sym--coil" />
        <text x={160} y={118} textAnchor="middle" className="clabel">
          L {formatSI(p.l, 'H')}
        </text>
        {live && (
          <text x={160} y={162} textAnchor="middle" className="cvalue cvalue--il">
            iL {formatA(st.il, true)} {st.dildt * Math.sign(st.il || 1) > 0 ? '↗' : '↘'}
          </text>
        )}
      </g>
      {position(YL, YS, 'S1', 'D1', st.g1)}
      {position(YS, YG, 'S2', 'D2', st.g2)}
      {live && (
        <text x={XLEG - 12} y={YS - 8} textAnchor="end" className="cvalue chalo">
          vsw {formatV(st.vsw, false)}
        </text>
      )}
      {/* link capacitor */}
      <g {...part('c', `Link capacitor, ${st.vlink.toFixed(1)} V`)}>
        <rect x={XC - 26} y={YS - 24} width={52} height={48} className="cpart-hit" />
        <path d={`M${XC} ${YL} V${YS - 6} M${XC} ${YS + 6} V${YG}`} className="wire" />
        <rect x={XC - 18} y={YS - 9} width={36} height={18} className="gap-mask" />
        <line x1={XC - 16} x2={XC + 16} y1={YS - 6} y2={YS - 6} className="sym sym--thick" />
        <line x1={XC - 16} x2={XC + 16} y1={YS + 6} y2={YS + 6} className="sym sym--thick" />
        <text x={XC - 22} y={YS + 4} textAnchor="end" className="clabel">
          C
        </text>
        <text x={XC + 22} y={YS + 4} className="cvalue">
          {live ? `Vlink ${formatV(st.vlink, false)}` : `${formatSI(p.c, 'F')}`}
        </text>
      </g>
      {/* inverter + motor */}
      <g {...part('inv', 'Inverter and motor')}>
        <rect x={XINV - 54} y={92} width={108} height={92} className="cpart-hit" />
        <rect x={XINV - 50} y={96} width={100} height={84} rx={8} className={`pblock ${Math.abs(st.iinv) > 1 ? 'pblock--on' : ''}`} />
        <text x={XINV} y={124} textAnchor="middle" className="clabel">
          inverter
        </text>
        <text x={XINV} y={140} textAnchor="middle" className="cvalue">
          + motor
        </text>
        <text x={XINV} y={160} textAnchor="middle" className="cvalue">
          {motoring ? 'takes' : 'returns'} {(Math.abs(p.power) / 1000).toFixed(0)} kW
        </text>
      </g>
      {/* power flow */}
      <path d={arrow} className={`evd-arrow ${motoring ? 'evd-arrow--fwd' : 'evd-arrow--back'}`} />
      <text x={XC - 78} y={24} textAnchor="end" className="cvalue evd-small">
        {motoring ? 'motoring' : 'regenerating'}
      </text>
      <text x={XLEG} y={258} textAnchor="middle" className="cvalue">
        {live || values ? `D ${(p.duty * 100).toFixed(2)} % · fs ${formatSI(p.fs, 'Hz')} · dead time ${formatSI(p.td, 's')}` : `fs ${formatSI(p.fs, 'Hz')} · link target ${p.vlink} V`}
      </text>
    </svg>
  )
}
