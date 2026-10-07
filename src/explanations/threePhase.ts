import { sampleAt } from '../simulation/engine.ts'
import { threePhaseSource } from '../simulation/source.ts'
import type { CircuitEvent, DiodeId, SimulationResult } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'
import type { CausalStep, EventExplanation, StateExplanation, ThreePhaseInsight } from './rectifier.ts'
import { trendAt } from './trend.ts'

type Phase = 'a' | 'b' | 'c'
const UP = (x: Phase) => x.toUpperCase()

/** Which phase each device connects to, and whether it is an upper (to +) device. */
export const DEVICE_MAP: Record<string, { phase: Phase; upper: boolean }> = {
  D1: { phase: 'a', upper: true },
  D3: { phase: 'b', upper: true },
  D5: { phase: 'c', upper: true },
  D4: { phase: 'a', upper: false },
  D6: { phase: 'b', upper: false },
  D2: { phase: 'c', upper: false },
  Da: { phase: 'a', upper: true },
  Db: { phase: 'b', upper: true },
  Dc: { phase: 'c', upper: true },
}

/** The device on phase x, upper or lower, for a topology. */
export function deviceOn(topology: string, x: Phase, upper: boolean): DiodeId {
  if (topology === '3ph-half-wave') return (`D${x}` as DiodeId)
  const id = Object.entries(DEVICE_MAP).find(([k, v]) => k.length === 2 && /D\d/.test(k) && v.phase === x && v.upper === upper)![0]
  return id as DiodeId
}

/**
 * Explain a three-phase rectifier state at one sample, from the simulation only:
 * phase EMFs → highest / lowest → device decision → path → output → load response.
 */
