import type { Measurements } from '../measurements/measurements.ts'
import type { LabParams } from '../types/simulation.ts'
import { formatSI } from '../utils/format.ts'
import { formatQuantity } from './experiment.ts'

/**
 * Guided freewheeling-diode experiments (half-wave rectifier, RL load). Each one sets a clean
 * BEFORE, changes exactly one thing for AFTER, and states what the physics predicts. The
 * measured numbers in "what the physics says" are filled in from the two simulations.
 */
export interface FreewheelExperiment {
  id: string
  title: string
  goal: string
  /** Parameters for BEFORE (null = an observation run with no comparison). */
  before: ((p: LabParams) => LabParams) | null
  after: (p: LabParams) => LabParams
  /** What the physics says, written with the measured values. */
  physics: (after: Measurements, before: Measurements | null) => string
}

const fw = (p: LabParams, on: boolean): LabParams => ({
  ...p,
  control: { device: 'diode', alphaDeg: p.control?.alphaDeg ?? 0, freewheel: on },
  sim: { ...p.sim, cycles: Math.max(p.sim.cycles, 10) },
})
const withL = (p: LabParams, L: number): LabParams => ({ ...p, load: { ...p.load, inductance: L } })
const withR = (p: LabParams, R: number): LabParams => ({ ...p, load: { ...p.load, resistance: R } })
const q = (v: number | null, unit: string) => formatQuantity(v, unit)

export const FREEWHEEL_EXPERIMENTS: FreewheelExperiment[] = [
  {
    id: 'fw-1',
    title: '1 · Run the RL rectifier without a freewheeling diode',
    goal: 'See what the inductor does to a half-wave rectifier on its own.',
    before: null,
    after: (p) => fw(p, false),
    physics: (a) =>
      `The inductor keeps D1 conducting after vin turns negative, until its stored energy is used up: the extinction angle β = ${q(a.turnOffAngleDeg, '°')} (> 180°). Meanwhile the output follows vin below zero (down to ${q(a.voutMin, 'V')}), which subtracts area from the average: Vdc = ${q(a.voutAvg, 'V')}. The current is zero for part of every cycle (minimum ${q(a.ioMin, 'A')}) — discontinuous.`,
  },
  {
    id: 'fw-2',
    title: '2 · Enable the freewheeling diode',
    goal: 'Add Dfw across the load and compare.',
    before: (p) => fw(p, false),
    after: (p) => fw(p, true),
    physics: (a, b) =>
      `Dfw clamps the output at −Vf (Vo,min ${q(b?.voutMin ?? null, 'V')} → ${q(a.voutMin, 'V')}) and takes the inductor current whenever vin < 0, so D1 conducts exactly 180° (${q(a.conductionAngleDeg, '°')}) and Dfw the rest (${q(a.fwConductionDeg, '°')}). Without the negative area Vdc = Vm/π − Vf = ${q(a.voutAvg, 'V')}, independent of L. The load current ${a.ioMin > 0 ? `never reaches zero (minimum ${q(a.ioMin, 'A')})` : 'still reaches zero (L is too small to bridge the gap)'}.`,
  },
  {
    id: 'fw-3',
    title: '3 · Increase the inductance (×3)',
    goal: 'With Dfw fitted, make L three times larger.',
    before: (p) => fw(p, true),
    after: (p) => withL(fw(p, true), Math.min(10, 3 * p.load.inductance)),
    physics: (a, b) =>
      `During freewheeling the current decays as e^(−t/τ) with τ = L/R. Tripling L triples τ, so less current is lost before D1 takes over again: the minimum current rises (${q(b?.ioMin ?? null, 'A')} → ${q(a.ioMin, 'A')}) and the ripple factor falls (${q(b?.ioRippleFactor ?? null, '')} → ${q(a.ioRippleFactor, '')}). Vdc does not depend on L with Dfw (${q(b?.voutAvg ?? null, 'V')} → ${q(a.voutAvg, 'V')}): avg vL = 0 and the output waveform is fixed by the diodes.`,
  },
  {
    id: 'fw-4',
    title: '4 · Decrease the resistance (÷2)',
    goal: 'With Dfw fitted, halve R.',
    before: (p) => fw(p, true),
    after: (p) => withR(fw(p, true), Math.max(1e-3, p.load.resistance / 2)),
    physics: (a, b) =>
      `Halving R doubles both the average current (Idc = Vdc/R: ${q(b?.ioAvg ?? null, 'A')} → ${q(a.ioAvg, 'A')}) and the time constant τ = L/R, so the current decays more slowly while freewheeling and the ripple factor falls (${q(b?.ioRippleFactor ?? null, '')} → ${q(a.ioRippleFactor, '')}). The peak stored energy grows with i²: E_L,max ${b?.wlMax != null ? formatSI(b.wlMax, 'J') : '—'} → ${a.wlMax != null ? formatSI(a.wlMax, 'J') : '—'}.`,
  },
  {
    id: 'fw-5',
    title: '5 · Compare current ripple (large L, with vs without Dfw)',
    goal: 'With L = 200 mH, compare the load current with and without Dfw.',
    before: (p) => withL(fw(p, false), 0.2),
    after: (p) => withL(fw(p, true), 0.2),
    physics: (a, b) =>
      `Without Dfw a large L only stretches the conduction (β = ${q(b?.turnOffAngleDeg ?? null, '°')}) — the current still stops every cycle and its average is small (${q(b?.ioAvg ?? null, 'A')}), because the inductor's negative-voltage interval eats into Vdc. With Dfw the same L smooths the current: ripple factor ${q(b?.ioRippleFactor ?? null, '')} → ${q(a.ioRippleFactor, '')}, minimum ${q(b?.ioMin ?? null, 'A')} → ${q(a.ioMin, 'A')}, average ${q(a.ioAvg, 'A')}. This is why DC motor drives and field windings always have a freewheeling path.`,
  },
]
