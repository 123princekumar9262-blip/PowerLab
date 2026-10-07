import type { StateExplanation } from '../explanations/rectifier.ts'
import { DEVICE_MAP } from '../explanations/threePhase.ts'
import { pathView } from '../explanations/concise.ts'
import type { Measurements } from '../measurements/measurements.ts'
import { sineSource, threePhaseSource, type Phase } from '../simulation/source.ts'
import { isThreePhase, type SimulationResult } from '../types/simulation.ts'
import { formatA, formatCapacitance, formatDeg, formatSI, formatV, formatW } from '../utils/format.ts'

/**
 * Inspect mode: what a component is doing right now, and over the last cycle. Every value is
 * read from the simulation trace at the cursor (or measured over the last full cycle).
 */
export interface Inspection {
  title: string
  kind: string
  rows: Array<[string, string]>
  why?: string
}

export function inspectPart(result: SimulationResult, ex: StateExplanation, m: Measurements, part: string): Inspection | null {
  const p = result.params
  const s = ex.sample
  const x = s.values
  const { trace } = result
  const n = trace.length
  const k0 = Math.max(0, n - 1 - Math.round(p.period / p.dt))

  // ── Devices ─────────────────────────────────────────────────────────────────
  const di = result.diodeIds.indexOf(part as never)
  if (di >= 0) {
    const tr = trace.diodes[di]
    const d = s.diodes[di]
    const name = ex.threePhase?.names[part] ?? part
    const scr = tr.gate !== undefined
    let onCount = 0
    let peakI = 0
    let sumI = 0
    let piv = 0
    for (let k = k0; k < n; k++) {
      if (tr.on[k]) onCount++
      peakI = Math.max(peakI, tr.current[k])
      sumI += tr.current[k]
      piv = Math.max(piv, -tr.voltage[k])
    }
    const N = n - k0
    const vf = p.diode.vf
    const map = DEVICE_MAP[part]
    const rows: Array<[string, string]> = [
      ['State', d.on ? 'ON — conducting' : 'OFF — blocking'],
      ['Bias', d.on ? 'forward' : d.bias === 'reverse' ? 'reverse' : d.bias === 'forward-below-threshold' ? 'forward, below Vf' : 'zero'],
      ['Current', formatA(d.current)],
      ['Voltage vAK', formatV(d.voltage)],
    ]
    if (scr) rows.push(['Gate pulse', tr.gate![s.index] ? 'applied' : 'not applied'])
    if (map && isThreePhase(p.topology)) rows.push(['Phase', `${map.phase.toUpperCase()} · ${map.upper ? 'upper (to + rail)' : 'lower (from − rail)'}`])
    rows.push(['Conduction per cycle', `${((onCount / N) * 360).toFixed(1)}°`], ['Average current', formatA(sumI / N)], ['Peak current', formatA(peakI)], ['Peak reverse voltage', formatV(piv, false)])
    let why: string
    if (part === 'Dfw' && ex.freewheel) why = ex.freewheel.why.slice(0, 2).join(' ')
    else if (d.on) {
      // The one reason that concerns this device (three-phase), or the circuit condition.
      const own = ex.threePhase ? pathView(result, ex).reasons.find((r) => r.includes(name)) : undefined
      const reason = own ?? (ex.chain.find((c) => c.stage === 'condition' || c.stage === 'diode')?.text ?? '').split(/(?<=\.)\s/)[0]
      why = `Why ON? It carries forward current (${formatA(d.current)} > 0), which is only possible while its anode is above its cathode by Vf${scr ? ' and after its gate has fired it' : ''}. ${reason}${own ? '.' : ''}`
    } else
      why = `Why OFF? Its voltage is ${formatV(d.voltage)} — ${d.voltage < 0 ? 'reverse biased' : d.voltage <= vf ? `not above Vf = ${formatSI(vf, 'V')}` : 'forward biased, but an SCR waits for its gate pulse'} — so it cannot carry current.`
    return { title: `${name} — ${part === 'Dfw' ? 'freewheeling diode' : scr ? 'SCR' : 'diode'}`, kind: 'device', rows, why }
  }

  // ── Load elements ────────────────────────────────────────────────────────────
  const io = s.io
  if (part === 'R') {
    return {
      title: 'R — load resistor',
      kind: 'load',
      rows: [
        ['Resistance', formatSI(p.resistance, 'Ω')],
        ['Voltage', formatV(io * p.resistance)],
        ['Current', formatA(io)],
        ['Power now', formatW(x.pload ?? io * io * p.resistance)],
        ['Average power (cycle)', formatW(m.loadPower)],
        ['RMS current (cycle)', formatA(m.ioRms)],
      ],
      why: 'A resistor turns every watt it receives into heat: p = R·i² ≥ 0 at every instant.',
    }
  }
  if (part === 'L') {
    const il = x.il ?? io
    return {
      title: 'L — inductor',
      kind: 'load',
      rows: [
        ['Inductance', formatSI(p.inductance, 'H')],
        ['Current', formatA(il)],
        ['Voltage vL = L·di/dt', formatV(x.vl ?? 0)],
        ['Stored energy ½·L·i²', formatSI(x.wl ?? 0.5 * p.inductance * il * il, 'J')],
        ['Power vL·i', `${formatW(Math.abs((x.vl ?? 0) * il))} ${(x.vl ?? 0) * il >= 0 ? 'stored' : 'released'}`],
        ...(m.wlMax !== null ? ([['Max stored (cycle)', formatSI(m.wlMax, 'J')]] as Array<[string, string]>) : []),
      ],
      why: 'Its current cannot change instantly: it builds up a voltage L·di/dt that opposes any change, storing energy when the current rises and releasing it when it falls.',
    }
  }
  if (part === 'C') {
    const vC = s.vout
    return {
      title: 'C — capacitor',
      kind: 'load',
      rows: [
        ['Capacitance', formatCapacitance(p.capacitance)],
        ['Voltage', formatV(vC)],
        ['Current (+ = charging)', formatA(x.ic ?? 0, true)],
        ['Stored energy ½·C·v²', formatSI(x.wc ?? 0.5 * p.capacitance * vC * vC, 'J')],
        ['Ripple (cycle)', formatV(m.ripplePP, false)],
      ],
      why: 'Its voltage cannot change instantly: it charges while the source can push current in, and holds the output up while the diodes block.',
    }
  }

  // ── Sources ──────────────────────────────────────────────────────────────────
  if (part.startsWith('phase-') && isThreePhase(p.topology)) {
    const q = part.slice(6) as Phase
    const src = threePhaseSource(p)
    const v = q === 'a' ? (x.vin ?? 0) : q === 'b' ? (x.vb ?? 0) : (x.vc ?? 0)
    const order = ex.threePhase?.order ?? []
    return {
      title: `Phase ${q.toUpperCase()}`,
      kind: 'source',
      rows: [
        ['Voltage to neutral', formatV(v)],
        ['RMS', formatSI(p.vrms, 'V')],
        ['Peak Vm', formatV(p.vm, false)],
        ['Phase angle', formatDeg(src.phaseAngleDeg(q, s.time))],
        ['Rank now', order[0] === q ? 'highest' : order[2] === q ? 'lowest' : 'middle'],
        ['Frequency', `${p.frequency} Hz`],
      ],
      why: p.faults.missingPhase === q ? 'This phase conductor is disconnected (fault).' : 'Its devices conduct while it is the highest (upper) or lowest (lower) phase.',
    }
  }
  if (part === 'source') {
    return {
      title: 'Source',
      kind: 'source',
      rows: [
        ['Voltage vin', formatV(s.vin)],
        ['RMS', formatSI(p.vrms, 'V')],
        ['Peak Vm', formatV(p.vm, false)],
        ['Angle θ', formatDeg(sineSource(p).angleDeg(s.time))],
        ['Frequency', `${p.frequency} Hz`],
        ['Power delivered now', formatW(x.ps ?? 0)],
      ],
      why: 'A sinusoidal source: vin = Vm·sin(ωt + φ). It can only push current forward through a diode during part of each cycle.',
    }
  }
  return null
}
