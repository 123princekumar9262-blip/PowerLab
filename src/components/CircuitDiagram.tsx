import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { isThreePhase, type LoadType, type RectifierTopology, type ResolvedParams, type SimulationResult, type SimulationSample } from '../types/simulation.ts'
import { ThreePhaseDiagram } from './ThreePhaseDiagram.tsx'
import { formatA, formatSI, formatV, formatCapacitance } from '../utils/format.ts'
import { CapacitorSym, DiodeSym, diodeEnds, GateLead, hopV, inductorPath, resistorPath, SourceSym, type DeviceState } from './circuit/symbols.tsx'
import { deviceName, isScrDevice } from '../circuits/devices.ts'
import type { DiodeId } from '../types/simulation.ts'

interface Props {
  /** Highlight only the conducting path (the "Current path" view). */
  showPath?: boolean
  /** Inspect mode: components are clickable. */
  inspecting?: boolean
  /** The component being inspected (outlined). */
  selectedPart?: string | null
  onPart?: (part: string) => void
  topology: RectifierTopology
  load: LoadType
  params: ResolvedParams
  /** Simulated state at the cursor; null before the first run (idle schematic). */
  sample: SimulationSample | null
  result: SimulationResult | null
  /** Physics Lens stage to emphasise. */
  lens?: string | null
}

/** A wire segment that carries a simulated branch current (signed, along the path direction). */
export interface Flow {
  key: string
  d: string
  current: number
}

// Layout constants (SVG user units)
export const YT = 60 // + output rail
export const YB = 300 // − output rail
export const EX = 640 // load entry (tap on the + rail)

const ohm = (r: number) => formatSI(r, 'Ω').replace(/\.0+ /, ' ')

/**
 * Schematic for any rectifier × load, synchronized to the simulation sample at the cursor.
 * Every highlighted wire and every moving particle corresponds to a simulated branch current.
 */
export function CircuitDiagram(props: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  // Outline the inspected component (the diagrams stay pure drawings of the simulated state).
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    el.querySelectorAll('.is-selected-part').forEach((n) => n.classList.remove('is-selected-part'))
    if (props.selectedPart) el.querySelectorAll(`[data-part="${props.selectedPart}"]`).forEach((n) => n.classList.add('is-selected-part'))
  })
  const onClick = (e: React.MouseEvent) => {
    if (!props.inspecting || !props.onPart) return
    const part = (e.target as Element).closest('[data-part]')?.getAttribute('data-part')
    if (part) props.onPart(part)
  }
  return (
    <div ref={wrap} className={`circuit-wrap ${props.showPath ? 'show-path' : ''} ${props.inspecting ? 'inspecting' : ''}`} onClick={onClick}>
      {isThreePhase(props.topology) ? <ThreePhaseDiagram params={props.params} sample={props.sample} result={props.result} lens={props.lens} /> : <SinglePhaseDiagram {...props} />}
    </div>
  )
}

