import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SignalId, SimulationResult } from '../types/simulation.ts'
import { eventTitle } from '../explanations/index.ts'
import type { EventGroup } from '../visualization/eventGroups.ts'
import {
  computeLayout,
  drawBase,
  drawOverlay,
  readColors,
  timeToX,
  xToTime,
  type ScopeColors,
  type ScopeLayout,
  type Viewport,
} from '../visualization/scopeRenderer.ts'
import { SIGNAL_META } from '../visualization/signals.ts'
import { formatTime } from '../utils/format.ts'

interface Props {
  result: SimulationResult
  viewport: Viewport
  onViewport: (vp: Viewport | null) => void
  cursorIndex: number
  onCursorTime: (t: number) => void
  onScrubStart: () => void
  visible: Record<SignalId, boolean>
  onToggleSignal: (s: SignalId) => void
  showConduction: boolean
  groups: EventGroup[]
  selectedGroupId: string | null
  onSelectGroup: (g: EventGroup) => void
}

const ZOOM_STEP = 1.5

export function Scope(props: Props) {
  const { result, viewport, onViewport, cursorIndex, visible, showConduction, groups, selectedGroupId } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [colors, setColors] = useState<ScopeColors | null>(null)
  const [hover, setHover] = useState<{ group: EventGroup; x: number } | null>(null)
  const drag = useRef<{ mode: 'cursor' | 'pan'; startX: number; startVp: Viewport } | null>(null)

  // Track container size (canvas is sized in device pixels for crisp lines).
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    setColors(readColors(el))
    return () => ro.disconnect()
  }, [])

  const layout: ScopeLayout | null = useMemo(
    () => (size.w > 0 && size.h > 0 ? computeLayout(size.w, size.h, result, visible) : null),
    [size, result, visible],
  )

  const prepare = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || !layout) return null
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(layout.width * dpr)
    const h = Math.round(layout.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  // Base layer: traces, grid, shading.
  useEffect(() => {
    const ctx = prepare(baseRef.current)
    if (ctx && layout && colors) drawBase(ctx, layout, result, viewport, colors, showConduction)
  }, [layout, result, viewport, colors, showConduction])

  // Overlay layer: cursor, readouts, markers.
  useEffect(() => {
    const ctx = prepare(overlayRef.current)
    if (ctx && layout && colors) drawOverlay(ctx, layout, result, viewport, colors, cursorIndex, groups, selectedGroupId, hover?.group.id ?? null)
  }, [layout, result, viewport, colors, cursorIndex, groups, selectedGroupId, hover])

  const duration = result.params.duration
  const minSpan = Math.max(result.params.dt * 20, result.params.period / 200)

  const clampVp = (t0: number, t1: number): Viewport => {
    let span = Math.min(duration, Math.max(minSpan, t1 - t0))
    let a = t0
    if (a < 0) a = 0
    if (a + span > duration) a = duration - span
    if (a < 0) {
      a = 0
      span = duration
    }
    return { t0: a, t1: a + span }
  }

  const zoomAt = (factor: number, centerT: number) => {
    const span = (viewport.t1 - viewport.t0) * factor
    const frac = (centerT - viewport.t0) / (viewport.t1 - viewport.t0)
    onViewport(clampVp(centerT - frac * span, centerT - frac * span + span))
  }

  // Wheel: zoom around the pointer; horizontal wheel / trackpad: pan. Needs a non-passive listener.
  useEffect(() => {
    const el = overlayRef.current
    if (!el || !layout) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dt = (e.deltaX / (layout.plotRight - layout.plotLeft)) * (viewport.t1 - viewport.t0)
        onViewport(clampVp(viewport.t0 + dt, viewport.t1 + dt))
      } else {
        zoomAt(Math.pow(1.0015, e.deltaY), xToTime(layout, viewport, Math.min(layout.plotRight, Math.max(layout.plotLeft, x))))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const localX = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left
  const localY = (e: React.PointerEvent) => e.clientY - e.currentTarget.getBoundingClientRect().top

  const groupNear = (x: number): EventGroup | null => {
    if (!layout) return null
    let best: EventGroup | null = null
    let bestD = 8
    for (const g of groups) {
      const d = Math.abs(timeToX(layout, viewport, g.time) - x)
      if (d < bestD) {
        bestD = d
        best = g
      }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layout) return
    const x = localX(e)
    const y = localY(e)
    if (y <= layout.eventRowBottom) {
      const g = groupNear(x)
      if (g) {
        props.onSelectGroup(g)
        return
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.shiftKey || e.button === 1) {
      drag.current = { mode: 'pan', startX: x, startVp: viewport }
    } else {
      drag.current = { mode: 'cursor', startX: x, startVp: viewport }
      props.onScrubStart()
      props.onCursorTime(xToTime(layout, viewport, Math.min(layout.plotRight, Math.max(layout.plotLeft, x))))
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layout) return
    const x = localX(e)
    const d = drag.current
    if (d?.mode === 'cursor') {
      props.onCursorTime(xToTime(layout, viewport, Math.min(layout.plotRight, Math.max(layout.plotLeft, x))))
    } else if (d?.mode === 'pan') {
      const dt = ((d.startX - x) / (layout.plotRight - layout.plotLeft)) * (d.startVp.t1 - d.startVp.t0)
      onViewport(clampVp(d.startVp.t0 + dt, d.startVp.t1 + dt))
    } else if (localY(e) <= layout.eventRowBottom) {
      const g = groupNear(x)
      setHover(g ? { group: g, x: timeToX(layout, viewport, g.time) } : null)
    } else if (hover) setHover(null)
  }

  const endDrag = () => {
    drag.current = null
  }

  const span = viewport.t1 - viewport.t0
  const periods = span / result.params.period

  return (
    <div className="scope">
      <div className="scope-toolbar">
        <div className="legend" role="group" aria-label="Waveform visibility">
          {(Object.keys(SIGNAL_META) as SignalId[]).map((sid) => (
            <button
              key={sid}
              className={`chip ${visible[sid] ? 'chip--on' : ''}`}
              aria-pressed={visible[sid]}
              title={SIGNAL_META[sid].name}
              onClick={() => props.onToggleSignal(sid)}
            >
              <span className={`swatch ${SIGNAL_META[sid].dashed ? 'swatch--dashed' : ''}`} style={{ ['--c' as string]: `var(${SIGNAL_META[sid].cssVar})` }} />
              {SIGNAL_META[sid].label}
            </button>
          ))}
        </div>
        <div className="zoom" role="group" aria-label="Time zoom">
          <span className="zoom-info">{periods >= 0.995 ? `${periods.toFixed(periods % 1 < 0.01 ? 0 : 1)} cyc` : formatTime(span)}</span>
          <button className="icon-btn" onClick={() => zoomAt(ZOOM_STEP, (viewport.t0 + viewport.t1) / 2)} aria-label="Zoom out" title="Zoom out">
            −
          </button>
          <button className="icon-btn" onClick={() => zoomAt(1 / ZOOM_STEP, (viewport.t0 + viewport.t1) / 2)} aria-label="Zoom in" title="Zoom in">
            +
          </button>
          <button
            className="text-btn"
            onClick={() => {
              const t = result.trace.time[cursorIndex]
              const T = result.params.period
              const c = Math.min(Math.floor(t / T), result.params.cycles - 1)
              onViewport(clampVp(c * T, (c + 1) * T))
            }}
            title="Show the cycle under the cursor"
          >
            1 cycle
          </button>
          <button className="text-btn" onClick={() => onViewport(null)} title="Show the whole run">
            Fit
          </button>
        </div>
      </div>
      <div className="scope-canvas" ref={wrapRef}>
        <canvas ref={baseRef} className="scope-layer" aria-hidden="true" />
        <canvas
          ref={overlayRef}
          className="scope-layer scope-layer--overlay"
          role="img"
          aria-label="Oscilloscope: Vin, Vout, Vd, Io and Id on a shared time axis. Click or drag to move the time cursor."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => onViewport(null)}
        />
        {hover && layout && (
          <div className="scope-tip" style={{ left: Math.min(Math.max(hover.x, 90), layout.width - 90), top: layout.eventRowBottom + 4 }}>
            <div className="scope-tip-time">{formatTime(hover.group.time)}</div>
            {hover.group.events.map((ev) => (
              <div key={ev.id}>{eventTitle(ev)}</div>
            ))}
            <div className="scope-tip-hint">Click for what &amp; why</div>
          </div>
        )}
      </div>
      <p className="scope-hint">Drag to move the cursor · wheel to zoom · Shift+drag to pan · double-click to fit · click a ◆ marker for its explanation</p>
    </div>
  )
}
