import { useId } from 'react'
import { fx, sg } from '../../ui/format.ts'
import {
  capabilityBoundary,
  characteristics,
  pMaxMidShunt,
  pMaxSeries,
  pMidShunt,
  pSeries,
  qAtLimit,
  SUPPORT_LABEL,
  tcrB,
  vscLimits,
  type LccLink,
  type LccResult,
  type PvCurve,
  type Support,
} from './calc.ts'

/*
 * The module's charts, in the shared ps-plot style. Every mark is CALCULATED: curves from the model's equations,
 * operating points from the solved state, limits from the ratings. Nothing here is an illustration.
 */

export const COLORS = {
  rect: 'var(--ps-c)',
  inv: 'var(--ps-b)',
  none: 'var(--text-3)',
  svc: 'var(--ps-mv)',
  statcom: 'var(--ps-ehv)',
  series: 'var(--ps-c)',
  shunt: 'var(--ps-mv)',
  op: 'var(--ps-sel)',
  ac: 'var(--ps-a)',
  dc: 'var(--ps-c)',
} as const
export const SUPPORT_COLOR: Record<Support, string> = { none: COLORS.none, svc: COLORS.svc, statcom: COLORS.statcom }

function ticks(a: number, b: number, n = 5): number[] {
  const span = b - a || 1
  const step0 = span / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

export interface ChartSeries {
  id: string
  label: string
  color: string
  points: Array<[number, number]>
  dashed?: boolean
  faint?: boolean
  /** Not listed in the legend. */
  hideKey?: boolean
}
export interface ChartMarker {
  x: number
  y: number
  color: string
  shape?: 'dot' | 'ring' | 'square'
  label?: string
}
export interface ChartProps {
  series: ChartSeries[]
  markers?: ChartMarker[]
  hlines?: Array<{ y: number; label: string }>
  vlines?: Array<{ x: number; label: string }>
  xLabel: string
  yLabel: string
  xDomain: [number, number]
  yDomain: [number, number]
  width?: number
  height?: number
  label: string
  /** Text for screen readers: the values shown. */
  desc: string
  legend?: boolean
  className?: string
}

/** A line chart with operating points and reference lines (one y-axis, recessive grid, labelled markers). */
export function Chart({ series, markers = [], hlines = [], vlines = [], xLabel, yLabel, xDomain, yDomain, width = 640, height = 280, label, desc, legend = true, className }: ChartProps) {
  const W = width
  const H = height
  const m = { l: 56, r: 16, t: 14, b: 40 }
  const X = (x: number) => m.l + ((x - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - ((y - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * (H - m.t - m.b)
  const clip = useId()
  const descId = useId()
  const inside = (k: ChartMarker) => k.x >= xDomain[0] && k.x <= xDomain[1] && k.y >= yDomain[0] && k.y <= yDomain[1]
  const labels = markers
    .map((k, i) => ({ i, x: X(k.x), y: Y(k.y), text: k.label, ok: inside(k) }))
    .filter((l) => l.text && l.ok)
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14 && Math.abs(labels[i].x - labels[i - 1].x) < 160) labels[i].y = labels[i - 1].y + 14
  return (
    <figure className={`ps-plot hf-chart ${className ?? ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} aria-describedby={descId}>
        <desc id={descId}>{desc}</desc>
        <defs>
          <clipPath id={clip}>
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
        </defs>
        {ticks(yDomain[0], yDomain[1], 4).map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'ps-plot-zero' : 'ps-plot-grid'} />
            <text x={m.l - 6} y={Y(v) + 4} className="ps-plot-tick" textAnchor="end">
              {sg(v, 3)}
            </text>
          </g>
        ))}
        {ticks(xDomain[0], xDomain[1], W < 420 ? 4 : 6).map((v) => (
          <g key={`x${v}`}>
            {v === 0 && xDomain[0] < 0 && <line x1={X(0)} x2={X(0)} y1={m.t} y2={H - m.b} className="ps-plot-zero" />}
            <text x={X(v)} y={H - m.b + 15} className="ps-plot-tick" textAnchor="middle">
              {sg(v, 3)}
            </text>
          </g>
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
          {hlines.map((h, k) => (
            <line key={`h${k}`} x1={m.l} x2={W - m.r} y1={Y(h.y)} y2={Y(h.y)} className="ps-plot-ref" />
          ))}
          {series.map((s) => (
            <path
              key={s.id}
              d={s.points
                .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
                .map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`)
                .join('')}
              className={`ps-plot-line ${s.faint ? 'hf-faint' : ''}`}
              style={{ stroke: s.color }}
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          ))}
          {markers
            .filter(inside)
            .map((k, i) =>
              k.shape === 'square' ? (
                <rect key={`m${i}`} x={X(k.x) - 5} y={Y(k.y) - 5} width={10} height={10} className="hf-marker" style={{ fill: k.color }} />
              ) : (
                <circle
                  key={`m${i}`}
                  cx={X(k.x)}
                  cy={Y(k.y)}
                  r={k.shape === 'ring' ? 5 : 5.5}
                  className={k.shape === 'ring' ? 'hf-ring' : 'hf-marker'}
                  style={k.shape === 'ring' ? { stroke: k.color } : { fill: k.color }}
                />
              ),
            )}
        </g>
        {hlines.map((h, k) => (
          <text key={`ht${k}`} x={W - m.r - 6} y={Y(h.y) - 5} className="ps-plot-note" textAnchor="end">
            {h.label}
          </text>
        ))}
        {vlines.map((v, k) => (
          <text key={`vt${k}`} x={X(v.x) + 4} y={m.t + 12 + k * 13} className="ps-plot-note">
            {v.label}
          </text>
        ))}
        {labels.map((l) => {
          const right = l.x > W - m.r - 170
          return (
            <text key={`ml${l.i}`} x={right ? l.x - 10 : l.x + 10} y={l.y + 4} textAnchor={right ? 'end' : 'start'} className="hf-mlabel">
              {l.text}
            </text>
          )
        })}
      </svg>
      {legend && (
        <figcaption className="ps-plot-foot">
          <ul className="ps-plot-legend">
            {series
              .filter((s) => !s.faint && !s.hideKey)
              .map((s) => (
                <li key={s.id}>
                  <span className={`ps-plot-key ${s.dashed ? 'hf-key-dashed' : ''}`} style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </li>
              ))}
          </ul>
        </figcaption>
      )}
    </figure>
  )
}

