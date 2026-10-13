import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GUIDE } from '../src/guide/content.ts'
import type { GuideArticle, GuideBlock } from '../src/guide/types.ts'
import { isWorkspaceTopic, LABS, labById, topicOf } from '../src/catalogue/catalogue.ts'
import type { AnyTopic } from '../src/lab/types.ts'
import { runSimulation, sampleAt } from '../src/simulation/engine.ts'
import { measure, type Measurements } from '../src/measurements/measurements.ts'
import { overlapAnalysis } from '../src/measurements/overlap.ts'
import { circuitIdOf, initialLabState, labReducer, type LabState } from '../src/state/labState.ts'
import { getExplainer } from '../src/explanations/index.ts'
import { rectifierWhyQuestions } from '../src/explanations/status.ts'
import { freewheelInsight } from '../src/explanations/freewheel.ts'
import { isThreePhase, supportsFreewheel, type LoadType, type SimulationResult } from '../src/types/simulation.ts'
import * as dcdc from '../src/workspaces/dcdc.tsx'
import * as pwm from '../src/workspaces/pwm.tsx'
import * as inverters from '../src/workspaces/inverters.tsx'
import * as devices from '../src/workspaces/devices.tsx'
import * as magnetics from '../src/workspaces/magnetics.tsx'
import * as control from '../src/workspaces/control.tsx'
import * as drives from '../src/workspaces/drives.tsx'
import * as thermal from '../src/workspaces/thermal.tsx'
import * as ev from '../src/workspaces/ev.tsx'

/*
 * THE LAB GUIDE is checked against the real simulations:
 *   1. structure — unique ids, every lab has 3–7 articles, every READY workspace topic has an article;
 *   2. links — every "Try it" and every `topics` entry points at a READY workspace topic, with only query keys
 *      (and values, inside the parameter limits) that workspace accepts;
 *   3. numbers — every worked example's result is confirmed by running the simulation at the example's settings
 *      (the workspace defaults plus a query the workspace accepts), value by value, within a stated tolerance;
 *   4. WHY prompts — each one is a question the lab's WHY panel really asks at some instant of those runs;
 *   5. no physics in the guide — its data files import nothing but each other.
 */

// ── the simulations behind the workspaces ────────────────────────────────────────────────────────────────

const SHELL: Record<string, Record<string, AnyTopic>> = {
  'dc-dc': dcdc.TOPICS,
  pwm: pwm.TOPICS,
  inverters: inverters.TOPICS,
  devices: devices.TOPICS,
  magnetics: magnetics.TOPICS,
  control: control.TOPICS,
  drives: drives.TOPICS,
  thermal: thermal.TOPICS,
  ev: ev.TOPICS,
}

/** The workspace's own cast of route values (useTopicWorkspace `coerce`): unknown keys are ignored there. */
function coerce(defaults: Record<string, unknown>, q: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(q)) {
    if (!(k in defaults)) continue
    if (typeof defaults[k] === 'number') {
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    } else if (typeof defaults[k] === 'string') out[k] = v
  }
  return out
}

/** Problems with a topic workspace query (empty = the workspace accepts every key and value as given). */
function topicQueryProblems(t: AnyTopic, q: Record<string, string>): string[] {
  const bad: string[] = []
  const defaults = t.defaults as Record<string, unknown>
  const specs = [...t.basic, ...t.advanced]
  for (const [k, v] of Object.entries(q)) {
    if (!(k in defaults)) {
      bad.push(`${k}: not a parameter of ${t.id}`)
      continue
    }
    const d = defaults[k]
    const spec = specs.find((s) => s.key === k)
    if (typeof d === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) bad.push(`${k}=${v}: not a number`)
      else if (spec?.kind === 'number' && (n < spec.min || n > spec.max)) bad.push(`${k}=${v}: outside ${spec.min}…${spec.max}`)
      else if (spec?.kind === 'choice' && !spec.options.some((o) => Number(o.value) === n)) bad.push(`${k}=${v}: not an option`)
      else if (!spec && k !== 'periods') bad.push(`${k}: no control for it in the workspace`)
    } else if (typeof d === 'string') {
      if (spec?.kind === 'choice') {
        if (!spec.options.some((o) => String(o.value) === v)) bad.push(`${k}=${v}: not an option`)
      } else if (k === 'view' || k === t.viewKey) {
        if (v !== 'steady' && v !== 'startup') bad.push(`${k}=${v}: not a view`)
      } else bad.push(`${k}: no control for it in the workspace`)
    } else bad.push(`${k}: not settable from the address`)
  }
  return bad
}

const RECT_LOADS: LoadType[] = ['R', 'RL', 'RC', 'RLC']
/** Problems with a rectifier workspace query (keys it reads: load, fw, alpha, ls [mH], sheet). */
function rectifierQueryProblems(topicId: string, q: Record<string, string>): string[] {
  const sel = topicOf(labById('rectifiers')!, topicId)?.rectifier
  if (!sel) return [`${topicId}: not a rectifier circuit`]
  const bad: string[] = []
  const load = (q.load ?? 'R') as LoadType
  for (const [k, v] of Object.entries(q)) {
    if (k === 'load') {
      if (!RECT_LOADS.includes(v as LoadType)) bad.push(`load=${v}`)
    } else if (k === 'fw') {
      if (v !== '1' || !supportsFreewheel(sel.topology, load)) bad.push(`fw=${v} on ${sel.topology}:${load}`)
    } else if (k === 'alpha') {
      const n = Number(v)
      if (sel.device !== 'scr' || !(n >= 0 && n <= 180)) bad.push(`alpha=${v} on a ${sel.device} circuit`)
    } else if (k === 'ls') {
      const n = Number(v)
      if (!isThreePhase(sel.topology) || !(n >= 0 && n <= 100)) bad.push(`ls=${v} (mH) on ${sel.topology}`)
    } else if (k === 'sheet') {
      if (v !== 'commutation' || !isThreePhase(sel.topology)) bad.push(`sheet=${v}`)
    } else bad.push(`${k}: the rectifier workspace does not read it`)
  }
  return bad
}

/** The rectifier workspace's starting state, built exactly as App's initialState builds it (without carried values). */
function rectifierState(topicId: string, q: Record<string, string>): LabState {
  const sel = topicOf(labById('rectifiers')!, topicId)!.rectifier!
  const load = (RECT_LOADS.includes(q.load as LoadType) ? q.load : 'R') as LoadType
  let s: LabState = initialLabState
  if (sel.topology.startsWith('3ph')) s = labReducer(s, { type: 'setSection', section: 'three' })
  s = labReducer(s, { type: 'chooseRectifier', topology: sel.topology, device: sel.device })
  s = labReducer(s, { type: 'chooseLoad', load })
  const ctl = s.params.control ?? { device: sel.device, alphaDeg: 30, freewheel: false }
  const params = { ...s.params, control: { ...ctl, freewheel: q.fw === '1', alphaDeg: q.alpha !== undefined ? Number(q.alpha) : ctl.alphaDeg } }
  if (q.ls !== undefined && s.params.threePhase) params.threePhase = { ...s.params.threePhase, ls: Number(q.ls) * 1e-3 }
  return labReducer(s, { type: 'setParams', params })
}

interface Sim {
  lab: string
  topic: string
  query?: Record<string, string>
}
interface Ran {
  r: unknown
  m: unknown
}
const runs = new Map<string, Ran>()
function run(s: Sim): Ran {
  const key = JSON.stringify([s.lab, s.topic, s.query ?? {}])
  let out = runs.get(key)
  if (!out) {
    if (s.lab === 'rectifiers') {
      const st = rectifierState(s.topic, s.query ?? {})
      const r = runSimulation(st.params, circuitIdOf(st))
      out = { r, m: measure(r) }
    } else {
      const t = SHELL[s.lab][s.topic]
      const r = t.simulate({ ...(t.defaults as object), ...coerce(t.defaults as Record<string, unknown>, s.query ?? {}) })
      out = { r, m: t.measure(r) }
    }
    runs.set(key, out)
  }
  return out
}

// ── the example checks ───────────────────────────────────────────────────────────────────────────────────

/**
 * One stated value of an example: `text` must appear in the example (its settings or its result); its number is compared with
 * what `get` reads from the run. Default tolerance: the stated value is the simulated one rounded as written
 * (half a unit of the last digit) plus 0.2 % for the run's own numerics (time step, event refinement).
 * `tol` (relative) replaces it where the text compares a closed-form value with the simulation — `why` says why.
 */
interface NumCheck {
  text: string
  /** The value the text states, when its first number is not it (a relation such as "Vm/π − Vf"). */
  expect?: number
  sim: Sim
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(m: any, r: any): number
  tol?: number
  why?: string
}
/** A stated fact that is not a number (a mode, a flag). */
interface FactCheck {
  fact: string
  sim: Sim
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  is(m: any, r: any): boolean
}
type Check = NumCheck | FactCheck

