import { indexAtTime, sampleAt } from '../simulation/engine.ts'
import { sineSource } from '../simulation/source.ts'
import type { CircuitEvent, DiodeBias, DiodeId, SimulationResult, SimulationSample } from '../types/simulation.ts'
import { deviceName } from '../circuits/devices.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import { explainEvent, explainState, type CausalStep, type EventExplanation, type StateExplanation } from './rectifier.ts'

/**
 * Freewheeling-diode explanations (half-wave rectifier + RL load + Dfw across the load).
 *
 * Everything here is read from the simulation: the diode states, currents and voltages at
 * the cursor, and — for "where did the energy go?" — the freewheel interval around the
 * cursor, located from the engine's switching events and integrated over the trace.
 * Text is assembled from that state; nothing is canned per instant, and every claim is
 * conditional on what the simulation actually shows.
 */

export type FreewheelMode = 'source' | 'freewheel' | 'overlap' | 'off'

/** One freewheel interval (Dfw conducting), measured from the simulation. */
export interface FreewheelInterval {
  tOn: number
  /** End of the interval (Dfw turned off), or null if it was still conducting at the end of the run. */
  tOff: number | null
  /** How it ended: the current reached zero, or the rectifier ('D1' = any main device) took it back. */
  endedBy: 'zero' | 'D1' | null
  iStart: number
  iEnd: number
  wlStart: number
  wlEnd: number
  /** Energy turned into heat in R and lost in Dfw during the interval (∫p dt) [J]. */
  eR: number
  eDfw: number
}

export interface FreewheelInsight {
  mode: FreewheelMode
  modeLabel: string
  d1: { on: boolean; bias: DiodeBias; current: number; voltage: number }
  /** The main rectifier: which devices conduct and the current it delivers. */
  main: { label: string; on: boolean; current: number }
  fw: { on: boolean; bias: DiodeBias; current: number; voltage: number }
  il: number
  vl: number
  wl: number
  /** Power into the inductor, vL·iL (> 0 storing, < 0 releasing) [W]. */
  pL: number
  pR: number
  pDfw: number
  energyTrend: 'storing' | 'releasing' | 'empty'
  energyText: string
  whyTitle: string
  /** "Why is the freewheeling diode ON / OFF?" — numbered, state-aware steps. */
  why: string[]
  /** The freewheel interval the cursor is in, or the last one before it (or the first one). */
  interval: FreewheelInterval | null
}

const V = (v: number) => formatV(v)

/** Freewheel intervals of the whole run, from the Dfw ON/OFF events. */
export function freewheelIntervals(result: SimulationResult): FreewheelInterval[] {
  const { trace, events, params: p } = result
  const k = trace.diodes.findIndex((d) => d.id === 'Dfw')
  if (k < 0) return []
  const fw = trace.diodes[k]
  const sw = events.filter((e) => e.device === 'Dfw' && (e.kind === 'diode-on' || e.kind === 'diode-off'))
  const wl = trace.signals.wl!
  const pl = trace.signals.pload!
  const out: FreewheelInterval[] = []
  for (let j = 0; j < sw.length; j++) {
    const on = sw[j]
    if (on.kind !== 'diode-on') continue
    const off = sw.slice(j + 1).find((e) => e.kind === 'diode-off') ?? null
    // Integrate from the refined switching instants (not the nearest samples): trapezoids
    // between the samples inside the interval plus the partial steps at both ends.
    const tEnd = off ? off.time : trace.time[trace.length - 1]
    const i0 = Math.min(trace.length - 1, Math.ceil(on.time / p.dt - 1e-9))
    const i1 = Math.max(i0, Math.min(trace.length - 1, Math.floor(tEnd / p.dt + 1e-9)))
    const pD = (i: number) => fw.voltage[i] * fw.current[i]
    let eR = (trace.time[i0] - on.time) * pl[i0] + (tEnd - trace.time[i1]) * pl[i1]
    let eDfw = (trace.time[i0] - on.time) * pD(i0) + (tEnd - trace.time[i1]) * pD(i1)
    for (let i = i0 + 1; i <= i1; i++) {
      const h = trace.time[i] - trace.time[i - 1]
      eR += 0.5 * h * (pl[i] + pl[i - 1])
      eDfw += 0.5 * h * (pD(i) + pD(i - 1))
    }
    const iEnd = off ? (off.values.io ?? 0) : (trace.signals.io![i1] ?? 0)
    // Ended by D1 taking over if D1 turned on at the same instant; otherwise the current died.
    const d1Back = off ? events.some((e) => e.device && e.device !== 'Dfw' && e.kind === 'diode-on' && Math.abs(e.time - off.time) < p.period * 1e-6) : false
    out.push({
      tOn: on.time,
      tOff: off?.time ?? null,
      endedBy: off ? (d1Back ? 'D1' : 'zero') : null,
      iStart: on.values.io ?? 0,
      iEnd,
      wlStart: on.values.wl ?? wl[i0],
      wlEnd: off ? (off.values.wl ?? wl[i1]) : wl[i1],
      eR,
      eDfw,
    })
  }
  return out
}

