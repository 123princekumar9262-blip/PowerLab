import { useMemo, type ReactNode } from 'react'
import { DEVICE_MAP } from '../explanations/threePhase.ts'
import type { ResolvedParams, SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatSI, formatV } from '../utils/format.ts'
import { EX, renderLoad, useFlowAnimation, YB, YT, type Flow } from './CircuitDiagram.tsx'
import { DiodeSym, diodeEnds, GateLead, hopH, SourceSym, type DeviceState } from './circuit/symbols.tsx'

interface Props {
  params: ResolvedParams
  sample: SimulationSample | null
  result: SimulationResult | null
  /** Physics Lens stage to emphasise (source, condition, diode, path, output, energy, waveform). */
  lens?: string | null
}

type Ph = 'a' | 'b' | 'c'
const PHASES: Ph[] = ['a', 'b', 'c']
const PHASE_Y: Record<Ph, number> = { a: 120, b: 180, c: 240 }
const LEG_X: Record<Ph, number> = { a: 300, b: 390, c: 480 }
const SRC_X = 90
const BUS_X = 40
const UPPER_Y = 90
const LOWER_Y = 272
const FW_X = 556

/**
 * Three-phase schematic: Y-connected source (neutral bus on the left) feeding either a
 * 3-pulse midpoint rectifier (three diodes on a common cathode bus) or a six-device bridge
 * (three legs; upper devices in one row, lower devices in another). Every wire carries its
 * simulated branch current: the rails show the currents adding up leg by leg.
 */
