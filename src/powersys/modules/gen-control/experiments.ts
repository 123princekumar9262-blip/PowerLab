import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { AVR0, errSteady, routh, simulateAvr, type AvrParams, type AvrRun, type Routh } from './avr.ts'
import { AREA0, beta, LFC0, simulateLfc, steadyState, tieDynamics, type LfcParams, type LfcRun, type LfcSteady, type TieDynamics } from './lfc.ts'

/**
 * Predict-first experiments: change one thing, then compare two simulations. The correct option is decided from the
 * computed results (never written in advance), and every number in an explanation is read from them.
 *
 * Final (steady-state) values are always the closed forms (steadyState); a simulated end value is shown beside them
 * only when the run has settled. Transient measures (first peak, overshoot, period, rise and settling times) come
 * from tieDynamics and do not depend on the length of the run.
 */

/** Every LFC experiment runs this long — long enough for all of them to settle (checked by a test). */
export const LFC_T_END = 60
/** The AVR experiment runs this long (K_A = 11.5 settles within 2 % only after about 65 s). */
export const AVR_T_END = 90

export interface LfcCase {
  kind: 'lfc'
  p: LfcParams
  run: LfcRun
  ss: LfcSteady
  td: TieDynamics
}
export interface AvrCase {
  kind: 'avr'
  p: AvrParams
  run: AvrRun
  routh: Routh
}
export type Case = LfcCase | AvrCase
export interface ExpResult {
  b: Case
  a: Case
}

export interface Row {
  label: string
  unit: string
  decimals: number
  get(c: Case): number
  /** what to show when the value does not exist (NaN), e.g. "none — rises monotonically" */
  none?: string
}

export interface Experiment {
  id: string
  kind: 'lfc' | 'avr'
  title: string
  /** what changes, in one sentence */
  change: string
  question: string
  options: Choice[]
  names: [string, string]
  /** simulated time [s] */
  tEnd: number
  /** the time window drawn on the comparison plots [s] */
  plotEnd: number
  before(): Case
  after(): Case
  answer(r: ExpResult): string
  explain(r: ExpResult): string[]
  rows: Row[]
}

export const lfcCase = (p: LfcParams, tEnd = LFC_T_END): LfcCase => {
  const run = simulateLfc(p, { tEnd, keepEvery: 5 })
  const ss = steadyState(p)
  return { kind: 'lfc', p, run, ss, td: tieDynamics(run, ss.tie) }
}
export const avrCase = (p: AvrParams, tEnd = AVR_T_END): AvrCase => ({ kind: 'avr', p, run: simulateAvr(p, { tEnd, keepEvery: 5 }), routh: routh(p) })

const L = (c: Case): LfcCase => {
  if (c.kind !== 'lfc') throw new Error('not an LFC case')
  return c
}
const A = (c: Case): AvrCase => {
  if (c.kind !== 'avr') throw new Error('not an AVR case')
  return c
}

const MW = (pu: number, p: LfcParams, d = 0) => `${fx(pu * p.sBase, d)} MW`
/** The simulated end value beside the closed form — only when the run has settled. */
const simEnd = (c: LfcCase, v: number, d = 4) => (c.run.settled ? ` (simulated at ${fx(c.run.tEnd, 0)} s: ${fx(v, d)})` : ` (the run has not settled after ${fx(c.run.tEnd, 0)} s)`)

