import { useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { sg } from './format.ts'

/**
 * A line chart for power-system quantities against time or another variable: one y-axis, thin lines, a legend
 * (and direct labels at the line ends for ≤ 4 series), recessive grid, and a crosshair read-out on hover / focus.
 * Colours come from CSS variables passed per series (e.g. 'var(--ps-a)').
 */
export interface PlotSeries {
  id: string
  label: string
  color: string
  points: Array<[number, number]>
  dashed?: boolean
}

export interface PlotProps {
  series: PlotSeries[]
  xLabel: string
  yLabel: string
  xDomain?: [number, number]
  yDomain?: [number, number]
  /** Vertical markers (an event time, a clearing angle). */
  vlines?: Array<{ x: number; label: string }>
  /** Horizontal reference lines (a limit, a set-point). */
  hlines?: Array<{ y: number; label: string }>
  /** Shaded x-intervals (e.g. accelerating area). */
  bands?: Array<{ x0: number; x1: number; label?: string; tone?: 'a' | 'b' }>
  height?: number
  label: string
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

export function Plot({ series, xLabel, yLabel, xDomain, yDomain, vlines = [], hlines = [], bands = [], height = 240, label }: PlotProps) {
  const W = 640
  const H = height
  const m = { l: 52, r: series.length <= 4 ? 92 : 16, t: 12, b: 38 }
  const all = series.flatMap((s) => s.points)
  const xd = xDomain ?? [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))]
  const yd = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain
    const ys = [...all.map((p) => p[1]), ...hlines.map((h) => h.y)]
    let lo = Math.min(...ys)
    let hi = Math.max(...ys)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
    if (hi - lo < 1e-9) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.08
    return [lo - pad, hi + pad]
  }, [all, hlines, yDomain])
  const X = (x: number) => m.l + ((x - xd[0]) / (xd[1] - xd[0] || 1)) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - ((y - yd[0]) / (yd[1] - yd[0] || 1)) * (H - m.t - m.b)
  const [hover, setHover] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const clip = useId()
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    if (px < m.l || px > W - m.r) return setHover(null)
    setHover(xd[0] + ((px - m.l) / (W - m.l - m.r)) * (xd[1] - xd[0]))
  }
  const at = (s: PlotSeries, x: number) => {
    let best = s.points[0]
    for (const p of s.points) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p
    return best
  }
  const xt = ticks(xd[0], xd[1])
  const yt = ticks(yd[0], yd[1], 4)
  return (
    <figure className="ps-plot">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <clipPath id={clip}>
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
        </defs>
        {bands.map((b, k) => (
          <g key={k}>
            <rect x={X(b.x0)} y={m.t} width={Math.max(0, X(b.x1) - X(b.x0))} height={H - m.t - m.b} className={`ps-plot-band ps-plot-band--${b.tone ?? 'a'}`} />
            {b.label && (
              <text x={(X(b.x0) + X(b.x1)) / 2} y={m.t + 12} className="ps-plot-note" textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        ))}
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
        <text x={12} y={(m.t + H - m.b) / 2} className="ps-plot-axis" textAnchor="middle" transform={`rotate(-90 12 ${(m.t + H - m.b) / 2})`}>
          {yLabel}
        </text>
        {hlines.map((h, k) => (
          <g key={`h${k}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(h.y)} y2={Y(h.y)} className="ps-plot-ref" />
            <text x={m.l + 4} y={Y(h.y) - 4} className="ps-plot-note">
              {h.label}
            </text>
          </g>
        ))}
        {vlines.map((v, k) => (
          <g key={`v${k}`}>
            <line x1={X(v.x)} x2={X(v.x)} y1={m.t} y2={H - m.b} className="ps-plot-ref" />
            <text x={X(v.x) + 4} y={m.t + 24 + k * 12} className="ps-plot-note">
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
        </g>
        {series.length <= 4 &&
          directLabels(series, Y, m.t + 8, H - m.b).map((l) => (
            <text key={`l${l.id}`} x={W - m.r + 6} y={l.y} className="ps-plot-direct">
              {l.label}
            </text>
          ))}
        {hover !== null && (
          <g className="ps-plot-hover">
            <line x1={X(hover)} x2={X(hover)} y1={m.t} y2={H - m.b} />
            {series.map((s) => {
              const p = at(s, hover)
              return p ? <circle key={s.id} cx={X(p[0])} cy={Y(p[1])} r={4} style={{ fill: s.color }} /> : null
            })}
          </g>
        )}
      </svg>
      <figcaption className="ps-plot-foot">
        <ul className="ps-plot-legend">
          {series.map((s) => (
            <li key={s.id}>
              <span className="ps-plot-key" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <span className="ps-plot-readout" aria-live="off">
          {hover !== null
            ? `${xLabel.split(' [')[0]} ${sg(at(series[0], hover)?.[0] ?? hover, 3)}: ${series.map((s) => `${s.label} ${sg(at(s, hover)?.[1] ?? NaN, 4)}`).join(' · ')}`
            : 'Hover the chart to read values'}
        </span>
      </figcaption>
    </figure>
  )
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** End-of-line labels, pushed apart so that curves ending close together keep readable labels. */
function directLabels(series: PlotSeries[], Y: (y: number) => number, top: number, bottom: number) {
  const ls = series
    .filter((s) => s.points.length > 0)
    .map((s) => ({ id: s.id, label: s.label, y: clamp(Y(s.points[s.points.length - 1][1]) + 4, top, bottom) }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 12) ls[i].y = ls[i - 1].y + 12
  // if pushing ran past the bottom, shift the whole stack up
  const over = ls.length ? ls[ls.length - 1].y - bottom : 0
  if (over > 0) for (const l of ls) l.y -= over
  return ls
}
