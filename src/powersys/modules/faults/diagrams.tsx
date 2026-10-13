import { useMemo, type ReactNode } from 'react'
import { abs, arg, deg, type Complex } from '../../engine/complex.ts'
import type { Network } from '../../network/types.ts'
import { fx, sg } from '../../ui/format.ts'
import { SingleLine } from '../../ui/SingleLine.tsx'
import type { FaultType } from './sequence.ts'
import type { FaultResult, SeqModel } from './zbus.ts'

/*
 * Module 4's drawings: the network with a fault on it (voltages and currents during the fault), the three sequence
 * networks, how they are connected for each fault type, and a log–log time–current plot for relay grading.
 * Every number drawn comes from a FaultResult or the SeqModel it was computed from.
 */

/** A complex per-unit impedance, compactly: "j0.167" or "0.023 + j0.552". */
export function zText(z: Complex | null, d = 3): string {
  if (!z) return '∞'
  const re = Math.abs(z.re) < 0.5 * 10 ** -d ? '' : `${fx(z.re, d)} ${z.im < 0 ? '−' : '+'} `
  return `${re}j${fx(re ? Math.abs(z.im) : z.im, d)}`
}
/** A phasor |x|∠θ° with sensible digits. */
export const phText = (x: Complex, d = 3) => (abs(x) < 0.5 * 10 ** -d ? `0` : `${fx(abs(x), d)} ∠ ${fx(deg(arg(x)), 1)}°`)

// ── the network during a fault ────────────────────────────────────────────────────────────────────────────────

/** The network as drawn for fault studies: loads are not part of the fault model, so they are left out. */
export function withoutLoads(net: Network): Network {
  const loads = new Set(net.components.filter((c) => c.kind === 'load').map((c) => c.id))
  return { ...net, components: net.components.filter((c) => c.kind !== 'load' && !(c.kind === 'breaker' && loads.has(c.target))) }
}

const PHASE = ['a', 'b', 'c'] as const

export function FaultDiagram({
  net,
  result,
  tags,
  onPick,
  label,
  extra,
}: {
  net: Network
  result: FaultResult | null
  tags: Record<string, string>
  onPick?(bus: string): void
  label: string
  extra?: ReactNode
}) {
  const draw = useMemo(() => withoutLoads(net), [net])
  const pos = new Map(draw.buses.map((b) => [b.id, b]))
  const balanced = result?.type === '3ph'
  return (
    <div className="ps-diagram ps-ft-sld">
      <SingleLine
        net={draw}
        label={label}
        faultAt={result?.busId}
        selected={result?.busId}
        onSelect={onPick ? (id) => pos.has(id) && onPick(id) : undefined}
        showValues={false}
        showFlows={false}
        animate={false}
        place={{ G1: { side: 'left' } }}
        tags={tags}
        viewBox={`-62 78 1060 ${balanced || !result ? 158 : 180}`}
      >
        {result && (
          <g className="ps-ft-overlay" aria-hidden="true">
            {result.buses.map((b) => {
              const p = pos.get(b.id)!
              const y = p.y + 50
              if (result.dead) return null
              return balanced ? (
                <text key={b.id} x={p.x} y={y} className="ps-ft-v" textAnchor="middle">
                  |V| {fx(abs(b.vabc[0]), 3)} pu
                </text>
              ) : (
                <text key={b.id} x={p.x} y={y} className="ps-ft-v" textAnchor="middle">
                  {b.vabc.map((v, k) => (
                    <tspan key={k} x={p.x} dy={k ? 13 : 0} className={`ps-ft-ph ps-ft-ph--${PHASE[k]}`}>
                      V{PHASE[k]} {fx(abs(v), 3)}
                    </tspan>
                  ))}
                </text>
              )
            })}
            {result.branches.map((br) => {
              const b = draw.components.find((c) => c.id === br.id)
              if (!b || (b.kind !== 'line' && b.kind !== 'transformer')) return null
              const a = pos.get(b.from)!
              const c = pos.get(b.to)!
              const mx = (a.x + c.x) / 2
              const dir = Math.sign(a.x - c.x) || 1
              const cls = (ka: number) => `ps-ft-i ${ka < 1e-6 ? 'is-zero' : ''}`
              if (b.kind === 'line')
                return (
                  <text key={br.id} x={mx} y={a.y + 32} className={cls(br.kaFrom)} textAnchor="middle">
                    {br.kaFrom < 1e-6 ? '0 kA' : `${sg(br.kaFrom, 3)} kA`}
                  </text>
                )
              return (
                <g key={br.id}>
                  <text x={mx + dir * 5} y={a.y + 32} className={cls(br.kaFrom)} textAnchor={dir > 0 ? 'start' : 'end'}>
                    {br.kaFrom < 1e-6 ? '0' : sg(br.kaFrom, 3)} kA
                  </text>
                  <text x={mx - dir * 5} y={a.y + 32} className={cls(br.kaTo)} textAnchor={dir > 0 ? 'end' : 'start'}>
                    {br.kaTo < 1e-6 ? '0' : sg(br.kaTo, 3)} kA
                  </text>
                </g>
              )
            })}
            {result.sources
              .filter((s) => s.id !== 'ET')
              .map((s) => {
                const c = draw.components.find((x) => x.id === s.id)
                const p = c && 'bus' in c ? pos.get(c.bus) : undefined
                if (!p) return null
                return (
                  <text key={s.id} x={p.x - 70} y={p.y + 36} className={`ps-ft-i ${s.ka < 1e-6 ? 'is-zero' : ''}`} textAnchor="middle">
                    {sg(s.ka, 3)} kA
                  </text>
                )
              })}
          </g>
        )}
        {extra}
      </SingleLine>
    </div>
  )
}