function SinglePhaseDiagram({ topology, load, params, sample, result, lens }: Props) {
  const idle = !sample
  const x = sample?.values ?? {}
  const d = sample?.diodes ?? []
  const iD = (k: number) => d[k]?.current ?? 0
  const devState = (k: number): DeviceState => (idle ? 'idle' : d[k]?.on ? 'on' : 'off')
  // Freewheeling diode: always the last device in the simulation's diode list.
  const fwK = params.control.freewheel ? d.length - 1 : -1
  const hasFw = params.control.freewheel
  const ifw = hasFw ? (x.ifw ?? 0) : 0
  const irect = topology === 'half-wave' ? iD(0) : iD(0) + iD(1)
  const io = x.io ?? 0
  const il = x.il ?? (load === 'RL' ? io : irect)
  const ic = x.ic ?? 0

  // Scales from the whole run (visual only: particle speed, glows).
  const scale = useMemo(() => {
    if (!result) return { i: 1, p: 1, wl: 1, wc: 1 }
    const absMax = (arr?: Float64Array) => {
      let m = 0
      if (arr) for (let k = 0; k < arr.length; k++) m = Math.max(m, Math.abs(arr[k]))
      return m
    }
    const s = result.trace.signals
    let i = Math.max(absMax(s.io), absMax(s.ic), absMax(s.il))
    for (const dt of result.trace.diodes) i = Math.max(i, absMax(dt.current))
    return { i: i || 1, p: absMax(s.pload) || 1, wl: absMax(s.wl) || 1, wc: absMax(s.wc) || 1 }
  }, [result])

  const flows: Flow[] = []
  const parts: ReactNode[] = []
  const labels: ReactNode[] = []

  const loadParts: ReactNode[] = []
  const nLeft = renderLoad({ load, params, idle, x, io, il, ic, irect: irect + ifw, scale, flows, parts: loadParts, labels })
  const srcParts: ReactNode[] = []
  const fwParts: ReactNode[] = []

  // ── Rectifier part (delivers to the + rail at EX and takes the return from nLeft) ─
  const srcLabel = (cx: number, cy: number, key: string, name: string, value: number | null) => (
    <g key={`sl-${key}`}>
      <text className="label" x={cx - 40} y={cy - 6} textAnchor="end">{name}</text>
      <text className="value" x={cx - 40} y={cy + 12} textAnchor="end">{value === null ? `${formatSI(params.vrms, 'V')} rms` : formatV(value)}</text>
    </g>
  )
  const polarity = (cx: number, yTop: number, yBot: number, v: number, key: string) =>
    !idle && v !== 0 ? (
      <g key={key}>
        <text className="polarity" x={cx + 36} y={yTop + 4}>{v > 0 ? '+' : '−'}</text>
        <text className="polarity" x={cx + 36} y={yBot + 10}>{v > 0 ? '−' : '+'}</text>
      </g>
    ) : null
  const vin = idle ? null : (x.vin ?? 0)
  const dLabel = (k: number) => deviceName(params, `D${k + 1}` as DiodeId)
  // SCRs: a gate lead whose dot lights while the simulated gate pulse is applied.
  const gate = (k: number, gx: number, gy: number, angle: number, size = 20) =>
    isScrDevice(params, `D${k + 1}` as DiodeId) ? <GateLead key={`g${k}`} x={gx} y={gy} angle={angle} size={size} on={idle ? null : !!d[k]?.gate} /> : null
  // Freewheeling diode across the load at x = fx (cathode up, to the + rail); the rails are split
  // at its junctions by the caller so each wire segment carries its own simulated current.
  const addFw = (fx: number, tagX: number, tagY: number) => {
    const fe = diodeEnds(fx, 180, -90, 18)
    fwParts.push(<path key="fw" className={`wire ${ifw > 0 ? 'wire--active' : ''}`} d={`M${fx},${YT} V${fe.cathode.y} M${fx},${fe.anode.y} V${YB}`} />)
    fwParts.push(<DiodeSym key="Dfw" x={fx} y={180} angle={-90} size={18} state={devState(fwK)} label="Dfw" labelDx={30} labelDy={6} part="Dfw" />)
    parts.push(<circle key="fjt" className="junction" cx={fx} cy={YT} r={3.5} />, <circle key="fjb" className="junction" cx={fx} cy={YB} r={3.5} />)
    flows.push({ key: 'fw', d: `M${fx},${YB} V${YT}`, current: ifw })
    labels.push(fwTag(tagX, tagY, sample, fwK))
  }
  const act = (i: number) => (i > 0 ? 'wire--active' : '')
  const iLoad = irect + ifw

  if (topology === 'half-wave' && hasFw) {
    // Rails are split at the freewheeling diode's junctions (x = FW_X), so each segment shows
    // its own simulated current:  source side = iD1,  load side = io = iD1 + iDfw,  Dfw = iDfw.
    const S = { cx: 100, cy: 180, r: 32 }
    const dx = 290
    const FW_X = 480
    const { anode, cathode } = diodeEnds(dx, YT, 0)
    srcParts.push(<SourceSym key="S" {...S} part="source" />)
    srcParts.push(<path key="w1" className={`wire ${act(iD(0))}`} d={`M${S.cx},${S.cy - S.r} V${YT} H${anode.x}`} />)
    srcParts.push(<path key="w2" className={`wire ${act(iD(0))}`} d={`M${cathode.x},${YT} H${FW_X}`} />)
    srcParts.push(<path key="w3" className={`wire ${act(iD(0))}`} d={`M${FW_X},${YB} H${S.cx} V${S.cy + S.r}`} />)
    srcParts.push(<DiodeSym key="D1" x={dx} y={YT} angle={0} state={devState(0)} label={dLabel(0)} part="D1" />, gate(0, dx, YT, 0))
    parts.push(<path key="w4" className={`wire ${act(iLoad)}`} d={`M${FW_X},${YT} H${EX}`} />)
    parts.push(<path key="w5" className={`wire ${act(iLoad)}`} d={`M${nLeft},${YB} H${FW_X}`} />)
    addFw(FW_X, FW_X - 96, 236)
    flows.push({ key: 'src', d: `M${S.cx},${S.cy - S.r} V${YT} H${FW_X}`, current: iD(0) })
    flows.push({ key: 'rail', d: `M${FW_X},${YT} H${EX}`, current: iLoad })
    flows.push({ key: 'retL', d: `M${nLeft},${YB} H${FW_X}`, current: iLoad })
    flows.push({ key: 'ret', d: `M${FW_X},${YB} H${S.cx} V${S.cy + S.r}`, current: iD(0) })
    labels.push(srcLabel(S.cx, S.cy, 's', 'vin', vin), polarity(S.cx, S.cy - 18, S.cy + 18, vin ?? 0, 'pol'))
    labels.push(diodeTag(dx, YT + 40, sample, 0, dLabel(0)))
    labels.push(<text key="sub" className="sub" x={S.cx} y={YB + 30} textAnchor="middle">{formatSI(params.vrms, 'V')} rms · {params.frequency} Hz</text>)
    if (!idle) {
      const n1 = dLabel(0)
      const mode = iD(0) > 0 && ifw > 0 ? `Hand-over: ${n1} and Dfw share the current` : ifw > 0 ? 'Freewheeling: L drives io round L → R → Dfw' : iD(0) > 0 ? `Source supplying: vin → ${n1} → L → R` : 'No current: both devices blocking'
      labels.push(<text key="mode" className={`value value--small fw-mode ${ifw > 0 ? 'fw-mode--on' : ''}`} x={(FW_X + EX) / 2 - 40} y={YB + 30} textAnchor="middle">{mode}</text>)
    }
  } else if (topology === 'half-wave') {
    const S = { cx: 100, cy: 180, r: 32 }
    const dx = 302
    const { anode, cathode } = diodeEnds(dx, YT, 0)
    const act = irect > 0 ? 'wire--active' : ''
    parts.push(<SourceSym key="S" {...S} part="source" />)
    parts.push(<path key="w1" className={`wire ${act}`} d={`M${S.cx},${S.cy - S.r} V${YT} H${anode.x}`} />)
    parts.push(<path key="w2" className={`wire ${act}`} d={`M${cathode.x},${YT} H${EX}`} />)
    parts.push(<path key="w3" className={`wire ${act}`} d={`M${nLeft},${YB} H${S.cx} V${S.cy + S.r}`} />)
    parts.push(<DiodeSym key="D1" x={dx} y={YT} angle={0} state={devState(0)} label={dLabel(0)} part="D1" />, gate(0, dx, YT, 0))
    flows.push({ key: 'loop', d: `M${S.cx},${S.cy - S.r} V${YT} H${EX}`, current: iD(0) })
    flows.push({ key: 'ret', d: `M${nLeft},${YB} H${S.cx} V${S.cy + S.r}`, current: irect })
    labels.push(srcLabel(S.cx, S.cy, 's', 'vin', vin), polarity(S.cx, S.cy - 18, S.cy + 18, vin ?? 0, 'pol'))
    labels.push(diodeTag(dx, YT + 40, sample, 0, dLabel(0)))
    labels.push(<text key="sub" className="sub" x={S.cx} y={YB + 30} textAnchor="middle">{formatSI(params.vrms, 'V')} rms · {params.frequency} Hz</text>)
  } else if (topology === 'center-tap') {
    const S1 = { cx: 100, cy: 112, r: 26 }
    const S2 = { cx: 100, cy: 248, r: 26 }
    const ct = { x: 100, y: 180 }
    const yD2 = 340
    const dx = 302
    const e1 = diodeEnds(dx, YT, 0)
    const e2 = diodeEnds(dx, yD2, 0)
    const riser = 830
    parts.push(<SourceSym key="S1" {...S1} part="source" />, <SourceSym key="S2" {...S2} part="source" />)
    parts.push(<path key="ctw" className="wire" d={`M${S1.cx},${S1.cy + S1.r} V${S2.cy - S2.r}`} />)
    parts.push(<circle key="ctj" className="junction" cx={ct.x} cy={ct.y} r={3.5} />)
    const FWC = 520
    const aEnd = hasFw ? FWC : EX
    parts.push(<path key="a" className={`wire ${iD(0) > 0 ? 'wire--active' : ''}`} d={`M${S1.cx},${S1.cy - S1.r} V${YT} H${e1.anode.x} M${e1.cathode.x},${YT} H${aEnd}`} />)
    parts.push(<path key="b" className={`wire ${iD(1) > 0 ? 'wire--active' : ''}`} d={`M${S2.cx},${S2.cy + S2.r} V${yD2} H${e2.anode.x} M${e2.cathode.x},${yD2} H${riser} V${YT} H${EX}`} />)
    parts.push(<circle key="pj" className="junction" cx={EX} cy={YT} r={3.5} />)
    const nStart = hasFw ? FWC : nLeft
    parts.push(<path key="n" className={`wire ${irect > 0 ? 'wire--active' : ''}`} d={`M${nStart},${YB} H160 V${ct.y} H${ct.x}`} />)
    parts.push(<DiodeSym key="D1" x={dx} y={YT} angle={0} state={devState(0)} label={dLabel(0)} part="D1" />, gate(0, dx, YT, 0))
    parts.push(<DiodeSym key="D2" x={dx} y={yD2} angle={0} state={devState(1)} label={dLabel(1)} labelDy={-26} part="D2" />, gate(1, dx, yD2, 0))
    flows.push({ key: 'a', d: `M${S1.cx},${S1.cy - S1.r} V${YT} H${aEnd}`, current: iD(0) })
    flows.push({ key: 'b', d: `M${S2.cx},${S2.cy + S2.r} V${yD2} H${riser} V${YT} H${EX}`, current: iD(1) })
    flows.push({ key: 'n', d: `M${nStart},${YB} H160 V${ct.y} H${ct.x}`, current: irect })
    if (hasFw) {
      // D1 side of the + rail: iD1 up to Dfw, iD1 + iDfw on to the load; − rail: io back to Dfw, the rectifier current on to the tap.
      parts.push(<path key="a2" className={`wire ${act(iD(0) + ifw)}`} d={`M${FWC},${YT} H${EX}`} />)
      parts.push(<path key="n2" className={`wire ${act(iLoad)}`} d={`M${nLeft},${YB} H${FWC}`} />)
      flows.push({ key: 'a2', d: `M${FWC},${YT} H${EX}`, current: iD(0) + ifw })
      flows.push({ key: 'n2', d: `M${nLeft},${YB} H${FWC}`, current: iLoad })
      addFw(FWC, FWC - 96, 190)
    }
    flows.push({ key: 'ct1', d: `M${ct.x},${ct.y} V${S1.cy + S1.r}`, current: iD(0) })
    flows.push({ key: 'ct2', d: `M${ct.x},${ct.y} V${S2.cy - S2.r}`, current: iD(1) })
    labels.push(srcLabel(S1.cx, S1.cy, 's1', '+vin', vin), srcLabel(S2.cx, S2.cy, 's2', 'vin', vin))
    labels.push(polarity(S1.cx, S1.cy - 14, S1.cy + 10, vin ?? 0, 'p1'), polarity(S2.cx, S2.cy - 14, S2.cy + 10, vin ?? 0, 'p2'))
    labels.push(<text key="ctl" className="tiny" x={ct.x + 10} y={ct.y - 6}>center tap</text>)
    labels.push(diodeTag(dx + 150, YT + 34, sample, 0, dLabel(0)), diodeTag(dx + 150, yD2 - 66, sample, 1, dLabel(1)))
  } else {
    // Bridge: a (top) and b (bottom) are the AC inputs, p (right) is +, n (left) is −.
    const S = { cx: 90, cy: 180, r: 30 }
    const a = { x: 300, y: 95 }
    const b = { x: 300, y: 265 }
    const p = { x: 400, y: 180 }
    const n = { x: 200, y: 180 }
    const mid = (u: { x: number; y: number }, v: { x: number; y: number }) => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 })
    const ang = (u: { x: number; y: number }, v: { x: number; y: number }) => (Math.atan2(v.y - u.y, v.x - u.x) * 180) / Math.PI
    const edges = [
      { k: 0, from: a, to: p }, // D1: a → p
      { k: 1, from: b, to: p }, // D2: b → p
      { k: 2, from: n, to: a }, // D3: n → a
      { k: 3, from: n, to: b }, // D4: n → b
    ]
    parts.push(<SourceSym key="S" {...S} part="source" />)
    const iSrcA = iD(0) - iD(2) // current delivered into terminal a
    parts.push(<path key="sa" className={`wire ${Math.abs(iSrcA) > 0 ? 'wire--active' : ''}`} d={`M${S.cx},${S.cy - S.r} V${a.y} H${a.x}`} />)
    parts.push(<path key="sb" className={`wire ${Math.abs(iSrcA) > 0 ? 'wire--active' : ''}`} d={`M${b.x},${b.y} H${S.cx} V${S.cy + S.r}`} />)
    flows.push({ key: 'sa', d: `M${S.cx},${S.cy - S.r} V${a.y} H${a.x}`, current: iSrcA })
    flows.push({ key: 'sb', d: `M${b.x},${b.y} H${S.cx} V${S.cy + S.r}`, current: iD(3) - iD(1) })
    for (const e of edges) {
      const m = mid(e.from, e.to)
      const an = ang(e.from, e.to)
      const ends = diodeEnds(m.x, m.y, an, 16)
      parts.push(<path key={`e${e.k}`} className={`wire ${iD(e.k) > 0 ? 'wire--active' : ''}`} d={`M${e.from.x},${e.from.y} L${ends.anode.x},${ends.anode.y} M${ends.cathode.x},${ends.cathode.y} L${e.to.x},${e.to.y}`} />)
      const offX = e.k === 0 || e.k === 1 ? 26 : -26
      const offY = e.k === 0 || e.k === 2 ? -12 : 26
      parts.push(<DiodeSym key={`D${e.k + 1}`} x={m.x} y={m.y} angle={an} size={16} state={devState(e.k)} label={dLabel(e.k)} labelDx={offX} labelDy={offY} part={`D${e.k + 1}`} />, gate(e.k, m.x, m.y, an, 16))
      flows.push({ key: `d${e.k}`, d: `M${e.from.x},${e.from.y} L${e.to.x},${e.to.y}`, current: iD(e.k) })
    }
    for (const v of [a, b, p, n]) parts.push(<circle key={`j${v.x}-${v.y}`} className="junction" cx={v.x} cy={v.y} r={3.5} />)
    const FWB = 545
    const peEnd = hasFw ? FWB : EX
    const nnStart = hasFw ? FWB : nLeft
    parts.push(<path key="pe" className={`wire ${irect > 0 ? 'wire--active' : ''}`} d={`M${p.x},${p.y} H460 V${YT} H${peEnd}`} />)
    // n → − rail crosses the source's return wire (y = b.y): drawn with a hop (no connection).
    parts.push(<path key="nn" className={`wire ${irect > 0 ? 'wire--active' : ''}`} d={`M${nnStart},${YB} H${n.x} ` + hopV(n.x, YB, b.y, n.y).replace(/^M[^ ]+ /, '')} />)
    flows.push({ key: 'pe', d: `M${p.x},${p.y} H460 V${YT} H${peEnd}`, current: irect })
    flows.push({ key: 'nn', d: `M${nnStart},${YB} H${n.x} V${n.y}`, current: irect })
    if (hasFw) {
      parts.push(<path key="pe2" className={`wire ${act(iLoad)}`} d={`M${FWB},${YT} H${EX}`} />)
      parts.push(<path key="nn2" className={`wire ${act(iLoad)}`} d={`M${nLeft},${YB} H${FWB}`} />)
      flows.push({ key: 'pe2', d: `M${FWB},${YT} H${EX}`, current: iLoad })
      flows.push({ key: 'nn2', d: `M${nLeft},${YB} H${FWB}`, current: iLoad })
      addFw(FWB, FWB, YB + 22)
    }
    labels.push(srcLabel(S.cx, S.cy, 's', 'vin', vin), polarity(S.cx, S.cy - 16, S.cy + 14, vin ?? 0, 'pol'))
    labels.push(<text key="ta" className="tiny" x={a.x} y={a.y - 12} textAnchor="middle">a</text>, <text key="tb" className="tiny" x={b.x} y={b.y + 20} textAnchor="middle">b</text>)
    labels.push(<text key="sub" className="sub" x={S.cx} y={YB + 44} textAnchor="middle">{formatSI(params.vrms, 'V')} rms · {params.frequency} Hz</text>)
    if (!idle) {
      const on = d.filter((q) => q.on).map((q) => q.id)
      labels.push(
        <text key="pairs" className="value value--small" x={300} y={YB + 44} textAnchor="middle">
          {on.length ? `${on.map((id) => deviceName(params, id)).join(' + ')} conducting` : 'all blocking'}
        </text>,
      )
    }
  }

  // Ground marker on the − rail
  parts.push(
    <g key="gnd" className="ground">
      <path d={`M${hasFw && topology !== 'half-wave' ? 250 : EX - 110},${YB} v12 m-12,0 h24 m-18,6 h12 m-7,6 h2`} />
    </g>,
  )

  const refs = useFlowAnimation(flows, scale.i)
  const visible = (f: Flow) => !idle && Math.abs(f.current) > scale.i * 1e-4
  const state = idle ? 'idle' : d.some((q) => q.on) ? 'on' : 'off'

  return (
    <svg
      className={`circuit circuit--${state} ${lens ? `lens lens--${lens}` : ''}`}
      viewBox="-70 0 960 380"
      role="img"
      aria-label={
        idle
          ? `${topology} rectifier with ${load} load.`
          : `${topology} rectifier${hasFw ? ' with freewheeling diode' : ''}. Vin ${formatV(x.vin ?? 0)}. ${d.filter((q) => q.on).map((q) => q.id).join(', ') || 'No diode'} conducting. Vout ${formatV(x.vout ?? 0)}.`
      }
    >
      <defs>
        <radialGradient id="heat">
          <stop offset="0%" stopColor="var(--heat)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--heat)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="field">
          <stop offset="0%" stopColor="var(--sig-l)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--sig-l)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {parts}
      {srcParts.length > 0 && <g className="src-block">{srcParts}</g>}
      {fwParts.length > 0 && <g className="fw-block">{fwParts}</g>}
      <g className="load-block">{loadParts}</g>
      {flows.map((f) => (visible(f) ? <path key={`f-${f.key}`} ref={refs(f.key)} className="flow" d={f.d} /> : null))}
      {labels}
    </svg>
  )
}


