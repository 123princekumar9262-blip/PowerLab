import type { ModeId } from '../catalogue/catalogue.ts'
import { measure, type Measurements } from '../measurements/measurements.ts'
import { runSimulation } from '../simulation/engine.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import type { CircuitId, LabParams } from '../types/simulation.ts'
import { formatA, formatSI } from '../utils/format.ts'
import { TOPICS as DCDC } from '../workspaces/dcdc.tsx'
import { TOPICS as INVERTERS } from '../workspaces/inverters.tsx'
import { TOPICS as MAGNETICS } from '../workspaces/magnetics.tsx'
import type { DcdcMeasurements } from '../converters/dcdc/measure.ts'
import type { CoreMeasurements } from '../converters/magnetics/core.ts'
import type { InverterMeasurements } from '../converters/inverter/analysis.ts'

/**
 * INTERVIEW — classic power-electronics interview questions. The student answers first; then the matching
 * lab's own simulation (the topic objects of `workspaces/*.tsx`, or the rectifier engine) runs at the question's
 * settings. The right answer is DECIDED BY THAT RUN: a number is checked against the simulated value; a choice
 * is the option the simulated value / before-after comparison points to. "Open this circuit" opens the
 * workspace at the same settings.
 */

export interface Outcome {
  /** Choice questions: index of the option the simulation confirms. Number questions: the simulated value. */
  answer: number
  /** The headline simulated result, formatted. */
  value: string
  /** Supporting simulated values. */
  rows: Array<[string, string]>
  /** Why — written around the simulated numbers. */
  explain: string
}

export interface Question {
  id: string
  lab: string
  prompt: string
  /** The simulated settings in one line. */
  settings: string
  kind: 'choice' | 'number'
  choices?: string[]
  unit?: string
  /** Number questions: accepted relative error. */
  tolerance?: number
  simulate(): Outcome
  link: { lab: string; topic: string; mode?: ModeId; query?: Record<string, string> }
}

const rect = (p: LabParams, id: CircuitId): Measurements => measure(runSimulation(p, id))
const ideal = (p: LabParams): LabParams => ({ ...p, diode: { ...p.diode, model: 'ideal' } })
const closest = (values: number[], x: number) => values.reduce((best, v, i) => (Math.abs(v - x) < Math.abs(values[best] - x) ? i : best), 0)
const Hz = (v: number | null) => (v === null ? 'no ripple' : formatSI(v, 'Hz'))
const V = (v: number) => formatSI(v, 'V')
const dir = (a: number, b: number, eps = 0.005) => (Math.abs(b - a) <= eps * Math.abs(a) ? 2 : b > a ? 0 : 1)

const dcdc = (kind: 'buck' | 'boost', p: Record<string, unknown>) => {
  const t = DCDC[kind]
  return t.measure(t.simulate({ ...t.defaults, ...p })) as DcdcMeasurements
}

