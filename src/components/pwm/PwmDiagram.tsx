import type { PwmState } from '../../converters/pwm/content.ts'
import type { ResolvedPwm } from '../../converters/pwm/modulator.ts'
import { formatTime, formatV } from '../../utils/format.ts'

interface Props {
  st: PwmState
  p: ResolvedPwm
  selected: string | null
  onSelect: (part: string) => void
  values: boolean
  /** Live numbers (Standard and Engineer). */
  live?: boolean
}

/**
 * The modulator as a block diagram: reference (→ sample & hold) and carrier into a comparator, its
 * output into the dead-time block and a half-bridge output stage. Values and states are the
 * simulated ones at the cursor; the active path is highlighted.
 */
export function PwmDiagram({ st, p, selected, onSelect, values, live = true }: Props) {
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
  const sampled = p.sampling !== 'natural'
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
  const yR = 70
  const yC = 170
  return (
    <svg className="buck-diagram pwm-diagram" viewBox="0 0 690 270" role="group" aria-label={`PWM modulator. Gate ${st.gate ? 'HIGH' : 'LOW'}.`}>
      {/* wires */}
      <path d={`M150 ${yR} H${sampled ? 190 : 330} ${sampled ? '' : `V${yR + 35} H350`}`} className="wire wire--sig" />
      {sampled && <path d={`M300 ${yR} H330 V${yR + 35} H350`} className="wire wire--sig" />}
      <path d={`M150 ${yC} H330 V${yC - 35} H350`} className="wire wire--sig" />
      <path d={`M450 120 H490`} className={`wire ${st.gate ? 'wire--hi' : 'wire--sig'}`} />
      <path d={`M580 100 H610`} className={`wire ${st.gh ? 'wire--hi' : 'wire--sig'}`} />
      <path d={`M580 140 H610`} className={`wire ${st.gl ? 'wire--hi' : 'wire--sig'}`} />

      {box(20, yR - 28, 130, 56, 'Reference r(t)', p.reference === 'dc' ? `DC, D = ${(p.duty * 100).toFixed(0)} %` : `sine, M = ${p.m.toFixed(2)}`, 'ref')}
      {sampled && box(190, yR - 28, 110, 56, 'Sample & hold', p.sampling === 'regular-sym' ? 'once per Tc' : 'twice per Tc', 'sh')}
      {box(20, yC - 28, 130, 56, 'Carrier c(t)', `${p.carrier}, ${p.fcEff >= 1000 ? `${(p.fcEff / 1000).toFixed(2)} kHz` : `${p.fcEff.toFixed(0)} Hz`}`, 'carrier')}

      {/* comparator */}
      <g {...part('cmp', `Comparator, output ${st.gate ? 'HIGH' : 'LOW'}`)}>
        <path d="M350 80 L450 120 L350 160 Z" className={`pblock ${st.gate ? 'pblock--on' : ''}`} />
        <text x={362} y={110} className="cvalue">
          +
        </text>
        <text x={362} y={140} className="cvalue">
          −
        </text>
        <text x={395} y={125} className="clabel" textAnchor="middle">
          r &gt; c ?
        </text>
      </g>
      {values && (
        <>
          <text x={322} y={yR + 28} textAnchor="end" className="cvalue cvalue--strong">
            r = {st.cmp.toFixed(3)}
          </text>
          <text x={322} y={yC - 18} textAnchor="end" className="cvalue cvalue--strong">
            c = {st.carrier.toFixed(3)}
          </text>
        </>
      )}
      <g transform="translate(452, 128)">
        <rect width={38} height={18} rx={9} className={`dchip ${st.gate ? 'dchip--on-q' : ''}`} />
        <text x={19} y={13} textAnchor="middle" className="dchip-text">
          {st.gate ? 'HIGH' : 'LOW'}
        </text>
      </g>

      {box(490, 92, 90, 56, 'Dead time', p.td > 0 ? formatTime(p.td) : 'none', 'dt', st.gh || st.gl)}

      {/* output stage: half-bridge */}
      <g {...part('out', `Output stage, vout = ${formatV(st.vout)}`)}>
        <rect x={610} y={60} width={70} height={130} rx={10} className="pblock" />
        <line x1={645} y1={70} x2={645} y2={180} className="sym" />
        <rect x={632} y={78} width={26} height={30} rx={4} className={`pswitch ${st.gh ? 'pswitch--on' : ''}`} />
        <rect x={632} y={142} width={26} height={30} rx={4} className={`pswitch ${st.gl ? 'pswitch--on-l' : ''}`} />
        <text x={645} y={98} textAnchor="middle" className="dchip-text">
          GH
        </text>
        <text x={645} y={162} textAnchor="middle" className="dchip-text">
          GL
        </text>
        <circle cx={645} cy={125} r={4} className="node-dot" />
        {live && (
          <text x={645} y={208} textAnchor="middle" className="cvalue cvalue--out">
            vout {formatV(st.vout)}
          </text>
        )}
        <text x={645} y={54} textAnchor="middle" className="cvalue">
          {p.output === 'bipolar' ? `±${formatV(p.vdc / 2, false)}` : `0 … ${formatV(p.vdc, false)}`}
        </text>
      </g>
      <text x={345} y={256} className="path-caption" textAnchor="middle">
        {st.gate ? 'r > c: upper switch commanded ON' : 'r < c: lower switch commanded ON'}
        {live && ` · local duty ${(st.localDuty * 100).toFixed(1)} %`}
        {live && st.pulse ? ` · this pulse ${formatTime(st.pulse.end - st.pulse.start)}` : ''}
      </text>
    </svg>
  )
}
