import type { KeyboardEvent } from 'react'
import type { CurrentPath } from '../../workspace/contract.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'

/*
 * Circuit diagrams of the IGBT, SiC MOSFET and GaN HEMT topics (Switching Devices lab). Drawn in the visual
 * language of the MOSFET double-pulse diagram (src/topics/devices.tsx): the same layout, symbols and classes.
 * Pure drawing: every state shown is passed in from the simulated run.
 */

/* ── Current flow (the "Show current path" overlay) ─────────────────────────────────────────────────────── */

type Pt = readonly [number, number]

/**
 * One branch's current as an animated dashed wire (`.buck-diagram .wire--flow`, src/styles/dcdc.css) drawn over
 * the static wire. `runs` are the wire pieces of the branch, listed in the branch's POSITIVE current direction
 * (where conventional current enters → where it leaves); a negative simulated current reverses them. Nothing is
 * drawn when the overlay is off or |i| is below `thr` (1e-3 of the run's peak). Pieces stop at component bodies,
 * so the dashes sit on wires only.
 */
export function Flow({ on, i, thr, runs }: { on: boolean; i: number; thr: number; runs: ReadonlyArray<ReadonlyArray<Pt>> }) {
  if (!on || !(Math.abs(i) >= thr) || thr <= 0) return null
  const list = i >= 0 ? runs : [...runs].reverse().map((r) => [...r].reverse())
  const d = list.map((r) => r.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join(' ')).join(' ')
  return <path className="wire wire--flow" d={d} />
}

const peaks = new WeakMap<ArrayLike<number>, number>()
/** max |x| over a simulated signal (cached per array). */
export function peakAbs(x: ArrayLike<number> | undefined): number {
  if (!x) return 0
  let v = peaks.get(x)
  if (v === undefined) {
    v = 0
    for (let k = 0; k < x.length; k++) v = Math.max(v, Math.abs(x[k]))
    peaks.set(x, v)
  }
  return v
}

/** Threshold below which a branch is not animated: 1e-3 of the run's peak. */
export const flowThr = (peak: number) => 1e-3 * peak

/* Shared double-pulse loop geometry (MOSFET, IGBT, SiC): Vdc at x = 560 (+ plate y ≈ 124, − plate y ≈ 138), top rail
 * y = 40, bottom rail y = 230, load at x = 470, diode and switch at x = 380, switch node y = 130. */
export const DPT_RUNS = {
  /** Vdc+ → top rail → top of the load (the source current = the switch current, KCL). */
  srcTop: [[[560, 122], [560, 40], [470, 40]]] as Pt[][],
  /** Bottom rail → Vdc− (the same current returning). */
  srcBot: [[[380, 230], [560, 230], [560, 140]]] as Pt[][],
  /** The diode branch, anode (switch node) → cathode → top rail → top of the load. */
  diode: [
    [[380, 130], [380, 120]],
    [[380, 70], [380, 40], [470, 40]],
  ] as Pt[][],
}

/** The conducting loops of a double-pulse test at the cursor, in words (the status line's "Current path"). */
export function dptPath(o: { dev: string; devId: string; i: number; idiode: number; i0: number }): CurrentPath {
  const thr = flowThr(o.i0)
  const q = Math.abs(o.i) >= thr
  const d = Math.abs(o.idiode) >= thr
  const sw = `Vdc+ → L → ${o.dev} → Vdc− (${formatA(o.i)})`
  const fw = `L → D → L (${formatA(o.idiode)})`
  if (q && d) return { elements: ['vdc', 'load', o.devId, 'diode'], text: `${sw} · ${fw}`, reasons: [] }
  if (q) return { elements: ['vdc', 'load', o.devId], text: sw, reasons: [] }
  if (d) return { elements: ['load', 'diode'], text: `${fw}: I0 freewheels`, reasons: [] }
  return { elements: [], text: 'no current', reasons: [] }
}

