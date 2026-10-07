import type { Measurements } from '../measurements/measurements.ts'
import type { CircuitId, LabParams } from '../types/simulation.ts'
import { formatSI } from '../utils/format.ts'

/** A frozen BEFORE state: the parameters and the measurements the simulation produced. */
export interface Snapshot {
  circuitId: CircuitId
  params: LabParams
  m: Measurements
}

export interface ParamChange {
  key: string
  label: string
  before: string
  after: string
  /** +1 increased, −1 decreased, 0 changed (non-numeric). */
  direction: number
}

export interface QuantityChange {
  key: keyof Measurements
  label: string
  before: number | null
  after: number | null
  unit: string
  /** Relative change (after − before)/|before|; null if not comparable. */
  rel: number | null
}

const QUANTITIES: Array<{ key: keyof Measurements; label: string; unit: string }> = [
  { key: 'voutAvg', label: 'Average output Vdc', unit: 'V' },
  { key: 'ioAvg', label: 'Average load current Idc', unit: 'A' },
  { key: 'ripplePP', label: 'Output ripple (p-p)', unit: 'V' },
  { key: 'ioRipplePP', label: 'Current ripple (p-p)', unit: 'A' },
  { key: 'rippleFrequency', label: 'Ripple frequency', unit: 'Hz' },
  { key: 'conductionAngleDeg', label: 'D1 conduction angle', unit: '°' },
  { key: 'piv', label: 'Peak inverse voltage', unit: 'V' },
  { key: 'loadPower', label: 'Load power', unit: 'W' },
  { key: 'efficiency', label: 'Efficiency', unit: '' },
]

const fmt = (v: number | null | undefined, unit: string) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : unit === '°' ? `${v.toFixed(1)}°` : unit === '' ? `${(v * 100).toFixed(1)} %` : formatSI(v, unit)
export const formatQuantity = fmt

/** What the student changed between BEFORE and AFTER (parameters, circuit, faults). */
export function diffParams(before: Snapshot, afterId: CircuitId, after: LabParams): ParamChange[] {
  const out: ParamChange[] = []
  const num = (key: string, label: string, a: number | undefined, b: number | undefined, unit: string, scale = 1) => {
    if (a === undefined || b === undefined || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a))) return
    out.push({ key, label, before: formatSI(a * scale, unit), after: formatSI(b * scale, unit), direction: Math.sign(b - a) })
  }
  const B = before.params
  if (before.circuitId !== afterId) out.push({ key: 'circuit', label: 'Circuit', before: before.circuitId, after: afterId, direction: 0 })
  num('vrms', 'Source RMS voltage', B.source.vrms, after.source.vrms, 'V')
  num('frequency', 'Frequency', B.source.frequency, after.source.frequency, 'Hz')
  num('resistance', 'Load R', B.load.resistance, after.load.resistance, 'Ω')
  num('inductance', 'Load L', B.load.inductance, after.load.inductance, 'H')
  num('capacitance', 'Load C', B.load.capacitance, after.load.capacitance, 'F')
  if (B.diode.model !== after.diode.model) out.push({ key: 'model', label: 'Diode model', before: B.diode.model, after: after.diode.model, direction: 0 })
  num('vf', 'Forward voltage Vf', B.diode.vf, after.diode.vf, 'V')
  num('ron', 'On-resistance Ron', B.diode.ron, after.diode.ron, 'Ω')
  num('alpha', 'Firing angle α', B.control?.alphaDeg, after.control?.alphaDeg, '°')
  if ((B.control?.device ?? 'diode') !== (after.control?.device ?? 'diode')) out.push({ key: 'device', label: 'Devices', before: B.control?.device ?? 'diode', after: after.control?.device ?? 'diode', direction: 0 })
  if (!!B.control?.freewheel !== !!after.control?.freewheel) out.push({ key: 'freewheel', label: 'Freewheeling diode', before: B.control?.freewheel ? 'yes' : 'no', after: after.control?.freewheel ? 'yes' : 'no', direction: 0 })
  if ((B.threePhase?.sequence ?? 'abc') !== (after.threePhase?.sequence ?? 'abc')) out.push({ key: 'sequence', label: 'Phase sequence', before: B.threePhase?.sequence ?? 'abc', after: after.threePhase?.sequence ?? 'abc', direction: 0 })
  num('rs', 'Source Rs', B.threePhase?.rs, after.threePhase?.rs, 'Ω')
  num('ls', 'Source Ls', B.threePhase?.ls, after.threePhase?.ls, 'H')
  const fb = describeFault(B.faults)
  const fa = describeFault(after.faults)
  if (fb !== fa) out.push({ key: 'fault', label: 'Fault', before: fb, after: fa, direction: 0 })
  return out
}

