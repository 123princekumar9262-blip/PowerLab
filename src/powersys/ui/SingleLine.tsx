import type { KeyboardEvent, ReactNode } from 'react'
import type { Solution } from '../network/solve.ts'
import { inService } from '../network/topology.ts'
import { isBranch, type Bus, type Component, type Network } from '../network/types.ts'
import { fx } from './format.ts'
import { levelOf } from './levels.ts'

/**
 * A single-line diagram drawn from a network: buses are bars at their (x, y), branches run between the buses they
 * connect (transformers drawn as two coupled windings, lines as conductors), sources and loads hang off their bus,
 * breakers sit on what they switch (filled = closed, hollow = open). Colour follows the voltage level; a
 * de-energised part is grey and dashed. With a solution it shows voltages, flows (arrows point the way active
 * power flows) and loading. Every element is focusable and selectable.
 */

export interface SldPlace {
  /** Where a source or load hangs off its bus. */
  side: 'below' | 'above' | 'left' | 'right'
  /** Offset along the bus bar from its centre [diagram units]. */
  along?: number
}

export interface SldProps {
  net: Network
  sol?: Solution | null
  label: string
  selected?: string | null
  onSelect?(id: string): void
  /** Emphasise these elements (others are dimmed). */
  highlight?: string[]
  showValues?: boolean
  showFlows?: boolean
  animate?: boolean
  place?: Record<string, SldPlace>
  /** Bus orientation: vertical bar (default) or horizontal bar. */
  orient?: Record<string, 'v' | 'h'>
  /** Half-length of a bus bar. */
  barHalf?: number
  /** A fault drawn at this bus. */
  faultAt?: string | null
  viewBox?: string
  /** Extra SVG drawn on top (module-specific). */
  children?: ReactNode
  /** Short labels for elements (default: the id). */
  tags?: Record<string, string>
}

type Pt = { x: number; y: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function attach(b: Bus, toward: Pt, o: 'v' | 'h', h: number): Pt {
  return o === 'v' ? { x: b.x, y: clamp(toward.y, b.y - h + 8, b.y + h - 8) } : { x: clamp(toward.x, b.x - h + 8, b.x + h - 8), y: b.y }
}

/** The polyline of a branch between two buses (straight, or one elbow), offset for parallel branches. */
function branchPath(a: Bus, b: Bus, oa: 'v' | 'h', ob: 'v' | 'h', h: number, offset: number): Pt[] {
  const cb = { x: b.x, y: b.y + (ob === 'v' ? offset : 0) }
  const s = attach(a, oa === 'v' ? cb : { x: cb.x + offset, y: cb.y }, oa, h)
  const e = attach(b, ob === 'v' ? s : { x: s.x, y: s.y }, ob, h)
  if (Math.abs(s.x - e.x) < 0.5 || Math.abs(s.y - e.y) < 0.5) return [s, e]
  if (oa === 'v') {
    const mx = (s.x + e.x) / 2
    return [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e]
  }
  const my = (s.y + e.y) / 2
  return [s, { x: s.x, y: my }, { x: e.x, y: my }, e]
}

const lengthOf = (p: Pt[]) => p.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0)

/** The point at a distance along a polyline, and the direction there. */
function along(p: Pt[], d: number): { pt: Pt; dir: Pt } {
  let left = d
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
    if (left <= seg || i === p.length - 1) {
      const t = seg ? clamp(left / seg, 0, 1) : 0
      return {
        pt: {
          x: p[i - 1].x + (p[i].x - p[i - 1].x) * t,
          y: p[i - 1].y + (p[i].y - p[i - 1].y) * t,
        },
        dir: seg ? { x: (p[i].x - p[i - 1].x) / seg, y: (p[i].y - p[i - 1].y) / seg } : { x: 1, y: 0 },
      }
    }
    left -= seg
  }
  return { pt: p[0], dir: { x: 1, y: 0 } }
}

