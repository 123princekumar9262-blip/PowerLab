import type { ComponentType } from 'react'

/**
 * 3D MACHINES LAB — shared types. Four things are kept apart on purpose:
 *   1. geometry and its animation state (what the 3D model shows),
 *   2. the educational parameters a student sets,
 *   3. the calculated engineering values (explicit formulas, unit-tested),
 *   4. (none yet) a validated simulation — the circuit labs hold those.
 * An animation illustrates; it is never presented as a field simulation or a measured speed.
 */
export type Family = 'dc' | 'ac' | 'modern' | 'transformer' | 'magnetic' | 'semiconductor' | 'system'
export type Supply = 'DC' | 'AC' | 'Static'
export type Role = 'Motor' | 'Generator' | 'Motor / generator' | 'Static device' | 'System'
export type MLevel = 'beginner' | 'standard' | 'engineer'

/** A catalogue entry: plain data (the overview loads no 3D code). */
export interface MachineEntry {
  id: string
  name: string
  family: Family
  group: 'Electrical machines' | 'Static devices' | 'Electromechanical systems'
  subgroup: 'DC machines' | 'AC machines' | 'Modern motors' | 'Transformers' | 'Magnetic components' | 'Power semiconductors' | 'Systems'
  supply: Supply
  role: Role
  level: MLevel
  summary: string
  /** `ready` = an interactive model with its guided explanation exists; `planned` = listed, not built. */
  status: 'ready' | 'planned'
  recommended?: boolean
  keywords: string[]
  /** Comparison traits (plain words, no invented figures). */
  traits?: Partial<Record<TraitKey, string>>
  /** A related circuit lab that SIMULATES this device (validated engine), if any. */
  simulatedIn?: { lab: string; topic: string; label: string }
}

export type TraitKey = 'construction' | 'excitation' | 'commutation' | 'speed' | 'torque' | 'control' | 'efficiency' | 'maintenance' | 'applications'
export const TRAIT_LABEL: Record<TraitKey, string> = {
  construction: 'Construction',
  excitation: 'Excitation (where the field comes from)',
  commutation: 'Commutation / current switching',
  speed: 'Speed behaviour',
  torque: 'Torque production',
  control: 'Control requirements',
  efficiency: 'Efficiency considerations',
  maintenance: 'Maintenance',
  applications: 'Typical applications',
}

// ── A built machine (lazy-loaded with the 3D code) ──────────────────────────

export type Vec3 = [number, number, number]

/** One selectable part of a model. */
export interface MachinePart {
  id: string
  label: string
  /** What it is (one line). */
  what: string
  /** Why it is there: its function in the machine. */
  function: string
  /** Outer parts are hidden by "Show internal assembly". */
  outer?: boolean
  /** Exploded-view offset (model units) and the stage it moves in (1 = first). */
  explode: Vec3
  stage: number
  /** Where its label points (model units). */
  anchor: Vec3
  related?: string[]
  /** Where it sits in the assembled machine (plain words). */
  location?: string
  /** What it is made of, where that is known and matters. */
  material?: string
  /** What happens if it is missing or faulty — only where that can be said accurately. */
  ifFaulty?: string
  /** The parts it works with, each with how (shown, and softly highlighted, when this part is selected). */
  relations?: Array<{ id: string; how: string }>
  /**
   * Pulled out on its own for inspection: the offset it moves by (model units), independent of the disassembly.
   * Default: its explode offset. A part with neither cannot be moved on its own (e.g. a region such as an air gap).
   */
  inspect?: Vec3
  /** Why separating it on its own is for inspection only (it cannot really come off by itself). */
  inspectNote?: string
  /** The part it is physically fixed to: in the disassembly it comes off together with that part. */
  attachedTo?: string
}

/** A group of parts (or of smaller assemblies) that belong together — the component tree. */
export interface Assembly {
  id: string
  label: string
  /** What the assembly does as a whole. */
  what: string
  /** Part ids and/or assembly ids. */
  children: string[]
  /** Pulled out as one unit for inspection (all its parts move together by this offset). */
  inspect?: Vec3
}

/** The narration of one disassembly stage (stage k = entry k − 1): which parts come off and why in this order. */
export interface DisassemblyStage {
  title: string
  text: string
}

