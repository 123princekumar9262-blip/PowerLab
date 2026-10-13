import type { BldcState } from '../../converters/bldc/content.ts'
import { D_LO, D_UP, LOWER, UPPER } from '../../converters/bldc/content.ts'
import type { ResolvedBldc } from '../../converters/bldc/model.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'
import './bldc.css'

interface Props {
  st: BldcState
  p: ResolvedBldc
  selected: string | null
  onSelect: (part: string) => void
  values: boolean
  live: boolean
  /** Animate the conventional current at the cursor (DiagramProps.showPath). */
  showPath?: boolean
  /** Currents at or below this magnitude count as zero (1e-3 of the run's peak phase current). */
  iFloor?: number
}

const TOP = 40
const BOT = 220
const MID = 130
const XS = [115, 210, 305]
const XDC = 62
const ROWS = [72, 130, 188]
const PH = ['a', 'b', 'c']
const PHASE_COLOR = ['#d55181', '#c98500', '#3987e5']

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

/** One switch position (switch box + antiparallel diode to its right), highlighted by the simulated device. */
function Position({ x, y0, y1, sw, d, st, gated, selected, onSelect, plain }: { x: number; y0: number; y1: number; sw: string; d: string; st: BldcState; gated: boolean; selected: string | null; onSelect: (x: string) => void; plain: boolean }) {
  const cy = (y0 + y1) / 2
  // with the current path shown, the moving dashes carry the conduction state: the wires stay plain underneath
  const sOn = st.device.includes(sw) && !plain
  const dOn = st.device.includes(d) && !plain
  return (
    <g>
      <line x1={x} x2={x} y1={y0} y2={cy - 16} className={`wire ${sOn ? 'wire--igbt' : dOn ? 'wire--diode' : ''}`} />
      <line x1={x} x2={x} y1={cy + 16} y2={y1} className={`wire ${sOn ? 'wire--igbt' : dOn ? 'wire--diode' : ''}`} />
      <g {...partProps(sw.toLowerCase(), `${sw} ${sOn ? 'conducting' : gated ? 'gated' : 'off'}`, selected, onSelect)}>
        <rect x={x - 14} y={cy - 16} width={28} height={32} rx={5} className={`pswitch ${st.device.includes(sw) ? 'pswitch--on' : ''}`} />
        <text x={x} y={cy + 4} textAnchor="middle" className="dchip-text">
          {sw}
        </text>
        {gated && <circle cx={x - 22} cy={cy} r={4} className="gate-dot" />}
      </g>
      <g {...partProps(d.toLowerCase(), `${d} ${dOn ? 'conducting' : 'off'}`, selected, onSelect)}>
        <path d={`M${x} ${y0 + 6} H${x + 34} V${y1 - 6} H${x}`} className={`wire wire--thin ${dOn ? 'wire--diode' : ''}`} />
        <path d={`M${x + 24} ${cy + 8} H${x + 44} L${x + 34} ${cy - 8} Z`} className={`sym-fill ${st.device.includes(d) ? 'sym-fill--on-d' : ''}`} />
        <line x1={x + 24} x2={x + 44} y1={cy - 8} y2={cy - 8} className="sym" />
        <text x={x + 48} y={cy + 4} className="cvalue chalo">
          {d}
        </text>
      </g>
    </g>
  )
}

/** Inverter + star-connected BLDC windings (R, L, trapezoidal EMF) + rotor with Hall sensors. */
/** Polyline → SVG path, in the given order or reversed (so the dashes run with the conventional current). */
const poly = (pts: Array<[number, number]>, fwd: boolean) => {
  const q = fwd ? pts : [...pts].reverse()
  return `M${q.map(([x, y]) => `${x} ${y}`).join(' L')}`
}

/**
 * Every branch carrying current at the cursor, as path strings in the direction of conventional current. All
 * from the simulated state: the phase currents st.i (positive = from the leg into the winding) and the device
 * carrying each leg's current (st.device, from the simulated leg states and the current's sign). Rail segments
 * carry the sum of the legs beyond them; the supply branch carries their total. Bodies of the switches, diodes,
 * resistors, coils and EMF sources are skipped: the dashes sit on wires only.
 */
