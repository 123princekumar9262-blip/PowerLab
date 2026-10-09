import type { ReactNode } from 'react'
import { MODE_LABEL, modesOf, type Lab, type Status } from '../catalogue/catalogue.ts'
import { href } from './router.ts'

const STATUS_TEXT: Record<Status, string> = { ready: 'Ready', 'in-development': 'In development', 'coming-soon': 'Coming soon' }

/** Status is always text (never colour alone). */
export function StatusTag({ status, quiet }: { status: Status; quiet?: boolean }) {
  if (quiet && status === 'ready') return null
  return <span className={`status status--${status}`}>{STATUS_TEXT[status]}</span>
}

export function Crumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((it, k) => (
          <li key={k}>{it.href && k < items.length - 1 ? <a href={it.href}>{it.label}</a> : <span aria-current={k === items.length - 1 ? 'page' : undefined}>{it.label}</span>}</li>
        ))}
      </ol>
    </nav>
  )
}

/** A lab as a compact card: glyph, title, one line, status — the whole card is the link. */
export function LabCard({ lab, detail, compact }: { lab: Lab; detail?: ReactNode; compact?: boolean }) {
  return (
    <a className={`lab-card ${compact ? 'lab-card--compact' : ''}`} href={href.lab(lab.id)}>
      <span className="lab-glyph" aria-hidden="true">
        {lab.glyph}
      </span>
      <span className="lab-card-body">
        <span className="lab-card-title">
          {lab.title} <StatusTag status={lab.status} quiet />
        </span>
        <span className="lab-card-line">{lab.tagline}</span>
        {detail && <span className="lab-card-detail">{detail}</span>}
      </span>
    </a>
  )
}

export const modesText = (lab: Lab) => modesOf(lab).map((m) => MODE_LABEL[m]).join(' · ')

export function PageHead({ eyebrow, title, lead, side }: { eyebrow?: string; title: string; lead?: ReactNode; side?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 tabIndex={-1}>{title}</h1>
        {lead && <p className="page-lead">{lead}</p>}
      </div>
      {side}
    </header>
  )
}