/** A conceptual visual layer (always labelled as conceptual where it illustrates a field). */
export type LayerId = 'field' | 'current' | 'rotation' | 'torque' | 'emf' | 'energy' | 'rotatingField' | 'flux' | 'carriers' | 'commutation'
export interface LayerInfo {
  id: LayerId
  label: string
  /** The legend: what the colour/marker means, in words (never colour alone). */
  legend: string
  conceptual: boolean
}

/** One step of the guided working principle. */
export interface MachineStep {
  id: string
  title: string
  /** The explanation (static: readable without any animation). */
  text: string
  /** Parts highlighted in this step. */
  focus: string[]
  /** What each highlighted part does in this particular step (shown when it is selected during the lesson). */
  roles?: Record<string, string>
  /** Layers shown in this step. */
  layers: LayerId[]
  /** Does the rotor turn during this step's animation? */
  rotate?: boolean
  /** The standard view this step is best seen from (the camera turns there when the step opens). */
  view?: 'front' | 'side' | 'top' | 'iso'
  equation?: string
  /** Engineer-level remark. */
  detail?: string
}

export interface MachineParam {
  id: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  /** Shown from this level up. */
  level?: MLevel
  /** Choice parameter (e.g. pole count): only these values. */
  options?: number[]
}

/** A calculated value: always with its formula; null when the inputs do not support it. */
export interface CalcResult {
  id: string
  label: string
  /** A '%' value is a fraction (0.92 → 92 %). */
  value: number | null
  unit: string
  formula: string
  note?: string
}

export interface QuizItem {
  id: string
  kind: 'identify' | 'predict' | 'order' | 'match'
  prompt: string
  /** identify: the part shown highlighted. */
  part?: string
  options: string[]
  /** order: the correct order is `options` as listed (shuffled when shown); else the index of the right option. */
  answer: number
  explain: string
  /** Why a tempting wrong option is wrong (index → text). */
  misconceptions?: Record<number, string>
}

export interface MachineContent {
  overview: string
  construction: string
  principle: string
  equations: Array<{ expr: string; meaning: string }>
  assumptions: string[]
  characteristics: string[]
  losses: string[]
  advantages: string[]
  limitations: string[]
  applications: string[]
  misconceptions: string[]
  sources?: string[]
}

/** What the model draws, from the viewer's state (the animation clock is read with useClock / <Spin>). */
export interface ModelState {
  layers: Set<LayerId>
  /** Calculated values the visuals may follow (e.g. slip, current direction); conceptual otherwise. */
  calc: Record<string, number | null>
  params: Record<string, number>
  /** The learning step shown (null outside the guided explanation). */
  step: string | null
}

export interface Manifest {
  source: string
  license: string
  simplified: string
  camera: { position: Vec3; target: Vec3; fov?: number }
  /** Radius of the model (fit-to-view). */
  radius: number
  views: Partial<Record<'front' | 'side' | 'top' | 'iso', Vec3>>
  limitations: string[]
}

export interface MachineDef {
  id: string
  manifest: Manifest
  parts: MachinePart[]
  /** The component hierarchy (top level first). Without it the parts are listed flat. */
  assemblies?: Assembly[]
  /** Narration per disassembly stage. Without it each stage is described from its parts. */
  disassembly?: DisassemblyStage[]
  /**
   * How the disassembly groups parts into single moves: 'attached' — only parts declared `attachedTo` another come
   * off with it, every other part moves on its own; 'direction' (default, older models) — parts of a stage that
   * move in the same direction move together.
   */
  disassemblyGrouping?: 'attached' | 'direction'
  layers: LayerInfo[]
  steps: MachineStep[]
  params: MachineParam[]
  calc(p: Record<string, number>): CalcResult[]
  /**
   * How the animation turns, from the calculated values: rotor speed of the animation [rad/s] and a sentence that
   * says how it relates to the calculation (e.g. "slowed down ×50"). Without it the rotation is conceptual.
   */
  motion?(calc: Record<string, number | null>, params: Record<string, number>): { omega: number; note: string }
  content: MachineContent
  quiz: QuizItem[]
  /** The 3D model: draws its parts through <Part id> (selection, explode, visibility handled by the viewer). */
  Model: ComponentType<{ state: ModelState }>
}
