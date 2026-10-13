import { CONCEPTS, ENGINEERING, LABS, labById, targetOf, topicOf, type Status } from './catalogue.ts'
import { GUIDE } from '../guide/content.ts'
import { MACHINES } from '../machines/catalog.ts'
import { href } from '../shell/router.ts'
import { homeOfLab, homeOfMachine, SUBJECTS, topicCounts } from './subjects.ts'
import { psModule } from '../powersys/catalog.ts'

/**
 * Search over the platform's own content only — built from the catalogue (labs, circuits and topics,
 * entry points, practice areas, concepts). No separate knowledge base: adding a topic to the catalogue
 * makes it findable. The Lab guide's pages are indexed too (below the circuits they explain).
 */
export type ResultKind = 'Subject' | 'Lab' | 'Circuit' | 'Topic' | 'Concept' | 'Practice' | 'Guide' | '3D model'

export interface SearchEntry {
  kind: ResultKind
  title: string
  /** Where it lives ("Rectifiers", "Practice"). */
  context: string
  /** The subject it belongs to (shown with the result), when it belongs to one. */
  subject?: string
  detail: string
  status: Status
  hash: string
  /** Lower-cased words weighted for matching. */
  terms: { title: string; keys: string; text: string }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9°α-ω+/ -]+/g, ' ')
    .replace(/-/g, ' ')

let index: SearchEntry[] | null = null

export function searchIndex(): SearchEntry[] {
  if (index) return index
  const out: SearchEntry[] = []
  // the subjects, and the topics that have a page of their own (the others are their labs, below)
  for (const s of SUBJECTS) {
    out.push({ kind: 'Subject', title: s.title, context: 'Subjects', detail: s.description, status: 'ready', hash: href.subject(s.id), terms: { title: norm(s.title), keys: norm(s.topics.map((t) => t.title).join(' ')), text: norm(s.description) } })
    for (const t of s.topics)
      if (s.id !== 'power-electronics' || (t.labs?.length ?? 0) !== 1) {
        const c = topicCounts(t)
        const m = t.modules?.length ? psModule(t.modules[0]) : undefined
        if (m) {
          out.push({ kind: 'Topic', title: m.title, context: s.title, subject: s.title, detail: `Module ${m.n} · ${m.line}`, status: m.status === 'ready' ? 'ready' : 'in-development', hash: href.subject(s.id, t.id), terms: { title: norm(m.title), keys: norm(m.keywords.join(' ')), text: norm(m.line) } })
          continue
        }
        out.push({ kind: 'Topic', title: t.title, context: s.title, subject: s.title, detail: `${t.line} · ${c.models} 3D model${c.models === 1 ? '' : 's'}`, status: 'ready', hash: href.subject(s.id, t.id), terms: { title: norm(t.title), keys: '', text: norm(t.line) } })
      }
  }
  const subjectOfLab = (id: string) => homeOfLab(id)?.subject.title
  for (const lab of LABS) {
    out.push({ kind: 'Lab', title: lab.title, context: 'Labs', subject: subjectOfLab(lab.id), detail: lab.tagline, status: lab.status, hash: href.lab(lab.id), terms: { title: norm(lab.title), keys: norm(lab.keywords.join(' ')), text: norm(`${lab.tagline} ${lab.description}`) } })
    for (const t of lab.topics) {
      const tgt = targetOf(lab, t)
      const ready = t.status === 'ready'
      out.push({
        kind: t.opens ? 'Topic' : lab.id === 'rectifiers' || lab.id === 'dc-dc' || lab.id === 'inverters' ? 'Circuit' : 'Topic',
        title: t.title,
        // the section tells same-named circuits apart (single- vs three-phase fully controlled bridge)
        context: `${lab.title} › ${t.section}`,
        subject: subjectOfLab(lab.id),
        detail: t.purpose,
        status: t.status,
        // coming-soon items lead to their lab's landing page, never into a workspace
        hash: ready ? href.workspace(tgt.lab, tgt.topic, tgt.mode, tgt.query) : href.lab(lab.id),
        terms: { title: norm(t.title), keys: norm((t.keywords ?? []).join(' ')), text: norm(`${t.purpose} ${t.section}`) },
      })
    }
  }
  for (const a of ENGINEERING)
    out.push({
      kind: 'Practice',
      title: a.title,
      context: 'Practice',
      subject: 'Power Electronics',
      detail: a.purpose,
      status: a.status,
      hash: href.engineering(a.id),
      terms: { title: norm(a.title), keys: norm(a.keywords.join(' ')), text: norm(`${a.purpose} ${a.description}`) },
    })
  for (const c of CONCEPTS) {
    const lab = labById(c.lab)!
    const t = topicOf(lab, c.topic)!
    const tgt = targetOf(lab, t)
    out.push({ kind: 'Concept', title: c.term, context: lab.title, subject: subjectOfLab(lab.id), detail: c.note, status: 'ready', hash: href.workspace(tgt.lab, tgt.topic, tgt.mode, tgt.query), terms: { title: norm(c.term), keys: norm(c.aliases.join(' ')), text: norm(c.note) } })
  }
  // the 3D Machines Lab (plain catalogue data; a planned model leads to its honest "planned" page)
  for (const m of MACHINES)
    out.push({
      kind: '3D model',
      title: m.name,
      context: `3D Machines Lab › ${m.subgroup}`,
      subject: homeOfMachine(m.id)?.subject.title,
      detail: m.summary,
      status: m.status === 'ready' ? 'ready' : 'coming-soon',
      hash: href.machines(m.id),
      terms: { title: norm(m.name), keys: norm(m.keywords.join(' ')), text: norm(m.summary) },
    })
  // the Lab guide's theory pages (after the circuits: a search for a circuit opens the circuit first)
  for (const g of GUIDE) {
    const lab = labById(g.lab)
    out.push({ kind: 'Guide', title: g.title, context: `${lab?.title ?? g.lab} guide`, subject: subjectOfLab(g.lab), detail: g.summary, status: 'ready', hash: href.guide(g.lab, g.id), terms: { title: norm(g.title), keys: '', text: norm(`${g.summary} ${g.group}`) } })
  }
  index = out
  return out
}

/** Ranked results: whole phrase in the title or keywords first, then every word somewhere. */
export function search(query: string, limit = 8): SearchEntry[] {
  const q = norm(query).trim()
  if (!q) return []
  const words = q.split(/\s+/).filter(Boolean)
  const scored: Array<{ e: SearchEntry; s: number }> = []
  for (const e of searchIndex()) {
    const all = `${e.terms.title} ${e.terms.keys} ${e.terms.text}`
    if (!words.every((w) => all.includes(w))) continue
    let s = 0
    if (e.terms.title === q) s += 100
    if (e.terms.title.includes(q)) s += 40
    if (e.terms.keys.includes(q)) s += 30
    for (const w of words) {
      if (e.terms.title.split(' ').some((x) => x.startsWith(w))) s += 6
      else if (e.terms.keys.includes(w)) s += 4
      else s += 1
    }
    if (e.status === 'ready') s += 3
    if (e.kind === 'Concept') s += 2
    // theory pages rank below the circuit they explain
    if (e.kind === 'Guide') s = s * 0.5
    // a 3D model ranks just below the simulated circuit of the same name
    if (e.kind === '3D model') s = s * 0.8
    scored.push({ e, s })
  }
  // one result per destination: the best-scoring way to say it
  const seen = new Set<string>()
  return scored
    .sort((a, b) => b.s - a.s)
    .filter((x) => (seen.has(x.e.hash) ? false : (seen.add(x.e.hash), true)))
    .slice(0, limit)
    .map((x) => x.e)
}
