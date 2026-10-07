/**
 * SVG schematic symbols. Pure drawing — the state passed in comes from the simulation.
 */

export type DeviceState = 'on' | 'off' | 'idle'

/** Diode centered at (x, y), pointing from anode to cathode along `angle` degrees. */
export function DiodeSym(props: { x: number; y: number; angle: number; state: DeviceState; label: string; labelDx?: number; labelDy?: number; size?: number }) {
  const { x, y, angle, state, label, labelDx = 0, labelDy = -26, size = 20 } = props
  return (
    <g className={`diode diode--${state}`}>
      <g transform={`translate(${x} ${y}) rotate(${angle})`}>
        <rect className="diode-hit" x={-size - 8} y={-size - 6} width={2 * size + 16} height={2 * size + 12} rx={8} />
        <path className="diode-body" d={`M${-size},${-size} L${-size},${size} L${size},0 Z`} />
        <path className="diode-bar" d={`M${size},${-size} V${size}`} />
      </g>
      <text className="label label--device" x={x + labelDx} y={y + labelDy} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

/** Endpoints of a diode drawn with DiodeSym (anode, cathode). */
export function diodeEnds(x: number, y: number, angle: number, size = 20) {
  const a = (angle * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { anode: { x: x - size * c, y: y - size * s }, cathode: { x: x + size * c, y: y + size * s } }
}

export function SourceSym(props: { cx: number; cy: number; r: number }) {
  const { cx, cy, r } = props
  const w = r * 0.55
  return (
    <g className="source">
      <circle cx={cx} cy={cy} r={r} />
      <path d={`M${cx - w},${cy} q${w / 2},${-w * 1.1} ${w},0 t${w},0`} />
    </g>
  )
}

/** Vertical zig-zag resistor from y0 to y1. Returns its path (also used as the flow path). */
export function resistorPath(x: number, y0: number, y1: number, amp = 11, segments = 8): string {
  const lead = 8
  const step = (y1 - y0 - 2 * lead) / segments
  let d = `M${x},${y0} V${y0 + lead}`
  for (let k = 0; k < segments; k++) d += ` L${x + (k % 2 === 0 ? amp : -amp)},${y0 + lead + step * (k + 0.5)}`
  return `${d} L${x},${y1 - lead} V${y1}`
}

/** Vertical inductor (coil of half-circles) from y0 to y1. */
export function inductorPath(x: number, y0: number, y1: number, turns = 4): string {
  const lead = 6
  const h = (y1 - y0 - 2 * lead) / turns
  let d = `M${x},${y0} V${y0 + lead}`
  for (let k = 0; k < turns; k++) d += ` a${h / 2},${h / 2} 0 0 1 0,${h}`
  return `${d} V${y1}`
}

/** Vertical capacitor centered between y0 and y1 (two plates). */
export function CapacitorSym(props: { x: number; y0: number; y1: number; fill: number }) {
  const { x, y0, y1, fill } = props
  const mid = (y0 + y1) / 2
  const w = 22
  return (
    <g className="capacitor">
      <path className="wire" d={`M${x},${y0} V${mid - 5} M${x},${mid + 5} V${y1}`} />
      {/* Charge fill: opacity ∝ stored energy fraction (visual only). */}
      <rect className="cap-charge" x={x - w} y={mid - 5} width={2 * w} height={10} opacity={Math.max(0, Math.min(1, fill))} />
      <path className="cap-plate" d={`M${x - w},${mid - 5} H${x + w} M${x - w},${mid + 5} H${x + w}`} />
    </g>
  )
}

/** A wire hop (crossing without a connection): vertical wire bulging around a horizontal one at y. */
export function hopV(x: number, yFrom: number, yHop: number, yTo: number): string {
  const r = 7
  const dir = yTo > yFrom ? 1 : -1
  return `M${x},${yFrom} V${yHop - dir * r} a${r},${r} 0 0 ${dir > 0 ? 1 : 0} 0,${2 * dir * r} V${yTo}`
}
