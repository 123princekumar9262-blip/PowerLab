import type { ControlMeasurements } from '../converters/control/content.ts'
import type { ControlRun } from '../converters/control/content.ts'
import type { DcdcMeasurements } from '../converters/dcdc/measure.ts'
import type { MosfetMeasurements } from '../converters/devices/mosfet.ts'
import type { DriveMeasurements } from '../converters/drives/motor.ts'
import type { ThermalMeasurements } from '../converters/engineering/thermal.ts'
import type { EvMeasurements } from '../converters/ev/vehicle.ts'
import type { EvRun } from '../converters/ev/vehicle.ts'
import type { InverterMeasurements } from '../converters/inverter/analysis.ts'
import type { CoreMeasurements } from '../converters/magnetics/core.ts'
import type { PwmMeasurements } from '../converters/pwm/analysis.ts'
import type { PwmRun } from '../converters/pwm/modulator.ts'
import type { ConverterKind, ConverterResult } from '../converters/types.ts'
import { reading } from '../lab/readings.ts'
import type { Reading } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

/*
 * The readings strip of each existing lab: its headline results, most important first, every one a
 * measurement of the simulated run (the same numbers as the lab's Measurements panel). Beginner sees the
 * first two.
 */

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)} %`
const none = (x: number | null | undefined, f: (v: number) => string) => (x === null || x === undefined || !Number.isFinite(x) ? '— ' : f(x))

const DCDC_RELATION: Record<ConverterKind, string> = {
  buck: 'ideal CCM: Vout = D·Vin',
  boost: 'ideal CCM: Vout = Vin / (1 − D)',
  'buck-boost': 'ideal CCM: Vout = −D·Vin / (1 − D)',
}
export const dcdcReadings =
  (kind: ConverterKind) =>
  (m: DcdcMeasurements, r: ConverterResult): Reading[] => [
    reading('vout', 'Output voltage, average', formatV(m.voutAvg, kind === 'buck-boost'), DCDC_RELATION[kind]),
    reading('io', 'Load current, average', formatA(m.ioAvg), `Iout = Vout / R, R = ${formatSI(r.params.r, 'Ω')}`),
    reading('ilpp', 'Inductor current ripple', formatA(m.ilPP), `ΔiL peak-to-peak · ${m.mode}`),
    reading('voutpp', 'Output voltage ripple', formatSI(m.voutPP, 'V'), 'ΔVout peak-to-peak'),
    reading('eff', 'Efficiency', pct(m.efficiency), 'η = Pout / Pin', 'standard'),
  ]

export function pwmReadings(m: PwmMeasurements, r: PwmRun): Reading[] {
  if (r.params.reference === 'dc')
    return [
      reading('avg', 'Average output', formatV(m.avg), 'the DC part: what a filter keeps'),
      reading('duty', 'Duty measured', pct(m.dutyMeasured), 'ON time / carrier period'),
      reading('rms', 'RMS output', formatV(m.rms, false), 'heating value of the pulses'),
      reading('pulses', 'Pulses per period', String(m.pulses), 'ON intervals in one period'),
    ]
  return [
    reading('v1', 'Fundamental (peak)', formatV(m.v1, false), 'natural sampling: V1 = M·Vdc/2'),
    reading('thd', 'Distortion (THD)', pct(m.thd), 'harmonics RMS / fundamental RMS'),
    reading('first', 'First large harmonic', `${m.firstSignificant}`, 'order of the first harmonic above 1 % of V1'),
    reading('rms', 'RMS output', formatV(m.rms, false), 'all harmonics together'),
  ]
}

export function inverterReadings(m: InverterMeasurements): Reading[] {
  return [
    reading('v1', 'Output voltage, fundamental', formatV(m.v1, false), 'peak of the 50 Hz component'),
    reading('i1', 'Load current, fundamental', formatA(m.i1), 'peak · I1 = V1 / |Z|'),
    reading('thd', 'Voltage distortion (THD)', pct(m.thdV), 'harmonics RMS / fundamental RMS'),
    reading('p', 'Load power', formatW(m.pLoad), 'average over one cycle'),
    reading('thdi', 'Current distortion (THD)', pct(m.thdI, 2), 'the load inductance filters the harmonics', 'standard'),
  ]
}

export function mosfetReadings(m: MosfetMeasurements): Reading[] {
  return [
    reading('eon', 'Turn-on energy', formatSI(m.eon, 'J'), 'Eon = ∫ vDS·iD dt during turn-on'),
    reading('eoff', 'Turn-off energy', formatSI(m.eoff, 'J'), 'Eoff = ∫ vDS·iD dt during turn-off'),
    reading('plateau', 'Miller plateau', none(m.plateau, (v) => formatV(v, false)), 'vGS while vDS falls'),
    reading('tfv', 'Voltage fall time', none(m.tfv, formatTime), 't_fv: Cgd discharged by the gate current'),
    reading('pcond', 'Conduction loss', formatW(m.pcond), 'I0²·Ron while ON', 'standard'),
  ]
}

export function coreReadings(m: CoreMeasurements): Reading[] {
  return [
    reading('ipk', 'Peak current', formatA(m.ipk), 'the largest current of the last period'),
    reading('bpk', 'Peak flux density', `${m.bpk.toFixed(3)} T`, 'B = N·i / (Ae·reluctance)'),
    reading('db', 'Flux swing ΔB', `${m.dB.toFixed(3)} T`, 'ΔB = V·ton / (N·Ae)'),
    reading('sat', 'Time saturated', pct(m.satFrac), 'share of the period above Bsat'),
    reading('l', 'Inductance measured', formatSI(m.lMeas, 'H'), 'Δλ / Δi over the last period', 'standard'),
  ]
}

export function controlReadings(m: ControlMeasurements, r: ControlRun): Reading[] {
  return [
    reading('vout', 'Output voltage, final', formatV(m.avg[m.avg.length - 1] ?? NaN, false), `reference ${formatV(r.params.vref, false)}`),
    reading('os', 'Overshoot', none(m.overshoot, (v) => pct(v)), 'above the reference after the step'),
    reading('ts', 'Settling time', none(m.settling, formatTime), 'to stay within 2 %'),
    reading('dev', 'Load-step dip', none(m.loadDev, (v) => formatV(v)), 'largest deviation after the load step'),
    reading('err', 'Final error', formatV(m.ssError), 'reference − sampled output at the end', 'standard'),
  ]
}

export function driveReadings(m: DriveMeasurements): Reading[] {
  return [
    reading('n', 'Speed', `${m.nEnd.toFixed(0)} rpm`, 'mean over the last period'),
    reading('i', 'Armature current, average', formatA(m.iEnd, true), 'torque = k·i'),
    reading('ripple', 'Current ripple', formatA(m.ripple), 'peak-to-peak, set by La and the chopping frequency'),
    reading('va', 'Armature voltage, average', formatV(m.vaEnd, false), 'Va = Ra·i + k·ω'),
    reading('eff', 'Efficiency', none(m.eff, (v) => pct(v)), 'shaft power / input power', 'standard'),
  ]
}

export function thermalReadings(m: ThermalMeasurements): Reading[] {
  return [
    reading('tj', 'Junction temperature, mean', m.runaway ? 'RUNAWAY' : `${m.tjMean.toFixed(1)} °C`, 'Tj = Ta + P·Rth (constant load)'),
    reading('tjmax', 'Junction temperature, peak', m.runaway ? 'RUNAWAY' : `${m.tjMax.toFixed(1)} °C`, 'the hottest instant of a load cycle'),
    reading('p', 'Losses, average', formatW(m.pMean), 'conduction + switching'),
    reading('dtj', 'Temperature swing ΔTj', `${m.dTj.toFixed(2)} K`, 'drives power-cycling wear'),
  ]
}

export function evReadings(m: EvMeasurements, r: EvRun): Reading[] {
  if (r.params.cycle === 'accel')
    return [
      reading('t100', '0–100 km/h', m.t100 === null ? '— s' : formatTime(m.t100), 'torque-limited, then power-limited'),
      reading('vend', 'Speed at the end', `${m.vEnd.toFixed(0)} km/h`, `after ${r.params.duration} s`),
      reading('ppk', 'Peak battery power', formatW(m.pPeak), 'the largest power drawn'),
      reading('ipk', 'Peak battery current', formatA(m.iPeak), 'P / Vbattery'),
    ]
  return [
    reading('cons', 'Consumption', `${m.consumption.toFixed(1)} Wh/km`, 'battery energy / distance'),
    reading('range', 'Range at this consumption', Number.isFinite(m.range) ? `${m.range.toFixed(0)} km` : '— km', 'usable battery energy / consumption'),
    reading('regen', 'Energy regenerated', `${(m.eRegen / 3600).toFixed(1)} Wh`, 'returned to the battery while braking'),
    reading('ppk', 'Peak battery power', formatW(m.pPeak), 'the largest power drawn'),
  ]
}
