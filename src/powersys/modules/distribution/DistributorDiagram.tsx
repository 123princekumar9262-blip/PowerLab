import type { KeyboardEvent } from 'react'
import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { profile, type DcDistributor, type DcOk } from './distributor.ts'
import { placeWords } from './words.ts'

/*
 * The two-wire DC distributor, drawn to scale. GEOMETRY: the loads sit at their distances from A (the inputs).
 * CALCULATED: the section currents (value and direction), the feed currents, the point of minimum potential and the
 * voltage profile below come from the solved distributor. When the inputs are invalid only the geometry is drawn.
 */

const W = 760
const XL = 112
const XR = 650
const SA = 50 // source A
const YT = 80 // outgoing conductor
const YB = 138 // return conductor

export function DistributorDiagram({ d, r, selected, onSelect, label }: { d: DcDistributor; r: DcOk | null; selected?: string | null; onSelect?(id: string): void; label?: string }) {
  const ring = d.feed === 'ring'
  const H = (ring ? 292 : 236) + (d.i > 0 ? 16 : 0)
  const X = (x: number) => XL + (Math.min(Math.max(x, 0), d.L) / d.L) * (XR - XL)
  const ticks = scaleTicks(d.L)
  const key = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(id)
    }
  }
  const sorted = [...d.loads].sort((a, b) => a.x - b.x)
  // labels of loads that are close together alternate between two rows
  const row = new Map<string, number>()
  sorted.forEach((l, k) => {
    const prev = sorted[k - 1]
    row.set(l.id, prev && X(l.x) - X(prev.x) < 84 && row.get(prev.id) === 0 ? 1 : 0)
  })
  const desc = r
    ? `${d.feed === 'one' ? 'Fed at A' : d.feed === 'both' ? 'Fed at both ends' : 'Ring main fed at A'}; loads ${sorted.map((l) => `${l.id} ${fx(l.I, 0)} A at ${fx(l.x, 0)} m`).join(', ')}; lowest voltage ${fx(r.minV, 2)} V ${placeWords(r.minKind, r.minX, r.minIds, d.L)}.`
    : 'Distributor geometry (no result: the inputs are invalid).'
  return (
    <figure className="ds-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label ?? 'Two-wire DC distributor, drawn to scale'}. ${desc}`}>
        <defs>
          <marker id="ds-arr-f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 10 5 0 10z" className="ds-arrowhead ds-arrowhead--f" />
          </marker>
          <marker id="ds-arr-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 10 5 0 10z" className="ds-arrowhead ds-arrowhead--b" />
          </marker>
        </defs>
        {/* uniform load: faint ticks between the conductors */}
        {d.i > 0 && Array.from({ length: Math.floor((XR - XL) / 9) }, (_, k) => XL + 4.5 + k * 9).map((x) => <line key={x} x1={x} x2={x} y1={YT + 4} y2={YB - 4} className="ds-uniform" />)}
        {/* the two conductors */}
        <line x1={XL} x2={XR} y1={YT} y2={YT} className="ds-rail" />
        <line x1={XL} x2={XR} y1={YB} y2={YB} className="ds-rail" />
        <text x={XL - 6} y={YT - 6} className="ds-rail-tag" textAnchor="end">
          +
        </text>
        <text x={XL - 6} y={YB + 14} className="ds-rail-tag" textAnchor="end">
          −
        </text>
        {/* source A */}
        <Source x={SA} label="A" v={d.VA} current={r ? r.IA : null} />
        <line x1={SA} x2={XL} y1={YT} y2={YT} className="ds-rail" />
        <line x1={SA} x2={XL} y1={YB} y2={YB} className="ds-rail" />
        {/* end B */}
        {d.feed === 'both' ? (
          <>
            <Source x={W - SA} label="B" v={d.VB} current={r ? r.IB : null} />
            <line x1={XR} x2={W - SA} y1={YT} y2={YT} className="ds-rail" />
            <line x1={XR} x2={W - SA} y1={YB} y2={YB} className="ds-rail" />
          </>
        ) : ring ? (
          <>
            <path d={`M${XR} ${YT} H ${XR + 86} V ${H - 12} H ${SA - 42} V ${YT} H ${SA}`} className="ds-ringpath" />
            <path d={`M${XR} ${YB} H ${XR + 74} V ${H - 24} H ${SA - 30} V ${YB} H ${SA}`} className="ds-ringpath" />
            <text x={(XL + XR) / 2} y={H - 32} className="ds-small" textAnchor="middle">
              both conductors continue round the ring back to A — drawn opened out (B is A)
            </text>
          </>
        ) : (
          <>
            <line x1={XR} x2={XR} y1={YT - 5} y2={YT + 5} className="ds-rail" />
            <line x1={XR} x2={XR} y1={YB - 5} y2={YB + 5} className="ds-rail" />
            <text x={XR + 12} y={(YT + YB) / 2 + 4} className="ds-end">
              B (open end)
            </text>
          </>
        )}
        {/* section currents (calculated) */}
        {r &&
          r.sections.map((s, k) => {
            const x0 = X(s.x0)
            const x1 = X(s.x1)
            const w = x1 - x0
            const mean = (s.Iin + s.Iout) / 2
            if (w < 30 || (Math.abs(s.Iin) < 1e-9 && Math.abs(s.Iout) < 1e-9)) return null
            const towardsB = mean >= 0
            const uniform = d.i > 0
            const txt = uniform ? `${fx(s.Iin, 1)} → ${fx(s.Iout, 1)} A` : `${fx(Math.abs(s.Iin), w < 70 ? 0 : 1)} A`
            const showTxt = uniform ? w >= 130 : true
            const cx = (x0 + x1) / 2
            return (
              <g key={k} className={`ds-sec ${towardsB ? 'is-fwd' : 'is-back'}`}>
                <line x1={towardsB ? cx - 12 : cx + 12} x2={towardsB ? cx + 12 : cx - 12} y1={YT - 12} y2={YT - 12} markerEnd={`url(#ds-arr-${towardsB ? 'f' : 'b'})`} className="ds-flow" />
                {showTxt && (
                  <text x={cx} y={YT - 22} textAnchor="middle" className="ds-sec-label">
                    {txt}
                  </text>
                )}
              </g>
            )
          })}
        {/* loads (geometry: their positions are the inputs) */}
        {sorted.map((l) => {
          const x = X(l.x)
          const on = selected === l.id
          const ry = row.get(l.id) ? 16 : 0
          return (
            <g
              key={l.id}
              className={`ds-load ${on ? 'is-on' : ''} ${onSelect ? 'is-click' : ''}`}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `Select load ${l.id}: ${fx(l.I, 0)} A at ${fx(l.x, 0)} m` : undefined}
              aria-pressed={onSelect ? on : undefined}
              onClick={onSelect ? () => onSelect(l.id) : undefined}
              onKeyDown={onSelect ? key(l.id) : undefined}
            >
              <rect x={x - 14} y={YT - 2} width={28} height={YB - YT + 4} className="ds-hit" />
              <line x1={x} x2={x} y1={YT} y2={(YT + YB) / 2 - 10} className="ds-lead" />
              <line x1={x} x2={x} y1={(YT + YB) / 2 + 10} y2={YB} className="ds-lead" />
              <rect x={x - 7} y={(YT + YB) / 2 - 10} width={14} height={20} rx={2} className="ds-loadbox" />
              <circle cx={x} cy={YT} r={2.6} className="ds-tap" />
              <circle cx={x} cy={YB} r={2.6} className="ds-tap" />
              <text x={x} y={YB + 22 + ry} textAnchor="middle" className="ds-load-label">
                {l.id} · {fx(l.I, 0)} A
              </text>
            </g>
          )
        })}
        {/* the point of minimum potential (calculated) */}
        {r && (
          <g className="ds-min">
            <line x1={X(r.minX)} x2={X(r.minX)} y1={22} y2={YB} className="ds-min-line" />
            <circle cx={X(r.minX)} cy={YT} r={5.5} className="ds-min-dot" />
            <text x={Math.min(Math.max(X(r.minX), XL + 130), XR - 110)} y={16} textAnchor="middle" className="ds-min-label">
              ▼ lowest voltage {fx(r.minV, 2)} V at {fx(r.minX, r.minKind === 'between' ? 1 : 0)} m
            </text>
          </g>
        )}
        {/* the scale */}
        <g className="ds-scale">
          <line x1={XL} x2={XR} y1={YB + 56} y2={YB + 56} />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={YB + 52} y2={YB + 60} />
              <text x={X(t)} y={YB + 72} textAnchor="middle">
                {fx(t, 0)}
              </text>
            </g>
          ))}
          <text x={XR + 10} y={YB + 60} className="ds-small">
            m from A
          </text>
          <text x={XL} y={YB + 90} className="ds-small">
            {`Top line: outgoing conductor (+); bottom: return conductor (−); each ${fx(d.rCond, 2)} Ω/km.`}
          </text>
          {d.i > 0 && (
            <text x={XL} y={YB + 106} className="ds-small">
              {`Light ticks between the conductors: a uniform load of ${fx(d.i, 2)} A/m.`}
            </text>
          )}
        </g>
      </svg>
    </figure>
  )
}

