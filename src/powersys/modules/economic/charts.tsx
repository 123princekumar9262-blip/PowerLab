import { useId } from 'react'
import { fx, sg } from '../../ui/format.ts'
import type { Combo } from './commitment.ts'
import { grp } from './fmt.ts'
import { cost, ic, type DispatchOk, type Unit } from './dispatch.ts'

/*
 * The module's charts, drawn in the shared ps-plot style. Every mark is CALCULATED from the dispatch: curves from
 * the cost coefficients, operating points and λ from the solved dispatch, bars from the outputs and the limits.
 * (PlantIcon is the one CONCEPTUAL picture: it is labelled as an illustration where it is used.)
 */

export const UNIT_COLORS = ['var(--ps-c)', 'var(--ps-b)', 'var(--ps-mv)']
export const unitColor = (i: number) => UNIT_COLORS[i % UNIT_COLORS.length]

/** A tick value: integers grouped (1,500), others to 3 significant digits — no trailing zeros. */
const tick = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-IN') : sg(v, 3))
/** A cost coefficient as typed (5.3, 0.004, 1750), at most 4 significant digits. */
export const coef = (x: number) => String(Number(x.toPrecision(4)))

function ticks(a: number, b: number, n = 5): number[] {
  const span = b - a || 1
  const step0 = span / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

export interface Marker {
  x: number
  y: number
  color: string
  shape?: 'dot' | 'ring' | 'square'
  label?: string
}

export interface ChartProps {
  series: Array<{ id: string; label: string; color: string; points: Array<[number, number]>; dashed?: boolean; faint?: boolean }>
  markers?: Marker[]
  /** Vertical connectors (e.g. from IC_i up to L_i·IC_i). */
  links?: Array<{ x: number; y0: number; y1: number; color: string }>
  hlines?: Array<{ y: number; label: string; tone?: 'lambda' | 'ref' }>
  vlines?: Array<{ x: number; label: string }>
  /** Draw a faint drop line from each marker to the x-axis. */
  drops?: boolean
  xLabel: string
  yLabel: string
  xDomain: [number, number]
  yDomain?: [number, number]
  height?: number
  label: string
  /** Text for screen readers: the values shown. */
  desc?: string
  className?: string
  legend?: boolean
}

/** A line chart with operating points, a λ line and limits — the dispatch drawn on its own curves. */
export function Chart({ series, markers = [], links = [], hlines = [], vlines = [], drops, xLabel, yLabel, xDomain, yDomain, height = 280, label, desc, className, legend = true }: ChartProps) {
  const W = 640
  const H = height
  const m = { l: 60, r: 18, t: 14, b: 40 }
  const ys = [...series.flatMap((s) => s.points.map((p) => p[1])), ...markers.map((k) => k.y), ...hlines.map((h) => h.y)].filter(Number.isFinite)
  let yd: [number, number] = yDomain ?? [Math.min(...ys), Math.max(...ys)]
  if (!yDomain) {
    if (!Number.isFinite(yd[0]) || !Number.isFinite(yd[1])) yd = [0, 1]
    if (yd[1] - yd[0] < 1e-9) yd = [yd[0] - 1, yd[1] + 1]
    const pad = (yd[1] - yd[0]) * 0.1
    yd = [yd[0] - pad, yd[1] + pad]
  }
  const X = (x: number) => m.l + ((x - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - ((y - yd[0]) / (yd[1] - yd[0] || 1)) * (H - m.t - m.b)
  const clip = useId()
  const descId = useId()
  // marker labels: pushed apart vertically so close points keep readable labels
  const labels = markers
    .map((k, i) => ({ i, x: X(k.x), y: Y(k.y), text: k.label }))
    .filter((l) => l.text)
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14
  return (
    <figure className={`ps-plot ed-chart ${className ?? ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} aria-describedby={desc ? descId : undefined}>
        {desc && <desc id={descId}>{desc}</desc>}
        <defs>
          <clipPath id={clip}>
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
        </defs>
        {ticks(yd[0], yd[1], 4).map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="ps-plot-grid" />
            <text x={m.l - 6} y={Y(v) + 4} className="ps-plot-tick" textAnchor="end">
              {tick(v)}
            </text>
          </g>
        ))}
        {ticks(xDomain[0], xDomain[1], 6).map((v) => (
          <text key={`x${v}`} x={X(v)} y={H - m.b + 15} className="ps-plot-tick" textAnchor="middle">
            {tick(v)}
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="ps-plot-zero" />
        <text x={(m.l + W - m.r) / 2} y={H - 4} className="ps-plot-axis" textAnchor="middle">
          {xLabel}
        </text>
        <text x={13} y={(m.t + H - m.b) / 2} className="ps-plot-axis" textAnchor="middle" transform={`rotate(-90 13 ${(m.t + H - m.b) / 2})`}>
          {yLabel}
        </text>
        <g clipPath={`url(#${clip})`}>
          {vlines.map((v, k) => (
            <line key={`v${k}`} x1={X(v.x)} x2={X(v.x)} y1={m.t} y2={H - m.b} className="ps-plot-ref" />
          ))}
          {drops && markers.map((k, i) => <line key={`d${i}`} x1={X(k.x)} x2={X(k.x)} y1={Y(k.y)} y2={H - m.b} className="ed-drop" style={{ stroke: k.color }} />)}
          {series.map((s) => (
            <path
              key={s.id}
              d={s.points
                .filter((p) => Number.isFinite(p[1]))
                .map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`)
                .join('')}
              className={`ps-plot-line ${s.faint ? 'ed-faint' : ''}`}
              style={{ stroke: s.color }}
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          ))}
          {hlines.map((h, k) => (
            <line key={`h${k}`} x1={m.l} x2={W - m.r} y1={Y(h.y)} y2={Y(h.y)} className={h.tone === 'lambda' ? 'ed-lambda' : 'ps-plot-ref'} />
          ))}
          {links.map((l, k) => (
            <line key={`l${k}`} x1={X(l.x)} x2={X(l.x)} y1={Y(l.y0)} y2={Y(l.y1)} className="ed-link" style={{ stroke: l.color }} />
          ))}
          {markers.map((k, i) =>
            k.shape === 'square' ? (
              <rect key={`m${i}`} x={X(k.x) - 5} y={Y(k.y) - 5} width={10} height={10} className="ed-marker" style={{ fill: k.color }} />
            ) : (
              <circle
                key={`m${i}`}
                cx={X(k.x)}
                cy={Y(k.y)}
                r={k.shape === 'ring' ? 4.5 : 5.5}
                className={k.shape === 'ring' ? 'ed-ring' : 'ed-marker'}
                style={k.shape === 'ring' ? { stroke: k.color } : { fill: k.color }}
              />
            ),
          )}
        </g>
        {hlines.map((h, k) => (
          <text key={`ht${k}`} x={m.l + 6} y={Y(h.y) - 5} className={h.tone === 'lambda' ? 'ed-lambda-label' : 'ps-plot-note'}>
            {h.label}
          </text>
        ))}
        {vlines.map((v, k) => (
          <text key={`vt${k}`} x={X(v.x) + 4} y={m.t + 12 + k * 13} className="ps-plot-note">
            {v.label}
          </text>
        ))}
        {labels.map((l) => {
          const right = l.x > W - m.r - 150
          return (
            <text key={`ml${l.i}`} x={right ? l.x - 10 : l.x + 10} y={l.y + 4} textAnchor={right ? 'end' : 'start'} className="ed-mlabel">
              {l.text}
            </text>
          )
        })}
      </svg>
      {legend && (
        <figcaption className="ps-plot-foot">
          <ul className="ps-plot-legend">
            {series
              .filter((s) => !s.faint)
              .map((s) => (
                <li key={s.id}>
                  <span className="ps-plot-key" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </li>
              ))}
          </ul>
        </figcaption>
      )}
    </figure>
  )
}

const curve = (u: Unit, f: (u: Unit, p: number) => number, lo = u.pMin, hi = u.pMax, n = 40): Array<[number, number]> =>
  Array.from({ length: n + 1 }, (_, k) => {
    const p = lo + ((hi - lo) * k) / n
    return [p, f(u, p)]
  })

/** Incremental-cost lines with the operating points and the common λ line (and, with losses, L_i·IC_i on λ). */
export function IcChart({ units, d, perMWh, xMax, height, label }: { units: Unit[]; d: DispatchOk | null; perMWh: string; xMax?: number; height?: number; label?: string }) {
  const xm = xMax ?? Math.max(...units.map((u) => u.pMax))
  const withLoss = !!d && d.loss > 1e-9
  const markers: Marker[] = []
  const links: ChartProps['links'] = []
  if (d)
    units.forEach((u, i) => {
      if (!u.on) return
      const lim = d.limit[i]
      markers.push({ x: d.P[i], y: d.ic[i], color: unitColor(i), shape: lim ? 'square' : 'dot', label: `${u.name.replace('Unit ', 'U')} ${fx(d.P[i], 0)} MW${lim ? ` · at ${lim}` : ''}` })
      if (withLoss) {
        markers.push({ x: d.P[i], y: d.ic[i] * d.pf[i], color: unitColor(i), shape: 'ring' })
        links.push({ x: d.P[i], y0: d.ic[i], y1: d.ic[i] * d.pf[i], color: unitColor(i) })
      }
    })
  const shown = units.some((u) => u.on) ? units.filter((u) => u.on) : units
  const icMax = Math.max(...shown.map((u) => ic(u, Math.min(u.pMax, xm)) * (withLoss ? Math.max(...d!.pf) : 1)), d ? d.lambda : 0)
  const icMin = Math.min(...shown.map((u) => ic(u, Math.min(u.pMin, xm))))
  const pad = (icMax - icMin) * 0.12 || 1
  return (
    <Chart
      label={label ?? 'Incremental cost of each unit against its output, with the operating points and λ'}
      desc={d ? `λ = ${fx(d.lambda, 3)} ${perMWh}. ${units.map((u, i) => (u.on ? `${u.name}: ${fx(d.P[i], 1)} MW, IC ${fx(d.ic[i], 3)}` : `${u.name} off`)).join('; ')}.` : 'No dispatch.'}
      series={units.map((u, i) => ({
        id: u.id,
        label: `${u.name}  IC = ${coef(u.b)} + ${coef(2 * u.c)}·P${u.on ? '' : ' (off)'}`,
        color: unitColor(i),
        points: curve(u, ic, u.pMin, Math.min(u.pMax, xm)),
        dashed: !u.on,
      }))}
      markers={markers}
      links={links}
      drops
      hlines={d ? [{ y: d.lambda, label: `λ = ${fx(d.lambda, d.lambda < 100 ? 3 : 1)} ${perMWh}`, tone: 'lambda' }] : []}
      xLabel="Output P [MW]"
      yLabel={`Incremental cost [${perMWh}]`}
      xDomain={[0, xm]}
      yDomain={[Math.max(0, icMin - pad), icMax + pad]}
      height={height}
      className="ed-ic"
    />
  )
}

/** Fuel-cost curves C_i(P) with the operating points. */
export function CostChart({ units, d, perH, xMax, height, highlight }: { units: Unit[]; d: DispatchOk | null; perH: string; xMax?: number; height?: number; highlight?: { i: number; p: number } }) {
  const xm = xMax ?? Math.max(...units.map((u) => u.pMax))
  const markers: Marker[] = []
  if (d)
    units.forEach(
      (u, i) => u.on && markers.push({ x: d.P[i], y: d.costs[i], color: unitColor(i), shape: d.limit[i] ? 'square' : 'dot', label: `${u.name.replace('Unit ', 'U')} ${grp(d.costs[i], 0)} ${perH}` }),
    )
  if (highlight) {
    const u = units[highlight.i]
    markers.push({
      x: highlight.p,
      y: cost(u, highlight.p),
      color: unitColor(highlight.i),
      label: `${u.name.replace('Unit ', 'U')} at ${fx(highlight.p, 0)} MW: ${grp(cost(u, highlight.p), 0)} ${perH}`,
    })
  }
  return (
    <Chart
      label="Fuel cost of each unit against its output"
      desc={d ? units.map((u, i) => `${u.name}: ${fx(d.costs[i], 1)} ${perH} at ${fx(d.P[i], 1)} MW`).join('; ') : undefined}
      series={units.map((u, i) => ({
        id: u.id,
        label: `${u.name}  C = ${coef(u.a)} + ${coef(u.b)}·P + ${coef(u.c)}·P²`,
        color: unitColor(i),
        points: curve(u, cost, u.pMin, Math.min(u.pMax, xm)),
        dashed: !u.on,
      }))}
      markers={markers}
      drops
      xLabel="Output P [MW]"
      yLabel={`Fuel cost [${perH}]`}
      xDomain={[0, xm]}
      height={height}
      className="ed-cost"
    />
  )
}

/** Each unit's output as a bar on its own range, with the allowed band [P_min, P_max] marked. */
export function DispatchBars({ units, d, xMax }: { units: Unit[]; d: DispatchOk | null; xMax?: number }) {
  const xm = xMax ?? Math.max(...units.map((u) => u.pMax))
  const pc = (p: number) => `${Math.max(0, Math.min(100, (p / xm) * 100))}%`
  return (
    <ul className="ed-bars" aria-label="Output of each unit">
      {units.map((u, i) => {
        const p = d && u.on ? d.P[i] : 0
        const lim = d && u.on ? d.limit[i] : null
        return (
          <li key={u.id} className={`ed-bar ${u.on ? '' : 'is-off'}`}>
            <span className="ed-bar-name">
              <span className="ed-dot" style={{ background: unitColor(i) }} aria-hidden="true" />
              {u.name}
              <span className="muted small"> · {u.kind}</span>
            </span>
            <span className="ed-bar-track" aria-hidden="true">
              <span className="ed-bar-band" style={{ left: pc(u.pMin), width: `calc(${pc(u.pMax)} - ${pc(u.pMin)})` }} />
              {d && u.on && <span className="ed-bar-fill" style={{ width: pc(p), background: unitColor(i) }} />}
              <span className="ed-bar-lim" style={{ left: pc(u.pMin) }} />
              <span className="ed-bar-lim" style={{ left: pc(u.pMax) }} />
            </span>
            <span className="ed-bar-val">
              {!u.on ? 'off' : d ? `${fx(p, 1)} MW` : '—'}
              {lim && <span className={`ed-badge ed-badge--${lim}`}>at {lim === 'max' ? 'P_max' : 'P_min'}</span>}
            </span>
            <span className="ed-bar-range small muted">
              limits {fx(u.pMin, 0)}–{fx(u.pMax, 0)} MW
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** The day's commitment: one row per unit, one cell per hour (filled = on), with each hour's output. */
export function CommitStrip({ units, plan, loads, diff, width = 640 }: { units: Unit[]; plan: Array<Combo | null>; loads: number[]; diff?: boolean[]; width?: number }) {
  const W = width
  const rowH = 22
  const top = 132
  const H = top + units.length * rowH + 30
  const m = { l: 60, r: 18 }
  const cw = (W - m.l - m.r) / loads.length
  const peak = Math.max(...loads)
  const ymax = Math.ceil((peak * 1.08) / 100) * 100
  const Y = (v: number) => 12 + (1 - v / ymax) * (top - 30)
  return (
    <figure className="ps-plot ed-commit">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The day's commitment: hourly output of each unit stacked to the load, and which units are on each hour">
        {ticks(0, ymax, 3).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="ps-plot-grid" />
            <text x={m.l - 6} y={Y(v) + 4} className="ps-plot-tick" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={13} y={(12 + top - 18) / 2} className="ps-plot-axis" textAnchor="middle" transform={`rotate(-90 13 ${(12 + top - 18) / 2})`}>
          MW
        </text>
        {loads.map((load, h) => {
          const c = plan[h]
          let y0 = Y(0)
          return (
            <g key={h}>
              {c?.dispatch
                ? units.map((u, i) => {
                    const p = c.dispatch!.P[i]
                    if (!c.on[i] || p <= 0) return null
                    const y1 = y0 - (Y(0) - Y(p))
                    const r = <rect key={u.id} x={m.l + h * cw + 1} y={y1} width={cw - 2} height={y0 - y1} style={{ fill: unitColor(i) }} className="ed-stack" />
                    y0 = y1
                    return r
                  })
                : null}
              {!c && <rect x={m.l + h * cw + 1} y={Y(load)} width={cw - 2} height={Y(0) - Y(load)} className="ed-unserved" />}
              {diff?.[h] && (
                <text x={m.l + h * cw + cw / 2} y={Y(load) - 4} className="ed-diffmark" textAnchor="middle">
                  ◆
                </text>
              )}
            </g>
          )
        })}
        {units.map((u, i) => (
          <g key={u.id}>
            <text x={m.l - 6} y={top + i * rowH + 15} className="ps-plot-tick" textAnchor="end">
              {u.name.replace('Unit ', 'U')}
            </text>
            {loads.map((_, h) => (
              <rect
                key={h}
                x={m.l + h * cw + 1}
                y={top + i * rowH + 3}
                width={cw - 2}
                height={rowH - 6}
                rx={2}
                className={plan[h]?.on[i] ? 'ed-cell is-on' : 'ed-cell'}
                style={plan[h]?.on[i] ? { fill: unitColor(i) } : undefined}
              />
            ))}
          </g>
        ))}
        {loads.map((_, h) =>
          h % 3 === 0 ? (
            <text key={h} x={m.l + h * cw + cw / 2} y={H - 8} className="ps-plot-tick" textAnchor="middle">
              {String(h).padStart(2, '0')}:00
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="ps-plot-foot">
        <ul className="ps-plot-legend">
          {units.map((u, i) => (
            <li key={u.id}>
              <span className="ps-plot-key" style={{ background: unitColor(i) }} aria-hidden="true" />
              {u.name}
            </li>
          ))}
          {diff?.some(Boolean) && <li>◆ hour where the priority list differs from the best commitment</li>}
        </ul>
      </figcaption>
    </figure>
  )
}

/** A small drawing of a power station (CONCEPTUAL — an illustration, no numbers). */
export function PlantIcon({ kind, color }: { kind: 'coal' | 'gas'; color: string }) {
  return (
    <svg viewBox="0 0 120 80" className="ed-plant" aria-hidden="true">
      <rect x="6" y="40" width="64" height="32" rx="2" className="ed-plant-body" />
      <rect x="14" y="48" width="10" height="10" className="ed-plant-win" />
      <rect x="30" y="48" width="10" height="10" className="ed-plant-win" />
      <rect x="46" y="48" width="10" height="10" className="ed-plant-win" />
      {kind === 'coal' ? (
        <>
          <path d="M80 72 L84 22 L96 22 L100 72 Z" className="ed-plant-body" />
          <path d="M84 30 L96 30" stroke={color} strokeWidth="3" />
          <circle cx="92" cy="14" r="5" className="ed-plant-steam" />
          <circle cx="100" cy="8" r="4" className="ed-plant-steam" />
        </>
      ) : (
        <>
          <rect x="80" y="30" width="8" height="42" className="ed-plant-body" />
          <rect x="94" y="36" width="8" height="36" className="ed-plant-body" />
          <path d="M80 34 L88 34 M94 40 L102 40" stroke={color} strokeWidth="3" />
        </>
      )}
      <rect x="6" y="36" width="64" height="4" style={{ fill: color }} />
      <line x1="2" y1="72" x2="118" y2="72" className="ed-plant-ground" />
    </svg>
  )
}
