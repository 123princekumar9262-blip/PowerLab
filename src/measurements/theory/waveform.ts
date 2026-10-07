import { isThreePhase, type ResolvedParams } from '../../types/simulation.ts'
import { extremes, simpson } from './numeric.ts'

/**
 * Shared theory machinery: an analytic steady-state waveform over one source cycle is
 * turned into every comparison row by quadrature of the closed-form expressions.
 */

export type MeasureKey =
  | 'vinPeak'
  | 'vinRms'
  | 'voutAvg'
  | 'voutRms'
  | 'voutPeak'
  | 'voutMin'
  | 'ripplePP'
  | 'rippleFactor'
  | 'ioAvg'
  | 'ioRms'
  | 'ioPeak'
  | 'idPeak'
  | 'idAvg'
  | 'piv'
  | 'conductionAngleDeg'
  | 'turnOnAngleDeg'
  | 'turnOffAngleDeg'
  | 'rippleFrequency'
  | 'efficiency'
  | 'vphRms'
  | 'vllRms'

export interface TheoryValue {
  value: number
  formula: string
  /** exact = closed form (incl. quadrature/roots of closed forms); approx = textbook approximation. */
  kind: 'exact' | 'approx'
  /** Valid only if the inductor current is continuous (choke-input filter). */
  requiresContinuous?: boolean
}

export interface Theory {
  values: Partial<Record<MeasureKey, TheoryValue>>
  /** Textbook approximations shown next to the exact rows, for comparison. */
  approximations: Array<{ key: MeasureKey; label: string; value: number; formula: string }>
  /** Assumptions, operating mode and caveats, shown under the table. */
  notes: string[]
  /** Operating mode, when the theory distinguishes one. */
  mode?: 'continuous' | 'discontinuous'
}

export const TWO_PI = 2 * Math.PI
export const deg = (r: number) => (r * 180) / Math.PI

/** Analytic steady-state waveform over one source cycle [a, a + 2π]. */
export interface Waveform {
  a: number
  /** Angles where the waveform is piecewise (integration is split there). */
  breaks: number[]
  vout(θ: number): number
  io(θ: number): number
  iD1(θ: number): number
  /** Current through the conduction path (for diode loss Vft·i + Ront·i²). */
  irect(θ: number): number
  /** Largest reverse voltage across any diode at θ. */
  piv(θ: number): number
  turnOn: number | null
  turnOff: number | null
}

/** Pulses per cycle (n) and the forward drop / resistance in the conduction path. */
export function pathDrops(p: ResolvedParams) {
  // Any bridge puts two devices in series with the load.
  const twoDevices = p.topology === 'bridge' || p.topology === '3ph-bridge' || p.topology === '3ph-half-controlled'
  const pulses: Record<ResolvedParams['topology'], number> = {
    'half-wave': 1,
    'center-tap': 2,
    bridge: 2,
    '3ph-half-wave': 3,
    '3ph-bridge': 6,
    // Half-controlled: with α > 0 the upper (fired) and lower (natural) halves no longer
    // match, so the output repeats only 3 times per cycle.
    '3ph-half-controlled': p.control.alpha > 1e-9 ? 3 : 6,
  }
  return {
    n: pulses[p.topology],
    vft: twoDevices ? 2 * p.diode.vf : p.diode.vf,
    ront: twoDevices ? 2 * p.diode.ron : p.diode.ron,
  }
}

/** Reverse voltage on the blocking diodes, given the output voltage and path current. */
export function pivAt(p: ResolvedParams, θ: number, vout: number, i: number): number {
  const vin = p.vm * Math.sin(θ)
  switch (p.topology) {
    case 'half-wave':
      return vout - vin // −vD1 = vK − vA = vout − vin
    case 'center-tap':
      return vout + Math.abs(vin) // −vD = vP − (±vin)
    case 'bridge':
      // Conducting pair: the blocking pair sees vout + Vf + Ron·i. All OFF: each shares (vout + |vin|)/2.
      return i > 0 ? vout + p.diode.vf + p.diode.ron * i : (vout + Math.abs(vin)) / 2
    default:
      return 0 // three-phase PIV is computed in threePhase.ts (it needs all three phases)
  }
}

export function integrate(w: Waveform, f: (θ: number) => number): number {
  const pts = [w.a, ...w.breaks.filter((x) => x > w.a && x < w.a + TWO_PI).sort((x, y) => x - y), w.a + TWO_PI]
  let s = 0
  for (let k = 0; k + 1 < pts.length; k++) s += simpson(f, pts[k], pts[k + 1], 2000)
  return s
}