// ── the three sequence networks ───────────────────────────────────────────────────────────────────────────────

const SEQ_NAME = ['Zero sequence', 'Positive sequence', 'Negative sequence']
const SUB = ['₀', '₁', '₂']

export function SeqNetworks({ m, result, short }: { m: SeqModel; result: FaultResult | null; short: Record<string, string> }) {
  const W = 1000
  const rowH = 150
  const head = 26
  const xs = m.net.buses.map((b) => b.x)
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  const X = (i: number) => 140 + ((m.net.buses[i].x - lo) / (hi - lo || 1)) * (W - 230)
  const order: Array<0 | 1 | 2> = [1, 2, 0]
  const k = result?.bus ?? -1
  const live = (x: Complex | null | undefined) => !!x && abs(x) > 1e-9
  const boxW = 92
  return (
    <svg
      className="ps-ft-seq"
      viewBox={`0 0 ${W} ${head + rowH * 3}`}
      role="img"
      aria-label={`The positive, negative and zero sequence networks${result ? `, with the currents of a fault at ${short[result.busId]}` : ''}`}
    >
      {m.net.buses.map((b, i) => (
        <text key={b.id} x={X(i)} y={16} className="ps-ft-seq-bus" textAnchor="middle">
          {short[b.id] ?? b.name}
        </text>
      ))}
      {order.map((s, r) => {
        const oy = head + r * rowH
        const top = oy + 46
        const ref = top + 86
        const sn = m.seq[s]
        const zth = k >= 0 ? (sn.earthed[k] ? sn.Z[k][k] : null) : undefined
        const els: ReactNode[] = []
        // series elements and zero-sequence breaks
        for (const b of m.branches) {
          const x1 = X(b.from)
          const x2 = X(b.to)
          const mx = (x1 + x2) / 2
          const z = s === 0 ? b.z0 : s === 1 ? b.z1 : b.z2
          const cur = result?.branches.find((x) => x.id === b.id)
          const iSeries = cur ? cur.i012From[s] : null
          if (s === 0 && b.zero !== 'series') {
            // the series path is open; a YN side may connect to the reference through the winding
            const gapL = mx - 16
            const gapR = mx + 16
            const [l, rr] = x1 < x2 ? [x1, x2] : [x2, x1]
            els.push(
              <g key={`${b.id}-open`} className="ps-ft-seq-open">
                <path d={`M${l} ${top}H${gapL}M${gapR} ${top}H${rr}`} className="ps-ft-seq-wire is-dim" />
                <path d={`M${gapL} ${top - 6}V${top + 6}M${gapR} ${top - 6}V${top + 6}`} className="ps-ft-seq-gap" />
                <text x={mx} y={top - 10} className="ps-ft-seq-note" textAnchor="middle">
                  {b.id} open
                </text>
              </g>,
            )
            const earthAt = b.zero === 'earth-from' ? b.from : b.zero === 'earth-to' ? b.to : -1
            if (earthAt >= 0) {
              const ex = X(earthAt)
              const i0 = cur ? (b.zero === 'earth-from' ? cur.i012From[0] : cur.i012To[0]) : null
              els.push(<Shunt key={`${b.id}-earth`} x={ex} from={X(earthAt)} top={top} ref={ref} z={z} label={`${b.id} (YN)`} cur={i0} on={live(i0)} boxW={boxW} />)
            }
            continue
          }
          const on = live(iSeries)
          els.push(
            <g key={b.id} className={on ? 'is-live' : ''}>
              <path d={`M${x1} ${top}H${mx - boxW / 2}M${mx + boxW / 2} ${top}H${x2}`} className="ps-ft-seq-wire" />
              <rect x={mx - boxW / 2} y={top - 10} width={boxW} height={20} rx={3} className="ps-ft-seq-box" />
              <text x={mx} y={top + 4} className="ps-ft-seq-z" textAnchor="middle">
                {zText(z)}
              </text>
              <text x={mx} y={top - 15} className="ps-ft-seq-tag" textAnchor="middle">
                {b.id}
                {result && <tspan className="ps-ft-seq-i">{on ? `  ${fx(abs(iSeries!), 3)} pu` : '  0'}</tspan>}
              </text>
            </g>,
          )
        }
        // sources and earthing paths
        for (const g of m.sources) {
          const z = s === 0 ? g.z0 : s === 1 ? g.z1 : g.z2
          if (g.kind === 'earthing' && s !== 0) continue
          const cur = result?.sources.find((x) => x.id === g.id)?.i012[s] ?? null
          const x = X(g.bus) - (g.kind === 'earthing' ? 0 : 34)
          if (!z) {
            els.push(
              <g key={`${g.id}-open`}>
                <path d={`M${X(g.bus)} ${top}H${x}V${top + 26}M${x} ${ref - 22}V${ref}`} className="ps-ft-seq-wire is-dim" />
                <path d={`M${x - 6} ${top + 26}H${x + 6}M${x - 6} ${ref - 22}H${x + 6}`} className="ps-ft-seq-gap" />
                <text x={x} y={top + 46} className="ps-ft-seq-note" textAnchor="middle">
                  {g.id} unearthed
                </text>
              </g>,
            )
            continue
          }
          els.push(<Shunt key={g.id} x={x} from={X(g.bus)} top={top} ref={ref} z={z} label={g.id} cur={cur} on={live(cur)} emf={s === 1 && g.kind !== 'earthing'} boxW={boxW} />)
        }
        return (
          <g key={s} className={`ps-ft-seq-row ps-ft-seq-row--${s}`}>
            <text x={8} y={oy + 14} className="ps-ft-seq-title">
              {SEQ_NAME[s]}
              {zth !== undefined && (
                <tspan className="ps-ft-seq-zth" dx={12}>
                  {zth ? `Z${SUB[s]} seen from the fault = ${zText(zth)} pu` : `no path to the reference: Z${SUB[s]} = ∞`}
                </tspan>
              )}
            </text>
            <path d={`M40 ${ref}H${W - 30}`} className="ps-ft-seq-ref" />
            <text x={W - 28} y={ref + 4} className="ps-ft-seq-note">
              N{SUB[s]}
            </text>
            {els}
            {m.net.buses.map((b, i) => (
              <circle key={b.id} cx={X(i)} cy={top} r={i === k ? 5.5 : 3.5} className={`ps-ft-seq-node ${i === k ? 'is-fault' : ''} ${sn.earthed[i] ? '' : 'is-float'}`} />
            ))}
            {k >= 0 && (
              <text x={X(k) + 8} y={top - 10} className="ps-ft-seq-f" textAnchor="start">
                F{SUB[s]}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Shunt({
  x,
  from,
  top,
  ref,
  z,
  label,
  cur,
  on,
  emf,
  boxW,
}: {
  x: number
  from: number
  top: number
  ref: number
  z: Complex
  label: string
  cur: Complex | null
  on: boolean
  emf?: boolean
  boxW: number
}) {
  const by = top + 24
  // labels beside the box: towards the bus, or inwards near the right edge
  const left = x < from || x > 860
  return (
    <g className={on ? 'is-live' : ''}>
      <path d={`M${from} ${top}H${x}V${by - 9}M${x} ${by + 9}V${emf ? ref - 30 : ref}${emf ? `M${x} ${ref - 12}V${ref}` : ''}`} className="ps-ft-seq-wire" />
      <rect x={x - boxW / 2} y={by - 9} width={boxW} height={18} rx={3} className="ps-ft-seq-box" />
      <text x={x} y={by + 4} className="ps-ft-seq-z" textAnchor="middle">
        {zText(z)}
      </text>
      {emf && (
        <>
          <circle cx={x} cy={ref - 21} r={9} className="ps-ft-seq-emf" />
          <text x={x} y={ref - 17} className="ps-ft-seq-z" textAnchor="middle">
            ~
          </text>
        </>
      )}
      <text x={x + (left ? -boxW / 2 - 4 : boxW / 2 + 4)} y={by + 4} className="ps-ft-seq-tag" textAnchor={left ? 'end' : 'start'}>
        {label}
      </text>
      {cur && (
        <text x={x + (left ? -boxW / 2 - 4 : boxW / 2 + 4)} y={by + 18} className="ps-ft-seq-i" textAnchor={left ? 'end' : 'start'}>
          {on ? `${fx(abs(cur), 3)} pu` : '0'}
        </text>
      )}
    </g>
  )
}

// ── how the sequence networks connect at the fault ────────────────────────────────────────────────────────────

export function Interconnect({ result }: { result: FaultResult }) {
  const t: FaultType = result.type
  const z = [result.z0, result.z1, result.z2]
  const I = result.point.i012
  const W = 560
  const H = t === 'slg' ? 270 : 200
  const box = (s: 0 | 1 | 2, x: number, y: number, w: number, h: number, dim = false) => (
    <g key={`b${s}`} className={dim ? 'is-dim' : ''}>
      <rect x={x} y={y} width={w} height={h} rx={6} className="ps-ft-ic-box" />
      <text x={x + 10} y={y + 17} className="ps-ft-ic-title">
        {SEQ_NAME[s]}
      </text>
      <text x={x + 10} y={y + 33} className="ps-ft-ic-z">
        Z{SUB[s]} = {zText(z[s])}
        {s === 1 ? ' · V_f = 1∠0°' : ''}
      </text>
      <text x={x + w - 10} y={y + 17} className="ps-ft-ic-i" textAnchor="end">
        I{SUB[s]} = {phText(I[s])}
      </text>
      <circle cx={x + w / 2} cy={y} r={3.5} className="ps-ft-ic-term" />
      <circle cx={x + w / 2} cy={y + h} r={3.5} className="ps-ft-ic-term" />
      <text x={x + w / 2 + 7} y={y - 5} className="ps-ft-ic-lab">
        F{SUB[s]}
      </text>
      <text x={x + w / 2 + 7} y={y + h + 13} className="ps-ft-ic-lab">
        N{SUB[s]}
      </text>
    </g>
  )
  const zbox = (x: number, y: number, text: string, vertical = false) => (
    <g key={`z${x}${y}`}>
      <rect x={vertical ? x - 9 : x - 24} y={vertical ? y - 22 : y - 9} width={vertical ? 18 : 48} height={vertical ? 44 : 18} rx={3} className="ps-ft-ic-zf" />
      <text x={vertical ? x + 14 : x} y={vertical ? y + 4 : y - 13} className="ps-ft-ic-lab" textAnchor={vertical ? 'start' : 'middle'}>
        {text}
      </text>
    </g>
  )
  let body: ReactNode
  if (t === 'slg') {
    const w = 330
    const h = 44
    const x = 40
    const ys = [26, 106, 186]
    // stacked: N₁–F₂, N₂–F₀ joined; F₁ round the side through 3Z_f to N₀
    body = (
      <>
        {box(1, x, ys[0], w, h)}
        {box(2, x, ys[1], w, h)}
        {box(0, x, ys[2], w, h)}
        <path d={`M${x + w / 2} ${ys[0] + h}V${ys[1]}M${x + w / 2} ${ys[1] + h}V${ys[2]}`} className="ps-ft-ic-wire" />
        <path d={`M${x + w / 2} ${ys[0]}V${ys[0] - 14}H${x + w + 70}V${ys[2] + h + 18}H${x + w / 2}V${ys[2] + h}`} className="ps-ft-ic-wire" />
        {zbox(x + w + 70, (ys[0] + ys[2] + h) / 2, `3Z_f`, true)}
        <text x={x + w + 96} y={(ys[0] + ys[2] + h) / 2 + 22} className="ps-ft-ic-note">
          in series:
        </text>
        <text x={x + w + 96} y={(ys[0] + ys[2] + h) / 2 + 36} className="ps-ft-ic-note">
          I₀ = I₁ = I₂
        </text>
      </>
    )
  } else if (t === 'll' || t === '3ph') {
    const w = 230
    const h = 56
    const y = 60
    body = (
      <>
        {box(1, 30, y, w, h)}
        {box(2, 300, y, w, h, t === '3ph')}
        {t === 'll' ? (
          <>
            <path d={`M145 ${y}V${y - 26}H415V${y}M145 ${y + h}V${y + h + 26}H415V${y + h}`} className="ps-ft-ic-wire" />
            {zbox(280, y - 26, 'Z_f')}
            <text x={280} y={y + h + 44} className="ps-ft-ic-note" textAnchor="middle">
              in parallel: I₂ = −I₁, I₀ = 0 (zero sequence not involved)
            </text>
          </>
        ) : (
          <>
            <path d={`M145 ${y}V${y - 26}H20V${y + h + 26}H145V${y + h}`} className="ps-ft-ic-wire" />
            {zbox(20, y + h / 2, 'Z_f', true)}
            <text x={280} y={y + h + 44} className="ps-ft-ic-note" textAnchor="middle">
              only the positive sequence: the fault is balanced, I₂ = I₀ = 0
            </text>
          </>
        )}
      </>
    )
  } else {
    const w = 160
    const h = 56
    const y = 60
    const xs = [20, 200, 380]
    body = (
      <>
        {box(1, xs[0], y, w, h)}
        {box(2, xs[1], y, w, h)}
        {box(0, xs[2], y, w, h)}
        <path d={`M${xs[0] + w / 2} ${y}V${y - 26}H${xs[2] + w / 2}V${y}M${xs[1] + w / 2} ${y - 26}V${y}`} className="ps-ft-ic-wire" />
        <path d={`M${xs[0] + w / 2} ${y + h}V${y + h + 26}H${xs[2] + w / 2}V${y + h}M${xs[1] + w / 2} ${y + h + 26}V${y + h}`} className="ps-ft-ic-wire" />
        {zbox(xs[2] + w / 2 - 50, y - 26, '3Z_f')}
        <text x={280} y={y + h + 44} className="ps-ft-ic-note" textAnchor="middle">
          all three in parallel (zero through 3Z_f): I₁ + I₂ + I₀ = 0
        </text>
      </>
    )
  }
  return (
    <svg className="ps-ft-ic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`How the sequence networks connect for a ${t} fault`}>
      {body}
    </svg>
  )
}

// ── log–log time–current plot ─────────────────────────────────────────────────────────────────────────────────

export interface LogSeries {
  id: string
  label: string
  color: string
  points: Array<[number, number]>
  dashed?: boolean
}
export interface LogMark {
  x: number
  y: number
  label: string
  color: string
  below?: boolean
  /** Put the label to the left of the point. */
  left?: boolean
}

const decades = (lo: number, hi: number) => {
  const out: number[] = []
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) out.push(e)
  return out
}
const tickText = (v: number, unit: string) => (unit === 'A' && v >= 1000 ? `${sg(v / 1000, 2)}k` : sg(v, 2))

export function LogPlot({
  series,
  marks = [],
  vlines = [],
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  xUnit,
  label,
  height = 330,
}: {
  series: LogSeries[]
  marks?: LogMark[]
  vlines?: Array<{ x: number; label: string }>
  xDomain: [number, number]
  yDomain: [number, number]
  xLabel: string
  yLabel: string
  xUnit: string
  label: string
  height?: number
}) {
  const W = 640
  const H = height
  const m = { l: 54, r: 70, t: 14, b: 40 }
  const lx = [Math.log10(xDomain[0]), Math.log10(xDomain[1])]
  const ly = [Math.log10(yDomain[0]), Math.log10(yDomain[1])]
  const X = (x: number) => m.l + ((Math.log10(x) - lx[0]) / (lx[1] - lx[0])) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - ((Math.log10(y) - ly[0]) / (ly[1] - ly[0])) * (H - m.t - m.b)
  const inX = (x: number) => x >= xDomain[0] * 0.999 && x <= xDomain[1] * 1.001
  const inY = (y: number) => y >= yDomain[0] * 0.999 && y <= yDomain[1] * 1.001
  const xMinor: number[] = []
  const xMajor: number[] = []
  for (const e of decades(...xDomain)) for (let k = 1; k <= 9; k++) (k === 1 ? xMajor : xMinor).push(k * 10 ** e)
  const yMinor: number[] = []
  const yMajor: number[] = []
  for (const e of decades(...yDomain)) for (let k = 1; k <= 9; k++) (k === 1 ? yMajor : yMinor).push(k * 10 ** e)
  const clip = `ps-ft-clip-${label.length}`
  return (
    <figure className="ps-plot ps-ft-logplot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <clipPath id={clip}>
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
        </defs>
        {xMinor.filter(inX).map((v) => (
          <line key={`xm${v}`} x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} className="ps-ft-grid-minor" />
        ))}
        {yMinor.filter(inY).map((v) => (
          <line key={`ym${v}`} x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="ps-ft-grid-minor" />
        ))}
        {xMajor.filter(inX).map((v) => (
          <g key={`xM${v}`}>
            <line x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} className="ps-plot-grid" />
            <text x={X(v)} y={H - m.b + 15} className="ps-plot-tick" textAnchor="middle">
              {tickText(v, xUnit)}
            </text>
          </g>
        ))}
        {[2, 5]
          .flatMap((k) => decades(...xDomain).map((e) => k * 10 ** e))
          .filter(inX)
          .map((v) => (
            <text key={`xl${v}`} x={X(v)} y={H - m.b + 15} className="ps-plot-tick ps-ft-tick-minor" textAnchor="middle">
              {tickText(v, xUnit)}
            </text>
          ))}
        {yMajor.filter(inY).map((v) => (
          <g key={`yM${v}`}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="ps-plot-grid" />
            <text x={m.l - 6} y={Y(v) + 4} className="ps-plot-tick" textAnchor="end">
              {sg(v, 2)}
            </text>
          </g>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 6} className="ps-plot-axis" textAnchor="middle">
          {xLabel}
        </text>
        <text x={13} y={(m.t + H - m.b) / 2} className="ps-plot-axis" textAnchor="middle" transform={`rotate(-90 13 ${(m.t + H - m.b) / 2})`}>
          {yLabel}
        </text>
        {vlines
          .filter((v) => inX(v.x))
          .map((v, k) => (
            <g key={`v${k}`}>
              <line x1={X(v.x)} x2={X(v.x)} y1={m.t} y2={H - m.b} className="ps-plot-ref" />
              <text x={X(v.x) - 4} y={m.t + 12 + k * 13} className="ps-plot-note" textAnchor="end">
                {v.label}
              </text>
            </g>
          ))}
        <g clipPath={`url(#${clip})`}>
          {series.map((s) => (
            <path
              key={s.id}
              d={s.points
                .filter((p) => p[0] > 0 && p[1] > 0 && Number.isFinite(p[1]))
                .map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`)
                .join('')}
              className="ps-plot-line"
              style={{ stroke: s.color }}
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          ))}
        </g>
        {series.map((s) => {
          const last = s.points.filter((p) => inX(p[0]) && inY(p[1])).pop()
          if (!last) return null
          return (
            <text key={`l${s.id}`} x={Math.min(X(last[0]) + 6, W - m.r + 6)} y={Math.max(m.t + 10, Math.min(H - m.b - 2, Y(last[1]) + 4))} className="ps-plot-direct">
              {s.id}
            </text>
          )
        })}
        {marks
          .filter((p) => inX(p.x) && inY(p.y))
          .map((p, k) => (
            <g key={`m${k}`}>
              <circle cx={X(p.x)} cy={Y(p.y)} r={4.5} className="ps-ft-mark" style={{ fill: p.color }} />
              <text x={X(p.x) + (p.left ? -8 : 8)} y={Y(p.y) + (p.below ? 15 : -7)} className="ps-ft-mark-label" textAnchor={p.left ? 'end' : 'start'}>
                {p.label}
              </text>
            </g>
          ))}
      </svg>
      <figcaption className="ps-plot-foot">
        <ul className="ps-plot-legend">
          {series.map((s) => (
            <li key={s.id}>
              <span className="ps-plot-key" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <span className="ps-plot-readout">log–log axes</span>
      </figcaption>
    </figure>
  )
}
