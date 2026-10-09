import { CONCEPTS, ENGINEERING, LABS, labById, targetOf, topicOf, type Status } from './catalogue.ts'
import { href } from '../shell/router.ts'

/**
 * Search over the platform's own content only — built from the catalogue (labs, circuits and topics,
 * entry points, practice areas, concepts). No separate knowledge base: adding a topic to the catalogue
 * makes it findable. Lessons and experiments join the index in a later phase.
 */
export type ResultKind = 'Lab' | 'Circuit' | 'Topic' | 'Concept' | 'Practice'

export interface SearchEntry {
  kind: ResultKind
  title: string
  /** Where it lives ("Rectifiers", "Engineering"). */
  context: string
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
  for (const lab of LABS) {
    out.push({ kind: 'Lab', title: lab.title, context: 'Labs', detail: lab.tagline, status: lab.status, hash: href.lab(lab.id), terms: { title: norm(lab.title), keys: norm(lab.keywords.join(' ')), text: norm(`${lab.tagline} ${lab.description}`) } })
    for (const t of lab.topics) {
      const tgt = targetOf(lab, t)
      const ready = t.status === 'ready'
      out.push({
        kind: t.opens ? 'Topic' : lab.id === 'rectifiers' || lab.id === 'dc-dc' || lab.id === 'inverters' ? 'Circuit' : 'Topic',
        title: t.title,
        // the section tells same-named circuits apart (single- vs three-phase fully controlled bridge)
        context: `${lab.title} › ${t.section}`,
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
      context: 'Engineering',
      detail: a.purpose,
      status: a.status,
      hash: href.engineering(a.id),
      terms: { title: norm(a.title), keys: norm(a.keywords.join(' ')), text: norm(`${a.purpose} ${a.description}`) },
    })
  for (const c of CONCEPTS) {
    const lab = labById(c.lab)!
    const t = topicOf(lab, c.topic)!
    const tgt = targetOf(lab, t)
    out.push({ kind: 'Concept', title: c.term, context: lab.title, detail: c.note, status: 'ready', hash: href.workspace(tgt.lab, tgt.topic, tgt.mode, tgt.query), terms: { title: norm(c.term), keys: norm(c.aliases.join(' ')), text: norm(c.note) } })
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
