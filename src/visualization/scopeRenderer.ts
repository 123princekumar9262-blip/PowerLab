import type { SignalId, SimulationResult } from '../types/simulation.ts'
import { formatSI } from '../utils/format.ts'
import type { EventGroup } from './eventGroups.ts'
import { axisPrefix, niceTicks, tickLabel } from './scales.ts'
import { lanesFor, metaFor, SIGNAL_CSS_VARS, SIGNAL_META, type ScopeLayoutMode, type Unit } from './signals.ts'

/**
 * Canvas rendering of the oscilloscope. Pure drawing: it reads the simulation
 * trace and never computes physics. Two layers:
 *   base    — grid, conduction shading, traces, axes (redrawn on data/view change)
 *   overlay — event markers, cursor, readouts       (redrawn on cursor/hover change)
 *
 * Layouts: 'grouped' (one lane per physical quantity), 'separate' (one lane per signal),
 * 'overlay' (every trace on one screen, like an oscilloscope: each unit keeps its own
 * scale — the first on the left axis, the second on the right — and all zero lines align).
 */

export interface Viewport {
  t0: number
  t1: number
}

export interface ScopeColors {
  surface: string
  laneBg: string
  grid: string
  gridStrong: string
  zero: string
  text1: string
  text2: string
  text3: string
  conduction: string
  conduction2: string
  conductionFw: string
  cursor: string
  marker: string
  markerDiode: string
  /** Resolved colour of every signal CSS variable (signals pick theirs per topology). */
  vars: Record<string, string>
}

/** Value → pixel mapping for one unit inside a lane. */
export interface UnitAxis {
  unit: Unit
  yMin: number
  yMax: number
  scale: number
  prefix: string
}

export interface LaneLayout {
  id: string
  title: string
  signals: SignalId[]
  top: number
  height: number
  axes: UnitAxis[]
}

export interface ScopeLayout {
  width: number
  height: number
  plotLeft: number
  plotRight: number
  eventRowTop: number
  eventRowBottom: number
  lanes: LaneLayout[]
  lanesTop: number
  lanesBottom: number
  axisTop: number
  mode: ScopeLayoutMode
}

const M = { left: 58, right: 14, rightAxis: 56, top: 4, eventRow: 24, laneGap: 6, laneTitle: 18, axis: 30 }

export function readColors(el: Element): ScopeColors {
  const cs = getComputedStyle(el)
  const v = (name: string) => cs.getPropertyValue(name).trim() || '#888'
  const vars = Object.fromEntries(SIGNAL_CSS_VARS.map((name) => [name, v(name)]))
  return {
    surface: v('--scope-bg'),
    laneBg: v('--scope-lane'),
    grid: v('--scope-grid'),
    gridStrong: v('--scope-grid-strong'),
    zero: v('--scope-zero'),
    text1: v('--text-1'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    conduction: v('--scope-conduction'),
    conduction2: v('--scope-conduction-2'),
    conductionFw: v('--scope-conduction-fw'),
    cursor: v('--scope-cursor'),
    marker: v('--text-3'),
    markerDiode: v('--text-1'),
    vars,
  }
}

/** Data range of a set of signals over the whole run (fixed, so panning never rescales). */
function rangeOf(result: SimulationResult, signals: SignalId[]): { lo: number; hi: number } {
  let lo = 0
  let hi = 0
  for (const s of signals) {
    const arr = result.trace.signals[s]
    if (!arr) continue
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < lo) lo = arr[i]
      if (arr[i] > hi) hi = arr[i]
    }
  }
  return { lo, hi }
}

