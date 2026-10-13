import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { FREQ0, simulateFrequency, steadyStateHz, type FreqParams, type FreqRun } from './frequency.ts'
import { deg, SMIB0, simulateSwing, summarise, type SmibParams, type SmibSummary, type SwingRun } from './swing.ts'

/**
 * Predict-first experiments: change one thing, then compare two simulations. The correct option is decided from the
 * two results (never written in advance), and every number in an explanation is read from them.
 */

export interface SwingCase {
  p: SmibParams
  s: SmibSummary
  run: SwingRun
}
export interface FreqCase {
  p: FreqParams
  run: FreqRun
}

interface Row<C> {
  label: string
  unit: string
  decimals: number
  get(c: C): number
}

interface Base<C> {
  id: string
  title: string
  /** what changes, in one sentence */
  change: string
  question: string
  options: Choice[]
  before: () => C
  after: () => C
  /** the names of the two cases in charts and the table */
  names: [string, string]
  answer(b: C, a: C): string
  rows: Array<Row<C>>
  explain(b: C, a: C): string[]
}
export type SwingExperiment = Base<SwingCase> & { kind: 'swing' }
export type FreqExperiment = Base<FreqCase> & { kind: 'freq'; tEnd: number }
export type Experiment = SwingExperiment | FreqExperiment

export const SWING_T_END = 2.5
export const swingCase = (p: SmibParams): SwingCase => {
  const s = summarise(p)
  return { p, s, run: simulateSwing(p, { kind: 'fault' }, { tEnd: SWING_T_END, keepEvery: 5, dStop: 2 * Math.PI }) }
}
export const freqCase = (p: FreqParams, tEnd: number): FreqCase => ({ p, run: simulateFrequency(p, { tEnd, keepEvery: 5 }) })

const tcrOf = (c: SwingCase) => (Number.isFinite(c.s.tcrSim) ? c.s.tcrSim : NaN)
const outcome = (r: SwingRun) => (r.stable ? 'stays in step' : 'loses synchronism')

const SW = {
  d0: { label: 'Operating angle δ₀', unit: '°', decimals: 1, get: (c: SwingCase) => deg(c.s.d0) },
  P1: { label: 'P_max before the fault', unit: 'pu', decimals: 3, get: (c: SwingCase) => c.s.lim.P1 },
  P3: { label: 'P_max after clearing', unit: 'pu', decimals: 3, get: (c: SwingCase) => c.s.lim.P3 },
  dcr: { label: 'Critical clearing angle δ_cr', unit: '°', decimals: 1, get: (c: SwingCase) => deg(c.s.dcr) },
  tcr: { label: 'Critical clearing time t_cr', unit: 'ms', decimals: 0, get: (c: SwingCase) => tcrOf(c) * 1000 },
  tc: { label: 'Clearing time t_c', unit: 'ms', decimals: 0, get: (c: SwingCase) => c.p.tc * 1000 },
  dc: { label: 'Angle at clearing δ_c', unit: '°', decimals: 1, get: (c: SwingCase) => deg(c.run.dc) },
  peak: { label: 'Largest angle reached (first swing)', unit: '°', decimals: 1, get: (c: SwingCase) => (c.run.stable ? deg(c.run.dPeak) : NaN) },
  margin: { label: 'Margin t_cr − t_c', unit: 'ms', decimals: 0, get: (c: SwingCase) => (tcrOf(c) - c.p.tc) * 1000 },
}

const FR = {
  rocof: { label: 'Initial RoCoF', unit: 'Hz/s', decimals: 3, get: (c: FreqCase) => c.run.rocofSim },
  nadir: { label: 'Frequency nadir Δf_min', unit: 'Hz', decimals: 3, get: (c: FreqCase) => c.run.nadir },
  tNadir: { label: 'Time of the nadir', unit: 's', decimals: 2, get: (c: FreqCase) => c.run.tNadir },
  end: { label: 'Δf at the end of the run', unit: 'Hz', decimals: 3, get: (c: FreqCase) => c.run.end },
  pm: { label: 'Extra generation ΔP_m at the end', unit: 'pu', decimals: 3, get: (c: FreqCase) => c.run.dPm[c.run.dPm.length - 1] },
}

const tcrBase = summarise(SMIB0).tcrSim