const line = (f: (x: number) => number, a: number, b: number, n = 2): Array<[number, number]> => Array.from({ length: n + 1 }, (_, k) => [a + ((b - a) * k) / n, f(a + ((b - a) * k) / n)])

// ── LCC: the V_d–I_d characteristics ─────────────────────────────────────────────────────────────────────────

/** Rectifier and inverter control characteristics (V_d at the rectifier vs I_d) and the operating point. */
export function CharacteristicsPlot({ link, res, height = 300 }: { link: LccLink; res: LccResult; height?: number }) {
  const ch = characteristics(link)
  const iOrd = res.iOrder
  const iMax = Math.max(res.id, iOrd ?? 0) * 1.35 + 0.1
  const vTop = Math.max(ch.vd0r, ch.vd0i) * 1.08
  // zoom onto the region where the characteristics cross (from a round value below the lowest line end)
  const vLow = Math.max(0, Math.floor((0.8 * Math.min(ch.cia(iMax), ch.cea(0), res.vdr)) / 50) * 50)
  const series: ChartSeries[] = []
  series.push({ id: 'cia', label: `Rectifier at α_min = ${link.alphaMinDeg}° (CIA)`, color: COLORS.rect, points: line(ch.cia, 0, iMax), dashed: true })
  if (iOrd !== null) {
    series.push({
      id: 'cc-r',
      label: `Rectifier current control at I_order = ${fx(iOrd, 3)} kA`,
      color: COLORS.rect,
      points: [
        [iOrd, vLow],
        [iOrd, ch.cia(iOrd)],
      ] as Array<[number, number]>,
    })
    const i2 = iOrd - link.marginKa
    if (i2 > 0)
      series.push({
        id: 'cc-i',
        label: `Inverter current control at I_order − ΔI = ${fx(i2, 3)} kA`,
        color: COLORS.inv,
        points: [
          [i2, vLow],
          [i2, ch.cea(i2)],
        ] as Array<[number, number]>,
        dashed: true,
      })
  } else series.push({ id: 'alpha', label: `Rectifier at α = ${fx(res.alphaDeg, 1)}° (set by hand)`, color: COLORS.rect, points: line((i) => ch.alphaLine(res.alphaDeg, i), 0, iMax) })
  series.push({ id: 'cea', label: `Inverter at γ₀ = ${link.gammaDeg}° (CEA), seen at the rectifier`, color: COLORS.inv, points: line(ch.cea, 0, iMax) })
  return (
    <Chart
      series={series}
      markers={[{ x: res.id, y: res.vdr, color: COLORS.op, label: `operating point: ${fx(res.id, 3)} kA, ${fx(res.vdr, 1)} kV` }]}
      xLabel="DC current I_d [kA]"
      yLabel="V_d at the rectifier [kV]"
      xDomain={[0, iMax]}
      yDomain={[vLow, vTop]}
      height={height}
      label="Control characteristics of the DC link"
      desc={`Operating point ${fx(res.id, 3)} kA at ${fx(res.vdr, 1)} kV; mode ${res.mode}.`}
    />
  )
}

