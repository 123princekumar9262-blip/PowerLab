import type { MultiState } from '../../converters/pwm/multipulseContent.ts'
import type { ResolvedMultiPulse } from '../../converters/pwm/multipulse.ts'
import { formatSI, formatTime, formatV } from '../../utils/format.ts'
import '../../styles/flow-systems.css'

interface Props {
  st: MultiState
  p: ResolvedMultiPulse
  selected: string | null
  onSelect: (part: string) => void
  values: boolean
  /** Live numbers (Standard and Engineer). */
  live?: boolean
  /** Animate the signal flow and mark the bridge path applied at the cursor (no load current is simulated). */
  showPath?: boolean
}

/**
 * Uniform multiple-pulse PWM as a block diagram: a square-wave reference and a 2p·f1 triangle into a
 * comparator, a steering block that sends the pulses to leg A (positive half) or leg B (negative half), and the
 * full bridge with its load. States and values are the simulated ones at the cursor.
 */
export function MultiPulseDiagram({ st, p, selected, onSelect, values, live = true, showPath = false }: Props) {
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
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, id: string, active = false) => (
    <g {...part(id, title)}>
      <rect x={x} y={y} width={w} height={h} rx={10} className={`pblock ${active ? 'pblock--on' : ''}`} />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" className="clabel">
        {title}
      </text>
      <text x={x + w / 2} y={y + 40} textAnchor="middle" className="cvalue">
        {sub}
      </text>
    </g>
  )
  const pos = st.sign > 0
  // switch states: S1 = leg A up, S2 = leg A down, S3 = leg B up, S4 = leg B down
  const s1 = st.gA
  const s3 = st.gB
  const sw = (x: number, y: number, id: string, on: boolean, lower: boolean) => (
    <g>
      <rect x={x - 13} y={y} width={26} height={30} rx={4} className={`pswitch ${on ? (lower ? 'pswitch--on-l' : 'pswitch--on') : ''}`} />
      <text x={x} y={y + 19} textAnchor="middle" className="dchip-text">
        {id}
      </text>
    </g>
  )
  const XA = 520
  const XB = 650
  const yR = 70
  const yC = 170
  return (
    <svg className="buck-diagram pwm-diagram" viewBox="0 0 690 270" role="group" aria-label={`Uniform multiple-pulse PWM, p = ${p.p}. ${st.gate ? 'Pulse' : 'No pulse'}, vAB ${formatV(st.vout)}.`}>
      {/* signal wires */}
      <path d={`M164 ${yR} H180 V${yR + 35} H200`} className="wire wire--sig" />
      <path d={`M164 ${yC} H180 V${yC - 35} H200`} className="wire wire--sig" />
      <path d="M290 120 H320" className={`wire ${st.gate ? 'wire--hi' : 'wire--sig'}`} />
      <path d="M420 106 H474" className={`wire ${s1 ? 'wire--hi' : 'wire--sig'}`} />
      <path d="M420 134 H474" className={`wire ${s3 ? 'wire--hi' : 'wire--sig'}`} />
      {showPath && (
        // signal flow only: reference and carrier into the comparator always; a pulse (HIGH) into the steering block,
        // and on to the leg it is steered to
        <>
          <path d={`M164 ${yR} H180 V${yR + 35} H200`} className="wire wire--flow" />
          <path d={`M164 ${yC} H180 V${yC - 35} H200`} className="wire wire--flow" />
          {st.gate && <path d="M290 120 H320" className="wire wire--flow" />}
          {s1 && <path d="M420 106 H474" className="wire wire--flow" />}
          {s3 && <path d="M420 134 H474" className="wire wire--flow" />}
        </>
      )}
      <text x={448} y={100} textAnchor="middle" className="cvalue">
        gA
      </text>
      <text x={448} y={150} textAnchor="middle" className="cvalue">
        gB
      </text>

      {box(14, yR - 28, 150, 56, 'Reference', `square ±M, M = ${p.m.toFixed(2)}`, 'ref')}
      {box(14, yC - 28, 150, 56, 'Carrier', `triangle, ${formatSI(p.fc, 'Hz')}`, 'carrier')}

      {/* comparator */}
      <g {...part('cmp', `Comparator, output ${st.gate ? 'HIGH' : 'LOW'}`)}>
        <path d="M200 80 L290 120 L200 160 Z" className={`pblock ${st.gate ? 'pblock--on' : ''}`} />
        <text x={236} y={125} className="clabel" textAnchor="middle">
          |r| &gt; |c| ?
        </text>
      </g>
      {values && (
        <>
          <text x={186} y={yR - 6} textAnchor="start" className="cvalue cvalue--strong">
            |r| = {p.m.toFixed(3)}
          </text>
          <text x={186} y={yC + 16} textAnchor="start" className="cvalue cvalue--strong">
            |c| = {Math.abs(st.carrier).toFixed(3)}
          </text>
        </>
      )}
      <g transform="translate(270, 146)">
        <rect width={38} height={18} rx={9} className={`dchip ${st.gate ? 'dchip--on-q' : ''}`} />
        <text x={19} y={13} textAnchor="middle" className="dchip-text">
          {st.gate ? 'HIGH' : 'LOW'}
        </text>
      </g>

      {box(320, 92, 100, 56, 'Steering', pos ? '+ half → A' : '− half → B', 'steer', st.gate)}

      {/* full bridge */}
      <g {...part('bridge', `Full bridge, vAB = ${formatV(st.vout)}`)}>
        <rect x={XA - 40} y={34} width={XB - XA + 70} height={180} rx={10} className="cpart-hit" />
        {showPath && (
          // the connection the switches make at the cursor (a static band: the modulator lab simulates no load current)
          <path
            d={s1 && !s3 ? `M${XA} 44 V120 H${XB} V196` : s3 && !s1 ? `M${XB} 44 V120 H${XA} V196` : s1 && s3 ? `M${XA} 120 V44 H${XB} V120 Z` : `M${XA} 120 V196 H${XB} V120 Z`}
            className={`fsys-applied ${s1 === s3 ? 'fsys-applied--zero' : ''}`}
          />
        )}
        <path d={`M${XA} 44 H${XB} M${XA} 196 H${XB}`} className="sym" />
        <path d={`M${XA} 44 V58 M${XA} 88 V112 M${XA} 128 V152 M${XA} 182 V196`} className="sym" />
        <path d={`M${XB} 44 V58 M${XB} 88 V112 M${XB} 128 V152 M${XB} 182 V196`} className="sym" />
        {sw(XA, 58, 'S1', s1, false)}
        {sw(XA, 152, 'S2', !s1, true)}
        {sw(XB, 58, 'S3', s3, false)}
        {sw(XB, 152, 'S4', !s3, true)}
        <circle cx={XA} cy={120} r={4} className="node-dot" />
        <circle cx={XB} cy={120} r={4} className="node-dot" />
        <path d={`M${XA} 120 H${XA + 30} M${XB - 30} 120 H${XB}`} className="wire wire--load" />
        <rect x={XA + 30} y={112} width={XB - XA - 60} height={16} rx={2} className="sym-body" />
        <text x={(XA + XB) / 2} y={106} textAnchor="middle" className="cvalue">
          load
        </text>
        <text x={XA - 10} y={124} textAnchor="end" className="clabel">
          A
        </text>
        <text x={XB + 10} y={124} textAnchor="start" className="clabel">
          B
        </text>
        <text x={(XA + XB) / 2} y={38} textAnchor="middle" className="cvalue">
          +Vdc = {formatV(p.vdc, false)}
        </text>
        {live && (
          <text x={(XA + XB) / 2} y={146} textAnchor="middle" className="cvalue cvalue--out">
            vAB {formatV(st.vout)}
          </text>
        )}
      </g>
      <text x={345} y={256} className="path-caption" textAnchor="middle">
        {st.gate ? (pos ? 'pulse: S1 + S4 conduct, vAB = +Vdc' : 'pulse: S3 + S2 conduct, vAB = −Vdc') : 'between pulses: S2 + S4 short the load, vAB = 0'}
        {live && ` · θ = ${st.theta.toFixed(1)}° · pulse ${st.slot} of ${p.p}`}
        {live && st.gate && st.pulse ? ` · this pulse ${formatTime(st.pulse.end - st.pulse.start)}` : ''}
      </text>
    </svg>
  )
}
