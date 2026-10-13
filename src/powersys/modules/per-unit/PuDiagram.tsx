import type { Network } from '../../network/types.ts'
import { cx, fx, sg } from '../../ui/format.ts'
import { levelOf } from '../../ui/levels.ts'
import { compOf, transformerSides, type Model } from './calc.ts'
import { num } from './steps.ts'

/**
 * The Grid Explorer network drawn as one horizontal chain with its voltage zones behind it — the figure every mode
 * of this module uses. Each zone is a coloured band (colour = voltage level, and its kV is written in it) headed by
 * its base quantities. Elements carry their values in ohms (where in ohms depends on the side) or in per unit on the
 * chosen base (the impedance diagram: one box per series impedance, a small ideal transformer for an off-nominal
 * ratio). The layout is specific to this radial network; every value is read from the model (calc.ts).
 */

export type DiagramValues = 'ohm' | 'pu'

const W = 1140
const H = 250
const Y = 150
const BAR = 22
const BUS_X: Record<string, number> = { gen: 170, hvA: 330, hvB: 530, mvA: 690, mvB: 850, lv: 1010 }
const BUS_TAG: Record<string, string> = { gen: 'Generator', hvA: 'Switchyard', hvB: 'Grid s/s', mvA: 'Grid s/s', mvB: 'Distribution s/s', lv: 'Town feeders' }
const GEN_X = 50

export const zoneKey = (firstBus: string) => `z-${firstBus}`

