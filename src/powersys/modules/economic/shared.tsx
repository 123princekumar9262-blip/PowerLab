import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { VIT_COURSE_TITLES } from '../../syllabus/sources.ts'
import { fx } from '../../ui/format.ts'
import type { Combo } from './commitment.ts'
import { CURRENCY, type Currency, type DispatchOk, type Unit } from './dispatch.ts'
import { grp } from './fmt.ts'

export const MODULE = 'economic'

/** λ and costs: few decimals for rupee magnitudes, more for the textbook's dollars. */
export const lamD = (cur: Currency) => (cur === 'USD' ? 3 : 1)
export const costD = (cur: Currency) => (cur === 'USD' ? 1 : 0)
export const money = (x: number, cur: Currency) => `${grp(x, costD(cur))} ${CURRENCY[cur].perH}`
export const perMwh = (x: number, cur: Currency) => `${fx(x, lamD(cur))} ${CURRENCY[cur].perMWh}`

/** A small number in scientific form (a mismatch that has converged), otherwise fixed. */
export function tiny(x: number, d = 3): string {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  if (Math.abs(x) >= 10 ** -d) return fx(x, d)
  const [m, e] = x.toExponential(1).split('e')
  const sup = (s: string) => s.replace(/[-0-9]/g, (ch) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(ch)])
  return `${m.replace('-', '−')} × 10${sup(String(Number(e)))}`
}

