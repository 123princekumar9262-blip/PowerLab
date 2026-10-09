import type { ReactNode } from 'react'
import type { Run, RunEvent } from '../converters/types.ts'

/**
 * A TOPIC is one simulated subject of the platform (buck, boost, PWM lab, single-phase inverter…).
 * The universal workspace shell (workspace/TopicShell.tsx) renders every topic with the same layout —
 * parameters, circuit, one status line, WHY + Explore, waveforms — the modes Explore · Learn · Experiment
 * (+ Predict), and progressive disclosure (Beginner / Standard / Engineer). A topic supplies the physics
 * and the words; the shell never computes a physical value itself.
 */
export type Density = 'beginner' | 'standard' | 'engineer'

export interface FieldSpec<P> {
  kind: 'number'
  key: keyof P & string
  label: string
  /** Display unit; the value shown is value / scale. */
  unit: string
  scale?: number
  min: number
  max: number
  log?: boolean
  /** Step in display units. */
  step?: number
  hint?(p: P): string | undefined
  when?(p: P): boolean
}
export interface ChoiceSpec<P> {
  kind: 'choice'
  key: keyof P & string
  label: string
  options: Array<{ value: string | number; label: string; title?: string }>
  when?(p: P): boolean
}
export type ParamSpec<P> = FieldSpec<P> | ChoiceSpec<P>

export interface ChannelMeta {
  id: string
  label: string
  name: string
  unit: 'V' | 'A' | 'J' | 'W' | ''
  color: string
  dash?: number[]
  group: string
  logic?: boolean
}

export interface StateRow {
  k: string
  v: string
  tone?: 'on-q' | 'on-d' | 'off' | 'ok' | 'bad'
  /** Span both columns. */
  full?: boolean
  /** Shown from this density up (default: always). */
  min?: Density
}
export interface StateView {
  badge: { text: string; tone: 'on' | 'off' | 'idle' | 'neutral' }
  rows: StateRow[]
  path?: string
}

export interface WhyCard {
  id: string
  question: string
  what: string
  why: string
  equation: string
  physics: string
  whatIf: string
}

export interface InspectInfo {
  title: string
  role: string
  rows: Array<[string, string]>
}

export interface TextbookValue {
  key: string
  value: number | null
  formula: string
  assumptions: string[]
  notApplicable?: string
}

/** One row of SIMULATION vs THEORY. */
export interface CompareRow {
  key: string
  label: string
  unit: string
  sim: number
  exact: number
  error: number
  tolerance: number
  pass: boolean
  absolute?: boolean
  textbook: TextbookValue | null
  textbookError: number | null
  /** The exact theory does not model something the simulation includes (device drops, dead time): the
   *  difference is expected and explained here instead of being checked against a tolerance. */
  expected?: string
}

export interface CompareResult {
  rows: CompareRow[]
  allPass: boolean
  /** One line above the table (mode, window). */
  header?: string
  /** Extra line under the table (an ESTIMATED value, a caveat). */
  note?: string
}

export interface DiagramProps<R, S> {
  r: R
  st: S
  selected: string | null
  onSelect: (part: string) => void
  /** Values printed on the circuit (Standard and Engineer). */
  values: boolean
  showPath: boolean
}

export interface LessonStep<P, R, M, S> {
  title: string
  params?: Partial<P>
  /** Cursor time [s] for this step, from the run. */
  at(r: R): number
  /** Visible time window [s], from the run (default: two periods around the cursor). */
  window?(r: R): [number, number]
  channels: string[]
  body(st: S, m: M, r: R): string
  look: string
}
export interface Lesson<P, R, M, S> {
  id: string
  title: string
  summary: string
  base: Partial<P>
  steps: Array<LessonStep<P, R, M, S>>
}

export interface Experiment<P, M> {
  id: string
  title: string
  change(p: P): Partial<P>
  question(p: P): string
  choices: string[]
  /** Index of the choice the SIMULATION confirms, decided from the before/after results. */
  judge(before: M, after: M): number
  rows: string[]
  why(before: M, after: M, p0: P, p1: P): string
}

export interface PredictTask<P, M> {
  id: string
  prompt: string
  params: Partial<P>
  kind: 'number' | 'choice'
  unit?: string
  answer(m: M): number
  choices?: string[]
  tolerance?: number
  hint: string
  /** The theory shown AFTER the simulation answered. */
  theory(p: P): string
}