/** The conducting loops of the GaN half-bridge at the cursor. The high side carries I0 − iD (KCL at the switch node). */
export function halfBridgePath(o: { id: number; iF: number; i0: number; hsMode: 'on' | 'rev' | 'off' }): CurrentPath {
  const thr = flowThr(o.i0)
  const iHs = o.i0 - o.id
  const ls = Math.abs(o.id) >= thr
  const hs = Math.abs(iHs) >= thr
  const how = o.hsMode === 'rev' ? 'reverse, gate off' : o.hsMode === 'on' ? 'synchronous' : 'capacitance'
  const lsLoop = `Vdc+ → L → LS → Vdc− (${formatA(o.id)})`
  const hsLoop = `L → HS → L (${formatA(iHs)}, ${how})`
  if (ls && hs && iHs < 0) return { elements: ['vdc', 'hs', 'ls'], text: `${lsLoop} · Vdc+ → HS → LS (${formatA(-iHs)}, ${o.iF < -thr ? 'shoot-through' : 'charging the HS capacitance'})`, reasons: [] }
  if (ls && hs) return { elements: ['vdc', 'load', 'ls', 'hs'], text: `${lsLoop} · ${hsLoop}`, reasons: [] }
  if (ls) return { elements: ['vdc', 'load', 'ls'], text: lsLoop, reasons: [] }
  if (hs) return { elements: ['load', 'hs'], text: `${hsLoop}: I0 freewheels`, reasons: [] }
  return { elements: [], text: 'no current', reasons: [] }
}