/** The interval containing time t, else the last one ending before t, else the first one. */
export function intervalNear(list: FreewheelInterval[], t: number): FreewheelInterval | null {
  const inside = list.find((x) => t >= x.tOn && (x.tOff === null || t <= x.tOff))
  if (inside) return inside
  const before = list.filter((x) => x.tOff !== null && x.tOff < t).pop()
  return before ?? list[0] ?? null
}

const cache = new WeakMap<SimulationResult, FreewheelInterval[]>()
const intervalsOf = (r: SimulationResult) => {
  let v = cache.get(r)
  if (!v) cache.set(r, (v = freewheelIntervals(r)))
  return v
}

export function freewheelInsight(result: SimulationResult, s: SimulationSample): FreewheelInsight {
  const p = result.params
  const x = s.values
  const L = p.inductance
  const R = p.resistance
  const vf = p.diode.vf
  const ideal = p.diode.kind === 'ideal'
  const nm = (id: DiodeId) => deviceName(p, id)
  const devs = s.diodes.filter((d) => d.id !== 'Dfw')
  const onMain = devs.filter((d) => d.on)
  const fw = s.diodes.find((d) => d.id === 'Dfw')!
  const d1 = devs[0]
  const io = x.io ?? 0
  // Inductor current: the load current for RL, the choke current for RLC.
  const il = x.il ?? (p.load === 'RL' ? io : 0)
  const vl = x.vl ?? 0
  const wl = x.wl ?? 0.5 * L * il * il
  const vin = x.vin ?? 0
  const vout = x.vout ?? 0
  const pL = vl * il
  const pR = x.pload ?? R * io * io
  const pDfw = fw.voltage * fw.current
  const mainOn = onMain.length > 0
  const mode: FreewheelMode = mainOn && fw.on ? 'overlap' : fw.on ? 'freewheel' : mainOn ? 'source' : 'off'
  const mainLabel = onMain.length ? onMain.map((d) => nm(d.id)).join(' + ') : devs.length === 1 ? nm(d1.id) : 'the rectifier devices'
  const irect = Math.max(0, il - fw.current)
  const interval = intervalNear(intervalsOf(result), s.time)
  const energyTrend = il <= 0 ? 'empty' : pL >= 0 ? 'storing' : 'releasing'
  const wlEq = `E_L = ½·L·i² = ½ × ${formatSI(L, 'H')} × (${formatA(il)})² = ${formatSI(wl, 'J')}`
  const scr = devs.some((d) => nm(d.id) !== d.id)
  const loadLoop = p.load === 'RLC' ? 'L → C ∥ R' : p.load === 'RL' ? 'L → R' : 'R'

  let energyText: string
  if (energyTrend === 'empty') energyText = `${wlEq}: the inductor holds no energy — there is no current to keep going.`
  else if (mode === 'freewheel')
    energyText = `${wlEq}, falling. The source is cut off, so L is the only supplier: it releases ${formatW(-pL)}, of which R turns ${formatW(pR)} into heat and Dfw loses ${formatW(pDfw)} (Vf·i${p.diode.ron > 0 ? ' + Ron·i²' : ''}).`
  else if (energyTrend === 'storing') energyText = `${wlEq}, rising. The source drives more current than flows now, so L absorbs ${formatW(pL)} into its magnetic field (vL = L·di/dt = ${V(vl)} > 0).`
  else energyText = `${wlEq}, falling. The source voltage is now below Vout + R·i, so the current falls and L gives back ${formatW(-pL)} (vL = ${V(vl)} < 0) — to R and back to the source.`

  // ── Why is Dfw ON / OFF? (main path → iL → E_L → continuity → bias → path → voltage) ──
  const why: string[] = []
  let whyTitle: string
  const mainOff = devs.map((d) => `${nm(d.id)}: vAK = ${V(d.voltage)}${d.voltage < 0 ? ' (reverse biased)' : d.voltage > vf && nm(d.id) !== d.id ? ' (forward biased but not fired)' : ''}`).join(', ')
  if (mode === 'freewheel' || mode === 'overlap') {
    whyTitle = 'Why is the freewheeling diode conducting?'
    why.push(
      mode === 'overlap'
        ? `1 · Main rectifier path: handing over — ${mainLabel} and Dfw both conduct for a moment around vin = ${V(vin)} (each path drops its own Vf${p.diode.ron > 0 ? ' + Ron·i, which splits the current' : ''}).`
        : `1 · Main rectifier path: OFF. vin = ${V(vin)} can no longer drive the load through the rectifier${scr ? ' (or the next SCR has not been fired yet)' : ''} — ${mainOff}. The rectifier current is 0 A.`,
      `2 · Inductor current: iL = ${formatA(il)} is still flowing.`,
      `3 · Inductor energy: ${wlEq}.`,
      `4 · Current continuity: the current through an ideal inductor cannot change instantaneously — dropping ${formatA(il)} to zero at once would need L·di/dt → −∞. Instead the inductor reverses its voltage (vL = L·di/dt = ${V(vl)}) and keeps pushing the current on.`,
      `5 · Freewheel diode forward bias: that pulls the + output below the − output, Vout = ${V(vout)}, so Dfw's anode is ${V(fw.voltage)} above its cathode${ideal ? '' : ` (= Vf = ${formatSI(vf, 'V')})`} — forward biased, conducting ${formatA(fw.current)}.`,
      `6 · Resulting current path: ${loadLoop} → Dfw → back to L — LOAD → FREEWHEEL DIODE → LOAD, without the source.` +
        (interval
          ? ` Since Dfw turned on (θ = ${formatDeg(sineSource(p).angleDeg(interval.tOn))}) E_L has fallen from ${formatSI(interval.wlStart, 'J')} to ${formatSI(wl, 'J')}: ${formatW(pR)} heats R, ${formatW(pDfw)} is lost in Dfw.`
          : ''),
      `7 · Resulting load voltage: Vout = −Vf${p.diode.ron > 0 ? ' − Ron·i' : ''} = ${V(vout)} (clamped by Dfw) instead of following the source.`,
    )
  } else if (mode === 'source') {
    whyTitle = 'Why is the freewheeling diode OFF?'
    why.push(
      `1 · Main rectifier path: ON — ${mainLabel} conduct${onMain.length > 1 ? '' : 's'} ${formatA(irect)} from the source; Vout = ${V(vout)}.`,
      `2 · Inductor current: iL = ${formatA(il)} flows through the rectifier — it needs no other path.`,
      `3 · Inductor energy: ${wlEq}, ${energyTrend === 'storing' ? 'being stored' : 'being given back'}.`,
      vout > -vf
        ? `4 · Dfw sits across the load with its anode on the − output, so its voltage is −Vout = ${V(fw.voltage)} — ${fw.voltage < 0 ? 'reverse biased' : `below its knee Vf = ${formatSI(vf, 'V')}`}. It blocks: i = 0 A.`
        : `4 · Dfw's voltage is −Vout = ${V(fw.voltage)}, not above Vf — it blocks: i = 0 A.`,
      interval
        ? `5 · Dfw will take over when the rectifier can no longer hold Vout above −Vf (vin near or below zero${scr ? ', before the next SCR is fired' : ''}).`
        : `5 · In this run the current dies out before the source reverses, so Dfw never gets to conduct.`,
    )
  } else {
    whyTitle = 'Why is the freewheeling diode OFF?'
    why.push(
      `1 · Main rectifier path: OFF — ${mainOff}.`,
      `2 · Inductor current: iL = 0 — nothing is left to push through Dfw (E_L = 0).`,
      interval && interval.endedBy === 'zero' && s.time > interval.tOn
        ? `3 · The last freewheel interval ended at θ = ${formatDeg(sineSource(p).angleDeg(interval.tOff!))} when the current reached zero: the stored energy (${formatSI(interval.wlStart, 'J')}) had all been dissipated — ${formatSI(interval.eR, 'J')} in R and ${formatSI(interval.eDfw, 'J')} in Dfw. This is discontinuous conduction.`
        : `3 · The current starts again when the rectifier is forward biased${scr ? ' and fired' : ''}.`,
    )
  }

  const modeLabel = mode === 'freewheel' ? 'Freewheeling' : mode === 'source' ? 'Source supplying' : mode === 'overlap' ? 'Hand-over (both conduct)' : 'No current'
  return {
    mode,
    modeLabel,
    d1: { on: d1.on, bias: d1.bias, current: d1.current, voltage: d1.voltage },
    main: { label: mainLabel, on: mainOn, current: irect },
    fw: { on: fw.on, bias: fw.bias, current: fw.current, voltage: fw.voltage },
    il,
    vl,
    wl,
    pL,
    pR,
    pDfw,
    energyTrend,
    energyText,
    whyTitle,
    why,
    interval,
  }
}

