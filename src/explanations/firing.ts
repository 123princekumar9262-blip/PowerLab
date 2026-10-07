import { deviceName, isScrDevice } from '../circuits/devices.ts'
import { indexAtTime } from '../simulation/engine.ts'
import { sineSource, threePhaseSource } from '../simulation/source.ts'
import { isThreePhase, type DiodeId, type SimulationResult, type SimulationSample } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatV } from '../utils/format.ts'

/**
 * SCR firing explanations, read from the simulation: each SCR's state, gate, voltage and
 * current at the cursor, and the instant it last turned ON (with the conditions at that
 * moment). Generic over every circuit whose devices have gates.
 */
export type ScrState = 'conducting' | 'latched' | 'blocking-forward' | 'reverse' | 'gated-not-forward' | 'zero'

export interface ScrInfo {
  id: DiodeId
  name: string
  on: boolean
  gate: boolean
  voltage: number
  current: number
  state: ScrState
  text: string
}

export interface FiringInsight {
  alphaDeg: number
  scrs: ScrInfo[]
  /** "Why is the SCR OFF?" — one paragraph per OFF SCR (empty if all conduct). */
  whyOff: string[]
  /** "Why did it turn ON now?" — the most recent SCR turn-on before the cursor. */
  whyOn: string[]
  /** One-line state for headlines, e.g. "T1 forward biased, waiting for its gate". */
  short: string
}

export function firingInsight(result: SimulationResult, s: SimulationSample): FiringInsight | null {
  const p = result.params
  const ids = result.diodeIds.filter((id) => isScrDevice(p, id))
  if (!ids.length) return null
  const alphaDeg = (p.control.alpha * 180) / Math.PI
  const vf = p.diode.vf
  const angle = isThreePhase(p.topology) ? threePhaseSource(p).angleDeg : sineSource(p).angleDeg
  const θ = formatDeg(angle(s.time))
  const scrs: ScrInfo[] = ids.map((id) => {
    const k = result.diodeIds.indexOf(id)
    const d = s.diodes[k]
    const gate = result.trace.diodes[k].gate?.[s.index] === 1
    const name = deviceName(p, id)
    let state: ScrState
    let text: string
    if (d.on && gate) {
      state = 'conducting'
      text = `${name} is ON: it is forward biased and its gate pulse is applied, carrying ${formatA(d.current)}.`
    } else if (d.on) {
      state = 'latched'
      text = `${name} is ON without a gate pulse: an SCR latches — once fired it keeps conducting as long as its current (${formatA(d.current)}) stays above zero.`
    } else if (d.voltage > vf && !gate) {
      state = 'blocking-forward'
      text = `${name} is OFF although it is forward biased (vAK = ${formatV(d.voltage)}): an SCR blocks forward voltage until its gate is fired. Its pulse comes α = ${formatDeg(alphaDeg)} after its natural point.`
    } else if (gate && d.voltage <= vf) {
      state = 'gated-not-forward'
      text = `${name} has its gate pulse applied but is ${d.voltage < 0 ? 'reverse biased' : 'not forward biased beyond Vf'} (vAK = ${formatV(d.voltage)}): a gate cannot turn on an SCR whose anode is not above its cathode.`
    } else if (d.voltage < 0) {
      state = 'reverse'
      text = `${name} is OFF and reverse biased (vAK = ${formatV(d.voltage)}): it cannot conduct, with or without a gate pulse.`
    } else {
      state = 'zero'
      text = `${name} is OFF: vAK = ${formatV(d.voltage)} is not above Vf = ${formatSI(vf, 'V')}.`
    }
    return { id, name, on: d.on, gate, voltage: d.voltage, current: d.current, state, text }
  })

  const off = scrs.filter((x) => !x.on)
  const whyOff = off.map((x) => {
    // When this SCR conducted last, and how that ended (natural extinction or commutation).
    const offEv = result.events.filter((e) => e.device === x.id && e.kind === 'diode-off' && e.time <= s.time).pop()
    const tail = offEv
      ? ` It last turned OFF at θ = ${formatDeg(angle(offEv.time))}${Math.abs(offEv.values.io ?? 0) < 1e-6 ? ' when the load current fell to zero (natural extinction)' : ', when another device took over the current (commutation)'}.`
      : ''
    return `θ = ${θ}: ${x.text}${tail}`
  })

  // Most recent SCR turn-on at or before the cursor.
  const onEv = result.events.filter((e) => e.kind === 'diode-on' && e.device && ids.includes(e.device) && e.time <= s.time + 1e-12).pop()
  const whyOn: string[] = []
  if (onEv) {
    const k = result.diodeIds.indexOf(onEv.device!)
    const name = deviceName(p, onEv.device!)
    const before = Math.max(0, indexAtTime(result, onEv.time) - 1)
    const vBefore = result.trace.diodes[k].voltage[before]
    const gate = result.trace.diodes[k].gate
    const gateStart = (() => {
      if (!gate) return null
      let j = before
      while (j > 0 && gate[j - 1] === 1) j--
      return gate[j] === 1 ? result.trace.time[j] : null
    })()
    const firedByGate = gateStart !== null && Math.abs(gateStart - onEv.time) < 2 * p.dt
    whyOn.push(
      `${name} turned ON at θ = ${formatDeg(angle(onEv.time))} (t = ${formatSI(onEv.time, 's')}).`,
      `Source polarity: ${isThreePhase(p.topology) ? `VaN = ${formatV(onEv.values.vin ?? 0)}` : `vin = ${formatV(onEv.values.vin ?? 0)}`}.`,
      `Just before, ${name} had vAK = ${formatV(vBefore)} — ${vBefore > vf ? `forward biased (above Vf = ${formatSI(vf, 'V')})` : 'not yet forward biased'}.`,
      firedByGate
        ? `Its gate pulse started at that instant (α = ${formatDeg(alphaDeg)} after the natural point), so the forward-biased SCR was triggered and latched.`
        : `Its gate pulse was already applied (it started at θ = ${gateStart !== null ? formatDeg(angle(gateStart)) : '—'}); the SCR fired as soon as it became forward biased.`,
      `Previous state: ${Math.abs(onEv.values.io ?? 0) > 1e-9 ? `load current ${formatA(onEv.values.io ?? 0)} was flowing through other devices — it transferred to ${name}` : 'no load current — conduction started from zero'}.`,
    )
  }
  const firstOff = off[0]
  const short = !off.length ? 'all SCRs conducting' : firstOff.state === 'blocking-forward' ? `${firstOff.name} forward biased, waiting for its gate` : `${firstOff.name} ${firstOff.state === 'reverse' ? 'reverse biased' : 'off'}`
  return { alphaDeg, scrs, whyOff, whyOn, short }
}