function bldcFlow(st: BldcState, floor: number): string[] {
  const out: string[] = []
  const on = (v: number) => Math.abs(v) > floor
  const top = [0, 0, 0] // current each leg draws from the + rail into its phase
  const bot = [0, 0, 0] // current each leg draws from the − rail into its phase
  const phaseWire: Array<Array<[number, number]>> = [
    [[XS[0], MID], [XS[0] + 40, MID], [XS[0] + 40, 108], [392, 108], [392, ROWS[0]], [405, ROWS[0]]],
    [[XS[1], MID], [XS[1] + 40, MID], [XS[1] + 40, 117], [398, 117], [398, ROWS[1]], [405, ROWS[1]]],
    [[XS[2], MID], [XS[2] + 40, MID], [XS[2] + 40, ROWS[2]], [405, ROWS[2]]],
  ]
  const uCy = (TOP + MID) / 2
  const lCy = (MID + BOT) / 2
  for (let k = 0; k < 3; k++) {
    const i = st.i[k]
    const dev = st.device[k]
    if (!on(i) || dev === null) continue
    const x = XS[k]
    if (dev === UPPER[k]) {
      top[k] = i
      out.push(`M${x} ${TOP} V${uCy - 16}`, `M${x} ${uCy + 16} V${MID}`)
    } else if (dev === D_UP[k]) {
      top[k] = i
      out.push(`M${x} ${MID} V${MID - 6} H${x + 34} V${uCy + 8}`, `M${x + 34} ${uCy - 8} V${TOP + 6} H${x} V${TOP}`)
    } else if (dev === LOWER[k]) {
      bot[k] = i
      out.push(`M${x} ${MID} V${lCy - 16}`, `M${x} ${lCy + 16} V${BOT}`)
    } else if (dev === D_LO[k]) {
      bot[k] = i
      out.push(`M${x} ${BOT} V${BOT - 6} H${x + 34} V${lCy + 8}`, `M${x + 34} ${lCy - 8} V${MID + 6} H${x} V${MID}`)
    }
    const fwd = i > 0
    out.push(poly(phaseWire[k], fwd))
    const y = ROWS[k]
    for (const [a, b] of [[405, 412], [440, 448], [487, 500], [522, 548]]) out.push(fwd ? `M${a} ${y} H${b}` : `M${b} ${y} H${a}`)
    // star bar: phase a enters at the top, c at the bottom, b at the star point itself
    if (k === 0) out.push(fwd ? `M548 ${ROWS[0]} V${MID}` : `M548 ${MID} V${ROWS[0]}`)
    if (k === 2) out.push(fwd ? `M548 ${ROWS[2]} V${MID}` : `M548 ${MID} V${ROWS[2]}`)
  }
  // rails: segment j (left of leg j) carries the legs j..2; positive = towards the legs (rightwards)
  const xs = [XDC, ...XS]
  for (let j = 0; j < 3; j++) {
    const it = top.slice(j).reduce((a, b) => a + b, 0)
    const ib = bot.slice(j).reduce((a, b) => a + b, 0)
    if (on(it)) out.push(it > 0 ? `M${xs[j]} ${TOP} H${xs[j + 1]}` : `M${xs[j + 1]} ${TOP} H${xs[j]}`)
    if (on(ib)) out.push(ib > 0 ? `M${xs[j]} ${BOT} H${xs[j + 1]}` : `M${xs[j + 1]} ${BOT} H${xs[j]}`)
    if (j === 0) {
      // the supply: out of + into the top rail and back into − from the bottom rail when it delivers power
      if (on(it)) out.push(it > 0 ? `M${XDC} ${MID - 9} V${TOP}` : `M${XDC} ${TOP} V${MID - 9}`)
      if (on(ib)) out.push(ib > 0 ? `M${XDC} ${MID + 9} V${BOT}` : `M${XDC} ${BOT} V${MID + 9}`)
    }
  }
  return out
}

