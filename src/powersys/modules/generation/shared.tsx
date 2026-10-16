import { useMemo } from 'react'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { fx } from '../../ui/format.ts'
import { Callout } from '../../ui/kit.tsx'
import { hydro, nuclear, pumped, thermal, type Plants } from './calc.ts'

export const MODULE = 'generation'
export const ECON_HREF = '#/subjects/power-systems/economic'
export const LFC_HREF = '#/subjects/power-systems/gen-control'
export const STAB_HREF = '#/subjects/power-systems/stability'

/** A number with thousands grouping and fixed decimals (1 388.9), a true minus sign, never NaN. */
export function grp(x: number, decimals = 0): string {
  if (!Number.isFinite(x)) return '—'
  const s = Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return (x < 0 && Math.abs(x) >= 0.5 * 10 ** -decimals ? '−' : '') + s
}
/** A large count in scientific form: 9.46 × 10¹⁹. */
export function sci(x: number, sig = 3): string {
  if (!Number.isFinite(x) || x === 0) return fx(x, 0)
  const e = Math.floor(Math.log10(Math.abs(x)))
  const m = x / 10 ** e
  const sup = String(e)
    .split('')
    .map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)] ?? (c === '-' ? '⁻' : c))
    .join('')
  return `${m.toFixed(sig - 1)} × 10${sup}`
}
export const pc = (x: number, d = 1) => `${fx(x * 100, d)} %`

/** Every station's computed result for the current inputs. */
export function usePlants(p: Plants) {
  return useMemo(() => ({ thermal: thermal(p.thermal), hydro: hydro(p.hydro), nuclear: nuclear(p.nuclear), pumped: pumped(p.pumped) }), [p])
}
export type PlantResults = ReturnType<typeof usePlants>

/** Inputs the model refuses: the reasons, and no numbers. */
export function Invalid({ issues }: { issues: string[] }) {
  return (
    <Callout tone="bad" title="These inputs are not physically possible — no results">
      <ul className="gen-issues">
        {issues.map((i, k) => (
          <li key={k}>{i}</li>
        ))}
      </ul>
    </Callout>
  )
}

/** "VIT BEEE304L Module 1 · BEEE306L Module 6 · GATE EE Section 6" from the syllabus mapping (never invented). */
export function SyllabusNote({ ids }: { ids: string[] }) {
  const ts = TOPICS.filter((t) => ids.includes(t.id))
  const vit = ts.map((t) => statusFor(t, 'vit-eee')).filter((s) => s.status === 'verified')
  const gate = ts.map((t) => statusFor(t, 'gate-ee'))
  const gateNamed = gate.filter((s) => s.status === 'verified' || s.status === 'partial')
  const vitText = vit.length ? vit.map((s) => `VIT ${s.ref.where} Module ${s.ref.unit}`).join(' and ') + ' (named)' : 'VIT — not named'
  const gateText = gateNamed.length
    ? `GATE EE Section ${[...new Set(gateNamed.map((s) => s.ref.where))].join(', ')} (named)`
    : gate.some((s) => s.status === 'supplementary')
      ? 'GATE EE — supplementary (not named in the syllabus)'
      : ''
  return (
    <p className="small muted gen-syllabus">
      Syllabus: {vitText}
      {gateText ? ` · ${gateText}` : ''}.
    </p>
  )
}