export const EXPERIMENTS: Experiment[] = [
  {
    kind: 'freq',
    id: 'inertia',
    title: 'Less inertia: inverter-based generation',
    change:
      'Wind and solar plants (connected through inverters, with no spinning mass) replace part of the synchronous fleet: the system inertia falls from H = 5 s to H = 2 s. The same 0.1 pu load step.',
    question: 'What happens to the frequency after the load step?',
    options: [
      { id: 'a', label: 'It falls faster and dips deeper, but settles at the same value' },
      { id: 'b', label: 'It falls faster and settles lower' },
      { id: 'c', label: 'No change — the governors decide everything' },
    ],
    tEnd: 10,
    before: () => freqCase(FREQ0, 10),
    after: () => freqCase({ ...FREQ0, H: 2 }, 10),
    names: ['H = 5 s', 'H = 2 s'],
    answer: (b, a) => {
      const faster = Math.abs(a.run.rocofSim) > 1.05 * Math.abs(b.run.rocofSim)
      const deeper = a.run.nadir < b.run.nadir - 0.005
      const sameSs = Math.abs(steadyStateHz(a.p) - steadyStateHz(b.p)) < 1e-9
      return faster && deeper && sameSs ? 'a' : faster && !sameSs ? 'b' : 'c'
    },
    rows: [FR.rocof, FR.nadir, FR.tNadir, FR.end],
    explain: (b, a) => [
      `In the first instant only the stored kinetic energy can cover the missing power, so RoCoF(0) = −ΔP_L·f₀/(2H): ${fx(b.run.rocofSim, 2)} Hz/s with H = ${b.p.H} s, ${fx(a.run.rocofSim, 2)} Hz/s with H = ${a.p.H} s — ${fx(a.run.rocofSim / b.run.rocofSim, 1)} times faster.`,
      `The governors need time (T_g = ${a.p.Tg} s, T_t = ${a.p.Tt} s) to open the valves, so a faster fall reaches further before they catch it: the nadir goes from ${fx(b.run.nadir, 3)} Hz to ${fx(a.run.nadir, 3)} Hz, and it comes sooner (${fx(b.run.tNadir, 2)} s → ${fx(a.run.tNadir, 2)} s).`,
      `The settling value Δf_ss = −ΔP_L/(D + 1/R) = ${fx(steadyStateHz(a.p), 3)} Hz does not contain H at all: inertia decides how fast and how deep, droop decides where it settles. This is why operators of low-inertia grids buy fast frequency response and synthetic inertia from inverters.`,
    ],
  },
  {
    kind: 'freq',
    id: 'droop',
    title: 'Droop 4 % or 8 %',
    change: 'The governors’ droop is changed from R = 4 % to R = 8 %: a 4 % frequency drop now opens the valves only half as far.',
    question: 'How does the frequency deviation that primary control leaves behind change?',
    options: [
      { id: 'half', label: 'It roughly halves' },
      { id: 'double', label: 'It roughly doubles' },
      { id: 'same', label: 'It stays the same' },
    ],
    tEnd: 20,
    before: () => freqCase({ ...FREQ0, R: 0.04 }, 20),
    after: () => freqCase({ ...FREQ0, R: 0.08 }, 20),
    names: ['R = 4 %', 'R = 8 %'],
    answer: (b, a) => {
      const ratio = a.run.end / b.run.end
      return ratio > 1.5 ? 'double' : ratio < 0.67 ? 'half' : 'same'
    },
    rows: [FR.nadir, FR.end, FR.pm],
    explain: (b, a) => [
      `In steady state the generators’ extra output ΔP_m = −Δf/R and the load’s own relief D·Δf together cover the step: Δf_ss = −ΔP_L/(D + 1/R) = −${a.p.dPL}/(${a.p.D} + ${fx(1 / b.p.R, 1)}) = ${fx(steadyStateHz(b.p), 3)} Hz with 4 %, and −${a.p.dPL}/(${a.p.D} + ${fx(1 / a.p.R, 1)}) = ${fx(steadyStateHz(a.p), 3)} Hz with 8 %.`,
      `The simulation settles at ${fx(b.run.end, 3)} Hz and ${fx(a.run.end, 3)} Hz: × ${fx(a.run.end / b.run.end, 2)}, not quite × 2 because the load’s relief D = ${a.p.D} adds to 1/R. The nadir deepens too (${fx(b.run.nadir, 3)} → ${fx(a.run.nadir, 3)} Hz).`,
      'A stiffer droop holds the frequency closer but makes each generator respond harder; in a real grid all units share the same droop so that they share a load change in proportion to their ratings.',
    ],
  },
  {
    kind: 'freq',
    id: 'agc',
    title: 'Switch on secondary control (AGC)',
    change:
      'Automatic generation control adds an integral term: it keeps raising the generators’ set-points while the frequency is below 50 Hz (K_I = 0.1 s⁻¹ — faster than a real AGC, so the whole response fits in 40 s).',
    question: 'Where is the frequency 40 s after the load step?',
    options: [
      { id: 'back', label: 'Back at 50 Hz' },
      { id: 'droop', label: 'Where primary control left it, below 50 Hz' },
      { id: 'lower', label: 'Lower still — the AGC adds load' },
    ],
    tEnd: 40,
    before: () => freqCase(FREQ0, 40),
    after: () => freqCase({ ...FREQ0, agc: true }, 40),
    names: ['Primary only', 'With AGC'],
    answer: (_, a) => (Math.abs(a.run.end) < 0.01 ? 'back' : a.run.end < -0.2 ? 'droop' : 'lower'),
    rows: [FR.nadir, FR.end, FR.pm],
    explain: (b, a) => [
      `Primary control alone leaves Δf = ${fx(b.run.end, 3)} Hz: droop needs a frequency error to produce extra power. With AGC the integral of the error keeps moving the set-points until the error is gone: Δf = ${fx(a.run.end, 4)} Hz after 40 s${Number.isFinite(a.run.tRecover) ? ` (back within 5 % of the dip after ${fx(a.run.tRecover, 1)} s)` : ''}.`,
      `The generators end up supplying the whole ${a.p.dPL} pu step (ΔP_m = ${fx(a.run.dPm[a.run.dPm.length - 1], 3)} pu), instead of ${fx(b.run.dPm[b.run.dPm.length - 1], 3)} pu with the load’s relief covering the rest.`,
      `AGC is too slow to change the nadir much (${fx(b.run.nadir, 3)} → ${fx(a.run.nadir, 3)} Hz): the first seconds belong to inertia and primary control.`,
    ],
  },
  {
    kind: 'swing',
    id: 'tcr',
    title: 'Clear just before or just after t_cr',
    change: `A three-phase fault at the HV bus. The protection clears it at 0.95 × t_cr (${fx(tcrBase * 950, 0)} ms) — and then, in a second run, at 1.05 × t_cr (${fx(tcrBase * 1050, 0)} ms).`,
    question: 'The first run is stable. What happens in the second, just 10 % later?',
    options: [
      { id: 'stable', label: 'Still stable — only a slightly larger swing' },
      { id: 'lost', label: 'The generator loses synchronism' },
      { id: 'slow', label: 'It stays in step but takes longer to settle' },
    ],
    before: () => swingCase({ ...SMIB0, tc: 0.95 * tcrBase }),
    after: () => swingCase({ ...SMIB0, tc: 1.05 * tcrBase }),
    names: ['0.95 × t_cr', '1.05 × t_cr'],
    answer: (_, a) => (a.run.stable ? 'stable' : 'lost'),
    rows: [SW.tc, SW.dc, SW.dcr, SW.peak],
    explain: (b, a) => [
      `Cleared at ${fx(b.p.tc * 1000, 0)} ms the rotor has reached δ_c = ${fx(deg(b.run.dc), 1)}°, below δ_cr = ${fx(deg(b.s.dcr), 1)}°: the decelerating area available up to δ_max = ${fx(deg(b.s.dMax), 1)}° exceeds the accelerating area, the rotor stops at ${fx(deg(b.run.dPeak), 1)}° and swings back — it ${outcome(b.run)}.`,
      `Cleared at ${fx(a.p.tc * 1000, 0)} ms it has reached ${fx(deg(a.run.dc), 1)}°, past δ_cr: A₂ can no longer cancel A₁, the rotor passes δ_max still faster than synchronous speed and ${outcome(a.run)}${Number.isFinite(a.run.tLost) ? ` (it passes δ_max at t = ${fx(a.run.tLost, 2)} s)` : ''}. Protection would then trip the unit.`,
      'Stability is not gradual near t_cr: a few milliseconds decide between a swing that dies away and a pole slip. That is why transmission protection is built to clear faults in 80–120 ms.',
    ],
  },
  {
    kind: 'swing',
    id: 'loading',
    title: 'A heavier pre-fault loading',
    change: 'The generator is loaded to P_m = 1.0 pu instead of 0.8 pu before the same fault at the HV bus.',
    question: 'What happens to the critical clearing time?',
    options: [
      { id: 'shorter', label: 'It gets shorter' },
      { id: 'longer', label: 'It gets longer' },
      { id: 'same', label: 'It does not change — it depends only on the network' },
    ],
    before: () => swingCase(SMIB0),
    after: () => swingCase({ ...SMIB0, Pm: 1.0 }),
    names: ['P_m = 0.8 pu', 'P_m = 1.0 pu'],
    answer: (b, a) => {
      const d = tcrOf(a) - tcrOf(b)
      return d < -0.002 ? 'shorter' : d > 0.002 ? 'longer' : 'same'
    },
    rows: [SW.d0, SW.dcr, SW.tcr, SW.margin],
    explain: (b, a) => [
      `More power means a larger operating angle (δ₀ = ${fx(deg(b.s.d0), 1)}° → ${fx(deg(a.s.d0), 1)}°) and, after clearing, a smaller δ_max (${fx(deg(b.s.dMax), 1)}° → ${fx(deg(a.s.dMax), 1)}°): the decelerating area shrinks from both sides.`,
      `During a fault at the bus the whole of P_m accelerates the rotor, so it also gains angle faster. Together: t_cr falls from ${fx(tcrOf(b) * 1000, 0)} ms to ${fx(tcrOf(a) * 1000, 0)} ms, and a ${fx(b.p.tc * 1000, 0)} ms clearing time ${tcrOf(a) > a.p.tc ? `keeps only ${fx((tcrOf(a) - a.p.tc) * 1000, 0)} ms of margin` : `is now ${fx((a.p.tc - tcrOf(a)) * 1000, 0)} ms too slow — the generator would lose synchronism`} (the margin was ${fx((tcrOf(b) - b.p.tc) * 1000, 0)} ms).`,
      'Stability limits — not only thermal ratings — cap how much power a line may carry: operators run below the transfer at which the worst credible fault would be critical.',
    ],
  },
  {
    kind: 'swing',
    id: 'network',
    title: 'A stronger network',
    change: 'The two lines are rebuilt with a lower reactance: X_L = 0.4 pu each instead of 0.6 pu (for example bundled conductors or series compensation). Same fault at the HV bus.',
    question: 'What happens to the critical clearing time?',
    options: [
      { id: 'longer', label: 'It gets longer' },
      { id: 'shorter', label: 'It gets shorter' },
      { id: 'same', label: 'It does not change — the fault short-circuits the generator anyway' },
    ],
    before: () => swingCase(SMIB0),
    after: () => swingCase({ ...SMIB0, Xl: 0.4 }),
    names: ['X_L = 0.6 pu', 'X_L = 0.4 pu'],
    answer: (b, a) => {
      const d = tcrOf(a) - tcrOf(b)
      return d > 0.002 ? 'longer' : d < -0.002 ? 'shorter' : 'same'
    },
    rows: [SW.P1, SW.P3, SW.d0, SW.dcr, SW.tcr],
    explain: (b, a) => [
      `The during-fault curve is the same (P_e = 0 for a fault at the bus), so the rotor accelerates exactly as before. What changes is the network either side of the fault: P_max before = ${fx(b.s.lim.P1, 3)} → ${fx(a.s.lim.P1, 3)} pu and after clearing = ${fx(b.s.lim.P3, 3)} → ${fx(a.s.lim.P3, 3)} pu.`,
      `A smaller starting angle (δ₀ ${fx(deg(b.s.d0), 1)}° → ${fx(deg(a.s.d0), 1)}°) and a much larger decelerating area after clearing (δ_max ${fx(deg(b.s.dMax), 1)}° → ${fx(deg(a.s.dMax), 1)}°) raise δ_cr to ${fx(deg(a.s.dcr), 1)}° and t_cr from ${fx(tcrOf(b) * 1000, 0)} ms to ${fx(tcrOf(a) * 1000, 0)} ms.`,
      'Strengthening the network — more lines, lower reactance, series capacitors — is one of the classic ways to raise transient-stability limits.',
    ],
  },
]