export function explainThreePhase(result: SimulationResult, index: number): StateExplanation {
  const { params: p, trace } = result
  const s = sampleAt(result, index)
  const x = s.values
  const half = p.topology === '3ph-half-wave'
  const scrUpper = p.control.device === 'scr' || p.topology === '3ph-half-controlled'
  const scrLower = p.control.device === 'scr' && p.topology === '3ph-bridge'
  const devName = (id: string) => (id === 'Dfw' ? 'Dfw' : (DEVICE_MAP[id]?.upper ? scrUpper : scrLower) ? id.replace('D', 'T') : id)
  const ideal = p.diode.kind === 'ideal'
  const vf = p.diode.vf
  const src = threePhaseSource(p)
  const θ = src.angleDeg(s.time)
  const cycle = Math.min(p.cycles, Math.floor(s.time / p.period) + 1)

  const phases = { a: x.vin ?? 0, b: x.vb ?? 0, c: x.vc ?? 0 }
  const order = (['a', 'b', 'c'] as Phase[]).sort((m, n) => phases[n] - phases[m])
  const hi = order[0]
  const lo = order[2]
  const on = s.diodes.filter((d) => d.on && d.id !== 'Dfw')
  const fwOn = s.diodes.some((d) => d.id === 'Dfw' && d.on)
  const upper = on.filter((d) => DEVICE_MAP[d.id]?.upper).map((d) => d.id)
  const lower = on.filter((d) => DEVICE_MAP[d.id] && !DEVICE_MAP[d.id].upper).map((d) => d.id)
  const overlap = upper.length > 1 || lower.length > 1
  const missing = p.faults.missingPhase
  const faultDiode = p.faults.diode

  // ── Path and output relation, from the conducting devices ─────────────────────
  const upPhase = upper[0] ? DEVICE_MAP[upper[0]].phase : null
  const loPhase = lower[0] ? DEVICE_MAP[lower[0]].phase : null
  let pathText = 'No current path — every device is blocking.'
  let pathNodes: string[] | null = null
  let outputRelation = 'Vo = 0'
  let outputFromSource = 0
  if (half && upPhase) {
    pathNodes = [`Phase ${UP(upPhase)}`, devName(upper[0]), 'Load', 'Neutral']
    pathText = pathNodes.join(' → ')
    outputRelation = `Vo = V${upPhase}N − ${ideal ? '0' : 'Vf'}`
    outputFromSource = phases[upPhase] - vf
  } else if (!half && upPhase && loPhase) {
    pathNodes = [`Phase ${UP(upPhase)}`, devName(upper[0]), 'Load', devName(lower[0]), `Phase ${UP(loPhase)}`]
    pathText = pathNodes.join(' → ')
    outputRelation = upPhase === loPhase ? 'Vo = −2·Vf (the load current freewheels through one leg)' : `Vo = V${upPhase}${loPhase} − ${ideal ? '0' : '2·Vf'}`
    outputFromSource = phases[upPhase] - phases[loPhase] - 2 * vf
  } else if (fwOn) {
    pathNodes = ['Load', 'Dfw', 'Load']
    pathText = 'Load → freewheeling diode Dfw → Load (the source is disconnected)'
    outputRelation = 'Vo = −Vf (Dfw conducting)'
    outputFromSource = -vf
  }
  if (overlap) {
    pathText += ` — plus ${[...upper.slice(1), ...lower.slice(1)].map(devName).join(', ')} during commutation overlap`
  }
  const pairLabel = on.length ? on.map((d) => devName(d.id)).join(' & ') : fwOn ? 'Dfw' : 'none'

  // Region: which 60° (bridge) / 120° (half-wave) natural segment θ lies in.
  const segW = half ? 120 : 60
  const segIdx = Math.floor((((θ - 30) % 360) + 360) % 360 / segW)
  const segStart = (30 + segIdx * segW) % 360
  const region = `natural segment ${segIdx + 1} of ${half ? 3 : 6}: θ = ${segStart}°–${(segStart + segW) % 360 || 360}°`

  // ── Gate information for SCRs ──────────────────────────────────────────────────
  const gateOf = (id: DiodeId) => {
    const k = result.diodeIds.indexOf(id)
    const g = trace.diodes[k]?.gate
    return g ? g[s.index] === 1 : null
  }

  // ── WHY: the condition step, built from what actually conducts ────────────────
  const fmtP = (q: Phase) => `V${q}N = ${formatV(phases[q])}`
  const sourceText = `Instantaneous phase voltages at θ = ${formatDeg(θ)}: ${fmtP('a')}, ${fmtP('b')}, ${fmtP('c')}. Highest: phase ${UP(hi)}. Lowest: phase ${UP(lo)}.`
  const conditions: string[] = []
  const natUp = deviceOn(p.topology, hi, true)
  const natLo = half ? null : deviceOn(p.topology, lo, false)
  if (upPhase) {
    if (upPhase === hi) {
      conditions.push(
        half
          ? `All three diodes share the cathode (the + output). Only the diode on the MOST positive phase can have its anode above that cathode — any other would need its phase above phase ${UP(hi)}, which it is not. So ${devName(upper[0])} (phase ${UP(hi)}) is forward biased.`
          : `The upper devices share the + rail. Only the one on the most positive phase can be forward biased: the + rail sits at about V${hi}N, above every other phase, so every other upper device has its cathode above its anode. So ${devName(upper[0])} (phase ${UP(hi)}) conducts.`,
      )
    } else {
      const g = gateOf(natUp)
      conditions.push(
        scrUpper && g === false
          ? `Phase ${UP(hi)} is now the highest, but its SCR ${devName(natUp)} has not been fired yet (gate pulse arrives α = ${formatDeg((p.control.alpha * 180) / Math.PI)} after the natural point). So ${devName(upper[0])} stays latched: an SCR keeps conducting until its current falls to zero.`
          : missing === hi
            ? `Phase ${UP(hi)} would be the highest, but that phase conductor is disconnected (missing-phase fault), so its devices cannot conduct; ${devName(upper[0])} on phase ${UP(upPhase)} carries the current.`
            : faultDiode?.id === natUp
              ? `${natUp} on the highest phase is ${faultDiode.kind === 'open' ? 'OPEN (faulty)' : 'SHORTED (faulty)'}, so ${devName(upper[0])} on phase ${UP(upPhase)} carries the current instead.`
              : `${devName(upper[0])} (phase ${UP(upPhase)}) still conducts although phase ${UP(hi)} is higher — the source inductance makes the current hand over gradually (commutation overlap).`,
      )
    }
  }
  if (!half && loPhase) {
    if (loPhase === lo) {
      conditions.push(`The lower devices share the − rail. Only the one on the MOST negative phase can have the − rail above its own phase: ${devName(lower[0])} (phase ${UP(lo)}) provides the return path.`)
    } else {
      const g = natLo ? gateOf(natLo) : null
      conditions.push(
        scrLower && g === false
          ? `Phase ${UP(lo)} is now the lowest, but its lower SCR ${natLo ? devName(natLo) : ''} has not been fired yet, so ${devName(lower[0])} (phase ${UP(loPhase)}) remains latched as the return path.`
          : `${devName(lower[0])} on phase ${UP(loPhase)} still provides the return path (phase ${UP(lo)} is lower, but its device ${natLo && faultDiode?.id === natLo ? 'is faulty' : 'has not taken over yet'}).`,
      )
    }
  }
  if (!on.length) {
    conditions.push(
      scrUpper && p.control.device === 'scr'
        ? `No SCR is conducting: the last pair's current reached zero and the next pair has not been fired yet. With a resistive load and large α the current is discontinuous.`
        : fwOn
          ? 'The load voltage tried to go below zero, so the freewheeling diode took over the load current and the bridge stopped conducting.'
          : `No device can be forward biased: ${half ? 'even the highest phase is below Vf' : 'the largest line voltage is below 2·Vf'}.`,
    )
  }
  const conditionText = conditions.join(' ')
  const conditionEq = half ? 'conducting diode: argmax(VaN, VbN, VcN)' : 'upper: argmax(VaN, VbN, VcN)   lower: argmin(VaN, VbN, VcN)'

  // ── Device states ───────────────────────────────────────────────────────────────
  const devText = s.diodes
    .map((d) => {
      const g = trace.diodes[result.diodeIds.indexOf(d.id)]?.gate
      const gate = g ? (g[s.index] ? ', gate ON' : ', gate off') : ''
      return `${devName(d.id)} ${d.on ? 'ON' : 'OFF'} (${d.on ? formatA(d.current) : `vD ${formatV(d.voltage)}`}${gate})`
    })
    .join('; ')
  const diodeText = `${devText}.${on.length ? ` Conducting: ${pairLabel}.` : ''} ${!half ? `Every device not conducting is reverse biased by up to the line voltage (≈ ${formatV(-Math.max(0, ...s.diodes.filter((d) => !d.on).map((d) => -d.voltage)))}).` : ''}`

  // ── Energy, output, load response ───────────────────────────────────────────────
  const hasL = p.load === 'RL' || p.load === 'RLC'
  const il = x.il ?? (p.load === 'RL' ? s.io : 0)
  const pL = (x.vl ?? 0) * il
  const energyText =
    `The source delivers ${formatW(x.ps ?? 0)}; R dissipates ${formatW(x.pload ?? 0)}` +
    (ideal ? '' : `; the devices lose ${formatW(x.pd ?? 0)}`) +
    '.' +
    (hasL ? ` L stores E_L = ½·L·i² = ${formatSI(x.wl ?? 0, 'J')} and is ${pL >= 0 ? `absorbing ${formatW(pL)}` : `returning ${formatW(-pL)}`}.` : ' A resistor stores no energy.')
  const outputText = `${outputRelation}${on.length ? ` = ${formatV(outputFromSource)} (from the source values)` : ''}; simulated Vo = ${formatV(s.vout)}.${p.diode.ron > 0 && on.length ? ' (The small difference is the Ron·i drop.)' : ''}`
  const ioTrend = trendAt(trace.time, trace.signals.io!, s.index, p.omega * Math.max(1e-12, Math.abs(s.io) + 1e-9))
  const loadText =
    p.load === 'R'
      ? `Io = Vo/R = ${formatA(s.io)} — a resistor follows Vo instantly. ${half ? 'The load sees the top envelope of the three phases: 3 pulses per cycle, ripple at 3f.' : 'The bridge always connects the load between the highest and lowest phase, so Vo rides on the top of the line-voltage envelope: 6 pulses per cycle, ripple at 6f.'}`
      : p.load === 'RL'
        ? `L·di/dt = Vo − R·i = ${formatV(x.vl ?? 0)}, so io is ${ioTrend === 'rising' ? 'rising' : ioTrend === 'falling' ? 'falling' : 'near its extreme'} (${formatA(s.io)}). The inductor's current cannot change instantly, so io is much smoother than Vo (L/R = ${formatTime(p.inductance / p.resistance)}).`
        : `The capacitor ${(x.ic ?? 0) >= 0 ? 'is charging' : 'is supplying the load'} (iC = ${formatA(x.ic ?? 0, true)}).`

  const chain: CausalStep[] = [
    { stage: 'source', title: 'Source', text: sourceText, equation: 'VaN = Vm·sin θ,  VbN = Vm·sin(θ − 120°),  VcN = Vm·sin(θ + 120°)' },
    { stage: 'condition', title: 'Diode decision', text: conditionText, equation: conditionEq },
    { stage: 'diode', title: 'Device states', text: diodeText, equation: 'ON: iD > 0     OFF: vD ≤ Vf' },
    { stage: 'path', title: 'Current path', text: pathText, equation: half ? 'io = iDx (one diode carries the load current)' : 'io = i(upper) = i(lower)' },
    { stage: 'output', title: 'Output voltage', text: outputText, equation: outputRelation },
    { stage: 'energy', title: 'Energy', text: energyText, equation: hasL ? 'E_L = ½·L·i²,   p = v·i' : 'p = Vo·Io' },
    { stage: 'waveform', title: 'Load response', text: loadText, equation: p.load === 'R' ? 'Io = Vo / R' : p.load === 'RL' ? 'Vo = R·i + L·di/dt' : 'i = C·dVc/dt + Vc/R' },
  ]

  const headline = on.length
    ? `${pairLabel} conducting — ${half ? `phase ${UP(upPhase!)} feeds the load` : upPhase && loPhase && upPhase !== loPhase ? `load connected across V${upPhase}${loPhase}` : 'freewheeling'}`
    : fwOn
      ? 'Freewheeling diode carries the load current'
      : 'No device conducting'
  const summary = on.length
    ? `${UP(hi)} is the highest phase${half ? '' : ` and ${UP(lo)} the lowest`}; ${pairLabel} conduct${on.length > 1 ? '' : 's'}, so current flows ${pathText}. ${outputRelation} → Vo = ${formatV(s.vout)}, Io = ${formatA(s.io)}.`
    : `No device is conducting at this instant: Io comes only from stored energy (${formatA(s.io)}), Vo = ${formatV(s.vout)}.`

  const insight: ThreePhaseInsight = {
    phases,
    order,
    upper: upper.map(devName),
    lower: lower.map(devName),
    pairLabel,
    pathText,
    outputRelation,
    outputFromSource,
    region,
    overlap,
    freewheeling: fwOn,
    names: Object.fromEntries(result.diodeIds.map((id) => [id, devName(id)])),
  }
  const polarity = phases.a > 0 ? 'positive' : phases.a < 0 ? 'negative' : 'zero'
  return {
    sample: s,
    angleDeg: θ,
    cycle,
    source: { polarity, trend: trendAt(trace.time, trace.signals.vin!, s.index, p.omega * p.vm), text: sourceText },
    diode: { on: s.diodes[0].on, bias: s.diodes[0].bias, text: diodeText },
    diodes: s.diodes.map((d) => ({ id: d.id, on: d.on, bias: d.bias })),
    current: { flowing: on.length > 0 || fwOn, trend: s.io === 0 ? 'zero' : ioTrend === 'rising' ? 'increasing' : ioTrend === 'falling' ? 'decreasing' : 'at peak', text: pathText },
    output: { conducting: Math.abs(s.io) > 0, text: outputText },
    path: pathNodes,
    headline,
    summary,
    chain,
    threePhase: insight,
  }
}

