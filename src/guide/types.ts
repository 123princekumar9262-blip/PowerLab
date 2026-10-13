/**
 * THE LAB GUIDE — theory pages, one short article per idea, grouped by lab. Plain data (no engine imports),
 * so the guide loads without any physics. Every number an article quotes is checked against the real
 * simulation by tests/guide.test.ts (its checks are keyed lab/articleId#n, n = the example's index).
 */
export interface GuideEquation {
  /** The relation, in plain text with Unicode (e.g. "Vdc = √2·Vrms / π ≈ 0.45·Vrms"). */
  expr: string
  /** What it says / when it holds, one short line. */
  note?: string
}

/** A block of an article, in reading order. */
export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'eq'; eq: GuideEquation }
  | { kind: 'h'; text: string }
  | { kind: 'list'; items: string[] }
  /** "Try it": opens the circuit ready to explore (workspace target + starting values). */
  | { kind: 'try'; text: string; lab: string; topic: string; query?: Record<string, string>; mode?: 'explore' | 'learn' | 'experiment' | 'predict' }
  /** A worked example whose result the tests confirm with the simulation. */
  | { kind: 'example'; text: string; result: string }

export interface GuideArticle {
  /** Unique within its lab (the address #/guide/:lab/:id). */
  id: string
  lab: string
  title: string
  /** One line under the title and in lists. */
  summary: string
  /** Heading of the group in the lab's page list (e.g. "Single-phase", "Controlled"). */
  group: string
  blocks: GuideBlock[]
  /** The workspace topics this page is about (the right panel links them). */
  topics: string[]
  /** "Ask WHY" prompts the lab's WHY panel answers at a suitable instant (shown as suggestions). */
  whyPrompts?: string[]
}
