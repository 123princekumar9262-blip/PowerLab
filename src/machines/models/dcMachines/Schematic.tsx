import { Html } from '../../viewer/Html.tsx'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { useViewer } from '../../viewer/context.tsx'
import type { Kind } from './geometry.ts'
import './dcm.css'

/*
 * Screen-fixed insets for the wound-field DC machines (conceptual, readable without animation):
 *  - ConnectionInset: the field connection as a small circuit, with the conventional currents Ia, If, IL as moving
 *    dashes in their real direction and their calculated values;
 *  - EmfInset (generator): one coil's alternating EMF and the unidirectional voltage the commutator delivers.
 */

type Pt = [number, number]
const fmtA = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)} A`)
const pts = (p: Pt[]) => p.map((q) => q.join(',')).join(' ')

/** Moving dashes along a polyline; `rate` sign = direction of conventional current (0 = no current). */
const Flow = ({ p, rate }: { p: Pt[]; rate: number }) => <polyline className="dcm-flow" data-rate={rate} points={pts(p)} style={{ opacity: rate === 0 ? 0 : 1 }} />

/** Advances the dashes of every Flow inside `svg` while the animation plays. */
function useFlow() {
  const v = useViewer()
  const svg = useRef<SVGSVGElement>(null)
  const off = useRef(0)
  useFrame((_, dt) => {
    if (v.reducedMotion || !v.anim.current.playing || !svg.current) return
    off.current -= Math.min(dt, 0.05) * 22
    svg.current.querySelectorAll<SVGPolylineElement>('.dcm-flow').forEach((el) => {
      el.style.strokeDashoffset = String(off.current * Number(el.dataset.rate ?? 0))
    })
  })
  return svg
}

const Wire = ({ p }: { p: Pt[] }) => <polyline className="dcm-wire" points={pts(p)} />
/** Battery between y−4 (long plate, +) and y+4. */
const Battery = ({ x, y, label }: { x: number; y: number; label: string }) => (
  <g>
    <line className="dcm-sym" x1={x - 10} x2={x + 10} y1={y - 4} y2={y - 4} />
    <line className="dcm-sym dcm-thick" x1={x - 5} x2={x + 5} y1={y + 4} y2={y + 4} />
    <text className="dcm-t" x={x - 15} y={y - 6} textAnchor="end">+</text>
    <text className="dcm-t dcm-b" x={x + 14} y={y + 3}>{label}</text>
  </g>
)
const Armature = ({ x, y, t1 = 'A1', t2 = 'A2' }: { x: number; y: number; t1?: string; t2?: string }) => (
  <g>
    <circle className="dcm-sym" cx={x} cy={y} r={13} />
    <rect className="dcm-brush" x={x - 4} y={y - 17} width={8} height={5} />
    <rect className="dcm-brush" x={x - 4} y={y + 12} width={8} height={5} />
    <text className="dcm-t dcm-b" x={x} y={y + 3.5} textAnchor="middle">A</text>
    <text className="dcm-t dcm-s" x={x + 9} y={y - 18}>{t1}</text>
    <text className="dcm-t dcm-s" x={x + 9} y={y + 25}>{t2}</text>
  </g>
)
/** A coil drawn as bumps: vertical from (x, y0) to (x, y1) bulging right, or horizontal bulging up. */
function Coil({ x0, y0, x1, y1, bumps, heavy, t1, t2 }: { x0: number; y0: number; x1: number; y1: number; bumps: number; heavy?: boolean; t1: string; t2: string }) {
  const vertical = x0 === x1
  const len = vertical ? y1 - y0 : x1 - x0
  const r = len / bumps / 2
  let d = `M ${x0} ${y0}`
  for (let i = 0; i < bumps; i++) d += vertical ? ` a ${r} ${r} 0 0 1 0 ${2 * r}` : ` a ${r} ${r} 0 0 1 ${2 * r} 0`
  return (
    <g>
      <path className={`dcm-coil ${heavy ? 'dcm-coil--heavy' : ''}`} d={d} />
      {vertical ? (
        <>
          <text className="dcm-t dcm-s" x={x0 - 4} y={y0 + 2} textAnchor="end">{t1}</text>
          <text className="dcm-t dcm-s" x={x0 - 4} y={y1 + 2} textAnchor="end">{t2}</text>
        </>
      ) : (
        <>
          <text className="dcm-t dcm-s" x={x0} y={y0 + 12} textAnchor="middle">{t1}</text>
          <text className="dcm-t dcm-s" x={x1} y={y0 + 12} textAnchor="middle">{t2}</text>
        </>
      )}
    </g>
  )
}

const TITLE: Record<Kind, string> = {
  generator: 'Generator: Vf feeds the field, the armature feeds the load',
  separate: 'Separately excited: two independent supplies',
  shunt: 'Shunt: field in parallel (links E1–A1, A2–E2)',
  series: 'Series: one current (link A2–D1)',
  compound: 'Long-shunt compound (E1–A1, A2–D1, D2–E2)',
}

export function ConnectionInset({ kind, calc, sense }: { kind: Kind; calc: Record<string, number | null>; sense: number }) {
  const svg = useFlow()
  // the inset takes at most about a third of the viewport width
  const width = Math.round(Math.max(200, Math.min(260, useThree((st) => st.size.width) * 0.32)))
  const ia = calc.ia ?? null
  const iff = calc.if ?? null
  const il = calc.il ?? null
  const sgn = (x: number | null) => (x === null || x === 0 ? 0 : Math.sign(x))
  const rIa = sgn(ia)
  const rIf = sgn(iff)
  const rIl = sgn(il)
  let body: React.ReactNode
  if (kind === 'shunt' || kind === 'compound') {
    const xs = kind === 'shunt' ? 108 : 86
    const xa = 205
    body = (
      <>
        <Wire p={[[24, 67], [24, 22], [kind === 'shunt' ? xa : 118, 22]]} />
        {kind === 'compound' && <Wire p={[[168, 22], [xa, 22]]} />}
        <Wire p={[[24, 75], [24, 128], [xa, 128], [xa, 88]]} />
        <Wire p={[[xa, 22], [xa, 62]]} />
        <Wire p={[[xs, 22], [xs, 48]]} />
        <Wire p={[[xs, 102], [xs, 128]]} />
        <Battery x={24} y={71} label="V" />
        <Coil x0={xs} y0={48} x1={xs} y1={102} bumps={6} t1="E1" t2="E2" />
        {kind === 'compound' && <Coil x0={118} y0={22} x1={168} y1={22} bumps={3} heavy t1="D1" t2="D2" />}
        <Armature x={xa} y={75} />
        <Flow p={[[24, 67], [24, 22], [xs, 22]]} rate={rIl} />
        <Flow p={[[xs, 22], [xs, 48]]} rate={rIf} />
        <Flow p={[[xs, 102], [xs, 128]]} rate={rIf} />
        <Flow p={kind === 'shunt' ? [[xs, 22], [xa, 22], [xa, 62]] : [[xs, 22], [118, 22]]} rate={rIa} />
        {kind === 'compound' && <Flow p={[[168, 22], [xa, 22], [xa, 62]]} rate={rIa} />}
        <Flow p={[[xa, 88], [xa, 128], [xs, 128]]} rate={rIa} />
        <Flow p={[[xs, 128], [24, 128], [24, 75]]} rate={rIl} />
        <text className="dcm-t dcm-cur" x={30} y={15}>IL {fmtA(il)}</text>
        <text className="dcm-t dcm-cur" x={xs + 14} y={78}>If {fmtA(iff)}</text>
        <text className="dcm-t dcm-cur" x={kind === 'shunt' ? 140 : 140} y={kind === 'shunt' ? 15 : 46}>Ia {fmtA(ia)}</text>
        {kind === 'compound' && (
          <text className="dcm-t dcm-s" x={120} y={142} textAnchor="middle">
            {sense > 0 ? 'cumulative: Φ = Φsh + Φse' : 'differential: Φ = Φsh − Φse'}
          </text>
        )}
      </>
    )
  } else if (kind === 'series') {
    body = (
      <>
        <Wire p={[[24, 67], [24, 22], [80, 22]]} />
        <Wire p={[[140, 22], [200, 22], [200, 62]]} />
        <Wire p={[[200, 88], [200, 128], [24, 128], [24, 75]]} />
        <Battery x={24} y={71} label="V" />
        <Coil x0={80} y0={22} x1={140} y1={22} bumps={3} heavy t1="D1" t2="D2" />
        <Armature x={200} y={75} />
        <Flow p={[[24, 67], [24, 22], [80, 22]]} rate={rIa} />
        <Flow p={[[140, 22], [200, 22], [200, 62]]} rate={rIa} />
        <Flow p={[[200, 88], [200, 128], [24, 128], [24, 75]]} rate={rIa} />
        <text className="dcm-t dcm-cur" x={110} y={68} textAnchor="middle">Ia = If = IL</text>
        <text className="dcm-t dcm-cur" x={110} y={82} textAnchor="middle">{fmtA(ia)}</text>
      </>
    )
  } else {
    // two circuits: the field loop (left) and the armature loop (right)
    const gen = kind === 'generator'
    const xa = gen ? 140 : 210
    body = (
      <>
        <Wire p={[[20, 67], [20, 22], [80, 22], [80, 48]]} />
        <Wire p={[[80, 102], [80, 128], [20, 128], [20, 75]]} />
        <Battery x={20} y={71} label="Vf" />
        <Coil x0={80} y0={48} x1={80} y1={102} bumps={6} t1="F1" t2="F2" />
        <Flow p={[[20, 67], [20, 22], [80, 22], [80, 48]]} rate={rIf} />
        <Flow p={[[80, 102], [80, 128], [20, 128], [20, 75]]} rate={rIf} />
        <text className="dcm-t dcm-cur" x={30} y={15}>If {fmtA(iff)}</text>
        {gen ? (
          <>
            <Wire p={[[xa, 62], [xa, 22], [210, 22], [210, 50]]} />
            <Wire p={[[210, 100], [210, 128], [xa, 128], [xa, 88]]} />
            <path className="dcm-sym" d="M 210 50 l 7 4 l -14 6 l 14 6 l -14 6 l 14 6 l -14 6 l 14 6 l -7 4" />
            <text className="dcm-t dcm-b" x={226} y={79}>RL</text>
            <text className="dcm-t" x={222} y={44}>+</text>
            <text className="dcm-t" x={222} y={112}>−</text>
            <Armature x={xa} y={75} />
            <path className="dcm-pm" d={`M ${xa - 22} 92 A 24 24 0 0 1 ${xa - 22} 58`} />
            <path className="dcm-pm-head" d={`M ${xa - 22} 58 l -4 8 l 8 -2 z`} />
            <text className="dcm-t dcm-s" x={xa - 30} y={76} textAnchor="end">driven</text>
            <Flow p={[[xa, 62], [xa, 22], [210, 22], [210, 50]]} rate={rIa} />
            <Flow p={[[210, 100], [210, 128], [xa, 128], [xa, 88]]} rate={rIa} />
            <text className="dcm-t dcm-cur" x={150} y={15}>IL = Ia {fmtA(ia)}</text>
          </>
        ) : (
          <>
            <Wire p={[[130, 67], [130, 22], [xa, 22], [xa, 62]]} />
            <Wire p={[[xa, 88], [xa, 128], [130, 128], [130, 75]]} />
            <Battery x={130} y={71} label="Va" />
            <Armature x={xa} y={75} />
            <Flow p={[[130, 67], [130, 22], [xa, 22], [xa, 62]]} rate={rIa} />
            <Flow p={[[xa, 88], [xa, 128], [130, 128], [130, 75]]} rate={rIa} />
            <text className="dcm-t dcm-cur" x={140} y={15}>Ia {fmtA(ia)}</text>
            {rIa < 0 && <text className="dcm-t dcm-s" x={170} y={142} textAnchor="middle">Ia reversed: generating</text>}
          </>
        )}
      </>
    )
  }
  return (
    <Html calculatePosition={(_el, _cam, size) => [10, size.height - 34]} zIndexRange={[14, 0]} style={{ pointerEvents: 'none' }}>
      <figure className="dcm-inset dcm-inset--conn" style={{ width }} aria-label="Field connection and currents">
        <figcaption>{TITLE[kind]}</figcaption>
        <svg ref={svg} viewBox="0 0 240 148" role="img">
          {body}
        </svg>
      </figure>
    </Html>
  )
}

/** Generator: EMF of one coil (alternating) and the voltage at the brushes (one direction), with the rotor angle. */
export function EmfInset() {
  const v = useViewer()
  const width = Math.round(Math.max(200, Math.min(250, useThree((st) => st.size.width) * 0.3)))
  const cursor = useRef<SVGGElement>(null)
  const X0 = 22
  const W = 196
  const Y0 = 56
  const A = 34
  const N = 96
  const x = (t: number) => X0 + (t / (2 * Math.PI)) * W
  const trace = (f: (t: number) => number) => Array.from({ length: N + 1 }, (_, i) => (2 * Math.PI * i) / N).map((t) => `${x(t).toFixed(1)},${(Y0 - A * f(t)).toFixed(1)}`).join(' ')
  // the 4 coils between the brushes, shifted by one slot pitch (π/4): their rectified EMFs add (normalised)
  const all = (t: number) => [0, 1, 2, 3].reduce((s, k) => s + Math.abs(Math.cos(t - (k * Math.PI) / 4)), 0) / 2.6131
  useFrame(() => {
    const t = (((-v.anim.current.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    if (cursor.current) cursor.current.setAttribute('transform', `translate(${(x(t) - X0).toFixed(2)},0)`)
  })
  return (
    <Html calculatePosition={(_el, _cam, size) => [size.width - 10, size.width < 520 ? 96 : 50]} zIndexRange={[14, 0]} style={{ pointerEvents: 'none' }}>
      <figure className="dcm-inset dcm-inset--emf" style={{ width }} aria-label="Coil EMF and brush voltage">
        <figcaption>EMF: one coil vs at the brushes</figcaption>
        <svg viewBox="0 0 230 112" role="img">
          <line className="dcm-axis" x1={X0} x2={X0 + W} y1={Y0} y2={Y0} />
          <line className="dcm-axis" x1={X0} x2={X0} y1={Y0 - A - 6} y2={Y0 + A + 6} />
          <text className="dcm-t dcm-s" x={X0 - 4} y={Y0 + 3} textAnchor="end">0</text>
          <text className="dcm-t dcm-s" x={X0 + W} y={Y0 + A + 14} textAnchor="end">rotor angle: one turn →</text>
          <polyline className="dcm-coilemf" points={trace((t) => Math.cos(t))} />
          <polyline className="dcm-brushv" points={trace((t) => Math.abs(Math.cos(t)))} />
          <polyline className="dcm-allv" points={trace(all)} />
          <g ref={cursor}>
            <line className="dcm-cursor" x1={X0} x2={X0} y1={Y0 - A - 4} y2={Y0 + A + 4} />
          </g>
        </svg>
        <p className="dcm-key">
          <span className="dcm-k1">— — one coil (alternating)</span> <span className="dcm-k2">—— one coil at the brushes</span> <span className="dcm-k3">—— all coils in series: nearly steady DC</span>
        </p>
      </figure>
    </Html>
  )
}