const R = (topic: string, query: Record<string, string>): Sim => ({ lab: 'rectifiers', topic, query })
const T = (lab: string, topic: string, query: Record<string, string> = {}): Sim => ({ lab, topic, query })
type RM = Measurements
type RR = SimulationResult
const DEG = Math.PI / 180

// rectifier runs
const hwR = R('1ph-half-wave', { load: 'R' })
const hwRL = R('1ph-half-wave', { load: 'RL' })
const hwRLfw = R('1ph-half-wave', { load: 'RL', fw: '1' })
const brR = R('1ph-bridge', { load: 'R' })
const ctR = R('1ph-center-tap', { load: 'R' })
const brRC = R('1ph-bridge', { load: 'RC' })
const fullScr45 = R('1ph-bridge-scr', { load: 'RL', alpha: '45' })
const semi45 = R('1ph-semi', { load: 'RL', alpha: '45' })
const b6scr45 = R('3ph-bridge-scr', { load: 'RL', alpha: '45' })
const p3 = R('3ph-3pulse', { load: 'R' })
const p6 = R('3ph-6pulse', { load: 'R' })
const ov0 = R('3ph-bridge-scr', { load: 'RL', alpha: '30' })
const ov2 = R('3ph-bridge-scr', { load: 'RL', alpha: '30', ls: '2' })
const vf = (r: RR) => r.params.diode.vf

