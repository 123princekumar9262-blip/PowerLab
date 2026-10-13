import type { KeyboardEvent } from 'react'
import type { BusType } from '../../network/loadflow.ts'
import { fx } from '../../ui/format.ts'
import type { LineFlow } from './analysis.ts'
import type { LfCase } from './systems.ts'

/**
 * The load-flow single-line diagram: horizontal bus bars with their number, name and TYPE written on them (slack /
 * PV / PQ — never colour alone), generators above, loads and shunt capacitors below, and the lines between buses.
 * With values it shows each bus's |V|∠θ and each line's sending-end P (arrow = direction of active power) and Q.
 * Lines can be made selectable (switch a line out); out-of-service lines are grey and dashed.
 */

/** Where each bus's symbols and labels go, per case (hand-placed so nothing overlaps). */
interface BusLayout {
  /** Label block anchor relative to the bar centre, and text alignment. */
  label: { dx: number; dy: number; anchor: 'start' | 'end' | 'middle' }
  gen?: { dx: number; side: 'above' | 'below' }
  load?: { dx: number; side: 'above' | 'below' }
  /** Line flow label offsets are along the line normal; per-line overrides below. */
}

const HALF = 62

const LAYOUT: Record<LfCase['id'], { viewBox: string; buses: BusLayout[]; lineLabel?: Record<string, { t?: number; side?: 1 | -1 }> }> = {
  saadat: {
    viewBox: '-60 -10 800 360',
    buses: [
      { label: { dx: -HALF - 14, dy: -2, anchor: 'end' }, gen: { dx: 30, side: 'above' } },
      { label: { dx: -HALF - 14, dy: -2, anchor: 'end' }, load: { dx: 30, side: 'below' } },
      { label: { dx: HALF + 14, dy: -2, anchor: 'start' }, gen: { dx: 30, side: 'above' } },
    ],
    lineLabel: { '1–2': { side: -1 }, '1–3': { side: 1 }, '2–3': { side: -1 } },
  },
  five: {
    viewBox: '-80 -20 840 480',
    buses: [
      { label: { dx: -HALF - 14, dy: -2, anchor: 'end' }, gen: { dx: -30, side: 'above' } },
      { label: { dx: HALF + 14, dy: -2, anchor: 'start' }, gen: { dx: 30, side: 'above' } },
      { label: { dx: -HALF - 14, dy: -2, anchor: 'end' }, load: { dx: -38, side: 'below' } },
      { label: { dx: HALF + 14, dy: -2, anchor: 'start' }, load: { dx: 38, side: 'below' } },
      { label: { dx: HALF + 14, dy: -2, anchor: 'start' }, load: { dx: 30, side: 'below' } },
    ],
    lineLabel: { '1–2': { side: -1 }, '3–4': { side: -1, t: 0.5 }, '2–3': { t: 0.62, side: 1 }, '1–3': { side: -1 }, '2–4': { side: 1 }, '3–5': { side: -1 }, '4–5': { side: 1 } },
  },
}

export interface BusShown {
  vm: number
  thDeg: number
}

export interface LfDiagramProps {
  c: LfCase
  label: string
  /** Bus voltages to show (e.g. the solution, or one iteration's state). */
  busV?: BusShown[] | null
  /** Bus types to show (after Q-limit switching), default the case's. */
  types?: BusType[]
  /** PV buses held at a Q limit. */
  limited?: number[]
  flows?: LineFlow[] | null
  /** Lines added so far (Y_bus builder): the rest are drawn faint; `current` is emphasised. */
  built?: string[]
  current?: string | null
  highlightBuses?: number[]
  /** Fade the buses that are not highlighted. */
  dimOthers?: boolean
  onLine?(id: string): void
}

