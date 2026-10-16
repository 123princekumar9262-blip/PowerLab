import type { ReactNode } from 'react'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { fx } from '../../ui/format.ts'
import { Callout } from '../../ui/kit.tsx'
import type { Issue, SpanResult, StringResult } from './calc.ts'

export const MODULE = 'mechanical'
export const LP_HREF = '#/subjects/power-systems/line-params'
/** Insulator disc pitch and diameter used for DRAWING the string (a typical 146 mm × 254 mm disc; illustration). */
export const DISC_PITCH = 0.146
export const DISC_DIA = 0.254

export const kN = (n: number) => n / 1000
export const deg = (rad: number) => (rad * 180) / Math.PI
export const pctOf = (a: number, b: number) => ((a - b) / b) * 100
export const signedPct = (a: number, b: number, d = 2) => {
  const p = pctOf(a, b)
  return Math.abs(p) < 0.5 * 10 ** -d ? 'no change' : `${p > 0 ? '+' : '−'}${fx(Math.abs(p), d)} %`
}

/** A model's refusal: the reasons, and no numbers. */
export function Issues({ issues, title }: { issues: Issue[]; title: string }) {
  return (
    <Callout tone="bad" title={title}>
      <ul className="mech-issues">
        {issues.map((i, k) => (
          <li key={k}>{i.message}</li>
        ))}
      </ul>
    </Callout>
  )
}

/**
 * The colour of a disc from its share of the voltage relative to an equal share (r = V_k ÷ (V/n)): blue below an equal
 * share, grey at it, amber then red above it (log scale, saturating at ½× and 2×). Colour is never the only cue — every
 * disc's value is printed beside it.
 */
export function shareColor(r: number): string {
  const t = Math.max(-1, Math.min(1, Math.log2(Math.max(r, 1e-9))))
  const stops: Array<[number, [number, number, number]]> = [
    [-1, [79, 149, 234]],
    [0, [154, 166, 178]],
    [0.5, [224, 169, 28]],
    [1, [230, 103, 103]],
  ]
  let i = 0
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++
  const [t0, c0] = stops[i]
  const [t1, c1] = stops[i + 1]
  const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))
  const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** "VIT BEEE304L Modules 4 and 5 (named) · GATE EE Section 6 (insulators named)" from the syllabus mapping. */
export function SyllabusNote() {
  const ts = TOPICS.filter((t) => ['sag-tension', 'insulators-string-efficiency', 'corona'].includes(t.id))
  const vit = ts.map((t) => statusFor(t, 'vit-eee')).filter((s) => s.status === 'verified')
  const units = [...new Set(vit.map((s) => s.ref.unit))].sort()
  const course = vit[0]?.ref.where
  const short: Record<string, string> = { 'sag-tension': 'sag and tension', 'insulators-string-efficiency': 'insulators', corona: 'corona' }
  const names = (xs: typeof ts) => xs.map((t) => short[t.id]).join(' and ')
  const gNamed = ts.filter((t) => statusFor(t, 'gate-ee').status === 'verified')
  const gSupp = ts.filter((t) => statusFor(t, 'gate-ee').status === 'supplementary')
  return (
    <p className="small muted mech-syllabus">
      Syllabus: {course ? `VIT ${course} Module${units.length > 1 ? 's' : ''} ${units.join(' and ')} (${vit.length === ts.length ? 'all three topics named' : 'named'})` : 'VIT — not named'}
      {gNamed.length > 0 ? ` · GATE EE Section ${gNamed[0].gate.where} (${names(gNamed)} named${gSupp.length ? `; ${names(gSupp)} supplementary` : ''})` : ''}.
    </p>
  )
}

