import { DEFAULT_PARAMS, sanitizeParams } from '../simulation/params.ts'
import type { LabParams, LoadType, RectifierTopology, SignalId } from '../types/simulation.ts'
import type { Viewport } from '../visualization/scopeRenderer.ts'
import type { StepMode } from './stepping.ts'

/** UI state. Physics lives in the simulation result, derived from `params` — never stored here. */
export interface LabState {
  topology: RectifierTopology | null
  load: LoadType | null
  params: LabParams
  hasRun: boolean
  /** Cursor time [s]. Stored as time (not index) so it survives re-simulation. */
  cursorTime: number
  playing: boolean
  speed: number
  stepMode: StepMode
  /** Visible time window; null = fit the whole run. */
  viewport: Viewport | null
  visible: Record<SignalId, boolean>
  showConduction: boolean
  selectedEventGroupId: string | null
  whyOpen: boolean
  /** Guided-flow progress (steps 4–6 of the onboarding strip). */
  progress: { cursorMoved: boolean; sawOn: boolean; sawOff: boolean; whyPressed: boolean }
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const

/** At 1× playback one source cycle takes this long on screen (slow motion — 50 Hz is too fast to see). */
export const SECONDS_PER_CYCLE_AT_1X = 4

export const initialLabState: LabState = {
  topology: null,
  load: null,
  params: DEFAULT_PARAMS,
  hasRun: false,
  cursorTime: 0,
  playing: false,
  speed: 1,
  stepMode: 'event',
  viewport: null,
  visible: { vin: true, vout: true, vd: true, io: true, id: true },
  showConduction: true,
  selectedEventGroupId: null,
  whyOpen: false,
  progress: { cursorMoved: false, sawOn: false, sawOff: false, whyPressed: false },
}

export type LabAction =
  | { type: 'chooseTopology'; topology: RectifierTopology }
  | { type: 'chooseLoad'; load: LoadType }
  | { type: 'run'; cursorTime: number }
  | { type: 'setParams'; params: LabParams }
  | { type: 'resetParams' }
  | { type: 'setCursor'; time: number; byUser?: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'togglePlay' }
  | { type: 'reset' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setStepMode'; mode: StepMode }
  | { type: 'setViewport'; viewport: Viewport | null }
  | { type: 'toggleSignal'; signal: SignalId }
  | { type: 'toggleConduction' }
  | { type: 'selectEventGroup'; id: string | null; time?: number }
  | { type: 'toggleWhy' }
  | { type: 'observedDiode'; on: boolean }

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'chooseTopology':
      return { ...state, topology: action.topology }
    case 'chooseLoad':
      return { ...state, load: action.load }
    case 'run':
      return { ...state, hasRun: true, cursorTime: action.cursorTime, viewport: null }
    case 'setParams':
      return withRetimedCursor(state, action.params)
    case 'resetParams':
      return withRetimedCursor(state, DEFAULT_PARAMS)
    case 'setCursor':
      return {
        ...state,
        cursorTime: action.time,
        progress: action.byUser && !state.progress.cursorMoved ? { ...state.progress, cursorMoved: true } : state.progress,
      }
    case 'play':
      return { ...state, playing: true }
    case 'pause':
      return { ...state, playing: false }
    case 'togglePlay':
      return { ...state, playing: !state.playing }
    case 'reset':
      return { ...state, playing: false, cursorTime: 0, selectedEventGroupId: null }
    case 'setSpeed':
      return { ...state, speed: action.speed }
    case 'setStepMode':
      return { ...state, stepMode: action.mode }
    case 'setViewport':
      return { ...state, viewport: action.viewport }
    case 'toggleSignal':
      return { ...state, visible: { ...state.visible, [action.signal]: !state.visible[action.signal] } }
    case 'toggleConduction':
      return { ...state, showConduction: !state.showConduction }
    case 'selectEventGroup':
      return {
        ...state,
        selectedEventGroupId: action.id,
        cursorTime: action.time ?? state.cursorTime,
        playing: action.id ? false : state.playing,
        progress: action.id ? { ...state.progress, cursorMoved: true } : state.progress,
      }
    case 'toggleWhy':
      return { ...state, whyOpen: !state.whyOpen, progress: { ...state.progress, whyPressed: true } }
    case 'observedDiode': {
      const key = action.on ? 'sawOn' : 'sawOff'
      if (state.progress[key] || !state.progress.cursorMoved) return state
      return { ...state, progress: { ...state.progress, [key]: true } }
    }
  }
}

/**
 * When frequency or duration change, the time axis changes meaning. Keep the cursor
 * at the same point of the cycle (same θ) and refit the view; otherwise keep both.
 */
function withRetimedCursor(state: LabState, params: LabParams): LabState {
  const before = sanitizeParams(state.params).params
  const after = sanitizeParams(params).params
  const timebaseChanged = before.period !== after.period || before.duration !== after.duration
  const cursorTime = Math.min(after.duration, (state.cursorTime / before.period) * after.period)
  return {
    ...state,
    params,
    cursorTime: timebaseChanged ? cursorTime : Math.min(state.cursorTime, after.duration),
    viewport: timebaseChanged ? null : state.viewport,
    selectedEventGroupId: null,
  }
}