function Source({ x, label, v, current }: { x: number; label: string; v: number; current: number | null }) {
  const cy = (YT + YB) / 2
  const left = x < W / 2
  const tx = left ? 4 : W - 4
  const anchor = left ? 'start' : 'end'
  return (
    <g className="ds-source">
      <line x1={x} x2={x} y1={YT} y2={cy - 16} className="ds-rail" />
      <line x1={x} x2={x} y1={cy + 16} y2={YB} className="ds-rail" />
      <circle cx={x} cy={cy} r={16} className="ds-src" />
      <text x={x} y={cy + 4} textAnchor="middle" className="ds-src-sym">
        DC
      </text>
      <text x={tx} y={YT - 36} textAnchor={anchor} className="ds-src-label">
        {label} · {fx(v, 1)} V
      </text>
      {current !== null && (
        <text x={tx} y={YT - 20} textAnchor={anchor} className="ds-src-current">
          I_{label} = {fx(current, 2)} A
        </text>
      )}
    </g>
  )
}

function scaleTicks(L: number): number[] {
  const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => L / s <= 8) ?? 1000
  const out: number[] = []
  for (let v = 0; v <= L + 1e-9; v += step) out.push(v)
  if (out[out.length - 1] < L - 1e-9) out.push(L)
  return out.filter((v, k, a) => k === a.length - 1 || L - v > step * 0.35 || v === L)
}

/** The voltage along the distributor (calculated), with the lowest point marked. */
export function VoltageProfile({ d, r, height = 220 }: { d: DcDistributor; r: DcOk; height?: number }) {
  const pts = profile(d, r)
  const vs = pts.map((p) => p[1])
  const lo = Math.min(...vs)
  const hi = Math.max(d.VA, d.feed === 'both' ? d.VB : d.VA, ...vs)
  const pad = Math.max(0.2, (hi - lo) * 0.12)
  return (
    <Plot
      label={`Voltage between the conductors along the distributor; lowest ${fx(r.minV, 2)} V at ${fx(r.minX, 1)} m`}
      series={[{ id: 'v', label: 'V(x)', color: 'var(--ps-c)', points: pts }]}
      vlines={[{ x: r.minX, label: `lowest ${fx(r.minV, 2)} V` }]}
      xLabel="Distance from A [m]"
      yLabel="Voltage [V]"
      xDomain={[0, d.L]}
      yDomain={[lo - pad, hi + pad]}
      height={height}
    />
  )
}
