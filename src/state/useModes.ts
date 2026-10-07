import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { CHALLENGES, evaluateChallenge, type Challenge } from '../challenges/challenges.ts'
import { factsFor } from '../learning/facts.ts'
import { LESSONS, type Lesson } from '../learning/lessons.ts'
import { resolveTarget } from '../learning/target.ts'
import type { Comparison } from '../measurements/compare.ts'
import { randomTask, type PredictionTask } from '../prediction/prediction.ts'
import type { WhatIf } from '../prediction/whatIf.ts'
import { randomReverseTask, reverseAnswers, type ReverseTask } from '../reverse/reverse.ts'
import type { Snapshot } from '../experiment/experiment.ts'
import { indexAtOrAfter } from '../simulation/engine.ts'
import type { SimulationResult, SimulationSample } from '../types/simulation.ts'
import { loadJSON, saveJSON } from '../utils/storage.ts'
import type { LabAction, LabState } from './labState.ts'

const KEY_LESSONS = 'rectifier-lab.lessons'
const KEY_CHALLENGES = 'rectifier-lab.challenges'
const KEY_PREDICT = 'rectifier-lab.predict'

/**
 * Learn / Predict / Challenge mode state. Modes only set up circuits and move the
 * cursor — every number they show is read from the simulation result.
 */
