import type { SimulationResult } from '../types/simulation.ts'
import { formatA, formatDeg, formatV } from '../utils/format.ts'
import type { StateExplanation } from './rectifier.ts'
import { DEVICE_MAP } from './threePhase.ts'

/**
 * Short forms of the explanation for progressive disclosure: the five-step "WHY?" and the
 * "current path" card. They only re-arrange values the explanation engine already read from
 * the simulation — nothing here computes physics.
 */

export interface WhyStep {
  title: string
  lines: string[]
}

const UP = (q: string) => q.toUpperCase()
const firstSentence = (t: string) => {
  const m = t.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : t).trim()
}

/** Conducting devices with their display names, phases and currents. */
function conducting(ex: StateExplanation) {
  const names = ex.threePhase?.names ?? {}
  return ex.sample.diodes
    .filter((d) => d.on)
    .map((d) => ({ id: d.id, name: names[d.id] ?? d.id, current: d.current, map: DEVICE_MAP[d.id] }))
}

/** "WHY IS THIS HAPPENING?" in five steps: source → decision → path → output → load. */
export function conciseWhy(result: SimulationResult, ex: StateExplanation): WhyStep[] {
  const s = ex.sample
  const tp = ex.threePhase
  const fi = ex.freewheel
  const on = conducting(ex)
  const steps: WhyStep[] = []

  // 1 · Source
  if (tp) {
    steps.push({
      title: 'Phase voltages',
      lines: [`Va = ${formatV(tp.phases.a)}`, `Vb = ${formatV(tp.phases.b)}`, `Vc = ${formatV(tp.phases.c)}`, `Highest: ${UP(tp.order[0])} · lowest: ${UP(tp.order[2])}`],
    })
  } else {
    steps.push({ title: 'Source', lines: [`vin = ${formatV(s.vin)} at θ = ${formatDeg(ex.angleDeg)}`, ex.source.polarity === 'zero' ? 'crossing zero' : `${ex.source.polarity} half-cycle`] })
  }

  // 2 · Device decision
  const decision: string[] = []
  if (tp) {
    const up = on.filter((d) => d.map?.upper)
    const lo = on.filter((d) => d.map && !d.map.upper)
    for (const d of up) decision.push(`${d.name} (upper, phase ${UP(d.map!.phase)}): ${d.map!.phase === tp.order[0] ? 'phase ' + UP(d.map!.phase) + ' is the highest' : 'not the highest phase — still latched / handing over'}`)
    for (const d of lo) decision.push(`${d.name} (lower, phase ${UP(d.map!.phase)}): ${d.map!.phase === tp.order[2] ? 'phase ' + UP(d.map!.phase) + ' is the lowest' : 'not the lowest phase — handing over'}`)
    if (tp.freewheeling) decision.push('Dfw: the load voltage tried to go below zero')
    if (!on.length) decision.push('No device is forward biased (and fired) right now')
    decision.push(`Therefore: ${tp.pairLabel === 'none' ? 'nothing' : tp.pairLabel.replace(' & ', ' + ')} conduct${on.length === 1 ? 's' : ''}`)
  } else if (fi) {
    decision.push(`D1 ${fi.d1.on ? 'ON' : 'OFF'} (vD1 = ${formatV(fi.d1.voltage)})`, `Dfw ${fi.fw.on ? 'ON' : 'OFF'} (vDfw = ${formatV(fi.fw.voltage)})`, firstSentence(fi.why[0] ?? ''))
  } else {
    const cond = ex.chain.find((c) => c.stage === 'condition')?.text ?? ''
    decision.push(on.length ? `${on.map((d) => d.name).join(' + ')} ON` : 'All diodes OFF', firstSentence(cond))
  }
  steps.push({ title: tp && (result.params.control.device === 'scr' || result.params.topology === '3ph-half-controlled') ? 'Device decision' : 'Diode decision', lines: decision.filter(Boolean) })

  // 3 · Current path
  steps.push({ title: 'Current path', lines: [ex.path ? ex.path.join(' → ') : 'No closed path — no current'] })

  // 4 · Output voltage
  if (tp) {
    steps.push({ title: 'Output voltage', lines: [`${tp.outputRelation}`, `Vo = ${formatV(s.vout)}`] })
  } else {
    steps.push({ title: 'Output voltage', lines: [firstSentence(ex.output.text), `Vo = ${formatV(s.vout)}`] })
  }

  // 5 · Load response
  const load = result.params.load
  steps.push({
    title: 'Load response',
    lines: [
      `Io = ${formatA(s.io)}${ex.current.trend !== 'zero' ? ` · ${ex.current.trend}` : ''}`,
      load === 'R' ? 'A resistor follows the voltage instantly (Io = Vo/R)' : load === 'RL' ? 'The inductor smooths the current (it cannot change instantly)' : load === 'RC' ? 'The capacitor holds the output voltage up' : 'L smooths the current, C holds the voltage',
    ],
  })
  return steps
}