export function ThreePhaseDiagram({ params: p, sample, result, lens }: Props) {
  const idle = !sample
  const x = sample?.values ?? {}
  const half = p.topology === '3ph-half-wave'
  const upperScr = p.control.device === 'scr' || p.topology === '3ph-half-controlled'
  const lowerScr = p.control.device === 'scr' && p.topology === '3ph-bridge'
  const byId = (id: string) => sample?.diodes.find((d) => d.id === id)
  const iOf = (id: string) => byId(id)?.current ?? 0
  const stateOf = (id: string): DeviceState => (idle ? 'idle' : byId(id)?.on ? 'on' : 'off')
  const gateOf = (id: string) => {
    if (!result || !sample) return null
    const g = result.trace.diodes[result.diodeIds.indexOf(id as never)]?.gate
    return g ? g[sample.index] === 1 : null
  }
  const name = (id: string) => (id === 'Dfw' ? 'Dfw' : (DEVICE_MAP[id]?.upper ? upperScr : lowerScr) ? id.replace('D', 'T') : id)

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

  const up: Record<Ph, string> = half ? { a: 'Da', b: 'Db', c: 'Dc' } : { a: 'D1', b: 'D3', c: 'D5' }
  const lo: Record<Ph, string> = { a: 'D4', b: 'D6', c: 'D2' }
  const iUp = (q: Ph) => iOf(up[q])
  const iLo = (q: Ph) => (half ? 0 : iOf(lo[q]))
  const iPhase = (q: Ph) => iUp(q) - iLo(q) // current leaving source q into the rectifier
  const irect = PHASES.reduce((acc, q) => acc + iUp(q), 0)
  const io = x.io ?? 0

  const flows: Flow[] = []
  const parts: ReactNode[] = []
  const loadParts: ReactNode[] = []
  const labels: ReactNode[] = []
  const active = (i: number) => (Math.abs(i) > scale.i * 1e-4 ? 'wire--active' : '')
  const phaseValue: Record<Ph, number> = { a: x.vin ?? 0, b: x.vb ?? 0, c: x.vc ?? 0 }

  // ── Load (shared block) ─────────────────────────────────────────────────────────
  const il = x.il ?? (p.load === 'RL' ? io : irect)
  const nLeft = renderLoad({ load: p.load, params: p, idle, x, io, il, ic: x.ic ?? 0, irect: irect + (p.control.freewheel ? iOf('Dfw') : 0), scale, flows, parts: loadParts, labels })

  // ── Source: Y connection with a neutral bus ─────────────────────────────────────
  for (const q of PHASES) {
    const y = PHASE_Y[q]
    const missing = p.faults.missingPhase === q
    parts.push(
      <g key={`src${q}`} className={`source source--${q} ${missing ? 'is-missing' : ''}`}>
        <SourceSym cx={SRC_X} cy={y} r={20} part={`phase-${q}`} />
      </g>,
    )
    parts.push(<path key={`bus${q}`} className="wire" d={`M${BUS_X},${y} H${SRC_X - 20}`} />)
    flows.push({ key: `nb${q}`, d: `M${BUS_X},${y} H${SRC_X - 20}`, current: iPhase(q) })
    labels.push(
      <g key={`sl${q}`}>
        <text className={`label phase-label phase-label--${q}`} x={SRC_X} y={y + 4} textAnchor="middle" fontSize="11">
          {q}
        </text>
        <text className="value value--small" x={SRC_X + 26} y={y - 8}>
          V{q}N {idle ? '' : formatV(phaseValue[q])}
        </text>
        {missing && (
          <text className="fault-tag" x={SRC_X + 26} y={y + 16}>
            ✕ phase open
          </text>
        )}
      </g>,
    )
  }
  const busBottom = half ? YB : PHASE_Y.c
  parts.push(<path key="nbus" className="wire" d={`M${BUS_X},${PHASE_Y.a} V${busBottom}`} />)
  flows.push({ key: 'nbab', d: `M${BUS_X},${PHASE_Y.b} V${PHASE_Y.a}`, current: iPhase('a') })
  flows.push({ key: 'nbbc', d: `M${BUS_X},${PHASE_Y.c} V${PHASE_Y.b}`, current: iPhase('a') + iPhase('b') })
  for (const q of PHASES) parts.push(<circle key={`nj${q}`} className="junction" cx={BUS_X} cy={PHASE_Y[q]} r={3.5} />)
  labels.push(
    <text key="N" className="label" x={BUS_X - 8} y={PHASE_Y.a - 12} textAnchor="middle">
      N
    </text>,
  )
  if (!half) labels.push(<text key="Nfloat" className="tiny" x={BUS_X - 30} y={PHASE_Y.c + 22}>neutral floats</text>)

  // ── Rectifier ───────────────────────────────────────────────────────────────────
  const deviceTag = (id: string, tx: number, ty: number, anchor: 'start' | 'end' = 'end') => {
    return (
      <g key={`tag${id}`}>
        <text className="label label--device" x={tx} y={ty} textAnchor={anchor}>
          {name(id)}
        </text>
        {/* the device's live reading is in the row under the circuit (Engineer): readable at every width */}
        {p.faults.diode?.id === id && (
          <text className="fault-tag" x={tx} y={ty - 14} textAnchor={anchor}>
            {p.faults.diode.kind === 'open' ? '✕ open' : '⚡ short'}
          </text>
        )}
      </g>
    )
  }

  if (half) {
    const BUS = 380
    for (const q of PHASES) {
      const y = PHASE_Y[q]
      const e = diodeEnds(330, y, 0, 16)
      parts.push(<path key={`pl${q}`} className={`wire phase-wire phase-wire--${q} ${active(iUp(q))}`} d={`M${SRC_X + 20},${y} H${e.anode.x} M${e.cathode.x},${y} H${BUS}`} />)
      parts.push(
        <g key={`d${q}`}>
          <DiodeSym x={330} y={y} angle={0} size={16} state={stateOf(up[q])} label="" part={up[q]} />
          {upperScr && <GateLead x={330} y={y} angle={0} on={gateOf(up[q])} />}
        </g>,
      )
      flows.push({ key: `pl${q}`, d: `M${SRC_X + 20},${y} H${BUS}`, current: iUp(q) })
      // name and reading above the phase wire, left of the diode (over the diode they hid its symbol)
      labels.push(deviceTag(up[q], 310, y - 18, 'end'))
    }
    parts.push(<path key="cbus" className={`wire ${active(irect)}`} d={`M${BUS},${PHASE_Y.c} V${YT} H${EX}`} />)
    flows.push({ key: 'cb1', d: `M${BUS},${PHASE_Y.c} V${PHASE_Y.b}`, current: iUp('c') })
    flows.push({ key: 'cb2', d: `M${BUS},${PHASE_Y.b} V${PHASE_Y.a}`, current: iUp('c') + iUp('b') })
    flows.push({ key: 'cb3', d: `M${BUS},${PHASE_Y.a} V${YT} H${EX}`, current: irect })
    for (const q of PHASES) parts.push(<circle key={`cj${q}`} className="junction" cx={BUS} cy={PHASE_Y[q]} r={3.5} />)
    // Return: − rail back to the neutral.
    parts.push(<path key="ret" className={`wire ${active(io)}`} d={`M${nLeft},${YB} H${BUS_X} V${PHASE_Y.c}`} />)
    flows.push({ key: 'ret', d: `M${nLeft},${YB} H${BUS_X} V${PHASE_Y.c}`, current: io })
  } else {
    for (const q of PHASES) {
      const lx = LEG_X[q]
      const y = PHASE_Y[q]
      // Phase line to its leg's midpoint, hopping over the legs it crosses.
      const crosses = PHASES.filter((r) => LEG_X[r] < lx).map((r) => LEG_X[r])
      parts.push(<path key={`pl${q}`} className={`wire phase-wire phase-wire--${q} ${active(iPhase(q))}`} d={hopH(y, SRC_X + 20, lx, crosses)} />)
      parts.push(<circle key={`mj${q}`} className="junction" cx={lx} cy={y} r={3.5} />)
      flows.push({ key: `pl${q}`, d: hopH(y, SRC_X + 20, lx, crosses), current: iPhase(q) })
      // Leg: upper device (anode at the midpoint side, cathode to +), lower device (anode at −).
      const eu = diodeEnds(lx, UPPER_Y, -90, 16)
      const el = diodeEnds(lx, LOWER_Y, -90, 16)
      parts.push(<path key={`lu${q}`} className={`wire ${active(iUp(q))}`} d={`M${lx},${YT} V${eu.cathode.y} M${lx},${eu.anode.y} V${y}`} />)
      parts.push(<path key={`ll${q}`} className={`wire ${active(iLo(q))}`} d={`M${lx},${y} V${el.cathode.y} M${lx},${el.anode.y} V${YB}`} />)
      parts.push(
        <g key={`du${q}`}>
          <DiodeSym x={lx} y={UPPER_Y} angle={-90} size={16} state={stateOf(up[q])} label="" part={up[q]} />
          {upperScr && <GateLead x={lx} y={UPPER_Y} angle={-90} on={gateOf(up[q])} />}
        </g>,
      )
      parts.push(
        <g key={`dl${q}`}>
          <DiodeSym x={lx} y={LOWER_Y} angle={-90} size={16} state={stateOf(lo[q])} label="" part={lo[q]} />
          {lowerScr && <GateLead x={lx} y={LOWER_Y} angle={-90} on={gateOf(lo[q])} />}
        </g>,
      )
      flows.push({ key: `fu${q}`, d: `M${lx},${y} V${YT}`, current: iUp(q) })
      flows.push({ key: `fl${q}`, d: `M${lx},${YB} V${y}`, current: iLo(q) })
      labels.push(deviceTag(up[q], lx - 22, UPPER_Y - 2), deviceTag(lo[q], lx - 22, LOWER_Y - 2))
    }
    // Rails: currents add up leg by leg.
    parts.push(<path key="prail" className={`wire ${active(irect)}`} d={`M${LEG_X.a},${YT} H${EX}`} />)
    parts.push(<path key="nrail" className={`wire ${active(irect)}`} d={`M${nLeft},${YB} H${LEG_X.a}`} />)
    flows.push({ key: 'p1', d: `M${LEG_X.a},${YT} H${LEG_X.b}`, current: iUp('a') })
    flows.push({ key: 'p2', d: `M${LEG_X.b},${YT} H${LEG_X.c}`, current: iUp('a') + iUp('b') })
    flows.push({ key: 'p3', d: `M${LEG_X.c},${YT} H${EX}`, current: irect })
    flows.push({ key: 'n3', d: `M${nLeft},${YB} H${LEG_X.c}`, current: iLo('a') + iLo('b') + iLo('c') })
    flows.push({ key: 'n2', d: `M${LEG_X.c},${YB} H${LEG_X.b}`, current: iLo('a') + iLo('b') })
    flows.push({ key: 'n1', d: `M${LEG_X.b},${YB} H${LEG_X.a}`, current: iLo('a') })
    for (const q of PHASES) {
      parts.push(<circle key={`pj${q}`} className="junction" cx={LEG_X[q]} cy={YT} r={3.5} />)
      parts.push(<circle key={`nj2${q}`} className="junction" cx={LEG_X[q]} cy={YB} r={3.5} />)
    }
    labels.push(
      <text key="plus" className="polarity" x={LEG_X.a - 22} y={YT + 5}>
        +
      </text>,
      <text key="minus" className="polarity" x={LEG_X.a - 22} y={YB + 5}>
        −
      </text>,
    )
  }

  // Freewheeling diode across the load (cathode to +).
  if (p.control.freewheel) {
    const e = diodeEnds(FW_X, 180, -90, 16)
    parts.push(<path key="fw" className={`wire ${active(iOf('Dfw'))}`} d={`M${FW_X},${YT} V${e.cathode.y} M${FW_X},${e.anode.y} V${YB}`} />)
    parts.push(<DiodeSym key="Dfw" x={FW_X} y={180} angle={-90} size={16} state={stateOf('Dfw')} label="" part="Dfw" />)
    parts.push(<circle key="fwj1" className="junction" cx={FW_X} cy={YT} r={3.5} />, <circle key="fwj2" className="junction" cx={FW_X} cy={YB} r={3.5} />)
    flows.push({ key: 'fw', d: `M${FW_X},${YB} V${YT}`, current: iOf('Dfw') })
    labels.push(deviceTag('Dfw', FW_X - 22, 180))
  }

  labels.push(
    <text key="sub" className="sub" x={SRC_X} y={YB + 44} textAnchor="middle">
      {formatSI(p.vrms, 'V')} rms per phase · {p.frequency} Hz · {p.threePhase.sequence}
    </text>,
  )
  if (!idle && result) {
    const on = sample!.diodes.filter((d) => d.on).map((d) => name(d.id))
    labels.push(
      <text key="pair" className="value value--small" x={half ? 330 : LEG_X.b} y={YB + 44} textAnchor="middle">
        {on.length ? `${on.join(' + ')} conducting` : 'no device conducting'}
      </text>,
    )
  }

  const refs = useFlowAnimation(flows, scale.i)
  const visible = (f: Flow) => !idle && Math.abs(f.current) > scale.i * 1e-4
  const state = idle ? 'idle' : sample!.diodes.some((d) => d.on) ? 'on' : 'off'
  return (
    <svg
      className={`circuit circuit--${state} circuit--3ph ${lens ? `lens lens--${lens}` : ''}`}
      viewBox="-70 0 960 380"
      role="img"
      aria-label={
        idle
          ? `${p.topology} three-phase rectifier with ${p.load} load.`
          : `Three-phase rectifier. VaN ${formatV(phaseValue.a)}, VbN ${formatV(phaseValue.b)}, VcN ${formatV(phaseValue.c)}. Conducting: ${sample!.diodes.filter((d) => d.on).map((d) => name(d.id)).join(', ') || 'none'}. Vo ${formatV(x.vout ?? 0)}.`
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
      <g className="rect-block">{parts}</g>
      <g className="load-block">{loadParts}</g>
      <g className="flows">{flows.map((f) => (visible(f) ? <path key={`f-${f.key}`} ref={refs(f.key)} className="flow" d={f.d} /> : null))}</g>
      <g className="labels">{labels}</g>
    </svg>
  )
}
