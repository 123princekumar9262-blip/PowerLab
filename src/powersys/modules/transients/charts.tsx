import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { fx, sg } from '../../ui/format.ts'
import { useReducedMotion } from '../../ui/kit.tsx'

/*
 * A line chart with a movable time cursor (click, drag or the arrow keys) — the link between the lattice diagram,
 * the probe's v(t) and the 3D wave. Same look as the shared Plot (ps-plot-* classes).
 */

export interface ChartSeries {
  id: string
  label: string
  color: string
  points: Array<[number, number]>
  dashed?: boolean
}

function ticks(a: number, b: number, n = 5): number[] {
  const span = b - a || 1
  const step0 = span / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

const nearest = (pts: Array<[number, number]>, x: number) => {
  let best = pts[0]
  for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p
  return best
}

export interface ChartProps {
  series: ChartSeries[]
  xLabel: string
  yLabel: string
  /** Unit of the cursor read-out for x and y. */
  xUnit: string
  yUnit: string
  xDomain: [number, number]
  yDomain?: [number, number]
  cursor?: number | null
  onCursor?(x: number): void
  hlines?: Array<{ y: number; label: string; tone?: 'warn' | 'bad' | 'muted' }>
  vlines?: Array<{ x: number; label: string }>
  /** Marked points (e.g. arrival times at the probe). */
  marks?: Array<{ x: number; label?: string }>
  height?: number
  label: string
  /** Extra attributes for tests (values the chart shows). */
  data?: Record<string, string>
  children?: ReactNode
  /** viewBox width: 640 for a half-width column, wider for a full-width card (keeps the text size). */
  width?: number
}

export function Chart({ series, xLabel, yLabel, xUnit, yUnit, xDomain, yDomain, cursor = null, onCursor, hlines = [], vlines = [], marks = [], height = 220, label, data, width = 640 }: ChartProps) {
  const W = width
  const H = height
  const m = { l: 58, r: 14, t: 12, b: 38 }
  const xd = xDomain
  const yd = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain
    const ys = [...series.flatMap((s) => s.points.map((p) => p[1])), ...hlines.map((h) => h.y), 0]
    let lo = Math.min(...ys)
    let hi = Math.max(...ys)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
    if (hi - lo < 1e-9) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.08
    return [lo - pad, hi + pad]
  }, [series, hlines, yDomain])
  const X = (x: number) => m.l + ((x - xd[0]) / (xd[1] - xd[0] || 1)) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - ((y - yd[0]) / (yd[1] - yd[0] || 1)) * (H - m.t - m.b)
  const svg = useRef<SVGSVGElement>(null)
  const clip = useId()
  const [drag, setDrag] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const toX = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const x = xd[0] + ((px - m.l) / (W - m.l - m.r)) * (xd[1] - xd[0])
    return Math.min(xd[1], Math.max(xd[0], x))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!onCursor) return
    const span = xd[1] - xd[0]
    const cur = cursor ?? xd[0]
    const step = span / (e.shiftKey ? 20 : 200)
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step
    else if (e.key === 'Home') next = xd[0]
    else if (e.key === 'End') next = xd[1]
    if (next !== null) {
      e.preventDefault()
      onCursor(Math.min(xd[1], Math.max(xd[0], next)))
    }
  }
  const shown = hover ?? cursor
  const xt = ticks(xd[0], xd[1])
  const yt = ticks(yd[0], yd[1], 4)
  return (
    <figure className="ps-plot tr-chart" {...(data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v])) : {})}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role={onCursor ? 'slider' : 'img'}
        aria-label={label}
        aria-valuemin={onCursor ? xd[0] : undefined}
        aria-valuemax={onCursor ? xd[1] : undefined}
        aria-valuenow={onCursor && cursor !== null ? Number(cursor.toFixed(3)) : undefined}
        aria-valuetext={onCursor && cursor !== null ? `${fx(cursor, 2)} ${xUnit}` : undefined}
        tabIndex={onCursor ? 0 : undefined}
        className={onCursor ? 'tr-chart-svg is-interactive' : 'tr-chart-svg'}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if (!onCursor) return
          svg.current?.setPointerCapture?.(e.pointerId)
          setDrag(true)
          onCursor(toX(e))
        }}
        onPointerMove={(e) => {
          if (drag && onCursor) onCursor(toX(e))
          else setHover(toX(e))
        }}
        onPointerUp={() => setDrag(false)}
        onPointerLeave={() => {
          setHover(null)
          setDrag(false)
        }}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
        </defs>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'ps-plot-zero' : 'ps-plot-grid'} />
            <text x={m.l - 6} y={Y(v) + 4} className="ps-plot-tick" textAnchor="end">
              {sg(v, 3)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} x={X(v)} y={H - m.b + 15} className="ps-plot-tick" textAnchor="middle">
            {sg(v, 3)}
          </text>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 4} className="ps-plot-axis" textAnchor="middle">
          {xLabel}
        </text>
        <text x={13} y={(m.t + H - m.b) / 2} className="ps-plot-axis" textAnchor="middle" transform={`rotate(-90 13 ${(m.t + H - m.b) / 2})`}>
          {yLabel}
        </text>
        {hlines.map((h, k) => (
          <g key={`h${k}`} className={`tr-hline tr-hline--${h.tone ?? 'muted'}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(h.y)} y2={Y(h.y)} />
            <text x={W - m.r - 4} y={Y(h.y) - 4} textAnchor="end">
              {h.label}
            </text>
          </g>
        ))}
        {vlines.map((v, k) => (
          <g key={`v${k}`}>
            <line x1={X(v.x)} x2={X(v.x)} y1={m.t} y2={H - m.b} className="ps-plot-ref" />
            <text x={X(v.x) + 4} y={m.t + 12 + k * 12} className="ps-plot-note">
              {v.label}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {series.map((s) => (
            <path
              key={s.id}
              d={s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')}
              className="ps-plot-line"
              style={{ stroke: s.color }}
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          ))}
          {marks.map((mk, k) => (
            <g key={`m${k}`} className="tr-mark">
              <line x1={X(mk.x)} x2={X(mk.x)} y1={H - m.b} y2={H - m.b - 6} />
            </g>
          ))}
        </g>
        {shown !== null && (
          <g className={hover !== null && hover !== cursor ? 'ps-plot-hover' : 'tr-cursor'}>
            <line x1={X(shown)} x2={X(shown)} y1={m.t} y2={H - m.b} />
            {series.map((s) => {
              const p = nearest(s.points, shown)
              return p ? <circle key={s.id} cx={X(p[0])} cy={Y(p[1])} r={4} style={{ fill: s.color }} /> : null
            })}
          </g>
        )}
      </svg>
      <figcaption className="ps-plot-foot">
        <ul className="ps-plot-legend">
          {series.map((s) => (
            <li key={s.id}>
              <span className={`ps-plot-key ${s.dashed ? 'tr-key-dashed' : ''}`} style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <span className="ps-plot-readout" aria-live="off">
          {shown !== null
            ? `${xLabel.split(' [')[0]} ${fx(shown, 2)} ${xUnit}: ${series.map((s) => `${s.label} ${sg(nearest(s.points, shown)[1], 4)} ${yUnit}`).join(' · ')}`
            : onCursor
              ? 'Click or drag to choose a time'
              : 'Hover to read values'}
        </span>
      </figcaption>
    </figure>
  )
}

// ── the time bar: scrub, step, play / pause ────────────────────────────────────────────────────────────────────

export function TimeBar({ t, setT, window, T, playing, setPlaying }: { t: number; setT(t: number): void; window: number; T: number; playing: boolean; setPlaying(p: boolean): void }) {
  const reduced = useReducedMotion()
  const id = useId()
  const step = T / 10
  const go = (x: number) => {
    setPlaying(false)
    setT(Math.min(window, Math.max(0, x)))
  }
  return (
    <div className="tr-timebar" role="group" aria-label="Time">
      <button type="button" className="text-btn" onClick={() => go(0)} aria-label="Back to t = 0">
        ⏮
      </button>
      <button type="button" className="text-btn" onClick={() => go(t - step)} aria-label="Step back a tenth of a travel time">
        ◀ T/10
      </button>
      {!reduced && (
        <button
          type="button"
          className="btn btn--primary ps-btn-sm tr-play"
          onClick={() => {
            if (!playing && t >= window - 1e-9) setT(0)
            setPlaying(!playing)
          }}
          aria-pressed={playing}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      )}
      <button type="button" className="text-btn" onClick={() => go(t + step)} aria-label="Step forward a tenth of a travel time">
        T/10 ▶
      </button>
      <label htmlFor={id} className="sr-only">
        Time
      </label>
      <input id={id} className="tr-time-slider" type="range" min={0} max={window} step={window / 800} value={t} onChange={(e) => go(Number(e.target.value))} />
      <output htmlFor={id} className="tr-time-out">
        t = {fx(t, 2)} µs <span className="muted">= {fx(t / T, 2)} T</span>
      </output>
      {reduced && <span className="small muted">Reduced motion: no playback — step or drag the time.</span>}
    </div>
  )
}