// ── compensation: power–angle curves ─────────────────────────────────────────────────────────────────────────

export function PowerAnglePlot({ v, x, k, p, height = 280 }: { v: number; x: number; k: number; p: number; height?: number }) {
  const n = 90
  const pts = (f: (d: number) => number) => Array.from({ length: n + 1 }, (_, j) => [(180 * j) / n, f((180 * j) / n)] as [number, number])
  const p0 = pMaxSeries(v, v, x, 0)
  const ps = pMaxSeries(v, v, x, k)
  const pm = pMaxMidShunt(v, x)
  const top = Math.max(p0, ps, pm) * 1.12
  const markers: ChartMarker[] = []
  const at = (pmax: number, half: boolean, color: string, name: string) => {
    if (p > pmax) return
    const d = half ? (2 * (Math.asin(p / pmax) * 180)) / Math.PI : (Math.asin(p / pmax) * 180) / Math.PI
    markers.push({ x: d, y: p, color, label: `${name}: δ = ${fx(d, 1)}°` })
  }
  at(p0, false, COLORS.none, 'none')
  if (k > 0) at(ps, false, COLORS.series, 'series')
  at(pm, true, COLORS.shunt, 'midpoint shunt')
  return (
    <Chart
      series={[
        { id: 'none', label: `Uncompensated (P_max ${fx(p0, 2)} pu)`, color: COLORS.none, points: pts((d) => pSeries(v, v, x, 0, d)) },
        ...(k > 0 ? [{ id: 'series', label: `Series k = ${fx(k * 100, 0)} % (P_max ${fx(ps, 2)} pu)`, color: COLORS.series, points: pts((d) => pSeries(v, v, x, k, d)) }] : []),
        { id: 'shunt', label: `Midpoint shunt (P_max ${fx(pm, 2)} pu)`, color: COLORS.shunt, points: pts((d) => pMidShunt(v, x, d)) },
      ]}
      markers={markers}
      hlines={[{ y: p, label: `transfer ${fx(p, 2)} pu` }]}
      xLabel="Angle δ between the ends [°]"
      yLabel="Power P [pu]"
      xDomain={[0, 180]}
      yDomain={[0, top]}
      height={height}
      label="Power–angle curves: uncompensated, series compensated and midpoint shunt compensated"
      desc={`P_max: uncompensated ${fx(p0, 3)}, series ${fx(ps, 3)}, midpoint shunt ${fx(pm, 3)} pu.`}
    />
  )
}

