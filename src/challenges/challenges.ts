import type { Comparison } from '../measurements/compare.ts'
import type { Measurements } from '../measurements/measurements.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import type { LabParams, LoadType, RectifierTopology, ResolvedParams } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatV, formatCapacitance } from '../utils/format.ts'

/** Parameters a challenge may unlock (everything else is fixed by the challenge). */
export type FieldKey = 'alpha' | 'vrms' | 'frequency' | 'resistance' | 'inductance' | 'capacitance' | 'vf' | 'ron' | 'phase' | 'diode' | 'cycles' | 'timestep'

export interface Criterion {
  label: string
  check(m: Measurements, p: ResolvedParams): boolean
  /** The measured value shown next to the criterion. */
  show(m: Measurements, p: ResolvedParams): string
}

export interface Challenge {
  id: string
  /** Section the challenge belongs to (defaults to single-phase). */
  section?: 'single' | 'three'
  title: string
  story: string
  topology: RectifierTopology
  load: LoadType
  params: LabParams
  editable: FieldKey[]
  goal: Criterion
  bonus: [Criterion, Criterion]
  hint: string
  /** A known 3-star design (used by the tests to prove the challenge is solvable; never shown). */
  solution: Partial<LabParams['load'] & LabParams['source'] & LabParams['diode'] & { alphaDeg: number }>
}

type P3 = { source?: Partial<LabParams['source']>; load?: Partial<LabParams['load']>; control?: Partial<NonNullable<LabParams['control']>>; cycles?: number }
const params3 = (o: P3): LabParams => ({
  ...THREE_PHASE_DEFAULTS,
  source: { ...THREE_PHASE_DEFAULTS.source, ...o.source },
  load: { ...THREE_PHASE_DEFAULTS.load, ...o.load },
  control: { ...THREE_PHASE_DEFAULTS.control!, ...o.control },
  sim: { ...THREE_PHASE_DEFAULTS.sim, cycles: o.cycles ?? 10 },
})

type P = { source?: Partial<LabParams['source']>; diode?: Partial<LabParams['diode']>; load?: Partial<LabParams['load']>; cycles?: number }
const params = (o: P): LabParams => ({
  source: { ...DEFAULT_PARAMS.source, ...o.source },
  diode: { ...DEFAULT_PARAMS.diode, ...o.diode },
  load: { ...DEFAULT_PARAMS.load, ...o.load },
  sim: { ...DEFAULT_PARAMS.sim, cycles: o.cycles ?? 10 },
})

