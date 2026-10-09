import { deviceName } from '../circuits/devices.ts'
import type { NextConsequence, StatusInfo, WhyQuestion } from '../workspace/contract.ts'
import { sineSource } from '../simulation/source.ts'
import type { CircuitEvent, SimulationResult } from '../types/simulation.ts'
import { formatA, formatDeg, formatTime, formatV } from '../utils/format.ts'
import { stateLine } from './concise.ts'
import { getExplainer } from './index.ts'
import { eventTitle, type StateExplanation } from './rectifier.ts'

/*
 * Workspace-shell wording for the rectifier: the status line and the WHY "next consequence".
 * Wording only — every value, state and instant is read from the simulation result.
 */

/**
 * Status line at the cursor: the conducting devices, then what that means (the explainer's own words), and
 * — when `values` — Vo and Io at this sample. θ and the time are shown beside it by the workspace.
 */
export function rectifierStatus(ex: StateExplanation, _result: SimulationResult, values = false): StatusInfo {
  const s = ex.sample
  const headline = stateLine(ex)
  const conducting = !/^No (device|diode) conducting/.test(headline)
  const meaning = ex.headline.includes(' — ') ? ex.headline.split(' — ').slice(1).join(' — ') : ''
  return {
    headline,
    facts: [...(meaning ? [meaning] : []), ...(values ? [`Vo = ${formatV(s.vout)}`, `Io = ${formatA(s.io)}`] : [])],
    tone: conducting ? 'on' : 'idle',
  }
}

/** "t = 5.000 ms · θ = 90.0°" for the status line. */
export const rectifierTime = (ex: StateExplanation) => `t = ${formatTime(ex.sample.time)} · θ = ${formatDeg(ex.angleDeg)}`

/**
 * WHY at the cursor, in four parts, from the explainer's own causal chain at this sample:
 *   what = its summary · why = its circuit condition (or the inductor / freewheel step) ·
 *   principle = the equation of that step, else the rule of the simulated device state.
 */
export function rectifierWhy(result: SimulationResult, ex: StateExplanation): WhyQuestion {
  const by = (stage: string) => ex.chain.find((c) => c.stage === stage)
  const fwOn = ex.freewheel?.mode === 'freewheel'
  const cause = (fwOn ? (by('inductor') ?? by('freewheel')) : undefined) ?? by('condition') ?? by('diode') ?? by('freewheel')
  const withEq = [cause, by('diode'), by('freewheel'), by('inductor'), by('output')].find((c) => c?.equation)
  const anyOn = ex.diodes.some((d) => d.on)
  const scrOn = !!ex.firing && ex.firing.scrs.some((x) => x.on)
  const waiting = /waiting for its gate/.test(ex.headline)
  const hasC = result.params.load === 'RC' || result.params.load === 'RLC'
  // The rule of the SIMULATED state in words; its equation from the explainer's chain when it has one.
  const rule = fwOn
    ? { principle: 'An inductor will not let its current change instantly (vL = L·di/dt). With the source cut off, the freewheeling diode gives that current a path around the load.', equation: 'vL = L·di/dt   ⇒   i cannot jump' }
    : waiting
      ? { principle: 'An SCR conducts only when it is forward biased AND has received a gate pulse; once ON it stays ON while its current flows.', equation: 'SCR ON: vAK > 0 AND gate pulse; latched while i > 0' }
      : scrOn
        ? { principle: 'A fired SCR conducts like a diode and stays ON until its current falls to zero.', equation: 'SCR ON: forward biased AND fired; then latched while i > 0' }
        : anyOn
          ? { principle: 'A diode conducts when it is forward biased (its anode above its cathode by Vf) and blocks when it is reverse biased.', equation: 'ON: iD > 0     OFF: vD ≤ Vf' }
          : hasC
            ? { principle: 'With every device blocking, only the capacitor can supply the load: it discharges through R.', equation: 'iC = −Vo / R' }
            : { principle: 'With every device reverse biased there is no closed path, so no current flows and the output is zero.', equation: 'io = 0' }
  const principle = { principle: rule.principle, equation: withEq?.equation ?? rule.equation }
  // short by default: the first sentence of the cause; the rest (e.g. every other device) under "More detail"
  const causeText = cause?.text ?? ex.headline
  const why = firstSentence(causeText)
  const rest = causeText.slice(why.length).trim()
  const more = [...(rest ? [rest] : []), ...[by('source'), by('path'), by('output')].filter((c): c is NonNullable<typeof c> => !!c && c !== cause).map((c) => `${c.title}: ${c.text}`)]
  return { id: 'now', question: 'Why is the circuit doing this now?', what: ex.summary, why, principle: principle.principle, equation: principle.equation, more }
}