export interface PathView {
  nodes: string[] | null
  /** "Why this path?" — one line per reason, with simulated values. */
  reasons: string[]
}

/** The current path at the cursor and why the current takes it. */
export function pathView(result: SimulationResult, ex: StateExplanation): PathView {
  const s = ex.sample
  const tp = ex.threePhase
  const fi = ex.freewheel
  const on = conducting(ex)
  const reasons: string[] = []
  if (tp) {
    const ph = (q: 'a' | 'b' | 'c') => `V${q} = ${formatV(tp.phases[q])}`
    for (const d of on) {
      if (!d.map) continue
      const hi = d.map.upper ? tp.order[0] : tp.order[2]
      reasons.push(
        d.map.phase === hi
          ? `V${d.map.phase} is the ${d.map.upper ? 'highest' : 'lowest'} ${result.params.topology === '3ph-half-wave' ? '' : 'eligible '}phase (${ph(d.map.phase)}) → ${d.name} conducts`
          : `${d.name} (phase ${UP(d.map.phase)}) still conducts although phase ${UP(hi)} is now ${d.map.upper ? 'higher' : 'lower'} — ${result.params.control.device === 'scr' || result.params.topology === '3ph-half-controlled' ? 'the next SCR has not been fired yet, or the current is handing over' : 'the current is handing over'}`,
      )
    }
    if (tp.freewheeling) reasons.push('The load tried to drive Vo below zero, so the freewheeling diode carries the load current')
    if (on.length >= 2 || tp.freewheeling) reasons.push(`This connects the load as ${tp.outputRelation} → Vo = ${formatV(s.vout)}`)
  } else if (fi) {
    reasons.push(...fi.why.slice(0, fi.mode === 'freewheel' ? 5 : 2).map(firstSentence))
  } else {
    const cond = ex.chain.find((c) => c.stage === 'condition')?.text ?? ''
    if (on.length) reasons.push(`${on.map((d) => d.name).join(' + ')} forward biased`, firstSentence(cond))
    else reasons.push(firstSentence(cond))
    reasons.push(firstSentence(ex.current.text))
  }
  if (!ex.path) reasons.push(`Io = ${formatA(s.io)}`)
  return { nodes: ex.path, reasons: reasons.filter(Boolean) }
}

/** One-line operating state for the state strip, e.g. "T1 + D2 conducting". */
export function stateLine(ex: StateExplanation): string {
  if (ex.threePhase) {
    const p = ex.threePhase.pairLabel
    return p === 'none' ? 'No device conducting' : `${p.replace(/ & /g, ' + ')} conducting`
  }
  if (ex.freewheel) return ex.freewheel.mode === 'freewheel' ? 'Dfw conducting (freewheeling)' : ex.freewheel.mode === 'source' ? 'D1 conducting' : ex.freewheel.mode === 'overlap' ? 'D1 + Dfw conducting (hand-over)' : 'No diode conducting'
  const on = ex.diodes.filter((d) => d.on).map((d) => d.id)
  return on.length ? `${on.join(' + ')} conducting` : 'No diode conducting'
}
