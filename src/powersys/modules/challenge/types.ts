import type { Solution } from '../../network/solve.ts'
import type { Network } from '../../network/types.ts'
import type { ModuleId } from '../../types.ts'
import type { PlotProps } from '../../ui/Plot.tsx'
import type { SldPlace } from '../../ui/SingleLine.tsx'

/**
 * An Engineer's Challenge: a realistic task on a model. The student changes the controls; the model is solved for
 * every change (the measurements are always visible, as on a real control desk), and the verdict — every objective
 * checked against the computed result — is given when they ask for it. A challenge is solvable by construction:
 * tests/powersys-challenge.test.ts checks that its starting state fails and that a known solution passes.
 */
export type Value = number | boolean | string
export type State = Record<string, Value>

export type Control =
  | { kind: 'slider'; id: string; label: string; min: number; max: number; step: number; unit: string; decimals?: number; hint?: string }
  | { kind: 'switch'; id: string; label: string; on: string; off: string; hint?: string }
  | { kind: 'choice'; id: string; label: string; options: Array<{ id: string; label: string }>; hint?: string }

export interface Objective {
  id: string
  label: string
  ok: boolean
  /** The computed value that decides it, in words. */
  detail: string
}

export interface Measurement {
  label: string
  value: string
  unit?: string
  tone?: 'good' | 'warn' | 'bad'
  note?: string
}

export interface Evaluation {
  objectives: Objective[]
  measurements: Measurement[]
  /** A network to draw, with its solution. */
  diagram?: { net: Network; sol: Solution | null; highlight?: string[]; place?: Record<string, SldPlace>; tags?: Record<string, string>; viewBox?: string; faultAt?: string }
  /** A chart of the result (a simulation). */
  plot?: PlotProps
  /** A warning that is part of the situation (e.g. a re-energised fault). */
  alarm?: string
}

export interface Challenge {
  id: string
  title: string
  /** One line for the list. */
  line: string
  /** The situation, as an engineer would be briefed. */
  brief: string[]
  /** The modules whose ideas it uses. */
  uses: ModuleId[]
  level: 'Core' | 'Advanced'
  controls: Control[]
  initial: State
  evaluate(s: State): Evaluation
  /** Hints, revealed one at a time. */
  hints: string[]
  /** What an engineer takes away, given the solved state. */
  debrief(s: State, e: Evaluation): string[]
  /** A state that meets every objective (used by the tests; never shown). */
  solution: State
}

export const num = (s: State, id: string) => Number(s[id])
export const bool = (s: State, id: string) => s[id] === true