export function BldcDiagram({ st, p, selected, onSelect, values, live, showPath = false, iFloor = 0 }: Props) {
  const flow = showPath ? bldcFlow(st, iFloor) : []
  const legGate = (x: number, upper: boolean) => (upper ? st.legs[x] === 'H' : st.legs[x] === 'L')
  // phase wires: through the gap between the upper and lower positions, crossing the other legs as plain crossings
  const phaseWire = [`M${XS[0]} ${MID} H${XS[0] + 40} V108 H392 V${ROWS[0]} H405`, `M${XS[1]} ${MID} H${XS[1] + 40} V117 H398 V${ROWS[1]} H405`, `M${XS[2]} ${MID} H${XS[2] + 40} V${ROWS[2]} H405`]
  const XN = 548
  const cx = 622
  const cy = 104
  const R = 42
  const th = (st.theta * Math.PI) / 180
  const nx = Math.cos(th)
  const ny = -Math.sin(th)
  const hallAng = [120, 240, 0]
  return (
    <svg className="buck-diagram inv-diagram bldc-diagram" viewBox="0 0 690 270" role="group" aria-label={`BLDC drive: sector ${st.sector + 1}, ${st.device.filter(Boolean).join(', ') || 'no device'} conducting`}>
      {/* DC rails and source */}
      <line x1={XDC} x2={XS[2]} y1={TOP} y2={TOP} className="wire" />
      <line x1={XDC} x2={XS[2]} y1={BOT} y2={BOT} className="wire" />
      <line x1={XDC} x2={XDC} y1={TOP} y2={BOT} className="wire" />
      <g {...partProps('vdc', `DC supply ${formatV(p.vdc, false)}`, selected, onSelect)}>
        <rect x={XDC - 22} y={MID - 22} width={44} height={44} className="cpart-hit" />
        <rect x={XDC - 18} y={MID - 9} width={36} height={18} className="gap-mask" />
        <line x1={XDC - 16} x2={XDC + 16} y1={MID - 6} y2={MID - 6} className="sym" />
        <line x1={XDC - 9} x2={XDC + 9} y1={MID + 6} y2={MID + 6} className="sym sym--thick" />
        <text x={XDC - 24} y={MID + 30} className="cvalue" textAnchor="end">
          Vdc
        </text>
        <text x={XDC - 24} y={MID + 44} className="cvalue" textAnchor="end">
          {Number(p.vdc.toPrecision(3))} V
        </text>
      </g>
      {live && (
        <text x={XDC} y={TOP - 10} className="cvalue">
          idc {formatA(st.idc, true)}
        </text>
      )}
      {/* three legs */}
      {XS.map((x, i) => (
        <g key={i}>
          <Position x={x} y0={TOP} y1={MID} sw={UPPER[i]} d={D_UP[i]} st={st} gated={legGate(i, true)} selected={selected} onSelect={onSelect} plain={showPath} />
          <Position x={x} y0={MID} y1={BOT} sw={LOWER[i]} d={D_LO[i]} st={st} gated={legGate(i, false)} selected={selected} onSelect={onSelect} plain={showPath} />
          <circle cx={x} cy={MID} r={4} className="node-dot" />
        </g>
      ))}
      {/* phase wires and windings */}
      {phaseWire.map((d, i) => (
        <path key={`w${i}`} d={d} className="wire wire--load" style={{ stroke: PHASE_COLOR[i] }} />
      ))}
      {ROWS.map((y, i) => {
        const on = st.device[i] !== null
        const coil = `M448 ${y} ${Array.from({ length: 3 }, () => 'a6.5 6.5 0 0 1 13 0').join(' ')}`
        return (
          <g key={`ph${i}`} {...partProps(`ph-${PH[i]}`, `Phase ${PH[i]}: ${formatA(st.i[i], true)}, back-EMF ${formatV(st.e[i])}`, selected, onSelect)}>
            <rect x={404} y={y - 22} width={XN - 400} height={40} className="cpart-hit" />
            <line x1={405} x2={412} y1={y} y2={y} className={`wire ${on && !showPath ? 'bldc-wire--on' : ''}`} />
            <rect x={412} y={y - 6} width={28} height={12} rx={2} className="sym-body" />
            <line x1={440} x2={448} y1={y} y2={y} className="wire" />
            <path d={coil} className="sym sym--coil" />
            <line x1={487} x2={500} y1={y} y2={y} className="wire" />
            <circle cx={511} cy={y} r={11} className="sym-body" />
            <text x={511} y={y + 4} textAnchor="middle" className="bldc-emf">
              e{PH[i]}
            </text>
            <line x1={522} x2={XN} y1={y} y2={y} className="wire" />
            <text x={408} y={y - 11} className="cvalue" style={{ fill: PHASE_COLOR[i] }}>
              {PH[i]}
              {values ? ` ${formatA(st.i[i], true)}` : ''}
            </text>
            {live && (
              <text x={XN - 2} y={y - 15} textAnchor="end" className="cvalue chalo">
                {formatV(st.e[i])}
              </text>
            )}
          </g>
        )
      })}
      <line x1={XN} x2={XN} y1={ROWS[0]} y2={ROWS[2]} className="wire" />
      <circle cx={XN} cy={MID} r={4} className="node-dot" />
      {/* moving conventional current at the cursor, from the simulated state (drawn on the wires only) */}
      {flow.map((d) => (
        <path key={d} d={d} className="wire wire--flow" pointerEvents="none" />
      ))}
      <text x={XN + 6} y={MID + 16} className="clabel">
        n
      </text>
      <text x={470} y={ROWS[2] + 28} textAnchor="middle" className="cvalue">
        each phase {formatSI(p.r, 'Ω')} + {formatSI(p.l, 'H')}
      </text>
      {/* rotor with Hall sensors */}
      <g {...partProps('rotor', `Rotor at ${st.theta.toFixed(0)}° electrical, Hall code ${st.hall.join('')}`, selected, onSelect)}>
        <circle cx={cx} cy={cy} r={R + 8} className="cpart-hit" />
        <circle cx={cx} cy={cy} r={R} className="bldc-stator" />
        <circle cx={cx} cy={cy} r={26} className="bldc-rotor" />
        <path d={`M${cx} ${cy} L${cx + 24 * nx} ${cy + 24 * ny}`} className="bldc-north" />
        <path d={`M${cx} ${cy} L${cx - 24 * nx} ${cy - 24 * ny}`} className="bldc-south" />
        <text x={cx + 13 * nx} y={cy + 13 * ny + 4} textAnchor="middle" className="bldc-pole">
          N
        </text>
        <text x={cx - 13 * nx} y={cy - 13 * ny + 4} textAnchor="middle" className="bldc-pole">
          S
        </text>
        {hallAng.map((a, i) => {
          const ar = (a * Math.PI) / 180
          const hx = cx + R * Math.cos(ar)
          const hy = cy - R * Math.sin(ar)
          const lx = cx + (R + 14) * Math.cos(ar)
          const ly = cy - (R + 14) * Math.sin(ar)
          return (
            <g key={i}>
              <rect x={hx - 5} y={hy - 5} width={10} height={10} rx={2} className={`bldc-hall ${st.hall[i] ? 'bldc-hall--on' : ''}`} />
              <text x={lx} y={ly + 4} textAnchor="middle" className="cvalue chalo">
                H{PH[i]}
              </text>
            </g>
          )
        })}
      </g>
      <text x={cx} y={cy + R + 26} textAnchor="middle" className="clabel">
        Hall {st.hall.join('')}
      </text>
      {live && (
        <text x={cx} y={cy + R + 42} textAnchor="middle" className="cvalue cvalue--out">
          {st.n.toFixed(0)} rpm
        </text>
      )}
      <g {...partProps('load', `Load torque ${st.tl.toFixed(3)} N·m`, selected, onSelect)}>
        <rect x={cx - 46} y={cy + R + 48} width={92} height={22} className="cpart-hit" />
        <text x={cx} y={cy + R + 63} textAnchor="middle" className="cvalue">
          load {st.tl.toFixed(2)} N·m
        </text>
      </g>
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        Sector {st.sector + 1} · {PH[st.hi]}+ {PH[st.lo]}−{st.outgoing !== null ? ` · commutating: ${PH[st.outgoing]} via ${st.device[st.outgoing]}` : ''}
        {p.chop === 'pwm' ? ` · PWM ${st.gate ? 'on' : 'off'}` : ' · six-step'}
        {live ? ` · Te ${st.te.toFixed(3)} N·m` : ''}
      </text>
    </svg>
  )
}