/** Live values for a selected part of the span scene. */
export function PartInfo({ id, res, str }: { id: string; res: SpanResult | null; str: StringResult | null }): ReactNode {
  const disc = /^disc-(\d+)$/.exec(id)
  if (disc) {
    if (!str) return <p className="small">No values: the string is not valid.</p>
    const k = Number(disc[1]) - 1
    const v = str.discV[k]
    const n = str.input.n
    const rank = [...str.discV].sort((a, b) => b - a).indexOf(v) + 1
    return (
      <dl className="mech-info">
        <div>
          <dt>Voltage across it</dt>
          <dd>{fx(v, 2)} kV</dd>
        </div>
        <div>
          <dt>Share of phase voltage</dt>
          <dd>{fx((v / str.V) * 100, 1)} %</dd>
        </div>
        <div>
          <dt>Equal share would be</dt>
          <dd>{fx(str.V / n, 2)} kV</dd>
        </div>
        <div>
          <dt>Stress rank</dt>
          <dd>{Math.abs(str.discV[str.maxIdx] - str.discV[0]) < 1e-9 * str.V ? 'all equal' : `${rank} of ${n}`}</dd>
        </div>
        {str.input.grading === 'capacitance' && (
          <div>
            <dt>Its capacitance</dt>
            <dd>{fx(str.discC[k], 3)} C</dd>
          </div>
        )}
      </dl>
    )
  }
  if (!res) return <p className="small">No values: the span is not valid.</p>
  const level = res.input.h === 0
  if (id === 'conductor')
    return (
      <dl className="mech-info">
        <div>
          <dt>Load w_r</dt>
          <dd>{fx(res.loads.wr, 2)} N/m</dd>
        </div>
        <div>
          <dt>T₀ (lowest point)</dt>
          <dd>{fx(kN(res.T0), 2)} kN</dd>
        </div>
        <div>
          <dt>T at the supports</dt>
          <dd>{level ? `${fx(kN(res.Tmax), 3)} kN` : `${fx(kN(res.cat.TA), 2)} / ${fx(kN(res.cat.TB), 2)} kN`}</dd>
        </div>
        <div>
          <dt>Factor of safety</dt>
          <dd>{fx(res.fosActual, 2)}</dd>
        </div>
        <div>
          <dt>Length in the span</dt>
          <dd>{fx(res.cat.length, 3)} m</dd>
        </div>
      </dl>
    )
  if (id === 'low')
    return (
      <dl className="mech-info">
        <div>
          <dt>Distance from support A</dt>
          <dd>{fx(res.low.x, 1)} m</dd>
        </div>
        <div>
          <dt>{level ? 'Vertical sag' : 'Below support A / B'}</dt>
          <dd>{level ? `${fx(res.vSagA, 3)} m` : `${fx(res.vSagA, 2)} / ${fx(res.vSagB, 2)} m`}</dd>
        </div>
        {res.loads.theta > 0 && (
          <div>
            <dt>Sideways swing</dt>
            <dd>{fx(res.low.z, 2)} m</dd>
          </div>
        )}
        <div>
          <dt>Ground clearance</dt>
          <dd>{fx(res.clearance, 2)} m</dd>
        </div>
      </dl>
    )
  if (id === 'ground')
    return (
      <dl className="mech-info">
        <div>
          <dt>Clearance at the lowest point</dt>
          <dd>{fx(res.clearance, 2)} m</dd>
        </div>
        <div>
          <dt>Minimum you set</dt>
          <dd>{fx(res.input.minClear, 1)} m</dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd className={res.clearance < res.input.minClear ? 'mech-bad' : ''}>{fx(res.clearance - res.input.minClear, 2)} m</dd>
        </div>
      </dl>
    )
  if (id === 'towers')
    return (
      <dl className="mech-info">
        <div>
          <dt>Support A height</dt>
          <dd>{fx(res.input.hA, 1)} m</dd>
        </div>
        <div>
          <dt>Support B height</dt>
          <dd>{fx(res.input.hA + res.input.h, 1)} m</dd>
        </div>
        <div>
          <dt>Span</dt>
          <dd>{fx(res.input.L, 0)} m</dd>
        </div>
        <div>
          <dt>Pull on each support</dt>
          <dd>{level ? `${fx(kN(res.Tmax), 2)} kN` : `${fx(kN(res.cat.TA), 2)} / ${fx(kN(res.cat.TB), 2)} kN`}</dd>
        </div>
      </dl>
    )
  return null
}
