import type { ModuleId, PsMode } from '../types.ts'

/**
 * Syllabus mapping for the Power Systems subject: one canonical list of engineering topics, each mapped to two
 * syllabi (GATE EE and VIT Vellore B.Tech EEE). The engineering modules are shared; only the mapping differs.
 *
 * Coverage status, decided from the official wording (sources.ts, evidence.ts) — never from what textbooks usually
 * include:
 *   verified       the official text names the topic;
 *   partial        the official text overlaps with it but does not name it fully;
 *   supplementary  useful engineering content the official text does not name (for VIT: also a topic named only
 *                  in an elective the student does not take);
 *   pending        the official document has not been checked.
 */
export type SyllabusId = 'gate-ee' | 'vit-eee'
export type Coverage = 'verified' | 'partial' | 'supplementary' | 'pending'
export type Skill = 'conceptual' | 'numerical'
/** Where a topic not yet in a built module is planned to go. */
export type PlannedIn = 'phase-a' | 'phase-b' | 'phase-c' | 'phase-d' | 'follow-up'

export interface Source {
  id: string
  syllabus: SyllabusId
  title: string
  issuer: string
  version: string
  url: string
  /** Date the document was retrieved and read [YYYY-MM-DD]. */
  retrieved: string
  note?: string
}

/** Where the official text covers a topic, with its exact wording (checked against evidence.ts by a test). */
export interface Ref {
  status: Coverage
  /** GATE: the section number; VIT: the course code. */
  where?: string
  /** VIT only: the course's module number. */
  unit?: string
  /** The words of the official text, verbatim. Required for verified and partial. */
  quote?: string
  note?: string
}

export interface SyllabusTopic {
  id: string
  title: string
  /** The module that teaches it (null: not covered by a module yet — see `plannedIn`). */
  module: ModuleId | null
  /** For a topic not yet taught: the phase it is planned for, and how. */
  plannedIn?: PlannedIn
  plan?: string
  prerequisites: string[]
  skills: Skill[]
  /** The modes of its module where it is practised (empty when not yet built). */
  activities: PsMode[]
  gate: Ref
  vit: Ref
}