/** Device events that change what conducts (source-only markers such as Vin peaks are skipped). */
const DEVICE_KINDS: ReadonlySet<CircuitEvent['kind']> = new Set(['diode-on', 'diode-off', 'current-start', 'current-stop', 'current-transfer', 'commutation-start', 'commutation-end'])

const firstSentence = (t: string) => {
  const m = t.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : t).trim()
}

/**
 * The next consequence after the cursor, from the run itself: the next SCR gate pulse in the simulated
 * gate trace, or the next device event. Null when the run has no such instant after the cursor — nothing
 * is extrapolated.
 */
export function rectifierNextConsequence(result: SimulationResult, ex: StateExplanation): NextConsequence | null {
  const p = result.params
  const tr = result.trace
  const k0 = ex.sample.index
  const after = ex.sample.time + 0.5 * p.dt
  const names = ex.threePhase?.names ?? ex.names
  const src = sineSource(p)
  const at = (t: number) => `t = ${formatTime(t)} (θ = ${formatDeg(src.angleDeg(t))})`

  const ev = result.events.filter((e) => e.time > after && DEVICE_KINDS.has(e.kind)).sort((a, b) => a.time - b.time)[0]

  // the next gate pulse that reaches a blocking SCR (rising edge of the simulated gate signal);
  // SCRs pulsed at the same sample (e.g. T1 and T4 of a bridge) are reported together
  let gk = -1
  let gated: typeof tr.diodes = []
  for (const d of tr.diodes) {
    if (!d.gate) continue
    for (let k = Math.max(k0 + 1, 1); k < tr.length && (gk < 0 || k <= gk); k++) {
      if (d.gate[k] && !d.gate[k - 1] && !d.on[k - 1]) {
        if (gk < 0 || k < gk) (gk = k), (gated = [d])
        else if (k === gk) gated.push(d)
        break
      }
    }
  }
  if (gk > 0 && (!ev || tr.time[gk] <= ev.time + 2 * p.dt)) {
    const end = Math.min(tr.length - 1, gk + 3)
    const fires = (d: (typeof tr.diodes)[number]) => {
      for (let k = gk; k <= end; k++) if (d.on[k]) return true
      return false
    }
    const list = (ds: typeof gated) => ds.map((d) => deviceName(p, d.id)).join(' and ')
    const on = gated.filter(fires)
    const off = gated.filter((d) => !fires(d))
    const t = at(tr.time[gk])
    const parts: string[] = []
    const time = tr.time[gk]
    if (on.length)
      parts.push(
        `${list(on)} ${on.length > 1 ? 'receive their gate pulses' : 'receives its gate pulse'} at ${t} while forward biased, so ${on.length > 1 ? 'they turn' : 'it turns'} ON and ${on.length > 1 ? 'start' : 'starts'} carrying the load current.`,
      )
    if (off.length) parts.push(`${list(off)} ${off.length > 1 ? 'receive gate pulses' : 'receives a gate pulse'} at ${t} but ${off.length > 1 ? 'stay' : 'stays'} OFF: not forward biased at that instant.`)
    return { text: parts.join(' '), time }
  }
  if (!ev) return null
  const why = firstSentence(getExplainer(result.circuitId).event(result, ev).why)
  return { text: `${eventTitle(ev, names)} at ${at(ev.time)}.${why ? ` ${why}` : ''}`, time: ev.time }
}

/** The next consequence in words (see rectifierNextConsequence for its time). */
export function rectifierNext(result: SimulationResult, ex: StateExplanation): string | null {
  return rectifierNextConsequence(result, ex)?.text ?? null
}
