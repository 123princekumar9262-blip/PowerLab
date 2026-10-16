import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { kelvinArea, kelvinCost, type KelvinInput } from './kelvin.ts'
import { annualCost, type PfOk, type Tariff } from './pf.ts'

/*
 * The power triangle and the cost curves are CALCULATED (drawn to scale from the model's numbers). The grid
 * structure and the three layouts are CONCEPTUAL illustrations and say so.
 */

/** Power triangles before and after correction, on one set of axes, to scale. */
export function PowerTriangle({ P, r, height = 300 }: { P: number; r: PfOk; height?: number }) {
  const W = 460
  const H = height
  const up = Math.max(r.Q1, r.Q2, 0)
  const down = Math.max(0, -r.Q2)
  const k = Math.min((W - 170) / P, (H - 64) / (up + down || 1))
  const x0 = 40
  const y0 = 30 + up * k
  const px = x0 + P * k
  const y1 = y0 - r.Q1 * k
  const y2 = y0 - r.Q2 * k
  const arc = (phi: number, rad: number) => {
    const ex = x0 + rad * Math.cos(phi)
    const ey = y0 - rad * Math.sin(phi)
    return `M${x0 + rad} ${y0} A ${rad} ${rad} 0 0 ${phi >= 0 ? 0 : 1} ${ex.toFixed(1)} ${ey.toFixed(1)}`
  }
  const same = Math.abs(r.Qc) < 1e-9
  const lead = r.Q2 < -1e-9
  return (
    <figure className="ds-tri">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Power triangle to scale: P ${fx(P, 1)} kW; before Q ${fx(r.Q1, 1)} kVAr, S ${fx(r.S1, 1)} kVA; after Q ${fx(r.Q2, 1)} kVAr, S ${fx(r.S2, 1)} kVA; capacitor bank ${fx(r.Qc, 1)} kVAr.`}
      >
        <line x1={x0} x2={px} y1={y0} y2={y0} className="ds-tri-p" />
        <text x={lead ? px - 6 : (x0 + px) / 2} y={y0 + (lead ? -8 : 18)} textAnchor={lead ? 'end' : 'middle'} className="ds-tri-label">
          P = {fx(P, 1)} kW
        </text>
        <line x1={x0} x2={px} y1={y0} y2={y1} className="ds-tri-s1" />
        <line x1={px} x2={px} y1={y0} y2={y1} className="ds-tri-q1" />
        {!same && <line x1={x0} x2={px} y1={y0} y2={y2} className="ds-tri-s2" />}
        {!same && <line x1={px} x2={px} y1={y1} y2={y2} className="ds-tri-qc" />}
        <path d={arc(r.phi1, 46)} className="ds-tri-arc ds-tri-arc--1" />
        {!same && Math.abs(r.phi2) > 0.01 && <path d={arc(r.phi2, 70)} className="ds-tri-arc ds-tri-arc--2" />}
        <text x={x0 + 50} y={y0 - 6 - Math.sin(r.phi1 / 2) * 20} className="ds-tri-ang ds-tri-ang--1">
          φ₁ {fx((r.phi1 * 180) / Math.PI, 1)}°
        </text>
        {!same && Math.abs(r.phi2) > 0.01 && (
          <text x={x0 + 76} y={y0 + (r.phi2 >= 0 ? -4 : 14)} className="ds-tri-ang ds-tri-ang--2">
            φ₂ {fx((Math.abs(r.phi2) * 180) / Math.PI, 1)}°{lead ? ' lead' : ''}
          </text>
        )}
        <text x={(x0 + px) / 2 - 14} y={(y0 + y1) / 2 - 10} textAnchor="end" className="ds-tri-label ds-tri-label--1">
          S₁ = {fx(r.S1, 1)} kVA
        </text>
        {!same && (
          <text x={(x0 + px) / 2 + 30} y={(y0 + y2) / 2 + (lead ? 18 : 16)} textAnchor="start" className="ds-tri-label ds-tri-label--2">
            S₂ = {fx(r.S2, 1)} kVA
          </text>
        )}
        <text x={px + 8} y={same ? (y0 + y1) / 2 + 4 : y1 + 4} className="ds-tri-label ds-tri-label--1">
          Q₁ = {fx(r.Q1, 1)} kVAr
        </text>
        {!same && Math.abs(y1 - y2) > 34 && (
          <text x={px + 8} y={(y1 + y2) / 2 + 4} className="ds-tri-label ds-tri-label--c">
            Q_c = {fx(r.Qc, 1)} kVAr
          </text>
        )}
        {!same && Math.abs(y0 - y2) > 18 && (
          <text x={px + 8} y={(y0 + y2) / 2 + 4} className="ds-tri-label ds-tri-label--2">
            Q₂ = {fx(r.Q2, 1)} kVAr
          </text>
        )}
      </svg>
      <figcaption className="small muted">
        Drawn to scale. <span className="ds-key ds-key--1" aria-hidden="true" /> before · <span className="ds-key ds-key--2" aria-hidden="true" /> after ·{' '}
        <span className="ds-key ds-key--c" aria-hidden="true" /> supplied by the capacitor bank
      </figcaption>
    </figure>
  )
}

/** Annual cost against the final (lagging) power factor: kVA charge, capacitors and their sum (thousands of ₹). */
export function PfCostChart({ P, pf1, t, econ, target, height = 240, zoom = false }: { P: number; pf1: number; t: Tariff; econ: number; target: number | null; height?: number; zoom?: boolean }) {
  const n = 120
  const pts = Array.from({ length: n + 1 }, (_, k) => pf1 + ((1 - pf1) * k) / n)
  const c = pts.map((pf) => annualCost(P, pf1, pf, t))
  const v: Array<{ x: number; label: string }> = [{ x: econ, label: `cheapest ${fx(econ, 3)}` }]
  if (target !== null && target >= pf1 && Math.abs(target - econ) > (1 - pf1) * 0.04) v.push({ x: target, label: `your target ${fx(target, 3)}` })
  return (
    <Plot
      label={`Annual cost against the final power factor; cheapest at ${fx(econ, 3)} lagging`}
      series={[
        { id: 'tot', label: 'Total', color: 'var(--ps-sel)', points: pts.map((pf, k) => [pf, c[k].total / 1000]) },
        ...(zoom
          ? []
          : [
              { id: 'kva', label: 'kVA charge', color: 'var(--ps-a)', points: pts.map((pf, k) => [pf, c[k].kva / 1000] as [number, number]), dashed: true },
              { id: 'cap', label: 'Capacitors', color: 'var(--ps-c)', points: pts.map((pf, k) => [pf, c[k].cap / 1000] as [number, number]), dashed: true },
            ]),
      ]}
      vlines={v}
      xLabel="Final power factor (lagging)"
      yLabel="₹ thousand per year"
      xDomain={[pf1, 1]}
      yDomain={zoom ? zoomDomain(c.map((x) => x.total / 1000)) : [0, (Math.max(...c.map((x) => x.total)) / 1000) * 1.08]}
      height={height}
    />
  )
}

function zoomDomain(v: number[]): [number, number] {
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const pad = Math.max(1e-6, (hi - lo) * 0.08)
  return [lo - pad, hi + pad]
}

/** Kelvin's law: annual capital charge, cost of losses and total against the cross-section (per km, per conductor). */
export function KelvinChart({ q, height = 240 }: { q: KelvinInput; height?: number }) {
  const a0 = kelvinArea(q)
  const n = 160
  const xs = Array.from({ length: n + 1 }, (_, k) => a0 * (0.2 + (2.8 * k) / n))
  const c = xs.map((a) => kelvinCost(q, a))
  const at = kelvinCost(q, a0)
  return (
    <Plot
      label={`Annual cost per km of conductor against its cross-section; least at ${fx(a0, 1)} mm²`}
      series={[
        { id: 'tot', label: 'Total', color: 'var(--ps-sel)', points: xs.map((a, k) => [a, c[k].total / 1000]) },
        { id: 'cap', label: 'Capital charge', color: 'var(--ps-c)', points: xs.map((a, k) => [a, c[k].capital / 1000]), dashed: true },
        { id: 'en', label: 'Energy lost', color: 'var(--ps-a)', points: xs.map((a, k) => [a, c[k].energy / 1000]), dashed: true },
      ]}
      vlines={[{ x: a0, label: `a* = ${fx(a0, 1)} mm², total ₹${fx(at.total / 1000, 1)} thousand/yr` }]}
      xLabel="Conductor cross-section a [mm²]"
      yLabel="₹ thousand per km per year"
      xDomain={[xs[0], xs[n]]}
      yDomain={[0, Math.min(Math.max(...c.map((x) => x.total)), at.total * 2.6) / 1000]}
      height={height}
    />
  )
}

/** CONCEPTUAL: substation → feeders → distributors → service mains. */
export function StructureDiagram() {
  const houses = [0, 1, 2, 3, 4]
  return (
    <svg
      viewBox="0 0 900 268"
      className="ds-struct"
      role="img"
      aria-label="Illustration: a distribution substation sends power along feeders to feeding points; distributors run along the streets and service mains connect each consumer."
    >
      {/* substation */}
      <rect x={20} y={88} width={120} height={74} rx={8} className="ds-struct-box" />
      <circle cx={64} cy={125} r={16} className="ds-struct-tx" />
      <circle cx={84} cy={125} r={16} className="ds-struct-tx" />
      <text x={80} y={180} textAnchor="middle" className="ds-struct-label">
        Distribution substation
      </text>
      <text x={80} y={196} textAnchor="middle" className="ds-small">
        11 kV → 400 V
      </text>
      {/* feeders: no tappings */}
      <path d="M140 110 H 360" className="ds-struct-feeder" />
      <path d="M140 140 C 220 140 240 236 360 236" className="ds-struct-feeder" />
      <text x={240} y={100} textAnchor="middle" className="ds-struct-label">
        Feeder — no loads tapped off
      </text>
      <text x={240} y={128} textAnchor="middle" className="ds-small">
        sized by the current it carries
      </text>
      {/* feeding points */}
      <circle cx={364} cy={110} r={6} className="ds-struct-fp" />
      <circle cx={364} cy={236} r={6} className="ds-struct-fp" />
      <text x={364} y={260} textAnchor="middle" className="ds-small">
        feeding points
      </text>
      {/* distributor */}
      <path d="M370 110 H 860" className="ds-struct-dist" />
      <text x={615} y={46} textAnchor="middle" className="ds-struct-label">
        Distributor — loads tapped all along it
      </text>
      <text x={615} y={62} textAnchor="middle" className="ds-small">
        sized by the voltage drop: the last house must still get an acceptable voltage
      </text>
      {houses.map((k) => {
        const x = 420 + k * 98
        return (
          <g key={k}>
            <path d={`M${x} 110 V 150`} className="ds-struct-service" />
            <path d={`M${x - 16} 168 L ${x} 152 L ${x + 16} 168 V 190 H ${x - 16} Z`} className="ds-struct-house" />
          </g>
        )
      })}
      <text x={404} y={212} className="ds-small">
        service mains: the short connection to each consumer
      </text>
      <path d="M370 236 H 520" className="ds-struct-dist" />
      <text x={530} y={240} className="ds-small">
        another distributor …
      </text>
    </svg>
  )
}

/** CONCEPTUAL: radial, ring main and interconnected layouts. */
export function LayoutsDiagram() {
  const node = (x: number, y: number, k: string) => <circle key={k} cx={x} cy={y} r={4.5} className="ds-struct-load" />
  const src = (x: number, y: number) => <rect x={x - 9} y={y - 9} width={18} height={18} rx={3} className="ds-struct-src" />
  return (
    <div className="ds-layouts">
      <figure>
        <svg viewBox="0 0 260 140" role="img" aria-label="Illustration: radial system, one path from the source to every load">
          {src(30, 70)}
          <path d="M39 70 H 230" className="ds-struct-dist" />
          {[80, 130, 180, 230].map((x) => node(x, 70, `r${x}`))}
          <path d="M130 70 V 118" className="ds-struct-dist" />
          {node(130, 118, 'rb')}
        </svg>
        <figcaption>
          <b>Radial</b> — one path to each load. Simple and cheap; a fault cuts off everything beyond it, and the far end sees the largest drop.
        </figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 260 140" role="img" aria-label="Illustration: ring main, the distributor forms a closed loop back to the source">
          {src(30, 70)}
          <path d="M39 70 H 60 V 24 H 230 V 116 H 60 V 70" className="ds-struct-dist" />
          {[
            [120, 24],
            [190, 24],
            [230, 70],
            [170, 116],
            [100, 116],
          ].map(([x, y]) => node(x, y, `g${x}${y}`))}
        </svg>
        <figcaption>
          <b>Ring main</b> — the distributor closes on itself: each load is fed two ways, so the drops are smaller and a section can be isolated without losing supply.
        </figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 260 140" role="img" aria-label="Illustration: interconnected system, a ring fed from two substations">
          {src(30, 70)}
          {src(230, 70)}
          <path d="M39 70 H 60 V 24 H 200 V 70 H 221 M200 70 V 116 H 60 V 70" className="ds-struct-dist" />
          {[
            [130, 24],
            [130, 116],
          ].map(([x, y]) => node(x, y, `i${x}${y}`))}
        </svg>
        <figcaption>
          <b>Interconnected</b> — a ring fed from more than one substation: the most reliable and the most expensive.
        </figcaption>
      </figure>
    </div>
  )
}