/** A gate level in few characters: "+15", "−8", "0". */
const lvl = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 1)}`

type Sel = { selected: string | null; onSelect: (s: string) => void }

function partProps(id: string, label: string, { selected, onSelect }: Sel) {
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

/** Load inductor drawn as a current source; the arrow shows the current flowing down into the switch node. */
function LoadSource({ x, y, i0, sel }: { x: number; y: number; i0: number; sel: Sel }) {
  return (
    <g {...partProps('load', `Load current ${formatA(i0)}`, sel)}>
      <rect x={x - 20} y={y - 25} width={40} height={50} className="cpart-hit" />
      <circle cx={x} cy={y} r={16} className="sym-body" />
      <path d={`M${x} ${y - 13} V${y + 13} M${x - 6} ${y + 7} L${x} ${y + 13} L${x + 6} ${y + 7}`} className="sym" />
      <text x={x + 22} y={y - 10} className="cvalue">
        I0
      </text>
      <text x={x + 22} y={y + 6} className="cvalue">
        {formatA(i0)}
      </text>
      <text x={x + 22} y={y + 23} className="cnote">
        (inductor)
      </text>
    </g>
  )
}

function DcSource({ x, y, vdc, sel }: { x: number; y: number; vdc: number; sel: Sel }) {
  return (
    <g {...partProps('vdc', `Vdc ${formatV(vdc, false)}`, sel)}>
      <rect x={x - 15} y={y - 15} width={30} height={30} className="cpart-hit" />
      <rect x={x - 18} y={y - 6} width={36} height={14} className="gap-mask" />
      <line x1={x - 16} x2={x + 16} y1={y - 2} y2={y - 2} className="sym" />
      <line x1={x - 9} x2={x + 9} y1={y + 6} y2={y + 6} className="sym sym--thick" />
      <text x={x + 24} y={y + 5} className="cvalue">
        Vdc {formatV(vdc, false)}
      </text>
    </g>
  )
}

export interface DptView {
  device: 'igbt' | 'mosfet'
  /** Device name on the circuit (Q, "SiC"). */
  name: string
  /** Terminal names: collector/emitter (IGBT) or drain/source. */
  vLabel: string
  iLabel: string
  vdc: number
  i0: number
  rg: number
  cIn: number
  cMiller: number
  inLabel: string
  millerLabel: string
  vdrv: number
  voff: number
  /** From the run at the cursor. */
  vg: number
  vgate: number
  v: number
  i: number
  idiode: number
  /** Channel conducting, diode conducting, and the IGBT's tail (hole current with the channel off). */
  channelOn: boolean
  diode: boolean
  tail: number | null
  regionText: string
  phase: string
  p: number
  /** Gate current at the cursor (into the gate > 0) and its peak |iG| over the run. */
  ig: number
  igPeak: number
}

/** Double-pulse test: DC source, inductive load, freewheeling diode, the device under test and its gate network. */
export function DptDiagramWbg({ v, selected, onSelect, values, live, showPath = false }: { v: DptView; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath?: boolean }) {
  const sel = { selected, onSelect }
  const tailOn = v.tail !== null && v.tail > 1e-3 * v.i0
  const devOn = v.channelOn || tailOn
  // current flow at the cursor (KCL: the load carries I0 = device current + diode current)
  const thr = flowThr(v.i0)
  // with the flow shown, the wires stay neutral under the green dashes (the symbols still show who conducts)
  const hue = (c: string) => (showPath ? '' : c)
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Double-pulse test: ${v.phase}`}>
      <path d="M380 40 H560 V230 H380" className="wire" />
      <path d="M380 40 V70" className={`wire ${hue(v.diode ? 'wire--diode' : '')}`} />
      <path d="M380 120 V130" className="wire" />
      <path d="M470 40 V79" className="wire" />
      <path d="M470 111 V130 H380" className="wire" />
      <path d="M380 130 V158" className={`wire ${hue(devOn ? 'wire--igbt' : '')}`} style={!showPath && tailOn && !v.channelOn ? { stroke: '#0f9fb5' } : undefined} />
      <path d="M380 202 V230" className={`wire ${hue(devOn ? 'wire--igbt' : '')}`} style={!showPath && tailOn && !v.channelOn ? { stroke: '#0f9fb5' } : undefined} />
      <Flow on={showPath} i={v.i} thr={thr} runs={DPT_RUNS.srcTop} />
      <Flow on={showPath} i={v.i} thr={thr} runs={DPT_RUNS.srcBot} />
      <Flow on={showPath} i={v.i} thr={thr} runs={[[[380, 130], [380, 158]], [[380, 202], [380, 230]]]} />
      <Flow on={showPath} i={v.idiode} thr={thr} runs={DPT_RUNS.diode} />
      <Flow on={showPath} i={v.i0} thr={thr} runs={[[[470, 40], [470, 79]], [[470, 111], [470, 130], [380, 130]]]} />
      <DcSource x={560} y={130} vdc={v.vdc} sel={sel} />
      {/* freewheeling diode: anode at the switch node (bottom), cathode at Vdc (top) */}
      <g {...partProps('diode', `Freewheeling diode ${v.diode ? 'ON' : 'OFF'}`, sel)}>
        <rect x={355} y={68} width={50} height={54} className="cpart-hit" />
        <path d="M368 110 H392 L380 84 Z" className={`sym-fill ${v.diode ? 'sym-fill--on-d' : ''}`} />
        <line x1={368} x2={392} y1={84} y2={84} className="sym" />
        <text x={350} y={100} className="clabel" textAnchor="end">
          D
        </text>
        {values && (
          <text x={350} y={116} className="cvalue" textAnchor="end">
            {formatA(v.idiode)}
          </text>
        )}
      </g>
      <LoadSource x={470} y={95} i0={v.i0} sel={sel} />
      {/* the device under test */}
      <g {...partProps('device', `${v.name} ${v.regionText}`, sel)}>
        <rect x={340} y={150} width={70} height={60} className="cpart-hit" />
        {v.device === 'igbt' ? (
          <>
            {/* gate plate, body bar, collector (top) and emitter (bottom, with the arrow) */}
            <line x1={364} x2={364} y1={164} y2={196} className="sym sym--thick" />
            <line x1={372} x2={372} y1={160} y2={200} className={`sym ${v.channelOn ? 'sym--on-q' : ''}`} style={tailOn && !v.channelOn ? { stroke: '#0f9fb5', strokeWidth: 4 } : undefined} />
            <path d="M372 170 L380 160 V158 M372 190 L380 200 V202" className="sym" />
            <path d="M375.5 197.5 L380 200 L379.5 194.5" className="sym" />
          </>
        ) : (
          <>
            <line x1={366} x2={366} y1={160} y2={200} className="sym sym--thick" />
            <line x1={374} x2={374} y1={158} y2={202} className={`sym ${v.channelOn ? 'sym--on-q' : ''}`} strokeDasharray={v.channelOn ? undefined : '5 4'} />
            <path d="M374 166 H380 V158 M374 194 H380 V202" className="sym" />
          </>
        )}
        <text x={418} y={168} className="clabel">
          {v.name}
        </text>
        <text x={418} y={184} className="cvalue">
          {v.regionText}
        </text>
        {live && tailOn && (
          <text x={418} y={200} className="cvalue" style={{ fill: '#0f9fb5' }}>
            tail {formatA(v.tail ?? 0)}
          </text>
        )}
        {values && (
          <text x={418} y={tailOn && live ? 216 : 200} className="cvalue cvalue--out">
            {v.vLabel} {formatV(v.v)}
          </text>
        )}
      </g>
      {/* gate network */}
      <path d="M120 180 H200" className="wire" />
      <path d="M250 180 H364" className="wire" />
      <Flow on={showPath} i={v.ig} thr={flowThr(v.igPeak)} runs={[[[120, 180], [200, 180]], [[250, 180], [364, 180]]]} />
      <g {...partProps('rg', `Gate resistor ${formatSI(v.rg, 'Ω')}`, sel)}>
        <rect x={198} y={168} width={54} height={24} className="cpart-hit" />
        <rect x={205} y={173} width={40} height={14} rx={2} className="sym-body" />
        <text x={225} y={164} textAnchor="middle" className="cvalue">
          Rg {formatSI(v.rg, 'Ω')}
        </text>
      </g>
      <g {...partProps('driver', `Gate driver ${formatV(v.vg)}`, sel)}>
        <rect x={42} y={155} width={78} height={50} rx={8} className={`pblock ${v.vg > v.voff ? 'pblock--on' : ''}`} />
        <text x={81} y={175} textAnchor="middle" className="clabel">
          driver
        </text>
        <text x={81} y={193} textAnchor="middle" className="cvalue">
          {live ? formatV(v.vg) : `${lvl(v.vdrv)}/${lvl(v.voff)} V`}
        </text>
      </g>
      <g {...partProps('caps', 'Device capacitances', sel)}>
        <path d="M310 180 V205 M300 205 H320 M300 211 H320 M310 211 V230" className="sym" />
        <text x={296} y={226} textAnchor="end" className="cvalue">
          {v.inLabel} {formatSI(v.cIn, 'F')}
        </text>
        <path d="M330 180 V120 H380" className="wire wire--thin" strokeDasharray="3 3" />
        <text x={324} y={146} textAnchor="end" className="cvalue">
          {v.millerLabel} {formatSI(v.cMiller, 'F')}
        </text>
      </g>
      {values && (
        <text x={250} y={204} textAnchor="middle" className="cvalue cvalue--strong">
          vG {formatV(v.vgate)}
        </text>
      )}
      <path d="M310 230 H380" className="wire" />
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {v.phase}
        {live && ` · ${v.iLabel} ${formatA(v.i)} · p = ${formatSI(v.p, 'W')}`}
      </text>
    </svg>
  )
}

