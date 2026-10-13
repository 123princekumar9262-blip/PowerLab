import type { Measurements } from '../measurements/measurements.ts'
import { reading } from '../lab/readings.ts'
import type { Reading } from '../lab/types.ts'
import type { ResolvedParams } from '../types/simulation.ts'
import { formatOhm, formatSI, formatV } from '../utils/format.ts'

/** The textbook average of each rectifier with a resistive load (the relation printed under the reading). */
function vdcRelation(p: ResolvedParams): string {
  const scr = p.control.device === 'scr'
  switch (p.topology) {
    case 'half-wave':
      return scr ? 'R load: Vdc = (Vm/2π)(1 + cos α)' : 'R load: Vdc = Vm/π ≈ 0.45·Vrms'
    case 'center-tap':
      return 'R load: Vdc = 2Vm/π ≈ 0.9·Vrms'
    case 'bridge':
      return scr ? 'continuous current: Vdc = (2Vm/π)·cos α' : 'R load: Vdc = 2Vm/π ≈ 0.9·Vrms'
    case 'semi-bridge':
      return 'Vdc = (Vm/π)(1 + cos α)'
    case '3ph-half-wave':
      return scr ? 'Vdc = 1.17·Vph·cos α (continuous)' : 'Vdc = 1.17·Vph'
    case '3ph-bridge':
      return scr ? 'Vdc = 1.35·VLL·cos α (continuous)' : 'Vdc = 1.35·VLL'
    case '3ph-half-controlled':
      return 'Vdc = 0.675·VLL·(1 + cos α)'
  }
}

/**
 * The Rectifier's readings strip: the averages a student meets first (Vdc, Idc), then the quality of the DC
 * (RMS, ripple factor) and the diode's stress (PIV) — all from the measurements of the last simulated cycle.
 */
export function rectifierReadings(m: Measurements, p: ResolvedParams): Reading[] {
  return [
    reading('vdc', 'Output voltage, average', formatSI(m.voutAvg, 'V'), vdcRelation(p)),
    reading('idc', 'Load current, average', formatSI(m.ioAvg, 'A'), `Idc = Vdc / R, R = ${formatOhm(p.resistance)}`),
    reading('vrms', 'Output voltage, RMS', formatV(m.voutRms, false), 'the heating value of vout'),
    reading('rf', 'Ripple factor', m.rippleFactor === null ? '—' : m.rippleFactor.toFixed(3), 'Vac,rms / Vdc: 0 is pure DC'),
    reading('piv', 'Peak inverse voltage', formatV(m.piv, false), 'the largest reverse voltage on a device', 'standard'),
  ]
}
