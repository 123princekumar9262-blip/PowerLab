import { fx } from './format.ts'

/**
 * A phasor diagram: arrows from the origin (or tip-to-tail from another phasor), the real axis to the right and
 * angles counter-clockwise (leading) — the standard convention. Each arrow names itself at its tip; colours come
 * from CSS variables per phasor. Scaled to the largest magnitude unless `scale` is given.
 */
export interface Phasor {
  id: string
  label: string
  re: number
  im: number
  color: string
  /** Start the arrow at this point (tip-to-tail); default the origin. */
  from?: { re: number; im: number }
  dashed?: boolean
  /** Thinner, for construction lines. */
  thin?: boolean
}

export function Phasors({ phasors, label, size = 260, scale, showCircle = true, unit }: { phasors: Phasor[]; label: string; size?: number; scale?: number; showCircle?: boolean; unit?: string }) {
  const R = size / 2 - 34
  const maxMag = scale ?? Math.max(1e-9, ...phasors.map((p) => Math.hypot(p.re + (p.from?.re ?? 0), p.im + (p.from?.im ?? 0))), ...phasors.map((p) => Math.hypot(p.from?.re ?? 0, p.from?.im ?? 0)))
  const k = R / maxMag
  const c = size / 2
  const P = (re: number, im: number) => ({ x: c + re * k, y: c - im * k })
  return (
    <figure className="ps-phasors">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: ${phasors.map((p) => `${p.label} ${fx(Math.hypot(p.re, p.im), 3)} at ${fx((Math.atan2(p.im, p.re) * 180) / Math.PI, 1)} degrees`).join('; ')}`}
      >
        <defs>
          {phasors.map((p) => (
            <marker key={p.id} id={`ph-${p.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 10 5 0 10z" style={{ fill: p.color }} />
            </marker>
          ))}
        </defs>
        {showCircle && <circle cx={c} cy={c} r={R} className="ps-ph-circle" />}
        <line x1={8} x2={size - 8} y1={c} y2={c} className="ps-ph-axis" />
        <line x1={c} x2={c} y1={8} y2={size - 8} className="ps-ph-axis" />
        <text x={size - 10} y={c - 6} className="ps-ph-axislabel" textAnchor="end">
          Re
        </text>
        <text x={c + 6} y={16} className="ps-ph-axislabel">
          Im
        </text>
        {phasors.map((p) => {
          if (Math.hypot(p.re, p.im) < 1e-9) return null
          const a = P(p.from?.re ?? 0, p.from?.im ?? 0)
          const b = P((p.from?.re ?? 0) + p.re, (p.from?.im ?? 0) + p.im)
          const len = Math.hypot(b.x - a.x, b.y - a.y)
          const ux = len ? (b.x - a.x) / len : 0
          const uy = len ? (b.y - a.y) / len : 0
          return (
            <g key={p.id}>
              {len > 1 && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`ps-ph-arrow ${p.thin ? 'is-thin' : ''}`}
                  style={{ stroke: p.color }}
                  strokeDasharray={p.dashed ? '4 3' : undefined}
                  markerEnd={`url(#ph-${p.id})`}
                />
              )}
              <text x={b.x + ux * 10} y={b.y + uy * 10 + 4} className="ps-ph-label" textAnchor={ux < -0.3 ? 'end' : ux > 0.3 ? 'start' : 'middle'}>
                {p.label}
              </text>
            </g>
          )
        })}
      </svg>
      {unit && (
        <figcaption className="small muted">
          Scale: circle = {fx(maxMag, 3)} {unit}
        </figcaption>
      )}
    </figure>
  )
}