const CHECKS: Record<string, Check[]> = {
  // ── Rectifiers ──
  'rectifiers/half-wave#0': [
    { text: '5.40 V', sim: hwR, get: (_m, r: RR) => r.params.vm / Math.PI, why: 'closed form Vm/π from the simulated source peak' },
    { text: '5.06 V', sim: hwR, get: (m: RM) => m.voutAvg },
    { text: '175.3°', sim: hwR, get: (m: RM) => m.conductionAngleDeg },
    { text: '16.97 V', sim: hwR, get: (m: RM) => m.piv },
  ],
  'rectifiers/inductive-load#0': [
    { text: '236.9°', sim: hwRL, get: (m: RM) => m.turnOffAngleDeg! },
    { text: '3.72 V', sim: hwRL, get: (m: RM) => m.voutAvg },
    { fact: 'without Dfw the current stops each cycle', sim: hwRL, is: (m: RM) => m.ioMin === 0 },
    { text: '0.048 A', sim: hwRLfw, get: (m: RM) => m.ioMin },
    { text: '4.70 V', sim: hwRLfw, get: (m: RM) => m.voutAvg },
    { text: 'Vm/π − Vf', expect: 4.7, sim: hwRLfw, get: (_m, r: RR) => r.params.vm / Math.PI - vf(r), tol: 0.002, why: 'the stated relation must give the simulated 4.70 V (constant-drop diodes, continuous current)' },
  ],
  'rectifiers/full-wave#0': [
    { text: '9.44 V', sim: brR, get: (m: RM) => m.voutAvg },
    { text: '16.27 V', sim: brR, get: (m: RM) => m.piv },
    { text: '10.11 V', sim: ctR, get: (m: RM) => m.voutAvg },
    { text: '33.24 V', sim: ctR, get: (m: RM) => m.piv },
    { text: '100 Hz', sim: brR, get: (m: RM) => m.rippleFrequency! },
    { text: '100 Hz', sim: ctR, get: (m: RM) => m.rippleFrequency! },
  ],
  'rectifiers/capacitor-filter#0': [
    { text: '9.44 V', sim: brR, get: (m: RM) => m.voutAvg },
    { text: '12.14 V', sim: brRC, get: (m: RM) => m.voutAvg },
    { text: '7.39 V', sim: brRC, get: (m: RM) => m.ripplePP },
    { text: '71.9°', sim: brRC, get: (m: RM) => m.conductionAngleDeg },
    { text: '5.22 A', sim: brRC, get: (m: RM) => m.idPeak },
    { text: '15.6 V', sim: brRC, get: (m: RM, r: RR) => m.voutPeak / (2 * r.params.frequency * r.params.resistance * r.params.capacitance), why: 'the textbook ΔV evaluated with the simulated output peak' },
  ],
  'rectifiers/firing-angle#0': [
    { text: '6.24 V', sim: fullScr45, get: (m: RM) => m.voutAvg },
    { text: '0.12 A', sim: fullScr45, get: (m: RM) => m.ioMin },
    { text: '0.9·12·cos 45° − 2·0.7 V', expect: 6.24, sim: fullScr45, get: (_m, r: RR) => ((2 * r.params.vm) / Math.PI) * Math.cos(r.params.control.alpha) - 2 * vf(r), tol: 0.002, why: 'the stated relation must give the simulated 6.24 V (continuous current, constant device drops)' },
    { text: '7.82 V', sim: semi45, get: (m: RM) => m.voutAvg },
    { text: '(Vm/π)(1 + cos 45°) − 2·0.7 V', expect: 7.82, sim: semi45, get: (_m, r: RR) => (r.params.vm / Math.PI) * (1 + Math.cos(r.params.control.alpha)) - 2 * vf(r), tol: 0.002, why: 'the stated relation must give the simulated 7.82 V' },
  ],
  'rectifiers/firing-angle#1': [
    { text: '18.46 V', sim: b6scr45, get: (m: RM) => m.voutAvg },
    { text: '1.35·20.78·cos 45° − 2·0.7 V', expect: 18.46, sim: b6scr45, get: (_m, r: RR) => ((3 * Math.SQRT2) / Math.PI) * Math.sqrt(3) * r.params.vrms * Math.cos(r.params.control.alpha) - 2 * vf(r), tol: 0.002, why: 'the stated relation (exact coefficient 3√2/π) must give the simulated 18.46 V' },
    { text: '20.78 V', sim: b6scr45, get: (_m, r: RR) => Math.sqrt(3) * r.params.vrms, why: 'VLL = √3·Vph' },
  ],
  'rectifiers/three-phase#0': [
    { text: '13.34 V', sim: p3, get: (m: RM) => m.voutAvg },
    { text: '1.17·12 − 0.7 V', expect: 13.34, sim: p3, get: (_m, r: RR) => ((3 * Math.sqrt(6)) / (2 * Math.PI)) * r.params.vrms - vf(r), tol: 0.002, why: 'the stated relation (exact coefficient 3√6/2π) must give the simulated 13.34 V' },
    { text: '8.49 V', sim: p3, get: (m: RM) => m.ripplePP },
    { text: '150 Hz', sim: p3, get: (m: RM) => m.rippleFrequency! },
    { text: '26.67 V', sim: p6, get: (m: RM) => m.voutAvg },
    { text: '1.35·20.78 − 2·0.7 V', expect: 26.67, sim: p6, get: (_m, r: RR) => ((3 * Math.SQRT2) / Math.PI) * Math.sqrt(3) * r.params.vrms - 2 * vf(r), tol: 0.002, why: 'the stated relation must give the simulated 26.67 V' },
    { text: '3.94 V', sim: p6, get: (m: RM) => m.ripplePP },
    { text: '300 Hz', sim: p6, get: (m: RM) => m.rippleFrequency! },
  ],
  'rectifiers/commutation-overlap#0': [
    { text: '8.5°', sim: ov2, get: (m: RM) => m.overlapDeg! },
    { fact: 'the overlap relation applies (all its assumptions hold in this run)', sim: ov2, is: (_m, r: RR) => overlapAnalysis(r)!.available },
    { text: '8.6°', sim: ov2, get: (_m, r: RR) => overlapAnalysis(r)!.theoryMu!, why: 'the relation evaluated by the lab with the simulated Id' },
    { text: '2.17 A', sim: ov2, get: (m: RM) => m.ioAvg },
    { text: '22.91 V', sim: ov0, get: (m: RM) => m.voutAvg },
    { text: '21.73 V', sim: ov2, get: (m: RM) => m.voutAvg },
    { text: '1.30 V', sim: ov2, get: (m: RM, r: RR) => (3 * r.params.omega * r.params.threePhase.ls * m.ioAvg) / Math.PI, why: '3ωLs·Id/π with the simulated Id' },
    { text: '21.61 V', sim: ov2, get: (m: RM, r: RR) => (run(ov0).m as RM).voutAvg - (3 * r.params.omega * r.params.threePhase.ls * m.ioAvg) / Math.PI, why: 'Vdc(Ls = 0) − ΔVdc' },
    { text: 'within 1 %', expect: 21.73, sim: ov2, get: (m: RM, r: RR) => (run(ov0).m as RM).voutAvg - (3 * r.params.omega * r.params.threePhase.ls * m.ioAvg) / Math.PI, tol: 0.01, why: 'the prediction 21.61 V vs the simulated 21.73 V: the claim is that they agree within 1 %' },
  ],

  // ── DC-DC ──
  'dc-dc/buck#0': [
    { text: '12.00 V', sim: T('dc-dc', 'buck'), get: (m) => m.voutAvg },
    { text: '2.00 A', sim: T('dc-dc', 'buck'), get: (m) => m.ioAvg },
    { text: '3.02 A', sim: T('dc-dc', 'buck'), get: (m) => m.ilPP },
    { text: '3.0 A', sim: T('dc-dc', 'buck'), get: (_m, r) => ((r.params.vin - r.params.duty * r.params.vin) * r.params.duty) / (r.params.l * r.params.fs), why: 'the closed form (Vin − Vout)·D/(L·fs) with Vout = D·Vin' },
    { text: '0.19 V', sim: T('dc-dc', 'buck'), get: (m) => m.voutPP },
  ],
  'dc-dc/ccm-dcm#0': [
    { fact: 'DCM', sim: T('dc-dc', 'buck', { r: '30' }), is: (m) => m.mode === 'DCM' && m.ilMin <= 1e-9 },
    { text: '17.35 V', sim: T('dc-dc', 'buck', { r: '30' }), get: (m) => m.voutAvg },
    { text: '0.58 A', sim: T('dc-dc', 'buck', { r: '30' }), get: (m) => m.ioAvg },
    { text: '1.5 A', sim: T('dc-dc', 'buck'), get: (m) => m.ilPP / 2, why: 'ΔiL/2 of the CCM buck (the ripple does not depend on the load in CCM)' },
  ],
  'dc-dc/boost#0': [
    { text: '47.93 V', sim: T('dc-dc', 'boost', { duty: '0.75' }), get: (m) => m.voutAvg },
    { text: '2.00 A', sim: T('dc-dc', 'boost', { duty: '0.75' }), get: (m) => m.ioAvg },
    { text: '7.98 A', sim: T('dc-dc', 'boost', { duty: '0.75' }), get: (m) => m.ilAvg },
    { text: '2.00 A/(1 − 0.75)', expect: 7.98, sim: T('dc-dc', 'boost', { duty: '0.75' }), get: (m) => m.ioAvg / (1 - 0.75), tol: 0.003, why: '“about”: Iout/(1 − D) agrees with the simulated IL within 0.3 % (ideal devices)' },
  ],
  'dc-dc/buck-boost#0': [
    { text: '−17.95 V', sim: T('dc-dc', 'buck-boost', { duty: '0.6' }), get: (m) => m.voutAvg },
    { text: '3.74 A', sim: T('dc-dc', 'buck-boost', { duty: '0.6' }), get: (m) => m.ilAvg },
    { text: 'the sum of the input and the output current', expect: 3.74, sim: T('dc-dc', 'buck-boost', { duty: '0.6' }), get: (m) => m.pinAvg / 12 + Math.abs(m.ioAvg), tol: 0.003, why: 'IL = Iin + |Iout| (KCL averaged over a period), Iin = Pin/Vin' },
  ],
  'dc-dc/coupling-capacitor#0': [
    { text: '−18.01 V', sim: T('dc-dc', 'cuk', { duty: '0.6' }), get: (m) => m.voutAvg },
    { text: '30.01 V', sim: T('dc-dc', 'cuk', { duty: '0.6' }), get: (m) => m.vc1Avg },
    { text: '17.97 V', sim: T('dc-dc', 'sepic', { duty: '0.6' }), get: (m) => m.voutAvg },
    { text: '12.00 V', sim: T('dc-dc', 'sepic', { duty: '0.6' }), get: (m) => m.vc1Avg },
    { text: '18.01 V', sim: T('dc-dc', 'zeta', { duty: '0.6' }), get: (m) => m.voutAvg },
    { text: '18.01 V', sim: T('dc-dc', 'zeta', { duty: '0.6' }), get: (m) => m.vc1Avg },
    { text: '1.35 A', sim: T('dc-dc', 'cuk', { duty: '0.6' }), get: (m) => m.iinMin },
    { fact: 'the Zeta’s input current drops to zero', sim: T('dc-dc', 'zeta', { duty: '0.6' }), is: (m) => Math.abs(m.iinMin) < 1e-9 },
  ],
  'dc-dc/bidirectional#0': [
    { text: '+9.53 A', sim: T('dc-dc', 'bidirectional', { control: 'duty', duty: '0.52' }), get: (m) => m.ibAvg },
    { text: '238 W', sim: T('dc-dc', 'bidirectional', { control: 'duty', duty: '0.52' }), get: (m) => m.phvAvg },
    { text: '−9.53 A', sim: T('dc-dc', 'bidirectional', { control: 'duty', duty: '0.48' }), get: (m) => m.ibAvg },
    { text: '−220 W', sim: T('dc-dc', 'bidirectional', { control: 'duty', duty: '0.48' }), get: (m) => m.phvAvg },
  ],

  // ── PWM ──
  'pwm/duty-average#0': [
    { text: '30.0 V', sim: T('pwm', 'lab', { reference: 'dc', duty: '0.3', output: 'unipolar', periods: '4' }), get: (m) => m.avg },
    { text: '54.8 V', sim: T('pwm', 'lab', { reference: 'dc', duty: '0.3', output: 'unipolar', periods: '4' }), get: (m) => m.rms },
    { text: '√0.3·100 V', expect: 54.8, sim: T('pwm', 'lab', { reference: 'dc', duty: '0.3', output: 'unipolar', periods: '4' }), get: () => Math.sqrt(0.3) * 100, tol: 0.001, why: 'the closed form √D·Vdc must equal the simulated RMS' },
  ],
  'pwm/sine-triangle#0': [
    { text: '40.0 V', sim: T('pwm', 'lab', { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' }), get: (m) => m.v1 },
    { text: '40.9 V', sim: T('pwm', 'lab', { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' }), get: (m) => m.at[15] },
    { text: '11.0 V', sim: T('pwm', 'lab', { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' }), get: (m) => m.at[13] },
    { text: '11.0 V', sim: T('pwm', 'lab', { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' }), get: (m) => m.at[17] },
    { fact: 'h = 15 is the largest harmonic', sim: T('pwm', 'lab', { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' }), is: (m) => [...Array(60).keys()].filter((h) => h > 1).every((h) => (m.at[h] ?? 0) <= m.at[15]) },
    { fact: 'the 3rd and 5th harmonics are practically zero (< 0.1 % of V1)', sim: T('pwm', 'lab', { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' }), is: (m) => m.at[3] < 1e-3 * m.v1 && m.at[5] < 1e-3 * m.v1 },
  ],
  'pwm/multiple-pulse#0': [
    { text: '90.0 V', sim: T('pwm', 'multi-pulse', { p: '1', m: '0.5' }), get: (m) => m.v1 },
    { text: '90° pulse', sim: T('pwm', 'multi-pulse', { p: '1', m: '0.5' }), get: (m) => m.deltaDeg },
    { text: '30.0 V', sim: T('pwm', 'multi-pulse', { p: '1', m: '0.5' }), get: (m) => m.at[3] },
    { fact: 'p = 1: the 3rd is the largest harmonic', sim: T('pwm', 'multi-pulse', { p: '1', m: '0.5' }), is: (m) => m.dominant === 3 },
    { text: '64.5 V', sim: T('pwm', 'multi-pulse', { p: '5', m: '0.5' }), get: (m) => m.v1 },
    { text: '18° pulses', sim: T('pwm', 'multi-pulse', { p: '5', m: '0.5' }), get: (m) => m.deltaDeg },
    { text: 'h = 9', sim: T('pwm', 'multi-pulse', { p: '5', m: '0.5' }), get: (m) => m.dominant },
    { text: '45.2 V', sim: T('pwm', 'multi-pulse', { p: '5', m: '0.5' }), get: (m) => m.dominantAmp },
    { text: '70.7 V', sim: T('pwm', 'multi-pulse', { p: '1', m: '0.5' }), get: (m) => m.rms },
    { text: '70.7 V', sim: T('pwm', 'multi-pulse', { p: '5', m: '0.5' }), get: (m) => m.rms },
  ],

  // ── Inverters ──
  'inverters/square-wave#0': [
    { text: '127.3 V', sim: T('inverters', '1ph', { topology: 'full', modulation: 'square' }), get: (m) => m.v1 },
    { text: '42.4 V', sim: T('inverters', '1ph', { topology: 'full', modulation: 'square' }), get: (m) => m.v3 },
    { text: '48.3 %', sim: T('inverters', '1ph', { topology: 'full', modulation: 'square' }), get: (m) => m.thdV * 100 },
    { text: '20.4 %', sim: T('inverters', '1ph', { topology: 'full', modulation: 'square' }), get: (m) => m.thdI * 100 },
    { text: '63.7 V', sim: T('inverters', '1ph', { topology: 'half', modulation: 'square' }), get: (m) => m.v1 },
  ],
  'inverters/quasi-square#0': [
    { text: '110.3 V', sim: T('inverters', '1ph', { modulation: 'quasi', alphaDeg: '30' }), get: (m) => m.v1 },
    { text: '127.3 V·cos 30°', expect: 110.3, sim: T('inverters', '1ph', { modulation: 'quasi', alphaDeg: '30' }), get: () => ((4 * 100) / Math.PI) * Math.cos(30 * DEG), tol: 0.002, why: '(4·Vdc/π)·cos α must equal the simulated V1 (ideal switches)' },
    { fact: 'the 3rd harmonic is practically zero (< 0.1 % of V1)', sim: T('inverters', '1ph', { modulation: 'quasi', alphaDeg: '30' }), is: (m) => m.v3 < 1e-3 * m.v1 },
    { text: '48.3 %', sim: T('inverters', '1ph', { topology: 'full', modulation: 'square' }), get: (m) => m.thdV * 100 },
    { text: '31.1 %', sim: T('inverters', '1ph', { modulation: 'quasi', alphaDeg: '30' }), get: (m) => m.thdV * 100 },
  ],
  'inverters/six-step#0': [
    { text: '110.3 V', sim: T('inverters', '3ph'), get: (m) => m.v1 },
    { text: '31.1 %', sim: T('inverters', '3ph'), get: (m) => m.thdV * 100 },
    { fact: 'no 3rd harmonic (< 0.1 % of V1)', sim: T('inverters', '3ph'), is: (m) => m.v3 < 1e-3 * m.v1 },
    { text: '8.4 %', sim: T('inverters', '3ph'), get: (m) => m.thdI * 100 },
  ],
  'inverters/120-conduction#0': [
    { text: '55.1 V', sim: T('inverters', '120', { conduction: '120', load: 'R' }), get: (m) => m.vph1 },
    { text: '95.5 V', sim: T('inverters', '120', { conduction: '120', load: 'R' }), get: (m) => m.v1 },
    { fact: 'at most two switches conduct', sim: T('inverters', '120', { conduction: '120', load: 'R' }), is: (m) => m.maxConducting === 2 },
    { text: '120° of every cycle', sim: T('inverters', '120', { conduction: '120', load: 'R' }), get: (m) => (m.floatFraction / 3) * 360 },
    { text: '63.7 V', sim: T('inverters', '120', { conduction: '180', load: 'R' }), get: (m) => m.vph1 },
    { text: '110.3 V', sim: T('inverters', '120', { conduction: '180', load: 'R' }), get: (m) => m.v1 },
  ],
  'inverters/spwm#0': [
    { text: '80.0 V', sim: T('inverters', 'spwm', { modulation: 'spwm-bipolar', m: '0.8' }), get: (m) => m.v1 },
    { text: '146 %', sim: T('inverters', 'spwm', { modulation: 'spwm-bipolar', m: '0.8' }), get: (m) => m.thdV * 100 },
    { text: '14.4 %', sim: T('inverters', 'spwm', { modulation: 'spwm-bipolar', m: '0.8' }), get: (m) => m.thdI * 100 },
    { text: '80.0 V', sim: T('inverters', 'spwm', { modulation: 'spwm-unipolar', m: '0.8' }), get: (m) => m.v1 },
    { text: '77 %', sim: T('inverters', 'spwm', { modulation: 'spwm-unipolar', m: '0.8' }), get: (m) => m.thdV * 100 },
    { text: '4.0 %', sim: T('inverters', 'spwm', { modulation: 'spwm-unipolar', m: '0.8' }), get: (m) => m.thdI * 100 },
  ],
  'inverters/spwm#1': [
    { text: '113.3 V', sim: T('inverters', 'spwm', { modulation: 'spwm-bipolar', m: '1.3' }), get: (m) => m.v1 },
    { text: '11.2 V', sim: T('inverters', 'spwm', { modulation: 'spwm-bipolar', m: '1.3' }), get: (m) => m.v3 },
  ],
  'inverters/svpwm#0': [
    { text: '77.4 V', sim: T('inverters', 'svpwm', { m: '0.9' }), get: (m) => m.v1 },
    { text: '77.9 V', sim: T('inverters', 'svpwm', { m: '0.9' }), get: () => (Math.sqrt(3) / 2) * 0.9 * 100, why: 'the closed form (√3/2)·m·Vdc' },
    { text: '98.9 V', sim: T('inverters', 'svpwm', { m: '1.15' }), get: (m) => m.v1 },
    { text: '99.6 V', sim: T('inverters', 'svpwm', { m: '1.15' }), get: () => (Math.sqrt(3) / 2) * 1.15 * 100, why: 'the closed form (√3/2)·m·Vdc' },
    { fact: 'both within 1 % of (√3/2)·m·Vdc', sim: T('inverters', 'svpwm', { m: '0.9' }), is: (m) => Math.abs(m.v1 / ((Math.sqrt(3) / 2) * 0.9 * 100) - 1) < 0.01 && Math.abs((run(T('inverters', 'svpwm', { m: '1.15' })).m as { v1: number }).v1 / ((Math.sqrt(3) / 2) * 1.15 * 100) - 1) < 0.01 },
  ],

  // ── Switching devices ──
  'devices/mosfet-switching#0': [
    { text: '4.16 V', sim: T('devices', 'mosfet'), get: (m) => m.plateau },
    { text: '4.0 V', sim: T('devices', 'mosfet'), get: (_m, r) => r.params.vth + r.params.i0 / r.params.gm, why: 'Vth + I0/gm' },
    { text: '3.78 µJ', sim: T('devices', 'mosfet'), get: (m) => m.eon * 1e6 },
    { text: '7.35 µJ', sim: T('devices', 'mosfet'), get: (m) => m.eoff * 1e6 },
    { text: '7.39 µJ', sim: T('devices', 'mosfet', { rg: '10' }), get: (m) => m.eon * 1e6 },
    { text: '14.7 µJ', sim: T('devices', 'mosfet', { rg: '10' }), get: (m) => m.eoff * 1e6 },
    { fact: 'about twice as slow', sim: T('devices', 'mosfet', { rg: '10' }), is: (m) => Math.abs(m.tfv / (run(T('devices', 'mosfet')).m as { tfv: number }).tfv - 2) < 0.1 },
  ],
  'devices/diode-recovery#0': [
    { text: '13.1 A', sim: T('devices', 'diode'), get: (m) => m.irr },
    { text: '26.5 ns', sim: T('devices', 'diode'), get: (m) => m.trr * 1e9 },
    { text: '180 nC', sim: T('devices', 'diode'), get: (m) => m.qrr * 1e9 },
    { text: '105 µJ', sim: T('devices', 'diode'), get: (m) => m.deon * 1e6 },
    { text: '23.6 A', sim: T('devices', 'diode', { didt: '3000000000' }), get: (m) => m.irr },
    { text: '262 nC', sim: T('devices', 'diode', { didt: '3000000000' }), get: (m) => m.qrr * 1e9 },
  ],
  'devices/scr#0': [
    { text: '0.78 A', sim: T('devices', 'scr', { test: 'latch' }), get: (m) => m.iaGateEnd },
    { fact: '20 µs: latched', sim: T('devices', 'scr', { test: 'latch' }), is: (m, r) => m.latched === true && Math.abs(r.params.tw - 20e-6) < 1e-12 && m.iaGateEnd >= r.params.il },
    { text: '0.22 A', sim: T('devices', 'scr', { test: 'latch', tw: '0.000008' }), get: (m) => m.iaGateEnd },
    { fact: '8 µs: falls out', sim: T('devices', 'scr', { test: 'latch', tw: '0.000008' }), is: (m) => m.latched === false && m.failedLatch === true },
  ],
  'devices/scr#1': [
    { text: '7.59 A', sim: T('devices', 'scr', { test: 'commutate' }), get: (m) => m.iT },
    { text: '66.9 µs', sim: T('devices', 'scr', { test: 'commutate' }), get: (m) => m.tc * 1e6 },
    { text: '50.1 µs', sim: T('devices', 'scr', { test: 'commutate' }), get: (m) => m.tq * 1e6 },
    { fact: '6 µF: turns off', sim: T('devices', 'scr', { test: 'commutate' }), is: (m) => m.commutated === true && m.refired === false },
    { text: '35.9 µs', sim: T('devices', 'scr', { test: 'commutate', c: '0.000003' }), get: (m) => m.tc * 1e6 },
    { fact: '3 µF: fires again', sim: T('devices', 'scr', { test: 'commutate', c: '0.000003' }), is: (m) => m.commutated === false && m.refired === true },
  ],
  'devices/igbt#0': [
    { text: '565 µJ', sim: T('devices', 'igbt'), get: (m) => m.eoff * 1e6 },
    { text: '83 %', sim: T('devices', 'igbt'), get: (m) => m.tailShare * 100 },
    { text: '5.86 A', sim: T('devices', 'igbt'), get: (m) => m.itail0 },
    { text: '469 µJ', sim: T('devices', 'igbt'), get: (m) => m.etail * 1e6 },
    { text: '1.60 V', sim: T('devices', 'igbt'), get: (m) => m.vceSat },
    { text: '92.8 µJ', sim: T('devices', 'igbt'), get: (m) => m.mosEoff * 1e6 },
    { text: '3.00 V', sim: T('devices', 'igbt'), get: (m) => m.mosVon },
    { text: '1.00 V', sim: T('devices', 'igbt', { i0: '5' }), get: (m) => m.vceSat },
    { text: '0.75 V', sim: T('devices', 'igbt', { i0: '5' }), get: (m) => m.mosVon },
    { fact: 'at 5 A the MOSFET also has the lower Eoff', sim: T('devices', 'igbt', { i0: '5' }), is: (m) => m.mosEoff < m.eoff },
  ],
  'devices/sic#0': [
    { text: '192 µJ', sim: T('devices', 'sic'), get: (m) => (m.eon + m.eoff) * 1e6 },
    { text: '66 V/ns', sim: T('devices', 'sic'), get: (m) => m.dvdtOff * 1e-9 },
    { text: '105 mΩ', sim: T('devices', 'sic', { tj: '150' }), get: (m) => m.ronSim * 1e3 },
    { text: '30 W', sim: T('devices', 'sic'), get: (m) => m.pcond },
    { text: '42 W', sim: T('devices', 'sic', { tj: '150' }), get: (m) => m.pcond },
    { text: '98.7 mΩ', sim: T('devices', 'sic', { vdrv: '12' }), get: (m) => m.ronSim * 1e3 },
  ],
  'devices/gan#0': [
    { text: '2.45 V', sim: T('devices', 'gan'), get: (m) => m.vsdRev },
    { text: '5.45 V', sim: T('devices', 'gan', { voff: '-3' }), get: (m) => m.vsdRev },
    { text: '492 nJ', sim: T('devices', 'gan'), get: (m) => m.edead * 1e9 },
    { text: '1.19 µJ', sim: T('devices', 'gan', { voff: '-3' }), get: (m) => m.edead * 1e6 },
  ],

  // ── Magnetics ──
  'magnetics/volt-seconds#0': [
    { text: '0.60 T', sim: T('magnetics', 'inductor'), get: (m) => m.dB },
    { text: '0.30 T', sim: T('magnetics', 'inductor'), get: (m) => m.bpk },
    { text: '47.9 µH', sim: T('magnetics', 'inductor'), get: (m) => m.lMeas * 1e6 },
    { text: '6.27 A', sim: T('magnetics', 'inductor'), get: (m) => m.ipk },
    { text: '1.01 mH', sim: T('magnetics', 'inductor', { lg: '0' }), get: (m) => m.lMeas * 1e3 },
    { text: '0.30 A', sim: T('magnetics', 'inductor', { lg: '0' }), get: (m) => m.ipk },
    { text: 'the same 0.60 T', sim: T('magnetics', 'inductor', { lg: '0' }), get: (m) => m.dB },
  ],
  'magnetics/saturation#0': [
    { text: '0.96 V', sim: T('magnetics', 'inductor', { duty: '0.52' }), get: (_m, r) => (2 * r.params.duty - 1) * r.params.vdc, why: 'the average drive voltage (2d − 1)·V' },
    { text: '9.6 A', sim: T('magnetics', 'inductor', { duty: '0.52' }), get: (m) => m.idc },
    { text: '0.41 T', sim: T('magnetics', 'inductor', { duty: '0.52' }), get: (m) => m.bpk },
    { text: '11 %', sim: T('magnetics', 'inductor', { duty: '0.52' }), get: (m) => m.satFrac * 100 },
    { text: '128 A', sim: T('magnetics', 'inductor', { duty: '0.52' }), get: (m) => m.ipk },
    { text: '6.27 A', sim: T('magnetics', 'inductor'), get: (m) => m.ipk },
  ],
  'magnetics/saturation#1': [
    { fact: 'the core saturates during the start-up', sim: T('magnetics', 'inductor', { view: 'startup' }), is: (m) => m.tSat !== null },
    { text: '210 A', sim: T('magnetics', 'inductor', { view: 'startup' }), get: (m) => m.iPeakRun },
    { text: '0.30 T', sim: T('magnetics', 'inductor', { view: 'startup' }), get: (m) => m.bpk },
  ],
  'magnetics/transformer#0': [
    { text: '23.33 V', sim: T('magnetics', 'transformer'), get: (m) => m.v2rms },
    { text: '2.8 %', sim: T('magnetics', 'transformer'), get: (m) => m.regulation * 100 },
    { text: '0.186 A', sim: T('magnetics', 'transformer'), get: (m) => m.imPk },
    { text: '0.117 T', sim: T('magnetics', 'transformer'), get: (m) => m.bpk },
    { text: '23.96 V', sim: T('magnetics', 'transformer', { rload: '500' }), get: (m) => m.v2rms },
    { text: '0.113 A', sim: T('magnetics', 'transformer', { rload: '500' }), get: (m) => m.i1rms },
    { text: '0.048 A', sim: T('magnetics', 'transformer', { rload: '500' }), get: (m) => m.i2rms },
  ],
  'magnetics/transformer-dc#0': [
    { text: '0.200 A', sim: T('magnetics', 'transformer', { voff: '0.01' }), get: (m) => m.i1dc },
    { text: '0.126 T', sim: T('magnetics', 'transformer', { voff: '0.01' }), get: (m) => m.bdc },
    { text: '0.243 T', sim: T('magnetics', 'transformer', { voff: '0.01' }), get: (m) => m.bpk },
    { fact: '10 mV: below Bsat', sim: T('magnetics', 'transformer', { voff: '0.01' }), is: (m, r) => !m.saturated && m.bpk < r.params.bsat },
    { text: '1.00 A', sim: T('magnetics', 'transformer', { voff: '0.05' }), get: (m) => m.i1dc },
    { text: '7.9 %', sim: T('magnetics', 'transformer', { voff: '0.05' }), get: (m) => m.satFrac * 100 },
    { text: '0.72 T', sim: T('magnetics', 'transformer', { f: '15000' }), get: (m) => m.dB },
    { fact: '15 kHz: saturates', sim: T('magnetics', 'transformer', { f: '15000' }), is: (m) => m.saturated === true },
    { text: '37 A', sim: T('magnetics', 'transformer', { f: '15000' }), get: (m) => m.imPk },
  ],
  'magnetics/leakage#0': [
    { text: '18.34 V', sim: T('magnetics', 'transformer', { ll1: '0.00002', ll2: '0.000005' }), get: (m) => m.v2rms },
    { text: '23.6 %', sim: T('magnetics', 'transformer', { ll1: '0.00002', ll2: '0.000005' }), get: (m) => m.regulation * 100 },
    { text: '2.8 %', sim: T('magnetics', 'transformer'), get: (m) => m.regulation * 100 },
    { text: '1.35 µs', sim: T('magnetics', 'transformer', { ll1: '0.00002', ll2: '0.000005' }), get: (m) => m.tRev * 1e6 },
    { text: '0.14 µs', sim: T('magnetics', 'transformer'), get: (m) => m.tRev * 1e6 },
  ],

  // ── Control ──
  'control/why-feedback#0': [
    { text: '1.53 V', sim: T('control', 'buck', { loop: 'open', refStep: 'off' }), get: (m) => -m.loadDev },
    { text: '0.21 V', sim: T('control', 'buck', { loop: 'open', refStep: 'off' }), get: (m) => m.ssError },
    { text: '1.27 V', sim: T('control', 'buck', { loop: 'closed', refStep: 'off' }), get: (m) => -m.loadDev },
    { text: '50.9 %', sim: T('control', 'buck', { loop: 'closed', refStep: 'off' }), get: (m) => m.dFinal * 100 },
    { text: '1.55 ms', sim: T('control', 'buck', { loop: 'closed', refStep: 'off' }), get: (m) => m.recovery * 1e3 },
  ],
  'control/crossover#0': [
    { text: '2.9 %', sim: T('control', 'buck', { loadStep: 'off', fcTarget: '1000' }), get: (m) => m.overshoot * 100 },
    { text: '0.70 ms', sim: T('control', 'buck', { loadStep: 'off', fcTarget: '1000' }), get: (m) => m.settling * 1e3 },
    { text: '43.9 %', sim: T('control', 'buck', { loadStep: 'off', fcTarget: '4000' }), get: (m) => m.overshoot * 100 },
    { text: '3.7 ms', sim: T('control', 'buck', { loadStep: 'off', fcTarget: '4000' }), get: (m) => m.settling * 1e3 },
  ],
  'control/boost-rhp#0': [
    { text: '0.05 %', sim: T('control', 'boost', { loadStep: 'off', fcTarget: '100' }), get: (m) => m.overshoot * 100 },
    { text: '4.6 ms', sim: T('control', 'boost', { loadStep: 'off', fcTarget: '100' }), get: (m) => m.settling * 1e3 },
    { fact: 'fc = 400 Hz: unstable, never settles', sim: T('control', 'boost', { loadStep: 'off', fcTarget: '400' }), is: (m) => m.stable === false && m.settling === null },
  ],

  // ── Drives ──
  'drives/dc-motor-speed#0': [
    { text: '28.8 V', sim: T('drives', 'dc-motor'), get: (m) => m.vaEnd },
    { text: '1.05 A', sim: T('drives', 'dc-motor'), get: (m) => m.iEnd },
    { text: '277.6 rad/s', sim: T('drives', 'dc-motor'), get: (m) => m.wEnd },
    { text: '(28.8 − 1.05)/0.1', expect: 277.6, sim: T('drives', 'dc-motor'), get: (m, r) => (m.vaEnd - r.params.ra * m.iEnd) / r.params.ke, tol: 0.001, why: 'Va = Ra·Ia + k·ω must hold for the simulated averages' },
    { text: '2651 rpm', sim: T('drives', 'dc-motor'), get: (m) => m.nEnd },
    { text: '0.58 A', sim: T('drives', 'dc-motor'), get: (m) => m.ripple },
  ],
  'drives/dc-motor-start-brake#0': [
    { text: '22.5 A', sim: T('drives', 'dc-motor'), get: (m) => m.iPeak },
    { text: '28.8 A', sim: T('drives', 'dc-motor'), get: (_m, r) => (r.params.duty * r.params.vdc) / r.params.ra, why: 'the bound d·Vdc/Ra' },
    { text: '7.05 A', sim: T('drives', 'dc-motor', { tramp: '0.05' }), get: (m) => m.iPeak },
    { fact: 'one quadrant: the current never reverses', sim: T('drives', 'dc-motor', { bridge: '1q', event: 'duty', d2: '0.3' }), is: (m) => m.iNeg > -1e-9 && m.eregen === 0 },
    { text: '−10.2 A', sim: T('drives', 'dc-motor', { bridge: '2q', event: 'duty', d2: '0.3' }), get: (m) => m.iNeg },
    { text: '1.60 J', sim: T('drives', 'dc-motor', { bridge: '2q', event: 'duty', d2: '0.3' }), get: (m) => m.eregen },
  ],
  'drives/bldc#0': [
    { text: '2612 rpm', sim: T('drives', 'bldc'), get: (m) => m.nEnd },
    { text: '273.5 rad/s', sim: T('drives', 'bldc'), get: (m) => m.wEnd },
    { text: '0.103 N·m', sim: T('drives', 'bldc'), get: (m) => m.teMean },
    { fact: 'the mean torque equals TL + B·ω (within 0.5 %: the means are taken over the last cycle of a run that has settled to 0.2 %)', sim: T('drives', 'bldc'), is: (m, r) => Math.abs((r.params.tl + r.params.b * m.wEnd) / m.teMean - 1) < 0.005 },
    { text: '55 %', sim: T('drives', 'bldc'), get: (m) => m.ripple * 100 },
  ],
  'drives/pmsm-foc#0': [
    { text: '2.24 A', sim: T('drives', 'pmsm', { event: 'none' }), get: (m) => m.iqEnd },
    { text: '0.20 N·m', sim: T('drives', 'pmsm', { event: 'none' }), get: (m) => m.teEnd },
    { text: '1.5·4·0.015·2.24', expect: 0.2015, sim: T('drives', 'pmsm', { event: 'none' }), get: (m, r) => 1.5 * r.params.pp * r.params.psi * m.iqEnd, tol: 0.002, why: 'Te = 1.5·p·ψ·iq must give the simulated torque (id = 0)' },
    { fact: 'the load plus friction: Te = TL + B·ω within 0.5 %', sim: T('drives', 'pmsm', { event: 'none' }), is: (m, r) => Math.abs((r.params.tl + r.params.b * m.wEnd) / m.teEnd - 1) < 0.005 },
    { fact: 'id = 0', sim: T('drives', 'pmsm', { event: 'none' }), is: (m) => Math.abs(m.idEnd) < 1e-6 },
    { text: '9.76 V', sim: T('drives', 'pmsm', { event: 'none' }), get: (m) => m.vqEnd },
    { text: 'R·iq + ωe·ψ', expect: 9.76, sim: T('drives', 'pmsm', { event: 'none' }), get: (m, r) => r.params.r * m.iqEnd + r.params.pp * m.wEnd * r.params.psi, tol: 0.005, why: '“≈”: the steady-state relation (id = 0) must agree with the simulated vq within 0.5 %' },
    { text: '27.7 V', sim: T('drives', 'pmsm', { event: 'none' }), get: (_m, r) => r.params.vmax },
    { text: '0.70 ms', sim: T('drives', 'pmsm', { event: 'none' }), get: (m) => m.iqRise * 1e3 },
    { text: 'ln 9/(2π·500 Hz)', expect: 0.7, sim: T('drives', 'pmsm', { event: 'none' }), get: (_m, r) => (Math.log(9) / (2 * Math.PI * r.params.fcc)) * 1e3, tol: 0.002, why: 'the first-order rise time must match the simulated 0.70 ms' },
  ],
  'drives/pmsm-field-weakening#0': [
    { text: '4410 rpm', sim: T('drives', 'pmsm', { event: 'speed', control: 'fw', nref: '1500', n2: '5500' }), get: (_m, r) => ((r.params.vmax / (r.params.pp * r.params.psi)) * 60) / (2 * Math.PI), tol: 0.005, why: '“about”: (Vdc/√3)/(p·ψ) is 4411 rpm' },
    { text: '4287 rpm', sim: T('drives', 'pmsm', { event: 'speed', control: 'id0', nref: '1500', n2: '5500' }), get: (m) => m.nEnd },
    { fact: 'id = 0: stuck at the voltage limit', sim: T('drives', 'pmsm', { event: 'speed', control: 'id0', nref: '1500', n2: '5500' }), is: (m) => m.vlimHit === true && m.nEnd < 5400 },
    { text: '5500 rpm', sim: T('drives', 'pmsm', { event: 'speed', control: 'fw', nref: '1500', n2: '5500' }), get: (m) => m.nEnd },
    { text: '−9.56 A', sim: T('drives', 'pmsm', { event: 'speed', control: 'fw', nref: '1500', n2: '5500' }), get: (m) => m.idEnd },
    { text: '11.2 mWb', sim: T('drives', 'pmsm', { event: 'speed', control: 'fw', nref: '1500', n2: '5500' }), get: (m, r) => (r.params.psi + r.params.ld * m.idEnd) * 1e3 },
    { text: '9.83 A', sim: T('drives', 'pmsm', { event: 'speed', control: 'fw', nref: '1500', n2: '5500' }), get: (m) => m.iAmp },
    { text: '2.24 A', sim: T('drives', 'pmsm', { event: 'none' }), get: (m) => m.iAmp },
  ],
  'drives/induction-slip#0': [
    { text: '1465 rpm', sim: T('drives', 'induction'), get: (m) => m.nEnd },
    { text: '2.35 %', sim: T('drives', 'induction'), get: (m) => m.slip * 100 },
    { text: '56.5 W', sim: T('drives', 'induction'), get: (m) => m.pcuR },
    { text: '2404 W', sim: T('drives', 'induction'), get: (m) => m.pag },
    { text: 's·Pag', expect: 56.5, sim: T('drives', 'induction'), get: (m) => m.slip * m.pag, tol: 0.002, why: 'Pcu,rotor = s·Pag must hold for the simulated values' },
    { text: '1.56 %', sim: T('drives', 'induction', { event: 'load', tl: '10', tl2: '20' }), get: (m) => m.slipPre * 100 },
    { text: '3.18 %', sim: T('drives', 'induction', { event: 'load', tl: '10', tl2: '20' }), get: (m) => m.slip * 100 },
  ],
  'drives/induction-start#0': [
    { text: '79.9 A', sim: T('drives', 'induction', { supply: 'dol' }), get: (m) => m.iPeak },
    { text: '0.13 s', sim: T('drives', 'induction', { supply: 'dol' }), get: (m) => m.tStart },
    { text: '892 J', sim: T('drives', 'induction', { supply: 'dol' }), get: (m) => m.ecuRStart },
    { text: '15.6 A', sim: T('drives', 'induction', { supply: 'vf' }), get: (m) => m.iPeak },
    { text: '170 J', sim: T('drives', 'induction', { supply: 'vf' }), get: (m) => m.ecuRStart },
    { text: '0.96 s', sim: T('drives', 'induction', { supply: 'vf' }), get: (m) => m.tStart },
  ],

  // ── Losses & thermal ──
  'thermal/switch-losses#0': [
    { text: '32.0 W', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.pc25, why: 'the model’s conduction loss at 25 °C' },
    { text: '31.9 W', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.ps25, why: 'the model’s switching loss at 25 °C' },
    { text: '110.9 °C', sim: T('thermal', 'switch', { load: 'constant' }), get: (m) => m.tjMean },
    { text: '88.6 W', sim: T('thermal', 'switch', { load: 'constant' }), get: (m) => m.pMean },
  ],
  'thermal/thermal-path#0': [
    { text: '0.3 K/W', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.rjc, why: 'the Foster network’s total Rjc' },
    { text: '110.9 °C', sim: T('thermal', 'switch', { load: 'constant' }), get: (m) => m.tjMean },
    { text: '40 + 88.6 W·0.8 K/W', expect: 110.9, sim: T('thermal', 'switch', { load: 'constant' }), get: (m, r) => r.params.ta + m.pMean * r.params.rth, tol: 0.001, why: 'Tj = Ta + P·Rth must hold for the simulated steady state' },
    { text: '84.3 °C', sim: T('thermal', 'switch', { load: 'constant' }), get: (m) => m.thsMean },
    { text: '63.9 W', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.a, why: 'the model’s total loss at 25 °C' },
    { text: '91.1 °C', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.ta + r.params.a * r.params.rth, why: 'Ta + P(25 °C)·Rth' },
    { text: '134 s', sim: T('thermal', 'switch', { load: 'constant', view: 'startup' }), get: (m) => m.t90 },
  ],
  'thermal/power-cycling#0': [
    { text: '59.8 °C', sim: T('thermal', 'switch', { load: 'pulsed', ton: '2', toff: '2' }), get: (m) => m.tjMin },
    { text: '84.8 °C', sim: T('thermal', 'switch', { load: 'pulsed', ton: '2', toff: '2' }), get: (m) => m.tjMax },
    { text: '25.0 K', sim: T('thermal', 'switch', { load: 'pulsed', ton: '2', toff: '2' }), get: (m) => m.dTj },
    { text: '72.2 °C', sim: T('thermal', 'switch', { load: 'pulsed', ton: '2', toff: '2' }), get: (m) => m.tjMean },
    { text: '18.6 K', sim: T('thermal', 'switch', { load: 'pulsed', ton: '0.2', toff: '0.2' }), get: (m) => m.dTj },
    { text: '71.7 °C', sim: T('thermal', 'switch', { load: 'pulsed', ton: '0.2', toff: '0.2' }), get: (m) => m.tjMean },
  ],
  'thermal/thermal-runaway#0': [
    { text: '63.9 W', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.a, why: 'the model’s loss at 25 °C' },
    { text: '0.29 W/K', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.b, why: 'the model’s loss slope' },
    { text: 'b·Rth = 0.23', sim: T('thermal', 'switch', { load: 'constant' }), get: (_m, r) => r.params.growth },
    { text: '110.9 °C', sim: T('thermal', 'switch', { load: 'constant' }), get: (m) => m.tjMean },
    { text: 'Rth = 3.8 K/W', sim: T('thermal', 'switch', { load: 'constant', rha: '3.5' }), get: (_m, r) => r.params.rth },
    { text: 'b·Rth = 1.09', sim: T('thermal', 'switch', { load: 'constant', rha: '3.5' }), get: (_m, r) => r.params.growth },
    { fact: 'Rca = 3.5 K/W: thermal runaway', sim: T('thermal', 'switch', { load: 'constant', rha: '3.5' }), is: (m) => m.runaway === true },
  ],

  // ── EV ──
  'ev/drive-cycle#0': [
    { text: '103.4 Wh/km', sim: T('ev', 'drivetrain', { cycle: 'urban' }), get: (m) => m.consumption },
    { text: '522 km', sim: T('ev', 'drivetrain', { cycle: 'urban' }), get: (m) => m.range },
    { text: '0.99 km', sim: T('ev', 'drivetrain', { cycle: 'urban' }), get: (m) => m.dist / 1000 },
    { text: '50.9 Wh', sim: T('ev', 'drivetrain', { cycle: 'urban' }), get: (m) => m.eRegen / 3600 },
    { text: '154.4 Wh/km', sim: T('ev', 'drivetrain', { cycle: 'urban', pregen: '0' }), get: (m) => m.consumption },
    { text: '350 km', sim: T('ev', 'drivetrain', { cycle: 'urban', pregen: '0' }), get: (m) => m.range },
  ],
  'ev/acceleration#0': [
    { text: '64 km/h', sim: T('ev', 'drivetrain', { cycle: 'accel' }), get: (_m, r) => ((r.params.pmax * r.params.wheel) / (r.params.tmax * r.params.gear)) * 3.6, why: 'base speed Pmax·r/(Tmax·G)' },
    { text: '6.42 s', sim: T('ev', 'drivetrain', { cycle: 'accel' }), get: (m) => m.t100 },
    { text: '167 kW', sim: T('ev', 'drivetrain', { cycle: 'accel' }), get: (m) => m.pPeak / 1000 },
    { text: '150 kW peak power divided by the 90 %', expect: 167, sim: T('ev', 'drivetrain', { cycle: 'accel' }), get: (_m, r) => (r.params.pmax / r.params.eta + r.params.aux) / 1000, tol: 0.003, why: 'Pmax/η + Paux must give the simulated peak battery power' },
  ],
  'ev/battery-sag#0': [
    { text: '1.20 V', sim: T('ev', 'battery', { profile: 'pulse', soc0: '0.6', crate: '2', pulses: '3' }), get: (m) => m.vSag0 },
    { text: '8·15 mΩ·10 A', expect: 1.2, sim: T('ev', 'battery', { profile: 'pulse', soc0: '0.6', crate: '2', pulses: '3' }), get: (m, r) => r.params.cells * r.params.r0 * m.iPeak, tol: 0.001, why: 'the instant drop must be N·R0·I' },
    { text: '2.08 V', sim: T('ev', 'battery', { profile: 'pulse', soc0: '0.6', crate: '2', pulses: '3' }), get: (m) => m.vSagT },
  ],
  'ev/weakest-cell#0': [
    { text: '4.28 Ah', sim: T('ev', 'battery', { profile: 'cycle', balancing: 'off' }), get: (m) => m.qDis },
    { text: '12.2 %', sim: T('ev', 'battery', { profile: 'cycle', balancing: 'off' }), get: (m) => m.spreadCh },
    { text: '4.68 Ah', sim: T('ev', 'battery', { profile: 'cycle', balancing: 'on' }), get: (m) => m.qDis },
    { text: '1.0 %', sim: T('ev', 'battery', { profile: 'cycle', balancing: 'on' }), get: (m) => m.spreadCh },
    { text: '9.36 Wh', sim: T('ev', 'battery', { profile: 'cycle', balancing: 'on' }), get: (m) => m.eBleed },
  ],
  'ev/dcdc-stage#0': [
    { text: '176.8 A', sim: T('ev', 'dcdc-stage', { power: '60000' }), get: (m) => m.ilAvg },
    { text: '341.2 V', sim: T('ev', 'dcdc-stage', { power: '60000' }), get: (m) => m.vbtAvg },
    { text: '0.475', sim: T('ev', 'dcdc-stage', { power: '60000' }), get: (m) => m.dutyIdeal },
    { text: '0.483', sim: T('ev', 'dcdc-stage', { power: '60000' }), get: (m) => m.duty },
    { text: '380 W', sim: T('ev', 'dcdc-stage', { power: '60000' }), get: (m) => m.pLoss },
    { text: '99.37 %', sim: T('ev', 'dcdc-stage', { power: '60000' }), get: (m) => m.efficiency * 100 },
    { text: '−139.5 A', sim: T('ev', 'dcdc-stage', { power: '-50000' }), get: (m) => m.ilAvg },
    { text: '49.8 kW', sim: T('ev', 'dcdc-stage', { power: '-50000' }), get: (m) => -m.pBat / 1000 },
  ],
}

// ── helpers over the guide ───────────────────────────────────────────────────────────────────────────────

type TryBlock = Extract<GuideBlock, { kind: 'try' }>
type ExampleBlock = Extract<GuideBlock, { kind: 'example' }>
const tries = (a: GuideArticle) => a.blocks.filter((b): b is TryBlock => b.kind === 'try')
const examples = (a: GuideArticle) => a.blocks.filter((b): b is ExampleBlock => b.kind === 'example')
const keyOf = (a: GuideArticle, n: number) => `${a.lab}/${a.id}#${n}`

/** The number a stated value begins with (Unicode minus allowed); null if the text holds none. */
function numberIn(text: string): { value: number; decimals: number } | null {
  const mt = /[−-]?\d+(?:\.(\d+))?/.exec(text)
  if (!mt) return null
  return { value: Number(mt[0].replace('−', '-')), decimals: mt[1]?.length ?? 0 }
}

/** Problems with a workspace target (a READY workspace topic of a READY lab, with a query it accepts). */
function targetProblems(lab: string, topic: string, query: Record<string, string> = {}, mode?: string): string[] {
  const L = labById(lab)
  if (!L) return [`${lab}: no such lab`]
  if (L.status !== 'ready') return [`${lab}: lab not ready`]
  const t = topicOf(L, topic)
  if (!t) return [`${lab}/${topic}: no such topic`]
  if (t.status !== 'ready') return [`${lab}/${topic}: not ready (${t.status})`]
  if (!isWorkspaceTopic(t)) return [`${lab}/${topic}: an entry point, not a workspace topic`]
  if (mode && !L.modes.includes(mode as never)) return [`${lab}: has no ${mode} mode`]
  if (lab === 'rectifiers') return rectifierQueryProblems(topic, query)
  const sim = SHELL[lab]?.[topic]
  if (!sim) return [`${lab}/${topic}: no simulation topic in the workspace`]
  return topicQueryProblems(sim, query)
}

// ── the tests ───────────────────────────────────────────────────────────────────────────────────────────

describe('Lab guide: structure', () => {
  it('article ids are unique within each lab (and so every address #/guide/:lab/:id is unique)', () => {
    const seen = new Set<string>()
    for (const a of GUIDE) {
      const k = `${a.lab}/${a.id}`
      expect(seen.has(k), k).toBe(false)
      seen.add(k)
      expect(a.id).toMatch(/^[a-z0-9-]+$/)
    }
  })
  it('every lab has 3–7 articles, every article belongs to a lab, and each lab’s articles are contiguous', () => {
    for (const L of LABS) {
      const n = GUIDE.filter((a) => a.lab === L.id).length
      expect(n, L.id).toBeGreaterThanOrEqual(3)
      expect(n, L.id).toBeLessThanOrEqual(7)
    }
    for (const a of GUIDE) expect(labById(a.lab), a.id).toBeTruthy()
    const order = GUIDE.map((a) => a.lab).filter((l, i, xs) => i === 0 || xs[i - 1] !== l)
    expect(new Set(order).size).toBe(order.length)
  })
  it('every article has a title, a summary, a group, at least one equation, one worked example and one “Try it”', () => {
    for (const a of GUIDE) {
      expect(a.title.trim(), a.id).not.toBe('')
      expect(a.summary.trim(), a.id).not.toBe('')
      expect(a.group.trim(), a.id).not.toBe('')
      expect(a.blocks.some((b) => b.kind === 'eq'), `${a.id}: equation`).toBe(true)
      expect(examples(a).length, `${a.id}: example`).toBeGreaterThan(0)
      expect(tries(a).length, `${a.id}: try`).toBeGreaterThan(0)
      expect(a.topics.length, `${a.id}: topics`).toBeGreaterThan(0)
    }
  })
  it('every READY workspace topic of every lab has at least one article', () => {
    for (const L of LABS)
      for (const t of L.topics)
        if (t.status === 'ready' && isWorkspaceTopic(t)) expect(GUIDE.some((a) => a.lab === L.id && a.topics.includes(t.id)), `${L.id}/${t.id}`).toBe(true)
  })
})

describe('Lab guide: links into the workspaces', () => {
  it('every `topics` entry is a READY workspace topic of the article’s lab', () => {
    for (const a of GUIDE) for (const t of a.topics) expect(targetProblems(a.lab, t), `${a.lab}/${a.id} → ${t}`).toEqual([])
  })
  it('every “Try it” opens a READY workspace topic with only keys and values that workspace accepts', () => {
    for (const a of GUIDE) for (const b of tries(a)) expect(targetProblems(b.lab, b.topic, b.query, b.mode), `${a.lab}/${a.id} → ${b.lab}/${b.topic} ${JSON.stringify(b.query ?? {})}`).toEqual([])
  })
  it('every example check runs at settings a workspace accepts (its defaults plus a valid query)', () => {
    for (const [k, list] of Object.entries(CHECKS)) for (const c of list) expect(targetProblems(c.sim.lab, c.sim.topic, c.sim.query), `${k}: ${JSON.stringify(c.sim)}`).toEqual([])
  })
  it('a “Try it” query changes what the workspace opens with (no key is silently ignored)', () => {
    for (const a of GUIDE)
      for (const b of tries(a)) {
        if (b.lab === 'rectifiers' || !b.query) continue
        const t = SHELL[b.lab][b.topic]
        expect(Object.keys(coerce(t.defaults as Record<string, unknown>, b.query)).sort(), `${a.id} → ${b.topic}`).toEqual(Object.keys(b.query).sort())
      }
  })
})

describe('Lab guide: worked examples confirmed by the simulation', () => {
  it('every example has its checks, and every check belongs to an example', () => {
    const keys = new Set<string>()
    for (const a of GUIDE) examples(a).forEach((_e, n) => keys.add(keyOf(a, n)))
    for (const k of keys) expect(CHECKS[k]?.length ?? 0, `${k}: no checks`).toBeGreaterThan(0)
    for (const k of Object.keys(CHECKS)) expect(keys.has(k), `${k}: no such example`).toBe(true)
  })
  for (const a of GUIDE)
    examples(a).forEach((ex, n) => {
      const k = keyOf(a, n)
      it(`${k}: ${ex.text}`, () => {
        for (const c of CHECKS[k] ?? []) {
          const { m, r } = run(c.sim)
          if ('fact' in c) {
            expect(c.is(m, r), `${k}: ${c.fact}`).toBe(true)
            continue
          }
          expect(`${ex.text} ${ex.result}`.includes(c.text), `${k}: “${c.text}” is not in the example`).toBe(true)
          const stated = c.expect !== undefined ? { value: c.expect, decimals: 2 } : numberIn(c.text)
          expect(stated, `${k}: “${c.text}” states no number`).not.toBeNull()
          const got = c.get(m, r)
          expect(Number.isFinite(got), `${k}: ${c.text} → ${got}`).toBe(true)
          const allowed = c.tol !== undefined ? c.tol * Math.abs(stated!.value) : 0.5 * 10 ** -stated!.decimals + 0.002 * Math.abs(stated!.value)
          expect(Math.abs(got - stated!.value), `${k}: “${c.text}” vs the simulation ${got}${c.why ? ` (${c.why})` : ''}`).toBeLessThanOrEqual(allowed + 1e-12)
        }
      })
    })
})

describe('Lab guide: WHY prompts are questions the WHY panel asks', () => {
  /** The questions the WHY panel shows at 120 instants of a run. */
  function questions(s: Sim): Set<string> {
    const out = new Set<string>()
    const { r, m } = run(s)
    if (s.lab === 'rectifiers') {
      const res = r as SimulationResult
      const ex = getExplainer(res.circuitId)
      for (let i = 0; i < 120; i++) {
        const k = Math.min(res.trace.length - 1, Math.floor((i / 119) * (res.trace.length - 1)))
        for (const q of rectifierWhyQuestions(res, ex.state(res, k))) out.add(q.question)
        if (res.params.control.freewheel) out.add(freewheelInsight(res, sampleAt(res, k)).whyTitle)
      }
    } else {
      const t = SHELL[s.lab][s.topic]
      const run_ = r as { length: number }
      for (let i = 0; i < 120; i++) {
        const k = Math.min(run_.length - 1, Math.floor((i / 119) * (run_.length - 1)))
        for (const c of t.why(r, t.state(r, k), m)) out.add(c.question)
      }
    }
    return out
  }
  for (const a of GUIDE)
    it(`${a.lab}/${a.id}`, () => {
      expect((a.whyPrompts ?? []).length, a.id).toBeGreaterThan(0)
      expect((a.whyPrompts ?? []).length, a.id).toBeLessThanOrEqual(3)
      // the runs the article opens: its topics at their defaults, every "Try it", every example
      const sims: Sim[] = [
        ...a.topics.map((t) => (a.lab === 'rectifiers' ? R(t, { load: 'R' }) : T(a.lab, t))),
        ...tries(a).map((b) => ({ lab: b.lab, topic: b.topic, query: b.query ?? {} })),
        ...examples(a).flatMap((_e, n) => (CHECKS[keyOf(a, n)] ?? []).map((c) => c.sim)),
      ]
      const asked = new Set<string>()
      for (const s of sims) for (const q of questions(s)) asked.add(q)
      for (const p of a.whyPrompts ?? []) expect(asked.has(p), `${a.lab}/${a.id}: “${p}” is never asked`).toBe(true)
    })
})

describe('Lab guide: plain data', () => {
  it('the guide’s files import nothing but each other (no engine, no physics)', () => {
    const dir = new URL('../src/guide/', import.meta.url)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      for (const mt of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) expect(mt[1], `${f} imports ${mt[1]}`).toMatch(/^\.\/[a-z0-9-]+\.ts$/i)
    }
  })
})
