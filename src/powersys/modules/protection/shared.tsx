import { useDeferredValue, useMemo, type KeyboardEvent, type ReactNode } from 'react'
import type { DistState } from './state.ts'
import { G1 } from './earthing.ts'
const G1_MVA = G1.ratedMva
import { abs, add, arg, C, scale, type Complex } from '../../engine/complex.ts'
import type { FaultType } from '../faults/sequence.ts'
import { FAULT_LABEL } from '../faults/sequence.ts'
import { fx } from '../../ui/format.ts'
import {
  BREAKER_S,
  CB_NAME,
  CT_RATIO,
  distanceCase,
  I_MIN_A,
  IB_KA,
  K0,
  KV,
  L1_KM,
  L3_KM,
  LOOP_LABEL,
  reachOhm,
  RELAY_INFO,
  ROUTE_KM,
  secondaryOhm,
  sweep,
  VT_RATIO,
  Z0L,
  Z1L,
  Z1L3,
  zoneIssues,
  type CbId,
  type DistanceCase,
  type RelayId,
  type RouteOpts,
  type Sweep,
  type Zone,
  type ZoneSettings,
} from './distance.ts'
import { afterS, amps, zoneName, zPolar, zRect } from './words.ts'

export const MODULE = 'protection'
export const M4_HREF = '#/subjects/power-systems/faults'
export const M4_PROT_HREF = '#/subjects/power-systems/faults?mode=explore'

export const TYPE_OPTIONS: Array<{ id: FaultType; label: string }> = [
  { id: '3ph', label: '3-phase' },
  { id: 'slg', label: 'L-G' },
  { id: 'll', label: 'L-L' },
  { id: 'dlg', label: 'L-L-G' },
]
export const typeName = (t: FaultType) => FAULT_LABEL[t].toLowerCase()

/** The case for a state (null with the reasons when the settings are not valid). */
export function useDistance(s: DistState): { issues: string[]; c: DistanceCase | null } {
  return useMemo(() => {
    const issues = zoneIssues(s.zones)
    return { issues, c: issues.length ? null : distanceCase(s.spec, s.opts, s.zones) }
  }, [s])
}

/** The sweep along the route (deferred: it is recomputed only when type, R_f, the system or the settings change). */
export function useSweep(s: DistState): Sweep | null {
  const key = useDeferredValue(JSON.stringify([s.spec.type, s.spec.rfOhm, s.opts, s.zones]))
  return useMemo(() => {
    const [type, rf, opts, zones] = JSON.parse(key) as [FaultType, number, RouteOpts, ZoneSettings]
    return zoneIssues(zones).length ? null : sweep(type, rf, opts, zones, 100)
  }, [key])
}

export const RELAY_COLOR: Record<RelayId, string> = { RA: 'var(--accent)', RBA: 'var(--ps-b)', RBC: 'var(--ps-mv)' }
export const ZONE_COLOR = ['var(--text-3)', 'var(--ps-fault)', 'var(--warning)', 'var(--ps-c)']

// ── R–X plane ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface RxPoint {
  z: Complex
  label: string
  kind: 'app' | 'bolted' | 'load' | 'other'
}

/** Nice tick step for a span. */
function tickStep(span: number, n = 6) {
  const raw = span / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
}

