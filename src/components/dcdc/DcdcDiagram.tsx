import type { DcdcPart, DcdcState } from '../../converters/dcdc/explain.ts'
import type { ResolvedConverter } from '../../converters/types.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'

interface Props {
  st: DcdcState
  params: ResolvedConverter
  showPath: boolean
  selected: string | null
  onSelect: (part: DcdcPart) => void
  values: boolean
}

const TOP = 62
const GND = 214
const MID = (TOP + GND) / 2

/**
 * Buck, boost and buck-boost schematics. Every state shown (device ON/OFF, which branches carry
 * current and in which direction, the capacitor charging or discharging) is read from the simulated
 * sample at the cursor. Wires are drawn in the direction conventional current flows when active.
 */
export function DcdcDiagram({ st, params, showPath, selected, onSelect, values }: Props) {
  const kind = st.kind
  const on = st.interval === 'on'
  const off = st.interval === 'off'
  const idle = st.interval === 'idle'
  const w = (active: boolean, d: string, key?: string) => <path key={key ?? d} className={showPath && active ? 'wire wire--flow' : 'wire'} d={d} />
  const part = (id: DcdcPart, label: string) => ({
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
  // |vC| growing: the capacitor charges (current into its + plate, which is the top for buck/boost and the bottom for buck-boost).
  const cActive = Math.abs(st.ic) > 1e-6
  const cDown = st.ic >= 0 // conventional current flows top → bottom through C
  const rDown = st.io >= 0
  const X = { src: 92, out: 488, r: 598 }

  // ── Shared output section: C and R from the output rail to ground ────────────
  const outRail = (feedActive: boolean, fromX: number) => (
    <>
      {w(feedActive || cActive || true, rDown ? `M${fromX} ${TOP} H${X.r}` : `M${X.r} ${TOP} H${fromX}`, 'out-r')}
      {w(true, rDown ? `M${X.r} ${TOP} V${GND}` : `M${X.r} ${GND} V${TOP}`, 'r-branch')}
      {w(true, rDown ? `M${X.r} ${GND} H${X.out}` : `M${X.out} ${GND} H${X.r}`, 'g-r')}
      {w(cActive, cDown ? `M${X.out} ${TOP} V${GND}` : `M${X.out} ${GND} V${TOP}`, 'c-branch')}
    </>
  )

  const source = (
    <g {...part('vin', `Input source Vin = ${params.vin} V`)}>
      <rect x={X.src - 22} y={MID - 26} width={44} height={52} className="cpart-hit" />
      <rect x={X.src - 18} y={MID - 9} width={36} height={18} className="gap-mask" />
      <line x1={X.src - 16} x2={X.src + 16} y1={MID - 6} y2={MID - 6} className="sym" />
      <line x1={X.src - 9} x2={X.src + 9} y1={MID + 6} y2={MID + 6} className="sym sym--thick" />
      <text x={X.src - 26} y={MID + 4} className="clabel" textAnchor="end">
        Vin
      </text>
      <text x={X.src - 26} y={MID + 18} className="cvalue" textAnchor="end">
        {formatV(params.vin, false)}
      </text>
    </g>
  )
  const chip = (x: number, y: number, isOn: boolean, tone: 'q' | 'd') => (
    <g transform={`translate(${x}, ${y})`}>
      <rect width={44} height={18} rx={9} className={`dchip ${isOn ? `dchip--on-${tone}` : ''}`} />
      <text x={22} y={13} textAnchor="middle" className="dchip-text">
        {isOn ? 'ON' : 'OFF'}
      </text>
    </g>
  )
  /** Switch: horizontal between x0..x1 at y, or vertical between y0..y1 at x. */
  const qSwitch = (orient: 'h' | 'v', a: number, b: number, c: number) => {
    const [x0, y0, x1, y1] = orient === 'h' ? [a, c, b, c] : [c, a, c, b]
    const open = orient === 'h' ? { x2: x1 - 6, y2: y0 - 22 } : { x2: x0 + 22, y2: y1 - 6 }
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    return (
      <g {...part('q1', `Switch Q1, ${st.qOn ? 'ON' : 'OFF'}`)}>
        <rect x={Math.min(x0, x1) - 26} y={Math.min(y0, y1) - 30} width={Math.abs(x1 - x0) + 52} height={Math.abs(y1 - y0) + 52} className="cpart-hit" />
        <circle cx={x0} cy={y0} r={3.5} className="sym-dot" />
        <circle cx={x1} cy={y1} r={3.5} className="sym-dot" />
        {st.qOn ? <line x1={x0} y1={y0} x2={x1} y2={y1} className="sym sym--on-q" /> : <line x1={x0} y1={y0} x2={open.x2} y2={open.y2} className="sym" />}
        {orient === 'h' ? (
          <>
            <text x={cx} y={y0 - 34} className="clabel" textAnchor="middle">
              Q1
            </text>
            {chip(cx - 22, y0 + 12, st.qOn, 'q')}
            <text x={cx} y={y0 + 46} textAnchor="middle" className="cvalue">
              gate {st.gate ? 'HIGH' : 'LOW'}
            </text>
          </>
        ) : (
          <>
            <text x={cx - 16} y={cy - 8} className="clabel" textAnchor="end">
              Q1
            </text>
            {chip(cx - 62, cy + 2, st.qOn, 'q')}
            <text x={cx + 30} y={cy + 30} textAnchor="start" className="cvalue">
              gate {st.gate ? 'HIGH' : 'LOW'}
            </text>
          </>
        )}
      </g>
    )
  }
  /** Diode with its anode at (ax, ay) and cathode at (kx, ky) — horizontal or vertical. */
  const diode = (ax: number, ay: number, kx: number, ky: number, chipAt: [number, number], labelAt: [number, number, 'start' | 'end' | 'middle']) => {
    const cx = (ax + kx) / 2
    const cy = (ay + ky) / 2
    const ux = Math.sign(kx - ax)
    const uy = Math.sign(ky - ay)
    // triangle pointing from anode to cathode
    const tip = [cx + ux * 10, cy + uy * 10]
    const base = [cx - ux * 10, cy - uy * 10]
    const px = -uy * 13
    const py = ux * 13
    return (
      <g {...part('d1', `Diode D1, ${st.dOn ? 'ON' : 'OFF'}`)}>
        <rect x={cx - 26} y={cy - 24} width={52} height={48} className="cpart-hit" />
        <path d={`M${base[0] + px} ${base[1] + py} L${base[0] - px} ${base[1] - py} L${tip[0]} ${tip[1]} Z`} className={`sym-fill ${st.dOn ? 'sym-fill--on-d' : ''}`} />
        <line x1={tip[0] + px} x2={tip[0] - px} y1={tip[1] + py} y2={tip[1] - py} className="sym" />
        <text x={labelAt[0]} y={labelAt[1]} className="clabel" textAnchor={labelAt[2]}>
          D1
        </text>
        {chip(chipAt[0], chipAt[1], st.dOn, 'd')}
      </g>
    )
  }
  const coil = (orient: 'h' | 'v', a: number, c: number) => {
    const d = orient === 'h' ? `M${a} ${c} ${Array.from({ length: 4 }, () => 'a12 12 0 0 1 24 0').join(' ')}` : `M${c} ${a} ${Array.from({ length: 4 }, () => 'a12 12 0 0 1 0 24').join(' ')}`
    const lx = orient === 'h' ? a + 48 : c + 22
    const ly = orient === 'h' ? c - 30 : a + 30
    return (
      <g {...part('l', `Inductor L, iL = ${formatA(st.il)}`)}>
        <rect x={orient === 'h' ? a - 4 : c - 24} y={orient === 'h' ? c - 26 : a - 4} width={orient === 'h' ? 104 : 48} height={orient === 'h' ? 42 : 104} className="cpart-hit" />
        <path d={d} className="sym sym--coil" />
        <text x={lx} y={ly} className="clabel" textAnchor={orient === 'h' ? 'middle' : 'start'}>
          L {formatSI(params.l, 'H')}
        </text>
        {values && (
          <text x={orient === 'h' ? a + 48 : c + 22} y={orient === 'h' ? c + 24 : a + 48} className="cvalue cvalue--il" textAnchor={orient === 'h' ? 'middle' : 'start'}>
            iL {formatA(st.il)} {st.dildt > 1 ? '↗' : st.dildt < -1 ? '↘' : '→'}
          </text>
        )}
      </g>
    )
  }
  const capAndLoad = (
    <>
      <g {...part('c', `Capacitor C, ${st.vc * st.ic >= 0 ? 'charging' : 'discharging'}`)}>
        <rect x={X.out - 24} y={MID - 22} width={48} height={44} className="cpart-hit" />
        <rect x={X.out - 18} y={MID - 9} width={36} height={18} className="gap-mask" />
        <line x1={X.out - 16} x2={X.out + 16} y1={MID - 6} y2={MID - 6} className="sym sym--thick" />
        <line x1={X.out - 16} x2={X.out + 16} y1={MID + 6} y2={MID + 6} className="sym sym--thick" />
        <text x={X.out - 22} y={MID + 4} className="clabel" textAnchor="end">
          C
        </text>
        {values && (
          <text x={X.out - 10} y={GND - 10} className="cvalue" textAnchor="end">
            iC {formatA(st.ic, true)} {st.vc * st.ic >= 0 ? 'charging' : 'discharging'}
          </text>
        )}
      </g>
      <g {...part('r', `Load R = ${params.r} Ω`)}>
        <rect x={X.r - 20} y={MID - 30} width={40} height={60} className="cpart-hit" />
        <rect x={X.r - 9} y={MID - 24} width={18} height={48} rx={2} className="sym-body" />
        <text x={X.r + 16} y={MID - 4} className="clabel" textAnchor="start">
          R
        </text>
        <text x={X.r + 16} y={MID + 10} className="cvalue" textAnchor="start">
          {formatSI(params.r, 'Ω')}
        </text>
      </g>
      <g {...part('out', `Output, Vout = ${formatV(st.vout)}`)}>
        <circle cx={X.out} cy={TOP} r={9} className="cpart-hit" />
        <circle cx={X.out} cy={TOP} r={4} className="node-dot" />
        <text x={(X.out + X.r) / 2} y={TOP - 14} textAnchor="middle" className="cvalue cvalue--out">
          Vout {formatV(st.vout)}
        </text>
      </g>
      <circle cx={X.out} cy={GND} r={3} className="node-dot" />
    </>
  )
  const swNode = (x: number) => (
    <g {...part('sw', `Switch node, ${formatV(st.vsw)}`)}>
      <circle cx={x} cy={TOP} r={9} className="cpart-hit" />
      <circle cx={x} cy={TOP} r={4} className="node-dot" />
      {values && (
        <text x={x} y={TOP - 14} textAnchor="middle" className="cvalue cvalue--strong">
          vsw {formatV(st.vsw)}
        </text>
      )}
    </g>
  )
  const caption = (
    <text x={345} y={GND + 44} className="path-caption" textAnchor="middle">
      {on ? 'Switch ON' : off ? 'Freewheeling' : 'Idle (DCM)'} · {st.pathText}
    </text>
  )

  let body: React.ReactNode
  if (kind === 'buck') {
    const XQ = [160, 228]
    const XSW = 284
    const XL = [324, 420]
    body = (
      <>
        {w(on, `M${X.src} ${TOP} H${XQ[0]}`)}
        {w(on, `M${XQ[1]} ${TOP} H${XSW}`)}
        {w(!idle, `M${XSW} ${TOP} H${XL[0]}`)}
        {w(!idle, `M${XL[1]} ${TOP} H${X.out}`)}
        {outRail(!idle, X.out)}
        {w(!idle, `M${X.out} ${GND} H${XSW}`)}
        {w(on, `M${XSW} ${GND} H${X.src}`)}
        {w(on, `M${X.src} ${GND} V${TOP}`)}
        {w(off, `M${XSW} ${GND} V${TOP}`)}
        {source}
        {qSwitch('h', XQ[0], XQ[1], TOP)}
        {swNode(XSW)}
        {diode(XSW, GND - 20, XSW, TOP + 20, [XSW + 18, MID - 9], [XSW - 20, MID + 4, 'end'])}
        {coil('h', XL[0], TOP)}
        {capAndLoad}
        <circle cx={XSW} cy={GND} r={3} className="node-dot" />
      </>
    )
  } else if (kind === 'boost') {
    const XL = [150, 246]
    const XSW = 290
    const XD = [330, 400]
    body = (
      <>
        {w(!idle, `M${X.src} ${TOP} H${XL[0]}`)}
        {w(!idle, `M${XL[1]} ${TOP} H${XSW}`)}
        {w(off, `M${XSW} ${TOP} H${XD[0]}`)}
        {w(off, `M${XD[1]} ${TOP} H${X.out}`)}
        {outRail(off, X.out)}
        {w(on || off, `M${XSW} ${GND} H${X.src}`)}
        {w(off, `M${X.out} ${GND} H${XSW}`)}
        {w(!idle, `M${X.src} ${GND} V${TOP}`)}
        {source}
        {coil('h', XL[0], TOP)}
        {swNode(XSW)}
        {qSwitch('v', TOP + 30, GND - 30, XSW)}
        {w(on, `M${XSW} ${TOP} V${TOP + 30}`)}
        {w(on, `M${XSW} ${GND - 30} V${GND}`)}
        {diode(XD[0] - 10, TOP, XD[1] + 10, TOP, [(XD[0] + XD[1]) / 2 - 22, TOP + 14], [(XD[0] + XD[1]) / 2, TOP - 22, 'middle'])}
        {capAndLoad}
        <circle cx={XSW} cy={GND} r={3} className="node-dot" />
      </>
    )
  } else {
    const XQ = [160, 228]
    const XSW = 284
    const XD = [330, 400]
    body = (
      <>
        {w(on, `M${X.src} ${TOP} H${XQ[0]}`)}
        {w(on, `M${XQ[1]} ${TOP} H${XSW}`)}
        {/* L from the switch node down to ground; iL flows downward */}
        {w(!idle, `M${XSW} ${TOP} V${TOP + 20}`)}
        {w(!idle, `M${XSW} ${TOP + 116} V${GND}`)}
        {w(on, `M${XSW} ${GND} H${X.src}`)}
        {w(on, `M${X.src} ${GND} V${TOP}`)}
        {/* OFF: ground → R/C → output → D1 → switch node */}
        {w(off, `M${XSW} ${GND} H${X.out}`)}
        {outRail(off, X.out)}
        {w(off, `M${X.out} ${TOP} H${XD[1] + 10}`)}
        {w(off, `M${XD[0] - 10} ${TOP} H${XSW}`)}
        {source}
        {qSwitch('h', XQ[0], XQ[1], TOP)}
        {swNode(XSW)}
        {coil('v', TOP + 20, XSW)}
        {diode(XD[1] + 10, TOP, XD[0] - 10, TOP, [(XD[0] + XD[1]) / 2 - 22, TOP + 14], [(XD[0] + XD[1]) / 2, TOP - 22, 'middle'])}
        {capAndLoad}
        <circle cx={XSW} cy={GND} r={3} className="node-dot" />
        <text x={X.r + 16} y={GND - 6} className="cvalue" textAnchor="start">
          + at ground
        </text>
      </>
    )
  }
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`${kind} converter schematic. ${st.pathText}`}>
      {body}
      <text x={X.src} y={GND + 22} className="cvalue" textAnchor="start">
        ground
      </text>
      {caption}
    </svg>
  )
}
