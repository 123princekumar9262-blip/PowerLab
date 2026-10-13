import { useId } from 'react'
import { fx, sg } from '../../ui/format.ts'
import { deg, type PowerLimits } from './swing.ts'

/*
 * The power–angle chart: P_e = P_max·sin δ for the pre-fault, during-fault and post-fault networks, the mechanical
 * power P_m, the equal areas A1 (accelerating) and A2 (decelerating), markers for δ0, δ_c, δ_cr and δ_max, the path
 * the operating point has followed and where it is now. Same visual language as the shared Plot (ps-plot-*).
 */

export interface PdMarker {
  /** angle [rad] */
  d: number
  label: string
  strong?: boolean
}

export interface PowerAngleChartProps {
  lim: PowerLimits
  Pm: number
  /** which curves to draw */
  curves?: { pre?: boolean; during?: boolean; post?: boolean }
  /** equal areas: from δ0 to δc (A1) and δc to δ2 (A2 used), δ2 to δmax (A2 still available) */
  areas?: { d0: number; dc: number; d2: number; dMax: number; lost: boolean } | null
  markers?: PdMarker[]
  /** the operating point's path so far: angle [rad] and P_e [pu] */
  path?: { d: number[]; pe: number[] }
  /** the operating point now */
  point?: { d: number; pe: number } | null
  height?: number
  label: string
  /** y-axis top [pu] (defaults to 1.3 × the largest P_max) */
  yMax?: number
}

const W = 640
const XMAX = 180