export interface HalfBridgeView {
  vdc: number
  i0: number
  rg: number
  vdrv: number
  voff: number
  /** From the run at the cursor. */
  vg: number
  hsGate: boolean
  vgs: number
  vds: number
  id: number
  iF: number
  vsd: number
  lsOn: boolean
  hsMode: 'on' | 'rev' | 'off'
  lsText: string
  phase: string
  pls: number
  phs: number
  /** Low-side gate current at the cursor (into the gate > 0) and its peak |iG| over the run. */
  ig: number
  igPeak: number
}

/** A GaN HEMT symbol (no body diode): gate, channel (dashed when off), drain at the top, source at the bottom. */
function Hemt({ x, yc, on, color }: { x: number; yc: number; on: boolean; color?: string }) {
  return (
    <>
      <line x1={x - 14} x2={x - 14} y1={yc - 20} y2={yc + 20} className="sym sym--thick" />
      <line x1={x - 6} x2={x - 6} y1={yc - 22} y2={yc + 22} className={`sym ${on ? 'sym--on-q' : ''}`} strokeDasharray={on ? undefined : '5 4'} style={on && color ? { stroke: color } : undefined} />
      <path d={`M${x - 6} ${yc - 14} H${x} V${yc - 24} M${x - 6} ${yc + 14} H${x} V${yc + 24}`} className="sym" />
    </>
  )
}

