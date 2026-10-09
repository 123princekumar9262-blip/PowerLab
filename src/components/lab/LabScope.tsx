import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Run, RunEvent } from '../../converters/types.ts'
import type { ChannelMeta } from '../../lab/types.ts'
import { axisPrefix, niceTicks, tickLabel } from '../../visualization/scales.ts'
import { formatSI, formatTime } from '../../utils/format.ts'

export interface Viewport {
  t0: number
  t1: number
}

interface Props {
  result: Run
  channels: string[]
  /** Channel metadata (label, colour, unit, group). */
  meta: Record<string, ChannelMeta>
  /** Colour of the conduction band for the interval ending at sample k (null = none). */
  shade?: (r: Run, k: number) => string | null
  shadeLegend?: string
  eventLabel: (e: RunEvent) => string
  eventColor?: (e: RunEvent) => string
  /** 'period' or 'cycle' (the steady-state period's name). */
  periodName: string
  layout: 'separate' | 'grouped'
  viewport: Viewport
  onViewport: (v: Viewport) => void
  cursorIndex: number
  onCursorTime: (t: number) => void
  /** Shade the conduction intervals (when the topic defines them). */
  shading: boolean
  /** 'zero': every analog lane includes 0 V / 0 A (true proportions); 'fit': zoom to the waveform (see the ripple). */
  yMode: 'zero' | 'fit'
  selectedEventId: string | null
  onSelectEvent: (e: RunEvent) => void
  toolbar?: React.ReactNode
}

interface Lane {
  id: string
  title: string
  signals: string[]
  top: number
  bottom: number
  min: number
  max: number
}

const LEFT = 64
const RIGHT = 54
const EVENT_ROW = 16
const AXIS_H = 22
/** Room above each lane for its name and unit ("Speed [rpm]", "Output voltage [V]"). */
const TITLE_H = 16

/** A channel's unit: its SI unit, else the one its name carries in brackets ("Speed [rpm]" → rpm). */
const unitOf = (m: ChannelMeta) => m.unit || (/\[([^\]]+)\]\s*$/.exec(m.name)?.[1] ?? '')
/** A lane's title with its unit, unless the name already ends with one. */
function laneTitle(title: string, signals: string[], meta: Record<string, ChannelMeta>): string {
  if (/\]\s*$/.test(title)) return title
  const units = [...new Set(signals.map((s) => unitOf(meta[s])))].filter(Boolean)
  return units.length ? `${title} [${units.join(', ')}]` : title
}

function lanesOf(channels: string[], layout: Props['layout'], meta: Record<string, ChannelMeta>): Array<{ id: string; title: string; signals: string[] }> {
  if (layout === 'separate') return channels.map((c) => ({ id: c, title: meta[c].name, signals: [c] }))
  // One lane per quantity group, in the order the groups first appear in the metadata.
  const groups: string[] = []
  for (const m of Object.values(meta)) if (!groups.includes(m.group)) groups.push(m.group)
  return groups.map((g) => ({ id: g, title: g, signals: channels.filter((c) => meta[c].group === g) })).filter((l) => l.signals.length)
}