/** Single-phase state explanation, specialised when a freewheeling diode is fitted. */
export function explainFreewheelState(result: SimulationResult, index: number): StateExplanation {
  const base = explainState(result, index)
  const s = base.sample
  const p = result.params
  const fi = freewheelInsight(result, s)
  const vf = p.diode.vf
  const x = s.values
  const vin = x.vin ?? 0
  const vout = x.vout ?? 0
  const src = base.chain.find((c) => c.stage === 'source')!
  const loadNodes = p.load === 'RLC' ? ['L', 'C ∥ R'] : p.load === 'RL' ? ['L', 'R'] : ['R']

  const path =
    fi.mode === 'freewheel'
      ? [...loadNodes, 'Dfw', p.load === 'R' ? 'back to R' : 'back to L']
      : fi.mode === 'source'
        ? base.path
        : fi.mode === 'overlap'
          ? [...(base.path ?? []), '+ Dfw (hand-over)']
          : null

  const mainText =
    fi.mode === 'freewheel'
      ? `Main rectifier OFF (${fi.main.label}): with the output clamped at ${V(vout)} by Dfw, the rectifier would need to drive the output above that through its own drops${base.firing ? ', and the next SCR has not been fired yet' : ''}.`
      : fi.mode === 'source' || fi.mode === 'overlap'
        ? `Main rectifier ON: ${fi.main.label} carr${fi.main.label.includes('+') ? 'y' : 'ies'} ${formatA(fi.main.current)} from the source.`
        : `Main rectifier OFF: vin = ${V(vin)} ${base.firing ? 'has not fired a forward-biased SCR' : `cannot forward bias it (Vf = ${formatSI(vf, 'V')})`} and no inductor current is flowing.`
  const inductorText =
    fi.il > 0
      ? `iL = ${formatA(fi.il)} must keep flowing — an inductor's current cannot change instantly. vL = L·di/dt = ${V(fi.vl)}: the current is ${fi.vl > 0 ? 'rising (L stores energy)' : 'falling (L releases energy)'}.`
      : 'iL = 0: the inductor has no current to sustain, so it places no demand on the circuit.'
  const fwText =
    fi.mode === 'freewheel' || fi.mode === 'overlap'
      ? `Dfw ON — forward biased: vDfw = ${V(fi.fw.voltage)}, iDfw = ${formatA(fi.fw.current)}. It is the only path left for the inductor current.`
      : `Dfw OFF — ${fi.fw.bias === 'reverse' ? 'reverse biased' : 'not above Vf'}: vDfw = −Vout = ${V(fi.fw.voltage)}, iDfw = 0 A.`
  const pathText = path ? `Current flows ${path.join(' → ')}${fi.mode === 'freewheel' ? ' — a closed loop that no longer includes the source' : ''}. io = ${formatA(s.io)}.` : 'No current flows anywhere.'
  const outputText =
    fi.mode === 'freewheel'
      ? `Vout = −Vf${p.diode.ron > 0 ? ' − Ron·i' : ''} = ${V(vout)} (clamped by Dfw) — not the source voltage, which is what the load would see if the rectifier were held on instead.`
      : fi.mode === 'off'
        ? 'Vout = 0 V (no current, no di/dt).'
        : `Vout = ${V(vout)} — the source voltage minus the conducting devices' drops.`
  const waveformText =
    fi.mode === 'freewheel'
      ? `The output stays at −Vf instead of following the source negative, so no negative area is subtracted from Vdc. The current decays with τ = L/R = ${formatTime(p.inductance / p.resistance)} instead of being forced to zero.`
      : fi.mode === 'source'
        ? `Vout follows the source (minus the drops). Io lags it: the inductor slows every change.`
        : 'Nothing changes until the rectifier conducts again.'

  const chain: CausalStep[] = [
    { stage: 'source', title: 'Source condition', text: src.text, equation: 'vin = Vm·sin(ωt + φ)' },
    { stage: 'diode', title: 'Main rectifier', text: mainText, equation: base.firing ? 'SCR ON: forward biased AND fired; then latched while i > 0' : 'ON: iD > 0     OFF: vD ≤ Vf' },
    { stage: 'inductor', title: 'Inductor current requirement', text: inductorText, equation: 'vL = L·di/dt   ⇒   i cannot jump' },
    { stage: 'freewheel', title: 'Freewheeling diode (Dfw)', text: fwText, equation: 'vDfw = −Vout;  ON when Vout would fall below −Vf' },
    { stage: 'path', title: 'Current path', text: pathText, equation: 'iL = i_rectifier + iDfw' },
    { stage: 'output', title: 'Load voltage', text: outputText, equation: fi.mode === 'freewheel' ? 'Vout = −Vf' : 'Vout = R·i + L·di/dt' },
    { stage: 'energy', title: 'Energy', text: fi.energyText, equation: 'E_L = ½·L·i²,   p_L = vL·i' },
    { stage: 'waveform', title: 'Waveform', text: waveformText },
  ]

  const headline =
    fi.mode === 'freewheel'
      ? 'Dfw ON — the inductor freewheels the load current'
      : fi.mode === 'source'
        ? `${fi.main.label} ON — the source supplies the load (Dfw blocks)`
        : fi.mode === 'overlap'
          ? `${fi.main.label} and Dfw share the current — hand-over`
          : base.headline
  const summary =
    fi.mode === 'freewheel'
      ? `The rectifier has stopped supplying the load (vin = ${V(vin)}). The inductor keeps ${formatA(fi.il)} flowing round the load and Dfw, clamping Vout at ${V(vout)} while its stored energy (${formatSI(fi.wl, 'J')}) drains into R.`
      : fi.mode === 'source'
        ? `${fi.main.label} supply the load from the source. Vout = ${V(vout)}, Io = ${formatA(s.io)}; Dfw is reverse biased by the output voltage.`
        : fi.mode === 'overlap'
          ? `At the hand-over both paths conduct for an instant while the current moves from one to the other; io = ${formatA(s.io)} flows on uninterrupted.`
          : base.summary

  return {
    ...base,
    diode: { ...base.diode, text: mainText },
    current: { ...base.current, text: pathText },
    output: { conducting: Math.abs(s.io) > 0, text: outputText },
    path,
    headline,
    summary,
    chain,
    freewheel: fi,
  }
}