/** The λ-iteration, row by row. */
export function LambdaTable({ units, d, cur, caption }: { units: Unit[]; d: DispatchOk; cur: Currency; caption?: string }) {
  const withLoss = d.steps.some((s) => s.loss > 1e-12)
  const on = units.map((u, i) => (u.on ? i : -1)).filter((i) => i >= 0)
  return (
    <div className="ed-table-wrap">
      <table className="ps-table ed-table ed-lambda-table">
        <caption className="sr-only">{caption ?? 'λ-iteration'}</caption>
        <thead>
          <tr>
            <th scope="col">k</th>
            <th scope="col">λ [{CURRENCY[cur].perMWh}]</th>
            {on.map((i) => (
              <th key={i} scope="col">
                P{i + 1} [MW]
              </th>
            ))}
            <th scope="col">ΣP [MW]</th>
            {withLoss && <th scope="col">P_L [MW]</th>}
            <th scope="col">ΣP − P_D{withLoss ? ' − P_L' : ''}</th>
            <th scope="col">Next λ by</th>
          </tr>
        </thead>
        <tbody>
          {d.steps.map((s) => (
            <tr key={s.k}>
              <td>{s.k}</td>
              <td>{fx(s.lambda, cur === 'USD' ? 5 : 3)}</td>
              {on.map((i) => (
                <td key={i}>{fx(s.P[i], 3)}</td>
              ))}
              <td>{fx(s.sumP, 3)}</td>
              {withLoss && <td>{fx(s.loss, 4)}</td>}
              <td>{tiny(s.mismatch, 3)}</td>
              <td>{s.next === 'done' ? 'converged' : s.next === 'newton' ? 'Newton step' : 'bisection'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The optimality conditions unit by unit (free: L·IC = λ; at P_min: ≥ λ; at P_max: ≤ λ). */
export function KktTable({ units, d, cur }: { units: Unit[]; d: DispatchOk; cur: Currency }) {
  const withLoss = d.loss > 1e-12
  const tol = 1e-6 * Math.max(1, d.lambda)
  return (
    <div className="ed-table-wrap">
      <table className="ps-table ed-table">
        <caption className="sr-only">Optimality conditions for each unit</caption>
        <thead>
          <tr>
            <th scope="col">Unit</th>
            <th scope="col">P [MW]</th>
            <th scope="col">IC [{CURRENCY[cur].perMWh}]</th>
            {withLoss && <th scope="col">∂P_L/∂P</th>}
            {withLoss && <th scope="col">L</th>}
            {withLoss && <th scope="col">L · IC</th>}
            <th scope="col">State</th>
            <th scope="col">Condition</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => {
            if (!u.on)
              return (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td colSpan={withLoss ? 7 : 4}>off</td>
                </tr>
              )
            const eff = d.ic[i] * d.pf[i]
            const lim = d.limit[i]
            const holds = lim === null ? Math.abs(eff - d.lambda) <= tol : lim === 'min' ? eff >= d.lambda - tol : eff <= d.lambda + tol
            const cond = lim === null ? `${withLoss ? 'L·IC' : 'IC'} = λ` : lim === 'min' ? `${withLoss ? 'L·IC' : 'IC'} ≥ λ` : `${withLoss ? 'L·IC' : 'IC'} ≤ λ`
            return (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{fx(d.P[i], 2)}</td>
                <td>{fx(d.ic[i], lamD(cur) + 1)}</td>
                {withLoss && <td>{fx(d.itl[i], 4)}</td>}
                {withLoss && <td>{fx(d.pf[i], 4)}</td>}
                {withLoss && <td>{fx(eff, lamD(cur) + 1)}</td>}
                <td>{lim === null ? 'between limits' : `at P_${lim}`}</td>
                <td>
                  {holds ? '✓ ' : '✗ '}
                  {cond}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Every on/off combination at one load: feasible or why not, its dispatch and cost. */
export function ComboTable({ units, combos, best, pl, cur }: { units: Unit[]; combos: Combo[]; best: Combo | null; pl: Combo | null; cur: Currency }) {
  return (
    <div className="ed-table-wrap">
      <table className="ps-table ed-table ed-combos">
        <caption className="sr-only">All on/off combinations</caption>
        <thead>
          <tr>
            <th scope="col">Units on</th>
            <th scope="col">Range [MW]</th>
            {units.map((u) => (
              <th key={u.id} scope="col">
                {u.name.replace('Unit ', 'P')} [MW]
              </th>
            ))}
            <th scope="col">Cost [{CURRENCY[cur].perH}]</th>
            <th scope="col">vs best</th>
          </tr>
        </thead>
        <tbody>
          {combos.map((k) => (
            <tr key={k.mask} className={`${k.feasible ? '' : 'is-infeasible'} ${best && k.mask === best.mask ? 'is-best' : ''} ${pl && k.mask === pl.mask ? 'is-pl' : ''}`}>
              <td>{k.label}</td>
              <td>{k.on.some(Boolean) ? `${fx(k.capMin, 0)}–${fx(k.capMax, 0)}` : '—'}</td>
              {k.dispatch ? (
                units.map((u, i) => <td key={u.id}>{k.on[i] ? fx(k.dispatch!.P[i], 1) : '—'}</td>)
              ) : (
                <td colSpan={units.length} className="ed-why">
                  {k.why}
                </td>
              )}
              <td>{k.cost === null ? 'infeasible' : grp(k.cost, costD(cur))}</td>
              <td>{k.cost === null || !best ? '' : k.mask === best.mask ? 'best' : `+${grp(k.cost - best.cost!, costD(cur))}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Where this module's topics appear in the student's syllabi (from the verified mapping, never invented). */
export function SyllabusNote() {
  const ts = TOPICS.filter((t) => t.module === 'economic')
  return (
    <ul className="ed-syllabus" aria-label="Syllabus">
      {ts.map((t) => {
        const g = statusFor(t, 'gate-ee')
        const v = statusFor(t, 'vit-eee')
        const gate = g.status === 'verified' || g.status === 'partial' ? `GATE EE Section ${g.ref.where}` : 'not named in GATE EE'
        const vit =
          v.status === 'supplementary' && v.elective
            ? `VIT ${v.ref.where} Module ${v.ref.unit} — ${VIT_COURSE_TITLES[v.ref.where!] ?? v.elective}, supplementary for you`
            : v.status === 'verified' || v.status === 'partial'
              ? `VIT ${v.ref.where} Module ${v.ref.unit}`
              : 'not named in your VIT courses'
        return (
          <li key={t.id}>
            <b>{t.title}</b> — {gate} · {vit}
          </li>
        )
      })}
    </ul>
  )
}