export function describeFault(f: LabParams['faults']): string {
  if (!f) return 'none'
  const parts: string[] = []
  if (f.diode) parts.push(`${f.diode.id} ${f.diode.kind}`)
  if (f.vfOverride) parts.push(`${f.vfOverride.id} Vf = ${f.vfOverride.vf} V`)
  if (f.missingPhase) parts.push(`phase ${f.missingPhase.toUpperCase()} missing`)
  if (f.imbalance) parts.push(`phase ${f.imbalance.phase.toUpperCase()} at ${(f.imbalance.scale * 100).toFixed(0)} %`)
  return parts.join(', ') || 'none'
}

export function diffQuantities(before: Measurements, after: Measurements): QuantityChange[] {
  return QUANTITIES.map(({ key, label, unit }) => {
    const b = before[key] as number | null
    const a = after[key] as number | null
    const rel = b !== null && a !== null && Math.abs(b) > 1e-12 ? (a - b) / Math.abs(b) : null
    return { key, label, unit, before: b, after: a, rel }
  })
}

/**
 * "Why?" — physical reasoning for each change, written for the direction the SIMULATION
 * actually measured (the numbers are never invented here; the text interprets them).
 */
export function explainChanges(changes: ParamChange[], q: QuantityChange[], threePhase: boolean): string[] {
  const d = (k: keyof Measurements) => q.find((x) => x.key === k)?.rel ?? null
  const word = (r: number | null) => (r === null ? 'changed' : Math.abs(r) < 0.005 ? 'stayed the same' : r > 0 ? `rose ${(r * 100).toFixed(1)} %` : `fell ${(-r * 100).toFixed(1)} %`)
  const out: string[] = []
  for (const c of changes) {
    switch (c.key) {
      case 'resistance':
        out.push(`R ${c.direction > 0 ? 'increased' : 'decreased'}: Vdc ${word(d('voutAvg'))} — the rectifier output is set by the source and the conducting devices, not by R — while Idc = Vdc/R ${word(d('ioAvg'))}.`)
        break
      case 'vrms':
        out.push(`Source voltage ${c.direction > 0 ? 'increased' : 'decreased'}: every output voltage scales with Vm (Vdc ${word(d('voutAvg'))}); the diode drop Vf does not scale, so the change is slightly ${c.direction > 0 ? 'more' : 'less'} than proportional for a real diode.`)
        break
      case 'frequency':
        out.push(`Frequency ${c.direction > 0 ? 'increased' : 'decreased'}: the ripple frequency (pulses × f) ${word(d('rippleFrequency'))}. Vdc ${word(d('voutAvg'))} — for an R load the average does not depend on f. With L or C, their reactance changes (XL = ωL, XC = 1/ωC), so the ripple ${word(d('ripplePP'))}.`)
        break
      case 'inductance':
        out.push(`L ${c.direction > 0 ? 'increased' : 'decreased'}: the inductor opposes changes of current (v = L·di/dt), so the current ripple ${word(d('ioRipplePP'))}. ${threePhase ? 'For an uncontrolled bridge Vdc ' + word(d('voutAvg')) + ' — the output voltage is fixed by which phases conduct, not by the load.' : 'Vdc ' + word(d('voutAvg')) + '.'}`)
        break
      case 'capacitance':
        out.push(`C ${c.direction > 0 ? 'increased' : 'decreased'}: the capacitor holds the output up longer between charging pulses (time constant RC), so the ripple ${word(d('ripplePP'))} and Vdc ${word(d('voutAvg'))}; the charging pulses get ${c.direction > 0 ? 'shorter and taller' : 'longer and lower'}.`)
        break
      case 'vf':
      case 'model':
        out.push(`Diode drop changed: every conducting path loses Vf${threePhase ? ' (a bridge path has two devices: 2·Vf)' : ''}, so Vdc ${word(d('voutAvg'))}.`)
        break
      case 'ron':
        out.push(`Ron changed: the devices now drop Ron·i as well, which grows with the current — Vdc ${word(d('voutAvg'))} and efficiency ${word(d('efficiency'))}.`)
        break
      case 'alpha':
        out.push(`Firing angle α ${c.direction > 0 ? 'increased' : 'decreased'}: each SCR is fired ${c.direction > 0 ? 'later' : 'earlier'}, so the output uses a ${c.direction > 0 ? 'later (lower)' : 'earlier (higher)'} part of each line voltage — Vdc ${word(d('voutAvg'))} (∝ cos α in continuous conduction).`)
        break
      case 'device':
        out.push(`Devices changed: SCRs only start when fired. With α = 0 they behave like diodes; with α > 0 the output is delayed — Vdc ${word(d('voutAvg'))}.`)
        break
      case 'freewheel':
        out.push(`Freewheeling diode ${c.after === 'yes' ? 'added' : 'removed'}: it ${c.after === 'yes' ? 'stops the output from going negative — the inductor current circulates through it instead of through the source' : 'no longer clamps the output'}; Vdc ${word(d('voutAvg'))}.`)
        break
      case 'sequence':
        out.push(`Phase sequence reversed: the order in which the phases peak changes, so the devices conduct in the reverse order — but the bridge still connects the load between the highest and lowest phase, so Vdc ${word(d('voutAvg'))} and the ripple frequency ${word(d('rippleFrequency'))}.`)
        break
      case 'ls':
        out.push(`Source inductance ${c.direction > 0 ? 'added/increased' : 'reduced'}: current cannot transfer instantly between phases, so during each commutation two phases are briefly shorted through the devices (overlap angle μ). The output loses a notch each time — Vdc ${word(d('voutAvg'))}.`)
        break
      case 'rs':
        out.push(`Source resistance changed: the load current now drops voltage in the supply, so Vdc ${word(d('voutAvg'))}.`)
        break
      case 'fault':
        out.push(faultWhy(c.after, d))
        break
      case 'circuit':
        out.push(`Circuit changed from ${c.before} to ${c.after}: the number of pulses per cycle changed, so the ripple frequency ${word(d('rippleFrequency'))} and Vdc ${word(d('voutAvg'))}.`)
        break
    }
  }
  return out
}