/** Everything the load block needs to draw itself from the simulated sample. */
export interface LoadCtx {
  load: LoadType
  params: ResolvedParams
  idle: boolean
  x: SimulationSample['values']
  io: number
  il: number
  ic: number
  /** Current delivered by the rectifier into the + rail. */
  irect: number
  scale: { i: number; p: number; wl: number; wc: number }
  flows: Flow[]
  parts: ReactNode[]
  labels: ReactNode[]
}

/**
 * Load block, shared by every rectifier: hangs from the + rail at x = EX and returns on the
 * − rail. Returns the x where the return joins the − rail's leftward run.
 */
export function renderLoad(c: LoadCtx): number {
  // ── Load block (hangs from the + rail at EX, returns on the − rail) ─────────────
  let nLeft = EX // x where the load's return joins the − rail's leftward run
  const { load, params, idle, x, io, il, ic, irect, scale, flows, parts, labels } = c
  const rLabel = (rx: number, ry0: number, ry1: number) => (
    <g key="rlabel">
      <text className="label" x={rx - 26} y={(ry0 + ry1) / 2 - 4} textAnchor="end">R</text>
      <text className="sub" x={rx - 26} y={(ry0 + ry1) / 2 + 13} textAnchor="end">{ohm(params.resistance)}</text>
    </g>
  )
  const heat = !idle ? Math.min(1, (x.pload ?? 0) / scale.p) : 0
  const heatGlow = (rx: number, ry0: number, ry1: number) =>
    heat > 0.01 ? <ellipse key="heat" cx={rx} cy={(ry0 + ry1) / 2} rx={36} ry={(ry1 - ry0) / 2 + 12} fill="url(#heat)" opacity={heat} /> : null
  const lGlow = (lx: number, ly0: number, ly1: number) => {
    const w = !idle ? Math.min(1, (x.wl ?? 0) / scale.wl) : 0
    return w > 0.01 ? <ellipse key="lglow" cx={lx} cy={(ly0 + ly1) / 2} rx={30} ry={(ly1 - ly0) / 2 + 10} fill="url(#field)" opacity={w} /> : null
  }
  const lLabel = (lx: number, ly0: number, ly1: number) => (
    <g key="llabel">
      <text className="label" x={lx - 26} y={(ly0 + ly1) / 2 - 4} textAnchor="end">L</text>
      <text className="sub" x={lx - 26} y={(ly0 + ly1) / 2 + 13} textAnchor="end">{formatSI(params.inductance, 'H')}</text>
      {/* under the inductor's name and value (to its right it ran into the Vout bracket) */}
      {!idle && <text className="value value--small" x={lx - 26} y={(ly0 + ly1) / 2 + 30} textAnchor="end">vL {formatV(x.vl ?? 0)}</text>}
    </g>
  )
  const capFill = !idle ? Math.sqrt(Math.min(1, (x.wc ?? 0) / scale.wc)) : 0
  const outBracket = (bx: number, y0: number, y1: number, value: number | null, name = isThreePhase(params.topology) ? 'Vo' : 'Vout') => (
    <g key={`br-${name}`}>
      <path className="bracket" d={`M${bx},${y0} h8 V${y1} h-8`} />
      <text className={`polarity ${value !== null && value > 0 ? '' : 'polarity--dim'}`} x={bx + 18} y={y0 + 6}>+</text>
      <text className={`polarity ${value !== null && value > 0 ? '' : 'polarity--dim'}`} x={bx + 18} y={y1 + 2}>−</text>
      <text className="label" x={bx + 24} y={(y0 + y1) / 2 - 4}>{name}</text>
      <text className="value" x={bx + 24} y={(y0 + y1) / 2 + 14}>{value === null ? '—' : formatV(value)}</text>
    </g>
  )

  if (load === 'R' || load === 'RL') {
    const rTop = load === 'R' ? 110 : 190
    const rBot = load === 'R' ? 250 : 275
    if (load === 'RL') {
      const lTop = 80
      const lBot = 165
      parts.push(lGlow(EX, lTop, lBot))
      parts.push(<path key="Lw" className={`wire ${io > 0 ? 'wire--active' : ''}`} d={`M${EX},${YT} V${lTop} M${EX},${lBot} V${rTop}`} />)
      parts.push(<path key="L" className={`wire coil ${io > 0 ? 'wire--active' : ''}`} d={inductorPath(EX, lTop, lBot)} />)
      parts.push(<rect key="Lhit" className="part-hit" data-part="L" x={EX - 22} y={lTop} width={44} height={lBot - lTop} />)
      flows.push({ key: 'e-l', d: `M${EX},${YT} V${rTop}`, current: io })
      labels.push(lLabel(EX, lTop, lBot))
    } else {
      parts.push(<path key="er" className={`wire ${io > 0 ? 'wire--active' : ''}`} d={`M${EX},${YT} V${rTop}`} />)
      flows.push({ key: 'e-r', d: `M${EX},${YT} V${rTop}`, current: io })
    }
    parts.push(heatGlow(EX, rTop, rBot))
    parts.push(<path key="R" className={`wire ${io > 0 ? 'wire--active' : ''}`} d={resistorPath(EX, rTop, rBot) + ` M${EX},${rBot} V${YB}`} />)
    parts.push(<rect key="Rhit" className="part-hit" data-part="R" x={EX - 22} y={rTop} width={44} height={rBot - rTop} />)
    flows.push({ key: 'R', d: resistorPath(EX, rTop, rBot) + ` V${YB}`, current: io })
    labels.push(rLabel(EX, rTop, rBot))
    labels.push(outBracket(EX + 44, YT + 20, YB - 20, idle ? null : (x.vout ?? 0)))
    // left of the load wire: on the right it ran into the Vout bracket and its + sign
    if (!idle && io > 0) labels.push(<text key="io" className="value value--current" x={EX - 18} y={YT + 34} textAnchor="end">io {formatA(io)}</text>)
  } else {
    // RC: split at y = ys into C (left) and R (right). RLC: inductor first, then the split.
    const ys = load === 'RC' ? 92 : 168
    const cx = EX - 50
    const rx = EX + 50
    if (load === 'RLC') {
      const lTop = 78
      const lBot = 150
      parts.push(lGlow(EX, lTop, lBot))
      parts.push(<path key="Lw" className={`wire ${il > 0 ? 'wire--active' : ''}`} d={`M${EX},${YT} V${lTop} M${EX},${lBot} V${ys}`} />)
      parts.push(<path key="L" className={`wire coil ${il > 0 ? 'wire--active' : ''}`} d={inductorPath(EX, lTop, lBot)} />)
      parts.push(<rect key="Lhit" className="part-hit" data-part="L" x={EX - 22} y={lTop} width={44} height={lBot - lTop} />)
      flows.push({ key: 'e-l', d: `M${EX},${YT} V${ys}`, current: il })
      labels.push(lLabel(EX, lTop, lBot))
      if (!idle) labels.push(<text key="il" className="value value--small" x={EX + 20} y={lTop - 2}>iL {formatA(il)}</text>)
    } else {
      parts.push(<path key="es" className={`wire ${irect > 0 ? 'wire--active' : ''}`} d={`M${EX},${YT} V${ys}`} />)
      flows.push({ key: 'e-s', d: `M${EX},${YT} V${ys}`, current: irect })
    }
    const cMid = (ys + YB) / 2
    parts.push(<path key="splitc" className={`wire ${Math.abs(ic) > 0 ? 'wire--active' : ''}`} d={`M${EX},${ys} H${cx}`} />)
    parts.push(<CapacitorSym key="C" x={cx} y0={ys} y1={YB} fill={capFill} />)
    parts.push(<rect key="Chit" className="part-hit" data-part="C" x={cx - 26} y={cMid - 26} width={52} height={52} />)
    flows.push({ key: 'c', d: `M${EX},${ys} H${cx} V${cMid - 5} M${cx},${cMid + 5} V${YB}`, current: ic })
    const rTop = ys + 30
    const rBot = YB - 30
    parts.push(heatGlow(rx, rTop, rBot))
    parts.push(<path key="R" className={`wire ${io > 0 ? 'wire--active' : ''}`} d={`M${EX},${ys} H${rx} V${rTop} ` + resistorPath(rx, rTop, rBot).replace(/^M[^ ]+ /, '') + ` V${YB} H${cx}`} />)
    parts.push(<rect key="Rhit" className="part-hit" data-part="R" x={rx - 22} y={rTop} width={44} height={rBot - rTop} />)
    parts.push(<circle key="jt" className="junction" cx={EX} cy={ys} r={3.5} />)
    parts.push(<circle key="jb" className="junction" cx={cx} cy={YB} r={3.5} />)
    flows.push({ key: 'r', d: `M${EX},${ys} H${rx} V${rTop} ` + resistorPath(rx, rTop, rBot).replace(/^M[^ ]+ /, '') + ` V${YB} H${cx}`, current: io })
    labels.push(
      <g key="clabel">
        <text className="label" x={cx - 30} y={cMid - 4} textAnchor="end">C</text>
        <text className="sub" x={cx - 30} y={cMid + 13} textAnchor="end">{formatCapacitance(params.capacitance)}</text>
        {/* above the name: below it, the reading met the lower diode's label in some circuits */}
        {!idle && <text className="value value--small" x={cx - 30} y={cMid - 24} textAnchor="end">iC {formatA(ic, true)}</text>}
      </g>,
    )
    labels.push(
      <g key="rl2">
        <text className="label" x={rx + 20} y={(rTop + rBot) / 2 - 4}>R</text>
        <text className="sub" x={rx + 20} y={(rTop + rBot) / 2 + 13}>{ohm(params.resistance)}</text>
        {!idle && <text className="value value--small" x={rx + 20} y={(rTop + rBot) / 2 + 32}>io {formatA(io)}</text>}
      </g>,
    )
    // far enough right that R's readings (io) end before it
    labels.push(outBracket(rx + 100, ys + 4, YB - 4, idle ? null : (x.vout ?? 0)))
    if (load === 'RLC' && !idle) labels.push(<text key="vrect" className="value value--small" x={EX - 22} y={YT - 10} textAnchor="end">vrect {formatV(x.vrect ?? 0)}</text>)
    nLeft = cx
  }
  return nLeft
}