export function fromWaveform(p: ResolvedParams, w: Waveform, formulas: Partial<Record<MeasureKey, string>>): Theory['values'] {
  const avg = (f: (θ: number) => number) => integrate(w, f) / TWO_PI
  const vdc = avg(w.vout)
  const vrms = Math.sqrt(Math.max(0, avg((θ) => w.vout(θ) ** 2)))
  const ex = (f: (θ: number) => number) => extremes(f, w.a, w.a + TWO_PI)
  const vx = ex(w.vout)
  const R = p.resistance
  const pLoad = avg((θ) => R * w.io(θ) ** 2)
  const { vft, ront } = pathDrops(p)
  const pDiode = avg((θ) => vft * w.irect(θ) + ront * w.irect(θ) ** 2)
  const e = (value: number, key: MeasureKey, fallback: string): TheoryValue => ({ value, formula: formulas[key] ?? fallback, kind: 'exact' })
  const vals: Theory['values'] = {
    voutAvg: e(vdc, 'voutAvg', 'Vdc = (1/2π)∫vo dθ'),
    voutRms: e(vrms, 'voutRms', 'Vo,rms = √((1/2π)∫vo² dθ)'),
    voutPeak: e(vx.max, 'voutPeak', 'max vo(θ)'),
    voutMin: e(vx.min, 'voutMin', 'min vo(θ)'),
    ripplePP: e(vx.max - vx.min, 'ripplePP', 'max vo − min vo'),
    ioAvg: e(avg(w.io), 'ioAvg', 'Idc = (1/2π)∫io dθ'),
    ioRms: e(Math.sqrt(avg((θ) => w.io(θ) ** 2)), 'ioRms', 'Io,rms = √((1/2π)∫io² dθ)'),
    ioPeak: e(ex(w.io).max, 'ioPeak', 'max io(θ)'),
    idPeak: e(ex(w.iD1).max, 'idPeak', 'max iD1(θ)'),
    idAvg: e(avg(w.iD1), 'idAvg', 'ID1,avg = (1/2π)∫iD1 dθ'),
    piv: e(ex(w.piv).max, 'piv', 'max reverse vD'),
    efficiency: e(pLoad / (pLoad + pDiode || 1), 'efficiency', 'η = P_R / (P_R + P_diodes)'),
  }
  if (Math.abs(vdc) > p.vm * 1e-9) vals.rippleFactor = e(Math.sqrt(Math.max(0, vrms ** 2 - vdc ** 2)) / Math.abs(vdc), 'rippleFactor', 'RF = √(Vrms² − Vdc²)/Vdc')
  if (w.turnOn !== null && w.turnOff !== null) {
    vals.turnOnAngleDeg = e(deg(w.turnOn), 'turnOnAngleDeg', 'θon')
    vals.turnOffAngleDeg = e(deg(w.turnOff), 'turnOffAngleDeg', 'θoff')
    vals.conductionAngleDeg = e(deg(w.turnOff - w.turnOn), 'conductionAngleDeg', 'γ = θoff − θon')
  }
  return vals
}


export function none(p: ResolvedParams, notes: string[]): Theory {
  return finish(p, {}, [], notes)
}

/** Rows every circuit shares: source values and ripple frequency. */
export function finish(p: ResolvedParams, values: Theory['values'], approximations: Theory['approximations'], notes: string[], mode?: Theory['mode']): Theory {
  const { n, vft } = pathDrops(p)
  const conducts = p.vm > vft
  return {
    values: {
      vinPeak: { value: p.vm, formula: 'Vm = √2·Vrms', kind: 'exact' },
      vinRms: { value: p.vrms, formula: 'Vrms = Vm/√2', kind: 'exact' },
      ...(isThreePhase(p.topology)
        ? {
            vphRms: { value: p.vrms, formula: 'Vph = Vm/√2', kind: 'exact' as const },
            vllRms: { value: Math.sqrt(3) * p.vrms, formula: 'VLL = √3·Vph', kind: 'exact' as const },
          }
        : {}),
      ...(conducts ? { rippleFrequency: { value: n * p.frequency, formula: n === 2 ? 'f_r = 2f' : 'f_r = f', kind: 'exact' as const } } : {}),
      ...values,
    },
    approximations,
    notes: notes.filter(Boolean),
    mode,
  }
}