type Pt = { x: number; y: number }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function ends(c: LfCase, i: number, k: number): [Pt, Pt] {
  const a = c.buses[i]
  const b = c.buses[k]
  const inner = HALF - 14
  if (Math.abs(a.y - b.y) < 1) {
    const dir = Math.sign(b.x - a.x)
    return [
      { x: a.x + dir * HALF, y: a.y },
      { x: b.x - dir * HALF, y: b.y },
    ]
  }
  return [
    { x: clamp(b.x, a.x - inner, a.x + inner), y: a.y },
    { x: clamp(a.x, b.x - inner, b.x + inner), y: b.y },
  ]
}

const TYPE_LABEL: Record<BusType, string> = { slack: 'SLACK', pv: 'PV', pq: 'PQ' }

export function LfDiagram({ c, label, busV, types, limited = [], flows, built, current, highlightBuses, dimOthers, onLine }: LfDiagramProps) {
  const lay = LAYOUT[c.id]
  const hb = highlightBuses && highlightBuses.length ? new Set(highlightBuses) : null
  const keyAct = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
  return (
    <svg className="ps-lf-sld" viewBox={lay.viewBox} role="group" aria-label={label}>
      <defs>
        <marker id="ps-lf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="ps-lf-arrowhead" />
        </marker>
      </defs>
      {c.lines.map((l) => {
        const [p, q] = ends(c, l.from, l.to)
        const out = l.inService === false
        const isBuilt = !built || built.includes(l.id)
        const isCur = current === l.id
        const f = flows?.find((x) => x.id === l.id)
        const ll = lay.lineLabel?.[l.id] ?? {}
        const t = ll.t ?? 0.5
        const m = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }
        let nrm = { x: -u.y, y: u.x }
        if (nrm.y > 0 || (Math.abs(nrm.y) < 1e-6 && nrm.x < 0)) nrm = { x: -nrm.x, y: -nrm.y } // normal points up
        const side = ll.side ?? -1
        const lab = { x: m.x + nrm.x * 18 * side, y: m.y + nrm.y * 18 * side }
        const fwd = f ? f.pFromMw >= 0 : true
        const dir = fwd ? u : { x: -u.x, y: -u.y }
        const horizontal = Math.abs(u.x) > 0.98
        const tip = { x: m.x + dir.x * 6, y: m.y + dir.y * 6 }
        const bl = { x: m.x - dir.x * 5 - dir.y * 5, y: m.y - dir.y * 5 + dir.x * 5 }
        const br = { x: m.x - dir.x * 5 + dir.y * 5, y: m.y - dir.y * 5 - dir.x * 5 }
        const vs = nrm.y * side
        const y1 = horizontal ? (side === 1 ? m.y - 21 : m.y + 15) : Math.abs(vs) < 0.2 ? lab.y - 2 : vs < 0 ? lab.y - 17 : lab.y + 12
        const name = `Line ${l.id}${out ? ' (out of service)' : ''}`
        const act = onLine
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': out,
              'aria-label': `${name} — press to ${out ? 'return it to service' : 'switch it out'}`,
              onClick: () => onLine(l.id),
              onKeyDown: keyAct(() => onLine(l.id)),
            }
          : { 'aria-label': name }
        const textAnchor = horizontal ? 'middle' : lab.x >= m.x ? 'start' : 'end'
        const tx = horizontal ? m.x : lab.x
        return (
          <g key={l.id} className={`ps-lf-line ${out ? 'is-out' : ''} ${isBuilt ? '' : 'is-pending'} ${isCur ? 'is-current' : ''} ${onLine ? 'is-action' : ''}`} {...act}>
            <path d={`M${p.x} ${p.y}L${q.x} ${q.y}`} className="ps-lf-hit" />
            <path d={`M${p.x} ${p.y}L${q.x} ${q.y}`} className="ps-lf-wire" />
            {f && !out && f.inService ? (
              <g aria-hidden="true">
                <path d={`M${tip.x} ${tip.y}L${bl.x} ${bl.y}L${br.x} ${br.y}Z`} className="ps-lf-flowtri" />
                <text x={tx} y={y1} className="ps-lf-val" textAnchor={textAnchor}>
                  <tspan>{fx(Math.abs(fwd ? f.pFromMw : f.pToMw), 1)} MW</tspan>
                  <tspan className="ps-lf-val-q" x={tx} dy={13}>
                    {fx(fwd ? f.qFromMvar : f.qToMvar, 1)} Mvar
                  </tspan>
                </text>
              </g>
            ) : (
              <text x={tx} y={horizontal ? (side === 1 ? m.y - 9 : m.y + 17) : lab.y + 4} className={`ps-lf-tag ${out ? 'is-out' : ''}`} textAnchor={textAnchor} aria-hidden="true">
                {out ? `${l.id} out` : l.id}
              </text>
            )}
          </g>
        )
      })}
      {c.buses.map((b, i) => {
        const L = lay.buses[i]
        const type = types?.[i] ?? b.type
        const lim = limited.includes(i)
        const v = busV?.[i]
        const dim = dimOthers && hb && !hb.has(i)
        const gen = L.gen && (b.type !== 'pq' || b.pGenMw > 0)
        const load = L.load && (b.pLoadMw > 0 || b.qLoadMvar > 0)
        const lx = b.x + L.label.dx
        const ly = b.y + L.label.dy
        return (
          <g
            key={i}
            className={`ps-lf-bus ${dim ? 'is-dim' : ''} ${hb?.has(i) ? 'is-hl' : ''}`}
            aria-label={`Bus ${b.tag}, ${b.name}, ${TYPE_LABEL[type]}${lim ? ' (held at its reactive limit)' : ''}${v ? `, ${fx(v.vm, 4)} per unit at ${fx(v.thDeg, 2)} degrees` : ''}`}
          >
            {gen && L.gen && (
              <g className="ps-lf-gen" aria-hidden="true">
                <path d={`M${b.x + L.gen.dx} ${b.y}V${b.y - 24}`} className="ps-lf-stub" />
                <circle cx={b.x + L.gen.dx} cy={b.y - 36} r={12} />
                <path d={`M${b.x + L.gen.dx - 6} ${b.y - 36}q3 -6 6 0t6 0`} className="ps-lf-wave" />
              </g>
            )}
            {load && L.load && (
              <g className="ps-lf-load" aria-hidden="true">
                <path d={`M${b.x + L.load.dx} ${b.y}V${b.y + 30}`} className="ps-lf-stub" markerEnd="url(#ps-lf-arrow)" />
                <text x={b.x + L.load.dx} y={b.y + 48} className="ps-lf-small" textAnchor="middle">
                  {fx(b.pLoadMw, 0)} + j{fx(b.qLoadMvar, 0)}
                </text>
              </g>
            )}
            {b.shuntMvar ? (
              <g className="ps-lf-cap" aria-hidden="true">
                <path d={`M${b.x - 6} ${b.y}V${b.y + 22}M${b.x - 18} ${b.y + 22}h24M${b.x - 18} ${b.y + 28}h24M${b.x - 6} ${b.y + 28}v10`} className="ps-lf-stub" />
                <text x={b.x - 6} y={b.y + 52} className="ps-lf-small" textAnchor="middle">
                  C {fx(b.shuntMvar, 0)} Mvar
                </text>
              </g>
            ) : null}
            <path d={`M${b.x - HALF} ${b.y}H${b.x + HALF}`} className="ps-lf-bar" />
            <text x={lx} y={ly - 8} className="ps-lf-busname" textAnchor={L.label.anchor}>
              {b.name === `Bus ${b.tag}` ? b.name : `${b.tag} · ${b.name}`}
            </text>
            <text x={lx} y={ly + 8} className={`ps-lf-type ${lim ? 'is-limited' : ''}`} textAnchor={L.label.anchor}>
              {lim ? 'PV → PQ (Q limit)' : TYPE_LABEL[type]}
            </text>
            {v && (
              <text x={lx} y={ly + 23} className="ps-lf-vval" textAnchor={L.label.anchor}>
                {fx(v.vm, 4)} ∠ {fx(v.thDeg, 2)}°
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
