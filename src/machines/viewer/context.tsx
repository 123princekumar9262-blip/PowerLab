import { createContext, useContext, type MutableRefObject } from 'react'
import type { LayerId, MachinePart } from '../types.ts'
import type { LabelStore } from './Html.tsx'

/**
 * The live state of the 3D scene that changes every frame lives in a ref (no React re-render per frame):
 * the animation clock and the explode progress. Everything a click changes lives in React state and reaches
 * the parts through this context.
 */
export interface AnimRef {
  /** Conceptual rotor angle [rad] and time [s] of the animation clock. */
  angle: number
  time: number
  playing: boolean
  /** Rotor speed of the animation [rad/s of the model] (conceptual unless a calculation drives it). */
  omega: number
  /** Explode progress 0 … stages, and where it is heading. */
  explode: number
  explodeTarget: number
  /** Explode speed [stages per second]. */
  explodeRate: number
}

export interface ViewerCtx {
  anim: MutableRefObject<AnimRef>
  parts: Map<string, MachinePart>
  /** The selected id (a part or an assembly) and the parts it stands for. */
  selected: string | null
  selectedParts: Set<string>
  select(id: string | null): void
  /** Parts the current learning step highlights (the others are dimmed). Empty: nothing dimmed. */
  focus: Set<string>
  /** Parts softly highlighted without dimming the rest (related parts, the parts of a disassembly stage). */
  glow: Set<string>
  /** Parts the student has hidden. */
  hidden: Set<string>
  /** The assembly is together (not exploded): casings can hide what is inside. */
  assembled: boolean
  /** Each moving part's move number: the explode progress runs move by move, one part (or group) at a time. */
  slots: Map<string, number>
  /** Parts pulled out on their own for inspection, with their offset (independent of the disassembly). */
  pulls: Map<string, [number, number, number]>
  /** The How-it-works tab is showing: outer parts not needed by the step are taken away. */
  learning: boolean
  /** With a part selected (and the machine together), fade the others so it can be seen wherever it sits. */
  fadeOthers: boolean
  /** Outer parts hidden ("show internal assembly"). */
  showInside: boolean
  /** Only the selected part shown. */
  isolate: boolean
  labels: 'off' | 'focus' | 'all'
  layers: Set<LayerId>
  reducedMotion: boolean
  /** Ask the renderer for a frame (the canvas renders on demand). */
  invalidate(): void
  /** The screen-space labels of the scene (rendered beside the canvas). */
  labelStore: LabelStore
}

export const Ctx = createContext<ViewerCtx | null>(null)
export function useViewer(): ViewerCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useViewer outside the machine viewer')
  return c
}

/** The explode factor (0 … 1) of a part that moves in stage `stage` when the assembly is at `e` (0 … stages). */
export const stageFactor = (e: number, stage: number) => Math.max(0, Math.min(1, e - (stage - 1)))
/** Smooth start and stop for each part's motion. */
export const ease = (x: number) => x * x * (3 - 2 * x)