function faultWhy(after: string, d: (k: keyof Measurements) => number | null): string {
  const w = (r: number | null) => (r === null ? 'changed' : Math.abs(r) < 0.005 ? 'stayed the same' : r > 0 ? `rose ${(r * 100).toFixed(1)} %` : `fell ${(-r * 100).toFixed(1)} %`)
  if (after === 'none') return `Fault cleared: the rectifier is healthy again — Vdc ${w(d('voutAvg'))}, ripple frequency ${w(d('rippleFrequency'))}.`
  if (after.includes('open')) return `An open device can never conduct: whenever its phase should take over, the next-best phase must carry the current instead, so two of the six pulses come from a lower line voltage. Vdc ${w(d('voutAvg'))}; the output now repeats only once per cycle (ripple frequency ${w(d('rippleFrequency'))}) — a classic symptom when troubleshooting.`
  if (after.includes('short')) return `A shorted device conducts in BOTH directions: when its phase is not the highest, current flows backwards through it from the + rail into its phase — a phase-to-phase short circuit through the other devices. Look at its current going negative and the large fault currents. Vdc ${w(d('voutAvg'))}.`
  if (after.includes('missing')) return `With one phase disconnected, the bridge can only use the remaining line voltage: it behaves like a single-phase bridge, 2 pulses per cycle instead of 6 (ripple frequency ${w(d('rippleFrequency'))}), Vdc ${w(d('voutAvg'))}, and the ripple ${w(d('ripplePP'))}.`
  if (after.includes('Vf')) return `A device with a higher Vf drops more voltage only during its own conduction interval, so those pulses are slightly lower: Vdc ${w(d('voutAvg'))}; the waveform loses its six-fold symmetry.`
  return `Unequal phase amplitudes: the weaker phase becomes the highest (or lowest) for a shorter time, so its devices conduct less than 120° and the pulses are no longer equal. Vdc ${w(d('voutAvg'))}; ripple frequency ${w(d('rippleFrequency'))}.`
}