/** Oscilloscope for any run: one lane per channel (or per quantity), shared time axis and cursor. */
export function LabScope(props: Props) {
  const { result, channels, layout, viewport, cursorIndex, shading, meta } = props
  const CHANNELS = meta
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const overRef = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<{ e: RunEvent; x: number } | null>(null)
  const drag = useRef<{ mode: 'cursor' | 'pan'; x: number; vp: Viewport } | null>(null)
  const p = result.params

  const laneDefs = useMemo(() => lanesOf(channels, layout, meta), [channels, layout, meta])
  const laneH = (l: { signals: string[] }) => (l.signals.length === 1 && CHANNELS[l.signals[0]].logic ? 46 : layout === 'separate' ? 92 : 132)
  const height = EVENT_ROW + 8 + laneDefs.reduce((s, l) => s + TITLE_H + laneH(l) + 8, 0) + AXIS_H

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Lane geometry and y-ranges (over the visible window, so zooming rescales like a real scope's auto-set).
  const lanes: Lane[] = useMemo(() => {
    const i0 = Math.max(0, Math.floor(viewport.t0 / p.dt) - 1)
    const i1 = Math.min(result.length - 1, Math.ceil(viewport.t1 / p.dt) + 1)
    let y = EVENT_ROW + 8
    return laneDefs.map((l) => {
      let min = Infinity
      let max = -Infinity
      for (const s of l.signals) {
        const a = result.signals[s]
        for (let k = i0; k <= i1; k++) {
          if (a[k] < min) min = a[k]
          if (a[k] > max) max = a[k]
        }
      }
      if (CHANNELS[l.signals[0]].logic) {
        min = 0
        max = 1
      } else {
        if (props.yMode === 'zero') {
          min = Math.min(min, 0)
          max = Math.max(max, 0)
        }
        const span = max - min
        const mag = Math.max(Math.abs(max), Math.abs(min), 1e-9)
        if (span < 1e-6 * mag) {
          min -= 0.5 * mag * 0.01 + 1e-9
          max += 0.5 * mag * 0.01 + 1e-9
        }
        const pad = (max - min) * 0.08
        min -= pad
        max += pad
      }
      const h = laneH(l)
      y += TITLE_H
      const lane = { ...l, top: y, bottom: y + h, min, max }
      y += h + 8
      return lane
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneDefs, result, viewport, layout, props.yMode])

  const tx = (t: number) => LEFT + ((t - viewport.t0) / (viewport.t1 - viewport.t0)) * (w - LEFT - RIGHT)
  const xt = (x: number) => viewport.t0 + ((x - LEFT) / (w - LEFT - RIGHT)) * (viewport.t1 - viewport.t0)
  const ly = (l: Lane, v: number) => l.bottom - ((v - l.min) / (l.max - l.min)) * (l.bottom - l.top)

  const prep = (c: HTMLCanvasElement | null) => {
    if (!c || w <= 0) return null
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(height * dpr)
    c.style.width = `${w}px`
    c.style.height = `${height}px`
    const ctx = c.getContext('2d')
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  // Base layer: lanes, grid, shading, traces.
  useEffect(() => {
    const ctx = prep(baseRef.current)
    if (!ctx) return
    const css = getComputedStyle(wrapRef.current!)
    const col = (v: string, f: string) => css.getPropertyValue(v).trim() || f
    const plotR = w - RIGHT
    ctx.fillStyle = col('--scope-bg', '#0b0f14')
    ctx.fillRect(0, 0, w, height)
    const ticksT = niceTicks(viewport.t0, viewport.t1, Math.max(3, Math.floor((plotR - LEFT) / 110)))
    const tp = axisPrefix(Math.max(Math.abs(viewport.t1), Math.abs(viewport.t0)))
    const i0 = Math.max(0, Math.floor(viewport.t0 / p.dt) - 1)
    const i1 = Math.min(result.length - 1, Math.ceil(viewport.t1 / p.dt) + 1)
    const dense = ((plotR - LEFT) * p.period) / (viewport.t1 - viewport.t0) < 8
    for (const l of lanes) {
      ctx.fillStyle = col('--scope-lane', '#0e131a')
      ctx.fillRect(LEFT, l.top, plotR - LEFT, l.bottom - l.top)
      // Conduction shading from the topic. Sample k holds the interval (k−1, k].
      // Skipped when a switching period is only a few pixels wide (it would only show moiré).
      if (shading && props.shade && dense === false) {
        for (let k = Math.max(1, i0); k <= i1; k++) {
          const on = props.shade(result, k)
          if (!on) continue
          const xa = Math.max(LEFT, tx(result.time[k - 1]))
          const xb = Math.min(plotR, tx(result.time[k]))
          if (xb <= xa) continue
          ctx.fillStyle = on
          ctx.fillRect(xa, l.top, xb - xa + 0.5, l.bottom - l.top)
        }
      }
      // Grid.
      ctx.strokeStyle = col('--scope-grid', '#18202a')
      ctx.lineWidth = 1
      for (const t of ticksT) {
        const x = Math.round(tx(t)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, l.top)
        ctx.lineTo(x, l.bottom)
        ctx.stroke()
      }
      const meta = CHANNELS[l.signals[0]]
      const yt = meta.logic ? [0, 1] : niceTicks(l.min, l.max, Math.max(2, Math.floor((l.bottom - l.top) / 30)))
      // Per-unit lanes (no unit) are labelled in plain numbers, never with an SI prefix.
      const yp = l.signals.every((x) => !CHANNELS[x].unit) ? { scale: 1, prefix: '' } : axisPrefix(Math.max(Math.abs(l.min), Math.abs(l.max)))
      const step = yt.length > 1 ? (yt[1] - yt[0]) / yp.scale : 1
      ctx.font = '11px ' + col('--font-mono', 'monospace')
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const v of yt) {
        const y = Math.round(ly(l, v)) + 0.5
        ctx.strokeStyle = v === 0 ? col('--scope-zero', '#3a4656') : col('--scope-grid', '#18202a')
        ctx.beginPath()
        ctx.moveTo(LEFT, y)
        ctx.lineTo(plotR, y)
        ctx.stroke()
        ctx.fillStyle = col('--text-3', '#8591a3')
        ctx.fillText(meta.logic ? (v ? 'ON' : 'OFF') : tickLabel(v / yp.scale, step), LEFT - 6, y)
      }
      // Lane unit / title.
      ctx.save()
      ctx.translate(12, (l.top + l.bottom) / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.fillStyle = col('--text-3', '#8591a3')
      ctx.font = '10.5px ' + col('--font-ui', 'sans-serif')
      // SI units take the axis prefix (mV, kA); a unit from the name (rpm, °C, %) is shown as it is
      const units = [...new Set(l.signals.map((s) => (CHANNELS[s].unit ? `${yp.prefix}${CHANNELS[s].unit}` : unitOf(CHANNELS[s]))))].filter(Boolean)
      ctx.fillText(meta.logic ? 'gate' : units.join(' · '), 0, 0)
      ctx.restore()
      // Lane title: what the trace is, and its unit.
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = col('--text-2', '#aeb7c5')
      ctx.font = '11.5px ' + col('--font-ui', 'sans-serif')
      ctx.fillText(laneTitle(l.title, l.signals, CHANNELS), LEFT, l.top - 4)
      // Traces: min/max per pixel column (decimation that never hides a spike).
      ctx.save()
      ctx.beginPath()
      ctx.rect(LEFT, l.top, plotR - LEFT, l.bottom - l.top)
      ctx.clip()
      for (const s of l.signals) {
        const m = CHANNELS[s]
        const a = result.signals[s]
        ctx.strokeStyle = m.color
        ctx.lineWidth = 2
        ctx.setLineDash(m.dash ?? [])
        ctx.beginPath()
        const perPx = (i1 - i0) / Math.max(1, plotR - LEFT)
        if (perPx <= 2) {
          for (let k = i0; k <= i1; k++) {
            const x = tx(result.time[k])
            const y = ly(l, a[k])
            if (k === i0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
        } else {
          let first = true
          for (let px = LEFT; px < plotR; px++) {
            const ka = Math.max(i0, Math.floor((xt(px) - 0) / p.dt))
            const kb = Math.min(i1, Math.ceil(xt(px + 1) / p.dt))
            let lo = Infinity
            let hi = -Infinity
            for (let k = ka; k <= kb; k++) {
              lo = Math.min(lo, a[k])
              hi = Math.max(hi, a[k])
            }
            if (!Number.isFinite(lo)) continue
            if (first) ctx.moveTo(px, ly(l, hi))
            else ctx.lineTo(px, ly(l, hi))
            ctx.lineTo(px, ly(l, lo))
            first = false
          }
        }
        ctx.stroke()
      }
      ctx.restore()
      ctx.setLineDash([])
      // Direct labels at the right end of each trace.
      ctx.textAlign = 'left'
      ctx.font = '600 11px ' + col('--font-ui', 'sans-serif')
      const used: number[] = []
      for (const s of l.signals) {
        const a = result.signals[s]
        let y = Math.min(l.bottom - 6, Math.max(l.top + 6, ly(l, a[i1])))
        while (used.some((u) => Math.abs(u - y) < 12)) y += 12
        used.push(y)
        ctx.fillStyle = CHANNELS[s].color
        ctx.fillText(CHANNELS[s].label, plotR + 6, y)
      }
    }
    // Time axis.
    const yAxis = height - AXIS_H + 14
    ctx.fillStyle = col('--text-3', '#8591a3')
    ctx.font = '11px ' + col('--font-mono', 'monospace')
    ctx.textAlign = 'center'
    const tstep = ticksT.length > 1 ? (ticksT[1] - ticksT[0]) / tp.scale : 1
    for (const t of ticksT) ctx.fillText(tickLabel(t / tp.scale, tstep), tx(t), yAxis)
    ctx.textAlign = 'right'
    ctx.fillText(`t [${tp.prefix}s]`, LEFT - 8, yAxis)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, w, height, shading, result, viewport])

  // Overlay: events, cursor, readouts.
  useEffect(() => {
    const ctx = prep(overRef.current)
    if (!ctx) return
    const css = getComputedStyle(wrapRef.current!)
    const col = (v: string, f: string) => css.getPropertyValue(v).trim() || f
    const plotR = w - RIGHT
    // Event markers only while a switching period is wide enough to tell them apart.
    const showEvents = ((plotR - LEFT) * p.period) / (viewport.t1 - viewport.t0) >= 24
    for (const e of showEvents ? result.events : []) {
      if (e.time < viewport.t0 || e.time > viewport.t1) continue
      const x = tx(e.time)
      const sel = e.id === props.selectedEventId
      ctx.fillStyle = props.eventColor?.(e) ?? (e.kind.startsWith('gate') ? '#aeb7c5' : e.kind === 'il-zero' ? col('--warning', '#fab219') : '#008300')
      ctx.beginPath()
      const r = sel ? 6 : 4
      ctx.moveTo(x, 4)
      ctx.lineTo(x + r, 4 + r)
      ctx.lineTo(x, 4 + 2 * r)
      ctx.lineTo(x - r, 4 + r)
      ctx.closePath()
      ctx.fill()
      if (sel) {
        ctx.strokeStyle = 'rgba(242,245,249,0.35)'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, EVENT_ROW + 4)
        ctx.lineTo(x, height - AXIS_H)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    const t = result.time[cursorIndex]
    if (t >= viewport.t0 && t <= viewport.t1) {
      const x = Math.round(tx(t)) + 0.5
      ctx.strokeStyle = col('--scope-cursor', '#f2f5f9')
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, EVENT_ROW + 4)
      ctx.lineTo(x, height - AXIS_H)
      ctx.stroke()
      ctx.font = '600 11px ' + col('--font-mono', 'monospace')
      for (const l of lanes) {
        let yOff = 0
        for (const s of l.signals) {
          const v = result.signals[s][cursorIndex]
          const y = ly(l, v)
          ctx.fillStyle = CHANNELS[s].color
          ctx.beginPath()
          ctx.arc(x, y, 3.5, 0, Math.PI * 2)
          ctx.fill()
          const text = CHANNELS[s].logic ? (v ? 'ON' : 'OFF') : formatSI(v, CHANNELS[s].unit || '')
          const tw = ctx.measureText(text).width + 8
          const bx = x + 8 + tw > plotR ? x - 8 - tw : x + 8
          const by = l.top + 4 + yOff
          ctx.fillStyle = 'rgba(11,15,20,0.85)'
          ctx.fillRect(bx, by, tw, 15)
          ctx.fillStyle = CHANNELS[s].color
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, bx + 4, by + 8)
          yOff += 16
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, w, height, cursorIndex, result, viewport, props.selectedEventId])

  const clamp = (t0: number, t1: number): Viewport => {
    const dur = p.duration
    let span = Math.min(dur, Math.max(p.dt * 10, t1 - t0))
    let a = Math.max(0, t0)
    if (a + span > dur) a = dur - span
    if (a < 0) {
      a = 0
      span = dur
    }
    return { t0: a, t1: a + span }
  }
  const zoom = (f: number, c: number) => {
    const span = (viewport.t1 - viewport.t0) * f
    const frac = (c - viewport.t0) / (viewport.t1 - viewport.t0)
    props.onViewport(clamp(c - frac * span, c - frac * span + span))
  }

  useEffect(() => {
    const el = overRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const x = e.clientX - el.getBoundingClientRect().left
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dt = (e.deltaX / (w - LEFT - RIGHT)) * (viewport.t1 - viewport.t0)
        props.onViewport(clamp(viewport.t0 + dt, viewport.t1 + dt))
      } else zoom(Math.pow(1.0015, e.deltaY), xt(Math.min(w - RIGHT, Math.max(LEFT, x))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const eventNear = (x: number) => {
    if (((w - RIGHT - LEFT) * p.period) / (viewport.t1 - viewport.t0) < 24) return null
    let best: RunEvent | null = null
    let bd = 8
    for (const e of result.events) {
      if (e.time < viewport.t0 || e.time > viewport.t1) continue
      const dd = Math.abs(tx(e.time) - x)
      if (dd < bd) {
        bd = dd
        best = e
      }
    }
    return best
  }
  const lx = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left
  const lyy = (e: React.PointerEvent) => e.clientY - e.currentTarget.getBoundingClientRect().top
  const cursorTo = (x: number) => props.onCursorTime(xt(Math.min(w - RIGHT, Math.max(LEFT, x))))

  const span = viewport.t1 - viewport.t0
  return (
    <div className="cscope">
      <div className="cscope-toolbar">
        {props.toolbar}
        <div className="zoom" role="group" aria-label="Time zoom">
          <span className="zoom-info">{span / p.period >= 0.995 ? `${(span / p.period).toFixed(span / p.period < 10 ? 1 : 0)} ${props.periodName}s` : formatTime(span)}</span>
          <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.5, (viewport.t0 + viewport.t1) / 2)}>
            −
          </button>
          <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1 / 1.5, (viewport.t0 + viewport.t1) / 2)}>
            +
          </button>
          <button
            className="text-btn"
            title={`Show the ${props.periodName} under the cursor`}
            onClick={() => {
              const c = Math.min(Math.floor(result.time[cursorIndex] / p.period), Math.round(p.duration / p.period) - 1)
              props.onViewport(clamp(c * p.period, (c + 1) * p.period))
            }}
          >
            1 {props.periodName}
          </button>
          <button className="text-btn" title="Show the whole run" onClick={() => props.onViewport({ t0: 0, t1: p.duration })}>
            Fit
          </button>
        </div>
      </div>
      <div className="cscope-canvas" ref={wrapRef} style={{ height }}>
        <canvas ref={baseRef} className="scope-layer" aria-hidden="true" />
        <canvas
          ref={overRef}
          className="scope-layer scope-layer--overlay"
          role="img"
          aria-label={`Oscilloscope: ${channels.map((c) => CHANNELS[c].label).join(', ')} on a shared time axis. Drag to move the time cursor.`}
          onPointerDown={(e) => {
            const x = lx(e)
            if (lyy(e) <= EVENT_ROW + 6) {
              const ev = eventNear(x)
              if (ev) {
                props.onSelectEvent(ev)
                return
              }
            }
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { mode: e.shiftKey || e.button === 1 ? 'pan' : 'cursor', x, vp: viewport }
            if (drag.current.mode === 'cursor') cursorTo(x)
          }}
          onPointerMove={(e) => {
            const x = lx(e)
            const d = drag.current
            if (d?.mode === 'cursor') cursorTo(x)
            else if (d?.mode === 'pan') {
              const dt = ((d.x - x) / (w - LEFT - RIGHT)) * (d.vp.t1 - d.vp.t0)
              props.onViewport(clamp(d.vp.t0 + dt, d.vp.t1 + dt))
            } else if (lyy(e) <= EVENT_ROW + 6) {
              const ev = eventNear(x)
              setHover(ev ? { e: ev, x: tx(ev.time) } : null)
            } else if (hover) setHover(null)
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => props.onViewport({ t0: 0, t1: p.duration })}
        />
        {hover && (
          <div className="scope-tip" style={{ left: Math.min(Math.max(hover.x, 90), w - 90), top: EVENT_ROW + 6 }}>
            <div className="scope-tip-time">{formatTime(hover.e.time)}</div>
            <div>{props.eventLabel(hover.e)}</div>
            <div className="scope-tip-hint">Click for what &amp; why</div>
          </div>
        )}
      </div>
      <p className="scope-hint">
        Drag to move the cursor · wheel to zoom · Shift+drag to pan · ◆ markers are switching events{shading && props.shadeLegend ? ` · ${props.shadeLegend}` : ''}
        {span / p.period > 30 ? ' · zoom in to see the switching events and conduction bands' : ''}
      </p>
    </div>
  )
}
