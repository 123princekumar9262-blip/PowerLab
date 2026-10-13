import type { BatteryState } from '../../converters/ev/batteryContent.ts'
import type { BatteryRun } from '../../converters/ev/battery.ts'
import { formatA, formatV } from '../../utils/format.ts'
import './evsub.css'

interface Props {
  st: BatteryState
  r: BatteryRun
  selected: string | null
  onSelect: (part: string) => void
  /** Standard and Engineer: live cell voltages and SOC. */
  live: boolean
  /** Engineer: the RC polarisation of each cell too. */
  values: boolean
  showPath: boolean
}

const TOP = 93
const H = 90
const BOT = TOP + H
const X0 = 24
const X1 = 476
const RAIL_P = 34
const RAIL_N = 258
const XW = 640

/**
 * The pack: a series string of cells (fill = state of charge), a bleed resistor above each cell (lit while the
 * BMS bleeds it), the contactor, the BMS and the load or charger. Every value is read from the simulated sample
 * at the cursor.
 */
export function BatteryDiagram({ st, r, selected, onSelect, live, values, showPath }: Props) {
  const p = r.params
  const n = p.n
  const pitch = (X1 - X0) / n
  const cw = Math.min(36, pitch * 0.62)
  const cx = (i: number) => X0 + pitch * (i + 0.5)
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
  const cut = r.events.find((e) => e.device === 'cutoff')
  const cutCell = cut && st.t >= cut.time - 1e-9 ? (cut.values.cell ?? 0) - 1 : -1
  const flowing = Math.abs(st.I) > 1e-9
  const wire = showPath && flowing ? 'wire wire--flow' : `wire ${flowing ? (st.I > 0 ? 'wire--igbt' : 'wire--diode') : ''}`
  const fillColor = (s: number) => (s > 30 ? '#199e70' : s > 15 ? '#c98500' : '#e66767')
  const contactorOpen = st.cutOff && st.phaseKind === 'rest' && !flowing
  const held = st.mode === 3 ? st.hi : -1
  const bleedOn = st.cells.some((c) => c.bleed)
  return (
    <svg className="buck-diagram evb-diagram" viewBox="0 0 690 270" role="group" aria-label={`Battery pack of ${n} cells: ${st.label}. Lowest cell ${st.lo + 1} at ${st.cells[st.lo].v.toFixed(3)} V.`}>
      {/* series straps between the cells: + (top) of one to − (bottom) of the next */}
      {st.cells.slice(0, -1).map((c) => (
        <path key={`s${c.i}`} d={`M${cx(c.i) + cw / 2 - 3} ${TOP + 2} L${cx(c.i + 1) - cw / 2 + 3} ${BOT - 2}`} className={wire} />
      ))}
      {/* pack + : from the last cell to the contactor, the load */}
      <path d={`M${cx(n - 1) + cw / 2} ${TOP + 8} H490 V${RAIL_P} H515`} className={wire} />
      <path d={`M547 ${RAIL_P} H${XW} V160`} className={wire} />
      {/* pack − */}
      <path d={`M${cx(0) - cw / 2} ${BOT - 8} H10 V${RAIL_N} H${XW} V214`} className={wire} />
      <text x={18} y={BOT - 14} textAnchor="middle" className="clabel">
        −
      </text>
      <text x={478} y={RAIL_P + 4} textAnchor="end" className="clabel">
        +
      </text>
      <text x={X0} y={48} className="cvalue evb-small">
        bleed resistors{bleedOn ? ' (lit = on)' : ''}
      </text>
      {st.cells.map((c) => {
        const x = cx(c.i)
        const hFill = (H - 4) * Math.max(0, Math.min(1, c.s / 100))
        const outline = c.i === cutCell ? 'evb-cell--cut' : c.i === held ? 'evb-cell--held' : st.mode === 1 && c.i === st.lo ? 'evb-cell--low' : ''
        const label = `Cell ${c.i + 1}: ${c.v.toFixed(3)} V, SOC ${c.s.toFixed(1)} %${c.bleed ? ', bleeding' : ''}`
        return (
          <g key={c.i} {...part(`cell${c.i + 1}`, label)}>
            <rect x={x - pitch / 2 + 1} y={52} width={pitch - 2} height={180} className="cpart-hit" />
            <rect x={x - cw * 0.3} y={56} width={cw * 0.6} height={10} rx={2} className={`evb-bleed ${c.bleed ? 'evb-bleed--on' : ''}`} />
            <text x={x} y={84} textAnchor="middle" className="clabel">
              {c.i + 1}
            </text>
            <rect x={x - cw * 0.22} y={TOP - 5} width={cw * 0.44} height={5} rx={1.5} className="evb-nub" />
            <rect x={x - cw / 2} y={TOP} width={cw} height={H} rx={4} className={`evb-cell ${outline}`} />
            <rect x={x - cw / 2 + 2} y={BOT - 2 - hFill} width={cw - 4} height={hFill} rx={2.5} fill={fillColor(c.s)} className="evb-fill" />
            {live && (
              <>
                <text x={x} y={BOT + 16} textAnchor="middle" className="evb-val">
                  {c.v.toFixed(3)}
                </text>
                <text x={x} y={BOT + 29} textAnchor="middle" className="evb-val evb-val--soc">
                  {c.s.toFixed(0)}%
                </text>
              </>
            )}
            {values && (
              <text x={x} y={BOT + 42} textAnchor="middle" className="evb-val evb-val--pol">
                {((c.u + c.w) * 1000).toFixed(0)}m
              </text>
            )}
          </g>
        )
      })}
      {live && (
        <text x={X0} y={BOT + 56} className="cvalue evb-small">
          cell voltage [V] · state of charge{values ? ' · RC polarisation [mV]' : ''}
        </text>
      )}
      {/* contactor */}
      <g {...part('pack', `Contactor ${contactorOpen ? 'open' : 'closed'}`)}>
        <rect x={505} y={14} width={52} height={32} className="cpart-hit" />
        <circle cx={517} cy={RAIL_P} r={3.5} className="sym-dot" />
        <circle cx={545} cy={RAIL_P} r={3.5} className="sym-dot" />
        {contactorOpen ? <line x1={517} y1={RAIL_P} x2={542} y2={RAIL_P - 14} className="sym" /> : <line x1={517} y1={RAIL_P} x2={545} y2={RAIL_P} className="sym" />}
        <text x={531} y={20} textAnchor="middle" className="cvalue evb-small">
          contactor
        </text>
      </g>
      {/* BMS */}
      <g {...part('bms', 'Battery management system')}>
        <rect x={500} y={62} width={116} height={78} className="cpart-hit" />
        <rect x={503} y={65} width={110} height={72} rx={8} className={`pblock ${bleedOn ? 'pblock--on' : ''}`} />
        <text x={558} y={84} textAnchor="middle" className="clabel">
          BMS
        </text>
        <text x={558} y={102} textAnchor="middle" className="cvalue">
          {live ? `SOC ${st.soce.toFixed(1)} %` : 'counts charge'}
        </text>
        <text x={558} y={118} textAnchor="middle" className="cvalue evb-small">
          {bleedOn ? `balancing ${st.bleeding.length} cell${st.bleeding.length === 1 ? '' : 's'}` : p.balancing === 'on' ? 'balancing: idle' : 'balancing: off'}
        </text>
        <text x={558} y={131} textAnchor="middle" className="cvalue evb-small">
          {p.vmin.toFixed(2)} … {p.vmax.toFixed(2)} V
        </text>
      </g>
      {/* load or charger */}
      <g {...part('load', st.I < 0 ? 'Charger' : 'Load')}>
        <rect x={590} y={156} width={100} height={62} className="cpart-hit" />
        <rect x={594} y={160} width={92} height={54} rx={8} className={`pblock ${flowing ? 'pblock--on' : ''}`} />
        <text x={XW} y={181} textAnchor="middle" className="clabel">
          {st.phaseKind === 'charge' || st.I < 0 ? 'charger' : 'load'}
        </text>
        <text x={XW} y={200} textAnchor="middle" className="cvalue">
          {st.mode === 3 ? 'CV · ' : st.mode === 2 ? 'CC · ' : ''}
          {live ? formatA(Math.abs(st.I)) : flowing ? 'on' : 'off'}
        </text>
      </g>
      {live && (
        <text x={565} y={RAIL_N - 8} textAnchor="middle" className="cvalue cvalue--strong">
          {formatV(st.vpack, false)}
          {flowing ? ` · ${st.I > 0 ? '→ load' : '← charger'}` : ''}
        </text>
      )}
    </svg>
  )
}