export function PuDiagram({
  net,
  model,
  values,
  detail = 'x',
  shown,
  highlight,
  label,
}: {
  net: Network
  model: Model
  values: DiagramValues
  /** Per unit: reactance only, or R + jX (and line charging). */
  detail?: 'x' | 'z'
  /** Only these elements are drawn in full (the others are ghosted) — for the step-by-step build. */
  shown?: string[] | null
  /** Emphasise these elements or zones (`z-<bus>`); the rest is dimmed. */
  highlight?: string[]
  label: string
}) {
  const hl = highlight && highlight.length ? new Set(highlight) : null
  const show = shown ? new Set(shown) : null
  const S = model.choice.sMva
  const cls = (id: string, base: string, ghost = true) => `${base} ${hl && !hl.has(id) ? 'is-dim' : ''} ${hl?.has(id) ? 'is-hl' : ''} ${ghost && show && !show.has(id) ? 'is-ghost' : ''}`
  const showVal = (id: string) => !show || show.has(id)

  // zones: bands between the transformers
  const zs = [...model.zones].sort((a, b) => BUS_X[a.buses[0]] - BUS_X[b.buses[0]])
  const spans = zs.map((z, k) => {
    const xs = z.buses.map((b) => BUS_X[b])
    const prev = zs[k - 1]
    const next = zs[k + 1]
    const left = prev ? (Math.max(...prev.buses.map((b) => BUS_X[b])) + Math.min(...xs)) / 2 : 0
    const right = next ? (Math.max(...xs) + Math.min(...next.buses.map((b) => BUS_X[b]))) / 2 : W
    return { z, left, right }
  })
  const refZone = model.zones.find((z) => z.buses.includes(model.choice.refBus))

  const g = net.components.find((c) => c.kind === 'generator')
  const branches = net.components.filter((c) => c.kind === 'line' || c.kind === 'transformer')
  const loads = net.components.filter((c) => c.kind === 'load')

  return (
    <svg className="ps-sld ps-pu-dia" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {/* zone bands */}
      {spans.map(({ z, left, right }) => {
        const lv = levelOf(z.nominalKv)
        const id = zoneKey(z.buses[0])
        return (
          <g key={z.id} className={`ps-lv--${lv} ${cls(id, 'ps-pu-zone', false)} ${z === refZone ? 'is-ref' : ''}`}>
            <rect x={left + 2} y={2} width={right - left - 4} height={H - 4} rx={8} className="ps-pu-band" />
            <rect x={left + 2} y={2} width={right - left - 4} height={3} className="ps-pu-band-top" />
            <text x={left + 14} y={24} className="ps-pu-zone-title">
              {num(z.nominalKv)} kV zone{z === refZone ? ' · reference' : ''}
            </text>
            <text x={left + 14} y={42} className="ps-pu-zone-line">
              V_base {num(z.vBaseKv)} kV
            </text>
            <text x={left + 14} y={57} className="ps-pu-zone-line">
              Z_base {fx(z.zBaseOhm, z.zBaseOhm < 10 ? 4 : 1)} Ω
            </text>
            <text x={left + 14} y={72} className="ps-pu-zone-line">
              I_base {fx(z.iBaseKa, 4)} kA
            </text>
          </g>
        )
      })}

      {/* generator */}
      {g && g.kind === 'generator' && (
        <g className={cls(g.id, `ps-pu-el ps-lv--${levelOf(net.buses.find((b) => b.id === g.bus)!.kv)}`)} aria-label={g.name}>
          {values === 'ohm' ? (
            <>
              <path d={`M${GEN_X + 14} ${Y}H${BUS_X[g.bus]}`} className="ps-wire" />
              <circle cx={GEN_X} cy={Y} r={14} className="ps-gen" />
              <path d={`M${GEN_X - 7} ${Y} q3.5 -6 7 0 t7 0`} className="ps-gen-wave" />
              <text x={GEN_X} y={Y - 24} className="ps-tag" textAnchor="middle">
                {g.id}
              </text>
              {showVal(g.id) && (
                <text x={GEN_X + 8} y={Y + 32} className="ps-pu-val" textAnchor="middle">
                  X″d {sg(model.gen[g.id].xOhm, 3)} Ω
                </text>
              )}
            </>
          ) : (
            <>
              <path d={`M${GEN_X + 13} ${Y}H${BUS_X[g.bus]}`} className="ps-wire" />
              <circle cx={GEN_X} cy={Y} r={13} className="ps-gen" />
              <path d={`M${GEN_X - 7} ${Y} q3.5 -6 7 0 t7 0`} className="ps-gen-wave" />
              <Box x={(GEN_X + BUS_X[g.bus]) / 2 + 4} id={g.id} />
              {showVal(g.id) && (
                <>
                  <text x={GEN_X} y={Y + 32} className="ps-pu-val ps-pu-val--muted" textAnchor="middle">
                    E {fx(1 * (busKv(net, g.bus) / model.vb[g.bus]), 3)}
                  </text>
                  <text x={(GEN_X + BUS_X[g.bus]) / 2 + 4} y={Y + 32} className="ps-pu-val" textAnchor="middle">
                    j{fx(model.gen[g.id].x, 4)}
                  </text>
                </>
              )}
            </>
          )}
        </g>
      )}

      {/* branches */}
      {branches.map((c) => {
        if (c.kind !== 'line' && c.kind !== 'transformer') return null
        const xa = BUS_X[c.from]
        const xb = BUS_X[c.to]
        const lo = Math.min(xa, xb)
        const hi = Math.max(xa, xb)
        const mid = (lo + hi) / 2
        const lvA = levelOf(busKv(net, c.from))
        const lvB = levelOf(busKv(net, c.to))
        const on = showVal(c.id)
        if (c.kind === 'line') {
          const p = model.line[c.id]
          return (
            <g key={c.id} className={cls(c.id, `ps-pu-el ps-lv--${lvA}`)} aria-label={c.name}>
              <path d={`M${lo} ${Y}H${hi}`} className="ps-wire" />
              {values === 'ohm' ? (
                <>
                  <text x={mid} y={Y - 12} className="ps-tag" textAnchor="middle">
                    {c.id} · {num(c.lengthKm)} km
                  </text>
                  {on && (
                    <text x={mid} y={Y + 28} className="ps-pu-val" textAnchor="middle">
                      {detail === 'z' ? `${cx(p.zOhm.re, p.zOhm.im, 2)} Ω` : `X ${sg(p.zOhm.im, 3)} Ω`}
                    </text>
                  )}
                </>
              ) : (
                <>
                  <Box x={mid} id={c.id} />
                  {on && (
                    <text x={mid} y={Y + 32} className="ps-pu-val" textAnchor="middle">
                      {detail === 'z' ? cx(p.z.re, p.z.im, 4) : `j${fx(p.z.im, 4)}`}
                    </text>
                  )}
                  {on && detail === 'z' && (
                    <text x={mid} y={Y + 46} className="ps-pu-val ps-pu-val--muted" textAnchor="middle">
                      jB/2 {fx(p.bHalfPu, 4)}
                    </text>
                  )}
                </>
              )}
            </g>
          )
        }
        // transformer: z on its `to` side, the ideal t : 1 at its `from` end
        const t = model.tx[c.id]
        const offNominal = Math.abs(t.tap - 1) > 1e-9
        const fromLeft = xa < xb
        const idealX = xa + (fromLeft ? 28 : -28)
        const boxX = offNominal ? mid + (fromLeft ? 14 : -14) : mid
        const sides = transformerSides(compOf(net, c.id, 'transformer'), S, model.vb)
        const [left, right] = fromLeft ? [sides.from, sides.to] : [sides.to, sides.from]
        return (
          <g key={c.id} className={cls(c.id, 'ps-pu-el')} aria-label={c.name}>
            {values === 'ohm' ? (
              <>
                <path d={`M${xa} ${Y}H${mid + (fromLeft ? -15 : 15)}`} className={`ps-wire ps-lv--${lvA}`} />
                <path d={`M${mid + (fromLeft ? 15 : -15)} ${Y}H${xb}`} className={`ps-wire ps-lv--${lvB}`} />
                <circle cx={mid + (fromLeft ? -6 : 6)} cy={Y} r={10} className={`ps-winding ps-lv--${lvA}`} />
                <circle cx={mid + (fromLeft ? 6 : -6)} cy={Y} r={10} className={`ps-winding ps-lv--${lvB}`} />
                <text x={mid} y={Y - 18} className="ps-tag" textAnchor="middle">
                  {c.id} {fromLeft ? `${num(c.kvFrom)}/${num(c.kvTo)}` : `${num(c.kvTo)}/${num(c.kvFrom)}`} kV
                </text>
                {on && (
                  <>
                    <text x={mid} y={Y + 32} className="ps-pu-val" textAnchor="middle">
                      {sg(left.ohm.im, 3)} Ω at {num(left.ratedKv)} kV
                    </text>
                    <text x={mid} y={Y + 46} className="ps-pu-val" textAnchor="middle">
                      {sg(right.ohm.im, 3)} Ω at {num(right.ratedKv)} kV
                    </text>
                  </>
                )}
              </>
            ) : (
              <>
                <path d={`M${lo} ${Y}H${hi}`} className={`ps-wire ps-lv--${lvB}`} />
                {offNominal && (
                  <g className={`ps-lv--${lvA}`}>
                    <path d={`M${xa} ${Y}H${idealX}`} className="ps-wire" />
                    <circle cx={idealX - 4} cy={Y} r={6} className="ps-winding ps-pu-ideal" />
                    <circle cx={idealX + 4} cy={Y} r={6} className={`ps-winding ps-pu-ideal ps-lv--${lvB}`} />
                  </g>
                )}
                <g className={`ps-lv--${lvB}`}>
                  <Box x={boxX} id={c.id} />
                </g>
                {on && (
                  <text x={boxX} y={Y + 32} className="ps-pu-val" textAnchor="middle">
                    {detail === 'z' ? cx(t.z.re, t.z.im, 4) : `j${fx(t.z.im, 4)}`}
                  </text>
                )}
                {on && offNominal && (
                  <text x={idealX} y={Y + 46} className="ps-pu-val ps-pu-val--tap" textAnchor="middle">
                    t = {fx(t.tap, 4)} : 1
                  </text>
                )}
              </>
            )}
          </g>
        )
      })}

      {/* loads */}
      {loads.map((c) => {
        if (c.kind !== 'load') return null
        const x = BUS_X[c.bus]
        const lv = levelOf(busKv(net, c.bus))
        const s = model.load[c.id]
        return (
          <g key={c.id} className={cls(c.id, `ps-pu-el ps-load ps-lv--${lv}`)} aria-label={c.name}>
            <path d={`M${x} ${Y + BAR}V${Y + BAR + 26}`} className="ps-wire" markerEnd="url(#ps-pu-arrow)" />
            <text x={x} y={Y + BAR + 50} className="ps-tag" textAnchor="middle">
              {c.name}
            </text>
            {showVal(c.id) && (
              <text x={x} y={Y + BAR + 64} className="ps-pu-val ps-pu-val--muted" textAnchor="middle">
                {values === 'ohm' ? `${num(c.pMw, 1)} MW · ${num(c.qMvar, 2)} Mvar` : `${cx(s.re, s.im, 3)} pu`}
              </text>
            )}
          </g>
        )
      })}

      {/* buses on top */}
      {net.buses.map((b) => (
        <g key={b.id} className={`ps-pu-el ps-pu-bus ps-lv--${levelOf(b.kv)}`} aria-label={`${b.name}, ${b.kv} kV`}>
          <path d={`M${BUS_X[b.id]} ${Y - BAR}V${Y + BAR}`} className="ps-bar" />
          <text x={BUS_X[b.id]} y={Y - BAR - 10} className="ps-pu-busname" textAnchor="middle">
            {BUS_TAG[b.id] ?? b.name}
          </text>
        </g>
      ))}

      <defs>
        <marker id="ps-pu-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="ps-pu-arrowhead" />
        </marker>
      </defs>
    </svg>
  )
}

const busKv = (net: Network, id: string) => net.buses.find((b) => b.id === id)!.kv

/** An impedance box with the element's id in it. */
function Box({ x, id }: { x: number; id: string }) {
  return (
    <>
      <rect x={x - 26} y={Y - 10} width={52} height={20} rx={3} className="ps-pu-box" />
      <text x={x} y={Y + 4} className="ps-pu-boxid" textAnchor="middle">
        {id}
      </text>
    </>
  )
}