export function RxPlot({
  zones,
  points = [],
  trajectory = [],
  load,
  label,
  height = 420,
  activeZone,
  showLine = true,
}: {
  zones: ZoneSettings
  points?: RxPoint[]
  trajectory?: Complex[]
  load?: { zMin: number; phiDeg: number } | null
  label: string
  height?: number
  activeZone?: Zone
  showLine?: boolean
}) {
  const W = 560
  const H = height
  const m = { l: 46, r: 14, t: 14, b: 34 }
  const reaches = zones.reachPct.map((p) => reachOhm(Z1L, p))
  const D = abs(reaches[2])
  // the domain: zone 3's circle, the route's impedance and the points, kept within ±2.5 × zone 3
  const xs: number[] = [0]
  const ys: number[] = [0]
  for (const r of reaches) {
    xs.push(r.re / 2 - abs(r) / 2, r.re / 2 + abs(r) / 2)
    ys.push(r.im / 2 - abs(r) / 2, r.im / 2 + abs(r) / 2)
  }
  const routeEnd = add(Z1L, Z1L3)
  if (showLine) {
    xs.push(routeEnd.re)
    ys.push(routeEnd.im)
  }
  for (const p of points) {
    xs.push(p.z.re)
    ys.push(p.z.im)
  }
  const lim = 2.5 * D
  const clampv = (v: number) => Math.max(-lim, Math.min(lim, v))
  let x0 = clampv(Math.min(...xs)) - 0.06 * D
  let x1 = clampv(Math.max(...xs)) + 0.06 * D
  let y0 = Math.min(clampv(Math.min(...ys)), -0.1 * D) - 0.04 * D
  let y1 = clampv(Math.max(...ys)) + 0.06 * D
  const sx = (W - m.l - m.r) / (x1 - x0)
  const sy = (H - m.t - m.b) / (y1 - y0)
  const s = Math.min(sx, sy)
  // equal scales: widen the tighter axis
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  x0 = cx - (W - m.l - m.r) / s / 2
  x1 = cx + (W - m.l - m.r) / s / 2
  y0 = cy - (H - m.t - m.b) / s / 2
  y1 = cy + (H - m.t - m.b) / s / 2
  const X = (r: number) => m.l + (r - x0) * s
  const Y = (x: number) => H - m.b - (x - y0) * s
  const step = tickStep(Math.max(x1 - x0, y1 - y0))
  const ticksX: number[] = []
  for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) ticksX.push(Math.abs(v) < 1e-9 ? 0 : v)
  const ticksY: number[] = []
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ticksY.push(Math.abs(v) < 1e-9 ? 0 : v)
  const inView = (z: Complex) => z.re >= x0 && z.re <= x1 && z.im >= y0 && z.im <= y1
  const traj = trajectory.filter((z) => Math.abs(z.re) < 4 * lim && Math.abs(z.im) < 4 * lim)
  const app = points.find((p) => p.kind === 'app')
  const bolted = points.find((p) => p.kind === 'bolted')
  // load wedge: |Z| ≥ Z_min, angle within ±φ, drawn to the edge of the view
  const wedge = load
    ? (() => {
        const far = 3 * Math.hypot(x1 - x0, y1 - y0)
        const ph = (load.phiDeg * Math.PI) / 180
        const pts: string[] = []
        for (let k = 0; k <= 24; k++) {
          const a = -ph + (2 * ph * k) / 24
          pts.push(`${X(load.zMin * Math.cos(a)).toFixed(1)},${Y(load.zMin * Math.sin(a)).toFixed(1)}`)
        }
        pts.push(`${X(far * Math.cos(ph)).toFixed(1)},${Y(far * Math.sin(ph)).toFixed(1)}`, `${X(far * Math.cos(-ph)).toFixed(1)},${Y(far * Math.sin(-ph)).toFixed(1)}`)
        return pts.join(' ')
      })()
    : null
  const clipId = 'pr-rx-clip'
  return (
    <figure className="pr-rx">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}. ${reaches.map((r, k) => `Zone ${k + 1} mho circle of reach ${fx(abs(r), 1)} ohms`).join('; ')}.${app ? ` Apparent impedance ${zPolar(app.z)}.` : ' No apparent impedance (the relay cannot measure).'}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
          <pattern id="pr-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="pr-hatch-line" />
          </pattern>
        </defs>
        {ticksX.map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} className={v === 0 ? 'pr-axis' : 'pr-grid'} />
            <text x={X(v)} y={H - m.b + 14} className="pr-tick" textAnchor="middle">
              {fx(v, step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {ticksY.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'pr-axis' : 'pr-grid'} />
            <text x={m.l - 5} y={Y(v) + 4} className="pr-tick" textAnchor="end">
              {fx(v, step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        <text x={W - m.r} y={H - 4} className="pr-axis-label" textAnchor="end">
          R [Ω primary]
        </text>
        <text x={m.l + 4} y={m.t + 10} className="pr-axis-label">
          X [Ω]
        </text>
        <g clipPath={`url(#${clipId})`}>
          {wedge && (
            <g>
              <polygon points={wedge} className="pr-load" />
              <text x={X(load!.zMin * 1.04)} y={Y(0) - 6} className="pr-load-text">
                heaviest load
              </text>
            </g>
          )}
          {reaches
            .map((r, k) => ({ r, k }))
            .reverse()
            .map(({ r, k }) => (
              <g key={k} className={`pr-zone pr-zone--${k + 1} ${activeZone === k + 1 ? 'is-active' : ''}`}>
                <circle cx={X(r.re / 2)} cy={Y(r.im / 2)} r={(abs(r) / 2) * s} />
              </g>
            ))}
          {showLine && (
            <g>
              <line x1={X(0)} y1={Y(0)} x2={X(Z1L.re)} y2={Y(Z1L.im)} className="pr-line" />
              <line x1={X(Z1L.re)} y1={Y(Z1L.im)} x2={X(routeEnd.re)} y2={Y(routeEnd.im)} className="pr-line pr-line--next" />
              {[0.25, 0.5, 0.75].map((f) => (
                <circle key={f} cx={X(Z1L.re * f)} cy={Y(Z1L.im * f)} r={2} className="pr-line-tick" />
              ))}
              <text x={X(Z1L.re) + 7} y={Y(Z1L.im) + 4} className="pr-line-text">
                B (Z₁L)
              </text>
              <text x={X(routeEnd.re) + 7} y={Y(routeEnd.im) + 4} className="pr-line-text">
                C
              </text>
            </g>
          )}
          {traj.length > 1 && <polyline points={traj.map((z) => `${X(z.re).toFixed(1)},${Y(z.im).toFixed(1)}`).join(' ')} className="pr-traj" />}
          {app && bolted && abs(add(app.z, scale(bolted.z, -1))) > 1e-6 && (
            <line x1={X(bolted.z.re)} y1={Y(bolted.z.im)} x2={X(app.z.re)} y2={Y(app.z.im)} className="pr-shift" markerEnd="url(#pr-arrow)" />
          )}
          <defs>
            <marker id="pr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 10 5 0 10z" className="pr-arrowhead" />
            </marker>
          </defs>
          {points
            .filter((p) => inView(p.z))
            .map((p, k) => (
              <g key={k} className={`pr-pt pr-pt--${p.kind}`}>
                {p.kind === 'app' ? (
                  <circle cx={X(p.z.re)} cy={Y(p.z.im)} r={6} />
                ) : p.kind === 'load' ? (
                  <rect x={X(p.z.re) - 5} y={Y(p.z.im) - 5} width={10} height={10} />
                ) : (
                  <circle cx={X(p.z.re)} cy={Y(p.z.im)} r={4.5} />
                )}
                <text x={X(p.z.re) + 9} y={Y(p.z.im) - 8} className="pr-pt-text">
                  {p.label}
                </text>
              </g>
            ))}
        </g>
        {reaches.map((r, k) => (
          <text
            key={k}
            x={Math.min(W - m.r - 4, X(r.re / 2 + abs(r) / 2) + 5)}
            y={Math.max(m.t + 10, Y(r.im / 2) + 4)}
            className={`pr-zone-text pr-zone-text--${k + 1}`}
            textAnchor={X(r.re / 2 + abs(r) / 2) + 90 > W - m.r ? 'end' : 'start'}
          >
            Zone {k + 1} · {zones.reachPct[k]} %
          </text>
        ))}
      </svg>
      {app && !inView(app.z) && <figcaption className="small muted">The apparent impedance ({zPolar(app.z)}) is outside this view.</figcaption>}
    </figure>
  )
}

// ── time–distance (stepped) characteristic ─────────────────────────────────────────────────────────────────────

export function TimeDistance({ sw, zones, faultKm, trips, label }: { sw: Sweep; zones: ZoneSettings; faultKm: number; trips: Partial<Record<RelayId, number | null>>; label: string }) {
  const W = 640
  const H = 250
  const m = { l: 50, r: 16, t: 16, b: 34 }
  const tMax = Math.max(0.2, zones.timeS[2]) * 1.25
  const yAxis = m.t + (H - m.t - m.b) * 0.62
  const X = (km: number) => m.l + (km / ROUTE_KM) * (W - m.l - m.r)
  const up = (t: number) => yAxis - (t / tMax) * (yAxis - m.t) - 4
  const down = (t: number) => yAxis + (t / tMax) * (H - m.b - yAxis) * 1.0 + 4
  const ticks = [0, zones.timeS[1], zones.timeS[2]].filter((t, i, a) => a.indexOf(t) === i)
  const segs = (r: RelayId) => sw.steps[r].filter((g) => g.zone > 0 && g.x1 - g.x0 > 1e-3)
  return (
    <figure className="pr-td">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}. ${(['RA', 'RBC', 'RBA'] as RelayId[])
          .map(
            (r) =>
              `${RELAY_INFO[r].short}: ${
                segs(r)
                  .map((g) => `zone ${g.zone} from ${fx(g.x0, 1)} to ${fx(g.x1, 1)} km at ${fx(g.t ?? 0, 2)} s`)
                  .join(', ') || 'no zone'
              }`,
          )
          .join('; ')}`}
      >
        <line x1={m.l} x2={W - m.r} y1={yAxis} y2={yAxis} className="pr-axis" />
        {[0, L1_KM, ROUTE_KM].map((km, k) => (
          <g key={km}>
            <line x1={X(km)} x2={X(km)} y1={m.t} y2={H - m.b} className="pr-grid" />
            <text x={X(km)} y={H - 6} className="pr-tick" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>
              {['A', 'B', 'C'][k]} · {km} km
            </text>
          </g>
        ))}
        <text x={X(L1_KM / 2)} y={yAxis + 13} className="pr-tick" textAnchor="middle">
          line L1
        </text>
        <text x={X(L1_KM + L3_KM / 2)} y={yAxis + 13} className="pr-tick" textAnchor="middle">
          line L3
        </text>
        {ticks.map((t) => (
          <text key={t} x={m.l - 6} y={up(t) + 4} className="pr-tick" textAnchor="end">
            {fx(t, 2)} s
          </text>
        ))}
        {(['RA', 'RBC'] as RelayId[]).map((r) =>
          segs(r).map((g, k) => (
            <g key={`${r}${k}`} className="pr-step" style={{ color: RELAY_COLOR[r] }}>
              <rect x={X(g.x0)} y={up(g.t ?? 0) - 3} width={Math.max(1, X(g.x1) - X(g.x0))} height={6} rx={2} />
              <text x={X(g.x0) + 4} y={up(g.t ?? 0) - 7} className="pr-step-text">
                {RELAY_INFO[r].short} Z{g.zone}
              </text>
            </g>
          )),
        )}
        {segs('RBA').map((g, k) => (
          <g key={`ba${k}`} className="pr-step" style={{ color: RELAY_COLOR.RBA }}>
            <rect x={X(g.x0)} y={down(g.t ?? 0) - 3} width={Math.max(1, X(g.x1) - X(g.x0))} height={6} rx={2} />
            <text x={X(g.x1) - 4} y={down(g.t ?? 0) + 15} className="pr-step-text" textAnchor="end">
              {RELAY_INFO.RBA.short} Z{g.zone}
            </text>
          </g>
        ))}
        <line x1={X(faultKm)} x2={X(faultKm)} y1={m.t} y2={H - m.b} className="pr-fault-line" />
        <text x={Math.min(W - m.r - 2, X(faultKm) + 4)} y={m.t + 8} className="pr-fault-text" textAnchor={faultKm > ROUTE_KM * 0.85 ? 'end' : 'start'}>
          fault
        </text>
        {(Object.keys(trips) as RelayId[]).map((r) => {
          const t = trips[r]
          if (t === null || t === undefined) return null
          return <circle key={r} cx={X(faultKm)} cy={r === 'RBA' ? down(t) : up(t)} r={5} className="pr-trip-dot" style={{ fill: RELAY_COLOR[r] }} />
        })}
      </svg>
      <figcaption className="small muted">
        Above the axis: relays looking right (R_A at A, R_BC at B). Below: R_BA at B looking back along L1. Each bar is where a zone operates, found fault by fault with this fault type and resistance
        — infeed and R_f move the steps. Dots: the times at the fault you placed.
      </figcaption>
    </figure>
  )
}

// ── the single-line diagram of the route (the 2D view of the 3D scene) ───────────────────────────────────────────

export function RouteSld({ c, selected, onSelect, label }: { c: DistanceCase; selected?: string | null; onSelect?(id: string): void; label: string }) {
  const W = 760
  const H = 230
  const xA = 150
  const xB = 470
  const xC = 700
  const y = 110
  const xF = c.fault.spec.km <= L1_KM ? xA + 30 + ((xB - 30 - xA - 30) * c.fault.spec.km) / L1_KM : xB + 30 + ((xC - 10 - xB - 30) * (c.fault.spec.km - L1_KM)) / L3_KM
  const open = (cb: CbId) => c.clearing.open[cb] !== null
  const dead = c.clearing.clearedS !== null ? c.clearing.dead : { L1: false, B: false, L3: false }
  const sel = (id: string) => (selected === id ? 'is-selected' : '')
  const click = (id: string) => ({
    role: onSelect ? ('button' as const) : undefined,
    tabIndex: onSelect ? 0 : undefined,
    onClick: onSelect ? () => onSelect(id) : undefined,
    onKeyDown: onSelect
      ? (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(id)
          }
        }
      : undefined,
  })
  const cb = (id: CbId, x: number, name: string, anchor: 'middle' | 'end' | 'start' = 'middle') => (
    <g className={`pr-sld-cb ${open(id) ? 'is-open' : ''} ${sel(id)}`} {...click(id)} aria-label={`${name}: ${open(id) ? 'open' : 'closed'}`}>
      <rect x={x - 8} y={y - 8} width={16} height={16} />
      <text x={anchor === 'end' ? x + 8 : anchor === 'start' ? x - 8 : x} y={y - 14} className="pr-sld-text" textAnchor={anchor}>
        {name}
      </text>
      <text x={anchor === 'end' ? x + 8 : anchor === 'start' ? x - 8 : x} y={y + 26} className="pr-sld-state" textAnchor={anchor}>
        {open(id) ? `OPEN ${fx(c.clearing.open[id]!, 2)} s` : 'closed'}
      </text>
    </g>
  )
  const relayBox = (r: RelayId, x: number, yy: number) => {
    const d = c.decisions[r]
    return (
      <g className={`pr-sld-relay ${sel(r === 'RA' ? 'relay' : r)}`} {...click(r === 'RA' ? 'relay' : r)}>
        <rect x={x - 46} y={yy - 14} width={92} height={28} rx={4} />
        <text x={x} y={yy - 2} className="pr-sld-text" textAnchor="middle">
          {RELAY_INFO[r].short}
        </text>
        <text x={x} y={yy + 10} className="pr-sld-state" textAnchor="middle">
          {d.z ? (d.zone ? `Z${d.zone} · ${fx(d.tripS!, 2)} s` : 'no zone') : 'no current'}
        </text>
      </g>
    )
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pr-sld" role="img" aria-label={label}>
      {/* source behind A */}
      <g className={`pr-sld-el ${sel('source')}`} {...click('source')}>
        <circle cx={40} cy={y} r={16} className="pr-sld-gen" />
        <text x={40} y={y + 4} className="pr-sld-text" textAnchor="middle">
          G1
        </text>
        <line x1={56} x2={84} y1={y} y2={y} className="pr-sld-wire" />
        <circle cx={92} cy={y} r={9} className="pr-sld-tx" />
        <circle cx={104} cy={y} r={9} className="pr-sld-tx" />
        <text x={98} y={y + 30} className="pr-sld-text" textAnchor="middle">
          T1
        </text>
        <line x1={113} x2={xA} y1={y} y2={y} className="pr-sld-wire" />
      </g>
      <line x1={xA} x2={xA} y1={y - 34} y2={y + 34} className="pr-sld-bus" />
      <text x={xA - 6} y={y - 40} className="pr-sld-bus-text" textAnchor="end">
        A · {KV} kV
      </text>
      <line x1={xA} x2={xA + 14} y1={y} y2={y} className="pr-sld-wire" />
      {cb('cbA', xA + 22, 'CB A')}
      {/* CT and VT */}
      <g className={`pr-sld-el ${sel('ct')}`} {...click('ct')}>
        <circle cx={xA + 46} cy={y} r={6} className="pr-sld-ct" />
        <text x={xA + 46} y={y + 44} className="pr-sld-text" textAnchor="middle">
          CT
        </text>
      </g>
      <g className={`pr-sld-el ${sel('vt')}`} {...click('vt')}>
        <line x1={xA + 70} x2={xA + 70} y1={y} y2={y - 26} className="pr-sld-wire" />
        <circle cx={xA + 70} cy={y - 32} r={6} className="pr-sld-ct" />
        <text x={xA + 80} y={y - 29} className="pr-sld-text">
          VT
        </text>
      </g>
      {relayBox('RA', xA + 46, y + 74)}
      <line x1={xA + 46} x2={xA + 46} y1={y + 6} y2={y + 60} className="pr-sld-sig" />
      {/* L1 */}
      <g className={`pr-sld-el ${sel('l1')}`} {...click('l1')}>
        <line x1={xA + 30} x2={xB - 30} y1={y} y2={y} className={`pr-sld-line ${dead.L1 ? 'is-dead' : ''}`} />
        <text x={(xA + xB) / 2 + 20} y={y - 12} className="pr-sld-text" textAnchor="middle">
          L1 · {L1_KM} km{dead.L1 ? ' · isolated' : ''}
        </text>
      </g>
      {cb('cbB1', xB - 22, 'CB B1', 'end')}
      <line x1={xB - 14} x2={xB} y1={y} y2={y} className="pr-sld-wire" />
      <line x1={xB} x2={xB} y1={y - 34} y2={y + 34} className={`pr-sld-bus ${dead.B ? 'is-dead' : ''}`} />
      <text x={xB - 6} y={y - 40} className="pr-sld-bus-text" textAnchor="end">
        B · {KV} kV
      </text>
      {relayBox('RBA', xB - 60, y + 74)}
      {relayBox('RBC', xB + 60, y + 74)}
      {c.fault.opts.infeed && (
        <g className={`pr-sld-el ${sel('remote')}`} {...click('remote')}>
          <line x1={xB} x2={xB} y1={y - 34} y2={y - 52} className="pr-sld-wire" />
          <rect x={xB - 26} y={y - 76} width={52} height={22} rx={4} className="pr-sld-grid" />
          <text x={xB} y={y - 61} className="pr-sld-text" textAnchor="middle">
            grid
          </text>
        </g>
      )}
      <line x1={xB} x2={xB + 14} y1={y} y2={y} className="pr-sld-wire" />
      {cb('cbB2', xB + 22, 'CB B2', 'start')}
      <g className={`pr-sld-el ${sel('l3')}`} {...click('l3')}>
        <line x1={xB + 30} x2={xC - 10} y1={y} y2={y} className={`pr-sld-line ${dead.L3 ? 'is-dead' : ''}`} />
        <text x={(xB + xC) / 2 + 10} y={y - 12} className="pr-sld-text" textAnchor="middle">
          L3 · {L3_KM} km{dead.L3 ? ' · no supply' : ''}
        </text>
      </g>
      <line x1={xC} x2={xC} y1={y - 26} y2={y + 26} className={`pr-sld-bus ${dead.L3 ? 'is-dead' : ''}`} />
      <text x={xC} y={y - 32} className="pr-sld-bus-text" textAnchor="middle">
        C
      </text>
      {/* fault */}
      <g className={`pr-sld-fault ${sel('fault')}`} {...click('fault')}>
        <path d={`M${xF} ${y + 2} l-6 12 h8 l-6 14`} />
        <text x={xF} y={y + 42} className="pr-sld-text pr-sld-fault-text" textAnchor="middle">
          {fx(c.fault.spec.km, 1)} km
        </text>
      </g>
      <text x={W - 6} y={H - 6} className="pr-sld-kind" textAnchor="end">
        geometry: positions to scale along each line · states and values calculated
      </text>
    </svg>
  )
}

// ── live part information (3D info panel and the 2D diagram) ─────────────────────────────────────────────────────

function Dl({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="pr-info">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PartInfo({ id, c }: { id: string; c: DistanceCase | null }): ReactNode {
  if (!c) return <p className="small">No values: the relay settings are not valid.</p>
  const ra = c.decisions.RA
  const v = c.fault.relays.RA
  const vA = abs(v.vabc[0]) * (KV / Math.sqrt(3))
  const iA = abs(v.iabc[0]) * IB_KA * 1000
  switch (id) {
    case 'relay':
    case 'RA':
      return (
        <Dl
          rows={[
            ['Loop measured', LOOP_LABEL[ra.loop]],
            ['Z_app (primary)', ra.z ? zRect(ra.z) : 'no current'],
            ['|Z_app|', ra.z ? zPolar(ra.z) : '—'],
            ['Z_app (secondary)', ra.z ? zPolar(secondaryOhm(ra.z), 3) : '—'],
            ['Decision', ra.z ? `${zoneName(ra.zone)}${ra.zone ? ` → trip ${afterS(ra.tripS!)}` : ' → no trip'}` : 'cannot measure'],
          ]}
        />
      )
    case 'RBA':
    case 'RBC': {
      const d = c.decisions[id]
      return (
        <Dl
          rows={[
            ['Z_app', d.z ? zPolar(d.z) : `no current (below ${I_MIN_A} A)`],
            ['Decision', d.z ? `${zoneName(d.zone)}${d.zone ? ` → ${fx(d.tripS!, 2)} s` : ''}` : '—'],
          ]}
        />
      )
    }
    case 'ct':
      return (
        <Dl
          rows={[
            ['Ratio', `${CT_RATIO}/1 A`],
            ['Phase a primary', amps(iA)],
            ['Secondary', `${fx(iA / CT_RATIO, 3)} A`],
          ]}
        />
      )
    case 'vt':
      return (
        <Dl
          rows={[
            ['Ratio', `${KV} kV / 110 V (${VT_RATIO}:1)`],
            ['Phase a to earth', `${fx(vA, 2)} kV`],
            ['Secondary', `${fx((vA * 1000) / VT_RATIO, 2)} V`],
          ]}
        />
      )
    case 'cbA':
    case 'cbB1':
    case 'cbB2': {
      const r = id === 'cbA' ? 'RA' : id === 'cbB1' ? 'RBA' : 'RBC'
      const view = c.fault.relays[r]
      const iMax = Math.max(...view.iabc.map((x) => abs(x))) * IB_KA
      const t = c.clearing.open[id]
      return (
        <Dl
          rows={[
            ['State', t !== null ? `open at ${fx(t, 2)} s` : 'closed'],
            ['Current through it', `${fx(iMax, 3)} kA`],
            ['Tripped by', RELAY_INFO[r].short],
            ['Interrupting time', `${fx(BREAKER_S * 1000, 0)} ms (typical)`],
          ]}
        />
      )
    }
    case 'fault':
      return (
        <Dl
          rows={[
            ['Type', FAULT_LABEL[c.fault.spec.type]],
            ['Position', `${fx(c.fault.spec.km, 1)} km from A`],
            ['R_f', `${fx(c.fault.spec.rfOhm, 1)} Ω`],
            ['Fault current', `${fx(c.fault.faultKa, 3)} kA`],
            ['Cleared', c.clearing.clearedS !== null ? `after ${fx(c.clearing.clearedS, 2)} s` : 'not by these relays'],
          ]}
        />
      )
    case 'l1':
    case 'l3': {
      const z = id === 'l1' ? Z1L : Z1L3
      return (
        <Dl
          rows={[
            ['Length', `${id === 'l1' ? L1_KM : L3_KM} km`],
            ['Z₁', zRect(z)],
            ['Z₀', zRect(scale(Z0L, (id === 'l1' ? L1_KM : L3_KM) / L1_KM))],
            ['k₀', `${fx(abs(K0), 3)} ∠${fx((arg(K0) * 180) / Math.PI, 1)}°`],
          ]}
        />
      )
    }
    case 'source':
      return <p className="small">Generator G1 ({G1_MVA} MVA) and step-up transformer T1 — Module 4’s data. Every fault on this route is fed from here.</p>
    case 'remote':
      return (
        <p className="small">{c.fault.opts.infeed ? `A grid infeed of ${c.fault.opts.sscMva} MVA (X/R 10) at B: faults on L1 are fed from both ends.` : 'Switched off: B has no source of its own.'}</p>
      )
    default:
      return null
  }
}

/** Short computed description of what happens for a case (used under the scene and in the tutor context). */
export function outcomeText(c: DistanceCase): string {
  const parts: string[] = []
  const ra = c.decisions.RA
  parts.push(ra.z ? `R_A measures ${zPolar(ra.z)} — ${zoneName(ra.zone)}${ra.zone ? `, trips ${afterS(ra.tripS!)}` : ''}.` : 'R_A cannot measure (no current).')
  const opened = (Object.keys(c.clearing.open) as CbId[]).filter((k) => c.clearing.open[k] !== null)
  if (c.clearing.clearedS !== null) parts.push(`Cleared at ${fx(c.clearing.clearedS, 2)} s by ${opened.map((k) => CB_NAME[k]).join(' and ')}.`)
  else
    parts.push(
      opened.length
        ? `${opened.map((k) => CB_NAME[k]).join(' and ')} open${opened.length === 1 ? 's' : ''}, but a source still feeds the fault: not cleared by distance protection.`
        : 'No relay operates: the fault is not cleared by these distance relays.',
    )
  if (c.clearing.reset.length) parts.push(`${c.clearing.reset.map((r) => RELAY_INFO[r].short).join(', ')} had started timing and reset${c.clearing.reset.length === 1 ? 's' : ''}.`)
  if (c.clearing.tie) parts.push('Two relays operated at the same time — no discrimination.')
  return parts.join(' ')
}

/** "the fault current of 0.776 kA" helper for text. */
export const kA = (x: number) => `${fx(x, 3)} kA`

/** Reach in ohms of a zone of the relay at A. */
export const reachOf = (zones: ZoneSettings, k: 0 | 1 | 2) => reachOhm(Z1L, zones.reachPct[k])

export const ZERO_C = C(0)