/** Lay out lanes for the visible signals in the chosen mode. */
export function computeLayout(width: number, height: number, result: SimulationResult, visible: SignalId[], mode: ScopeLayoutMode): ScopeLayout {
  const specs = lanesFor(visible, mode, result.params.topology)
  const units = (sigs: SignalId[]) => [...new Set(sigs.map((s) => SIGNAL_META[s].unit))]
  const twoAxes = mode === 'overlay' && specs.length > 0 && units(specs[0].signals).length > 1
  const eventRowTop = M.top
  const eventRowBottom = eventRowTop + M.eventRow
  const lanesTop = eventRowBottom
  const axisTop = height - M.axis
  const avail = Math.max(40, axisTop - lanesTop - M.laneGap * Math.max(0, specs.length - 1))
  const laneH = specs.length ? avail / specs.length : avail

  const lanes: LaneLayout[] = specs.map((spec, k) => {
    // Per-unit data ranges; every unit's zero is placed at the same height (aligned zeros).
    const ranges = units(spec.signals).map((u) => {
      const r = rangeOf(result, spec.signals.filter((s) => SIGNAL_META[s].unit === u))
      return { u, ...r, flat: r.hi - r.lo < 1e-15 }
    })
    // Fraction of the lane height below zero: the largest any unit needs.
    let z = 0
    for (const r of ranges) if (!r.flat) z = Math.max(z, -r.lo / (r.hi - r.lo))
    z = Math.min(0.9, z)
    const axes: UnitAxis[] = ranges.map((r) => {
      // Units per lane height, so this unit fits with its zero at height z.
      let span = r.flat ? (r.u === 'V' ? 2 : 2e-3) : Math.max(r.hi / (1 - z), z > 0 ? -r.lo / z : 0)
      span *= 1.16 // headroom
      const { scale, prefix } = axisPrefix(Math.max(span * (1 - z), span * z))
      return { unit: r.u, yMin: -z * span, yMax: (1 - z) * span, scale, prefix }
    })
    const bandTop = lanesTop + k * (laneH + M.laneGap)
    return { id: spec.id, title: spec.title, signals: spec.signals, top: bandTop + M.laneTitle, height: laneH - M.laneTitle, axes }
  })

  return {
    width,
    height,
    plotLeft: M.left,
    plotRight: width - (twoAxes ? M.rightAxis : M.right),
    eventRowTop,
    eventRowBottom,
    lanes,
    lanesTop,
    lanesBottom: axisTop,
    axisTop,
    mode,
  }
}

export const timeToX = (L: ScopeLayout, vp: Viewport, t: number) => L.plotLeft + ((t - vp.t0) / (vp.t1 - vp.t0)) * (L.plotRight - L.plotLeft)
export const xToTime = (L: ScopeLayout, vp: Viewport, x: number) => vp.t0 + ((x - L.plotLeft) / (L.plotRight - L.plotLeft)) * (vp.t1 - vp.t0)
const axisFor = (lane: LaneLayout, s: SignalId) => lane.axes.find((a) => a.unit === SIGNAL_META[s].unit) ?? lane.axes[0]
const valueToY = (lane: LaneLayout, ax: UnitAxis, v: number) => lane.top + lane.height - ((v - ax.yMin) / (ax.yMax - ax.yMin)) * lane.height

/** Time-axis unit chosen from the visible span. */
export function timeUnit(span: number): { scale: number; label: string } {
  if (span >= 2) return { scale: 1, label: 's' }
  if (span >= 2e-3) return { scale: 1e-3, label: 'ms' }
  return { scale: 1e-6, label: 'µs' }
}

const FONT = '11px "Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace'
const FONT_UI = '600 11px "Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif'