/** Event explanations for the freewheeling circuit (falls back to the generic ones). */
export function explainFreewheelEvent(result: SimulationResult, e: CircuitEvent): EventExplanation {
  const base = explainEvent(result, e)
  const p = result.params
  const v = e.values
  const at = `at t = ${formatTime(e.time)} (θ = ${formatDeg(sineSource(p).angleDeg(e.time))})`
  const i = v.io ?? 0
  const wl = v.wl ?? 0.5 * p.inductance * i * i
  switch (e.kind) {
    case 'diode-on':
      if (e.device === 'Dfw')
        return {
          title: 'Dfw turns ON',
          what: `The freewheeling diode starts conducting ${at}, taking over io = ${formatA(i)}.`,
          why: `The rectifier can no longer carry the current (vin = ${formatV(v.vin ?? 0)}${deviceName(p, 'D1') !== 'D1' ? ', and the next SCR is not fired yet' : ''}). The inductor (E_L = ${formatSI(wl, 'J')}) keeps the current flowing, which pushes the output below the − rail; at Vout = −Vf Dfw becomes forward biased and closes the loop L → R → Dfw.`,
        }
      if (i > 0) {
        const n = deviceName(p, e.device!)
        return {
          title: `${n} turns ON — takes the current back`,
          what: `${n} starts conducting ${at} while ${formatA(i)} is still freewheeling.`,
          why: `${n !== e.device ? `${n} was fired and` : 'The source has turned the rectifier forward again:'} with Dfw conducting the output sits at −Vf, so the rectifier path now has enough forward voltage and takes the current; it transfers from Dfw without a break.`,
        }
      }
      return base
    case 'diode-off':
      if (e.device === 'Dfw')
        return i > 1e-9
          ? { title: 'Dfw turns OFF — the rectifier has the current', what: `Dfw stops conducting ${at}.`, why: `The rectifier has taken the full ${formatA(i)}; the output rises above −Vf, which reverse biases Dfw.` }
          : {
              title: 'Dfw turns OFF — the current reached zero',
              what: `The freewheel current reached zero ${at}.`,
              why: 'All the energy the inductor stored has been dissipated in R and Dfw, so nothing drives current any more — discontinuous conduction. A diode cannot carry reverse current, so Dfw turns off.',
            }
      if (e.device && i > 1e-9) {
        const n = deviceName(p, e.device)
        return {
          title: `${n} turns OFF — Dfw takes the current`,
          what: `${n} stops conducting ${at}; io = ${formatA(i)} is still flowing.`,
          why: `Without Dfw the inductor would hold the rectifier on and drag the output negative${p.topology === 'half-wave' ? ' until its energy was spent (the extinction angle β)' : ' until the next device is fired or forward biased'}. With Dfw fitted, as soon as the rectifier can no longer hold the output above −Vf, Dfw clamps it there and takes the current — so ${n} turns off early.`,
        }
      }
      return base
    case 'current-transfer':
      return {
        title: e.device === 'Dfw' ? 'Current continuity: rectifier → Dfw' : `Current continuity: Dfw → ${deviceName(p, e.device!)}`,
        what: `The load current ${formatA(i)} changes path ${at} — ${e.device === 'Dfw' ? 'from the source loop to the freewheel loop' : 'from the freewheel loop back to the source loop'} — without changing value.`,
        why: 'The current through an ideal inductor cannot change instantaneously. Only the path changes; the scope shows io continuous across the switch while the device currents swap.',
      }
    case 'energy-min':
      return {
        title: 'Inductor energy minimum',
        what: `E_L = ½·L·i² reaches its minimum, ${formatSI(wl, 'J')}, ${at}.`,
        why: 'The current is lowest here. It kept falling after D1 took over because vin was still below Vf + R·i; from now on vin exceeds it, L·di/dt turns positive and the inductor stores energy again.',
      }
    case 'current-stop':
      return { ...base, why: 'The freewheel current has decayed to zero: the inductor has given up all its stored energy. The circuit is idle until vin exceeds Vf.' }
    default:
      return base
  }
}

