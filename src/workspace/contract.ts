import type { ReactNode } from 'react'

/*
 * THE WORKSPACE CONTRACT — what a lab adapter hands the universal workspace shell. The shell renders these
 * shapes; it never computes a voltage, current, power, energy, state or time. Each value is produced by the
 * lab's own domain code from its one simulation run, at the master cursor.
 *
 *   simulation run ─► measurements / events ─► adapter ─► these shapes ─► WorkspaceShell + views
 *
 * MASTER CURSOR: one simulation instant (a sample of the stored run). Moving it re-reads the run; it never
 * runs the simulation again — only a parameter change does. Every shape below is read at that instant
 * (status, path, WHY, inspection, energy) or over the run (events, analysis).
 */

/** The instant every region shows. `runId` changes only when the simulation runs again. */
export interface WorkspaceCursor {
  time: number
  index: number
  runId: number
}

/** One-line state at the cursor: e.g. "Switch ON · inductor charging". */
export interface StatusInfo {
  headline: string
  facts: string[]
  tone?: 'on' | 'off' | 'idle' | 'neutral'
}

/** The conducting loop at the cursor, from the simulated device states. */
export interface CurrentPath {
  /** Elements in order (the adapter's own ids, also used to highlight the circuit). */
  elements: string[]
  /** The loop in words, e.g. "Vin+ → Q1 → L → R → Vin−". */
  text: string
  /** Why this path (from the simulated state). */
  reasons: string[]
}

/** A detected simulation event (domain kinds stay in the domain; the shell sees only this). */
export interface WorkspaceEvent {
  id: string
  /** The event's own (refined) time [s] — never invented. */
  time: number
  label: string
  /** For filtering, e.g. "switching", "source", "output". */
  category: string
  /** Extra position text, e.g. "θ = 90.0°". */
  at?: string
  what?: string
  why?: string
}

/** The next consequence: wording plus the real time of the event it quotes (null if none ahead). */
export interface NextConsequence {
  text: string
  time: number | null
}

/** WHY at the cursor: What is happening → Why → Physical principle → What happens next. */
export interface WhyQuestion {
  id: string
  question: string
  what: string
  why: string
  /** The principle in words, and its equation when there is one. */
  principle: string
  equation?: string
  /** Optional deeper text (shown under "More detail"). */
  more?: string[]
}

/** A component at the cursor: common fields + the domain's own rows. */
export interface ComponentInspection {
  id: string
  title: string
  kind: string
  /** e.g. "ON — conducting", "STORING ENERGY". */
  state?: string
  rows: Array<[string, string]>
  why?: string
}

/** One row of SIMULATION vs THEORY (values already formatted by the domain). */
export interface AnalysisRow {
  key: string
  label: string
  simulation: string
  theory: string | null
  error: string | null
  /** true = agrees within tolerance, false = disagrees, null = not compared (with `note`). */
  pass: boolean | null
  formula?: string | null
  note?: string
}

/** An Analyze category. Only categories with real rows (or a real view) are given to the shell. */
export interface AnalysisCategory {
  id: string
  label: string
  rows: AnalysisRow[]
  /** Theory assumptions / conditions for these rows. */
  assumptions?: string[]
  /** Domain view shown with (or instead of) the rows, e.g. an overlap analysis or a duty sweep. */
  extra?: ReactNode
}

/** Energy at the cursor: signed powers (+ absorbing, − supplying) and stored energies, from the simulation. */
export interface EnergyModel {
  ledger: Array<{ id: string; label: string; watts: number; note: string }>
  stores: Array<{ id: string; label: string; joules: number; /** 0…1 of its own run maximum */ fraction: number; detail: string }>
  /** Σp of the ledger (conservation check); null when the ledger is not complete. */
  balance: number | null
  /** |Σp| within this [W] counts as conserved (the domain's own numerical tolerance). */
  tolerance: number
  summary?: string
}