const d = (p: Pt[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ')

export function SingleLine({
  net,
  sol,
  label,
  selected,
  onSelect,
  highlight,
  showValues = true,
  showFlows = true,
  animate = true,
  place = {},
  orient = {},
  barHalf = 34,
  faultAt,
  viewBox,
  children,
  tags = {},
}: SldProps) {
  const bus = new Map(net.buses.map((b) => [b.id, b]))
  const o = (id: string) => orient[id] ?? 'v'
  const hl = highlight && highlight.length ? new Set(highlight) : null
  const breakersOn = (id: string) => net.components.filter((c) => c.kind === 'breaker' && c.target === id)
  const energized = (busId: string) => (sol ? (sol.bus[busId]?.energized ?? false) : true)
  const cls = (id: string, extra = '') => `ps-el ${extra} ${selected === id ? 'is-selected' : ''} ${hl && !hl.has(id) ? 'is-dim' : ''} ${hl?.has(id) ? 'is-hl' : ''}`
  const act = (id: string, name: string) =>
    onSelect
      ? {
          role: 'button',
          tabIndex: 0,
          'aria-label': name,
          'aria-pressed': selected === id,
          onClick: () => onSelect(id),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(id)
            }
          },
        }
      : { 'aria-label': name }

  // parallel branches between the same pair of buses are offset from one another
  const pairCount = new Map<string, number>()
  const pairIndex = new Map<string, number>()
  for (const c of net.components)
    if (isBranch(c)) {
      const k = [c.from, c.to].sort().join('|')
      pairIndex.set(c.id, pairCount.get(k) ?? 0)
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1)
    }

  const xs = net.buses.map((b) => b.x)
  const ys = net.buses.map((b) => b.y)
  const vb = viewBox ?? `${Math.min(...xs) - 90} ${Math.min(...ys) - 110} ${Math.max(...xs) - Math.min(...xs) + 180} ${Math.max(...ys) - Math.min(...ys) + 250}`

  const branches = net.components.filter(isBranch)
  const shunts = net.components.filter((c) => c.kind === 'generator' || c.kind === 'grid' || c.kind === 'load')

  return (
    <svg className={`ps-sld ${animate ? 'is-animated' : ''}`} viewBox={vb} role="group" aria-label={label}>
      <defs>
        <marker id="ps-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="ps-arrowhead" />
        </marker>
      </defs>

      {/* branches */}
      {branches.map((c) => {
        const a = bus.get(c.from)
        const b = bus.get(c.to)
        if (!a || !b) return null
        const n = pairCount.get([c.from, c.to].sort().join('|')) ?? 1
        const off = (pairIndex.get(c.id)! - (n - 1) / 2) * 16
        const p = branchPath(a, b, o(a.id), o(b.id), barHalf, off)
        const L = lengthOf(p)
        const mid = along(p, L / 2)
        const on = inService(net, c) && energized(c.from) && energized(c.to)
        const r = sol?.branch[c.id]
        const flowFwd = (r?.pFromMw ?? 0) >= 0
        const lvA = levelOf(a.kv)
        const lvB = levelOf(b.kv)
        const pMw = Math.abs(r?.pFromMw ?? 0)
        const dur = clamp(60 / Math.max(pMw, 1), 0.6, 6)
        const tag = tags[c.id] ?? c.id
        return (
          <g key={c.id} className={cls(c.id, `ps-branch ps-${c.kind} ${on ? '' : 'is-dead'}`)} {...act(c.id, `${c.name}${on ? '' : ' (out of service)'}`)}>
            <path d={d(p)} className="ps-hit" />
            {c.kind === 'transformer' ? (
              <>
                <path
                  d={d(
                    p.length === 2
                      ? [
                          p[0],
                          {
                            x: mid.pt.x - mid.dir.x * 15,
                            y: mid.pt.y - mid.dir.y * 15,
                          },
                        ]
                      : p,
                  )}
                  className={`ps-wire ps-lv--${lvA}`}
                />
                <path
                  d={d([
                    {
                      x: mid.pt.x + mid.dir.x * 15,
                      y: mid.pt.y + mid.dir.y * 15,
                    },
                    p[p.length - 1],
                  ])}
                  className={`ps-wire ps-lv--${lvB}`}
                />
                <circle cx={mid.pt.x - mid.dir.x * 6} cy={mid.pt.y - mid.dir.y * 6} r={10} className={`ps-winding ps-lv--${lvA}`} />
                <circle cx={mid.pt.x + mid.dir.x * 6} cy={mid.pt.y + mid.dir.y * 6} r={10} className={`ps-winding ps-lv--${lvB}`} />
              </>
            ) : (
              <path d={d(p)} className={`ps-wire ps-lv--${lvA}`} />
            )}
            {showFlows && on && r && pMw > 0.05 && animate && <path d={d(flowFwd ? p : [...p].reverse())} className="ps-flow" style={{ animationDuration: `${dur}s` }} />}
            <text x={mid.pt.x} y={mid.pt.y - 16} className="ps-tag" textAnchor="middle">
              {tag}
            </text>
            {showValues && on && r && (
              <FlowLabel
                at={{ x: mid.pt.x, y: mid.pt.y + 30 }}
                dir={flowFwd ? mid.dir : { x: -mid.dir.x, y: -mid.dir.y }}
                p={r.pFromMw >= 0 ? r.pFromMw : -r.pToMw}
                q={r.pFromMw >= 0 ? r.qFromMvar : r.qToMvar}
                loading={r.loadingPct}
              />
            )}
            {breakersOn(c.id).map((br, k) => {
              const at = along(p, Math.min(26 + k * 18, L / 3)).pt
              return <BreakerMark key={br.id} at={at} br={br} net={net} sel={selected} onSelect={onSelect} hl={hl} />
            })}
          </g>
        )
      })}

      {/* sources and loads */}
      {shunts.map((c) => {
        if (c.kind !== 'generator' && c.kind !== 'grid' && c.kind !== 'load') return null
        const b = bus.get(c.bus)
        if (!b) return null
        const pl = place[c.id] ?? {
          side: c.kind === 'load' ? 'below' : c.kind === 'grid' ? 'above' : 'left',
        }
        const ob = o(b.id)
        const al = pl.along ?? 0
        const start: Pt =
          ob === 'v'
            ? pl.side === 'below'
              ? { x: b.x, y: b.y + barHalf }
              : pl.side === 'above'
                ? { x: b.x, y: b.y - barHalf }
                : { x: b.x, y: b.y + al }
            : pl.side === 'left'
              ? { x: b.x - barHalf, y: b.y }
              : pl.side === 'right'
                ? { x: b.x + barHalf, y: b.y }
                : { x: b.x + al, y: b.y }
        const dir = pl.side === 'below' ? { x: 0, y: 1 } : pl.side === 'above' ? { x: 0, y: -1 } : pl.side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 }
        const len = dir.y === 0 ? 56 : c.kind === 'load' ? 40 : 34
        const end = { x: start.x + dir.x * len, y: start.y + dir.y * len }
        const on = inService(net, c) && energized(c.bus)
        const lv = levelOf(b.kv)
        const sr = c.kind === 'load' ? sol?.load[c.id] : sol?.source[c.id]
        const tag = tags[c.id] ?? c.id
        // below/above: the labels continue past the symbol; left/right: above and below the symbol, centred on it
        const sym = { x: end.x + dir.x * 14, y: end.y + dir.y * 14 }
        const vertical = dir.y !== 0
        const tagAt = vertical ? { x: end.x, y: end.y + dir.y * 30 + (dir.y > 0 ? 8 : -2) } : { x: sym.x, y: sym.y - 22 }
        const valAt = vertical ? { x: end.x, y: end.y + dir.y * 30 + (dir.y > 0 ? 22 : -16) } : { x: sym.x, y: sym.y + 30 }
        return (
          <g key={c.id} className={cls(c.id, `ps-shunt ps-${c.kind} ${on ? '' : 'is-dead'}`)} {...act(c.id, `${c.name}${on ? '' : ' (not energised)'}`)}>
            <path d={d([start, end])} className={`ps-wire ps-lv--${lv}`} />
            <path d={d([start, end])} className="ps-hit" />
            {c.kind === 'load' ? (
              <path d={d([end, { x: end.x + dir.x * 12, y: end.y + dir.y * 12 }])} className={`ps-wire ps-lv--${lv}`} markerEnd="url(#ps-arrow)" />
            ) : c.kind === 'generator' ? (
              <g>
                <circle cx={end.x + dir.x * 14} cy={end.y + dir.y * 14} r={14} className={`ps-gen ps-lv--${lv}`} />
                <path d={`M${end.x + dir.x * 14 - 7} ${end.y + dir.y * 14} q3.5 -6 7 0 t7 0`} className="ps-gen-wave" />
              </g>
            ) : (
              <g>
                <rect x={end.x + dir.x * 14 - 14} y={end.y + dir.y * 14 - 14} width={28} height={28} className={`ps-gridsrc ps-lv--${lv}`} />
                <path
                  d={`M${end.x + dir.x * 14 - 14} ${end.y + dir.y * 14 + 14}l28 -28M${end.x + dir.x * 14 - 14} ${end.y + dir.y * 14}l14 -14M${end.x + dir.x * 14} ${end.y + dir.y * 14 + 14}l14 -14`}
                  className="ps-hatch"
                />
              </g>
            )}
            <text x={tagAt.x} y={tagAt.y} className="ps-tag" textAnchor="middle">
              {tag}
            </text>
            {showValues && sr && on && (
              <text x={valAt.x} y={valAt.y} className="ps-val" textAnchor="middle">
                {vertical ? (
                  `${fx(sr.pMw, 1)} MW · ${fx(sr.qMvar, 1)} Mvar`
                ) : (
                  <>
                    <tspan x={valAt.x}>{fx(sr.pMw, 1)} MW</tspan>
                    <tspan x={valAt.x} dy={13}>
                      {fx(sr.qMvar, 1)} Mvar
                    </tspan>
                  </>
                )}
              </text>
            )}
            {breakersOn(c.id).map((br) => (
              <BreakerMark key={br.id} at={{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }} br={br} net={net} sel={selected} onSelect={onSelect} hl={hl} />
            ))}
          </g>
        )
      })}

      {/* buses on top */}
      {net.buses.map((b) => {
        const r = sol?.bus[b.id]
        const on = energized(b.id)
        const ob = o(b.id)
        const lv = levelOf(b.kv)
        const tag = tags[b.id] ?? b.name
        const labelY = (ob === 'v' ? b.y - barHalf - 12 : b.y - 14) - (showValues && r ? 14 : 0)
        return (
          <g key={b.id} className={cls(b.id, `ps-bus ${on ? '' : 'is-dead'}`)} {...act(b.id, `${b.name}, ${b.kv} kV${on ? '' : ' (not energised)'}`)}>
            <path d={ob === 'v' ? `M${b.x} ${b.y - barHalf}V${b.y + barHalf}` : `M${b.x - barHalf} ${b.y}H${b.x + barHalf}`} className={`ps-bar ps-lv--${lv}`} />
            <path d={ob === 'v' ? `M${b.x} ${b.y - barHalf}V${b.y + barHalf}` : `M${b.x - barHalf} ${b.y}H${b.x + barHalf}`} className="ps-hit ps-hit--bus" />
            <text x={b.x} y={labelY} className="ps-bus-name" textAnchor="middle">
              {tag}
            </text>
            <text x={b.x} y={labelY - 14} className="ps-bus-kv" textAnchor="middle">
              {b.kv} kV
            </text>
            {showValues && r && (
              <text x={b.x} y={labelY + 14} className="ps-val ps-val--bus" textAnchor="middle">
                {on ? `${fx(r.vPu, 3)} pu ∠${fx(r.angDeg, 1)}°` : 'no supply'}
              </text>
            )}
            {faultAt === b.id && <path d={`M${b.x + 6} ${b.y - 26}l12 12h-8l12 14`} className="ps-fault" />}
          </g>
        )
      })}
      {children}
    </svg>
  )
}