export function PowerAngleChart({ lim, Pm, curves = { pre: true, during: true, post: true }, areas, markers = [], path, point, height = 300, label, yMax }: PowerAngleChartProps) {
  const H = height
  const m = { l: 52, r: 18, t: 14, b: 38 }
  const top = yMax ?? Math.max(lim.P1, lim.P3, Pm) * 1.3
  const X = (dDeg: number) => m.l + (dDeg / XMAX) * (W - m.l - m.r)
  const Y = (p: number) => H - m.b - (p / top) * (H - m.t - m.b)
  const clip = useId()
  const curve = (pmax: number) => {
    let s = ''
    for (let a = 0; a <= XMAX; a += 1) s += `${a ? 'L' : 'M'}${X(a).toFixed(1)} ${Y(pmax * Math.sin((a * Math.PI) / 180)).toFixed(1)}`
    return s
  }
  // a filled region between y = f(δ) and y = g(δ) for δ in [a, b] (radians)
  const region = (a: number, b: number, upper: (d: number) => number, lower: (d: number) => number) => {
    if (!(b > a)) return ''
    const n = Math.max(2, Math.ceil(deg(b - a)))
    const up: string[] = []
    const lo: string[] = []
    for (let i = 0; i <= n; i++) {
      const d = a + ((b - a) * i) / n
      up.push(`${X(deg(d)).toFixed(1)} ${Y(upper(d)).toFixed(1)}`)
      lo.push(`${X(deg(d)).toFixed(1)} ${Y(lower(d)).toFixed(1)}`)
    }
    return `M${up.join('L')}L${lo.reverse().join('L')}Z`
  }
  const yt = ticksOf(top)
  const xt = [0, 30, 60, 90, 120, 150, 180]
  const pmLine = () => Pm
  const p2 = (d: number) => lim.P2 * Math.sin(d)
  const p3 = (d: number) => lim.P3 * Math.sin(d)
  // curve labels just above each peak (at 90°), the during-fault one at the axis when P2 = 0
  const curveLabels: Array<{ y: number; text: string; cls: string }> = []
  if (curves.pre) curveLabels.push({ y: lim.P1, text: `pre-fault  P₁ = ${fx(lim.P1, 2)}`, cls: 'pre' })
  if (curves.post) curveLabels.push({ y: lim.P3, text: `post-fault  P₃ = ${fx(lim.P3, 2)}`, cls: 'post' })
  if (curves.during) curveLabels.push({ y: lim.P2, text: lim.P2 > 0 ? `during fault  P₂ = ${fx(lim.P2, 2)}` : 'during fault  P_e = 0', cls: 'during' })
  // marker labels stacked so that close angles do not collide
  const ms = [...markers].filter((k) => Number.isFinite(k.d) && deg(k.d) >= 0 && deg(k.d) <= XMAX).sort((a, b) => a.d - b.d)
  const rows: number[] = []
  const placed = ms.map((k) => {
    const x = X(deg(k.d))
    let row = 0
    while (rows[row] !== undefined && x < rows[row] + 6) row++
    rows[row] = x + 3 + k.label.length * 6.2
    return { ...k, x, row }
  })
  const a1 = areas ? region(areas.d0, areas.dc, pmLine, p2) : ''
  const a2 = areas ? region(areas.dc, Math.min(areas.d2, Number.isFinite(areas.dMax) ? areas.dMax : areas.d2), p3, pmLine) : ''
  const a2rest = areas && !areas.lost && Number.isFinite(areas.dMax) ? region(areas.d2, areas.dMax, p3, pmLine) : ''
  const centroid = (a: number, b: number, f: (d: number) => number, g: (d: number) => number) => {
    const mid = (a + b) / 2
    return { x: X(deg(mid)), y: Y((f(mid) + g(mid)) / 2) }
  }
  const c1 = areas && areas.dc > areas.d0 ? centroid(areas.d0, areas.dc, pmLine, p2) : null
  const c2 = areas && areas.d2 > areas.dc ? centroid(areas.dc, Math.min(areas.d2, Number.isFinite(areas.dMax) ? areas.dMax : areas.d2), p3, pmLine) : null
  return (
    <figure className="ps-plot ps-st-pd">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
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
          <g key={`x${v}`}>
            {v > 0 && v < XMAX && <line x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} className="ps-plot-grid" />}
            <text x={X(v)} y={H - m.b + 15} className="ps-plot-tick" textAnchor="middle">
              {v}
            </text>
          </g>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 4} className="ps-plot-axis" textAnchor="middle">
          Rotor angle δ [°]
        </text>
        <text x={12} y={(m.t + H - m.b) / 2} className="ps-plot-axis" textAnchor="middle" transform={`rotate(-90 12 ${(m.t + H - m.b) / 2})`}>
          Power [pu]
        </text>
        <g clipPath={`url(#${clip})`}>
          {a1 && <path d={a1} className="ps-st-area ps-st-area--acc" />}
          {a2 && <path d={a2} className="ps-st-area ps-st-area--dec" />}
          {a2rest && <path d={a2rest} className="ps-st-area ps-st-area--spare" />}
          {curves.pre && <path d={curve(lim.P1)} className="ps-plot-line ps-st-c-pre" />}
          {curves.post && <path d={curve(lim.P3)} className="ps-plot-line ps-st-c-post" />}
          {curves.during && <path d={curve(lim.P2)} className="ps-plot-line ps-st-c-during" strokeDasharray="6 4" />}
          <line x1={m.l} x2={W - m.r} y1={Y(Pm)} y2={Y(Pm)} className="ps-st-pm" />
          {path && path.d.length > 1 && <path d={path.d.map((d, i) => `${i ? 'L' : 'M'}${X(deg(d)).toFixed(1)} ${Y(path.pe[i]).toFixed(1)}`).join('')} className="ps-st-trace" />}
        </g>
        {placed.map((k) => (
          <g key={k.label}>
            <line x1={k.x} x2={k.x} y1={m.t} y2={H - m.b} className={k.strong ? 'ps-st-mark ps-st-mark--strong' : 'ps-st-mark'} />
            <text x={k.x + 3} y={m.t + 11 + k.row * 13} className="ps-plot-note">
              {k.label}
            </text>
          </g>
        ))}
        {curveLabels.map((c) =>
          c.y > 0 ? (
            <text key={c.cls} x={X(90)} y={Y(c.y) - 6} className={`ps-st-clabel ps-st-clabel--${c.cls}`} textAnchor="middle">
              {c.text}
            </text>
          ) : (
            <text key={c.cls} x={X(176)} y={Y(0) - 6} className={`ps-st-clabel ps-st-clabel--${c.cls}`} textAnchor="end">
              {c.text}
            </text>
          ),
        )}
        <text x={X(177)} y={Y(Pm) - 6} className="ps-st-clabel ps-st-clabel--pm" textAnchor="end">
          P_m = {fx(Pm, 2)}
        </text>
        {c1 && (
          <text x={c1.x} y={c1.y + 4} className="ps-st-alabel" textAnchor="middle">
            A₁
          </text>
        )}
        {c2 && (
          <text x={c2.x} y={c2.y + 4} className="ps-st-alabel" textAnchor="middle">
            A₂
          </text>
        )}
        {point && Number.isFinite(point.d) && deg(point.d) <= XMAX && <circle cx={X(deg(point.d))} cy={Y(point.pe)} r={6} className="ps-st-point" />}
      </svg>
      <figcaption className="ps-plot-foot">
        <ul className="ps-plot-legend">
          {curves.pre && (
            <li>
              <span className="ps-plot-key ps-st-key-pre" aria-hidden="true" />
              Pre-fault (both lines)
            </li>
          )}
          {curves.during && (
            <li>
              <span className="ps-plot-key ps-st-key-during" aria-hidden="true" />
              During the fault
            </li>
          )}
          {curves.post && (
            <li>
              <span className="ps-plot-key ps-st-key-post" aria-hidden="true" />
              Post-fault (line 2 open)
            </li>
          )}
          <li>
            <span className="ps-plot-key ps-st-key-pm" aria-hidden="true" />
            Mechanical power P_m
          </li>
          {areas && (
            <>
              <li>
                <span className="ps-st-swatch ps-st-area--acc" aria-hidden="true" />
                A₁ accelerating
              </li>
              <li>
                <span className="ps-st-swatch ps-st-area--dec" aria-hidden="true" />
                A₂ decelerating{a2rest ? ' (used / still available)' : ''}
              </li>
            </>
          )}
          {point && (
            <li>
              <span className="ps-st-dot" aria-hidden="true" />
              Operating point
            </li>
          )}
        </ul>
      </figcaption>
    </figure>
  )
}

function ticksOf(top: number): number[] {
  const step = top > 2 ? 0.5 : top > 1 ? 0.25 : 0.2
  const out: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}
