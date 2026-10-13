import type { KeyboardEvent, ReactNode } from 'react'
import type { BidiState, CoupledState } from '../../converters/dcdc4/explain.ts'
import type { ResolvedBidi, ResolvedCoupled } from '../../converters/dcdc4/params.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'

/**
 * Schematics of the advanced converters, in the visual language of the basic DC-DC diagrams. Every state
 * shown (device ON/OFF, which wires carry current and in which direction, C1 charging or discharging) is
 * read from the simulated sample at the cursor. A wire is drawn in the direction its conventional current
 * flows (the dashes then move with the current); a wire carrying no current is drawn still.
 */

interface Common {
  selected: string | null
  onSelect: (part: string) => void
  showPath: boolean
  values: boolean
  live: boolean
}

const EPS = 1e-6

function kit({ selected, onSelect, showPath }: Common) {
  const part = (id: string, label: string) => ({
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
  })
  /** A straight wire from (x1, y1) to (x2, y2) carrying `i` (positive = from 1 to 2). */
  const wire = (key: string, x1: number, y1: number, x2: number, y2: number, i: number) => {
    const active = Math.abs(i) > EPS
    const d = i >= 0 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x2} ${y2} L${x1} ${y1}`
    return <path key={key} className={showPath && active ? 'wire wire--flow' : 'wire'} d={d} />
  }
  const chip = (x: number, y: number, isOn: boolean, tone: 'q' | 'd') => (
    <g transform={`translate(${x}, ${y})`}>
      <rect width={44} height={18} rx={9} className={`dchip ${isOn ? `dchip--on-${tone}` : ''}`} />
      <text x={22} y={13} textAnchor="middle" className="dchip-text">
        {isOn ? 'ON' : 'OFF'}
      </text>
    </g>
  )
  return { part, wire, chip }
}

/** Vertical switch between (x, y0) and (x, y1). */
function VSwitch({ k, id, name, x, y0, y1, on, gate, labelSide = 'left' }: { k: ReturnType<typeof kit>; id: string; name: string; x: number; y0: number; y1: number; on: boolean; gate: boolean; labelSide?: 'left' | 'right' }) {
  const cy = (y0 + y1) / 2
  const lx = labelSide === 'left' ? x - 14 : x + 30
  const anchor = labelSide === 'left' ? 'end' : 'start'
  return (
    <g {...k.part(id, `Switch ${name}, ${on ? 'ON' : 'OFF'}`)}>
      <rect x={x - 26} y={y0 - 4} width={52} height={y1 - y0 + 8} className="cpart-hit" />
      <circle cx={x} cy={y0} r={3.5} className="sym-dot" />
      <circle cx={x} cy={y1} r={3.5} className="sym-dot" />
      {on ? <line x1={x} y1={y0} x2={x} y2={y1} className="sym sym--on-q" /> : <line x1={x} y1={y0} x2={x + 20} y2={y1 - 6} className="sym" />}
      <text x={lx} y={cy - 6} className="clabel" textAnchor={anchor}>
        {name}
      </text>
      {k.chip(labelSide === 'left' ? x - 58 : x + 30, cy + 2, on, 'q')}
      <title>{`${name}: gate ${gate ? 'HIGH' : 'LOW'}`}</title>
    </g>
  )
}

/** Diode from anode (ax, ay) to cathode (kx, ky), horizontal or vertical. */
function Diode({ k, id, name, ax, ay, kx, ky, on, chipAt, labelAt }: { k: ReturnType<typeof kit>; id: string; name: string; ax: number; ay: number; kx: number; ky: number; on: boolean; chipAt: [number, number]; labelAt: [number, number, 'start' | 'end' | 'middle'] }) {
  const cx = (ax + kx) / 2
  const cy = (ay + ky) / 2
  const ux = Math.sign(kx - ax)
  const uy = Math.sign(ky - ay)
  const tip = [cx + ux * 10, cy + uy * 10]
  const base = [cx - ux * 10, cy - uy * 10]
  const px = -uy * 12
  const py = ux * 12
  return (
    <g {...k.part(id, `Diode ${name}, ${on ? 'ON' : 'OFF'}`)}>
      <rect x={cx - 24} y={cy - 22} width={48} height={44} className="cpart-hit" />
      <line x1={ax} y1={ay} x2={base[0]} y2={base[1]} className="sym" />
      <line x1={tip[0]} y1={tip[1]} x2={kx} y2={ky} className="sym" />
      <path d={`M${base[0] + px} ${base[1] + py} L${base[0] - px} ${base[1] - py} L${tip[0]} ${tip[1]} Z`} className={`sym-fill ${on ? 'sym-fill--on-d' : ''}`} />
      <line x1={tip[0] + px} x2={tip[0] - px} y1={tip[1] + py} y2={tip[1] - py} className="sym" />
      <text x={labelAt[0]} y={labelAt[1]} className="clabel" textAnchor={labelAt[2]}>
        {name}
      </text>
      {k.chip(chipAt[0], chipAt[1], on, 'd')}
    </g>
  )
}

/** Coil of 4 turns starting at a (x or y), horizontal (left → right) or vertical (top → bottom). */
const coilPath = (orient: 'h' | 'v', a: number, c: number) =>
  orient === 'h' ? `M${a} ${c} ${Array.from({ length: 4 }, () => 'a12 12 0 0 1 24 0').join(' ')}` : `M${c} ${a} ${Array.from({ length: 4 }, () => 'a12 12 0 0 1 0 24').join(' ')}`

function Coil({ k, id, name, orient, a, c, value, label, labelPos }: { k: ReturnType<typeof kit>; id: string; name: string; orient: 'h' | 'v'; a: number; c: number; value: number; label: string; labelPos?: [number, number, 'start' | 'end' | 'middle'] }) {
  const [lx, ly, la] = labelPos ?? (orient === 'h' ? [a + 48, c - 22, 'middle'] : [c + 20, a + 44, 'start'])
  return (
    <g {...k.part(id, `Inductor ${name}, ${formatA(value, true)}`)}>
      <rect x={orient === 'h' ? a - 4 : c - 22} y={orient === 'h' ? c - 22 : a - 4} width={orient === 'h' ? 104 : 44} height={orient === 'h' ? 36 : 104} className="cpart-hit" />
      <path d={coilPath(orient, a, c)} className="sym sym--coil" />
      <text x={lx} y={ly} className="clabel" textAnchor={la}>
        {label}
      </text>
    </g>
  )
}

/** Capacitor: plates across a horizontal wire at (x, y) or a vertical wire. */
function Cap({ k, id, label, orient, x, y, state, labelPos, plus }: { k: ReturnType<typeof kit>; id: string; label: string; orient: 'h' | 'v'; x: number; y: number; state: string; labelPos: [number, number, 'start' | 'end' | 'middle']; plus?: [number, number] }) {
  return (
    <g {...k.part(id, `${label}, ${state}`)}>
      <rect x={x - 22} y={y - 22} width={44} height={44} className="cpart-hit" />
      {orient === 'v' ? (
        <>
          <rect x={x - 18} y={y - 9} width={36} height={18} className="gap-mask" />
          <line x1={x - 16} x2={x + 16} y1={y - 6} y2={y - 6} className="sym sym--thick" />
          <line x1={x - 16} x2={x + 16} y1={y + 6} y2={y + 6} className="sym sym--thick" />
        </>
      ) : (
        <>
          <rect x={x - 9} y={y - 18} width={18} height={36} className="gap-mask" />
          <line x1={x - 6} x2={x - 6} y1={y - 16} y2={y + 16} className="sym sym--thick" />
          <line x1={x + 6} x2={x + 6} y1={y - 16} y2={y + 16} className="sym sym--thick" />
        </>
      )}
      <text x={labelPos[0]} y={labelPos[1]} className="clabel" textAnchor={labelPos[2]}>
        {label}
      </text>
      {plus && (
        <text x={plus[0]} y={plus[1]} className="cvalue" textAnchor="middle">
          +
        </text>
      )}
    </g>
  )
}

function Source({ k, id, x, y, label, value, title }: { k: ReturnType<typeof kit>; id: string; x: number; y: number; label: string; value: string; title: string }) {
  return (
    <g {...k.part(id, title)}>
      <rect x={x - 22} y={y - 26} width={44} height={52} className="cpart-hit" />
      <rect x={x - 18} y={y - 9} width={36} height={18} className="gap-mask" />
      <line x1={x - 16} x2={x + 16} y1={y - 6} y2={y - 6} className="sym" />
      <line x1={x - 9} x2={x + 9} y1={y + 6} y2={y + 6} className="sym sym--thick" />
      <text x={x - 24} y={y + 2} className="clabel" textAnchor="end">
        {label}
      </text>
      <text x={x - 24} y={y + 16} className="cvalue" textAnchor="end">
        {value}
      </text>
    </g>
  )
}

function Resistor({ k, id, x, y0, y1, label, value, title }: { k: ReturnType<typeof kit>; id: string; x: number; y0: number; y1: number; label: string; value: string; title: string }) {
  const cy = (y0 + y1) / 2
  return (
    <g {...k.part(id, title)}>
      <rect x={x - 20} y={cy - 30} width={40} height={60} className="cpart-hit" />
      <rect x={x - 9} y={cy - 22} width={18} height={44} rx={2} className="sym-body" />
      <text x={x + 16} y={cy - 4} className="clabel" textAnchor="start">
        {label}
      </text>
      <text x={x + 16} y={cy + 10} className="cvalue" textAnchor="start">
        {value}
      </text>
    </g>
  )
}

const Dot = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={3.5} className="node-dot" />

// ── Ćuk, SEPIC, Zeta ──────────────────────────────────────────────────────────────────────────────────

const TOP = 62
const GND = 214
const MID = (TOP + GND) / 2
const X = { src: 92, l1: 128, a: 262, c1: 306, b: 350, l2: 390, out: 520, r: 596 }

export function CoupledDiagram({ st, p, ...c }: Common & { st: CoupledState; p: ResolvedCoupled }) {
  const k = kit(c)
  const { wire } = k
  const kind = st.kind
  const io = st.io
  const icap = st.ic
  const els: ReactNode[] = []
  // output section (all three): out rail → R, C; ground return
  els.push(wire('o-r', X.out, TOP, X.r, TOP, io), wire('r', X.r, TOP, X.r, GND, io), wire('g-r', X.r, GND, X.out, GND, io), wire('c', X.out, TOP, X.out, MID - 9, icap), wire('c2', X.out, MID + 9, X.out, GND, icap))
  const c1Charging = st.vc1 * st.ic1 >= 0
  const l1Label = `L1 ${formatSI(p.l1, 'H')}`
  const l2Label = `L2 ${formatSI(p.l2, 'H')}`
  if (kind === 'cuk' || kind === 'sepic') {
    // Vin+ → L1 → A, Q1 from A to ground, C1 from A to B
    els.push(
      wire('src', X.src, GND, X.src, MID + 26, st.iin),
      wire('src2', X.src, MID - 26, X.src, TOP, st.iin),
      wire('in', X.src, TOP, X.l1, TOP, st.il1),
      wire('l1a', X.l1 + 96, TOP, X.a, TOP, st.il1),
      wire('ac1', X.a, TOP, X.c1 - 6, TOP, st.ic1),
      wire('c1b', X.c1 + 6, TOP, X.b, TOP, st.ic1),
      wire('q', X.a, TOP, X.a, TOP + 34, st.iq),
      wire('q2', X.a, GND - 34, X.a, GND, st.iq),
    )
    if (kind === 'cuk') {
      // D1 from B down to ground; L2 from out to B (current out → B)
      const rail = io + icap // returning from the output to the ground rail (leftwards)
      els.push(
        wire('bd', X.b, TOP, X.b, MID - 22, st.id),
        wire('bd2', X.b, MID + 22, X.b, GND, st.id),
        wire('bl2', X.b, TOP, X.l2, TOP, -st.il2),
        wire('l2o', X.l2 + 96, TOP, X.out, TOP, -st.il2),
        wire('g1', X.out, GND, X.b, GND, rail),
        wire('g2', X.b, GND, X.a, GND, rail + st.id),
        wire('g3', X.a, GND, X.src, GND, rail + st.id + st.iq),
      )
    } else {
      // L2 from ground up to B; D1 from B to out
      const rail = io + icap
      els.push(
        wire('bl2', X.b, TOP, X.b, TOP + 20, -st.il2),
        wire('bl2b', X.b, TOP + 116, X.b, GND, -st.il2),
        wire('bd', X.b, TOP, X.l2 - 2, TOP, st.id),
        wire('do', X.l2 + 66, TOP, X.out, TOP, st.id),
        wire('g1', X.out, GND, X.b, GND, rail),
        wire('g2', X.b, GND, X.a, GND, rail - st.il2),
        wire('g3', X.a, GND, X.src, GND, rail - st.il2 + st.iq),
      )
    }
  } else {
    // Zeta: Vin+ → Q1 → A, L1 from A to ground, C1 between A and B (B positive), D1 ground → B, L2 B → out
    const rail = io + icap
    els.push(
      wire('src', X.src, GND, X.src, MID + 26, st.iin),
      wire('src2', X.src, MID - 26, X.src, TOP, st.iin),
      wire('in', X.src, TOP, X.src + 40, TOP, st.iq),
      wire('qa', X.src + 112, TOP, X.a, TOP, st.iq),
      wire('al1', X.a, TOP, X.a, TOP + 20, st.il1),
      wire('al1b', X.a, TOP + 116, X.a, GND, st.il1),
      wire('ac1', X.a, TOP, X.c1 - 6, TOP, -st.ic1),
      wire('c1b', X.c1 + 6, TOP, X.b, TOP, -st.ic1),
      wire('db', X.b, GND, X.b, MID + 22, st.id),
      wire('db2', X.b, MID - 22, X.b, TOP, st.id),
      wire('bl2', X.b, TOP, X.l2, TOP, st.il2),
      wire('l2o', X.l2 + 96, TOP, X.out, TOP, st.il2),
      wire('g1', X.out, GND, X.b, GND, rail),
      wire('g2', X.b, GND, X.a, GND, rail - st.id),
      wire('g3', X.a, GND, X.src, GND, rail - st.id + st.il1),
    )
  }

  const nodeA = (
    <g {...k.part('sw', `Node A (switch node), ${formatV(st.vsw)}`)}>
      <circle cx={X.a} cy={TOP} r={9} className="cpart-hit" />
      <Dot x={X.a} y={TOP} />
      <text x={X.a} y={TOP - 14} className="cvalue" textAnchor="middle">
        A
      </text>
    </g>
  )
  const nodeB = (
    <g {...k.part('b', `Node B, ${formatV(st.vb)}`)}>
      <circle cx={X.b} cy={TOP} r={9} className="cpart-hit" />
      <Dot x={X.b} y={TOP} />
      <text x={X.b} y={TOP - 14} className="cvalue" textAnchor="middle">
        B
      </text>
    </g>
  )
  const c1 = (
    <Cap
      k={k}
      id="c1"
      label="C1"
      orient="h"
      x={X.c1}
      y={TOP}
      state={c1Charging ? 'charging' : 'discharging'}
      labelPos={[X.c1, TOP - 26, 'middle']}
      plus={kind === 'zeta' ? [X.c1 + 15, TOP - 8] : [X.c1 - 15, TOP - 8]}
    />
  )
  let devices: ReactNode
  if (kind === 'cuk')
    devices = (
      <>
        <Coil k={k} id="l1" name="L1" orient="h" a={X.l1} c={TOP} value={st.il1} label={l1Label} />
        <VSwitch k={k} id="q1" name="Q1" x={X.a} y0={TOP + 34} y1={GND - 34} on={st.qOn} gate={st.gate} />
        <Diode k={k} id="d1" name="D1" ax={X.b} ay={MID - 22} kx={X.b} ky={MID + 22} on={st.dOn} chipAt={[X.b + 16, MID + 14]} labelAt={[X.b + 18, MID - 2, 'start']} />
        <Coil k={k} id="l2" name="L2" orient="h" a={X.l2} c={TOP} value={st.il2} label={l2Label} />
      </>
    )
  else if (kind === 'sepic')
    devices = (
      <>
        <Coil k={k} id="l1" name="L1" orient="h" a={X.l1} c={TOP} value={st.il1} label={l1Label} />
        <VSwitch k={k} id="q1" name="Q1" x={X.a} y0={TOP + 34} y1={GND - 34} on={st.qOn} gate={st.gate} />
        <Coil k={k} id="l2" name="L2" orient="v" a={TOP + 20} c={X.b} value={st.il2} label={l2Label} labelPos={[X.b + 20, TOP + 66, 'start']} />
        <Diode k={k} id="d1" name="D1" ax={X.l2 - 2} ay={TOP} kx={X.l2 + 66} ky={TOP} on={st.dOn} chipAt={[X.l2 + 10, TOP + 16]} labelAt={[X.l2 + 32, TOP - 22, 'middle']} />
      </>
    )
  else
    devices = (
      <>
        <g {...k.part('q1', `Switch Q1, ${st.qOn ? 'ON' : 'OFF'}`)}>
          <rect x={X.src + 34} y={TOP - 34} width={84} height={70} className="cpart-hit" />
          <circle cx={X.src + 40} cy={TOP} r={3.5} className="sym-dot" />
          <circle cx={X.src + 112} cy={TOP} r={3.5} className="sym-dot" />
          {st.qOn ? <line x1={X.src + 40} y1={TOP} x2={X.src + 112} y2={TOP} className="sym sym--on-q" /> : <line x1={X.src + 40} y1={TOP} x2={X.src + 106} y2={TOP - 22} className="sym" />}
          <text x={X.src + 76} y={TOP - 30} className="clabel" textAnchor="middle">
            Q1
          </text>
          {k.chip(X.src + 54, TOP + 12, st.qOn, 'q')}
        </g>
        <Coil k={k} id="l1" name="L1" orient="v" a={TOP + 20} c={X.a} value={st.il1} label={l1Label} labelPos={[X.a - 20, TOP + 66, 'end']} />
        <Diode k={k} id="d1" name="D1" ax={X.b} ay={MID + 22} kx={X.b} ky={MID - 22} on={st.dOn} chipAt={[X.b + 16, MID + 14]} labelAt={[X.b + 18, MID - 2, 'start']} />
        <Coil k={k} id="l2" name="L2" orient="h" a={X.l2} c={TOP} value={st.il2} label={l2Label} />
      </>
    )

  const live = c.values || c.live
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`${kind} converter schematic. ${st.pathText}`}>
      {els}
      <Source k={k} id="vin" x={X.src} y={MID} label="Vin" value={formatV(p.vin, false)} title={`Input source Vin = ${p.vin} V`} />
      {devices}
      {c1}
      {nodeA}
      {nodeB}
      <Cap k={k} id="c" label="C" orient="v" x={X.out} y={MID} state={st.vc * st.ic >= 0 ? 'charging' : 'discharging'} labelPos={[X.out - 22, MID + 4, 'end']} />
      <Resistor k={k} id="r" x={X.r} y0={TOP} y1={GND} label="R" value={formatSI(p.r, 'Ω')} title={`Load R = ${p.r} Ω`} />
      <g {...k.part('out', `Output, Vout = ${formatV(st.vout)}`)}>
        <circle cx={X.out} cy={TOP} r={9} className="cpart-hit" />
        <Dot x={X.out} y={TOP} />
        {live && (
          <text x={(X.out + X.r) / 2} y={TOP - 14} textAnchor="middle" className="cvalue cvalue--out">
            Vout {formatV(st.vout)}
          </text>
        )}
      </g>
      {[X.a, X.b, X.out].map((x) => (
        <Dot key={x} x={x} y={GND} />
      ))}
      {kind === 'cuk' && (
        <text x={X.r + 16} y={MID + 28} className="cvalue" textAnchor="start">
          Vout &lt; 0
        </text>
      )}
      {c.values && (
        <>
          <text x={X.l1 + 48} y={TOP + 26} className="cvalue cvalue--il" textAnchor="middle">
            iL1 {formatA(st.il1, true)}
          </text>
          <text x={kind === 'sepic' ? X.b + 20 : X.l2 + 48} y={kind === 'sepic' ? TOP + 82 : TOP + 26} className="cvalue cvalue--il" textAnchor={kind === 'sepic' ? 'start' : 'middle'}>
            iL2 {formatA(st.il2, true)}
          </text>
          <text x={X.c1} y={GND - 8} className="cvalue" textAnchor="middle">
            vC1 {formatV(st.vc1, false)}
          </text>
        </>
      )}
      <text x={X.src} y={GND + 22} className="cvalue" textAnchor="start">
        ground
      </text>
    </svg>
  )
}

// ── Bidirectional half-bridge ─────────────────────────────────────────────────────────────────────────

const B = { bus: 40, sw: 135, gnd: 230, leg: 450, dio: 506, hv: 624, l: 290, lv: 230, bat: 110 }

export function BidiDiagram({ st, p, ...c }: Common & { st: BidiState; p: ResolvedBidi }) {
  const k = kit(c)
  const { wire } = k
  const iup = st.iq1 - st.id1
  const ilo = st.id2 - st.iq2
  const els = [
    wire('bus', B.hv, B.bus, B.leg, B.bus, st.ihv),
    wire('hv1', B.hv, B.gnd, B.hv, B.sw + 26, st.ihv),
    wire('hv2', B.hv, B.sw - 26, B.hv, B.bus, st.ihv),
    wire('up1', B.leg, B.bus, B.leg, 66, iup),
    wire('up2', B.leg, 108, B.leg, B.sw, iup),
    wire('lo1', B.leg, B.gnd, B.leg, 196, ilo),
    wire('lo2', B.leg, 162, B.leg, B.sw, ilo),
    // antiparallel diodes: stubs at the switch terminals
    wire('d1a', B.leg, 117, B.dio, 117, st.id1),
    wire('d1b', B.dio, 58, B.leg, 58, st.id1),
    wire('d2a', B.leg, 220, B.dio, 220, st.id2),
    wire('d2b', B.dio, 152, B.leg, 152, st.id2),
    wire('swl', B.leg, B.sw, B.l + 96, B.sw, st.il),
    wire('llv', B.l, B.sw, B.lv, B.sw, st.il),
    wire('lvb', B.lv, B.sw, B.bat, B.sw, st.ib),
    wire('bat1', B.bat, B.sw, B.bat, 150, st.ib),
    wire('bat2', B.bat, 196, B.bat, B.gnd, st.ib),
    wire('c1', B.lv, B.sw, B.lv, 174, st.ic),
    wire('c2', B.lv, 190, B.lv, B.gnd, st.ic),
    wire('g1', B.bat, B.gnd, B.lv, B.gnd, st.ib),
    wire('g2', B.lv, B.gnd, B.leg, B.gnd, st.il),
    wire('g3', B.leg, B.gnd, B.hv, B.gnd, st.il - ilo),
  ]
  const live = c.values || c.live
  const dir = st.il >= 0 ? 'iL → battery (buck)' : 'iL → bus (boost)'
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Bidirectional half-bridge converter schematic. ${st.pathText}`}>
      {els}
      <VSwitch k={k} id="q1" name="Q1" x={B.leg} y0={66} y1={108} on={st.q1On} gate={st.g1} />
      <VSwitch k={k} id="q2" name="Q2" x={B.leg} y0={162} y1={196} on={st.q2On} gate={st.g2} />
      <Diode k={k} id="d1" name="D1" ax={B.dio} ay={117} kx={B.dio} ky={58} on={st.d1On} chipAt={[B.dio + 14, 80]} labelAt={[B.dio + 16, 72, 'start']} />
      <Diode k={k} id="d2" name="D2" ax={B.dio} ay={220} kx={B.dio} ky={152} on={st.d2On} chipAt={[B.dio + 14, 190]} labelAt={[B.dio + 16, 182, 'start']} />
      <Source k={k} id="hv" x={B.hv} y={B.sw} label="VHV" value={formatV(p.vhv, false)} title={`DC bus VHV = ${p.vhv} V`} />
      <Coil k={k} id="l" name="L" orient="h" a={B.l} c={B.sw} value={st.il} label={`L ${formatSI(p.l, 'H')}`} />
      <Cap k={k} id="c" label="C" orient="v" x={B.lv} y={182} state={st.vc * st.ic >= 0 ? 'charging' : 'discharging'} labelPos={[B.lv + 22, 186, 'start']} />
      <g {...k.part('bat', `Battery Eb = ${p.eb} V behind Rb = ${p.rb} Ω`)}>
        <rect x={B.bat - 30} y={146} width={60} height={56} className="cpart-hit" />
        <rect x={B.bat - 7} y={150} width={14} height={20} rx={2} className="sym-body" />
        <line x1={B.bat} x2={B.bat} y1={170} y2={184} className="wire" />
        <rect x={B.bat - 18} y={180} width={36} height={14} className="gap-mask" />
        <line x1={B.bat - 16} x2={B.bat + 16} y1={184} y2={184} className="sym" />
        <line x1={B.bat - 9} x2={B.bat + 9} y1={192} y2={192} className="sym sym--thick" />
        <text x={B.bat - 24} y={164} className="cvalue" textAnchor="end">
          Rb {formatSI(p.rb, 'Ω')}
        </text>
        <text x={B.bat - 24} y={190} className="clabel" textAnchor="end">
          Eb
        </text>
        <text x={B.bat - 24} y={204} className="cvalue" textAnchor="end">
          {formatV(p.eb, false)}
        </text>
      </g>
      <g {...k.part('sw', `Switch node, ${formatV(st.vsw)}`)}>
        <circle cx={B.leg} cy={B.sw} r={9} className="cpart-hit" />
        <Dot x={B.leg} y={B.sw} />
        {c.values && (
          <text x={B.leg - 10} y={B.sw + 18} className="cvalue cvalue--strong" textAnchor="end">
            vsw {formatV(st.vsw)}
          </text>
        )}
      </g>
      <g {...k.part('lv', `LV node, ${formatV(st.vlv)}`)}>
        <circle cx={B.lv} cy={B.sw} r={9} className="cpart-hit" />
        <Dot x={B.lv} y={B.sw} />
        {live && (
          <text x={B.lv} y={B.sw - 14} className="cvalue cvalue--out" textAnchor="middle">
            VLV {formatV(st.vlv, false)}
          </text>
        )}
      </g>
      {[B.bat, B.lv, B.leg].map((x) => (
        <Dot key={x} x={x} y={B.gnd} />
      ))}
      <Dot x={B.leg} y={B.bus} />
      <text x={B.bat - 30} y={B.sw - 30} className="cnote" textAnchor="start">
        LV side (battery)
      </text>
      <text x={B.hv} y={B.bus - 14} className="cnote" textAnchor="middle">
        HV bus
      </text>
      <text x={B.l + 30} y={B.sw + 36} className="cvalue cvalue--il" textAnchor="middle">
        {dir}
      </text>
      {c.values && (
        <text x={B.l + 30} y={B.sw + 52} className="cvalue cvalue--il" textAnchor="middle">
          iL {formatA(st.il, true)}
        </text>
      )}
      <text x={B.bat - 30} y={B.gnd + 22} className="cvalue" textAnchor="start">
        ground
      </text>
    </svg>
  )
}