/** Index of an event time (state just after it). */
export const atEvent = (r: SimulationResult, e: CircuitEvent) => sampleAt(r, Math.min(r.trace.length - 1, indexAtTime(r, e.time) + 1))

/** One stop of "Step through conduction": an instant chosen from the simulation's events. */
export interface ConductionStep {
  n: number
  title: string
  time: number
  /** Narration generated from the simulated state at that instant. */
  text: string
}

/**
 * The conduction sequence of one steady cycle, located from the engine's events:
 * D1 conducting → D1 turns off → the inductor current must continue → Dfw forward biased →
 * freewheel current flows → inductor energy decreases → Dfw turns off.
 * The cycle starts at the second-to-last positive peak of vin, so every step lies inside the run.
 */
export function conductionSteps(result: SimulationResult): ConductionStep[] {
  const p = result.params
  const T = p.period
  const ev = result.events
  const src = sineSource(p)
  const θ = (t: number) => formatDeg(src.angleDeg(t))
  const peaks = ev.filter((e) => e.kind === 'vin-positive-peak' && e.time <= p.duration - T)
  const start = peaks.length ? peaks[peaks.length - 1].time : 0
  const inCycle = (e: CircuitEvent) => e.time > start && e.time <= start + T
  const d1Off = ev.find((e) => inCycle(e) && e.device === 'D1' && e.kind === 'diode-off')
  const fwOn = ev.find((e) => inCycle(e) && e.device === 'Dfw' && e.kind === 'diode-on')
  const fwOff = fwOn ? ev.find((e) => e.time > fwOn.time && e.device === 'Dfw' && e.kind === 'diode-off') : undefined
  const at = (t: number, after = false) => sampleAt(result, after ? Math.min(result.trace.length - 1, indexAtTime(result, t) + 1) : indexAtTime(result, t))
  const steps: ConductionStep[] = []
  const add = (title: string, time: number, text: string) => steps.push({ n: steps.length + 1, title, time, text })

  const s1 = at(start)
  const f1 = freewheelInsight(result, s1)
  add(
    'Main diode ON · freewheel diode OFF',
    start,
    `θ = ${θ(start)}: D1 conducts ${formatA(f1.d1.current)} and the source drives the load, Vout = ${V(s1.vout)}. Dfw sees −Vout = ${V(f1.fw.voltage)} — reverse biased, 0 A. The inductor holds ${formatSI(f1.wl, 'J')}.`,
  )
  if (!d1Off) return steps
  const s2 = at(d1Off.time)
  add(
    'Main diode turns OFF',
    d1Off.time,
    `θ = ${θ(d1Off.time)}: vin = ${V(d1Off.values.vin ?? 0)} has reached zero. D1 cannot keep the output above −Vf any more, so it stops conducting${fwOn ? '' : ' — the current has died out'}. io = ${formatA(d1Off.values.io ?? s2.io)} at that instant.`,
  )
  if (!fwOn) return steps
  const s3 = at(fwOn.time, true)
  const f3 = freewheelInsight(result, s3)
  add(
    'Inductor current attempts to continue',
    fwOn.time,
    `Just after the switch iL = ${formatA(f3.il)} — the same as just before (${formatA(fwOn.values.io ?? 0)}): an inductor's current cannot jump. To keep it flowing the inductor reverses its voltage, vL = ${V(f3.vl)}.`,
  )
  add(
    'Freewheel diode becomes forward biased',
    fwOn.time,
    `That pushes the + output below the − output: Vout = ${V(s3.vout)}, so Dfw has ${V(f3.fw.voltage)} across it, anode positive — forward biased. It conducts and clamps the output at −Vf.`,
  )
  const tEnd = fwOff ? fwOff.time : p.duration
  const t5 = fwOn.time + (tEnd - fwOn.time) / 3
  const s5 = at(t5)
  const f5 = freewheelInsight(result, s5)
  add(
    'Freewheel current flows',
    t5,
    `θ = ${θ(t5)}: iDfw = ${formatA(f5.fw.current)} circulates L → R → Dfw → L. The source is out of the loop: iD1 = ${formatA(f5.d1.current)} even though vin = ${V(s5.vin)}.`,
  )
  const t6 = fwOn.time + (2 * (tEnd - fwOn.time)) / 3
  const s6 = at(t6)
  const f6 = freewheelInsight(result, s6)
  const w0 = fwOn.values.wl ?? 0
  add(
    'Inductor energy decreases',
    t6,
    `θ = ${θ(t6)}: E_L = ½·L·i² has fallen from ${formatSI(w0, 'J')} to ${formatSI(f6.wl, 'J')} (${w0 > 0 ? ((1 - f6.wl / w0) * 100).toFixed(0) : 0} % released). Right now L gives ${formatW(-f6.pL)}: ${formatW(f6.pR)} heats R, ${formatW(f6.pDfw)} is lost in Dfw.`,
  )
  if (fwOff) {
    const d1Back = ev.some((e) => e.device === 'D1' && e.kind === 'diode-on' && Math.abs(e.time - fwOff.time) < T * 1e-6)
    add(
      'Freewheel diode turns OFF',
      fwOff.time,
      d1Back
        ? `θ = ${θ(fwOff.time)}: vin turns positive again. D1 takes the current back (io = ${formatA(fwOff.values.io ?? 0)} — still flowing, never zero), the output rises above −Vf and Dfw is reverse biased. Continuous conduction: the cycle repeats.`
        : `θ = ${θ(fwOff.time)}: the freewheel current has decayed to zero — all the stored energy has been dissipated. Dfw turns off and no current flows until vin exceeds Vf again (discontinuous conduction).`,
    )
  }
  return steps
}