/** Phase 10 — design tasks. Every check is evaluated on the simulation's steady-state measurements. */
export const CHALLENGES: Challenge[] = [
  {
    id: 'smooth-hw',
    title: 'Smooth it out',
    story: 'A 100 Ω load needs a half-wave supply with less than 1 V of ripple. Pick the filter capacitor — but capacitors cost money and big ones hammer the diode.',
    topology: 'half-wave',
    load: 'RC',
    params: params({ load: { resistance: 100, capacitance: 470e-6 } }),
    editable: ['capacitance'],
    goal: { label: 'Ripple ≤ 1.0 V p-p', check: (m) => m.ripplePP <= 1.0, show: (m) => formatSI(m.ripplePP, 'V') },
    bonus: [
      { label: 'C ≤ 3200 µF (don\'t oversize)', check: (_m, p) => p.capacitance <= 3200e-6, show: (_m, p) => formatCapacitance(p.capacitance) },
      { label: 'D1 peak current ≤ 5.6 A', check: (m) => m.idPeak <= 5.6, show: (m) => formatA(m.idPeak) },
    ],
    hint: 'ΔV ≈ Vpk/(f·R·C). Larger C → smaller ripple but taller, shorter charging pulses.',
    solution: { capacitance: 3000e-6 },
  },
  {
    id: 'bridge-rc',
    title: 'Full-wave pays off',
    story: 'Same job with a bridge: keep the ripple under 10 % of Vdc on a 47 Ω load. Two pulses per cycle should let you use a smaller capacitor.',
    topology: 'bridge',
    load: 'RC',
    params: params({ load: { resistance: 47, capacitance: 470e-6 } }),
    editable: ['capacitance'],
    goal: { label: 'Ripple ≤ 10 % of Vdc', check: (m) => m.ripplePP <= 0.1 * m.voutAvg, show: (m) => `${((m.ripplePP / Math.max(1e-12, m.voutAvg)) * 100).toFixed(1)} %` },
    bonus: [
      { label: 'C ≤ 2200 µF', check: (_m, p) => p.capacitance <= 2200e-6, show: (_m, p) => formatCapacitance(p.capacitance) },
      { label: 'D1 peak current ≤ 4.6 A', check: (m) => m.idPeak <= 4.6, show: (m) => formatA(m.idPeak) },
    ],
    hint: 'The ripple frequency is 2f now, so the capacitor only has to hold up for half as long.',
    solution: { capacitance: 1900e-6 },
  },
  {
    id: 'rl-beta',
    title: 'Stretch the current',
    story: 'Make the half-wave RL load conduct until at least 250° — without letting the average output drop below 3 V.',
    topology: 'half-wave',
    load: 'RL',
    params: params({ load: { resistance: 10, inductance: 0.02 }, cycles: 8 }),
    editable: ['inductance'],
    goal: { label: 'Extinction angle β ≥ 250°', check: (m) => (m.turnOffAngleDeg ?? 0) >= 250, show: (m) => (m.turnOffAngleDeg === null ? '—' : formatDeg(m.turnOffAngleDeg)) },
    bonus: [
      { label: 'Vdc ≥ 3.0 V', check: (m) => m.voutAvg >= 3.0, show: (m) => formatV(m.voutAvg, false) },
      { label: 'L ≤ 80 mH', check: (_m, p) => p.inductance <= 0.08, show: (_m, p) => formatSI(p.inductance, 'H') },
    ],
    hint: 'More L → later extinction, but a bigger negative area under Vout. There is a narrow window.',
    solution: { inductance: 0.078 },
  },
  {
    id: 'lc-continuous',
    title: 'Never let go',
    story: 'Keep the choke current of a bridge LC filter flowing all the time (continuous conduction) — with the smallest practical inductor.',
    topology: 'bridge',
    load: 'RLC',
    params: params({ load: { resistance: 20, capacitance: 1000e-6, inductance: 0.005 }, cycles: 14 }),
    editable: ['inductance'],
    goal: { label: 'Inductor current never reaches zero', check: (m) => (m.rectCurrentMin ?? 0) > 0, show: (m) => (m.rectCurrentMin === null ? '—' : formatA(m.rectCurrentMin)) + ' min' },
    bonus: [
      { label: 'L ≤ 30 mH', check: (_m, p) => p.inductance <= 0.03, show: (_m, p) => formatSI(p.inductance, 'H') },
      { label: 'Ripple ≤ 1.5 V p-p', check: (m) => m.ripplePP <= 1.5, show: (m) => formatSI(m.ripplePP, 'V') },
    ],
    hint: 'Critical inductance Lc ≈ R/(3ω). Start a little above it.',
    solution: { inductance: 0.028 },
  },
  {
    id: 'exact-12',
    title: 'Exactly 12 V',
    story: 'A center-tap supply with silicon diodes must deliver 12 V DC to a 50 Ω load. Choose the winding voltage — and mind the diode rating.',
    topology: 'center-tap',
    load: 'R',
    params: params({ source: { vrms: 10 }, load: { resistance: 50 }, cycles: 4 }),
    editable: ['vrms'],
    goal: { label: 'Vdc = 12 V ± 1 %', check: (m) => Math.abs(m.voutAvg - 12) <= 0.12, show: (m) => formatV(m.voutAvg, false) },
    bonus: [
      { label: 'Vdc = 12 V ± 0.25 %', check: (m) => Math.abs(m.voutAvg - 12) <= 0.03, show: (m) => formatV(m.voutAvg, false) },
      { label: 'PIV ≤ 39.3 V', check: (m) => m.piv <= 39.3, show: (m) => formatV(m.piv, false) },
    ],
    hint: 'Vdc ≈ 2Vm/π − Vf for full-wave with an R load; a center-tap diode must block about 2Vm.',
    solution: { vrms: 14.1 },
  },
  {
    id: 'protect-diode',
    title: 'Protect the diode',
    story: 'A big filter capacitor makes the charging current spike. Keep D1\'s peak current under 3 A on a 47 Ω half-wave supply. You may add series resistance (Ron) — at a cost in efficiency.',
    topology: 'half-wave',
    load: 'RC',
    params: params({ load: { resistance: 47, capacitance: 2200e-6 } }),
    editable: ['capacitance', 'ron'],
    goal: { label: 'D1 peak current ≤ 3.0 A', check: (m) => m.idPeak <= 3.0, show: (m) => formatA(m.idPeak) },
    bonus: [
      { label: 'Ripple ≤ 2.5 V p-p', check: (m) => m.ripplePP <= 2.5, show: (m) => formatSI(m.ripplePP, 'V') },
      { label: 'Efficiency ≥ 85 %', check: (m) => (m.efficiency ?? 0) >= 0.85, show: (m) => (m.efficiency === null ? '—' : `${(m.efficiency * 100).toFixed(1)} %`) },
    ],
    hint: 'A little series resistance flattens the charging spike; too much wastes power.',
    solution: { ron: 0.7, capacitance: 2200e-6 },
  },
  {
    id: '3ph-24v',
    section: 'three',
    title: '24 V from a six-pulse bridge',
    story: 'A 6-pulse diode bridge (silicon diodes) must supply 24 V DC to a 10 Ω load. Choose the phase voltage — and keep the diodes’ reverse stress low.',
    topology: '3ph-bridge',
    load: 'R',
    params: params3({ source: { vrms: 8 } }),
    editable: ['vrms'],
    goal: { label: 'Vdc = 24 V ± 1 %', check: (m) => Math.abs(m.voutAvg - 24) <= 0.24, show: (m) => formatV(m.voutAvg, false) },
    bonus: [
      { label: 'Vdc = 24 V ± 0.25 %', check: (m) => Math.abs(m.voutAvg - 24) <= 0.06, show: (m) => formatV(m.voutAvg, false) },
      { label: 'PIV ≤ 26 V', check: (m) => m.piv <= 26, show: (m) => formatV(m.piv, false) },
    ],
    hint: 'Vdc = 1.35·VLL − 2Vf with VLL = √3·Vph. The diodes block the peak line voltage.',
    solution: { vrms: 10.87 },
  },
  {
    id: '3ph-smooth',
    section: 'three',
    title: 'A smooth DC current',
    story: 'A DC motor fed by a 6-pulse bridge needs a nearly constant current: ripple at most 2.5 % of the average. Pick the smoothing inductance.',
    topology: '3ph-bridge',
    load: 'RL',
    params: params3({ load: { inductance: 0.005 } }),
    editable: ['inductance'],
    goal: { label: 'Current ripple ≤ 2.5 % of Idc', check: (m) => m.ioRipplePP <= 0.025 * m.ioAvg, show: (m) => `${((100 * m.ioRipplePP) / Math.max(1e-12, m.ioAvg)).toFixed(2)} %` },
    bonus: [
      { label: 'L ≤ 30 mH (cost)', check: (_m, p) => p.inductance <= 0.03, show: (_m, p) => formatSI(p.inductance, 'H') },
      { label: 'Current ripple ≤ 2.2 %', check: (m) => m.ioRipplePP <= 0.022 * m.ioAvg, show: (m) => `${((100 * m.ioRipplePP) / Math.max(1e-12, m.ioAvg)).toFixed(2)} %` },
    ],
    hint: 'The ripple is mostly at 6f; the inductor’s reactance there is 6ωL.',
    solution: { inductance: 0.029 },
  },
  {
    id: '3ph-alpha',
    section: 'three',
    title: 'Half power with α',
    story: 'An SCR bridge with a large inductive load must deliver HALF of the DC voltage it gives at α = 0°. Find the firing angle (mind the diode drops!).',
    topology: '3ph-bridge',
    load: 'RL',
    params: params3({ control: { device: 'scr', alphaDeg: 10 }, load: { inductance: 0.1 } }),
    editable: ['alpha'],
    goal: { label: 'Vdc = 50 % of the α = 0 value ± 2 %', check: (m) => Math.abs(m.voutAvg / 26.67 - 0.5) <= 0.01, show: (m) => `${((100 * m.voutAvg) / 26.67).toFixed(1)} %` },
    bonus: [
      { label: '± 0.5 %', check: (m) => Math.abs(m.voutAvg / 26.67 - 0.5) <= 0.0025, show: (m) => `${((100 * m.voutAvg) / 26.67).toFixed(2)} %` },
      { label: 'Current stays continuous', check: (m) => (m.rectCurrentMin ?? 0) > 0, show: (m) => formatA(m.rectCurrentMin ?? 0) + ' min' },
    ],
    hint: 'Vdc = 1.35·VLL·cos α − 2Vf: the 2Vf part does not scale with cos α, so the answer is not exactly 60°.',
    solution: { alphaDeg: 58.3 },
  },
]