/** GaN half-bridge double-pulse test: high side (synchronous rectifier), low side (switch under test), load, Vdc. */
export function HalfBridgeDiagram({ v, selected, onSelect, values, live, showPath = false }: { v: HalfBridgeView; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean; showPath?: boolean }) {
  const sel = { selected, onSelect }
  // current flow at the cursor. KCL at the switch node: I0 = iD(LS) + the high-side terminal current (channel iF plus
  // its output-capacitance current), so the high-side branch carries I0 − iD upwards (negative =
  // downwards: shoot-through, or its output capacitance charging); the source carries iD.
  const thr = flowThr(v.i0)
  // with the flow shown, the wires stay neutral under the green dashes (the symbols still show who conducts)
  const hue = (c: string) => (showPath ? '' : c)
  const iHs = v.i0 - v.id
  const hsCond = v.hsMode !== 'off' && Math.abs(v.iF) > 1e-3 * v.i0
  const hsColor = v.hsMode === 'rev' ? '#22b14c' : undefined
  const hsWire = hue(hsCond ? (v.hsMode === 'rev' ? 'wire--diode' : 'wire--igbt') : '')
  const lsWire = hue(v.lsOn ? 'wire--igbt' : '')
  return (
    <svg className="buck-diagram" viewBox="0 0 690 300" role="group" aria-label={`GaN half-bridge: ${v.phase}`}>
      {/* rails and the switch node */}
      <path d="M380 30 H580 V270 H380" className="wire" />
      <path d="M380 30 V61" className={`wire ${hsWire}`} />
      <path d="M380 109 V150" className={`wire ${hsWire}`} />
      <path d="M380 150 V181" className={`wire ${lsWire}`} />
      <path d="M380 229 V270" className={`wire ${lsWire}`} />
      <path d="M470 30 V74 M470 106 V150 H380" className="wire" />
      <Flow on={showPath} i={v.id} thr={thr} runs={[[[580, 142], [580, 30], [470, 30]]]} />
      <Flow on={showPath} i={v.id} thr={thr} runs={[[[380, 270], [580, 270], [580, 158]]]} />
      <Flow on={showPath} i={v.id} thr={thr} runs={[[[380, 150], [380, 181]], [[380, 229], [380, 270]]]} />
      <Flow on={showPath} i={iHs} thr={thr} runs={[[[380, 150], [380, 109]], [[380, 61], [380, 30], [470, 30]]]} />
      <Flow on={showPath} i={v.i0} thr={thr} runs={[[[470, 30], [470, 74]], [[470, 106], [470, 150], [380, 150]]]} />
      <circle cx={380} cy={150} r={3.5} className="node-dot" />
      <text x={388} y={145} className="cnote">
        switch node
      </text>
      <DcSource x={580} y={150} vdc={v.vdc} sel={sel} />
      <LoadSource x={470} y={90} i0={v.i0} sel={sel} />
      {/* high side */}
      <g {...partProps('hs', `High-side HEMT ${v.hsMode === 'rev' ? 'reverse conduction' : v.hsMode === 'on' ? 'ON' : 'OFF'}`, sel)}>
        <rect x={345} y={58} width={70} height={56} className="cpart-hit" />
        <Hemt x={380} yc={85} on={v.hsMode !== 'off'} color={hsColor} />
        <text x={316} y={70} textAnchor="end" className="clabel">
          HS
        </text>
        <text x={316} y={86} textAnchor="end" className="cvalue">
          {v.hsMode === 'rev' ? 'reverse (gate off)' : v.hsMode === 'on' ? 'ON (synchronous)' : 'OFF'}
        </text>
        {live && hsCond && (
          <text x={316} y={102} textAnchor="end" className="cvalue" style={{ fill: v.hsMode === 'rev' ? '#22b14c' : undefined }}>
            vSD {formatV(v.vsd)} · {formatA(v.iF)}
          </text>
        )}
      </g>
      <g {...partProps('hsdrv', `High-side gate ${v.hsGate ? 'ON' : 'OFF'}`, sel)}>
        <rect x={150} y={110} width={94} height={34} rx={8} className={`pblock ${v.hsGate ? 'pblock--on' : ''}`} />
        <text x={197} y={131} textAnchor="middle" className="cvalue">
          HS {v.hsGate ? 'ON' : 'OFF'} {lvl(v.hsGate ? v.vdrv : v.voff)} V
        </text>
      </g>
      <path d="M244 127 H340 V85 H366" className="wire wire--thin" />
      {/* low side */}
      <g {...partProps('ls', `Low-side HEMT ${v.lsText}`, sel)}>
        <rect x={345} y={176} width={70} height={58} className="cpart-hit" />
        <Hemt x={380} yc={205} on={v.lsOn} />
        <text x={424} y={196} className="clabel">
          LS
        </text>
        <text x={424} y={212} className="cvalue">
          {v.lsText}
        </text>
        {values && (
          <text x={424} y={228} className="cvalue cvalue--out">
            vDS {formatV(v.vds)}
          </text>
        )}
      </g>
      <path d="M120 205 H200 M250 205 H366" className="wire" />
      <Flow on={showPath} i={v.ig} thr={flowThr(v.igPeak)} runs={[[[120, 205], [200, 205]], [[250, 205], [366, 205]]]} />
      <g {...partProps('rg', `Gate resistor ${formatSI(v.rg, 'Ω')}`, sel)}>
        <rect x={198} y={193} width={54} height={24} className="cpart-hit" />
        <rect x={205} y={198} width={40} height={14} rx={2} className="sym-body" />
        <text x={225} y={189} textAnchor="middle" className="cvalue">
          Rg {formatSI(v.rg, 'Ω')}
        </text>
      </g>
      <g {...partProps('driver', `Low-side gate driver ${formatV(v.vg)}`, sel)}>
        <rect x={42} y={180} width={78} height={50} rx={8} className={`pblock ${v.vg > v.voff ? 'pblock--on' : ''}`} />
        <text x={81} y={200} textAnchor="middle" className="clabel">
          driver
        </text>
        <text x={81} y={218} textAnchor="middle" className="cvalue">
          {live ? formatV(v.vg) : `${lvl(v.vdrv)}/${lvl(v.voff)} V`}
        </text>
      </g>
      {values && (
        <text x={300} y={228} textAnchor="middle" className="cvalue cvalue--strong">
          vGS {formatV(v.vgs)}
        </text>
      )}
      <text x={345} y={292} className="path-caption" textAnchor="middle">
        {v.phase}
        {live && ` · iD ${formatA(v.id)} · iHS ${formatA(v.iF)}`}
      </text>
    </svg>
  )
}