/** Explain a three-phase event (commutation, firing, phase crossing…). */
export function explainEventThreePhase(result: SimulationResult, e: CircuitEvent): EventExplanation {
  const p = result.params
  const src = threePhaseSource(p)
  const θ = src.angleDeg(e.time)
  const at = `at t = ${formatTime(e.time)} (θ = ${formatDeg(θ)})`
  const v = e.values
  const ph = `VaN = ${formatV(v.vin ?? 0)}, VbN = ${formatV(v.vb ?? 0)}, VcN = ${formatV(v.vc ?? 0)}`
  const scr = p.control.device === 'scr' || p.topology === '3ph-half-controlled'
  const dev = e.device ? DEVICE_MAP[e.device] : null
  const name = e.device ?? ''
  switch (e.kind) {
    case 'diode-on':
      return {
        title: `${name} turns ON`,
        what: `${name}${dev ? ` (${dev.upper ? 'upper' : 'lower'}, phase ${UP(dev.phase)})` : ''} starts conducting ${at}. ${ph}.`,
        why:
          e.device === 'Dfw'
            ? 'The load voltage tried to go negative; the freewheeling diode clamps it near zero and carries the inductor current.'
            : scr && dev && (dev.upper || p.topology === '3ph-bridge')
              ? `Its gate pulse arrived (α = ${formatDeg((p.control.alpha * 180) / Math.PI)} after the natural commutation point) while it was forward biased, so it latched on.`
              : dev
                ? `Phase ${UP(dev.phase)} has just become the ${dev.upper ? 'highest' : 'lowest'} phase, so ${name} is now forward biased and takes over — a natural commutation.`
                : 'It became forward biased.',
      }
    case 'diode-off':
      return {
        title: `${name} turns OFF`,
        what: `${name} stops conducting ${at}. ${ph}.`,
        why:
          dev && !scr
            ? `Another phase is now ${dev.upper ? 'higher' : 'lower'} than phase ${UP(dev.phase)}; its device took over the ${dev.upper ? '+' : '−'} rail, which reverse biases ${name}.`
            : 'Its current fell to zero (the incoming device took the current, or the load current died out), so it turned off.',
      }
    case 'phase-crossing':
      return {
        title: 'Natural commutation point',
        what: `Two phase voltages are equal ${at}. ${ph}.`,
        why: scr
          ? `For diodes this is where the hand-over would happen. SCRs wait for their gate: the incoming device is fired α = ${formatDeg((p.control.alpha * 180) / Math.PI)} later.`
          : 'The order of the phase voltages changes here, so the highest (or lowest) phase — and therefore the conducting diode — changes. These six points per cycle are the commutation boundaries.',
      }
    case 'vin-positive-peak':
    case 'vin-negative-peak':
      return {
        title: e.kind === 'vin-positive-peak' ? 'Phase a crest' : 'Phase a trough',
        what: `VaN reaches ${e.kind === 'vin-positive-peak' ? '+' : '−'}Vm = ${formatV(v.vin ?? 0)} ${at}.`,
        why:
          e.kind === 'vin-positive-peak'
            ? 'Phase a is the highest phase from 30° to 150°, centred on this crest — its upper device conducts throughout.'
            : 'Phase a is the lowest phase from 210° to 330°, centred here — in a bridge its lower device provides the return path.',
      }
    case 'vin-zero-rising':
    case 'vin-zero-falling':
      return { title: 'VaN crosses zero', what: `VaN changes sign ${at}. ${ph}.`, why: 'A zero crossing of one phase is NOT a commutation point in a three-phase rectifier — the devices only change where two phases cross (30°, 90°, 150° …).' }
    case 'current-start':
    case 'current-stop':
      return {
        title: e.kind === 'current-start' ? 'Current starts' : 'Current stops',
        what: `The rectifier ${e.kind === 'current-start' ? 'starts' : 'stops'} delivering current ${at}.`,
        why: e.kind === 'current-start' ? 'A device pair was forward biased (and fired, for SCRs).' : 'The load current reached zero — discontinuous conduction (large α, resistive load, or a fault).',
      }
    case 'vout-max':
    case 'vout-min':
      return {
        title: e.kind === 'vout-max' ? 'Output crest' : 'Output valley',
        what: `Vo = ${formatV(v.vout ?? 0)} ${at}.`,
        why: e.kind === 'vout-max' ? 'The middle of a conduction segment, where the conducting line (or phase) voltage peaks.' : 'A commutation boundary: the conducting pair is about to change.',
      }
  }
}