export interface MeasureLabel {
  label: string
  fmt: (v: number) => string
}

/**
 * A category of the Analyze panel (workspace shell). `rows` name measurement keys (dotted paths allowed,
 * e.g. "losses.q"); they are shown with their SIMULATION value and, when a compare row with the same key
 * exists, its THEORY value. `tab` reuses one of `analyze.tabs`. Categories with nothing to show are hidden.
 */
export interface AnalysisCategory<R, M> {
  id: string
  label: string
  rows?: string[]
  tab?: string
  note?(m: M, r: R): string | undefined
}

/** One-line physical state for the status line (workspace shell) — defined by the workspace contract. */
import type { CurrentPath, EnergyModel, NextConsequence, StatusInfo } from '../workspace/contract.ts'
export type { StatusInfo }

export interface AnalyzeTab<P, R, M> {
  id: string
  label: string
  render(ctx: { r: R; m: M; p: P; density: Density }): ReactNode
}

export interface Topic<P, R extends Run, M, S> {
  id: string
  /** Short name in the sub-navigation. */
  label: string
  /** Heading on the circuit card. */
  title: string
  defaults: P
  basic: Array<ParamSpec<P>>
  advanced: Array<ParamSpec<P>>
  /** Line under the basic parameters (e.g. the CCM/DCM boundary). */
  paramNote?(p: P, r: R): string
  /** Parameter key holding 'steady' | 'startup', when the topic offers a start-up view. */
  viewKey?: keyof P & string
  simulate(p: P): R
  measure(r: R): M
  state(r: R, k: number): S
  view(st: S, r: R, density: Density): StateView
  why(r: R, st: S, m: M): WhyCard[]
  Diagram(props: DiagramProps<R, S>): ReactNode
  channels: Record<string, ChannelMeta>
  defaultChannels: string[]
  addOrder: string[]
  /** Conduction shading of the scope: colour of the band for the interval ending at sample k. */
  shade?(r: R, k: number): string | null
  shadeLegend?: string
  eventLabel(e: RunEvent): string
  eventWhy(e: RunEvent): string
  eventColor?(e: RunEvent): string
  initialCursor(r: R): number
  /** 'period' (switching) or 'cycle' (fundamental). */
  periodName: string
  /** Standard+: a status card (CCM/DCM, linear/overmodulation…). */
  badge?(r: R, m: M): ReactNode
  /** Beginner: one line with the headline result. */
  summary(r: R, m: M): string
  energy?(st: S, m: M, r: R): ReactNode
  /** Label of the energy side tab (e.g. 'Spectrum' for the PWM lab). */
  energyLabel?: string
  inspect?(part: string, st: S, m: M, r: R): InspectInfo
  analyze: {
    compare(r: R, m: M): CompareResult
    theory(r: R, m: M): ReactNode
    tabs?: Array<AnalyzeTab<P, R, M>>
    /** Compare-row keys tracked by the convergence check. */
    convergence?: string[]
  }
  lessons: Array<Lesson<P, R, M, S>>
  experiments: Array<Experiment<P, M>>
  predictions(seed: number): Array<PredictTask<P, M>>
  measureLabels: Record<string, MeasureLabel>
  // ── Optional: used by the universal workspace shell ──
  /** The status line under the circuit, read from the state at the cursor. */
  status?(st: S, r: R): StatusInfo
  /** "Next consequence": what the present state leads to, from the run's own next event (null if none). */
  next?(r: R, st: S, m: M): string | null
  /** Analyze categories (Overview, Output, Current, Ripple, Power, Efficiency, Device stress…). */
  analysis?: Array<AnalysisCategory<R, M>>
  /** Inspectable parts (keyboard / small-screen access to the same inspector as clicking the circuit). */
  parts?: Array<{ id: string; label: string }>
  /** The next consequence with the time of the event it quotes (WHY → "Go to that instant"). */
  nextConsequence?(r: R, st: S, m: M): NextConsequence | null
  /** The conducting loop at the cursor (the "Show current path" overlay). */
  path?(st: S, r: R): CurrentPath
  /** Energy at the cursor as signed powers and stored energies (the shell's Energy panel). */
  energyModel?(st: S, m: M, r: R): EnergyModel
  /** The channels Focus view keeps (default: the first default channel). */
  primaryChannels?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTopic = Topic<any, any, any, any>
