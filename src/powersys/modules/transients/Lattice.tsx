import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fx } from '../../ui/format.ts'
import { arrivals, isStepLike, latticeSegments, type Field } from './waves.ts'

/*
 * The Bewley lattice diagram: distance across, time DOWN. Each zig-zag segment is one travelling wave; its label is
 * the wave's value (step-like surges: kV, from the solution) or its multiplier of the first wave (other surges, linear
 * ends). The margins give the voltage at each end after each arrival. A horizontal cursor marks the chosen time
 * (click, drag or ↑/↓ to move it); the dashed vertical is the probe, its dots the instants waves reach it.
 */

export function Lattice({ f, t, onT, probeX, height = 380 }: { f: Field; t: number; onT?(t: number): void; probeX: number; height?: number }) {
  const an = f.an
  const W = 640
  const H = height
  const m = { l: 112, r: 112, t: 34, b: 14 }
  const L = an.lengthM
  const X = (x: number) => m.l + (x / L) * (W - m.l - m.r)
  const Y = (tt: number) => m.t + (tt / an.window) * (H - m.t - m.b)
  const segs = latticeSegments(f)
  const step = isStepLike(an.model.surge)
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState(false)
  const toT = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect()
    const py = ((e.clientY - r.top) / r.height) * H
    return Math.min(an.window, Math.max(0, ((py - m.t) / (H - m.t - m.b)) * an.window))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!onT) return
    const d = an.window / (e.shiftKey ? 16 : 160)
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = t + d
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = t - d
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = an.window
    if (next !== null) {
      e.preventDefault()
      onT(Math.min(an.window, Math.max(0, next)))
    }
  }
  // where the newest front is at time t (the segment containing t)
  const active = segs.find((s) => t >= s.t0 && t < s.t1)
  const front = active ? active.x0 + ((active.x1 - active.x0) * (t - active.t0)) / (active.t1 - active.t0) : null
  const hits = arrivals(an, probeX)
  const label = (s: (typeof segs)[number]) => (s.value !== null ? `${s.value >= 0 ? '+' : ''}${fx(s.value, 0)} kV` : s.mult !== null ? `×${fx(s.mult, 3)}` : '')
  const endVals = step ? Array.from({ length: Math.floor((an.window / an.T - 1) / 2) + 1 }, (_, n) => (2 * n + 1) * an.T).filter((tt) => tt <= an.window + 1e-9) : []
  const srcVals = step ? Array.from({ length: Math.floor(an.window / an.T / 2) + 1 }, (_, n) => 2 * n * an.T).filter((tt) => tt <= an.window - 1e-9) : []
  return (
    <figure className="tr-lattice" data-front={front === null ? '' : (front / 1000).toFixed(4)}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role={onT ? 'slider' : 'img'}
        aria-label="Bewley lattice diagram: distance across, time down. Choose a time with the arrow keys or by clicking."
        aria-valuemin={onT ? 0 : undefined}
        aria-valuemax={onT ? Number(an.window.toFixed(3)) : undefined}
        aria-valuenow={onT ? Number(t.toFixed(3)) : undefined}
        aria-valuetext={onT ? `t = ${fx(t, 2)} µs` : undefined}
        tabIndex={onT ? 0 : undefined}
        className={onT ? 'is-interactive' : undefined}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if (!onT) return
          svg.current?.setPointerCapture?.(e.pointerId)
          setDrag(true)
          onT(toT(e))
        }}
        onPointerMove={(e) => drag && onT?.(toT(e))}
        onPointerUp={() => setDrag(false)}
        onPointerLeave={() => setDrag(false)}
      >
        {/* the two ends */}
        <line x1={X(0)} x2={X(0)} y1={m.t} y2={H - m.b} className="tr-lat-end" />
        <line x1={X(L)} x2={X(L)} y1={m.t} y2={H - m.b} className="tr-lat-end" />
        <text x={X(0)} y={14} textAnchor="middle" className="tr-lat-head">
          source · Γ_s {fx(an.gammaS, 3)}
        </text>
        <text x={X(L)} y={14} textAnchor="middle" className="tr-lat-head">
          end · Γ_L {fx(an.gammaL, 3)}
          {an.model.arrester ? ' + arrester' : ''}
        </text>
        <text x={(X(0) + X(L)) / 2} y={28} textAnchor="middle" className="tr-lat-sub">
          x → (ℓ = {fx(an.model.lengthKm, 1)} km) · time ↓ (T = {fx(an.T, 2)} µs)
        </text>
        {/* time ticks every travel time */}
        {Array.from({ length: Math.round(an.window / an.T) + 1 }, (_, k) => k).map((k) => (
          <line key={k} x1={X(0) - 4} x2={X(L) + 4} y1={Y(k * an.T)} y2={Y(k * an.T)} className="tr-lat-grid" />
        ))}
        {/* the waves */}
        {segs.map((s, k) => {
          const xm = (X(s.x0) + X(s.x1)) / 2
          const ym = (Y(s.t0) + Y(s.t1)) / 2
          const isActive = s === active
          return (
            <g key={k} className={`tr-lat-seg tr-lat-seg--${s.dir} ${isActive ? 'is-active' : ''}`}>
              <line x1={X(s.x0)} y1={Y(s.t0)} x2={X(s.x1)} y2={Y(s.t1)} />
              <text x={xm + (s.dir === 'fwd' ? 10 : -10)} y={ym - 4} textAnchor={s.dir === 'fwd' ? 'start' : 'end'}>
                {label(s)}
              </text>
            </g>
          )
        })}
        {/* end and source voltages after each arrival (step-like surges: exact) */}
        {endVals.map((tt) => (
          <text key={`e${tt}`} x={X(L) + 8} y={Y(tt) + 4} className="tr-lat-node">
            {fx(tt / an.T, 0)}T → {fx(f.v(L, tt + an.T), 0)} kV
          </text>
        ))}
        {srcVals.map((tt) => (
          <text key={`s${tt}`} x={X(0) - 8} y={Y(tt) + 4} textAnchor="end" className="tr-lat-node">
            {fx(f.v(0, tt + an.T), 0)} kV ← {fx(tt / an.T, 0)}T
          </text>
        ))}
        {/* the probe and the instants waves reach it */}
        <line x1={X(probeX)} x2={X(probeX)} y1={m.t} y2={H - m.b} className="tr-lat-probe" />
        {hits.map((h, k) => (
          <circle key={k} cx={X(probeX)} cy={Y(h.t)} r={3.2} className="tr-lat-hit" />
        ))}
        {/* the chosen time and where the newest front is */}
        <line x1={X(0)} x2={X(L)} y1={Y(t)} y2={Y(t)} className="tr-lat-cursor" />
        <text x={X(L) - 4} y={Y(t) - 5} textAnchor="end" className="tr-lat-cursor-text">
          t = {fx(t, 2)} µs
        </text>
        {front !== null && <circle cx={X(front)} cy={Y(t)} r={5} className="tr-lat-front" />}
      </svg>
      <figcaption className="small muted">
        {step
          ? 'Labels: each wave’s value. Margins: the voltage at that end after each arrival.'
          : an.model.arrester
            ? 'The arrester is non-linear and this surge is not a step, so a reflected wave is not a fixed multiple of the incident one: the diagram shows the timing; the voltages come from the solution (plots).'
            : 'Labels: each wave as a multiple of the first launched wave k·e(t). The voltage at a point is the sum of the shifted waves that have reached it (the plots).'}{' '}
        Dots: the instants a wave reaches the probe.
      </figcaption>
    </figure>
  )
}