// ── weak bus: P–V curves ─────────────────────────────────────────────────────────────────────────────────────

/** Split a curve at its nose into the upper (solid) and lower (dashed) branches. */
function branches(c: PvCurve): { upper: Array<[number, number]>; lower: Array<[number, number]> } {
  const k = c.points.findIndex((p) => p[1] < c.nose.v - 1e-9)
  if (k < 0) return { upper: c.points, lower: [] }
  const upper = [...c.points.slice(0, k), [c.nose.p, c.nose.v] as [number, number]]
  const lower = [[c.nose.p, c.nose.v] as [number, number], ...c.points.slice(k)]
  return { upper, lower }
}

export function PvPlot({ curves, load, op, active, height = 300 }: { curves: PvCurve[]; load: number; op: { p: number; v: number } | null; active: Support; height?: number }) {
  const series: ChartSeries[] = []
  const markers: ChartMarker[] = []
  const pTop = Math.max(load, ...curves.map((c) => c.nose.p)) * 1.12
  for (const c of curves) {
    const b = branches(c)
    const col = SUPPORT_COLOR[c.support]
    series.push({ id: `${c.support}-u`, label: `${SUPPORT_LABEL[c.support]} (collapse at ${fx(c.nose.p, 3)} pu)`, color: col, points: b.upper })
    if (b.lower.length) series.push({ id: `${c.support}-l`, label: `${SUPPORT_LABEL[c.support]} lower branch`, color: col, points: b.lower, dashed: true, hideKey: true })
    markers.push({ x: c.nose.p, y: c.nose.v, color: col, shape: 'ring', label: c.support === active ? `collapse ${fx(c.nose.p, 3)} pu` : undefined })
  }
  if (op) markers.push({ x: op.p, y: op.v, color: COLORS.op, label: `operating point: V = ${fx(op.v, 3)} pu` })
  return (
    <Chart
      series={series}
      markers={markers}
      vlines={[{ x: load, label: `load ${fx(load, 2)} pu` }]}
      xLabel="Load P [pu of the load rating]"
      yLabel="Bus voltage V [pu]"
      xDomain={[0, pTop]}
      yDomain={[0, 1.1]}
      height={height}
      label="P–V curves of the weak bus without support, with an SVC and with a STATCOM"
      desc={`${curves.map((c) => `${SUPPORT_LABEL[c.support]}: collapse at ${fx(c.nose.p, 3)} pu, ${fx(c.nose.v, 3)} pu voltage`).join('; ')}.${op ? ` Operating point ${fx(op.v, 3)} pu.` : ' No operating point: beyond collapse.'}`}
    />
  )
}

/** Capacitive output at the limit against voltage: SVC ∝ V², STATCOM ∝ V. */
export function QvPlot({ rating, v, height = 240 }: { rating: number; v: number | null; height?: number }) {
  const n = 40
  const pts = (s: Support) => Array.from({ length: n + 1 }, (_, j) => [(1.1 * j) / n, qAtLimit(s, rating, (1.1 * j) / n)] as [number, number])
  const markers: ChartMarker[] = []
  if (v !== null) {
    markers.push({ x: v, y: qAtLimit('svc', rating, v), color: COLORS.svc, label: `SVC ${fx(qAtLimit('svc', rating, v), 3)} pu` })
    markers.push({ x: v, y: qAtLimit('statcom', rating, v), color: COLORS.statcom, label: `STATCOM ${fx(qAtLimit('statcom', rating, v), 3)} pu` })
  }
  return (
    <Chart
      series={[
        { id: 'svc', label: 'SVC at its limit: Q = B·V²', color: COLORS.svc, points: pts('svc') },
        { id: 'statcom', label: 'STATCOM at its limit: Q = I_max·V', color: COLORS.statcom, points: pts('statcom') },
      ]}
      markers={markers}
      vlines={v !== null ? [{ x: v, label: `V = ${fx(v, 3)} pu` }] : []}
      xLabel="Bus voltage V [pu]"
      yLabel="Maximum Q supplied [pu]"
      xDomain={[0, 1.1]}
      yDomain={[0, rating * 1.25]}
      height={height}
      label="Maximum capacitive output of an SVC and a STATCOM of equal rating against voltage"
      desc={`Both rated ${fx(rating, 2)} pu at 1 pu voltage.`}
    />
  )
}

