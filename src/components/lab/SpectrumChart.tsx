import { useState } from 'react'
import { formatSI } from '../../utils/format.ts'

/**
 * Harmonic spectrum: SIMULATION as bars (blue), THEORY as ring markers. One series of bars plus a
 * marker set — identity never relies on colour alone (bars vs rings, legend, and a table view).
 */
export function SpectrumChart(props: {
  sim: Array<{ h: number; amp: number }>
  theory?: (h: number) => number | null
  unit: string
  /** Frequency of h = 1 [Hz], for the tooltip. */
  f1: number
  hMax?: number
  /** Hide h = 0 (the average). */
  skipDc?: boolean
  title?: string
  compact?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [log, setLog] = useState(false)
  const [table, setTable] = useState(false)
  const items = props.sim.filter((x) => x.h <= (props.hMax ?? Infinity) && (!props.skipDc || x.h > 0))
  const W = 640
  const H = props.compact ? 170 : 240
  const L = 52
  const B = 30
  const T = 14
  const max = Math.max(...items.map((x) => Math.max(x.amp, props.theory?.(x.h) ?? 0)), 1e-12)
  const floor = max * 1e-4
  const y = (v: number) => {
    const f = log ? (Math.log10(Math.max(v, floor)) - Math.log10(floor)) / (Math.log10(max) - Math.log10(floor)) : v / max
    return H - B - Math.max(0, f) * (H - B - T)
  }
  const n = items.length
  const bw = Math.max(1, Math.min(14, ((W - L - 10) / Math.max(n, 1)) * 0.7))
  const x = (i: number) => L + ((i + 0.5) * (W - L - 10)) / Math.max(n, 1)
  const hv = hover !== null ? items[hover] : null
  const step = Math.max(1, Math.ceil(n / 16))
  return (
    <div className="spectrum">
      <div className="spectrum-head">
        {props.title && <h3 className="eyebrow">{props.title}</h3>}
        <div className="seg seg--layout" role="radiogroup" aria-label="Scale">
          <button role="radio" aria-checked={!log} className={!log ? 'on' : ''} onClick={() => setLog(false)}>
            Linear
          </button>
          <button role="radio" aria-checked={log} className={log ? 'on' : ''} onClick={() => setLog(true)}>
            Log
          </button>
        </div>
        <button className="text-btn" onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {!table ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="spectrum-chart" role="img" aria-label="Harmonic spectrum: simulated amplitudes as bars, theory as rings" onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => {
            const v = log ? floor * (max / floor) ** f : f * max
            return (
              <g key={f}>
                <line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} className="grid" />
                <text x={L - 6} y={y(v) + 4} textAnchor="end" className="tick">
                  {formatSI(v, props.unit, { digits: 2 })}
                </text>
              </g>
            )
          })}
          {items.map((it, i) => {
            const th = props.theory?.(it.h)
            return (
              <g key={it.h} onMouseEnter={() => setHover(i)}>
                <rect x={x(i) - (W - L) / Math.max(n, 1) / 2} y={T} width={(W - L) / Math.max(n, 1)} height={H - B - T} fill="transparent" />
                <rect x={x(i) - bw / 2} y={y(it.amp)} width={bw} height={Math.max(0, H - B - y(it.amp))} rx={Math.min(3, bw / 2)} className={`spec-bar ${hover === i ? 'spec-bar--hi' : ''}`} />
                {th !== null && th !== undefined && th > floor && <circle cx={x(i)} cy={y(th)} r={4} className="spec-theory" />}
                {i % step === 0 && (
                  <text x={x(i)} y={H - B + 14} textAnchor="middle" className="tick">
                    {it.h}
                  </text>
                )}
              </g>
            )
          })}
          <text x={W - 10} y={H - 4} textAnchor="end" className="tick">
            harmonic order h
          </text>
          <g transform={`translate(${W - 200}, ${T + 4})`}>
            <rect x={0} y={-6} width={10} height={10} rx={2} className="spec-bar" />
            <text x={16} y={3} className="tick">
              SIMULATION
            </text>
            {props.theory && (
              <>
                <circle cx={110} cy={-1} r={4} className="spec-theory" />
                <text x={120} y={3} className="tick">
                  THEORY
                </text>
              </>
            )}
          </g>
        </svg>
      ) : (
        <div className="table-wrap spectrum-table">
          <table className="ba-table">
            <thead>
              <tr>
                <th>h</th>
                <th className="num">f</th>
                <th className="num">SIMULATION</th>
                {props.theory && <th className="num">THEORY</th>}
              </tr>
            </thead>
            <tbody>
              {items
                .filter((it) => it.amp > max * 1e-3 || (props.theory?.(it.h) ?? 0) > max * 1e-3)
                .map((it) => (
                  <tr key={it.h}>
                    <th>{it.h}</th>
                    <td className="num">{formatSI(it.h * props.f1, 'Hz')}</td>
                    <td className="num">{formatSI(it.amp, props.unit)}</td>
                    {props.theory && <td className="num">{(() => {
                      const th = props.theory(it.h)
                      return th === null ? '—' : formatSI(th, props.unit)
                    })()}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {hv && !table && (
        <p className="small spectrum-readout">
          h = {hv.h} ({formatSI(hv.h * props.f1, 'Hz')}): SIMULATION {formatSI(hv.amp, props.unit)}
          {props.theory && (() => {
            const th = props.theory(hv.h)
            return th === null ? ' · no closed form' : ` · THEORY ${formatSI(th, props.unit)}`
          })()}
        </p>
      )}
    </div>
  )
}
