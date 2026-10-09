import type { ModeId } from '../catalogue/catalogue.ts'
import type { Level } from '../shell/prefs.ts'

/** What the shell gives a lab workspace, and what the workspace reports back. */
export interface WorkspaceProps {
  /** Catalogue topic id of a workspace topic (entry points are resolved before this). */
  topic: string
  mode: ModeId
  query: Record<string, string>
  level: Level
  onActivity(a: WorkspaceActivity): void
}

export interface WorkspaceActivity {
  topic: string
  mode: ModeId
  /** The starting-point query that describes what is shown (kept in the address). */
  query?: Record<string, string>
  level: Level
  lesson?: { id: string; title: string; step: number; of: number }
}