/** TCR susceptance against firing angle, with the angle in use. */
export function TcrPlot({ alpha, height = 220 }: { alpha: number | null; height?: number }) {
  const pts = Array.from({ length: 91 }, (_, j) => [90 + j, tcrB(90 + j) as number] as [number, number])
  return (
    <Chart
      series={[{ id: 'b', label: 'B_TCR(α) / B_max = (2π − 2α + sin 2α)/π', color: COLORS.svc, points: pts }]}
      markers={alpha !== null ? [{ x: alpha, y: tcrB(alpha) as number, color: COLORS.op, label: `α = ${fx(alpha, 1)}°` }] : []}
      xLabel="Firing angle α from the voltage zero [°]"
      yLabel="B_TCR / B_max"
      xDomain={[90, 180]}
      yDomain={[0, 1.08]}
      height={height}
      label="Thyristor-controlled reactor susceptance against firing angle"
      desc={alpha !== null ? `Firing angle ${fx(alpha, 1)}°, susceptance ${fx(tcrB(alpha) as number, 3)} of the maximum.` : 'No firing angle in use.'}
    />
  )
}

// ── VSC: P–Q capability ──────────────────────────────────────────────────────────────────────────────────────

export function CapabilityPlot({
  vs,
  x,
  iMax,
  vcMax,
  p,
  q,
  title,
  ok,
  height = 300,
  width = 330,
}: {
  vs: number
  x: number
  iMax: number
  vcMax: number
  p: number
  q: number
  title: string
  ok: boolean
  height?: number
  width?: number
}) {
  const lim = vscLimits(vs, x, iMax, vcMax)
  const circ = (cp: number, cq: number, r: number) =>
    Array.from({ length: 121 }, (_, j) => [cp + r * Math.cos((2 * Math.PI * j) / 120), cq + r * Math.sin((2 * Math.PI * j) / 120)] as [number, number])
  const R = Math.max(1.3, lim.current.r * 1.25)
  return (
    <Chart
      series={[
        { id: 'cur', label: `current limit |S| ≤ V_s·I_max = ${fx(lim.current.r, 2)} pu`, color: 'var(--text-3)', points: circ(0, 0, lim.current.r), dashed: true },
        { id: 'volt', label: `voltage limit V_c ≤ ${fx(vcMax, 2)} pu`, color: 'var(--ps-b)', points: circ(lim.voltage.cp, lim.voltage.cq, lim.voltage.r), dashed: true },
        { id: 'cap', label: 'capability (inside both)', color: 'var(--ps-mv)', points: capabilityBoundary(vs, x, iMax, vcMax) },
      ]}
      markers={[{ x: p, y: q, color: ok ? COLORS.op : 'var(--critical)', shape: ok ? 'dot' : 'ring', label: ok ? `P ${fx(p, 2)}, Q ${fx(q, 2)}` : 'order: not deliverable' }]}
      xLabel="P to the grid [pu]"
      yLabel="Q to the grid [pu]"
      xDomain={[-R, R]}
      yDomain={[-R, R]}
      width={width}
      height={height}
      label={`${title}: P–Q capability`}
      desc={`${title}: order P ${fx(p, 3)} pu, Q ${fx(q, 3)} pu, ${ok ? 'inside' : 'outside'} the capability.`}
      className="hf-chart--square"
    />
  )
}