export function useModes(state: LabState, dispatch: Dispatch<LabAction>, result: SimulationResult | null, comparison: Comparison | null, sample: SimulationSample | null) {
  // Predict sub-mode: "what if?" questions (default) or sketching the output.
  const [predictTab, setPredictTab] = useState<'whatif' | 'sketch'>('whatif')

  // ── Learn ────────────────────────────────────────────────────────────────────
  const [lessonRef, setLessonRef] = useState<{ id: string; step: number } | null>(null)
  const [completed, setCompleted] = useState<string[]>(() => loadJSON(KEY_LESSONS, { done: [] as string[] }).done)
  const lesson: Lesson | null = LESSONS.find((l) => l.id === lessonRef?.id) ?? null

  const startLesson = useCallback(
    (l: Lesson) => {
      setLessonRef({ id: l.id, step: 0 })
      dispatch({ type: 'applyPreset', topology: l.topology, load: l.load, params: l.params, whyOpen: false, showEnergy: false })
    },
    [dispatch],
  )

  // Apply a step (cursor, WHY, energy) once the lesson's circuit is the one simulated.
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (state.mode !== 'learn' || !lesson || !lessonRef || !result) return
    if (result.circuitId !== `${lesson.topology}:${lesson.load}`) return
    const key = `${lesson.id}:${lessonRef.step}`
    if (applied.current === key) return
    applied.current = key
    const s = lesson.steps[lessonRef.step]
    if (s.at) {
      const t = resolveTarget(result, s.at)
      // Events land on the first sample showing the new state.
      dispatch({ type: 'setCursor', time: 'event' in s.at ? result.trace.time[indexAtOrAfter(result, t)] : t })
    }
    dispatch({ type: 'setWhy', open: !!s.whyOpen })
    dispatch({ type: 'setEnergy', on: !!s.energy })
    dispatch({ type: 'pause' })
  }, [state.mode, lesson, lessonRef, result, dispatch])

  const completeLesson = useCallback((id: string) => {
    setCompleted((c) => {
      const next = c.includes(id) ? c : [...c, id]
      saveJSON(KEY_LESSONS, { done: next })
      return next
    })
  }, [])

  // ── Challenge ────────────────────────────────────────────────────────────────
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [bestStars, setBestStars] = useState<Record<string, number>>(() => loadJSON(KEY_CHALLENGES, {} as Record<string, number>))
  const challenge: Challenge | null = CHALLENGES.find((c) => c.id === challengeId) ?? null
  const startChallenge = useCallback(
    (c: Challenge) => {
      setChallengeId(c.id)
      dispatch({ type: 'applyPreset', topology: c.topology, load: c.load, params: c.params, whyOpen: false, showEnergy: false })
    },
    [dispatch],
  )
  const challengeResult = useMemo(
    () => (challenge && result && comparison && result.circuitId === `${challenge.topology}:${challenge.load}` ? evaluateChallenge(challenge, comparison, result.params) : null),
    [challenge, result, comparison],
  )
  const submitChallenge = useCallback((id: string, stars: number) => {
    setBestStars((b) => {
      const next = { ...b, [id]: Math.max(b[id] ?? 0, stars) }
      saveJSON(KEY_CHALLENGES, next)
      return next
    })
  }, [])

  // ── Predict ──────────────────────────────────────────────────────────────────
  const [prediction, setPrediction] = useState<{ task: PredictionTask; revealed: boolean } | null>(null)
  const [bestPredict, setBestPredict] = useState<number | null>(() => loadJSON(KEY_PREDICT, { best: null as number | null }).best)
  const newPrediction = useCallback(() => {
    const task = randomTask(Math.random, undefined, state.section)
    setPrediction({ task, revealed: false })
    dispatch({ type: 'applyPreset', topology: task.topology, load: task.load, params: task.params, whyOpen: false, showEnergy: false })
  }, [dispatch, state.section])
  useEffect(() => {
    if (state.mode === 'predict' && predictTab === 'sketch' && !prediction) newPrediction()
  }, [state.mode, predictTab, prediction, newPrediction])
  const revealPrediction = useCallback((score: number) => {
    setPrediction((p) => (p ? { ...p, revealed: true } : p))
    setBestPredict((b) => {
      const next = b === null ? score : Math.max(b, score)
      saveJSON(KEY_PREDICT, { best: next })
      return next
    })
  }, [])

  // ── Experiment (before / after) ────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const captureBefore = useCallback(() => {
    if (result && comparison) setSnapshot({ circuitId: result.circuitId, params: state.params, m: comparison.measurements })
  }, [result, comparison, state.params])

  // ── Predict: "what if?" (default for three-phase) or sketch ──────────────────────
  const showWhatIfInLab = useCallback(
    (q: WhatIf) => {
      const id = q.after.circuit ?? q.circuit
      const [topology, load] = id.split(':') as [typeof state.topology & string, typeof state.load & string]
      dispatch({ type: 'applyPreset', topology, load, params: q.after.params, whyOpen: true })
      dispatch({ type: 'setMode', mode: 'lab' })
    },
    [dispatch, state],
  )

  // ── Reverse engineering ──────────────────────────────────────────────────────────
  const [reverse, setReverse] = useState<{ task: ReverseTask; revealed: boolean } | null>(null)
  const newReverse = useCallback(() => {
    const task = randomReverseTask(state.section)
    setReverse({ task, revealed: false })
    dispatch({ type: 'applyPreset', topology: task.topology, load: task.load, params: task.params, whyOpen: false, showEnergy: false })
  }, [dispatch, state.section])
  useEffect(() => {
    if (state.mode === 'reverse' && (!reverse || reverse.task.section !== state.section)) newReverse()
  }, [state.mode, state.section, reverse, newReverse])
  // Put the cursor on the probe angle once the puzzle's circuit is simulated.
  const probed = useRef<ReverseTask | null>(null)
  useEffect(() => {
    if (state.mode !== 'reverse' || !reverse || !result || probed.current === reverse.task) return
    if (result.circuitId !== `${reverse.task.topology}:${reverse.task.load}`) return
    probed.current = reverse.task
    dispatch({ type: 'setCursor', time: resolveTarget(result, { angleDeg: reverse.task.probeDeg }) })
  }, [state.mode, reverse, result, dispatch])
  const reverseAns = useMemo(
    () => (reverse && result && comparison && result.circuitId === `${reverse.task.topology}:${reverse.task.load}` ? reverseAnswers(reverse.task, result, comparison.measurements.rippleFrequency) : null),
    [reverse, result, comparison],
  )

  const facts = useMemo(() => (result && comparison ? factsFor(result, comparison, sample) : {}), [result, comparison, sample])
  /** In Predict mode, waveforms and measurements stay hidden until the reveal. */
  const hideAnswers = state.mode === 'predict' && predictTab === 'sketch' && !!prediction && !prediction.revealed
  /** Reverse engineering hides everything except the source and output waveforms. */
  const hideCircuit = state.mode === 'reverse' && !!reverse && !reverse.revealed

  return {
    lesson,
    lessonStep: lessonRef?.step ?? 0,
    completed,
    startLesson,
    setLessonStep: (step: number) => setLessonRef((r) => (r ? { ...r, step } : r)),
    exitLesson: () => {
      setLessonRef(null)
      applied.current = null
    },
    completeLesson,
    challenge,
    challengeResult,
    bestStars,
    startChallenge,
    exitChallenge: () => setChallengeId(null),
    submitChallenge,
    prediction,
    bestPredict,
    newPrediction,
    revealPrediction,
    facts,
    hideAnswers,
    hideCircuit,
    snapshot,
    captureBefore,
    clearSnapshot: () => setSnapshot(null),
    predictTab,
    setPredictTab,
    showWhatIfInLab,
    reverse,
    reverseAns,
    newReverse,
    revealReverse: () => setReverse((r) => (r ? { ...r, revealed: true } : r)),
  }
}