export interface ChallengeResult {
  /** False until the run has settled — a transient could pass or fail by accident. */
  steady: boolean
  criteria: Array<{ label: string; pass: boolean; value: string; kind: 'goal' | 'bonus' }>
  stars: number
}

export function evaluateChallenge(ch: Challenge, comparison: Comparison, p: ResolvedParams): ChallengeResult {
  const m = comparison.measurements
  const crit = [
    { c: ch.goal, kind: 'goal' as const },
    ...ch.bonus.map((c) => ({ c, kind: 'bonus' as const })),
  ].map(({ c, kind }) => ({ label: c.label, pass: c.check(m, p), value: c.show(m, p), kind }))
  const goal = crit[0].pass
  const stars = !m.steady.reached || !goal ? 0 : 1 + crit.slice(1).filter((x) => x.pass).length
  return { steady: m.steady.reached, criteria: crit, stars }
}

/** Apply a solution/override to a challenge's base parameters. */
export function withOverrides(base: LabParams, o: Challenge['solution']): LabParams {
  return {
    ...base,
    source: { ...base.source, ...(o.vrms !== undefined ? { vrms: o.vrms } : {}), ...(o.frequency !== undefined ? { frequency: o.frequency } : {}) },
    diode: { ...base.diode, ...(o.ron !== undefined ? { ron: o.ron } : {}), ...(o.vf !== undefined ? { vf: o.vf } : {}) },
    control: o.alphaDeg !== undefined && base.control ? { ...base.control, alphaDeg: o.alphaDeg } : base.control,
    load: { ...base.load, ...(o.resistance !== undefined ? { resistance: o.resistance } : {}), ...(o.inductance !== undefined ? { inductance: o.inductance } : {}), ...(o.capacitance !== undefined ? { capacitance: o.capacitance } : {}) },
  }
}
