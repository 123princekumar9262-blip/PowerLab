import { statusFor } from '../../syllabus/coverage.ts'
import { VIT_COURSE_TITLES } from '../../syllabus/sources.ts'
import { TOPICS } from '../../syllabus/topics.ts'

export const MODULE = 'distribution'

/** Money and large figures with Indian digit grouping (2,40,000), a true minus sign, '—' if not finite. */
export function grp(x: number, decimals = 0): string {
  if (!Number.isFinite(x)) return '—'
  const v = Math.abs(x) < 0.5 * 10 ** -decimals ? 0 : x
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace('-', '−')
}
export const rupees = (x: number) => `₹${grp(x, 0)}`

/** A small number in scientific form (an agreement between two methods), otherwise fixed. */
export function tiny(x: number, d = 3): string {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  if (Math.abs(x) >= 10 ** -d) return x.toFixed(d).replace('-', '−')
  const [m, e] = x.toExponential(1).split('e')
  const sup = (s: string) => s.replace(/[-0-9]/g, (ch) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(ch)])
  return `${m.replace('-', '−')} × 10${sup(String(Number(e)))}`
}

/** Where this module's topics appear in the student's syllabi (from the verified mapping, never invented). */
export function SyllabusNote() {
  const ts = TOPICS.filter((t) => t.module === MODULE)
  return (
    <ul className="ds-syllabus" aria-label="Syllabus">
      {ts.map((t) => {
        const g = statusFor(t, 'gate-ee')
        const v = statusFor(t, 'vit-eee')
        const gate = g.status === 'verified' || g.status === 'partial' ? `GATE EE Section ${g.ref.where} (“${g.ref.quote}”)` : 'not named in GATE EE'
        const vit =
          v.status === 'supplementary' && v.elective
            ? `VIT ${v.ref.where} Module ${v.ref.unit} — ${VIT_COURSE_TITLES[v.ref.where!] ?? v.elective}, supplementary for you`
            : v.status === 'verified' || v.status === 'partial'
              ? `VIT ${v.ref.where} Module ${v.ref.unit} (“${v.ref.quote}”)`
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

/** The label every conceptual picture carries. */
export function Illus({ children }: { children: string }) {
  return <p className="ds-illus">Illustration — {children}</p>
}