export function drawBase(ctx: CanvasRenderingContext2D, L: ScopeLayout, result: SimulationResult, vp: Viewport, colors: ScopeColors, showConduction: boolean) {
  const { trace } = result
  const n = trace.length
  const dt = result.params.dt
  ctx.clearRect(0, 0, L.width, L.height)
  ctx.fillStyle = colors.surface
  ctx.fillRect(0, 0, L.width, L.height)

  const plotW = L.plotRight - L.plotLeft
  const i0 = Math.max(0, Math.floor(vp.t0 / dt) - 1)
  const i1 = Math.min(n - 1, Math.ceil(vp.t1 / dt) + 1)
  const tu = timeUnit(vp.t1 - vp.t0)
  const tTicks = niceTicks(vp.t0 / tu.scale, vp.t1 / tu.scale, Math.max(2, Math.floor(plotW / 90)))
  const tStep = tTicks.length > 1 ? tTicks[1] - tTicks[0] : 1

  for (const lane of L.lanes) {
    ctx.fillStyle = colors.laneBg
    ctx.fillRect(L.plotLeft, lane.top, plotW, lane.height)

    // Conduction shading: D1 (and D2 for full-wave, or the freewheeling diode) ON intervals,
    // shared by every lane — the operating intervals of the circuit at a glance.
    if (showConduction) {
      trace.diodes.slice(0, 2).forEach((d, j) => {
        ctx.fillStyle = d.id === 'Dfw' ? colors.conductionFw : j === 0 ? colors.conduction : colors.conduction2
        let runStart = -1
        for (let i = i0; i <= i1 + 1; i++) {
          const isOn = i <= i1 && d.on[i] === 1
          if (isOn && runStart < 0) runStart = i
          if (!isOn && runStart >= 0) {
            const xa = Math.max(L.plotLeft, timeToX(L, vp, trace.time[runStart]))
            const xb = Math.min(L.plotRight, timeToX(L, vp, trace.time[i - 1]))
            if (xb > xa) ctx.fillRect(xa, lane.top, xb - xa, lane.height)
            runStart = -1
          }
        }
      })
    }

    // Vertical (time) grid
    ctx.strokeStyle = colors.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const tk of tTicks) {
      const x = Math.round(timeToX(L, vp, tk * tu.scale)) + 0.5
      ctx.moveTo(x, lane.top)
      ctx.lineTo(x, lane.top + lane.height)
    }
    ctx.stroke()

    // Horizontal grid from the first unit; tick labels on the left (1st unit) and right (2nd unit).
    ctx.font = FONT
    ctx.textBaseline = 'middle'
    lane.axes.slice(0, 2).forEach((ax, a) => {
      const yTicks = niceTicks(ax.yMin / ax.scale, ax.yMax / ax.scale, Math.max(3, Math.floor(lane.height / 26)))
      const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1
      ctx.textAlign = a === 0 ? 'right' : 'left'
      for (const yk of yTicks) {
        const y = Math.round(valueToY(lane, ax, yk * ax.scale)) + 0.5
        if (y < lane.top + 6 || y > lane.top + lane.height - 4) continue
        if (a === 0) {
          ctx.strokeStyle = yk === 0 ? colors.zero : colors.grid
          ctx.lineWidth = yk === 0 ? 1.25 : 1
          ctx.beginPath()
          ctx.moveTo(L.plotLeft, y)
          ctx.lineTo(L.plotRight, y)
          ctx.stroke()
        }
        ctx.fillStyle = yk === 0 ? colors.text2 : colors.text3
        ctx.fillText(tickLabel(yk, yStep), a === 0 ? L.plotLeft - 8 : L.plotRight + 8, y)
      }
    })

    // Traces
    ctx.save()
    ctx.beginPath()
    ctx.rect(L.plotLeft, lane.top, plotW, lane.height)
    ctx.clip()
    for (const sid of lane.signals) {
      const arr = trace.signals[sid]
      if (!arr) continue
      const ax = axisFor(lane, sid)
      const meta = metaFor(sid, result.params.topology)
      ctx.strokeStyle = colors.vars[meta.cssVar]
      ctx.lineWidth = sid === 'vout' && result.params.topology.startsWith('3ph') ? 2.5 : 2
      ctx.lineJoin = 'round'
      ctx.setLineDash(meta.dash ?? (meta.dashed ? [6, 5] : []))
      drawTrace(ctx, trace.time, arr, i0, i1, (t) => timeToX(L, vp, t), (v) => valueToY(lane, ax, v), plotW)
    }
    ctx.setLineDash([])
    ctx.restore()

    // Lane title in its band above the plot, in text ink — identity comes from the legend chips.
    ctx.font = FONT_UI
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = colors.text2
    const units = lane.axes.map((ax, k) => `${ax.prefix}${ax.unit}${lane.axes.length > 1 && k < 2 ? (k === 0 ? ' ← left' : ' → right') : ''}`).join(' · ')
    ctx.fillText(`${L.mode === 'overlay' ? 'All channels' : lane.title}  [${units}]`, L.plotLeft + 1, lane.top - 4)

    ctx.strokeStyle = colors.gridStrong
    ctx.lineWidth = 1
    ctx.strokeRect(L.plotLeft + 0.5, lane.top + 0.5, plotW - 1, lane.height - 1)
  }

  // Time axis
  ctx.font = FONT
  ctx.fillStyle = colors.text3
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const tk of tTicks) {
    const x = timeToX(L, vp, tk * tu.scale)
    if (x < L.plotLeft - 1 || x > L.plotRight + 1) continue
    ctx.fillText(tickLabel(tk, tStep), x, L.axisTop + 8)
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.text2
  ctx.fillText(`t [${tu.label}]`, L.plotLeft - 8, L.axisTop + 8)
}