const LR = {
  nadir1: { label: 'Area 1 frequency nadir (simulated)', unit: 'Hz', decimals: 3, get: (c: Case) => L(c).run.nadir1 },
  df1: { label: 'Final Δf₁ (closed form)', unit: 'Hz', decimals: 4, get: (c: Case) => L(c).ss.df1 * L(c).p.f0 },
  df2: { label: 'Final Δf₂ (closed form)', unit: 'Hz', decimals: 4, get: (c: Case) => L(c).ss.df2 * L(c).p.f0 },
  tie: { label: 'Final ΔP_tie12 (closed form)', unit: 'pu', decimals: 4, get: (c: Case) => L(c).ss.tie },
  tieSim: {
    label: `ΔP_tie12 simulated at ${LFC_T_END} s`,
    unit: 'pu',
    decimals: 4,
    get: (c: Case) => (L(c).run.settled ? L(c).run.end.tie : NaN),
    none: 'not settled',
  },
  pm1: { label: 'Final ΔP_m1 (closed form)', unit: 'pu', decimals: 4, get: (c: Case) => L(c).ss.pm1 },
  pm2: { label: 'Final ΔP_m2 (closed form)', unit: 'pu', decimals: 4, get: (c: Case) => L(c).ss.pm2 },
  t90: { label: 'Tie flow reaches 90 % of final', unit: 's', decimals: 2, get: (c: Case) => L(c).td.t90 },
  tPeak: { label: 'First tie-flow peak at', unit: 's', decimals: 2, get: (c: Case) => L(c).td.firstPeak?.t ?? NaN, none: 'none — rises monotonically' },
  over: { label: 'Tie-flow overshoot', unit: '%', decimals: 1, get: (c: Case) => L(c).td.overshootPct },
  period: { label: 'Swing period (successive peaks)', unit: 's', decimals: 2, get: (c: Case) => L(c).td.period, none: 'no swing' },
  tSettle: { label: 'Tie flow within 2 % of final after', unit: 's', decimals: 1, get: (c: Case) => L(c).td.tSettle, none: 'not within the run' },
}
const AR = {
  ess: { label: 'Steady-state error e_ss', unit: 'pu', decimals: 4, get: (c: Case) => errSteady(A(c).p) },
  over: { label: 'Overshoot', unit: '%', decimals: 1, get: (c: Case) => A(c).run.overshootPct },
  settle: { label: '2 % settling time', unit: 's', decimals: 1, get: (c: Case) => A(c).run.tSettle, none: `not within ${AVR_T_END} s` },
  margin: { label: 'Routh limit K_A,max − K_A', unit: '', decimals: 2, get: (c: Case) => A(c).routh.kaMax - A(c).p.KA },
}