function FlowLabel({ at, dir, p, q, loading }: { at: Pt; dir: Pt; p: number; q: number; loading?: number }) {
  const horizontal = Math.abs(dir.x) >= Math.abs(dir.y)
  const arrowFrom = horizontal ? { x: at.x - dir.x * 14, y: at.y - 14 } : { x: at.x - 14, y: at.y - dir.y * 14 }
  const arrowTo = horizontal ? { x: at.x + dir.x * 14, y: at.y - 14 } : { x: at.x - 14, y: at.y + dir.y * 14 }
  return (
    <g className="ps-flowlabel" aria-hidden="true">
      <path d={d([arrowFrom, arrowTo])} className="ps-flowarrow" markerEnd="url(#ps-arrow)" />
      <text x={at.x} y={at.y} className="ps-val" textAnchor="middle">
        {fx(Math.abs(p), 1)} MW
      </text>
      <text x={at.x} y={at.y + 13} className="ps-val ps-val--q" textAnchor="middle">
        {fx(q, 1)} Mvar{loading !== undefined ? ` · ${fx(loading, 0)} %` : ''}
      </text>
    </g>
  )
}

function BreakerMark({ at, br, net, sel, onSelect, hl }: { at: Pt; br: Component; net: Network; sel?: string | null; onSelect?(id: string): void; hl: Set<string> | null }) {
  if (br.kind !== 'breaker') return null
  const target = net.components.find((c) => c.id === br.target)
  return (
    <g
      className={`ps-el ps-breaker ${br.closed ? 'is-closed' : 'is-open'} ${sel === br.id ? 'is-selected' : ''} ${hl && !hl.has(br.id) ? 'is-dim' : ''}`}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${br.name}: ${br.closed ? 'closed' : 'open'}${target ? ` (${target.name})` : ''}`}
      aria-pressed={onSelect ? sel === br.id : undefined}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation()
              onSelect(br.id)
            }
          : undefined
      }
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onSelect(br.id)
              }
            }
          : undefined
      }
    >
      <rect x={at.x - 7} y={at.y - 7} width={14} height={14} rx={2} />
    </g>
  )
}
