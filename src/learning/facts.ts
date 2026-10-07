import type { Comparison } from '../measurements/compare.ts'
import type { SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV, formatCapacitance } from '../utils/format.ts'

/**
 * Numbers a lesson or prompt may quote, all taken from the simulation result
 * (measured) — so the text always matches what the student sees on screen.
 */
export function factsFor(result: SimulationResult, comparison: Comparison, sample: SimulationSample | null): Record<string, string> {
  const m = comparison.measurements
  const p = result.params
  const f: Record<string, string> = {
    vm: formatV(p.vm, false),
    vrms: formatSI(p.vrms, 'V'),
    vf: formatSI(p.diode.vf, 'V'),
    vdc: formatV(m.voutAvg, false),
    vpk: formatV(m.voutPeak, false),
    vmin: formatV(m.voutMin, false),
    ripple: formatSI(m.ripplePP, 'V'),
    piv: formatV(m.piv, false),
    idpk: formatA(m.idPeak),
    iopk: formatA(m.ioPeak),
    idc: formatA(m.ioAvg),
    gamma: formatDeg(m.conductionAngleDeg),
    theta1: m.turnOnAngleDeg === null ? '—' : formatDeg(m.turnOnAngleDeg),
    beta: m.turnOffAngleDeg === null ? '—' : formatDeg(m.turnOffAngleDeg),
    fr: m.rippleFrequency === null ? '—' : formatSI(m.rippleFrequency, 'Hz', { digits: 0 }),
    eff: m.efficiency === null ? '—' : `${(m.efficiency * 100).toFixed(1)} %`,
    ilmin: m.rectCurrentMin === null ? '—' : formatA(m.rectCurrentMin),
    R: formatSI(p.resistance, 'Ω'),
    L: formatSI(p.inductance, 'H'),
    C: formatCapacitance(p.capacitance),
    tauC: formatTime(p.resistance * p.capacitance),
    tauL: formatTime(p.inductance / p.resistance),
  }
  if (sample) {
    f.vin = formatV(sample.vin)
    f.vout = formatV(sample.vout)
    f.io = formatA(sample.io)
    f.vd = formatV(sample.vd)
    f.vl = formatV(sample.values.vl ?? 0)
    f.il = formatA(sample.values.il ?? sample.io)
    f.ic = formatA(sample.values.ic ?? 0, true)
  }
  return f
}

/** Replace {name} placeholders with simulation facts. Unknown names are left visible (never silently blank). */
export function fill(text: string, facts: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => facts[k] ?? all)
}