/** Freewheeling-diode tag: state, bias, and the simulated current and voltage. */
function fwTag(x: number, y: number, sample: SimulationSample | null, k: number) {
  if (!sample || k < 0 || !sample.diodes[k]) return null
  const dd = sample.diodes[k]
  return (
    <g key="fwtag" transform={`translate(${x}, ${y})`}>
      <rect className={`badge ${dd.on ? 'badge--on' : 'badge--off'}`} x={-68} y={-14} width={136} height={22} rx={11} />
      <text className="badge-text" x={0} y={1} textAnchor="middle">{dd.on ? '● Dfw ON · forward' : dd.bias === 'reverse' ? '✕ Dfw OFF · reverse' : '○ Dfw OFF'}</text>
      <text className="value value--small" x={0} y={26} textAnchor="middle">i {formatA(dd.current)}</text>
      <text className="value value--small" x={0} y={44} textAnchor="middle">v {formatV(dd.voltage)}</text>
    </g>
  )
}

/** ON/OFF tag with the device voltage. */
function diodeTag(x: number, y: number, sample: SimulationSample | null, k: number, name = `D${k + 1}`) {
  if (!sample || !sample.diodes[k]) return null
  const dd = sample.diodes[k]
  const reverse = dd.bias === 'reverse'
  return (
    <g key={`tag${k}`} transform={`translate(${x}, ${y})`}>
      <text className="value value--small" x={0} y={0} textAnchor="middle">v{name} {formatV(dd.voltage)}</text>
      <rect className={`badge ${dd.on ? 'badge--on' : 'badge--off'}`} x={-62} y={8} width={124} height={22} rx={11} />
      <text className="badge-text" x={0} y={23} textAnchor="middle">{dd.on ? '● ON · conducting' : reverse ? '✕ OFF · blocking' : '○ OFF · below Vf'}</text>
    </g>
  )
}

/**
 * Move each flow's dotted pattern along its path at a speed ∝ |current| (direction = sign),
 * by writing stroke-dashoffset directly (no React re-render per frame). Respects reduced motion.
 */
export function useFlowAnimation(flows: Flow[], iScale: number) {
  const els = useRef(new Map<string, SVGPathElement>())
  const speeds = useRef(new Map<string, number>())
  const offsets = useRef(new Map<string, number>())
  speeds.current = new Map(flows.map((f) => [f.key, Math.sign(f.current) * (16 + 90 * Math.min(1, Math.abs(f.current) / iScale))]))

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      for (const [key, el] of els.current) {
        const off = ((offsets.current.get(key) ?? 0) - (speeds.current.get(key) ?? 0) * dt) % 1000
        offsets.current.set(key, off)
        el.style.strokeDashoffset = String(off)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (key: string) => (el: SVGPathElement | null) => {
    if (el) els.current.set(key, el)
    else els.current.delete(key)
  }
}
