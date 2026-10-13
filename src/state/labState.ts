import { DEFAULT_PARAMS, sanitizeParams, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import type { CircuitId, LabParams, LoadType, RectifierTopology, SignalId } from '../types/simulation.ts'
import type { Viewport } from '../visualization/scopeRenderer.ts'
import { SIGNAL_META, type ScopeLayoutMode } from '../visualization/signals.ts'
import type { ChannelPreset } from '../visualization/presets.ts'
import type { StepMode } from './stepping.ts'
import { loadJSON, saveJSON } from '../utils/storage.ts'

export type AppMode = 'lab' | 'learn' | 'experiment' | 'predict' | 'challenge' | 'reverse' | 'compare'

/** Single-phase or three-phase rectifiers. Each section keeps its own parameter set. */
export type Section = 'single' | 'three'

/**
 * Information density. It decides what is VISIBLE by default — never what exists: every
 * panel, channel and measurement stays reachable at every level.
 */
export type Density = 'beginner' | 'standard' | 'engineer'
/** Right-hand panel: one tab at a time. 'mode' = the active mode's panel (lesson, experiment…). */
export type RightTab = 'mode' | 'state' | 'why' | 'learn' | 'energy'
/** The primary visualization under the circuit (only one at a time). */
export type ScopeView = 'waveforms' | 'angle' | 'events' | 'compare'
/** On-demand detail panels (drawers / bottom sheets). */
export type DrawerKind = 'path' | 'why' | 'energy' | 'measure' | 'theory' | 'inspect' | 'event' | 'events' | 'state' | 'learn' | 'ask' | 'symbols'
export interface Drawer {
  kind: DrawerKind
  /** Inspect: the component clicked (e.g. 'D1', 'R', 'phase-a'). */
  part?: string
}

const KEY_DENSITY = 'rectifier-lab.density'

/** UI state. Physics lives in the simulation result, derived from `params` — never stored here. */
export interface LabState {
  mode: AppMode
  section: Section
  /** Parameters of the section that is not active (restored when switching back). */
  otherParams: LabParams
  /** Physics Lens: guided walk through source → decision → path → output → load. */
  lensStage: number | null
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
  layoutMode: ScopeLayoutMode
  showConduction: boolean
  /** Energy & power view (Phase 6): energy panel + energy/power scope channels. */
  showEnergy: boolean
  selectedEventGroupId: string | null
  whyOpen: boolean
  /** Guided-flow progress (steps 4–6 of the onboarding strip). */
  progress: { cursorMoved: boolean; sawOn: boolean; sawOff: boolean; whyPressed: boolean }
  // ── Presentation (progressive disclosure) ──
  density: Density
  /** Focus mode: circuit, primary waveform, state and playback only. */
  focus: boolean
  rightTab: RightTab
  scopeView: ScopeView
  drawer: Drawer | null
  /** Inspect mode: clicking a component opens its details. */
  inspecting: boolean
  /** Channel preset; 'custom' once the student picks channels by hand (then `visible` rules). */
  preset: ChannelPreset
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const

/** At 1× playback one source cycle takes this long on screen (slow motion — 50 Hz is too fast to see). */
export const SECONDS_PER_CYCLE_AT_1X = 4

/**
 * Cycles needed for the transient to settle with the default components, per load.
 * Choosing a load raises the duration to at least this (never lowers a user's choice).
 */
export const RECOMMENDED_CYCLES: Record<LoadType, number> = { R: 4, RL: 6, RC: 6, RLC: 12 }

const defaultVisible = Object.fromEntries((Object.keys(SIGNAL_META) as SignalId[]).map((s) => [s, !SIGNAL_META[s].advanced && !SIGNAL_META[s].optional])) as Record<SignalId, boolean>
/** Three-phase: phases, Vo and Io visible; individual diode currents and line voltages optional. */
const threePhaseVisible: Record<SignalId, boolean> = { ...defaultVisible, vd: false, id: false, id2: false, vd2: false }

export const initialLabState: LabState = {
  mode: 'lab',
  section: 'single',
  otherParams: THREE_PHASE_DEFAULTS,
  lensStage: null,
  topology: null,
  load: null,
  params: DEFAULT_PARAMS,
  hasRun: false,
  cursorTime: 0,
  playing: false,
  speed: 1,
  stepMode: 'event',
  viewport: null,
  visible: defaultVisible,
  layoutMode: 'grouped',
  showConduction: true,
  showEnergy: false,
  selectedEventGroupId: null,
  whyOpen: false,
  progress: { cursorMoved: false, sawOn: false, sawOff: false, whyPressed: false },
  density: loadJSON<{ d: Density }>(KEY_DENSITY, { d: 'standard' }).d,
  focus: false,
  rightTab: 'state',
  scopeView: 'waveforms',
  drawer: null,
  inspecting: false,
  preset: 'basic',
}

export type LabAction =
  | { type: 'setMode'; mode: AppMode }
  | { type: 'setSection'; section: Section }
  | { type: 'setLens'; stage: number | null }
  | { type: 'chooseTopology'; topology: RectifierTopology }
  /** Pick a rectifier from the catalog: its topology AND its switching devices (diodes / SCRs). */
  | { type: 'chooseRectifier'; topology: RectifierTopology; device: 'diode' | 'scr' }
  | { type: 'chooseLoad'; load: LoadType }
  | { type: 'run'; cursorTime: number }
  | { type: 'setParams'; params: LabParams }
  | { type: 'resetParams' }
  | { type: 'applyPreset'; topology: RectifierTopology; load: LoadType; params: LabParams; cursorTime?: number; whyOpen?: boolean; showEnergy?: boolean }
  | { type: 'setCursor'; time: number; byUser?: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'togglePlay' }
  | { type: 'reset' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setStepMode'; mode: StepMode }
  | { type: 'setViewport'; viewport: Viewport | null }
  | { type: 'toggleSignal'; signal: SignalId }
  | { type: 'setLayoutMode'; mode: ScopeLayoutMode }
  | { type: 'toggleConduction' }
  | { type: 'toggleEnergy' }
  | { type: 'selectEventGroup'; id: string | null; time?: number }
  | { type: 'toggleWhy' }
  | { type: 'setWhy'; open: boolean }
  | { type: 'setEnergy'; on: boolean }
  | { type: 'observedDiode'; on: boolean }
  | { type: 'setDensity'; density: Density }
  | { type: 'setFocus'; on: boolean }
  | { type: 'setRightTab'; tab: RightTab }
  | { type: 'setScopeView'; view: ScopeView }
  | { type: 'openDrawer'; drawer: Drawer }
  | { type: 'closeDrawer' }
  | { type: 'setInspecting'; on: boolean }
  | { type: 'setChannels'; preset: ChannelPreset; visible?: Record<SignalId, boolean> }

export function circuitIdOf(state: Pick<LabState, 'topology' | 'load'>): CircuitId {
  return `${state.topology ?? 'half-wave'}:${state.load ?? 'R'}`
}

function withCycles(params: LabParams, load: LoadType): LabParams {
  const min = RECOMMENDED_CYCLES[load]
  return params.sim.cycles >= min ? params : { ...params, sim: { ...params.sim, cycles: min } }
}

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'setMode':
      return { ...state, mode: action.mode, playing: false, selectedEventGroupId: null, rightTab: action.mode === 'lab' ? 'state' : 'mode', drawer: null, focus: false }
    case 'setSection': {
      if (action.section === state.section) return state
      const three = action.section === 'three'
      return {
        ...state,
        section: action.section,
        params: state.otherParams,
        otherParams: state.params,
        topology: three ? '3ph-bridge' : state.hasRun ? 'bridge' : null,
        load: three ? 'R' : state.hasRun ? 'R' : null,
        visible: three ? { ...threePhaseVisible, ...advancedOf(state) } : { ...defaultVisible, ...advancedOf(state) },
        viewport: null,
        selectedEventGroupId: null,
        playing: false,
        lensStage: null,
        drawer: null,
        scopeView: state.scopeView === 'angle' || state.scopeView === 'compare' ? 'waveforms' : state.scopeView,
      }
    }
    case 'setLens':
      // The Physics Lens lives in the WHY tab (or the WHY drawer in focus mode).
      return action.stage === null ? { ...state, lensStage: null } : { ...state, lensStage: action.stage, rightTab: state.focus ? state.rightTab : 'why', drawer: state.focus ? { kind: 'why' } : state.drawer }
    case 'chooseRectifier': {
      const ctl = state.params.control ?? { device: 'diode' as const, alphaDeg: 30, freewheel: false }
      return {
        ...state,
        topology: action.topology,
        params: { ...state.params, control: { ...ctl, device: action.device, alphaDeg: ctl.alphaDeg ?? 30 } },
        selectedEventGroupId: null,
        viewport: null,
        drawer: state.drawer?.kind === 'inspect' ? null : state.drawer,
      }
    }
    case 'chooseTopology':
      return { ...state, topology: action.topology, selectedEventGroupId: null, viewport: null, drawer: state.drawer?.kind === 'inspect' ? null : state.drawer }
    case 'chooseLoad':
      return { ...state, load: action.load, params: withCycles(state.params, action.load), selectedEventGroupId: null, viewport: null }
    case 'run':
      return { ...state, hasRun: true, cursorTime: action.cursorTime, viewport: null }
    case 'setParams':
      return withRetimedCursor(state, action.params)
    case 'resetParams':
      return withRetimedCursor(state, withCycles(state.section === 'three' ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS, state.load ?? 'R'))
    case 'applyPreset': {
      const section: Section = action.topology.startsWith('3ph') ? 'three' : 'single'
      const switching = section !== state.section
      return {
        ...state,
        section,
        otherParams: switching ? state.params : state.otherParams,
        visible: switching ? (section === 'three' ? { ...threePhaseVisible, ...advancedOf(state) } : { ...defaultVisible, ...advancedOf(state) }) : state.visible,
        topology: action.topology,
        load: action.load,
        params: action.params,
        hasRun: true,
        playing: false,
        cursorTime: action.cursorTime ?? 0,
        viewport: null,
        selectedEventGroupId: null,
        whyOpen: action.whyOpen ?? state.whyOpen,
        showEnergy: action.showEnergy ?? state.showEnergy,
      }
    }
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
    case 'setLayoutMode':
      return { ...state, layoutMode: action.mode }
    case 'toggleConduction':
      return { ...state, showConduction: !state.showConduction }
    case 'toggleEnergy':
      return withEnergy(state, !state.showEnergy)
    case 'setEnergy':
      return state.showEnergy === action.on ? state : withEnergy(state, action.on)
    case 'setWhy':
      return state.whyOpen === action.open ? state : { ...state, whyOpen: action.open }
    case 'selectEventGroup':
      return {
        ...state,
        drawer: action.id ? { kind: 'event' } : state.drawer?.kind === 'event' ? null : state.drawer,
        selectedEventGroupId: action.id,
        cursorTime: action.time ?? state.cursorTime,
        playing: action.id ? false : state.playing,
        progress: action.id ? { ...state.progress, cursorMoved: true } : state.progress,
      }
    case 'toggleWhy':
      return { ...state, whyOpen: !state.whyOpen, progress: { ...state.progress, whyPressed: true } }
    case 'setDensity':
      saveJSON(KEY_DENSITY, { d: action.density })
      return {
        ...state,
        density: action.density,
        // Beginner has no energy tab and no angle view: fall back to what it shows.
        rightTab: action.density === 'beginner' && state.rightTab === 'energy' ? 'state' : state.rightTab,
        scopeView: action.density === 'beginner' && state.scopeView === 'angle' ? 'waveforms' : state.scopeView,
      }
    case 'setFocus':
      return { ...state, focus: action.on, drawer: null, inspecting: false }
    case 'setRightTab':
      return { ...state, rightTab: action.tab, progress: action.tab === 'why' ? { ...state.progress, whyPressed: true } : state.progress }
    case 'setScopeView':
      return { ...state, scopeView: action.view }
    case 'openDrawer':
      return { ...state, drawer: action.drawer, progress: action.drawer.kind === 'why' ? { ...state.progress, whyPressed: true } : state.progress }
    case 'closeDrawer':
      return { ...state, drawer: null, selectedEventGroupId: state.drawer?.kind === 'event' ? null : state.selectedEventGroupId }
    case 'setInspecting':
      return { ...state, inspecting: action.on, drawer: action.on ? state.drawer : state.drawer?.kind === 'inspect' ? null : state.drawer }
    case 'setChannels':
      return { ...state, preset: action.preset, visible: action.visible ?? state.visible }
    case 'observedDiode': {
      const key = action.on ? 'sawOn' : 'sawOff'
      if (state.progress[key] || !state.progress.cursorMoved) return state
      return { ...state, progress: { ...state.progress, [key]: true } }
    }
  }
}

/** Keep the energy channels' visibility when the default map is replaced. */
function advancedOf(state: LabState): Partial<Record<SignalId, boolean>> {
  return Object.fromEntries((Object.keys(SIGNAL_META) as SignalId[]).filter((s) => SIGNAL_META[s].advanced).map((s) => [s, state.showEnergy]))
}

function withEnergy(state: LabState, on: boolean): LabState {
  const visible = { ...state.visible }
  for (const s of Object.keys(SIGNAL_META) as SignalId[]) if (SIGNAL_META[s].advanced) visible[s] = on
  // In Explore, showing energy opens the ENERGY tab. In a mode (e.g. a lesson step that asks for
  // the energy view) the mode's panel stays in front and shows the energy panel itself.
  const explore = state.mode === 'lab' && !state.focus
  return { ...state, showEnergy: on, visible, rightTab: on && explore ? 'energy' : state.rightTab === 'energy' && !on ? 'state' : state.rightTab }
}

/**
 * When frequency or duration change, the time axis changes meaning. Keep the cursor
 * at the same point of the cycle (same θ) and refit the view; otherwise keep both.
 */
function withRetimedCursor(state: LabState, params: LabParams): LabState {
  const id = circuitIdOf(state)
  const before = sanitizeParams(state.params, id).params
  const after = sanitizeParams(params, id).params
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