export const QUESTIONS: Question[] = [
  {
    id: 'ripple-1ph',
    lab: 'Rectifiers',
    prompt: 'A single-phase full-wave bridge rectifier is fed from a 50 Hz supply. What is the frequency of the ripple on its output?',
    settings: 'Single-phase diode bridge · 12 V rms, 50 Hz · R = 10 Ω',
    kind: 'choice',
    choices: ['25 Hz', '50 Hz', '100 Hz', '200 Hz'],
    simulate() {
      const m = rect(DEFAULT_PARAMS, 'bridge:R')
      return {
        answer: closest([25, 50, 100, 200], m.rippleFrequency ?? 0),
        value: Hz(m.rippleFrequency),
        rows: [['Average output', V(m.voutAvg)], ['Ripple p-p', V(m.ripplePP)]],
        explain: `The simulated output repeats at ${Hz(m.rippleFrequency)}. The bridge turns the negative half-cycle upside down, so every source cycle gives two identical output pulses: 2 × 50 Hz. A half-wave rectifier gives one pulse per cycle (50 Hz) — that difference is why a bridge needs a smaller filter capacitor.`,
      }
    },
    link: { lab: 'rectifiers', topic: '1ph-bridge', query: { load: 'R' } },
  },
  {
    id: 'ripple-6p',
    lab: 'Rectifiers',
    prompt: 'A three-phase 6-pulse diode bridge runs from a 50 Hz supply. What is its output ripple frequency?',
    settings: '6-pulse diode bridge · 12 V rms per phase, 50 Hz · R = 10 Ω',
    kind: 'choice',
    choices: ['50 Hz', '150 Hz', '300 Hz', '600 Hz'],
    simulate() {
      const m = rect(THREE_PHASE_DEFAULTS, '3ph-bridge:R')
      return {
        answer: closest([50, 150, 300, 600], m.rippleFrequency ?? 0),
        value: Hz(m.rippleFrequency),
        rows: [['Average output', V(m.voutAvg)], ['Ripple p-p', V(m.ripplePP)], ['Ripple, % of Vdc', `${((100 * m.ripplePP) / m.voutAvg).toFixed(1)} %`]],
        explain: `Simulated: ${Hz(m.rippleFrequency)}. The bridge always connects the load to the highest and the lowest phase; that pair changes six times per cycle, so there are six pulses per cycle: 6 × 50 Hz. The ripple is small (${V(m.ripplePP)} on ${V(m.voutAvg)}) without any filter.`,
      }
    },
    link: { lab: 'rectifiers', topic: '3ph-6pulse', query: { load: 'R' } },
  },
  {
    id: '6p-vdc',
    lab: 'Rectifiers',
    prompt: 'A three-phase 6-pulse diode bridge (ideal diodes) is fed with 12 V rms per phase. What is the average output voltage?',
    settings: '6-pulse bridge · ideal diodes · 12 V rms per phase, 50 Hz · R = 10 Ω',
    kind: 'number',
    unit: 'V',
    tolerance: 0.03,
    simulate() {
      const m = rect(ideal(THREE_PHASE_DEFAULTS), '3ph-bridge:R')
      const real = rect(THREE_PHASE_DEFAULTS, '3ph-bridge:R')
      return {
        answer: m.voutAvg,
        value: V(m.voutAvg),
        rows: [['Line voltage peak √6·Vph', V(Math.sqrt(6) * 12)], ['With 0.7 V diodes (workspace default)', V(real.voutAvg)]],
        explain: `The simulated average is ${V(m.voutAvg)} = ${(m.voutAvg / 12).toFixed(3)} × Vph — the textbook 3√6/π·Vph ≈ 2.34·Vph (or 1.35·VLL). The output rides on the tops of the line voltages, so it never falls far below their peak. Real diodes take two drops off every pulse: ${V(real.voutAvg)} in the workspace.`,
      }
    },
    link: { lab: 'rectifiers', topic: '3ph-6pulse', query: { load: 'R' } },
  },
  {
    id: 'freewheel',
    lab: 'Rectifiers',
    prompt: 'A half-wave rectifier feeds an R-L load. You add a freewheeling diode across the load. What happens to the average output voltage?',
    settings: 'Half-wave · 12 V rms, 50 Hz · R = 10 Ω, L = 50 mH · with and without Dfw',
    kind: 'choice',
    choices: ['It rises', 'It falls', 'It stays the same'],
    simulate() {
      const base = { ...DEFAULT_PARAMS, sim: { ...DEFAULT_PARAMS.sim, cycles: 8 } }
      const without = rect({ ...base, control: { device: 'diode', alphaDeg: 0, freewheel: false } }, 'half-wave:RL')
      const withFw = rect({ ...base, control: { device: 'diode', alphaDeg: 0, freewheel: true } }, 'half-wave:RL')
      return {
        answer: dir(without.voutAvg, withFw.voutAvg),
        value: `${V(without.voutAvg)} → ${V(withFw.voutAvg)}`,
        rows: [
          ['Lowest output, without → with', `${V(without.voutMin)} → ${V(withFw.voutMin)}`],
          ['Load current, average', `${formatA(without.ioAvg)} → ${formatA(withFw.ioAvg)}`],
        ],
        explain: `Without Dfw the inductor keeps D1 conducting after the source turns negative, so the output follows the source below zero (down to ${V(without.voutMin)}) and that negative area is subtracted from the average. Dfw gives the inductor current another path and clamps the output at about −Vf (${V(withFw.voutMin)}): the negative area disappears and the average rises from ${V(without.voutAvg)} to ${V(withFw.voutAvg)}. It also keeps the load current flowing more smoothly.`,
      }
    },
    link: { lab: 'rectifiers', topic: '1ph-half-wave', query: { load: 'RL', fw: '1' } },
  },
  {
    id: 'ct-piv',
    lab: 'Rectifiers',
    prompt: 'A center-tapped full-wave rectifier has 12 V rms on each half-winding (peak Vm ≈ 17 V). What peak reverse voltage must each diode block?',
    settings: 'Center-tapped full-wave · ideal diodes · 12 V rms per half-winding · R = 10 Ω',
    kind: 'choice',
    choices: ['Vm/2 ≈ 8.5 V', 'Vm ≈ 17 V', '√2·Vm ≈ 24 V', '2·Vm ≈ 34 V'],
    simulate() {
      const vm = Math.SQRT2 * 12
      const m = rect(ideal(DEFAULT_PARAMS), 'center-tap:R')
      return {
        answer: closest([vm / 2, vm, Math.SQRT2 * vm, 2 * vm], m.piv),
        value: V(m.piv),
        rows: [['Source peak Vm', V(vm)], ['Ratio PIV / Vm', (m.piv / vm).toFixed(3)]],
        explain: `Simulated peak inverse voltage: ${V(m.piv)} = ${(m.piv / vm).toFixed(2)} × Vm. While D1 conducts, the output sits at +Vm and the other half-winding pulls D2's anode to −Vm, so D2 blocks the full winding: 2·Vm. A bridge needs only Vm per diode — one reason it replaced the center tap.`,
      }
    },
    link: { lab: 'rectifiers', topic: '1ph-center-tap', query: { load: 'R' } },
  },
  {
    id: 'cap-peak',
    lab: 'Rectifiers',
    prompt: 'The 1000 µF filter capacitor of a bridge rectifier is replaced by 4700 µF. What happens to the peak current in each diode?',
    settings: 'Single-phase bridge · 12 V rms, 50 Hz · R = 10 Ω · C = 1000 µF → 4700 µF',
    kind: 'choice',
    choices: ['It rises', 'It falls', 'It stays the same'],
    simulate() {
      const base = { ...DEFAULT_PARAMS, sim: { ...DEFAULT_PARAMS.sim, cycles: 6 } }
      const a = rect({ ...base, load: { ...base.load, capacitance: 1000e-6 } }, 'bridge:RC')
      const b = rect({ ...base, load: { ...base.load, capacitance: 4700e-6 } }, 'bridge:RC')
      return {
        answer: dir(a.idPeak, b.idPeak),
        value: `${formatA(a.idPeak)} → ${formatA(b.idPeak)}`,
        rows: [
          ['Ripple p-p', `${V(a.ripplePP)} → ${V(b.ripplePP)}`],
          ['Diode conduction per cycle', `${a.conductionAngleDeg.toFixed(0)}° → ${b.conductionAngleDeg.toFixed(0)}°`],
        ],
        explain: `The ripple fell from ${V(a.ripplePP)} to ${V(b.ripplePP)} — but the diodes now conduct only ${b.conductionAngleDeg.toFixed(0)}° per cycle instead of ${a.conductionAngleDeg.toFixed(0)}°. They must put back the same charge (the load current) in a shorter time, so the peak current rose from ${formatA(a.idPeak)} to ${formatA(b.idPeak)}. A bigger capacitor is not free: the diodes and the transformer see taller, narrower pulses.`,
      }
    },
    link: { lab: 'rectifiers', topic: '1ph-bridge', query: { load: 'RC' } },
  },
  {
    id: 'scr-alpha',
    lab: 'Rectifiers',
    prompt: 'A single-phase fully controlled bridge (ideal SCRs) runs from 12 V rms with a strongly inductive load (continuous current) at a firing angle α = 45°. What is the average output voltage?',
    settings: 'Fully controlled bridge · ideal SCRs · 12 V rms, 50 Hz · R = 10 Ω, L = 50 mH · α = 45°',
    kind: 'number',
    unit: 'V',
    tolerance: 0.04,
    simulate() {
      const base = { ...DEFAULT_PARAMS, control: { device: 'scr' as const, alphaDeg: 45, freewheel: false }, sim: { ...DEFAULT_PARAMS.sim, cycles: 8 } }
      const m = rect(ideal(base), 'bridge:RL')
      const real = rect(base, 'bridge:RL')
      return {
        answer: m.voutAvg,
        value: V(m.voutAvg),
        rows: [
          ['Lowest load current (continuous?)', formatA(m.ioMin)],
          ['With 0.7 V SCRs (workspace default)', V(real.voutAvg)],
        ],
        explain: `Simulated Vdc = ${V(m.voutAvg)}. With continuous current (the load current never reaches zero: minimum ${formatA(m.ioMin)}) each pair of SCRs conducts for 180° starting at α, so Vdc = (2√2/π)·Vs·cos α = 0.9 × 12 V × cos 45° ≈ 7.64 V. Past α = 90° the average would turn negative — inverter operation. Real SCRs drop about 1.4 V per path: ${V(real.voutAvg)} in the workspace.`,
      }
    },
    link: { lab: 'rectifiers', topic: '1ph-bridge-scr', query: { load: 'RL', alpha: '45' } },
  },
  {
    id: 'buck-vout',
    lab: 'DC-DC',
    prompt: 'An ideal buck converter in continuous conduction has Vin = 24 V and a duty ratio D = 0.5. What is its average output voltage?',
    settings: 'Buck · ideal devices · 24 V, D = 50 %, 20 kHz · L = 100 µH, C = 100 µF, R = 6 Ω',
    kind: 'number',
    unit: 'V',
    tolerance: 0.03,
    simulate() {
      const m = dcdc('buck', { vin: 24, duty: 0.5 })
      return {
        answer: m.voutAvg,
        value: V(m.voutAvg),
        rows: [['Mode', m.mode], ['Inductor ripple ΔiL', formatA(m.ilPP)]],
        explain: `Simulated Vout = ${V(m.voutAvg)} (${m.mode}). In steady state the inductor's average voltage is zero (volt-second balance): (Vin − Vout)·D·Ts = Vout·(1 − D)·Ts, so Vout = D·Vin = 12 V. The output is the average of the switch-node square wave.`,
      }
    },
    link: { lab: 'dc-dc', topic: 'buck', query: { vin: '24', duty: '0.5' } },
  },
  {
    id: 'buck-dcm',
    lab: 'DC-DC',
    prompt: 'The same buck (24 V, D = 0.5, L = 100 µH, 20 kHz) now drives a light load of 60 Ω instead of 6 Ω. Does it stay in continuous conduction?',
    settings: 'Buck · ideal devices · 24 V, D = 50 %, 20 kHz · L = 100 µH · R = 60 Ω',
    kind: 'choice',
    choices: ['Yes — CCM', 'No — DCM'],
    simulate() {
      const m = dcdc('buck', { vin: 24, duty: 0.5, r: 60 })
      return {
        answer: m.mode === 'CCM' ? 0 : 1,
        value: m.mode,
        rows: [['Average output', V(m.voutAvg)], ['Inductor ripple ΔiL', formatA(m.ilPP)], ['Average inductor current', formatA(m.ilAvg)]],
        explain:
          m.mode === 'DCM'
            ? `Simulated: DCM. The ripple ΔiL = ${formatA(m.ilPP)} does not depend on the load, but the average current fell to ${formatA(m.ilAvg)} — less than ΔiL/2 — so the inductor current reaches zero every period. In DCM Vout no longer equals D·Vin: it rose to ${V(m.voutAvg)}.`
            : `Simulated: CCM. ΔiL = ${formatA(m.ilPP)} stays below twice the average current ${formatA(m.ilAvg)}.`,
      }
    },
    link: { lab: 'dc-dc', topic: 'buck', query: { vin: '24', duty: '0.5', r: '60' } },
  },
  {
    id: 'boost-double',
    lab: 'DC-DC',
    prompt: 'An ideal boost converter must double its input voltage (12 V → 24 V) in continuous conduction. Which duty ratio does that?',
    settings: 'Boost · ideal devices · 12 V, 20 kHz · L = 100 µH, C = 100 µF, R = 24 Ω · four duty ratios simulated',
    kind: 'choice',
    choices: ['D = 25 %', 'D = 50 %', 'D = 67 %', 'D = 75 %'],
    simulate() {
      const ds = [0.25, 0.5, 0.67, 0.75]
      const gains = ds.map((d) => dcdc('boost', { vin: 12, duty: d }).voutAvg / 12)
      const k = closest(gains, 2)
      return {
        answer: k,
        value: `Vout/Vin = ${gains[k].toFixed(3)} at D = ${(ds[k] * 100).toFixed(0)} %`,
        rows: ds.map((d, i) => [`D = ${(d * 100).toFixed(0)} %`, `Vout = ${V(12 * gains[i])} (×${gains[i].toFixed(2)})`] as [string, string]),
        explain: `Each duty was simulated: the gain closest to 2 is ×${gains[k].toFixed(3)} at D = ${(ds[k] * 100).toFixed(0)} %. Volt-second balance on the inductor: Vin·D = (Vout − Vin)·(1 − D), so Vout = Vin/(1 − D) — doubling needs D = 0.5. The gain climbs steeply as D → 1 (×${gains[3].toFixed(1)} at 75 %).`,
      }
    },
    link: { lab: 'dc-dc', topic: 'boost', query: { vin: '12', duty: '0.5' } },
  },
  {
    id: 'spwm-v1',
    lab: 'Inverters',
    prompt: 'A single-phase full bridge uses bipolar sine-triangle PWM with Vdc = 100 V and a modulation index ma = 0.8. What is the peak of the fundamental (50 Hz) component of the output voltage?',
    settings: 'Full bridge · bipolar SPWM · Vdc = 100 V, ma = 0.8, mf = 15 · R-L load',
    kind: 'number',
    unit: 'V',
    tolerance: 0.04,
    simulate() {
      const t = INVERTERS.spwm
      const m = t.measure(t.simulate({ ...t.defaults, vdc: 100, m: 0.8 })) as InverterMeasurements
      return {
        answer: m.v1,
        value: V(m.v1),
        rows: [['Output RMS (all harmonics)', V(m.vrms)], ['Voltage THD', `${(m.thdV * 100).toFixed(0)} %`]],
        explain: `The simulated output's Fourier series has a fundamental of ${V(m.v1)} peak = ${(m.v1 / 100).toFixed(3)} × Vdc. In the linear range (ma ≤ 1) the PWM average follows the reference: V1 = ma·Vdc = 80 V. The rest of the waveform is switching harmonics around 15 × 50 Hz (THD ${(m.thdV * 100).toFixed(0)} %), which the load inductance filters out of the current.`,
      }
    },
    link: { lab: 'inverters', topic: 'spwm', query: { vdc: '100', m: '0.8' } },
  },
  {
    id: 'saturation',
    lab: 'Magnetics',
    prompt: 'A gapped inductor is driven by a ±24 V square wave at 20 kHz and works fine. The frequency is lowered to 12 kHz, same voltage. What happens to the peak current?',
    settings: 'Gapped inductor · ±24 V square wave · N = 20 · Bsat = 0.35 T · 20 kHz → 12 kHz',
    kind: 'choice',
    choices: ['It rises sharply — the core saturates', 'It falls', 'It barely changes'],
    simulate() {
      const t = MAGNETICS.inductor
      const b = t.measure(t.simulate({ ...t.defaults, f: 20e3 })) as CoreMeasurements
      const a = t.measure(t.simulate({ ...t.defaults, f: 12e3 })) as CoreMeasurements
      return {
        answer: a.saturated && a.ipk > 2 * b.ipk ? 0 : a.ipk < 0.95 * b.ipk ? 1 : 2,
        value: `${formatA(b.ipk)} → ${formatA(a.ipk)}`,
        rows: [
          ['Peak flux density', `${b.bpk.toFixed(3)} T → ${a.bpk.toFixed(3)} T`],
          ['Saturated part of the period', `${(b.satFrac * 100).toFixed(1)} % → ${(a.satFrac * 100).toFixed(1)} %`],
        ],
        explain: `Each half-period now lasts longer, so more volt-seconds reach the winding and the flux swings further (ΔB = V·t/(N·Ae)). The flux peak tried to pass Bsat = 0.35 T: the core saturated for ${(a.satFrac * 100).toFixed(1)} % of the period, the inductance collapsed, and the current shot from ${formatA(b.ipk)} to ${formatA(a.ipk)}. That is why magnetics are designed for the lowest frequency and the highest volt-seconds they will ever see.`,
      }
    },
    link: { lab: 'magnetics', topic: 'inductor', query: { f: '12000' } },
  },
]

export function isRight(q: Question, o: Outcome, given: number): boolean {
  if (q.kind === 'choice') return given === o.answer
  return Number.isFinite(given) && Math.abs(given - o.answer) <= (q.tolerance ?? 0.03) * Math.abs(o.answer)
}