/**
 * Draw samples i0..i1. When there are more samples than pixels, draw a min/max
 * envelope per pixel column — the rendering is decimated, the data is not.
 */
function drawTrace(ctx: CanvasRenderingContext2D, time: Float64Array, y: Float64Array, i0: number, i1: number, xOf: (t: number) => number, yOf: (v: number) => number, plotW: number) {
  const count = i1 - i0 + 1
  ctx.beginPath()
  if (count <= plotW * 2) {
    ctx.moveTo(xOf(time[i0]), yOf(y[i0]))
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(xOf(time[i]), yOf(y[i]))
  } else {
    const cols = Math.ceil(plotW)
    let first = true
    for (let c = 0; c < cols; c++) {
      const a = i0 + Math.floor((c * count) / cols)
      const b = Math.min(i1, i0 + Math.floor(((c + 1) * count) / cols) - 1)
      if (b < a) continue
      let lo = y[a]
      let hi = y[a]
      for (let i = a + 1; i <= b; i++) {
        if (y[i] < lo) lo = y[i]
        if (y[i] > hi) hi = y[i]
      }
      const x = xOf(time[a])
      if (first) {
        ctx.moveTo(x, yOf(y[a]))
        first = false
      } else ctx.lineTo(x, yOf(y[a]))
      ctx.lineTo(x, yOf(lo))
      ctx.lineTo(x, yOf(hi))
      ctx.lineTo(x, yOf(y[b]))
    }
  }
  ctx.stroke()
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  L: ScopeLayout,
  result: SimulationResult,
  vp: Viewport,
  colors: ScopeColors,
  cursorIndex: number,
  groups: EventGroup[],
  selectedGroupId: string | null,
  hoverGroupId: string | null,
) {
  ctx.clearRect(0, 0, L.width, L.height)
  const { trace } = result

  // Event markers (top row). Diode events: filled diamond; output crests/valleys: hollow
  // diamond; source events: hollow circle.
  const rowMid = (L.eventRowTop + L.eventRowBottom) / 2
  for (const g of groups) {
    const x = timeToX(L, vp, g.time)
    if (x < L.plotLeft - 6 || x > L.plotRight + 6) continue
    const active = g.id === selectedGroupId || g.id === hoverGroupId
    const r = active ? 6 : 4.5
    ctx.lineWidth = 1.5
    const diamond = () => {
      ctx.beginPath()
      ctx.moveTo(x, rowMid - r)
      ctx.lineTo(x + r, rowMid)
      ctx.lineTo(x, rowMid + r)
      ctx.lineTo(x - r, rowMid)
      ctx.closePath()
    }
    if (g.category === 'diode') {
      ctx.fillStyle = active ? colors.cursor : colors.markerDiode
      diamond()
      ctx.fill()
    } else if (g.category === 'output') {
      ctx.strokeStyle = active ? colors.cursor : colors.marker
      diamond()
      ctx.stroke()
    } else {
      ctx.strokeStyle = active ? colors.cursor : colors.marker
      ctx.beginPath()
      ctx.arc(x, rowMid, r - 0.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (g.id === selectedGroupId) {
      ctx.strokeStyle = colors.cursor
      ctx.globalAlpha = 0.5
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, L.lanesTop)
      ctx.lineTo(Math.round(x) + 0.5, L.lanesBottom)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }

  // Cursor: one vertical line through every lane — the same instant everywhere.
  const t = trace.time[cursorIndex]
  const x = timeToX(L, vp, t)
  if (x < L.plotLeft - 0.5 || x > L.plotRight + 0.5) return
  const xr = Math.round(x) + 0.5
  ctx.strokeStyle = colors.cursor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(xr, L.eventRowBottom - 4)
  ctx.lineTo(xr, L.lanesBottom)
  ctx.stroke()
  ctx.fillStyle = colors.cursor
  ctx.beginPath()
  ctx.moveTo(xr - 5, L.eventRowBottom - 9)
  ctx.lineTo(xr + 5, L.eventRowBottom - 9)
  ctx.lineTo(xr, L.eventRowBottom - 3)
  ctx.closePath()
  ctx.fill()

  // Time label on the axis
  const tu = timeUnit(vp.t1 - vp.t0)
  const label = `${(t / tu.scale).toFixed(tu.label === 'µs' ? 1 : 3)} ${tu.label}`
  ctx.font = FONT
  const lw = ctx.measureText(label).width + 12
  const lx = Math.min(L.plotRight - lw, Math.max(L.plotLeft, xr - lw / 2))
  ctx.fillStyle = colors.cursor
  ctx.beginPath()
  ctx.roundRect(lx, L.axisTop + 4, lw, 19, 4)
  ctx.fill()
  ctx.fillStyle = colors.surface
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(label, lx + 6, L.axisTop + 8)

  // Value dots and readouts per lane
  const flip = x > L.plotLeft + (L.plotRight - L.plotLeft) * 0.62
  for (const lane of L.lanes) {
    const rows: Array<{ sid: SignalId; text: string }> = []
    for (const sid of lane.signals) {
      const arr = trace.signals[sid]
      if (!arr) continue
      const v = arr[cursorIndex]
      const y = valueToY(lane, axisFor(lane, sid), v)
      ctx.fillStyle = colors.surface
      ctx.beginPath()
      ctx.arc(xr, y, 5.5, 0, Math.PI * 2)
      ctx.fill()
      const meta = metaFor(sid, result.params.topology)
      ctx.fillStyle = colors.vars[meta.cssVar]
      ctx.beginPath()
      ctx.arc(xr, y, 3.75, 0, Math.PI * 2)
      ctx.fill()
      rows.push({ sid, text: `${meta.label} ${formatSI(v, meta.unit, { signed: true })}` })
    }
    if (!rows.length) continue
    ctx.font = FONT
    const w = Math.max(...rows.map((r) => ctx.measureText(r.text).width)) + 26
    const h = rows.length * 16 + 8
    const bx = flip ? xr - 10 - w : xr + 10
    const by = Math.max(lane.top + 4, lane.top + lane.height - h - 6)
    ctx.fillStyle = colors.surface
    ctx.globalAlpha = 0.92
    ctx.beginPath()
    ctx.roundRect(bx, by, w, h, 5)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = colors.gridStrong
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(bx + 0.5, by + 0.5, w - 1, h - 1, 5)
    ctx.stroke()
    rows.forEach((r, k) => {
      const ry = by + 6 + k * 16
      ctx.fillStyle = colors.vars[metaFor(r.sid, result.params.topology).cssVar]
      ctx.fillRect(bx + 8, ry + 3, 8, 8)
      ctx.fillStyle = colors.text1
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillText(r.text, bx + 21, ry + 1)
    })
  }
}