const BIG2: LfcParams = { ...LFC0, a2: { ...AREA0, H: 10, D: 2, R: 0.025 } }

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'tie-direction',
    kind: 'lfc',
    title: 'Which way does the tie line carry power?',
    change: `Area 1’s load rises by ${LFC0.dPL1} pu (${fx(LFC0.dPL1 * LFC0.sBase, 0)} MW) at t = 0. Compare the two areas islanded (no tie line) with the two connected.`,
    question: 'Once the two areas are connected, which way does the tie-line power change?',
    options: [
      { id: 'a2to1', label: 'More power flows from area 2 into area 1' },
      { id: 'a1to2', label: 'More power flows from area 1 into area 2' },
      { id: 'none', label: 'No change: each area covers its own load' },
    ],
    names: ['Islanded', 'Connected'],
    tEnd: LFC_T_END,
    plotEnd: 20,
    before: () => lfcCase({ ...LFC0, T12: 0 }),
    after: () => lfcCase(LFC0),
    answer: ({ a }) => (Math.abs(L(a).ss.tie) < 1e-9 ? 'none' : L(a).ss.tie < 0 ? 'a2to1' : 'a1to2'),
    explain: ({ b, a }) => {
      const B = L(b)
      const C = L(a)
      return [
        `ΔP_tie12 settles at ${fx(C.ss.tie, 4)} pu${simEnd(C, C.run.end.tie)}: negative, so the change is a flow from area 2 into area 1 (${MW(-C.ss.tie, C.p)}).`,
        `Area 1’s machines slow first. As its rotors fall behind area 2’s, the angle across the tie line grows and area 2 pushes power through it — and area 2’s governors raise their output (+${fx(C.ss.pm2, 4)} pu) because area 2’s frequency falls too.`,
        `Islanded, area 1 alone settles at ${fx(B.ss.df1 * B.p.f0, 4)} Hz; connected, both settle at ${fx(C.ss.df1 * C.p.f0, 4)} Hz — the deviation is shared.`,
      ]
    },
    rows: [LR.nadir1, LR.df1, LR.df2, LR.tie, LR.tieSim, LR.pm1, LR.pm2],
  },
  {
    id: 'agc',
    kind: 'lfc',
    title: 'Switch on AGC',
    change: 'The same load step in area 1. First the governors alone (primary control); then with AGC (integral control of each area’s ACE) in both areas.',
    question: 'With AGC on, where does the frequency end up?',
    options: [
      { id: 'zero', label: 'Back at exactly 50 Hz (Δf → 0)' },
      { id: 'smaller', label: 'Closer to 50 Hz, but with a smaller offset left' },
      { id: 'same', label: 'The same offset; AGC only makes it faster' },
    ],
    names: ['Governors only', 'With AGC'],
    tEnd: LFC_T_END,
    plotEnd: LFC_T_END,
    before: () => lfcCase(LFC0),
    after: () => lfcCase({ ...LFC0, agc1: true, agc2: true }),
    answer: ({ b, a }) => {
      const fb = Math.abs(L(b).ss.df1)
      const fa = Math.abs(L(a).ss.df1)
      return fa < 0.02 * fb ? 'zero' : fa < 0.9 * fb ? 'smaller' : 'same'
    },
    explain: ({ b, a }) => {
      const B = L(b)
      const C = L(a)
      return [
        `Governors alone leave Δf = ${fx(B.ss.df1 * B.p.f0, 4)} Hz${simEnd(B, B.run.end.df1)}: droop needs a frequency error to hold the extra output (ΔP_m = −Δf/R).`,
        `AGC integrates the area control error ACE = ΔP_tie + B·Δf and keeps moving the set points until ACE = 0 in both areas, which forces Δf = 0 and ΔP_tie12 = 0. The simulation is at Δf = ${fx(C.run.end.df1, 4)} Hz and ΔP_tie12 = ${fx(C.run.end.tie, 4)} pu after ${fx(C.run.tEnd, 0)} s${C.run.settled ? '' : ' and still moving'}.`,
        `Area 1 then supplies its own load step: final ΔP_m1 = ${fx(C.ss.pm1, 4)} pu, ΔP_m2 = ${fx(C.ss.pm2, 4)} pu.`,
      ]
    },
    rows: [LR.nadir1, LR.df1, LR.tie, LR.pm1, LR.pm2],
  },
  {
    id: 'unequal',
    kind: 'lfc',
    title: 'A bigger neighbour',
    change: `Area 2 becomes twice as large as area 1: twice the inertia, load damping and governor response (H₂ = 10 s, D₂ = 2, R₂ = 0.025, so β₂ = ${fx(beta(BIG2.a2), 0)} against β₁ = ${fx(beta(BIG2.a1), 0)}). The same load step in area 1, governors only.`,
    question: 'In the steady state, who supplies most of area 1’s extra load?',
    options: [
      { id: 'a1', label: 'Area 1 — it is its own load' },
      { id: 'half', label: 'Still half each' },
      { id: 'a2', label: 'Area 2, about two-thirds of it' },
    ],
    names: ['Equal areas', 'Area 2 twice as large'],
    tEnd: LFC_T_END,
    plotEnd: 20,
    before: () => lfcCase(LFC0),
    after: () => lfcCase(BIG2),
    answer: ({ a }) => {
      const C = L(a)
      const share2 = -C.ss.tie / C.p.dPL1
      return share2 > 0.55 ? 'a2' : share2 > 0.45 ? 'half' : 'a1'
    },
    explain: ({ b, a }) => {
      const B = L(b)
      const C = L(a)
      const b1 = beta(C.p.a1)
      const b2 = beta(C.p.a2)
      return [
        `Without AGC the load step is shared in proportion to β: area 2 sends β₂/(β₁ + β₂) = ${fx(b2, 0)}/${fx(b1 + b2, 0)} = ${fx(b2 / (b1 + b2), 3)} of it through the tie line — ΔP_tie12 = ${fx(C.ss.tie, 4)} pu${simEnd(C, C.run.end.tie)} (equal areas: ${fx(B.ss.tie, 4)} pu).`,
        `The common frequency deviation is smaller too: Δf = −ΔP_L/(β₁ + β₂) = ${fx(C.ss.df1 * C.p.f0, 4)} Hz against ${fx(B.ss.df1 * B.p.f0, 4)} Hz with equal areas. A bigger, stiffer interconnection holds the frequency better — one reason grids interconnect.`,
      ]
    },
    rows: [LR.df1, LR.tie, LR.tieSim, LR.pm1, LR.pm2],
  },
  {
    id: 'stiff',
    kind: 'lfc',
    title: 'A stiffer tie line',
    change: `The synchronising coefficient of the tie line rises from T₁₂ = 0.01 to 0.08 pu/rad (a shorter or stronger line, or more circuits). Same load step in area 1, governors only; each run lasts ${LFC_T_END} s.`,
    question: 'What happens to the tie-line flow in the first seconds?',
    options: [
      { id: 'faster', label: 'It builds up faster and swings back and forth more' },
      { id: 'slower', label: 'It builds up more slowly and smoothly' },
      { id: 'bigger', label: 'Its final value becomes much larger' },
    ],
    names: ['T₁₂ = 0.01', 'T₁₂ = 0.08'],
    tEnd: LFC_T_END,
    plotEnd: 20,
    before: () => lfcCase({ ...LFC0, T12: 0.01 }),
    after: () => lfcCase({ ...LFC0, T12: 0.08 }),
    answer: ({ b, a }) => {
      const B = L(b)
      const C = L(a)
      if (Math.abs(C.ss.tie) > 1.05 * Math.abs(B.ss.tie)) return 'bigger'
      const swingsMore = C.td.overshootPct > B.td.overshootPct
      return C.td.t90 < B.td.t90 && swingsMore ? 'faster' : 'slower'
    },
    explain: ({ b, a }) => {
      const B = L(b)
      const C = L(a)
      const peak = (c: LfcCase) =>
        c.td.firstPeak
          ? `first peaks at ${fx(c.td.firstPeak.t, 2)} s (${fx(c.td.firstPeak.v, 4)} pu, ${fx(c.td.overshootPct, 1)} % beyond the final value)${Number.isFinite(c.td.period) ? ` and swings with a period of ${fx(c.td.period, 2)} s` : ''}`
          : 'has no peak at all — it rises monotonically, without overshoot'
      const settle = (c: LfcCase) => (Number.isFinite(c.td.tSettle) ? `${fx(c.td.tSettle, 1)} s` : `more than ${fx(c.run.tEnd, 0)} s`)
      return [
        `With T₁₂ = 0.08 the tie flow reaches 90 % of its final value after ${fx(C.td.t90, 2)} s (against ${fx(B.td.t90, 2)} s) and ${peak(C)}. With T₁₂ = 0.01 it ${peak(B)}.`,
        `A stiffer tie turns a small angle difference into a large power: the two areas are pulled together harder, so they swing against each other faster — an inter-area oscillation. It stays within 2 % of the final value only after ${settle(C)} (T₁₂ = 0.01: ${settle(B)}).`,
        `The final value does not change: ΔP_tie12 = −β₂·ΔP_L1/(β₁ + β₂) = ${fx(C.ss.tie, 4)} pu in both cases${B.run.settled && C.run.settled ? ` (simulated at ${fx(C.run.tEnd, 0)} s: ${fx(B.run.end.tie, 4)} and ${fx(C.run.end.tie, 4)} pu)` : ''}. In the steady state the frequencies are equal and only β₁ and β₂ decide the sharing.`,
      ]
    },
    rows: [LR.t90, LR.tPeak, LR.over, LR.period, LR.tSettle, LR.tie, LR.tieSim],
  },
  {
    id: 'ka',
    kind: 'avr',
    title: 'Turn up the AVR gain',
    change: `The amplifier gain K_A rises from 5 to 11.5 (the Routh limit for this loop is ${fx(routh(AVR0).kaMax, 2)}). A 1 pu step in the voltage reference — read the response as a fraction of the step.`,
    question: 'What does the higher gain do to the terminal-voltage response?',
    options: [
      { id: 'better', label: 'Smaller error and a better-damped response' },
      { id: 'tradeoff', label: 'Smaller error, but bigger, longer-lasting oscillations' },
      { id: 'worse', label: 'A larger steady-state error' },
    ],
    names: ['K_A = 5', 'K_A = 11.5'],
    tEnd: AVR_T_END,
    plotEnd: 20,
    before: () => avrCase({ ...AVR0, KA: 5 }),
    after: () => avrCase({ ...AVR0, KA: 11.5 }),
    answer: ({ b, a }) => {
      const B = A(b)
      const C = A(a)
      if (errSteady(C.p) >= errSteady(B.p)) return 'worse'
      return C.run.overshootPct > B.run.overshootPct ? 'tradeoff' : 'better'
    },
    explain: ({ b, a }) => {
      const B = A(b)
      const C = A(a)
      return [
        `The error falls from 1/(1 + 5) = ${fx(errSteady(B.p), 4)} to 1/(1 + 11.5) = ${fx(errSteady(C.p), 4)} pu: more gain, less error.`,
        `But the overshoot rises from ${fx(B.run.overshootPct, 1)} % to ${fx(C.run.overshootPct, 1)} %, and the response ${Number.isFinite(C.run.tSettle) ? `takes ${fx(C.run.tSettle, 1)} s to settle within 2 % (against ${Number.isFinite(B.run.tSettle) ? `${fx(B.run.tSettle, 1)} s` : `more than ${fx(B.run.tEnd, 0)} s`})` : `has not settled within 2 % after ${fx(C.run.tEnd, 0)} s`}. At K_A = ${fx(C.routh.kaMax, 2)} the closed loop would oscillate for ever; above it the oscillation grows.`,
        'This is the classic trade-off a stabilising (rate) feedback or a lead compensator is added to resolve.',
      ]
    },
    rows: [AR.ess, AR.over, AR.settle, AR.margin],
  },
]

export function runExperiment(e: Experiment): ExpResult {
  return { b: e.before(), a: e.after() }
}
